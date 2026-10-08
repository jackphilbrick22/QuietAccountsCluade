/**
 * Beat 2 — we find everyone who stopped booking, and what they're worth (List tab); and beat 3's first half — the note
 * we write the one we follow, in the owner's name (Notes tab). Nobody picks the row: it lifts by itself (we pick the
 * people most likely to answer); the others fade quickly, and only once they're nearly gone does it rise to the top,
 * so it never passes over a row you can still read. The note card opens under it, centred with its chips beside it.
 */
import { Lock, PenLine, Sprout, Users } from "lucide-react";
import { fmtMoney } from "@qa/engine";
import { C, day, monthYear } from "../data";
import { and, chipIn, css, enter, handIn, leave, lerp, mixColor, out, outCubic, outQuad, prog, rowIn, sine, typed, type M } from "../motion";
import { caretOn, HeadRow, MeaningChip, TypedText } from "../parts";
import { L, T } from "../timeline";

const S = T.list;
const N = T.note;
const PEOPLE_COLS = "minmax(0,2.4fr) minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)";
const ROW_H = 42;
const MID = (L.zone.top + L.zone.bottom) / 2;
/** The list's block (its line, the people fading out after the row under the one we follow) centred in the canvas. */
const CHIP_Y = Math.round(MID - 144);
const PEOPLE = { x: L.stage.x, y: CHIP_Y + 44, w: L.stage.w };
const firstRow = PEOPLE.y + 34;
const featuredAt = Math.max(0, C.round.table.findIndex((p) => p.name === C.featured.name));
const FEATURED_Y = firstRow + featuredAt * ROW_H;
/**
 * The note scene: the chosen row on top, the note card under it, its chips beside it; the group centred in the canvas
 * both ways (row 42 + 18 + card 276).
 */
const CARD = { w: 640, h: 276, chipsW: 280, gap: 32 };
const GROUP_W = CARD.w + CARD.gap + CARD.chipsW;
const GROUP_X = Math.round(L.stage.x + (L.stage.w - GROUP_W) / 2);
const TOP_ROW_Y = Math.round(MID - 168);
const CARD_Y = TOP_ROW_Y + ROW_H + 18;

export function ListScene({ t }: { t: number }) {
  if (t < S.chip || t > N.out + 420) return null;
  const others = leave(t, S.othersOut, { dur: S.othersDur, drift: 0, blur: 2 });
  return (
    <>
      <FoundChip t={t} m={others} />
      <People t={t} m={others} />
      <Chosen t={t} />
      <Note t={t} />
    </>
  );
}

/** The welcome text's own finding, as the scene's one line. */
function FoundChip({ t, m }: { t: number; m: M }) {
  if (t > S.othersOut + S.othersDur + 50) return null;
  return (
    <span className="absolute" style={{ left: L.stage.x, top: CHIP_Y }}>
      <MeaningChip icon={Users} tone="accent" m={and(handIn(t, S.chip, { dur: 420 }), m)}>
        {C.ownerTexts.foundLine}
      </MeaningChip>
    </span>
  );
}

type Person = (typeof C.round.table)[number];

function PersonCells({ p }: { p: Person }) {
  return (
    <>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-semibold">{p.name}</span>
        <span className="truncate text-[12px] text-ink-3">
          {p.street}, {p.town}
        </span>
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate">{p.what}</span>
        <span className="truncate text-[12px] text-ink-3">{p.typeShort}</span>
      </span>
      <span className="whitespace-nowrap">{p.lastDone ? monthYear(p.lastDone) : "—"}</span>
      <span className="num text-right font-semibold">{fmtMoney(p.value)}</span>
    </>
  );
}

/** How far the people's rows have landed (their card grows with them, so it's never an empty shell). */
const landedRows = (t: number) => C.round.table.reduce((s, _, i) => s + outCubic(prog(t, S.people + i * S.stagger, 420)), 0);

/** The people: the List tab's opportunities, fading out toward the bottom edge. */
function People({ t, m }: { t: number; m: M }) {
  if (t < S.people - 80 || t > S.othersOut + S.othersDur + 50) return null;
  const head = and(enter(t, S.people - 80, { dur: 400, rise: 10, blur: 2 }), m);
  const h = 34 + landedRows(t) * ROW_H;
  // the list fades out toward the bottom: the row under the chosen one at about 60 %, the next at about 20 %
  const below = FEATURED_Y + ROW_H - PEOPLE.y;
  const mask = `linear-gradient(to bottom, #000 0px, #000 ${below}px, rgba(0,0,0,0.6) ${below + ROW_H / 2}px, rgba(0,0,0,0.2) ${below + ROW_H * 1.5}px, rgba(0,0,0,0) ${below + ROW_H * 2.1}px)`;
  return (
    <div className="absolute" style={css(head, { left: PEOPLE.x, top: PEOPLE.y, width: PEOPLE.w, height: h, maskImage: mask, WebkitMaskImage: mask })}>
      <div className="absolute inset-0 rounded-box border border-line bg-surface shadow-card" />
      <HeadRow cols={PEOPLE_COLS} cells={["Name", "What", "Last here", "Value"]} right={[3]} className="relative" />
      {C.round.table.map((p, i) => (
        <div key={p.name} className="relative grid items-center border-b border-line px-4 text-[13.5px]" style={css(rowIn(t, S.people + i * S.stagger), { gridTemplateColumns: PEOPLE_COLS, columnGap: 24, height: ROW_H, visibility: i === featuredAt ? "hidden" : undefined })}>
          <PersonCells p={p} />
        </div>
      ))}
    </div>
  );
}

