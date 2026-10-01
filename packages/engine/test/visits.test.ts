import { beforeAll, describe, expect, it } from "vitest";
import { scan, type ScanResult } from "../src/breakage/detect.ts";
import { readiness } from "../src/breakage/readiness.ts";
import { visitBook } from "../src/breakage/visits.ts";
import { parseTable, toCSV } from "../src/ingest/csv.ts";
import { detect, mapColumns } from "../src/ingest/detect.ts";
import type { Field } from "../src/ingest/fields.ts";
import { emptyDataset, ingestFile } from "../src/ingest/index.ts";
import { scheduledWork } from "../src/lookup.ts";
import type { BusinessProfile, Dataset, ISODate, TradeId } from "../src/model.ts";
import { attribute } from "../src/ledger/attribution.ts";
import { dueTouches, find, planBatch } from "../src/runtime/agents.ts";
import { emptyState } from "../src/runtime/state.ts";
import { addDays, daysBetween, round2 } from "../src/util.ts";
import { ago, ASOF, business, customer, dataset, job, oneOpp, oppsFor, reachable } from "./fixtures.ts";
import { bookingsExport, CLEANING_ASOF, cleaningClientList, cleaningClients, cleaningThreshold, LAWN_ASOF, lawnClients, VISIT_ROWS, visitsReport, type LawnClient } from "./lawn-fixtures.ts";

const lawn = (over: Partial<BusinessProfile> = {}) => business({ trade: "lawn", name: "Greenline Lawn Care", avgJobValue: undefined, ...over });
const cleaning = () => business({ trade: "cleaning", name: "Sparkle House Cleaning", avgJobValue: undefined });
/** Every `days` days from `from` through `to`. */
const every = (from: ISODate, to: ISODate, days: number) => {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, days)) out.push(d);
  return out;
};
const VISITS_HEAD = "Job #,Date,Visit title,Client name,Client email,Visit completed,Visit based ($),Job type";
/** Visits report rows for one client's job: done through `doneTo`, on the calendar undone after. */
const visitRows = (job: number, name: string, dates: ISODate[], doneTo: ISODate, title = "Weekly mowing", amount = 45) =>
  dates.map((d) => `${job},${d},${title},${name},${name.split(" ")[0]!.toLowerCase()}@gmail.com,${d <= doneTo ? "Yes" : "No"},${amount.toFixed(2)},Recurring`);
const read = (csv: string, name: string, b: BusinessProfile = lawn(), asOf = LAWN_ASOF, ds?: Dataset) =>
  ingestFile(ds ?? emptyDataset(b, asOf), csv, name, `${asOf}T12:00:00Z`);
const headerOf = (csv: string, name: string, field: Field) => {
  const t = parseTable(csv);
  const i = detect(t, name).mapping.fields[field];
  return i === undefined ? undefined : t.headers[i];
};

/** Who each opportunity is for, by email, with what it is and whether it's held. */
const found = (ds: Dataset, r: ScanResult) => {
  const email = new Map(ds.customers.map((c) => [c.id, c.emails[0]!]));
  return r.opportunities.map((o) => ({ email: email.get(o.customerId)!, type: o.type, suppressed: o.suppressed, value: o.value, reason: o.reason, anchor: o.anchorDate }));
};

