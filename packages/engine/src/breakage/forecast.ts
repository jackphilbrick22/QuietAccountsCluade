import type { BreakageType, Dataset, Money, Opportunity } from "../model.ts";
import { addDays, daysBetween, fmtMoney, round2, sum } from "../util.ts";
import { BREAKAGE_LABEL, rangeFactor, RECOVERY_PRIOR, SALES_TYPES } from "./assumptions.ts";
import { averageJob, type ScanResult } from "./detect.ts";
import { shopProfile, type ShopProfile } from "./profile.ts";
import { callList, type CallList } from "./calllist.ts";

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

/**
 * The Silent Quote Audit: the owner's own quotes split into won, said no, and never answered.
 * Owners treat a 30-60% loss rate as proof their prices are right. Most of those "losses" never got a
 * yes or a no from anyone — they weren't lost on price, nobody answered. Only this shop's numbers are used.
 */
export interface SilentAudit {
  sent: { count: number; value: Money };
  won: { count: number; value: Money };
  declined: { count: number; value: Money };
  changesIgnored: { count: number; value: Money };
  silent: { count: number; value: Money };
  /** Silent quotes by age, newest first. */
  byAge: { label: string; count: number; value: Money }[];
  /** Share of the quotes that didn't become work that never got an answer. */
  silentShareOfLost: number;
  headline: string;
}

const AGE_BUCKETS: [number, string][] = [
  [90, "Last 3 months"],
  [180, "3–6 months"],
  [365, "6–12 months"],
  [730, "1–2 years"],
  [Infinity, "Over 2 years"],
];

export function silentAudit(ds: Dataset): SilentAudit {
  const cut = addDays(ds.asOf, -14);
  const acc = () => ({ count: 0, value: 0 });
  const a = { sent: acc(), won: acc(), declined: acc(), changesIgnored: acc(), silent: acc() };
  const ages = AGE_BUCKETS.map(([, label]) => ({ label, count: 0, value: 0 }));
  for (const q of ds.quotes) {
    const d = q.sentOn ?? q.createdOn;
    if (!d || d > cut || q.status === "draft") continue;
    const add = (k: keyof typeof a) => {
      a[k].count++;
      a[k].value += q.total;
    };
    add("sent");
    if (q.status === "approved" || q.status === "converted") add("won");
    else if (q.status === "declined") add("declined");
    else if (q.status === "changes_requested") add("changesIgnored");
    else {
      add("silent");
      const age = daysBetween(d, ds.asOf);
      const i = AGE_BUCKETS.findIndex(([max]) => age <= max);
      ages[i]!.count++;
      ages[i]!.value += q.total;
    }
  }
  const lost = a.sent.count - a.won.count;
  const silentShareOfLost = lost ? round2(a.silent.count / lost) : 0;
  const r = (x: { count: number; value: number }) => ({ count: x.count, value: round2(x.value) });
  const headline = a.silent.count
    ? `Of ${lost.toLocaleString("en-US")} quotes that didn't turn into work, ${a.silent.count.toLocaleString("en-US")} (${Math.round(silentShareOfLost * 100)}%) never got a yes or a no — ${fmtMoney(a.silent.value, { compact: true })} that wasn't lost on price. Nobody answered.`
    : "Every quote got an answer. That's rare.";
  return { sent: r(a.sent), won: r(a.won), declined: r(a.declined), changesIgnored: r(a.changesIgnored), silent: r(a.silent), byAge: ages.map(r).map((x, i) => ({ label: ages[i]!.label, ...x })), silentShareOfLost, headline };
}

/**
 * What an owner is losing, stated in their own numbers — the reveal the whole offer rests on.
 * Every figure comes from their records (or a lead cost they gave us); none is an industry average.
 */
export interface OnTheTable {
  /** Quotes nobody ever said yes or no to, as of today. */
  silentNow: { count: number; value: Money };
  /** New quote value that goes quiet each month, and what share of everything they quote that is. */
  perMonth: { quotes: number; value: Money; shareOfQuoted: number };
  /** Requests in the last 12 months that never got a price. */
  requestsNeverPriced: number;
  /** Past customers we can reach who haven't been back. */
  pastCustomersNotBack: number;
  /** Lead spend thrown away on quotes that went quiet in the last 12 months (only when they told us a lead cost). */
  wastedLeadSpend?: Money;
  /** The one sentence to lead with. */
  line: string;
}

