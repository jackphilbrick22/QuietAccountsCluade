import { describe, expect, it } from "vitest";
import { parseTable } from "../src/ingest/csv.ts";
import { detect } from "../src/ingest/detect.ts";
import { decodeText, emptyDataset, ingestFile } from "../src/ingest/index.ts";
import { parseDate, parseMoney, splitName, greetingName, humanAge, intervalWords, normalizePhone, extractPhones } from "../src/util.ts";
import type { BusinessProfile, QuoteStatus } from "../src/model.ts";

const biz: BusinessProfile = {
  id: "b1", name: "Ridgeline Tree Co", trade: "tree", otherTrades: [], software: "unknown", ownerName: "Dave Ridge", ownerFirstName: "Dave",
  signerName: "Sarah", signerRole: "office", timezone: "America/New_York", sendDays: [2, 3, 4], sendWindow: [8, 11], blackoutWeeks: [],
  minQuoteValue: 300, minQuoteAgeDays: 21, maxQuoteAgeMonths: 36, weeklyNewContacts: 50, channels: { email: "live" },
  openCrewWeeks: [], voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] }, persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0.1 },
  plan: { stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [] }, createdOn: "2026-09-01",
};

describe("util parsing", () => {
  it("parses the date formats exports contain", () => {
    expect(parseDate("2024-05-03")).toBe("2024-05-03");
    expect(parseDate("05/03/2024")).toBe("2024-05-03");
    expect(parseDate("5/3/24")).toBe("2024-05-03");
    expect(parseDate("May 3, 2024")).toBe("2024-05-03");
    expect(parseDate("Sept 14 2025 2:15 PM")).toBe("2025-09-14");
    expect(parseDate("3 March 2023")).toBe("2023-03-03");
    expect(parseDate("45415")).toBe("2024-05-03");
    expect(parseDate("2024-02-30")).toBeUndefined();
    expect(parseDate("")).toBeUndefined();
  });
  it("parses money", () => {
    expect(parseMoney("$2,650.00")).toBe(2650);
    expect(parseMoney("(120.50)")).toBe(-120.5);
    expect(parseMoney("USD 1 200")).toBe(1200);
    expect(parseMoney("")).toBeUndefined();
  });
  it("splits names and picks safe greetings", () => {
    expect(splitName("SMITH, JOHN")).toEqual({ first: "John", last: "Smith" });
    expect(splitName("Mr. John Q. Smith Jr.")).toEqual({ first: "John", last: "Smith" });
    expect(splitName("John & Mary Smith")).toEqual({ first: "John", last: "Smith" });
    expect(greetingName("J")).toBe("there");
    // households and initials have no first name to greet
    expect(splitName("Mr. and Mrs. Evans")).toEqual({ first: "", last: "Evans" });
    expect(splitName("Mr. & Mrs. John Evans")).toEqual({ first: "John", last: "Evans" });
    expect(splitName("Dr. Patel")).toEqual({ first: "", last: "Patel" });
    expect(splitName("J. Grant")).toEqual({ first: "", last: "Grant" });
    expect(splitName("J. Robert Grant")).toEqual({ first: "Robert", last: "Grant" });
    expect(splitName("Miller Family")).toEqual({ first: "", last: "Miller" });
    expect(splitName("The Smiths")).toEqual({ first: "", last: "Smiths" });
    for (const f of ["And", "&", "J.", "Mr.", "Mrs", "Mr. and Mrs.", "Dr.", "Family", "The"]) expect(greetingName(f)).toBe("there");
    expect(greetingName("Mr. John")).toBe("John");
    expect(greetingName("ACME LLC")).toBe("there");
    expect(greetingName("mike")).toBe("Mike");
  });
  it("says ages and intervals the way people do", () => {
    expect(humanAge(880)).toBe("2½ years");
    expect(humanAge(760)).toBe("2 years");
    expect(humanAge(1050)).toBe("3 years");
    expect(humanAge(500)).toBe("16 months");
    expect(humanAge(370)).toBe("a year");
    expect(intervalWords(12)).toBe("Once a year");
    expect(intervalWords(36)).toBe("Every 3 years");
    expect(intervalWords(30)).toBe("Every 2½ years");
    expect(intervalWords(6)).toBe("Every 6 months");
  });
  it("normalizes phones", () => {
    expect(normalizePhone("(603) 555-0142")).toBe("+16035550142");
    expect(normalizePhone("1-603-555-0142")).toBe("+16035550142");
    expect(normalizePhone("603.224.1234")).toBe("+16032241234");
    expect(normalizePhone("6032241234")).toBe("+16032241234");
    expect(normalizePhone(6032241234)).toBe("+16032241234");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("555-0142")).toBeUndefined();
    expect(normalizePhone("")).toBeUndefined();
    expect(normalizePhone(undefined)).toBeUndefined();
  });
  it("drops extensions instead of gluing them onto the number", () => {
    // used to come back as +603224123412 (a Malaysian-looking number)
    expect(normalizePhone("603-224-1234 ext. 12")).toBe("+16032241234");
    expect(normalizePhone("(603)224-1234x12")).toBe("+16032241234");
    expect(normalizePhone("603-224-1234 x 12")).toBe("+16032241234");
    expect(normalizePhone("Cell: 603-224-1234 (office)")).toBe("+16032241234");
    expect(extractPhones("603-224-1234 (ext 12)")).toEqual(["+16032241234"]);
    expect(extractPhones("603-224-1234 ext. 12")).toEqual(["+16032241234"]);
    // used to be dropped entirely
    expect(extractPhones("(603) 224-1234 ext 5 (office)")).toEqual(["+16032241234"]);
  });
  it("rejects placeholder and impossible numbers", () => {
    expect(normalizePhone("555-555-5555")).toBeUndefined();
    expect(normalizePhone("123-456-7890")).toBeUndefined();
    expect(normalizePhone("000-000-0000")).toBeUndefined();
    expect(normalizePhone("999-999-9999")).toBeUndefined();
    expect(extractPhones("555-555-5555")).toEqual([]);
    expect(extractPhones("123-456-7890; 603-224-1234")).toEqual(["+16032241234"]);
  });
  it("reads every real number in a cell, in order", () => {
    expect(extractPhones("603-224-1234; 603-555-0100 / 978-224-1111")).toEqual(["+16032241234", "+16035550100", "+19782241111"]);
    expect(extractPhones("home 603 224 1234 or cell (603) 555-0100")).toEqual(["+16032241234", "+16035550100"]);
    expect(extractPhones("603-224-1234, 603-224-1234")).toEqual(["+16032241234"]);
    expect(extractPhones("")).toEqual([]);
    expect(extractPhones(null)).toEqual([]);
  });
});

