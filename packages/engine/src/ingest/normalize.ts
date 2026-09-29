import type {
  Address,
  Customer,
  Dataset,
  ImportRecord,
  Invoice,
  Job,
  LineItem,
  Quote,
  QuoteStatus,
  RecordKind,
  ServiceRequest,
  SourceSystem,
} from "../model.ts";
import {
  addressKey,
  extractEmails,
  extractPhones,
  isLikelyValidEmail,
  looksCommercial,
  makeId,
  parseAddress,
  parseDate,
  parseMoney,
  splitName,
  titleCase,
} from "../util.ts";
import type { Table } from "./csv.ts";
import type { Detection } from "./detect.ts";
import { INVOICE_STATUS_MAP, JOB_STATUS_MAP, QUOTE_STATUS_MAP, REQUEST_STATUS_MAP, SOURCE_QUOTE_STATUS, type Field } from "./fields.ts";

interface Person {
  sourceClientId?: string;
  name: string;
  first: string;
  last: string;
  company?: string;
  emails: string[];
  phones: string[];
  address?: Address;
  tags: string[];
  leadSource?: string;
  doNotContact?: boolean;
  smsOptIn?: boolean;
  createdOn?: string;
}

interface Row {
  person: Person;
  cells: (f: Field) => string;
  index: number;
}

