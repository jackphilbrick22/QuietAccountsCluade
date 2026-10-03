import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { claim, emptyState, generateSample, lintMarketing, reportWeek } from "@qa/engine";
import { ADDRESS, CALL, POLICIES } from "../build/render.ts";
import { fillIn } from "../src/note.ts";
import { FAMILY, LABEL, MONTHLY, ONE_PASS, PAGES, type SitePage } from "../src/trades.ts";
import { blocks, lawn, page, rendered, textOf, visibleText } from "./html.ts";

/** The brief's rules for every page (§1 words, §5 rules 1–10 and "Claims the software doesn't back"), checked on the built HTML. */
const BANNED = /7am to 8pm|money map|reply desk|ready text|every month after|year floor|money-back|risk-free|free trial|guaranteed \d+\s?%|price or a date|preview only|tom alvarez|\$29|pick the day|over about a week|still goes out|deleted 30 days|saved on your own page|open days near you|one-page report|four years old|every friday,? your quiet rate|spots? left|countdown/i;
const count = (s: string, part: string) => s.split(part).length - 1;
/** §1: the monthly promise, in one of its two forms and nothing else. */
const MONTHLY_PROMISES = ["Any month nobody asks to come back is free.", "Any month nobody asks to come back, you don't pay."];
/** §1: the one-pass promise. */
const ONE_PASS_PROMISE = "You pay $250 for each job that books, never more than $1,000. Nothing books, you owe nothing.";

