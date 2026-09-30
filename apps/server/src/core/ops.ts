import { createHmac, timingSafeEqual } from "node:crypto";
import {
  addDays,
  adoptTrade,
  bannedStatIn,
  playbook,
  answerNewRequests,
  answerTime,
  approveAll,
  counted,
  sendableEmail,
  setBookedOut,
  totals,
  customerById,
  daysBetween,
  detect,
  dueTouches,
  find,
  importTable,
  ledgerPass,
  leadCode,
  markContacted,
  markSent,
  mergePulled,
  oppById,
  parseTable,
  planBatch,
  quoteById,
  readReply,
  receiveReply,
  renewPlan,
  stopSequence,
  type AccountState,
  type FileIn,
  type Reply,
  type Touch,
} from "@qa/engine";
import type { Config } from "../config.ts";
import type { DirectProvider, FsmConnector, InboundEvent, OAuthTokens, OutboundProvider, OwnerNotifier, SequencedLead, SequencerProvider } from "../contracts.ts";
import { ProviderError } from "../contracts.ts";
import type { Llm } from "../agents/llm.ts";
import type { MailCheck } from "../providers/mailcheck.ts";
import { draftAnswer, readReplyWithClaude } from "../agents/replies.ts";
import { personalizeFirstNote } from "../agents/writer.ts";
import { suggestMapping } from "../agents/mapping.ts";
import type { Accounts } from "./accounts.ts";
import { localIso } from "./clock.ts";
import { decrypt, encrypt } from "./crypto.ts";

export interface Deps {
  cfg: Config;
  accounts: Accounts;
  email: OutboundProvider;
  notifier: OwnerNotifier;
  llm: Llm | null;
  fsm: Partial<Record<"jobber", FsmConnector>>;
  log: (msg: string) => void;
  /** Real instant (injectable for tests). */
  clock: () => Date;
  /** Pre-send "does this domain take mail?" check. Absent = skip (tests, or MAIL_CHECK=off). */
  mailCheck?: MailCheck;
}

/** False (and the address suppressed as bounced) when the domain can't receive mail. */
async function deliverable(d: Deps, bid: string, email: string): Promise<boolean> {
  if (!d.mailCheck) return true;
  const domain = email.split("@")[1] ?? "";
  if ((await d.mailCheck(domain)) !== "no_mail") return true;
  await suppress(d, bid, email, "bounced", `${domain} doesn't accept email — caught before sending.`);
  return false;
}

const MAX_SEND_ATTEMPTS = 5;

/* ------------------------------------------------------------------ */
/* Signed tokens (owner links, unsubscribe links, OAuth state)         */
/* ------------------------------------------------------------------ */

export function sign(secret: string, payload: string): string {
  const mac = createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 24);
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

export function verifySigned(secret: string, token: string): string | undefined {
  const [p, mac] = token.split(".");
  if (!p || !mac) return undefined;
  const payload = Buffer.from(p, "base64url").toString();
  const expected = createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 24);
  const a = Buffer.from(expected);
  const b = Buffer.from(mac);
  return a.length === b.length && timingSafeEqual(a, b) ? payload : undefined;
}

export function unsubscribeUrl(cfg: Config, businessId: string, email: string): string {
  return `${cfg.PUBLIC_URL.replace(/\/$/, "")}/u/${sign(cfg.APP_SECRET, `u|${businessId}|${email}`)}`;
}

function nowLocal(d: Deps, state: AccountState): string {
  return localIso(d.clock(), state.dataset.business.timezone);
}

/* ------------------------------------------------------------------ */
/* Reader: import files                                                */
/* ------------------------------------------------------------------ */

export async function importFiles(d: Deps, bid: string, files: FileIn[]): Promise<{ file: string; kind: string; source: string; accepted: number; rows: number; warnings: string[]; assisted: boolean }[]> {
  const out: { file: string; kind: string; source: string; accepted: number; rows: number; warnings: string[]; assisted: boolean }[] = [];
  // Mapping assist happens before taking the lock (it can take seconds).
  const prepared = await Promise.all(
    files.map(async (f) => {
      const table = parseTable(f.text);
      const detection = detect(table, f.name, f.kind);
      let assisted = false;
      const weak = detection.warnings.some((w) => /No (email|customer name|dollar amount|date)/.test(w)) || detection.kindConfidence < 0.5;
      if (weak && d.llm && table.rows.length) {
        const m = await suggestMapping(d.llm, table, detection);
        if (m) {
          detection.mapping.fields = { ...detection.mapping.fields, ...m };
          detection.warnings = detection.warnings.filter((w) => !Object.keys(m).some((field) => w.toLowerCase().includes(field === "total" ? "dollar" : field === "name" ? "name" : field)));
          assisted = true;
        }
      }
      return { f, table, detection, assisted };
    }),
  );
  await d.accounts.withAccount(bid, (state) => {
    const at = nowLocal(d, state);
    for (const p of prepared) {
      const { dataset, record } = importTable(state.dataset, p.table, p.detection, { fileName: p.f.name, importedAt: at });
      state.dataset = dataset;
      state.events.push({
        id: `ev_imp_${record.id}`,
        at,
        agent: "reader",
        kind: "action",
        title: `Read ${p.f.name}`,
        detail: `${record.accepted.toLocaleString("en-US")} ${record.kind} records from ${record.source}${p.assisted ? " (column matching checked by AI)" : ""}.`,
      });
      for (const w of record.warnings) state.events.push({ id: `ev_imp_${record.id}_${w.length}_${w.slice(0, 12)}`, at, agent: "reader", kind: "warning", title: w, detail: p.f.name });
      out.push({ file: p.f.name, kind: record.kind, source: record.source, accepted: record.accepted, rows: record.rows, warnings: record.warnings, assisted: p.assisted });
    }
    state.dataset.asOf = at.slice(0, 10);
    adoptTrade(state, at);
    ledgerPass(state, at);
  });
  d.accounts.repo.markScanned(bid, d.clock().toISOString());
  return out;
}

export async function rescan(d: Deps, bid: string): Promise<void> {
  await d.accounts.withAccount(bid, (state) => {
    const at = nowLocal(d, state);
    state.dataset.asOf = at.slice(0, 10);
    find(state, at);
  });
  d.accounts.repo.markScanned(bid, d.clock().toISOString());
}

/* ------------------------------------------------------------------ */
/* Writer + Sender: plan                                               */
/* ------------------------------------------------------------------ */

