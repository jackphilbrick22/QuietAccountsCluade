import type { TradeId } from "@qa/engine";

/**
 * Everything on the page that changes by trade. Proof is only ever a real shop's real first 150, named with
 * permission, and says what kind of shop it was; examples are marked as examples.
 */
export type SiteTrade = "tree" | "fence" | "painting" | "cleaning";

export interface Proof {
  shop: string;
  where: string;
  list: string;
  asked: number;
  wroteBack: number;
  booked: number;
  jobs: string;
}

export interface HotText {
  name: string;
  job: string;
  said: string;
  meta: string;
  value: string;
}

export interface TradeCopy {
  id: SiteTrade;
  engine: TradeId;
  eyebrow: string;
  /** "a tree company", for "Try it on a sample tree company". */
  sampleNoun: string;
  h1: string;
  pain: string;
  proof: Proof;
  texts: [HotText, HotText];
  ownerReply: string;
  /** Where the quotes report lives in Jobber, for this trade's owners. */
  exportHint: string;
  /** A new request and the answer that goes back (the always-on example). */
  request: { said: string; ack: string };
  /** One quote followed to an answer: [day, what happens, is it the answer]. */
  journey: [string, string, boolean?][];
  /** Example ledger lines: customer, job, days quiet, record, amount. */
  ledger: [string, string, string, string, string][];
}

const DOWS: Proof = { shop: "Dow's Tree Service", where: "NH", list: "old quotes", asked: 150, wroteBack: 12, booked: 4, jobs: "$10k+" };
const NELSON: Proof = { shop: "Nelson Fence", where: "CT", list: "old quotes", asked: 150, wroteBack: 12, booked: 4, jobs: "$19.8k" };
const CAPITAL: Proof = { shop: "Capital City Landscaping", where: "NH", list: "past customers", asked: 150, wroteBack: 28, booked: 17, jobs: "$34k" };

const JOBBER_QUOTES = "In Jobber: Reports → Quotes report → All time → Export CSV. Jobber emails the file to your login address.";

