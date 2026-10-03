import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLAIMS } from "@qa/engine";
import { exampleHandoff } from "../build/examples.ts";
import { pageFor } from "../build/render.ts";
import { NETLIFY_FIELDS } from "../src/form.ts";
import { LABEL, LOOKS, PAGES, TRADE_SITE, viewPage } from "../src/trades.ts";
import { blocks, rendered, textOf, visibleText, wordRules } from "./html.ts";

/**
 * The looks Jack wants to try live (Oct 3, 2026): green, paper (explee-style) and sky (every trade), and the all-trades
 * site, a page per trade in a look of its own with its cold email page. Each view is a
 * trade page's words in a new look, at a folder of its own. Whatever the look, the brief's rules hold: the words rules,
 * one action, every result labeled, outside numbers with their sources, the same answers as the trade's own page, the
 * sign-up named for the page it came from.
 */
const LOGO: Record<string, string> = {
  green: "logo-mark-green.svg", paper: "logo-mark-ink.svg", sky: "logo-mark-sky.svg",
  lawn: "logo-mark-green.svg", cleaning: "logo-mark-aqua.svg", fence: "logo-mark-cedar.svg", tree: "logo-mark-tree.svg", painting: "logo-mark-paint.svg",
};
const OG: Record<string, string> = {
  green: "og-green.png", paper: "og-paper.png", sky: "og-sky.png",
  lawn: "og-green.png", cleaning: "og-cleaning.png", fence: "og-fence.png", tree: "og-tree.png", painting: "og-painting.png",
};
const lookOf = (id: string) => id.split("-")[0]!;
/** Every FAQ, question to answer. */
const faq = (h: string) => new Map([...h.matchAll(/<details><summary>([^<]*)<\/summary><div class="a">([\s\S]*?)<\/div><\/details>/g)].map((m) => [textOf(m[1]!), textOf(m[2]!)]));
const reveal = (h: string) => h.slice(h.indexOf('<div class="reveal"'), h.indexOf('<input class="hp"'));

describe.each([...LOOKS, ...TRADE_SITE].map((v) => [v.id, v] as const))("/%s", (id, v) => {
  const p = viewPage(v);
  const w = p.words;
  const look = lookOf(id);
  const h = rendered(`${id}/index.html`, p);
  const own = PAGES.find((x) => x.id === v.words)!;
  const theirs = rendered(`${own.id}/index.html`, own);

  it("is built from its own folder, as its own page", () => {
    expect(pageFor(`/${id}/index.html`)?.id).toBe(id);
    expect(existsSync(new URL(`../${id}/index.html`, import.meta.url))).toBe(true);
  });

  it("keeps the words rules, and the footer", () => wordRules(h, w.offer));

  it("has one action: every button says the same thing, sits beside its price and leads to the one form", () => {
    const labels = [...h.matchAll(/<(?:a|button) class="btn"[^>]*>([\s\S]*?)<\/(?:a|button)>/g)].map((m) => textOf(m[1]!));
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(new Set(labels)).toEqual(new Set([`${w.button} →`]));
    for (const href of h.matchAll(/<a class="btn" href="([^"]*)"/g)) expect(href[1]).toBe("#start");
    for (const cta of blocks(h, /<div class="cta/, "div")) expect(textOf(cta)).toBe(`${w.button} → ${w.priceLine}`);
    expect(textOf(blocks(h, /<div class="sticky"/, "a")[0]!)).toBe(`${w.sticky.join(" ")} ${w.button} →`);
    expect([...h.matchAll(/<form\b(?![^>]*\bhidden\b)/g)]).toHaveLength(1);
    expect(h).not.toMatch(/<nav\b/);
  });

  it(`wears the ${look} mark, and its own link picture at full size`, () => {
    const header = blocks(h, /<header/, "header")[0]!;
    expect(header).not.toMatch(/btn/);
    expect(header).toContain(`<img src="/src/assets/${LOGO[look]}"`);
    expect(h).toContain(`<link rel="icon" href="/src/assets/${LOGO[look]}" type="image/svg+xml">`);
    expect(h).not.toContain("logo-mark-violet");
    expect(h).toContain(`<meta property="og:image" content="https://quietaccounts.com/${OG[look]}">`);
    const png = readFileSync(new URL(`../public/${OG[look]}`, import.meta.url));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it("signs him up as itself: its own name in ref, its trade and offer, and the static copy Netlify finds", () => {
    expect(h).toContain(`data-page="${id}" data-trade="${p.trade}" data-offer="${w.offer}"`);
    expect(h).toContain(`<form name="start" data-netlify="true" netlify-honeypot="website" hidden>${NETLIFY_FIELDS.map((f) => `<input name="${f}">`).join("")}</form>`);
    expect(h).toContain('<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">');
  });

  it("labels every result, in the trade page's order, and says nothing about who owns Dow's", () => {
    const cards = blocks(h, /<article class="card">/, "article");
    expect(cards.map((c) => textOf(/<h3>(.*?)<\/h3>/.exec(c)![1]!))).toEqual(p.proofs.map((x) => x.shop));
    for (const c of cards) expect(textOf(c)).toContain(LABEL);
    expect(visibleText(h)).not.toMatch(/\buncle\b|owned by Jack/i);
  });

  it("shows an outside number only with its source beside it", () => {
    const text = visibleText(h);
    for (const c of CLAIMS) {
      let at = text.indexOf(c.text);
      while (at > -1) {
        expect(text.slice(at, at + 900), c.id).toContain(c.source);
        at = text.indexOf(c.text, at + 1);
      }
    }
  });

  it("answers every question the trade's own page answers, in its words", () => {
    const mine = faq(h);
    const want = faq(theirs);
    expect(want.size).toBeGreaterThanOrEqual(8);
    for (const [q, a] of want) expect(mine.get(q), q).toBe(a);
  });

  it("shows the text he'd get as the engine writes it, labeled an example", () => {
    expect(h).toContain("Example &middot; a text to you");
    expect(textOf(blocks(h, /<div class="sms">/, "p")[0]!)).toBe(textOf(`Quiet Accounts · 9:12 AM ${exampleHandoff(p.trade)}`));
  });

  if (v.open) {
    it("opens on the form, his link's company a line he can change, the note one tap away, and stays out of search", () => {
      expect(h).toContain(" data-open ");
      expect(h).toContain('<div class="reveal" id="reveal">');
      expect(h).toContain('<div class="co-line" id="coLine" hidden>');
      expect(blocks(h, /<details class="peek">/, "details")).toHaveLength(1);
      expect(h).toContain('<meta name="robots" content="noindex">');
    });
  } else {
    it("opens with one field and the button; the rest waits in the trade page's own reveal", () => {
      expect(h).not.toContain(" data-open ");
      expect(h).toContain('<div class="reveal" id="reveal" hidden>');
      expect(reveal(h).replaceAll(`data-page="${id}"`, "")).toBe(reveal(theirs).replaceAll(`data-page="${own.id}"`, ""));
      expect(h).not.toContain("noindex");
    });
  }
});
