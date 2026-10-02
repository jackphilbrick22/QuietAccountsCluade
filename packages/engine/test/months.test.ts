import { describe, expect, it } from "vitest";
import { billableBookings } from "../src/ledger/billable.ts";
import { approveCharge, askFirstMonth, chargeFailed, chargeOf, chargePaid, chargeStarted, chargeTold, CHARGE_REF, markPaidOutside, monthChargeId, redateCharge, settleMonths, type BillingOpts } from "../src/runtime/charges.ts";
import { billingCheck, cancelPlan, undoCancel } from "../src/runtime/agents.ts";
import { emptyState, type AccountState } from "../src/runtime/state.ts";
import { chargeHeadsUp, chargeRefundText, chargeRetryText, guaranteeCheck, monthLine } from "../src/reports/owner.ts";
import { onePassPlan } from "../src/plans.ts";
import type { MonthCharge, PlanState, Reply, Touch } from "../src/model.ts";
import { addDays } from "../src/util.ts";
import { customer, dataset } from "./fixtures.ts";

/**
 * BRIEF B5: the monthly plan's months on the charge log. The first month on the owner's yes, then each month that isn't
 * free from its pre-charge text, once a month; never a yearly plan's. Paid, the first month makes the plan monthly from
 * that day. A cancel stops the months not charged yet. And the two fixes where the one pass meets the monthly plan.
 */

const STRIPE: BillingOpts = { stripe: true, payLink: (id) => `https://qa.test/pay/${id}` };
const BY_HAND: BillingOpts = { stripe: false };
const PAID = "2026-10-20";
const NEXT = "2026-11-20";
const CARD = { customer: "cus_1", paymentMethod: "pm_1", brand: "visa", last4: "4242", at: `${PAID}T10:00:00`, from: "checkout" as const };

function account(plan: Partial<PlanState> = {}): AccountState {
  const ds = dataset({ customers: [customer("c-karen", { name: "Karen Whitfield", firstName: "Karen", lastName: "Whitfield" })] });
  ds.business.plan = { ...ds.business.plan, ...plan };
  return emptyState(ds, `${PAID}T09:00:00`);
}

/** Paying from Oct 20, its card saved. */
const paying = (plan: Partial<PlanState> = {}) => account({ stage: "paying", paidOn: PAID, card: CARD, ...plan });

function note(id: string, customerId: string, on: string): Touch {
  return { id, opportunityId: `o-${id}`, customerId, channel: "email", step: 1, angle: "check_in", dueAt: `${on}T08:00`, sentAt: `${on}T08:00:00`, status: "sent", body: "", flags: [] };
}

/** `customerId` asked to come back on `on`, answering note `touchId` (none: a reply we can't tie to a note). */
function asked(st: AccountState, customerId: string, on: string, touchId?: string): Reply {
  const r: Reply = { id: `r-${customerId}-${on}`, customerId, touchId, channel: "email", receivedAt: `${on}T10:00:00`, from: `${customerId}@gmail.com`, text: "Yes please", intent: "wants_it", confidence: 0.9, extracted: {}, status: "handed_off", handedOffAt: `${on}T10:05:00` };
  st.replies.push(r);
  return r;
}

/** Karen got a monthly note on Oct 27 and asked to come back: Nov 20's month isn't free. */
function karenAsked(st: AccountState): void {
  st.touches.push(note("t-karen", "c-karen", "2026-10-27"));
  asked(st, "c-karen", "2026-10-27", "t-karen");
}

const months = (st: AccountState) => st.dataset.business.plan.months ?? [];
const month = (on: string, over: Partial<MonthCharge> = {}): MonthCharge => ({ id: `m-${on}`, month: on, amount: 49700, status: "heads_up", via: "card", chargeOn: on, at: `${on}T09:00:00`, ...over });

