import { describe, expect, it } from "vitest";
import { scan } from "../src/breakage/detect.ts";
import { planOutreach } from "../src/cadence/plan.ts";
import { FRESH_SEQUENCE, SEQUENCES } from "../src/copy/templates.ts";
import { answerNewRequests, dueTouches, markSent } from "../src/runtime/agents.ts";
import { emptyState } from "../src/runtime/state.ts";
import { weeklyReport } from "../src/reports/owner.ts";
import { ASOF, ago, business, customer, dataset, quote, request } from "./fixtures.ts";

const paying = (over = {}) => business({ plan: { stage: "paying", trialSize: 150, monthlyPrice: 497, freeMonths: [], paidOn: ago(40) }, ...over });

describe("always-on: every new quote is followed until a yes or a no", () => {
  it("a paying account picks up a quote sent 3 days ago and runs the fresh sequence", () => {
    const ds = dataset({ business: paying(), customers: [customer("c1")], quotes: [quote("q1", "c1", { sentOn: ago(3) })] });
    const r = scan(ds);
    const o = r.primary.find((x) => x.customerId === "c1")!;
    expect(o.type).toBe("unanswered_quote");
    const p = planOutreach(ds, r, { startOn: ASOF });
    const ts = p.touches.filter((t) => t.customerId === "c1");
    expect(ts.map((t) => t.step)).toEqual(FRESH_SEQUENCE.steps.map((s) => s.step));
    expect(ts.every((t) => t.track === "fresh_quote")).toBe(true);
    expect(ts[0]!.body).toMatch(/came through okay|landed and made sense/);
    expect(ts.every((t) => t.flags.length === 0)).toBe(true);
  });
  it("the free round stays a backlog sweep: a 3-day-old quote is left to the salesperson", () => {
    const ds = dataset({ business: business(), customers: [customer("c1")], quotes: [quote("q1", "c1", { sentOn: ago(3) })] });
    expect(scan(ds).primary.find((x) => x.customerId === "c1")).toBeUndefined();
  });
  it("older quotes run the normal dead-quote sequence even when always-on", () => {
    const ds = dataset({ business: paying(), customers: [customer("c1")], quotes: [quote("q1", "c1", { sentOn: ago(90) })] });
    const r = scan(ds);
    const ts = planOutreach(ds, r, { startOn: ASOF }).touches;
    expect(ts.map((t) => t.step)).toEqual(SEQUENCES.unanswered_quote.steps.map((s) => s.step));
    expect(ts.some((t) => t.track === "fresh_quote")).toBe(false);
  });
  it("never tells someone we've written to before that 'that's on us for not following up'", () => {
    const ds = dataset({ business: business(), customers: [customer("c1")], quotes: [quote("q1", "c1", { sentOn: ago(200) })] });
    const r = scan(ds);
    for (let i = 0; i < 12; i++) {
      const p = planOutreach(ds, r, { startOn: ASOF, contacted: new Set(["c1"]) });
      expect(p.touches[0]?.body ?? "").not.toContain("that's on us");
    }
  });
});

