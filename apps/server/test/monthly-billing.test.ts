import { afterEach, describe, expect, it } from "vitest";
import { addDays, billableBookings, ledgerPass, type MonthCharge, type Reply, type Touch } from "@qa/engine";
import { READ_BACK_MS } from "../src/core/billing.ts";
import { localIso } from "../src/core/clock.ts";
import { tick } from "../src/core/worker.ts";
import { createStripeClient } from "../src/providers/stripe.ts";
import { ManualNotifier } from "../src/providers/sms.ts";
import type { OwnerNotifier } from "../src/contracts.ts";
import { fakeStripe, signStripe, type FakeStripe } from "./fake-stripe.ts";
import { harness, person, type Harness } from "./harness.ts";

/**
 * BRIEF B5: monthly billing on the saved card, against a fake Stripe. The owner's yes after the free 150 gets the first
 * $497 by a /pay link that saves the card (Jack approves the text); each month after, the pre-charge text two days
 * before waits for Jack, and the saved card is charged off-session on the charge date, never before it and never unless
 * that text reached the owner. A free month charges nothing, CANCEL stops the next charge, and nothing is charged twice.
 */

const SK = "sk_test_51QaFake";
const WHSEC = "whsec_test_signing";
/** Tuesday Oct 20, the day the first month is paid; its next charge date is Friday Nov 20, its pre-charge text Nov 18. */
const PAID = "2026-10-20";
const NEXT = "2026-11-20";
/** 10am in New Hampshire (after the clocks go back on Nov 1). */
const at10 = (day: string) => `${day}T15:00:00Z`;

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

/** A server with a Stripe test key and the fake behind it (or, `stripe: false`, billing by hand), Oct 20, 10am. */
function make(opts: { stripe?: boolean; notifier?: OwnerNotifier; env?: Record<string, string> } = {}): { h: Harness; fake: FakeStripe } {
  const fake = fakeStripe();
  const withKey = opts.stripe !== false ? { stripe: createStripeClient({ key: SK, fetch: fake.fetch }), env: { STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: WHSEC, ...opts.env } } : { env: opts.env };
  const h = harness({ now: "2026-10-20T14:00:00Z", notifier: opts.notifier, ...withKey });
  open.push(h);
  return { h, fake };
}

const state = (h: Harness) => h.d.accounts.peek("ridge")!.state;
const plan = (h: Harness) => state(h).dataset.business.plan;
const months = (h: Harness): MonthCharge[] => plan(h).months ?? [];
const review = async (h: Harness) => (await h.api("GET", "/api/review")).json.items as Record<string, any>[];
/** The money texts waiting for Jack's OK (not the close, nor a one pass's end text). */
const MONEY = new Set(["charge_link", "charge_card", "charge_retry", "precharge", "free_month"]);
const waiting = async (h: Harness) => (await review(h)).filter((x) => x.kind === "owner_message" && MONEY.has(x.messageKind));
const approve = (h: Harness, mid: string) => h.api("POST", `/api/businesses/ridge/owner-messages/${encodeURIComponent(mid)}/send`);
const textOf = (h: Harness, mid: string) => h.d.accounts.repo.ownerMessages("ridge").find((x) => x.id === mid)!.text;
/** Jack texted it by hand (Texts to send) and says so. */
const markSent = (h: Harness, mid: string) => h.api("POST", `/api/businesses/ridge/owner-messages/${encodeURIComponent(mid)}/sent`);
const made = (fake: FakeStripe) => fake.calls.filter((c) => c.path === "/v1/payment_intents");
const payToken = (text: string) => text.match(/\/pay\/([\w-]+\.[\w-]+)/)![1]!;

async function hook(h: Harness, ev: unknown): Promise<Response> {
  const body = JSON.stringify(ev);
  return h.app.request("/webhooks/stripe", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signStripe(WHSEC, body, Math.floor(h.now().getTime() / 1000)) }, body });
}

async function openPay(h: Harness, token: string): Promise<{ status: number; location: string | null; html: string }> {
  const res = await h.app.request(`/pay/${token}`);
  return { status: res.status, location: res.headers.get("location"), html: await res.text() };
}

/** The owner opens the link in the text and pays with the card ending `last4`. The session. */
async function payByLink(h: Harness, fake: FakeStripe, text: string, last4 = "4242"): Promise<string> {
  const r = await openPay(h, payToken(text));
  expect(r.status).toBe(303);
  const sid = r.location!.split("/").pop()!;
  for (const ev of fake.pay(sid, last4)) expect((await hook(h, ev)).status).toBe(200);
  return sid;
}

/** Ridgeline's free 150 is done and its close is out: the owner texts yes. The first month's text, waiting for Jack. */
async function saidYes(h: Harness): Promise<{ messageId: string; messageKind: string; text: string }> {
  if (!h.d.accounts.repo.exists("ridge")) await h.business("ridge");
  await h.d.accounts.withAccount("ridge", (s) => {
    s.trialCompletedOn = "2026-10-16";
    s.ownerMessages.push({ id: "om-close", at: "2026-10-19T09:00:00", kind: "close", text: "Dave, the free 150 is done. Say yes by Friday 23 and the next batch goes out next week." });
  });
  expect(await h.sms("Yes, let's keep going")).toBe("Great — Jack will text you the payment link, and the next batch goes out next week.");
  const texts = await waiting(h);
  expect(texts).toHaveLength(1);
  return texts[0] as { messageId: string; messageKind: string; text: string };
}

/** Jack approves the first month's text, and the owner pays its link with the card ending `last4`: paying from Oct 20. */
async function firstMonthPaid(h: Harness, fake: FakeStripe, last4 = "4242"): Promise<void> {
  const m = await saidYes(h);
  expect((await approve(h, m.messageId)).json.ok).toBe(true);
  await payByLink(h, fake, textOf(h, m.messageId), last4);
  expect(plan(h)).toMatchObject({ stage: "paying", paidOn: PAID });
}

/** A monthly follow-up note went to Karen on Oct 27, and she asked to come back: Nov 20's month isn't free. */
async function asked(h: Harness): Promise<void> {
  await h.d.accounts.withAccount("ridge", (s) => {
    s.dataset.customers.push(person("c-karen", "Karen Whitfield"));
    s.touches.push({ id: "t-karen", opportunityId: "o-karen", customerId: "c-karen", channel: "email", step: 1, angle: "check_in", dueAt: "2026-10-27T08:00", sentAt: "2026-10-27T08:00:00", status: "sent", body: "", flags: [] });
    s.replies.push({ id: "r-karen", customerId: "c-karen", touchId: "t-karen", channel: "email", receivedAt: "2026-10-27T10:00:00", from: "c-karen@example.org", text: "Yes, put us back on the schedule", intent: "wants_it", confidence: 0.95, extracted: {}, status: "done", handedOffAt: "2026-10-27T10:01:00", ownerContactedAt: "2026-10-27T12:00:00" });
  });
}

/** Two days before Nov 20: the worker's daily check. The pre-charge (or free month) text waiting for Jack. */
async function twoDaysBefore(h: Harness): Promise<{ messageId: string; messageKind: string; text: string }> {
  h.setNow(at10("2026-11-18"));
  await tick(h.d);
  const texts = await waiting(h);
  expect(texts).toHaveLength(1);
  return texts[0] as { messageId: string; messageKind: string; text: string };
}

