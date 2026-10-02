import { describe, expect, it } from "vitest";
import { scan } from "../src/breakage/detect.ts";
import { visitBook } from "../src/breakage/visits.ts";
import { renderNote, type RenderedNote } from "../src/copy/render.ts";
import { SEQUENCES } from "../src/copy/templates.ts";
import { parseTable, toCSV } from "../src/ingest/csv.ts";
import { detect } from "../src/ingest/detect.ts";
import { KIND_FIELDS, VENDOR_COLUMNS, type Field } from "../src/ingest/fields.ts";
import { emptyDataset, ingestFile } from "../src/ingest/index.ts";
import type { Dataset, Opportunity, RecordKind, SourceSystem } from "../src/model.ts";
import { find, planBatch, readFiles } from "../src/runtime/agents.ts";
import { emptyState } from "../src/runtime/state.ts";
import { classifyWork } from "../src/trades/index.ts";
import { addDays } from "../src/util.ts";
import {
  type Booking,
  bookingKoalaCustomers,
  bookingKoalaTimeLogs,
  CLEANING_ASOF,
  cleaningBookers,
  type Every,
  FINDS,
  launch27Bookings,
  NOT_FLAGGED,
  type State,
  zenmaidAppointments,
  ZENMAID_FILE,
} from "./cleaning-fixtures.ts";
import { business } from "./fixtures.ts";
import { bookingsExport, lawnClients } from "./lawn-fixtures.ts";

const NOW = `${CLEANING_ASOF}T12:00:00Z`;
const shop = () => business({ trade: "cleaning", name: "Sparkle House Cleaning", avgJobValue: undefined, software: "unknown" });
const people = cleaningBookers();

/** Each tool's files, in the order an owner might send them. BookingKoala's emails are only in its Customers export. */
const EXPORTS: [SourceSystem, [string, string][]][] = [
  ["zenmaid", [[zenmaidAppointments(people), ZENMAID_FILE]]],
  ["bookingkoala", [[bookingKoalaTimeLogs(people), "booking_time_logs.csv"], [bookingKoalaCustomers(people), "customers.csv"]]],
  ["launch27", [[launch27Bookings(people), "bookings.csv"]]],
];

const load = (files: [string, string][], ds: Dataset = emptyDataset(shop(), CLEANING_ASOF)) => files.reduce((d, [csv, name]) => ingestFile(d, csv, name, NOW).dataset, ds);
const idOf = (ds: Dataset, first: string) => ds.customers.find((c) => c.firstName === first)!.id;
const firstOf = (ds: Dataset, id: string) => ds.customers.find((c) => c.id === id)!.firstName;
/** Each person's opportunities: what it is, what it's for and whether it's held. */
const foundFor = (ds: Dataset, os: Opportunity[], first: string) => os.filter((o) => o.customerId === idOf(ds, first)).map((o) => [o.type, o.serviceId, o.suppressed]);
/** Every planned step of one opportunity's sequence, rendered for the day. */
const notes = (ds: Dataset, o: Opportunity): RenderedNote[] =>
  SEQUENCES[o.type].steps.map((s) => renderNote(o, ds.customers.find((c) => c.id === o.customerId)!, { ds, sendOn: CLEANING_ASOF }, s.step)).filter((n): n is RenderedNote => !!n);
/** Everything above the footer. */
const main = (n: RenderedNote) => n.body.split(/\n\n[^\n]*·[^\n]*\n/)[0]!;

