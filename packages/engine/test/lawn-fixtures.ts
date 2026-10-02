/**
 * Lawn and cleaning exports, made the same way on every run (seeded, never random between runs): a mowing shop's 40
 * clients and their 1,640 visits as Jobber's Visits report writes them, newest-first and oldest-first; the same
 * history as a Jobs report, an Invoices report and a bookings export; a cleaning shop's client list with and without a
 * frequency column, and its bookings of regulars who started with a deep clean; and a mowing shop through the seasons,
 * its Visits report as it stands on any day.
 */
import { toCSV } from "../src/ingest/csv.ts";
import type { ISODate } from "../src/model.ts";
import { addDays, pick, rng } from "../src/util.ts";

/** Mid-August, inside the mowing season: who stopped is plain, and their notes wait for the fall window. */
export const LAWN_ASOF: ISODate = "2026-08-14";
export const VISIT_ROWS = 1640;

export interface Visit {
  job: number;
  date: ISODate;
  title: string;
  done: boolean;
  recurring: boolean;
  /** What the visit billed: "Visit based ($)" on a recurring job, the one-off job's share on a one-off. */
  amount: number;
}

export interface LawnClient {
  name: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  zip: string;
  every: 7 | 14;
  /** Stopped coming two months or more before LAWN_ASOF. */
  lapsed: boolean;
  /** Stopped, but the owner never closed the job: its visits kept coming up and going by undone. */
  neverClosed?: boolean;
  visits: Visit[];
}

const FIRST = ["Mike", "Linda", "Tom", "Karen", "Steve", "Donna", "Paul", "Janet", "Gary", "Ruth", "Brian", "Carol", "Kevin", "Sharon", "Jeff", "Debra", "Scott", "Laura", "Eric", "Cindy", "Greg", "Amy", "Mark", "Tina", "Doug", "Wendy", "Ray", "Joan", "Phil", "Nancy", "Dale", "Beth", "Russ", "Gail", "Wayne", "Lori", "Glen", "Ann", "Rick", "Sue"];
const LAST = ["Sanderson", "Whitfield", "Alvarez", "Brennan", "Coutu", "Duval", "Ellis", "Fortin", "Gagnon", "Hale", "Irwin", "Jacques", "Kimball", "Lavoie", "Morin", "Nadeau", "Ouellette", "Pelletier", "Quimby", "Roy", "Stearns", "Tardif", "Upton", "Vachon", "Ward", "Young", "Ziegler", "Ames", "Bouchard", "Carr", "Dube", "Emery", "Foss", "Grant", "Hurd", "Ingalls", "Joy", "Kerr", "Libby", "Marsh"];
const STREETS = ["Oak Ln", "Pine St", "Maple Ave", "Birch Rd", "Elm St", "Cedar Dr", "Hilltop Rd", "Brook St"];
const TOWNS: [string, string][] = [["Concord", "03301"], ["Bow", "03304"], ["Hopkinton", "03229"]];

const season = (year: number): [ISODate, ISODate] => [`${year}-04-06`, `${year}-11-06`];

