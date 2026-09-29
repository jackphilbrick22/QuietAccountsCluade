import { useMemo, useState } from "react";
import { AGENTS, type AgentEvent, type AgentId } from "@qa/engine";
import { useApp } from "../../store/app";
import { cx } from "../../components/ui";
import { EmptyRow, PageHead, Pager, SearchBox, Select, Table, Td, Th, Tr } from "../../components/table";
import { agentTone } from "../owner/Today";

const PAGE = 100;
type KindFilter = AgentEvent["kind"] | "all";

const KIND_TONE: Record<AgentEvent["kind"], string> = {
  win: "text-ok",
  action: "text-ink",
  warning: "text-warn",
  review: "text-accent-ink",
  info: "text-ink-2",
};

export function OpsAgents() {
  const order = useApp((s) => s.order);
  const accounts = useApp((s) => s.accounts);
  const rev = useApp((s) => s.rev);
  const [agent, setAgent] = useState<AgentId | "all">("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [client, setClient] = useState<string>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const all = useMemo(() => {
    const out: { e: AgentEvent; id: string; name: string }[] = [];
    for (const id of order) {
      const a = accounts[id];
      if (!a) continue;
      for (const e of a.events) out.push({ e, id, name: a.dataset.business.name });
    }
    return out.sort((x, y) => (x.e.at < y.e.at ? 1 : x.e.at > y.e.at ? -1 : 0));
  }, [order, accounts, rev]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(({ e, id }) => (agent === "all" || e.agent === agent) && (kind === "all" || e.kind === kind) && (client === "all" || id === client) && (!needle || `${e.title} ${e.detail ?? ""}`.toLowerCase().includes(needle)));
  }, [all, agent, kind, client, q]);

  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  const reset = () => setPage(0);

  return (
    <div className="flex flex-col gap-5">
      <PageHead title="Agent log" sub="Every action every agent took, across all clients. Newest first." />

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          id="log-search"
          className="w-full sm:w-64"
          value={q}
          onChange={(v) => {
            setQ(v);
            reset();
          }}
          placeholder="Search the log"
        />
        <Select
          id="log-agent"
          label="Agent"
          value={agent}
          onChange={(v) => {
            setAgent(v);
            reset();
          }}
          options={[{ value: "all" as const, label: "All agents" }, ...(Object.keys(AGENTS) as AgentId[]).map((k) => ({ value: k, label: AGENTS[k].name }))]}
        />
        <Select
          id="log-kind"
          label="Kind"
          value={kind}
          onChange={(v) => {
            setKind(v);
            reset();
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
        <Select
          id="log-client"
          label="Client"
          value={client}
          onChange={(v) => {
            setClient(v);
            reset();
          }}
          options={[{ value: "all", label: "All clients" }, ...order.filter((id) => accounts[id]).map((id) => ({ value: id, label: accounts[id]!.dataset.business.name }))]}
        />
      </div>

      <Table minWidth={900} tall label="Agent log">
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Client</Th>
            <Th>Agent</Th>
            <Th>Kind</Th>
            <Th>What happened</Th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map(({ e, name }, i) => (
            <Tr key={`${e.id}-${i}`}>
              <Td className="num whitespace-nowrap text-ink-2">{new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Td>
              <Td className="max-w-[180px] truncate">{name}</Td>
              <Td>
                <span className={cx("rounded px-1.5 py-0.5 font-mono text-[10.5px] font-medium tracking-wide uppercase", agentTone(e.agent))}>{AGENTS[e.agent]?.name ?? e.agent}</span>
              </Td>
              <Td className={cx("text-[12.5px] font-semibold capitalize", KIND_TONE[e.kind])}>{e.kind}</Td>
              <Td className="max-w-[520px]">
                <span className={cx("block font-semibold", KIND_TONE[e.kind])}>{e.title}</span>
                {e.detail && <span className="line-clamp-2 text-[12.5px] text-ink-3">{e.detail}</span>}
              </Td>
            </Tr>
          ))}
          {!pageRows.length && <EmptyRow cols={5}>Nothing matches these filters.</EmptyRow>}
        </tbody>
      </Table>
      <Pager page={page} pageSize={PAGE} total={rows.length} onPage={setPage} />
    </div>
  );
}
