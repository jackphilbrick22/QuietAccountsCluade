import { describe, expect, it } from "vitest";
import { scan } from "../src/breakage/detect.ts";
import { summarize } from "../src/breakage/forecast.ts";
import { MAX_NOTES_PER_THREAD } from "../src/breakage/assumptions.ts";
import { planOutreach } from "../src/cadence/plan.ts";
import { FRESH_SEQUENCE, SEQUENCES } from "../src/copy/templates.ts";
import { emptyState } from "../src/runtime/state.ts";
import { callListNamed, kickoffText } from "../src/reports/owner.ts";
import { ASOF, ago, customer, dataset, quote } from "./fixtures.ts";

/** What the Jobber app listing promises owners, held true in the product. */
describe("the Jobber listing's promises", () => {
  it("never more than three notes to one person about one quote or job", () => {
    for (const seq of [...Object.values(SEQUENCES), FRESH_SEQUENCE]) expect(seq.steps.length).toBeLessThanOrEqual(MAX_NOTES_PER_THREAD);
  });

  it("quotes over $10,000 go on the owner's call list and are never emailed", () => {
    const ds = dataset({
      customers: [customer("big", { phones: ["+16035550111"] }), customer("small")],
      quotes: [quote("q1", "big", { sentOn: ago(90), total: 14_500, title: "Remove 3 oaks over the house" }), quote("q2", "small", { sentOn: ago(90), total: 1800 })],
    });
    const r = scan(ds);
    const big = r.opportunities.find((o) => o.customerId === "big")!;
    expect(big.caution?.[0]).toMatch(/Over \$10,000 — on your call list/);
    const p = planOutreach(ds, r, { startOn: ASOF });
    expect(p.touches.some((t) => t.customerId === "big")).toBe(false);
    expect(p.touches.some((t) => t.customerId === "small")).toBe(true);
    const s = summarize(ds, r);
    expect(s.callList.bigQuotes).toBe(1);
    expect(s.callList.top[0]).toMatchObject({ customerId: "big", phone: "+16035550111", why: "big_quote", value: 14_500 });
  });

  it("the owner can raise or turn off the call-over amount", () => {
    const parts = { customers: [customer("big")], quotes: [quote("q1", "big", { sentOn: ago(90), total: 14_500 })] };
    for (const callOverAmount of [0, 20_000]) {
      const ds = dataset({ ...parts, business: { callOverAmount } });
      expect(scan(ds).opportunities.find((o) => o.customerId === "big")!.caution ?? []).toEqual([]);
    }
  });

  it("people with only a phone number are handed to the owner, not dropped", () => {
    const ds = dataset({ customers: [customer("ph", { emails: [], phones: ["+16035550122"] })], quotes: [quote("q1", "ph", { sentOn: ago(60), total: 2400 })] });
    const r = scan(ds);
    const s = summarize(ds, r);
    expect(s.callList).toMatchObject({ people: 1, phoneOnly: 1, bigQuotes: 0 });
    const state = { ...emptyState(ds, `${ASOF}T12:00:00Z`), scan: r, summary: s };
    const text = kickoffText(state, ASOF, 40);
    expect(text).toMatch(/Worth a call from you \(we don't email these\): 1 with only a phone number/);
    expect(text).toContain("Mike Sanderson (603) 555-0122");
  });

  it("the welcome text names the biggest of each kind of job, whole amounts, biggest first", () => {
    const e = (name: string, job: string, value: number) => ({ customerId: name, name, phone: "+16035550100", job, value, why: "big_quote" as const });
    const top = [e("A", "vinyl fence in the backyard", 12_450), e("B", "vinyl fence in the backyard", 12_300), e("C", "privacy fence", 11_900), e("D", "vinyl fence in the backyard", 11_700), e("E", "pool fence", 10_400)];
    expect(callListNamed(top).map((x) => x.name)).toEqual(["A", "C", "E"]);
    // a shop with one kind of job names its biggest three, never one amount twice
    expect(callListNamed([e("A", "pump-out", 900), e("B", "pump-out", 850), e("C", "pump-out", 850), e("D", "pump-out", 700)]).map((x) => x.name)).toEqual(["A", "B", "D"]);
    // another kind takes a place only when it's worth half as much: a lawn shop's mowing stays
    expect(callListNamed([e("A", "mowing", 3000), e("B", "mowing", 2900), e("D", "mowing", 2800), e("C", "aeration", 400)]).map((x) => x.name)).toEqual(["A", "B", "D"]);
    expect(callListNamed([e("A", "mowing", 3000), e("B", "mowing", 2900), e("D", "mowing", 2800), e("C", "patio", 1600)]).map((x) => x.name)).toEqual(["A", "B", "C"]);
    const ds = dataset({ customers: [customer("big", { phones: ["+16035550111"] })], quotes: [quote("q1", "big", { sentOn: ago(90), total: 14_550, title: "Remove 3 oaks over the house" })] });
    const r = scan(ds);
    const text = kickoffText({ ...emptyState(ds, `${ASOF}T12:00:00Z`), scan: r, summary: summarize(ds, r) }, ASOF, 40);
    expect(text).toMatch(/\$14,550\)\./);
    expect(text).not.toMatch(/\$15k\)/);
  });

  it("someone who asked us to stop stays off the call list too", () => {
    const ds = dataset({ customers: [customer("x", { phones: ["+16035550133"], doNotContact: true })], quotes: [quote("q1", "x", { sentOn: ago(90), total: 14_500 })] });
    expect(summarize(ds, scan(ds)).callList.people).toBe(0);
  });
});
