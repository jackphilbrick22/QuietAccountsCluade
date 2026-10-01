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
  const { kind, source } = detection;
  const fields = { ...detection.mapping.fields };
  // QuickBooks' "… by Customer" detail reports (Type and Num columns, grouped by customer or with a Name column of
  // their own) keep a running total in "Balance", not what's owed; what's owed is their "Open Balance". One with
  // neither that nor a status (Sales by Customer Detail, which setup asks for) lists past sales, line by line: those
  // were paid, and never read as money still to collect.
  const detail = source === "quickbooks" && (!!table.grouped || (table.headers.some((h) => /^(transaction )?type$/i.test(h)) && table.headers.some((h) => /^num$/i.test(h))));
  if (detail) {
    const open = table.headers.findIndex((h) => /^open balance$/i.test(h));
    if (open >= 0) fields.balance = open;
    else delete fields.balance;
  }
  const pastSales = kind === "invoice" && detail && fields.balance === undefined && fields.status === undefined;
  const mapping = { ...detection.mapping, fields };
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

  // Records with no number, by whose they are and the day they were written, with what each is for and its price
  // (see recId below).
  const unnumbered = new Map<string, { id: string; what: string; total?: number }[]>();
  const keep = (k: RecordKind, r: { id: string; number?: string; customerId: string; total?: number }, title: string | undefined, on: string | undefined) => {
    if (r.number) return;
    const key = contentKey(k, r.customerId, on);
    (unnumbered.get(key) ?? unnumbered.set(key, []).get(key)!).push({ id: r.id, what: plain(title), total: r.total });
  };
  for (const q of dataset.quotes) keep("quote", q, q.title, q.createdOn);
  for (const j of dataset.jobs) keep("job", j, j.title, j.createdOn);
  for (const i of dataset.invoices) keep("invoice", i, i.subject, i.issuedOn);
  for (const r of dataset.requests) keep("request", r, r.title, r.createdOn);
  const claimed = new Set<string>();
  const seenInFile = new Map<string, number>();
  // a past sale's lines, summed into the sale they belong to
  const saleTotals = new Map<string, number>();
  const unreadStatuses = new Map<string, number>();

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
    const lineItems = parseLineItems(get("lineItems"));
    // What the row is for, from the title or line items only. A sheet with no title column shows its notes instead.
    const named = get("title") || lineItems.map((l) => l.name).slice(0, 3).join(", ");
    // Blank when the export has no title (Jobber's are optional): kept as empty text, never dropped.
    const title = named || get("description").slice(0, 120);
    const itemsTotal = lineItems.reduce((s, l) => s + (l.optional && l.selected === false ? 0 : l.total), 0);
    const total = parseMoney(get("total")) ?? parseMoney(get("subtotal")) ?? (itemsTotal || 0);
    // With no number column, a row is known by whose it is, when it was written and what it's for, never by where it
    // sits in the file: the owner's updated sheet, with rows added on top or re-sorted and Pending changed to Sold,
    // updates the same records instead of leaving the old Pending copies to be chased. Notes shown in place of a
    // title are no part of it, so the "Signed 6/1" written when marking it Sold doesn't make a new quote: a row with
    // no title is matched on whose and when alone, the same price first. A true duplicate row keeps its own record by
    // its count, and a record an earlier import keyed another way is found by the same facts.
    const recId = (k: RecordKind): string => {
      const held: ReadonlyMap<string, { number?: string; sourceId?: string }> = k === "quote" ? quotes : k === "invoice" ? invoices : k === "request" ? requests : jobs;
      if (number) {
        // a record with another number already on this id (two numbers whose ids collide) keeps it
        const other = (id: string) => {
          const x = held.get(id);
          return !!x && (k === "request" ? x.sourceId : x.number) !== number;
        };
        return unclaimed(makeId(k[0]!, source, number), other, k[0]!, source, number);
      }
      const on =
        k === "quote" ? (parseDate(get("createdOn")) ?? parseDate(get("sentOn")))
        : k === "job" ? (parseDate(get("createdOn")) ?? parseDate(get("scheduledOn")))
        : k === "invoice" ? (parseDate(get("issuedOn")) ?? parseDate(get("createdOn")))
        : parseDate(get("createdOn"));
      const key = contentKey(k, customer.id, on);
      const what = plain(named);
      const mine = (unnumbered.get(key) ?? []).filter((r) => !claimed.has(r.id) && (!what || r.what === what));
      const n = seenInFile.get(`${key}|${what}`) ?? 0;
      seenInFile.set(`${key}|${what}`, n + 1);
      const id = (mine.find((r) => r.total === total) ?? mine[0])?.id ?? unclaimed(makeId(k[0]!, source, "row", key, what, n), (x) => held.has(x), k[0]!, source, "row", key, what, n);
      claimed.add(id);
      return id;
    };
    const property = p.address;
    const rawStatus = get("status");

    if (kind === "quote") {
      // Housecall Pro's "Status" is the estimate visit; its "Outcome" (Open / Won / Lost) is the decision
      const outcome = get("outcome");
      const read = (raw: string) => (raw ? (mapStatus(raw, SOURCE_QUOTE_STATUS[source] ?? []) ?? mapStatus(raw, QUOTE_STATUS_MAP)) : undefined);
      const decided = read(outcome);
      const base = {
        id: recId("quote"),
        sourceId: number || undefined,
        number: number || undefined,
        customerId: customer.id,
        title,
        lineItems,
        total,
        rawStatus: [rawStatus, outcome].filter(Boolean).join(" · "),
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
      let status = decided ?? read(rawStatus);
      // A status no rule reads ("Assigned", "Callback 2") is guessed from the dates like a sheet with no status
      // column, but held for a person: a word we don't know may well be the owner's "sold".
      const unread = !status && !!(rawStatus || outcome);
      if (!status) status = inferQuoteStatus(base);
      // "Sent" + a converted date means converted, whatever the status column says.
      if (base.convertedOn && status !== "converted") status = "converted";
      const unreadStatus = unread && status !== "converted" ? true : undefined;
      if (unreadStatus) {
        const said = (outcome || rawStatus).slice(0, 40);
        unreadStatuses.set(said, (unreadStatuses.get(said) ?? 0) + 1);
      }
      const prev = quotes.get(base.id);
      const q = { ...prev, ...stripUndefined(base), title: title || prev?.title || "", status, unreadStatus, jobIds: prev?.jobIds ?? [] } as Quote;
      // a re-sent sheet whose status now reads clears the hold
      if (!unreadStatus) delete q.unreadStatus;
      quotes.set(base.id, q);
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
      jobs.set(job.id, { ...prev, ...stripUndefined(job), title: title || prev?.title || "" } as Job);
      accepted++;
    } else if (kind === "invoice") {
      const id = recId("invoice");
      // a past sale's lines add up to the sale; one that comes to nothing or less is a credit or refund, not a sale
      const sum = pastSales ? (saleTotals.get(id) ?? 0) + total : total;
      if (pastSales) saleTotals.set(id, sum);
      const bal = pastSales ? 0 : parseMoney(get("balance"));
      const paidOn = parseDate(get("paidOn"));
      let status = pastSales && sum <= 0 ? "void" : mapStatus(rawStatus, INVOICE_STATUS_MAP);
      const dueOn = parseDate(get("dueOn"));
      if (!status) status = paidOn || bal === 0 ? "paid" : dueOn && dueOn < dataset.asOf ? "past_due" : "awaiting_payment";
      const inv: Invoice = {
        id,
        sourceId: number || undefined,
        number: number || undefined,
        customerId: customer.id,
        subject: title,
        total: sum,
        balance: bal ?? (status === "paid" || status === "void" ? 0 : total),
        status,
        rawStatus,
        issuedOn: parseDate(get("issuedOn")) ?? parseDate(get("createdOn")),
        dueOn,
        paidOn,
      };
      const jn = get("jobNumber");
      if (jn) inv.jobRef = jn;
      const prevInv = invoices.get(inv.id);
      invoices.set(inv.id, { ...prevInv, ...stripUndefined(inv), subject: title || prevInv?.subject || "" } as Invoice);
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
      const prevReq = requests.get(req.id);
      requests.set(req.id, { ...prevReq, ...stripUndefined(req), title: title || prevReq?.title || "" } as ServiceRequest);
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
  if (unreadStatuses.size) {
    const n = [...unreadStatuses.values()].reduce((a, b) => a + b, 0);
    const said = [...unreadStatuses.keys()].slice(0, 6).map((s) => `"${s}"`).join(", ");
    warnings.push(`${n.toLocaleString("en-US")} quote${n === 1 ? " has a status" : "s have statuses"} we don't recognise (${said}${unreadStatuses.size > 6 ? ", …" : ""}). They're held for a person to check before anyone writes.`);
  }
  if (resolver.sharedPhones.size)
    warnings.push(`${resolver.sharedPhones.size.toLocaleString("en-US")} phone number${resolver.sharedPhones.size === 1 ? " is" : "s are"} shared by people with different names or emails. They're kept as separate customers.`);

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

/** Where an unnumbered record is looked for: its kind, whose it is and the day it was written. */
function contentKey(kind: RecordKind, customerId: string, on: string | undefined): string {
  return [kind === "visit" ? "job" : kind, customerId, on ?? ""].join("|");
}

function plain(s: string | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Ids are short hashes, so now and then two records' ids collide. One never takes over another's: while `id` is held
 * by a record that isn't this one, the same parts salted with 2, 3, … are tried. The same record always lands on the
 * same id, and one already stored keeps its own.
 */
function unclaimed(id: string, heldByOther: (id: string) => boolean, prefix: string, ...parts: (string | number)[]): string {
  for (let n = 2; heldByOther(id); n++) id = makeId(prefix, ...parts, n);
  return id;
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
  private byPhone = new Map<string, string[]>();
  private byNameAddr = new Map<string, string>();
  private byName = new Map<string, Set<string>>();
  /** Numbers that two different people share (a landlord's line, the shop's own number typed as filler). */
  readonly sharedPhones = new Set<string>();

  constructor(existing: Customer[]) {
    for (const c of existing) this.index(structuredCloneCustomer(c));
  }

  private index(c: Customer) {
    this.byId.set(c.id, c);
    for (const s of c.sourceIds) this.bySource.set(s, c.id);
    for (const e of c.emails) this.byEmail.set(e, c.id);
    for (const p of c.phones) {
      const ids = this.byPhone.get(p) ?? [];
      if (!ids.includes(c.id)) this.byPhone.set(p, [...ids, c.id]);
    }
    const na = nameAddrKey(c.name, c.address?.street);
    if (na) this.byNameAddr.set(na, c.id);
    const nk = fullNameKey(c.firstName, c.lastName);
    if (nk) (this.byName.get(nk) ?? this.byName.set(nk, new Set()).get(nk)!).add(c.id);
  }

  resolve(p: Person, source: SourceSystem): Customer {
    const sourceKey = p.sourceClientId ? `${source}:${p.sourceClientId}` : undefined;
    let id: string | undefined;
    if (sourceKey) id = this.bySource.get(sourceKey);
    if (!id) for (const e of p.emails) if ((id = this.byEmail.get(e))) break;
    // A number alone joins two records only when nothing says they're two people: different emails or clearly
    // different names on one number stay two customers, so one person's quote is never mailed to the other.
    if (!id)
      for (const ph of p.phones) {
        const ids = this.byPhone.get(ph) ?? [];
        id = ids.find((x) => !differentPeople(this.byId.get(x)!, p));
        if (id) break;
        if (ids.length) this.sharedPhones.add(ph);
      }
    if (!id) {
      const na = nameAddrKey(p.name, p.address?.street);
      if (na) id = this.byNameAddr.get(na);
    }
    // A name and nothing else (QuickBooks' estimate lists) joins the one customer with that exact full name, when one
    // side has no email, phone or address to go on. Two people with the name, or two records from the software's
    // own client ids, stay apart.
    if (!id) {
      const nk = fullNameKey(p.first, p.last);
      const same = nk ? [...(this.byName.get(nk) ?? [])] : [];
      const c = same.length === 1 ? this.byId.get(same[0]!) : undefined;
      const otherClient = !!sourceKey && !!c?.sourceIds.some((s) => s.startsWith(`${source}:`) && s !== sourceKey);
      if (c && !otherClient && (isBare(p) || isBare(c))) id = c.id;
    }
    if (id) {
      const c = this.byId.get(id)!;
      mergePerson(c, p, sourceKey);
      this.index(c);
      return c;
    }
    const key = sourceKey ?? p.emails[0] ?? p.phones[0] ?? nameAddrKey(p.name, p.address?.street) ?? p.name;
    let cid = makeId("c", key);
    // a second person on a shared number with no email of their own gets an id of their own, not the first one's
    for (let n = 2; this.byId.has(cid); n++) cid = makeId("c", key, p.name, n);
    const c: Customer = {
      id: cid,
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

function letters(s: string | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

/** "mike sanderson": a full name, first and last, or nothing when either is missing. */
function fullNameKey(first: string | undefined, last: string | undefined): string | undefined {
  const f = letters(first);
  const l = letters(last);
  return f.length >= 2 && l.length >= 2 ? `${f} ${l}` : undefined;
}

function isBare(x: { emails: string[]; phones: string[]; address?: Address }): boolean {
  return !x.emails.length && !x.phones.length && !x.address?.street;
}

/**
 * Two people, not one, on a shared number: both have emails and none in common (unless it's the same full name
 * with a second address), or neither first nor last name matches. A household (same last name, no clashing emails)
 * and a name typed two ways ("Mike Sanderson" / "Mike Sandersen") are still one.
 */
function differentPeople(c: Customer, p: Person): boolean {
  const sameName = !!fullNameKey(p.first, p.last) && fullNameKey(c.firstName, c.lastName) === fullNameKey(p.first, p.last);
  if (c.emails.length && p.emails.length && !p.emails.some((e) => c.emails.includes(e)) && !sameName) return true;
  const cl = letters(c.lastName);
  const pl = letters(p.last);
  const cf = letters(c.firstName);
  const pf = letters(p.first);
  return !!cl && !!pl && cl !== pl && (!cf || !pf || cf !== pf);
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

function words(s: string | undefined): Set<string> {
  // a blank title stored before titles were always kept as text must never stop an import
  return new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(" ")
      .filter((w) => w.length > 2 && !/^(the|and|for|with|job|quote|estimate|service|services|work)$/.test(w)),
  );
}

function similarity(a: string | undefined, b: string | undefined): number {
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
  // A title left blank in the export (Jobber's are optional) is kept as empty text, including on records saved
  // before that was so: every later step reads titles as text.
  for (const q of ds.quotes) if (typeof q.title !== "string") q.title = "";
  for (const j of ds.jobs) if (typeof j.title !== "string") j.title = "";
  for (const i of ds.invoices) if (typeof i.subject !== "string") i.subject = "";
  for (const r of ds.requests) if (typeof r.title !== "string") r.title = "";
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
  // A record of another number already on a pulled record's id (two numbers whose ids collide) keeps it: the pulled
  // one takes the next salted id, and whatever points at it by number follows.
  type Numbered = { id: string; number?: string; sourceId?: string };
  const ident = (k: string, x: Numbered | undefined) => (k === "r" ? x?.sourceId : x?.number);
  const seat = (m: ReadonlyMap<string, Numbered>, k: string, id: string, key: string | undefined) =>
    key ? unclaimed(id, (x) => m.has(x) && ident(k, m.get(x)) !== key, k, source, key) : id;
  const upsert = <T extends Numbered>(existing: T[], incoming: T[], k: string): Map<string, T> => {
    const m = new Map(existing.map((x) => [x.id, x]));
    for (const x of incoming) {
      const id = seat(m, k, x.id, ident(k, x));
      m.set(id, { ...m.get(id), ...stripUndefined(x), id } as T);
    }
    return m;
  };
  const quotes = upsert(dataset.quotes, pulled.quotes.map(fix), "q");
  const jobs = upsert(dataset.jobs, pulled.jobs.map((j) => fix(j.quoteId ? { ...j, quoteId: seat(quotes, "q", j.quoteId, j.quoteRef) } : j)), "j");
  const invoices = upsert(dataset.invoices, pulled.invoices.map((i) => fix(i.jobId ? { ...i, jobId: seat(jobs, "j", i.jobId, i.jobRef) } : i)), "i");
  const requests = upsert(dataset.requests, pulled.requests.map((r) => fix(r.quoteId ? { ...r, quoteId: seat(quotes, "q", r.quoteId, r.quoteRef) } : r)), "r");
  const next: Dataset = {
    ...dataset,
    customers: resolver.all(),
    quotes: [...quotes.values()],
    jobs: [...jobs.values()],
    invoices: [...invoices.values()],
    requests: [...requests.values()],
  };
  linkRecords(next);
  if (next.business.software === "unknown" || next.business.software === "spreadsheet") next.business = { ...next.business, software: source };
  return next;
}
