import type { AgentEvent, Charge, ISODate, ISODateTime, PlanState, SavedCard } from "../model.ts";
import type { AccountState, ChargeText, OwnerMessage } from "./state.ts";
import { billableBookings } from "../ledger/billable.ts";
import { counted } from "../ledger/attribution.ts";
import { chargeCapText, chargeHeadsUp, chargeRefundText, chargeRetryText, leadCode } from "../reports/owner.ts";
import { billsPass, holdsPlace, ONE_PASS } from "../plans.ts";
import { customerById } from "../lookup.ts";
import { addDays, fmtMoney, makeId, weekday } from "../util.ts";

/**
 * A one pass's charge log (BRIEF B4): a charge for each billable booking, its money text waiting for the operator, then
 * the link or the saved card, and Stripe's word on it. Everything here is idempotent by the charge's id and status: a
 * booking seen twice, a webhook delivered three times or a restart mid-charge never charges or marks twice.
 */

export interface BillingOpts {
  /** A Stripe key is set: saved cards are charged here and links are /pay links. Without one, Jack does both by hand. */
  stripe: boolean;
  /** A charge's /pay link (with Stripe). */
  payLink?: (chargeId: string) => string;
}

/** Owner messages point at their charge with this ref. */
export const CHARGE_REF = "pass_charge";

/** A charge's id: the pass (its business and first send day) and the customer, never a booking's id. */
export function chargeId(state: AccountState, customerId: string): string {
  const b = state.dataset.business;
  return makeId("chg", b.id, b.plan.startedOn, customerId);
}

export function chargeOf(state: AccountState, id: string): Charge | undefined {
  return state.dataset.business.plan.charges?.find((c) => c.id === id);
}

/** The next business day (Monday to Friday) after `day`. */
export function nextBusinessDay(day: ISODate): ISODate {
  let d = addDays(day, 1);
  while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1);
  return d;
}

/** Whether the next charge goes on a saved card: one Stripe can charge, or, by hand, any card the owner saved. */
export function cardOnFile(plan: PlanState, stripe: boolean): boolean {
  return stripe ? !!(plan.card?.customer && plan.card.paymentMethod) : !!plan.card;
}

/** The reason on the charges and bookings the owner said weren't ours. */
const NOT_OURS = "The owner texted NOT OURS";
/** Why money paid for a charge already cancelled waits for Jack: his to refund, whatever the customer books since. */
const PAID_AFTER = "Paid after it was cancelled";

/** A charge before money has moved (or might be moving): NOT OURS or a booking gone cancels it outright. */
const UNCHARGED = new Set<Charge["status"]>(["heads_up", "approved", "link_sent", "failed"]);

/** The customer's charge for this pass, added to the log. */
function newCharge(state: AccountState, customerId: string, now: ISODateTime, over: Partial<Charge>): Charge {
  const plan = state.dataset.business.plan;
  const c: Charge = { id: chargeId(state, customerId), customerId, code: "", amount: Math.round((plan.pricePerBooking ?? ONE_PASS.pricePerBooking) * 100), status: "heads_up", via: "link", at: now, ...over };
  plan.charges = [...(plan.charges ?? []), c];
  return c;
}

/** The texts about one charge, oldest first. */
export function textsOf(state: AccountState, c: Pick<Charge, "id">): OwnerMessage[] {
  return state.ownerMessages.filter((m) => m.refs?.some((r) => r.kind === CHARGE_REF && r.id === c.id));
}

function nameOf(state: AccountState, c: Charge): string {
  return customerById(state.dataset, c.customerId)?.name ?? "A customer";
}

function log(state: AccountState, at: ISODateTime, kind: AgentEvent["kind"], title: string, detail: string | undefined, c: Charge): void {
  state.events.push({ id: makeId("ev", "ledger", at, title, state.events.length), at, agent: "ledger", kind, title, detail, refs: [{ kind: "customer", id: c.customerId }] });
}

