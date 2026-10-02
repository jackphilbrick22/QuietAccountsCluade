import {
  approveCharge,
  askFirstMonth,
  bookingWho,
  capReached,
  cardOnFile,
  CHARGE_REF,
  CHARGE_TEXTS,
  chargeFailed,
  chargeOf,
  chargePaid,
  chargeRefunded,
  chargeStarted,
  chargeTold,
  customerById,
  decideCharge,
  decideFound,
  fmtMoney,
  isMonth,
  linkAgain,
  markPaidOutside,
  moneyTextLive,
  monthName,
  ONE_PASS,
  paidTwice,
  passEndText,
  pasteCard,
  recheckMonths,
  redateCharge,
  settleCharges,
  settleMonths,
  textsOf,
  type AccountState,
  type BillingOpts,
  type Charge,
  type MonthCharge,
  type PlanState,
} from "@qa/engine";
import { NotFound } from "./accounts.ts";
import { localIso } from "./clock.ts";
import { deliverOwnerMessages, linkToken, readLinkToken, verifySigned, type Deps } from "./ops.ts";
import { StripeError, type StripeCheckoutSession, type StripeEvent, type StripePaymentIntent, type StripePaymentMethod } from "../providers/stripe.ts";

/**
 * Billing on the server: a one pass's (BRIEF B4) and the monthly plan's (B5). The charge log kept up with the ledger,
 * the months from the owner's yes and each pre-charge text, the money texts through Jack's OK, the /pay link's
 * Checkout, saved cards charged off-session by the worker, Stripe's webhook, refunds on his OK. No subscription and no
 * link that renews: nothing is charged but by this path. Without a Stripe key it's all by hand: each approved charge
 * waits in Needs a person with a Done button.
 */

const MONEY_TEXTS = new Set<string>(CHARGE_TEXTS);
/** How long a charge may sit "charging" before it's read back from Stripe (a restart mid-charge, a webhook that never came). */
export const READ_BACK_MS = 10 * 60_000;
/** With owner texts by hand, a saved card is charged on its day from this local hour, after the morning's pasted replies. */
export const CHARGE_FROM_HOUR = 12;

const nowOf = (d: Deps, state: AccountState) => localIso(d.clock(), state.dataset.business.timezone);

export function billingOpts(d: Deps, bid: string): BillingOpts {
  const withdrawn = (id: string) => d.accounts.repo.ownerMessageDelivery(bid, id)?.delivery === "cancelled";
  return d.stripe ? { stripe: true, payLink: (id) => payLink(d, bid, id), withdrawn } : { stripe: false, withdrawn };
}

/** The owner's stable link for one charge: a fresh Checkout each time it's opened unpaid. Rotating links kills it. */
export function payLink(d: Deps, bid: string, chargeId: string): string {
  return `${d.cfg.PUBLIC_URL.replace(/\/$/, "")}/pay/${linkToken(d, `pay|${chargeId}`, bid)}`;
}

/** The business and charge a /pay link is for: none when it's forged, rotated away, or its business is gone. */
export function readPayToken(d: Deps, token: string): { bid: string; chargeId: string } | undefined {
  const payload = verifySigned(d.cfg.APP_SECRET, token);
  const chargeId = payload?.startsWith("pay|") ? payload.split("|")[1] : undefined;
  const bid = chargeId ? readLinkToken(d, `pay|${chargeId}`, token) : undefined;
  return bid && chargeId ? { bid, chargeId } : undefined;
}

/**
 * The business's Stripe customer for a charge's Checkout: the saved card's, else the one this charge's own Checkout
 * made, else one an earlier Checkout made (a booking's or a month's).
 */
function stripeCustomer(plan: PlanState, c: Charge | MonthCharge): string | undefined {
  return plan.card?.customer ?? c.stripe?.customer ?? [...(plan.charges ?? []), ...(plan.months ?? [])].find((x) => x.stripe?.customer)?.stripe?.customer;
}

