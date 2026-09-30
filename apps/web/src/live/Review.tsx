import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useApp } from "../store/app";
import { cx, Pill } from "../components/ui";
import { Box, Btn, Chip, PageHead } from "../components/table";
import { api, type ReviewItem, type ReviewQueue } from "./api";
import { copy, useAction, useLive, type ClientTab, type Query } from "./store";
import { ErrorNote, IntentPill, MSG_KIND, NoteEditor, OutcomeForm, ReplyActions, when } from "./parts";

type Kind = ReviewItem["kind"];

const KIND: Record<Kind, { label: string; tone: "bad" | "warn" | "info" | "accent" }> = {
  late_lead: { label: "Owner hasn't called", tone: "bad" },
  alert: { label: "Alert", tone: "bad" },
  owner_text: { label: "Owner texted", tone: "accent" },
  owner_message: { label: "Text waiting for you", tone: "accent" },
  unclear: { label: "Unclear reply", tone: "warn" },
  draft: { label: "Answer drafted", tone: "info" },
  ready: { label: "Ready to start", tone: "info" },
  flagged_note: { label: "Flagged note", tone: "warn" },
};
const ORDER: Kind[] = ["late_lead", "alert", "owner_text", "owner_message", "unclear", "draft", "ready", "flagged_note"];

const itemKey = (it: ReviewItem) => `${it.kind}-${it.businessId}-${"replyId" in it ? it.replyId : "touchId" in it ? it.touchId : "messageId" in it ? it.messageId : "seq" in it ? it.seq : ""}`;

/** What we did with an owner's text, in the operator's words. */
const HANDLED: Record<string, string> = {
  accepted_close: "said yes to keep going: send the payment link, then set them to Paying in Settings",
  unrecognized: "wrote something we couldn't act on",
  texts_off: "turned our texts off (STOP)",
  resume_cancelled: "wants back in after cancelling",
};

