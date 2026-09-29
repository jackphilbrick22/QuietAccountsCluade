import { useMemo, useState, type ReactNode } from "react";
import { closeMessage, fmtMoney, plural, slaNudge, type ReplyIntent } from "@qa/engine";
import { useApp } from "../../store/app";
import { relTime } from "../../lib/derive";
import { clientRows, REVIEW_ORDER, reviewItems, waitedHours, type ClientRow, type ReviewKind } from "../../lib/ops";
import { Pill } from "../../components/ui";
import { intentPill } from "../../components/lead";
import { Box, Btn, Chip, CopyBlock, PageHead } from "../../components/table";

type Kind = ReviewKind;

const KIND: Record<Kind, { label: string; tone: "bad" | "warn" | "info" | "accent" | "neutral" }> = {
  unclear: { label: "Unclear reply", tone: "warn" },
  late: { label: "Hot lead waiting", tone: "bad" },
  complaint: { label: "Complaint", tone: "bad" },
  flagged: { label: "Flagged notes", tone: "warn" },
  paused: { label: "Paused", tone: "warn" },
  close: { label: "Close message due", tone: "accent" },
  billing: { label: "Billing text", tone: "info" },
};

interface Item {
  key: string;
  kind: Kind;
  row: ClientRow;
  at?: string;
  title: ReactNode;
  body?: ReactNode;
  action: ReactNode;
}

const SORT_CHOICES: { intent: ReplyIntent; label: string }[] = [
  { intent: "wants_it", label: "Wants it" },
  { intent: "wants_price", label: "Wants a price" },
  { intent: "question", label: "Question" },
  { intent: "later", label: "Later" },
  { intent: "not_interested", label: "No thanks" },
  { intent: "stop", label: "Stop" },
];

