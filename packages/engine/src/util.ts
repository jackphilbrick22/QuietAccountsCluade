import type { ISODate, Money } from "./model.ts";

/* ----------------------------- dates ------------------------------ */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export const MONTH_NAMES = MONTHS.map((m) => m[0]!.toUpperCase() + m.slice(1));

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toISODate(y: number, m: number, d: number): ISODate | undefined {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return undefined;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return undefined; // e.g. Feb 30
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Parse the date formats field-service exports actually contain:
 * 2024-05-03, 2024-05-03T14:22:00Z, 05/03/2024, 5/3/24, 05-03-2024,
 * "May 3, 2024", "3 May 2024", "May 03 2024 2:15 PM", Excel serials (45415).
 * US month-first is assumed for ambiguous slash dates (the exports are US).
 */
export function parseDate(input: unknown): ISODate | undefined {
  if (input == null) return undefined;
  let s = String(input).trim();
  if (!s || /^(n\/?a|none|null|-+)$/i.test(s)) return undefined;

  // Excel serial date
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) {
      const ms = Math.round((serial - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return toISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return toISODate(+m[1]!, +m[2]!, +m[3]!);

  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return toISODate(+m[1]!, +m[2]!, +m[3]!);

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let y = +m[3]!;
    if (m[3]!.length === 2) y += y > 69 ? 1900 : 2000;
    let mo = +m[1]!;
    let d = +m[2]!;
    if (mo > 12 && d <= 12) [mo, d] = [d, mo]; // clearly day-first
    return toISODate(y, mo, d);
  }

  s = s.replace(/,/g, " ").replace(/\s+/g, " ").toLowerCase();
  // "may 3 2024", "may 03 2024 2:15 pm", "mon may 3 2024"
  m = s.match(/(?:^|\s)([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)? (\d{4})/);
  if (m) {
    const mo = monthIndex(m[1]!);
    if (mo) return toISODate(+m[3]!, mo, +m[2]!);
  }
  // "3 may 2024"
  m = s.match(/(?:^|\s)(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})\.? (\d{4})/);
  if (m) {
    const mo = monthIndex(m[2]!);
    if (mo) return toISODate(+m[3]!, mo, +m[1]!);
  }
  // "may 2024" -> first of month
  m = s.match(/^([a-z]{3,9})\.? (\d{4})$/);
  if (m) {
    const mo = monthIndex(m[1]!);
    if (mo) return toISODate(+m[2]!, mo, 1);
  }
  return undefined;
}

function monthIndex(word: string): number | undefined {
  const w = word.toLowerCase();
  const i = MONTHS.findIndex((m) => m.startsWith(w.slice(0, 3)) && (w.length <= m.length ? m.startsWith(w) : false));
  return i >= 0 ? i + 1 : undefined;
}

export function dateToUTC(d: ISODate): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, day ?? 1);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((dateToUTC(to) - dateToUTC(from)) / 86400000);
}

export function addDays(d: ISODate, n: number): ISODate {
  const t = new Date(dateToUTC(d) + n * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split("-").map(Number);
  const total = y! * 12 + (m! - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(day!, last))}`;
}

export function monthOf(d: ISODate): number {
  return Number(d.slice(5, 7));
}

export function monthName(d: ISODate): string {
  return MONTH_NAMES[monthOf(d) - 1]!;
}

export function yearOf(d: ISODate): number {
  return Number(d.slice(0, 4));
}

/** 0 = Sunday */
export function weekday(d: ISODate): number {
  return new Date(dateToUTC(d)).getUTCDay();
}

/** Monday of the ISO week containing d. */
export function mondayOf(d: ISODate): ISODate {
  const wd = weekday(d);
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

export function isoWeekKey(d: ISODate): string {
  const t = new Date(dateToUTC(d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${pad(w)}`;
}

/** "last May", "in March", "back in 2023" — how a person refers to a past date. */
export function spokenWhen(d: ISODate, asOf: ISODate): string {
  const age = daysBetween(d, asOf);
  const month = monthName(d);
  if (age < 0) return `in ${month}`;
  if (age <= 10) return "last week";
  if (d.slice(0, 7) === asOf.slice(0, 7)) return "earlier this month";
  if (age < 40) return "a few weeks ago";
  if (yearOf(d) === yearOf(asOf)) return `back in ${month}`;
  if (yearOf(d) === yearOf(asOf) - 1) return `last ${month}`;
  return `back in ${month} ${yearOf(d)}`;
}

