import { afterEach, describe, expect, it } from "vitest";
import { addDays, leadCode, ledgerPass, type Charge, type Reply, type Touch } from "@qa/engine";
import { loadConfig } from "../src/config.ts";
import { READ_BACK_MS, settleBilling } from "../src/core/billing.ts";
import { localIso } from "../src/core/clock.ts";
import { tick } from "../src/core/worker.ts";
import { createStripeClient } from "../src/providers/stripe.ts";
import { ManualNotifier } from "../src/providers/sms.ts";
import type { OwnerNotifier } from "../src/contracts.ts";
import { fakeStripe, signStripe, type FakeStripe } from "./fake-stripe.ts";
import { harness, person, SECRET, TOKEN, WH, type Harness } from "./harness.ts";

/**
 * BRIEF B4: $250 per booking, capped at $1,000, against a fake Stripe. The charge log follows the ledger by customer,
 * every money text waits for Jack's OK, the /pay link makes a fresh Checkout, the worker charges saved cards and reads
 * them back after a restart, and Stripe's webhook is checked and taken once.
 */

const SK = "sk_test_51QaFake";
const WHSEC = "whsec_test_signing";
/** A Monday: the pass's first send day. */
const START = "2026-10-05";
const NAMES = ["Karen Whitfield", "Mike Sanderson", "Ann Lee", "Bob Ray", "Cal Fox", "Dee Moss", "Eli Park"];

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

/** A server with a Stripe test key and the fake behind it (or, `stripe: false`, billing by hand), Tuesday Oct 20, 10am in New Hampshire. */
function make(opts: { stripe?: boolean; notifier?: OwnerNotifier } = {}): { h: Harness; fake: FakeStripe } {
  const fake = fakeStripe();
  const withKey = opts.stripe !== false ? { stripe: createStripeClient({ key: SK, fetch: fake.fetch }), env: { STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: WHSEC } } : {};
  const h = harness({ now: "2026-10-20T14:00:00Z", notifier: opts.notifier, ...withKey });
  open.push(h);
  return { h, fake };
}

const note = (cid: string, i: number): Touch => ({ id: `t-${cid}`, opportunityId: `o-${cid}`, customerId: cid, channel: "email", step: 1, angle: "check_in", dueAt: `${START}T08:00`, sentAt: new Date(Date.parse(`${START}T08:00:00Z`) + i * 60_000).toISOString().slice(0, 19), status: "sent", body: "", flags: [] });

/** A tree shop's one pass that started Oct 5: `n` people written to that day, a minute apart; one note still to go. */
async function pass(h: Harness, n = NAMES.length, plan: Record<string, unknown> = {}): Promise<void> {
  await h.business("ridge");
  expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "one_pass", stage: "running", targetEndOn: addDays(START, 30), ...plan } })).status).toBe(200);
  await h.d.accounts.withAccount("ridge", (s) => {
    s.dataset.customers = Array.from({ length: n }, (_, i) => person(`c${i}`, NAMES[i] ?? `Person ${i}`));
    s.dataset.business.plan.startedOn = START;
    s.touches = s.dataset.customers.map((c, i) => note(c.id, i));
    s.touches.push({ ...note("c0", 0), id: "t-later", step: 2, status: "planned", dueAt: "2026-11-03T08:00", sentAt: undefined });
    s.outreach = s.dataset.customers.map((c) => ({ customerId: c.id, firstTouchOn: START, lastTouchOn: START }));
  });
}

/** `cid` wrote back to the pass's note on `day` (a yes, handed to the owner, unless `intent` says otherwise). Its code. */
async function wrote(h: Harness, cid: string, day: string, intent: Reply["intent"] = "wants_it"): Promise<string> {
  const hot = intent === "wants_it" || intent === "wants_price";
  const r: Reply = { id: `r-${cid}`, customerId: cid, touchId: `t-${cid}`, channel: "email", receivedAt: `${day}T10:00:00`, from: `${cid}@example.org`, text: "Yes please", intent, confidence: 0.95, extracted: {}, status: hot ? "handed_off" : "done", ...(hot ? { handedOffAt: `${day}T10:01:00` } : {}) };
  await h.d.accounts.withAccount("ridge", (s) => s.replies.push(r));
  return leadCode(r.id);
}

/** The owner texts BOOKED for the lead, today. */
async function booked(h: Harness, code: string): Promise<void> {
  expect(await h.sms(`BOOKED 2400 #${code}`)).toMatch(/^Booked: .*, \$2,400\. Added to your results\./);
}

/** Their export shows the customer's job (made `on`, in `status`), and the ledger reads it. */
async function exported(h: Harness, cid: string, on: string, status: "scheduled" | "cancelled", id = `job-${cid}`): Promise<void> {
  await h.d.accounts.withAccount("ridge", (s) => {
    s.dataset.jobs = [...s.dataset.jobs.filter((j) => j.id !== id), { id, customerId: cid, title: "Oak removal", lineItems: [], total: 2400, status, rawStatus: status, createdOn: on }];
    ledgerPass(s, localIso(h.now(), "America/New_York"));
  });
}

const state = (h: Harness) => h.d.accounts.peek("ridge")!.state;
const charges = (h: Harness): Charge[] => state(h).dataset.business.plan.charges ?? [];
const chargeOf = (h: Harness, cid: string) => charges(h).find((c) => c.customerId === cid);
const review = async (h: Harness) => (await h.api("GET", "/api/review")).json.items as Record<string, any>[];
const moneyTexts = async (h: Harness) => (await review(h)).filter((x) => x.kind === "owner_message" && String(x.messageKind).startsWith("charge_"));
const approve = (h: Harness, mid: string) => h.api("POST", `/api/businesses/ridge/owner-messages/${encodeURIComponent(mid)}/send`);
/** Every money text waiting for Jack, approved: what went to the owner. */
async function approveAll(h: Harness): Promise<string[]> {
  const out: string[] = [];
  for (const m of await moneyTexts(h)) {
    expect((await approve(h, m.messageId)).json.ok).toBe(true);
    out.push(h.d.accounts.repo.ownerMessages("ridge").find((x) => x.id === m.messageId)!.text);
  }
  return out;
}
const payToken = (text: string) => text.match(/\/pay\/([\w-]+\.[\w-]+)/)![1]!;

async function hook(h: Harness, ev: unknown, opts: { secret?: string; at?: number; body?: string } = {}): Promise<Response> {
  const body = JSON.stringify(ev);
  const t = opts.at ?? Math.floor(h.now().getTime() / 1000);
  return h.app.request("/webhooks/stripe", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signStripe(opts.secret ?? WHSEC, body, t) }, body: opts.body ?? body });
}

async function openPay(h: Harness, token: string): Promise<{ status: number; location: string | null; html: string }> {
  const res = await h.app.request(`/pay/${token}`);
  return { status: res.status, location: res.headers.get("location"), html: await res.text() };
}

/** The owner opens the link in the text and pays with the card ending `last4` (Stripe's events delivered). The session. */
async function payByLink(h: Harness, fake: FakeStripe, text: string, last4 = "4242"): Promise<string> {
  const r = await openPay(h, payToken(text));
  expect(r.status).toBe(303);
  const sid = r.location!.split("/").pop()!;
  for (const ev of fake.pay(sid, last4)) expect((await hook(h, ev)).status).toBe(200);
  return sid;
}

