/**
 * The film's beat sheet as data (STORYBOARD §5 and §9), in milliseconds on the loop, and its layout in CSS px on the
 * 1280 × 596 frame (rendered at 1.5x). The scenes read their times from here and nothing else.
 *
 * A one pass (fence, tree) closes on the pass's own last text, which asks him nothing: no YES to type, so its phone
 * leaves 1.3 s sooner, and its offer (the pass promise, two sentences) holds 0.2 s longer. 34.4 s, against 35.5.
 * Its hand-off text is taller than his screen (the quote, and the heads-up to re-price it), so it's shown in two views,
 * its top and then its end, which takes 0.75 s; that comes out of the pass's last text, where the console answers the
 * phone (what he paid) instead of both holding still.
 */
import { C } from "./data";

/** Fence and tree sell the one pass; lawn and cleaning the free 150 and then monthly. */
export const ONE_PASS = C.offer.kind === "one_pass";
/** How much sooner the one pass's close ends (no YES), and how much longer its offer holds. */
const CUT = ONE_PASS ? 1300 : 0;
const HOLD = ONE_PASS ? 200 : 0;
/** How much longer a one pass's hand-off text takes (two views), paid for out of its close. */
const HANDOFF = ONE_PASS ? 750 : 0;
export const DURATION = 35_500 - CUT + HOLD;
export const FPS = 30;
export const FRAME = { w: 1280, h: 596, scale: 1.5 };

/** The layout, CSS px (STORYBOARD §2). */
export const L = {
  margin: 20,
  win: { x: 20, y: 20, w: 1240, h: 576 },
  /** an icon rail, like SmartLead's: the canvas gets the width */
  side: { w: 60 },
  canvas: { x: 80 },
  /** the content: full width, or narrow beside the phone (from the Notes table on) */
  stage: { x: 108, y: 170, w: 1128, narrow: 854 },
  /** the canvas below the tabs, where a scene's block is centred (it ends where the window dissolves) */
  zone: { top: 160, bottom: 526 },
  /** where the window dissolves into white */
  dissolve: { from: 526, to: 579 },
  /** the owner's phone: its bottom and its shadow are clear of the dissolve's end */
  phone: { x: 994, y: 62, w: 240, h: 458 },
};

/** The client page's tabs, in the app's order (apps/web/src/live/Client.tsx). */
export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "opportunities", label: "List" },
  { id: "notes", label: "Notes" },
  { id: "replies", label: "Replies" },
  { id: "texts", label: "Texts to owner" },
  { id: "activity", label: "Activity" },
  { id: "files", label: "Files" },
  { id: "settings", label: "Settings" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

/**
 * One thing at a time. While the phone is on screen, the side that acts leads and the other holds still and recedes
 * a little (FOCUS below); a phone event and a console event are never closer than about 0.3 s.
 */
export const T = {
  /** Beat 1: his export comes in (Files). */
  files: { chip: 300, sent: 560, table: 1060, rowsCount: 1200, chips: 1640, out: 2300 },
  /** Beat 2: the list (List). The one we follow lifts by itself and, once the others are gone, rises to the top. */
  list: { chip: 2420, people: 2540, stagger: 70, hover: 3700, lift: 3800, othersOut: 4150, othersDur: 200, rise: 4310, riseDur: 600 },
  /** Beat 3: the note we write, in his name (Notes). Then every note waits for his OK. */
  note: { open: 4950, type: 5200, typeDur: 1400, footer: 6600, chips: 6760, out: 7600, chipsIn: 7800, tableIn: 7860, statePill: 8720 },
  /**
   * Beat 4: nothing goes until he texts OK. The welcome text lands on its top (the note he's saying OK to), hands over
   * softly to the paragraph that asks for his OK, he types it; then the console schedules every note; then our answer.
   */
  ok: { phoneIn: 9050, welcome: 9480, hand: 10800, typeOk: 12000, tap: 12260, send: 12600, flip: 13400, reply: 14450 },
  /**
   * Beat 5: the first day's notes go out; every reply is read, sorted and answered (Notes → Replies). The last two
   * replies arrive from `arrive`, `gap` apart, the one we follow last (18.45 s); our answer opens 0.6 s after it.
   */
  send: { sent: 15300, sentGap: 90, sending: 15300, pan: 15950, panDur: 1650, arrive: 17800, gap: 650 },
  /**
   * Beat 6: we text him the one who wants the work (the chip, then the phone), and his BOOKED. A one pass's hand-off
   * comes in on its top (the name, the quote, the heads-up), held 0.65 s once it's in, then goes to its end (`end`, a
   * 0.8 s sine: the longest move on his phone, never a lurch), held, before BOOKED.
   */
  handoff: { chip: 20050, text: 20450, end: 21650, endDur: 800, type: 22350 + HANDOFF, tap: 22800 + HANDOFF, send: 23140 + HANDOFF, reply: 23650 + HANDOFF },
  /** Beat 7: it shows up in his results (Overview); the round's other bookings land as the weeks go by. */
  money: { out: 24450 + HANDOFF, tiles: 24600 + HANDOFF, ledger: 24750 + HANDOFF, featured: 25250 + HANDOFF, rest: 26200 + HANDOFF, restGap: 420 },
  /**
   * Beat 8: the round's last text, his YES; the offer; back to the empty canvas. A one pass's last text has nothing to
   * answer: once he's read it, the console answers it instead, one thing at a time: the state pill to "Pass done"
   * (`charges`), Booked to the pass's end (`booked`: the jobs past the ledger's last row, marked with the day the pass
   * ended), and the billing figure to the console's own Charges figure, what he paid (`chargesFig`).
   */
  close: { text: 27550 + HANDOFF, charges: 29900, booked: 30100, chargesFig: 30300, type: 29350, tap: 29700, send: 30040, reply: 30500, phoneOut: 32200 - CUT, offer: 32400 - CUT, chip1: 32750 - CUT, chip2: 32930 - CUT, out: 34750 - CUT + HOLD },
};

/** Which side acts, from when (STORYBOARD §3): the other side, if it's on screen, recedes to `IDLE`. */
export const IDLE = 0.84;
export const FOCUS: { at: number; to: "console" | "phone" }[] = [
  { at: -Infinity, to: "console" },
  // the console recedes once the phone is mostly in, not while it's coming (two big changes at once)
  { at: T.ok.phoneIn + 300, to: "phone" },
  { at: T.ok.flip - 150, to: "console" },
  { at: T.ok.reply - 150, to: "phone" },
  { at: T.send.sent - 150, to: "console" },
  { at: T.handoff.text - 150, to: "phone" },
  { at: T.money.out - 50, to: "console" },
  { at: T.close.text - 150, to: "phone" },
  ...(ONE_PASS ? [{ at: T.close.charges - 150, to: "console" as const }] : []),
  { at: T.close.phoneOut, to: "console" },
];

/**
 * The tab underline's moves: Files → List → Notes → Replies → Overview → Files. Between neighbours it slides; between
 * tabs that aren't, it fades out under the old tab and in under the new one, so nothing travels across the chrome.
 */
export const TAB_MOVES: { at: number; to: TabId; dur: number }[] = [
  { at: T.files.out, to: "opportunities", dur: 420 },
  { at: T.list.rise + 100, to: "notes", dur: 600 },
  { at: T.send.pan, to: "replies", dur: T.send.panDur },
  { at: T.money.out, to: "overview", dur: 420 },
  { at: T.close.out, to: "files", dur: 480 },
];