describe("decodeText", () => {
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  // "José O’Brien" in each encoding Excel writes
  const UTF8 = [...ascii("Jos"), 0xc3, 0xa9, ...ascii(" O"), 0xe2, 0x80, 0x99, ...ascii("Brien")];
  const CP1252 = [...ascii("Jos"), 0xe9, ...ascii(" O"), 0x92, ...ascii("Brien")];
  const UTF16LE = [0xff, 0xfe, ...[..."José O’Brien"].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])];
  const UTF16BE = [0xfe, 0xff, ...[..."José O’Brien"].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff])];

  it("reads UTF-8, with or without a BOM", () => {
    expect(decodeText(new Uint8Array(UTF8))).toBe("José O’Brien");
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...UTF8]))).toBe("José O’Brien");
    expect(decodeText(new Uint8Array(ascii("Name,Email\nBob,bob@x.com\n")))).toBe("Name,Email\nBob,bob@x.com\n");
    expect(decodeText(new Uint8Array([]))).toBe("");
  });
  it("falls back to Windows-1252 for Excel's classic CSV instead of producing �", () => {
    expect(decodeText(new Uint8Array(CP1252))).toBe("José O’Brien");
    // "Façade – 2 cedars" with 1252's en dash (0x96)
    expect(decodeText(new Uint8Array([...ascii("Fa"), 0xe7, ...ascii("ade "), 0x96, ...ascii(" 2 cedars")]))).toBe("Façade – 2 cedars");
  });
  it("reads UTF-16 by its BOM (Excel's Unicode Text)", () => {
    expect(decodeText(new Uint8Array(UTF16LE))).toBe("José O’Brien");
    expect(decodeText(new Uint8Array(UTF16BE))).toBe("José O’Brien");
  });
  it("gives the importer the real name, so the greeting reads 'Hi José'", () => {
    const csv = new Uint8Array([...ascii("Client name,Client email,Title,Total,Sent date\n"), ...CP1252, ...ascii(",jose@example.com,Oak removal,1200,2025-06-03\n")]);
    const { dataset } = ingestFile(emptyDataset(biz, "2026-09-29"), decodeText(csv), "quotes.csv", "2026-09-29T12:00:00Z");
    expect(dataset.customers[0]!.name).toBe("José O’Brien");
    expect(greetingName(dataset.customers[0]!.firstName)).toBe("José");
  });
});

