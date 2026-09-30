/**
 * Instantly's Unibox emails: the recipient check before we answer in a thread, and the reply backstop for replies
 * Instantly's webhooks never announce.
 *
 * VERIFIED (OpenAPI spec https://api.instantly.ai/openapi/api_v2.json, help centre, npm @instantlyai/cli)
 *  - POST /api/v2/emails/reply takes reply_to_uuid, eaccount, subject and body{text|html}. It has NO `to` field, so
 *    Instantly checks no recipient. Instantly's own CLI first GETs /api/v2/emails/{reply_to_uuid}, collects the
 *    recipients (to_address_email_list, lead / lead_email, and from_address_email unless i_sent is true) and aborts
 *    on a mismatch (case-insensitive). Line breaks are only delivered through body.html (`<br/>`).
 *  - GET /api/v2/emails?email_type=received&min_timestamp_created=<ISO>&limit<=100 lists received emails
 *    (paginated with starting_after); mode=emode_others lists the "Others" folder. A reply from a different address
 *    (a spouse, a forward) lands there and never fires reply_received. The endpoint allows 20 requests a minute for
 *    the whole workspace.
 *  - Instantly can take minutes to hours to detect a reply; timestamp_created is when it did.
 *
 * ASSUMED
 *  - to_address_email_list is a comma-separated string (an array is accepted too).
 *  - Emails carry id, thread_id, eaccount, subject, timestamp_email and body{text, html}.
 *  - `search=thread:<thread_id>` returns a thread's emails. Results are filtered on thread_id, so a search that
 *    means something else finds nothing rather than the wrong thread.
 */
import type { PlatformEmail } from "../../contracts.ts";
import { htmlToText } from "./webhooks.ts";

export interface InstantlyEmail {
  id?: string;
  thread_id?: string | null;
  timestamp_created?: string | null;
  timestamp_email?: string | null;
  subject?: string | null;
  from_address_email?: string | null;
  to_address_email_list?: string | string[] | null;
  lead?: string | null;
  lead_email?: string | null;
  i_sent?: boolean | null;
  eaccount?: string | null;
  campaign_id?: string | null;
  body?: { text?: string | null; html?: string | null } | null;
  content_preview?: string | null;
}

const ADDRESS = /[^\s<>"',;:()[\]]+@[^\s<>"',;:()[\]]+\.[a-z]{2,}/gi;

/** Lowercased addresses in a field that may be a string, a comma list, an array or "Name <addr>". */
export function addressesIn(v: unknown): string[] {
  const parts = Array.isArray(v) ? v : [v];
  return parts.flatMap((p) => (typeof p === "string" ? (p.match(ADDRESS) ?? []) : [])).map((a) => a.toLowerCase());
}

/** Everyone the email we'd answer is between, per Instantly's CLI check. */
export function recipientsOf(e: InstantlyEmail): Set<string> {
  return new Set([
    ...addressesIn(e.to_address_email_list),
    ...addressesIn(e.lead),
    ...addressesIn(e.lead_email),
    ...(e.i_sent === true ? [] : addressesIn(e.from_address_email)),
  ]);
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function iso(v: unknown): string | undefined {
  const t = str(v) ? Date.parse(str(v)!) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** Instantly's email → ours. Undefined when it lacks what we need to act on it. */
export function toPlatformEmail(e: InstantlyEmail): PlatformEmail | undefined {
  const id = str(e?.id);
  const from = addressesIn(e?.from_address_email)[0];
  const createdAt = iso(e?.timestamp_created) ?? iso(e?.timestamp_email);
  if (!id || !from || !createdAt) return undefined;
  const html = str(e.body?.html);
  return {
    id,
    threadId: str(e.thread_id),
    from,
    lead: addressesIn(e.lead)[0] ?? addressesIn(e.lead_email)[0],
    to: addressesIn(e.to_address_email_list),
    account: addressesIn(e.eaccount)[0],
    subject: str(e.subject),
    text: str(e.body?.text) ?? (html ? htmlToText(html) : undefined) ?? str(e.content_preview) ?? "",
    receivedAt: iso(e.timestamp_email) ?? createdAt,
    createdAt,
    campaignId: str(e.campaign_id),
    sentByUs: e.i_sent === true,
  };
}
