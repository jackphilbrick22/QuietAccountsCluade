import type { Dataset, ISODate, Job, TradeId } from "../model.ts";
import { playbook } from "../trades/index.ts";
import { addDays, daysBetween, round2 } from "../util.ts";

/**
 * Which work is done, which is still to come, and when a regular has gone quiet: one set of rules for the scan, the
 * ledger and the crew-nearby lines.
 */

export const DONE_JOB = new Set<Job["status"]>(["completed", "archived", "requires_invoicing"]);

export function jobDate(j: Job): ISODate | undefined {
  return j.completedOn ?? j.scheduledOn ?? j.createdOn;
}

/** The usual gap between visits, and whether it's a regular schedule: marked recurring, or 3+ visits usually no more than four months apart. */
export function rhythmOf(work: { date: ISODate; recurring?: boolean }[]): { median: number; recurring: boolean } {
  const gaps: number[] = [];
  for (let i = 1; i < work.length; i++) gaps.push(daysBetween(work[i - 1]!.date, work[i]!.date));
  const sorted = gaps.filter((g) => g > 0).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return { median, recurring: work.some((w) => w.recurring) || (median > 0 && median <= 120 && work.length >= 3) };
}

/**
 * How many days after the last visit a regular counts as gone quiet, given their usual gap between visits. The trade
 * sets its own rows (cleaning: every week or two -> 21 days, about monthly -> 45); otherwise it's 1¾ times the usual
 * gap or the gap plus 45 days, whichever is later. A trade row never lands less than a week past the usual gap. With
 * no gap to go on, it's the trade's last row, or weekly in a trade without rows.
 */
export function lapseAfter(trade: TradeId, usualGap?: number): { days: number; byTrade: boolean } {
  const rows = playbook(trade).lapseAfterDays ?? [];
  const row = usualGap === undefined ? rows[rows.length - 1] : rows.find(([upTo]) => usualGap <= upTo);
  if (row) return { days: Math.max(row[1], Math.ceil(usualGap ?? 0) + 7), byTrade: true };
  const gap = usualGap ?? 7;
  return { days: Math.floor(Math.max(gap * 1.75, gap + 45)) + 1, byTrade: false };
}

export interface VisitBook {
  /** Work done by the day: marked done, or dated by then with nothing saying it wasn't. */
  worked(j: Job): boolean;
  /** A visit by now that went by undone: a later visit of its job was marked done, or its crew has marked past it. */
  missed(j: Job): boolean;
  /** How far a visit's crew has marked its visits done: blank when it hasn't marked enough of them to say. */
  markedThrough(j: Job): ISODate;
  /** Their schedule stopped being served: what's left of it on the calendar is what nobody cleared. */
  stopped(customerId: string): boolean;
  /** A visit still to come (dated after the day, or not dated and not done) on a schedule that's still served. */
  ahead(j: Job): boolean;
}

/**
 * Where a shop's work stands on the dataset's day. Work marked done is done, and work with no word either way is done
 * once it's dated by then. A visit not marked done went by undone when a later visit of the same job was marked done,
 * or when its crew ("Assigned to", else the whole shop) has marked its visits past it: up to the last day a visit was
 * marked done with at least half of the four weeks' visits up to it marked too, so a visit or two ticked off the day
 * they were done (a move-out clean invoiced on the spot) don't turn a month nobody has marked yet into a month of
 * misses. Otherwise the owner hasn't got to it (he ticks visits off when he invoices, or never does), and its date
 * decides too. Undone visits since a client's last one done, running as long as it takes a regular of theirs to go
 * quiet, are a schedule that stopped though the owner never closed the job: the rest of it, past or still to come, is
 * no sign they're back.
 */
