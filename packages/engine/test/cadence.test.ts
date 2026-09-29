import { beforeAll, describe, expect, it } from "vitest";
import { scan, type ScanResult } from "../src/breakage/detect.ts";
import { HOLD_WHEN_BOOKED, inHoldout, MAX_TYPE_SHARE, planOutreach, sendTime, type Plan } from "../src/cadence/plan.ts";
import { SEQUENCES } from "../src/copy/templates.ts";
import { generateSample, type Sample } from "../src/sample/generate.ts";
import type { BreakageType, BusinessProfile, Dataset, Opportunity, Touch } from "../src/model.ts";
import { addDays, daysBetween, mondayOf, weekday } from "../src/util.ts";
import { ASOF, customer, dataset, quote } from "./fixtures.ts";

const START = "2026-10-05"; // a Monday

/** The sample dataset with a few business settings changed (same records, same scan). */
function withBusiness(ds: Dataset, over: Partial<BusinessProfile>): Dataset {
  return { ...ds, business: { ...ds.business, ...over } };
}

const dateOf = (t: Touch) => t.dueAt.slice(0, 10);
const timeOf = (t: Touch) => t.dueAt.slice(11, 16);

function countBy<T>(xs: T[], key: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
}

function byPerson(plan: Plan): Map<string, Touch[]> {
  const m = new Map<string, Touch[]>();
  for (const t of plan.touches) (m.get(t.customerId) ?? m.set(t.customerId, []).get(t.customerId)!).push(t);
  for (const ts of m.values()) ts.sort((a, b) => a.step - b.step);
  return m;
}

let tree: Sample;
let treeScan: ScanResult;
let oppOf: Map<string, Opportunity>;

beforeAll(() => {
  tree = generateSample({ trade: "tree", asOf: ASOF });
  treeScan = scan(tree.dataset);
  oppOf = new Map(treeScan.primary.map((o) => [o.customerId, o]));
});

describe("who gets a note", () => {
  it("starts exactly limitPeople people, each with one first note", () => {
    const plan = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 30 });
    expect(plan.people).toHaveLength(30);
    expect(new Set(plan.people).size).toBe(30);
    const firsts = plan.touches.filter((t) => t.step === 1);
    expect(firsts.map((t) => t.customerId).sort()).toEqual([...plan.people].sort());
    const people = new Set(plan.people);
    expect(plan.touches.every((t) => people.has(t.customerId))).toBe(true);
  });
  it("writes each person the steps of their own sequence, about their primary opportunity", () => {
    const plan = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 60 });
    for (const [id, ts] of byPerson(plan)) {
      const o = oppOf.get(id)!;
      expect(ts.every((t) => t.opportunityId === o.id && t.channel === "email" && t.status === "planned")).toBe(true);
      const planned = SEQUENCES[o.type].steps.map((s) => s.step);
      expect(ts.map((t) => t.step).every((s) => planned.includes(s))).toBe(true);
      expect(ts[0]!.step).toBe(1);
      expect(ts[0]!.body).toContain(tree.dataset.business.mailingAddress!);
    }
  });
  it("only works people with an email, and honors skipCustomers and type filters", () => {
    const first = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 20 });
    const skip = new Set(first.people);
    const next = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 20, skipCustomers: skip });
    expect(next.people.some((id) => skip.has(id))).toBe(false);
    const only: BreakageType[] = ["archived_quote"];
    const archived = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 20, types: only });
    expect(archived.people.every((id) => oppOf.get(id)!.type === "archived_quote")).toBe(true);
    const all = planOutreach(tree.dataset, treeScan, { startOn: START });
    expect(all.people.every((id) => oppOf.get(id)!.channels.includes("email"))).toBe(true);
  });
  it("is deterministic", () => {
    const a = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 40 });
    const b = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 40 });
    expect(b.touches.map((t) => [t.id, t.dueAt, t.subject])).toEqual(a.touches.map((t) => [t.id, t.dueAt, t.subject]));
  });
});

