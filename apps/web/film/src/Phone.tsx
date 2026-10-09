/**
 * The owner's phone: his part of the service, by text. It comes in once (beat 4) and stays beside the console until
 * the offer: the welcome text with the first note, his OK and our answer; the hand-off text, his BOOKED and our
 * answer; the round's last text (its tally and its price line), his YES and our answer, or on a one pass, the pass's
 * last text (its tally and what he paid), which asks him nothing. Every word is content.json's
 * (the engine's texts and the server's replies). Drawn in CSS, iOS colours: grey incoming bubbles, SMS green for his.
 *
 * Its camera moves little (STORYBOARD §3): the welcome text lands on its top (the note he's saying OK to) and hands
 * over softly (fade, drift, blur) to the paragraph that asks for his OK, rather than scrolling 40 lines past; his OK
 * hands over to the thread's end the same way. Later texts scroll in by their own height, never faster than about
 * 12 px a frame. While the console acts, the phone holds still and recedes a little (focus.ts).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, BatteryFull, ChevronRight, Plus, Signal, Wifi } from "lucide-react";
import { C, clock, day, statusClock, TH } from "./data";
import { PHONE_FONT } from "./theme";
import { Mark } from "./parts";
import { dim } from "./focus";
import { clamp, css, easeIn, enter, lerp, outCubic, outQuad, press, prog, sine, still, type M } from "./motion";
import { L, ONE_PASS, T } from "./timeline";

const O = T.ok;
const H = T.handoff;
const X = T.close;
const SCREEN = { w: L.phone.w - 12, h: L.phone.h - 12 };
const TOP = 92; // status bar + thread header
const BOTTOM = 52; // input bar + home indicator
const VIEW = SCREEN.h - TOP - BOTTOM;
const PAD = 10;
/** the thread fades under the header and the input bar */
const EDGE = "linear-gradient(to bottom, rgba(0,0,0,0) 0px, #000 7px, #000 calc(100% - 7px), rgba(0,0,0,0) 100%)";
/** A scroll moves at most this many px a ms at its fastest (a sine: peak π/2 × the average): 12 px a frame at 30 fps. */
const MAX_SPEED = 12 / (1000 / 30);

type Item = { key: string; kind: "date" | "in" | "out"; at: number; text: string; bold?: string };
const tx = C.ownerTexts;
const close = tx.close;
const yes = close?.yes ?? null;
const dateLine = (iso: string) => ({ bold: day(iso), text: ` at ${clock(iso)}` });
const ITEMS: Item[] = [
  { key: "d1", kind: "date", at: O.welcome, ...dateLine(tx.welcome.at) },
  { key: "welcome", kind: "in", at: O.welcome, text: tx.welcome.text },
  { key: "ok", kind: "out", at: O.send, text: tx.ok.text },
  { key: "okReply", kind: "in", at: O.reply, text: tx.ok.reply },
  { key: "d2", kind: "date", at: H.text, ...dateLine(tx.handoff.at) },
  { key: "handoff", kind: "in", at: H.text + 120, text: tx.handoff.text },
  { key: "d3", kind: "date", at: H.send, ...dateLine(tx.booked.at) },
  { key: "booked", kind: "out", at: H.send, text: tx.booked.text },
  { key: "bookedReply", kind: "in", at: H.reply, text: tx.booked.reply },
  ...(close
    ? ([
        { key: "d4", kind: "date", at: X.text, ...dateLine(close.at) },
        { key: "close", kind: "in", at: X.text + 120, text: close.text },
        ...(yes
          ? [
              { key: "yes", kind: "out", at: X.send, text: yes.text },
              { key: "yesReply", kind: "in", at: X.reply, text: yes.reply },
            ]
          : []),
      ] as Item[])
    : []),
];
/** What his status bar says, and from when: each change happens while the thread is moving. */
const CLOCKS: { at: number; iso: string }[] = [
  { at: -Infinity, iso: tx.welcome.at },
  { at: O.hand + 140, iso: tx.ok.at },
  { at: H.text - 150, iso: tx.handoff.at },
  { at: H.type - 150, iso: tx.booked.at },
  ...(close ? [{ at: X.text - 150, iso: close.at }, ...(yes ? [{ at: X.type - 150, iso: yes.at }] : [])] : []),
];
/** The welcome text's paragraph that asks for his OK (the engine's "Reply OK and the first … go out"). */
const WELCOME_PARAS = tx.welcome.text.split("\n\n");
const OK_PARA = WELCOME_PARAS.findIndex((p) => /\bReply OK\b/.test(p));

