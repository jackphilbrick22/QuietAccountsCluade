/**
 * The film's motion vocabulary (STORYBOARD §3). Everything is a pure function of the film clock `t` in milliseconds:
 * no CSS transitions, no timers, so any frame renders the same every time it is asked for.
 */
import type { CSSProperties } from "react";

/** A CSS cubic-bezier as a function of progress 0..1. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(u) - x;
      if (Math.abs(e) < 1e-7) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= e / d;
    }
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

export const out = bezier(0.22, 1, 0.36, 1);
export const inOut = bezier(0.65, 0, 0.35, 1);
export const easeIn = bezier(0.55, 0, 1, 0.45);
/** Sine in-out: the gentlest curve that starts and lands at rest (peak speed π/2 × the average). Fades and pans. */
export const sine = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * p));
/** Ease-out with a soft start: an element's opacity coming in (no frame jumps much past a fifth). */
export const outQuad = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - (1 - p) * (1 - p));
/** A gentle ease-out (easeOutCubic): a glide or a slide that settles without darting. */
export const outCubic = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - (1 - p) ** 3);

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
/** Progress of `t` through [at, at + dur], 0..1. */
export const prog = (t: number, at: number, dur: number) => (dur <= 0 ? (t >= at ? 1 : 0) : clamp((t - at) / dur));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** A moving element's state: opacity, offset, scale, blur. Combine with `and`, turn into a style with `css`. */
export interface M {
  o: number;
  x: number;
  y: number;
  s: number;
  b: number;
}
export const still: M = { o: 1, x: 0, y: 0, s: 1, b: 0 };
export const gone: M = { o: 0, x: 0, y: 0, s: 1, b: 0 };

export function and(...ms: M[]): M {
  return ms.reduce((a, m) => ({ o: a.o * m.o, x: a.x + m.x, y: a.y + m.y, s: a.s * m.s, b: a.b + m.b }), still);
}

/**
 * Card in: opacity 0 → 1, rise, blur → 0, all on gentle ease-outs that finish together (SmartLead's card rise spreads
 * over about 0.4 s: 12, 10, 4, 2, 1 px per 0.1 s), so nothing darts into place and then sits half there.
 */
export function enter(t: number, at: number, o: { dur?: number; rise?: number; blur?: number; scale?: number } = {}): M {
  const { dur = 480, rise = 40, blur = 4, scale = 1 } = o;
  const p = prog(t, at, dur);
  const k = outCubic(p);
  return { o: outQuad(p), x: 0, y: (1 - k) * rise, s: lerp(scale, 1, k), b: (1 - k) * blur };
}

/** Rows and chips in: a smaller rise. */
export const rowIn = (t: number, at: number) => enter(t, at, { dur: 420, rise: 10, blur: 2 });
export const chipIn = (t: number, at: number) => enter(t, at, { dur: 380, rise: 12, blur: 0 });

/**
 * Handover out: fade, drift up, blur. The drift and blur ease in; the opacity lands softly on 0 (a sine), so nothing
 * is still half there on the frame before it's gone.
 */
export function leave(t: number, at: number, o: { dur?: number; drift?: number; blur?: number } = {}): M {
  const { dur = 320, drift = 8, blur = 6 } = o;
  const p = prog(t, at, dur);
  const k = easeIn(p);
  return { o: 1 - sine(p), x: 0, y: -drift * k, s: 1, b: blur * k };
}

/** Handover in: already at 30 % on its first frame, rising 12 px and sharpening, ease-out. */
export function handIn(t: number, at: number, o: { dur?: number; rise?: number; blur?: number; from?: number } = {}): M {
  const { dur = 400, rise = 12, blur = 6, from = 0.3 } = o;
  if (t < at) return gone;
  const p = prog(t, at, dur);
  const k = outCubic(p);
  return { o: lerp(from, 1, outQuad(p)), x: 0, y: (1 - k) * rise, s: 1, b: (1 - k) * blur };
}

/** A pop: scale up from a corner and fade in (bubbles, pills). */
export function pop(t: number, at: number, dur = 280, from = 0.92): M {
  const k = out(prog(t, at, dur));
  return { o: prog(t, at, dur * 0.6), x: 0, y: 0, s: lerp(from, 1, k), b: 0 };
}

/**
 * A label that changes in place: the old one fades fully out, then the new one fades in (never two labels printed over
 * each other). Returns each one's opacity and the new one's small rise.
 */
export function swap(t: number, at: number, outDur = 120, inDur = 180): { a: number; b: number; y: number } {
  const a = 1 - sine(prog(t, at, outDur));
  const pb = prog(t, at + outDur, inDur);
  return { a, b: sine(pb), y: (1 - outCubic(pb)) * 4 };
}

/** A plain fade out, landing softly. */
export function fadeOut(t: number, at: number, dur = 300): M {
  return { ...still, o: 1 - sine(prog(t, at, dur)) };
}

/** A plain fade in, starting softly. */
export function fadeIn(t: number, at: number, dur = 300): M {
  return { ...still, o: sine(prog(t, at, dur)) };
}

/** The press: down to `depth` over 120 ms, hold 60 ms, back over 160 ms. */
export function press(t: number, at: number, depth = 0.94): number {
  if (t < at) return 1;
  if (t < at + 120) return lerp(1, depth, inOut(prog(t, at, 120)));
  if (t < at + 180) return depth;
  return lerp(depth, 1, out(prog(t, at + 180, 160)));
}

/** A count from `from` to `to`, 700 ms ease-out, landing exactly on `to`. */
export function count(t: number, at: number, from: number, to: number, dur = 700): number {
  const k = out(prog(t, at, dur));
  return k >= 1 ? to : from + (to - from) * k;
}

/** Steps: the value after each (at, value) that has started, counting up into it. */
export function steps(t: number, start: number, list: { at: number; to: number }[], dur = 600): number {
  let v = start;
  for (const s of list) {
    if (t < s.at) break;
    v = count(t, s.at, v, s.to, dur);
  }
  return v;
}

/** Decelerating typing: about 2.7× faster at the start than at the end. */
export function typed(t: number, at: number, dur: number, n: number): number {
  const p = prog(t, at, dur);
  const k = 0.46;
  return Math.round(n * (p + k * p * (1 - p)));
}

/** The style for a moving element. `origin` for scale. */
export function css(m: M, extra: CSSProperties = {}): CSSProperties {
  // always its own layer, at rest too: Chromium draws text in a layer a hair differently, so an element that only got
  // one when it started to fade would jump on that frame
  const s: CSSProperties = { willChange: "opacity", ...extra };
  if (m.o < 1) s.opacity = Math.max(0, m.o);
  if (m.o <= 0.001) s.visibility = "hidden";
  const tr: string[] = [];
  if (m.x || m.y) tr.push(`translate(${m.x.toFixed(3)}px, ${m.y.toFixed(3)}px)`);
  if (m.s !== 1) tr.push(`scale(${m.s.toFixed(5)})`);
  if (extra.transform) tr.push(String(extra.transform));
  if (tr.length) s.transform = tr.join(" ");
  if (m.b > 0.02) s.filter = `blur(${m.b.toFixed(2)}px)`;
  return s;
}

/** Linear colour mix of two #rrggbb colours. */
export function mixColor(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i]!, clamp(k)))).join(", ")})`;
}
