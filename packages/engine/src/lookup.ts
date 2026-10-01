import type { Customer, Dataset, Job, Opportunity, Quote } from "./model.ts";
import { visitBook } from "./breakage/visits.ts";
import { streetName } from "./util.ts";

/**
 * Cached indexes over dataset arrays. Keyed by array identity + length, so an import
 * (which builds new arrays) or a push (which changes length) invalidates automatically.
 * Turns the worker's per-note and per-reply lookups from O(n) scans into O(1).
 */
const cache = new WeakMap<object, Map<string, { len: number; value: unknown }>>();

function memo<T>(arr: readonly unknown[], tag: string, build: () => T): T {
  let bucket = cache.get(arr);
  if (!bucket) {
    bucket = new Map();
    cache.set(arr, bucket);
  }
  const hit = bucket.get(tag);
  if (hit && hit.len === arr.length) return hit.value as T;
  const value = build();
  bucket.set(tag, { len: arr.length, value });
  return value;
}

export function customerById(ds: Dataset, id: string | undefined): Customer | undefined {
  if (!id) return undefined;
  return memo(ds.customers, "byId", () => new Map(ds.customers.map((c) => [c.id, c]))).get(id);
}

export function customerByEmail(ds: Dataset, email: string): Customer | undefined {
  // emails can be appended to an existing customer in place, so fall back to a scan on a miss
  const m = memo(ds.customers, "byEmail", () => {
    const x = new Map<string, Customer>();
    for (const c of ds.customers) for (const e of c.emails) if (!x.has(e)) x.set(e, c);
    return x;
  });
  return m.get(email) ?? ds.customers.find((c) => c.emails.includes(email));
}

export function quoteById(ds: Dataset, id: string): Quote | undefined {
  return memo(ds.quotes, "byId", () => new Map(ds.quotes.map((q) => [q.id, q]))).get(id);
}

function byCustomer<T extends { customerId: string }>(arr: T[], customerId: string): T[] {
  return memo(arr, "byCustomer", () => {
    const m = new Map<string, T[]>();
    for (const x of arr) (m.get(x.customerId) ?? m.set(x.customerId, []).get(x.customerId)!).push(x);
    return m;
  }).get(customerId) ?? [];
}

/** One customer's quotes. */
export function quotesOf(ds: Dataset, customerId: string): Quote[] {
  return byCustomer(ds.quotes, customerId);
}

/** One customer's jobs. */
export function jobsOf(ds: Dataset, customerId: string): Job[] {
  return byCustomer(ds.jobs, customerId);
}

export function oppById(opps: Opportunity[] | undefined, id: string | undefined): Opportunity | undefined {
  if (!opps || !id) return undefined;
  return memo(opps, "byId", () => new Map(opps.map((o) => [o.id, o]))).get(id);
}

export interface ScheduledWork {
  date: string;
  city: string;
  street: string;
  customerId: string;
}

/**
 * Jobs on the calendar (scheduled, active, or with no status and a date) with where they are — for factual "crew
 * nearby" lines, which take only those still to come. What's left on the calendar of a schedule that stopped being
 * served is no crew coming.
 */
export function scheduledWork(ds: Dataset): ScheduledWork[] {
  return memo(ds.jobs, `sched|${ds.customers.length}|${ds.asOf}`, () => {
    const out: ScheduledWork[] = [];
    const book = visitBook(ds);
    for (const j of ds.jobs as Job[]) {
      if (!(j.status === "scheduled" || j.status === "active" || j.status === "unknown") || !j.scheduledOn) continue;
      if (j.visit && (j.undone || book.stopped(j))) continue;
      const p = j.property ?? customerById(ds, j.customerId)?.address;
      if (!p) continue;
      out.push({ date: j.scheduledOn, city: (p.city ?? "").toLowerCase(), street: streetName(p.street).toLowerCase(), customerId: j.customerId });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  });
}
