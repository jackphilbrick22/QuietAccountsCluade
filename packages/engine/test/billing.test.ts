import { describe, expect, it } from "vitest";
import { billableBookings } from "../src/ledger/billable.ts";
import { approveCharge, cardOnFile, chargeId, chargePaid, chargeFailed, chargeRefunded, chargeStarted, chargeTold, CHARGE_REF, decideCharge, linkAgain, markPaidOutside, nextBusinessDay, notOurs, paidTwice, redateCharge, settleCharges, type BillingOpts } from "../src/runtime/charges.ts";
import { cancelPlan, ledgerPass, markContacted, receiveReply, undoCancel } from "../src/runtime/agents.ts";
import { emptyState, type AccountState } from "../src/runtime/state.ts";
import { leadCode, passEndText, passTouches } from "../src/reports/owner.ts";
import { onePassPlan } from "../src/plans.ts";
import type { Job, PlanState, Quote, Recovery, Reply, Touch, TradeId } from "../src/model.ts";
import { addDays } from "../src/util.ts";
import { bookingNames } from "../src/ledger/attribution.ts";
import { customer, dataset, job, quote } from "./fixtures.ts";

/** BRIEF §2 and B4: what a one pass bills (six rules, two variants), and the charge log that bills it. */

/** A Monday: the pass's first send day. */
const START = "2026-10-05";
const STRIPE: BillingOpts = { stripe: true, payLink: (id) => `https://qa.test/pay/${id}` };
const BY_HAND: BillingOpts = { stripe: false };

/** A one pass on `n` people, each written to on START, nothing replied or booked yet. */
function pass(n: number, plan: Partial<PlanState> = {}, opts: { trade?: TradeId; spread?: boolean } = {}): AccountState {
  const customers = Array.from({ length: n }, (_, i) => customer(`c${i}`, { name: `Person ${i}`, firstName: `P${i}`, lastName: `L${i}` }));
  const ds = dataset({ customers, business: { trade: opts.trade ?? "tree" } });
  ds.business.plan = onePassPlan({ startedOn: START, targetEndOn: addDays(START, 30), ...plan });
  const st = emptyState(ds, `${START}T09:00:00`);
  // spread: a minute apart, in list order
  customers.forEach((c, i) => st.touches.push(note(c.id, 1, START, opts.spread ? { sentAt: new Date(Date.parse(`${START}T08:00:00Z`) + i * 60_000).toISOString().slice(0, 19) } : {})));
  return st;
}

function note(customerId: string, step: number, on: string, over: Partial<Touch> = {}): Touch {
  return { id: `t-${customerId}-${step}${over.track ?? ""}`, opportunityId: `o-${customerId}`, customerId, channel: "email", step, angle: "check_in", dueAt: `${on}T08:00`, sentAt: `${on}T08:00:00`, status: "sent", body: "", flags: [], ...over };
}

/** `cid` wrote back on `on`: a real answer unless `intent` says otherwise, handed to the owner when it's a yes. */
function wrote(st: AccountState, cid: string, on: string, intent: Reply["intent"] = "wants_it", over: Partial<Reply> = {}): Reply {
  const hot = intent === "wants_it" || intent === "wants_price";
  const r: Reply = { id: `r-${cid}-${on}`, customerId: cid, touchId: `t-${cid}-1`, channel: "email", receivedAt: `${on}T10:00:00`, from: `${cid}@gmail.com`, text: "Hi", intent, confidence: 0.9, extracted: {}, status: hot ? "handed_off" : "done", ...(hot ? { handedOffAt: `${on}T10:05:00` } : {}), ...over };
  st.replies.push(r);
  return r;
}

/** A booking on the ledger for `cid`, made on `on`. */
function booked(st: AccountState, cid: string, on: string, over: Partial<Recovery> = {}): Recovery {
  const r: Recovery = { id: `rec-${cid}-${on}`, customerId: cid, record: { kind: "job", id: `j-${cid}-${on}` }, value: 1800, cameBackOn: on, match: "customer_id", confidence: 0.9, tier: "traced", ...over };
  st.recoveries.push(r);
  return r;
}

/** `n` customers who wrote back on Oct 8 and booked on Oct 20 (c0 first). */
function bookings(st: AccountState, n: number, from = 0): void {
  for (let i = from; i < from + n; i++) {
    wrote(st, `c${i}`, "2026-10-08");
    booked(st, `c${i}`, addDays("2026-10-20", i - from));
  }
}

const ids = (xs: { customerId: string }[]) => xs.map((x) => x.customerId);
const why = (st: AccountState, cid: string) => billableBookings(st).not.find((x) => x.customerId === cid)?.why;
const charge = (st: AccountState, cid: string) => st.dataset.business.plan.charges!.find((c) => c.customerId === cid)!;
const textOf = (st: AccountState, cid: string) => st.ownerMessages.filter((m) => m.refs?.some((r) => r.kind === CHARGE_REF && r.id === charge(st, cid).id));
/** The saved card's Checkout: what the webhook passes on. */
const checkout = { customer: "cus_1", paymentIntent: "pi_1", paymentMethod: "pm_1", brand: "visa", last4: "4242" };