describe("each cleaning booking tool's export is known by its own columns, whatever the file is called", () => {
  const LAUNCH27_CUSTOMERS = toCSV(
    ["First Name", "Last Name", "Email", "Address", "City", "State", "Postal Code", "Phone", "Date Created", "Stripe ID", "Date of First Booking", "Date of Last Booking"],
    [
      ["Karen", "Brennan", "karen.brennan@comcast.net", "212 Pine St", "Concord", "NH", "03301", "(603) 555-0102", "01/28/2026 2:14 PM", "cus_PqR8", "02/03/2026 9:00 AM", "07/07/2026 9:00 AM"],
      ["Mike", "Sanderson", "mike.sanderson@gmail.com", "14 Oak Ln", "Concord", "NH", "03301", "(603) 555-0101", "05/29/2026 10:02 AM", "cus_Mk2s", "06/04/2026 9:00 AM", "09/24/2026 9:00 AM"],
    ],
  );
  // ZenMaid's Contacts export with every column its dialog offers ticked, each contact's Balance and Revenue among them
  // (https://zenmaid.com/answers/en/articles/9764809-how-to-create-a-cancellation-report)
  const zenmaidContacts = (rows: string[][]) =>
    toCSV(
      [
        "Contact ID", "Title", "First Name", "Last Name", "Full Name", "Company Name", "Created On", "Phone Numbers (All)", "Primary Phone Number", "Emails (All)",
        "Primary Email", "Subscribed Emails", "Most Recent Clean", "Next Appointment", "Gateway IDs", "Marketing Source", "Preferred Payment Method", "Birth Date", "Type", "Balance",
        "Revenue", "Cleaning Weekday", "Service Addresses", "Billing Addresses", "First Appointment", "Contact Notes", "Separate Emails", "Separate Phone Numbers", "Custom Fields",
      ],
      rows.map(([id, first, last, email, phone, created, recent, next, type, balance, revenue, weekday, address, firstOn]) => [
        id, "", first, last, `${first} ${last}`, "", created, phone, phone, email,
        email, email, recent, next, "", "Google", "Credit Card", "", type, balance,
        revenue, weekday, address, address, firstOn, "", email, phone, "",
      ]),
    );
  // Mike, a Recurring Customer, is booked for Thursday
  const ZENMAID_CONTACTS = zenmaidContacts([
    ["8812", "Karen", "Brennan", "karen.brennan@comcast.net", "(603) 555-0102", "01/28/2026", "07/07/2026", "", "Former Customer", "0.00", "1980.00", "Tuesday", "212 Pine St, Concord, NH 03301", "02/03/2026"],
    ["8840", "Mike", "Sanderson", "mike.sanderson@gmail.com", "(603) 555-0101", "05/29/2026", "09/24/2026", "10/01/2026", "Recurring Customer", "140.00", "2240.00", "Thursday", "14 Oak Ln, Concord, NH 03301", "06/04/2026"],
    ["8901", "Tina", "Vachon", "tina.vachon@gmail.com", "(603) 555-0130", "09/02/2026", "", "", "Lead", "0.00", "0.00", "", "5 Mill Rd, Concord, NH 03301", ""],
  ]);
  const cases: [string, string, RecordKind, SourceSystem, Partial<Record<Field, string | undefined>>][] = [
    ["ZenMaid's Appointments export", zenmaidAppointments(people), "visit", "zenmaid",
      { number: "Appointment ID", scheduledOn: "Appointment Date", status: "Appointment Status", jobType: "Recurrence", series: "Subscription ID", total: "Price", email: "Customer Emails", name: "Customer Full Name", crew: "Team Name", street: "Address Line1", completedOn: undefined }],
    ["ZenMaid's Contacts export", ZENMAID_CONTACTS, "client", "zenmaid",
      { clientId: "Contact ID", name: "Full Name", email: "Primary Email", lastJobOn: "Most Recent Clean", createdOn: "Created On", clientType: "Type", nextVisitOn: "Next Appointment", clientStatus: undefined }],
    ["BookingKoala's Booking Time Logs export", bookingKoalaTimeLogs(people), "visit", "bookingkoala",
      { number: "Booking id", scheduledOn: "Service date", name: "Customer", phone: "Phone number", title: "Service", jobType: "Frequency", total: "Booking amount", crew: "Provider", clockedIn: "Clocked in", status: "Status" }],
    ["BookingKoala's Customers export", bookingKoalaCustomers(people), "client", "bookingkoala", { name: "Full Name", email: "Email Address", phone: "Phone Number", createdOn: "Created On", lastJobOn: undefined }],
    ["Launch27's booking CSV", launch27Bookings(people), "visit", "launch27", { scheduledOn: "Date", jobType: "Frequency", title: "Service", total: "Final Price", email: "Email", zip: "Postal Code", status: undefined }],
    ["Launch27's Customers export", LAUNCH27_CUSTOMERS, "client", "launch27", { lastJobOn: "Date of Last Booking", createdOn: "Date Created", email: "Email" }],
  ];

  it.each(cases)("%s", (_what, csv, kind, source, columns) => {
    const t = parseTable(csv);
    const d = detect(t, "export.csv");
    expect([d.kind, d.source]).toEqual([kind, source]);
    for (const [field, header] of Object.entries(columns)) {
      const i = d.mapping.fields[field as Field];
      expect(i === undefined ? undefined : t.headers[i], field).toBe(header);
    }
  });

  it("each tool's columns are fields its export's kind has", () => {
    for (const [source, byKind] of Object.entries(VENDOR_COLUMNS))
      for (const [kind, columns] of Object.entries(byKind!))
        for (const field of Object.values(columns)) if (field) expect(KIND_FIELDS[kind as RecordKind], `${source} ${kind}`).toContain(field);
  });

  it("BookingKoala's time logs with only some of its fields ticked are still known for BookingKoala's, the time reported standing in for the clock-in", () => {
    const csv = toCSV(["Booking id", "Service date", "Service time", "Customer", "Provider", "Travel distance", "Time reported"], [["136", "04/04/2022", "09:00 AM", "Test Customer", "Test Provider", "4.2 mi", "2 Hr 30 Min"]]);
    const t = parseTable(csv);
    const d = detect(t, "export.csv");
    expect([d.kind, d.source]).toEqual(["visit", "bookingkoala"]);
    expect(t.headers[d.mapping.fields.clockedIn!]).toBe("Time reported");
  });

  it("a quote file from a tool gets none of the readings of the tool's other exports", () => {
    const csv = toCSV(["Name", "Email", "Estimated Job Length", "Quote Amount", "Quote Date", "Status"], [["Karen Brennan", "karen@gmail.com", "3 Hr", "2400", "03/02/2026", "Sent"]]);
    const t = parseTable(csv);
    const d = detect(t, "export.csv");
    expect([d.kind, d.source]).toEqual(["quote", "bookingkoala"]);
    expect(t.headers[d.mapping.fields.status!]).toBe("Status");
    expect(load([[csv, "export.csv"]]).quotes.map((q) => q.status)).toEqual(["awaiting_response"]);
  });

  it("a column an owner's own sheet has too ('Provider', 'Industry', a clock) puts no file down to a tool", () => {
    for (const extra of ["Provider", "Industry", "Clocked In", "Clocked Out", "Time reported"]) {
      const csv = toCSV(["Booking ID", "Customer Name", "Email", extra, "Service date", "Booking amount", "Status"], [["901", "Karen Brennan", "karen@gmail.com", "Home Cleaning", "07/07/2026", "165.00", "Completed"]]);
      const d = detect(parseTable(csv), "export.csv");
      expect([d.kind, d.source], extra).toEqual(["visit", "spreadsheet"]);
      expect(load([[csv, "export.csv"]]).business.software, extra).toBe("unknown");
    }
  });

  it("a column the tool names comes before any other spelling, wherever it sits", () => {
    // ZenMaid's dialog offers Service Frequency too, with no word on what it holds: its Recurrence is the rhythm
    const csv = toCSV(
      ["Service Frequency", "Appointment ID", "Appointment Date", "Appointment Status", "Customer Full Name", "Customer Emails", "Recurrence"],
      [["Recurring", "5001", "09/22/2026", "Completed", "Karen Brennan", "karen.brennan@comcast.net", "every 2 weeks"]],
    );
    const t = parseTable(csv);
    expect(t.headers[detect(t, "export.csv").mapping.fields.jobType!]).toBe("Recurrence");
    expect(load([[csv, "export.csv"]]).jobs.map((j) => [j.recurring, j.everyDays])).toEqual([[true, 14]]);
  });

  it("a tool's client list finds who it has last here past a cleaning shop's longest quiet spell, and nobody else", () => {
    for (const csv of [LAUNCH27_CUSTOMERS, ZENMAID_CONTACTS]) {
      const ds = load([[csv, "export.csv"]]);
      // "07/07/2026 9:00 AM" is the day, whatever the time beside it
      expect(ds.jobs.map((j) => [firstOf(ds, j.customerId), j.completedOn])).toEqual([["Karen", "2026-07-07"], ["Mike", "2026-09-24"]]);
      expect(scan(ds).opportunities.map((o) => [firstOf(ds, o.customerId), o.type, o.suppressed])).toEqual([["Karen", "one_and_done", undefined]]);
    }
  });

  it("ZenMaid's Appointments export, every column ticked, finds the same people whatever the file is called", () => {
    // the customer's Balance and what was Paid on each appointment are beside its Appointment ID and status
    for (const name of [ZENMAID_FILE, "export.csv", "zenmaid.csv"]) {
      const ds = load([[zenmaidAppointments(people), name]]);
      const found = scan(ds).opportunities.map((o) => [firstOf(ds, o.customerId), o.type, o.serviceId, o.suppressed]);
      expect(found.sort(), name).toEqual(Object.entries(FINDS).map(([first, [type, serviceId]]) => [first, type, serviceId, undefined]).sort());
    }
  });

  it("a ZenMaid booking with a blank Recurrence and no Subscription ID was booked once, and still gets the note to go regular", () => {
    const ds = load([[zenmaidAppointments(people, ""), ZENMAID_FILE]]);
    const once = ds.jobs.filter((j) => ["Linda", "Paul", "Janet"].includes(firstOf(ds, j.customerId)));
    expect(once.map((j) => j.recurring)).toEqual([false, false, false]);
    const os = scan(ds).opportunities;
    expect(os.map((o) => [firstOf(ds, o.customerId), o.type, o.serviceId, o.suppressed]).sort()).toEqual(
      Object.entries(FINDS).map(([first, [type, serviceId]]) => [first, type, serviceId, undefined]).sort(),
    );
    const [linda] = notes(ds, os.find((o) => o.customerId === idOf(ds, "Linda"))!);
    expect(main(linda!)).toContain("Want it on a regular schedule? Reply with what works and I'll set it up.");
    // a blank Recurrence on a booking in a subscription says nothing of how often it comes
    const csv = toCSV(
      ["Appointment ID", "Appointment Date", "Subscription ID", "Appointment Status", "Customer Full Name", "Customer Emails", "Recurrence"],
      [["5001", "09/22/2026", "301", "Completed", "Karen Brennan", "karen.brennan@comcast.net", ""], ["5002", "09/23/2026", "", "Completed", "Linda Whitfield", "linda.whitfield@gmail.com", ""]],
    );
    const two = load([[csv, "export.csv"]]);
    expect(two.jobs.map((j) => [firstOf(two, j.customerId), j.recurring])).toEqual([["Karen", undefined], ["Linda", false]]);
  });

  it("an owner's client list whose Customer Status says Recurring or One-time customer finds who it found without one", () => {
    // only ZenMaid's own Type says a visit is booked: an owner's word is how each one came
    const list = (status: boolean) =>
      toCSV(
        ["Name", "Email", "Last Cleaning", ...(status ? ["Customer Status"] : []), "Frequency"],
        [
          ["Karen Brennan", "karen.brennan@comcast.net", "03/10/2026", "Recurring Customer", "Every 2 Weeks"],
          ["Paul Ellis", "paul.ellis@gmail.com", "10/28/2025", "One-time customer", ""],
          ["Ann Leclerc", "ann.leclerc@gmail.com", "02/10/2026", "Former Customer", ""],
        ].map(([name, email, last, said, every]) => [name, email, last, ...(status ? [said] : []), every]),
      );
    const found = (csv: string) => {
      const ds = load([[csv, "export.csv"]]);
      return scan(ds).opportunities.map((o) => [firstOf(ds, o.customerId), o.type, o.suppressed]).sort();
    };
    expect(detect(parseTable(list(true)), "export.csv").source).toBe("spreadsheet");
    expect(found(list(true))).toEqual(found(list(false)));
    expect(found(list(true))).toEqual([["Ann", "one_and_done", undefined], ["Karen", "lapsed_regular", undefined], ["Paul", "one_and_done", undefined]]);
  });

  it("a ZenMaid client with a visit on the calendar is nobody to win back, however long since their last clean, until a list says otherwise", () => {
    // Gary comes every eight weeks: his last clean is past a cleaning shop's 45 days, and his next one is booked
    const gary = (type: string, next = "") =>
      zenmaidContacts([["8850", "Gary", "Gagnon", "gary.gagnon@yahoo.com", "(603) 555-0104", "03/18/2026", "08/01/2026", next, type, "0.00", "1295.00", "Tuesday", "47 Birch Rd, Hopkinton, NH 03229", "03/24/2026"]]);
    for (const [type, next] of [["Recurring Customer", "10/13/2026"], ["Recurring", "10/13/2026"], ["Recurring Customer", ""], ["One-Time Customer", "10/13/2026"]]) {
      const ds = load([[gary(type!, next), "export.csv"]]);
      expect(ds.jobs.map((j) => [j.completedOn, j.status]), `${type} ${next}`).toEqual([["2026-08-01", "active"]]);
      expect(scan(ds).opportunities, `${type} ${next}`).toEqual([]);
    }
    // the same list sent again once nothing is booked: ZenMaid has him down as a Former Customer
    const ds = load([[gary("Recurring Customer", "10/13/2026"), "export.csv"], [gary("Former Customer"), "export.csv"]]);
    expect(scan(ds).opportunities.map((o) => [firstOf(ds, o.customerId), o.type, o.suppressed])).toEqual([["Gary", "one_and_done", undefined]]);
  });

  it("a ZenMaid One-Time Customer with no Next Appointment had their clean: how long ago decides", () => {
    // ZenMaid keeps a client One-Time after their one clean: Paul's was last October, and nothing is booked
    const paul = zenmaidContacts([["8790", "Paul", "Ellis", "paul.ellis@gmail.com", "(603) 555-0108", "10/20/2025", "10/28/2025", "", "One-Time Customer", "0.00", "260.00", "Tuesday", "120 Brook St, Hopkinton, NH 03229", "10/28/2025"]]);
    // a Contacts export without its Next Appointment column ticked
    const linda = toCSV(["Full Name", "Primary Email", "Most Recent Clean", "Type"], [["Linda Whitfield", "linda.whitfield@gmail.com", "08/01/2026", "One-Time Customer"]]);
    for (const [csv, first, on] of [[paul, "Paul", "2025-10-28"], [linda, "Linda", "2026-08-01"]]) {
      const ds = load([[csv!, "export.csv"]]);
      expect(ds.jobs.map((j) => [j.completedOn, j.status]), first).toEqual([[on, "completed"]]);
      expect(scan(ds).opportunities.map((o) => [firstOf(ds, o.customerId), o.type, o.suppressed]), first).toEqual([[first, "one_and_done", undefined]]);
    }
  });

  it("the import says which tool the file came from", () => {
    const st = readFiles(emptyState(emptyDataset(shop(), CLEANING_ASOF), NOW), EXPORTS.flatMap(([, files]) => files.map(([text, name]) => ({ text, name }))), NOW);
    const read = st.events.filter((e) => e.title.startsWith("Read ")).map((e) => e.detail?.replace(/\. Matched.*$/, "").replace(/^[\d,]+ /, ""));
    expect(read).toEqual(["visits from ZenMaid", "visits from BookingKoala", "clients from BookingKoala", "visits from Launch27"]);
    expect(st.dataset.business.software).toBe("zenmaid");
  });
});

