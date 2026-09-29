import { daysBetween, type AccountState, type Opportunity, type Recovery, type SuppressionReason, type Touch } from "@qa/engine";
import type { AccountMeta } from "../store/app";
import type { Derived } from "./derive";

/** Why we are leaving someone alone, in the owner's words. */
export const SUPPRESS_LABEL: Record<SuppressionReason, string> = {
  already_customer_again: "Already came back on their own",
  active_work: "Have work in progress right now",
  do_not_contact: "Marked do-not-contact",
  no_contact_info: "No email or address",
  commercial: "Commercial accounts (handled separately)",
  below_minimum: "Under your minimum job size",
  too_old: "Too old to bring up",
  recently_contacted: "Contacted recently — resting",
  bounced: "Email bounced",
  unsubscribed: "Asked us to stop",
  complained: "Complained — never again",
  too_recent: "Too new — your own follow-up is still running",
  duplicate: "Duplicate record",
};

export const MATCH_LABEL: Record<Recovery["match"], string> = {
  same_record: "Same quote",
  customer_id: "New job",
  email: "New job (email match)",
  phone: "New job (phone match)",
  address: "New job (address match)",
  owner_reported: "Owner reported",
};

export type OppStatus = "recovered" | "replied" | "in_sequence" | "finished" | "queued" | "holdout" | "left_alone" | "not_started";

export const OPP_STATUS: Record<OppStatus, { label: string; tone: "ok" | "accent" | "info" | "warn" | "neutral" | "bad" }> = {
  recovered: { label: "Recovered", tone: "ok" },
  replied: { label: "Replied", tone: "accent" },
  in_sequence: { label: "In sequence", tone: "info" },
  finished: { label: "Sequence done", tone: "neutral" },
  queued: { label: "Queued", tone: "warn" },
  holdout: { label: "Held back", tone: "neutral" },
  left_alone: { label: "Left alone", tone: "neutral" },
  not_started: { label: "Not started", tone: "neutral" },
};

const statusCache = new WeakMap<AccountState, { rev: number; map: Map<string, OppStatus> }>();

/** Where each opportunity stands right now. Cached per account revision. */
export function oppStatuses(a: AccountState, d: Derived, rev: number): Map<string, OppStatus> {
  const hit = statusCache.get(a);
  if (hit && hit.rev === rev) return hit.map;
  const byOpp = new Map<string, Touch[]>();
  for (const t of a.touches) (byOpp.get(t.opportunityId) ?? byOpp.set(t.opportunityId, []).get(t.opportunityId)!).push(t);
  const recoveredOpp = new Set(a.recoveries.map((r) => r.opportunityId).filter(Boolean) as string[]);
  const recoveredCust = new Set(a.recoveries.map((r) => r.customerId));
  const holdout = new Set(a.outreach.filter((o) => o.holdout).map((o) => o.customerId));
  const map = new Map<string, OppStatus>();
  for (const o of a.scan?.opportunities ?? []) map.set(o.id, statusOf(o));
  function statusOf(o: Opportunity): OppStatus {
    const ts = byOpp.get(o.id);
    if (recoveredOpp.has(o.id) || (ts && recoveredCust.has(o.customerId))) return "recovered";
    if (ts?.length) {
      if (d.replyByCustomer.has(o.customerId)) return "replied";
      const live = ts.filter((t) => t.status !== "cancelled" && t.status !== "skipped");
      if (live.some((t) => t.status === "sent" || t.status === "delivered")) return live.some((t) => t.status === "planned" || t.status === "approved") ? "in_sequence" : "finished";
      if (live.length) return "queued";
    }
    if (o.suppressed) return "left_alone";
    if (holdout.has(o.customerId)) return "holdout";
    return "not_started";
  }
  statusCache.set(a, { rev, map });
  return map;
}

export function stageOf(a: AccountState, meta: AccountMeta | undefined, d: Derived): { label: string; tone: "ok" | "accent" | "info" | "warn" | "neutral" | "bad" } {
  const p = a.dataset.business.plan;
  if (meta?.paused || p.stage === "paused") return { label: "Paused", tone: "warn" };
  if (p.stage === "cancelled") return { label: "Cancelled", tone: "bad" };
  if (p.stage === "paying") return { label: "Paying", tone: "ok" };
  if (!a.touches.length) return { label: "Not started", tone: "neutral" };
  return { label: `Trial ${d.trial.started}/${d.trial.size}`, tone: "info" };
}

/** Days until a date (negative if past). */
export function daysUntil(from: string, to: string): number {
  return daysBetween(from.slice(0, 10), to.slice(0, 10));
}

export function hourLabel(h: number): string {
  const hh = ((h + 11) % 12) + 1;
  return `${hh} ${h < 12 || h === 24 ? "AM" : "PM"}`;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
