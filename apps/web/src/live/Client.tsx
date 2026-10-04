import { useState } from "react";
import { Activity, ArrowLeft, CalendarDays, CheckCheck, FileSearch, Pause, PhoneCall, Play, RefreshCw, Repeat, Send, ShieldCheck, TrendingUp } from "lucide-react";
import { billsPass, brakesLine, BREAKAGE_LABEL, daysBetween, fmtMoney, fmtPhone, isOnePass, MONTHLY_REFILL, ONE_PASS, passLate, passPaid, passPromise, plural, SEND_BRAKES, wantedWords, type BreakageType, type ChargeStatus } from "@qa/engine";
import { useApp } from "../store/app";
import { cx, NavBadge, Pill, tabCls } from "../components/ui";
import { Box, Btn, EmptyRow, Pager, pct, RowMenu, Section, Select, smallInputCls, Table, Td, Th, Tr } from "../components/table";
import { SUPPRESS_LABEL } from "../lib/labels";
import { api, type Links, type OppPage, type Overview, type PlanResult, type TouchPage } from "./api";
import { copy, useAction, useApi, useLive, type ClientTab } from "./store";
import { ErrorNote, IntentPill, OutcomeForm, ReadinessPanel, ago, when } from "./parts";
import { stageOf, tradeLabel } from "./Clients";
import { ActivityTab, FilesTab, NotesTab, OwnerTextsTab, RepliesTab, SettingsTab } from "./ClientWork";
import { PasteReply } from "./TextsToSend";
import { lateLine, planRequest } from "./planning";
import { AgentTag, Blank, CardTitle, Figures, Monogram, Row, Rows, Tally, theirs, Waiting } from "./look";

const TABS: { id: ClientTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "opportunities", label: "List" },
  { id: "notes", label: "Notes" },
  { id: "replies", label: "Replies" },
  { id: "texts", label: "Texts to owner" },
  { id: "activity", label: "Activity" },
  { id: "files", label: "Files" },
  { id: "settings", label: "Settings" },
];

/** "47%": the share of quotes that never got a yes or a no. */
const quietPct = (rate: number) => `${Math.round(rate * 100)}%`;

