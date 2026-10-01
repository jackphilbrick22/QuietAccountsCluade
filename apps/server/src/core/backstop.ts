import type { InboundEvent, PlatformEmail, SequencerProvider } from "../contracts.ts";
import { webhookUrlFor } from "../integrations/instantly/webhooks.ts";
import { alertOperator, handleInbound, whoIs, type Deps } from "./ops.ts";
import { coldEvent } from "./senders.ts";

/**
 * The sending platform's webhooks are not enough on their own:
 *  - Instantly can take minutes to hours to detect a reply, and a reply from another address (a spouse, a forward)
 *    lands in its "Others" folder without any webhook at all. So the worker also reads what it received.
 *  - Instantly switches a webhook off after repeated failed deliveries. So the worker turns it back on and says so.
 * Workspace-wide state (the poll cursor, when webhooks were last checked) lives in one integration record.
 */

/** The integration record for the sending platform belongs to no one client. */
export const WORKSPACE = "_workspace";
/** At most this often: GET /emails allows 20 requests a minute for the whole workspace. */
export const REPLY_POLL_MS = 3 * 60_000;
export const WEBHOOK_CHECK_MS = 15 * 60_000;
/** The first poll looks back this far (webhooks covered the time before). */
const FIRST_LOOKBACK_MS = 60 * 60_000;
/** Each poll re-reads a few minutes before the newest email it saw; the dedupe makes the overlap free. */
const OVERLAP_MS = 5 * 60_000;
/** Thread lookups per poll (each is one more request against the same limit). */
const MAX_THREAD_LOOKUPS = 3;

/** One key per platform email, claimed by whichever reads the reply first: the webhook or the poll. */
export const replyEmailKey = (provider: string, emailId: string) => `${provider}:email:${emailId}`;

/** Emails the poll couldn't tie to anyone (this process): not re-looked-up on every overlapping poll. */
const unmatched = new Set<string>();

export async function pollReplies(d: Deps, opts: { force?: boolean } = {}): Promise<{ checked: number; processed: number; unmatched: number } | undefined> {
  const seq = d.email;
  if (seq.kind !== "sequencer" || !seq.receivedSince) return undefined;
  const repo = d.accounts.repo;
  const now = d.clock();
  const rec = repo.getIntegration(WORKSPACE, seq.name);
  if (!opts.force && rec?.last_sync_at && now.getTime() - Date.parse(rec.last_sync_at) < REPLY_POLL_MS) return undefined;
  const since = rec?.cursor ?? new Date(now.getTime() - FIRST_LOOKBACK_MS).toISOString();
  const out = { checked: 0, processed: 0, unmatched: 0 };
  let newest = since;
  // the oldest email left for a later poll because this one ran out of thread lookups: the cursor stays before it
  let deferred: string | undefined;
  let lookups = 0;
  try {
    for (const folder of ["primary", "others"] as const) {
      const emails = (await seq.receivedSince(since, { folder })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const e of emails) {
        out.checked++;
        if (e.createdAt > newest) newest = e.createdAt;
        const key = replyEmailKey(seq.name, e.id);
        if (e.sentByUs || repo.hasWebhook(key) || unmatched.has(key)) continue;
        // cold email in the same workspace: logged, never matched or read
        const cold = coldEvent(d, { campaignId: e.campaignId, inbox: e.account });
        if (cold) {
          if (repo.logWebhook(key, `${seq.name}-poll`, JSON.stringify(e), now.toISOString())) repo.finishWebhook(key, "ignored", undefined, `cold email: ${cold}`);
          d.log(`[backstop] skipped ${e.from}'s email: ${cold}`);
          continue;
        }
        const match = await matchEmail(d, seq, e, () => lookups++ < MAX_THREAD_LOOKUPS);
        if (match === "later") {
          if (!deferred || e.createdAt < deferred) deferred = e.createdAt;
          continue;
        }
        if (!match) {
          out.unmatched++;
          if (unmatched.size > 5000) unmatched.clear();
          unmatched.add(key);
          continue;
        }
        if (!repo.logWebhook(key, `${seq.name}-poll`, JSON.stringify(e), now.toISOString())) continue;
        // read before this key existed (an older webhook delivery): don't hand it to the owner twice
        if (match.businessId && d.accounts.peek(match.businessId)?.state.replies.some((r) => r.thread?.replyEmailId === e.id)) {
          repo.finishWebhook(key, "ignored", match.businessId, "already read");
          continue;
        }
        const ev: InboundEvent = {
          type: "reply",
          ...(match.businessId ? { businessId: match.businessId } : {}),
          ...(e.campaignId ? { campaignId: e.campaignId } : {}),
          from: e.from,
          subject: e.subject,
          text: e.text,
          receivedAt: e.receivedAt,
          replyEmailId: e.id,
          toAccount: e.account ?? e.to[0],
          ...(match.inReplyTo ? { inReplyTo: match.inReplyTo } : {}),
          ...(match.customerId ? { customerId: match.customerId } : {}),
        };
        try {
          const done = await handleInbound(d, ev);
          repo.finishWebhook(key, "processed", done.businessIds.join(",") || undefined, done.review);
          out.processed++;
        } catch (err) {
          repo.finishWebhook(key, "failed", match.businessId, (err as Error).message);
          repo.enqueue("inbound.retry", { event: JSON.stringify(ev) }, { runAt: new Date(now.getTime() + 60_000).toISOString() });
        }
      }
    }
  } catch (err) {
    repo.putIntegration(WORKSPACE, seq.name, { lastSyncAt: now.toISOString(), lastError: `Reply check failed: ${(err as Error).message}` });
    throw err;
  }
  const upTo = deferred ? Math.min(Date.parse(newest) - OVERLAP_MS, Date.parse(deferred) - 1) : Date.parse(newest) - OVERLAP_MS;
  const cursor = new Date(Math.max(Date.parse(since), upTo)).toISOString();
  repo.putIntegration(WORKSPACE, seq.name, { cursor, lastSyncAt: now.toISOString(), lastError: null });
  if (out.processed) d.log(`[backstop] read ${out.processed} ${out.processed === 1 ? "reply" : "replies"} no webhook announced`);
  return out;
}