function text(state: AccountState, at: ISODateTime, kind: ChargeText, c: Charge | undefined, body: string, tag = ""): OwnerMessage {
  const m: OwnerMessage = { id: makeId("om", kind, c?.id ?? state.dataset.business.plan.startedOn, tag), at, kind, text: body, ...(c ? { refs: [{ kind: CHARGE_REF, id: c.id }] } : {}) };
  state.ownerMessages.push(m);
  return m;
}

function skip(state: AccountState, c: Charge, now: ISODateTime, why: string): void {
  c.status = "skipped";
  c.reason = why;
  c.ask = undefined;
  log(state, now, "info", `No charge for ${nameOf(state, c)}`, why, c);
}

/** The owner said it wasn't ours: the customer's bookings from the pass come off the ledger too. */
function disputeBookings(state: AccountState, customerId: string, now: ISODateTime): number {
  const from = state.dataset.business.plan.startedOn ?? "";
  const theirs = counted(state.recoveries).filter((r) => r.customerId === customerId && r.cameBackOn >= from);
  for (const r of theirs) r.disputed = { at: now, reason: NOT_OURS, by: "owner" };
  return theirs.length;
}

/**
 * Bring the charge log up to the ledger. A charge whose booking went (cancelled before the work, taken back, out of
 * the window after a re-import) is skipped before money moves; after, it's Jack's to refund, until the customer books
 * again. New billable bookings get a charge each, in the order they booked, with its text for Jack's OK: on the saved
 * card, or, until a card is saved, one link at a time. Once the cap's last charge is paid, the owner hears it once.
 * Returns the charges skipped (their texts still waiting are withdrawn by the caller).
 */
export function settleCharges(state: AccountState, now: ISODateTime, opts: BillingOpts): { skipped: string[] } {
  const plan = state.dataset.business.plan;
  if (!billsPass(plan)) return { skipped: [] };
  let count = billableBookings(state);
  const billable = new Map(count.billable.map((x) => [x.customerId, x]));
  const why = new Map(count.not.map((x) => [x.customerId, x.why]));
  const skipped: string[] = [];
  for (const c of plan.charges ?? []) {
    const back = billable.get(c.customerId);
    // booked again since the booking it was charged for went: what was paid stands for this one, nothing to refund
    if (back && c.ask?.kind === "refund" && !c.ask.why.startsWith(PAID_AFTER)) {
      log(state, now, "info", `No refund for ${nameOf(state, c)}: booked again`, `${c.ask.why}, but they booked again: the ${fmtMoney(c.amount / 100)} paid stands for that booking.`, c);
      Object.assign(c, { bookingId: back.bookingId, bookedOn: back.on } satisfies Partial<Charge>);
      againDone(c, now);
    }
    if (back || !holdsPlace(c)) continue;
    const reason = why.get(c.customerId) ?? "Its booking is off the ledger";
    if (UNCHARGED.has(c.status)) {
      skip(state, c, now, reason);
      skipped.push(c.id);
    } else if (!c.ask && !c.keptAt) {
      c.ask = { kind: "refund", at: now, why: reason };
      log(state, now, "review", `Refund ${nameOf(state, c)}'s ${fmtMoney(c.amount / 100)}?`, `${reason}. It was charged: refund it, or keep it.`, c);
    }
  }
  if (skipped.length) count = billableBookings(state);
  const cap = plan.capBookings ?? ONE_PASS.capBookings;
  if ((plan.charges ?? []).filter((c) => c.status === "paid").length >= cap && !state.ownerMessages.some((m) => m.kind === "charge_cap")) text(state, now, "charge_cap", undefined, chargeCapText(plan));
  for (const x of count.billable) {
    if (plan.charges?.some((c) => c.customerId === x.customerId)) continue;
    const card = cardOnFile(plan, opts.stripe);
    // no card yet: the next link waits until the one out is paid (it saves the card), so "your first" is true
    if (!card && plan.charges?.some((c) => holdsPlace(c) && c.status !== "paid" && c.via === "link")) break;
    const c = newCharge(state, x.customerId, now, { bookingId: x.bookingId, bookedOn: x.on, code: x.code, via: card ? "card" : "link" });
    text(state, now, card ? "charge_card" : "charge_link", c, chargeHeadsUp(state, c, { link: opts.payLink?.(c.id), on: nextBusinessDay(now.slice(0, 10)) }));
    log(state, now, "action", `${nameOf(state, c)} booked: ${fmtMoney(c.amount / 100)} waits for your OK`, card ? "On the saved card, one business day after its text reaches the owner." : "The text carries the link that saves their card.", c);
  }
  return { skipped };
}

