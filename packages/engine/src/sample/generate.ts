import type { BusinessProfile, Dataset, ISODate, TradeId } from "../model.ts";
import { emptyDataset, ingestFile, toCSV } from "../ingest/index.ts";
import { growingSeason, playbook, SEASONAL_TRADES } from "../trades/index.ts";
import { addDays, addMonths, daysBetween, monthOf, rng } from "../util.ts";
import { CATALOG, EMAIL_DOMAINS, FIRST_NAMES, LAST_NAMES, MONTH_WEIGHT, QUOTES_PER_MONTH, RECURRING_VISIT, STREETS, TOWNS, type CatalogItem } from "./catalog.ts";

export interface SampleOptions {
  trade: TradeId;
  asOf: ISODate;
  seed?: number | string;
  /** Average quotes written per month. */
  quotesPerMonth?: number;
  /** Months of history. */
  months?: number;
  businessName?: string;
  ownerName?: string;
  signerName?: string;
}

export interface SampleFile {
  name: string;
  kind: "quote" | "client" | "job" | "invoice" | "request";
  text: string;
}

export interface Sample {
  business: BusinessProfile;
  files: SampleFile[];
  dataset: Dataset;
}

const BUSINESS_NAMES: Partial<Record<TradeId, string>> = {
  tree: "Ridgeline Tree Co.",
  septic: "Granite State Septic",
  lawn: "Greenline Lawn & Landscape",
  fence: "Stonewall Fence Co.",
  concrete: "Merrimack Concrete",
  pressure_washing: "Clearview Exterior Wash",
  holiday_lighting: "Bright Nights Holiday Lighting",
  deck: "Kearsarge Deck & Porch",
};

interface RawClient {
  id: number;
  first: string;
  last: string;
  company?: string;
  email?: string;
  phone?: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  tags: string[];
  source: string;
  created: ISODate;
}

interface RawQuote {
  num: number;
  client: RawClient;
  title: string;
  lineItems: string;
  total: number;
  status: string;
  created: ISODate;
  sent?: ISODate;
  changes?: ISODate;
  approved?: ISODate;
  converted?: ISODate;
  archived?: ISODate;
  viewed?: ISODate;
  jobNum?: number;
  salesperson: string;
}

interface RawJob {
  num: number;
  client: RawClient;
  title: string;
  status: string;
  created: ISODate;
  start?: ISODate;
  completed?: ISODate;
  total: number;
  quoteNum?: number;
  type: string;
}

interface RawInvoice {
  num: number;
  client: RawClient;
  subject: string;
  status: string;
  issued: ISODate;
  due: ISODate;
  paid?: ISODate;
  total: number;
  balance: number;
  jobNum: number;
}

interface RawRequest {
  num: number;
  client: RawClient;
  title: string;
  status: string;
  created: ISODate;
  assessment?: ISODate;
  source: string;
  quoteNum?: number;
}

function money(r: () => number, low: number, high: number): number {
  const v = low + (high - low) * Math.pow(r(), 1.35);
  return Math.round(v / 25) * 25;
}

function weighted<T extends { weight: number }>(items: T[], r: () => number): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let x = r() * total;
  for (const i of items) {
    x -= i.weight;
    if (x <= 0) return i;
  }
  return items[items.length - 1]!;
}

