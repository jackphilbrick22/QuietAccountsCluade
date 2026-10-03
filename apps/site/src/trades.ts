import { claim, type TradeId } from "@qa/engine";

/**
 * Everything on the pages that changes by page, read at build time (build/render.ts), never shipped to the browser.
 * Proof is only ever a real shop's real first 150, named with permission, and always carries LABEL; Dow's always
 * carries FAMILY too, wherever it's counted (16 CFR 255.5). Every outside figure comes from packages/engine/src/claims.ts
 * and carries its source. A new page is an HTML file plus an entry in PAGES.
 */
export type Offer = "monthly" | "one_pass";

/** What the form sends as `software`, in the words the server reads ("jobber", "housecall"). */
export type Software = "jobber" | "housecall_pro" | "other";

export const LABEL = "Owner-reported. First 150 people. No comparison group.";
export const FAMILY = "Dow's is owned by Jack's uncle.";

export interface Proof {
  shop: string;
  where: string;
  /** "last season's customers", "old quotes". */
  list: string;
  /** On another trade's page, what the list was instead ("a landscaper's past customers"): with the numbers wherever they show. */
  otherTrade?: string;
  asked: number;
  wroteBack: number;
  booked: number;
  /** In jobs, in dollars. */
  value: number;
  /** "Over" that: Dow's booked "over 10k". */
  over?: boolean;
  note: string;
  /** The owner's own text, unedited (a screenshot in src/assets). */
  shot: { file: string; width: number; height: number; alt: string; by: string };
  /** Dow's: Jack's uncle's shop. */
  family?: boolean;
}

const CAPITAL: Proof = {
  shop: "Capital City Landscaping",
  where: "NH",
  list: "last season's customers",
  asked: 150,
  wroteBack: 28,
  booked: 17,
  value: 34_000,
  note: "21 said yes. He had room for 17.",
  shot: {
    file: "tom-text.jpg",
    width: 480,
    height: 694,
    alt: "Text from Tom: honestly its been pretty great. we had a bunch of people we thought were dead accounts end up getting back to us. got jobs out of it we probably wouldnt have gotten otherwise",
    by: "Tom's text, unedited",
  },
};
const NELSON: Proof = {
  shop: "Nelson Fence",
  where: "CT",
  list: "old quotes",
  asked: 150,
  wroteBack: 12,
  booked: 4,
  value: 19_800,
  note: "People who got a quote and never got back to him.",
  shot: {
    file: "david-text.jpg",
    width: 480,
    height: 635,
    alt: "Text from David: honestly its worth trying. we picked up 4 jobs from people that had already gotten a quote and just never got back to us. stuff we probably wouldve just lost otherwise",
    by: "David's text, unedited",
  },
};
const DOWS: Proof = {
  shop: "Dow's Tree Service",
  where: "NH",
  list: "old quotes",
  asked: 150,
  wroteBack: 12,
  booked: 4,
  value: 10_000,
  over: true,
  note: "He was skeptical going in.",
  shot: {
    file: "ryan-text.jpg",
    width: 480,
    height: 709,
    alt: "Text from Ryan: Honestly I was pretty skeptical at first but it ended up bringing us back 4 jobs that we probably would've never gotten. We booked over 10k from it so yeah I'd definitely tell another tree guy about it",
    by: "Ryan's text, unedited",
  },
  family: true,
};
/** Capital City on another trade's page: the one-pass pages, where the lists are old quotes, and /cleaning. */
const LANDSCAPER: Proof = { ...CAPITAL, otherTrade: "a landscaper's past customers" };

/**
 * The words that come with an offer: the one button, the price line beside it, the consent box, what he sends us
 * after the form, the front-page card. A one pass also gives the calculator what he'd pay.
 */
export interface OfferWords {
  offer: Offer;
  button: string;
  priceLine: string;
  /** The sticky bar on phones: the price, then its small line. */
  sticky: [string, string];
  /** {company} is what he typed. */
  consent: string;
  /** After the form: what we need from him, and the step that sends it. */
  sendUs: string;
  forward: string;
  /** The small line under each choice in the form's software picker: how many exports he'll forward. */
  picker: Record<Software, string>;
  card: { title: string; text: string };
  /** In dollars, and the most bookings he ever pays for. */
  pay?: { each: number; cap: number };
}

