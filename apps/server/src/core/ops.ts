import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  addDays,
  adoptTrade,
  bannedStatIn,
  playbook,
  answerNewRequests,
  alwaysOnFor,
  readRequestEmail,
  takeRequest,
  answerTime,
  approveAll,
  clearBrake,
  counted,
  doNotContact,
  dropStaleAnswers,
  extractEmails,
  HELD_FOR_GOOD,
  REQUIRED_FLAG,
  sendableEmail,
  sendHealth,
  setBookedOut,
  staleAnswer,
  totals,
  customerById,
  daysBetween,
  detect,
  dueTouches,
  find,
  importTable,
  kickoff,
  ledgerPass,
  leadCode,
  makeId,
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
import type { Loaded } from "../db/repo.ts";
import type { DirectProvider, FsmConnector, InboundEvent, OAuthTokens, OutboundProvider, OwnerNotifier, SendResult, SequencedLead, SequencerProvider } from "../contracts.ts";
import { ProviderError } from "../contracts.ts";
import type { Llm } from "../agents/llm.ts";
import type { MailCheck } from "../providers/mailcheck.ts";
import { draftAnswer, readReplyWithClaude } from "../agents/replies.ts";
import { readRequestWithClaude } from "../agents/requests.ts";
import { personalizeFirstNote } from "../agents/writer.ts";
import { suggestMapping } from "../agents/mapping.ts";
import { NotReady, type Accounts } from "./accounts.ts";
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
export type LinkKind = "owner" | "import" | "requests" | "oauth|jobber";

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