describe("when notes go out", () => {
  it("only on the owner's send days", () => {
    for (const sendDays of [[2, 3, 4], [1, 3], [5]]) {
      const plan = planOutreach(withBusiness(tree.dataset, { sendDays }), treeScan, { startOn: START, limitPeople: 40 });
      expect(plan.touches.length).toBeGreaterThan(40);
      for (const t of plan.touches) expect(sendDays).toContain(weekday(dateOf(t)));
    }
  });
  it("never in a blackout week, first notes or follow-ups", () => {
    const blackout = "2026-10-12";
    const plan = planOutreach(withBusiness(tree.dataset, { blackoutWeeks: [blackout] }), treeScan, { startOn: START, limitPeople: 150 });
    expect(plan.touches.some((t) => dateOf(t) > "2026-10-18")).toBe(true); // the plan does run past it
    for (const t of plan.touches) expect(mondayOf(dateOf(t))).not.toBe(blackout);
  });
  it("a blackout on the start week pushes the whole round to the next open week", () => {
    const plan = planOutreach(withBusiness(tree.dataset, { blackoutWeeks: [START] }), treeScan, { startOn: START, limitPeople: 20 });
    expect(plan.firstDay! >= "2026-10-12").toBe(true);
  });
  it("respects the per-day and per-week caps on new people", () => {
    const weeklyNew = 20;
    const sendDays = [1, 3, 5];
    const perDay = Math.ceil(weeklyNew / sendDays.length);
    const plan = planOutreach(withBusiness(tree.dataset, { sendDays, weeklyNewContacts: weeklyNew }), treeScan, { startOn: START, limitPeople: 60 });
    const firsts = plan.touches.filter((t) => t.step === 1);
    const perDayCounts = countBy(firsts, dateOf);
    const perWeekCounts = countBy(firsts, (t) => mondayOf(dateOf(t)));
    expect(Math.max(...perDayCounts.values())).toBe(perDay); // the cap binds...
    expect(Math.max(...perWeekCounts.values())).toBe(weeklyNew);
    for (const n of perDayCounts.values()) expect(n).toBeLessThanOrEqual(perDay); // ...and is never exceeded
    for (const n of perWeekCounts.values()) expect(n).toBeLessThanOrEqual(weeklyNew);
    expect(plan.weeks.every((w) => w.newPeople <= weeklyNew)).toBe(true);
    expect(plan.weeks.reduce((a, w) => a + w.newPeople, 0)).toBe(60);
  });
  it("the weeklyNew option overrides the business setting", () => {
    const plan = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 40, weeklyNew: 10 });
    const perWeek = countBy(plan.touches.filter((t) => t.step === 1), (t) => mondayOf(dateOf(t)));
    for (const n of perWeek.values()) expect(n).toBeLessThanOrEqual(10);
    expect(perWeek.size).toBeGreaterThanOrEqual(4);
  });
  it("each person's notes go out on increasing days, no sooner than the sequence says", () => {
    const plan = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 150 });
    let followUps = 0;
    for (const [id, ts] of byPerson(plan)) {
      const steps = SEQUENCES[oppOf.get(id)!.type].steps;
      const start = dateOf(ts[0]!);
      for (let i = 1; i < ts.length; i++) {
        followUps++;
        expect(dateOf(ts[i]!) > dateOf(ts[i - 1]!)).toBe(true);
        const day = steps.find((s) => s.step === ts[i]!.step)!.day;
        expect(daysBetween(start, dateOf(ts[i]!))).toBeGreaterThanOrEqual(day);
      }
    }
    expect(followUps).toBeGreaterThan(100);
  });
  it("sends inside the owner's window", () => {
    for (const sendWindow of [[7, 10], [8, 9], [13, 17]] as [number, number][]) {
      const d = withBusiness(tree.dataset, { sendWindow });
      const plan = planOutreach(d, treeScan, { startOn: START, limitPeople: 40 });
      for (const t of plan.touches) {
        const [h, m] = timeOf(t).split(":").map(Number);
        expect(h! * 60 + m!).toBeGreaterThanOrEqual(sendWindow[0] * 60);
        expect(h! * 60 + m!).toBeLessThan(sendWindow[1] * 60);
      }
      for (let i = 0; i < 300; i++) {
        const [h, m] = sendTime(d, `key-${i}`).split(":").map(Number);
        expect(h! * 60 + m!).toBeGreaterThanOrEqual(sendWindow[0] * 60);
        expect(h! * 60 + m!).toBeLessThan(sendWindow[1] * 60);
      }
    }
  });
  it("spreads send times instead of stacking them at the top of the window", () => {
    const plan = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 40 });
    expect(new Set(plan.touches.map(timeOf)).size).toBeGreaterThan(20);
    expect(sendTime(tree.dataset, "same")).toBe(sendTime(tree.dataset, "same"));
  });
});

