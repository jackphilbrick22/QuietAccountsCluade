/**
 * Beats 5 and 6 — the Replies tab: the replies come in one at a time, each read and labelled, each landing in its place (the
 * ones who want the work first, so a later "no" lands below an earlier "yes": the sort shows as they arrive, and no
 * row ever crosses another). The one we follow lands last, on top, and opens the answer we sent her on the spot.
 * Only replies from before her hand-off text are here, so the console never runs ahead of the phone.
 */
import { Inbox, PhoneCall } from "lucide-react";
import { Chip } from "../../../src/components/table";
import { Pill } from "../../../src/components/ui";
import { C, initials, short } from "../data";
import { and, css, enter, leave, lerp, out, outCubic, outQuad, pop, prog, steps, type M } from "../motion";
import { MeaningChip } from "../parts";
import { L, T } from "../timeline";
import { PAN, PanFrame, panK } from "./Notes";

const S = T.send;
const ROW_H = 58;
const BOX_TOP = 272;
const ACK_H = 112;
const PAD = 6;
const noop = () => {};

type Shown = (typeof C.replies.shown)[number];
/** In the order the Replies view keeps them (content.ts sorts them): the ones who want the work first. */
const sorted = C.replies.shown;
/** As they came in. The first is already there when the view pans in; the rest arrive one at a time. */
const arrival = [...sorted].sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : 1));
const arriveAt = (r: Shown) => (arrival.indexOf(r) === 0 ? -Infinity : S.arrive + (arrival.indexOf(r) - 1) * S.gap);
const featured = sorted.find((r) => r.name === C.featured.name) ?? sorted[0]!;

const WANTS = ["wants_it", "wants_price", "question"];
const QUIET = ["later", "unclear", "auto_reply", "bounce"];
/** The Replies tab's chips as they stand when a reply lands (apps/web/src/live/ClientWork.tsx's filters). */
function chipsAt(iso: string) {
  const inBy = C.replies.all.filter((r) => r.receivedAt <= iso);
  return {
    wanted: inBy.filter((r) => WANTS.includes(r.intent)).length,
    later: inBy.filter((r) => r.intent === "later").length,
    closed: inBy.filter((r) => !WANTS.includes(r.intent) && !QUIET.includes(r.intent)).length,
    all: inBy.length,
  };
}
const closedOut = (r: Shown) => !WANTS.includes(r.intent) && !QUIET.includes(r.intent);
/** How far a reply's place in the list has opened (the rows under it make room first), and the row itself. */
const opened = (t: number, r: Shown) => outCubic(prog(t, arriveAt(r), 380));
const rowShown = (t: number, r: Shown) => enter(t, arriveAt(r) + 200, { dur: 420, rise: -6, blur: 2 });
/** Our answer to her: its space opens first (the rows under it slide down), then the panel fades and rises into it. */
const ackSpace = (t: number) => outCubic(prog(t, S.ack, 380));
const ackPanel = (t: number) => enter(t, S.ack + 300, { dur: 420, rise: 8, blur: 2 });

export function RepliesScene({ t }: { t: number }) {
  if (t < S.pan || t > T.money.out + 400) return null;
  const k = panK(t);
  const x = (1 - k) * PAN.d;
  const m = and({ o: outQuad(Math.min(1, k / 0.6)), x: 0, y: 0, s: 1, b: 0 }, leave(t, T.money.out, { dur: 340, drift: 8, blur: 5 }));
  return (
    <PanFrame>
      <div className="absolute" style={css({ ...m, x }, { left: 0, top: 0, width: 1280, height: 596 })}>
        <ReplyChips t={t} />
        <span className="absolute flex items-center gap-2" style={{ left: L.stage.x, top: 208 }}>
          <MeaningChip icon={Inbox} tone="accent" m={{ o: 1, x: 0, y: 0, s: 1, b: 0 }}>
            We read every reply and answer it for you
          </MeaningChip>
          {/* the hand-off, said before it reaches his phone: the one thing he does with a reply */}
          <MeaningChip icon={PhoneCall} tone="accent" m={enter(t, T.handoff.chip, { rise: 10, blur: 2 })}>
            We text you the ones who want the work. You call.
          </MeaningChip>
        </span>
        <p className="absolute text-[13px] whitespace-nowrap text-ink-3" style={{ left: L.stage.x + 2, top: 246 }}>
          Every reply to every note, read and sorted. The ones who want the work come first.
        </p>
        <List t={t} />
      </div>
    </PanFrame>
  );
}