export function onTheTable(ds: Dataset, result: ScanResult, s: DrawerSummary): OnTheTable {
  const from = addDays(ds.asOf, -365);
  const cut = addDays(ds.asOf, -14);
  const lastYear = ds.quotes.filter((q) => { const d = q.sentOn ?? q.createdOn; return !!d && d >= from && d <= cut && q.status !== "draft" && q.total > 0; });
  const quiet = lastYear.filter((q) => !["approved", "converted", "declined"].includes(q.status));
  const quotedValue = sum(lastYear, (q) => q.total);
  const quietValue = sum(quiet, (q) => q.total);
  const perMonth = { quotes: round2(quiet.length / 12), value: round2(quietValue / 12), shareOfQuoted: quotedValue ? round2(quietValue / quotedValue) : 0 };
  const near100 = (v: number) => fmtMoney(v >= 1000 ? Math.round(v / 100) * 100 : v);
  const requestsNeverPriced = ds.requests.filter((r) => (r.createdOn ?? "") >= from && !r.quoteId && r.status !== "converted" && !ds.quotes.some((q) => q.customerId === r.customerId && (q.sentOn ?? q.createdOn ?? "") >= (r.createdOn ?? "9999"))).length;
  const pastCustomersNotBack = new Set(result.opportunities.filter((o) => !o.suppressed && (o.type === "one_and_done" || o.type === "lapsed_regular")).map((o) => o.customerId)).size;
  const cost = ds.business.leadCost;
  const wastedLeadSpend = cost && cost > 0 ? round2(quiet.length * cost) : undefined;
  const line = perMonth.value > 0
    ? `Every month about ${near100(perMonth.value)} of what you quote goes quiet — nobody says yes or no. That's ${Math.round(perMonth.shareOfQuoted * 100)} cents of every quoted dollar${wastedLeadSpend ? `, and ${near100(wastedLeadSpend)} a year in leads you paid for and never heard from again` : ""}.`
    : `${s.audit.silent.count.toLocaleString("en-US")} of your quotes never got a yes or a no.`;
  return { silentNow: { count: s.audit.silent.count, value: s.audit.silent.value }, perMonth, requestsNeverPriced, pastCustomersNotBack, wastedLeadSpend, line };
}

