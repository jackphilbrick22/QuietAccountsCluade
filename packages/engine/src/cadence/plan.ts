import type { BreakageType, BusinessProfile, Dataset, Features, ISODate, Opportunity, Touch } from "../model.ts";
import { pickWorked, type ScanResult } from "../breakage/detect.ts";
import { renderNote } from "../copy/render.ts";
import { FRESH_SEQUENCE, sequenceFor } from "../copy/templates.ts";
import { alwaysOnFor } from "../breakage/assumptions.ts";
import { paceOnePass, type Pace } from "./pace.ts";
import { climateOf, comesBackEachSeason, findService, growingSeason, SEASONAL_TRADES, seasonFit, sellingFrom, sellingSeason, sellingWindow, stateOf } from "../trades/index.ts";
import { addDays, hash, makeId, mondayOf, monthOf, weekday } from "../util.ts";

export interface PlanOptions {
  /** First day notes may go out. */
  startOn: ISODate;
  /** Only start this many new people (the free round is 150). */
  limitPeople?: number;
  /** Customers already in a sequence or already contacted — skip them. */
  skipCustomers?: Set<string>;
  /** Narrows the leaks the trade's offer works (worksLeak) further. */
  types?: BreakageType[];
  /** Leave the holdout group out (it never gets contacted). Default true, except on a one pass. */
  applyHoldout?: boolean;
  /** Override the weekly new-people cap. */
  weeklyNew?: number;
  /**
   * Who goes first. "reply" = most likely to write back (the free round: its job is to prove
   * people answer). "dollars" = most expected revenue (paying accounts). "newest" = the newest quote or
   * customer first (a one pass). Default follows the plan.
   */
  rank?: "reply" | "dollars" | "newest";
  /** Include opportunities held for a look (priced to lose, realtor/HOA bids). Default false. */
  includeCaution?: boolean;
  /** Comparison-group people whose wait is over: plan them like anyone else. */
  released?: Set<string>;
  /** People we've already written to at some point (changes what a first note may honestly say). */
  contacted?: Set<string>;
  /** First-note days already scheduled or sent, so a top-up counts them against the daily and weekly pace. */
  existingStarts?: ISODate[];
  /**
   * People who just asked for new work (we answered their request), with the day they asked: only what follows it is
   * planned for them (the request's own follow-up, or the quote sent after it), never an old leak dug up the next day.
   * Likewise people whose follow-ups a newer quote stopped, from the day those were planned.
   */
  askedOn?: Map<string, ISODate>;
  /** What this server sells beyond the two offers: new-request answering brings the fresh-quote sequence. */
  features?: Features;
  /**
   * A one pass: first notes paced to finish by `endOn` on its `inboxes` (paceOnePass) instead of the weekly pace, with
   * `busy` the notes already on the calendar by day.
   */
  pass?: { endOn: ISODate; inboxes: number; busy?: Map<ISODate, number> };
}

export interface Plan {
  touches: Touch[];
  /** Customer ids in the order they start. */
  people: string[];
  /** Customer ids deliberately left out to measure true lift. */
  holdout: string[];
  firstDay?: ISODate;
  lastDay?: ISODate;
  weeks: { week: ISODate; newPeople: number; notes: number }[];
  /** People skipped because no note could be written cleanly. */
  skipped: { customerId: string; why: string }[];
  /** A one pass's pacing: the end date it meets, and when that isn't the one asked for, what would meet it. */
  pace?: Pace;
}

/** New work that waits while the owner is booked out. Said-yes-but-unscheduled and invoices never wait. */
export const HOLD_WHEN_BOOKED = new Set<BreakageType>(["unanswered_quote", "archived_quote", "changes_requested", "unquoted_request", "declined_quote", "declined_option", "one_and_done", "lapsed_regular", "missed_upsell", "service_due"]);

/**
 * Booked out: new work waits until about three weeks before the schedule opens up, so the leads land when the owner
 * can actually take them (owners let quotes die when they're busy, then regret it). The first day it may start, when
 * that's more than three weeks after `startOn`.
 */