describe("holdout", () => {
  it("holdout people never get a note", () => {
    const plan = planOutreach(tree.dataset, treeScan, { startOn: START });
    expect(plan.holdout.length).toBeGreaterThan(0);
    const held = new Set(plan.holdout);
    expect(plan.people.some((id) => held.has(id))).toBe(false);
    expect(plan.touches.some((t) => held.has(t.customerId))).toBe(false);
  });
  it("holds back about the owner's share of the reachable list", () => {
    const pct = tree.dataset.business.persistence.holdoutPct;
    const emailable = treeScan.primary.filter((o) => o.channels.includes("email"));
    const plan = planOutreach(tree.dataset, treeScan, { startOn: START });
    expect(plan.holdout.length / emailable.length).toBeGreaterThan(pct - 0.04);
    expect(plan.holdout.length / emailable.length).toBeLessThan(pct + 0.04);
    expect(plan.holdout.sort()).toEqual(emailable.filter((o) => inHoldout(o.customerId, pct)).map((o) => o.customerId).sort());
  });
  it("membership is deterministic: same person, same answer, every run", () => {
    // a different round size and start date doesn't change who is held out
    const a = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 50 });
    const b = planOutreach(tree.dataset, treeScan, { startOn: "2026-11-02", limitPeople: 80 });
    expect(b.holdout).toEqual(a.holdout);
    // and it's a pure function of the customer id
    const again = treeScan.primary.map((o) => inHoldout(o.customerId, 0.1));
    expect(treeScan.primary.map((o) => inHoldout(o.customerId, 0.1))).toEqual(again);
    expect(inHoldout("cust-123", 0.5)).toBe(inHoldout("cust-123", 0.5));
  });
  it("raising the holdout share never pulls anyone out of it", () => {
    for (const o of treeScan.primary) if (inHoldout(o.customerId, 0.1)) expect(inHoldout(o.customerId, 0.2)).toBe(true);
    expect(treeScan.primary.some((o) => inHoldout(o.customerId, 0))).toBe(false);
  });
  it("can be switched off", () => {
    expect(planOutreach(tree.dataset, treeScan, { startOn: START, applyHoldout: false }).holdout).toEqual([]);
    const none = withBusiness(tree.dataset, { persistence: { ...tree.dataset.business.persistence, holdoutPct: 0 } });
    expect(planOutreach(none, treeScan, { startOn: START }).holdout).toEqual([]);
  });
});

describe("who goes first", () => {
  it("the free round (trial) ranks by reply likelihood", () => {
    expect(tree.dataset.business.plan.stage).toBe("trial");
    const plan = planOutreach(tree.dataset, treeScan, { startOn: START });
    const p = plan.people.map((id) => oppOf.get(id)!.recoverProbability);
    for (let i = 1; i < p.length; i++) expect(p[i]!).toBeLessThanOrEqual(p[i - 1]!);
  });

  it.each(["tree", "septic", "pressure_washing"] as const)("no breakage type takes more than %s's share of a limited round", (trade) => {
    const s = trade === "tree" ? tree : generateSample({ trade, asOf: ASOF });
    const r = trade === "tree" ? treeScan : scan(s.dataset);
    const types = new Map(r.primary.map((o) => [o.customerId, o.type]));
    for (const limit of [150, 50]) {
      const plan = planOutreach(s.dataset, r, { startOn: START, limitPeople: limit });
      expect(plan.people).toHaveLength(limit);
      const counts = countBy(plan.people, (id) => types.get(id)!);
      expect(counts.size).toBeGreaterThanOrEqual(3);
      for (const n of counts.values()) expect(n / limit).toBeLessThanOrEqual(MAX_TYPE_SHARE + 1 / limit);
      for (const n of counts.values()) expect(n).toBeLessThanOrEqual(Math.ceil(limit * MAX_TYPE_SHARE));
    }
  });

  it("paying accounts rank by expected dollars", () => {
    const paying = withBusiness(tree.dataset, { plan: { ...tree.dataset.business.plan, stage: "paying" } });
    const plan = planOutreach(paying, treeScan, { startOn: START, limitPeople: 150 });
    const ev = plan.people.map((id) => oppOf.get(id)!.expectedValue);
    for (let i = 1; i < ev.length; i++) expect(ev[i]!).toBeLessThanOrEqual(ev[i - 1]!);
    // the default follows the plan stage
    expect(planOutreach(paying, treeScan, { startOn: START, limitPeople: 150, rank: "dollars" }).people).toEqual(plan.people);
  });

  it("the dollars round carries more expected revenue; the reply round more likely replies", () => {
    const reply = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 150, rank: "reply" });
    const dollars = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 150, rank: "dollars" });
    const total = (ids: string[], f: (o: Opportunity) => number) => ids.reduce((a, id) => a + f(oppOf.get(id)!), 0);
    expect(total(dollars.people, (o) => o.expectedValue)).toBeGreaterThan(total(reply.people, (o) => o.expectedValue));
    expect(total(reply.people, (o) => o.recoverProbability)).toBeGreaterThan(total(dollars.people, (o) => o.recoverProbability));
  });
});

