/**
 * Beat 2 — we find everyone who stopped booking, and what they're worth (List tab); and beat 3's first half — the note
 * we write the one we follow, in the owner's name (Notes tab). Nobody picks the row: it lifts by itself (we pick the
 * people most likely to answer); the others fade quickly, and only once they're nearly gone does it rise to the top,
 * so it never passes over a row you can still read. The note card opens under it, centred with its chips beside it.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Lock, PenLine, Users } from "lucide-react";
import { fmtMoney } from "@qa/engine";
import { C, day, monthYear, TH } from "../data";
import { and, chipIn, css, enter, handIn, leave, lerp, mixColor, out, outCubic, outQuad, prog, rowIn, sine, typed, type M } from "../motion";
import { caretOn, HeadRow, MeaningChip, Sep, TypedText } from "../parts";
import { L, ONE_PASS, T } from "../timeline";

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
 * both ways (row 42 + 18 + the card: 276 px, or as tall as the note is). A long note (a one pass's, five short
 * paragraphs) takes a wider card before a taller one, so the group still fits above the window's dissolve.
 */
const CARD = { w: 640, wide: 720, wider: 800, h: 276, max: 290, chipsW: 280, gap: 32 };
/** The row's top stays this far under the tab rule (y 146), and the card's bottom above the dissolve (y 526). */
const TAB_RULE = 146;
const CLEAR = 22;
type Geo = { w: number; h: number; groupW: number; groupX: number; topRowY: number; cardY: number; tight?: boolean };
/** The tallest card that fits between the row (CLEAR under the tabs, 12 above the card) and the dissolve. */
const FITS = L.zone.bottom - (TAB_RULE + CLEAR) - ROW_H - 12;
function geoFor(w: number, h: number, tight = false): Geo {
  const groupW = w + CARD.gap + CARD.chipsW;
  // the row-to-card gap closes up a little (18 → 12) before the pair would crowd the tabs
  const gap = ROW_H + 18 + h <= L.zone.bottom - (TAB_RULE + CLEAR) - 12 ? 18 : 12;
  const topRowY = Math.max(TAB_RULE + CLEAR, Math.round(MID - (ROW_H + gap + h) / 2));
  return { w, h, groupW, groupX: Math.round(L.stage.x + (L.stage.w - groupW) / 2), topRowY, cardY: topRowY + ROW_H + gap, tight };
}

/** The note card's place once measured (the phone cut's camera frames it: camera.ts). */
let measured: Geo = geoFor(CARD.w, CARD.h);
export function noteBox(): { x: number; y: number; w: number; h: number; chipsX: number } {
  return { x: measured.groupX, y: measured.topRowY, w: measured.w, h: measured.cardY + measured.h - measured.topRowY, chipsX: measured.groupX + measured.w + CARD.gap };
}

