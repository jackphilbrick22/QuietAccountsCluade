/**
 * Beats 7 and 8 — it shows up in his results (Overview tab): two figures, what booked and how many asked to come
 * back, and the owner app's ledger; his booking slides in on top, then the round's other bookings land as the weeks go
 * by, so the console reads what the round's last text will say. Then the offer: the money and the ledger leave with
 * the phone, the one number the promise depends on (how many asked to come back) settles in the middle, and the two
 * offer lines rise under it as the largest words on screen. Then back to the empty canvas.
 *
 * A one pass's second figure is its billing (the console's "Billable bookings": one per customer, up to the cap, and
 * how many more booked past it), and the number its promise depends on is what booked: that figure settles in the
 * middle, with the pass promise under it, its two sentences on two lines.
 */
import { CalendarCheck, CircleDollarSign, ShieldCheck } from "lucide-react";
import { fmtMoney, plural } from "@qa/engine";
import { cx, Pill } from "../../../src/components/ui";
import { MATCH_LABEL } from "../../../src/lib/labels";
import { C, short } from "../data";
import { and, count, css, enter, leave, lerp, outCubic, prog, sine, steps, swap, type M } from "../motion";
import { HeadRow, MeaningChip } from "../parts";
import { L, ONE_PASS, T } from "../timeline";

const S = T.money;
const X = T.close;
const COLS = "minmax(0,1.3fr) minmax(0,1.6fr) minmax(0,0.8fr) minmax(0,0.9fr) minmax(0,1.2fr)";
const ROW_H = 38;
const TILES_Y = 170;
const TILE_GAP = 12;
const TILE_W = (L.stage.narrow - TILE_GAP) / 2;
const TILE_H = 116;
const LEDGER_TOP = TILES_Y + TILE_H + 16;
const MID = (L.zone.top + L.zone.bottom) / 2;
/** The offer's block (the figure 116, 22, two lines 44 + 12 + 44) centred in the canvas. */
const OFFER_TOP = Math.round(MID - (TILE_H + 22 + 100) / 2);

const R = C.recovered;
/** A one pass's billable bookings: before his BOOKED, with it, and at the pass's end (content.ts, the engine's count). */
type Billing = { billable: number; overCap: number; cap: number; paid: number; most: number };
const BILL = R.billing as { before: Billing; atBooking: Billing; atLast: Billing; end: Billing } | null;
/** The ledger's rows on screen (the last few before his, his, the rest), in the order they reached his results. */
const byTime = [...R.ledger].sort((a, b) => (a.reachedAt < b.reachedAt ? -1 : 1));
const featuredRow = byTime.find((r) => r.name === C.featured.name) ?? byTime[0]!;
const fAt = byTime.indexOf(featuredRow);
/** When each booking is in the ledger: the ones before his when it rises, his, then the rest as the weeks go by. */
const landAt = byTime.map((_, i) => (i < fAt ? -Infinity : i === fAt ? S.featured : S.rest + (i - fAt - 1) * S.restGap));
const lastLand = Math.max(...landAt);

export function MoneyScene({ t }: { t: number }) {
  if (t < S.tiles || t > X.out + 700) return null;
  const end = leave(t, X.out, { dur: 600, drift: 10, blur: 6 });
  return (
    <>
      <Tiles t={t} end={end} />
      <Ledger t={t} />
      <Offer t={t} end={end} />
    </>
  );
}

/**
 * Two figures in the console's Figures look: what booked, in the page's own money colour (its accent, as the trade
 * page sets its money; green is the app's for a status, Sent and Sending), and how many asked to come back.
 */
