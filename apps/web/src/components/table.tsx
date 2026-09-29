/**
 * Dense list/table primitives for the dashboard: page headers, KPI strips, tables with sticky
 * headers, filter chips, search, pagination, row menus and copyable text blocks.
 * Plain on purpose: thin borders, small type, tabular numbers.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type ThHTMLAttributes, type TdHTMLAttributes } from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal, Search } from "lucide-react";
import { cx } from "./ui";

/* ------------------------------ Page header ------------------------------ */
export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
        <h1 className="font-body text-[21px] font-bold tracking-tight">{title}</h1>
        {sub && <p className="max-w-[80ch] text-[13.5px] text-ink-3">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, sub, actions, children, className }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("flex min-w-0 flex-col gap-2.5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 flex-1 basis-60 flex-col">
          <h2 className="font-body text-[15px] font-bold tracking-normal">{title}</h2>
          {sub && <p className="text-[12.5px] text-ink-3">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A plain bordered box. */
export function Box({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("min-w-0 rounded-lg border border-line bg-surface", className)}>{children}</div>;
}

/* ------------------------------ KPI strip ------------------------------ */
export function Kpis({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]", className)}>{children}</div>;
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "accent" | "bad" | "warn" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface px-3.5 py-3">
      <span className="truncate text-[12px] font-semibold text-ink-3">{label}</span>
      <span className={cx("num truncate text-[20px] leading-tight font-bold", tone === "ok" && "text-ok", tone === "accent" && "text-accent-ink", tone === "bad" && "text-bad", tone === "warn" && "text-warn")}>{value}</span>
      {sub && <span className="truncate text-[12px] text-ink-3">{sub}</span>}
    </div>
  );
}

/* ------------------------------ Tables ------------------------------ */
/** Scrolls sideways on phones; `tall` caps the height so the sticky header stays in view. */
export function Table({ children, minWidth = 640, tall, className, label }: { children: ReactNode; minWidth?: number; tall?: boolean; className?: string; label?: string }) {
  return (
    <div className={cx("scroll-x min-w-0 rounded-lg border border-line bg-surface", tall && "max-h-[70vh] overflow-y-auto", className)}>
      <table className="w-full border-collapse text-left text-[13.5px]" style={{ minWidth }} aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, right, wrap, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { right?: boolean; wrap?: boolean }) {
  return (
    <th
      scope="col"
      {...rest}
      className={cx("sticky top-0 z-[1] border-b border-line bg-surface-2 px-3 py-2 text-[12px] leading-tight font-semibold text-ink-3", !wrap && "whitespace-nowrap", right && "text-right", className)}
    >
      {children}
    </th>
  );
}

export function Td({ children, right, className, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { right?: boolean }) {
  return (
    <td {...rest} className={cx("border-b border-line px-3 py-2 align-middle", right && "num text-right whitespace-nowrap", className)}>
      {children}
    </td>
  );
}

/** Table row; clickable rows get hover, keyboard access and an optional selected state. */
export function Tr({ children, onClick, selected, className, label }: { children: ReactNode; onClick?: () => void; selected?: boolean; className?: string; label?: string }) {
  return (
    <tr
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      tabIndex={onClick ? 0 : undefined}
      aria-label={label}
      className={cx("last:[&>td]:border-b-0", onClick && "cursor-pointer hover:bg-bg focus-visible:bg-bg", selected && "bg-accent-soft/60 hover:bg-accent-soft/60", className)}
    >
      {children}
    </tr>
  );
}

export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-8 text-center text-[13.5px] text-ink-3">
        {children}
      </td>
    </tr>
  );
}

/* ------------------------------ Filters ------------------------------ */
export function Chip({ active, onClick, children, count, tone }: { active: boolean; onClick: () => void; children: ReactNode; count?: number; tone?: "bad" | "warn" }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors",
        active ? "border-accent/40 bg-accent-soft text-accent-ink" : "border-line bg-surface text-ink-2 hover:bg-surface-2",
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cx("num rounded px-1.5 text-[11.5px] leading-[18px]", tone === "bad" && count > 0 ? "bg-bad text-surface" : tone === "warn" && count > 0 ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-3")}>
          {count.toLocaleString("en-US")}
        </span>
      )}
    </button>
  );
}

export function SearchBox({ id, value, onChange, placeholder = "Search", className }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx("relative min-w-0", className)}>
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" aria-hidden="true" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-9 w-full rounded-md border border-line-2 bg-surface pr-2.5 pl-8 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
      />
    </div>
  );
}

export const selectCls = "min-h-9 rounded-md border border-line-2 bg-surface px-2.5 text-[13.5px] text-ink outline-none focus:border-accent";
export const smallInputCls = "min-h-9 w-full rounded-md border border-line-2 bg-surface px-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-accent";

