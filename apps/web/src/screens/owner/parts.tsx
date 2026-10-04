/**
 * Owner-app pieces in the site's language: the money band (the site's calculator tiles: flat violet, blue, white, as the
 * console's figures),
 * small stats that become a list on phones, the lavender "ready to start" card, designed empty states,
 * and the agents as pills.
 */
import type { ReactNode } from "react";
import { cx, Pill } from "../../components/ui";

export interface Stat {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "ok" | "accent";
}

/** The numbers that matter, big: up to three tiles joined in one card, like the site's money block. */
export function MoneyBand({ items, className }: { items: Stat[]; className?: string }) {
  return (
    <div
      className={cx(
        "grid gap-px overflow-hidden rounded-card border border-line bg-line shadow-card",
        items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
        className,
      )}
    >
      {items.map((s, i) => (
        <div
          key={s.label}
          className={cx(
            "flex min-w-0 flex-col gap-1.5 px-5 py-4 sm:px-6 sm:py-5",
            i === 0 && "bg-[#6a47f5] text-white",
            i === 1 && "bg-[#3e6bf0] text-white",
            i > 1 && "bg-surface text-ink",
          )}
        >
          <span className={cx("text-[14px] font-medium", i > 1 && "text-ink-2")}>{s.label}</span>
          <span className={cx("num font-display text-[36px] leading-none break-words sm:text-[clamp(28px,4.2vw,42px)]", i > 1 && "text-accent-ink")}>{s.value}</span>
          {s.sub && <span className={cx("text-[13px] leading-snug", i > 1 && "text-ink-3")}>{s.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** Supporting numbers: tiles side by side when there's room; one tidy list on phones, so nothing gets cut off. */
export function MiniStats({ items, className }: { items: Stat[]; className?: string }) {
  return (
    <div
      className={cx(
        "divide-y divide-line rounded-box border border-line bg-surface shadow-card sm:grid sm:gap-3 sm:divide-y-0 sm:rounded-none sm:border-0 sm:bg-transparent sm:shadow-none",
        items.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
        className,
      )}
    >
      {items.map((s) => (
        <div
          key={s.label}
          className="flex min-w-0 items-center justify-between gap-4 px-4 py-3 sm:flex-col sm:items-start sm:justify-start sm:gap-1 sm:rounded-box sm:border sm:border-line sm:bg-surface sm:px-4 sm:py-3.5 sm:shadow-card"
        >
          <span className="flex min-w-0 flex-col gap-0.5 sm:contents">
            <span className="text-[13px] font-medium text-ink-2 sm:truncate sm:text-[12.5px] sm:text-ink-3">{s.label}</span>
            {s.sub && <span className="text-[12px] text-ink-3 sm:order-last sm:truncate">{s.sub}</span>}
          </span>
          <span className={cx("num shrink-0 font-display text-[24px] leading-none sm:text-[28px]", s.tone === "ok" && "text-ok", s.tone === "accent" && "text-accent-ink")}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

/** The one thing to do next: lavender fading to white, a violet edge (the site's free plan card). */
export function ReadyCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-card border-2 border-accent/55 bg-[linear-gradient(180deg,var(--accent-soft)_0%,var(--surface)_78%)] p-5 shadow-[0_30px_70px_-46px_rgba(91,63,232,0.6)] sm:p-6", className)}>
      {children}
    </div>
  );
}

/** An empty list or panel that still looks finished: an icon in a lavender circle over the words. */
export function EmptyNote({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}>
      <span className="grid size-12 place-items-center rounded-full border border-accent-line bg-accent-soft text-accent-ink" aria-hidden="true">
        {icon}
      </span>
      <div className="max-w-[44ch] text-[14px] text-ink-3">{children}</div>
    </div>
  );
}

const AGENT_PILL: Record<string, "neutral" | "ok" | "warn" | "info" | "accent"> = {
  reader: "info",
  finder: "accent",
  writer: "neutral",
  sender: "neutral",
  inbox: "info",
  dispatcher: "ok",
  ledger: "ok",
  guard: "warn",
  reporter: "neutral",
};

/** Which agent did it, as one of the app's pills. */
export function AgentPill({ agent, children }: { agent: string; children: ReactNode }) {
  return <Pill tone={AGENT_PILL[agent] ?? "neutral"}>{children}</Pill>;
}
