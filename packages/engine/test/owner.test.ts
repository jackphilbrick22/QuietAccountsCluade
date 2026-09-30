import { describe, expect, it } from "vitest";
import { scan } from "../src/breakage/detect.ts";
import { ackFor, closeMessage, earlyLeaveRefund, guaranteeCheck, handoffText, yearFloor } from "../src/reports/owner.ts";
import { billingCheck, cancelPlan, renewPlan, renewalIfDue, undoCancel } from "../src/runtime/agents.ts";
import { emptyState, type AccountState } from "../src/runtime/state.ts";
import type { BreakageType, Recovery, Reply, ReplyIntent, Touch } from "../src/model.ts";
import { ASOF, ago, customer, dataset, job, oneOpp, quote, request } from "./fixtures.ts";

/**
 * The texts the owner acts on. They show the real record (date and amount) so the owner calls back with
 * the right number, and counts that mean what they say.
 */
function account(): AccountState {
  const ds = dataset({
    customers: [
      customer("c1", { name: "Holly Grant", firstName: "Holly" }),
      customer("c2", { name: "Ray Evans", firstName: "Ray" }),
      customer("c3", { name: "Mr. and Mrs. Evans", firstName: "" }),
      customer("c4", { name: "Pat Moore", firstName: "Pat" }),
    ],
    quotes: [quote("q1", "c1", { title: "Remove leaning birch by driveway", total: 2400, sentOn: "2026-07-14", number: "1182" })],
    jobs: [
      job("j2", "c2", { title: "Oak removal + stump", total: 4600, completedOn: "2025-02-12" }),
      job("j4", "c4", { title: "Deep root fertilization", total: 400, completedOn: "2025-09-10" }),
    ],
    requests: [request("r3", "c3", { title: "Spruce leaning toward house", createdOn: ago(40) })],
  });
  const st = emptyState(ds, `${ASOF}T12:00:00Z`);
  st.scan = scan(ds);
  return st;
}

function reply(st: AccountState, customerId: string, type: BreakageType, intent: ReplyIntent = "wants_it"): Reply {
  const o = oneOpp(st.scan!, customerId, type);
  return { id: `rep-${customerId}`, customerId, opportunityId: o.id, channel: "email", receivedAt: `${ASOF}T10:00:00`, from: `${customerId}@gmail.com`, text: "Yes, still need it.", intent, confidence: 0.9, extracted: {}, status: "new" };
}

describe("the hand-off text", () => {
  it("a past customer shows the real job: its date and its total, not a modelled 60%", () => {
    const st = account();
    const text = handoffText(st, reply(st, "c2", "one_and_done"));
    expect(text).toContain("Last job: Feb 12, 2025 · $4,600 · Oak removal + stump");
    expect(text).not.toContain("$2,760");
    expect(text).not.toMatch(/Original:/);
  });
  it("a quote shows the quote as sent", () => {
    const st = account();
    expect(handoffText(st, reply(st, "c1", "unanswered_quote"))).toContain("Quote #1182: Jul 14 · $2,400 · birch by the driveway");
  });
  it("a request that never got a price says so, with no made-up amount", () => {
    const st = account();
    const text = handoffText(st, reply(st, "c3", "unquoted_request"));
    expect(text).toContain("Request: Aug 20 · never priced · spruce over the house");
    expect(text.split("\n")[1]).not.toMatch(/\$/);
  });
  it("work that came due shows when it was last done, not the due date", () => {
    const st = account();
    expect(handoffText(st, reply(st, "c4", "service_due"))).toContain("Last done: Sep 10, 2025 · $400 · Deep root fertilization");
  });
});

describe("the instant answer to 'how much?'", () => {
  it("promises an updated price only when there was a price", () => {
    const st = account();
    expect(ackFor(st, reply(st, "c1", "unanswered_quote", "wants_price"))!.text).toContain("get you an updated price.");
    for (const [c, type] of [["c2", "one_and_done"], ["c3", "unquoted_request"]] as const) {
      const text = ackFor(st, reply(st, c, type, "wants_price"))!.text;
      expect(text).toContain("get you a price.");
      expect(text).not.toMatch(/updated/);
    }
  });
  it("never thanks a household by a made-up first name", () => {
    const st = account();
    expect(ackFor(st, reply(st, "c3", "unquoted_request"))!.text).toMatch(/^Thanks\. /);
  });
});

