/**
 * Pure mapping: Jobber GraphQL nodes -> engine records (Customer, Quote, Job, Invoice, ServiceRequest).
 *
 * Ids follow the CSV import scheme so a business can start from CSV and later connect Jobber without duplicates
 * (see mergePulled in packages/engine/src/ingest/normalize.ts):
 *   quote   makeId("q", "jobber", quoteNumber)      job     makeId("j", "jobber", jobNumber)
 *   invoice makeId("i", "jobber", invoiceNumber)    request makeId("r", "jobber", <request EncodedId>)
 * Pulled customers carry the provisional id `jobber:<client EncodedId>` (also their only sourceId) and every pulled
 * record points at it; mergePulled resolves it to the real customer. `sourceId` on records is Jobber's EncodedId
 * (what the API and writeNote need); `number` is the human number.
 *
 * Status enums VERIFIED against the live schema (introspection, version 2026-09-25):
 *   QuoteStatusTypeEnum   draft awaiting_response archived approved converted changes_requested
 *   JobStatusTypeEnum     requires_invoicing archived late today upcoming action_required on_hold unscheduled
 *                         active expiring_within_30_days
 *   InvoiceStatusTypeEnum draft awaiting_payment paid past_due bad_debt sent_not_due voided ("voided" since 2026-05-12)
 *   RequestStatusTypeEnum new completed converted archived upcoming overdue unscheduled assessment_completed today
 *                         needs_approval ("needs_approval" since 2026-04-13)
 * Jobber's own description says `on_hold` is an alias of `action_required` ("still active, no more upcoming visits;
 * a prompt to either schedule more visits or close the job"), so both map to on_hold — NOT unscheduled, which would
 * make finished-but-unclosed jobs look like "approved, never scheduled" breakage.
 *
 * ASSUMED:
 * - Dates: we take the calendar part of Jobber's ISO timestamp as written (Jobber sends local offsets, e.g.
 *   2021-08-12T16:31:36-06:00); the account timezone isn't applied.
 * - Invoice.receivedDate is treated as the paid date, and only for invoices whose status is paid.
 * - ClientPhoneNumber.smsAllowed is NOT marketing consent, so smsConsent is never set from Jobber.
 * - receivesQuoteFollowUps === false or receivesFollowUps === false means the owner turned follow-ups off for that
 *   person: we tag them and set doNotContact (their setting wins over ours).
 */
import type { Address, Customer, Invoice, InvoiceStatus, Job, JobStatus, LineItem, Quote, QuoteStatus, RequestStatus, ServiceRequest } from "@qa/engine";
// Runtime helpers come from the util module directly: it has no dependencies, so this integration never loads
// (or breaks on) unrelated engine modules.
import { extractEmails, isLikelyValidEmail, makeId, normalizePhone, round2, splitName } from "@qa/engine/util.ts";
import { QUOTE_LINE_ITEMS, type ApiAddress, type ApiClient, type ApiClientRef, type ApiInvoice, type ApiJob, type ApiLineItem, type ApiQuote, type ApiRequest } from "./queries.ts";

export const SOURCE = "jobber" as const;
export const FOLLOW_UPS_OFF_TAG = "Jobber: follow-ups off";
export const LEAD_TAG = "Jobber: lead";
export const ARCHIVED_CLIENT_TAG = "Jobber: archived client";

/* ------------------------------ ids ------------------------------ */

export const customerRef = (clientId: string): string => `${SOURCE}:${clientId}`;
export const quoteId = (quoteNumber: string | number): string => makeId("q", SOURCE, String(quoteNumber));
export const jobId = (jobNumber: string | number): string => makeId("j", SOURCE, String(jobNumber));
export const invoiceId = (invoiceNumber: string | number): string => makeId("i", SOURCE, String(invoiceNumber));
export const requestId = (encodedId: string): string => makeId("r", SOURCE, encodedId);

/* ------------------------------ statuses ------------------------------ */

export const QUOTE_STATUS: Record<string, QuoteStatus> = {
  draft: "draft",
  awaiting_response: "awaiting_response",
  changes_requested: "changes_requested",
  approved: "approved",
  converted: "converted",
  archived: "archived",
};

export const INVOICE_STATUS: Record<string, InvoiceStatus> = {
  paid: "paid",
  past_due: "past_due",
  awaiting_payment: "awaiting_payment",
  sent_not_due: "awaiting_payment",
  draft: "draft",
  bad_debt: "bad_debt",
  voided: "void",
};

