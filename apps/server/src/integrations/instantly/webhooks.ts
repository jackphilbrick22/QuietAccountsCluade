/**
 * Instantly webhooks: register them (idempotently) and turn their payloads into our InboundEvent.
 *
 * VERIFIED — https://developer.instantly.ai/guides/webhook-events
 *  - Payload base fields: timestamp (ISO), event_type, workspace, campaign_id, campaign_name. Optional fields:
 *    lead_email, email_account, unibox_url (reply events), step (from 1), variant (from 1), is_first, email_id,
 *    email_subject, email_text, email_html (sent emails), reply_text_snippet, reply_subject, reply_text,
 *    reply_html (replies). "Additional lead data fields from your database may appear as extra keys."
 *  - Event types: email_sent, email_opened, reply_received, auto_reply_received, link_clicked, email_bounced,
 *    lead_unsubscribed, account_error, campaign_completed, lead_neutral / lead_interested / lead_not_interested,
 *    lead_meeting_booked, lead_meeting_completed, lead_closed, lead_out_of_office, lead_wrong_person. A custom label
 *    is sent as `event_type` as-is. There is NO spam-complaint event.
 *  - POST /api/v2/webhooks { target_hook_url (must match ^https?://), event_type, campaign?, name?, headers? }.
 *    The event_type enum is: all_events, email_sent, email_opened, email_link_clicked, reply_received,
 *    email_bounced, lead_unsubscribed, campaign_completed, account_error, lead_neutral, lead_interested,
 *    lead_not_interested, lead_meeting_booked, lead_meeting_completed, lead_closed, lead_out_of_office,
 *    lead_wrong_person, lead_no_show, supersearch_enrichment_completed. `auto_reply_received` is NOT subscribable
 *    on its own: it only arrives via "all_events". That is why DEFAULT_WEBHOOK_EVENTS is ["all_events"].
 *    https://developer.instantly.ai/api-reference/webhook/create-webhook
 *  - GET /api/v2/webhooks → { items[{ id, target_hook_url, event_type, campaign, status }], next_starting_after }.
 *    status 1 = active, -1 = disabled after repeated delivery failures. POST /api/v2/webhooks/{id}/resume
 *    re-enables a disabled webhook. https://developer.instantly.ai/api-reference/webhook/list-webhooks ,
 *    https://developer.instantly.ai/api-reference/webhook/resume-a-webhook
 *  - Deliveries are retried (webhook event objects carry retry_count / will_retry), so the receiver must be
 *    idempotent. instantlyWebhookKey() gives a stable dedupe id.
 *    https://developer.instantly.ai/api-reference/webhookevent/get-webhook-event
 *
 * ASSUMED
 *  - Our lead custom variables (qa_business_id...) come back as top-level payload keys, per "lead data fields may
 *    appear as extra keys". We also look inside a nested `payload` object. When neither has it, businessId is
 *    undefined and the caller resolves the business from campaign_id.
 *    The same goes for qa_touch_N, which names the exact note an email_sent was for.
 *  - account_error names the broken mailbox in email_account; its reason, if any, is in error / error_message /
 *    message / reason. It carries no lead_email.
 *  - A custom label named like "complaint"/"spam" maps to a complaint. This only fires if someone creates such a label.
 *  - The secret travels in the URL path (config WEBHOOK_SECRET is "embedded in inbound webhook URLs"). The route
 *    must be mounted at INSTANTLY_WEBHOOK_PATH + "/:secret".
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { InboundEvent } from "../../contracts.ts";
import { ProviderError } from "../../contracts.ts";
import type { InstantlyClient } from "./client.ts";
import { VAR } from "./campaign.ts";

export const INSTANTLY_WEBHOOK_PATH = "/webhooks/instantly";

/** Event types POST /webhooks accepts (spec enum). */
export const SUBSCRIBABLE_EVENT_TYPES = [
  "all_events", "email_sent", "email_opened", "email_link_clicked", "reply_received", "email_bounced",
  "lead_unsubscribed", "campaign_completed", "account_error", "lead_neutral", "lead_interested",
  "lead_not_interested", "lead_meeting_booked", "lead_meeting_completed", "lead_closed", "lead_out_of_office",
  "lead_wrong_person", "lead_no_show", "supersearch_enrichment_completed",
] as const;
export type SubscribableEventType = (typeof SUBSCRIBABLE_EVENT_TYPES)[number];

