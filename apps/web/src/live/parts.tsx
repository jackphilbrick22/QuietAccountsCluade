/** Pieces shared by the live console screens. */
import { useMemo, useState } from "react";
import { AlertOctagon, Copy, PlusCircle, Sparkles } from "lucide-react";
import { fmtMoney, type Readiness, type Reply } from "@qa/engine";
import { cx, Pill } from "../components/ui";
import { Box, Btn, selectCls, smallInputCls } from "../components/table";
import { api, type Person } from "./api";
import { copy, useAction, useApi } from "./store";

/* ------------------------------ names for ids ------------------------------ */

export function usePeople(bid: string | undefined, ids: (string | undefined)[]): Map<string, Person> {
  const key = useMemo(() => [...new Set(ids.filter((x): x is string => !!x))].sort().slice(0, 300).join(","), [ids]);
  const q = useApi<Person[]>(bid && key ? `/businesses/${encodeURIComponent(bid)}/people?ids=${encodeURIComponent(key)}` : null);
  return useMemo(() => new Map((q.data ?? []).map((p) => [p.id, p])), [q.data]);
}

/* ------------------------------ readiness ------------------------------ */

const LEVEL: Record<"blocker" | "unlocks" | "sharpen", { label: string; tone: "bad" | "accent" | "neutral"; icon: typeof AlertOctagon }> = {
  blocker: { label: "Can't start without", tone: "bad", icon: AlertOctagon },
  unlocks: { label: "Finds more money", tone: "accent", icon: PlusCircle },
  sharpen: { label: "Sharpens the numbers", tone: "neutral", icon: Sparkles },
};

