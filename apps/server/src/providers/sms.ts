import { randomUUID } from "node:crypto";
import type { Fetch, OwnerNotifier } from "../contracts.ts";
import { ProviderError } from "../contracts.ts";

/**
 * Texts go to the business OWNER only (hand-offs, reminders, reports) — never to homeowners.
 * The owner signs up for them, so there's no TCPA consent problem; homeowner SMS stays off
 * until consent is recorded per person.
 */
export class LogNotifier implements OwnerNotifier {
  readonly name = "log";
  readonly sent: { to: { phone?: string; email?: string }; text: string; id: string }[] = [];
  constructor(private quiet = false) {}
  async notify(to: { phone?: string; email?: string }, text: string) {
    const id = `sms-log-${randomUUID()}`;
    this.sent.push({ to, text, id });
    if (!this.quiet) console.log(`[owner:log] → ${to.phone ?? to.email ?? "?"}\n${text}\n`);
    return { id, channel: "log" as const };
  }
}

export class TwilioNotifier implements OwnerNotifier {
  readonly name = "twilio";
  constructor(
    private cfg: { accountSid: string; authToken: string; from: string },
    private fetchImpl: Fetch = fetch,
    private fallback?: OwnerNotifier,
  ) {}

  async notify(to: { phone?: string; email?: string }, text: string) {
    if (!to.phone) {
      if (this.fallback) return this.fallback.notify(to, text);
      throw new ProviderError("Owner has no phone number on file", "twilio");
    }
    const body = new URLSearchParams({ To: to.phone, From: this.cfg.from, Body: text });
    const auth = Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString("base64");
    const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    // The error code stays in the message: 21610 means the owner opted out at the carrier (STOP).
    if (!res.ok) throw new ProviderError(`Twilio ${res.status}${json.code ? ` (${json.code})` : ""}: ${json.message ?? "send failed"}`, "twilio", res.status, res.status === 429 || res.status >= 500);
    return { id: json.sid ?? `twilio-${randomUUID()}`, channel: "sms" as const };
  }
}

/** Twilio signs inbound webhooks: HMAC-SHA1 over the full URL + sorted POST params, base64. */
export async function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | undefined): Promise<boolean> {
  if (!signature) return false;
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
