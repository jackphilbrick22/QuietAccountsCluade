import { describe, expect, it } from "vitest";
import { emptyDataset, ingestFile } from "../src/ingest/index.ts";
import { attribute, counted, COUNTING_RULES, lift, ownerReported, type OutreachRecord } from "../src/ledger/attribution.ts";
import type { Dataset, ISODate, Recovery, Reply } from "../src/model.ts";
import { ledgerRows } from "../src/reports/ledger.ts";
import { totals, weeklyReport, weekNumbers } from "../src/reports/owner.ts";
import { disputeRecovery, ledgerPass, markContacted, reconcile } from "../src/runtime/agents.ts";
import { emptyState } from "../src/runtime/state.ts";
import { addDays } from "../src/util.ts";
import { business, customer, dataset, invoice, job, quote } from "./fixtures.ts";
import { LAWN_ASOF, lawnClients, visitsReport, type LawnClient } from "./lawn-fixtures.ts";

const FIRST = "2026-10-06";
const LAST = "2026-10-15";
const worked = (over: Partial<OutreachRecord> = {}): OutreachRecord => ({ customerId: "c1", opportunityId: "op1", sourceId: "q1", firstTouchOn: FIRST, lastTouchOn: LAST, ...over });
/** c1 answered one of our notes. */
const REPLIED = { replied: new Set(["c1"]) };