export function LiveClient({ id }: { id: string }) {
  const tab = useLive((s) => s.clientTab);
  const setTab = useLive((s) => s.setClientTab);
  const enc = encodeURIComponent(id);
  const q = useApi<Overview>(`/businesses/${enc}`, { poll: 60_000 });
  const planned = useApi<TouchPage>(`/businesses/${enc}/touches?status=planned&limit=1`);
  const { busy, run } = useAction();
  const o = q.data;

  if (!o)
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        {q.error ? <ErrorNote error={q.error} onRetry={q.reload} /> : <Waiting className="text-left">Loading…</Waiting>}
      </div>
    );

  const b = o.business;
  const st = stageOf(o);
  const started = (o.counts?.queued ?? 0) + (o.counts?.sent ?? 0) > 0;
  const trial = b.plan.stage === "trial";
  const pass = isOnePass(b.plan);
  const waitingApproval = planned.data?.total ?? 0;
  const path = `/businesses/${enc}`;

  const doPlan = () =>
    run("plan", () => api<PlanResult>("POST", `${path}/plan`, planRequest(b)), (r) =>
      r.people
        ? `Planned ${plural(r.people, "person", "people")}, ${plural(r.notes, "note")}${r.firstDay ? `, starting ${when(r.firstDay)}` : ""}${r.awaitingOk ? (r.textSent ? ". The owner gets the first note by text; it starts when they reply OK." : ". Still waiting for the owner's OK; no new text went out.") : ""}${r.late ? ` It can't finish on time: the soonest is ${when(r.late.canMeet)} (see Needs a person).` : ""}`
        : trial
          ? "Nothing to plan: the free round is already full."
          : "Nobody new to plan right now.",
    );

  return (
    <div className="flex flex-col gap-5">
      <BackLink />
      <header className="flex flex-col gap-5">
        <div className="flex min-w-0 items-start gap-4">
          <Monogram name={b.name} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h1 className="text-[28px] leading-[1.08] break-words sm:text-[34px]">{b.name}</h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone={st.tone}>{st.label}</Pill>
              <Pill tone="neutral">{pass ? "One pass" : "Monthly"}</Pill>
              {o.awaitingOwnerOk && <Pill tone="warn">Waiting for the owner's OK</Pill>}
            </div>
            <p className="text-[14px] leading-snug text-ink-3">
              {tradeLabel(b.trade)}
              {b.city ? ` · ${b.city}${b.state ? `, ${b.state}` : ""}` : ""} · owner {b.ownerName || "—"} · signs as {b.signerName || "—"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn disabled={!!busy} onClick={() => void run("scan", () => api<{ summary?: { totalValue: number } }>("POST", `${path}/scan`), (r) => (r.summary ? `Scanned: ${fmtMoney(r.summary.totalValue)} found` : "Scanned"))}>
            <RefreshCw size={15} className={cx(busy === "scan" && "animate-spin")} /> Re-scan
          </Btn>
          {/* one gradient button per view: the plan button steps back while planned notes wait for an OK, or while it can't
              plan yet (then the owner's ask is the thing to do) */}
          <Btn variant={started || waitingApproval > 0 || !o.summary || !o.readiness?.ready ? "secondary" : "primary"} disabled={!!busy || !o.summary || !o.readiness?.ready} title={!o.readiness?.ready ? `First: ${o.readiness?.gaps.find((g) => g.level === "blocker")?.ask ?? "the missing files"}` : undefined} onClick={() => void doPlan()}>
            <Send size={15} /> {pass ? (started ? "Plan anyone new" : "Start the pass") : trial ? (started ? "Top up free round" : "Start free round") : "Plan next 4 weeks"}
          </Btn>
          {waitingApproval > 0 && (
            <Btn variant="primary" disabled={!!busy} onClick={() => void run("approve", () => api<{ approved: number }>("POST", `${path}/approve`), (r) => (r.approved ? `Approved ${plural(r.approved, "note")}` : "Nothing was waiting"))}>
              <CheckCheck size={15} /> {o.awaitingOwnerOk ? "Owner said OK: approve" : "Approve"} {waitingApproval.toLocaleString("en-US")} planned
            </Btn>
          )}
          {started && (
            <Btn disabled={!!busy} onClick={() => void run("pause", () => api<{ held?: "plan_paused" | "plan_cancelled" | "plan_done" }>("POST", `${path}/pause`, { paused: !o.paused }), (r) => (r.held === "plan_paused" ? "Pause lifted, but the plan itself is paused: set it in Settings before anything sends" : r.held === "plan_cancelled" ? "Pause lifted, but the plan is cancelled: nothing sends" : r.held === "plan_done" ? "Pause lifted, but the pass is done: nothing sends" : o.paused ? "Sending resumed" : "Sending paused"))}>
              {o.paused ? <Play size={15} /> : <Pause size={15} />} {o.paused ? "Resume" : "Pause"}
            </Btn>
          )}
          <LinksMenu id={id} name={b.name} requests={!!o.features?.newRequests} />
        </div>
      </header>

      <ReadinessPanel r={o.readiness} ownerFirst={b.ownerFirstName} />
      {/* a one pass its inboxes can't finish by its end date: what they can meet, and what would meet it */}
      <ErrorNote error={b.plan.stage === "running" ? lateLine(b, { approved: !o.awaitingOwnerOk }) : undefined} />
      {/* Instantly refused its inboxes: the reason, until it's fixed (Settings, or in Instantly) */}
      <ErrorNote error={b.senders?.refused && `Nothing goes out for this client: ${b.senders.refused}.`} />

      <div className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] max-sm:pr-12 max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-48px),transparent)] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Client sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(tabCls(tab === t.id), "shrink-0 gap-1.5 focus-visible:outline-offset-[-3px]")}
          >
            {t.label}
            {t.id === "replies" && (o.waitingOnOwner?.length ?? 0) > 0 && <NavBadge>{o.waitingOnOwner!.length}</NavBadge>}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab id={id} o={o} />}
      {tab === "opportunities" && <OpportunitiesTab id={id} o={o} />}
      {tab === "notes" && <NotesTab id={id} />}
      {tab === "replies" && <RepliesTab id={id} />}
      {tab === "texts" && <OwnerTextsTab id={id} />}
      {tab === "activity" && <ActivityTab id={id} />}
      {tab === "files" && <FilesTab id={id} o={o} />}
      {tab === "settings" && <SettingsTab id={id} o={o} />}
    </div>
  );
}