/** "Booked job: Karen W. (Dow's Tree Service)", "First month (Dow's Tree Service)", "Month from November 1 (...)" */
function lineName(state: AccountState, c: Charge | MonthCharge): string {
  if (isMonth(c)) return `${c.first ? "First month" : `Month from ${monthName(c.month)} ${Number(c.month.slice(8))}`} (${state.dataset.business.name})`;
  const who = customerById(state.dataset, c.customerId);
  const short = who?.firstName ? `${who.firstName}${who.lastName ? ` ${who.lastName[0]}.` : ""}` : (bookingWho(state, c.customerId, c.code) ?? "a customer");
  return `Booked job: ${short} (${state.dataset.business.name})`;
}

function cardOf(pi: StripePaymentIntent | undefined): Pick<NonNullable<Charge["stripe"]>, "paymentMethod" | "brand" | "last4"> {
  const pm = pi?.payment_method;
  if (!pm) return {};
  if (typeof pm === "string") return { paymentMethod: pm };
  return { paymentMethod: pm.id, brand: pm.card?.brand, last4: pm.card?.last4 };
}

/**
 * Money texts (a month's pre-charge text too) that no longer say something true of their charge never go: any not
 * sent yet about a charge cancelled, and one still waiting for Jack's OK whose charge moved on (paid by hand, its retry
 * no longer needed).
 */
export function withdrawStaleTexts(d: Deps, bid: string): void {
  const s = d.accounts.peek(bid)?.state;
  if (!s) return;
  for (const m of s.ownerMessages) {
    if (!MONEY_TEXTS.has(m.kind) && m.kind !== "precharge") continue;
    // the cap text, once a place is open again (a refund, or one waiting on Jack): written anew when the cap fills
    if (m.kind === "charge_cap") {
      if (!capReached(s.dataset.business.plan)) d.accounts.repo.withdrawOwnerMessage(bid, m.id, "Not true now: a place under the cap is open again");
      continue;
    }
    const c = chargeOf(s, m.refs?.find((r) => r.kind === CHARGE_REF)?.id ?? "");
    if (!c || moneyTextLive(c, m.kind)) continue;
    const delivery = d.accounts.repo.ownerMessageDelivery(bid, m.id)?.delivery ?? "";
    if (delivery === "review" || (c.status === "skipped" && ["failed", "pending", "manual"].includes(delivery)))
      d.accounts.repo.withdrawOwnerMessage(bid, m.id, c.status === "skipped" ? `No charge: ${c.reason}` : `Not needed: the charge is ${c.status.replace("_", " ")}`);
  }
}

/**
 * The charge log brought up to the ledger: new bookings' texts wait for Jack, charges whose booking went are cancelled,
 * and so are the months not charged yet once the owner cancelled. A saved card's charge counts its day from when its
 * text (a later month's: its pre-charge text) reached the owner (sent, or texted by hand and marked sent); until then a
 * booking's day moves on with today (a later month's, once its own day came), on Texts to send too.
 */
export async function settleBilling(d: Deps, bid: string): Promise<void> {
  let free: MonthCharge[] = [];
  await d.accounts.withAccount(bid, (state) => {
    const now = nowOf(d, state);
    const plan = state.dataset.business.plan;
    free = recheck(d, bid, state, now).free;
    settleCharges(state, now, billingOpts(d, bid));
    settleMonths(state, now);
    for (const c of [...(plan.charges ?? []), ...(plan.months ?? [])]) {
      if (c.via !== "card" || c.status !== "approved" || c.toldAt) continue;
      const m = textsOf(state, c).findLast((x) => x.kind === "charge_card" || x.kind === "precharge");
      const went = m && d.accounts.repo.ownerMessageDelivery(bid, m.id);
      if (went?.delivery === "sent" && went.delivered_at) chargeTold(state, c.id, localIso(new Date(went.delivered_at), state.dataset.business.timezone));
      else if (redateCharge(state, c.id, now) && m) d.accounts.repo.setOwnerMessageText(bid, m.id, m.text);
    }
  });
  withdrawStaleTexts(d, bid);
  for (const c of free) await expireCheckout(d, bid, c);
}

