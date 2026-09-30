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
  // what
  | "number"
  | "title"
  | "description"
  | "lineItems"
  | "total"
  | "subtotal"
  | "balance"
  | "status"
  | "outcome"
  | "salesperson"
  | "quoteNumber"
  | "jobNumber"
  | "jobType"
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
  | "lastJobOn";

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
  lastName: { names: ["last name", "lastname", "last", "surname", "family name", "client last name", "customer last name", "contact last name"], not: /(company|user|tech|visit|date|job|service)/i },
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

  number: {
    names: ["quote #", "quote number", "quote no", "estimate #", "estimate number", "estimate no", "estimate id", "opportunity number", "job #", "job number", "invoice #", "invoice number", "invoice no", "request #", "number", "#", "id", "doc number", "document number", "ref", "reference"],
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
    names: ["total", "quote total", "estimate total", "job total", "invoice total", "total ($)", "total amount", "amount", "grand total", "value", "price", "total price", "total value", "revenue", "estimate amount", "quote amount", "estimates subtotal", "estimate subtotal"],
    not: /(^subtotal$|visits|count|tax|discount|deposit|paid|balance|hours|qty|quantity|cost|margin|profit|tip)/i,
    looks: "money",
  },
  subtotal: { names: ["subtotal", "sub total", "sub-total"], looks: "money" },
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
  jobType: { names: ["job type", "type", "recurring", "one-off / recurring", "schedule type", "frequency", "service frequency", "visit frequency"] },

  createdOn: { names: ["created", "created date", "date created", "created on", "created at", "drafted date", "quote date", "estimate date", "date", "requested on", "requested on date", "request date", "opened", "open date"], not: /(client|customer|visit|due|sent|approved|paid)/i, looks: "date" },
  sentOn: { names: ["sent", "sent date", "date sent", "sent on", "last sent", "issued date sent", "emailed on", "sent at"], not: /(email sent to|to|by)/i, looks: "date" },
  approvedOn: { names: ["approved", "approved date", "date approved", "approved on", "accepted", "accepted date", "won date", "signed date", "sold date", "sold on", "customer approved date"], looks: "date" },
  convertedOn: { names: ["converted", "converted date", "date converted", "converted on", "job created", "converted to job"], looks: "date" },
  archivedOn: { names: ["archived", "archived date", "date archived", "archived on", "lost date", "declined date", "closed lost date"], looks: "date" },
  changesRequestedOn: { names: ["changes requested", "changes requested date", "changes requested on"], looks: "date" },
  scheduledOn: { names: ["scheduled", "schedule date", "scheduled date", "start date", "start", "schedule start", "scheduled start", "visit date", "next visit", "appointment date", "service date", "job date"], not: /(end|created|completed)/i, looks: "date" },
  completedOn: { names: ["completed", "completed date", "completed on", "date completed", "closed", "closed date", "closed on", "finished", "end date", "end", "last visit", "completion date"], looks: "date" },
  issuedOn: { names: ["issued", "issued date", "issue date", "invoice date", "date issued", "billed date"], looks: "date" },
  dueOn: { names: ["due", "due date", "date due", "payment due"], not: /(balance|amount)/i, looks: "date" },
  paidOn: { names: ["paid", "paid date", "date paid", "paid on", "payment date", "last payment date", "marked paid"], not: /(amount|total|balance)/i, looks: "date" },
  assessmentOn: { names: ["assessment", "assessment date", "site visit", "site visit date", "appointment", "consultation date"], looks: "date" },
  viewedOn: { names: ["viewed in client hub", "viewed", "viewed date", "last viewed", "opened date", "estimate viewed"], looks: "date" },
  lastJobOn: { names: ["last closed job", "last job", "last job date", "last service", "last service date", "last visit date", "last completed job"], looks: "date" },
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
    "clientCreatedOn", "clientStatus", "createdOn", "description", "lastJobOn",
  ],
  request: [
    "clientId", "name", "firstName", "lastName", "company", "email", "phone", "mobile", "address", "street", "street2", "city", "state", "zip", "leadSource",
    "number", "title", "description", "status", "createdOn", "assessmentOn", "quoteNumber",
  ],
  visit: [
    "clientId", "name", "firstName", "lastName", "email", "phone", "address", "street", "city", "state", "zip",
    "title", "status", "jobNumber", "scheduledOn", "completedOn", "total",
  ],
};

