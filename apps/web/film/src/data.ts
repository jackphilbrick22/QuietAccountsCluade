/**
 * The film's words and numbers: film/content.json (or content.<trade>.json with ?trade=), written by film/content.ts
 * from the software itself. The scenes read only from here, plus the app's own labels.
 */
import lawn from "../content.json";

export type Content = typeof lawn;

const all = import.meta.glob<Content>("../content*.json", { eager: true, import: "default" });
const trade = new URLSearchParams(location.search).get("trade");
export const C: Content = (trade && trade !== "lawn" ? all[`../content.${trade}.json`] : undefined) ?? lawn;

/* ------------------------------ dates, as the app prints them ------------------------------ */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  const hh = iso.length > 11 ? Number(iso.slice(11, 13)) : 0;
  const mm = iso.length > 14 ? Number(iso.slice(14, 16)) : 0;
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, hh, mm, wd };
}
/** "7:05 AM" */
export function clock(iso: string): string {
  const { hh, mm } = parts(iso);
  return `${hh % 12 || 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}
/** "8:02", the phone's status bar */
export function statusClock(iso: string): string {
  const { hh, mm } = parts(iso);
  return `${hh % 12 || 12}:${String(mm).padStart(2, "0")}`;
}
/** "Tue, Feb 10" */
export function day(iso: string): string {
  const { m, d, wd } = parts(iso);
  return `${DAY[wd]}, ${MON[m - 1]} ${d}`;
}
/** "Feb 11" */
export function short(iso: string): string {
  const { m, d } = parts(iso);
  return `${MON[m - 1]} ${d}`;
}
/** "Aug 2024" */
export function monthYear(iso: string): string {
  const { y, m } = parts(iso);
  return `${MON[m - 1]} ${y}`;
}
/** "Tue, Feb 10, 7:05 AM" */
export function dayClock(iso: string): string {
  return `${day(iso)}, ${clock(iso)}`;
}
/** "Feb 9, 8:00 AM" */
export function shortClock(iso: string): string {
  return `${short(iso)}, ${clock(iso)}`;
}

/** "SM" */
export function initials(name: string): string {
  const w = name.trim().split(/\s+/);
  return ((w[0]?.[0] ?? "") + (w.length > 1 ? (w.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

export const num = (n: number) => Math.round(n).toLocaleString("en-US");