const JOBBER_QUOTES = `Quotes Report
Date range: All time
Quote #,Client name,Client email,Client phone,Property,Title,Status,Created date,Sent date,Approved date,Converted date,Total ($),Salesperson
1042,Mike Sanderson,MIKE.S@gmail.com,(603) 555-0142,"14 Oak Ln, Concord, NH 03301",Oak removal + stump,Awaiting response,2025-06-02,2025-06-03,,,"$9,400.00",Dave Ridge
1043,"Alvarez, Tom",talvarez@yahoo.com,603-555-0199,"88 Pine St, Bow, NH 03304",Two pines over garage,Archived,2025-01-10,2025-01-11,,,"4,850.00",Dave Ridge
1044,Kara Whitfield,kara@whitfield.net,,"3 Maple Ct, Concord, NH 03301","Crown thinning, 3 maples",Converted,2025-04-01,2025-04-02,2025-04-09,2025-04-10,2200,Dave Ridge
1045,Gail Ortiz,,6035550100,"9 Elm Rd, Hopkinton, NH 03229",Hazard ash near house,Changes requested,2025-08-01,2025-08-01,,,3100,Dave Ridge
Totals,,,,,,,,,,,"19,550.00",
`;

describe("ingest", () => {
  it("finds the header under a report title and maps Jobber columns", () => {
    const t = parseTable(JOBBER_QUOTES);
    expect(t.headers[0]).toBe("Quote #");
    expect(t.rows).toHaveLength(4);
    const d = detect(t, "Quotes Report.csv");
    expect(d.kind).toBe("quote");
    expect(d.source).toBe("jobber");
    const f = d.mapping.fields;
    expect(t.headers[f.email!]).toBe("Client email");
    expect(t.headers[f.name!]).toBe("Client name");
    expect(t.headers[f.total!]).toBe("Total ($)");
    expect(t.headers[f.number!]).toBe("Quote #");
    expect(t.headers[f.address!]).toBe("Property");
    expect(t.headers[f.sentOn!]).toBe("Sent date");
    expect(t.headers[f.approvedOn!]).toBe("Approved date");
    expect(t.headers[f.convertedOn!]).toBe("Converted date");
  });

  it("builds customers and quotes with canonical statuses", () => {
    const { dataset, record } = ingestFile(emptyDataset(biz, "2026-09-29"), JOBBER_QUOTES, "Quotes Report.csv", "2026-09-29T12:00:00Z");
    expect(record.accepted).toBe(4);
    expect(dataset.customers).toHaveLength(4);
    const byTitle = Object.fromEntries(dataset.quotes.map((q) => [q.title, q]));
    expect(byTitle["Oak removal + stump"]!.status).toBe("awaiting_response");
    expect(byTitle["Oak removal + stump"]!.total).toBe(9400);
    expect(byTitle["Two pines over garage"]!.status).toBe("archived");
    expect(byTitle["Crown thinning, 3 maples"]!.status).toBe("converted");
    expect(byTitle["Hazard ash near house"]!.status).toBe("changes_requested");
    const tom = dataset.customers.find((c) => c.emails.includes("talvarez@yahoo.com"))!;
    expect(tom.firstName).toBe("Tom");
    expect(tom.address?.city).toBe("Bow");
    expect(dataset.business.software).toBe("jobber");
  });

  it("households and initials come through with no first name, so notes say 'Hi there'", () => {
    const CSV = `Quote #,Client name,Client email,Property,Title,Status,Sent date,Total ($)
2001,Mr. and Mrs. Evans,evans@gmail.com,"4 Ash St, Concord, NH 03301",Spruce out back,Awaiting response,2026-06-02,1400
2002,J. Grant,jgrant@gmail.com,"5 Ash St, Concord, NH 03301",Birch by driveway,Awaiting response,2026-06-02,1400
2003,Miller Family,miller@gmail.com,"6 Ash St, Concord, NH 03301",Oak removal,Awaiting response,2026-06-02,1400
`;
    const { dataset } = ingestFile(emptyDataset(biz, "2026-09-29"), CSV, "Quotes Report.csv", "2026-09-29T12:00:00Z");
    expect(dataset.customers.map((c) => [c.firstName, greetingName(c.firstName)])).toEqual([["", "there"], ["", "there"], ["", "there"]]);
  });

  it("merges a second file into the same customers and links jobs to quotes", () => {
    let { dataset } = ingestFile(emptyDataset(biz, "2026-09-29"), JOBBER_QUOTES, "Quotes Report.csv", "2026-09-29T12:00:00Z");
    const JOBS = `Job #,Client name,Client email,Title,Job status,Created date,Completed date,Total,Quote #
501,Kara Whitfield,kara@whitfield.net,"Crown thinning, 3 maples",Archived,2025-04-10,2025-04-20,2200,1044
502,Mike Sanderson,mike.s@gmail.com,Oak removal,Completed,2026-09-01,2026-09-10,9400,
`;
    ({ dataset } = ingestFile(dataset, JOBS, "Jobs Report.csv", "2026-09-29T12:05:00Z"));
    expect(dataset.customers).toHaveLength(4);
    expect(dataset.jobs).toHaveLength(2);
    const kara = dataset.quotes.find((q) => q.number === "1044")!;
    expect(kara.jobIds).toHaveLength(1);
    // the oak job came 15 months later with no quote #: that's a comeback, not a conversion
    const mike = dataset.quotes.find((q) => q.number === "1042")!;
    expect(mike.jobIds).toHaveLength(0);
    expect(mike.status).toBe("awaiting_response");
  });

  it("reads a messy owner spreadsheet", () => {
    const SHEET = `Name\tEmail\tPhone\tAddress\tJob\tPrice\tDate\tNotes
bob jones\tbob@jones.com\t603.555.0111\t12 River Rd\tstump grinding x3\t$450\t3/14/25\tsaid call back in spring
`;
    const { dataset, detection } = ingestFile(emptyDataset(biz, "2026-09-29"), SHEET, "old estimates.xlsx.csv", "2026-09-29T12:00:00Z");
    expect(detection.kind).toBe("quote");
    expect(dataset.quotes[0]!.total).toBe(450);
    expect(dataset.quotes[0]!.title).toBe("stump grinding x3");
    expect(dataset.customers[0]!.name).toBe("Bob Jones");
  });
});