describe("a spreadsheet with booking columns but none of a tool's own is read as before", () => {
  it("its Status is the booking's status, and nothing is read as a tool's", () => {
    const sheet = toCSV(
      ["Booking ID", "Customer Name", "Phone number", "Service", "Frequency", "Service date", "Booking amount", "Status"],
      [["901", "Karen Brennan", "6035550102", "Standard Cleaning", "Every 2 Weeks", "07/07/2026", "165.00", "Cancelled"]],
    );
    const t = parseTable(sheet);
    const d = detect(t, "export.csv");
    expect([d.kind, d.source]).toEqual(["visit", "spreadsheet"]);
    expect(t.headers[d.mapping.fields.status!]).toBe("Status");
    expect(load([[sheet, "export.csv"]]).jobs.map((j) => j.status)).toEqual(["cancelled"]);
    // the bookings export the lawn and cleaning readers were built on keeps every column it had
    const lawn = parseTable(bookingsExport(lawnClients()));
    const generic = detect(lawn, "export.csv");
    expect([generic.kind, generic.source]).toEqual(["visit", "spreadsheet"]);
    expect(Object.fromEntries(Object.entries(generic.mapping.fields).map(([f, i]) => [f, lawn.headers[i]]))).toEqual({
      number: "Booking ID", name: "Customer Name", email: "Email", phone: "Phone", address: "Address", city: "City", state: "State", zip: "Zip", title: "Service", jobType: "Frequency", scheduledOn: "Booking Date", total: "Price", status: "Status",
    });
  });

  it("a quote tracker or a client list with a Frequency beside its Date is what it was: no visits done", () => {
    const tracker = toCSV(["Date", "Name", "Email", "Service", "Frequency", "Price", "Status"], [
      ["03/02/2026", "Ann Leclerc", "ann.leclerc@gmail.com", "Deep Cleaning", "One Time", "320.00", "Lost"],
      ["09/22/2026", "Karen Brennan", "karen.brennan@comcast.net", "Standard Cleaning", "One Time", "240.00", "Sent"],
      ["12/04/2025", "Ed Fox", "ed.fox@gmail.com", "Standard Cleaning", "Every 2 Weeks", "150.00", "Sent"],
    ]);
    expect(detect(parseTable(tracker), "export.csv").kind).toBe("quote");
    const quotes = load([[tracker, "export.csv"]]);
    expect([quotes.quotes.map((q) => q.status), quotes.jobs]).toEqual([["declined", "awaiting_response", "awaiting_response"], []]);
    const list = toCSV(["Name", "Email", "Phone", "Address", "Frequency", "Date"], [["Mike Sanderson", "mike.sanderson@gmail.com", "6035550101", "14 Oak Ln", "Weekly", "04/14/2025"]]);
    expect(detect(parseTable(list), "export.csv").kind).toBe("client");
    const clients = load([[list, "export.csv"]]);
    expect([clients.customers.length, clients.jobs, scan(clients).opportunities]).toEqual([1, [], []]);
  });
});