describe("attribute", () => {
  describe("what came back", () => {
    it("the very quote we chased got approved: a same-record match", () => {
      const ds = dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "converted", sentOn: "2026-03-01", approvedOn: "2026-10-20", convertedOn: "2026-10-21", total: 2400 })] });
      const [rec, ...rest] = attribute(ds, [worked()]);
      expect(rest).toEqual([]);
      expect(rec).toMatchObject({ customerId: "c1", opportunityId: "op1", record: { kind: "quote", id: "q1" }, value: 2400, cameBackOn: "2026-10-21", match: "same_record", confidence: 1, lagDays: 6 });
    });
    it("a new job for the customer after the first note", () => {
      const ds = dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { sentOn: "2026-03-01" })], jobs: [job("j1", "c1", { title: "Stump grinding", createdOn: "2026-11-02", completedOn: "2026-11-10", total: 650 })] });
      const [rec] = attribute(ds, [worked()]);
      expect(rec).toMatchObject({ record: { kind: "job", id: "j1" }, value: 650, cameBackOn: "2026-11-02", match: "customer_id", confidence: 0.9 });
    });
    it("picks the earliest new job when there are several", () => {
      const ds = dataset({ customers: [customer("c1")], jobs: [job("late", "c1", { createdOn: "2026-12-01" }), job("early", "c1", { createdOn: "2026-10-25" })] });
      expect(attribute(ds, [worked()])[0]!.record.id).toBe("early");
    });
    it("a newly approved quote, not yet a job in the export", () => {
      const ds = dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { sentOn: "2026-03-01" }), quote("q2", "c1", { title: "Hedge trimming", status: "approved", sentOn: "2026-10-18", approvedOn: "2026-10-22", total: 500 })] });
      const [rec] = attribute(ds, [worked()]);
      expect(rec).toMatchObject({ record: { kind: "quote", id: "q2" }, value: 500, match: "customer_id", confidence: 0.85 });
    });
    it("a paid invoice when there's no jobs file", () => {
      const ds = dataset({ customers: [customer("c1")], invoices: [invoice("i1", "c1", { status: "paid", issuedOn: "2026-11-05", paidOn: "2026-11-20", total: 900, balance: 0 })] });
      const [rec] = attribute(ds, [worked()]);
      expect(rec).toMatchObject({ record: { kind: "invoice", id: "i1" }, value: 900, cameBackOn: "2026-11-05", match: "customer_id", confidence: 0.8 });
    });
    it("prefers the chased quote over a job, and a job over a later approval or invoice", () => {
      const ds = dataset({
        customers: [customer("c1"), customer("c2")],
        quotes: [
          quote("q1", "c1", { status: "converted", sentOn: "2026-03-01", convertedOn: "2026-10-21", jobIds: ["j1"] }),
          quote("q2", "c2", { status: "approved", sentOn: "2026-10-18", approvedOn: "2026-10-19" }),
        ],
        jobs: [job("j1", "c1", { createdOn: "2026-10-21", quoteId: "q1" }), job("j2", "c2", { createdOn: "2026-11-01" })],
        invoices: [invoice("i2", "c2", { status: "paid", issuedOn: "2026-10-20", balance: 0 })],
      });
      const recs = attribute(ds, [worked(), worked({ customerId: "c2", sourceId: "qX" })]);
      expect(recs.map((r) => [r.customerId, r.record.kind, r.match])).toEqual([
        ["c1", "quote", "same_record"],
        ["c2", "job", "customer_id"],
      ]);
    });
  });

  describe("traced vs came back after our note", () => {
    const withJob = dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { sentOn: "2026-03-01" })], jobs: [job("j1", "c1", { createdOn: "2026-11-02" })] });
    it("new work from someone who wrote back is traced", () => {
      expect(attribute(withJob, [worked()], REPLIED)[0]!.tier).toBe("traced");
    });
    it("new work from someone who never wrote back is only 'after our note'", () => {
      expect(attribute(withJob, [worked()])[0]!.tier).toBe("after_note");
      expect(attribute(withJob, [worked()], { replied: new Set(["someone-else"]) })[0]!.tier).toBe("after_note");
    });
    it("the chased quote converting is traced even without a reply", () => {
      const ds = dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "converted", sentOn: "2026-03-01", convertedOn: "2026-10-21" })] });
      expect(attribute(ds, [worked()])[0]).toMatchObject({ match: "same_record", tier: "traced" });
    });
    it("approvals and paid invoices follow the same rule", () => {
      const approval = dataset({ customers: [customer("c1")], quotes: [quote("q2", "c1", { status: "approved", sentOn: "2026-10-18", approvedOn: "2026-10-22" })] });
      expect(attribute(approval, [worked()])[0]!.tier).toBe("after_note");
      expect(attribute(approval, [worked()], REPLIED)[0]!.tier).toBe("traced");
      const paid = dataset({ customers: [customer("c1")], invoices: [invoice("i1", "c1", { status: "paid", issuedOn: "2026-11-05", balance: 0 })] });
      expect(attribute(paid, [worked()])[0]!.tier).toBe("after_note");
      expect(attribute(paid, [worked()], REPLIED)[0]!.tier).toBe("traced");
    });
  });

  describe("windows", () => {
    const jobOn = (createdOn: string) => dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { createdOn, completedOn: undefined, status: "scheduled" })] });
    const convertsOn = (convertedOn: string) => dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "converted", sentOn: "2026-03-01", convertedOn })] });

    it("someone who wrote back: up to 180 days after the last note", () => {
      const [rec] = attribute(jobOn(addDays(LAST, 180)), [worked()], REPLIED);
      expect(rec).toMatchObject({ tier: "traced", lagDays: 180 });
      expect(attribute(jobOn(addDays(LAST, 181)), [worked()], REPLIED)).toEqual([]);
    });
    it("someone who never wrote back: up to 90 days", () => {
      expect(attribute(jobOn(addDays(LAST, 90)), [worked()])[0]).toMatchObject({ tier: "after_note", lagDays: 90 });
      expect(attribute(jobOn(addDays(LAST, 91)), [worked()])).toEqual([]);
    });
    it("the chased quote gets the 180-day window even without a reply", () => {
      expect(attribute(convertsOn(addDays(LAST, 150)), [worked()])[0]).toMatchObject({ match: "same_record", tier: "traced" });
      expect(attribute(convertsOn(addDays(LAST, 180)), [worked()])).toHaveLength(1);
      expect(attribute(convertsOn(addDays(LAST, 181)), [worked()])).toEqual([]);
    });
    it("nothing that started before the first note", () => {
      expect(attribute(jobOn(addDays(FIRST, -1)), [worked()], REPLIED)).toEqual([]);
      expect(attribute(convertsOn(addDays(FIRST, -1)), [worked()])).toEqual([]);
    });
    it("each window can be set on its own", () => {
      expect(attribute(jobOn(addDays(LAST, 60)), [worked()], { silentWindowDays: 30 })).toEqual([]);
      expect(attribute(jobOn(addDays(LAST, 120)), [worked()], { silentWindowDays: 150 })).toHaveLength(1);
      expect(attribute(jobOn(addDays(LAST, 60)), [worked()], { ...REPLIED, tracedWindowDays: 30 })).toEqual([]);
      // the traced window doesn't stretch the silent one
      expect(attribute(jobOn(addDays(LAST, 120)), [worked()], { tracedWindowDays: 365 })).toEqual([]);
    });
    it("windowDays sets both at once", () => {
      for (const opts of [{ windowDays: 30 }, { windowDays: 30, ...REPLIED }]) expect(attribute(jobOn(addDays(LAST, 60)), [worked()], opts)).toEqual([]);
      for (const opts of [{ windowDays: 120 }, { windowDays: 120, ...REPLIED }]) expect(attribute(jobOn(addDays(LAST, 100)), [worked()], opts)).toHaveLength(1);
      expect(attribute(convertsOn(addDays(LAST, 100)), [worked()], { windowDays: 90 })).toEqual([]);
    });
  });

  it("ignores cancelled jobs, unpaid invoices and quotes still waiting", () => {
    const ds = dataset({
      customers: [customer("c1")],
      quotes: [quote("q1", "c1", { sentOn: "2026-10-20" })],
      jobs: [job("j1", "c1", { status: "cancelled", createdOn: "2026-10-20" })],
      invoices: [invoice("i1", "c1", { issuedOn: "2026-10-20" })],
    });
    expect(attribute(ds, [worked()], REPLIED)).toEqual([]);
  });
  it("finds comebacks for holdout people too (that's what the comparison needs)", () => {
    const ds = dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { createdOn: "2026-10-30" })] });
    expect(attribute(ds, [worked({ holdout: true })])).toHaveLength(1);
  });
  it("never uses one record twice", () => {
    const ds = dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { createdOn: "2026-10-30" })] });
    const recs = attribute(ds, [worked(), worked({ opportunityId: "op2", sourceId: "q2" })], REPLIED);
    expect(recs).toHaveLength(1);
  });

  describe("on a Visits report", () => {
    const clients = lawnClients();
    const report = (cs: LawnClient[], asOf: ISODate) =>
      ingestFile(emptyDataset(business({ trade: "lawn", name: "Greenline Lawn Care", avgJobValue: undefined }), asOf), visitsReport(cs, "newest"), "Visits Report.csv", `${asOf}T12:00:00Z`).dataset;
    const idOf = (ds: Dataset, c: LawnClient) => ds.customers.find((x) => x.emails.includes(c.email))!.id;
    /** We wrote to them the day of the fixture, and they wrote back. */
    const noted = (ds: Dataset, c: LawnClient) => attribute(ds, [worked({ customerId: idOf(ds, c), sourceId: undefined, firstTouchOn: LAWN_ASOF, lastTouchOn: LAWN_ASOF })], { replied: new Set([idOf(ds, c)]) });

    it("the calendar of a job the owner never closed is no comeback, as its visits go by undone", () => {
      const c = clients.find((x) => x.neverClosed)!;
      expect(c.visits.filter((v) => v.date > LAWN_ASOF).length).toBeGreaterThan(10);
      // the end of the season, every one of them gone by
      const ds = { ...report(clients, LAWN_ASOF), asOf: "2026-11-30" };
      expect(noted(ds, c)).toEqual([]);
    });

    it("a weekly regular back on the schedule is one job that came back, worth the visits done so far", () => {
      const c = clients.find((x) => x.lapsed && !x.neverClosed)!;
      // the owner's next report: a new mowing job for them, done each week from August 24th and booked on to November
      const back = clients.map((x) =>
        x !== c ? x : { ...x, visits: [...x.visits, ...[0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70].map((n) => ({ job: 9001, date: addDays("2026-08-24", n), title: "Weekly mowing", done: n <= 35, recurring: true, amount: 45 }))] },
      );
      const ds = report(back, "2026-10-01");
      const recs = noted(ds, c);
      expect(recs).toHaveLength(1);
      expect(recs[0]).toMatchObject({ record: { kind: "job" }, value: 6 * 45, cameBackOn: "2026-08-24", tier: "traced" });
      // the owner's texts count it once: one job came back that week, one booked since we started
      const state = emptyState(ds, "2026-10-01T12:00:00Z");
      state.recoveries = recs;
      expect(totals(state)).toMatchObject({ booked: 1, bookedValue: 270 });
      expect(weekNumbers(state, "2026-08-24")).toMatchObject({ booked: 1, bookedValue: 270 });
      expect(weeklyReport(state, "2026-08-24")).toContain("1 job came back this week — $270.");
    });

    /** The lapsed regular we wrote to, and the owner's next Visits report: their new mowing job, #9001, on these days. */
    const mike = clients.find((x) => x.lapsed && !x.neverClosed)!;
    const withJob = (visits: [ISODate, boolean, number?][], shopMarkedTo = LAWN_ASOF) =>
      clients.map((x) => ({
        ...x,
        visits: [
          // the shop's other visits since, marked done as it went (a schedule nobody closed stays undone)
          ...x.visits.map((v) => (v.date > LAWN_ASOF && v.date <= shopMarkedTo && !x.neverClosed ? { ...v, done: true } : v)),
          ...(x === mike ? visits.map(([date, done, job = 9001]) => ({ job, date, title: "Weekly mowing", done, recurring: true, amount: 45 })) : []),
        ],
      }));
    const JOBS = `Job #,Client name,Client email,Title,Job status,Job type,Created date,Start date,Completed date,Total ($)\n9001,${mike.name},${mike.email},Weekly mowing,Active,Recurring,08/20/2026,08/24/2026,,135\n`;
    const visitsFile = (visits: [ISODate, boolean, number?][], shopMarkedTo?: ISODate) => ({ name: "Visits Report.csv", text: visitsReport(withJob(visits, shopMarkedTo), "newest") });
    /** An account that wrote to Mike the day of the fixture, and he wrote back. */
    const account = (ds: Dataset) => {
      const s = emptyState(ds, `${LAWN_ASOF}T12:00:00Z`);
      const id = idOf(ds, mike);
      s.outreach = [{ customerId: id, firstTouchOn: LAWN_ASOF, lastTouchOn: LAWN_ASOF }];
      s.replies = [{ id: "r1", customerId: id, channel: "email", receivedAt: `${LAWN_ASOF}T15:00:00`, from: mike.email, text: "Yes, put me back on", intent: "wants_it", confidence: 0.9, extracted: {}, status: "done" }];
      return { s, mine: () => s.recoveries.filter((r) => r.customerId === id).map((r) => [r.value, r.cameBackOn]) };
    };

    it("a job seen through its visits stays one booking from one report to the next, worth the visits that were done", () => {
      const { s, mine } = account(report(clients, LAWN_ASOF));
      // August 26th: the new job's first visit went by on the 24th, not marked yet, and the next is on the 31st
      expect(reconcile(s, [visitsFile([["2026-08-24", false], ["2026-08-31", false]])], "2026-08-26T12:00:00Z").newRecoveries).toBe(1);
      expect(mine()).toEqual([[45, "2026-08-24"]]);
      // September 8th: the 24th was rained out, and the 31st and the 7th were done
      expect(reconcile(s, [visitsFile([["2026-08-24", false], ["2026-08-31", true], ["2026-09-07", true]], "2026-09-07")], "2026-09-08T12:00:00Z").newRecoveries).toBe(0);
      expect(mine()).toEqual([[90, "2026-08-31"]]);
      expect(totals(s)).toMatchObject({ booked: 1, bookedValue: 90 });
      expect(ledgerRows(s).map((r) => r.record)).toEqual(["Job #9001"]);
    });

    it("a job whose visits all went by undone after all is taken off the ledger", () => {
      const { s, mine } = account(report(clients, LAWN_ASOF));
      reconcile(s, [visitsFile([["2026-08-24", false], ["2026-08-31", false]])], "2026-08-26T12:00:00Z");
      expect(mine()).toEqual([[45, "2026-08-24"]]);
      const disputed = structuredClone(s);
      // the shop has marked its visits through September 7th, and none of Mike's
      const undone = visitsFile([["2026-08-24", false], ["2026-08-31", false], ["2026-09-07", false]], "2026-09-07");
      reconcile(s, [undone], "2026-09-08T12:00:00Z");
      expect(mine()).toEqual([]);
      expect(totals(s)).toMatchObject({ booked: 0, bookedValue: 0 });
      expect(s.events.some((e) => e.title === `Taken off the ledger: ${mike.name} — $45`)).toBe(true);
      // one the owner marked not ours stays on, still out, so it can't come back as a win if its visits are marked later
      expect(disputeRecovery(disputed, disputed.recoveries[0]!.id, "Booked by phone", "owner", "2026-08-27T09:00:00")).toBe(true);
      reconcile(disputed, [undone], "2026-09-08T12:00:00Z");
      expect(disputed.recoveries.map((r) => [r.value, !!r.disputed])).toEqual([[45, true]]);
    });

    it("a job in the jobs report and its own visits are one booking, dated when the job was made, in either order", () => {
      const done: [ISODate, boolean][] = [["2026-08-24", true], ["2026-08-31", true], ["2026-09-07", true]];
      const read = (ds: Dataset, f: { name: string; text: string }) => ingestFile(ds, f.text, f.name, "2026-09-08T12:00:00Z").dataset;
      const fresh = () => emptyDataset(business({ trade: "lawn", name: "Greenline Lawn Care", avgJobValue: undefined }), "2026-09-08");
      const jobs = { name: "Jobs Report.csv", text: JOBS };
      for (const ds of [read(read(fresh(), visitsFile(done, "2026-09-07")), jobs), read(read(fresh(), jobs), visitsFile(done, "2026-09-07"))]) {
        expect(noted(ds, mike).map((r) => [r.value, r.cameBackOn])).toEqual([[135, "2026-08-20"]]);
      }
      // on the ledger: the job from the jobs report first, its visits in the next report, and still one job
      const { s, mine } = account(read(fresh(), jobs));
      ledgerPass(s, "2026-08-26T12:00:00Z");
      expect(mine()).toEqual([[135, "2026-08-20"]]);
      expect(reconcile(s, [visitsFile(done, "2026-09-07")], "2026-09-08T12:00:00Z").newRecoveries).toBe(0);
      expect(mine()).toEqual([[135, "2026-08-20"]]);
      expect(totals(s)).toMatchObject({ booked: 1, bookedValue: 135 });
    });

    it("a job made before the first note is no comeback once its visits are in, whichever file came first", () => {
      // #9001 was made on August 10th, before we wrote on the 14th; its visits from the 24th were all done
      const done: [ISODate, boolean][] = [["2026-08-24", true], ["2026-08-31", true], ["2026-09-07", true]];
      const read = (ds: Dataset, f: { name: string; text: string }) => ingestFile(ds, f.text, f.name, "2026-09-08T12:00:00Z").dataset;
      const fresh = () => emptyDataset(business({ trade: "lawn", name: "Greenline Lawn Care", avgJobValue: undefined }), "2026-09-08");
      const jobs = { name: "Jobs Report.csv", text: JOBS.replace("08/20/2026", "08/10/2026") };
      expect(noted(read(fresh(), jobs), mike)).toEqual([]);
      for (const ds of [read(read(fresh(), visitsFile(done, "2026-09-07")), jobs), read(read(fresh(), jobs), visitsFile(done, "2026-09-07"))]) expect(noted(ds, mike)).toEqual([]);
    });

    it("a job already going before our note is no comeback, though only its visits show when it started", () => {
      // Mike phoned the shop himself: his new job #9001 had its first mow on September 7th, the day before our note
      const read = (ds: Dataset, f: { name: string; text: string }) => ingestFile(ds, f.text, f.name, "2026-10-01T12:00:00Z").dataset;
      const fresh = () => emptyDataset(business({ trade: "lawn", name: "Greenline Lawn Care", avgJobValue: undefined }), "2026-10-01");
      const from = (first: ISODate) => visitsFile([0, 7, 14, 21].map((n): [ISODate, boolean] => [addDays(first, n), true]), "2026-09-29");
      const wrote = (ds: Dataset) => attribute(ds, [worked({ customerId: idOf(ds, mike), sourceId: undefined, firstTouchOn: "2026-09-08", lastTouchOn: "2026-09-08" })], { replied: new Set([idOf(ds, mike)]) });
      expect(wrote(read(fresh(), from("2026-09-07")))).toEqual([]);
      // the same as with the job's own record, made on the 3rd
      const jobs = { name: "Jobs Report.csv", text: JOBS.replace("08/20/2026", "09/03/2026").replace("08/24/2026", "09/07/2026") };
      expect(wrote(read(read(fresh(), from("2026-09-07")), jobs))).toEqual([]);
      // one whose first mow came after the note is
      expect(wrote(read(fresh(), from("2026-09-14"))).map((r) => [r.value, r.cameBackOn])).toEqual([[3 * 45, "2026-09-14"]]);
    }, 60_000);

    it("a client back on the job the owner never closed is a comeback, whichever report came first", () => {
      // Ray stopped after June 12th, but his job was never closed. We wrote on September 2nd and he wrote back on the
      // 3rd; the owner just started marking the visits already on that job done again, from the 11th.
      const ray = clients.find((x) => x.neverClosed)!;
      const num = ray.visits.at(-1)!.job;
      const back = clients.map((x) => ({ ...x, visits: x.visits.map((v) => (v.date > LAWN_ASOF && v.date <= "2026-09-29" && (x !== ray || v.date >= "2026-09-08") ? { ...v, done: true } : v)) }));
      const visits = { name: "Visits Report.csv", text: visitsReport(back, "newest") };
      const jobs = { name: "Jobs Report.csv", text: `Job #,Client name,Client email,Title,Job status,Job type,Created date,Start date,Completed date,Total ($)\n${num},${ray.name},${ray.email},Weekly mowing,Active,Recurring,03/28/2026,04/10/2026,,0\n` };
      const worth = 3 * ray.visits.find((v) => v.date === "2026-09-11")!.amount;
      const read = (ds: Dataset, f: { name: string; text: string }) => ingestFile(ds, f.text, f.name, "2026-09-30T12:00:00Z").dataset;
      const fresh = () => emptyDataset(business({ trade: "lawn", name: "Greenline Lawn Care", avgJobValue: undefined }), "2026-09-30");
      const wrote = (ds: Dataset) => {
        const id = ds.customers.find((c) => c.emails.includes(ray.email))!.id;
        return attribute(ds, [worked({ customerId: id, sourceId: undefined, firstTouchOn: "2026-09-02", lastTouchOn: "2026-09-02" })], { replied: new Set([id]) }).map((r) => [r.value, r.cameBackOn]);
      };
      for (const ds of [read(fresh(), visits), read(read(fresh(), visits), jobs), read(read(fresh(), jobs), visits)]) expect(wrote(ds)).toEqual([[worth, "2026-09-11"]]);
      // on the ledger: the Visits report on September 30th and the jobs report the next day, or both at once
      const wroteBack = (ds: Dataset) => {
        const s = emptyState(ds, "2026-09-30T12:00:00Z");
        const id = s.dataset.customers.find((c) => c.emails.includes(ray.email))!.id;
        s.outreach = [{ customerId: id, firstTouchOn: "2026-09-02", lastTouchOn: "2026-09-02" }];
        s.replies = [{ id: "r1", customerId: id, channel: "email", receivedAt: "2026-09-03T15:00:00", from: ray.email, text: "Yes, put me back on", intent: "wants_it", confidence: 0.9, extracted: {}, status: "done" }];
        return s;
      };
      const s = wroteBack(read(fresh(), visits));
      ledgerPass(s, "2026-09-30T12:00:00Z");
      expect(totals(s)).toMatchObject({ booked: 1, bookedValue: worth });
      reconcile(s, [jobs], "2026-10-01T12:00:00Z");
      expect(totals(s)).toMatchObject({ booked: 1, bookedValue: worth });
      expect(s.events.some((e) => e.title.startsWith("Taken off the ledger"))).toBe(false);
      const together = wroteBack(read(read(fresh(), jobs), visits));
      ledgerPass(together, "2026-09-30T12:00:00Z");
      expect(ledgerRows(together).filter((r) => r.counts).map((r) => [r.record, r.value, r.cameBackOn])).toEqual([[`Job #${num}`, worth, "2026-09-11"]]);
    }, 60_000);

    it("a booking the owner texted keeps its day, and goes back to his figure while none of its visits count", () => {
      const { s, mine } = account(report(clients, LAWN_ASOF));
      // August 16th: the owner texts BOOKED 540
      markContacted(s, "r1", "2026-08-16T10:00:00", "booked", 540);
      expect(mine()).toEqual([[540, "2026-08-16"]]);
      // August 26th: the new job's first visit went by on the 24th, not marked yet
      const visits = (marked: [boolean, boolean, boolean], shopMarkedTo?: ISODate) =>
        visitsFile([["2026-08-24", marked[0]], ["2026-08-31", marked[1]], ["2026-09-07", marked[2]]], shopMarkedTo);
      reconcile(s, [visits([false, false, false])], "2026-08-26T12:00:00Z");
      expect(mine()).toEqual([[45, "2026-08-16"]]);
      // September 2nd: the shop has marked through the 1st, the 24th and the 31st were rained out, the 7th is to come
      reconcile(s, [visits([false, false, false], "2026-09-01")], "2026-09-02T12:00:00Z");
      expect(mine()).toEqual([[540, "2026-08-16"]]);
      expect(s.recoveries.find((r) => r.customerId === idOf(s.dataset, mike))!.match).toBe("owner_reported");
      expect(s.events.some((e) => e.title.startsWith("Taken off the ledger"))).toBe(false);
      // September 9th: the 7th was done, and later the 31st was marked done too: still the day he said BOOKED
      reconcile(s, [visits([false, false, true], "2026-09-08")], "2026-09-09T12:00:00Z");
      expect(mine()).toEqual([[45, "2026-08-16"]]);
      reconcile(s, [visits([false, true, true], "2026-09-08")], "2026-09-10T12:00:00Z");
      expect(mine()).toEqual([[90, "2026-08-16"]]);
      expect(totals(s)).toMatchObject({ booked: 1, bookedValue: 90 });
      expect(s.events.filter((e) => e.title.startsWith(`${mike.name} came back`))).toEqual([]);
    });

    it("a comeback seen through its visits comes off when its job leaves the calendar; a job made again is one booking", () => {
      const { s, mine } = account(report(clients, LAWN_ASOF));
      reconcile(s, [visitsFile([["2026-08-24", false], ["2026-08-31", false]])], "2026-08-26T12:00:00Z");
      expect(mine()).toEqual([[45, "2026-08-24"]]);
      const remade = structuredClone(s);
      // he cancelled before any mowing and the owner closed #9001: its visits are gone from the next report
      reconcile(s, [visitsFile([], "2026-09-07")], "2026-09-08T12:00:00Z");
      expect(mine()).toEqual([]);
      expect(totals(s)).toMatchObject({ booked: 0, bookedValue: 0 });
      // or the owner deleted #9001 and set the mowing up again as #9002, done on the 7th
      reconcile(remade, [visitsFile([["2026-09-07", true, 9002]], "2026-09-07")], "2026-09-08T12:00:00Z");
      expect(totals(remade)).toMatchObject({ booked: 1, bookedValue: 45 });
      expect(ledgerRows(remade).map((r) => [r.record, r.value])).toEqual([["Job #9002", 45]]);
    });

    it("a BOOKED text for next season and the job's visits in the spring are one booking", () => {
      // Mike wrote back on October 8th ("put me back on for spring") and the owner texted BOOKED 900 the next day.
      // April's report has his new job from the 5th.
      const ds = report(clients, "2026-10-08");
      const s = emptyState(ds, "2026-10-08T12:00:00Z");
      const id = idOf(ds, mike);
      s.outreach = [{ customerId: id, firstTouchOn: "2026-10-01", lastTouchOn: "2026-10-20" }];
      s.replies = [{ id: "r1", customerId: id, channel: "email", receivedAt: "2026-10-08T15:00:00", from: mike.email, text: "Put me back on for spring", intent: "wants_it", confidence: 0.9, extracted: {}, status: "done" }];
      markContacted(s, "r1", "2026-10-09T10:00:00", "booked", 900);
      reconcile(s, [visitsFile([["2027-04-05", true], ["2027-04-12", true], ["2027-04-19", false]], "2027-04-12")], "2027-04-14T12:00:00Z");
      expect(s.recoveries.filter((r) => r.customerId === id && !r.disputed).map((r) => [r.value, r.cameBackOn])).toEqual([[90, "2026-10-09"]]);
      expect(totals(s)).toMatchObject({ booked: 1, bookedValue: 90 });
    });

    it("a booking the owner took back stays off once its job took its place, and his figure never comes back", () => {
      const { s } = account(report(clients, LAWN_ASOF));
      markContacted(s, "r1", "2026-08-16T10:00:00", "booked", 540);
      const visits = (shopMarkedTo?: ISODate) => visitsFile([["2026-08-24", false], ["2026-08-31", false], ["2026-09-07", false]], shopMarkedTo);
      reconcile(s, [visits()], "2026-08-26T12:00:00Z");
      expect(totals(s)).toMatchObject({ booked: 1, bookedValue: 45 });
      // August 27th: he cancelled, and the owner texts NO: its dollars leave the ledger
      markContacted(s, "r1", "2026-08-27T09:00:00", "lost");
      expect(totals(s)).toMatchObject({ booked: 0, bookedValue: 0 });
      // September 9th: the shop has marked its visits through the 8th, and none of his were done
      reconcile(s, [visits("2026-09-08")], "2026-09-09T12:00:00Z");
      expect(totals(s)).toMatchObject({ booked: 0, bookedValue: 0 });
      expect(ledgerRows(s).filter((r) => r.counts)).toEqual([]);
      // and a NO that left the job in his booking's place (on a ledger saved before NO took it back) keeps it off too
      const before = account(report(clients, LAWN_ASOF)).s;
      markContacted(before, "r1", "2026-08-16T10:00:00", "booked", 540);
      reconcile(before, [visits()], "2026-08-26T12:00:00Z");
      before.replies[0]!.outcome = "lost";
      reconcile(before, [visits("2026-09-08")], "2026-09-09T12:00:00Z");
      expect(totals(before)).toMatchObject({ booked: 0, bookedValue: 0 });
    }, 60_000);

    it("a BOOKED text, a client list's date and then the job's visits are one booking, at his figure until the visits have one", () => {
      // Mike wrote back on October 8th ("put me back on for spring") and the owner texted BOOKED 900 the next day. The
      // client list sent April 14th has him last here on the 12th; the Visits report sent May 1st has his new job.
      const ds = report(clients, "2026-10-08");
      const s = emptyState(ds, "2026-10-08T12:00:00Z");
      const id = idOf(ds, mike);
      s.outreach = [{ customerId: id, firstTouchOn: "2026-10-05", lastTouchOn: "2026-10-16" }];
      s.replies = [{ id: "r1", customerId: id, channel: "email", receivedAt: "2026-10-08T15:00:00", from: mike.email, text: "Put me back on for spring", intent: "wants_it", confidence: 0.9, extracted: {}, status: "done" }];
      markContacted(s, "r1", "2026-10-09T10:00:00", "booked", 900);
      const ours = () => s.recoveries.filter((r) => r.customerId === id && !r.disputed).map((r) => [r.value, r.cameBackOn]);
      reconcile(s, [{ name: "Clients.csv", text: `Client name,Email,Last Visit\n${mike.name},${mike.email},04/12/2027\n` }], "2027-04-14T12:00:00Z");
      expect(ours()).toEqual([[900, "2026-10-09"]]);
      expect(totals(s)).toMatchObject({ booked: 1, bookedValue: 900 });
      reconcile(s, [visitsFile([["2027-04-05", true], ["2027-04-12", true], ["2027-04-19", false]], "2027-04-12")], "2027-05-01T12:00:00Z");
      expect(ours()).toEqual([[90, "2026-10-09"]]);
      expect(ledgerRows(s).map((r) => [r.record, r.value, r.cameBackOn])).toEqual([["Job #9001", 90, "2026-10-09"]]);
    }, 60_000);

    it("visits with no price keep the owner's figure", () => {
      // a fixed-price contract: Jobber leaves "Visit based ($)" blank on its visits
      const { s, mine } = account(report(clients, LAWN_ASOF));
      markContacted(s, "r1", "2026-08-16T10:00:00", "booked", 540);
      const unpriced = (visits: [ISODate, boolean][], shopMarkedTo: ISODate) => ({ name: "Visits Report.csv", text: visitsReport(withJob(visits, shopMarkedTo), "newest", false) });
      reconcile(s, [unpriced([["2026-08-24", true], ["2026-08-31", true]], "2026-09-01")], "2026-09-02T12:00:00Z");
      expect(mine()).toEqual([[540, "2026-08-16"]]);
      reconcile(s, [unpriced([["2026-08-24", true], ["2026-08-31", true], ["2026-09-07", true]], "2026-09-08")], "2026-09-09T12:00:00Z");
      expect(mine()).toEqual([[540, "2026-08-16"]]);
      expect(ledgerRows(s).map((r) => [r.record, r.value])).toEqual([["Job #9001", 540]]);
      // and visits with no price on the ledger first: his BOOKED gives the booking his figure, never a second booking
      const first = account(report(clients, LAWN_ASOF));
      reconcile(first.s, [unpriced([["2026-08-24", true]], "2026-08-25")], "2026-08-26T12:00:00Z");
      expect(first.mine()).toEqual([[0, "2026-08-24"]]);
      markContacted(first.s, "r1", "2026-08-27T10:00:00", "booked", 1100);
      expect(first.mine()).toEqual([[1100, "2026-08-24"]]);
      reconcile(first.s, [unpriced([["2026-08-24", true], ["2026-08-31", true]], "2026-09-01")], "2026-09-02T12:00:00Z");
      expect(first.mine()).toEqual([[1100, "2026-08-24"]]);
      expect(totals(first.s)).toMatchObject({ booked: 1, bookedValue: 1100 });
    }, 60_000);

    it("a BOOKED text and its job are one booking, whichever of the job's reports came first or together", () => {
      // Mike was written to October 6th to 20th and wrote back on the 8th; the owner texted BOOKED 1260 on the 9th, made
      // #9101 on March 1st when he laid out the season, and the mowing started April 6th
      const JOBS9101 = { name: "Jobs Report.csv", text: `Job #,Client name,Client email,Title,Job status,Job type,Created date,Start date,Completed date,Total ($)\n9101,${mike.name},${mike.email},Weekly mowing,Active,Recurring,03/01/2027,04/06/2027,,1260\n` };
      const VISITS9101 = visitsFile([["2027-04-06", true, 9101], ["2027-04-13", true, 9101]], "2027-04-13");
      const booked = () => {
        const s = emptyState(report(clients, "2026-10-08"), "2026-10-08T12:00:00Z");
        const id = idOf(s.dataset, mike);
        s.outreach = [{ customerId: id, firstTouchOn: "2026-10-06", lastTouchOn: "2026-10-20" }];
        s.replies = [{ id: "r1", customerId: id, channel: "email", receivedAt: "2026-10-08T15:00:00", from: mike.email, text: "Put me back on for spring", intent: "wants_it", confidence: 0.9, extracted: {}, status: "done" }];
        markContacted(s, "r1", "2026-10-09T10:00:00", "booked", 1260);
        return s;
      };
      const rows = (s: ReturnType<typeof booked>) => ledgerRows(s).filter((r) => r.counts).map((r) => [r.record, r.value, r.cameBackOn]);
      const together = booked();
      reconcile(together, [VISITS9101, JOBS9101], "2027-04-15T12:00:00Z");
      expect(rows(together)).toEqual([["Job #9101", 90, "2026-10-09"]]);
      const apart = booked();
      reconcile(apart, [VISITS9101], "2027-04-15T12:00:00Z");
      reconcile(apart, [JOBS9101], "2027-04-16T12:00:00Z");
      expect(rows(apart)).toEqual([["Job #9101", 90, "2026-10-09"]]);
      const jobsFirst = booked();
      reconcile(jobsFirst, [JOBS9101], "2027-03-02T12:00:00Z");
      expect(rows(jobsFirst)).toEqual([["Job #9101", 1260, "2026-10-09"]]);
      reconcile(jobsFirst, [VISITS9101], "2027-04-15T12:00:00Z");
      expect(rows(jobsFirst)).toEqual([["Job #9101", 90, "2026-10-09"]]);
    }, 60_000);

    it("a job deleted before any work leaves no booking, though the next report has no row for him at all", () => {
      // a shop that never ticks visits off: a visit's date says it was done. Mike's new job #9001 went on the calendar
      // weekly; he cancelled and the owner deleted it, so the next report has no row for him.
      const unticked = (cs: LawnClient[], from: ISODate, to: ISODate) =>
        cs.map((x) => ({ ...x, visits: x.visits.filter((v) => v.date >= from && v.date <= to).map((v) => ({ ...v, done: false })) }));
      const file = (cs: LawnClient[], from: ISODate, to: ISODate) => ({ name: "Visits Report.csv", text: visitsReport(unticked(cs, from, to), "newest") });
      const weekly = (from: ISODate) => [0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70].map((n): [ISODate, boolean] => [addDays(from, n), false]).filter(([d]) => d <= "2026-11-06");
      const cases: [ISODate, { name: string; text: string }, ISODate, { name: string; text: string }, ISODate][] = [
        // weekly from August 24th, and the same days (August 4th to November 24th) sent again
        ["2026-08-21", file(withJob(weekly("2026-08-24")), "2026-08-04", "2026-11-24"), "2026-09-15", file(clients, "2026-08-04", "2026-11-24"), "2026-10-15"],
        // weekly from October 5th, and a report for October only
        ["2026-09-30", file(withJob(weekly("2026-10-05")), "2024-01-01", "2026-11-24"), "2026-10-31", file(clients, "2026-10-01", "2026-10-31"), "2026-11-01"],
      ];
      for (const [bookedOn, booked, goneOn, gone, later] of cases) {
        const { s, mine } = account(ingestFile(emptyDataset(business({ trade: "lawn", name: "Greenline Lawn Care", avgJobValue: undefined }), LAWN_ASOF), file(clients, "2024-01-01", LAWN_ASOF).text, "Visits Report.csv", `${LAWN_ASOF}T12:00:00Z`).dataset);
        reconcile(s, [booked], `${bookedOn}T12:00:00Z`);
        expect(mine()).toEqual([]);
        reconcile(s, [gone], `${goneOn}T12:00:00Z`);
        expect(mine()).toEqual([]);
        ledgerPass(s, `${later}T12:00:00Z`);
        expect(mine()).toEqual([]);
        expect(totals(s)).toMatchObject({ booked: 0, bookedValue: 0 });
      }
    }, 60_000);
  });

  it("a comeback in a bookings export goes by its own booking's number on the ledger, never the client's first", () => {
    // Karen was cleaned every other week from March to June, bookings #4001 to #4009. We wrote to her on September
    // 1st, and she came back on the 15th (#4310) and the 29th (#4311).
    const row = (id: number, on: ISODate) => `${id},Karen Brennan,karen@gmail.com,Biweekly cleaning,Every other week,${on},160.00,Completed`;
    const CSV = ["Booking ID,Customer Name,Email,Service,Frequency,Booking Date,Price,Status", ...Array.from({ length: 9 }, (_, k) => row(4001 + k, addDays("2026-03-03", 14 * k))), row(4310, "2026-09-15"), row(4311, "2026-09-29")].join("\n");
    const ds = ingestFile(emptyDataset(business({ trade: "cleaning", name: "Sparkle House Cleaning", avgJobValue: undefined }), "2026-10-01"), CSV, "Bookings.csv", "2026-10-01T12:00:00Z").dataset;
    const id = ds.customers[0]!.id;
    const s = emptyState(ds, "2026-10-01T12:00:00Z");
    s.outreach = [{ customerId: id, firstTouchOn: "2026-09-01", lastTouchOn: "2026-09-01" }];
    s.replies = [{ id: "r1", customerId: id, channel: "email", receivedAt: "2026-09-02T15:00:00", from: "karen@gmail.com", text: "Yes, put me back on", intent: "wants_it", confidence: 0.9, extracted: {}, status: "done" }];
    ledgerPass(s, "2026-10-01T12:00:00Z");
    expect(ledgerRows(s).map((r) => [r.record, r.value, r.cameBackOn])).toEqual([["Job #4310", 320, "2026-09-15"]]);
  });

  describe("on a cleaning client list", () => {
    const sparkle = () => business({ trade: "cleaning", name: "Sparkle House Cleaning", avgJobValue: undefined });
    const list = (on: string) => `First Name,Last Name,Email,Last Cleaning\nKaren,Brennan,karen@yahoo.com,${on}\n`;
    /** Karen, last cleaned in July: we wrote on October 1st and she wrote back the next day. */
    const karen = (first = list("07/14/2026"), name = "Clients.csv") => {
      const ds = ingestFile(emptyDataset(sparkle(), "2026-10-01"), first, name, "2026-10-01T12:00:00Z").dataset;
      const id = ds.customers[0]!.id;
      const s = emptyState(ds, "2026-10-01T12:00:00Z");
      s.outreach = [{ customerId: id, firstTouchOn: "2026-10-01", lastTouchOn: "2026-10-01" }];
      s.replies = [{ id: "r1", customerId: id, channel: "email", receivedAt: "2026-10-02T15:00:00", from: "karen@yahoo.com", text: "Yes, put me back on", intent: "wants_it", confidence: 0.9, extracted: {}, status: "done" }];
      return s;
    };

    it("re-sent each month, it's one regular back on the schedule, never a booking a month", () => {
      const s = karen();
      for (const [on, now] of [["10/20/2026", "2026-10-31"], ["11/17/2026", "2026-11-30"], ["12/15/2026", "2026-12-31"]] as const) {
        reconcile(s, [{ name: "Clients.csv", text: list(on) }], `${now}T12:00:00Z`);
        expect(totals(s)).toMatchObject({ booked: 1 });
      }
      expect(ledgerRows(s).map((r) => [r.record, r.cameBackOn])).toEqual([["Job", "2026-10-20"]]);
    });

    it("its date beside the visit it stands for is that one booking, whichever came first", () => {
      // she came back on October 6th (the Visits report), and the list sent the next day says the 7th
      const VISITS = "Job #,Date,Visit title,Client name,Client email,Visit completed,Visit based ($),Job type\n88,2026-10-06,Biweekly cleaning,Karen Brennan,karen@yahoo.com,Yes,160.00,Recurring\n";
      const both = karen();
      reconcile(both, [{ name: "Visits Report.csv", text: VISITS }, { name: "Clients.csv", text: list("10/07/2026") }], "2026-10-08T12:00:00Z");
      expect(ledgerRows(both).map((r) => [r.record, r.value, r.cameBackOn])).toEqual([["Job #88", 160, "2026-10-06"]]);
      const listFirst = karen();
      reconcile(listFirst, [{ name: "Clients.csv", text: list("10/07/2026") }], "2026-10-08T12:00:00Z");
      expect(totals(listFirst)).toMatchObject({ booked: 1 });
      reconcile(listFirst, [{ name: "Visits Report.csv", text: VISITS }], "2026-10-09T12:00:00Z");
      expect(totals(listFirst)).toMatchObject({ booked: 1, bookedValue: 160 });
      expect(ledgerRows(listFirst).map((r) => [r.record, r.value])).toEqual([["Job #88", 160]]);
    });

    const rows = (s: ReturnType<typeof karen>) => ledgerRows(s).filter((r) => r.counts).map((r) => [r.record, r.value, r.cameBackOn]);

    it("a BOOKED text, the list's later date and the visits it stood for are one booking", () => {
      // "every other week, but start after Thanksgiving": BOOKED 160 on October 3rd, and the list sent December 31st
      // has her last cleaned on the 15th
      const s = karen();
      markContacted(s, "r1", "2026-10-03T10:00:00", "booked", 160);
      reconcile(s, [{ name: "Clients.csv", text: list("12/15/2026") }], "2026-12-31T12:00:00Z");
      expect(rows(s)).toEqual([["Job", 160, "2026-10-03"]]);
      // January 4th's Visits report: her new job #88, cleaned every other week from December 1st
      const VISITS = ["Job #,Date,Visit title,Client name,Client email,Visit completed,Visit based ($),Job type", ...["2026-12-01", "2026-12-15", "2026-12-29"].map((d) => `88,${d},Biweekly cleaning,Karen Brennan,karen@yahoo.com,Yes,160.00,Recurring`)].join("\n");
      reconcile(s, [{ name: "Visits Report.csv", text: VISITS }], "2027-01-04T12:00:00Z");
      expect(rows(s)).toEqual([["Job #88", 480, "2026-10-03"]]);
      expect(totals(s)).toMatchObject({ booked: 1, bookedValue: 480 });
    });

    it("a list's date that stood beside the owner's BOOKED goes once the visits show the booking it stood for", () => {
      // the list sent October 4th has Karen cleaned on the 3rd; she wrote back only on November 10th, and the owner
      // texted BOOKED 160 the next day: too far apart to be sure they're one booking, until January's Visits report
      // has her job #88 from December 1st and nothing in October
      const s = karen();
      const [reply] = s.replies;
      s.replies = [];
      reconcile(s, [{ name: "Clients.csv", text: list("10/03/2026") }], "2026-10-04T12:00:00Z");
      s.replies = [{ ...reply!, receivedAt: "2026-11-10T15:00:00" }];
      markContacted(s, "r1", "2026-11-11T10:00:00", "booked", 160);
      ledgerPass(s, "2026-11-12T12:00:00Z");
      expect(totals(s)).toMatchObject({ booked: 2, bookedValue: 160 });
      const VISITS = ["Job #,Date,Visit title,Client name,Client email,Visit completed,Visit based ($),Job type", ...["2026-12-01", "2026-12-15", "2026-12-29"].map((d) => `88,${d},Biweekly cleaning,Karen Brennan,karen@yahoo.com,Yes,160.00,Recurring`)].join("\n");
      reconcile(s, [{ name: "Visits Report.csv", text: VISITS }], "2027-01-04T12:00:00Z");
      expect(rows(s)).toEqual([["Job #88", 480, "2026-11-11"]]);
    });

    it("a list's date, with no amount on it, takes the owner's BOOKED figure, whichever came first", () => {
      // BOOKED 540 on October 3rd, and the list sent October 31st has her last cleaned on the 20th
      const told = karen();
      markContacted(told, "r1", "2026-10-03T10:00:00", "booked", 540);
      reconcile(told, [{ name: "Clients.csv", text: list("10/20/2026") }], "2026-10-31T12:00:00Z");
      expect(rows(told)).toEqual([["Job", 540, "2026-10-03"]]);
      expect(totals(told)).toMatchObject({ booked: 1, bookedValue: 540 });
      // the list first (cleaned October 6th), and his BOOKED 160 after
      const listed = karen();
      reconcile(listed, [{ name: "Clients.csv", text: list("10/06/2026") }], "2026-10-07T12:00:00Z");
      markContacted(listed, "r1", "2026-10-08T10:00:00", "booked", 160);
      expect(rows(listed)).toEqual([["Job", 160, "2026-10-06"]]);
      ledgerPass(listed, "2026-10-09T12:00:00Z");
      expect(totals(listed)).toMatchObject({ booked: 1, bookedValue: 160 });
      // taken back: his figure goes, and the list's date counts as it did before he texted; booked again after all, it
      // takes his new figure
      markContacted(listed, "r1", "2026-10-10T10:00:00", "lost");
      ledgerPass(listed, "2026-10-11T12:00:00Z");
      expect(rows(listed)).toEqual([["Job", 0, "2026-10-06"]]);
      markContacted(listed, "r1", "2026-10-12T10:00:00", "booked", 200);
      ledgerPass(listed, "2026-10-13T12:00:00Z");
      expect(rows(listed)).toEqual([["Job", 200, "2026-10-06"]]);
      expect(totals(listed)).toMatchObject({ booked: 1, bookedValue: 200 });
      // the list's date before she wrote back (October 3rd), her reply on the 5th and his BOOKED 160 on the 6th
      const quiet = karen();
      const [reply] = quiet.replies;
      quiet.replies = [];
      reconcile(quiet, [{ name: "Clients.csv", text: list("10/03/2026") }], "2026-10-04T12:00:00Z");
      quiet.replies = [{ ...reply!, receivedAt: "2026-10-05T15:00:00" }];
      markContacted(quiet, "r1", "2026-10-06T10:00:00", "booked", 160);
      ledgerPass(quiet, "2026-10-07T12:00:00Z");
      expect(rows(quiet)).toEqual([["Job", 160, "2026-10-03"]]);
    });

    it("a job that took the list's place and was then cancelled gives it back: one booking, never two with one id", () => {
      const s = karen();
      reconcile(s, [{ name: "Clients.csv", text: list("10/07/2026") }], "2026-10-08T12:00:00Z");
      const JOBS = (status: string) => ({ name: "Jobs Report.csv", text: `Job #,Client name,Client email,Title,Job status,Job type,Created date,Start date,Completed date,Total ($)\n501,Karen Brennan,karen@yahoo.com,Biweekly cleaning,${status},Recurring,10/05/2026,10/21/2026,,160\n` });
      reconcile(s, [JOBS("Active")], "2026-10-10T12:00:00Z");
      expect(rows(s)).toEqual([["Job #501", 160, "2026-10-05"]]);
      reconcile(s, [JOBS("Cancelled")], "2026-10-12T12:00:00Z");
      for (const now of ["2026-10-12T13:00:00Z", "2026-10-13T12:00:00Z"]) {
        ledgerPass(s, now);
        expect(s.recoveries.map((r) => r.id)).toHaveLength(new Set(s.recoveries.map((r) => r.id)).size);
        expect(rows(s)).toEqual([["Job", 0, "2026-10-07"]]);
        expect(totals(s)).toMatchObject({ booked: 1 });
      }
    });
  });

  it("a job on the ledger that can't be found is a job, never one the owner told us about", () => {
    const s = emptyState(dataset({ customers: [customer("c1")] }), "2026-10-01T12:00:00Z");
    s.recoveries = [{ id: "rec1", customerId: "c1", record: { kind: "job", id: "j_gone" }, value: 45, cameBackOn: "2026-09-20", match: "customer_id", confidence: 0.9, tier: "traced" }];
    expect(ledgerRows(s).map((r) => r.record)).toEqual(["Job"]);
  });
});