describe("Jobber's Visits report", () => {
  const clients = lawnClients();
  const newest = visitsReport(clients, "newest");

  it("is read as visits, not jobs, whatever the file is called", () => {
    for (const name of ["Visits Report.csv", "export (3).csv"]) {
      const d = detect(parseTable(newest), name);
      expect(d.kind).toBe("visit");
      // sure enough that nobody is asked to check the columns
      expect(d.kindConfidence).toBeGreaterThanOrEqual(0.5);
      expect(d.source).toBe("jobber");
    }
    const at = (field: Field) => headerOf(newest, "export.csv", field);
    expect(at("scheduledOn")).toBe("Date");
    expect(at("title")).toBe("Visit title");
    expect(at("jobNumber")).toBe("Job #");
    expect(at("number")).toBeUndefined();
    expect(at("perVisit")).toBe("Visit based ($)");
    expect(at("total")).toBe("One-off job ($)");
    expect(at("done")).toBe("Visit completed");
    expect(at("jobType")).toBe("Job type");
    expect(at("name")).toBe("Client name");
    expect(at("street")).toBe("Service street");
    expect(at("zip")).toBe("Service ZIP");
  });

  for (const order of ["newest", "oldest"] as const) {
    describe(`with rows ${order}-first`, () => {
      let ds: Dataset;
      let result: ScanResult;
      const idOf = (c: LawnClient) => ds.customers.find((x) => x.emails.includes(c.email))!.id;
      beforeAll(() => {
        const out = read(visitsReport(clients, order), "Visits Report.csv");
        expect(out.record.kind).toBe("visit");
        expect(out.record.accepted).toBe(VISIT_ROWS);
        const undone = clients.flatMap((c) => c.visits).filter((v) => !v.done && v.date <= LAWN_ASOF).length;
        expect(out.record.warnings).toContain(`${undone} past visits aren't marked complete, so they don't count as work done.`);
        ds = out.dataset;
        result = scan(ds);
      });

      it("gives 40 customers, each with their full history of visits", () => {
        expect(ds.customers).toHaveLength(40);
        expect(ds.jobs).toHaveLength(VISIT_ROWS);
        for (const c of clients) {
          const mine = ds.jobs.filter((j) => j.customerId === idOf(c));
          expect(mine.every((j) => j.visit)).toBe(true);
          const seen = mine.map((j) => [j.scheduledOn, j.title, j.total, j.status === "completed", !!j.recurring].join("|")).sort();
          expect(seen).toEqual(c.visits.map((v) => [v.date, v.title, v.amount, v.done, v.recurring].join("|")).sort());
        }
      });

      it("finds every lapsed regular as a lapsed regular, ready to write to", () => {
        const lapsed = clients.filter((c) => c.lapsed);
        expect(lapsed).toHaveLength(15);
        for (const c of lapsed) {
          const o = oneOpp(result, idOf(c), "lapsed_regular");
          expect(o.suppressed).toBeUndefined();
          // dated by the last visit done: never by a visit that went by undone or is still to come
          expect(o.anchorDate).toBe(c.visits.filter((v) => v.done && v.recurring).at(-1)!.date);
          expect(result.primary.find((p) => p.customerId === idOf(c))?.type).toBe("lapsed_regular");
        }
      });

      it("flags no active customer, by any kind of opportunity", () => {
        const active = new Set(clients.filter((c) => !c.lapsed).map(idOf));
        expect(active.size).toBe(25);
        expect(result.opportunities.filter((o) => active.has(o.customerId))).toEqual([]);
      });
    });
  }

  it("keeps the same records whichever way the rows run, and a re-sent report updates them in place", () => {
    const a = read(newest, "Visits Report.csv").dataset;
    const b = read(visitsReport(clients, "oldest"), "Visits Report.csv").dataset;
    const key = (ds: Dataset) => ds.jobs.map((j) => `${j.id}|${j.scheduledOn}|${j.status}|${j.total}`).sort();
    expect(key(b)).toEqual(key(a));
    // the next week's report: the visit that was coming is now done
    const coming = clients.find((c) => !c.lapsed && c.visits.some((v) => v.date > LAWN_ASOF))!;
    const v = coming.visits.find((x) => x.date > LAWN_ASOF)!;
    const next = lawnClients().map((c) => (c.email === coming.email ? { ...c, visits: c.visits.map((x) => (x.date === v.date ? { ...x, done: true } : x)) } : c));
    const again = read(visitsReport(next, "oldest"), "Visits Report.csv", lawn(), LAWN_ASOF, a).dataset;
    expect(again.jobs).toHaveLength(VISIT_ROWS);
    expect(again.jobs.filter((j) => j.scheduledOn === v.date && a.customers.find((c) => c.id === j.customerId)!.emails.includes(coming.email)).map((j) => j.status)).toEqual(["completed"]);
  });

  it("a re-sent report without the visits taken off the calendar reads like that report alone, marked or not", () => {
    // June 1st's report has Mike weekly through November. He stopped after June 8th and his job was closed, so
    // September 1st's report has him only through June 8th, and Linda's June 16th visit moved to the 17th for rain.
    for (const marked of [true, false]) {
      const report = (asOf: ISODate, mikeTo: ISODate, lindaOn: ISODate) =>
        [
          VISITS_HEAD,
          ...visitRows(901, "Mike Sanderson", every("2026-04-06", mikeTo, 7), marked ? asOf : ""),
          ...visitRows(902, "Linda Whitfield", every("2026-04-07", "2026-11-03", 7).map((d) => (d === "2026-06-16" ? lindaOn : d)), marked ? asOf : "", "Weekly mowing", 50),
        ].join("\n");
      const june = read(report("2026-06-01", "2026-11-02", "2026-06-16"), "Visits Report.csv", lawn(), "2026-06-01").dataset;
      const sept = report("2026-09-01", "2026-06-08", "2026-06-17");
      const again = read(sept, "Visits Report.csv", lawn(), "2026-09-01", { ...june, asOf: "2026-09-01" }).dataset;
      const fresh = read(sept, "Visits Report.csv", lawn(), "2026-09-01").dataset;
      const history = (ds: Dataset) => ds.jobs.map((j) => [ds.customers.find((c) => c.id === j.customerId)!.emails[0], j.scheduledOn, j.status].join("|")).sort();
      expect(history(again)).toEqual(history(fresh));
      expect(found(again, scan(again))).toEqual(found(fresh, scan(fresh)));
      expect(found(again, scan(again)).map((x) => [x.email, x.type, x.suppressed, x.anchor])).toEqual([["mike@gmail.com", "lapsed_regular", undefined, "2026-06-08"]]);
    }
  });

  it("bills a visit what it billed: 'Visit based', or the one-off job's share when that's the one filled in", () => {
    const CSV = `Job #,Date,Visit title,Client name,Client email,Visit completed,One-off job ($),Visit based ($),Job type
301,Jul 7 2026,Weekly mowing,Mike Sanderson,mike@gmail.com,Yes,0.00,45.00,Recurring
302,Jun 1 2026,Spring cleanup,Mike Sanderson,mike@gmail.com,Yes,180.00,0.00,One-off
303,Jun 2 2026,Mulch,Mike Sanderson,mike@gmail.com,Yes,120.00,,One-off
`;
    const { dataset: ds } = read(CSV, "Visits Report.csv");
    expect(Object.fromEntries(ds.jobs.map((j) => [j.title, [j.total, !!j.recurring]]))).toEqual({ "Weekly mowing": [45, true], "Spring cleanup": [180, false], Mulch: [120, false] });
  });

  it("never counts a visit that wasn't marked done as work done, and says how many went by undone", () => {
    // Mike's job was never closed: its visits kept coming up all summer and went by undone, while the shop marked
    // Linda's done every week
    const CSV = [
      VISITS_HEAD,
      ...visitRows(401, "Mike Sanderson", every("2026-05-01", "2026-08-21", 7), "2026-05-15"),
      "401,,Weekly mowing,Mike Sanderson,mike@gmail.com,No,45.00,Recurring",
      ...visitRows(402, "Linda Whitfield", every("2026-05-06", "2026-08-12", 7), LAWN_ASOF, "Weekly mowing", 50),
    ].join("\n");
    const { dataset: ds, record } = read(CSV, "Visits Report.csv");
    const mike = ds.customers.find((c) => c.emails.includes("mike@gmail.com"))!.id;
    const statuses = ds.jobs.filter((j) => j.customerId === mike).map((j) => [j.scheduledOn ?? "", j.status]);
    expect(statuses.slice(0, 4)).toEqual([["2026-05-01", "completed"], ["2026-05-08", "completed"], ["2026-05-15", "completed"], ["2026-05-22", "scheduled"]]);
    expect(statuses.slice(-2)).toEqual([["2026-08-21", "scheduled"], ["", "unscheduled"]]);
    expect(record.warnings).toContain("12 past visits aren't marked complete, so they don't count as work done.");
    // gone since mid-May: the visits that went by undone say the rest of the calendar is a schedule nobody cleared
    const r = scan(ds);
    const o = oneOpp(r, mike, "lapsed_regular");
    expect(o.suppressed).toBeUndefined();
    expect(o.anchorDate).toBe("2026-05-15");
    expect(o.evidence).toContain("3 visits on file");
    expect(oppsFor(r, ds.customers.find((c) => c.emails.includes("linda@gmail.com"))!.id)).toEqual([]);
  });

  it("one visit skipped with the next ones booked is a client still on the schedule; two weeks' more misses are not", () => {
    // a cleaning client every other week since March, who skipped September 15th; the shop marks its visits each day
    const file = (asOf: ISODate) =>
      read(
        [
          VISITS_HEAD,
          ...visitRows(501, "Karen Brennan", every("2026-03-03", "2026-10-13", 14), "2026-09-01", "Biweekly cleaning", 160),
          ...visitRows(502, "Donna Duval", every("2026-08-04", "2026-10-13", 7), addDays(asOf, -1), "Weekly cleaning", 120),
        ].join("\n"),
        "Visits Report.csv",
        cleaning(),
        asOf,
      ).dataset;
    const karen = (ds: Dataset) => ds.customers.find((c) => c.emails.includes("karen@gmail.com"))!.id;
    const held = file("2026-09-24");
    // three weeks since her last cleaning: past cleaning's limit, but her next one is booked
    expect(oppsFor(scan(held), karen(held)).map((o) => [o.type, o.suppressed])).toEqual([["lapsed_regular", "active_work"]]);
    // a week later the 29th went by undone too: a month of misses, and the visits left booked are what nobody cleared
    const gone = file("2026-10-01");
    expect(reachable(scan(gone), karen(gone), "lapsed_regular")).toHaveLength(1);
  });

  it("a month nobody has marked yet, across every client, is no month of misses", () => {
    // a cleaning shop that marks visits done when it invoices, at the start of each month: September isn't marked yet.
    // Carol stopped in July and her job was never closed.
    const asOf = "2026-09-24";
    const CSV = [
      VISITS_HEAD,
      ...visitRows(601, "Karen Brennan", every("2026-03-03", "2026-10-27", 14), "2026-08-31", "Biweekly cleaning", 160),
      ...visitRows(602, "Donna Duval", every("2026-03-02", "2026-10-26", 7), "2026-08-31", "Weekly cleaning", 120),
      ...visitRows(603, "Janet Fortin", every("2026-03-06", "2026-10-30", 7), "2026-08-31", "Weekly cleaning", 120),
      ...visitRows(604, "Carol Hale", every("2026-03-05", "2026-10-29", 7), "2026-07-09", "Weekly cleaning", 120),
    ].join("\n");
    const { dataset: ds, record } = read(CSV, "Visits Report.csv", cleaning(), asOf);
    const sept = ds.jobs.filter((j) => j.status === "scheduled" && j.scheduledOn! > "2026-08-31" && j.scheduledOn! <= asOf).length;
    expect(record.warnings).toContain(`${sept} past visits since the last one marked complete (August 31) aren't marked yet, so their dates say whether they happened.`);
    const r = scan(ds);
    const carol = ds.customers.find((c) => c.emails.includes("carol@gmail.com"))!.id;
    expect(r.opportunities.filter((o) => !o.suppressed).map((o) => [o.customerId, o.type])).toEqual([[carol, "lapsed_regular"]]);
    expect(oneOpp(r, carol, "lapsed_regular").anchorDate).toBe("2026-07-09");
  });

  it("a visit or two marked done the day they were done, in a month nobody has marked yet, make no month of misses", () => {
    // the same shop: September isn't marked yet, but Ruth's move-out clean was marked done on the 23rd, when it was
    // invoiced, and Janet's visit on the 18th was marked done while the two before it weren't
    const asOf = "2026-09-24";
    const CSV = [
      VISITS_HEAD,
      ...visitRows(601, "Karen Brennan", every("2026-03-03", "2026-10-27", 14), "2026-08-31", "Biweekly cleaning", 160),
      ...visitRows(602, "Donna Duval", every("2026-03-02", "2026-10-26", 7), "2026-08-31", "Weekly cleaning", 120),
      ...visitRows(603, "Janet Fortin", every("2026-03-06", "2026-10-30", 7), "2026-08-31", "Weekly cleaning", 120).map((r) => (r.startsWith("603,2026-09-18,") ? r.replace(",No,", ",Yes,") : r)),
      ...visitRows(604, "Carol Hale", every("2026-03-05", "2026-10-29", 7), "2026-07-09", "Weekly cleaning", 120),
      "605,2026-09-23,Move-out clean,Ruth Ames,ruth@gmail.com,Yes,,One-off",
    ].join("\n");
    const { dataset: ds, record } = read(CSV, "Visits Report.csv", cleaning(), asOf);
    const carol = ds.customers.find((c) => c.emails.includes("carol@gmail.com"))!.id;
    // Carol's seven weeks since July, and Janet's two before the one of hers that was marked
    expect(record.warnings).toContain("9 past visits aren't marked complete, so they don't count as work done.");
    expect(record.warnings).toContain("9 past visits since the last one marked complete (August 31) aren't marked yet, so their dates say whether they happened.");
    const r = scan(ds);
    expect(r.opportunities.filter((o) => !o.suppressed).map((o) => [o.customerId, o.type])).toEqual([[carol, "lapsed_regular"]]);
    expect(oneOpp(r, carol, "lapsed_regular").anchorDate).toBe("2026-07-09");
  });

  it("a crew that marks its visits monthly and one that marks them daily each keep their own clock", () => {
    // Ana's clients are marked at the end of each month, Maria's the day of each visit. Carol, on Ana's route, stopped
    // in July and her job was never closed.
    const asOf = "2026-09-29";
    const crew = (name: string) => (row: string) => row.replace(/,Recurring$/, `,Recurring,${name}`);
    const CSV = [
      `${VISITS_HEAD},Assigned to`,
      ...visitRows(611, "Donna Duval", every("2026-03-02", "2026-10-26", 7), "2026-08-31", "Weekly cleaning", 120).map(crew("Ana")),
      ...visitRows(612, "Carol Hale", every("2026-03-05", "2026-10-29", 7), "2026-07-09", "Weekly cleaning", 120).map(crew("Ana")),
      ...visitRows(613, "Janet Fortin", every("2026-03-06", "2026-10-30", 7), "2026-09-28", "Weekly cleaning", 120).map(crew("Maria")),
      ...visitRows(614, "Karen Brennan", every("2026-03-03", "2026-10-27", 14), "2026-09-28", "Biweekly cleaning", 160).map(crew("Maria")),
    ].join("\n");
    const { dataset: ds } = read(CSV, "Visits Report.csv", cleaning(), asOf);
    expect(new Set(ds.jobs.map((j) => j.crew))).toEqual(new Set(["Ana", "Maria"]));
    const r = scan(ds);
    const carol = ds.customers.find((c) => c.emails.includes("carol@gmail.com"))!.id;
    expect(r.opportunities.filter((o) => !o.suppressed).map((o) => [o.customerId, o.type])).toEqual([[carol, "lapsed_regular"]]);
  });

  it("a one-off job over several days is one job, never a regular: lawn, landscape and cleaning", () => {
    // Jobber splits a one-off job's price across its visits in "One-off job ($)"
    const HEAD = "Job #,Date,Visit title,Client name,Client email,Visit completed,One-off job ($),Visit based ($),Job type";
    const oneOff = (job: number, name: string, title: string, dates: ISODate[], share: number) =>
      dates.map((d) => `${job},${d},${title},${name},${name.split(" ")[0]!.toLowerCase()}@gmail.com,Yes,${share.toFixed(2)},,One-off`);
    // what's left is what fits one job: the patio's lighting, the deep clean due again (for both days of it), and the
    // fall cleanup waiting for its season
    const cases: [BusinessProfile, ISODate, string[], string[]][] = [
      [lawn({ trade: "landscape" }), LAWN_ASOF, oneOff(2001, "Mike Sanderson", "Paver patio", every("2026-04-06", "2026-04-09", 1), 2000), ["missed_upsell"]],
      [lawn(), LAWN_ASOF, oneOff(2002, "Linda Whitfield", "Fall cleanup", every("2025-10-20", "2025-10-22", 1), 150), []],
      [cleaning(), CLEANING_ASOF, oneOff(2003, "Karen Brennan", "Deep clean", ["2026-03-10", "2026-03-11"], 210), ["service_due"]],
    ];
    for (const [b, asOf, rows, types] of cases) {
      const { dataset: ds } = read([HEAD, ...rows].join("\n"), "Visits Report.csv", b, asOf);
      expect(ds.jobs.every((j) => j.recurring === false)).toBe(true);
      expect(scan(ds).opportunities.map((o) => o.type)).toEqual(types);
      // the same as with the column
      const { dataset: typed } = read([`${HEAD},Job type`, ...rows.map((r) => `${r},One-off`)].join("\n"), "Visits Report.csv", b, asOf);
      expect(found(ds, scan(ds))).toEqual(found(typed, scan(typed)));
    }
    const { dataset: clean } = read([HEAD, ...cases[2]![2]].join("\n"), "Visits Report.csv", cleaning(), CLEANING_ASOF);
    expect(oneOpp(scan(clean), clean.customers[0]!.id, "service_due").evidence[0]).toBe("Job: “Deep clean” — $420, back in March");
    // a year on: two jobs over several days each are two one-off jobs, each worth all its days
    const { dataset: ds } = read(
      [HEAD, ...cases[0]![2], ...oneOff(2004, "Mike Sanderson", "Retaining wall", every("2026-05-11", "2026-05-13", 1), 1500)].join("\n"),
      "Visits Report.csv",
      lawn({ trade: "landscape" }),
      "2027-06-01",
    );
    const o = oneOpp(scan(ds), ds.customers[0]!.id, "one_and_done");
    expect(o.reason).toBe("Hired you 2 times for one-off jobs, most recently last May, and hasn't been back.");
    expect(o.evidence).toEqual(["Job: “Retaining wall” — $4,500, last May", "2 jobs on file, no routine service"]);
  });

  it("a file with nothing marked done lets each visit's date decide", () => {
    const CSV = [
      VISITS_HEAD,
      ...visitRows(701, "Mike Sanderson", every("2026-04-06", "2026-09-28", 7), ""),
      ...visitRows(702, "Linda Whitfield", every("2026-04-07", "2026-05-12", 7), ""),
    ].join("\n");
    const { dataset: ds, record } = read(CSV, "Visits Report.csv");
    expect(record.warnings).toContain("No visit is marked complete, so each visit's date says whether it happened.");
    const r = scan(ds);
    const linda = ds.customers.find((c) => c.emails.includes("linda@gmail.com"))!.id;
    expect(r.opportunities.filter((o) => !o.suppressed).map((o) => [o.customerId, o.type, o.anchorDate])).toEqual([[linda, "lapsed_regular", "2026-05-12"]]);
  });

  it("values a regular on a fixed-price contract, whose visits bill nothing, by a typical visit: never the one-off jobs", () => {
    const { dataset: ds } = read(visitsReport(clients, "newest", false), "Visits Report.csv");
    const r = scan(ds);
    for (const c of clients.filter((x) => x.lapsed)) {
      const o = oneOpp(r, ds.customers.find((x) => x.emails.includes(c.email))!.id, "lapsed_regular");
      expect(o.suppressed).toBeUndefined();
      // with no mowing of the shop's own priced, the trade's smallest ticket, a mow, each week or every other week of
      // New Hampshire's 28-week season
      expect(o.value).toBe(45 * (c.every === 7 ? 28 : 14));
      expect(o.evidence).toContain("No amount on file for their visits — valued at your typical visit ($45).");
    }
    // a regular whose mowing is priced is worth their own visits, never their fall cleanup's price
    const { dataset: priced } = read(newest, "Visits Report.csv");
    const c = clients.find((x) => x.lapsed && x.visits.some((v) => !v.recurring))!;
    const mow = c.visits.find((v) => v.recurring)!.amount;
    expect(oneOpp(scan(priced), priced.customers.find((x) => x.emails.includes(c.email))!.id, "lapsed_regular").value).toBe(mow * (c.every === 7 ? 28 : 14));
  });

  it("names no crew from a schedule that stopped: what's left on a never-closed calendar is no crew coming", () => {
    const { dataset: ds } = read(newest, "Visits Report.csv");
    const id = (c: LawnClient) => ds.customers.find((x) => x.emails.includes(c.email))!.id;
    const work = scheduledWork(ds);
    expect(work.some((w) => w.customerId === id(clients.find((c) => c.neverClosed)!))).toBe(false);
    const ahead = clients.find((c) => !c.lapsed && c.visits.some((v) => v.date > LAWN_ASOF))!;
    expect(work.some((w) => w.customerId === id(ahead) && w.date > LAWN_ASOF)).toBe(true);
  });

  it("a client list and the Visits report, in either order, give the same visits and the same results", () => {
    const LIST = toCSV(["Client name", "Client email", "Last Visit"], clients.map((c) => [c.name, c.email, c.visits.filter((v) => v.done).at(-1)!.date]));
    const visitsFirst = read(LIST, "Clients.csv", lawn(), LAWN_ASOF, read(newest, "Visits Report.csv").dataset).dataset;
    const listFirst = read(newest, "Visits Report.csv", lawn(), LAWN_ASOF, read(LIST, "Clients.csv").dataset).dataset;
    const history = (ds: Dataset) =>
      ds.jobs.map((j) => [ds.customers.find((c) => c.id === j.customerId)!.emails[0], j.completedOn ?? j.scheduledOn, j.title, j.total, j.status, !!j.fromList].join("|")).sort();
    expect(visitsFirst.jobs).toHaveLength(VISIT_ROWS);
    expect(history(listFirst)).toEqual(history(visitsFirst));
    const results = (ds: Dataset) => found(ds, scan(ds)).map((x) => JSON.stringify(x)).sort();
    expect(results(listFirst)).toEqual(results(visitsFirst));
    expect(results(listFirst)).toEqual(results(read(newest, "Visits Report.csv").dataset));
  });

  it("a regular who stopped but has a visit booked, with nothing gone by undone, is coming back: never written to", () => {
    const CSV = `Job #,Date,Visit title,Client name,Client email,Visit completed,Visit based ($),Job type
501,May 1 2026,Weekly mowing,Mike Sanderson,mike@gmail.com,Yes,45.00,Recurring
501,May 8 2026,Weekly mowing,Mike Sanderson,mike@gmail.com,Yes,45.00,Recurring
501,May 15 2026,Weekly mowing,Mike Sanderson,mike@gmail.com,Yes,45.00,Recurring
502,Aug 21 2026,Weekly mowing,Mike Sanderson,mike@gmail.com,No,45.00,Recurring
`;
    const { dataset: ds } = read(CSV, "Visits Report.csv");
    expect(oneOpp(scan(ds), ds.customers[0]!.id, "lapsed_regular").suppressed).toBe("active_work");
  });
});