describe("the first $497", () => {
  it("the owner's yes gets the /pay link for the first month, for Jack's OK; paid, the card is saved and the plan pays from that day", async () => {
    const { h, fake } = make();
    const m = await saidYes(h);
    expect(m.messageKind).toBe("charge_link");
    expect(months(h)).toMatchObject([{ first: true, month: PAID, amount: 49700, status: "heads_up", via: "link" }]);
    expect(m.text).toMatch(/^Dave, here's the link for your first month, \$497: https:\/\/qa\.test\/pay\/[\w-]+\.[\w-]+\. It saves your card, and I text before every charge\. Any month nobody asks to come back, you don't pay\.$/);
    expect(plan(h).stage).toBe("trial");
    // nothing moves before Jack's OK: the link says there's nothing to pay
    expect((await openPay(h, payToken(m.text))).html).toContain("Nothing to pay");
    expect((await approve(h, m.messageId)).json.ok).toBe(true);
    expect(months(h)[0]!.status).toBe("link_sent");
    const r = await openPay(h, payToken(textOf(h, m.messageId)));
    expect(r.status).toBe(303);
    const id = months(h)[0]!.id;
    // the same Customer and cards-only Checkout as a booking's, saving the card
    const [session] = fake.calls.filter((c) => c.path === "/v1/checkout/sessions");
    expect(session!.key).toBe(`${id}:checkout:0`);
    expect(session!.body).toMatchObject({
      mode: "payment",
      payment_method_types: { 0: "card" },
      customer: [...fake.customers.keys()][0],
      line_items: { 0: { quantity: "1", price_data: { currency: "usd", unit_amount: "49700", product_data: { name: "First month (Ridgeline Tree Co.)" } } } },
      payment_intent_data: { setup_future_usage: "off_session", metadata: { business_id: "ridge", charge_id: id } },
      custom_text: { submit: { message: "$497 a month. Each charge comes after a text, and any month nobody asks to come back, you don't pay." } },
      metadata: { business_id: "ridge", charge_id: id },
    });
    for (const ev of fake.pay(r.location!.split("/").pop()!)) await hook(h, ev);
    expect(months(h)[0]).toMatchObject({ status: "paid", stripe: { last4: "4242" } });
    expect(plan(h)).toMatchObject({ stage: "paying", paidOn: PAID, monthlyPrice: 497, card: { last4: "4242", from: "checkout" } });
    expect(state(h).events.find((e) => e.title === "Paid: $497 for the first month")!.detail).toContain("They're on the monthly plan from today.");
    // no subscription and nothing that renews: the one payment Stripe holds is this one
    expect(fake.calls.some((c) => /subscription|price|product/.test(c.path))).toBe(false);
    expect(fake.kept()).toHaveLength(1);
  });

  it("the next month goes on the card that link saved: its pre-charge text first, Jack's OK, then the charge date, never before", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    await asked(h);
    const pre = await twoDaysBefore(h);
    expect(pre.messageKind).toBe("precharge");
    expect(pre.text).toContain("• Karen Whitfield, 14 Oak Ln");
    expect(pre.text.split("\n").at(-1)).toBe("Your next month starts November 20: $497 goes on your card ending 4242 that day.");
    const month = months(h)[1]!;
    expect(month).toMatchObject({ month: NEXT, chargeOn: NEXT, status: "heads_up", via: "card", amount: 49700 });
    expect((await approve(h, pre.messageId)).json.ok).toBe(true);
    expect(textOf(h, pre.messageId)).toBe(pre.text);
    // the day before: told, not charged
    h.setNow(at10("2026-11-19"));
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ status: "approved", toldAt: expect.any(String) });
    expect(made(fake)).toEqual([]);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ status: "paid", stripe: { paymentIntent: expect.stringMatching(/^pi_/), last4: "4242" } });
    expect(made(fake)).toHaveLength(1);
    expect(made(fake)[0]).toMatchObject({ key: `${month.id}:pi`, body: { amount: "49700", customer: plan(h).card!.customer, payment_method: plan(h).card!.paymentMethod, description: "Month from November 20 (Ridgeline Tree Co.)", metadata: { business_id: "ridge", charge_id: month.id } } });
    expect(fake.calls.filter((c) => c.path.endsWith("/confirm")).map((c) => c.body)).toEqual([{ off_session: "true" }]);
    expect(fake.kept()).toHaveLength(2);
    // the worker again that day, and the next: charged once
    await tick(h.d);
    h.setNow(at10("2026-11-21"));
    await tick(h.d);
    expect(made(fake)).toHaveLength(1);
  });

  it("asked once: a second yes (or MONTHLY) while the first month waits makes nothing more", async () => {
    const { h } = make();
    await saidYes(h);
    expect(await h.sms("Monthly")).toBe("Great — month to month it is. Jack will text you the payment link.");
    expect(await h.sms("Yes")).toBe("Great — Jack will text you the payment link, and the next batch goes out next week.");
    expect(months(h)).toHaveLength(1);
    expect(await waiting(h)).toHaveLength(1);
  });

  it("a CANCEL before it's paid: no first month, its text never goes, and its link has nothing to pay", async () => {
    const { h } = make();
    const m = await saidYes(h);
    expect((await approve(h, m.messageId)).json.ok).toBe(true);
    expect(await h.sms("CANCEL")).toMatch(/^Done — cancelled\. No more notes, no more charges\. So far/);
    expect(months(h)[0]).toMatchObject({ status: "skipped", reason: "Cancelled before it was charged" });
    expect((await openPay(h, payToken(textOf(h, m.messageId)))).html).toContain("Nothing to pay");
    const { h: other } = make();
    const n = await saidYes(other);
    await other.sms("CANCEL");
    expect(other.d.accounts.repo.ownerMessageDelivery("ridge", n.messageId)).toMatchObject({ delivery: "cancelled", error: "No charge: Cancelled before it was charged" });
  });

  it("with the yearly plan sold, a plain yes is Jack's to settle: no first month by itself, and Needs a person says so", async () => {
    const { h } = make({ env: { FEATURE_YEARLY: "on" } });
    await h.business("ridge");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.ownerMessages.push({ id: "om-close", at: "2026-10-19T09:00:00", kind: "close", text: "Dave, the free 150 is done." });
    });
    await h.sms("Yes");
    expect(months(h)).toEqual([]);
    expect(state(h).events.find((e) => e.title === "Dave said yes to keep going")!.detail).toContain("send the payment link, then mark them paying");
    expect((await review(h)).find((x) => x.kind === "owner_text")).toMatchObject({ handled: "accepted_by_hand", text: "Yes" });
  });

  it("its link opened again days later makes its Checkout on the same Customer, once Stripe has forgotten the key", async () => {
    const { h, fake } = make();
    const m = await saidYes(h);
    await approve(h, m.messageId);
    const token = payToken(textOf(h, m.messageId));
    // opened, and left
    expect((await openPay(h, token)).status).toBe(303);
    const customer = months(h)[0]!.stripe!.customer!;
    h.setNow(at10("2026-10-22"));
    fake.forgetKeys();
    const r = await openPay(h, token);
    expect(r.status).toBe(303);
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === "/v1/customers")).toHaveLength(1);
    expect([...fake.customers.keys()]).toEqual([customer]);
    expect(fake.calls.filter((c) => c.path === "/v1/checkout/sessions").map((c) => c.body.customer)).toEqual([customer, customer]);
    for (const ev of fake.pay(r.location!.split("/").pop()!)) await hook(h, ev);
    expect(plan(h)).toMatchObject({ stage: "paying", card: { customer, last4: "4242" } });
  });

  it("at another monthly price, $397: the first month's text and Checkout, then each month's text and charge", async () => {
    const { h, fake } = make();
    await h.business("ridge");
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { monthlyPrice: 397 } })).status).toBe(200);
    const m = await saidYes(h);
    expect(m.text).toMatch(/^Dave, here's the link for your first month, \$397: https:\/\/qa\.test\/pay\/[\w-]+\.[\w-]+\. It saves your card, and I text before every charge\./);
    expect(months(h)[0]!.amount).toBe(39700);
    await approve(h, m.messageId);
    await payByLink(h, fake, textOf(h, m.messageId));
    expect(fake.calls.find((c) => c.path === "/v1/checkout/sessions")!.body).toMatchObject({
      line_items: { 0: { price_data: { unit_amount: "39700" } } },
      custom_text: { submit: { message: "$397 a month. Each charge comes after a text, and any month nobody asks to come back, you don't pay." } },
    });
    expect(plan(h)).toMatchObject({ stage: "paying", paidOn: PAID, monthlyPrice: 397 });
    await asked(h);
    const pre = await twoDaysBefore(h);
    expect(pre.text.split("\n").at(-1)).toBe("Your next month starts November 20: $397 goes on your card ending 4242 that day.");
    await approve(h, pre.messageId);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ amount: 39700, status: "paid" });
    expect(made(fake).map((c) => c.body.amount)).toEqual(["39700"]);
  });
});

