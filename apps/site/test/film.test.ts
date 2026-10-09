import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filmSeconds } from "../build/render.ts";
import { PAGES, TRADE_SITE, VIEWS, viewPage } from "../src/trades.ts";
import { blocks, count, FILMED, FILMED_COLD, rendered, textOf } from "./html.ts";

/**
 * The film (Oct 9, 2026): on the all-trades site's lawn, cleaning, fence and tree pages, the film of the service running
 * for a made-up company in that trade, a feature of the page under the three lines that say what we do. It plays where
 * it is, muted and looping, while he can see it; nothing of it loads until he's near it, nothing under it but full
 * screen (no caption: it shows how the service works, Jack, Oct 9), and it never reads as a second call to action. Their cold email pages (the link in each trade's "show me" reply, where an
 * owner from an email lands) have it too, at the end of "What happens after you press start". (How it plays, rests and
 * loads, in a browser: dist.test.ts.)
 */
const filmOf = (h: string) => /<div class="film" id="film">[\s\S]*?<\/figure>\n[\s\S]*?<\/div>\n<\/div>/.exec(h)?.[0] ?? "";

describe.each([...FILMED, ...FILMED_COLD])("/%s's film", (id) => {
  const p = viewPage(TRADE_SITE.find((v) => v.id === id)!);
  const h = rendered(`${id}/index.html`, p);
  const film = filmOf(h);
  const at = `/film/${p.trade}/`;
  const secs = Math.floor(filmSeconds(p.trade));

  it("is on the page once, in its flow: right under the three lines that say what we do, or on a cold email page under what happens after he presses start", () => {
    expect(film).not.toBe("");
    expect(count(h, 'class="film"')).toBe(1);
    if (FILMED.includes(id)) {
      const lines = blocks(h, /<section class="sec lines"/, "section")[0]!;
      expect(lines).toContain(film);
      expect(lines.indexOf(film)).toBeGreaterThan(lines.indexOf("is texted to you.</p>"));
    } else {
      const next = blocks(h, /<section class="sec" id="next"/, "section")[0]!;
      expect(next).toContain(film);
      expect(next.indexOf(film)).toBeGreaterThan(next.indexOf("</ol>"));
    }
    // no drop-down: no row to open, no panel to hide it, nothing between the page and the film
    expect(film).not.toMatch(/filmK|filmPanel|film-panel|aria-expanded|Want to see it run/);
    expect(film.slice(0, film.indexOf("<video"))).not.toMatch(/\shidden\b/);
    expect(film).toMatch(/^<div class="film" id="film">\n {2}<figure><div class="film-v"><video /);
  });

  it(`points at the ${p.trade} film, muted, looping and inline, and loads nothing of it until he's near it`, () => {
    const video = /<video\b[^>]*>/.exec(film)![0];
    expect(video).toContain(`data-film="${at}"`);
    expect(video).toContain('<video muted loop playsinline preload="none" width="1920" height="894"');
    // no src, no poster, no autoplay, no controls of the browser's: page.ts sets the cut for his screen when he's near it
    expect(video).not.toMatch(/\s(src|poster|autoplay|controls)\b/);
    expect(film).not.toMatch(/<source|<img|<iframe|url\(/);
    expect(count(h, "/film/")).toBe(1);
    // every cut the page can pick (the 1920 film, the 1280 one, the phone's square), each with its first frame (what
    // shows while it loads) and its poster (what waits for his play)
    for (const c of ["", "-1280", "-phone"])
      for (const f of [`film${c}.mp4`, `start${c}.jpg`, `poster${c}.jpg`]) expect(existsSync(new URL(`../public${at}${f}`, import.meta.url)), f).toBe(true);
  });

  it("tells a screen reader what it shows and how long it runs, the length read from the film itself", () => {
    // every cut runs the same length: the label's seconds hold whichever his screen gets
    for (const f of ["film-1280.mp4", "film-phone.mp4"]) expect(filmSeconds(p.trade, f), f).toBe(filmSeconds(p.trade));
    expect(textOf(/<video[^>]*aria-label="([^"]*)"/.exec(film)![1]!)).toBe(
      `A ${secs}-second film, no sound: we write, in the owner's name, to ${p.film!.to}, read every reply, and text the owner when one wants the work.`,
    );
  });

  it("has no caption under it: nothing between the film and full screen (Jack, Oct 9)", () => {
    expect(film).not.toMatch(/<figcaption|eg-pill|made-up|aria-describedby/i);
    expect(textOf(film)).not.toMatch(/example/i);
    expect(film).toMatch(/<\/span><\/button><\/div><\/figure>\n  <div class="film-more">/);
  });

  it("can be paused: a real toggle button over it, which says so (shown by the page's script, which plays the film)", () => {
    expect(film).toContain('<button type="button" class="film-pp" id="filmPP" aria-pressed="false" aria-label="Pause the film" hidden>');
    expect(film).toContain('<button type="button" class="film-fs" id="filmFs" hidden>');
    // full screen on a line of its own, not a paragraph: on the trade pages `.lines p` is the three lines' big type
    expect(film).toMatch(/<div class="film-more"><button [^>]*id="filmFs"/);
    expect(film).not.toMatch(/<p\b/);
  });

  it("is no film at all without scripts, not the browser's own empty player in its place", () => {
    expect(h).toContain(`<noscript><style>#film{display:none}</style></noscript>\n<div class="film" id="film">`);
    expect(count(h, "<noscript>")).toBe(1);
  });

  it("isn't a second call to action: not the button, not its words, no arrow, no link away", () => {
    expect(film).not.toMatch(/class="btn|<a\b|&rarr;|→/);
    expect(textOf(film)).not.toContain(p.words.button);
    const labels = [...h.matchAll(/<(?:a|button) class="btn"[^>]*>([\s\S]*?)<\/(?:a|button)>/g)].map((m) => textOf(m[1]!));
    expect(new Set(labels)).toEqual(new Set([`${p.words.button} →`]));
  });
});

describe("the film", () => {
  it("is only on the four filmed trades' pages and their cold email pages: not on painting's, the other looks or the tested pages", () => {
    for (const v of VIEWS) expect(count(rendered(`${v.id}/index.html`, viewPage(v)), 'id="film"'), v.id).toBe([...FILMED, ...FILMED_COLD].includes(v.id) ? 1 : 0);
    for (const p of PAGES) expect(count(rendered(`${p.id}/index.html`, p), 'id="film"'), p.id).toBe(0);
    expect(count(rendered("index.html"), 'id="film"')).toBe(0);
  });

  it("gets its square box from the stylesheet, by the same rule the page picks the square cut with", () => {
    const css = readFileSync(new URL("../src/trade.css", import.meta.url), "utf8");
    const js = readFileSync(new URL("../src/page.ts", import.meta.url), "utf8");
    const rule = (q: string) => q.replace(/\s+/g, "");
    const square = /@media ([^{]+)\{\s*\.film video\{aspect-ratio:1\/1[;}]/.exec(css)?.[1];
    const phone = /const phone = matchMedia\("([^"]+)"\)/.exec(js)?.[1];
    expect(square).toBeDefined();
    expect(rule(square!)).toBe(rule(phone!));
    // the box's shape is the stylesheet's from the start, never a class the script adds later
    expect(css).not.toContain("cut-phone");
    expect(js).not.toContain("cut-phone");
  });

  it("reads each film's length from its MP4's movie header", () => {
    for (const trade of ["lawn", "cleaning", "fence", "tree"]) {
      const s = filmSeconds(trade);
      expect(s, trade).toBeGreaterThan(15);
      expect(s, trade).toBeLessThan(60);
    }
  });
});
