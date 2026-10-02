import type { Dataset, ISODate, Job, Money, Recovery, Reply } from "../model.ts";
import { visitBook } from "../breakage/visits.ts";
import { addDays, daysBetween, makeId, round2, sum } from "../util.ts";

/** One person we worked (or deliberately held out). */
export interface OutreachRecord {
  customerId: string;
  opportunityId?: string;
  /** Source record of the opportunity (a dead quote that later converts is a "same_record" match). */
  sourceId?: string;
  firstTouchOn: ISODate;
  lastTouchOn: ISODate;
  holdout?: boolean;
  /** Held people are written to after this date (a staggered start), so no owner loses a quote for good. */
  releaseOn?: ISODate;
  /** When a released holdout got their first note. Before it they're the comparison group; after, treated. */
  treatedFrom?: ISODate;
}

/** How long the comparison group waits before it's worked too. */
export const HOLDOUT_DAYS = 60;

export interface AttributionOptions {
  /** Days after the last note that a traced comeback (they replied, or the same quote converted) counts. */
  tracedWindowDays?: number;
  /** Days after the last note that new work from someone who never replied still shows (separately). */
  silentWindowDays?: number;
  /** Customers who answered one of our notes. */
  replied?: Set<string>;
  /** Shorthand: one window for both kinds (tests, what-ifs). */
  windowDays?: number;
}

/** Published counting rules — shown to owners word for word. */
export const COUNTING_RULES = [
  "A job counts as ours when the person wrote back to one of our notes, or when the exact quote we followed up on was approved — up to 180 days after our last note.",
  "Work from someone who never wrote back is shown separately as “came back after our note” (up to 90 days) and never counts toward the guarantee or your return.",
  "The value is what you invoiced for that job. One credit per job, and a job you mark “not ours” comes out of every number.",
  "People already in a live job or an open conversation with you when we started aren't counted.",
];

/** Recoveries that count: not disputed, and traced (not merely "came back after our note"). */
export function counted(recoveries: Recovery[]): Recovery[] {
  return recoveries.filter((r) => !r.disputed && isTraced(r));
}