/** "all_events" is the only way to receive auto_reply_received. We read every reply, including ones Instantly calls automatic. */
export const DEFAULT_WEBHOOK_EVENTS: readonly SubscribableEventType[] = ["all_events"];

export function webhookUrlFor(publicUrl: string, secret: string): string {
  if (!secret) throw new ProviderError("Webhook secret is empty", "instantly");
  return `${publicUrl.replace(/\/+$/, "")}${INSTANTLY_WEBHOOK_PATH}/${encodeURIComponent(secret)}`;
}

/** Constant-time check of the secret the route received against the configured one. */
export function webhookSecretMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Payload → InboundEvent                                              */
/* ------------------------------------------------------------------ */

export interface InstantlyWebhookPayload {
  event_type?: string;
  timestamp?: string;
  workspace?: string;
  campaign_id?: string;
  campaign_name?: string;
  lead_email?: string;
  email_account?: string;
  unibox_url?: string;
  step?: number | string;
  variant?: number | string;
  is_first?: boolean;
  email_id?: string;
  email_subject?: string;
  email_text?: string;
  email_html?: string;
  reply_text_snippet?: string;
  reply_subject?: string;
  reply_text?: string;
  reply_html?: string;
  [extra: string]: unknown;
}

function asPayload(body: unknown): InstantlyWebhookPayload | undefined {
  let value = body;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const p = value as InstantlyWebhookPayload;
  return typeof p.event_type === "string" && p.event_type ? p : undefined;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function isoTime(v: unknown, now: Date): string {
  const s = str(v);
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? now.toISOString() : new Date(t).toISOString();
}

/** One of our lead custom variables, whether Instantly flattened it into the payload or nested it. */
function leadVar(p: InstantlyWebhookPayload, key: string): string | undefined {
  const nested = p.payload && typeof p.payload === "object" ? (p.payload as Record<string, unknown>)[key] : undefined;
  return str(p[key]) ?? str(nested);
}

/** Minimal HTML → text for reply bodies that come without reply_text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const REPLY_EVENTS = new Set(["reply_received", "auto_reply_received"]);

/** Normalize an Instantly webhook body (object or raw JSON string). Undefined for events we don't act on. */
export function parseInstantlyWebhook(body: unknown, now: Date = new Date()): InboundEvent | undefined {
  const p = asPayload(body);
  if (!p) return undefined;
  const type = p.event_type!.trim();
  const at = isoTime(p.timestamp, now);
  const campaignId = str(p.campaign_id);
  const businessId = leadVar(p, VAR.businessId);
  // About a mailbox, not a lead: no lead_email.
  if (type === "account_error") {
    const detail = str(p.error) ?? str(p.error_message) ?? str(p.message) ?? str(p.reason);
    return { type: "account_error", businessId, campaignId, account: str(p.email_account)?.toLowerCase(), detail, at };
  }
  const email = str(p.lead_email)?.toLowerCase();
  if (!email) return undefined;

  if (REPLY_EVENTS.has(type)) {
    const text = str(p.reply_text) ?? (str(p.reply_html) ? htmlToText(p.reply_html!) : undefined) ?? str(p.reply_text_snippet) ?? "";
    return { type: "reply", businessId, campaignId, from: email, subject: str(p.reply_subject), text, receivedAt: at, replyEmailId: str(p.email_id), toAccount: str(p.email_account) };
  }
  switch (type) {
    case "email_sent": {
      const step = num(p.step);
      // our own qa_touch_N variable names the exact note, even when the person is in two campaigns
      const touchId = step !== undefined ? leadVar(p, VAR.touch(step)) : undefined;
      return { type: "sent", businessId, campaignId, email, step, providerId: str(p.email_id), sentAt: at, ...(touchId ? { touchId } : {}) };
    }
    case "email_bounced":
      return { type: "bounce", businessId, campaignId, email, at, detail: num(p.step) !== undefined ? `bounced on step ${num(p.step)}` : undefined };
    case "lead_unsubscribed":
      return { type: "unsubscribe", businessId, campaignId, email, at };
  }
  if (/complain|spam/i.test(type)) return { type: "complaint", businessId, campaignId, email, at };
  return undefined;
}

/** True when Instantly itself flagged the reply as automatic (out-of-office etc.). */
export function isInstantlyAutoReply(body: unknown): boolean {
  return asPayload(body)?.event_type === "auto_reply_received";
}

/** Stable id for one delivery, so retried deliveries dedupe (e.g. webhook_log primary key). */
export function instantlyWebhookKey(body: unknown): string | undefined {
  const p = asPayload(body);
  if (!p) return undefined;
  const parts = [p.event_type, str(p.lead_email)?.toLowerCase(), p.campaign_id, p.step, p.email_id, p.timestamp].map((x) => (x === undefined || x === null ? "" : String(x)));
  return `instantly:${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40)}`;
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

interface InstantlyWebhook {
  id: string;
  target_hook_url: string;
  event_type?: string | null;
  campaign?: string | null;
  status?: number | null;
}

export interface EnsureWebhooksResult {
  created: { id: string; eventType: string }[];
  existing: { id: string; eventType: string }[];
  resumed: { id: string; eventType: string }[];
}

/**
 * Make sure a workspace-wide webhook exists for each event type → `url`. It lists first, so it is safe to call on
 * every boot. A webhook Instantly disabled after failed deliveries (status -1) gets resumed.
 */
export async function ensureWebhooks(
  client: InstantlyClient,
  url: string,
  events: readonly string[] = DEFAULT_WEBHOOK_EVENTS,
  opts: { name?: string; headers?: Record<string, string> } = {},
): Promise<EnsureWebhooksResult> {
  if (!/^https?:\/\//.test(url)) throw new ProviderError(`Webhook URL must start with http(s):// (got ${url})`, "instantly");
  const wanted = [...new Set(events)];
  for (const e of wanted) {
    if (!(SUBSCRIBABLE_EVENT_TYPES as readonly string[]).includes(e)) {
      throw new ProviderError(`Instantly can't subscribe to "${e}" directly${e === "auto_reply_received" ? ' (it only arrives via "all_events")' : ""}`, "instantly");
    }
  }
  const existing: InstantlyWebhook[] = [];
  for await (const w of client.paginate<InstantlyWebhook>("/webhooks")) existing.push(w);

  const result: EnsureWebhooksResult = { created: [], existing: [], resumed: [] };
  for (const eventType of wanted) {
    const match = existing.find((w) => w.target_hook_url === url && w.event_type === eventType && !w.campaign);
    if (match) {
      if (match.status === -1) {
        await client.post(`/webhooks/${encodeURIComponent(match.id)}/resume`, undefined, { idempotent: true });
        result.resumed.push({ id: match.id, eventType });
      } else {
        result.existing.push({ id: match.id, eventType });
      }
      continue;
    }
    const body: Record<string, unknown> = { target_hook_url: url, event_type: eventType, name: opts.name ?? `Quiet Accounts · ${eventType}` };
    if (opts.headers && Object.keys(opts.headers).length) body.headers = opts.headers;
    const created = await client.post<InstantlyWebhook>("/webhooks", body, { idempotent: false });
    result.created.push({ id: created?.id ?? "", eventType });
  }
  return result;
}

/** Resume every webhook in the workspace that Instantly disabled (status -1) after failed deliveries. */
export async function resumeDisabledWebhooks(client: InstantlyClient): Promise<{ id: string; url: string; eventType?: string }[]> {
  const disabled: InstantlyWebhook[] = [];
  for await (const w of client.paginate<InstantlyWebhook>("/webhooks")) if (w?.id && w.status === -1) disabled.push(w);
  for (const w of disabled) await client.post(`/webhooks/${encodeURIComponent(w.id)}/resume`, undefined, { idempotent: true });
  return disabled.map((w) => ({ id: w.id, url: w.target_hook_url, ...(w.event_type ? { eventType: w.event_type } : {}) }));
}
