import type { ISODate, ISODateTime, ReplyIntent } from "../model.ts";
import { addDays, fmtPhone, monthName, pick, rng } from "../util.ts";
import { chase, closeIfDue, dueTouches, markContacted, markSent, receiveReply, reportWeek } from "../runtime/agents.ts";
import type { AccountState } from "../runtime/state.ts";
import { NON_POSITIVE_MIX, SIM_REPLIES } from "./replies.ts";

export interface SimOptions {
  seed?: number | string;
  /** Multiply reply likelihood (1 = calibrated to real first-150 results). */
  replyScale?: number;
  /** Median hours before the owner calls a hot lead. */
  ownerMedianHours?: number;
  /** Share of positive replies that book. */
  bookRate?: number;
}

/**
 * Play the system forward day by day. Clearly a simulation: every reply and booking it
 * produces is marked in the event log. Replies go through the real Inbox reader.
 *
 * Calibration: Quiet Accounts' first three live rounds — 450 people, 52 wrote back (11.6%),
 * 25 booked (5.6%). Per-person booking odds come from each opportunity's recovery estimate;
 * reply odds are ~2.1× that plus a floor of "no thanks" style replies.
 */
export function simulate(state: AccountState, from: ISODate, days: number, opts: SimOptions = {}): AccountState {
  const r = rng(opts.seed ?? `sim|${state.dataset.business.id}|${from}`);
  const scale = opts.replyScale ?? 1;
  const bookRate = opts.bookRate ?? 0.48;
  const median = opts.ownerMedianHours ?? 5;
  const b = state.dataset.business;
  const pending: { at: ISODateTime; run: () => void }[] = [];
  /** Run every queued event up to `until`, in time order, including ones queued while running. */
  const drain = (until: string) => {
    for (let guard = 0; guard < 100000; guard++) {
      let next = -1;
      for (let i = 0; i < pending.length; i++) if (pending[i]!.at <= until && (next < 0 || pending[i]!.at < pending[next]!.at)) next = i;
      if (next < 0) return;
      const [p] = pending.splice(next, 1);
      p!.run();
    }
  };

  for (let d = 0; d < days; d++) {
    const day = addDays(from, d);
    const sendAt = `${day}T${String(b.sendWindow[1] - 1).padStart(2, "0")}:59`;
    // replies and calls that land before today's sends go first (a reply stops the next note)
    drain(`${day}T${String(b.sendWindow[1] - 1).padStart(2, "0")}:58`);
    const { due } = dueTouches(state, sendAt);
    for (const { touch } of due) {
      markSent(state, touch.id, touch.dueAt.length === 16 ? `${touch.dueAt}:00` : touch.dueAt, `sim-${touch.id}`);
      const opp = state.scan?.opportunities.find((o) => o.id === touch.opportunityId);
      const pBook = (opp?.recoverProbability ?? 0.04) * scale;
      // share of all replies that happen after this step
      const stepShare = touch.step === 1 ? 0.55 : touch.step === 2 ? 0.25 : 0.2;
      const pPositive = Math.min(0.9, (pBook / bookRate) * stepShare);
      const pOther = Math.min(0.5, 0.06 * scale * stepShare);
      // bounces happen on the first note only
      if (touch.step === 1 && r() < 0.018) {
        const at = `${day}T${String(b.sendWindow[1]).padStart(2, "0")}:05:00`;
        pending.push({ at, run: () => receiveReply(state, { from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", text: `Address not found. Your message wasn't delivered to ${state.dataset.customers.find((c) => c.id === touch.customerId)?.emails[0]} because the address couldn't be found.`, receivedAt: at, inReplyTo: touch.providerId }) });
        continue;
      }
      const x = r();
      let intent: ReplyIntent | undefined;
      if (x < pPositive) intent = r() < 0.72 ? "wants_it" : "wants_price";
      else if (x < pPositive + pOther) {
        let y = r();
        for (const [k, w] of NON_POSITIVE_MIX) {
          y -= w;
          if (y <= 0) {
            intent = k;
            break;
          }
        }
        intent = intent ?? "already_done";
      }
      if (!intent) continue;
      const lagHours = 1 + Math.floor(Math.pow(r(), 2) * 60);
      const at = new Date(Date.parse(`${touch.dueAt}:00Z`) + lagHours * 3600000).toISOString().slice(0, 19);
      const c = state.dataset.customers.find((cc) => cc.id === touch.customerId);
      const text = pick(SIM_REPLIES[intent] ?? SIM_REPLIES.wants_it!, r)
        // the thing itself, as a homeowner says it: "the oak got worse over the winter", not "the oak removal"
        .replace("{job}", opp?.jobPhrase.replace(/^the /, "").replace(/ (removal|pruning|grinding|trimming|treatment|cabling)\b/, "") ?? "tree")
        .replace("{signer}", b.signerName)
        .replace("{phone}", c?.phones[0] ? fmtPhone(c.phones[0]) : "")
        .replace("{day}", ["Tuesday", "Thursday", "next Monday"][Math.floor(r() * 3)]!);
      const email = c?.emails[0] ?? "someone@example.com";
      pending.push({
        at,
        run: () => {
          const rep = receiveReply(state, { from: `${c?.name ?? ""} <${email}>`, subject: `Re: ${touch.subject ?? ""}`, text, receivedAt: at, inReplyTo: touch.providerId });
          if ((rep.intent === "wants_it" || rep.intent === "wants_price" || rep.intent === "question") && rep.customerId) {
            const hrs = Math.max(0.3, median * Math.exp((r() - 0.5) * 2));
            const callAt = workingHours(new Date(Date.parse(`${at}Z`) + hrs * 3600000).toISOString().slice(0, 19));
            const books = r() < bookRate * (rep.intent === "question" ? 0.5 : 1);
            const value = Math.round(((opp?.value ?? 1500) * (0.85 + r() * 0.3)) / 25) * 25;
            pending.push({ at: callAt, run: () => markContacted(state, rep.id, callAt, books ? "booked" : r() < 0.5 ? "quoted" : "lost", books ? value : undefined) });
          }
        },
      });
    }
    drain(`${day}T23:59:59`);
    chase(state, `${day}T17:00:00`);
    if (new Date(Date.parse(day + "T00:00:00Z")).getUTCDay() === 5) reportWeek(state, `${day}T16:00:00`);
    closeIfDue(state, `${day}T09:00:00`);
    state.dataset.asOf = day;
  }
  state.events.push({
    id: `sim-${from}-${days}`,
    at: `${addDays(from, days - 1)}T23:59:00`,
    agent: "reporter",
    kind: "info",
    title: `Simulated ${days} days (${monthName(from)} → ${monthName(addDays(from, days - 1))})`,
    detail: "Replies and bookings in this window are simulated from calibrated rates — not real results.",
  });
  return state;
}

/**
 * The owner calls back in working hours (9 AM to 7 PM): a call that would land at night or before 9 waits for the
 * morning, keeping its minutes so the mornings don't all read 9:00. Times are the business's wall clock.
 */
function workingHours(at: ISODateTime): ISODateTime {
  const hour = Number(at.slice(11, 13));
  if (hour >= 9 && hour < 19) return at;
  const day = hour >= 19 ? addDays(at.slice(0, 10), 1) : at.slice(0, 10);
  return `${day}T${String(9 + (hour % 2)).padStart(2, "0")}${at.slice(13, 19)}`;
}
