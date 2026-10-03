import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { claim } from "@qa/engine";
import { exampleHandoff, exampleNote } from "../build/examples.ts";
import { EXAMPLE_SIGNER, pageFor } from "../build/render.ts";
import { NETLIFY_FIELDS } from "../src/form.ts";
import { fillIn, MINE } from "../src/note.ts";
import { LABEL, LOOKS, MONTHLY, TRADE_SITE, VIEWS, viewPage, type SitePage } from "../src/trades.ts";
import { blocks, count, lawn, rendered, textOf, visibleText, wordRules } from "./html.ts";

/**
 * The violet pages Jack picked on Oct 3 (the Soro-style mockup): main-site/ for quietaccounts.com, and
 * cold-email-page/ for the link in the "show me" reply. Same words, same form and same rules as /lawn, in a new look;
 * the cold email page opens on the form, since his email already showed him the note.
 */
const view = (id: string) => viewPage(VIEWS.find((v) => v.id === id)!);
const main = view("main-site");
const cold = view("cold-email-page");
const html = { main: rendered("main-site/index.html", main), cold: rendered("cold-email-page/index.html", cold) };
const lawnHtml = rendered("lawn/index.html", lawn);
const h1 = (h: string) => textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(h)![1]!);
const promise = (h: string) => textOf(/<p class="promise">([\s\S]*?)<\/p>/.exec(h)![1]!);
/** Every FAQ, question to answer. */
const faq = (h: string) => new Map([...h.matchAll(/<details><summary>([^<]*)<\/summary><div class="a">([\s\S]*?)<\/div><\/details>/g)].map((m) => [textOf(m[1]!), textOf(m[2]!)]));
/** The form, from its tag to the end of the hero. */
const formOf = (h: string) => {
  const hero = blocks(h, /<section class="hero/, "section")[0]!;
  return hero.slice(hero.indexOf('<form id="form"'));
};

describe("the violet views", () => {
  it("are /lawn's words under their own names, each built at the folder named for its job", () => {
    expect(VIEWS.map((v) => v.id)).toEqual(["main-site", "cold-email-page", ...LOOKS.map((v) => v.id), ...TRADE_SITE.map((v) => v.id)]);
    for (const p of [main, cold]) {
      expect(p.words).toBe(MONTHLY);
      expect(p.trade).toBe("lawn");
      expect(p.proofs).toBe(lawn.proofs);
      expect(p.calc).toBe(lawn.calc);
    }
    expect(pageFor("/main-site/index.html")?.id).toBe("main-site");
    expect(pageFor("/cold-email-page/")?.id).toBe("cold-email-page");
    expect(pageFor("/lawn/index.html")?.id).toBe("lawn");
  });

  it("show the violet link picture, which is in the build's public folder at its full size", () => {
    for (const h of Object.values(html)) expect(h).toContain('<meta property="og:image" content="https://quietaccounts.com/og-soro.png">');
    const png = readFileSync(new URL("../public/og-soro.png", import.meta.url));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});

describe.each([
  ["main-site", main, html.main],
  ["cold-email-page", cold, html.cold],
] as [string, SitePage, string][])("/%s, like every page", (id, p, h) => {
  const w = p.words;

  it("keeps the words rules, and the footer", () => wordRules(h, w.offer));

  it("gives the result and the promise first, in /lawn's words", () => {
    expect(h1(h)).toBe("Last season's customers, booked again.");
    expect(promise(h)).toBe("Done for you. Any month nobody asks to come back, you don't pay.");
    expect(visibleText(h)).toContain("First 150 free, then $497/mo if you say yes No call, no card Your part: forward one email");
    expect(visibleText(h)).toContain("Your first 150 are free, then $497 a month if you say yes.");
  });

  it("has one action: every button says the same thing, sits beside its price and leads to the one form", () => {
    const labels = [...h.matchAll(/<(?:a|button) class="btn"[^>]*>([\s\S]*?)<\/(?:a|button)>/g)].map((m) => textOf(m[1]!));
    expect(labels.length).toBeGreaterThanOrEqual(4);
    expect(new Set(labels)).toEqual(new Set([`${w.button} →`]));
    for (const href of h.matchAll(/<a class="btn" href="([^"]*)"/g)) expect(href[1]).toBe("#start");
    for (const cta of blocks(h, /<div class="cta/, "div")) expect(textOf(cta)).toBe(`${w.button} → ${w.priceLine}`);
    expect(textOf(blocks(h, /<div class="sticky"/, "a")[0]!)).toBe(`${w.sticky.join(" ")} ${w.button} →`);
    // the header holds the logo and nothing else
    const header = blocks(h, /<header/, "header")[0]!;
    expect(header).not.toMatch(/btn|<nav/);
    expect(textOf(header)).toBe("Quiet Accounts");
    expect(header).toMatch(/<img src="\/src\/assets\/logo-mark-violet\.svg"/);
    expect([...h.matchAll(/<form\b(?![^>]*\bhidden\b)/g)]).toHaveLength(1);
  });

  it("signs him up as itself: its own name in ref, the lawn trade, the monthly offer, and the static copy Netlify finds", () => {
    expect(h).toContain(`data-page="${id}" data-trade="lawn" data-offer="monthly"`);
    expect(h).toContain(`<form name="start" data-netlify="true" netlify-honeypot="website" hidden>${NETLIFY_FIELDS.map((f) => `<input name="${f}">`).join("")}</form>`);
    expect(h).toContain('<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">');
  });

  it("labels every result and leads with Capital City", () => {
    const cards = blocks(h, /<article class="card">/, "article");
    expect(cards.map((c) => textOf(/<h3>(.*?)<\/h3>/.exec(c)![1]!))).toEqual(["Capital City Landscaping", "Nelson Fence", "Dow's Tree Service"]);
    for (const c of cards) expect(textOf(c)).toContain(LABEL);
    expect(textOf(cards[2]!)).not.toMatch(/uncle/i);
    expect(textOf(blocks(h, /<figure class="tally">/, "figure")[0]!)).toBe(`Capital City Landscaping, NH · first 150 150 asked 28 wrote back 17 booked $34k in jobs ${LABEL}`);
  });

  it("shows outside numbers only from claims.ts, with the source beside them", () => {
    const lead = claim("lead-cost-landscaping")!;
    const money = textOf(blocks(h, /<section class="sec" id="money">/, "section")[0]!);
    expect(money).toContain(`${lead.text} These ones already know you`);
    expect(money).toContain(`Lead cost: ${lead.source}.`);
    const text = visibleText(h);
    for (const c of ["jobber-campaigns-not-retroactive", "jobber-campaigns-add-on"]) {
      const at = text.indexOf(claim(c)!.text);
      expect(at, c).toBeGreaterThan(-1);
      expect(text.slice(at, at + 600), c).toContain(claim(c)!.source);
    }
    expect(count(text, "$118")).toBe(1);
  });

  it("works out the calculator at Capital City's rate, starting on example numbers it says are examples", () => {
    const calc = textOf(blocks(h, /<div class="calc-out"/, "section")[0]!);
    expect(calc).toContain("If they book like Capital City's customers did: 11% book again when asked 34 jobs booked $22,100 left on the table");
    for (const [cid, s] of [["cN", p.calc.count], ["cJ", p.calc.job]] as const) {
      expect(h).toContain(`<input type="range" id="${cid}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}">`);
      expect(h).toMatch(new RegExp(`for="${cid}">[^<]*</output><small class="eg" id="${cid}Eg">Example</small>`));
    }
  });

  it("answers the questions /lawn answers in /lawn's own words, and the same nine at least", () => {
    const mine = faq(h);
    const theirs = faq(lawnHtml);
    expect(mine.size).toBeGreaterThanOrEqual(9);
    for (const [q, a] of theirs) expect(mine.get(q), q).toBe(a);
  });

  it("shows the text he'd get as the engine writes it, labeled an example", () => {
    expect(h).toContain("Example &middot; a text to you");
    expect(textOf(blocks(h, /<div class="sms">/, "p")[0]!)).toBe(textOf(`Quiet Accounts · 9:12 AM ${exampleHandoff("lawn")}`));
  });
});

/* ------------------------------ main-site: the whole page, for quietaccounts.com ------------------------------ */

describe("/main-site", () => {
  const h = html.main;

  it("opens with one field and the button; his note and the rest wait in the reveal, the same one /lawn has", () => {
    const form = formOf(h);
    const reveal = form.indexOf('<div class="reveal" id="reveal" hidden>');
    expect(reveal).toBeGreaterThan(-1);
    expect(form.indexOf('id="company"')).toBeLessThan(reveal);
    for (const f of ["first", "cell", "consent", "submit"]) expect(form.indexOf(`id="${f}"`), f).toBeGreaterThan(reveal);
    const own = (x: string) => x.slice(x.indexOf('<div class="reveal"'), x.indexOf('<input class="hp"'));
    expect(own(h)).toBe(own(lawnHtml));
    expect(h).not.toContain("data-open");
  });

  it("says what we do, how it works and what it costs, in /lawn's words", () => {
    const text = visibleText(h);
    for (const line of [
      "You do two things. We do everything in between.",
      "Send us your past jobs: one email from Jobber or whatever you use. About four minutes.",
      "Every customer asked. Every reply read. Every yes texted to you.",
      "Your company's name on it. You read the first one. Nothing sends until you say so.",
      "Every Friday: a text with your week. Asked, wrote back, booked.",
      "Free for the first 150. Then $497 a month, only if you say yes.",
      "Any month nobody asks to come back is free. Only if you say yes after the first 150 We text you before every charge.",
      "Your software sends reminders going forward. We go back through everyone it never reached, and read every reply.",
    ])
      expect(text, line).toContain(line);
  });

  it("gives a screen reader the Jobber table as a real table: column headers, then a row header and two cells a row", () => {
    const table = blocks(h, /<table class="vs2"/, "table")[0]!;
    expect(table).toContain('aria-label="Jobber Campaigns compared with Quiet Accounts"');
    const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1]!.matchAll(/<(th|td)\b([^>]*)>/g)].map((c) => `${c[1]}${/scope="(\w+)"/.exec(c[2]!)?.[1] ?? ""}`).join(" "));
    expect(rows).toEqual(["td thcol thcol", ...Array(5).fill("throw td td")]);
    expect(textOf(table)).toContain("A month nobody asks to come back $0 The add-on bills anyway");
  });

  it("labels anything made up as an example, and keeps the hero's customer out of the engine's story", () => {
    const side = blocks(h, /<div class="peekcard"/, "section")[0]!;
    expect(side).toContain('<span class="eg-pill">Example</span>');
    expect(side).toContain('aria-hidden="true"');
    const engine = textOf(`${exampleHandoff("lawn")} ${exampleNote("lawn", "Ridgeline Landscaping", EXAMPLE_SIGNER).main}`);
    for (const part of ["Mike", "Sanderson", "Oak Ln"]) {
      expect(side).toContain(part);
      expect(engine).not.toContain(part);
    }
    // "how it works" finds the engine's customer first, so the note and the text that follow are to someone on its list
    const [, first, last] = /NEW — (\w+) (\w+),/.exec(exampleHandoff("lawn"))!;
    expect(textOf(blocks(h, /<div class="list">/, "div")[0]!)).toBe(`${first![0]}. ${last} · weekly mowing Nov 2025`);
    expect(textOf(side)).not.toMatch(new RegExp(`\\b(?:${first}|${last})\\b`));
  });
});

/* ------------------------------ cold-email-page: the link in the "show me" reply ------------------------------ */

describe("/cold-email-page", () => {
  const h = html.cold;
  const form = formOf(h);

  it("opens on the form: every field shows, the company from his link is a line he can change, and the first press sends", () => {
    expect(form).toContain(" data-open ");
    expect(form).toContain('<div class="reveal" id="reveal">');
    expect(form).not.toMatch(/id="reveal" hidden/);
    expect(form).toContain('<div class="co-line" id="coLine" hidden><span class="co-k">Your company</span><b data-company>Ridgeline Landscaping</b><button type="button" class="co-change" id="coChange" aria-controls="coField">Change</button></div>');
    expect(form).toContain('<div class="field" id="coField"><label for="company">Your company name</label>');
    // one button in the form, after the fields and the box, and the sticky bar steps aside while it shows
    const own = form.slice(0, form.indexOf("</form>"));
    expect(count(own, 'class="btn"')).toBe(1);
    expect(own.indexOf('id="submit"')).toBeGreaterThan(own.indexOf('id="consent"'));
    expect(own).toContain('<div class="cta full" data-hides-sticky><button class="btn" type="submit" id="submit">');
    // nothing of the note or the text in the way of the fields
    expect(own.indexOf('class="nb"')).toBeGreaterThan(own.indexOf('id="submit"'));
    expect(own).not.toContain('id="revealH"');
  });

  it("keeps his note one tap away, under the button: the engine's own, with the example signer", () => {
    const peek = blocks(h, /<details class="peek">/, "details")[0]!;
    expect(textOf(/<summary>([\s\S]*?)<\/summary>/.exec(peek)![1]!)).toBe("See your first note, with Ridgeline Landscaping on it");
    expect(textOf(blocks(peek, /<div class="nb"/, "div")[0]!)).toBe(textOf(exampleNote("lawn", "Ridgeline Landscaping", EXAMPLE_SIGNER).main));
    expect(peek).toContain(`<p class="rv-sig" id="sigHint">Signed ${EXAMPLE_SIGNER}, an example name, until you type yours above.</p>`);
    expect(peek).not.toContain(" open");
  });

  it("never puts the example company in his consent: it says 'my company' until his own is in", () => {
    const consent = /<label class="consent"><input type="checkbox" id="consent" name="consent" required><span data-template="([^"]*)">([^<]*)<\/span>/.exec(h)!;
    expect(textOf(consent[2]!)).toBe(fillIn(MONTHLY.consent, MINE, ""));
    expect(textOf(consent[2]!)).toContain("I run my company.");
    expect(textOf(consent[1]!)).toBe(MONTHLY.consent);
  });

  it("names his company at the top only when his link brings it", () => {
    expect(h).toContain('<p class="chip"><span data-if-no-link>For lawn and landscaping companies</span><span data-if-link hidden>For <b data-company>Ridgeline Landscaping</b></span></p>');
  });

  it("says what happens after he presses start, in words the software backs", () => {
    const steps = [...blocks(h, /<ol class="nexts">/, "ol")[0]!.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]!));
    expect(steps.map((s) => s.split(".")[0])).toEqual(["Today Forward one email", "Within one business day Read your first note", "The next weekday morning The first notes go out", "After your first 150 You decide"]);
    expect(steps[0]).toContain("to quotes@quietaccounts.com. About four minutes, and we show you where to click.");
    expect(steps[1]).toContain("Change anything you want and text OK. Nothing sends until you do.");
    expect(steps[2]).toContain("Up to three short notes over a week or two. A person reads every reply, and every yes is texted to you the same day");
    expect(steps[3]).toBe("After your first 150 You decide. Keep it going for $497 a month only if you say yes. Any month nobody asks to come back is free. Cancel with a text.");
  });

  it("answers 'Doesn't Jobber do this?' with the table's words, the sources beside them", () => {
    const a = faq(h).get("Doesn't Jobber do this?")!;
    expect(a).toBe(
      `Jobber gives you a tool. We do the work. ${claim("jobber-campaigns-not-retroactive")!.text} ${claim("jobber-campaigns-add-on")!.text} Your software sends reminders going forward. We go back through everyone it never reached, and read every reply. Keep Jobber: we work from its export. Source: ${claim("jobber-campaigns-not-retroactive")!.source}; ${claim("jobber-campaigns-add-on")!.source}.`,
    );
  });

  it("stays out of search: it's for the owners the emails reach", () => {
    expect(h).toContain('<meta name="robots" content="noindex">');
    expect(html.main).not.toContain("noindex");
  });
});
