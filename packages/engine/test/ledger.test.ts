import { describe, expect, it } from "vitest";
import { attribute, lift, ownerReported, type OutreachRecord } from "../src/ledger/attribution.ts";
import type { Recovery, Reply } from "../src/model.ts";
import { addDays } from "../src/util.ts";
import { customer, dataset, invoice, job, quote } from "./fixtures.ts";

const FIRST = "2026-10-06";
const LAST = "2026-10-15";
const worked = (over: Partial<OutreachRecord> = {}): OutreachRecord => ({ customerId: "c1", opportunityId: "op1", sourceId: "q1", firstTouchOn: FIRST, lastTouchOn: LAST, ...over });

describe("attribute", () => {
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

  describe("the 120-day window", () => {
    const jobOn = (createdOn: string) => dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { createdOn, completedOn: undefined, status: "scheduled" })] });
    it("counts work up to 120 days after the last note", () => {
      expect(attribute(jobOn(addDays(LAST, 120)), [worked()])).toHaveLength(1);
      expect(attribute(jobOn(addDays(LAST, 120)), [worked()])[0]!.lagDays).toBe(120);
    });
    it("not a day after", () => {
      expect(attribute(jobOn(addDays(LAST, 121)), [worked()])).toEqual([]);
    });
    it("not work that started before the first note", () => {
      expect(attribute(jobOn(addDays(FIRST, -1)), [worked()])).toEqual([]);
    });
    it("the chased quote converting after the window doesn't count either", () => {
      const ds = dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "converted", sentOn: "2026-03-01", convertedOn: addDays(LAST, 150) })] });
      expect(attribute(ds, [worked()])).toEqual([]);
    });
    it("the window can be changed", () => {
      expect(attribute(jobOn(addDays(LAST, 60)), [worked()], { windowDays: 30 })).toEqual([]);
      expect(attribute(jobOn(addDays(LAST, 60)), [worked()], { windowDays: 90 })).toHaveLength(1);
    });
  });

  it("ignores cancelled jobs, unpaid invoices and quotes still waiting", () => {
    const ds = dataset({
      customers: [customer("c1")],
      quotes: [quote("q1", "c1", { sentOn: "2026-10-20" })],
      jobs: [job("j1", "c1", { status: "cancelled", createdOn: "2026-10-20" })],
      invoices: [invoice("i1", "c1", { issuedOn: "2026-10-20" })],
    });
    expect(attribute(ds, [worked()])).toEqual([]);
  });
  it("finds comebacks for holdout people too (that's what the comparison needs)", () => {
    const ds = dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { createdOn: "2026-10-30" })] });
    expect(attribute(ds, [worked({ holdout: true })])).toHaveLength(1);
  });
  it("never uses one record twice", () => {
    const ds = dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { createdOn: "2026-10-30" })] });
    const recs = attribute(ds, [worked(), worked({ opportunityId: "op2", sourceId: "q2" })]);
    expect(recs).toHaveLength(1);
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
    expect(rec).toMatchObject({ customerId: "c1", opportunityId: "op1", value: 2400, cameBackOn: "2026-10-08", match: "owner_reported", confidence: 0.75, record: { kind: "job", id: "r1" } });
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
    expect(l.confidence).toBe("solid");
    expect(l.note).toBe("5% of the people we didn't contact came back on their own, versus 15% of the people we did.");
  });
  it("labels confidence by how big the comparison group is", () => {
    expect(world(200, 150, 10, 2).confidence).toBe("solid");
    expect(world(200, 149, 10, 2).confidence).toBe("fair");
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
  it("handles an empty ledger", () => {
    const l = lift([], []);
    expect(l.treated.people).toBe(0);
    expect(l.incremental).toBe(0);
    expect(l.confidence).toBe("early");
  });
});
