import { useMemo } from "react";
import { brakesLine, SEND_BRAKES } from "@qa/engine";
import { useApp } from "../../store/app";
import { clientRows } from "../../lib/ops";
import { Pill } from "../../components/ui";
import { Box, EmptyRow, PageHead, pct, Table, Td, Th, Tr } from "../../components/table";

/** Guard's automatic pause thresholds (the engine's own), and where a rate is worth a look before them. */
const BOUNCE_PAUSE = SEND_BRAKES.bounces.rate;
const BOUNCE_WARN = 0.02;
const COMPLAINT_PAUSE = SEND_BRAKES.complaints.rate;
const COMPLAINT_WARN = 0;

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
      <PageHead title="Sending health" sub="Bounces and spam complaints per client. The Guard pauses a client automatically when one crosses its limit." />

      <Box className="px-4 py-3 text-[13px] text-ink-2">{brakesLine()}</Box>

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