type Geo = { items: Record<string, { top: number; h: number }>; okPara: { top: number; h: number } | null };

/**
 * The thread's soft handovers: to the paragraph that asks for his OK, and, once he's sent it, to the thread's end. A
 * one pass's hand-off text is taller than his screen: it comes in on a third, to its top (the name, the quote and the
 * heads-up, held), and goes to its end (held) only once he's read that.
 */
const HANDS = [O.hand, O.send, ...(ONE_PASS ? [H.text] : [])];
const HAND_OUT = 200;
const HAND_IN_AT = 140;
const HAND_IN = 380;

export function Phone({ t }: { t: number }) {
  const thread = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  useLayoutEffect(() => {
    const el = thread.current;
    if (!el) return;
    const items: Geo["items"] = {};
    el.querySelectorAll<HTMLElement>("[data-item]").forEach((n) => (items[n.dataset.item!] = { top: n.offsetTop, h: n.offsetHeight }));
    // offsetTop is untouched by transforms; walk up to the thread
    const top = (n: HTMLElement) => {
      let y = 0;
      for (let p: HTMLElement | null = n; p && p !== el; p = p.offsetParent as HTMLElement | null) y += p.offsetTop;
      return y;
    };
    const para = el.querySelector<HTMLElement>(`[data-item="welcome"] [data-para="${OK_PARA}"]`);
    setGeo({ items, okPara: para ? { top: top(para), h: para.offsetHeight } : null });
  }, []);

  // in once, from a little lower, sharpening as it comes; out: drops and blurs. The bezel (the heavier shape) leads
  // both ways, a little: coming in it is there a beat before the screen, going out it goes first and the white screen
  // fades after it, so the phone never reads as a grey wireframe around an empty screen.
  const outAt = close ? X.phoneOut : H.reply + 1200;
  const visible = t >= O.phoneIn && t <= outAt + 400;
  const k = outCubic(prog(t, O.phoneIn, 560));
  const pOut = prog(t, outAt, 340);
  const e = easeIn(pOut);
  const bezelO = outQuad(prog(t, O.phoneIn, 340)) * (1 - sine(prog(t, outAt, 220)));
  const screenO = outQuad(prog(t, O.phoneIn, 380)) * (1 - sine(prog(t, outAt + 50, 290)));
  // a soft focus while it comes in, so its edges never draw a sharp outline at low opacity
  const b = (1 - outCubic(prog(t, O.phoneIn, 480))) * 8 + e * 5;
  const m: M = { o: Math.max(bezelO, screenO) > 0 ? dim(t, "phone") : 0, x: 0, y: (1 - k) * 48 + e * 28, s: lerp(0.97, 1, k), b };

  // the thread: settled at one scroll, or, during a handover, the old view leaving and the new one coming in
  const hand = geo ? HANDS.find((h) => t >= h && t < h + HAND_IN_AT + HAND_IN) : undefined;
  const now = geo ? scrollAt(t, geo) : 0;
  const views: { scroll: number; m: M; measure: boolean }[] =
    hand !== undefined && geo
      ? [
          { scroll: scrollAt(hand - 1, geo), m: leaveView(t, hand), measure: false },
          { scroll: now, m: enterView(t, hand + HAND_IN_AT), measure: true },
        ]
      : [{ scroll: now, m: still, measure: true }];

  return (
    // always laid out (its thread is measured once, after the fonts load), hidden while off screen
    <div className="absolute" style={css(visible ? m : { ...m, o: 0 }, { left: L.phone.x, top: L.phone.y, width: L.phone.w, height: L.phone.h, zIndex: 70, transformOrigin: "50% 100%", fontFamily: PHONE_FONT, fontStretch: "100%" })}>
      {/* the bezel is a ring, not a filled shape: while the screen fades, the page shows through it, never a grey slab */}
      <div className="absolute inset-0 rounded-[38px]" style={{ border: "6px solid #16161A", boxShadow: `0 18px 30px -20px rgba(${TH.shadow}, 0.42), 0 2px 8px rgba(${TH.shadow}, 0.10), inset 0 0 0 1.5px #2a2a30`, opacity: bezelO, willChange: "opacity" }} />
      <div className="absolute overflow-hidden rounded-[32px] bg-white" style={{ left: 6, top: 6, width: SCREEN.w, height: SCREEN.h, opacity: screenO, willChange: "opacity" }}>
        <div className="absolute right-0 left-0 overflow-hidden" style={{ top: TOP, height: VIEW, maskImage: EDGE, WebkitMaskImage: EDGE }}>
          {views.map((v, i) => (
            <div key={v.measure ? "main" : "old"} className="absolute inset-0" style={css(v.m)}>
              <div ref={v.measure ? thread : undefined} className="absolute right-0 left-0 flex flex-col" style={{ top: 0, padding: `${PAD}px 9px`, transform: `translate(0, ${(-v.scroll).toFixed(2)}px)` }}>
                {ITEMS.map((it, j) => (
                  <Bubble key={it.key} it={it} t={i === 0 && views.length > 1 ? hand! - 1 : t} h={geo?.items[it.key]?.h} gapAbove={j === 0 ? 0 : it.kind === "date" ? 14 : ITEMS[j - 1]!.kind === it.kind ? 3 : ITEMS[j - 1]!.kind === "date" ? 6 : 8} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <StatusBar t={t} />
        <ThreadHeader />
        <InputBar t={t} />
        <div className="absolute rounded-full" style={{ left: SCREEN.w / 2 - 38, bottom: 6, width: 76, height: 4, background: "#0a0a0b" }} />
      </div>
    </div>
  );
}

/** A handover's old view: fades quickly, drifts up a little and blurs. */
function leaveView(t: number, at: number): M {
  const p = prog(t, at, HAND_OUT);
  const k = easeIn(p);
  return { o: 1 - sine(p), x: 0, y: -10 * k, s: 1, b: 3 * k };
}
/** A handover's new view: comes in from nothing as the old one has nearly gone, rising and sharpening. */
function enterView(t: number, at: number): M {
  const p = prog(t, at, HAND_IN);
  const k = outCubic(p);
  return { o: outQuad(p), x: 0, y: (1 - k) * 12, s: 1, b: (1 - k) * 4 };
}

/**
 * Where the thread rests. The welcome text shows its top first; after the first handover, the paragraph that asks for
 * his OK, centred; after his OK, the thread's end. Each later text scrolls up by its own height, no faster than 12 px a
 * frame at its fastest, as the bubble comes in.
 */
function scrollAt(t: number, g: Geo): number {
  const bottomOf = (key: string) => Math.max(0, g.items[key]!.top + g.items[key]!.h + PAD - VIEW);
  const okParaAt = g.okPara ? clamp(g.items.welcome!.top + g.okPara.top + g.okPara.h / 2 - VIEW / 2, 0, bottomOf("welcome")) : bottomOf("welcome");
  let s = 0;
  if (t >= O.hand) s = okParaAt;
  if (t >= O.send) s = bottomOf("ok");
  for (const it of ITEMS) {
    if (it.kind === "date" || it.key === "welcome" || it.key === "ok" || !g.items[it.key]) continue;
    if (ONE_PASS && it.key === "handoff") {
      // its top: the date line at the top of his screen; later, its end, scrolled to as gently as any text
      if (t < H.text) continue;
      s = Math.max(s, g.items.d2!.top - 4);
      const to = bottomOf("handoff");
      if (to > s) s = lerp(s, to, sine(prog(t, H.end, Math.max(H.endDur, ((to - s) * Math.PI) / 2 / MAX_SPEED))));
      continue;
    }
    const to = bottomOf(it.key);
    if (t < it.at - 120 || to <= s) continue;
    const dur = Math.max(420, ((to - s) * Math.PI) / 2 / MAX_SPEED);
    s = lerp(s, to, sine(prog(t, it.at - 120, dur)));
  }
  return s;
}

/**
 * What's in the text field: his OK, then his BOOKED, then his YES, typed; the send arrow presses; once the press is
 * done, the words fade from the field as the bubble rises into the thread.
 */
function fieldAt(t: number): { text: string; o: number; tapAt: number } | null {
  const typing = (start: number, tap: number, send: number, text: string, perChar: number) => {
    if (t < start || t >= send + 110) return null;
    return { text: text.slice(0, clamp(Math.floor((t - start) / perChar) + 1, 0, text.length)), o: 1 - sine(prog(t, send, 100)), tapAt: tap };
  };
  return (
    typing(O.typeOk, O.tap, O.send, tx.ok.text, 110) ??
    typing(H.type, H.tap, H.send, tx.booked.text, 30) ??
    (yes ? typing(X.type, X.tap, X.send, yes.text, 110) : null)
  );
}

function Bubble({ it, t, h, gapAbove }: { it: Item; t: number; h?: number; gapAbove: number }) {
  if (it.kind === "date") {
    return (
      <div data-item={it.key} className="text-center text-[11.5px] leading-[14px] text-[#6e6e73]" style={{ marginTop: gapAbove, opacity: outQuad(prog(t, it.at, 300)) }}>
        <span className="font-semibold">{it.bold}</span>
        {it.text}
      </div>
    );
  }
  const mine = it.kind === "out";
  // his: rises out of the text field. Ours: a short one pops from its tail; a tall one (more than about three lines)
  // rises and fades in whole, never scaling a paragraph.
  const tall = h !== undefined ? h > 64 : it.text.length > 90;
  const m = mine ? enter(t, it.at, { dur: 400, rise: 26, blur: 0, scale: 0.96 }) : tall ? enter(t, it.at, { dur: 460, rise: 14, blur: 2 }) : enter(t, it.at, { dur: 320, rise: 0, blur: 0, scale: 0.92 });
  const paras = it.text.split("\n\n");
  return (
    <div data-item={it.key} className={mine ? "self-end" : "self-start"} style={{ marginTop: gapAbove, maxWidth: "84%" }}>
      <div
        className="px-[10px] py-[6px] text-[12.5px] leading-[16.5px]"
        style={css(m, {
          background: mine ? "#34C759" : "#E9E9EB",
          color: mine ? "#ffffff" : "#0A0A0B",
          borderRadius: mine ? "15px 15px 4px 15px" : "15px 15px 15px 4px",
          transformOrigin: mine ? "100% 100%" : "0% 100%",
        })}
      >
        {paras.map((p, i) => (
          <p key={i} data-para={i} className="whitespace-pre-wrap" style={{ marginTop: i ? 7 : 0 }}>
            {linkify(p)}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Phone numbers in a text, underlined as iOS shows them. */
function linkify(text: string): ReactNode {
  const re = /(\+1\d{10}|\(\d{3}\) \d{3}-\d{4})/g;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index));
    out.push(
      <span key={m.index} className="whitespace-nowrap underline decoration-[0.8px] underline-offset-[1.5px]">
        {m[0]}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

/** The status bar: the time of the message on screen. A change fades the old time out, then the new one in. */
function StatusBar({ t }: { t: number }) {
  let i = 0;
  while (i + 1 < CLOCKS.length && t >= CLOCKS[i + 1]!.at) i++;
  const a = i > 0 ? 1 - sine(prog(t, CLOCKS[i]!.at, 90)) : 0;
  const b = i > 0 ? sine(prog(t, CLOCKS[i]!.at + 90, 110)) : 1;
  const prev = i > 0 ? statusClock(CLOCKS[i - 1]!.iso) : "";
  const now = statusClock(CLOCKS[i]!.iso);
  return (
    <div className="absolute top-0 right-0 left-0 flex items-center justify-between bg-white px-[22px]" style={{ height: 38 }}>
      <span className="num relative text-[11.5px] font-semibold tracking-[-0.01em] text-[#0a0a0b]" style={{ width: 40, height: 14 }}>
        {a > 0 && (
          <span className="absolute top-0 left-0" style={{ opacity: a }}>
            {prev}
          </span>
        )}
        <span className="absolute top-0 left-0" style={{ opacity: b, visibility: b <= 0 ? "hidden" : undefined }}>
          {now}
        </span>
      </span>
      <span className="absolute rounded-full bg-[#0a0a0b]" style={{ left: SCREEN.w / 2 - 34, top: 9, width: 68, height: 20 }} />
      <span className="flex items-center gap-[3px] text-[#0a0a0b]">
        <Signal size={11} strokeWidth={2.6} />
        <Wifi size={11} strokeWidth={2.6} />
        <BatteryFull size={15} strokeWidth={2} />
      </span>
    </div>
  );
}

function ThreadHeader() {
  return (
    <div className="absolute right-0 left-0 flex flex-col items-center gap-[3px] border-b border-[#ececf0] bg-white/95" style={{ top: 38, height: TOP - 38 }}>
      <span className="grid size-[30px] place-items-center overflow-hidden rounded-full">
        <Mark size={30} className="rounded-full" />
      </span>
      <span className="flex items-center gap-[1px] text-[10px] leading-none text-[#0a0a0b]">
        Quiet Accounts <ChevronRight size={8} strokeWidth={2.5} className="text-[#8e8e93]" />
      </span>
    </div>
  );
}

function InputBar({ t }: { t: number }) {
  const f = fieldAt(t);
  const o = f?.o ?? 0;
  const arrow = f ? press(t, f.tapAt, 0.82) : 1;
  return (
    <div className="absolute right-0 left-0 flex items-center gap-[7px] bg-white px-[9px]" style={{ bottom: 16, height: 36 }}>
      <span className="grid size-[26px] shrink-0 place-items-center rounded-full bg-[#e9e9eb] text-[#8e8e93]">
        <Plus size={14} strokeWidth={2.5} />
      </span>
      <span className="relative flex h-[28px] min-w-0 flex-1 items-center rounded-full border border-[#d1d1d6] pr-[30px] pl-[11px] text-[12.5px]">
        <span className="absolute top-0 bottom-0 left-[11px] flex items-center text-[#a1a1a6]" style={{ opacity: 1 - o }}>
          Text Message
        </span>
        {f && (
          <span className="relative flex min-w-0 items-center" style={{ opacity: o }}>
            <span className="truncate text-[#0a0a0b]">{f.text}</span>
            {t < f.tapAt && <span className="ml-px inline-block h-[13px] w-[1.5px] bg-[#007aff]" />}
          </span>
        )}
        <span className="absolute grid size-[22px] place-items-center rounded-full bg-[#34C759] text-white" style={{ right: 2.5, top: 2, opacity: o, transform: `scale(${arrow.toFixed(4)})` }}>
          <ArrowUp size={13} strokeWidth={3} />
        </span>
      </span>
    </div>
  );
}
