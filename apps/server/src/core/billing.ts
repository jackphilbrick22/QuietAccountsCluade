import {
  approveCharge,
  askFirstMonth,
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
  pasteCard,
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
import { StripeError, type StripeEvent, type StripePaymentIntent, type StripePaymentMethod } from "../providers/stripe.ts";

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

const nowOf = (d: Deps, state: AccountState) => localIso(d.clock(), state.dataset.business.timezone);

export function billingOpts(d: Deps, bid: string): BillingOpts {
  return d.stripe ? { stripe: true, payLink: (id) => payLink(d, bid, id) } : { stripe: false };
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

/** The business's Stripe customer: the saved card's, else the one an earlier Checkout made (a booking's or a month's). */
function stripeCustomer(plan: PlanState): string | undefined {
  return plan.card?.customer ?? [...(plan.charges ?? []), ...(plan.months ?? [])].find((c) => c.stripe?.customer)?.stripe?.customer;
}

/** "Booked job: Karen W. (Dow's Tree Service)", "First month (Dow's Tree Service)", "Month from November 1 (...)" */
function lineName(state: AccountState, c: Charge | MonthCharge): string {
  if (isMonth(c)) return `${c.first ? "First month" : `Month from ${monthName(c.month)} ${Number(c.month.slice(8))}`} (${state.dataset.business.name})`;
  const who = customerById(state.dataset, c.customerId);
  const short = who?.firstName ? `${who.firstName}${who.lastName ? ` ${who.lastName[0]}.` : ""}` : (who?.name ?? "a customer");
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
  await d.accounts.withAccount(bid, (state) => {
    const now = nowOf(d, state);
    const plan = state.dataset.business.plan;
    settleCharges(state, now, billingOpts(d, bid));
    settleMonths(state, now);
    for (const c of [...(plan.charges ?? []), ...(plan.months ?? [])]) {
      if (c.via !== "card" || c.status !== "approved" || c.toldAt) continue;
      const m = textsOf(state, c).find((x) => x.kind === "charge_card" || x.kind === "precharge");
      const went = m && d.accounts.repo.ownerMessageDelivery(bid, m.id);
      if (went?.delivery === "sent" && went.delivered_at) chargeTold(state, c.id, localIso(new Date(went.delivered_at), state.dataset.business.timezone));
      else if (redateCharge(state, c.id, now) && m) d.accounts.repo.setOwnerMessageText(bid, m.id, m.text);
    }
  });
  withdrawStaleTexts(d, bid);
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
  const today = localIso(d.clock(), tz).slice(0, 10);
  const stale = localIso(new Date(d.clock().getTime() - READ_BACK_MS), tz);
  for (const c of [...(s.dataset.business.plan.charges ?? []), ...(s.dataset.business.plan.months ?? [])])
    if (c.via === "card" && ((c.status === "approved" && c.toldAt && (c.chargeOn ?? today) <= today) || (c.status === "charging" && (c.triedAt ?? "") <= stale))) await chargeCard(d, bid, c.id);
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
    const claimed = chargeStarted(state, id, nowOf(d, state));
    c = claimed && structuredClone(claimed);
    card = state.dataset.business.plan.card;
    if (claimed) name = lineName(state, claimed);
  });
  if (!c) return;
  let pi: StripePaymentIntent | undefined;
  let refused: string | undefined;
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
  }
  await settleIntent(d, bid, id, pi, refused);
}

/** What Stripe says of a saved card's PaymentIntent (or that it refused it), on the charge. Processing waits for the webhook. */
async function settleIntent(d: Deps, bid: string, id: string, pi: StripePaymentIntent | undefined, refused?: string): Promise<void> {
  await d.accounts.withAccount(bid, (state) => {
    const now = nowOf(d, state);
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
  await d.accounts.withAccount(bid, (state) => {
    r = approveCharge(state, messageId, nowOf(d, state), billingOpts(d, bid));
  });
  if (!r!) return {};
  if ("refused" in r!) {
    d.accounts.repo.withdrawOwnerMessage(bid, messageId, r.refused);
    return { refused: r.refused };
  }
  d.accounts.repo.setOwnerMessageText(bid, messageId, r!.text);
  return {};
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
  let customer = stripeCustomer(b.plan);
  if (!customer) customer = (await d.stripe.createCustomer({ name: b.name, email: b.ownerEmail, phone: b.ownerPhone, metadata: { business_id: b.id } }, `${c.id}:customer`)).id;
  const n = c.stripe?.sessions?.length ?? 0;
  const price = b.plan.pricePerBooking ?? ONE_PASS.pricePerBooking;
  const terms = isMonth(c)
    ? `${fmtMoney(c.amount / 100)} a month. Each charge comes after a text, and any month nobody asks to come back, you don't pay.`
    : `${fmtMoney(price)} per booked job, up to ${fmtMoney(price * (b.plan.capBookings ?? ONE_PASS.capBookings))}. Each later charge comes after a text.`;
  const base = d.cfg.PUBLIC_URL.replace(/\/$/, "");
  const metadata = { business_id: b.id, charge_id: c.id };
  await expireCheckout(d, t.bid, c);
  const session = await d.stripe.createCheckoutSession(
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
    `${c.id}:checkout:${n}`,
  );
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
    const session = ev.data.object as { payment_status?: string; payment_intent?: string | null; customer?: string | null };
    if (session.payment_status !== "paid" || c.via !== "link") return { businessId: bid, note: "not paid" };
    const pi = session.payment_intent ? await d.stripe!.retrievePaymentIntent(session.payment_intent) : undefined;
    return settle((state, now) => chargePaid(state, id, now, { by: "stripe", stripe: { customer: session.customer ?? undefined, paymentIntent: pi?.id, ...cardOf(pi) } }) || (!!pi && paidTwice(state, id, now, pi.id)));
  }
  // a saved card's own PaymentIntent, never one a link's Checkout made
  const ours = c.via === "card" && c.stripe?.paymentIntent === o.id;
  const pi = ev.data.object as unknown as StripePaymentIntent;
  if (ev.type === "payment_intent.succeeded" && ours) return settle((state, now) => chargePaid(state, id, now, { by: "stripe", stripe: { paymentIntent: pi.id, ...cardOf(pi) } }));
  if (ev.type === "payment_intent.payment_failed" && ours) return settle((state, now) => chargeFailed(state, id, now, pi.last_payment_error?.message ?? "The card was declined", billingOpts(d, bid)));
  return { businessId: bid, note: "nothing to do" };
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