const finalChips = { wanted: C.replies.chips.wantedTheWork, later: C.replies.chips.later, closed: C.replies.chips.closedOut, all: C.replies.chips.everything };
function ReplyChips({ t }: { t: number }) {
  const at = (key: "wanted" | "later" | "closed" | "all") =>
    steps(
      t,
      chipsAt(arrival[0]!.receivedAt)[key],
      arrival.slice(1).map((r, i) => ({ at: arriveAt(r) + 250, to: i === arrival.length - 2 ? finalChips[key] : chipsAt(r.receivedAt)[key] })),
      500,
    );
  const chips = [
    { label: "Wanted the work", n: at("wanted") },
    { label: "Later", n: at("later") },
    { label: "Closed out", n: at("closed") },
    { label: "Everything", n: at("all"), active: true },
  ];
  return (
    <div className="absolute flex items-center gap-1.5" style={{ left: L.stage.x, top: 170 }}>
      {chips.map((c) => (
        <Chip key={c.label} active={!!c.active} onClick={noop} count={Math.round(c.n)}>
          {c.label}
        </Chip>
      ))}
    </div>
  );
}

function List({ t }: { t: number }) {
  const w = L.stage.narrow;
  const ack = ackSpace(t);
  const lift = out(prog(t, S.ack - 100, 420));
  const fIdx = sorted.indexOf(featured);
  const above = (r: Shown) => sorted.slice(0, sorted.indexOf(r)).reduce((s, q) => s + opened(t, q) * ROW_H, 0) + (sorted.indexOf(r) > fIdx ? ack * ACK_H : 0);
  const boxH = PAD * 2 + sorted.reduce((s, q) => s + opened(t, q), 0) * ROW_H + ack * ACK_H;
  // the list runs on below the window's bottom edge: it fades out toward it
  const mask = "linear-gradient(to bottom, #000 0px, #000 210px, rgba(0,0,0,0.55) 245px, rgba(0,0,0,0) 300px)";
  return (
    <div className="absolute" style={{ left: L.stage.x, top: BOX_TOP, width: w, height: boxH, maskImage: mask, WebkitMaskImage: mask }}>
      <div className="absolute inset-0 rounded-box border border-line bg-surface shadow-card" />
      {sorted.map((r) => {
        const isF = r === featured;
        const inM = rowShown(t, r);
        if (inM.o <= 0) return null;
        // read and labelled: the pill pops once the row is in; the closed-out ones then step back (their words dim)
        const pillAt = arriveAt(r) === -Infinity ? -Infinity : arriveAt(r) + 560;
        const pill = pop(t, pillAt, 280, 0.8);
        const dim = closedOut(r) ? lerp(1, 0.5, outQuad(prog(t, pillAt + 200, 400))) : 1;
        const s = isF ? lerp(1, 1.012, lift) : 1;
        return (
          <div key={r.name} className="absolute" style={css({ ...inM, s: inM.s * s, y: inM.y + above(r) }, { left: PAD, right: PAD, top: PAD, height: ROW_H + (isF ? ack * ACK_H : 0), zIndex: isF ? 3 : 1 })}>
            <div
              className="absolute right-0 left-0 flex items-center gap-3 bg-surface px-4"
              style={{
                top: 0,
                height: ROW_H,
                borderBottom: isF && lift > 0 ? undefined : "1px solid var(--line)",
                borderRadius: isF ? lerp(10, 14, lift) : 10,
                boxShadow: isF && lift > 0 ? `0 0 0 1px rgba(236,236,240,${lift}), 0 30px 60px -30px rgba(70, 40, 170, ${0.38 * lift}), 0 2px 6px rgba(20, 10, 60, ${0.05 * lift})` : undefined,
              }}
            >
              <span className="grid size-[34px] shrink-0 place-items-center rounded-full border border-accent-line bg-accent-soft font-display text-[13.5px] text-accent-ink" style={{ opacity: dim }}>
                {initials(r.name ?? "")}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1" style={{ opacity: dim }}>
                <div className="flex items-center gap-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{r.name}</span>
                  <span style={css(pill, { transformOrigin: "right center" })}>
                    <Pill tone={r.tone as "ok"}>{r.label}</Pill>
                  </span>
                  <span className="num w-[44px] shrink-0 text-right text-[12px] text-ink-3">{short(r.receivedAt)}</span>
                </div>
                <span className="min-w-0 truncate text-[13px] text-ink-2">{r.text}</span>
              </div>
            </div>
            {isF && r.ack && t >= S.ack + 300 && <Ack text={r.ack} m={ackPanel(t)} w={w} />}
          </div>
        );
      })}
    </div>
  );
}

/** What we wrote back the minute she wrote: the lavender bubble, under her row, in the space opened for it. */
function Ack({ text, m, w }: { text: string; m: M; w: number }) {
  return (
    <div className="absolute" style={{ left: 63, top: ROW_H + 8, width: Math.min(540, w - 100) }}>
      <div className="rounded-[18px] rounded-tl-md border border-accent-line bg-accent-wash px-3.5 py-2.5 text-[13px] leading-[19px] text-ink" style={css(m)}>
        <div className="mb-1 text-[11.5px] font-semibold text-accent-ink">We wrote back</div>
        {text.split("\n\n").map((p, i) => (
          <p key={i} className="whitespace-pre-wrap" style={{ marginTop: i ? 6 : 0 }}>
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}