export async function plan(d: Deps, bid: string, opts: { startOn?: string; limit?: number; approve?: boolean } = {}): Promise<{ people: number; notes: number; firstDay?: string; lastDay?: string; personalized: number }> {
  let planned: Touch[] = [];
  const result = await d.accounts.withAccount(bid, (state) => {
    const at = nowLocal(d, state);
    const b = state.dataset.business;
    const startOn = opts.startOn ?? nextSendDay(state, at.slice(0, 10));
    const limit = opts.limit ?? (b.plan.stage === "trial" ? Math.max(0, b.plan.trialSize - startedPeople(state)) : undefined);
    if (limit === 0) return { people: 0, notes: 0, personalized: 0 };
    const p = planBatch(state, at, { startOn, limitPeople: limit, approve: opts.approve ?? true });
    planned = state.touches.filter((t) => p.touches.some((x) => x.id === t.id));
    return { people: p.people.length, notes: p.touches.length, firstDay: p.firstDay, lastDay: p.lastDay, personalized: 0 };
  });
  // AI personalization of first notes (optional), outside the lock, then written back.
  if (d.llm && d.cfg.AI_WRITER === "on" && planned.length) {
    const snapshot = d.accounts.peek(bid)!.state;
    // The shop's own strategy decides which first notes are worth a personal draft (all of them for a
    // big-ticket fence shop; only the bigger jobs on a small-ticket lawn route).
    const above = snapshot.summary?.profile?.strategy.personalizeAbove ?? 0;
    const firsts = planned.filter((t) => t.step === 1 && (oppById(snapshot.scan?.opportunities, t.opportunityId)?.value ?? 0) >= above);
    const rewrites = new Map<string, { subject: string; body: string; flags: string[] }>();
    for (const t of firsts.slice(0, 500)) {
      const o = oppById(snapshot.scan?.opportunities, t.opportunityId);
      if (!o) continue;
      const r = await personalizeFirstNote(d.llm, snapshot, o, t);
      if (r) rewrites.set(t.id, r);
    }
    if (rewrites.size) {
      await d.accounts.withAccount(bid, (state) => {
        for (const t of state.touches) {
          const r = rewrites.get(t.id);
          if (r && (t.status === "approved" || t.status === "planned")) {
            t.subject = r.subject;
            t.body = r.body;
            t.flags = r.flags;
            t.writer = "ai";
            // keep the thread subject consistent for follow-ups
            for (const f of state.touches) if (f.opportunityId === t.opportunityId && f.step > 1 && f.status !== "sent") f.subject = `Re: ${r.subject}`;
          }
        }
      });
    }
    result.personalized = rewrites.size;
  }
  return result;
}

function startedPeople(state: AccountState): number {
  return new Set(state.touches.filter((t) => t.step === 1 && t.status !== "cancelled").map((t) => t.customerId)).size;
}

export function nextSendDay(state: AccountState, from: string): string {
  const days = state.dataset.business.sendDays;
  for (let i = 1; i <= 14; i++) {
    const d = new Date(Date.parse(`${from}T12:00:00Z`) + i * 86400000);
    if (days.includes(d.getUTCDay())) return d.toISOString().slice(0, 10);
  }
  return from;
}

export async function approve(d: Deps, bid: string): Promise<number> {
  return d.accounts.withAccount(bid, (state) => approveAll(state, nowLocal(d, state)));
}

/* ------------------------------------------------------------------ */
/* Sender: send what's due                                             */
/* ------------------------------------------------------------------ */

export async function sendDue(d: Deps, bid: string, opts: { maxPerTick?: number } = {}): Promise<{ sent: number; failed: number; held: number }> {
  if (d.email.kind === "sequencer") return syncSequencer(d, bid, d.email);
  const provider = d.email;
  let sent = 0;
  let failed = 0;
  let held = 0;
  const loaded = d.accounts.peek(bid);
  if (!loaded || loaded.paused) return { sent, failed, held };
  const at0 = nowLocal(d, loaded.state);
  const { due, held: h } = dueTouches(loaded.state, at0);
  held = h.length;
  // Held because the person replied / unsubscribed: cancel them for good.
  const cancel = h.filter((x) => /replied|No sendable email/.test(x.why));
  if (cancel.length)
    await d.accounts.withAccount(bid, (state) => {
      for (const c of cancel) {
        const t = state.touches.find((x) => x.id === c.touch.id);
        if (t && t.status === "approved") t.status = "cancelled";
      }
    });
  for (const item of due.slice(0, opts.maxPerTick ?? 25)) {
    const state = loaded.state;
    const b = state.dataset.business;
    const t = item.touch;
    const prev = t.step > 1 ? state.touches.find((x) => x.opportunityId === t.opportunityId && x.step === 1 && x.providerId) : undefined;
    if (!(await deliverable(d, bid, item.to))) {
      held++;
      continue;
    }
    try {
      const res = await (provider as DirectProvider).send({
        businessId: bid,
        touchId: t.id,
        customerId: t.customerId,
        to: item.to,
        toName: item.customerName,
        fromName: `${b.signerName} at ${b.name}`,
        replyTo: b.replyTo,
        subject: t.subject ?? "",
        text: t.body,
        inReplyTo: prev?.providerId,
        references: prev?.providerId ? [prev.providerId] : undefined,
        unsubscribeUrl: unsubscribeUrl(d.cfg, bid, item.to),
      });
      await d.accounts.withAccount(bid, (s) => {
        const live = s.touches.find((x) => x.id === t.id);
        if (live && live.status === "approved") markSent(s, t.id, nowLocal(d, s), res.messageId ?? res.providerId);
      });
      sent++;
    } catch (e) {
      failed++;
      const err = e as ProviderError;
      await d.accounts.withAccount(bid, (s) => {
        const live = s.touches.find((x) => x.id === t.id);
        if (!live) return;
        live.attempts = (live.attempts ?? 0) + 1;
        live.lastError = err.message;
        const permanent = err instanceof ProviderError && !err.retryable;
        if (permanent || live.attempts >= MAX_SEND_ATTEMPTS) {
          live.status = "skipped";
          s.events.push({ id: `ev_sendfail_${t.id}`, at: nowLocal(d, s), agent: "guard", kind: "warning", title: `Couldn't send to ${item.customerName}`, detail: err.message });
        } else {
          // retry on the next tick after a short backoff
          const back = new Date(Date.parse(`${live.dueAt}:00Z`) + 5 * 60000 * live.attempts).toISOString().slice(0, 16);
          live.dueAt = back;
        }
      });
      d.log(`[send] ${bid} ${t.id} failed: ${err.message}`);
    }
  }
  return { sent, failed, held };
}