export function OpsReview() {
  const order = useApp((s) => s.order);
  const accounts = useApp((s) => s.accounts);
  const metas = useApp((s) => s.meta);
  const rev = useApp((s) => s.rev);
  const go = useApp((s) => s.go);
  const select = useApp((s) => s.select);
  const setPaused = useApp((s) => s.setPaused);
  const sortReply = useApp((s) => s.sortReply);
  const markPaid = useApp((s) => s.markPaid);
  const toast = useApp((s) => s.toast);
  const [filter, setFilter] = useState<Kind | "all">("all");

  const rows = useMemo(() => clientRows(order, accounts, metas, rev), [order, accounts, metas, rev]);
  const open = (id: string, tab: string, detail?: string) => {
    select(id, "owner");
    go({ tab, detail });
  };

  const items: Item[] = reviewItems(rows).map((it) => {
    const { row } = it;
    const { a, d, id } = row;
    const b = a.dataset.business;
    const r = it.reply;
    const who = r ? (r.customerId ? d.customers.get(r.customerId)?.name : undefined) ?? r.from : "";
    const base = { key: it.key, kind: it.kind, row, at: it.at };
    switch (it.kind) {
      case "unclear":
        return {
          ...base,
          title: (
            <>
              Couldn't tell what <b>{who}</b> meant
            </>
          ),
          body: <blockquote className="rounded-md bg-bg px-3 py-2 text-[13px]">“{r!.text.length > 280 ? `${r!.text.slice(0, 279)}…` : r!.text}”</blockquote>,
          action: (
            <div className="flex flex-wrap gap-1.5">
              {SORT_CHOICES.map((c) => (
                <Btn
                  key={c.intent}
                  variant={c.intent === "stop" ? "danger" : "secondary"}
                  onClick={() => {
                    sortReply(id, r!.id, c.intent);
                    toast(`${who}: sorted as “${c.label}”`);
                  }}
                >
                  {c.label}
                </Btn>
              ))}
            </div>
          ),
        };
      case "late": {
        const hrs = waitedHours(a, r!);
        return {
          ...base,
          title: (
            <>
              <b>{who}</b> has waited {Math.round(hrs)}h for a call {intentPill(r!)}
            </>
          ),
          body: <CopyBlock text={slaNudge(a, r!, hrs)} label="Copy reminder text" />,
          action: <Btn onClick={() => open(id, "leads", r!.id)}>Open in Unibox</Btn>,
        };
      }
      case "complaint":
        return {
          ...base,
          title: (
            <>
              <b>{who}</b> was unhappy about a note
            </>
          ),
          body: (
            <>
              <blockquote className="rounded-md bg-bg px-3 py-2 text-[13px]">“{r!.text}”</blockquote>
              <span className="text-[12.5px] text-ink-3">Already removed from every list. Check the note that caused it and tell the owner.</span>
            </>
          ),
          action: <Btn onClick={() => open(id, "leads", r!.id)}>See the thread</Btn>,
        };
      case "flagged":
        return {
          ...base,
          title: <>{plural(it.flaggedCount ?? 0, "queued note")} failed a quality check</>,
          body: (
            <ul className="list-disc pl-5 text-[12.5px] text-ink-2">
              {(it.flags ?? []).slice(0, 5).map(([f, n]) => (
                <li key={f}>
                  {f} <span className="num text-ink-3">×{n}</span>
                </li>
              ))}
            </ul>
          ),
          action: <Btn onClick={() => open(id, "notes")}>Read the notes</Btn>,
        };
      case "paused":
        return {
          ...base,
          title: <>Sending is paused</>,
          body: <span className="text-[13px] text-ink-2">{row.health.paused ? row.health.reason : row.meta?.paused ? "Paused by hand. Queued notes are on hold." : "Plan is paused."}</span>,
          action: row.meta?.paused ? (
            <Btn
              onClick={() => {
                setPaused(id, false);
                toast(`Resumed ${b.name}`);
              }}
            >
              Resume sending
            </Btn>
          ) : (
            <Btn onClick={() => go({ tab: "health" })}>See sending health</Btn>
          ),
        };
      case "close":
        return {
          ...base,
          title: <>Free round is done: send the close to {b.ownerFirstName || "the owner"}</>,
          body: <CopyBlock text={closeMessage(a)} label="Copy close text" />,
          action: (
            <Btn
              variant="primary"
              onClick={() => {
                markPaid(id);
                toast(`${b.name} marked as paying`);
              }}
            >
              They said yes: mark paid
            </Btn>
          ),
        };
      case "billing": {
        const g = row.guarantee!;
        return {
          ...base,
          title: g.free ? (
            <>This month is free under the guarantee (charge date {g.chargeOn})</>
          ) : (
            <>
              Charge of {fmtMoney(b.plan.monthlyPrice)} on {g.chargeOn}: send the pre-charge text
            </>
          ),
          body: <CopyBlock text={g.text} label={g.free ? "Copy free-month text" : "Copy pre-charge text"} />,
          action: <Btn onClick={() => go({ tab: "billing" })}>Open billing</Btn>,
        };
      }
    }
  });

  const counts = new Map<Kind, number>();
  for (const it of items) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);

  return (
    <div className="flex flex-col gap-5">
      <PageHead title="Needs a person" sub="Everything across all clients the agents couldn't finish on their own. Complaints cover the last 30 days; oldest first within each kind." />

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="toolbar" aria-label="Filter">
        <Chip active={filter === "all"} count={items.length} onClick={() => setFilter("all")}>
          All
        </Chip>
        {REVIEW_ORDER.map((k) => (
          <Chip key={k} active={filter === k} count={counts.get(k) ?? 0} tone={KIND[k].tone === "bad" ? "bad" : undefined} onClick={() => setFilter(k)}>
            {KIND[k].label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((it) => (
          <Box key={it.key} className="flex flex-col gap-2.5 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
              <Pill tone={KIND[it.kind].tone}>{KIND[it.kind].label}</Pill>
              <button type="button" onClick={() => select(it.row.id, "owner")} className="cursor-pointer font-semibold text-ink-2 hover:text-ink hover:underline">
                {it.row.a.dataset.business.name}
              </button>
              {it.at && <span>· {relTime(it.at, it.row.a.dataset.asOf)}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[14px]">{it.title}</div>
            {it.body}
            <div>{it.action}</div>
          </Box>
        ))}
        {!shown.length && <Box className="px-4 py-10 text-center text-[13.5px] text-ink-3">Nothing needs a person right now.</Box>}
      </div>
    </div>
  );
}