export interface FitCheck {
  score: number;
  verdict: "strong" | "good" | "thin" | "not_yet";
  guaranteeEligible: boolean;
  /**
   * What we may say about lift to THIS owner. "15–20%" only when this shop's own careful (conservative)
   * forecast reaches 15%; otherwise their real number. Never a blanket promise (FTC: reasonable basis).
   */
  liftLine: string;
  canSay15: boolean;
  /**
   * A: may be shown a year-one percentage range (split into backlog and ongoing). B: qualifies for the
   * guarantee, shown in dollars only. audit_only: the free audit, no promise. Gate inputs are stored so
   * "we screen for fit" stays true.
   */
  tier: "A" | "B" | "audit_only";
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
  /**
   * Unpaid invoices: money already earned and billed. Collecting it is cash, not new revenue,
   * so it's reported here and kept out of the lift.
   */
  cashToCollect: { value: Money; expected: Money };
  /** How much of year one is the one-time backlog (the rest is ongoing, from new quotes). */
  backlogShare: number;
  /** Year-one recovered revenue (backlog + ongoing), and the lift it represents. New work only. */
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
  /** How this shop makes money (ticket, volume, repeat work) and the strategy that follows. */
  profile: ShopProfile;
  /** Won vs said-no vs never-answered, from the shop's own quotes. */
  audit: SilentAudit;
  /** The money-on-the-table reveal, in the owner's own numbers only. */
  onTheTable: OnTheTable;
  /** Big quotes and phone-only people the owner should call himself — never emailed by us. */
  callList: CallList;
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
  // No boost for freshness until measured age buckets say so.
  const expectedRecovered = newDeadValue * RECOVERY_PRIOR.unanswered_quote;
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
  const invoices = types.find((t) => t.type === "unpaid_invoice");
  const newWorkExpected = expectedLikely - (invoices?.expected ?? 0);
  const rev = revenue(ds);
  const monthly = monthlyFlow(ds);
  // Each type's own low and high end, not a flat haircut.
  const newWork = types.filter((t) => t.type !== "unpaid_invoice");
  const backlog = {
    conservative: sum(newWork, (t) => t.expected * rangeFactor(t.type, "low")),
    likely: newWorkExpected,
    strong: sum(newWork, (t) => t.expected * rangeFactor(t.type, "high")),
  };
  const ongoing = {
    conservative: monthly.expectedRecovered * 12 * rangeFactor("unanswered_quote", "low"),
    likely: monthly.expectedRecovered * 12,
    strong: monthly.expectedRecovered * 12 * rangeFactor("unanswered_quote", "high"),
  };
  const yearLikely = backlog.likely + ongoing.likely;
  const yearOne = {
    conservative: round2(backlog.conservative + ongoing.conservative),
    likely: round2(yearLikely),
    strong: round2(backlog.strong + ongoing.strong),
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
    // new work only; unpaid invoices are reported once, under cashToCollect
    expected: { conservative: round2(backlog.conservative), likely: round2(backlog.likely), strong: round2(backlog.strong) },
    backlogShare: yearLikely ? round2(backlog.likely / yearLikely) : 0,
    byType: types,
    cashToCollect: { value: invoices?.reachableValue ?? 0, expected: invoices?.expected ?? 0 },
    annualRevenue: rev.value,
    revenueSource: rev.source,
    monthly,
    yearOne,
    liftPct,
    paybackMultiple: ds.business.plan.monthlyPrice ? round2(yearOne.likely / (ds.business.plan.monthlyPrice * 12)) : undefined,
    closeRate: closeRate(ds),
    pastCustomerShare: yearLikely ? round2(sum(types.filter((t) => PAST_TYPES.includes(t.type)), (t) => t.expected) / yearLikely) : undefined,
    profile: shopProfile(ds, averageJob(ds), reachablePeople),
    audit: silentAudit(ds),
    onTheTable: { silentNow: { count: 0, value: 0 }, perMonth: { quotes: 0, value: 0, shareOfQuoted: 0 }, requestsNeverPriced: 0, pastCustomersNotBack: 0, line: "" },
    fit: { score: 0, verdict: "not_yet", guaranteeEligible: false, checks: [], headline: "", liftLine: "", canSay15: false, tier: "audit_only" },
    callList: callList(ds, result),
  };
  summary.fit = fitCheck(ds, result, summary);
  summary.onTheTable = onTheTable(ds, result, summary);
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
  // The fit gate (research brief §8). Tier A needs real revenue (invoices or jobs, never a number the
  // owner told us), a careful floor of 8%, and enough dead quotes and warm work to carry it.
  const R = s.revenueSource === "invoices" || s.revenueSource === "jobs" ? s.annualRevenue : undefined;
  const reach = (types: BreakageType[]) => sum(s.byType.filter((t) => types.includes(t.type)), (t) => t.reachableValue);
  const deadV = reach(["unanswered_quote", "archived_quote", "changes_requested"]);
  const warmV = reach(["approved_unscheduled", "unquoted_request", "service_due", "lapsed_regular"]);
  const tierA = !!R && !!s.liftPct && s.liftPct.likely >= 15 && s.liftPct.conservative >= 8 && deadV >= 1.5 * R && warmV >= 0.4 * R;
  const tierB = s.yearOne.conservative >= 3 * price * 12 && s.reachablePeople >= trial;
  const tier: FitCheck["tier"] = tierA ? "A" : tierB ? "B" : "audit_only";
  const must = ["volume", "ticket"];
  const guaranteeEligible = tier !== "audit_only" && must.every((id) => checks.find((c) => c.id === id)?.ok);
  const verdict: FitCheck["verdict"] = guaranteeEligible && score >= 85 ? "strong" : guaranteeEligible ? "good" : score >= 50 ? "thin" : "not_yet";
  const headline =
    verdict === "strong"
      ? "This drawer is full. You're exactly who this is built for."
      : verdict === "good"
        ? "There's real money here. You qualify for the guarantee."
        : verdict === "thin"
          ? "There's money here, but the drawer is thin — we'll tell you straight what to expect."
          : "Not enough in the drawer yet to promise a result. We'd rather tell you now.";
  const canSay15 = tier === "A" && guaranteeEligible;
  const backlogPct = Math.round(s.backlogShare * 100);
  const liftLine =
    tier === "A" && s.liftPct
      ? `From your own records, a careful year one is about ${Math.round(s.liftPct.conservative)}–${Math.round(s.liftPct.likely)}% more revenue, ${backlogPct}% of it the one-time backlog of quiet quotes. A forecast, not a promise.`
      : tier === "B"
        ? `From your own records, a careful year one is about ${fmtMoney(s.yearOne.conservative)} (${fmtMoney(s.yearOne.likely)} likely), ${backlogPct}% of it the one-time backlog. That's the number we hold ourselves to.`
        : `Your records show about ${fmtMoney(s.yearOne.conservative)} in a careful year one. That's not enough for us to promise anything, so the audit is yours, free.`;
  return { score, verdict, guaranteeEligible, checks, headline, liftLine, canSay15, tier };
}
