import type { TradeId } from "@qa/engine";

/**
 * Everything on the page that changes by trade (deck section 3). Proof is only ever a real shop's real first 150,
 * named with permission, and always says what kind of shop it was: a painting page shows a fence shop's old quotes
 * and says so, a cleaning page shows a landscaper's past customers and says so. Every outside figure here is one
 * of the claims in packages/engine/src/claims.ts and carries its source. Examples are marked as examples.
 */
export type SiteTrade = "tree" | "fence" | "painting" | "cleaning";

export interface Proof {
  shop: string;
  where: string;
  /** What kind of shop, only when it isn't this page's trade ("fence shop"). */
  kind?: string;
  list: string;
  asked: number;
  wroteBack: number;
  booked: number;
  /** Word for word: "over" $10k, "about" $19,800. */
  jobsPre: "over" | "about";
  jobs: string;
  /** The owner's own text, unedited, and whose it is. */
  quote: string;
  quoteBy: string;
  /** Said whenever the proof comes from another trade. */
  otherTrade?: string;
}

/** The take-back step: the shops' own rate, half of it, and the owner's own guess. */
export interface TakeBack {
  /** Chip text for the shops' rate ("Like Dow's and Nelson's"). */
  like: string;
  /** 1 in n. */
  n: number;
  half: number;
  /** Who got it, for "…got about 1 in 37, so we'll price against theirs." */
  theirs: string;
  /** The label under the choices. */
  label: string;
}

export interface ReadyText {
  name: string;
  /** "wants it done" / "wants back on" */
  wants: string;
  job: string;
  said: string;
  meta: string;
  value: string;
  /** "back on the table" / "a visit back on the schedule" */
  valueTail: string;
  booked: string;
}

export interface TradeCopy {
  id: SiteTrade;
  engine: TradeId;
  eyebrow: string;
  /** "tree company", for "Try a sample tree company". */
  sampleNoun: string;
  h1: string;
  /** The lede's first sentence (the loss) and its source, shown beside it. */
  loss: string;
  lossSource: string;
  lede: string;
  /** "quotes" or, on the painting page, "estimates". */
  word: "quotes" | "estimates";
  dropH2: string;
  /** Where the export lives in Jobber, for this trade's owners. */
  exportHint: string;
  /** Section "the quiet rate". */
  quietH2: string;
  pain: string;
  /** "You paid for every one." */
  paid: { text: string; source: string };
  /** R6 when the owner taps Not sure: a sourced figure as a question, and the figures he can confirm with a tap. */
  costAsk: { text: string; source?: string; picks: number[] };
  proof: Proof;
  /** Before an audit (only where a real average backs it). */
  anchor?: string;
  take: TakeBack;
  /** Cleaning: the rate for past customers, used when the file has them. */
  takePast?: TakeBack;
  /** What the first-note customer might write back ({month} is next month). */
  takeAsk: string;
  ready: ReadyText;
  /** A new request and the answer that goes back (the always-on example). */
  request: { said: string; ack: string };
  /** One quote followed to an answer: [day, what happens, is it the answer]. */
  journey: [string, string, boolean?][];
  /** Example ledger lines: customer, job, the record in their software, the note they answered, amount. */
  ledger: [string, string, string, string, string][];
  /** Placeholder in the start form. */
  companyExample: string;
}

const DOWS: Proof = {
  shop: "Dow's Tree Service",
  where: "NH",
  list: "old quotes",
  asked: 150,
  wroteBack: 12,
  booked: 4,
  jobsPre: "over",
  jobs: "$10k",
  quote: "Honestly I was pretty skeptical at first…",
  quoteBy: "Ryan's text, unedited",
};
const NELSON: Proof = {
  shop: "Nelson Fence",
  where: "CT",
  list: "old quotes",
  asked: 150,
  wroteBack: 12,
  booked: 4,
  jobsPre: "about",
  jobs: "$19,800",
  quote: "…we picked up 4 jobs from people that had already gotten a quote and just never got back to us…",
  quoteBy: "David's text, unedited",
};
const CAPITAL: Proof = {
  shop: "Capital City Landscaping",
  where: "NH",
  list: "past customers",
  asked: 150,
  wroteBack: 28,
  booked: 17,
  jobsPre: "about",
  jobs: "$34,000",
  quote: "…a bunch of people we thought were dead accounts end up getting back to us…",
  quoteBy: "Tom's text, unedited",
};