function fmtUS(d: ISODate | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

export function generateSample(opts: SampleOptions): Sample {
  const r = rng(opts.seed ?? `${opts.trade}-${opts.asOf}`);
  const trade = opts.trade;
  const pb = playbook(trade);
  const catalog = CATALOG[trade] ?? CATALOG.tree!;
  const months = opts.months ?? 36;
  const qpm = opts.quotesPerMonth ?? QUOTES_PER_MONTH[trade] ?? 58;
  const start = addMonths(opts.asOf, -months);
  const salespeople = [opts.ownerName ?? "Dave Ridge", "Marcus Hale"];
  const visit = RECURRING_VISIT[trade];
  const recurring = !!visit;

  const business: BusinessProfile = {
    id: `demo-${trade}`,
    name: opts.businessName ?? BUSINESS_NAMES[trade] ?? `Sample ${pb.label} Co.`,
    trade,
    otherTrades: [],
    software: "jobber",
    ownerName: opts.ownerName ?? "Dave Ridge",
    ownerFirstName: (opts.ownerName ?? "Dave Ridge").split(" ")[0]!,
    ownerPhone: "+16035550199",
    ownerEmail: "dave@example-tree.com",
    signerName: opts.signerName ?? "Sarah",
    signerRole: "office",
    replyTo: "office@example-tree.com",
    businessPhone: "+16035550100",
    mailingAddress: "14 Mill Rd, Concord, NH 03301",
    city: "Concord",
    state: "NH",
    timezone: "America/New_York",
    website: "example-tree.com",
    sendDays: [2, 3, 4],
    sendWindow: [7, 10],
    blackoutWeeks: [],
    minQuoteValue: pb.minQuote,
    minQuoteAgeDays: 21,
    maxQuoteAgeMonths: 36,
    weeklyNewContacts: 75,
    crewNote: pb.crewLine,
    openCrewWeeks: [],
    voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] },
    persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0.1 },
    channels: { email: "live", postcard: "coming_soon", sms: "coming_soon", call_task: "ready", voicemail: "coming_soon", retarget: "coming_soon" },
    plan: { stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [] },
    createdOn: opts.asOf,
  };

  const clients: RawClient[] = [];
  let clientSeq = 1000;
  const usedEmails = new Set<string>();
  const newClient = (created: ISODate): RawClient => {
    const first = FIRST_NAMES[Math.floor(r() * FIRST_NAMES.length)]!;
    const last = LAST_NAMES[Math.floor(r() * LAST_NAMES.length)]!;
    const town = TOWNS[Math.floor(r() * TOWNS.length)]!;
    const commercial = r() < 0.03;
    const company = commercial ? [`${last} Property Management LLC`, `${town.city} Village HOA`, `First Church of ${town.city}`][Math.floor(r() * 3)] : undefined;
    let email: string | undefined;
    if (r() < 0.86) {
      const style = Math.floor(r() * 5);
      const base = [
        `${first}.${last}`,
        `${first[0]}${last}`,
        `${first}${last}${Math.floor(r() * 90 + 10)}`,
        `${last}${first[0]}`,
        `${first}${Math.floor(r() * 900 + 100)}`,
      ][style]!
        .toLowerCase()
        .replace(/[^a-z0-9.]/g, "");
      email = `${base}@${EMAIL_DOMAINS[Math.floor(r() * EMAIL_DOMAINS.length)]}`;
      while (usedEmails.has(email)) email = email.replace("@", `${Math.floor(r() * 9)}@`);
      usedEmails.add(email);
    }
    const phone = r() < 0.93 ? `(603) 555-${String(Math.floor(r() * 9000 + 1000))}` : undefined;
    const tags: string[] = [];
    if (r() < 0.012) tags.push("Do not contact");
    const c: RawClient = {
      id: clientSeq++,
      first,
      last,
      company,
      email,
      phone,
      street: `${Math.floor(r() * 180 + 2)} ${STREETS[Math.floor(r() * STREETS.length)]}`,
      city: town.city,
      state: town.state,
      zip: town.zip,
      tags,
      source: ["Google", "Referral", "Website", "Facebook", "Yard sign", "Repeat"][Math.floor(r() * 6)]!,
      created,
    };
    clients.push(c);
    return c;
  };

  const quotes: RawQuote[] = [];
  const jobs: RawJob[] = [];
  const invoices: RawInvoice[] = [];
  const requests: RawRequest[] = [];
  let qn = 1001;
  let jn = 501;
  let inn = 2001;
  let rn = 301;

  const addJob = (client: RawClient, title: string, total: number, created: ISODate, quoteNum?: number, type = "One-off", on?: ISODate) => {
    const startD = on ?? addDays(created, 5 + Math.floor(r() * 30));
    const done = startD < opts.asOf;
    const j: RawJob = {
      num: jn++,
      client,
      title,
      status: done ? (r() < 0.8 ? "Archived" : "Completed") : r() < 0.85 ? "Upcoming" : "Unscheduled",
      created,
      start: done || r() < 0.85 ? startD : undefined,
      completed: done ? startD : undefined,
      total,
      quoteNum,
      type,
    };
    jobs.push(j);
    if (done) {
      const paidLag = Math.floor(r() * 25);
      const paid = r() < 0.94 ? addDays(startD, paidLag) : undefined;
      const due = addDays(startD, 30);
      invoices.push({
        num: inn++,
        client,
        subject: `For services rendered: ${title}`,
        status: paid && paid <= opts.asOf ? "Paid" : due < opts.asOf ? "Past due" : "Awaiting payment",
        issued: startD,
        due,
        paid: paid && paid <= opts.asOf ? paid : undefined,
        total,
        balance: paid && paid <= opts.asOf ? 0 : total,
        jobNum: j.num,
      });
    }
    return j;
  };

  // Seed older history so "service due" and "one and done" have something to find.
  const priorCount = Math.round(qpm * 6);
  for (let i = 0; i < priorCount; i++) {
    const d = addDays(start, -Math.floor(r() * 730) - 30);
    const c = newClient(d);
    const item = weighted(catalog, r);
    addJob(c, item.title, money(r, item.low, item.high), d);
  }

  for (let m = 0; m < months; m++) {
    const monthStart = addMonths(start, m);
    const mo = monthOf(monthStart);
    const peak = MONTH_WEIGHT[trade]?.[mo - 1] ?? (pb.peakMonths.cold.includes(mo) ? 1.35 : [12, 1, 2].includes(mo) ? 0.55 : 0.9);
    const n = Math.round(qpm * peak * (0.85 + r() * 0.3));
    for (let i = 0; i < n; i++) {
      const created = addDays(monthStart, Math.floor(r() * 28));
      if (created > opts.asOf) continue;
      const existing = clients.length > 40 && r() < 0.22 ? clients[Math.floor(r() * clients.length)]! : undefined;
      const client = existing ?? newClient(created);
      const item: CatalogItem = weighted(catalog, r);
      const base = money(r, item.low, item.high);
      let total = base;
      let li = `${item.title} $${base.toLocaleString("en-US")}`;
      let addOnSelected: boolean | undefined;
      if (item.addOn && r() < 0.55) {
        const addVal = money(r, item.addOn.low, item.addOn.high);
        addOnSelected = r() < 0.4;
        li += `; ${item.addOn.name} (optional) $${addVal.toLocaleString("en-US")}${addOnSelected ? "" : " - not selected"}`;
        if (addOnSelected) total += addVal;
      }
      // requests precede ~70% of quotes
      const hadRequest = r() < 0.7;
      const reqDate = addDays(created, -Math.floor(r() * 8) - 1);
      const sent = addDays(created, Math.floor(r() * 3));
      const age = daysBetween(sent, opts.asOf);
      const x = r();
      let status: string;
      let approved: ISODate | undefined;
      let converted: ISODate | undefined;
      let archived: ISODate | undefined;
      let changes: ISODate | undefined;
      if (age < 18) {
        status = x < 0.3 ? "Converted" : x < 0.33 ? "Approved" : "Awaiting response";
      } else if (x < 0.47) status = "Converted";
      else if (x < 0.485) status = age < 200 ? "Approved" : "Converted";
      else if (x < 0.505) status = "Changes requested";
      else if (x < 0.55) status = "Archived"; // lost / declined, archived by the office
      else if (x < 0.76) status = "Archived";
      else status = "Awaiting response";
      if (status === "Converted" || status === "Approved") {
        approved = addDays(sent, 1 + Math.floor(r() * 18));
        if (approved > opts.asOf) approved = opts.asOf;
      }
      if (status === "Converted") converted = approved;
      if (status === "Archived") archived = addDays(sent, 30 + Math.floor(r() * 150));
      if (archived && archived > opts.asOf) {
        status = "Awaiting response";
        archived = undefined;
      }
      if (status === "Changes requested") changes = addDays(sent, 2 + Math.floor(r() * 10));
      const q: RawQuote = {
        num: qn++,
        client,
        title: item.title,
        lineItems: li,
        total: status === "Converted" || status === "Approved" ? total : base,
        status,
        created,
        sent,
        changes,
        approved,
        converted,
        archived,
        viewed: r() < 0.45 ? addDays(sent, Math.floor(r() * 4)) : undefined,
        salesperson: salespeople[r() < 0.7 ? 0 : 1]!,
      };
      quotes.push(q);
      if (hadRequest) {
        requests.push({ num: rn++, client, title: item.title.replace(/ x\d+| \d+.*$/, ""), status: "Converted", created: reqDate, assessment: addDays(reqDate, 2), source: client.source, quoteNum: q.num });
      }
      if (converted) {
        const job = addJob(client, item.title, q.total, converted, q.num, recurring && /weekly|program|season/i.test(item.title) ? "Recurring" : "One-off");
        q.jobNum = job.num;
      }
      // Some dead-quote customers come back on their own later (these must NOT be counted as breakage).
      if (!converted && status !== "Approved" && r() < 0.05) {
        const back = addDays(sent, 60 + Math.floor(r() * 300));
        if (back < addDays(opts.asOf, -7)) addJob(client, item.title, base, back);
      }
    }
    // Requests that never got a quote (busy weeks).
    const lost = Math.round(n * 0.05);
    for (let i = 0; i < lost; i++) {
      const d = addDays(monthStart, Math.floor(r() * 28));
      if (d > addDays(opts.asOf, -3)) continue;
      const c = newClient(d);
      const item = weighted(catalog, r);
      requests.push({ num: rn++, client: c, title: `${item.title.split(/[-,+]/)[0]!.trim()} - needs quote`, status: r() < 0.4 ? "New" : r() < 0.6 ? "Assessment completed" : "Archived", created: d, assessment: r() < 0.5 ? addDays(d, 3) : undefined, source: c.source });
    }
  }

  // Recurring customers that lapsed (lawn / wash): regular visits, then a stop. A lawn shop mows on its visit days
  // in the growing season only, never through the winter.
  if (recurring) {
    const season = SEASONAL_TRADES.has(trade) ? growingSeason(business) : undefined;
    const regulars = clients.slice(0, Math.min(60, clients.length));
    for (const c of regulars) {
      const every = visit!.everyDays;
      let d = addDays(start, Math.floor(r() * 60));
      const stopAt = r() < 0.4 ? addDays(opts.asOf, -Math.floor(120 + r() * 300)) : opts.asOf;
      while (d < stopAt && d < addDays(opts.asOf, -3)) {
        if (!season) addJob(c, visit!.title, visit!.price, d, undefined, "Recurring");
        else if (d.slice(5) >= season.opens && d.slice(5) <= season.closes) addJob(c, visit!.title, visit!.price, addDays(d, -7), undefined, "Recurring", d);
        d = addDays(d, every);
      }
    }
  }

  const cn = (c: RawClient) => (c.company ? c.company : `${c.first} ${c.last}`);
  const prop = (c: RawClient) => `${c.street}, ${c.city}, ${c.state} ${c.zip}`;

  const files: SampleFile[] = [
    {
      name: "Quotes Report.csv",
      kind: "quote",
      text:
        `Quotes Report\nDate range: ${fmtUS(start)} - ${fmtUS(opts.asOf)}\n` +
        toCSV(
          ["Quote #", "Client name", "Client email address", "Client phone number", "Service street", "Service city", "Service state/province", "Service ZIP/postal code", "Salesperson", "Title", "Status", "Line items", "Total ($)", "Job #s", "Viewed in client hub", "Drafted date", "Sent date", "Changes requested date", "Approved date", "Converted date", "Archived date"],
          quotes.map((q) => [
            q.num, cn(q.client), q.client.email ?? "", q.client.phone ?? "", q.client.street, q.client.city, q.client.state, q.client.zip, q.salesperson, q.title, q.status, q.lineItems, q.total.toFixed(2), q.jobNum ?? "", fmtUS(q.viewed), fmtUS(q.created), fmtUS(q.sent), fmtUS(q.changes), fmtUS(q.approved), fmtUS(q.converted), fmtUS(q.archived),
          ]),
        ),
    },
    {
      name: "Client Contact Info.csv",
      kind: "client",
      text: toCSV(
        ["Client ID", "First name", "Last name", "Company name", "Email", "Main phone", "Billing street", "Billing city", "Billing state", "Billing zip", "Tags", "Lead source", "Created date"],
        clients.map((c) => [c.id, c.company ? "" : c.first, c.company ? "" : c.last, c.company ?? "", c.email ?? "", c.phone ?? "", c.street, c.city, c.state, c.zip, c.tags.join(", "), c.source, fmtUS(c.created)]),
      ),
    },
    {
      name: "Jobs Report.csv",
      kind: "job",
      text: toCSV(
        ["Job #", "Client name", "Client email", "Client phone", "Property", "Title", "Job status", "Job type", "Created date", "Start date", "Completed date", "Total ($)", "Quote #"],
        jobs.map((j) => [j.num, cn(j.client), j.client.email ?? "", j.client.phone ?? "", prop(j.client), j.title, j.status, j.type, fmtUS(j.created), fmtUS(j.start), fmtUS(j.completed), j.total.toFixed(2), j.quoteNum ?? ""]),
      ),
    },
    {
      name: "Invoices Report.csv",
      kind: "invoice",
      text: toCSV(
        ["Invoice #", "Client name", "Client email", "Subject", "Status", "Issued date", "Due date", "Paid date", "Total ($)", "Balance ($)", "Job #"],
        invoices.map((i) => [i.num, cn(i.client), i.client.email ?? "", i.subject, i.status, fmtUS(i.issued), fmtUS(i.due), fmtUS(i.paid), i.total.toFixed(2), i.balance.toFixed(2), i.jobNum]),
      ),
    },
    {
      name: "Requests Report.csv",
      kind: "request",
      text: toCSV(
        ["Request #", "Client name", "Client email address", "Client phone number", "Property", "Request title", "Status", "Requested on date", "Assessment date", "Lead source", "Quote #s"],
        requests.map((q) => [q.num, cn(q.client), q.client.email ?? "", q.client.phone ?? "", prop(q.client), q.title, q.status, fmtUS(q.created), fmtUS(q.assessment), q.source, q.quoteNum ?? ""]),
      ),
    },
  ];

  let ds = emptyDataset(business, opts.asOf);
  const at = `${opts.asOf}T12:00:00Z`;
  for (const f of files) ds = ingestFile(ds, f.text, f.name, at, { kind: f.kind }).dataset;
  return { business, files, dataset: ds };
}
