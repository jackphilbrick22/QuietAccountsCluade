import type { BreakageType, Dataset, Money, Opportunity } from "../model.ts";
import { addDays, daysBetween, fmtMoney, round2, sum } from "../util.ts";
import { BAND, BREAKAGE_LABEL, RECOVERY_PRIOR, SALES_TYPES } from "./assumptions.ts";
import type { ScanResult } from "./detect.ts";

export interface TypeSummary {
  type: BreakageType;
  label: string;
  explain: string;
  count: number;
  reachable: number;
  value: Money;
  reachableValue: Money;
  expected: Money;
}

export interface FitCheck {
  score: number;
  verdict: "strong" | "good" | "thin" | "not_yet";
  guaranteeEligible: boolean;
  checks: { id: string; ok: boolean; label: string; detail: string }[];
  headline: string;
}

export interface DrawerSummary {
  /** Every dollar found, reachable or not. */
  totalValue: Money;
  /** Dollars attached to people we can legally and practically reach. */
  reachableValue: Money;
  reachablePeople: number;
  opportunities: number;
  /** Expected recovered from the backlog, in bands. */
  expected: { conservative: Money; likely: Money; strong: Money };
  byType: TypeSummary[];
  /** Revenue over the last 12 months, from the data (or the owner's number). */
  annualRevenue?: Money;
  revenueSource: "invoices" | "jobs" | "quotes" | "owner" | "none";
  /** New breakage created each month by normal business, and what we'd expect to recover from it. */
  monthly: { newQuotes: number; newDeadValue: Money; expectedRecovered: Money };
  /** Year-one recovered revenue (backlog + ongoing), and the lift it represents. */
  yearOne: { conservative: Money; likely: Money; strong: Money };
  liftPct?: { conservative: number; likely: number; strong: number };
  /** How many months of our fee the likely year-one recovery covers. */
  paybackMultiple?: number;
  /**
   * This shop's own close rate over the last two years (quotes at least 30 days old).
   * Shown to the owner as the plain truth: "you win 41 of every 100 quotes you send".
   */
  closeRate?: { byCount: number; byValue: number; quotes: number };
  /** Share of the likely year-one number that comes from past customers (not dead quotes). */
  pastCustomerShare?: number;
  fit: FitCheck;
}

function revenue(ds: Dataset): { value?: Money; source: DrawerSummary["revenueSource"] } {
  const from = addDays(ds.asOf, -365);
  const paid = ds.invoices.filter((i) => i.status === "paid" && (i.paidOn ?? i.issuedOn ?? "") >= from);
  if (paid.length >= 10) return { value: round2(sum(paid, (i) => i.total)), source: "invoices" };
  const jobs = ds.jobs.filter((j) => j.status !== "cancelled" && (j.completedOn ?? j.scheduledOn ?? j.createdOn ?? "") >= from);
  if (jobs.length >= 10) return { value: round2(sum(jobs, (j) => j.total)), source: "jobs" };
  const won = ds.quotes.filter((q) => (q.status === "converted" || q.status === "approved") && (q.approvedOn ?? q.convertedOn ?? q.sentOn ?? q.createdOn ?? "") >= from);
  if (won.length >= 10) return { value: round2(sum(won, (q) => q.total)), source: "quotes" };
  if (ds.business.annualRevenue) return { value: ds.business.annualRevenue, source: "owner" };
  return { source: "none" };
}

function monthlyFlow(ds: Dataset): DrawerSummary["monthly"] {
  const dated = ds.quotes.map((q) => ({ q, d: q.sentOn ?? q.createdOn })).filter((x) => x.d) as { q: (typeof ds.quotes)[number]; d: string }[];
  if (!dated.length) return { newQuotes: 0, newDeadValue: 0, expectedRecovered: 0 };
  const from = addDays(ds.asOf, -365);
  const lastYear = dated.filter((x) => x.d >= from);
  const span = lastYear.length ? 12 : Math.max(1, Math.min(36, daysBetween(dated.map((x) => x.d).sort()[0]!, ds.asOf) / 30.44));
  const pool = lastYear.length ? lastYear : dated;
  const newQuotes = pool.length / span;
  const dead = pool.filter((x) => ["awaiting_response", "archived", "expired", "unknown", "changes_requested"].includes(x.q.status));
  const newDeadValue = sum(dead, (x) => x.q.total) / span;
  // fresh dead quotes are worked at their warmest (the first 90 days)
  const expectedRecovered = newDeadValue * RECOVERY_PRIOR.unanswered_quote * 1.25;
  return { newQuotes: round2(newQuotes), newDeadValue: round2(newDeadValue), expectedRecovered: round2(expectedRecovered) };
}