/**
 * Fence and painting quotes mostly don't live in Jobber: Estimate Rocket, QuickBooks estimates, PaintScout, DripJobs,
 * Fence Cloud, Housecall Pro, Markate and owners' own sheets. A misread status decides who gets followed up — an open
 * quote read as "approved" or "converted" silently drops out — so each tool's words are pinned here.
 */
describe("status words from the tools fence and painting quotes live in", () => {
  const read = (csv: string, fileName = "estimates.csv") => {
    const { dataset, detection } = ingestFile(emptyDataset(biz, "2026-09-29"), csv, fileName, "2026-09-29T12:00:00Z", { kind: "quote" });
    return { status: dataset.quotes[0]!.status, source: detection.source };
  };

  // An owner's sheet, or an export from a tool with no reader of its own: taken as a spreadsheet.
  const sheet = (status: string) => `Name,Email,Work,Status,Sent,Price\nPat Doe,pat@doe.com,Exterior repaint,${status},2026-03-02,4200\n`;
  it.each<[string, QuoteStatus]>([
    // sent, no decision
    ["Unsigned", "awaiting_response"], // Estimate Rocket's open status is not a signature
    ["Pending", "awaiting_response"],
    ["Open", "awaiting_response"],
    ["Sent", "awaiting_response"],
    ["Viewed", "awaiting_response"],
    ["Proposal Sent", "awaiting_response"], // DripJobs
    ["Not viewed", "awaiting_response"],
    ["Viewed - not signed", "awaiting_response"],
    ["Pending approval", "awaiting_response"],
    ["Signature requested", "awaiting_response"],
    ["No response", "awaiting_response"],
    ["On hold", "awaiting_response"],
    ["Waiting on HOA", "awaiting_response"],
    ["Assigned", "awaiting_response"], // no word we know: read from the sent date, never as "signed"
    // never went out
    ["Not sent", "draft"],
    ["Unsent", "draft"],
    ["Draft", "draft"],
    ["Incomplete", "draft"],
    ["New Lead", "draft"], // DripJobs
    ["Appointment Scheduled", "draft"], // DripJobs: the visit to look, not the job
    ["Estimate scheduled", "draft"],
    // said yes, and nothing says it's on the calendar
    ["Accepted", "approved"],
    ["Approved", "approved"],
    ["Signed", "approved"],
    ["Won", "approved"],
    ["Closed won", "approved"],
    ["Closed - Won", "approved"],
    ["Unscheduled", "approved"],
    ["Needs scheduling", "approved"],
    ["Awaiting deposit", "approved"],
    ["Deposit due", "approved"],
    // a no
    ["Rejected", "declined"],
    ["Declined", "declined"],
    ["Lost", "declined"],
    ["Closed lost", "declined"],
    ["Expired", "expired"],
    // the work exists
    ["Converted", "converted"],
    ["Invoiced", "converted"],
    ["Scheduled", "converted"],
    ["Paid", "converted"],
    ["Deposit paid - scheduled", "converted"],
    ["Project Complete", "converted"],
    ["Sold", "converted"],
    ["Changes", "changes_requested"], // Estimate Rocket
    ["Changes requested", "changes_requested"],
    ["Cancelled", "archived"],
    ["Archived", "archived"],
    ["Void", "archived"],
    // a negation is never a yes, whatever word follows it ("Sold / Not sold" painting and fence sheets)
    ["Not sold", "declined"],
    ["Not Sold", "declined"],
    ["Unsold", "declined"],
    ["No sale", "declined"],
    ["Closed - not sold", "declined"],
    ["Not yet sold", "awaiting_response"],
    ["Not booked", "awaiting_response"],
    ["Unbooked", "awaiting_response"],
    ["Not converted", "awaiting_response"],
    ["Not completed", "awaiting_response"],
    ["Not closed", "awaiting_response"],
    ["Booked", "approved"],
    // a phone's curly apostrophe: "Won’t proceed" is not a win
    ["Won’t proceed", "awaiting_response"],
    ["Won't proceed", "awaiting_response"],
  ])("a sheet's %s reads as %s", (status, want) => {
    expect(read(sheet(status))).toEqual({ status: want, source: "spreadsheet" });
  });

  // When the status starts with a no, the no decides; after a yes, a trailing "not booked" only says the work isn't on
  // the calendar. And a sale that hasn't happened yet is still open. Quoted, since some carry a comma.
  it.each<[string, QuoteStatus]>([
    // a yes, still to schedule: never open, never converted
    ["Accepted - not booked", "approved"],
    ["Approved - not booked", "approved"],
    ["Approved - not scheduled", "approved"],
    ["Sold - not completed", "approved"], // said yes, work not done
    ["Deposit paid - not booked", "approved"],
    ["Won - not scheduled", "approved"],
    // a no, whatever follows it, even a "not signed" or "never viewed" that would otherwise read as still open
    ["Lost - not booked", "declined"],
    ["Declined - not booked", "declined"],
    ["Rejected - not scheduled", "declined"],
    ["Lost - not signed", "declined"],
    ["Lost - never signed", "declined"],
    ["Declined - unsigned", "declined"],
    ["Declined - not signed", "declined"],
    ["Declined - not accepted", "declined"],
    ["Rejected - not accepted", "declined"],
    ["Rejected - not approved by HOA", "declined"],
    ["Lost - never viewed", "declined"],
    ["Declined - never opened", "declined"],
    // a yes followed by "not signed" is still waiting on the signature
    ["Approved - not signed", "awaiting_response"],
    // not sold yet is still open
    ["Not sold yet", "awaiting_response"],
    ["Not yet sold", "awaiting_response"],
    ["Pending - not sold", "awaiting_response"],
    ["Pending, not sold", "awaiting_response"],
    ["Opened, not sold", "awaiting_response"],
    // and so is one still waiting, whichever side of the "not sold" the waiting is written on
    ["Not sold - pending", "awaiting_response"],
    ["Not Sold (Pending)", "awaiting_response"],
    ["Not sold (no response)", "awaiting_response"],
    ["Not sold - no response yet", "awaiting_response"],
    ["Not sold - following up", "awaiting_response"],
    ["Not sold - waiting on HOA", "awaiting_response"],
    ["Not sold - pending financing", "awaiting_response"],
    ["Not sold - still thinking", "awaiting_response"],
    ["Not sold - call back in spring", "awaiting_response"],
    ["Not sold as of yet", "awaiting_response"],
    ["No response - not sold", "awaiting_response"],
    ["Quoted - not sold", "awaiting_response"],
    ["Emailed - not sold", "awaiting_response"],
    ["Follow up - not sold", "awaiting_response"],
    ["On hold - not sold", "awaiting_response"],
    ["Outstanding - not sold", "awaiting_response"],
    ["Resent - not sold", "awaiting_response"],
    ["Reopened - not sold", "awaiting_response"],
    ["Sent - not sold (no response)", "awaiting_response"],
    ["No response", "awaiting_response"],
    // unless a no is written anywhere in it
    ["Sent - Not Sold - Lost to competitor", "declined"],
    ["Viewed - not signed - went with competitor", "declined"],
    // the option they bought is not a competitor
    ["Sold - went w/ black vinyl", "converted"],
    ["Approved - went w/ Better package", "approved"],
    ["Won - went w/ option B", "approved"],
    ["Accepted - went w/ 6ft cedar", "approved"],
    ["Signed - went w/ us", "approved"],
    ["Sold - went with option 2 - awaiting deposit", "approved"],
    ["Won - went with cedar - needs scheduling", "approved"],
    ["Approved - went with premium package - not booked", "approved"],
    ["Won - chose another color - needs scheduling", "approved"],
    ["Won - went with another company", "declined"],
    // a price reason after "not sold" is a no, not a wait
    ["Not sold - competitor quoted lower", "declined"],
    ["No sale - quoted too high", "declined"],
    ["Not sold - we quoted too high", "declined"],
    ["Not sold - estimated too high", "declined"],
    ["Not sold - considered too pricey", "declined"],
    ["Not sold - presented 3 options, went cheaper elsewhere", "declined"],
    // asked for a new price, or got one: still open
    ["Too expensive - revision requested", "changes_requested"],
    ["Price too high - changes requested", "changes_requested"],
    ["Too expensive - needs revision", "changes_requested"],
    ["Declined - changes requested", "changes_requested"],
    ["Rejected - requested changes", "changes_requested"],
    ["Price too high - sent revised quote", "awaiting_response"],
    ["Price too high - revised quote sent", "awaiting_response"],
    // a postponement is not a no
    ["Not moving forward yet - waiting on insurance", "awaiting_response"],
    ["Not moving forward until spring", "awaiting_response"],
    ["Not proceeding yet", "awaiting_response"],
    ["Lost contact - following up", "awaiting_response"],
    // an answer written after a revision is the later word; a leading yes keeps it
    ["Requoted - sold", "converted"],
    ["Revised quote sent - accepted", "approved"],
    ["Sent revised quote - signed", "approved"],
    ["Sent revised quote - declined", "declined"],
    ["Requoted - went with another company", "declined"],
    ["Requoted - lost to competitor", "declined"],
    ["Sold - requoted gate", "converted"],
    ["Changes requested - went with another company", "declined"],
    ["Revision requested - hired someone else", "declined"],
    ["Changes requested - closed lost", "declined"],
    // gone to someone else, however it's named, when it doesn't start with a yes
    ["Went with ABC Fence", "declined"],
    ["Went w/ Home Depot", "declined"],
    ["Went with lower bid", "declined"],
    ["Went with a different fence company", "declined"],
    ["Sent - went with Bob's Fence", "declined"],
    ["Viewed - went with lower bid", "declined"],
    ["Sold - went with the other option", "converted"],
    ["Won - went with another color - needs scheduling", "approved"],
    // our own lower price is not a no
    ["Quoted lower - sold", "converted"],
    ["Priced lower - accepted", "approved"],
    ["Quoted lower price - awaiting response", "awaiting_response"],
    ["Following up - quoted lower price", "awaiting_response"],
    // still open, written after the "not sold"
    ["Not sold - still considering", "awaiting_response"],
    ["Not sold - estimate sent", "awaiting_response"],
    ["Not sold - unreachable", "awaiting_response"],
    ["Not sold - outstanding", "awaiting_response"],
    // a yes that turned down an add-on is still a yes
    ["Approved - said no to the gate", "approved"],
    ["Accepted - no thanks on sealer", "approved"],
    ["Signed - not proceeding with phase 2", "approved"],
    ["Won - price too high for option A, took option B", "approved"],
    ["Sold - said no to gate add-on", "converted"],
    ["Sold - used another financing company", "converted"],
    ["Unsigned - hired someone else", "declined"],
    ["Sent - not sold - went with competitor", "declined"],
    ["Sent - Not sold (declined)", "declined"],
    ["Viewed - not sold - went with another company", "declined"],
    ["Opened, not sold - chose another contractor", "declined"],
    ["Sent / Not Sold / Hired someone else", "declined"],
    ["Estimate sent; customer declined - not sold", "declined"],
    ["Proposal sent - declined - no sale", "declined"],
    ["Pending - not sold - rejected", "declined"],
    ["Declined - sent, not sold", "declined"],
    ["Lost - estimate sent, not sold", "declined"],
    ["Lost - not sold yet", "declined"],
    ["Declined - not sold yet", "declined"],
    // every no the declined rule hears, and the reasons owners write for one
    ["Sent - customer said no", "declined"],
    ["Sent - not sold - customer said no", "declined"],
    ["Sent, not sold, HOA denied", "declined"],
    ["Sent - not sold - did not win", "declined"],
    ["Sent - not sold - disapproved", "declined"],
    ["Sent - not sold - price too high", "declined"],
    ["Sent - not sold - too expensive", "declined"],
    ["Sent - not sold - chose competitor", "declined"],
    ["Sent - not sold - hired a competitor", "declined"],
    ["Sent - not sold - went w/ competitor", "declined"],
    ["Sent - not sold - used another company", "declined"],
    ["Sent - not sold - not moving forward", "declined"],
    ["Sent - not sold - no thanks", "declined"],
    ["Sent - not sold - wife said no", "declined"],
    // closed out: nobody is waiting on it
    ["Sent - not sold - cancelled", "declined"],
    // unchanged
    ["Not sold", "declined"],
    ["Not Sold", "declined"],
    ["Unsold", "declined"],
    ["No sale", "declined"],
    ["Closed - not sold", "declined"],
    ["Not sent", "draft"],
    ["Unsigned", "awaiting_response"],
    ["Viewed - not signed", "awaiting_response"],
    ["Not booked", "awaiting_response"],
    ["Not converted", "awaiting_response"],
    ["Awaiting deposit", "approved"],
    ["Won't proceed", "awaiting_response"],
    ["Won’t proceed - not booked", "awaiting_response"],
    ["Not approved - not booked", "awaiting_response"],
    ["Closed won", "approved"],
  ])("a sheet's %s reads as %s, the leading word deciding", (status, want) => {
    expect(read(sheet(`"${status}"`))).toEqual({ status: want, source: "spreadsheet" });
  });

  const quickbooks = (status: string) =>
    `Date,Transaction type,Num,Customer,Email,Memo/Description,Amount,Estimate status,Expiration date\n03/02/2026,Estimate,1045,Pat Doe,pat@doe.com,160 ft cedar privacy,7850.00,${status},04/01/2026\n`;
  it.each<[string, QuoteStatus]>([
    ["Pending", "awaiting_response"],
    ["Accepted", "approved"],
    // a QuickBooks estimate is Closed once it's been turned into an invoice
    ["Closed", "converted"],
    ["Converted", "converted"],
    ["Rejected", "declined"],
    ["Expired", "expired"],
  ])("a QuickBooks estimate marked %s reads as %s", (status, want) => {
    expect(read(quickbooks(status))).toEqual({ status: want, source: "quickbooks" });
  });

  const hcp = (status: string, outcome: string) =>
    `Estimate #,Customer,Email,Description,Status,Outcome,Created date,Total\n3310,Pat Doe,pat@doe.com,Interior - 3 rooms,${status},${outcome},2026-03-02,2400\n`;
  it.each<[string, string, QuoteStatus]>([
    // Housecall Pro's Status is the estimate visit; Outcome is the decision, and it wins
    ["Completed", "Open", "awaiting_response"],
    ["Completed", "Won", "approved"],
    ["Completed", "Copied to job", "converted"],
    // Housecall Pro closes estimates out itself after its reminders: not a customer's no
    ["Completed", "Lost", "archived"],
    ["Scheduled", "", "awaiting_response"],
    ["Unscheduled", "", "awaiting_response"],
  ])("a Housecall Pro estimate with status %s and outcome %s reads as %s", (status, outcome, want) => {
    expect(read(hcp(status, outcome))).toEqual({ status: want, source: "housecall_pro" });
  });

  it("keeps both words for the evidence line when a file has a status and an outcome", () => {
    const { dataset } = ingestFile(emptyDataset(biz, "2026-09-29"), hcp("Completed", "Won"), "estimates.csv", "2026-09-29T12:00:00Z", { kind: "quote" });
    expect(dataset.quotes[0]!.rawStatus).toBe("Completed · Won");
  });

  it("a job waiting on a date or a deposit is unscheduled work, and a request waiting on a price is not converted", () => {
    const jobs = `Job #,Client name,Client email,Title,Job status,Created date,Total\n${["Unscheduled", "Needs scheduling", "Awaiting deposit", "Deposit due", "Scheduled"].map((s, i) => `${700 + i},Pat Doe,pat@doe.com,Cedar privacy,${s},2026-08-01,7850`).join("\n")}\n`;
    const { dataset: dj } = ingestFile(emptyDataset(biz, "2026-09-29"), jobs, "Jobs Report.csv", "2026-09-29T12:00:00Z", { kind: "job" });
    expect(dj.jobs.map((j) => j.status)).toEqual(["unscheduled", "unscheduled", "unscheduled", "unscheduled", "scheduled"]);
    const reqs = `Request #,Client name,Client email,Request title,Status,Requested on date\n${["Needs quote", "Estimate requested", "Estimate scheduled", "Converted", "New"].map((s, i) => `${800 + i},Pat Doe,pat@doe.com,Fence,${s},2026-09-01`).join("\n")}\n`;
    const { dataset: dr } = ingestFile(emptyDataset(biz, "2026-09-29"), reqs, "Requests Report.csv", "2026-09-29T12:00:00Z", { kind: "request" });
    expect(dr.requests.map((r) => r.status)).toEqual(["new", "new", "assessment_scheduled", "converted", "new"]);
  });
});

describe("a status that says two things at once is held for a person", () => {
  it("flags mixed statuses and leaves plain ones alone", async () => {
    const { statusReadsTwoWays } = await import("../src/ingest/fields.ts");
    for (const mixed of ["Requoted - sold", "Approved - said no to the gate", "Declined - changes requested", "Too expensive - revision requested", "Sold - went w/ black vinyl", "Viewed - not signed - went with competitor"])
      expect(statusReadsTwoWays(mixed), mixed).toBe(true);
    for (const plain of ["Approved", "Awaiting response", "Changes requested", "Converted", "Draft", "Archived", "Unsigned", "Not sold", "Not sold yet", "Pending - not sold", "Approved - awaiting deposit", "Won - needs scheduling", "Sent", "Lost", "Went with ABC Fence", "Completed · Won", "Lost contact - following up"])
      expect(statusReadsTwoWays(plain), plain).toBe(false);
  });
});
