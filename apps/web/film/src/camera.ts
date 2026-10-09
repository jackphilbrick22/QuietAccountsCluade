/**
 * The phone cut (STORYBOARD §11): the same film, the same clock, framed for a phone. On a 390 px screen the 1280-wide
 * frame puts the app's 13 px text at 4 px; this cut is a square that follows whatever is acting (the export, the list,
 * the note, the notes table, his phone, the replies, the results, the offer) close enough to read, and moves only when
 * the film hands over from one thing to the next, on a sine, never faster than the film's own pan.
 *
 * A camera over the film, not a second layout: every word, time and move is the film's. `z` is how much of the frame
 * it shows (1: 480 CSS px across, the cut's own width; 0.72: 667 px). It never shows more than the frame (z >= 0.8 at
 * the frame's full height) and never enlarges it past its own pixels (z <= 1).
 */
import { L, T } from "./timeline";
import { lerp, prog, sine } from "./motion";
import { noteBox } from "./scenes/List";

/** The cut's layout space (CSS px) and how it's rendered: 480 × 480 at 2.25 → a 1080 × 1080 MP4. */
export const CUT = { w: 480, h: 480, scale: 2.25 };
/** Its edges melt into the page: white, then a fade, wider at the sides (where the camera cuts through the window). */
export const EDGE = { solid: 14, side: 44, top: 26 };
/** The frame px a shot at zoom `z` must keep clear of its side edges for what's in them to read. */
const side = (z: number) => EDGE.side / z + 4;
/** The shot whose left edge leaves `x` clear (`x` reads), at zoom `z`. */
const fromLeft = (x: number, z: number) => x - side(z) + CUT.w / z / 2;
/** The shot whose right edge leaves `x` clear. */
const fromRight = (x: number, z: number) => x + side(z) - CUT.w / z / 2;

export interface Shot {
  /** The point of the frame (frame CSS px) at the cut's centre. */
  cx: number;
  cy: number;
  /** The zoom: the cut shows CUT.w / z frame px across. */
  z: number;
}

/** The frame's middle row (between the header's top and the window's dissolve). */
const MID_Y = 300;
const stageLeft = L.stage.x;

/** Where the camera rests for each part of the film. */
/** The note card's zoom: the card whole, across the cut, between its side edges. */
const noteZ = (w: number) => Math.min(0.8, (CUT.w - 2 * EDGE.side) / (w + 16));
export const SHOTS = {
  /**
   * Where the loop begins and ends: the console's header and its whole row of tabs, so the first picture a phone shows
   * (its start frame, while the film loads) is the app's window, not a crop of it.
   */
  open: { cx: fromLeft(stageLeft - 6, 0.65), cy: MID_Y - 10, z: 0.65 },
  /** His export and the list: the left of the canvas (the chip, his file, the names and what they had done). */
  console: { cx: fromLeft(stageLeft + 14, 0.78), cy: MID_Y, z: 0.78 },
  /** The note card, whole, in the middle of the canvas (its width is the card's, measured). */
  note: (): Shot => {
    const b = noteBox();
    return { cx: b.x + b.w / 2, cy: b.y + b.h / 2 - 8, z: noteZ(b.w) };
  },
  /** The card's chips: the three chips beside it, whole and close, and the end of the card beside them. */
  chips: (): Shot => {
    const b = noteBox();
    return { cx: fromRight(b.chipsX + 292, 0.8), cy: b.y + b.h / 2 - 8, z: 0.8 };
  },
  /** The notes table: when each goes out, who to, which note, what about. */
  notes: { cx: fromLeft(stageLeft + 14, 0.78), cy: MID_Y, z: 0.78 },
  /** His phone, whole, and the console's column beside it (the notes' status as it flips to Scheduled). */
  phone: { cx: fromRight(L.phone.x + L.phone.w, 0.92), cy: L.phone.y + L.phone.h / 2, z: 0.92 },
  /**
   * His phone nearly alone: for his texts when the console beside it has nothing to read in the strip a square leaves
   * (the replies' cards cut down to their labels and dates, the ledger's last column cut through its words). The strip
   * left is the console's right edge, faded; the page's white is on the other side.
   */
  phoneOnly: { cx: L.phone.x + L.phone.w / 2 + 40, cy: L.phone.y + L.phone.h / 2, z: 0.92 },
  /** The replies: who wrote, what they said, what we wrote back, and the two chips. */
  replies: { cx: fromLeft(stageLeft + 16, 0.68), cy: MID_Y, z: 0.68 },
  /** The results: what booked, the second figure, and the ledger's name, job and value. */
  money: { cx: fromLeft(stageLeft + 14, 0.66), cy: MID_Y + 4, z: 0.66 },
  /** The offer, centred under the figure it rests on. */
  offer: { cx: L.stage.x + L.stage.w / 2, cy: MID_Y + 8, z: 0.66 },
} as const;

type Target = Shot | (() => Shot);
/** The camera's moves: from `at`, over `dur` ms, on a sine, to the shot. Before the first, it's on the window (`open`). */
export const MOVES: { at: number; to: Target; dur: number }[] = [
  // his export arrives: in from the window to the left of the canvas, close enough to read it
  { at: T.files.chip - 200, to: SHOTS.console, dur: 900 },
  // the chosen row rises to the top and draws in to the note's width: the camera comes in to the note with it
  { at: T.list.rise, to: SHOTS.note, dur: 900 },
  // the note is typed and signed: over to its chips as they come in, then back as the table rises
  { at: T.note.footer + 100, to: SHOTS.chips, dur: 800 },
  { at: T.note.out, to: SHOTS.notes, dur: 900 },
  // his phone comes in: the camera goes with it, keeping the notes' status beside it
  { at: T.ok.phoneIn - 100, to: SHOTS.phone, dur: 1100 },
  // the view pans to Replies: the camera follows it in, as it lands
  { at: T.send.pan + 500, to: SHOTS.replies, dur: 1300 },
  // the hand-off goes to his phone: back to it
  { at: T.handoff.chip + 350, to: SHOTS.phoneOnly, dur: 1200 },
  { at: T.money.out - 100, to: SHOTS.money, dur: 1100 },
  // the results' last figures land first; then to his phone, arriving as the last text scrolls in
  { at: T.close.text - 450, to: SHOTS.phoneOnly, dur: 900 },
  { at: T.close.phoneOut - 100, to: SHOTS.offer, dur: 900 },
  // back to where the loop began, while everything fades: the seam
  { at: T.close.out, to: SHOTS.open, dur: 700 },
];

const resolve = (s: Target): Shot => (typeof s === "function" ? s() : s);

/** Where the camera is at `t`. */
export function camera(t: number): Shot {
  let at: Shot = SHOTS.open;
  for (const m of MOVES) {
    if (t < m.at) break;
    const to = resolve(m.to);
    const k = sine(prog(t, m.at, m.dur));
    at = { cx: lerp(at.cx, to.cx, k), cy: lerp(at.cy, to.cy, k), z: lerp(at.z, to.z, k) };
  }
  return at;
}
