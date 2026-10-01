import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { fmtMoney } from "@qa/engine";
import { useApp } from "../store/app";
import { cx, Pill } from "../components/ui";
import { Box, Btn, Chip, PageHead, selectCls } from "../components/table";
import { api, type Overview, type ReviewItem, type ReviewQueue } from "./api";
import { copy, useAction, useApi, useLive, type ClientTab, type Query } from "./store";
import { ourAnswerLabel, ownerSendToast, type OwnerSendResult } from "./ownerSend";
import { ErrorNote, IntentPill, MSG_KIND, NoteEditor, noteChanged, OutcomeForm, ReplyActions, when } from "./parts";
import { ClearBrake } from "./Client";

type Kind = ReviewItem["kind"];

const KIND: Record<Kind, { label: string; tone: "bad" | "warn" | "info" | "accent" }> = {
  late_lead: { label: "Owner hasn't called", tone: "bad" },
  alert: { label: "Alert", tone: "bad" },
  owner_text: { label: "Owner texted", tone: "accent" },
  owner_message: { label: "Text waiting for you", tone: "accent" },
  charge_ask: { label: "Charge to decide", tone: "bad" },
  charge_due: { label: "Charge to collect", tone: "accent" },
  unclear: { label: "Unclear reply", tone: "warn" },
  draft: { label: "Answer drafted", tone: "info" },
  ready: { label: "Ready to start", tone: "info" },
  flagged_note: { label: "Flagged note", tone: "warn" },
  unmatched_reply: { label: "Whose reply?", tone: "bad" },
  brake: { label: "Send brake on", tone: "bad" },
  unsure_send: { label: "Did it send?", tone: "warn" },
  not_taken: { label: "Platform refused", tone: "warn" },
  platform: { label: "Sending platform", tone: "bad" },
};
const ORDER: Kind[] = ["platform", "unmatched_reply", "brake", "late_lead", "alert", "charge_ask", "owner_text", "owner_message", "charge_due", "unsure_send", "unclear", "draft", "ready", "flagged_note", "not_taken"];

/** Which month a charge is for: "the first month", "the month from Nov 1". */
function monthFor(m: { on: string; first: boolean }): string {
  return m.first ? "the first month" : `the month from ${when(m.on)}`;
}

/** An owner's UNDO a person finishes with Restore plan: a refund set up, the platform down, or an inbox another client has now. */
const RESTORE = ["undo_refund", "undo_platform", "undo_inbox"];

const itemKey = (it: ReviewItem) =>
  `${it.kind}-${it.businessId}-${"replyId" in it ? it.replyId : "touchId" in it ? it.touchId : "messageId" in it ? it.messageId : "chargeId" in it ? it.chargeId : "seq" in it ? it.seq : "id" in it ? it.id : ""}`;

