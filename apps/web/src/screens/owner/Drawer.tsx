import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { BREAKAGE_LABEL, fmtMoney, plural, type BreakageType, type SuppressionReason } from "@qa/engine";
import { useApp, useAccount } from "../../store/app";
import { derive } from "../../lib/derive";
import { OPP_STATUS, oppStatuses, SUPPRESS_LABEL, type OppStatus } from "../../lib/labels";
import { cx, Pill } from "../../components/ui";
import { Box, Btn, EmptyRow, Kpi, Kpis, PageHead, Pager, SearchBox, Section, Select, Table, Td, Th, Tr } from "../../components/table";

const PAGE = 50;
type SortKey = "score" | "value";
type StatusFilter = "all" | "workable" | "working" | "left_alone";

export function Drawer() {
  const { a, id, rev } = useAccount();
  const rescan = useApp((s) => s.rescan);
  const toast = useApp((s) => s.toast);
  const [type, setType] = useState<BreakageType | "all">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("score");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);

  const d = a ? derive(a, rev) : undefined;
  const statuses = a && d ? oppStatuses(a, d, rev) : undefined;

  const rows = useMemo(() => {
    if (!a?.scan || !d || !statuses) return [];
    const needle = q.trim().toLowerCase();
    const out = a.scan.opportunities.filter((o) => {
      if (type !== "all" && o.type !== type) return false;
      const st = statuses.get(o.id) ?? "not_started";
      if (status === "workable" && (st === "left_alone" || st === "holdout")) return false;
      if (status === "working" && !["queued", "in_sequence", "replied", "recovered", "finished"].includes(st)) return false;
      if (status === "left_alone" && st !== "left_alone") return false;
      if (!needle) return true;
      const c = d.customers.get(o.customerId);
      return `${c?.name ?? ""} ${o.jobPhrase} ${o.reason} ${c?.address?.street ?? ""}`.toLowerCase().includes(needle);
    });
    out.sort((x, y) => (sort === "score" ? y.score - x.score || y.value - x.value : y.value - x.value || y.score - x.score));
    return out;
  }, [a, d, statuses, type, q, sort, status]);

  if (!a || !id || !d || !statuses) return null;
  const s = a.summary;
  if (!a.scan || !s)
    return (
      <div className="flex flex-col gap-4">
        <PageHead title="Opportunities" />
        <Box className="flex flex-col items-start gap-3 p-5">
          <p className="text-[14px]">No scan yet. Add your exported files in Settings → Data, or run the scan now.</p>
          <Btn variant="primary" onClick={() => rescan(id)}>
            Scan now
          </Btn>
        </Box>
      </div>
    );

  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  const stats = a.scan.stats;
  const suppressed = (Object.entries(stats.suppressedBy) as [SuppressionReason, number][]).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
  const suppressedTotal = suppressed.reduce((n, [, v]) => n + v, 0);
  const resetPage = () => setPage(0);

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        title="Opportunities"
        sub={`Everything in ${a.dataset.business.name}'s records that's worth a follow-up: ${stats.quotes.toLocaleString("en-US")} quotes, ${stats.jobs.toLocaleString("en-US")} jobs and ${stats.customers.toLocaleString("en-US")} customers${stats.from ? `, ${stats.from.slice(0, 4)}–${(stats.to ?? a.dataset.asOf).slice(0, 4)}` : ""}.`}
        actions={
          <Btn
            onClick={() => {
              rescan(id);
              toast("Scanned again");
            }}
          >
            Re-scan
          </Btn>
        }
      />

      <Kpis>
        <Kpi label="Total found" value={fmtMoney(s.totalValue, { compact: true })} sub={plural(s.opportunities, "opportunity", "opportunities")} />
        <Kpi label="Reachable" value={fmtMoney(s.reachableValue, { compact: true })} sub="people we can legally reach" />
        <Kpi label="Careful estimate" value={fmtMoney(s.expected.conservative, { compact: true })} tone="ok" sub="likely to come back, low end" />
        <Kpi label="Likely estimate" value={fmtMoney(s.expected.likely, { compact: true })} tone="ok" sub="what we expect back" />
        <Kpi label="People" value={s.reachablePeople.toLocaleString("en-US")} sub="reachable, one sequence each" />
      </Kpis>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Section title="By type" sub="Click a type to filter the list below.">
          <Table minWidth={620} label="Opportunities by type">
            <thead>
              <tr>
                <Th>Type</Th>
                <Th right>Found</Th>
                <Th right>Reachable</Th>
                <Th right>Value</Th>
                <Th right>Expected</Th>
              </tr>
            </thead>
            <tbody>
              <Tr
                selected={type === "all"}
                onClick={() => {
                  setType("all");
                  resetPage();
                }}
                label="All types"
              >
                <Td className="font-semibold">All types</Td>
                <Td right>{s.opportunities.toLocaleString("en-US")}</Td>
                <Td right>{s.byType.reduce((n, t) => n + t.reachable, 0).toLocaleString("en-US")}</Td>
                <Td right>{fmtMoney(s.totalValue)}</Td>
                <Td right>{fmtMoney(s.expected.likely)}</Td>
              </Tr>
              {s.byType.map((t) => (
                <Tr
                  key={t.type}
                  selected={type === t.type}
                  onClick={() => {
                    setType(type === t.type ? "all" : t.type);
                    resetPage();
                  }}
                  label={t.label}
                >
                  <Td className="max-w-[420px]">
                    <span className="block font-semibold">{t.label}</span>
                    <span className="line-clamp-1 text-[12px] text-ink-3" title={t.explain}>
                      {t.explain}
                    </span>
                  </Td>
                  <Td right>{t.count.toLocaleString("en-US")}</Td>
                  <Td right>{t.reachable.toLocaleString("en-US")}</Td>
                  <Td right>{fmtMoney(t.value)}</Td>
                  <Td right>{fmtMoney(t.expected)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <div className="flex min-w-0 flex-col gap-4">
          <Box className="flex flex-col gap-2 p-4">
            <span className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-bold">Is this a fit?</span>
              <Pill tone={s.fit.verdict === "strong" || s.fit.verdict === "good" ? "ok" : s.fit.verdict === "thin" ? "warn" : "bad"}>{s.fit.guaranteeEligible ? "Guarantee eligible" : "Not guarantee eligible"}</Pill>
            </span>
            <p className="text-[13px] text-ink-2">{s.fit.headline}</p>
            <ul className="flex flex-col gap-1.5">
              {s.fit.checks.map((c) => (
                <li key={c.id} className="flex gap-2 text-[12.5px]">
                  {c.ok ? <Check size={15} className="mt-0.5 shrink-0 text-ok" aria-label="Yes" /> : <X size={15} className="mt-0.5 shrink-0 text-bad" aria-label="No" />}
                  <span className="min-w-0">
                    <b className="font-semibold">{c.label}.</b> <span className="text-ink-3">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Box>

          <details className="group rounded-lg border border-line bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-[14px] font-bold">
              <span>People we're leaving alone on purpose</span>
              <span className="num text-[13px] font-semibold text-ink-3">{suppressedTotal.toLocaleString("en-US")}</span>
            </summary>
            <ul className="divide-y divide-line border-t border-line">
              {suppressed.map(([k, n]) => (
                <li key={k} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                  <span>{SUPPRESS_LABEL[k] ?? k}</span>
                  <span className="num font-semibold">{n.toLocaleString("en-US")}</span>
                </li>
              ))}
              {!suppressed.length && <li className="px-4 py-3 text-[13px] text-ink-3">Nobody.</li>}
            </ul>
          </details>
        </div>
      </div>

      <Section
        title={type === "all" ? "All opportunities" : BREAKAGE_LABEL[type].title}
        sub={`${rows.length.toLocaleString("en-US")} shown. Score is how likely it is to come back and how soon; we work the highest first.`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox
            id="opp-search"
            className="w-full sm:w-72"
            value={q}
            onChange={(v) => {
              setQ(v);
              resetPage();
            }}
            placeholder="Search name, job or street"
          />
          <Select
            id="opp-status"
            label="Show"
            value={status}
            onChange={(v) => {
              setStatus(v);
              resetPage();
            }}
            options={[
              { value: "all", label: "Everyone" },
              { value: "workable", label: "Workable" },
              { value: "working", label: "Being worked" },
              { value: "left_alone", label: "Left alone" },
            ]}
          />
          <Select
            id="opp-sort"
            label="Sort by"
            value={sort}
            onChange={(v) => {
              setSort(v);
              resetPage();
            }}
            options={[
              { value: "score", label: "Score" },
              { value: "value", label: "Value" },
            ]}
          />
          {type !== "all" && (
            <Btn variant="ghost" onClick={() => setType("all")}>
              Clear type filter
            </Btn>
          )}
        </div>
        <Table minWidth={960} tall label="Opportunities">
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
            {pageRows.map((o) => {
              const c = d.customers.get(o.customerId);
              const st: OppStatus = statuses.get(o.id) ?? "not_started";
              const meta = OPP_STATUS[st];
              return (
                <Tr key={o.id}>
                  <Td className="max-w-[200px]">
                    <span className="block truncate font-semibold">{c?.name ?? "—"}</span>
                    <span className="block truncate text-[12px] text-ink-3">{c?.address?.street ?? c?.emails[0] ?? ""}</span>
                  </Td>
                  <Td className="max-w-[220px]">
                    <span className="block truncate">{o.jobPhrase.replace(/^the /, "")}</span>
                    <span className="block text-[12px] text-ink-3">{BREAKAGE_LABEL[o.type].short}</span>
                  </Td>
                  <Td className="max-w-[340px]">
                    <span className="line-clamp-2 text-[12.5px] text-ink-2" title={o.reason}>
                      {o.reason}
                    </span>
                  </Td>
                  <Td right>{o.value ? fmtMoney(o.value) : "—"}</Td>
                  <Td right>
                    <span className={cx(o.score >= 70 ? "font-bold text-ink" : "text-ink-2")}>{Math.round(o.score)}</span>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Pill tone={meta.tone}>{meta.label}</Pill>
                    {st === "left_alone" && o.suppressed && <span className="mt-0.5 block text-[11.5px] text-ink-3">{SUPPRESS_LABEL[o.suppressed]}</span>}
                  </Td>
                </Tr>
              );
            })}
            {!pageRows.length && <EmptyRow cols={6}>{q ? "Nothing matches that search." : "Nothing here."}</EmptyRow>}
          </tbody>
        </Table>
        <Pager page={page} pageSize={PAGE} total={rows.length} onPage={setPage} />
      </Section>
    </div>
  );
}
