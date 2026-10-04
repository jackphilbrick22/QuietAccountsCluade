import { useState } from "react";
import { CheckCheck, RefreshCw } from "lucide-react";
import { useApp } from "../store/app";
import { cx, Pill } from "../components/ui";
import { Box, Btn, PageHead, Section, smallInputCls } from "../components/table";
import { api, type PastedText, type TextToSendRow } from "./api";
import { copy, useAction, useLive, type Query } from "./store";
import { ErrorNote, MSG_KIND, when } from "./parts";
import { Blank, inlineTap, ours, Waiting } from "./look";

/**
 * Owner texts by hand (SMS_PROVIDER=manual, until Twilio clears): every client's texts waiting to go, newest first.
 * The operator texts one from his own phone, then marks it sent and it leaves the list.
 */
export function TextsToSend({ list }: { list: Query<TextToSendRow[]> }) {
  const sms = useLive((s) => s.health?.sms);
  const rows = list.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <PageHead
        title="Texts to send"
        sub={`Texts for owners, from every client, newest first. Send each one from your phone, then mark it sent. Texts about money get here once you approve them in Needs a person.${sms && sms !== "manual" ? ` Owner texts go by ${sms} now, so only answers to texts you pasted wait here.` : ""}`}
        actions={
          <Btn onClick={list.reload}>
            <RefreshCw size={15} className={cx(list.loading && "animate-spin")} /> Refresh
          </Btn>
        }
      />
      <ErrorNote error={list.error} onRetry={list.reload} />
      <div className="flex flex-col gap-3">
        {rows.map((t) => (
          <TextRow key={`${t.businessId}-${t.messageId}`} t={t} />
        ))}
        {!rows.length && <Box>{list.loading && !list.data ? <Waiting>Loading…</Waiting> : <Blank icon={CheckCheck} className="py-12">Nothing to send right now.</Blank>}</Box>}
      </div>
    </div>
  );
}

function TextRow({ t }: { t: TextToSendRow }) {
  const go = useApp((s) => s.go);
  const { busy, run } = useAction();
  return (
    <Box className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      {/* the business and the time wrap together, so a line never starts with the dot */}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        <Pill tone={t.kind === "handoff" ? "accent" : "neutral"}>{MSG_KIND[t.kind] ?? t.kind}</Pill>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2">
          <button type="button" onClick={() => go({ area: "live", tab: "client", detail: t.businessId })} className={cx(inlineTap, "cursor-pointer font-semibold text-ink-2 hover:text-ink hover:underline")}>
            {t.businessName}
          </button>
          <span className="whitespace-nowrap">· {when(t.at)}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14.5px]">
        <span>
          To <b>{t.ownerFirstName || "the owner"}</b> at {t.phone ? <span className="num font-semibold tracking-[0.01em]">{t.phone}</span> : <span className="font-semibold text-bad">no cell on file</span>}
        </span>
        {t.phone && (
          <Btn variant="ghost" onClick={() => void copy(t.phone!, "Number copied")}>
            Copy number
          </Btn>
        )}
      </div>
      <pre className={cx(ours, "note-body max-h-72 max-w-[72ch] overflow-auto")}>{t.text}</pre>
      <div className="flex flex-wrap gap-2">
        <Btn onClick={() => void copy(t.text, "Text copied")}>Copy text</Btn>
        <Btn variant="primary" disabled={!!busy} onClick={() => void run("sent", () => api("POST", `/businesses/${encodeURIComponent(t.businessId)}/owner-messages/${encodeURIComponent(t.messageId)}/sent`), "Marked sent")}>
          Sent
        </Btn>
      </div>
    </Box>
  );
}

/** A text the owner sent the operator's phone: read exactly as if it came to our number, and the answer joins the list. */
export function PasteReply({ id }: { id: string }) {
  const [text, setText] = useState("");
  const [last, setLast] = useState<PastedText>();
  const { busy, run } = useAction();
  const field = `paste-${id}`;
  return (
    <Section title="Paste their reply" sub="A text the owner sent your phone (OK, BOOKED 2400 #K7Q, PAUSE, CANCEL...). It does what the same text to our number does, and our answer goes on Texts to send.">
      <Box className="p-3 sm:p-4">
      <form
        className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          void run("paste", () => api<PastedText>("POST", `/businesses/${encodeURIComponent(id)}/owner-texts`, { text }), (r) => (r.queued ? "Read. Our answer is on Texts to send" : "Read. Nothing goes back to their phone")).then((r) => {
            if (!r) return;
            setLast(r);
            setText("");
          });
        }}
      >
        <label htmlFor={field} className="sr-only">
          Their text
        </label>
        <textarea id={field} rows={2} className={cx(smallInputCls, "py-2.5 leading-relaxed sm:flex-1 sm:basis-0")} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste exactly what they texted" />
        <div className="sm:pt-1">
          {/* the gradient once there's a text to read; before that it waits as a plain pill */}
          <Btn type="submit" variant={text.trim() ? "primary" : "secondary"} disabled={!text.trim() || !!busy}>
            Read it
          </Btn>
        </div>
        {last && (
          <p className="text-[13px] text-ink-3 sm:basis-full">
            {last.queued ? "Our answer, on Texts to send:" : `${last.why} Our answer was:`} “{last.reply}”
          </p>
        )}
      </form>
      </Box>
    </Section>
  );
}