export const MONTHLY: OfferWords = {
  offer: "monthly",
  button: "Start my free 150",
  priceLine: "then $497/mo if you say yes",
  sticky: ["First 150 free", "then $497/mo if you say yes"],
  consent: "I run {company}. Quiet Accounts can write to my past customers in my company's name and text me at this number about it. Msg & data rates may apply. Reply STOP to stop.",
  sendUs: "Send us the export and we'll have the first note ready for you to read within one business day.",
  forward: "Forward that email, as it is, to",
  picker: { jobber: "Emails you a file", housecall_pro: "Forward one report", other: "Any export or spreadsheet" },
  card: { title: "Lawn and cleaning", text: "Past customers back on your schedule. First 150 free, then $497 a month if you say yes." },
};

export const ONE_PASS: OfferWords = {
  offer: "one_pass",
  button: "Get my first note",
  priceLine: "$250 per booked job, never more than $1,000",
  sticky: ["$250 per booked job", "never more than $1,000"],
  consent: `${MONTHLY.consent} I'll pay $250 for each job that books from these notes (the customer wrote back and booked within 60 days), never more than $1,000. No card now.`,
  sendUs: "Send us the exports and we'll have the first note ready for you to read within one business day.",
  forward: "Forward those emails, as they are, to",
  picker: { jobber: "Emails you two files", housecall_pro: "Forward two reports", other: "Any export or spreadsheet" },
  card: { title: "Tree, painting and fence", text: "One pass through your old quotes and past customers. $250 per booked job, never more than $1,000." },
  pay: { each: 250, cap: 4 },
};

export interface Slider {
  label: string;
  min: number;
  max: number;
  step: number;
  /** An example: the page labels it one until he slides it, or a link sets it. */
  value: number;
  money?: boolean;
}

export interface SitePage {
  /** The path ("/lawn"), the folder its index.html lives in, and the page's name in `ref`. */
  id: string;
  /** The link on the front page's card. */
  name: string;
  /** Built, but no page links to it yet (fence, until January). */
  unlinked?: true;
  trade: TradeId;
  words: OfferWords;
  /** Placeholder in the company field. */
  companyExample: string;
  /**
   * The hero's "Works from your export" strip: software names as plain text (no logos), each one the page's own FAQ
   * already says works, last the catch-all.
   */
  works: string[];
  /** In page order; the first one leads (the hero's tally, the calculator's rate). */
  proofs: Proof[];
  /**
   * `estimate`: shown only when a link's ?q= set the count, which then comes from his public reviews, not his list.
   * `result`: what the sum counts, when it isn't jobs booked and the money left on the table.
   * `perYear`: the job slider is a regular's year, not a job, so a link's ?j= (his average job) leaves it alone.
   */
  calc: { count: Slider; job: Slider; rateLine: string; rateLabel: string; fine: string; estimate?: string; result?: { jobs: string; value: string }; perYear?: true };
  /** Step 1 after the form, by software. Trusted HTML; menu paths only from the vendor's own help pages. */
  exportStep: Record<Software, string>;
  /** The question Jack texts after the form, said in its last step (/cleaning: how many new regulars he can take). */
  ask?: string;
  /** What a one-pass page calls its quotes ("estimates" on /painting), in the result of a file he drops. */
  quotes?: "quotes" | "estimates";
}

/** A monthly page's past visits: one report from Jobber or Housecall Pro. */
const PAST_VISITS = {
  // help.getjobber.com: Visits Report ("Insights > Reports … Visits under Work reports", "Export to CSV", emailed to the login address)
  jobber: "In Jobber: <b>Insights &rarr; Reports &rarr; Visits &rarr; All time &rarr; Export to CSV.</b> It doesn't download; Jobber emails it to your login address.",
  // help.housecallpro.com: How to Import & Export Jobs and Customers
  housecall_pro: "In Housecall Pro: <b>Jobs &rarr; Actions &rarr; Export &rarr; Send file.</b> It emails you the file.",
};

