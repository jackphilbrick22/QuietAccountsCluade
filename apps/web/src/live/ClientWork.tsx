import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AGENTS, fmtMoney, playbook, plural, type AgentId, type BusinessProfile, type Reply, type Touch } from "@qa/engine";
import { useApp } from "../store/app";
import { cx, Pill, Toggle } from "../components/ui";
import { Box, Btn, Chip, ConfirmBtn, EmptyRow, Pager, SearchBox, Section, Select, selectCls, smallInputCls, Table, Td, Th, Tr } from "../components/table";
import { FileDrop, KIND_LABEL, SOURCE_LABEL, toFileIns, type StagedFile } from "../components/files";
import { hourLabel, WEEKDAYS } from "../lib/labels";
import { api, type AgentEvent, type FileRow, type ImportResult, type Integrations, type Links, type OwnerMessageRow, type OwnerTextRow, type Overview, type TouchPage } from "./api";
import { copy, useAction, useApi } from "./store";
import { DELIVERY, ErrorNote, IntentPill, MSG_KIND, NoteEditor, OUTCOME_LABEL, OutcomeForm, ReplyActions, ago, usePeople, when } from "./parts";
import { Field } from "./Clients";

const PER = 50;

/* ------------------------------ Notes ------------------------------ */

type NoteFilter = "planned" | "approved" | "sent" | "cancelled" | "flagged" | "all";
const NOTE_FILTERS: { id: NoteFilter; label: string }[] = [
  { id: "planned", label: "Waiting for approval" },
  { id: "approved", label: "Scheduled" },
  { id: "flagged", label: "Flagged" },
  { id: "sent", label: "Sent" },
  { id: "cancelled", label: "Stopped" },
  { id: "all", label: "All" },
];

const STATUS_PILL: Record<string, { label: string; tone: "ok" | "info" | "warn" | "neutral" | "bad" }> = {
  planned: { label: "Waiting for approval", tone: "warn" },
  approved: { label: "Scheduled", tone: "info" },
  sent: { label: "Sent", tone: "ok" },
  delivered: { label: "Sent", tone: "ok" },
  cancelled: { label: "Stopped", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
  bounced: { label: "Bounced", tone: "bad" },
};

export function NotesTab({ id }: { id: string }) {
  const q = useApi<TouchPage>(`/businesses/${encodeURIComponent(id)}/touches?limit=5000`);
  const [filter, setFilter] = useState<NoteFilter>("approved");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const all = q.data?.items ?? [];
  const match = (t: Touch, f: NoteFilter) =>
    f === "all" ? true : f === "flagged" ? t.flags.length > 0 && (t.status === "planned" || t.status === "approved") : f === "sent" ? t.status === "sent" || t.status === "delivered" : f === "cancelled" ? t.status === "cancelled" || t.status === "skipped" || t.status === "bounced" : t.status === f;
  const needle = search.trim().toLowerCase();
  const rows = all.filter((t) => match(t, filter) && (!needle || `${t.subject ?? ""} ${t.body}`.toLowerCase().includes(needle)));
  const pageRows = rows.slice(page * PER, (page + 1) * PER);
  const people = usePeople(id, pageRows.map((t) => t.customerId));

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="toolbar" aria-label="Filter notes">
        {NOTE_FILTERS.map((f) => (
          <Chip
            key={f.id}
            active={filter === f.id}
            count={all.filter((t) => match(t, f.id)).length}
            tone={f.id === "flagged" || f.id === "planned" ? "warn" : undefined}
            onClick={() => {
              setFilter(f.id);
              setPage(0);
              setOpen(null);
            }}
          >
            {f.label}
          </Chip>
        ))}
      </div>
      <SearchBox
        id="notes-search"
        className="w-full sm:w-72"
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        placeholder="Search subject or note"
      />
      <ErrorNote error={q.error} onRetry={q.reload} />
      <Table minWidth={820} label="Notes">
        <thead>
          <tr>
            <Th className="w-8">
              <span className="sr-only">Open</span>
            </Th>
            <Th>Goes out</Th>
            <Th>To</Th>
            <Th right>Note</Th>
            <Th>Subject</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((t) => {
            const p = people.get(t.customerId);
            const st = STATUS_PILL[t.status] ?? { label: t.status, tone: "neutral" as const };
            const isOpen = open === t.id;
            return (
              <FragmentRows key={t.id}>
                <Tr onClick={() => setOpen(isOpen ? null : t.id)} selected={isOpen} label={`Note to ${p?.name ?? "customer"}`}>
                  <Td className="text-ink-3">{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</Td>
                  <Td className="num whitespace-nowrap">{when(t.sentAt ?? t.dueAt)}</Td>
                  <Td className="max-w-[200px]">
                    <span className="block truncate font-semibold">{p?.name ?? "…"}</span>
                    <span className="block truncate text-[12px] text-ink-3">{p?.email ?? ""}</span>
                  </Td>
                  <Td right>{t.step}</Td>
                  <Td className="max-w-[320px] truncate">{t.subject || "(no subject)"}</Td>
                  <Td className="whitespace-nowrap">
                    <Pill tone={st.tone}>{st.label}</Pill> {t.flags.length > 0 && <Pill tone="warn">{plural(t.flags.length, "flag")}</Pill>}
                  </Td>
                </Tr>
                {isOpen && (
                  <tr>
                    <td colSpan={6} className="border-b border-line bg-bg px-3 py-3">
                      <NoteEditor bid={id} touch={{ ...t, subject: t.subject }} onDone={() => setOpen(null)} />
                    </td>
                  </tr>
                )}
              </FragmentRows>
            );
          })}
          {!pageRows.length && <EmptyRow cols={6}>{q.loading ? "Loading…" : "No notes here."}</EmptyRow>}
        </tbody>
      </Table>
      <Pager page={page} pageSize={PER} total={rows.length} onPage={setPage} />
    </div>
  );
}

function FragmentRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/* ------------------------------ Replies ------------------------------ */

type ReplyFilter = "waiting" | "wants" | "later" | "closed" | "unclear" | "all";
const WANTS = new Set(["wants_it", "wants_price", "question"]);
const REPLY_FILTERS: { id: ReplyFilter; label: string; test: (r: Reply) => boolean }[] = [
  { id: "waiting", label: "Waiting on owner", test: (r) => WANTS.has(r.intent) && r.status === "handed_off" && !r.ownerContactedAt },
  { id: "wants", label: "Wanted the work", test: (r) => WANTS.has(r.intent) },
  { id: "unclear", label: "Needs a read", test: (r) => r.intent === "unclear" && r.status === "new" },
  { id: "later", label: "Later", test: (r) => r.intent === "later" },
  { id: "closed", label: "Closed out", test: (r) => !WANTS.has(r.intent) && !["later", "unclear", "auto_reply", "bounce"].includes(r.intent) },
  { id: "all", label: "Everything", test: () => true },
];

export function RepliesTab({ id }: { id: string }) {
  const q = useApi<Reply[]>(`/businesses/${encodeURIComponent(id)}/replies`);
  const all = q.data ?? [];
  const [filter, setFilter] = useState<ReplyFilter>("waiting");
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const f = REPLY_FILTERS.find((x) => x.id === filter)!;
  const rows = all.filter(f.test);
  const pageRows = rows.slice(page * PER, (page + 1) * PER);
  const people = usePeople(id, pageRows.map((r) => r.customerId));
  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="toolbar" aria-label="Filter replies">
        {REPLY_FILTERS.map((x) => (
          <Chip
            key={x.id}
            active={filter === x.id}
            count={all.filter(x.test).length}
            tone={x.id === "waiting" ? "bad" : x.id === "unclear" ? "warn" : undefined}
            onClick={() => {
              setFilter(x.id);
              setPage(0);
              setOpen(null);
            }}
          >
            {x.label}
          </Chip>
        ))}
      </div>
      <ErrorNote error={q.error} onRetry={q.reload} />
      <Box>
        <ul className="divide-y divide-line">
          {pageRows.map((r) => {
            const p = r.customerId ? people.get(r.customerId) : undefined;
            const isOpen = open === r.id;
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen} className={cx("flex w-full cursor-pointer items-start gap-3 px-3.5 py-2.5 text-left hover:bg-bg", isOpen && "bg-bg")}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-semibold">{p?.name ?? r.from}</span>
                      <IntentPill intent={r.intent} />
                      {r.outcome && <Pill tone={r.outcome === "booked" ? "ok" : "neutral"}>{OUTCOME_LABEL[r.outcome]}{r.outcomeValue ? ` ${fmtMoney(r.outcomeValue)}` : ""}</Pill>}
                    </span>
                    <span className={cx("text-[12.5px] text-ink-2", !isOpen && "truncate")}>{isOpen ? r.text : r.text.split("\n")[0]}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-3">{when(r.receivedAt)}</span>
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-3 border-t border-line bg-bg px-3.5 py-3">
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]">
                      <dt className="text-ink-3">From</dt>
                      <dd className="truncate">{r.from}</dd>
                      {(r.extracted.phone ?? p?.phone) && (
                        <>
                          <dt className="text-ink-3">Phone</dt>
                          <dd>
                            <a className="font-semibold text-accent-ink hover:underline" href={`tel:${r.extracted.phone ?? p?.phone}`}>
                              {r.extracted.phone ?? p?.phone}
                            </a>
                          </dd>
                        </>
                      )}
                      {r.extracted.bestTime && (
                        <>
                          <dt className="text-ink-3">Best time</dt>
                          <dd>{r.extracted.bestTime}</dd>
                        </>
                      )}
                      {r.extracted.followUpOn && (
                        <>
                          <dt className="text-ink-3">Check back</dt>
                          <dd>{when(r.extracted.followUpOn)}</dd>
                        </>
                      )}
                      <dt className="text-ink-3">Read as</dt>
                      <dd>
                        {r.intent.replace(/_/g, " ")} ({Math.round(r.confidence * 100)}% sure)
                      </dd>
                      {r.handedOffAt && (
                        <>
                          <dt className="text-ink-3">Texted to owner</dt>
                          <dd>{when(r.handedOffAt)}</dd>
                        </>
                      )}
                      {r.ownerContactedAt && (
                        <>
                          <dt className="text-ink-3">Owner called</dt>
                          <dd>{when(r.ownerContactedAt)}</dd>
                        </>
                      )}
                    </dl>
                    {r.status !== "done" && (WANTS.has(r.intent) || r.intent === "unclear") && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[12.5px] font-semibold text-ink-2">Answer them, sort the reply, or hand it to the owner</span>
                        <ReplyActions bid={id} reply={{ id: r.id, name: p?.name }} draft={r.draft?.text} draftNeedsOwner={r.draft?.needsOwner} handedOff={r.status === "handed_off"} />
                        <span className="mt-1 text-[12.5px] font-semibold text-ink-2">Log what happened (when the owner tells you)</span>
                        <OutcomeForm bid={id} reply={{ id: r.id, name: p?.name }} />
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {!pageRows.length && <li className="px-3.5 py-8 text-center text-[13.5px] text-ink-3">{q.loading ? "Loading…" : "No replies here."}</li>}
        </ul>
      </Box>
      <Pager page={page} pageSize={PER} total={rows.length} onPage={setPage} />
    </div>
  );
}

/* ------------------------------ Texts to the owner ------------------------------ */

export function OwnerTextsTab({ id }: { id: string }) {
  const [delivery, setDelivery] = useState("");
  const q = useApi<OwnerMessageRow[]>(`/businesses/${encodeURIComponent(id)}/owner-messages${delivery ? `?delivery=${delivery}` : ""}`);
  const { busy, run } = useAction();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          id="texts-delivery"
          label="Show"
          value={delivery}
          onChange={setDelivery}
          options={[
            { value: "", label: "All texts (latest 100)" },
            { value: "review", label: "Waiting for you" },
            { value: "failed", label: "Failed" },
            { value: "pending", label: "Sending" },
            { value: "sent", label: "Sent" },
          ]}
        />
        <span className="text-[12.5px] text-ink-3">Texts about money (the close, pre-charge, free month) wait here for you before they go.</span>
      </div>
      <ErrorNote error={q.error} onRetry={q.reload} />
      <div className="flex flex-col gap-2">
        {(q.data ?? []).map((m) => {
          const dv = DELIVERY[m.delivery] ?? { label: m.delivery, tone: "neutral" as const };
          return (
            <Box key={m.id} className="flex flex-col gap-2 px-3.5 py-3">
              <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                <Pill tone={m.kind === "handoff" ? "accent" : m.kind === "sla_nudge" ? "warn" : "neutral"}>{MSG_KIND[m.kind] ?? m.kind}</Pill>
                <Pill tone={dv.tone}>{dv.label}</Pill>
                {when(m.at)}
                {m.channel ? ` · by ${m.channel}` : ""}
              </span>
              <p className="note-body text-[13.5px] leading-relaxed">{m.text}</p>
              {(m.delivery === "review" || m.delivery === "failed") && (
                <div className="flex flex-wrap gap-2">
                  <Btn variant="primary" disabled={!!busy} onClick={() => void run(m.id, () => api("POST", `/businesses/${encodeURIComponent(id)}/owner-messages/${encodeURIComponent(m.id)}/send`), "Approved and sent to the owner")}>
                    Approve and send
                  </Btn>
                  <Btn onClick={() => void copy(m.text, "Text copied")}>Copy text</Btn>
                </div>
              )}
            </Box>
          );
        })}
        {!q.data?.length && <Box className="px-4 py-8 text-center text-[13.5px] text-ink-3">{q.loading ? "Loading…" : "No texts here."}</Box>}
      </div>
      <FromOwner id={id} />
    </div>
  );
}

