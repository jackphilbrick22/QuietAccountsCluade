import type { BusinessProfile, Charge, Features, ISODate, Money, MonthCharge, Opportunity, PlanState, Recovery, Reply, Touch } from "../model.ts";
import type { AccountState } from "../runtime/state.ts";
import { addDays, addMonths, daysBetween, fmtMoney, fmtPhone, greetingName, humanAge, isoWeekKey, mondayOf, monthName, round2, sum } from "../util.ts";
import { CALL_OVER_AMOUNT, soldMonthly, STALE_QUOTE_DAYS } from "../breakage/assumptions.ts";
import { pickWorked } from "../breakage/detect.ts";
import { pct, quietRates } from "../breakage/quiet.ts";
import { refillRate } from "../breakage/refill.ts";
import { holdsPlace, isMonth, isOnePass, ONE_PASS, passPaid } from "../plans.ts";
import { counted } from "../ledger/attribution.ts";
import { answerTime, promiseTonight } from "../copy/render.ts";
import { customerById, quoteById } from "../lookup.ts";

const WANTS = new Set(["wants_it", "wants_price"]);

/**
 * Who the guarantee counts, in the owner's words: on the monthly plan someone who asked to come back, on the one pass
 * someone who wanted the work. Underneath it's WANTS, from replies to our follow-up notes. No kind is monthly.
 */
export function wantedWords(plan: Pick<PlanState, "kind">): { label: string; past: string; present: string } {
  return plan.kind === "one_pass"
    ? { label: "Wanted the work", past: "wanted the work", present: "wants the work" }
    : { label: "Asked to come back", past: "asked to come back", present: "asks to come back" };
}

function tradeMark(b: BusinessProfile): string {
  return (
    ({ tree: "🌳", septic: "🚛", lawn: "🌱", landscape: "🌿", fence: "🪵", concrete: "🧱", pressure_washing: "💦", gutter: "🏠", pool: "🏊", pest: "🐜", hvac: "❄️", roofing: "🏠" } as Record<string, string>)[b.trade] ?? "🔔"
  );
}

function wantsLine(r: Reply): string {
  switch (r.intent) {
    case "wants_it":
      return "Wants it done";
    case "wants_price":
      return "Wants a price";
    case "question":
      return "Has a question";
    case "later":
      return r.extracted.followUpOn ? `Later — try ${monthName(r.extracted.followUpOn)}` : "Later";
    default:
      return "Wrote back";
  }
}

/** Short code the owner can quote back by text ("booked 2400 #K7Q"). */
export function leadCode(replyId: string): string {
  let h = 0;
  for (let i = 0; i < replyId.length; i++) h = (h * 31 + replyId.charCodeAt(i)) >>> 0;
  const alphabet = "ACDEFGHJKLMNPQRTUVWXY34679";
  let out = "";
  for (let i = 0; i < 3; i++) {
    out += alphabet[h % alphabet.length];
    h = Math.floor(h / alphabet.length);
  }
  return out;
}

/**
 * The text the owner gets the moment someone wants the work.
 * Everything needed to call them back is in the message itself.
 */
