/**
 * Small, explicit builders for hand-made datasets. Every field a test does not care about
 * gets a boring default, so each test only states the facts it is about.
 */
import type { BusinessProfile, Customer, Dataset, Invoice, ISODate, Job, Opportunity, Quote, ServiceRequest, BreakageType } from "../src/model.ts";
import type { ScanResult } from "../src/breakage/detect.ts";
import { addDays } from "../src/util.ts";

export const ASOF: ISODate = "2026-09-29"; // a Tuesday

/** The date `n` days before `from` (ASOF by default). */
export function ago(n: number, from: ISODate = ASOF): ISODate {
  return addDays(from, -n);
}

export function business(over: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id: "biz-1",
    name: "Ridgeline Tree Co.",
    trade: "tree",
    otherTrades: [],
    software: "jobber",
    ownerName: "Dave Ridge",
    ownerFirstName: "Dave",
    ownerPhone: "+16035550199",
    signerName: "Sarah",
    signerRole: "office",
    businessPhone: "+16035550100",
    mailingAddress: "14 Mill Rd, Concord, NH 03301",
    city: "Concord",
    state: "NH",
    timezone: "America/New_York",
    avgJobValue: 1000,
    sendDays: [2, 3, 4],
    sendWindow: [7, 10],
    blackoutWeeks: [],
    minQuoteValue: 400,
    minQuoteAgeDays: 21,
    maxQuoteAgeMonths: 36,
    weeklyNewContacts: 75,
    openCrewWeeks: [],
    voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] },
    persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0 },
    channels: { email: "live" },
    plan: { stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [] },
    createdOn: ASOF,
    ...over,
  };
}

export function customer(id: string, over: Partial<Customer> = {}): Customer {
  return {
    id,
    sourceIds: [id],
    name: "Mike Sanderson",
    firstName: "Mike",
    lastName: "Sanderson",
    emails: [`${id}@gmail.com`],
    phones: [],
    address: { street: "14 Oak Ln", city: "Concord", state: "NH", zip: "03301" },
    properties: [],
    tags: [],
    ...over,
  };
}

export function quote(id: string, customerId: string, over: Partial<Quote> = {}): Quote {
  return {
    id,
    customerId,
    title: "Crown thinning, 3 maples",
    lineItems: [],
    total: 1500,
    status: "awaiting_response",
    rawStatus: "Awaiting response",
    sentOn: ago(60),
    jobIds: [],
    ...over,
  };
}

export function job(id: string, customerId: string, over: Partial<Job> = {}): Job {
  return {
    id,
    customerId,
    title: "Oak removal",
    lineItems: [],
    total: 1000,
    status: "completed",
    rawStatus: "Completed",
    completedOn: ago(60),
    ...over,
  };
}

export function invoice(id: string, customerId: string, over: Partial<Invoice> = {}): Invoice {
  return {
    id,
    customerId,
    subject: "For services rendered: Oak removal",
    total: 850,
    balance: 850,
    status: "awaiting_payment",
    rawStatus: "Awaiting payment",
    issuedOn: ago(60),
    dueOn: ago(30),
    ...over,
  };
}

export function request(id: string, customerId: string, over: Partial<ServiceRequest> = {}): ServiceRequest {
  return {
    id,
    customerId,
    title: "Dead pine leaning toward house",
    status: "new",
    rawStatus: "New",
    createdOn: ago(20),
    ...over,
  };
}

export function dataset(parts: Partial<Omit<Dataset, "business">> & { business?: Partial<BusinessProfile> } = {}): Dataset {
  return {
    business: business(parts.business),
    customers: parts.customers ?? [],
    quotes: parts.quotes ?? [],
    jobs: parts.jobs ?? [],
    invoices: parts.invoices ?? [],
    requests: parts.requests ?? [],
    imports: parts.imports ?? [],
    asOf: parts.asOf ?? ASOF,
  };
}

/** Every opportunity for one customer, optionally of one type. */
export function oppsFor(result: ScanResult, customerId: string, type?: BreakageType): Opportunity[] {
  return result.opportunities.filter((o) => o.customerId === customerId && (!type || o.type === type));
}

/** The single opportunity of `type` for a customer; fails loudly if there isn't exactly one. */
export function oneOpp(result: ScanResult, customerId: string, type: BreakageType): Opportunity {
  const found = oppsFor(result, customerId, type);
  if (found.length !== 1) throw new Error(`expected one ${type} for ${customerId}, found ${found.length}: ${result.opportunities.map((o) => `${o.customerId}/${o.type}`).join(", ")}`);
  return found[0]!;
}

/** Reachable (not suppressed) opportunities of a type for a customer. */
export function reachable(result: ScanResult, customerId: string, type: BreakageType): Opportunity[] {
  return oppsFor(result, customerId, type).filter((o) => !o.suppressed);
}
