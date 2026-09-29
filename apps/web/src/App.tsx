import { useEffect, type ReactNode } from "react";
import { Archive, BarChart3, ChevronDown, Inbox, LayoutGrid, Mail, Settings as SettingsIcon, Sun, Users, Bot, ShieldCheck, Wallet, ListChecks } from "lucide-react";
import { useApp, useAccount } from "./store/app";
import { derive } from "./lib/derive";
import { clientRows, reviewItems } from "./lib/ops";
import { cx, LogoMark, Pill, Wordmark } from "./components/ui";
import { Welcome } from "./screens/Welcome";
import { Onboarding } from "./screens/onboarding/Onboarding";
import { Today } from "./screens/owner/Today";
import { Leads } from "./screens/owner/Leads";
import { Drawer } from "./screens/owner/Drawer";
import { Notes } from "./screens/owner/Notes";
import { Results } from "./screens/owner/Results";
import { Settings } from "./screens/owner/Settings";
import { OpsOverview } from "./screens/ops/Overview";
import { OpsReview } from "./screens/ops/Review";
import { OpsAgents } from "./screens/ops/Agents";
import { OpsBilling } from "./screens/ops/Billing";
import { OpsHealth } from "./screens/ops/Health";

const OWNER_TABS = [
  { id: "today", label: "Home", icon: Sun },
  { id: "leads", label: "Unibox", icon: Inbox },
  { id: "drawer", label: "Opportunities", icon: Archive },
  { id: "notes", label: "Sequence", icon: Mail },
  { id: "results", label: "Recovered", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;

const OPS_TABS = [
  { id: "overview", label: "Clients", icon: Users },
  { id: "review", label: "Needs a person", icon: ListChecks },
  { id: "agents", label: "Agent log", icon: Bot },
  { id: "health", label: "Sending health", icon: ShieldCheck },
  { id: "billing", label: "Billing", icon: Wallet },
] as const;

export function App() {
  const ready = useApp((s) => s.ready);
  const init = useApp((s) => s.init);
  const view = useApp((s) => s.view);
  const busy = useApp((s) => s.busy);
  const toast = useApp((s) => s.toastMsg);
  useEffect(() => {
    void init();
  }, [init]);

  if (!ready)
    return (
      <div className="grid h-full place-items-center">
        <LogoMark size={44} className="pulse" />
      </div>
    );

  return (
    <>
      {view.area === "welcome" && <Welcome />}
      {view.area === "onboarding" && <Onboarding />}
      {view.area === "owner" && <OwnerShell />}
      {view.area === "ops" && <OpsShell />}
      {busy && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-bg/80 backdrop-blur-sm" role="status" aria-live="polite">
          <div className="flex flex-col items-center gap-3">
            <LogoMark size={48} className="pulse" />
            <p className="font-display text-[17px] font-semibold">{busy}</p>
          </div>
        </div>
      )}
      {toast && (
        <div key={toast.id} role="status" className="rise fixed bottom-[calc(84px+env(safe-area-inset-bottom,0px))] left-1/2 z-[70] -translate-x-1/2 rounded-full bg-navy px-4 py-2.5 text-[14px] font-semibold text-on-navy shadow-lift lg:bottom-6">
          {toast.text}
        </div>
      )}
    </>
  );
}

function BusinessSwitcher({ compact }: { compact?: boolean }) {
  const { a, meta } = useAccount();
  const order = useApp((s) => s.order);
  const accounts = useApp((s) => s.accounts);
  const select = useApp((s) => s.select);
  const area = useApp((s) => s.view.area);
  if (!a) return null;
  return (
    <label className={cx("relative flex min-w-0 items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2", compact && "border-0 bg-transparent p-0")}>
      <span className="sr-only">Business</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[14px] font-bold">{a.dataset.business.name}</span>
        {!compact && <span className="truncate text-[12px] text-ink-3">{meta?.sample ? "Sample business" : a.dataset.business.city || "Your business"}</span>}
      </span>
      {order.length > 1 && <ChevronDown size={16} className="ml-auto shrink-0 text-ink-3" />}
      {order.length > 1 && (
        <select
          aria-label="Switch business"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={a.dataset.business.id}
          onChange={(e) => select(e.target.value, area === "ops" ? "ops" : "owner")}
        >
          {order.map((id) => (
            <option key={id} value={id}>
              {accounts[id]?.dataset.business.name}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

function SimBadge() {
  const { a, meta } = useAccount();
  if (!a || !meta?.sample) return null;
  return (
    <Pill tone="warn" className="max-w-full">
      <span className="truncate">Sample data{meta.simulatedDays ? ` · ${meta.simulatedDays} ${meta.simulatedDays === 1 ? "day" : "days"} simulated` : ""}</span>
    </Pill>
  );
}

function OwnerShell() {
  const view = useApp((s) => s.view);
  const go = useApp((s) => s.go);
  const { a, rev } = useAccount();
  if (!a) return <Welcome />;
  const d = derive(a, rev);
  const badges: Record<string, number> = { leads: d.hot.length };
  const Screen = { today: Today, leads: Leads, drawer: Drawer, notes: Notes, results: Results, settings: Settings }[view.tab as "today"] ?? Today;
  const mobileTabs = OWNER_TABS.filter((t) => t.id !== "settings" && t.id !== "notes");
  return (
    <div className="min-h-full lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-5 overflow-y-auto border-r border-line bg-surface px-4 py-5 lg:flex">
        <Wordmark />
        <BusinessSwitcher />
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {OWNER_TABS.map((t) => (
            <NavItem key={t.id} active={view.tab === t.id} onClick={() => go({ tab: t.id })} icon={<t.icon size={18} />} label={t.label} badge={badges[t.id]} />
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <SimBadge />
          <button className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-[13.5px] font-semibold text-ink-3 hover:bg-surface-2 hover:text-ink" onClick={() => go({ area: "ops", tab: "overview" })}>
            <LayoutGrid size={16} /> Operator console
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 flex items-center gap-3 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <LogoMark size={28} />
          <div className="min-w-0 flex-1">
            <BusinessSwitcher compact />
          </div>
          <button aria-label="Sequence" onClick={() => go({ tab: "notes" })} className={cx("grid size-10 cursor-pointer place-items-center rounded-full", view.tab === "notes" ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-surface-2")}>
            <Mail size={19} />
          </button>
          <button aria-label="Operator console" onClick={() => go({ area: "ops", tab: "overview" })} className="grid size-10 cursor-pointer place-items-center rounded-full text-ink-2 hover:bg-surface-2">
            <LayoutGrid size={19} />
          </button>
          <button aria-label="Settings" onClick={() => go({ tab: "settings" })} className={cx("grid size-10 cursor-pointer place-items-center rounded-full", view.tab === "settings" ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-surface-2")}>
            <SettingsIcon size={19} />
          </button>
        </header>
        <main className="mx-auto w-full max-w-[1280px] min-w-0 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-7 lg:pb-16">
          <Screen />
        </main>
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface/97 backdrop-blur lg:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {mobileTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => go({ tab: t.id })}
              className={cx("relative flex cursor-pointer flex-col items-center gap-0.5 py-2.5 text-[11.5px] font-bold", view.tab === t.id ? "text-accent" : "text-ink-3")}
              aria-current={view.tab === t.id ? "page" : undefined}
            >
              <t.icon size={21} />
              {t.label}
              {!!badges[t.id] && <span className="absolute top-1.5 left-[calc(50%+6px)] grid min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10.5px] leading-[18px] text-on-accent">{badges[t.id]}</span>}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function NavItem({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-[14px] font-semibold whitespace-nowrap",
        active ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {!!badge && <span className="rounded-full bg-accent px-2 text-[12px] leading-5 font-bold text-on-accent">{badge}</span>}
    </button>
  );
}

function OpsShell() {
  const view = useApp((s) => s.view);
  const go = useApp((s) => s.go);
  const order = useApp((s) => s.order);
  const accounts = useApp((s) => s.accounts);
  const rev = useApp((s) => s.rev);
  const metas = useApp((s) => s.meta);
  const review = reviewItems(clientRows(order, accounts, metas, rev)).length;
  const Screen = { overview: OpsOverview, review: OpsReview, agents: OpsAgents, health: OpsHealth, billing: OpsBilling }[view.tab as "overview"] ?? OpsOverview;
  return (
    <div className="min-h-full lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4 border-b border-line bg-surface px-4 py-4 lg:sticky lg:px-3 lg:top-0 lg:h-dvh lg:border-r lg:border-b-0 lg:py-5">
        <div className="flex items-center justify-between gap-2">
          <Wordmark sub="Ops" />
          <button className="cursor-pointer rounded-lg px-2 py-1 text-[13px] font-semibold text-ink-3 hover:bg-surface-2 lg:hidden" onClick={() => go({ area: "owner", tab: "today" })}>
            Owner view
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Operator">
          {OPS_TABS.map((t) => (
            <NavItem key={t.id} active={view.tab === t.id} onClick={() => go({ tab: t.id })} icon={<t.icon size={17} />} label={t.label} badge={t.id === "review" ? review : undefined} />
          ))}
        </nav>
        <div className="mt-auto hidden flex-col gap-2 lg:flex">
          <button className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-[13.5px] font-semibold text-ink-3 hover:bg-surface-2 hover:text-ink" onClick={() => go({ area: "owner", tab: "today" })}>
            <Sun size={16} /> Owner view
          </button>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-[1320px] min-w-0 px-4 py-6 sm:px-6">
        <Screen />
      </main>
    </div>
  );
}