describe("the close after the free round", () => {
  function round(people: number, notesEach: number, booked: number): AccountState {
    const st = account();
    st.dataset.business.plan.trialSize = 150;
    const ids = Array.from({ length: people }, (_, i) => `p${i}`);
    st.dataset.customers.push(...ids.map((id, i) => customer(id, { name: `Person ${i + 1}`, firstName: `P${i}` })));
    st.touches = ids.flatMap((id) =>
      Array.from({ length: notesEach }, (_, k): Touch => ({ id: `t-${id}-${k}`, opportunityId: `o-${id}`, customerId: id, channel: "email", step: k + 1, angle: "check_in", dueAt: `${ASOF}T09:00`, status: "sent", body: "", flags: [] })),
    );
    st.recoveries = ids.slice(0, booked).map((id, i): Recovery => ({ id: `rec-${i}`, customerId: id, record: { kind: "job", id: `j-${i}` }, value: 1000, cameBackOn: ASOF, match: "owner_reported", confidence: 1, tier: "traced" }));
    return st;
  }
  it("counts notes as notes and people as people", () => {
    const text = closeMessage(round(5, 3, 1));
    expect(text).toContain("From 15 notes to 5 people,");
  });
  it("names up to four, then says how many more", () => {
    const text = closeMessage(round(12, 2, 7));
    expect(text).toContain("put 7 jobs back on your calendar, $7,000: Person 1, Person 2, Person 3, Person 4 +3 more.");
    expect(closeMessage(round(12, 2, 3))).toContain(": Person 1, Person 2 and Person 3.");
  });
});