describe("a bookings export", () => {
  const clients = lawnClients();
  const BOOKINGS = bookingsExport(clients);

  it("reads as visits, never as won quotes", () => {
    for (const name of ["Bookings.csv", "export.csv"]) expect(detect(parseTable(BOOKINGS), name).kind).toBe("visit");
    const at = (field: Field) => headerOf(BOOKINGS, "export.csv", field);
    expect(at("number")).toBe("Booking ID");
    expect(at("title")).toBe("Service");
    expect(at("jobType")).toBe("Frequency");
    expect(at("scheduledOn")).toBe("Booking Date");
    expect(at("total")).toBe("Price");
    expect(at("status")).toBe("Status");
    const { dataset: ds, record } = read(BOOKINGS, "export.csv");
    expect(record.kind).toBe("visit");
    expect(ds.quotes).toEqual([]);
    expect(ds.jobs).toHaveLength(VISIT_ROWS);
    // its frequency gives the rhythm
    expect(new Set(ds.jobs.filter((j) => j.recurring).map((j) => j.everyDays))).toEqual(new Set([7, 14]));
  });

  it("finds what the Visits report finds, customer for customer", () => {
    const fromVisits = read(visitsReport(clients, "newest"), "Visits Report.csv").dataset;
    const fromBookings = read(BOOKINGS, "Bookings.csv").dataset;
    expect(fromBookings.customers).toHaveLength(40);
    const history = (ds: Dataset) =>
      ds.jobs.map((j) => [ds.customers.find((c) => c.id === j.customerId)!.emails[0], j.scheduledOn, j.title, j.total, j.status === "completed"].join("|")).sort();
    expect(history(fromBookings)).toEqual(history(fromVisits));
    const results = (ds: Dataset) => found(ds, scan(ds)).map((x) => JSON.stringify(x)).sort();
    expect(results(fromBookings)).toEqual(results(fromVisits));
    expect(found(fromBookings, scan(fromBookings)).filter((x) => x.type === "lapsed_regular" && !x.suppressed)).toHaveLength(15);
  });
});