function Tiles({ t, end }: { t: number; end: M }) {
  // the last row to land brings the free round's figures to its end (its last bookings, under the fade); a one pass
  // books on for weeks past the rows on screen, so its end is a beat of its own (below)
  const last = byTime.length - 1;
  const toEnd = (i: number) => i === last && last > fAt && !BILL;
  const booked = steps(
    t,
    R.before,
    byTime.map((_, i) => ({ at: landAt[i]! + 80, to: toEnd(i) ? R.endOfRun.bookedValue : R.before + byTime.slice(fAt, i + 1).reduce((s, x) => s + x.value, 0) })).filter((_, i) => i >= fAt),
    650,
  );
  // the jobs before his (all of them, not only the rows on screen), then each that lands, counting with the money
  const jobs = Math.round(steps(t, R.jobsBefore, byTime.map((_, i) => ({ at: landAt[i]! + 80, to: toEnd(i) ? R.endOfRun.booked : R.jobsBefore + i - fAt + 1 })).filter((_, i) => i >= fAt), 650));
  // the round's tally moves with the bookings that land after his
  const asked = count(t, S.rest + 80, R.atBooking.asked, R.endOfRun.askedToComeBack, 650 + (lastLand - S.rest));
  const replied = count(t, S.rest + 80, R.atBooking.replied, R.endOfRun.replied, 650 + (lastLand - S.rest));
  const inM = enter(t, S.tiles, { rise: 16, blur: 3 });
  // the money leaves with the phone; the number the promise depends on glides to the middle
  const money = and(inM, leave(t, X.phoneOut, { dur: 420, drift: 6, blur: 3 }));
  const glide = sine(prog(t, X.offer, 650));
  const centre = { x: L.stage.x + (L.stage.w - TILE_W) / 2, y: OFFER_TOP };
  if (BILL) {
    // a one pass: what booked glides to the middle (its promise is per job that books); its billing leaves with the phone.
    // The billing counts with the rows on screen: his booking, then the ledger's last row (Booked and it add up)
    const over = steps(t, BILL.before.overCap, [{ at: S.featured + 80, to: BILL.atBooking.overCap }, ...(lastLand > S.featured ? [{ at: lastLand + 80, to: BILL.atLast.overCap }] : [])], 650);
    const bookedM = and(inM, end);
    // once he's read the pass's last text, the console answers it, one figure at a time (the old words out, then the
    // new in, never printed over each other): Booked to the pass's end, marked with the day it ended (the weeks of
    // bookings past the ledger's last row); then the billing figure to the console's own Charges figure, what he paid
    const swB = swap(t, X.booked, 160, 260);
    const sw = swap(t, X.chargesFig, 160, 260);
    const at = { x: L.stage.x + TILE_W + TILE_GAP, y: TILES_Y };
    const bookedAt = { x: lerp(L.stage.x, centre.x, glide), y: lerp(TILES_Y, centre.y, glide) };
    const endOn = C.ownerTexts.close?.at;
    return (
      <>
        <Tile m={bookedM} {...bookedAt} label="Booked" value={fmtMoney(booked)} sub={plural(jobs, "job")} tone="text-accent" inner={swB.a} />
        <Tile m={bookedM} {...bookedAt} label="Booked" value={fmtMoney(R.endOfRun.bookedValue)} sub={`${plural(R.endOfRun.booked, "job")}${endOn ? ` · pass done ${short(endOn)}` : ""}`} tone="text-accent" inner={swB.b} innerY={swB.y} under />
        <Tile m={money} {...at} label="Billable bookings" value={`${BILL.end.billable} of ${BILL.end.cap}`} sub={`${Math.round(over)} more past the cap`} tone="text-accent-ink" inner={sw.a} />
        <Tile m={money} {...at} label="Charges" value={fmtMoney(BILL.end.paid)} sub={`paid, of ${fmtMoney(BILL.end.most)}`} tone="text-accent" inner={sw.b} innerY={sw.y} under />
      </>
    );
  }
  const askedM = and(inM, end);
  return (
    <>
      <Tile m={money} x={L.stage.x} y={TILES_Y} label="Booked" value={fmtMoney(booked)} sub={plural(jobs, "job")} tone="text-accent" />
      <Tile m={askedM} x={lerp(L.stage.x + TILE_W + TILE_GAP, centre.x, glide)} y={lerp(TILES_Y, centre.y, glide)} label={C.offer.wanted.label} value={Math.round(asked).toLocaleString("en-US")} sub={`${Math.round(replied)} wrote back`} tone="text-accent-ink" />
    </>
  );
}

/**
 * A figure. `inner` fades its words alone (a figure that gives way to another in the same card: the card stays, its
 * words change); `under` draws only the words, over the card of the figure it replaces.
 */
function Tile({ m, x, y, label, value, sub, tone, inner = 1, innerY = 0, under }: { m: M; x: number; y: number; label: string; value: string; sub: string; tone: string; inner?: number; innerY?: number; under?: boolean }) {
  if (under && inner <= 0) return null;
  const words = { opacity: inner < 1 ? Math.max(0, inner) : undefined, visibility: inner <= 0 ? ("hidden" as const) : undefined, transform: innerY ? `translate(0, ${innerY.toFixed(2)}px)` : undefined, willChange: "opacity" };
  return (
    <dl className={cx("absolute flex flex-col gap-1.5 rounded-card px-5 py-5", !under && "border border-line bg-surface shadow-card", under && "border border-transparent")} style={css(m, { left: x, top: y, width: TILE_W, height: TILE_H })}>
      <dt className="order-2 text-[13.5px] leading-snug font-medium text-ink-2" style={words}>
        {label}
      </dt>
      <dd className={cx("num order-1 font-display text-[40px] leading-none", tone)} style={words}>
        {value}
      </dd>
      <dd className="num order-3 text-[12.5px] leading-snug text-ink-3" style={words}>
        {sub}
      </dd>
    </dl>
  );
}