export const REQUEST_STATUS: Record<string, RequestStatus> = {
  new: "new",
  assessment_completed: "assessment_completed",
  completed: "assessment_completed",
  upcoming: "assessment_scheduled",
  today: "assessment_scheduled",
  overdue: "assessment_scheduled",
  unscheduled: "assessment_scheduled",
  needs_approval: "assessment_scheduled",
  converted: "converted",
  archived: "archived",
};

export function mapQuoteStatus(raw: string): QuoteStatus {
  return QUOTE_STATUS[raw.toLowerCase()] ?? "unknown";
}

export function mapJobStatus(raw: string, completedAt?: string | null): JobStatus {
  switch (raw.toLowerCase()) {
    case "upcoming":
      return "scheduled";
    case "today":
    case "active":
    case "expiring_within_30_days":
      return "active";
    case "unscheduled":
      return "unscheduled";
    case "action_required":
    case "on_hold":
      return "on_hold";
    case "late":
      return "late";
    case "requires_invoicing":
      return "requires_invoicing";
    case "archived":
      return completedAt ? "completed" : "archived";
    default:
      return "unknown";
  }
}

export function mapInvoiceStatus(raw: string): InvoiceStatus {
  return INVOICE_STATUS[raw.toLowerCase()] ?? "unknown";
}

export function mapRequestStatus(raw: string): RequestStatus {
  return REQUEST_STATUS[raw.toLowerCase()] ?? "unknown";
}

/* ------------------------------ small helpers ------------------------------ */

/** "2024-05-03T14:22:00-06:00" -> "2024-05-03" (the date as Jobber wrote it). */
export function isoDate(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s.trim());
  return m ? m[1] : undefined;
}