describe("each month after", () => {
  it("a quiet month charges nothing: the free-month text goes instead", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    const free = await twoDaysBefore(h);
    expect(free.messageKind).toBe("free_month");
    expect(free.text).toContain("You won't be charged on November 20.");
    expect(months(h)).toHaveLength(1);
    expect(plan(h).freeMonths).toEqual([NEXT]);
    expect((await approve(h, free.messageId)).json.ok).toBe(true);
    for (const day of [NEXT, "2026-11-23"]) {
      h.setNow(at10(day));
      await tick(h.d);
    }
    expect(made(fake)).toEqual([]);
    expect(fake.kept()).toHaveLength(1);
  });

  it("a cancel the day before charges nothing", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    await asked(h);
    const pre = await twoDaysBefore(h);
    await approve(h, pre.messageId);
    h.setNow(at10("2026-11-19"));
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ status: "approved", toldAt: expect.any(String) });
    expect(await h.sms("CANCEL")).toMatch(/^Done — cancelled\. No more notes, no more charges\. So far/);
    expect(months(h)[1]).toMatchObject({ status: "skipped", reason: "Cancelled before it was charged" });
    for (const day of [NEXT, "2026-11-23"]) {
      h.setNow(at10(day));
      await tick(h.d);
    }
    expect(made(fake)).toEqual([]);
    expect(fake.kept()).toHaveLength(1);
  });

  it("the pre-charge text waits for Jack even with billing texts sent by themselves; cancelled before his OK, it's withdrawn", async () => {
    const { h, fake } = make({ env: { AUTO_SEND_BILLING_TEXTS: "true" } });
    await firstMonthPaid(h, fake);
    await asked(h);
    const pre = await twoDaysBefore(h);
    expect(h.d.accounts.repo.ownerMessageDelivery("ridge", pre.messageId)!.delivery).toBe("review");
    await h.sms("CANCEL");
    expect(h.d.accounts.repo.ownerMessageDelivery("ridge", pre.messageId)).toMatchObject({ delivery: "cancelled", error: "No charge: Cancelled before it was charged" });
    expect(await waiting(h)).toEqual([]);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(made(fake)).toEqual([]);
  });

  it("cancelled in Settings, the same: the month waiting for its day is never charged", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "cancelled" } })).status).toBe(200);
    expect(months(h)[1]!.status).toBe("skipped");
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(made(fake)).toEqual([]);
  });

  it("a month whose pre-charge text didn't reach the owner isn't charged; texted by hand before its day, it's charged on it", async () => {
    const { h, fake } = make({ notifier: new ManualNotifier() });
    await firstMonthPaid(h, fake);
    await asked(h);
    const pre = await twoDaysBefore(h);
    await approve(h, pre.messageId);
    // on Texts to send: Jack hasn't texted it yet
    expect(h.d.accounts.repo.ownerMessageDelivery("ridge", pre.messageId)!.delivery).toBe("manual");
    h.setNow(at10("2026-11-19"));
    await tick(h.d);
    expect(months(h)[1]!.toldAt).toBeUndefined();
    expect((await markSent(h, pre.messageId)).json.ok).toBe(true);
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ status: "approved", chargeOn: NEXT, toldAt: expect.any(String) });
    expect(textOf(h, pre.messageId)).toBe(pre.text);
    expect(made(fake)).toEqual([]);
    // texts by hand: on its day from midday, after the morning's pasted replies
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(made(fake)).toEqual([]);
    h.setNow(`${NEXT}T17:00:00Z`);
    await tick(h.d);
    expect(months(h)[1]!.status).toBe("paid");
    expect(made(fake)).toHaveLength(1);
  });

  it("left on Texts to send past its day, the text names the business day after it's texted, and the card waits for that day", async () => {
    const { h, fake } = make({ notifier: new ManualNotifier() });
    await firstMonthPaid(h, fake);
    await asked(h);
    const pre = await twoDaysBefore(h);
    await approve(h, pre.messageId);
    for (const day of [NEXT, "2026-11-23"]) {
      h.setNow(at10(day));
      await tick(h.d);
    }
    expect(months(h)[1]).toMatchObject({ status: "approved", chargeOn: "2026-11-24" });
    expect(months(h)[1]!.toldAt).toBeUndefined();
    expect(made(fake)).toEqual([]);
    expect(textOf(h, pre.messageId).split("\n").at(-1)).toBe("Your next month starts November 20: $497 goes on your card ending 4242 on Tuesday, November 24.");
    // Jack texts it on the 23rd: charged the 24th, never the day it reached him
    expect((await markSent(h, pre.messageId)).json.ok).toBe(true);
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ status: "approved", chargeOn: "2026-11-24", toldAt: expect.any(String) });
    expect(made(fake)).toEqual([]);
    h.setNow("2026-11-24T17:00:00Z");
    await tick(h.d);
    expect(months(h)[1]!.status).toBe("paid");
    expect(made(fake)).toHaveLength(1);
  });

  it("approved on or after its day, the text names the business day after it reaches him, and nothing is charged before then", async () => {
    for (const [day, on, words] of [
      [NEXT, "2026-11-23", "on Monday, November 23"],
      ["2026-11-23", "2026-11-24", "on Tuesday, November 24"],
    ] as const) {
      const { h, fake } = make();
      await firstMonthPaid(h, fake);
      await asked(h);
      const pre = await twoDaysBefore(h);
      // Jack is away: nothing moves while the text waits for him
      h.setNow(at10(day));
      await tick(h.d);
      expect(months(h)[1]!.status, day).toBe("heads_up");
      expect((await approve(h, pre.messageId)).json.ok, day).toBe(true);
      expect(h.d.accounts.repo.ownerMessageDelivery("ridge", pre.messageId)!.delivery, day).toBe("sent");
      expect(textOf(h, pre.messageId).split("\n").at(-1), day).toBe(`Your next month starts November 20: $497 goes on your card ending 4242 ${words}.`);
      h.setNow(new Date(h.now().getTime() + 60_000).toISOString());
      await tick(h.d);
      expect(months(h)[1], day).toMatchObject({ status: "approved", chargeOn: on, toldAt: expect.any(String) });
      for (let d = addDays(day, 1); d < on; d = addDays(d, 1)) {
        h.setNow(at10(d));
        await tick(h.d);
      }
      expect(made(fake), day).toEqual([]);
      h.setNow(at10(on));
      await tick(h.d);
      expect(months(h)[1]!.status, day).toBe("paid");
      expect(made(fake), day).toHaveLength(1);
    }
  });

  it("a declined month fails, and its link text waits for Jack's OK; paid by the link, the new card is saved", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    fake.addCard(plan(h).card!.customer!, "0002");
    await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer: plan(h).card!.customer });
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ status: "failed", reason: "Your card was declined." });
    const [retry] = await waiting(h);
    expect(retry).toMatchObject({ messageKind: "charge_retry" });
    expect(retry!.text).toMatch(/^Your \$497 for the month from November 20 didn't go through on your card ending 0002\. Here's the link to pay it: https:\/\/qa\.test\/pay\/[\w-]+\.[\w-]+\. It saves your card for the rest\.$/);
    expect(state(h).events.some((e) => e.title === "The $497 for the month from November 20 didn't go through")).toBe(true);
    expect((await approve(h, retry!.messageId)).json.ok).toBe(true);
    expect(months(h)[1]).toMatchObject({ status: "link_sent", via: "link" });
    await payByLink(h, fake, textOf(h, retry!.messageId));
    expect(months(h)[1]!.status).toBe("paid");
    expect(plan(h).card!.last4).toBe("4242");
  });

  it("a retried webhook never double-charges: the first month's Checkout, and a month that went through later", async () => {
    const { h, fake } = make();
    const m = await saidYes(h);
    await approve(h, m.messageId);
    const r = await openPay(h, payToken(textOf(h, m.messageId)));
    const sid = r.location!.split("/").pop()!;
    // the card ending 0077 pays at Checkout, and goes through slowly off-session
    const events = fake.pay(sid, "0077");
    for (let i = 0; i < 3; i++) for (const ev of events) expect((await hook(h, ev)).status).toBe(200);
    // a fresh delivery of the same news (another event id), the next day
    h.setNow(at10("2026-10-21"));
    expect((await hook(h, fake.event("checkout.session.completed", fake.sessions.get(sid)!))).status).toBe(200);
    expect(state(h).events.filter((e) => e.title === "Paid: $497 for the first month")).toHaveLength(1);
    expect(plan(h)).toMatchObject({ stage: "paying", paidOn: PAID });
    expect(months(h)[0]!.stripe!.again).toBeUndefined();
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(months(h)[1]!.status).toBe("charging");
    const pi = months(h)[1]!.stripe!.paymentIntent!;
    const done = fake.settle(pi, true);
    for (let i = 0; i < 3; i++) expect((await hook(h, done)).status).toBe(200);
    expect((await hook(h, fake.event("payment_intent.succeeded", fake.intents.get(pi)!))).status).toBe(200);
    await tick(h.d);
    expect(months(h)[1]!.status).toBe("paid");
    expect(state(h).events.filter((e) => e.title === "Paid: $497 for the month from November 20")).toHaveLength(1);
    expect(made(fake)).toHaveLength(1);
    expect(fake.kept()).toHaveLength(2);
  });

  it("a restart mid-charge never charges twice: the PaymentIntent's id is kept, and it's read back", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow(at10(NEXT));
    // it confirmed, and that answer was lost
    fake.dropNext("/confirm", "after");
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ status: "charging", stripe: { paymentIntent: expect.stringMatching(/^pi_/) } });
    const again = h.restart();
    open.push(again);
    await tick(again.d);
    again.setNow(new Date(again.now().getTime() + READ_BACK_MS + 60_000).toISOString());
    await tick(again.d);
    const after = again.d.accounts.peek("ridge")!.state.dataset.business.plan.months!;
    expect(after.map((c) => c.status)).toEqual(["paid", "paid"]);
    expect(made(fake)).toHaveLength(1);
    expect(fake.calls.filter((c) => c.path.endsWith("/confirm"))).toHaveLength(1);
    expect(fake.kept()).toHaveLength(2);
  });

  it("a charge already going through when the owner cancels is left to settle, and Jack sees it", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake, "0077");
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(months(h)[1]!.status).toBe("charging");
    expect(await h.sms("CANCEL")).toMatch(/^Done — cancelled\. No more notes, no more charges\. The \$497 for the month from Nov 20 was already going through, so Jack will look at it\. So far/);
    expect(h.d.accounts.repo.ownerTexts("ridge")[0]).toMatchObject({ handled: "cancel", needs_person: 1 });
    expect(months(h)[1]!.status).toBe("charging");
    for (const ev of [fake.settle(months(h)[1]!.stripe!.paymentIntent!, true)]) await hook(h, ev);
    expect(months(h)[1]!.status).toBe("paid");
  });

  it("CANCEL two days after a month was declined: nothing more is charged, and the month still unpaid goes to Jack", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    fake.addCard(plan(h).card!.customer!, "0002");
    await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer: plan(h).card!.customer });
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(months(h)[1]!.status).toBe("failed");
    h.setNow(at10("2026-11-22"));
    expect(await h.sms("CANCEL")).toMatch(/^Done — cancelled\. No more notes, no more charges\. The \$497 for the month from Nov 20 is still unpaid, so Jack will look at it\. So far/);
    expect(h.d.accounts.repo.ownerTexts("ridge")[0]).toMatchObject({ handled: "cancel", needs_person: 1 });
    expect(months(h)[1]!.status).toBe("failed");
    expect((await waiting(h)).map((x) => x.messageKind)).toEqual(["charge_retry"]);
    expect(made(fake)).toHaveLength(1);
  });

  it("a yearly plan (sold only with FEATURE_YEARLY) is never charged by this path: its year is paid for by hand", async () => {
    const { h, fake } = make({ env: { FEATURE_YEARLY: "on" } });
    await h.business("ridge");
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", billing: "annual", paidOn: PAID, yearsPaidOn: [PAID] } })).status).toBe(200);
    await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer: fake.customerWithCard("4242").customer });
    await asked(h);
    const pre = await twoDaysBefore(h);
    expect(pre.messageKind).toBe("precharge");
    expect(pre.text.split("\n").at(-1)).toBe("Your next month starts November 20.");
    await approve(h, pre.messageId);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(months(h)).toEqual([]);
    expect(made(fake)).toEqual([]);
  });
});

