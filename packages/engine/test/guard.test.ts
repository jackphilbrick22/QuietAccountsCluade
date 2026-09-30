import { describe, expect, it } from "vitest";
import { answerNewRequests, clearBrake, closeIfDue, dropStaleAnswers, dueTouches, find, HELD_FOR_GOOD, markSent, planBatch, receiveReply, sendHealth } from "../src/runtime/agents.ts";
import { emptyState, type AccountState } from "../src/runtime/state.ts";
import type { Reply, Touch } from "../src/model.ts";
import { ASOF, ago, business, customer, dataset, quote, request } from "./fixtures.ts";

/**
 * The Guard's stops: nothing queued goes to someone who can't be written to any more, a stale "Dave will call
 * you today" never goes out days late, a thank-you to our thank-you doesn't start another hand-off, and the
 * send brake is visible, clearable and never blocks the free round's close for good.
 */
const START = "2026-09-30"; // Wednesday, a send day

function planned(n = 3): AccountState {
  const people = Array.from({ length: n }, (_, i) => customer(`c${i + 1}`, { name: `Pat Lee${i + 1}`, firstName: "Pat" }));
  const ds = dataset({ customers: people, quotes: people.map((c, i) => quote(`q${i + 1}`, c.id, { sentOn: ago(60 + i) })) });
  const st = emptyState(ds, `${ASOF}T12:00:00`);
  find(st, `${ASOF}T12:00:00`);
  planBatch(st, `${ASOF}T12:00:00`, { startOn: START, approve: true });
  return st;
}
const of = (st: AccountState, customerId: string) => st.touches.filter((t) => t.customerId === customerId).sort((a, b) => a.step - b.step);
const firstDue = (st: AccountState) => st.touches.filter((t) => t.step === 1).map((t) => t.dueAt).sort()[0]!;

describe("queued notes stop when a person can't be written to any more", () => {
  it("the owner turned their follow-ups off in Jobber (do not contact): nothing more goes, and it is cancelled for good", () => {
    const st = planned();
    const c1 = st.dataset.customers.find((c) => c.id === "c1")!;
    c1.doNotContact = true;
    const { due, held } = dueTouches(st, of(st, "c1")[0]!.dueAt);
    expect(due.some((d) => d.touch.customerId === "c1")).toBe(false);
    const why = held.find((h) => h.touch.customerId === "c1")!.why;
    expect(why).toMatch(HELD_FOR_GOOD);
  });

  it("follow-ups never go when note 1 didn't (no fake 'Re:' as a first contact)", () => {
    const st = planned(1);
    const [n1, n2] = of(st, "c1");
    n1!.status = "skipped";
    const later = n2!.dueAt;
    const { due, held } = dueTouches(st, later);
    expect(due.map((d) => d.touch.id)).not.toContain(n2!.id);
    expect(held.find((h) => h.touch.id === n2!.id)!.why).toMatch(HELD_FOR_GOOD);
    // a note 1 that is merely late holds its follow-up without cancelling it
    n1!.status = "approved";
    n1!.dueAt = `${n2!.dueAt.slice(0, 10)}T23:59`;
    const h2 = dueTouches(st, later).held.find((h) => h.touch.id === n2!.id)!;
    expect(h2.why).not.toMatch(HELD_FOR_GOOD);
  });

  it("a note that lost a required element (stop line, address) is held, not sent", () => {
    const st = planned(1);
    const n1 = of(st, "c1")[0]!;
    n1.flags = ["Missing the stop line (required)", "Missing the business address (required)"];
    const { due, held } = dueTouches(st, firstDue(st));
    expect(due).toEqual([]);
    expect(held.find((h) => h.touch.id === n1.id)!.why).toMatch(/required check/);
  });
});

