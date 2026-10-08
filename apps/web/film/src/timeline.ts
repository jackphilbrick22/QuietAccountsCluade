/**
 * The film's beat sheet as data (STORYBOARD §5 and §9), in milliseconds on the loop, and its layout in CSS px on the
 * 1280 × 596 frame (rendered at 1.5x). The scenes read their times from here and nothing else.
 */
export const DURATION = 35_500;
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
  /** Beat 5: the first day's notes go out; every reply is read, sorted and answered (Notes → Replies). */
  send: { sent: 15300, sentGap: 90, sending: 15300, pan: 15950, panDur: 1650, arrive: 17800, gap: 650, ack: 19050 },
  /** Beat 6: we text him the one who wants the work (the chip, then the phone), and his BOOKED. */
  handoff: { chip: 20050, text: 20450, type: 22350, tap: 22800, send: 23140, reply: 23650 },
  /** Beat 7: it shows up in his results (Overview); the round's other bookings land as the weeks go by. */
  money: { out: 24450, tiles: 24600, ledger: 24750, featured: 25250, rest: 26200, restGap: 420 },
  /** Beat 8: the round's last text, his YES; the offer; back to the empty canvas. */
  close: { text: 27550, type: 29350, tap: 29700, send: 30040, reply: 30500, phoneOut: 32200, offer: 32400, chip1: 32750, chip2: 32930, out: 34750 },
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