function BackLink() {
  const go = useApp((s) => s.go);
  return (
    <button type="button" onClick={() => go({ area: "live", tab: "clients" })} className="-ml-3 inline-flex min-h-11 w-fit cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink sm:min-h-9">
      <ArrowLeft size={15} /> All clients
    </button>
  );
}

function LinksMenu({ id, name, requests }: { id: string; name: string; requests: boolean }) {
  const go = useApp((s) => s.go);
  const { run } = useAction();
  const getLinks = () => api<Links>("GET", `/businesses/${encodeURIComponent(id)}/links`);
  return (
    <RowMenu
      label={`Links and more for ${name}`}
      items={[
        { label: "Copy owner link", onClick: () => void getLinks().then((l) => copy(l.owner, "Owner link copied")) },
        { label: "Copy file-forwarding token", onClick: () => void getLinks().then((l) => copy(l.importToken, "Import token copied")) },
        {
          label: "Replace all links",
          danger: true,
          confirm: requests
            ? `New owner and file-forwarding links for ${name}, and a new requests address. Every link sent before stops working (use it when a link got out, or someone left). Send the owner the new owner link, and the new requests address (Files tab) for their request forwarding: until they change it, each request forwarded to the old one lands in Needs a person instead of being answered.`
            : `New owner and file-forwarding links for ${name}. Every link sent before stops working (use it when a link got out, or someone left). Send the owner the new owner link.`,
          onClick: () => void run("rotate", () => api<Links>("POST", `/businesses/${encodeURIComponent(id)}/links/rotate`), "New links made — the old ones no longer work"),
        },
        {
          label: "Delete client",
          danger: true,
          confirm: `Delete ${name} and everything we have for it? This can't be undone.`,
          onClick: () => void run("delete", () => api("DELETE", `/businesses/${encodeURIComponent(id)}`), `Deleted ${name}`).then((r) => r && go({ area: "live", tab: "clients" })),
        },
      ]}
    />
  );
}

/** The Guard's brake holds every note until a person has looked at why (and cleaned the list or fixed the sender). */
export function ClearBrake({ id }: { id: string }) {
  const { busy, run } = useAction();
  return (
    <Btn disabled={!!busy} onClick={() => void run("brake", () => api("POST", `/businesses/${encodeURIComponent(id)}/health/clear`), "Brake cleared — sending resumes")}>
      I've looked into it — resume sending
    </Btn>
  );
}

/* ------------------------------ Overview ------------------------------ */

