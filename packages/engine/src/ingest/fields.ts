import type { RecordKind, SourceSystem } from "../model.ts";

/**
 * Canonical fields and every header spelling we have seen for them.
 * Order inside `names` matters: earlier names win ties.
 * `not` lists header patterns that must never map to the field
 * (e.g. "Email sent date" is not an email address).
 */
export type Field =
  // who
  | "clientId"
  | "name"
  | "firstName"
  | "lastName"
  | "company"
  | "email"
  | "phone"
  | "mobile"
  | "address"
  | "street"
  | "street2"
  | "city"
  | "state"
  | "zip"
  | "tags"
  | "leadSource"
  | "marketingOptOut"
  | "smsOptIn"
  | "clientCreatedOn"
  | "clientStatus"
  | "clientType"
  // what
  | "number"
  | "title"
  | "description"
  | "lineItems"
  | "total"
  | "subtotal"
  | "balance"
  | "perVisit"
  | "done"
  | "clockedIn"
  | "series"
  | "status"
  | "outcome"
  | "salesperson"
  | "quoteNumber"
  | "jobNumber"
  | "jobType"
  | "crew"
  // when
  | "createdOn"
  | "sentOn"
  | "approvedOn"
  | "convertedOn"
  | "archivedOn"
  | "changesRequestedOn"
  | "scheduledOn"
  | "completedOn"
  | "issuedOn"
  | "dueOn"
  | "paidOn"
  | "assessmentOn"
  | "viewedOn"
  | "lastJobOn"
  | "nextVisitOn";

export interface FieldSpec {
  names: string[];
  not?: RegExp;
  /** Value sniffers used to break ties or find unlabeled columns. */
  looks?: "email" | "phone" | "money" | "date" | "zip" | "state" | "ref";
}

