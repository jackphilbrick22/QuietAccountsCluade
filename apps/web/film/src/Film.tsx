/**
 * The frame: the white page, the app window (the console's icon rail and this client's page header and tabs), which
 * never moves, and the canvas where every scene happens (STORYBOARD §2). The only chrome that changes is the tab
 * underline and the header's state pill. No cursor: nobody the owner could take for himself clicks around; the work
 * happens on its own, and his part happens on his phone. While the phone is on screen, the scenes recede a little
 * whenever it's the phone's turn (focus.ts).
 */
import { useLayoutEffect, useRef, useState } from "react";
import { ListChecks, MessageSquare, Users } from "lucide-react";
import { playbook, type TradeId } from "@qa/engine";
import { Pill } from "../../src/components/ui";
import { Dot } from "../../src/live/look";
import { C, TH } from "./data";
import { dim } from "./focus";
import { and, css, fadeOut, gone, lerp, mixColor, pop, prog, sine } from "./motion";
import { L, ONE_PASS, T, TAB_MOVES, TABS, type TabId } from "./timeline";
import { Mark, Sep } from "./parts";
import { FilesScene } from "./scenes/Files";
import { ListScene } from "./scenes/List";
import { NotesScene } from "./scenes/Notes";
import { RepliesScene } from "./scenes/Replies";
import { MoneyScene } from "./scenes/Money";
import { Phone } from "./Phone";

export function Film({ t }: { t: number }) {
  return (
    <div className="film-type relative overflow-hidden bg-white" style={{ width: 1280, height: 596 }}>
      <Window t={t} />
      <Phone t={t} />
      {/* the bottom of the window dissolves into the page, the phone's shadow with it */}
      <div className="pointer-events-none absolute" style={{ left: 0, right: 0, top: L.dissolve.from, height: L.dissolve.to - L.dissolve.from, zIndex: 75, background: "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 45%, #ffffff 100%)" }} />
      {/* the outer 20 px: pure white in every frame, so the video has no edge on a white page */}
      <div className="pointer-events-none absolute inset-0" style={{ zIndex: 100, border: `${L.margin}px solid #ffffff` }} />
    </div>
  );
}

/** The window's hairline: a shade lighter than the page's --line, so on a white page it draws no box. */
const HAIRLINE = TH.hairline;

function Window({ t }: { t: number }) {
  const { win, side } = L;
  const d = dim(t, "console");
  return (
    <div className="absolute overflow-hidden" style={{ left: win.x, top: win.y, width: win.w, height: win.h + 20, borderRadius: 18, border: `1px solid ${HAIRLINE}`, background: "#ffffff", boxShadow: `0 12px 34px -22px rgba(${TH.shadow}, 0.18)` }}>
      <Rail />
      <div className="absolute top-0 bottom-0 overflow-hidden" style={{ left: side.w, right: 0, background: TH.canvas.base }}>
        <Canvas />
      </div>
      {/* everything on the canvas, laid out in frame coordinates */}
      <div className="absolute" style={{ left: -win.x - 1, top: -win.y - 1, width: 1280, height: 596 }}>
        <Header t={t} />
        <Tabs t={t} />
        {/* the scenes: at full strength while the console acts, a little back while the phone does */}
        <div className="absolute inset-0" style={{ opacity: d < 1 ? d : undefined, willChange: "opacity" }}>
          <FilesScene t={t} />
          <ListScene t={t} />
          <NotesScene t={t} />
          <RepliesScene t={t} />
          <MoneyScene t={t} />
        </div>
      </div>
    </div>
  );
}

/**
 * The canvas ground: near-white, a faint dot grid, two static glows: the trade's accent right of centre, and beside it,
 * low left, the colour its page puts next to the accent (theme.ts).
 */
function Canvas() {
  const { dot, glowA, glowB } = TH.canvas;
  const [a, ka] = glowA;
  const [b, kb] = glowB;
  return (
    <>
      <div className="absolute inset-0" style={{ backgroundImage: `radial-gradient(circle at center, ${dot} 0.9px, transparent 1.25px)`, backgroundSize: "20px 20px", backgroundPosition: "6px 6px" }} />
      <div className="absolute" style={{ left: "66%", top: "46%", width: 1120, height: 760, transform: "translate(-50%, -50%)", background: `radial-gradient(closest-side, rgba(${a}, ${ka}), rgba(${a}, ${(ka * 0.35).toFixed(3)}) 55%, rgba(${a}, 0) 100%)` }} />
      <div className="absolute" style={{ left: "30%", top: "74%", width: 840, height: 600, transform: "translate(-50%, -50%)", background: `radial-gradient(closest-side, rgba(${b}, ${kb}), rgba(${b}, 0) 100%)` }} />
    </>
  );
}

/**
 * The console's sidebar as an icon rail (SmartLead's has one too): the Re: mark, and the live console's own nav
 * (apps/web/src/live/LiveShell.tsx: Clients, Needs a person, Texts to send) as icons, Clients selected. Static.
 */
