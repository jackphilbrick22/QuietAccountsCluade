import { resolve4, resolveMx } from "node:dns/promises";

export type MailCheckResult = "ok" | "no_mail" | "unknown";
export type MailCheck = (domain: string) => Promise<MailCheckResult>;

/**
 * Does this domain accept mail at all? Old quote lists carry dead domains (closed ISPs, typo'd company
 * sites); every one is a guaranteed bounce, and bounces are what get a sender throttled. Checked once per
 * domain per day. Lookup failures other than "doesn't exist" come back "unknown" and never block a send.
 */
export function createMailCheck(opts: { ttlMs?: number; lookupMx?: typeof resolveMx; lookupA?: typeof resolve4 } = {}): MailCheck {
  const ttl = opts.ttlMs ?? 24 * 3600_000;
  const mx = opts.lookupMx ?? resolveMx;
  const a = opts.lookupA ?? resolve4;
  const cache = new Map<string, { at: number; result: MailCheckResult }>();
  const gone = (e: unknown) => ["ENOTFOUND", "ENODATA", "NXDOMAIN"].includes((e as { code?: string }).code ?? "");
  return async (domain) => {
    const key = domain.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.result;
    let result: MailCheckResult;
    try {
      const records = await mx(key);
      result = records.some((r) => r.exchange && r.exchange !== ".") ? "ok" : "no_mail"; // "." = null MX (RFC 7505)
    } catch (e) {
      if (!gone(e)) result = "unknown";
      else {
        // No MX record: a bare A record still means mail goes to the host itself (RFC 5321 §5.1).
        try {
          result = (await a(key)).length ? "ok" : "no_mail";
        } catch (e2) {
          result = gone(e2) ? "no_mail" : "unknown";
        }
      }
    }
    cache.set(key, { at: Date.now(), result });
    return result;
  };
}