/** Every text the owner sent us, with what we did about it (the ones we couldn't act on also sit in Needs a person). */
function FromOwner({ id }: { id: string }) {
  const q = useApi<OwnerTextRow[]>(`/businesses/${encodeURIComponent(id)}/owner-texts`);
  const { busy, run } = useAction();
  return (
    <Section title="From the owner" sub="Their texts to us, newest first, and what each one did.">
      <ErrorNote error={q.error} onRetry={q.reload} />
      <div className="flex flex-col gap-2">
        {(q.data ?? []).map((t) => (
          <Box key={t.seq} className="flex flex-col gap-1.5 px-3.5 py-3">
            <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
              <Pill tone={t.needs_person && !t.done_at ? "warn" : "neutral"}>{t.handled.replace(/_/g, " ")}</Pill>
              {when(t.at)}
            </span>
            <p className="note-body text-[13.5px]">“{t.body}”</p>
            <p className="text-[12.5px] text-ink-3">We replied: {t.reply}</p>
            {t.needs_person && !t.done_at ? (
              <div>
                <Btn disabled={!!busy} onClick={() => void run(`t${t.seq}`, () => api("POST", `/businesses/${encodeURIComponent(id)}/owner-texts/${t.seq}/done`), "Marked handled")}>
                  Mark handled
                </Btn>
              </div>
            ) : null}
          </Box>
        ))}
        {!q.data?.length && <Box className="px-4 py-6 text-center text-[13.5px] text-ink-3">{q.loading ? "Loading…" : "The owner hasn't texted us yet."}</Box>}
      </div>
    </Section>
  );
}