describe("a bookings file's Status is the booking's, whatever tool's columns are beside it", () => {
  // Ruth every four weeks, done through June, the rest of her series cancelled through October; Janet's one booking, cancelled
  const HEAD = ["Booking ID", "Customer Name", "Email", "Service", "Frequency", "Service date", "Booking amount", "Status"];
  const ruth = [
    ...["01/06/2026", "02/03/2026", "03/03/2026", "03/31/2026", "04/28/2026", "05/26/2026", "06/23/2026"].map((d) => [d, "Completed"]),
    ...["07/21/2026", "08/18/2026", "09/15/2026", "10/13/2026"].map((d) => [d, "Cancelled"]),
  ].map(([d, s], i) => [`${901 + i}`, "Ruth Hale", "ruthhale@gmail.com", "Standard Cleaning", "Every 4 Weeks", d!, "175.00", s!]);
  const rows = [...ruth, ["950", "Janet Fortin", "janet.fortin@gmail.com", "Standard Cleaning", "One Time", "09/10/2026", "240.00", "Cancelled"]];
  const VALUE: Record<string, string> = { Provider: "Katelyn Z.", Industry: "Home Cleaning", "Estimated job length": "2 Hr 30 Min" };

  // the shop's bookings on an owner's own sheet, with the clock the crew only took up in August
  const often: Record<Every, string> = { weekly: "Weekly", biweekly: "Every 2 Weeks", every4: "Every 4 Weeks", once: "One Time" };
  const clocked = (states: State[], head: string[], cells: (k: Booking) => string[]) =>
    toCSV(
      [...head, "Customer Name", "Email", "Service", "Frequency", "Price", "Clocked In", "Clocked Out"],
      people.flatMap((b) =>
        b.bookings
          .filter((k) => states.includes(k.state))
          .map((k) => [...cells(k), `${b.first} ${b.last}`, b.email, k.service, often[k.every], k.price.toFixed(2), ...(k.state === "done" && k.date >= "2026-08-01" ? ["09:04 AM", "11:31 AM"] : ["", ""])]),
      ),
    );
  const everyFind = () => Object.entries(FINDS).map(([first, [type, serviceId]]) => [first, type, serviceId, undefined]).sort();

  it.each([
    ["no tool's column", [], "spreadsheet"],
    ["BookingKoala's travel time beside it, so the clock is read", ["Travel time"], "bookingkoala"],
  ] as [string, string[], SourceSystem][])("an owner's sheet with a clock and %s: Completed is a clean done, and Scheduled one still to come", (_what, extra, source) => {
    const csv = clocked(["done", "ahead"], ["Booking ID", "Service date", "Status", ...extra], (k) => [`${k.id}`, k.date, k.state === "done" ? "Completed" : "Scheduled", ...extra.map(() => "0 Hr 20 Min")]);
    const t = parseTable(csv);
    const d = detect(t, "export.csv");
    expect([d.source, d.mapping.fields.clockedIn === undefined ? undefined : t.headers[d.mapping.fields.clockedIn]]).toEqual([source, source === "bookingkoala" ? "Clocked In" : undefined]);
    const ds = load([[csv, "export.csv"]]);
    const book = visitBook(ds);
    const said = (status: string) => ds.jobs.filter((j) => j.rawStatus === status);
    expect(said("Completed").filter((j) => j.status !== "completed" || !book.worked(j))).toEqual([]);
    expect(said("Scheduled").filter((j) => !book.ahead(j))).toEqual([]);
    const found = scan(ds).opportunities.map((o) => [firstOf(ds, o.customerId), o.type, o.serviceId, o.suppressed]);
    expect(found.sort()).toEqual(everyFind());
  });

  it("an owner's log of the cleans done, with a clock and no Status, is a spreadsheet: a clean before the clock is still a clean", () => {
    const csv = clocked(["done"], ["Visit Date"], (k) => [k.date]);
    const t = parseTable(csv);
    const d = detect(t, "export.csv");
    expect([d.kind, d.source, d.mapping.fields.clockedIn, d.mapping.fields.status]).toEqual(["visit", "spreadsheet", undefined, undefined]);
    const ds = load([[csv, "export.csv"]]);
    const book = visitBook(ds);
    expect(ds.jobs.filter((j) => j.undone || !book.worked(j))).toEqual([]);
    expect(scan(ds).opportunities.map((o) => [firstOf(ds, o.customerId), o.type, o.serviceId, o.suppressed]).sort()).toEqual(everyFind());
  });

  it.each([
    ["no column of a tool's", [], "spreadsheet"],
    ["who cleaned it", ["Provider"], "spreadsheet"],
    ["its industry", ["Industry"], "spreadsheet"],
    ["BookingKoala's own columns (its booking CSV)", ["Provider", "Industry", "Estimated job length"], "bookingkoala"],
  ] as [string, string[], SourceSystem][])("with %s", (_what, extra, source) => {
    const csv = toCSV([...HEAD, ...extra], rows.map((r) => [...r, ...extra.map((h) => VALUE[h]!)]));
    const t = parseTable(csv);
    const d = detect(t, "export.csv");
    expect([d.kind, d.source, t.headers[d.mapping.fields.status!]]).toEqual(["visit", source, "Status"]);
    const ds = load([[csv, "export.csv"]]);
    expect(ds.jobs.filter((j) => j.status === "cancelled")).toHaveLength(5);
    // the cancelled rest of Ruth's series never makes her a regular still coming, and Janet was never cleaned for
    expect(scan(ds).opportunities.map((o) => [firstOf(ds, o.customerId), o.type, o.serviceId, o.anchorDate, o.suppressed])).toEqual([["Ruth", "lapsed_regular", "clean.recurring", "2026-06-23", undefined]]);
  });
});