describe("by hand (no Stripe key)", () => {
  it("CANCEL while the first month's link is Jack's to send: he may have collected it, so he's asked, never cancelled outright", async () => {
    const { h } = make({ stripe: false });
    const m = await saidYes(h);
    await approve(h, m.messageId);
    expect((await review(h)).find((x) => x.kind === "charge_due")).toMatchObject({ via: "link", month: { first: true } });
    // the owner paid Jack's own link, then cancelled before Jack pressed Done
    const reply = await h.sms("CANCEL");
    expect(reply).toMatch(/^Done — cancelled\. No more notes\. The \$497 for your first month may have gone through, so Jack will look at it\. So far/);
    expect(months(h)[0]).toMatchObject({ status: "approved", ask: { kind: "refund", why: "Cancelled when you may have collected it by hand" } });
    expect((await review(h)).find((x) => x.kind === "charge_ask")).toMatchObject({ chargeId: months(h)[0]!.id, ask: "refund", status: "approved" });
    // it was paid: kept, it's paid, and the plan stays cancelled
    expect((await h.api("POST", `/api/businesses/ridge/charges/${encodeURIComponent(months(h)[0]!.id)}/decide`, { refund: false })).json).toMatchObject({ ok: true, done: "kept" });
    expect(months(h)[0]).toMatchObject({ status: "paid" });
    expect(plan(h).stage).toBe("cancelled");
  });

  it("the first month's link and each month's card wait in Needs a person, and Done marks them paid", async () => {
    const { h } = make({ stripe: false });
    const m = await saidYes(h);
    expect(m.text).toBe("Dave, your first month is $497. I'll text you the link. It saves your card, and I text before every charge. Any month nobody asks to come back, you don't pay.");
    expect((await review(h)).filter((x) => x.kind === "charge_due")).toEqual([]);
    await approve(h, m.messageId);
    const [link] = (await review(h)).filter((x) => x.kind === "charge_due");
    expect(link).toMatchObject({ via: "link", amount: 497, month: { on: PAID, first: true }, chargeId: months(h)[0]!.id });
    expect((await h.api("POST", "/api/businesses/ridge/charges/paid", { chargeId: link!.chargeId })).json.ok).toBe(true);
    expect(months(h)[0]).toMatchObject({ status: "paid", reason: "Paid outside the software" });
    expect(plan(h)).toMatchObject({ stage: "paying", paidOn: PAID, card: { from: "paid_outside" } });
    // Jack pastes the customer his own link made: only its id is kept
    expect((await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer: "cus_PQ8x2LmN0aB1cD" })).json.card).toMatchObject({ customer: "cus_PQ8x2LmN0aB1cD", from: "pasted" });
    await asked(h);
    const pre = await twoDaysBefore(h);
    expect(pre.text.split("\n").at(-1)).toBe("Your next month starts November 20: $497 goes on your card that day.");
    await approve(h, pre.messageId);
    h.setNow(at10("2026-11-19"));
    await tick(h.d);
    expect((await review(h)).filter((x) => x.kind === "charge_due")).toEqual([]);
    h.setNow(at10(NEXT));
    await tick(h.d);
    const [card] = (await review(h)).filter((x) => x.kind === "charge_due");
    expect(card).toMatchObject({ via: "card", amount: 497, month: { on: NEXT, first: false } });
    expect((await h.api("POST", "/api/businesses/ridge/charges/paid", { chargeId: card!.chargeId })).json.ok).toBe(true);
    expect(months(h).map((c) => c.status)).toEqual(["paid", "paid"]);
    expect((await review(h)).filter((x) => x.kind === "charge_due")).toEqual([]);
    expect((await h.api("POST", "/api/businesses/ridge/charges/paid", { chargeId: card!.chargeId })).json.error).toBe("That charge is paid already.");
  });
});

