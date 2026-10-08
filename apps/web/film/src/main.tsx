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
import { DURATION } from "./timeline";

declare global {
  interface Window {
    __film: { duration: number; ready: Promise<void>; seek: (ms: number) => Promise<void>; fontsOk: () => boolean };
    __seek: (ms: number) => Promise<void>;
  }
}

let setClock: (t: number) => void = () => {};
function App() {
  const [t, setT] = useState(() => Number(new URLSearchParams(location.search).get("t") ?? 0));
  setClock = setT;
  return <Film t={t} />;
}

const painted = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const fontsOk = () => document.fonts.check('24px "Cal Sans"') && document.fonts.check('14px "Inter"') && document.fonts.check('600 14px "Inter"');

async function start() {
  // the fonts first, so the very first layout (and every measurement) is in the right faces
  await Promise.all(['24px "Cal Sans"', '400 14px "Inter"', '500 14px "Inter"', '600 14px "Inter"', '700 14px "Inter"'].map((f) => document.fonts.load(f)));
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
window.__film = { duration: DURATION, ready, seek, fontsOk };
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
