import {
  addMonths,
  emptyDataset,
  footer,
  ingestFile,
  planOutreach,
  playbook,
  readTrade,
  scan,
  SEASONAL_TRADES,
  paidTogether,
  stoppedCustomers,
  summarize,
  type BreakageType,
  type BusinessProfile,
  type CallList,
  type Dataset,
  type ISODate,
  type TradeId,
} from "@qa/engine";

/**
 * The audit, run entirely in the visitor's browser: read their export, find every quote that never got a yes or a no
 * and every past customer who stopped booking, and write the first note to the likeliest of each. The file only leaves
 * the browser when the owner presses send. Every number comes from their file; nothing here is an industry average.
 */
export interface AuditFile {
  name: string;
  text: string;
}

export interface AuditResult {
  trade: TradeId;
  tradeLabel: string;
  company: string;
  quotes: number;
  customers: number;
  from?: string;
  to?: string;
  won: { count: number; value: number };
  saidNo: { count: number; value: number };
  /** Every quote that never got a yes or a no, all time, sent at least 14 days ago. The dollar figure "sitting quiet". */
  silent: { count: number; value: number };
  /** Quotes sent in the last 14 days: still fresh, not counted anywhere else. */
  fresh: { count: number; value: number };
  /**
   * The quiet rate, the same number the welcome text and the Friday report use: of the quotes sent in the last two
   * years (at least 14 days old, no drafts, no $0), the share that never got a yes or a no. 0..1.
   */
  quietRate: number;
  /** The quotes behind the quiet rate. */
  quietWindow: { quotes: number; quiet: number };
  /** Quotes that went quiet per month over the last twelve months (same rules as the quiet rate). */
  quietPerMonth: number;
  /** Share of the quotes that didn't become work that nobody ever answered. */
  silentShareOfLost: number;
  byAge: { label: string; count: number; value: number }[];
  perMonth: { quotes: number; value: number; shareOfQuoted: number };
  /** The file had jobs, visits, invoices or a clients list, not only quotes. */
  hasPastWork: boolean;
  /** Where the export came from, when the reader could tell ("jobber", "housecall_pro"...). */
  source?: string;
  requestsNeverPriced: number;
  pastCustomersNotBack: number;
  wastedLeadSpend?: number;
  /** People we'd write to, and how many of them the free round covers. */
  reachable: number;
  firstRound: number;
  typicalQuote?: number;
  /** Median of the quotes that never got an answer, under the call-list line (what one booking from them is worth). */
  typicalQuiet?: number;
  /** The first note to the likeliest quote nobody answered. */
  hottest?: { name: string; job: string; value: number; quietDays: number } & Note;
  /** Past customers who stopped booking, that a plan writes to: on their own a result, with or without a quote. */
  past?: PastCustomers;
  callList: CallList;
  warnings: string[];
}

/** A first note as the engine writes it, split where its footer (name, mailing address, why, stop) starts. */
export interface Note {
  subject: string;
  body: string;
  foot: string;
  /** How many notes the sequence has. */
  notes: number;
}

export interface PastCustomers {
  people: number;
  regulars: number;
  /** What they paid in their last year with the shop, together; none when the file doesn't say for every one of them. */
  paid?: number;
  /** When they were last here, warmest first, only the spans with anyone in them (see WHEN); what they paid only with `paid`. */
  when: { label: string; people: number; paid?: number }[];
  /** The first note to one of them: a lapsed regular when there is one. */
  note?: { name: string; job: string } & Note;
}

export interface AuditOptions {
  company?: string;
  signer?: string;
  /** What a lead costs them; only used to show money already spent on quotes that went quiet. */
  leadCost?: number;
  /**
   * The page's trade. Their own titles pick among the trades the page's offer sells (a cleaning list dropped on /lawn
   * is cleaning); this one when they can't tell, or tie. Without it, the titles alone (readTrade).
   */
  trade?: TradeId;
  today?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** A quote someone answered: yes, no, or "can you change it". Anything else (awaiting, expired, archived) is quiet. */
const ANSWERED = new Set<string>(["approved", "converted", "declined", "changes_requested"]);

/** Stands in for the owner's mailing address in the preview note until they give it to us. */
export const ADDRESS_SLOT = "[your business address]";

function business(o: AuditOptions, trade: TradeId): BusinessProfile {
  const pb = playbook(trade);
  return {
    id: "audit",
    name: o.company?.trim() || "Your company",
    trade,
    otherTrades: [],
    software: "jobber",
    ownerName: "",
    ownerFirstName: "",
    signerName: o.signer?.trim() || "Sarah",
    // Every commercial note carries a postal address (CAN-SPAM); the preview shows where theirs goes.
    mailingAddress: ADDRESS_SLOT,
    signerRole: "office",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
    sendDays: [2, 3, 4],
    sendWindow: [7, 10],
    blackoutWeeks: [],
    minQuoteValue: pb.minQuote,
    minQuoteAgeDays: 21,
    maxQuoteAgeMonths: 36,
    weeklyNewContacts: 75,
    openCrewWeeks: [],
    voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] },
    persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0 },
    channels: { email: "live", postcard: "off", sms: "off", call_task: "ready", voicemail: "off", retarget: "off" },
    plan: { stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [] },
    createdOn: o.today ?? today(),
    ...(o.leadCost && o.leadCost > 0 ? { leadCost: o.leadCost } : {}),
  };
}