describe("a one pass's owner going monthly", () => {
  /** A tree shop's one pass that started Oct 5 and is done, its owner's card ending 4242 saved by its first booking. */
  async function donePass(h: Harness, fake: FakeStripe): Promise<void> {
    await h.business("ridge");
    await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "one_pass", stage: "running", targetEndOn: "2026-11-04" } });
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.business.plan.startedOn = "2026-10-05";
    });
    await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer: fake.customerWithCard("4242").customer });
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "done" } });
  }

  it("his yes with the card saved for the bookings: the first month goes by its link (paying it is his yes to $497), and paid, the plan is monthly from that day", async () => {
    const { h, fake } = make();
    await donePass(h, fake);
    expect(await h.sms("Monthly")).toBe("Great. Jack will text you how it works.");
    const [m] = await waiting(h);
    expect(m).toMatchObject({ messageKind: "charge_link" });
    expect(months(h)[0]).toMatchObject({ first: true, via: "link", amount: 49700 });
    await approve(h, m!.messageId);
    expect(textOf(h, m!.messageId)).toMatch(/^Dave, here's the link for your first month, \$497: https:\/\/qa\.test\/pay\/[\w-]+\.[\w-]+\. It saves your card, and I text before every charge\. Any month nobody asks to come back, you don't pay\.$/);
    await tick(h.d);
    h.setNow(at10("2026-10-21"));
    await tick(h.d);
    expect(made(fake)).toEqual([]);
    expect(months(h)[0]!.status).toBe("link_sent");
    await payByLink(h, fake, textOf(h, m!.messageId));
    expect(months(h)[0]!.status).toBe("paid");
    expect(plan(h)).toMatchObject({ kind: "monthly", stage: "paying", paidOn: "2026-10-21", monthlyPrice: 497, doneOn: PAID, startedOn: "2026-10-05" });
  });

  it("his MONTHLY while the pass still runs: paid, the pass is done that day, and the monthly plan's notes make months, never $250", async () => {
    const { h, fake } = make();
    await h.business("ridge");
    await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "one_pass", stage: "running", targetEndOn: "2026-11-04" } });
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.business.plan.startedOn = "2026-10-05";
    });
    await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer: fake.customerWithCard("4242").customer });
    expect(plan(h).doneOn).toBeUndefined();
    expect(await h.sms("Monthly")).toBe("Great. Jack will text you how it works.");
    const first = (await waiting(h))[0]!.messageId;
    await approve(h, first);
    h.setNow(at10("2026-10-21"));
    await payByLink(h, fake, textOf(h, first));
    expect(plan(h)).toMatchObject({ kind: "monthly", stage: "paying", paidOn: "2026-10-21", doneOn: "2026-10-21" });
    // Ann, written to by the monthly plan on Oct 27, asks to come back, and books Nov 2
    h.setNow(at10("2026-11-03"));
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.customers.push(person("c-ann", "Ann Lee"));
      s.touches.push({ id: "t-ann", opportunityId: "o-ann", customerId: "c-ann", channel: "email", step: 1, angle: "check_in", dueAt: "2026-10-27T08:00", sentAt: "2026-10-27T08:00:00", status: "sent", body: "", flags: [] });
      s.outreach.push({ customerId: "c-ann", firstTouchOn: "2026-10-27", lastTouchOn: "2026-10-27" });
      s.replies.push({ id: "r-ann", customerId: "c-ann", touchId: "t-ann", channel: "email", receivedAt: "2026-10-27T10:00:00", from: "c-ann@example.org", text: "Yes, put us back on the schedule", intent: "wants_it", confidence: 0.95, extracted: {}, status: "done", handedOffAt: "2026-10-27T10:01:00" });
      s.dataset.jobs = [{ id: "job-ann", customerId: "c-ann", title: "Oak removal", lineItems: [], total: 2400, status: "scheduled", rawStatus: "scheduled", createdOn: "2026-11-02" }];
      ledgerPass(s, localIso(h.now(), "America/New_York"));
    });
    expect(billableBookings(state(h))).toMatchObject({ billable: [], not: [{ customerId: "c-ann", why: "Never wrote back to the pass's notes" }] });
    // she makes the month from Nov 21 a paid one, on the card
    h.setNow(at10("2026-11-19"));
    await tick(h.d);
    const [pre] = await waiting(h);
    expect(pre).toMatchObject({ messageKind: "precharge" });
    expect(pre!.text).toContain("• Ann Lee, 14 Oak Ln");
    await approve(h, pre!.messageId);
    h.setNow(at10("2026-11-21"));
    await tick(h.d);
    expect(months(h).map((c) => [c.month, c.status])).toEqual([
      [PAID, "paid"],
      ["2026-11-21", "paid"],
    ]);
    expect(plan(h).charges ?? []).toEqual([]);
  });

  it("with the yearly plan sold, his YEARLY is Jack's to set up: no first month, and Needs a person says so", async () => {
    const { h } = make({ env: { FEATURE_YEARLY: "on" } });
    await h.business("ridge");
    await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "one_pass", stage: "done" } });
    expect(await h.sms("Yearly")).toBe("Great. Jack will text you how it works.");
    expect(months(h)).toEqual([]);
    expect(h.d.accounts.repo.ownerTexts("ridge")[0]).toMatchObject({ handled: "pass_year", needs_person: 1 });
    expect(await h.sms("Monthly")).toBe("Great. Jack will text you how it works.");
    expect(h.d.accounts.repo.ownerTexts("ridge")[0]).toMatchObject({ handled: "pass_monthly", needs_person: 1 });
    expect(months(h)).toHaveLength(1);
  });

  it("without a card saved, his yes gets the first month's link", async () => {
    const { h } = make();
    await h.business("ridge");
    await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "one_pass", stage: "done" } });
    await h.sms("Monthly");
    expect((await waiting(h))[0]).toMatchObject({ messageKind: "charge_link" });
    expect(months(h)[0]).toMatchObject({ via: "link", amount: 49700 });
  });

  it("a cancelled pass taken to monthly keeps its cancel day: its bookings after it never bill $250, whatever the monthly plan does", async () => {
    const { h } = make();
    await h.business("ridge");
    await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "one_pass", stage: "running", targetEndOn: "2026-11-04" } });
    await h.d.accounts.withAccount("ridge", (s) => {
      const b = s.dataset.business;
      b.plan.startedOn = "2026-10-05";
      s.dataset.customers = [person("c0", "Karen Whitfield")];
      s.touches = [{ id: "t-c0", opportunityId: "o-c0", customerId: "c0", channel: "email", step: 1, angle: "check_in", dueAt: "2026-10-05T08:00", sentAt: "2026-10-05T08:00:00", status: "sent", body: "", flags: [] } satisfies Touch];
      s.outreach = [{ customerId: "c0", firstTouchOn: "2026-10-05", lastTouchOn: "2026-10-05" }];
      s.replies = [{ id: "r-c0", customerId: "c0", touchId: "t-c0", channel: "email", receivedAt: "2026-10-08T10:00:00", from: "c0@example.org", text: "Yes please", intent: "wants_it", confidence: 0.95, extracted: {}, status: "handed_off", handedOffAt: "2026-10-08T10:01:00" } satisfies Reply];
    });
    await h.sms("CANCEL");
    expect(plan(h).cancelledOn).toBe(PAID);
    h.setNow(at10("2026-10-22"));
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "monthly", stage: "paying", paidOn: "2026-10-22", monthlyPrice: 497 } })).status).toBe(200);
    expect(plan(h).cancelledOn).toBe(PAID);
    // Karen's job, made after the cancel: not billable
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.jobs = [{ id: "job-c0", customerId: "c0", title: "Oak removal", lineItems: [], total: 2400, status: "scheduled", rawStatus: "scheduled", createdOn: "2026-10-21" }];
      ledgerPass(s, localIso(h.now(), "America/New_York"));
    });
    expect(billableBookings(state(h))).toMatchObject({ billable: [], not: [{ customerId: "c0", why: "Booked after the owner cancelled" }] });
    // the monthly plan cancelled later, in Settings or by text, never moves the day on
    h.setNow(at10("2026-11-03"));
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "cancelled" } })).status).toBe(200);
    expect(plan(h).cancelledOn).toBe(PAID);
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying" } })).status).toBe(200);
    expect(plan(h).cancelledOn).toBe(PAID);
    h.setNow(at10("2026-11-04"));
    await h.sms("CANCEL");
    expect(plan(h).cancelledOn).toBe(PAID);
    // a pass taken back to running (not monthly) bills again, as before
    const { h: back } = make();
    await back.business("ridge");
    await back.api("PATCH", "/api/businesses/ridge", { plan: { kind: "one_pass", stage: "running" } });
    await back.sms("CANCEL");
    await back.api("PATCH", "/api/businesses/ridge", { plan: { stage: "running" } });
    expect(back.d.accounts.peek("ridge")!.state.dataset.business.plan.cancelledOn).toBeUndefined();
  });
});

