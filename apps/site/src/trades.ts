import type { TradeId } from "@qa/engine";

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

/** The words that come with an offer: the one button, the price line beside it, the consent box, the front-page card. */
export interface OfferWords {
  offer: Offer;
  button: string;
  priceLine: string;
  /** The sticky bar on phones: the price, then its small line. */
  sticky: [string, string];
  /** {company} is what he typed. */
  consent: string;
  card: { title: string; text: string };
}

export const MONTHLY: OfferWords = {
  offer: "monthly",
  button: "Start my free 150",
  priceLine: "then $497/mo if you say yes",
  sticky: ["First 150 free", "then $497/mo if you say yes"],
  consent: "I run {company}. Quiet Accounts can write to my past customers in my company's name and text me at this number about it. Msg & data rates may apply. Reply STOP to stop.",
  card: { title: "Lawn and cleaning", text: "Past customers back on your schedule. First 150 free, then $497 a month if you say yes." },
};

/** Only the front page's card until the one-pass pages are built (B1). */
export const ONE_PASS_CARD: OfferWords["card"] = {
  title: "Tree, painting and fence",
  text: "One pass through your old quotes and past customers. $250 per booked job, never more than $1,000.",
};

export interface Slider {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  money?: boolean;
}

export interface SitePage {
  /** The path ("/lawn"), the folder its index.html lives in, and the page's name in `ref`. */
  id: string;
  /** The link on the front page's card. */
  name: string;
  trade: TradeId;
  words: OfferWords;
  /** Placeholder in the company field. */
  companyExample: string;
  /** In page order; the first one leads (the hero's tally, the calculator's rate). */
  proofs: Proof[];
  calc: { count: Slider; job: Slider; rateLine: string; rateLabel: string; fine: string };
  /** Step 1 after the form, by software. Trusted HTML; menu paths only from the vendor's own help pages. */
  exportStep: Record<Software, string>;
}

export const PAGES: SitePage[] = [
  {
    id: "lawn",
    name: "Lawn and landscaping",
    trade: "lawn",
    words: MONTHLY,
    companyExample: "Ridgeline Landscaping",
    proofs: [CAPITAL, NELSON, DOWS],
    calc: {
      count: { label: "Customers who haven't booked this season", min: 50, max: 1500, step: 10, value: 300 },
      job: { label: "Your average job", min: 150, max: 4000, step: 50, value: 650, money: true },
      rateLine: "If they book like Capital City's customers did:",
      rateLabel: "book again when asked",
      fine: "Capital City Landscaping, NH: 17 booked out of 150 asked. Your first 150 show your real number.",
    },
    exportStep: {
      // help.getjobber.com: Visits Report ("Insights > Reports … Visits under Work reports", "Export to CSV", emailed to the login address)
      jobber: "In Jobber: <b>Insights &rarr; Reports &rarr; Visits &rarr; All time &rarr; Export to CSV.</b> It doesn't download; Jobber emails it to your login address.",
      // help.housecallpro.com: How to Import & Export Jobs and Customers
      housecall_pro: "In Housecall Pro: <b>Jobs &rarr; Actions &rarr; Export &rarr; Send file.</b> It emails you the file.",
      other: "Export your customers or visits, with dates and emails, from whatever you use, as a CSV or spreadsheet. Not sure how? Reply to our text and we'll walk you through it.",
    },
  },
];
