import type { BusinessProfile, Customer, Dataset, ISODate, ISODateTime, MessageAngle, Opportunity, ServiceRequest } from "../model.ts";
import { classifyService, climateOf, findService, jobPhrase, monthsUntilSeason, playbook, seasonFit } from "../trades/index.ts";
import { alwaysOnFor, STALE_QUOTE_DAYS } from "../breakage/assumptions.ts";
import { addDays, daysBetween, fmtMoney, fmtPhone, greetingName, humanAge, intervalWords, mondayOf, MONTH_NAMES, monthName, pickBy, spokenWhen, streetName } from "../util.ts";
import { lint } from "./lint.ts";
import { quoteById, scheduledWork, type ScheduledWork } from "../lookup.ts";
import { sequenceFor, TEMPLATES, templateKey, type NoteTemplate } from "./templates.ts";

export interface RenderedNote {
  subject: string;
  body: string;
  angle: MessageAngle;
  templateId: string;
  flags: string[];
}

export interface RenderContext {
  ds: Dataset;
  /** The day this note goes out (drives "a crew nearby next week" and season lines). */
  sendOn: ISODate;
  /** We've written to this person before — so never say "that's on us for not following up". */
  contactedBefore?: boolean;
  /**
   * The subject note 1 actually went out with. Every later note is "Re: " + exactly this, so it threads
   * (Gmail splits a thread whose subject changes). Worked out from note 1 when not given.
   */
  threadSubject?: string;
}

/** Factual crew-nearby line from the real schedule or the owner's open-crew weeks. Never invented. */
export function crewLine(ds: Dataset, customer: Customer, sendOn: ISODate): string | undefined {
  const city = customer.address?.city?.toLowerCase();
  const street = streetName(customer.address?.street).toLowerCase();
  const horizon = addDays(sendOn, 21);
  let hit: ScheduledWork | undefined;
  for (const w of scheduledWork(ds)) {
    if (w.date < sendOn) continue;
    if (w.date > horizon) break;
    if (w.customerId === customer.id) continue;
    if ((street && w.street === street) || (city && w.city === city)) {
      hit = w;
      break;
    }
  }
  if (hit) {
    const week = mondayOf(hit.date);
    const weekText = `the week of ${monthName(week)} ${Number(week.slice(8))}`;
    if (street && hit.street === street) return `We've actually got a crew working on ${titleCaseWords(hit.street)} ${weekText}.`;
    return `We've got a crew working in ${titleCaseWords(hit.city) || customer.address?.city} ${weekText}.`;
  }
  if (ds.business.bookedOutUntil && ds.business.bookedOutUntil > horizon) return undefined; // no openings to offer
  const open = ds.business.openCrewWeeks.find((w) => w >= mondayOf(sendOn) && w <= horizon);
  if (open) return `We've got a couple of open days the week of ${monthName(open)} ${Number(open.slice(8))}.`;
  return undefined;
}