/**
 * Whether a money text still says something true of its charge: never once the charge is cancelled; a booking's text
 * while it waits for Jack and once he approved it (the link out, or the card on its day), a failed charge's link
 * likewise. A refund's always: it's made once the money went back (the charge's, or a second payment's).
 */
export function moneyTextLive(c: Charge, kind: OwnerMessage["kind"]): boolean {
  if (kind === "charge_link" || kind === "charge_card") return c.status === "heads_up" || ((c.status === "approved" || c.status === "link_sent") && c.via === (kind === "charge_card" ? "card" : "link"));
  if (kind === "charge_retry") return c.status === "failed" || c.status === "link_sent";
  return true;
}

/**
 * Jack approves a charge's text. A booking's on the saved card is charged one business day after the text reaches the
 * owner, and the text names that day from today (chargeTold moves it on when it goes later); a link goes with the text
 * (with Stripe), or is Jack's to send. A failed charge's text sends the link. The text is written again as it goes (the
 * day, the link, the total). One approved before (back with him after the owner's STOP, a send that failed, the link
 * sent again) only goes again: with the link as it is now, or the card's day from today when it never reached him.
 * Refused when the charge moved on meanwhile.
 */
export function approveCharge(state: AccountState, messageId: string, now: ISODateTime, opts: BillingOpts): { text: string } | { refused: string } | undefined {
  const m = state.ownerMessages.find((x) => x.id === messageId);
  const c = chargeOf(state, m?.refs?.find((r) => r.kind === CHARGE_REF)?.id ?? "");
  if (!m || !c) return undefined;
  if ((m.kind === "charge_link" || m.kind === "charge_card") && c.status === "heads_up") {
    if (c.via === "card") c.chargeOn = nextBusinessDay(now.slice(0, 10));
    c.status = c.via === "link" && opts.stripe ? "link_sent" : "approved";
    c.approvedAt = now;
    m.text = chargeHeadsUp(state, c, { link: opts.payLink?.(c.id), on: c.chargeOn });
  } else if (m.kind === "charge_retry" && c.status === "failed" && opts.payLink) {
    Object.assign(c, { status: "link_sent", via: "link", approvedAt: now } satisfies Partial<Charge>);
    m.text = chargeRetryText(state, c, opts.payLink(c.id));
  } else if (!moneyTextLive(c, m.kind) || (m.kind === "charge_retry" && c.status === "failed"))
    return { refused: c.status === "skipped" ? `That charge was cancelled: ${c.reason}.` : `That charge isn't waiting for this text any more (it's ${c.status.replace("_", " ")}).` };
  else if (c.status === "link_sent" && opts.payLink && (m.kind === "charge_link" || m.kind === "charge_retry")) m.text = linkText(state, c, m.kind, opts.payLink(c.id));
  else if (m.kind === "charge_card") redateCharge(state, c.id, now);
  return { text: m.text };
}

/** A link charge's text with its link: in a declined card's words, or a booking's. */
function linkText(state: AccountState, c: Charge, kind: "charge_link" | "charge_retry", link: string): string {
  return kind === "charge_retry" ? chargeRetryText(state, c, link) : chargeHeadsUp(state, c, { link });
}

/**
 * A saved card's text reached the owner at `at` (sent, or texted by hand and marked sent): the card is charged one
 * business day after that, never before the day the text names. Once.
 */
export function chargeTold(state: AccountState, id: string, at: ISODateTime): boolean {
  const c = chargeOf(state, id);
  if (!c || c.via !== "card" || c.status !== "approved" || c.toldAt) return false;
  const after = nextBusinessDay(at.slice(0, 10));
  Object.assign(c, { toldAt: at, chargeOn: c.chargeOn && c.chargeOn > after ? c.chargeOn : after } satisfies Partial<Charge>);
  return true;
}