/** A pass whose owner's card ending `last4` Jack pasted, and Karen's (c0) booking on it: its text, waiting for his OK. */
async function cardPass(h: Harness, fake: FakeStripe, last4 = "4242"): Promise<string> {
  await pass(h);
  const { customer } = fake.customerWithCard(last4);
  await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer });
  await booked(h, await wrote(h, "c0", "2026-10-08"));
  await tick(h.d);
  const [m] = await moneyTexts(h);
  expect(m!.messageKind).toBe("charge_card");
  return m!.messageId;
}
const made = (fake: FakeStripe) => fake.calls.filter((c) => c.path === "/v1/payment_intents");
const textNow = (h: Harness, mid: string) => h.d.accounts.repo.ownerMessages("ridge").find((x) => x.id === mid)!.text;

/** Karen (c0) wrote back, booked, and her $250 was paid by the link: the card ending 4242 is saved. */
async function firstPaid(h: Harness, fake: FakeStripe): Promise<void> {
  await booked(h, await wrote(h, "c0", "2026-10-08"));
  await tick(h.d);
  const [text] = await approveAll(h);
  expect(text).toMatch(/^Karen Whitfield booked \(#\w{3}\)\. That's your first \$250\. Here's the link: https:\/\/qa\.test\/pay\/[\w-]+\.[\w-]+\. It saves your card for the rest, and I text before every charge\.$/);
  await payByLink(h, fake, text!);
  expect(chargeOf(h, "c0")!.status).toBe("paid");
}

describe("the first booking: the /pay link and Checkout", () => {
  it("one link text for Jack's OK; the link makes a fresh Checkout each time it's opened unpaid; paid, it says so", async () => {
    const { h, fake } = make();
    await pass(h);
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    await tick(h.d);
    const waiting = await moneyTexts(h);
    expect(waiting.map((x) => x.messageKind)).toEqual(["charge_link"]);
    const [text] = await approveAll(h);
    // never a raw Checkout URL
    expect(text).not.toMatch(/stripe/);
    const token = payToken(text!);
    const one = await openPay(h, token);
    const two = await openPay(h, token);
    expect([one.status, two.status]).toEqual([303, 303]);
    expect(one.location).not.toBe(two.location);
    const sessions = fake.calls.filter((c) => c.path === "/v1/checkout/sessions");
    const id = chargeOf(h, "c0")!.id;
    expect(sessions.map((c) => c.key)).toEqual([`${id}:checkout:0`, `${id}:checkout:1`]);
    // only the newest can be paid: the one before was expired first
    const first = one.location!.split("/").pop()!;
    expect(fake.calls.filter((c) => c.path.endsWith("/expire")).map((c) => [c.path, c.key])).toEqual([[`/v1/checkout/sessions/${first}/expire`, `${first}:expire`]]);
    expect(fake.sessions.get(first)!.status).toBe("expired");
    // one customer for the business, cards only, the card saved, the brief's line item and words
    expect(fake.customers.size).toBe(1);
    expect([...fake.customers.values()][0]!.metadata).toEqual({ business_id: "ridge" });
    expect(sessions[0]!.body).toMatchObject({
      mode: "payment",
      payment_method_types: { 0: "card" },
      customer: [...fake.customers.keys()][0],
      line_items: { 0: { quantity: "1", price_data: { currency: "usd", unit_amount: "25000", product_data: { name: "Booked job: Karen W. (Ridgeline Tree Co.)" } } } },
      payment_intent_data: { setup_future_usage: "off_session", metadata: { business_id: "ridge", charge_id: id } },
      custom_text: { submit: { message: "$250 per booked job, up to $1,000. Each later charge comes after a text." } },
      metadata: { business_id: "ridge", charge_id: id },
      success_url: "https://qa.test/pay/thanks",
    });
    expect(chargeOf(h, "c0")!.stripe!.sessions).toHaveLength(2);
    // paid in the second one: the card is saved, and the link says it's paid
    for (const ev of fake.pay(two.location!.split("/").pop()!)) await hook(h, ev);
    expect(chargeOf(h, "c0")).toMatchObject({ status: "paid", stripe: { brand: "visa", last4: "4242" } });
    expect(state(h).dataset.business.plan.card).toMatchObject({ last4: "4242", from: "checkout" });
    const paid = await openPay(h, token);
    expect(paid.status).toBe(200);
    expect(paid.html).toContain("This one is paid.");
    expect(fake.calls.filter((c) => c.path === "/v1/checkout/sessions")).toHaveLength(2);
    expect((await h.app.request("/pay/thanks")).status).toBe(200);
  });

  it("an expired session is only that session: the link makes a new one", async () => {
    const { h, fake } = make();
    await pass(h);
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    const [text] = await approveAll(h);
    const first = (await openPay(h, payToken(text!))).location!.split("/").pop()!;
    expect((await hook(h, fake.expire(first))).status).toBe(200);
    expect(chargeOf(h, "c0")!.status).toBe("link_sent");
    await payByLink(h, fake, text!);
    expect(chargeOf(h, "c0")!.status).toBe("paid");
  });

  it("a declined first try followed by a paid one ends paid", async () => {
    const { h, fake } = make();
    await pass(h);
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    const [text] = await approveAll(h);
    const sid = (await openPay(h, payToken(text!))).location!.split("/").pop()!;
    // Checkout reports the declined try, and the owner can still try again: nothing fails
    const declined = fake.pay(sid, "0002");
    expect(declined.map((e) => e.type)).toEqual(["payment_intent.payment_failed"]);
    for (const ev of declined) expect((await hook(h, ev)).status).toBe(200);
    expect(chargeOf(h, "c0")!.status).toBe("link_sent");
    for (const ev of fake.pay(sid, "4242")) await hook(h, ev);
    expect(chargeOf(h, "c0")).toMatchObject({ status: "paid", stripe: { last4: "4242" } });
    expect(fake.kept()).toHaveLength(1);
  });

  it("a link from before 'Replace all links' no longer opens (a forged one never did); its text goes again for Jack's OK with the new one", async () => {
    const { h, fake } = make();
    await pass(h);
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    const [text] = await approveAll(h);
    const token = payToken(text!);
    await h.api("POST", "/api/businesses/ridge/links/rotate");
    expect((await openPay(h, token)).status).toBe(404);
    expect((await openPay(h, `${token.slice(0, -2)}xx`)).status).toBe(404);
    const [again] = await approveAll(h);
    expect(again).toMatch(/^Karen Whitfield booked \(#\w{3}\)\. That's your first \$250\. Here's the link: https:\/\/qa\.test\/pay\/[\w-]+\.[\w-]+\. It saves your card for the rest/);
    expect(payToken(again!)).not.toBe(token);
    await payByLink(h, fake, again!);
    expect(chargeOf(h, "c0")!.status).toBe("paid");
  });

  it("Send the link again: a fresh text for Jack's OK, the one not sent yet withdrawn; only for a charge out on its link", async () => {
    const { h, fake } = make({ notifier: new ManualNotifier() });
    await pass(h);
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    const [m] = await moneyTexts(h);
    expect((await approve(h, m!.messageId)).json.delivery).toBe("manual");
    const id = chargeOf(h, "c0")!.id;
    const r = await h.api("POST", `/api/businesses/ridge/charges/${id}/link`);
    expect(r.json).toMatchObject({ ok: true, messageId: expect.any(String) });
    expect(h.d.accounts.repo.ownerMessageDelivery("ridge", m!.messageId)!.delivery).toBe("cancelled");
    expect((await moneyTexts(h)).map((x) => [x.messageId, x.messageKind])).toEqual([[r.json.messageId, "charge_link"]]);
    expect((await approve(h, r.json.messageId)).json.delivery).toBe("manual");
    await payByLink(h, fake, textNow(h, r.json.messageId));
    expect((await h.api("POST", `/api/businesses/ridge/charges/${id}/link`)).status).toBe(409);
  });

  it("paid twice (the older Checkout couldn't be expired): the second payment goes to Jack, and his refund leaves the charge paid", async () => {
    const { h, fake } = make();
    await pass(h);
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    const [text] = await approveAll(h);
    // opened on his phone, then on his computer, and the phone's Checkout couldn't be expired: he pays both
    fake.dropNext("/expire", "before");
    const one = (await openPay(h, payToken(text!))).location!.split("/").pop()!;
    const two = (await openPay(h, payToken(text!))).location!.split("/").pop()!;
    for (const ev of fake.pay(one)) await hook(h, ev);
    for (const ev of fake.pay(two)) expect((await hook(h, ev)).status).toBe(200);
    expect(fake.kept()).toHaveLength(2);
    const ask = (await review(h)).find((x) => x.kind === "charge_ask")!;
    expect(ask).toMatchObject({ customerId: "c0", ask: "paid_twice", status: "paid", refundBy: "stripe" });
    expect((await h.api("POST", `/api/businesses/ridge/charges/${ask.chargeId}/decide`, { refund: true })).json).toMatchObject({ done: "refunded", by: "stripe" });
    expect([...fake.refunds.values()].map((x) => x.payment_intent)).toEqual([fake.sessions.get(two)!.payment_intent]);
    expect(fake.kept().map((pi) => pi.id)).toEqual([fake.sessions.get(one)!.payment_intent]);
    expect(chargeOf(h, "c0")).toMatchObject({ status: "paid", stripe: { paymentIntent: fake.sessions.get(one)!.payment_intent } });
    expect(await approveAll(h)).toEqual([`Your $250 for Karen Whitfield (#${chargeOf(h, "c0")!.code}) is going back on your card.`]);
    expect((await review(h)).filter((x) => x.kind === "charge_ask")).toEqual([]);
  });

  it("marked paid outside while the owner has the link open: its Checkout is expired, and one paid anyway goes to Jack", async () => {
    const { h, fake } = make();
    await pass(h);
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    const [karen] = await approveAll(h);
    const sid = (await openPay(h, payToken(karen!))).location!.split("/").pop()!;
    expect((await h.api("POST", "/api/businesses/ridge/charges/paid", { customerId: "c0" })).json.ok).toBe(true);
    expect(fake.sessions.get(sid)!.status).toBe("expired");
    // Mike's: the expiry never reached Stripe, and he paid it
    await booked(h, await wrote(h, "c1", "2026-10-08"));
    await tick(h.d);
    const [mike] = await approveAll(h);
    const open = (await openPay(h, payToken(mike!))).location!.split("/").pop()!;
    fake.dropNext("/expire", "before");
    await h.api("POST", "/api/businesses/ridge/charges/paid", { customerId: "c1" });
    for (const ev of fake.pay(open)) await hook(h, ev);
    expect((await review(h)).filter((x) => x.kind === "charge_ask")).toMatchObject([{ customerId: "c1", ask: "paid_twice", refundBy: "stripe" }]);
    expect(chargeOf(h, "c1")).toMatchObject({ status: "paid", reason: "Paid outside the software" });
  });
});

describe("later bookings on the saved card", () => {
  it("the cap holds at 4, the cap text goes once, and a refund frees its place", async () => {
    const { h, fake } = make();
    await pass(h);
    await firstPaid(h, fake);
    for (const cid of ["c1", "c2", "c3", "c4", "c5"]) await booked(h, await wrote(h, cid, "2026-10-08"));
    await tick(h.d);
    expect(charges(h).map((c) => [c.customerId, c.status, c.via])).toEqual([
      ["c0", "paid", "link"],
      ["c1", "heads_up", "card"],
      ["c2", "heads_up", "card"],
      ["c3", "heads_up", "card"],
    ]);
    const texts = await approveAll(h);
    // approved Tuesday: charged Wednesday, and the text says so
    expect(texts).toContain(`Mike Sanderson booked (#${chargeOf(h, "c1")!.code}). $250 goes on your card ending 4242 on Wednesday, $500 of your $1,000. Not ours? Reply NOT OURS #${chargeOf(h, "c1")!.code}.`);
    expect(texts.find((t) => t.startsWith("Bob Ray"))).toContain("$1,000 of your $1,000.");
    // nothing goes on the card before its day
    await tick(h.d);
    expect(fake.calls.filter((c) => c.path === "/v1/payment_intents")).toEqual([]);
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    expect(charges(h).map((c) => c.status)).toEqual(["paid", "paid", "paid", "paid"]);
    const made = fake.calls.filter((c) => c.path === "/v1/payment_intents");
    expect(made.map((c) => c.key)).toEqual(["c1", "c2", "c3"].map((cid) => `${chargeOf(h, cid)!.id}:pi`));
    expect(made[0]!.body).toMatchObject({ amount: "25000", currency: "usd", customer: chargeOf(h, "c0")!.stripe!.customer, payment_method: state(h).dataset.business.plan.card!.paymentMethod, payment_method_types: { 0: "card" } });
    expect(fake.calls.filter((c) => c.path.endsWith("/confirm")).every((c) => c.body.off_session === "true")).toBe(true);
    expect(fake.kept().reduce((n, pi) => n + pi.amount, 0)).toBe(100_000);
    // the cap: once
    await tick(h.d);
    expect(await approveAll(h)).toEqual(["That's four, the $1,000 cap. Anything else that books from this pass is yours."]);
    await tick(h.d);
    expect(await moneyTexts(h)).toEqual([]);
    expect(chargeOf(h, "c4")).toBeUndefined();
    expect((await h.api("GET", "/api/businesses/ridge")).json.billing).toMatchObject({ billable: 4, overCap: 2 });
    // c2's job is cancelled before the work: Jack approves its refund, and c4 takes its place
    await exported(h, "c2", "2026-10-20", "scheduled");
    await exported(h, "c2", "2026-10-20", "cancelled");
    await tick(h.d);
    expect(fake.refunds.size).toBe(0);
    const ask = (await review(h)).find((x) => x.kind === "charge_ask")!;
    expect(ask).toMatchObject({ customerId: "c2", ask: "refund", why: "The job was cancelled before the work", refundBy: "stripe", amount: 250 });
    expect((await h.api("POST", `/api/businesses/ridge/charges/${ask.chargeId}/decide`, { refund: true })).json).toMatchObject({ ok: true, done: "refunded", by: "stripe" });
    expect([...fake.refunds.values()].map((r) => r.payment_intent)).toEqual([chargeOf(h, "c2")!.stripe!.paymentIntent]);
    expect(await approveAll(h)).toEqual([`Your $250 for Ann Lee (#${chargeOf(h, "c2")!.code}) is going back on your card.`]);
    await tick(h.d);
    expect(chargeOf(h, "c4")).toMatchObject({ status: "heads_up", via: "card" });
    expect(chargeOf(h, "c5")).toBeUndefined();
  });

  it("a customer with two jobs is charged once", async () => {
    const { h, fake } = make();
    await pass(h);
    await firstPaid(h, fake);
    await booked(h, await wrote(h, "c1", "2026-10-08"));
    await exported(h, "c1", "2026-10-20", "scheduled");
    await exported(h, "c1", "2026-10-29", "scheduled", "job-c1-b");
    expect(state(h).recoveries.filter((r) => r.customerId === "c1" && !r.disputed)).toHaveLength(2);
    await tick(h.d);
    await approveAll(h);
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    await tick(h.d);
    expect(charges(h).filter((c) => c.customerId === "c1").map((c) => c.status)).toEqual(["paid"]);
    expect(fake.calls.filter((c) => c.path === "/v1/payment_intents")).toHaveLength(1);
  });

  it("two booking ids for one customer (his BOOKED, then the export's job under its own id) bill once", async () => {
    const { h, fake } = make();
    await pass(h);
    await firstPaid(h, fake);
    await booked(h, await wrote(h, "c1", "2026-10-08"));
    await tick(h.d);
    const id = chargeOf(h, "c1")!.id;
    // the ledger took his BOOKED off as the same job as the export's, which came in under its own id
    await h.d.accounts.withAccount("ridge", (s) => {
      const told = s.recoveries.find((r) => r.customerId === "c1")!;
      told.disputed = { at: "2026-10-20T11:00:00", reason: "Same job as job job-c1 in their records", by: "ledger" };
      s.recoveries.push({ ...told, id: "rec-export-c1", record: { kind: "job", id: "job-c1" }, match: "customer_id", disputed: undefined });
    });
    await tick(h.d);
    expect(charges(h).filter((c) => c.customerId === "c1").map((c) => [c.id, c.status])).toEqual([[id, "heads_up"]]);
    await approveAll(h);
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    expect(fake.calls.filter((c) => c.path === "/v1/payment_intents")).toHaveLength(1);
    expect(chargeOf(h, "c1")!.status).toBe("paid");
  });

  it("a declined saved card fails; after Jack's OK the owner gets the link, and paying it saves the new card", async () => {
    const { h, fake } = make();
    await pass(h);
    const { customer } = fake.customerWithCard("0002");
    expect((await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer })).json.card).toMatchObject({ customer, last4: "0002", from: "pasted" });
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    await approveAll(h);
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    expect(chargeOf(h, "c0")).toMatchObject({ status: "failed", reason: "Your card was declined." });
    const [retry] = await moneyTexts(h);
    expect(retry!.messageKind).toBe("charge_retry");
    const [text] = await approveAll(h);
    expect(text).toMatch(/^The \$250 for Karen Whitfield \(#\w{3}\) didn't go through on your card ending 0002\. Here's the link to pay it: https:\/\/qa\.test\/pay\//);
    await payByLink(h, fake, text!);
    expect(chargeOf(h, "c0")!.status).toBe("paid");
    expect(state(h).dataset.business.plan.card).toMatchObject({ customer, last4: "4242", from: "checkout" });
  });

  it("a Stripe customer Jack pasted: later charges go on its card (its default, else the newest)", async () => {
    const { h, fake } = make();
    await pass(h);
    const { customer, paymentMethod } = fake.customerWithCard("1881", { default: true });
    fake.addCard(customer, "5555");
    expect((await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer: "cus_nope" })).json.error).toBe("Stripe doesn't know that customer.");
    expect((await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer: "not-an-id" })).status).toBe(400);
    expect((await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer })).json.card).toMatchObject({ customer, paymentMethod, last4: "1881" });
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    const [text] = await approveAll(h);
    // no link: the first one goes on his saved card too
    expect(text).toBe(`Karen Whitfield booked (#${chargeOf(h, "c0")!.code}). $250 goes on your card ending 1881 on Wednesday, $250 of your $1,000. Not ours? Reply NOT OURS #${chargeOf(h, "c0")!.code}.`);
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    expect(fake.calls.find((c) => c.path === "/v1/payment_intents")!.body).toMatchObject({ customer, payment_method: paymentMethod });
    expect(chargeOf(h, "c0")).toMatchObject({ status: "paid", stripe: { customer, paymentMethod, last4: "1881" } });
  });

  it("Stripe refusing the charge outright (the customer deleted since) fails it, so the link takes over: never left charging", async () => {
    const { h, fake } = make();
    await approve(h, await cardPass(h, fake));
    fake.customers.delete(state(h).dataset.business.plan.card!.customer!);
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    expect(chargeOf(h, "c0")).toMatchObject({ status: "failed", reason: expect.stringMatching(/^Stripe 400: No such customer/) });
    expect((await moneyTexts(h)).map((x) => x.messageKind)).toEqual(["charge_retry"]);
    // it was never charged, and the owner hears that
    const code = chargeOf(h, "c0")!.code;
    expect(await h.sms(`NOT OURS #${code}`)).toBe(`Got it: no charge for Karen Whitfield (#${code}).`);
  });

  it("Jack's OK sends only the text he approved: a booking's text made meanwhile still waits for him, its charge too", async () => {
    const { h, fake } = make();
    const karen = await cardPass(h, fake);
    // Mike books, and the worker's billing step makes his text before anything dispatches it
    await booked(h, await wrote(h, "c1", "2026-10-08"));
    await settleBilling(h.d, "ridge");
    const mike = state(h).ownerMessages.find((m) => m.kind === "charge_card" && m.refs?.some((r) => r.id === chargeOf(h, "c1")!.id))!;
    expect(h.d.accounts.repo.ownerMessageDelivery("ridge", mike.id)!.delivery).toBe("pending");
    expect((await approve(h, karen)).json).toMatchObject({ ok: true, delivery: "sent" });
    expect(h.d.accounts.repo.ownerMessageDelivery("ridge", mike.id)!.delivery).toBe("review");
    expect(chargeOf(h, "c1")!.status).toBe("heads_up");
    expect((await moneyTexts(h)).map((x) => x.messageId)).toEqual([mike.id]);
    // his OK sends it, and only then is its day set
    expect((await approve(h, mike.id)).json).toMatchObject({ ok: true, delivery: "sent" });
    expect(chargeOf(h, "c1")).toMatchObject({ status: "approved", chargeOn: "2026-10-21" });
  });

  it("a charge marked paid outside the software is never charged again", async () => {
    const { h, fake } = make();
    await pass(h);
    await firstPaid(h, fake);
    await booked(h, await wrote(h, "c1", "2026-10-08"));
    await tick(h.d);
    await approveAll(h);
    // Jack took it by hand before the day came
    expect((await h.api("POST", "/api/businesses/ridge/charges/paid", { customerId: "c1" })).json.charge).toMatchObject({ customerId: "c1", status: "paid", reason: "Paid outside the software" });
    expect((await h.api("POST", "/api/businesses/ridge/charges/paid", { customerId: "c1" })).json.error).toBe("That charge is paid already.");
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    await tick(h.d);
    expect(fake.calls.filter((c) => c.path === "/v1/payment_intents")).toEqual([]);
    expect(charges(h).filter((c) => c.customerId === "c1")).toHaveLength(1);
  });
});