/** The owner app's Recovered ledger, newest first: his booking slides in on top, then the round's others. */
function Ledger({ t }: { t: number }) {
  if (t < S.ledger || t > X.phoneOut + 500) return null;
  const m = and(enter(t, S.ledger, { rise: 20, blur: 3 }), leave(t, X.phoneOut, { dur: 420, drift: 6, blur: 3 }));
  const landed = landAt.map((a) => outCubic(prog(t, a, 420)));
  // a ledger with more rows than these (a one pass books dozens) runs on under the fade, never ending on screen
  const h = Math.max(34 + landed.reduce((s, x) => s + x, 0) * ROW_H + 2, R.jobsBefore > fAt ? 262 : 0);
  // the ledger runs on toward the window's bottom edge: it fades out there instead of ending
  const mask = "linear-gradient(to bottom, #000 0px, #000 190px, rgba(0,0,0,0.55) 215px, rgba(0,0,0,0) 250px)";
  return (
    <div className="absolute" style={css(m, { left: L.stage.x, top: LEDGER_TOP, width: L.stage.narrow, height: h, maskImage: mask, WebkitMaskImage: mask })}>
      <div className="absolute inset-0 overflow-hidden rounded-box border border-line bg-surface shadow-card" />
      <HeadRow cols={COLS} cells={["Name", "Job", "Value", "Came back on", "How we matched it"]} right={[2]} className="relative" />
      {byTime.map((r, i) => {
        const a = landAt[i]!;
        if (t < a) return null;
        // newest on top: a row sits under every row that landed after it
        const top = 35 + landed.slice(i + 1).reduce((s, x) => s + x, 0) * ROW_H;
        const inM = enter(t, a + 120, { dur: 420, rise: -8, blur: 2 });
        const flash = i === fAt ? 1 - sine(prog(t, a + 500, 900)) : i > fAt ? 1 - sine(prog(t, a + 500, 700)) : 0;
        return (
          <div
            key={r.name}
            className="absolute right-0 left-0 grid items-center border-b border-line px-4 text-[13.5px]"
            // moved by a transform, not by `top`: a slow slide then glides instead of snapping a pixel on one frame
            style={css({ ...inM, y: inM.y + top - 35 }, { top: 35, height: ROW_H, gridTemplateColumns: COLS, columnGap: 20, background: `color-mix(in srgb, var(--accent-soft) ${Math.round(flash * (i === fAt ? 100 : 60))}%, #ffffff)` })}
          >
            <span className="truncate font-semibold">{r.name}</span>
            <span className="truncate">{r.what}</span>
            <span className="num text-right font-semibold text-accent">{fmtMoney(r.value)}</span>
            <span className="num">{short(r.cameBackOn)}</span>
            <span>
              <Pill tone="neutral">{MATCH_LABEL[r.match as keyof typeof MATCH_LABEL] ?? r.match}</Pill>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The offer, in the brief's words (content.json `offer.lines`), under the figure it depends on: the largest type. The
 * one pass's promise is one line of two sentences; it's set as two, in its order and its words.
 */
const LINES = ONE_PASS ? C.offer.lines.flatMap((l) => l.split(/(?<=\.) (?=[A-Z])/)) : C.offer.lines;
function Offer({ t, end }: { t: number; end: M }) {
  if (t < X.chip1) return null;
  const icons = ONE_PASS ? [CircleDollarSign, ShieldCheck] : [CalendarCheck, ShieldCheck];
  return (
    <div className="absolute flex flex-col items-center gap-3" style={{ left: L.stage.x, top: OFFER_TOP + TILE_H + 22, width: L.stage.w }}>
      {LINES.map((line, i) => (
        <MeaningChip key={line} icon={icons[i]} size="xl" m={and(enter(t, i === 0 ? X.chip1 : X.chip2, { dur: 520, rise: 16, blur: 3 }), end)}>
          {line}
        </MeaningChip>
      ))}
    </div>
  );
}
