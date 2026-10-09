import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { lintMarketing } from "@qa/engine";
import { ADDRESS, CALL, POLICIES, renderPage } from "../build/render.ts";
import { LABEL, PAGES, type SitePage } from "../src/trades.ts";

/** The pages as the build writes them (markers filled), and plain-text views of them for the word rules. */
export const page = (id: string) => PAGES.find((p) => p.id === id)!;
export const lawn = page("lawn");
/** The all-trades site's pages that carry the film (film.test.ts), each its own trade's film. */
export const FILMED = ["lawn-site", "cleaning-site", "fence-site", "tree-site"];
/** Their cold email pages, the link in each trade's "show me" reply: the film too. */
export const FILMED_COLD = FILMED.map((id) => id.replace(/-site$/, "-cold-email-page"));

export function rendered(file: string, page?: SitePage): string {
  return renderPage(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), page);
}

export function unescape(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|middot|rarr|ndash);/g, (_m, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", middot: "·", rarr: "→", ndash: "–" })[e]!);
}

/** What a visitor can read: no head (but its description), no scripts, no hidden Netlify copy, tags dropped. */
export function visibleText(html: string): string {
  const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "";
  const body = html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<form name="start"[\s\S]*?<\/form>/, "")
    .replace(/<[^>]+>/g, " ");
  return unescape(`${description} ${body}`).replace(/\s+/g, " ").trim();
}

/** Every element of a kind, from its opening tag to its matching close (no nesting of the same tag inside). */
export function blocks(html: string, open: RegExp, tag: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(open.source, "g"))) out.push(html.slice(m.index, html.indexOf(`</${tag}>`, m.index) + tag.length + 3));
  return out;
}

export const textOf = (html: string) => unescape(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** The brief's rules for every page (§1 words, §5 rules 1–10 and "Claims the software doesn't back"), checked on the built HTML. */
export const BANNED = /7am to 8pm|money map|reply desk|ready text|every month after|year floor|money-back|risk-free|free trial|guaranteed \d+\s?%|price or a date|preview only|tom alvarez|\$29|pick the day|over about a week|still goes out|deleted 30 days|saved on your own page|open days near you|one-page report|four years old|every friday,? your quiet rate|spots? left|countdown/i;
export const count = (s: string, part: string) => s.split(part).length - 1;

/** The words rules every page keeps, and its trust footer. */
export function wordRules(html: string, offer?: SitePage["words"]["offer"]) {
  const text = visibleText(html);
  expect(text).not.toMatch(BANNED);
  expect(lintMarketing(text)).toEqual([]);
  // "free" always has its price beside it, and a one-pass page has no free offer at all
  if (offer === "one_pass") expect(text).not.toMatch(/\bfree\b|\$497|any month nobody/i);
  for (const m of text.matchAll(/\bfree\b/gi)) expect(text.slice(Math.max(0, m.index - 90), m.index + 90), `"free" at ${m.index}`).toMatch(/\$497/);
  // a shop's result, in any sentence, carries the label; no page says who owns Dow's (Jack took that line off, Oct 3)
  for (const m of text.matchAll(/\bbooked \d+ from\b|\b\d+ booked out of\b/g)) expect(text.slice(m.index, m.index + 300), `result at ${m.index}`).toContain(LABEL);
  expect(text).not.toMatch(/\buncle\b|owned by Jack/i);
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
