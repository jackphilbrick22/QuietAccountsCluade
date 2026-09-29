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
  updatedAt: ISODateTime;
}

export interface OwnerMessage {
  id: string;
  at: ISODateTime;
  kind: "handoff" | "sla_nudge" | "weekly" | "close" | "precharge" | "free_month" | "info";
  text: string;
  refs?: { kind: string; id: string }[];
}

export function emptyState(dataset: Dataset, now: ISODateTime): AccountState {
  return { dataset, touches: [], replies: [], recoveries: [], outreach: [], suppressions: {}, events: [], ownerMessages: [], updatedAt: now };
}
