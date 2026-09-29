import type { MessageAngle, TradeId } from "../model.ts";

export type Climate = "cold" | "warm";

/** One sellable service inside a trade. */
export interface ServiceDef {
  id: string;
  label: string;
  /** Matches quote/job titles and line items. */
  match: RegExp;
  /** How a person refers to it: "the stump grinding", "your septic pump-out". */
  phrase: string;
  /** Months (1-12) this is normally bought/done, per climate. Empty = year-round. */
  season: Partial<Record<Climate, number[]>>;
  /** Re-service interval in months (septic pump-out ~36). */
  reserviceMonths?: number;
  /** Hazard work gets worse if ignored; improvements can wait. */
  kind: "hazard" | "repair" | "maintenance" | "improvement" | "recurring";
  /** Natural next jobs after this one. */
  followOns?: { serviceId: string; afterDays: [number, number]; why: string }[];
  /** A single honest sentence on why waiting doesn't help — used by the "problem grows" angle. */
  worseIfWaiting?: string;
  /**
   * Doing it out of season does harm (oak pruning Apr-Oct spreads oak wilt; ash treatment only
   * works around May). Out of season, notes never offer a near-term slot.
   */
  strictSeason?: boolean;
  /** Timing line for the "timing" angle, keyed by climate. */
  timingLine?: Partial<Record<Climate, string>>;
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
}

export const WARM_STATES = new Set(["FL", "TX", "AZ", "CA", "LA", "MS", "AL", "GA", "SC", "HI", "NV", "NM"]);

export function climateOf(state: string | undefined): Climate {
  return state && WARM_STATES.has(state.toUpperCase()) ? "warm" : "cold";
}