export function humanAge(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 365 * 2) {
    const months = Math.round(days / 30.44);
    return months === 12 ? "a year" : `${months} months`;
  }
  // people say "2½ years", never "2.4 years"
  const years = days / 365.25;
  const whole = Math.floor(years);
  const part = years - whole;
  return part < 0.25 ? `${whole} years` : part < 0.75 ? `${whole}½ years` : `${whole + 1} years`;
}

/** How often, said the way a person would: 12 → "Once a year", 36 → "Every 3 years", 30 → "Every 2½ years". */
export function intervalWords(months: number): string {
  if (months === 12) return "Once a year";
  if (months === 1) return "Once a month";
  if (months < 24) return `Every ${months} months`;
  const y = months / 12;
  if (Number.isInteger(y)) return `Every ${y} years`;
  if (Number.isInteger(y * 2)) return `Every ${Math.floor(y)}½ years`;
  return `Every ${months} months`;
}

/* ----------------------------- money ------------------------------ */

export function parseMoney(input: unknown): Money | undefined {
  if (input == null) return undefined;
  if (typeof input === "number") return Number.isFinite(input) ? round2(input) : undefined;
  let s = String(input).trim();
  if (!s) return undefined;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /-\s*\$/.test(s);
  s = s.replace(/[^0-9.,]/g, "");
  if (!s) return undefined;
  // "1.234,56" european — rare in US exports but handle it
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return round2(negative ? -n : n);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const MONEY_WHOLE = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const MONEY_CENTS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtMoney(n: Money, opts: { cents?: boolean; compact?: boolean } = {}): string {
  const v = Number(n) || 0;
  if (opts.compact && Math.abs(v) >= 10000) {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
    return `$${Math.round(v / 1000)}k`;
  }
  // building a number formatter is expensive; the scan formats thousands of amounts
  return (v < 0 ? "-$" : "$") + (opts.cents ? MONEY_CENTS : MONEY_WHOLE).format(Math.abs(v));
}

/* ----------------------------- people ----------------------------- */

const EMAIL_RE = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function extractEmails(input: unknown): string[] {
  if (input == null) return [];
  const found = String(input).match(EMAIL_RE) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase().replace(/^[.'-]+|[.'-]+$/g, "")))];
}

export function isLikelyValidEmail(e: string): boolean {
  return emailRisk(e).ok;
}

/** Common misspellings of the big mailbox domains. Old quote lists are full of them; they always bounce. */
const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com", "gmail.co": "gmail.com",
  "gmail.con": "gmail.com", "gmaill.com": "gmail.com", "gmal.com": "gmail.com", "gmail.cm": "gmail.com", "gmali.com": "gmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.co": "yahoo.com", "yahoo.con": "yahoo.com", "yhaoo.com": "yahoo.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.co": "hotmail.com", "hotmail.con": "hotmail.com", "hotmai.com": "hotmail.com",
  "outlok.com": "outlook.com", "outloo.com": "outlook.com", "outlook.co": "outlook.com", "iclod.com": "icloud.com", "icloud.co": "icloud.com",
  "aol.co": "aol.com", "aol.con": "aol.com", "comcast.nt": "comcast.net", "comcast.com": "comcast.net", "verizon.com": "verizon.net",
  "sbcglobal.com": "sbcglobal.net", "att.com": "att.net",
};
/** Throwaway inboxes: nobody reads them. */
const DISPOSABLE = /(^|\.)(mailinator|guerrillamail|10minutemail|tempmail|temp-mail|yopmail|trashmail|sharklasers|getnada|dispostable|maildrop|throwawaymail)\./i;
/** Shared role inboxes: for a homeowner these are rare, bounce-prone and complaint-prone. */
const ROLE = /^(info|office|admin|sales|billing|accounts?|contact|support|hello|service|team|mail|postmaster|webmaster)$/i;

/** The address to write to: a usable, unsuppressed one, personal inboxes before shared "info@" ones. */
export function sendableEmail(emails: string[], suppressed: Record<string, unknown> = {}): string | undefined {
  const usable = emails.filter((e) => emailRisk(e).ok && !suppressed[e]);
  return usable.find((e) => !emailRisk(e).role) ?? usable[0];
}

