import type { BreakageType, BusinessProfile } from "../model.ts";

/**
 * Recovery priors: the share of reachable opportunities of each type that turn into
 * booked, paid work within ~90 days of a full sequence. Deliberately conservative.
 *
 * These are PRIORS, shown to owners as "how we estimate", and replaced by each
 * business's own measured rates as soon as it has results (see calibrate()).
 * Never present these as promises or as industry statistics.
 */
export const RECOVERY_PRIOR: Record<BreakageType, number> = {
  approved_unscheduled: 0.4, // they already said yes
  unpaid_invoice: 0.45, // the work is done; a polite nudge collects many
  changes_requested: 0.15, // they engaged and asked for something
  unquoted_request: 0.1, // asked for a price, never got one
  service_due: 0.1, // septic/chimney/gutter clocks
  lapsed_regular: 0.09,
  unanswered_quote: 0.05,
  archived_quote: 0.04,
  declined_option: 0.05,
  one_and_done: 0.035,
  missed_upsell: 0.03,
  declined_quote: 0.015,
};

/**
 * Quotes older than this never repeat the old price: owners re-bid old work (materials,
 * labor and the tree itself have all grown), and a homeowner who hears the old number
 * expects it. Notes offer a fresh look instead, and the owner's hand-off says so.
 */
export const STALE_QUOTE_DAYS = 180;

/**
 * Quotes at or over this amount are never emailed; they go on the owner's call list. A job that size
 * deserves a phone call from the owner, and the Jobber app listing promises it ("skips quotes over
 * $10,000"). Per business via \`callOverAmount\`; 0 turns it off.
 */
export const CALL_OVER_AMOUNT = 10_000;

/** Never more than this many notes to one person about one quote or job. */
export const MAX_NOTES_PER_THREAD = 3;

/** Multipliers applied to the prior. */
export const ADJUST = {
  /** Hazard work (dead trees, backups, leaks) — the problem keeps asking. */
  hazard: 1.3,
  repair: 1.15,
  /** Service is in season right now / soon / out of season. */
  seasonNow: 1.15,
  seasonSoon: 1.0,
  seasonOff: 0.75,
  /** They've paid this business before. */
  pastCustomer: 1.35,
  /** Quote is 4x+ this shop's typical job: shopped against other bids, price shock, financing. */
  bigTicket: 0.8,
  /** They opened the quote online (Jobber client hub) — they looked. */
  viewed: 1.2,
  /** Lead came by referral or is a repeat client (owners report 75-85%+ close rates on referrals). */
  referral: 1.25,
  /** Lead came from a shared marketplace (Angi, HomeAdvisor, Thumbtack): shopped hard, often ghosted. */
  marketplace: 0.8,
  /** Contact only by postcard (no email). */
  postcardOnly: 0.5,
};

/** Age decay for quote-type opportunities: [maxAgeDays, multiplier]. */
export const AGE_DECAY: [number, number][] = [
  [90, 1.25],
  [180, 1.1],
  [365, 1.0],
  [548, 0.8],
  [730, 0.65],
  [1095, 0.5],
  [Infinity, 0.35],
];

/** How long after an anchor date each type stays worth working (days). */
export const WINDOW: Record<BreakageType, { minDays: number; maxDays: number }> = {
  unanswered_quote: { minDays: 21, maxDays: 1095 },
  archived_quote: { minDays: 21, maxDays: 1095 },
  changes_requested: { minDays: 7, maxDays: 730 },
  approved_unscheduled: { minDays: 14, maxDays: 540 },
  unquoted_request: { minDays: 5, maxDays: 365 },
  declined_option: { minDays: 30, maxDays: 730 },
  declined_quote: { minDays: 120, maxDays: 730 },
  one_and_done: { minDays: 300, maxDays: 2190 },
  lapsed_regular: { minDays: 45, maxDays: 1095 },
  service_due: { minDays: 0, maxDays: 1460 },
  missed_upsell: { minDays: 3, maxDays: 540 },
  unpaid_invoice: { minDays: 7, maxDays: 730 },
};

/**
 * Always-on: how soon after the event we step in. A quote gets its first follow-up two days after it was
 * sent (the trade press standard is "confirm it arrived, then call at five business days"); a fresh quote
 * runs its own four-note sequence for ~3 weeks, then joins the normal re-check cycle.
 */
