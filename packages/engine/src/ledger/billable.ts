import type { ISODate, Job, Money, Recovery, Reply } from "../model.ts";
import type { AccountState } from "../runtime/state.ts";
import { soldMonthly } from "../breakage/assumptions.ts";
import { jobDate, rhythmOf } from "../breakage/visits.ts";
import { billsPass, holdsPlace, ONE_PASS } from "../plans.ts";
import { leadCode, passTouches } from "../reports/owner.ts";
import { daysBetween } from "../util.ts";
import { bookingNames, bookingSpan, counted, jobOn } from "./attribution.ts";

/** Replies that never make anyone billable: they aren't a real answer to the notes (BRIEF §2, rule 1). */
const NOT_A_REPLY = new Set<Reply["intent"]>(["stop", "not_interested", "wrong_person", "complaint", "auto_reply", "bounce"]);
const OUT = new Set(["sent", "delivered", "bounced"]);
/** The rest of a lawn list: a season, or one job over this. */
const LAWN_JOB_OVER = 500;

export interface Billable {
  customerId: string;
  /** The ledger's booking (a recovery id) and the day it was made (a quote's, the day it was approved), else the day of the work. */
  bookingId: string;
  on: ISODate;
  value: Money;
  /** The lead it's billed against: its code from the hand-off text goes on every money text. */
  replyId: string;
  code: string;
}

export interface NotBillable {
  customerId: string;
  bookingId: string;
  on: ISODate;
  why: string;
}

export interface BillableCount {
  /** Billable, within the cap: one per customer, in the order they booked (those already charged among them). */
  billable: Billable[];
  /** Billable, but past the cap. */
  overCap: Billable[];
  /** Customers with a booking that isn't billable, and why. */
  not: NotBillable[];
}

/**
 * A one pass's billable bookings (BRIEF §2), from the ledger and the replies, keyed by customer. A booking is billable
 * when all six hold: (1) the customer gave a real reply to one of this pass's notes (not a stop, a no, a wrong person,
 * a complaint, an out-of-office or a bounce; never an answer to a new request); (2) it was made (a quote: approved)
 * within the window (60 days) of the first such reply before it; (3) it's the customer's first, one charge per customer
 * however many jobs; (4) it's within the cap, which counts the charges not refunded or skipped (a disputed one holds its
 * place until Jack decides), the free people's never; (5) it isn't disputed ("not ours"); (6) it was made before any
 * cancel. A job cancelled before the work isn't a booking, nor one the owner texted that their records show only
 * cancelled. On the rest of a lawn or cleaning list, a cleaning customer must be back on a regular schedule, and a lawn
 * one booked a season or a job over $500. On a `freeFirst` pass, the first people written to are free. A customer with
 * a charge is billable by it: a charge refunded or skipped is that customer done. A pass gone monthly still bills its
 * own bookings (billsPass).
 */
