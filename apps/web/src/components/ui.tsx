import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { fmtMoney } from "@qa/engine";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

/* ------------------------------ Logo ------------------------------ */
import logoUrl from "../assets/logo-mark.svg";

export function LogoMark({ size = 30, className }: { size?: number; className?: string }) {
  return <img src={logoUrl} width={size} height={size} alt="" className={cx("shrink-0 rounded-[22%]", className)} />;
}

/** The violet "Re:" mark and the name in the display face, in the site's floating white pill. */
export function Wordmark({ sub }: { sub?: string }) {
  return (
    <span className="inline-flex min-h-11 max-w-full min-w-0 shrink-0 items-center gap-2 self-start rounded-full border border-line bg-surface/90 py-1.5 pr-3.5 pl-1.5 shadow-soft backdrop-blur sm:gap-2.5 sm:pr-4">
      <LogoMark size={30} />
      <span className="font-display text-[16.5px] leading-none whitespace-nowrap sm:text-[18px]">Quiet Accounts</span>
      {sub && <span className="-mr-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] leading-none font-semibold text-accent-ink">{sub}</span>}
    </span>
  );
}

/** Sidebar and top-nav items: the site's pill language (lavender when current). */
export function navCls(active: boolean): string {
  return cx(
    "flex min-h-11 cursor-pointer items-center gap-3 rounded-full px-3.5 py-2 text-left text-[14px] font-semibold whitespace-nowrap transition-colors lg:min-h-10",
    active ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
  );
}

/** A count on a nav item or tab: a small violet pill. */
export function NavBadge({ children }: { children: ReactNode }) {
  return <span className="num rounded-full bg-grad px-2 text-[12px] leading-5 font-semibold text-white shadow-glow-sm">{children}</span>;
}

/** Underline tabs inside a page (a client's sections, say): violet when current. */
export function tabCls(active: boolean): string {
  return cx(
    "-mb-px inline-flex min-h-11 cursor-pointer items-center border-b-2 px-3 py-2 text-[14px] font-semibold whitespace-nowrap transition-colors sm:min-h-10",
    active ? "border-accent text-accent-ink" : "border-transparent text-ink-3 hover:text-ink",
  );
}