/** Header fingerprints that identify a record kind. */
export const KIND_SIGNALS: Record<RecordKind, RegExp[]> = {
  quote: [/\bquote\b/i, /\bestimate\b/i, /approved/i, /converted/i, /changes requested/i, /\bproposal\b/i, /option/i],
  job: [/\bjob\b/i, /\bwork order\b/i, /\bvisits?\b/i, /completed/i, /scheduled/i, /recurring/i],
  invoice: [/\binvoice\b/i, /balance/i, /\bpaid\b/i, /due date/i, /payment/i],
  client: [/client (id|since|created)/i, /customer since/i, /lead source/i, /tags/i, /billing (street|city|address)/i, /\bclients?\b/i],
  request: [/\brequest\b/i, /assessment/i, /\binquiry\b/i, /lead form/i],
  visit: [/\bvisit\b/i, /\bcrew\b/i, /\broute\b/i, /arrival/i],
};

/** Header fingerprints that identify the software that produced the file. */
export const SOURCE_SIGNALS: { source: SourceSystem; patterns: RegExp[] }[] = [
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
  { source: "zenmaid", patterns: [/zenmaid/i] },
];

/** "Not sent", "never viewed", "un-signed": a negation in front of the word that follows. */
const NOT = String.raw`\b(?:not(?:\s+yet)?[\s-]+|never[\s-]+|un-?)`;
/** Said yes, and the deposit that books the date hasn't come in: "Awaiting deposit", "Deposit due". */
const WAITING_ON_DEPOSIT = String.raw`\b(?:awaiting|pending|needs?|waiting (?:on|for)|no) deposit\b|\bdeposit (?:due|requested|needed|pending|sent|invoice sent)\b`;

/**
 * Raw status words -> canonical meaning, per record kind. Checked in order.
 *
 * Covers the vocabularies of the tools fence and painting quotes live in, not just Jobber's: Estimate Rocket
 * (Pending, Unsigned, Changes, Approved, Cancelled, Expired), QuickBooks estimates (Pending, Accepted, Closed,
 * Rejected, Converted), PaintScout (Draft, Sent, Viewed, Accepted, Declined, Invoiced, Paid), DripJobs (New Lead,
 * Appointment Scheduled, Proposal Sent, Won, Lost, Project Complete), Housecall Pro (Open, Won, Lost, Copied to
 * job), Markate, Fence Cloud and owners' own spreadsheets. A wrong read here decides who gets followed up: an open
 * quote read as "approved" or "converted" silently drops out of every follow-up, so negations come first.
 */
