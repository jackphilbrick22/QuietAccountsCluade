import { describe, expect, it } from "vitest";
import { claim, emptyState, generateSample, lintMarketing, reportWeek } from "@qa/engine";
import { ADDRESS, CALL } from "../build/render.ts";
import { fillIn } from "../src/note.ts";
import { FAMILY, LABEL, MONTHLY, ONE_PASS_CARD, PAGES } from "../src/trades.ts";
import { blocks, lawn, rendered, textOf, visibleText } from "./html.ts";

/** The brief's rules for every page (§1 words, §5 rules 1–10 and "Claims the software doesn't back"), checked on the built HTML. */
const BANNED = /7am to 8pm|money map|reply desk|ready text|every month after|year floor|money-back|risk-free|free trial|guaranteed \d+\s?%|price or a date|preview only|tom alvarez|\$29|pick the day|over about a week|still goes out|deleted 30 days|saved on your own page|open days near you|one-page report|every friday,? your quiet rate|spots? left|countdown/i;
const count = (s: string, part: string) => s.split(part).length - 1;
/** §1: the monthly promise, in one of its two forms and nothing else. */
const MONTHLY_PROMISES = ["Any month nobody asks to come back is free.", "Any month nobody asks to come back, you don't pay."];

function wordRules(html: string) {
  const text = visibleText(html);
  expect(text).not.toMatch(BANNED);
  expect(lintMarketing(text)).toEqual([]);
  // "free" always has its price beside it
  for (const m of text.matchAll(/\bfree\b/gi)) expect(text.slice(Math.max(0, m.index - 90), m.index + 90), `"free" at ${m.index}`).toMatch(/\$497/);
  // the trust footer: the postal address, the text number, and the only place the 15-minute call is offered
  const foot = blocks(html, /<footer/, "footer")[0]!;
  expect(textOf(foot)).toContain(`Quiet Accounts · ${ADDRESS}`);
  expect(foot).toContain('href="sms:+16033407673"');
  expect(count(html, CALL)).toBe(1);
  expect(foot).toContain(CALL);
  expect(html).not.toMatch(/<nav\b/);
}