/** Every client and visit, oldest visit first per client. */
export function lawnClients(): LawnClient[] {
  const r = rng("lawn-visits-a2");
  const kinds: [boolean, 7 | 14][] = [
    ...Array.from({ length: 16 }, (): [boolean, 7 | 14] => [false, 7]),
    ...Array.from({ length: 9 }, (): [boolean, 7 | 14] => [false, 14]),
    ...Array.from({ length: 9 }, (): [boolean, 7 | 14] => [true, 7]),
    ...Array.from({ length: 6 }, (): [boolean, 7 | 14] => [true, 14]),
  ];
  // How each lapsed client stopped: at the end of last season, mid-season last year, or this May or June
  const stops: ISODate[] = ["2025-11-06", "2026-06-12", "2025-07-24", "2026-05-29"];
  let job = 1000;
  let lapsedSeen = 0;
  let activeSeen = 0;
  const clients = kinds.map(([lapsed, every], i): LawnClient => {
    const [town, zip] = TOWNS[i % TOWNS.length]!;
    const c: LawnClient = {
      name: `${FIRST[i]} ${LAST[i]}`,
      email: `${FIRST[i]!.toLowerCase()}.${LAST[i]!.toLowerCase()}@gmail.com`,
      phone: `603-224-${1100 + i}`,
      street: `${12 + i * 3} ${STREETS[i % STREETS.length]}`,
      city: town,
      zip,
      every,
      lapsed,
      visits: [],
    };
    const n = lapsed ? lapsedSeen++ : activeSeen++;
    c.neverClosed = lapsed && n === 1;
    const stop = lapsed ? stops[n % stops.length]! : LAWN_ASOF;
    const price = (every === 7 ? 40 : 50) + 5 * Math.floor(r() * 5);
    const first = stop < "2026-01-01" ? pick([2024, 2025], r) : pick([2024, 2024, 2025, 2026], r);
    const route = Math.floor(r() * 5);
    for (let year = first; year <= 2026; year++) {
      const [open, close] = season(year);
      if (open > stop) break;
      const num = ++job;
      for (let d = addDays(open, route); d <= close; d = addDays(d, every)) {
        const done = d <= stop && d <= LAWN_ASOF;
        // a closed job has no visits past the stop; one never closed keeps every one of them, undone
        if (!done && !c.neverClosed) continue;
        c.visits.push({ job: num, date: d, title: every === 7 ? "Weekly mowing" : "Biweekly mowing", done, recurring: true, amount: price });
      }
    }
    // a few one-off jobs between the mowing, none of them due again yet
    if (!lapsed && n % 5 === 0) c.visits.push({ job: ++job, date: addDays("2026-04-13", route), title: "Spring cleanup", done: true, recurring: false, amount: 180 });
    if (!lapsed && n % 7 === 3 && first <= 2025) {
      const num = ++job;
      for (const d of ["2025-10-27", "2025-10-28"]) c.visits.push({ job: num, date: d, title: "Fall cleanup", done: true, recurring: false, amount: 160 });
    }
    if (!lapsed && n === 4) c.visits.push({ job: ++job, date: "2025-05-20", title: "Mulch beds", done: true, recurring: false, amount: 240 });
    if (lapsed && stop === "2025-11-06" && n < 4) c.visits.push({ job: ++job, date: "2025-10-30", title: "Fall cleanup", done: true, recurring: false, amount: 175 });
    // one active regular whose rained-out visit in June was never marked done
    if (!lapsed && n === 1) c.visits.find((v) => v.date.startsWith("2026-06"))!.done = false;
    return c;
  });

  // Jobber lists what's on the calendar ahead too: the open regulars' coming visits, through the season
  const ahead = clients.filter((c) => !c.lapsed && clients.indexOf(c) % 3 !== 2);
  const next = new Map(ahead.map((c) => [c, c.visits.filter((v) => v.recurring).at(-1)!]));
  let rows = clients.reduce((s, c) => s + c.visits.length, 0);
  for (let i = 0; rows < VISIT_ROWS; i++) {
    const c = ahead[i % ahead.length]!;
    const prev = next.get(c)!;
    const date = addDays(prev.date, c.every);
    if (date > season(2026)[1]) throw new Error("not enough season left to reach the fixture's row count");
    const v = { ...prev, date, done: false };
    c.visits.push(v);
    next.set(c, v);
    rows++;
  }
  if (rows !== VISIT_ROWS) throw new Error(`the fixture has ${rows} visits, not ${VISIT_ROWS}`);
  for (const c of clients) c.visits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.job - b.job));
  return clients;
}

