import type { ISODateTime, Job, RecordKind, Touch } from "../model.ts";
import { visitBook, type VisitBook } from "../breakage/visits.ts";
import { customerById, jobsOf, oppById, quoteById, quotesOf } from "../lookup.ts";
import { statusReadsTwoWays } from "../ingest/fields.ts";
import { makeId } from "../util.ts";
import type { AccountState } from "./state.ts";

/** Work going on right now (a job done and waiting on its invoice isn't). */
const OPEN_JOB = new Set<Job["status"]>(["unscheduled", "scheduled", "active", "late", "on_hold"]);

/**
 * Why a queued follow-up isn't needed any more, if it isn't: the quote it chases was approved, became a job or got a
 * no; the request got its quote; the approved work got on the schedule; or, since it was planned, they booked a job,
 * said yes to another quote or got a new one (a sync or an import says so). A visit is booked work once it's done, or
 * while it's still to come on a schedule that's still served: one that went by undone, or is left on the calendar of
 * a schedule that stopped, is neither. Answers to new requests have their own rule (staleAnswer). Returns a checker,
 * so a pass over many notes reads the records once.
 */
export function settledCheck(state: AccountState): (t: Touch) => string | undefined {
  const ds = state.dataset;
  let book: VisitBook | undefined;
  const visits = () => (book ??= visitBook(ds));
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
    const booked = (j: Job) => j.status !== "cancelled" && !(scheduling && j.status === "unscheduled") && (!j.visit || visits().worked(j) || visits().ahead(j));

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
      // a status a person has to read ("Yes - backed out", one we don't recognise, one that reads two ways): no more
      // notes until they have; the hold it gets only stops new plans
      if (q && (q.unreadStatus || statusReadsTwoWays(q.rawStatus))) return "its status changed to one a person needs to read";
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
    // a job on the go (one with no dates on it is still work in progress), or a visit still to come
    if (jobs.some((j) => booked(j) && (j.visit ? visits().ahead(j) : OPEN_JOB.has(j.status)) && !isSource("job", j.id))) return "they have a job on the go";
    return undefined;
  };
}

/** Why follow-ups were stopped when a newer quote went out (to them, or for the request they chased). */
const NEWER_QUOTE = /^No longer needed: (their request got a quote|they've had a new quote since)$/;

/**
 * People whose latest follow-ups a newer quote stopped, with nothing queued for them since, and the day those were
 * planned (for a request's follow-up, the request's own day). That quote is the one to chase now: it gets its own
 * follow-up, though we wrote to them lately (planBatch, find). Anything from before that day stays left alone.
 */
export function supersededOn(state: AccountState): Map<string, string> {
  const live = new Set<string>();
  // each planned sequence (an opportunity planned twice is two): whose, the day it was planned, and whether a newer quote stopped it
  const seqs = new Map<string, { customerId: string; on: string; stopped: boolean; from?: string }>();
  for (const t of state.touches) {
    if (t.status === "planned" || t.status === "approved" || t.status === "sending") live.add(t.customerId);
    if (t.instant) continue;
    const k = `${t.opportunityId}|${t.plannedOn ?? ""}`;
    const s = seqs.get(k) ?? seqs.set(k, { customerId: t.customerId, on: "", stopped: false }).get(k)!;
    // planned before the day was recorded: the day its note 1 was due (later, so never too eager)
    const on = t.plannedOn ?? (t.step === 1 ? t.dueAt.slice(0, 10) : "");
    if (on > s.on) s.on = on;
    if (t.status === "cancelled" && NEWER_QUOTE.test(t.lastError ?? "")) {
      s.stopped = true;
      // the quote that answered a request is dated from the request on, often before its follow-up was planned (the
      // sheet comes in days later): release from the request's own day, so that quote is the one chased next
      if (t.chases?.kind === "request" && /request got a quote/.test(t.lastError!)) s.from = state.dataset.requests.find((r) => r.id === t.chases!.id)?.createdOn?.slice(0, 10);
    }
  }
  const latest = new Map<string, { on: string; stopped: boolean; from?: string }>();
  for (const s of seqs.values()) if (s.on >= (latest.get(s.customerId)?.on ?? "")) latest.set(s.customerId, s);
  const out = new Map<string, string>();
  for (const [id, s] of latest) if (s.stopped && s.on && !live.has(id)) out.set(id, s.from && s.from < s.on ? s.from : s.on);
  return out;
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