function OverviewTab({ id, o }: { id: string; o: Overview }) {
  const s = o.summary;
  const l = o.lift;
  const h = o.health;
  const g = o.guarantee;
  const p = o.business.plan;
  // the months show once one is asked for (a one pass's owner said yes) or the plan pays; the card shows with them
  const monthly = !!p.months?.length || (!isOnePass(p) && p.stage === "paying");
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Figures
          items={[
            { label: "Found", value: s ? fmtMoney(s.totalValue, { compact: true }) : "—", sub: s ? plural(s.opportunities, "opportunity", "opportunities") : "no scan yet" },
            { label: "Reachable", value: s ? fmtMoney(s.reachableValue, { compact: true }) : "—", sub: s ? `${s.reachablePeople.toLocaleString("en-US")} people` : undefined },
            { label: "Booked", value: fmtMoney(o.recoveredValue ?? 0), tone: "ok", sub: plural(o.totals?.booked ?? 0, "job") },
          ]}
        />
        <Tally
          three
          items={[
            { label: "Notes sent", value: (o.counts?.sent ?? 0).toLocaleString("en-US"), sub: `${(o.counts?.queued ?? 0).toLocaleString("en-US")} queued` },
            { label: "Replies", value: (o.totals?.replied ?? 0).toLocaleString("en-US"), sub: `${o.totals?.wants ?? 0} ${wantedWords(o.business.plan).past}` },
            {
              label: "Quiet rate",
              value: o.quiet?.since && o.quiet.since.quotes >= 5 ? quietPct(o.quiet.since.rate) : o.quiet ? quietPct(o.quiet.before.rate) : "—",
              sub: o.quiet?.since && o.quiet.since.quotes >= 5 ? `was ${quietPct(o.quiet.before.rate)} before us` : o.quiet?.backlog ? `${o.quiet.backlog.answered} of ${o.quiet.backlog.followed} old quotes answered` : "quotes with no yes or no",
            },
          ]}
        />
      </div>

      {(isOnePass(p) || billsPass(p)) && <PassBox o={o} card={!monthly} />}
      {monthly && <MonthsBox o={o} />}
      {o.refill && <RefillNote o={o} />}

      <PasteReply key={id} id={id} />

      <Section title={`Waiting on the owner (${o.waitingOnOwner?.length ?? 0})`} sub="Hot leads we texted the owner that haven't been called. Log what happened when the owner tells you.">
        <Box className={cx(!!o.waitingOnOwner?.length && "border-accent-line")}>
          <ul className="divide-y divide-line">
            {(o.waitingOnOwner ?? []).map((r) => (
              <li key={r.id} className="flex flex-col gap-2.5 px-4 py-3.5">
                <span className="flex flex-wrap items-center gap-2">
                  <b className="text-[14.5px]">{r.name}</b>
                  <IntentPill intent={r.intent} />
                  <span className="text-[12.5px] text-ink-3">{ago(r.receivedAt)}</span>
                </span>
                <span className={cx(theirs, "w-fit max-w-full text-ink-2")}>“{r.text}”</span>
                <OutcomeForm bid={id} reply={{ id: r.id, name: r.name }} compact />
              </li>
            ))}
            {!o.waitingOnOwner?.length && (
              <li>
                <Blank icon={PhoneCall} className="py-7">
                  Nobody is waiting on a call.
                </Blank>
              </li>
            )}
          </ul>
        </Box>
      </Section>

      {!!s?.callList?.people && (
        <Section
          title={`For the owner to call (${s.callList.people.toLocaleString("en-US")} · ${fmtMoney(s.callList.value, { compact: true })})`}
          sub={`We never email these: ${[s.callList.bigQuotes ? `${s.callList.bigQuotes} quotes over $10,000` : "", s.callList.phoneOnly ? `${s.callList.phoneOnly} with only a phone number` : ""].filter(Boolean).join(" and ")}. It goes to the owner in the welcome text, biggest first.`}
        >
          <Box>
            <ul className="divide-y divide-line">
              {s.callList.top.slice(0, 8).map((x) => (
                <li key={x.customerId} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 px-4 py-3 text-[13.5px]">
                  <span className="min-w-0 truncate">
                    <b>{x.name}</b>
                    <span className="text-ink-3">{x.job ? ` · ${x.job}` : ""} · {x.why === "big_quote" ? "big quote" : "phone only"}</span>
                  </span>
                  <span className="num text-[14.5px] font-semibold">{fmtMoney(x.value)}</span>
                  <span className="num col-span-2 text-[12.5px] text-ink-3">{fmtPhone(x.phone)}</span>
                </li>
              ))}
            </ul>
          </Box>
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Box className="flex flex-col gap-3 p-4 sm:p-5">
          <CardTitle icon={CalendarDays}>This week</CardTitle>
          <Rows>
            <Row k="Notes out">{o.week?.sent ?? 0}</Row>
            <Row k="Wrote back">{o.week?.replied ?? 0}</Row>
            <Row k={wantedWords(o.business.plan).label}>{o.week?.wants ?? 0}</Row>
            <Row k="Booked">{fmtMoney(o.week?.bookedValue ?? 0)}</Row>
            <Row k="Owner call-back time">{o.week?.avgHoursToCall !== undefined ? `${o.week.avgHoursToCall}h` : "—"}</Row>
          </Rows>
          {o.features?.newRequests && (
            <>
              <span className="mt-1 text-[12.5px] font-semibold text-accent-ink">New requests</span>
              <Rows>
                <Row k="New requests answered">{o.week?.requestsAnswered ?? 0}</Row>
                <Row k="Typical answer time">{o.week?.answerMinutes !== undefined ? `${o.week.answerMinutes} min` : "—"}</Row>
                <Row k="New quotes followed up">{o.week?.freshFollowed ?? 0}</Row>
              </Rows>
            </>
          )}
        </Box>
        <Box className="flex flex-col gap-3 p-4 sm:p-5">
          <CardTitle icon={ShieldCheck}>Sending health</CardTitle>
          {h ? (
            <>
              <Rows>
                <Row k="Sent">{h.sent}</Row>
                <Row k="Bounce rate">
                  <Pill tone={h.bounceRate > SEND_BRAKES.bounces.rate ? "bad" : h.bounceRate > 0.02 ? "warn" : "ok"}>{pct(h.bounceRate)}</Pill>
                </Row>
                <Row k="Complaint rate">
                  <Pill tone={h.complaintRate > SEND_BRAKES.complaints.rate ? "bad" : h.complaintRate > 0 ? "warn" : "ok"}>{pct(h.complaintRate, 2)}</Pill>
                </Row>
                <Row k="Asked to stop">{h.stops}</Row>
              </Rows>
              {h.paused && (
                <>
                  <p className="text-[13px] font-semibold text-bad">{h.reason}</p>
                  <div>
                    <ClearBrake id={id} />
                  </div>
                </>
              )}
              <p className="text-[12.5px] leading-snug text-ink-3">{brakesLine()}</p>
            </>
          ) : (
            <p className="text-[13.5px] text-ink-3">Nothing sent yet.</p>
          )}
        </Box>
        <Box className="flex flex-col gap-3 p-4 sm:p-5">
          <CardTitle icon={TrendingUp}>Lift and the guarantee</CardTitle>
          {l ? (
            <Rows>
              <Row k="Got notes: came back">
                {l.treated.cameBack}/{l.treated.people} ({pct(l.treated.rate)})
              </Row>
              <Row k="Held back: came back">
                {l.holdout.cameBack}/{l.holdout.people} ({pct(l.holdout.rate)})
              </Row>
              <Row k="Caused by the notes" className="text-ok">
                {fmtMoney(l.incremental)}
              </Row>
            </Rows>
          ) : null}
          {l && <p className="text-[12.5px] leading-snug text-ink-3">{l.note}</p>}
          {g ? (
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13.5px]">
              Next charge {when(g.chargeOn)}: <Pill tone={g.free ? "warn" : "ok"}>{g.free ? "free so far (nobody asked)" : `counts (${g.asked.length} asked)`}</Pill>
            </p>
          ) : (
            <p className="rounded-control bg-accent-wash px-3 py-2.5 text-[13px] leading-snug text-ink-2">{isOnePass(o.business.plan) ? passPromise(o.business.plan) : o.business.plan.stage === "trial" ? `Free round of ${o.business.plan.trialSize}. Then ${fmtMoney(o.business.plan.monthlyPrice)}/month.` : "Not paying yet."}</p>
          )}
        </Box>
      </div>

      <Section title="Latest activity">
        <Box>
          <ol className="divide-y divide-line">
            {(o.events ?? []).slice(0, 10).map((e) => (
              <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[112px_minmax(0,1fr)_auto] sm:gap-x-4">
                <span className="pt-px">
                  <AgentTag agent={e.agent} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5 max-sm:col-span-2 max-sm:row-start-2">
                  <span className={cx("text-[13.5px] font-semibold", e.kind === "win" && "text-ok", e.kind === "warning" && "text-warn")}>{e.title}</span>
                  {e.detail && <span className="text-[12.5px] leading-snug text-ink-3">{e.detail}</span>}
                </span>
                <span className="num shrink-0 pt-0.5 text-[12px] whitespace-nowrap text-ink-3 max-sm:col-start-2 max-sm:row-start-1">{when(e.at)}</span>
              </li>
            ))}
            {!o.events?.length && (
              <li>
                <Blank icon={Activity} className="py-7">
                  Nothing yet.
                </Blank>
              </li>
            )}
          </ol>
        </Box>
      </Section>
    </div>
  );
}

