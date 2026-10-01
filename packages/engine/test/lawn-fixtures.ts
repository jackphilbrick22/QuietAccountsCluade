/**
 * Lawn and cleaning exports, made the same way on every run (seeded, never random between runs): a mowing shop's 40
 * clients and their 1,640 visits as Jobber's Visits report writes them, newest-first and oldest-first; the same
 * history as a bookings export; and a cleaning shop's client list with and without a frequency column.
 */
import { toCSV } from "../src/ingest/csv.ts";
import type { ISODate } from "../src/model.ts";
import { addDays, pick, rng } from "../src/util.ts";

/** Mid-August, inside the mowing season: who stopped is plain before lawn seasons exist. */
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

