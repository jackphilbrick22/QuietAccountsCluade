import type { BusinessProfile, ISODate, Money, Opportunity, Recovery, Reply } from "../model.ts";
import type { AccountState } from "../runtime/state.ts";
import { addDays, addMonths, daysBetween, fmtMoney, fmtPhone, humanAge, isoWeekKey, mondayOf, monthName, round2, spokenWhen, sum } from "../util.ts";
import { STALE_QUOTE_DAYS } from "../breakage/assumptions.ts";

const WANTS = new Set(["wants_it", "wants_price"]);

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
    o ? `Original: ${o.anchorDate ? spokenWhen(o.anchorDate, r.receivedAt.slice(0, 10)).replace(/^back in /, "") : "—"} · ${o.value ? fmtMoney(o.value) : "—"} · ${o.jobPhrase.replace(/^the /, "")}` : "",
    staleNote(o, r.receivedAt.slice(0, 10)),
    `They said: “${oneLine(r.text, 160)}”`,
    `Best contact: ${r.extracted.phone ? fmtPhone(r.extracted.phone) : c?.phones[0] ? fmtPhone(c.phones[0]) : c?.emails[0] ?? r.from}${r.extracted.bestTime ? ` (${r.extracted.bestTime})` : ""}`,
    `Wants: ${wantsLine(r)}`,
    `Text back BOOKED + amount, DONE, or NO · #${leadCode(r.id)}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** Old quotes get re-priced, not honored by accident. */
function staleNote(o: Opportunity | undefined, today: ISODate): string {
  if (!o?.anchorDate || !o.value) return "";
  if (!["unanswered_quote", "archived_quote", "changes_requested", "declined_quote"].includes(o.type)) return "";
  const days = daysBetween(o.anchorDate, today);
  if (days <= STALE_QUOTE_DAYS) return "";
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
}

export function weekNumbers(state: AccountState, monday: ISODate): WeekNumbers {
  const end = addDays(monday, 7);
  const inWeek = (d: string | undefined) => !!d && d.slice(0, 10) >= monday && d.slice(0, 10) < end;
  const sent = state.touches.filter((t) => t.status === "sent" || t.status === "delivered").filter((t) => inWeek(t.sentAt ?? t.dueAt));
  const replies = state.replies.filter((r) => inWeek(r.receivedAt) && !["auto_reply", "bounce"].includes(r.intent));
  const recovered = state.recoveries.filter((r) => inWeek(r.cameBackOn));
  const waiting = state.replies
    .filter((r) => WANTS.has(r.intent) && r.status !== "done" && !r.ownerContactedAt)
    .map((r) => state.dataset.customers.find((c) => c.id === r.customerId)?.name ?? r.from);
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
  };
}

/** Friday report: what came back leads, then the counts. */
export function weeklyReport(state: AccountState, monday: ISODate): string {
  const b = state.dataset.business;
  const w = weekNumbers(state, mondayOf(monday));
  const total = totals(state);
  const head =
    w.booked > 0
      ? `${b.ownerFirstName}, ${w.booked} ${w.booked === 1 ? "job" : "jobs"} came back this week — ${fmtMoney(w.bookedValue)}.`
      : w.wants > 0
        ? `${b.ownerFirstName}, ${w.wants} ${w.wants === 1 ? "person" : "people"} asked for a price or a date this week.`
        : `${b.ownerFirstName}, here's your week.`;
  const lines = [
    head,
    "",
    `Notes out: ${w.sent} (to ${w.people} people)`,
    `Wrote back: ${w.replied}`,
    `Want a price or a date: ${w.wants}`,
    `Booked: ${w.booked}${w.bookedValue ? ` · ${fmtMoney(w.bookedValue)}` : ""}`,
    w.avgHoursToCall !== undefined ? `Your average time to call them back: ${w.avgHoursToCall}h` : "",
    w.waiting.length ? `\nStill waiting on a call from you: ${w.waiting.slice(0, 6).join(", ")}${w.waiting.length > 6 ? ` +${w.waiting.length - 6} more` : ""}` : "",
    "",
    `Since you started: ${total.booked} booked, ${fmtMoney(total.bookedValue)}. ${total.remaining.toLocaleString("en-US")} people still to work.`,
  ];
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
}