export const QUOTE_STATUS_MAP: [RegExp, import("../model.ts").QuoteStatus][] = [
  // Never went out: "Not sent", "Unsent", "Not yet submitted".
  [new RegExp(`${NOT}(?:sent|emailed|delivered|submitted|issued|presented|finali[sz]ed)\\b`, "i"), "draft"],
  // Out, but no yes yet: "Unsigned" is Estimate Rocket's open status, not a signature; "Viewed - not signed".
  [new RegExp(`${NOT}(?:signed|accepted|approved|answered|decided|won)\\b|\\b(?:awaiting|pending|needs?|waiting (?:on|for)) (?:an? )?(?:signature|approval|decision|e-?sign\\w*)\\b|\\bsign(?:ature)? requested\\b|\\bsent for signature\\b`, "i"), "awaiting_response"],
  [new RegExp(`${NOT}(?:viewed|opened|seen|read)\\b`, "i"), "awaiting_response"],
  // "Sold / Not sold" sheets: a sale that didn't happen is a no. Not yet sold, or not booked, converted, completed or
  // closed, is still open. Neither is a yes, whatever word follows the "not".
  [/\bnot[\s-]+sold\b|\bunsold\b|\bno[\s-]+sale\b/i, "declined"],
  [new RegExp(`${NOT}(?:sold|booked|converted|completed?|closed)\\b`, "i"), "awaiting_response"],
  // A yes that isn't on the calendar: "Unscheduled", "Needs scheduling", "Awaiting deposit". Housecall Pro's own
  // "Unscheduled" is about the estimate visit and is handled in SOURCE_QUOTE_STATUS before this runs.
  [new RegExp(`${NOT}scheduled\\b|\\bneeds? (?:to be )?schedul\\w*|\\bto be scheduled\\b|\\b(?:ready|waiting|awaiting|pending) (?:to |for )?schedul\\w*|${WAITING_ON_DEPOSIT}`, "i"), "approved"],
  // A visit to look, or an estimate still being written, is not a price anyone has seen: DripJobs "Appointment
  // Scheduled", "Needs estimate", "Incomplete".
  [/\b(?:estimate|appointment|appt|consult\w*|site visit|walk-?through|measure\w*|assessment|bid) (?:is )?(?:scheduled|booked|set|needed|requested)\b|\bneeds? (?:an? )?(?:estimate|quote|bid|measure\w*)\b|\bincomplete\b/i, "draft"],
  [/changes? requested|\brequest(?:ed)? changes\b|^\s*changes?\s*$|\brevisions? (?:requested|needed)\b|\bneeds? (?:changes|revisions?)\b/i, "changes_requested"],
  // A real "no" from the customer, including CRM stages: "Rejected", "Lost", "Closed lost", "Went with someone else".
  [/(declin|reject|disapprov|not interested|denied|customer said no|closed[\s-]*lost|\blost\b|did not win|went (?:with|elsewhere)|hired (?:someone|another)|chose (?:another|someone))/i, "declined"],
  // Said yes: "Won", "Closed won". A win is a yes, not a job: nobody knows it's on the calendar until a job says so.
  // "Won't proceed" is not a win, typed on a keyboard or with a phone's curly apostrophe
  [/\bclosed[\s-]*won\b|\bwon\b(?!['’])/i, "approved"],
  // Work exists: ServiceTitan "Sold", Housecall Pro "Copied to job", QuickBooks "Converted", PaintScout "Invoiced" and "Paid".
  [/(converted|job created|copied to job|\bsold\b|complete|invoiced|\b(?:un)?paid\b|scheduled|in progress)/i, "converted"],
  [/(approved|accepted|\bsigned\b|booked|client approved|customer approved|pro approved)/i, "approved"],
  // Closed by the software or the office — NOT a customer decision (expired, dismissed, cancelled, No Go).
  [/(expir)/i, "expired"],
  [/(archiv|dismiss|no go|closed|inactive|abandon|stale|cancel|\bvoid|delet|duplicate|disqualif)/i, "archived"],
  [/(awaiting|sent|pending|open|viewed|outstanding|opened|needs response|follow ?up|estimated|bidding|approval|delivery|contacted|unreachable|no (?:response|answer|reply)|waiting|thinking|consider|undecided|on hold|postponed|deferred|nurtur|call ?back|quoted|proposal|submitted|presented)/i, "awaiting_response"],
  [/(draft|unsent|not sent|new|pre-?bid|\blead\b)/i, "draft"],
];

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
  [/(complete|done|finished|closed|invoiced|paid)/i, "completed"],
  [/(archiv)/i, "archived"],
  [/(scheduled|upcoming|booked|today)/i, "scheduled"],
  [/(active|in progress|ongoing|open|started|dispatched|en route)/i, "active"],
];

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
