import { useMemo, useState } from "react";
import { fmtMoney, plural, type OwnerMessage } from "@qa/engine";
import { useAccount } from "../../store/app";
import { derive } from "../../lib/derive";
import { MATCH_LABEL } from "../../lib/labels";
import { Pill } from "../../components/ui";
import { Box, Btn, Chip, EmptyRow, Kpi, Kpis, PageHead, pct, Section, shortDate, Table, Td, Th, Tr } from "../../components/table";
import { Guarantee } from "./Today";

const MSG_KIND: Record<OwnerMessage["kind"], string> = {
  handoff: "Hand-off text",
  sla_nudge: "Reminder",
  weekly: "Weekly report",
  close: "Free round results",
  precharge: "Before a charge",
  free_month: "Free month",
  kickoff: "Welcome text",
  renewal: "Year renewal",
  info: "Heads up",
  refund: "Yearly refund",
};

type MsgFilter = "all" | "handoff" | "weekly" | "billing" | "other";

export function Results() {
  const { a, rev } = useAccount();
  const [msgFilter, setMsgFilter] = useState<MsgFilter>("all");
  const [msgLimit, setMsgLimit] = useState(20);
  const d = a ? derive(a, rev) : undefined;

  const ledger = useMemo(() => {
    if (!a || !d) return [];
    const jobs = new Map(a.dataset.jobs.map((j) => [j.id, j.title]));
    const quotes = new Map(a.dataset.quotes.map((q) => [q.id, q.title]));
    const invoices = new Map(a.dataset.invoices.map((i) => [i.id, i.subject]));
    return [...a.recoveries]
      .sort((x, y) => (x.cameBackOn < y.cameBackOn ? 1 : -1))
      .map((r) => {
        const o = r.opportunityId ? d.opps.get(r.opportunityId) : undefined;
        const title = r.record.kind === "job" ? jobs.get(r.record.id) : r.record.kind === "quote" ? quotes.get(r.record.id) : r.record.kind === "invoice" ? invoices.get(r.record.id) : undefined;
        return { r, name: d.customers.get(r.customerId)?.name ?? "—", job: o?.jobPhrase.replace(/^the /, "") ?? title ?? "—" };
      });
  }, [a, d]);

  if (!a || !d) return null;
  const b = a.dataset.business;
  const l = d.lift;
  const msgs = [...a.ownerMessages]
    .filter((m) =>
      msgFilter === "all" ? true : msgFilter === "handoff" ? m.kind === "handoff" || m.kind === "sla_nudge" : msgFilter === "weekly" ? m.kind === "weekly" || m.kind === "close" : msgFilter === "billing" ? m.kind === "precharge" || m.kind === "free_month" : m.kind === "info",
    )
    .sort((x, y) => (x.at < y.at ? 1 : -1));
  const count = (f: MsgFilter) =>
    a.ownerMessages.filter((m) => (f === "handoff" ? m.kind === "handoff" || m.kind === "sla_nudge" : f === "weekly" ? m.kind === "weekly" || m.kind === "close" : f === "billing" ? m.kind === "precharge" || m.kind === "free_month" : f === "other" ? m.kind === "info" : true)).length;
  const lags = ledger.map((x) => x.r.lagDays).filter((n): n is number => typeof n === "number");
  const avgLag = lags.length ? Math.round(lags.reduce((n, x) => n + x, 0) / lags.length) : undefined;
  const confTone = l.confidence === "solid" ? "ok" : l.confidence === "fair" ? "info" : "neutral";

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Recovered" sub="Every job that came back after a note, how we matched it, and how much of it the notes actually caused." />

      <Kpis>
        <Kpi label="Recovered revenue" value={fmtMoney(d.recovered)} tone="ok" sub={plural(a.recoveries.length, "job")} />
        <Kpi label="Caused by the notes" value={fmtMoney(l.incremental)} tone="ok" sub="after subtracting who'd come back anyway" />
        <Kpi label="Booked by you" value={a.recoveries.filter((r) => r.match === "owner_reported").length.toLocaleString("en-US")} sub="logged from calls" />
        <Kpi label="Found in your records" value={a.recoveries.filter((r) => r.match !== "owner_reported").length.toLocaleString("en-US")} sub="matched from exports" />
        <Kpi label="Avg. days to come back" value={avgLag !== undefined ? avgLag.toLocaleString("en-US") : "—"} sub={avgLag !== undefined ? "after the last note" : "shows once exports come back"} />
      </Kpis>

      <Section title="Ledger" sub="Newest first.">
        <Table minWidth={760} tall label="Recovered revenue">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Job</Th>
              <Th right>Value</Th>
              <Th>Came back on</Th>
              <Th>How we matched it</Th>
              <Th right>Days after note</Th>
            </tr>
          </thead>
          <tbody>
            {ledger.map(({ r, name, job }) => (
              <Tr key={r.id}>
                <Td className="font-semibold whitespace-nowrap">{name}</Td>
                <Td className="max-w-[260px] truncate">{job}</Td>
                <Td right className="font-semibold text-ok">
                  {fmtMoney(r.value)}
                </Td>
                <Td className="whitespace-nowrap">{shortDate(r.cameBackOn)}</Td>
                <Td className="whitespace-nowrap">
                  <Pill tone={r.match === "owner_reported" ? "neutral" : r.match === "same_record" ? "ok" : "info"}>{MATCH_LABEL[r.match]}</Pill>
                </Td>
                <Td right>{r.lagDays ?? "—"}</Td>
              </Tr>
            ))}
            {!ledger.length && <EmptyRow cols={6}>Nothing has come back yet. When someone books, it lands here with the dollar amount.</EmptyRow>}
          </tbody>
          {ledger.length > 0 && (
            <tfoot>
              <tr className="bg-surface-2 font-bold">
                <td className="px-3 py-2" colSpan={2}>
                  Total · {plural(ledger.length, "job")}
                </td>
                <td className="num px-3 py-2 text-right text-ok">{fmtMoney(d.recovered)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </Table>
      </Section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section title="Lift: did the notes cause it?" sub={`We leave ${Math.round(b.persistence.holdoutPct * 100)}% of the list alone on purpose and compare.`}>
          <Box className="flex flex-col gap-3 p-4">
            <Table minWidth={420} label="Contacted versus held back">
              <thead>
                <tr>
                  <Th>Group</Th>
                  <Th right>People</Th>
                  <Th right>Came back</Th>
                  <Th right>Rate</Th>
                  <Th right>Value</Th>
                </tr>
              </thead>
              <tbody>
                <Tr>
                  <Td className="font-semibold">Got notes</Td>
                  <Td right>{l.treated.people.toLocaleString("en-US")}</Td>
                  <Td right>{l.treated.cameBack.toLocaleString("en-US")}</Td>
                  <Td right>{pct(l.treated.rate)}</Td>
                  <Td right>{fmtMoney(l.treated.value)}</Td>
                </Tr>
                <Tr>
                  <Td className="font-semibold">Held back</Td>
                  <Td right>{l.holdout.people.toLocaleString("en-US")}</Td>
                  <Td right>{l.holdout.cameBack.toLocaleString("en-US")}</Td>
                  <Td right>{pct(l.holdout.rate)}</Td>
                  <Td right>{fmtMoney(l.holdout.value)}</Td>
                </Tr>
              </tbody>
            </Table>
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <dt className="text-ink-3">Would have come back anyway</dt>
                <dd className="num text-[16px] font-bold">{fmtMoney(l.baseline)}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Caused by the notes</dt>
                <dd className="num text-[16px] font-bold text-ok">{fmtMoney(l.incremental)}</dd>
              </div>
            </dl>
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
              <Pill tone={confTone}>Confidence: {l.confidence}</Pill>
              {l.note}
            </p>
          </Box>
        </Section>

        <Section title="Guarantee history">
          <Guarantee />
          <Box>
            <ul className="divide-y divide-line text-[13px]">
              <li className="flex justify-between gap-3 px-3.5 py-2">
                <span className="text-ink-3">Plan</span>
                <span className="font-semibold">{b.plan.stage === "trial" ? `Free round (${b.plan.trialSize})` : b.plan.stage === "paying" ? `${fmtMoney(b.plan.monthlyPrice)}/month` : b.plan.stage}</span>
              </li>
              {b.plan.trialStartedOn && (
                <li className="flex justify-between gap-3 px-3.5 py-2">
                  <span className="text-ink-3">Free round started</span>
                  <span className="font-semibold">{shortDate(b.plan.trialStartedOn)}</span>
                </li>
              )}
              {b.plan.paidOn && (
                <li className="flex justify-between gap-3 px-3.5 py-2">
                  <span className="text-ink-3">First paid month</span>
                  <span className="font-semibold">{shortDate(b.plan.paidOn)}</span>
                </li>
              )}
              {b.plan.freeMonths.map((m) => (
                <li key={m} className="flex justify-between gap-3 px-3.5 py-2">
                  <span className="text-ink-3">Month ending {shortDate(m)}</span>
                  <Pill tone="warn">Free: nobody asked</Pill>
                </li>
              ))}
              {b.plan.paidOn && !b.plan.freeMonths.length && <li className="px-3.5 py-2 text-ink-3">No free months so far. Every month has had someone ask for a price or a date.</li>}
            </ul>
          </Box>
        </Section>
      </div>

      <Section title="Messages to you" sub="The texts we sent you: hand-offs, reminders, weekly reports and billing notes. Newest first.">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="toolbar" aria-label="Filter messages">
          {(
            [
              ["all", "All"],
              ["handoff", "Hand-offs & reminders"],
              ["weekly", "Reports"],
              ["billing", "Billing"],
              ["other", "Heads up"],
            ] as [MsgFilter, string][]
          ).map(([f, label]) => (
            <Chip
              key={f}
              active={msgFilter === f}
              count={count(f)}
              onClick={() => {
                setMsgFilter(f);
                setMsgLimit(20);
              }}
            >
              {label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {msgs.slice(0, msgLimit).map((m) => (
            <Box key={m.id} className="flex flex-col gap-1.5 px-3.5 py-3">
              <span className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                <Pill tone={m.kind === "handoff" ? "accent" : m.kind === "sla_nudge" ? "warn" : m.kind === "free_month" ? "ok" : "neutral"}>{MSG_KIND[m.kind]}</Pill>
                {new Date(m.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
              <p className="note-body text-[13.5px] leading-relaxed">{m.text}</p>
            </Box>
          ))}
          {!msgs.length && <Box className="px-4 py-8 text-center text-[13.5px] text-ink-3">No messages yet.</Box>}
          {msgs.length > msgLimit && (
            <div>
              <Btn onClick={() => setMsgLimit((n) => n + 20)}>Show 20 more ({msgs.length - msgLimit} left)</Btn>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