export function visitBook(ds: Dataset): VisitBook {
  const asOf = ds.asOf;
  const dated = (j: Job) => (jobDate(j) ?? "9999") <= asOf;
  const plain = (j: Job) => (DONE_JOB.has(j.status) || j.status === "unknown") && dated(j);
  // a dated visit, by now, not marked done: missed, or not marked yet
  const unmarked = (j: Job) => !!j.visit && !plain(j) && j.status !== "cancelled" && !!jobDate(j) && dated(j);
  const jobOf = (j: Job) => `${j.customerId}|${j.jobRef ?? ""}`;
  // visits by now, by day, for the whole shop ("") and for each crew: how many, and how many marked done
  const days = new Map<string, Map<ISODate, [number, number]>>();
  // the last visit of each job marked done
  const jobTicked = new Map<string, ISODate>();
  const mine = new Map<string, Job[]>();
  for (const j of ds.jobs) {
    (mine.get(j.customerId) ?? mine.set(j.customerId, []).get(j.customerId)!).push(j);
    const done = !!j.visit && DONE_JOB.has(j.status) && dated(j);
    if (!done && !unmarked(j)) continue;
    const on = jobDate(j)!;
    for (const crew of j.crew ? ["", j.crew] : [""]) {
      const byDay = days.get(crew) ?? days.set(crew, new Map()).get(crew)!;
      const [all, marked] = byDay.get(on) ?? [0, 0];
      byDay.set(on, [all + 1, marked + (done ? 1 : 0)]);
    }
    if (done && on > (jobTicked.get(jobOf(j)) ?? "")) jobTicked.set(jobOf(j), on);
  }
  const through = new Map<string, ISODate>();
  for (const [crew, byDay] of days) {
    const mostMarked = (on: ISODate) => {
      let all = 0;
      let marked = 0;
      for (let i = 0; i < 28; i++) {
        const [a, m] = byDay.get(addDays(on, -i)) ?? [0, 0];
        all += a;
        marked += m;
      }
      return marked * 2 >= all;
    };
    const at = [...byDay].filter(([, [, m]]) => m > 0).map(([on]) => on).sort().reverse().find(mostMarked);
    if (at) through.set(crew, at);
  }
  const markedThrough = (j: Job) => (j.crew && through.get(j.crew)) || through.get("") || "";
  const missed = (j: Job) => unmarked(j) && (jobDate(j)! <= markedThrough(j) || jobDate(j)! < (jobTicked.get(jobOf(j)) ?? ""));
  const seen = new Map<string, boolean>();
  const stopped = (customerId: string): boolean => {
    let s = seen.get(customerId);
    if (s === undefined) {
      const jobs = mine.get(customerId) ?? [];
      const done = jobs.filter(plain).map((j) => jobDate(j)!).sort();
      const last = done[done.length - 1] ?? "";
      const since = jobs.filter((j) => missed(j) && jobDate(j)! > last).map((j) => jobDate(j)!).sort();
      const gap = rhythmOf(done.map((date) => ({ date }))).median;
      s = since.length > 0 && daysBetween(last || since[0]!, since[since.length - 1]!) >= lapseAfter(ds.business.trade, gap || undefined).days;
      seen.set(customerId, s);
    }
    return s;
  };
  const ahead = (j: Job) => !!j.visit && j.status !== "cancelled" && (jobDate(j) ? !dated(j) : !DONE_JOB.has(j.status) && j.status !== "unknown") && !stopped(j.customerId);
  return { worked: (j) => plain(j) || (unmarked(j) && !missed(j) && !stopped(j.customerId)), missed, markedThrough, stopped, ahead };
}

/**
 * A one-off job's visits as the one job they are (a patio laid over four days, a deep clean over two): dated by its
 * last visit and worth what its visits billed together. A recurring job's visits are each a visit of the routine.
 * Takes work in date order.
 */
export function oneOffJobs(work: Job[]): Job[] {
  const key = (j: Job) => (j.visit && j.recurring === false && j.jobRef ? `${j.customerId}|${j.jobRef}` : undefined);
  const jobs = new Map<string, { last: Job; total: number }>();
  for (const j of work) {
    const k = key(j);
    if (k) jobs.set(k, { last: j, total: (jobs.get(k)?.total ?? 0) + j.total });
  }
  return work.flatMap((j) => {
    const one = jobs.get(key(j) ?? "");
    return !one ? [j] : one.last === j ? [{ ...j, total: round2(one.total) }] : [];
  });
}
