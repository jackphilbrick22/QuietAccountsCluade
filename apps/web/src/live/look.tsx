/**
 * The consoles' own pieces of the site's look (the live console and the demo one): figures in the display face, the
 * site's tally and calculator tiles, message bubbles, agent tags as pills, designed empty states. Looks only: every
 * word on them comes from the screen that uses them.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AGENTS, type AgentId } from "@qa/engine";
import { cx, Pill } from "../components/ui";

type Tone = "ok" | "accent" | "bad" | "warn";
const TONE: Record<Tone, string> = { ok: "text-ok", accent: "text-accent-ink", bad: "text-bad", warn: "text-warn" };

export interface Fig {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}

/**
 * KPIs as the site's tally: one card, each figure large in the display face with its label under it, hairlines between
 * them. Two across on phones, three on tablets, all in one row on a wide screen (`three`: always three across).
 * Nothing is cut off.
 */
export function Tally({ items, three, className }: { items: Fig[]; three?: boolean; className?: string }) {
  return (
    <div className={cx("min-w-0 overflow-hidden rounded-box border border-line bg-surface shadow-card", className)}>
      <dl className={cx("-mt-px -ml-px grid", three ? "grid-cols-3" : "grid-cols-2 max-sm:[&>:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none")}>
        {items.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-col gap-1 border-t border-l border-line px-4 py-3.5 sm:px-5 sm:py-4">
            <dt className="order-2 text-[12.5px] leading-snug font-medium text-ink-2">{f.label}</dt>
            <dd className={cx("num order-1 font-display text-[26px] leading-[1.05] break-words sm:text-[30px]", f.tone && TONE[f.tone])}>{f.value}</dd>
            {f.sub && <dd className="order-3 text-[12px] leading-snug text-ink-3">{f.sub}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The money, as the site's calculator shows it: a violet tile, a blue one, then a white one. White on the violet and
 * the blue holds AA in both themes (5.6:1 and 4.6:1).
 */
export function Figures({ items }: { items: [Fig, Fig, Fig] }) {
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line shadow-card sm:grid-cols-3">
      {items.map((f, i) => (
        <div key={f.label} className={cx("flex min-w-0 flex-col gap-1.5 px-4 py-4 sm:px-5 sm:py-5", i === 0 ? "bg-[#6a47f5] text-white" : i === 1 ? "bg-[#3e6bf0] text-white" : "col-span-2 bg-surface sm:col-span-1")}>
          <dt className={cx("order-2 text-[13.5px] leading-snug font-medium", i === 2 && "text-ink-2")}>{f.label}</dt>
          <dd className={cx("num order-1 font-display text-[34px] leading-none break-words sm:text-[42px]", i === 2 && (f.tone ? TONE[f.tone] : "text-accent-ink"))}>{f.value}</dd>
          {f.sub && <dd className={cx("order-3 text-[12.5px] leading-snug", i === 2 ? "text-ink-3" : "text-white")}>{f.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A card's own heading, in the display face, with an optional icon on the site's lavender square. */
export function CardTitle({ icon: Icon, children, className }: { icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <h3 className={cx("flex items-center gap-2.5 text-[17.5px] leading-tight", className)}>
      {Icon && (
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-accent-soft text-accent-ink" aria-hidden="true">
          <Icon size={16} />
        </span>
      )}
      <span className="min-w-0">{children}</span>
    </h3>
  );
}

/** Label and value rows with hairlines between them. */
export function Rows({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cx("flex flex-col divide-y divide-line text-[13.5px]", className)}>{children}</dl>;
}
export function Row({ k, children, className }: { k: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 py-1.5">
      <dt className="min-w-0 text-ink-2">{k}</dt>
      <dd className={cx("num shrink-0 text-right font-semibold", className)}>{children}</dd>
    </div>
  );
}

/** What someone wrote to us (a customer's reply, the owner's text): the site's text bubble. */
export const theirs = "rounded-[18px] rounded-bl-md border border-line bg-sunken px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink";
/** What goes out from us (a text for the owner, a drafted answer, a note): the lavender bubble. */
export const ours = "rounded-[18px] rounded-br-md border border-accent-line bg-accent-wash px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink";

/** An empty list, designed: a lavender circle with an icon over the list's own line, in the display face. */
export function Blank({ icon: Icon, children, className }: { icon: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center gap-3 px-6 py-9 text-center", className)}>
      <span className="grid size-12 place-items-center rounded-full border border-accent-line bg-accent-soft text-accent-ink" aria-hidden="true">
        <Icon size={20} />
      </span>
      <p className="max-w-[46ch] font-display text-[17px] leading-snug text-ink-2">{children}</p>
    </div>
  );
}

/** A plain "Loading…" in a list's place, quiet. */
export function Waiting({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("pulse px-4 py-9 text-center text-[13.5px] text-ink-3", className)}>{children}</p>;
}

/** A client's initial (decoration: the name always sits beside it). `lg` is the client page's gradient tile. */
export function Monogram({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const ch = (name.trim().match(/[A-Za-z0-9]/)?.[0] ?? "·").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid shrink-0 place-items-center font-display leading-none select-none",
        size === "lg" ? "size-14 rounded-[18px] bg-grad text-[26px] text-white shadow-glow-sm sm:size-16 sm:text-[30px]" : "size-9 rounded-full border border-accent-line bg-accent-soft text-[15px] text-accent-ink",
      )}
    >
      {ch}
    </span>
  );
}

const AGENT_TONE: Record<string, "neutral" | "ok" | "warn" | "info" | "accent"> = {
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

/** Which agent did it, as a pill (it was a mono uppercase tag). */
export function AgentTag({ agent, className }: { agent: string; className?: string }) {
  return (
    <Pill tone={AGENT_TONE[agent] ?? "neutral"} className={cx("shrink-0", className)}>
      {AGENTS[agent as AgentId]?.name ?? agent}
    </Pill>
  );
}

/** A coloured dot for a status line (ok, warn, bad), with a soft ring. */
export function Dot({ tone = "ok" }: { tone?: "ok" | "warn" | "bad" | "accent" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block size-2 shrink-0 rounded-full ring-[3px]",
        tone === "ok" && "bg-ok-strong ring-ok-soft",
        tone === "warn" && "bg-warn ring-warn-soft",
        tone === "bad" && "bg-bad ring-bad-soft",
        tone === "accent" && "bg-accent ring-accent-soft",
      )}
    />
  );
}

/** A small tap target that stays visually small: 44px tall on phones without growing the line it sits in. */
export const inlineTap = "inline-flex min-h-11 items-center -my-3 sm:my-0 sm:min-h-0";

/* ------------------------------ the two consoles' shells ------------------------------ */

/** The sidebar's quiet links (demo mode, sign out, owner view). */
export const sideLink = "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-full px-3.5 text-left text-[13.5px] font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink";
/** The phone header's small links: pills, 44px. */
export const topLink = "min-h-11 cursor-pointer rounded-full px-3 text-[13px] font-semibold whitespace-nowrap text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink";
/** On phones the nav is one row that scrolls sideways; it fades out at the right edge so the cut-off item reads as "more". */
export const navRow =
  "-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] max-lg:-my-1 max-lg:py-1.5 max-lg:pr-12 max-lg:[mask-image:linear-gradient(to_right,#000_calc(100%-48px),transparent)] lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden";
/**
 * A row of filter chips: one sideways-scrolling row on phones (with room for the focus ring) that fades out at the right
 * edge like the nav row, wrapped and unclipped wider. Used by both consoles and the owner app.
 */
export const chipRow =
  "-mx-4 -my-1.5 flex gap-1.5 overflow-x-auto px-4 py-1.5 [scrollbar-width:none] max-sm:pr-12 max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-48px),transparent)] sm:mx-0 sm:my-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:py-0 [&::-webkit-scrollbar]:hidden";
/** The consoles' sidebar: a white column on wide screens, a header with the nav row on phones. */
export const consoleAside = "flex flex-col gap-3 border-b border-line bg-surface px-4 pt-3 pb-2 lg:sticky lg:top-0 lg:h-dvh lg:gap-6 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-3 lg:py-5";
/** The consoles' root. (The display face's word spacing is in styles.css, for all three faces.) */
export const consoleRoot = "min-h-full";
/** The consoles' main column. */
export const consoleMain = "mx-auto w-full max-w-[1320px] min-w-0 px-4 pt-5 pb-16 sm:px-6 lg:px-8 lg:pt-8";