describe("the words", () => {
  it("the first month's text: by the link that saves the card (or Jack's own), or on the card saved already", () => {
    const st = account();
    const first = month(PAID, { first: true, via: "link", chargeOn: undefined });
    expect(chargeHeadsUp(st, first, { link: "https://qa.test/pay/x" })).toBe("Dave, here's the link for your first month, $497: https://qa.test/pay/x. It saves your card, and I text before every charge. Any month nobody asks to come back, you don't pay.");
    expect(chargeHeadsUp(st, first, {})).toBe("Dave, your first month is $497. I'll text you the link. It saves your card, and I text before every charge. Any month nobody asks to come back, you don't pay.");
    st.dataset.business.plan.card = CARD;
    expect(chargeHeadsUp(st, { ...first, via: "card" }, { on: "2026-10-21" })).toBe("Dave, your first month, $497, goes on your card ending 4242 on Wednesday. I text before every charge. Any month nobody asks to come back, you don't pay.");
    // a later month's link sent again
    expect(chargeHeadsUp(st, month(NEXT, { via: "link" }), { link: "https://qa.test/pay/y" })).toBe("Dave, here's the link for the month from November 20, $497: https://qa.test/pay/y. It saves your card for the rest.");
  });

  it("a later month's pre-charge line, its declined card, and a refund", () => {
    const st = paying();
    expect(monthLine(st, month(NEXT), {})).toBe("Your next month starts November 20: $497 goes on your card ending 4242 that day.");
    expect(monthLine(st, month(NEXT, { via: "link" }), { link: "https://qa.test/pay/y" })).toBe("Your next month starts November 20: $497. Here's the link to pay it: https://qa.test/pay/y. It saves your card for the rest.");
    expect(monthLine(st, month(NEXT, { via: "link" }), {})).toBe("Your next month starts November 20: $497. I'll text you the link.");
    expect(chargeRetryText(st, month(NEXT), "https://qa.test/pay/y")).toBe("Your $497 for the month from November 20 didn't go through on your card ending 4242. Here's the link to pay it: https://qa.test/pay/y. It saves your card for the rest.");
    expect(chargeRefundText(st, month(PAID, { first: true }))).toBe("Your $497 for your first month is going back on your card.");
  });
});

