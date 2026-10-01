import { scan } from "../breakage/detect.ts";
import { summarize } from "../breakage/forecast.ts";
import { quietRateOf } from "../breakage/quiet.ts";
import { refillRate } from "../breakage/refill.ts";
import { BREAKAGE_LABEL } from "../breakage/assumptions.ts";
import { allowedDay, bookedOutStart, goesOutOn, HOLD_WHEN_BOOKED, nextAllowed, planOutreach, type Plan } from "../cadence/plan.ts";
import { INBOX_DAILY, NOTES_SPAN_DAYS, paceOnePass, type Pace } from "../cadence/pace.ts";
import { readReply, type RequestEmail } from "../inbox/index.ts";
import { ingestFile } from "../ingest/index.ts";
import { attribute, bookedThrough, bookingNames, bookingSpan, HOLDOUT_DAYS, lift, noAmount, ownerReported, type LiftReport } from "../ledger/attribution.ts";
import type { AgentEvent, AgentId, Customer, Dataset, Features, ISODate, ISODateTime, Opportunity, RecordKind, Recovery, Reply, Touch } from "../model.ts";
import { ackFor, annualPrice, annualRefund, closeMessage, earlyLeaveRefund, feesPaid, grossFees, guaranteeCheck, handoffText, kickoffText, leadCode, paidYearOn, passEndText, passTouches, renewalNotice, slaNudge, wantedWords, weeklyReport, yearFloor } from "../reports/owner.ts";
import { isOnePass, ONE_PASS } from "../plans.ts";
import { answerTime, promiseTonight, renderRequestAck } from "../copy/render.ts";
import { detectTrade, growingSeason, playbook, SEASONAL_TRADES, sellingFrom, sellingSeason } from "../trades/index.ts";
import { alwaysOnFor, FRESH_QUOTE_DAYS } from "../breakage/assumptions.ts";
import { addDays, addMonths, daysBetween, extractEmails, fmtMoney, fmtPhone, makeId, mondayOf, monthName, plural, round2, sendableEmail, weekday } from "../util.ts";
import type { AccountState, OwnerMessage } from "./state.ts";
import { customerByEmail, customerById, oppById } from "../lookup.ts";
import { settledCheck, supersededOn } from "./settled.ts";

export { ANSWER_HOURS, answerTime } from "../copy/render.ts";

function outreachFor(state: AccountState, customerId: string) {
  // outreach is append-only per customer; a Map keyed by the array keeps markSent O(1)
  let idx = outreachIdx.get(state.outreach);
  if (!idx || idx.len !== state.outreach.length) {
    // one record per customer (the store keys it that way) — comparison-group records included
    idx = { len: state.outreach.length, map: new Map(state.outreach.map((o) => [o.customerId, o])) };
    outreachIdx.set(state.outreach, idx);
  }
  return idx.map.get(customerId);
}
const outreachIdx = new WeakMap<object, { len: number; map: Map<string, AccountState["outreach"][number]> }>();

export const AGENTS: Record<AgentId, { name: string; job: string }> = {
  reader: { name: "Reader", job: "Reads every file you send, from any software, and cleans it up." },
  finder: { name: "Finder", job: "Finds every dollar left on the table and ranks who to reach first." },
  writer: { name: "Writer", job: "Writes each note in your voice, about their actual job." },
  sender: { name: "Sender", job: "Sends at the right time, from your office, at a safe pace." },
  inbox: { name: "Inbox", job: "Reads every reply and sorts it in seconds." },
  dispatcher: { name: "Dispatcher", job: "Texts you the ones who want the work — and reminds you to call." },
  ledger: { name: "Ledger", job: "Tracks who came back and what it paid." },
  guard: { name: "Guard", job: "Honors every stop, protects your reputation, keeps it legal." },
  reporter: { name: "Reporter", job: "Sends you the week in plain English." },
};

function event(state: AccountState, at: ISODateTime, agent: AgentId, kind: AgentEvent["kind"], title: string, detail?: string, refs?: AgentEvent["refs"]): AgentEvent {
  const e: AgentEvent = { id: makeId("ev", agent, at, title, state.events.length), at, agent, kind, title, detail, refs };
  state.events.push(e);
  return e;
}

function ownerMsg(state: AccountState, at: ISODateTime, kind: OwnerMessage["kind"], text: string, refs?: OwnerMessage["refs"]): OwnerMessage {
  const m: OwnerMessage = { id: makeId("om", kind, at, state.ownerMessages.length), at, kind, text, refs };
  state.ownerMessages.push(m);
  return m;
}

/* ------------------------------------------------------------------ */
/* Reader                                                              */
/* ------------------------------------------------------------------ */

export interface FileIn {
  name: string;
  text: string;
  kind?: RecordKind;
}

const KIND_WORD: Record<RecordKind, string> = { quote: "quotes", job: "jobs", invoice: "invoices", client: "clients", request: "requests", visit: "visits" };
const SOFTWARE: Record<string, string> = {
  jobber: "Jobber", housecall_pro: "Housecall Pro", servicetitan: "ServiceTitan", quickbooks: "QuickBooks", arborgold: "Arborgold", singleops: "SingleOps",
  yardbook: "Yardbook", lmn: "LMN", aspire: "Aspire", service_autopilot: "Service Autopilot", workiz: "Workiz", zenmaid: "ZenMaid", gorilladesk: "GorillaDesk",
  spreadsheet: "a spreadsheet", unknown: "your software",
};

export function readFiles(state: AccountState, files: FileIn[], now: ISODateTime): AccountState {
  let ds: Dataset = state.dataset;
  for (const f of files) {
    const r = ingestFile(ds, f.text, f.name, now, { kind: f.kind });
    ds = r.dataset;
    const mapped = Object.keys(r.detection.mapping.fields).length;
    event(state, now, "reader", "action", `Read ${f.name}`, `${r.record.accepted.toLocaleString("en-US")} ${KIND_WORD[r.record.kind]} from ${SOFTWARE[r.record.source]}. Matched ${mapped} columns${r.record.rejected ? `, skipped ${r.record.rejected} empty rows` : ""}.`);
    for (const w of r.record.warnings) event(state, now, "reader", "warning", w, f.name);
  }
  state.dataset = ds;
  adoptTrade(state, now);
  const withEmail = ds.customers.filter((c) => c.emails.length).length;
  event(state, now, "reader", "info", `${plural(ds.customers.length, "customer")} in one clean list`, `Merged across files by client id, email, phone and address. ${Math.round((withEmail / Math.max(1, ds.customers.length)) * 100)}% have an email.`);
  state.updatedAt = now;
  return state;
}

/* ------------------------------------------------------------------ */
/* Finder                                                              */
/* ------------------------------------------------------------------ */

export function find(state: AccountState, now: ISODateTime, features: Features = {}): AccountState {
  const lastContacted: Record<string, string> = {};
  for (const o of state.outreach) if (!o.holdout) lastContacted[o.customerId] = o.lastTouchOn;
  const newSince = Object.fromEntries(supersededOn(state));
  // a one pass works each person once: someone written to is never back on its list (no rescan after 150 days)
  const cooldownDays = isOnePass(state.dataset.business.plan) ? Infinity : 150;
  state.scan = scan(state.dataset, { suppressedEmails: state.suppressions, lastContacted, cooldownDays, newSince }, features);
  state.summary = summarize(state.dataset, state.scan);
  const s = state.summary;
  event(state, now, "finder", "win", `Found ${fmtMoney(s.totalValue)} left on the table`, `${plural(s.opportunities, "opportunity", "opportunities")}; ${fmtMoney(s.reachableValue)} of it is with ${plural(s.reachablePeople, "person", "people")} we can reach.`);
  for (const t of s.byType.slice(0, 4)) {
    event(state, now, "finder", "info", `${BREAKAGE_LABEL[t.type].title}: ${t.reachable.toLocaleString("en-US")}`, `${fmtMoney(t.reachableValue)} — ${BREAKAGE_LABEL[t.type].explain}`);
  }
  const sup = state.scan.stats.suppressedBy;
  const kept = (sup.already_customer_again ?? 0) + (sup.active_work ?? 0) + (sup.do_not_contact ?? 0);
  if (kept) event(state, now, "guard", "info", `Left ${kept.toLocaleString("en-US")} people alone on purpose`, `${sup.already_customer_again ?? 0} already came back on their own, ${sup.active_work ?? 0} have work in progress, ${sup.do_not_contact ?? 0} are marked do-not-contact.`);
  state.updatedAt = now;
  return state;
}

/* ------------------------------------------------------------------ */
/* Writer + Sender: plan a batch                                       */
/* ------------------------------------------------------------------ */

export function planBatch(state: AccountState, now: ISODateTime, opts: { startOn: string; limitPeople?: number; approve?: boolean; kickoff?: boolean; features?: Features }): Plan {
  if (!state.scan) find(state, now, opts.features);
  const b = state.dataset.business;
  // a one pass: the whole list once, newest first, nobody held back, paced to finish by its end date on its inboxes
  const pass = isOnePass(b.plan);
  const inboxes = Math.max(1, b.fromEmails?.length ?? 0);
  // Planned again before any of it is approved, on other inboxes or to another end date: what's planned is taken back
  // and the whole list paced again (otherwise a plan keeps what's planned, so a change to a note waiting for the OK stays).
  const paced = b.plan.pace;
  const repaced = pass && !!paced && (paced.inboxes !== inboxes || paced.endOn !== b.plan.targetEndOn) && paceable(state);
  if (repaced)
    for (const t of state.touches)
      if (t.status === "planned") {
        t.status = "cancelled";
        t.lastError = "Paced again";
      }
  // Our answer to someone's own new request isn't a sequence: once it went, the always-on follow-ups (the request's own,
  // or the quote sent after it) are theirs like anyone's, and for a month only those (nothing older dug up the next day).
  // An answer still on its way holds them until it goes.
  const answered = (t: Touch) => !!t.instant && (t.status === "sent" || t.status === "delivered" || t.status === "bounced");
  // A note handed to a sending platform and taken back when its season closed may have gone (its "sent" can come late,
  // or never): whoever it was for has been written to, and never gets a second first note.
  const takenBack = (t: Touch) => t.status === "cancelled" && t.lastError === OFF_SEASON && !!t.providerId;
  const active = new Set(state.touches.filter((t) => (t.status !== "cancelled" && t.status !== "skipped" && !answered(t)) || takenBack(t)).map((t) => t.customerId));
  const askedOn = new Map<string, string>();
  for (const t of state.touches) {
    if (!answered(t)) continue;
    const sent = (t.sentAt ?? t.dueAt).slice(0, 10);
    if (daysBetween(sent, opts.startOn) > FRESH_QUOTE_DAYS) continue;
    const on = state.dataset.requests.find((r) => `req:${r.id}` === t.opportunityId)?.createdOn ?? sent;
    if (on < (askedOn.get(t.customerId) ?? "9999")) askedOn.set(t.customerId, on);
  }
  // the comparison group waits ~60 days, then gets worked too (nobody's quote is held back for good)
  const released = new Set(state.outreach.filter((o) => o.holdout && !o.treatedFrom && o.releaseOn && o.releaseOn <= opts.startOn).map((o) => o.customerId));
  for (const o of state.outreach) if (!released.has(o.customerId) || active.has(o.customerId)) active.add(o.customerId);
  // Follow-ups a newer quote stopped leave that quote to chase: with nothing else queued, they're planned again, for
  // what came after the stopped notes only (and, already written to, never held back to measure lift). Not on a one
  // pass: each person once.
  if (!pass)
    for (const [id, on] of supersededOn(state)) {
      active.delete(id);
      released.add(id);
      if (on > (askedOn.get(id) ?? "")) askedOn.set(id, on);
    }
  // Someone who wrote back (our answer to their request included) is the owner's to talk to: never planned again,
  // nor any other record at their address. Nothing planned means nothing reaches a sending platform either.
  const replied = repliedCheck(state);
  for (const c of state.dataset.customers) if (replied(c.id)) active.add(c.id);
  const isTrial = !pass && b.plan.stage === "trial";
  // a one pass's first plan, whatever came before it (the rest of a list after its free round)
  const firstEver = pass ? !b.plan.startedOn : !state.touches.some((t) => t.status !== "cancelled");
  // The free round goes to the likeliest replies; paying accounts follow the shop's own strategy.
  const rank = pass ? "newest" : isTrial ? "reply" : state.summary?.profile?.strategy.rank;
  const contacted = new Set(state.touches.filter((t) => t.status === "sent" || t.status === "delivered").map((t) => t.customerId));
  // Everything already on the calendar counts against the pace, so a top-up never doubles it; on a one pass, every
  // note still to go keeps its day's room.
  const existingStarts = state.touches.filter((t) => t.step === 1 && ["planned", "approved", "sent", "delivered"].includes(t.status)).map((t) => t.dueAt.slice(0, 10));
  const busy = new Map<string, number>();
  if (pass) for (const t of state.touches) if (t.status === "planned" || t.status === "approved") busy.set(t.dueAt.slice(0, 10), (busy.get(t.dueAt.slice(0, 10)) ?? 0) + 1);
  // a one pass starts on its first send day, the day it's first planned with anyone on it (booked out, the day new work
  // may start), and ends 30 days on
  const startedOn = b.plan.startedOn ?? bookedOutStart(state.dataset, opts.startOn) ?? nextAllowed(state.dataset, opts.startOn);
  const endOn = b.plan.targetEndOn ?? addDays(startedOn, ONE_PASS.days);
  const plan = planOutreach(state.dataset, state.scan!, {
    startOn: opts.startOn,
    limitPeople: opts.limitPeople,
    skipCustomers: active,
    applyHoldout: !isTrial && !pass,
    rank,
    released,
    contacted,
    askedOn,
    features: opts.features,
    ...(pass ? { pass: { endOn, inboxes, busy } } : { existingStarts }),
  });
  const status: Touch["status"] = opts.approve ? "approved" : "planned";
  // Someone planned again after their notes were cancelled or skipped: the same opportunity and step give the same
  // id, and two notes with one id collide in the database (one is kept) and in every lookup by id.
  const taken = new Set(state.touches.map((t) => t.id));
  for (const t of plan.touches) {
    let id = t.id;
    for (let n = 2; taken.has(id); n++) id = `${t.id}.${n}`;
    taken.add(id);
    t.id = id;
  }
  state.touches.push(...plan.touches.map((t) => ({ ...t, status })));
  for (const id of plan.holdout)
    if (!state.outreach.some((o) => o.customerId === id)) state.outreach.push({ customerId: id, firstTouchOn: opts.startOn, lastTouchOn: opts.startOn, holdout: true, releaseOn: addDays(opts.startOn, HOLDOUT_DAYS) });
  const flagged = plan.touches.filter((t) => t.flags.length).length;
  event(state, now, "writer", "action", `Wrote ${plural(plan.touches.length, "note")} for ${plural(plan.people.length, "person", "people")}`, `Each one about their own job, signed by ${b.signerName}. ${flagged ? `${flagged} need a second look.` : "All passed the quality check."}`);
  const pace = plan.pace;
  // started (and paced) only once someone's on it; notes planned before (and not paced again) keep their days
  if (pace?.lastFirst && plan.people.length) {
    Object.assign(b.plan, { startedOn, targetEndOn: endOn });
    recordPace(state, inboxes, endOn, [pace.late, repaced ? undefined : paced?.late]);
  }
  if (plan.firstDay && (isTrial || pass) && firstEver && opts.kickoff !== false) kickoff(state, now, { awaitOk: !opts.approve });
  if (plan.firstDay)
    event(
      state,
      now,
      "sender",
      "action",
      `Scheduled ${plan.firstDay} → ${plan.lastDay}`,
      pace && b.plan.pace
        ? `The whole list, newest first, on your send days inside your hours: the last first note ${b.plan.pace.lastFirst}, no inbox over ${INBOX_DAILY} a day.${b.plan.pace.late ? ` ${plural(inboxes, "inbox", "inboxes")} can't finish by ${b.plan.targetEndOn}: it ends about ${b.plan.pace.late.canMeet}.` : ""}`
        : `${b.weeklyNewContacts} new people a week, on your send days, inside your hours.${plan.holdout.length ? ` ${plan.holdout.length} held back to measure true lift.` : ""}`,
    );
  state.updatedAt = now;
  return plan;
}

