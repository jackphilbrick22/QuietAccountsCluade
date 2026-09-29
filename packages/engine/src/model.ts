/**
 * Quiet Accounts — core domain model.
 *
 * Everything the engine does flows through these shapes:
 *   raw exports  ->  Dataset (customers, quotes, jobs, invoices, requests)
 *   Dataset      ->  Opportunity[] (every piece of "breakage": money left on the table)
 *   Opportunity  ->  Touch[] (the notes/postcards/tasks that recover it)
 *   Reply        ->  Lead hand-off to the owner
 *   later exports ->  Recovery[] (who came back, and what it paid)
 */

/** Calendar date, YYYY-MM-DD. */
export type ISODate = string;
/** Full timestamp, ISO 8601. */
export type ISODateTime = string;
/** Whole dollars and cents as a JS number. */
export type Money = number;

export type SourceSystem =
  | "jobber"
  | "housecall_pro"
  | "servicetitan"
  | "quickbooks"
  | "arborgold"
  | "singleops"
  | "yardbook"
  | "lmn"
  | "aspire"
  | "service_autopilot"
  | "workiz"
  | "zenmaid"
  | "gorilladesk"
  | "spreadsheet"
  | "unknown";

export type RecordKind = "quote" | "job" | "invoice" | "client" | "request" | "visit";

export interface Address {
  street: string;
  city?: string;
  state?: string;
  zip?: string;
  /** Original single-line form if the export had one. */
  raw?: string;
}

export interface Customer {
  id: string;
  /** Ids this person carries in the source system(s). */
  sourceIds: string[];
  name: string;
  firstName: string;
  lastName: string;
  companyName?: string;
  emails: string[];
  phones: string[];
  address?: Address;
  properties: Address[];
  tags: string[];
  createdOn?: ISODate;
  leadSource?: string;
  /** The business marked this person "do not contact" / no marketing in its own system. */
  doNotContact?: boolean;
  isCommercial?: boolean;
  /** Explicit, recorded consent to marketing texts (TCPA). Never inferred. */
  smsConsent?: { grantedOn: ISODate; source: string };
}

export type QuoteStatus =
  | "draft"
  | "awaiting_response" // sent, no decision
  | "changes_requested"
  | "approved" // said yes, not yet turned into a job
  | "converted" // job created
  | "archived" // put away without a decision (Jobber archives stale quotes)
  | "declined" // explicitly said no / lost
  | "expired"
  | "unknown";

export interface LineItem {
  name: string;
  description?: string;
  quantity?: number;
  unitPrice?: Money;
  total: Money;
  /** Offered as an option / add-on. */
  optional?: boolean;
  /** For optional items: did the customer pick it? */
  selected?: boolean;
}

export interface Quote {
  id: string;
  sourceId?: string;
  number?: string;
  customerId: string;
  title: string;
  lineItems: LineItem[];
  total: Money;
  status: QuoteStatus;
  rawStatus: string;
  createdOn?: ISODate;
  sentOn?: ISODate;
  approvedOn?: ISODate;
  convertedOn?: ISODate;
  archivedOn?: ISODate;
  changesRequestedOn?: ISODate;
  /** The customer opened the quote online (Jobber "Viewed in client hub") — a buying signal. */
  viewedOn?: ISODate;
  property?: Address;
  salesperson?: string;
  /** Jobs known to have come from this quote. */
  jobIds: string[];
}

export type JobStatus =
  | "unscheduled"
  | "scheduled"
  | "active"
  | "late"
  | "requires_invoicing"
  | "completed"
  | "archived"
  | "cancelled"
  | "on_hold"
  | "unknown";

export interface Job {
  id: string;
  sourceId?: string;
  number?: string;
  customerId: string;
  title: string;
  lineItems: LineItem[];
  total: Money;
  status: JobStatus;
  rawStatus: string;
  createdOn?: ISODate;
  scheduledOn?: ISODate;
  completedOn?: ISODate;
  quoteId?: string;
  /** Quote number as written in the export, used to link back to the quote. */
  quoteRef?: string;
  /** Recurring contract / maintenance plan. */
  recurring?: boolean;
  property?: Address;
}

