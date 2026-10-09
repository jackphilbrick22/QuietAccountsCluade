import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSample, lintMarketing } from "@qa/engine";
import { exampleNote } from "../build/examples.ts";
import { EXAMPLE_SIGNER } from "../build/render.ts";
import { runAudit, type AuditFile } from "../src/audit.ts";
import { netlifyBody, signupBody, withFile, type Signup } from "../src/form.ts";
import { fillIn } from "../src/note.ts";
import { LOOKS, MONTHLY, PAGES, TRADE_SITE, VIEWS, viewPage } from "../src/trades.ts";
import { lawnClients, visitsReport } from "../../../packages/engine/test/lawn-fixtures.ts";
import { FILMED, FILMED_COLD } from "./html.ts";

/**
 * `pnpm build:site` as Netlify gets it: a page per path, dist.zip beside it, no engine in what the browser loads.
 * Then, where this machine has Playwright's Chromium (it's never installed here), the pages run for real at phone width.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "qa-site-"));
const dist = join(tmp, "dist");
const withServer = join(tmp, "server");

async function buildTo(outDir: string, serverUrl?: string) {
  const before = process.env.VITE_SERVER_URL;
  if (serverUrl) process.env.VITE_SERVER_URL = serverUrl;
  else delete process.env.VITE_SERVER_URL;
  try {
    await build({ root, configFile: join(root, "vite.config.ts"), logLevel: "silent", build: { outDir, emptyOutDir: true } });
  } finally {
    if (before === undefined) delete process.env.VITE_SERVER_URL;
    else process.env.VITE_SERVER_URL = before;
  }
}

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)).map((x) => `${f}/${x}`) : [f]));

/** The entries of a zip, read back through its central directory. */
function unzip(path: string): Map<string, Buffer> {
  const zip = readFileSync(path);
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const out = new Map<string, Buffer>();
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const nameLen = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString();
    const local = zip.readUInt32LE(at + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26);
    out.set(name, inflateRawSync(zip.subarray(start, start + zip.readUInt32LE(at + 20))));
    at += 46 + nameLen;
  }
  return out;
}

beforeAll(async () => {
  await buildTo(dist);
  await buildTo(withServer, "https://api.example.test/");
}, 120_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("the build", () => {
  it("writes / and a page per path (/lawn/index.html is Netlify's /lawn), their assets, and a zip of all of it", () => {
    const built = files(dist);
    expect(built).toEqual(expect.arrayContaining(["index.html", "lawn/index.html", "cleaning/index.html", "tree/index.html", "painting/index.html", "fence/index.html", "main-site/index.html", "cold-email-page/index.html", "og-soro.png", ...[...LOOKS, ...TRADE_SITE].map((v) => `${v.id}/index.html`)]));
    for (const shot of ["tom-text", "david-text", "ryan-text"]) expect(built.some((f) => f.startsWith(`assets/${shot}`) && f.endsWith(".jpg")), shot).toBe(true);
    const zipped = unzip(`${dist}.zip`);
    expect([...zipped.keys()].sort()).toEqual([...built].sort());
    for (const f of built) expect(zipped.get(f)!.equals(readFileSync(join(dist, f))), f).toBe(true);
  });

  it("ships the engine only in the audit's worker, a file of its own: the page's notes were written at build time", () => {
    const js = files(dist).filter((f) => extname(f) === ".js");
    expect(js.map((f) => f.replace(/-[\w-]{8}\.js$/, ""))).toEqual(["assets/page", "assets/worker"]);
    const page = readFileSync(join(dist, js[0]!), "utf8");
    // (the film's few controls are in it too: its cut for his screen, pause and play, its scroll into view)
    expect(page.length).toBeLessThan(13_000);
    expect(page).not.toMatch(/lapsed_regular|We used to take care|libphonenumber/);
    // the page only names the worker; nothing loads it until a file is dropped (below)
    expect(page).toContain(`new Worker("/${js[1]}"`);
    expect(readFileSync(join(dist, js[1]!), "utf8")).toMatch(/lapsed_regular[\s\S]*We used to take care/);
    expect(readFileSync(join(dist, "index.html"), "utf8")).not.toContain("<script");
  });
});

/* ------------------------------ in a real browser, where there is one ------------------------------ */

// The machine's own Playwright, if it has one; its types aren't part of this repo.
type Any = any;
const playwright: Any = await import(join(dirname(process.execPath), "../lib/node_modules/playwright/index.mjs")).catch(() => undefined);
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".mp4": "video/mp4" };