describe("billable bookings: the six rules", () => {
  it("1. a real reply to one of the pass's notes: never a stop, a no, a wrong person, a complaint, an out-of-office or a bounce", () => {
    const st = pass(8);
    const intents: Reply["intent"][] = ["stop", "not_interested", "wrong_person", "complaint", "auto_reply", "bounce"];
    intents.forEach((intent, i) => {
      wrote(st, `c${i}`, "2026-10-08", intent);
      booked(st, `c${i}`, "2026-10-20");
    });
    // someone who never wrote back, and one who asked a question (a real reply)
    booked(st, "c6", "2026-10-20");
    wrote(st, "c7", "2026-10-08", "question");
    booked(st, "c7", "2026-10-20");
    expect(ids(billableBookings(st).billable)).toEqual(["c7"]);
    expect(why(st, "c0")).toBe("They only wrote back to stop, say no or bounce");
    expect(why(st, "c6")).toBe("Never wrote back to the pass's notes");
  });

  it("1. a 'stop' replier who books isn't billable, even after a yes before it… unless the yes came first", () => {
    const st = pass(2);
    wrote(st, "c0", "2026-10-08", "stop");
    booked(st, "c0", "2026-10-20");
    // a yes, then a stop: the yes was a real reply
    wrote(st, "c1", "2026-10-08");
    wrote(st, "c1", "2026-10-09", "stop");
    booked(st, "c1", "2026-10-20");
    expect(ids(billableBookings(st).billable)).toEqual(["c1"]);
  });

  it("1. never a reply to a new-request answer, nor one to a note from before the pass", () => {
    const st = pass(3);
    st.touches.push(note("c0", 1, START, { id: "t-req", track: "new_request" }));
    wrote(st, "c0", "2026-10-08", "wants_it", { touchId: "t-req" });
    booked(st, "c0", "2026-10-20");
    wrote(st, "c1", "2026-10-08", "wants_it", { touchId: undefined, opportunityId: "req:r1" });
    booked(st, "c1", "2026-10-20");
    // a free round's note in September, answered then
    st.touches.push(note("c2", 1, "2026-09-10", { id: "t-free" }));
    wrote(st, "c2", "2026-09-12", "wants_it", { touchId: "t-free" });
    booked(st, "c2", "2026-10-20");
    expect(billableBookings(st).billable).toEqual([]);
  });

  it("1. a reply read before its note's sent event still counts: the note it stopped was the pass's", () => {
    const st = pass(1);
    st.touches.push(note("c0", 2, "2026-10-09", { status: "approved", sentAt: undefined }));
    // the platform sent note 2 and he answered it; his reply is read first, and stops that note
    receiveReply(st, { from: "c0@gmail.com", subject: "Re: your oak", text: "Yes please, when can you come?", receivedAt: "2026-10-09T11:00:00", touchId: "t-c0-2" });
    expect(st.touches[1]!.status).toBe("cancelled");
    // (its late sent event can't mark it now: the server marks only a note still queued)
    booked(st, "c0", "2026-10-20");
    const [hit] = billableBookings(st).billable;
    expect(hit).toMatchObject({ customerId: "c0", on: "2026-10-20" });
    expect(hit!.replyId).toBe(st.replies[0]!.id);
  });

  it("2. booked within 60 days of the first real reply: day 60 is, day 61 isn't", () => {
    const st = pass(2);
    wrote(st, "c0", "2026-10-08");
    booked(st, "c0", addDays("2026-10-08", 60));
    wrote(st, "c1", "2026-10-08");
    // a later reply doesn't restart the window
    wrote(st, "c1", "2026-11-20", "question");
    booked(st, "c1", addDays("2026-10-08", 61));
    expect(ids(billableBookings(st).billable)).toEqual(["c0"]);
    expect(why(st, "c1")).toBe("Booked 61 days after they wrote back (more than 60)");
  });

  it("2. the booking's date is the day it was made, not the work: a spring job booked in November bills", () => {
    const st = pass(2);
    wrote(st, "c0", "2026-10-08");
    // the ledger dates a job by its created day; only with no such day by the work
    st.dataset.jobs.push(job("j-spring", "c0", { createdOn: "2026-11-02", scheduledOn: "2027-04-15", completedOn: undefined, status: "scheduled" }));
    booked(st, "c0", "2026-11-02", { record: { kind: "job", id: "j-spring" } });
    // booked before they wrote back: theirs, not the pass's
    wrote(st, "c1", "2026-10-20");
    booked(st, "c1", "2026-10-12");
    expect(ids(billableBookings(st).billable)).toEqual(["c0"]);
    expect(why(st, "c1")).toBe("Booked before they wrote back");
  });

  it("2. the very quote the pass chased is dated by the day it was approved, not the day it became a job, for the window and a cancel", () => {
    const st = pass(1);
    st.outreach = [{ customerId: "c0", sourceId: "q-c0", opportunityId: "o-c0", firstTouchOn: START, lastTouchOn: START }];
    wrote(st, "c0", "2026-10-08");
    // approved 50 days after he wrote back, made a job 65 days after; the owner cancelled in between
    st.dataset.quotes.push(quote("q-c0", "c0", { status: "converted", sentOn: "2026-08-01", approvedOn: addDays("2026-10-08", 50), convertedOn: addDays("2026-10-08", 65) }));
    st.dataset.jobs.push(job("j-c0", "c0", { quoteId: "q-c0", status: "scheduled", createdOn: addDays("2026-10-08", 65), completedOn: undefined }));
    ledgerPass(st, "2026-12-14T09:00:00");
    expect(st.recoveries).toMatchObject([{ record: { kind: "quote", id: "q-c0" }, cameBackOn: "2026-12-12" }]);
    st.dataset.business.plan.cancelledOn = "2026-12-01";
    expect(billableBookings(st).billable).toMatchObject([{ customerId: "c0", on: "2026-11-27" }]);
    // approved 61 days after (and no cancel): out of the window, whenever it became a job
    delete st.dataset.business.plan.cancelledOn;
    st.dataset.quotes[0]!.approvedOn = addDays("2026-10-08", 61);
    expect(why(st, "c0")).toBe("Booked 61 days after they wrote back (more than 60)");
  });

  it("2. a quote that became a job goes by its approval, found as the job too; one approved before the pass by its job", () => {
    /** One export with the quote and the job made from it, read by the ledger; `chased`: the pass's note was about it. */
    const exported = (replyOn: string, q: Partial<Quote>, madeOn: string, chased = false) => {
      const st = pass(1);
      st.outreach = [{ customerId: "c0", sourceId: chased ? "q-c0" : undefined, opportunityId: "o-c0", firstTouchOn: START, lastTouchOn: START }];
      wrote(st, "c0", replyOn);
      st.dataset.quotes.push(quote("q-c0", "c0", { status: "converted", ...q }));
      st.dataset.jobs.push(job("j-c0", "c0", { quoteId: "q-c0", status: "scheduled", createdOn: madeOn, completedOn: undefined }));
      ledgerPass(st, `${addDays(madeOn, 1)}T09:00:00`);
      return st;
    };
    // a past customer approved a quote after the note, then wrote back (he'd called): booked before, whenever it became a job
    const called = exported("2026-10-07", { sentOn: "2026-10-01", approvedOn: "2026-10-06" }, "2026-10-20");
    expect(called.recoveries).toMatchObject([{ record: { kind: "job", id: "j-c0" }, cameBackOn: "2026-10-20" }]);
    expect(why(called, "c0")).toBe("Booked before they wrote back");
    // approved 4 days after he wrote back, made a job 63 days after: billed on the approval
    const late = exported("2026-10-08", { sentOn: "2026-10-09", approvedOn: "2026-10-12" }, "2026-12-10");
    expect(late.recoveries).toMatchObject([{ record: { kind: "job", id: "j-c0" }, cameBackOn: "2026-12-10" }]);
    expect(billableBookings(late).billable).toMatchObject([{ customerId: "c0", on: "2026-10-12" }]);
    // the pass chased a quote approved in August and never scheduled: booked the day its job was made, found as the job
    // or as the quote converted that day
    const unscheduled = exported("2026-10-08", { status: "approved", sentOn: "2026-08-01", approvedOn: "2026-08-20" }, "2026-10-20", true);
    expect(unscheduled.recoveries).toMatchObject([{ record: { kind: "job" } }]);
    expect(billableBookings(unscheduled).billable).toMatchObject([{ customerId: "c0", on: "2026-10-20" }]);
    const converted = exported("2026-10-08", { sentOn: "2026-08-01", approvedOn: "2026-08-20", convertedOn: "2026-10-20" }, "2026-10-20", true);
    expect(converted.recoveries).toMatchObject([{ record: { kind: "quote" } }]);
    expect(billableBookings(converted).billable).toMatchObject([{ customerId: "c0", on: "2026-10-20" }]);
  });

  it("3. one per customer however many jobs, and a booking seen twice (hand entry, then the export's) is one", () => {
    const st = pass(1);
    wrote(st, "c0", "2026-10-08");
    // the owner's BOOKED, then the same job from an export under another id, then a second job
    booked(st, "c0", "2026-10-15", { id: "rec-told", match: "owner_reported", record: { kind: "job", id: "r-c0-2026-10-08" } });
    booked(st, "c0", "2026-10-16", { id: "rec-export" });
    booked(st, "c0", "2026-11-20", { id: "rec-second" });
    const count = billableBookings(st);
    expect(count.billable).toHaveLength(1);
    expect(count.billable[0]).toMatchObject({ customerId: "c0", bookingId: "rec-told", on: "2026-10-15", replyId: "r-c0-2026-10-08", code: leadCode("r-c0-2026-10-08") });
    settleCharges(st, "2026-10-21T09:00:00", STRIPE);
    // the hand entry goes, the export's stays: still that customer's one charge
    st.recoveries = st.recoveries.filter((r) => r.id !== "rec-told");
    settleCharges(st, "2026-10-22T09:00:00", STRIPE);
    expect(st.dataset.business.plan.charges!.map((c) => [c.customerId, c.status])).toEqual([["c0", "heads_up"]]);
    expect(charge(st, "c0").id).toBe(chargeId(st, "c0"));
  });

  it("4. the cap: four, in the order they booked; a refund frees a place; one disputed after its charge holds it until Jack decides", () => {
    const st = pass(6);
    bookings(st, 6);
    const count = billableBookings(st);
    expect(ids(count.billable)).toEqual(["c0", "c1", "c2", "c3"]);
    expect(ids(count.overCap)).toEqual(["c4", "c5"]);
    st.dataset.business.plan.charges = ["c0", "c1", "c2", "c3"].map((cid) => ({ id: chargeId(st, cid), customerId: cid, code: "AAA", amount: 25000, status: "paid", via: "card", at: "2026-10-21T09:00:00" }));
    // the owner disputes c1 after it was charged: it holds its place
    st.dataset.business.plan.charges[1]!.code = "NOT";
    notOurs(st, "NOT", "2026-10-25T09:00:00");
    expect(ids(billableBookings(st).billable)).toEqual(["c0", "c1", "c2", "c3"]);
    // refunded: its place goes to the next one who booked
    decideCharge(st, chargeId(st, "c1"), true, "2026-10-26T09:00:00");
    chargeRefunded(st, chargeId(st, "c1"), "2026-10-26T09:00:00", "re_1");
    expect(ids(billableBookings(st).billable)).toEqual(["c0", "c2", "c3", "c4"]);
    expect(ids(billableBookings(st).overCap)).toEqual(["c5"]);
    expect(charge(st, "c1").reason).toBe("The owner texted NOT OURS");
  });

  it("5. a booking the owner marked not ours isn't billable", () => {
    const st = pass(1);
    wrote(st, "c0", "2026-10-08");
    booked(st, "c0", "2026-10-20", { disputed: { at: "2026-10-21T09:00:00", reason: "not ours", by: "owner" } });
    expect(billableBookings(st).billable).toEqual([]);
  });

  it("6. before any cancel: a booking the day of the CANCEL or after isn't billable, one before it is", () => {
    const st = pass(2);
    bookings(st, 2);
    cancelPlan(st, "2026-10-21T09:00:00");
    expect(st.dataset.business.plan.cancelledOn).toBe("2026-10-21");
    expect(ids(billableBookings(st).billable)).toEqual(["c0"]);
    expect(why(st, "c1")).toBe("Booked after the owner cancelled");
  });

  it("6. UNDO puts the pass back: nothing is after a cancel any more", () => {
    const st = pass(2);
    bookings(st, 2);
    cancelPlan(st, "2026-10-21T09:00:00", { yearly: true });
    undoCancel(st, "2026-10-21T10:00:00");
    expect(st.dataset.business.plan.cancelledOn).toBeUndefined();
    expect(ids(billableBookings(st).billable)).toEqual(["c0", "c1"]);
  });

  it("a job cancelled before the work isn't a booking, nor a quote approved whose job was cancelled", () => {
    const st = pass(2);
    bookings(st, 2);
    st.dataset.jobs.push(job("j-c0-2026-10-20", "c0", { status: "cancelled", createdOn: "2026-10-20" }));
    st.recoveries[1] = { ...st.recoveries[1]!, record: { kind: "quote", id: "q-c1" } };
    st.dataset.jobs.push(job("j-from-q", "c1", { quoteId: "q-c1", status: "cancelled", createdOn: "2026-10-22" }));
    expect(billableBookings(st).billable).toEqual([]);
    expect(why(st, "c0")).toBe("The job was cancelled before the work");
    expect(why(st, "c1")).toBe("The job was cancelled before the work");
  });

  it("a booking the owner texted whose job their records show only cancelled isn't a booking; one rebooked is", () => {
    const st = pass(3);
    for (const cid of ["c0", "c1", "c2"]) {
      wrote(st, cid, "2026-10-08");
      booked(st, cid, "2026-10-20", { id: `rec-told-${cid}`, match: "owner_reported", record: { kind: "job", id: `r-${cid}-2026-10-08` } });
    }
    // c0's job came in cancelled; c1's was cancelled and booked again; c2 had one cancelled before the pass wrote to him
    st.dataset.jobs.push(job("j-c0", "c0", { status: "cancelled", createdOn: "2026-10-20", completedOn: undefined }));
    st.dataset.jobs.push(job("j-c1", "c1", { status: "cancelled", createdOn: "2026-10-20", completedOn: undefined }), job("j-c1-b", "c1", { status: "scheduled", createdOn: "2026-10-22", completedOn: undefined }));
    st.dataset.jobs.push(job("j-c2", "c2", { status: "cancelled", createdOn: "2026-09-20", completedOn: undefined }));
    expect(ids(billableBookings(st).billable)).toEqual(["c1", "c2"]);
    expect(why(st, "c0")).toBe("The job was cancelled before the work");
  });

  it("nothing before the pass has started", () => {
    const st = pass(1, { startedOn: undefined });
    bookings(st, 1);
    expect(billableBookings(st)).toEqual({ billable: [], overCap: [], not: [] });
  });
});

