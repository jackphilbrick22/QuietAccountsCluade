import { useMemo, useState } from "react";
import { ArrowRight, Mail, Pause, Play } from "lucide-react";
import { addDays, BREAKAGE_LABEL, fmtMoney, fmtPhone, holidayOn, HOLIDAYS_LINE, planOutreach, plural, SEQUENCES, type BreakageType, type Touch } from "@qa/engine";
import { nextSendDay, useApp, useAccount } from "../../store/app";
import { derive, niceDate } from "../../lib/derive";
import { cx, Pill } from "../../components/ui";
import { Box, Btn, EmptyRow, PageHead, Section, Select, Table, Td, Th, Tr } from "../../components/table";
import { EmptyNote, ReadyCard } from "./parts";

export function Notes() {
  const { a, id, meta, rev } = useAccount();
  const launch = useApp((s) => s.launch);
  const approveAll = useApp((s) => s.approveAll);
  const setPaused = useApp((s) => s.setPaused);
  const toast = useApp((s) => s.toast);
  const [previewType, setPreviewType] = useState<BreakageType | "">("");
  const [showCalls, setShowCalls] = useState(false);

  const launched = !!a && a.touches.length > 0;
  // Before launch, show exactly what the free round would send (planned, not saved).
  const preview = useMemo(() => {
    if (!a?.scan || a.touches.length) return undefined;
    const b = a.dataset.business;
    return planOutreach(a.dataset, a.scan, { startOn: nextSendDay(a, a.dataset.asOf), limitPeople: b.plan.stage === "trial" ? b.plan.trialSize : undefined, applyHoldout: false });
  }, [a, rev]);

  const d = a ? derive(a, rev) : undefined;
  const touches: Touch[] = useMemo(() => (launched ? a!.touches : preview?.touches ?? []), [launched, a, preview, rev]);

  const groups = useMemo(() => {
    if (!d) return [];
    const m = new Map<BreakageType, Map<number, { total: number; sent: number; queued: number; stopped: number; first?: Touch }>>();
    for (const t of touches) {
      const type = d.opps.get(t.opportunityId)?.type;
      if (!type) continue;
      const steps = m.get(type) ?? m.set(type, new Map()).get(type)!;
      const g = steps.get(t.step) ?? { total: 0, sent: 0, queued: 0, stopped: 0 };
      g.total++;
      if (t.status === "sent" || t.status === "delivered") g.sent++;
      else if (t.status === "planned" || t.status === "approved") g.queued++;
      else g.stopped++;
      if (!g.first || (t.status !== "cancelled" && g.first.status === "cancelled")) g.first = t;
      steps.set(t.step, g);
    }
    return [...m.entries()]
      .map(([type, steps]) => ({ type, people: steps.get(1)?.total ?? 0, steps: [...steps.entries()].sort((x, y) => x[0] - y[0]) }))
      .sort((x, y) => y.people - x.people);
  }, [touches, d]);

  if (!a || !id || !d) return null;
  const b = a.dataset.business;
  const planned = a.touches.filter((t) => t.status === "planned").length;
  const approved = a.touches.filter((t) => t.status === "approved").length;
  const sent = a.touches.filter((t) => t.status === "sent" || t.status === "delivered").length;
  const flagged = touches.filter((t) => t.flags.length && (t.status === "planned" || t.status === "approved")).length;
  const pType = (previewType || groups[0]?.type) as BreakageType | undefined;
  const pGroup = groups.find((g) => g.type === pType);

  // next 14 days
  const days = Array.from({ length: 14 }, (_, i) => addDays(a.dataset.asOf, i));
  const byDay = new Map<string, { notes: number; people: number; sent: number }>();
  for (const t of touches) {
    const day = (t.sentAt ?? t.dueAt).slice(0, 10);
    if (day < days[0]! || day > days[13]!) continue;
    const x = byDay.get(day) ?? { notes: 0, people: 0, sent: 0 };
    if (t.status === "planned" || t.status === "approved") {
      x.notes++;
      if (t.step === 1) x.people++;
    } else if (t.status === "sent" || t.status === "delivered") x.sent++;
    byDay.set(day, x);
  }

  // phone call list: highest-value people with a number, not already replied or recovered
  const recoveredCust = new Set(a.recoveries.map((r) => r.customerId));
  const callList = (a.scan?.primary ?? [])
    .filter((o) => !o.suppressed && !recoveredCust.has(o.customerId) && !d.replyByCustomer.has(o.customerId) && (d.customers.get(o.customerId)?.phones.length ?? 0) > 0)
    .sort((x, y) => y.value - x.value)
    .slice(0, 10);

  return (
    <div className="flex flex-col gap-8">
      <PageHead
        title="Sequence & schedule"
        sub={`Short notes from ${b.signerName || "your office"} about each person's own job. ${b.weeklyNewContacts} new people a week, on ${b.sendDays.length} send days.`}
        actions={
          launched ? (
            <>
              {planned > 0 && !meta?.paused && (
                <Btn
                  variant="primary"
                  onClick={() => {
                    approveAll(id);
                    toast(`Approved ${plural(planned, "note")}`);
                  }}
                >
                  Approve all planned ({planned})
                </Btn>
              )}
              <Btn
                onClick={() => {
                  setPaused(id, !meta?.paused);
                  toast(meta?.paused ? "Sending resumed" : "Sending paused");
                }}
              >
                {meta?.paused ? (
                  <>
                    <Play size={15} /> Resume sending
                  </>
                ) : (
                  <>
                    <Pause size={15} /> Pause sending
                  </>
                )}
              </Btn>
            </>
          ) : undefined
        }
      />

      {!launched && (
        <ReadyCard className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-display text-[20px] leading-tight sm:text-[22px]">Nothing has gone out yet. This is what the free round would send.</span>
            <span className="text-[14px] text-ink-2">
              {preview ? `${plural(preview.people.length, "person", "people")}, ${plural(preview.touches.length, "note")}, ${preview.firstDay ? `${niceDate(preview.firstDay)} to ${niceDate(preview.lastDay!)}` : ""}.` : "Run a scan first to see the notes."}
              {preview?.skipped.length ? ` ${preview.skipped.length} skipped because a clean note couldn't be written.` : ""}
            </span>
          </div>
          <Btn variant="primary" className="px-5 sm:min-h-11" disabled={!preview?.touches.length} onClick={() => launch(id)}>
            Start the free round <ArrowRight size={15} />
          </Btn>
        </ReadyCard>
      )}

      {launched && (
        <div className="flex flex-wrap gap-2 text-[13px]">
          <Pill tone={meta?.paused ? "warn" : "ok"}>{meta?.paused ? "Paused" : "Sending on schedule"}</Pill>
          <Pill>{sent.toLocaleString("en-US")} sent</Pill>
          <Pill>{approved.toLocaleString("en-US")} scheduled</Pill>
          {planned > 0 && <Pill tone="warn">{planned.toLocaleString("en-US")} {meta?.paused ? "on hold while paused" : "waiting for approval"}</Pill>}
          {flagged > 0 && <Pill tone="warn">{plural(flagged, "note")} flagged for a second look</Pill>}
        </div>
      )}

      <Section title="Steps in use" sub="Each kind of opportunity gets its own short sequence. A reply of any kind stops the rest.">
        {groups.length ? (
          <Table minWidth={620} label="Sequence steps">
            <thead>
              <tr>
                <Th>Opportunity type</Th>
                <Th>Step</Th>
                <Th right>Day</Th>
                <Th right>Notes</Th>
                <Th right>Sent</Th>
                <Th right>Queued</Th>
                <Th right>Stopped</Th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap((g) =>
                g.steps.map(([step, x], i) => (
                  <Tr
                    key={`${g.type}-${step}`}
                    onClick={() => setPreviewType(g.type)}
                    selected={pType === g.type}
                    label={`${BREAKAGE_LABEL[g.type].title} step ${step}`}
                    className={cx(i > 0 && "[&>td:first-child]:pl-3! [&>td:first-child]:shadow-none!")}
                  >
                    {i === 0 && (
                      <Td rowSpan={g.steps.length} className="align-top font-semibold">
                        {BREAKAGE_LABEL[g.type].title}
                        <span className="block text-[12px] font-normal text-ink-3">{plural(g.people, "person", "people")}</span>
                      </Td>
                    )}
                    <Td>
                      <span className="whitespace-nowrap">Note {step}</span>
                      {x.first && <span className="block text-[12px] whitespace-nowrap text-ink-3 sm:ml-1.5 sm:inline">{x.first.angle.replace(/_/g, " ")}</span>}
                    </Td>
                    <Td right>{SEQUENCES[g.type].steps.find((s) => s.step === step)?.day ?? "—"}</Td>
                    <Td right>{x.total.toLocaleString("en-US")}</Td>
                    <Td right>{x.sent.toLocaleString("en-US")}</Td>
                    <Td right>{x.queued.toLocaleString("en-US")}</Td>
                    <Td right>{x.stopped.toLocaleString("en-US")}</Td>
                  </Tr>
                )),
              )}
            </tbody>
          </Table>
        ) : (
          <Box>
            <EmptyNote icon={<Mail size={20} />}>No notes written yet.</EmptyNote>
          </Box>
        )}
      </Section>

      {pGroup && (
        <Section
          title="Read the notes"
          sub="Real notes, rendered for a real person on the list. Every one is written about that person's own job."
          actions={
            <Select
              id="preview-type"
              label="Type"
              value={pType ?? ""}
              onChange={(v) => setPreviewType(v as BreakageType)}
              options={groups.map((g) => ({ value: g.type, label: BREAKAGE_LABEL[g.type].title }))}
            />
          }
        >
          <div className="grid gap-4 lg:grid-cols-3">
            {pGroup.steps.map(([step, x]) => {
              const t = x.first!;
              const c = d.customers.get(t.customerId);
              return (
                <Box key={step} className="flex min-w-0 flex-col overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-accent-wash px-4 py-2.5">
                    <span className="text-[12.5px] font-semibold text-ink-3">
                      Note {step} · to {c?.name ?? "—"} · {niceDate(t.dueAt)}
                    </span>
                    {t.flags.length > 0 && <Pill tone="warn">{plural(t.flags.length, "flag")}</Pill>}
                  </div>
                  <div className="flex flex-col gap-2.5 px-4 py-4">
                    <span className="text-[14.5px] font-semibold">{t.subject || "(no subject)"}</span>
                    <p className="note-body text-[14px] leading-relaxed text-ink-2">{t.body}</p>
                    {t.flags.length > 0 && (
                      <ul className="list-disc pl-5 text-[12px] text-warn">
                        {t.flags.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Box>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Next 14 days" sub={`Notes go out ${b.sendDays.map((x) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x]).join(", ")} between ${b.sendWindow[0]}:00 and ${b.sendWindow[1]}:00. ${HOLIDAYS_LINE}`}>
        <Table minWidth={460} label="Schedule">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th right>Notes due</Th>
              <Th right>New people</Th>
              <Th right>Already sent</Th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const x = byDay.get(day);
              const holiday = holidayOn(day);
              const sendDay = b.sendDays.includes(new Date(`${day}T12:00:00Z`).getUTCDay()) && !holiday;
              return (
                <Tr key={day}>
                  <Td className={cx(!sendDay && "text-ink-3")}>
                    <span className="whitespace-nowrap">
                      {niceDate(day)}
                      {day === a.dataset.asOf && (
                        <Pill tone="accent" className="ml-2 py-0">
                          today
                        </Pill>
                      )}
                    </span>
                    {!sendDay && <span className="block text-[12px] sm:ml-2 sm:inline">{holiday ? `${holiday}, no sends` : "no sends"}</span>}
                  </Td>
                  <Td right>{x?.notes || "—"}</Td>
                  <Td right>{x?.people || "—"}</Td>
                  <Td right>{x?.sent || "—"}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Section>

      <Section title="Channels">
        <Table minWidth={560} label="Channels">
          <thead>
            <tr>
              <Th>Channel</Th>
              <Th>Status</Th>
              <Th>What it does</Th>
            </tr>
          </thead>
          <tbody>
            <Tr>
              <Td className="font-semibold">Email</Td>
              <Td>
                <Pill tone={meta?.paused ? "warn" : "ok"}>{meta?.paused ? "Paused" : "Live"}</Pill>
              </Td>
              <Td className="text-ink-2">Plain-text notes from your office, replies come back to you. {sent.toLocaleString("en-US")} sent so far.</Td>
            </Tr>
            <Tr onClick={() => setShowCalls((v) => !v)} label="Call list">
              <Td className="font-semibold">Call list</Td>
              <Td>
                <Pill tone="info">Ready</Pill>
              </Td>
              <Td className="text-ink-2">
                The top {callList.length} people worth a phone call, by job value.{" "}
                <span className="font-semibold text-accent-ink underline underline-offset-2">{showCalls ? "Hide list" : "Show list"}</span>
              </Td>
            </Tr>
            <Tr>
              <Td className="font-semibold">Postcards</Td>
              <Td>
                <Pill>Coming soon</Pill>
              </Td>
              <Td className="text-ink-2">A card to people we have an address for but no email.</Td>
            </Tr>
            <Tr>
              <Td className="font-semibold">Text messages</Td>
              <Td>
                <Pill>Coming soon</Pill>
              </Td>
              <Td className="text-ink-2">Only to people with recorded consent to texts. We never assume it.</Td>
            </Tr>
            <Tr>
              <Td className="font-semibold">Retargeting audiences</Td>
              <Td>
                <Pill>Coming soon</Pill>
              </Td>
              <Td className="text-ink-2">Show your ads to past customers on Facebook and Google.</Td>
            </Tr>
          </tbody>
        </Table>
        {showCalls && (
          <Table minWidth={720} label="Call list">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Job</Th>
                <Th right>Value</Th>
                <Th>Why</Th>
              </tr>
            </thead>
            <tbody>
              {callList.map((o) => {
                const c = d.customers.get(o.customerId)!;
                return (
                  <Tr key={o.id}>
                    <Td className="font-semibold whitespace-nowrap">{c.name}</Td>
                    <Td className="whitespace-nowrap">
                      <a href={`tel:${c.phones[0]}`} className="num font-semibold text-accent-ink hover:underline">
                        {fmtPhone(c.phones[0])}
                      </a>
                    </Td>
                    <Td className="max-w-[200px] truncate">{o.jobPhrase.replace(/^the /, "")}</Td>
                    <Td right>{fmtMoney(o.value)}</Td>
                    <Td className="max-w-[320px]">
                      <span className="line-clamp-2 text-[12.5px] text-ink-2">{o.reason}</span>
                    </Td>
                  </Tr>
                );
              })}
              {!callList.length && <EmptyRow cols={5}>Nobody on the list has a phone number.</EmptyRow>}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  );
}