describe("the guarantee text", () => {
  it("says a date, never 'since a few weeks ago'", () => {
    const st = account();
    st.dataset.business.plan = { ...st.dataset.business.plan, stage: "paying", paidOn: "2026-08-29" };
    const g = guaranteeCheck(st, "2026-09-29")!;
    expect(g.text).toMatch(/since August 29\b/);
    expect(g.text).not.toMatch(/since (a few weeks ago|last week|earlier)/);
  });
  it("counts only people we followed up with, not answers to their own new request", () => {
    const st = account();
    st.dataset.business.plan = { ...st.dataset.business.plan, stage: "paying", paidOn: "2026-08-29" };
    const note = (id: string, customerId: string, track?: Touch["track"]): Touch => ({ id, opportunityId: track === "new_request" ? `req:${id}` : `o-${id}`, customerId, channel: "email", step: 1, angle: "check_in", dueAt: "2026-09-02T09:00", sentAt: "2026-09-02T09:00", status: "sent", body: "", flags: [], ...(track ? { track } : {}) });
    st.touches = [note("t1", "c1"), note("t2", "c2", "new_request")];
    const wants = (id: string, customerId: string, touchId?: string): Reply => ({ id, customerId, touchId, from: `${customerId}@x.com`, receivedAt: "2026-09-10T10:00:00Z", text: "Yes, can you come out?", intent: "wants_it", extracted: {}, status: "handed_off" }) as Reply;
    // the new-request person wrote back: still a free month
    st.replies = [wants("r2", "c2", "t2")];
    expect(guaranteeCheck(st, "2026-09-29")!.free).toBe(true);
    expect(guaranteeCheck(st, "2026-09-29")!.text).toContain("nobody we followed up with asked");
    // someone from the follow-ups asked: the month is earned
    st.replies.push(wants("r1", "c1", "t1"));
    const g = guaranteeCheck(st, "2026-09-29")!;
    expect(g.free).toBe(false);
    expect(g.asked.map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("leaving a yearly plan early", () => {
  const yearly = (traced: number) => {
    const st = account();
    st.dataset.business.plan = { ...st.dataset.business.plan, stage: "paying", billing: "annual", paidOn: "2026-06-01", yearsPaidOn: ["2026-06-01"], freeMonths: ["2026-07-01"] };
    if (traced) st.recoveries = [{ id: "rec1", customerId: "c1", record: { kind: "job", id: "j9" }, value: traced, cameBackOn: "2026-08-10", match: "reply", confidence: 1, tier: "traced" } as unknown as Recovery];
    return st;
  };
  it("never costs more than monthly would have: four months used, one quiet, three charged at $497", () => {
    const r = earlyLeaveRefund(yearly(3000), "2026-09-15")!;
    expect(r).toMatchObject({ monthsUsed: 4, quiet: 1, paid: 4555.83, asMonthly: 1491, traced: 3000 });
    expect(r.refund).toBe(3064.83);
  });
  it("and never more than the jobs on the ledger in those months (the year floor)", () => {
    expect(earlyLeaveRefund(yearly(800), "2026-09-15")!.refund).toBe(3755.83);
    expect(earlyLeaveRefund(yearly(0), "2026-09-15")!.refund).toBe(4555.83);
  });
  it("is only for a paid year that's still running, whatever the billing says now", () => {
    const st = yearly(0);
    expect(earlyLeaveRefund(st, "2027-06-02")).toBeUndefined();
    // they texted MONTHLY (it takes effect at the year's end): the paid year still runs and still refunds
    st.dataset.business.plan = { ...st.dataset.business.plan, billing: "monthly", paidOn: "2027-06-01" };
    expect(earlyLeaveRefund(st, "2026-09-15")!.refund).toBe(4555.83);
    // month to month from the start: nothing paid ahead, nothing to refund
    st.dataset.business.plan = { ...st.dataset.business.plan, yearsPaidOn: undefined, paidOn: "2026-06-01" };
    expect(earlyLeaveRefund(st, "2026-09-15")).toBeUndefined();
  });
  it("counts quiet months by the period they end: last year's last month isn't this year's", () => {
    const st = yearly(0);
    st.dataset.business.plan = { ...st.dataset.business.plan, paidOn: "2025-06-01", yearsPaidOn: ["2025-06-01", "2026-06-01"], freeMonths: ["2026-06-01"] };
    // 2026-06-01 closes the 2025 year's last month, so the 2026 year has no quiet month yet
    expect(earlyLeaveRefund(st, "2026-09-15")).toMatchObject({ yearStart: "2026-06-01", quiet: 0, paid: 4970 });
  });
  it("a quiet month recorded two days ahead of its charge is counted, so it isn't refunded twice", () => {
    const st = yearly(0);
    st.dataset.business.plan = { ...st.dataset.business.plan, paidOn: "2025-01-15", yearsPaidOn: ["2025-01-15"], freeMonths: ["2025-03-15"] };
    const r = earlyLeaveRefund(st, "2025-03-14")!;
    // $414.17 already comes back for the quiet month; this refund plus that one is exactly what was paid
    expect(r.refund + 414.17).toBeCloseTo(4970, 2);
  });
});

describe("the year floor and settling a year", () => {
  const paidYear = () => {
    const st = account();
    st.dataset.business.plan = { ...st.dataset.business.plan, stage: "paying", billing: "annual", paidOn: "2025-01-15", yearsPaidOn: ["2025-01-15"], freeMonths: ["2026-01-15"] };
    st.recoveries = [{ id: "rec1", customerId: "c1", record: { kind: "job", id: "j9" }, value: 3000, cameBackOn: "2025-06-10", match: "reply", confidence: 1, tier: "traced" } as unknown as Recovery];
    return st;
  };
  it("the year's last quiet month (charged at the year's end) belongs to that year", () => {
    const f = yearFloor(paidYear(), "2025-01-15");
    expect(f).toMatchObject({ paid: 4555.83, traced: 3000, refund: 1555.83 });
  });
  it("settles a year once, even after the text about it is no longer loaded, and holds the refund for the operator", () => {
    const st = paidYear();
    renewalIfDue(st, "2026-01-16T09:00:00");
    expect(st.ownerMessages.find((x) => x.kind === "refund")!.text).toContain("$1,555.83 goes back to your card");
    expect(st.dataset.business.plan.settledYears).toEqual(["2025-01-15"]);
    st.ownerMessages = [];
    renewalIfDue(st, "2026-01-17T09:00:00");
    expect(st.ownerMessages.filter((x) => x.kind === "refund")).toHaveLength(0);
    expect(st.dataset.business.plan.yearRefunds).toHaveLength(1);
  });
});

describe("cancel and undo put back exactly what they changed", () => {
  it("planned stays planned, the wait for the owner's OK comes back, and a paused owner stays paused", () => {
    const st = account();
    st.touches = [
      { id: "t1", opportunityId: "o1", customerId: "c1", channel: "email", step: 1, angle: "check_in", dueAt: "2026-10-01T09:00", status: "planned", body: "", flags: [] },
      { id: "t2", opportunityId: "o2", customerId: "c2", channel: "email", step: 1, angle: "check_in", dueAt: "2026-10-01T09:00", status: "approved", body: "", flags: [], providerId: "lead-2" },
    ] as Touch[];
    st.awaitingOwnerOk = "2026-09-29T10:00:00";
    cancelPlan(st, "2026-09-29T11:00:00", { paused: true });
    expect(st.awaitingOwnerOk).toBeUndefined();
    const r = undoCancel(st, "2026-09-29T15:00:00") as { restored: number; paused: boolean };
    expect(r).toEqual({ restored: 2, stopped: 0, paused: true });
    expect(st.touches.map((t) => t.status)).toEqual(["planned", "approved"]);
    // the platform's copy was taken back at the cancel: pushed again on the next sync
    expect(st.touches[1]!.providerId).toBeUndefined();
    expect(st.awaitingOwnerOk).toBe("2026-09-29T10:00:00");
  });
  it("never undoes a cancel that set up a yearly refund, and not after a day", () => {
    const st = account();
    st.dataset.business.plan = { ...st.dataset.business.plan, stage: "paying", billing: "annual", paidOn: "2026-06-01", yearsPaidOn: ["2026-06-01"], freeMonths: [] };
    cancelPlan(st, "2026-09-15T10:00:00");
    expect(undoCancel(st, "2026-09-15T11:00:00")).toEqual({ refused: "refund" });
    const m = account();
    cancelPlan(m, "2026-09-15T10:00:00");
    expect(undoCancel(m, "2026-09-16T10:30:00")).toEqual({ refused: "late" });
  });
});

describe("review 4: the paid year and a platform undo", () => {
  it("after MONTHLY mid-year, the paid year's last month is still judged, and a quiet one comes back", () => {
    const st = account();
    st.dataset.business.plan = { ...st.dataset.business.plan, stage: "paying", billing: "annual", paidOn: "2026-10-01", yearsPaidOn: ["2026-10-01"], freeMonths: [] };
    renewPlan(st, "monthly", "2027-09-05T10:00:00");
    expect(st.dataset.business.plan.paidOn).toBe("2027-10-01");
    expect(guaranteeCheck(st, "2027-09-29")!.chargeOn).toBe("2027-10-01");
    const m = billingCheck(st, "2027-09-29T09:00:00");
    expect(m?.kind).toBe("free_month");
    expect(m!.text).toContain("goes back to your card");
    expect(st.dataset.business.plan.freeMonths).toEqual(["2027-10-01"]);
  });
  it("UNDO on a sending platform restores sequences from their first note and says which stay stopped", () => {
    const st = account();
    const n = (id: string, opp: string, step: number, status: Touch["status"], customerId: string): Touch => ({ id, opportunityId: opp, customerId, channel: "email", step, angle: "check_in", dueAt: "2026-10-01T09:00", status, body: "", flags: [], providerId: `instantly:c:${id}` }) as Touch;
    st.touches = [n("a1", "oa", 1, "sent", "c1"), n("a2", "oa", 2, "approved", "c1"), n("b1", "ob", 1, "approved", "c2")];
    cancelPlan(st, "2026-09-29T10:00:00");
    const r = undoCancel(st, "2026-09-29T11:00:00", { platform: true }) as { restored: number; stopped: number };
    expect(r).toMatchObject({ restored: 1, stopped: 1 });
    expect(st.touches.map((t) => t.status)).toEqual(["sent", "cancelled", "approved"]);
    expect(st.touches[2]!.providerId).toBeUndefined();
  });
});