/**
 * Pre-send check on one address. `ok: false` never gets email. `role` addresses are allowed but used last.
 * A typo'd big-provider domain comes back with a `suggestion` the operator can apply.
 */
export function emailRisk(e: string): { ok: boolean; reason?: string; suggestion?: string; role?: boolean } {
  const email = e.trim().toLowerCase();
  if (!/^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(email) || /\.\./.test(email)) return { ok: false, reason: "not a real address" };
  const [local, domain] = email.split("@") as [string, string];
  if (/^(noreply|no-reply|donotreply|test|example|none|na|n\/a|no|noemail|nomail|unknown|x+)$/i.test(local)) return { ok: false, reason: "placeholder address" };
  if (/(example\.(com|org)|test\.com|email\.com|none\.com|noemail|nomail|no\.com)/i.test(domain)) return { ok: false, reason: "placeholder address" };
  const fix = DOMAIN_TYPOS[domain];
  if (fix) return { ok: false, reason: `looks like a typo of ${fix}`, suggestion: `${local}@${fix}` };
  if (DISPOSABLE.test(domain)) return { ok: false, reason: "throwaway inbox" };
  return ROLE.test(local) ? { ok: true, role: true } : { ok: true };
}

/** US-centric phone normalization to E.164. Returns undefined for junk. */
export function normalizePhone(input: unknown): string | undefined {
  if (input == null) return undefined;
  const digits = String(input).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 11 && digits.length <= 15 && !digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

export function extractPhones(input: unknown): string[] {
  if (input == null) return [];
  const parts = String(input).split(/[;,/|]| or |\n/i);
  const out = new Set<string>();
  for (const p of parts) {
    const n = normalizePhone(p.replace(/(ext|x)\.?\s*\d+$/i, ""));
    if (n) out.add(n);
  }
  return [...out];
}

export function fmtPhone(e164: string | undefined): string {
  if (!e164) return "";
  const d = e164.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return e164;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

const COMPANY_WORDS = /\b(llc|inc|corp|co\.?|company|ltd|hoa|association|properties|property management|management|mgmt|realty|church|school|district|apartments|condos?|trust|estate of|holdings|group|partners|construction|builders|homes)\b/i;

export function looksCommercial(name: string): boolean {
  return COMPANY_WORDS.test(name);
}

const HONORIFICS = /^((mr|mrs|ms|dr)\.?\s*(&|and)\s*(mr|mrs|ms|dr)\.?|mr|mrs|ms|miss|dr|rev|prof)\.?\s+/i;
const INITIAL = /^[a-z]\.?$/i;

/** Split "Smith, John", "John & Mary Smith", "Mr. John Q. Smith Jr." into first/last. */
export function splitName(full: string): { first: string; last: string } {
  let s = (full || "").replace(/\s+/g, " ").trim();
  if (!s) return { first: "", last: "" };
  if (s.includes(",") && !looksCommercial(s)) {
    const [last, first] = s.split(",").map((x) => x.trim());
    s = `${first ?? ""} ${last ?? ""}`.trim();
  }
  // "The Smiths", "Miller Family": a household, no first name to greet
  if (/^the\s/i.test(s) || /\bfamily$/i.test(s)) return { first: "", last: titleCase(s.replace(/^the\s+/i, "").replace(/\s*family$/i, "")) };
  const titled = HONORIFICS.test(s);
  s = s.replace(HONORIFICS, "");
  // "John & Mary Smith" / "John and Mary Smith" -> first John, last Smith
  const pair = s.match(/^([A-Za-z'-]+)\s+(?:&|and)\s+[A-Za-z'-]+\s+(.+)$/);
  if (pair) return { first: titleCase(pair[1]!), last: titleCase(pair[2]!) };
  const parts = s.split(" ").filter((p) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(p));
  // "Mr. Evans", "Mr. and Mrs. Evans": the one word left is the surname
  if (parts.length === 1) return titled ? { first: "", last: titleCase(parts[0]!) } : { first: titleCase(parts[0]!), last: "" };
  // "J. Grant" has no first name to use; "J. Robert Grant" goes by Robert
  const first = parts.slice(0, -1).find((p) => !INITIAL.test(p)) ?? "";
  return { first: titleCase(first), last: titleCase(parts[parts.length - 1]!) };
}

export function titleCase(s: string): string {
  if (!s) return s;
  // Keep intentional mixed case (McDonald, DeAngelo); fix ALL CAPS / all lower.
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, c: string) => "Mc" + c.toUpperCase());
}

/** A greeting-safe first name: "there" when we don't have a real one. */
export function greetingName(first: string | undefined): string {
  // "Mr. and Mrs." or "Dr." in the first-name column is a title, not a name
  const f = `${(first || "").trim()} `.replace(HONORIFICS, "").trim();
  if (f.length < 2 || INITIAL.test(f) || /^(the|a|an|and|&|mr|mrs|ms|miss|dr|family|customer|client|owner|resident|homeowner|unknown|n\/a)\.?$/i.test(f)) return "there";
  if (looksCommercial(f)) return "there";
  return titleCase(f);
}

/* ----------------------------- address ---------------------------- */

const STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "),
);