describe("counted", () => {
  const rec = (id: string, over: Partial<Recovery>): Recovery => ({ id, customerId: id, record: { kind: "job", id }, value: 1000, cameBackOn: "2026-11-01", match: "customer_id", confidence: 0.9, ...over });
  it("counts traced comebacks and owner-reported bookings, not 'after our note' or disputed ones", () => {
    const all = [
      rec("traced", { tier: "traced" }),
      rec("same", { tier: "traced", match: "same_record" }),
      rec("owner", { tier: "traced", match: "owner_reported" }),
      rec("after", { tier: "after_note" }),
      rec("disputed", { tier: "traced", disputed: { at: "2026-11-05T10:00:00", reason: "already booked by phone", by: "owner" } }),
    ];
    expect(counted(all).map((r) => r.id)).toEqual(["traced", "same", "owner"]);
  });
  it("what attribute finds without a reply never counts, unless it's the chased quote", () => {
    const ds = dataset({
      customers: [customer("c1"), customer("c2")],
      quotes: [quote("q1", "c1", { status: "converted", sentOn: "2026-03-01", convertedOn: "2026-10-21" })],
      jobs: [job("j2", "c2", { createdOn: "2026-10-30" })],
    });
    const found = attribute(ds, [worked(), worked({ customerId: "c2", sourceId: "qX" })]);
    expect(found).toHaveLength(2);
    expect(counted(found).map((r) => r.customerId)).toEqual(["c1"]);
  });
});

