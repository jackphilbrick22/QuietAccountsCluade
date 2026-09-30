import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
  type BusinessProfile,
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

/**
 * Owner, import and Jobber-connect links carry the business's random link key, so one client's links can be
 * rotated (a departed office manager, a forwarded text) without touching APP_SECRET — which would also break every
 * unsubscribe link already sent and the stored Jobber tokens. A deleted-then-recreated business id gets a new key,
 * so the old tenant's links don't carry over. Links made before keys existed keep working until the first rotation.
 */
export type LinkKind = "owner" | "import" | "oauth|jobber";

export function linkToken(d: Deps, kind: LinkKind, bid: string): string {
  const key = d.accounts.repo.linkKey(bid);
  return sign(d.cfg.APP_SECRET, key ? `${kind}|${bid}|${key}` : `${kind}|${bid}`);
}

/** The business a link belongs to, or undefined when it's forged, rotated away, or its business is gone. */
export function readLinkToken(d: Deps, kind: LinkKind, token: string): string | undefined {
  const payload = verifySigned(d.cfg.APP_SECRET, token);
  if (!payload?.startsWith(`${kind}|`)) return undefined;
  const [bid, key, ...rest] = payload.slice(kind.length + 1).split("|");
  if (!bid || rest.length || !d.accounts.repo.exists(bid)) return undefined;
  return (key ?? undefined) === d.accounts.repo.linkKey(bid) ? bid : undefined;
}

/** New links for one client; every link given out before stops working. */
export function rotateLinks(d: Deps, bid: string): void {
  d.accounts.repo.setLinkKey(bid, randomBytes(9).toString("base64url"));
}

export function ownerLink(d: Deps, bid: string): string {
  return `${d.cfg.PUBLIC_URL.replace(/\/$/, "")}/o/${linkToken(d, "owner", bid)}`;
}

export function connectJobberLink(d: Deps, bid: string): string {
  return `${d.cfg.PUBLIC_URL.replace(/\/$/, "")}/oauth/jobber/start?state=${encodeURIComponent(linkToken(d, "oauth|jobber", bid))}`;
}

/** Who a client's mail comes from: their own name and address when set, else "<signer> at <business>" from the server's sender. */
export function sender(b: BusinessProfile): { fromName: string; fromEmail?: string; replyTo?: string } {
  return { fromName: b.fromName?.trim() || `${b.signerName} at ${b.name}`, fromEmail: b.fromEmail?.trim() || undefined, replyTo: b.replyTo };
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
    const rewrites = new Map<string, { subject: string; body: string }>();
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
        ...sender(b),
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

/** Twilio refuses a number that texted STOP (error 21610): the owner is opted out at the carrier. */
const CARRIER_OPTED_OUT = /\b21610\b|unsubscribed recipient/i;

/**
 * Owner messages go out by text. With no cell on file, or texts turned off (the owner texted STOP, or their carrier
 * says they did), they go by email through the direct mail provider when there is one; otherwise they're marked
 * failed, which puts them in the operator's review queue. Nothing is ever "sent" to a log in production.
 * A cancelled client gets nothing more.
 */
export async function deliverOwnerMessages(d: Deps, bid?: string, opts: { allowBilling?: boolean } = {}): Promise<number> {
  let n = 0;
  for (const m of d.accounts.repo.pendingOwnerMessages(100)) {
    if (bid && m.business_id !== bid) continue;
    const loaded = d.accounts.peek(m.business_id);
    if (!loaded) continue;
    const b = loaded.state.dataset.business;
    const done = (delivery: "sent" | "failed" | "skipped", f: { channel?: string; providerId?: string; error?: string } = {}) =>
      d.accounts.repo.markOwnerMessage(m.business_id, m.id, delivery, { ...f, at: d.clock().toISOString() });
    if (b.plan.stage === "cancelled") {
      done("skipped", { error: "Cancelled: nothing more goes to the owner." });
      continue;
    }
    if (BILLING_KINDS.has(m.kind) && d.cfg.AUTO_SEND_BILLING_TEXTS !== "true" && !opts.allowBilling) {
      d.accounts.repo.markOwnerMessage(m.business_id, m.id, "review");
      continue;
    }
    let why = !b.ownerPhone ? "No cell on file" : b.ownerTextsOff ? (b.ownerTextsOff.by === "owner" ? "The owner texted STOP" : "Their carrier says they opted out of texts") : "";
    if (!why) {
      try {
        const res = await d.notifier.notify({ phone: b.ownerPhone, email: b.ownerEmail }, m.text);
        done("sent", { channel: res.channel, providerId: res.id });
        n++;
        continue;
      } catch (e) {
        const msg = (e as Error).message;
        d.log(`[owner] ${m.business_id} message ${m.id} failed: ${msg}`);
        if (!CARRIER_OPTED_OUT.test(msg)) {
          done("failed", { error: msg });
          continue;
        }
        for (const off of await setOwnerTexts(d, b.ownerPhone!, { by: "carrier" }))
          d.accounts.repo.addAlert({ businessId: off, at: d.clock().toISOString(), kind: "texts_off", title: `${b.ownerFirstName}'s phone refuses our texts (opted out at the carrier)`, detail: `${b.ownerEmail && d.email.kind === "direct" ? `Their texts now go to ${b.ownerEmail}.` : "Their texts wait here for you."} If they texted CANCEL or STOP by mistake, ask them to text START.` });
        why = "Their carrier says they opted out of texts";
      }
    }
    // Email instead, when there's an address and a mail route that can send one message on its own.
    if (b.ownerEmail && d.email.kind === "direct") {
      try {
        const res = await d.email.send({
          businessId: m.business_id,
          touchId: `owner_${m.id}`,
          customerId: "",
          to: b.ownerEmail,
          toName: b.ownerName,
          fromName: "Quiet Accounts",
          subject: `Quiet Accounts: ${oneLine(m.text.split("\n")[0] ?? "", 80)}`,
          text: `${m.text}\n\n(${why}, so this came by email.)`,
        });
        done("sent", { channel: "email", providerId: res.messageId ?? res.providerId });
        n++;
      } catch (e) {
        done("failed", { error: `${why}, and the email didn't go either: ${(e as Error).message}` });
      }
      continue;
    }
    done("failed", { error: `${why}${b.ownerEmail ? " and there's no direct mail route to email them" : " and no email on file"}. Pass it on yourself.` });
  }
  return n;
}

/**
 * Texts to the owner of every client on this phone go off (STOP, or the carrier refused one) or back on (START).
 * The phone is what opted out, so a two-brand owner is off for both. Returns the clients changed.
 */
export async function setOwnerTexts(d: Deps, phone: string, off: { by: "owner" | "carrier" } | undefined): Promise<string[]> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return [];
  const bids = d.accounts.repo.listBusinesses().filter((b) => (b.profile.ownerPhone ?? "").replace(/\D/g, "").slice(-10) === digits).map((b) => b.id);
  for (const bid of bids)
    await d.accounts.withAccount(bid, (state) => {
      const b = state.dataset.business;
      if (!!b.ownerTextsOff === !!off) return;
      const at = nowLocal(d, state);
      b.ownerTextsOff = off ? { at, by: off.by } : undefined;
      state.events.push(
        off
          ? {
              id: `ev_texts_off_${at}`,
              at,
              agent: "guard",
              kind: "warning",
              title: off.by === "owner" ? `${b.ownerFirstName} texted STOP — no more texts to them` : `${b.ownerFirstName}'s carrier refused our text (opted out)`,
              detail: b.ownerEmail ? `Hand-offs and reports now go to ${b.ownerEmail}. They can text START to turn texts back on.` : "Hand-offs and reports wait in Needs a person until you pass them on. They can text START to turn texts back on.",
            }
          : { id: `ev_texts_on_${at}`, at, agent: "guard", kind: "action", title: `${b.ownerFirstName} turned texts back on`, detail: "Hand-offs and reports are texted again." },
      );
    });
  return bids;
}

