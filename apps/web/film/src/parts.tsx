/**
 * The film's small pieces: the meaning chip, the dotted connector, typed text, a pill that changes, and the app's
 * table look as grid rows (so a row can move on its own). Looks only; every word comes from the caller.
 */
import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "../../src/components/ui";
import { clamp, css, lerp, out, type M } from "./motion";
import { TH } from "./data";

/** The trade's logo mark (theme.ts): the rail's, and the phone's thread header's. */
export function Mark({ size, className }: { size: number; className?: string }) {
  return <img src={TH.mark} width={size} height={size} alt="" className={className ?? "shrink-0 rounded-[22%]"} />;
}

/**
 * The " · " between the parts of a line (the client page's header line, a note card's head). Its spaces are the
 * theme's to set: Instrument Sans's word space is narrow enough that the dots crowd the words (theme.ts).
 */
export function Sep() {
  return <span className="film-sep">{" · "}</span>;
}

/* ------------------------------ chips ------------------------------ */

/** A meaning chip (STORYBOARD §3): the app's pill look, a lucide icon in the violet. */
export function MeaningChip({ icon: Icon, children, m, tone = "white", size = "sm", style }: { icon?: LucideIcon; children: ReactNode; m: M; tone?: "white" | "accent"; size?: "sm" | "lg" | "xl"; style?: CSSProperties }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border font-semibold whitespace-nowrap",
        size === "sm" ? "gap-2 px-3 py-[6px] text-[12.5px] leading-[18px]" : size === "lg" ? "gap-2.5 px-[18px] py-[9px] text-[15px] leading-[20px]" : "gap-3 px-[22px] py-[11px] text-[17px] leading-[22px]",
        tone === "white" ? "border-line bg-surface text-ink-2 shadow-soft" : "border-accent-line bg-accent-soft text-accent-ink",
      )}
      style={css(m, style)}
    >
      {Icon && <Icon size={size === "sm" ? 14 : size === "lg" ? 17 : 19} className="shrink-0 text-accent" aria-hidden="true" />}
      {children}
    </span>
  );
}

/* ------------------------------ connector ------------------------------ */

/** A dotted connector with diamond nodes, drawing from (x1, y1) to (x2, y2) as `k` goes 0 → 1. */
export function Connector({ x1, y1, x2, y2, k, o = 1 }: { x1: number; y1: number; x2: number; y2: number; k: number; o?: number }) {
  if (k <= 0 || o <= 0) return null;
  const pad = 8;
  const minX = Math.min(x1, x2) - pad;
  const minY = Math.min(y1, y2) - pad;
  const w = Math.abs(x2 - x1) + pad * 2;
  const h = Math.abs(y2 - y1) + pad * 2;
  const ex = lerp(x1, x2, k);
  const ey = lerp(y1, y2, k);
  const d = (x: number, y: number, s: number) => `M ${x - minX} ${y - minY - 3.5 * s} L ${x - minX + 3.5 * s} ${y - minY} L ${x - minX} ${y - minY + 3.5 * s} L ${x - minX - 3.5 * s} ${y - minY} Z`;
  const s1 = out(clamp(k / 0.25));
  const s2 = out(clamp((k - 0.85) / 0.15));
  return (
    <svg width={w} height={h} style={{ position: "absolute", left: minX, top: minY, opacity: o, overflow: "visible", pointerEvents: "none" }} aria-hidden="true">
      <line x1={x1 - minX} y1={y1 - minY} x2={ex - minX} y2={ey - minY} stroke="var(--accent-edge)" strokeWidth={1.5} strokeDasharray="2 4" strokeLinecap="round" />
      {s1 > 0 && <path d={d(x1, y1, s1)} fill="var(--accent)" />}
      {s2 > 0 && <path d={d(x2, y2, s2)} fill="var(--accent)" />}
    </svg>
  );
}

/* ------------------------------ typing ------------------------------ */

/**
 * Text that types itself: the first `n` characters show, the rest hold their place invisibly (so nothing reflows), and
 * a caret sits at the end while `caret` is on. Paragraphs (blank lines) get a small gap instead of a whole empty line.
 */
export function TypedText({ text, n, caret, className, gap = 8 }: { text: string; n: number; caret: boolean; className?: string; gap?: number }) {
  const paras = text.split("\n\n");
  let at = 0;
  return (
    <div className={className}>
      {paras.map((p, i) => {
        const start = at;
        at += p.length + 2;
        const shown = clamp(n - start, 0, p.length);
        const here = caret && n >= start && (n < start + p.length + 2 || i === paras.length - 1);
        return (
          <p key={i} style={{ whiteSpace: "pre-wrap", marginTop: i ? gap : 0 }}>
            {p.slice(0, shown)}
            {here && (
              <span style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 0.5, top: 0, width: 1.5, height: "1.2em", background: "var(--accent)", borderRadius: 1 }} />
              </span>
            )}
            <span style={{ visibility: "hidden" }}>{p.slice(shown)}</span>
          </p>
        );
      })}
    </div>
  );
}

/** Caret: solid while typing, blinking at 2 Hz after, gone 300 ms after the last character. */
export function caretOn(t: number, start: number, end: number): boolean {
  if (t < start) return false;
  if (t <= end) return true;
  if (t > end + 300) return false;
  return Math.floor((t - end) / 250) % 2 === 1;
}

/* ------------------------------ a pill that changes ------------------------------ */

/** Two states stacked in one cell: `k` crossfades from a to b (200 ms in the caller), each with its own width. */
export function Swap({ a, b, k, className }: { a: ReactNode; b: ReactNode; k: number; className?: string }) {
  return (
    <span className={cx("inline-grid justify-items-start", className)}>
      <span style={{ gridArea: "1 / 1", opacity: 1 - k, transform: `scale(${lerp(1, 0.94, k)})`, transformOrigin: "left center", visibility: k >= 1 ? "hidden" : undefined }}>{a}</span>
      <span style={{ gridArea: "1 / 1", opacity: k, transform: `scale(${lerp(0.94, 1, k)})`, transformOrigin: "left center", visibility: k <= 0 ? "hidden" : undefined }}>{b}</span>
    </span>
  );
}

/** A small check that draws itself in. */
export function DrawCheck({ k, size = 12 }: { k: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ marginLeft: -1 }}>
      <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - clamp(k)} />
    </svg>
  );
}

/* ------------------------------ the app's table look, as grid rows ------------------------------ */

/** The app's Th: 12 px, semibold, ink-3, over a hairline. */
export function HeadRow({ cols, cells, className, style, right = [] }: { cols: string; cells: ReactNode[]; className?: string; style?: CSSProperties; right?: number[] }) {
  return (
    <div className={cx("grid items-center border-b border-line px-4 text-[12px] leading-tight font-semibold whitespace-nowrap text-ink-3", className)} style={{ gridTemplateColumns: cols, columnGap: 24, height: 34, ...style }}>
      {cells.map((c, i) => (
        <span key={i} className={cx("min-w-0", right.includes(i) && "text-right")}>
          {c}
        </span>
      ))}
    </div>
  );
}
