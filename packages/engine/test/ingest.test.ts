import { describe, expect, it } from "vitest";
import { parseTable } from "../src/ingest/csv.ts";
import { detect } from "../src/ingest/detect.ts";
import { decodeText, emptyDataset, ingestFile, mergePulled } from "../src/ingest/index.ts";
import { parseDate, parseMoney, splitName, greetingName, humanAge, intervalWords, normalizePhone, extractPhones, makeId } from "../src/util.ts";
import type { BusinessProfile, Dataset, QuoteStatus } from "../src/model.ts";
import { scan } from "../src/breakage/detect.ts";
import { customer, job } from "./fixtures.ts";

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

describe("record ids", () => {
  const T = "2026-09-29T12:00:00Z";
  it("are the ids every stored account already has: the same parts always give the same id", () => {
    // pinned: ids are stored keys, so the scheme must not drift
    expect(makeId("q", "jobber", "1042")).toBe("q_8awkyo");
    expect(makeId("j", "jobber", "55")).toBe("j_1wq4a0l");
    expect(makeId("q", "jobber", "1042")).toBe(makeId("q", "jobber", 1042));
    expect(makeId("c", "a", "b")).not.toBe(makeId("c", "b", "a"));
  });

  it("a record stored under its id is updated in place by a re-import and a re-pull, never copied", () => {
    // an account saved earlier: Jobber job #55, $650, already on the ledger under the id it has always had
    const stored: Dataset = {
      ...emptyDataset(biz, "2026-09-29"),
      customers: [customer("c_al", { sourceIds: ["jobber:Z2lkQWw="], name: "Al Finch", firstName: "Al", lastName: "Finch", emails: ["al@gmail.com"] })],
      jobs: [job("j_1wq4a0l", "c_al", { sourceId: "Z2lkNTU=", number: "55", title: "Maple pruning", total: 650, status: "scheduled", rawStatus: "upcoming", createdOn: "2026-08-01", scheduledOn: "2026-09-02", completedOn: undefined })],
    };
    const JOBS = "Job #,Client name,Client email,Title,Job status,Created date,Total\n55,Al Finch,al@gmail.com,Maple pruning,Completed,2026-08-01,650\n";
    const reimported = ingestFile(stored, JOBS, "Jobs Report.csv", T).dataset;
    expect(reimported.jobs.map((j) => [j.id, j.status, j.total])).toEqual([["j_1wq4a0l", "completed", 650]]);
    const pulledJob = { ...stored.jobs[0]!, id: makeId("j", "jobber", "55"), customerId: "jobber:Z2lkQWw=", status: "completed" as const, rawStatus: "archived", completedOn: "2026-09-02" };
    const repulled = mergePulled(stored, { customers: [{ ...stored.customers[0]!, id: "jobber:Z2lkQWw=" }], quotes: [], jobs: [pulledJob], invoices: [], requests: [] }, "jobber");
    expect(repulled.jobs.map((j) => [j.id, j.status, j.customerId])).toEqual([["j_1wq4a0l", "completed", "c_al"]]);
  });

  it("two homeowners whose ids collide stay two people, each with their own quote", () => {
    expect(makeId("c", "john.gonzalez@gmail.com")).toBe(makeId("c", "patricia.roberts81@gmail.com"));
    const csv = "Client name,Client email,Title,Total,Sent date,Quote #\nJohn Gonzalez,john.gonzalez@gmail.com,Remove dead oak over driveway,2400,2026-06-03,1001\nPatricia Roberts,patricia.roberts81@gmail.com,Prune maples,900,2026-06-05,1002\n";
    const { dataset } = ingestFile(emptyDataset(biz, "2026-09-29"), csv, "quotes.csv", T, { kind: "quote" });
    expect(dataset.customers.map((c) => c.name).sort()).toEqual(["John Gonzalez", "Patricia Roberts"]);
    const john = dataset.customers.find((c) => c.name === "John Gonzalez")!;
    const pat = dataset.customers.find((c) => c.name === "Patricia Roberts")!;
    expect(dataset.quotes.find((q) => /dead oak/.test(q.title))!.customerId).toBe(john.id);
    expect(dataset.quotes.find((q) => /maples/.test(q.title))!.customerId).toBe(pat.id);
    // and the same again keeps each where they are
    const again = ingestFile(dataset, csv, "quotes.csv", T, { kind: "quote" }).dataset;
    expect(again.customers.map((c) => c.id).sort()).toEqual([john.id, pat.id].sort());
  });

  it("two quote, job and invoice numbers whose ids collide stay two records, on every re-import and re-pull", () => {
    expect(makeId("q", "jobber", "439599")).toBe(makeId("q", "jobber", "622382"));
    const QUOTES = `Quote #,Client name,Client email,Title,Total,Sent date,Status
439599,John Gonzalez,john@gmail.com,Remove dead oak over driveway,2400,2026-06-03,Awaiting response
622382,Patricia Roberts,pat@gmail.com,Prune maples,900,2026-06-05,Awaiting response
`;
    const ds = ingestFile(emptyDataset(biz, "2026-09-29"), QUOTES, "Quotes Report.csv", T).dataset;
    const whose = (d: Dataset, n: string) => d.customers.find((c) => c.id === d.quotes.find((q) => q.number === n)!.customerId)!.name;
    expect(ds.quotes).toHaveLength(2);
    expect([whose(ds, "439599"), whose(ds, "622382")]).toEqual(["John Gonzalez", "Patricia Roberts"]);
    const ids = ds.quotes.map((q) => q.id);
    // Patricia says yes on the next export: her quote changes, John's is still open
    const next = ingestFile(ds, QUOTES.replace("900,2026-06-05,Awaiting response", "900,2026-06-05,Approved"), "Quotes Report.csv", T).dataset;
    expect(next.quotes.map((q) => q.id)).toEqual(ids);
    expect(next.quotes.map((q) => [q.number, q.status])).toEqual([["439599", "awaiting_response"], ["622382", "approved"]]);
    // a pull with both, their jobs (which collide too) and Patricia's invoice: each lands on its own record
    const pat = next.customers.find((c) => c.name === "Patricia Roberts")!;
    const john = next.customers.find((c) => c.name === "John Gonzalez")!;
    const pulled = mergePulled(next, {
      customers: [],
      quotes: next.quotes.map((q) => ({ ...q, id: makeId("q", "jobber", q.number!), status: "converted" as const })),
      jobs: [
        job(makeId("j", "jobber", "439599"), john.id, { number: "439599", quoteRef: "439599", quoteId: makeId("q", "jobber", "439599") }),
        job(makeId("j", "jobber", "622382"), pat.id, { number: "622382", quoteRef: "622382", quoteId: makeId("q", "jobber", "622382") }),
      ],
      invoices: [{ id: makeId("i", "jobber", "77"), number: "77", customerId: pat.id, subject: "Prune maples", total: 900, balance: 0, status: "paid", rawStatus: "paid", jobRef: "622382", jobId: makeId("j", "jobber", "622382") }],
      requests: [],
    }, "jobber");
    expect(pulled.quotes.map((q) => q.id)).toEqual(ids);
    expect(pulled.jobs).toHaveLength(2);
    const patJob = pulled.jobs.find((j) => j.number === "622382")!;
    expect(patJob.customerId).toBe(pat.id);
    expect(patJob.quoteId).toBe(pulled.quotes.find((q) => q.number === "622382")!.id);
    expect(pulled.jobs.find((j) => j.number === "439599")!.quoteId).toBe(pulled.quotes.find((q) => q.number === "439599")!.id);
    expect(pulled.invoices[0]!.jobId).toBe(patJob.id);
    // pulled again: the same ids, nothing copied
    const twice = mergePulled(pulled, { customers: [], quotes: [], jobs: [job(makeId("j", "jobber", "622382"), pat.id, { number: "622382", total: 950 })], invoices: [], requests: [] }, "jobber");
    expect(twice.jobs.map((j) => j.id)).toEqual(pulled.jobs.map((j) => j.id));
    expect(twice.jobs.find((j) => j.number === "622382")!.total).toBe(950);
    expect(twice.jobs.find((j) => j.number === "439599")!.total).toBe(1000);
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
    // someone else's lower price is a no, however it's written
    ["Someone else quoted lower", "declined"],
    ["Other contractor quoted lower", "declined"],
    ["Another contractor quoted lower", "declined"],
    ["Competitors quoted lower", "declined"],
    ["Quoted lower elsewhere", "declined"],
    ["Got quoted lower elsewhere", "declined"],
    ["Other bid was lower", "declined"],
    ["Their bid was lower", "declined"],
    ["Someone else bid lower", "declined"],
    ["Competitor's bid was lower", "declined"],
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

/* ------------------------------------------------------------------ */
/* Final review: imports that crashed, guessed or kept stale rows      */
/* ------------------------------------------------------------------ */

const AT = "2026-09-29T12:00:00Z";
const load = (files: [string, string][], ds: Dataset = emptyDataset(biz, "2026-09-29")) => {
  for (const [name, csv] of files) ds = ingestFile(ds, csv, name, AT).dataset;
  return ds;
};

describe("a blank title never stops an import", () => {
  const QUOTES = `Quote #,Client name,Client email,Title,Status,Sent date,Total ($)
101,Mike Sanderson,mike@gmail.com,Oak removal,Awaiting response,2026-06-02,2400
102,Jane Doe,jane@gmail.com,,Awaiting response,2026-06-02,900
`;
  // Jobber job titles are optional; neither job carries a quote #
  const JOBS = `Job #,Client name,Client email,Title,Job status,Created date,Completed date,Total
501,Mike Sanderson,mike@gmail.com,,Completed,2026-06-20,2026-06-25,2400
502,Jane Doe,jane@gmail.com,Stump grinding,Completed,2026-07-01,2026-07-02,300
`;
  it.each([
    ["quotes then jobs", [["Quotes Report.csv", QUOTES], ["Jobs Report.csv", JOBS]]],
    ["jobs then quotes", [["Jobs Report.csv", JOBS], ["Quotes Report.csv", QUOTES]]],
  ] as [string, [string, string][]][])("%s", (_order, files) => {
    const ds = load(files);
    expect(ds.jobs.find((j) => j.number === "501")!.title).toBe("");
    expect(ds.quotes.find((q) => q.number === "102")!.title).toBe("");
    expect(() => scan(ds)).not.toThrow();
  });
  it("a title saved missing before this was fixed is repaired on the next import, not a crash", () => {
    const ds = load([["Quotes Report.csv", QUOTES]]);
    for (const q of ds.quotes) if (q.number === "102") (q as { title?: string }).title = undefined;
    const next = load([["Jobs Report.csv", JOBS]], ds);
    expect(next.quotes.find((q) => q.number === "102")!.title).toBe("");
  });
});

describe("status words an owner types on their own sheet", () => {
  const status = (s: string) => {
    const csv = `Name,Email,Work,Status,Sent,Price\nPat Doe,pat@doe.com,Exterior repaint,${s},2026-03-02,4200\n`;
    return ingestFile(emptyDataset(biz, "2026-09-29"), csv, "estimates.csv", AT, { kind: "quote" }).dataset.quotes[0]!;
  };
  it.each<[string, QuoteStatus]>([
    ["Done", "converted"],
    ["Finished", "converted"],
    ["Job done", "converted"],
    ["Installed", "converted"],
    ["Yes", "approved"],
    ["Y", "approved"],
    ["Verbal yes", "approved"],
    ["Moving forward", "approved"],
    ["Went ahead", "approved"],
    ["Awarded", "approved"],
    ["No", "declined"],
    ["N", "declined"],
    ["Didn't sell", "declined"],
    ["Did not sell", "declined"],
    ["Passed", "declined"],
    ["Dead", "archived"],
    // still open, whichever way it's written
    ["Didn't sell yet", "awaiting_response"],
    ["Not moving forward", "declined"],
  ])("%s reads as %s", (s, want) => {
    const q = status(s);
    expect(q.status).toBe(want);
    expect(q.unreadStatus).toBeUndefined();
  });
  it("a yes that turned something down reads two ways and is held", async () => {
    const { statusReadsTwoWays } = await import("../src/ingest/fields.ts");
    expect(statusReadsTwoWays("Yes - said no to the gate")).toBe(true);
  });
  it("a yes still waiting on something is held for a person, never chased as unanswered", async () => {
    const SHEET = `Name,Email,Job,Price,Date,Status
Mike Sanderson,mike@gmail.com,Cedar privacy fence,6200,2026-08-02,Yes - waiting on HOA
Al Finch,al@gmail.com,Vinyl fence,4800,2026-08-03,Yes - waiting on financing
Kim Lee,kim@gmail.com,Picket fence,2100,2026-08-04,Y - pending
Jane Doe,jane@gmail.com,Chain link fence,1900,2026-08-05,Approved - waiting on HOA
`;
    const ds = load([["Fence estimates.csv", SHEET]]);
    expect(ds.quotes.map((q) => q.status)).toEqual(["approved", "approved", "approved", "approved"]);
    const r = scan(ds);
    expect(r.opportunities.filter((o) => o.type === "unanswered_quote")).toEqual([]);
    const held = r.opportunities.filter((o) => o.caution?.some((c) => /reads two ways/.test(c)));
    expect(new Set(held.map((o) => o.customerId)).size).toBe(4);
    // a yes waiting only on its deposit or a date is the next step, not a second answer
    const { statusReadsTwoWays } = await import("../src/ingest/fields.ts");
    for (const next of ["Yes - awaiting deposit", "Approved - pending scheduling", "Sold - waiting to be scheduled"]) expect(statusReadsTwoWays(next), next).toBe(false);
  });

  it("a status nobody recognises is held for a person with a warning, never chased as open on a guess", () => {
    const SHEET = `Name,Phone,Email,Address,Job,Price,Date,Status
Mike Sanderson,603-224-1101,mike@gmail.com,"14 Oak Ln, Concord, NH 03301",Oak removal,2400,2026-05-02,Done
Jane Doe,603-224-1102,jane@gmail.com,"15 Oak Ln, Concord, NH 03301",Pine over garage,1800,2026-05-03,Yes
Al Finch,603-224-1103,al@gmail.com,"16 Oak Ln, Concord, NH 03301",Maple pruning,900,2026-05-04,Finished
Bob Jones,603-224-1104,bob@gmail.com,"17 Oak Ln, Concord, NH 03301",Stump grinding,450,2026-05-05,Didn't sell
Kim Lee,603-224-1105,kim@gmail.com,"18 Oak Ln, Concord, NH 03301",Spruce removal,700,2026-05-06,Assigned
`;
    const { dataset: ds, record } = ingestFile(emptyDataset(biz, "2026-09-29"), SHEET, "estimates 2026.csv", AT);
    expect(record.warnings.join(" ")).toMatch(/1 quote has a status we don't recognise \("Assigned"\)/);
    const r = scan(ds);
    const by = (email: string) => r.opportunities.filter((o) => ds.customers.find((c) => c.id === o.customerId)?.emails.includes(email));
    // the buyers are not told nobody followed up
    for (const e of ["mike@gmail.com", "al@gmail.com"]) expect(by(e).filter((o) => o.type === "unanswered_quote")).toEqual([]);
    expect(by("jane@gmail.com").map((o) => o.type)).not.toContain("unanswered_quote");
    expect(by("bob@gmail.com").map((o) => o.type)).toEqual(["declined_quote"]);
    const kim = by("kim@gmail.com").find((o) => o.type === "unanswered_quote")!;
    expect(kim.caution).toEqual(['Marked "Assigned", which we don\'t recognise — check it before anyone writes']);
    expect(r.primary.some((o) => o.customerId === kim.customerId && !o.caution)).toBe(false);
  });
  it("a re-sent sheet whose status now reads clears the hold", () => {
    const sheet = (s: string) => `Name,Email,Job,Price,Date,Status\nKim Lee,kim@gmail.com,Spruce removal,700,2026-05-06,${s}\n`;
    const ds = load([["estimates.csv", sheet("Assigned")], ["estimates.csv", sheet("Pending")]]);
    expect(ds.quotes).toHaveLength(1);
    expect(ds.quotes[0]!.status).toBe("awaiting_response");
    expect(ds.quotes[0]!.unreadStatus).toBeUndefined();
  });
});

describe("a quote tracker named for leads is read as quotes", () => {
  const TRACKER = `Name,Phone,Email,Address,Job,Quote Amount,Date,Status
Mike Sanderson,603-224-1101,mike@gmail.com,"14 Oak Ln, Concord, NH 03301",Oak removal,2400,2026-05-02,Sold
Jane Doe,603-224-1102,jane@gmail.com,"15 Oak Ln, Concord, NH 03301",Pine over garage,1800,2026-05-03,Lost
Al Finch,603-224-1103,al@gmail.com,"16 Oak Ln, Concord, NH 03301",Maple pruning,900,2026-05-04,Pending
`;
  it.each(["Lead Tracker.csv", "leads 2026.csv"])("%s", (name) => {
    expect(detect(parseTable(TRACKER), name).kind).toBe("quote");
    const ds = load([[name, TRACKER]]);
    expect(ds.requests).toEqual([]);
    expect(ds.quotes.map((q) => [q.total, q.status])).toEqual([[2400, "converted"], [1800, "declined"], [900, "awaiting_response"]]);
    // nobody who bought or said no is told "we never got you a price"
    expect(scan(ds).opportunities.filter((o) => o.type === "unquoted_request")).toEqual([]);
  });
  it("a real list of leads, with no price, is still requests", () => {
    const LEADS = `Name,Email,Phone,Service needed,Date,Status\nMike Sanderson,mike@gmail.com,603-224-1101,Oak removal,2026-09-01,New\n`;
    expect(detect(parseTable(LEADS), "Leads.csv").kind).toBe("request");
  });
});

describe("re-sending an updated sheet with no quote numbers", () => {
  const V1 = `Name,Email,Job,Price,Date,Status
Mike Sanderson,mike@gmail.com,Oak removal,2400,2026-05-02,Pending
Jane Doe,jane@gmail.com,Pine over garage,1800,2026-05-03,Pending
`;
  // a month later: a new row on top, and the owner marked the two of them
  const V2 = `Name,Email,Job,Price,Date,Status
Al Finch,al@gmail.com,Maple pruning,900,2026-09-01,Pending
Mike Sanderson,mike@gmail.com,Oak removal,2400,2026-05-02,Sold
Jane Doe,jane@gmail.com,Pine over garage,1800,2026-05-03,Lost
`;
  const statusOf = (ds: Dataset) => Object.fromEntries(ds.quotes.map((q) => [q.title, q.status]));
  it("updates the same quotes instead of keeping the old Pending copies", () => {
    const ds = load([["Estimates.csv", V1], ["Estimates.csv", V2]]);
    expect(ds.quotes).toHaveLength(3);
    expect(statusOf(ds)).toEqual({ "Oak removal": "converted", "Pine over garage": "declined", "Maple pruning": "awaiting_response" });
    expect(scan(ds).opportunities.filter((o) => o.type === "unanswered_quote").map((o) => ds.customers.find((c) => c.id === o.customerId)!.name)).toEqual(["Al Finch"]);
  });
  it("finds quotes an earlier import keyed by row position, so they're updated too", () => {
    const ds = load([["Estimates.csv", V1]]);
    ds.quotes = ds.quotes.map((q, i) => ({ ...q, id: `q_legacy${i}` }));
    const next = load([["Estimates.csv", V2]], ds);
    expect(next.quotes.map((q) => q.id).filter((id) => id.startsWith("q_legacy"))).toHaveLength(2);
    expect(next.quotes).toHaveLength(3);
    expect(statusOf(next)["Oak removal"]).toBe("converted");
  });
  it("two identical rows stay two quotes, the second time too", () => {
    const TWICE = `Name,Email,Job,Price,Date,Status\nMike Sanderson,mike@gmail.com,Stump grinding,300,2026-05-02,Pending\nMike Sanderson,mike@gmail.com,Stump grinding,300,2026-05-02,Pending\n`;
    expect(load([["Estimates.csv", TWICE], ["Estimates.csv", TWICE]]).quotes).toHaveLength(2);
  });
  it("a sheet with no title column: the note written when marking it Sold doesn't make a new quote", () => {
    // a one-service fence shop: the notes show in place of a title, and change when the owner marks the sale
    const N1 = `Name,Email,Phone,Price,Date,Status,Notes
Mike Sanderson,mike@gmail.com,603-224-1101,6200,2026-05-02,Pending,Sent quote - 150ft vinyl
Jane Doe,jane@gmail.com,603-224-1102,3400,2026-05-03,Pending,
`;
    const N2 = `Name,Email,Phone,Price,Date,Status,Notes
Mike Sanderson,mike@gmail.com,603-224-1101,6200,2026-05-02,Sold,Signed 6/1 - deposit paid
Jane Doe,jane@gmail.com,603-224-1102,3400,2026-05-03,Sold,Signed 6/3
`;
    const ds = load([["Fence quotes.csv", N1], ["Fence quotes.csv", N2]]);
    expect(ds.quotes.map((q) => [q.total, q.status])).toEqual([[6200, "converted"], [3400, "converted"]]);
    expect(ds.quotes[0]!.title).toBe("Signed 6/1 - deposit paid");
    expect(scan(ds).opportunities.filter((o) => o.type === "unanswered_quote")).toEqual([]);
    // two quotes to one person on one day are told apart by their price, whichever order the rows come in
    const TWO = `Name,Email,Price,Date,Status,Notes\nMike Sanderson,mike@gmail.com,6200,2026-05-02,Pending,Vinyl\nMike Sanderson,mike@gmail.com,900,2026-05-02,Pending,Gate\n`;
    const SWAPPED = `Name,Email,Price,Date,Status,Notes\nMike Sanderson,mike@gmail.com,900,2026-05-02,Pending,Gate - waiting\nMike Sanderson,mike@gmail.com,6200,2026-05-02,Sold,Vinyl - signed\n`;
    const two = load([["Fence quotes.csv", TWO], ["Fence quotes.csv", SWAPPED]]);
    expect(two.quotes.map((q) => [q.total, q.status])).toEqual([[6200, "converted"], [900, "awaiting_response"]]);
  });
});

describe("two people on one phone number", () => {
  const CSV = `Quote #,Client name,Client email,Client phone,Property,Title,Status,Sent date,Total ($)
101,Mike Sanderson,mike@gmail.com,603-224-5150,"14 Oak Ln, Concord, NH 03301",Oak removal,Awaiting response,2026-06-02,2400
102,Jane Doe,jane@gmail.com,603-224-5150,"88 Pine St, Bow, NH 03304",Pine over garage,Awaiting response,2026-07-02,1800
103,Pat Quinn,,603-224-5150,"9 Elm St, Bow, NH 03304",Hedge trim,Awaiting response,2026-07-02,600
104,Mike Sanderson,,603-224-5150,"14 Oak Ln, Concord, NH 03301",Stump grinding,Awaiting response,2026-07-02,400
105,Sara Sanderson,,603-224-5150,"14 Oak Ln, Concord, NH 03301",Maple pruning,Awaiting response,2026-07-02,500
`;
  it("are kept apart when their names or emails differ, so one's quote never goes to the other", () => {
    const { dataset: ds, record } = ingestFile(emptyDataset(biz, "2026-09-29"), CSV, "Quotes Report.csv", AT);
    const whose = (n: string) => ds.customers.find((c) => c.id === ds.quotes.find((q) => q.number === n)!.customerId)!;
    expect(whose("102").emails).toEqual(["jane@gmail.com"]);
    expect(whose("102").name).toBe("Jane Doe");
    expect(whose("103").name).toBe("Pat Quinn");
    expect(whose("103").emails).toEqual([]);
    // the same person again, and their household, still join on the number
    expect(whose("104").id).toBe(whose("101").id);
    expect(whose("105").id).toBe(whose("101").id);
    expect(ds.customers).toHaveLength(3);
    expect(record.warnings.join(" ")).toMatch(/1 phone number is shared by people with different names or emails/);
  });
});

describe("QuickBooks estimates", () => {
  // Reports → Estimates by Customer → Export: the customer's name sits alone above their estimates
  const GROUPED = `Estimates by Customer
Ridgeline Tree Co
All Dates

,Date,Transaction Type,Num,Memo/Description,Amount,Status
Mike Sanderson,,,,,,
,05/02/2026,Estimate,1001,Oak removal,"2,400.00",Pending
,06/01/2026,Estimate,1002,Stump grinding,450.00,Pending
Total for Mike Sanderson,,,,,"$2,850.00",
Jane Doe,,,,,,
,07/02/2026,Estimate,1003,Pine over garage,"1,800.00",Pending
Total for Jane Doe,,,,,"$1,800.00",
TOTAL,,,,,"$4,650.00",
`;
  const FLAT = `Date,Transaction Type,Num,Customer,Memo/Description,Amount,Status
05/02/2026,Estimate,1001,Mike Sanderson,Oak removal,"2,400.00",Pending
07/02/2026,Estimate,1003,Jane Doe,Pine over garage,"1,800.00",Pending
`;
  const CUSTOMERS = `Customer,Phone,Email,Billing Address
Mike Sanderson,(603) 224-1234,mike@gmail.com,"14 Oak Ln, Concord, NH 03301"
Jane Doe,(603) 224-5678,jane@gmail.com,"88 Pine St, Bow, NH 03304"
`;
  it("reads the grouped report the readiness screen asks for", () => {
    const t = parseTable(GROUPED);
    expect(t.headers[0]).toBe("Customer");
    expect(t.rows.map((r) => r[0])).toEqual(["Mike Sanderson", "Mike Sanderson", "Jane Doe"]);
    const d = detect(t, "Estimates by Customer.csv");
    expect([d.kind, d.source]).toEqual(["quote", "quickbooks"]);
    expect(t.headers[d.mapping.fields.number!]).toBe("Num");
  });
  it.each([
    ["grouped, then the customer list", [["Estimates by Customer.csv", GROUPED], ["Customers.csv", CUSTOMERS]]],
    ["the customer list, then grouped", [["Customers.csv", CUSTOMERS], ["Estimates by Customer.csv", GROUPED]]],
    ["the flat estimate list, then the customer list", [["Estimates.csv", FLAT], ["Customers.csv", CUSTOMERS]]],
  ] as [string, [string, string][]][])("%s: each estimate reaches its customer by their name", (_order, files) => {
    const ds = load(files);
    expect(ds.customers).toHaveLength(2);
    const mike = ds.customers.find((c) => c.name === "Mike Sanderson")!;
    expect(mike.emails).toEqual(["mike@gmail.com"]);
    expect(ds.quotes.filter((q) => q.customerId === mike.id).map((q) => q.number)).toContain("1001");
    const primary = scan(ds).primary.map((o) => ds.customers.find((c) => c.id === o.customerId)!.name).sort();
    expect(primary).toEqual(["Jane Doe", "Mike Sanderson"]);
  });
  it("a name two customers share joins neither", () => {
    const TWO = `Customer,Email\nMike Sanderson,mike@gmail.com\nMike Sanderson,mike.s@yahoo.com\n`;
    const ds = load([["Customers.csv", TWO], ["Estimates.csv", FLAT]]);
    const est = ds.quotes.find((q) => q.number === "1001")!;
    expect(ds.customers.find((c) => c.id === est.customerId)!.emails).toEqual([]);
  });

  // Reports → Sales by Customer Detail, the extra file setup asks for: every line of every sale, under the customer,
  // with a running total in "Balance"
  const SALES = `Sales by Customer Detail
Ridgeline Tree Co
All Dates

,Date,Transaction Type,Num,Product/Service,Memo/Description,Qty,Sales Price,Amount,Balance
Mike Sanderson,,,,,,,,,
,03/02/2026,Invoice,2001,Tree removal,Oak removal,1,"2,000.00","2,000.00","2,000.00"
,03/02/2026,Invoice,2001,Stump grinding,Stump,1,400.00,400.00,"2,400.00"
Total for Mike Sanderson,,,,,,,,"$2,400.00",
Jane Doe,,,,,,,,,
,04/10/2026,Sales Receipt,2002,Pruning,Maple pruning,1,650.00,650.00,650.00
,05/01/2026,Credit Memo,2003,Pruning,Refund for a missed limb,1,-50.00,-50.00,600.00
Total for Jane Doe,,,,,,,,$600.00,
TOTAL,,,,,,,,"$3,000.00",
`;
  it("Sales by Customer Detail reads as past sales, paid, never as money still owed", () => {
    const ds = load([["Customers.csv", CUSTOMERS], ["Sales by Customer Detail.csv", SALES]]);
    expect(ds.invoices.map((i) => [i.number, i.total, i.balance, i.status])).toEqual([
      ["2001", 2400, 0, "paid"],
      ["2002", 650, 0, "paid"],
      ["2003", -50, 0, "void"],
    ]);
    expect(ds.customers).toHaveLength(2);
    expect(scan(ds).opportunities.filter((o) => o.type === "unpaid_invoice")).toEqual([]);
  });
  it("a balance report reads what's owed from its Open Balance, never the running Balance", () => {
    const OWED = `Customer Balance Detail

,Date,Transaction Type,Num,Due Date,Amount,Open Balance,Balance
Mike Sanderson,,,,,,,
,03/02/2026,Invoice,2004,04/01/2026,"3,000.00","1,000.00","1,000.00"
,04/02/2026,Invoice,2005,05/02/2026,500.00,500.00,"1,500.00"
`;
    const ds = load([["Customers.csv", CUSTOMERS], ["Customer Balance Detail.csv", OWED]]);
    expect(ds.invoices.map((i) => [i.number, i.total, i.balance])).toEqual([["2004", 3000, 1000], ["2005", 500, 500]]);
  });
});

describe("an owner's sheet that starts in column B", () => {
  const ROWS = `,Mike Sanderson,mike@gmail.com,603-224-1101,Oak removal,2400,2026-05-02,Waiting\n,Al Finch,al@gmail.com,603-224-1103,Maple pruning,900,2026-05-04,Sold\n`;
  it.each([
    ["with its sections labelled in column A", `,Name,Email,Phone,Job,Price,Date Sent,Status\nPENDING,,,,,,,\n${ROWS.split("\n")[0]}\nSOLD,,,,,,,\n${ROWS.split("\n")[1]}\n`],
    ["with a note at the bottom of column A", `,Name,Email,Phone,Job,Price,Date Sent,Status\n${ROWS}Updated 9/1 by Dave,,,,,,,\n`],
  ])("%s keeps reading names from its Name column", (_case, csv) => {
    expect(parseTable(csv).headers[0]).not.toBe("Customer");
    const ds = load([["Estimates.csv", csv]]);
    expect(ds.customers.map((c) => c.name).sort()).toEqual(["Al Finch", "Mike Sanderson"]);
    expect(ds.quotes.map((q) => q.status)).toEqual(["awaiting_response", "converted"]);
  });
});