/**
 * The one we follow: it lifts by itself, and once the others have all but gone, rises to the top and draws in to the
 * note's width, carrying us into the Notes tab.
 */
function Chosen({ t }: { t: number }) {
  const at = S.people + featuredAt * S.stagger;
  if (t < at) return null;
  const p = C.round.table[featuredAt]!;
  const hover = outQuad(prog(t, S.hover, 300));
  const lift = out(prog(t, S.lift, 420));
  const rise = sine(prog(t, S.rise, S.riseDur));
  const m = and(rowIn(t, at), leave(t, N.out, { dur: 300, drift: 8, blur: 4 }));
  const line = `rgba(236, 236, 240, ${lift})`;
  return (
    <div
      className="absolute grid items-center text-[13.5px]"
      style={css(
        { ...m, s: m.s * lerp(1, 1.012, lift) },
        {
          left: lerp(PEOPLE.x + 1, GROUP_X, rise),
          top: lerp(FEATURED_Y, TOP_ROW_Y, rise),
          width: lerp(PEOPLE.w - 2, GROUP_W, rise),
          height: ROW_H,
          padding: "0 15px",
          gridTemplateColumns: PEOPLE_COLS,
          columnGap: 24,
          borderRadius: lerp(0, 14, lift),
          background: mixColor("#ffffff", "#f7f5ff", hover * (1 - 0.5 * lift)),
          boxShadow: lift > 0 ? `0 0 0 1px ${line}, 0 30px 60px -30px rgba(70, 40, 170, ${0.38 * lift}), 0 2px 6px rgba(20, 10, 60, ${0.05 * lift})` : undefined,
          borderBottom: lift > 0 ? undefined : "1px solid var(--line)",
          zIndex: 4,
        },
      )}
    >
      <PersonCells p={p} />
    </div>
  );
}

/**
 * The note card, as the app's "Read the notes" card shows it, typing itself in his name. It rises in whole, its
 * shadow with it (no reveal that ends in a jump), centred with its chips beside it.
 */
function Note({ t }: { t: number }) {
  if (t < N.open) return null;
  const n = C.featured.note;
  const typedN = typed(t, N.type, N.typeDur, n.body.length);
  const footer = outQuad(prog(t, N.footer, 320));
  const m = and(enter(t, N.open, { rise: 18, blur: 3 }), leave(t, N.out, { dur: 300, drift: 8, blur: 4 }));
  const company = C.company;
  const own = company.signerName.trim().toLowerCase() === company.ownerFirstName.trim().toLowerCase();
  const chips = [
    { icon: PenLine, text: own ? "We write each one, in your name" : `We write each one, signed ${company.signerName}` },
    { icon: Sprout, text: "About their own job" },
    { icon: Lock, text: "Nothing goes until you say OK" },
  ];
  const chipsOut = leave(t, N.out, { dur: 300 });
  return (
    <>
      <div
        className="absolute overflow-hidden rounded-[18px] border border-line bg-surface"
        style={css(m, {
          left: GROUP_X,
          top: CARD_Y,
          width: CARD.w,
          height: CARD.h,
          zIndex: 3,
          boxShadow: "0 30px 70px -40px rgba(60, 40, 140, 0.32), 0 2px 6px rgba(20, 10, 60, 0.04)",
        })}
      >
        <div className="flex items-center border-b border-line bg-accent-wash px-4" style={{ height: 34 }}>
          <span className="text-[12.5px] font-semibold whitespace-nowrap text-ink-3">
            Note {C.notesTable.find((r) => r.featured)?.note ?? 1} · to {n.to} · {day(n.sendAt)}
          </span>
        </div>
        <div className="flex flex-col gap-2 px-4 pt-3.5">
          <span className="text-[14.5px] font-semibold">{n.subject}</span>
          <TypedText text={n.body} n={typedN} caret={caretOn(t, N.type, N.type + N.typeDur)} className="text-[14px] leading-[21px] text-ink-2" />
          <div className="mt-1.5 text-[11.5px] leading-[15px] whitespace-pre-wrap text-ink-3" style={{ opacity: footer }}>
            {n.footer}
          </div>
        </div>
      </div>
      <div className="absolute flex flex-col items-start gap-2.5" style={{ left: GROUP_X + CARD.w + CARD.gap, top: CARD_Y + CARD.h / 2 - 56 }}>
        {chips.map((c, i) => (
          <MeaningChip key={c.text} icon={c.icon} m={and(chipIn(t, N.chips + i * 110), chipsOut)}>
            {c.text}
          </MeaningChip>
        ))}
      </div>
    </>
  );
}