/**
 * Whose reply is this? The sender, if we wrote to them. Otherwise the lead the platform filed it under, or anyone
 * we wrote to in its thread (a spouse, a forward): then it is tied to the last note we sent that person. The
 * campaign it came in on narrows an address several clients share; with nothing to narrow it, no business is
 * named ({}): the inbound router honors a stop everywhere and leaves anything else to a person. Undefined: nobody
 * we know at all (a newsletter in the shared inbox).
 */
async function matchEmail(d: Deps, seq: SequencerProvider, e: PlatformEmail, mayLookUp: () => boolean): Promise<{ businessId?: string; customerId?: string; inReplyTo?: string } | "later" | undefined> {
  const repo = d.accounts.repo;
  const inCampaign = e.campaignId ? repo.businessesForProvider(`${seq.name}:${e.campaignId}:`) : [];
  const among = inCampaign.length === 1 ? inCampaign[0] : undefined;
  const known = (addr?: string) => !!addr && repo.businessesForEmail(addr).length > 0;
  const bareAddr = (s?: string) => s?.match(/[^\s<>]+@[^\s<>]+/)?.[0]?.toLowerCase();
  // the campaign the thread belongs to: the email's own, or our note in the same thread
  let campaignId = e.campaignId;
  let ambiguous = false;
  /** Who our note in this thread went to (one lookup against the platform's limit). */
  const fromThread = async (threadId: string, opts: { ourNotesOnly?: boolean } = {}) => {
    for (const t of await seq.threadEmails!(threadId)) {
      // who we wrote to, never who else wrote in: a spouse's earlier reply doesn't make it her thread
      if (opts.ourNotesOnly && !t.sentByUs) continue;
      for (const addr of [t.lead, ...(t.sentByUs ? t.to : [t.from])]) {
        const who = addr ? whoIs(d, addr, among) : undefined;
        ambiguous ||= !who && known(addr);
        if (who) {
          campaignId ??= t.campaignId;
          return who;
        }
      }
    }
    return undefined;
  };
  let lead = e.lead ? whoIs(d, e.lead, among) : undefined;
  if (known(e.from)) {
    const sender = whoIs(d, e.from, among);
    // A spouse with a record of their own answering our note to someone else: it's about the note we sent that
    // person, so the reply goes in with that note (and a stop stops them too). With no lead on the email, our note
    // in the thread says who that was.
    let other = lead && bareAddr(e.lead) !== bareAddr(e.from) && (!sender || lead.businessId === sender.businessId) ? lead : undefined;
    if (!other && !e.lead && e.threadId && seq.threadEmails) {
      if (!mayLookUp()) return "later";
      // our note there went to her: her own thread, so she's the one writing about it
      const was = await fromThread(e.threadId, { ourNotesOnly: true });
      if (was && (!sender || (was.businessId === sender.businessId && was.customerId !== sender.customerId))) other = was;
    }
    if (!other) return sender ? { businessId: sender.businessId } : {};
    lead = other;
  }
  ambiguous ||= !lead && known(e.lead);
  if (!lead && !ambiguous && e.threadId && seq.threadEmails) {
    // out of lookups for this poll: "later", never "nobody", so a spouse's reply isn't written off for good
    if (!mayLookUp()) return "later";
    lead = await fromThread(e.threadId);
  }
  if (!lead) return ambiguous ? {} : undefined;
  // The note it answers is one in the email's own campaign (sent before queued, newest first); with no campaign to go
  // by, only the person is passed on and the engine picks their note by its own rules, never a guess across campaigns.
  const touches = d.accounts.peek(lead.businessId)?.state.touches ?? [];
  const note = campaignId
    ? touches
        .filter((t) => t.customerId === lead.customerId && t.providerId?.startsWith(`${seq.name}:${campaignId}:`) && (t.status === "sent" || t.status === "approved"))
        .sort((a, b) => Number(b.status === "sent") - Number(a.status === "sent") || ((a.sentAt ?? a.dueAt) < (b.sentAt ?? b.dueAt) ? 1 : -1))[0]
    : undefined;
  return { businessId: lead.businessId, customerId: lead.customerId, ...(note?.providerId ? { inReplyTo: note.providerId } : {}) };
}