export function handoffText(state: AccountState, r: Reply): string {
  const b = state.dataset.business;
  const c = state.dataset.customers.find((x) => x.id === r.customerId);
  const o = state.scan?.opportunities.find((x) => x.id === r.opportunityId);
  const name = c?.name || r.from;
  const street = c?.address?.street ? `, ${c.address.street}` : "";
  const lines = [
    `${tradeMark(b)} NEW — ${name}${street}`,
    o ? recordLine(state, o, r.receivedAt.slice(0, 10)) : "",
    staleNote(b, o, r.receivedAt.slice(0, 10)),
    r.ack ? ackLine(r.ack.promise, r.receivedAt) : "",
    `They said: “${oneLine(r.text, 160)}”`,
    `Best contact: ${r.extracted.phone ? fmtPhone(r.extracted.phone) : c?.phones[0] ? fmtPhone(c.phones[0]) : c?.emails[0] ?? r.from}${r.extracted.bestTime ? ` (${r.extracted.bestTime})` : ""}`,
    `Wants: ${wantsLine(r)}`,
    `Text back BOOKED + amount, DONE, or NO · #${leadCode(r.id)}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** What the owner is told about the instant answer: sent already, or (at night) going at 7am. */
function ackLine(promise: string, receivedAt: string): string {
  const sendAt = answerTime(receivedAt);
  if (sendAt === receivedAt.slice(0, 19)) return `We already wrote back that ${promise}.`;
  return `At 7am we'll write back that ${promiseTonight(promise, receivedAt, sendAt)}.`;
}

/**
 * The record the owner will look up: its real date and amount, never a modelled number passed off as one.
 * An estimate is labelled "est."; a request that was never priced says so.
 */
export function recordLine(state: AccountState, o: Opportunity, today: ISODate): string {
  const ds = state.dataset;
  // the date as it reads on the record ("Feb 12, 2025"), so the owner finds it in their software
  const when = (d: ISODate | undefined) => (d ? `${monthName(d).slice(0, 3)} ${Number(d.slice(8))}${d.slice(0, 4) === today.slice(0, 4) ? "" : `, ${d.slice(0, 4)}`}` : "no date");
  const money = (n: number) => (n > 0 ? fmtMoney(n) : "no amount");
  const what = o.jobPhrase.replace(/^the /, "");
  if (o.source.kind === "quote") {
    const q = quoteById(ds, o.source.id);
    if (q) {
      const sent = q.sentOn ?? q.createdOn ?? q.approvedOn;
      if (o.type === "declined_option") return `Passed on: ${when(q.convertedOn ?? q.approvedOn ?? sent)} · ${fmtMoney(o.value)} · ${what}`;
      return `Quote${q.number ? ` #${q.number}` : ""}: ${when(sent)} · ${money(q.total)} · ${what}`;
    }
  } else if (o.source.kind === "job" || o.source.kind === "invoice") {
    const j = o.source.kind === "job" ? ds.jobs.find((x) => x.id === o.source.id) : undefined;
    const inv = o.source.kind === "invoice" ? ds.invoices.find((x) => x.id === o.source.id) : undefined;
    const rec = j ? { d: j.completedOn ?? j.scheduledOn ?? j.createdOn, total: j.total, title: j.title } : inv ? { d: inv.issuedOn ?? inv.paidOn, total: inv.total, title: inv.subject } : undefined;
    if (rec) {
      if (o.type === "unpaid_invoice") return `Invoice${inv?.number ? ` #${inv.number}` : ""}: ${when(rec.d)} · ${money(rec.total)} · ${fmtMoney(o.value)} still owed`;
      const head = `${o.type === "service_due" ? "Last done" : "Last job"}: ${when(o.lastDoneOn ?? rec.d)} · ${money(rec.total)} · ${oneLine(rec.title || what, 50)}`;
      return o.type === "missed_upsell" ? `${head} · next: ${what}, est. ${fmtMoney(o.value)}` : head;
    }
  } else if (o.source.kind === "request") {
    const req = ds.requests.find((x) => x.id === o.source.id);
    return `Request: ${when(req?.createdOn ?? o.anchorDate)} · never priced · ${what}`;
  }
  return `${what} · est. ${fmtMoney(o.value)}`;
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The instant answer to a hot reply, in the signer's voice. It promises only a call-back window the owner
 * can keep (today if it's before 3pm, else the next weekday) — never a price, a date or a discount.
 */
export function ackFor(state: AccountState, r: Reply): { text: string; promise: string } | undefined {
  const b = state.dataset.business;
  if (b.autoAck === false) return undefined;
  if (!(r.intent === "wants_it" || r.intent === "wants_price" || r.intent === "question")) return undefined;
  const c = state.dataset.customers.find((x) => x.id === r.customerId);
  if (!c) return undefined;
  const greet = greetingName(c.firstName);
  const first = greet === "there" ? "" : greet;
  // worded for when it goes: a reply at 11pm is answered at 7am, when "today" means the next day
  const sendAt = answerTime(r.receivedAt);
  const hour = Number(sendAt.slice(11, 13));
  const today = sendAt.slice(0, 10);
  let when = "today";
  if (hour >= 15 || [0, 6].includes(new Date(`${today}T12:00:00Z`).getUTCDay())) {
    let d = addDays(today, 1);
    while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1);
    when = d === addDays(today, 1) ? "tomorrow" : `on ${WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay()]}`;
  }
  const isOwner = b.signerName.trim().toLowerCase() === b.ownerFirstName.trim().toLowerCase();
  const at = r.extracted.phone ? ` at ${fmtPhone(r.extracted.phone)}` : "";
  const hi = first ? `Thanks ${first}.` : "Thanks.";
  const who = isOwner ? "I'll" : `I've passed this to ${b.ownerFirstName}, who'll`;
  // "updated" only when there was a price to update; a request or a past customer never got one for this
  const o = state.scan?.opportunities.find((x) => x.id === r.opportunityId);
  const quoted = !!o && ["unanswered_quote", "archived_quote", "changes_requested", "declined_quote", "approved_unscheduled"].includes(o.type) && o.source.kind === "quote";
  const body =
    r.intent === "question"
      ? `${first ? `Thanks ${first}, good question.` : "Good question."} ${isOwner ? "I'll get back to you" : `I've passed it to ${b.ownerFirstName}, who'll get back to you`} ${when}.`
      : r.intent === "wants_price"
        ? `${hi} ${who} give you a call${at} ${when} to go over it and get you ${quoted ? "an updated price" : "a price"}.`
        : `${hi} ${who} give you a call${at} ${when} to get it on the schedule.`;
  const promise = r.intent === "question" ? `you'll get back to them ${when}` : `you'll call them ${when}`;
  return { text: `${body}\n\n${b.signerName}\n${b.name}`, promise };
}

/**
 * The first text an owner gets, when the free round (or the one pass) is scheduled. It's their whole manual: what we
 * found (their own numbers), when notes start, that they don't have to do anything, and the only replies they need.
 * A one pass says when its last notes go and what a booking costs, and never mentions the monthly price.
 */
export function kickoffText(state: AccountState, firstDay: ISODate, people: number, opts: { awaitOk?: boolean } = { awaitOk: true }): string {
  const b = state.dataset.business;
  const a = state.summary?.audit;
  const gone = state.summary?.onTheTable.pastCustomersNotBack ?? 0;
  // Their own number first: the share of quotes that never got an answer, and what it's worth. The monthly trades
  // work past customers, not quotes, so theirs is the past customers who haven't been back.
  const monthly = soldMonthly(b.trade);
  const found =
    monthly && gone
      ? `Going through your records, ${gone.toLocaleString("en-US")} past ${gone === 1 ? "customer hasn't" : "customers haven't"} been back.`
      : !monthly && a && a.silent.count && a.rate > 0
        ? `In the last two years, ${Math.round(a.rate * 100)}% of your quotes never got a yes or a no. All told, ${a.silent.count.toLocaleString("en-US")} quotes, ${fmtMoney(a.silent.value, { compact: true })}, are sitting quiet. Nobody said no to that money; nobody asked.`
        : `We went through everything you sent and found the people worth a note.`;
  const day = dayWords(firstDay);
  const firsts = state.touches.filter((t) => t.step === 1 && (t.status === "planned" || t.status === "approved"));
  const onDay = firsts.filter((t) => t.dueAt.slice(0, 10) === firstDay).length;
  // The note they'll see first, word for word (the footer is the same on every note, so it's left off).
  const sample = [...firsts].sort((x, y) => (x.dueAt < y.dueAt ? -1 : x.dueAt > y.dueAt ? 1 : 0))[0];
  // a seasonal shop's round that runs past its selling window goes on in the next one: when the last of them go
  const later = firsts.filter((t) => sample?.season && t.season && t.season !== sample.season);
  const pass = isOnePass(b.plan);
  const lastDay = state.touches.filter((t) => t.status === "planned" || t.status === "approved").map((t) => t.dueAt.slice(0, 10)).sort().pop() ?? firstDay;
  const rest = pass
    ? `then the rest of your ${people}, newest first, each one about their own job. It's one pass through your list: the last notes go out ${monthName(lastDay)} ${Number(lastDay.slice(8))}.`
    : `then the rest of your ${people} over the next few weeks${later.length ? ` (the last ${later.length} from ${dayWords(later.map((t) => t.dueAt.slice(0, 10)).sort()[0]!)})` : ""} — each one about their own job, to the people most likely to answer.`;
  const cut = sample ? sample.body.lastIndexOf(`\n\n${b.name}`) : -1;
  const body = sample ? (cut > 0 ? sample.body.slice(0, cut) : sample.body).trim() : "";
  return [
    `${b.ownerFirstName}, it's Quiet Accounts. ${found}`,
    ``,
    ...(body ? [b.signerName.trim().toLowerCase() === b.ownerFirstName.trim().toLowerCase() ? `Here's the first note, going out in your name:` : `Here's the first note, going out from ${b.signerName}:`, ``, body, ``] : []),
    opts.awaitOk === false
      ? `Starting ${day}, the first ${onDay || people} go out, ${rest} You don't have to do anything.`
      : `Reply OK and the first ${onDay || people} go out ${day}, ${rest} Want anything changed? Just tell me what. Nothing goes out until you say OK.`,
    ``,
    `When someone ${wantedWords(b.plan).present}, I'll text you their name, number and what they said. Just reply:`,
    `BOOKED 2400 (the amount) when you book one`,
    `NO if it's dead`,
    `BUSY until Nov 15 if you're slammed — we'll wait`,
    `PAUSE to stop everything`,
    ``,
    ...callListLines(state),
    // "free" with its price beside it
    pass
      ? `${b.plan.freeFirst ? `Jobs from your first ${b.plan.freeFirst} people are free, as promised. For everyone after them: ` : ""}${passPromise(b.plan)}`
      : `The first ${b.plan.trialSize} are free, then ${fmtMoney(b.plan.monthlyPrice)} a month if you say yes.`,
  ].join("\n");
}

/** The one-pass promise (BRIEF §1), in the pass's own numbers. */
export function passPromise(plan: Pick<PlanState, "pricePerBooking" | "capBookings">): string {
  const price = plan.pricePerBooking ?? ONE_PASS.pricePerBooking;
  return `You pay ${fmtMoney(price)} for each job that books, never more than ${fmtMoney(price * (plan.capBookings ?? ONE_PASS.capBookings))}. Nothing books, you owe nothing.`;
}

/* ------------------------------------------------------------------ */
/* Money texts: a one pass's bookings (BRIEF B4) and the months (B5)    */
/* ------------------------------------------------------------------ */

const COUNT = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** A charge's money: its own, the running total with it, and the pass's cap. */
function chargeMoney(plan: PlanState, c: Charge): { price: string; soFar: string; cap: string } {
  const live = (plan.charges ?? []).filter(holdsPlace);
  const n = live.findIndex((x) => x.id === c.id) + 1 || live.length + 1;
  return { price: fmtMoney(c.amount / 100), soFar: fmtMoney((n * c.amount) / 100), cap: fmtMoney((plan.pricePerBooking ?? ONE_PASS.pricePerBooking) * (plan.capBookings ?? ONE_PASS.capBookings)) };
}

/**
 * Who a booking is, for a money text: the customer's name, else (a list row with only an email) the address their reply
 * to the pass came from, as the check-ins name them.
 */
export function bookingWho(state: AccountState, customerId: string, code?: string): string | undefined {
  const theirs = state.replies.filter((r) => r.customerId === customerId);
  return customerById(state.dataset, customerId)?.name || (theirs.find((r) => code && leadCode(r.id) === code) ?? theirs.find((r) => r.from))?.from || undefined;
}

/** "your card ending 4242", or just "your card" when only Jack knows which (his own link saved it). */
function cardWords(plan: PlanState): string {
  return plan.card?.last4 ? `your card ending ${plan.card.last4}` : "your card";
}

/** "your first month", or "the month from November 1". */
function monthWords(c: MonthCharge): string {
  return c.first ? "your first month" : `the month from ${monthName(c.month)} ${Number(c.month.slice(8))}`;
}

/**
 * The text for a billable booking, with the lead's code. The first goes by a link that saves the card (with no Stripe
 * key, Jack texts his own link); the rest go on the saved card on `on`, one business day after the text reaches the
 * owner, and NOT OURS before then cancels it. A link after the first (the card wasn't saved) says where the total stands.
 * A month's: the first one's, on the owner's yes, by the link that saves the card or on the card he saved already; a
 * later month's by its link (its pre-charge text says the rest, monthLine).
 */
export function chargeHeadsUp(state: AccountState, c: Charge | MonthCharge, opts: { link?: string; on?: ISODate }): string {
  const plan = state.dataset.business.plan;
  if (isMonth(c)) {
    const owner = state.dataset.business.ownerFirstName;
    const [what, price] = [monthWords(c), fmtMoney(c.amount / 100)];
    const promise = "Any month nobody asks to come back, you don't pay.";
    if (c.via === "card") return `${owner}, ${what}, ${price}, goes on ${cardWords(plan)} on ${WEEKDAY[new Date(`${opts.on}T12:00:00Z`).getUTCDay()]}. I text before every charge. ${promise}`;
    const pay = opts.link ? `here's the link for ${what}, ${price}: ${opts.link}.` : `${what} is ${price}. I'll text you the link.`;
    return `${owner}, ${pay} ${c.first ? `It saves your card, and I text before every charge. ${promise}` : "It saves your card for the rest."}`;
  }
  const name = bookingWho(state, c.customerId, c.code) ?? "Someone";
  const { price, soFar, cap } = chargeMoney(plan, c);
  if (c.via === "card") return `${name} booked (#${c.code}). ${price} goes on ${cardWords(plan)} on ${WEEKDAY[new Date(`${opts.on}T12:00:00Z`).getUTCDay()]}, ${soFar} of your ${cap}. Not ours? Reply NOT OURS #${c.code}.`;
  const first = soFar === price ? `That's your first ${price}.` : `That's ${price}, ${soFar} of your ${cap}.`;
  return `${name} booked (#${c.code}). ${first} ${opts.link ? `Here's the link: ${opts.link}.` : "I'll text you the link."} It saves your card for the rest, and I text before every charge.`;
}

/**
 * A later month's pre-charge text ends with this, in place of "Your next month starts November 1.": what goes on the
 * saved card that day (the text going on or after it, the day it's charged instead), or the link to pay it (with no
 * Stripe key and no card, Jack texts his own).
 */
export function monthLine(state: AccountState, c: MonthCharge, opts: { link?: string }): string {
  const next = `Your next month starts ${monthName(c.month)} ${Number(c.month.slice(8))}: ${fmtMoney(c.amount / 100)}`;
  const on = c.chargeOn && c.chargeOn > c.month ? `on ${WEEKDAY[new Date(`${c.chargeOn}T12:00:00Z`).getUTCDay()]}, ${monthName(c.chargeOn)} ${Number(c.chargeOn.slice(8))}` : "that day";
  if (c.via === "card") return `${next} goes on ${cardWords(state.dataset.business.plan)} ${on}.`;
  return opts.link ? `${next}. Here's the link to pay it: ${opts.link}. It saves your card for the rest.` : `${next}. I'll text you the link.`;
}

/** A charge on the saved card that didn't go through: the link to pay it instead, once Jack says so. */
export function chargeRetryText(state: AccountState, c: Charge | MonthCharge, link: string): string {
  const what = isMonth(c) ? `Your ${fmtMoney(c.amount / 100)} for ${monthWords(c)}` : `The ${fmtMoney(c.amount / 100)} for ${bookingWho(state, c.customerId, c.code) ?? "someone"} (#${c.code})`;
  return `${what} didn't go through on ${cardWords(state.dataset.business.plan)}. Here's the link to pay it: ${link}. It saves your card for the rest.`;
}

/** Once, when the cap's last charge is paid. */
export function chargeCapText(plan: PlanState): string {
  const n = plan.capBookings ?? ONE_PASS.capBookings;
  const cap = fmtMoney((plan.pricePerBooking ?? ONE_PASS.pricePerBooking) * n);
  return `That's ${COUNT[n] ?? n}, the ${cap} cap. Anything else that books from this pass is yours.`;
}

/** A charge Jack refunded (its job cancelled before the work, it wasn't ours, or it was paid twice or after a cancel). */
export function chargeRefundText(state: AccountState, c: Charge | MonthCharge): string {
  const what = isMonth(c) ? monthWords(c) : `${bookingWho(state, c.customerId, c.code) ?? "someone"} (#${c.code})`;
  return `Your ${fmtMoney(c.amount / 100)} for ${what} is going back on your card.`;
}

/**
 * A one pass's own notes: those due from its first send day on. A free round before it (the rest of a lawn or cleaning
 * list after its free 150) isn't the pass's, and nobody written to then is on the pass's list. Once it went monthly,
 * only those due by the day it was done: the notes after are the monthly plan's.
 */
export function passTouches(state: AccountState): Touch[] {
  const plan = state.dataset.business.plan;
  const from = plan.startedOn;
  const to = isOnePass(plan) ? undefined : plan.doneOn;
  return from ? state.touches.filter((t) => t.dueAt.slice(0, 10) >= from && (!to || t.dueAt.slice(0, 10) <= to)) : [];
}

/** Where a one pass stands: the people on its list and how many written to, and its notes sent out of all of them. */
export function passProgress(state: AccountState): { people: number; started: number; sent: number; notes: number } {
  const out = (t: { status: string }) => t.status === "sent" || t.status === "delivered" || t.status === "bounced";
  const listed = passTouches(state).filter((t) => out(t) || t.status === "planned" || t.status === "approved" || t.status === "sending");
  const firsts = listed.filter((t) => t.step === 1);
  return {
    people: new Set(firsts.map((t) => t.customerId)).size,
    started: new Set(firsts.filter(out).map((t) => t.customerId)).size,
    sent: listed.filter(out).length,
    notes: listed.length,
  };
}

/**
 * The one pass's last text, when its list is done: the tally with what was paid, then whether the list refills fast
 * enough to keep going monthly (refillRate), else a look next season. It never mentions the monthly price.
 */
export function passEndText(state: AccountState, asOf: ISODate): string {
  const b = state.dataset.business;
  // the pass's own people: what came before it (a free round) isn't in its tally
  const asked = new Set(passTouches(state).filter((t) => t.status === "sent" || t.status === "delivered").map((t) => t.customerId));
  const people = (rs: Reply[]) => new Set(rs.filter((r) => r.customerId && asked.has(r.customerId)).map((r) => r.customerId)).size;
  const wrote = people(state.replies.filter((r) => !["auto_reply", "bounce"].includes(r.intent)));
  const wanted = people(state.replies.filter((r) => WANTS.has(r.intent)));
  const booked = counted(state.recoveries).filter((r) => asked.has(r.customerId)).length;
  const refill = state.scan && refillRate(state.scan, asOf);
  const paid = passPaid(b.plan);
  const cap = (b.plan.pricePerBooking ?? ONE_PASS.pricePerBooking) * (b.plan.capBookings ?? ONE_PASS.capBookings);
  return [
    `${b.ownerFirstName}, your list is done. Asked ${asked.size}, ${wrote} wrote back, ${wanted} ${wantedWords(b.plan).past}, ${booked} booked. ${!paid ? "You paid nothing." : paid >= cap ? `You paid ${fmtMoney(paid)}, the cap.` : `You paid ${fmtMoney(paid)}.`}`,
    refill?.monthly
      ? `About ${refill.perMonth} more of your past customers stop coming or come due each month. That's enough to keep this going monthly: reply here and Jack will text you how it works.`
      : `I'll check back next season.`,
  ].join("\n\n");
}

/** "Tuesday, November 10" */
function dayWords(d: ISODate): string {
  return `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(`${d}T12:00:00Z`).getUTCDay()]}, ${monthName(d)} ${Number(d.slice(8))}`;
}

/** The people we won't email — big quotes and phone-only — handed over once, biggest first. */
function callListLines(state: AccountState): string[] {
  const cl = state.summary?.callList;
  if (!cl?.people) return [];
  const parts = [cl.bigQuotes ? `${cl.bigQuotes} quote${cl.bigQuotes === 1 ? "" : "s"} over ${fmtMoney(state.dataset.business.callOverAmount ?? CALL_OVER_AMOUNT)}` : "", cl.phoneOnly ? `${cl.phoneOnly} with only a phone number` : ""].filter(Boolean);
  const top = cl.top.slice(0, 3).map((x) => `${x.name} ${x.phone}${x.job ? ` (${x.job}, ${fmtMoney(x.value, { compact: true })})` : ""}`);
  return [`Worth a call from you (we don't email these): ${parts.join(" and ")}, ${fmtMoney(cl.value, { compact: true })} in all. Biggest first: ${top.join("; ")}.`, ``];
}

/** Old quotes get re-priced, not honored by accident. */
function staleNote(b: BusinessProfile, o: Opportunity | undefined, today: ISODate): string {
  if (!o?.anchorDate || !o.value) return "";
  if (!["unanswered_quote", "archived_quote", "changes_requested", "declined_quote"].includes(o.type)) return "";
  const days = daysBetween(o.anchorDate, today);
  if (days <= (b.voice.staleQuoteDays ?? STALE_QUOTE_DAYS)) return "";
  return `Heads up: that price is ${humanAge(days)} old. We didn't mention it; re-price before you book.`;
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** Nudge the owner when a hot lead has waited too long for a call. */
export function slaNudge(state: AccountState, r: Reply, hours: number): string {
  const c = state.dataset.customers.find((x) => x.id === r.customerId);
  return `${state.dataset.business.ownerFirstName}, ${c?.name ?? r.from} is still waiting — they asked ${Math.round(hours)} hours ago. Leads called the same day book far more often. Reply DONE once you've reached them.`;
}

/** "Did it book?" about one lead (BRIEF B6): a line of its own, with the lead's code, in the day's check-in text. */
export function checkInLine(state: AccountState, r: Reply): string {
  const code = leadCode(r.id);
  return `Did ${customerById(state.dataset, r.customerId)?.name || r.from} book? Reply BOOKED $amount #${code}, or NO #${code}.`;
}

/** A one pass is done: its owner is asked for fresh records, matched against everyone who wrote back (BRIEF B6). */
export function exportAskText(b: BusinessProfile): string {
  return `${b.ownerFirstName}, one last thing: can you send me a fresh export of your jobs and quotes, the way you sent the first one? I'll check it against everyone who wrote back.`;
}

export interface WeekNumbers {
  week: string;
  sent: number;
  people: number;
  replied: number;
  wants: number;
  booked: number;
  bookedValue: Money;
  waiting: string[];
  avgHoursToCall?: number;
  /** New requests answered this week, and how fast (median minutes from reaching us to the answer going out). */
  requestsAnswered: number;
  answerMinutes?: number;
  /** New quotes followed up this week (the fresh-quote track). */
  freshFollowed: number;
}

export function weekNumbers(state: AccountState, monday: ISODate): WeekNumbers {
  const end = addDays(monday, 7);
  const inWeek = (d: string | undefined) => !!d && d.slice(0, 10) >= monday && d.slice(0, 10) < end;
  const sent = state.touches.filter((t) => t.status === "sent" || t.status === "delivered").filter((t) => inWeek(t.sentAt ?? t.dueAt));
  const replies = state.replies.filter((r) => inWeek(r.receivedAt) && !["auto_reply", "bounce"].includes(r.intent));
  const recovered = counted(state.recoveries).filter((r) => inWeek(r.cameBackOn));
  const waiting = state.replies
    .filter((r) => WANTS.has(r.intent) && r.status !== "done" && !r.ownerContactedAt)
    .map((r) => state.dataset.customers.find((c) => c.id === r.customerId)?.name ?? r.from);
  const answers = sent.filter((t) => t.track === "new_request");
  const mins = answers
    .filter((t) => t.askedAt && t.sentAt)
    .map((t) => Math.max(0, Math.round((Date.parse(`${t.sentAt!.slice(0, 16)}:00Z`) - Date.parse(`${t.askedAt!.slice(0, 16)}:00Z`)) / 60_000)))
    .sort((a, b) => a - b);
  const hrs = state.replies
    .filter((r) => r.ownerContactedAt && inWeek(r.receivedAt))
    .map((r) => (Date.parse(r.ownerContactedAt!) - Date.parse(r.receivedAt)) / 3600000);
  return {
    week: isoWeekKey(monday),
    sent: sent.length,
    people: new Set(sent.map((t) => t.customerId)).size,
    replied: replies.length,
    wants: replies.filter((r) => WANTS.has(r.intent)).length,
    booked: recovered.length,
    bookedValue: round2(sum(recovered, (r) => r.value)),
    waiting,
    avgHoursToCall: hrs.length ? Math.round(sum(hrs, (h) => h) / hrs.length) : undefined,
    requestsAnswered: answers.length,
    answerMinutes: mins.length ? mins[Math.floor(mins.length / 2)] : undefined,
    freshFollowed: new Set(sent.filter((t) => t.track === "fresh_quote").map((t) => t.customerId)).size,
  };
}

/** An answer to a new request sent this soon after it reached us counts as "within minutes". */
const FAST_ANSWER_MINUTES = 30;

/** Minutes between two local wall-clock times ("2026-10-06T08:17"). */
function minutesBetween(from: string, to: string): number {
  return (Date.parse(`${to.slice(0, 16)}:00Z`) - Date.parse(`${from.slice(0, 16)}:00Z`)) / 60_000;
}

/** Friday report: what came back leads, then the counts; what's been paid as of `today` (the day it's written). */
export function weeklyReport(state: AccountState, monday: ISODate, today: ISODate = monday): string {
  const b = state.dataset.business;
  const w = weekNumbers(state, mondayOf(monday));
  const total = totals(state);
  const head =
    w.booked > 0
      ? `${b.ownerFirstName}, ${w.booked} ${w.booked === 1 ? "job" : "jobs"} came back this week — ${fmtMoney(w.bookedValue)}.`
      : w.wants > 0
        ? `${b.ownerFirstName}, ${w.wants} ${w.wants === 1 ? "person" : "people"} ${wantedWords(b.plan).past} this week.`
        : `${b.ownerFirstName}, here's your week.`;
  const lines = [
    head,
    "",
    `Notes out: ${w.sent} (to ${w.people} people)`,
    (() => {
      // the always-on work the owner would otherwise have to remember to do
      const end = addDays(mondayOf(monday), 7);
      const inWk = (t: { sentAt?: string; dueAt: string }) => { const d = (t.sentAt ?? t.dueAt).slice(0, 10); return d >= mondayOf(monday) && d < end; };
      const sentT = state.touches.filter((t) => (t.status === "sent" || t.status === "delivered") && inWk(t));
      const answers = sentT.filter((t) => t.track === "new_request");
      const reqs = answers.length;
      // "within minutes" only for answers whose recorded send time says so (night requests wait for 7am)
      const fast = answers.filter((t) => minutesBetween(t.askedAt ?? t.dueAt, t.sentAt ?? t.dueAt) <= FAST_ANSWER_MINUTES).length;
      const fresh = new Set(sentT.filter((t) => t.track === "fresh_quote").map((t) => t.customerId)).size;
      if (!reqs && !fresh) return "";
      const answered = `answered ${reqs} new ${reqs === 1 ? "request" : "requests"}${fast === reqs ? " within minutes" : fast ? ` (${fast} within minutes)` : ""}`;
      return `Always on: ${[reqs ? answered : "", fresh ? `followed up ${fresh} new ${fresh === 1 ? "quote" : "quotes"}` : ""].filter(Boolean).join(", ")}`;
    })(),
    `Wrote back: ${w.replied}`,
    `${wantedWords(b.plan).label}: ${w.wants}`,
    `Booked: ${w.booked}${w.bookedValue ? ` · ${fmtMoney(w.bookedValue)}` : ""}`,
    (() => {
      // the number the whole service drives toward zero
      const q = quietRates(state);
      const parts = [
        q.since && q.since.quotes >= 5 ? `Quotes that went quiet: ${pct(q.since.rate)} (was ${pct(q.before.rate)} before we started)` : "",
        q.backlog?.followed ? `Old quotes answered so far: ${q.backlog.answered} of ${q.backlog.followed}` : "",
      ].filter(Boolean);
      return parts.join("\n");
    })(),
    w.avgHoursToCall !== undefined ? `Your average time to call them back: ${w.avgHoursToCall}h` : "",
    w.waiting.length ? `\nStill waiting on a call from you: ${w.waiting.slice(0, 6).join(", ")}${w.waiting.length > 6 ? ` +${w.waiting.length - 6} more` : ""}` : "",
    (() => {
      const why = lossReasons(state);
      const n = why.reduce((a, x) => a + x.count, 0);
      return n >= 3 ? `\nWhy the quiet ones said no: ${why.slice(0, 4).map((x) => `${x.count} ${x.reason}`).join(", ")}.` : "";
    })(),
    "",
    `Since you started: ${total.booked} booked, ${fmtMoney(total.bookedValue)}. ${total.remaining.toLocaleString("en-US")} people still to work.`,
    (() => {
      // a one pass charges per booking (B4), never the monthly fees of a plan it was made from
      if (isOnePass(b.plan)) return "";
      const fees = paidSoFar(b, today);
      if (!fees.total) return "";
      return `You've paid us ${fmtMoney(fees.total)}${fees.freeMonths ? ` (${fees.freeMonths} free ${fees.freeMonths === 1 ? "month" : "months"})` : ""}. Traced back: ${fmtMoney(total.bookedValue)}${total.bookedValue > 0 ? ` — ${round2(total.bookedValue / fees.total)}x` : ""}.`;
    })(),
    total.afterNote ? `Also came back after a note without writing to us: ${total.afterNote} (${fmtMoney(total.afterNoteValue)}) — not counted above.` : "",
  ];
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
}

/**
 * Why quotes died, in the homeowners' own words. Homeowners ghost because saying no is awkward, so
 * owners never learn this — the easy "reply pass" line and the close-out question surface it.
 */
export function lossReasons(state: AccountState): { reason: string; count: number }[] {
  const tally = new Map<string, number>();
  const add = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
  for (const r of state.replies) {
    if (r.intent === "already_done") add(r.extracted.mentionsCompetitor || /\b(someone|somebody|another|other (company|guy|crew)|went with)\b/i.test(r.text) ? "went with someone else" : "got it done another way");
    else if (r.intent === "not_interested") add(r.extracted.mentionsPrice ? "price" : "don't need it anymore");
    else if (r.intent === "later") add("timing");
    else if (r.intent === "moved") add("moved");
  }
  return [...tally.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

export function totals(state: AccountState): { booked: number; bookedValue: Money; afterNote: number; afterNoteValue: Money; contacted: number; replied: number; wants: number; remaining: number } {
  const contacted = new Set(state.touches.filter((t) => t.status === "sent" || t.status === "delivered").map((t) => t.customerId));
  // still to work: who a plan could write to, the same pick as every plan (only the leaks the trade's offer works)
  const workable = new Set(pickWorked(state.dataset.business.trade, state.scan?.opportunities ?? []).filter((o) => o.channels.includes("email")).map((o) => o.customerId));
  for (const id of contacted) workable.delete(id);
  for (const o of state.outreach) if (o.holdout) workable.delete(o.customerId);
  return {
    booked: counted(state.recoveries).length,
    bookedValue: round2(sum(counted(state.recoveries), (r) => r.value)),
    afterNote: state.recoveries.filter((r) => !r.disputed && r.tier === "after_note").length,
    afterNoteValue: round2(sum(state.recoveries.filter((r) => !r.disputed && r.tier === "after_note"), (r) => r.value)),
    contacted: contacted.size,
    replied: state.replies.filter((r) => !["auto_reply", "bounce"].includes(r.intent)).length,
    wants: state.replies.filter((r) => WANTS.has(r.intent)).length,
    remaining: workable.size,
  };
}

/**
 * The close, sent a week after the free round's last note.
 * Leads with what came back (names), counts second, then the offer and the guarantee. The year is offered only
 * where the server sells it.
 */
export function closeMessage(state: AccountState, opts: { payLink?: string; signature?: string; sayYesBy?: string; nextBatchOn?: ISODate } & Features = {}): string {
  const b = state.dataset.business;
  const quotes = !soldMonthly(b.trade);
  const t = totals(state);
  const names = counted(state.recoveries)
    .map((r) => state.dataset.customers.find((c) => c.id === r.customerId)?.name)
    .filter(Boolean) as string[];
  // one name per person, however many times they wrote
  const askers = [...new Set(state.replies.filter((r) => WANTS.has(r.intent)).map((r) => state.dataset.customers.find((c) => c.id === r.customerId)?.name ?? r.from))];
  const trial = b.plan.trialSize;
  const notes = state.touches.filter((x) => x.status === "sent" || x.status === "delivered").length;
  const lead =
    t.booked > 0
      ? `${b.ownerFirstName}, the free ${trial} put ${t.booked} ${t.booked === 1 ? "job" : "jobs"} back on your calendar, ${fmtMoney(t.bookedValue)}: ${someNames(names, t.booked)}.`
      : askers.length
        ? `${b.ownerFirstName}, from the free ${trial}, ${someNames(askers, askers.length)} ${wantedWords(b.plan).past}.`
        : `${b.ownerFirstName}, the free ${trial} is done.`;
  const lines = [
    lead,
    `From ${notes} ${notes === 1 ? "note" : "notes"} to ${t.contacted} ${t.contacted === 1 ? "person" : "people"}, ${t.replied} wrote back and ${t.wants} ${wantedWords(b.plan).past}.`,
    t.remaining ? `There are ${t.remaining.toLocaleString("en-US")} more ${quotes ? "quiet quotes and past customers" : "past customers"} behind them.` : "",
    `${fmtMoney(b.plan.monthlyPrice)} a month keeps it going on the rest of the list and everyone who drops off each month. Cancel by text, any time.`,
    `And the guarantee: any month nobody asks to come back, you don't pay.`,
    opts.yearly && offerYear(state, t.bookedValue)
      ? `Or pay for the year: ${fmtMoney(annualPrice(b))}, twelve months for the price of ten. If the jobs we trace to our notes don't add up to what you paid, we refund the difference. A quiet month still comes back to you (${fmtMoney(annualRefund(b), { cents: true })}), your price is locked, and nothing renews without your yes.`
      : "",
    opts.sayYesBy ? `Say yes by ${opts.sayYesBy} and the next batch goes out ${opts.nextBatchOn ? dayWords(opts.nextBatchOn) : "next week"}.` : "",
    opts.payLink ?? "",
    opts.signature ?? "",
  ];
  return lines.filter(Boolean).join("\n\n");
}

/**
 * The yearly plan is offered only when it's an easy yes on the owner's own numbers: the free round alone brought
 * back more than a year costs. The year promises to pay for itself, so it's offered only where that's already true.
 */
export function offerYear(state: AccountState, bookedValue: Money): boolean {
  return bookedValue >= annualPrice(state.dataset.business);
}

/**
 * Thirty days before a paid year ends: what the year did, and a plain choice. Nothing renews by itself.
 */
export function renewalNotice(state: AccountState, asOf: ISODate): { yearEnds: ISODate; text: string } | undefined {
  const b = state.dataset.business;
  if (b.plan.billing !== "annual" || !b.plan.paidOn || b.plan.stage !== "paying") return undefined;
  const started = [...(b.plan.yearsPaidOn?.length ? b.plan.yearsPaidOn : [b.plan.paidOn])].sort().pop()!;
  const yearEnds = addMonths(started, 12);
  const left = daysBetween(asOf, yearEnds);
  if (left > 30 || left < 0) return undefined;
  const inYear = (d: string) => d.slice(0, 10) >= started && d.slice(0, 10) < yearEnds;
  const won = counted(state.recoveries).filter((r) => inYear(r.cameBackOn));
  const value = sum(won, (r) => r.value);
  const asked = state.replies.filter((r) => WANTS.has(r.intent) && inYear(r.receivedAt)).length;
  const refunded = quietInYear(b, started);
  const floor = yearFloor(state, started);
  const text = [
    `${b.ownerFirstName}, your year with us ends ${monthName(yearEnds)} ${Number(yearEnds.slice(8))}. Nothing renews unless you say so.`,
    floor.refund > 0
      ? `So far the jobs we traced (${fmtMoney(floor.traced)}) haven't covered what you paid (${fmtMoney(floor.paid)}). If it ends that way, the difference comes back to you.`
      : `The year has paid for itself: ${fmtMoney(floor.traced)} traced to our notes against ${fmtMoney(floor.paid)} paid.`,
    `This year: ${asked} ${asked === 1 ? "person" : "people"} ${wantedWords(b.plan).past}, ${won.length} booked, ${fmtMoney(value)} traced to our notes.${refunded ? ` ${refunded} quiet ${refunded === 1 ? "month" : "months"} refunded.` : ""}`,
    `Reply RENEW to keep ${fmtMoney(annualPrice(b))} for another year, MONTHLY to go month to month at ${fmtMoney(b.plan.monthlyPrice)}, or nothing and it simply ends.`,
  ].join("\n\n");
  return { yearEnds, text };
}

function joinNames(n: string[]): string {
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** Up to four names; past that, "+N more" so a partial list never reads as the whole one. */
function someNames(all: string[], total: number, max = 4): string {
  const shown = all.slice(0, max);
  const more = Math.max(total, all.length) - shown.length;
  return more > 0 ? `${shown.join(", ")} +${more} more` : joinNames(shown);
}

/* ------------------------------------------------------------------ */
/* Billing & the guarantee                                             */
/* ------------------------------------------------------------------ */

/**
 * A quiet month is recorded under its charge date, the END of the period it covers, so a paid year that starts
 * on yearStart owns the quiet months dated in (yearStart, yearStart + 12 months]. `until` narrows it to the
 * months used so far.
 */
export function quietInYear(b: BusinessProfile, yearStart: ISODate, until: ISODate = addMonths(yearStart, 12)): number {
  return b.plan.freeMonths.filter((d) => d > yearStart && d <= until).length;
}

/** The paid year running on `today`, if any, whatever the billing says now (MONTHLY takes effect at the year's end). */
export function paidYearOn(b: BusinessProfile, today: ISODate): ISODate | undefined {
  const years = b.plan.yearsPaidOn?.length ? b.plan.yearsPaidOn : b.plan.billing === "annual" && b.plan.paidOn ? [b.plan.paidOn] : [];
  return [...years].sort().filter((y) => y <= today && today < addMonths(y, 12)).pop();
}

/** Twelve months for the price of ten. */
export function annualPrice(b: BusinessProfile): Money {
  return b.plan.annualPrice ?? round2(b.plan.monthlyPrice * 10);
}

/** What a quiet month gives back on a yearly plan: a twelfth of the year. */
export function annualRefund(b: BusinessProfile): Money {
  return round2(annualPrice(b) / 12);
}

/** What the owner has actually been charged so far, net of quiet months and any year that didn't pay for itself. */
export function feesPaid(b: BusinessProfile, asOf: ISODate): { total: Money; months: number; freeMonths: number } {
  const f = grossFees(b, asOf);
  const refunded = sum((b.plan.yearRefunds ?? []).filter((r) => r.early || addMonths(r.yearStart, 12) <= asOf), (r) => r.amount);
  return { ...f, total: round2(f.total - refunded) };
}

/**
 * What the owner has paid us as of `asOf` (the weekly text): on the monthly plan the software charges (BRIEF B5), the
 * months actually paid by then (never one declined, refunded, waiting for Jack's OK, or a paused stretch's) and a one
 * pass's bookings paid before it went monthly, plus fees from an earlier arrangement. A yearly plan, or a monthly one
 * charged by hand before the software did (no month on its log), by its dates (feesPaid).
 */
export function paidSoFar(b: BusinessProfile, asOf: ISODate): { total: Money; freeMonths: number } {
  const paid = (cs: { status: string; paidAt?: string; amount: number }[]) => sum(cs.filter((c) => c.status === "paid" && (c.paidAt ?? "").slice(0, 10) <= asOf), (c) => c.amount) / 100;
  if (b.plan.billing === "annual" || !b.plan.months?.length) return feesPaid(b, asOf);
  const refunded = sum((b.plan.yearRefunds ?? []).filter((r) => r.early || addMonths(r.yearStart, 12) <= asOf), (r) => r.amount);
  const free = b.plan.freeMonths.filter((d) => (!b.plan.paidOn || d > b.plan.paidOn) && d <= asOf).length;
  return { total: round2(paid(b.plan.months) + paid(b.plan.charges ?? []) + (b.plan.priorFees ?? 0) - refunded), freeMonths: free };
}

/** Everything charged across billing arrangements, before year-end refunds. */
export function grossFees(b: BusinessProfile, asOf: ISODate): { total: Money; months: number; freeMonths: number } {
  const f = feesThisArrangement(b, asOf);
  return { ...f, total: round2(f.total + (b.plan.priorFees ?? 0)) };
}

/**
 * Leaving a yearly plan early: it never costs more than monthly would have. The months used are charged at
 * the monthly price (quiet months free), and the year floor still applies to them; the rest comes back.
 */
export function earlyLeaveRefund(state: AccountState, today: ISODate): { yearStart: ISODate; monthsUsed: number; quiet: number; asMonthly: Money; paid: Money; traced: Money; refund: Money } | undefined {
  const b = state.dataset.business;
  const yearStart = paidYearOn(b, today);
  if (!yearStart) return undefined;
  let monthsUsed = 0;
  while (monthsUsed < 12 && addMonths(yearStart, monthsUsed) <= today) monthsUsed++;
  // every quiet month already recorded for this year has been (or will be) refunded; the used ones are free
  const quiet = quietInYear(b, yearStart);
  const quietUsed = quietInYear(b, yearStart, addMonths(yearStart, monthsUsed));
  const paid = round2(annualPrice(b) - quiet * annualRefund(b));
  const asMonthly = round2(Math.max(0, monthsUsed - quietUsed) * b.plan.monthlyPrice);
  // never more than monthly would have cost, and (the year floor, on the months used) never more than the jobs traced in them
  const traced = round2(sum(counted(state.recoveries).filter((r) => r.cameBackOn >= yearStart && r.cameBackOn <= today), (r) => r.value));
  const keep = Math.min(paid, asMonthly, traced);
  return { yearStart, monthsUsed, quiet: quietUsed, asMonthly, paid, traced, refund: round2(Math.max(0, paid - keep)) };
}

/**
 * The yearly promise: if the jobs we traced in a paid year don't add up to what was paid for it (after any
 * quiet-month refunds), the difference comes back. Traced jobs only — "came back after our note" never counts.
 */
export function yearFloor(state: AccountState, yearStart: ISODate): { paid: Money; traced: Money; refund: Money; yearEnds: ISODate } {
  const b = state.dataset.business;
  const yearEnds = addMonths(yearStart, 12);
  const paid = round2(annualPrice(b) - quietInYear(b, yearStart) * annualRefund(b));
  const traced = round2(sum(counted(state.recoveries).filter((r) => r.cameBackOn >= yearStart && r.cameBackOn < yearEnds), (r) => r.value));
  return { paid, traced, refund: round2(Math.max(0, paid - traced)), yearEnds };
}

function feesThisArrangement(b: BusinessProfile, asOf: ISODate): { total: Money; months: number; freeMonths: number } {
  if (!b.plan.paidOn || b.plan.paidOn > asOf) return { total: 0, months: 0, freeMonths: 0 };
  if (b.plan.billing === "annual") {
    // Only the years of this arrangement; earlier ones are in priorFees.
    const years = (b.plan.yearsPaidOn?.length ? b.plan.yearsPaidOn : [b.plan.paidOn]).filter((d) => d >= b.plan.paidOn! && d <= asOf).length;
    // this arrangement's quiet months only: ones from a monthly stretch before it are already in priorFees
    const free = b.plan.freeMonths.filter((d) => d > b.plan.paidOn! && d <= asOf).length;
    let months = 0;
    while (months < 240 && addMonths(b.plan.paidOn, months) <= asOf) months++;
    return { total: round2(years * annualPrice(b) - free * annualRefund(b)), months: months - free, freeMonths: free };
  }
  let months = 0;
  let free = 0;
  for (let n = 0; n < 240; n++) {
    const d = addMonths(b.plan.paidOn, n);
    if (d > asOf) break;
    // the first charge opens a period, it never closes one: a quiet month dated there belongs to the year before
    if (n > 0 && b.plan.freeMonths.includes(d)) free++;
    else months++;
  }
  return { total: round2(months * b.plan.monthlyPrice), months, freeMonths: free };
}

/**
 * The next monthly charge that closes a period, on or after `asOf - 3 days`. The day they started paying is
 * the first charge, not the end of a period, so the guarantee is never judged on an empty month.
 */
export function nextCharge(paidOn: ISODate, asOf: ISODate): { chargeOn: ISODate; periodStart: ISODate } {
  let n = 1;
  let charge = addMonths(paidOn, 1);
  while (daysBetween(charge, asOf) > 3) {
    n++;
    charge = addMonths(paidOn, n);
  }
  return { chargeOn: charge, periodStart: addMonths(paidOn, n - 1) };
}

export interface GuaranteeCheck {
  periodStart: ISODate;
  chargeOn: ISODate;
  asked: Reply[];
  booked: Recovery[];
  free: boolean;
  text: string;
}

/** Any month nobody asks to come back is free. */
export function guaranteeCheck(state: AccountState, asOf: ISODate): GuaranteeCheck | undefined {
  const b = state.dataset.business;
  if (!b.plan.paidOn) return undefined;
  // inside a paid year, its months are judged on the year's own dates, even after MONTHLY (which starts at the year's end)
  // (the year of the charge being judged: three days into a renewed year, the old year's last month still is)
  const year = paidYearOn(b, addDays(asOf, -3));
  const { chargeOn, periodStart } = nextCharge(year ?? b.plan.paidOn, asOf);
  const inPeriod = (d: string) => d.slice(0, 10) >= periodStart && d.slice(0, 10) < chargeOn;
  // Only people we followed up with count. Someone answering our reply to their own new request was asking
  // anyway; counting them would let requests the owner gets regardless cancel his free month. Nor does a reply to a
  // one pass's notes (one gone monthly since): it's billed by the pass's terms, so one booking never also makes a month
  // paid. A reply we can't tie to a note counts only for someone the pass never wrote to.
  const touchById = new Map(state.touches.map((t) => [t.id, t]));
  const pass = new Set(passTouches(state).map((t) => t.id));
  const passPeople = new Set(passTouches(state).map((t) => t.customerId));
  const followedUp = new Set(state.touches.filter((t) => t.track !== "new_request" && !pass.has(t.id) && (t.status === "sent" || t.status === "delivered")).map((t) => t.customerId));
  const fromFollowUp = (r: (typeof state.replies)[number]) => {
    const t = r.touchId ? touchById.get(r.touchId) : undefined;
    if (t) return t.track !== "new_request" && !pass.has(t.id);
    if (r.opportunityId?.startsWith("req:")) return false;
    return !!r.customerId && followedUp.has(r.customerId) && !passPeople.has(r.customerId);
  };
  const asked = state.replies.filter((r) => WANTS.has(r.intent) && inPeriod(r.receivedAt) && fromFollowUp(r));
  const booked = counted(state.recoveries).filter((r) => inPeriod(r.cameBackOn));
  const free = asked.length === 0;
  const notesInPeriod = state.touches.filter((t) => (t.status === "sent" || t.status === "delivered") && inPeriod(t.sentAt ?? t.dueAt)).length;
  const repliesInPeriod = state.replies.filter((r) => !["auto_reply", "bounce"].includes(r.intent) && inPeriod(r.receivedAt)).length;
  const t = totals(state);
  // a date, never "since a few weeks ago"
  const since = `${monthName(periodStart)} ${Number(periodStart.slice(8))}`;
  const annual = !!year || b.plan.billing === "annual";
  const text = free
    ? `${b.ownerFirstName}, nobody we followed up with ${wantedWords(b.plan).past} since ${since}, so this month is free, like I promised. ${annual ? `${fmtMoney(annualRefund(b), { cents: true })} goes back to your card on ${monthName(chargeOn)} ${Number(chargeOn.slice(8))}.` : `You won't be charged on ${monthName(chargeOn)} ${Number(chargeOn.slice(8))}.`}\n\nThe record: ${notesInPeriod} ${notesInPeriod === 1 ? "note" : "notes"} out, ${repliesInPeriod} ${repliesInPeriod === 1 ? "reply" : "replies"}, and nobody ${wantedWords(b.plan).past}. Nothing for you to do — it's automatic.\n\nThe notes keep going out, and you'll hear from me the day someone bites.`
    : [
        `${b.ownerFirstName}, here's who came back since ${since}:`,
        ...asked.slice(0, 8).map((r) => {
          const c = state.dataset.customers.find((x) => x.id === r.customerId);
          const rec = booked.find((x) => x.customerId === r.customerId);
          const status = rec ? `booked ${fmtMoney(rec.value)}` : r.outcome === "quoted" ? "re-quoted" : r.outcome === "lost" ? "passed for now" : r.handedOffAt ? `sent to you ${monthName(r.handedOffAt.slice(0, 10))} ${Number(r.handedOffAt.slice(8, 10))}` : wantsLine(r).toLowerCase();
          return `• ${c?.name ?? r.from}${c?.address?.street ? `, ${c.address.street}` : ""}: ${status}`;
        }),
        "",
        `Since you started: ${t.booked} booked, ${fmtMoney(t.bookedValue)}.`,
        `Your next month starts ${monthName(chargeOn)} ${Number(chargeOn.slice(8))}.`,
      ].join("\n");
  return { periodStart, chargeOn, asked, booked, free, text };
}

/** One-line explanation of why an opportunity is on the list — for the owner's drawer view. */
export function whyLine(o: Opportunity): string {
  return o.reason;
}