const WON = new Set(["approved", "converted"]);
const PAST_TYPES: BreakageType[] = ["one_and_done", "lapsed_regular", "service_due", "missed_upsell", "declined_option"];

/** Close rate from the shop's own quotes: by count and by dollars. */
export function closeRate(ds: Dataset): DrawerSummary["closeRate"] {
  const to = addDays(ds.asOf, -30);
  const from = addDays(ds.asOf, -730);
  const sent = ds.quotes.filter((q) => {
    const d = q.sentOn ?? q.createdOn;
    return !!d && d >= from && d <= to && q.status !== "draft" && q.total > 0;
  });
  if (sent.length < 20) return undefined;
  const won = sent.filter((q) => WON.has(q.status));
  const value = sum(sent, (q) => q.total);
  return {
    byCount: round2(won.length / sent.length),
    byValue: value ? round2(sum(won, (q) => q.total) / value) : 0,
    quotes: sent.length,
  };
}

export function summarize(ds: Dataset, result: ScanResult): DrawerSummary {
  const opps = result.opportunities;
  const primaryIds = new Set(result.primary.map((o) => o.id));
  const reachable = (o: Opportunity) => !o.suppressed;
  const byType = new Map<BreakageType, TypeSummary>();
  for (const o of opps) {
    const l = BREAKAGE_LABEL[o.type];
    const t = byType.get(o.type) ?? { type: o.type, label: l.title, explain: l.explain, count: 0, reachable: 0, value: 0, reachableValue: 0, expected: 0 };
    t.count++;
    t.value += o.value;
    if (reachable(o)) {
      t.reachable++;
      t.reachableValue += o.value;
      // Only one sequence per person runs at a time; count secondary opportunities at a third.
      t.expected += primaryIds.has(o.id) || o.type === "unpaid_invoice" ? o.expectedValue : o.expectedValue / 3;
    }
    byType.set(o.type, t);
  }
  const types = [...byType.values()].map((t) => ({ ...t, value: round2(t.value), reachableValue: round2(t.reachableValue), expected: round2(t.expected) }));
  types.sort((a, b) => b.reachableValue - a.reachableValue);

  const expectedLikely = round2(sum(types, (t) => t.expected));
  const rev = revenue(ds);
  const monthly = monthlyFlow(ds);
  const yearLikely = expectedLikely + monthly.expectedRecovered * 12;
  const yearOne = {
    conservative: round2(yearLikely * BAND.conservative),
    likely: round2(yearLikely),
    strong: round2(yearLikely * BAND.strong),
  };
  const liftPct = rev.value
    ? {
        conservative: round2((yearOne.conservative / rev.value) * 100),
        likely: round2((yearOne.likely / rev.value) * 100),
        strong: round2((yearOne.strong / rev.value) * 100),
      }
    : undefined;
  const reachablePeople = new Set(opps.filter(reachable).filter((o) => o.type !== "unpaid_invoice").map((o) => o.customerId)).size;
  const summary: DrawerSummary = {
    totalValue: round2(sum(opps, (o) => o.value)),
    reachableValue: round2(sum(opps.filter(reachable), (o) => o.value)),
    reachablePeople,
    opportunities: opps.length,
    expected: {
      conservative: round2(expectedLikely * BAND.conservative),
      likely: expectedLikely,
      strong: round2(expectedLikely * BAND.strong),
    },
    byType: types,
    annualRevenue: rev.value,
    revenueSource: rev.source,
    monthly,
    yearOne,
    liftPct,
    paybackMultiple: ds.business.plan.monthlyPrice ? round2(yearOne.likely / (ds.business.plan.monthlyPrice * 12)) : undefined,
    closeRate: closeRate(ds),
    pastCustomerShare: expectedLikely ? round2(sum(types.filter((t) => PAST_TYPES.includes(t.type)), (t) => t.expected) / yearLikely) : undefined,
    fit: { score: 0, verdict: "not_yet", guaranteeEligible: false, checks: [], headline: "" },
  };
  summary.fit = fitCheck(ds, result, summary);
  return summary;
}

