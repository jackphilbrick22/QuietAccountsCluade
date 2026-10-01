import { useState, type ReactNode } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { fmtMoney, isOnePass, playbook, SEND_BRAKES, TIMEZONES, TRADE_OPTIONS, type TradeId } from "@qa/engine";
import { useApp } from "../store/app";
import { cx, Pill } from "../components/ui";
import { Box, Btn, EmptyRow, Kpi, Kpis, PageHead, pct, SearchBox, selectCls, smallInputCls, Table, Td, Th, Tr } from "../components/table";
import { api, ApiError, type Overview } from "./api";
import { useApi, useLive } from "./store";
import { ErrorNote, ago } from "./parts";

export function stageOf(o: Overview): { label: string; tone: "ok" | "info" | "warn" | "neutral" | "bad" } {
  const p = o.business.plan;
  if (p.stage === "done") return { label: "Pass done", tone: "neutral" };
  if (o.paused || p.stage === "paused") return { label: "Paused", tone: "warn" };
  if (p.stage === "cancelled") return { label: "Cancelled", tone: "bad" };
  if (p.stage === "paying") return { label: "Paying", tone: "ok" };
  if (!o.counts || o.counts.queued + o.counts.sent === 0) return { label: o.summary ? "Not started" : "Waiting on files", tone: "neutral" };
  return isOnePass(p) ? { label: "One pass running", tone: "info" } : { label: "Free round", tone: "info" };
}

/** Any trade an account has, including the playbooks the menus no longer offer. */
export function tradeLabel(t: string): string {
  return playbook(t as TradeId).label;
}