describe.each(EXPORTS)("%s: a cleaning shop's export", (_source, files) => {
  const ds = load(files);
  const r = scan(ds);

  it("finds the regulars who stopped, the one-time clean to put on a schedule, and last fall's one-time client", () => {
    for (const [first, [type, serviceId]] of Object.entries(FINDS)) expect(foundFor(ds, r.opportunities, first), first).toEqual([[type, serviceId, undefined]]);
    const lapsed = (first: string) => r.opportunities.find((o) => o.customerId === idOf(ds, first) && o.type === "lapsed_regular")!;
    expect([lapsed("Karen").anchorDate, lapsed("Ruth").anchorDate]).toEqual(["2026-07-07", "2026-06-23"]);
  });

  it("flags nobody still on the schedule, and nobody whose only booking was cancelled", () => {
    for (const first of NOT_FLAGGED) if (ds.customers.some((c) => c.firstName === first)) expect(foundFor(ds, r.opportunities, first), first).toEqual([]);
    expect(r.opportunities).toHaveLength(Object.keys(FINDS).length);
  });

  it("reads each client's rhythm from the frequency column", () => {
    const rhythm = (first: string) => [...new Set(ds.jobs.filter((j) => j.customerId === idOf(ds, first)).map((j) => j.everyDays ?? (j.recurring === false ? "once" : "?")))];
    const monthly = _source === "launch27" ? 30 : 28;
    expect(["Mike", "Karen", "Donna", "Gary", "Ruth", "Brian", "Linda", "Paul"].map(rhythm)).toEqual([[7], [14], [14], [monthly], [monthly], [14], ["once"], ["once"]]);
  });

  it("writes each one the note that fits: the regular cleaning, and a one-time clean put on a schedule", () => {
    const [karen] = notes(ds, r.opportunities.find((o) => o.customerId === idOf(ds, "Karen"))!);
    expect(main(karen!)).toBe(
      "Hi Karen,\n\nSarah at Sparkle House Cleaning. We haven't been by for the regular cleaning since July 7, and I wanted to make sure you're all set.\n\nWant us back on your usual schedule? Reply with a day that works and I'll put you back on.\n\nSarah",
    );
    const [linda, again] = notes(ds, r.opportunities.find((o) => o.customerId === idOf(ds, "Linda"))!);
    expect(main(linda!)).toContain("We did the cleaning for you last week. If you'd like the house to stay that way, we can come back every week, every other week or once a month.\n\nWant it on a regular schedule? Reply with what works and I'll set it up.");
    expect(main(again!)).toContain("Want it on a regular schedule? Just reply and I'll set it up.");
    for (const n of [karen!, linda!, again!]) {
      expect(n.flags).toEqual([]);
      expect(n.body).toContain("14 Mill Rd, Concord, NH 03301");
    }
  });

  it("plans every one of them, the one-time-to-regular note included, and nobody else", () => {
    const st = emptyState(ds, NOW);
    find(st, NOW);
    const planned = planBatch(st, NOW, { startOn: CLEANING_ASOF, approve: true }).people.map((id) => firstOf(ds, id));
    expect(planned.sort()).toEqual(Object.keys(FINDS).sort());
  });
});

