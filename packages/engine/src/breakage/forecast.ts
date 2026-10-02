import type { BreakageType, Dataset, ISODate, Money, Opportunity } from "../model.ts";
import { addDays, daysBetween, fmtMoney, round2, sum } from "../util.ts";
import { BREAKAGE_LABEL, PAST_CUSTOMERS } from "./assumptions.ts";
import { averageJob, BILLED, type ScanResult } from "./detect.ts";
import { jobDate, lapseAfter, rhythmOf, visitBook } from "./visits.ts";
import { shopProfile, type ShopProfile } from "./profile.ts";
import { callList, type CallList } from "./calllist.ts";
import { quietRateOf } from "./quiet.ts";

export interface TypeSummary {
  type: BreakageType;
  label: string;
  explain: string;
  count: number;
  reachable: number;
  value: Money;
  reachableValue: Money;
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
  /** The quiet rate (0..1): the last two years' quotes that never got a yes or a no — the same number the Friday report starts from. */
  rate: number;
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
  return { sent: r(a.sent), won: r(a.won), declined: r(a.declined), changesIgnored: r(a.changesIgnored), silent: r(a.silent), byAge: ages.map(r).map((x, i) => ({ label: ages[i]!.label, ...x })), silentShareOfLost, rate: quietRateOf(ds, ds.asOf).rate, headline };
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

/** A past customer who stopped booking: when they were last here, and what they paid in their last year with the shop. */
export interface StoppedCustomer {
  customerId: string;
  /** Their last visit or job, or a bill issued after it; with no jobs file, their last bill. */
  lastOn: ISODate;
  /**
   * Their bills in the 365 days up to lastOn; with no billed amounts there, what their work done in those days billed,
   * when every piece of it carries an amount. Undefined when it doesn't: a fixed-price contract's visits carry none,
   * and the one-off work beside them is no figure for what they paid.
   */
  paidLastYear?: Money;
  /** A regular who stopped coming, not someone who came once or whose work came due again. */
  regular: boolean;
}

/**
 * The past customers a plan can write to, from the scan: lapsed regulars, one-time customers and work come due, with
 * an email and nothing holding them back (came back, work on now). Work come due counts only once they've stopped
 * coming too: a regular still on the schedule whose deep clean came due again hasn't left. What each paid comes from
 * their own records only, each counted once: a job's own record (a Jobs report beside the Visits report) only when its
 * visits aren't here.
 */
export function stoppedCustomers(ds: Dataset, result: ScanResult): StoppedCustomer[] {
  const kinds = new Map<string, Set<BreakageType>>();
  for (const o of result.opportunities)
    if (PAST_CUSTOMERS.includes(o.type) && !o.suppressed && o.channels.includes("email")) (kinds.get(o.customerId) ?? kinds.set(o.customerId, new Set()).get(o.customerId)!).add(o.type);
  const book = visitBook(ds);
  const work = new Map<string, { on: ISODate; total: number }[]>();
  const bills = new Map<string, { on: ISODate; total: number }[]>();
  const add = (m: typeof work, id: string, on: ISODate | undefined, total: number) => {
    if (kinds.has(id) && on && on <= ds.asOf) (m.get(id) ?? m.set(id, []).get(id)!).push({ on, total });
  };
  for (const j of ds.jobs) if (book.worked(j) && !book.hasVisits(j)) add(work, j.customerId, jobDate(j), j.total);
  for (const i of ds.invoices) if (BILLED.has(i.status)) add(bills, i.customerId, i.issuedOn ?? i.paidOn, i.total);
  return [...kinds].flatMap(([customerId, types]) => {
    const done = work.get(customerId) ?? [];
    const billed = bills.get(customerId) ?? [];
    const lastOn = [...done, ...billed].reduce<ISODate>((m, x) => (x.on > m ? x.on : m), "");
    if (!lastOn) return [];
    // only work come due: they've stopped once they're past the time a customer of theirs goes quiet, by how often
    // they come when they're on a rhythm (their visits, else their bills)
    if (!types.has("lapsed_regular") && !types.has("one_and_done")) {
      const pace = rhythmOf((done.length ? done : billed).map((x) => ({ date: x.on })).sort((a, b) => (a.date < b.date ? -1 : 1)));
      if (daysBetween(lastOn, ds.asOf) < lapseAfter(ds.business.trade, pace.recurring ? pace.median : undefined).days) return [];
    }
    const from = addDays(lastOn, -365);
    const inYear = (xs: { on: ISODate; total: number }[]) => xs.filter((x) => x.on > from);
    const did = inYear(done);
    const paid = sum(inYear(billed), (x) => x.total) || (did.length && did.every((x) => x.total > 0) ? sum(did, (x) => x.total) : undefined);
    return [{ customerId, lastOn, paidLastYear: paid ? round2(paid) : undefined, regular: types.has("lapsed_regular") }];
  });
}

/** What a group of them paid together in their last year: undefined when anyone's records don't say. */
export function paidTogether(people: StoppedCustomer[]): Money | undefined {
  return people.reduce<Money | undefined>((t, x) => (t === undefined || x.paidLastYear === undefined ? undefined : round2(t + x.paidLastYear)), 0);
}

export interface DrawerSummary {
  /** Every dollar found, reachable or not. */
  totalValue: Money;
  /** Dollars attached to people we can legally and practically reach. */
  reachableValue: Money;
  reachablePeople: number;
  opportunities: number;
  byType: TypeSummary[];
  /**
   * Unpaid invoices: money already earned and billed. Collecting it is cash, not new revenue,
   * so it's reported here and nowhere else.
   */
  cashToCollect: { value: Money };
  /**
   * This shop's own close rate over the last two years (quotes at least 30 days old).
   * Shown to the owner as the plain truth: "you win 41 of every 100 quotes you send".
   */
  closeRate?: { byCount: number; byValue: number; quotes: number };
  /** How this shop makes money (ticket, volume, repeat work) and the strategy that follows. */
  profile: ShopProfile;
  /** Won vs said-no vs never-answered, from the shop's own quotes. */
  audit: SilentAudit;
  /** The money-on-the-table reveal, in the owner's own numbers only. */
  onTheTable: OnTheTable;
  /** Big quotes and phone-only people the owner should call himself — never emailed by us. */
  callList: CallList;
}

const WON = new Set(["approved", "converted"]);

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
  const reachable = (o: Opportunity) => !o.suppressed;
  const byType = new Map<BreakageType, TypeSummary>();
  for (const o of opps) {
    const l = BREAKAGE_LABEL[o.type];
    const t = byType.get(o.type) ?? { type: o.type, label: l.title, explain: l.explain, count: 0, reachable: 0, value: 0, reachableValue: 0 };
    t.count++;
    t.value += o.value;
    if (reachable(o)) {
      t.reachable++;
      t.reachableValue += o.value;
    }
    byType.set(o.type, t);
  }
  const types = [...byType.values()].map((t) => ({ ...t, value: round2(t.value), reachableValue: round2(t.reachableValue) }));
  types.sort((a, b) => b.reachableValue - a.reachableValue);
  const reachablePeople = new Set(opps.filter(reachable).filter((o) => o.type !== "unpaid_invoice").map((o) => o.customerId)).size;
  const summary: DrawerSummary = {
    totalValue: round2(sum(opps, (o) => o.value)),
    reachableValue: round2(sum(opps.filter(reachable), (o) => o.value)),
    reachablePeople,
    opportunities: opps.length,
    byType: types,
    cashToCollect: { value: types.find((t) => t.type === "unpaid_invoice")?.reachableValue ?? 0 },
    closeRate: closeRate(ds),
    profile: shopProfile(ds, averageJob(ds), reachablePeople),
    audit: silentAudit(ds),
    onTheTable: { silentNow: { count: 0, value: 0 }, perMonth: { quotes: 0, value: 0, shareOfQuoted: 0 }, requestsNeverPriced: 0, pastCustomersNotBack: 0, line: "" },
    callList: callList(ds, result),
  };
  summary.onTheTable = onTheTable(ds, result, summary);
  return summary;
}