/* ------------------------------ Activity ------------------------------ */

export function ActivityTab({ id }: { id: string }) {
  const q = useApi<AgentEvent[]>(`/businesses/${encodeURIComponent(id)}/events?limit=500`);
  const [agent, setAgent] = useState<AgentId | "all">("all");
  const [kind, setKind] = useState<AgentEvent["kind"] | "all">("all");
  const [page, setPage] = useState(0);
  const rows = (q.data ?? []).filter((e) => (agent === "all" || e.agent === agent) && (kind === "all" || e.kind === kind));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          id="act-agent"
          label="Agent"
          value={agent}
          onChange={(v) => {
            setAgent(v);
            setPage(0);
          }}
          options={[{ value: "all" as const, label: "All agents" }, ...(Object.keys(AGENTS) as AgentId[]).map((k) => ({ value: k, label: AGENTS[k].name }))]}
        />
        <Select
          id="act-kind"
          label="Kind"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPage(0);
          }}
          options={[
            { value: "all", label: "All kinds" },
            { value: "win", label: "Wins" },
            { value: "action", label: "Actions" },
            { value: "warning", label: "Warnings" },
            { value: "review", label: "Needs review" },
            { value: "info", label: "Info" },
          ]}
        />
      </div>
      <ErrorNote error={q.error} onRetry={q.reload} />
      <Table minWidth={760} tall label="Activity">
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Agent</Th>
            <Th>What happened</Th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(page * 100, (page + 1) * 100).map((e, i) => (
            <Tr key={`${e.id}-${i}`}>
              <Td className="num whitespace-nowrap text-ink-2">{when(e.at)}</Td>
              <Td>
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] font-medium tracking-wide text-ink-2 uppercase">{AGENTS[e.agent]?.name ?? e.agent}</span>
              </Td>
              <Td>
                <span className={cx("block font-semibold", e.kind === "win" && "text-ok", e.kind === "warning" && "text-warn", e.kind === "review" && "text-accent-ink")}>{e.title}</span>
                {e.detail && <span className="line-clamp-2 text-[12.5px] text-ink-3">{e.detail}</span>}
              </Td>
            </Tr>
          ))}
          {!rows.length && <EmptyRow cols={3}>{q.loading ? "Loading…" : "Nothing yet."}</EmptyRow>}
        </tbody>
      </Table>
      <Pager page={page} pageSize={100} total={rows.length} onPage={setPage} />
    </div>
  );
}

