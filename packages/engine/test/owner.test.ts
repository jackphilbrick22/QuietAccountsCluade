import { describe, expect, it } from "vitest";
import { scan } from "../src/breakage/detect.ts";
import { ackFor, closeMessage, earlyLeaveRefund, guaranteeCheck, handoffText } from "../src/reports/owner.ts";
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
  it("is only for a yearly plan inside its year", () => {
    const st = yearly(0);
    expect(earlyLeaveRefund(st, "2027-06-02")).toBeUndefined();
    st.dataset.business.plan.billing = "monthly";
    expect(earlyLeaveRefund(st, "2026-09-15")).toBeUndefined();
  });
});