describe("a saved card waits for its text to reach the owner", () => {
  it("on Texts to send, nothing is charged and its day moves on; marked sent, it's charged one business day later", async () => {
    const { h, fake } = make({ notifier: new ManualNotifier() });
    const mid = await cardPass(h, fake);
    expect((await approve(h, mid)).json.delivery).toBe("manual");
    expect(textNow(h, mid)).toContain("on Wednesday");
    // Wednesday morning, and Jack hasn't texted it yet
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    expect(made(fake)).toEqual([]);
    expect(chargeOf(h, "c0")).toMatchObject({ status: "approved", chargeOn: "2026-10-22" });
    expect((await h.api("GET", "/api/texts-to-send")).json.find((x: { messageId: string }) => x.messageId === mid).text).toContain("on Thursday");
    // he texts it and marks it sent: Thursday, as it says
    expect((await h.api("POST", `/api/businesses/ridge/owner-messages/${encodeURIComponent(mid)}/sent`)).json.ok).toBe(true);
    await tick(h.d);
    expect(chargeOf(h, "c0")).toMatchObject({ toldAt: "2026-10-21T09:00:00", chargeOn: "2026-10-22" });
    h.setNow("2026-10-21T20:00:00Z");
    await tick(h.d);
    expect(made(fake)).toEqual([]);
    h.setNow("2026-10-22T13:00:00Z");
    await tick(h.d);
    expect(chargeOf(h, "c0")!.status).toBe("paid");
  });

  it("back with Jack after the owner's STOP, nothing is charged; approved again, it goes by email and counts from then", async () => {
    const { h, fake } = make({ notifier: new ManualNotifier() });
    const mid = await cardPass(h, fake);
    await approve(h, mid);
    await h.sms("STOP");
    await tick(h.d);
    expect((await moneyTexts(h)).map((x) => x.messageId)).toEqual([mid]);
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    expect(made(fake)).toEqual([]);
    // their texts are off, so it goes by email, as it was, naming Thursday
    expect((await approve(h, mid)).json).toMatchObject({ ok: true, delivery: "sent" });
    expect(h.d.accounts.repo.ownerMessageDelivery("ridge", mid)!.channel).toBe("email");
    expect(textNow(h, mid)).toContain("on Thursday");
    await tick(h.d);
    expect(made(fake)).toEqual([]);
    h.setNow("2026-10-22T13:00:00Z");
    await tick(h.d);
    expect(chargeOf(h, "c0")!.status).toBe("paid");
  });

  it("a send that failed holds the charge; sent again, it counts from then", async () => {
    let down = true;
    const notifier: OwnerNotifier = { name: "twilio", notify: async () => (down ? Promise.reject(new Error("Twilio 503: Service Unavailable")) : { id: "SM1", channel: "sms" as const }) };
    const { h, fake } = make({ notifier });
    const mid = await cardPass(h, fake);
    // and no email to fall back on
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.business.ownerEmail = undefined;
    });
    expect((await approve(h, mid)).json.delivery).toBe("failed");
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    expect(made(fake)).toEqual([]);
    expect(textNow(h, mid)).toContain("on Thursday");
    down = false;
    expect((await approve(h, mid)).json).toMatchObject({ ok: true, delivery: "sent" });
    h.setNow("2026-10-22T13:00:00Z");
    await tick(h.d);
    expect(chargeOf(h, "c0")!.status).toBe("paid");
  });

  it("by hand (no Stripe key), 'Charge his saved card' waits for the text too", async () => {
    const { h } = make({ stripe: false, notifier: new ManualNotifier() });
    await pass(h);
    await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer: "cus_FromJacksLink" });
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    const [m] = await moneyTexts(h);
    await approve(h, m!.messageId);
    const due = async () => (await review(h)).filter((x) => x.kind === "charge_due");
    h.setNow("2026-10-22T13:00:00Z");
    await tick(h.d);
    expect(await due()).toEqual([]);
    await h.api("POST", `/api/businesses/ridge/owner-messages/${encodeURIComponent(m!.messageId)}/sent`);
    await tick(h.d);
    expect(await due()).toEqual([]);
    h.setNow("2026-10-23T13:00:00Z");
    expect(await due()).toMatchObject([{ customerId: "c0", via: "card" }]);
  });
});

