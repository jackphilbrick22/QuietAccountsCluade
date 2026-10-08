#!/usr/bin/env node
/**
 * Renders the service film: serves the built film page (film/dist), opens it in Chromium at 1280 × 596 CSS px and
 * device scale 1.5, steps the film clock at 30 fps, screenshots every frame and pipes them to ffmpeg.
 *
 *   pnpm --filter @qa/web film:build                    (vite build --config film/vite.config.ts → film/dist)
 *   node film/render.mjs                                → film/out/quiet-accounts-film.{mp4,webm}, -1280.mp4 (for small
 *                                                         screens), -poster.jpg (a strong frame, --poster <ms>),
 *                                                         -first.jpg (frame 0, the loop's start)
 *   node film/render.mjs --trade cleaning               → film/out/quiet-accounts-film-cleaning.* (content.cleaning.json)
 *   node film/render.mjs --stills 0,7500,12650 --out d  → one PNG per moment (ms), nothing encoded
 *   node film/render.mjs --frames <dir>                 keeps every frame's PNG there (for contact sheets)
 *
 * Checks before it calls a render good (STORYBOARD §7): the fonts are loaded; the outer 30 output px (the 20 CSS px
 * margin) are white in every 15th frame; the last frame matches the first (t = the loop's length vs 0, mean
 * difference < 0.5/255); and every half second the page's own text says none of the banned words, and "free" only
 * beside its price.
 *
 * ffmpeg: FFMPEG=/path/to/ffmpeg, or the full build in .claude/worktrees/results/bin/ffmpeg.
 */
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");
const OUT = join(HERE, "out");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : dflt;
};
const trade = opt("trade", "lawn");
const FPS = 30;
/** the loop's length: the film page's own (film/src/timeline.ts), read once the page is up */
let DURATION = 0;
const W = 1280;
const H = 596;
const SCALE = 1.5;