/**
 * A one pass: the plan kind, its list, how far through it is against its end date, and its bookings and charges. Gone
 * monthly since, it's done, and its bookings and charges are still billed. The card on file shows here unless the
 * monthly charges show it.
 */
function PassBox({ o, card }: { o: Overview; card: boolean }) {
  const p = o.business.plan;
  const pass = isOnePass(p);
  const over = p.stage === "done" || !pass;
  const cap = p.capBookings ?? ONE_PASS.capBookings;
  const price = p.pricePerBooking ?? ONE_PASS.pricePerBooking;
  const x = o.pass ?? { people: 0, started: 0, sent: 0, notes: 0 };
  const today = o.asOf ?? "";
  const days = p.startedOn && p.targetEndOn ? daysBetween(p.startedOn, p.targetEndOn) : ONE_PASS.days;
  const day = p.startedOn && today >= p.startedOn ? Math.min(days, daysBetween(p.startedOn, today) + 1) : 0;
  return (
    <Section title={pass ? "One pass" : "The one pass before this plan"} sub={`${pass ? "The whole list once, newest first." : "Its bookings are still billed by its terms."} ${p.freeFirst ? `Bookings from the first ${p.freeFirst} people are free. ` : ""}${passPromise(p)}`}>
      {/* before it's planned, the people a plan would take */}
      <Tally
        items={[
          { label: "List", value: (x.people || (o.totals?.remaining ?? 0)).toLocaleString("en-US"), sub: x.people ? `${x.started.toLocaleString("en-US")} written to` : "not planned yet" },
          { label: "Notes sent", value: `${x.sent.toLocaleString("en-US")} of ${x.notes.toLocaleString("en-US")}`, sub: x.notes ? `${Math.round((x.sent / x.notes) * 100)}% of the pass` : "nothing planned yet" },
          {
            label: "Ends",
            value: over ? `Done ${when(p.doneOn)}` : when(p.targetEndOn),
            sub: over ? undefined : p.startedOn ? (day ? `day ${day} of ${days}` : `starts ${when(p.startedOn)}`) : "starts when it's planned",
            tone: p.stage === "running" && passLate(p) ? "warn" : undefined,
          },
          { label: "Billable bookings", value: `${o.billing?.billable ?? 0} of ${cap}`, sub: o.billing?.overCap ? `${o.billing.overCap} more past the cap` : "one per customer" },
          { label: "Charges", value: fmtMoney(passPaid(p)), sub: `paid, of ${fmtMoney(price * cap)}`, tone: passPaid(p) ? "ok" : undefined },
        ]}
      />
      {!!p.charges?.length && <ChargesTable o={o} />}
      {card && <SavedCard o={o} />}
    </Section>
  );
}