/**
 * Sequencer mode: push people whose first note is due within a week, with all their notes. An instant answer to
 * a new request goes to the business's instant campaign instead: the nurture campaign puts follow-ups first,
 * caps new leads a day and sends on weekdays only, so an evening request could wait days for its "thanks".
 */
export async function syncSequencer(d: Deps, bid: string, seq: SequencerProvider): Promise<{ sent: number; failed: number; held: number }> {
  const loaded = d.accounts.peek(bid);
  if (!loaded) return { sent: 0, failed: 0, held: 0 };
  const state = loaded.state;
  const b = state.dataset.business;
  const at = nowLocal(d, state);
  const horizon = new Date(Date.parse(`${at.slice(0, 10)}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const byLead = new Map<string, Touch[]>();
  for (const t of state.touches) {
    if (t.status !== "approved" || t.providerId) continue;
    const key = `${t.instant ? "instant" : "nurture"}|${t.customerId}`;
    (byLead.get(key) ?? byLead.set(key, []).get(key)!).push(t);
  }
  const groups = new Map<string, { instant: boolean; steps: number; leads: SequencedLead[] }>();
  // One person, one answer: a second request in the same sync doesn't get a second "thanks".
  const extra: string[] = [];
  for (const [key, all] of byLead) {
    const instant = key.startsWith("instant|");
    all.sort((x, y) => x.step - y.step || x.dueAt.localeCompare(y.dueAt));
    const inFlight = instant && state.touches.some((x) => x.instant && x.customerId === all[0]!.customerId && x.status === "approved" && x.providerId);
    const ts = inFlight ? [] : instant ? all.slice(0, 1) : all;
    if (instant) extra.push(...all.slice(ts.length).map((t) => t.id));
    if (!ts[0] || ts[0].step !== 1 || ts[0].dueAt.slice(0, 10) > horizon) continue;
    const c = customerById(state.dataset, ts[0].customerId);
    const email = c ? sendableEmail(c.emails, state.suppressions) : undefined;
    if (!c || !email) continue;
    if (!(await deliverable(d, bid, email))) continue;
    const lead: SequencedLead = {
      customerId: c.id,
      opportunityId: ts[0].opportunityId,
      email,
      firstName: c.firstName,
      lastName: c.lastName,
      companyName: c.companyName,
      notes: ts.map((t) => ({ touchId: t.id, step: t.step, subject: t.subject ?? "", body: t.body, dueAt: t.dueAt })),
    };
    const gk = instant ? "instant" : String(ts.length);
    (groups.get(gk) ?? groups.set(gk, { instant, steps: ts.length, leads: [] }).get(gk)!).leads.push(lead);
  }
  if (!groups.size || loaded.paused) return { sent: 0, failed: 0, held: 0 };
  let pushed = 0;
  let answers = 0;
  let failed = 0;
  const done = new Map<string, string>();
  for (const g of groups.values()) {
    try {
      const { campaignId } = await seq.ensureCampaign(b, g.instant ? { maxSteps: 1, instant: true } : { maxSteps: g.steps });
      const res = await seq.upsertLeads(b, campaignId, g.leads);
      const skipped = new Set(res.skipped.map((s) => s.email));
      for (const l of g.leads) if (!skipped.has(l.email)) for (const n of l.notes) done.set(n.touchId, `${seq.name}:${campaignId}:${l.email}:${n.step}`);
      if (g.instant) answers += g.leads.length - skipped.size;
      else pushed += g.leads.length - skipped.size;
    } catch (e) {
      failed += g.leads.length;
      d.log(`[sequencer] ${bid} push failed: ${(e as Error).message}`);
    }
  }
  if (done.size || extra.length)
    await d.accounts.withAccount(bid, (s) => {
      for (const t of s.touches) {
        const p = done.get(t.id);
        if (p && !t.providerId) t.providerId = p;
        if (extra.includes(t.id) && t.status === "approved") t.status = "cancelled";
      }
      if (pushed) s.events.push({ id: `ev_push_${at}`, at, agent: "sender", kind: "action", title: `Handed ${pushed} people to the sending platform`, detail: `Their notes go out on your schedule from your warmed-up mailboxes.` });
      if (answers) s.events.push({ id: `ev_push_instant_${at}`, at, agent: "sender", kind: "action", title: `Sent ${answers} ${answers === 1 ? "answer" : "answers"} to new requests to the sending platform`, detail: "They go out within minutes, 7am–8pm any day." });
    });
  return { sent: pushed + answers, failed, held: 0 };
}

/* ------------------------------------------------------------------ */
/* Inbox: inbound events                                               */
/* ------------------------------------------------------------------ */

/** Which business (and customer) an address belongs to; among several, the one that has written to them. */
export function whoIs(d: Deps, email: string): { businessId: string; customerId: string } | undefined {
  const hits = d.accounts.repo.businessesForEmail(email);
  if (hits.length <= 1) return hits[0];
  return hits.find((h) => d.accounts.peek(h.businessId)?.state.touches.some((t) => t.customerId === h.customerId && t.status === "sent")) ?? hits[0];
}

/**
 * Something about the sending platform needs a person (a broken mailbox, a webhook it switched off). It becomes a
 * warning in the activity of each client it affects — where the console already shows warnings — once a day.
 * Returns the clients warned; with none sending through the platform yet, it is only logged.
 */
export async function alertOperator(d: Deps, a: { key: string; title: string; detail: string; campaignId?: string; businessId?: string }): Promise<string[]> {
  d.log(`[alert] ${a.title} ${a.detail}`);
  const repo = d.accounts.repo;
  let bids = a.businessId && repo.exists(a.businessId) ? [a.businessId] : a.campaignId ? repo.businessesForProvider(`${d.email.name}:${a.campaignId}:`) : [];
  if (!bids.length) bids = repo.businessesForProvider(`${d.email.name}:`);
  for (const bid of bids)
    await d.accounts.withAccount(bid, (state) => {
      const at = nowLocal(d, state);
      const id = `ev_alert_${a.key}_${at.slice(0, 10)}`;
      if (!state.events.some((e) => e.id === id)) state.events.push({ id, at, agent: "guard", kind: "warning", title: a.title, detail: a.detail });
    });
  return bids;
}

/** Route a normalized inbound event to the right business and apply it. Returns the business id. */
export async function handleInbound(d: Deps, ev: InboundEvent): Promise<string | undefined> {
  if (ev.type === "account_error") {
    const who = ev.account ?? "a sending mailbox";
    await alertOperator(d, {
      key: `acct_${ev.account ?? "unknown"}`,
      title: `Instantly: ${who} has an error`,
      detail: `${ev.detail ? `${ev.detail} ` : ""}Notes from ${who} may not go out until it's fixed in Instantly.`,
      campaignId: ev.campaignId,
      businessId: ev.businessId,
    });
    return ev.businessId;
  }
  const email = (ev.type === "reply" ? ev.from : ev.email).toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/)?.[0];
  let bid = ev.businessId;
  if (!bid && email) bid = whoIs(d, email)?.businessId;
  if (!bid) {
    d.log(`[inbound] no business for ${email ?? "?"} (${ev.type})`);
    return undefined;
  }
  if (ev.type === "sent") {
    await d.accounts.withAccount(bid, (state) => {
      const open = (x: Touch) => x.status === "approved" || x.status === "planned";
      // The exact note: our qa_touch id, else the campaign + step we pushed it to, else their next queued note.
      let t = ev.touchId ? state.touches.find((x) => x.id === ev.touchId && open(x)) : undefined;
      if (!t && ev.campaignId && ev.step) t = state.touches.find((x) => open(x) && x.providerId === `${d.email.name}:${ev.campaignId}:${email}:${ev.step}`);
      if (!t) {
        const c = state.dataset.customers.find((x) => x.emails.includes(email!));
        if (!c) return;
        t = state.touches
          .filter((x) => x.customerId === c.id && open(x))
          .sort((a, b) => a.step - b.step)
          .find((x) => (ev.step ? x.step === ev.step : true));
      }
      if (!t) return;
      // When it actually went, per the platform, in local time: the weekly "answered within minutes" is measured on it.
      const at = localIso(new Date(ev.sentAt), state.dataset.business.timezone);
      // A sequencer's placeholder id names the campaign (pause and stop use it), so it stays.
      const keep = t.providerId?.startsWith(`${d.email.name}:`);
      markSent(state, t.id, at, keep ? t.providerId : (ev.providerId ?? t.providerId));
    });
    return bid;
  }
  if (ev.type === "reply") {
    // Rules read every reply; Claude gives a second opinion on every human one (the rules are ~83% right on
    // unseen mail, and a misread "yes" is a lost job). Clear stops, bounces and out-of-offices skip it.
    const rule = readReply({ text: ev.text, subject: ev.subject, from: ev.from, asOf: ev.receivedAt.slice(0, 10) });
    let override = undefined;
    const mechanical = ["stop", "bounce", "auto_reply"].includes(rule.intent) && rule.confidence >= 0.9;
    if (d.llm && !mechanical) {
      const b = d.accounts.peek(bid)?.state.dataset.business;
      override = (await readReplyWithClaude(d.llm, { text: rule.cleaned || ev.text, subject: ev.subject, today: ev.receivedAt.slice(0, 10), businessName: b?.name ?? "" })) ?? undefined;
      if (override) override = settleReading(rule.intent, override);
    }
    let reply: Reply | undefined;
    let note: FsmNote | undefined;
    await d.accounts.withAccount(bid, (state) => {
      // the engine reasons in the business's local time ("call you today" depends on it)
      const local = localIso(new Date(ev.receivedAt), state.dataset.business.timezone).slice(0, 19);
      reply = receiveReply(state, { from: ev.from, subject: ev.subject, text: ev.text, receivedAt: local, inReplyTo: ev.inReplyTo }, override);
      if (reply) reply.thread = { subject: ev.subject, messageId: ev.messageId, replyEmailId: ev.replyEmailId, toAccount: ev.toAccount };
      if (reply && !["auto_reply", "bounce"].includes(reply.intent)) {
        const name = customerById(state.dataset, reply.customerId)?.name ?? reply.from;
        note = fsmNote(state, reply.customerId, reply.opportunityId, `Quiet Accounts: ${name} replied to our follow-up (${INTENT_WORDS[reply.intent] ?? "replied"}): "${oneLine(reply.text, 400)}"`);
      }
    });
    if (note) queueFsmNote(d, bid, note);
    const hot = reply as Reply | undefined;
    // a question gets a specific answer drafted for one-click sending (grounded only in what we know)
    if (hot && hot.intent === "question" && d.llm) {
      const st = d.accounts.peek(bid)?.state;
      const b = st?.dataset.business;
      const o = st ? oppById(st.scan?.opportunities, hot.opportunityId) : undefined;
      if (b && st) {
        const services = [b.trade, ...b.otherTrades].flatMap((t) => playbook(t).services.map((sv) => sv.label.toLowerCase()));
        const draft = await draftAnswer(d.llm, { question: hot.text, job: o?.jobPhrase ?? "their project", businessName: b.name, signer: b.signerName, services }).catch(() => null);
        if (draft?.draft && !bannedStatIn(draft.draft))
          await d.accounts.withAccount(bid, (s) => {
            const live = s.replies.find((x) => x.id === hot.id);
            if (live) live.draft = { text: draft.draft, needsOwner: draft.needsOwner, at: nowLocal(d, s) };
          });
      }
    }
    if (hot?.ack && !hot.ack.sentAt) {
      const task = { replyId: hot.id, to: email ?? ev.from, subject: ev.subject ?? "", messageId: ev.messageId ?? "", replyEmailId: ev.replyEmailId ?? "", toAccount: ev.toAccount ?? "" };
      const tz = d.accounts.peek(bid)?.state.dataset.business.timezone ?? "America/New_York";
      const local = localIso(d.clock(), tz);
      const at = answerTime(local);
      if (at === local) await sendAck(d, bid, task);
      else {
        // nobody wants a 2am "thanks": it goes at 7:00 local, like the answer to a new request
        const wait = Date.parse(`${at}Z`) - Date.parse(`${local}Z`);
        d.accounts.repo.enqueue("reply.ack", task, { businessId: bid, runAt: new Date(d.clock().getTime() + wait).toISOString() });
      }
    }
    if (reply && d.email.kind === "sequencer" && email) {
      const r = reply as Reply;
      const reason = r.intent === "stop" ? "unsubscribed" : r.intent === "complaint" ? "complained" : r.intent === "bounce" ? "bounced" : "replied";
      await stopEverywhere(d, bid, email, reason);
      // A spouse or a forward answered: Instantly saw no reply from the lead, so their own sequence is stopped too.
      if (r.intent !== "auto_reply" && r.intent !== "bounce") {
        const st = d.accounts.peek(bid)?.state;
        const lead = st ? customerById(st.dataset, r.customerId) : undefined;
        for (const other of lead?.emails ?? []) if (other !== email) await stopEverywhere(d, bid, other, "replied");
      }
    }
    await deliverOwnerMessages(d, bid);
    return bid;
  }
  // bounce / unsubscribe / complaint
  const reason = ev.type === "bounce" ? "bounced" : ev.type === "unsubscribe" ? "unsubscribed" : "complained";
  await suppress(d, bid, email!, reason, ev.type === "bounce" ? ev.detail : undefined);
  return bid;
}

