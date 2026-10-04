import { useMemo, useState } from "react";
import { ArrowLeft, Inbox, MessageSquareText } from "lucide-react";
import { type Reply, type ReplyIntent } from "@qa/engine";
import { useApp, useAccount } from "../../store/app";
import { derive, relTime } from "../../lib/derive";
import { cx } from "../../components/ui";
import { intentPill, LeadCard } from "../../components/lead";
import { Box, Btn, Chip, PageHead, SearchBox, hoursBetween } from "../../components/table";
import { chipRow } from "../../live/look";
import { EmptyNote } from "./parts";

type Filter = "hot" | "handled" | "later" | "closed" | "review";

const FILTERS: { id: Filter; label: string; empty: string }[] = [
  { id: "hot", label: "Waiting on you", empty: "Nobody is waiting on a call. We'll text you the moment someone wants the work." },
  { id: "handled", label: "Handled", empty: "Replies you've called back show up here." },
  { id: "later", label: "Later", empty: "People who said 'not now' show up here, with when to check back." },
  { id: "closed", label: "Closed out", empty: "No thanks, already done, moved, stop. We close these out for you." },
  { id: "review", label: "Needs a read", empty: "Replies the Inbox agent couldn't sort land here for a person to read." },
];

const SORT_OPTIONS: { intent: ReplyIntent; label: string }[] = [
  { intent: "wants_it", label: "Wants it done" },
  { intent: "wants_price", label: "Wants a price" },
  { intent: "question", label: "Has a question" },
  { intent: "later", label: "Later" },
  { intent: "not_interested", label: "No thanks" },
  { intent: "already_done", label: "Already done" },
  { intent: "stop", label: "Stop" },
];