describe("billable bookings: the two variants", () => {
  it("freeFirst 150: the first 150 written to are free and don't count toward the cap", () => {
    const st = pass(156, { freeFirst: 150 }, { spread: true });
    // c0..c149 are the first 150 by their first note; two of them book, then six after them
    bookings(st, 2, 0);
    bookings(st, 6, 150);
    const count = billableBookings(st);
    expect(ids(count.billable)).toEqual(["c150", "c151", "c152", "c153"]);
    expect(ids(count.overCap)).toEqual(["c154", "c155"]);
    expect(why(st, "c0")).toBe("One of the first 150 people: no charge, as promised");
    expect(why(st, "c0")).not.toMatch(/free/);
  });

  it("freeFirst counts by when the first note went, not by who's first on the list", () => {
    const st = pass(3, { freeFirst: 1 });
    st.touches[0]!.sentAt = "2026-10-07T08:00:00";
    st.touches[2]!.sentAt = "2026-10-05T07:00:00";
    bookings(st, 3);
    expect(ids(billableBookings(st).billable)).toEqual(["c0", "c1"]);
  });

  it("the rest of a cleaning list: only back on a regular schedule", () => {
    const st = pass(3, {}, { trade: "cleaning" });
    bookings(st, 3);
    // c0: a one-time deep clean; c1: every two weeks on the calendar; c2: marked recurring
    st.dataset.jobs.push(job("j-c0-2026-10-20", "c0", { total: 900, createdOn: "2026-10-20" }));
    st.dataset.jobs.push(...Array.from({ length: 4 }, (_, i) => job(`v-c1-${i}`, "c1", { visit: true, jobRef: "#88", completedOn: undefined, scheduledOn: addDays("2026-10-22", i * 14), status: "scheduled" as const })));
    st.recoveries[1]!.record = { kind: "job", id: bookingNames(st.dataset)(st.dataset.jobs.at(-1)!) };
    st.dataset.jobs.push(job("j-c2-2026-10-22", "c2", { recurring: true, createdOn: "2026-10-22" }));
    expect(ids(billableBookings(st).billable)).toEqual(["c1", "c2"]);
    expect(why(st, "c0")).toBe("Not back on a regular schedule");
  });

  it("the rest of a lawn list: a season, or one job over $500", () => {
    const st = pass(3, {}, { trade: "lawn" });
    bookings(st, 3);
    st.dataset.jobs.push(job("j-c0-2026-10-20", "c0", { total: 450, createdOn: "2026-10-20", title: "Fall clean-up" }));
    st.recoveries[0]!.value = 450;
    st.dataset.jobs.push(job("j-c1-2026-10-21", "c1", { total: 650, createdOn: "2026-10-21", title: "Fall clean-up and mulch" }));
    st.recoveries[1]!.value = 650;
    st.dataset.jobs.push(job("j-c2-2026-10-22", "c2", { total: 45, everyDays: 7, createdOn: "2026-10-22", title: "Weekly mowing" }));
    st.recoveries[2]!.value = 45;
    expect(ids(billableBookings(st).billable)).toEqual(["c1", "c2"]);
    expect(why(st, "c0")).toBe("Not a season or a job over $500");
  });

  it("a tree shop's pass bills any booking that keeps the rules, whatever it's worth", () => {
    const st = pass(1);
    bookings(st, 1);
    st.recoveries[0]!.value = 300;
    expect(ids(billableBookings(st).billable)).toEqual(["c0"]);
  });
});