/**
 * A saved card's text Jack approved that hasn't reached the owner (on Texts to send, back with him after the owner's
 * STOP, or its send failed): nothing is charged, and the day it names moves on with today. Its text, when it moved.
 */
export function redateCharge(state: AccountState, id: string, now: ISODateTime): OwnerMessage | undefined {
  const c = chargeOf(state, id);
  const on = nextBusinessDay(now.slice(0, 10));
  if (!c || c.via !== "card" || c.status !== "approved" || c.toldAt || (c.chargeOn ?? "") >= on) return undefined;
  c.chargeOn = on;
  const m = textsOf(state, c).find((x) => x.kind === "charge_card");
  if (m) m.text = chargeHeadsUp(state, c, { on });
  return m;
}

/**
 * A link charge's text again for Jack's OK, with its link as it is now: "Replace all links" killed the one in the
 * text, or the owner lost it. In the words it first went with (a booking's, or a declined card's).
 */
export function linkAgain(state: AccountState, id: string, now: ISODateTime, opts: BillingOpts): OwnerMessage | undefined {
  const c = chargeOf(state, id);
  if (!c || c.status !== "link_sent" || !opts.payLink) return undefined;
  const kind = textsOf(state, c).some((m) => m.kind === "charge_retry") ? "charge_retry" : "charge_link";
  return text(state, now, kind, c, linkText(state, c, kind, opts.payLink(c.id)), now);
}

/**
 * The saved card is about to be charged (or read back after a restart): claimed, so nothing else starts it. Never
 * before its text reached the owner.
 */
export function chargeStarted(state: AccountState, id: string, now: ISODateTime): Charge | undefined {
  const c = chargeOf(state, id);
  if (!c || (c.status !== "approved" && c.status !== "charging") || (c.status === "approved" && !c.toldAt)) return undefined;
  c.status = "charging";
  c.triedAt = now;
  return c;
}

/**
 * Paid: through Stripe (a link's Checkout, which saved the card for the rest, or the saved card), or by Jack outside
 * the software. Paid once; one that was skipped and got paid anyway goes to Jack to refund.
 */
export function chargePaid(state: AccountState, id: string, now: ISODateTime, how: { by: "stripe" | "outside"; stripe?: Charge["stripe"] }): boolean {
  const c = chargeOf(state, id);
  if (!c || c.status === "paid" || c.status === "refunded") return false;
  const plan = state.dataset.business.plan;
  if (c.status === "skipped") c.ask = { kind: "refund", at: now, why: `${PAID_AFTER} (${c.reason})` };
  c.status = "paid";
  c.paidAt = now;
  if (how.stripe) c.stripe = { ...c.stripe, ...how.stripe };
  if (how.by === "outside") c.reason = "Paid outside the software";
  if (c.via === "link") {
    const s = how.stripe;
    if (s?.paymentMethod) plan.card = { customer: s.customer, paymentMethod: s.paymentMethod, brand: s.brand, last4: s.last4, at: now, from: "checkout" };
    else plan.card ??= { at: now, from: "paid_outside" };
  }
  log(state, now, "win", `Paid: ${fmtMoney(c.amount / 100)} for ${nameOf(state, c)}`, how.by === "outside" ? "Marked paid outside the software." : c.via === "link" ? "By the link; their card is saved for the rest." : "On the saved card.", c);
  return true;
}

/**
 * Paid again after it was paid (an older Checkout from its link, paid as well): that payment is Jack's to refund or
 * keep, asked once nothing else about the charge waits on him. Once a payment.
 */
export function paidTwice(state: AccountState, id: string, now: ISODateTime, paymentIntent: string): boolean {
  const c = chargeOf(state, id);
  if (!c || (c.status !== "paid" && c.status !== "refunded") || c.stripe?.paymentIntent === paymentIntent || c.stripe?.again?.includes(paymentIntent)) return false;
  c.stripe = { ...c.stripe, again: [...(c.stripe?.again ?? []), paymentIntent] };
  log(state, now, "review", `${nameOf(state, c)}'s ${fmtMoney(c.amount / 100)} was paid twice`, "A second Checkout from its link went through too: refund that one, or keep it.", c);
  askAgain(c, now);
  return true;
}