/** Records from before tiers existed count only when the match itself proves it (same quote, owner said so). */
function isTraced(r: Recovery): boolean {
  if (r.tier) return r.tier === "traced";
  return r.match === "same_record" || r.match === "owner_reported";
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
  const tracedDays = opts.tracedWindowDays ?? opts.windowDays ?? 180;
  const silentDays = opts.silentWindowDays ?? opts.windowDays ?? 90;
  const out: Recovery[] = [];
  const used = new Set<string>();
  const jobsBy = new Map<string, typeof ds.jobs>();
  for (const j of ds.jobs) (jobsBy.get(j.customerId) ?? jobsBy.set(j.customerId, []).get(j.customerId)!).push(j);
  const quotesBy = new Map<string, typeof ds.quotes>();
  for (const q of ds.quotes) (quotesBy.get(q.customerId) ?? quotesBy.set(q.customerId, []).get(q.customerId)!).push(q);
  const invBy = new Map<string, typeof ds.invoices>();
  for (const i of ds.invoices) (invBy.get(i.customerId) ?? invBy.set(i.customerId, []).get(i.customerId)!).push(i);
  const book = visitBook(ds);
  const nameOf = bookingNames(ds);

  /**
   * New work for a customer in a window that opens on `from` (the first note), earliest first. A visit is work once
   * it's done, never while it's only on the calendar or left there from a schedule that stopped, and one job's visits
   * are one booking: a weekly regular back on the schedule is one job that came back, worth what the visits done so far
   * billed. The job's own record (a jobs report, a sync) is that same booking, dated when the job was made; with only
   * its visits, it's dated by the first in the window. A job made before the window, or one whose visits were already
   * being done before it, is none, whatever its visits since: unless its visits had stopped for as long as it takes a
   * regular of theirs to go quiet (a job the owner never closed, or one he set going again), and then it's back from
   * its first visit in the window. A client list's last date stands in for the visits only when no job, visit or
   * invoice in the window shows them back.
   */
  const bookings = (customerId: string, ok: (d: ISODate | undefined) => boolean, from: ISODate): { jobs: Job[]; value: Money; on: ISODate; name: string }[] => {
    const byName = new Map<string, Job[]>();
    for (const j of jobsBy.get(customerId) ?? []) {
      if (j.status === "cancelled" || used.has(j.id) || (j.visit && !book.worked(j))) continue;
      (byName.get(nameOf(j)) ?? byName.set(nameOf(j), []).get(nameOf(j))!).push(j);
    }
    const byOn = (a: Job, b: Job) => (jobOn(a)! < jobOn(b)! ? -1 : 1);
    const out: { jobs: Job[]; value: Money; on: ISODate; name: string; listed: boolean }[] = [];
    for (const [name, all] of byName) {
      const own = all.find((j) => !j.visit && !j.fromList);
      const inWindow = all.filter((j) => j !== own && ok(jobOn(j))).sort(byOn);
      // the job's last visit done before the note (a numbered job's: visits with no number are only whose they are)
      const before = all.filter((j) => j.visit && j.jobRef && jobOn(j)! < from).sort(byOn).at(-1);
      const back = !!before && !!inWindow.length && daysBetween(jobOn(before)!, jobOn(inWindow[0]!)!) >= book.quietAfter(customerId);
      if (before ? !back : own && !ok(jobOn(own))) continue;
      const jobs = (own ? [own, ...inWindow] : inWindow).sort(byOn);
      if (!jobs.length) continue;
      const value = jobs.filter((j) => j.visit).reduce((s, v) => s + v.total, 0) || (own?.total ?? 0);
      out.push({ jobs, value, on: jobOn(back ? inWindow[0]! : (own ?? jobs[0]!))!, name, listed: !own && jobs.every((j) => j.fromList) });
    }
    const real = out.filter((b) => !b.listed);
    const billed = (invBy.get(customerId) ?? []).some((i) => i.status === "paid" && !used.has(i.id) && ok(i.issuedOn ?? i.paidOn));
    return (real.length || billed ? real : out).sort((a, b) => (a.on < b.on ? -1 : 1));
  };
  const take = (b: { jobs: Job[] }) => {
    for (const j of b.jobs) {
      used.add(j.id);
      if (j.quoteId) used.add(j.quoteId);
    }
  };

  const firstComeback = (customerId: string, ok: (d: ISODate | undefined) => boolean, from: ISODate): { record: Recovery["record"]; value: Money; on: ISODate } | undefined => {
    const job = bookings(customerId, ok, from)[0];
    if (job) {
      take(job);
      return { record: { kind: "job", id: job.name }, value: job.value, on: job.on };
    }
    const q = (quotesBy.get(customerId) ?? []).find((x) => WON.has(x.status) && !used.has(x.id) && ok(x.approvedOn ?? x.convertedOn));
    if (q) {
      used.add(q.id);
      return { record: { kind: "quote", id: q.id }, value: q.total, on: (q.approvedOn ?? q.convertedOn)! };
    }
    return undefined;
  };

  for (const held of outreach) {
    let r = held;
    if (held.holdout) {
      // the comparison group: comebacks before they were ever written to (tier "holdout", lift only)
      const until = held.treatedFrom;
      const natural = firstComeback(held.customerId, (d) => !!d && d >= held.firstTouchOn && (!until || d < until) && daysBetween(held.firstTouchOn, d) <= silentDays, held.firstTouchOn);
      if (natural) {
        out.push({ ...rec(held, natural.record, natural.value, natural.on, "customer_id", 0.9), tier: "holdout" });
        continue;
      }
      if (!held.treatedFrom) continue;
      // released and written to: from here on they're like anyone else we worked
      r = { ...held, holdout: false, firstTouchOn: held.treatedFrom };
    }
    const replied = !!opts.replied?.has(r.customerId);
    const windowDays = replied ? tracedDays : silentDays;
    const tier: Recovery["tier"] = replied ? "traced" : "after_note";
    const inWindow = (d: ISODate | undefined, days = windowDays) => !!d && d >= r.firstTouchOn && daysBetween(r.lastTouchOn, d) <= days;
    // 1) the very quote we chased got approved/converted — traced even without a reply
    const src = r.sourceId ? ds.quotes.find((q) => q.id === r.sourceId) : undefined;
    if (src && WON.has(src.status) && inWindow(src.convertedOn ?? src.approvedOn, Math.max(tracedDays, silentDays))) {
      used.add(src.id);
      // the job (and invoice) that quote became are the same win — never a second one
      for (const j of jobsBy.get(r.customerId) ?? []) if (j.quoteId === src.id) used.add(j.id);
      out.push({ ...rec(r, { kind: "quote", id: src.id }, src.total, (src.convertedOn ?? src.approvedOn)!, "same_record", 1), tier: "traced" });
      continue;
    }
    // 2) every new job for this customer in the window: one credit per job, not one per person
    const jobs = bookings(r.customerId, inWindow, r.firstTouchOn);
    if (jobs.length) {
      for (const job of jobs) {
        take(job);
        out.push({ ...rec(r, { kind: "job", id: job.name }, job.value, job.on, "customer_id", 0.9), tier });
      }
      continue;
    }
    // 3) a newly approved quote (work agreed, not yet a job in the export)
    const q = (quotesBy.get(r.customerId) ?? []).find((x) => WON.has(x.status) && !used.has(x.id) && inWindow(x.approvedOn ?? x.convertedOn));
    if (q) {
      used.add(q.id);
      out.push({ ...rec(r, { kind: "quote", id: q.id }, q.total, (q.approvedOn ?? q.convertedOn)!, "customer_id", 0.85), tier });
      continue;
    }
    // 4) a paid invoice with no job file
    const inv = (invBy.get(r.customerId) ?? []).find((i) => i.status === "paid" && !used.has(i.id) && inWindow(i.issuedOn ?? i.paidOn));
    if (inv) {
      used.add(inv.id);
      out.push({ ...rec(r, { kind: "invoice", id: inv.id }, inv.total, (inv.issuedOn ?? inv.paidOn)!, "customer_id", 0.8), tier });
    }
  }
  return out;
}

