import type { ISODate } from "../model.ts";
import { addDays } from "../util.ts";

/**
 * Pacing a one pass from its end date (BRIEF B3). Each person's notes end within about 12 days of the first, so first
 * notes are spread over the send days until about 12 days before the end, at the steadiest pace that gets there.
 * Follow-ups go the way Instantly sends them: 4 days after note 1 and 5 after note 2 (calendar days; one that lands on a
 * day off waits for the next send day), ahead of new people. No inbox sends more than 30 a day, follow-ups included.
 * Each person's notes get their days, and the planner puts them there: notes the server sends itself go as modelled too.
 */

/** Days Instantly waits after note 1 before note 2, and after note 2 before note 3. */
export const FOLLOW_UP_GAPS = [4, 5] as const;
/** Most notes one inbox sends in a day, follow-ups included. */
export const INBOX_DAILY = 30;
/** A person's notes end within about this many days of the first: first notes stop this long before the end date. */
export const NOTES_SPAN_DAYS = 12;
/** More inboxes than this is no answer to a date that can't be met. */
const MOST_INBOXES = 100;

export interface PaceInput {
  /** How many notes each person gets (1 to 3), in the order they start. */
  notes: number[];
  /** The first day notes may go out. */
  startOn: ISODate;
  /** The day the whole list should be done. */
  endOn: ISODate;
  /** The client's own sending inboxes. */
  inboxes: number;
  /** Notes already on the calendar, by day: they keep their room. */
  busy?: Map<ISODate, number>;
  /** Whether notes may go out on a day (the send days, less blackout weeks). */
  sendsOn: (d: ISODate) => boolean;
}

export interface PaceDay {
  day: ISODate;
  /** New people started that day. */
  first: number;
  followUps: number;
}

export interface Pace {
  /** Each day notes go out, from the first to the last. */
  days: PaceDay[];
  /** Each person's days, note by note, in the order they start (none: never started). */
  people: ISODate[][];
  /** The day the last first note goes out (none when nobody's to start). */
  lastFirst?: ISODate;
  /** The end date the schedule meets: endOn, or when that can't be met, the one these inboxes can. */
  endOn: ISODate;
  /** endOn can't be met on these inboxes: the date they can meet, and how many more would meet endOn (none: no number). */
  late?: { canMeet: ISODate; moreInboxes?: number };
}

export function paceOnePass(p: PaceInput): Pace {
  const inboxes = Math.max(1, p.inboxes);
  const run = (n: number, rate: number) => schedule(p, n, rate);
  const meets = (s: Schedule, endOn: ISODate) => !s.unstarted && (!s.lastFirst || s.lastFirst <= addDays(endOn, -NOTES_SPAN_DAYS));
  // the gentlest steady pace that meets a date: the fewest new people a day, starting from an even share of the send days
  const spread = (endOn: ISODate, n: number) => {
    let window = 0;
    for (let d = p.startOn; d <= addDays(endOn, -NOTES_SPAN_DAYS); d = addDays(d, 1)) if (p.sendsOn(d)) window++;
    for (let rate = Math.max(1, Math.ceil(p.notes.length / Math.max(1, window))); rate <= INBOX_DAILY * n; rate++) {
      const s = run(n, rate);
      if (meets(s, endOn)) return s;
    }
    return undefined;
  };
  const onTime = spread(p.endOn, inboxes);
  if (onTime) return { days: onTime.days, people: onTime.people, lastFirst: onTime.lastFirst, endOn: p.endOn };
  // as fast as the inboxes go (new people wherever the follow-ups leave room) is the soonest end they can meet
  const fastest = (n: number) => run(n, INBOX_DAILY * n);
  const canMeet = addDays(fastest(inboxes).lastFirst ?? p.startOn, NOTES_SPAN_DAYS);
  let more = 1;
  while (more <= MOST_INBOXES && !meets(fastest(inboxes + more), p.endOn)) more++;
  const s = spread(canMeet, inboxes) ?? fastest(inboxes);
  return { days: s.days, people: s.people, lastFirst: s.lastFirst, endOn: canMeet, late: { canMeet, ...(more <= MOST_INBOXES ? { moreInboxes: more } : {}) } };
}

interface Schedule {
  days: PaceDay[];
  people: ISODate[][];
  lastFirst?: ISODate;
  /** People never started (a list that would take years). */
  unstarted: number;
}

/**
 * Follow-ups owed together: these people's note `step` (by their place on the list), with `left` notes still to go
 * counting it.
 */
interface Owed {
  step: number;
  left: number;
  who: number[];
}

/**
 * Day by day: the follow-ups due go first, oldest first, then new people, up to `rate` a day and the room left. Each
 * person's notes are kept on the days they go, so a plan can put them there.
 */
function schedule(p: PaceInput, inboxes: number, rate: number): Schedule {
  const room = INBOX_DAILY * inboxes;
  // follow-ups by the day they fall due, and those due but not sent yet for want of room, oldest first
  const due = new Map<ISODate, Owed[]>();
  const owed: Owed[] = [];
  const wait = (on: ISODate, f: Owed) => f.who.length > 0 && (due.get(on) ?? due.set(on, []).get(on)!).push(f);
  const days: PaceDay[] = [];
  const people: ISODate[][] = [];
  let next = 0;
  let lastFirst: ISODate | undefined;
  for (let d = p.startOn, i = 0; (next < p.notes.length || due.size || owed.length) && i < 3650; d = addDays(d, 1), i++) {
    if (!p.sendsOn(d)) continue;
    for (const on of [...due.keys()].sort())
      if (on <= d) {
        owed.push(...due.get(on)!);
        due.delete(on);
      }
    const free = Math.max(0, room - (p.busy?.get(d) ?? 0));
    let sent = 0;
    while (sent < free && owed[0]) {
      const f = owed[0];
      const go = f.who.length <= free - sent ? owed.shift()!.who : f.who.splice(0, free - sent);
      sent += go.length;
      for (const x of go) people[x]!.push(d);
      if (f.left > 1) wait(addDays(d, FOLLOW_UP_GAPS[f.step - 1]!), { step: f.step + 1, left: f.left - 1, who: go });
    }
    const first = Math.min(free - sent, rate, p.notes.length - next);
    if (first) {
      // people who start together are owed their second notes together, those with a third note first
      const third: number[] = [];
      const second: number[] = [];
      for (let x = next; x < next + first; x++) {
        people[x] = [d];
        if (p.notes[x]! > 2) third.push(x);
        else if (p.notes[x]! > 1) second.push(x);
      }
      const on = addDays(d, FOLLOW_UP_GAPS[0]);
      wait(on, { step: 2, left: 2, who: third });
      wait(on, { step: 2, left: 1, who: second });
      next += first;
      lastFirst = d;
    }
    if (first || sent) days.push({ day: d, first, followUps: sent });
  }
  return { days, people, lastFirst, unstarted: p.notes.length - next };
}
