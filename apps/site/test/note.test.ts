import { describe, expect, it } from "vitest";
import { EXAMPLE_SIGNER } from "../build/render.ts";
import { exampleHandoff, exampleNote, SLOTS } from "../build/examples.ts";
import { fillIn } from "../src/note.ts";
import { PAGES } from "../src/trades.ts";
import { blocks, rendered, unescape } from "./html.ts";

/**
 * The note and the owner's text on each page are the engine's own words, never hand-copied: what the page shows, and
 * what it shows once he types his company and name, is what the engine writes for that company and signer.
 */
describe.each(PAGES.map((p) => [p.id, p] as const))("the %s page's note", (_id, p) => {
  const html = rendered(`${p.id}/index.html`, p);
  const parts = (cls: string) => blocks(html, new RegExp(`<div class="${cls}" data-template="`), "div");
  const template = (block: string) => unescape(/data-template="([^"]*)"/.exec(block)![1]!);
  const shown = (block: string) => unescape(block.slice(block.indexOf(">") + 1, -"</div>".length));

  it("is the engine's first note to the page's example customer, in the hero and in how it works", () => {
    const engine = exampleNote(p.trade, p.companyExample, EXAMPLE_SIGNER);
    expect(parts("nb")).toHaveLength(2);
    for (const b of parts("nb")) expect(shown(b)).toBe(engine.main);
    for (const b of parts("nf")) expect(shown(b)).toBe(engine.foot);
    // every note carries the postal address (his, once he gives it to us)
    expect(engine.foot).toContain("[your business address]");
    // a one pass writes to old quotes that never booked; it says so in the note's footer
    if (p.words.offer === "one_pass") expect(engine.foot).toContain("You're getting this sales follow-up because you asked us for a price.");
    // A6 cuts this line from the engine; the pages never show it meanwhile
    expect(engine.main).not.toMatch(/on us for not following up/);
  });

  it("filled in with his company and first name, it's what the engine writes for them", () => {
    const main = template(parts("nb")[0]!);
    const foot = template(parts("nf")[0]!);
    expect({ main, foot }).toEqual(exampleNote(p.trade, SLOTS.company, SLOTS.signer));
    for (const [company, signer] of [
      ["Green Acre Lawn", "Pat"],
      ["Ridgeline Tree Co.", "Dave"],
      ["O'Brien & Sons <Paint>", "Siobhán"],
      ["J.R. Fence L.L.C.", "J.R."],
      ["{signer} Mowing", "{company}"],
    ]) {
      const engine = exampleNote(p.trade, company!, signer!);
      expect(fillIn(main, company!, signer!), company).toBe(engine.main);
      expect(fillIn(foot, company!, signer!), company).toBe(engine.foot);
    }
  });

  it("the text he'd get is the engine's own hand-off text, for someone who wants the work", () => {
    const sms = blocks(html, /<div class="sms">/, "p").map((b) => unescape(b.slice(b.lastIndexOf("<p>") + 3, -"</p>".length)));
    expect(sms).toHaveLength(2);
    for (const s of sms) expect(s).toBe(exampleHandoff(p.trade));
    expect(sms[0]).toContain("\nWants it done\n");
    expect(sms[0]).not.toContain("Wants: ");
  });
});

describe("the example customers", () => {
  it("are a different person on every page", () => {
    const names = PAGES.map((p) => /NEW — ([^,]+),/.exec(exampleHandoff(p.trade))![1]);
    expect(new Set(names).size).toBe(PAGES.length);
  });
});