describe("Stripe's webhook", () => {
  it("refuses a bad signature, an old one, a changed body and none at all; takes nothing from them", async () => {
    const { h, fake } = make();
    await pass(h);
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    const [text] = await approveAll(h);
    const sid = (await openPay(h, payToken(text!))).location!.split("/").pop()!;
    const [, completed] = fake.pay(sid);
    expect((await hook(h, completed, { secret: "whsec_someone_else" })).status).toBe(400);
    expect((await hook(h, completed, { at: Math.floor(h.now().getTime() / 1000) - 301 })).status).toBe(400);
    expect((await hook(h, completed, { body: JSON.stringify({ ...completed, id: "evt_forged" }) })).status).toBe(400);
    expect((await h.app.request("/webhooks/stripe", { method: "POST", body: JSON.stringify(completed) })).status).toBe(400);
    expect(chargeOf(h, "c0")!.status).toBe("link_sent");
    // the real one, within five minutes
    expect((await hook(h, completed, { at: Math.floor(h.now().getTime() / 1000) - 299 })).status).toBe(200);
    expect(chargeOf(h, "c0")!.status).toBe("paid");
  });

  it("a webhook retried three times, or out of order, never marks twice", async () => {
    const { h, fake } = make();
    await pass(h);
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    const [text] = await approveAll(h);
    const sid = (await openPay(h, payToken(text!))).location!.split("/").pop()!;
    const [succeeded, completed] = fake.pay(sid);
    // the session's completion first, then its PaymentIntent's success, each three times
    for (let i = 0; i < 3; i++) expect((await hook(h, completed)).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await hook(h, succeeded)).status).toBe(200);
    expect(chargeOf(h, "c0")!.status).toBe("paid");
    expect(state(h).events.filter((e) => e.title.startsWith("Paid:"))).toHaveLength(1);
    expect(h.d.accounts.repo.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM webhook_log WHERE source = 'stripe'")!.n).toBe(2);
    // a late failure for it changes nothing
    expect((await hook(h, fake.event("payment_intent.payment_failed", { ...succeeded!.data.object, status: "requires_payment_method" }))).status).toBe(200);
    expect(chargeOf(h, "c0")!.status).toBe("paid");
    // an event about something that isn't ours is taken and left alone
    expect((await hook(h, fake.event("checkout.session.completed", { id: "cs_x", payment_status: "paid", metadata: {} }))).status).toBe(200);
  });

  it("a worker restart mid-charge never charges twice: the PaymentIntent's id is kept, and it's read back", async () => {
    const { h, fake } = make();
    await pass(h);
    await firstPaid(h, fake);
    await booked(h, await wrote(h, "c1", "2026-10-08"));
    await booked(h, await wrote(h, "c2", "2026-10-08"));
    await tick(h.d);
    await approveAll(h);
    h.setNow("2026-10-21T13:00:00Z");
    // c1: Stripe made the PaymentIntent, but its answer never came back; c2: it confirmed, and that answer was lost
    fake.dropNext("POST /v1/payment_intents", "after");
    fake.dropNext("/confirm", "after");
    await tick(h.d);
    expect(chargeOf(h, "c1")).toMatchObject({ status: "charging" });
    expect(chargeOf(h, "c1")!.stripe?.paymentIntent).toBeUndefined();
    expect(chargeOf(h, "c2")).toMatchObject({ status: "charging", stripe: { paymentIntent: expect.stringMatching(/^pi_/) } });
    // a deploy: a fresh process on the same database, ten minutes on
    const again = h.restart();
    open.push(again);
    await tick(again.d);
    again.setNow(new Date(again.now().getTime() + READ_BACK_MS + 60_000).toISOString());
    await tick(again.d);
    const after = again.d.accounts.peek("ridge")!.state.dataset.business.plan.charges!;
    expect(after.map((c) => c.status)).toEqual(["paid", "paid", "paid"]);
    // c1's PaymentIntent was asked for twice with one key, and is one PaymentIntent; c2's was confirmed once
    expect(fake.calls.filter((c) => c.path === "/v1/payment_intents").map((c) => c.key)).toEqual([`${after[1]!.id}:pi`, `${after[2]!.id}:pi`, `${after[1]!.id}:pi`]);
    expect(fake.intents.size).toBe(3);
    expect(fake.calls.filter((c) => c.path === `/v1/payment_intents/${after[2]!.stripe!.paymentIntent}/confirm`)).toHaveLength(1);
    expect(fake.kept()).toHaveLength(3);
    // and Stripe's own word on c2, three times, changes nothing
    const pi = fake.intents.get(after[2]!.stripe!.paymentIntent!)!;
    for (let i = 0; i < 3; i++) expect((await hook(again, fake.event("payment_intent.succeeded", pi))).status).toBe(200);
    expect(again.d.accounts.peek("ridge")!.state.events.filter((e) => e.title === "Paid: $250 for Ann Lee")).toHaveLength(1);
  });

  it("read back as anything but paid, processing or still to confirm (declined, cancelled): failed, and the link waits for Jack", async () => {
    const { h, fake } = make();
    await pass(h);
    const { customer } = fake.customerWithCard("0002");
    await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer });
    for (const cid of ["c0", "c1"]) await booked(h, await wrote(h, cid, "2026-10-08"));
    await tick(h.d);
    await approveAll(h);
    h.setNow("2026-10-21T13:00:00Z");
    // c0: declined, and the answer was lost; c1: its confirm never reached Stripe, and Jack cancelled it there since
    fake.dropNext("/confirm", "after");
    fake.dropNext("/confirm", "before");
    await tick(h.d);
    expect(charges(h).map((c) => [c.status, !!c.stripe?.paymentIntent])).toEqual([
      ["charging", true],
      ["charging", true],
    ]);
    fake.intents.get(chargeOf(h, "c1")!.stripe!.paymentIntent!)!.status = "canceled";
    h.setNow(new Date(h.now().getTime() + READ_BACK_MS + 60_000).toISOString());
    await tick(h.d);
    expect(charges(h).map((c) => [c.status, c.reason])).toEqual([
      ["failed", "Your card was declined."],
      ["failed", "Stripe says it canceled"],
    ]);
    expect(fake.calls.filter((c) => c.path.endsWith("/confirm"))).toHaveLength(2);
    // after Jack's OK, Karen's link: paid
    const retry = (await moneyTexts(h)).find((x) => x.messageKind === "charge_retry" && String(x.text).includes("Karen Whitfield"))!;
    expect((await approve(h, retry.messageId)).json.ok).toBe(true);
    await payByLink(h, fake, textNow(h, retry.messageId));
    expect(chargeOf(h, "c0")!.status).toBe("paid");
    expect(fake.kept()).toHaveLength(1);
  });

  it("a card still processing waits for Stripe's word", async () => {
    const { h, fake } = make();
    await pass(h);
    const { customer } = fake.customerWithCard("0077");
    await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer });
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    await approveAll(h);
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    h.setNow("2026-10-21T13:30:00Z");
    await tick(h.d);
    expect(chargeOf(h, "c0")!.status).toBe("charging");
    expect((await hook(h, fake.settle(chargeOf(h, "c0")!.stripe!.paymentIntent!, true))).status).toBe(200);
    expect(chargeOf(h, "c0")!.status).toBe("paid");
  });
});