/**
 * The months not charged yet, judged again on the replies as they read now (recheckMonths): one free after all is
 * skipped, its free-month text made; a pre-charge text waiting for Jack is written again. The months skipped, and
 * those of them whose link was out (their Checkout is expired by the caller).
 */
function recheck(d: Deps, bid: string, state: AccountState, now: string): { free: MonthCharge[]; skipped: string[] } {
  const out = state.dataset.business.plan.months?.filter((c) => c.status === "link_sent").map((c) => structuredClone(c)) ?? [];
  const r = recheckMonths(state, now);
  for (const m of r.rewritten) d.accounts.repo.setOwnerMessageText(bid, m.id, m.text);
  return { free: out.filter((c) => r.skipped.includes(c.id)), skipped: r.skipped };
}

/**
 * The worker's turn: the charge log, then saved cards due today whose text reached the owner (and any left mid-charge,
 * read back from Stripe), a booking's or a month's.
 */
export async function runBilling(d: Deps, bid: string): Promise<void> {
  await settleBilling(d, bid);
  if (!d.stripe) return;
  const s = d.accounts.peek(bid)!.state;
  const tz = s.dataset.business.timezone;
  const local = localIso(d.clock(), tz);
  const today = local.slice(0, 10);
  // owner texts by hand (SMS_PROVIDER=manual): on its day from midday, so the owner's CANCEL or NOT OURS from the
  // evening before, which reaches the server only when Jack pastes it in the morning, comes first
  const from = d.notifier.name === "manual" ? CHARGE_FROM_HOUR : 0;
  const due = (on: string) => on < today || (on === today && Number(local.slice(11, 13)) >= from);
  const stale = localIso(new Date(d.clock().getTime() - READ_BACK_MS), tz);
  // a card Stripe can't charge (a customer pasted with no key, paid outside) waits for Jack in Needs a person
  const card = cardOnFile(s.dataset.business.plan, true);
  for (const c of [...(s.dataset.business.plan.charges ?? []), ...(s.dataset.business.plan.months ?? [])])
    if (c.via === "card" && ((card && c.status === "approved" && c.toldAt && due(c.chargeOn ?? today)) || (c.status === "charging" && (c.triedAt ?? "") <= stale))) await chargeCard(d, bid, c.id);
}

/**
 * A charge on the saved card, the brief's way: the PaymentIntent made unconfirmed (key `{chargeId}:pi`), its id stored,
 * then confirmed off-session. One already made (a restart, a confirm that never answered) is read back by its id and
 * acted on: confirmed if it still needs it, left for the webhook while processing, else paid or failed.
 */
