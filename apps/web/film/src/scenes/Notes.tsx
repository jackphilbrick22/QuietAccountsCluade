/**
 * Beats 3 to 5 — the Notes tab: every note waits for his OK, his OK schedules them all, and the first day's go out.
 * Then the view pans one tab right, to Replies. Laid out narrow (beside the phone) from the start, so nothing has to
 * make room when the phone comes in.
 */
import type { ReactNode } from "react";
import { Chip } from "../../../src/components/table";
import { Pill } from "../../../src/components/ui";
import { C, dayClock, num } from "../data";
import { chipIn, clamp, count, css, enter, handIn, outCubic, prog, rowIn, sine, steps, swap } from "../motion";
import { DrawCheck, HeadRow } from "../parts";
import { L, T } from "../timeline";

const N = T.note;
const COLS = "minmax(0,1.5fr) minmax(0,1.2fr) minmax(0,0.4fr) minmax(0,1fr) minmax(0,1.45fr)";
const noop = () => {};
export const NOTES = { chipsTop: 170, boxTop: 218, rowH: 38 };

/** The pan between adjacent tabs: Notes slides out to the left as Replies comes in from the right. */
export const PAN = { gap: 56, get d() { return L.stage.narrow + this.gap; } };
export function panK(t: number): number {
  return sine(prog(t, T.send.pan, T.send.panDur));
}

/**
 * The canvas window both panes slide through, from the sidebar to the phone: soft edges on both sides, and each pane
 * fades as it nears an edge, so nothing is cut off at the sidebar's line or pops at the phone's.
 */
export function PanFrame({ children }: { children: ReactNode }) {
  const left = L.canvas.x;
  const right = L.phone.x - 12;
  const width = right - left;
  const mask = `linear-gradient(to right, rgba(0,0,0,0) 0px, #000 ${L.stage.x - left}px, #000 ${width - 28}px, rgba(0,0,0,0) ${width}px)`;
  return (
    <div className="absolute" style={{ left, top: 150, width, height: 446, maskImage: mask, WebkitMaskImage: mask }}>
      <div className="absolute" style={{ left: -left, top: -150, width: 1280, height: 596 }}>
        {children}
      </div>
    </div>
  );
}

export function NotesScene({ t }: { t: number }) {
  if (t < N.chipsIn || t > T.send.pan + T.send.panDur + 50) return null;
  const k = panK(t);
  const x = -k * PAN.d;
  // the outgoing pane fades over the last part of its travel, so no stub of it sits at the sidebar's edge
  const o = 1 - sine(clamp((k - 0.35) / 0.55));
  return (
    <PanFrame>
      <div className="absolute" style={{ left: 0, top: 0, width: 1280, height: 596, opacity: o, willChange: "opacity", transform: x ? `translate(${x.toFixed(2)}px, 0)` : undefined }}>
        <NoteChips t={t} />
        <Table t={t} />
      </div>
    </PanFrame>
  );
}

/** The Notes tab's chips, counting with what happens; and how many people the notes are to (two notes each). */
function NoteChips({ t }: { t: number }) {
  const c = C.noteChips;
  const flip = T.ok.flip;
  const sent = T.send.sent;
  const waiting = count(t, flip, c.waitingForApproval, 0, 600);
  const scheduled = steps(t, 0, [
    { at: flip, to: c.scheduledAfterOk },
    { at: sent, to: c.scheduledAfterFirstDay },
  ], 700);
  const sentN = count(t, sent, 0, c.sentFirstDay, 700);
  const chips = [
    { label: "Waiting for approval", n: waiting, tone: "warn" as const },
    { label: "Scheduled", n: scheduled },
    { label: "Sent", n: sentN },
    { label: "All", n: c.waitingForApproval, active: true },
  ];
  return (
    <div className="absolute flex items-center gap-1.5" style={{ left: L.stage.x, top: NOTES.chipsTop }}>
      {chips.map((x, i) => (
        <span key={x.label} style={css(handIn(t, N.chipsIn + i * 60, { dur: 360, rise: 10, blur: 2 }))}>
          <Chip active={!!x.active} onClick={noop} count={Math.round(x.n)} tone={x.tone}>
            {x.label}
          </Chip>
        </span>
      ))}
      <span className="num ml-2.5 text-[13px] whitespace-nowrap text-ink-3" style={css(chipIn(t, N.chipsIn + 300))}>
        {num(C.round.notesPlanned)} notes to {num(C.round.people)} people
      </span>
    </div>
  );
}

/** The Notes tab's table: notes in send order, the one we follow tinted. Its card grows with its rows. */
function Table({ t }: { t: number }) {
  const rows = C.notesTable;
  const rowAt = (i: number) => N.tableIn + 60 + i * 70;
  const landed = rows.reduce((s, _, i) => s + outCubic(prog(t, rowAt(i), 400)), 0);
  const box = enter(t, N.tableIn, { dur: 360, rise: 12, blur: 2 });
  return (
    <div className="absolute overflow-hidden rounded-box border border-line bg-surface shadow-card" style={css(box, { left: L.stage.x, top: NOTES.boxTop, width: L.stage.narrow, height: 36 + landed * NOTES.rowH })}>
      <HeadRow cols={COLS} cells={["Goes out", "To", "Note", "Subject", "Status"]} />
      {rows.map((r, i) => {
        const m = rowIn(t, rowAt(i));
        const firstDay = r.sendAt.slice(0, 10) === C.round.firstDay;
        // each change: the old label fades fully out, then the new one fades in (never two printed over each other)
        const s1 = swap(t, T.ok.flip + i * 60);
        const s2 = firstDay ? swap(t, T.send.sent + i * T.send.sentGap) : { a: 1, b: 0, y: 0 };
        const check = prog(t, T.send.sent + i * T.send.sentGap + 160, 280);
        return (
          <div key={r.to} className="relative" style={{ height: NOTES.rowH, background: r.featured ? "var(--accent-wash)" : undefined, boxShadow: r.featured ? "inset 3px 0 0 var(--accent)" : undefined }}>
            <div className="grid h-full items-center px-4 text-[13.5px] whitespace-nowrap" style={css(m, { gridTemplateColumns: COLS, columnGap: 20, borderBottom: i < rows.length - 1 ? "1px solid var(--line)" : undefined })}>
              <span className="num truncate">{dayClock(r.sendAt)}</span>
              <span className="truncate font-semibold">{r.to}</span>
              <span className="num">{r.note}</span>
              <span className="truncate">{r.subject}</span>
              <span className="inline-grid justify-items-start">
                <State o={s1.a} y={0}>
                  <Pill tone="warn">Waiting for approval</Pill>
                </State>
                <State o={s1.b * s2.a} y={s1.y}>
                  <Pill tone="info">Scheduled</Pill>
                </State>
                <State o={s2.b} y={s2.y}>
                  <Pill tone="ok">
                    <DrawCheck k={check} /> Sent
                  </Pill>
                </State>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function State({ o, y, children }: { o: number; y: number; children: ReactNode }) {
  return (
    <span style={{ gridArea: "1 / 1", opacity: o, visibility: o <= 0.001 ? "hidden" : undefined, transform: y ? `translate(0, ${y.toFixed(2)}px)` : undefined, willChange: "opacity" }}>
      {children}
    </span>
  );
}