/** A second payment waits for Jack once nothing else about the charge does. */
function askAgain(c: Charge, now: ISODateTime): void {
  const pi = c.stripe?.again?.[0];
  if (pi && !c.ask) c.ask = { kind: "paid_twice", at: now, why: "Paid twice: a second Checkout from its link went through too", paymentIntent: pi };
}

/** Jack answered what the charge waited on him for: a second payment he refunded or kept is off his list. The next is asked. */
function againDone(c: Charge, now: ISODateTime): void {
  const pi = c.ask?.kind === "paid_twice" ? c.ask.paymentIntent : undefined;
  c.ask = undefined;
  if (pi) {
    const rest = c.stripe?.again?.filter((x) => x !== pi) ?? [];
    c.stripe = { ...c.stripe, again: rest.length ? rest : undefined };
  }
  askAgain(c, now);
}

/** The saved card was declined (or needs the owner): failed, and the link to pay it waits for Jack's OK. */
export function chargeFailed(state: AccountState, id: string, now: ISODateTime, why: string, opts: BillingOpts): boolean {
  const c = chargeOf(state, id);
  if (!c || c.status !== "charging") return false;
  c.status = "failed";
  c.reason = why;
  if (opts.payLink) text(state, now, "charge_retry", c, chargeRetryText(state, c, opts.payLink(c.id)), now);
  log(state, now, "warning", `${nameOf(state, c)}'s ${fmtMoney(c.amount / 100)} didn't go through`, `${why}.${opts.payLink ? " The link to pay it waits for your OK." : ""}`, c);
  return true;
}

/**
 * Refunded on Jack's OK: its place under the cap is free again, and the owner hears it. A second payment refunded
 * leaves the charge as it was.
 */
export function chargeRefunded(state: AccountState, id: string, now: ISODateTime, refundId?: string): boolean {
  const c = chargeOf(state, id);
  if (c?.ask?.kind === "paid_twice") {
    const pi = c.ask.paymentIntent;
    againDone(c, now);
    text(state, now, "charge_refund", c, chargeRefundText(state, c), pi);
    log(state, now, "info", `Refunded ${nameOf(state, c)}'s second ${fmtMoney(c.amount / 100)}`, `${pi}${refundId ? `: refund ${refundId}` : ""}`, c);
    return true;
  }
  if (!c || c.status !== "paid") return false;
  if (c.ask?.kind === "not_ours") disputeBookings(state, c.customerId, now);
  Object.assign(c, { status: "refunded", refundedAt: now, reason: c.ask?.why ?? "Refunded", ask: undefined } satisfies Partial<Charge>);
  if (refundId) c.stripe = { ...c.stripe, refund: refundId };
  text(state, now, "charge_refund", c, chargeRefundText(state, c));
  log(state, now, "info", `Refunded ${nameOf(state, c)}'s ${fmtMoney(c.amount / 100)}`, c.reason, c);
  askAgain(c, now);
  return true;
}

/**
 * The owner texted NOT OURS #code (the code of the charge, or of a lead whose customer has one). Before the charge,
 * it's cancelled (its place freed) and the booking comes off the ledger; after it, Jack decides, and the charge holds
 * its place meanwhile. A lead with no charge yet has its bookings from the pass taken off the ledger, and on a one pass
 * its customer gets a charge cancelled for it, so nothing their records show later is ever charged either. Undefined:
 * no charge and no lead has that code.
 */
