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

export function Wordmark({ sub }: { sub?: string }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark size={30} />
      <span className="font-display text-[16.5px] font-bold tracking-tight whitespace-nowrap">Quiet Accounts</span>
      {sub && <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-accent-ink uppercase">{sub}</span>}
    </span>
  );
}

/* ------------------------------ Buttons ------------------------------ */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "navy"; size?: "sm" | "md" | "lg" };
export function Button({ variant = "primary", size = "md", className, children, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" && "min-h-9 px-3 text-[13.5px]",
        size === "md" && "min-h-11 px-4 text-[15px]",
        size === "lg" && "min-h-14 px-6 text-[16.5px]",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-deep",
        variant === "navy" && "bg-navy text-on-navy hover:bg-navy-2",
        variant === "secondary" && "border border-line-2 bg-surface text-ink hover:bg-surface-2",
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
  return <As className={cx("rounded-2xl border border-line bg-surface", className)}>{children}</As>;
}

export function Pill({ tone = "neutral", children, className }: { tone?: "neutral" | "ok" | "warn" | "bad" | "info" | "accent"; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap",
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
      <span className="text-[12.5px] font-semibold text-ink-3">{label}</span>
      <span className={cx("num font-display text-[26px] leading-tight font-bold", tone === "ok" && "text-ok", tone === "accent" && "text-accent")}>{value}</span>
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
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)}>
      <div className={cx("h-full rounded-full", tone === "accent" && "bg-accent", tone === "ok" && "bg-ok", tone === "ink" && "bg-ink-2")} style={{ width: `${pct}%` }} />
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cx("rise max-h-[92dvh] w-full overflow-auto rounded-t-3xl bg-surface shadow-lift sm:rounded-3xl", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
          <h2 className="text-[18px] font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-9 cursor-pointer place-items-center rounded-full bg-surface-2 text-ink-2 hover:text-ink">
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
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2 className="text-[22px] font-bold sm:text-[26px]">{title}</h2>
        {sub && <p className="max-w-[62ch] text-[14.5px] text-ink-2">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line-2 px-6 py-10 text-center">
      {icon && <div className="text-ink-3">{icon}</div>}
      <p className="font-display text-[17px] font-semibold">{title}</p>
      {children && <div className="max-w-[46ch] text-[14px] text-ink-3">{children}</div>}
    </div>
  );
}

export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <span ref={ref} className="num font-mono text-[13px] select-all">
        {text}
      </span>
      <button
        type="button"
        className="cursor-pointer rounded-md border border-line px-2 py-0.5 text-[12px] font-semibold text-ink-2 hover:bg-surface-2"
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
        <span className="block h-7 w-12 rounded-full bg-line-2 transition-colors peer-checked:bg-ok" />
        <span className="absolute top-1 left-1 size-5 rounded-full bg-surface shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13.5px] font-bold">
        {label}
      </label>
      {children}
      {hint && <span className="text-[12.5px] text-ink-3">{hint}</span>}
    </div>
  );
}

export const inputCls =
  "min-h-11 w-full rounded-xl border border-line-2 bg-surface px-3.5 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent";