function cellGetter(row: string[], fields: Partial<Record<Field, number>>) {
  return (f: Field): string => {
    const i = fields[f];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
}

function truthy(v: string): boolean {
  return /^(y|yes|true|1|x|✓|opted ?in|subscribed)$/i.test(v.trim());
}

function readPerson(get: (f: Field) => string): Person {
  let first = get("firstName");
  let last = get("lastName");
  let name = get("name");
  const company = get("company") || undefined;
  if (!name && (first || last)) name = `${first} ${last}`.trim();
  if (name && !first) {
    const s = splitName(name);
    first = s.first;
    last = last || s.last;
  }
  if (!name && company) name = company;
  const emails = [...extractEmails(get("email"))].filter(isLikelyValidEmail);
  const phones = [...extractPhones(get("mobile")), ...extractPhones(get("phone"))];
  let address: Address | undefined;
  const street = get("street");
  if (street) {
    address = {
      street: [street, get("street2")].filter(Boolean).join(" "),
      city: get("city") || undefined,
      state: get("state") || undefined,
      zip: get("zip") || undefined,
    };
  } else if (get("address")) {
    address = parseAddress(get("address"));
    if (address) {
      if (!address.city && get("city")) address.city = get("city");
      if (!address.state && get("state")) address.state = get("state");
      if (!address.zip && get("zip")) address.zip = get("zip");
    }
  }
  const tags = get("tags")
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const optOut = get("marketingOptOut");
  return {
    sourceClientId: get("clientId") || undefined,
    name: titleCaseName(name),
    first: titleCase(first),
    last: titleCase(last),
    company,
    emails: [...new Set(emails)],
    phones: [...new Set(phones)],
    address,
    tags,
    leadSource: get("leadSource") || undefined,
    doNotContact: optOut ? truthy(optOut) : tags.some((t) => /do not (contact|email|call)|dnc|no marketing|unsubscribed/i.test(t)) || undefined,
    smsOptIn: get("smsOptIn") ? truthy(get("smsOptIn")) : undefined,
    createdOn: parseDate(get("clientCreatedOn")),
  };
}

function titleCaseName(s: string): string {
  if (!s) return s;
  if (looksCommercial(s)) return s;
  return s
    .split(" ")
    .map((w) => titleCase(w))
    .join(" ");
}

function mapStatus<T extends string>(raw: string, table: [RegExp, T][]): T | undefined {
  for (const [re, v] of table) if (re.test(raw)) return v;
  return undefined;
}

export function parseLineItems(text: string): LineItem[] {
  if (!text.trim()) return [];
  const parts = text
    .split(/\n|;|\s\|\s|•/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => {
    const optional = /\(optional\)|\boptional\b|\badd[- ]on\b|\boption\b/i.test(p);
    const unselected = /\b(not selected|declined|unselected)\b/i.test(p);
    const moneyMatch = p.match(/\$\s?[\d,]+(?:\.\d{2})?(?!.*\$)/);
    const qtyMatch = p.match(/\((?:qty:?\s*)?(\d+(?:\.\d+)?)\)|\bx\s?(\d+)\b|\bqty:?\s*(\d+)/i);
    const total = moneyMatch ? (parseMoney(moneyMatch[0]) ?? 0) : 0;
    const name = p
      .replace(/\$\s?[\d,]+(?:\.\d{2})?/g, "")
      .replace(/\((?:qty:?\s*)?\d+(?:\.\d+)?\)|\bx\s?\d+\b|\bqty:?\s*\d+/gi, "")
      .replace(/\((optional|not selected|declined|unselected)\)|\b(optional|not selected|declined)\b/gi, "")
      .replace(/[-–:@]\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
    const item: LineItem = { name: name || p, total };
    const q = qtyMatch ? Number(qtyMatch[1] ?? qtyMatch[2] ?? qtyMatch[3]) : undefined;
    if (q) item.quantity = q;
    if (optional) {
      item.optional = true;
      item.selected = !unselected ? undefined : false;
    }
    if (unselected) {
      item.optional = true;
      item.selected = false;
    }
    return item;
  });
}

function inferQuoteStatus(q: Omit<Quote, "status"> & { status?: QuoteStatus }): QuoteStatus {
  if (q.convertedOn) return "converted";
  if (q.approvedOn) return "approved";
  if (q.changesRequestedOn) return "changes_requested";
  if (q.archivedOn) return "archived";
  if (q.sentOn) return "awaiting_response";
  return "unknown";
}

export interface ImportResult {
  dataset: Dataset;
  record: ImportRecord;
}

/**
 * Turn one parsed table into records and merge them into the dataset.
 * Pure: returns a new dataset object (arrays are rebuilt, records replaced by id).
 */
export function importTable(
  dataset: Dataset,
  table: Table,
  detection: Detection,
  opts: { fileName: string; importedAt: string },
): ImportResult {
  const { kind, source, mapping } = detection;
  const warnings = [...detection.warnings];
  const rows: Row[] = table.rows.map((r, index) => {
    const cells = cellGetter(r, mapping.fields);
    return { person: readPerson(cells), cells, index };
  });

  const resolver = new CustomerResolver(dataset.customers);
  const quotes = new Map(dataset.quotes.map((q) => [q.id, q]));
  const jobs = new Map(dataset.jobs.map((j) => [j.id, j]));
  const invoices = new Map(dataset.invoices.map((i) => [i.id, i]));
  const requests = new Map(dataset.requests.map((r) => [r.id, r]));

  let accepted = 0;
  let rejected = 0;
  let noContact = 0;

  for (const row of rows) {
    const p = row.person;
    const get = row.cells;
    if (!p.name && !p.emails.length && !p.phones.length) {
      rejected++;
      continue;
    }
    if (!p.emails.length && !p.phones.length) noContact++;
    const customer = resolver.resolve(p, source);
    const number = get("number");
    const recId = (k: RecordKind) => makeId(k[0]!, source, number || `${customer.id}|${row.index}|${get("title")}|${get("createdOn")}|${get("total")}`);
    const lineItems = parseLineItems(get("lineItems"));
    const title = get("title") || lineItems.map((l) => l.name).slice(0, 3).join(", ") || get("description").slice(0, 120);
    const itemsTotal = lineItems.reduce((s, l) => s + (l.optional && l.selected === false ? 0 : l.total), 0);
    const total = parseMoney(get("total")) ?? parseMoney(get("subtotal")) ?? (itemsTotal || 0);
    const property = p.address;
    const rawStatus = get("status");

    if (kind === "quote") {
      const base = {
        id: recId("quote"),
        sourceId: number || undefined,
        number: number || undefined,
        customerId: customer.id,
        title,
        lineItems,
        total,
        rawStatus,
        createdOn: parseDate(get("createdOn")) ?? parseDate(get("sentOn")),
        sentOn: parseDate(get("sentOn")),
        approvedOn: parseDate(get("approvedOn")),
        convertedOn: parseDate(get("convertedOn")),
        archivedOn: parseDate(get("archivedOn")),
        changesRequestedOn: parseDate(get("changesRequestedOn")),
        viewedOn: parseDate(get("viewedOn")),
        property,
        salesperson: get("salesperson") || undefined,
        jobIds: [] as string[],
      };
      let status = rawStatus ? (mapStatus(rawStatus, SOURCE_QUOTE_STATUS[source] ?? []) ?? mapStatus(rawStatus, QUOTE_STATUS_MAP)) : undefined;
      if (!status) status = inferQuoteStatus(base);
      // "Sent" + a converted date means converted, whatever the status column says.
      if (base.convertedOn && status !== "converted") status = "converted";
      const prev = quotes.get(base.id);
      quotes.set(base.id, { ...prev, ...stripUndefined(base), status, jobIds: prev?.jobIds ?? [] } as Quote);
      accepted++;
    } else if (kind === "job" || kind === "visit") {
      const jt = get("jobType");
      const job: Job = {
        id: recId("job"),
        sourceId: number || undefined,
        number: number || undefined,
        customerId: customer.id,
        title,
        lineItems,
        total,
        status: mapStatus(rawStatus, JOB_STATUS_MAP) ?? (parseDate(get("completedOn")) ? "completed" : parseDate(get("scheduledOn")) ? "scheduled" : "unknown"),
        rawStatus,
        createdOn: parseDate(get("createdOn")) ?? parseDate(get("scheduledOn")),
        scheduledOn: parseDate(get("scheduledOn")),
        completedOn: parseDate(get("completedOn")),
        recurring: /recurr|weekly|bi-?weekly|monthly|quarterly|annual|seasonal|contract|maintenance|plan/i.test(jt) || undefined,
        property,
      };
      const qn = get("quoteNumber");
      if (qn) job.quoteRef = qn;
      const prev = jobs.get(job.id);
      jobs.set(job.id, { ...prev, ...stripUndefined(job) } as Job);
      accepted++;
    } else if (kind === "invoice") {
      const bal = parseMoney(get("balance"));
      const paidOn = parseDate(get("paidOn"));
      let status = mapStatus(rawStatus, INVOICE_STATUS_MAP);
      const dueOn = parseDate(get("dueOn"));
      if (!status) status = paidOn || bal === 0 ? "paid" : dueOn && dueOn < dataset.asOf ? "past_due" : "awaiting_payment";
      const inv: Invoice = {
        id: recId("invoice"),
        sourceId: number || undefined,
        number: number || undefined,
        customerId: customer.id,
        subject: title,
        total,
        balance: bal ?? (status === "paid" || status === "void" ? 0 : total),
        status,
        rawStatus,
        issuedOn: parseDate(get("issuedOn")) ?? parseDate(get("createdOn")),
        dueOn,
        paidOn,
      };
      const jn = get("jobNumber");
      if (jn) inv.jobRef = jn;
      invoices.set(inv.id, { ...invoices.get(inv.id), ...stripUndefined(inv) } as Invoice);
      accepted++;
    } else if (kind === "request") {
      const req: ServiceRequest = {
        id: recId("request"),
        sourceId: number || undefined,
        customerId: customer.id,
        title,
        status: mapStatus(rawStatus, REQUEST_STATUS_MAP) ?? "unknown",
        rawStatus,
        createdOn: parseDate(get("createdOn")),
        assessmentOn: parseDate(get("assessmentOn")),
        source: p.leadSource,
        property,
      };
      const qn = get("quoteNumber");
      if (qn) req.quoteRef = qn;
      requests.set(req.id, { ...requests.get(req.id), ...stripUndefined(req) } as ServiceRequest);
      accepted++;
    } else {
      // client list: the person is the record
      const created = parseDate(get("createdOn"));
      if (created && !customer.createdOn) customer.createdOn = created;
      // Jobber's Client Re-Engagement report only has "Last Closed Job": keep it as a past job
      const lastJob = parseDate(get("lastJobOn"));
      if (lastJob) {
        const jid = makeId("j", source, "last", customer.id, lastJob);
        if (!jobs.has(jid) && ![...jobs.values()].some((j) => j.customerId === customer.id && (j.completedOn ?? j.scheduledOn) === lastJob)) {
          jobs.set(jid, { id: jid, customerId: customer.id, title: get("title") || "Past job", lineItems: [], total: 0, status: "completed", rawStatus: "Last closed job", completedOn: lastJob, createdOn: lastJob });
        }
      }
      accepted++;
    }
  }

  if (noContact) warnings.push(`${noContact.toLocaleString("en-US")} rows have no email or phone.`);

  const next: Dataset = {
    ...dataset,
    customers: resolver.all(),
    quotes: [...quotes.values()],
    jobs: [...jobs.values()],
    invoices: [...invoices.values()],
    requests: [...requests.values()],
  };
  linkRecords(next);

  const record: ImportRecord = {
    id: makeId("imp", opts.fileName, opts.importedAt),
    fileName: opts.fileName,
    importedAt: opts.importedAt,
    source,
    kind,
    rows: table.rows.length,
    accepted,
    rejected,
    mapping: Object.fromEntries(Object.entries(mapping.fields).map(([f, i]) => [f, table.headers[i as number] ?? ""])),
    warnings,
  };
  next.imports = [...dataset.imports, record];
  if (dataset.business.software === "unknown" && source !== "spreadsheet") next.business = { ...dataset.business, software: source };
  return { dataset: next, record };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") (out as Record<string, unknown>)[k] = v;
  return out;
}

/* ------------------------------------------------------------------ */
/* Customer resolution                                                 */
/* ------------------------------------------------------------------ */

class CustomerResolver {
  private byId = new Map<string, Customer>();
  private bySource = new Map<string, string>();
  private byEmail = new Map<string, string>();
  private byPhone = new Map<string, string>();
  private byNameAddr = new Map<string, string>();

  constructor(existing: Customer[]) {
    for (const c of existing) this.index(structuredCloneCustomer(c));
  }

  private index(c: Customer) {
    this.byId.set(c.id, c);
    for (const s of c.sourceIds) this.bySource.set(s, c.id);
    for (const e of c.emails) this.byEmail.set(e, c.id);
    for (const p of c.phones) this.byPhone.set(p, c.id);
    const na = nameAddrKey(c.name, c.address?.street);
    if (na) this.byNameAddr.set(na, c.id);
  }

  resolve(p: Person, source: SourceSystem): Customer {
    const sourceKey = p.sourceClientId ? `${source}:${p.sourceClientId}` : undefined;
    let id: string | undefined;
    if (sourceKey) id = this.bySource.get(sourceKey);
    if (!id) for (const e of p.emails) if ((id = this.byEmail.get(e))) break;
    if (!id) for (const ph of p.phones) if ((id = this.byPhone.get(ph))) break;
    if (!id) {
      const na = nameAddrKey(p.name, p.address?.street);
      if (na) id = this.byNameAddr.get(na);
    }
    if (id) {
      const c = this.byId.get(id)!;
      mergePerson(c, p, sourceKey);
      this.index(c);
      return c;
    }
    const c: Customer = {
      id: makeId("c", sourceKey ?? p.emails[0] ?? p.phones[0] ?? nameAddrKey(p.name, p.address?.street) ?? p.name),
      sourceIds: sourceKey ? [sourceKey] : [],
      name: p.name || p.company || "",
      firstName: p.first,
      lastName: p.last,
      companyName: p.company,
      emails: [...p.emails],
      phones: [...p.phones],
      address: p.address,
      properties: p.address ? [p.address] : [],
      tags: [...p.tags],
      createdOn: p.createdOn,
      leadSource: p.leadSource,
      doNotContact: p.doNotContact,
      isCommercial: looksCommercial(p.company || p.name || "") || undefined,
    };
    this.index(c);
    return c;
  }

  all(): Customer[] {
    return [...this.byId.values()];
  }
}

function structuredCloneCustomer(c: Customer): Customer {
  return { ...c, sourceIds: [...c.sourceIds], emails: [...c.emails], phones: [...c.phones], properties: [...c.properties], tags: [...c.tags] };
}

function nameAddrKey(name: string | undefined, street: string | undefined): string | undefined {
  const n = (name || "").toLowerCase().replace(/[^a-z]/g, "");
  const a = addressKey(street);
  if (n.length < 3 || !a) return undefined;
  return `${n}|${a}`;
}

function mergePerson(c: Customer, p: Person, sourceKey?: string) {
  if (sourceKey && !c.sourceIds.includes(sourceKey)) c.sourceIds.push(sourceKey);
  for (const e of p.emails) if (!c.emails.includes(e)) c.emails.push(e);
  for (const ph of p.phones) if (!c.phones.includes(ph)) c.phones.push(ph);
  if (!c.name && p.name) c.name = p.name;
  if (!c.firstName && p.first) c.firstName = p.first;
  if (!c.lastName && p.last) c.lastName = p.last;
  if (!c.companyName && p.company) c.companyName = p.company;
  if (p.address) {
    if (!c.address) c.address = p.address;
    const k = addressKey(p.address.street);
    if (k && !c.properties.some((x) => addressKey(x.street) === k)) c.properties.push(p.address);
  }
  for (const t of p.tags) if (!c.tags.includes(t)) c.tags.push(t);
  if (p.doNotContact) c.doNotContact = true;
  if (p.createdOn && (!c.createdOn || p.createdOn < c.createdOn)) c.createdOn = p.createdOn;
  if (!c.leadSource && p.leadSource) c.leadSource = p.leadSource;
}

/* ------------------------------------------------------------------ */
/* Cross-record linking                                                */
/* ------------------------------------------------------------------ */

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(" ")
      .filter((w) => w.length > 2 && !/^(the|and|for|with|job|quote|estimate|service|services|work)$/.test(w)),
  );
}

