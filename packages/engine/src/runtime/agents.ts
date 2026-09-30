import { scan } from "../breakage/detect.ts";
import { summarize } from "../breakage/forecast.ts";
import { quietRateOf } from "../breakage/quiet.ts";
import { BREAKAGE_LABEL } from "../breakage/assumptions.ts";
import { HOLD_WHEN_BOOKED, nextAllowed, planOutreach, type Plan } from "../cadence/plan.ts";
import { readReply, type RequestEmail } from "../inbox/index.ts";
import { ingestFile } from "../ingest/index.ts";
import { attribute, HOLDOUT_DAYS, lift, ownerReported, type LiftReport } from "../ledger/attribution.ts";
import type { AgentEvent, AgentId, Customer, Dataset, ISODateTime, RecordKind, Reply, Touch } from "../model.ts";
import { ackFor, closeMessage, earlyLeaveRefund, feesPaid, grossFees, guaranteeCheck, handoffText, kickoffText, leadCode, renewalNotice, slaNudge, weeklyReport, yearFloor } from "../reports/owner.ts";
import { answerTime, promiseTonight, renderRequestAck } from "../copy/render.ts";
import { detectTrade, playbook } from "../trades/index.ts";
import { alwaysOnFor } from "../breakage/assumptions.ts";
import { addDays, addMonths, daysBetween, extractEmails, fmtMoney, fmtPhone, makeId, mondayOf, monthName, plural, sendableEmail, weekday } from "../util.ts";
import type { AccountState, OwnerMessage } from "./state.ts";
import { customerByEmail, customerById, oppById } from "../lookup.ts";

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

