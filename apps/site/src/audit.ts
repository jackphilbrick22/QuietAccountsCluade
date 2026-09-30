import {
  detectTrade,
  emptyDataset,
  generateSample,
  ingestFile,
  planOutreach,
  playbook,
  scan,
  summarize,
  type BusinessProfile,
  type CallList,
  type Dataset,
  type TradeId,
} from "@qa/engine";

/**
 * The Quote Audit, run entirely in the visitor's browser: read their export, find every quote that never
 * got a yes or a no, and write the first note to the likeliest one. The file only leaves the browser if the owner
 * taps Start and ticks "Send this file". Every number comes from their file; nothing here is an industry average.
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
  hottest?: { name: string; job: string; value: number; quietDays: number; subject: string; body: string; notes: number };
  callList: CallList;
  warnings: string[];
}

export interface AuditOptions {
  company?: string;
  signer?: string;
  /** What a lead costs them; only used to show money already spent on quotes that went quiet. */
  leadCost?: number;
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
  let ds = emptyDataset(business(o, o.trade ?? "general"), asOf);
  const warnings: string[] = [];
  for (const f of files) {
    const r = ingestFile(ds, f.text, f.name, `${asOf}T12:00:00`);
    ds = r.dataset;
    warnings.push(...r.record.warnings);
  }
  if (!o.trade) {
    const d = detectTrade([...ds.quotes.map((q) => q.title), ...ds.jobs.map((j) => j.title), ...ds.requests.map((r) => r.title)]);
    ds = { ...ds, business: { ...business(o, d.trade), otherTrades: d.others } };
  }
  return { ds, warnings };
}

export function runAudit(files: AuditFile[], o: AuditOptions = {}): AuditResult {
  const { ds, warnings } = read(files, o);
  const result = scan(ds);
  const s = summarize(ds, result);
  const a = s.audit;
  const t = s.onTheTable;
  const plan = planOutreach(ds, result, { startOn: ds.asOf, limitPeople: 150, applyHoldout: false });

  // The note to show: a recent quote nobody answered, the one with the most money in it. That's the case every
  // owner recognises; older quotes and revised quotes fall back in that order.
  const byOpp = new Map(result.opportunities.map((x) => [x.id, x]));
  const firsts = plan.touches.filter((x) => x.step === 1 && x.channel === "email").map((x) => ({ x, o: byOpp.get(x.opportunityId)! })).filter((p) => p.o);
  const rank = (p: (typeof firsts)[number]) => (p.o.type === "unanswered_quote" ? 0 : p.o.type === "archived_quote" ? 1 : p.o.type === "changes_requested" ? 2 : 3) + (p.o.ageDays > 180 ? 4 : 0);
  const pick = [...firsts].sort((p, q) => rank(p) - rank(q) || q.o.value - p.o.value)[0];
  const hottest = pick
    ? {
        name: ds.customers.find((c) => c.id === pick.o.customerId)?.name ?? "",
        job: pick.o.jobPhrase?.replace(/^the /, "") ?? "",
        value: pick.o.value,
        quietDays: pick.o.ageDays,
        subject: pick.x.subject ?? "",
        body: pick.x.body,
        notes: plan.touches.filter((x) => x.opportunityId === pick.o.id).length,
      }
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
    callList: s.callList,
    warnings: [...new Set(warnings)],
  };
}

/** The same audit on a made-up company in their trade, clearly labelled as a sample wherever it's shown. */
const SAMPLE_NAMES: Partial<Record<TradeId, string>> = {
  tree: "Ridgeline Tree Co.",
  fence: "Stonewall Fence Co.",
  painting: "Brushline Painting",
  cleaning: "Tidewell Home Cleaning",
};

export function sampleAudit(trade: TradeId, o: AuditOptions = {}): AuditResult {
  const asOf = o.today ?? today();
  const sample = generateSample({ trade, asOf, businessName: SAMPLE_NAMES[trade] });
  return runAudit(
    sample.files.map((f) => ({ name: f.name, text: f.text })),
    { ...o, company: o.company || sample.business.name, signer: o.signer || sample.business.signerName, trade, today: asOf },
  );
}