/**
 * One pace record for the whole pass: its last first note and its busiest day of first notes to come (a sending
 * platform's daily new-lead cap, never the monthly weekly pace) are across all its notes, and late, it's late to the
 * latest date any of it can meet (`lates`: what its pacing said).
 */
function recordPace(state: AccountState, inboxes: number, endOn: ISODate, lates: (Pace["late"] | undefined)[]): void {
  const firsts = passTouches(state).filter((t) => t.step === 1 && t.status !== "cancelled" && t.status !== "skipped");
  const lastFirst = firsts.map((t) => t.dueAt.slice(0, 10)).sort().pop()!;
  const toCome = new Map<string, number>();
  for (const t of firsts) if (t.status === "planned" || t.status === "approved") toCome.set(t.dueAt.slice(0, 10), (toCome.get(t.dueAt.slice(0, 10)) ?? 0) + 1);
  const all = [...lates, { canMeet: addDays(lastFirst, NOTES_SPAN_DAYS) }];
  const late = lastFirst > addDays(endOn, -NOTES_SPAN_DAYS) ? all.filter((x) => !!x).sort((x, y) => y.canMeet.localeCompare(x.canMeet))[0] : undefined;
  state.dataset.business.plan.pace = { inboxes, endOn, lastFirst, dailyNew: Math.max(...toCome.values()), ...(late ? { late } : {}) };
}

/**
 * A one pass paced again from `startOn` (an OK that came late, BUSY or OPEN), the way it was first paced: everyone it
 * hasn't written to yet, in the order they were to start, gets new days around the follow-ups still owed to the rest, so
 * no inbox goes over 30 a day (moved by days alone, days would run together). Their notes keep their words. Before it
 * has written to anyone its start and end move with it (its 30 days run from its first send day); after, the end date
 * stays, and the pace says when it can't be met. `held`: the owner is booked out, and each note keeps how far it was
 * pushed back so OPEN can bring it back; otherwise that's cleared. Who moved, and the ids of the notes a sending platform
 * held for them, to take back.
 */
function repacePass(state: AccountState, startOn: ISODate, opts: { held?: boolean } = {}): { moved: number; withdrawn: string[] } {
  const ds = state.dataset;
  const plan = ds.business.plan;
  const out = { moved: 0, withdrawn: [] as string[] };
  if (!isOnePass(plan) || !plan.pace || !plan.startedOn || !plan.targetEndOn) return out;
  const waits = (t: Touch) => t.status === "planned" || t.status === "approved";
  const mine = passTouches(state);
  // each person not written to yet: their note 1, and every note of theirs still to go
  const people = new Map<string, { first: Touch; notes: Touch[] }>();
  for (const t of mine) if (t.step === 1 && waits(t)) people.set(t.opportunityId, { first: t, notes: [] });
  if (!people.size) return out;
  const busy = new Map<ISODate, number>();
  for (const t of state.touches) {
    if (!waits(t)) continue;
    const p = people.get(t.opportunityId);
    if (p) p.notes.push(t);
    else busy.set(t.dueAt.slice(0, 10), (busy.get(t.dueAt.slice(0, 10)) ?? 0) + 1);
  }
  const begun = mine.some((t) => !waits(t) && t.status !== "cancelled" && t.status !== "skipped");
  const endOn = begun ? plan.targetEndOn : addDays(plan.targetEndOn, daysBetween(plan.startedOn, startOn));
  const order = [...people.values()].sort((x, y) => x.first.dueAt.localeCompare(y.first.dueAt));
  // on the inboxes it sends from now
  const inboxes = Math.max(1, ds.business.fromEmails?.length ?? 0);
  const pace = paceOnePass({ notes: order.map((p) => Math.max(...p.notes.map((t) => t.step))), startOn, endOn, inboxes, busy, sendsOn: (d) => allowedDay(ds, d) });
  for (const [i, p] of order.entries()) {
    const days = pace.people[i];
    if (!days) continue;
    // a note 1 on another day goes to a sending platform again on that day (its follow-ups go at the platform's own gaps)
    const again = days[0] !== p.first.dueAt.slice(0, 10);
    for (const t of p.notes) {
      const day = days[t.step - 1] ?? t.dueAt.slice(0, 10);
      const held = (t.heldDays ?? 0) + daysBetween(t.dueAt.slice(0, 10), day);
      t.heldDays = opts.held && held > 0 ? held : undefined;
      t.dueAt = `${day}${t.dueAt.slice(10)}`;
      if (!again) continue;
      if (t.providerId && !out.withdrawn.includes(t.providerId)) out.withdrawn.push(t.providerId);
      t.providerId = undefined;
    }
    if (again) out.moved++;
  }
  if (!begun) Object.assign(plan, { startedOn: startOn, targetEndOn: endOn });
  recordPace(state, inboxes, endOn, [pace.late]);
  return out;
}

/** None of a one pass's notes is past planned (nobody, the owner included, has said OK to them): it can be paced again. */
export function paceable(state: AccountState): boolean {
  return passTouches(state).every((t) => t.status === "planned" || t.status === "cancelled");
}

/**
 * A one pass's end date moved after it was paced: whether the notes it has still meet it. Once they're set (the owner
 * said OK), late, the date they meet is 12 days after its last first note, and more inboxes wouldn't change them.
 * Before the OK, a date they meet is simply theirs; one they don't is left to the next plan, which paces the whole list
 * again to it. Whether anything changed.
 */
export function passEndMoved(state: AccountState): boolean {
  const plan = state.dataset.business.plan;
  const p = plan.pace;
  if (!isOnePass(plan) || !p || !plan.targetEndOn || p.endOn === plan.targetEndOn) return false;
  const late = p.lastFirst > addDays(plan.targetEndOn, -NOTES_SPAN_DAYS);
  if (late && paceable(state)) return false;
  plan.pace = { inboxes: p.inboxes, endOn: plan.targetEndOn, lastFirst: p.lastFirst, dailyNew: p.dailyNew, ...(late ? { late: { canMeet: addDays(p.lastFirst, NOTES_SPAN_DAYS) } } : {}) };
  return true;
}

/**
 * The welcome text for the free round: their quiet rate, the first note word for word, and (when
 * awaitOk) "Reply OK" — nothing goes out until they do. Once only.
 */
export function kickoff(state: AccountState, now: ISODateTime, opts: { awaitOk: boolean; again?: boolean }): OwnerMessage | undefined {
  // a one pass gets a welcome of its own, after a free round's too
  const pass = isOnePass(state.dataset.business.plan);
  if (state.ownerMessages.some((m) => m.kind === "kickoff" && (!pass || m.refs?.some((r) => r.kind === "pass"))) && !(opts.again && state.awaitingOwnerOk)) return undefined;
  const firsts = state.touches.filter((t) => t.step === 1 && (t.status === "planned" || t.status === "approved"));
  if (!firsts.length) return undefined;
  const firstDay = firsts.map((t) => t.dueAt.slice(0, 10)).sort()[0]!;
  const people = new Set(firsts.map((t) => t.customerId)).size;
  if (opts.awaitOk) state.awaitingOwnerOk = now;
  return ownerMsg(state, now, "kickoff", kickoffText(state, firstDay, people, { awaitOk: opts.awaitOk }), pass ? [{ kind: "pass", id: firstDay }] : undefined);
}

export interface RoundApproval {
  /** Notes approved, any written again for the next selling window included. */
  approved: number;
  /** When the round's first note goes out: none when nothing was waiting, or none of it can go in its season. */
  firstDay?: string;
  /**
   * People whose first note the OK moved past its season (it came late): their notes are cancelled and the round is
   * written again for as many in the next selling window, its first note going out `firstDay` (none when nobody's due).
   */
  late?: { people: number; firstDay?: string };
}

/**
 * An OK to what's planned (the owner's by text, or by phone through Jack's Approve) that comes after its first day moves
 * it forward to the OK's first send day: it never sends the backlog at once. A one pass is paced again from there, its
 * start and end with it; a monthly round keeps its spacing.
 */
export function startFromOk(state: AccountState, now: ISODateTime): void {
  const planned = state.touches.filter((t) => t.status === "planned");
  const earliest = planned.map((t) => t.dueAt.slice(0, 10)).sort()[0];
  const today = now.slice(0, 10);
  const start = nextAllowed(state.dataset, Number(now.slice(11, 13)) >= state.dataset.business.sendWindow[1] ? addDays(today, 1) : today);
  if (!earliest || earliest >= start) return;
  if (isOnePass(state.dataset.business.plan) && state.dataset.business.plan.pace) {
    repacePass(state, start);
    return;
  }
  const shift = daysBetween(earliest, start);
  for (const t of planned) t.dueAt = `${nextAllowed(state.dataset, addDays(t.dueAt.slice(0, 10), shift))}${t.dueAt.slice(10)}`;
}

/**
 * The planned round is approved and goes out on schedule: the owner said OK to the first note (by text, or to Jack,
 * who approves it in the console), or Jack looked it over. A late OK moves it forward first (startFromOk). A seasonal
 * shop's notes that the move takes past their season (fall notes OK'd in December, or in a week that runs past
 * mid-November) are cancelled, and whoever's first note went with them is written again for the next selling window.
 * A one pass's end date is then checked against the notes it has.
 */
export function approveRound(state: AccountState, now: ISODateTime): RoundApproval {
  startFromOk(state, now);
  const b = state.dataset.business;
  const planned = state.touches.filter((t) => t.status === "planned");
  const past = planned.filter((t) => outOfSeason(state, t, t.dueAt.slice(0, 10)));
  for (const t of past) {
    t.status = "cancelled";
    t.lastError = OFF_SEASON;
  }
  const lateFirsts = past.filter((t) => t.step === 1);
  const people = new Set(lateFirsts.map((t) => t.customerId)).size;
  const firstDay = planned.filter((t) => t.status === "planned").map((t) => t.dueAt.slice(0, 10)).sort()[0];
  const from = lateFirsts.map((t) => t.dueAt.slice(0, 10)).sort()[0];
  const again = from ? planBatch(state, now, { startOn: nextAllowed(state.dataset, sellingFrom(growingSeason(b), from)), limitPeople: people, kickoff: false }) : undefined;
  const approved = approveAll(state, now);
  // an end date changed while it waited is met (or not) by the notes it has now
  passEndMoved(state);
  return { approved, firstDay, ...(again ? { late: { people, firstDay: again.firstDay } } : {}) };
}

/** The owner texted OK to the first note: the round is approved (approveRound) and goes out on schedule. */
export function ownerApproves(state: AccountState, now: ISODateTime): RoundApproval {
  const r = approveRound(state, now);
  const first = r.firstDay ?? r.late?.firstDay;
  const late = r.late
    ? ` ${plural(r.late.people, "person's", "people's")} first notes would have gone after their season closed: ${r.late.firstDay ? `the round was written again for the next one, from ${r.late.firstDay}` : "nobody's due in the next one yet"}.`
    : "";
  event(state, now, "sender", "action", "The owner said OK by text", `${r.approved ? `${plural(r.approved, "note")} approved; the first go out ${first}.` : "Nothing was waiting."}${late}`);
  return r;
}

export function approveAll(state: AccountState, now: ISODateTime): number {
  state.awaitingOwnerOk = undefined;
  let n = 0;
  for (const t of state.touches) if (t.status === "planned") {
    t.status = "approved";
    n++;
  }
  if (n) event(state, now, "sender", "action", `Approved ${plural(n, "note")}`, "They'll go out on schedule.");
  return n;
}

/* ------------------------------------------------------------------ */
/* Sender: what's due, and marking sends                               */
/* ------------------------------------------------------------------ */

export interface DueTouch {
  touch: Touch;
  to: string;
  customerName: string;
}

/**
 * A seasonal note held past its season (an OK that came late, a pause): it never goes. A late OK writes the round again
 * itself (approveRound). Otherwise someone whose first note never went is planned again like anyone not yet written to,
 * and someone whose first note went hears nothing more, nor does one whose first note a sending platform held: it may
 * have gone (planBatch).
 */
export const OFF_SEASON = "Not sent: its season closed";

/**
 * Whether a note can't go out on `day` for its season. A seasonal shop's note goes only in the selling season it was
 * written for, its words being that season's, and only on the days goesOutOn allows: judged by its opportunity in the
 * latest scan, else by what it was planned about, since a rescan drops work gone out of season (December's clean-ups).
 */