const VISIT_BOOKING = "jv";
const LIST_BOOKING = "jl";

/** What a job booking's name says it was seen through: its visits, or a client list's last date. */
export function bookedThrough(name: string): "visits" | "list" | undefined {
  return name.startsWith(`${VISIT_BOOKING}_`) ? "visits" : name.startsWith(`${LIST_BOOKING}_`) ? "list" : undefined;
}

/** When a job was booked: the day it was made, else the day it was for, else the day it was done. */
export function jobOn(j: Job): ISODate | undefined {
  return j.createdOn ?? j.scheduledOn ?? j.completedOn;
}

/**
 * What a job's booking goes by on the ledger. Once the export has any of its visits, it's whose job it is and the
 * job's number: the same however many of them are done, and whether the job's own record is there too. A client
 * list's last date is the client's one booking, whatever date the latest list gives. A job known only by its own
 * record goes by that record.
 */
export function bookingNames(ds: Dataset): (j: Job) => string {
  const byVisits = (customerId: string, ref: string | undefined) => makeId(VISIT_BOOKING, customerId, ref?.replace(/^#/, "") ?? "");
  const seen = new Set(ds.jobs.filter((j) => j.visit).map((j) => byVisits(j.customerId, j.jobRef)));
  return (j) => {
    if (j.visit) return byVisits(j.customerId, j.jobRef);
    if (j.fromList) return makeId(LIST_BOOKING, j.customerId);
    const name = j.number ? byVisits(j.customerId, j.number) : "";
    return seen.has(name) ? name : j.id;
  };
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
/** The days a booking the owner reported can match a record on: from 30 days before they wrote back to 30 after BOOKED. */
export function bookingSpan(r: Pick<Reply, "receivedAt" | "ownerContactedAt" | "bookedAt">, bookedOn?: ISODate): [ISODate, ISODate] {
  const start = r.receivedAt.slice(0, 10);
  const end = (bookedOn ?? r.bookedAt ?? r.ownerContactedAt ?? r.receivedAt).slice(0, 10);
  return [addDays(start, -30), addDays(end, 30)];
}

/**
 * A booking their records show with no amount on it (a client list's last date, visits with no price): it never
 * stands in for the owner's figure, it takes it.
 */
export function noAmount(x: Recovery): boolean {
  return x.record.kind === "job" && x.value === 0 && x.match !== "owner_reported" && !x.from;
}

export function ownerReported(replies: Reply[], existing: Recovery[]): Recovery[] {
  // One per booking the owner told us about (keyed by the reply). Skipped only when that booking is already
  // on the ledger as a counted job within a month of it; an older or uncounted comeback never blocks it, nor one with
  // no amount on it (the caller folds that one into his).
  const have = new Set(existing.map((r) => r.id));
  // The same booking is anything on the ledger for them from the month before they wrote back to the month after the
  // owner said BOOKED: a quote approved in October and a BOOKED texted in November when it's scheduled are one job.
  const already = (r: Reply) => {
    const [from, to] = bookingSpan(r);
    return existing.some((x) => x.customerId === r.customerId && !x.disputed && !noAmount(x) && x.tier !== "after_note" && x.tier !== "holdout" && x.cameBackOn >= from && x.cameBackOn <= to);
  };
  return replies
    // a booking from someone answering our reply to their own new request is theirs, not a comeback
    .filter((r) => r.customerId && r.outcome === "booked" && (r.outcomeValue ?? 0) > 0 && !r.opportunityId?.startsWith("req:") && !have.has(makeId("rec", r.customerId, "reply", r.id)) && !already(r))
    .map((r) => ({
      id: makeId("rec", r.customerId!, "reply", r.id),
      customerId: r.customerId!,
      opportunityId: r.opportunityId,
      record: { kind: "job" as const, id: r.id },
      value: round2(r.outcomeValue ?? 0),
      cameBackOn: (r.bookedAt ?? r.ownerContactedAt ?? r.receivedAt).slice(0, 10),
      match: "owner_reported" as const,
      confidence: 0.75,
      tier: "traced" as const,
    }));
}

/**
 * Bookings the owner reported with no amount (BOOKED #code, or a console entry with no value): the ledger takes none
 * without a figure, but a one pass bills a booking whatever it's worth (only the rest of a lawn list needs one), dated by
 * the day he said so. One already on the ledger for them (`ledger`, its counted bookings) from the month before they
 * wrote back to the month after is that booking.
 */
export function unpricedBookings(replies: Reply[], ledger: Recovery[]): Recovery[] {
  return replies
    .filter((r) => r.customerId && r.outcome === "booked" && !((r.outcomeValue ?? 0) > 0) && !r.opportunityId?.startsWith("req:"))
    .filter((r) => {
      const [from, to] = bookingSpan(r);
      return !ledger.some((x) => x.customerId === r.customerId && ((x.cameBackOn >= from && x.cameBackOn <= to) || x.record.id === r.id || x.from?.record.id === r.id));
    })
    .map((r) => ({ id: makeId("rec", r.customerId!, "reply", r.id), customerId: r.customerId!, opportunityId: r.opportunityId, record: { kind: "job", id: r.id }, value: 0, cameBackOn: (r.bookedAt ?? r.ownerContactedAt ?? r.receivedAt).slice(0, 10), match: "owner_reported", confidence: 0.75, tier: "traced" }));
}

/**
 * Compare people we contacted with people we deliberately didn't.
 * This is what turns "jobs booked after a message" into "revenue the messages caused".
 */
export function lift(outreach: OutreachRecord[], all: Recovery[]): LiftReport {
  // every matched comeback counts in both groups alike (fair comparison); disputed ones never do
  const recoveries = all.filter((r) => !r.disputed);
  const treatedIds = new Set(outreach.filter((o) => !o.holdout).map((o) => o.customerId));
  const holdIds = new Set(outreach.filter((o) => o.holdout).map((o) => o.customerId));
  const tRec = recoveries.filter((r) => treatedIds.has(r.customerId) && r.tier !== "holdout");
  // the comparison group only counts comebacks from before anyone wrote to them
  const hRec = recoveries.filter((r) => holdIds.has(r.customerId) && (r.tier === "holdout" || r.tier === undefined));
  const tBack = new Set(tRec.map((r) => r.customerId)).size;
  const hBack = new Set(hRec.map((r) => r.customerId)).size;
  const tRate = treatedIds.size ? tBack / treatedIds.size : 0;
  const hRate = holdIds.size ? hBack / holdIds.size : 0;
  const tValue = round2(sum(tRec, (r) => r.value));
  const hValue = round2(sum(hRec, (r) => r.value));
  const avgBack = tBack ? tValue / tBack : hBack ? hValue / hBack : 0;
  const baseline = round2(treatedIds.size * hRate * avgBack);
  const incremental = round2(Math.max(0, tValue - baseline));
  // One shop's comparison group is small; "solid" is kept for pooled groups of 1,000+.
  const confidence: LiftReport["confidence"] = holdIds.size >= 1000 ? "solid" : holdIds.size >= 50 ? "fair" : "early";
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