async function chargeCard(d: Deps, bid: string, id: string): Promise<void> {
  const stripe = d.stripe!;
  let c: Charge | MonthCharge | undefined;
  let card: PlanState["card"];
  let name = "";
  await d.accounts.withAccount(bid, (state) => {
    card = state.dataset.business.plan.card;
    // nothing to charge it on, and nothing made yet: Jack's to collect, never a decline
    if (!chargeOf(state, id)?.stripe?.paymentIntent && !cardOnFile(state.dataset.business.plan, true)) return;
    const claimed = chargeStarted(state, id, nowOf(d, state));
    c = claimed && structuredClone(claimed);
    if (claimed) name = lineName(state, claimed);
  });
  if (!c) return;
  let pi: StripePaymentIntent | undefined;
  let refused: string | undefined;
  let gone = false;
  try {
    if (c.stripe?.paymentIntent) pi = await stripe.retrievePaymentIntent(c.stripe.paymentIntent);
    else if (card?.customer && card.paymentMethod) {
      pi = await stripe.createPaymentIntent(
        { amount: c.amount, currency: "usd", customer: card.customer, payment_method: card.paymentMethod, payment_method_types: ["card"], description: name, metadata: { business_id: bid, charge_id: id } },
        `${id}:pi`,
      );
      const made = pi.id;
      await d.accounts.withAccount(bid, (state) => {
        const x = chargeOf(state, id);
        if (x) x.stripe = { ...x.stripe, customer: card!.customer, paymentIntent: made, paymentMethod: card!.paymentMethod, brand: card!.brand, last4: card!.last4 };
      });
    }
    if (pi?.status === "requires_confirmation") pi = await stripe.confirmPaymentIntent(pi.id, { off_session: true }, `${id}:confirm`);
  } catch (e) {
    // a decline answers with the PaymentIntent as it now stands, and Stripe refusing it outright (the customer or its
    // card gone) fails it, so the link takes over; a lost answer or Stripe's own error leaves it charging, read back later
    if (!(e instanceof StripeError) || (e.retryable && !e.paymentIntent)) {
      d.log(`[billing] ${bid} charge ${id}: ${(e as Error).message}`);
      return;
    }
    pi = e.paymentIntent;
    if (!pi) refused = e.message;
    // the customer or its card is gone from Stripe: never tried again, and the link makes a new customer
    gone = !pi && e.code === "resource_missing";
  }
  await settleIntent(d, bid, id, pi, refused, gone ? card : undefined);
}

/**
 * What Stripe says of a saved card's PaymentIntent (or that it refused it), on the charge. Processing waits for the
 * webhook. A card Stripe no longer has (`gone`) is no saved card any more: later charges go by the link.
 */
async function settleIntent(d: Deps, bid: string, id: string, pi: StripePaymentIntent | undefined, refused?: string, gone?: PlanState["card"]): Promise<void> {
  await d.accounts.withAccount(bid, (state) => {
    const now = nowOf(d, state);
    const plan = state.dataset.business.plan;
    if (gone?.customer && plan.card?.customer === gone.customer && plan.card.paymentMethod === gone.paymentMethod) plan.card = { ...plan.card, customer: undefined, paymentMethod: undefined };
    if (refused || !pi) chargeFailed(state, id, now, refused ?? "No saved card to charge", billingOpts(d, bid));
    else if (pi.status === "succeeded") chargePaid(state, id, now, { by: "stripe", stripe: { paymentIntent: pi.id, ...cardOf(pi) } });
    else if (pi.status !== "processing" && pi.status !== "requires_confirmation") chargeFailed(state, id, now, pi.last_payment_error?.message ?? `Stripe says it ${pi.status.replace(/_/g, " ")}`, billingOpts(d, bid));
  });
  await deliverOwnerMessages(d, bid);
}

/**
 * The owner said yes to the monthly plan (BRIEF B5): the first month's text, with the /pay link that saves the card (or
 * on the card a one pass saved), waits for Jack's OK. Nothing when a first month stands already.
 */
export async function firstMonth(d: Deps, bid: string): Promise<void> {
  await d.accounts.withAccount(bid, (state) => {
    askFirstMonth(state, nowOf(d, state), billingOpts(d, bid));
  });
  await deliverOwnerMessages(d, bid);
}

/**
 * Jack approves a money text (from the money-text approval): the charge moves on with it, and the text is written
 * again with the day it's charged, or its link. Refused (and withdrawn) when the charge moved on meanwhile.
 */
