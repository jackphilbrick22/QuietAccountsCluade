/**
 * The engine works in each business's local wall-clock time ("2026-10-06T08:17").
 * These helpers turn a real instant into that local time for a given IANA time zone.
 */
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    } catch {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    }
    fmtCache.set(tz, f);
  }
  return f;
}

/** Local wall-clock ISO ("YYYY-MM-DDTHH:MM:SS") for an instant in a time zone. */
export function localIso(instant: Date, tz: string): string {
  const parts = Object.fromEntries(formatter(tz).formatToParts(instant).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function localDate(instant: Date, tz: string): string {
  return localIso(instant, tz).slice(0, 10);
}

export function localHour(instant: Date, tz: string): number {
  return Number(localIso(instant, tz).slice(11, 13));
}

export function localWeekday(instant: Date, tz: string): number {
  return new Date(`${localDate(instant, tz)}T12:00:00Z`).getUTCDay();
}