/** Where the sending platform's webhook registration stands: "unknown" until the first try. */
export interface WebhookSetup {
  ok: boolean;
  at: string;
  error?: string;
}

function workspaceSettings(d: Deps, name: string): { webhooksCheckedAt?: string; webhooks?: WebhookSetup } {
  return JSON.parse(d.accounts.repo.getIntegration(WORKSPACE, name)?.settings ?? "{}");
}

export function webhookSetup(d: Deps): WebhookSetup | undefined {
  return d.email.kind === "sequencer" ? workspaceSettings(d, d.email.name).webhooks : undefined;
}

/**
 * Register our webhook with the sending platform (boot, then by the worker until it works). The result is kept in
 * the workspace record, so a failure shows on the review queue and /api/health — not only in a boot log line.
 */
export async function registerWebhooks(d: Deps): Promise<boolean> {
  const seq = d.email;
  if (seq.kind !== "sequencer" || !seq.registerWebhooks) return true;
  const at = d.clock().toISOString();
  const save = (webhooks: WebhookSetup) => d.accounts.repo.putIntegration(WORKSPACE, seq.name, { settings: { ...workspaceSettings(d, seq.name), webhooks } });
  try {
    const r = await seq.registerWebhooks(webhookUrlFor(d.cfg.PUBLIC_URL, d.cfg.WEBHOOK_SECRET));
    save({ ok: true, at });
    d.log(`[${seq.name}] webhooks ready (${JSON.stringify(r)})`);
    return true;
  } catch (e) {
    const error = (e as Error).message;
    save({ ok: false, at, error });
    await alertOperator(d, {
      key: "webhooks_register",
      title: `${seq.name === "instantly" ? "Instantly" : seq.name} webhooks aren't registered — replies and bounces may not arrive`,
      detail: `${error} We retry every 15 minutes; the reply check still reads the inbox meanwhile.`,
    });
    return false;
  }
}

/** Turn back on any webhook the platform disabled after failed deliveries, and tell the operator. */
export async function checkWebhooks(d: Deps, opts: { force?: boolean } = {}): Promise<{ resumed: number } | undefined> {
  const seq = d.email;
  if (seq.kind !== "sequencer" || !seq.resumeWebhooks) return undefined;
  const repo = d.accounts.repo;
  const now = d.clock();
  const settings = workspaceSettings(d, seq.name);
  if (!opts.force && settings.webhooksCheckedAt && now.getTime() - Date.parse(settings.webhooksCheckedAt) < WEBHOOK_CHECK_MS) return undefined;
  repo.putIntegration(WORKSPACE, seq.name, { settings: { ...settings, webhooksCheckedAt: now.toISOString() } });
  // registration failed before (at boot, say): try again until it works
  if (settings.webhooks && !settings.webhooks.ok) await registerWebhooks(d);
  const resumed = await seq.resumeWebhooks();
  if (resumed.length) {
    const where = [...new Set(resumed.map((w) => w.url))].join(", ");
    await alertOperator(d, {
      key: "webhooks_resumed",
      title: `Instantly had switched off ${resumed.length === 1 ? "a webhook" : `${resumed.length} webhooks`} — turned back on`,
      detail: `It does that after repeated failed deliveries to ${where}. Replies from the gap are picked up by the reply check; if it keeps happening, check that the server is reachable.`,
    });
    repo.putIntegration(WORKSPACE, seq.name, { lastError: `Resumed disabled webhooks: ${where}` });
  }
  return { resumed: resumed.length };
}
