/**
 * Beat 1 — his export comes in (Files tab). The owner's whole part, said once: one export from his software, which he
 * sends us. It arrives from him (his name on it, the file attached), and lands in the Files tab's "Files we've read"
 * table with the client page's record chips. Nobody on screen drags or clicks anything.
 */
import { Briefcase, CalendarRange, FileSpreadsheet, Send, Users } from "lucide-react";
import { KIND_LABEL } from "../../../src/components/files";
import { C, dayClock, initials, num, shortClock } from "../data";
import { and, chipIn, count, css, enter, leave, type M } from "../motion";
import { HeadRow, MeaningChip } from "../parts";
import { L, T } from "../timeline";

const F = T.files;
/** The scene's block (chip, his export, the table, the record chips: 294 px) centred in the canvas under the tabs. */
const Y = Math.round((L.zone.top + L.zone.bottom) / 2 - 147);
const X = L.stage.x;
const COLS = "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,0.8fr) minmax(0,1.3fr)";

export function FilesScene({ t }: { t: number }) {
  if (t < F.chip || t > F.out + 400) return null;
  const outM = leave(t, F.out);
  return (
    <>
      <Part t={t} outM={outM} />
      <Sent t={t} outM={outM} />
      <Read t={t} outM={outM} />
    </>
  );
}

/** The scene's one line: all of his part (the export, an OK by text, the calls), and what we do. */
function Part({ t, outM }: { t: number; outM: M }) {
  return (
    <span className="absolute" style={{ left: X, top: Y }}>
      <MeaningChip icon={Send} tone="accent" m={and(enter(t, F.chip, { rise: 14, blur: 3 }), outM)}>
        Your part: one export from {C.export.software}, an OK by text, and the calls. We do the rest.
      </MeaningChip>
    </span>
  );
}

/** His export, as it reaches us: from him, the file attached. */
function Sent({ t, outM }: { t: number; outM: M }) {
  if (t < F.sent) return null;
  const e = C.export;
  return (
    <div className="absolute flex items-center gap-3 rounded-box border border-line bg-surface px-4 shadow-card" style={css(and(enter(t, F.sent, { rise: 24 }), outM), { left: X, top: Y + 44, width: 640, height: 64 })}>
      <span className="grid size-[36px] shrink-0 place-items-center rounded-full border border-accent-line bg-accent-soft font-display text-[13.5px] text-accent-ink">{initials(C.company.ownerName)}</span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[13.5px] font-semibold">{C.company.ownerName}</span>
        <span className="num truncate text-[12px] text-ink-3">{dayClock(e.receivedAt)}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface py-[7px] pr-4 pl-3 text-[13px] whitespace-nowrap shadow-soft">
        <FileSpreadsheet size={15} className="text-accent" aria-hidden="true" />
        <span className="font-semibold text-ink">{e.fileName}</span>
        <span className="text-ink-3">{e.software}</span>
      </span>
    </div>
  );
}

/** "Files we've read": the Files tab's table, one row, and the client page's record chips. */
function Read({ t, outM }: { t: number; outM: M }) {
  if (t < F.table) return null;
  const e = C.export;
  const rows = count(t, F.rowsCount, 0, e.rows);
  const head = and(enter(t, F.table, { rise: 20 }), outM);
  const box = and(enter(t, F.table + 90, { rise: 24 }), outM);
  const chips = [
    { icon: Briefcase, label: KIND_LABEL.job, value: num(e.records) },
    { icon: Users, label: "Clients", value: num(e.customers) },
    { icon: CalendarRange, label: null, value: e.years },
  ];
  return (
    <>
      <h2 className="absolute text-[18px] leading-tight" style={css(head, { left: X, top: Y + 128 })}>
        Files we've read
      </h2>
      <div className="absolute overflow-hidden rounded-box border border-line bg-surface shadow-card" style={css(box, { left: X, top: Y + 160, width: L.stage.w })}>
        <HeadRow cols={COLS} cells={["File", "What", "From", "Rows", "Read on"]} right={[3]} />
        <div className="grid items-center px-4 text-[13.5px]" style={{ gridTemplateColumns: COLS, columnGap: 24, height: 52 }}>
          <span className="flex items-center gap-2 font-semibold">
            <FileSpreadsheet size={16} className="shrink-0 text-accent" aria-hidden="true" />
            {e.fileName}
          </span>
          <span>{KIND_LABEL.job}</span>
          <span>{e.software}</span>
          <span className="num text-right">{num(rows)}</span>
          <span className="whitespace-nowrap">{shortClock(e.receivedAt)}</span>
        </div>
      </div>
      <div className="absolute flex items-center gap-2" style={{ left: X, top: Y + 262 }}>
        {chips.map((c, i) => (
          <MeaningChip key={i} icon={c.icon} m={and(chipIn(t, F.chips + i * 90), outM)}>
            {c.label && <span className="font-medium text-ink-3">{c.label}</span>}
            <span className="num text-ink">{c.value}</span>
          </MeaningChip>
        ))}
      </div>
    </>
  );
}
