/**
 * The film page. One clock: `window.__film.seek(ms)` renders the frame for that moment synchronously and resolves once
 * it is painted. Nothing moves between seeks (no CSS transitions, no timers), so every frame is the same every time.
 *   ?t=12650   shows that moment (for looking at one frame in a browser)
 *   ?play      plays it in real time (for watching; renders use seek)
 */
import "../fonts/fonts.css";
import "./film.css";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useState } from "react";
import { Film } from "./Film";
import { PhoneCut } from "./PhoneCut";
import { CUT } from "./camera";
import { TH } from "./data";
import { applyTheme } from "./theme";
import { DURATION, FRAME } from "./timeline";

declare global {
  interface Window {
    __film: { duration: number; ready: Promise<void>; seek: (ms: number) => Promise<void>; fontsOk: () => boolean; size: { w: number; h: number; scale: number } };
    __seek: (ms: number) => Promise<void>;
  }
}

/** ?cut=phone: the phone cut (camera.ts), a 480 × 480 square; otherwise the film's own 1280 × 596 frame. */
const PHONE = new URLSearchParams(location.search).get("cut") === "phone";
const SIZE = PHONE ? CUT : FRAME;
for (const el of [document.documentElement, document.body, document.getElementById("root")!]) {
  el.style.width = `${SIZE.w}px`;
  el.style.height = `${SIZE.h}px`;
}

let setClock: (t: number) => void = () => {};
function App() {
  const [t, setT] = useState(() => Number(new URLSearchParams(location.search).get("t") ?? 0));
  setClock = setT;
  return PHONE ? <PhoneCut t={t} /> : <Film t={t} />;
}

const painted = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const fontsOk = () => TH.fonts.load.every((f) => document.fonts.check(f));

async function start() {
  // the trade page's look, then its fonts, so the very first layout (and every measurement) is in the right faces
  applyTheme(TH);
  await Promise.all(TH.fonts.load.map((f) => document.fonts.load(f)));
  await document.fonts.ready;
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<App />));
  await painted();
  await painted();
}

const ready = start();
const seek = async (ms: number) => {
  await ready;
  flushSync(() => setClock(ms));
  await document.fonts.ready;
  await painted();
};
window.__film = { duration: DURATION, ready, seek, fontsOk, size: SIZE };
window.__seek = seek;

if (new URLSearchParams(location.search).has("play")) {
  void ready.then(() => {
    const t0 = performance.now();
    const tick = () => {
      flushSync(() => setClock((performance.now() - t0) % DURATION));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