function wordRules(html: string, offer?: SitePage["words"]["offer"]) {
  const text = visibleText(html);
  expect(text).not.toMatch(BANNED);
  expect(lintMarketing(text)).toEqual([]);
  // "free" always has its price beside it, and a one-pass page has no free offer at all
  if (offer === "one_pass") expect(text).not.toMatch(/\bfree\b|\$497|any month nobody/i);
  for (const m of text.matchAll(/\bfree\b/gi)) expect(text.slice(Math.max(0, m.index - 90), m.index + 90), `"free" at ${m.index}`).toMatch(/\$497/);
  // a shop's result, in any sentence, carries the label; Dow's never shows without the family disclosure right after it
  for (const m of text.matchAll(/\bbooked \d+ from\b|\b\d+ booked out of\b/g)) expect(text.slice(m.index, m.index + 300), `result at ${m.index}`).toContain(LABEL);
  for (const m of text.matchAll(/Dow's/g)) expect(text.slice(m.index, m.index + 300), `Dow's at ${m.index}`).toContain(FAMILY);
  // the trust footer: the postal address, the text number, and the only place the 15-minute call is offered
  const foot = blocks(html, /<footer/, "footer")[0]!;
  expect(textOf(foot)).toContain(`Quiet Accounts · ${ADDRESS}`);
  expect(foot).toContain('href="sms:+16033407673"');
  expect(count(html, CALL)).toBe(1);
  expect(foot).toContain(CALL);
  // the live site's privacy and terms pages, since the consent box asks to text him
  for (const [href, name] of POLICIES) expect(foot).toContain(`<a href="${href}">${name}</a>`);
  expect(html).not.toMatch(/<nav\b/);
}

const h1 = (html: string) => textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)![1]!);
const promise = (html: string) => textOf(/<p class="promise[^"]*">([\s\S]*?)<\/p>/.exec(html)![1]!);
const faq = (html: string) => textOf(blocks(html, /<div class="faq">/, "section")[0]!);
/** The form's software picker: each choice's id and its small line. */
const picker = (html: string) => [...html.matchAll(/data-sw="(\w+)"[^>]*><b>[^<]*<\/b><small>([^<]*)<\/small>/g)].map((m) => [m[1]!, textOf(m[2]!)] as const);
/** One FAQ's answer, by its question. */
const answer = (html: string, q: string) => textOf(new RegExp(`<summary>${q.replace(/[?$]/g, "\\$&")}</summary><div class="a">([\\s\\S]*?)</div>`).exec(html)![1]!);
const cards = (html: string) => blocks(html, /<article class="card">/, "article");

describe.each(PAGES.map((p) => [`/${p.id}`, p] as const))("%s, like every page", (_path, p) => {
  const html = rendered(`${p.id}/index.html`, p);
  const w = p.words;

  it("has one action: every button says the same thing, sits beside its price and leads to the one form", () => {
    const labels = [...html.matchAll(/<(?:a|button) class="btn"[^>]*>([\s\S]*?)<\/(?:a|button)>/g)].map((m) => textOf(m[1]!));
    expect(labels.length).toBeGreaterThanOrEqual(5);
    expect(new Set(labels)).toEqual(new Set([`${w.button} →`]));
    for (const href of html.matchAll(/<a class="btn" href="([^"]*)"/g)) expect(href[1]).toBe("#start");
    for (const cta of blocks(html, /<div class="cta/, "div")) expect(textOf(cta)).toBe(`${w.button} → ${w.priceLine}`);
    expect(textOf(blocks(html, /<div class="sticky"/, "a")[0]!)).toBe(`${w.sticky.join(" ")} ${w.button} →`);
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
    expect(textOf(above)).toBe(`${w.button} → ${w.priceLine}`);
    expect(above).toContain('<a class="btn" href="#start">');
    expect(form).toContain('<label for="company">Your company name</label>');
    expect(form).toContain(`data-page="${p.id}" data-trade="${p.trade}" data-offer="${w.offer}"`);
  });

  it("says in the picker how many exports the step after the form asks for", () => {
    expect(picker(html).map(([id]) => id)).toEqual(["jobber", "housecall_pro", "other"]);
    for (const [id, small] of picker(html)) {
      const step = textOf(new RegExp(`<p data-step="${id}"[^>]*>([\\s\\S]*?)</p>`).exec(html)![1]!);
      expect(/\btwo\b/.test(small), `${id}: "${small}" / "${step}"`).toBe(/then the same/.test(step));
    }
  });

  it("asks for consent in its offer's words, with his company in them", () => {
    const consent = /<label class="consent"><input type="checkbox" id="consent" name="consent" required><span data-template="([^"]*)">([^<]*)<\/span>/.exec(html)!;
    expect(textOf(consent[2]!)).toBe(fillIn(w.consent, p.companyExample, ""));
    expect(textOf(consent[1]!)).toBe(w.consent);
  });

  it("labels every result and leads with the page's own shop", () => {
    expect(cards(html).map((c) => textOf(/<h3>(.*?)<\/h3>/.exec(c)![1]!))).toEqual(p.proofs.map((x) => x.shop));
    for (const c of cards(html)) expect(textOf(c)).toContain(LABEL);
    for (const [i, x] of p.proofs.entries()) if (x.family) expect(textOf(cards(html)[i]!)).toContain(FAMILY);
    const lead = p.proofs[0]!;
    expect(textOf(blocks(html, /<figure class="tally">/, "figure")[0]!)).toContain(`${lead.shop}, ${lead.where} · `);
    expect(textOf(blocks(html, /<div class="calc"/, "section")[0]!)).toContain(LABEL);
  });

  it("says in the hero what it works from: the FAQ's own software, as plain words", () => {
    const hero = blocks(html, /<section class="hero"/, "section")[0]!;
    const strip = blocks(hero, /<div class="works">/, "div")[0]!;
    expect([...strip.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => textOf(m[1]!))).toEqual(p.works);
    expect(strip).not.toMatch(/<img|<a\b/);
    expect(p.works.at(-1)).toMatch(/spreadsheet/i);
  });

  it("puts Jack under the results: his card, and the offer to pass on the shops' numbers", () => {
    const results = blocks(html, /<section class="sec band" id="results">/, "section")[0]!;
    const card = textOf(blocks(results, /<aside class="jack"/, "aside")[0]!);
    expect(card).toMatch(/^JP Jack Philbrick Quiet Accounts · Concord, NH I grew up in Concord and worked .+ before I started this\. Want to ask (these shops|that shop) yourself\? Text me at 603-340-7673 and I'll pass on their numbers?\.$/);
    expect(results).toContain('href="sms:+16033407673"');
    expect(html).not.toContain('class="ask"');
  });

  it("starts its calculator on example numbers, and says so", () => {
    for (const [id, s] of [["cN", p.calc.count], ["cJ", p.calc.job]] as const) {
      expect(html).toContain(`<input type="range" id="${id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}">`);
      expect(html).toMatch(new RegExp(`for="${id}">[^<]*</output><small class="eg" id="${id}Eg">Example</small>`));
    }
  });

  it("lets a link's ?j=, his average job, set the job slider only where the slider is his average job", () => {
    expect(/<div class="calc" id="calc"[^>]* data-per-year>/.test(html)).toBe(p.calc.job.label !== "Your average job");
  });

  it("gives a screen reader the Jobber table in rows: the column headers, then a row header and two cells a line", () => {
    const jobber = blocks(html, /<section class="sec band" id="jobber">/, "section")[0]!;
    const table = /<div class="vs" role="table" aria-label="[^"]+">([\s\S]*?)\n {2}<\/div>/.exec(jobber)![1]!;
    const row = /<div role="row">((?:<div class="[^"]*" role="\w+">[^<]*<\/div>)+)<\/div>/g;
    // nothing sits in the table but its rows, and nothing in a row but its headers and cells
    expect(table.replace(row, "").trim()).toBe("");
    const roles = [...table.matchAll(row)].map((m) => [...m[1]!.matchAll(/role="(\w+)"/g)].map((r) => r[1]).join(" "));
    expect(roles.length).toBeGreaterThanOrEqual(5);
    expect(roles).toEqual(["columnheader columnheader columnheader", ...Array(roles.length - 1).fill("rowheader cell cell")]);
  });

  it("takes his file only in the 'Got it' step, as the other way to send it: a drop zone with a plain file picker, and no sample", () => {
    const done = html.slice(html.indexOf('<div class="done" id="done" tabindex="-1" hidden>'), html.indexOf('<form name="start"'));
    const drop = done.slice(done.indexOf('<div class="dfile" id="dfile"'));
    for (const one of ['id="dfile"', '<input type="file"', "Have the file already? Drop it here."]) {
      expect(count(html, one), one).toBe(1);
      expect(done, one).toContain(one);
    }
    // after forwarding the email, before the text from Jack that follows either way
    expect(textOf(done)).toMatch(/2 Forward th(at email|ose emails), as (it is|they are), to quotes@quietaccounts\.com Have the file already\? Drop it here\. .* 3 You'll get a text from Jack/);
    expect(drop).toMatch(/<label class="dz" id="dz">.*<input type="file" id="dzFile" multiple accept="\.csv,\.tsv,\.txt,text\/csv,text\/plain"><\/label>/);
    expect(textOf(drop)).toContain("It's read right here, on your screen, and goes nowhere until you send it.");
    // with a server he sends it from here; without one, the page asks him to forward the email (a one pass's two) as usual
    expect(drop).toContain('<button type="button" class="btn2" id="dzSendB">Send this file</button>');
    const email = w.offer === "monthly" ? "the email" : "the emails";
    expect(textOf(drop)).toContain(w.offer === "monthly" ? "To send it, forward the email as above, as usual." : "To send them, forward the emails as above, as usual.");
    expect(textOf(drop)).toContain(`That file didn't read. Send the export as your software made it, as a CSV, or forward ${email} as above.`);
    expect(drop).toContain(`That didn't go through. Forward ${email} as above, or <a id="smsFile" href="sms:+16033407673">text Jack at 603-340-7673</a>.`);
    expect(html).not.toMatch(/sample/i);
  });

  it("after a send, says there's no email to forward only once both of a one pass's exports are in, and otherwise which is still to come", () => {
    const after = [...html.matchAll(/<p class="dz-ok" (?:id="dzSent"|data-need="(\w+)") role="status" hidden>([^<]*)<\/p>/g)].map((m) => [m[1] ?? "all", textOf(m[2]!)]);
    const all = ["all", "It's all in, so there's no email to forward. Jack will text you the first note to read."];
    if (w.offer === "monthly") expect(after).toEqual([all]);
    else
      expect(after).toEqual([
        all,
        ["past", `Your ${p.quotes} are in. For your past customers, drop your visits or jobs export here too, or forward it as above.`],
        ["quotes", `Your past customers are in. For your ${p.quotes} nobody answered, drop your ${p.quotes} export here too, or forward it as above.`],
      ]);
  });

  it("names the export a file needs, and never Jobber's Re-engagement report, which has no emails", () => {
    const none = textOf(/<p class="dz-s" id="dzNone" hidden>([^<]*)<\/p>/.exec(html)![1]!);
    expect(none).toContain(w.offer === "monthly" ? "like Jobber's Visits report." : "like Jobber's Quotes report or its Visits report.");
    expect(textOf(/<p data-step="jobber">([\s\S]*?)<\/p>/.exec(html)![1]!)).toMatch(/\bVisits\b/);
    expect(html).not.toMatch(/re-?engagement/i);
  });

  it("shows a one-pass page's quotes nobody answered in its own word, and a monthly page's past customers alone", () => {
    const quotes = /<div class="dz-r" id="rQuotes" hidden>[\s\S]*?<\/div><\/div>/.exec(html)?.[0];
    if (w.offer === "monthly") expect(quotes).toBeUndefined();
    else {
      expect(textOf(quotes!)).toBe("is sitting in nobody answered. When they were sent");
      expect(html).toContain(`<div class="dfile" id="dfile" data-quotes="${p.quotes}">`);
    }
    expect(textOf(/<div class="dz-r" id="rPast" hidden>[\s\S]*?<\/div><\/div>/.exec(html)![0])).toBe("When they were last here");
  });

  it("keeps the words rules, and the footer", () => wordRules(html, w.offer));
});