/** "What to ask the owner for next": the operator's to-do list for this client's data. */
export function ReadinessPanel({ r, ownerFirst }: { r?: Readiness; ownerFirst?: string }) {
  if (!r) return null;
  const order = { blocker: 0, unlocks: 1, sharpen: 2 } as const;
  const gaps = [...r.gaps].sort((a, b) => order[a.level] - order[b.level]);
  const ask = gaps.length
    ? `${ownerFirst ? `${ownerFirst}, ` : ""}could you send us:\n${gaps
        .filter((g) => g.level !== "sharpen")
        .concat(gaps.filter((g) => g.level === "sharpen"))
        .map((g) => `• ${g.ask}${g.where ? ` (${g.where})` : ""}`)
        .join("\n")}\nJust forward the export emails to us. Thanks.`
    : "";
  return (
    <Box className={cx("flex flex-col gap-3 p-4", !r.ready && "border-bad/40")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
            What to ask the owner for next
            <Pill tone={r.ready ? "ok" : "bad"}>{r.ready ? "Ready to send" : "Not ready yet"}</Pill>
          </span>
          <span className="text-[13.5px] text-ink-2">{r.headline}</span>
        </div>
        {gaps.length > 0 && (
          <Btn onClick={() => void copy(ask, "Ask copied — text it to the owner")}>
            <Copy size={15} /> Copy the ask
          </Btn>
        )}
      </div>
      {gaps.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {gaps.map((g) => {
            const L = LEVEL[g.level];
            return (
              <li key={g.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
                <span className="shrink-0 sm:w-52">
                  <Pill tone={L.tone}>
                    <L.icon size={12} /> {L.label}
                  </Pill>
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13.5px] font-semibold">{g.ask}</span>
                  <span className="text-[12.5px] text-ink-2">{g.unlocks}</span>
                  {g.where && <span className="text-[12px] text-ink-3">Where: {g.where}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-3">Nothing missing. We have everything we need from the owner.</p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
        <span>
          Quotes <b className="num text-ink">{r.have.quote.toLocaleString("en-US")}</b>
        </span>
        <span>
          Clients <b className="num text-ink">{r.have.client.toLocaleString("en-US")}</b>
        </span>
        <span>
          Jobs <b className="num text-ink">{r.have.job.toLocaleString("en-US")}</b>
        </span>
        <span>
          Invoices <b className="num text-ink">{r.have.invoice.toLocaleString("en-US")}</b>
        </span>
        <span>
          Requests <b className="num text-ink">{r.have.request.toLocaleString("en-US")}</b>
        </span>
        <span>
          History <b className="num text-ink">{r.monthsOfHistory} mo</b>
        </span>
        <span>
          With email <b className="num text-ink">{Math.round(r.emailShare * 100)}%</b>
        </span>
      </div>
    </Box>
  );
}

/* ------------------------------ log an outcome ------------------------------ */

export function OutcomeForm({ bid, reply, suggested, compact }: { bid: string; reply: Pick<Reply, "id"> & { name?: string }; suggested?: number; compact?: boolean }) {
  const { busy, run } = useAction();
  const [amount, setAmount] = useState(suggested ? String(Math.round(suggested)) : "");
  const post = (outcome: Reply["outcome"], value?: number) =>
    run(outcome ?? "x", () => api("POST", `/businesses/${encodeURIComponent(bid)}/replies/${encodeURIComponent(reply.id)}/outcome`, { outcome, value }), outcome === "booked" ? `Booked${reply.name ? ` ${reply.name}` : ""}${value ? `: ${fmtMoney(value)}` : ""}` : "Logged");
  const id = `amt-${reply.id}`;
  return (
    <div className={cx("flex flex-wrap items-end gap-2", compact && "gap-1.5")}>
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-[12px] font-semibold text-ink-3">
          Booked for
        </label>
        <div className="relative w-28">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px] text-ink-3">$</span>
          <input id={id} inputMode="numeric" className={cx(smallInputCls, "pl-6")} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} />
        </div>
      </div>
      <Btn variant="primary" disabled={!Number(amount) || !!busy} onClick={() => void post("booked", Number(amount))}>
        Booked it
      </Btn>
      <Btn disabled={!!busy} onClick={() => void post("quoted")}>
        Sent a price
      </Btn>
      <Btn disabled={!!busy} onClick={() => void post("no_answer")}>
        No answer
      </Btn>
      <Btn disabled={!!busy} onClick={() => void post("lost")}>
        Not a fit
      </Btn>
    </div>
  );
}

/* ------------------------------ act on a reply ------------------------------ */

const RELABEL: { value: string; label: string; done: string }[] = [
  { value: "wants_it", label: "Wants it done", done: "Marked a yes — texted to the owner" },
  { value: "wants_price", label: "Wants a price", done: "Marked wants a price — texted to the owner" },
  { value: "question", label: "Has a question", done: "Marked a question — texted to the owner" },
  { value: "later", label: "Later", done: "Marked later" },
  { value: "already_done", label: "Already had it done", done: "Marked already done" },
  { value: "not_interested", label: "No thanks", done: "Marked no thanks" },
  { value: "moved", label: "Moved", done: "Marked moved" },
  { value: "wrong_person", label: "Wrong person", done: "Marked wrong person" },
  { value: "stop", label: "Stop: remove everywhere", done: "Removed everywhere" },
  { value: "auto_reply", label: "Auto-reply (keep going)", done: "Marked an auto-reply" },
];

/**
 * What a person can do with a reply the agents couldn't finish: send the drafted answer (or their own) in the
 * homeowner's thread, say what the reply means (a yes goes to the owner, a stop removes them everywhere), or
 * hand it to the owner as it is.
 */
export function ReplyActions({ bid, reply, draft, draftNeedsOwner, handedOff }: { bid: string; reply: { id: string; name?: string }; draft?: string; draftNeedsOwner?: boolean; handedOff?: boolean }) {
  const { busy, run } = useAction();
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [intent, setIntent] = useState("");
  const base = `/businesses/${encodeURIComponent(bid)}/replies/${encodeURIComponent(reply.id)}`;
  const who = reply.name ?? "them";
  return (
    <div className="flex flex-col gap-2.5">
      {draft && !writing && (
        <div className="flex flex-col gap-1.5 rounded-md border border-line bg-bg px-3 py-2.5">
          <span className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-ink-3">
            <Sparkles size={13} /> Drafted answer, not sent {draftNeedsOwner && <Pill tone="warn">Check with the owner first</Pill>}
          </span>
          <p className="note-body text-[13px]">{draft}</p>
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" disabled={!!busy} onClick={() => void run("draft", () => api("POST", `${base}/answer`, { useDraft: true }), `Sent to ${who} in their thread`)}>
              Send as-is
            </Btn>
            <Btn
              disabled={!!busy}
              onClick={() => {
                setText(draft);
                setWriting(true);
              }}
            >
              Edit, then send
            </Btn>
            <Btn variant="ghost" disabled={!!busy} onClick={() => void run("discard", () => api("DELETE", `${base}/draft`), "Draft dropped")}>
              Drop it
            </Btn>
          </div>
        </div>
      )}
      {writing ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`ans-${reply.id}`} className="text-[12px] font-semibold text-ink-3">
            Your answer to {who} (goes in their email thread)
          </label>
          <textarea id={`ans-${reply.id}`} rows={4} className={cx(smallInputCls, "py-2 leading-relaxed")} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" disabled={!text.trim() || !!busy} onClick={() => void run("answer", () => api("POST", `${base}/answer`, { text }), `Sent to ${who} in their thread`).then((r) => r && setWriting(false))}>
              Send
            </Btn>
            <Btn variant="ghost" onClick={() => setWriting(false)}>
              Cancel
            </Btn>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Btn
            onClick={() => {
              setText("");
              setWriting(true);
            }}
          >
            Write an answer
          </Btn>
          <Btn disabled={!!busy} onClick={() => void run("handoff", () => api("POST", `${base}/handoff`), handedOff ? "Texted to the owner again" : "Texted to the owner")}>
            {handedOff ? "Text it to the owner again" : "Hand it to the owner"}
          </Btn>
          <div className="flex items-end gap-1.5">
            <div className="flex flex-col gap-1">
              <label htmlFor={`int-${reply.id}`} className="text-[12px] font-semibold text-ink-3">
                What they mean
              </label>
              <select id={`int-${reply.id}`} className={selectCls} value={intent} onChange={(e) => setIntent(e.target.value)}>
                <option value="">Choose…</option>
                {RELABEL.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </div>
            <Btn disabled={!intent || !!busy} onClick={() => void run("intent", () => api("POST", `${base}/intent`, { intent }), RELABEL.find((x) => x.value === intent)?.done)}>
              Save
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ edit a note ------------------------------ */

export function NoteEditor({ bid, touch, onDone }: { bid: string; touch: { id: string; subject?: string; body: string; status: string; flags: string[] }; onDone?: () => void }) {
  const { busy, run } = useAction();
  const [subject, setSubject] = useState(touch.subject ?? "");
  const [body, setBody] = useState(touch.body);
  const sent = touch.status === "sent" || touch.status === "delivered";
  const patch = (b: Record<string, unknown>, msg: string) => run("save", () => api<{ ok: boolean }>("PATCH", `/businesses/${encodeURIComponent(bid)}/touches/${encodeURIComponent(touch.id)}`, b), (r) => (r.ok ? msg : "That note has already gone out.")).then((r) => r?.ok && onDone?.());
  const changed = subject !== (touch.subject ?? "") || body !== touch.body;
  return (
    <div className="flex flex-col gap-2">
      {touch.flags.length > 0 && (
        <ul className="list-disc pl-5 text-[12.5px] text-warn">
          {touch.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      <label htmlFor={`subj-${touch.id}`} className="text-[12px] font-semibold text-ink-3">
        Subject
      </label>
      <input id={`subj-${touch.id}`} className={smallInputCls} value={subject} disabled={sent} maxLength={120} onChange={(e) => setSubject(e.target.value)} />
      <label htmlFor={`body-${touch.id}`} className="text-[12px] font-semibold text-ink-3">
        Note
      </label>
      <textarea id={`body-${touch.id}`} rows={9} className={cx(smallInputCls, "py-2 leading-relaxed")} value={body} disabled={sent} onChange={(e) => setBody(e.target.value)} />
      {sent ? (
        <p className="text-[12.5px] text-ink-3">This note has gone out and can't be changed.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" disabled={!changed || !!busy || body.trim().length < 20 || !subject.trim()} onClick={() => void patch({ subject: subject.trim(), body }, "Note saved and re-checked")}>
            Save changes
          </Btn>
          {touch.status !== "approved" && (
            <Btn disabled={!!busy} onClick={() => void patch({ status: "approved" }, "Approved: it'll go out on schedule")}>
              Approve
            </Btn>
          )}
          {touch.status === "approved" && (
            <Btn disabled={!!busy} onClick={() => void patch({ status: "planned" }, "Held for review")}>
              Hold
            </Btn>
          )}
          {touch.status !== "cancelled" && (
            <Btn variant="danger" disabled={!!busy} onClick={() => void patch({ status: "cancelled" }, "Note cancelled")}>
              Don't send
            </Btn>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ labels ------------------------------ */

export const INTENT_LABEL: Record<string, { label: string; tone: "ok" | "accent" | "info" | "warn" | "neutral" | "bad" }> = {
  wants_it: { label: "Wants it done", tone: "ok" },
  wants_price: { label: "Wants a price", tone: "accent" },
  question: { label: "Has a question", tone: "info" },
  later: { label: "Later", tone: "warn" },
  already_done: { label: "Already done", tone: "neutral" },
  not_interested: { label: "No thanks", tone: "neutral" },
  moved: { label: "Moved", tone: "neutral" },
  wrong_person: { label: "Wrong person", tone: "neutral" },
  stop: { label: "Stopped", tone: "bad" },
  complaint: { label: "Unhappy", tone: "bad" },
  unclear: { label: "Needs a read", tone: "warn" },
  auto_reply: { label: "Auto-reply", tone: "neutral" },
  bounce: { label: "Bad address", tone: "neutral" },
};

export function IntentPill({ intent }: { intent: string }) {
  const i = INTENT_LABEL[intent] ?? { label: intent.replace(/_/g, " "), tone: "neutral" as const };
  return <Pill tone={i.tone}>{i.label}</Pill>;
}

export const OUTCOME_LABEL: Record<string, string> = { booked: "Booked", quoted: "Sent a price", lost: "Not a fit", no_answer: "No answer" };

export const MSG_KIND: Record<string, string> = {
  handoff: "Ready Text",
  sla_nudge: "Reminder",
  weekly: "Friday report",
  close: "Free round results",
  precharge: "Before a charge",
  free_month: "Free month",
  kickoff: "Welcome text",
  renewal: "Year renewal",
  refund: "Yearly refund (issue it, then send)",
  info: "Heads up",
};

export const DELIVERY: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" | "info" }> = {
  sent: { label: "Sent", tone: "ok" },
  pending: { label: "Sending", tone: "info" },
  review: { label: "Waiting for you", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Not needed", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
};

export function when(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: iso.length > 10 ? "numeric" : undefined, minute: iso.length > 10 ? "2-digit" : undefined });
}

/** Human "3h ago" against the real clock. */
export function ago(iso: string | undefined | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ErrorNote({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <Box className="flex flex-wrap items-center justify-between gap-2 border-bad/40 px-4 py-3 text-[13.5px] text-bad" >
      <span>{error}</span>
      {onRetry && <Btn onClick={onRetry}>Try again</Btn>}
    </Box>
  );
}