export function Select<T extends string>({ id, label, value, onChange, options, hideLabel, className }: { id: string; label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; hideLabel?: boolean; className?: string }) {
  return (
    <div className={cx("flex items-center gap-2", className)}>
      <label htmlFor={id} className={cx("text-[12.5px] font-semibold text-ink-3", hideLabel && "sr-only")}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={cx(selectCls, "min-w-0")}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ------------------------------ Pagination ------------------------------ */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] text-ink-3">
      <span className="num">
        {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")} of {total.toLocaleString("en-US")}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Previous page" disabled={page <= 0} onClick={() => onPage(page - 1)} className="grid size-8 cursor-pointer place-items-center rounded-md border border-line bg-surface hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40">
          <ChevronLeft size={16} />
        </button>
        <span className="num px-2">
          {page + 1} / {pages}
        </span>
        <button type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className="grid size-8 cursor-pointer place-items-center rounded-md border border-line bg-surface hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ Small buttons ------------------------------ */
export function Btn({
  children,
  onClick,
  variant = "secondary",
  disabled,
  className,
  type = "button",
  title,
  ...aria
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  title?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={aria["aria-label"]}
      className={cx(
        "inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-[13.5px] font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-deep",
        variant === "secondary" && "border border-line-2 bg-surface text-ink hover:bg-surface-2",
        variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "border border-bad/30 bg-bad-soft text-bad hover:opacity-85",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Two-step button: first click asks, second click does. No browser confirm() needed. */
export function ConfirmBtn({ children, confirmLabel = "Yes, do it", onConfirm, variant = "danger", note }: { children: ReactNode; confirmLabel?: string; onConfirm: () => void; variant?: "danger" | "secondary" | "primary"; note?: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Btn variant={variant} onClick={() => setAsking(true)}>
        {children}
      </Btn>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label="Confirm">
      {note && <span className="text-[13px] font-semibold text-ink-2">{note}</span>}
      <Btn
        variant={variant === "danger" ? "danger" : "primary"}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Btn>
      <Btn variant="ghost" onClick={() => setAsking(false)}>
        Cancel
      </Btn>
    </span>
  );
}

/* ------------------------------ Row menu ------------------------------ */
export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Ask "are you sure" inside the menu before running. */
  confirm?: string;
  hidden?: boolean;
}

/** "…" menu that floats above tables (fixed position, so scroll containers can't clip it). */
export function RowMenu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<MenuItem | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const shown = items.filter((i) => !i.hidden);

  const place = () => {
    if (!btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = 208;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
    const h = menu.current?.offsetHeight ?? 160;
    const top = r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - 4 - h) : r.bottom + 4;
    setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
  };

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, asking]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setAsking(null);
    };
    const onDown = (e: MouseEvent) => {
      if (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        btn.current?.focus();
      }
    };
    // keep the menu attached to its button while the page or a table scrolls
    const onMove = () => place();
    addEventListener("mousedown", onDown);
    addEventListener("keydown", onKey);
    addEventListener("resize", onMove);
    addEventListener("scroll", onMove, true);
    return () => {
      removeEventListener("mousedown", onDown);
      removeEventListener("keydown", onKey);
      removeEventListener("resize", onMove);
      removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  if (!shown.length) return null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
          setAsking(null);
        }}
        className="grid size-8 cursor-pointer place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[80] flex w-52 flex-col rounded-lg border border-line bg-surface p-1 shadow-card"
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
        >
          {asking ? (
            <div className="flex flex-col gap-2 p-2">
              <span className="text-[13px] font-semibold">{asking.confirm}</span>
              <div className="flex gap-1.5">
                <Btn
                  variant={asking.danger ? "danger" : "primary"}
                  onClick={() => {
                    const it = asking;
                    setAsking(null);
                    setOpen(false);
                    it.onClick();
                  }}
                >
                  Yes
                </Btn>
                <Btn variant="ghost" onClick={() => setAsking(null)}>
                  Cancel
                </Btn>
              </div>
            </div>
          ) : (
            shown.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  if (it.confirm) return setAsking(it);
                  setOpen(false);
                  it.onClick();
                }}
                className={cx("cursor-pointer rounded-md px-2.5 py-2 text-left text-[13.5px] font-semibold hover:bg-surface-2", it.danger ? "text-bad" : "text-ink")}
              >
                {it.label}
              </button>
            ))
          )}
        </div>
      )}
    </>
  );
}

/* ------------------------------ Copyable block ------------------------------ */
export function CopyBlock({ text, label = "Copy text" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  const selectAll = () => {
    const sel = getSelection();
    if (ref.current && sel) {
      const r = document.createRange();
      r.selectNodeContents(ref.current);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <pre ref={ref} className="note-body max-h-72 overflow-auto rounded-md border border-line bg-bg px-3 py-2.5 text-[13px] leading-relaxed text-ink">
        {text}
      </pre>
      <div>
        <Btn
          onClick={() => {
            const ok = () => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            };
            if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, selectAll);
            else selectAll();
          }}
        >
          {done ? "Copied" : label}
        </Btn>
      </div>
    </div>
  );
}

/* ------------------------------ Formatting ------------------------------ */
export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function shortDate(d: string | undefined): string {
  if (!d) return "—";
  return new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.slice(0, 4) === String(new Date().getFullYear()) ? undefined : "numeric" });
}

export function hoursBetween(fromIso: string, toIsoOrDate: string): number {
  const to = toIsoOrDate.length === 10 ? `${toIsoOrDate}T18:00:00` : toIsoOrDate;
  return (Date.parse(to) - Date.parse(fromIso)) / 3600000;
}