export async function approveChargeText(d: Deps, bid: string, messageId: string): Promise<{ refused?: string }> {
  let r: ReturnType<typeof approveCharge>;
  let re: ReturnType<typeof recheck> = { free: [], skipped: [] };
  // a month is judged again first: one free after all is never charged, and its free-month text waits instead
  await d.accounts.withAccount(bid, (state) => {
    re = recheck(d, bid, state, nowOf(d, state));
    r = approveCharge(state, messageId, nowOf(d, state), billingOpts(d, bid));
  });
  if (re.skipped.length) {
    withdrawStaleTexts(d, bid);
    for (const c of re.free) await expireCheckout(d, bid, c);
    await deliverOwnerMessages(d, bid);
  }
  if (!r!) return {};
  if ("refused" in r!) {
    d.accounts.repo.withdrawOwnerMessage(bid, messageId, r.refused);
    return { refused: r.refused };
  }
  d.accounts.repo.setOwnerMessageText(bid, messageId, r!.text);
  return {};
}

/**
 * Jack approves a one pass's end text: its tally ("You paid $X") is written again from the charges as they are now.
 * Held while a saved card's charge is on its way (approved, or going through): a day later its total would be wrong.
 */
export async function approvePassEnd(d: Deps, bid: string, messageId: string): Promise<{ refused?: string }> {
  let refused: string | undefined;
  let text: string | undefined;
  await d.accounts.withAccount(bid, (state) => {
    const m = state.ownerMessages.find((x) => x.id === messageId && x.kind === "pass_end");
    if (!m) return;
    if ((state.dataset.business.plan.charges ?? []).some((c) => c.status === "charging" || (c.status === "approved" && c.via === "card")))
      refused = "A charge is on its way to his card: approve this once it's paid, so what it says he paid is right.";
    else text = m.text = [passEndText(state, m.at.slice(0, 10)).split("\n\n")[0], ...m.text.split("\n\n").slice(1)].join("\n\n");
  });
  if (text) d.accounts.repo.setOwnerMessageText(bid, messageId, text);
  return refused ? { refused } : {};
}

export type PayPage = { redirect: string } | { page: "paid" | "nothing" | "gone" };

/** A charge's last Checkout can't be paid any more (it's paid another way, or a new one is made); one done or gone already is fine. */
async function expireCheckout(d: Deps, bid: string, c: Charge | MonthCharge): Promise<void> {
  const last = c.stripe?.sessions?.at(-1);
  if (d.stripe && last) await d.stripe.expireCheckoutSession(last, `${last}:expire`).catch((e: Error) => d.log(`[billing] ${bid} session ${last}: ${e.message}`));
}

/**
 * The owner opens his /pay link: paid already says so; a charge waiting on the link gets a fresh Checkout Session
 * (cards only, the card saved for the rest), key `{chargeId}:checkout:{n}` for the n-th made, and he's sent to it. The
 * one made before is expired first, so only one can be paid (a second payment that gets through goes to Jack).
 */