/** Something the operator must act on: it waits in "Needs a person" and shows in the client's activity. */
export async function raiseAlert(d: Deps, bid: string, a: { kind: string; title: string; detail: string }): Promise<void> {
  d.log(`[alert] ${bid} ${a.title} ${a.detail}`);
  d.accounts.repo.addAlert({ businessId: bid, at: d.clock().toISOString(), ...a });
  await d.accounts.withAccount(bid, (state) => {
    const at = nowLocal(d, state);
    state.events.push({ id: `ev_alert_${a.kind}_${at}`, at, agent: "guard", kind: "warning", title: a.title, detail: a.detail });
  });
}

/** Pause or resume a client's notes, including the campaigns already handed to a sending platform. */
export async function setBusinessPaused(d: Deps, bid: string, paused: boolean): Promise<void> {
  d.accounts.setPaused(bid, paused);
  if (d.email.kind !== "sequencer") return;
  const state = d.accounts.peek(bid)?.state;
  if (!state) return;
  const campaigns = new Set(state.touches.map((t) => (t.providerId?.startsWith(`${d.email.name}:`) ? t.providerId.split(":")[1] : undefined)).filter((x): x is string => !!x));
  for (const cid of campaigns) await d.email.pauseCampaign(state.dataset.business, cid, paused);
}

// Texts from the owner (BOOKED 2400 #K7Q, PAUSE, STOP...) are read in ./owner.ts.

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

/**
 * A Jobber failure only the owner can fix: a dead refresh token (a password change, a revoked app) or a stored
 * token we can no longer read. Anything else (Jobber down, rate limits) is retried.
 */
export function jobberNeedsReconnect(e: unknown): boolean {
  if (e instanceof ProviderError) return e.provider === "jobber" && !e.retryable && (e.status === 400 || e.status === 401 || /invalid_grant|unauthori[sz]ed|token/i.test(e.message));
  return /Unreadable stored secret|unable to authenticate data/i.test((e as Error)?.message ?? "");
}