export function LiveClients() {
  const go = useApp((s) => s.go);
  const q = useApi<Overview[]>("/businesses", { poll: 60_000 });
  const [search, setSearch] = useState("");
  const rows = (q.data ?? []).filter((o) => !search.trim() || `${o.business.name} ${o.business.city ?? ""} ${o.business.trade}`.toLowerCase().includes(search.trim().toLowerCase()));
  const all = q.data ?? [];
  const paying = all.filter((o) => o.business.plan.stage === "paying" && !o.paused);
  const sum = (f: (o: Overview) => number) => all.reduce((n, o) => n + f(o), 0);
  const blocked = all.filter((o) => o.readiness && !o.readiness.ready).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHead
        title="Clients"
        sub="Every business we run follow-ups for. Click a client to run it."
        actions={
          <>
            <Btn onClick={q.reload} aria-label="Refresh">
              <RefreshCw size={15} className={cx(q.loading && "animate-spin")} /> Refresh
            </Btn>
            <Btn variant="primary" onClick={() => go({ area: "live", tab: "new" })}>
              <Plus size={15} /> Add client
            </Btn>
          </>
        }
      />
      <ErrorNote error={q.error} onRetry={q.reload} />

      <Kpis>
        <Kpi label="MRR" value={fmtMoney(paying.reduce((n, o) => n + o.business.plan.monthlyPrice, 0))} tone="ok" sub={`${paying.length} paying`} />
        <Kpi label="Clients" value={all.length} sub={blocked ? `${blocked} waiting on files` : "all have their files"} tone={blocked ? "warn" : undefined} />
        <Kpi label="Sent this week" value={sum((o) => o.week?.sent ?? 0).toLocaleString("en-US")} />
        <Kpi label="Replies this week" value={sum((o) => o.week?.replied ?? 0).toLocaleString("en-US")} />
        <Kpi label="Waiting on owners" value={sum((o) => o.waitingOnOwner?.length ?? 0)} tone={sum((o) => o.waitingOnOwner?.length ?? 0) ? "bad" : undefined} sub="hot leads not called yet" />
        <Kpi label="Booked, all time" value={fmtMoney(sum((o) => o.recoveredValue ?? 0), { compact: true })} tone="ok" />
      </Kpis>

      <SearchBox id="live-search" className="w-full sm:w-72" value={search} onChange={setSearch} placeholder="Search clients" />

      <Table minWidth={1000} label="Clients">
        <thead>
          <tr>
            <Th>Business</Th>
            <Th>Stage</Th>
            <Th>Files</Th>
            <Th right>Found</Th>
            <Th right>Sent</Th>
            <Th right>Replied</Th>
            <Th right>Interested</Th>
            <Th right>Booked</Th>
            <Th right wrap className="w-20">
              Waiting on owner
            </Th>
            <Th right>Bounce</Th>
            <Th>Updated</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const b = o.business;
            const st = stageOf(o);
            const blockers = o.readiness?.gaps.filter((g) => g.level === "blocker").length ?? 0;
            const asks = o.readiness?.gaps.filter((g) => g.level !== "sharpen").length ?? 0;
            const h = o.health;
            return (
              <Tr key={b.id} onClick={() => go({ area: "live", tab: "client", detail: b.id })} label={`Open ${b.name}`}>
                <Td className="max-w-[220px]">
                  <span className="block truncate font-semibold">{b.name}</span>
                  <span className="block truncate text-[12px] text-ink-3">
                    {tradeLabel(b.trade)}
                    {b.city ? ` · ${b.city}` : ""}
                  </span>
                </Td>
                <Td className="whitespace-nowrap">
                  <Pill tone={st.tone}>{st.label}</Pill>
                </Td>
                <Td className="max-w-[220px]">
                  {!o.readiness ? (
                    "—"
                  ) : blockers ? (
                    <span className="flex flex-col">
                      <Pill tone="bad">{blockers === 1 ? "1 blocker" : `${blockers} blockers`}</Pill>
                      <span className="mt-0.5 truncate text-[12px] text-ink-3">{o.readiness.gaps.find((g) => g.level === "blocker")?.ask}</span>
                    </span>
                  ) : asks ? (
                    <Pill tone="accent">{asks} to ask for</Pill>
                  ) : (
                    <Pill tone="ok">Complete</Pill>
                  )}
                </Td>
                <Td right>{o.summary ? fmtMoney(o.summary.reachableValue, { compact: true }) : "—"}</Td>
                <Td right>{(o.counts?.sent ?? 0).toLocaleString("en-US")}</Td>
                <Td right>{(o.totals?.replied ?? 0).toLocaleString("en-US")}</Td>
                <Td right>{(o.totals?.wants ?? 0).toLocaleString("en-US")}</Td>
                <Td right className="font-semibold">
                  {fmtMoney(o.recoveredValue ?? 0)}
                </Td>
                <Td right>{o.waitingOnOwner?.length ? <span className="font-semibold text-bad">{o.waitingOnOwner.length}</span> : <span className="text-ink-3">0</span>}</Td>
                <Td right>{h?.sent ? <Pill tone={h.bounceRate > SEND_BRAKES.bounces.rate ? "bad" : h.bounceRate > 0.02 ? "warn" : "ok"}>{pct(h.bounceRate)}</Pill> : <span className="text-ink-3">—</span>}</Td>
                <Td className="whitespace-nowrap text-ink-2">{o.events?.[0]?.at ? ago(o.events[0].at) : "—"}</Td>
              </Tr>
            );
          })}
          {!rows.length && <EmptyRow cols={11}>{q.loading ? "Loading…" : all.length ? "No clients match." : "No clients yet. Add the first one."}</EmptyRow>}
        </tbody>
      </Table>
    </div>
  );
}

/* ------------------------------ add a client ------------------------------ */

