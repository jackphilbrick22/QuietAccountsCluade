import {
  addDays,
  guaranteeCheck,
  lift,
  mondayOf,
  sum,
  totals,
  weekNumbers,
  type AccountState,
  type Customer,
  type Opportunity,
  type Reply,
  type Touch,
} from "@qa/engine";

const cache = new WeakMap<AccountState, { rev: number; data: Derived }>();

export interface Derived {
  customers: Map<string, Customer>;
  opps: Map<string, Opportunity>;
  hot: Reply[];
  handled: Reply[];
  later: Reply[];
  closedOut: Reply[];
  needsReview: Reply[];
  recovered: number;
  onTable: number;
  sentCount: number;
  peopleContacted: number;
  queued: Touch[];
  trial: { size: number; started: number; done: boolean };
  totals: ReturnType<typeof totals>;
  week: ReturnType<typeof weekNumbers>;
  lastWeek: ReturnType<typeof weekNumbers>;
  lift: ReturnType<typeof lift>;
  guarantee?: ReturnType<typeof guaranteeCheck>;
  touchesByCustomer: Map<string, Touch[]>;
  replyByCustomer: Map<string, Reply>;
}

export function derive(a: AccountState, rev: number): Derived {
  const hit = cache.get(a);
  if (hit && hit.rev === rev) return hit.data;
  const customers = new Map(a.dataset.customers.map((c) => [c.id, c]));
  const opps = new Map((a.scan?.opportunities ?? []).map((o) => [o.id, o]));
  const wants = (r: Reply) => r.intent === "wants_it" || r.intent === "wants_price" || r.intent === "question";
  const hot = a.replies.filter((r) => wants(r) && !r.ownerContactedAt && r.status !== "done").sort((x, y) => (x.receivedAt < y.receivedAt ? 1 : -1));
  const handled = a.replies.filter((r) => wants(r) && (r.ownerContactedAt || r.status === "done")).sort((x, y) => (x.receivedAt < y.receivedAt ? 1 : -1));
  const later = a.replies.filter((r) => r.intent === "later").sort((x, y) => (x.receivedAt < y.receivedAt ? 1 : -1));
  const needsReview = a.replies.filter((r) => r.intent === "unclear" && r.status === "new");
  const closedOut = a.replies
    .filter((r) => !wants(r) && r.intent !== "later" && r.intent !== "unclear" && r.intent !== "auto_reply" && r.intent !== "bounce")
    .sort((x, y) => (x.receivedAt < y.receivedAt ? 1 : -1));
  const recovered = sum(a.recoveries, (r) => r.value);
  const sent = a.touches.filter((t) => t.status === "sent" || t.status === "delivered");
  const t = totals(a);
  const b = a.dataset.business;
  const startedPeople = new Set(a.touches.filter((x) => x.step === 1 && x.status !== "cancelled").map((x) => x.customerId)).size;
  const touchesByCustomer = new Map<string, Touch[]>();
  for (const x of a.touches) (touchesByCustomer.get(x.customerId) ?? touchesByCustomer.set(x.customerId, []).get(x.customerId)!).push(x);
  const replyByCustomer = new Map<string, Reply>();
  for (const r of a.replies) if (r.customerId) replyByCustomer.set(r.customerId, r);
  const monday = mondayOf(a.dataset.asOf);
  const data: Derived = {
    customers,
    opps,
    hot,
    handled,
    later,
    closedOut,
    needsReview,
    recovered,
    onTable: Math.max(0, (a.summary?.reachableValue ?? 0) - recovered),
    sentCount: sent.length,
    peopleContacted: t.contacted,
    queued: a.touches.filter((x) => x.status === "approved" || x.status === "planned").sort((x, y) => (x.dueAt < y.dueAt ? -1 : 1)),
    trial: { size: b.plan.trialSize, started: Math.min(b.plan.trialSize, startedPeople), done: b.plan.stage !== "trial" || !!a.trialCompletedOn },
    totals: t,
    week: weekNumbers(a, monday),
    lastWeek: weekNumbers(a, addDays(monday, -7)),
    lift: lift(a.outreach, a.recoveries),
    guarantee: b.plan.paidOn ? guaranteeCheck(a, a.dataset.asOf) : undefined,
    touchesByCustomer,
    replyByCustomer,
  };
  cache.set(a, { rev, data });
  return data;
}

export function initials(name: string): string {
  const p = name.replace(/[^A-Za-z ]/g, " ").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1]![0] : "")).toUpperCase() || "?";
}

export function relTime(iso: string, now: string): string {
  const ms = Date.parse(now.length === 10 ? `${now}T18:00:00` : now) - Date.parse(iso);
  const h = ms / 3600000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function niceDate(d: string): string {
  return new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function niceTime(iso: string): string {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  const hh = ((h! + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
}
