import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filmSeconds } from "../build/render.ts";
import { PAGES, TRADE_SITE, VIEWS, viewPage } from "../src/trades.ts";
import { blocks, count, FILMED, FILMED_COLD, rendered, textOf } from "./html.ts";

/**
 * The film drop-down (Oct 8, 2026): on the all-trades site's lawn, cleaning, fence and tree pages, a quiet row under the
 * three lines that say what we do, which opens the film of the service running for a made-up company in that trade.
 * Closed by default, nothing of it loads until he opens it, it's labeled an example, and it never reads as a second
 * call to action. Their cold email pages (the link in each trade's "show me" reply, where an owner from an email
 * lands) have it too, at the end of "What happens after you press start". (How it opens and closes, in a browser:
 * dist.test.ts.)
 */
const filmOf = (h: string) => /<div class="film" id="film">[\s\S]*?<\/figure><\/div>\n<\/div>/.exec(h)?.[0] ?? "";

describe.each([...FILMED, ...FILMED_COLD])("/%s's film", (id) => {
  const p = viewPage(TRADE_SITE.find((v) => v.id === id)!);
  const h = rendered(`${id}/index.html`, p);
  const film = filmOf(h);
  const at = `/film/${p.trade}/`;
  const secs = Math.floor(filmSeconds(p.trade));

  it("is on the page once, closed: right under the three lines that say what we do, or on a cold email page under what happens after he presses start", () => {
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
    // a real button that says it's closed and what it opens, and the film's panel hidden behind it
    expect(film).toContain('<button type="button" class="film-k" id="filmK" aria-expanded="false" aria-controls="filmPanel">');
    expect(film).toContain('<div class="film-panel" id="filmPanel" hidden>');
    expect(film).not.toMatch(/class="film open/);
  });

  it(`points at the ${p.trade} film, and loads nothing of it until he opens it`, () => {
    const video = /<video\b[^>]*>/.exec(film)![0];
    expect(video).toContain(`data-film="${at}"`);
    expect(video).toContain('<video muted loop playsinline preload="none" width="1920" height="894"');
    // no src, no poster, no autoplay, no controls of the browser's: page.ts sets the cut for his screen when he opens it
    expect(video).not.toMatch(/\s(src|poster|autoplay|controls)\b/);
    expect(film).not.toMatch(/<source|<img|<iframe|url\(/);
    expect(count(h, "/film/")).toBe(1);
    // every cut the page can pick (the 1920 film, the 1280 one, the phone's square), each with its first frame (what
    // shows while it loads) and its poster (what waits for his play)
    for (const c of ["", "-1280", "-phone"])
      for (const f of [`film${c}.mp4`, `start${c}.jpg`, `poster${c}.jpg`]) expect(existsSync(new URL(`../public${at}${f}`, import.meta.url)), f).toBe(true);
  });

  it("says in plain words what he'll see and how long it runs, the length read from the film itself", () => {
    const row = /<button[^>]*id="filmK"[^>]*>([\s\S]*?)<\/button>/.exec(film)![1]!;
    expect(textOf(row)).toBe(`Want to see it run? ${secs} seconds of it working for a ${p.film!.kind} company. No sound.`);
    // every cut runs the same length: the row's seconds hold whichever his screen gets
    for (const f of ["film-1280.mp4", "film-phone.mp4"]) expect(filmSeconds(p.trade, f), f).toBe(filmSeconds(p.trade));
    // a screen reader hears what the film shows
    expect(textOf(/<video[^>]*aria-label="([^"]*)"/.exec(film)![1]!)).toBe(
      `A ${secs}-second film, no sound: we write, in the owner's name, to ${p.film!.to}, read every reply, and text the owner when one wants the work.`,
    );
  });

  it("labels the film an example, right under it, as everything made up on the page is", () => {
    const cap = /<figcaption id="filmCap">([\s\S]*?)<\/figcaption>/.exec(film)![1]!;
    expect(cap.startsWith('<span class="eg-pill" id="filmEg">Example</span>')).toBe(true);
    expect(textOf(cap)).toBe(`Example A made-up ${p.film!.kind} company. The notes and texts are what our software writes.`);
    // what a screen reader hears with it: the label and the sentence, and nothing else (no button's words)
    expect(film).toContain('aria-describedby="filmEg filmCapT"');
    expect(textOf(/<span id="filmCapT">([\s\S]*?)<\/span>/.exec(film)![1]!)).toBe(`A made-up ${p.film!.kind} company. The notes and texts are what our software writes.`);
    expect(cap).not.toMatch(/<button/);
  });

  it("can be paused: a real toggle button over it, which says so", () => {
    expect(film).toContain('<button type="button" class="film-pp" id="filmPP" aria-pressed="false" aria-label="Pause the film" hidden>');
  });

  it("isn't a second call to action: not the button, not its words, no arrow, no link away", () => {
    expect(film).not.toMatch(/class="btn|<a\b|&rarr;|→/);
    expect(textOf(film)).not.toContain(p.words.button);
    const labels = [...h.matchAll(/<(?:a|button) class="btn"[^>]*>([\s\S]*?)<\/(?:a|button)>/g)].map((m) => textOf(m[1]!));
    expect(new Set(labels)).toEqual(new Set([`${p.words.button} →`]));
  });
});

describe("the film drop-down", () => {
  it("is only on the four filmed trades' pages and their cold email pages: not on painting's, the other looks or the tested pages", () => {
    for (const v of VIEWS) expect(count(rendered(`${v.id}/index.html`, viewPage(v)), 'id="film"'), v.id).toBe([...FILMED, ...FILMED_COLD].includes(v.id) ? 1 : 0);
    for (const p of PAGES) expect(count(rendered(`${p.id}/index.html`, p), 'id="film"'), p.id).toBe(0);
    expect(count(rendered("index.html"), 'id="film"')).toBe(0);
  });

  it("reads each film's length from its MP4's movie header", () => {
    for (const trade of ["lawn", "cleaning", "fence", "tree"]) {
      const s = filmSeconds(trade);
      expect(s, trade).toBeGreaterThan(15);
      expect(s, trade).toBeLessThan(60);
    }
  });
});