/**
 * The monthly plan's charges (BRIEF B5): the first month, asked for on the owner's yes, then each month that isn't
 * free, on the saved card on its day once its pre-charge text reached him. Where each stands; one not paid yet can be
 * marked paid outside the software, and one out on its /pay link can have its text sent again (for your OK).
 */
function MonthsBox({ o }: { o: Overview }) {
  const { busy, run } = useAction();
  const p = o.business.plan;
  const bid = encodeURIComponent(o.business.id);
  // a one pass's owner has no monthly price until the first month is paid: it's the month asked for
  const price = p.months?.length ? p.months.at(-1)!.amount / 100 : p.monthlyPrice;
  return (
    <Section title="Monthly charges" sub={`${fmtMoney(price)} a month, each on its day once its text reached him. No subscription: nothing renews by itself.`}>
      {!!p.months?.length && (
        <Table minWidth={620} label="Monthly charges">
          <thead>
            <tr>
              <Th>Month</Th>
              <Th>Where it stands</Th>
              <Th right>Amount</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {p.months.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <span className="block font-semibold">{c.first ? "First month" : `From ${when(c.month)}`}</span>
                  {c.first && <span className="text-[12px] text-ink-3">asked for {when(c.month)}</span>}
                </Td>
                <Td>
                  <span className="block">
                    {CHARGE_STATUS[c.status]}
                    {c.status === "approved" && c.via === "card" ? (c.toldAt && c.chargeOn ? `: the card on ${when(c.chargeOn)}` : c.first ? ": the card a business day after its text reaches him" : `: the card on ${when(c.chargeOn)}, once its text reaches him`) : ""}
                  </span>
                  {c.reason && <span className="text-[12px] text-ink-3">{c.reason}</span>}
                </Td>
                <Td right>{fmtMoney(c.amount / 100)}</Td>
                <Td right>
                  {c.status === "link_sent" && (
                    <Btn variant="ghost" disabled={!!busy} onClick={() => void run("link", () => api("POST", `/businesses/${bid}/charges/${encodeURIComponent(c.id)}/link`), "The text with its link waits for your OK")}>
                      Send the link again
                    </Btn>
                  )}
                  {!["paid", "refunded", "charging"].includes(c.status) && (
                    <Btn variant="ghost" disabled={!!busy} onClick={() => void run("paid", () => api("POST", `/businesses/${bid}/charges/paid`, { chargeId: c.id }), "Marked paid")}>
                      Paid outside
                    </Btn>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <SavedCard o={o} />
    </Section>
  );
}

/** A charge's state, in the operator's words. */
const CHARGE_STATUS: Record<ChargeStatus, string> = { heads_up: "Text waiting for you", approved: "Approved", link_sent: "Link sent", charging: "Going through", paid: "Paid", failed: "Didn't go through", refunded: "Refunded", skipped: "No charge" };

/**
 * The pass's charge log: who, which lead, where each stands; one not paid yet can be marked paid outside the software
 * (one cancelled too: money that came anyway is yours to refund or keep), and one out on its /pay link can have its text
 * sent again (for your OK) with the link as it is now.
 */
function ChargesTable({ o }: { o: Overview }) {
  const { busy, run } = useAction();
  const bid = encodeURIComponent(o.business.id);
  return (
    <Table minWidth={620} label="Charges">
      <thead>
        <tr>
          <Th>Booked</Th>
          <Th>Where it stands</Th>
          <Th right>Amount</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {o.business.plan.charges!.map((c) => (
          <Tr key={c.id}>
            <Td>
              <span className="block font-semibold">{o.billing?.names[c.customerId] || "A customer"}</span>
              <span className="text-[12px] text-ink-3">
                {c.code ? `#${c.code} · ` : ""}
                {c.bookedOn ? `booked ${when(c.bookedOn)}` : "no booking on the ledger"}
              </span>
            </Td>
            <Td>
              <span className="block">
                {CHARGE_STATUS[c.status]}
                {c.status === "approved" && c.via === "card" ? (c.toldAt && c.chargeOn ? `: the card on ${when(c.chargeOn)}` : ": the card a business day after its text reaches him") : ""}
              </span>
              {c.reason && <span className="text-[12px] text-ink-3">{c.reason}</span>}
            </Td>
            <Td right>{fmtMoney(c.amount / 100)}</Td>
            <Td right>
              {c.status === "link_sent" && (
                <Btn variant="ghost" disabled={!!busy} onClick={() => void run("link", () => api("POST", `/businesses/${bid}/charges/${encodeURIComponent(c.id)}/link`), "The text with its link waits for your OK")}>
                  Send the link again
                </Btn>
              )}
              {!["paid", "refunded", "charging"].includes(c.status) && (
                <Btn variant="ghost" disabled={!!busy} onClick={() => void run("paid", () => api("POST", `/businesses/${bid}/charges/paid`, { customerId: c.customerId }), "Marked paid")}>
                  Paid outside
                </Btn>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/** The card later charges go on (a booking's or a month's): the first link's Checkout saved it, or Jack pastes the Stripe customer his own link made. */
function SavedCard({ o }: { o: Overview }) {
  const [customer, setCustomer] = useState("");
  const { busy, run } = useAction();
  const card = o.business.plan.card;
  const field = `card-${o.business.id}`;
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-box border border-line bg-sunken px-4 py-3 text-[13.5px]"
      onSubmit={(e) => {
        e.preventDefault();
        void run("card", () => api("POST", `/businesses/${encodeURIComponent(o.business.id)}/stripe-customer`, { customer: customer.trim() }), "Later charges go on that customer's card").then((r) => r && setCustomer(""));
      }}
    >
      <span className="min-w-0 basis-full text-ink-2 sm:basis-auto sm:flex-1">{card ? `Card on file${card.last4 ? `: ${card.brand ?? "card"} ending ${card.last4}` : ""}${card.customer ? ` (${card.customer})` : ""}.` : `No card on file yet: the first ${isOnePass(o.business.plan) && !o.business.plan.months?.length ? "booking's" : "month's"} link saves it.`}</span>
      <label htmlFor={field} className="sr-only">
        Stripe customer id
      </label>
      <input id={field} className={cx(smallInputCls, "min-w-0 flex-1 sm:w-60 sm:flex-none")} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="cus_… from your own link" />
      <Btn type="submit" disabled={!customer.trim() || !!busy}>
        Use its card
      </Btn>
    </form>
  );
}

/** "Who gets monthly", once a free 150 or a one pass is over: how fast the owner's list refills. */
function RefillNote({ o }: { o: Overview }) {
  const r = o.refill!;
  const pass = isOnePass(o.business.plan);
  return (
    <Box className="flex items-start gap-3.5 border-accent-line bg-accent-wash px-4 py-3.5 text-[13.5px] sm:px-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-accent-soft text-accent-ink" aria-hidden="true">
        <Repeat size={17} />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
      <span>
        <b>Their list refills by about {plural(r.perMonth, "customer")} a month</b> (newly lapsed or due, averaged over the last 12 months).
      </span>
      <span className="text-[12.5px] text-ink-3">
        {r.monthly ? `That's ${MONTHLY_REFILL} or more: offer to keep it going monthly.` : pass ? `Under ${MONTHLY_REFILL}: check back next season.` : `Under ${MONTHLY_REFILL}: offer the one pass instead.`}
      </span>
      </span>
    </Box>
  );
}

/* ------------------------------ Opportunities ------------------------------ */

const PER = 50;

function OpportunitiesTab({ id, o }: { id: string; o: Overview }) {
  const [type, setType] = useState<BreakageType | "">("");
  const [status, setStatus] = useState<"" | "reachable" | "suppressed">("reachable");
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), per: String(PER) });
  if (type) qs.set("type", type);
  if (status) qs.set("status", status);
  const q = useApi<OppPage>(o.summary ? `/businesses/${encodeURIComponent(id)}/opportunities?${qs}` : null);
  const s = o.summary;
  if (!s)
    return (
      <Box>
        <Blank icon={FileSearch}>No scan yet. Import their files first (Files tab).</Blank>
      </Box>
    );
  return (
    <div className="flex flex-col gap-7">
      <Table minWidth={420} label="Opportunities by type">
        <thead>
          <tr>
            <Th>Type</Th>
            <Th right>Found</Th>
            <Th right>Reachable</Th>
            <Th right>Value</Th>
          </tr>
        </thead>
        <tbody>
          {s.byType.map((t) => (
            <Tr
              key={t.type}
              selected={type === t.type}
              onClick={() => {
                setType(type === t.type ? "" : t.type);
                setPage(1);
              }}
              label={t.label}
            >
              <Td className="max-w-[420px]">
                <span className="block font-semibold">{t.label}</span>
                <span className="line-clamp-1 text-[12px] text-ink-3">{t.explain}</span>
              </Td>
              <Td right>{t.count.toLocaleString("en-US")}</Td>
              <Td right>{t.reachable.toLocaleString("en-US")}</Td>
              <Td right className="font-semibold">
                {fmtMoney(t.value)}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <Section title={type ? BREAKAGE_LABEL[type].title : "All opportunities"} sub="Highest score first within each page. Click a type above to filter.">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            id="lo-status"
            label="Show"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[
              { value: "reachable", label: "We can reach" },
              { value: "suppressed", label: "Left alone on purpose" },
              { value: "", label: "Everyone" },
            ]}
          />
          {type && (
            <Btn variant="ghost" onClick={() => setType("")}>
              Clear type filter
            </Btn>
          )}
        </div>
        <ErrorNote error={q.error} onRetry={q.reload} />
        <Table minWidth={900} tall label="List">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>What</Th>
              <Th>Why</Th>
              <Th right>Value</Th>
              <Th right>Score</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.items ?? []).map((x) => (
              <Tr key={x.id}>
                <Td className="max-w-[180px] truncate font-semibold">{x.customer ?? "—"}</Td>
                <Td className="max-w-[220px]">
                  <span className="block truncate">{x.jobPhrase.replace(/^the /, "")}</span>
                  <span className="block text-[12px] text-ink-3">{x.label}</span>
                </Td>
                <Td className="max-w-[340px]">
                  <span className="line-clamp-2 text-[12.5px] text-ink-2" title={x.reason}>
                    {x.reason}
                  </span>
                </Td>
                <Td right>{x.value ? fmtMoney(x.value) : "—"}</Td>
                <Td right>{Math.round(x.score)}</Td>
                <Td className="whitespace-nowrap">{x.suppressed ? <span className="text-[12.5px] text-ink-3">{SUPPRESS_LABEL[x.suppressed] ?? x.suppressed}</span> : <Pill tone="ok">Reachable</Pill>}</Td>
              </Tr>
            ))}
            {!q.data?.items.length && (
              <EmptyRow cols={6}>
                {q.loading ? (
                  "Loading…"
                ) : (
                  <Blank icon={FileSearch} className="py-0">
                    Nothing here.
                  </Blank>
                )}
              </EmptyRow>
            )}
          </tbody>
        </Table>
        <Pager page={page - 1} pageSize={PER} total={q.data?.total ?? 0} onPage={(p) => setPage(p + 1)} />
      </Section>
    </div>
  );
}