export function bookedOutStart(ds: Dataset, startOn: ISODate): ISODate | undefined {
  const until = ds.business.bookedOutUntil;
  return until && until > addDays(startOn, 21) ? nextAllowed(ds, addDays(until, -21)) : undefined;
}

/** No single kind of leak takes more than this share of a limited round. */
export const MAX_TYPE_SHARE = 0.4;

/** Deterministic holdout membership: same person, same answer, every run. */
export function inHoldout(customerId: string, pct: number): boolean {
  if (pct <= 0) return false;
  return (parseInt(hash(`holdout|${customerId}`), 36) % 1000) / 1000 < pct;
}

/** Whether notes may go out on a day: one of the send days, outside the blackout weeks. */
export function allowedDay(ds: Dataset, d: ISODate): boolean {
  const b = ds.business;
  if (!b.sendDays.includes(weekday(d))) return false;
  if (b.blackoutWeeks.includes(mondayOf(d))) return false;
  return true;
}

export function nextAllowed(ds: Dataset, d: ISODate): ISODate {
  let x = d;
  for (let i = 0; i < 60; i++) {
    if (allowedDay(ds, x)) return x;
    x = addDays(x, 1);
  }
  return d;
}

/**
 * Whether a note about `o` may go out on `day`. Work that comes back each season ("Want the lights up again this
 * year?", a lawn shop's clean-ups) is asked about in its season. A seasonal shop's other past customers hear from it in
 * its selling windows (fall clean-up, spots for spring), and nothing of a seasonal shop's goes out once fall clean-up
 * selling ends (mid-November in the north) until the new year: never in December.
 */
export function goesOutOn(b: BusinessProfile, o: { type: BreakageType; serviceId?: string }, day: ISODate): boolean {
  const svc = o.type === "service_due" && o.serviceId ? findService(o.serviceId)?.service : undefined;
  const comesBack = svc && comesBackEachSeason(svc) ? svc : undefined;
  if (comesBack && seasonFit(comesBack, climateOf(stateOf(b)), monthOf(day)) !== "now") return false;
  if (!SEASONAL_TRADES.has(b.trade)) return true;
  const season = growingSeason(b);
  return day.slice(5) <= season.fallEnds && (!!comesBack || !!sellingWindow(season, day));
}