export function billableBookings(state: AccountState): BillableCount {
  const out: BillableCount = { billable: [], overCap: [], not: [] };
  const ds = state.dataset;
  const plan = ds.business.plan;
  if (!billsPass(plan)) return out;
  const windowDays = plan.windowDays ?? ONE_PASS.windowDays;
  const cap = plan.capBookings ?? ONE_PASS.capBookings;
  const day = (at: string) => at.slice(0, 10);

  // the pass's own notes that went (marked so, or answered: a reply read before its note's sent event stops that note
  // first), and the day each person was first written to
  const answered = new Set(state.replies.map((r) => r.touchId));
  const notes = passTouches(state).filter((t) => t.track !== "new_request" && (OUT.has(t.status) || answered.has(t.id)));
  const ours = new Set(notes.map((t) => t.id));
  const wroteOn = new Map<string, string>();
  for (const t of notes) {
    const at = t.sentAt ?? t.dueAt;
    if (!wroteOn.has(t.customerId) || at < wroteOn.get(t.customerId)!) wroteOn.set(t.customerId, at);
  }
  const fromRequest = (r: Reply) => !!r.opportunityId?.startsWith("req:") || !!r.followUpOf?.startsWith("req:");
  const toPass = (r: Reply) => !!r.customerId && !fromRequest(r) && (r.touchId ? ours.has(r.touchId) : wroteOn.has(r.customerId) && day(wroteOn.get(r.customerId)!) <= day(r.receivedAt));
  const replies = new Map<string, Reply[]>();
  for (const r of [...state.replies].sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1))) if (toPass(r)) (replies.get(r.customerId!) ?? replies.set(r.customerId!, []).get(r.customerId!)!).push(r);

  // the free people: the first written to, by when their first note went
  const free = new Set<string>();
  for (const t of notes.filter((t) => t.step === 1).sort((a, b) => (a.sentAt ?? a.dueAt).localeCompare(b.sentAt ?? b.dueAt) || a.id.localeCompare(b.id))) {
    if (free.size >= (plan.freeFirst ?? 0)) break;
    free.add(t.customerId);
  }

  const nameOf = bookingNames(ds);
  const jobsOf = new Map<string, Job[]>();
  const madeFrom = new Map<string, Job[]>();
  for (const j of ds.jobs) {
    (jobsOf.get(nameOf(j)) ?? jobsOf.set(nameOf(j), []).get(nameOf(j))!).push(j);
    if (j.quoteId) (madeFrom.get(j.quoteId) ?? madeFrom.set(j.quoteId, []).get(j.quoteId)!).push(j);
  }
  // the jobs a booking is: a job's own (by the name its booking goes by), or the jobs an approved quote became
  const jobsFor = (r: Recovery) => (r.record.kind === "job" ? (jobsOf.get(r.record.id) ?? []) : r.record.kind === "quote" ? (madeFrom.get(r.record.id) ?? []) : []);

  // the day a booking was made: a quote's is the day it was approved, whether the ledger has it as the quote (the very
  // quote chased, which it dates by the day it became a job) or as the job made from it. A quote approved before the
  // pass wrote to them (approved, never scheduled) isn't that booking: the job made from it is.
  const quotes = new Map(ds.quotes.map((q) => [q.id, q]));
  const madeOn = (r: Recovery) => {
    const first = day(wroteOn.get(r.customerId) ?? "");
    const ids = [r.record, r.from?.record].flatMap((x) => (x?.kind === "quote" ? [x.id] : [])).concat(jobsFor(r).flatMap((j) => j.quoteId ?? []));
    const approved = ids.map((id) => quotes.get(id)?.approvedOn).filter((on): on is ISODate => !!on && on >= first);
    return approved.sort()[0] ?? r.cameBackOn;
  };
  // the jobs a booking the owner texted could be: theirs made after the first note, over the span the ledger matches
  // it on (a job only cancelled never takes its place there)
  const toldJobs = (r: Recovery) => {
    const reply = r.match === "owner_reported" ? state.replies.find((x) => x.id === r.record.id) : undefined;
    if (!reply) return [];
    const [from] = bookingSpan(reply, r.cameBackOn);
    const first = day(wroteOn.get(r.customerId) ?? "");
    return ds.jobs.filter((j) => j.customerId === r.customerId && (jobOn(j) ?? "") >= (first > from ? first : from));
  };
  const cancelled = (jobs: Job[]) => !!jobs.length && jobs.every((j) => j.status === "cancelled");
  // back on a regular schedule (a season, on a lawn route): marked recurring, or visits coming like a regular's
  const regular = (jobs: Job[]) =>
    jobs.some((j) => j.recurring || j.everyDays) ||
    rhythmOf(jobs.filter((j) => j.visit && jobDate(j)).map((j) => ({ date: jobDate(j)! })).sort((a, b) => (a.date < b.date ? -1 : 1))).recurring;
  const restOf = soldMonthly(ds.business.trade) ? ds.business.trade : undefined;

  /** Why this booking isn't billable, or the lead it's billed against. */
  const judge = (r: Recovery): { why: string } | { lead: Reply } => {
    const on = madeOn(r);
    if (plan.cancelledOn && on >= plan.cancelledOn) return { why: "Booked after the owner cancelled" };
    const jobs = jobsFor(r);
    if (cancelled(jobs) || cancelled(toldJobs(r))) return { why: "The job was cancelled before the work" };
    const theirs = replies.get(r.customerId) ?? [];
    const real = theirs.filter((x) => !NOT_A_REPLY.has(x.intent));
    if (!real.length) return { why: theirs.length ? "They only wrote back to stop, say no or bounce" : "Never wrote back to the pass's notes" };
    const first = real.find((x) => day(x.receivedAt) <= on);
    if (!first) return { why: "Booked before they wrote back" };
    const lag = daysBetween(day(first.receivedAt), on);
    if (lag > windowDays) return { why: `Booked ${lag} days after they wrote back (more than ${windowDays})` };
    if (restOf === "cleaning" && !regular(jobs)) return { why: "Not back on a regular schedule" };
    if (restOf && restOf !== "cleaning" && !regular(jobs) && r.value <= LAWN_JOB_OVER) return { why: `Not a season or a job over $${LAWN_JOB_OVER}` };
    // the lead the owner knows it by: the one he said BOOKED to, else the one we handed him
    const told = r.match === "owner_reported" ? r.record.id : r.from?.match === "owner_reported" ? r.from.record.id : undefined;
    return { lead: real.find((x) => x.id === told) ?? real.find((x) => x.handedOffAt) ?? first };
  };

  const bookings = new Map<string, Recovery[]>();
  for (const r of [...counted(state.recoveries)].sort((a, b) => madeOn(a).localeCompare(madeOn(b)) || (a.id < b.id ? -1 : 1)))
    (bookings.get(r.customerId) ?? bookings.set(r.customerId, []).get(r.customerId)!).push(r);
  const found: Billable[] = [];
  for (const [customerId, rs] of bookings) {
    let firstWhy: string | undefined;
    let hit: Billable | undefined;
    for (const r of rs) {
      const j = judge(r);
      if ("lead" in j) {
        hit = { customerId, bookingId: r.id, on: madeOn(r), value: r.value, replyId: j.lead.id, code: leadCode(j.lead.id) };
        break;
      }
      firstWhy ??= j.why;
    }
    if (hit) found.push(hit);
    else out.not.push({ customerId, bookingId: rs[0]!.id, on: madeOn(rs[0]!), why: firstWhy! });
  }
  found.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.customerId < b.customerId ? -1 : 1));

  // the cap: the places held by charges, then the rest in the order they booked
  const charges = new Map((plan.charges ?? []).map((c) => [c.customerId, c]));
  let held = (plan.charges ?? []).filter(holdsPlace).length;
  for (const x of found) {
    const c = charges.get(x.customerId);
    if (c && !holdsPlace(c)) out.not.push({ customerId: x.customerId, bookingId: x.bookingId, on: x.on, why: c.reason ?? (c.status === "refunded" ? "Refunded" : "Skipped") });
    else if (c) out.billable.push(x);
    else if (free.has(x.customerId)) out.not.push({ customerId: x.customerId, bookingId: x.bookingId, on: x.on, why: `One of the first ${plan.freeFirst} people: no charge, as promised` });
    else if (held < cap) {
      out.billable.push(x);
      held++;
    } else out.overCap.push(x);
  }
  return out;
}