export function outOfSeason(state: AccountState, t: Touch, day: ISODate): boolean {
  if (t.season && t.season !== sellingSeason(day)) return true;
  const about = t.instant ? undefined : (oppById(state.scan?.opportunities, t.opportunityId) ?? t.chases);
  return !!about && !goesOutOn(state.dataset.business, about, day);
}

/** Why a held note will never go: the Sender cancels these for good. Anything else only waits. */
export const HELD_FOR_GOOD = new RegExp(`No sendable email|They replied|Do not contact|Note \\d+ never went|No longer needed|${OFF_SEASON}`);
/** Lint flags for what the law or honesty requires (opt-out, address, no fake "Re:", no made-up stats): the note waits for a fix. */
export const REQUIRED_FLAG = /Missing the|Unfilled blank|Fake Re:|unsourced stat/;
/** "Dave will call you today" is only true for a while: past this, an unsent answer to a request is dropped. */
export const ANSWER_GOOD_FOR_HOURS = 12;

/** The owner marked them do-not-contact in their own software (their setting wins over ours). */
export function doNotContact(state: AccountState, t: Touch): boolean {
  return !!customerById(state.dataset, t.customerId)?.doNotContact || oppById(state.scan?.opportunities, t.opportunityId)?.suppressed === "do_not_contact";
}

/** Why an answer to a new request should no longer go (at `now`, when it would go), if it shouldn't. */
export function staleAnswer(state: AccountState, t: Touch, now: ISODateTime): string | undefined {
  if (!t.instant) return undefined;
  const ds = state.dataset;
  const r = t.opportunityId.startsWith("req:") ? ds.requests.find((x) => x.id === t.opportunityId.slice(4)) : undefined;
  if (r && (r.quoteId || r.status === "converted" || r.status === "archived" || ds.quotes.some((q) => q.customerId === t.customerId && (q.sentOn ?? q.createdOn ?? "") >= (r.createdOn ?? "9999"))))
    return "their request already has a quote or a visit";
  // timed from when it was first due: a send the mailbox refused moves dueAt, never the "today" written in it
  const first = t.askedAt ? answerTime(t.askedAt).slice(0, 16) : t.dueAt.slice(0, 16);
  const due = first < t.dueAt.slice(0, 16) ? first : t.dueAt.slice(0, 16);
  if (now.slice(0, 16) < due) return undefined;
  const late = (Date.parse(`${now.slice(0, 16)}:00Z`) - Date.parse(`${due}:00Z`)) / 3_600_000;
  if (late > ANSWER_GOOD_FOR_HOURS) return `it would have gone ${Math.round(late)} hours late`;
  // worded for its own day, 7am–8pm: never at night, never the day after
  if (now.slice(0, 10) !== due.slice(0, 10) || answerTime(now).slice(0, 16) !== now.slice(0, 16)) return "it would have gone after 8pm, past the day it was written for";
  return undefined;
}

/**
 * Who has written back to us, by record and by address (another record with the same address is the same person).
 * An out-of-office or a bounce isn't them writing. Only an answer to a new request of theirs goes to them after.
 */
export function repliedCheck(state: AccountState): (customerId: string) => boolean {
  const wrote = state.replies.filter((r) => r.intent !== "auto_reply" && r.intent !== "bounce");
  const ids = new Set(wrote.filter((r) => r.customerId).map((r) => r.customerId!));
  const from = new Set(wrote.map((r) => r.from.toLowerCase()));
  return (id) => ids.has(id) || !!customerById(state.dataset, id)?.emails.some((e) => from.has(e.toLowerCase()));
}

/** Everything that should go out at `now`, after the Guard's checks. Pure: marks nothing. */
export function dueTouches(state: AccountState, now: ISODateTime): { due: DueTouch[]; held: { touch: Touch; why: string }[] } {
  const b = state.dataset.business;
  const local = now.slice(0, 16);
  const day = now.slice(0, 10);
  const due: DueTouch[] = [];
  const held: { touch: Touch; why: string }[] = [];
  const replied = repliedCheck(state);
  const health = sendHealth(state);
  const settled = settledCheck(state);
  // each sequence's note 1 (a sent one wins if an opportunity was ever planned twice)
  const firsts = new Map<string, Touch>();
  for (const t of state.touches) if (t.step === 1 && (!firsts.has(t.opportunityId) || t.status === "sent" || t.status === "delivered")) firsts.set(t.opportunityId, t);
  // every step of each sequence, so a follow-up waits for the one before it and the planned gap after it
  const steps = new Map<string, Touch>();
  for (const t of state.touches) {
    const k = `${t.opportunityId}|${t.step}`;
    if (!steps.has(k) || t.status === "sent" || t.status === "delivered") steps.set(k, t);
  }
  for (const t of state.touches) {
    if (t.status !== "approved" || t.dueAt > local) continue;
    const c = customerById(state.dataset, t.customerId);
    const to = c ? sendableEmail(c.emails, state.suppressions) : undefined;
    if (!c || !to) {
      held.push({ touch: t, why: "No sendable email (unsubscribed, bounced or missing)" });
      continue;
    }
    if (doNotContact(state, t)) {
      held.push({ touch: t, why: "Do not contact — the owner's setting in their software" });
      continue;
    }
    // an instant answer to a NEW request goes even if they wrote to us about something else before
    if (!t.instant && replied(c.id)) {
      held.push({ touch: t, why: "They replied — the sequence stops" });
      continue;
    }
    // the quote it chases was approved, the job booked or a new quote sent since: the rest isn't needed
    const done = settled(t);
    if (done) {
      held.push({ touch: t, why: `No longer needed: ${done}` });
      continue;
    }
    if (outOfSeason(state, t, day)) {
      held.push({ touch: t, why: OFF_SEASON });
      continue;
    }
    const required = t.flags.find((f) => REQUIRED_FLAG.test(f));
    if (required) {
      held.push({ touch: t, why: `Failed a required check: ${required}` });
      continue;
    }
    // a follow-up only follows a note 1 that went: otherwise its "Re:" would be someone's first contact
    const first = t.step > 1 && !t.instant ? firsts.get(t.opportunityId) : undefined;
    if (first && first.status !== "sent" && first.status !== "delivered") {
      held.push({ touch: t, why: ["approved", "planned", "sending"].includes(first.status) ? "Waiting for note 1" : "Note 1 never went out — the rest of the sequence stops" });
      continue;
    }
    const prev = t.step > 2 && !t.instant ? steps.get(`${t.opportunityId}|${t.step - 1}`) : t.step === 2 ? first : undefined;
    if (prev && t.step > 2 && prev.status !== "sent" && prev.status !== "delivered") {
      // the note before it can still go: wait for it; it never will (cancelled, skipped, bounced): the rest stops
      held.push({ touch: t, why: ["approved", "planned", "sending"].includes(prev.status) ? `Waiting for note ${t.step - 1}` : `Note ${t.step - 1} never went out — the rest of the sequence stops` });
      continue;
    }
    // never closer to the note before it than planned (a late start doesn't bunch the sequence up)
    if (prev?.sentAt) {
      const gap = daysBetween(prev.dueAt.slice(0, 10), t.dueAt.slice(0, 10));
      if (daysBetween(prev.sentAt.slice(0, 10), day) < gap) {
        held.push({ touch: t, why: `Too soon after note ${t.step - 1}` });
        continue;
      }
    }
    if (t.instant) {
      const stale = staleAnswer(state, t, now);
      if (stale) {
        held.push({ touch: t, why: `No longer needed: ${stale}` });
        continue;
      }
      if (health.paused) {
        held.push({ touch: t, why: health.reason ?? "Paused" });
        continue;
      }
      due.push({ touch: t, to, customerName: c.name });
      continue;
    }
    if (!b.sendDays.includes(weekday(day))) {
      held.push({ touch: t, why: "Not a send day" });
      continue;
    }
    const hour = Number(now.slice(11, 13));
    if (hour < b.sendWindow[0] || hour >= b.sendWindow[1]) {
      held.push({ touch: t, why: "Outside send hours" });
      continue;
    }
    if (health.paused) {
      held.push({ touch: t, why: health.reason ?? "Paused" });
      continue;
    }
    due.push({ touch: t, to, customerName: c.name });
  }
  return { due, held };
}

export function markSent(state: AccountState, touchId: string, at: ISODateTime, providerId?: string): void {
  const t = state.touches.find((x) => x.id === touchId);
  if (!t) return;
  t.status = "sent";
  t.sentAt = at;
  if (providerId) t.providerId = providerId;
  // Answering someone's own new request isn't a follow-up: they were asking anyway. It never opens a ledger
  // record, so a job they book later isn't counted as one we brought back.
  if (t.track === "new_request") return;
  const day = at.slice(0, 10);
  if (!state.quietBefore) state.quietBefore = { ...quietRateOf(state.dataset, day), on: day };
  const rec = outreachFor(state, t.customerId);
  if (rec) {
    rec.lastTouchOn = day;
    if (rec.holdout && !rec.treatedFrom) {
      // a released comparison-group person just got their first note
      const opp = oppById(state.scan?.opportunities, t.opportunityId);
      rec.treatedFrom = day;
      rec.opportunityId = t.opportunityId;
      rec.sourceId = opp?.source.id;
    }
  } else {
    const opp = oppById(state.scan?.opportunities, t.opportunityId);
    state.outreach.push({ customerId: t.customerId, opportunityId: t.opportunityId, sourceId: opp?.source.id, firstTouchOn: day, lastTouchOn: day });
  }
}

/** Cancel everything still queued for a customer (they replied, unsubscribed or bounced). */
export function stopSequence(state: AccountState, customerId: string): number {
  let n = 0;
  for (const t of state.touches) if (t.customerId === customerId && (t.status === "planned" || t.status === "approved")) {
    t.status = "cancelled";
    n++;
  }
  return n;
}

/**
 * Answers to new requests that waited too long (sending was paused or braked) or aren't needed any more are
 * dropped, not sent late, and the owner hears the ones that didn't go. Only notes still with us: a sending
 * platform's copy is the caller's to pull. Returns what was dropped.
 */
