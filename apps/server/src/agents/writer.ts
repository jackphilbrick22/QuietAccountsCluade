import { z } from "zod";
import { fmtMoney, lint, STALE_QUOTE_DAYS, type AccountState, type Opportunity, type Touch } from "@qa/engine";
import type { Llm } from "./llm.ts";

const NoteSchema = z.object({
  subject: z.string(),
  body: z.string().describe("The note body WITHOUT the footer. Plain text."),
});

/**
 * Optional: let Claude make the FIRST note more specific to the person's actual record
 * (line items, the street, what they asked for) while keeping the office's voice.
 * Guardrails — the rewrite is thrown away and the template kept unless ALL hold:
 *  - passes the same quality gate as the templates (no links, no spam words, has an ask...)
 *  - mentions the job phrase
 *  - introduces nothing the template and the record don't already say (see `invented`)
 *  - stays under 110 words
 */
export async function personalizeFirstNote(llm: Llm, state: AccountState, o: Opportunity, t: Touch): Promise<{ subject: string; body: string; flags: string[] } | null> {
  if (t.step !== 1) return null;
  const b = state.dataset.business;
  const c = state.dataset.customers.find((x) => x.id === o.customerId);
  if (!c) return null;
  const footerIdx = t.body.lastIndexOf("\n\n" + b.name);
  const templateBody = footerIdx > 0 ? t.body.slice(0, footerIdx) : t.body;
  const footer = footerIdx > 0 ? t.body.slice(footerIdx) : "";
  const q = o.source.kind === "quote" ? state.dataset.quotes.find((x) => x.id === o.source.id) : undefined;
  // the same rule as the template: a live quote's own price, never an old one or a modelled one
  const mayPrice = b.voice.mentionPrice && o.value > 0 && ["unanswered_quote", "archived_quote", "changes_requested"].includes(o.type) && o.ageDays <= (b.voice.staleQuoteDays ?? STALE_QUOTE_DAYS);
  const facts = [
    `Customer first name: ${c.firstName || "(unknown — use 'there')"}`,
    `Job phrase to use: "${o.jobPhrase}"`,
    `Why we're writing: ${o.reason}`,
    q ? `Quote title: ${q.title}` : "",
    q?.lineItems.length ? `Line items: ${q.lineItems.map((l) => `${l.name}${l.optional ? " (optional)" : ""}`).join("; ")}` : "",
    c.address?.street ? `Street: ${c.address.street}` : "",
    mayPrice ? `You MAY mention the original price: ${fmtMoney(o.value)}` : "Do NOT mention any price.",
  ].filter(Boolean);
  const out = await llm.structured(NoteSchema, {
    purpose: "writer.personalize",
    effort: "medium",
    maxTokens: 1500,
    system: `You write short follow-up notes for ${b.name}, a small ${b.trade.replace("_", " ")} company. The note is signed by ${b.signerName} (${b.signerRole === "owner" ? "the owner" : "from the office"}).
Style: plain text, 40-90 words, like a real person at a small company typed it. One specific reference to their job, one easy question at the end. No links, no exclamation marks, no marketing words (free, deal, discount, guarantee, limited time), no emojis, no ALL CAPS.
Hard rule: use ONLY the facts provided. Never invent prices, discounts, dates, crew availability, warranties or anything else.
Start with "Hi <first name>," and end with the signer's first name on its own line.`,
    user: `FACTS:\n${facts.join("\n")}\n\nCURRENT TEMPLATE NOTE (improve its specificity, keep its intent):\nSubject: ${t.subject}\n${templateBody}`,
  });
  if (!out) return null;
  const body = out.body.trim();
  const subject = out.subject.trim();
  const words = body.split(/\s+/).length;
  // what the rewrite may repeat: the template itself, plus the record (street number, quote title, allowed price)
  const allowed = [t.subject ?? "", templateBody, ...facts.filter((f) => !/^Why we're writing/.test(f))].join("\n");
  if (invented(`${subject}\n${body}`, allowed).length) return null;
  const full = `${body}${footer}`;
  const flags = lint(subject, full, { firstName: c.firstName, job: o.jobPhrase, requireJob: true, step: 1, commercial: o.type !== "unpaid_invoice" });
  if (flags.length || words > 110 || !body.toLowerCase().includes(o.jobPhrase.toLowerCase())) return null;
  return { subject, body: full, flags };
}

/**
 * Claims a rewrite made up: anything in `text` that commits the business to money, a date, a deal or a crew
 * and isn't already in `allowed` (the template and the record). A prompt rule alone doesn't stop a model from
 * writing "$200 off if we're out next Tuesday", so these are checked after the fact. Empty = nothing invented.
 */
export function invented(text: string, allowed: string): string[] {
  const have = allowed.toLowerCase();
  const found: string[] = [];
  // any number the template and the record don't have: prices, "5 year", dates, "15%", "2 crews"
  const nums = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]+$/, "").replace(/,/g, ""));
  const known = new Set(nums(allowed));
  for (const n of nums(text)) if (!known.has(n)) found.push(n);
  for (const re of RISKY) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) {
      if (!have.includes(m[0].toLowerCase())) found.push(m[0]);
    }
  }
  return [...new Set(found)];
}

const RISKY: RegExp[] = [
  // money and percentages, spelled out too
  /\$|%|\bpercent\b|\bdollars?\b|\bbucks\b|\b(hundred|thousand|grand)\b/i,
  // days, weeks, months: a date the template didn't give is a promise nobody made
  /\b(today|tonight|tomorrow|weekend|week|weeks|month|months|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b/i,
  /\b(in|by|early|late|mid|last|this|next|until|through|since) may\b/i,
  // deals and promises
  /\b(discount\w*|deal|deals|sale|sales? price|free|no charge|no cost|complimentary|on the house|save|saving|savings|coupon|promo\w*|special|rebate|off (the|your) (price|quote|total|bill|number|original)|price match|match (any|their|a|the)|lowest|cheapest|warrant\w*|guarantee\w*|insured|bonded|licensed)\b/i,
  // crews, openings and the schedule
  /\b(crew|crews|team|truck|tech|techs|technician|opening|openings|open (day|days|slot|slots|spot|spots|week)|availability|available|slot|slots|nearby|in (your|the) (area|neighborhood)|on your street|next door|schedule|scheduled|booked|book you|come out|be out|swing by)\b/i,
];
