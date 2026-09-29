import { z } from "zod";
import type { ReadingOverride } from "@qa/engine";
import type { Llm } from "./llm.ts";

const INTENTS = ["wants_it", "wants_price", "question", "later", "already_done", "not_interested", "moved", "wrong_person", "stop", "complaint", "auto_reply", "bounce", "unclear"] as const;

const ReplySchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  summary: z.string().describe("Under 70 characters, plain English, for a text to the business owner. No emojis."),
  followUpOn: z.string().nullable().describe("YYYY-MM-DD when they asked to be contacted later, else null"),
  phone: z.string().nullable(),
  bestTime: z.string().nullable(),
});

const SYSTEM = `You read replies that homeowners send to a small home-service company (tree, lawn, septic, fence, concrete, pressure washing...). The company had emailed them about a quote they never booked or work that's due again.
Classify the reply's intent. Rules, in priority order:
1. Any request to stop, unsubscribe, or not be contacted — even mixed with other content — is "stop". Hostility, spam accusations, or "how did you get my email" is "complaint".
2. Delivery failures are "bounce"; vacation/out-of-office responders are "auto_reply".
3. "moved" = sold the house / no longer lives there. "wrong_person" = never asked for a quote / wrong address / who is this.
4. "already_done" = someone else did it, did it themselves, it's no longer needed. "not_interested" = a plain no.
5. "later" = not now but maybe at a time (extract followUpOn as an ISO date relative to TODAY if a time is named: spring = next Mar 15, summer = Jun 1, fall = Sep 15, winter = Dec 1, next month = +30 days, after the holidays = Jan 5).
6. "wants_it" = yes / schedule it / come look / call me. "wants_price" = asks for a new or updated price, a discount, or what it costs now. "question" = asks something a person must answer before deciding.
7. "unclear" only if a careful person truly couldn't tell.
Be calibrated: confidence is your honest probability you're right.`;

/** Second opinion on a reply the rule-based reader wasn't sure about. */
export async function readReplyWithClaude(llm: Llm, input: { text: string; subject?: string; today: string; businessName: string }): Promise<ReadingOverride | null> {
  const out = await llm.structured(ReplySchema, {
    purpose: "inbox.classify",
    effort: "low",
    maxTokens: 1024,
    system: SYSTEM,
    user: `TODAY: ${input.today}\nCOMPANY: ${input.businessName}\nSUBJECT: ${input.subject ?? ""}\n\nREPLY (already stripped of quoted history):\n"""\n${input.text.slice(0, 4000)}\n"""`,
  });
  if (!out) return null;
  return {
    intent: out.intent,
    confidence: out.confidence,
    summary: out.summary,
    extracted: {
      followUpOn: out.followUpOn ?? undefined,
      phone: out.phone ?? undefined,
      bestTime: out.bestTime ?? undefined,
    },
    source: "claude",
  };
}

const DraftSchema = z.object({
  draft: z.string().describe("A short plain-text reply for the owner/office to approve. Never invent prices, dates, availability or services not in the context."),
  needsOwner: z.boolean().describe("true if the owner must answer (price, availability, scope)"),
});

/** Draft an answer to a homeowner's question for the office to approve. Never sent automatically. */
export async function draftAnswer(llm: Llm, input: { question: string; job: string; businessName: string; signer: string; services: string[] }): Promise<{ draft: string; needsOwner: boolean } | null> {
  return llm.structured(DraftSchema, {
    purpose: "inbox.draft",
    effort: "low",
    maxTokens: 1024,
    system: `You draft replies for ${input.businessName}, a small home-service company. Plain text, 2-4 short sentences, friendly and direct, signed "${input.signer}". Only state facts given in the context. If the answer depends on price, dates, crew availability, insurance details or anything not given, say the owner will call and set needsOwner=true.`,
    user: `They were contacted about: ${input.job}\nServices the company offers: ${input.services.join(", ")}\nTheir message:\n"""\n${input.question.slice(0, 3000)}\n"""`,
  });
}