describe("the first month", () => {
  it("asked once on the owner's yes, its text waiting for Jack; never on a plan that pays already, is cancelled or yearly", () => {
    const st = account();
    const c = askFirstMonth(st, `${PAID}T10:00:00`, STRIPE)!;
    expect(c).toMatchObject({ id: monthChargeId(st, PAID, true), first: true, month: PAID, amount: 49700, via: "link", status: "heads_up" });
    expect(st.ownerMessages).toMatchObject([{ kind: "charge_link", refs: [{ kind: CHARGE_REF, id: c.id }], text: expect.stringContaining(`https://qa.test/pay/${c.id}`) }]);
    expect(askFirstMonth(st, `${PAID}T11:00:00`, STRIPE)).toBeUndefined();
    expect(askFirstMonth(st, "2026-10-22T11:00:00", STRIPE)).toBeUndefined();
    expect(months(st)).toHaveLength(1);
    for (const plan of [{ stage: "paying" as const }, { stage: "cancelled" as const }, { billing: "annual" as const }]) expect(askFirstMonth(account(plan), `${PAID}T10:00:00`, STRIPE)).toBeUndefined();
  });

  it("on the card a one pass saved, at $497 (a pass has no monthly price), charged a business day after its text reaches him", () => {
    const st = account();
    st.dataset.business.plan = onePassPlan({ stage: "done", startedOn: "2026-09-21", doneOn: "2026-10-16", card: CARD });
    const c = askFirstMonth(st, `${PAID}T10:00:00`, STRIPE)!;
    expect(c).toMatchObject({ via: "card", amount: 49700 });
    expect(st.ownerMessages[0]!.kind).toBe("charge_card");
    approveCharge(st, st.ownerMessages[0]!.id, `${PAID}T11:00:00`, STRIPE);
    expect(c).toMatchObject({ status: "approved", chargeOn: "2026-10-21" });
    expect(chargeStarted(st, c.id, "2026-10-21T09:00:00")).toBeUndefined();
    chargeTold(st, c.id, "2026-10-21T08:00:00");
    expect(c.chargeOn).toBe("2026-10-22");
    chargeStarted(st, c.id, "2026-10-22T09:00:00");
    chargePaid(st, c.id, "2026-10-22T09:01:00", { by: "stripe", stripe: { paymentIntent: "pi_1" } });
    expect(st.dataset.business.plan).toMatchObject({ kind: "monthly", stage: "paying", paidOn: "2026-10-22", monthlyPrice: 497, doneOn: "2026-10-16", startedOn: "2026-09-21" });
  });

  it("paid, the trial is paying from that day; never once it pays already, nor when it was paid after it was cancelled", () => {
    const st = account();
    const c = askFirstMonth(st, `${PAID}T10:00:00`, STRIPE)!;
    approveCharge(st, st.ownerMessages[0]!.id, `${PAID}T10:05:00`, STRIPE);
    chargePaid(st, c.id, "2026-10-21T12:00:00", { by: "stripe", stripe: CARD });
    expect(st.dataset.business.plan).toMatchObject({ stage: "paying", paidOn: "2026-10-21", card: { last4: "4242", from: "checkout" } });
    expect(st.events.at(-1)).toMatchObject({ title: "Paid: $497 for the first month", detail: "By the link; their card is saved for the rest. They're on the monthly plan from today." });
    expect(st.events.at(-1)!.refs).toBeUndefined();
    // Jack set them paying by hand first: his day stands
    const hand = account();
    const h = askFirstMonth(hand, `${PAID}T10:00:00`, STRIPE)!;
    hand.dataset.business.plan = { ...hand.dataset.business.plan, stage: "paying", paidOn: "2026-10-19" };
    chargePaid(hand, h.id, "2026-10-21T12:00:00", { by: "outside" });
    expect(hand.dataset.business.plan.paidOn).toBe("2026-10-19");
    // cancelled, then paid anyway: Jack's to refund, and the plan stays cancelled
    const gone = account();
    const g = askFirstMonth(gone, `${PAID}T10:00:00`, STRIPE)!;
    cancelPlan(gone, `${PAID}T12:00:00`);
    settleMonths(gone, `${PAID}T12:00:00`);
    chargePaid(gone, g.id, "2026-10-21T12:00:00", { by: "stripe", stripe: CARD });
    expect(g.ask).toMatchObject({ kind: "refund", why: "Paid after it was cancelled (Cancelled before it was charged)" });
    expect(gone.dataset.business.plan.stage).toBe("cancelled");
    // going through on the card a one pass saved when he cancelled: paid, the plan stays cancelled (Jack looks at it)
    const late = account();
    late.dataset.business.plan = onePassPlan({ stage: "done", startedOn: "2026-09-21", card: CARD });
    const l = askFirstMonth(late, `${PAID}T10:00:00`, STRIPE)!;
    approveCharge(late, late.ownerMessages[0]!.id, `${PAID}T10:05:00`, STRIPE);
    chargeTold(late, l.id, `${PAID}T10:06:00`);
    chargeStarted(late, l.id, "2026-10-21T09:00:00");
    cancelPlan(late, "2026-10-21T09:01:00");
    expect(settleMonths(late, "2026-10-21T09:01:00")).toEqual([]);
    chargePaid(late, l.id, "2026-10-21T09:05:00", { by: "stripe", stripe: { paymentIntent: "pi_9" } });
    expect(late.dataset.business.plan).toMatchObject({ kind: "one_pass", stage: "cancelled" });
  });

  it("Done by hand marks it paid by its id, once", () => {
    const st = account();
    const c = askFirstMonth(st, `${PAID}T10:00:00`, BY_HAND)!;
    approveCharge(st, st.ownerMessages[0]!.id, `${PAID}T10:05:00`, BY_HAND);
    expect(c.status).toBe("approved");
    expect(markPaidOutside(st, { chargeId: c.id }, `${PAID}T15:00:00`)).toMatchObject({ charge: { status: "paid", reason: "Paid outside the software" } });
    expect(st.dataset.business.plan).toMatchObject({ stage: "paying", paidOn: PAID, card: { from: "paid_outside" } });
    expect(markPaidOutside(st, { chargeId: c.id }, `${PAID}T16:00:00`)).toEqual({ refused: "That charge is paid already." });
    expect(markPaidOutside(st, { chargeId: "nope" }, `${PAID}T16:00:00`)).toEqual({ refused: "No such charge." });
  });
});

