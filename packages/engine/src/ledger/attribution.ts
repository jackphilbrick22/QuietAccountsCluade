import type { Dataset, ISODate, Money, Recovery, Reply } from "../model.ts";
import { daysBetween, makeId, round2, sum } from "../util.ts";

/** One person we worked (or deliberately held out). */
export interface OutreachRecord {
  customerId: string;
  opportunityId?: string;
  /** Source record of the opportunity (a dead quote that later converts is a "same_record" match). */
  sourceId?: string;
  firstTouchOn: ISODate;
  lastTouchOn: ISODate;
  holdout?: boolean;
}

export interface AttributionOptions {
  /** Days after the last note that a comeback still counts. */
  windowDays?: number;
}

export interface LiftReport {
  treated: { people: number; cameBack: number; value: Money; rate: number };
  holdout: { people: number; cameBack: number; value: Money; rate: number };
  /** Comebacks we'd have expected anyway, based on the holdout. */
  baseline: Money;
  /** Revenue that would not have happened without the outreach. */
  incremental: Money;
  /** Plain-English confidence note. */
  confidence: "early" | "fair" | "solid";
  note: string;
}

const WON = new Set(["converted", "approved"]);

/**
 * Find who came back after we contacted them.
 * A comeback is new paid-for work (job, paid invoice, or approved quote) dated after
 * the first note and within the window after the last one.
 */
export function attribute(ds: Dataset, outreach: OutreachRecord[], opts: AttributionOptions = {}): Recovery[] {
  const windowDays = opts.windowDays ?? 120;
  const out: Recovery[] = [];
  const used = new Set<string>();
  const jobsBy = new Map<string, typeof ds.jobs>();
  for (const j of ds.jobs) (jobsBy.get(j.customerId) ?? jobsBy.set(j.customerId, []).get(j.customerId)!).push(j);
  const quotesBy = new Map<string, typeof ds.quotes>();
  for (const q of ds.quotes) (quotesBy.get(q.customerId) ?? quotesBy.set(q.customerId, []).get(q.customerId)!).push(q);
  const invBy = new Map<string, typeof ds.invoices>();
  for (const i of ds.invoices) (invBy.get(i.customerId) ?? invBy.set(i.customerId, []).get(i.customerId)!).push(i);

  for (const r of outreach) {
    const inWindow = (d: ISODate | undefined) => !!d && d >= r.firstTouchOn && daysBetween(r.lastTouchOn, d) <= windowDays;
    // 1) the very quote we chased got approved/converted
    const src = r.sourceId ? ds.quotes.find((q) => q.id === r.sourceId) : undefined;
    if (src && WON.has(src.status) && inWindow(src.convertedOn ?? src.approvedOn)) {
      used.add(src.id);
      out.push(rec(r, { kind: "quote", id: src.id }, src.total, (src.convertedOn ?? src.approvedOn)!, "same_record", 1));
      continue;
    }
    // 2) any new job for this customer in the window
    const job = (jobsBy.get(r.customerId) ?? [])
      .filter((j) => j.status !== "cancelled" && !used.has(j.id) && inWindow(j.createdOn ?? j.scheduledOn ?? j.completedOn))
      .sort((a, b) => ((a.createdOn ?? a.scheduledOn ?? "") < (b.createdOn ?? b.scheduledOn ?? "") ? -1 : 1))[0];
    if (job) {
      used.add(job.id);
      if (job.quoteId) used.add(job.quoteId);
      out.push(rec(r, { kind: "job", id: job.id }, job.total, (job.createdOn ?? job.scheduledOn ?? job.completedOn)!, "customer_id", 0.9));
      continue;
    }
    // 3) a newly approved quote (work agreed, not yet a job in the export)
    const q = (quotesBy.get(r.customerId) ?? []).find((x) => WON.has(x.status) && !used.has(x.id) && inWindow(x.approvedOn ?? x.convertedOn));
    if (q) {
      used.add(q.id);
      out.push(rec(r, { kind: "quote", id: q.id }, q.total, (q.approvedOn ?? q.convertedOn)!, "customer_id", 0.85));
      continue;
    }
    // 4) a paid invoice with no job file
    const inv = (invBy.get(r.customerId) ?? []).find((i) => i.status === "paid" && !used.has(i.id) && inWindow(i.issuedOn ?? i.paidOn));
    if (inv) {
      used.add(inv.id);
      out.push(rec(r, { kind: "invoice", id: inv.id }, inv.total, (inv.issuedOn ?? inv.paidOn)!, "customer_id", 0.8));
    }
  }
  return out;
}