export type InvoiceStatus = "draft" | "awaiting_payment" | "past_due" | "paid" | "bad_debt" | "void" | "unknown";

export interface Invoice {
  id: string;
  sourceId?: string;
  number?: string;
  customerId: string;
  jobId?: string;
  /** Job number as written in the export. */
  jobRef?: string;
  subject: string;
  total: Money;
  balance: Money;
  status: InvoiceStatus;
  rawStatus: string;
  issuedOn?: ISODate;
  dueOn?: ISODate;
  paidOn?: ISODate;
}

export type RequestStatus = "new" | "assessment_scheduled" | "assessment_completed" | "converted" | "archived" | "unknown";

export interface ServiceRequest {
  id: string;
  sourceId?: string;
  customerId: string;
  title: string;
  status: RequestStatus;
  rawStatus: string;
  createdOn?: ISODate;
  assessmentOn?: ISODate;
  quoteId?: string;
  quoteRef?: string;
  source?: string;
  property?: Address;
}

export type TradeId =
  | "tree"
  | "lawn"
  | "landscape"
  | "septic"
  | "fence"
  | "concrete"
  | "pressure_washing"
  | "gutter"
  | "window_cleaning"
  | "pool"
  | "pest"
  | "hvac"
  | "junk_removal"
  | "painting"
  | "roofing"
  | "irrigation"
  | "chimney"
  | "cleaning"
  | "general";

export type Channel = "email" | "postcard" | "sms" | "call_task" | "voicemail" | "retarget";

export type ChannelState = "live" | "ready" | "needs_setup" | "coming_soon" | "off";

export interface BusinessProfile {
  id: string;
  name: string;
  trade: TradeId;
  otherTrades: TradeId[];
  software: SourceSystem;
  ownerName: string;
  ownerFirstName: string;
  ownerPhone?: string;
  ownerEmail?: string;
  /** First name that signs the notes ("Sarah", "Dave"). */
  signerName: string;
  /** How the signer is described: "office", "owner". */
  signerRole: "owner" | "office";
  replyTo?: string;
  businessPhone?: string;
  /** Physical mailing address — required in every commercial email footer (CAN-SPAM). */
  mailingAddress?: string;
  city?: string;
  state?: string;
  timezone: string;
  website?: string;
  /** What a typical job is worth to them; used when a record has no dollar value. */
  avgJobValue?: Money;
  /** Annual revenue for lift %; derived from invoices/jobs when not given. */
  annualRevenue?: Money;
  /** 0 = Sunday. Days notes may go out. */
  sendDays: number[];
  /** Local hour window [start, end) for sends. */
  sendWindow: [number, number];
  /** Weeks not to send (vacation, full schedule). YYYY-MM-DD of the Monday. */
  blackoutWeeks: ISODate[];
  /** Skip quotes worth less than this. */
  minQuoteValue: Money;
  /** Never contact a quote younger than this many days (the salesperson may still be working it). */
  minQuoteAgeDays: number;
  /** Ignore quotes older than this many months. */
  maxQuoteAgeMonths: number;
  /** Max new people contacted per week (protects sending reputation and the owner's calendar). */
  weeklyNewContacts: number;
  /** Owner-approved note on open crew capacity ("a couple of open days next week"). */
  crewNote?: string;
  /** Mondays of weeks the owner says have open crew days. Only then do notes mention openings. */
  openCrewWeeks: ISODate[];
  /**
   * The owner is booked solid until this date (texted "BUSY until Nov 15"). New-work outreach starts about
   * three weeks before it, so replies arrive when there's room on the schedule.
   */
  bookedOutUntil?: ISODate;
  /** How the notes read. */
  voice: {
    /** Put the original price in the first note. Off by default (it re-triggers sticker shock). */
    mentionPrice: boolean;
    /** Allow "we can split it into two visits / do the key part first" offers. */
    offerOptions: boolean;
    /** Quotes older than this many days never repeat the old price (default 180). */
    staleQuoteDays?: number;
    /** Words the owner wants swapped: [["estimate","quote"]]. */
    wordSwaps: [string, string][];
  };
  /** How hard to follow up. */
  persistence: {
    /** One more note when the job's season comes back around (max once a year). */
    seasonalCheckIn: boolean;
    /** Hard ceiling on notes to one person in a rolling year, all plays combined. */
    maxNotesPerYear: number;
    /** Leave this share of the backlog uncontacted to measure true lift. */
    holdoutPct: number;
  };
  toneNotes?: string;
  channels: Partial<Record<Channel, ChannelState>>;
  /** Plan & guarantee state. */
  plan: PlanState;
  createdOn: ISODate;
}

