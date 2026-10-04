/**
 * Dense list/table primitives for the dashboard: page headers, KPI strips, tables with sticky
 * headers, filter chips, search, pagination, row menus and copyable text blocks.
 * Plain on purpose, in the site's restraint: hairlines, small type, tabular numbers; lavender for what's chosen.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type ThHTMLAttributes, type TdHTMLAttributes } from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal, Search } from "lucide-react";
import { cx } from "./ui";

/* ------------------------------ Page header ------------------------------ */
export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-0.5">
        <h1 className="text-[26px] leading-[1.1] sm:text-[30px]">{title}</h1>
        {sub && <p className="mt-1 max-w-[80ch] text-[14px] text-ink-3">{sub}</p>}
      </div>
      {actions && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, sub, actions, children, className }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("flex min-w-0 flex-col gap-2.5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 flex-1 basis-60 flex-col">
          <h2 className="text-[18px] leading-tight">{title}</h2>
          {sub && <p className="mt-0.5 text-[13px] text-ink-3">{sub}</p>}
        </div>
        {actions && <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A plain bordered box. */
export function Box({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("min-w-0 rounded-box border border-line bg-surface shadow-card", className)}>{children}</div>;
}

/* ------------------------------ KPI strip ------------------------------ */
export function Kpis({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]", className)}>{children}</div>;
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "accent" | "bad" | "warn" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-box border border-line bg-surface px-4 py-3.5 shadow-card">
      <span className="truncate text-[12.5px] font-medium text-ink-3">{label}</span>
      <span className={cx("num truncate font-display text-[26px] leading-none", tone === "ok" && "text-ok", tone === "accent" && "text-accent-ink", tone === "bad" && "text-bad", tone === "warn" && "text-warn")}>{value}</span>
      {sub && <span className="truncate text-[12px] text-ink-3">{sub}</span>}
    </div>
  );
}

/* ------------------------------ Tables ------------------------------ */
/**
 * Scrolls sideways on phones; `tall` caps the height so the sticky header stays in view. While there's more to the
 * right it fades out at that edge, like the nav rows, so a cut-off column reads as "more" (styles.css `.table-fade`).
 * The scroll box is a size container, so a full-width cell's content can pin itself to the part you can see (`pinned`).
 */
export function Table({ children, minWidth = 640, tall, className, label }: { children: ReactNode; minWidth?: number; tall?: boolean; className?: string; label?: string }) {
  return (
    <div className={cx("table-box relative min-w-0 rounded-box border border-line bg-surface shadow-card", className)}>
      <div className={cx("table-scroll scroll-x @container rounded-[17px]", tall && "max-h-[70vh] overflow-y-auto")}>
        <table className="w-full border-collapse text-left text-[13.5px]" style={{ minWidth }} aria-label={label}>
          {children}
        </table>
      </div>
      <div aria-hidden="true" className="table-fade pointer-events-none absolute inset-y-0 right-0 z-[2] w-10 rounded-r-[17px] bg-linear-to-l from-surface to-transparent" />
    </div>
  );
}

export function Th({ children, right, wrap, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { right?: boolean; wrap?: boolean }) {
  return (
    <th
      scope="col"
      {...rest}
      className={cx("sticky top-0 z-[1] border-b border-line bg-surface px-3 pt-3 pb-2.5 text-[12px] leading-tight font-semibold text-ink-3 first:pl-4 last:pr-4", !wrap && "whitespace-nowrap", right && "text-right", className)}
    >
      {children}
    </th>
  );
}

export function Td({ children, right, className, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { right?: boolean }) {
  return (
    <td {...rest} className={cx("border-b border-line px-3 py-2.5 align-middle first:pl-4 last:pr-4", right && "num text-right whitespace-nowrap", className)}>
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
      className={cx(
        "transition-colors last:[&>td]:border-b-0",
        onClick && "cursor-pointer hover:bg-accent-wash focus-visible:bg-accent-wash focus-visible:outline-offset-[-3px]",
        selected && "bg-accent-wash hover:bg-accent-wash [&>td:first-child]:shadow-[inset_3px_0_0_var(--accent)]",
        className,
      )}
    >
      {children}
    </tr>
  );
}

/**
 * For a cell that spans the whole row (an empty list, an editor opened under a row): its content stays the width of
 * the visible part of the table and holds still while the table scrolls sideways, so on a phone it never sits off
 * screen in the middle of a wide table.
 */
export const pinned = "sticky left-0 w-[100cqw]";

export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="p-0">
        <div className={cx(pinned, "px-4 py-10 text-center text-[14px] text-ink-3")}>{children}</div>
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
        "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors sm:min-h-9",
        active ? "border-accent-edge bg-accent-soft text-accent-ink" : "border-line-2 bg-surface text-ink-2 hover:border-accent-line hover:bg-accent-wash",
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cx("num rounded-full px-1.5 text-[11.5px] leading-[18px]", tone === "bad" && count > 0 ? "bg-bad text-surface" : tone === "warn" && count > 0 ? "bg-warn-soft text-warn" : active ? "bg-surface text-accent-ink" : "bg-surface-2 text-ink-3")}>
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
      <Search size={15} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" aria-hidden="true" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-11 w-full rounded-full border border-line-2 bg-surface pr-4 pl-9 text-[16px] text-ink outline-none placeholder:text-ink-3 focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-offset-1 focus:outline-accent sm:min-h-10 sm:text-[14px]"
      />
    </div>
  );
}

