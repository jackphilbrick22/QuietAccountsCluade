import type { BreakageType, ISODate } from "../model.ts";
import { addDays } from "../util.ts";
import type { ScanResult } from "./detect.ts";
import { WINDOW } from "./assumptions.ts";

/** An owner whose list refills with about this many newly lapsed or due customers a month is offered monthly (BRIEF §2). */
export const MONTHLY_REFILL = 30;

const PAST: BreakageType[] = ["lapsed_regular", "one_and_done", "service_due"];

/**
 * "Who gets monthly": past customers who stopped or came due in the last 12 months, a month on average, from the scan.
 * A regular stops at the last visit, a one-time customer counts once the one-and-done wait is up, and work on a clock
 * when it comes due. Only people we can email, whether or not we've written to them; anyone who came back, has work
 * on now or can't be written to isn't counted.
 */
export function refillRate(scan: ScanResult, asOf: ISODate): { perMonth: number; monthly: boolean } {
  const from = addDays(asOf, -365);
  const who = new Set<string>();
  for (const o of scan.opportunities) {
    if (!PAST.includes(o.type) || !o.anchorDate || !o.channels.includes("email") || (o.suppressed && o.suppressed !== "recently_contacted")) continue;
    // (a client list's one date waits only the trade's quiet spell, so its one-time customers count from today at most)
    const on = o.type === "one_and_done" ? [addDays(o.anchorDate, WINDOW.one_and_done.minDays), asOf].sort()[0]! : o.anchorDate;
    if (on > from && on <= asOf) who.add(o.customerId);
  }
  const perMonth = Math.round(who.size / 12);
  return { perMonth, monthly: perMonth >= MONTHLY_REFILL };
}
