import { findPhoneNumbersInText, parsePhoneNumberFromString } from "libphonenumber-js/max";
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

/**
 * One phone number → E.164 (US unless written with a +country code). The extension is dropped (a text or a
 * call-back can't dial it), and numbers no carrier could assign — 555-555-5555, 123-456-7890 — are junk.
 */
export function normalizePhone(input: unknown): string | undefined {
  if (input == null) return undefined;
  const s = String(input).trim();
  if (!s) return undefined;
  const p = parsePhoneNumberFromString(s, "US");
  if (p?.isValid()) return p.number;
  // words around it ("cell: 603-224-1234 (office)")
  return phonesInText(s)[0];
}

/** Every real number in a cell, E.164, first-mentioned first. */
export function extractPhones(input: unknown): string[] {
  if (input == null) return [];
  const out = new Set<string>();
  // Split on list separators first: the finder reads "603-224-1234; 603-555-0100" as one number with an extension.
  for (const part of String(input).split(/[;,/|\n]| or /i)) for (const n of phonesInText(part)) out.add(n);
  return [...out];
}

/** A 10-digit run (optional +1) with the usual separators, not glued to other digits, prices or dates. */
const PHONE_SHAPE = /(?<![\d$.,/])(?:\+?1[\s.-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?![\d/])/g;

/** Every valid number in free text, E.164, in the order written. Placeholders (555-555-5555) are skipped. */
export function phonesInText(text: string): string[] {
  const hits = findPhoneNumbersInText(text, "US").map((m) => ({ at: m.startsAt, n: m.number.number }));
  // The finder drops a candidate it can't parse whole ("after 5, 603-555-0142"), so plain 10-digit runs are checked too.
  for (const m of text.matchAll(PHONE_SHAPE)) {
    const p = parsePhoneNumberFromString(m[0], "US");
    if (p?.isValid()) hits.push({ at: m.index, n: p.number });
  }
  return [...new Set(hits.sort((a, b) => a.at - b.at).map((h) => h.n))];
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

/**
 * FNV-1a 32-bit: a quick stable number from a string, for deterministic picks and seeds. Never an id: at 32 bits
 * two homeowners in one shop of a few thousand can hash alike (see makeId).
 */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const SHA256_K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const SHA256_H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
// reused between calls (an import makes tens of thousands of ids); Int32 keeps the arithmetic in small integers
const SHA256_W = new Int32Array(64);
const SHA256_OUT = new Int32Array(8);
let shaBuf = new Uint8Array(512);

/** UTF-8 bytes of `s` into `m`; returns how many. A lone surrogate becomes U+FFFD, as TextEncoder does. */
function utf8Into(s: string, m: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) m[n++] = c;
    else if (c < 0x800) {
      m[n++] = 0xc0 | (c >> 6);
      m[n++] = 0x80 | (c & 63);
    } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
      m[n++] = 0xf0 | (c >> 18);
      m[n++] = 0x80 | ((c >> 12) & 63);
      m[n++] = 0x80 | ((c >> 6) & 63);
      m[n++] = 0x80 | (c & 63);
    } else {
      if (c >= 0xd800 && c < 0xe000) c = 0xfffd;
      m[n++] = 0xe0 | (c >> 12);
      m[n++] = 0x80 | ((c >> 6) & 63);
      m[n++] = 0x80 | (c & 63);
    }
  }
  return n;
}

/** SHA-256 of `s` (UTF-8) into SHA256_OUT, allocating nothing: scanning a big shop makes an id per candidate. */
function digest(s: string): Int32Array {
  // UTF-8 is at most 3 bytes per UTF-16 unit; 72 more leaves room for the padding
  if (shaBuf.length < s.length * 3 + 72) shaBuf = new Uint8Array(Math.max(s.length * 3 + 72, shaBuf.length * 2));
  const m = shaBuf;
  const len = utf8Into(s, m);
  const size = Math.ceil((len + 9) / 64) * 64;
  m.fill(0, len, size);
  m[len] = 0x80;
  // the length in bits, big-endian, closes the last block
  const bits = len * 8;
  const hiBits = Math.floor(bits / 0x100000000);
  for (let i = 0; i < 4; i++) {
    m[size - 1 - i] = (bits >>> (8 * i)) & 0xff;
    m[size - 5 - i] = (hiBits >>> (8 * i)) & 0xff;
  }
  const w = SHA256_W;
  const K = SHA256_K;
  let h0 = SHA256_H[0]!, h1 = SHA256_H[1]!, h2 = SHA256_H[2]!, h3 = SHA256_H[3]!, h4 = SHA256_H[4]!, h5 = SHA256_H[5]!, h6 = SHA256_H[6]!, h7 = SHA256_H[7]!;
  for (let off = 0; off < size; off += 64) {
    for (let i = 0, p = off; i < 16; i++, p += 4) w[i] = (m[p]! << 24) | (m[p + 1]! << 16) | (m[p + 2]! << 8) | m[p + 3]!;
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, k = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (k + S1 + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + k) | 0;
  }
  const out = SHA256_OUT;
  out[0] = h0;
  out[1] = h1;
  out[2] = h2;
  out[3] = h3;
  out[4] = h4;
  out[5] = h5;
  out[6] = h6;
  out[7] = h7;
  return out;
}

/**
 * SHA-256 of the string's UTF-8 bytes, as eight unsigned 32-bit words. Written out here because ids are made
 * synchronously, and the engine also runs in the browser (the site's audit), where there is no node:crypto.
 */
export function sha256(s: string): number[] {
  return Array.from(digest(s), (x) => x >>> 0);
}

/** SHA-256 as the usual 64 hex characters. */
export function sha256Hex(s: string): string {
  return sha256(s)
    .map((x) => x.toString(16).padStart(8, "0"))
    .join("");
}

/**
 * Stable ids from content: the same parts always give the same id, and every id is its prefix plus 14 base-36
 * characters (64 bits of SHA-256). Ids key every record, so two people must never share one: at 64 bits a shop
 * with 100,000 records has well under a one-in-a-billion chance of any collision (32-bit FNV had about one in
 * 350 at 5,000 customers, and two homeowners who collided were merged into one).
 */
export function makeId(prefix: string, ...parts: (string | number | undefined)[]): string {
  const h = digest(parts.map((p) => String(p ?? "")).join("|"));
  return `${prefix}_${(h[0]! >>> 0).toString(36).padStart(7, "0")}${(h[1]! >>> 0).toString(36).padStart(7, "0")}`;
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