function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

/**
 * Connect jobs to the quotes they came from (by number, else by customer + timing + title),
 * then correct quote statuses the export got wrong (a quote whose job exists is not dead).
 */
export function linkRecords(ds: Dataset): void {
  const quoteByNumber = new Map<string, Quote>();
  for (const q of ds.quotes) if (q.number) quoteByNumber.set(q.number.replace(/^#/, ""), q);
  const quotesByCustomer = new Map<string, Quote[]>();
  for (const q of ds.quotes) {
    q.jobIds = [];
    (quotesByCustomer.get(q.customerId) ?? quotesByCustomer.set(q.customerId, []).get(q.customerId)!).push(q);
  }

  for (const j of ds.jobs) {
    const qn = j.quoteRef;
    let q: Quote | undefined;
    if (qn) q = quoteByNumber.get(qn.replace(/^#/, ""));
    if (!q && !j.quoteId) {
      const jd = j.createdOn ?? j.scheduledOn ?? j.completedOn;
      const cands = (quotesByCustomer.get(j.customerId) ?? []).filter((x) => {
        const qd = x.approvedOn ?? x.sentOn ?? x.createdOn;
        if (!qd || !jd) return false;
        const lag = (Date.parse(jd) - Date.parse(qd)) / 86400000;
        return lag >= -2 && lag <= 240;
      });
      let best = 0;
      for (const c of cands) {
        const s = similarity(c.title, j.title) + (c.total && j.total && Math.abs(c.total - j.total) / Math.max(c.total, j.total) < 0.25 ? 0.6 : 0);
        if (s > best && s >= 0.5) {
          best = s;
          q = c;
        }
      }
    }
    if (q) {
      j.quoteId = q.id;
      q.jobIds.push(j.id);
    } else if (j.quoteId) {
      const lq = ds.quotes.find((x) => x.id === j.quoteId);
      if (lq) lq.jobIds.push(j.id);
    }
  }

  for (const q of ds.quotes) {
    if (q.jobIds.length && q.status !== "converted" && q.status !== "approved") {
      q.status = "converted";
      if (!q.convertedOn) {
        const firstJob = ds.jobs.filter((j) => q.jobIds.includes(j.id)).map((j) => j.createdOn ?? j.scheduledOn).filter(Boolean).sort()[0];
        if (firstJob) q.convertedOn = firstJob;
      }
    }
  }

  const jobByNumber = new Map<string, Job>();
  for (const j of ds.jobs) if (j.number) jobByNumber.set(j.number.replace(/^#/, ""), j);
  for (const inv of ds.invoices) {
    const jn = inv.jobRef;
    if (jn && !inv.jobId) {
      const j = jobByNumber.get(jn.replace(/^#/, ""));
      if (j) inv.jobId = j.id;
    }
  }
  for (const r of ds.requests) {
    const qn = r.quoteRef;
    if (qn && !r.quoteId) {
      const q = quoteByNumber.get(qn.replace(/^#/, ""));
      if (q) r.quoteId = q.id;
    }
    if (!r.quoteId) {
      // a quote for the same customer created on/after the request = it got quoted
      const rd = r.createdOn;
      const q = (quotesByCustomer.get(r.customerId) ?? []).find((x) => {
        const qd = x.createdOn ?? x.sentOn;
        return rd && qd && qd >= rd && (Date.parse(qd) - Date.parse(rd)) / 86400000 < 120;
      });
      if (q) r.quoteId = q.id;
    }
    if (r.quoteId && r.status !== "archived") r.status = "converted";
  }
}

/* ------------------------------------------------------------------ */
/* Records pulled from an API (Jobber GraphQL, etc.)                   */
/* ------------------------------------------------------------------ */

export interface PulledBatch {
  customers: Customer[];
  quotes: Quote[];
  jobs: Job[];
  invoices: Invoice[];
  requests: ServiceRequest[];
}

/**
 * Fold API records into the dataset. Pulled customers carry provisional ids; they are resolved
 * against existing customers (same source id, email, phone or name+address) exactly like CSV rows,
 * and every pulled record is re-pointed at the resolved customer. Records upsert by id, so ids must
 * follow the CSV scheme: makeId("q", source, quoteNumber), makeId("j", source, jobNumber),
 * makeId("i", source, invoiceNumber), makeId("r", source, requestNumberOrId).
 */
export function mergePulled(dataset: Dataset, pulled: PulledBatch, source: SourceSystem): Dataset {
  const resolver = new CustomerResolver(dataset.customers);
  const remap = new Map<string, string>();
  for (const pc of pulled.customers) {
    const person: Person = {
      sourceClientId: pc.sourceIds.find((s) => s.startsWith(`${source}:`))?.slice(source.length + 1),
      name: pc.name,
      first: pc.firstName,
      last: pc.lastName,
      company: pc.companyName,
      emails: pc.emails.filter(isLikelyValidEmail),
      phones: pc.phones,
      address: pc.address,
      tags: pc.tags,
      leadSource: pc.leadSource,
      doNotContact: pc.doNotContact,
      createdOn: pc.createdOn,
    };
    const c = resolver.resolve(person, source);
    for (const p of pc.properties) {
      const k = addressKey(p.street);
      if (k && !c.properties.some((x) => addressKey(x.street) === k)) c.properties.push(p);
    }
    if (pc.isCommercial) c.isCommercial = true;
    if (pc.smsConsent && !c.smsConsent) c.smsConsent = pc.smsConsent;
    remap.set(pc.id, c.id);
  }
  const fix = <T extends { customerId: string }>(r: T): T => ({ ...r, customerId: remap.get(r.customerId) ?? r.customerId });
  const upsert = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
    const m = new Map(existing.map((x) => [x.id, x]));
    for (const x of incoming) m.set(x.id, { ...m.get(x.id), ...stripUndefined(x) } as T);
    return [...m.values()];
  };
  const next: Dataset = {
    ...dataset,
    customers: resolver.all(),
    quotes: upsert(dataset.quotes, pulled.quotes.map(fix)),
    jobs: upsert(dataset.jobs, pulled.jobs.map(fix)),
    invoices: upsert(dataset.invoices, pulled.invoices.map(fix)),
    requests: upsert(dataset.requests, pulled.requests.map(fix)),
  };
  linkRecords(next);
  if (next.business.software === "unknown" || next.business.software === "spreadsheet") next.business = { ...next.business, software: source };
  return next;
}