/** The console's denser field: the site's field, shorter (44px on phones, 40px wide), 12px corners, the violet ring. */
const fieldFocus = "outline-none focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-offset-1 focus:outline-accent";
export const selectCls = `min-h-11 max-w-full cursor-pointer rounded-control border border-line-2 bg-surface px-3 text-[16px] text-ink sm:min-h-10 sm:text-[14px] ${fieldFocus}`;
export const smallInputCls = `min-h-11 w-full rounded-control border border-line-2 bg-surface px-3 text-[16px] text-ink placeholder:text-ink-3 sm:min-h-10 sm:text-[14px] ${fieldFocus}`;

export function Select<T extends string>({ id, label, value, onChange, options, hideLabel, className }: { id: string; label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; hideLabel?: boolean; className?: string }) {
  return (
    <div className={cx("flex max-w-full min-w-0 items-center gap-2", className)}>
      <label htmlFor={id} className={cx("shrink-0 text-[12.5px] font-semibold text-ink-2", hideLabel && "sr-only")}>
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
        <button type="button" aria-label="Previous page" disabled={page <= 0} onClick={() => onPage(page - 1)} className="grid size-11 cursor-pointer place-items-center rounded-full border border-line-2 bg-surface hover:border-accent-line hover:bg-accent-wash disabled:cursor-not-allowed disabled:opacity-40 sm:size-9">
          <ChevronLeft size={16} />
        </button>
        <span className="num px-2">
          {page + 1} / {pages}
        </span>
        <button type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className="grid size-11 cursor-pointer place-items-center rounded-full border border-line-2 bg-surface hover:border-accent-line hover:bg-accent-wash disabled:cursor-not-allowed disabled:opacity-40 sm:size-9">
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
        "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 text-[13.5px] leading-tight font-semibold whitespace-nowrap transition-[background-color,border-color,color,filter,transform] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:translate-y-0 sm:min-h-9",
        variant === "primary" && "bg-grad text-white shadow-glow-sm hover:brightness-[1.06] disabled:hover:brightness-100",
        variant === "secondary" && "border border-line-2 bg-surface text-ink hover:border-accent-line hover:bg-accent-wash",
        variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "border border-bad/25 bg-bad-soft text-bad hover:opacity-85",
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
        className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-3 hover:bg-accent-soft hover:text-accent-ink aria-expanded:bg-accent-soft aria-expanded:text-accent-ink sm:size-8"
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[80] flex w-52 flex-col rounded-box border border-line bg-surface p-1.5 shadow-lift"
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
                className={cx("min-h-11 cursor-pointer rounded-control px-3 py-2 text-left text-[13.5px] font-semibold sm:min-h-9", it.danger ? "text-bad hover:bg-bad-soft" : "text-ink hover:bg-accent-wash")}
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
      <pre ref={ref} className="note-body max-h-72 overflow-auto rounded-control border border-line bg-sunken px-3.5 py-3 text-[13.5px] leading-relaxed text-ink">
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
