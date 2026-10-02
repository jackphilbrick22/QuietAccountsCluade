/**
 * What a cleaning shop sends instead of Jobber's Visits report: ZenMaid's Appointments export, BookingKoala's Booking
 * Time Logs and Customers exports, and Launch27's booking CSV. Each has only the columns, words and date formats its
 * tool's help pages show (the pages, and the day they were read, sit above each writer). The same shop's clients and
 * bookings are in all of them, each written the way its tool writes them:
 * - a weekly regular still coming (one week cancelled in July, last week's visit not marked done yet), a regular every
 *   other week with no email, one every four weeks, and one new this month who started with a deep clean;
 * - a regular every other week who cancelled her series in July, and one every four weeks who stopped in June, the rest
 *   of her series still on the calendar, cancelled, through October;
 * - a one-time clean last week, a one-time clean last fall, and a one-time booking that was cancelled.
 */
import { toCSV } from "../src/ingest/csv.ts";
import type { BreakageType, ISODate } from "../src/model.ts";
import { addDays } from "../src/util.ts";
import { CLEANING_ASOF } from "./lawn-fixtures.ts";

export { CLEANING_ASOF };

export type Every = "weekly" | "biweekly" | "every4" | "once";
/** Done; gone by but not marked done yet; cancelled; locked out (the cleaner couldn't get in); still to come. */
export type State = "done" | "unmarked" | "cancelled" | "lockedOut" | "ahead";

export interface Booking {
  id: number;
  date: ISODate;
  service: string;
  every: Every;
  price: number;
  team: "Team A" | "Team B";
  state: State;
}

export interface Booker {
  first: string;
  last: string;
  email: string;
  /** Ten digits, the way BookingKoala's sample writes a phone. */
  phone: string;
  street: string;
  city: string;
  zip: string;
  bookings: Booking[];
}

/**
 * Who each export finds, by first name, and the service each is about: the regulars who stopped, the one-time clean to
 * put on a schedule, and last fall's one-time client (plain work, no service named).
 */
export const FINDS: Record<string, [BreakageType, string]> = {
  Karen: ["lapsed_regular", "clean.recurring"],
  Ruth: ["lapsed_regular", "clean.recurring"],
  Linda: ["missed_upsell", "clean.recurring"],
  Paul: ["one_and_done", "gen.work"],
};
/** Still on the schedule, or never cleaned for: nothing to write to them about. */
export const NOT_FLAGGED = ["Mike", "Donna", "Gary", "Brian", "Janet"];

function every(from: ISODate, to: ISODate, days: number): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, days)) out.push(d);
  return out;
}

const PLACES: [string, string, string][] = [
  ["14 Oak Ln", "Concord", "03301"], ["212 Pine St", "Concord", "03301"], ["9 Maple Ave", "Bow", "03304"], ["47 Birch Rd", "Hopkinton", "03229"],
  ["3 Elm St", "Concord", "03301"], ["88 Cedar Dr", "Bow", "03304"], ["16 Hilltop Rd", "Concord", "03301"], ["120 Brook St", "Hopkinton", "03229"], ["5 Mill Rd", "Concord", "03301"],
];