describe("answers to new requests are never sent late", () => {
  const paying = { plan: { stage: "paying" as const, trialSize: 150, monthlyPrice: 497, freeMonths: [], paidOn: ago(40) } };
  const setup = () => emptyState(dataset({ business: paying, customers: [customer("c1", { phones: ["+16035550142"] })], requests: [request("r1", "c1", { title: "Oak over the garage", createdOn: ASOF, createdAt: `${ASOF}T14:30:00Z` })] }), `${ASOF}T12:00:00`);

  it("while sending is paused nothing is queued, and the owner is told to call rather than that we wrote back", () => {
    const st = setup();
    expect(answerNewRequests(st, `${ASOF}T10:40:00`, { paused: true })).toBe(1);
    expect(st.touches).toEqual([]);
    const owner = st.ownerMessages.at(-1)!.text;
    expect(owner).toMatch(/NEW REQUEST/);
    expect(owner).not.toMatch(/wrote back|we'll write back/);
    expect(owner).toMatch(/call them/i);
    // and the next sync doesn't text the same request again
    expect(answerNewRequests(st, `${ASOF}T11:40:00`, { paused: true })).toBe(0);
  });

  it("one that sat through a pause is dropped, not sent days later, and the owner hears it didn't go", () => {
    const st = setup();
    answerNewRequests(st, `${ASOF}T10:40:00`);
    const t = st.touches[0]!;
    const later = "2026-10-01T10:00";
    const h = dueTouches(st, later).held.find((x) => x.touch.id === t.id)!;
    expect(h.why).toMatch(HELD_FOR_GOOD);
    const dropped = dropStaleAnswers(st, `${later}:00`);
    expect(dropped.map((x) => x.id)).toEqual([t.id]);
    expect(t.status).toBe("cancelled");
    expect(st.ownerMessages.at(-1)!.text).toMatch(/didn't go out/);
  });

  it("one whose request was quoted in the meantime is dropped too", () => {
    const st = setup();
    answerNewRequests(st, `${ASOF}T10:40:00`);
    st.dataset.requests[0]!.quoteId = "q9";
    expect(dueTouches(st, `${ASOF}T10:45`).held[0]!.why).toMatch(HELD_FOR_GOOD);
  });
});

describe("replies", () => {
  it("a thank-you to our instant answer joins the lead: no second answer, no second hand-off", () => {
    const st = planned(1);
    const n1 = of(st, "c1")[0]!;
    markSent(st, n1.id, `${START}T09:00:00`, "<n1@qa>");
    const first = receiveReply(st, { from: "c1@gmail.com", text: "Yes please, call me about the maples.", receivedAt: `${START}T10:00:00`, inReplyTo: "<n1@qa>" });
    expect(first.ack).toBeDefined();
    const handoffs = st.ownerMessages.filter((m) => m.kind === "handoff").length;
    const again = receiveReply(st, { from: "c1@gmail.com", text: "ok thanks", receivedAt: `${START}T10:20:00` });
    expect(again.ack).toBeUndefined();
    expect(again.followUpOf).toBe(first.id);
    expect(again.status).toBe("done");
    expect(st.ownerMessages.filter((m) => m.kind === "handoff").length).toBe(handoffs);
    expect(st.ownerMessages.at(-1)!.text).toMatch(/ok thanks/);
  });

  it("the same reply delivered twice is read once", () => {
    const st = planned(1);
    const msg = { from: "c1@gmail.com", text: "Yes, still want it. Call me.", receivedAt: `${START}T10:00:00` };
    const a = receiveReply(st, msg);
    const texts = st.ownerMessages.length;
    const b = receiveReply(st, msg);
    expect(b.id).toBe(a.id);
    expect(st.replies.filter((r) => r.id === a.id)).toHaveLength(1);
    expect(st.ownerMessages.length).toBe(texts);
  });

  it("a stop from another address in our thread stops the person we wrote to", () => {
    const st = planned(1);
    const n1 = of(st, "c1")[0]!;
    markSent(st, n1.id, `${START}T09:00:00`, "<n1@qa>");
    const r = receiveReply(st, { from: "pat.work@company.com", text: "Please stop emailing me.", receivedAt: `${START}T11:00:00`, inReplyTo: "<n1@qa>" });
    expect(r.customerId).toBe("c1");
    expect(st.suppressions["c1@gmail.com"]).toBe("unsubscribed");
    expect(st.suppressions["pat.work@company.com"]).toBe("unsubscribed");
    expect(of(st, "c1").filter((t) => t.status === "approved")).toEqual([]);
  });
});

describe("the send brake", () => {
  function braked(): AccountState {
    const st = planned(2);
    const c = st.dataset.customers[0]!;
    for (let i = 0; i < 146; i++)
      st.touches.push({ id: `sent-${i}`, opportunityId: `o-${i}`, customerId: c.id, channel: "email", step: 1, angle: "check_in", dueAt: `${START}T08:00`, status: "sent", sentAt: `${START}T08:00:00`, body: "x", flags: [] } as Touch);
    const wrong = (id: string): Reply => ({ id, customerId: c.id, channel: "email", receivedAt: `${START}T12:00:00`, from: "x@y.com", text: "who is this", intent: "wrong_person", confidence: 1, extracted: {}, status: "done" });
    st.replies.push(wrong("w1"), wrong("w2"));
    return st;
  }

  it("an operator can clear it; it trips again only on new problems", () => {
    const st = braked();
    expect(sendHealth(st).paused).toBe(true);
    clearBrake(st, `${START}T13:00:00`, "operator");
    expect(sendHealth(st).paused).toBe(false);
    expect(st.events.at(-1)!.title).toMatch(/brake cleared/i);
  });

  it("doesn't hold the free round's close forever: after a week the round ends and the close goes", () => {
    const st = braked();
    const queued = st.touches.filter((t) => t.status === "approved").length;
    expect(queued).toBeGreaterThan(0);
    expect(closeIfDue(st, "2026-10-09T09:00:00")).toBeDefined();
    expect(st.touches.filter((t) => t.status === "approved")).toEqual([]);
  });
});