/** Local wall-clock send time inside the window, spread so notes don't all land at 7:00. */
export function sendTime(ds: Dataset, key: string): string {
  const [start, end] = ds.business.sendWindow;
  const span = Math.max(1, (end - start) * 60 - 1);
  const minutes = start * 60 + (parseInt(hash(key), 36) % span);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function planOutreach(ds: Dataset, result: ScanResult, opts: PlanOptions): Plan {
  const b = ds.business;
  const seasonal = SEASONAL_TRADES.has(b.trade);
  const season = seasonal ? growingSeason(b) : undefined;
  const byId = new Map(ds.customers.map((c) => [c.id, c]));
  const holdout: string[] = [];
  const skipped: Plan["skipped"] = [];
  const applyHoldout = opts.applyHoldout ?? b.plan.kind !== "one_pass";
  const candidates: Opportunity[] = [];
  const works = pickWorked(b.trade, opts.types ? result.opportunities.filter((o) => opts.types!.includes(o.type)) : result.opportunities);
  for (const o of works) {
    if (!o.channels.includes("email")) continue;
    if (opts.skipCustomers?.has(o.customerId)) continue;
    // taken off the list since the scan (SKIP): never planned again, whatever the scan still holds
    if (o.suppressed || byId.get(o.customerId)?.doNotContact) continue;
    const asked = opts.askedOn?.get(o.customerId);
    if (asked && !((o.source.kind === "quote" || o.source.kind === "request") && (o.anchorDate ?? "") >= asked)) continue;
    if (o.caution?.length && !opts.includeCaution) {
      skipped.push({ customerId: o.customerId, why: `Held for a look: ${o.caution.join("; ")}` });
      continue;
    }
    if (applyHoldout && !opts.released?.has(o.customerId) && inHoldout(o.customerId, b.persistence.holdoutPct)) {
      holdout.push(o.customerId);
      continue;
    }
    candidates.push(o);
  }
  const rank = opts.rank ?? (b.plan.kind === "one_pass" ? "newest" : b.plan.stage === "trial" ? "reply" : "dollars");
  if (rank === "newest") {
    // the whole list once, the freshest first: no share kept for any kind of leak
    candidates.sort((x, y) => x.ageDays - y.ageDays || y.expectedValue - x.expectedValue || x.id.localeCompare(y.id));
  } else if (rank === "reply") {
    candidates.sort((x, y) => y.recoverProbability - x.recoverProbability || y.expectedValue - x.expectedValue || x.id.localeCompare(y.id));
    // A limited round (the free 150) should prove several leaks, dead quotes included — not 140 service reminders.
    if (opts.limitPeople) {
      const cap = Math.ceil(opts.limitPeople * MAX_TYPE_SHARE);
      const count = new Map<BreakageType, number>();
      const first: Opportunity[] = [];
      const later: Opportunity[] = [];
      for (const o of candidates) {
        const n = count.get(o.type) ?? 0;
        (n < cap ? first : later).push(o);
        count.set(o.type, n + 1);
      }
      candidates.splice(0, candidates.length, ...first, ...later);
    }
  } else {
    // Most expected revenue first. (The scan's priority score also weighs warmth, freshness and season.)
    candidates.sort((x, y) => y.expectedValue - x.expectedValue || y.score - x.score || x.id.localeCompare(y.id));
  }
  const limit = opts.limitPeople ?? candidates.length;
  const weeklyNew = opts.weeklyNew ?? b.weeklyNewContacts;
  const perDay = Math.max(1, Math.ceil(weeklyNew / Math.max(1, b.sendDays.length)));
  let nowDay = nextAllowed(ds, opts.startOn);
  const heldFrom = bookedOutStart(ds, opts.startOn);
  let heldDay = heldFrom ?? nowDay;
  // a one pass waits whole while the owner is booked out: one push of the list, paced from the day it can start
  const pace = opts.pass
    ? paceOnePass({ notes: candidates.slice(0, limit).map((o) => sequenceFor(o, alwaysOnFor(b, opts.features)).steps.length), startOn: heldDay, endOn: opts.pass.endOn, inboxes: opts.pass.inboxes, busy: opts.pass.busy, sendsOn: (d) => allowedDay(ds, d) })
    : undefined;

  const touches: Touch[] = [];
  const people: string[] = [];
  const dayCount = new Map<ISODate, number>();
  const weekCount = new Map<ISODate, number>();
  for (const d of opts.existingStarts ?? []) {
    dayCount.set(d, (dayCount.get(d) ?? 0) + 1);
    weekCount.set(mondayOf(d), (weekCount.get(mondayOf(d)) ?? 0) + 1);
  }
  // room to start someone on a day: in the day and the week
  const room = (d: ISODate) => (dayCount.get(d) ?? 0) < perDay && (weekCount.get(mondayOf(d)) ?? 0) < weeklyNew;

  for (const [i, o] of candidates.entries()) {
    if (people.length >= limit) break;
    const c = byId.get(o.customerId);
    if (!c) continue;
    const held = !!heldFrom && (!!pace || HOLD_WHEN_BOOKED.has(o.type));
    // the first start day from `from` with room in the day and the week
    const roomFrom = (from: ISODate) => {
      let d = from;
      for (let guard = 0; guard < 400 && !room(d); guard++) d = nextAllowed(ds, addDays(d, 1));
      return d;
    };
    // a one pass: each person's notes go on the days its pace gave them (someone left off only leaves their days empty)
    const paced = pace?.people[i];
    let day = paced?.[0] ?? roomFrom(held ? heldDay : nowDay);
    // Seasonal notes go out in their season (goesOutOn): a start that would land past it waits for the next scan in
    // season (a one pass has no next one, so it's listed as skipped), and a follow-up past it is left off. Nothing plans
    // a limited round (the free 150) again, so a seasonal shop's start past its selling window starts in the next one
    // instead (fall clean-up, then spots for spring from January). A seasonal shop's notes carry the selling season
    // they're written for.
    const inSeason = (d: ISODate) => goesOutOn(b, o, d);
    if (!pace && !inSeason(day) && season && opts.limitPeople) day = roomFrom(nextAllowed(ds, sellingFrom(season, day)));
    if (pace ? !paced : !room(day)) {
      skipped.push({ customerId: c.id, why: "No day with room to start them" });
      continue;
    }
    if (!inSeason(day)) {
      if (pace) skipped.push({ customerId: c.id, why: `Out of season${o.type === "service_due" && findService(o.serviceId) ? `: ${findService(o.serviceId)!.service.label}` : ""}` });
      continue;
    }
    if (held) heldDay = day;
    else nowDay = day;
    const seq = sequenceFor(o, alwaysOnFor(b, opts.features));
    const notes: Touch[] = [];
    let lastSend = day;
    let ok = true;
    let threadSubject: string | undefined;
    for (const st of seq.steps) {
      const sendOn = paced ? paced[st.step - 1] : st.step === 1 ? day : nextAllowed(ds, addDays(day, st.day) > lastSend ? addDays(day, st.day) : addDays(lastSend, 1));
      if (!sendOn || !inSeason(sendOn)) break;
      // follow-ups reply in note 1's thread, so they carry its exact subject
      const n = renderNote(o, c, { ds, sendOn, contactedBefore: !!opts.contacted?.has(c.id), threadSubject, features: opts.features }, st.step);
      if (st.step === 1 && n) threadSubject = n.subject;
      if (!n) {
        if (st.step === 1) ok = false;
        continue;
      }
      if (st.step === 1 && n.flags.some((f) => /Unfilled blank|Missing the/.test(f))) {
        ok = false;
        skipped.push({ customerId: c.id, why: n.flags.join("; ") });
        break;
      }
      lastSend = sendOn;
      notes.push({
        id: makeId("t", o.id, st.step),
        opportunityId: o.id,
        customerId: c.id,
        channel: "email",
        step: st.step,
        angle: n.angle,
        dueAt: `${sendOn}T${sendTime(ds, `${c.id}|${st.step}`)}`,
        status: "planned",
        subject: n.subject,
        body: n.body,
        flags: n.flags,
        ...(seq === FRESH_SEQUENCE ? { track: "fresh_quote" as const } : {}),
        chases: { type: o.type, kind: o.source.kind, id: o.source.id, serviceId: o.serviceId },
        plannedOn: ds.asOf,
        ...(seasonal ? { season: sellingSeason(sendOn) } : {}),
      });
    }
    if (!ok || !notes.length) continue;
    touches.push(...notes);
    people.push(c.id);
    dayCount.set(day, (dayCount.get(day) ?? 0) + 1);
    weekCount.set(mondayOf(day), (weekCount.get(mondayOf(day)) ?? 0) + 1);
  }

  touches.sort((a, b2) => (a.dueAt < b2.dueAt ? -1 : a.dueAt > b2.dueAt ? 1 : 0));
  const weeks = new Map<ISODate, { week: ISODate; newPeople: number; notes: number }>();
  for (const t of touches) {
    const wk = mondayOf(t.dueAt.slice(0, 10));
    const w = weeks.get(wk) ?? { week: wk, newPeople: 0, notes: 0 };
    w.notes++;
    if (t.step === 1) w.newPeople++;
    weeks.set(wk, w);
  }
  return {
    touches,
    people,
    holdout,
    firstDay: touches[0]?.dueAt.slice(0, 10),
    lastDay: touches[touches.length - 1]?.dueAt.slice(0, 10),
    weeks: [...weeks.values()].sort((a, b2) => (a.week < b2.week ? -1 : 1)),
    skipped,
    ...(pace ? { pace } : {}),
  };
}