function findFfmpeg() {
  const cands = [process.env.FFMPEG, resolve(HERE, "../../../../results/bin/ffmpeg"), "/home/user/QuietAccountsCluade/.claude/worktrees/results/bin/ffmpeg", "ffmpeg"].filter(Boolean);
  for (const c of cands) {
    const r = spawnSync(c, ["-hide_banner", "-encoders"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.includes("libx264") && r.stdout.includes("libvpx-vp9")) return c;
  }
  throw new Error("No ffmpeg with libx264 and libvpx-vp9: set FFMPEG=/path/to/ffmpeg");
}

/* ------------------------------ serve film/dist ------------------------------ */

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".png": "image/png" };
function serve() {
  if (!existsSync(join(DIST, "index.html"))) throw new Error("No film/dist: run `pnpm --filter @qa/web film:build` first");
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = join(DIST, path === "/" ? "index.html" : path);
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

/* ------------------------------ pixels, via ffmpeg ------------------------------ */

function rgb(ffmpeg, png) {
  const r = spawnSync(ffmpeg, ["-v", "error", "-f", "png_pipe", "-i", "-", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { input: png, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg decode: ${r.stderr}`);
  return r.stdout;
}
function edgeWhite(buf, w, h, band = 30) {
  let worst = 255;
  for (let y = 0; y < h; y++) {
    const inBand = y < band || y >= h - band;
    for (let x = 0; x < w; x++) {
      if (!inBand && x >= band && x < w - band) {
        x = w - band - 1;
        continue;
      }
      const i = (y * w + x) * 3;
      worst = Math.min(worst, buf[i], buf[i + 1], buf[i + 2]);
    }
  }
  return worst;
}
function meanDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/* ------------------------------ the words ------------------------------ */

const BANNED = /\b(example|sample|demo|simulated|test|placeholder|lorem|john doe|123 main|live)\b|money-back|risk-free|free trial|guaranteed \d|money map|reply desk|ready text|every month after|year floor|\bguarantee\b|dow's|555-\d{4}/i;
function wordsOk(text, allowedFree) {
  const problems = [];
  const hit = BANNED.exec(text);
  if (hit) problems.push(`says "${hit[0]}": …${text.slice(Math.max(0, hit.index - 60), hit.index + 60).replace(/\s+/g, " ")}…`);
  // "free" only inside the lines that carry its price
  let rest = text;
  for (const a of allowedFree) rest = rest.split(a).join("");
  const free = /\bfree\b/i.exec(rest);
  if (free) problems.push(`"free" without its price: …${rest.slice(Math.max(0, free.index - 60), free.index + 60).replace(/\s+/g, " ")}…`);
  return problems;
}

/* ------------------------------ main ------------------------------ */

const pw = await import(join(dirname(process.execPath), "../lib/node_modules/playwright/index.mjs"));
const ffmpeg = findFfmpeg();
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/index.html${trade !== "lawn" ? `?trade=${trade}` : ""}`;
const browser = await pw.chromium.launch({ args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none", "--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, colorScheme: "light", reducedMotion: "no-preference" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url, { waitUntil: "load" });
await page.evaluate(() => window.__film.ready);
DURATION = await page.evaluate(() => window.__film.duration);
const fontsOk = await page.evaluate(() => window.__film.fontsOk());
if (!fontsOk) throw new Error("Fonts not loaded (Cal Sans / Inter): refusing to render");
const shot = async (ms) => {
  await page.evaluate((t) => window.__film.seek(t), ms);
  return page.screenshot({ type: "png", animations: "disabled", caret: "hide" });
};

const stills = opt("stills", null);
if (stills) {
  const dir = resolve(opt("out", join(tmpdir(), "qa-film-stills")));
  mkdirSync(dir, { recursive: true });
  for (const ms of String(stills).split(",").map(Number)) {
    writeFileSync(join(dir, `t${String(ms).padStart(5, "0")}.png`), await shot(ms));
  }
  console.log(`stills in ${dir}`);
  if (errors.length) console.log(`page errors:\n  ${errors.join("\n  ")}`);
  await browser.close();
  server.close();
  process.exit(0);
}

const framesDir = opt("frames", null);
if (framesDir) mkdirSync(framesDir, { recursive: true });
mkdirSync(OUT, { recursive: true });
const base = join(OUT, trade === "lawn" ? "quiet-accounts-film" : `quiet-accounts-film-${trade}`);
const color = ["-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"];
const enc = (outFile, codec) =>
  spawn(ffmpeg, ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-", ...color, ...codec, "-an", outFile], { stdio: ["pipe", "inherit", "inherit"] });
const x264 = (crf) => ["-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-tune", "animation", "-crf", String(crf), "-x264-params", "aq-mode=3", "-movflags", "+faststart"];
const mp4 = enc(`${base}.mp4`, x264(opt("crf", 20)));
const webm = enc(`${base}.webm`, ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(opt("vp9crf", 32)), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2"]);
// a 1280 × 596 MP4 for small screens (a phone shows it about 375 px wide): the same frames, scaled down
const small = spawn(
  ffmpeg,
  ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-", "-vf", "scale=1280:596:flags=lanczos,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv", ...x264(Number(opt("crf", 20)) + 2), "-an", `${base}-1280.mp4`],
  { stdio: ["pipe", "inherit", "inherit"] },
);
const write = (p, buf) => new Promise((r) => (p.stdin.write(buf) ? r() : p.stdin.once("drain", r)));
const closed = (p) => new Promise((r, j) => p.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));
// listen for each encoder's exit from the start: it may finish while the word checks below are still running
const encoders = Promise.all([closed(mp4), closed(webm), closed(small)]);

const frames = Math.round((DURATION / 1000) * FPS);
const posterFrame = Math.round((Number(opt("poster", 22000)) / 1000) * FPS);
const problems = [];
let first;
let poster;
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  const ms = (i * 1000) / FPS;
  const png = await shot(ms);
  if (i === 0) first = png;
  if (i === posterFrame) poster = png;
  if (framesDir) writeFileSync(join(framesDir, `f${String(i).padStart(4, "0")}.png`), png);
  if (i % 15 === 0) {
    const worst = edgeWhite(rgb(ffmpeg, png), W * SCALE, H * SCALE);
    if (worst < 254) problems.push(`frame ${i} (t ${ms.toFixed(0)} ms): edge pixel ${worst}, not white`);
  }
  await Promise.all([write(mp4, png), write(webm, png), write(small, png)]);
  if (i % 60 === 0) process.stdout.write(`\r  frame ${i}/${frames}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
mp4.stdin.end();
webm.stdin.end();
small.stdin.end();

// the seam: t = DURATION must be the first frame again
const last = await shot(DURATION);
const seam = meanDiff(rgb(ffmpeg, first), rgb(ffmpeg, last));
if (seam >= 0.5) problems.push(`seam: frame 0 vs t = ${DURATION / 1000} s differ by ${seam.toFixed(3)}/255`);

// the words, at the middle of every beat (phone included)
const content = JSON.parse(readFileSync(join(HERE, trade === "lawn" ? "content.json" : `content.${trade}.json`), "utf8"));
const welcomeLast = content.ownerTexts.welcome.text.split("\n\n").at(-1);
// the round's last text says "the free 150" in the same bubble as its price ("$497 a month keeps it going")
const allowedFree = [...content.offer.lines, welcomeLast, ...(content.ownerTexts.close?.text.split("\n\n") ?? [])];
// every half second: whatever is on screen then (the phone included)
for (let ms = 250; ms < DURATION; ms += 500) {
  await page.evaluate((t) => window.__film.seek(t), ms);
  const text = await page.evaluate(() => {
    // only what is on screen: skip anything hidden or fully transparent
    const parts = [];
    const walk = (el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return;
      for (const n of el.childNodes) {
        if (n.nodeType === 3) parts.push(n.textContent);
        else if (n.nodeType === 1) walk(n);
      }
    };
    walk(document.body);
    return parts.join(" ");
  });
  for (const p of wordsOk(text, allowedFree)) problems.push(`t ${ms} ms: ${p}`);
}

await encoders;
// the poster: a strong frame for when a browser won't autoplay; and frame 0, for a page that wants no change at all
// between the poster and the first frame of the loop
const jpg = (png, out) => spawnSync(ffmpeg, ["-y", "-v", "error", "-f", "png_pipe", "-i", "-", "-q:v", "3", out], { input: png });
jpg(first, `${base}-first.jpg`);
jpg(poster ?? first, `${base}-poster.jpg`);
await browser.close();
server.close();

console.log(`\n  ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s; seam ${seam.toFixed(3)}/255`);
for (const f of [`${base}.mp4`, `${base}.webm`, `${base}-1280.mp4`, `${base}-poster.jpg`, `${base}-first.jpg`]) console.log(`  ${f}  ${(statSync(f).size / 1e6).toFixed(2)} MB`);
if (errors.length) problems.push(...errors.map((e) => `page error: ${e}`));
if (problems.length) {
  console.log(`\nCHECKS FAILED:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("  checks: fonts, edges, seam, words: all good");