/** The shop's clients and every booking each one has, oldest first. */
export function cleaningBookers(): Booker[] {
  let id = 4100;
  const booked = (dates: ISODate[], service: string, often: Every, price: number, team: Booking["team"], state: (d: ISODate) => State = (d) => (d <= CLEANING_ASOF ? "done" : "ahead")): Booking[] =>
    dates.map((date) => ({ id: id++, date, service, every: often, price, team, state: state(date) }));
  const person = (i: number, first: string, last: string, email: string, bookings: Booking[]): Booker => {
    const [street, city, zip] = PLACES[i]!;
    return { first, last, email, phone: `603555${String(101 + i).padStart(4, "0")}`, street, city, zip, bookings };
  };
  return [
    person(0, "Mike", "Sanderson", "mike.sanderson@gmail.com",
      booked(every("2026-06-04", "2026-10-08", 7), "Standard Cleaning", "weekly", 140, "Team A", (d) => (d === "2026-07-02" ? "cancelled" : d === "2026-09-24" ? "unmarked" : d <= CLEANING_ASOF ? "done" : "ahead"))),
    person(1, "Karen", "Brennan", "karen.brennan@comcast.net", [
      ...booked(every("2026-02-03", "2026-07-07", 14), "Standard Cleaning", "biweekly", 165, "Team B"),
      ...booked(["2026-07-21"], "Standard Cleaning", "biweekly", 165, "Team B", () => "cancelled"),
    ]),
    person(2, "Donna", "Duval", "", booked(every("2026-06-01", "2026-10-05", 14), "Standard Cleaning", "biweekly", 150, "Team B", (d) => (d === "2026-08-10" ? "lockedOut" : d <= CLEANING_ASOF ? "done" : "ahead"))),
    person(3, "Gary", "Gagnon", "gary.gagnon@yahoo.com", booked(every("2026-03-24", "2026-10-13", 28), "Standard Cleaning", "every4", 185, "Team A")),
    person(4, "Ruth", "Hale", "ruthhale@gmail.com", [
      ...booked(every("2026-01-06", "2026-06-30", 28), "Standard Cleaning", "every4", 175, "Team A"),
      ...booked(every("2026-07-21", "2026-10-13", 28), "Standard Cleaning", "every4", 175, "Team A", () => "cancelled"),
    ]),
    person(5, "Brian", "Irwin", "brian.irwin@outlook.com", [
      ...booked(["2026-09-08"], "Deep Cleaning", "biweekly", 260, "Team A"),
      ...booked(["2026-09-22", "2026-10-06"], "Standard Cleaning", "biweekly", 150, "Team A"),
    ]),
    person(6, "Linda", "Whitfield", "linda.whitfield@gmail.com", booked(["2026-09-23"], "Standard Cleaning", "once", 280, "Team B")),
    person(7, "Paul", "Ellis", "paul.ellis@gmail.com", booked(["2025-10-28"], "Standard Cleaning", "once", 260, "Team B")),
    person(8, "Janet", "Fortin", "janet.fortin@gmail.com", booked(["2026-09-10"], "Standard Cleaning", "once", 240, "Team A", () => "cancelled")),
  ];
}

/** Every booking with whose it is, by day. */
function bookingsOf(bookers: Booker[], keep: (k: Booking) => boolean = () => true) {
  return bookers.flatMap((b) => b.bookings.filter(keep).map((k) => ({ b, k }))).sort((x, y) => (x.k.date < y.k.date ? -1 : x.k.date > y.k.date ? 1 : x.k.id - y.k.id));
}