describe("what isn't billable", () => {
  it("a booking he texted whose export first shows the job cancelled: no charge before it's made, Jack's refund after", async () => {
    const { h, fake } = make();
    await pass(h);
    const { customer } = fake.customerWithCard("4242");
    await h.api("POST", "/api/businesses/ridge/stripe-customer", { customer });
    for (const cid of ["c0", "c1"]) await booked(h, await wrote(h, cid, "2026-10-08"));
    await tick(h.d);
    await approveAll(h);
    // Karen's job is cancelled before Wednesday, and the first export with it shows it only cancelled
    await exported(h, "c0", "2026-10-20", "cancelled");
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    expect(chargeOf(h, "c0")).toMatchObject({ status: "skipped", reason: "The job was cancelled before the work" });
    expect(chargeOf(h, "c1")!.status).toBe("paid");
    expect(made(fake)).toHaveLength(1);
    // Mike's was charged before his showed up cancelled: Jack is asked to refund it
    await exported(h, "c1", "2026-10-20", "cancelled");
    await tick(h.d);
    expect((await review(h)).filter((x) => x.kind === "charge_ask")).toMatchObject([{ customerId: "c1", ask: "refund", why: "The job was cancelled before the work", refundBy: "stripe" }]);
  });

  it("a booking 61 days after the reply isn't billable; one 60 days after is", async () => {
    const { h } = make();
    await pass(h);
    const late = await wrote(h, "c0", "2026-10-06");
    const inTime = await wrote(h, "c1", "2026-10-06");
    h.setNow("2026-12-05T15:00:00Z");
    await booked(h, inTime);
    h.setNow("2026-12-06T15:00:00Z");
    await booked(h, late);
    await tick(h.d);
    expect(charges(h).map((c) => c.customerId)).toEqual(["c1"]);
  });

  it("a 'stop' replier who books isn't billable", async () => {
    const { h } = make();
    await pass(h);
    await wrote(h, "c0", "2026-10-08", "stop");
    await wrote(h, "c1", "2026-10-08", "not_interested");
    // he told Jack on the phone, and Jack entered it in the console
    for (const cid of ["c0", "c1"]) await h.api("POST", `/api/businesses/ridge/replies/r-${cid}/outcome`, { outcome: "booked", value: 1800 });
    expect(state(h).recoveries.filter((r) => !r.disputed)).toHaveLength(2);
    await tick(h.d);
    expect(charges(h)).toEqual([]);
    expect((await h.api("GET", "/api/businesses/ridge")).json.billing).toMatchObject({ billable: 0, overCap: 0 });
  });

  it("freeFirst 150: the first 150 written to are free and don't count toward the cap", async () => {
    const { h } = make();
    await pass(h, 152, { freeFirst: 150 });
    for (const cid of ["c3", "c150", "c151"]) await booked(h, await wrote(h, cid, "2026-10-08"));
    await tick(h.d);
    expect((await h.api("GET", "/api/businesses/ridge")).json.billing).toMatchObject({ billable: 2, overCap: 0 });
    // the first link waits; the second waits until it's paid
    expect(charges(h).map((c) => [c.customerId, c.status])).toEqual([["c150", "heads_up"]]);
  });
});

