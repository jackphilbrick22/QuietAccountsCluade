import { describe, expect, it } from "vitest";
import { parseTable } from "../src/ingest/csv.ts";
import { detect } from "../src/ingest/detect.ts";
import { emptyDataset, ingestFile } from "../src/ingest/index.ts";
import { parseDate, parseMoney, splitName, greetingName, humanAge, intervalWords, normalizePhone } from "../src/util.ts";
import type { BusinessProfile } from "../src/model.ts";

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
    expect(normalizePhone("555-0142")).toBeUndefined();
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
