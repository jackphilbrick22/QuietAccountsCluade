// Mockups of the film on the all-trades site, as a visitor sees it (Oct 9, 2026). For each filmed trade's page, at
// 1280, 768 (a tablet held upright: the square cut) and 390 wide: the screen with the three lines and the film playing
// under them; and at 1280 the whole page, to show its place in the page. Its cold email pages too
// (`lawn-cold-email-page …`), when asked for.
//
//   pnpm build:site && node apps/site/build/film-shots.mjs <out-dir> [lawn-site cleaning-site ...]
//
// It serves apps/site/dist offline (fonts fall back) with the machine's own Playwright Chromium. That Chromium has no
// H.264, so play() is made to resolve, as it does in Chrome and Safari, and the shots show a moment of the film as it
// plays (its poster still, 22 s: the replies, our answer and the hand-off on his phone) where the page would show the
// film itself. At 390 and 768 that's the square cut, at 1280 the film.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const [out, ...asked] = process.argv.slice(2);
if (!out) throw new Error("Usage: node apps/site/build/film-shots.mjs <out-dir> [page ...]");
const pages = asked.length ? asked : ["lawn-site", "cleaning-site", "fence-site", "tree-site"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4" };
const pw = await import(join(dirname(process.execPath), "../lib/node_modules/playwright/index.mjs"));

mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch();
for (const id of pages) {
  for (const [width, height] of [[1280, 900], [768, 1024], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = () => Promise.resolve();
    });
    await page.route(/^https?:\/\/(?!site\.test)/, (r) => r.abort());
    await page.route("http://site.test/**", (r) => {
      let file = join(dist, decodeURIComponent(new URL(r.request().url()).pathname));
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(file, "index.html");
      return existsSync(file) ? r.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] }) : r.fulfill({ status: 404, body: "" });
    });
    await page.goto(`http://site.test/${id}/${id.includes("cold") ? "?co=Ridgeline%20Landscaping" : ""}`);
    await page.evaluate(() => document.fonts.ready);
    // the film's top a little under the middle of his screen, the lines (or the steps) above it
    const filmAt = () => page.evaluate(() => document.querySelector("#film video").getBoundingClientRect().top + scrollY);
    await page.evaluate((top) => scrollTo({ top, behavior: "instant" }), (await filmAt()) - Math.round(height * (width > 600 ? 0.36 : 0.42)));
    await page.waitForFunction(() => document.querySelector("#film video").getAttribute("poster"));
    // a moment of the film as it plays, not its first frame (an empty window) as it loads
    await page.evaluate(() => {
      const v = document.querySelector("#film video");
      v.poster = v.poster.replace("/start", "/poster");
    });
    await page.waitForTimeout(400);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(out, `${id}-${width}.png`) });
    if (width === 1280) {
      // the sticky header and the phone bar would repeat down a full-page shot
      await page.addStyleTag({ content: ".top,.sticky{visibility:hidden!important}" });
      await page.screenshot({ path: join(out, `${id}-${width}-page.png`), fullPage: true });
    }
    await page.close();
    console.log(id, width);
  }
}
await browser.close();