describe("notes to the people it finds", () => {
  /** The fall window's first send day: a lawn shop's past customers hear from it from September, never in August. */
  const FALL: ISODate = "2026-09-01";
  /** The scan's finds planned and approved, and what goes the morning the last note 1 is due (the day moved on to it, as each night does). */
  const firstNotes = (ds: Dataset) => {
    const now = `${ds.asOf}T12:00:00Z`;
    const st = emptyState(ds, now);
    find(st, now);
    expect(planBatch(st, now, { startOn: ds.asOf, approve: true }).people).toEqual([]);
    const planned = planBatch(st, now, { startOn: FALL, approve: true }).people;
    const at = st.touches.filter((t) => t.step === 1).map((t) => t.dueAt).sort().at(-1)!;
    st.dataset.asOf = at.slice(0, 10);
    const { due, held } = dueTouches(st, at);
    return { st, at, planned: [...planned].sort(), sent: due.filter((d) => d.touch.step === 1).map((d) => d.touch.customerId).sort(), held: held.map((h) => h.why) };
  };

  it("every lapsed regular in the Visits report or the bookings export gets note 1, the one whose job was never closed too", () => {
    const clients = lawnClients();
    for (const [csv, name] of [[visitsReport(clients, "newest"), "Visits Report.csv"], [bookingsExport(clients), "Bookings.csv"]] as const) {
      const { dataset: ds } = read(csv, name);
      const lapsed = clients.filter((c) => c.lapsed).map((c) => ds.customers.find((x) => x.emails.includes(c.email))!.id).sort();
      const { planned, sent, held } = firstNotes(ds);
      expect(planned).toEqual(lapsed);
      expect(sent).toEqual(lapsed);
      expect(held).toEqual([]);
    }
  });

  it("a regular who stopped, with a visit last year that went by undone, gets note 1; booked again since, it's held", () => {
    // Linda's mowing stopped in May, and a visit of hers last June was rained out and never marked done
    const rows = [
      VISITS_HEAD,
      ...visitRows(801, "Linda Whitfield", every("2025-04-08", "2025-11-04", 7), "2025-11-04").map((r) => (r.startsWith("801,2025-06-10,") ? r.replace(",Yes,", ",No,") : r)),
      ...visitRows(802, "Linda Whitfield", every("2026-04-07", "2026-05-26", 7), "2026-05-26"),
      ...visitRows(803, "Mike Sanderson", every("2026-04-06", "2026-10-26", 7), LAWN_ASOF),
    ];
    const { dataset: ds } = read(rows.join("\n"), "Visits Report.csv");
    const linda = ds.customers.find((c) => c.emails.includes("linda@gmail.com"))!.id;
    expect(ds.jobs.filter((j) => j.customerId === linda && j.status === "scheduled").map((j) => j.scheduledOn)).toEqual(["2025-06-10"]);
    const { st, at, sent } = firstNotes(ds);
    expect(sent).toEqual([linda]);
    // the next report has her back on the schedule from next week: her note isn't needed any more
    st.dataset = read([...rows, ...visitRows(804, "Linda Whitfield", every(addDays(at.slice(0, 10), 7), "2026-10-27", 7), "")].join("\n"), "Visits Report.csv", lawn(), LAWN_ASOF, st.dataset).dataset;
    expect(dueTouches(st, at).held.map((h) => h.why)).toEqual(["No longer needed: they've booked a job since"]);
  });

  it("in a file with nothing marked done, the regular its dates find gets note 1", () => {
    const CSV = [
      VISITS_HEAD,
      ...visitRows(701, "Mike Sanderson", every("2026-04-06", "2026-09-28", 7), ""),
      ...visitRows(702, "Linda Whitfield", every("2026-04-07", "2026-05-12", 7), ""),
    ].join("\n");
    const { dataset: ds } = read(CSV, "Visits Report.csv");
    expect(firstNotes(ds).sent).toEqual([ds.customers.find((c) => c.emails.includes("linda@gmail.com"))!.id]);
  });
});

