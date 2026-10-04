import { useMemo, useState } from "react";
import { CalendarCheck, MessageSquare } from "lucide-react";
import { fmtMoney, plural, wantedWords, type OwnerMessage } from "@qa/engine";
import { useAccount } from "../../store/app";
import { derive } from "../../lib/derive";
import { MATCH_LABEL } from "../../lib/labels";
import { Pill } from "../../components/ui";
import { Box, Btn, Chip, PageHead, pct, Section, shortDate, Table, Td, Th, Tr } from "../../components/table";
import { chipRow } from "../../live/look";
import { Guarantee } from "./Today";
import { EmptyNote, MiniStats, MoneyBand } from "./parts";

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
  reply: "Reply to your text",
  pass_end: "End of the pass",
  export_ask: "A fresh export",
  check_in: "Did it book?",
  charge_link: "A charge",
  charge_card: "A charge",
  charge_retry: "A charge that didn't go through",
  charge_cap: "The cap",
  charge_refund: "A refund",
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
      msgFilter === "all" ? true : msgFilter === "handoff" ? m.kind === "handoff" || m.kind === "sla_nudge" || m.kind === "check_in" : msgFilter === "weekly" ? m.kind === "weekly" || m.kind === "close" : msgFilter === "billing" ? m.kind === "precharge" || m.kind === "free_month" || m.kind.startsWith("charge_") : m.kind === "info",
    )
    .sort((x, y) => (x.at < y.at ? 1 : -1));
  const count = (f: MsgFilter) =>
    a.ownerMessages.filter((m) => (f === "handoff" ? m.kind === "handoff" || m.kind === "sla_nudge" || m.kind === "check_in" : f === "weekly" ? m.kind === "weekly" || m.kind === "close" : f === "billing" ? m.kind === "precharge" || m.kind === "free_month" || m.kind.startsWith("charge_") : f === "other" ? m.kind === "info" : true)).length;
  const lags = ledger.map((x) => x.r.lagDays).filter((n): n is number => typeof n === "number");
  const avgLag = lags.length ? Math.round(lags.reduce((n, x) => n + x, 0) / lags.length) : undefined;
  const confTone = l.confidence === "solid" ? "ok" : l.confidence === "fair" ? "info" : "neutral";

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Recovered" sub="Every job that came back after a note, how we matched it, and how much of it the notes actually caused." />

      <div className="flex flex-col gap-3">
        <MoneyBand
          items={[
            { label: "Recovered revenue", value: fmtMoney(d.recovered), sub: plural(a.recoveries.length, "job") },
            { label: "Caused by the notes", value: fmtMoney(l.incremental), sub: "after subtracting who'd come back anyway" },
          ]}
        />
        <MiniStats
          items={[
            { label: "Booked by you", value: a.recoveries.filter((r) => r.match === "owner_reported").length.toLocaleString("en-US"), sub: "logged from calls" },
            { label: "Found in your records", value: a.recoveries.filter((r) => r.match !== "owner_reported").length.toLocaleString("en-US"), sub: "matched from exports" },
            { label: "Avg. days to come back", value: avgLag !== undefined ? avgLag.toLocaleString("en-US") : "—", sub: avgLag !== undefined ? "after the last note" : "shows once exports come back" },
          ]}
        />
      </div>

      <Section title="Ledger" sub="Newest first.">
        {ledger.length ? (
          <Table minWidth={560} tall label="Recovered revenue">
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
                  <Td className="max-w-[260px] truncate max-sm:max-w-[110px]">{job}</Td>
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
            </tbody>
            {ledger.length > 0 && (
              <tfoot>
                <tr className="bg-accent-wash font-semibold">
                  <td className="sticky bottom-0 border-t border-accent-line bg-accent-wash py-3 pr-3 pl-4" colSpan={2}>
                    Total · {plural(ledger.length, "job")}
                  </td>
                  <td className="num sticky bottom-0 border-t border-accent-line bg-accent-wash px-3 py-3 text-right text-ok">{fmtMoney(d.recovered)}</td>
                  <td colSpan={3} className="sticky bottom-0 border-t border-accent-line bg-accent-wash" />
                </tr>
              </tfoot>
            )}
          </Table>
        ) : (
          <Box>
            <EmptyNote icon={<CalendarCheck size={20} />}>Nothing has come back yet. When someone books, it lands here with the dollar amount.</EmptyNote>
          </Box>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-6">
        <Section title="Lift: did the notes cause it?" sub={`We leave ${Math.round(b.persistence.holdoutPct * 100)}% of the list alone on purpose and compare.`}>
          <div className="flex flex-col gap-3">
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
            <MiniStats
              items={[
                { label: "Would have come back anyway", value: fmtMoney(l.baseline) },
                { label: "Caused by the notes", value: fmtMoney(l.incremental), tone: "ok" },
              ]}
            />
            <p className="flex flex-wrap items-center gap-2 px-1 text-[13.5px] text-ink-2">
              <Pill tone={confTone}>Confidence: {l.confidence}</Pill>
              {l.note}
            </p>
          </div>
        </Section>

        <Section title="Guarantee history">
          <Guarantee />
          <Box className="overflow-hidden">
            <ul className="divide-y divide-line text-[13.5px]">
              <li className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-ink-3">Plan</span>
                <span className="font-semibold">{b.plan.stage === "trial" ? `Free round (${b.plan.trialSize})` : b.plan.stage === "paying" ? `${fmtMoney(b.plan.monthlyPrice)}/month` : b.plan.stage}</span>
              </li>
              {b.plan.trialStartedOn && (
                <li className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-ink-3">Free round started</span>
                  <span className="font-semibold">{shortDate(b.plan.trialStartedOn)}</span>
                </li>
              )}
              {b.plan.paidOn && (
                <li className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-ink-3">First paid month</span>
                  <span className="font-semibold">{shortDate(b.plan.paidOn)}</span>
                </li>
              )}
              {b.plan.freeMonths.map((m) => (
                <li key={m} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-ink-3">Month ending {shortDate(m)}</span>
                  <Pill tone="warn">Free: nobody asked</Pill>
                </li>
              ))}
              {b.plan.paidOn && !b.plan.freeMonths.length && <li className="px-4 py-2.5 text-ink-3">No free months so far. Every month, someone has {wantedWords(b.plan).past}.</li>}
            </ul>
          </Box>
        </Section>
      </div>

      <Section title="Messages to you" sub="The texts we sent you: hand-offs, reminders, weekly reports and billing notes. Newest first.">
        <div className={chipRow} role="toolbar" aria-label="Filter messages">
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
        <div className="flex flex-col gap-4 pt-1">
          {msgs.slice(0, msgLimit).map((m) => (
            <div key={m.id} className="flex max-w-[720px] flex-col items-start gap-1.5">
              <span className="flex flex-wrap items-center gap-2 pl-1 text-[12px] font-medium text-ink-3">
                <Pill tone={m.kind === "handoff" ? "accent" : m.kind === "sla_nudge" ? "warn" : m.kind === "free_month" ? "ok" : "neutral"}>{MSG_KIND[m.kind]}</Pill>
                {new Date(m.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
              <p className="note-body max-w-full rounded-[20px_20px_20px_6px] border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink shadow-soft [overflow-wrap:anywhere]">{m.text}</p>
            </div>
          ))}
          {!msgs.length && (
            <Box>
              <EmptyNote icon={<MessageSquare size={20} />}>No messages yet.</EmptyNote>
            </Box>
          )}
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
