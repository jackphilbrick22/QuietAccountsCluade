import type { ScanResult } from "../breakage/detect.ts";
import type { DrawerSummary } from "../breakage/forecast.ts";
import type { OutreachRecord } from "../ledger/attribution.ts";
import type { AgentEvent, Dataset, ISODateTime, PlanState, Recovery, Reply, Touch } from "../model.ts";

/** Everything the system knows about one business. Serializable as JSON. */
export interface AccountState {
  dataset: Dataset;
  scan?: ScanResult;
  summary?: DrawerSummary;
  touches: Touch[];
  replies: Reply[];
  recoveries: Recovery[];
  outreach: OutreachRecord[];
  /** lowercase email -> why it can never be emailed again. */
  suppressions: Record<string, "unsubscribed" | "bounced" | "complained">;
  events: AgentEvent[];
  /** Owner-facing texts sent (hand-offs, reports), newest last. */
  ownerMessages: OwnerMessage[];
  /** When the free round's last note went out. */
  trialCompletedOn?: string;
  /** The welcome text showed the owner the first note; nothing goes out until they reply OK (or the operator approves). */
  awaitingOwnerOk?: ISODateTime;
  /**
   * The quiet rate from their own records the day our first follow-up went out, frozen: later statuses (quotes
   * our notes brought back) would otherwise pull "before we started" down.
   */
  quietBefore?: import("../breakage/quiet.ts").QuietRate & { on: string };
  /** The owner texted CANCEL: what it stopped, so UNDO (within a day) can put it all back. */
  cancelled?: {
    at: ISODateTime;
    stageBefore: Exclude<PlanState["stage"], "cancelled">;
    /** Each stopped note and the status it had, so UNDO puts back exactly that (a planned note stays planned). */
    touches: { id: string; status: "planned" | "approved" }[];
    /** Still waiting for the owner's OK to the first note when they cancelled. */
    awaitingOwnerOk?: ISODateTime;
    /** The owner had paused sending before cancelling; UNDO leaves it paused. */
    paused?: boolean;
    refund?: { yearStart: string; amount: number };
    /** Renewed years that hadn't started: taken off the paid years (Jack refunds them only if they were paid); UNDO or a restore puts them back. */
    years?: string[];
  };
  updatedAt: ISODateTime;
}

/**
 * Money texts: a one pass's booking's (BRIEF B4) or the monthly plan's first month (B5), with the link that saves the
 * card or on the saved card; a failed charge's link (a month's too); the cap reached; a refund. A later month's is its
 * pre-charge text.
 */
export const CHARGE_TEXTS = ["charge_link", "charge_card", "charge_retry", "charge_cap", "charge_refund"] as const;
export type ChargeText = (typeof CHARGE_TEXTS)[number];

export interface OwnerMessage {
  id: string;
  at: ISODateTime;
  /**
   * "reply": our answer to a text the owner sent the operator's phone, to text back by hand (SMS_PROVIDER=manual).
   * "pass_end": a one pass's last text (the tally and the refill check), which waits for the operator.
   * "export_ask": a one pass's ask for a fresh export once it's done, which waits for the operator too.
   * "check_in": "Did it book?" about the leads still waiting on an answer, one text a day at most.
   * "charge_*": the money texts (CHARGE_TEXTS), each waiting for the operator.
   */
  kind: "handoff" | "sla_nudge" | "weekly" | "close" | "precharge" | "free_month" | "info" | "kickoff" | "renewal" | "refund" | "reply" | "pass_end" | "export_ask" | "check_in" | ChargeText;
  text: string;
  refs?: { kind: string; id: string }[];
}

export function emptyState(dataset: Dataset, now: ISODateTime): AccountState {
  return { dataset, touches: [], replies: [], recoveries: [], outreach: [], suppressions: {}, events: [], ownerMessages: [], updatedAt: now };
}
