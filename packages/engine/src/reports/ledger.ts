import type { ISODate, Money, Recovery } from "../model.ts";
import type { AccountState } from "../runtime/state.ts";
import { toCSV } from "../ingest/csv.ts";
import { COUNTING_RULES } from "../ledger/attribution.ts";
import { customerById, quoteById } from "../lookup.ts";

/**
 * The Recovered Ledger: every win on one line, with enough to check it against the owner's own books —
 * the note we sent, what they wrote back, the Jobber quote/job/invoice number, the amount, how it was
 * matched, and whether it counts. Nobody else in this market shows their work; this is the proof.
 */
export interface LedgerRow {
  id: string;
  customer: string;
  street: string;
  job: string;
  noteSentOn?: ISODate;
  noteSubject?: string;
  theyWrote?: string;
  record: string;
  cameBackOn: ISODate;
  daysAfterNote?: number;
  value: Money;
  paid: boolean;
  match: string;
  counts: boolean;
  status: string;
}

const MATCH_WORDS: Record<Recovery["match"], string> = {
  same_record: "the quote we followed up on was approved",
  customer_id: "same client in your records",
  email: "same email address",
  phone: "same phone number",
  address: "same property address",
  owner_reported: "you told us you booked it",
};

export function ledgerRows(state: AccountState): LedgerRow[] {
  const ds = state.dataset;
  return [...state.recoveries]
    .sort((a, b) => (a.cameBackOn < b.cameBackOn ? 1 : -1))
    .map((r) => {
      const c = customerById(ds, r.customerId);
      const touches = state.touches.filter((t) => t.customerId === r.customerId && (t.status === "sent" || t.status === "delivered")).sort((a, b) => ((a.sentAt ?? a.dueAt) < (b.sentAt ?? b.dueAt) ? 1 : -1));
      const last = touches[0];
      const reply = state.replies.filter((x) => x.customerId === r.customerId && !["auto_reply", "bounce"].includes(x.intent)).sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1))[0];
      const o = state.scan?.opportunities.find((x) => x.id === r.opportunityId);
      let record = "";
      let paid = false;
      if (r.record.kind === "quote") {
        const q = quoteById(ds, r.record.id);
        record = `Quote${q?.number ? ` #${q.number}` : ""}${q?.status ? ` (${q.status})` : ""}`;
        const job = ds.jobs.find((j) => j.quoteId === r.record.id);
        const inv = job ? ds.invoices.find((i) => i.jobId === job.id) : undefined;
        paid = inv?.status === "paid";
      } else if (r.record.kind === "job") {
        const j = ds.jobs.find((x) => x.id === r.record.id);
        const inv = j ? ds.invoices.find((i) => i.jobId === j.id) : undefined;
        record = j ? `Job${j.number ? ` #${j.number}` : ""}${inv?.number ? ` · Invoice #${inv.number}` : ""}` : "Booked (you told us)";
        paid = inv?.status === "paid";
      } else if (r.record.kind === "invoice") {
        const inv = ds.invoices.find((x) => x.id === r.record.id);
        record = `Invoice${inv?.number ? ` #${inv.number}` : ""}`;
        paid = inv?.status === "paid";
      }
      const counts = !r.disputed && r.tier !== "after_note";
      return {
        id: r.id,
        customer: c?.name ?? "",
        street: c?.address?.street ?? "",
        job: o?.jobPhrase?.replace(/^the /, "") ?? "",
        noteSentOn: (last?.sentAt ?? last?.dueAt)?.slice(0, 10),
        noteSubject: last?.subject,
        theyWrote: reply ? reply.text.replace(/\s+/g, " ").slice(0, 240) : undefined,
        record,
        cameBackOn: r.cameBackOn,
        daysAfterNote: r.lagDays,
        value: r.value,
        paid,
        match: MATCH_WORDS[r.match],
        counts,
        status: r.disputed ? `Not ours — ${r.disputed.reason}` : r.tier === "after_note" ? "Came back after our note (no reply — not counted)" : "Counted",
      };
    });
}

export function ledgerCSV(state: AccountState): string {
  const rows = ledgerRows(state);
  const header = ["Customer", "Street", "Job", "Our last note", "Subject", "They wrote", "Your record", "Came back", "Days after note", "Amount", "Paid", "How we matched it", "Status"];
  const body = rows.map((r) => [r.customer, r.street, r.job, r.noteSentOn ?? "", r.noteSubject ?? "", r.theyWrote ?? "", r.record, r.cameBackOn, r.daysAfterNote ?? "", r.value.toFixed(2), r.paid ? "yes" : "not yet", r.match, r.status].map(String));
  const rules = COUNTING_RULES.map((x) => [`# ${x}`]);
  return toCSV(header, [...body, [], ...rules]);
}