function read(files: AuditFile[], o: AuditOptions): { ds: Dataset; warnings: string[] } {
  const asOf = o.today ?? today();
  let ds = emptyDataset(business(o, "general"), asOf);
  const warnings: string[] = [];
  for (const f of files) {
    const r = ingestFile(ds, f.text, f.name, `${asOf}T12:00:00`);
    ds = r.dataset;
    warnings.push(...r.record.warnings);
  }
  // the trade as the account he signs up for reads the same file
  const { trade, others } = readTrade(ds, o.trade);
  ds = { ...ds, business: { ...business(o, trade), otherTrades: others } };
  return { ds, warnings };
}

/** Quotes and requests, for the note to show first: a recent quote nobody answered, the case every owner recognises. */
const QUOTE_RANK: BreakageType[] = ["unanswered_quote", "archived_quote", "changes_requested", "approved_unscheduled", "declined_quote", "unquoted_request"];
/** Past customers, for theirs: a regular who stopped, then work come due again, then a one-time customer. */
const PAST_RANK: BreakageType[] = ["lapsed_regular", "service_due", "one_and_done"];

/**
 * When the people who stopped were last here, warmest first. A lawn or landscape shop counts this year in months and
 * the years before by season, as its owner does: in January, last summer is last season.
 */
export const WHEN = ["Last 3 months", "3–12 months", "Last season", "Before last season", "Over a year ago"] as const;

export function whenStopped(on: ISODate, asOf: ISODate, seasonal: boolean): (typeof WHEN)[number] {
  const years = Number(asOf.slice(0, 4)) - Number(on.slice(0, 4));
  if (seasonal && years > 0) return years === 1 ? "Last season" : "Before last season";
  return on > addMonths(asOf, -3) ? "Last 3 months" : on > addMonths(asOf, -12) ? "3–12 months" : "Over a year ago";
}