describe("NOT OURS", () => {
  it("before the charge it cancels it, frees its place and withdraws its text; after, Jack decides and it holds its place", async () => {
    const { h, fake } = make();
    await pass(h);
    await firstPaid(h, fake);
    const mike = await wrote(h, "c1", "2026-10-08");
    const ann = await wrote(h, "c2", "2026-10-08");
    await booked(h, mike);
    await booked(h, ann);
    await tick(h.d);
    // c2's text still waits for Jack: NOT OURS withdraws it
    const mikeText = (await moneyTexts(h)).find((x) => String(x.text).startsWith("Mike Sanderson"))!;
    await approve(h, mikeText.messageId);
    expect(await h.sms(`NOT OURS #${ann}`)).toBe(`Got it: no charge for Ann Lee (#${ann}).`);
    expect(await moneyTexts(h)).toEqual([]);
    // c1's was approved, its card not charged yet: NOT OURS cancels it too
    expect(await h.sms(`Not ours #${mike}, that was her neighbor`)).toBe(`Got it: no charge for Mike Sanderson (#${mike}).`);
    expect(charges(h).map((c) => [c.customerId, c.status, c.reason])).toEqual([
      ["c0", "paid", undefined],
      ["c1", "skipped", "The owner texted NOT OURS"],
      ["c2", "skipped", "The owner texted NOT OURS"],
    ]);
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    expect(fake.calls.filter((c) => c.path === "/v1/payment_intents")).toEqual([]);
    // after: Karen's was charged. Jack decides; it holds its place meanwhile
    const karen = chargeOf(h, "c0")!.code;
    expect(await h.sms(`NOT OURS #${karen}`)).toBe(`Got it. The $250 for Karen Whitfield (#${karen}) was already charged, so Jack will look at it and text you.`);
    const ask = (await review(h)).find((x) => x.kind === "charge_ask")!;
    expect(ask).toMatchObject({ customerId: "c0", ask: "not_ours", status: "paid", refundBy: "stripe" });
    for (const cid of ["c3", "c4", "c5", "c6"]) await booked(h, await wrote(h, cid, "2026-10-08"));
    await tick(h.d);
    expect(charges(h).filter((c) => c.status !== "skipped").map((c) => c.customerId)).toEqual(["c0", "c3", "c4", "c5"]);
    expect((await h.api("POST", `/api/businesses/ridge/charges/${ask.chargeId}/decide`, { refund: true })).json).toMatchObject({ done: "refunded", by: "stripe" });
    expect(fake.kept()).toEqual([]);
    expect(state(h).recoveries.find((r) => r.customerId === "c0")!.disputed?.reason).toBe("The owner texted NOT OURS");
    await tick(h.d);
    expect(chargeOf(h, "c6")).toMatchObject({ status: "heads_up" });
    // a code nobody has goes to Jack
    expect(await h.sms("NOT OURS #ZZZ")).toBe("I couldn't find #ZZZ. Jack will read this and sort it out.");
  });

  it("for a lead with no charge yet (waiting on the link out), its job is never charged when their export brings it", async () => {
    const { h, fake } = make();
    await pass(h);
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    const mike = await wrote(h, "c1", "2026-10-08");
    await booked(h, mike);
    await tick(h.d);
    // Karen's link is out unpaid, so Mike's booking waits for it
    const [karen] = await approveAll(h);
    expect(chargeOf(h, "c1")).toBeUndefined();
    expect(await h.sms(`NOT OURS #${mike}`)).toBe(`Got it: Mike Sanderson (#${mike}) is off your bookings, so there's no charge for it.`);
    // their export brings his job under its own id; then Karen pays, which would let his charge go
    await exported(h, "c1", "2026-10-20", "scheduled");
    expect(state(h).recoveries.some((r) => r.customerId === "c1" && !r.disputed)).toBe(true);
    await payByLink(h, fake, karen!);
    await tick(h.d);
    expect(charges(h).map((c) => [c.customerId, c.status, c.reason])).toEqual([
      ["c0", "paid", undefined],
      ["c1", "skipped", "The owner texted NOT OURS"],
    ]);
    expect(await moneyTexts(h)).toEqual([]);
  });

  it("works from the console's paste-their-reply box too", async () => {
    const { h } = make({ stripe: false });
    await pass(h);
    const code = await wrote(h, "c0", "2026-10-08");
    await booked(h, code);
    await tick(h.d);
    const r = await h.api("POST", "/api/businesses/ridge/owner-texts", { text: `NOT OURS #${code}` });
    expect(r.json).toMatchObject({ reply: `Got it: no charge for Karen Whitfield (#${code}).`, handled: "not_ours", queued: true });
    expect(chargeOf(h, "c0")).toMatchObject({ status: "skipped", reason: "The owner texted NOT OURS" });
    expect(await moneyTexts(h)).toEqual([]);
  });

  it("kept by Jack, it stays charged and isn't asked again", async () => {
    const { h, fake } = make();
    await pass(h);
    await firstPaid(h, fake);
    await h.sms(`NOT OURS #${chargeOf(h, "c0")!.code}`);
    const ask = (await review(h)).find((x) => x.kind === "charge_ask")!;
    expect((await h.api("POST", `/api/businesses/ridge/charges/${ask.chargeId}/decide`, { refund: false })).json).toMatchObject({ done: "kept" });
    await tick(h.d);
    expect((await review(h)).filter((x) => x.kind === "charge_ask")).toEqual([]);
    expect(chargeOf(h, "c0")!.status).toBe("paid");
    expect(fake.refunds.size).toBe(0);
  });
});