describe("CANCEL on the day a month was charged", () => {
  it("the reply never says 'no more charges', and Jack is asked to refund it or keep it", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(months(h)[1]!.status).toBe("paid");
    h.setNow(`${NEXT}T20:00:00Z`);
    const reply = await h.sms("CANCEL");
    expect(reply).toMatch(/^Done — cancelled\. No more notes\. The \$497 for the month from Nov 20 went through today, so Jack will look at it\. So far/);
    expect(reply).not.toMatch(/no more charges/);
    expect(h.d.accounts.repo.ownerTexts("ridge")[0]).toMatchObject({ handled: "cancel", needs_person: 1 });
    const ask = (await review(h)).find((x) => x.kind === "charge_ask")!;
    expect(ask).toMatchObject({ chargeId: months(h)[1]!.id, ask: "refund", refundBy: "stripe" });
    expect((await h.api("POST", `/api/businesses/ridge/charges/${encodeURIComponent(ask.chargeId)}/decide`, { refund: true })).json).toMatchObject({ ok: true, done: "refunded", by: "stripe" });
    expect(months(h)[1]!.status).toBe("refunded");
    // a month paid the day before stays as it was
    await tick(h.d);
    expect((await review(h)).filter((x) => x.kind === "charge_ask")).toEqual([]);
  });

  it("texts by hand: the CANCEL Jack pastes on the charge day's morning comes before the card", async () => {
    const { h, fake } = make({ notifier: new ManualNotifier() });
    await firstMonthPaid(h, fake);
    await asked(h);
    const pre = await twoDaysBefore(h);
    await approve(h, pre.messageId);
    await markSent(h, pre.messageId);
    // midnight passes; the owner's CANCEL from last night is pasted at 10am
    h.setNow(`${NEXT}T05:30:00Z`);
    await tick(h.d);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(made(fake)).toEqual([]);
    expect(await h.sms("CANCEL")).toMatch(/^Done — cancelled\. No more notes, no more charges\./);
    h.setNow(`${NEXT}T19:00:00Z`);
    await tick(h.d);
    expect(made(fake)).toEqual([]);
    expect(months(h)[1]).toMatchObject({ status: "skipped" });
  });
});

describe("a no to the pre-charge text", () => {
  /** Mike Sanderson asked back, was handed to the owner Nov 17, and hasn't been called. */
  const mikeWaiting = (h: Harness) =>
    h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.customers.push(person("c-mike", "Mike Sanderson"));
      s.touches.push({ id: "t-mike", opportunityId: "o-mike", customerId: "c-mike", channel: "email", step: 1, angle: "check_in", dueAt: "2026-11-10T08:00", sentAt: "2026-11-10T08:00:00", status: "sent", body: "", flags: [] });
      s.replies.push({ id: "r-mike", customerId: "c-mike", touchId: "t-mike", channel: "email", receivedAt: "2026-11-17T10:00:00", from: "c-mike@example.org", text: "Can you come back in the spring?", intent: "wants_it", confidence: 0.95, extracted: {}, status: "handed_off", handedOffAt: "2026-11-17T10:01:00" });
    });
  const NO = "Got it — Jack will read this before anything is charged. To cancel the service, text CANCEL. About a lead? Text NO and the #code.";

  for (const said of ["No, cancel", "No", "Nope", "No don't", "No not this month"])
    it(`"${said}": no lead is marked, Jack reads it, and the month waits for his word`, async () => {
      const { h, fake } = make();
      await firstMonthPaid(h, fake);
      await asked(h);
      await mikeWaiting(h);
      await approve(h, (await twoDaysBefore(h)).messageId);
      h.setNow("2026-11-18T22:00:00Z");
      expect(await h.sms(said)).toBe(NO);
      expect(state(h).replies.find((r) => r.id === "r-mike")).toMatchObject({ status: "handed_off" });
      expect(state(h).replies.find((r) => r.id === "r-mike")!.outcome).toBeUndefined();
      expect(h.d.accounts.repo.ownerTexts("ridge")[0]).toMatchObject({ handled: "money_no", needs_person: 1 });
      expect(months(h)[1]).toMatchObject({ status: "approved", ask: { kind: "hold" } });
      expect((await review(h)).find((x) => x.kind === "charge_ask")).toMatchObject({ chargeId: months(h)[1]!.id, ask: "hold" });
      // its day comes: nothing goes on the card
      h.setNow(at10(NEXT));
      await tick(h.d);
      expect(made(fake)).toEqual([]);
    });

  it("with nobody waiting on a call: Jack reads it; he cancels the month, and it's never charged", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow("2026-11-18T22:00:00Z");
    expect(await h.sms("No, cancel")).toBe(NO);
    const id = months(h)[1]!.id;
    expect((await h.api("POST", `/api/businesses/ridge/charges/${encodeURIComponent(id)}/decide`, { refund: true })).json).toMatchObject({ ok: true, done: "skipped" });
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ status: "skipped" });
    expect(made(fake)).toEqual([]);
  });

  it("about something else: Jack lets it go on as planned, and the card is charged on its day", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow("2026-11-18T22:00:00Z");
    expect(await h.sms("No")).toBe(NO);
    const id = months(h)[1]!.id;
    expect((await h.api("POST", `/api/businesses/ridge/charges/${encodeURIComponent(id)}/decide`, { refund: false })).json).toMatchObject({ ok: true, done: "kept" });
    expect(months(h)[1]!.ask).toBeUndefined();
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ status: "paid" });
    expect(made(fake)).toHaveLength(1);
  });
});

describe("a pass gone monthly, with the pass's own cancel day kept", () => {
  /** As a one pass cancelled Oct 5, then taken to monthly: its old cancel day stays, for its bookings only. */
  const passBefore = (h: Harness) => h.d.accounts.withAccount("ridge", (s) => void Object.assign(s.dataset.business.plan, { startedOn: "2026-09-21", doneOn: PAID, cancelledOn: "2026-10-05" }));

  it("CANCEL on the day a month was charged is judged on its own day: Jack is asked to refund it or keep it", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    await passBefore(h);
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(months(h)[1]!.status).toBe("paid");
    h.setNow(`${NEXT}T20:00:00Z`);
    expect(await h.sms("CANCEL")).toMatch(/^Done — cancelled\. No more notes\. The \$497 for the month from Nov 20 went through today, so Jack will look at it\. So far/);
    expect((await review(h)).find((x) => x.kind === "charge_ask")).toMatchObject({ chargeId: months(h)[1]!.id, ask: "refund", why: "Charged the day they cancelled" });
    // the pass's bookings still go by its own day
    expect(plan(h).cancelledOn).toBe("2026-10-05");
  });

  it("by hand, cancelled in Settings after a card month's day came: the month he may have charged stays for Jack", async () => {
    const { h } = make({ stripe: false });
    const m = await saidYes(h);
    await approve(h, m.messageId);
    await h.api("POST", "/api/businesses/ridge/charges/paid", { chargeId: months(h)[0]!.id });
    await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer: "cus_PQ8x2LmN0aB1cD" });
    await passBefore(h);
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect((await review(h)).find((x) => x.kind === "charge_due")).toMatchObject({ via: "card", month: { on: NEXT } });
    h.setNow(`${NEXT}T21:00:00Z`);
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "cancelled" } })).status).toBe(200);
    expect(months(h)[1]).toMatchObject({ status: "approved", ask: { kind: "refund" } });
    expect(plan(h).cancelledOn).toBe("2026-10-05");
  });
});