export async function openPay(d: Deps, token: string): Promise<PayPage> {
  const t = readPayToken(d, token);
  const s = t && d.accounts.peek(t.bid)?.state;
  const c = s && chargeOf(s, t.chargeId);
  if (!t || !s || !c) return { page: "gone" };
  if (c.status === "paid") return { page: "paid" };
  if (c.status !== "link_sent" || !d.stripe) return { page: "nothing" };
  const b = s.dataset.business;
  const n = c.stripe?.sessions?.length ?? 0;
  const newCustomer = async (key: string) => (await d.stripe!.createCustomer({ name: b.name, email: b.ownerEmail, phone: b.ownerPhone, metadata: { business_id: b.id } }, key)).id;
  let customer = stripeCustomer(b.plan, c) ?? (await newCustomer(`${c.id}:customer`));
  const price = b.plan.pricePerBooking ?? ONE_PASS.pricePerBooking;
  const terms = isMonth(c)
    ? `${fmtMoney(c.amount / 100)} a month. Each charge comes after a text, and any month nobody asks to come back, you don't pay.`
    : `${fmtMoney(price)} per booked job, up to ${fmtMoney(price * (b.plan.capBookings ?? ONE_PASS.capBookings))}. Each later charge comes after a text.`;
  const base = d.cfg.PUBLIC_URL.replace(/\/$/, "");
  const metadata = { business_id: b.id, charge_id: c.id };
  // The last Checkout may be paid already, its event not here yet (a restart, a delivery Stripe retries later): Stripe's
  // word on it settles the charge as the webhook would, and no second Checkout is made. One it says is open is expired
  // first, so only the new one can be paid; one paid in between is the same.
  const last = c.stripe?.sessions?.at(-1);
  const stripe = d.stripe;
  const paidThere = async (id: string): Promise<boolean> => {
    const cs = await stripe.retrieveCheckoutSession(id);
    if (cs.status !== "complete") return false;
    if (cs.payment_status === "paid") await settleCheckout(d, t.bid, c.id, cs);
    return true;
  };
  let done = !!last && (await paidThere(last));
  if (last && !done)
    await stripe.expireCheckoutSession(last, `${last}:expire`).catch(async (e: Error) => {
      d.log(`[billing] ${t.bid} session ${last}: ${e.message}`);
      done = await paidThere(last);
    });
  if (done) return { page: chargeOf(d.accounts.peek(t.bid)!.state, c.id)?.status === "paid" ? "paid" : "nothing" };
  const checkout = (key: string) =>
    stripe.createCheckoutSession(
      {
        mode: "payment",
        payment_method_types: ["card"],
        customer,
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: c.amount, product_data: { name: lineName(s, c) } } }],
        payment_intent_data: { setup_future_usage: "off_session", metadata },
        custom_text: { submit: { message: terms } },
        metadata,
        success_url: `${base}/pay/thanks`,
        cancel_url: `${base}/pay/${token}`,
      },
      key,
    );
  let session: StripeCheckoutSession;
  try {
    session = await checkout(`${c.id}:checkout:${n}`);
  } catch (e) {
    // the customer is gone from Stripe (deleted since, or a test-mode one): a new one, once
    if (!(e instanceof StripeError) || e.code !== "resource_missing" || !/customer/i.test(e.message)) throw e;
    d.log(`[billing] ${t.bid} charge ${c.id}: ${e.message}; a new Stripe customer`);
    customer = await newCustomer(`${c.id}:customer:${n + 1}`);
    session = await checkout(`${c.id}:checkout:${n}:${customer}`);
  }
  await d.accounts.withAccount(t.bid, (state) => {
    const x = chargeOf(state, c.id);
    if (x) x.stripe = { ...x.stripe, customer, sessions: [...new Set([...(x.stripe?.sessions ?? []), session.id])] };
  });
  return session.url ? { redirect: session.url } : { page: "nothing" };
}

/**
 * One of Stripe's events, once its signature checked out. A link's charge is paid only by its Checkout completing paid
 * (a declined try inside Checkout fires payment_intent.payment_failed while the owner can still retry); one already
 * paid by another payment asks Jack to refund that one. A saved card's settles on its PaymentIntent. Each change is
 * guarded by the charge's status, so a replay changes nothing.
 */
