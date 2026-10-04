import { useMemo } from "react";
import { fmtMoney } from "@qa/engine";
import { useApp } from "../../store/app";
import { clientRows, mrr } from "../../lib/ops";
import { Wallet } from "lucide-react";
import { Pill } from "../../components/ui";
import { Box, Btn, CopyBlock, EmptyRow, PageHead, Section, shortDate, Table, Td, Th, Tr } from "../../components/table";
import { Blank, Tally } from "../../live/look";

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
    <div className="flex flex-col gap-6">
      <PageHead title="Billing" sub="Plans, next charges and the guarantee: any month nobody asks to come back is free." />

      <Tally
        items={[
          { label: "MRR", value: fmtMoney(mrr(rows)), tone: "ok", sub: `${paying.length} paying` },
          { label: "In free round", value: rows.filter((r) => r.a.dataset.business.plan.stage === "trial").length },
          { label: "Free this month so far", value: freeNow.length, tone: freeNow.length ? "warn" : undefined, sub: "nobody has asked yet" },
          { label: "Charging soon", value: due.length, sub: "within 2 days" },
          { label: "Free months given", value: freeTotal, sub: "all time" },
        ]}
      />

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
                <Td className="max-w-[240px] truncate font-semibold">{r.a.dataset.business.name}</Td>
                <Td>
                  <Pill tone={r.stage.tone}>{r.stage.label}</Pill>
                </Td>
                <Td right className="font-semibold">
                  {fmtMoney(p.monthlyPrice)}
                </Td>
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
          {!rows.length && (
            <EmptyRow cols={8}>
              <Blank icon={Wallet} className="py-0">
                No clients yet.
              </Blank>
            </EmptyRow>
          )}
        </tbody>
      </Table>

      {due.length > 0 && (
        <Section title="Texts to send before a charge">
          {due.map((r) => (
            <Box key={r.id} className="flex flex-col gap-3 px-4 py-4 sm:px-5">
              <span className="flex flex-wrap items-center gap-2 text-[13.5px]">
                <b className="text-[14.5px]">{r.a.dataset.business.name}</b>
                <Pill tone={r.guarantee!.free ? "warn" : "info"}>{r.guarantee!.free ? "Free month" : "Pre-charge"}</Pill>
                <span className="text-ink-3">charge date {shortDate(r.guarantee!.chargeOn)}</span>
              </span>
              <CopyBlock text={r.guarantee!.text} />
            </Box>
          ))}
        </Section>
      )}
    </div>
  );
}