export function runAudit(files: AuditFile[], o: AuditOptions = {}): AuditResult {
  const { ds, warnings } = read(files, o);
  const result = scan(ds);
  const s = summarize(ds, result);
  const a = s.audit;
  const t = s.onTheTable;
  const plan = planOutreach(ds, result, { startOn: ds.asOf, limitPeople: 150, applyHoldout: false });

  // The notes to show, from the plan's first notes: to the quote nobody answered with the most money in it, recent
  // ones first, then older and revised quotes; and to the past customer who paid the most in their last year, one of
  // those counted as stopped (a regular whose deep clean came due isn't), a lapsed regular first (PAST_RANK), those
  // last here within the year before the rest.
  const byOpp = new Map(result.opportunities.map((x) => [x.id, x]));
  const firsts = plan.touches.filter((x) => x.step === 1 && x.channel === "email").map((x) => ({ x, o: byOpp.get(x.opportunityId)! })).filter((p) => p.o);
  const stopped = new Map(stoppedCustomers(ds, result).map((x) => [x.customerId, x]));
  const yearAgo = addMonths(ds.asOf, -12);
  type First = (typeof firsts)[number];
  const best = (rank: BreakageType[], order: (p: First) => number, worth: (p: First) => number, among = firsts) =>
    among.filter((p) => rank.includes(p.o.type)).sort((p, q) => order(p) - order(q) || worth(q) - worth(p))[0];
  const note = (p: First) => {
    const foot = footer(ds.business, p.o.type);
    const whole = p.x.body.endsWith(`\n\n${foot}`);
    return {
      name: ds.customers.find((c) => c.id === p.o.customerId)?.name ?? "",
      job: p.o.jobPhrase?.replace(/^the /, "") ?? "",
      subject: p.x.subject ?? "",
      body: whole ? p.x.body.slice(0, -foot.length - 2) : p.x.body,
      foot: whole ? foot : "",
      notes: plan.touches.filter((x) => x.opportunityId === p.o.id).length,
    };
  };
  const quotePick = best(QUOTE_RANK, (p) => QUOTE_RANK.indexOf(p.o.type) + (p.o.ageDays > 180 ? QUOTE_RANK.length : 0), (p) => p.o.value);
  const hottest = quotePick && { ...note(quotePick), value: quotePick.o.value, quietDays: quotePick.o.ageDays };
  const them = (p: First) => stopped.get(p.o.customerId);
  const pastPick = best(PAST_RANK, (p) => PAST_RANK.indexOf(p.o.type) * 2 + ((them(p)?.lastOn ?? "") <= yearAgo ? 1 : 0), (p) => them(p)?.paidLastYear ?? 0, firsts.filter(them));
  const seasonal = SEASONAL_TRADES.has(ds.business.trade);
  const people = [...stopped.values()];
  const paid = (xs: typeof people) => {
    const p = paidTogether(xs);
    return p && Math.round(p);
  };
  const total = paid(people);
  const when = WHEN.map((label) => {
    const span = people.filter((x) => whenStopped(x.lastOn, ds.asOf, seasonal) === label);
    return { label, people: span.length, paid: total && paid(span) };
  }).filter((w) => w.people);
  const past: PastCustomers | undefined = people.length
    ? { people: people.length, regulars: people.filter((x) => x.regular).length, paid: total, when, note: pastPick && note(pastPick) }
    : undefined;

  const quoteTotals = ds.quotes.filter((q) => q.total > 0).map((q) => q.total).sort((x, y) => x - y);
  const daysAgo = (d: number) => new Date(Date.parse(`${ds.asOf}T12:00:00Z`) - d * 86_400_000).toISOString().slice(0, 10);
  const quietCut = daysAgo(14);

  // The quiet rate is the engine's (audit.rate): quotes sent in the last two years, at least 14 days old, no drafts,
  // no $0; expired or archived counts as quiet. The window counts below use the same rule for the lines around it.
  const sentOn = (q: (typeof ds.quotes)[number]) => q.sentOn ?? q.createdOn;
  const inWindow = (from: string) => ds.quotes.filter((q) => { const d = sentOn(q); return !!d && d >= from && d <= quietCut && q.status !== "draft" && q.total > 0; });
  const isQuiet = (q: (typeof ds.quotes)[number]) => !ANSWERED.has(q.status);
  const twoYears = inWindow(daysAgo(730));
  const window = { quotes: twoYears.length, quiet: twoYears.filter(isQuiet).length };
  const quietRate = a.rate;
  const quietPerMonth = Math.round((inWindow(daysAgo(365)).filter(isQuiet).length / 12) * 10) / 10;
  const freshQuotes = ds.quotes.filter((q) => { const d = sentOn(q); return !!d && d > quietCut && q.status !== "draft"; });
  const fresh = { count: freshQuotes.length, value: Math.round(freshQuotes.reduce((s, q) => s + q.total, 0)) };
  const callOver = ds.business.callOverAmount ?? 10_000;
  const quietTotals = ds.quotes
    .filter((q) => q.total > 0 && q.total < callOver && !["draft", "approved", "converted", "declined", "changes_requested"].includes(q.status) && (q.sentOn ?? q.createdOn ?? "9999") <= quietCut)
    .map((q) => q.total)
    .sort((x, y) => x - y);
  return {
    trade: ds.business.trade,
    tradeLabel: playbook(ds.business.trade).label,
    company: ds.business.name,
    quotes: result.stats.quotes,
    customers: result.stats.customers,
    from: result.stats.from,
    to: result.stats.to,
    won: a.won,
    saidNo: { count: a.declined.count + a.changesIgnored.count, value: a.declined.value + a.changesIgnored.value },
    silent: a.silent,
    fresh,
    quietRate,
    quietWindow: window,
    quietPerMonth,
    silentShareOfLost: a.silentShareOfLost,
    byAge: a.byAge,
    perMonth: t.perMonth,
    hasPastWork: ds.jobs.length > 0 || ds.invoices.length > 0,
    source: ds.imports.find((i) => i.kind === "quote")?.source ?? ds.imports[0]?.source,
    requestsNeverPriced: t.requestsNeverPriced,
    pastCustomersNotBack: t.pastCustomersNotBack,
    wastedLeadSpend: t.wastedLeadSpend,
    reachable: s.reachablePeople,
    firstRound: Math.min(150, s.reachablePeople),
    typicalQuote: quoteTotals.length ? quoteTotals[Math.floor(quoteTotals.length / 2)] : undefined,
    typicalQuiet: quietTotals.length ? quietTotals[Math.floor(quietTotals.length / 2)] : undefined,
    hottest,
    past,
    callList: s.callList,
    warnings: [...new Set(warnings)],
  };
}