function rec(r: OutreachRecord, record: Recovery["record"], value: Money, on: ISODate, match: Recovery["match"], confidence: number): Recovery {
  return {
    id: makeId("rec", r.customerId, record.kind, record.id),
    customerId: r.customerId,
    opportunityId: r.opportunityId,
    record,
    value: round2(value),
    cameBackOn: on,
    match,
    confidence,
    lagDays: Math.max(0, daysBetween(r.lastTouchOn, on)),
  };
}

/** Bookings the owner reported from a reply ("booked Mike for $2,400") that the export hasn't shown yet. */
export function ownerReported(replies: Reply[], existing: Recovery[]): Recovery[] {
  const have = new Set(existing.map((r) => r.customerId));
  return replies
    .filter((r) => r.customerId && r.outcome === "booked" && (r.outcomeValue ?? 0) > 0 && !have.has(r.customerId))
    .map((r) => ({
      id: makeId("rec", r.customerId!, "reply", r.id),
      customerId: r.customerId!,
      opportunityId: r.opportunityId,
      record: { kind: "job" as const, id: r.id },
      value: round2(r.outcomeValue ?? 0),
      cameBackOn: (r.ownerContactedAt ?? r.receivedAt).slice(0, 10),
      match: "owner_reported" as const,
      confidence: 0.75,
    }));
}

/**
 * Compare people we contacted with people we deliberately didn't.
 * This is what turns "jobs booked after a message" into "revenue the messages caused".
 */
export function lift(outreach: OutreachRecord[], recoveries: Recovery[]): LiftReport {
  const treatedIds = new Set(outreach.filter((o) => !o.holdout).map((o) => o.customerId));
  const holdIds = new Set(outreach.filter((o) => o.holdout).map((o) => o.customerId));
  const tRec = recoveries.filter((r) => treatedIds.has(r.customerId));
  const hRec = recoveries.filter((r) => holdIds.has(r.customerId));
  const tBack = new Set(tRec.map((r) => r.customerId)).size;
  const hBack = new Set(hRec.map((r) => r.customerId)).size;
  const tRate = treatedIds.size ? tBack / treatedIds.size : 0;
  const hRate = holdIds.size ? hBack / holdIds.size : 0;
  const tValue = round2(sum(tRec, (r) => r.value));
  const hValue = round2(sum(hRec, (r) => r.value));
  const avgBack = tBack ? tValue / tBack : hBack ? hValue / hBack : 0;
  const baseline = round2(treatedIds.size * hRate * avgBack);
  const incremental = round2(Math.max(0, tValue - baseline));
  const confidence: LiftReport["confidence"] = holdIds.size >= 150 ? "solid" : holdIds.size >= 50 ? "fair" : "early";
  const note =
    confidence === "early"
      ? `Only ${holdIds.size} people are in the comparison group so far — the lift number firms up as more of the list is worked.`
      : `${Math.round(hRate * 1000) / 10}% of the people we didn't contact came back on their own, versus ${Math.round(tRate * 1000) / 10}% of the people we did.`;
  return {
    treated: { people: treatedIds.size, cameBack: tBack, value: tValue, rate: round2(tRate * 10000) / 10000 },
    holdout: { people: holdIds.size, cameBack: hBack, value: hValue, rate: round2(hRate * 10000) / 10000 },
    baseline,
    incremental,
    confidence,
    note,
  };
}