export function NewClient() {
  const go = useApp((s) => s.go);
  const toast = useApp((s) => s.toast);
  const bump = useLive((s) => s.bump);
  const setClientTab = useLive((s) => s.setClientTab);
  const [f, setF] = useState({
    name: "",
    trade: "tree" as TradeId,
    ownerName: "",
    ownerPhone: "",
    ownerEmail: "",
    signerName: "",
    signerRole: "office" as "office" | "owner",
    mailingAddress: "",
    city: "",
    state: "",
    timezone: "America/New_York",
    replyTo: "",
    businessPhone: "",
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    const local: Record<string, string> = {};
    if (f.name.trim().length < 2) local.name = "Business name is required.";
    if (!f.ownerName.trim()) local.ownerName = "Owner's name is required.";
    if (!f.signerName.trim()) local.signerName = "Who signs the notes is required.";
    if (f.mailingAddress.trim().length < 8) local.mailingAddress = "A full mailing address is required (it goes in every email footer).";
    if (f.state && f.state.trim().length !== 2) local.state = "Two letters, like NH.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setError(undefined);
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) if (String(v).trim()) body[k] = String(v).trim();
    if (body.state) body.state = body.state.toUpperCase();
    try {
      const r = await api<{ id: string; warnings?: string[] }>("POST", "/businesses", body);
      toast(`Added ${f.name.trim()}. ${r.warnings?.length ? r.warnings.join(" ") : "Now drop in their exports."}`);
      bump();
      setClientTab("files");
      go({ area: "live", tab: "client", detail: r.id });
    } catch (e) {
      const err = e as ApiError;
      const byField: Record<string, string> = {};
      for (const i of err.issues ?? []) byField[String(i.path[0])] = i.message;
      setErrors(byField);
      setError(err.issues?.length ? "Some fields need fixing." : err.message);
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof typeof f, label: string, opts: { hint?: string; type?: string; placeholder?: string; wide?: boolean; autoComplete?: string } = {}) => (
    <Field id={`nc-${k}`} label={label} hint={opts.hint} error={errors[k]} wide={opts.wide}>
      <input id={`nc-${k}`} type={opts.type ?? "text"} className={cx(smallInputCls, errors[k] && "border-bad")} value={f[k]} placeholder={opts.placeholder} autoComplete={opts.autoComplete} onChange={(e) => set(k, e.target.value)} aria-invalid={!!errors[k] || undefined} />
    </Field>
  );

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <PageHead title="Add a client" sub="The basics we need to write and sign notes for them. Their files come next." />
      <Box className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {field("name", "Business name", { placeholder: "Ridgeline Tree Co.", autoComplete: "organization" })}
          <Field id="nc-trade" label="Trade">
            <select id="nc-trade" className={cx(selectCls, "w-full")} value={f.trade} onChange={(e) => set("trade", e.target.value)}>
              {TRADE_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          {field("ownerName", "Owner's name", { placeholder: "Dave Ridge" })}
          {field("ownerPhone", "Owner's cell", { type: "tel", hint: "Hand-offs and the Friday report are texted here.", placeholder: "+1 603 555 0199" })}
          {field("ownerEmail", "Owner's email", { type: "email", hint: "Hand-offs go here when a text can't (no cell, or they texted STOP)." })}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            {field("signerName", "Who signs the notes", { placeholder: "Sarah" })}
            <div className="flex flex-col gap-1">
              <label htmlFor="nc-role" className="sr-only">
                Their role
              </label>
              <select id="nc-role" className={selectCls} value={f.signerRole} onChange={(e) => set("signerRole", e.target.value)}>
                <option value="office">Office</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          </div>
          {field("mailingAddress", "Mailing address", { hint: "Required by law (CAN-SPAM) in every email footer.", placeholder: "14 Mill Rd, Concord, NH 03301", wide: true })}
          {field("city", "City")}
          {field("state", "State", { placeholder: "NH" })}
          <Field id="nc-tz" label="Time zone" hint="Notes go out in their morning.">
            <select id="nc-tz" className={cx(selectCls, "w-full")} value={f.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {TIMEZONES.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {field("replyTo", "Reply-to email", { type: "email", hint: "Leave empty unless it forwards to our inbound address: replies we never see can't be read or stopped." })}
          {field("businessPhone", "Business phone", { type: "tel" })}
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-bad">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Adding…" : "Add client"}
          </Btn>
          <Btn variant="ghost" onClick={() => go({ area: "live", tab: "clients" })}>
            Cancel
          </Btn>
        </div>
      </Box>
    </div>
  );
}

export function Field({ id, label, hint, error, wide, children }: { id: string; label: string; hint?: string; error?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", wide && "sm:col-span-2")}>
      <label htmlFor={id} className={cx("text-[12.5px] font-semibold", error ? "text-bad" : "text-ink-2")}>
        {label}
      </label>
      {children}
      {error ? <span className="text-[12px] text-bad">{error}</span> : hint && <span className="text-[12px] text-ink-3">{hint}</span>}
    </div>
  );
}
