import type { ScanResult } from "../breakage/detect.ts";
import type { DrawerSummary } from "../breakage/forecast.ts";
import type { OutreachRecord } from "../ledger/attribution.ts";
import type { AgentEvent, Dataset, ISODateTime, Recovery, Reply, Touch } from "../model.ts";

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
  /** The owner texted CANCEL: what it stopped, so UNDO (within a day) can put it all back. */
  cancelled?: { at: ISODateTime; stageBefore: "trial" | "paying" | "paused"; touchIds: string[]; refund?: { yearStart: string; amount: number } };
  updatedAt: ISODateTime;
}

export interface OwnerMessage {
  id: string;
  at: ISODateTime;
  kind: "handoff" | "sla_nudge" | "weekly" | "close" | "precharge" | "free_month" | "info" | "kickoff" | "renewal" | "refund";
  text: string;
  refs?: { kind: string; id: string }[];
}

export function emptyState(dataset: Dataset, now: ISODateTime): AccountState {
  return { dataset, touches: [], replies: [], recoveries: [], outreach: [], suppressions: {}, events: [], ownerMessages: [], updatedAt: now };
}