export const PAGES: SitePage[] = [
  {
    id: "lawn",
    name: "Lawn and landscaping",
    trade: "lawn",
    words: MONTHLY,
    companyExample: "Ridgeline Landscaping",
    works: ["Jobber", "Housecall Pro", "Service Autopilot", "Yardbook", "LMN", "Aspire", "QuickBooks", "Any spreadsheet"],
    proofs: [CAPITAL, NELSON, DOWS],
    calc: {
      count: { label: "Customers who haven't booked this season", min: 50, max: 1500, step: 10, value: 300 },
      job: { label: "Your average job", min: 150, max: 4000, step: 50, value: 650, money: true },
      rateLine: "If they book like Capital City's customers did:",
      rateLabel: "book again when asked",
      fine: "Capital City Landscaping, NH: 17 booked out of 150 asked. Your first 150 show your real number.",
    },
    exportStep: {
      ...PAST_VISITS,
      other: "Export your customers or visits, with dates and emails, from whatever you use, as a CSV or spreadsheet. Not sure how? Reply to our text and we'll walk you through it.",
    },
  },
  {
    id: "cleaning",
    name: "House cleaning",
    trade: "cleaning",
    words: MONTHLY,
    companyExample: "Ridgeline Cleaning",
    works: ["Jobber", "Housecall Pro", "ZenMaid", "BookingKoala", "Launch27", "Any spreadsheet"],
    proofs: [LANDSCAPER, { ...NELSON, otherTrade: "a fence company's old quotes" }, { ...DOWS, otherTrade: "a tree company's old quotes" }],
    calc: {
      // 100 regulars held steady, losing the churn claims.ts gives every month for a year: about 80
      count: { label: "Regulars lost in the last year", min: 10, max: 400, step: 5, value: Math.round((figure("cleaning-churn") * 12) / 10) * 10 },
      job: { label: "What a regular pays you a year", min: 1000, max: 15000, step: 10, value: figure("cleaning-regular-value"), money: true },
      rateLine: "If they come back like a landscaper's past customers did:",
      rateLabel: "come back when asked",
      fine: "Capital City Landscaping, NH, a landscaper: 17 booked out of 150 past customers asked. Your first 150 show your real number.",
      result: { jobs: "regulars back", value: "a year, back on your schedule" },
      perYear: true,
    },
    exportStep: {
      ...PAST_VISITS,
      // BookingKoala, Launch27 and ZenMaid each take their own clicks (ZenMaid's only on its top plan), so Jack texts them
      other: "Send any export of your clients with their last cleaning date and email. We'll text you where to click.",
    },
    ask: "One question we'll text you: how many new regulars can you take this month? We pace the notes to that.",
  },
  {
    id: "tree",
    name: "Tree service",
    trade: "tree",
    words: ONE_PASS,
    companyExample: "Ridgeline Tree Co.",
    works: ["Jobber", "Housecall Pro", "Any spreadsheet"],
    proofs: [NELSON, DOWS, LANDSCAPER],
    calc: {
      count: { label: "Quotes that never booked", min: 50, max: 3000, step: 10, value: 600 },
      job: { label: "Your average job", min: 300, max: 10000, step: 50, value: 2650, money: true },
      rateLine: "If they book like Nelson Fence's quotes did:",
      rateLabel: "book when asked",
      fine: "Nelson Fence, CT: 4 booked out of their first 150 old quotes. Older quotes book less often; your list shows your real rate.",
      estimate: "Quote count: estimated from your public Google reviews. Your export gives the real count.",
    },
    exportStep: oldQuotes("quotes"),
    quotes: "quotes",
  },
  {
    id: "painting",
    name: "Painting",
    trade: "painting",
    words: ONE_PASS,
    companyExample: "Ridgeline Painting",
    works: ["Jobber", "Housecall Pro", "Any spreadsheet"],
    proofs: [{ ...NELSON, otherTrade: "a fence company's old quotes: different trade, same kind of list" }, LANDSCAPER],
    calc: {
      count: { label: "Estimates that never booked", min: 50, max: 2000, step: 10, value: 400 },
      job: { label: "Your average job", min: 300, max: 15000, step: 50, value: 4500, money: true },
      rateLine: "If they book like Nelson Fence's quotes did:",
      rateLabel: "book when asked",
      fine: "Nelson Fence, CT, a fence company: 4 booked out of their first 150 old quotes. Older estimates book less often; your list shows your real rate.",
      estimate: "Estimate count: worked out from your public Google reviews. Your export gives the real count.",
    },
    exportStep: oldQuotes("estimates"),
    quotes: "estimates",
  },
  {
    id: "fence",
    name: "Fence",
    trade: "fence",
    words: ONE_PASS,
    unlinked: true,
    companyExample: "Ridgeline Fence",
    works: ["Jobber", "Housecall Pro", "Any spreadsheet"],
    proofs: [NELSON, DOWS, LANDSCAPER],
    calc: {
      count: { label: "Quotes that never booked", min: 50, max: 3000, step: 10, value: 500 },
      job: { label: "Your average job", min: 500, max: 20000, step: 50, value: 5500, money: true },
      rateLine: "If they book like Nelson Fence's quotes did:",
      rateLabel: "book when asked",
      fine: "Nelson Fence, CT: 4 booked out of their first 150 old quotes. Older quotes book less often; your list shows your real rate.",
      estimate: "Quote count: estimated from your public Google reviews. Your export gives the real count.",
    },
    exportStep: oldQuotes("quotes"),
    quotes: "quotes",
  },
];