/** Any Jobber call that fails: the error is on the connection for the console, and a dead login asks the owner to reconnect. */
async function jobberFailed(d: Deps, bid: string, kind: "jobber", e: unknown): Promise<void> {
  const dead = jobberNeedsReconnect(e);
  d.accounts.repo.putIntegration(bid, kind, { lastError: (e as Error).message, ...(dead ? { status: "needs_reconnect" } : {}) });
  if (dead) await askToReconnect(d, bid);
}

export async function syncFsm(d: Deps, bid: string, kind: "jobber"): Promise<{ records: number; newRecoveries: number } | undefined> {
  const conn = d.fsm[kind];
  const integ = d.accounts.repo.getIntegration(bid, kind);
  if (!conn || !integ?.secret || integ.status === "disconnected" || integ.status === "needs_reconnect") return undefined;
  const firstSync = !integ.last_sync_at;
  d.accounts.repo.putIntegration(bid, kind, { lastAttemptAt: d.clock().toISOString() });
  let pulled: Awaited<ReturnType<FsmConnector["pull"]>>;
  try {
    // The refresh is inside the try: tokens last an hour and syncs run hourly, so a dead refresh token is
    // the usual way a connection dies, and it must end in a reconnect text, not a silent retry every minute.
    let tokens = JSON.parse(decrypt(d.cfg.APP_SECRET, integ.secret)) as OAuthTokens;
    if (tokens.expiresAt && Date.parse(tokens.expiresAt) - d.clock().getTime() < 5 * 60000 && tokens.refreshToken) {
      tokens = await conn.refresh(tokens);
      d.accounts.repo.putIntegration(bid, kind, { secret: encrypt(d.cfg.APP_SECRET, JSON.stringify(tokens)) });
    }
    pulled = await conn.pull(tokens, { since: integ.cursor ?? undefined, onProgress: (m) => d.log(`[${kind}] ${bid} ${m}`) });
  } catch (e) {
    await jobberFailed(d, bid, kind, e);
    throw e;
  }
  // Jobber rotates refresh tokens: the old one is dead the moment a new one is issued.
  const fresh = (pulled as { tokens?: OAuthTokens }).tokens;
  if (fresh) d.accounts.repo.putIntegration(bid, kind, { secret: encrypt(d.cfg.APP_SECRET, JSON.stringify(fresh)) });
  const records = pulled.customers.length + pulled.quotes.length + pulled.jobs.length + pulled.invoices.length + pulled.requests.length;
  let newRecoveries = 0;
  let answered = 0;
  await d.accounts.withAccount(bid, (state) => {
    const at = nowLocal(d, state);
    state.dataset = mergePulled(state.dataset, pulled, kind);
    state.dataset.asOf = at.slice(0, 10);
    // always-on: a request that just came in gets its answer now, not tomorrow (never for a client who cancelled)
    answered = state.dataset.business.plan.stage === "cancelled" ? 0 : answerNewRequests(state, at);
    if (records) state.events.push({ id: `ev_sync_${at}`, at, agent: "reader", kind: "action", title: `Synced ${records.toLocaleString("en-US")} records from ${kind === "jobber" ? "Jobber" : kind}`, detail: pulled.warnings.join(" ") || undefined });
    newRecoveries = ledgerPass(state, at).newRecoveries;
    // The connect page promised a text once we'd read their Jobber; the operator sees it's ready to plan.
    if (firstSync) {
      const b = state.dataset.business;
      state.ownerMessages.push({ id: `om_connected_${at}`, at, kind: "info", text: `${b.ownerFirstName}, we're connected to your Jobber and have read ${records.toLocaleString("en-US")} records. Jack will text you what we found before a single note goes out.`, refs: [{ kind: "connected", id: kind }] });
      state.events.push({ id: `ev_connected_${at}`, at, agent: "reader", kind: "review", title: "Jobber connected and read — ready to plan", detail: `${records.toLocaleString("en-US")} records on the first sync.` });
    }
  });
  d.accounts.repo.putIntegration(bid, kind, { cursor: pulled.nextSince ?? integ.cursor, lastSyncAt: d.clock().toISOString(), lastError: null, status: "connected" });
  d.accounts.repo.markScanned(bid, d.clock().toISOString());
  await deliverOwnerMessages(d, bid);
  if (answered) await sendDue(d, bid);
  return { records, newRecoveries };
}

/**
 * Jobber cut us off (a password change, a revoked app). Nothing stalls quietly: the owner gets a one-tap
 * reconnect link — at most once a week — and the work carries on from the last sync meanwhile.
 */
async function askToReconnect(d: Deps, bid: string): Promise<void> {
  const link = connectJobberLink(d, bid);
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
  try {
    const tokens = JSON.parse(decrypt(d.cfg.APP_SECRET, integ.secret)) as OAuthTokens;
    await conn.writeNote(tokens, { kind: note.kind, sourceId: note.sourceId }, note.text);
  } catch (e) {
    // A dead login found here stalls nothing quietly either: same reconnect text as a failed sync.
    if (jobberNeedsReconnect(e)) await jobberFailed(d, bid, "jobber", e);
    throw e;
  }
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
        ...sender(b),
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
        ...sender(b),
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
