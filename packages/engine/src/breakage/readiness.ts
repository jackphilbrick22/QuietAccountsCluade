import type { Dataset, RecordKind, SourceSystem } from "../model.ts";
import { addDays, daysBetween } from "../util.ts";

/**
 * What we still need from the owner, in the words the operator will use to ask for it.
 *
 * Quiet Accounts is run white-glove: the owner never opens a dashboard. So the moment files land,
 * the operator needs a short, exact list: "ask Dave for the Jobs export — it finds the people who said
 * yes and were never scheduled". Each gap says what it unlocks and where the file lives in their software.
 */
export interface DataGap {
  id: string;
  /** blocker = we can't start without it; unlocks = more money found with it; sharpen = better accuracy. */
  level: "blocker" | "unlocks" | "sharpen";
  /** What to ask the owner for, one line. */
  ask: string;
  /** Why it matters, in owner words. */
  unlocks: string;
  /** Where the file lives in their software. */
  where?: string;
}

export interface Readiness {
  /** Can we plan and send right now? */
  ready: boolean;
  have: Record<Kind, number>;
  monthsOfHistory: number;
  emailShare: number;
  gaps: DataGap[];
  /** One line for the operator console. */
  headline: string;
}

type Kind = Exclude<RecordKind, "visit">;

const WHERE: Partial<Record<SourceSystem, Partial<Record<Kind | "all_time", string>>>> = {
  jobber: {
    quote: "Jobber: Insights → Reports → Quotes → All time → Export (Jobber emails the CSV).",
    client: "Jobber: Clients → ⋯ → Export clients (1,500 rows per file; send them all).",
    job: "Jobber: Insights → Reports → One-off jobs and Recurring jobs → All time → Export.",
    invoice: "Jobber: Insights → Reports → Invoices → All time → Export.",
    request: "Jobber: Insights → Reports → Requests → All time → Export.",
    all_time: "Jobber reports default to this year — set the range to All time.",
  },
  housecall_pro: {
    quote: "Housecall Pro: Estimates → Outcome: Open, Lost and Won → Actions → Export.",
    client: "Housecall Pro: Customers → Export.",
    job: "Housecall Pro: Jobs → all dates → Export.",
    invoice: "Housecall Pro: Invoices → all dates → Export.",
  },
  servicetitan: {
    quote: "ServiceTitan: Reports → Opportunity and Estimate Follow Up → full date range → Export.",
    client: "ServiceTitan: Reports → Customer list → Export.",
    job: "ServiceTitan: Reports → Jobs → full date range → Export.",
    invoice: "ServiceTitan: Reports → Invoices → full date range → Export.",
  },
  quickbooks: {
    quote: "QuickBooks: Reports → Estimates by Customer → All dates → Export.",
    client: "QuickBooks: Sales → Customers → Export.",
    invoice: "QuickBooks: Reports → Invoice List → All dates → Export.",
  },
};

function where(source: SourceSystem | undefined, kind: Kind | "all_time"): string | undefined {
  return (source && WHERE[source]?.[kind]) || undefined;
}

export function readiness(ds: Dataset): Readiness {
  const have: Record<Kind, number> = {
    quote: ds.quotes.length,
    client: ds.customers.length,
    job: ds.jobs.length,
    invoice: ds.invoices.length,
    request: ds.requests.length,
  };
  const source = ds.imports.find((i) => i.source !== "unknown")?.source ?? ds.business.software;
  // imports can be recorded under "client" or "customer" depending on the path; count both
  const clientFile = ds.imports.some((i) => i.kind === "client");
  const gaps: DataGap[] = [];

  const dates = [
    ...ds.quotes.map((q) => q.sentOn ?? q.createdOn),
    ...ds.jobs.map((j) => j.completedOn ?? j.scheduledOn ?? j.createdOn),
    ...ds.invoices.map((i) => i.issuedOn),
  ].filter((d): d is string => !!d && d <= ds.asOf);
  const first = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : undefined;
  const monthsOfHistory = first ? Math.round(daysBetween(first, ds.asOf) / 30.44) : 0;

  const people = ds.customers.filter((c) => !c.isCommercial);
  const emailShare = people.length ? people.filter((c) => c.emails.length > 0).length / people.length : 0;

  if (!have.quote && !have.job && !have.invoice) {
    gaps.push({
      id: "no_work_records",
      level: "blocker",
      ask: "The quotes export (all time).",
      unlocks: "It's the main file: every price they gave that never turned into a job.",
      where: where(source, "quote"),
    });
  } else if (!have.quote) {
    gaps.push({ id: "no_quotes", level: "unlocks", ask: "The quotes export (all time).", unlocks: "Finds every quote that never got a yes — usually the biggest pile of money.", where: where(source, "quote") });
  }
  if (have.client + have.quote > 0 && emailShare < 0.25) {
    gaps.push({
      id: "no_emails",
      level: have.quote && !clientFile ? "blocker" : "unlocks",
      ask: clientFile ? "A client list that includes email addresses." : "The client list export.",
      unlocks: `Only ${Math.round(emailShare * 100)}% of people have an email on file, and email is how we reach them.`,
      where: where(source, "client"),
    });
  } else if (!clientFile && have.quote) {
    gaps.push({ id: "no_clients", level: "unlocks", ask: "The client list export.", unlocks: "Finds past customers who never came back and fills in missing emails and addresses.", where: where(source, "client") });
  }
  if (!have.job) {
    gaps.push({
      id: "no_jobs",
      level: "unlocks",
      ask: "The jobs export (one-off and recurring, all time).",
      unlocks: "Finds people who said yes and were never scheduled, regulars who stopped, and service that's come due — and stops us writing to anyone who already came back.",
      where: where(source, "job"),
    });
  }
  if (!have.invoice) {
    gaps.push({
      id: "no_invoices",
      level: "sharpen",
      ask: "The invoices export (all time).",
      unlocks: "Proves what came back in dollars and gives a real revenue baseline for the guarantee.",
      where: where(source, "invoice"),
    });
  }
  if (!have.request && (source === "jobber" || source === "housecall_pro")) {
    gaps.push({ id: "no_requests", level: "unlocks", ask: "The requests export (all time).", unlocks: "Finds people who asked for a price and never got one.", where: where(source, "request") });
  }
  if (dates.length && monthsOfHistory < 12) {
    const recent = dates.filter((d) => d >= addDays(ds.asOf, -400)).length === dates.length;
    gaps.push({
      id: "short_history",
      level: "unlocks",
      ask: "The same exports with the date range set to all time.",
      unlocks: `We only see ${monthsOfHistory} months. Older quotes and past customers are where most of the money sits.`,
      where: recent ? where(source, "all_time") : undefined,
    });
  }

  const ready = !gaps.some((g) => g.level === "blocker");
  const unlocks = gaps.filter((g) => g.level === "unlocks").length;
  const headline = !ready
    ? `Can't start yet — need ${gaps.find((g) => g.level === "blocker")!.ask.replace(/\.$/, "").toLowerCase()}.`
    : unlocks
      ? `Ready to start. ${unlocks} more file${unlocks === 1 ? "" : "s"} would find more money.`
      : "Ready to start. We have everything we need.";
  return { ready, have, monthsOfHistory, emailShare: Math.round(emailShare * 100) / 100, gaps, headline };
}
