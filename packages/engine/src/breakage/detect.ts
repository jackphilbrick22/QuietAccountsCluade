import type {
  BreakageType,
  Channel,
  Customer,
  Dataset,
  ISODate,
  Invoice,
  Job,
  Opportunity,
  Quote,
  ServiceRequest,
  SuppressionReason,
  TradeId,
} from "../model.ts";
import { cautionReasons, isBadCustomer, MARKETPLACE_SOURCE, medianByService, REFERRAL_SOURCE, type CautionContext } from "./caution.ts";
import { classifyService, climateOf, findService, jobPhrase, playbook, seasonFit, type ServiceDef } from "../trades/index.ts";
import {
  addMonths,
  clamp,
  daysBetween,
  fmtMoney,
  humanAge,
  intervalWords,
  sendableEmail,
  makeId,
  maxDate,
  monthName,
  monthOf,
  round2,
  spokenWhen,
  yearOf,
} from "../util.ts";
import { alwaysOnFor, ALWAYS_ON_MIN_DAYS, ADJUST, AGE_DECAY, CALL_OVER_AMOUNT, RECOVERY_PRIOR, TYPE_RANK, WINDOW } from "./assumptions.ts";
import { quoteById } from "../lookup.ts";

/** What we already know about outreach, from our own records. */
export interface ContactState {
  /** customerId -> last date we contacted them (any channel). */
  lastContacted?: Record<string, ISODate>;
  /** lowercase email -> why it can never be emailed again. */
  suppressedEmails?: Record<string, "unsubscribed" | "bounced" | "complained">;
  /** customerIds the owner told us to leave alone. */
  doNotContact?: string[];
  /** Days to wait before contacting someone again after a finished sequence. */
  cooldownDays?: number;
  /**
   * Detect unpaid invoices so the owner sees the cash to collect (default on). Detection only: invoices are
   * never a primary opportunity, so no reminder is ever sent — collecting for someone else is debt-collection
   * territory (FDCPA, state creditor rules) and stays off until reviewed.
   */
  includeInvoices?: boolean;
  /** Include commercial accounts in automated outreach. */
  includeCommercial?: boolean;
  /** Opportunity ids someone looked at and OK'd despite a caution flag. */
  cleared?: string[];
}

export interface ScanResult {
  opportunities: Opportunity[];
  /** One primary opportunity per reachable customer — what we'd actually work. */
  primary: Opportunity[];
  stats: ScanStats;
}

export interface ScanStats {
  customers: number;
  quotes: number;
  jobs: number;
  invoices: number;
  requests: number;
  /** Date range covered by the data. */
  from?: ISODate;
  to?: ISODate;
  suppressedBy: Partial<Record<SuppressionReason, number>>;
}

interface Ctx {
  ds: Dataset;
  asOf: ISODate;
  trades: TradeId[];
  climate: ReturnType<typeof climateOf>;
  month: number;
  byCustomer: Map<string, Customer>;
  quotesBy: Map<string, Quote[]>;
  jobsBy: Map<string, Job[]>;
  invoicesBy: Map<string, Invoice[]>;
  requestsBy: Map<string, ServiceRequest[]>;
  contact: ContactState;
  avgJob: number;
  caution: CautionContext;
  alwaysOn: boolean;
}

function bucket<T extends { customerId: string }>(arr: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) (m.get(x.customerId) ?? m.set(x.customerId, []).get(x.customerId)!).push(x);
  return m;
}

function jobDate(j: Job): ISODate | undefined {
  return j.completedOn ?? j.scheduledOn ?? j.createdOn;
}

function quoteDate(q: Quote): ISODate | undefined {
  return q.sentOn ?? q.createdOn ?? q.changesRequestedOn ?? q.approvedOn;
}

const OPEN_JOB = new Set(["unscheduled", "scheduled", "active", "late", "requires_invoicing", "on_hold"]);
const DONE_JOB = new Set(["completed", "archived", "requires_invoicing"]);

/** Typical (median) paid job, used when a record has no dollar value and to size the shop. */
export function averageJob(ds: Dataset): number {
  if (ds.business.avgJobValue) return ds.business.avgJobValue;
  const vals = ds.jobs.filter((j) => j.total > 0 && j.status !== "cancelled").map((j) => j.total);
  const inv = ds.invoices.filter((i) => i.total > 0 && i.status !== "void").map((i) => i.total);
  const pool = vals.length >= 5 ? vals : inv.length >= 5 ? inv : ds.quotes.filter((q) => q.total > 0).map((q) => q.total);
  if (pool.length >= 3) {
    const sorted = [...pool].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!; // median resists one $80k job
  }
  return playbook(ds.business.trade).ticket.typical;
}