function str(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function money(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? round2(n) : 0;
}

export function mapAddress(a: ApiAddress | null | undefined): Address | undefined {
  if (!a) return undefined;
  const street = [str(a.street1), str(a.street2)].filter(Boolean).join(" ");
  if (!street) return undefined;
  const out: Address = { street };
  if (str(a.city)) out.city = str(a.city);
  if (str(a.province)) out.state = str(a.province);
  if (str(a.postalCode)) out.zip = str(a.postalCode);
  return out;
}

function primaryFirst<T extends { primary?: boolean | null }>(xs: T[] | null | undefined): T[] {
  return [...(xs ?? [])].sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
}

/* ------------------------------ customers ------------------------------ */

function nameParts(c: ApiClientRef): { name: string; firstName: string; lastName: string; companyName?: string } {
  let firstName = str(c.firstName);
  let lastName = str(c.lastName);
  const companyName = str(c.companyName) || undefined;
  const name = str(c.name) || [firstName, lastName].filter(Boolean).join(" ") || companyName || "";
  if (!firstName && !lastName && name && !(c.isCompany && name === companyName)) {
    const s = splitName(name);
    firstName = s.first;
    lastName = s.last;
  }
  return { name, firstName, lastName, companyName };
}

/** A full client record from the clients query. */
export function mapClient(c: ApiClient): Customer {
  const ref = customerRef(c.id);
  const { name, firstName, lastName, companyName } = nameParts(c);

  const emails: string[] = [];
  for (const e of primaryFirst(c.emails)) for (const x of extractEmails(e.address)) if (isLikelyValidEmail(x) && !emails.includes(x)) emails.push(x);

  const phones: string[] = [];
  for (const p of primaryFirst(c.phones)) {
    const n = normalizePhone(p.number);
    if (n && !phones.includes(n)) phones.push(n);
  }

  const tags: string[] = [];
  for (const t of c.tags?.nodes ?? []) if (str(t.label) && !tags.includes(str(t.label))) tags.push(str(t.label));
  const followUpsOff = c.receivesQuoteFollowUps === false || c.receivesFollowUps === false;
  if (followUpsOff) tags.push(FOLLOW_UPS_OFF_TAG);
  if (c.isLead) tags.push(LEAD_TAG);
  if (c.isArchived) tags.push(ARCHIVED_CLIENT_TAG);

  const address = mapAddress(c.billingAddress);
  const properties: Address[] = [];
  for (const p of c.clientProperties?.nodes ?? []) {
    const a = mapAddress(p.address);
    if (a && !properties.some((x) => x.street.toLowerCase() === a.street.toLowerCase())) properties.push(a);
  }

  const out: Customer = {
    id: ref,
    sourceIds: [ref],
    name,
    firstName,
    lastName,
    emails,
    phones,
    properties,
    tags,
  };
  if (companyName) out.companyName = companyName;
  if (address ?? properties[0]) out.address = address ?? properties[0];
  const created = isoDate(c.createdAt);
  if (created) out.createdOn = created;
  if (followUpsOff) out.doNotContact = true;
  if (c.isCompany) out.isCommercial = true;
  return out;
}

/**
 * Minimal stand-in for a client referenced by a quote/job/invoice/request that wasn't in this pull
 * (incremental syncs only fetch changed clients). mergePulled matches it to the existing customer by its
 * `jobber:<id>` source id and adds nothing but the link; if the customer is truly new it gets a name at least.
 */
export function mapClientRef(c: ApiClientRef): Customer {
  const ref = customerRef(c.id);
  const { name, firstName, lastName, companyName } = nameParts(c);
  const out: Customer = { id: ref, sourceIds: [ref], name, firstName, lastName, emails: [], phones: [], properties: [], tags: [] };
  if (companyName) out.companyName = companyName;
  if (c.isCompany) out.isCommercial = true;
  return out;
}

/* ------------------------------ quotes ------------------------------ */

export function mapLineItem(li: ApiLineItem, status: QuoteStatus): LineItem | undefined {
  if (li.textOnly) return undefined; // a text line carries no price or choice
  const item: LineItem = { name: str(li.name) || "Item", total: money(li.totalPrice) };
  if (str(li.description)) item.description = str(li.description);
  if (typeof li.quantity === "number") item.quantity = li.quantity;
  if (typeof li.unitPrice === "number") item.unitPrice = money(li.unitPrice);
  if (li.optional) {
    item.optional = true;
    // Only a decided quote tells us what the customer picked; before that `recommended` is the business's default.
    if (status === "approved" || status === "converted") item.selected = li.recommended !== false;
  }
  return item;
}

export function mapQuote(q: ApiQuote, warn?: (msg: string) => void): Quote | undefined {
  const number = str(String(q.quoteNumber ?? ""));
  if (!number) {
    warn?.(`Skipped a Jobber quote with no quote number (${q.id}).`);
    return undefined;
  }
  if (!q.client?.id) {
    warn?.(`Skipped Jobber quote #${number}: no client on it.`);
    return undefined;
  }
  const status = mapQuoteStatus(q.quoteStatus);
  const lt = q.lastTransitioned ?? {};
  const at = (s: QuoteStatus) => (status === s ? isoDate(q.transitionedAt) : undefined);
  const lineItems = (q.lineItems?.nodes ?? []).map((li) => mapLineItem(li, status)).filter((x): x is LineItem => !!x);
  if ((q.lineItems?.nodes.length ?? 0) >= QUOTE_LINE_ITEMS) warn?.(`Jobber quote #${number} has ${QUOTE_LINE_ITEMS}+ line items; only the first ${QUOTE_LINE_ITEMS} were read.`);

  const quote: Quote = {
    id: quoteId(number),
    sourceId: q.id,
    number,
    customerId: customerRef(q.client.id),
    title: str(q.title) || lineItems.map((l) => l.name).slice(0, 3).join(", ") || `Quote #${number}`,
    lineItems,
    total: money(q.amounts?.total ?? q.amounts?.subtotal),
    status,
    rawStatus: q.quoteStatus,
    jobIds: (q.jobs?.nodes ?? []).map((j) => jobId(j.jobNumber)),
  };
  const set = <K extends keyof Quote>(k: K, v: Quote[K] | undefined) => {
    if (v !== undefined && v !== "") quote[k] = v;
  };
  set("createdOn", isoDate(q.createdAt));
  set("sentOn", isoDate(q.sentAt) ?? at("awaiting_response"));
  set("approvedOn", isoDate(lt.approvedAt) ?? at("approved"));
  set("convertedOn", isoDate(lt.convertedAt) ?? at("converted"));
  set("changesRequestedOn", isoDate(lt.changesRequestedAt) ?? at("changes_requested"));
  set("archivedOn", at("archived"));
  set("viewedOn", isoDate(q.clientHubViewedAt));
  set("property", mapAddress(q.property?.address));
  set("salesperson", str(q.salesperson?.name?.full) || undefined);
  return quote;
}

/* ------------------------------ jobs ------------------------------ */

export function mapJob(j: ApiJob, warn?: (msg: string) => void): Job | undefined {
  const number = str(String(j.jobNumber ?? ""));
  if (!number) {
    warn?.(`Skipped a Jobber job with no job number (${j.id}).`);
    return undefined;
  }
  if (!j.client?.id) {
    warn?.(`Skipped Jobber job #${number}: no client on it.`);
    return undefined;
  }
  const job: Job = {
    id: jobId(number),
    sourceId: j.id,
    number,
    customerId: customerRef(j.client.id),
    title: str(j.title) || `Job #${number}`,
    lineItems: [],
    total: money(j.total),
    status: mapJobStatus(j.jobStatus, j.completedAt),
    rawStatus: j.jobStatus,
  };
  const created = isoDate(j.createdAt);
  if (created) job.createdOn = created;
  const start = isoDate(j.startAt);
  if (start) job.scheduledOn = start;
  const done = isoDate(j.completedAt);
  if (done) job.completedOn = done;
  const qn = j.quote ? str(String(j.quote.quoteNumber ?? "")) : "";
  if (qn) {
    job.quoteRef = qn;
    job.quoteId = quoteId(qn);
  }
  if (j.jobType === "RECURRING") job.recurring = true;
  const prop = mapAddress(j.property?.address);
  if (prop) job.property = prop;
  return job;
}

/* ------------------------------ invoices ------------------------------ */

export function mapInvoice(inv: ApiInvoice, warn?: (msg: string) => void): Invoice | undefined {
  const number = str(String(inv.invoiceNumber ?? ""));
  if (!number) {
    warn?.(`Skipped a Jobber invoice with no invoice number (${inv.id}).`);
    return undefined;
  }
  if (!inv.client?.id) {
    warn?.(`Skipped Jobber invoice #${number}: no client on it.`);
    return undefined;
  }
  const status = mapInvoiceStatus(inv.invoiceStatus);
  const total = money(inv.amounts?.total);
  const balance = inv.amounts?.invoiceBalance != null ? money(inv.amounts.invoiceBalance) : status === "paid" || status === "void" ? 0 : total;
  const out: Invoice = {
    id: invoiceId(number),
    sourceId: inv.id,
    number,
    customerId: customerRef(inv.client.id),
    subject: str(inv.subject) || `Invoice #${number}`,
    total,
    balance,
    status,
    rawStatus: inv.invoiceStatus,
  };
  const issued = isoDate(inv.issuedDate) ?? isoDate(inv.createdAt);
  if (issued) out.issuedOn = issued;
  const due = isoDate(inv.dueDate);
  if (due) out.dueOn = due;
  const paid = status === "paid" ? isoDate(inv.receivedDate) : undefined;
  if (paid) out.paidOn = paid;
  const jn = inv.jobs?.nodes?.[0]?.jobNumber;
  if (jn != null && str(String(jn))) {
    out.jobRef = str(String(jn));
    out.jobId = jobId(out.jobRef);
  }
  return out;
}

/* ------------------------------ requests ------------------------------ */

export function mapRequest(r: ApiRequest, warn?: (msg: string) => void): ServiceRequest | undefined {
  if (!r.client?.id) {
    warn?.(`Skipped a Jobber request with no client (${r.id}).`);
    return undefined;
  }
  const out: ServiceRequest = {
    id: requestId(r.id),
    sourceId: r.id,
    customerId: customerRef(r.client.id),
    title: str(r.title) || "Service request",
    status: mapRequestStatus(r.requestStatus),
    rawStatus: r.requestStatus,
  };
  const created = isoDate(r.createdAt);
  if (created) out.createdOn = created;
  // the exact moment matters for answering within minutes
  if (typeof r.createdAt === "string" && /T\d\d:\d\d/.test(r.createdAt)) out.createdAt = r.createdAt;
  const assess = isoDate(r.assessment?.startAt);
  if (assess) out.assessmentOn = assess;
  const qn = r.quotes?.nodes?.[0]?.quoteNumber;
  if (qn != null && str(String(qn))) {
    out.quoteRef = str(String(qn));
    out.quoteId = quoteId(out.quoteRef);
  }
  if (str(r.source)) out.source = str(r.source);
  const prop = mapAddress(r.property?.address);
  if (prop) out.property = prop;
  return out;
}