export const ALWAYS_ON_MIN_DAYS: Partial<Record<BreakageType, number>> = {
  unanswered_quote: 2,
  changes_requested: 3,
  unquoted_request: 2,
  approved_unscheduled: 7,
};
export const FRESH_QUOTE_DAYS = 30;

/** Always-on is the paid product; the free round is the backlog sweep. An operator can switch it either way. */
export function alwaysOnFor(b: BusinessProfile): boolean {
  return b.alwaysOn ?? b.plan.stage === "paying";
}

/** Forecast bands around the expected value. */
export const BAND = { conservative: 0.6, likely: 1.0, strong: 1.5 };

/** Plain-English labels for each breakage type, as an owner would say it. */
export const BREAKAGE_LABEL: Record<BreakageType, { title: string; short: string; explain: string; icon: string }> = {
  unanswered_quote: {
    title: "Quotes nobody answered",
    short: "No answer",
    explain: "You sent a price, they never said yes or no, and the follow-ups stopped. Most of these people didn't say no — nobody asked again.",
    icon: "mail-question",
  },
  archived_quote: {
    title: "Quotes filed away",
    short: "Archived",
    explain: "Quotes that got archived without a yes. Archiving cleans up your screen — it also means nobody will ever follow up.",
    icon: "archive",
  },
  changes_requested: {
    title: "Asked for changes, never got a new quote",
    short: "Changes asked",
    explain: "They wanted the job with a tweak. These are some of the warmest people in your whole file.",
    icon: "pencil",
  },
  approved_unscheduled: {
    title: "Said yes, never got scheduled",
    short: "Yes, not booked",
    explain: "Work you already won that never made it onto the calendar. This is the fastest money in your business.",
    icon: "calendar-x",
  },
  unquoted_request: {
    title: "Asked for a price, never got one",
    short: "Never quoted",
    explain: "Requests that came in during a busy week and never got a quote. They were ready to buy.",
    icon: "inbox",
  },
  declined_option: {
    title: "Add-ons left on the table",
    short: "Passed on add-on",
    explain: "They took the main job and passed on an option you offered. The job is done — the option is still a good idea.",
    icon: "list-plus",
  },
  declined_quote: {
    title: "Said no a while ago",
    short: "Said no",
    explain: "Things change — they went with someone else who didn't show, or the price makes sense now. One respectful check-in, no pressure.",
    icon: "rotate-ccw",
  },
  one_and_done: {
    title: "Hired you once, never came back",
    short: "One and done",
    explain: "Happy customers who used you one time. They'll need you again — the question is whether they remember your name.",
    icon: "user-round",
  },
  lapsed_regular: {
    title: "Regulars who went quiet",
    short: "Went quiet",
    explain: "Customers who used you on a rhythm and then stopped. Usually nobody asked why.",
    icon: "clock",
  },
  service_due: {
    title: "Due for service again",
    short: "Due again",
    explain: "Work that comes around on a clock — pump-outs, sweeps, washes, clean-ups. They're due, and they don't know it.",
    icon: "alarm-clock",
  },
  missed_upsell: {
    title: "The next job nobody offered",
    short: "Next job",
    explain: "The natural follow-on to work you already did — stump grinding after a removal, sealing after a pour. Never offered.",
    icon: "arrow-right-circle",
  },
  unpaid_invoice: {
    title: "Work done, not paid",
    short: "Unpaid",
    explain: "Invoices still open past their due date. You already did the work.",
    icon: "receipt",
  },
};

/** Types that are sales opportunities (vs. collections). Unpaid invoices are opt-in. */
export const SALES_TYPES: BreakageType[] = [
  "approved_unscheduled",
  "changes_requested",
  "unquoted_request",
  "unanswered_quote",
  "archived_quote",
  "service_due",
  "lapsed_regular",
  "declined_option",
  "one_and_done",
  "missed_upsell",
  "declined_quote",
];

/** Work-it-first order when a customer has several opportunities. */
export const TYPE_RANK: Record<BreakageType, number> = {
  approved_unscheduled: 1,
  changes_requested: 2,
  unquoted_request: 3,
  unanswered_quote: 4,
  service_due: 5,
  archived_quote: 6,
  lapsed_regular: 7,
  declined_option: 8,
  missed_upsell: 9,
  one_and_done: 10,
  declined_quote: 11,
  unpaid_invoice: 12,
};