/** "09/24/2026": how all three tools write a day. */
function usDate(d: ISODate): string {
  return `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
}

/**
 * ZenMaid's Appointments export (Reports → Data exports → Export data → Appointments), as it arrives by email, with
 * every column its dialog ticks by default: the customer's Balance and what was Paid among them. Columns from the
 * dialog on https://www.zenmaid.com/answers/en/articles/5085915-how-to-run-exports-from-zenmaid ("Uncheck the boxes of
 * information you don't need"); Customer Full Name and Recurrence ("weekly", "every 2 weeks", "one time"), past where
 * that dialog scrolls, and the file's name on
 * https://zenmaid.com/answers/en/articles/8688544-how-to-compare-months-for-gained-lost-recurring-customers-using-the-appointment-export,
 * the statuses (Active, Completed, Cancelled, Locked Out) and MM/DD/YYYY dates on
 * https://zenmaid.com/answers/en/articles/9764809-how-to-create-a-cancellation-report. No page shows what the money
 * columns hold: here they're amounts. A one-time booking has no Subscription ID, and its Recurrence is `once`: "one
 * time", or blank, which the compare-months page counts as no recurring service too. Read 2026-10-01.
 */
export const ZENMAID_FILE = "2026-09-29_sparklehousecleaning_gmail_com_ZENMAID_appointments_export.csv";
export function zenmaidAppointments(bookers = cleaningBookers(), once = "one time"): string {
  const recurrence: Record<Every, string> = { weekly: "weekly", biweekly: "every 2 weeks", every4: "every 4 weeks", once };
  const status: Record<State, string> = { done: "Completed", unmarked: "Active", ahead: "Active", cancelled: "Cancelled", lockedOut: "Locked Out" };
  const first = new Set(bookers.map((b) => b.bookings[0]!.id));
  return toCSV(
    [
      "Appointment ID", "Appointment Date", "Start Time", "End Time", "Subscription ID", "Price", "Price with Tax", "Overcharge", "Discount", "Tip", "Applied Coupon Codes",
      "Secondary Tax Label", "Paid", "Appointment Status", "Rating", "Rating Message", "Team Name", "Address Line1", "Address Line2", "Address Postal Code", "Address City", "Address State",
      "Customer First Name", "Customer Last Name", "Customer Company Name", "Customer Emails", "Customer Balance", "Subscription End Date", "Latest Appointment Date",
      "Latest Appointment Start Time", "Latest Appointment End Time", "Is First Clean?", "Notes", "Customer Full Name", "Recurrence",
    ],
    bookingsOf(bookers).map(({ b, k }) => {
      const series = k.every !== "once";
      // a series cancelled for good ends where the cancelled bookings at its end start
      const kept = b.bookings.filter((x) => x.state !== "cancelled").at(-1);
      const tail = b.bookings.find((x) => !kept || x.date > kept.date);
      const ended = series && tail ? usDate(tail.date) : "";
      const price = k.price.toFixed(2);
      return [
        k.id, usDate(k.date), "09:00 AM", "11:30 AM", series ? 300 + bookers.indexOf(b) : "", price, price, "0.00", "0.00", "0.00", "",
        "", k.state === "done" ? price : "0.00", status[k.state], "", "", k.team, b.street, "", b.zip, b.city, "NH",
        b.first, b.last, "", b.email, "0.00", ended, usDate((kept ?? k).date),
        "09:00 AM", "11:30 AM", first.has(k.id) ? "Yes" : "No", b.first === "Donna" ? "Gate code 4411" : "", `${b.first} ${b.last}`, recurrence[k.every],
      ];
    }),
  );
}

const PROVIDER: Record<Booking["team"], string> = { "Team A": "Katelyn Z.", "Team B": "Jason Lee" };
const BK_FREQUENCY: Record<Every, string> = { weekly: "Weekly", biweekly: "Every 2 Weeks", every4: "Every 4 Weeks", once: "One Time" };

/**
 * BookingKoala's Booking Time Logs export (Bookings → Booking Time Logs → Export, sorted by booking ID and date), from a
 * shop that has clocking in and out turned on: one log per provider for each job worked, so a job two providers did is
 * two rows, and one for Janet's clean, made when the provider tapped On the Way: she cancelled at the door, so nobody
 * clocked in. Columns, the sample's dates (04/04/2022), times (09:00 AM), phones (7735553922, or blank) and provider
 * status (Active) on https://help.bookingkoala.com/help/booking-time-logs; the frequencies on
 * https://help.bookingkoala.com/help/reports-overview. Its Status is the log's approval: Approved (with or without the
 * lunch break), or Pending until the office checks the hours. No email column. Read 2026-10-01.
 */
export function bookingKoalaTimeLogs(bookers = cleaningBookers()): string {
  const logged = bookingsOf(bookers).filter(({ b, k }) => k.state === "done" || k.state === "unmarked" || (b.first === "Janet" && k.state === "cancelled"));
  return toCSV(
    ["Booking id", "Service date", "Service time", "Customer", "Phone number", "Provider", "Provider status", "Industry", "Service", "Frequency", "Booking amount", "Clocked in", "Clocked out", "Time reported", "Status"],
    logged.flatMap(({ b, k }) => {
      // the deep clean that started Brian's schedule took two providers
      const providers = k.service === "Deep Cleaning" ? ["Katelyn Z.", "Jason Lee"] : [PROVIDER[k.team]];
      const atDoor = k.state === "cancelled";
      return providers.map((p) => [
        k.id, usDate(k.date), "09:00 AM", `${b.first} ${b.last}`, b.first === "Linda" ? "" : b.phone, p, "Active", "Home Cleaning", k.service, BK_FREQUENCY[k.every], k.price.toFixed(2),
        ...(atDoor ? ["", "", ""] : ["09:04 AM", "11:31 AM", "2 Hr 27 Min"]),
        atDoor || k.date >= "2026-09-21" ? "Pending" : "Approved - Time reported without lunch break",
      ]);
    }),
  );
}

/**
 * BookingKoala's Customers export (Customers → Customers → Export, all customers): the fields its dialog ticks by
 * default, and the counts of bookings ticked too. Names, emails, phones and addresses, never the date of a booking.
 * Fields on https://help.bookingkoala.com/help/how-to-export-customer-data. Read 2026-10-01.
 */
export function bookingKoalaCustomers(bookers = cleaningBookers()): string {
  return toCSV(
    [
      "First Name", "Last Name", "Full Name", "Company Name", "Email Address", "Additional Email Addresse(s)", "Phone Number", "Additional Phone Number(s)", "Gender", "Note", "Address", "Apt. No.",
      "City", "State", "Zip/Postal Code", "Referral Code", "Created On", "Number Of Bookings", "Number Of Active Bookings", "Number Of Cancelled Bookings",
    ],
    bookers.map((b) => [
      b.first, b.last, `${b.first} ${b.last}`, "", b.email, "", b.phone, "", "", b.first === "Donna" ? "Gate code 4411" : "", b.street, "",
      b.city, "NH", b.zip, "", usDate(addDays(b.bookings[0]!.date, -6)),
      b.bookings.length, b.bookings.filter((k) => k.state === "ahead").length, b.bookings.filter((k) => k.state === "cancelled").length,
    ]),
  );
}

/**
 * Launch27's booking CSV (Bookings → Download CSV, a date range, the fields ticked): active bookings only, done and still
 * to come; a cancelled booking, or one cancelled after a lockout, isn't in it. The standard fields its picker shows
 * (Date, Time, First Name, Last Name, Email, Address, City, State, Postal Code, Phone) and its MM/DD/YYYY dates on
 * https://intercom.help/Launch27/en/articles/4460462-export-booking-data and
 * https://intercom.help/Launch27/en/articles/4259709-export-account-data-overview; a booking's Service, Frequency and
 * Final Price as https://intercom.help/Launch27/en/articles/4256720-zapier-integration-overview names them; the
 * frequencies (Weekly, Every 2 Weeks, Bi-Weekly, Monthly, One Time) on
 * https://intercom.help/Launch27/en/articles/4259718-active-bookings-page-overview and
 * https://intercom.help/Launch27/en/articles/4259686-how-recurring-bookings-work. Read 2026-10-01.
 */
export function launch27Bookings(bookers = cleaningBookers()): string {
  const frequency = (b: Booker, often: Every) => (often === "biweekly" ? (b.first === "Donna" ? "Bi-Weekly" : "Every 2 Weeks") : { weekly: "Weekly", every4: "Monthly", once: "One Time" }[often]);
  const phone = (p: string) => `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
  return toCSV(
    ["Date", "Time", "First Name", "Last Name", "Email", "Address", "City", "State", "Postal Code", "Phone", "Service", "Frequency", "Final Price"],
    bookingsOf(bookers, (k) => k.state !== "cancelled" && k.state !== "lockedOut").map(({ b, k }) => [
      usDate(k.date), "9:00 AM", b.first, b.last, b.email, b.street, b.city, "NH", b.zip, phone(b.phone), k.service, frequency(b, k.every), k.price.toFixed(2),
    ]),
  );
}