function Rail() {
  const nav = [Users, ListChecks, MessageSquare];
  return (
    <aside className="absolute top-0 bottom-0 left-0 flex flex-col items-center gap-2 bg-surface pt-[20px]" style={{ width: L.side.w, borderRight: `1px solid ${HAIRLINE}` }}>
      <Mark size={32} />
      <span className="mt-4 mb-1 h-px w-7 bg-line" />
      {nav.map((Icon, i) => (
        <span key={i} className={i === 0 ? "grid size-[36px] place-items-center rounded-[11px] bg-accent-soft text-accent-ink" : "grid size-[36px] place-items-center rounded-[11px] text-ink-3"}>
          <Icon size={17} strokeWidth={2} aria-hidden="true" />
        </span>
      ))}
    </aside>
  );
}

/**
 * The client page's header (apps/web/src/live/Client.tsx), simplified: no "All clients" link, no buttons row, no plan
 * or stage pill (he hasn't said yes to a plan; "Free round" says free without its price), no ask card.
 */
function Header({ t }: { t: number }) {
  const b = C.company;
  const trade = playbook(b.trade as TradeId).label;
  // the state pill: waiting for his OK (beats 3–4), then sending (beat 5 to the end); a one pass's sending is over
  // once its last text has gone, so the console says what the live one does then, "Pass done" (old out, new in)
  const warn = and(pop(t, T.note.statePill, 320, 0.85), fadeOut(t, T.ok.flip + 300, 320));
  const sending = and(pop(t, T.send.sending, 320, 0.85), fadeOut(t, ONE_PASS ? T.close.charges : T.close.out, ONE_PASS ? 140 : 360));
  const done = ONE_PASS ? and(pop(t, T.close.charges + 160, 320, 0.85), fadeOut(t, T.close.out, 360)) : gone;
  return (
    <>
      <span className="absolute grid place-items-center rounded-[14px] bg-grad font-display text-[22px] leading-none text-white shadow-glow-sm" style={{ left: L.stage.x, top: 44, width: 46, height: 46 }} aria-hidden="true">
        {(b.name.match(/[A-Za-z0-9]/)?.[0] ?? "·").toUpperCase()}
      </span>
      <div className="absolute flex items-center gap-2.5" style={{ left: L.stage.x + 60, top: 42, height: 30 }}>
        <h1 className="text-[25px] leading-none whitespace-nowrap">{b.name}</h1>
        {/* the state pill: in its own layer, so it comes and goes without moving anything */}
        <span className="relative ml-1 h-5 w-0">
          <span className="absolute top-0 left-0" style={css(warn, { transformOrigin: "left center" })}>
            <Pill tone="warn">Waiting for the owner's OK</Pill>
          </span>
          <span className="absolute top-0 left-0" style={css(sending, { transformOrigin: "left center" })}>
            <Pill tone="ok">
              <Dot tone="ok" /> Sending
            </Pill>
          </span>
          {ONE_PASS && (
            <span className="absolute top-0 left-0" style={css(done, { transformOrigin: "left center" })}>
              <Pill tone="neutral">Pass done</Pill>
            </span>
          )}
        </span>
      </div>
      <p className="absolute text-[12.5px] leading-snug whitespace-nowrap text-ink-3" style={{ left: L.stage.x + 60, top: 75 }}>
        {trade}
        <Sep />
        {b.town}
        <Sep />
        owner {b.ownerName}
        <Sep />
        signs as {b.signerName}
      </p>
    </>
  );
}

/** The eight tabs; the underline glides between them. */
function Tabs({ t }: { t: number }) {
  const row = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<Record<string, { x: number; w: number }> | null>(null);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    // layout px (offsetLeft/offsetWidth), not the screen's: the phone cut draws the film scaled, and a measure taken
    // through its zoom put the underline under the wrong tab
    const r: Record<string, { x: number; w: number }> = {};
    el.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => {
      r[b.dataset.tab!] = { x: b.offsetLeft, w: b.offsetWidth };
    });
    setRects(r);
  }, []);
  // where the underline is: the last move that has started. Neighbours: it slides (sine). Others: it fades out under
  // the old tab and back in under the new one. Only those two labels change colour, crossfading with it.
  let from: TabId = "files";
  let to: TabId = "files";
  let k = 1;
  let slide = true;
  for (const m of TAB_MOVES) {
    if (t < m.at) break;
    from = to;
    to = m.to;
    k = sine(prog(t, m.at, m.dur));
    slide = Math.abs(TABS.findIndex((x) => x.id === from) - TABS.findIndex((x) => x.id === to)) === 1;
  }
  const a = rects?.[from];
  const b = rects?.[to];
  const bar = !a || !b ? null : slide ? { x: lerp(a.x, b.x, k), w: lerp(a.w, b.w, k), o: 1 } : k < 0.45 ? { ...a, o: 1 - sine(k / 0.45) } : { ...b, o: sine((k - 0.45) / 0.55) };
  return (
    <div ref={row} className="absolute flex border-b" style={{ left: L.stage.x, top: 110, width: L.stage.w, height: 36, borderColor: "var(--line)" }}>
      {TABS.map((tb) => {
        const near = tb.id === to ? k : tb.id === from ? 1 - k : 0;
        return (
          <span key={tb.id} data-tab={tb.id} className="-mb-px inline-flex items-center px-3 text-[13.5px] font-semibold whitespace-nowrap" style={{ color: mixColor(TH.tab.quiet, TH.tab.active, near) }}>
            {tb.label}
          </span>
        );
      })}
      {bar && <span className="absolute h-[2px] rounded-full bg-accent" style={{ left: bar.x, width: bar.w, bottom: -1, opacity: bar.o }} />}
    </div>
  );
}