describe("each month after", () => {
  it("a month that isn't free: its charge, once, from its pre-charge text, which says what goes on the card that day", () => {
    const st = paying();
    karenAsked(st);
    const m = billingCheck(st, "2026-11-18T09:00:00", STRIPE)!;
    const c = chargeOf(st, monthChargeId(st, NEXT)) as MonthCharge;
    expect(c).toMatchObject({ month: NEXT, chargeOn: NEXT, amount: 49700, via: "card", status: "heads_up" });
    expect(m).toMatchObject({ kind: "precharge", refs: [{ kind: "charge", id: NEXT }, { kind: CHARGE_REF, id: c.id }] });
    expect(m.text.split("\n").at(-1)).toBe("Your next month starts November 20: $497 goes on your card ending 4242 that day.");
    // the next days' checks: nothing more
    expect(billingCheck(st, "2026-11-19T09:00:00", STRIPE)).toBeUndefined();
    expect(months(st)).toHaveLength(1);
    // Jack's OK: approved for its own day, the text as it was
    const was = m.text;
    approveCharge(st, m.id, "2026-11-18T11:00:00", STRIPE);
    expect(c).toMatchObject({ status: "approved", chargeOn: NEXT });
    expect(m.text).toBe(was);
    // not before its text reached him, and then on its own day, however early it reached him
    expect(chargeStarted(st, c.id, `${NEXT}T09:00:00`)).toBeUndefined();
    expect(redateCharge(st, c.id, "2026-11-19T09:00:00")).toBeUndefined();
    chargeTold(st, c.id, "2026-11-18T11:00:00");
    expect(c).toMatchObject({ chargeOn: NEXT, toldAt: "2026-11-18T11:00:00" });
  });

  it("its text approved on or after its day: charged a business day after it reaches him, and the text names that day", () => {
    for (const [day, on, words] of [
      [NEXT, "2026-11-23", "on Monday, November 23"],
      ["2026-11-23", "2026-11-24", "on Tuesday, November 24"],
    ] as const) {
      const st = paying();
      karenAsked(st);
      const m = billingCheck(st, "2026-11-18T09:00:00", STRIPE)!;
      const c = months(st)[0]!;
      approveCharge(st, m.id, `${day}T10:00:00`, STRIPE);
      expect(c, day).toMatchObject({ status: "approved", chargeOn: on });
      expect(m.text.split("\n").at(-1), day).toBe(`Your next month starts November 20: $497 goes on your card ending 4242 ${words}.`);
      chargeTold(st, c.id, `${day}T10:01:00`);
      expect(c.chargeOn, day).toBe(on);
    }
  });

  it("approved before its day and not texted yet: its day holds until it comes, then moves on with today, in its text too", () => {
    const st = paying();
    karenAsked(st);
    const m = billingCheck(st, "2026-11-18T09:00:00", STRIPE)!;
    const c = months(st)[0]!;
    approveCharge(st, m.id, "2026-11-18T11:00:00", STRIPE);
    const was = m.text;
    expect(redateCharge(st, c.id, "2026-11-19T23:00:00")).toBeUndefined();
    expect(redateCharge(st, c.id, `${NEXT}T00:05:00`)).toBe(m);
    expect(c.chargeOn).toBe("2026-11-23");
    expect(m.text).toBe([...was.split("\n").slice(0, -1), "Your next month starts November 20: $497 goes on your card ending 4242 on Monday, November 23."].join("\n"));
    // Jack sends it again (back with him after the owner's STOP): from today
    expect(approveCharge(st, m.id, "2026-11-24T09:00:00", STRIPE)).toEqual({ text: m.text });
    expect(c.chargeOn).toBe("2026-11-25");
    expect(m.text.split("\n").at(-1)).toBe("Your next month starts November 20: $497 goes on your card ending 4242 on Wednesday, November 25.");
    // marked sent on its day before the worker moved it: still never charged the day it reached him
    const raced = paying();
    karenAsked(raced);
    approveCharge(raced, billingCheck(raced, "2026-11-18T09:00:00", STRIPE)!.id, "2026-11-18T11:00:00", STRIPE);
    chargeTold(raced, months(raced)[0]!.id, `${NEXT}T08:00:00`);
    expect(months(raced)[0]!.chargeOn).toBe("2026-11-23");
  });

  it("a month whose day is a holiday is charged the business day after, and its pre-charge text names that day", () => {
    for (const [paid, day, on, words] of [
      ["2026-10-26", "2026-11-26", "2026-11-30", "November 26: $497 goes on your card ending 4242 on Monday, November 30."],
      ["2026-11-25", "2026-12-25", "2026-12-28", "December 25: $497 goes on your card ending 4242 on Monday, December 28."],
    ] as const) {
      const st = paying({ paidOn: paid });
      st.touches.push(note("t-karen", "c-karen", addDays(paid, 1)));
      asked(st, "c-karen", addDays(paid, 1), "t-karen");
      const m = billingCheck(st, `${addDays(day, -2)}T09:00:00`, STRIPE)!;
      expect(months(st)[0], day).toMatchObject({ month: day, chargeOn: on });
      expect(m.text.split("\n").at(-1), day).toBe(`Your next month starts ${words}`);
      approveCharge(st, m.id, `${addDays(day, -2)}T10:00:00`, STRIPE);
      chargeTold(st, months(st)[0]!.id, `${addDays(day, -2)}T10:05:00`);
      expect(months(st)[0]!.chargeOn, day).toBe(on);
      expect(m.text.split("\n").at(-1), day).toBe(`Your next month starts ${words}`);
    }
  });

  it("its text made after its day (the worker was down) names a business day after, not the day gone", () => {
    const st = paying();
    karenAsked(st);
    const m = billingCheck(st, "2026-11-22T09:00:00", STRIPE)!;
    expect(months(st)[0]).toMatchObject({ month: NEXT, chargeOn: "2026-11-23" });
    expect(m.text.split("\n").at(-1)).toBe("Your next month starts November 20: $497 goes on your card ending 4242 on Monday, November 23.");
  });

  it("a quiet month: the free-month text, no charge", () => {
    const st = paying();
    expect(billingCheck(st, "2026-11-18T09:00:00", STRIPE)!.kind).toBe("free_month");
    expect(months(st)).toEqual([]);
  });

  it("no card saved: its pre-charge text carries the link, sent with Jack's OK", () => {
    const st = paying({ card: undefined });
    karenAsked(st);
    const m = billingCheck(st, "2026-11-18T09:00:00", STRIPE)!;
    const c = months(st)[0]!;
    expect(c).toMatchObject({ via: "link" });
    expect(c.chargeOn).toBeUndefined();
    approveCharge(st, m.id, "2026-11-18T11:00:00", STRIPE);
    expect(c.status).toBe("link_sent");
    expect(m.text.split("\n").at(-1)).toBe(`Your next month starts November 20: $497. Here's the link to pay it: https://qa.test/pay/${c.id}. It saves your card for the rest.`);
  });

  it("never a yearly plan's month, nor the last month of a paid year gone month to month (paid for by hand)", () => {
    const year = paying({ billing: "annual", yearsPaidOn: [PAID] });
    karenAsked(year);
    expect(billingCheck(year, "2026-11-18T09:00:00", STRIPE)!.text.split("\n").at(-1)).toBe("Your next month starts November 20.");
    expect(months(year)).toEqual([]);
    // MONTHLY in its last month: month to month from the year's end, the year's last month still the year's
    const switched = paying({ billing: "monthly", paidOn: "2027-10-20", yearsPaidOn: [PAID] });
    switched.touches.push(note("t-karen", "c-karen", "2027-10-01"));
    asked(switched, "c-karen", "2027-10-01", "t-karen");
    expect(billingCheck(switched, "2027-10-18T09:00:00", STRIPE)!.kind).toBe("precharge");
    expect(months(switched)).toEqual([]);
    // a yearly plan in no paid year (its renewed year taken off in Settings, never paid): still never charged here
    const unpaid = paying({ billing: "annual", paidOn: "2025-10-20", yearsPaidOn: ["2025-10-20"] });
    karenAsked(unpaid);
    expect(billingCheck(unpaid, "2026-11-18T09:00:00", STRIPE)!.kind).toBe("precharge");
    expect(months(unpaid)).toEqual([]);
  });

  it("declined: failed, and the link to pay it waits for Jack", () => {
    const st = paying();
    karenAsked(st);
    const m = billingCheck(st, "2026-11-18T09:00:00", STRIPE)!;
    const c = months(st)[0]!;
    approveCharge(st, m.id, "2026-11-18T11:00:00", STRIPE);
    chargeTold(st, c.id, "2026-11-18T11:00:00");
    chargeStarted(st, c.id, `${NEXT}T00:05:00`);
    chargeFailed(st, c.id, `${NEXT}T00:06:00`, "Your card was declined", STRIPE);
    expect(c).toMatchObject({ status: "failed", reason: "Your card was declined" });
    expect(st.ownerMessages.at(-1)).toMatchObject({ kind: "charge_retry", refs: [{ kind: CHARGE_REF, id: c.id }] });
    expect(st.events.at(-1)!.title).toBe("The $497 for the month from November 20 didn't go through");
  });
});

