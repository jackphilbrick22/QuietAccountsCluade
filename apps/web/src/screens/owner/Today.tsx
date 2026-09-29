import { ArrowRight, Bot, ShieldCheck } from "lucide-react";
import { AGENTS, fmtMoney, plural, type AgentEvent } from "@qa/engine";
import { useApp, useAccount } from "../../store/app";
import { derive, relTime } from "../../lib/derive";
import { Bar, cx, Pill } from "../../components/ui";
import { intentPill } from "../../components/lead";
import { Box, Btn, Kpi, Kpis, PageHead, Section, hoursBetween } from "../../components/table";

export function Today() {
  const { a, id, meta, rev } = useAccount();
  const go = useApp((s) => s.go);
  const simulate = useApp((s) => s.simulate);
  const launch = useApp((s) => s.launch);
  if (!a || !id) return null;
  const d = derive(a, rev);
  const b = a.dataset.business;
  const s = a.summary;
  const dateText = new Date(`${a.dataset.asOf}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const launched = a.touches.length > 0;
  const paid = b.plan.stage === "paying";
  const monthsPaid = paid && b.plan.paidOn ? Math.max(1, Math.ceil((Date.parse(a.dataset.asOf) - Date.parse(b.plan.paidOn)) / (30.44 * 86400000))) - b.plan.freeMonths.length : 0;
  const spent = monthsPaid * b.plan.monthlyPrice;

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        title={`${greeting()}, ${b.ownerFirstName || "there"}`}
        sub={dateText}
        actions={
          <Pill tone={meta?.paused ? "warn" : launched ? "ok" : "neutral"}>
            <span className="size-1.5 rounded-full bg-current" />
            {meta?.paused ? "Paused" : launched ? "Sending" : "Not started"}
          </Pill>
        }
      />

      {!launched && s && (
        <Box className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-bold">Your first {b.plan.trialSize} notes are written and ready.</span>
            <span className="text-[13.5px] text-ink-2">We picked the people most likely to say yes and wrote each one a note about their own job. Read them first if you like.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => go({ tab: "notes" })}>Read the notes</Btn>
            <Btn variant="primary" onClick={() => launch(id)}>
              Start the free round <ArrowRight size={15} />
            </Btn>
          </div>
        </Box>
      )}

      <Kpis>
        <Kpi label="Recovered" value={fmtMoney(d.recovered)} tone="ok" sub={plural(a.recoveries.length, "job")} />
        <Kpi label="On the table" value={fmtMoney(d.onTable, { compact: true })} sub={`${d.totals.remaining.toLocaleString("en-US")} to reach`} />
        <Kpi label="Sent this week" value={d.week.sent.toLocaleString("en-US")} sub={`${d.lastWeek.sent} last week`} />
        <Kpi label="Replies" value={d.week.replied.toLocaleString("en-US")} sub={`this week · ${d.totals.replied} total`} />
        <Kpi label="Interested" value={d.week.wants.toLocaleString("en-US")} tone={d.week.wants ? "accent" : undefined} sub={`this week · ${d.totals.wants} total`} />
        <Kpi label="Booked this week" value={fmtMoney(d.week.bookedValue)} sub={plural(d.week.booked, "job")} />
      </Kpis>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Section
          title={d.hot.length ? `Waiting on you (${d.hot.length})` : "Waiting on you"}
          sub={d.hot.length ? "They asked for a price or a date. Call them back the same day." : "Nobody is waiting. We text you the moment someone wants the work."}
          actions={
            <Btn variant="ghost" onClick={() => go({ tab: "leads" })}>
              Open Unibox <ArrowRight size={15} />
            </Btn>
          }
        >
          <Box>
            <ul className="divide-y divide-line">
              {d.hot.slice(0, 8).map((r) => {
                const c = r.customerId ? d.customers.get(r.customerId) : undefined;
                const waited = hoursBetween(r.receivedAt, a.dataset.asOf);
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => go({ tab: "leads", detail: r.id })} className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left hover:bg-bg">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold">{c?.name ?? r.from}</span>
                          {intentPill(r)}
                        </span>
                        <span className="truncate text-[13px] text-ink-3">{r.text.split("\n")[0]}</span>
                      </span>
                      <span className={cx("num shrink-0 text-[12.5px]", waited > 24 ? "font-semibold text-bad" : "text-ink-3")}>{relTime(r.receivedAt, a.dataset.asOf)}</span>
                    </button>
                  </li>
                );
              })}
              {!d.hot.length && <li className="px-3.5 py-6 text-center text-[13.5px] text-ink-3">{launched ? `${plural(d.queued.length, "note")} queued. Every reply is read the minute it lands.` : "Start the free round and replies will show up here."}</li>}
            </ul>
          </Box>
        </Section>

        <div className="flex min-w-0 flex-col gap-6">
          <Guarantee />
          {paid && spent > 0 && (
            <Box className="p-4 text-[13.5px] text-ink-2">
              You've paid <b className="num text-ink">{fmtMoney(spent)}</b> so far. It has brought back <b className="num text-ok">{fmtMoney(d.recovered)}</b>
              {d.recovered > 0 ? ` (${(d.recovered / spent).toFixed(1)}× your money).` : "."}
            </Box>
          )}
          {meta?.sample && launched && (
            <Box className="flex flex-col gap-2 p-4">
              <span className="text-[14px] font-bold">Sample business: play it forward</span>
              <p className="text-[13px] text-ink-3">Watch notes go out, replies come in and jobs book, using rates from real first rounds. Everything it produces is marked simulated.</p>
              <div className="flex flex-wrap gap-2">
                <Btn onClick={() => void simulate(id, 1)}>+1 day</Btn>
                <Btn onClick={() => void simulate(id, 7)}>+1 week</Btn>
                <Btn onClick={() => void simulate(id, 30)}>+30 days</Btn>
              </div>
            </Box>
          )}
        </div>
      </div>

      <AgentFeed events={a.events} asOf={a.dataset.asOf} />
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
}

const AGENT_TONE: Record<string, string> = {
  reader: "bg-info-soft text-info",
  finder: "bg-accent-soft text-accent-ink",
  writer: "bg-surface-2 text-ink-2",
  sender: "bg-surface-2 text-ink-2",
  inbox: "bg-info-soft text-info",
  dispatcher: "bg-ok-soft text-ok",
  ledger: "bg-ok-soft text-ok",
  guard: "bg-warn-soft text-warn",
  reporter: "bg-surface-2 text-ink-2",
};

export function agentTone(agent: string): string {
  return AGENT_TONE[agent] ?? "bg-surface-2 text-ink-2";
}

export function AgentFeed({ events, asOf, limit = 8, title = "What your team did" }: { events: AgentEvent[]; asOf: string; limit?: number; title?: string }) {
  const recent = [...events].sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, limit);
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Bot size={16} className="text-ink-3" /> {title}
        </span>
      }
      sub={`${events.length.toLocaleString("en-US")} actions so far`}
    >
      <Box>
        <ol className="divide-y divide-line">
          {recent.map((e) => (
            <li key={e.id} className="flex gap-3 px-3.5 py-2">
              <span className={cx("mt-0.5 h-5 shrink-0 rounded px-1.5 font-mono text-[10.5px] leading-5 font-medium tracking-wide uppercase", agentTone(e.agent))}>{AGENTS[e.agent]?.name ?? e.agent}</span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={cx("text-[13.5px] font-semibold", e.kind === "win" && "text-ok", e.kind === "warning" && "text-warn")}>{e.title}</span>
                {e.detail && <span className="text-[12.5px] text-ink-3">{e.detail}</span>}
              </div>
              <span className="shrink-0 text-[12px] text-ink-3">{relTime(e.at, asOf)}</span>
            </li>
          ))}
          {!recent.length && <li className="px-3.5 py-6 text-center text-[13.5px] text-ink-3">Nothing yet.</li>}
        </ol>
      </Box>
    </Section>
  );
}

export function Guarantee() {
  const { a, rev } = useAccount();
  if (!a) return null;
  const d = derive(a, rev);
  const b = a.dataset.business;
  const g = d.guarantee;
  const trial = b.plan.stage === "trial";
  return (
    <Box className="flex flex-col gap-2.5 p-4">
      <span className="flex items-center gap-2 text-[14px] font-bold">
        <ShieldCheck size={16} className="text-ok" /> The guarantee
      </span>
      {trial ? (
        <>
          <p className="text-[13.5px] text-ink-2">
            The first {b.plan.trialSize} are free. After that it's {fmtMoney(b.plan.monthlyPrice)} a month, cancel by text, and <b className="text-ink">any month nobody asks for a price or a date, you don't pay.</b>
          </p>
          <Bar value={d.totals.wants} max={Math.max(3, d.totals.wants)} tone="ok" />
          <span className="text-[12.5px] text-ink-3">{d.totals.wants ? `${plural(d.totals.wants, "person has", "people have")} asked for a price or a date so far.` : "Nobody yet. The first replies usually land within days."}</span>
        </>
      ) : g ? (
        <>
          <p className="text-[13.5px] text-ink-2">
            This month runs to <b className="text-ink">{new Date(`${g.chargeOn}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</b>.{" "}
            {g.free ? "Nobody has asked for a price or a date yet, so right now this month is free." : `${plural(g.asked.length, "person has", "people have")} asked for a price or a date, so this month counts.`}
          </p>
          <div>
            <Pill tone={g.free ? "warn" : "ok"}>{g.free ? "On track to be free" : "Working: month is paid for"}</Pill>
          </div>
          {b.plan.freeMonths.length > 0 && <span className="text-[12.5px] text-ink-3">{plural(b.plan.freeMonths.length, "month has", "months have")} been free under the guarantee.</span>}
        </>
      ) : (
        <p className="text-[13.5px] text-ink-2">Any month nobody asks for a price or a date, you don't pay. No contract. Cancel with one text.</p>
      )}
    </Box>
  );
}