describe("by hand (no Stripe key)", () => {
  it("each approved charge waits in Needs a person, the link to send or the saved card to charge on its day; Done marks it paid", async () => {
    const { h } = make({ stripe: false });
    await pass(h);
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    const [text] = await approveAll(h);
    expect(text).toBe(`Karen Whitfield booked (#${chargeOf(h, "c0")!.code}). That's your first $250. I'll text you the link. It saves your card for the rest, and I text before every charge.`);
    const due = (await review(h)).filter((x) => x.kind === "charge_due");
    expect(due).toMatchObject([{ customerId: "c0", name: "Karen Whitfield", via: "link", amount: 250 }]);
    expect((await h.api("POST", "/api/businesses/ridge/charges/paid", { customerId: "c0" })).json.ok).toBe(true);
    expect((await review(h)).filter((x) => x.kind === "charge_due")).toEqual([]);
    // the card his link saved: the next one is Jack's to charge, from its day
    await booked(h, await wrote(h, "c1", "2026-10-08"));
    await tick(h.d);
    expect(await approveAll(h)).toEqual([`Mike Sanderson booked (#${chargeOf(h, "c1")!.code}). $250 goes on your card on Wednesday, $500 of your $1,000. Not ours? Reply NOT OURS #${chargeOf(h, "c1")!.code}.`]);
    await tick(h.d);
    expect((await review(h)).filter((x) => x.kind === "charge_due")).toEqual([]);
    h.setNow("2026-10-21T13:00:00Z");
    expect((await review(h)).filter((x) => x.kind === "charge_due")).toMatchObject([{ customerId: "c1", via: "card" }]);
    await h.api("POST", "/api/businesses/ridge/charges/paid", { customerId: "c1" });
    expect(charges(h).map((c) => c.status)).toEqual(["paid", "paid"]);
    expect((await review(h)).filter((x) => x.kind === "charge_due")).toEqual([]);
    // no /pay links without a key, and no Stripe webhook
    expect((await h.app.request("/webhooks/stripe", { method: "POST", body: "{}" })).status).toBe(404);
  });

  it("a refund by hand: Jack refunds it himself, then says so", async () => {
    const { h } = make({ stripe: false });
    await pass(h);
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    await approveAll(h);
    await h.api("POST", "/api/businesses/ridge/charges/paid", { customerId: "c0" });
    await h.sms(`NOT OURS #${chargeOf(h, "c0")!.code}`);
    const ask = (await review(h)).find((x) => x.kind === "charge_ask")!;
    expect(ask.refundBy).toBe("hand");
    expect((await h.api("POST", `/api/businesses/ridge/charges/${ask.chargeId}/decide`, { refund: true })).json).toMatchObject({ done: "refunded", by: "hand" });
    expect(chargeOf(h, "c0")!.status).toBe("refunded");
  });
});

