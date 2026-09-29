import type { Dataset, Money } from "../model.ts";
import { addDays, round2 } from "../util.ts";

/**
 * How this particular shop makes its money, read from its own records — and the strategy that follows.
 *
 * One engine serves every trade. What changes per shop is the mix: a $450-a-visit lawn route with 900
 * regulars wins by re-signing and reminding; a $6,000-a-job fence shop wins by working its best dead
 * quotes carefully. Nobody configures this by hand — it comes from the shop's own jobs and invoices.
 */
export interface ShopProfile {
  /** Median paid job (own data; the trade's typical ticket only if there's no history). */
  typicalJob: Money;
  ticketBand: "small" | "mid" | "large";
  /** Completed jobs per month over the last year. */
  jobsPerMonth: number;
  volumeBand: "low" | "mid" | "high";
  /** Share of paying customers with 3+ jobs — how much of the business is repeat work. */
  repeatShare: number;
  strategy: {
    focus: "big_quotes" | "balanced" | "repeat_work";
    /** Paying accounts: who goes first. */
    rank: "reply" | "dollars";
    /** Suggested new people per week once paying. */
    weeklyNewContacts: number;
    /** First notes for opportunities worth at least this get an AI-personalized draft (still linted). */
    personalizeAbove: Money;
    why: string;
  };
}

export function shopProfile(ds: Dataset, typicalJob: Money, reachablePeople: number): ShopProfile {
  const from = addDays(ds.asOf, -365);
  const done = ds.jobs.filter((j) => (j.status === "completed" || j.status === "archived" || j.status === "requires_invoicing") && (j.completedOn ?? j.scheduledOn ?? "") >= from);
  const paidInv = ds.invoices.filter((i) => i.status === "paid" && (i.paidOn ?? i.issuedOn ?? "") >= from);
  const jobsPerMonth = round2((done.length || paidInv.length) / 12);

  const perCustomer = new Map<string, number>();
  for (const j of ds.jobs) if (j.status === "completed" || j.status === "archived" || j.status === "requires_invoicing") perCustomer.set(j.customerId, (perCustomer.get(j.customerId) ?? 0) + 1);
  const paying = perCustomer.size;
  const repeatShare = paying ? round2([...perCustomer.values()].filter((n) => n >= 3).length / paying) : 0;

  const ticketBand: ShopProfile["ticketBand"] = typicalJob < 600 ? "small" : typicalJob <= 3000 ? "mid" : "large";
  const volumeBand: ShopProfile["volumeBand"] = jobsPerMonth < 15 ? "low" : jobsPerMonth <= 60 ? "mid" : "high";

  const focus: ShopProfile["strategy"]["focus"] =
    ticketBand === "small" && (volumeBand !== "low" || repeatShare >= 0.3) ? "repeat_work" : ticketBand === "large" && repeatShare < 0.3 ? "big_quotes" : "balanced";

  // Work the backlog over about ten weeks, inside what a warmed sending setup handles comfortably.
  const weeklyNewContacts = Math.max(40, Math.min(150, Math.round(reachablePeople / 10 / 5) * 5));

  const personalizeAbove = focus === "big_quotes" ? 0 : focus === "balanced" ? Math.round(typicalJob) : Math.round(typicalJob * 3);

  const why =
    focus === "repeat_work"
      ? `Small tickets (${fmt(typicalJob)} typical) and lots of repeat work: the money is in bringing regulars back and catching service when it's due, so we go after the most likely yeses first.`
      : focus === "big_quotes"
        ? `Big tickets (${fmt(typicalJob)} typical) and mostly one-off work: each recovered quote matters, so we go after the most expected dollars first and write every first note by hand-quality.`
        : `Mid-size tickets (${fmt(typicalJob)} typical) with a mix of new and repeat work: we balance dead quotes and past customers, biggest expected dollars first.`;

  return {
    typicalJob: round2(typicalJob),
    ticketBand,
    jobsPerMonth,
    volumeBand,
    repeatShare,
    strategy: { focus, rank: focus === "repeat_work" ? "reply" : "dollars", weeklyNewContacts, personalizeAbove, why },
  };
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
