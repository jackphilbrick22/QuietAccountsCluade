import type { ISODate } from "../model.ts";
import { addDays, toISODate, weekday, yearOf } from "../util.ts";

/**
 * The US holidays no customer note goes out on, and no saved card is charged on (Jack's answer, Oct 1): New Year's
 * Day, Memorial Day (the last Monday of May), Independence Day, Labor Day (the first Monday of September), Thanksgiving
 * (the fourth Thursday of November) and the Friday after, Christmas Eve and Christmas Day. New Year's Day, July 4 and
 * Christmas on a Saturday hold the Friday before too, and on a Sunday the Monday after (the day they're observed).
 * Worked out for each year, so there's no table to keep up. Days are the client's own local days.
 */

/** The send days' footnote, wherever they're shown. */
export const HOLIDAYS_LINE = "Never on a US holiday: New Year's Day, Memorial Day, July 4, Labor Day, Thanksgiving and the Friday after, Christmas Eve and Christmas Day.";

const byYear = new Map<number, Map<ISODate, string>>();

/** The days held in a calendar year, with their names (New Year's of the next year on a Saturday holds December 31). */
export function holidaysOf(year: number): Map<ISODate, string> {
  const cached = byYear.get(year);
  if (cached) return cached;
  const days = new Map<ISODate, string>();
  const on = (m: number, d: number) => toISODate(year, m, d)!;
  // the first weekday `wd` (0 = Sunday) on or after `from`, and the last on or before `by`
  const firstFrom = (from: ISODate, wd: number) => addDays(from, (wd - weekday(from) + 7) % 7);
  const lastBy = (by: ISODate, wd: number) => addDays(by, -((weekday(by) - wd + 7) % 7));
  // a fixed-date holiday and, on a weekend, the weekday it's observed on (when that's in this year)
  const fixed = (day: ISODate, name: string) => {
    days.set(day, name);
    const wd = weekday(day);
    const observed = wd === 6 ? addDays(day, -1) : wd === 0 ? addDays(day, 1) : undefined;
    if (observed && yearOf(observed) === year && !days.has(observed)) days.set(observed, `${name} (observed)`);
  };
  fixed(on(1, 1), "New Year's Day");
  days.set(lastBy(on(5, 31), 1), "Memorial Day");
  fixed(on(7, 4), "Independence Day");
  days.set(firstFrom(on(9, 1), 1), "Labor Day");
  const thanksgiving = addDays(firstFrom(on(11, 1), 4), 21);
  days.set(thanksgiving, "Thanksgiving");
  days.set(addDays(thanksgiving, 1), "the day after Thanksgiving");
  days.set(on(12, 24), "Christmas Eve");
  fixed(on(12, 25), "Christmas Day");
  if (weekday(toISODate(year + 1, 1, 1)!) === 6) days.set(on(12, 31), "New Year's Day (observed)");
  byYear.set(year, days);
  return days;
}

/** The holiday a local day is, if it's one. */
export function holidayOn(d: ISODate): string | undefined {
  return holidaysOf(yearOf(d)).get(d.slice(0, 10));
}