export function parseAddress(raw: string | undefined): { street: string; city?: string; state?: string; zip?: string; raw?: string } | undefined {
  if (!raw) return undefined;
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  const out: { street: string; city?: string; state?: string; zip?: string; raw?: string } = { street: parts[0] ?? s, raw: s };
  const tail = parts.slice(1).join(" ");
  const zip = tail.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zip) out.zip = zip[1]!;
  const st = tail.match(/\b([A-Z]{2})\b/);
  if (st && STATES.has(st[1]!)) out.state = st[1]!;
  if (parts.length >= 2) {
    const city = parts[1]!.replace(/\b[A-Z]{2}\b.*$/, "").replace(/\d{5}.*/, "").trim();
    if (city) out.city = city;
  }
  return out;
}

/** Normalized key for matching the same property across records. */
export function addressKey(street: string | undefined): string {
  if (!street) return "";
  return street
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\b(court)\b/g, "ct")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(circle)\b/g, "cir")
    .replace(/\b(place)\b/g, "pl")
    .replace(/\b(terrace)\b/g, "ter")
    .replace(/\b(highway)\b/g, "hwy")
    .replace(/\b(north)\b/g, "n")
    .replace(/\b(south)\b/g, "s")
    .replace(/\b(east)\b/g, "e")
    .replace(/\b(west)\b/g, "w")
    .replace(/\b(apt|unit|suite|ste)\s*\w+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Street name without the house number ("14 Oak Ln" -> "Oak Ln") for "on your street" copy. */
export function streetName(street: string | undefined): string {
  if (!street) return "";
  return street.replace(/^\s*\d+[a-z]?\s+/i, "").replace(/\b(apt|unit|suite|ste)\b.*$/i, "").trim();
}

/* ----------------------------- ids / rng -------------------------- */

/** FNV-1a 32-bit — stable ids from content. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function makeId(prefix: string, ...parts: (string | number | undefined)[]): string {
  return `${prefix}_${hash(parts.map((p) => String(p ?? "")).join("|"))}`;
}

/** Mulberry32 seeded RNG. Same seed, same sequence — simulations are reproducible. */
export function rng(seed: number | string): () => number {
  let a = typeof seed === "number" ? seed >>> 0 : parseInt(hash(seed), 36) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(arr: readonly T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length) % arr.length]!;
}

/** Deterministic pick keyed by a string (same person always gets the same variant). */
export function pickBy<T>(arr: readonly T[], key: string): T {
  return arr[parseInt(hash(key), 36) % arr.length]!;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function sum<T>(arr: readonly T[], f: (x: T) => number): number {
  let s = 0;
  for (const x of arr) s += f(x) || 0;
  return s;
}

export function groupBy<T, K extends string>(arr: readonly T[], f: (x: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const x of arr) (out[f(x)] ??= []).push(x);
  return out;
}

export function maxDate(...ds: (ISODate | undefined)[]): ISODate | undefined {
  let best: ISODate | undefined;
  for (const d of ds) if (d && (!best || d > best)) best = d;
  return best;
}

export function minDate(...ds: (ISODate | undefined)[]): ISODate | undefined {
  let best: ISODate | undefined;
  for (const d of ds) if (d && (!best || d < best)) best = d;
  return best;
}

export function plural(n: number, word: string, pluralWord?: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? word : (pluralWord ?? word + "s")}`;
}
