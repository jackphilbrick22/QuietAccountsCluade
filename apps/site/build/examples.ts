import { addDays, emptyDataset, emptyState, footer, handoffText, readReply, renderNote, scan, type BusinessProfile, type Dataset, type Job } from "@qa/engine";

/**
 * The finished work the lawn page shows, written by the engine itself at build time: the first note to one lapsed
 * regular, and the text the owner gets when he writes back. Nothing here is hand-written copy; when the templates
 * change, the page changes with them. Only the customer and his reply are made up, and the page labels them "Example".
 */
const ASOF = "2026-10-06";
const REPLY_ON = "2026-10-08T09:12:00";
const REPLY = "Yes, put us back on. Same day as before works. Call me at 603-555-0187, mornings are best.";

/** The two things the page fills in as he types. The engine writes them as given, and never re-reads a filled value. */
export const SLOTS = { company: "{company}", signer: "{signer}" };
/** Stands in for his mailing address, which every note carries. */
export const ADDRESS = "[your business address]";

function dataset(company: string, signer: string): Dataset {
  const b: BusinessProfile = {
    id: "site-example",
    name: company,
    trade: "lawn",
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
    createdOn: ASOF,
  };
  const ds = emptyDataset(b, ASOF);
  ds.customers.push({ id: "c1", sourceIds: ["c1"], name: "Paul Bergeron", firstName: "Paul", lastName: "Bergeron", emails: ["paul@example.org"], phones: [], address: { street: "52 Pleasant St", city: "Concord", state: "NH", zip: "03301" }, properties: [], tags: [] });
  // weekly mowing every other week all last season, then nothing this year
  const jobs: Job[] = Array.from({ length: 16 }, (_, i) => ({ id: `j${i}`, customerId: "c1", title: "Weekly mowing", lineItems: [], total: 55, status: "completed", rawStatus: "Completed", completedOn: addDays("2025-11-01", -i * 14), recurring: true }));
  ds.jobs.push(...jobs);
  return ds;
}

function lapsed(ds: Dataset) {
  const result = scan(ds);
  const o = result.opportunities.find((x) => x.type === "lapsed_regular" && !x.suppressed);
  if (!o) throw new Error("The engine no longer finds the example's lapsed regular; update build/examples.ts.");
  return { result, o, c: ds.customers[0]! };
}

/** The first note, split where the engine adds the footer (name, mailing address, why, stop). */
export function exampleNote(company: string, signer: string): { main: string; foot: string } {
  const ds = dataset(company, signer);
  const { o, c } = lapsed(ds);
  const note = renderNote(o, c, { ds, sendOn: ASOF }, 1);
  if (!note) throw new Error("The engine wrote no first note for the example.");
  const foot = footer(ds.business, o.type);
  if (!note.body.endsWith(`\n\n${foot}`)) throw new Error("The note no longer ends with its footer.");
  return { main: note.body.slice(0, -foot.length - 2), foot };
}

/** The text the owner gets when the example customer writes back. */
export function exampleHandoff(): string {
  const ds = dataset("Example Landscaping", "Sarah");
  const { result, o } = lapsed(ds);
  const state = { ...emptyState(ds, `${ASOF}T09:00:00`), scan: result };
  const read = readReply({ text: REPLY, subject: "Re: the mowing", from: "paul@example.org", asOf: REPLY_ON.slice(0, 10) });
  return handoffText(state, { id: "site-example-reply", customerId: "c1", opportunityId: o.id, channel: "email", receivedAt: REPLY_ON, from: "paul@example.org", text: REPLY, intent: read.intent, confidence: read.confidence, extracted: read.extracted, status: "new" });
}
