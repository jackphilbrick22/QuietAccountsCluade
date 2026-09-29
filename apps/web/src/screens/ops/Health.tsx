import { useMemo } from "react";
import { useApp } from "../../store/app";
import { clientRows } from "../../lib/ops";
import { Pill } from "../../components/ui";
import { Box, EmptyRow, PageHead, pct, Table, Td, Th, Tr } from "../../components/table";

/** Guard's automatic pause thresholds (mirrors sendHealth in the engine). */
const BOUNCE_PAUSE = 0.04;
const BOUNCE_WARN = 0.02;
const COMPLAINT_PAUSE = 0.003;
const COMPLAINT_WARN = 0.001;

function tone(rate: number, warn: number, bad: number): "ok" | "warn" | "bad" {
  return rate > bad ? "bad" : rate > warn ? "warn" : "ok";
}

export function OpsHealth() {
  const order = useApp((s) => s.order);
  const accounts = useApp((s) => s.accounts);
  const metas = useApp((s) => s.meta);
  const rev = useApp((s) => s.rev);
  const select = useApp((s) => s.select);
  const rows = useMemo(() => clientRows(order, accounts, metas, rev), [order, accounts, metas, rev]);

  return (
    <div className="flex flex-col gap-5">
      <PageHead title="Sending health" sub="Bounces and spam complaints per client. The Guard pauses a client automatically when either crosses its limit." />

      <Box className="flex flex-wrap gap-x-6 gap-y-2 px-4 py-3 text-[13px] text-ink-2">
        <span>
          <b className="text-ink">Bounce rate:</b> <Pill tone="ok">under 2%</Pill> <Pill tone="warn">2–4%</Pill> <Pill tone="bad">over 4%: pause</Pill> <span className="text-ink-3">(after 50 sends)</span>
        </span>
        <span>
          <b className="text-ink">Complaint rate:</b> <Pill tone="ok">under 0.1%</Pill> <Pill tone="warn">0.1–0.3%</Pill> <Pill tone="bad">over 0.3%: pause</Pill> <span className="text-ink-3">(after 100 sends)</span>
        </span>
      </Box>

      <Table minWidth={900} label="Sending health">
        <thead>
          <tr>
            <Th>Client</Th>
            <Th right>Sent</Th>
            <Th right>Bounces</Th>
            <Th right>Bounce rate</Th>
            <Th right>Complaints</Th>
            <Th right>Complaint rate</Th>
            <Th right>Stops</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const h = r.health;
            return (
              <Tr key={r.id} onClick={() => select(r.id, "owner")} label={`Open ${r.a.dataset.business.name}`}>
                <Td className="max-w-[240px] truncate font-semibold">{r.a.dataset.business.name}</Td>
                <Td right>{h.sent.toLocaleString("en-US")}</Td>
                <Td right>{h.bounces.toLocaleString("en-US")}</Td>
                <Td right>{h.sent ? <Pill tone={tone(h.bounceRate, BOUNCE_WARN, BOUNCE_PAUSE)}>{pct(h.bounceRate)}</Pill> : "—"}</Td>
                <Td right>{h.complaints.toLocaleString("en-US")}</Td>
                <Td right>{h.sent ? <Pill tone={tone(h.complaintRate, COMPLAINT_WARN, COMPLAINT_PAUSE)}>{pct(h.complaintRate, 2)}</Pill> : "—"}</Td>
                <Td right>{h.stops.toLocaleString("en-US")}</Td>
                <Td className="max-w-[320px]">
                  {h.paused ? (
                    <span className="flex flex-col gap-0.5">
                      <Pill tone="bad">Auto-paused</Pill>
                      <span className="text-[12px] text-ink-3">{h.reason}</span>
                    </span>
                  ) : r.meta?.paused ? (
                    <Pill tone="warn">Paused by hand</Pill>
                  ) : h.sent ? (
                    <Pill tone="ok">Healthy</Pill>
                  ) : (
                    <Pill>Not sending yet</Pill>
                  )}
                </Td>
              </Tr>
            );
          })}
          {!rows.length && <EmptyRow cols={8}>No clients yet.</EmptyRow>}
        </tbody>
      </Table>
    </div>
  );
}
