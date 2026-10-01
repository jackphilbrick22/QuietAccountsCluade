import type { ISODateTime, Job, RecordKind, Touch } from "../model.ts";
import { customerById, jobsOf, oppById, quoteById, quotesOf } from "../lookup.ts";
import { makeId } from "../util.ts";
import type { AccountState } from "./state.ts";

/** Work going on right now (a job done and waiting on its invoice isn't). */
const OPEN_JOB = new Set<Job["status"]>(["unscheduled", "scheduled", "active", "late", "on_hold"]);

/**
 * Why a queued follow-up isn't needed any more, if it isn't: the quote it chases was approved, became a job or got a
 * no; the request got its quote; the approved work got on the schedule; or, since it was planned, they booked a job,
 * said yes to another quote or got a new one (a sync or an import says so). Answers to new requests have their own
 * rule (staleAnswer). Returns a checker, so a pass over many notes reads the records once.
 */
export function settledCheck(state: AccountState): (t: Touch) => string | undefined {
  const ds = state.dataset;
  // notes planned before the day was recorded: the day their sequence's first note was due (later, so never too eager)
  let firstDue: Map<string, string> | undefined;
  const plannedOn = (t: Touch): string | undefined => {
    if (t.plannedOn) return t.plannedOn;
    if (!firstDue) {
      firstDue = new Map();
      for (const x of state.touches) if (x.step === 1 && !x.instant && (firstDue.get(x.opportunityId) ?? "") < x.dueAt.slice(0, 10)) firstDue.set(x.opportunityId, x.dueAt.slice(0, 10));
    }
    return firstDue.get(t.opportunityId);
  };
  return (t) => {
    if (t.instant) return undefined;
    const o = oppById(state.scan?.opportunities, t.opportunityId);
    if (o?.suppressed === "already_customer_again") return "they came back on their own";
    const about = t.chases ?? (o ? { type: o.type, kind: o.source.kind, id: o.source.id } : undefined);
    const quotes = quotesOf(ds, t.customerId);
    const jobs = jobsOf(ds, t.customerId);
    const isSource = (kind: RecordKind, id: string) => about?.kind === kind && about.id === id;
    // approved work waiting for a date: a job made for it that's still unscheduled is the same wait
    const scheduling = about?.type === "approved_unscheduled";
    const booked = (j: Job) => j.status !== "cancelled" && !(scheduling && j.status === "unscheduled");

    // the record it chases moved on
    if (about?.kind === "quote") {
      const q = quoteById(ds, about.id);
      if (q && scheduling) {
        const linked = jobs.filter((j) => j.quoteId === q.id || q.jobIds.includes(j.id));
        if (linked.some(booked) || (!linked.length && q.status === "converted")) return "the work is on the schedule now";
      } else if (q && about.type !== "declined_option") {
        if (q.status === "converted" || q.jobIds.length) return "the quote became a job";
        if (q.status === "approved") return "the quote was approved";
        if (q.status === "declined" && about.type !== "declined_quote") return "they said no to the quote";
      }
    } else if (about?.kind === "request") {
      const r = ds.requests.find((x) => x.id === about.id);
      if (r && (r.quoteId || r.status === "converted" || quotes.some((q) => (q.sentOn ?? q.createdOn ?? "") >= (r.createdOn ?? "9999")))) return "their request got a quote";
    } else if (about?.kind === "job" && scheduling) {
      const j = jobs.find((x) => x.id === about.id);
      if (j?.status === "cancelled") return "the job was cancelled";
      if (j && j.status !== "unscheduled") return "the work is on the schedule now";
    }

    // anything booked or quoted since it was planned
    const since = plannedOn(t);
    const after = (d?: string) => !!d && !!since && d > since;
    if (jobs.some((j) => booked(j) && !isSource("job", j.id) && (after(j.createdOn) || after(j.scheduledOn) || after(j.completedOn)))) return "they've booked a job since";
    if (quotes.some((q) => !isSource("quote", q.id) && (after(q.approvedOn) || after(q.convertedOn)))) return "they've said yes to a quote since";
    if (quotes.some((q) => !isSource("quote", q.id) && (after(q.sentOn) || after(q.createdOn)))) return "they've had a new quote since";
    // a job on the go (one with no dates on it is still work in progress)
    if (jobs.some((j) => OPEN_JOB.has(j.status) && booked(j) && !isSource("job", j.id))) return "they have a job on the go";
    return undefined;
  };
}

/**
 * Follow-ups still queued for an opportunity that's settled (approved, booked, quoted again) are cancelled, with one
 * note per person for the operator. A sending platform's copies are the caller's to pull: the cancelled notes come back.
 */
export function dropSettled(state: AccountState, now: ISODateTime): Touch[] {
  const why = settledCheck(state);
  const out: Touch[] = [];
  const told = new Set<string>();
  for (const t of state.touches) {
    if (t.instant || (t.status !== "approved" && t.status !== "planned")) continue;
    const w = why(t);
    if (!w) continue;
    t.status = "cancelled";
    t.lastError = `No longer needed: ${w}`;
    out.push(t);
    if (told.has(t.opportunityId)) continue;
    told.add(t.opportunityId);
    const name = customerById(state.dataset, t.customerId)?.name ?? "a customer";
    const title = `Stopped the follow-ups to ${name}`;
    state.events.push({ id: makeId("ev", "guard", now, title, state.events.length), at: now, agent: "guard", kind: "action", title, detail: `${w[0]!.toUpperCase()}${w.slice(1)}.`, refs: [{ kind: "customer", id: t.customerId }] });
  }
  if (out.length) state.updatedAt = now;
  return out;
}