export function dropStaleAnswers(state: AccountState, now: ISODateTime): Touch[] {
  const out: Touch[] = [];
  for (const t of state.touches) {
    if (!t.instant || t.status !== "approved" || t.providerId) continue;
    // judged at the time it would go: a retry pushed past 8pm is dropped now, not sent at night
    const why = staleAnswer(state, t, t.dueAt > now.slice(0, 16) ? t.dueAt : now);
    if (!why) continue;
    t.status = "cancelled";
    t.lastError = `Not sent: ${why}`;
    out.push(t);
    const name = customerById(state.dataset, t.customerId)?.name ?? "a new customer";
    const refs = [{ kind: "customer", id: t.customerId }];
    event(state, now, "guard", "warning", `Didn't send the answer to ${name}'s request`, `${why[0]!.toUpperCase()}${why.slice(1)}.`, refs as AgentEvent["refs"]);
    // a quote or visit since means the owner is on it; a late one means nobody answered them
    if (!/quote or a visit/.test(why)) ownerMsg(state, now, "info", `Heads up: our answer to ${name}'s request didn't go out (sending was held, and ${why}). Call them if you haven't.`, refs);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Guard: reputation                                                   */
/* ------------------------------------------------------------------ */

function healthCounts(state: AccountState) {
  return {
    sent: state.touches.filter((t) => t.status === "sent" || t.status === "delivered" || t.status === "bounced").length,
    bounces: state.replies.filter((r) => r.intent === "bounce").length + state.touches.filter((t) => t.status === "bounced").length,
    complaints: state.replies.filter((r) => r.intent === "complaint").length,
    // "Who is this?" means they don't recognize the sender — the step before a spam click.
    confused: state.replies.filter((r) => r.intent === "wrong_person").length,
  };
}

/**
 * A person looked at why the brake tripped (cleaned the list, fixed the sender name) and lets sending resume.
 * The brake then reads only what happens from here on, so it trips again on new problems, not old ones.
 */
export function clearBrake(state: AccountState, now: ISODateTime, by: string): void {
  state.dataset.business.healthBaseline = { at: now, ...healthCounts(state), by };
  event(state, now, "guard", "action", "Send brake cleared — sending resumes", `Cleared by ${by}. Bounces and complaints are counted afresh from here.`);
  state.updatedAt = now;
}

/**
 * The send brake: sending pauses when a rate goes over its limit, once enough notes have gone out to judge it. Small
 * senders get no spam-rate data from Gmail, so these trip well before the providers' limits.
 */
export const SEND_BRAKES = {
  bounces: { rate: 0.03, after: 40 },
  complaints: { rate: 0.001, after: 300 },
  /** "Who is this?" replies and complaints together: people who don't recognize the business. */
  unrecognized: { rate: 0.01, after: 100 },
} as const;

/** "3%", "0.1%": a brake's rate as the console and the reasons say it. */
const brakePct = (rate: number) => `${round2(rate * 100)}%`;

/** The brakes in one line, for the console. */
export function brakesLine(): string {
  const { bounces, complaints, unrecognized } = SEND_BRAKES;
  return `Pauses on its own at ${brakePct(bounces.rate)} bounces after ${bounces.after} sends, ${brakePct(complaints.rate)} complaints after ${complaints.after}, or ${brakePct(unrecognized.rate)} “who is this?” replies after ${unrecognized.after}.`;
}

export function sendHealth(state: AccountState): { sent: number; bounces: number; complaints: number; stops: number; bounceRate: number; complaintRate: number; paused: boolean; reason?: string } {
  const all = healthCounts(state);
  const base = state.dataset.business.healthBaseline;
  const since = (k: "sent" | "bounces" | "complaints" | "confused") => Math.max(0, all[k] - (base?.[k] ?? 0));
  const sent = since("sent");
  const bounces = since("bounces");
  const complaints = since("complaints");
  const confused = since("confused");
  const stops = state.replies.filter((r) => r.intent === "stop").length;
  const bounceRate = sent ? bounces / sent : 0;
  const complaintRate = sent ? complaints / sent : 0;
  let reason: string | undefined;
  const brake = SEND_BRAKES;
  if (sent >= brake.bounces.after && bounceRate > brake.bounces.rate) reason = `Bounce rate ${(bounceRate * 100).toFixed(1)}% is over ${brakePct(brake.bounces.rate)} — paused to protect the sending reputation. The list needs cleaning.`;
  else if (sent >= brake.complaints.after && complaintRate > brake.complaints.rate) reason = `Spam complaints hit ${(complaintRate * 100).toFixed(2)}% — paused at ${brakePct(brake.complaints.rate)}, well before Gmail's 0.3% limit.`;
  else if (sent >= brake.unrecognized.after && (complaints + confused) / sent > brake.unrecognized.rate) reason = `${complaints + confused} people didn't recognize the business or complained — paused. Check the sender name and that these people really asked for a price.`;
  return { sent, bounces, complaints, stops, bounceRate, complaintRate, paused: !!reason, reason };
}

/* ------------------------------------------------------------------ */
/* Inbox + Dispatcher                                                  */
/* ------------------------------------------------------------------ */

export interface InboundEmail {
  from: string;
  subject?: string;
  text: string;
  receivedAt: ISODateTime;
  /** Provider thread/message id of the note being replied to, when known. */
  inReplyTo?: string;
  /** The record the sending platform filed this lead under (its lead variables), when there's no thread. */
  customerId?: string;
  /** The exact note, when the platform names it (our qa_touch_N lead variable). Wins over `inReplyTo`. */
  touchId?: string;
}

/** A second opinion on a reply (e.g. from the AI Inbox agent) that replaces the rule-based reading. */
export interface ReadingOverride {
  intent: Reply["intent"];
  confidence: number;
  summary?: string;
  extracted?: Partial<Reply["extracted"]>;
  source: string;
}

export function receiveReply(state: AccountState, msg: InboundEmail, override?: ReadingOverride): Reply {
  const now = msg.receivedAt;
  const email = extractEmails(msg.from)[0] ?? msg.from.toLowerCase();
  const id = makeId("r", email, now, msg.text.slice(0, 40));
  // A retried delivery of the same email is read once: no second hand-off, answer or stop.
  const seen = state.replies.find((x) => x.id === id);
  if (seen) return seen;
  const base = readReply({ text: msg.text, subject: msg.subject, from: msg.from, asOf: now.slice(0, 10) });
  const reading = override
    ? { ...base, intent: override.intent, confidence: override.confidence, summary: override.summary ?? base.summary, extracted: { ...base.extracted, ...override.extracted } }
    : base;
  // The note they answered. A platform id can be on several notes (a lead re-added to a campaign gets the same one
  // again): the note named outright wins, then the one to the record the platform names, then the newest sent.
  const named = msg.touchId ? state.touches.find((t) => t.id === msg.touchId) : undefined;
  const byProvider = !named && msg.inReplyTo ? state.touches.filter((t) => t.providerId === msg.inReplyTo) : [];
  const answered =
    named ??
    (byProvider.length > 1
      ? [...byProvider].sort((a, b) => Number(b.customerId === msg.customerId) - Number(a.customerId === msg.customerId) || ((a.sentAt ?? "") < (b.sentAt ?? "") ? 1 : -1))[0]
      : byProvider[0]);
  const newestSent = (ids: Set<string>) => state.touches.filter((t) => ids.has(t.customerId) && t.status === "sent").sort((a, b) => ((a.sentAt ?? "") < (b.sentAt ?? "") ? 1 : -1))[0];
  // Every record at this address (Jobber makes a new client for a new request, so one person can be two).
  const sharing = state.dataset.customers.filter((x) => x.emails.some((e) => e.toLowerCase() === email));
  // Which one wrote: the thread says, or the record the sending platform filed the lead under; with neither, the
  // one we wrote to last, never simply the first on file.
  const threadCustomer = answered ? customerById(state.dataset, answered.customerId) : msg.customerId ? customerById(state.dataset, msg.customerId) : undefined;
  const lastWritten = sharing.length > 1 ? newestSent(new Set(sharing.map((x) => x.id))) : undefined;
  const sender = threadCustomer?.emails.some((e) => e.toLowerCase() === email) ? threadCustomer : ((lastWritten && customerById(state.dataset, lastWritten.customerId)) ?? customerByEmail(state.dataset, email));
  // A bounce comes from the mail system, not the person: find them by the note it answers, or the address it names.
  const bounced =
    reading.intent === "bounce" && !sender
      ? (answered && customerById(state.dataset, answered.customerId)) || extractEmails(msg.text).map((e) => customerByEmail(state.dataset, e)).find(Boolean)
      : undefined;
  // A spouse or a forward answering our note is still about the person we wrote to, even when the spouse has a
  // record of their own: the reply is credited to the note it answers.
  const c = reading.intent === "bounce" ? (sender ?? bounced) : (threadCustomer ?? sender);
  const touch = msg.inReplyTo || named ? answered : c ? newestSent(new Set([c.id])) : undefined;
  // everyone this reply speaks for: the person we wrote to, the one who wrote, and every record at their address
  const household = [...new Map([c, sender, ...sharing].filter((x): x is Customer => !!x).map((x) => [x.id, x])).values()];
  const r: Reply = {
    id,
    customerId: c?.id,
    opportunityId: touch?.opportunityId,
    touchId: touch?.id,
    channel: "email",
    receivedAt: now,
    from: email,
    text: reading.cleaned || msg.text,
    intent: reading.intent,
    confidence: reading.confidence,
    extracted: reading.extracted,
    status: "new",
  };
  state.replies.push(r);
  const name = c?.name ?? email;

  // Guard first: stops and complaints are honored immediately, everywhere.
  if (r.intent === "stop" || r.intent === "complaint") {
    const why = r.intent === "complaint" ? "complained" : "unsubscribed";
    state.suppressions[email] = why;
    // from another address in our thread (an alias, a spouse, known or not): the address we wrote to is done too
    if (c && c !== sender) for (const e of c.emails) state.suppressions[e] = why;
    for (const x of household) stopSequence(state, x.id);
    r.status = "done";
    event(state, now, "guard", r.intent === "complaint" ? "warning" : "action", `${name} asked to stop — removed everywhere`, reading.summary, c ? [{ kind: "customer", id: c.id }] : undefined);
    if (r.intent === "complaint") ownerMsg(state, now, "info", `Heads up: ${name} was unhappy about the note. We removed them from everything. What they said: “${r.text.slice(0, 160)}”`);
    return r;
  }
  if (r.intent === "bounce") {
    // the dead address is the one we wrote to, not the mailer-daemon's
    const dead = bounced ? (bounced.emails.find((e) => msg.text.toLowerCase().includes(e)) ?? bounced.emails.find((e) => !state.suppressions[e]) ?? email) : email;
    state.suppressions[dead] = "bounced";
    if (c) stopSequence(state, c.id);
    r.status = "done";
    event(state, now, "guard", "info", `Bad address for ${name} — removed`, dead);
    return r;
  }
  if (r.intent === "auto_reply") {
    r.status = "done";
    event(state, now, "inbox", "info", `${name}: out-of-office reply`, "Sequence continues as planned.");
    return r;
  }
  // they wrote back: nothing more goes to anyone this reply speaks for
  for (const x of household) stopSequence(state, x.id);

  const lately = (at?: string) => !!at && daysBetween(at.slice(0, 10), now.slice(0, 10)) <= 14;
  const isRequestAnswer = (t: Touch) => t.track === "new_request" || t.opportunityId.startsWith("req:");
  const sentOut = (t: Touch) => t.status === "sent" || t.status === "delivered";
  // An answer to our answer to their NEW request is about the request. Only when the thread says so, or nothing but
  // request answers went to them lately: a platform reply with no thread falls back to their newest note, and a "yes"
  // to the fence quote must not ride on a request answer.
  const followedUpLately = !!c && state.touches.some((t) => t.customerId === c.id && !isRequestAnswer(t) && sentOut(t) && lately(t.sentAt ?? t.dueAt));
  const request = touch && c && touch.customerId === c.id && isRequestAnswer(touch) && lately(touch.sentAt ?? touch.dueAt) && (touch === answered || !followedUpLately) ? touch : undefined;
  if (c && touch && !msg.inReplyTo && !named && isRequestAnswer(touch) && touch.customerId === c.id && followedUpLately && !request) {
    // No thread, and a follow-up went to them lately too: the words answer that note, so the hand-off, the guarantee
    // and the ledger read them against it. A reply in the request answer's own thread stays with the request.
    const note = state.touches.filter((t) => t.customerId === c.id && !isRequestAnswer(t) && sentOut(t) && lately(t.sentAt ?? t.dueAt)).sort((a, b) => ((a.sentAt ?? "") < (b.sentAt ?? "") ? 1 : -1))[0];
    if (note) {
      r.touchId = note.id;
      r.opportunityId = note.opportunityId;
    }
  }

  if (r.intent === "wants_it" || r.intent === "wants_price" || r.intent === "question") {
    // "Great, thanks" to our instant answer reads as another yes: it joins the lead the owner already has,
    // instead of a second answer and a second hand-off (which would invite a third).
    const lead = c
      ? state.replies.find((x) => x.id !== r.id && x.customerId === c.id && !x.followUpOf && ((x.status === "handed_off" && !x.ownerContactedAt && lately(x.handedOffAt ?? x.receivedAt)) || lately(x.ack?.sentAt)))
      : undefined;
    if (lead) {
      r.followUpOf = lead.id;
      r.status = "done";
      if (r.extracted.phone && !lead.extracted.phone) lead.extracted.phone = r.extracted.phone;
      if (r.extracted.bestTime && !lead.extracted.bestTime) lead.extracted.bestTime = r.extracted.bestTime;
      // someone else in the household writing separately still gets one answer; an answer to our answer gets none
      const answered = state.replies.some((x) => x.id !== r.id && x.from === r.from && x.ack && (!x.ack.sentAt || lately(x.ack.sentAt)));
      const ack = answered ? undefined : ackFor(state, r);
      if (ack) r.ack = ack;
      ownerMsg(state, now, "info", `${name} wrote again: “${r.text.replace(/\s+/g, " ").slice(0, 200)}” #${leadCode(lead.id)}`, [{ kind: "customer", id: c!.id }, { kind: "reply", id: lead.id }]);
      event(state, now, "dispatcher", "info", `${name} wrote again — added to their lead`, reading.summary, [{ kind: "customer", id: c!.id }]);
      state.updatedAt = now;
      return r;
    }
    // An answer to our answer to their NEW request ("Sounds good, thanks"): the owner already has that lead (the NEW
    // REQUEST text) and they've been told he'll call. Their words join it; no second answer, no second hand-off.
    if (request) {
      r.followUpOf = request.opportunityId;
      r.status = "done";
      const phone = r.extracted.phone && !c!.phones.some((p) => p.replace(/\D/g, "").slice(-10) === r.extracted.phone!.replace(/\D/g, "").slice(-10)) ? ` New number: ${fmtPhone(r.extracted.phone) || r.extracted.phone}.` : "";
      ownerMsg(state, now, "info", `${name} wrote back about their request: “${r.text.replace(/\s+/g, " ").slice(0, 200)}”${phone} Still yours to call — no need to text us.`, [{ kind: "customer", id: c!.id }, { kind: "request", id: request.opportunityId.slice(4) }]);
      event(state, now, "dispatcher", "info", `${name} wrote back about their request — added to it`, reading.summary, [{ kind: "customer", id: c!.id }]);
      state.updatedAt = now;
      return r;
    }
    const ack = ackFor(state, r);
    if (ack) r.ack = ack;
    const text = handoffText(state, r);
    ownerMsg(state, now, "handoff", text, c ? [{ kind: "customer", id: c.id }] : undefined);
    r.status = "handed_off";
    r.handedOffAt = now;
    event(state, now, "dispatcher", "win", `${name} ${r.intent === "wants_it" ? "wants it done" : r.intent === "wants_price" ? "wants a price" : "has a question"} — texted to you`, reading.summary, c ? [{ kind: "customer", id: c.id }] : undefined);
  } else if (r.intent === "later") {
    r.status = "done";
    event(state, now, "inbox", "action", `${name} said later`, r.extracted.followUpOn ? `We'll check back ${r.extracted.followUpOn}.` : "We'll check back next season.");
  } else if (r.intent === "unclear") {
    event(state, now, "inbox", "review", `Couldn't tell what ${name} meant`, "Flagged for a person to read.", c ? [{ kind: "customer", id: c.id }] : undefined);
  } else {
    r.status = "done";
    event(state, now, "inbox", "info", `${name}: ${reading.summary}`, undefined, c ? [{ kind: "customer", id: c.id }] : undefined);
  }
  state.updatedAt = now;
  return r;
}

/** Owner logged that they reached the person (and optionally booked it). */
export function markContacted(state: AccountState, replyId: string, at: ISODateTime, outcome?: Reply["outcome"], value?: number): void {
  const r = state.replies.find((x) => x.id === replyId);
  if (!r) return;
  r.ownerContactedAt = r.ownerContactedAt ?? at;
  // "NO #K7Q" after "BOOKED 2400 #K7Q": the booking they told us about is taken back, and its dollars leave the ledger.
  // One a job in their records took the place of goes back to his word first: the job, if its visits count, is a
  // booking of its own again.
  if (outcome && outcome !== "booked" && r.outcome === "booked") {
    r.outcomeValue = undefined;
    for (const rec of state.recoveries) {
      if (rec.disputed) continue;
      if (rec.from?.match === "owner_reported" && rec.from.record.id === r.id) {
        Object.assign(rec, rec.from);
        delete rec.from;
      }
      if (rec.match === "owner_reported" && rec.record.id === r.id) rec.disputed = { at, reason: `The owner changed it to ${outcome.replace("_", " ")}`, by: "owner" };
    }
  }
  // the day it booked, not the day they first talked: "QUOTED" in October, "BOOKED" in November books in November
  if (outcome === "booked" && r.outcome !== "booked") r.bookedAt = at;
  if (outcome) r.outcome = outcome;
  if (value) r.outcomeValue = value;
  // and booked again after all: the same record comes back, at the new figure
  if (outcome === "booked")
    for (const rec of state.recoveries.filter((x) => x.match === "owner_reported" && x.record.id === r.id && x.disputed?.by === "owner")) {
      // unless the job itself reached the ledger meanwhile (their export shows it): that one counts, and only once; one
      // with no amount on it takes his figure
      const on = at.slice(0, 10);
      const [from, to] = bookingSpan(r, on);
      const same = (x: Recovery) => x !== rec && x.customerId === rec.customerId && !x.disputed && x.tier !== "after_note" && x.tier !== "holdout" && x.cameBackOn >= from && x.cameBackOn <= to;
      if (state.recoveries.some((x) => same(x) && !noAmount(x))) continue;
      rec.disputed = undefined;
      rec.cameBackOn = on;
      if (value) rec.value = round2(value);
      const bare = state.recoveries.find((x) => same(x) && noAmount(x));
      if (bare) fold(state, rec, bare);
    }
  r.status = "done";
  const name = state.dataset.customers.find((c) => c.id === r.customerId)?.name ?? r.from;
  const hrs = Math.round((Date.parse(r.ownerContactedAt) - Date.parse(r.receivedAt)) / 3600000);
  if (outcome === "booked") {
    event(state, at, "ledger", "win", `Booked: ${name}${value ? ` — ${fmtMoney(value)}` : ""}`, `Called back in ${hrs}h.`, r.customerId ? [{ kind: "customer", id: r.customerId }] : undefined);
    for (const rec of ownerReported([r], state.recoveries)) {
      // the same booking already on the ledger with no amount on it (a client list's date, visits with no price)
      const [from, to] = bookingSpan(r);
      const bare = state.recoveries.find((x) => x.customerId === rec.customerId && !x.disputed && noAmount(x) && x.tier !== "after_note" && x.tier !== "holdout" && x.cameBackOn >= from && x.cameBackOn <= to);
      state.recoveries.push(rec);
      if (bare) fold(state, rec, bare);
    }
  } else {
    event(state, at, "dispatcher", "info", `You reached ${name}`, `${hrs}h after they wrote back.`);
  }
}

/** What a booking was before a job in their records took its place (the owner's BOOKED, a quote they approved): the first such, kept. */
function was(x: Recovery): Recovery["from"] {
  return x.from ?? { record: x.record, value: x.value, match: x.match, confidence: x.confidence };
}

/**
 * The owner's BOOKED (`told`) and the same booking their records show with no amount on it (`bare`: a client list's
 * date, visits with no price) are one: his takes its record, at his figure, from the earlier of their days, and the
 * other goes.
 */
function fold(state: AccountState, told: Recovery, bare: Recovery): void {
  Object.assign(told, { from: was(told), record: bare.record, match: bare.match, confidence: bare.confidence }, bare.cameBackOn < told.cameBackOn ? { cameBackOn: bare.cameBackOn, lagDays: bare.lagDays } : {});
  state.recoveries.splice(state.recoveries.indexOf(bare), 1);
}

/** Past this, a lead nobody called is the operator's to chase (it sits in "Needs a person"), not another text. */
export const NUDGE_MAX_AGE_HOURS = 7 * 24;

/** Nudge the owner about hot leads nobody has called: at most two reminders per lead, never for a week-old one. */
export function chase(state: AccountState, now: ISODateTime, afterHours = 4): OwnerMessage[] {
  const out: OwnerMessage[] = [];
  for (const r of state.replies) {
    if (r.status !== "handed_off" || r.ownerContactedAt) continue;
    const hrs = (Date.parse(now) - Date.parse(r.handedOffAt ?? r.receivedAt)) / 3600000;
    // The count lives on the reply; the messages are a fallback for replies nudged before it did.
    const already = Math.max(r.nudges ?? 0, state.ownerMessages.filter((m) => m.kind === "sla_nudge" && m.refs?.some((x) => x.id === r.id)).length);
    const next = already === 0 ? afterHours : already === 1 ? 24 : Infinity;
    if (hrs >= next && hrs < NUDGE_MAX_AGE_HOURS) {
      r.nudges = already + 1;
      r.lastNudgeAt = now;
      out.push(ownerMsg(state, now, "sla_nudge", slaNudge(state, r, hrs), [{ kind: "reply", id: r.id }]));
      event(state, now, "dispatcher", "warning", `Reminded you about ${state.dataset.customers.find((c) => c.id === r.customerId)?.name ?? r.from}`, `${Math.round(hrs)}h without a call.`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ledger + Reporter                                                   */
/* ------------------------------------------------------------------ */

/** Fold in a fresh export and find who came back. */
export function reconcile(state: AccountState, files: FileIn[], now: ISODateTime): { newRecoveries: number; lift: LiftReport } {
  readFiles(state, files, now);
  return ledgerPass(state, now);
}

/** Match new jobs/invoices/approvals in the current data to the people we contacted. Then re-scan. */
export function ledgerPass(state: AccountState, now: ISODateTime, features: Features = {}): { newRecoveries: number; lift: LiftReport } {
  state.dataset.asOf = now.slice(0, 10);
  // a reply to our answer on their own new request isn't a reply to a follow-up (same rule as the guarantee)
  const newRequestTouch = new Set(state.touches.filter((t) => t.track === "new_request").map((t) => t.id));
  const replied = new Set(
    state.replies
      .filter((r) => r.customerId && !["auto_reply", "bounce"].includes(r.intent) && !r.opportunityId?.startsWith("req:") && !(r.touchId && newRequestTouch.has(r.touchId)))
      .map((r) => r.customerId!),
  );
  const found = attribute(state.dataset, state.outreach, { replied });
  // someone who came back quietly and then wrote to us is now traced; if the owner already told us about that same
  // job (BOOKED), their figure gives way to the one in their records, so it counts once (a record with no amount on it
  // takes his figure instead)
  for (const r of state.recoveries.filter((x) => x.tier === "after_note" && replied.has(x.customerId))) {
    r.tier = "traced";
    const told = state.recoveries.find((x) => x !== r && x.customerId === r.customerId && x.match === "owner_reported" && !x.disputed && Math.abs(daysBetween(x.cameBackOn, r.cameBackOn)) <= 30);
    if (told && noAmount(r)) fold(state, told, r);
    else if (told) told.disputed = { at: now, reason: `Same job as ${r.record.kind} ${r.record.id} in their records`, by: "ledger" };
  }
  // One credit per record (job, quote, invoice), not per person. A job goes by the name its booking has now, whatever
  // record the ledger first knew it by: its own record before its visits came in, or one of its visits.
  const nameOf = bookingNames(state.dataset);
  const names = new Map(state.dataset.jobs.map((j) => [j.id, nameOf(j)]));
  const key = (x: Recovery["record"]) => `${x.kind}:${x.kind === "job" ? (names.get(x.id) ?? x.id) : x.id}`;
  const byVisits = new Set(state.dataset.jobs.filter((j) => j.visit).map(nameOf));
  const live = new Set(found.map((r) => key(r.record)));
  // A job seen through its visits that has none left that count (rained out, never done, or gone from the calendar
  // with its job) didn't come back. One the owner told us about, or a quote they approved, goes back to that, on its
  // own day: the owner said it booked (and if he has taken that back since, it stays out). One the owner marked not
  // ours stays, so it stays out if its visits count again.
  for (const x of state.recoveries.filter((x) => x.record.kind === "job" && !x.disputed && !live.has(key(x.record)))) {
    const name = names.get(x.record.id) ?? x.record.id;
    if (!byVisits.has(name) && bookedThrough(name) !== "visits") continue;
    if (x.from) {
      Object.assign(x, x.from);
      delete x.from;
      const reply = x.match === "owner_reported" ? state.replies.find((y) => y.id === x.record.id) : undefined;
      if (reply && reply.outcome !== "booked") x.disputed = { at: now, reason: `The owner changed it to ${(reply.outcome ?? "not booked").replace("_", " ")}`, by: "owner" };
      continue;
    }
    state.recoveries.splice(state.recoveries.indexOf(x), 1);
    const who = state.dataset.customers.find((c) => c.id === x.customerId)?.name ?? "A customer";
    event(state, now, "ledger", "info", `Taken off the ledger: ${who} — ${fmtMoney(x.value)}`, "None of that job's visits were done.", [{ kind: "customer", id: x.customerId }]);
  }
  const known = new Map(state.recoveries.map((r) => [key(r.record), r]));
  let added = 0;
  const jobQuote = new Map(state.dataset.jobs.filter((j) => j.quoteId).map((j) => [nameOf(j), j.quoteId!]));
  // A record of theirs that took a booking's place keeps the figure the booking had when it carries none of its own (a
  // client list's date, visits with no price), and the day it had when that was the owner's or a quote's
  const retake = (x: Recovery, r: Recovery) =>
    Object.assign(x, { record: r.record, value: r.value || (x.from?.value ?? 0), match: r.match, confidence: r.confidence }, x.from ? {} : { cameBackOn: r.cameBackOn, lagDays: r.lagDays });
  for (const r of found) {
    // the same booking; or the one this booking started as, that a record of theirs took over and that's gone again
    // (a list's date taken over by a job since cancelled): it's this one once more, never a second with its id
    const had = known.get(key(r.record)) ?? state.recoveries.find((x) => x.id === r.id);
    if (had) {
      if (key(had.record) !== key(r.record)) {
        if (!had.disputed && !live.has(key(had.record))) {
          retake(had, r);
          known.set(key(r.record), had);
        }
        continue;
      }
      // a job seen through its visits is worth the visits done so far, and dated by them, as this export has them;
      // one the owner told us about, or a quote they approved, keeps its day
      if (byVisits.has(r.record.id)) retake(had, r);
      continue;
    }
    // The quote they approved last sync became this job: one win, now at the job's figure (the quote's, when the job
    // has none). And a quote whose job is already on the ledger is that job.
    const fromQuote = r.record.kind === "job" && jobQuote.get(r.record.id);
    const asQuote = fromQuote ? state.recoveries.find((x) => x.record.kind === "quote" && x.record.id === fromQuote) : undefined;
    if (asQuote) {
      // still the day they came back (the approval), so no weekly report announces it twice; a quote marked "not
      // ours" stays out as its job
      if (!asQuote.disputed) Object.assign(asQuote, { from: was(asQuote), record: r.record, value: r.value || asQuote.value, match: r.match, confidence: r.confidence });
      known.set(key(r.record), asQuote);
      continue;
    }
    if (r.record.kind === "quote" && state.dataset.jobs.some((j) => j.quoteId === r.record.id && known.has(`job:${nameOf(j)}`))) continue;
    // The export now shows the job the owner told us about: the invoiced figure replaces the owner's (his stays when
    // the record has none). Matched over the whole lead, from their reply on: the job can be dated before the text,
    // and a job can be dated well after it, whatever shows it (its visits, its own record, a client list's date): a
    // yes in October for a spring start shows in April, and so does a job made in March when the season is laid out.
    const reported = (x: Recovery) => {
      const reply = state.replies.find((y) => y.id === x.record.id);
      const [from, to] = reply ? bookingSpan(reply) : [addDays(x.cameBackOn, -30), addDays(x.cameBackOn, 30)];
      return r.cameBackOn >= from && (r.cameBackOn <= to || r.record.kind === "job");
    };
    const told = r.tier === "traced" ? state.recoveries.find((x) => x.customerId === r.customerId && x.match === "owner_reported" && !x.disputed && reported(x)) : undefined;
    if (told) {
      Object.assign(told, { from: was(told), record: r.record, value: r.value || told.value, match: r.match, confidence: r.confidence });
      known.set(key(r.record), told);
      continue;
    }
    // A client list's last date stood in for them until their records showed the comeback: it's that same booking
    const listed = state.recoveries.find((x) => x.customerId === r.customerId && x.tier === r.tier && !x.disputed && x.record.kind === "job" && bookedThrough(names.get(x.record.id) ?? x.record.id) === "list" && !live.has(key(x.record)));
    if (listed) {
      retake(listed, r);
      known.set(key(r.record), listed);
      continue;
    }
    state.recoveries.push(r);
    added++;
    const name = state.dataset.customers.find((c) => c.id === r.customerId)?.name ?? "A customer";
    if (r.tier === "holdout") {
      event(state, now, "ledger", "info", "Someone in the comparison group came back on their own", "Used only to measure true lift — not counted as ours.", [{ kind: "customer", id: r.customerId }]);
      continue;
    }
    event(
      state,
      now,
      "ledger",
      r.tier === "after_note" ? "info" : "win",
      r.tier === "after_note" ? `${name} came back after a note — ${fmtMoney(r.value)} (not counted: no reply)` : `${name} came back — ${fmtMoney(r.value)}`,
      `${r.lagDays ?? 0} days after the last note.`,
      [{ kind: "customer", id: r.customerId }],
    );
  }
  // and a list's date that stood in for one whose place a record took another way (the owner's BOOKED did first) is
  // that booking too, never a second one beside it
  for (const x of state.recoveries.filter((x) => !x.disputed && x.record.kind === "job" && bookedThrough(names.get(x.record.id) ?? x.record.id) === "list" && !live.has(key(x.record)))) {
    if (state.recoveries.some((y) => y !== x && y.customerId === x.customerId && y.tier === x.tier && !y.disputed && live.has(key(y.record)))) state.recoveries.splice(state.recoveries.indexOf(x), 1);
  }
  const l = lift(state.outreach, state.recoveries);
  event(state, now, "ledger", "info", `Recovered so far: ${fmtMoney(l.treated.value)}`, l.note);
  find(state, now, features);
  return { newRecoveries: added, lift: l };
}

export function reportWeek(state: AccountState, now: ISODateTime): OwnerMessage {
  const text = weeklyReport(state, mondayOf(now.slice(0, 10)));
  event(state, now, "reporter", "action", "Sent your weekly report", text.split("\n")[0]);
  return ownerMsg(state, now, "weekly", text);
}

/**
 * The close after the free round, once replies have had a week to come in. A seasonal shop's round that its selling
 * window cut short (a pause held its notes past it) isn't over: whoever of the free people hadn't heard from us is
 * written to in the next window, and the close waits for them. It ends once nobody's left to write to.
 */
export function closeIfDue(state: AccountState, now: ISODateTime, opts: { payLink?: string; signature?: string } & Features = {}): OwnerMessage | undefined {
  const b = state.dataset.business;
  const seasonal = SEASONAL_TRADES.has(b.trade);
  // a one pass has no free round to close: it ends with its own text (passEndIfDue)
  if (isOnePass(b.plan) || b.plan.stage !== "trial" || state.ownerMessages.some((m) => m.kind === "close")) return undefined;
  const sent = state.touches.filter((t) => t.status === "sent");
  const pending = state.touches.filter((t) => t.status === "approved" || t.status === "planned");
  // Notes the Guard's brake is holding don't hold the round open forever: a week after the last send, it ends there.
  const brake = pending.length ? sendHealth(state) : undefined;
  if (!sent.length || (pending.length && !brake?.paused)) return undefined;
  const last = sent.map((t) => t.sentAt ?? t.dueAt).sort().pop()!;
  if (daysBetween(last.slice(0, 10), now.slice(0, 10)) < 7) return undefined;
  if (pending.length) {
    for (const t of pending) t.status = "cancelled";
    event(state, now, "guard", "warning", `Free round ended early — the send brake held ${plural(pending.length, "note")}`, brake?.reason);
  } else if (seasonal) {
    const started = new Set(state.touches.filter((t) => t.step === 1 && t.status !== "cancelled").map((t) => t.customerId)).size;
    const rest = started < b.plan.trialSize ? planBatch(state, now, { startOn: addDays(now.slice(0, 10), 1), limitPeople: b.plan.trialSize - started, approve: true, kickoff: false, features: opts }) : undefined;
    if (rest?.firstDay) {
      event(state, now, "sender", "action", "The rest of the free round is planned", `${plural(rest.people.length, "person", "people")} of the free ${b.plan.trialSize} hadn't heard from us yet: their notes go out from ${rest.firstDay}, in their selling window.`);
      return undefined;
    }
  }
  state.trialCompletedOn = last.slice(0, 10);
  const friday = addDays(now.slice(0, 10), (5 - weekday(now.slice(0, 10)) + 7) % 7 || 7);
  // a seasonal shop's next batch goes out when its next selling window opens: not "next week" in December
  const monday = addDays(friday, 3);
  const opens = seasonal ? nextAllowed(state.dataset, sellingFrom(growingSeason(b), monday)) : monday;
  const text = closeMessage(state, { ...opts, sayYesBy: `Friday ${Number(friday.slice(8))}`, ...(opens > addDays(monday, 6) ? { nextBatchOn: opens } : {}) });
  event(state, now, "reporter", "action", "Your free round is done — results sent", text.split("\n")[0]);
  return ownerMsg(state, now, "close", text);
}

/** Days a one pass waits after its last note for the replies to come in: a week, or three once its end date has passed. */
const PASS_REPLY_DAYS = { early: 7, late: 3 } as const;

/**
 * A one pass ends when its list is done: nothing left to send (every note sent, or stopped by a reply, a stop or a
 * bounce), and the replies to its last notes given time to come in, so the end text's tally counts them.
 */
export function passEndIfDue(state: AccountState, now: ISODateTime): OwnerMessage | undefined {
  const plan = state.dataset.business.plan;
  if (!isOnePass(plan) || plan.stage !== "running") return undefined;
  const sent = passTouches(state).filter((t) => t.status === "sent" || t.status === "delivered" || t.status === "bounced");
  if (!sent.length || state.touches.some((t) => t.status === "planned" || t.status === "approved" || t.status === "sending")) return undefined;
  const today = now.slice(0, 10);
  const last = sent.map((t) => (t.sentAt ?? t.dueAt).slice(0, 10)).sort().pop()!;
  if (daysBetween(last, today) < (plan.targetEndOn && today > plan.targetEndOn ? PASS_REPLY_DAYS.late : PASS_REPLY_DAYS.early)) return undefined;
  return endPass(state, now);
}

/**
 * The one pass is done (its list ran out, or a person marked it done): nothing more goes out, and the end text (the
 * tally, then the refill check) waits for the operator. The text is written once.
 */
export function endPass(state: AccountState, now: ISODateTime): OwnerMessage | undefined {
  const plan = state.dataset.business.plan;
  if (!isOnePass(plan) || plan.stage === "cancelled") return undefined;
  plan.stage = "done";
  plan.doneOn ??= now.slice(0, 10);
  let stopped = 0;
  for (const t of state.touches)
    if (t.status === "planned" || t.status === "approved") {
      t.status = "cancelled";
      t.lastError = "Not sent: the pass is done";
      stopped++;
    }
  state.awaitingOwnerOk = undefined;
  if (state.ownerMessages.some((m) => m.kind === "pass_end")) return undefined;
  const today = now.slice(0, 10);
  const text = passEndText(state, today);
  event(state, now, "reporter", "action", "The pass is done — the last text waits for your OK", `${text.split("\n")[0]}${stopped ? ` ${plural(stopped, "queued note")} stopped.` : ""}`);
  // offering to keep it going monthly is a question the owner's yes or no answers (the owner texts)
  return ownerMsg(state, now, "pass_end", text, state.scan && refillRate(state.scan, today).monthly ? [{ kind: "monthly_offer", id: today }] : undefined);
}

export function billingCheck(state: AccountState, now: ISODateTime): OwnerMessage | undefined {
  // Only a paying monthly account is charged; a cancelled or paused one gets no billing texts at all, and a one pass is
  // billed per booking.
  if (isOnePass(state.dataset.business.plan) || state.dataset.business.plan.stage !== "paying") return undefined;
  const g = guaranteeCheck(state, now.slice(0, 10));
  if (!g) return undefined;
  const until = daysBetween(now.slice(0, 10), g.chargeOn);
  if (until > 2 || until < -3) return undefined;
  if (state.ownerMessages.some((m) => (m.kind === "precharge" || m.kind === "free_month") && m.refs?.some((r) => r.id === g.chargeOn))) return undefined;
  if (g.free) {
    const b = state.dataset.business;
    const fm = b.plan.freeMonths;
    if (!fm.includes(g.chargeOn)) {
      fm.push(g.chargeOn);
      // A month of a paid year from before this arrangement began (MONTHLY, or RENEW after it, starts it at that year's
      // end): that year's charges were frozen into priorFees at the switch.
      if (b.plan.paidOn && g.chargeOn <= b.plan.paidOn && paidYearOn(b, g.periodStart)) b.plan.priorFees = round2((b.plan.priorFees ?? 0) - annualRefund(b));
    }
    event(state, now, "guard", "action", "Guarantee: this month is free", `Nobody ${wantedWords(b.plan).past} this period, so you won't be charged.`);
  }
  return ownerMsg(state, now, g.free ? "free_month" : "precharge", g.text, [{ kind: "charge", id: g.chargeOn }]);
}

/**
 * Yearly plans: the renewal choice goes out thirty days before the year ends. If the year ends with no
 * answer, sending pauses and the owner is told how to pick back up. Nothing renews by itself.
 */
export function renewalIfDue(state: AccountState, now: ISODateTime): OwnerMessage | undefined {
  const b = state.dataset.business;
  const today = now.slice(0, 10);
  // Settle any year that just ended first (its text goes out on its own); the renewal or pause follows.
  const settled = settleYears(state, now);
  const r = renewalNotice(state, today);
  if (r && !state.ownerMessages.some((m) => m.kind === "renewal" && m.refs?.some((x) => x.id === r.yearEnds))) {
    event(state, now, "reporter", "action", "Asked about renewing the year", `The year ends ${r.yearEnds}; nothing renews without a yes.`);
    return ownerMsg(state, now, "renewal", r.text, [{ kind: "year_end", id: r.yearEnds }]);
  }
  if (b.plan.billing !== "annual" || b.plan.stage !== "paying" || !b.plan.paidOn) return settled;
  const started = [...(b.plan.yearsPaidOn?.length ? b.plan.yearsPaidOn : [b.plan.paidOn])].sort().pop()!;
  const yearEnds = addMonths(started, 12);
  if (today < yearEnds) return settled;
  b.plan.stage = "paused";
  event(state, now, "guard", "warning", "The year ended without a renewal — sending paused", "Nothing renews without the owner's yes.");
  return ownerMsg(state, now, "info", `${b.ownerFirstName}, your year's up and nothing renewed, so everything is paused. Text MONTHLY to pick back up at ${fmtMoney(b.plan.monthlyPrice)} a month, or RENEW for another year.`, [{ kind: "year_end", id: yearEnds }]);
}

/** At the end of each paid year: did the traced jobs cover what was paid? If not, the difference goes back. */
function settleYears(state: AccountState, now: ISODateTime): OwnerMessage | undefined {
  const b = state.dataset.business;
  const plan = b.plan;
  const today = now.slice(0, 10);
  const years = plan.yearsPaidOn?.length ? plan.yearsPaidOn : plan.billing === "annual" && plan.paidOn ? [plan.paidOn] : [];
  for (const y of [...years].sort()) {
    const f = yearFloor(state, y);
    if (today < f.yearEnds) continue;
    // settled once, on the plan itself (a message about it may no longer be loaded)
    if (plan.settledYears?.includes(y) || state.ownerMessages.some((m) => m.refs?.some((r) => r.kind === "year_floor" && r.id === y))) continue;
    plan.settledYears = [...(plan.settledYears ?? []), y];
    // a year left early was already settled at the cancel
    if ((plan.yearRefunds ?? []).some((r) => r.yearStart === y && r.early)) continue;
    if (f.refund > 0 && !(plan.yearRefunds ?? []).some((r) => r.yearStart === y)) plan.yearRefunds = [...(plan.yearRefunds ?? []), { yearStart: y, amount: f.refund }];
    event(state, now, "guard", "action", f.refund > 0 ? "The year didn't pay for itself — refunding the difference" : "The year paid for itself", `${fmtMoney(f.traced)} traced vs ${fmtMoney(f.paid)} paid.`);
    const text =
      f.refund > 0
        ? `${b.ownerFirstName}, your year's numbers: ${fmtMoney(f.traced)} in jobs traced to our notes, against ${fmtMoney(f.paid)} you paid. It didn't pay for itself, so ${fmtMoney(f.refund, { cents: true })} goes back to your card, like I promised. Nothing for you to do.`
        : `${b.ownerFirstName}, your year's numbers: ${fmtMoney(f.traced)} in jobs traced to our notes, against ${fmtMoney(f.paid)} you paid.`;
    // a refund text waits for the operator to issue the refund
    return ownerMsg(state, now, f.refund > 0 ? "refund" : "info", text, [{ kind: "year_floor", id: y }]);
  }
  return undefined;
}

/** What a RENEW / YEARLY / MONTHLY text did. */
export interface PlanChoice {
  /** The answer for the owner. */
  reply: string;
  /** The plan changed (a repeat, or a year that waits for its payment, changes nothing). */
  changed: boolean;
  /** The operator has something to collect or set up: it's in the activity as a review event, and a person reads the text. */
  forOperator: boolean;
  /** For the log. */
  handled: "renew_year" | "renew_year_pay_first" | "renew_already" | "renew_monthly" | "monthly_already";
}

/**
 * The owner's answer to the renewal (or a switch any time): another year, or month to month from the year's end.
 * Everything turns on the paid year running today (MONTHLY takes effect at its end), never on the last year listed,
 * so a repeated or changed answer never stacks a year, overlaps one, or moves a date that's already set. The
 * operator collects every payment: a year starting at the running one's end is the owner's yes, with a month for
 * the payment link; a year that would start today (a monthly plan going yearly, or after a year ran out) starts
 * only once it's paid, so nothing is recorded on a text alone.
 */
export function renewPlan(state: AccountState, choice: "year" | "monthly", now: ISODateTime): PlanChoice {
  const b = state.dataset.business;
  const today = now.slice(0, 10);
  const plan = b.plan;
  const day = (d: string) => `${monthName(d)} ${Number(d.slice(8))}`;
  const years = [...(plan.yearsPaidOn?.length ? plan.yearsPaidOn : plan.billing === "annual" && plan.paidOn ? [plan.paidOn] : [])].sort();
  const running = paidYearOn(b, today);
  const yearEnds = running ? addMonths(running, 12) : undefined;
  if (choice === "year") {
    // already said: a year on the books from today on (RENEW twice, or YEARLY again after the operator set it up)
    const booked = years.filter((y) => y >= today).pop();
    if (booked) return { reply: `You're already ${booked > today ? "renewed" : "on the year"} from ${day(booked)}. Nothing else to do.`, changed: false, forOperator: false, handled: "renew_already" };
    if (!yearEnds) {
      event(state, now, "reporter", "review", `${b.ownerFirstName} wants the year`, `Send the payment link for ${fmtMoney(annualPrice(b))}. Once it's paid, set Yearly and the first paid day in Settings${plan.stage === "paused" ? " (and the stage back to Paying)" : ""}.`);
      return { reply: `Great — the year it is. Jack will text you the payment link, and your year starts the day it's paid.${plan.stage === "paused" ? " Everything stays paused until then." : ""}`, changed: false, forOperator: true, handled: "renew_year_pay_first" };
    }
    // After MONTHLY it's back to yearly from the same day: what the running year cost stays frozen in priorFees.
    if (plan.billing !== "annual") {
      plan.priorFees = grossFees(b, addDays(yearEnds, -1)).total;
      plan.billing = "annual";
      plan.paidOn = yearEnds;
    }
    // (the stage stays as it is: a year is running, so only Jack's own Paused could be holding it)
    plan.yearsPaidOn = [...years, yearEnds];
    event(state, now, "reporter", "review", `${b.ownerFirstName} chose another year`, `Starts ${yearEnds}. Send the payment link for ${fmtMoney(annualPrice(b))} before then; if it's never paid, take the year off in Settings.`);
    return { reply: `Done — another year from ${day(yearEnds)}, same price. The guarantee still runs every month. Jack will text you the payment link.`, changed: true, forOperator: true, handled: "renew_year" };
  }
  // RENEW, then MONTHLY: the year that hasn't started comes off, and month to month starts when the running one ends
  const notStarted = years.filter((y) => y > today);
  if (plan.billing !== "annual" && !notStarted.length) {
    // already month to month (or set to go at the running year's end): nothing moves, so no charge date shifts
    const paused = plan.stage === "paused";
    if (paused) event(state, now, "reporter", "review", `${b.ownerFirstName} texted MONTHLY while their plan is paused`, "They're already month to month. Set the stage back to Paying in Settings if they're picking back up.");
    return {
      reply: yearEnds ? `You're already set to go month to month from ${day(yearEnds)}. Nothing else to do.` : `You're already month to month at ${fmtMoney(plan.monthlyPrice)} a month.${paused ? " Your plan is paused on our side, so Jack will read this and get back to you." : " Nothing else to do."}`,
      changed: false,
      forOperator: paused,
      handled: "monthly_already",
    };
  }
  const from = yearEnds ?? today;
  if (notStarted.length) plan.yearsPaidOn = years.filter((y) => y <= today);
  // what the years cost is frozen into priorFees (the running year's later quiet months still come off it)
  if (plan.billing === "annual") plan.priorFees = grossFees(b, from).total;
  plan.billing = "monthly";
  plan.paidOn = from;
  // yearsPaidOn stays as history so the last year is still settled at its end
  // a year that ran out picks back up now; with a year running, a Paused stage is Jack's and stays
  if (!yearEnds) plan.stage = "paying";
  event(state, now, "reporter", "review", `${b.ownerFirstName} chose month to month`, `Starts ${from}: ${fmtMoney(plan.monthlyPrice)} a month from then.${notStarted.length ? ` The year from ${notStarted.join(", ")} they'd renewed came off; if it was already paid, refund it.` : ""}`);
  return { reply: `Done — month to month from ${day(from)}, ${fmtMoney(plan.monthlyPrice)} a month, cancel by text any time.`, changed: true, forOperator: true, handled: "renew_monthly" };
}

/**
 * The owner texted CANCEL. One text does it: every queued note stops and nothing more is charged. With the yearly
 * plan sold, a yearly plan gets back what it didn't use (never more than monthly would have cost; the year floor on
 * the months used), and what it stopped is kept for a day so UNDO can put it all back. Without it, cancelling is final.
 */
export function cancelPlan(state: AccountState, now: ISODateTime, opts: { paused?: boolean; yearly?: boolean } = {}): { stopped: number; refund: number; line: string } {
  const plan = state.dataset.business.plan;
  if (plan.stage === "cancelled") return { stopped: 0, refund: 0, line: "" };
  const stageBefore = plan.stage;
  const today = now.slice(0, 10);
  // any paid year that already ended is settled first, the same as at its end
  if (opts.yearly) for (let i = 0; i < 5 && settleYears(state, now); i++);
  const touches: { id: string; status: "planned" | "approved" }[] = [];
  for (const t of state.touches)
    if (t.status === "approved" || t.status === "planned") {
      touches.push({ id: t.id, status: t.status });
      t.status = "cancelled";
    }
  let line = "";
  const b = state.dataset.business;
  const cents = (m: number) => fmtMoney(m, { cents: true });
  const early = opts.yearly && stageBefore !== "trial" ? earlyLeaveRefund(state, today) : undefined;
  // only the running year's unused part is promised: it was paid, and it's what the cancel's refund text is about
  const refund = early && early.refund > 0 ? early.refund : 0;
  if (refund) plan.yearRefunds = [...(plan.yearRefunds ?? []).filter((r) => r.yearStart !== early!.yearStart), { yearStart: early!.yearStart, amount: refund, early: true }];
  // A year renewed but not started yet was never used, and a RENEW text alone doesn't say it was ever paid. It comes off
  // the paid years (so it's never counted as charged, settled or refunded by us); whether it's refunded is Jack's call,
  // so the owner is told what happens if they'd paid, never promised the money.
  const ahead = opts.yearly && stageBefore !== "trial" ? [...(plan.yearsPaidOn ?? [])].filter((y) => y > today).sort() : [];
  const aheadAmount = round2(ahead.length * annualPrice(b));
  if (ahead.length) plan.yearsPaidOn = (plan.yearsPaidOn ?? []).filter((y) => y <= today);
  if (refund) {
    line = `${cents(refund)} of your year comes back to your card within 5 business days.`;
    const math = `here's the math on your year: you paid ${cents(early!.paid)} and used ${plural(early!.monthsUsed, "month")}${early!.quiet ? ` (${early!.quiet} quiet, so free)` : ""}. Month to month that's ${fmtMoney(early!.asMonthly)}, and the jobs on your ledger in that time came to ${fmtMoney(early!.traced)}. You keep the lower of those, so ${cents(refund)}`;
    ownerMsg(state, now, "refund", `${b.ownerFirstName}, ${math} goes back to your card within 5 business days.`, [{ kind: "year_refund", id: early!.yearStart }]);
  }
  if (ahead.length) {
    const days = ahead.map((y) => `${monthName(y)} ${Number(y.slice(8))}${ahead.length > 1 ? `, ${y.slice(0, 4)}` : ""}`).join(" and ");
    line = `${line ? `${line} ` : ""}If you'd already paid for the ${ahead.length === 1 ? "year" : "years"} you renewed from ${days}, Jack will refund all of it.`;
  }
  plan.stage = "cancelled";
  if (opts.yearly)
    state.cancelled = {
      at: now,
      stageBefore,
      touches,
      ...(state.awaitingOwnerOk ? { awaitingOwnerOk: state.awaitingOwnerOk } : {}),
      ...(opts.paused ? { paused: true } : {}),
      // the running year's refund, the only one promised (a renewed year that hadn't started is Jack's call, so it alone
      // never stops UNDO by text)
      ...(refund ? { refund: { yearStart: early!.yearStart, amount: refund } } : {}),
      ...(ahead.length ? { years: ahead } : {}),
    };
  // a cancelled account isn't waiting for anyone's OK
  state.awaitingOwnerOk = undefined;
  event(state, now, "guard", "warning", "Owner cancelled by text", `${plural(touches.length, "queued note")} stopped. No further charges.${refund ? ` Yearly refund due: ${cents(refund)}.` : ""}${ahead.length ? ` The renewed year from ${ahead.join(", ")} hadn't started and came off the paid years. They were told you'd refund it if they'd paid: if it was paid, refund ${cents(aheadAmount)}.` : ""}${opts.yearly ? ` UNDO works until ${addDays(today, 1)} ${now.slice(11, 16)}.` : ""}`);
  state.updatedAt = now;
  return { stopped: touches.length, refund, line };
}

/**
 * UNDO within a day of CANCEL: the same notes back exactly as they were (a planned note stays planned, a note
 * the sending platform had is pushed again), the plan and the wait for the owner's OK as they were. A cancel that
 * set up a yearly refund is never undone by software: money may already be on its way, so a person does it.
 */
/** Of these notes, the ones in a sequence already under way (its first note out): on a sending platform, the rest of it can't be pushed again. */
export function underWay(state: AccountState, touchIds: string[]): Touch[] {
  const ids = new Set(touchIds);
  const started = new Set(state.touches.filter((t) => t.step === 1 && (t.status === "sent" || t.status === "delivered")).map((t) => t.opportunityId));
  return state.touches.filter((t) => ids.has(t.id) && !t.instant && started.has(t.opportunityId));
}

export function undoCancel(state: AccountState, now: ISODateTime, opts: { platform?: boolean; override?: boolean } = {}): { restored: number; stopped: number; paused: boolean } | { refused: "late" | "refund" } | undefined {
  const c = state.cancelled;
  const plan = state.dataset.business.plan;
  if (!c || plan.stage !== "cancelled") return undefined;
  if (!opts.override && Date.parse(`${now.slice(0, 19)}Z`) - Date.parse(`${c.at.slice(0, 19)}Z`) > 24 * 3_600_000) return { refused: "late" };
  if (c.refund && !opts.override) return { refused: "refund" };
  // an operator restoring the plan withdraws the refund that was never issued; either way a renewed year it took off goes back
  if (c.refund) plan.yearRefunds = (plan.yearRefunds ?? []).filter((r) => !(r.early && r.yearStart === c.refund!.yearStart));
  if (c.years?.length) plan.yearsPaidOn = [...new Set([...(plan.yearsPaidOn ?? []), ...c.years])].sort();
  plan.stage = c.stageBefore;
  const before = new Map(c.touches.map((x) => [x.id, x.status]));
  // On a sending platform the cancel took each person's copy back; a sequence can only be pushed again from its
  // first note, so one already under way stays stopped (and the owner is told), never "back in line" and stuck.
  const stays = new Set(opts.platform ? underWay(state, c.touches.map((x) => x.id)) : []);
  const stoppedPeople = new Set([...stays].map((t) => t.customerId));
  let restored = 0;
  for (const t of state.touches) {
    const was = before.get(t.id);
    if (!was || t.status !== "cancelled" || stays.has(t)) continue;
    t.status = was;
    // the cancel took the platform's copy back; the next sync pushes it again
    t.providerId = undefined;
    restored++;
  }
  if (c.awaitingOwnerOk) state.awaitingOwnerOk = c.awaitingOwnerOk;
  state.cancelled = undefined;
  event(state, now, "guard", "action", opts.override ? "The plan was restored after a cancel" : "Owner undid the cancel", `${plural(restored, "note")} back in line.${stoppedPeople.size ? ` ${plural(stoppedPeople.size, "person was", "people were")} part-way through their notes; those follow-ups stay stopped.` : ""}${c.paused ? " Still paused, as before." : ""}${c.years?.length ? ` The renewed year from ${c.years.join(", ")} is back on the paid years: if you'd already refunded it, take it off in Settings.` : ""}`);
  state.updatedAt = now;
  return { restored, stopped: stoppedPeople.size, paused: !!c.paused };
}

/**
 * People in the owner's records a free-text name points to ("Karen Whitfield", "Whitfield Oak Ln"). Every word
 * has to be in their name, company or street, and at least one has to be in the name, so a street alone never
 * picks someone.
 */
export function peopleNamed(state: AccountState, text: string): Customer[] {
  const norm = (x: string | undefined) => (x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w.length > 1);
  const want = norm(text).filter((w) => !["the", "and", "mr", "mrs", "ms", "at", "on", "from", "please", "thanks"].includes(w));
  if (!want.length) return [];
  // "the Johnsons" means the Johnson household
  const forms = (w: string) => [w, ...(w.length > 3 && w.endsWith("es") ? [w.slice(0, -2)] : []), ...(w.length > 3 && w.endsWith("s") ? [w.slice(0, -1)] : [])];
  return state.dataset.customers.filter((c) => {
    const name = new Set([...norm(c.name), ...norm(c.firstName), ...norm(c.lastName), ...norm(c.companyName)]);
    const all = new Set([...name, ...norm(c.address?.street)]);
    return want.every((w) => forms(w).some((f) => all.has(f))) && want.some((w) => forms(w).some((f) => name.has(f)));
  });
}

/**
 * The owner texted "SKIP Karen Whitfield": already won it, said no on the phone, a friend. They're off every
 * list for good — nothing queued goes, nothing new gets planned — and `withdrawn` names the copies a sending
 * platform already holds, for the caller to pull.
 */
export function skipPerson(state: AccountState, customerId: string, now: ISODateTime, by: string): { cancelled: number; withdrawn: string[] } {
  const c = customerById(state.dataset, customerId);
  if (!c) return { cancelled: 0, withdrawn: [] };
  // New records and new lists, never an edit in place: saving skips lists it has already seen, and a flag that
  // never reached the database would put them back on the list after a restart.
  state.dataset.customers = state.dataset.customers.map((x) => (x.id === customerId ? { ...x, doNotContact: true } : x));
  const withdrawn: string[] = [];
  let cancelled = 0;
  for (const t of state.touches) {
    if (t.customerId !== customerId || (t.status !== "approved" && t.status !== "planned")) continue;
    t.status = "cancelled";
    cancelled++;
    if (t.providerId && !withdrawn.includes(t.providerId)) withdrawn.push(t.providerId);
  }
  if (state.scan) {
    const swapped = new Map<Opportunity, Opportunity>();
    const opportunities = state.scan.opportunities.map((o) => {
      if (o.customerId !== customerId) return o;
      const n = { ...o, suppressed: "do_not_contact" as const };
      swapped.set(o, n);
      return n;
    });
    // off the primary list too: it's what gets planned
    state.scan = { ...state.scan, opportunities, primary: state.scan.primary.filter((o) => !swapped.has(o)) };
  }
  event(state, now, "guard", "action", `${c.name} taken off the list`, `${by}.${cancelled ? ` ${plural(cancelled, "queued note")} stopped.` : ""}`);
  state.updatedAt = now;
  return { cancelled, withdrawn };
}

/**
 * The owner texted "BUSY until <date>" (or "OPEN"). New-work sequences that haven't started yet move so
 * their first note lands about three weeks before the schedule opens; "OPEN" brings them back.
 * Sequences already under way are left alone — pausing mid-conversation reads strangely.
 * A moved note a sending platform already holds loses its provider id (it's pushed again on its new date);
 * `withdrawn` lists those ids so the caller pulls the platform's copy.
 * A one pass waits as a whole and is paced again (repacePass), so its days never run together over its inboxes' limit:
 * BUSY, everyone it hasn't written to from the day new work may start; OPEN, from the next send day.
 */
export function setBookedOut(state: AccountState, until: string | undefined, now: ISODateTime): { moved: number; withdrawn: string[] } {
  const withdrawn: string[] = [];
  const ds = state.dataset;
  const today = now.slice(0, 10);
  ds.business.bookedOutUntil = until;
  const pass = isOnePass(ds.business.plan);
  let moved = 0;
  if (pass) {
    const earliest = nextAllowed(ds, addDays(today, 1));
    const floor = until ? nextAllowed(ds, addDays(until, -21)) : earliest;
    const waiting = state.touches.filter((t) => t.status === "approved" || t.status === "planned");
    if (until ? waiting.some((t) => t.step === 1 && t.dueAt.slice(0, 10) < floor) : waiting.some((t) => t.heldDays)) {
      const r = repacePass(state, floor > earliest ? floor : earliest, { held: !!until });
      moved = r.moved;
      withdrawn.push(...r.withdrawn);
    }
  }
  const started = new Set(state.touches.filter((t) => t.step === 1 && (t.status === "sent" || t.status === "delivered")).map((t) => t.opportunityId));
  const byOpp = new Map<string, Touch[]>();
  if (!pass)
    for (const t of state.touches) {
      if (t.status !== "approved" && t.status !== "planned") continue;
      if (started.has(t.opportunityId)) continue;
      (byOpp.get(t.opportunityId) ?? byOpp.set(t.opportunityId, []).get(t.opportunityId)!).push(t);
    }
  for (const [oppId, ts] of byOpp) {
    const o = oppById(state.scan?.opportunities, oppId);
    if (!o || !HOLD_WHEN_BOOKED.has(o.type)) continue;
    const first = ts.reduce((a, b) => (a.dueAt < b.dueAt ? a : b));
    let shift = 0;
    if (until) {
      const floor = nextAllowed(ds, addDays(until, -21));
      if (first.dueAt.slice(0, 10) < floor) shift = daysBetween(first.dueAt.slice(0, 10), floor);
    } else if (first.heldDays) {
      const earliest = nextAllowed(ds, addDays(today, 1));
      const back = addDays(first.dueAt.slice(0, 10), -first.heldDays);
      shift = -daysBetween(back < earliest ? earliest : back, first.dueAt.slice(0, 10));
    }
    if (!shift) continue;
    for (const t of ts) {
      const d = nextAllowed(ds, addDays(t.dueAt.slice(0, 10), shift));
      t.dueAt = `${d}${t.dueAt.slice(10)}`;
      t.heldDays = until ? (t.heldDays ?? 0) + shift : undefined;
      if (t.providerId && !withdrawn.includes(t.providerId)) withdrawn.push(t.providerId);
      t.providerId = undefined;
    }
    moved++;
  }
  event(
    state,
    now,
    "dispatcher",
    "action",
    until ? `Booked out until ${until} — new work waits` : "Schedule open again — held notes are back on",
    moved ? `${plural(moved, "person", "people")} moved${until ? ` so their first note lands the week of ${mondayOf(addDays(until, -21))}` : " back, from the next send day"}.` : undefined,
  );
  state.updatedAt = now;
  return { moved, withdrawn };
}

/**
 * A person read a reply the rules couldn't place ("unclear") and says what it means. The same dispatch runs
 * as for a reply read automatically: a yes goes to the owner, a stop suppresses everywhere.
 */
export function relabelReply(state: AccountState, replyId: string, intent: Reply["intent"], now: ISODateTime): Reply | undefined {
  const r = state.replies.find((x) => x.id === replyId);
  if (!r) return undefined;
  const c = customerById(state.dataset, r.customerId);
  const name = c?.name ?? r.from;
  const refs = c ? [{ kind: "customer" as const, id: c.id }] : undefined;
  r.intent = intent;
  r.confidence = 1;
  // an out-of-office isn't the person answering: their notes carry on
  if (intent === "auto_reply") {
    r.status = "done";
    event(state, now, "inbox", "info", `${name}: out-of-office (sorted by a person)`, "Sequence continues as planned.", refs);
    state.updatedAt = now;
    return r;
  }
  if (c) stopSequence(state, c.id);
  if (intent === "stop" || intent === "complaint" || intent === "bounce") {
    // a bounce names the customer's dead address, not the mail server that sent the notice
    const addresses = intent === "bounce" && c ? c.emails : [r.from];
    for (const a of addresses) state.suppressions[a] = intent === "complaint" ? "complained" : intent === "bounce" ? "bounced" : "unsubscribed";
    r.status = "done";
    event(state, now, "guard", "action", `${name} — removed everywhere (sorted by a person)`, undefined, refs);
  } else if (intent === "wants_it" || intent === "wants_price" || intent === "question") {
    if (r.status !== "handed_off") {
      r.status = "handed_off";
      r.handedOffAt = now;
      ownerMsg(state, now, "handoff", handoffText(state, r), refs);
    }
    event(state, now, "dispatcher", "win", `${name} ${intent === "wants_it" ? "wants it done" : intent === "wants_price" ? "wants a price" : "has a question"} — texted to you`, "Sorted by a person.", refs);
  } else {
    r.status = "done";
    event(state, now, "inbox", "info", `${name}: marked "${intent.replace(/_/g, " ")}" by a person`, undefined, refs);
  }
  state.updatedAt = now;
  return r;
}

/** The owner (or operator) says a win wasn't ours. It leaves every total, the guarantee and the return. */
export function disputeRecovery(state: AccountState, recoveryId: string, reason: string, by: string, now: ISODateTime): boolean {
  const r = state.recoveries.find((x) => x.id === recoveryId);
  if (!r || r.disputed) return false;
  r.disputed = { at: now, reason: reason.trim().slice(0, 200) || "not ours", by };
  const name = customerById(state.dataset, r.customerId)?.name ?? "A customer";
  event(state, now, "ledger", "info", `${name} (${fmtMoney(r.value)}) marked not ours`, r.disputed.reason, [{ kind: "customer", id: r.customerId }]);
  state.updatedAt = now;
  return true;
}

/** One answer to a new request covers the person this long: another request from them inside it isn't answered again. */
export const ONE_ANSWER_DAYS = 3;

/**
 * Our answer to a new request that this person (or anyone at this address) already has, sent or on its way, in the
 * last ONE_ANSWER_DAYS. `sentOnly` counts only answers that went or are going right now (the Sender's check).
 */
export function answeredLately(state: AccountState, customerId: string, to: string | undefined, now: ISODateTime, opts: { exceptId?: string; sentOnly?: boolean } = {}): Touch | undefined {
  const nowMs = Date.parse(`${now.slice(0, 16)}:00Z`);
  const live: Touch["status"][] = opts.sentOnly ? ["sending", "sent", "delivered"] : ["planned", "approved", "sending", "sent", "delivered"];
  const addr = to?.toLowerCase();
  return state.touches.find((t) => {
    if (t.id === opts.exceptId || t.track !== "new_request" || !live.includes(t.status)) return false;
    const when = t.sentAt ?? t.claimedAt ?? t.askedAt ?? t.dueAt;
    if (!((nowMs - Date.parse(`${when.slice(0, 16)}:00Z`)) / 86_400_000 <= ONE_ANSWER_DAYS)) return false;
    if (t.customerId === customerId) return true;
    return !!addr && !!customerById(state.dataset, t.customerId)?.emails.some((e) => e.toLowerCase() === addr);
  });
}

/**
 * Always-on, where the server sells new-request answering: every request that came in during the last day gets an answer within minutes (7am–8pm; one that
 * lands at night is answered at 7am) — "Thanks for reaching out, Dave will call you today" — and the owner gets the
 * lead by text. If no visit or quote follows, the unquoted-request follow-up takes over after two days.
 * While sending is held (paused, cancelled, the Guard's brake) nothing is queued to go later: the owner gets the
 * lead and is told to call, never that we wrote back.
 */
export function answerNewRequests(state: AccountState, now: ISODateTime, opts: { paused?: boolean; features?: Features } = {}): number {
  const ds = state.dataset;
  const b = ds.business;
  if (!alwaysOnFor(b, opts.features)) return 0;
  const held = opts.paused || b.plan.stage === "paused" || b.plan.stage === "cancelled" || sendHealth(state).paused;
  const nowMs = Date.parse(`${now.slice(0, 19)}Z`);
  let n = 0;
  for (const r of ds.requests) {
    if (r.quoteId || r.status === "converted" || r.status === "archived") continue;
    const when = r.createdAt ?? (r.createdOn ? `${r.createdOn}T12:00:00Z` : undefined);
    if (!when) continue;
    const ageH = (nowMs - Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(when) ? when : `${when}Z`)) / 3_600_000;
    // a day's grace either side absorbs the local/UTC difference between the source's clock and ours
    if (!(ageH >= -14 && ageH <= 36)) continue;
    const id = makeId("t", "req", r.id, 1);
    // once per request, whether or not an answer was queued
    if (state.touches.some((t) => t.id === id) || state.ownerMessages.some((m) => m.refs?.some((x) => x.kind === "request" && x.id === r.id))) continue;
    const c = customerById(ds, r.customerId);
    if (!c || c.doNotContact) continue;
    const to = sendableEmail(c.emails, state.suppressions);
    const quotedSince = ds.quotes.some((q) => q.customerId === c.id && (q.sentOn ?? q.createdOn ?? "") >= (r.createdOn ?? "9999"));
    if (quotedSince) continue;
    // A request that lands at night is answered at 7:00, and the promise ("I'll call you today") is worded for then.
    const at = answerTime(now);
    const waits = at !== now.slice(0, 19);
    const ack = renderRequestAck(ds, r, c, at);
    // One person, one "thanks for reaching out": the same form forwarded again the next morning, or a Jobber request
    // that also arrived as a forwarded notification, is told to the owner but not answered a second time.
    const already = to ? answeredLately(state, c.id, to, now) : undefined;
    const answering = !!to && !held && !already && !ack.flags.some((f) => /Unfilled blank|Missing the/.test(f));
    if (answering)
      state.touches.push({ id, opportunityId: `req:${r.id}`, customerId: c.id, channel: "email", step: 1, angle: "check_in", dueAt: at.slice(0, 16), status: "approved", subject: ack.subject, body: ack.body, flags: ack.flags, instant: true, track: "new_request", askedAt: now.slice(0, 16) });
    const street = c.address?.street ? `, ${c.address.street}` : "";
    const phone = c.phones[0] ? fmtPhone(c.phones[0]) : c.emails[0] ?? "no phone on file";
    const promise = promiseTonight(ack.promise, now, at);
    const answer = answering
      ? waits
        ? `At 7am we'll write back that ${promise}.`
        : `We already wrote back that ${promise}.`
      : !to
        ? `No email on file, so we couldn't answer them — call soon.`
        : held
          ? `Sending is on hold, so we didn't answer them — call them soon.`
          : already
            ? already.sentAt
              ? `They already got our answer to an earlier request, so no second note went — call them soon.`
              : `Our answer to their earlier request is already on its way, so no second note went — call them soon.`
            : `We couldn't answer them automatically — call them soon.`;
    ownerMsg(
      state,
      now,
      "handoff",
      [`📥 NEW REQUEST — ${c.name}${street}`, `“${(r.title || "no details").replace(/\s+/g, " ").slice(0, 140)}”`, `Call: ${phone}`, answer, r.rawStatus === "forwarded" ? `${r.source && r.source !== "a forwarded email" ? `Came in through ${r.source}; you forwarded it` : "You forwarded it"} — no need to text us about this one.` : `It's in your Jobber as usual — no need to text us about this one.`].join("\n"),
      [{ kind: "customer", id: c.id }, { kind: "request", id: r.id }],
    );
    event(state, now, "inbox", "action", `New request from ${c.name} — ${answering ? (waits ? "answer goes at 7am" : "answered in minutes") : !to ? "answered (no email: owner texted)" : held ? "not answered (sending on hold): owner texted" : already ? "already answered lately (no second note): owner texted" : "not answered: owner texted"}`, r.title, [{ kind: "customer", id: c.id }]);
    n++;
  }
  if (n) state.updatedAt = now;
  return n;
}

/**
 * A request the owner forwarded (website form, Angi, Thumbtack, a homeowner's email) becomes a request in
 * their records, on the same always-on track as a Jobber request: the caller runs answerNewRequests next.
 * The person is matched by email, then phone; someone new is added. The same request forwarded twice is one.
 */
export function takeRequest(state: AccountState, lead: RequestEmail, receivedAt: ISODateTime, now: ISODateTime): { requestId: string; customerId: string; duplicate: boolean } {
  const ds = state.dataset;
  const email = lead.email?.toLowerCase();
  const digits = (p: string) => p.replace(/\D/g, "").slice(-10);
  const byPhone = lead.phone ? ds.customers.find((x) => x.phones.some((p) => digits(p) === digits(lead.phone!))) : undefined;
  // Someone on file with that number but a different email is someone else (a shared line, a stray number in the
  // email): they get their own record, so our answer goes to the person who asked, never to the one on file.
  const samePerson = byPhone && (!email || !byPhone.emails.length || byPhone.emails.some((e) => e.toLowerCase() === email));
  let c = (email ? customerByEmail(ds, email) : undefined) ?? (samePerson ? byPhone : undefined);
  if (!c) {
    const parts = (lead.name ?? "").trim().split(/\s+/).filter(Boolean);
    const street = lead.address?.split(",")[0]?.trim();
    // nobody on file matched, so whoever already has this id (ids are short hashes and can collide) is someone else
    const key = email ?? digits(lead.phone ?? "");
    let id = makeId("c", "fwd", key);
    for (let n = 2; ds.customers.some((x) => x.id === id); n++) id = makeId("c", "fwd", key, n);
    c = {
      id,
      sourceIds: [],
      name: lead.name?.trim() || email || fmtPhone(lead.phone!) || "New request",
      firstName: parts.length > 1 || (parts[0] && !/\./.test(parts[0])) ? (parts[0] ?? "") : "",
      lastName: parts.slice(1).join(" "),
      emails: email ? [email] : [],
      phones: lead.phone ? [lead.phone] : [],
      address: street ? { street, raw: lead.address } : undefined,
      properties: [],
      tags: ["forwarded request"],
      createdOn: receivedAt.slice(0, 10),
      leadSource: lead.source,
    };
    ds.customers.push(c);
  } else {
    const was = c;
    const emails = email && !c.emails.includes(email) ? [...c.emails, email] : c.emails;
    const phones = lead.phone && !c.phones.some((p) => digits(p) === digits(lead.phone!)) ? [...c.phones, lead.phone] : c.phones;
    // a new record and a new list, never an edit in place: saving skips lists it has already seen
    if (emails !== c.emails || phones !== c.phones) {
      c = { ...c, emails, phones };
      const next = c;
      ds.customers = ds.customers.map((x) => (x === was ? next : x));
    }
  }
  const title = (lead.job ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "New request";
  const who = c.id;
  let requestId = makeId("r", "fwd", who, title.toLowerCase(), receivedAt.slice(0, 10));
  // only this person's own request on that id is the same one again; another's keeps it and this one is salted
  for (let n = 2; ds.requests.some((r) => r.id === requestId && r.customerId !== who); n++) requestId = makeId("r", "fwd", who, title.toLowerCase(), receivedAt.slice(0, 10), n);
  if (ds.requests.some((r) => r.id === requestId)) return { requestId, customerId: c.id, duplicate: true };
  ds.requests.push({ id: requestId, customerId: c.id, title, status: "new", rawStatus: "forwarded", createdOn: receivedAt.slice(0, 10), createdAt: receivedAt, source: lead.source });
  event(state, now, "reader", "action", `Request forwarded from ${lead.source}: ${c.name}`, title, [{ kind: "customer", id: c.id }]);
  state.updatedAt = now;
  return { requestId, customerId: c.id, duplicate: false };
}

/** Setup never asks what trade they're in: their own quote and job titles say it. Only fills an unset trade. */
export function adoptTrade(state: AccountState, now: ISODateTime): boolean {
  const ds = state.dataset;
  if (ds.business.trade !== "general") return false;
  const d = detectTrade([...ds.quotes.map((q) => q.title), ...ds.jobs.map((j) => j.title), ...ds.requests.map((r) => r.title)]);
  if (d.trade === "general") return false;
  ds.business.trade = d.trade;
  ds.business.otherTrades = d.others;
  event(state, now, "reader", "info", `Looks like a ${playbook(d.trade).label.toLowerCase()} business${d.others.length ? ` (also ${d.others.map((t) => playbook(t).label.toLowerCase()).join(", ")})` : ""}`, "Read from your own quote and job titles. Notes use that trade's words, seasons and follow-ups.");
  return true;
}