/** "Aug 14, 2026", the way Jobber's reports write a date. */
function jobberDate(d: ISODate): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function usDate(d: ISODate): string {
  return `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
}

const rowsOf = (clients: LawnClient[]) => clients.flatMap((c) => c.visits.map((v) => ({ c, v })));
const byDate = (a: { v: Visit }, b: { v: Visit }) => (a.v.date < b.v.date ? -1 : a.v.date > b.v.date ? 1 : a.v.job - b.v.job);

/**
 * Jobber's Visits report, with exactly its columns. On a fixed-price recurring job, "Visit based ($)" is blank: only a
 * job billed per visit fills it.
 */
export function visitsReport(clients: LawnClient[], order: "newest" | "oldest", perVisit = true): string {
  const rows = rowsOf(clients).sort(byDate);
  if (order === "newest") rows.reverse();
  return toCSV(
    ["Job #", "Date", "Visit title", "Client name", "Client email", "Client phone", "Service street", "Service city", "Service state", "Service ZIP", "Visit completed", "Assigned to", "Line items", "One-off job ($)", "Visit based ($)", "Scheduled duration", "Time tracked", "Job type"],
    rows.map(({ c, v }) => [
      v.job, jobberDate(v.date), v.title, c.name, c.email, c.phone, c.street, c.city, "NH", c.zip, v.done ? "Yes" : "No", c.every === 7 ? "Crew 1" : "Crew 2",
      v.recurring ? "Mow, trim & blow" : v.title, v.recurring ? "" : v.amount.toFixed(2), v.recurring && perVisit ? v.amount.toFixed(2) : "", v.recurring ? "0.75" : "3.5", v.done ? "00:45" : "", v.recurring ? "Recurring" : "One-off",
    ]),
  );
}

/**
 * Jobber's Jobs report for the same jobs: one row per job, worth what its visits done billed. A job with visits still
 * on the calendar, or one the owner never closed, is "Active" with no completed date; the rest are archived.
 */
export function jobsReport(clients: LawnClient[]): string {
  const jobs = clients.flatMap((c) => [...new Set(c.visits.map((v) => v.job))].map((job) => ({ c, visits: c.visits.filter((v) => v.job === job) })));
  return toCSV(
    ["Job #", "Client name", "Client email", "Title", "Job status", "Job type", "Created date", "Start date", "Completed date", "Total ($)"],
    jobs.map(({ c, visits }) => {
      const done = visits.filter((v) => v.done);
      const open = visits.some((v) => !v.done);
      const first = visits[0]!;
      return [
        first.job, c.name, c.email, first.title, open ? "Active" : "Archived", first.recurring ? "Recurring" : "One-off", usDate(addDays(first.date, -7)), usDate(first.date),
        open ? "" : usDate(done.at(-1)!.date), done.reduce((s, v) => s + v.amount, 0).toFixed(2),
      ];
    }),
  );
}

/** Jobber's Invoices report for the same work, and nothing else of it: a bill for each visit done, paid the day it's issued. */
export function invoicesReport(clients: LawnClient[]): string {
  return toCSV(
    ["Invoice #", "Client name", "Client email", "Subject", "Status", "Issued date", "Due date", "Paid date", "Total ($)", "Balance ($)", "Job #"],
    rowsOf(clients).filter(({ v }) => v.done).sort(byDate).map(({ c, v }, i) => [
      20001 + i, c.name, c.email, `For services rendered: ${v.title}`, "Paid", usDate(v.date), usDate(addDays(v.date, 30)), usDate(v.date), v.amount.toFixed(2), "0.00", v.job,
    ]),
  );
}

/** The same people and visits as a bookings export, the way cleaning booking software writes one. */
export function bookingsExport(clients: LawnClient[]): string {
  return toCSV(
    ["Booking ID", "Customer Name", "Email", "Phone", "Address", "City", "State", "Zip", "Service", "Frequency", "Booking Date", "Price", "Status"],
    rowsOf(clients).sort(byDate).map(({ c, v }, i) => [
      70001 + i, c.name, c.email, c.phone, c.street, c.city, "NH", c.zip, v.title, v.recurring ? (c.every === 7 ? "Weekly" : "Every other week") : "One-time", usDate(v.date), v.amount.toFixed(2),
      v.done ? "Completed" : v.date > LAWN_ASOF ? "Upcoming" : "Scheduled",
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* A cleaning shop's client list                                       */
/* ------------------------------------------------------------------ */

export const CLEANING_ASOF: ISODate = "2026-09-29";

export type Frequency = "Weekly" | "Every other week" | "Monthly" | "One-time";

export interface ListedClient {
  first: string;
  last: string;
  email: string;
  lastCleaning: ISODate;
  daysAgo: number;
  frequency: Frequency;
}

/** Last cleaned 2 to 14 days ago, 3 to 6 weeks ago (a weekly client gone quiet), or 7 weeks to 21 months ago. */
export function cleaningClients(): ListedClient[] {
  const FREQ: Frequency[] = ["Weekly", "Every other week", "Monthly", "One-time"];
  const groups: [number[], Frequency[]][] = [
    [[2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14], FREQ],
    [[24, 28, 33, 39], ["Weekly", "Every other week"]],
    [[46, 52, 60, 75, 90, 120, 150, 200, 260, 300, 340, 400, 500, 650], FREQ],
  ];
  let i = 0;
  return groups.flatMap(([days, freq]) =>
    days.map((daysAgo, k) => {
      const first = FIRST[i]!;
      const last = LAST[39 - i++]!;
      return { first, last, email: `${first.toLowerCase()}${last.toLowerCase()}@yahoo.com`, lastCleaning: addDays(CLEANING_ASOF, -daysAgo), daysAgo, frequency: freq[k % freq.length]! };
    }),
  );
}

/** The client list, with "Last Cleaning" and, when asked, a "Frequency" column. */
export function cleaningClientList(clients: ListedClient[], withFrequency: boolean): string {
  const head = ["First Name", "Last Name", "Email", "Phone", "Street", "City", "State", "Zip Code", "Last Cleaning", ...(withFrequency ? ["Frequency"] : [])];
  return toCSV(
    head,
    clients.map((c, i) => [c.first, c.last, c.email, `603-225-${1200 + i}`, `${20 + i} ${STREETS[i % STREETS.length]}`, "Concord", "NH", "03301", usDate(c.lastCleaning), ...(withFrequency ? [c.frequency] : [])]),
  );
}

/** Days since the last visit after which a cleaning client counts as gone, by what the list says (none: 45). */
export function cleaningThreshold(f: Frequency | undefined): number {
  return f === "Weekly" || f === "Every other week" ? 21 : 45;
}

export interface BookedClient {
  name: string;
  email: string;
  /** Stopped coming: not cleaned in the last two months. */
  stopped: boolean;
  bookings: { date: ISODate; service: string; frequency: string; price: number }[];
}

/**
 * Ten regulars cleaned every other week, each started with an initial deep clean 7 to 11 months before CLEANING_ASOF
 * and cleaned again 3 to 12 days before it: their deep clean has come due again, and they're still on the schedule.
 * Three more were cleaned every other week until 2 to 4 months before it, and one had a deep clean 8 months before it
 * and nothing since.
 */
export function deepCleanClients(): BookedClient[] {
  const deep = (daysAgo: number) => ({ date: addDays(CLEANING_ASOF, -daysAgo), service: "Initial Deep Clean", frequency: "One-time", price: 300 });
  // every other week, from `from` days before CLEANING_ASOF up to `to` days before it
  const regular = (from: number, to: number) =>
    Array.from({ length: Math.floor((from - to) / 14) + 1 }, (_, k) => ({ date: addDays(CLEANING_ASOF, -(to + 14 * k)), service: "Recurring Cleaning", frequency: "Every other week", price: 160 })).reverse();
  return Array.from({ length: 14 }, (_, i) => {
    const [first, last] = [FIRST[i]!, LAST[20 + i]!];
    const started = 210 + (i % 5) * 30;
    const bookings = i < 10 ? [deep(started), ...regular(started - 14, 3 + i)] : i < 13 ? regular(300, 60 + (i - 10) * 30) : [deep(240)];
    return { name: `${first} ${last}`, email: `${first.toLowerCase()}.${last.toLowerCase()}@outlook.com`, stopped: i >= 10, bookings };
  });
}

/** Their bookings export, every booking done. */
export function deepCleanBookings(clients: BookedClient[]): string {
  return toCSV(
    ["Booking ID", "Customer Name", "Email", "Service", "Frequency", "Booking Date", "Price", "Status"],
    clients.flatMap((c) => c.bookings.map((b) => ({ c, b }))).sort((x, y) => (x.b.date < y.b.date ? -1 : 1)).map(({ c, b }, i) => [80001 + i, c.name, c.email, b.service, b.frequency, usDate(b.date), b.price.toFixed(2), "Completed"]),
  );
}


/* ------------------------------------------------------------------ */
/* A mowing shop through the seasons                                    */
/* ------------------------------------------------------------------ */

/** The days it's scanned: mid-fall, the dead of winter, the end of winter and early summer. */
export const SEASON_SCANS: ISODate[] = ["2026-10-15", "2027-01-15", "2027-03-01", "2027-06-15"];

/**
 * Who a client is: a regular still on the schedule (one also had last fall's clean-up, one is new in 2026, one always
 * starts in mid-June, one only mows mid-June to late September); a regular who finishes 2026 as usual and doesn't come
 * back in 2027; one who stopped mid-season in July 2026; one who stopped at the end of 2025 and never came back; and
 * one-off customers whose fall clean-up, spring clean-up or aeration comes back each season.
 */
export type Story = "regular" | "regularWithCleanup" | "newIn2026" | "lateStarter" | "summerOnly" | "doneAfter2026" | "stoppedJuly2026" | "stoppedAfter2025" | "fallCleanup" | "springCleanup" | "aeration";

export interface SeasonalClient extends LawnClient {
  story: Story;
}

/** The shop mows from the third week of April to the end of October, inside New Hampshire's season. */
export const NH_MOWING: [string, string] = ["04-20", "10-29"];

/**
 * Each client's visits as the Visits report has them on `asOf`: done by then, and half the regulars' rest of the season
 * on the calendar. The shop mows each year from `mows[0]` to `mows[1]` ("MM-DD").
 */
export function seasonalClients(asOf: ISODate, mows = NH_MOWING): SeasonalClient[] {
  const stories: [Story, 7 | 14][] = [
    ...Array.from({ length: 8 }, (): [Story, 7 | 14] => ["regular", 7]),
    ...Array.from({ length: 4 }, (): [Story, 7 | 14] => ["regular", 14]),
    ["regularWithCleanup", 7], ["regularWithCleanup", 14],
    ["doneAfter2026", 7], ["doneAfter2026", 7], ["doneAfter2026", 14],
    ["stoppedJuly2026", 7], ["stoppedJuly2026", 7], ["stoppedJuly2026", 14],
    ["stoppedAfter2025", 7], ["stoppedAfter2025", 14],
    ["fallCleanup", 7], ["fallCleanup", 7], ["fallCleanup", 7],
    ["springCleanup", 7], ["springCleanup", 7],
    ["aeration", 7],
    ["lateStarter", 7], ["summerOnly", 7], ["newIn2026", 7],
  ];
  const lastSeason: Partial<Record<Story, number>> = { regular: 2027, regularWithCleanup: 2027, newIn2026: 2027, lateStarter: 2027, summerOnly: 2027, doneAfter2026: 2026, stoppedJuly2026: 2026, stoppedAfter2025: 2025 };
  const span: Partial<Record<Story, [string, string]>> = { lateStarter: ["06-16", mows[1]], summerOnly: ["06-16", "09-25"] };
  let job = 5000;
  return stories.map(([story, every], i): SeasonalClient => {
    const [town, zip] = TOWNS[i % TOWNS.length]!;
    const c: SeasonalClient = {
      name: `${FIRST[i]} ${LAST[i]}`,
      email: `${FIRST[i]!.toLowerCase()}.${LAST[i]!.toLowerCase()}@comcast.net`,
      phone: `603-225-${1300 + i}`,
      street: `${30 + i * 4} ${STREETS[i % STREETS.length]}`,
      city: town,
      zip,
      every,
      lapsed: story === "stoppedJuly2026" || story === "stoppedAfter2025" || (story === "doneAfter2026" && asOf >= "2027-06-01"),
      visits: [],
      story,
    };
    const stop = story === "stoppedJuly2026" ? "2026-07-10" : "9999";
    for (let year = story === "newIn2026" ? 2026 : 2024; year <= (lastSeason[story] ?? 0); year++) {
      const [open, close] = (span[story] ?? mows).map((md) => `${year}-${md}`) as [ISODate, ISODate];
      if (open > asOf) break;
      const num = ++job;
      for (let d = addDays(open, i % 5); d <= close && d <= stop && (d <= asOf || i % 2 === 0); d = addDays(d, every)) {
        c.visits.push({ job: num, date: d, title: every === 7 ? "Weekly mowing" : "Biweekly mowing", done: d <= asOf, recurring: true, amount: every === 7 ? 45 : 55 });
      }
    }
    const oneOff = (date: ISODate, title: string, amount: number) => {
      if (date <= asOf) c.visits.push({ job: ++job, date, title, done: true, recurring: false, amount });
    };
    if (story === "regularWithCleanup" || story === "fallCleanup") oneOff("2025-10-21", "Fall cleanup", 180);
    if (story === "springCleanup") oneOff("2026-04-14", "Spring cleanup", 160);
    if (story === "aeration") oneOff("2025-09-16", "Fall aeration & overseed", 220);
    c.visits.sort((a, b) => (a.date < b.date ? -1 : 1));
    return c;
  });
}
