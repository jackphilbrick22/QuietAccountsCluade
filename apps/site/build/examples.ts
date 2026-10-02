import { addDays, emptyDataset, emptyState, footer, handoffText, readReply, renderNote, scan, type BreakageType, type BusinessProfile, type Dataset, type ISODate, type Job, type Quote, type TradeId } from "@qa/engine";

/**
 * The finished work each page shows, written by the engine itself at build time: the first note to one example
 * customer, and the text the owner gets when he writes back. Nothing here is hand-written copy; when the templates
 * change, the pages change with them. Only the customer, his record and his reply are made up, and the pages label
 * them "Example". Each page has its own customer, so no page tells two stories about one person.
 */

/** The two things the page fills in as he types. The engine writes them as given, and never re-reads a filled value. */
export const SLOTS = { company: "{company}", signer: "{signer}" };
/** Stands in for his mailing address, which every note carries. */
export const ADDRESS = "[your business address]";

interface Example {
  /** The day the note goes out; his reply comes two days later, at 9:12. */
  asOf: ISODate;
  /** The id picks which of the engine's openers he gets: on painting, one that never says "quote". */
  customer: { id: string; first: string; last: string; street: string };
  /** What the engine must find him as. */
  types: BreakageType[];
  /** The record that makes him one. */
  records: (customerId: string) => { jobs?: Job[]; quotes?: Quote[] };
  subject: string;
  reply: string;
}

/** An old quote that never booked: sent `sentOn`, never answered. */
const oldQuote = (title: string, total: number, sentOn: ISODate) => (customerId: string) => ({
  quotes: [{ id: "q1", customerId, title, lineItems: [], total, status: "awaiting_response", rawStatus: "Awaiting response", sentOn, createdOn: sentOn, jobIds: [] } satisfies Quote],
});

const EXAMPLES: Partial<Record<TradeId, Example>> = {
  // a weekly-mowing regular all last season, every other week, then nothing this year
  lawn: {
    asOf: "2026-10-06",
    customer: { id: "c1", first: "Paul", last: "Bergeron", street: "52 Pleasant St" },
    types: ["lapsed_regular"],
    records: (customerId) => ({ jobs: Array.from({ length: 16 }, (_, i) => ({ id: `j${i}`, customerId, title: "Weekly mowing", lineItems: [], total: 55, status: "completed", rawStatus: "Completed", completedOn: addDays("2025-11-01", -i * 14), recurring: true })) }),
    subject: "Re: the mowing",
    reply: "Yes, put us back on. Same day as before works. Call me at 603-555-0187, mornings are best.",
  },
  // a regular every other Tuesday from March, the last of them September 1, then nothing: two months quiet by November
  cleaning: {
    asOf: "2026-11-03",
    customer: { id: "c1", first: "Nancy", last: "Gagnon", street: "17 Elm St" },
    types: ["lapsed_regular"],
    records: (customerId) => ({ jobs: Array.from({ length: 13 }, (_, i) => ({ id: `j${i}`, customerId, title: "Biweekly cleaning", lineItems: [], total: 215, status: "completed", rawStatus: "Completed", completedOn: addDays("2026-09-01", -i * 14), recurring: true })) }),
    subject: "Re: the regular cleaning",
    reply: "Yes, please put us back on. Every other Tuesday like before. Text me at 603-555-0152.",
  },
  tree: {
    asOf: "2026-10-20",
    customer: { id: "thibodeau", first: "Gail", last: "Thibodeau", street: "31 Birch Hill Rd" },
    types: ["unanswered_quote"],
    records: oldQuote("Remove leaning pine over garage", 2400, "2026-04-14"),
    subject: "Re: the pine over the garage",
    reply: "Yes, we still want the pine gone before the snow. Can you come by next week? Call me at 603-555-0164, after 4 is best.",
  },
  painting: {
    asOf: "2026-11-17",
    customer: { id: "joan-pelletier", first: "Joan", last: "Pelletier", street: "9 Maple Ave" },
    types: ["unanswered_quote"],
    records: oldQuote("Paint living room, hall and stairwell", 4200, "2026-03-09"),
    subject: "Re: the living room",
    reply: "Yes, we still want the living room and hall done. Any chance before Christmas? Best is 603-555-0171, evenings.",
  },
  fence: {
    asOf: "2027-01-12",
    customer: { id: "kowalski", first: "Rob", last: "Kowalski", street: "48 Hollis St" },
    types: ["unanswered_quote"],
    records: oldQuote("Cedar privacy fence, 140 ft, two gates", 7900, "2026-08-20"),
    subject: "Re: the privacy fence",
    reply: "Yes, we still want the fence. Can you come measure again? 603-555-0139 is my cell.",
  },
};