describe("/lawn", () => {
  const html = rendered("lawn/index.html", lawn);
  const text = visibleText(html);

  it("gives the result, the promise and the price first, in the brief's words", () => {
    expect(h1(html)).toBe("Last season's customers, booked again.");
    expect(promise(html)).toBe("Done for you. Any month nobody asks to come back, you don't pay.");
    expect(text).toContain("First 150 free, then $497/mo if you say yes No call, no card Your part: forward one email");
    expect(text).toContain("Free for the first 150. Then $497 a month, only if you say yes.");
    expect(text).toContain("Any month nobody asks to come back is free. Only if you say yes after the first 150 We text you before every charge.");
    expect(text).toContain("Your first 150 are free, then $497 a month if you say yes.");
  });

  it("has the monthly button, its price line and the monthly consent", () => {
    expect(textOf(blocks(html, /<div class="sticky"/, "a")[0]!)).toContain("First 150 free then $497/mo if you say yes Start my free 150 →");
    expect(MONTHLY.consent).toBe("I run {company}. Quiet Accounts can write to my past customers in my company's name and text me at this number about it. Msg & data rates may apply. Reply STOP to stop.");
  });

  it("labels every result, leads with Capital City, and never shows Dow's without the family disclosure", () => {
    expect(cards(html).map((c) => textOf(/<h3>(.*?)<\/h3>/.exec(c)![1]!))).toEqual(["Capital City Landscaping", "Nelson Fence", "Dow's Tree Service"]);
    expect(textOf(cards(html)[2]!)).toContain(FAMILY);
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

  it("works out the calculator at Capital City's rate, with nothing to pay on it", () => {
    const calc = textOf(blocks(html, /<div class="calc-out"/, "section")[0]!);
    expect(calc).toContain("If they book like Capital City's customers did: 11% book again when asked 34 jobs booked $22,100 left on the table Capital City");
    expect(html).not.toMatch(/id="rPay"|id="estNote"/);
  });

  it("answers what the software backs, and the new questions, in the brief's words", () => {
    const answers = faq(html);
    expect(answers).toContain("change anything you want and text OK. The first notes go out the next weekday morning.");
    expect(answers).toContain("Up to three short notes over a week or two");
    expect(answers).toContain("The first 150 are free (then $497 a month if you say yes), so you see your own numbers before you pay anything.");
    expect(answers).toContain("a person, not a bot, reads every reply");
    expect(answer(html, "How do I cancel?")).toBe("Text 603-340-7673 and say you're done. That's the whole process. Nothing goes out after that.");
    expect(answer(html, "When do I pay, and how?")).toBe("Nothing for the first 150. If you want it to keep going, say yes and we text you a link for the first $497; it saves your card. After that we text you two days before each month's charge, and any month nobody asked to come back, there's no charge.");
    expect(answer(html, "What counts as asking to come back?")).toBe("Someone we wrote to asks for a date, a price or their old slot. You get each one by text, the same day.");
    // the monthly promise in one of its two forms, never the one-pass "you owe nothing"
    const ifNothing = answer(html, "What if nothing comes back?");
    expect(ifNothing).toBe("Any month nobody asks to come back, you don't pay. We'll be the ones to tell you, and you'll know within three weeks of the first batch.");
    expect(MONTHLY_PROMISES.some((p) => ifNothing.includes(p))).toBe(true);
    expect(text).not.toMatch(/owe nothing/i);
  });

  it("asks for one export, in the picker and the step after the form", () => {
    expect(picker(html)).toEqual([["jobber", "Emails you a file"], ["housecall_pro", "Forward one report"], ["other", "Any export or spreadsheet"]]);
    expect(textOf(blocks(html, /<li class="you">/, "li")[0]!)).toContain("Send us your past jobs: one email from Jobber or whatever you use.");
  });

  it("calls the Friday report what the product sends: a text, with the counts the real one gives", () => {
    expect(blocks(html, /<p class="friday">/, "p").map(textOf)).toEqual(["Every Friday: a text with your week. Asked, wrote back, booked."]);
    // the engine's Friday report is an owner text, and it counts the people asked, who wrote back and what booked
    const ds = generateSample({ trade: "lawn", asOf: "2026-10-02", months: 3 }).dataset;
    const friday = reportWeek(emptyState(ds, "2026-10-02T16:00:00"), "2026-10-02T16:00:00");
    expect(friday.kind).toBe("weekly");
    for (const line of [/^Notes out: \d+ \(to \d+ people\)$/m, /^Wrote back: \d+$/m, /^Booked: \d+/m]) expect(friday.text).toMatch(line);
  });
});

/* ------------------------------ /cleaning: the monthly template, with cleaning words ------------------------------ */

describe("/cleaning", () => {
  const p = page("cleaning");
  const html = rendered("cleaning/index.html", p);
  const text = visibleText(html);
  const money = textOf(blocks(html, /<section class="sec" id="money">/, "section")[0]!);
  const churn = claim("cleaning-churn")!;
  const regular = claim("cleaning-regular-value")!;

  it("gives the result, the promise and the price first, in the brief's words, on the monthly offer", () => {
    expect(h1(html)).toBe("Clients who stopped booking, back on your schedule.");
    expect(promise(html)).toBe("Done for you. Any month nobody asks to come back, you don't pay.");
    expect(textOf(blocks(html, /<ul class="ticks/, "ul")[0]!)).toBe("First 150 free, then $497/mo if you say yes No call, no card Your part: send one export");
    expect(text).toContain("Free for the first 150. Then $497 a month, only if you say yes.");
    expect(text).toContain("Any month nobody asks to come back is free. Only if you say yes after the first 150 We text you before every charge.");
    expect(text).toContain("Your first 150 are free, then $497 a month if you say yes.");
    expect(p.words).toBe(MONTHLY);
    expect(html).toContain('data-page="cleaning" data-trade="cleaning" data-offer="monthly"');
    expect(text).not.toMatch(/owe nothing|\$250|mowing|lawn|landscaping compan/i);
  });

  it("says what a cleaning company loses in claims.ts's words, with their source beside them, never typed into the page", () => {
    expect(money).toContain(`You lose about 80 regulars a year. ${churn.text} ${regular.text}`);
    expect(money).toContain(`Regulars lost: ${churn.source}. A regular's year: ${regular.source}.`);
    expect(churn.text).toContain("(MaidCentral: 6.89% a month)");
    expect(count(text, "6.89%")).toBe(1);
    // the claim, and the calculator's example that's read from it
    expect(count(text, "$5,580")).toBe(2);
    // the page and its trades.ts entry say neither figure themselves
    for (const file of ["cleaning/index.html", "src/trades.ts"]) expect(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), file).not.toMatch(/6\.89|5,?580/);
  });

  it("works out the calculator: regulars lost in a year × what one pays a year × Capital City's 11%, as a landscaper's past customers", () => {
    // about 80 lost a year: 100 regulars held steady, 6.89% of them a month
    expect(p.calc.count).toMatchObject({ label: "Regulars lost in the last year", value: Math.round((churn.figure! * 12) / 10) * 10 });
    expect(p.calc.count.value).toBe(80);
    expect(p.calc.job).toMatchObject({ label: "What a regular pays you a year", value: regular.figure, money: true });
    expect(html).toContain('<output id="oN" for="cN">80</output><small class="eg" id="cNEg">Example</small>');
    expect(html).toContain('<output id="oJ" for="cJ">$5,580</output><small class="eg" id="cJEg">Example</small>');
    const calc = blocks(html, /<div class="calc"/, "section")[0]!;
    // a regular's year, which no link's average job sets
    expect(calc).toContain('data-booked="17" data-asked="150" data-per-year>');
    // 80 at 17 in 150 is 9 regulars, $50,220 a year at $5,580 each
    expect(textOf(calc)).toContain(
      `If they come back like a landscaper's past customers did: 11% come back when asked 9 regulars back $50,220 a year, back on your schedule Capital City Landscaping, NH, a landscaper: 17 booked out of 150 past customers asked. Your first 150 show your real number. ${LABEL}`,
    );
    expect(html).not.toMatch(/id="rPay"|id="estNote"/);
  });

  it("leads with Capital City as a landscaper's past customers, names every other shop's trade, and labels them all", () => {
    expect(textOf(blocks(html, /<figure class="tally">/, "figure")[0]!)).toBe(`Capital City Landscaping, NH · a landscaper's past customers 150 asked 28 wrote back 17 booked $34k in jobs ${LABEL}`);
    const [capital, nelson, dows] = cards(html).map(textOf);
    expect(capital).toContain("Capital City Landscaping NH · a landscaper's past customers $34,000 in jobs");
    expect(nelson).toContain("Nelson Fence CT · a fence company's old quotes $19,800 in jobs");
    expect(dows).toContain(`Dow's Tree Service NH · a tree company's old quotes $10,000+ in jobs`);
    expect(dows).toContain(`${LABEL} ${FAMILY}`);
    expect(textOf(blocks(html, /<div class="plan free">/, "ul")[0]!)).toContain(`12–28 wrote back 4–17 booked $10k–$34k in jobs ${LABEL} ${FAMILY}`);
    expect(count(text, LABEL)).toBe(6);
    expect(count(text, FAMILY)).toBe(2);
  });

  it("shows the cleaning note the engine writes to a regular who stopped, labeled an example", () => {
    const note = textOf(blocks(html, /<div class="nb"/, "div")[0]!);
    expect(note).toBe(`Hi Nancy, Sarah at Ridgeline Cleaning. We haven't been by for the regular cleaning since September 1, and I wanted to make sure you're all set. Want us back on your usual schedule? Reply with a day that works and I'll put you back on. Sarah`);
    expect(count(html, "Note 1 &middot; Example")).toBe(2);
    expect(count(html, "Example &middot; a text to you")).toBe(2);
    expect(count(html, '<span class="ex-tag">Example</span>')).toBe(2);
    expect(blocks(html, /<div class="hero-side"/, "p")[0]).toContain('<p class="qw-day">Example</p>');
  });

  it("keeps each example customer to one story: the engine's note and text are to the first one on the list, and no one in the hero", () => {
    const sms = textOf(blocks(html, /<div class="sms">/, "p")[0]!);
    const note = textOf(blocks(html, /<div class="nb"/, "div")[0]!);
    const [, first, last, street] = /NEW — (\w+) (\w+), (.+?) Last job/.exec(sms)!;
    const [, month, job] = /Last job: (\w{3}) \d+ · \$[\d,]+ · (.+?) They said/.exec(sms)!;
    expect(textOf(blocks(html, /<li class="we">/, "li")[0]!)).toContain(`Example ${first![0]}. ${last} · ${job!.toLowerCase()} ${month} 2026 `);
    const side = blocks(html, /<div class="hero-side"/, "section")[0]!;
    const hero = [...side.matchAll(/<b class="qw-title">([^<]*) wants it done<\/b>[\s\S]*?<span class="qw-meta">([^<&]*)/g)].map((m) => [m[1]!, m[2]!.trim()] as const);
    expect(hero).toEqual([["Karen Doucette", "22 Summer St"], ["Mark Lefebvre", "5 Church St"]]);
    for (const [name, at] of hero) for (const part of [...name.split(" "), at]) for (const engine of [sms, note]) expect(engine, part).not.toMatch(new RegExp(`\\b${part}\\b`));
    expect(textOf(side)).not.toMatch(new RegExp(`\\b(?:${first}|${last}|${street})\\b`));
  });

  it("asks Jobber for its Visits report, and anyone else for the brief's one line, with no vendor's menu path", () => {
    expect(textOf(/<p data-step="jobber">([\s\S]*?)<\/p>/.exec(html)![1]!)).toBe("In Jobber: Insights → Reports → Visits → All time → Export to CSV. It doesn't download; Jobber emails it to your login address.");
    expect(textOf(/<p data-step="other" hidden>([\s\S]*?)<\/p>/.exec(html)![1]!)).toBe("Send any export of your clients with their last cleaning date and email. We'll text you where to click.");
    // Jack texts the BookingKoala, Launch27 and ZenMaid clicks; the page names those tools only in the FAQ and the hero's
    // "Works from your export" strip, never with a path
    const strip = textOf(blocks(html, /<div class="works">/, "div")[0]!);
    for (const tool of ["BookingKoala", "Launch27", "ZenMaid"]) {
      expect(count(text, tool), tool).toBe(2);
      expect(strip, tool).toContain(tool);
    }
    expect(text).not.toMatch(/time logs|data exports|download (booking )?csv|pro max/i);
    expect(answer(html, "I don't use Jobber.")).toBe(`BookingKoala, Launch27, ZenMaid, Housecall Pro or a spreadsheet. Anything that exports your clients with their last cleaning date and email works. Pick "Something else" at the top and we'll text you where to click.`);
  });

  it("after the form, asks how many new regulars he can take, and only this page asks", () => {
    const done = textOf(html.slice(html.indexOf('<div class="done" id="done"'), html.indexOf('<form name="start"')));
    expect(done).toMatch(/3 You'll get a text from Jack .* The first notes go out the next weekday morning\. One question we'll text you: how many new regulars can you take this month\? We pace the notes to that\.$/);
    for (const other of PAGES.filter((x) => x !== p)) expect(rendered(`${other.id}/index.html`, other), other.id).not.toContain('class="pace"');
  });

  it("answers what the software backs, the new monthly questions and 'We're booked solid.', in the brief's words", () => {
    expect(answer(html, "We're booked solid.")).toBe("Tell us how many you can take. We pace the notes to it.");
    const answers = faq(html);
    expect(answers).toContain("change anything you want and text OK. The first notes go out the next weekday morning.");
    expect(answers).toContain("Up to three short notes over a week or two");
    expect(answers).toContain("The first 150 are free (then $497 a month if you say yes), so you see your own numbers before you pay anything.");
    expect(answers).toContain("a person, not a bot, reads every reply");
    expect(answer(html, "How do I cancel?")).toBe("Text 603-340-7673 and say you're done. That's the whole process. Nothing goes out after that.");
    expect(answer(html, "When do I pay, and how?")).toBe(answer(rendered("lawn/index.html", lawn), "When do I pay, and how?"));
    expect(answer(html, "What counts as asking to come back?")).toBe("Someone we wrote to asks for a date, a price or their old slot. You get each one by text, the same day.");
    expect(MONTHLY_PROMISES.some((x) => answer(html, "What if nothing comes back?").includes(x))).toBe(true);
    const jobber = textOf(blocks(html, /<section class="sec band" id="jobber">/, "section")[0]!);
    expect(jobber).toContain("A month nobody asks to come back The add-on bills anyway $0");
    for (const id of ["jobber-campaigns-not-retroactive", "jobber-campaigns-add-on"]) expect(jobber).toContain(`${claim(id)!.text}`);
  });
});

/* ------------------------------ the one-pass pages: tree, painting, fence ------------------------------ */

describe.each(PAGES.filter((p) => p.words.offer === "one_pass").map((p) => [`/${p.id}`, p] as const))("%s, a one-pass page", (_path, p) => {
  const html = rendered(`${p.id}/index.html`, p);
  const text = visibleText(html);

  it("leads with the result and the one-pass promise, and sends one_pass with the page's trade", () => {
    expect(promise(html)).toBe(ONE_PASS_PROMISE);
    expect(textOf(blocks(html, /<ul class="ticks/, "ul")[0]!)).toBe("No card to start No call, no contract Your part: forward your exports (about five minutes)");
    expect(p.words).toBe(ONE_PASS);
    expect(ONE_PASS.consent).toBe(`${MONTHLY.consent} I'll pay $250 for each job that books from these notes (the customer wrote back and booked within 60 days), never more than $1,000. No card now.`);
    expect(textOf(blocks(html, /<div class="sticky"/, "a")[0]!)).toBe("$250 per booked job never more than $1,000 Get my first note →");
    // the form in the hero: copy first, then the form, then the ticks and the tally on a phone
    const hero = blocks(html, /<section class="hero"/, "section")[0]!;
    expect(hero).toMatch(/<div class="wrap kgrid">\s*<div class="kcopy">/);
    expect(hero).toContain('<div class="k4"><div class="fcard" id="start">');
    expect(text).not.toMatch(/preview/i);
  });

  it("asks for two exports from Jobber or Housecall Pro, in the picker and in how it works", () => {
    expect(picker(html)).toEqual([["jobber", "Emails you two files"], ["housecall_pro", "Forward two reports"], ["other", "Any export or spreadsheet"]]);
    expect(textOf(blocks(html, /<li class="you">/, "li")[0]!)).toContain("past jobs: two emails from Jobber or Housecall Pro, or an export from whatever you use. About five minutes.");
  });

  it("works out the calculator at Nelson Fence's 2.7%, and what he'd pay: $250 a job, four at most", () => {
    const s = p.calc;
    const jobs = Math.round((s.count.value * 4) / 150);
    const value = jobs * s.job.value;
    const pay = Math.min(jobs, 4) * 250;
    expect(s.rateLine).toBe("If they book like Nelson Fence's quotes did:");
    const calc = blocks(html, /<div class="calc"/, "section")[0]!;
    expect(calc).toContain(`data-booked="4" data-asked="150" data-each="250" data-cap="4"`);
    expect(textOf(calc)).toContain(`If they book like Nelson Fence's quotes did: 2.7% book when asked ${jobs} jobs booked $${value.toLocaleString("en-US")} left on the table, plus your past customers`);
    expect(calc).toContain(`<p class="pay">You'd pay <b id="rPay">$${pay.toLocaleString("en-US")}</b>, that's <b id="rShare">${Math.round((pay / value) * 1000) / 10}%</b> of it.</p>`);
    // the reviews estimate waits for a ?q= link
    expect(calc).toContain(`<p class="fine" id="estNote" hidden>${s.estimate}</p>`);
    expect(s.estimate).toMatch(/from your public Google reviews\. Your export gives the real count\.$/);
  });

  it("prices the one pass in one card, in the brief's words", () => {
    expect(textOf(blocks(html, /<section class="sec" id="pricing">/, "section")[0]!)).toBe(
      "Pricing You pay when a job books. One pass through your list $250 per booked job. Never more than $1,000. Nothing books: $0. " +
        "No card to start. When the first job books, we text you a link for the $250. It saves your card for the rest, and we text before every charge. " +
        "What counts: someone wrote back to one of our notes and booked with you within 60 days. One charge per customer, however many jobs they book. Job cancels before the work? You get the $250 back. " +
        "When it ends: when your list is done, about four weeks. No contract. Nothing renews. Get my first note → $250 per booked job, never more than $1,000",
    );
  });

  it("answers what the software backs, and the one-pass questions, in the brief's words", () => {
    const answers = faq(html);
    expect(answers).toContain("change anything you want and text OK. The first notes go out the next weekday morning.");
    expect(answers).toContain("Up to three short notes over a week or two");
    expect(answers).toContain("a person, not a bot, reads every reply and texts it to you the same day. Text us and we'll delete your list.");
    expect(answer(html, "How do I cancel?")).toBe("Text 603-340-7673 and say you're done. That's the whole process. Nothing goes out after that. You pay only for jobs from our notes that booked before you cancelled.");
    // "When do I pay?" is the pricing card word for word, from its big line through when it ends
    expect(answer(html, "When do I pay?")).toBe(textOf(blocks(html, /<p class="price">/, "div")[0]!));
    expect(answer(html, "When do I pay?")).toBe(
      "$250 per booked job. Never more than $1,000. Nothing books: $0. " +
        "No card to start. When the first job books, we text you a link for the $250. It saves your card for the rest, and we text before every charge. " +
        "What counts: someone wrote back to one of our notes and booked with you within 60 days. One charge per customer, however many jobs they book. Job cancels before the work? You get the $250 back. " +
        "When it ends: when your list is done, about four weeks. No contract. Nothing renews.",
    );
    expect(answer(html, "What if I book someone on my own?")).toBe("Only people who wrote back to our notes count. If we text you a booking that wasn't ours, reply NOT OURS before the charge date and it's off. Already charged? Tell Jack, and if it wasn't ours, he refunds it.");
    expect(answer(html, "Is there a contract?")).toBe("No. One pass through your list, then it's done. If your list keeps filling up, we'll offer to keep it going monthly.");
    expect(answer(html, "What if nothing comes back?")).toBe("Then you owe nothing, and we'll be the ones to tell you. You'll know within three weeks of the first batch.");
    expect(answers).not.toMatch(/keep only what the notes need/);
  });

  it("goes back three years, the most the software reads, beside Jobber's own documented limit", () => {
    const jobber = textOf(blocks(html, /<section class="sec band" id="jobber">/, "section")[0]!);
    expect(jobber).toMatch(/How far back Two reminders, within 90 days (Quotes|Estimates) up to three years old/);
    const c = claim("jobber-two-reminders")!;
    expect(jobber).toContain(`${c.text} Source: ${c.source}.`);
    expect(text).toContain("The whole list in about four weeks.");
    expect(blocks(html, /<p class="friday">/, "p").map(textOf)).toEqual(["Every Friday: a text with your week. Asked, wrote back, booked."]);
  });

  it("keeps each example customer to one story: the engine's note and text go to the first one on the list, and no one else's", () => {
    const sms = textOf(blocks(html, /<div class="sms">/, "p")[0]!);
    const note = textOf(blocks(html, /<div class="nb"/, "div")[0]!);
    const [, first, last, street] = /NEW — (\w+) (\w+), (.+?) Quote:/.exec(sms)!;
    const [, price, what] = /Quote: \w{3} \d+(?:, \d{4})? · (\$[\d,]+) · (.+?) (?:Heads up|They said)/.exec(sms)!;
    const find = textOf(blocks(html, /<li class="we">/, "li")[0]!);
    expect(find).toContain(`Example ${first![0]}. ${last} · the ${what} ${price} `);
    // the rest of the list are other people, who never show up in his note or his text
    const others = [...find.matchAll(/\b[A-Z]\. (\w+) · /g)].map((m) => m[1]!).filter((x) => x !== last);
    expect(others).toHaveLength(2);
    for (const other of others) for (const engine of [sms, note]) expect(engine, other).not.toContain(other);
    // he's on the list once, and in the text he'd get (shown twice: in the hero, and in how it works)
    expect(count(text, last!)).toBe(3);
    expect(count(text, street!)).toBe(2);
  });
});

describe("/tree", () => {
  const p = page("tree");
  const html = rendered("tree/index.html", p);

  it("is for tree companies, in the brief's words", () => {
    expect(textOf(/<p class="eyebrow k1">([^<]*)<\/p>/.exec(html)![1]!)).toBe("For tree companies");
    expect(h1(html)).toBe("Your old quotes and past customers, booked.");
    expect(textOf(blocks(html, /<li class="we">/, "li")[0]!)).toContain("Find every quote that never booked, and every past customer.");
    expect(textOf(blocks(html, /<section class="sec start-sec" id="final">/, "section")[0]!)).toBe("Those quotes get colder every week. Winter is removal season. Nothing books, you owe nothing. Get my first note → $250 per booked job, never more than $1,000");
  });

  it("leads with Nelson Fence, then Dow's with the disclosure, then Capital City as a landscaper's past customers", () => {
    const tally = textOf(blocks(html, /<figure class="tally">/, "figure")[0]!);
    expect(tally).toBe(`Nelson Fence, CT · first 150 150 asked 12 wrote back 4 booked $19.8k in jobs ${LABEL}`);
    const [nelson, dows, capital] = cards(html).map(textOf);
    expect(nelson).toContain("Nelson Fence CT · old quotes $19,800 in jobs");
    expect(dows).toContain(`Dow's Tree Service NH · old quotes $10,000+ in jobs`);
    expect(dows).toContain(`${LABEL} ${FAMILY}`);
    expect(capital).toContain("Capital City Landscaping NH · a landscaper's past customers $34,000 in jobs");
    expect(textOf(blocks(html, /<div class="calc-out"/, "section")[0]!)).toContain("Nelson Fence, CT: 4 booked out of their first 150 old quotes. Older quotes book less often; your list shows your real rate.");
  });

  it("explains $250 with both old-quote shops, labeled, and says whose Dow's is", () => {
    expect(answer(html, "Why $250?")).toBe(`Our two old-quote shops, Nelson Fence and Dow's, each booked 4 from 150. ${LABEL} ${FAMILY} $250 is about a tenth of a typical tree job, and you pay it only after the customer's booked.`);
  });
});

describe("/painting", () => {
  const p = page("painting");
  const html = rendered("painting/index.html", p);
  const text = visibleText(html);

  it("says estimates, not quotes, wherever the words are the page's own", () => {
    expect(textOf(/<p class="eyebrow k1">([^<]*)<\/p>/.exec(html)![1]!)).toBe("For painting companies");
    expect(h1(html)).toBe("Your old estimates and past customers, booked.");
    expect(text).toContain("You've got estimates in there that never booked.");
    expect(text).toContain("Find every estimate that never booked, and every past customer.");
    expect(text).toContain("Archived estimates Never get one");
    expect(text).toContain("What about estimates with no email?");
    expect(textOf(blocks(html, /<section class="sec start-sec" id="final">/, "section")[0]!)).toContain("Those estimates get colder every week. Thanksgiving to tax time is slow. Fill it with estimates you already wrote. Nothing books, you owe nothing.");
    // the engine's own note to the example customer never says "quote" either
    expect(textOf(blocks(html, /<div class="nb"/, "div")[0]!)).not.toMatch(/quote/i);
  });

  it("never names Dow's or a tree job, even in a total, and labels Nelson Fence as a fence company's list", () => {
    expect(html).not.toMatch(/Dow's|ryan-text/);
    expect(html).not.toMatch(/\btree\b/i);
    expect(answer(html, "Why $250?")).toBe(`Nelson Fence, a fence company, booked 4 from its first 150 old quotes. ${LABEL} You pay it only after the customer's booked.`);
    const fence = "a fence company's old quotes: different trade, same kind of list";
    expect(textOf(blocks(html, /<figure class="tally">/, "figure")[0]!)).toBe(`Nelson Fence, CT · ${fence} 150 asked 12 wrote back 4 booked $19.8k in jobs ${LABEL}`);
    const [nelson, capital] = cards(html).map(textOf);
    expect(nelson).toContain(`Nelson Fence CT · ${fence} $19,800 in jobs`);
    expect(capital).toContain("Capital City Landscaping NH · a landscaper's past customers");
    expect(text).toContain("What the first 150 did for two shops.");
  });

  it("shows the painting lead cost from claims.ts, with its source beside it", () => {
    const lead = claim("lead-cost-painting")!;
    const money = textOf(blocks(html, /<section class="sec" id="money">/, "section")[0]!);
    expect(money).toContain(`${lead.text} You already did the hard part on every one`);
    expect(money).toContain(`Lead cost: ${lead.source}.`);
    expect(count(text, "$138")).toBe(1);
  });

  it("starts the calculator on the painting entry's example numbers", () => {
    expect(p.calc.count).toMatchObject({ label: "Estimates that never booked", value: 400 });
    expect(p.calc.job).toMatchObject({ label: "Your average job", value: 4500, money: true });
    expect(html).toContain('<output id="oN" for="cN">400</output><small class="eg" id="cNEg">Example</small>');
    expect(html).toContain('<output id="oJ" for="cJ">$4,500</output><small class="eg" id="cJEg">Example</small>');
  });
});

describe("/fence", () => {
  const p = page("fence");
  const html = rendered("fence/index.html", p);

  it("is for fence companies, from the same template", () => {
    expect(textOf(/<p class="eyebrow k1">([^<]*)<\/p>/.exec(html)![1]!)).toBe("For fence companies");
    expect(h1(html)).toBe("Your old quotes and past customers, booked.");
    expect(cards(html).map((c) => textOf(/<h3>(.*?)<\/h3>/.exec(c)![1]!))).toEqual(["Nelson Fence", "Dow's Tree Service", "Capital City Landscaping"]);
    expect(answer(html, "Why $250?")).toBe(`Our two old-quote shops, Nelson Fence and Dow's, each booked 4 from 150. ${LABEL} ${FAMILY} You pay it only after the customer's booked.`);
    expect(textOf(blocks(html, /<section class="sec start-sec" id="final">/, "section")[0]!)).toContain("Spring is the busiest fence season. Nothing books, you owe nothing.");
  });

  it("is built, but no page links to it", () => {
    expect(p.unlinked).toBe(true);
    for (const other of [rendered("index.html"), ...PAGES.map((x) => rendered(`${x.id}/index.html`, x))]) expect(other).not.toMatch(/href="\/fence/);
  });
});

describe("/", () => {
  const html = rendered("index.html");

  it("is the logo, one line and two cards, linking only pages that are built and meant to be found", () => {
    expect(h1(html)).toBe("We write to your old customers and quotes in your name. You get a text when one wants the work.");
    const offers = blocks(html, /<article class="offer">/, "article").map(textOf);
    expect(offers).toEqual([`${MONTHLY.card.title} ${MONTHLY.card.text} Lawn and landscaping → House cleaning →`, `${ONE_PASS.card.title} ${ONE_PASS.card.text} Tree service → Painting →`]);
    expect(MONTHLY.card.text).toBe("Past customers back on your schedule. First 150 free, then $497 a month if you say yes.");
    expect(ONE_PASS.card.text).toBe("One pass through your old quotes and past customers. $250 per booked job, never more than $1,000.");
    const links = [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]).filter((h) => !h!.startsWith("/src/"));
    // the footer's privacy and terms links are the live site's own pages, not more of ours
    expect(links).toEqual(["/lawn", "/cleaning", "/tree", "/painting", ...POLICIES.map(([href]) => href)]);
    expect(html).not.toMatch(/<form|<script|class="btn"/);
  });

  it("keeps the words rules, and the footer", () => wordRules(html));
});