export function notOurs(state: AccountState, code: string, now: ISODateTime): { customerId: string; charge?: Charge; done: "skipped" | "asked" | "already" | "disputed" } | undefined {
  const plan = state.dataset.business.plan;
  const lead = state.replies.find((r) => r.customerId && r.handedOffAt && leadCode(r.id) === code);
  const c = [...(plan.charges ?? [])].reverse().find((x) => x.code === code) ?? plan.charges?.find((x) => x.customerId === lead?.customerId);
  if (c && !holdsPlace(c)) return { customerId: c.customerId, charge: c, done: "already" };
  if (c && !UNCHARGED.has(c.status)) {
    c.ask = { kind: "not_ours", at: now, why: NOT_OURS };
    c.keptAt = undefined;
    log(state, now, "review", `${state.dataset.business.ownerFirstName} says ${nameOf(state, c)} wasn't ours`, `After the ${fmtMoney(c.amount / 100)} was charged: refund it, or keep it.`, c);
    return { customerId: c.customerId, charge: c, done: "asked" };
  }
  if (c) {
    skip(state, c, now, NOT_OURS);
    disputeBookings(state, c.customerId, now);
    return { customerId: c.customerId, charge: c, done: "skipped" };
  }
  if (!lead) return undefined;
  disputeBookings(state, lead.customerId!, now);
  if (!billsPass(plan)) return { customerId: lead.customerId!, done: "disputed" };
  const none = newCharge(state, lead.customerId!, now, { code });
  skip(state, none, now, NOT_OURS);
  return { customerId: lead.customerId!, charge: none, done: "disputed" };
}

/**
 * Jack's answer to a charge waiting on him (a refund to approve, a NOT OURS after the charge, a second payment).
 * Refund: the caller refunds a paid one (or the second payment) through Stripe, then chargeRefunded; one never charged
 * is just skipped. Keep: it stays, and isn't asked again. Nothing while a charge is still going through.
 */
export function decideCharge(state: AccountState, id: string, refund: boolean, now: ISODateTime): "refund" | "skipped" | "kept" | undefined {
  const c = chargeOf(state, id);
  if (!c?.ask || c.status === "charging") return undefined;
  if (!refund) {
    log(state, now, "info", `Kept ${nameOf(state, c)}'s ${fmtMoney(c.amount / 100)}`, c.ask.why, c);
    if (c.ask.kind !== "paid_twice") c.keptAt = now;
    againDone(c, now);
    return "kept";
  }
  if (c.status === "paid" || c.ask.kind === "paid_twice") return "refund";
  if (c.ask.kind === "not_ours") disputeBookings(state, c.customerId, now);
  skip(state, c, now, c.ask.why);
  return "skipped";
}

/**
 * Paid outside the software (Jack's own payment link, or by hand with no Stripe key): the customer's charge is marked
 * paid, made first if there isn't one. Never one being charged right now, and never twice.
 */
export function markPaidOutside(state: AccountState, customerId: string, now: ISODateTime): { charge: Charge } | { refused: string } {
  const plan = state.dataset.business.plan;
  if (!billsPass(plan)) return { refused: "Only a one pass that has started has charges." };
  if (!customerById(state.dataset, customerId)) return { refused: "No such customer." };
  let c = chargeOf(state, chargeId(state, customerId));
  if (c?.status === "charging") return { refused: "It's being charged right now: wait until Stripe says how it went." };
  if (c?.status === "paid") return { refused: "That charge is paid already." };
  if (c?.status === "refunded") return { refused: "That charge was refunded." };
  if (!c) {
    const count = billableBookings(state);
    const x = [...count.billable, ...count.overCap].find((b) => b.customerId === customerId);
    c = newCharge(state, customerId, now, { bookingId: x?.bookingId, bookedOn: x?.on, code: x?.code ?? "", via: cardOnFile(plan, false) ? "card" : "link" });
  }
  chargePaid(state, c.id, now, { by: "outside" });
  return { charge: c };
}

/** A Stripe customer Jack pasted (his payment link saved their card): later charges go on that card. */
export function pasteCard(state: AccountState, card: Omit<SavedCard, "at" | "from">, now: ISODateTime): void {
  state.dataset.business.plan.card = { ...card, at: now, from: "pasted" };
  state.events.push({ id: makeId("ev", "ledger", now, "card", state.events.length), at: now, agent: "ledger", kind: "action", title: "Saved card set", detail: `${card.customer ?? "A Stripe customer"}${card.last4 ? `, card ending ${card.last4}` : ""}: later charges go on it.` });
}