export async function stripeEvent(d: Deps, ev: StripeEvent): Promise<{ businessId?: string; note?: string }> {
  const o = ev.data.object as { id: string; metadata?: Record<string, string> };
  const bid = o.metadata?.business_id;
  const id = o.metadata?.charge_id;
  const c = bid && id && d.accounts.repo.exists(bid) ? chargeOf(d.accounts.peek(bid)!.state, id) : undefined;
  if (!bid || !id || !c) return { note: "not one of our charges" };
  const settle = async (fn: (state: AccountState, now: string) => boolean) => {
    let changed = false;
    await d.accounts.withAccount(bid, (state) => {
      changed = fn(state, nowOf(d, state));
    });
    if (changed) {
      withdrawStaleTexts(d, bid);
      await deliverOwnerMessages(d, bid);
    }
    return { businessId: bid, note: changed ? undefined : "nothing to change" };
  };
  if (ev.type === "checkout.session.completed") {
    const session = ev.data.object as Pick<StripeCheckoutSession, "payment_status" | "payment_intent" | "customer">;
    if (session.payment_status !== "paid" || c.via !== "link") return { businessId: bid, note: "not paid" };
    return { businessId: bid, note: (await settleCheckout(d, bid, id, session)) ? undefined : "nothing to change" };
  }
  // a saved card's own PaymentIntent, never one a link's Checkout made
  const ours = c.via === "card" && c.stripe?.paymentIntent === o.id;
  const pi = ev.data.object as unknown as StripePaymentIntent;
  if (ev.type === "payment_intent.succeeded" && ours) return settle((state, now) => chargePaid(state, id, now, { by: "stripe", stripe: { paymentIntent: pi.id, ...cardOf(pi) } }));
  if (ev.type === "payment_intent.payment_failed" && ours) return settle((state, now) => chargeFailed(state, id, now, pi.last_payment_error?.message ?? "The card was declined", billingOpts(d, bid)));
  return { businessId: bid, note: "nothing to do" };
}

/**
 * A link's Checkout Stripe says was paid (its webhook, or the /pay link opened again before that came): the charge is
 * paid, the card saved; one paid already by another payment asks Jack to refund that one. Once a payment.
 */
async function settleCheckout(d: Deps, bid: string, id: string, session: Pick<StripeCheckoutSession, "payment_intent" | "customer">): Promise<boolean> {
  const pi = session.payment_intent ? await d.stripe!.retrievePaymentIntent(session.payment_intent) : undefined;
  let changed = false;
  await d.accounts.withAccount(bid, (state) => {
    const now = nowOf(d, state);
    changed = chargePaid(state, id, now, { by: "stripe", stripe: { customer: session.customer ?? undefined, paymentIntent: pi?.id, ...cardOf(pi) } }) || (!!pi && paidTwice(state, id, now, pi.id));
  });
  if (changed) {
    withdrawStaleTexts(d, bid);
    await deliverOwnerMessages(d, bid);
  }
  return changed;
}

/**
 * Jack's answer to a charge waiting on him: refund it (through Stripe when Stripe charged it, else he already did it
 * himself), or keep it. A refund frees its place under the cap and its text to the owner waits for his OK. A second
 * payment is that payment refunded, the charge as it was.
 */
export async function decideChargeOp(d: Deps, bid: string, id: string, refund: boolean): Promise<{ done: "refunded" | "skipped" | "kept"; by?: "stripe" | "hand" } | { refused: string }> {
  if (!d.accounts.repo.exists(bid)) throw new NotFound("No such business");
  let r: ReturnType<typeof decideCharge>;
  let pi: string | undefined;
  let again = false;
  await d.accounts.withAccount(bid, (state) => {
    r = decideCharge(state, id, refund, nowOf(d, state));
    const c = chargeOf(state, id);
    again = c?.ask?.kind === "paid_twice";
    pi = again ? c!.ask!.paymentIntent : c?.stripe?.paymentIntent;
  });
  if (!r!) return { refused: "That charge isn't waiting for you (or it's being charged right now)." };
  if (r! !== "refund") {
    withdrawStaleTexts(d, bid);
    return { done: r! };
  }
  const viaStripe = !!d.stripe && !!pi;
  const refundId = viaStripe ? (await d.stripe!.createRefund({ payment_intent: pi! }, again ? `${id}:refund:${pi}` : `${id}:refund`)).id : undefined;
  await d.accounts.withAccount(bid, (state) => {
    chargeRefunded(state, id, nowOf(d, state), refundId);
  });
  await deliverOwnerMessages(d, bid);
  return { done: "refunded", by: viaStripe ? "stripe" : "hand" };
}

/**
 * Jack's word on a booking the export asked at a one pass's end brought (BRIEF B6): confirmed, its money text comes to
 * him now, the usual way; not, it never bills. Refused when it isn't waiting for him.
 */
