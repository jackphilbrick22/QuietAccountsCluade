import { describe, expect, it } from "vitest";
import { emptyDataset, ingestFile } from "../src/ingest/index.ts";
import { attribute, counted, COUNTING_RULES, lift, ownerReported, type OutreachRecord } from "../src/ledger/attribution.ts";
import type { Dataset, ISODate, Recovery, Reply } from "../src/model.ts";
import { ledgerRows } from "../src/reports/ledger.ts";
import { totals, weeklyReport, weekNumbers } from "../src/reports/owner.ts";
import { disputeRecovery, ledgerPass, reconcile } from "../src/runtime/agents.ts";
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
    const withJob = (visits: [ISODate, boolean][], shopMarkedTo = LAWN_ASOF) =>
      clients.map((x) => ({
        ...x,
        visits: [
          // the shop's other visits since, marked done as it went (a schedule nobody closed stays undone)
          ...x.visits.map((v) => (v.date > LAWN_ASOF && v.date <= shopMarkedTo && !x.neverClosed ? { ...v, done: true } : v)),
          ...(x === mike ? visits.map(([date, done]) => ({ job: 9001, date, title: "Weekly mowing", done, recurring: true, amount: 45 })) : []),
        ],
      }));
    const JOBS = `Job #,Client name,Client email,Title,Job status,Job type,Created date,Start date,Completed date,Total ($)\n9001,${mike.name},${mike.email},Weekly mowing,Active,Recurring,08/20/2026,08/24/2026,,135\n`;
    const visitsFile = (visits: [ISODate, boolean][], shopMarkedTo?: ISODate) => ({ name: "Visits Report.csv", text: visitsReport(withJob(visits, shopMarkedTo), "newest") });
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
