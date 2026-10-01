import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exampleNote } from "../build/examples.ts";
import { EXAMPLE_SIGNER } from "../build/render.ts";
import { netlifyBody, signupBody } from "../src/form.ts";
import { PAGES } from "../src/trades.ts";

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
    expect(built).toEqual(expect.arrayContaining(["index.html", "lawn/index.html", "tree/index.html", "painting/index.html", "fence/index.html"]));
    for (const shot of ["tom-text", "david-text", "ryan-text"]) expect(built.some((f) => f.startsWith(`assets/${shot}`) && f.endsWith(".jpg")), shot).toBe(true);
    const zipped = unzip(`${dist}.zip`);
    expect([...zipped.keys()].sort()).toEqual([...built].sort());
    for (const f of built) expect(zipped.get(f)!.equals(readFileSync(join(dist, f))), f).toBe(true);
  });

  it("ships no engine and no audit worker to the browser: the notes were written at build time", () => {
    const js = files(dist).filter((f) => extname(f) === ".js");
    expect(js).toHaveLength(1);
    const code = readFileSync(join(dist, js[0]!), "utf8");
    expect(code.length).toBeLessThan(12_000);
    expect(code).not.toMatch(/lapsed_regular|We used to take care|libphonenumber|Worker\(/);
    expect(readFileSync(join(dist, "index.html"), "utf8")).not.toContain("<script");
  });
});

/* ------------------------------ in a real browser, where there is one ------------------------------ */

// The machine's own Playwright, if it has one; its types aren't part of this repo.
type Any = any;
const playwright: Any = await import(join(dirname(process.execPath), "../lib/node_modules/playwright/index.mjs")).catch(() => undefined);
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };

describe.runIf(playwright)("in Chromium", () => {
  let browser: Any;
  beforeAll(async () => void (browser = await playwright.chromium.launch()), 60_000);
  afterAll(async () => browser?.close());

  /**
   * The built site at http://site.test, offline: fonts fall back, and every POST is answered by `post`. With reduced
   * motion, as the page honors it, so a click never waits out a smooth scroll.
   */
  async function open(path: string, from = dist, post: (r: Any) => Promise<void> = (r) => r.fulfill({ status: 200, body: "" }), width = 390) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
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
    for (const path of ["/", ...PAGES.map((p) => `/${p.id}`)]) {
      const page = await open(path);
      await page.evaluate(() => document.querySelector("#reveal")?.removeAttribute("hidden"));
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("a, button, summary, input:not([type=hidden]):not([type=checkbox]):not(.hp), label.consent")]
          .filter((el) => el.offsetParent && !el.closest("[aria-hidden=true]") && el.getBoundingClientRect().height < 44)
          .map((el) => el.outerHTML.slice(0, 80)),
      );
      expect(small, path).toEqual([]);
      await page.close();
    }
  });

  it("every word on a solid background has WCAG AA contrast: 4.5:1, or 3:1 for large text, buttons and the sticky bar included", async () => {
    for (const path of ["/", ...PAGES.map((p) => `/${p.id}`)]) {
      const page = await open(path);
      // all of it that can show: the rest of the form, the step after it, the FAQ answers, the sticky bar
      await page.evaluate(() => {
        for (const id of ["reveal", "done"]) document.getElementById(id)?.removeAttribute("hidden");
        for (const d of document.querySelectorAll("details")) d.open = true;
        document.getElementById("sticky")?.classList.add("show");
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
  });

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

  it("each slider is an example until he slides it, and only a page that says so takes ?q= as his count", async () => {
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
  });
});