describe("/lawn", () => {
  const html = rendered("lawn/index.html", lawn);
  const text = visibleText(html);

  it("gives the result, the promise and the price first, in the brief's words", () => {
    expect(textOf(/<h1>([\s\S]*?)<\/h1>/.exec(html)![1]!)).toBe("Last season's customers, booked again.");
    expect(textOf(/<p class="promise">([\s\S]*?)<\/p>/.exec(html)![1]!)).toBe("Done for you. Any month nobody asks to come back, you don't pay.");
    expect(text).toContain("First 150 free, then $497/mo if you say yes No call, no card Your part: forward one email");
    expect(text).toContain("Free for the first 150. Then $497 a month, only if you say yes.");
    expect(text).toContain("Any month nobody asks to come back is free. Only if you say yes after the first 150 We text you before every charge.");
    expect(text).toContain("Your first 150 are free, then $497 a month if you say yes.");
  });

  it("has one action: every button says the same thing, sits beside its price and leads to the one form", () => {
    const labels = [...html.matchAll(/<(?:a|button) class="btn"[^>]*>([\s\S]*?)<\/(?:a|button)>/g)].map((m) => textOf(m[1]!));
    expect(labels.length).toBeGreaterThanOrEqual(5);
    expect(new Set(labels)).toEqual(new Set(["Start my free 150 →"]));
    for (const href of html.matchAll(/<a class="btn" href="([^"]*)"/g)) expect(href[1]).toBe("#start");
    for (const cta of blocks(html, /<div class="cta/, "div")) expect(textOf(cta)).toBe("Start my free 150 → then $497/mo if you say yes");
    expect(textOf(blocks(html, /<div class="sticky"/, "a")[0]!)).toContain("First 150 free then $497/mo if you say yes");
    // no nav, nothing in the header but the logo, one form a visitor can see
    expect(blocks(html, /<header/, "header")[0]).not.toMatch(/btn|<nav/);
    expect([...html.matchAll(/<form\b(?![^>]*\bhidden\b)/g)]).toHaveLength(1);
  });

  it("opens with one field and the button; the rest of the form waits in the reveal", () => {
    const hero = blocks(html, /<section class="hero"/, "section")[0]!;
    const form = hero.slice(hero.indexOf('<form id="form"'));
    const reveal = form.indexOf('<div class="reveal" id="reveal" hidden>');
    expect(form.indexOf('id="company"')).toBeLessThan(reveal);
    for (const id of ["first", "cell", "consent"]) expect(form.indexOf(`id="${id}"`), id).toBeGreaterThan(reveal);
    // the button that sends follows the rest; once the note shows, one that leads on to the rest sits above it
    expect(form.indexOf('id="submit"')).toBeGreaterThan(form.indexOf('id="consent"'));
    const above = form.slice(reveal, form.indexOf('<p class="rv-h" id="revealH"'));
    expect(textOf(above)).toBe("Start my free 150 → then $497/mo if you say yes");
    expect(above).toContain('<a class="btn" href="#start">');
    expect(form).toContain("<label for=\"company\">Your company name</label>");
    expect(form).toMatch(/data-trade="lawn" data-offer="monthly"/);
  });

  it("asks for consent in the monthly words, with his company in them", () => {
    const consent = /<label class="consent"><input type="checkbox" id="consent" name="consent" required><span data-template="([^"]*)">([^<]*)<\/span>/.exec(html)!;
    expect(textOf(consent[2]!)).toBe(fillIn(MONTHLY.consent, lawn.companyExample, ""));
    expect(textOf(consent[1]!)).toBe(MONTHLY.consent);
    expect(MONTHLY.consent).toBe("I run {company}. Quiet Accounts can write to my past customers in my company's name and text me at this number about it. Msg & data rates may apply. Reply STOP to stop.");
  });

  it("labels every result, leads with Capital City, and never shows Dow's without the family disclosure", () => {
    const cards = blocks(html, /<article class="card">/, "article");
    expect(cards.map((c) => textOf(/<h3>(.*?)<\/h3>/.exec(c)![1]!))).toEqual(["Capital City Landscaping", "Nelson Fence", "Dow's Tree Service"]);
    for (const c of cards) expect(textOf(c)).toContain(LABEL);
    expect(textOf(cards[2]!)).toContain(FAMILY);
    // the ranges count Dow's, so they carry both lines
    const plan = blocks(html, /<div class="plan free">/, "ul")[0]!;
    expect(textOf(plan)).toContain(`12–28 wrote back 4–17 booked $10k–$34k in jobs ${LABEL} ${FAMILY}`);
    const tally = blocks(html, /<figure class="tally">/, "figure")[0]!;
    expect(textOf(tally)).toBe(`Capital City Landscaping, NH · first 150 150 asked 28 wrote back 17 booked $34k in jobs ${LABEL}`);
    expect(count(text, LABEL)).toBe(6);
    expect(count(text, FAMILY)).toBe(2);
    expect(count(text.replaceAll(FAMILY, ""), "Dow")).toBe(1);
  });

  it("labels anything made up as an example", () => {
    for (const ex of ["Mike Sanderson", "Dan Alvarez"]) expect(html).toContain(ex);
    expect(blocks(html, /<div class="hero-side"/, "p")[0]).toContain('<p class="qw-day">Example</p>');
    expect(count(html, '<span class="ex-tag">Example</span>')).toBe(2);
    expect(count(html, "Note 1 &middot; Example")).toBe(2);
    expect(count(html, "Example &middot; a text to you")).toBe(2);
  });

  it("keeps each example customer to one story: the engine's note and text are to someone the hero's texts never name", () => {
    const sms = textOf(blocks(html, /<div class="sms">/, "p")[0]!);
    const note = textOf(blocks(html, /<div class="nb"/, "div")[0]!);
    const [, first, last, street] = /NEW — (\w+) (\w+), (.+?) Last job/.exec(sms)!;
    const [, month, year, job] = /Last job: (\w{3}) \d+, (\d{4}) · \$[\d,]+ · (.+?) They said/.exec(sms)!;
    // the hero's example texts are other customers, at other streets
    const side = blocks(html, /<div class="hero-side"/, "section")[0]!;
    const hero = [...side.matchAll(/<b class="qw-title">([^<]*) wants it done<\/b>[\s\S]*?<span class="qw-meta">([^<&]*)/g)].map((m) => [m[1]!, m[2]!.trim()] as const);
    expect(hero).toEqual([["Mike Sanderson", "14 Oak Ln"], ["Dan Alvarez", "88 Ridge Rd"]]);
    for (const [name, at] of hero) for (const part of [...name.split(" "), at]) for (const engine of [sms, note]) expect(engine, part).not.toMatch(new RegExp(`\\b${part}\\b`));
    expect(textOf(side)).not.toMatch(new RegExp(`\\b(?:${first}|${last}|${street})\\b`));
    // "how it works" finds him first, so the note and the text that follow are to someone on its list
    expect(textOf(blocks(html, /<li class="we">/, "li")[0]!)).toContain(`Example ${first![0]}. ${last} · ${job!.toLowerCase()} ${month} ${year} `);
  });

  it("shows outside numbers only from claims.ts, with the source beside them", () => {
    const lead = claim("lead-cost-landscaping")!;
    const money = blocks(html, /<section class="sec" id="money">/, "section")[0]!;
    expect(textOf(money)).toContain(`${lead.text} These ones already know you`);
    expect(textOf(money)).toContain(`Lead cost: ${lead.source}.`);
    expect(count(text, "$118")).toBe(1);
    expect(count(text, "$37 ")).toBe(1);
    const jobber = textOf(blocks(html, /<section class="sec band" id="jobber">/, "section")[0]!);
    for (const id of ["jobber-campaigns-not-retroactive", "jobber-campaigns-add-on"]) {
      expect(jobber).toContain(claim(id)!.text);
      expect(jobber).toContain(claim(id)!.source);
    }
    expect(jobber).toContain("A month nobody asks to come back The add-on bills anyway $0");
    expect(jobber).toContain("Your software sends reminders going forward. We go back through everyone it never reached, and read every reply.");
  });

  it("answers what the software backs, and the new questions, in the brief's words", () => {
    const faq = textOf(blocks(html, /<div class="faq">/, "section")[0]!);
    expect(faq).toContain("change anything you want and text OK. The first notes go out the next weekday morning.");
    expect(faq).toContain("Up to three short notes over a week or two");
    expect(faq).toContain("The first 150 are free (then $497 a month if you say yes), so you see your own numbers before you pay anything.");
    expect(faq).toContain("a person, not a bot, reads every reply");
    expect(faq).toContain("Text 603-340-7673 and say you're done. That's the whole process. Nothing goes out after that.");
    expect(faq).toContain("When do I pay, and how? Nothing for the first 150. If you want it to keep going, say yes and we text you a link for the first $497; it saves your card. After that we text you two days before each month's charge, and any month nobody asked to come back, there's no charge.");
    expect(faq).toContain("What counts as asking to come back? Someone we wrote to asks for a date, a price or their old slot. You get each one by text, the same day.");
    // the monthly promise in one of its two forms, never the one-pass "you owe nothing"
    const ifNothing = /What if nothing comes back\? (.*?) Do I have to get on a call\?/.exec(faq)![1]!;
    expect(ifNothing).toBe("Any month nobody asks to come back, you don't pay. We'll be the ones to tell you, and you'll know within three weeks of the first batch.");
    expect(MONTHLY_PROMISES.some((p) => ifNothing.includes(p))).toBe(true);
    expect(text).not.toMatch(/owe nothing/i);
  });

  it("calls the Friday report what the product sends: a text, with the counts the real one gives", () => {
    expect(blocks(html, /<p class="friday">/, "p").map(textOf)).toEqual(["Every Friday: a text with your week. Asked, wrote back, booked."]);
    // the engine's Friday report is an owner text, and it counts the people asked, who wrote back and what booked
    const ds = generateSample({ trade: "lawn", asOf: "2026-10-02", months: 3 }).dataset;
    const friday = reportWeek(emptyState(ds, "2026-10-02T16:00:00"), "2026-10-02T16:00:00");
    expect(friday.kind).toBe("weekly");
    for (const line of [/^Notes out: \d+ \(to \d+ people\)$/m, /^Wrote back: \d+$/m, /^Booked: \d+/m]) expect(friday.text).toMatch(line);
  });

  it("keeps the words rules, and the footer", () => wordRules(html));
});

describe("/", () => {
  const html = rendered("index.html");

  it("is the logo, one line and two cards, linking only pages that are built", () => {
    expect(textOf(/<h1>([\s\S]*?)<\/h1>/.exec(html)![1]!)).toBe("We write to your old customers and quotes in your name. You get a text when one wants the work.");
    const cards = blocks(html, /<article class="offer">/, "article").map(textOf);
    expect(cards).toEqual([`${MONTHLY.card.title} ${MONTHLY.card.text} Lawn and landscaping →`, `${ONE_PASS_CARD.title} ${ONE_PASS_CARD.text}`]);
    expect(MONTHLY.card.text).toBe("Past customers back on your schedule. First 150 free, then $497 a month if you say yes.");
    expect(ONE_PASS_CARD.text).toBe("One pass through your old quotes and past customers. $250 per booked job, never more than $1,000.");
    const links = [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]).filter((h) => !h!.startsWith("/src/"));
    expect(links).toEqual(PAGES.map((p) => `/${p.id}`));
    expect(html).not.toMatch(/<form|<script|class="btn"/);
  });

  it("keeps the words rules, and the footer", () => wordRules(html));
});
