import { z } from "zod";
import { fmtMoney, lint, type AccountState, type Opportunity, type Touch } from "@qa/engine";
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
 *  - introduces no dollar amounts, dates, discounts or promises that aren't in the record
 *  - stays under 110 words
 */
export async function personalizeFirstNote(llm: Llm, state: AccountState, o: Opportunity, t: Touch): Promise<{ subject: string; body: string } | null> {
  if (t.step !== 1) return null;
  const b = state.dataset.business;
  const c = state.dataset.customers.find((x) => x.id === o.customerId);
  if (!c) return null;
  const footerIdx = t.body.lastIndexOf("\n\n" + b.name);
  const templateBody = footerIdx > 0 ? t.body.slice(0, footerIdx) : t.body;
  const footer = footerIdx > 0 ? t.body.slice(footerIdx) : "";
  const q = o.source.kind === "quote" ? state.dataset.quotes.find((x) => x.id === o.source.id) : undefined;
  const facts = [
    `Customer first name: ${c.firstName || "(unknown — use 'there')"}`,
    `Job phrase to use: "${o.jobPhrase}"`,
    `Why we're writing: ${o.reason}`,
    q ? `Quote title: ${q.title}` : "",
    q?.lineItems.length ? `Line items: ${q.lineItems.map((l) => `${l.name}${l.optional ? " (optional)" : ""}`).join("; ")}` : "",
    c.address?.street ? `Street: ${c.address.street}` : "",
    b.voice.mentionPrice && o.value ? `You MAY mention the original price: ${fmtMoney(o.value)}` : "Do NOT mention any price.",
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
  const words = body.split(/\s+/).length;
  const newMoney = (body.match(/\$\s?\d[\d,]*/g) ?? []).filter((m) => !(b.voice.mentionPrice && o.value && m.replace(/\D/g, "") === String(Math.round(o.value))));
  const introducesDate = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{1,2}\/\d{1,2}\b/i.test(body) && !/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(templateBody);
  const full = `${body}${footer}`;
  const flags = lint(out.subject, full, { firstName: c.firstName, job: o.jobPhrase, requireJob: true });
  if (flags.length || newMoney.length || introducesDate || words > 110 || !body.toLowerCase().includes(o.jobPhrase.toLowerCase())) return null;
  return { subject: out.subject.trim(), body: full };
}
