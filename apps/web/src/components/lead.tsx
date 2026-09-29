import { useState } from "react";
import { Phone, CalendarCheck, MessageSquareQuote, Clock3, Mail } from "lucide-react";
import { BREAKAGE_LABEL, fmtMoney, fmtPhone, spokenWhen, type AccountState, type Reply } from "@qa/engine";
import { useApp } from "../store/app";
import { derive, initials, relTime } from "../lib/derive";
import { Button, Card, cx, Field, inputCls, Pill, Sheet } from "./ui";

const INTENT: Record<string, { label: string; tone: "ok" | "accent" | "info" | "warn" | "neutral" | "bad" }> = {
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

export function intentPill(r: Reply) {
  const i = INTENT[r.intent] ?? { label: r.intent, tone: "neutral" as const };
  return <Pill tone={i.tone}>{i.label}</Pill>;
}

export function LeadCard({ a, r, rev, accountId, compact }: { a: AccountState; r: Reply; rev: number; accountId: string; compact?: boolean }) {
  const d = derive(a, rev);
  const c = r.customerId ? d.customers.get(r.customerId) : undefined;
  const o = r.opportunityId ? d.opps.get(r.opportunityId) : undefined;
  const [sheet, setSheet] = useState<"book" | "thread" | null>(null);
  const phone = r.extracted.phone ?? c?.phones[0];
  const waitH = (Date.parse(`${a.dataset.asOf}T18:00:00`) - Date.parse(r.receivedAt)) / 3600000;
  const waiting = !r.ownerContactedAt && r.status !== "done";
  return (
    <Card className={cx("flex flex-col gap-3 p-4 sm:p-5", waiting && waitH > 24 && "border-bad/40")}>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft font-display text-[15px] font-bold text-accent-ink">{initials(c?.name ?? r.from)}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-[17px] font-bold">{c?.name ?? r.from}</span>
            {intentPill(r)}
            {r.outcome === "booked" && <Pill tone="ok">Booked {r.outcomeValue ? fmtMoney(r.outcomeValue) : ""}</Pill>}
          </div>
          <span className="truncate text-[13px] text-ink-3">
            {c?.address?.street ? `${c.address.street}${c.address.city ? `, ${c.address.city}` : ""}` : c?.emails[0]}
          </span>
        </div>
        {waiting && (
          <Pill tone={waitH > 24 ? "bad" : waitH > 4 ? "warn" : "neutral"}>
            <Clock3 size={12} /> {relTime(r.receivedAt, a.dataset.asOf)}
          </Pill>
        )}
      </div>

      <blockquote className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[15px] leading-snug">“{r.text.length > 240 ? r.text.slice(0, 239) + "…" : r.text}”</blockquote>

      {!compact && o && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
          <span>
            <b className="font-semibold text-ink">{o.jobPhrase.replace(/^the /, "").replace(/^./, (x) => x.toUpperCase())}</b>
            {o.value ? ` · ${fmtMoney(o.value)}` : ""}
          </span>
          <span>{BREAKAGE_LABEL[o.type].short}{o.anchorDate ? ` · ${spokenWhen(o.anchorDate, a.dataset.asOf).replace(/^back in /, "")}` : ""}</span>
          {r.extracted.bestTime && <span>Best time: {r.extracted.bestTime}</span>}
        </div>
      )}

      {waiting ? (
        <div className="flex flex-wrap items-center gap-2">
          {phone ? (
            <a href={`tel:${phone}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 font-bold text-on-accent hover:bg-accent-deep">
              <Phone size={17} /> <span className="num">{fmtPhone(phone)}</span>
            </a>
          ) : (
            <span className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-surface-2 px-4 font-semibold text-ink-2">
              <Mail size={16} /> {c?.emails[0] ?? r.from}
            </span>
          )}
          <Button variant="secondary" onClick={() => setSheet("book")}>
            <CalendarCheck size={17} /> Log the call
          </Button>
          <Button variant="ghost" onClick={() => setSheet("thread")}>
            <MessageSquareQuote size={17} /> See notes
          </Button>
        </div>
      ) : (
        !compact && (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSheet("thread")}>
              <MessageSquareQuote size={15} /> See notes
            </Button>
          </div>
        )
      )}

      <BookSheet open={sheet === "book"} onClose={() => setSheet(null)} a={a} r={r} accountId={accountId} suggested={o?.value} />
      <ThreadSheet open={sheet === "thread"} onClose={() => setSheet(null)} a={a} r={r} rev={rev} />
    </Card>
  );
}

function BookSheet({ open, onClose, a, r, accountId, suggested }: { open: boolean; onClose: () => void; a: AccountState; r: Reply; accountId: string; suggested?: number }) {
  const logOutcome = useApp((s) => s.logOutcome);
  const toast = useApp((s) => s.toast);
  const [amount, setAmount] = useState(suggested ? String(Math.round(suggested)) : "");
  const name = a.dataset.customers.find((c) => c.id === r.customerId)?.name ?? r.from;
  const done = (outcome: Reply["outcome"], value?: number) => {
    logOutcome(accountId, r.id, outcome, value);
    toast(outcome === "booked" ? `Booked ${name}${value ? ` — ${fmtMoney(value)}` : ""}` : "Logged. Thanks.");
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={`How did it go with ${name}?`}>
      <div className="flex flex-col gap-4">
        <Field id={`amt-${r.id}`} label="Booked it? What's the job worth?" hint="This is how your results get counted. Use the price you agreed on.">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3">$</span>
            <input id={`amt-${r.id}`} inputMode="numeric" className={cx(inputCls, "pl-7")} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} />
          </div>
        </Field>
        <Button size="lg" onClick={() => done("booked", Number(amount) || undefined)} disabled={!Number(amount)}>
          <CalendarCheck size={18} /> Booked it
        </Button>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" onClick={() => done("quoted")}>
            Sent a price
          </Button>
          <Button variant="secondary" onClick={() => done("no_answer")}>
            No answer
          </Button>
          <Button variant="secondary" onClick={() => done("lost")}>
            Not a fit
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function ThreadSheet({ open, onClose, a, r, rev }: { open: boolean; onClose: () => void; a: AccountState; r: Reply; rev: number }) {
  const d = derive(a, rev);
  const notes = (r.customerId ? d.touchesByCustomer.get(r.customerId) ?? [] : []).filter((t) => t.status === "sent").sort((x, y) => (x.dueAt < y.dueAt ? -1 : 1));
  const name = a.dataset.customers.find((c) => c.id === r.customerId)?.name ?? r.from;
  return (
    <Sheet open={open} onClose={onClose} title={`Notes with ${name}`} wide>
      <div className="flex flex-col gap-3">
        {notes.map((t) => (
          <div key={t.id} className="flex flex-col gap-1 rounded-2xl border border-line p-4">
            <span className="text-[12px] font-semibold text-ink-3">
              Note {t.step} · sent {new Date(t.sentAt ?? t.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · “{t.subject}”
            </span>
            <p className="note-body text-[14.5px]">{t.body.split('\n\nReply "stop"')[0]}</p>
          </div>
        ))}
        <div className="ml-6 flex flex-col gap-1 rounded-2xl bg-accent-soft p-4">
          <span className="text-[12px] font-semibold text-accent-ink">
            {name} replied · {new Date(r.receivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
          <p className="note-body text-[14.5px]">{r.text}</p>
        </div>
      </div>
    </Sheet>
  );
}