export function totals(state: AccountState): { booked: number; bookedValue: Money; contacted: number; replied: number; wants: number; remaining: number } {
  const contacted = new Set(state.touches.filter((t) => t.status === "sent" || t.status === "delivered").map((t) => t.customerId));
  const workable = new Set((state.scan?.primary ?? []).filter((o) => o.channels.includes("email")).map((o) => o.customerId));
  for (const id of contacted) workable.delete(id);
  for (const o of state.outreach) if (o.holdout) workable.delete(o.customerId);
  return {
    booked: state.recoveries.length,
    bookedValue: round2(sum(state.recoveries, (r) => r.value)),
    contacted: contacted.size,
    replied: state.replies.filter((r) => !["auto_reply", "bounce"].includes(r.intent)).length,
    wants: state.replies.filter((r) => WANTS.has(r.intent)).length,
    remaining: workable.size,
  };
}

/**
 * The close, sent a week after the free round's last note.
 * Leads with what came back (names), counts second, then the offer and the guarantee.
 */
export function closeMessage(state: AccountState, opts: { payLink?: string; signature?: string; sayYesBy?: string } = {}): string {
  const b = state.dataset.business;
  const t = totals(state);
  const names = state.recoveries
    .map((r) => state.dataset.customers.find((c) => c.id === r.customerId)?.name)
    .filter(Boolean)
    .slice(0, 4) as string[];
  const askers = state.replies
    .filter((r) => WANTS.has(r.intent))
    .map((r) => state.dataset.customers.find((c) => c.id === r.customerId)?.name ?? r.from)
    .slice(0, 4);
  const trial = b.plan.trialSize;
  const lead =
    t.booked > 0
      ? `${b.ownerFirstName}, the free ${trial} put ${t.booked} ${t.booked === 1 ? "job" : "jobs"} back on your calendar, ${fmtMoney(t.bookedValue)}: ${joinNames(names)}.`
      : askers.length
        ? `${b.ownerFirstName}, from the free ${trial}, ${joinNames(askers)} asked for a price or a date.`
        : `${b.ownerFirstName}, the free ${trial} is done.`;
  const lines = [
    lead,
    `From ${t.contacted} notes, ${t.replied} wrote back and ${t.wants} asked for a price or a date.`,
    t.remaining ? `There are ${t.remaining.toLocaleString("en-US")} more quiet quotes and past customers behind them.` : "",
    `${fmtMoney(b.plan.monthlyPrice)} a month keeps it going on the rest of the list and every new quote you write. Cancel by text, any time.`,
    `And the guarantee: any month nobody asks for a price or a date, you don't pay.`,
    opts.sayYesBy ? `Say yes by ${opts.sayYesBy} and the next batch goes out next week.` : "",
    opts.payLink ?? "",
    opts.signature ?? "",
  ];
  return lines.filter(Boolean).join("\n\n");
}

function joinNames(n: string[]): string {
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Billing & the guarantee                                             */
/* ------------------------------------------------------------------ */

/** Next monthly charge on or after `asOf - 3 days`, anchored to the first paid day. */
export function nextCharge(paidOn: ISODate, asOf: ISODate): { chargeOn: ISODate; periodStart: ISODate } {
  let n = 0;
  let charge = paidOn;
  while (daysBetween(charge, asOf) > 3) {
    n++;
    charge = addMonths(paidOn, n);
  }
  return { chargeOn: charge, periodStart: n === 0 ? paidOn : addMonths(paidOn, n - 1) };
}

export interface GuaranteeCheck {
  periodStart: ISODate;
  chargeOn: ISODate;
  asked: Reply[];
  booked: Recovery[];
  free: boolean;
  text: string;
}

/** Any month where nobody asks for a price or a date is free. */
export function guaranteeCheck(state: AccountState, asOf: ISODate): GuaranteeCheck | undefined {
  const b = state.dataset.business;
  if (!b.plan.paidOn) return undefined;
  const { chargeOn, periodStart } = nextCharge(b.plan.paidOn, asOf);
  const inPeriod = (d: string) => d.slice(0, 10) >= periodStart && d.slice(0, 10) < chargeOn;
  const asked = state.replies.filter((r) => WANTS.has(r.intent) && inPeriod(r.receivedAt));
  const booked = state.recoveries.filter((r) => inPeriod(r.cameBackOn));
  const free = asked.length === 0;
  const t = totals(state);
  const since = spokenWhen(periodStart, asOf).replace(/^back in /, "");
  const text = free
    ? `${b.ownerFirstName}, nobody asked for a price or a date since ${since}, so this month is free, like I promised. You won't be charged on ${monthName(chargeOn)} ${Number(chargeOn.slice(8))}.\n\nThe notes keep going out, and you'll hear from me the day someone bites.`
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