describe("COUNTING_RULES", () => {
  it("say, word for word, the windows the code uses", () => {
    const text = COUNTING_RULES.join(" ");
    expect(text).toContain("up to 180 days after our last note");
    expect(text).toContain("(up to 90 days)");
    expect(text).toMatch(/never counts toward the guarantee/);
    expect(text).toMatch(/One credit per job/);
  });
});

describe("ownerReported", () => {
  const reply = (over: Partial<Reply>): Reply => ({
    id: "r1",
    customerId: "c1",
    opportunityId: "op1",
    channel: "email",
    receivedAt: "2026-10-07T14:00:00",
    from: "c1@gmail.com",
    text: "yes please",
    intent: "wants_it",
    confidence: 0.9,
    extracted: {},
    status: "done",
    ...over,
  });
  it("turns a booking the owner texted in into a recovery", () => {
    const [rec, ...rest] = ownerReported([reply({ outcome: "booked", outcomeValue: 2400, ownerContactedAt: "2026-10-08T09:00:00" })], []);
    expect(rest).toEqual([]);
    expect(rec).toMatchObject({ customerId: "c1", opportunityId: "op1", value: 2400, cameBackOn: "2026-10-08", match: "owner_reported", confidence: 0.75, record: { kind: "job", id: "r1" }, tier: "traced" });
    expect(counted([rec!])).toHaveLength(1);
  });
  it("dates it by the reply when the call time wasn't logged", () => {
    expect(ownerReported([reply({ outcome: "booked", outcomeValue: 100 })], [])[0]!.cameBackOn).toBe("2026-10-07");
  });
  it("skips replies that weren't booked, have no amount, no customer, or are already counted", () => {
    const existing: Recovery[] = [{ id: "x", customerId: "c9", record: { kind: "job", id: "j9" }, value: 500, cameBackOn: "2026-10-10", match: "customer_id", confidence: 0.9 }];
    const out = ownerReported(
      [
        reply({ id: "a", outcome: "quoted", outcomeValue: 900 }),
        reply({ id: "b", outcome: "booked" }),
        reply({ id: "c", outcome: "booked", outcomeValue: 900, customerId: undefined }),
        reply({ id: "d", outcome: "booked", outcomeValue: 900, customerId: "c9" }),
        reply({ id: "e", outcome: "booked", outcomeValue: 900, customerId: "c2" }),
      ],
      existing,
    );
    expect(out.map((r) => r.customerId)).toEqual(["c2"]);
  });
  it("an earlier small comeback we don't count never blocks the real booking", () => {
    const quiet: Recovery[] = [{ id: "x", customerId: "c1", record: { kind: "job", id: "j1" }, value: 250, cameBackOn: "2026-09-20", match: "customer_id", confidence: 0.9, tier: "after_note" }];
    const out = ownerReported([reply({ id: "big", outcome: "booked", outcomeValue: 6500 })], quiet);
    expect(out.map((r) => r.value)).toEqual([6500]);
  });
});