describe("client lists", () => {
  it("map every 'last' date to the last visit, never to the last name or the created date", () => {
    for (const h of ["Last Visit", "Last Appointment", "Last Booking Date", "Last Cleaning", "Last Service"]) {
      for (const extra of [[], ["Last Name", "Created Date"]]) {
        const t = parseTable(`First Name,${extra.join(",")}${extra.length ? "," : ""}Email,${h}\nLinda,${extra.length ? "Whitfield,03/02/2024," : ""}linda@gmail.com,06/01/2026\n`);
        const f = mapColumns(t, "client").fields;
        expect(t.headers[f.lastJobOn!]).toBe(h);
        expect(f.lastName === undefined ? undefined : t.headers[f.lastName]).toBe(extra.length ? "Last Name" : undefined);
        expect(f.createdOn === undefined ? undefined : t.headers[f.createdOn]).toBe(extra.length ? "Created Date" : undefined);
      }
    }
    expect(detect(parseTable(`Name,Email,Last Appointment\nLinda Whitfield,linda@gmail.com,06/01/2026\n`), "export.csv").kind).toBe("client");
  });

  describe("a cleaning client list with 'Last Cleaning'", () => {
    const people = cleaningClients();
    const cleaning = business({ trade: "cleaning", name: "Sparkle House Cleaning", avgJobValue: undefined });
    const load = (withFrequency: boolean) => {
      const { dataset: ds, detection } = read(cleaningClientList(people, withFrequency), "Clients.csv", cleaning, CLEANING_ASOF);
      expect(detection.kind).toBe("client");
      // "Last Cleaning" is the date the list is about
      expect(detection.warnings.filter((w) => /date/.test(w))).toEqual([]);
      const r = scan(ds);
      const idOf = (email: string) => ds.customers.find((c) => c.emails.includes(email))!.id;
      return { ds, r, idOf };
    };

    it("without a frequency: everyone past 45 days is a past customer to write to, and nobody else is flagged", () => {
      const { ds, r, idOf } = load(false);
      expect(ds.customers).toHaveLength(people.length);
      expect(ds.jobs.every((j) => j.fromList && j.everyDays === undefined)).toBe(true);
      for (const p of people) {
        const opps = oppsFor(r, idOf(p.email));
        if (p.daysAgo >= cleaningThreshold(undefined)) {
          expect(opps.map((o) => [o.type, o.suppressed])).toEqual([["one_and_done", undefined]]);
          expect(opps[0]!.reason).toMatch(/^Your client list has them last here/);
        } else expect(opps).toEqual([]);
      }
      expect(r.primary).toHaveLength(people.filter((p) => p.daysAgo >= 45).length);
    });

    it("with a frequency: regulars past their own threshold are lapsed regulars, one-time clients past 45 days past customers", () => {
      const { ds, r, idOf } = load(true);
      expect(new Set(ds.jobs.map((j) => j.everyDays))).toEqual(new Set([7, 14, 30, undefined]));
      for (const p of people) {
        const opps = oppsFor(r, idOf(p.email));
        if (p.daysAgo < cleaningThreshold(p.frequency)) expect(opps).toEqual([]);
        else expect(opps.map((o) => [o.type, o.suppressed])).toEqual([[p.frequency === "One-time" ? "one_and_done" : "lapsed_regular", undefined]]);
      }
      // a weekly client four weeks out has missed their visits, which the list without a frequency can't tell
      expect(people.filter((p) => p.daysAgo >= 21 && p.daysAgo < 45).map((p) => reachable(r, idOf(p.email), "lapsed_regular").length)).toEqual([1, 1, 1, 1]);
    });
  });

  it("a lawn client list with no frequency counts the season: two months quiet in summer is gone, last fall's date isn't over the winter", () => {
    const listed = (last: ISODate, asOf: ISODate) => {
      const { dataset: ds } = read(`Client name,Email,Last Visit\nMike Sanderson,mike@gmail.com,${last}\n`, "Clients.csv", lawn(), asOf);
      return scan(ds).opportunities.map((o) => [o.type, o.suppressed, o.reason]);
    };
    // past the trade's longest quiet spell in the season (53 days), not the 300 a one-off job waits
    expect(listed(addDays(LAWN_ASOF, -52), LAWN_ASOF)).toEqual([]);
    expect(listed(addDays(LAWN_ASOF, -60), LAWN_ASOF)).toEqual([["one_and_done", undefined, "Your client list has them last here back in June, and nothing since."]]);
    expect(listed("2025-10-28", "2026-01-15")).toEqual([]);
    expect(listed("2025-10-28", "2026-05-01")).toEqual([]);
    expect(listed("2025-10-28", "2026-06-01")).toHaveLength(1);
  });

  it("a lawn list's frequency counts the season too: in January, last fall's weekly regulars aren't gone; four weeks into spring without them, they are", () => {
    for (const trade of ["lawn", "landscape"] as TradeId[]) {
      const CSV = `Client name,Email,Last Visit,Frequency\nMike Sanderson,mike@gmail.com,2025-11-04,Weekly\nLinda Whitfield,linda@gmail.com,2025-10-30,Every other week\n`;
      const { dataset: ds } = read(CSV, "Clients.csv", lawn({ trade }), "2026-01-15");
      expect(ds.jobs.map((j) => j.everyDays)).toEqual([7, 14]);
      expect(scan(ds).opportunities).toEqual([]);
      const june = scan({ ...ds, asOf: "2026-06-01" });
      expect(june.opportunities.map((o) => [o.type, o.suppressed, o.reason])).toEqual([
        ["lapsed_regular", undefined, "On your client list as a regular (about every 7 days). Last visit last November — then nothing."],
        ["lapsed_regular", undefined, "On your client list as a regular (about every 2 weeks). Last visit last October — then nothing."],
      ]);
    }
  });

  it("a lawn list from a shop that stops mowing in early October: its regulars' last visits that week aren't gone over the winter", () => {
    const CSV = `Client name,Email,Last Visit,Frequency\nMike Sanderson,mike@gmail.com,2026-10-06,Weekly\nLinda Whitfield,linda@gmail.com,2026-10-08,Weekly\nTom Alvarez,tom@gmail.com,2026-07-10,Weekly\n`;
    for (const asOf of ["2026-11-02", "2027-01-15"]) {
      const { dataset: ds } = read(CSV, "Clients.csv", lawn(), asOf);
      const tom = ds.customers.find((c) => c.emails.includes("tom@gmail.com"))!.id;
      expect(scan(ds).opportunities.map((o) => [o.customerId, o.type]), asOf).toEqual([[tom, "lapsed_regular"]]);
    }
  });

  it("reads every frequency a list writes, and one it can't read gives no rhythm, never the shortest wait", () => {
    const rows: [string, number][] = [
      ["Quarterly", 50], ["Every 8 weeks", 50], ["Every 2 months", 50], ["Every 6 weeks", 46], ["Every 6 weeks", 90], ["Twice a month", 25], ["Seasonal", 50],
      ["Fortnightly", 3], ["Semi-monthly", 3], ["Every 10 days", 3], ["every other week", 3], ["Every 4 Weeks", 3], ["Yearly", 3], ["Annual", 3], ["Every Week", 3],
    ];
    const CSV = toCSV(["Client name", "Email", "Last Cleaning", "Frequency"], rows.map(([f, days], i) => [`Client ${i}`, `c${i}@yahoo.com`, addDays(CLEANING_ASOF, -days), f]));
    const { dataset: ds } = read(CSV, "Clients.csv", cleaning(), CLEANING_ASOF);
    const of = (i: number) => ds.customers.find((c) => c.emails.includes(`c${i}@yahoo.com`))!.id;
    const gap = (i: number) => ds.jobs.find((j) => j.customerId === of(i))!;
    expect(rows.map((_, i) => gap(i).everyDays)).toEqual([91, 56, 61, 42, 42, 15, undefined, 14, 15, 10, 14, 28, 365, 365, 7]);
    expect(gap(6).recurring).toBe(true);
    const r = scan(ds);
    // not due yet by their own rhythm: every 8 weeks or 2 months is gone at about 15 weeks, every 6 weeks at 88 days
    for (const i of [0, 1, 2, 3]) expect(oppsFor(r, of(i))).toEqual([]);
    expect(reachable(r, of(4), "lapsed_regular")).toHaveLength(1);
    expect(reachable(r, of(5), "lapsed_regular")).toHaveLength(1);
    // "Seasonal" says they come back, not how often: read like a list with no frequency
    expect(oppsFor(r, of(6)).map((o) => [o.type, o.suppressed])).toEqual([["one_and_done", undefined]]);
    // in a trade without a cleaning shop's short clock, an annual or seasonal client two months on isn't gone
    const TREE = toCSV(["Client name", "Email", "Last Service", "Frequency"], [["Mike Sanderson", "mike@gmail.com", ago(60), "Annual"], ["Linda Whitfield", "linda@gmail.com", ago(60), "Seasonal"]]);
    expect(scan(read(TREE, "Clients.csv", business(), ASOF).dataset).opportunities).toEqual([]);
  });
});