/** What we did with an owner's text, in the operator's words. */
const HANDLED: Record<string, string> = {
  accepted_close: "said yes to keep going: the first month's text with its link waits for your OK, and paid, they're Paying from that day",
  accepted_by_hand: "said yes to keep going, with the yearly plan sold: no first month's text was made. Send the payment link for the plan they want (ask if they didn't say), then set the plan and its first paid day in Settings once it's paid",
  renew_year: "renewed for another year: send the payment link before it starts (take the year off in Settings if it's never paid)",
  renew_year_pay_first: "wants the year: send the payment link, then set Yearly and the first paid day in Settings once it's paid",
  renew_monthly: "switched to month to month: charge the monthly price from the day in their activity",
  monthly_already: "texted MONTHLY while their plan is paused",
  resume_plan_paused: "texted RESUME, but their plan itself is paused (a year that ran out, or set to Paused in Settings)",
  unrecognized: "wrote something we couldn't act on",
  texts_off: "turned our texts off (STOP)",
  resume_cancelled: "wants back in after cancelling",
  resume_done: "texted RESUME after their one pass was done",
  pass_monthly: "wants to keep going after the one pass: the first month's text waits for your OK, and paid, they're on the monthly plan from that day",
  pass_year: "wants a year after the one pass: no first month's text was made. Set up the plan in Settings and text them how it works",
  pass_end_no: "answered the end of their one pass with a no (or it's about a lead: it was left alone)",
  not_ours: "texted NOT OURS for a lead with no charge yet: its bookings are off the ledger, so it's never charged",
  not_ours_unknown: "texted NOT OURS with a code we can't find",
  not_ours_which: "texted NOT OURS with a code more than one of their businesses has",
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

/**
 * A reply nobody could place (a spouse's or work address, no thread): any client can be picked, not only the
 * candidates, from the same clients list the console loads. The server reads it there like any reply.
 */
function AssignReply({ id, skip, other }: { id: string; skip: string[]; other: boolean }) {
  const clients = useApi<Overview[]>("/businesses");
  const { busy, run } = useAction();
  const [bid, setBid] = useState("");
  const options = (clients.data ?? []).map((o) => o.business).filter((b) => !skip.includes(b.id)).sort((a, b) => a.name.localeCompare(b.name));
  const pick = options.find((b) => b.id === bid);
  const selectId = `assign-${id}`;
  if (!options.length) return clients.loading ? null : <p className="text-[12.5px] text-ink-3">No other client to give it to.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={selectId} className="text-[12.5px] font-semibold text-ink-3">
        {other ? "Or another client:" : "Whose is it?"}
      </label>
      <select id={selectId} value={bid} onChange={(e) => setBid(e.target.value)} className={cx(selectCls, "min-w-0 max-w-full")}>
        <option value="">Pick a client…</option>
        {options.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <Btn disabled={!pick || !!busy} onClick={() => pick && void run("assign", () => api("POST", `/inbound-review/${encodeURIComponent(id)}`, { businessId: pick.id }), `Sent to ${pick.name}`)}>
        Read it as theirs
      </Btn>
    </div>
  );
}

function Item({ it }: { it: ReviewItem }) {
  const go = useApp((s) => s.go);
  const setTab = useLive((s) => s.setClientTab);
  const sms = useLive((s) => s.health?.sms);
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
        {bid ? (
          <button type="button" onClick={() => open("overview")} className="cursor-pointer font-semibold text-ink-2 hover:text-ink hover:underline">
            {it.businessName}
          </button>
        ) : (
          it.businessName && <span className="font-semibold text-ink-2">{it.businessName}</span>
        )}
        <span>· {when(it.at)}</span>
      </div>

      {it.kind === "unmatched_reply" && (
        <>
          <div className="text-[14px]">
            <b>{it.from}</b> wrote{it.subject ? <span className="text-ink-3"> — “{it.subject}”</span> : null}
          </div>
          <blockquote className="note-body rounded-md bg-bg px-3 py-2 text-[13px]">{it.text}</blockquote>
          <p className="text-[12.5px] text-ink-3">{it.reason} Nothing was sent and no owner was texted. Pick the client it belongs to and it's read there, like any reply.</p>
          <div className="flex flex-wrap gap-2">
            {it.candidates.map((c) => (
              <Btn key={c.businessId} disabled={!!busy} onClick={() => void run("assign", () => api("POST", `/inbound-review/${encodeURIComponent(it.id)}`, { businessId: c.businessId }), `Sent to ${c.businessName}`)}>
                It's {c.businessName}'s
              </Btn>
            ))}
            <Btn variant="ghost" disabled={!!busy} onClick={() => void run("dismiss", () => api("POST", `/inbound-review/${encodeURIComponent(it.id)}`, { dismiss: true }), "Dropped")}>
              Not ours — drop it
            </Btn>
          </div>
          <AssignReply id={it.id} skip={it.candidates.map((c) => c.businessId)} other={it.candidates.length > 0} />
        </>
      )}

      {it.kind === "brake" && (
        <>
          <div className="text-[14px]">
            Nothing goes out: {it.reason} <span className="text-ink-3">({it.queued.toLocaleString("en-US")} notes waiting)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <ClearBrake id={bid} />
            <Btn variant="ghost" onClick={() => open("overview")}>
              Open the client
            </Btn>
          </div>
        </>
      )}

      {it.kind === "unsure_send" && (
        <>
          <div className="text-[14px]">
            Note {it.step} to <b>{it.name || "a customer"}</b> may or may not have gone <span className="text-ink-3">— “{it.subject}”</span>
          </div>
          <p className="text-[12.5px] text-ink-3">{it.error} Check the sending mailbox's Sent folder before sending it again.</p>
          <div className="flex flex-wrap gap-2">
            <Btn disabled={!!busy} onClick={() => void run("sent", () => api("PATCH", `/businesses/${encodeURIComponent(bid)}/touches/${encodeURIComponent(it.touchId)}`, { status: "sent" }), "Marked sent")}>
              It went
            </Btn>
            <Btn disabled={!!busy} onClick={() => void run("again", () => api("PATCH", `/businesses/${encodeURIComponent(bid)}/touches/${encodeURIComponent(it.touchId)}`, { status: "approved" }), "It'll go on the next send")}>
              It didn't — send it
            </Btn>
            <Btn variant="danger" disabled={!!busy} onClick={() => void run("drop", () => api<{ alsoStopped?: number }>("PATCH", `/businesses/${encodeURIComponent(bid)}/touches/${encodeURIComponent(it.touchId)}`, { status: "cancelled" }), noteChanged("Won't be sent"))}>
              Don't send it
            </Btn>
          </div>
        </>
      )}

      {it.kind === "not_taken" && (
        <div className="text-[14px]">
          The sending platform wouldn't take <b>{it.name || "a customer"}</b>: <span className="text-ink-2">{it.reason}</span>. Their notes were skipped.
        </div>
      )}

      {it.kind === "platform" && (
        <>
          <div className="text-[14px] font-semibold">{it.title}</div>
          <p className="text-[12.5px] text-ink-3">{it.detail} We retry every 15 minutes; the reply check still reads the inbox meanwhile.</p>
        </>
      )}

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
          <p className="text-[12.5px] text-ink-3">
            {ourAnswerLabel(sms, it.handled)}: {it.reply}
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" disabled={!!busy} onClick={() => void run("done", () => api("POST", `/businesses/${encodeURIComponent(bid)}/owner-texts/${it.seq}/done`), "Marked handled")}>
              Mark handled
            </Btn>
            {["accepted_close", "accepted_by_hand", "renew_year", "renew_year_pay_first", "renew_monthly", "monthly_already", "resume_plan_paused", "pass_monthly", "pass_year"].includes(it.handled ?? "") && <Btn onClick={() => open("settings")}>Open settings</Btn>}
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
            {RESTORE.includes(it.alertKind ?? "") && (
              <Btn
                variant="primary"
                disabled={!!busy}
                onClick={() =>
                  void run(
                    "restore",
                    async () => {
                      await api("POST", `/businesses/${encodeURIComponent(bid)}/restore-plan`);
                      await api("POST", `/businesses/${encodeURIComponent(bid)}/alerts/${it.seq}/done`);
                    },
                    "Plan restored; the refund text was withdrawn. Text them it's back on.",
                  )
                }
              >
                Restore plan
              </Btn>
            )}
            <Btn variant={RESTORE.includes(it.alertKind ?? "") ? "ghost" : "primary"} disabled={!!busy} onClick={() => void run("done", () => api("POST", `/businesses/${encodeURIComponent(bid)}/alerts/${it.seq}/done`), "Marked handled")}>
              Mark handled
            </Btn>
            {/* a one pass that can't finish on time: its inboxes and end date are in Settings */}
            {it.alertKind === "pace" && <Btn onClick={() => open("settings")}>Open settings</Btn>}
            <Btn variant="ghost" onClick={() => open("activity")}>
              Open activity
            </Btn>
          </div>
        </>
      )}

      {it.kind === "ready" && (
        <>
          <div className="text-[14px]">
            {it.from === "file" ? "Their file is in" : "Jobber is connected and read"}: {it.quotes.toLocaleString("en-US")} quotes, {it.customers.toLocaleString("en-US")} clients. Nothing is planned yet.
          </div>
          <p className="text-[12.5px] text-ink-3">{it.headline}</p>
          {it.needsAddress && <p className="text-[12.5px] font-semibold text-warn">Add their mailing address before you plan: it goes at the bottom of every note.</p>}
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
            <Btn variant="primary" disabled={!!busy} onClick={() => void run("send", () => api<OwnerSendResult>("POST", `/businesses/${encodeURIComponent(bid)}/owner-messages/${encodeURIComponent(it.messageId)}/send`), ownerSendToast)}>
              Approve and send
            </Btn>
            <Btn onClick={() => void copy(it.text, "Text copied")}>Copy text</Btn>
          </div>
        </>
      )}

      {it.kind === "charge_ask" && (
        <>
          <div className="text-[14px]">
            {it.ask === "not_ours" && !it.month ? (
              <>
                The owner says <b>{it.name}</b> (#{it.code}) wasn't ours, and its {fmtMoney(it.amount)} is {it.status === "paid" ? "charged" : "going through"}
              </>
            ) : it.month ? (
              <>
                {it.ask === "paid_twice" ? "The" : "Refund the"} {fmtMoney(it.amount)} for <b>{monthFor(it.month)}</b>
                {it.ask === "paid_twice" ? " was paid twice" : "?"}
              </>
            ) : it.ask === "paid_twice" ? (
              <>
                <b>{it.name}</b>'s {fmtMoney(it.amount)} (#{it.code}) was paid twice
              </>
            ) : (
              <>
                Refund <b>{it.name}</b>'s {fmtMoney(it.amount)} (#{it.code})?
              </>
            )}
          </div>
          <p className="text-[12.5px] text-ink-3">
            {it.ask === "paid_twice"
              ? `${it.why}. Refund it sends the second payment back through Stripe, and the owner's text waits for your OK; the ${it.month ? "month" : "booking"} stays paid. Keep it once you've sorted it with him yourself.`
              : `${it.why}. ${it.refundBy === "stripe" ? "Refund it sends it back through Stripe" : "Refund it in Stripe yourself, then say so here"}: ${it.month ? "" : "its place under the cap opens up again, and "}the owner's text waits for your OK. Keep it and it stays charged.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" disabled={!!busy || it.status === "charging"} onClick={() => void run("refund", () => api<{ done: string }>("POST", `/businesses/${encodeURIComponent(bid)}/charges/${encodeURIComponent(it.chargeId)}/decide`, { refund: true }), (r) => (r.done === "refunded" ? "Refunded. The text to the owner waits for your OK" : "Cancelled: it was never charged"))}>
              {it.refundBy === "stripe" ? "Refund it" : "I refunded it"}
            </Btn>
            <Btn disabled={!!busy || it.status === "charging"} onClick={() => void run("keep", () => api("POST", `/businesses/${encodeURIComponent(bid)}/charges/${encodeURIComponent(it.chargeId)}/decide`, { refund: false }), "Kept")}>
              Keep it
            </Btn>
          </div>
        </>
      )}

      {it.kind === "charge_due" && (
        <>
          <div className="text-[14px]">
            {it.via === "link" ? `Send the ${fmtMoney(it.amount)} link` : "Charge his saved card"}:{" "}
            {it.month ? (
              <b>{monthFor(it.month)}</b>
            ) : (
              <>
                <b>{it.name}</b> booked (#{it.code})
              </>
            )}
          </div>
          <p className="text-[12.5px] text-ink-3">
            {it.via === "link" ? `Text the owner your Stripe payment link for ${fmtMoney(it.amount)} (one that saves his card), and press Done once it's paid.` : `Charge ${fmtMoney(it.amount)} in Stripe on the card ${it.last4 ? `ending ${it.last4}` : "his link saved"}, then press Done.`}
            {it.month?.first ? " Paid, he's on the monthly plan from that day: paste his Stripe customer on the client's page so later months go on that card." : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" disabled={!!busy} onClick={() => void run("paid", () => api("POST", `/businesses/${encodeURIComponent(bid)}/charges/paid`, { chargeId: it.chargeId }), "Marked paid")}>
              Done: it's paid
            </Btn>
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
                  onClick={() => void run("cancel", () => api<{ alsoStopped?: number }>("PATCH", `/businesses/${encodeURIComponent(bid)}/touches/${encodeURIComponent(it.touchId)}`, { status: "cancelled" }), noteChanged("Note won't be sent"))}
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