describe("a cancel", () => {
  it("stops every month not charged yet (and the first month asked for); one going through, or due and unpaid, stays for Jack", () => {
    const st = paying();
    const plan = st.dataset.business.plan;
    plan.months = [
      month("2026-08-20", { status: "failed" }),
      month("2026-09-20", { status: "link_sent", via: "link" }),
      month(PAID, { status: "charging" }),
      month(NEXT, { status: "approved" }),
      month("2026-12-20", { status: "heads_up" }),
      month("2026-12-21", { status: "link_sent", via: "link" }),
      month(PAID, { id: "m-first", first: true, status: "link_sent", via: "link" }),
      month("2026-08-01", { id: "m-first-declined", first: true, status: "failed" }),
    ];
    expect(settleMonths(st, "2026-11-19T10:00:00")).toEqual([]);
    cancelPlan(st, "2026-11-19T10:00:00");
    expect(settleMonths(st, "2026-11-19T10:00:00")).toEqual([`m-${NEXT}`, "m-2026-12-20", "m-2026-12-21", "m-first", "m-first-declined"]);
    expect(plan.months.map((c) => c.status)).toEqual(["failed", "link_sent", "charging", "skipped", "skipped", "skipped", "skipped", "skipped"]);
    expect(plan.months[3]!.reason).toBe("Cancelled before it was charged");
    expect(settleMonths(st, "2026-11-20T10:00:00")).toEqual([]);
  });
});