describe("a cancelled one pass", () => {
  it("CANCEL says what's still owed; that booking's money text still comes, nothing booked after is billed", async () => {
    const { h } = make({ stripe: false });
    await pass(h);
    h.setNow("2026-10-19T14:00:00Z");
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    h.setNow("2026-10-20T14:00:00Z");
    expect(await h.sms("CANCEL")).toMatch(/^Done — cancelled\. No more notes, and nothing that books from today on is charged\. The job booked before today is still \$250, and I text before every charge\. So far: 1 booked/);
    await booked(h, await wrote(h, "c1", "2026-10-08"));
    await tick(h.d);
    const texts = await approveAll(h);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/^Karen Whitfield booked/);
    expect(h.d.accounts.repo.ownerMessages("ridge").find((m) => m.kind === "charge_link")!.delivery).toBe("sent");
    expect(charges(h).map((c) => c.customerId)).toEqual(["c0"]);
  });

  it("with nothing owed, it's no more charges", async () => {
    const { h } = make({ stripe: false });
    await pass(h);
    expect(await h.sms("CANCEL")).toMatch(/^Done — cancelled\. No more notes, no more charges\./);
    expect(state(h).dataset.business.plan.cancelledOn).toBe("2026-10-20");
  });

  it("cancelled in Settings too: nothing booked from that day is billed", async () => {
    const { h } = make({ stripe: false });
    await pass(h);
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "cancelled" } });
    expect(state(h).dataset.business.plan.cancelledOn).toBe("2026-10-20");
    await booked(h, await wrote(h, "c0", "2026-10-08"));
    await tick(h.d);
    expect(charges(h)).toEqual([]);
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "running" } });
    expect(state(h).dataset.business.plan.cancelledOn).toBeUndefined();
  });
});

describe("the charge log is the record", () => {
  it("a Settings save, or any plan change, never drops or rewrites charges", async () => {
    const { h, fake } = make();
    await pass(h);
    await firstPaid(h, fake);
    await booked(h, await wrote(h, "c1", "2026-10-08"));
    await tick(h.d);
    const before = structuredClone(state(h).dataset.business.plan);
    // the console saves the whole plan back, and a patch could name the log itself
    const saved = { ...before, charges: [], card: { customer: "cus_evil", at: "x", from: "pasted" } };
    expect((await h.api("PATCH", "/api/businesses/ridge", { name: "Ridgeline Tree", plan: saved })).status).toBe(200);
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { capBookings: 5, windowDays: 45, targetEndOn: null } })).status).toBe(200);
    const after = state(h).dataset.business.plan;
    expect(after.charges).toEqual(before.charges);
    expect(after.card).toEqual(before.card);
    expect(after.capBookings).toBe(5);
    // and after a restart
    const again = h.restart();
    open.push(again);
    expect(again.d.accounts.peek("ridge")!.state.dataset.business.plan.charges).toEqual(before.charges);
  });

  it("the console shows billable bookings against the cap, and who each charge is for", async () => {
    const { h, fake } = make();
    await pass(h);
    await firstPaid(h, fake);
    const o = (await h.api("GET", "/api/businesses/ridge")).json;
    expect(o.billing).toEqual({ billable: 1, overCap: 0, names: { c0: "Karen Whitfield" } });
    expect(o.business.plan.charges).toHaveLength(1);
  });
});

describe("a pass gone monthly", () => {
  it("still bills its bookings: the approved charge goes on its day, and one booked after the switch gets its text", async () => {
    const { h, fake } = make();
    const mid = await cardPass(h, fake);
    expect((await approve(h, mid)).json.delivery).toBe("sent");
    await tick(h.d);
    // the owner said yes to monthly at the end text, and Jack set the plan up in Settings
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "monthly", stage: "paying" } })).status).toBe(200);
    expect(state(h).dataset.business.plan).toMatchObject({ kind: "monthly", stage: "paying", startedOn: START, doneOn: "2026-10-20" });
    h.setNow("2026-10-21T13:00:00Z");
    await tick(h.d);
    expect(chargeOf(h, "c0")!.status).toBe("paid");
    expect(made(fake)).toHaveLength(1);
    // Mike wrote back to the pass's note, and books after the switch
    await booked(h, await wrote(h, "c1", "2026-10-08"));
    await tick(h.d);
    const [m] = await moneyTexts(h);
    expect(m!.messageKind).toBe("charge_card");
    expect(m!.text).toBe(`Mike Sanderson booked (#${chargeOf(h, "c1")!.code}). $250 goes on your card ending 4242 on Thursday, $500 of your $1,000. Not ours? Reply NOT OURS #${chargeOf(h, "c1")!.code}.`);
    // the console still shows them, and Jack can still mark one paid outside the software
    expect((await h.api("GET", "/api/businesses/ridge")).json.billing).toEqual({ billable: 2, overCap: 0, names: { c0: "Karen Whitfield", c1: "Mike Sanderson" } });
    expect((await h.api("POST", "/api/businesses/ridge/charges/paid", { customerId: "c1" })).status).toBe(200);
    expect(chargeOf(h, "c1")!.status).toBe("paid");
  });
});

describe("Stripe's settings", () => {
  const base = { DATABASE_PATH: ":memory:", OPERATOR_TOKEN: TOKEN, APP_SECRET: SECRET, WEBHOOK_SECRET: WH };

  it("refuses a live key unless STRIPE_ALLOW_LIVE=true", () => {
    for (const key of ["sk_live_51Qa8Kz", "rk_live_51Qa8Kz"]) {
      expect(() => loadConfig({ ...base, STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: WHSEC })).toThrow(/live key: set STRIPE_ALLOW_LIVE=true/);
      expect(() => loadConfig({ ...base, STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_ALLOW_LIVE: "false" })).toThrow(/STRIPE_ALLOW_LIVE/);
      expect(loadConfig({ ...base, STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_ALLOW_LIVE: "true" }).STRIPE_SECRET_KEY).toBe(key);
    }
    expect(loadConfig({ ...base, STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: WHSEC }).STRIPE_ALLOW_LIVE).toBe("false");
  });

  it("a key needs the webhook's signing secret on a server with production secrets", () => {
    expect(() => loadConfig({ ...base, STRIPE_SECRET_KEY: SK })).toThrow(/STRIPE_SECRET_KEY needs STRIPE_WEBHOOK_SECRET/);
    // a laptop with the development secrets can try a test key without one
    expect(loadConfig({ DATABASE_PATH: ":memory:", STRIPE_SECRET_KEY: SK }).STRIPE_SECRET_KEY).toBe(SK);
    expect(loadConfig(base).STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("the health page says whether Stripe's events can be checked, and when the last one came", async () => {
    const { h, fake } = make();
    expect((await h.api("GET", "/api/health/setup")).json.stripeWebhook).toEqual({ secret: true, lastEventAt: null });
    await pass(h);
    await firstPaid(h, fake);
    expect((await h.api("GET", "/api/health/setup")).json.stripeWebhook).toEqual({ secret: true, lastEventAt: h.now().toISOString() });
    const manual = make({ stripe: false });
    expect((await manual.h.api("GET", "/api/health/setup")).json).toMatchObject({ stripe: "manual", stripeWebhook: null });
  });
});
