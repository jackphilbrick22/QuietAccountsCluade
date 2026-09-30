import type { MessageAngle, TradeId } from "../model.ts";

export type Climate = "cold" | "warm";

/** One sellable service inside a trade. */
export interface ServiceDef {
  id: string;
  label: string;
  /** Matches quote/job titles and line items. */
  match: RegExp;
  /** Titles that use this service's words but are another job: "Christmas lights takedown" is not the install. */
  unless?: RegExp;
  /** How a person refers to it: "the stump grinding", "your septic pump-out". */
  phrase: string;
  /** Months (1-12) this is normally bought/done, per climate. Empty = year-round. */
  season: Partial<Record<Climate, number[]>>;
  /** Re-service interval in months (septic pump-out ~36). */
  reserviceMonths?: number;
  /**
   * Seasonal work comes due in this month (1-12) when its season comes back around, not a year to the day
   * after the last visit: lights hung in November or taken down in January are both due again in October.
   */
  dueMonth?: number;
  /**
   * Work that simply comes around again each season: the question a service-due note asks in place of
   * "once a year is the rule of thumb" ("Want the lights up again this year?").
   */
  dueAsk?: string;
  /** Hazard work gets worse if ignored; improvements can wait. */
  kind: "hazard" | "repair" | "maintenance" | "improvement" | "recurring";
  /**
   * Natural next jobs after this one. `why` is for the owner; `pitch` is the one honest sentence a
   * homeowner reads about it (left out of the note when there isn't one); `ask` is the question the note
   * asks in place of "Want a price?" ("Want it on a regular schedule?").
   */
  followOns?: { serviceId: string; afterDays: [number, number]; why: string; pitch?: string; ask?: string }[];
  /** A single honest sentence on why waiting doesn't help — used by the "problem grows" angle. */
  worseIfWaiting?: string;
  /**
   * Doing it out of season does harm (oak pruning Apr-Oct spreads oak wilt; ash treatment only
   * works around May). Out of season, notes never offer a near-term slot.
   */
  strictSeason?: boolean;
  /** Strict-season work: why it waits, in one plain sentence for the homeowner. */
  waitLine?: string;
  /** Timing line for the "timing" angle, keyed by climate. */
  timingLine?: Partial<Record<Climate, string>>;
  /** Months the timing line reads true in ("leaf-off months" is a winter line). Default: the season. */
  timingMonths?: Partial<Record<Climate, number[]>>;
}

export interface TradePlaybook {
  id: TradeId;
  label: string;
  /** Fallback when a title names nothing specific: "the tree work". */
  workPhrase: string;
  /** "tree company", "septic company" — how the business is described in plain words. */
  noun: string;
  /** Typical job value range for sanity checks and fallbacks. */
  ticket: { low: number; typical: number; high: number };
  /** Share of quotes a typical shop in this trade wins (used only as a prior). */
  typicalCloseRate: number;
  /** Months of peak demand per climate — used to time outreach before the rush. */
  peakMonths: Record<Climate, number[]>;
  services: ServiceDef[];
  /** Object words in titles -> natural phrase ("oak" -> "the oak"). Checked in order. */
  objects: [RegExp, string][];
  /** Location words -> phrase appended to the object ("driveway" -> "by the driveway"). */
  places: [RegExp, string][];
  /** Why quotes die in this trade — feeds the angle choice and the owner education screen. */
  whyQuotesDie: string[];
  /** Best-performing angles for dead quotes, in order. */
  quoteAngles: MessageAngle[];
  /** A realistic default for the owner's "crew nearby" line. */
  crewLine: string;
  /** Default minimum quote worth chasing. */
  minQuote: number;
  /**
   * Coming out to look is free in this trade (estimates), so a note may say "No charge to look."
   * Off where a visit is a paid service or diagnostic call (HVAC, septic, pest). The owner can override.
   */
  freeLook: boolean;
  /**
   * The one short question the first answer to a new request asks, so the owner has what he needs before he
   * calls back (tree: photos and the address; fence: feet, material, gates, HOA). One sentence, never a price
   * or a date. "{andAddress}" reads " and the address" only when we don't have one. Without it the answer
   * asks nothing extra.
   */
  intakeAsk?: string;
  /** The same question when the request already names the work ("repaint the living room"), minus what that answers. */
  intakeAskNamed?: string;
  /**
   * When a regular counts as gone quiet, by how often they came: [usual gap up to this many days, gone quiet
   * once this many days pass since the last visit]. The first row that fits wins. Trades without rows, and gaps
   * past the last row, use the default: 1¾ times the usual gap or the gap plus 45 days, whichever is later.
   */
  lapseAfterDays?: [number, number][];
}

export const WARM_STATES = new Set(["FL", "TX", "AZ", "CA", "LA", "MS", "AL", "GA", "SC", "HI", "NV", "NM"]);

export function climateOf(state: string | undefined): Climate {
  return state && WARM_STATES.has(state.toUpperCase()) ? "warm" : "cold";
}