describe("ZenMaid's appointment statuses", () => {
  const ds = load(EXPORTS[0]![1]);
  const book = visitBook(ds);
  const of = (first: string, on: string) => ds.jobs.find((j) => j.customerId === idOf(ds, first) && j.scheduledOn === on)!;

  it("Completed is work done; Cancelled never is, and never puts a regular back on the schedule", () => {
    expect([of("Karen", "2026-07-07").status, book.worked(of("Karen", "2026-07-07"))]).toEqual(["completed", true]);
    // Mike's week off in July, Karen's cancelled series and the one booking Janet ever made
    for (const j of [of("Mike", "2026-07-02"), of("Karen", "2026-07-21"), of("Janet", "2026-09-10")]) expect([j.status, book.worked(j), book.ahead(j)]).toEqual(["cancelled", false, false]);
    // the rest of Ruth's series is still on the calendar, cancelled, through October: she is no regular still coming
    const ruth = ds.jobs.filter((j) => j.customerId === idOf(ds, "Ruth") && j.scheduledOn! > "2026-06-23");
    expect(ruth.map((j) => [j.scheduledOn, j.status, book.ahead(j)])).toEqual(["2026-07-21", "2026-08-18", "2026-09-15", "2026-10-13"].map((d) => [d, "cancelled", false]));
    expect(foundFor(ds, scan(ds).opportunities, "Ruth")).toEqual([["lapsed_regular", "clean.recurring", undefined]]);
  });

  it("Active is a visit still to come, or one gone by that isn't marked yet; Locked Out went by undone", () => {
    expect([of("Mike", "2026-10-01").status, book.ahead(of("Mike", "2026-10-01"))]).toEqual(["active", true]);
    // last Thursday's visit, not marked yet, the week after every visit before it was marked Completed
    expect([of("Mike", "2026-09-24").status, book.missed(of("Mike", "2026-09-24")), book.worked(of("Mike", "2026-09-24"))]).toEqual(["active", false, true]);
    const lockout = of("Donna", "2026-08-10");
    expect([lockout.rawStatus, lockout.undone, book.worked(lockout)]).toEqual(["Locked Out", true, false]);
  });

  it("never takes the subscription's end for a visit's day", () => {
    expect(ds.jobs.filter((j) => j.completedOn && j.completedOn !== j.scheduledOn)).toEqual([]);
  });
});