/**
 * The violet ("Soro") pages, Oct 3, 2026: one page's words in a new look, each at a folder named for its job.
 * - `main-site`: the whole page, for quietaccounts.com itself. Company first, then his note, then the rest.
 * - `cold-email-page`: for owners who replied "show me" and tapped the link (quietaccounts.com/lawn?co=His+Company).
 *   His email already showed him the note, so the form is open from the start, with his company filled in.
 * Each has its own page id, so a sign-up's `ref` says which page it came from.
 */
export interface SiteView {
  /** The folder the view builds to and the page's name in `ref`: main-site, green-site, sky-tree... */
  id: string;
  /** Whose words it uses: an id in PAGES. */
  words: string;
  /** The form opens with every field showing (the cold email page). */
  open?: true;
}

/**
 * Three more looks Jack wants to try live (Oct 3, 2026), each a full site in a zip of its own: the green one for
 * landscapers, the explee-style one ("paper"), and the every-trade one ("sky"), whose trade picker leads to a page per
 * trade. Each look has a main page and a cold email page in /lawn's words; sky also has cleaning, tree, painting, fence.
 */
export const LOOKS: SiteView[] = [
  { id: "green-site", words: "lawn" },
  { id: "green-cold-email-page", words: "lawn", open: true },
  { id: "paper-site", words: "lawn" },
  { id: "paper-cold-email-page", words: "lawn", open: true },
  { id: "sky-site", words: "lawn" },
  { id: "sky-cold-email-page", words: "lawn", open: true },
  { id: "sky-cleaning", words: "cleaning" },
  { id: "sky-tree", words: "tree" },
  { id: "sky-painting", words: "painting" },
  { id: "sky-fence", words: "fence" },
];

export const VIEWS: SiteView[] = [
  { id: "main-site", words: "lawn" },
  { id: "cold-email-page", words: "lawn", open: true },
  ...LOOKS,
];

/** A view as a page: its words' page, under the view's own id. */
export function viewPage(v: SiteView): SitePage {
  const p = PAGES.find((x) => x.id === v.words);
  if (!p) throw new Error(`No page "${v.words}" in PAGES for view ${v.id}`);
  return { ...p, id: v.id };
}

/** A figure from packages/engine/src/claims.ts, never typed in here. */
function figure(id: string): number {
  const f = claim(id)?.figure;
  if (f === undefined) throw new Error(`No figure for "${id}" in packages/engine/src/claims.ts`);
  return f;
}

/** A one pass works the old quotes and the past customers: two reports from Jobber or Housecall Pro. */
function oldQuotes(quotes: "quotes" | "estimates"): SitePage["exportStep"] {
  return {
    // help.getjobber.com: Quotes Report ("Insights > Reports … Under Work Reports, select Quotes Report", "Drafted within" … "All time",
    // "Export to CSV", sent to the login address); the Visits Report as on /lawn
    jobber: "In Jobber: <b>Insights &rarr; Reports &rarr; Quotes Report &rarr; All time &rarr; Export to CSV</b>, then the same for <b>Visits</b>. They don't download; Jobber emails each one to your login address.",
    // help.housecallpro.com: Job & Estimate List Reporting ("Estimates tab", "Actions … Export … Send file"); How to Import & Export Jobs and Customers
    housecall_pro: "In Housecall Pro: <b>Estimates &rarr; Actions &rarr; Export &rarr; Send file</b>, then the same from <b>Jobs</b>. Each one emails you a file.",
    other: `Export your ${quotes} and past jobs, with dates, prices and emails, from whatever you use, as a CSV or spreadsheet. Not sure how? Reply to our text and we'll walk you through it.`,
  };
}