const OWNER_REPORTED = "Owner-reported, no comparison group.";
const JOBBER_QUOTES = "In Jobber: Reports → Quotes report → All time → Export CSV. Jobber emails it to you.";
/** Fence and painting quotes mostly live outside Jobber (owner research): name where they really are. */
const NO_EXPORT = "A spreadsheet works too, or text Jack a photo of your bid book: 603-340-7673.";
const FENCE_QUOTES = `Export your quotes as a CSV from Fence Cloud, QuickBooks (estimates) or Jobber. ${NO_EXPORT}`;
const PAINT_ESTIMATES = `Export your estimates as a CSV from PaintScout, DripJobs, QuickBooks (estimates) or Jobber. ${NO_EXPORT}`;
const QUOTE_ASK = "Can you do {month}?";

export const TRADES: Record<SiteTrade, TradeCopy> = {
  tree: {
    id: "tree",
    engine: "tree",
    eyebrow: "For tree services",
    sampleNoun: "tree company",
    h1: "Your quotes don't say no. They go quiet.",
    loss: "About 4 in 10 tree estimates never become a job.",
    lossSource: "ArboStar, 2025 tree-service data.",
    lede: "We follow up the ones that went quiet, in your company's name, and text you when someone's ready to book.",
    word: "quotes",
    dropH2: "How much is sitting in your quotes?",
    exportHint: JOBBER_QUOTES,
    quietH2: "Your software counts quotes sent. Not quotes answered.",
    pain: "The removal you priced in May is still leaning over their roof. Nobody called them back, and they didn't call you.",
    paid: { text: "A tree request from Google's Local Services ads runs about $38, win or lose.", source: "99 Calls, Apr–Jun 2026" },
    costAsk: { text: "A tree request from Google's Local Services ads runs about $38. Higher or lower for you?", source: "99 Calls, Apr–Jun 2026", picks: [38] },
    proof: DOWS,
    anchor: "Dow's four jobs averaged over $2,500. Each one covers about five months of this.",
    take: {
      like: "Like Dow's and Nelson's",
      n: 37,
      half: 75,
      theirs: "Dow's and Nelson's",
      label: `Dow's Tree Service's and Nelson Fence's own count of their old quotes, first 150. ${OWNER_REPORTED}`,
    },
    takeAsk: QUOTE_ASK,
    ready: {
      name: "Karen Whitfield",
      wants: "wants it done",
      job: "Remove leaning oak · quoted Aug 12",
      said: "Sorry, crazy summer. Is that price still good? Can you do October?",
      meta: "14 Oak Ln · best time: after 4",
      value: "$2,400",
      valueTail: "back on the table",
      booked: "BOOKED 2400",
    },
    request: { said: "Two pines by the garage need to come down. One is dead.", ack: "Thanks for reaching out about the pines. Dave will give you a call to set up a time to take a look. Sarah" },
    journey: [["0", "Quote sent: remove leaning oak, $2,400"], ["2", "“Just making sure the quote came through okay”"], ["7", "“Any thoughts? Reply yes and I'll get you on the schedule”"], ["8", "“Can you do Tuesday?” → texted to you", true]],
    ledger: [["K. Whitfield", "Leaning oak", "Quote #1042", "Note 1", "$2,400"], ["P. Brennan", "Crown thinning", "Job #2211", "Note 2", "$1,850"], ["J. Ortega", "Stump grinding", "Quote #1057", "Note 1", "$650"]],
    companyExample: "Ridgeline Tree Co.",
  },
  fence: {
    id: "fence",
    engine: "fence",
    eyebrow: "For fence companies",
    sampleNoun: "fence company",
    h1: "Your quotes don't say no. They go quiet.",
    loss: "Only about a third of home-service owners say they close more than 7 in 10 of their quotes.",
    lossSource: "Jobber 2026 Home Service Trends Report, 1,050 owners, self-reported.",
    lede: "We follow up the ones that went quiet, in your company's name, and text you when someone's ready to book.",
    word: "quotes",
    dropH2: "How much is sitting in your quotes?",
    exportHint: FENCE_QUOTES,
    quietH2: "Your software counts quotes sent. Not quotes answered.",
    pain: "You measured, priced it and sent it. Then they waited on the neighbor, the pool, the tax refund, and nobody picked the phone back up.",
    paid: { text: "Angi charges pros for every match, “regardless of whether the Pro ultimately provides the requested service.”", source: "Angi 10-K, FY2025" },
    costAsk: { text: "Nobody publishes a fence figure. What do you pay?", picks: [] },
    proof: NELSON,
    anchor: "Nelson's four jobs averaged about $4,950. Each one covers about ten months of this.",
    take: {
      like: "Like Nelson's",
      n: 37,
      half: 75,
      theirs: "Nelson's",
      label: `Nelson Fence's own count of their old quotes, first 150. ${OWNER_REPORTED}`,
    },
    takeAsk: QUOTE_ASK,
    ready: {
      name: "Brian Lopes",
      wants: "wants it done",
      job: "160 ft cedar privacy · quoted Jun 3",
      said: "We held off for the pool. Ready now if you can fit us in before the ground freezes.",
      meta: "22 Village St · cell",
      value: "$7,850",
      valueTail: "back on the table",
      booked: "BOOKED 7850",
    },
    request: { said: "Looking for a price on about 150 ft of privacy fence along the back line.", ack: "Thanks for reaching out about the privacy fence. Dave will give you a call to set up a time to come measure. Sarah" },
    journey: [["0", "Quote sent: 160 ft cedar privacy, $7,850"], ["2", "“Just making sure the quote came through okay”"], ["7", "“Any thoughts? Reply yes and I'll get you on the install schedule”"], ["9", "“Can we do black aluminum instead?” → texted to you", true]],
    ledger: [["B. Lopes", "Cedar privacy", "Quote #3310", "Note 1", "$7,850"], ["D. Kim", "Pool fence", "Job #1874", "Note 2", "$6,300"], ["S. Grady", "Gate + 2 posts", "Quote #3342", "Note 1", "$1,150"]],
    companyExample: "Stonewall Fence Co.",
  },
  painting: {
    id: "painting",
    engine: "painting",
    eyebrow: "For painting contractors",
    sampleNoun: "painting company",
    h1: "They didn't say no. They said they'd talk it over.",
    loss: "Interior painting is one of the projects homeowners put off most. Put off isn't no.",
    lossSource: "Angi 2025 State of Home Spending Pulse, 1,000 homeowners.",
    lede: "We follow up the estimates that went quiet, in your company's name, and text you when someone's ready to book.",
    word: "estimates",
    dropH2: "How much is sitting in your estimates?",
    exportHint: PAINT_ESTIMATES,
    quietH2: "Your software counts estimates sent. Not estimates answered.",
    pain: "They got three bids and said they'd talk it over. Nobody asked again. Be the one who does.",
    paid: { text: "A painting request from Google search ads costs about $138, win or lose.", source: "LocaliQ search benchmarks, 2024–25" },
    costAsk: { text: "About $138 from Google search ads, about $33 from Local Services ads. What do you pay?", source: "LocaliQ, 2024–25; 99 Calls, Apr–Jun 2026", picks: [138, 33] },
    proof: { ...NELSON, kind: "fence shop", otherTrade: "No painting shop has finished a first 150 with us yet. These are a fence shop's old quotes." },
    take: {
      like: "Like Nelson's fence quotes",
      n: 37,
      half: 75,
      theirs: "Nelson Fence's",
      label: `Nelson Fence's own count of their old quotes, first 150. A fence shop, not a painter. ${OWNER_REPORTED}`,
    },
    takeAsk: QUOTE_ASK,
    ready: {
      name: "Rachel Moore",
      wants: "wants it done",
      job: "Exterior repaint, colonial · quoted May 20",
      said: "Still want it done, just needed to talk to my husband. Can you start before it gets cold?",
      meta: "41 Elm St · best time: after 5",
      value: "$6,200",
      valueTail: "back on the table",
      booked: "BOOKED 6200",
    },
    request: { said: "Need a price to repaint the living room and hallway. Walls only.", ack: "Thanks for reaching out about the living room and hallway. Dave will give you a call to set up a time to take a look. Sarah" },
    journey: [["0", "Estimate sent: exterior repaint, $6,200"], ["2", "“Just making sure the estimate came through okay”"], ["7", "“Any thoughts? If something doesn't fit, tell me and I'll rework it”"], ["8", "“Could you do just the front and sides?” → texted to you", true]],
    ledger: [["R. Moore", "Exterior repaint", "Quote #884", "Note 1", "$6,200"], ["T. Keller", "Cabinets", "Job #512", "Note 2", "$3,900"], ["A. Shah", "Deck stain", "Quote #901", "Note 1", "$1,400"]],
    companyExample: "Brushline Painting",
  },
  cleaning: {
    id: "cleaning",
    engine: "cleaning",
    eyebrow: "For cleaning companies",
    sampleNoun: "cleaning company",
    h1: "Your customers don't quit. They go quiet.",
    loss: "Most homeowners (68%) say they'd hire the same company again. How many of yours were never asked?",
    lossSource: "Housecall Pro homeowner survey, 1,040 homeowners, Oct 2025.",
    lede: "We ask back the customers who drifted, in your company's name, and text you when someone wants back on.",
    word: "quotes",
    dropH2: "Who stopped coming, and what they were worth?",
    exportHint: "In Jobber: Reports → Visits report (or Quotes report) → All time → Export CSV. Jobber emails it to you.",
    quietH2: "Your software counts customers. Not the ones who stopped coming.",
    pain: "A deep clean that never became every other week. A regular who skipped March and never came back. Nobody asked.",
    paid: { text: "A cleaning request from Google's Local Services ads runs about $33, win or lose.", source: "99 Calls, Apr–Jun 2026" },
    costAsk: { text: "About $33 from Google's Local Services ads. What do you pay?", source: "99 Calls, Apr–Jun 2026", picks: [33] },
    proof: { ...CAPITAL, kind: "landscaper", otherTrade: "No cleaning company has finished a first 150 with us yet. These are a landscaper's past customers." },
    take: {
      like: "Like a tree shop's and a fence shop's old quotes",
      n: 37,
      half: 75,
      theirs: "Dow's Tree Service and Nelson Fence",
      label: `Dow's Tree Service's and Nelson Fence's own count of their old quotes, first 150. A tree shop and a fence shop, not cleaning companies. ${OWNER_REPORTED}`,
    },
    takePast: {
      like: "Like Capital City's past customers",
      n: 9,
      half: 18,
      theirs: "Capital City's",
      label: `Capital City Landscaping's own count of their past customers, first 150. A landscaper, not a cleaning company. ${OWNER_REPORTED}`,
    },
    takeAsk: "Can you fit us in next week?",
    ready: {
      name: "Megan Ortiz",
      wants: "wants back on",
      job: "Every other Friday · last visit Mar 14",
      said: "Yes please put us back on. Same day works.",
      meta: "17 Harbor Rd",
      value: "$180",
      valueTail: "a visit back on the schedule",
      booked: "BOOKED 180",
    },
    request: { said: "Looking for someone every other week, 3 bed 2 bath, we have a dog.", ack: "Thanks for reaching out about cleaning every other week. Dave will give you a call to go over it and find a day. Sarah" },
    journey: [["0", "Last visit: every other Friday, $180"], ["60", "“We haven't seen you since March. Want your Fridays back?”"], ["67", "“Same crew, same day if it still works”"], ["68", "“Yes please put us back on” → texted to you", true]],
    ledger: [["M. Ortiz", "Every other Friday", "Visit #4410", "Note 1", "$180"], ["C. Dunn", "Move-in deep clean", "Job #3302", "Note 2", "$425"], ["L. Park", "Monthly clean", "Visit #4452", "Note 1", "$165"]],
    companyExample: "Tidewell Home Cleaning",
  },
};

export function tradeFromHash(hash: string): SiteTrade {
  const h = hash.replace(/^#/, "").toLowerCase();
  return (Object.keys(TRADES) as SiteTrade[]).find((t) => h === t || h.startsWith(`${t}-`)) ?? "tree";
}

export function isTrade(s: string | null | undefined): s is SiteTrade {
  return !!s && s in TRADES;
}