/* ------------------------------ Buttons ------------------------------ */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "navy"; size?: "sm" | "md" | "lg" };
export function Button({ variant = "primary", size = "md", className, children, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full leading-tight font-semibold transition-[background-color,border-color,color,filter,transform] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:translate-y-0",
        size === "sm" && "min-h-11 px-4 text-[13.5px] sm:min-h-9",
        size === "md" && "min-h-11 px-5 text-[15px]",
        size === "lg" && "min-h-[52px] px-7 text-[16.5px]",
        variant === "primary" && "bg-grad text-white shadow-glow hover:brightness-[1.06] disabled:hover:brightness-100",
        variant === "navy" && "bg-navy text-on-navy hover:bg-navy-2",
        variant === "secondary" && "border border-line-2 bg-surface text-ink hover:border-accent-line hover:bg-accent-wash",
        variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "bg-bad-soft text-bad hover:opacity-85",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------ Surfaces ------------------------------ */
export function Card({ className, children, as: As = "div" }: { className?: string; children: ReactNode; as?: "div" | "section" | "article" }) {
  return <As className={cx("rounded-card border border-line bg-surface shadow-card", className)}>{children}</As>;
}

export function Pill({ tone = "neutral", children, className }: { tone?: "neutral" | "ok" | "warn" | "bad" | "info" | "accent"; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] leading-[1.35] font-semibold whitespace-nowrap",
        tone === "neutral" && "bg-surface-2 text-ink-2",
        tone === "ok" && "bg-ok-soft text-ok",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "bad" && "bg-bad-soft text-bad",
        tone === "info" && "bg-info-soft text-info",
        tone === "accent" && "bg-accent-soft text-accent-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "accent" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[12.5px] font-medium text-ink-3">{label}</span>
      <span className={cx("num font-display text-[28px] leading-tight", tone === "ok" && "text-ok", tone === "accent" && "text-accent-ink")}>{value}</span>
      {sub && <span className="text-[12.5px] text-ink-3">{sub}</span>}
    </div>
  );
}

/* ------------------------------ Money ------------------------------ */
/** Counts up from 0 on first show. Respects reduced motion. */
export function CountUp({ value, money = true, compact = false, duration = 1100, className }: { value: number; money?: boolean; compact?: boolean; duration?: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !first.current) {
      setShown(value);
      return;
    }
    first.current = false;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(value * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    setShown(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className={cx("num", className)}>{money ? fmtMoney(Math.round(shown), { compact }) : Math.round(shown).toLocaleString("en-US")}</span>;
}

/* ------------------------------ Bars ------------------------------ */
export function Bar({ value, max, tone = "accent", className }: { value: number; max: number; tone?: "accent" | "ok" | "ink"; className?: string }) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-accent-line", className)}>
      <div className={cx("h-full rounded-full", tone === "accent" && "bg-grad", tone === "ok" && "bg-ok-strong", tone === "ink" && "bg-ink-2")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ------------------------------ Sheet ------------------------------ */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-0 backdrop-blur-[3px] sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cx("rise max-h-[92dvh] w-full overflow-auto rounded-t-[28px] border border-line bg-surface shadow-lift sm:rounded-[28px]", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-5 py-3.5 backdrop-blur">
          <h2 className="text-[20px]">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-surface-2 text-ink-2 hover:bg-accent-soft hover:text-accent-ink sm:size-9">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------ Misc ------------------------------ */
export function SectionTitle({ eyebrow, title, action, sub }: { eyebrow?: string; title: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <span className="eyebrow mb-1">{eyebrow}</span>}
        <h2 className="text-[24px] sm:text-[30px]">{title}</h2>
        {sub && <p className="max-w-[62ch] text-[15px] text-ink-3">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-accent-edge bg-accent-wash px-6 py-10 text-center">
      {icon && <div className="mb-1 grid size-12 place-items-center rounded-full bg-accent-soft text-accent-ink">{icon}</div>}
      <p className="font-display text-[19px]">{title}</p>
      {children && <div className="max-w-[46ch] text-[14px] text-ink-3">{children}</div>}
    </div>
  );
}

export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <span ref={ref} className="num font-mono text-[13px] break-all select-all">
        {text}
      </span>
      <button
        type="button"
        className="min-h-8 shrink-0 cursor-pointer rounded-full border border-line-2 bg-surface px-3 text-[12px] font-semibold text-ink-2 hover:border-accent-line hover:bg-accent-wash"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(
            () => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            },
            () => {
              const sel = getSelection();
              if (ref.current && sel) {
                const r = document.createRange();
                r.selectNodeContents(ref.current);
                sel.removeAllRanges();
                sel.addRange(r);
              }
            },
          );
        }}
      >
        {done ? "Copied" : label}
      </button>
    </span>
  );
}

export function Toggle({ id, checked, onChange, label, sub }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold">{label}</span>
        {sub && <span className="text-[13px] text-ink-3">{sub}</span>}
      </span>
      <span className="relative mt-0.5 shrink-0">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="block h-7 w-12 rounded-full bg-ink-3/40 transition-colors peer-checked:bg-accent peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
        <span className="absolute top-1 left-1 size-5 rounded-full bg-white shadow-[0_1px_3px_rgba(20,10,60,0.3)] transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13.5px] font-semibold text-ink-2">
        {label}
      </label>
      {children}
      {hint && <span className="text-[12.5px] text-ink-3">{hint}</span>}
    </div>
  );
}

/** The site's field: 52px high, 16px corners, a violet ring on focus. */
export const inputCls =
  "min-h-[52px] w-full rounded-field border border-line-2 bg-surface px-4 text-[16px] text-ink outline-none transition-[border-color,outline-color] placeholder:text-ink-3 focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-offset-1 focus:outline-accent";