export const TRADES: Record<SiteTrade, TradeCopy> = {
  tree: {
    id: "tree",
    engine: "tree",
    eyebrow: "For tree services",
    sampleNoun: "tree company",
    h1: "Your quotes don't say no. They go quiet.",
    pain: "The removal you priced in May is still leaning over their roof. Nobody called them back, and they didn't call you.",
    proof: DOWS,
    texts: [
      { name: "Karen Whitfield", job: "Remove leaning oak · quoted Aug 12", said: "Sorry, crazy summer. Is that price still good? Can you do October?", meta: "14 Oak Ln · best time: after 4", value: "$2,400" },
      { name: "Paul Brennan", job: "Crown thinning, 3 maples · quoted Jul 2", said: "Yes. Go ahead before the leaves drop.", meta: "88 Ridge Rd", value: "$1,850" },
    ],
    ownerReply: "On it. Calling her at 4.",
    exportHint: JOBBER_QUOTES,
    request: { said: "Two pines by the garage need to come down. One is dead.", ack: "Thanks for reaching out about the pines. Dave will give you a call this afternoon to set up a time to take a look. Sarah" },
    journey: [["0", "You send the quote: remove leaning oak, $2,400"], ["2", "\u201cJust making sure the quote came through okay\u201d"], ["7", "\u201cAny thoughts? Reply yes and I'll get you on the schedule\u201d"], ["8", "\u201cCan you do Tuesday?\u201d \u2192 texted to you", true]],
    ledger: [["K. Whitfield", "Leaning oak", "49 days", "Quote #1042", "$2,400"], ["P. Brennan", "Crown thinning", "90 days", "Job #2211", "$1,850"], ["J. Ortega", "Stump grinding", "34 days", "Quote #1057", "$650"]],
  },
  fence: {
    id: "fence",
    engine: "fence",
    eyebrow: "For fence companies",
    sampleNoun: "fence company",
    h1: "Your quotes don't say no. They go quiet.",
    pain: "You measured, priced it and sent it. Then they waited on the neighbor, the pool, the tax refund, and nobody picked the phone back up.",
    proof: NELSON,
    texts: [
      { name: "Brian Lopes", job: "160 ft cedar privacy · quoted Jun 3", said: "We held off for the pool. Ready now if you can fit us in before the ground freezes.", meta: "22 Village St · cell", value: "$7,850" },
      { name: "Dana Kim", job: "Aluminum pool fence · quoted Aug 20", said: "Can we do the black one instead? Same layout.", meta: "5 Birch Ct", value: "$6,300" },
    ],
    ownerReply: "Calling him on the way back from the yard.",
    exportHint: JOBBER_QUOTES,
    request: { said: "Looking for a price on about 150 ft of privacy fence along the back line.", ack: "Thanks for reaching out about the privacy fence. Dave will give you a call this afternoon to set up a time to come measure. Sarah" },
    journey: [["0", "You send the quote: 160 ft cedar privacy, $7,850"], ["2", "\u201cJust making sure the quote came through okay\u201d"], ["7", "\u201cAny thoughts? Reply yes and I'll get you on the install schedule\u201d"], ["9", "\u201cCan we do black aluminum instead?\u201d \u2192 texted to you", true]],
    ledger: [["B. Lopes", "Cedar privacy", "118 days", "Quote #3310", "$7,850"], ["D. Kim", "Pool fence", "41 days", "Job #1874", "$6,300"], ["S. Grady", "Gate + 2 posts", "63 days", "Quote #3342", "$1,150"]],
  },
  painting: {
    id: "painting",
    engine: "painting",
    eyebrow: "For painting contractors",
    sampleNoun: "painting company",
    h1: "Your quotes don't say no. They go quiet.",
    pain: "They got three bids and meant to decide after talking it over. Two painters never followed up. Be the one who did.",
    proof: NELSON,
    texts: [
      { name: "Rachel Moore", job: "Exterior repaint, colonial · quoted May 20", said: "Still want it done, just needed to talk to my husband. Can you start before it gets cold?", meta: "41 Elm St · after 5", value: "$6,200" },
      { name: "Tom Keller", job: "Kitchen cabinets · quoted Aug 28", said: "What would it be if we keep the white and skip the island?", meta: "9 Pine Ave", value: "$3,900" },
    ],
    ownerReply: "Calling her tonight.",
    exportHint: JOBBER_QUOTES,
    request: { said: "Need a quote to repaint the living room and hallway. Walls only.", ack: "Thanks for reaching out about the living room and hallway. Dave will give you a call this afternoon to set up a time to take a look. Sarah" },
    journey: [["0", "You send the quote: exterior repaint, $6,200"], ["2", "\u201cJust making sure the quote came through okay\u201d"], ["7", "\u201cAny thoughts? If something doesn't fit, tell me and I'll rework it\u201d"], ["8", "\u201cCould you do just the front and sides?\u201d \u2192 texted to you", true]],
    ledger: [["R. Moore", "Exterior repaint", "133 days", "Quote #884", "$6,200"], ["T. Keller", "Cabinets", "33 days", "Job #512", "$3,900"], ["A. Shah", "Deck stain", "58 days", "Quote #901", "$1,400"]],
  },
  cleaning: {
    id: "cleaning",
    engine: "cleaning",
    eyebrow: "For cleaning companies",
    sampleNoun: "cleaning company",
    h1: "Your customers don't quit. They go quiet.",
    pain: "A one-time deep clean that never became every other week. A regular who skipped March and never came back. Nobody asked.",
    proof: CAPITAL,
    texts: [
      { name: "Megan Ortiz", job: "Every other Friday · last visit Mar 14", said: "Yes please put us back on. Same day works.", meta: "17 Harbor Rd", value: "$180 a visit" },
      { name: "Chris Dunn", job: "Move-in deep clean · quoted Sep 2", said: "We're in now. Can you do the deep clean and then monthly?", meta: "3 Cedar Ln", value: "$425 + monthly" },
    ],
    ownerReply: "Adding her back on Friday.",
    exportHint: JOBBER_QUOTES,
    request: { said: "Looking for someone every other week, 3 bed 2 bath, we have a dog.", ack: "Thanks for reaching out about cleaning every other week. Dave will give you a call this afternoon to go over it and find a day. Sarah" },
    journey: [["0", "You send the quote: move-in deep clean, $425"], ["2", "\u201cJust making sure the quote came through okay\u201d"], ["7", "\u201cAny thoughts? Reply yes and I'll get you on the schedule\u201d"], ["7", "\u201cYes, and can you do monthly after?\u201d \u2192 texted to you", true]],
    ledger: [["M. Ortiz", "Every other Friday", "200 days", "Visit #4410", "$180"], ["C. Dunn", "Move-in deep clean", "28 days", "Job #3302", "$425"], ["L. Park", "Monthly clean", "96 days", "Visit #4452", "$165"]],
  },
};

export function tradeFromHash(hash: string): SiteTrade {
  const h = hash.replace(/^#/, "").toLowerCase();
  return (Object.keys(TRADES) as SiteTrade[]).find((t) => h === t || h.startsWith(`${t}-`)) ?? "tree";
}