export async function decideFoundOp(d: Deps, bid: string, customerId: string, confirm: boolean): Promise<{ ok: true } | { refused: string }> {
  if (!d.accounts.repo.exists(bid)) throw new NotFound("No such business");
  let found = false;
  await d.accounts.withAccount(bid, (state) => {
    found = !!decideFound(state, customerId, confirm, nowOf(d, state));
  });
  if (!found) return { refused: "That booking isn't waiting for you." };
  await settleBilling(d, bid);
  await deliverOwnerMessages(d, bid);
  return { ok: true };
}

/**
 * Jack marks a charge paid outside the software (his own link, or Done by hand): a customer's, or a month by its id.
 * Never charged again, and the Checkout its link last made can't be paid.
 */
export async function markPaid(d: Deps, bid: string, who: Parameters<typeof markPaidOutside>[1]): Promise<ReturnType<typeof markPaidOutside>> {
  if (!d.accounts.repo.exists(bid)) throw new NotFound("No such business");
  let r: ReturnType<typeof markPaidOutside>;
  await d.accounts.withAccount(bid, (state) => {
    r = markPaidOutside(state, who, nowOf(d, state));
  });
  withdrawStaleTexts(d, bid);
  if ("charge" in r!) await expireCheckout(d, bid, r.charge);
  return r!;
}

/**
 * A link charge's text again for Jack's OK, with its link as it is now: one charge (the owner lost the text), or each
 * one out after "Replace all links". Its texts not sent yet carry the old link, so they never go. The texts made.
 */
export async function sendLinkAgain(d: Deps, bid: string, chargeId?: string): Promise<string[]> {
  const made: string[] = [];
  const old: string[] = [];
  await d.accounts.withAccount(bid, (state) => {
    for (const c of [...(state.dataset.business.plan.charges ?? []), ...(state.dataset.business.plan.months ?? [])]) {
      if (chargeId && c.id !== chargeId) continue;
      const before = textsOf(state, c).filter((m) => m.kind === "charge_link" || m.kind === "charge_retry");
      const m = linkAgain(state, c.id, nowOf(d, state), billingOpts(d, bid));
      if (!m) continue;
      made.push(m.id);
      old.push(...before.map((x) => x.id));
    }
  });
  for (const id of old) d.accounts.repo.withdrawOwnerMessage(bid, id, "Sent again with the link as it is now");
  if (made.length) await deliverOwnerMessages(d, bid);
  return made;
}

/**
 * A Stripe customer Jack pasted (his payment link saved the owner's card): with a key, the card is looked up (the
 * customer's default, else the newest) and later charges go on it; by hand, only the id is kept.
 */
export async function pasteCustomer(d: Deps, bid: string, customer: string): Promise<{ card: PlanState["card"] } | { refused: string }> {
  if (!d.accounts.repo.exists(bid)) throw new NotFound("No such business");
  let pm: StripePaymentMethod | undefined;
  if (d.stripe) {
    try {
      const cus = await d.stripe.retrieveCustomer(customer);
      if (cus.deleted) return { refused: "That Stripe customer was deleted." };
      const cards = await d.stripe.listCards(customer);
      pm = cards.find((x) => x.id === cus.invoice_settings?.default_payment_method) ?? cards[0];
    } catch (e) {
      if (e instanceof StripeError && e.status === 404) return { refused: "Stripe doesn't know that customer." };
      throw e;
    }
    if (!pm) return { refused: "That Stripe customer has no saved card." };
  }
  await d.accounts.withAccount(bid, (state) => {
    pasteCard(state, { customer, paymentMethod: pm?.id, brand: pm?.card?.brand, last4: pm?.card?.last4 }, nowOf(d, state));
  });
  return { card: d.accounts.peek(bid)!.state.dataset.business.plan.card };
}
