import { describe, expect, it } from "vitest";
import { EXAMPLE_SIGNER } from "../build/render.ts";
import { exampleHandoff, exampleNote, SLOTS } from "../build/examples.ts";
import { fillIn } from "../src/note.ts";
import { blocks, lawn, rendered, unescape } from "./html.ts";

/**
 * The note and the owner's text on the page are the engine's own words, never hand-copied: what the page shows, and
 * what it shows once he types his company and name, is what the engine writes for that company and signer.
 */
describe("the lawn page's note", () => {
  const html = rendered("lawn/index.html", lawn);
  const parts = (cls: string) => blocks(html, new RegExp(`<div class="${cls}" data-template="`), "div");
  const template = (block: string) => unescape(/data-template="([^"]*)"/.exec(block)![1]!);
  const shown = (block: string) => unescape(block.slice(block.indexOf(">") + 1, -"</div>".length));

  it("is the engine's first note to a lapsed regular, in the hero and in how it works", () => {
    const engine = exampleNote(lawn.companyExample, EXAMPLE_SIGNER);
    expect(parts("nb")).toHaveLength(2);
    for (const b of parts("nb")) expect(shown(b)).toBe(engine.main);
    for (const b of parts("nf")) expect(shown(b)).toBe(engine.foot);
    // every note carries the postal address (his, once he gives it to us)
    expect(engine.foot).toContain("[your business address]");
  });

  it("filled in with his company and first name, it's what the engine writes for them", () => {
    const main = template(parts("nb")[0]!);
    const foot = template(parts("nf")[0]!);
    expect({ main, foot }).toEqual(exampleNote(SLOTS.company, SLOTS.signer));
    for (const [company, signer] of [
      ["Green Acre Lawn", "Pat"],
      ["Ridgeline Landscaping Co.", "Dave"],
      ["O'Brien & Sons <Lawn>", "Siobhán"],
      ["J.R. Lawn Care L.L.C.", "J.R."],
      ["{signer} Mowing", "{company}"],
    ]) {
      const engine = exampleNote(company!, signer!);
      expect(fillIn(main, company!, signer!), company).toBe(engine.main);
      expect(fillIn(foot, company!, signer!), company).toBe(engine.foot);
    }
  });

  it("the text he'd get is the engine's own hand-off text", () => {
    const sms = blocks(html, /<div class="sms">/, "p").map((b) => unescape(b.slice(b.lastIndexOf("<p>") + 3, -"</p>".length)));
    expect(sms).toHaveLength(2);
    for (const s of sms) expect(s).toBe(exampleHandoff());
  });
});