export function ListScene({ t }: { t: number }) {
  // the note card's height, measured once (the fonts are in before the first frame) at both widths, before it's needed
  // each way the card can be set, narrowest first: 640, 720, 800 wide, then 800 with its lines a little closer
  const ways = [
    { w: CARD.w, tight: false },
    { w: CARD.wide, tight: false },
    { w: CARD.wider, tight: false },
    { w: CARD.wider, tight: true },
  ];
  const refs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const [geo, setGeo] = useState<Geo>(() => geoFor(CARD.w, CARD.h));
  useLayoutEffect(() => {
    const hs = refs.map((r) => r.current?.offsetHeight ?? CARD.h);
    // the narrowest that sits easily (CARD.max); else the first that fits clear of the tabs and the dissolve
    const i = [hs.findIndex((h, k) => k < 2 && h <= CARD.max), hs.findIndex((h) => h <= FITS), hs.length - 1].find((x) => x >= 0)!;
    measured = geoFor(ways[i]!.w, Math.max(CARD.h, hs[i]!), ways[i]!.tight);
    setGeo(measured);
  }, []);
  const measure = (
    <div aria-hidden="true" className="absolute" style={{ left: -4000, top: 0, visibility: "hidden" }}>
      {ways.map((way, k) => (
        <div key={k} ref={refs[k]} className="rounded-[18px] border border-line" style={{ width: way.w }}>
          <NoteInner n={Infinity} caret={false} footer={1} tight={way.tight} />
        </div>
      ))}
    </div>
  );
  if (t < S.chip || t > N.out + 420) return measure;
  const others = leave(t, S.othersOut, { dur: S.othersDur, drift: 0, blur: 2 });
  return (
    <>
      {measure}
      <FoundChip t={t} m={others} />
      <People t={t} m={others} />
      <Chosen t={t} geo={geo} />
      <Note t={t} geo={geo} />
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

/**
 * The List's date: when they were last here (a monthly trade's past customers); on a one pass, which is old quotes and
 * past customers both, when they were quoted or when their last job was, as the hand-off text says it.
 */
const WHEN = ONE_PASS ? "When" : "Last here";
function when(p: Person): string {
  const rec = p.record as { kind: string; on: string | null } | null;
  if (!ONE_PASS) return p.lastDone ? monthYear(p.lastDone) : "—";
  const on = rec?.on ?? p.lastDone;
  if (!on) return "—";
  return `${rec?.kind === "quote" ? "Quoted" : "Last job"} ${monthYear(on)}`;
}

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
      <span className="whitespace-nowrap">{when(p)}</span>
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
      <HeadRow cols={PEOPLE_COLS} cells={["Name", "What", WHEN, "Value"]} right={[3]} className="relative" />
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
function Chosen({ t, geo }: { t: number; geo: Geo }) {
  const at = S.people + featuredAt * S.stagger;
  if (t < at) return null;
  const p = C.round.table[featuredAt]!;
  const hover = outQuad(prog(t, S.hover, 300));
  const lift = out(prog(t, S.lift, 420));
  const rise = sine(prog(t, S.rise, S.riseDur));
  const m = and(rowIn(t, at), leave(t, N.out, { dur: 300, drift: 8, blur: 4 }));
  const line = `color-mix(in srgb, var(--line) ${Math.round(lift * 100)}%, transparent)`;
  return (
    <div
      className="absolute grid items-center text-[13.5px]"
      style={css(
        { ...m, s: m.s * lerp(1, 1.012, lift) },
        {
          left: lerp(PEOPLE.x + 1, geo.groupX, rise),
          top: lerp(FEATURED_Y, geo.topRowY, rise),
          width: lerp(PEOPLE.w - 2, geo.groupW, rise),
          height: ROW_H,
          padding: "0 15px",
          gridTemplateColumns: PEOPLE_COLS,
          columnGap: 24,
          borderRadius: lerp(0, 14, lift),
          background: mixColor("#ffffff", TH.rowTint, hover * (1 - 0.5 * lift)),
          boxShadow: lift > 0 ? `0 0 0 1px ${line}, 0 30px 60px -30px rgba(${TH.shadow}, ${0.38 * lift}), 0 2px 6px rgba(${TH.shadow}, ${0.05 * lift})` : undefined,
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
function Note({ t, geo }: { t: number; geo: Geo }) {
  if (t < N.open) return null;
  const n = C.featured.note;
  const typedN = typed(t, N.type, N.typeDur, n.body.length);
  const footer = outQuad(prog(t, N.footer, 320));
  const m = and(enter(t, N.open, { rise: 18, blur: 3 }), leave(t, N.out, { dur: 300, drift: 8, blur: 4 }));
  const company = C.company;
  const own = company.signerName.trim().toLowerCase() === company.ownerFirstName.trim().toLowerCase();
  const chips = [
    { icon: PenLine, text: own ? "We write each one, in your name" : `We write each one, signed ${company.signerName}` },
    { icon: TH.workIcon, text: "About their own job" },
    { icon: Lock, text: "Nothing goes until you say OK" },
  ];
  const chipsOut = leave(t, N.out, { dur: 300 });
  return (
    <>
      <div
        className="absolute overflow-hidden rounded-[18px] border border-line bg-surface"
        style={css(m, {
          left: geo.groupX,
          top: geo.cardY,
          width: geo.w,
          height: geo.h,
          zIndex: 3,
          boxShadow: `0 30px 70px -40px rgba(${TH.shadow}, 0.32), 0 2px 6px rgba(${TH.shadow}, 0.04)`,
        })}
      >
        <NoteInner n={typedN} caret={caretOn(t, N.type, N.type + N.typeDur)} footer={footer} tight={geo.tight} />
      </div>
      <div className="absolute flex flex-col items-start gap-2.5" style={{ left: geo.groupX + geo.w + CARD.gap, top: geo.cardY + geo.h / 2 - 56 }}>
        {chips.map((c, i) => (
          <MeaningChip key={c.text} icon={c.icon} m={and(chipIn(t, N.chips + i * 110), chipsOut)}>
            {c.text}
          </MeaningChip>
        ))}
      </div>
    </>
  );
}

/** The note card's inside: who it's to and when, the subject, the body typing itself, the footer every note carries. */
function NoteInner({ n, caret, footer, tight }: { n: number; caret: boolean; footer: number; tight?: boolean }) {
  const note = C.featured.note;
  return (
    <>
      <div className="flex items-center border-b border-line bg-accent-wash px-4" style={{ height: 34 }}>
        <span className="text-[12.5px] font-semibold whitespace-nowrap text-ink-3">
          Note {C.notesTable.find((r) => r.featured)?.note ?? 1}
          <Sep />
          to {note.to}
          <Sep />
          {day(note.sendAt)}
        </span>
      </div>
      <div className={tight ? "flex flex-col gap-1.5 px-4 pt-3 pb-3.5" : "flex flex-col gap-2 px-4 pt-3.5 pb-4"}>
        <span className="text-[14.5px] font-semibold">{note.subject}</span>
        <TypedText text={note.body} n={Math.min(n, note.body.length)} caret={caret} className={tight ? "text-[14px] leading-[19px] text-ink-2" : "text-[14px] leading-[21px] text-ink-2"} />
        <div className="mt-1.5 text-[11.5px] leading-[15px] whitespace-pre-wrap text-ink-3" style={{ opacity: footer }}>
          {note.footer}
        </div>
      </div>
    </>
  );
}