export async function plan(d: Deps, bid: string, opts: { startOn?: string; limit?: number; approve?: boolean } = {}): Promise<{ people: number; notes: number; firstDay?: string; lastDay?: string; personalized: number; awaitingOk?: boolean; textSent?: boolean }> {
  let planned: Touch[] = [];
  let firstRound = false;
  let approved = true;
  let waiting = false;
  let textSent = false;
  // Every note carries the business's postal address (CAN-SPAM); a sign-up from the site doesn't have one yet.
  const known = d.accounts.peek(bid);
  if (known && (known.state.dataset.business.mailingAddress?.trim() ?? "").length < 8) throw new NotReady("Add the business's mailing address first. It goes at the bottom of every note, and the law requires it.");
  const result = await d.accounts.withAccount(bid, (state) => {
    const at = nowLocal(d, state);
    const b = state.dataset.business;
    const startOn = opts.startOn ?? nextSendDay(state, at.slice(0, 10));
    const limit = opts.limit ?? (b.plan.stage === "trial" ? Math.max(0, b.plan.trialSize - startedPeople(state)) : undefined);
    if (limit === 0) return { people: 0, notes: 0, personalized: 0 };
    // The free round's first batch waits for the owner's OK to the first note (by text); later batches don't.
    firstRound = b.plan.stage === "trial" && !state.touches.some((t) => t.status !== "cancelled");
    // while the owner hasn't said OK to the first note, nothing new is approved either (a top-up waits with it)
    waiting = !!state.awaitingOwnerOk;
    approved = opts.approve ?? (!firstRound && !waiting);
    const p = planBatch(state, at, { startOn, limitPeople: limit, approve: approved, kickoff: false });
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
  // The welcome text is written last, so the first note in it is exactly the one that goes out.
  // The welcome text with the first note; again when the operator re-plans while the owner's OK is still pending
  // (they asked for a change). The console says a text went only when one did.
  if ((firstRound || waiting) && result.people)
    await d.accounts.withAccount(bid, (state) => {
      textSent = !!kickoff(state, nowLocal(d, state), { awaitOk: !approved, again: waiting });
    });
  const pending = !!d.accounts.peek(bid)?.state.awaitingOwnerOk;
  return { ...result, awaitingOk: pending && result.people > 0, textSent };
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
  // Held for good (replied, unsubscribed, do-not-contact, note 1 never went, a stale answer): cancel them.
  const cancel = h.filter((x) => HELD_FOR_GOOD.test(x.why));
  if (cancel.length)
    await d.accounts.withAccount(bid, (state) => {
      // a late answer to a request also tells the owner it didn't go
      dropStaleAnswers(state, at0);
      for (const c of cancel) {
        const t = state.touches.find((x) => x.id === c.touch.id);
        if (t && t.status === "approved") {
          t.status = "cancelled";
          t.lastError = c.why;
        }
      }
    });
  const health = sendHealth(loaded.state);
  if (health.paused && h.length) await noteBrake(d, bid, health.reason);
  for (const item of due.slice(0, opts.maxPerTick ?? 25)) {
    const state = loaded.state;
    const b = state.dataset.business;
    const t = item.touch;
    const prev = t.step > 1 ? state.touches.find((x) => x.opportunityId === t.opportunityId && x.step === 1 && x.providerId) : undefined;
    if (!(await deliverable(d, bid, item.to))) {
      held++;
      continue;
    }
    // Claimed before the mail server sees it: an overlapping send skips it, and a crash or a timeout after the
    // server took it leaves it "sending" for a person to check — never mailed a second time.
    const claimed = await d.accounts.withAccount(bid, (s) => {
      const live = s.touches.find((x) => x.id === t.id);
      if (!live || live.status !== "approved") return false;
      live.status = "sending";
      live.claimedAt = nowLocal(d, s);
      return true;
    });
    if (!claimed) continue;
    let res: SendResult;
    try {
      res = await (provider as DirectProvider).send({
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
    } catch (e) {
      failed++;
      const how = await settleFailedSend(d, bid, t.id, item, e);
      d.log(`[send] ${bid} ${t.id} failed (${how}): ${(e as Error).message}`);
      // the mailbox itself is blocked (quota, policy): the rest of this batch would only fail the same way
      if (how === "mailbox") break;
      continue;
    }
    // it went: record it (a failed save is tried once more; either way it stays claimed, never re-sent)
    const record = () =>
      d.accounts.withAccount(bid, (s) => {
        const live = s.touches.find((x) => x.id === t.id);
        if (live && live.status === "sending") {
          markSent(s, t.id, nowLocal(d, s), res.messageId ?? res.providerId);
          live.claimedAt = undefined;
        }
      });
    await record().catch(record).catch((e) => d.log(`[send] ${bid} ${t.id} went but couldn't be recorded: ${(e as Error).message}`));
    sent++;
  }
  return { sent, failed, held };
}

/** Enhanced status code (RFC 3463) in a server's reply, e.g. "5.1.1". */
function enhancedCode(message: string): string | undefined {
  return message.match(/\b([245]\.\d{1,3}\.\d{1,3})\b/)?.[1];
}

/**
 * Settle a note whose send failed:
 *  - "unsure": the server may have it (a timeout after the message was handed over). It stays "sending" for a person.
 *  - "bounced": the address doesn't exist. Suppressed, counted toward the brake, and its sequence stops.
 *  - "mailbox": the sending mailbox is blocked (quota, policy). Not the person's fault: the note waits.
 *  - "retry" / "failed": a temporary error retries with backoff; a permanent one, or too many, ends the sequence.
 */
async function settleFailedSend(d: Deps, bid: string, touchId: string, item: { to: string; customerName: string }, e: unknown): Promise<"unsure" | "bounced" | "mailbox" | "retry" | "failed"> {
  const err = e instanceof ProviderError ? e : undefined;
  const message = (e as Error).message ?? String(e);
  const x = enhancedCode(message);
  const how =
    !err || err.maybeSent
      ? "unsure"
      : !err.retryable && (x ? /^5\.1\.|^5\.2\.1$/.test(x) : [550, 551, 553].includes(err.status ?? 0))
        ? "bounced"
        : (x && (/^\d\.7\./.test(x) || /^\d\.4\.5$/.test(x))) || /quota|rate limit|too many (messages|emails)/i.test(message)
          ? "mailbox"
          : err.retryable
            ? "retry"
            : "failed";
  await d.accounts.withAccount(bid, (s) => {
    const live = s.touches.find((t) => t.id === touchId);
    if (!live || live.status !== "sending") return;
    const at = nowLocal(d, s);
    live.lastError = message;
    if (how === "unsure") {
      live.attempts = (live.attempts ?? 0) + 1;
      s.events.push({ id: `ev_unsure_${touchId}`, at, agent: "guard", kind: "warning", title: `Not sure the note to ${item.customerName} went`, detail: `${message} It won't be sent again until someone checks.` });
      return;
    }
    live.claimedAt = undefined;
    live.attempts = (live.attempts ?? 0) + 1;
    // a quota or policy block waits it out (about a day, all told) before this note is given up on
    if (how === "mailbox" && live.attempts < MAX_SEND_ATTEMPTS * 2) {
      live.status = "approved";
      live.dueAt = new Date(Date.parse(`${at.slice(0, 16)}:00Z`) + 30 * 60_000 * live.attempts).toISOString().slice(0, 16);
      const id = `ev_mailbox_${at.slice(0, 10)}`;
      if (!s.events.some((ev) => ev.id === id)) s.events.push({ id, at, agent: "guard", kind: "warning", title: "The sending mailbox is refusing mail — notes are waiting", detail: message });
      return;
    }
    if (how === "retry" && live.attempts < MAX_SEND_ATTEMPTS) {
      live.status = "approved";
      live.dueAt = new Date(Date.parse(`${live.dueAt}:00Z`) + 5 * 60000 * live.attempts).toISOString().slice(0, 16);
      return;
    }
    live.status = how === "bounced" ? "bounced" : "skipped";
    if (how === "bounced") s.suppressions[item.to] = "bounced";
    // the rest of the sequence stops: a follow-up must never arrive as someone's first note
    let stopped = 0;
    for (const t of s.touches)
      if (t.opportunityId === live.opportunityId && t.step > live.step && (t.status === "approved" || t.status === "planned")) {
        t.status = "cancelled";
        t.lastError = `Note ${live.step} didn't go`;
        stopped++;
      }
    if (how === "bounced") stopped += stopSequence(s, live.customerId);
    s.events.push({
      id: `ev_sendfail_${touchId}`,
      at,
      agent: "guard",
      kind: "warning",
      title: how === "bounced" ? `Bad address for ${item.customerName} — removed` : `Couldn't send to ${item.customerName}`,
      detail: [message, stopped ? `${stopped} queued ${stopped === 1 ? "note" : "notes"} stopped.` : ""].filter(Boolean).join(" "),
    });
  });
  return how;
}

/** The Guard's brake is holding notes: say so once, where the operator looks (the review queue shows it too). */
async function noteBrake(d: Deps, bid: string, reason?: string): Promise<void> {
  const state = d.accounts.peek(bid)?.state;
  const id = `ev_brake_${state?.dataset.business.healthBaseline?.at ?? "start"}`;
  if (!state || state.events.some((e) => e.id === id)) return;
  await d.accounts.withAccount(bid, (s) => {
    if (!s.events.some((e) => e.id === id)) s.events.push({ id, at: nowLocal(d, s), agent: "guard", kind: "warning", title: "Send brake on — nothing more goes out until someone looks", detail: reason });
  });
}

/** An operator looked at why the brake tripped and lets sending resume (the platform's campaigns too). */
export async function clearSendBrake(d: Deps, bid: string, by: string): Promise<void> {
  await d.accounts.withAccount(bid, (s) => clearBrake(s, nowLocal(d, s), by));
  const l = d.accounts.peek(bid);
  if (l && !holdReason(l) && l.state.dataset.business.platformPaused) await releasePlatform(d, bid);
}

/**
 * Sequencer mode: push people whose first note is due within a week, with all their notes. An instant answer to
 * a new request goes to the business's instant campaign instead: the nurture campaign puts follow-ups first,
 * caps new leads a day and sends on weekdays only, so an evening request could wait days for its "thanks".
 */
export async function syncSequencer(d: Deps, bid: string, seq: SequencerProvider): Promise<{ sent: number; failed: number; held: number }> {
  let loaded = d.accounts.peek(bid);
  if (!loaded) return { sent: 0, failed: 0, held: 0 };
  // Whatever holds the business (a pause, a cancel, the Guard's brake) holds its campaigns: notes already
  // pushed would otherwise keep going on the platform's schedule. The hold lifts here too once nothing holds it.
  const hold = holdReason(loaded);
  if (hold) {
    if (!loaded.state.dataset.business.platformPaused) await holdPlatform(d, bid, hold);
    const h = sendHealth(loaded.state);
    if (h.paused) await noteBrake(d, bid, h.reason);
    return { sent: 0, failed: 0, held: 0 };
  }
  if (loaded.state.dataset.business.platformPaused) await releasePlatform(d, bid);
  await tidyPushed(d, bid, seq);
  loaded = d.accounts.peek(bid)!;
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
    // a note missing what the law requires waits for a fix (it's on the review queue as a flagged note)
    if (ts.some((t) => t.flags.some((f) => REQUIRED_FLAG.test(f)))) continue;
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
  if (!groups.size) return { sent: 0, failed: 0, held: 0 };
  let pushed = 0;
  let answers = 0;
  let failed = 0;
  const done = new Map<string, string>();
  const refused: { lead: SequencedLead; why: string }[] = [];
  let pushError: string | undefined;
  for (const g of groups.values()) {
    try {
      const { campaignId } = await seq.ensureCampaign(b, g.instant ? { maxSteps: 1, instant: true } : { maxSteps: g.steps });
      const res = await seq.upsertLeads(b, campaignId, g.leads);
      const skipped = new Map(res.skipped.map((s) => [s.email.toLowerCase(), s.why]));
      for (const l of g.leads) {
        const why = skipped.get(l.email.toLowerCase());
        if (why) refused.push({ lead: l, why });
        else for (const n of l.notes) done.set(n.touchId, `${seq.name}:${campaignId}:${l.email}:${n.step}`);
      }
      if (g.instant) answers += g.leads.length - skipped.size;
      else pushed += g.leads.length - skipped.size;
    } catch (e) {
      failed += g.leads.length;
      pushError = (e as Error).message;
      d.log(`[sequencer] ${bid} push failed: ${pushError}`);
    }
  }
  if (done.size || extra.length || refused.length || pushError)
    await d.accounts.withAccount(bid, (s) => {
      for (const t of s.touches) {
        const p = done.get(t.id);
        if (p && !t.providerId) t.providerId = p;
        if (extra.includes(t.id) && t.status === "approved") t.status = "cancelled";
      }
      if (pushed) s.events.push({ id: `ev_push_${at}`, at, agent: "sender", kind: "action", title: `Handed ${pushed} people to the sending platform`, detail: `Their notes go out on your schedule from your warmed-up mailboxes.` });
      if (answers) s.events.push({ id: `ev_push_instant_${at}`, at, agent: "sender", kind: "action", title: `Sent ${answers} ${answers === 1 ? "answer" : "answers"} to new requests to the sending platform`, detail: "They go out within minutes, 7am–8pm any day." });
      for (const r of refused) refuseLead(s, seq.name, r.lead, r.why, at);
      const id = `ev_pushfail_${at.slice(0, 10)}`;
      if (pushError && !s.events.some((e) => e.id === id)) s.events.push({ id, at, agent: "guard", kind: "warning", title: "Couldn't hand notes to the sending platform — retrying every minute", detail: pushError });
    });
  return { sent: pushed + answers, failed, held: 0 };
}

/** The platform refused no reason given this many times: then it's treated like any other refusal. */
const MAX_PUSH_TRIES = 3;

/**
 * The platform wouldn't take a lead (on its blocklist — one workspace serves every client — an invalid address,
 * a duplicate). Its notes are marked skipped with the reason and shown, so they're never re-uploaded every
 * minute and don't hold the free round open. A refusal with no reason is retried a few times first.
 */
function refuseLead(s: AccountState, platform: string, lead: SequencedLead, why: string, at: string): void {
  const ts = s.touches.filter((t) => lead.notes.some((n) => n.touchId === t.id) && t.status === "approved" && !t.providerId);
  const first = ts.find((t) => t.step === 1) ?? ts[0];
  if (!first) return;
  const tries = (first.attempts ?? 0) + 1;
  if (/no reason given/.test(why) && tries < MAX_PUSH_TRIES) {
    for (const t of ts) (t.attempts = tries), (t.lastError = `${platform}: ${why}`);
    return;
  }
  for (const t of ts) {
    t.status = "skipped";
    t.lastError = `${platform}: ${why}`;
  }
  // the address can't be reached through the platform at all: keep it out of the next plan too
  if (/blocklist/.test(why)) s.suppressions[lead.email.toLowerCase()] ??= "unsubscribed";
  else if (/invalid/.test(why)) s.suppressions[lead.email.toLowerCase()] ??= "bounced";
  const name = customerById(s.dataset, lead.customerId)?.name ?? lead.email;
  s.events.push({ id: `ev_refused_${first.id}`, at, agent: "guard", kind: "warning", title: `The sending platform wouldn't take ${name}`, detail: `${why}. Their ${ts.length === 1 ? "note was" : `${ts.length} notes were`} skipped.`, refs: [{ kind: "customer", id: lead.customerId }] });
}

/* ------------------------- holding and releasing the platform ------------------------- */

/** What stops this business from sending right now, if anything. */
export function holdReason(l: Loaded): string | undefined {
  const b = l.state.dataset.business;
  if (b.plan.stage === "cancelled") return "cancelled";
  if (l.paused || b.plan.stage === "paused") return "paused";
  const h = sendHealth(l.state);
  return h.paused ? `the Guard's brake: ${h.reason}` : undefined;
}

/** Campaigns this business handed notes to (the platform's campaigns are per business). */
function campaignsOf(d: Deps, state: AccountState): string[] {
  const p = `${d.email.name}:`;
  return [...new Set(state.touches.filter((t) => t.providerId?.startsWith(p)).map((t) => t.providerId!.split(":")[1]!).filter(Boolean))];
}

/** Pause (or restart) one campaign; a failure is retried by the worker, which re-checks what's wanted then. */
async function setCampaign(d: Deps, bid: string, b: BusinessProfile, campaignId: string, paused: boolean): Promise<void> {
  if (d.email.kind !== "sequencer") return;
  try {
    await d.email.pauseCampaign(b, campaignId, paused);
  } catch (e) {
    d.log(`[sequencer] ${paused ? "pause" : "resume"} ${campaignId} for ${bid} failed: ${(e as Error).message}`);
    d.accounts.repo.enqueue("sequencer.pause", { bid, campaignId, paused, profile: { id: b.id, name: b.name } }, { runAt: new Date(d.clock().getTime() + 60_000).toISOString() });
  }
}

async function holdPlatform(d: Deps, bid: string, why: string): Promise<void> {
  if (d.email.kind !== "sequencer") return;
  const state = d.accounts.peek(bid)?.state;
  if (!state) return;
  for (const cid of campaignsOf(d, state)) await setCampaign(d, bid, state.dataset.business, cid, true);
  await d.accounts.withAccount(bid, (s) => {
    const at = nowLocal(d, s);
    s.dataset.business.platformPaused = { at, why };
    s.events.push({ id: `ev_hold_${at}`, at, agent: "guard", kind: "action", title: "Sending platform paused for this client", detail: `Because of ${why}. Nothing already handed over goes out until it lifts.` });
  });
}

async function releasePlatform(d: Deps, bid: string): Promise<void> {
  if (d.email.kind !== "sequencer") return;
  // answers to requests that sat in a paused campaign are pulled before it restarts: they'd go days late
  const stale = await d.accounts.withAccount(bid, (s) => {
    const at = nowLocal(d, s);
    const out: string[] = [];
    for (const t of s.touches)
      if (t.instant && t.status === "approved" && t.providerId?.startsWith(`${d.email.name}:`) && staleAnswer(s, t, at)) {
        t.status = "cancelled";
        t.lastError = `Not sent: ${staleAnswer(s, t, at)}`;
        out.push(t.providerId);
      }
    return out;
  });
  await withdrawLeads(d, bid, stale, { inline: 25 });
  const state = d.accounts.peek(bid)?.state;
  if (!state) return;
  for (const cid of campaignsOf(d, state)) await setCampaign(d, bid, state.dataset.business, cid, false);
  await d.accounts.withAccount(bid, (s) => {
    s.dataset.business.platformPaused = undefined;
    const at = nowLocal(d, s);
    s.events.push({ id: `ev_release_${at}`, at, agent: "guard", kind: "action", title: "Sending platform back on for this client" });
  });
}

/** Each (campaign, address) with notes still to go, from provider ids "<platform>:<campaign>:<email>:<step>". */
function leadsFrom(d: Deps, providerIds: string[]): { campaignId: string; email: string }[] {
  const out = new Map<string, { campaignId: string; email: string }>();
  for (const p of providerIds) {
    const [name, campaignId, email] = p.split(":");
    if (name === d.email.name && campaignId && email) out.set(`${campaignId}|${email}`, { campaignId, email });
  }
  return [...out.values()];
}

/** Take notes back from the platform (never blocklisting): the first few now, the rest by the worker. */
async function withdrawLeads(d: Deps, bid: string, providerIds: string[], opts: { inline: number }): Promise<void> {
  if (d.email.kind !== "sequencer" || !providerIds.length) return;
  const leads = leadsFrom(d, providerIds);
  const b = d.accounts.peek(bid)?.state.dataset.business;
  const later: { campaignId: string; email: string }[] = [];
  for (const [i, l] of leads.entries()) {
    if (i >= opts.inline || !b) {
      later.push(l);
      continue;
    }
    try {
      await d.email.stopLead(b, l.campaignId, l.email, "withdrawn");
    } catch (e) {
      d.log(`[sequencer] withdraw ${l.email} failed: ${(e as Error).message}`);
      later.push(l);
    }
  }
  // no business id on the task: it must outlive a deleted client
  if (later.length) d.accounts.repo.enqueue("sequencer.withdraw", { bid, profile: { id: bid, name: b?.name ?? bid }, leads: later }, { runAt: d.clock().toISOString() });
}

/** Unsent notes this business handed the platform. */
function pushedUnsent(d: Deps, state: AccountState): string[] {
  const p = `${d.email.name}:`;
  return state.touches.filter((t) => t.providerId?.startsWith(p) && !t.sentAt && t.status !== "sent" && t.status !== "delivered" && t.status !== "bounced").map((t) => t.providerId!);
}

/**
 * Notes still queued for people we can no longer write to leave the platform too: the owner marked them
 * do-not-contact in their software, or an answer to a request went stale before it was handed over.
 */
async function tidyPushed(d: Deps, bid: string, seq: SequencerProvider): Promise<void> {
  const state = d.accounts.peek(bid)!.state;
  const at = nowLocal(d, state);
  const dnc = (s: AccountState, t: Touch) => t.status === "approved" && doNotContact(s, t);
  const stale = (s: AccountState, t: Touch) => t.instant && t.status === "approved" && !t.providerId && t.dueAt <= at.slice(0, 16) && !!staleAnswer(s, t, at);
  if (!state.touches.some((t) => dnc(state, t) || stale(state, t))) return;
  const pulled = await d.accounts.withAccount(bid, (s) => {
    dropStaleAnswers(s, at);
    const out: string[] = [];
    for (const t of s.touches)
      if (dnc(s, t)) {
        t.status = "cancelled";
        t.lastError = "Do not contact — the owner's setting in their software";
        if (t.providerId?.startsWith(`${seq.name}:`)) out.push(t.providerId);
      }
    return out;
  });
  await withdrawLeads(d, bid, pulled, { inline: 25 });
}

/**
 * Stop — or restart — everything a business sends. Pause and resume flip its campaigns on the sending platform
 * too (a resume never restarts a cancelled or braked business); cancel also cancels what's queued and takes back
 * every note the platform still holds. Every stop (owner text or link, Settings, delete, the operator) comes here.
 */
export async function holdSending(d: Deps, bid: string, mode: "pause" | "resume" | "cancel"): Promise<void> {
  if (!d.accounts.repo.exists(bid)) return;
  if (mode === "resume") {
    d.accounts.setPaused(bid, false);
    const l = d.accounts.peek(bid);
    if (l && !holdReason(l) && l.state.dataset.business.platformPaused) await releasePlatform(d, bid);
    return;
  }
  d.accounts.setPaused(bid, true);
  if (mode === "cancel")
    await d.accounts.withAccount(bid, (s) => {
      for (const t of s.touches) if (t.status === "approved" || t.status === "planned") t.status = "cancelled";
    });
  const l = d.accounts.peek(bid)!;
  if (!l.state.dataset.business.platformPaused) await holdPlatform(d, bid, mode === "cancel" ? "a cancel" : "a pause");
  if (mode === "cancel") await withdrawLeads(d, bid, pushedUnsent(d, d.accounts.peek(bid)!.state), { inline: 0 });
}

/** The owner moved queued work (BUSY / OPEN): notes the platform already holds are taken back, and pushed again when due. */
export async function withdrawMoved(d: Deps, bid: string, providerIds: string[]): Promise<void> {
  await withdrawLeads(d, bid, providerIds, { inline: 25 });
}

/* ------------------------------------------------------------------ */
/* Inbox: inbound events                                               */
/* ------------------------------------------------------------------ */

/**
 * Which business (and customer) an address belongs to — only when exactly one does (or one within `among`).
 * A homeowner in two clients' books is never guessed: the note it answers or its campaign has to say.
 */
export function whoIs(d: Deps, email: string, among?: string): { businessId: string; customerId: string } | undefined {
  const hits = d.accounts.repo.businessesForEmail(email);
  if (among) return hits.find((h) => h.businessId === among);
  return hits.length === 1 ? hits[0] : undefined;
}

/** Every spelling a Message-ID arrives in (with and without <>), In-Reply-To first, then References newest first. */
function threadIds(ev: { inReplyTo?: string; references?: string[] }): string[] {
  const split = (s?: string) => (s ?? "").split(/[\s,]+/).filter(Boolean);
  const raw = [...split(ev.inReplyTo), ...(ev.references ?? []).flatMap(split).reverse()];
  const out: string[] = [];
  for (const id of raw) {
    const bare = id.replace(/^<|>$/g, "");
    for (const v of [id, bare, `<${bare}>`]) if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** A mail system's delivery report (not a person). */
const MAIL_SYSTEM = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon|bounce[s]?|mdaemon|noreply-dmarc)@/i;

export interface InboundRoute {
  /** The one business it belongs to, when anything says so. */
  businessId?: string;
  /** Every business it could belong to, when nothing narrows it to one. */
  candidates: string[];
  /** Our provider id of the note it answers (as stored), when its thread names one. */
  answered?: string;
}

/**
 * Where an inbound event belongs, most specific first: our own business id (a lead variable or an operator), the
 * note its thread answers (In-Reply-To / References → the touch we sent), the campaign it came in on, the inbox it
 * was sent to, and only then the sender's address — and that only when exactly one business knows it. A delivery
 * report is placed by the note it bounced or the address it names.
 */
export function routeInbound(d: Deps, ev: InboundEvent, email?: string, intent?: string): InboundRoute {
  const repo = d.accounts.repo;
  const threads = ev.type === "reply" ? threadIds(ev) : [];
  const answeredIn = (bid?: string) => threads.find((id) => (bid ? repo.businessForTouchProvider(id) === bid : repo.businessForTouchProvider(id)));
  if (ev.businessId && repo.exists(ev.businessId)) return { businessId: ev.businessId, candidates: [ev.businessId], answered: answeredIn(ev.businessId) };
  const answered = answeredIn();
  if (answered) {
    const bid = repo.businessForTouchProvider(answered)!;
    return { businessId: bid, candidates: [bid], answered };
  }
  if (ev.campaignId) {
    const bids = repo.businessesForProvider(`${d.email.name}:${ev.campaignId}:`);
    if (bids.length === 1) return { businessId: bids[0], candidates: bids };
  }
  if (ev.type === "reply" && ev.to?.length) {
    const inboxes = new Set(ev.to.flatMap((x) => extractEmails(x)));
    const bids = repo.listBusinesses().filter((b) => b.profile.replyTo && inboxes.has(b.profile.replyTo.toLowerCase())).map((b) => b.id);
    if (bids.length === 1) return { businessId: bids[0], candidates: bids };
  }
  const known = email ? [...new Set(repo.businessesForEmail(email).map((h) => h.businessId))] : [];
  if (known.length === 1) return { businessId: known[0], candidates: known };
  if (known.length) return { candidates: known };
  // a delivery report names the dead address in its text
  if (ev.type === "reply" && (intent === "bounce" || (email && MAIL_SYSTEM.test(email)))) {
    const named = [...new Set(extractEmails(ev.text).filter((e) => e !== email).flatMap((e) => repo.businessesForEmail(e).map((h) => h.businessId)))];
    return named.length === 1 ? { businessId: named[0], candidates: named } : { candidates: named };
  }
  return { candidates: [] };
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

/** What became of an inbound event: the businesses it was applied to, or why it waits for a person. */
export interface InboundOutcome {
  businessIds: string[];
  review?: string;
}

/** Route a normalized inbound event to the right business (or businesses) and apply it. */
export async function handleInbound(d: Deps, ev: InboundEvent): Promise<InboundOutcome> {
  if (ev.type === "account_error") {
    const who = ev.account ?? "a sending mailbox";
    const bids = await alertOperator(d, {
      key: `acct_${ev.account ?? "unknown"}`,
      title: `Instantly: ${who} has an error`,
      detail: `${ev.detail ? `${ev.detail} ` : ""}Notes from ${who} may not go out until it's fixed in Instantly.`,
      campaignId: ev.campaignId,
      businessId: ev.businessId,
    });
    return { businessIds: bids };
  }
  const email = (ev.type === "reply" ? ev.from : ev.email).toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/)?.[0];
  if (ev.type === "reply") return handleReply(d, ev, email);
  const route = routeInbound(d, ev, email);
  if (ev.type !== "sent") {
    // bounce / unsubscribe / complaint: where it was meant, else at every business that knows the address
    const bids = route.businessId ? [route.businessId] : route.candidates;
    if (!bids.length || !email) d.log(`[inbound] no business for ${email ?? "?"} (${ev.type})`);
    const reason = ev.type === "bounce" ? "bounced" : ev.type === "unsubscribe" ? "unsubscribed" : "complained";
    if (email) for (const bid of bids) await suppress(d, bid, email, reason, ev.type === "bounce" ? ev.detail : undefined, { counted: true });
    return { businessIds: email ? bids : [] };
  }
  const bid = route.businessId;
  if (!bid) {
    d.log(`[inbound] no single business for ${email ?? "?"} (sent)`);
    return { businessIds: [] };
  }
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
  return { businessIds: [bid] };
}

type ReplyEvent = Extract<InboundEvent, { type: "reply" }>;
type Reading = NonNullable<Awaited<ReturnType<typeof readReplyWithClaude>>>;

async function handleReply(d: Deps, ev: ReplyEvent, email: string | undefined): Promise<InboundOutcome> {
  // Rules read every reply; Claude gives a second opinion on every human one (the rules are ~83% right on
  // unseen mail, and a misread "yes" is a lost job). Clear stops, bounces and out-of-offices skip it.
  const rule = readReply({ text: ev.text, subject: ev.subject, from: ev.from, asOf: ev.receivedAt.slice(0, 10) });
  const route = routeInbound(d, ev, email, rule.intent);
  let override: Reading | undefined = undefined;
  const mechanical = ["stop", "bounce", "auto_reply"].includes(rule.intent) && rule.confidence >= 0.9;
  if (d.llm && !mechanical) {
    const b = route.businessId ? d.accounts.peek(route.businessId)?.state.dataset.business : undefined;
    override = (await readReplyWithClaude(d.llm, { text: rule.cleaned || ev.text, subject: ev.subject, today: ev.receivedAt.slice(0, 10), businessName: b?.name ?? "" })) ?? undefined;
    if (override) override = settleReading(rule.intent, override);
  }
  const intent = override?.intent ?? rule.intent;
  if (route.businessId) {
    await applyReply(d, route.businessId, ev, email, override, route.answered);
    return { businessIds: [route.businessId] };
  }
  // Nothing says which business it was meant for. A stop, complaint or bounce is honored at every business that
  // knows the address; anything else (a yes, a question) waits for a person — never a guess, never the wrong owner.
  if (route.candidates.length && (intent === "stop" || intent === "complaint" || intent === "bounce")) {
    for (const bid of route.candidates) await applyReply(d, bid, ev, email, override);
    return { businessIds: route.candidates };
  }
  if (intent === "auto_reply") {
    d.log(`[inbound] out-of-office from ${email ?? ev.from} matched no single business`);
    return { businessIds: [] };
  }
  const review = route.candidates.length
    ? `${route.candidates.length} clients have ${email ?? "this address"} and the reply doesn't say which note it answers.`
    : `Nobody we wrote to has ${email ?? "this address"}, and it doesn't answer a note we sent.`;
  const id = ev.messageId ?? ev.replyEmailId ?? createHash("sha1").update(`${ev.from}|${ev.receivedAt}|${ev.text}`).digest("hex").slice(0, 24);
  d.accounts.repo.queueInboundReview({ id: `in:${id}`, at: d.clock().toISOString(), reason: review, candidates: route.candidates, event: ev });
  d.log(`[inbound] ${email ?? ev.from} waits for a person: ${review}`);
  return { businessIds: [], review };
}

/** Read a reply into one business and act on it: owner hand-off, instant answer, Jobber note, stop the sequence. */
async function applyReply(d: Deps, bid: string, ev: ReplyEvent, email: string | undefined, override: Reading | undefined, answered?: string): Promise<void> {
  let reply: Reply | undefined;
  let note: FsmNote | undefined;
  let fresh = false;
  await d.accounts.withAccount(bid, (state) => {
    // a retried delivery of a reply we already read changes nothing
    if (state.replies.some((r) => (ev.messageId && r.thread?.messageId === ev.messageId) || (ev.replyEmailId && r.thread?.replyEmailId === ev.replyEmailId))) return;
    // the engine reasons in the business's local time ("call you today" depends on it)
    const local = localIso(new Date(ev.receivedAt), state.dataset.business.timezone).slice(0, 19);
    const before = state.replies.length;
    reply = receiveReply(state, { from: ev.from, subject: ev.subject, text: ev.text, receivedAt: local, inReplyTo: answered }, override);
    fresh = state.replies.length > before;
    if (!fresh) return;
    reply.thread = { subject: ev.subject, messageId: ev.messageId, replyEmailId: ev.replyEmailId, toAccount: ev.toAccount };
    if (!["auto_reply", "bounce"].includes(reply.intent)) {
      const name = customerById(state.dataset, reply.customerId)?.name ?? reply.from;
      note = fsmNote(state, reply.customerId, reply.opportunityId, `Quiet Accounts: ${name} replied to our follow-up (${INTENT_WORDS[reply.intent] ?? "replied"}): "${oneLine(reply.text, 400)}"`);
    }
  });
  if (!fresh) return;
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
      // an address the stop suppressed (an alias said stop in our thread) is blocklisted there too; others just stop
      for (const other of lead?.emails ?? []) if (other !== email) await stopEverywhere(d, bid, other, st?.suppressions[other] ?? "replied");
    }
  }
  await deliverOwnerMessages(d, bid);
}

/**
 * Suppress an address at one business and stop everything queued for it. `counted`: the platform reported it
 * (a bounce, a spam report), so the Guard's brake counts it like one read from the inbox.
 */
export async function suppress(d: Deps, bid: string, email: string, reason: "unsubscribed" | "bounced" | "complained", detail?: string, opts: { counted?: boolean } = {}): Promise<void> {
  await d.accounts.withAccount(bid, (state) => {
    state.suppressions[email] = reason;
    const c = state.dataset.customers.find((x) => x.emails.includes(email));
    if (c && opts.counted) countAgainstSending(d, state, c.id, email, reason);
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

/**
 * The Guard's brake counts bounced notes and complaint replies. A bounce the platform reports marks the note that
 * bounced (the last one that went, else the one it was handed); a spam report is kept as a complaint.
 */
function countAgainstSending(d: Deps, state: AccountState, customerId: string, email: string, reason: "unsubscribed" | "bounced" | "complained"): void {
  const at = nowLocal(d, state);
  if (reason === "bounced") {
    const mine = state.touches.filter((t) => t.customerId === customerId);
    const t =
      mine.filter((x) => x.status === "sent" || x.status === "delivered").sort((a, b) => ((a.sentAt ?? "") < (b.sentAt ?? "") ? 1 : -1))[0] ??
      mine.filter((x) => (x.status === "approved" || x.status === "sending") && x.providerId?.includes(`:${email}:`)).sort((a, b) => a.step - b.step)[0];
    if (t) {
      t.sentAt ??= at;
      t.status = "bounced";
    }
  } else if (reason === "complained") {
    const id = makeId("r", email, "platform-complaint");
    if (!state.replies.some((r) => r.id === id))
      state.replies.push({ id, customerId, channel: "email", receivedAt: at, from: email, text: "(Reported as spam through the sending platform.)", intent: "complaint", confidence: 1, extracted: {}, status: "done" });
  }
}

async function stopEverywhere(d: Deps, bid: string, email: string, reason: "replied" | "unsubscribed" | "bounced" | "complained" | "withdrawn"): Promise<void> {
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

const BILLING_KINDS = new Set(["close", "precharge", "free_month", "refund"]);

/** Twilio refuses a number that texted STOP (error 21610): the owner is opted out at the carrier. */
const CARRIER_OPTED_OUT = /\b21610\b|unsubscribed recipient/i;

/**
 * Owner messages go out by text. With no cell on file, or texts turned off (the owner texted STOP, or their carrier
 * says they did), they go by email through the direct mail provider when there is one; otherwise they're marked
 * failed, which puts them in the operator's review queue. Nothing is ever "sent" to a log in production.
 * A cancelled client gets nothing more, except the refund text when they leave a yearly plan early.
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
    // the one exception: the refund we owe them when they leave a yearly plan early
    if (b.plan.stage === "cancelled" && m.kind !== "refund") {
      done("skipped", { error: "Cancelled: nothing more goes to the owner." });
      continue;
    }
    // a refund text waits for a person even with auto-send on: someone has to issue the refund first
    if (BILLING_KINDS.has(m.kind) && (d.cfg.AUTO_SEND_BILLING_TEXTS !== "true" || m.kind === "refund") && !opts.allowBilling) {
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
/** Pause or resume a client everywhere, including the sending platform (one path: holdSending). */
export async function setBusinessPaused(d: Deps, bid: string, paused: boolean): Promise<void> {
  await holdSending(d, bid, paused ? "pause" : "resume");
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
  await d.accounts.withAccount(bid, (state, ctx) => {
    const at = nowLocal(d, state);
    state.dataset = mergePulled(state.dataset, pulled, kind);
    state.dataset.asOf = at.slice(0, 10);
    // always-on: a request that just came in gets its answer now, not tomorrow (never for a client who
    // cancelled; while paused or braked the owner is told to call instead)
    answered = state.dataset.business.plan.stage === "cancelled" ? 0 : answerNewRequests(state, at, { paused: ctx.paused });
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
 * The owner forwarded a new request (a website form, an Angi or Thumbtack alert, a homeowner's email) to their
 * requests address. It goes on the same always-on track as a Jobber request: answered from the office, and
 * the owner texted who it is. What we can't read goes to a person, never a guess.
 */
export async function takeForwardedRequest(d: Deps, bid: string, m: { subject: string; text: string; from: string; receivedAt: string }): Promise<{ taken: boolean; answered: number; duplicate?: boolean; why?: string }> {
  const l = d.accounts.peek(bid);
  if (!l) return { taken: false, answered: 0, why: "no such business" };
  const b = l.state.dataset.business;
  const ignore = [b.ownerEmail, b.replyTo, b.fromEmail, ...extractEmails(m.from)].filter((x): x is string => !!x);
  let read = readRequestEmail({ subject: m.subject, text: m.text, from: m.from, ignore });
  if (!read.lead && d.llm) {
    const ai = await readRequestWithClaude(d.llm, { subject: m.subject, text: m.text, businessName: b.name }).catch(() => null);
    if (ai && !ignore.some((e) => e.toLowerCase() === ai.email)) read = { lead: ai };
  }
  if (!read.lead) {
    await raiseAlert(d, bid, { kind: "request_unread", title: "A forwarded request we couldn't read", detail: `${read.why ?? "No details we could use."} Subject: “${m.subject.slice(0, 120)}”. Call or answer them by hand.` });
    return { taken: false, answered: 0, why: read.why };
  }
  const lead = read.lead;
  let answered = 0;
  let duplicate = false;
  let on = true;
  await d.accounts.withAccount(bid, (state) => {
    const at = nowLocal(d, state);
    // the time it reached us, not the original email's date: the owner just handed it over, and it still wants an answer
    const t = takeRequest(state, lead, at, at);
    duplicate = t.duplicate;
    on = alwaysOnFor(state.dataset.business) && state.dataset.business.plan.stage !== "cancelled";
    if (!duplicate && on) answered = answerNewRequests(state, at, { paused: l.paused });
  });
  if (!duplicate && !on)
    await raiseAlert(d, bid, { kind: "request_forwarded", title: `Forwarded request from ${lead.name ?? lead.email ?? lead.phone}`, detail: `Through ${lead.source}: “${(lead.job ?? "").slice(0, 140)}”. Answering new requests starts with the paid plan, so nobody wrote back — pass it to the owner.` });
  await deliverOwnerMessages(d, bid);
  if (answered) await sendDue(d, bid);
  d.accounts.repo.audit(bid, "inbound", "request.forwarded", { source: lead.source, read: lead.read, duplicate, answered });
  return { taken: true, answered, duplicate };
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
  // a queued answer (held overnight) never goes to someone who has since asked us to stop
  const stopped =
    state.suppressions[task.to.toLowerCase()] ||
    state.suppressions[r.from] ||
    state.replies.some((x) => x.receivedAt > r.receivedAt && (x.from === r.from || (!!x.customerId && x.customerId === r.customerId)) && ["stop", "complaint", "not_interested"].includes(x.intent));
  if (stopped) {
    await d.accounts.withAccount(bid, (s) => {
      const live = s.replies.find((x) => x.id === r.id);
      if (live?.ack && !live.ack.sentAt) live.ack.error = "Not sent: they asked us to stop before it went";
    });
    return;
  }
  const b = state.dataset.business;
  const subject = /^re:/i.test(task.subject) ? task.subject : `Re: ${task.subject || "your note"}`;
  // the note they answered stays in the thread, so a reply to this answer still routes to this business
  const note = state.touches.find((t) => t.id === r.touchId)?.providerId;
  const refs = [note?.startsWith("<") ? note : undefined, task.messageId || undefined].filter((x): x is string => !!x);
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
        references: refs.length ? refs : undefined,
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