export function scan(ds: Dataset, contact: ContactState = {}): ScanResult {
  const trades: TradeId[] = [ds.business.trade, ...ds.business.otherTrades];
  const ctx: Ctx = {
    ds,
    asOf: ds.asOf,
    trades,
    climate: climateOf(ds.business.state),
    month: monthOf(ds.asOf),
    byCustomer: new Map(ds.customers.map((c) => [c.id, c])),
    quotesBy: bucket(ds.quotes),
    jobsBy: bucket(ds.jobs),
    invoicesBy: bucket(ds.invoices),
    requestsBy: bucket(ds.requests),
    contact,
    avgJob: averageJob(ds),
    caution: { medianByService: new Map(), typicalJob: 0, callOver: 0 },
    alwaysOn: alwaysOnFor(ds.business),
  };
  ctx.caution = {
    medianByService: medianByService(ds.quotes, (q) => classifyService(q.title, q.lineItems, trades).service.id),
    typicalJob: ctx.avgJob,
    callOver: ds.business.callOverAmount ?? CALL_OVER_AMOUNT,
    // Jobber's "Approved" means no job yet; anyone else's "Won" can't be checked without a jobs file
    noJobsToCheck: !ds.jobs.length && ds.business.software !== "jobber",
  };

  const opps: Opportunity[] = [];
  for (const q of ds.quotes) {
    const o = fromQuote(ctx, q);
    if (o) opps.push(o);
    opps.push(...declinedOptions(ctx, q));
  }
  for (const r of ds.requests) {
    const o = fromRequest(ctx, r);
    if (o) opps.push(o);
  }
  for (const j of ds.jobs) {
    const o = unscheduledJob(ctx, j);
    if (o) opps.push(o);
  }
  for (const c of ds.customers) opps.push(...fromHistory(ctx, c));
  if (contact.includeInvoices !== false) for (const inv of ds.invoices) {
    const o = fromInvoice(ctx, inv);
    if (o) opps.push(o);
  }

  // Deduplicate: one opportunity per customer+service+type, keep the freshest.
  const dedup = new Map<string, Opportunity>();
  for (const o of opps) {
    const k = `${o.customerId}|${o.type}|${o.serviceId}`;
    const prev = dedup.get(k);
    if (!prev || o.ageDays < prev.ageDays) dedup.set(k, o);
  }
  // A dead quote superseded by a newer quote to the same person for the same service is not its own opportunity.
  const all = [...dedup.values()];
  for (const o of all) applySuppressions(ctx, o);
  for (const o of all) {
    if (o.suppressed || ctx.contact.cleared?.includes(o.id)) continue;
    const reasons = cautionReasons(o, ctx.byCustomer.get(o.customerId), o.source.kind === "quote" ? quoteById(ds, o.source.id) : undefined, ctx.caution);
    if (reasons.length) o.caution = reasons;
  }
  for (const o of all) score(ctx, o);

  all.sort((a, b) => b.score - a.score);
  const primary = pickPrimary(all);

  const suppressedBy: ScanStats["suppressedBy"] = {};
  for (const o of all) if (o.suppressed) suppressedBy[o.suppressed] = (suppressedBy[o.suppressed] ?? 0) + 1;
  const dates = [...ds.quotes.map(quoteDate), ...ds.jobs.map(jobDate), ...ds.invoices.map((i) => i.issuedOn)].filter((d): d is string => !!d && d <= ds.asOf).sort();
  return {
    opportunities: all,
    primary,
    stats: {
      customers: ds.customers.length,
      quotes: ds.quotes.length,
      jobs: ds.jobs.length,
      invoices: ds.invoices.length,
      requests: ds.requests.length,
      from: dates[0],
      to: dates[dates.length - 1],
      suppressedBy,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Detectors                                                           */
/* ------------------------------------------------------------------ */

function base(
  ctx: Ctx,
  type: BreakageType,
  customerId: string,
  source: Opportunity["source"],
  value: number,
  anchor: ISODate | undefined,
  title: string,
  lineItems: Quote["lineItems"],
  reason: string,
  evidence: string[],
  serviceOverride?: ServiceDef,
  maxDays?: number,
  minDaysOverride?: number,
): Opportunity | undefined {
  const w = WINDOW[type];
  const minDays = minDaysOverride ?? (ctx.alwaysOn ? (ALWAYS_ON_MIN_DAYS[type] ?? w.minDays) : w.minDays);
  const age = anchor ? daysBetween(anchor, ctx.asOf) : NaN;
  if (Number.isNaN(age)) {
    // no date: keep only types that don't depend on age, and mark them old-ish
  } else if (age < minDays || age > (maxDays ?? w.maxDays)) return undefined;
  const cls = serviceOverride ? { service: serviceOverride, trade: findService(serviceOverride.id)?.trade ?? ctx.ds.business.trade } : classifyService(title, lineItems, ctx.trades);
  return {
    id: makeId("op", type, source.kind, source.id, customerId),
    type,
    customerId,
    source,
    value: round2(value > 0 ? value : ctx.avgJob),
    expectedValue: 0,
    recoverProbability: 0,
    score: 0,
    ageDays: Number.isNaN(age) ? 400 : age,
    anchorDate: anchor,
    reason,
    evidence: value > 0 ? evidence : [...evidence, `No dollar amount on the record — valued at your typical job (${fmtMoney(ctx.avgJob)}).`],
    jobPhrase: serviceOverride ? serviceOverride.phrase : jobPhrase(title, cls.trade, lineItems),
    serviceId: cls.service.id,
    seasonFit: seasonFit(cls.service, ctx.climate, ctx.month),
    channels: [],
  };
}

function softwareName(ctx: Ctx): string {
  const s = ctx.ds.business.software;
  return (
    {
      jobber: "Jobber",
      housecall_pro: "Housecall Pro",
      servicetitan: "ServiceTitan",
      quickbooks: "QuickBooks",
      arborgold: "Arborgold",
      singleops: "SingleOps",
      yardbook: "Yardbook",
      lmn: "LMN",
      aspire: "Aspire",
      service_autopilot: "Service Autopilot",
      workiz: "Workiz",
      zenmaid: "ZenMaid",
      gorilladesk: "GorillaDesk",
      spreadsheet: "your spreadsheet",
      unknown: "your software",
    } as const
  )[s];
}

function fromQuote(ctx: Ctx, q: Quote): Opportunity | undefined {
  const d = quoteDate(q);
  const when = d ? spokenWhen(d, ctx.asOf) : "a while back";
  const money = q.total > 0 ? fmtMoney(q.total) : "";
  const ev = [`Quote${q.number ? ` #${q.number}` : ""}: “${q.title || "untitled"}”${money ? ` — ${money}` : ""}`, d ? `Sent ${when} (${humanAge(daysBetween(d, ctx.asOf))} ago)` : "No sent date on the record"];
  if (q.viewedOn) ev.push(`They opened it online ${spokenWhen(q.viewedOn, ctx.asOf)}`);
  if (q.rawStatus) ev.push(`Status in ${softwareName(ctx)}: ${q.rawStatus}`);
  switch (q.status) {
    case "awaiting_response":
    case "unknown": {
      if (q.status === "unknown" && !q.sentOn && !q.createdOn) return undefined;
      return base(ctx, "unanswered_quote", q.customerId, { kind: "quote", id: q.id }, q.total, d, q.title, q.lineItems,
        `Got a price ${when}. No yes, no no — it's still sitting open.`, ev);
    }
    case "archived":
    case "expired":
    case "declined": {
      const type = q.status === "declined" ? "declined_quote" : "archived_quote";
      // Dated by the quote itself, not the day it was filed away: a 2023 quote archived in an August cleanup is
      // still "back in November 2023" to the homeowner, the age limits and the fresh-look line count from then, and
      // anyone who bought since the price went out has come back. The close-out day only sets a minimum wait, so a
      // quote closed out last week isn't chased this week.
      if (q.archivedOn) {
        if (daysBetween(q.archivedOn, ctx.asOf) < WINDOW[type].minDays) return undefined;
        ev.push(`${type === "declined_quote" ? "Marked declined" : "Filed away"} ${spokenWhen(q.archivedOn, ctx.asOf)}`);
      }
      return type === "declined_quote"
        ? base(ctx, type, q.customerId, { kind: "quote", id: q.id }, q.total, d ?? q.archivedOn, q.title, q.lineItems,
            `Said no ${when}. Plans change — worth one respectful check-in.`, ev)
        : base(ctx, type, q.customerId, { kind: "quote", id: q.id }, q.total, d ?? q.archivedOn, q.title, q.lineItems,
            `Quote from ${when} was filed away without a yes. Nobody ever followed up.`, ev);
    }
    case "changes_requested": {
      const asked = q.changesRequestedOn ?? d;
      // re-quoted since? then it's handled
      const newer = (ctx.quotesBy.get(q.customerId) ?? []).some((x) => x.id !== q.id && (quoteDate(x) ?? "") > (asked ?? ""));
      if (newer) return undefined;
      return base(ctx, "changes_requested", q.customerId, { kind: "quote", id: q.id }, q.total, asked, q.title, q.lineItems,
        `Asked for changes ${asked ? spokenWhen(asked, ctx.asOf) : "on this quote"} and never got a revised quote.`, ev);
    }
    case "approved": {
      if (q.jobIds.length) return undefined;
      const said = q.approvedOn ?? d;
      return base(ctx, "approved_unscheduled", q.customerId, { kind: "quote", id: q.id }, q.total, said, q.title, q.lineItems,
        `Said yes ${said ? spokenWhen(said, ctx.asOf) : ""} — and never got on the schedule.`.replace(/\s+—/, " —"), [...ev, "Approved, but there's no job for it"]);
    }
    default:
      return undefined;
  }
}

function declinedOptions(ctx: Ctx, q: Quote): Opportunity[] {
  if (q.status !== "converted" && q.status !== "approved") return [];
  const passed = q.lineItems.filter((l) => l.optional && l.selected === false && l.total > 0);
  if (!passed.length) return [];
  const anchor = q.convertedOn ?? q.approvedOn ?? quoteDate(q);
  const value = passed.reduce((s, l) => s + l.total, 0);
  const names = passed.map((l) => l.name).join(", ");
  const o = base(ctx, "declined_option", q.customerId, { kind: "quote", id: q.id }, value, anchor, names, passed,
    `Took the main job ${anchor ? spokenWhen(anchor, ctx.asOf) : ""} but passed on ${names}.`,
    [`Quote${q.number ? ` #${q.number}` : ""}: “${q.title}”`, ...passed.map((l) => `Option not picked: ${l.name} — ${fmtMoney(l.total)}`)]);
  return o ? [o] : [];
}

function fromRequest(ctx: Ctx, r: ServiceRequest): Opportunity | undefined {
  // Jobber auto-archives requests that never got a quote — the person still asked for a price.
  if (r.quoteId || r.status === "converted") return undefined;
  const d = r.assessmentOn ?? r.createdOn;
  // a quote for this customer created after the request covers it
  const quoted = (ctx.quotesBy.get(r.customerId) ?? []).some((q) => (quoteDate(q) ?? "") >= (r.createdOn ?? "9999"));
  if (quoted) return undefined;
  return base(ctx, "unquoted_request", r.customerId, { kind: "request", id: r.id }, 0, d, r.title, [],
    `Asked for a quote ${d ? spokenWhen(d, ctx.asOf) : ""} and never got one.`,
    [`Request: “${r.title || "no details"}”`, r.createdOn ? `Came in ${spokenWhen(r.createdOn, ctx.asOf)}` : "", r.source ? `Source: ${r.source}` : ""].filter(Boolean));
}

function unscheduledJob(ctx: Ctx, j: Job): Opportunity | undefined {
  if (j.status !== "unscheduled") return undefined;
  if (j.quoteId) {
    const q = quoteById(ctx.ds, j.quoteId);
    if (q && q.status === "approved" && !q.jobIds.length) return undefined; // counted on the quote
  }
  const d = j.createdOn;
  return base(ctx, "approved_unscheduled", j.customerId, { kind: "job", id: j.id }, j.total, d, j.title, j.lineItems,
    `Job created ${d ? spokenWhen(d, ctx.asOf) : ""} but it's still sitting unscheduled.`,
    [`Job${j.number ? ` #${j.number}` : ""}: “${j.title}”${j.total ? ` — ${fmtMoney(j.total)}` : ""}`, "Status: unscheduled"]);
}

function fromInvoice(ctx: Ctx, inv: Invoice): Opportunity | undefined {
  if (!(inv.status === "awaiting_payment" || inv.status === "past_due")) return undefined;
  if (inv.balance <= 0) return undefined;
  const due = inv.dueOn ?? (inv.issuedOn ? addDaysISO(inv.issuedOn, 30) : undefined);
  if (!due || due >= ctx.asOf) return undefined;
  return base(ctx, "unpaid_invoice", inv.customerId, { kind: "invoice", id: inv.id }, inv.balance, due, inv.subject, [],
    `Invoice${inv.number ? ` #${inv.number}` : ""} for ${fmtMoney(inv.balance)} has been open since ${spokenWhen(due, ctx.asOf).replace(/^back in /, "")}.`,
    [`Invoice${inv.number ? ` #${inv.number}` : ""}: ${fmtMoney(inv.total)} total, ${fmtMoney(inv.balance)} still owed`, `Due ${due}`]);
}

function addDaysISO(d: ISODate, n: number): ISODate {
  const t = new Date(Date.parse(d + "T00:00:00Z") + n * 86400000);
  return t.toISOString().slice(0, 10);
}

/** Invoices that show we did the work: sent or paid, never a draft or a void. */
const BILLED = new Set<Invoice["status"]>(["paid", "awaiting_payment", "past_due"]);

/** The usual gap between visits, and whether it's a regular schedule: marked recurring, or 3+ visits usually no more than four months apart. */
function rhythmOf(work: { date: ISODate; recurring?: boolean }[]): { median: number; recurring: boolean } {
  const gaps: number[] = [];
  for (let i = 1; i < work.length; i++) gaps.push(daysBetween(work[i - 1]!.date, work[i]!.date));
  const sorted = gaps.filter((g) => g > 0).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return { median, recurring: work.some((w) => w.recurring) || (median > 0 && median <= 120 && work.length >= 3) };
}

/** Past-customer plays: one-and-done, lapsed regulars, service due, missed upsells. */
function fromHistory(ctx: Ctx, c: Customer): Opportunity[] {
  const jobs = (ctx.jobsBy.get(c.id) ?? [])
    .filter((j) => DONE_JOB.has(j.status) || (j.status === "unknown" && jobDate(j)))
    .filter((j) => jobDate(j))
    .sort((a, b) => (jobDate(a)! < jobDate(b)! ? -1 : 1));
  // Invoices are proof of work when there's no jobs file. For a customer who pays us, every invoice issued counts,
  // not only the paid ones: a weekly client billed on net terms was there last week though that invoice is still
  // open. Someone who has never paid is not a past customer to win back or pitch.
  const billed = (ctx.invoicesBy.get(c.id) ?? []).filter((i) => BILLED.has(i.status) && (i.issuedOn ?? i.paidOn));
  const paying = billed.some((i) => i.status === "paid") ? billed : [];
  const work: { date: ISODate; title: string; total: number; id: string; kind: "job" | "invoice"; recurring?: boolean; lineItems: Job["lineItems"] }[] = jobs.length
    ? jobs.map((j) => ({ date: jobDate(j)!, title: j.title, total: j.total, id: j.id, kind: "job" as const, recurring: j.recurring, lineItems: j.lineItems }))
    : paying
        .map((i) => ({ date: (i.issuedOn ?? i.paidOn)!, title: i.subject, total: i.total, id: i.id, kind: "invoice" as const, lineItems: [] }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!work.length) return [];

  const out: Opportunity[] = [];
  const last = work[work.length - 1]!;
  // gone quiet is measured from the latest sign we were there: the last visit, or an invoice issued after it
  const lastBilled = billed.reduce<ISODate | undefined>((m, i) => (i.issuedOn && i.issuedOn <= ctx.asOf && (!m || i.issuedOn > m) ? i.issuedOn : m), undefined);
  const sinceLast = daysBetween(lastBilled && lastBilled > last.date ? lastBilled : last.date, ctx.asOf);
  const evWork = (w: (typeof work)[number]) => `${w.kind === "job" ? "Job" : "Invoice"}: “${w.title || "work"}” — ${w.total ? fmtMoney(w.total) : "no amount"}, ${spokenWhen(w.date, ctx.asOf)}`;
  const svcOf = new Map(work.map((w) => [w, classifyService(w.title, w.lineItems, ctx.trades).service]));

  // Service due: the last time each clock-based service was done.
  const seenServices = new Map<string, (typeof work)[number]>();
  for (const w of work) seenServices.set(svcOf.get(w)!.id, w);
  let dueFound = false;
  // Seasonal work between seasons: not due yet, or due and waiting for its selling season to come back around.
  const betweenSeasons = new Set<string>();
  for (const [sid, w] of seenServices) {
    const svc = findService(sid)?.service;
    if (!svc?.reserviceMonths || svc.kind === "recurring") continue;
    const dueOn = dueDate(svc, w.date);
    const until = daysBetween(ctx.asOf, dueOn); // negative = overdue
    const overdueDays = -until;
    if (overdueDays > svc.reserviceMonths * 30 * 2) continue;
    // Work that comes back each season ("Want the lights up again this year?") is only asked about in its selling
    // season: past it, the note waits for the next one rather than going out in January. Until then they're between
    // seasons, not gone, so no lapsed-regular or past-customer note goes out in its place.
    if (svc.dueMonth && (until > 45 || seasonFit(svc, ctx.climate, ctx.month) !== "now")) {
      betweenSeasons.add(svc.id);
      continue;
    }
    if (until > 45) continue;
    const o = base(ctx, "service_due", c.id, { kind: w.kind, id: w.id }, w.total, dueOn < ctx.asOf ? dueOn : ctx.asOf, w.title, w.lineItems,
      `Last ${svc.label.toLowerCase()} was ${spokenWhen(w.date, ctx.asOf)}. That's ${until <= 0 ? "due now" : svc.dueMonth ? `due in ${monthName(dueOn)}` : "due next month"} — ${intervalWords(svc.reserviceMonths).toLowerCase()} is the rule of thumb.`,
      [evWork(w), `Due ${monthName(dueOn)} ${dueOn.slice(0, 4)}`], svc);
    if (o) {
      o.lastDoneOn = w.date;
      out.push(o);
      dueFound = true;
    }
  }

  // The routine they're on, if any: the recurring or maintenance service they've had most.
  const routineCount = new Map<string, { svc: ServiceDef; n: number; last: (typeof work)[number] }>();
  for (const w of work) {
    const service = svcOf.get(w)!;
    if (service.kind !== "recurring" && service.kind !== "maintenance") continue;
    const r = routineCount.get(service.id) ?? { svc: service, n: 0, last: w };
    r.n++;
    r.last = w;
    routineCount.set(service.id, r);
  }
  const routine = [...routineCount.values()].sort((a, b) => b.n - a.n || (a.last.date < b.last.date ? 1 : -1))[0];
  // Work on a calendar clock (holiday lights, due each October) keeps time by that work alone: the January takedown
  // rides on the install, so an install and its takedown are one season, not a visit every two months.
  const beat = routine?.svc.dueMonth ? work.filter((w) => svcOf.get(w)!.id === routine.svc.id) : work;
  const pace = rhythmOf(beat);
  // Already on a regular schedule, so "Want it on a regular schedule?" doesn't fit: this job was part of one, they've
  // had us back since (or have a visit coming), or they were on one when they booked it: a visit marked recurring or
  // called that ("Weekly clean"), or a steady rhythm, with their visit before it inside the time a regular goes quiet.
  const onSchedule = (w: (typeof work)[number], next: ServiceDef, trade: TradeId): boolean => {
    if (w.recurring || work.some((x) => x.date > w.date)) return true;
    const steady = pace.recurring || work.some((x) => x.recurring || next.match.test(x.title));
    const before = work.filter((x) => x !== w && x.date <= w.date).pop();
    return steady && !!before && daysBetween(before.date, w.date) < lapseAfter(trade, pace.median).days;
  };

  // Missed upsells: the natural next job, never quoted or done.
  for (const w of work) {
    const service = svcOf.get(w)!;
    for (const f of service.followOns ?? []) {
      const age = daysBetween(w.date, ctx.asOf);
      if (age < f.afterDays[0] || age > f.afterDays[1] + 180) continue;
      const found = findService(f.serviceId);
      if (!found) continue;
      const next = found.service;
      // what a job or quote covers; some follow-ons go by what the record is (its title or first line), not any line on it
      const covers = (title: string, items: Job["lineItems"]) =>
        f.byPrimaryLine ? classifyService(title, items, ctx.trades).service.id === next.id : next.match.test(title) || items.some((l) => next.match.test(l.name));
      const already =
        work.some((x) => x.date >= w.date && (f.byPrimaryLine ? covers(x.title, x.lineItems) : next.match.test(x.title))) ||
        (next.kind === "recurring" && onSchedule(w, next, found.trade)) ||
        (ctx.quotesBy.get(c.id) ?? []).some((q) => covers(q.title, q.lineItems));
      // the original job itself may have included the follow-on ("removal + stump")
      if (already || covers(w.title, w.lineItems)) continue;
      const typical = Math.max(playbook(findService(f.serviceId)!.trade).ticket.low, Math.round(ctx.avgJob * 0.35));
      // a follow-on that comes up years later (a wood deck's stain) keeps its own window past the usual cap
      const late = f.afterDays[1] > WINDOW.missed_upsell.maxDays ? f.afterDays[1] + 180 : undefined;
      const o = base(ctx, "missed_upsell", c.id, { kind: w.kind, id: w.id }, typical, w.date, next.label, [],
        `Did ${service.phrase.replace(/^the /, "the ")} ${spokenWhen(w.date, ctx.asOf)}. ${capitalize(next.phrase)} was never offered — ${f.why}.`,
        [evWork(w), `No quote or job for ${next.label.toLowerCase()} on file`], next, late);
      // two follow-ons from one job (risers and a filter) are two opportunities, not one id
      if (o && out.some((x) => x.id === o.id)) o.id = makeId("op", "missed_upsell", w.kind, w.id, c.id, next.id);
      if (o) out.push(o);
    }
  }

  // Lapsed regulars: a real routine that stopped. Two unrelated one-off jobs are not a routine.
  let regular = false;
  if (beat.length >= 2) {
    const { median, recurring } = pace;
    regular = recurring || (routine?.n ?? 0) >= 2;
    const expected = recurring ? Math.max(median, 7) : median;
    // a cleaning client every other week is gone at three weeks, not two months: the trade says when
    const lapse = lapseAfter(routine ? (findService(routine.svc.id)?.trade ?? ctx.ds.business.trade) : ctx.ds.business.trade, expected);
    // a routine that comes back each season and is between seasons hasn't stopped
    const waiting = !!routine && betweenSeasons.has(routine.svc.id);
    if (regular && expected > 0 && sinceLast >= lapse.days && !dueFound && !waiting) {
      const perYear = Math.min(52, Math.max(1, Math.round(365 / Math.max(expected, 7))));
      const avg = beat.reduce((s, w) => s + w.total, 0) / beat.length;
      const annual = recurring ? avg * perYear : avg;
      // the note is about the routine ("the mowing"), and "the last time" is the last time it was done
      const w = routine?.last ?? last;
      const o = base(ctx, "lapsed_regular", c.id, { kind: w.kind, id: w.id }, annual, w.date, w.title, w.lineItems,
        `Used you ${beat.length} times${recurring ? ` (about every ${humanAge(expected).replace(/^a /, "")})` : ""}. Last visit ${spokenWhen(last.date, ctx.asOf)} — then nothing.`,
        [evWork(last), `${beat.length} visits on file`, recurring ? `Worth about ${fmtMoney(annual)} a year as a regular` : `Average visit ${fmtMoney(avg)}`], routine?.svc,
        undefined, lapse.byTrade ? lapse.days : undefined);
      if (o) out.push(o);
    }
  }

  // One and done — or a few one-off jobs with no routine: the same "past customer" note fits both. Someone whose
  // seasonal work is between seasons hasn't "never come back": the season's note is theirs when it comes.
  if (!regular && !dueFound && !betweenSeasons.size) {
    const pb = playbook(ctx.ds.business.trade);
    const o = base(ctx, "one_and_done", c.id, { kind: last.kind, id: last.id }, Math.max(last.total * 0.6, pb.ticket.low), last.date, last.title, last.lineItems,
      work.length === 1 ? `Hired you once, ${spokenWhen(last.date, ctx.asOf)}, and never came back.` : `Hired you ${work.length} times for one-off jobs, last ${spokenWhen(last.date, ctx.asOf)}, and hasn't been back.`,
      work.length === 1 ? [evWork(last)] : [evWork(last), `${work.length} jobs on file, no routine service`]);
    if (o) out.push(o);
  }
  return out;
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/**
 * How many days after the last visit a regular counts as gone quiet, given their usual gap between visits. The trade
 * sets its own rows (cleaning: every week or two -> 21 days, about monthly -> 45); otherwise it's 1¾ times the usual
 * gap or the gap plus 45 days, whichever is later. A trade row never lands less than a week past the usual gap.
 */
export function lapseAfter(trade: TradeId, usualGap: number): { days: number; byTrade: boolean } {
  const row = playbook(trade).lapseAfterDays?.find(([upTo]) => usualGap <= upTo);
  if (row) return { days: Math.max(row[1], Math.ceil(usualGap) + 7), byTrade: true };
  return { days: Math.floor(Math.max(usualGap * 1.75, usualGap + 45)) + 1, byTrade: false };
}

/**
 * When clock-based work comes due again. Seasonal work comes due when its season opens, at least half a cycle
 * after the last visit: lights hung in November or taken down in January are both due the next October.
 */
export function dueDate(svc: ServiceDef, done: ISODate): ISODate {
  const months = svc.reserviceMonths ?? 12;
  if (!svc.dueMonth) return addMonths(done, months);
  const from = addMonths(done, Math.ceil(months / 2));
  const opens = `${yearOf(from)}-${String(svc.dueMonth).padStart(2, "0")}-01`;
  return opens >= from ? opens : `${yearOf(from) + 1}${opens.slice(4)}`;
}

/* ------------------------------------------------------------------ */
/* Suppression, scoring, primary pick                                  */
/* ------------------------------------------------------------------ */

function channelsFor(ctx: Ctx, c: Customer): Channel[] {
  const ch: Channel[] = [];
  const email = sendableEmail(c.emails, ctx.contact.suppressedEmails);
  if (email) ch.push("email");
  if (c.address?.street && c.address.zip) ch.push("postcard");
  if (c.phones.length && c.smsConsent) ch.push("sms");
  if (c.phones.length) ch.push("call_task");
  return ch;
}

function applySuppressions(ctx: Ctx, o: Opportunity): void {
  const c = ctx.byCustomer.get(o.customerId);
  if (!c) {
    o.suppressed = "no_contact_info";
    return;
  }
  o.channels = channelsFor(ctx, c);
  const email0 = c.emails[0];
  const sup = email0 ? ctx.contact.suppressedEmails?.[email0] : undefined;
  if (c.doNotContact || ctx.contact.doNotContact?.includes(c.id) || isBadCustomer(c)) o.suppressed = "do_not_contact";
  else if (sup === "complained") o.suppressed = "complained";
  else if (sup === "unsubscribed") o.suppressed = "unsubscribed";
  else if (!o.channels.some((x) => x === "email" || x === "postcard" || x === "sms")) o.suppressed = sup === "bounced" ? "bounced" : "no_contact_info";
  else if (c.isCommercial && !ctx.contact.includeCommercial && o.type !== "unpaid_invoice") o.suppressed = "commercial";
  if (o.suppressed) return;

  const anchor = o.anchorDate ?? "0000-00-00";
  const jobs = ctx.jobsBy.get(c.id) ?? [];
  const quotes = ctx.quotesBy.get(c.id) ?? [];

  // Open work right now: don't step on a live job or a quote the salesperson is still working.
  const openJob = jobs.some((j) => OPEN_JOB.has(j.status) && j.status !== "requires_invoicing" && !(o.source.kind === "job" && o.source.id === j.id));
  const freshQuote = quotes.some((q) => {
    const d = quoteDate(q);
    // always-on: we ARE the follow-up from day 2; otherwise leave the salesperson their window
    const window = ctx.alwaysOn ? Math.min(ctx.ds.business.minQuoteAgeDays, ALWAYS_ON_MIN_DAYS.unanswered_quote ?? 2) : ctx.ds.business.minQuoteAgeDays;
    return d && (q.status === "awaiting_response" || q.status === "draft" || q.status === "changes_requested") && daysBetween(d, ctx.asOf) < window;
  });
  if (o.type !== "unpaid_invoice" && (openJob || freshQuote)) {
    o.suppressed = "active_work";
    return;
  }

  // They came back on their own after this opportunity's anchor date: a job, a bill for work (an owner who invoiced
  // instead of converting the quote), or a yes on another quote, dated by the yes. A yes on another option sent the
  // same day for the same work (good/better/best, option A or B) answers this one too.
  if (!["unpaid_invoice", "service_due", "missed_upsell", "lapsed_regular", "one_and_done", "declined_option"].includes(o.type)) {
    const self = o.source.kind === "quote" ? quotes.find((q) => q.id === o.source.id) : undefined;
    const sameWork = (q: Quote) => {
      if (!self) return false;
      const a = classifyService(self.title, self.lineItems, ctx.trades);
      const b = classifyService(q.title, q.lineItems, ctx.trades);
      return a.matched && b.matched && a.service.id === b.service.id;
    };
    const cameBack = jobs.some((j) => {
      const d = jobDate(j);
      return d && d > anchor && j.status !== "cancelled" && !(o.source.kind === "job" && o.source.id === j.id);
    }) || (ctx.invoicesBy.get(c.id) ?? []).some((i) => BILLED.has(i.status) && (i.issuedOn ?? i.paidOn ?? "") > anchor)
      || quotes.some((q) => {
        if (q.id === o.source.id || (q.status !== "converted" && q.status !== "approved")) return false;
        const yes = q.approvedOn ?? q.convertedOn ?? quoteDate(q) ?? "";
        return yes > anchor || (!!self && quoteDate(q) === quoteDate(self) && sameWork(q));
      });
    if (cameBack) {
      o.suppressed = "already_customer_again";
      return;
    }
  }

  const ageOk = o.ageDays <= ctx.ds.business.maxQuoteAgeMonths * 30.44 || !["unanswered_quote", "archived_quote", "declined_quote"].includes(o.type);
  if (!ageOk) {
    o.suppressed = "too_old";
    return;
  }
  if (["unanswered_quote", "archived_quote", "declined_quote", "changes_requested"].includes(o.type) && o.value > 0 && o.value < ctx.ds.business.minQuoteValue) {
    o.suppressed = "below_minimum";
    return;
  }
  if (o.type === "declined_option") {
    const svc = findService(o.serviceId)?.service;
    const boughtLater = svc && jobs.some((j) => (jobDate(j) ?? "") > anchor && (svc.match.test(j.title) || j.lineItems.some((l) => svc.match.test(l.name))));
    if (boughtLater) {
      o.suppressed = "already_customer_again";
      return;
    }
  }
  const last = ctx.contact.lastContacted?.[c.id];
  if (last && daysBetween(last, ctx.asOf) < (ctx.contact.cooldownDays ?? 120)) o.suppressed = "recently_contacted";
}

function ageMultiplier(age: number): number {
  for (const [max, m] of AGE_DECAY) if (age <= max) return m;
  return 0.35;
}

function score(ctx: Ctx, o: Opportunity): void {
  const svc = findService(o.serviceId)?.service;
  let p = RECOVERY_PRIOR[o.type];
  if (["unanswered_quote", "archived_quote", "declined_quote", "changes_requested", "unquoted_request", "declined_option"].includes(o.type)) p *= ageMultiplier(o.ageDays);
  if (svc?.kind === "hazard") p *= ADJUST.hazard;
  else if (svc?.kind === "repair") p *= ADJUST.repair;
  if (o.type !== "unpaid_invoice") p *= o.seasonFit === "now" ? ADJUST.seasonNow : o.seasonFit === "soon" ? ADJUST.seasonSoon : ADJUST.seasonOff;
  const paidBefore = (ctx.jobsBy.get(o.customerId) ?? []).some((j) => DONE_JOB.has(j.status)) || (ctx.invoicesBy.get(o.customerId) ?? []).some((i) => i.status === "paid");
  if (paidBefore && ["unanswered_quote", "archived_quote", "changes_requested", "unquoted_request"].includes(o.type)) p *= ADJUST.pastCustomer;
  if (o.source.kind === "quote" && quoteById(ctx.ds, o.source.id)?.viewedOn) p *= ADJUST.viewed;
  const src = ctx.byCustomer.get(o.customerId)?.leadSource;
  if (src && REFERRAL_SOURCE.test(src)) p *= ADJUST.referral;
  else if (src && MARKETPLACE_SOURCE.test(src)) p *= ADJUST.marketplace;
  // Big quotes are the shopped ones (3+ bids, financing, price shock) and are the hardest to win back.
  // "Big" is relative to this shop's own typical job, not a national number.
  if (o.value > Math.max(ctx.avgJob * 4, 2500)) p *= ADJUST.bigTicket;
  if (!o.channels.includes("email") && o.channels.includes("postcard")) p *= ADJUST.postcardOnly;
  p = clamp(p, 0.003, 0.65);
  o.recoverProbability = round2(p * 1000) / 1000;
  o.expectedValue = round2(o.value * p);

  // Priority: expected dollars, then warmth, then freshness and season.
  const ev = Math.log10(Math.max(10, o.expectedValue)) / Math.log10(5000); // ~1.0 at $5k expected
  const warmth = 1 - (TYPE_RANK[o.type] - 1) / 12;
  const fresh = 1 - Math.min(1, o.ageDays / 1095);
  const season = o.seasonFit === "now" ? 1 : o.seasonFit === "soon" ? 0.6 : 0.2;
  o.score = Math.round(clamp(ev * 45 + warmth * 25 + fresh * 15 + season * 15, 0, 100));
}

function pickPrimary(all: Opportunity[]): Opportunity[] {
  const best = new Map<string, Opportunity>();
  for (const o of all) {
    if (o.suppressed || o.type === "unpaid_invoice") continue;
    const prev = best.get(o.customerId);
    if (!prev || TYPE_RANK[o.type] < TYPE_RANK[prev.type] || (TYPE_RANK[o.type] === TYPE_RANK[prev.type] && o.score > prev.score)) best.set(o.customerId, o);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}