describe.runIf(playwright)("in Chromium", () => {
  let browser: Any;
  beforeAll(async () => void (browser = await playwright.chromium.launch()), 60_000);
  afterAll(async () => browser?.close());

  /**
   * The built site at http://site.test, offline: fonts fall back, and every POST is answered by `post`. With reduced
   * motion, as the page honors it, so a click never waits out a smooth scroll (`motion` turns it back on), and `before`
   * runs ahead of the page's own scripts.
   */
  async function open(
    path: string,
    from = dist,
    post: (r: Any) => Promise<void> = (r) => r.fulfill({ status: 200, body: "" }),
    width = 390,
    { motion = false, before, height = 844 }: { motion?: boolean; before?: (page: Any) => Promise<unknown>; height?: number } = {},
  ) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: motion ? "no-preference" : "reduce" });
    await before?.(page);
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
    await page.route(/^https?:\/\/(?!site\.test)/, (r: Any) => {
      const method = r.request().method();
      return method === "OPTIONS" ? r.fulfill({ status: 204, headers: cors }) : method === "POST" ? post(r) : r.abort();
    });
    await page.route("http://site.test/**", async (r: Any) => {
      if (r.request().method() === "POST") return post(r);
      let file = join(from, new URL(r.request().url()).pathname);
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(file, "index.html");
      return r.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] });
    });
    await page.goto(`http://site.test${path}`);
    return page;
  }
  const box = async (page: Any, sel: string) => page.locator(sel).first().boundingBox();
  /** Rule 8: at 390x844, the headline, the promise, the button and its price line show without scrolling, and nothing scrolls sideways. */
  async function firstScreen(page: Any, button: string) {
    for (const sel of ["h1", ".promise", button, `${button} + .price-line`]) {
      expect(await page.isVisible(sel), sel).toBe(true);
      const b = await box(page, sel);
      expect(b.y, sel).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, sel).toBeLessThanOrEqual(844);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  /** Each POST the page makes, answered 200. */
  function recorder() {
    const posts: Any[] = [];
    const post = async (r: Any) => {
      posts.push(r.request());
      await r.fulfill({ status: 200, body: "" });
    };
    return { posts, post };
  }

  it("at 390x844 the headline, the promise and the button are on the first screen of every page, with no sideways scroll", async () => {
    for (const p of PAGES) {
      const page = await open(`/${p.id}`);
      await firstScreen(page, "#submit");
      await page.close();
    }
    const page = await open("/lawn");
    // the closing block's button goes back up to the one form, ready to type in
    await page.click("#final .btn");
    await page.waitForFunction(() => document.activeElement?.id === "company");
    await page.waitForFunction(() => Math.abs(document.querySelector("#start")!.getBoundingClientRect().top - 80) < 4);
    await page.close();
  });

  it("the header stays at the top as he scrolls, and on a wide screen the one-pass copy stays beside his note", async () => {
    const top = (page: Any, sel: string) => page.evaluate((s: string) => document.querySelector(s)!.getBoundingClientRect().top, sel);
    let page = await open("/lawn");
    await page.evaluate(() => scrollTo(0, 1500));
    expect(await top(page, ".top")).toBe(0);
    await page.close();
    page = await open("/tree?co=Tall%20Pine", dist, undefined, 1280);
    await page.evaluate(() => scrollTo(0, 600));
    expect(await top(page, ".kcopy")).toBe(96);
    await page.close();
  });

  it("every tap target is at least 44px tall, form and footer included", async () => {
    for (const path of ["/", ...[...PAGES, ...VIEWS].map((p) => `/${p.id}`), ...["cold-email-page", ...[...LOOKS, ...TRADE_SITE].filter((v) => v.open).map((v) => v.id)].map((id) => `/${id}?co=Ridgeline%20Landscaping`)]) {
      const page = await open(path);
      await page.evaluate(() => {
        for (const el of document.querySelectorAll("#reveal, #done, #done [hidden], #coLine, #coField, #filmPanel, #filmFs")) el.removeAttribute("hidden");
        for (const d of document.querySelectorAll("details")) d.open = true;
      });
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("a, button, summary, input:not([type=hidden]):not([type=checkbox]):not(.hp), label.consent")]
          .filter((el) => el.offsetParent && !el.closest("[aria-hidden=true]") && el.getBoundingClientRect().height < 44)
          .map((el) => el.outerHTML.slice(0, 80)),
      );
      expect(small, path).toEqual([]);
      await page.close();
    }
  }, 60_000);

  it("every word on a solid background has WCAG AA contrast: 4.5:1, or 3:1 for large text, buttons and the sticky bar included", async () => {
    for (const path of ["/", ...[...PAGES, ...VIEWS].map((p) => `/${p.id}`), ...["cold-email-page", ...[...LOOKS, ...TRADE_SITE].filter((v) => v.open).map((v) => v.id)].map((id) => `/${id}?co=Ridgeline%20Landscaping`)]) {
      const page = await open(path);
      // all of it that can show: the rest of the form, the step after it and a file's result, the FAQ answers, the sticky bar
      await page.evaluate(() => {
        for (const id of ["reveal", "done"]) document.getElementById(id)?.removeAttribute("hidden");
        for (const el of document.querySelectorAll("#done [hidden]")) el.removeAttribute("hidden");
        for (const d of document.querySelectorAll("details")) d.open = true;
        document.getElementById("sticky")?.classList.add("show");
        for (const id of ["filmPanel", "filmFs"]) document.getElementById(id)?.removeAttribute("hidden");
        document.getElementById("film")?.classList.add("open");
      });
      const low = await page.evaluate(() => {
        const rgba = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number).concat(1).slice(0, 4);
        const over = (top: number[], under: number[]) => [0, 1, 2].map((i) => top[i]! * top[3]! + under[i]! * (1 - top[3]!));
        const lum = (c: number[]) => c.reduce((sum, v, i) => sum + [0.2126, 0.7152, 0.0722][i]! * (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4), 0);
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
          if (![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) continue;
          if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
          // the backgrounds behind it, nearest first, down to the first solid one; a gradient is out of reach, as it is for Lighthouse
          const layers: number[][] = [];
          for (let at: HTMLElement | null = el; at && (layers.at(-1)?.[3] ?? 0) < 1; at = at.parentElement) {
            if (getComputedStyle(at).backgroundImage !== "none") break;
            layers.push(rgba(getComputedStyle(at).backgroundColor));
          }
          if ((layers.at(-1)?.[3] ?? 0) < 1) continue;
          const bg = layers.reduceRight<number[]>((under, top) => over(top, under), [255, 255, 255]);
          const s = getComputedStyle(el);
          const [hi, lo] = [lum(over(rgba(s.color), bg)), lum(bg)].sort((x, y) => y - x);
          const pt = parseFloat(s.fontSize) * 0.75;
          const ratio = (hi! + 0.05) / (lo! + 0.05);
          if (ratio < (pt >= 18 || (pt >= 14 && Number(s.fontWeight) >= 700) ? 3 : 4.5)) out.push(`${ratio.toFixed(2)}:1 ${s.fontSize} "${el.textContent!.trim().slice(0, 40)}"`);
        }
        return out;
      });
      expect(low, path).toEqual([]);
      await page.close();
    }
  }, 60_000);

  it("the Jobber table is rows to a screen reader, and still the same grid: two columns on a phone, three wide", async () => {
    for (const width of [390, 1280]) {
      const page = await open("/tree", dist, undefined, width);
      const rows = page.getByRole("table", { name: "Jobber compared with Quiet Accounts" }).getByRole("row");
      expect(await rows.count()).toBe(6);
      expect(await rows.nth(1).getByRole("rowheader").textContent()).toBe("Who does the work");
      expect(await rows.nth(1).getByRole("cell").allTextContents()).toEqual(["You do", "We do"]);
      // each cell sits under its column's header; the row header heads its line on a phone, and is its first column wide
      const [ha, hb, k, a, b] = await Promise.all([".h.a", ".h.b", ".k", ".a[role=cell]", ".b[role=cell]"].map((s) => box(page, `.vs ${s}`)));
      const line = width === 390 ? [[k.x, ha.x], [k.y + k.height, a.y]] : [[k.x + k.width, ha.x], [k.y, a.y]];
      for (const [at, want] of [[a.x, ha.x], [b.x, hb.x], [a.y, b.y], ...line]) expect(at).toBeCloseTo(want, 1);
      await page.close();
    }
  });

  it("without a link, the first press opens his note in place and sends nothing", async () => {
    const { posts, post } = recorder();
    const page = await open("/lawn", dist, post);
    expect(await page.isVisible("#reveal")).toBe(false);
    // no company, no note
    await page.click("#submit");
    expect(await page.getAttribute("#company", "aria-invalid")).toBe("true");
    expect(await page.isVisible("#reveal")).toBe(false);
    await page.fill("#company", "Green Acre Lawn");
    await page.press("#company", "Enter");
    await page.waitForSelector("#reveal", { state: "visible" });
    await page.waitForFunction(() => document.activeElement?.id === "revealH");
    expect(await page.locator("#reveal .nb").textContent()).toBe(exampleNote("lawn", "Green Acre Lawn", EXAMPLE_SIGNER).main);
    expect(posts).toHaveLength(0);
    await page.close();
  });

  it("a ?co= link opens his note on load, sends nothing, keeps a button on the first screen, and the second press sends the form to Netlify", async () => {
    const { posts, post } = recorder();
    const page = await open("/lawn?co=Ridgeline%20Landscaping%20Co.&src=k12&utm_source=instantly", dist, post);
    expect(await page.inputValue("#company")).toBe("Ridgeline Landscaping Co.");
    expect(await page.isVisible("#reveal")).toBe(true);
    expect(await page.textContent("#revealH")).toBe("Your first note, from Ridgeline Landscaping Co.");
    const note = () => page.locator("#reveal .nb").textContent();
    expect(await note()).toBe(exampleNote("lawn", "Ridgeline Landscaping Co.", EXAMPLE_SIGNER).main);
    expect(await page.locator("#reveal .nf").textContent()).toBe(exampleNote("lawn", "Ridgeline Landscaping Co.", EXAMPLE_SIGNER).foot);
    // opened without taking his focus or his place on the page
    expect(await page.evaluate(() => [scrollY, document.activeElement === document.body])).toEqual([0, true]);
    await firstScreen(page, "#reveal .btn");
    expect(posts).toHaveLength(0);
    // that button goes on to the first field he hasn't filled, and sends nothing
    await page.click("#reveal .btn");
    await page.waitForFunction(() => document.activeElement?.id === "first");
    await page.waitForFunction(() => {
      const r = document.querySelector("#first")!.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    });
    expect(posts).toHaveLength(0);
    await page.fill("#first", "Pat");
    expect(await note()).toBe(exampleNote("lawn", "Ridgeline Landscaping Co.", "Pat").main);
    expect(await page.isVisible("#sigHint")).toBe(false);
    // nothing goes without the cell and the box
    await page.click("#submit");
    expect(posts).toHaveLength(0);
    expect(await page.getAttribute("#cell", "aria-invalid")).toBe("true");
    await page.fill("#cell", "603-555-0122");
    await page.click('.sw[data-sw="housecall_pro"]');
    await page.click("#submit");
    expect(posts).toHaveLength(0);
    await page.check("#consent");
    await page.click("#submit");
    await page.waitForSelector("#done", { state: "visible" });
    expect(posts).toHaveLength(1);
    expect(posts[0].url()).toBe("http://site.test/");
    expect(posts[0].headers()["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(posts[0].postData()).toBe(netlifyBody({ company: "Ridgeline Landscaping Co.", first: "Pat", cell: "603-555-0122", software: "housecall_pro", trade: "lawn", offer: "monthly", ref: "page=lawn&src=k12&utm_source=instantly", website: "" }));
    expect(await page.textContent("#doneH")).toBe("Got it, Pat. One thing left.");
    expect(await page.isVisible('[data-step="housecall_pro"]')).toBe(true);
    expect(await page.isVisible('[data-step="jobber"]')).toBe(false);
    await page.close();
  });

  it("with a server, it posts JSON to {server}/start; when that fails, it offers a text to Jack with his company in it", async () => {
    const posts: Any[] = [];
    const page = await open("/lawn", withServer, async (r) => {
      posts.push(r.request());
      await r.fulfill({ status: 503, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: '{"error":"closed"}' });
    });
    await page.fill("#company", "Green Acre Lawn");
    await page.click("#submit");
    await page.fill("#first", "Pat");
    await page.fill("#cell", "603-555-0122");
    await page.check("#consent");
    await page.click("#submit");
    await page.waitForSelector("#formErr", { state: "visible" });
    expect(posts.map((p) => p.url())).toEqual(["https://api.example.test/start"]);
    expect(JSON.parse(posts[0].postData())).toEqual(signupBody({ company: "Green Acre Lawn", first: "Pat", cell: "603-555-0122", software: "jobber", trade: "lawn", offer: "monthly", ref: "page=lawn", website: "" }));
    expect(await page.textContent("#formErr")).toBe("That didn't go through. Text Jack at 603-340-7673.");
    expect(decodeURIComponent(await page.getAttribute("#smsJack", "href"))).toContain("Pat at Green Acre Lawn");
    expect(await page.isVisible("#form")).toBe(true);
    await page.close();
  });

  /** Moves a slider the way a drag does: a new value, then the input event. */
  const slide = (page: Any, sel: string, value: number) => page.locator(sel).evaluate((el: HTMLInputElement, v: string) => ((el.value = v), el.dispatchEvent(new Event("input"))), String(value));

  it("a one-pass link sets his company, his quote count and his average job, says the count is an estimate, and the form sends one_pass with the trade", async () => {
    const { posts, post } = recorder();
    const page = await open("/tree?co=Tall%20Pine%20Tree&q=420&j=3100&src=t07", dist, post);
    expect(await page.inputValue("#company")).toBe("Tall Pine Tree");
    expect(await page.locator("#reveal .nb").textContent()).toBe(exampleNote("tree", "Tall Pine Tree", EXAMPLE_SIGNER).main);
    await firstScreen(page, "#reveal .btn");
    // 420 quotes at Nelson Fence's 4 in 150 is 11 jobs, $34,100 at $3,100 each; he'd pay the $1,000 cap, 2.9% of it
    expect([await page.inputValue("#cN"), await page.inputValue("#cJ")]).toEqual(["420", "3100"]);
    expect(await page.textContent("#rJobs")).toBe("11");
    expect(await page.textContent("#rVal")).toBe("$34,100");
    expect(await page.textContent("#rPay")).toBe("$1,000");
    expect(await page.textContent("#rShare")).toBe("2.9%");
    expect(await page.isVisible("#estNote")).toBe(true);
    // both numbers are his now, not examples
    for (const eg of ["#cNEg", "#cJEg"]) expect(await page.isVisible(eg), eg).toBe(false);
    // under the cap, he pays $250 a job: 80 quotes is 2 jobs, $500 of $6,200
    await slide(page, "#cN", 80);
    expect([await page.textContent("#rJobs"), await page.textContent("#rPay"), await page.textContent("#rShare")]).toEqual(["2", "$500", "8.1%"]);
    expect(posts).toHaveLength(0);
    await page.fill("#first", "Ryan");
    await page.fill("#cell", "603-555-0123");
    await page.check("#consent");
    await page.click("#submit");
    await page.waitForSelector("#done", { state: "visible" });
    expect(posts.map((r) => r.postData())).toEqual([netlifyBody({ company: "Tall Pine Tree", first: "Ryan", cell: "603-555-0123", software: "jobber", trade: "tree", offer: "one_pass", ref: "page=tree&src=t07", website: "" })]);
    expect(await page.textContent("#done .lead")).toBe("Send us the exports and we'll have the first note ready for you to read within one business day.");
    expect(await page.textContent('[data-step="jobber"]')).toContain("Quotes Report");
    await page.close();
  });

  it("each slider is an example until he slides it; only a page that says so takes ?q= as his count, and ?j= only as his average job", async () => {
    let page = await open("/painting");
    expect(await page.isVisible("#estNote")).toBe(false);
    expect([await page.isVisible("#cNEg"), await page.isVisible("#cJEg")]).toEqual([true, true]);
    await slide(page, "#cJ", 6000);
    expect([await page.isVisible("#cNEg"), await page.isVisible("#cJEg")]).toEqual([true, false]);
    expect(await page.textContent("#oJ")).toBe("$6,000");
    await page.close();
    // /lawn's count is his customers, which no review count estimates: ?q= leaves it alone; ?j= still sets his average job
    page = await open("/lawn?q=900&j=700");
    expect([await page.inputValue("#cN"), await page.inputValue("#cJ")]).toEqual(["300", "700"]);
    expect([await page.isVisible("#cNEg"), await page.isVisible("#cJEg")]).toEqual([true, false]);
    await page.close();
    // a number past the slider's end stops at its end
    page = await open("/fence?q=99999");
    expect(await page.inputValue("#cN")).toBe("3000");
    await page.close();
    // /cleaning's job slider is what a regular pays a year, so a link's average cleaning leaves claims.ts's example alone
    for (const link of ["/cleaning?j=215", "/cleaning?co=Sparkle%20Home&q=900&j=190"]) {
      page = await open(link);
      expect([await page.inputValue("#cN"), await page.inputValue("#cJ")], link).toEqual(["80", "5580"]);
      expect([await page.textContent("#oJ"), await page.textContent("#rJobs"), await page.textContent("#rVal")], link).toEqual(["$5,580", "9", "$50,220"]);
      expect([await page.isVisible("#cNEg"), await page.isVisible("#cJEg")], link).toEqual([true, true]);
      await page.close();
    }
    // his own year still makes it his
    page = await open("/cleaning?j=215");
    await slide(page, "#cJ", 4000);
    expect([await page.textContent("#oJ"), await page.textContent("#rVal"), await page.isVisible("#cJEg")]).toEqual(["$4,000", "$36,000", false]);
    await page.close();
  });

  /* ------------------------------ his file, in the 'Got it' step ------------------------------ */

  const lawnFile: AuditFile = { name: "Visits Report.csv", text: visitsReport(lawnClients(), "newest") };
  const pat = { company: "Green Acre Lawn", first: "Pat", cell: "603-555-0122" };
  /** Signs up from the page's form, as he would, and waits for "Got it". */
  async function signUp(page: Any, who: { company: string; first: string; cell: string }) {
    await page.fill("#company", who.company);
    await page.click("#submit");
    await page.fill("#first", who.first);
    await page.fill("#cell", who.cell);
    await page.check("#consent");
    await page.click("#submit");
    await page.waitForSelector("#done", { state: "visible" });
  }
  const pick = (page: Any, files: AuditFile[]) => page.setInputFiles("#dzFile", files.map((f) => ({ name: f.name, mimeType: "text/csv", buffer: Buffer.from(f.text) })));
  /** A file dragged onto the zone and let go. */
  const drop = (page: Any, f: AuditFile) =>
    page.evaluate(([name, text]: string[]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text!], name!, { type: "text/csv" }));
      document.querySelector("#dz")!.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [f.name, f.text]);
  /** Every request the page makes from here on. */
  function watch(page: Any) {
    const seen: Any[] = [];
    page.on("request", (r: Any) => seen.push(r));
    return seen;
  }
  const lines = (page: Any, sel: string) => page.locator(`${sel} .dz-row`).evaluateAll((rows: HTMLElement[]) => rows.map((r) => [...r.children].map((c) => c.textContent)));

  it("a past-customers-only file is a result, right in 'Got it'; nothing leaves until he presses send, and then it goes with his sign-up", { timeout: 120_000 }, async () => {
    const { posts, post } = recorder();
    const page = await open("/lawn", withServer, async (r) => {
      posts.push(r.request());
      await r.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: '{"ok":true}' });
    });
    const seen = watch(page);
    await signUp(page, pat);
    expect(posts).toHaveLength(1);
    // the drop zone, and nothing of the result yet
    expect(await page.isVisible("#dz")).toBe(true);
    expect(await page.isVisible("#dzOut")).toBe(false);
    const from = seen.length;
    await pick(page, [lawnFile]);
    await page.waitForSelector("#dzOut", { state: "visible", timeout: 30_000 });
    // read on his screen: the audit's worker loaded with the file, and nothing else went anywhere
    expect(seen.slice(0, from).filter((r: Any) => /worker/.test(r.url()))).toEqual([]);
    expect(seen.slice(from).map((r: Any) => `${r.method()} ${r.url()}`)).toEqual([expect.stringMatching(/^GET http:\/\/site\.test\/assets\/worker-[\w-]+\.js$/)]);
    expect(posts).toHaveLength(1);
    // the same audit, his company and name in it; no quotes, and no "we couldn't find"
    const want = runAudit([lawnFile], { company: pat.company, signer: pat.first, trade: "lawn" });
    const past = want.past!;
    expect(await page.textContent("#dzFiles")).toBe("Read on your screen: Visits Report.csv");
    expect(await page.textContent("#rpHead")).toBe(`${past.people} past customers haven't been back.`);
    expect(await page.textContent("#rpPaid")).toBe(`In their last year with you, they paid $${past.paid!.toLocaleString("en-US")} between them.`);
    expect(await lines(page, "#rpWhen")).toEqual(past.when.map((w) => [w.label, `${w.people} ${w.people === 1 ? "person" : "people"}`, `$${w.paid!.toLocaleString("en-US")}`]));
    expect(await page.textContent("#rnTo")).toBe(`Note 1 · to ${past.note!.name}`);
    expect(await page.textContent("#rnBody")).toBe(past.note!.body);
    expect(await page.textContent("#rnBody")).toContain("Pat at Green Acre Lawn");
    expect(await page.textContent("#rnFoot")).toBe(past.note!.foot);
    for (const hidden of ["#rQuotes", "#dzNone", "#dzFwd", "#dzErr", "#dzBusy"]) expect(await page.isVisible(hidden), hidden).toBe(false);
    // what he reads keeps the words rules too
    expect(lintMarketing(await page.innerText("#done"))).toEqual([]);
    // the press sends it: a second /start with the same sign-up, the file, and the audit's own numbers
    expect(await page.textContent("#dzSendB")).toBe("Send this file");
    await page.click("#dzSendB");
    await page.waitForSelector("#dzSent", { state: "visible" });
    expect(posts).toHaveLength(2);
    expect(posts[1].url()).toBe("https://api.example.test/start");
    const s: Signup = { ...pat, software: "jobber", trade: "lawn", offer: "monthly", ref: "page=lawn", website: "" };
    expect(JSON.parse(posts[1].postData())).toEqual(withFile(s, [lawnFile], want));
    expect(await page.isVisible("#dzSend")).toBe(false);
    await page.close();
  });

  it("a Visits report whose mowing visits carry no amounts: who and when, and no money line or column; the send carries no figure", { timeout: 120_000 }, async () => {
    const { posts, post } = recorder();
    const page = await open("/lawn", withServer, post);
    await signUp(page, pat);
    const fixed: AuditFile = { name: "Visits Report.csv", text: visitsReport(lawnClients(), "newest", false) };
    await pick(page, [fixed]);
    await page.waitForSelector("#dzOut", { state: "visible", timeout: 30_000 });
    const want = runAudit([fixed], { company: pat.company, signer: pat.first, trade: "lawn" });
    expect(want.past!.paid).toBeUndefined();
    expect(await page.textContent("#rpHead")).toBe(`${want.past!.people} past customers haven't been back.`);
    expect(await page.isVisible("#rpPaid")).toBe(false);
    expect(await lines(page, "#rpWhen")).toEqual(want.past!.when.map((w) => [w.label, `${w.people} ${w.people === 1 ? "person" : "people"}`]));
    expect(await page.innerText("#rPast")).not.toContain("$");
    await page.click("#dzSendB");
    await page.waitForSelector("#dzSent", { state: "visible" });
    expect(JSON.parse(posts[1].postData()).audit.past).toEqual({ people: want.past!.people });
    await page.close();
  });

  it("without a server, a file dragged in shows its result and he's asked to forward the email as usual; nothing is sent", { timeout: 120_000 }, async () => {
    const { posts, post } = recorder();
    const page = await open("/lawn", dist, post, 1280);
    const seen = watch(page);
    await signUp(page, pat);
    const from = seen.length;
    await drop(page, lawnFile);
    await page.waitForSelector("#dzOut", { state: "visible", timeout: 30_000 });
    expect(await page.textContent("#rpHead")).toMatch(/^\d+ past customers haven't been back\.$/);
    expect(await page.isVisible("#rNote")).toBe(true);
    expect(await page.isVisible("#dzFwd")).toBe(true);
    expect(await page.isVisible("#dzSend")).toBe(false);
    // only the Netlify sign-up went anywhere; the file stayed on his screen
    expect(posts.map((r) => r.url())).toEqual(["http://site.test/"]);
    expect(seen.slice(from).map((r: Any) => r.method())).toEqual(["GET"]);
    await page.close();
  });

  it("on a one-pass page: his quotes nobody answered and his past customers, and the send carries the one-pass sign-up", { timeout: 120_000 }, async () => {
    const posts: Any[] = [];
    const page = await open("/tree", withServer, async (r) => {
      posts.push(r.request());
      await r.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: '{"ok":true}' });
    });
    const ryan = { company: "Tall Pine Tree", first: "Ryan", cell: "603-555-0123" };
    await signUp(page, ryan);
    // the Quotes report, then the Jobs report a moment later: the second joins the first
    const sample = generateSample({ trade: "tree", asOf: new Date().toISOString().slice(0, 10) }).files;
    const [quotes, jobs] = ["Quotes Report.csv", "Jobs Report.csv"].map((n) => sample.find((f) => f.name === n)!);
    await pick(page, [quotes!]);
    await page.waitForSelector("#rQuotes", { state: "visible", timeout: 30_000 });
    await pick(page, [jobs!]);
    await page.waitForFunction(() => document.querySelector("#dzFiles")!.textContent!.includes("Jobs Report.csv"), undefined, { timeout: 30_000 });
    await page.waitForSelector("#rPast", { state: "visible" });
    const want = runAudit([quotes!, jobs!], { company: ryan.company, signer: ryan.first, trade: "tree" });
    const money = (x: number) => `$${x.toLocaleString("en-US")}`;
    expect(await page.textContent("#dzFiles")).toBe("Read on your screen: Quotes Report.csv, Jobs Report.csv");
    expect(await page.innerText("#rQuotes .dz-h")).toBe(`${money(want.silent.value)} is sitting in ${want.silent.count.toLocaleString("en-US")} quotes nobody answered.`);
    expect(await lines(page, "#rqAges")).toEqual(want.byAge.filter((a) => a.count).map((a) => [a.label, a.count.toLocaleString("en-US"), money(a.value)]));
    expect(await page.textContent("#rpHead")).toBe(`${want.past!.people.toLocaleString("en-US")} past customers haven't been back.`);
    // the note is the quote's
    expect(await page.textContent("#rnBody")).toBe(want.hottest!.body);
    expect(await page.textContent("#dzSendB")).toBe("Send these files");
    await page.click("#dzSendB");
    await page.waitForSelector("#dzSent", { state: "visible" });
    const sent = JSON.parse(posts[1].postData());
    expect(sent).toMatchObject({ ...ryan, trade: "tree", offer: "one_pass", consent: true, audit: { quotes: want.quotes, silent: want.silent, perMonth: want.perMonth.value } });
    expect(sent.files.map((f: AuditFile) => f.name)).toEqual(["Quotes Report.csv", "Jobs Report.csv"]);
    await page.close();
  });

  it("a file with no one to write to says which export to send, and offers no send; a send that fails says what to do instead", { timeout: 120_000 }, async () => {
    let answer = 201;
    const posts: Any[] = [];
    const page = await open("/painting", withServer, async (r) => {
      posts.push(r.request());
      await r.fulfill({ status: answer, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: "{}" });
    });
    await signUp(page, { company: "Fresh Coat Co", first: "Joe", cell: "603-555-0126" });
    await pick(page, [{ name: "contacts.csv", text: "Name,Email\nAnn Lee,ann@gmail.com\n" }]);
    await page.waitForSelector("#dzNone", { state: "visible", timeout: 30_000 });
    expect(await page.textContent("#dzNone")).toBe("We couldn't find estimates nobody answered or past customers to write to in that file. It needs your estimates or your past jobs, with dates and your customers' emails, like Jobber's Quotes report or its Visits report.");
    for (const hidden of ["#rQuotes", "#rPast", "#rNote", "#dzSend", "#dzFwd"]) expect(await page.isVisible(hidden), hidden).toBe(false);
    // a real file, then the server turns it away
    const sample = generateSample({ trade: "painting", asOf: new Date().toISOString().slice(0, 10) }).files.find((f) => f.name === "Quotes Report.csv")!;
    await pick(page, [sample]);
    await page.waitForSelector("#dzSend", { state: "visible", timeout: 30_000 });
    expect(await page.innerText("#rQuotes .dz-h")).toMatch(/ estimates nobody answered\.$/);
    answer = 503;
    await page.click("#dzSendB");
    await page.waitForSelector("#dzSendErr", { state: "visible" });
    expect(await page.textContent("#dzSendErr")).toBe("That didn't go through. Forward the emails as above, or text Jack at 603-340-7673.");
    // the text to Jack has his company and name in it, and says what he tried: both files went, the one with no one in it too
    expect(decodeURIComponent(await page.getAttribute("#smsFile", "href"))).toBe("sms:+16033407673?&body=Hi Jack, it's Joe at Fresh Coat Co. I tried to send my files on your site and it didn't go through.");
    expect(await page.isVisible("#dzSend")).toBe(true);
    expect(posts).toHaveLength(2);
    await page.close();
  });

  it("a one-pass send with only the quotes, or only the past jobs, says which export is still to come; there's no email to forward only once both are in", { timeout: 120_000 }, async () => {
    for (const [path, first, then] of [["/tree", "Quotes Report.csv", "Jobs Report.csv"], ["/painting", "Jobs Report.csv", "Quotes Report.csv"]] as const) {
      const { posts, post } = recorder();
      const page = await open(path, withServer, post);
      await signUp(page, { company: "Tall Pine Tree", first: "Ryan", cell: "603-555-0123" });
      const sample = generateSample({ trade: path === "/tree" ? "tree" : "painting", asOf: new Date().toISOString().slice(0, 10) }).files;
      const file = (name: string) => sample.find((f) => f.name === name)!;
      await pick(page, [file(first)]);
      await page.waitForSelector("#dzSend", { state: "visible", timeout: 30_000 });
      expect(await page.textContent("#dzSendB")).toBe("Send this file");
      await page.click("#dzSendB");
      const need = first === "Quotes Report.csv" ? "past" : "quotes";
      await page.waitForSelector(`[data-need="${need}"]`, { state: "visible" });
      expect(await page.innerText("#dzOut"), path).not.toContain("no email to forward");
      expect(await page.isVisible("#dzSent")).toBe(false);
      expect(await page.textContent(`[data-need="${need}"]`)).toBe(
        need === "past"
          ? "Your quotes are in. For your past customers, drop your visits or jobs export here too, or forward it as above."
          : "Your past customers are in. For your estimates nobody answered, drop your estimates export here too, or forward it as above.",
      );
      // the other export, dropped here too: it goes on its own, and then it's all in
      await pick(page, [file(then)]);
      await page.waitForSelector("#dzSend", { state: "visible", timeout: 30_000 });
      expect(await page.textContent("#dzFiles")).toBe(`Read on your screen: ${then}`);
      await page.click("#dzSendB");
      await page.waitForSelector("#dzSent", { state: "visible" });
      expect(await page.isVisible("[data-need]")).toBe(false);
      expect(posts.slice(1).map((r: Any) => JSON.parse(r.postData()).files.map((f: AuditFile) => f.name))).toEqual([[first], [then]]);
      await page.close();
    }
  });

  it("a file picked while another is being sent is never dropped: its result keeps its send, and that send carries it", { timeout: 120_000 }, async () => {
    const posts: Any[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const page = await open("/tree", withServer, async (r) => {
      posts.push(r.request());
      // the first file's send waits until the second file's result is showing
      if (posts.length === 2) await gate;
      await r.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: '{"ok":true}' });
    });
    await signUp(page, { company: "Tall Pine Tree", first: "Ryan", cell: "603-555-0123" });
    const sample = generateSample({ trade: "tree", asOf: new Date().toISOString().slice(0, 10) }).files;
    const [quotes, jobs] = ["Quotes Report.csv", "Jobs Report.csv"].map((n) => sample.find((f) => f.name === n)!);
    await pick(page, [quotes!]);
    await page.waitForSelector("#dzSend", { state: "visible", timeout: 30_000 });
    await page.click("#dzSendB");
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>("#dzSendB")!.disabled);
    await pick(page, [jobs!]);
    await page.waitForFunction(() => document.querySelector("#dzFiles")!.textContent!.includes("Jobs Report.csv"), undefined, { timeout: 30_000 });
    release();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#dzSendB")!.disabled);
    // the quotes went; the newer result, with the Jobs report in it, still has its send and no "it's in"
    expect(await page.isVisible("#dzSend")).toBe(true);
    expect(await page.textContent("#dzSendB")).toBe("Send these files");
    for (const hidden of ["#dzSent", "[data-need]", "#dzSendErr"]) expect(await page.isVisible(hidden), hidden).toBe(false);
    await page.click("#dzSendB");
    await page.waitForSelector("#dzSent", { state: "visible" });
    expect(posts.slice(1).map((r: Any) => JSON.parse(r.postData()).files.map((f: AuditFile) => f.name))).toEqual([["Quotes Report.csv"], ["Quotes Report.csv", "Jobs Report.csv"]]);
    await page.close();
  });

  it("/cleaning signs him up as a cleaning shop on the monthly offer, asks how many regulars he can take, and reads his file as a cleaning shop's", { timeout: 120_000 }, async () => {
    const posts: Any[] = [];
    const page = await open("/cleaning?co=Sparkle%20Home&src=c03", withServer, async (r) => {
      posts.push(r.request());
      await r.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: '{"ok":true}' });
    });
    expect(await page.locator("#reveal .nb").textContent()).toBe(exampleNote("cleaning", "Sparkle Home", EXAMPLE_SIGNER).main);
    await firstScreen(page, "#reveal .btn");
    const kim = { company: "Sparkle Home", first: "Kim", cell: "603-555-0127" };
    await page.fill("#first", kim.first);
    await page.fill("#cell", kim.cell);
    await page.click('.sw[data-sw="other"]');
    await page.check("#consent");
    await page.click("#submit");
    await page.waitForSelector("#done", { state: "visible" });
    const s: Signup = { ...kim, software: "other", trade: "cleaning", offer: "monthly", ref: "page=cleaning&src=c03", website: "" };
    expect(JSON.parse(posts[0].postData())).toEqual(signupBody(s));
    expect(await page.textContent('[data-step="other"]')).toBe("Send any export of your clients with their last cleaning date and email. We'll text you where to click.");
    expect(await page.textContent("#done .pace")).toBe("One question we'll text you: how many new regulars can you take this month? We pace the notes to that.");
    // a booking export whose services can't say what the shop does: the page's trade does, so his note is about the cleaning
    const services = ["Booking ID,Customer Name,Email,Service,Frequency,Booking Date,Price,Status", ...Array.from({ length: 24 }, (_, i) => `${7000 + i},Ann Lee ${i % 4},ann${i % 4}@gmail.com,Weekly service,Every other week,2026-0${3 + Math.floor(i / 8)}-${10 + (i % 8)},160.00,Completed`)];
    const vague: AuditFile = { name: "Bookings.csv", text: services.join("\n") };
    await pick(page, [vague]);
    await page.waitForSelector("#dzOut", { state: "visible", timeout: 30_000 });
    const want = runAudit([vague], { company: kim.company, signer: kim.first, trade: "cleaning" });
    expect(want.trade).toBe("cleaning");
    expect(await page.textContent("#rnBody")).toBe(want.past!.note!.body);
    expect(want.past!.note!.body).toContain("Kim at Sparkle Home. We used to take care of the regular cleaning for you");
    await page.click("#dzSendB");
    await page.waitForSelector("#dzSent", { state: "visible" });
    expect(JSON.parse(posts[1].postData())).toEqual(withFile(s, [vague], want));
    await page.close();
  });

  it("a file that won't read, or an audit that won't load, doesn't stop the next file: it reads on its own", { timeout: 120_000 }, async () => {
    const page = await open("/lawn", withServer, (r) => r.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: '{"ok":true}' }));
    await signUp(page, pat);
    // a folder dragged onto the zone comes as a file that can't be read
    await page.evaluate(() => {
      const text = File.prototype.text;
      File.prototype.text = function (this: File) {
        return this.name === "Old jobs" ? Promise.reject(new DOMException("A folder", "NotReadableError")) : text.call(this);
      };
    });
    await drop(page, { name: "Old jobs", text: "" });
    await page.waitForSelector("#dzErr", { state: "visible" });
    await pick(page, [lawnFile]);
    await page.waitForSelector("#dzOut", { state: "visible", timeout: 30_000 });
    expect(await page.textContent("#dzFiles")).toBe("Read on your screen: Visits Report.csv");
    expect(await page.isVisible("#dzErr")).toBe(false);
    await page.close();
    // the audit's worker doesn't load the first time (he's gone offline a moment): the next try loads it again
    const again = await open("/lawn", withServer, (r) => r.fulfill({ status: 201, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: '{"ok":true}' }));
    let tries = 0;
    await again.route(/\/assets\/worker-[\w-]+\.js$/, (r: Any) => (tries++ ? r.fallback() : r.abort()));
    await signUp(again, pat);
    await pick(again, [lawnFile]);
    await again.waitForSelector("#dzErr", { state: "visible" });
    await pick(again, [lawnFile]);
    await again.waitForSelector("#dzOut", { state: "visible", timeout: 30_000 });
    expect(await again.textContent("#rpHead")).toMatch(/^\d+ past customers haven't been back\.$/);
    expect(tries).toBe(2);
    await again.close();
  });
  /* ------------------------------ the violet views: main-site/ and cold-email-page/ ------------------------------ */

  it("the violet pages: at 390x844 the headline, the promise and a button beside its price are on the first screen, with no sideways scroll", async () => {
    let page = await open("/main-site");
    await firstScreen(page, "#submit");
    await page.close();
    for (const path of ["/cold-email-page", "/cold-email-page?co=Ridgeline%20Landscaping%20Co."]) {
      page = await open(path);
      for (const sel of ["h1", ".promise"]) {
        const b = await box(page, sel);
        expect(b.y + b.height, `${path} ${sel}`).toBeLessThanOrEqual(844);
      }
      // the form's own button, or while it's below the fold, the bar that carries it and its price
      const submit = await box(page, "#submit");
      if (submit.y + submit.height > 844) {
        await page.waitForSelector("#sticky.show");
        const bar = await box(page, "#sticky .btn");
        expect(bar.y + bar.height, path).toBeLessThanOrEqual(844);
        expect(await page.textContent("#sticky span")).toBe("First 150 freethen $497/mo if you say yes");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.close();
    }
  });

  it("main-site: a ?co= link opens his note on load, the second press sends the form to Netlify, and ref names the page", async () => {
    const { posts, post } = recorder();
    const page = await open("/main-site?co=Green%20Acre%20Lawn&src=home", dist, post);
    expect(await page.isVisible("#reveal")).toBe(true);
    expect(await page.locator("#reveal .nb").textContent()).toBe(exampleNote("lawn", "Green Acre Lawn", EXAMPLE_SIGNER).main);
    await page.fill("#first", "Pat");
    await page.fill("#cell", "603-555-0122");
    await page.check("#consent");
    await page.click("#submit");
    await page.waitForSelector("#done", { state: "visible" });
    expect(posts.map((r) => r.postData())).toEqual([netlifyBody({ company: "Green Acre Lawn", first: "Pat", cell: "603-555-0122", software: "jobber", trade: "lawn", offer: "monthly", ref: "page=main-site&src=home", website: "" })]);
    await page.close();
  });

  it("main-site: without a link, the first press opens his note in place and sends nothing", async () => {
    const { posts, post } = recorder();
    const page = await open("/main-site", dist, post, 1280);
    expect(await page.isVisible("#reveal")).toBe(false);
    await page.fill("#company", "Green Acre Lawn");
    await page.click("#submit");
    await page.waitForSelector("#reveal", { state: "visible" });
    expect(await page.locator("#reveal .nb").textContent()).toBe(exampleNote("lawn", "Green Acre Lawn", EXAMPLE_SIGNER).main);
    expect(posts).toHaveLength(0);
    await page.close();
  });

  it("cold-email-page: his link's company is a line he can change; nothing sends without his name, cell and the box; then it goes to Netlify as this page", async () => {
    const { posts, post } = recorder();
    const page = await open("/cold-email-page?co=Ridgeline%20Landscaping%20Co.&src=showme&utm_source=instantly", dist, post);
    // his company, at the top and in the form, and not as a field to fill
    expect(await page.innerText(".chip")).toBe("For Ridgeline Landscaping Co.");
    expect(await page.isVisible("#coLine")).toBe(true);
    expect(await page.isVisible("#coField")).toBe(false);
    expect(await page.textContent("#coLine b")).toBe("Ridgeline Landscaping Co.");
    expect(await page.textContent(".consent span")).toBe(fillIn(MONTHLY.consent, "Ridgeline Landscaping Co.", ""));
    // every field shows from the start; opening the page sends nothing and takes no focus
    for (const id of ["#first", "#cell", "#consent", "#submit"]) expect(await page.isVisible(id), id).toBe(true);
    expect(await page.evaluate(() => [scrollY, document.activeElement === document.body])).toEqual([0, true]);
    // the note is one tap away, his company in it
    expect(await page.isVisible(".peek .nb")).toBe(false);
    await page.click(".peek summary");
    expect(await page.locator(".peek .nb").textContent()).toBe(exampleNote("lawn", "Ridgeline Landscaping Co.", EXAMPLE_SIGNER).main);
    await page.click("#submit");
    expect(posts).toHaveLength(0);
    expect(await page.getAttribute("#first", "aria-invalid")).toBe("true");
    await page.waitForFunction(() => document.activeElement?.id === "first");
    await page.fill("#first", "Pat");
    expect(await page.locator(".peek .nb").textContent()).toBe(exampleNote("lawn", "Ridgeline Landscaping Co.", "Pat").main);
    await page.fill("#cell", "603-555-0122");
    await page.click('.sw[data-sw="other"]');
    await page.click("#submit");
    expect(posts).toHaveLength(0);
    await page.check("#consent");
    await page.click("#submit");
    await page.waitForSelector("#done", { state: "visible" });
    expect(posts).toHaveLength(1);
    expect(posts[0].url()).toBe("http://site.test/");
    expect(posts[0].postData()).toBe(netlifyBody({ company: "Ridgeline Landscaping Co.", first: "Pat", cell: "603-555-0122", software: "other", trade: "lawn", offer: "monthly", ref: "page=cold-email-page&src=showme&utm_source=instantly", website: "" }));
    expect(await page.textContent("#doneH")).toBe("Got it, Pat. One thing left.");
    expect(await page.isVisible('[data-step="other"]')).toBe(true);
    expect(await page.isVisible("#sticky.show")).toBe(false);
    await page.close();
  });

  it("cold-email-page: Change opens his company to type; without a link the field shows, and the box says 'my company' until he types his", async () => {
    let page = await open("/cold-email-page?co=Ridgeline%20Landscaping");
    await page.click("#coChange");
    expect(await page.isVisible("#coField")).toBe(true);
    expect(await page.isVisible("#coLine")).toBe(false);
    await page.waitForFunction(() => document.activeElement?.id === "company");
    await page.fill("#company", "Ridgeline Lawn & Snow");
    expect(await page.textContent(".consent span")).toBe(fillIn(MONTHLY.consent, "Ridgeline Lawn & Snow", ""));
    expect(await page.innerText(".chip")).toBe("For Ridgeline Lawn & Snow");
    await page.close();
    page = await open("/cold-email-page");
    expect(await page.innerText(".chip")).toBe("For lawn and landscaping companies");
    expect(await page.isVisible("#coField")).toBe(true);
    expect(await page.isVisible("#coLine")).toBe(false);
    expect(await page.textContent(".consent span")).toBe(fillIn(MONTHLY.consent, "my company", ""));
    await page.fill("#company", "Green Acre Lawn");
    expect(await page.textContent(".consent span")).toBe(fillIn(MONTHLY.consent, "Green Acre Lawn", ""));
    await page.close();
  });

  it("cold-email-page: on a phone the bar carries the button while the form's own is out of sight, and steps aside when it shows; the bar's button goes to his first empty field", async () => {
    const page = await open("/cold-email-page?co=Ridgeline%20Landscaping");
    const showing = () => page.evaluate(() => document.querySelector("#sticky")!.classList.contains("show"));
    const submit = await box(page, "#submit");
    if (submit.y + submit.height > 844) await page.waitForFunction(() => document.querySelector("#sticky")!.classList.contains("show"));
    await page.locator("#submit").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !document.querySelector("#sticky")!.classList.contains("show"));
    await page.evaluate(() => scrollTo(0, 2600));
    await page.waitForFunction(() => document.querySelector("#sticky")!.classList.contains("show"));
    expect(await showing()).toBe(true);
    await page.click("#sticky .btn");
    await page.waitForFunction(() => document.activeElement?.id === "first");
    await page.close();
  });

  /* ------------------------------ the looks Jack tries live: green, paper, sky ------------------------------ */

  it("each look: at 390x844 the headline, the promise and a button beside its price are on the first screen, with no sideways scroll", async () => {
    for (const v of [...LOOKS, ...TRADE_SITE]) {
      const page = await open(v.open ? `/${v.id}?co=Ridgeline%20Landscaping` : `/${v.id}`);
      if (!v.open) await firstScreen(page, "#submit");
      else {
        for (const sel of ["h1", ".promise"]) {
          const b = await box(page, sel);
          expect(b.y + b.height, `${v.id} ${sel}`).toBeLessThanOrEqual(844);
        }
        const submit = await box(page, "#submit");
        if (submit.y + submit.height > 844) {
          await page.waitForSelector("#sticky.show");
          const bar = await box(page, "#sticky .btn");
          expect(bar.y + bar.height, v.id).toBeLessThanOrEqual(844);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth), v.id).toBeLessThanOrEqual(390);
      }
      await page.close();
    }
  }, 60_000);

  it("each look signs him up through Netlify as its own page: a main page on the second press, a cold email page on the first", async () => {
    for (const v of [...LOOKS, ...TRADE_SITE]) {
      const p = viewPage(v);
      const { posts, post } = recorder();
      const src = v.open ? "showme" : "home";
      const page = await open(`/${v.id}?co=Green%20Acre%20Lawn&src=${src}`, dist, post);
      if (!v.open) expect(await page.isVisible("#reveal"), v.id).toBe(true);
      await page.fill("#first", "Pat");
      await page.fill("#cell", "603-555-0122");
      await page.check("#consent");
      await page.click("#submit");
      await page.waitForSelector("#done", { state: "visible" });
      expect(posts.map((r) => r.postData()), v.id).toEqual([netlifyBody({ company: "Green Acre Lawn", first: "Pat", cell: "603-555-0122", software: "jobber", trade: p.trade, offer: p.words.offer, ref: `page=${v.id}&src=${src}`, website: "" })]);
      await page.close();
    }
  }, 60_000);

  /* ------------------------------ the film drop-down on the all-trades site ------------------------------ */

  /**
   * Playwright's Chromium plays no H.264 (Chrome and Safari do), so the page's play() and pause() are counted rather
   * than run (and `paused` follows them), and every path the page asks for is kept: what's checked is what it loads,
   * when, and what it asks the film to do. `refuse` makes the first play() fail the way a browser's can.
   */
  function filmPage(asked: string[], refuse?: "AbortError" | "NotAllowedError") {
    return async (page: Any) => {
      page.on("request", (r: Any) => asked.push(new URL(r.url()).pathname));
      await page.addInitScript((refuse: string | undefined) => {
        const w = window as Any;
        w.__film = { play: 0, pause: 0 };
        const paused = new WeakMap<HTMLMediaElement, boolean>();
        Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get() { return paused.get(this) ?? true; } });
        HTMLMediaElement.prototype.play = function () {
          w.__film.play++;
          if (refuse && w.__film.play === 1) return Promise.reject(new DOMException("refused", refuse));
          paused.set(this, false);
          return Promise.resolve();
        };
        HTMLMediaElement.prototype.pause = function () {
          w.__film.pause++;
          paused.set(this, true);
        };
        // where it's sent back to (opened again a while after he closed it: its beginning)
        Object.defineProperty(HTMLMediaElement.prototype, "currentTime", { configurable: true, get() { return 0; }, set(t: number) { w.__film.seek = t; } });
      }, refuse);
    };
  }
  const tradeOf = (id: string) => viewPage(TRADE_SITE.find((v) => v.id === id)!).trade;
  const film = (page: Any) =>
    page.evaluate(() => {
      const v = document.querySelector("video")!;
      const pp = document.querySelector<HTMLElement>("#filmPP")!;
      return { ...(window as Any).__film, open: document.querySelector("#filmK")!.getAttribute("aria-expanded"), src: new URL(v.src || "x:", location.href).pathname, poster: v.getAttribute("poster"), controls: v.controls, hidden: document.querySelector<HTMLElement>("#filmPanel")!.hidden, wait: pp.classList.contains("film-wait"), pressed: pp.getAttribute("aria-pressed"), label: pp.getAttribute("aria-label") };
    });
  /** One tap on the row, and where the third line, the row and the next section are on every frame for 0.9 s after it (with each frame's time). */
  const tapAndWatch = (page: Any, [aboveSel, belowSel] = [".lines p:last-of-type", "#money"]) =>
    page.evaluate(async ([aboveSel, belowSel]: string[]) => {
      const top = (s: string) => document.querySelector(s)!.getBoundingClientRect().top;
      const frame = () => ({ above: top(aboveSel!), row: top("#filmK"), below: top(belowSel!), at: performance.now() });
      // the frame before the tap, then every frame after it
      const frames = [frame()];
      const t0 = performance.now();
      document.querySelector<HTMLElement>("#filmK")!.click();
      while (performance.now() - t0 < 900) {
        frames.push(frame());
        await new Promise(requestAnimationFrame);
      }
      frames.push(frame());
      return { frames, panel: document.querySelector("#filmPanel")!.getBoundingClientRect().height };
    }, [aboveSel, belowSel]);
  /**
   * The page above held still on every frame, and the next section moved by `by`, in one direction, eased over many
   * frames. A frame that came late (a busy machine) is allowed its bigger step: only steps on time are held to a third.
   */
  function movedOnly(frames: { above: number; row: number; below: number; at: number }[], by: number) {
    const [first, last] = [frames[0]!, frames.at(-1)!];
    for (const f of frames) {
      expect(Math.abs(f.above - first.above)).toBeLessThan(0.5);
      expect(Math.abs(f.row - first.row)).toBeLessThan(0.5);
    }
    expect(last.below - first.below).toBeCloseTo(by, 0);
    const steps = frames.slice(1).map((f, i) => ({ d: f.below - frames[i]!.below, gap: f.at - frames[i]!.at }));
    for (const s of steps) expect(Math.sign(s.d) * Math.sign(by)).toBeGreaterThanOrEqual(0);
    // nothing below ever moves further than the film's height, and no frame on time takes more than a third of the move
    for (const f of frames) expect(Math.abs(f.below - first.below)).toBeLessThanOrEqual(Math.abs(by) + 0.5);
    const onTime = steps.slice(1).filter((s) => s.gap < 40);
    expect(Math.max(...onTime.map((s) => Math.abs(s.d)))).toBeLessThan(Math.abs(by) / 3);
    expect(steps.filter((s) => Math.abs(s.d) > 0.5).length).toBeGreaterThanOrEqual(8);
  }
  /** Put the row `y` px down his screen. */
  const rowAt = (page: Any, y: number) => page.evaluate((y: number) => scrollTo({ top: document.querySelector("#filmK")!.getBoundingClientRect().top + scrollY - y, behavior: "instant" }), y);

  it("the film: closed, nothing of it loads; a tap opens it in place, eased, the page above still, and it plays; another closes it the same way and it stops", async () => {
    for (const id of FILMED) {
      const trade = tradeOf(id);
      const asked: string[] = [];
      const page = await open(`/${id}`, dist, undefined, 1280, { motion: true, before: filmPage(asked) });
      await page.waitForLoadState("load");
      // he reads down to it: the row high enough on his screen for the film to open under it whole
      await rowAt(page, 160);
      await page.waitForTimeout(300);
      expect(asked.filter((p) => p.startsWith("/film/")), id).toEqual([]);
      expect(await film(page), id).toMatchObject({ open: "false", hidden: true, src: "", poster: null, play: 0 });

      const opened = await tapAndWatch(page);
      expect(opened.panel, id).toBeGreaterThan(400);
      movedOnly(opened.frames, opened.panel);
      // his own trade's film, the 1280 file on a 1x laptop, its first frame until it plays, playing muted and looped
      // with nothing of the browser's over it
      expect(await film(page), id).toMatchObject({ open: "true", hidden: false, src: `/film/${trade}/film-1280.mp4`, poster: `/film/${trade}/start-1280.jpg`, controls: false, play: 1, wait: false, pressed: "false" });
      expect(await page.evaluate(() => [document.querySelector("video")!.muted, document.querySelector("video")!.loop, document.querySelector("video")!.playsInline])).toEqual([true, true, true]);
      expect(asked.filter((p) => p.startsWith("/film/")).every((p) => p.startsWith(`/film/${trade}/`)), id).toBe(true);
      expect(asked, id).toContain(`/film/${trade}/start-1280.jpg`);
      // the film sits on the page's white, as wide as the section and no wider than the screen
      const v = await box(page, "video");
      expect(v.width / v.height).toBeCloseTo(1920 / 894, 1);
      expect(await page.evaluate(() => [document.documentElement.scrollWidth, getComputedStyle(document.querySelector(".lines")!).backgroundColor, getComputedStyle(document.body).backgroundColor])).toEqual([1280, "rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"]);

      const closed = await tapAndWatch(page);
      movedOnly(closed.frames, -opened.panel);
      await page.waitForFunction(() => document.querySelector<HTMLElement>("#filmPanel")!.hidden);
      expect(await film(page), id).toMatchObject({ open: "false", hidden: true, play: 1, pause: 1 });
      await page.close();
    }
  }, 60_000);

  it("the film: a tap on it (or its button) pauses it and another plays it; off his screen it rests, and comes back playing", async () => {
    const page = await open("/fence-site", dist, undefined, 1280, { motion: true, before: filmPage([]) });
    await page.waitForLoadState("load");
    await rowAt(page, 160);
    await page.click("#filmK");
    await page.waitForFunction(() => (window as Any).__film.play === 1);
    await page.click("video");
    expect(await film(page)).toMatchObject({ play: 1, pause: 1, pressed: "true" });
    // paused by him, it stays paused when it scrolls away and back
    await rowAt(page, -2000);
    await page.waitForTimeout(200);
    await rowAt(page, 160);
    await page.waitForTimeout(200);
    expect(await film(page)).toMatchObject({ play: 1, pressed: "true" });
    await page.locator("#filmPP").click();
    expect(await film(page)).toMatchObject({ play: 2, pressed: "false" });
    // playing, it rests off screen and plays again when it's back
    await rowAt(page, -2000);
    await page.waitForFunction(() => (window as Any).__film.pause === 2);
    await rowAt(page, 160);
    await page.waitForFunction(() => (window as Any).__film.play === 3);
    // the button is a real toggle a keyboard can reach
    await page.locator("#filmPP").focus();
    await page.keyboard.press("Enter");
    expect(await film(page)).toMatchObject({ pause: 3, pressed: "true" });
    await page.close();
  }, 30_000);

  it("the film: closed before it starts, it never counts as refused; a refusal waits for his play, with no browser controls", async () => {
    // closed 0.3 s after the tap, before it starts, and opened again: it plays, nothing of the browser's over it
    const quick = await open("/fence-site", dist, undefined, 1280, { motion: true, before: filmPage([], "AbortError") });
    await quick.waitForLoadState("load");
    await rowAt(quick, 160);
    await quick.click("#filmK");
    await quick.waitForTimeout(300);
    await quick.click("#filmK");
    await quick.waitForTimeout(700);
    await quick.click("#filmK");
    await quick.waitForTimeout(900);
    // its first play() was cut off (AbortError): that's no refusal, and the page waits for nothing
    expect(await film(quick)).toMatchObject({ open: "true", controls: false, wait: false, play: 1 });
    await quick.click("#filmK");
    await quick.waitForTimeout(700);
    await quick.click("#filmK");
    await quick.waitForTimeout(900);
    expect(await film(quick)).toMatchObject({ open: "true", controls: false, wait: false, play: 2, pressed: "false" });
    await quick.close();
    // a browser that won't start it: the one big play, and his tap plays it
    const refused = await open("/tree-site", dist, undefined, 1280, { motion: true, before: filmPage([], "NotAllowedError") });
    await refused.waitForLoadState("load");
    await rowAt(refused, 160);
    await refused.click("#filmK");
    await refused.waitForFunction(() => document.querySelector("#filmPP")!.classList.contains("film-wait"));
    // waiting, it's a play button and says so (not a pressed "Pause the film")
    expect(await film(refused)).toMatchObject({ controls: false, wait: true, pressed: null, label: "Play the film", play: 1 });
    await refused.locator("#filmPP").click();
    expect(await film(refused)).toMatchObject({ wait: false, pressed: "false", label: "Pause the film", play: 2 });
    await refused.close();
  }, 30_000);

  it("the film: opened low on his screen, the page scrolls just enough to show it whole, above the bar at the bottom", async () => {
    for (const width of [390, 1280]) {
      const page = await open("/cleaning-site", dist, undefined, width, { motion: true, before: filmPage([]) });
      await page.waitForLoadState("load");
      await rowAt(page, 844 - 150);
      await page.waitForTimeout(400);
      await page.click("#filmK");
      await page.waitForTimeout(1200);
      // the bar at the bottom of a phone's screen, when it's up (a wide screen has none)
      const bar = await page.evaluate(() => {
        const el = document.querySelector("#sticky")!;
        const r = el.getBoundingClientRect();
        return el.classList.contains("show") && r.height ? r.top : innerHeight;
      });
      const v = await box(page, "video");
      const row = await box(page, "#filmK");
      const cap = await box(page, "#filmCap");
      expect(v.y + v.height, `${width}`).toBeLessThanOrEqual(bar + 1);
      // its Example line with it, and the row under the page's floating header
      expect(cap.y + cap.height, `${width}`).toBeLessThanOrEqual(bar + 1);
      expect(row.y, `${width}`).toBeGreaterThanOrEqual((await box(page, ".top")).y + (await box(page, ".top")).height);
      // the bar at the bottom steps aside while the film is on his screen, and comes back once it's closed
      expect(await page.evaluate(() => document.querySelector("#sticky")!.classList.contains("show")), `${width}`).toBe(false);
      if (width === 390) {
        await page.click("#filmK");
        await page.waitForTimeout(800);
        expect(await page.evaluate(() => document.querySelector("#sticky")!.classList.contains("show"))).toBe(true);
      }
      await page.close();
    }
  }, 30_000);

  it("the film on a phone held sideways: the wide film, never taller than his screen under the header, whole, the bar out of its way, and full screen", async () => {
    for (const id of ["lawn-site", "fence-site"]) {
      const trade = tradeOf(id);
      const page = await open(`/${id}`, dist, undefined, 844, { motion: true, before: filmPage([]), height: 390 });
      await page.waitForLoadState("load");
      await rowAt(page, 200);
      await page.waitForTimeout(400);
      await page.click("#filmK");
      await page.waitForTimeout(1200);
      expect(await film(page), id).toMatchObject({ open: "true", src: `/film/${trade}/film-1280.mp4` });
      const top = await box(page, ".top");
      const v = await box(page, "video");
      expect(v.y, id).toBeGreaterThanOrEqual(top.y + top.height);
      expect(v.y + v.height, id).toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.querySelector("#sticky")!.classList.contains("show")), id).toBe(false);
      expect(await page.locator("#filmFs").isVisible(), id).toBe(true);
      await page.close();
    }
  }, 30_000);

  it("the film on a tablet held upright (768): the square cut, whose words read, as wide as 560", async () => {
    const page = await open("/tree-site", dist, undefined, 768, { motion: true, before: filmPage([]), height: 1024 });
    await page.waitForLoadState("load");
    await rowAt(page, 160);
    await page.click("#filmK");
    await page.waitForTimeout(900);
    expect(await film(page)).toMatchObject({ open: "true", src: "/film/tree/film-phone.mp4", poster: "/film/tree/start-phone.jpg" });
    const v = await box(page, "video");
    expect([Math.round(v.width), Math.round(v.height), Math.round(v.x + v.width / 2)]).toEqual([560, 560, 384]);
    expect(await page.locator("#filmFs").isHidden()).toBe(true);
    await page.close();
  }, 30_000);

  it("the film's one big play has its triangle in the middle of the button, at every width", async () => {
    for (const width of [390, 768, 1280]) {
      const page = await open("/cleaning-site", dist, undefined, width, { before: filmPage([]), height: width === 768 ? 1024 : 844 });
      await page.waitForLoadState("load");
      await rowAt(page, 160);
      await page.click("#filmK");
      await page.waitForFunction(() => document.querySelector("#filmPP")!.classList.contains("film-wait"));
      const pp = await box(page, "#filmPP");
      const icon = await page.evaluate(() => {
        const svg = [...document.querySelectorAll("#filmPP svg")].find((x) => getComputedStyle(x).display !== "none")!;
        const r = svg.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      // the triangle is drawn 2 px right of its box's middle (it looks centred): within 3 px of the button's middle
      expect(Math.abs(icon.x - (pp.x + pp.width / 2)), `${width}`).toBeLessThan(3);
      expect(Math.abs(icon.y - (pp.y + pp.height / 2)), `${width}`).toBeLessThan(3);
      expect([pp.width, pp.height], `${width}`).toEqual([68, 68]);
      await page.close();
    }
  }, 30_000);

  it("the film, opened again a while after he closed it, starts from its beginning", async () => {
    const page = await open("/fence-site", dist, undefined, 1280, { motion: true, before: filmPage([]) });
    await page.waitForLoadState("load");
    await rowAt(page, 160);
    await page.click("#filmK");
    await page.waitForFunction(() => (window as Any).__film.play === 1);
    await page.click("#filmK");
    await page.waitForTimeout(600);
    // straight back: it goes on where it was
    await page.click("#filmK");
    await page.waitForTimeout(700);
    expect((await film(page)).seek).toBeUndefined();
    await page.click("#filmK");
    await page.waitForTimeout(3300);
    await page.click("#filmK");
    await page.waitForTimeout(700);
    expect(await film(page)).toMatchObject({ open: "true", seek: 0 });
    await page.close();
  }, 30_000);

  it("the film on the cold email pages, where an owner from an email lands: closed, nothing loads; a tap opens his trade's film in place", async () => {
    for (const id of FILMED_COLD) {
      const trade = tradeOf(id);
      const asked: string[] = [];
      const page = await open(`/${id}?co=Ridgeline%20Landscaping`, dist, undefined, 1280, { motion: true, before: filmPage(asked) });
      await page.waitForLoadState("load");
      await rowAt(page, 160);
      await page.waitForTimeout(300);
      expect(asked.filter((p) => p.startsWith("/film/")), id).toEqual([]);
      const opened = await tapAndWatch(page, ["#next h2", "#results"]);
      expect(opened.panel, id).toBeGreaterThan(400);
      movedOnly(opened.frames, opened.panel);
      expect(await film(page), id).toMatchObject({ open: "true", src: `/film/${trade}/film-1280.mp4`, play: 1 });
      await page.close();
    }
  }, 60_000);

  it("the film: a real button a keyboard and a screen reader can use, and the focus stays on it", async () => {
    const page = await open("/lawn-site", dist, undefined, 1280, { motion: true, before: filmPage([]) });
    const row = page.getByRole("button", { name: /^Want to see it run\? \d+ seconds of it working for a landscaping company\. No sound\.$/ });
    expect(await row.getAttribute("aria-expanded")).toBe("false");
    await row.focus();
    await page.keyboard.press("Enter");
    expect(await row.getAttribute("aria-expanded")).toBe("true");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("filmK");
    // what it opens: the film, named for what it shows, and the example label read with it (and nothing else)
    const video = page.locator("#filmPanel video");
    await video.waitFor({ state: "visible" });
    expect(await video.getAttribute("aria-label")).toMatch(/^A \d+-second film, no sound: we write, in the owner's name, to a landscaping company's past customers/);
    const described = await page.evaluate((ids: string) => ids.split(" ").map((x) => document.getElementById(x)!.textContent).join(" "), (await video.getAttribute("aria-describedby"))!);
    expect(described).toBe("Example A made-up landscaping company. The notes and texts are what our software writes.");
    await page.keyboard.press("Space");
    expect(await row.getAttribute("aria-expanded")).toBe("false");
    await page.waitForFunction(() => document.querySelector<HTMLElement>("#filmPanel")!.hidden);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("filmK");
    await page.close();
  });

  it("the film on a phone, with reduced motion: it opens at once, the phone's square cut, edge to edge, and waits for his play", async () => {
    for (const id of FILMED) {
      const trade = tradeOf(id);
      const asked: string[] = [];
      const page = await open(`/${id}`, dist, undefined, 390, { before: filmPage(asked) });
      await page.waitForLoadState("load");
      expect(asked.filter((p) => p.startsWith("/film/")), id).toEqual([]);
      await page.locator("#filmK").scrollIntoViewIfNeeded();
      await rowAt(page, 120);
      const before = await box(page, "#filmK");
      await page.click("#filmK");
      // no animation: open on the next frame, the row where it was; the strong still waits under one big play
      expect(await film(page), id).toMatchObject({ open: "true", hidden: false, src: `/film/${trade}/film-phone.mp4`, poster: `/film/${trade}/poster-phone.jpg`, controls: false, play: 0, wait: true, pressed: null, label: "Play the film" });
      expect((await box(page, "#filmK")).y).toBeCloseTo(before.y, 0);
      const v = await box(page, "video");
      expect([v.x, v.width, v.height], id).toEqual([0, 390, 390]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), id).toBeLessThanOrEqual(390);
      expect(asked.filter((p) => p.startsWith("/film/")).every((p) => p.startsWith(`/film/${trade}/`)), id).toBe(true);
      // the play is in the middle of the film, a real tap target; a phone's cut is its screen's shape: no full screen
      const pp = await box(page, "#filmPP");
      expect(Math.abs(pp.x + pp.width / 2 - 195), id).toBeLessThan(1);
      expect(pp.height).toBeGreaterThanOrEqual(44);
      expect(await page.locator("#filmFs").isHidden()).toBe(true);
      await page.locator("#filmPP").click();
      expect(await film(page), id).toMatchObject({ play: 1, wait: false, pressed: "false" });
      await page.click("#filmK");
      await page.waitForFunction(() => document.querySelector<HTMLElement>("#filmPanel")!.hidden);
      expect(await film(page), id).toMatchObject({ open: "false", pause: 1 });
      await page.close();
    }
  }, 60_000);
});
