import type { Customer, Opportunity, Quote } from "../model.ts";
import { fmtMoney } from "../util.ts";

/**
 * Quotes an owner may NOT want chased — and customers they never want contacted.
 *
 * Owners told us plainly: some quotes are priced to lose ("the I-don't-want-to-deal-with-you price, almost
 * 10x", "headache money"), some are for realtors bargaining on a house or an HOA collecting bids, and some
 * customers are on a private do-not-serve list. Writing to those people embarrasses the owner. So they are
 * held back with a reason until someone OKs them — never silently sent.
 */

/** Tags owners use for people they won't work for again. These are never contacted. */
export const BAD_CUSTOMER = /\b(do not (service|work|quote|serve)|dns|black ?list(ed)?|bad (customer|client|payer)|difficult|nightmare|banned|never again|no more work|collections?)\b/i;

/** Words that say the quote was for someone who wasn't going to buy the work. */
const NOT_A_REAL_BID = /\b(realtor|real estate (agent|agency)|realty|listing agent|property manag\w*|insurance (claim|estimate|quote)|adjuster|hoa\b|homeowners? assoc\w*|bid (collection|comparison|request)|for comparison|estimate only|ballpark|budgetary|rough (number|estimate)|appraisal)\b/i;

/** Where the lead came from. Referrals and repeat clients close far better than marketplace leads. */
export const REFERRAL_SOURCE = /\b(referr\w*|friend|neighbou?r|word of mouth|repeat|past (client|customer)|existing (client|customer)|returning)\b/i;
export const MARKETPLACE_SOURCE = /\b(angi|angie'?s|home ?advisor|thumbtack|yelp|porch|networx|bark|houzz|craft ?jack|modernize|lsa|local services)\b/i;

export function isBadCustomer(c: Customer): boolean {
  return c.tags.some((t) => BAD_CUSTOMER.test(t));
}

export interface CautionContext {
  /** Median and 90th-percentile quote total per service id, from this shop's own quotes. */
  medianByService: Map<string, { p50: number; p90: number }>;
  /** The shop's typical (median) job. */
  typicalJob: number;
  /** Quotes at or over this go to the owner's call list, never email (0 = off). */
  callOver: number;
  /**
   * A "yes" from an export that says nothing about jobs (a QuickBooks, PaintScout or DripJobs estimate list with no
   * jobs file): "Won" or "Accepted" there can mean the job is long done, so it's checked before anyone writes.
   */
  noJobsToCheck?: boolean;
}

/** The caution line for a quote big enough that the owner should call. The call list keys on its prefix. */
export const CALL_LIST_REASON = "Over ";
export function isCallListReason(r: string): boolean {
  return r.startsWith(CALL_LIST_REASON) && r.includes("call list");
}

/** Reasons to hold this opportunity for a look before anyone writes to them. Empty = fine to send. */
export function cautionReasons(o: Opportunity, c: Customer | undefined, q: Quote | undefined, cc: CautionContext): string[] {
  const out: string[] = [];
  if (q && cc.callOver > 0 && q.total >= cc.callOver)
    out.push(`${CALL_LIST_REASON}${fmtMoney(cc.callOver)} — on your call list, not emailed`);
  if (q && ["unanswered_quote", "archived_quote", "declined_quote", "changes_requested"].includes(o.type)) {
    // Far outside this service's own normal range — not just a big job of a kind that varies a lot.
    const m = cc.medianByService.get(o.serviceId);
    if (m && q.total >= Math.max(m.p50 * 3, m.p90 * 1.5) && q.total >= cc.typicalJob * 2)
      out.push(`Priced ${Math.round(q.total / m.p50)}x your usual for this work — may have been a "go away" price`);
  }
  if (q && o.type === "approved_unscheduled" && cc.noJobsToCheck)
    out.push(`Marked "${q.rawStatus || "approved"}", but there are no jobs on file to check it against — make sure it wasn't already done`);
  const text = [q?.title, ...(q?.lineItems.map((l) => l.name) ?? []), c?.companyName, c?.name, ...(c?.tags ?? [])].filter(Boolean).join(" · ");
  const hit = text.match(NOT_A_REAL_BID);
  if (hit) out.push(`Mentions "${hit[0]}" — may not have been a real buyer`);
  return out;
}

export function medianByService(quotes: Quote[], serviceOf: (q: Quote) => string): Map<string, { p50: number; p90: number }> {
  const vals = new Map<string, number[]>();
  for (const q of quotes) {
    if (!(q.total > 0)) continue;
    const s = serviceOf(q);
    (vals.get(s) ?? vals.set(s, []).get(s)!).push(q.total);
  }
  const out = new Map<string, { p50: number; p90: number }>();
  for (const [s, v] of vals) {
    if (v.length < 10) continue;
    v.sort((a, b) => a - b);
    out.set(s, { p50: v[Math.floor(v.length / 2)]!, p90: v[Math.min(v.length - 1, Math.floor(v.length * 0.9))]! });
  }
  return out;
}