describe("where the one pass meets the monthly plan", () => {
  /** A one pass from Oct 5 gone monthly on Oct 20: Karen got its note, and Ann the monthly plan's. */
  function goneMonthly(): AccountState {
    const st = paying({ startedOn: "2026-10-05", doneOn: PAID, pricePerBooking: 250, capBookings: 4, windowDays: 60 });
    st.dataset.customers.push(customer("c-ann", { name: "Ann Lee" }));
    st.touches.push(note("t-pass", "c-karen", "2026-10-05"), note("t-month", "c-ann", "2026-10-27"));
    return st;
  }

  it("a reply to one of the pass's notes never counts toward a month being paid: it bills $250 instead", () => {
    const st = goneMonthly();
    asked(st, "c-karen", "2026-10-28", "t-pass");
    st.recoveries.push({ id: "rec-karen", customerId: "c-karen", record: { kind: "job", id: "j-karen" }, value: 2400, cameBackOn: "2026-11-02", match: "customer_id", confidence: 0.9, tier: "traced" });
    expect(guaranteeCheck(st, "2026-11-18")).toMatchObject({ free: true, asked: [] });
    expect(billableBookings(st).billable.map((x) => x.customerId)).toEqual(["c-karen"]);
    // nor one we can't tie to a note, from someone the pass wrote to, though the monthly plan wrote to her since too
    st.touches.push(note("t-karen-month", "c-karen", "2026-10-30"));
    asked(st, "c-karen", "2026-11-03");
    expect(guaranteeCheck(st, "2026-11-18")!.free).toBe(true);
    // a reply to the monthly plan's own note does
    asked(st, "c-ann", "2026-10-29", "t-month");
    expect(guaranteeCheck(st, "2026-11-18")).toMatchObject({ free: false, asked: [{ customerId: "c-ann" }] });
  });

  it("a pass cancelled before it went monthly keeps that day when the monthly plan is cancelled (and undone)", () => {
    const st = goneMonthly();
    st.dataset.business.plan.cancelledOn = "2026-10-16";
    cancelPlan(st, "2026-11-03T10:00:00", { yearly: true });
    expect(st.dataset.business.plan.cancelledOn).toBe("2026-10-16");
    undoCancel(st, "2026-11-03T11:00:00");
    expect(st.dataset.business.plan).toMatchObject({ stage: "paying", cancelledOn: "2026-10-16" });
    // a plan with no day before gets the cancel's, and loses it again on UNDO
    const plain = paying();
    cancelPlan(plain, "2026-11-03T10:00:00", { yearly: true });
    expect(plain.dataset.business.plan.cancelledOn).toBe("2026-11-03");
    undoCancel(plain, "2026-11-03T11:00:00");
    expect(plain.dataset.business.plan.cancelledOn).toBeUndefined();
  });
});