export function Leads() {
  const { a, id, rev } = useAccount();
  const detail = useApp((s) => s.view.detail);
  const sortReply = useApp((s) => s.sortReply);
  const toast = useApp((s) => s.toast);
  const d = a ? derive(a, rev) : undefined;
  const buckets: Record<Filter, Reply[]> = useMemo(
    () => ({ hot: d?.hot ?? [], handled: d?.handled ?? [], later: d?.later ?? [], closed: d?.closedOut ?? [], review: d?.needsReview ?? [] }),
    [d],
  );
  const [filter, setFilter] = useState<Filter>(() => {
    if (detail) {
      const hit = (Object.keys(buckets) as Filter[]).find((k) => buckets[k].some((r) => r.id === detail));
      if (hit) return hit;
    }
    return (d?.hot.length ?? 0) || !(d?.needsReview.length ?? 0) ? "hot" : "review";
  });
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | undefined>(detail);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = buckets[filter];
    if (!needle || !d) return rows;
    return rows.filter((r) => {
      const c = r.customerId ? d.customers.get(r.customerId) : undefined;
      return `${c?.name ?? ""} ${r.from} ${r.text} ${c?.address?.street ?? ""}`.toLowerCase().includes(needle);
    });
  }, [buckets, filter, q, d]);

  if (!a || !id || !d) return null;
  const all = a.replies;
  const picked = sel ? all.find((r) => r.id === sel) : undefined;
  const shown = picked ?? list[0];
  const meta = FILTERS.find((f) => f.id === filter)!;

  return (
    <div className="flex flex-col gap-5">
      <PageHead title="Unibox" sub="Every reply to every note, read and sorted. The ones who want the work come first." />

      <div className={cx("flex flex-col gap-3", picked && "hidden lg:flex")}>
        <div className={chipRow} role="toolbar" aria-label="Filter replies">
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              active={filter === f.id}
              count={buckets[f.id].length}
              tone={f.id === "hot" ? "bad" : f.id === "review" ? "warn" : undefined}
              onClick={() => {
                setFilter(f.id);
                setSel(undefined);
              }}
            >
              {f.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        {/* List */}
        <div className={cx("flex min-w-0 flex-col gap-2", picked && "hidden lg:flex")}>
          <SearchBox id="unibox-search" value={q} onChange={setQ} placeholder="Search name, street or reply" />
          <Box className="overflow-hidden">
            <ul className="max-h-[calc(100dvh-260px)] min-h-40 divide-y divide-line overflow-y-auto" aria-label={meta.label}>
              {list.map((r) => {
                const c = r.customerId ? d.customers.get(r.customerId) : undefined;
                const active = shown?.id === r.id;
                const late = filter === "hot" && hoursBetween(r.receivedAt, a.dataset.asOf) > 24;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSel(r.id)}
                      aria-current={active ? "true" : undefined}
                      className={cx("flex w-full cursor-pointer flex-col gap-1 border-l-[3px] px-3.5 py-3 text-left transition-colors", active ? "border-accent bg-accent-wash" : "border-transparent hover:bg-accent-wash/60")}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{c?.name ?? r.from}</span>
                        <span className={cx("num shrink-0 text-[12px]", late ? "font-semibold text-bad" : "text-ink-3")}>{relTime(r.receivedAt, a.dataset.asOf)}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0">{intentPill(r)}</span>
                        <span className="min-w-0 truncate text-[12.5px] text-ink-3">{firstLine(r.text)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {!list.length && (
                <li>
                  <EmptyNote icon={<Inbox size={20} />}>{q ? "No replies match that search." : meta.empty}</EmptyNote>
                </li>
              )}
            </ul>
          </Box>
        </div>

        {/* Detail */}
        <div className={cx("min-w-0", !picked && "hidden lg:block")}>
          {picked && (
            <button type="button" onClick={() => setSel(undefined)} className="-ml-2 mb-2 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink lg:hidden">
              <ArrowLeft size={16} /> Back to {meta.label.toLowerCase()}
            </button>
          )}
          {shown ? (
            <div className="flex flex-col gap-3">
              <LeadCard key={shown.id} a={a} r={shown} rev={rev} accountId={id} />
              {shown.intent === "unclear" && shown.status === "new" && (
                <Box className="flex flex-col gap-2 p-4 sm:p-5">
                  <h3 className="text-[18px]">What does this reply mean?</h3>
                  <span className="text-[13px] text-ink-3">Pick one. "Wants" answers go to you as a hand-off; "Stop" removes them everywhere.</span>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {SORT_OPTIONS.map((o) => (
                      <Btn
                        key={o.intent}
                        variant={o.intent === "stop" ? "danger" : "secondary"}
                        onClick={() => {
                          sortReply(id, shown.id, o.intent);
                          toast(`Sorted as “${o.label}”`);
                        }}
                      >
                        {o.label}
                      </Btn>
                    ))}
                  </div>
                </Box>
              )}
              <ReplyFacts r={shown} />
            </div>
          ) : (
            <Box className="grid min-h-60 place-items-center">
              <EmptyNote icon={<MessageSquareText size={20} />}>Select a reply to see it here.</EmptyNote>
            </Box>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplyFacts({ r }: { r: Reply }) {
  const rows: [string, string | undefined][] = [
    ["Received", new Date(r.receivedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })],
    ["From", r.from],
    ["Read as", `${r.intent.replace(/_/g, " ")} (${Math.round(r.confidence * 100)}% sure)`],
    ["Timeframe", r.extracted.timeframe],
    ["Best time", r.extracted.bestTime],
    ["Check back", r.extracted.followUpOn],
    ["Sent to owner", r.handedOffAt ? new Date(r.handedOffAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : undefined],
    ["Owner called", r.ownerContactedAt ? new Date(r.ownerContactedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : undefined],
    ["Outcome", r.outcome ? r.outcome.replace(/_/g, " ") : undefined],
  ];
  return (
    <Box>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 px-4 py-3.5 text-[13.5px] sm:px-5">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{k}</dt>
              <dd className="min-w-0 truncate font-medium">{v}</dd>
            </div>
          ))}
      </dl>
    </Box>
  );
}

function firstLine(t: string): string {
  return t.split("\n").find((l) => l.trim()) ?? "";
}