describe("one row per recurring job", () => {
  const runFor = (trade: TradeId, endedDaysAgo: number, over: Partial<Parameters<typeof job>[2]> = {}) =>
    dataset({
      business: { trade, avgJobValue: undefined },
      customers: [customer("c1")],
      jobs: [job("j1", "c1", { title: trade === "cleaning" ? "Biweekly cleaning" : "Weekly mowing", recurring: true, status: "archived", scheduledOn: "2024-04-08", completedOn: ago(endedDaysAgo), total: 4200, ...over })],
    });

  it("a recurring job that ended four months ago is a lapsed regular (Jobber's sync shape)", () => {
    const ds = runFor("lawn", 120);
    const o = oneOpp(scan(ds), "c1", "lapsed_regular");
    expect(o.suppressed).toBeUndefined();
    expect(o.anchorDate).toBe(ago(120));
    expect(o.reason).toMatch(/^On a recurring job\. Last visit/);
    // its one row carries the whole run's total: what it's worth a year
    expect(o.value).toBe(round2((4200 * 365) / daysBetween("2024-04-08", ago(120))));
    // still running: nothing to write about
    expect(scan(runFor("lawn", 120, { status: "active", completedOn: undefined })).opportunities).toEqual([]);
  });

  it("with no frequency, a cleaning run is gone after the trade's longest quiet spell (45 days)", () => {
    expect(oppsFor(scan(runFor("cleaning", 40)), "c1")).toEqual([]);
    expect(oneOpp(scan(runFor("cleaning", 50)), "c1", "lapsed_regular").suppressed).toBeUndefined();
  });

  it("reads Jobber's jobs report and its Recurring Jobs report the same way", () => {
    const JOBS = `Job #,Client name,Client email,Title,Job status,Job type,Created date,Start date,Completed date,Total ($)
610,Mike Sanderson,mike@gmail.com,Weekly mowing,Archived,Recurring,03/20/2024,04/08/2024,${addDays(LAWN_ASOF, -120)},4200
611,Linda Whitfield,linda@gmail.com,Weekly mowing,Active,Recurring,03/20/2025,04/07/2025,,2900
`;
    const RECURRING = `Job #,Job title,Client name,Client email,Client phone number,Service street,Billing type,Visits assigned to,Line items,Total ($),Completed visits,Number of invoices,Schedule start date,Schedule end date
610,Weekly mowing,Mike Sanderson,mike@gmail.com,603-224-1100,12 Oak Ln,Per visit,Crew 1,Mow,4200,70,70,04/08/2024,${addDays(LAWN_ASOF, -120)}
611,Weekly mowing,Linda Whitfield,linda@gmail.com,603-224-1101,15 Pine St,Per visit,Crew 1,Mow,2900,50,50,04/07/2025,${addDays(LAWN_ASOF, 80)}
`;
    // an emailed report gets renamed: the Recurring Jobs report is known by its columns too
    for (const [name, csv] of [["Jobs Report.csv", JOBS], ["Recurring Jobs Report.csv", RECURRING], ["export.csv", RECURRING]] as const) {
      const { dataset: ds, detection } = read(csv, name);
      expect(detection.kind).toBe("job");
      expect(ds.jobs.every((j) => j.recurring)).toBe(true);
      const r = scan(ds);
      const who = (email: string) => ds.customers.find((c) => c.emails.includes(email))!.id;
      expect(oneOpp(r, who("mike@gmail.com"), "lapsed_regular").suppressed).toBeUndefined();
      // Linda's job runs past today: on the calendar until its end date, though the Recurring Jobs report has no status
      expect(ds.jobs.find((j) => j.customerId === who("linda@gmail.com"))!.status).toBe(name === "Jobs Report.csv" ? "active" : "unknown");
      expect(oppsFor(r, who("linda@gmail.com"))).toEqual([]);
      // once it's ended, with no export since, it has ended: at the season's close, so she's gone once the next season
      // is four weeks open without her, not over the winter
      if (name !== "Jobs Report.csv") {
        expect(oppsFor(scan({ ...ds, asOf: addDays(LAWN_ASOF, 80 + 60) }), who("linda@gmail.com"))).toEqual([]);
        expect(oneOpp(scan({ ...ds, asOf: "2027-06-01" }), who("linda@gmail.com"), "lapsed_regular").anchorDate).toBe(addDays(LAWN_ASOF, 80));
      }
    }
  });

  it("a recurring job's row followed by a one-off is valued by the run, never by the week between them", () => {
    const JOBS = `Job #,Client name,Client email,Title,Job status,Job type,Created date,Start date,Completed date,Total ($)
610,Mike Sanderson,mike@gmail.com,Weekly mowing,Archived,Recurring,03/20/2024,04/08/2024,11/03/2025,4200
612,Mike Sanderson,mike@gmail.com,Fall cleanup,Archived,One-off,11/01/2025,11/10/2025,11/10/2025,180
`;
    const { dataset: ds } = read(JOBS, "Jobs Report.csv");
    const o = oneOpp(scan(ds), ds.customers[0]!.id, "lapsed_regular");
    expect(o.suppressed).toBeUndefined();
    expect(o.value).toBe(round2((4200 * 365) / daysBetween("2024-04-08", "2025-11-03")));
    expect(o.reason).toBe("On a recurring job. Last visit last November — then nothing.");
    expect(o.evidence).toContain("Recurring job since back in April 2024");
    expect(o.anchorDate).toBe("2025-11-03");
  });
});

describe("a jobs sheet with no status column", () => {
  const ON: ISODate = "2026-10-01";

  it("a job dated after today is booked work: nobody with one coming is written to", () => {
    const TREE = `Job #,Customer,Email,Job,Date,Amount\n801,Mike Sanderson,mike@gmail.com,Oak removal,2024-05-14,2400\n802,Mike Sanderson,mike@gmail.com,Pruning,2026-10-08,600\n`;
    const { dataset: ds } = read(TREE, "Jobs.csv", business(), ON);
    expect(ds.jobs.map((j) => j.status)).toEqual(["unknown", "unknown"]);
    const r = scan(ds);
    expect(r.opportunities.filter((o) => !o.suppressed)).toEqual([]);
    expect(oneOpp(r, ds.customers[0]!.id, "one_and_done").suppressed).toBe("active_work");
    // a scheduled date still to come is a crew on their street that week
    const SCHEDULED = `Job #,Customer,Email,Street,City,Job,Scheduled date,Amount\n803,Mike Sanderson,mike@gmail.com,14 Oak Ln,Concord,Pruning,2026-10-08,600\n`;
    expect(scheduledWork(read(SCHEDULED, "Jobs.csv", business(), ON).dataset).map((w) => [w.date, w.street])).toEqual([["2026-10-08", "oak ln"]]);
    const CLEAN = `Job #,Customer,Email,Service,Date,Amount
811,Linda Whitfield,linda@gmail.com,Deep clean,2025-09-20,320
812,Linda Whitfield,linda@gmail.com,Deep clean,2026-01-15,320
813,Linda Whitfield,linda@gmail.com,Deep clean,2026-04-01,320
814,Linda Whitfield,linda@gmail.com,Deep clean,2026-10-08,320
`;
    const clean = read(CLEAN, "Jobs.csv", cleaning(), ON).dataset;
    const due = scan(clean);
    expect(oneOpp(due, clean.customers[0]!.id, "service_due").suppressed).toBe("active_work");
    expect(due.opportunities.filter((o) => !o.suppressed)).toEqual([]);
  });

  it("with a created date and a plain 'Date', past jobs are done work, never jobs still on the calendar", () => {
    const CSV = `Job #,Customer,Email,Service,Created,Date,Amount
901,Linda Whitfield,linda@gmail.com,Deep clean,2025-03-02,2025-03-10,320
902,Mike Sanderson,mike@gmail.com,Tree removal,2024-04-20,2024-05-14,2400
`;
    const { dataset: ds } = read(CSV, "Jobs.csv", business(), ON);
    expect(ds.jobs.map((j) => [j.createdOn, j.scheduledOn, j.status])).toEqual([["2025-03-02", "2025-03-10", "unknown"], ["2024-04-20", "2024-05-14", "unknown"]]);
    const r = scan(ds);
    for (const c of ds.customers) expect(reachable(r, c.id, "one_and_done").map((o) => o.anchorDate)).toEqual([ds.jobs.find((j) => j.customerId === c.id)!.scheduledOn]);
  });
});

describe("readiness for lawn and cleaning shops", () => {
  const ask = (ds: Dataset) => Object.fromEntries(readiness(ds).gaps.map((g) => [g.id, g]));

  it("asks for visits first, never quotes, and starts from the visits alone", () => {
    for (const trade of ["lawn", "landscape", "cleaning"] as TradeId[]) {
      const none = readiness(dataset({ business: { trade } }));
      expect(none.ready).toBe(false);
      const blocker = none.gaps.find((g) => g.level === "blocker" && g.id === "no_work_records")!;
      expect(blocker.ask).toBe("The visits export (all time).");
      expect(blocker.where).toBe("Jobber: Insights → Reports → Visits → All time → Export.");
    }
    const { dataset: ds } = read(visitsReport(lawnClients(), "newest"), "Visits Report.csv");
    const r = readiness(ds);
    expect(r.ready).toBe(true);
    expect(Object.keys(ask(ds)).sort()).toEqual(["no_clients", "no_invoices"]);
  });

  it("quotes alone can't start a cleaning shop; invoices can, and then the visits are asked for", () => {
    const quotesOnly = dataset({ business: { trade: "cleaning" }, customers: [customer("a")], quotes: [{ id: "q", customerId: "a", title: "Deep clean", lineItems: [], total: 300, status: "awaiting_response", rawStatus: "", sentOn: ago(40), jobIds: [] }] });
    expect(readiness(quotesOnly).ready).toBe(false);
    expect(ask(quotesOnly).no_work_records?.ask).toBe("The visits export (all time).");
    const invoicesOnly = dataset({ business: { trade: "cleaning" }, customers: [customer("a")], invoices: [{ id: "i", customerId: "a", subject: "Biweekly cleaning", total: 160, balance: 0, status: "paid", rawStatus: "Paid", issuedOn: ago(30) }] });
    expect(readiness(invoicesOnly).ready).toBe(true);
    expect(ask(invoicesOnly).no_jobs?.ask).toBe("The visits export (all time).");
    expect(ask(invoicesOnly).no_quotes).toBeUndefined();
  });

  it("a client list alone: a lawn or cleaning shop starts from it, by the season for lawn, and is asked for its visits", () => {
    const lawnList = read(`Client name,Email,Last Visit,Frequency\nMike Sanderson,mike@gmail.com,${addDays(LAWN_ASOF, -60)},Weekly\n`, "Clients.csv").dataset;
    const clean = read(cleaningClientList(cleaningClients(), true), "Clients.csv", cleaning(), CLEANING_ASOF).dataset;
    for (const ds of [lawnList, clean]) {
      const r = readiness(ds);
      expect(r.ready).toBe(true);
      expect(r.have.job).toBe(0);
      expect(ask(ds).no_jobs?.ask).toBe("The visits export (all time).");
      expect(r.headline).not.toBe("Ready to start. We have everything we need.");
    }
    expect(reachable(scan(lawnList), lawnList.customers[0]!.id, "lapsed_regular")).toHaveLength(1);
  });

  it("a tree shop is still asked for its quotes first", () => {
    expect(readiness(dataset()).gaps.find((g) => g.level === "blocker")?.ask).toBe("The quotes export (all time).");
  });
});

