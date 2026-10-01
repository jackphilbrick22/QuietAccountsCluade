import { useMemo } from "react";
import { fmtMoney } from "@qa/engine";
import { useApp } from "../../store/app";
import { clientRows, mrr } from "../../lib/ops";
import { Pill } from "../../components/ui";
import { Box, Btn, CopyBlock, EmptyRow, Kpi, Kpis, PageHead, shortDate, Table, Td, Th, Tr } from "../../components/table";

export function OpsBilling() {
  const order = useApp((s) => s.order);
  const accounts = useApp((s) => s.accounts);
  const metas = useApp((s) => s.meta);
  const rev = useApp((s) => s.rev);
  const markPaid = useApp((s) => s.markPaid);
  const toast = useApp((s) => s.toast);
  const rows = useMemo(() => clientRows(order, accounts, metas, rev), [order, accounts, metas, rev]);
  const paying = rows.filter((r) => r.a.dataset.business.plan.stage === "paying");
  const freeNow = paying.filter((r) => r.guarantee?.free);
  const due = paying.filter((r) => r.chargeIn !== undefined && r.chargeIn <= 2 && r.chargeIn >= -3 && r.guarantee);
  const freeTotal = rows.reduce((n, r) => n + r.a.dataset.business.plan.freeMonths.length, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHead title="Billing" sub="Plans, next charges and the guarantee: any month nobody asks to come back is free." />

      <Kpis>
        <Kpi label="MRR" value={fmtMoney(mrr(rows))} tone="ok" sub={`${paying.length} paying`} />
        <Kpi label="In free round" value={rows.filter((r) => r.a.dataset.business.plan.stage === "trial").length} />
        <Kpi label="Free this month so far" value={freeNow.length} tone={freeNow.length ? "warn" : undefined} sub="nobody has asked yet" />
        <Kpi label="Charging soon" value={due.length} sub="within 2 days" />
        <Kpi label="Free months given" value={freeTotal} sub="all time" />
      </Kpis>

      <Table minWidth={900} label="Billing">
        <thead>
          <tr>
            <Th>Client</Th>
            <Th>Plan</Th>
            <Th right>Price</Th>
            <Th>Paid since</Th>
            <Th>Next charge</Th>
            <Th>This month</Th>
            <Th right>Free months</Th>
            <Th>
              <span className="sr-only">Action</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = r.a.dataset.business.plan;
            const g = r.guarantee;
            return (
              <Tr key={r.id}>
                <Td className="max-w-[200px] truncate font-semibold">{r.a.dataset.business.name}</Td>
                <Td>
                  <Pill tone={r.stage.tone}>{r.stage.label}</Pill>
                </Td>
                <Td right>{fmtMoney(p.monthlyPrice)}</Td>
                <Td className="whitespace-nowrap">{shortDate(p.paidOn)}</Td>
                <Td className="whitespace-nowrap">
                  {g ? (
                    <>
                      {shortDate(g.chargeOn)}
                      {r.chargeIn !== undefined && <span className="ml-1.5 text-[12px] text-ink-3">{r.chargeIn > 0 ? `in ${r.chargeIn}d` : r.chargeIn === 0 ? "today" : `${-r.chargeIn}d ago`}</span>}
                    </>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>{g ? <Pill tone={g.free ? "warn" : "ok"}>{g.free ? "Free so far" : `Counts: ${g.asked.length} asked`}</Pill> : <span className="text-ink-3">—</span>}</Td>
                <Td right>{p.freeMonths.length}</Td>
                <Td className="whitespace-nowrap">
                  {p.stage !== "paying" && (
                    <Btn
                      onClick={() => {
                        markPaid(r.id);
                        toast(`${r.a.dataset.business.name} marked as paying`);
                      }}
                    >
                      Mark paid
                    </Btn>
                  )}
                </Td>
              </Tr>
            );
          })}
          {!rows.length && <EmptyRow cols={8}>No clients yet.</EmptyRow>}
        </tbody>
      </Table>

      {due.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="font-body text-[15px] font-bold tracking-normal">Texts to send before a charge</h2>
          {due.map((r) => (
            <Box key={r.id} className="flex flex-col gap-2 px-4 py-3">
              <span className="flex flex-wrap items-center gap-2 text-[13px]">
                <b>{r.a.dataset.business.name}</b>
                <Pill tone={r.guarantee!.free ? "warn" : "info"}>{r.guarantee!.free ? "Free month" : "Pre-charge"}</Pill>
                <span className="text-ink-3">charge date {shortDate(r.guarantee!.chargeOn)}</span>
              </span>
              <CopyBlock text={r.guarantee!.text} />
            </Box>
          ))}
        </section>
      )}
    </div>
  );
}