export async function suppress(d: Deps, bid: string, email: string, reason: "unsubscribed" | "bounced" | "complained", detail?: string): Promise<void> {
  await d.accounts.withAccount(bid, (state) => {
    state.suppressions[email] = reason;
    const c = state.dataset.customers.find((x) => x.emails.includes(email));
    const n = c ? stopSequence(state, c.id) : 0;
    state.events.push({
      id: `ev_sup_${email}_${reason}`,
      at: nowLocal(d, state),
      agent: "guard",
      kind: reason === "complained" ? "warning" : "action",
      title: reason === "bounced" ? `Bad address for ${c?.name ?? email} — removed` : `${c?.name ?? email} ${reason === "complained" ? "complained" : "unsubscribed"} — removed everywhere`,
      detail: [detail, n ? `${n} queued notes cancelled.` : ""].filter(Boolean).join(" "),
    });
  });
  if (d.email.kind === "sequencer") await stopEverywhere(d, bid, email, reason);
}

async function stopEverywhere(d: Deps, bid: string, email: string, reason: "replied" | "unsubscribed" | "bounced" | "complained"): Promise<void> {
  if (d.email.kind !== "sequencer") return;
  const state = d.accounts.peek(bid)?.state;
  if (!state) return;
  const campaigns = new Set(state.touches.filter((t) => t.providerId?.startsWith(`${d.email.name}:`) && t.providerId.includes(`:${email}:`)).map((t) => t.providerId!.split(":")[1]!));
  for (const campaignId of campaigns) {
    try {
      await d.email.stopLead(state.dataset.business, campaignId, email, reason);
    } catch (e) {
      d.log(`[sequencer] stopLead ${email} failed: ${(e as Error).message}`);
      d.accounts.repo.enqueue("sequencer.stop", { bid, email, reason, campaignId }, { businessId: bid, runAt: new Date(d.clock().getTime() + 5 * 60000).toISOString() });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Dispatcher: owner texts in and out                                  */
/* ------------------------------------------------------------------ */

const BILLING_KINDS = new Set(["close", "precharge", "free_month"]);

export async function deliverOwnerMessages(d: Deps, bid?: string, opts: { allowBilling?: boolean } = {}): Promise<number> {
  let n = 0;
  for (const m of d.accounts.repo.pendingOwnerMessages(100)) {
    if (bid && m.business_id !== bid) continue;
    const loaded = d.accounts.peek(m.business_id);
    if (!loaded) continue;
    const b = loaded.state.dataset.business;
    if (BILLING_KINDS.has(m.kind) && d.cfg.AUTO_SEND_BILLING_TEXTS !== "true" && !opts.allowBilling) {
      d.accounts.repo.markOwnerMessage(m.business_id, m.id, "review");
      continue;
    }
    try {
      const res = await d.notifier.notify({ phone: b.ownerPhone, email: b.ownerEmail }, m.text);
      d.accounts.repo.markOwnerMessage(m.business_id, m.id, "sent", { channel: res.channel, providerId: res.id, at: d.clock().toISOString() });
      n++;
    } catch (e) {
      d.accounts.repo.markOwnerMessage(m.business_id, m.id, "failed", { error: (e as Error).message });
      d.log(`[owner] ${m.business_id} message ${m.id} failed: ${(e as Error).message}`);
    }
  }
  return n;
}

export interface OwnerCommandResult {
  businessId?: string;
  reply: string;
}

/**
 * The owner never has to open the dashboard: they answer the hand-off text.
 * "booked 2400" · "booked 2400 #K7Q" · "done" · "no" · "quoted" · "pause" · "resume" · "status".
 */
export async function ownerCommand(d: Deps, fromPhone: string, text: string): Promise<OwnerCommandResult> {
  const digits = fromPhone.replace(/\D/g, "").slice(-10);
  const business = d.accounts.repo.listBusinesses().find((b) => (b.profile.ownerPhone ?? "").replace(/\D/g, "").slice(-10) === digits);
  if (!business) return { reply: "We don't recognize this number. Text from the phone we have on file for you." };
  const bid = business.id;
  const t = text.trim().toLowerCase();
  if (/^(pause|stop sending|hold)\b/.test(t)) {
    d.accounts.setPaused(bid, true);
    return { businessId: bid, reply: "Paused. No notes will go out until you text RESUME." };
  }
  if (/^(resume|start|unpause|go)\b/.test(t)) {
    d.accounts.setPaused(bid, false);
    return { businessId: bid, reply: "Back on. Notes resume on your next send day." };
  }
  if (/^(status|how|numbers)\b/.test(t)) {
    const s = d.accounts.peek(bid)!.state;
    const wants = s.replies.filter((r) => r.intent === "wants_it" || r.intent === "wants_price").length;
    const booked = counted(s.recoveries).reduce((a, r) => a + r.value, 0);
    return { businessId: bid, reply: `So far: ${s.touches.filter((x) => x.status === "sent").length} notes out, ${wants} asked for a price or a date, $${Math.round(booked).toLocaleString("en-US")} booked.` };
  }
  // Yearly plans: RENEW keeps the year, MONTHLY goes month to month. YEARLY switches a monthly plan over.
  if (/^(renew|yearly|annual|monthly|month to month)\b/.test(t)) {
    const choice = /^(monthly|month to month)/.test(t) ? "monthly" : "year";
    let reply = "";
    await d.accounts.withAccount(bid, (state) => {
      reply = renewPlan(state, choice, nowLocal(d, state));
    });
    d.accounts.setPaused(bid, false);
    return { businessId: bid, reply: choice === "year" ? `${reply} Jack will text you the payment link.` : reply };
  }
  // Month to month, cancel by text. The first CANCEL shows the facts; CANCEL YES does it.
  if (/^cancel\b/.test(t)) {
    const s = d.accounts.peek(bid)!.state;
    if (s.dataset.business.plan.stage === "cancelled") return { businessId: bid, reply: "You're already cancelled. Text START if you ever want us back." };
    if (!/^cancel\s+(yes|confirm)\b/.test(t)) {
      const tt = totals(s);
      const open = new Set(s.touches.filter((x) => x.status === "approved" || x.status === "planned").map((x) => x.customerId)).size;
      return {
        businessId: bid,
        reply: `No problem. So far: ${tt.booked} booked, $${Math.round(tt.bookedValue).toLocaleString("en-US")} traced. Cancelling stops notes to ${open} ${open === 1 ? "person" : "people"} still in line; everything we found stays yours. Text CANCEL YES to confirm.`,
      };
    }
    await d.accounts.withAccount(bid, (state) => {
      const at = nowLocal(d, state);
      state.dataset.business.plan.stage = "cancelled";
      let n = 0;
      for (const x of state.touches) if (x.status === "approved" || x.status === "planned") (x.status = "cancelled"), n++;
      state.events.push({ id: `ev_cancel_${at}`, at, agent: "guard", kind: "warning", title: "Owner cancelled by text", detail: `${n} queued notes stopped. No further charges.` });
    });
    d.accounts.setPaused(bid, true);
    d.accounts.repo.audit(bid, "owner-sms", "cancel", {});
    return { businessId: bid, reply: "Done — cancelled. No more notes and no more charges. Your ledger link keeps working, and your data is yours to take. Thanks for giving us a shot." };
  }
  // "BUSY until Nov 15" / "busy 6 weeks" / "OPEN": new work waits for room on the schedule.
  if (/^(busy|booked (out|solid|up)|slammed|full)\b/.test(t) && !/\$|\b\d{3,}\b(?!\s*(\/|-))/.test(t.replace(/\b(19|20)\d\d\b/, ""))) {
    let reply = "";
    await d.accounts.withAccount(bid, (state) => {
      const today = nowLocal(d, state).slice(0, 10);
      const until = parseBusyUntil(t, today);
      const r = setBookedOut(state, until, nowLocal(d, state));
      reply = `Got it — new work waits until you have room. We'll start writing to those folks around ${fmtDay(addDays(until, -21))} so replies land when you can take them.${r.moved ? ` Moved ${r.moved} ${r.moved === 1 ? "person" : "people"} already queued.` : ""} Text OPEN when things free up.`;
    });
    return { businessId: bid, reply };
  }
  if (/^(open|not busy|free|room|slow)\b/.test(t)) {
    let reply = "";
    await d.accounts.withAccount(bid, (state) => {
      const r = setBookedOut(state, undefined, nowLocal(d, state));
      reply = `Great — new work is back on.${r.moved ? ` ${r.moved} ${r.moved === 1 ? "person" : "people"} we'd held will hear from us on your next send day.` : ""}`;
    });
    return { businessId: bid, reply };
  }
  const code = text.match(/#\s?([A-Z0-9]{3})\b/i)?.[1]?.toUpperCase();
  const amount = Number((text.match(/\$?\s?(\d[\d,]*(?:\.\d{1,2})?)\s?(k)?\b/i)?.[1] ?? "").replace(/,/g, "")) * (/\d\s?k\b/i.test(text) ? 1000 : 1);
  let outcome: Reply["outcome"] | undefined;
  if (/\b(booked|sold|won|scheduled|yes)\b/.test(t)) outcome = "booked";
  else if (/\b(quoted|sent (a |the )?price|requoted|sent quote)\b/.test(t)) outcome = "quoted";
  else if (/\b(no answer|voicemail|vm|left (a )?message)\b/.test(t)) outcome = "no_answer";
  else if (/\b(no|lost|pass|dead|not a fit|nope|went with)\b/.test(t)) outcome = "lost";
  else if (/\b(done|called|talked|reached|spoke)\b/.test(t)) outcome = undefined;
  else return { businessId: bid, reply: 'Text BOOKED + amount (like "booked 2400"), DONE, NO, or QUOTED. Add the #code from the lead text if you have more than one waiting.' };

  let reply = "";
  let note: FsmNote | undefined;
  await d.accounts.withAccount(bid, (state) => {
    const waiting = state.replies.filter((r) => r.status === "handed_off" && !r.ownerContactedAt).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
    const target = code ? waiting.find((r) => leadCode(r.id) === code) ?? state.replies.find((r) => leadCode(r.id) === code) : waiting[0];
    if (!target) {
      reply = code ? `No lead with #${code}.` : "Nobody's waiting on a call right now.";
      return;
    }
    const at = nowLocal(d, state);
    markContacted(state, target.id, at, outcome, outcome === "booked" && amount > 0 ? amount : undefined);
    const name = state.dataset.customers.find((c) => c.id === target.customerId)?.name ?? target.from;
    if (outcome === "booked" || outcome === "quoted")
      note = fsmNote(state, target.customerId, target.opportunityId, `Quiet Accounts: owner marked ${name} ${outcome === "booked" ? `booked${amount > 0 ? ` ($${amount.toLocaleString("en-US")})` : ""}` : "quoted"} after they answered our follow-up.`);
    reply =
      outcome === "booked"
        ? amount > 0
          ? `Booked: ${name}, $${amount.toLocaleString("en-US")}. Added to your results.`
          : `Booked: ${name}. What's the job worth? Text "booked 2400 #${leadCode(target.id)}".`
        : outcome === "quoted"
          ? `Got it — ${name} has a price. We'll count it when it books.`
          : outcome === "lost"
            ? `Got it — ${name} marked not a fit.`
            : outcome === "no_answer"
              ? `Got it — no answer from ${name}. Try again tomorrow.`
              : `Thanks — ${name} marked as reached.`;
    const left = waiting.filter((r) => r.id !== target.id).length;
    if (left) reply += ` ${left} more waiting.`;
  });
  if (note) queueFsmNote(d, bid, note);
  return { businessId: bid, reply };
}

/* ------------------------------------------------------------------ */
/* Unsubscribe links                                                   */
/* ------------------------------------------------------------------ */

export async function unsubscribeByToken(d: Deps, token: string): Promise<{ ok: boolean; business?: string }> {
  const payload = verifySigned(d.cfg.APP_SECRET, token);
  if (!payload?.startsWith("u|")) return { ok: false };
  const [, bid, email] = payload.split("|");
  if (!bid || !email || !d.accounts.repo.exists(bid)) return { ok: false };
  await suppress(d, bid, email, "unsubscribed", "Clicked the unsubscribe link.");
  return { ok: true, business: d.accounts.peek(bid)?.state.dataset.business.name };
}

/* ------------------------------------------------------------------ */
/* Ledger: field-service software sync                                 */
/* ------------------------------------------------------------------ */

export async function syncFsm(d: Deps, bid: string, kind: "jobber"): Promise<{ records: number; newRecoveries: number } | undefined> {
  const conn = d.fsm[kind];
  const integ = d.accounts.repo.getIntegration(bid, kind);
  if (!conn || !integ?.secret || integ.status === "disconnected" || integ.status === "needs_reconnect") return undefined;
  let tokens = JSON.parse(decrypt(d.cfg.APP_SECRET, integ.secret)) as OAuthTokens;
  if (tokens.expiresAt && Date.parse(tokens.expiresAt) - d.clock().getTime() < 5 * 60000 && tokens.refreshToken) {
    tokens = await conn.refresh(tokens);
    d.accounts.repo.putIntegration(bid, kind, { secret: encrypt(d.cfg.APP_SECRET, JSON.stringify(tokens)) });
  }
  try {
    const pulled = await conn.pull(tokens, { since: integ.cursor ?? undefined, onProgress: (m) => d.log(`[${kind}] ${bid} ${m}`) });
    // Jobber rotates refresh tokens: the old one is dead the moment a new one is issued.
    const fresh = (pulled as { tokens?: OAuthTokens }).tokens;
    if (fresh) d.accounts.repo.putIntegration(bid, kind, { secret: encrypt(d.cfg.APP_SECRET, JSON.stringify(fresh)) });
    let newRecoveries = 0;
    let answered = 0;
    await d.accounts.withAccount(bid, (state) => {
      const at = nowLocal(d, state);
      state.dataset = mergePulled(state.dataset, pulled, kind);
      state.dataset.asOf = at.slice(0, 10);
      // always-on: a request that just came in gets its answer now, not tomorrow
      answered = answerNewRequests(state, at);
      const n = pulled.customers.length + pulled.quotes.length + pulled.jobs.length + pulled.invoices.length + pulled.requests.length;
      if (n) state.events.push({ id: `ev_sync_${at}`, at, agent: "reader", kind: "action", title: `Synced ${n.toLocaleString("en-US")} records from ${kind === "jobber" ? "Jobber" : kind}`, detail: pulled.warnings.join(" ") || undefined });
      newRecoveries = ledgerPass(state, at).newRecoveries;
    });
    d.accounts.repo.putIntegration(bid, kind, { cursor: pulled.nextSince ?? integ.cursor, lastSyncAt: d.clock().toISOString(), lastError: null, status: "connected" });
    d.accounts.repo.markScanned(bid, d.clock().toISOString());
    await deliverOwnerMessages(d, bid);
    if (answered) await sendDue(d, bid);
    return { records: pulled.customers.length + pulled.quotes.length + pulled.jobs.length + pulled.invoices.length + pulled.requests.length, newRecoveries };
  } catch (e) {
    const err = e as ProviderError;
    const dead = err instanceof ProviderError && !err.retryable && (err.status === 400 || err.status === 401 || /invalid_grant|unauthori[sz]ed|token/i.test(err.message));
    d.accounts.repo.putIntegration(bid, kind, { lastError: err.message, ...(dead ? { status: "needs_reconnect" } : {}) });
    if (dead) await askToReconnect(d, bid);
    throw e;
  }
}

/**
 * Jobber cut us off (a password change, a revoked app). Nothing stalls quietly: the owner gets a one-tap
 * reconnect link — at most once a week — and the work carries on from the last sync meanwhile.
 */
async function askToReconnect(d: Deps, bid: string): Promise<void> {
  const link = `${d.cfg.PUBLIC_URL.replace(/\/$/, "")}/oauth/jobber/start?state=${encodeURIComponent(sign(d.cfg.APP_SECRET, `oauth|jobber|${bid}`))}`;
  await d.accounts.withAccount(bid, (state) => {
    const at = nowLocal(d, state);
    const recent = state.ownerMessages.some((m) => m.kind === "info" && m.refs?.some((r) => r.kind === "reconnect") && daysBetween(m.at.slice(0, 10), at.slice(0, 10)) < 7);
    if (recent) return;
    const b = state.dataset.business;
    state.ownerMessages.push({
      id: `om_reconnect_${at}`,
      at,
      kind: "info",
      text: `${b.ownerFirstName}, Jobber logged us out (that happens after a password change). One tap to reconnect — about 10 seconds: ${link}\n\nUntil then we keep working from your last sync.`,
      refs: [{ kind: "reconnect", id: "jobber" }],
    });
    state.events.push({ id: `ev_reconnect_${at}`, at, agent: "guard", kind: "warning", title: "Jobber disconnected — owner sent a reconnect link", detail: "New requests and quote updates pause until they reconnect." });
  });
  await deliverOwnerMessages(d, bid);
}

/* ------------------------- notes back into Jobber ------------------------- */

export interface FsmNote {
  kind: "quote" | "client";
  sourceId: string;
  text: string;
}

const INTENT_WORDS: Record<string, string> = {
  wants_it: "wants it done",
  wants_price: "wants a price",
  question: "has a question",
  later: "not right now",
  already_done: "already had it done",
  not_interested: "not interested",
  moved: "moved",
  wrong_person: "wrong person",
  stop: "asked us to stop",
  complaint: "complained",
  unclear: "needs a look",
};

const HOT = new Set(["wants_it", "wants_price", "question"]);

/**
 * When the rules and Claude disagree, take the reading that costs least to be wrong about:
 * a stop or complaint always stands (either reader), and a possible "yes" is never dropped.
 */
export function settleReading<T extends { intent: string }>(ruleIntent: string, claude: T): T | undefined {
  if (ruleIntent === "stop" || ruleIntent === "complaint") return undefined;
  if (claude.intent === "stop" || claude.intent === "complaint") return claude;
  if (HOT.has(ruleIntent) && !HOT.has(claude.intent)) return undefined;
  return claude;
}

/** Jobber's API ids are base64 "gid://..." strings; CSV ids are plain numbers or names. */
const isJobberGid = (s: string) => /^Z2lk/.test(s);

/** Where in Jobber a note about this person belongs: the quote we followed up on, else the client. */
export function fsmNote(state: AccountState, customerId: string | undefined, opportunityId: string | undefined, text: string): FsmNote | undefined {
  const o = oppById(state.scan?.opportunities, opportunityId);
  if (o?.source.kind === "quote") {
    const q = quoteById(state.dataset, o.source.id);
    const id = q?.sourceId && isJobberGid(q.sourceId) ? q.sourceId : q?.number;
    if (id) return { kind: "quote", sourceId: id, text };
  }
  const cid = customerById(state.dataset, customerId)?.sourceIds.find((x) => x.startsWith("jobber:"))?.slice("jobber:".length);
  if (cid && isJobberGid(cid)) return { kind: "client", sourceId: cid, text };
  return undefined;
}

/** Queued so webhooks stay fast; the worker writes it (and retries) when Jobber is connected. */
export function queueFsmNote(d: Deps, bid: string, note: FsmNote): void {
  // Read-only unless the app has been granted a write scope and the operator turned notes on.
  if (d.cfg.JOBBER_WRITE_NOTES !== "on" || !d.fsm.jobber?.writeNote) return;
  const integ = d.accounts.repo.getIntegration(bid, "jobber");
  if (!integ?.secret || integ.status !== "connected") return;
  d.accounts.repo.enqueue("jobber.note", { ...note }, { businessId: bid });
}

export async function writeFsmNote(d: Deps, bid: string, note: FsmNote): Promise<void> {
  const conn = d.fsm.jobber;
  const integ = d.accounts.repo.getIntegration(bid, "jobber");
  if (d.cfg.JOBBER_WRITE_NOTES !== "on" || !conn?.writeNote || !integ?.secret || integ.status !== "connected") return;
  const tokens = JSON.parse(decrypt(d.cfg.APP_SECRET, integ.secret)) as OAuthTokens;
  await conn.writeNote(tokens, { kind: note.kind, sourceId: note.sourceId }, note.text);
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "until nov 15", "6 weeks", "2 months", "11/15", "till december" → a date; plain "busy" = four weeks. */
export function parseBusyUntil(t: string, today: string): string {
  const n = (re: RegExp) => Number(t.match(re)?.[1]);
  const weeks = n(/(\d+)\s*(weeks?|wks?)\b/);
  if (weeks) return addDays(today, weeks * 7);
  const days = n(/(\d+)\s*days?\b/);
  if (days) return addDays(today, days);
  const months = n(/(\d+)\s*(months?|mos?)\b/);
  if (months) return addDays(today, Math.round(months * 30.44));
  const [y, m0, d0] = today.split("-").map(Number) as [number, number, number];
  const pick = (month: number, day: number) => {
    const iso = (yy: number) => `${yy}-${String(month).padStart(2, "0")}-${String(Math.min(day, 28 + (month === 2 ? 0 : 3))).padStart(2, "0")}`;
    return iso(y) > today ? iso(y) : iso(y + 1);
  };
  const named = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})?/);
  if (named) return pick(MONTHS.indexOf(named[1]!) + 1, named[2] ? Number(named[2]) : 1);
  const md = t.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (md && Number(md[1]) <= 12) return pick(Number(md[1]), Number(md[2]));
  void m0;
  void d0;
  return addDays(today, 28);
}

function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}`;
}

/* ------------------------- instant answer to hot replies ------------------------- */

export interface AckTask {
  replyId: string;
  to: string;
  subject: string;
  messageId: string;
  replyEmailId: string;
  toAccount: string;
}

/** Send the instant answer in the homeowner's thread. Failures are recorded; the owner's text already went. */
export async function sendAck(d: Deps, bid: string, task: AckTask): Promise<void> {
  const state = d.accounts.peek(bid)?.state;
  const r = state?.replies.find((x) => x.id === task.replyId);
  if (!state || !r?.ack || r.ack.sentAt) return;
  if (r.ownerContactedAt) return; // the owner already got to them — no need
  const b = state.dataset.business;
  const subject = /^re:/i.test(task.subject) ? task.subject : `Re: ${task.subject || "your note"}`;
  let error: string | undefined;
  try {
    if (d.email.kind === "direct") {
      const c = customerById(state.dataset, r.customerId);
      await d.email.send({
        businessId: bid,
        touchId: `ack_${r.id}`,
        customerId: r.customerId ?? "",
        to: task.to,
        toName: c?.name ?? "",
        fromName: `${b.signerName} at ${b.name}`,
        replyTo: b.replyTo,
        subject,
        text: r.ack.text,
        inReplyTo: task.messageId || undefined,
        references: task.messageId ? [task.messageId] : undefined,
      });
    } else if (d.email.replyTo && task.replyEmailId && task.toAccount) {
      await d.email.replyTo(b, { replyEmailId: task.replyEmailId, account: task.toAccount, to: task.to, subject }, r.ack.text);
    } else {
      error = "No thread to answer in";
    }
  } catch (e) {
    error = (e as Error).message;
  }
  await d.accounts.withAccount(bid, (s) => {
    const live = s.replies.find((x) => x.id === r.id);
    if (!live?.ack) return;
    if (error) live.ack.error = error;
    else {
      live.ack.sentAt = nowLocal(d, s);
      live.answers = [...(live.answers ?? []), { text: live.ack.text, at: live.ack.sentAt, by: "auto" }];
    }
  });
  if (error) d.log(`[ack] ${bid} ${r.id}: ${error}`);
}

/**
 * Write back to a homeowner in their own thread — from the console (typed or a one-click draft) or the
 * instant answer. Direct mail threads under their Message-ID; Instantly answers from the receiving mailbox.
 */
export async function answerInThread(d: Deps, bid: string, replyId: string, text: string, by: "auto" | "operator" | "owner"): Promise<{ ok: boolean; error?: string }> {
  const state = d.accounts.peek(bid)?.state;
  const r = state?.replies.find((x) => x.id === replyId);
  if (!state || !r) return { ok: false, error: "No such reply" };
  const clean = text.trim();
  if (!clean) return { ok: false, error: "Nothing to send" };
  const banned = bannedStatIn(clean);
  if (banned) return { ok: false, error: `Remove the unsourced stat first: ${banned}` };
  if (state.suppressions[r.from]) return { ok: false, error: "They asked us to stop — nothing more goes to them." };
  const b = state.dataset.business;
  const subject0 = r.thread?.subject ?? "your note";
  const subject = /^re:/i.test(subject0) ? subject0 : `Re: ${subject0}`;
  try {
    if (d.email.kind === "direct") {
      await d.email.send({
        businessId: bid,
        touchId: `ans_${r.id}_${(r.answers?.length ?? 0) + 1}`,
        customerId: r.customerId ?? "",
        to: r.from,
        toName: customerById(state.dataset, r.customerId)?.name ?? "",
        fromName: `${b.signerName} at ${b.name}`,
        replyTo: b.replyTo,
        subject,
        text: clean,
        inReplyTo: r.thread?.messageId || undefined,
        references: r.thread?.messageId ? [r.thread.messageId] : undefined,
      });
    } else if (d.email.replyTo && r.thread?.replyEmailId && r.thread.toAccount) {
      await d.email.replyTo(b, { replyEmailId: r.thread.replyEmailId, account: r.thread.toAccount, to: r.from, subject }, clean);
    } else return { ok: false, error: "No thread to answer in" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  await d.accounts.withAccount(bid, (s) => {
    const live = s.replies.find((x) => x.id === replyId);
    if (!live) return;
    const at = nowLocal(d, s);
    live.answers = [...(live.answers ?? []), { text: clean, at, by }];
    if (live.draft && by !== "auto") live.draft = undefined;
  });
  return { ok: true };
}