describe("a client list sent again", () => {
  const list = (on: string) => `First Name,Last Name,Email,Last Cleaning\nKaren,Brennan,karen@yahoo.com,${on}\n`;

  it("moves each client's last date on, so the month's new drop-offs are found as on a first list", () => {
    // September's list has Karen last cleaned August 25th; October's, September 2nd, 48 days back
    const sept = read(list("08/25/2026"), "Clients.csv", cleaning(), "2026-09-01").dataset;
    const oct = read(list("09/02/2026"), "Clients.csv", cleaning(), "2026-10-20", { ...sept, asOf: "2026-10-20" }).dataset;
    expect(oct.jobs.map((j) => j.completedOn)).toEqual(["2026-09-02"]);
    const alone = read(list("09/02/2026"), "Clients.csv", cleaning(), "2026-10-20").dataset;
    expect(found(oct, scan(oct))).toEqual(found(alone, scan(alone)));
    const o = oneOpp(scan(oct), oct.customers[0]!.id, "one_and_done");
    expect(o.suppressed).toBeUndefined();
    expect(o.reason).toMatch(/^Your client list has them last here/);
    // an older list sent after it never takes the date back
    const back = read(list("08/25/2026"), "Clients.csv", cleaning(), "2026-10-20", oct).dataset;
    expect(back.jobs.map((j) => j.completedOn)).toEqual(["2026-09-02"]);
  });

  it("gives way to a visit on the day it names, and the earlier list's date goes too", () => {
    const sept = read(list("08/25/2026"), "Clients.csv", cleaning(), "2026-09-01").dataset;
    const visits = read(`${VISITS_HEAD}\n77,2026-09-02,Biweekly cleaning,Karen Brennan,karen@yahoo.com,Yes,160.00,Recurring`, "Visits Report.csv", cleaning(), "2026-10-20", { ...sept, asOf: "2026-10-20" }).dataset;
    const oct = read(list("09/02/2026"), "Clients.csv", cleaning(), "2026-10-20", visits).dataset;
    expect(oct.jobs.map((j) => [j.scheduledOn ?? j.completedOn, !!j.visit])).toEqual([["2026-09-02", true]]);
  });
});

describe("a client back on a new job while the old one was never closed", () => {
  // Mike's weekly job #100 was done through May 27th and never closed: its visits kept going by undone. The crew marks
  // Linda's visits each week.
  const mike = (closed: boolean) => visitRows(100, "Mike Sanderson", every("2026-04-08", closed ? "2026-05-27" : "2026-11-04", 7), "2026-05-27");
  const linda = (to: ISODate) => visitRows(300, "Linda Whitfield", every("2026-04-07", "2026-11-03", 7), to, "Weekly mowing", 50);
  const back = (doneTo: ISODate) => visitRows(200, "Mike Sanderson", every("2026-10-07", "2026-11-04", 7), doneTo);
  const idOf = (ds: Dataset, email: string) => ds.customers.find((c) => c.emails.includes(email))!.id;

  it("has a job on the go: the new job's visits are still to come, whatever the old job's calendar shows", () => {
    // October 1st: Mike phoned and is booked weekly from October 7th on a new job, #200
    for (const closed of [false, true]) {
      const { dataset: ds } = read([VISITS_HEAD, ...mike(closed), ...back(""), ...linda("2026-09-29")].join("\n"), "Visits Report.csv", lawn(), "2026-10-01");
      expect(oneOpp(scan(ds), idOf(ds, "mike@gmail.com"), "lapsed_regular").suppressed).toBe("active_work");
    }
  });

  it("a note queued before he was booked again is stopped", () => {
    const { dataset: ds } = read([VISITS_HEAD, ...mike(false), ...linda("2026-09-15")].join("\n"), "Visits Report.csv", lawn(), "2026-09-15");
    const { st, at, sent } = firstNotes(ds);
    expect(sent).toEqual([idOf(ds, "mike@gmail.com")]);
    st.dataset = read([VISITS_HEAD, ...mike(false), ...back(""), ...linda("2026-09-15")].join("\n"), "Visits Report.csv", lawn(), LAWN_ASOF, st.dataset).dataset;
    expect(dueTouches(st, at).held.map((h) => h.why)).toEqual(["No longer needed: they've booked a job since"]);
  });

  it("names a crew for the new job's visits, never for the old job's", () => {
    const CSV = [`${VISITS_HEAD},Service street,Service city`, ...[...mike(false), ...back(""), ...linda("2026-09-29")].map((r) => `${r},14 Oak Ln,Concord`)].join("\n");
    const { dataset: ds } = read(CSV, "Visits Report.csv", lawn(), "2026-10-01");
    const days = scheduledWork(ds).filter((w) => w.customerId === idOf(ds, "mike@gmail.com") && w.date > "2026-10-01").map((w) => w.date);
    expect(days).toEqual(every("2026-10-07", "2026-11-04", 7));
  });

  /** The scan's finds planned and approved, and who gets note 1 the morning the last one is due. */
  function firstNotes(ds: Dataset) {
    const now = `${ds.asOf}T12:00:00Z`;
    const st = emptyState(ds, now);
    find(st, now);
    planBatch(st, now, { startOn: ds.asOf, approve: true });
    const at = st.touches.filter((t) => t.step === 1).map((t) => t.dueAt).sort().at(-1)!;
    st.dataset.asOf = at.slice(0, 10);
    const { due } = dueTouches(st, at);
    return { st, at, sent: due.filter((d) => d.touch.step === 1).map((d) => d.touch.customerId).sort() };
  }
});

describe("the jobs report beside the Visits report", () => {
  const clients = lawnClients();
  const c = clients.find((x) => x.neverClosed)!;
  const num = c.visits.at(-1)!.job;
  const JOBS = (status: string) => `Job #,Client name,Client email,Title,Job status,Job type,Created date,Start date,Completed date,Total ($)\n${num},${c.name},${c.email},Weekly mowing,${status},Recurring,03/20/2026,04/06/2026,,0\n`;

  it("a job the owner never closed is still 'Active' or 'Late' there: its visits say the schedule stopped", () => {
    const visits = read(visitsReport(clients, "newest"), "Visits Report.csv").dataset;
    const id = visits.customers.find((x) => x.emails.includes(c.email))!.id;
    expect(oneOpp(scan(visits), id, "lapsed_regular").suppressed).toBeUndefined();
    for (const status of ["Active", "Late"]) {
      const ds = read(JOBS(status), "Jobs Report.csv", lawn(), LAWN_ASOF, visits).dataset;
      expect(ds.jobs.find((j) => !j.visit)!.status).toBe(status.toLowerCase());
      const o = oneOpp(scan(ds), id, "lapsed_regular");
      expect(o.suppressed).toBeUndefined();
      expect(o.anchorDate).toBe("2026-06-12");
      // and nothing holds the note it gets: no job on the go
      const now = `${LAWN_ASOF}T12:00:00Z`;
      const st = emptyState(ds, now);
      find(st, now);
      // planned for the fall window: a lawn shop's past customers never hear from it in August
      planBatch(st, now, { startOn: "2026-09-01", approve: true });
      const at = st.touches.filter((t) => t.customerId === id && t.step === 1)[0]!.dueAt;
      st.dataset.asOf = at.slice(0, 10);
      expect(dueTouches(st, at).due.some((d) => d.touch.customerId === id)).toBe(true);
    }
    // the same in a Visits report that ends today: the visits that went by undone say so without one still to come
    const today = read(visitsReport(clients.map((x) => ({ ...x, visits: x.visits.filter((v) => v.date <= LAWN_ASOF) })), "newest"), "Visits Report.csv").dataset;
    const ds = read(JOBS("Active"), "Jobs Report.csv", lawn(), LAWN_ASOF, today).dataset;
    expect(oneOpp(scan(ds), id, "lapsed_regular").suppressed).toBeUndefined();
  });
});