/* ------------------------------ Files ------------------------------ */

export function FilesTab({ id, o }: { id: string; o: Overview }) {
  const enc = encodeURIComponent(id);
  const files = useApi<FileRow[]>(`/businesses/${enc}/files`);
  const integ = useApi<Integrations>(`/businesses/${enc}/integrations`);
  const links = useApi<Links>(`/businesses/${enc}/links`);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [result, setResult] = useState<ImportResult["files"] | null>(null);
  const { busy, run } = useAction();
  const ready = toFileIns(staged);
  const j = integ.data?.jobber;
  return (
    <div className="flex flex-col gap-5">
      <Section title="Add their exports" sub="Drop every CSV the owner sent. We merge them into one customer list and scan again.">
        <FileDrop id="live-files" files={staged} onChange={setStaged} />
        {staged.length > 0 && (
          <div>
            <Btn
              variant="primary"
              disabled={!ready.length || !!busy}
              onClick={() =>
                void run("import", () => api<ImportResult>("POST", `/businesses/${enc}/imports`, { files: ready.slice(0, 20) }), (r) => `Read ${plural(r.files.length, "file")}. Found ${fmtMoney(r.overview.summary?.totalValue ?? 0)}.`).then((r) => {
                  if (r) {
                    setResult(r.files);
                    setStaged([]);
                  }
                })
              }
            >
              {busy === "import" ? "Reading…" : `Import ${plural(ready.length, "file")}`}
            </Btn>
            {ready.length > 20 && <span className="ml-2 text-[12.5px] text-warn">20 files per import; the rest can go in a second batch.</span>}
          </div>
        )}
        {result && (
          <Box className="flex flex-col gap-1 px-3.5 py-3 text-[13px]">
            <b>Just imported</b>
            {result.map((f) => (
              <span key={f.file}>
                {f.file}: {f.accepted.toLocaleString("en-US")} of {f.rows.toLocaleString("en-US")} rows as {KIND_LABEL[f.kind as keyof typeof KIND_LABEL] ?? f.kind}
                {f.assisted ? " (column matching checked by AI)" : ""}
                {f.warnings.length ? <span className="text-warn"> · {f.warnings.join("; ")}</span> : null}
              </span>
            ))}
          </Box>
        )}
      </Section>

      <Section title="Files we've read" sub={o.readiness ? o.readiness.headline : undefined}>
        <ErrorNote error={files.error} onRetry={files.reload} />
        <Table minWidth={640} label="Files we've read">
          <thead>
            <tr>
              <Th>File</Th>
              <Th>What</Th>
              <Th>From</Th>
              <Th right>Rows</Th>
              <Th right>Used</Th>
              <Th>Read on</Th>
            </tr>
          </thead>
          <tbody>
            {(files.data ?? []).map((f) => (
              <Tr key={f.id}>
                <Td className="max-w-[260px]">
                  <span className="block truncate font-semibold" title={f.fileName}>
                    {f.fileName}
                  </span>
                  {f.warnings.length > 0 && <span className="block truncate text-[12px] text-warn">{f.warnings[0]}</span>}
                </Td>
                <Td>{KIND_LABEL[f.kind] ?? f.kind}</Td>
                <Td>{SOURCE_LABEL[f.source] ?? f.source}</Td>
                <Td right>{f.rows.toLocaleString("en-US")}</Td>
                <Td right>{f.accepted.toLocaleString("en-US")}</Td>
                <Td className="whitespace-nowrap">{when(f.importedAt)}</Td>
              </Tr>
            ))}
            {!files.data?.length && <EmptyRow cols={6}>{files.loading ? "Loading…" : "No files yet."}</EmptyRow>}
          </tbody>
        </Table>
      </Section>

      <Section title="Other ways in">
        <Box className="flex flex-col gap-3 px-4 py-3 text-[13px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>Jobber connection:</b>{" "}
              {!j ? "…" : !j.available ? "not set up on this server (JOBBER_CLIENT_ID/SECRET)" : j.connected ? `connected${j.lastSyncAt ? `, last synced ${ago(j.lastSyncAt)}` : ""}` : "not connected yet"}
              {j?.lastError && <span className="text-bad"> · {j.lastError}</span>}
            </span>
            {links.data && (
              <Btn onClick={() => void copy(links.data!.connectJobber, "Jobber connect link copied — send it to the owner")}>Copy Jobber connect link</Btn>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <span>
              <b>Forwarding exports by email:</b> the owner can forward Jobber's export emails to <span className="font-mono">import+&lt;token&gt;@</span> your inbound address.
            </span>
            {links.data && <Btn onClick={() => void copy(links.data!.importToken, "Import token copied")}>Copy token</Btn>}
          </div>
        </Box>
      </Section>
    </div>
  );
}

/* ------------------------------ Settings ------------------------------ */

type Patch = Partial<Omit<BusinessProfile, "voice" | "persistence" | "plan">> & { voice?: Partial<BusinessProfile["voice"]>; persistence?: Partial<BusinessProfile["persistence"]>; plan?: Partial<BusinessProfile["plan"]> };

export function SettingsTab({ id, o }: { id: string; o: Overview }) {
  // keyed by the saved profile, so a save (or someone else's change) resets the draft
  return <SettingsForm key={JSON.stringify(o.business)} id={id} b={o.business} />;
}

const TEXT_FIELDS: [keyof BusinessProfile, string, string?][] = [
  ["name", "Business name"],
  ["ownerName", "Owner's name"],
  ["ownerPhone", "Owner's cell", "Hand-offs and reports are texted here."],
  ["ownerEmail", "Owner's email", "Hand-offs go here when a text can't (no cell, or they texted STOP)."],
  ["signerName", "Who signs the notes"],
  ["fromName", "Notes come from (name)", "Leave empty for “Sarah at Ridgeline Tree Co.”"],
  ["fromEmail", "Notes come from (address)", "This client's own sending mailbox. Empty: the server's sender."],
  ["replyTo", "Reply-to email", "Leave empty unless it forwards to our inbound address: replies we never see can't be read, answered or stopped."],
  ["businessPhone", "Business phone"],
  ["mailingAddress", "Mailing address", "Required in every email footer (CAN-SPAM)."],
  ["city", "City"],
  ["state", "State (2 letters)"],
];

function SettingsForm({ id, b }: { id: string; b: BusinessProfile }) {
  const go = useApp((s) => s.go);
  const [d, setD] = useState<BusinessProfile>(b);
  const { busy, run } = useAction();
  const patch = useMemo(() => diff(b, d), [b, d]);
  const dirty = Object.keys(patch).length > 0;
  const set = <K extends keyof BusinessProfile>(k: K, v: BusinessProfile[K]) => setD((x) => ({ ...x, [k]: v }));
  const num = (v: string, lo: number, hi: number, fallback: number) => {
    const n = Number(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && v !== "" ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  return (
    <div className="flex flex-col gap-5">
      <Group title="Business and contact">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {TEXT_FIELDS.map(([k, label, hint]) => (
            <Field key={k} id={`ls-${k}`} label={label} hint={hint} wide={k === "mailingAddress"}>
              <input id={`ls-${k}`} className={smallInputCls} value={String(d[k] ?? "")} onChange={(e) => set(k, (k === "state" ? e.target.value.toUpperCase().slice(0, 2) : e.target.value) as never)} />
            </Field>
          ))}
          <Field id="ls-role" label="Signer's role">
            <select id="ls-role" className={cx(selectCls, "w-full")} value={d.signerRole} onChange={(e) => set("signerRole", e.target.value as BusinessProfile["signerRole"])}>
              <option value="office">Office</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
        </div>
      </Group>

      <Group title="Pace">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[12.5px] font-semibold text-ink-2">Send days</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((w, i) => {
              const on = d.sendDays.includes(i);
              return (
                <label key={w} htmlFor={`ls-day-${i}`} className={cx("inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-semibold", on ? "border-accent/40 bg-accent-soft text-accent-ink" : "border-line-2 bg-surface text-ink-2")}>
                  <input id={`ls-day-${i}`} type="checkbox" checked={on} onChange={(e) => set("sendDays", e.target.checked ? [...new Set([...d.sendDays, i])].sort() : d.sendDays.filter((x) => x !== i))} />
                  {w}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field id="ls-w0" label="Send window starts">
            <select id="ls-w0" className={cx(selectCls, "w-full")} value={d.sendWindow[0]} onChange={(e) => set("sendWindow", [Number(e.target.value), Math.max(Number(e.target.value) + 1, d.sendWindow[1])])}>
              {Array.from({ length: 23 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="ls-w1" label="Send window ends">
            <select id="ls-w1" className={cx(selectCls, "w-full")} value={d.sendWindow[1]} onChange={(e) => set("sendWindow", [Math.min(d.sendWindow[0], Number(e.target.value) - 1), Number(e.target.value)])}>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </Field>
          <NumField id="ls-weekly" label="New people per week" value={d.weeklyNewContacts} onChange={(v) => set("weeklyNewContacts", num(v, 5, 1000, d.weeklyNewContacts))} />
          <NumField id="ls-minq" label="Smallest quote worth a note ($)" value={d.minQuoteValue} onChange={(v) => set("minQuoteValue", num(v, 0, 1e6, d.minQuoteValue))} />
          <NumField id="ls-minage" label="Wait at least (days) after a quote" value={d.minQuoteAgeDays} onChange={(v) => set("minQuoteAgeDays", num(v, 0, 365, d.minQuoteAgeDays))} />
          <NumField id="ls-maxage" label="Ignore quotes older than (months)" value={d.maxQuoteAgeMonths} onChange={(v) => set("maxQuoteAgeMonths", num(v, 1, 120, d.maxQuoteAgeMonths))} />
        </div>
      </Group>

      <Group title="Voice and follow-up">
        <Toggle id="ls-price" checked={d.voice.mentionPrice} onChange={(v) => set("voice", { ...d.voice, mentionPrice: v })} label="Mention the original price" sub="Off by default: the old number can bring back the sticker shock." />
        <Toggle id="ls-options" checked={d.voice.offerOptions} onChange={(v) => set("voice", { ...d.voice, offerOptions: v })} label="Offer smaller options" />
        <Toggle id="ls-freelook" checked={d.voice.freeLook ?? playbook(d.trade).freeLook} onChange={(v) => set("voice", { ...d.voice, freeLook: v })} label={'Say "No charge to look"'} sub="Only if the owner never charges to come out (off by default for HVAC, septic, pest, cleaning)." />
        <Toggle id="ls-seasonal" checked={d.persistence.seasonalCheckIn} onChange={(v) => set("persistence", { ...d.persistence, seasonalCheckIn: v })} label="Seasonal check-in" sub="One more note when the job's season comes back around." />
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <NumField id="ls-maxnotes" label="Most notes to one person per year" value={d.persistence.maxNotesPerYear} onChange={(v) => set("persistence", { ...d.persistence, maxNotesPerYear: num(v, 1, 12, d.persistence.maxNotesPerYear) })} />
          <NumField id="ls-holdout" label="Held back to measure lift (%)" value={Math.round(d.persistence.holdoutPct * 100)} onChange={(v) => set("persistence", { ...d.persistence, holdoutPct: num(v, 0, 30, d.persistence.holdoutPct * 100) / 100 })} />
        </div>
      </Group>

      <Group title="Plan">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field id="ls-stage" label="Stage">
            <select id="ls-stage" className={cx(selectCls, "w-full")} value={d.plan.stage} onChange={(e) => set("plan", { ...d.plan, stage: e.target.value as BusinessProfile["plan"]["stage"] })}>
              <option value="trial">Free round</option>
              <option value="paying">Paying</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
          <NumField id="ls-trial" label="Free round size (people)" value={d.plan.trialSize} onChange={(v) => set("plan", { ...d.plan, trialSize: num(v, 10, 1000, d.plan.trialSize) })} />
          <NumField id="ls-price-m" label="Monthly price ($)" value={d.plan.monthlyPrice} onChange={(v) => set("plan", { ...d.plan, monthlyPrice: num(v, 0, 100000, d.plan.monthlyPrice) })} />
          <Field id="ls-paid" label="First paid day" hint="Set this when they pay. The guarantee counts months from here.">
            <input id="ls-paid" type="date" className={smallInputCls} value={d.plan.paidOn ?? ""} onChange={(e) => set("plan", { ...d.plan, paidOn: e.target.value || undefined })} />
          </Field>
        </div>
      </Group>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-4">
        <Btn variant="primary" disabled={!dirty || !!busy} onClick={() => void run("save", () => api("PATCH", `/businesses/${encodeURIComponent(id)}`, patch), "Saved")}>
          {busy === "save" ? "Saving…" : "Save changes"}
        </Btn>
        <Btn variant="ghost" disabled={!dirty} onClick={() => setD(b)}>
          Discard
        </Btn>
        <span className="text-[12.5px] text-ink-3">{dirty ? `${Object.keys(patch).length} change${Object.keys(patch).length === 1 ? "" : "s"} not saved` : "Everything saved"}</span>
        <span className="ml-auto">
          <ConfirmBtn note="Delete this client and all its data?" confirmLabel="Yes, delete" onConfirm={() => void run("delete", () => api("DELETE", `/businesses/${encodeURIComponent(id)}`), `Deleted ${b.name}`).then((r) => r && go({ area: "live", tab: "clients" }))}>
            Delete client
          </ConfirmBtn>
        </span>
      </div>
    </div>
  );
}

function diff(a: BusinessProfile, b: BusinessProfile): Patch {
  const out: Record<string, unknown> = {};
  const keys: (keyof BusinessProfile)[] = ["name", "ownerName", "ownerPhone", "ownerEmail", "signerName", "signerRole", "fromName", "fromEmail", "replyTo", "businessPhone", "mailingAddress", "city", "state", "sendDays", "sendWindow", "weeklyNewContacts", "minQuoteValue", "minQuoteAgeDays", "maxQuoteAgeMonths", "voice", "persistence", "plan"];
  for (const k of keys) {
    let v: unknown = b[k];
    if (JSON.stringify(v) === JSON.stringify(a[k])) continue;
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === undefined) continue; // the API can't clear optional fields; leave them
    if (k === "voice") v = { mentionPrice: b.voice.mentionPrice, offerOptions: b.voice.offerOptions, ...(b.voice.freeLook !== undefined ? { freeLook: b.voice.freeLook } : {}) };
    if (k === "plan") v = { stage: b.plan.stage, trialSize: b.plan.trialSize, monthlyPrice: b.plan.monthlyPrice, ...(b.plan.paidOn ? { paidOn: b.plan.paidOn } : {}) };
    out[k] = v;
  }
  return out as Patch;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box className="flex flex-col gap-3 p-4 sm:p-5">
      <h2 className="font-body text-[15px] font-bold tracking-normal">{title}</h2>
      {children}
    </Box>
  );
}

function NumField({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: string) => void }) {
  const [text, setText] = useState(String(value));
  return (
    <Field id={id} label={label}>
      <input
        id={id}
        inputMode="numeric"
        className={smallInputCls}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value !== "") onChange(e.target.value);
        }}
        onBlur={() => setText(String(value))}
      />
    </Field>
  );
}