export function LiveReview({ queue }: { queue: Query<ReviewQueue> }) {
  const [filter, setFilter] = useState<Kind | "all">("all");
  const items = [...(queue.data?.items ?? [])].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.at < b.at ? -1 : 1));
  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);
  const count = (k: Kind) => items.filter((i) => i.kind === k).length;
  return (
    <div className="flex flex-col gap-5">
      <PageHead
        title="Needs a person"
        sub={`Everything across all clients the agents can't finish alone. Hot leads show up here once the owner hasn't called within ${queue.data?.slaHours ?? 4} hours.`}
        actions={
          <Btn onClick={queue.reload}>
            <RefreshCw size={15} className={cx(queue.loading && "animate-spin")} /> Refresh
          </Btn>
        }
      />
      <ErrorNote error={queue.error} onRetry={queue.reload} />
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="toolbar" aria-label="Filter">
        <Chip active={filter === "all"} count={items.length} onClick={() => setFilter("all")}>
          All
        </Chip>
        {ORDER.map((k) => (
          <Chip key={k} active={filter === k} count={count(k)} tone={KIND[k].tone === "bad" ? "bad" : undefined} onClick={() => setFilter(k)}>
            {KIND[k].label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {shown.map((it) => (
          <Item key={itemKey(it)} it={it} />
        ))}
        {!shown.length && <Box className="px-4 py-10 text-center text-[13.5px] text-ink-3">{queue.loading && !queue.data ? "Loading…" : "Nothing needs a person right now."}</Box>}
      </div>
    </div>
  );
}

function Item({ it }: { it: ReviewItem }) {
  const go = useApp((s) => s.go);
  const setTab = useLive((s) => s.setClientTab);
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  const open = (tab: ClientTab) => {
    setTab(tab);
    go({ area: "live", tab: "client", detail: it.businessId });
  };
  const bid = it.businessId;
  return (
    <Box className="flex flex-col gap-2.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        <Pill tone={KIND[it.kind].tone}>{KIND[it.kind].label}</Pill>
        <button type="button" onClick={() => open("overview")} className="cursor-pointer font-semibold text-ink-2 hover:text-ink hover:underline">
          {it.businessName}
        </button>
        <span>· {when(it.at)}</span>
      </div>

      {it.kind === "late_lead" && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[14px]">
            <b>{it.name}</b> asked {it.hours}h ago and hasn't been called <IntentPill intent={it.intent} />
          </div>
          <blockquote className="rounded-md bg-bg px-3 py-2 text-[13px]">“{it.text}”</blockquote>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => void copy(`${it.name} is still waiting on a call — they wrote back ${it.hours} hours ago.${it.phone ? ` ${it.phone}.` : ""} Reply DONE once you've reached them, or BOOKED and the amount.`, "Nudge copied — text it to the owner")}>
              Copy a nudge for the owner
            </Btn>
            <Btn variant="ghost" onClick={() => open("replies")}>
              Open replies
            </Btn>
          </div>
          <OutcomeForm bid={bid} reply={{ id: it.replyId, name: it.name }} compact />
          <ReplyActions bid={bid} reply={{ id: it.replyId, name: it.name }} draft={it.draft} draftNeedsOwner={it.draftNeedsOwner} handedOff />
        </>
      )}

      {it.kind === "unclear" && (
        <>
          <div className="text-[14px]">
            Couldn't tell what <b>{it.name}</b> meant{it.email ? <span className="text-ink-3"> ({it.email})</span> : null}
          </div>
          <blockquote className="note-body rounded-md bg-bg px-3 py-2 text-[13px]">{it.text}</blockquote>
          <p className="text-[12.5px] text-ink-3">Say what they mean (a yes goes straight to the owner, a stop removes them everywhere), answer them yourself, or hand it to the owner as it is.</p>
          <ReplyActions bid={bid} reply={{ id: it.replyId, name: it.name }} draft={it.draft} draftNeedsOwner={it.draftNeedsOwner} />
        </>
      )}

      {it.kind === "draft" && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[14px]">
            <b>{it.name}</b> asked something, and an answer is drafted <IntentPill intent={it.intent} />
          </div>
          <blockquote className="note-body rounded-md bg-bg px-3 py-2 text-[13px]">“{it.text}”</blockquote>
          <ReplyActions bid={bid} reply={{ id: it.replyId, name: it.name }} draft={it.draft} draftNeedsOwner={it.draftNeedsOwner} handedOff />
        </>
      )}

      {it.kind === "owner_text" && (
        <>
          <div className="text-[14px]">
            The owner {HANDLED[it.handled] ?? "texted us"}:
          </div>
          <blockquote className="note-body rounded-md bg-bg px-3 py-2 text-[13px]">“{it.text}”</blockquote>
          <p className="text-[12.5px] text-ink-3">We texted back: {it.reply}</p>
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" disabled={!!busy} onClick={() => void run("done", () => api("POST", `/businesses/${encodeURIComponent(bid)}/owner-texts/${it.seq}/done`), "Marked handled")}>
              Mark handled
            </Btn>
            {it.handled === "accepted_close" && <Btn onClick={() => open("settings")}>Open settings</Btn>}
            <Btn variant="ghost" onClick={() => open("texts")}>
              All their texts
            </Btn>
          </div>
        </>
      )}

      {it.kind === "alert" && (
        <>
          <div className="text-[14px] font-semibold">{it.title}</div>
          {it.detail && <p className="text-[13px] text-ink-2">{it.detail}</p>}
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" disabled={!!busy} onClick={() => void run("done", () => api("POST", `/businesses/${encodeURIComponent(bid)}/alerts/${it.seq}/done`), "Marked handled")}>
              Mark handled
            </Btn>
            <Btn variant="ghost" onClick={() => open("activity")}>
              Open activity
            </Btn>
          </div>
        </>
      )}

      {it.kind === "ready" && (
        <>
          <div className="text-[14px]">
            Jobber is connected and read: {it.quotes.toLocaleString("en-US")} quotes, {it.customers.toLocaleString("en-US")} clients. Nothing is planned yet.
          </div>
          <p className="text-[12.5px] text-ink-3">{it.headline}</p>
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" onClick={() => open("overview")}>
              Look it over and start
            </Btn>
          </div>
        </>
      )}

      {it.kind === "owner_message" && (
        <>
          <div className="text-[14px]">
            <b>{MSG_KIND[it.messageKind] ?? it.messageKind}</b> for the owner is {it.delivery === "failed" ? "failing to send" : "waiting for your OK"}
          </div>
          <pre className="note-body max-h-72 overflow-auto rounded-md border border-line bg-bg px-3 py-2.5 text-[13px] leading-relaxed">{it.text}</pre>
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" disabled={!!busy} onClick={() => void run("send", () => api("POST", `/businesses/${encodeURIComponent(bid)}/owner-messages/${encodeURIComponent(it.messageId)}/send`), "Approved and sent to the owner")}>
              Approve and send
            </Btn>
            <Btn onClick={() => void copy(it.text, "Text copied")}>Copy text</Btn>
          </div>
        </>
      )}

      {it.kind === "flagged_note" && (
        <>
          <div className="text-[14px]">
            Note {it.step} to <b>{it.name || "a customer"}</b> failed a quality check:
          </div>
          <ul className="list-disc pl-5 text-[12.5px] text-warn">
            {it.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {editing ? (
            <NoteEditor bid={bid} touch={{ id: it.touchId, subject: it.subject, body: it.body, status: it.status, flags: it.flags }} onDone={() => setEditing(false)} />
          ) : (
            <>
              <div className="rounded-md border border-line bg-bg px-3 py-2.5">
                <p className="text-[13px] font-bold">{it.subject || "(no subject)"}</p>
                <p className="note-body line-clamp-6 text-[13px] text-ink-2">{it.body}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn onClick={() => setEditing(true)}>Edit the note</Btn>
                <Btn
                  variant="danger"
                  disabled={!!busy}
                  onClick={() => void run("cancel", () => api("PATCH", `/businesses/${encodeURIComponent(bid)}/touches/${encodeURIComponent(it.touchId)}`, { status: "cancelled" }), "Note won't be sent")}
                >
                  Don't send it
                </Btn>
              </div>
            </>
          )}
        </>
      )}
    </Box>
  );
}
