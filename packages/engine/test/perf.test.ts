/**
 * Regression guard, not a benchmark: a big shop's full history (10k+ quotes) must scan, summarize and
 * plan fast enough to run on every import. Limits are generous (roughly 2-3x what a laptop takes);
 * a failure here means something went quadratic.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { scan, type ScanResult } from "../src/breakage/detect.ts";
import { summarize } from "../src/breakage/forecast.ts";
import { planOutreach } from "../src/cadence/plan.ts";
import { generateSample } from "../src/sample/generate.ts";
import type { Dataset } from "../src/model.ts";
import { ASOF } from "./fixtures.ts";

/** Best of `runs` timings, so one GC pause or a busy neighbour in a parallel run doesn't fail the guard. */
function timed<T>(f: () => T, runs = 2): { value: T; ms: number } {
  let best = Infinity;
  let value!: T;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    value = f();
    best = Math.min(best, performance.now() - t0);
  }
  return { value, ms: best };
}

describe("performance on a 10,000+ quote shop", () => {
  let ds: Dataset;
  let result: ScanResult;

  beforeAll(() => {
    // 300 quotes a month for three years, plus the clients, jobs, invoices and requests that go with them
    ds = generateSample({ trade: "tree", asOf: ASOF, quotesPerMonth: 300, seed: "perf" }).dataset;
    // warm the JIT so the first measured run isn't paying for compilation
    scan(ds);
  }, 60_000);

  it("is really that big", () => {
    expect(ds.quotes.length).toBeGreaterThanOrEqual(10_000);
    expect(ds.customers.length).toBeGreaterThanOrEqual(5_000);
    expect(ds.jobs.length).toBeGreaterThanOrEqual(5_000);
    expect(ds.invoices.length).toBeGreaterThanOrEqual(5_000);
  });

  it("scans in under 3 seconds", () => {
    const { value, ms } = timed(() => scan(ds));
    result = value;
    expect(result.opportunities.length).toBeGreaterThan(5_000);
    expect(ms).toBeLessThan(3_000);
  });

  it("summarizes in under 1 second", () => {
    const { value, ms } = timed(() => summarize(ds, result), 3);
    expect(value.reachablePeople).toBeGreaterThan(1_000);
    expect(ms).toBeLessThan(1_000);
  });

  it("plans 150 people in under 2 seconds", () => {
    const { value, ms } = timed(() => planOutreach(ds, result, { startOn: "2026-10-06", limitPeople: 150 }), 3);
    expect(value.people).toHaveLength(150);
    expect(ms).toBeLessThan(2_000);
  });

  it("plans the whole list for a paying account in under 5 seconds", () => {
    const paying = { ...ds, business: { ...ds.business, plan: { ...ds.business.plan, stage: "paying" as const } } };
    const { value, ms } = timed(() => planOutreach(paying, result, { startOn: "2026-10-06" }));
    expect(value.people.length).toBeGreaterThan(1_000);
    expect(ms).toBeLessThan(5_000);
  });
});