export function fitCheck(ds: Dataset, result: ScanResult, s: DrawerSummary): FitCheck {
  const sales = result.opportunities.filter((o) => SALES_TYPES.includes(o.type));
  const withEmail = sales.filter((o) => o.channels.includes("email")).length;
  const emailShare = sales.length ? withEmail / sales.length : 0;
  const quoteVals = ds.quotes.map((q) => q.total).filter((v) => v > 0).sort((a, b) => a - b);
  const medianQuote = quoteVals.length ? quoteVals[Math.floor(quoteVals.length / 2)]! : ds.business.avgJobValue ?? 0;
  const first = result.stats.from;
  const monthsOfHistory = first ? daysBetween(first, ds.asOf) / 30.44 : 0;
  const trial = ds.business.plan.trialSize || 150;
  const price = ds.business.plan.monthlyPrice || 497;
  const checks: FitCheck["checks"] = [
    {
      id: "volume",
      ok: s.reachablePeople >= trial,
      label: "Enough people to work",
      detail: `${s.reachablePeople.toLocaleString("en-US")} people we can reach${s.reachablePeople >= trial ? "" : ` — the free round needs ${trial}`}.`,
    },
    {
      id: "email",
      ok: emailShare >= 0.45,
      label: "Emails on file",
      detail: `${Math.round(emailShare * 100)}% of them have an email address${emailShare >= 0.45 ? "" : " — postcards can cover some of the rest"}.`,
    },
    {
      id: "ticket",
      ok: medianQuote >= 300,
      label: "Jobs worth chasing",
      detail: `Your typical quote is ${fmtMoney(medianQuote)}${medianQuote >= 300 ? "" : " — small tickets make recovery hard to pay for"}.`,
    },
    {
      id: "history",
      ok: monthsOfHistory >= 6,
      label: "Enough history",
      detail: monthsOfHistory ? `${Math.round(monthsOfHistory)} months of records.` : "We couldn't find dates on the records.",
    },
    {
      id: "payback",
      ok: s.yearOne.conservative >= price * 12,
      label: "Pays for itself",
      detail: `Even the careful estimate (${fmtMoney(s.yearOne.conservative)} in year one) ${s.yearOne.conservative >= price * 12 ? "covers" : "doesn't cover"} a year of the service (${fmtMoney(price * 12)}).`,
    },
  ];
  if (s.liftPct) {
    checks.push({
      id: "lift",
      ok: s.liftPct.likely >= 8,
      label: "Moves the needle",
      detail: `Likely year-one recovery is about ${Math.round(s.liftPct.likely)}% of the ${fmtMoney(s.annualRevenue ?? 0, { compact: true })} your records show for the last 12 months.${
        s.closeRate && s.closeRate.byValue >= 0.65 ? " You already close most of what you quote, so most of this comes from past customers, not dead quotes." : ""
      }`,
    });
  }
  const weights: Record<string, number> = { volume: 30, email: 15, ticket: 15, history: 10, payback: 20, lift: 10 };
  const totalW = checks.reduce((a, c) => a + (weights[c.id] ?? 0), 0);
  const score = Math.round((checks.reduce((a, c) => a + (c.ok ? (weights[c.id] ?? 0) : 0), 0) / totalW) * 100);
  const must = ["volume", "ticket", "payback"];
  const guaranteeEligible = must.every((id) => checks.find((c) => c.id === id)?.ok);
  const verdict: FitCheck["verdict"] = guaranteeEligible && score >= 85 ? "strong" : guaranteeEligible ? "good" : score >= 50 ? "thin" : "not_yet";
  const headline =
    verdict === "strong"
      ? "This drawer is full. You're exactly who this is built for."
      : verdict === "good"
        ? "There's real money here. You qualify for the guarantee."
        : verdict === "thin"
          ? "There's money here, but the drawer is thin — we'll tell you straight what to expect."
          : "Not enough in the drawer yet to promise a result. We'd rather tell you now.";
  return { score, verdict, guaranteeEligible, checks, headline };
}