export interface PlanState {
  stage: "trial" | "paying" | "paused" | "cancelled";
  /** Free trial size (people contacted) before any charge. */
  trialSize: number;
  trialStartedOn?: ISODate;
  paidOn?: ISODate;
  monthlyPrice: Money;
  /** Months where the guarantee made the month free. */
  freeMonths: ISODate[];
}

export interface ImportRecord {
  id: string;
  fileName: string;
  importedAt: ISODateTime;
  source: SourceSystem;
  kind: RecordKind;
  rows: number;
  accepted: number;
  rejected: number;
  mapping: Record<string, string>;
  warnings: string[];
}

export interface Dataset {
  business: BusinessProfile;
  customers: Customer[];
  quotes: Quote[];
  jobs: Job[];
  invoices: Invoice[];
  requests: ServiceRequest[];
  imports: ImportRecord[];
  /** "Today" for all age math. Pinned so results are reproducible. */
  asOf: ISODate;
}

/* ------------------------------------------------------------------ */
/* Breakage                                                            */
/* ------------------------------------------------------------------ */

export type BreakageType =
  | "unanswered_quote" // sent, never decided, the software stopped chasing
  | "archived_quote" // put away without a yes
  | "changes_requested" // customer asked for a change, nobody re-quoted
  | "approved_unscheduled" // said yes, never got on the calendar
  | "unquoted_request" // asked for a price, never got one
  | "declined_option" // optional line item left on the table
  | "declined_quote" // said no — a quiet, respectful second chance later
  | "one_and_done" // one job, never came back
  | "lapsed_regular" // was a regular, stopped
  | "service_due" // the trade's re-service clock has run out
  | "missed_upsell" // the natural next job was never offered
  | "unpaid_invoice"; // did the work, never got paid

export type SuppressionReason =
  | "no_contact_info"
  | "do_not_contact"
  | "unsubscribed"
  | "bounced"
  | "already_customer_again" // came back on their own
  | "active_work" // has an open job/quote right now
  | "too_recent" // still inside the salesperson's own follow-up window
  | "too_old"
  | "below_minimum"
  | "commercial" // B2B handled separately
  | "duplicate"
  | "recently_contacted"
  | "complained";

export type SeasonFit = "now" | "soon" | "off";

export interface Opportunity {
  id: string;
  type: BreakageType;
  customerId: string;
  /** Record this came from. */
  source: { kind: RecordKind; id: string };
  /** Face value: the quote/invoice total or the estimated job value. */
  value: Money;
  /** value × recoverProbability — what we expect to actually come back. */
  expectedValue: Money;
  recoverProbability: number;
  /** 0-100 work-it-first priority. */
  score: number;
  /** Days since the anchor date (quote sent, last job, etc.). */
  ageDays: number;
  anchorDate?: ISODate;
  /** Plain-English "why this is money on the table". */
  reason: string;
  evidence: string[];
  /** Human phrase for the work: "the oak by the driveway", "your septic pump-out". */
  jobPhrase: string;
  /** Trade service category id from the playbook. */
  serviceId: string;
  seasonFit: SeasonFit;
  suppressed?: SuppressionReason;
  /**
   * Reasons to hold this one for a look before anyone writes (priced to lose, realtor/HOA/insurance bid).
   * Held opportunities are left out of plans until an operator or the owner clears them.
   */
  caution?: string[];
  channels: Channel[];
}

