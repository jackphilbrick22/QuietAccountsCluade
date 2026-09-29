import { scan } from "../breakage/detect.ts";
import { summarize } from "../breakage/forecast.ts";
import { BREAKAGE_LABEL } from "../breakage/assumptions.ts";
import { HOLD_WHEN_BOOKED, nextAllowed, planOutreach, type Plan } from "../cadence/plan.ts";
import { readReply } from "../inbox/index.ts";
import { ingestFile } from "../ingest/index.ts";
import { attribute, lift, ownerReported, type LiftReport } from "../ledger/attribution.ts";
import type { AgentEvent, AgentId, Dataset, ISODateTime, RecordKind, Reply, Touch } from "../model.ts";
import { closeMessage, guaranteeCheck, handoffText, slaNudge, weeklyReport } from "../reports/owner.ts";
import { addDays, daysBetween, extractEmails, fmtMoney, makeId, mondayOf, plural, weekday } from "../util.ts";
import type { AccountState, OwnerMessage } from "./state.ts";
import { customerByEmail, customerById, oppById } from "../lookup.ts";

function outreachFor(state: AccountState, customerId: string) {
  // outreach is append-only per customer; a Map keyed by the array keeps markSent O(1)
  let idx = outreachIdx.get(state.outreach);
  if (!idx || idx.len !== state.outreach.length) {
    idx = { len: state.outreach.length, map: new Map(state.outreach.filter((o) => !o.holdout).map((o) => [o.customerId, o])) };
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

export function planBatch(state: AccountState, now: ISODateTime, opts: { startOn: string; limitPeople?: number; approve?: boolean }): Plan {
  if (!state.scan) find(state, now);
  const active = new Set(state.touches.filter((t) => t.status !== "cancelled" && t.status !== "skipped").map((t) => t.customerId));
  for (const o of state.outreach) active.add(o.customerId);
  const isTrial = state.dataset.business.plan.stage === "trial";
  // The free round goes to the likeliest replies; paying accounts follow the shop's own strategy.
  const rank = isTrial ? "reply" : state.summary?.profile?.strategy.rank;
  const plan = planOutreach(state.dataset, state.scan!, { startOn: opts.startOn, limitPeople: opts.limitPeople, skipCustomers: active, applyHoldout: !isTrial, rank });
  const status: Touch["status"] = opts.approve ? "approved" : "planned";
  state.touches.push(...plan.touches.map((t) => ({ ...t, status })));
  for (const id of plan.holdout) if (!state.outreach.some((o) => o.customerId === id)) state.outreach.push({ customerId: id, firstTouchOn: opts.startOn, lastTouchOn: opts.startOn, holdout: true });
  const flagged = plan.touches.filter((t) => t.flags.length).length;
  event(state, now, "writer", "action", `Wrote ${plural(plan.touches.length, "note")} for ${plural(plan.people.length, "person", "people")}`, `Each one about their own job, signed by ${state.dataset.business.signerName}. ${flagged ? `${flagged} need a second look.` : "All passed the quality check."}`);
  if (plan.firstDay) event(state, now, "sender", "action", `Scheduled ${plan.firstDay} → ${plan.lastDay}`, `${state.dataset.business.weeklyNewContacts} new people a week, on your send days, inside your hours.${plan.holdout.length ? ` ${plan.holdout.length} held back to measure true lift.` : ""}`);
  state.updatedAt = now;
  return plan;
}

export function approveAll(state: AccountState, now: ISODateTime): number {
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

/** Everything that should go out at `now`, after the Guard's checks. Pure: marks nothing. */
export function dueTouches(state: AccountState, now: ISODateTime): { due: DueTouch[]; held: { touch: Touch; why: string }[] } {
  const b = state.dataset.business;
  const local = now.slice(0, 16);
  const day = now.slice(0, 10);
  const due: DueTouch[] = [];
  const held: { touch: Touch; why: string }[] = [];
  const replied = new Set(state.replies.filter((r) => r.customerId).map((r) => r.customerId!));
  const health = sendHealth(state);
  for (const t of state.touches) {
    if (t.status !== "approved" || t.dueAt > local) continue;
    const c = customerById(state.dataset, t.customerId);
    const to = c?.emails.find((e) => !state.suppressions[e]);
    if (!c || !to) {
      held.push({ touch: t, why: "No sendable email (unsubscribed, bounced or missing)" });
      continue;
    }
    if (replied.has(c.id)) {
      held.push({ touch: t, why: "They replied — the sequence stops" });
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
  const day = at.slice(0, 10);
  const rec = outreachFor(state, t.customerId);
  if (rec) rec.lastTouchOn = day;
  else {
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

/* ------------------------------------------------------------------ */
/* Guard: reputation                                                   */
/* ------------------------------------------------------------------ */

export function sendHealth(state: AccountState): { sent: number; bounces: number; complaints: number; stops: number; bounceRate: number; complaintRate: number; paused: boolean; reason?: string } {
  const sent = state.touches.filter((t) => t.status === "sent" || t.status === "delivered" || t.status === "bounced").length;
  const bounces = state.replies.filter((r) => r.intent === "bounce").length + state.touches.filter((t) => t.status === "bounced").length;
  const complaints = state.replies.filter((r) => r.intent === "complaint").length;
  const stops = state.replies.filter((r) => r.intent === "stop").length;
  const bounceRate = sent ? bounces / sent : 0;
  const complaintRate = sent ? complaints / sent : 0;
  let reason: string | undefined;
  if (sent >= 50 && bounceRate > 0.04) reason = `Bounce rate ${(bounceRate * 100).toFixed(1)}% is over 4% — paused to protect your sending reputation. The list needs cleaning.`;
  else if (sent >= 100 && complaintRate > 0.003) reason = `Spam complaints hit ${(complaintRate * 100).toFixed(2)}% — paused. Gmail's limit is 0.3%.`;
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
  const base = readReply({ text: msg.text, subject: msg.subject, from: msg.from, asOf: now.slice(0, 10) });
  const reading = override
    ? { ...base, intent: override.intent, confidence: override.confidence, summary: override.summary ?? base.summary, extracted: { ...base.extracted, ...override.extracted } }
    : base;
  const email = extractEmails(msg.from)[0] ?? msg.from.toLowerCase();
  const c = customerByEmail(state.dataset, email);
  const touch = msg.inReplyTo
    ? state.touches.find((t) => t.providerId === msg.inReplyTo)
    : state.touches.filter((t) => t.customerId === c?.id && t.status === "sent").sort((a, b) => ((a.sentAt ?? "") < (b.sentAt ?? "") ? 1 : -1))[0];
  const r: Reply = {
    id: makeId("r", email, now, msg.text.slice(0, 40)),
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
    state.suppressions[email] = r.intent === "complaint" ? "complained" : "unsubscribed";
    if (c) stopSequence(state, c.id);
    r.status = "done";
    event(state, now, "guard", r.intent === "complaint" ? "warning" : "action", `${name} asked to stop — removed everywhere`, reading.summary, c ? [{ kind: "customer", id: c.id }] : undefined);
    if (r.intent === "complaint") ownerMsg(state, now, "info", `Heads up: ${name} was unhappy about the note. We removed them from everything. What they said: “${r.text.slice(0, 160)}”`);
    return r;
  }
  if (r.intent === "bounce") {
    state.suppressions[email] = "bounced";
    if (c) stopSequence(state, c.id);
    r.status = "done";
    event(state, now, "guard", "info", `Bad address for ${name} — removed`, email);
    return r;
  }
  if (r.intent === "auto_reply") {
    r.status = "done";
    event(state, now, "inbox", "info", `${name}: out-of-office reply`, "Sequence continues as planned.");
    return r;
  }
  if (c) stopSequence(state, c.id);

  if (r.intent === "wants_it" || r.intent === "wants_price" || r.intent === "question") {
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

/** Nudge the owner about hot leads nobody has called. */
export function chase(state: AccountState, now: ISODateTime, afterHours = 4): OwnerMessage[] {
  const out: OwnerMessage[] = [];
  for (const r of state.replies) {
    if (r.status !== "handed_off" || r.ownerContactedAt) continue;
    const hrs = (Date.parse(now) - Date.parse(r.handedOffAt ?? r.receivedAt)) / 3600000;
    const already = state.ownerMessages.filter((m) => m.kind === "sla_nudge" && m.refs?.some((x) => x.id === r.id)).length;
    const next = already === 0 ? afterHours : already === 1 ? 24 : Infinity;
    if (hrs >= next) {
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
  const found = attribute(state.dataset, state.outreach);
  const known = new Set(state.recoveries.map((r) => r.customerId));
  let added = 0;
  for (const r of found) {
    if (known.has(r.customerId)) continue;
    state.recoveries.push(r);
    added++;
    const name = state.dataset.customers.find((c) => c.id === r.customerId)?.name ?? "A customer";
    event(state, now, "ledger", "win", `${name} came back — ${fmtMoney(r.value)}`, `${r.lagDays ?? 0} days after the last note.`, [{ kind: "customer", id: r.customerId }]);
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
  if (!sent.length || pending.length) return undefined;
  const last = sent.map((t) => t.sentAt ?? t.dueAt).sort().pop()!;
  if (daysBetween(last.slice(0, 10), now.slice(0, 10)) < 7) return undefined;
  state.trialCompletedOn = last.slice(0, 10);
  const friday = addDays(now.slice(0, 10), (5 - weekday(now.slice(0, 10)) + 7) % 7 || 7);
  const text = closeMessage(state, { ...opts, sayYesBy: `Friday ${Number(friday.slice(8))}` });
  event(state, now, "reporter", "action", "Your free round is done — results sent", text.split("\n")[0]);
  return ownerMsg(state, now, "close", text);
}

export function billingCheck(state: AccountState, now: ISODateTime): OwnerMessage | undefined {
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
 * The owner texted "BUSY until <date>" (or "OPEN"). New-work sequences that haven't started yet move so
 * their first note lands about three weeks before the schedule opens; "OPEN" brings them back.
 * Sequences already under way are left alone — pausing mid-conversation reads strangely.
 */
export function setBookedOut(state: AccountState, until: string | undefined, now: ISODateTime): { moved: number } {
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
  return { moved };
}