describe("a month judged again before it's charged", () => {
  const relabel = (h: Harness, rid: string, intent: Reply["intent"]) => h.api("POST", `/api/businesses/ridge/replies/${rid}/intent`, { intent });

  it("Jack relabels the only reply that asked before approving the pre-charge text: no charge, and the free-month text waits instead", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    await asked(h);
    const pre = await twoDaysBefore(h);
    expect(pre.text).toContain("Karen Whitfield");
    expect((await relabel(h, "r-karen", "already_done")).status).toBe(200);
    expect((await approve(h, pre.messageId)).status).toBe(409);
    expect(months(h)[1]).toMatchObject({ status: "skipped", reason: "Free: nobody asked to come back" });
    expect(plan(h).freeMonths).toEqual([NEXT]);
    const [free] = await waiting(h);
    expect(free).toMatchObject({ messageKind: "free_month" });
    expect(free!.text).toContain("You won't be charged on November 20.");
    for (const day of [NEXT, "2026-11-23"]) {
      h.setNow(at10(day));
      await tick(h.d);
    }
    expect(made(fake)).toEqual([]);
    expect((await waiting(h)).map((x) => x.messageKind)).toEqual(["free_month"]);
  });

  it("relabelled after the pre-charge text went: the worker skips the month before its day and the free-month text waits", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow(at10("2026-11-19"));
    expect((await relabel(h, "r-karen", "stop")).status).toBe(200);
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ status: "skipped", reason: "Free: nobody asked to come back" });
    expect(plan(h).freeMonths).toEqual([NEXT]);
    expect((await waiting(h)).map((x) => x.messageKind)).toEqual(["free_month"]);
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(made(fake)).toEqual([]);
  });

  it("still not free: the pre-charge text's 'who came back' is written from the replies as they are now", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    await asked(h);
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.customers.push(person("c-mike", "Mike Sanderson"));
      s.touches.push({ id: "t-mike", opportunityId: "o-mike", customerId: "c-mike", channel: "email", step: 1, angle: "check_in", dueAt: "2026-10-28T08:00", sentAt: "2026-10-28T08:00:00", status: "sent", body: "", flags: [] });
      s.replies.push({ id: "r-mike", customerId: "c-mike", touchId: "t-mike", channel: "email", receivedAt: "2026-10-28T10:00:00", from: "c-mike@example.org", text: "How much for the spring cleanup?", intent: "wants_price", confidence: 0.95, extracted: {}, status: "done", handedOffAt: "2026-10-28T10:01:00", ownerContactedAt: "2026-10-28T12:00:00" });
    });
    const pre = await twoDaysBefore(h);
    expect(pre.text).toContain("Karen Whitfield");
    expect(pre.text).toContain("Mike Sanderson");
    await relabel(h, "r-karen", "already_done");
    expect((await approve(h, pre.messageId)).json.ok).toBe(true);
    const sent = textOf(h, pre.messageId);
    expect(sent).not.toContain("Karen Whitfield");
    expect(sent).toContain("Mike Sanderson");
    expect(sent.split("\n").at(-1)).toBe("Your next month starts November 20: $497 goes on your card ending 4242 that day.");
    h.setNow(at10(NEXT));
    await tick(h.d);
    expect(months(h)[1]!.status).toBe("paid");
  });
});

/** The first month marked paid outside (Jack's own link) with a key set: no card Stripe can charge, so later months go by their link. */
async function paidOutside(h: Harness): Promise<void> {
  const m = await saidYes(h);
  await approve(h, m.messageId);
  expect((await h.api("POST", "/api/businesses/ridge/charges/paid", { chargeId: months(h)[0]!.id })).json.ok).toBe(true);
  expect(plan(h)).toMatchObject({ stage: "paying", paidOn: PAID, card: { from: "paid_outside" } });
}

describe("Replace all links with a month's link out", () => {
  it("withdraws its pre-charge text not sent yet (it carries the old link), and the new link's text waits for Jack", async () => {
    const { h } = make({ notifier: new ManualNotifier() });
    await paidOutside(h);
    await asked(h);
    const pre = await twoDaysBefore(h);
    expect(pre.text.split("\n").at(-1)).toMatch(/^Your next month starts November 20: \$497\. Here's the link to pay it: https:\/\/qa\.test\/pay\//);
    await approve(h, pre.messageId);
    expect(months(h)[1]).toMatchObject({ status: "link_sent", via: "link" });
    expect(h.d.accounts.repo.ownerMessageDelivery("ridge", pre.messageId)!.delivery).toBe("manual");
    const old = payToken(textOf(h, pre.messageId));
    await h.api("POST", "/api/businesses/ridge/links/rotate");
    expect(h.d.accounts.repo.ownerMessageDelivery("ridge", pre.messageId)).toMatchObject({ delivery: "cancelled", error: "Sent again with the link as it is now" });
    const [again] = await waiting(h);
    expect(again).toMatchObject({ messageKind: "charge_link" });
    expect(payToken(again!.text)).not.toBe(old);
    expect((await openPay(h, old)).status).toBe(404);
  });
});

describe("First paid day corrected in Settings while a month is on its way", () => {
  it("makes no second month for the same period: one pre-charge text, one charge", async () => {
    const { h, fake } = make();
    await firstMonthPaid(h, fake);
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    // the owner really paid three days earlier: Jack corrects the day, and the charge date it gives was the day before yesterday
    h.setNow(at10("2026-11-19"));
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { paidOn: "2026-10-17" } })).status).toBe(200);
    await tick(h.d);
    expect(months(h)).toHaveLength(2);
    expect(await waiting(h)).toEqual([]);
    for (const day of [NEXT, "2026-11-23", "2026-11-24"]) {
      h.setNow(at10(day));
      await tick(h.d);
    }
    expect(months(h).map((c) => c.status)).toEqual(["paid", "paid"]);
    expect(made(fake)).toHaveLength(1);
    // moved forward after the month was paid: no charge five days later either
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { paidOn: "2026-10-25" } })).status).toBe(200);
    for (const day of ["2026-11-25", "2026-11-26"]) {
      h.setNow(at10(day));
      await tick(h.d);
    }
    expect(months(h)).toHaveLength(2);
    expect(await waiting(h)).toEqual([]);
    expect(made(fake)).toHaveLength(1);
  });
});