export function find(state: AccountState, now: ISODateTime): AccountState {
  const lastContacted: Record<string, string> = {};
  for (const o of state.outreach) if (!o.holdout) lastContacted[o.customerId] = o.lastTouchOn;
  state.scan = scan(state.dataset, { suppressedEmails: state.suppressions, lastContacted, cooldownDays: 150 });
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

export function planBatch(state: AccountState, now: ISODateTime, opts: { startOn: string; limitPeople?: number; approve?: boolean; kickoff?: boolean }): Plan {
  if (!state.scan) find(state, now);
  const active = new Set(state.touches.filter((t) => t.status !== "cancelled" && t.status !== "skipped").map((t) => t.customerId));
  // the comparison group waits ~60 days, then gets worked too (nobody's quote is held back for good)
  const released = new Set(state.outreach.filter((o) => o.holdout && !o.treatedFrom && o.releaseOn && o.releaseOn <= opts.startOn).map((o) => o.customerId));
  for (const o of state.outreach) if (!released.has(o.customerId) || active.has(o.customerId)) active.add(o.customerId);
  const isTrial = state.dataset.business.plan.stage === "trial";
  const firstEver = !state.touches.some((t) => t.status !== "cancelled");
  // The free round goes to the likeliest replies; paying accounts follow the shop's own strategy.
  const rank = isTrial ? "reply" : state.summary?.profile?.strategy.rank;
  const contacted = new Set(state.touches.filter((t) => t.status === "sent" || t.status === "delivered").map((t) => t.customerId));
  // Everything already on the calendar counts against the pace, so a top-up never doubles it.
  const existingStarts = state.touches.filter((t) => t.step === 1 && ["planned", "approved", "sent", "delivered"].includes(t.status)).map((t) => t.dueAt.slice(0, 10));
  const plan = planOutreach(state.dataset, state.scan!, { startOn: opts.startOn, limitPeople: opts.limitPeople, skipCustomers: active, applyHoldout: !isTrial, rank, released, contacted, existingStarts });
  const status: Touch["status"] = opts.approve ? "approved" : "planned";
  state.touches.push(...plan.touches.map((t) => ({ ...t, status })));
  for (const id of plan.holdout)
    if (!state.outreach.some((o) => o.customerId === id)) state.outreach.push({ customerId: id, firstTouchOn: opts.startOn, lastTouchOn: opts.startOn, holdout: true, releaseOn: addDays(opts.startOn, HOLDOUT_DAYS) });
  const flagged = plan.touches.filter((t) => t.flags.length).length;
  event(state, now, "writer", "action", `Wrote ${plural(plan.touches.length, "note")} for ${plural(plan.people.length, "person", "people")}`, `Each one about their own job, signed by ${state.dataset.business.signerName}. ${flagged ? `${flagged} need a second look.` : "All passed the quality check."}`);
  if (plan.firstDay && isTrial && firstEver && opts.kickoff !== false) kickoff(state, now, { awaitOk: !opts.approve });
  if (plan.firstDay) event(state, now, "sender", "action", `Scheduled ${plan.firstDay} → ${plan.lastDay}`, `${state.dataset.business.weeklyNewContacts} new people a week, on your send days, inside your hours.${plan.holdout.length ? ` ${plan.holdout.length} held back to measure true lift.` : ""}`);
  state.updatedAt = now;
  return plan;
}

/**
 * The welcome text for the free round: their quiet rate, the first note word for word, and (when
 * awaitOk) "Reply OK" — nothing goes out until they do. Once only.
 */
export function kickoff(state: AccountState, now: ISODateTime, opts: { awaitOk: boolean; again?: boolean }): OwnerMessage | undefined {
  if (state.ownerMessages.some((m) => m.kind === "kickoff") && !(opts.again && state.awaitingOwnerOk)) return undefined;
  const firsts = state.touches.filter((t) => t.step === 1 && (t.status === "planned" || t.status === "approved"));
  if (!firsts.length) return undefined;
  const firstDay = firsts.map((t) => t.dueAt.slice(0, 10)).sort()[0]!;
  const people = new Set(firsts.map((t) => t.customerId)).size;
  if (opts.awaitOk) state.awaitingOwnerOk = now;
  return ownerMsg(state, now, "kickoff", kickoffText(state, firstDay, people, { awaitOk: opts.awaitOk }));
}

/** The owner texted OK to the first note: the batch is approved and goes out on schedule. */
export function ownerApproves(state: AccountState, now: ISODateTime): { approved: number; firstDay?: string } {
  state.awaitingOwnerOk = undefined;
  // An OK that comes after the planned first day moves the whole round forward, spacing kept: it never sends
  // the backlog at once.
  const planned = state.touches.filter((t) => t.status === "planned");
  const earliest = planned.map((t) => t.dueAt.slice(0, 10)).sort()[0];
  const today = now.slice(0, 10);
  const start = nextAllowed(state.dataset, Number(now.slice(11, 13)) >= state.dataset.business.sendWindow[1] ? addDays(today, 1) : today);
  if (earliest && earliest < start) {
    const shift = daysBetween(earliest, start);
    for (const t of planned) t.dueAt = `${nextAllowed(state.dataset, addDays(t.dueAt.slice(0, 10), shift))}${t.dueAt.slice(10)}`;
  }
  const approved = approveAll(state, now);
  const firstDay = state.touches.filter((t) => t.status === "approved").map((t) => t.dueAt.slice(0, 10)).sort()[0];
  event(state, now, "sender", "action", "The owner said OK by text", approved ? `${plural(approved, "note")} approved; the first go out ${firstDay}.` : "Nothing was waiting.");
  return { approved, firstDay };
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

/** Why a held note will never go: the Sender cancels these for good. Anything else only waits. */
export const HELD_FOR_GOOD = /No sendable email|They replied|Do not contact|Note \d+ never went|No longer needed/;
/** Lint flags for what the law or honesty requires (opt-out, address, no fake "Re:", no made-up stats): the note waits for a fix. */
export const REQUIRED_FLAG = /Missing the|Unfilled blank|Fake Re:|unsourced stat/;
/** "Dave will call you today" is only true for a while: past this, an unsent answer to a request is dropped. */
export const ANSWER_GOOD_FOR_HOURS = 12;

/** The owner marked them do-not-contact in their own software (their setting wins over ours). */
export function doNotContact(state: AccountState, t: Touch): boolean {
  return !!customerById(state.dataset, t.customerId)?.doNotContact || oppById(state.scan?.opportunities, t.opportunityId)?.suppressed === "do_not_contact";
}

/** Why an answer to a new request should no longer go, if it shouldn't. */
export function staleAnswer(state: AccountState, t: Touch, now: ISODateTime): string | undefined {
  if (!t.instant) return undefined;
  const ds = state.dataset;
  const r = t.opportunityId.startsWith("req:") ? ds.requests.find((x) => x.id === t.opportunityId.slice(4)) : undefined;
  if (r && (r.quoteId || r.status === "converted" || r.status === "archived" || ds.quotes.some((q) => q.customerId === t.customerId && (q.sentOn ?? q.createdOn ?? "") >= (r.createdOn ?? "9999"))))
    return "their request already has a quote or a visit";
  const late = (Date.parse(`${now.slice(0, 16)}:00Z`) - Date.parse(`${t.dueAt.slice(0, 16)}:00Z`)) / 3_600_000;
  if (late > ANSWER_GOOD_FOR_HOURS) return `it would have gone ${Math.round(late)} hours late`;
  return undefined;
}

/** Everything that should go out at `now`, after the Guard's checks. Pure: marks nothing. */
export function dueTouches(state: AccountState, now: ISODateTime): { due: DueTouch[]; held: { touch: Touch; why: string }[] } {
  const b = state.dataset.business;
  const local = now.slice(0, 16);
  const day = now.slice(0, 10);
  const due: DueTouch[] = [];
  const held: { touch: Touch; why: string }[] = [];
  // an out-of-office or a bounce isn't the person writing back
  const replied = new Set(state.replies.filter((r) => r.customerId && r.intent !== "auto_reply" && r.intent !== "bounce").map((r) => r.customerId!));
  const health = sendHealth(state);
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
    if (!t.instant && replied.has(c.id)) {
      held.push({ touch: t, why: "They replied — the sequence stops" });
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
    if (!t.instant || t.status !== "approved" || t.providerId || t.dueAt > now.slice(0, 16)) continue;
    const why = staleAnswer(state, t, now);
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
  // Small senders get no spam-rate data from Gmail, so the brakes here trip well before the providers' limits.
  if (sent >= 40 && bounceRate > 0.03) reason = `Bounce rate ${(bounceRate * 100).toFixed(1)}% is over 3% — paused to protect the sending reputation. The list needs cleaning.`;
  else if (sent >= 300 && complaintRate > 0.001) reason = `Spam complaints hit ${(complaintRate * 100).toFixed(2)}% — paused at 0.1%, well before Gmail's 0.3% limit.`;
  else if (sent >= 100 && (complaints + confused) / sent > 0.01) reason = `${complaints + confused} people didn't recognize the business or complained — paused. Check the sender name and that these people really asked for a price.`;
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
  const sender = customerByEmail(state.dataset, email);
  const answered = msg.inReplyTo ? state.touches.find((t) => t.providerId === msg.inReplyTo) : undefined;
  // A bounce comes from the mail system, not the person: find them by the note it answers, or the address it names.
  const bounced =
    reading.intent === "bounce" && !sender
      ? (answered && customerById(state.dataset, answered.customerId)) || extractEmails(msg.text).map((e) => customerByEmail(state.dataset, e)).find(Boolean)
      : undefined;
  // A spouse or a forward answering our note is still about the person we wrote to.
  const c = sender ?? bounced ?? (reading.intent !== "bounce" && answered ? customerById(state.dataset, answered.customerId) : undefined);
  const touch = msg.inReplyTo
    ? answered
    : state.touches.filter((t) => t.customerId === c?.id && t.status === "sent").sort((a, b) => ((a.sentAt ?? "") < (b.sentAt ?? "") ? 1 : -1))[0];
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
    // from another address in our thread (an alias, a spouse): the address we wrote to is done too
    if (c && !sender) for (const e of c.emails) state.suppressions[e] = why;
    if (c) stopSequence(state, c.id);
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
  if (c) stopSequence(state, c.id);

  if (r.intent === "wants_it" || r.intent === "wants_price" || r.intent === "question") {
    // "Great, thanks" to our instant answer reads as another yes: it joins the lead the owner already has,
    // instead of a second answer and a second hand-off (which would invite a third).
    const lately = (at?: string) => !!at && daysBetween(at.slice(0, 10), now.slice(0, 10)) <= 14;
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
    // Only when the thread says so, or nothing but request answers went to them lately: a platform reply with no
    // thread falls back to their newest note, and a "yes" to the fence quote must not ride on a request answer.
    const followedUpLately = !!c && state.touches.some((t) => t.customerId === c.id && t.track !== "new_request" && !t.opportunityId.startsWith("req:") && (t.status === "sent" || t.status === "delivered") && lately(t.sentAt ?? t.dueAt));
    const request = touch && c && touch.customerId === c.id && (touch.track === "new_request" || touch.opportunityId.startsWith("req:")) && lately(touch.sentAt ?? touch.dueAt) && (touch === answered || !followedUpLately) ? touch : undefined;
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
  if (outcome) r.outcome = outcome;
  if (value) r.outcomeValue = value;
  r.status = "done";
  const name = state.dataset.customers.find((c) => c.id === r.customerId)?.name ?? r.from;
  const hrs = Math.round((Date.parse(r.ownerContactedAt) - Date.parse(r.receivedAt)) / 3600000);
  if (outcome === "booked") {
    event(state, at, "ledger", "win", `Booked: ${name}${value ? ` — ${fmtMoney(value)}` : ""}`, `Called back in ${hrs}h.`, r.customerId ? [{ kind: "customer", id: r.customerId }] : undefined);
    state.recoveries.push(...ownerReported([r], state.recoveries));
  } else {
    event(state, at, "dispatcher", "info", `You reached ${name}`, `${hrs}h after they wrote back.`);
  }
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
export function ledgerPass(state: AccountState, now: ISODateTime): { newRecoveries: number; lift: LiftReport } {
  state.dataset.asOf = now.slice(0, 10);
  // a reply to our answer on their own new request isn't a reply to a follow-up (same rule as the guarantee)
  const newRequestTouch = new Set(state.touches.filter((t) => t.track === "new_request").map((t) => t.id));
  const replied = new Set(
    state.replies
      .filter((r) => r.customerId && !["auto_reply", "bounce"].includes(r.intent) && !r.opportunityId?.startsWith("req:") && !(r.touchId && newRequestTouch.has(r.touchId)))
      .map((r) => r.customerId!),
  );
  const found = attribute(state.dataset, state.outreach, { replied });
  // someone who came back quietly and then wrote to us is now traced
  for (const r of state.recoveries) if (r.tier === "after_note" && replied.has(r.customerId)) r.tier = "traced";
  // One credit per record (job, quote, invoice), not per person.
  const known = new Set(state.recoveries.map((r) => `${r.record.kind}:${r.record.id}`));
  let added = 0;
  for (const r of found) {
    if (known.has(`${r.record.kind}:${r.record.id}`)) continue;
    // The export now shows the job the owner told us about: the invoiced figure replaces the owner's.
    const told = r.tier === "traced" ? state.recoveries.find((x) => x.customerId === r.customerId && x.match === "owner_reported" && !x.disputed && Math.abs(daysBetween(x.cameBackOn, r.cameBackOn)) <= 30) : undefined;
    if (told) {
      Object.assign(told, { record: r.record, value: r.value, match: r.match, confidence: r.confidence, cameBackOn: r.cameBackOn });
      known.add(`${r.record.kind}:${r.record.id}`);
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
  const l = lift(state.outreach, state.recoveries);
  event(state, now, "ledger", "info", `Recovered so far: ${fmtMoney(l.treated.value)}`, l.note);
  find(state, now);
  return { newRecoveries: added, lift: l };
}

export function reportWeek(state: AccountState, now: ISODateTime): OwnerMessage {
  const text = weeklyReport(state, mondayOf(now.slice(0, 10)));
  event(state, now, "reporter", "action", "Sent your weekly report", text.split("\n")[0]);
  return ownerMsg(state, now, "weekly", text);
}

/** The close after the free round, once replies have had a week to come in. */
export function closeIfDue(state: AccountState, now: ISODateTime, opts: { payLink?: string; signature?: string } = {}): OwnerMessage | undefined {
  const b = state.dataset.business;
  if (b.plan.stage !== "trial" || state.ownerMessages.some((m) => m.kind === "close")) return undefined;
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
  }
  state.trialCompletedOn = last.slice(0, 10);
  const friday = addDays(now.slice(0, 10), (5 - weekday(now.slice(0, 10)) + 7) % 7 || 7);
  const text = closeMessage(state, { ...opts, sayYesBy: `Friday ${Number(friday.slice(8))}` });
  event(state, now, "reporter", "action", "Your free round is done — results sent", text.split("\n")[0]);
  return ownerMsg(state, now, "close", text);
}

export function billingCheck(state: AccountState, now: ISODateTime): OwnerMessage | undefined {
  // Only a paying account is charged; a cancelled or paused one gets no billing texts at all.
  if (state.dataset.business.plan.stage !== "paying") return undefined;
  const g = guaranteeCheck(state, now.slice(0, 10));
  if (!g) return undefined;
  const until = daysBetween(now.slice(0, 10), g.chargeOn);
  if (until > 2 || until < -3) return undefined;
  if (state.ownerMessages.some((m) => (m.kind === "precharge" || m.kind === "free_month") && m.refs?.some((r) => r.id === g.chargeOn))) return undefined;
  if (g.free) {
    const fm = state.dataset.business.plan.freeMonths;
    if (!fm.includes(g.chargeOn)) fm.push(g.chargeOn);
    event(state, now, "guard", "action", "Guarantee: this month is free", "Nobody asked for a price or a date this period, so you won't be charged.");
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

/** The owner's answer to the renewal (or a switch any time): another year, or month to month from the year's end. */
export function renewPlan(state: AccountState, choice: "year" | "monthly", now: ISODateTime): string {
  const b = state.dataset.business;
  const today = now.slice(0, 10);
  const plan = b.plan;
  const started = plan.paidOn ? [...(plan.yearsPaidOn?.length ? plan.yearsPaidOn : [plan.paidOn])].sort().pop()! : today;
  const yearEnds = plan.billing === "annual" ? addMonths(started, 12) : today;
  const from = yearEnds > today ? yearEnds : today;
  if (choice === "year") {
    if (plan.billing !== "annual") {
      plan.priorFees = grossFees(b, today).total;
      plan.billing = "annual";
      plan.paidOn = from;
      plan.yearsPaidOn = [...(plan.yearsPaidOn ?? []), from];
    } else plan.yearsPaidOn = [...(plan.yearsPaidOn?.length ? plan.yearsPaidOn : [started]), from];
  } else {
    if (plan.billing === "annual") plan.priorFees = grossFees(b, from).total;
    plan.billing = "monthly";
    plan.paidOn = from;
    // yearsPaidOn stays as history so the last year is still settled at its end
  }
  plan.stage = "paying";
  const when = `${monthName(from)} ${Number(from.slice(8))}`;
  event(state, now, "reporter", "action", choice === "year" ? "Owner chose another year" : "Owner chose month to month", `Starts ${from}.`);
  return choice === "year"
    ? `Done — another year from ${when}, same price. The guarantee still runs every month.`
    : `Done — month to month from ${when}, ${fmtMoney(plan.monthlyPrice)} a month, cancel by text any time.`;
}

/**
 * The owner texted CANCEL. One text does it: every queued note stops, nothing more is charged, and a yearly
 * plan gets back what it didn't use (never more than monthly would have cost; the year floor on the months
 * used). What it stopped is kept for a day so UNDO can put it all back.
 */
export function cancelPlan(state: AccountState, now: ISODateTime, opts: { paused?: boolean } = {}): { stopped: number; refund: number; line: string } {
  const plan = state.dataset.business.plan;
  if (plan.stage === "cancelled") return { stopped: 0, refund: 0, line: "" };
  const stageBefore = plan.stage;
  const today = now.slice(0, 10);
  // any paid year that already ended is settled first, the same as at its end
  for (let i = 0; i < 5 && settleYears(state, now); i++);
  const touches: { id: string; status: "planned" | "approved" }[] = [];
  for (const t of state.touches)
    if (t.status === "approved" || t.status === "planned") {
      touches.push({ id: t.id, status: t.status });
      t.status = "cancelled";
    }
  let refund = 0;
  let line = "";
  const early = stageBefore !== "trial" ? earlyLeaveRefund(state, today) : undefined;
  if (early && early.refund > 0) {
    refund = early.refund;
    plan.yearRefunds = [...(plan.yearRefunds ?? []).filter((r) => r.yearStart !== early.yearStart), { yearStart: early.yearStart, amount: refund, early: true }];
    line = `${fmtMoney(refund, { cents: true })} of your year comes back to your card within 5 business days.`;
    const b = state.dataset.business;
    ownerMsg(
      state,
      now,
      "refund",
      `${b.ownerFirstName}, here's the math on your year: you paid ${fmtMoney(early.paid, { cents: true })} and used ${plural(early.monthsUsed, "month")}${early.quiet ? ` (${early.quiet} quiet, so free)` : ""}. Month to month that's ${fmtMoney(early.asMonthly)}, and the jobs on your ledger in that time came to ${fmtMoney(early.traced)}. You keep the lower of those, so ${fmtMoney(refund, { cents: true })} goes back to your card within 5 business days.`,
      [{ kind: "year_refund", id: early.yearStart }],
    );
  }
  plan.stage = "cancelled";
  state.cancelled = {
    at: now,
    stageBefore,
    touches,
    ...(state.awaitingOwnerOk ? { awaitingOwnerOk: state.awaitingOwnerOk } : {}),
    ...(opts.paused ? { paused: true } : {}),
    ...(refund ? { refund: { yearStart: early!.yearStart, amount: refund } } : {}),
  };
  // a cancelled account isn't waiting for anyone's OK
  state.awaitingOwnerOk = undefined;
  event(state, now, "guard", "warning", "Owner cancelled by text", `${plural(touches.length, "queued note")} stopped. No further charges.${refund ? ` Yearly refund due: ${fmtMoney(refund, { cents: true })}.` : ""} UNDO works until ${addDays(today, 1)} ${now.slice(11, 16)}.`);
  state.updatedAt = now;
  return { stopped: touches.length, refund, line };
}

/**
 * UNDO within a day of CANCEL: the same notes back exactly as they were (a planned note stays planned, a note
 * the sending platform had is pushed again), the plan and the wait for the owner's OK as they were. A cancel that
 * set up a yearly refund is never undone by software: money may already be on its way, so a person does it.
 */
export function undoCancel(state: AccountState, now: ISODateTime, opts: { platform?: boolean; override?: boolean } = {}): { restored: number; stopped: number; paused: boolean } | { refused: "late" | "refund" } | undefined {
  const c = state.cancelled;
  const plan = state.dataset.business.plan;
  if (!c || plan.stage !== "cancelled") return undefined;
  if (!opts.override && Date.parse(`${now.slice(0, 19)}Z`) - Date.parse(`${c.at.slice(0, 19)}Z`) > 24 * 3_600_000) return { refused: "late" };
  if (c.refund && !opts.override) return { refused: "refund" };
  // an operator restoring the plan withdraws the refund that was never issued
  if (c.refund) plan.yearRefunds = (plan.yearRefunds ?? []).filter((r) => !(r.early && r.yearStart === c.refund!.yearStart));
  plan.stage = c.stageBefore;
  const before = new Map(c.touches.map((x) => [x.id, x.status]));
  // On a sending platform the cancel took each person's copy back; a sequence can only be pushed again from its
  // first note, so one already under way stays stopped (and the owner is told), never "back in line" and stuck.
  const started = new Set(state.touches.filter((t) => t.step === 1 && (t.status === "sent" || t.status === "delivered")).map((t) => t.opportunityId));
  let restored = 0;
  const stoppedPeople = new Set<string>();
  for (const t of state.touches) {
    const was = before.get(t.id);
    if (!was || t.status !== "cancelled") continue;
    if (opts.platform && !t.instant && started.has(t.opportunityId)) {
      stoppedPeople.add(t.customerId);
      continue;
    }
    t.status = was;
    // the cancel took the platform's copy back; the next sync pushes it again
    t.providerId = undefined;
    restored++;
  }
  if (c.awaitingOwnerOk) state.awaitingOwnerOk = c.awaitingOwnerOk;
  state.cancelled = undefined;
  event(state, now, "guard", "action", opts.override ? "The plan was restored after a cancel" : "Owner undid the cancel", `${plural(restored, "note")} back in line.${stoppedPeople.size ? ` ${plural(stoppedPeople.size, "person was", "people were")} part-way through their notes; those follow-ups stay stopped.` : ""}${c.paused ? " Still paused, as before." : ""}`);
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
  c.doNotContact = true;
  const withdrawn: string[] = [];
  let cancelled = 0;
  for (const t of state.touches) {
    if (t.customerId !== customerId || (t.status !== "approved" && t.status !== "planned")) continue;
    t.status = "cancelled";
    cancelled++;
    if (t.providerId && !withdrawn.includes(t.providerId)) withdrawn.push(t.providerId);
  }
  for (const o of state.scan?.opportunities ?? []) if (o.customerId === customerId) o.suppressed = "do_not_contact";
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
 */
export function setBookedOut(state: AccountState, until: string | undefined, now: ISODateTime): { moved: number; withdrawn: string[] } {
  const withdrawn: string[] = [];
  const ds = state.dataset;
  const today = now.slice(0, 10);
  ds.business.bookedOutUntil = until;
  const started = new Set(state.touches.filter((t) => t.step === 1 && (t.status === "sent" || t.status === "delivered")).map((t) => t.opportunityId));
  const byOpp = new Map<string, Touch[]>();
  for (const t of state.touches) {
    if (t.status !== "approved" && t.status !== "planned") continue;
    if (started.has(t.opportunityId)) continue;
    (byOpp.get(t.opportunityId) ?? byOpp.set(t.opportunityId, []).get(t.opportunityId)!).push(t);
  }
  let moved = 0;
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
    moved ? `${plural(moved, "person", "people")} moved${until ? ` so their first note lands the week of ${mondayOf(addDays(until, -21))}` : " back to the next send day"}.` : undefined,
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
 * Always-on: every request that came in during the last day gets an answer within minutes (7am–8pm; one that
 * lands at night is answered at 7am) — "Thanks for reaching out, Dave will call you today" — and the owner gets the
 * lead by text. If no visit or quote follows, the unquoted-request follow-up takes over after two days.
 * While sending is held (paused, cancelled, the Guard's brake) nothing is queued to go later: the owner gets the
 * lead and is told to call, never that we wrote back.
 */
export function answerNewRequests(state: AccountState, now: ISODateTime, opts: { paused?: boolean } = {}): number {
  const ds = state.dataset;
  const b = ds.business;
  if (!alwaysOnFor(b)) return 0;
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
    c = {
      id: makeId("c", "fwd", email ?? digits(lead.phone ?? "")),
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
    if (email && !c.emails.includes(email)) c.emails.push(email);
    if (lead.phone && !c.phones.some((p) => digits(p) === digits(lead.phone!))) c.phones.push(lead.phone);
  }
  const title = (lead.job ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "New request";
  const requestId = makeId("r", "fwd", c.id, title.toLowerCase(), receivedAt.slice(0, 10));
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
