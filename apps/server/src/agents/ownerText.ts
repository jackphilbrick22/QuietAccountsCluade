import { z } from "zod";
import type { Reply } from "@qa/engine";
import type { Llm } from "./llm.ts";

const ReadingSchema = z.object({
  outcome: z
    .enum(["booked", "lost", "quoted", "no_answer", "reached", "unclear"])
    .describe(
      "booked: the homeowner hired THIS owner's company. lost: they won't (hired someone else, decided not to, sold the house). quoted: the owner gave them a price and they haven't decided, including while they compare other companies' prices. no_answer: the owner tried and couldn't reach them. reached: they talked, nothing decided. unclear: anything else, or when the text could be read more than one way.",
    ),
  amount: z.number().nullable().describe("The dollar value of THIS owner's booked job, only if it is written in the text. Never a competitor's price or a difference in price. null if none."),
});

const SYSTEM = `You read one text message from the owner of a small home-service company (tree, fence, painting, cleaning...). We handed them a lead: a homeowner who answered our follow-up. The owner is texting us what happened with that lead.
Decide what happened for the OWNER's company, not for anyone else. Other companies, their prices and their wins are about the homeowner shopping around or hiring someone else.
If you are not sure, or the text mixes two outcomes, answer "unclear": a person will read it. Never guess a booking.`;

/** Every standalone amount written in the text (the digits of the #code excluded). */
function amountsIn(text: string): number[] {
  const body = text.replace(/#\s?[a-z0-9]{3}\b/gi, " ");
  const out: number[] = [];
  for (const m of body.matchAll(/\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(k)?\b/gi)) out.push(Number(`${m[1]!.replace(/,/g, "")}.${m[2] ?? "0"}`) * (m[3] ? 1000 : 1));
  return out;
}

/**
 * A second read of an owner's text the rules shouldn't decide alone (it talks about another company). Claude says what
 * happened for the owner; an amount counts only if it's written in the text. "unclear", a failure, or no Claude at
 * all: a person reads it.
 */
export async function readLeadTextWithClaude(llm: Llm | null, text: string): Promise<{ outcome?: Reply["outcome"]; amount: number; unclear?: true }> {
  if (!llm) return { amount: 0, unclear: true };
  const out = await llm.structured(ReadingSchema, { purpose: "owner.lead_text", effort: "low", maxTokens: 512, system: SYSTEM, user: `OWNER'S TEXT:\n"""\n${text.slice(0, 1000)}\n"""` }).catch(() => null);
  if (!out || out.outcome === "unclear") return { amount: 0, unclear: true };
  const amount = out.outcome === "booked" && out.amount && amountsIn(text).includes(out.amount) ? out.amount : 0;
  return { outcome: out.outcome === "reached" ? undefined : out.outcome, amount };
}