describe("a month paid by its link before its day", () => {
  /** Paying from Oct 20 (its first month paid outside, so no card Stripe can charge); Karen asked; Nov 20's link paid Nov 18. */
  async function paidEarly(h: Harness, fake: FakeStripe): Promise<void> {
    await paidOutside(h);
    await asked(h);
    const pre = await twoDaysBefore(h);
    await approve(h, pre.messageId);
    await payByLink(h, fake, textOf(h, pre.messageId));
    expect(months(h)[1]).toMatchObject({ status: "paid", paidAt: expect.stringMatching(/^2026-11-18/) });
  }

  it("then CANCEL the day before it: the reply says it went through, and Jack is asked to refund it or keep it", async () => {
    const { h, fake } = make();
    await paidEarly(h, fake);
    h.setNow(at10("2026-11-19"));
    const reply = await h.sms("CANCEL");
    expect(reply).toMatch(/^Done — cancelled\. No more notes\. The \$497 for the month from Nov 20 went through, so Jack will look at it\. So far/);
    expect(h.d.accounts.repo.ownerTexts("ridge")[0]).toMatchObject({ handled: "cancel", needs_person: 1 });
    const ask = (await review(h)).find((x) => x.kind === "charge_ask")!;
    expect(ask).toMatchObject({ chargeId: months(h)[1]!.id, ask: "refund", refundBy: "stripe" });
    expect((await h.api("POST", `/api/businesses/ridge/charges/${encodeURIComponent(ask.chargeId)}/decide`, { refund: true })).json).toMatchObject({ ok: true, done: "refunded", by: "stripe" });
    expect(fake.kept()).toEqual([]);
  });

  it("then found free (a reply read again before its day): Jack is asked to refund it, and the free-month text waits", async () => {
    const { h, fake } = make();
    await paidEarly(h, fake);
    h.setNow(at10("2026-11-19"));
    expect((await h.api("POST", "/api/businesses/ridge/replies/r-karen/intent", { intent: "already_done" })).status).toBe(200);
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ status: "paid", ask: { kind: "refund" } });
    expect(plan(h).freeMonths).toEqual([NEXT]);
    expect((await waiting(h)).map((x) => x.messageKind)).toEqual(["free_month"]);
    expect((await review(h)).filter((x) => x.kind === "charge_ask")).toMatchObject([{ chargeId: months(h)[1]!.id, ask: "refund" }]);
    // asked once
    await tick(h.d);
    expect((await waiting(h)).map((x) => x.messageKind)).toEqual(["free_month"]);
  });

  it("by hand (no Stripe key): Done before its day, then CANCEL the day before: Jack is asked too", async () => {
    const { h } = make({ stripe: false });
    // set paying by hand (Jack's own link), no card on file
    await h.business("ridge");
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", paidOn: PAID } })).status).toBe(200);
    await asked(h);
    const pre = await twoDaysBefore(h);
    expect(pre.text.split("\n").at(-1)).toBe("Your next month starts November 20: $497. I'll text you the link.");
    await approve(h, pre.messageId);
    expect((await review(h)).find((x) => x.kind === "charge_due")).toMatchObject({ via: "link", chargeId: months(h)[0]!.id });
    expect((await h.api("POST", "/api/businesses/ridge/charges/paid", { chargeId: months(h)[0]!.id })).json.ok).toBe(true);
    h.setNow(at10("2026-11-19"));
    expect(await h.sms("CANCEL")).toMatch(/^Done — cancelled\. No more notes\. The \$497 for the month from Nov 20 went through, so Jack will look at it\./);
    expect((await review(h)).find((x) => x.kind === "charge_ask")).toMatchObject({ chargeId: months(h)[0]!.id, ask: "refund", refundBy: "hand" });
  });
});

describe("by hand (no Stripe key), a card month whose day has come", () => {
  /** Paying from Oct 20 (Done, and the cus_ id pasted); Karen asked; Nov 18's pre-charge text sent. Nov 20: "Charge his saved card". */
  async function due(h: Harness): Promise<string> {
    const m = await saidYes(h);
    await approve(h, m.messageId);
    await h.api("POST", "/api/businesses/ridge/charges/paid", { chargeId: months(h)[0]!.id });
    await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer: "cus_PQ8x2LmN0aB1cD" });
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow(at10(NEXT));
    await tick(h.d);
    const [card] = (await review(h)).filter((x) => x.kind === "charge_due");
    expect(card).toMatchObject({ via: "card", month: { on: NEXT, first: false } });
    return card!.chargeId;
  }

  for (const [when, at] of [
    ["that afternoon", `${NEXT}T21:00:00Z`],
    ["the next morning", at10("2026-11-21")],
  ] as const)
    it(`CANCEL ${when}: the month he may have charged already stays for Jack, and the reply never says "no more charges"`, async () => {
      const { h } = make({ stripe: false });
      const id = await due(h);
      h.setNow(at);
      const reply = await h.sms("CANCEL");
      // never "was already going through": Jack may not have charged it yet
      expect(reply).toMatch(/^Done — cancelled\. No more notes\. The \$497 for the month from Nov 20 may have gone through, so Jack will look at it\. So far/);
      expect(h.d.accounts.repo.ownerTexts("ridge")[0]).toMatchObject({ handled: "cancel", needs_person: 1 });
      expect(months(h)[1]).toMatchObject({ status: "approved", ask: { kind: "refund" } });
      expect((await review(h)).find((x) => x.kind === "charge_ask")).toMatchObject({ chargeId: id, ask: "refund", refundBy: "hand", status: "approved" });
      // he had charged it, and keeps it: it's paid, and "Charge his saved card" never comes back
      expect((await h.api("POST", `/api/businesses/ridge/charges/${encodeURIComponent(id)}/decide`, { refund: false })).json).toMatchObject({ ok: true, done: "kept" });
      expect(months(h)[1]).toMatchObject({ status: "paid", reason: "Paid outside the software" });
      await tick(h.d);
      expect((await review(h)).filter((x) => x.kind === "charge_due" || x.kind === "charge_ask")).toEqual([]);
    });

  it("CANCEL after its day: he had charged it and refunded it in Stripe, so it's refunded and the owner's refund text waits for his OK", async () => {
    const { h } = make({ stripe: false });
    const id = await due(h);
    h.setNow(`${NEXT}T21:00:00Z`);
    await h.sms("CANCEL");
    expect((await h.api("POST", `/api/businesses/ridge/charges/${encodeURIComponent(id)}/decide`, { refund: true, charged: true })).json).toMatchObject({ ok: true, done: "refunded", by: "hand" });
    expect(months(h)[1]).toMatchObject({ status: "refunded" });
    expect((await review(h)).filter((x) => x.kind === "owner_message" && x.messageKind === "charge_refund").map((x) => x.text)).toEqual(["Your $497 for the month from November 20 is going back on your card."]);
    expect((await review(h)).filter((x) => x.kind === "charge_due" || x.kind === "charge_ask")).toEqual([]);
  });

  it("he hadn't charged it: his answer cancels it, and nothing is left to collect", async () => {
    const { h } = make({ stripe: false });
    const id = await due(h);
    h.setNow(`${NEXT}T21:00:00Z`);
    await h.sms("CANCEL");
    expect((await h.api("POST", `/api/businesses/ridge/charges/${encodeURIComponent(id)}/decide`, { refund: true })).json).toMatchObject({ ok: true, done: "skipped" });
    await tick(h.d);
    expect(months(h)[1]!.status).toBe("skipped");
    expect((await review(h)).filter((x) => x.kind === "charge_due" || x.kind === "charge_ask")).toEqual([]);
  });

  it("a reply read again after its day: Jack is asked, and the month isn't dropped", async () => {
    const { h } = make({ stripe: false });
    const id = await due(h);
    h.setNow(at10("2026-11-21"));
    expect((await h.api("POST", "/api/businesses/ridge/replies/r-karen/intent", { intent: "already_done" })).status).toBe(200);
    await tick(h.d);
    expect(months(h)[1]).toMatchObject({ status: "approved", ask: { kind: "refund" } });
    expect((await review(h)).find((x) => x.kind === "charge_ask")).toMatchObject({ chargeId: id, ask: "refund" });
    expect((await waiting(h)).map((x) => x.messageKind)).toEqual(["free_month"]);
  });

  it("CANCEL the day before its day still charges nothing", async () => {
    const { h } = make({ stripe: false });
    const m = await saidYes(h);
    await approve(h, m.messageId);
    await h.api("POST", "/api/businesses/ridge/charges/paid", { chargeId: months(h)[0]!.id });
    await asked(h);
    await approve(h, (await twoDaysBefore(h)).messageId);
    h.setNow(at10("2026-11-19"));
    expect(await h.sms("CANCEL")).toMatch(/^Done — cancelled\. No more notes, no more charges\./);
    expect(months(h)[1]).toMatchObject({ status: "skipped" });
  });
});