export const FIELDS: Record<Field, FieldSpec> = {
  clientId: { names: ["client id", "customer id", "client #", "customer #", "client number", "customer number", "account id", "account number", "contact id"] },
  name: {
    names: ["client name", "customer name", "client", "customer", "name", "full name", "contact name", "contact", "display name", "billing name", "homeowner"],
    not: /(company|business|salesperson|sales person|assigned|user|team|employee|technician|tech|crew|created by|property|job name|quote name|estimate name|file|product|service|item)/i,
  },
  firstName: { names: ["first name", "firstname", "first", "given name", "client first name", "customer first name", "contact first name"], not: /(company|user|tech)/i },
  // "Last Cleaning", "Last Appointment": a last anything but a name is a date
  lastName: { names: ["last name", "lastname", "last", "surname", "family name", "client last name", "customer last name", "contact last name"], not: /(company|user|tech|visit|date|job|service)|^last (?!name\b)/i },
  company: { names: ["company name", "company", "business name", "organization", "organisation"], not: /(my company|your company)/i },
  email: {
    names: ["client email", "customer email", "email", "email address", "e-mail", "primary email", "contact email", "emails", "billing email"],
    not: /(sent|opened|date|status|campaign|subject|template|delivered|count|bounced|marketing)/i,
    looks: "email",
  },
  phone: {
    names: ["client phone", "customer phone", "phone", "phone number", "primary phone", "main phone", "home phone", "phone numbers", "work phone", "telephone"],
    not: /(mobile|cell|sms|text|fax|date|ext)/i,
    looks: "phone",
  },
  mobile: { names: ["mobile", "mobile phone", "cell", "cell phone", "mobile number", "sms number", "text number"], not: /(opt|consent|date)/i, looks: "phone" },
  address: {
    names: ["property", "property address", "service address", "job address", "address", "full address", "billing address", "service location", "location", "site address"],
    not: /(email|ip|web|url|city|state|zip|postal|street 2|line 2|name)/i,
  },
  street: {
    names: ["street", "street 1", "street1", "address 1", "address line 1", "service street", "property street", "billing street", "street address", "service street 1", "property street 1"],
    not: /(2|two)$/i,
  },
  street2: { names: ["street 2", "street2", "address 2", "address line 2", "service street 2", "property street 2", "unit", "apt"] },
  city: { names: ["city", "service city", "property city", "billing city", "town", "municipality"] },
  state: { names: ["state", "province", "service state", "property state", "billing state", "state/province", "region"], not: /(status|statement)/i, looks: "state" },
  zip: { names: ["zip", "zip code", "postal code", "postcode", "service zip", "property zip", "billing zip", "zip/postal code"], looks: "zip" },
  tags: { names: ["tags", "client tags", "customer tags", "labels", "tag"] },
  leadSource: { names: ["lead source", "source", "referral source", "how did you hear", "how did you hear about us", "marketing source", "campaign source"] },
  marketingOptOut: { names: ["do not contact", "do not email", "unsubscribed", "marketing opt out", "opted out", "email opt out", "no marketing"] },
  smsOptIn: { names: ["sms opt in", "text opt in", "sms consent", "receives sms", "texting consent", "sms marketing"] },
  clientCreatedOn: { names: ["client created", "client created date", "customer since", "customer created", "created date (client)", "client since"] },
  clientStatus: { names: ["client status", "customer status", "lead status", "is lead", "lead or client"] },
  // How a booking tool files a client (ZenMaid's contact Type), read for whether a visit is on the calendar
  // (BOOKED_CLIENT). Only a tool's own column is read as one (VENDOR_COLUMNS), never a spelling: an owner's "Customer
  // Status" saying "Recurring customer" is how they came, not that a visit is booked.
  clientType: { names: [] },

  number: {
    // "Num" is QuickBooks' own report column for the estimate or invoice number
    names: ["quote #", "quote number", "quote no", "estimate #", "estimate number", "estimate no", "estimate id", "opportunity number", "job #", "job number", "invoice #", "invoice number", "invoice no", "request #", "number", "#", "id", "doc number", "document number", "ref", "reference", "num"],
    not: /(client|customer|phone|zip|account|property|visit|po)/i,
    looks: "ref",
  },
  title: {
    names: ["title", "quote title", "job title", "estimate title", "subject", "job name", "estimate name", "quote name", "service", "services", "service type", "job description", "summary", "work description", "job", "work", "work to do", "task", "item", "what"],
    not: /(client|customer|email subject|#|number|no$|id$)/i,
  },
  description: { names: ["description", "details", "notes", "internal notes", "job details", "instructions", "memo", "message"], not: /(line item)/i },
  lineItems: { names: ["line items", "line item", "items", "products & services", "products and services", "products/services", "line item names", "services performed", "option"] },
  total: {
    // Jobber's Visits report: "One-off job ($)" is a one-off job's price split across its visits
    names: ["total", "quote total", "estimate total", "job total", "invoice total", "total ($)", "total amount", "amount", "grand total", "value", "price", "total price", "total value", "revenue", "estimate amount", "quote amount", "estimates subtotal", "estimate subtotal", "one-off job"],
    not: /(^subtotal$|visits|count|tax|discount|deposit|paid|balance|hours|qty|quantity|cost|margin|profit|tip)/i,
    looks: "money",
  },
  subtotal: { names: ["subtotal", "sub total", "sub-total"], looks: "money" },
  // What one visit of a recurring job bills (Jobber's "Visit based ($)"); blank or 0 on a one-off job's visits
  perVisit: { names: ["visit based", "per visit", "price per visit"], looks: "money" },
  // Jobber's "Visit completed": Yes once the visit is marked done, No while it's still to come or went by undone
  done: { names: ["visit completed", "visit complete", "marked complete"] },
  // When the provider started the job, on a booking tool's time log: a log with none was never worked. Only a tool's
  // own column is read as one (VENDOR_COLUMNS), never a spelling: elsewhere a crew that doesn't use the clock leaves it
  // blank on visits it did.
  clockedIn: { names: [] },
  // The recurring series a booking belongs to, on a booking tool's export (ZenMaid's Subscription ID): blank on a
  // booking made once. Only a tool's own column is read as one (VENDOR_COLUMNS).
  series: { names: [] },
  balance: { names: ["balance", "balance due", "amount due", "outstanding", "open balance", "remaining balance", "due"], not: /(date)/i, looks: "money" },
  status: {
    names: ["status", "quote status", "job status", "invoice status", "estimate status", "state", "stage", "pipeline stage", "deal stage", "work status", "opportunity status", "approval status"],
    not: /(client status|customer status|payment method|marital)/i,
  },
  // The decision on a quote, kept apart from its status: Housecall Pro's "Status" is the estimate visit
  // (Scheduled, Completed) while "Outcome" says Open, Won or Lost. When a file has both, the outcome decides.
  outcome: { names: ["outcome", "estimate outcome", "quote outcome", "won lost", "win loss"] },
  salesperson: { names: ["salesperson", "sales person", "sales rep", "assigned to", "estimator", "created by", "sold by", "rep", "technician", "assigned employee"] },
  quoteNumber: { names: ["quote #", "quote #s", "quote number", "quote no", "quote", "estimate #", "estimate number", "from quote", "originating quote"], looks: "ref" },
  jobNumber: { names: ["job #", "job #s", "job number", "job no", "job", "work order", "work order #"], looks: "ref" },
  jobType: { names: ["job type", "type", "recurring", "one-off / recurring", "schedule type", "frequency", "service frequency", "visit frequency"], not: /(billing|payment)/i },
  // who a visit was assigned to: the crew whose clock says whether a visit not marked done was missed
  crew: { names: ["assigned to", "crew", "team"] },

  createdOn: { names: ["created", "created date", "date created", "created on", "created at", "drafted date", "quote date", "estimate date", "date", "requested on", "requested on date", "request date", "opened", "open date"], not: /(client|customer|visit|due|sent|approved|paid|\blast\b)/i, looks: "date" },
  sentOn: { names: ["sent", "sent date", "date sent", "sent on", "last sent", "issued date sent", "emailed on", "sent at"], not: /(email sent to|to|by)/i, looks: "date" },
  approvedOn: { names: ["approved", "approved date", "date approved", "approved on", "accepted", "accepted date", "won date", "signed date", "sold date", "sold on", "customer approved date"], looks: "date" },
  convertedOn: { names: ["converted", "converted date", "date converted", "converted on", "job created", "converted to job"], looks: "date" },
  archivedOn: { names: ["archived", "archived date", "date archived", "archived on", "lost date", "declined date", "closed lost date"], looks: "date" },
  changesRequestedOn: { names: ["changes requested", "changes requested date", "changes requested on"], looks: "date" },
  // A plain "Date" is a visit's own date (Jobber's Visits report); in a jobs file "created" takes it first
  scheduledOn: { names: ["scheduled", "schedule date", "scheduled date", "start date", "start", "schedule start", "scheduled start", "visit date", "next visit", "appointment date", "service date", "job date", "booking date", "date"], not: /(end|created|completed)/i, looks: "date" },
  completedOn: { names: ["completed", "completed date", "completed on", "date completed", "closed", "closed date", "closed on", "finished", "end date", "end", "last visit", "completion date"], looks: "date" },
  issuedOn: { names: ["issued", "issued date", "issue date", "invoice date", "date issued", "billed date"], looks: "date" },
  dueOn: { names: ["due", "due date", "date due", "payment due"], not: /(balance|amount)/i, looks: "date" },
  paidOn: { names: ["paid", "paid date", "date paid", "paid on", "payment date", "last payment date", "marked paid"], not: /(amount|total|balance)/i, looks: "date" },
  assessmentOn: { names: ["assessment", "assessment date", "site visit", "site visit date", "appointment", "consultation date"], looks: "date" },
  viewedOn: { names: ["viewed in client hub", "viewed", "viewed date", "last viewed", "opened date", "estimate viewed"], looks: "date" },
  lastJobOn: {
    names: ["last closed job", "last job", "last job date", "last service", "last service date", "last visit", "last visit date", "last completed job", "last appointment", "last appointment date", "last booking", "last booking date", "last cleaning", "last cleaning date"],
    looks: "date",
  },
  // A client's next visit on the calendar, on a booking tool's client list (ZenMaid's Next Appointment). Only a tool's
  // own column is read as one (VENDOR_COLUMNS).
  nextVisitOn: { names: [] },
};

/** Fields that each record kind can use. */
export const KIND_FIELDS: Record<RecordKind, Field[]> = {
  quote: [
    "clientId", "name", "firstName", "lastName", "company", "email", "phone", "mobile", "address", "street", "street2", "city", "state", "zip", "tags", "leadSource", "marketingOptOut", "smsOptIn",
    "number", "title", "description", "lineItems", "total", "subtotal", "status", "outcome", "salesperson", "jobNumber",
    "createdOn", "sentOn", "approvedOn", "convertedOn", "archivedOn", "changesRequestedOn", "viewedOn",
  ],
  job: [
    "clientId", "name", "firstName", "lastName", "company", "email", "phone", "mobile", "address", "street", "street2", "city", "state", "zip", "tags", "leadSource", "marketingOptOut", "smsOptIn",
    "number", "title", "description", "lineItems", "total", "status", "salesperson", "quoteNumber", "jobType",
    "createdOn", "scheduledOn", "completedOn",
  ],
  invoice: [
    "clientId", "name", "firstName", "lastName", "company", "email", "phone", "mobile", "address", "street", "street2", "city", "state", "zip",
    "number", "title", "description", "total", "balance", "status", "jobNumber",
    "issuedOn", "dueOn", "paidOn", "createdOn",
  ],
  client: [
    "clientId", "name", "firstName", "lastName", "company", "email", "phone", "mobile", "address", "street", "street2", "city", "state", "zip", "tags", "leadSource", "marketingOptOut", "smsOptIn",
    "clientCreatedOn", "clientStatus", "clientType", "createdOn", "description", "lastJobOn", "nextVisitOn", "jobType",
  ],
  request: [
    "clientId", "name", "firstName", "lastName", "company", "email", "phone", "mobile", "address", "street", "street2", "city", "state", "zip", "leadSource",
    "number", "title", "description", "status", "createdOn", "assessmentOn", "quoteNumber",
  ],
  visit: [
    "clientId", "name", "firstName", "lastName", "company", "email", "phone", "mobile", "address", "street", "street2", "city", "state", "zip",
    "number", "title", "description", "lineItems", "total", "perVisit", "done", "clockedIn", "series", "status", "jobNumber", "jobType", "crew", "scheduledOn", "completedOn",
  ],
};

/** Header fingerprints that identify a record kind. */
export const KIND_SIGNALS: Record<RecordKind, RegExp[]> = {
  quote: [/\bquote\b/i, /\bestimate\b/i, /approved/i, /converted/i, /changes requested/i, /\bproposal\b/i, /option/i],
  job: [/\bjob\b/i, /\bwork order\b/i, /\bvisits?\b/i, /completed/i, /scheduled/i, /recurring/i],
  invoice: [/\binvoice\b/i, /balance/i, /\bpaid\b/i, /due date/i, /payment/i],
  client: [/client (id|since|created)/i, /customer since/i, /lead source/i, /tags/i, /billing (street|city|address)/i, /\bclients?\b/i],
  request: [/\brequest\b/i, /assessment/i, /\binquiry\b/i, /lead form/i],
  visit: [/\bvisit\b/i, /\bcrew\b/i, /\broute\b/i, /arrival/i, /\bbookings?\b/i],
};

/**
 * Header fingerprints that identify the software that produced the file. `beside`: a tool's columns an owner's own
 * sheet has too, which count only beside one of the tool's own.
 */
export const SOURCE_SIGNALS: { source: SourceSystem; patterns: RegExp[]; beside?: RegExp[] }[] = [
  { source: "jobber", patterns: [/^quote #$/i, /^client name$/i, /changes requested/i, /^converted( date)?$/i, /^property$/i, /^job #$/i, /jobber/i, /^sent to$/i, /^visits? assigned to$/i] },
  { source: "housecall_pro", patterns: [/^estimate #$/i, /^customer$/i, /outcome/i, /^option( name)?$/i, /housecall/i, /^customer tags$/i, /^job source$/i, /^customer (first|last) name$/i] },
  { source: "servicetitan", patterns: [/business unit/i, /^estimate (name|id)$/i, /sold on/i, /campaign( name)?/i, /servicetitan/i, /^job type$/i, /^location( address)?$/i, /^customer id$/i] },
  { source: "quickbooks", patterns: [/^num$/i, /^transaction type$/i, /^open balance$/i, /quickbooks/i, /^memo\/description$/i, /^expiration date$/i, /^doc number$/i] },
  { source: "arborgold", patterns: [/arborgold/i, /^proposal( #| number)?$/i, /^sales ?rep$/i, /^work order #?$/i] },
  { source: "singleops", patterns: [/singleops/i, /^proposal( #| number)?$/i, /^opportunity/i] },
  { source: "yardbook", patterns: [/yardbook/i] },
  { source: "lmn", patterns: [/\blmn\b/i, /^estimate name$/i, /^division$/i] },
  { source: "service_autopilot", patterns: [/service autopilot/i, /^sa id$/i] },
  { source: "workiz", patterns: [/workiz/i] },
  // the cleaning booking tools: column names only their exports use (see VENDOR_COLUMNS for where each comes from).
  // BookingKoala's "Provider" (who cleaned) and "Industry" can be on anyone's sheet, and its clock ("Clocked in",
  // "Clocked out", "Time reported") on any crew's timesheet.
  { source: "zenmaid", patterns: [/zenmaid/i, /^customer emails$/i, /^is first clean\?$/i, /^subscription (id|end date)$/i, /^latest appointment (date|start time|end time)$/i, /^most recent clean$/i, /^cleaning weekday$/i, /^(emails|phone numbers) \(all\)$/i] },
  { source: "bookingkoala", patterns: [/booking ?koala/i, /^provider (status|payment)$/i, /^travel (distance|time)$/i, /^(estimated job length|total payable amount|pricing parameters|package addons)$/i, /^number of (active |cancelled )?bookings$/i, /^additional (email addresse|phone number)\(s\)$/i], beside: [/^provider$/i, /^industry$/i, /^clocked (in|out)$/i, /^time reported$/i] },
  { source: "launch27", patterns: [/launch ?27/i, /^final price$/i, /^date of (first|last) booking$/i, /^stripe id$/i] },
];

/**
 * The cleaning booking tools' own column names, export by export, as their help pages give them and keyed by
 * normHeader's spelling: read for what the tool says each column is before any spelling above is tried. A column the
 * tool means something else by is never read (null). A column a page doesn't list falls to the spellings above, and so
 * does a file of a kind the tool doesn't export.
 */
export const VENDOR_COLUMNS: Partial<Record<SourceSystem, Partial<Record<RecordKind, Record<string, Field | null>>>>> = {
  // ZenMaid, read 2026-10-01: appointment statuses (Active, Completed, Cancelled, Locked Out) on
  // https://zenmaid.com/answers/en/articles/9764809-how-to-create-a-cancellation-report.
  zenmaid: {
    // The Appointments export (Reports → Data exports → Export data → Appointments), its fields on
    // https://www.zenmaid.com/answers/en/articles/5085915-how-to-run-exports-from-zenmaid; Customer Full Name and
    // Recurrence ("weekly", "every 2 weeks", "one time" or blank) on
    // https://zenmaid.com/answers/en/articles/8688544-how-to-compare-months-for-gained-lost-recurring-customers-using-the-appointment-export,
    // which counts a blank one as no recurring service, like "one time": with no Subscription ID beside it either, the
    // booking was made once.
    visit: {
      "appointment id": "number",
      "appointment date": "scheduledOn",
      "subscription id": "series",
      "appointment status": "status",
      price: "total",
      "team name": "crew",
      "customer first name": "firstName",
      "customer last name": "lastName",
      "customer full name": "name",
      "customer company name": "company",
      "customer emails": "email",
      "address line1": "street",
      "address line2": "street2",
      "address city": "city",
      "address state": "state",
      "address postal code": "zip",
      recurrence: "jobType",
      // when the client's subscription ends, and their latest visit: no visit's own day
      "subscription end date": null,
      "latest appointment date": null,
    },
    // The Contacts export, its fields on the cancellation-report page above; its Types on
    // https://zenmaid.com/answers/en/articles/2235216-how-contact-statuses-work-and-how-to-change-them: a Recurring
    // Customer (plain "Recurring" in the page's list of them) has a recurring service with at least one future
    // appointment. A One-Time Customer never signed up for one and "has had service in the past or has a service
    // scheduled in the future", so only a Next Appointment says it's booked. A Former Customer had a recurring service
    // and has nothing ahead, and a Lead was never cleaned for.
    client: {
      "contact id": "clientId",
      "full name": "name",
      "first name": "firstName",
      "last name": "lastName",
      "primary email": "email",
      "primary phone number": "phone",
      "most recent clean": "lastJobOn",
      "created on": "createdOn",
      // whether a visit is on the calendar (BOOKED_CLIENT), never how often they come
      type: "clientType",
      "next appointment": "nextVisitOn",
    },
  },
  // BookingKoala, read 2026-10-01.
  bookingkoala: {
    // The Booking Time Logs export (Bookings → Booking Time Logs → Export), its fields (Clocked in, Clocked out and Time
    // reported among them) and a sample (Service date 04/04/2022, Service time 09:00 AM, Provider status Active) on
    // https://help.bookingkoala.com/help/booking-time-logs; frequencies (One Time, Weekly, Every 2 Weeks, Every 4 Weeks)
    // on https://help.bookingkoala.com/help/reports-overview. A shop has logs only once it turns on clocking in and out.
    // A log is made when the provider taps On the Way, before any work, and is a visit worked once someone clocks in:
    // the provider, or the system when it completes a job nobody clocked in to. One with no clock-in (a booking
    // cancelled at the door) is none. Its Status is the hours' approval (Approved, Pending, Rejected): hours the office
    // rejected are no clean to count, and the rest leave it to the clock-in. Provider status is the provider's account
    // (Active, Inactive, Deleted). It has no email. Any other BookingKoala file of bookings (its booking CSV has no
    // columns on a help page) has no clock, and its Status is the booking's.
    visit: {
      "booking id": "number",
      "service date": "scheduledOn",
      customer: "name",
      "phone number": "phone",
      provider: "crew",
      service: "title",
      frequency: "jobType",
      "booking amount": "total",
      "zip postal code": "zip",
      "clocked in": "clockedIn",
      // the time between clocking in and out, in an export with no clock-in ticked
      "time reported": "clockedIn",
      status: "status",
      "provider status": null,
    },
    // The Customers export (Customers → Customers → Export), its fields on
    // https://help.bookingkoala.com/help/how-to-export-customer-data: the emails, and counts of bookings, never a date.
    client: {
      "first name": "firstName",
      "last name": "lastName",
      "full name": "name",
      "company name": "company",
      "email address": "email",
      "phone number": "phone",
      address: "address",
      "apt no": "street2",
      city: "city",
      state: "state",
      "zip postal code": "zip",
      "created on": "createdOn",
    },
  },
  // Launch27, read 2026-10-01.
  launch27: {
    // The booking export (Bookings → Download CSV): the standard fields its picker shows on
    // https://intercom.help/Launch27/en/articles/4460462-export-booking-data (Date, Time, First Name, Last Name, Email,
    // Address, City, State, Postal Code, Phone; the list scrolls on past them), and what Launch27 calls a booking's
    // service, frequency and price on https://intercom.help/Launch27/en/articles/4256720-zapier-integration-overview;
    // frequencies (Weekly, Bi-Weekly, Tri-Weekly, Monthly, Every 2 Weeks, One Time) on
    // https://intercom.help/Launch27/en/articles/4259686-how-recurring-bookings-work and
    // https://intercom.help/Launch27/en/articles/4259718-active-bookings-page-overview. Only active bookings export, done
    // and still to come, never cancelled ones: https://intercom.help/Launch27/en/articles/4259709-export-account-data-overview.
    visit: {
      date: "scheduledOn",
      "first name": "firstName",
      "last name": "lastName",
      email: "email",
      address: "address",
      city: "city",
      state: "state",
      "postal code": "zip",
      phone: "phone",
      service: "title",
      frequency: "jobType",
      "final price": "total",
    },
    // The Customers export (Customers → Export customers), its fields and dates (03/25/2024 9:00 AM) on
    // https://intercom.help/Launch27/en/articles/7061836-new-bookings-report.
    client: {
      "first name": "firstName",
      "last name": "lastName",
      email: "email",
      address: "address",
      city: "city",
      state: "state",
      "postal code": "zip",
      phone: "phone",
      "date created": "createdOn",
      "date of last booking": "lastJobOn",
    },
  },
};

/** "Not sent", "never viewed", "un-signed": a negation in front of the word that follows. */
const NOT = String.raw`\b(?:not(?:\s+yet)?[\s-]+|never[\s-]+|un-?)`;
/** Said yes, and the deposit that books the date hasn't come in: "Awaiting deposit", "Deposit due". */
const WAITING_ON_DEPOSIT = String.raw`\b(?:awaiting|pending|needs?|waiting (?:on|for)|no) deposit\b|\bdeposit (?:due|requested|needed|pending|sent|invoice sent)\b`;
/** The start of the status, past any bullet or dash, allowing for "Customer approved". */
const LEADS_WITH = String.raw`^\W*(?:(?:customer|client)\s+)?`;
/** A yes from the customer. "Won't" is not a win. An owner's own "Yes" on their sheet is one too. */
const SAID_YES = String.raw`(?:accepted|approved|signed|won(?!['’])|sold|closed[\s-]*won|deposit (?:paid|received)|\byes)\b`;
/** The owner's own yes leading the status, however short: "Y - pending", "Yep, waiting on HOA". */
const OWNER_YES = String.raw`^\W*(?:y|yes|yep|yeah|verbal(?:ly)?\s+yes)\b`;
/**
 * Gone to someone else: "Went with another company", "Hired a competitor", "Lost to ABC Fence", "Closed lost". Only
 * when the other side is a someone: "Went w/ black vinyl" and "Chose another color" are the option they bought.
 */
const COMPETITOR = String.raw`(?:went (?:with|w/)\s*(?:an?\s+|the\s+)?(?:someone|somebody|competitor|competition|(?:another|other|different|cheaper|lower|local) (?:company|contractor|guy|bid|quote|crew|price))\b|went elsewhere|(?:hired|chose|used|picked) (?:an?\s+|the\s+)?(?:someone|somebody|competitor|competition|(?:another|other|different) (?:company|contractor|guy|bid|quote|crew))\b|\blost to\b|closed[\s-]*lost)`;
/**
 * Someone else's price was lower: "Someone else quoted lower", "Other bid was lower", "Competitor's bid came in less",
 * "Got quoted lower elsewhere". Never our own lower price ("Quoted lower - sold"): the lower price has to be someone
 * else's.
 */
const OTHERS = String.raw`(?:(?:someone|somebody)(?:\s+else)?|(?:the\s+)?(?:other|another|different)\s+(?:company|guy|contractor|crew|outfit|bidder)s?(?:['’]s)?|competitors?(?:['’]s?)?|they|their)`;
const UNDERCUT = String.raw`(?:${OTHERS}\s+(?:quoted|priced|bid)\s+(?:\w+\s+)?(?:lower|less|cheaper)|(?:${OTHERS}|(?:the\s+)?other)\s+(?:bid|quote|price|estimate)\s+(?:was|came in|is)\s+(?:\w+\s+)?(?:lower|less|cheaper)|(?:quoted|priced|bid|found it)\s+(?:\w+\s+)?(?:lower|less|cheaper)\s+elsewhere|cheaper elsewhere)`;
/**
 * A no from the customer, including the reasons owners type for one: "Declined", "Closed lost", "HOA denied", "Wife
 * said no", "Went w/ competitor", "Price too high", "Not moving forward". One list for every rule that listens for a
 * no, so a no that one rule hears can't slip past another.
 */
const SAID_NO = String.raw`(?:declin|reject|disapprov|denied|not interested|\bsaid no\b|\bno,? thank(?:s|\s+you)\b|\blost\b(?!\s+(?:contact|touch|track|(?:the |their |his |her )?(?:paperwork|number|email|phone)))|\bdid(?:\s+not|n['’]?t)\s+win\b|${COMPETITOR}|\bwent (?:with|w/)|too (?:expensive|pricey|costly)|(?:price|cost)d?\s+(?:is\s+|was\s+)?too high|${UNDERCUT}|(?:quoted|priced|bid|estimated) too high|not (?:moving forward|proceeding)(?!\s+(?:yet|until|till|til|for now|before|this (?:season|year|month))))`;
/** A yes that came undone after it was given: "backed out", "changed their mind", "fell through", "pulled out". */
const BACKED_OUT = String.raw`\bbacked out\b|\bchanged (?:(?:their|his|her|my|our) )?minds?\b|\bfell through\b|\bdid(?:\s+not|n['’]?t) go ahead\b|\bno longer\b|\bpulled out\b|\brefund`;
/** Closed out by the software or the office, not answered by the customer: "Expired", "Cancelled", "No go". */
const CLOSED_OUT = String.raw`(?:expir|archiv|dismiss|no go|closed|inactive|abandon|stale|cancel|\bvoid|delet|duplicate|disqualif)`;
/**
 * Still waiting on the customer: "Sent", "Quoted", "No response", "Following up", "On hold". Matched inside words, so
 * "Resent" and "Reopened" count too.
 */
const STILL_OPEN = String.raw`(?:awaiting|sent|pending|open|viewed|outstanding|opened|needs response|follow(?:ing|ed)?[\s-]*up|estimated|bidding|approval|delivery|contacted|unreachable|no (?:response|answer|reply)|waiting|thinking|consider|undecided|on hold|postponed|deferred|nurtur|call ?back|quoted|proposal|submitted|presented|emailed|not (?:moving forward|proceeding) (?:yet|until|till|til|for now|before|this))`;
/** Waiting on the customer, as a reason written after a "not sold": "Not sold - pending", "Not sold (no response)". */
const WAITING = String.raw`\b(?:pending|awaiting|waiting|on hold|follow(?:ing|ed)?[\s-]*up|no (?:response|answer|reply)|thinking|consider(?:ing)?|deciding|undecided|open|outstanding|unreachable|needs? (?:response|approval|hoa)|viewed|(?:estimate|proposal|quote) sent|resent|call ?back|postponed|deferred|nurtur\w*)\b`;
/** What a yes waits on as its next step, not as a condition on it: the deposit, or a date on the calendar. */
const NEXT_STEP = String.raw`${WAITING_ON_DEPOSIT}|\b(?:ready|waiting|awaiting|pending) (?:on |to |for )?(?:be |a )?(?:schedul\w*|(?:start )?date)\b`;
/** "Not sold", "unsold", "no sale", "didn't sell": a sale that hasn't happened, yet or at all. */
const DID_NOT_SELL = String.raw`\bdid(?:\s+not|n['’]?t)\s+sell\b`;
const NOT_SOLD = String.raw`(?:${NOT}sold\b|\bno[\s-]+sale\b|${DID_NOT_SELL})`;
/** "Not booked", "not yet scheduled", "unconverted": the work isn't on the calendar. Says nothing about the answer. */
const NOT_ON_CALENDAR = String.raw`${NOT}(?:booked|scheduled|converted|completed?|closed)\b`;

/**
 * Raw status words -> canonical meaning, per record kind. Checked in order.
 *
 * Covers the vocabularies of the tools fence and painting quotes live in, not just Jobber's: Estimate Rocket
 * (Pending, Unsigned, Changes, Approved, Cancelled, Expired), QuickBooks estimates (Pending, Accepted, Closed,
 * Rejected, Converted), PaintScout (Draft, Sent, Viewed, Accepted, Declined, Invoiced, Paid), DripJobs (New Lead,
 * Appointment Scheduled, Proposal Sent, Won, Lost, Project Complete), Housecall Pro (Open, Won, Lost, Copied to
 * job), Markate, Fence Cloud and owners' own spreadsheets. A wrong read here decides who gets followed up: an open
 * quote read as "approved" or "converted" silently drops out of every follow-up, so negations come first, after
 * a leading no.
 */
export const QUOTE_STATUS_MAP: [RegExp, import("../model.ts").QuoteStatus][] = [
  // An owner's own one-word answers on a homemade sheet: "Done", "Yes", "Verbal yes", "No", "Passed", "Dead". Only
  // when that's the whole status, so "Not done", "Yes - said no to the gate" and the rest fall to the rules below.
  [/^\W*(?:(?:job|work|all|install)\s+)?(?:done|finished|installed)\W*$/i, "converted"],
  [/^\W*(?:y|yes|yep|yeah|verbal(?:ly)?(?:\s+(?:yes|ok|okay|go))?|(?:a\s+)?go(?:\s+ahead)?|going ahead|went ahead|moving forward|proceeding|awarded|hired(?:\s+us)?|green ?light)\W*$/i, "approved"],
  [/^\W*(?:n|no|nope|nah|pass(?:ed)?(?:\s+on\s+it)?|did(?:\s+not|n['’]?t)\s+(?:buy|go ahead|go forward|want it|hire us))\W*$/i, "declined"],
  // "Dead" is the office closing it out, not the customer's answer
  [/^\W*dead(?:\s+(?:lead|deal|quote|estimate))?\W*$/i, "archived"],
  // Asked for a new price, or got one: "Too expensive - revision requested", "Price too high - sent revised quote".
  // Still open, whatever objection came first; the answer they gave was "not at that price".
  // An answer written after it ("Requoted - sold", "Changes requested - went with another company") is the later word,
  // and a status that starts with a yes keeps it ("Sold - requoted gate"): those fall through to the rules below.
  [new RegExp(`^(?!${LEADS_WITH}${SAID_YES})(?=.*(?:changes? requested|\\brequest(?:ed)? changes\\b|\\brevisions? (?:requested|needed)\\b|\\bneeds? (?:changes|revisions?)\\b)(?!.*(?:${SAID_YES}|${SAID_NO})))`, "i"), "changes_requested"],
  [new RegExp(`^(?!${LEADS_WITH}${SAID_YES})(?=.*(?:\\b(?:sent|emailed) (?:a |the )?revised\\b|\\brevised (?:quote|estimate|price|proposal|bid) sent\\b|\\bre-?quoted\\b)(?!.*(?:${SAID_YES}|${SAID_NO})))`, "i"), "awaiting_response"],
  // When the status starts with a no, the no decides, whatever follows it: "Lost - not signed", "Declined - never
  // opened", "Rejected - not booked". The negations below would otherwise read those as still open.
  [new RegExp(`${LEADS_WITH}${SAID_NO}`, "i"), "declined"],
  // Gone to someone else, wherever it's written: "Viewed - not signed - went with competitor". Nobody writes "not
  // went with", so no negation in front of it changes that.
  [new RegExp(COMPETITOR, "i"), "declined"],
  // Never went out: "Not sent", "Unsent", "Not yet submitted".
  [new RegExp(`${NOT}(?:sent|emailed|delivered|submitted|issued|presented|finali[sz]ed)\\b`, "i"), "draft"],
  // Out, but no yes yet: "Unsigned" is Estimate Rocket's open status, not a signature; "Viewed - not signed".
  [new RegExp(`${NOT}(?:signed|accepted|approved|answered|decided|won)\\b|\\b(?:awaiting|pending|needs?|waiting (?:on|for)) (?:an? )?(?:signature|approval|decision|e-?sign\\w*)\\b|\\bsign(?:ature)? requested\\b|\\bsent for signature\\b`, "i"), "awaiting_response"],
  [new RegExp(`${NOT}(?:viewed|opened|seen|read)\\b`, "i"), "awaiting_response"],
  // When the status starts with a yes, a "not booked" after it only says the work isn't on the calendar yet:
  // "Accepted - not booked" and "Sold - not completed" are a yes to schedule, not open and not converted. A "not
  // signed" after a yes is still waiting on the signature, so that one stays open.
  [new RegExp(`${LEADS_WITH}${SAID_YES}.*${NOT_ON_CALENDAR}`, "i"), "approved"],
  // "Sold / Not sold" sheets: a sale that didn't happen is a no. One that hasn't happened yet is still open, whichever
  // side of the "not sold" the waiting is written on: "Not sold yet", "Pending - not sold", "Not sold (no response)",
  // "No response - not sold". Unless a no is written anywhere in it ("Sent - not sold - customer said no"), or it was
  // closed out ("Sent - not sold - cancelled"): nobody is waiting on those.
  [new RegExp(`^(?!.*(?:${SAID_NO}|${CLOSED_OUT}))(?:.*${STILL_OPEN}.*${NOT_SOLD}|.*${NOT_SOLD}.*${WAITING}|(?=.*${NOT_SOLD}).*\\byet\\b)`, "i"), "awaiting_response"],
  [new RegExp(String.raw`\bnot[\s-]+sold\b|\bunsold\b|\bno[\s-]+sale\b|${DID_NOT_SELL}`, "i"), "declined"],
  // With no answer in front, not yet sold, or not booked, converted, completed or closed, is still open. Neither is a
  // yes, whatever word follows the "not".
  [new RegExp(`${NOT}(?:sold|booked|converted|completed?|closed)\\b`, "i"), "awaiting_response"],
  // A yes that isn't on the calendar: "Unscheduled", "Needs scheduling", "Awaiting deposit". Housecall Pro's own
  // "Unscheduled" is about the estimate visit and is handled in SOURCE_QUOTE_STATUS before this runs.
  [new RegExp(`${NOT}scheduled\\b|\\bneeds? (?:to be )?schedul\\w*|\\bto be scheduled\\b|\\b(?:ready|waiting|awaiting|pending) (?:to |for )?schedul\\w*|${WAITING_ON_DEPOSIT}`, "i"), "approved"],
  // A visit to look, or an estimate still being written, is not a price anyone has seen: DripJobs "Appointment
  // Scheduled", "Needs estimate", "Incomplete".
  [/\b(?:estimate|appointment|appt|consult\w*|site visit|walk-?through|measure\w*|assessment|bid) (?:is )?(?:scheduled|booked|set|needed|requested)\b|\bneeds? (?:an? )?(?:estimate|quote|bid|measure\w*)\b|\bincomplete\b/i, "draft"],
  [/changes? requested|\brequest(?:ed)? changes\b|^\s*changes?\s*$|\brevisions? (?:requested|needed)\b|\bneeds? (?:changes|revisions?)\b/i, "changes_requested"],
  // A real "no" from the customer, including CRM stages: "Rejected", "Lost", "Closed lost", "Went with someone else".
  // Unless it starts with a yes: "Approved - said no to the gate", "Sold - no thanks on sealer" turned down an add-on.
  [new RegExp(`^(?!${LEADS_WITH}${SAID_YES}).*${SAID_NO}`, "i"), "declined"],
  // Said yes: "Won", "Closed won". A win is a yes, not a job: nobody knows it's on the calendar until a job says so.
  // "Won't proceed" is not a win, typed on a keyboard or with a phone's curly apostrophe
  [/\bclosed[\s-]*won\b|\bwon\b(?!['’])/i, "approved"],
  // Work exists: ServiceTitan "Sold", Housecall Pro "Copied to job", QuickBooks "Converted", PaintScout "Invoiced" and "Paid".
  [/(converted|job created|copied to job|\bsold\b|complete|invoiced|\b(?:un)?paid\b|scheduled|in progress)/i, "converted"],
  // An owner's own yes leads the same way, whatever note follows it: "Yes", "Yes - deposit received", "Yes - 10/20",
  // "Yes - waiting on HOA" (a yes with a condition, never an unanswered quote; statusReadsTwoWays holds it for a
  // person). Unless the yes came undone ("Yes - backed out", "Yes - cancelled"): that isn't read as a yes.
  [new RegExp(`(approved|accepted|\\bsigned\\b|booked|client approved|customer approved|pro approved)|${OWNER_YES}(?!.*(?:${CLOSED_OUT}|${BACKED_OUT}))`, "i"), "approved"],
  // Closed by the software or the office — NOT a customer decision (expired, dismissed, cancelled, No Go).
  [/(expir)/i, "expired"],
  [new RegExp(CLOSED_OUT, "i"), "archived"],
  [new RegExp(STILL_OPEN, "i"), "awaiting_response"],
  [/(draft|unsent|not sent|new|pre-?bid|\blead\b)/i, "draft"],
];

/**
 * A status that says two things at once ("Requoted - sold", "Approved - said no to the gate", "Declined - changes
 * requested", "Yes - waiting on HOA"): the map above still makes its best reading, but nobody should be written to on
 * a guess, so the opportunity is held for a person to look at. Negated words don't count ("Unsigned" is not a yes),
 * and a yes waiting on its deposit or a date ("Approved - awaiting deposit") is just the next step.
 */
export function statusReadsTwoWays(raw: string): boolean {
  const t = raw.replace(new RegExp(`${NOT}\\w+`, "gi"), " ");
  const yes = new RegExp(`${SAID_YES}|${OWNER_YES}`, "i").test(t);
  const no = new RegExp(SAID_NO, "i").test(raw);
  const revision = /changes? requested|\brequest(?:ed)? changes\b|\brevisions? (?:requested|needed)\b|\brevised\b|\bre-?quoted\b/i.test(raw);
  const waiting = new RegExp(WAITING, "i").test(raw);
  const onCondition = new RegExp(WAITING, "i").test(raw.replace(new RegExp(NEXT_STEP, "gi"), " "));
  // a yes that came undone: "Yes - backed out", "Approved - cancelled", "Sold - fell through"
  const undone = new RegExp(`${CLOSED_OUT}|${BACKED_OUT}`, "i").test(raw.replace(/\bclosed[\s-]*won\b/gi, " "));
  return (yes && no) || (yes && revision) || (yes && onCondition) || (yes && undone) || (no && (revision || waiting));
}

/** Per-software status words that mean something different there. */
export const SOURCE_QUOTE_STATUS: Partial<Record<import("../model.ts").SourceSystem, [RegExp, import("../model.ts").QuoteStatus][]>> = {
  // In QuickBooks, a "Closed" estimate was turned into an invoice.
  quickbooks: [[/^closed$/i, "converted"], [/^pending$/i, "awaiting_response"], [/^accepted$/i, "approved"], [/^rejected$/i, "declined"]],
  // ServiceTitan opportunity statuses: Open / Contacted / Unreachable / Won / Dismissed.
  servicetitan: [[/^dismissed$/i, "archived"], [/^(open|contacted|unreachable)$/i, "awaiting_response"], [/^won$/i, "converted"]],
  // Housecall Pro "Unscheduled" / "Scheduled" on an estimate means the estimate appointment, not the job.
  // Its "Lost" stays archived: Housecall Pro closes estimates out itself after its reminders run, so it isn't a no.
  housecall_pro: [[/^copied to job$/i, "converted"], [/^(unscheduled|scheduled)$/i, "awaiting_response"], [/^lost$/i, "archived"], [/^open$/i, "awaiting_response"]],
};

export const JOB_STATUS_MAP: [RegExp, import("../model.ts").JobStatus][] = [
  [/requires? invoic|needs? invoic|ready to invoice|action required/i, "requires_invoicing"],
  // sold and waiting on a date or a deposit (DripJobs' "Unscheduled", a fence shop's "Awaiting deposit")
  [new RegExp(`unscheduled|needs? schedul|to be scheduled|not (yet )?scheduled|(ready|waiting|awaiting|pending) (to |for )?schedul|${WAITING_ON_DEPOSIT}`, "i"), "unscheduled"],
  [/(late|overdue)/i, "late"],
  [/(cancel|void)/i, "cancelled"],
  [/(on hold|hold|paused)/i, "on_hold"],
  // "Incomplete" and "Not completed" are not
  [/((?<!\bin|\bun|\bnot )complete|(?<!\bun|\bnot )done|finished|closed|invoiced|paid)/i, "completed"],
  [/(archiv)/i, "archived"],
  [/(scheduled|upcoming|booked|today)/i, "scheduled"],
  [/(active|in progress|ongoing|open|started|dispatched|en route)/i, "active"],
];

/**
 * A visit's status that says it went by undone ("Skipped", "No show", "Lockout", a time log whose hours were
 * "Rejected"): never work done.
 */
export const VISIT_UNDONE = /\b(skip(ped)?|no[- ]?show|missed|lock[- ]?out|locked out|postponed|incomplete|uncompleted|rejected|not (complete|completed|done))\b/i;

/**
 * A booking tool's word that a client has a visit on the calendar: ZenMaid's Recurring Customer, or plain "Recurring"
 * (VENDOR_COLUMNS). Its One-Time Customer may have had their one clean long ago.
 */
export const BOOKED_CLIENT = /^recurring( customer)?$/i;

export const INVOICE_STATUS_MAP: [RegExp, import("../model.ts").InvoiceStatus][] = [
  [/(bad debt|written off|write off|uncollect)/i, "bad_debt"],
  [/(void|cancel)/i, "void"],
  [/(past due|overdue|late)/i, "past_due"],
  [/(partial|awaiting|sent|unpaid|open|due|outstanding|viewed)/i, "awaiting_payment"],
  [/(paid|closed|complete|settled)/i, "paid"],
  [/(draft)/i, "draft"],
];

export const REQUEST_STATUS_MAP: [RegExp, import("../model.ts").RequestStatus][] = [
  // "Needs quote" and "Estimate requested" are still waiting on a price; only a quote that exists converts one
  [/\b(needs?|awaiting|pending|to) (an? )?(quote|estimate|bid|pric\w*)\b|\b(quote|estimate|bid) (needed|requested|pending|to do)\b/i, "new"],
  [/\b(estimate|quote|bid|appointment|consult\w*) (is )?(scheduled|booked|set)\b/i, "assessment_scheduled"],
  [/(convert|quote|estimate)/i, "converted"],
  [/(assessment|site visit).*(complete|done)|^completed$/i, "assessment_completed"],
  [/(assessment|site visit|scheduled|booked|upcoming|today|overdue|unscheduled|needs approval|needs_approval)/i, "assessment_scheduled"],
  [/(archiv|closed|lost|cancel)/i, "archived"],
  [/(new|open|unread|pending|received)/i, "new"],
];