describe("BookingKoala's two exports", () => {
  const [logs, customers] = EXPORTS[1]![1];
  const history = (ds: Dataset) => ds.jobs.map((j) => [firstOf(ds, j.customerId), j.scheduledOn, j.title, j.total, j.everyDays].join("|")).sort();

  it("the time logs and the Customers export, in either order, give the same clients and the same visits", () => {
    const a = load([logs!, customers!]);
    const b = load([customers!, logs!]);
    expect(a.customers).toHaveLength(9);
    expect(b.customers).toHaveLength(9);
    const contact = (ds: Dataset) => ds.customers.map((c) => [c.name, c.emails.join(), c.phones.join()].join("|")).sort();
    expect(contact(a)).toEqual(contact(b));
    expect(history(a)).toEqual(history(b));
    // Linda's time log has no phone: she's joined to her customer record by her name
    expect(a.customers.find((c) => c.firstName === "Linda")!.emails).toEqual(["linda.whitfield@gmail.com"]);
  });

  it("a log someone clocked in on is work done, whatever its approval says, and a job two providers logged is one visit", () => {
    const ds = load([logs!, customers!]);
    const book = visitBook(ds);
    const janet = ds.jobs.filter((j) => j.customerId === idOf(ds, "Janet"));
    expect(ds.jobs.filter((j) => !janet.includes(j)).every((j) => j.status === "completed" && book.worked(j))).toBe(true);
    expect(ds.jobs.filter((j) => j.title === "Deep Cleaning").map((j) => [firstOf(ds, j.customerId), j.scheduledOn, j.total])).toEqual([["Brian", "2026-09-08", 260]]);
    // the log made when the provider tapped On the Way to Janet's, the clean she cancelled at the door: nobody clocked in
    expect(janet.map((j) => [j.scheduledOn, j.undone, book.worked(j), book.ahead(j)])).toEqual([["2026-09-10", true, false, false]]);
  });

  it("a log whose hours the office rejected is no clean done", () => {
    const linda = (status: string) =>
      toCSV(["Booking id", "Service date", "Customer", "Provider", "Service", "Frequency", "Booking amount", "Clocked in", "Status"], [["5101", "09/23/2026", "Linda Whitfield", "Jason Lee", "Standard Cleaning", "One Time", "280.00", "09:04 AM", status]]);
    const asked = (status: string) => {
      const ds = load([[linda(status), "booking_time_logs.csv"], customers!]);
      return scan(ds).opportunities.map((o) => [firstOf(ds, o.customerId), o.type, o.serviceId]);
    };
    for (const status of ["Pending", "Approved - Time reported with lunch break", "Approved - Time reported & travel time"]) expect(asked(status), status).toEqual([["Linda", "missed_upsell", "clean.recurring"]]);
    expect(asked("Rejected")).toEqual([]);
  });

  it("the time logs alone have no email to write to: the Customers export brings them", () => {
    const ds = load([logs!]);
    expect(ds.customers.every((c) => !c.emails.length)).toBe(true);
    expect(scan(ds).opportunities.map((o) => o.suppressed)).toEqual(Object.keys(FINDS).map(() => "no_contact_info"));
  });
});

