import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { fmtMoney, TRADE_OPTIONS, type TradeId } from "@qa/engine";
import { useApp } from "../../store/app";
import { relTime } from "../../lib/derive";
import { clientRows, mrr } from "../../lib/ops";
import { SOURCE_LABEL } from "../../components/files";
import { Bar, cx, Pill } from "../../components/ui";
import { Btn, EmptyRow, Kpi, Kpis, PageHead, pct, RowMenu, SearchBox, Select, Table, Td, Th, Tr } from "../../components/table";

export function OpsOverview() {
  const order = useApp((s) => s.order);
  const accounts = useApp((s) => s.accounts);
  const metas = useApp((s) => s.meta);
  const rev = useApp((s) => s.rev);
  const go = useApp((s) => s.go);
  const select = useApp((s) => s.select);
  const createFromSample = useApp((s) => s.createFromSample);
  const simulate = useApp((s) => s.simulate);
  const setPaused = useApp((s) => s.setPaused);
  const markPaid = useApp((s) => s.markPaid);
  const removeAccount = useApp((s) => s.removeAccount);
  const launch = useApp((s) => s.launch);
  const toast = useApp((s) => s.toast);
  const [trade, setTrade] = useState<TradeId>("tree");
  const [q, setQ] = useState("");

  const rows = useMemo(() => clientRows(order, accounts, metas, rev), [order, accounts, metas, rev]);
  const shown = rows.filter((r) => !q.trim() || `${r.a.dataset.business.name} ${r.a.dataset.business.trade}`.toLowerCase().includes(q.trim().toLowerCase()));
  const paying = rows.filter((r) => r.a.dataset.business.plan.stage === "paying");
  const weekSent = rows.reduce((n, r) => n + r.d.week.sent, 0);
  const weekReplies = rows.reduce((n, r) => n + r.d.week.replied, 0);
  const booked = rows.reduce((n, r) => n + r.d.recovered, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHead
        title="Clients"
        sub="Every business we run follow-ups for. Click a row to open that client's view."
        actions={
          <>
            <Btn variant="primary" onClick={() => go({ area: "onboarding", tab: "trade" })}>
              <Plus size={15} /> New business
            </Btn>
            <div className="flex items-center gap-1.5">
              <Select id="ops-sample-trade" label="Sample trade" hideLabel value={trade} onChange={setTrade} options={TRADE_OPTIONS.map((t) => ({ value: t.id, label: t.label }))} />
              <Btn
                onClick={() =>
                  void createFromSample(trade, { launch: true }).then(() => toast(`Added a sample ${TRADE_OPTIONS.find((t) => t.id === trade)?.label.toLowerCase()} business`))
                }
              >
                Add sample business
              </Btn>
            </div>
          </>
        }
      />

      <Kpis>
        <Kpi label="MRR" value={fmtMoney(mrr(rows))} tone="ok" sub={`${paying.length} paying`} />
        <Kpi label="Clients" value={rows.length} sub={`${rows.filter((r) => r.a.dataset.business.plan.stage === "trial").length} in free round`} />
        <Kpi label="Notes sent this week" value={weekSent.toLocaleString("en-US")} />
        <Kpi label="Replies this week" value={weekReplies.toLocaleString("en-US")} />
        <Kpi label="Booked, all time" value={fmtMoney(booked, { compact: true })} tone="ok" />
      </Kpis>

      <SearchBox id="ops-search" className="w-full sm:w-72" value={q} onChange={setQ} placeholder="Search clients" />

      <Table minWidth={980} label="Clients">
        <thead>
          <tr>
            <Th>Business</Th>
            <Th>Stage</Th>
            <Th className="w-28">Progress</Th>
            <Th right>Sent</Th>
            <Th right>Replied</Th>
            <Th right>Interested</Th>
            <Th right>Booked</Th>
            <Th right wrap className="w-20">Waiting on owner</Th>
            <Th right>Bounce</Th>
            <Th wrap>Last activity</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const b = r.a.dataset.business;
            const trade = TRADE_OPTIONS.find((t) => t.id === b.trade)?.label ?? b.trade;
            const bounceTone = r.health.bounceRate > 0.04 ? "bad" : r.health.bounceRate > 0.02 ? "warn" : "ok";
            return (
              <Tr key={r.id} onClick={() => select(r.id, "owner")} label={`Open ${b.name}`}>
                <Td className="max-w-[210px]">
                  <span className="block truncate font-semibold">{b.name}</span>
                  <span className="block truncate text-[12px] text-ink-3">
                    {trade} · {SOURCE_LABEL[b.software]}
                    {r.meta?.sample ? " · sample" : ""}
                  </span>
                </Td>
                <Td className="whitespace-nowrap">
                  <Pill tone={r.stage.tone}>{r.stage.label}</Pill>
                </Td>
                <Td>
                  <div className="flex flex-col gap-1">
                    <Bar value={r.contacted} max={Math.max(1, r.reachable)} tone="ok" />
                    <span className="num text-[11.5px] whitespace-nowrap text-ink-3">
                      {r.contacted.toLocaleString("en-US")} / {r.reachable.toLocaleString("en-US")}
                    </span>
                  </div>
                </Td>
                <Td right>{r.d.sentCount.toLocaleString("en-US")}</Td>
                <Td right>{r.d.totals.replied.toLocaleString("en-US")}</Td>
                <Td right>{r.d.totals.wants.toLocaleString("en-US")}</Td>
                <Td right className="font-semibold">
                  {fmtMoney(r.d.recovered)}
                </Td>
                <Td right>
                  {r.d.hot.length ? (
                    <span className={cx("font-semibold", r.lateHot.length ? "text-bad" : "text-ink")} title={r.lateHot.length ? `${r.lateHot.length} waiting over 24 hours` : undefined}>
                      {r.d.hot.length}
                      {r.lateHot.length ? ` (${r.lateHot.length} >24h)` : ""}
                    </span>
                  ) : (
                    <span className="text-ink-3">0</span>
                  )}
                </Td>
                <Td right>
                  {r.health.sent ? <Pill tone={bounceTone}>{pct(r.health.bounceRate)}</Pill> : <span className="text-ink-3">—</span>}
                </Td>
                <Td className="whitespace-nowrap text-ink-2">{r.lastActivity ? relTime(r.lastActivity, r.a.dataset.asOf) : "—"}</Td>
                <Td className="w-10" onClick={(e) => e.stopPropagation()}>
                  <RowMenu
                    label={`Actions for ${b.name}`}
                    items={[
                      { label: "Open owner view", onClick: () => select(r.id, "owner") },
                      { label: "Start the free round", hidden: r.a.touches.length > 0 || !r.a.summary, onClick: () => (launch(r.id), toast(`Started ${b.name}`)) },
                      { label: "Simulate 7 days", hidden: !r.meta?.sample || !r.a.touches.length, onClick: () => void simulate(r.id, 7).then(() => toast(`Played ${b.name} forward a week`)) },
                      { label: r.meta?.paused ? "Resume sending" : "Pause sending", onClick: () => (setPaused(r.id, !r.meta?.paused), toast(r.meta?.paused ? `Resumed ${b.name}` : `Paused ${b.name}`)) },
                      { label: "Mark paid", hidden: b.plan.stage === "paying", onClick: () => (markPaid(r.id), toast(`${b.name} marked as paying`)) },
                      { label: "Remove", danger: true, confirm: `Remove ${b.name}? This can't be undone.`, onClick: () => void removeAccount(r.id).then(() => toast(`Removed ${b.name}`)) },
                    ]}
                  />
                </Td>
              </Tr>
            );
          })}
          {!shown.length && <EmptyRow cols={11}>{rows.length ? "No clients match." : "No clients yet. Add a new business or a sample one."}</EmptyRow>}
        </tbody>
      </Table>
    </div>
  );
}