function titleCaseWords(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function tokens(o: Opportunity, c: Customer, b: BusinessProfile, rc: RenderContext): Record<string, string> {
  const svc = findService(o.serviceId)?.service;
  const climate = climateOf(b.state);
  const anchor = o.anchorDate;
  // "We did {job} for you {when}" is about their job, not the day it came due.
  const doneOn = o.lastDoneOn ?? anchor;
  const when = doneOn ? spokenWhen(doneOn, rc.sendOn) : "a while back";
  const quoteFamily = ["unanswered_quote", "archived_quote", "changes_requested", "declined_quote"].includes(o.type);
  const stale = quoteFamily && !!anchor && daysBetween(anchor, rc.sendOn) > (b.voice.staleQuoteDays ?? STALE_QUOTE_DAYS);
  const month = Number(rc.sendOn.slice(5, 7));
  const fit = svc ? seasonFit(svc, climate, month) : "now";
  // out-of-season work that would do harm (oaks in summer) never gets offered a near-term slot
  const holdForSeason = !!svc?.strictSeason && fit !== "now";
  // a timing line only goes out in the months it's true ("leaf-off months" is a winter line)
  const lineMonths = svc?.timingMonths?.[climate] ?? svc?.season[climate] ?? svc?.season.cold ?? [];
  const timingLine = svc?.timingLine?.[climate] && (!lineMonths.length || lineMonths.includes(month)) ? svc.timingLine[climate]! : "";
  const dueAsk = holdForSeason ? "" : svc?.dueAsk ?? "";
  const t: Record<string, string> = {
    first: greetingName(c.firstName),
    signer: b.signerName,
    company: b.name,
    ownerFirst: b.ownerFirstName,
    job: o.jobPhrase,
    when,
    priceClause: b.voice.mentionPrice && o.value > 0 && !stale && ["unanswered_quote", "archived_quote", "changes_requested"].includes(o.type) ? ` (${fmtMoney(o.value)})` : "",
    neverFollowed: rc.contactedBefore ? "" : "yes",
    freshLook: stale ? "If you still need it, we'd come take a fresh look first, since a fair bit has changed since then." : "",
    street: c.address?.street ?? "",
    streetName: streetName(c.address?.street),
    city: c.address?.city ?? "",
    crewLine: holdForSeason ? "" : crewLine(rc.ds, c, rc.sendOn) ?? "",
    worse: lowerFirst(svc?.worseIfWaiting ?? ""),
    timingLine,
    inSeason: fit === "now" ? "yes" : "",
    seasonMonth: svc && fit !== "now" ? MONTH_NAMES[(month - 1 + monthsUntilSeason(svc, climate, month)) % 12]! : "",
    nearTerm: holdForSeason ? "" : "yes",
    held: holdForSeason ? "yes" : "",
    waitLine: holdForSeason ? svc?.waitLine ?? "" : "",
    // only where the owner doesn't charge to come out (never HVAC, septic or pest by default)
    freeLook: (b.voice.freeLook ?? playbook(b.trade).freeLook) ? " No charge to look." : "",
    // seasonal work that just comes back around asks its own question instead of a rule of thumb
    interval: svc?.reserviceMonths && !dueAsk ? intervalWords(svc.reserviceMonths) : "",
    dueAsk,
    service: svc?.label.toLowerCase() ?? "",
    years: doneOn ? humanAge(daysBetween(doneOn, rc.sendOn)) : "",
    phoneLine: b.businessPhone ? fmtPhone(b.businessPhone) : "",
    // "split it into two visits" only makes sense on a big job
    bigJob: b.voice.offerOptions && o.value >= Math.max(1500, playbookTicket(b) * 1.5) ? "yes" : "",
    number: "",
    balance: "",
    mainJob: "",
    option: "",
    why: "",
  };
  // "we used to take care of the pines for you" is false once the pines are gone: name the service instead
  if (o.type === "lapsed_regular" && svc && svc.kind !== "maintenance" && svc.kind !== "recurring") t.job = svc.phrase;
  if (o.type === "declined_option") {
    const q = quoteById(rc.ds, o.source.id);
    t.mainJob = q ? jobPhrase(q.title, b.trade, q.lineItems.filter((l) => !l.optional)) : "the job";
    const name = o.evidence.find((e) => e.startsWith("Option not picked:"))?.replace(/^Option not picked: /, "").replace(/ — .*$/, "");
    // "Install risers & lids" is a line item; a person says "the risers & lids"
    t.option = name ? lowerFirst(name).replace(/^(install|add|replace|upgrade to|upgrade|put in|new)\s+(the\s+)?/i, "the ") : "the add-on";
  }
  if (o.type === "missed_upsell") {
    const next = svc;
    t.option = next?.phrase ?? "the next step";
    const src = o.source.kind === "job" ? rc.ds.jobs.find((j) => j.id === o.source.id) : undefined;
    const title = src?.title ?? rc.ds.invoices.find((i) => i.id === o.source.id)?.subject;
    t.mainJob = title ? jobPhrase(title, b.trade) : "the work";
    // the homeowner's sentence for it, never the owner-facing reason
    const did = title ? classifyService(title, src?.lineItems ?? [], [b.trade, ...b.otherTrades]).service : undefined;
    t.why = did?.followOns?.find((f) => f.serviceId === o.serviceId)?.pitch ?? "";
  }
  if (o.type === "unpaid_invoice") {
    const inv = rc.ds.invoices.find((x) => x.id === o.source.id);
    t.number = inv?.number ? `#${inv.number}` : "";
    t.balance = fmtMoney(o.value);
  }
  return t;
}

function playbookTicket(b: BusinessProfile): number {
  return b.avgJobValue ?? playbook(b.trade).ticket.typical;
}

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** Mechanical cleanup: "Co.." -> "Co.", "Raj, We've" -> "Raj, we've", "José, Oaks" -> "José, oaks". */
function tidy(s: string): string {
  return s
    .replace(/([^.])\.\.(?!\.)/g, "$1.")
    .replace(/^(\p{Lu}[\p{L}'-]*), (\p{Lu})(?=\p{Ll})/u, (_m, name: string, c: string) => `${name}, ${c.toLowerCase()}`)
    .replace(/\bback back in\b/g, "back in")
    .replace(/ +\n/g, "\n");
}

/**
 * No first name to use: a follow-up never opens "there, …" or ends ", there." — the sentence is
 * rewritten without it ("there, checking back" -> "Checking back").
 */
function withoutThere(s: string): string {
  return s.replace(/^there, (\S)/, (_m, c: string) => c.toUpperCase()).replace(/, there([.?])/g, "$1");
}

function fill(text: string, t: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => t[k] ?? `{${k}}`);
}

function eligible(tpl: NoteTemplate, t: Record<string, string>): boolean {
  return (tpl.needs ?? []).every((k) => (t[k] ?? "").trim() !== "");
}

/**
 * Why they're getting this, stated honestly. A note about an old quote is commercial email under CAN-SPAM
 * (they never agreed to the job), so it says plainly that it's a sales follow-up. Invoices are transactional.
 */
export function whyLineFor(type: Opportunity["type"] | undefined): string {
  switch (type) {
    case "unpaid_invoice":
      return "";
    case "approved_unscheduled":
      return "You're getting this because you approved a quote from us.";
    case "one_and_done":
    case "lapsed_regular":
    case "service_due":
    case "missed_upsell":
      return "You're getting this sales note because we've worked for you before.";
    default:
      return "You're getting this sales follow-up because you asked us for a price.";
  }
}

export function footer(b: BusinessProfile, type?: Opportunity["type"]): string {
  const lines = [[b.name, b.mailingAddress].filter(Boolean).join(" · ")];
  const why = whyLineFor(type);
  if (why) lines.push(why);
  lines.push('Reply "stop" and you won\'t hear from us again.');
  return lines.join("\n");
}

function applySwaps(s: string, swaps: [string, string][]): string {
  let out = s;
  for (const [from, to] of swaps) {
    if (!from) continue;
    out = out.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), (m) => (m[0] === m[0]!.toUpperCase() ? capitalize(to) : to));
  }
  return out;
}

/**
 * Render note `step` of the sequence for this opportunity.
 * Picks the first angle whose facts are available (a crew line only if one is true, etc.).
 */
export function renderNote(o: Opportunity, c: Customer, rc: RenderContext, step: number): RenderedNote | undefined {
  const b = rc.ds.business;
  const seq = sequenceFor(o, alwaysOnFor(b));
  const plan = seq.steps.find((s) => s.step === step);
  if (!plan) return undefined;
  const t = tokens(o, c, b, rc);
  const chosen = chooseTemplate(seq, plan.angles, step, t, `${c.id}|${o.id}|${step}`);
  if (!chosen) return undefined;
  let subject: string;
  if (step > 1) {
    // a follow-up is a reply in note 1's thread: "Re: " + exactly what note 1 said
    const first = rc.threadSubject ?? renderNote(o, c, { ...rc, threadSubject: undefined }, 1)?.subject ?? subjectFrom(chosen, t, b);
    subject = `Re: ${first.replace(/^re:\s*/i, "")}`;
  } else subject = subjectFrom(chosen, t, b);
  let body = tidy(applySwaps(fill(chosen.body, t), b.voice.wordSwaps))
    .split("\n")
    .filter((line, i, arr) => !(line.trim() === "" && arr[i - 1]?.trim() === ""))
    .join("\n")
    .trim();
  if (t.first === "there") body = withoutThere(body);
  body = `${body}\n\n${footer(b, o.type)}`;
  return { subject, body, angle: chosen.angle, templateId: chosen.id, flags: lint(subject, body, { firstName: t.first!, job: t.job!, step, commercial: o.type !== "unpaid_invoice", requireJob: step === 1 && ["quote", "fresh", "changes", "approved", "request", "declined", "due"].includes(seq.family) }) };
}

/** Answers we send on the spot (new requests, hot replies) go 7:00–20:00 local; at night they wait for 7:00. */
export const ANSWER_HOURS = [7, 20] as const;

/** When an answer written at `now` may go: now, or the next 7:00 when it's night. */
export function answerTime(now: ISODateTime): ISODateTime {
  const hour = Number(now.slice(11, 13));
  if (hour >= ANSWER_HOURS[0] && hour < ANSWER_HOURS[1]) return now.slice(0, 19);
  const day = hour < ANSWER_HOURS[0] ? now.slice(0, 10) : addDays(now.slice(0, 10), 1);
  return `${day}T${String(ANSWER_HOURS[0]).padStart(2, "0")}:00:00`;
}

/**
 * The promise as the owner reads it at `now`, when the answer (worded for `sendAt`) waits for the morning:
 * the homeowner's "today" at 7am is the owner's "tomorrow" tonight.
 */
export function promiseTonight(promise: string, now: ISODateTime, sendAt: ISODateTime): string {
  return sendAt.slice(0, 10) > now.slice(0, 10) ? promise.replace(/ today$/, " tomorrow") : promise;
}

/** The first angle whose facts are available wins; within it, the same person always gets the same variant. */
function chooseTemplate(seq: { family: string }, angles: MessageAngle[], step: number, t: Record<string, string>, key: string): NoteTemplate | undefined {
  for (const angle of angles) {
    for (const k of templateKey(seq.family, angle, step)) {
      const options = (TEMPLATES[k] ?? []).filter((tpl) => eligible(tpl, t));
      if (options.length) return pickBy(options, key);
    }
  }
  return undefined;
}

function subjectFrom(tpl: NoteTemplate, t: Record<string, string>, b: BusinessProfile): string {
  let subject = tidy(applySwaps(fill(tpl.subject, t), b.voice.wordSwaps)).replace(/\s+/g, " ").trim();
  // long job names ("the aluminum fence around the pool") make long subjects; fall back to just the job
  if (subject.length > 60) subject = `${/^re:/i.test(subject) ? "Re: " : ""}${applySwaps(t.job!, b.voice.wordSwaps)}`;
  if (subject.length > 60) subject = subject.slice(0, 58).replace(/\s+\S*$/, "");
  return subject;
}

/** "Today" before 3pm, else the next weekday — a call-back window an owner can actually keep. */
export function callbackWhen(localNow: ISODateTime): string {
  const hour = Number(localNow.slice(11, 13));
  const today = localNow.slice(0, 10);
  const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  if (hour < 15 && ![0, 6].includes(dow(today))) return "today";
  let d = addDays(today, 1);
  while ([0, 6].includes(dow(d))) d = addDays(d, 1);
  return d === addDays(today, 1) ? "tomorrow" : `on ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dow(d)]}`;
}

/**
 * The answer to a brand-new request, sent within minutes (7am–8pm local). Homeowners ask several companies and
 * most hire whoever answers first; only about 1 in 5 pros answer within the hour. It promises a call-back
 * window only — never a price or a date.
 */
export function renderRequestAck(ds: Dataset, r: ServiceRequest, c: Customer, localNow: ISODateTime): { subject: string; body: string; promise: string; flags: string[] } {
  const b = ds.business;
  const job = jobPhrase(r.title || "", b.trade);
  const specific = job !== playbook(b.trade).workPhrase;
  const first = greetingName(c.firstName);
  const when = callbackWhen(localNow);
  const isOwner = b.signerName.trim().toLowerCase() === b.ownerFirstName.trim().toLowerCase();
  const who = isOwner ? "I'll give you a call" : `${b.ownerFirstName} will give you a call`;
  const lines = [
    `Hi ${first},`,
    ``,
    `Thanks for reaching out to ${b.name.replace(/\.$/, "")}${specific ? ` about ${job}` : ""}. ${who} ${when} to set up a time to take a look.`,
    ``,
    `If there's a better time or number to reach you, just reply here.`,
    ``,
    b.signerName,
  ];
  const body = `${tidy(lines.join("\n"))}\n\n${footer(b, "unquoted_request")}`;
  const subject = specific ? `Your request: ${job}` : `Your request to ${b.name.replace(/\.$/, "")}`;
  const flags = lint(subject.length > 60 ? "Your request" : subject, body, { firstName: first, job, requireJob: false, step: 1, commercial: true });
  return { subject: subject.length > 60 ? "Your request" : subject, body, promise: `you'll call them ${when}`, flags };
}
