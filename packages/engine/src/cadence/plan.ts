import type { BreakageType, Dataset, ISODate, Opportunity, Touch } from "../model.ts";
import type { ScanResult } from "../breakage/detect.ts";
import { renderNote } from "../copy/render.ts";
import { SEQUENCES } from "../copy/templates.ts";
import { addDays, hash, makeId, mondayOf, weekday } from "../util.ts";

export interface PlanOptions {
  /** First day notes may go out. */
  startOn: ISODate;
  /** Only start this many new people (the free round is 150). */
  limitPeople?: number;
  /** Customers already in a sequence or already contacted — skip them. */
  skipCustomers?: Set<string>;
  types?: BreakageType[];
  /** Leave the holdout group out (it never gets contacted). Default true. */
  applyHoldout?: boolean;
  /** Override the weekly new-people cap. */
  weeklyNew?: number;
  /**
   * Who goes first. "reply" = most likely to write back (the free round: its job is to prove
   * people answer). "dollars" = most expected revenue (paying accounts). Default follows the plan stage.
   */
  rank?: "reply" | "dollars";
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
}

/** No single kind of leak takes more than this share of a limited round. */
export const MAX_TYPE_SHARE = 0.4;

/** Deterministic holdout membership: same person, same answer, every run. */
export function inHoldout(customerId: string, pct: number): boolean {
  if (pct <= 0) return false;
  return (parseInt(hash(`holdout|${customerId}`), 36) % 1000) / 1000 < pct;
}

function allowedDay(ds: Dataset, d: ISODate): boolean {
  const b = ds.business;
  if (!b.sendDays.includes(weekday(d))) return false;
  if (b.blackoutWeeks.includes(mondayOf(d))) return false;
  return true;
}

function nextAllowed(ds: Dataset, d: ISODate): ISODate {
  let x = d;
  for (let i = 0; i < 60; i++) {
    if (allowedDay(ds, x)) return x;
    x = addDays(x, 1);
  }
  return d;
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
  const byId = new Map(ds.customers.map((c) => [c.id, c]));
  const holdout: string[] = [];
  const skipped: Plan["skipped"] = [];
  const applyHoldout = opts.applyHoldout ?? true;
  const candidates: Opportunity[] = [];
  for (const o of result.primary) {
    if (!o.channels.includes("email")) continue;
    if (opts.types && !opts.types.includes(o.type)) continue;
    if (opts.skipCustomers?.has(o.customerId)) continue;
    if (applyHoldout && inHoldout(o.customerId, b.persistence.holdoutPct)) {
      holdout.push(o.customerId);
      continue;
    }
    candidates.push(o);
  }
  const rank = opts.rank ?? (b.plan.stage === "trial" ? "reply" : "dollars");
  if (rank === "reply") {
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
  }
  const limit = opts.limitPeople ?? candidates.length;
  const weeklyNew = opts.weeklyNew ?? b.weeklyNewContacts;
  const perDay = Math.max(1, Math.ceil(weeklyNew / Math.max(1, b.sendDays.length)));

  const touches: Touch[] = [];
  const people: string[] = [];
  const dayCount = new Map<ISODate, number>();
  const weekCount = new Map<ISODate, number>();
  let day = nextAllowed(ds, opts.startOn);

  for (const o of candidates) {
    if (people.length >= limit) break;
    const c = byId.get(o.customerId);
    if (!c) continue;
    // find a start day with room in the day and the week
    for (let guard = 0; guard < 400; guard++) {
      const wk = mondayOf(day);
      if ((dayCount.get(day) ?? 0) < perDay && (weekCount.get(wk) ?? 0) < weeklyNew) break;
      day = nextAllowed(ds, addDays(day, 1));
    }
    const seq = SEQUENCES[o.type];
    const notes: Touch[] = [];
    let lastSend = day;
    let ok = true;
    for (const st of seq.steps) {
      const sendOn = st.step === 1 ? day : nextAllowed(ds, addDays(day, st.day) > lastSend ? addDays(day, st.day) : addDays(lastSend, 1));
      const n = renderNote(o, c, { ds, sendOn }, st.step);
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
  };
}
