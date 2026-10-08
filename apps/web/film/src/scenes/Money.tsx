/**
 * Beats 7 and 8 — it shows up in his results (Overview tab): two figures, what booked and how many asked to come
 * back, and the owner app's ledger; his booking slides in on top, then the round's other bookings land as the weeks go
 * by, so the console reads what the round's last text will say. Then the offer: the money and the ledger leave with
 * the phone, the one number the promise depends on (how many asked to come back) settles in the middle, and the two
 * offer lines rise under it as the largest words on screen. Then back to the empty canvas.
 */
import { CalendarCheck, ShieldCheck } from "lucide-react";
import { fmtMoney, plural } from "@qa/engine";
import { cx, Pill } from "../../../src/components/ui";
import { MATCH_LABEL } from "../../../src/lib/labels";
import { C, short } from "../data";
import { and, count, css, enter, leave, lerp, outCubic, prog, sine, steps, type M } from "../motion";
import { HeadRow, MeaningChip } from "../parts";
import { L, T } from "../timeline";

const S = T.money;
const X = T.close;
const COLS = "minmax(0,1.5fr) minmax(0,1.2fr) minmax(0,0.9fr) minmax(0,1fr) minmax(0,1.4fr)";
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
/** In the order they reached his results. The ledger lists them newest first. */
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

/** Two figures in the console's Figures look: what booked (green), and how many asked to come back. */
function Tiles({ t, end }: { t: number; end: M }) {
  const booked = steps(
    t,
    R.before,
    byTime.map((_, i) => ({ at: landAt[i]! + 80, to: byTime.slice(0, i + 1).reduce((s, x) => s + x.value, 0) })).filter((_, i) => i >= fAt),
    650,
  );
  const jobs = landAt.filter((a) => t >= a + 80).length;
  // the round's tally moves with the bookings that land after his
  const asked = count(t, S.rest + 80, R.atBooking.asked, R.endOfRun.askedToComeBack, 650 + (lastLand - S.rest));
  const replied = count(t, S.rest + 80, R.atBooking.replied, R.endOfRun.replied, 650 + (lastLand - S.rest));
  const inM = enter(t, S.tiles, { rise: 16, blur: 3 });
  // the money leaves with the phone; the number the promise depends on glides to the middle
  const money = and(inM, leave(t, X.phoneOut, { dur: 420, drift: 6, blur: 3 }));
  const glide = sine(prog(t, X.offer, 650));
  const askedM = and(inM, end);
  const askedX = lerp(L.stage.x + TILE_W + TILE_GAP, L.stage.x + (L.stage.w - TILE_W) / 2, glide);
  const askedY = lerp(TILES_Y, OFFER_TOP, glide);
  return (
    <>
      <Tile m={money} x={L.stage.x} y={TILES_Y} label="Booked" value={fmtMoney(booked)} sub={plural(jobs, "job")} tone="text-ok" />
      <Tile m={askedM} x={askedX} y={askedY} label={C.offer.wanted.label} value={Math.round(asked).toLocaleString("en-US")} sub={`${Math.round(replied)} wrote back`} tone="text-accent-ink" />
    </>
  );
}

function Tile({ m, x, y, label, value, sub, tone }: { m: M; x: number; y: number; label: string; value: string; sub: string; tone: string }) {
  return (
    <dl className="absolute flex flex-col gap-1.5 rounded-card border border-line bg-surface px-5 py-5 shadow-card" style={css(m, { left: x, top: y, width: TILE_W, height: TILE_H })}>
      <dt className="order-2 text-[13.5px] leading-snug font-medium text-ink-2">{label}</dt>
      <dd className={cx("num order-1 font-display text-[40px] leading-none", tone)}>{value}</dd>
      <dd className="num order-3 text-[12.5px] leading-snug text-ink-3">{sub}</dd>
    </dl>
  );
}

/** The owner app's Recovered ledger, newest first: his booking slides in on top, then the round's others. */
function Ledger({ t }: { t: number }) {
  if (t < S.ledger || t > X.phoneOut + 500) return null;
  const m = and(enter(t, S.ledger, { rise: 20, blur: 3 }), leave(t, X.phoneOut, { dur: 420, drift: 6, blur: 3 }));
  const landed = landAt.map((a) => outCubic(prog(t, a, 420)));
  const h = 34 + landed.reduce((s, x) => s + x, 0) * ROW_H + 2;
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
            <span className="num text-right font-semibold text-ok">{fmtMoney(r.value)}</span>
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

/** The offer, in the brief's words (content.json `offer.lines`), under the figure it depends on: the largest type. */
function Offer({ t, end }: { t: number; end: M }) {
  if (t < X.chip1) return null;
  const icons = [CalendarCheck, ShieldCheck];
  return (
    <div className="absolute flex flex-col items-center gap-3" style={{ left: L.stage.x, top: OFFER_TOP + TILE_H + 22, width: L.stage.w }}>
      {C.offer.lines.map((line, i) => (
        <MeaningChip key={line} icon={icons[i]} size="xl" m={and(enter(t, i === 0 ? X.chip1 : X.chip2, { dur: 520, rise: 16, blur: 3 }), end)}>
          {line}
        </MeaningChip>
      ))}
    </div>
  );
}