describe("held for a look", () => {
  /** A dozen ordinary quotes and one priced to lose. */
  const shop = () => {
    const customers = Array.from({ length: 13 }, (_, i) => customer(`c${i}`));
    const quotes = customers.map((c, i) => quote(`q${i}`, c.id, { total: i === 0 ? 9000 : 800 + i * 40 }));
    return dataset({ customers, quotes });
  };
  it("a caution-flagged opportunity is skipped with the reason, not silently dropped", () => {
    const ds = shop();
    const plan = planOutreach(ds, scan(ds), { startOn: START });
    expect(plan.people).not.toContain("c0");
    expect(plan.people).toHaveLength(12);
    const skip = plan.skipped.find((s) => s.customerId === "c0")!;
    expect(skip.why).toMatch(/^Held for a look: Priced \d+x your usual/);
  });
  it("goes out when the plan asks for held ones too, or once it's cleared", () => {
    const ds = shop();
    const r = scan(ds);
    expect(planOutreach(ds, r, { startOn: START, includeCaution: true }).people).toContain("c0");
    const held = r.opportunities.find((o) => o.customerId === "c0")!;
    expect(planOutreach(ds, scan(ds, { cleared: [held.id] }), { startOn: START }).people).toContain("c0");
  });
});

describe("booked out", () => {
  const types = () => new Map(treeScan.primary.map((o) => [o.customerId, o.type]));

  it("new work starts about three weeks before the schedule opens; yeses go now", () => {
    const booked = withBusiness(tree.dataset, { bookedOutUntil: "2026-12-15" });
    const plan = planOutreach(booked, treeScan, { startOn: START, limitPeople: 150 });
    const t = types();
    const firsts = plan.touches.filter((x) => x.step === 1);
    expect(firsts.some((x) => HOLD_WHEN_BOOKED.has(t.get(x.customerId)!))).toBe(true);
    expect(firsts.some((x) => !HOLD_WHEN_BOOKED.has(t.get(x.customerId)!))).toBe(true);
    for (const x of firsts) {
      if (HOLD_WHEN_BOOKED.has(t.get(x.customerId)!)) expect(dateOf(x) >= "2026-11-24").toBe(true);
      else expect(dateOf(x) < "2026-11-24").toBe(true);
    }
    // the caps still hold
    const perWeek = countBy(firsts, (x) => mondayOf(dateOf(x)));
    for (const n of perWeek.values()) expect(n).toBeLessThanOrEqual(booked.business.weeklyNewContacts);
  });
  it("said-yes and unpaid-invoice work never waits", () => {
    expect(HOLD_WHEN_BOOKED.has("approved_unscheduled")).toBe(false);
    expect(HOLD_WHEN_BOOKED.has("unpaid_invoice")).toBe(false);
  });
  it("booked out for less than three weeks changes nothing", () => {
    const soon = withBusiness(tree.dataset, { bookedOutUntil: addDays(START, 14) });
    const a = planOutreach(soon, treeScan, { startOn: START, limitPeople: 60 });
    const b = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 60 });
    expect(a.touches.map((t) => t.dueAt)).toEqual(b.touches.map((t) => t.dueAt));
  });
});

describe("edge cases", () => {
  it("an empty scan plans nothing", () => {
    const ds = dataset();
    const plan = planOutreach(ds, scan(ds), { startOn: START });
    expect(plan).toMatchObject({ touches: [], people: [], holdout: [], weeks: [], skipped: [] });
    expect(plan.firstDay).toBeUndefined();
  });
  it("the plan's first and last days bracket every note", () => {
    const plan = planOutreach(tree.dataset, treeScan, { startOn: START, limitPeople: 30 });
    expect(plan.firstDay! >= START).toBe(true);
    for (const t of plan.touches) {
      expect(dateOf(t) >= plan.firstDay!).toBe(true);
      expect(dateOf(t) <= plan.lastDay!).toBe(true);
    }
    expect(plan.weeks.reduce((a, w) => a + w.notes, 0)).toBe(plan.touches.length);
    expect(daysBetween(plan.firstDay!, plan.lastDay!)).toBeLessThan(60);
    expect(plan.lastDay! <= addDays(START, 60)).toBe(true);
  });
});