function example(trade: TradeId): Example {
  const ex = EXAMPLES[trade];
  if (!ex) throw new Error(`No example customer for ${trade} in build/examples.ts.`);
  return ex;
}

function dataset(trade: TradeId, company: string, signer: string): Dataset {
  const ex = example(trade);
  const b: BusinessProfile = {
    id: "site-example",
    name: company,
    trade,
    otherTrades: [],
    software: "jobber",
    ownerName: "",
    ownerFirstName: "",
    signerName: signer,
    signerRole: "office",
    mailingAddress: ADDRESS,
    state: "NH",
    timezone: "America/New_York",
    sendDays: [1, 2, 3, 4, 5],
    sendWindow: [7, 10],
    blackoutWeeks: [],
    minQuoteValue: 150,
    minQuoteAgeDays: 21,
    maxQuoteAgeMonths: 36,
    weeklyNewContacts: 75,
    openCrewWeeks: [],
    voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] },
    persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0 },
    channels: { email: "live" },
    plan: { stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [] },
    createdOn: ex.asOf,
  };
  const ds = emptyDataset(b, ex.asOf);
  const c = ex.customer;
  ds.customers.push({ id: c.id, sourceIds: [c.id], name: `${c.first} ${c.last}`, firstName: c.first, lastName: c.last, emails: [email(c)], phones: [], address: { street: c.street, city: "Concord", state: "NH", zip: "03301" }, properties: [], tags: [] });
  const { jobs = [], quotes = [] } = ex.records(c.id);
  ds.jobs.push(...jobs);
  ds.quotes.push(...quotes);
  return ds;
}

const email = (c: Example["customer"]) => `${c.first.toLowerCase()}@example.org`;

function found(trade: TradeId, ds: Dataset) {
  const ex = example(trade);
  const result = scan(ds);
  const o = result.opportunities.find((x) => ex.types.includes(x.type) && !x.suppressed);
  if (!o) throw new Error(`The engine no longer finds the ${trade} example's ${ex.types.join(" or ")}; update build/examples.ts.`);
  return { ex, result, o, c: ds.customers[0]! };
}

/** The first note, split where the engine adds the footer (name, mailing address, why, stop). */
export function exampleNote(trade: TradeId, company: string, signer: string): { main: string; foot: string } {
  const ds = dataset(trade, company, signer);
  const { ex, o, c } = found(trade, ds);
  const note = renderNote(o, c, { ds, sendOn: ex.asOf }, 1);
  if (!note) throw new Error(`The engine wrote no first note for the ${trade} example.`);
  const foot = footer(ds.business, o.type);
  if (!note.body.endsWith(`\n\n${foot}`)) throw new Error("The note no longer ends with its footer.");
  return { main: note.body.slice(0, -foot.length - 2), foot };
}

/** The text the owner gets when the example customer writes back. */
export function exampleHandoff(trade: TradeId): string {
  const ds = dataset(trade, "Example Co", "Sarah");
  const { ex, result, o, c } = found(trade, ds);
  const at = `${addDays(ex.asOf, 2)}T09:12:00`;
  const state = { ...emptyState(ds, `${ex.asOf}T09:00:00`), scan: result };
  const read = readReply({ text: ex.reply, subject: ex.subject, from: email(ex.customer), asOf: at.slice(0, 10) });
  return handoffText(state, { id: "site-example-reply", customerId: c.id, opportunityId: o.id, channel: "email", receivedAt: at, from: email(ex.customer), text: ex.reply, intent: read.intent, confidence: read.confidence, extracted: read.extracted, status: "new" });
}