describe("lift", () => {
  /** `treated` people contacted, `held` held out; the first `tBack` / `hBack` of each came back for `value`. */
  function world(treated: number, held: number, tBack: number, hBack: number, value = 1000) {
    const outreach: OutreachRecord[] = [];
    const recoveries: Recovery[] = [];
    for (let i = 0; i < treated; i++) outreach.push({ customerId: `t${i}`, firstTouchOn: FIRST, lastTouchOn: LAST });
    for (let i = 0; i < held; i++) outreach.push({ customerId: `h${i}`, firstTouchOn: FIRST, lastTouchOn: FIRST, holdout: true });
    const back = (id: string): Recovery => ({ id: `rec-${id}`, customerId: id, record: { kind: "job", id: `j-${id}` }, value, cameBackOn: "2026-11-01", match: "customer_id", confidence: 0.9 });
    for (let i = 0; i < tBack; i++) recoveries.push(back(`t${i}`));
    for (let i = 0; i < hBack; i++) recoveries.push(back(`h${i}`));
    return lift(outreach, recoveries);
  }

  it("compares the people we contacted with the people we held out", () => {
    const l = world(200, 160, 30, 8);
    expect(l.treated).toEqual({ people: 200, cameBack: 30, value: 30000, rate: 0.15 });
    expect(l.holdout).toEqual({ people: 160, cameBack: 8, value: 8000, rate: 0.05 });
    // 5% of 200 would have come back anyway, at the treated group's average ticket
    expect(l.baseline).toBe(10000);
    expect(l.incremental).toBe(20000);
    expect(l.confidence).toBe("fair");
    expect(l.note).toBe("5% of the people we didn't contact came back on their own, versus 15% of the people we did.");
  });
  it("labels confidence by how big the comparison group is", () => {
    // one shop's group is never "solid"; that's kept for pooled groups of 1,000+
    expect(world(200, 1000, 10, 2).confidence).toBe("solid");
    expect(world(200, 999, 10, 2).confidence).toBe("fair");
    expect(world(200, 150, 10, 2).confidence).toBe("fair");
    expect(world(200, 50, 10, 2).confidence).toBe("fair");
    const early = world(200, 49, 10, 2);
    expect(early.confidence).toBe("early");
    expect(early.note).toMatch(/^Only 49 people are in the comparison group so far/);
  });
  it("never reports negative incremental revenue", () => {
    const l = world(100, 100, 2, 10);
    expect(l.baseline).toBeGreaterThan(l.treated.value);
    expect(l.incremental).toBe(0);
  });
  it("with no holdout comebacks, everything the treated group brought is incremental", () => {
    const l = world(100, 60, 5, 0);
    expect(l.baseline).toBe(0);
    expect(l.incremental).toBe(5000);
  });
  it("counts a person once even with two recoveries, but adds both values", () => {
    const outreach: OutreachRecord[] = [{ customerId: "t0", firstTouchOn: FIRST, lastTouchOn: LAST }];
    const r = (id: string, value: number): Recovery => ({ id, customerId: "t0", record: { kind: "job", id }, value, cameBackOn: "2026-11-01", match: "customer_id", confidence: 0.9 });
    const l = lift(outreach, [r("a", 500), r("b", 700)]);
    expect(l.treated.cameBack).toBe(1);
    expect(l.treated.value).toBe(1200);
  });
  it("leaves out anything the owner marked as not ours, in both groups", () => {
    const outreach: OutreachRecord[] = [
      { customerId: "t0", firstTouchOn: FIRST, lastTouchOn: LAST },
      { customerId: "t1", firstTouchOn: FIRST, lastTouchOn: LAST },
      { customerId: "h0", firstTouchOn: FIRST, lastTouchOn: FIRST, holdout: true },
    ];
    const disputed = { at: "2026-11-05T10:00:00", reason: "calls every spring", by: "owner" };
    const r = (id: string, over: Partial<Recovery> = {}): Recovery => ({ id, customerId: id, record: { kind: "job", id }, value: 1000, cameBackOn: "2026-11-01", match: "customer_id", confidence: 0.9, tier: "traced", ...over });
    const l = lift(outreach, [r("t0"), r("t1", { disputed }), r("h0", { disputed })]);
    expect(l.treated).toMatchObject({ cameBack: 1, value: 1000 });
    expect(l.holdout).toMatchObject({ cameBack: 0, value: 0 });
  });
  it("counts both tiers, in the treated and the holdout group alike", () => {
    // holdout people never get a note, so they can never be "traced" — comparing only traced work would be rigged
    const outreach: OutreachRecord[] = [
      ...Array.from({ length: 10 }, (_, i): OutreachRecord => ({ customerId: `t${i}`, firstTouchOn: FIRST, lastTouchOn: LAST })),
      ...Array.from({ length: 10 }, (_, i): OutreachRecord => ({ customerId: `h${i}`, firstTouchOn: FIRST, lastTouchOn: FIRST, holdout: true })),
    ];
    const r = (id: string, tier: Recovery["tier"]): Recovery => ({ id, customerId: id, record: { kind: "job", id }, value: 1000, cameBackOn: "2026-11-01", match: "customer_id", confidence: 0.9, tier });
    const l = lift(outreach, [r("t0", "traced"), r("t1", "after_note"), r("h0", "holdout")]);
    expect(l.treated.cameBack).toBe(2);
    expect(l.holdout.cameBack).toBe(1);
    expect(l.baseline).toBe(1000);
    expect(l.incremental).toBe(1000);
  });
  it("works end to end with what attribute finds", () => {
    const ds = dataset({
      customers: [customer("t0"), customer("t1"), customer("h0")],
      jobs: [job("j0", "t0", { createdOn: "2026-10-20", total: 800 }), job("j1", "t1", { createdOn: "2026-10-25", total: 1200 }), job("j2", "h0", { createdOn: "2026-10-22", total: 500 })],
    });
    const outreach: OutreachRecord[] = [
      { customerId: "t0", firstTouchOn: FIRST, lastTouchOn: LAST },
      { customerId: "t1", firstTouchOn: FIRST, lastTouchOn: LAST },
      { customerId: "h0", firstTouchOn: FIRST, lastTouchOn: FIRST, holdout: true },
    ];
    const found = attribute(ds, outreach, { replied: new Set(["t0"]) });
    expect(found.map((x) => [x.customerId, x.tier])).toEqual([
      ["t0", "traced"],
      ["t1", "after_note"],
      ["h0", "holdout"],
    ]);
    const l = lift(outreach, found);
    expect(l.treated).toMatchObject({ people: 2, cameBack: 2, value: 2000 });
    expect(l.holdout).toMatchObject({ people: 1, cameBack: 1, value: 500 });
    expect(counted(found).map((x) => x.customerId)).toEqual(["t0"]);
  });
  it("staggered start: a held person's comeback before their first note is comparison-only; after it, it's ours", () => {
    const held: OutreachRecord = { customerId: "h0", firstTouchOn: FIRST, lastTouchOn: FIRST, holdout: true, releaseOn: addDays(FIRST, 60) };
    const before = dataset({ customers: [customer("h0")], jobs: [job("j0", "h0", { createdOn: addDays(FIRST, 20) })] });
    expect(attribute(before, [held]).map((x) => x.tier)).toEqual(["holdout"]);
    const treatedFrom = addDays(FIRST, 62);
    const after = dataset({ customers: [customer("h0")], jobs: [job("j1", "h0", { createdOn: addDays(FIRST, 70) })] });
    const recs = attribute(after, [{ ...held, treatedFrom, lastTouchOn: treatedFrom }], { replied: new Set(["h0"]) });
    expect(recs.map((x) => x.tier)).toEqual(["traced"]);
    expect(counted(recs)).toHaveLength(1);
    // never counted for the owner while they're only in the comparison group
    expect(counted(attribute(before, [held]))).toHaveLength(0);
  });
  it("the comparison group only counts comebacks from before anyone wrote to them", () => {
    const outreach: OutreachRecord[] = [{ customerId: "h0", firstTouchOn: FIRST, lastTouchOn: FIRST, holdout: true, treatedFrom: addDays(FIRST, 61) }];
    const r = (tier: Recovery["tier"]): Recovery => ({ id: "x", customerId: "h0", record: { kind: "job", id: "j" }, value: 500, cameBackOn: "2026-12-20", match: "customer_id", confidence: 0.9, tier });
    expect(lift(outreach, [r("traced")]).holdout.cameBack).toBe(0);
    expect(lift(outreach, [r("holdout")]).holdout.cameBack).toBe(1);
  });
  it("handles an empty ledger", () => {
    const l = lift([], []);
    expect(l.treated.people).toBe(0);
    expect(l.incremental).toBe(0);
    expect(l.confidence).toBe("early");
  });
});