describe("always-on: every new request answered within minutes", () => {
  const setup = (over = {}) => {
    const ds = dataset({ business: paying(over), customers: [customer("c1", { phones: ["+16035550142"] })], requests: [request("r1", "c1", { title: "Oak over the garage", createdOn: ASOF, createdAt: `${ASOF}T21:30:00Z`, status: "new" })] });
    return emptyState(ds, `${ASOF}T18:00:00`);
  };
  it("writes back at once, any hour, and texts the owner the lead", () => {
    const st = setup();
    const now = `${ASOF}T22:40:00`; // 10:40pm local, outside send hours
    expect(answerNewRequests(st, now)).toBe(1);
    const t = st.touches.find((x) => x.track === "new_request")!;
    expect(t.instant).toBe(true);
    expect(t.body).toMatch(/Thanks for reaching out to Ridgeline Tree Co about the oak over the garage/);
    expect(t.body).toMatch(/Dave will give you a call tomorrow/);
    expect(t.flags).toEqual([]);
    const { due } = dueTouches(st, now);
    expect(due.map((d) => d.touch.id)).toContain(t.id);
    const owner = st.ownerMessages.at(-1)!.text;
    expect(owner).toMatch(/NEW REQUEST/);
    expect(owner).toMatch(/\(603\) 555-0142/);
    expect(owner).toMatch(/We already wrote back that you'll call them tomorrow/);
    // once only
    expect(answerNewRequests(st, `${ASOF}T22:50:00`)).toBe(0);
  });
  it("skips requests that already have a quote, and does nothing on the free round", () => {
    const st = setup();
    st.dataset.quotes.push(quote("q9", "c1", { sentOn: ASOF }));
    expect(answerNewRequests(st, `${ASOF}T22:40:00`)).toBe(0);
    const trial = setup({ plan: { stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [] } });
    expect(answerNewRequests(trial, `${ASOF}T22:40:00`)).toBe(0);
  });
  it("shows the owner what always-on did this week", () => {
    const st = setup();
    answerNewRequests(st, `${ASOF}T22:40:00`);
    const t = st.touches.find((x) => x.track === "new_request")!;
    markSent(st, t.id, `${ASOF}T22:41:00`);
    expect(weeklyReport(st, ASOF)).toMatch(/Always on: answered 1 new request within minutes/);
  });
});

describe("one-tap setup: the trade is read from their own titles", () => {
  it("names every sample trade correctly, without inventing a second trade", async () => {
    const { generateSample } = await import("../src/sample/generate.ts");
    const { detectTrade } = await import("../src/trades/index.ts");
    for (const trade of ["tree", "fence", "painting", "cleaning", "septic", "lawn", "pressure_washing", "roofing", "chimney", "window_cleaning", "gutter", "pool"] as const) {
      const s = generateSample({ trade, asOf: ASOF });
      const d = detectTrade([...s.dataset.quotes.map((q) => q.title), ...s.dataset.jobs.map((j) => j.title)]);
      expect(d.trade).toBe(trade);
      expect(d.others).toEqual([]);
    }
  });
  it("fills in an unset trade on import and says so; never overrides one the operator set", async () => {
    const { adoptTrade } = await import("../src/runtime/agents.ts");
    const st = emptyState(dataset({ business: business({ trade: "general" }), quotes: Array.from({ length: 8 }, (_, i) => quote(`q${i}`, "c1", { title: ["Oak removal", "Stump grinding x3", "Prune maples"][i % 3]! })) }), `${ASOF}T10:00:00`);
    expect(adoptTrade(st, `${ASOF}T10:00:00`)).toBe(true);
    expect(st.dataset.business.trade).toBe("tree");
    expect(st.events.at(-1)!.title).toMatch(/tree service business/i);
    st.dataset.business.trade = "fence";
    expect(adoptTrade(st, `${ASOF}T10:00:00`)).toBe(false);
  });
});

describe("the money-on-the-table reveal uses only their own numbers", () => {
  it("states what goes quiet every month and, only when they gave one, the lead spend wasted", async () => {
    const { summarize } = await import("../src/breakage/forecast.ts");
    const quotes = Array.from({ length: 24 }, (_, i) => quote(`q${i}`, `c${i}`, { sentOn: ago(20 + i * 12), total: 1000, status: i % 2 ? "awaiting_response" : "converted" }));
    const customers = quotes.map((q) => customer(q.customerId));
    const ds = dataset({ business: business(), customers, quotes });
    const s = summarize(ds, scan(ds));
    expect(s.onTheTable.perMonth.shareOfQuoted).toBeCloseTo(0.5, 1);
    expect(s.onTheTable.line).toMatch(/cents of every quoted dollar/);
    expect(s.onTheTable.wastedLeadSpend).toBeUndefined();
    const withCost = dataset({ business: business({ leadCost: 100 }), customers, quotes });
    const s2 = summarize(withCost, scan(withCost));
    expect(s2.onTheTable.wastedLeadSpend).toBeGreaterThan(0);
    expect(s2.onTheTable.line).toMatch(/leads you paid for/);
  });
});