describe("the charge log", () => {
  it("the first booking gets the link text for Jack's OK; the next waits until it's paid, then goes on the saved card", () => {
    const st = pass(3);
    bookings(st, 2);
    settleCharges(st, "2026-10-21T09:00:00", STRIPE);
    expect(st.dataset.business.plan.charges!.map((c) => [c.customerId, c.status, c.via])).toEqual([["c0", "heads_up", "link"]]);
    const [m] = textOf(st, "c0");
    expect(m!.kind).toBe("charge_link");
    expect(m!.text).toBe(`Person 0 booked (#${charge(st, "c0").code}). That's your first $250. Here's the link: https://qa.test/pay/${chargeId(st, "c0")}. It saves your card for the rest, and I text before every charge.`);
    // again: nothing new
    settleCharges(st, "2026-10-21T10:00:00", STRIPE);
    expect(st.ownerMessages).toHaveLength(1);
    expect(approveCharge(st, m!.id, "2026-10-21T11:00:00", STRIPE)).toEqual({ text: m!.text });
    expect(charge(st, "c0").status).toBe("link_sent");
    // paid by the link: the card is saved, and the second booking's text names its card and day
    chargePaid(st, chargeId(st, "c0"), "2026-10-21T12:00:00", { by: "stripe", stripe: checkout });
    expect(st.dataset.business.plan.card).toMatchObject({ customer: "cus_1", paymentMethod: "pm_1", last4: "4242", from: "checkout" });
    settleCharges(st, "2026-10-22T09:00:00", STRIPE);
    const second = textOf(st, "c1")[0]!;
    expect(second.kind).toBe("charge_card");
    // Thursday Oct 22: the day after is Friday until Jack approves it
    expect(second.text).toBe(`Person 1 booked (#${charge(st, "c1").code}). $250 goes on your card ending 4242 on Friday, $500 of your $1,000. Not ours? Reply NOT OURS #${charge(st, "c1").code}.`);
  });

  it("the card is charged one business day after its text reaches the owner, never before the day it names", () => {
    const st = pass(3);
    bookings(st, 2);
    st.dataset.business.plan.card = { customer: "cus_1", paymentMethod: "pm_1", brand: "visa", last4: "4242", at: "2026-10-01T09:00:00", from: "pasted" };
    settleCharges(st, "2026-10-21T09:00:00", STRIPE);
    expect(charge(st, "c0").via).toBe("card");
    const m = textOf(st, "c0")[0]!;
    expect(m.text).toContain("on Thursday, $250 of your $1,000.");
    // approved on Friday: Monday, if it goes now
    const r = approveCharge(st, m.id, "2026-10-23T16:00:00", STRIPE) as { text: string };
    expect(charge(st, "c0")).toMatchObject({ status: "approved", chargeOn: "2026-10-26" });
    expect(r.text).toContain("on Monday, $250 of your $1,000.");
    expect(m.text).toBe(r.text);
    // it hasn't reached him (on Texts to send, or back with Jack after the owner's STOP): nothing is charged on Monday,
    // and the day it names moves on with today
    expect(chargeStarted(st, chargeId(st, "c0"), "2026-10-26T09:00:00")).toBeUndefined();
    expect(redateCharge(st, chargeId(st, "c0"), "2026-10-26T09:00:00")).toBe(m);
    expect(charge(st, "c0")).toMatchObject({ status: "approved", chargeOn: "2026-10-27" });
    expect(m.text).toContain("on Tuesday, $250 of your $1,000.");
    expect(redateCharge(st, chargeId(st, "c0"), "2026-10-26T15:00:00")).toBeUndefined();
    // approved again on Tuesday: from Tuesday
    expect(approveCharge(st, m.id, "2026-10-27T08:00:00", STRIPE)).toEqual({ text: m.text });
    expect(m.text).toContain("on Wednesday, $250 of your $1,000.");
    // it reached him that morning: Wednesday, as it says; told once
    expect(chargeTold(st, chargeId(st, "c0"), "2026-10-27T08:05:00")).toBe(true);
    expect(chargeTold(st, chargeId(st, "c0"), "2026-10-28T08:05:00")).toBe(false);
    expect(charge(st, "c0")).toMatchObject({ toldAt: "2026-10-27T08:05:00", chargeOn: "2026-10-28" });
    expect(redateCharge(st, chargeId(st, "c0"), "2026-10-28T08:00:00")).toBeUndefined();
    // c1's text, approved Monday for Tuesday, reached him only on Wednesday (sent by hand late): Thursday, never sooner
    approveCharge(st, textOf(st, "c1")[0]!.id, "2026-10-26T10:00:00", STRIPE);
    chargeTold(st, chargeId(st, "c1"), "2026-10-28T09:00:00");
    expect(charge(st, "c1").chargeOn).toBe("2026-10-29");
    // once it's charged, the text has nothing left to say
    chargeStarted(st, chargeId(st, "c0"), "2026-10-28T09:00:00");
    chargePaid(st, chargeId(st, "c0"), "2026-10-28T09:01:00", { by: "stripe" });
    expect(approveCharge(st, m.id, "2026-10-28T10:00:00", STRIPE)).toEqual({ refused: "That charge isn't waiting for this text any more (it's paid)." });
    expect(nextBusinessDay("2026-10-23")).toBe("2026-10-26");
    expect(nextBusinessDay("2026-10-21")).toBe("2026-10-22");
  });

  it("a card charge whose next business day is a holiday moves to the business day after it, and its text names that day", () => {
    expect(nextBusinessDay("2026-11-25")).toBe("2026-11-30");
    expect(nextBusinessDay("2026-07-02")).toBe("2026-07-06");
    expect(nextBusinessDay("2027-07-02")).toBe("2027-07-06");
    expect(nextBusinessDay("2027-12-23")).toBe("2027-12-27");
    expect(nextBusinessDay("2027-12-30")).toBe("2028-01-03");
    const st = pass(3);
    bookings(st, 2);
    st.dataset.business.plan.card = { customer: "cus_1", paymentMethod: "pm_1", brand: "visa", last4: "4242", at: "2026-10-01T09:00:00", from: "pasted" };
    // the Wednesday before Thanksgiving: not Thursday or Friday, Monday
    settleCharges(st, "2026-11-25T09:00:00", STRIPE);
    const m = textOf(st, "c0")[0]!;
    expect(m.text).toContain("on Monday, $250 of your $1,000.");
    approveCharge(st, m.id, "2026-11-25T10:00:00", STRIPE);
    expect(charge(st, "c0")).toMatchObject({ status: "approved", chargeOn: "2026-11-30" });
    chargeTold(st, chargeId(st, "c0"), "2026-11-25T10:05:00");
    expect(charge(st, "c0").chargeOn).toBe("2026-11-30");
    // one that reaches him on Thanksgiving itself: Monday too
    approveCharge(st, textOf(st, "c1")[0]!.id, "2026-11-26T08:00:00", STRIPE);
    chargeTold(st, chargeId(st, "c1"), "2026-11-26T08:05:00");
    expect(charge(st, "c1").chargeOn).toBe("2026-11-30");
  });

  it("charged, failed and paid once: a webhook told three times, or a restart mid-charge, changes nothing more", () => {
    const st = pass(2);
    bookings(st, 1);
    st.dataset.business.plan.card = { customer: "cus_1", paymentMethod: "pm_1", brand: "visa", last4: "4242", at: "2026-10-01T09:00:00", from: "pasted" };
    settleCharges(st, "2026-10-21T09:00:00", STRIPE);
    approveCharge(st, textOf(st, "c0")[0]!.id, "2026-10-21T10:00:00", STRIPE);
    const id = chargeId(st, "c0");
    chargeTold(st, id, "2026-10-21T10:00:00");
    expect(chargeStarted(st, id, "2026-10-22T09:00:00")?.status).toBe("charging");
    // a restart reads it back: claimed again, never a second charge
    expect(chargeStarted(st, id, "2026-10-22T09:30:00")?.status).toBe("charging");
    expect(chargePaid(st, id, "2026-10-22T09:31:00", { by: "stripe", stripe: { paymentIntent: "pi_2" } })).toBe(true);
    for (let i = 0; i < 3; i++) expect(chargePaid(st, id, "2026-10-22T09:32:00", { by: "stripe" })).toBe(false);
    expect(chargeFailed(st, id, "2026-10-22T09:33:00", "declined", STRIPE)).toBe(false);
    expect(chargeStarted(st, id, "2026-10-22T09:34:00")).toBeUndefined();
    expect(st.events.filter((e) => e.title.startsWith("Paid:"))).toHaveLength(1);
  });

  it("a declined card: failed, and the link to pay it waits for Jack's OK", () => {
    const st = pass(2);
    bookings(st, 1);
    st.dataset.business.plan.card = { customer: "cus_1", paymentMethod: "pm_1", brand: "visa", last4: "4242", at: "2026-10-01T09:00:00", from: "pasted" };
    settleCharges(st, "2026-10-21T09:00:00", STRIPE);
    approveCharge(st, textOf(st, "c0")[0]!.id, "2026-10-21T10:00:00", STRIPE);
    const id = chargeId(st, "c0");
    chargeTold(st, id, "2026-10-21T10:00:00");
    chargeStarted(st, id, "2026-10-22T09:00:00");
    chargeFailed(st, id, "2026-10-22T09:01:00", "Your card was declined.", STRIPE);
    const retry = textOf(st, "c0").find((m) => m.kind === "charge_retry")!;
    expect(retry.text).toBe(`The $250 for Person 0 (#${charge(st, "c0").code}) didn't go through on your card ending 4242. Here's the link to pay it: https://qa.test/pay/${id}. It saves your card for the rest.`);
    approveCharge(st, retry.id, "2026-10-22T10:00:00", STRIPE);
    expect(charge(st, "c0")).toMatchObject({ status: "link_sent", via: "link" });
  });

  it("NOT OURS before the charge cancels it and frees its place; after it, it waits for Jack, holding its place", () => {
    const st = pass(6);
    bookings(st, 6);
    st.dataset.business.plan.card = { customer: "cus_1", paymentMethod: "pm_1", brand: "visa", last4: "4242", at: "2026-10-01T09:00:00", from: "pasted" };
    settleCharges(st, "2026-10-26T09:00:00", STRIPE);
    expect(ids(st.dataset.business.plan.charges!)).toEqual(["c0", "c1", "c2", "c3"]);
    // before: the text was approved, the card not charged yet
    approveCharge(st, textOf(st, "c1")[0]!.id, "2026-10-26T10:00:00", STRIPE);
    expect(notOurs(st, charge(st, "c1").code, "2026-10-26T12:00:00")).toMatchObject({ done: "skipped", customerId: "c1" });
    expect(charge(st, "c1")).toMatchObject({ status: "skipped", reason: "The owner texted NOT OURS" });
    expect(st.recoveries.find((r) => r.customerId === "c1")!.disputed?.by).toBe("owner");
    // its place goes to c4
    settleCharges(st, "2026-10-26T13:00:00", STRIPE);
    expect(ids(st.dataset.business.plan.charges!)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
    // after: c0 paid; NOT OURS asks Jack, and c5 stays over the cap
    approveCharge(st, textOf(st, "c0")[0]!.id, "2026-10-26T10:00:00", STRIPE);
    chargeTold(st, chargeId(st, "c0"), "2026-10-26T10:00:00");
    chargeStarted(st, chargeId(st, "c0"), "2026-10-27T09:00:00");
    chargePaid(st, chargeId(st, "c0"), "2026-10-27T09:01:00", { by: "stripe", stripe: { paymentIntent: "pi_c0" } });
    expect(notOurs(st, charge(st, "c0").code, "2026-10-27T12:00:00")).toMatchObject({ done: "asked" });
    expect(charge(st, "c0")).toMatchObject({ status: "paid", ask: { kind: "not_ours" } });
    settleCharges(st, "2026-10-27T13:00:00", STRIPE);
    expect(st.dataset.business.plan.charges!.some((c) => c.customerId === "c5")).toBe(false);
    // Jack refunds it: the booking comes off the ledger, its place frees up, and the owner is told
    expect(decideCharge(st, chargeId(st, "c0"), true, "2026-10-27T14:00:00")).toBe("refund");
    chargeRefunded(st, chargeId(st, "c0"), "2026-10-27T14:01:00", "re_1");
    expect(charge(st, "c0")).toMatchObject({ status: "refunded", stripe: { refund: "re_1" } });
    expect(textOf(st, "c0").find((m) => m.kind === "charge_refund")!.text).toBe(`Your $250 for Person 0 (#${charge(st, "c0").code}) is going back on your card.`);
    settleCharges(st, "2026-10-27T15:00:00", STRIPE);
    expect(st.dataset.business.plan.charges!.some((c) => c.customerId === "c5")).toBe(true);
  });

  it("paid twice (an older Checkout from its link): the second payment is Jack's to refund, after anything else he's asked", () => {
    const st = pass(1);
    bookings(st, 1);
    settleCharges(st, "2026-10-21T09:00:00", STRIPE);
    approveCharge(st, textOf(st, "c0")[0]!.id, "2026-10-21T10:00:00", STRIPE);
    const id = chargeId(st, "c0");
    chargePaid(st, id, "2026-10-21T11:00:00", { by: "stripe", stripe: checkout });
    // its own payment, or one told twice, isn't a second
    expect(paidTwice(st, id, "2026-10-21T11:01:00", "pi_1")).toBe(false);
    // the owner disputed it meanwhile: that question first
    notOurs(st, charge(st, "c0").code, "2026-10-21T11:30:00");
    expect(paidTwice(st, id, "2026-10-21T12:00:00", "pi_2")).toBe(true);
    expect(paidTwice(st, id, "2026-10-21T12:01:00", "pi_2")).toBe(false);
    expect(charge(st, "c0")).toMatchObject({ status: "paid", ask: { kind: "not_ours" }, stripe: { paymentIntent: "pi_1", again: ["pi_2"] } });
    expect(st.events.some((e) => e.kind === "review" && e.title === "Person 0's $250 was paid twice")).toBe(true);
    // kept: then the second payment is asked
    expect(decideCharge(st, id, false, "2026-10-21T13:00:00")).toBe("kept");
    expect(charge(st, "c0").ask).toMatchObject({ kind: "paid_twice", paymentIntent: "pi_2" });
    // refunded: the charge stays paid, its place held, and the owner hears it
    expect(decideCharge(st, id, true, "2026-10-21T14:00:00")).toBe("refund");
    expect(chargeRefunded(st, id, "2026-10-21T14:01:00", "re_2")).toBe(true);
    expect(charge(st, "c0")).toMatchObject({ status: "paid", stripe: { paymentIntent: "pi_1" } });
    expect(charge(st, "c0").ask).toBeUndefined();
    expect(charge(st, "c0").stripe!.again).toBeUndefined();
    expect(textOf(st, "c0").filter((m) => m.kind === "charge_refund").map((m) => m.text)).toEqual([`Your $250 for Person 0 (#${charge(st, "c0").code}) is going back on your card.`]);
    expect(ids(billableBookings(st).billable)).toEqual(["c0"]);
  });

  it("a link charge's text again for Jack's OK, with its link as it is now, in the words it first went with", () => {
    const st = pass(2);
    bookings(st, 2);
    st.dataset.business.plan.card = { customer: "cus_1", paymentMethod: "pm_1", brand: "visa", last4: "4242", at: "2026-10-01T09:00:00", from: "pasted" };
    settleCharges(st, "2026-10-21T09:00:00", STRIPE);
    approveCharge(st, textOf(st, "c0")[0]!.id, "2026-10-21T10:00:00", STRIPE);
    // not waiting on a link: nothing
    expect(linkAgain(st, chargeId(st, "c0"), "2026-10-21T11:00:00", STRIPE)).toBeUndefined();
    chargeTold(st, chargeId(st, "c0"), "2026-10-21T10:00:00");
    chargeStarted(st, chargeId(st, "c0"), "2026-10-22T09:00:00");
    chargeFailed(st, chargeId(st, "c0"), "2026-10-22T09:01:00", "Your card was declined.", STRIPE);
    approveCharge(st, textOf(st, "c0").find((m) => m.kind === "charge_retry")!.id, "2026-10-22T10:00:00", STRIPE);
    // the links were replaced: a declined card's words again, with the new link once Jack approves it
    const fresh: BillingOpts = { stripe: true, payLink: (id) => `https://qa.test/pay/new-${id}` };
    const m = linkAgain(st, chargeId(st, "c0"), "2026-10-23T09:00:00", STRIPE)!;
    expect(m.kind).toBe("charge_retry");
    expect(approveCharge(st, m.id, "2026-10-23T10:00:00", fresh)).toEqual({ text: `The $250 for Person 0 (#${charge(st, "c0").code}) didn't go through on your card ending 4242. Here's the link to pay it: https://qa.test/pay/new-${chargeId(st, "c0")}. It saves your card for the rest.` });
    expect(textOf(st, "c0").filter((x) => x.kind === "charge_retry")).toHaveLength(2);
  });

  it("NOT OURS kept by Jack holds the charge, and isn't asked again", () => {
    const st = pass(1);
    bookings(st, 1);
    markPaidOutside(st, { customerId: "c0" }, "2026-10-21T09:00:00");
    const code = charge(st, "c0").code;
    notOurs(st, code, "2026-10-22T09:00:00");
    expect(decideCharge(st, chargeId(st, "c0"), false, "2026-10-22T10:00:00")).toBe("kept");
    expect(charge(st, "c0")).toMatchObject({ status: "paid", keptAt: "2026-10-22T10:00:00" });
    expect(charge(st, "c0").ask).toBeUndefined();
    settleCharges(st, "2026-10-23T09:00:00", STRIPE);
    expect(charge(st, "c0").ask).toBeUndefined();
  });

  it("NOT OURS with no charge yet takes the lead's bookings off the ledger, and its customer is never charged for the pass", () => {
    const st = pass(2);
    bookings(st, 1);
    const code = leadCode("r-c0-2026-10-08");
    expect(notOurs(st, code, "2026-10-21T08:00:00")).toMatchObject({ customerId: "c0", done: "disputed", charge: { status: "skipped", reason: "The owner texted NOT OURS", code } });
    expect(st.recoveries[0]!.disputed?.reason).toBe("The owner texted NOT OURS");
    // their export comes in later with the job under its own id: still no charge, and no place taken
    booked(st, "c0", "2026-10-22", { id: "rec-export-c0" });
    settleCharges(st, "2026-10-23T09:00:00", STRIPE);
    expect(st.dataset.business.plan.charges!.map((c) => [c.customerId, c.status])).toEqual([["c0", "skipped"]]);
    expect(why(st, "c0")).toBe("The owner texted NOT OURS");
    expect(textOf(st, "c0")).toEqual([]);
    // and the next booking still bills as the first
    bookings(st, 1, 1);
    settleCharges(st, "2026-10-23T10:00:00", STRIPE);
    expect(textOf(st, "c1")[0]!.text).toContain("That's your first $250.");
    expect(notOurs(st, "ZZZ", "2026-10-21T09:00:00")).toBeUndefined();
    // a lead's code whose customer has a charge (another lead of theirs) is that charge
    st.replies.push({ ...st.replies.find((r) => r.customerId === "c1")!, id: "r-c1-second" });
    expect(notOurs(st, leadCode("r-c1-second"), "2026-10-23T11:00:00")).toMatchObject({ customerId: "c1", done: "skipped" });
    expect(st.dataset.business.plan.charges!.filter((c) => c.customerId === "c1")).toHaveLength(1);
  });

  it("a booking that drops out before its charge skips it, with the reason; after the charge, Jack is asked to refund it", () => {
    const st = pass(3);
    bookings(st, 2);
    st.dataset.business.plan.card = { customer: "cus_1", paymentMethod: "pm_1", brand: "visa", last4: "4242", at: "2026-10-01T09:00:00", from: "pasted" };
    settleCharges(st, "2026-10-22T09:00:00", STRIPE);
    approveCharge(st, textOf(st, "c0")[0]!.id, "2026-10-22T10:00:00", STRIPE);
    chargeTold(st, chargeId(st, "c0"), "2026-10-22T10:00:00");
    chargeStarted(st, chargeId(st, "c0"), "2026-10-23T09:00:00");
    chargePaid(st, chargeId(st, "c0"), "2026-10-23T09:01:00", { by: "stripe", stripe: { paymentIntent: "pi_c0" } });
    // both jobs are cancelled before the work
    st.dataset.jobs.push(job("j-c0-2026-10-20", "c0", { status: "cancelled" }), job("j-c1-2026-10-21", "c1", { status: "cancelled" }));
    const { skipped } = settleCharges(st, "2026-10-24T09:00:00", STRIPE);
    expect(skipped).toEqual([chargeId(st, "c1")]);
    expect(charge(st, "c1")).toMatchObject({ status: "skipped", reason: "The job was cancelled before the work" });
    // never refunded by itself
    expect(charge(st, "c0")).toMatchObject({ status: "paid", ask: { kind: "refund", why: "The job was cancelled before the work" } });
    expect(st.events.some((e) => e.kind === "review" && e.title === "Refund Person 0's $250?")).toBe(true);
    // a cancelled job is refunded after Jack's OK
    expect(decideCharge(st, chargeId(st, "c0"), true, "2026-10-24T10:00:00")).toBe("refund");
    expect(chargeRefunded(st, chargeId(st, "c0"), "2026-10-24T10:01:00", "re_c0")).toBe(true);
    expect(charge(st, "c0").reason).toBe("The job was cancelled before the work");
    // asked once
    settleCharges(st, "2026-10-25T09:00:00", STRIPE);
    expect(st.events.filter((e) => e.title === "Refund Person 0's $250?")).toHaveLength(1);
  });

  it("a refund asked after the job was cancelled is moot once the customer books again; cancelled again, it's asked again", () => {
    const st = pass(1);
    st.outreach = [{ customerId: "c0", opportunityId: "o-c0", firstTouchOn: START, lastTouchOn: START }];
    st.dataset.business.plan.card = { customer: "cus_1", paymentMethod: "pm_1", brand: "visa", last4: "4242", at: "2026-10-01T09:00:00", from: "pasted" };
    wrote(st, "c0", "2026-10-08");
    // a new export with these jobs, read by the ledger, then the charge log brought up to it
    const newExport = (now: string, ...jobs: Job[]) => {
      st.dataset.jobs = jobs;
      ledgerPass(st, now);
      settleCharges(st, now, STRIPE);
    };
    const j1 = job("j1", "c0", { status: "scheduled", createdOn: "2026-10-20", completedOn: undefined });
    newExport("2026-10-21T09:00:00", j1);
    const id = chargeId(st, "c0");
    approveCharge(st, textOf(st, "c0")[0]!.id, "2026-10-21T10:00:00", STRIPE);
    chargeTold(st, id, "2026-10-21T10:00:00");
    chargeStarted(st, id, "2026-10-22T09:00:00");
    chargePaid(st, id, "2026-10-22T09:01:00", { by: "stripe", stripe: { paymentIntent: "pi_c0" } });
    // the job is cancelled before the work: Jack is asked
    newExport("2026-10-24T09:00:00", { ...j1, status: "cancelled" });
    expect(charge(st, "c0").ask).toMatchObject({ kind: "refund", why: "The job was cancelled before the work" });
    // she books again: billable, and the $250 paid stands for it
    const j2 = job("j2", "c0", { status: "scheduled", createdOn: "2026-10-27", completedOn: undefined });
    newExport("2026-10-28T09:00:00", { ...j1, status: "cancelled" }, j2);
    expect(billableBookings(st).billable).toMatchObject([{ customerId: "c0", on: "2026-10-27" }]);
    expect(charge(st, "c0")).toMatchObject({ status: "paid", bookedOn: "2026-10-27" });
    expect(charge(st, "c0").ask).toBeUndefined();
    expect(st.events.find((e) => e.title === "No refund for Person 0: booked again")?.detail).toBe("The job was cancelled before the work, but they booked again: the $250 paid stands for that booking.");
    expect(decideCharge(st, id, true, "2026-10-28T10:00:00")).toBeUndefined();
    expect(st.dataset.business.plan.charges).toHaveLength(1);
    // that one's cancelled too: asked again
    newExport("2026-11-02T09:00:00", { ...j1, status: "cancelled" }, { ...j2, status: "cancelled" });
    expect(charge(st, "c0").ask).toMatchObject({ kind: "refund", why: "The job was cancelled before the work" });
    // money paid after its charge was cancelled stays Jack's, whatever the customer books since
    const after = pass(1);
    bookings(after, 1);
    settleCharges(after, "2026-10-21T09:00:00", STRIPE);
    approveCharge(after, textOf(after, "c0")[0]!.id, "2026-10-21T10:00:00", STRIPE);
    after.recoveries[0]!.disputed = { at: "2026-10-22T09:00:00", reason: "taken back", by: "owner" };
    settleCharges(after, "2026-10-22T09:00:00", STRIPE);
    chargePaid(after, chargeId(after, "c0"), "2026-10-22T11:00:00", { by: "stripe", stripe: checkout });
    booked(after, "c0", "2026-10-26");
    settleCharges(after, "2026-10-26T09:00:00", STRIPE);
    expect(charge(after, "c0").ask).toMatchObject({ kind: "refund", why: "Paid after it was cancelled (Its booking is off the ledger)" });
  });

  it("the cap: four paid, its text once, and the end text says what was paid", () => {
    const st = pass(6);
    bookings(st, 6);
    for (let i = 0; i < 4; i++) markPaidOutside(st, { customerId: `c${i}` }, "2026-10-26T09:00:00");
    settleCharges(st, "2026-10-26T10:00:00", BY_HAND);
    settleCharges(st, "2026-10-27T10:00:00", BY_HAND);
    const cap = st.ownerMessages.filter((m) => m.kind === "charge_cap");
    expect(cap.map((m) => m.text)).toEqual(["That's four, the $1,000 cap. Anything else that books from this pass is yours."]);
    expect(st.dataset.business.plan.charges).toHaveLength(4);
    expect(passEndText(st, "2026-11-05").split("\n")[0]).toMatch(/ 6 booked\. You paid \$1,000, the cap\.$/);
    // a refund: it's under the cap again
    st.dataset.business.plan.charges![3]!.status = "refunded";
    expect(passEndText(st, "2026-11-05").split("\n")[0]).toMatch(/You paid \$750\.$/);
    st.dataset.business.plan.charges = [];
    expect(passEndText(st, "2026-11-05").split("\n")[0]).toMatch(/You paid nothing\.$/);
    expect(passEndText(st, "2026-11-05")).not.toMatch(/497/);
  });

  it("by hand (no Stripe key): a link Jack sends himself, then the saved card; Done marks each paid, and never twice", () => {
    const st = pass(3);
    bookings(st, 2);
    settleCharges(st, "2026-10-21T09:00:00", BY_HAND);
    const m = textOf(st, "c0")[0]!;
    expect(m.text).toBe(`Person 0 booked (#${charge(st, "c0").code}). That's your first $250. I'll text you the link. It saves your card for the rest, and I text before every charge.`);
    approveCharge(st, m.id, "2026-10-21T10:00:00", BY_HAND);
    expect(charge(st, "c0").status).toBe("approved");
    expect("charge" in markPaidOutside(st, { customerId: "c0" }, "2026-10-21T11:00:00")).toBe(true);
    expect(cardOnFile(st.dataset.business.plan, false)).toBe(true);
    expect(markPaidOutside(st, { customerId: "c0" }, "2026-10-21T11:01:00")).toEqual({ refused: "That charge is paid already." });
    settleCharges(st, "2026-10-21T12:00:00", BY_HAND);
    expect(charge(st, "c1").via).toBe("card");
    expect(textOf(st, "c1")[0]!.text).toContain("$250 goes on your card on Thursday, $500 of your $1,000.");
  });

  it("a charge marked paid outside the software is never charged again, and one paid after it was cancelled goes to Jack", () => {
    const st = pass(2);
    bookings(st, 2);
    const r = markPaidOutside(st, { customerId: "c1" }, "2026-10-20T09:00:00") as { charge: { id: string } };
    expect(r.charge.id).toBe(chargeId(st, "c1"));
    expect(charge(st, "c1")).toMatchObject({ status: "paid", reason: "Paid outside the software", bookingId: "rec-c1-2026-10-21" });
    expect(chargeStarted(st, r.charge.id, "2026-10-22T09:00:00")).toBeUndefined();
    settleCharges(st, "2026-10-22T09:00:00", STRIPE);
    expect(st.dataset.business.plan.charges!.filter((c) => c.customerId === "c1")).toHaveLength(1);
    // a link paid moments after NOT OURS cancelled its charge
    const c0 = charge(st, "c0");
    approveCharge(st, textOf(st, "c0")[0]!.id, "2026-10-22T10:00:00", STRIPE);
    notOurs(st, c0.code, "2026-10-22T11:00:00");
    chargePaid(st, c0.id, "2026-10-22T11:01:00", { by: "stripe", stripe: checkout });
    expect(c0).toMatchObject({ status: "paid", ask: { kind: "refund", why: "Paid after it was cancelled (The owner texted NOT OURS)" } });
  });

  it("money texts for bookings before a CANCEL still come; nothing booked after it is billed", () => {
    const st = pass(3);
    bookings(st, 3);
    cancelPlan(st, "2026-10-21T09:00:00");
    settleCharges(st, "2026-10-21T10:00:00", BY_HAND);
    expect(ids(st.dataset.business.plan.charges!)).toEqual(["c0"]);
    expect(textOf(st, "c0")[0]!.kind).toBe("charge_link");
  });

  it("a pass gone monthly still bills its own bookings by its terms, never a reply to the monthly plan's notes", () => {
    const st = pass(2);
    bookings(st, 1);
    settleCharges(st, "2026-10-21T09:00:00", STRIPE);
    approveCharge(st, textOf(st, "c0")[0]!.id, "2026-10-21T10:00:00", STRIPE);
    // done, and the owner said yes to monthly: Settings makes it one, the pass's terms and charges kept
    Object.assign(st.dataset.business.plan, { kind: "monthly", stage: "paying", monthlyPrice: 497, doneOn: "2026-11-04" });
    // c1 wrote back to the pass and books after the switch; the monthly plan's notes aren't the pass's
    wrote(st, "c1", "2026-10-30");
    booked(st, "c1", "2026-11-12");
    st.touches.push(note("c1", 1, "2026-11-10", { id: "t-monthly" }));
    expect(passTouches(st).map((t) => t.id)).toEqual(["t-c0-1", "t-c1-1"]);
    expect(ids(billableBookings(st).billable)).toEqual(["c0", "c1"]);
    chargePaid(st, chargeId(st, "c0"), "2026-11-05T12:00:00", { by: "stripe", stripe: checkout });
    settleCharges(st, "2026-11-12T09:00:00", STRIPE);
    expect(st.dataset.business.plan.charges!.map((c) => [c.customerId, c.status, c.via])).toEqual([
      ["c0", "paid", "link"],
      ["c1", "heads_up", "card"],
    ]);
    // someone the pass wrote to who answers only the monthly plan's note is the monthly plan's
    const late = pass(1);
    Object.assign(late.dataset.business.plan, { kind: "monthly", stage: "paying", doneOn: "2026-11-04" });
    late.touches.push(note("c0", 1, "2026-11-10", { id: "t-monthly" }));
    wrote(late, "c0", "2026-11-11", "wants_it", { touchId: "t-monthly" });
    booked(late, "c0", "2026-11-20");
    expect(billableBookings(late).billable).toEqual([]);
    expect(why(late, "c0")).toBe("Never wrote back to the pass's notes");
    // and Jack can still mark one paid outside the software
    expect(markPaidOutside(st, { customerId: "c1" }, "2026-11-12T10:00:00")).toMatchObject({ charge: { status: "paid" } });
  });
});

describe("a booking that drops out before its charge, then books for real", () => {
  it("BOOKED, NO, BOOKED again: the skipped charge comes back for the new booking, with a text of its own", () => {
    const st = pass(2);
    const r = wrote(st, "c0", "2026-10-08");
    markContacted(st, r.id, "2026-10-20T10:00:00", "booked", 2400);
    settleCharges(st, "2026-10-20T10:01:00", STRIPE);
    const id = chargeId(st, "c0");
    expect(charge(st, "c0").status).toBe("heads_up");
    // she backs out: no charge
    markContacted(st, r.id, "2026-10-21T10:00:00", "lost");
    expect(settleCharges(st, "2026-10-21T10:01:00", STRIPE).skipped).toEqual([id]);
    expect(charge(st, "c0")).toMatchObject({ status: "skipped", reason: "Its booking is off the ledger" });
    // she really books: that's her first billable booking
    markContacted(st, r.id, "2026-10-23T10:00:00", "booked", 2400);
    settleCharges(st, "2026-10-23T10:01:00", STRIPE);
    expect(billableBookings(st).billable).toMatchObject([{ customerId: "c0", on: "2026-10-23" }]);
    expect(st.dataset.business.plan.charges).toHaveLength(1);
    expect(charge(st, "c0")).toMatchObject({ id, status: "heads_up", bookedOn: "2026-10-23", via: "link" });
    expect(charge(st, "c0").reason).toBeUndefined();
    const texts = textOf(st, "c0");
    expect(texts).toHaveLength(2);
    expect(texts[1]!.id).not.toBe(texts[0]!.id);
    expect(texts[1]!.text).toMatch(/^Person 0 booked \(#\w{3}\)\. That's your first \$250\. Here's the link: /);
    // approved, it goes as any other
    expect(approveCharge(st, texts[1]!.id, "2026-10-23T11:00:00", STRIPE)).toMatchObject({ text: expect.stringContaining("/pay/") });
    expect(charge(st, "c0").status).toBe("link_sent");
  });

  it("a job cancelled after its link went, then booked again on a later import: charged for the new job", () => {
    const st = pass(1);
    st.outreach = [{ customerId: "c0", opportunityId: "o-c0", firstTouchOn: START, lastTouchOn: START }];
    wrote(st, "c0", "2026-10-08");
    const newExport = (now: string, ...jobs: Job[]) => {
      st.dataset.jobs = jobs;
      ledgerPass(st, now);
      return settleCharges(st, now, STRIPE);
    };
    const j1 = job("j1", "c0", { status: "scheduled", createdOn: "2026-10-20", completedOn: undefined });
    newExport("2026-10-21T09:00:00", j1);
    const id = chargeId(st, "c0");
    approveCharge(st, textOf(st, "c0")[0]!.id, "2026-10-21T10:00:00", STRIPE);
    expect(charge(st, "c0").status).toBe("link_sent");
    expect(newExport("2026-10-24T09:00:00", { ...j1, status: "cancelled" }).skipped).toEqual([id]);
    expect(charge(st, "c0")).toMatchObject({ status: "skipped", reason: "The job was cancelled before the work" });
    const j2 = job("j2", "c0", { status: "scheduled", createdOn: "2026-10-27", completedOn: undefined });
    newExport("2026-10-28T09:00:00", { ...j1, status: "cancelled" }, j2);
    expect(charge(st, "c0")).toMatchObject({ status: "heads_up", bookedOn: "2026-10-27", via: "link" });
    expect(textOf(st, "c0")).toHaveLength(2);
    // and paid by the link (her declined tries and old Checkouts aside), it's the one charge
    approveCharge(st, textOf(st, "c0")[1]!.id, "2026-10-28T10:00:00", STRIPE);
    expect(chargePaid(st, id, "2026-10-29T10:00:00", { by: "stripe", stripe: checkout })).toBe(true);
    expect(st.dataset.business.plan.charges).toHaveLength(1);
  });

  it("comes back after the charges made meanwhile, so its place and total are right; NOT OURS or Jack's word stays final", () => {
    const st = pass(3);
    bookings(st, 2);
    st.dataset.business.plan.card = { customer: "cus_1", paymentMethod: "pm_1", brand: "visa", last4: "4242", at: "2026-10-01T09:00:00", from: "pasted" };
    settleCharges(st, "2026-10-22T09:00:00", STRIPE);
    // c0's booking drops out before the charge; c1's is charged
    st.recoveries[0]!.disputed = { at: "2026-10-22T10:00:00", reason: "taken back", by: "owner" };
    settleCharges(st, "2026-10-22T10:00:00", STRIPE);
    markPaidOutside(st, { customerId: "c1" }, "2026-10-23T09:00:00");
    // c0 books again: second, on the card
    booked(st, "c0", "2026-10-26", { id: "rec-c0-again" });
    settleCharges(st, "2026-10-26T09:00:00", STRIPE);
    expect(st.dataset.business.plan.charges!.map((c) => [c.customerId, c.status])).toEqual([
      ["c1", "paid"],
      ["c0", "heads_up"],
    ]);
    expect(textOf(st, "c0").at(-1)!.text).toMatch(/^Person 0 booked \(#\w{3}\)\. \$250 goes on your card ending 4242 on Tuesday, \$500 of your \$1,000\./);
    // NOT OURS on a dropped one makes it final: a later booking never brings it back
    const fin = pass(1);
    bookings(fin, 1);
    settleCharges(fin, "2026-10-21T09:00:00", STRIPE);
    fin.recoveries[0]!.disputed = { at: "2026-10-22T10:00:00", reason: "taken back", by: "owner" };
    settleCharges(fin, "2026-10-22T10:00:00", STRIPE);
    expect(notOurs(fin, charge(fin, "c0").code, "2026-10-22T11:00:00")).toMatchObject({ done: "already" });
    booked(fin, "c0", "2026-10-26", { id: "rec-c0-again" });
    settleCharges(fin, "2026-10-26T09:00:00", STRIPE);
    expect(charge(fin, "c0")).toMatchObject({ status: "skipped", reason: "The owner texted NOT OURS" });
    expect(why(fin, "c0")).toBe("The owner texted NOT OURS");
    // a booking after the cancel stays out
    const late = pass(1);
    bookings(late, 1);
    settleCharges(late, "2026-10-21T09:00:00", STRIPE);
    cancelPlan(late, "2026-10-20T09:00:00");
    settleCharges(late, "2026-10-21T10:00:00", STRIPE);
    expect(charge(late, "c0")).toMatchObject({ status: "skipped", reason: "Booked after the owner cancelled" });
    expect(charge(late, "c0").dropped).toBeUndefined();
  });
});

describe("a booking the owner texted is dated by the record of it in their export", () => {
  /** Karen (c0) wrote back Oct 8 to the note of Oct 5; her export has `jobs`; the owner texts BOOKED on Oct 20 unless `told` is false. */
  function told(jobs: Job[], opts: { told?: boolean } = {}): AccountState {
    const st = pass(1);
    st.outreach = [{ customerId: "c0", opportunityId: "o-c0", firstTouchOn: START, lastTouchOn: START }];
    const r = wrote(st, "c0", "2026-10-08");
    if (opts.told !== false) markContacted(st, r.id, "2026-10-20T10:00:00", "booked", 2400);
    st.dataset.jobs = jobs;
    ledgerPass(st, "2026-10-21T09:00:00");
    return st;
  }
  const made = (on: string) => job("j-karen", "c0", { status: "scheduled", createdOn: on, completedOn: undefined, total: 2400 });

  it("a job made before the pass wrote to her isn't billable, BOOKED or not", () => {
    expect(billableBookings(told([made("2026-09-20")])).billable).toEqual([]);
    expect(why(told([made("2026-09-20")]), "c0")).toBe("Booked before they wrote back");
    expect(billableBookings(told([made("2026-09-20")], { told: false }))).toEqual({ billable: [], overCap: [], not: [] });
  });

  it("a job made after the note but before her reply isn't billable, BOOKED or not", () => {
    expect(billableBookings(told([made("2026-10-06")])).billable).toEqual([]);
    expect(why(told([made("2026-10-06")]), "c0")).toBe("Booked before they wrote back");
    expect(why(told([made("2026-10-06")], { told: false }), "c0")).toBe("Booked before they wrote back");
  });

  it("a job made after her reply goes by its own day; one made after the BOOKED text, by the text's", () => {
    expect(billableBookings(told([made("2026-10-12")])).billable).toMatchObject([{ customerId: "c0", on: "2026-10-12" }]);
    expect(billableBookings(told([made("2026-10-25")])).billable).toMatchObject([{ customerId: "c0", on: "2026-10-20" }]);
    // no record of it yet: the BOOKED text's day; an old job of theirs, done before the pass wrote, isn't this one
    expect(billableBookings(told([])).billable).toMatchObject([{ customerId: "c0", on: "2026-10-20" }]);
    const old = job("j-old", "c0", { status: "completed", createdOn: "2026-09-12", completedOn: "2026-09-19", total: 600 });
    expect(billableBookings(told([old])).billable).toMatchObject([{ customerId: "c0", on: "2026-10-20" }]);
  });
});

describe("a booking reported with no amount", () => {
  it("BOOKED #code with no amount (or Jack's console entry with none) bills on the day it was said; its job in a later export is the same booking", () => {
    const st = pass(2);
    st.outreach = ["c0", "c1"].map((cid) => ({ customerId: cid, opportunityId: `o-${cid}`, firstTouchOn: START, lastTouchOn: START }));
    const r = wrote(st, "c0", "2026-10-08");
    markContacted(st, r.id, "2026-10-20T10:00:00", "booked");
    expect(billableBookings(st).billable).toMatchObject([{ customerId: "c0", on: "2026-10-20", replyId: r.id, code: leadCode(r.id) }]);
    settleCharges(st, "2026-10-20T10:01:00", STRIPE);
    expect(charge(st, "c0")).toMatchObject({ status: "heads_up", bookedOn: "2026-10-20", code: leadCode(r.id) });
    // the ledger's own figures don't change: it has no amount
    expect(st.recoveries).toEqual([]);
    // the export shows the job: one booking, one charge
    st.dataset.jobs = [job("j-karen", "c0", { status: "scheduled", createdOn: "2026-10-19", completedOn: undefined, total: 2400 })];
    ledgerPass(st, "2026-10-22T09:00:00");
    expect(billableBookings(st).billable).toMatchObject([{ customerId: "c0", on: "2026-10-19" }]);
    settleCharges(st, "2026-10-22T09:01:00", STRIPE);
    expect(st.dataset.business.plan.charges).toHaveLength(1);
    expect(charge(st, "c0").status).toBe("heads_up");
    // taken back (NO #code): no charge
    const r1 = wrote(st, "c1", "2026-10-08");
    markContacted(st, r1.id, "2026-10-23T10:00:00", "booked");
    settleCharges(st, "2026-10-23T10:01:00", STRIPE);
    expect(charge(st, "c1")).toBeUndefined();
    markPaidOutside(st, { customerId: "c0" }, "2026-10-23T11:00:00");
    settleCharges(st, "2026-10-23T11:01:00", STRIPE);
    expect(charge(st, "c1").status).toBe("heads_up");
    markContacted(st, r1.id, "2026-10-24T10:00:00", "lost");
    settleCharges(st, "2026-10-24T10:01:00", STRIPE);
    expect(charge(st, "c1")).toMatchObject({ status: "skipped", reason: "Its booking is off the ledger" });
  });

  it("the rest of a lawn list still needs the amount: a season, or a job over $500", () => {
    const st = pass(1, {}, { trade: "lawn" });
    const r = wrote(st, "c0", "2026-10-08");
    markContacted(st, r.id, "2026-10-20T10:00:00", "booked");
    expect(why(st, "c0")).toBe("Not a season or a job over $500");
  });
});
