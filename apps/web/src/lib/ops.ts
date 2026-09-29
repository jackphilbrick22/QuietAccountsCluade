import { guaranteeCheck, sendHealth, type AccountState, type Reply } from "@qa/engine";
import type { AccountMeta } from "../store/app";
import { derive, type Derived } from "./derive";
import { daysUntil, stageOf } from "./labels";

export interface ClientRow {
  id: string;
  a: AccountState;
  meta?: AccountMeta;
  d: Derived;
  stage: ReturnType<typeof stageOf>;
  reachable: number;
  contacted: number;
  health: ReturnType<typeof sendHealth>;
  lateHot: Reply[];
  lastActivity?: string;
  guarantee?: ReturnType<typeof guaranteeCheck>;
  /** Days until the next charge (paying clients only). */
  chargeIn?: number;
  paused: boolean;
}

/** Hours a hot lead has waited, measured against the account's own "today". */
export function waitedHours(a: AccountState, r: Reply): number {
  return (Date.parse(`${a.dataset.asOf}T18:00:00`) - Date.parse(r.receivedAt)) / 3600000;
}

export function clientRows(order: string[], accounts: Record<string, AccountState>, metas: Record<string, AccountMeta>, rev: number): ClientRow[] {
  const rows: ClientRow[] = [];
  for (const id of order) {
    const a = accounts[id];
    if (!a) continue;
    const meta = metas[id];
    const d = derive(a, rev);
    const health = sendHealth(a);
    const last = a.events.reduce<string | undefined>((m, e) => (!m || e.at > m ? e.at : m), undefined);
    const g = a.dataset.business.plan.paidOn ? guaranteeCheck(a, a.dataset.asOf) : undefined;
    rows.push({
      id,
      a,
      meta,
      d,
      stage: stageOf(a, meta, d),
      reachable: a.summary?.reachablePeople ?? 0,
      contacted: d.peopleContacted,
      health,
      lateHot: d.hot.filter((r) => waitedHours(a, r) > 24),
      lastActivity: last,
      guarantee: g,
      chargeIn: g ? daysUntil(a.dataset.asOf, g.chargeOn) : undefined,
      paused: !!meta?.paused || health.paused || a.dataset.business.plan.stage === "paused",
    });
  }
  return rows;
}

export function mrr(rows: ClientRow[]): number {
  return rows.filter((r) => r.a.dataset.business.plan.stage === "paying" && !r.meta?.paused).reduce((n, r) => n + r.a.dataset.business.plan.monthlyPrice, 0);
}

/* ------------------------------ Needs a person ------------------------------ */

export type ReviewKind = "unclear" | "late" | "complaint" | "flagged" | "paused" | "close" | "billing";

export interface ReviewItem {
  key: string;
  kind: ReviewKind;
  row: ClientRow;
  at?: string;
  reply?: Reply;
  /** flagged: how many queued notes failed which check */
  flags?: [string, number][];
  flaggedCount?: number;
}

export const REVIEW_ORDER: ReviewKind[] = ["late", "complaint", "unclear", "close", "billing", "paused", "flagged"];

/** Everything across all clients that a person has to look at. Same list drives the nav badge and the screen. */
export function reviewItems(rows: ClientRow[]): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const row of rows) {
    const { a, d, id } = row;
    const b = a.dataset.business;
    for (const r of d.needsReview) items.push({ key: `u-${r.id}`, kind: "unclear", row, at: r.receivedAt, reply: r });
    for (const r of row.lateHot) items.push({ key: `l-${r.id}`, kind: "late", row, at: r.receivedAt, reply: r });
    for (const r of a.replies) if (r.intent === "complaint" && daysUntil(r.receivedAt, a.dataset.asOf) <= 30) items.push({ key: `c-${r.id}`, kind: "complaint", row, at: r.receivedAt, reply: r });
    const flagged = a.touches.filter((t) => t.flags.length && (t.status === "planned" || t.status === "approved"));
    if (flagged.length) {
      const counts = new Map<string, number>();
      for (const t of flagged) for (const f of t.flags) counts.set(f, (counts.get(f) ?? 0) + 1);
      items.push({ key: `f-${id}`, kind: "flagged", row, flaggedCount: flagged.length, flags: [...counts.entries()].sort((x, y) => y[1] - x[1]) });
    }
    if (row.paused) items.push({ key: `p-${id}`, kind: "paused", row });
    const pending = a.touches.some((t) => t.status === "planned" || t.status === "approved");
    const sentAny = a.touches.some((t) => t.status === "sent" || t.status === "delivered");
    if (b.plan.stage === "trial" && sentAny && !pending && !a.ownerMessages.some((m) => m.kind === "close")) items.push({ key: `x-${id}`, kind: "close", row });
    if (row.guarantee && row.chargeIn !== undefined && row.chargeIn <= 2 && row.chargeIn >= -3) items.push({ key: `b-${id}-${row.guarantee.chargeOn}`, kind: "billing", row });
  }
  items.sort((x, y) => REVIEW_ORDER.indexOf(x.kind) - REVIEW_ORDER.indexOf(y.kind) || ((x.at ?? "") < (y.at ?? "") ? -1 : 1));
  return items;
}