/* ------------------------------------------------------------------ */
/* Outreach                                                            */
/* ------------------------------------------------------------------ */

export type TouchStatus = "planned" | "approved" | "sent" | "delivered" | "bounced" | "skipped" | "cancelled";

export type MessageAngle =
  | "check_in" // plain "still want this done?"
  | "timing" // season / weather / window
  | "crew_nearby" // route density: we're on your street
  | "problem_grows" // the thing doesn't fix itself
  | "easy_yes" // make saying yes trivial (reply with a day)
  | "revise" // offer to re-scope / phase the work / re-price options
  | "schedule" // you said yes — let's get it on the calendar
  | "due_now" // re-service clock
  | "next_step" // natural follow-on work
  | "reminder" // invoice
  | "close_file"; // last note, polite

export interface Touch {
  id: string;
  opportunityId: string;
  customerId: string;
  channel: Channel;
  step: number;
  angle: MessageAngle;
  /** When it should go (business-local wall time rendered as ISO with offset or Z). */
  dueAt: ISODateTime;
  status: TouchStatus;
  subject?: string;
  body: string;
  sentAt?: ISODateTime;
  providerId?: string;
  /** Lint results from the quality gate. */
  flags: string[];
  /** Send attempts that failed (transient provider errors). */
  attempts?: number;
  lastError?: string;
  /** Who wrote it: the template library or the AI writer (with the template as fallback). */
  writer?: "template" | "ai";
  /** Days this note was pushed back because the owner was booked out (undone when they open up). */
  heldDays?: number;
}

export type ReplyIntent =
  | "wants_it" // yes, do it / schedule me
  | "wants_price" // send me a new price / what would it cost now
  | "question" // asks something; a person should answer
  | "later" // not now, try me in spring
  | "already_done" // someone else did it / did it myself
  | "not_interested"
  | "moved" // sold the house
  | "wrong_person"
  | "stop" // unsubscribe
  | "complaint" // angry / spam accusation
  | "auto_reply" // out of office
  | "bounce"
  | "unclear";

export interface Reply {
  id: string;
  customerId?: string;
  opportunityId?: string;
  touchId?: string;
  channel: Channel;
  receivedAt: ISODateTime;
  from: string;
  text: string;
  intent: ReplyIntent;
  confidence: number;
  extracted: ReplyExtract;
  status: "new" | "handed_off" | "done";
  handedOffAt?: ISODateTime;
  ownerContactedAt?: ISODateTime;
  outcome?: "booked" | "quoted" | "lost" | "no_answer";
  outcomeValue?: Money;
}

export interface ReplyExtract {
  phone?: string;
  bestTime?: string;
  timeframe?: string;
  mentionsPrice?: boolean;
  mentionsCompetitor?: boolean;
  urgency?: "high" | "normal" | "low";
  followUpOn?: ISODate;
}

export interface Recovery {
  id: string;
  customerId: string;
  opportunityId?: string;
  /** The last touch before they came back. */
  touchId?: string;
  record: { kind: RecordKind; id: string };
  value: Money;
  cameBackOn: ISODate;
  match: "same_record" | "customer_id" | "email" | "phone" | "address" | "owner_reported";
  confidence: number;
  /** Days between our last touch and their return. */
  lagDays?: number;
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export type AgentId = "reader" | "finder" | "writer" | "sender" | "inbox" | "dispatcher" | "ledger" | "guard" | "reporter";

export interface AgentEvent {
  id: string;
  at: ISODateTime;
  agent: AgentId;
  kind: "info" | "action" | "review" | "warning" | "win";
  title: string;
  detail?: string;
  refs?: { kind: string; id: string }[];
}