describe("a quote tracker with a booking date", () => {
  const TRACKER = `Customer,Email,Phone,Address,Job,Estimate Amount,Estimate Date,Booking Date,Status
Mike Sanderson,mike@gmail.com,603-224-1100,12 Oak Ln,Cedar privacy fence,7850,${ago(40)},,Sent
Linda Whitfield,linda@gmail.com,603-224-1101,15 Pine St,Vinyl fence,5200,${ago(50)},${ago(20)},Booked
Tom Alvarez,tom@gmail.com,603-224-1102,18 Maple Ave,Chain link,4100,${ago(35)},,Pending
Karen Brennan,karen@gmail.com,603-224-1103,21 Birch Rd,Picket fence,2600,${ago(45)},,Waiting on HOA
Steve Coutu,steve@gmail.com,603-224-1104,24 Elm St,Split rail,3900,${ago(60)},${ago(30)},Booked
`;

  it("is quotes, never visits: every open quote is still there to follow up", () => {
    for (const name of ["Fence tracker - Sheet1.csv", "export.csv"]) {
      for (const csv of [TRACKER, TRACKER.replace("Booking Date", "Booking #")]) {
        expect(detect(parseTable(csv), name).kind).toBe("quote");
        const { dataset: ds } = read(csv, name, business({ trade: "fence" }), ASOF);
        expect(ds.quotes).toHaveLength(5);
        expect(ds.jobs).toEqual([]);
      }
    }
    const { dataset: ds } = read(TRACKER, "export.csv", business({ trade: "fence" }), ASOF);
    expect(scan(ds).opportunities.filter((o) => o.type === "unanswered_quote").map((o) => o.value).sort((a, b) => b - a)).toEqual([7850, 4100, 2600]);
  });
});

describe("a recurring job's row with no end date and no status", () => {
  it("is a job still running, never one job done the day it started", () => {
    const SHEET = `Job #,Customer,Email,Service,Job Type,Start Date,End Date,Price\n611,Linda Whitfield,linda@gmail.com,Weekly mowing,Recurring,2025-04-07,,45\n`;
    const RECURRING = `Job #,Job title,Client name,Client email,Billing type,Total ($),Completed visits,Schedule start date,Schedule end date\n611,Biweekly cleaning,Linda Whitfield,linda@gmail.com,Per visit,2900,50,04/07/2025,\n`;
    for (const [csv, name, b] of [[SHEET, "Jobs.csv", lawn()], [RECURRING, "Recurring Jobs Report.csv", lawn()], [RECURRING, "Recurring Jobs Report.csv", cleaning()]] as const) {
      const { dataset: ds, detection } = read(csv, name, b, LAWN_ASOF);
      expect(detection.kind).toBe("job");
      expect(ds.jobs.map((j) => [j.recurring, j.status])).toEqual([[true, "active"]]);
      expect(scan(ds).opportunities.filter((o) => !o.suppressed)).toEqual([]);
    }
  });
});

describe("a Visits report exported without the 'Job type' column", () => {
  const HEAD = "Job #,Date,Visit title,Client name,Client email,Visit completed,One-off job ($),Visit based ($)";
  const oneOff = (job: number, name: string, title: string, dates: ISODate[], share: number) =>
    dates.map((d) => `${job},${d},${title},${name},${name.split(" ")[0]!.toLowerCase()}@gmail.com,Yes,${share.toFixed(2)},`);

  it("still reads a one-off job's visits as one job: a patio over four days is no weekly regular", () => {
    const cases: [BusinessProfile, ISODate, string[], string[]][] = [
      [lawn({ trade: "landscape" }), LAWN_ASOF, oneOff(2001, "Mike Sanderson", "Paver patio", every("2026-04-06", "2026-04-09", 1), 2000), ["missed_upsell"]],
      [lawn({ trade: "landscape" }), LAWN_ASOF, oneOff(2002, "Linda Whitfield", "Retaining wall", every("2026-04-13", "2026-04-15", 1), 1500), ["missed_upsell"]],
      [cleaning(), CLEANING_ASOF, oneOff(2003, "Karen Brennan", "Move-in deep clean", every("2026-03-10", "2026-03-12", 1), 210), []],
    ];
    for (const [b, asOf, rows, types] of cases) {
      const { dataset: ds } = read([HEAD, ...rows].join("\n"), "Visits Report.csv", b, asOf);
      expect(ds.jobs.every((j) => j.recurring === false)).toBe(true);
      expect(scan(ds).opportunities.map((o) => o.type)).toEqual(types);
      // the same as with the column
      const { dataset: typed } = read([`${HEAD},Job type`, ...rows.map((r) => `${r},One-off`)].join("\n"), "Visits Report.csv", b, asOf);
      expect(found(ds, scan(ds))).toEqual(found(typed, scan(typed)));
    }
    // a visit billed per visit is still a visit of a routine
    const { dataset: ds } = read(`${HEAD}\n301,2026-07-07,Weekly mowing,Mike Sanderson,mike@gmail.com,Yes,0.00,45.00`, "Visits Report.csv");
    expect(ds.jobs[0]!.recurring).toBeUndefined();
  });
});

describe("a visit the export says went by undone", () => {
  const HEAD = "Booking ID,Customer Name,Email,Service,Frequency,Booking Date,Price,Status";
  const row = (id: number, name: string, on: ISODate, status: string, title = "Biweekly cleaning", freq = "Every other week") =>
    `${id},${name},${name.split(" ")[0]!.toLowerCase()}@gmail.com,${title},${freq},${on},160.00,${status}`;

  it("is never work done: skipped, no-show, missed, lockout, postponed, incomplete", () => {
    // Karen was cleaned every other week through July 7th; the recurring booking stayed, and every one since was skipped
    const karen = every("2026-03-03", "2026-11-17", 14).map((d, i) => row(5000 + i, "Karen Brennan", d, d <= "2026-07-07" ? "Completed" : d <= "2026-10-01" ? "Skipped" : "Upcoming"));
    const { dataset: ds } = read([HEAD, ...karen].join("\n"), "Bookings.csv", cleaning(), "2026-10-01");
    const o = oneOpp(scan(ds), ds.customers[0]!.id, "lapsed_regular");
    expect(o.suppressed).toBeUndefined();
    expect(o.anchorDate).toBe("2026-07-07");
    // each of these on a visit gone by is no visit done, and none of them reads as completed; a status nobody can read
    // is no proof either: like a visit not marked done, it was missed once the shop has marked past it
    const words = ["Skipped", "Skip", "No Show", "No-show", "Lockout", "Locked out", "Missed", "Postponed", "Incomplete", "Not Completed", "Pending", "Unassigned"];
    const name = (i: number) => `Client${String.fromCharCode(65 + i)} Test`;
    const CSV = [HEAD, ...words.map((w, i) => row(6000 + i, name(i), "2026-09-15", w)), ...words.map((_, i) => row(6100 + i, name(i), "2026-09-22", "Completed"))].join("\n");
    const { dataset: each } = read(CSV, "Bookings.csv", cleaning(), "2026-10-01");
    const book = visitBook(each);
    const said = each.jobs.filter((j) => j.scheduledOn === "2026-09-15");
    expect(said.map((j) => [j.rawStatus, j.status, book.worked(j)])).toEqual(words.map((w) => [w, "scheduled", false]));
    expect(said.map((j) => !!j.undone)).toEqual(words.map((w) => !["Pending", "Unassigned"].includes(w)));
    // with nothing marked past them, only the export's own word says the visit didn't happen
    const { dataset: alone } = read([HEAD, ...words.map((w, i) => row(6000 + i, name(i), "2026-09-15", w))].join("\n"), "Bookings.csv", cleaning(), "2026-10-01");
    expect(alone.jobs.filter(visitBook(alone).worked).map((j) => j.rawStatus)).toEqual(["Pending", "Unassigned"]);
    // and a booking skipped after a note is no comeback
    const id = ds.customers[0]!.id;
    expect(attribute(ds, [{ customerId: id, firstTouchOn: "2026-07-20", lastTouchOn: "2026-07-20" }], { replied: new Set([id]) })).toEqual([]);
  });
});