describe("Launch27's booking CSV, active bookings only", () => {
  it("a day gone by is a visit done, and one still to come keeps the client on the schedule", () => {
    const ds = load(EXPORTS[2]![1]);
    const book = visitBook(ds);
    const mike = ds.jobs.filter((j) => j.customerId === idOf(ds, "Mike"));
    expect(mike.filter((j) => book.ahead(j)).map((j) => j.scheduledOn)).toEqual(["2026-10-01", "2026-10-08"]);
    expect(mike.filter((j) => j.scheduledOn! <= CLEANING_ASOF).every((j) => book.worked(j))).toBe(true);
    // his week off in July was cancelled, so it isn't in the file at all
    expect(mike.some((j) => j.scheduledOn === "2026-07-02")).toBe(false);
  });
});

describe("the frequency words cleaning tools write", () => {
  it("each gives its gap in days, a one-time booking none, and a blank one says nothing", () => {
    const words: [string, number | "once" | undefined][] = [
      ["Weekly", 7], ["weekly", 7], ["Every 2 Weeks", 14], ["every 2 weeks", 14], ["Every other week", 14], ["Bi-Weekly", 14], ["Tri-Weekly", 21], ["Every 4 Weeks", 28], ["every 5 weeks", 35],
      ["every 7 weeks", 49], ["Monthly", 30], ["One Time", "once"], ["one time", "once"], ["", undefined],
    ];
    const csv = toCSV(["Booking ID", "Customer Name", "Email", "Frequency", "Booking Date", "Price", "Status"], words.map(([w], i) => [700 + i, `Client${String.fromCharCode(65 + i)} Test`, `c${i}@gmail.com`, w, "09/15/2026", "150.00", "Completed"]));
    const ds = load([[csv, "Bookings.csv"]]);
    const gap = (i: number) => {
      const j = ds.jobs.find((x) => x.customerId === ds.customers.find((c) => c.emails.includes(`c${i}@gmail.com`))!.id)!;
      return j.everyDays ?? (j.recurring === false ? "once" : j.recurring);
    };
    expect(words.map((_, i) => gap(i))).toEqual(words.map(([, want]) => want));
  });
});

describe("a booking whose title names no service ('Standard Cleaning')", () => {
  it("is the regular cleaning when it recurs and a one-time clean when it was booked once; a title that names one decides", () => {
    const svc = (title: string, recurring?: boolean, trade: Parameters<typeof classifyWork>[1] = ["cleaning"]) => classifyWork({ title, recurring }, trade).service.id;
    expect(svc("Standard Cleaning", true)).toBe("clean.recurring");
    expect(svc("Standard Cleaning", false)).toBe("clean.once");
    expect(svc("", false)).toBe("clean.once");
    expect(svc("Standard Cleaning")).toBe("gen.work");
    expect(svc("Deep Cleaning", false)).toBe("clean.deep");
    expect(svc("Move Out Cleaning", true)).toBe("clean.move");
    // other trades have no regular or one-time service of that name: their work keeps its own words
    expect(svc("Visit", true, ["tree"])).toBe("gen.work");
    expect(svc("Visit", false, ["lawn"])).toBe("gen.work");
  });

  it("asks a one-time client about a regular schedule within about ten days, never a client already on one", () => {
    const HEAD = "Booking ID,Customer Name,Email,Service,Frequency,Booking Date,Price,Status";
    const ask = (rows: string[]) => {
      const ds = load([[[HEAD, ...rows].join("\n"), "Bookings.csv"]]);
      return scan(ds).opportunities.filter((o) => o.type === "missed_upsell" && !o.suppressed).map((o) => [firstOf(ds, o.customerId), o.serviceId]);
    };
    const on = (days: number) => addDays(CLEANING_ASOF, -days);
    expect(ask([`1,Linda Whitfield,linda@gmail.com,Standard Cleaning,One Time,${on(1)},280.00,Completed`])).toEqual([]);
    expect(ask([`1,Linda Whitfield,linda@gmail.com,Standard Cleaning,One Time,${on(6)},280.00,Completed`])).toEqual([["Linda", "clean.recurring"]]);
    // a booking that was cancelled was never a clean to follow up
    expect(ask([`1,Linda Whitfield,linda@gmail.com,Standard Cleaning,One Time,${on(6)},280.00,Cancelled`])).toEqual([]);
    // a first visit of a schedule, and a one-time clean with the schedule booked after it
    expect(ask([`1,Brian Irwin,brian@gmail.com,Standard Cleaning,Every 2 Weeks,${on(6)},150.00,Completed`])).toEqual([]);
    expect(ask([`1,Brian Irwin,brian@gmail.com,Standard Cleaning,One Time,${on(20)},280.00,Completed`, `2,Brian Irwin,brian@gmail.com,Standard Cleaning,Every 2 Weeks,${on(6)},150.00,Completed`])).toEqual([]);
  });
});
