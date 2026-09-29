import type { RecordKind, SourceSystem } from "../model.ts";
import { extractEmails, normalizePhone, parseDate, parseMoney } from "../util.ts";
import type { Table } from "./csv.ts";
import { FIELDS, KIND_FIELDS, KIND_SIGNALS, SOURCE_SIGNALS, type Field } from "./fields.ts";

export interface ColumnMapping {
  /** field -> header index */
  fields: Partial<Record<Field, number>>;
  /** field -> 0..1 confidence */
  confidence: Partial<Record<Field, number>>;
  /** headers nobody claimed */
  unused: string[];
}

export interface Detection {
  kind: RecordKind;
  kindConfidence: number;
  kindScores: Record<RecordKind, number>;
  source: SourceSystem;
  sourceConfidence: number;
  mapping: ColumnMapping;
  warnings: string[];
}

export function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\(\s*\$\s*\)|\$/g, "")
    .replace(/[_./\\:]+/g, " ")
    .replace(/[^a-z0-9# &-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OTHER_KIND_WORDS: Record<RecordKind, RegExp> = {
  quote: /\b(job|invoice|request|visit)\b/,
  job: /\b(quote|estimate|invoice|request|proposal)\b/,
  invoice: /\b(quote|estimate|job|request|proposal)\b/,
  client: /\b(quote|estimate|job|invoice|request)\b/,
  request: /\b(quote|estimate|job|invoice)\b/,
  visit: /\b(quote|estimate|invoice|request)\b/,
};
const OWN_KIND_WORDS: Record<RecordKind, RegExp> = {
  quote: /\b(quote|estimate|proposal)\b/,
  job: /\b(job|work order)\b/,
  invoice: /\binvoice\b/,
  client: /\b(client|customer)\b/,
  request: /\b(request|inquiry)\b/,
  visit: /\bvisit\b/,
};

type Sniff = NonNullable<(typeof FIELDS)[Field]["looks"]>;

const STATE_CODES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "),
);

function sniffRatio(values: string[], kind: Sniff): number {
  const vals = values.filter((v) => v.trim() !== "");
  if (!vals.length) return -1;
  let hit = 0;
  for (const v of vals) {
    switch (kind) {
      case "email":
        if (extractEmails(v).length) hit++;
        break;
      case "phone":
        if (normalizePhone(v.replace(/(ext|x)\.?\s*\d+$/i, "")) && !/@/.test(v)) hit++;
        break;
      case "money": {
        const n = parseMoney(v);
        if (n !== undefined && !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v) && !/^\d{4}-\d{2}-\d{2}/.test(v)) hit++;
        break;
      }
      case "date":
        if (parseDate(v)) hit++;
        break;
      case "zip":
        if (/^\d{5}(-\d{4})?$/.test(v.trim())) hit++;
        break;
      case "ref":
        if (/^#?[a-z]{0,5}[- ]?\d+[a-z0-9-]*$/i.test(v.trim())) hit++;
        break;
      case "state":
        if (STATE_CODES.has(v.trim().toUpperCase()) || /^[a-z ]{4,20}$/i.test(v.trim())) hit++;
        break;
    }
  }
  return hit / vals.length;
}

function nameScore(header: string, names: string[]): number {
  let best = 0;
  names.forEach((n, i) => {
    const penalty = i * 0.4;
    let s = 0;
    if (header === n) s = 100;
    else if (header.replace(/ #$/, "") === n.replace(/ #$/, "")) s = 92;
    else if (new RegExp(`(^|\\s)${escapeRe(n)}($|\\s)`).test(header)) {
      // "client email" contains "email" — prefer tighter matches
      s = 70 - Math.min(20, (header.length - n.length) * 0.8);
    } else if (header.startsWith(n) || header.endsWith(n)) s = 55;
    if (s) best = Math.max(best, s - penalty);
  });
  return best;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mapColumns(table: Table, kind: RecordKind): ColumnMapping {
  const headers = table.headers.map(normHeader);
  const sample = table.rows.slice(0, 200);
  const colValues = headers.map((_, i) => sample.map((r) => r[i] ?? ""));
  const candidates: { field: Field; col: number; score: number }[] = [];
  const allowed = KIND_FIELDS[kind];

  for (const field of allowed) {
    const spec = FIELDS[field];
    headers.forEach((h, col) => {
      if (!h) return;
      if (spec.not && spec.not.test(h)) return;
      let score = nameScore(h, spec.names);
      if (!score) return;
      // kind-aware: "quote #" is the number of a quote file but the quoteNumber of a job file
      if (field === "number") {
        if (OTHER_KIND_WORDS[kind].test(h)) score -= 45;
        if (OWN_KIND_WORDS[kind].test(h)) score += 10;
      }
      if (field === "quoteNumber" && kind === "quote") score -= 60;
      if (field === "jobNumber" && kind === "job") score -= 60;
      if (field === "createdOn" && kind !== "client" && /client|customer/.test(h)) score -= 50;
      if (spec.looks) {
        const r = sniffRatio(colValues[col]!, spec.looks);
        if (r >= 0) {
          if (r >= 0.6) score += 12;
          else if (r < 0.2) score -= 35;
        }
      }
      if (score >= 40) candidates.push({ field, col, score });
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const fields: Partial<Record<Field, number>> = {};
  const confidence: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  for (const c of candidates) {
    if (fields[c.field] !== undefined || used.has(c.col)) continue;
    fields[c.field] = c.col;
    confidence[c.field] = Math.min(1, c.score / 100);
    used.add(c.col);
  }

  // Unlabeled but unmistakable columns: emails and phones.
  const sniffUnclaimed = (field: Field, kindOfValue: Sniff, min: number) => {
    if (fields[field] !== undefined || !allowed.includes(field)) return;
    let bestCol = -1;
    let bestR = min;
    colValues.forEach((vals, col) => {
      if (used.has(col)) return;
      const r = sniffRatio(vals, kindOfValue);
      if (r > bestR) {
        bestR = r;
        bestCol = col;
      }
    });
    if (bestCol >= 0) {
      fields[field] = bestCol;
      confidence[field] = 0.6;
      used.add(bestCol);
    }
  };
  sniffUnclaimed("email", "email", 0.7);
  sniffUnclaimed("phone", "phone", 0.8);

  const unused = table.headers.filter((_, i) => !used.has(i));
  return { fields, confidence, unused };
}

export function detectKind(table: Table, fileName = ""): { kind: RecordKind; confidence: number; scores: Record<RecordKind, number> } {
  const headers = table.headers.map(normHeader);
  const joined = headers.join(" | ");
  const fname = fileName.toLowerCase();
  const scores: Record<RecordKind, number> = { quote: 0, job: 0, invoice: 0, client: 0, request: 0, visit: 0 };
  (Object.keys(KIND_SIGNALS) as RecordKind[]).forEach((k) => {
    for (const re of KIND_SIGNALS[k]) if (re.test(joined)) scores[k] += 1;
  });
  const has = (re: RegExp) => headers.some((h) => re.test(h));
  if (has(/approved|converted|changes requested|estimate (outcome|status)|quote status/)) scores.quote += 3;
  if (has(/^(quote|estimate) #$|^(quote|estimate) number$/)) scores.quote += 3;
  if (has(/^job #$|^job number$|job status/)) scores.job += 3;
  if (has(/^invoice #$|^invoice number$|balance|amount due|due date/)) scores.invoice += 3;
  if (has(/^request #$|request status|assessment/)) scores.request += 3;
  if (has(/^visit|visit date|arrival/)) scores.visit += 2;
  if (has(/client since|customer since|client created|lead source/) && !has(/total|amount|status/)) scores.client += 3;

  // file name hints ("Quotes Report.csv", "clients_export.csv")
  if (/quote|estimate|proposal/.test(fname)) scores.quote += 4;
  if (/\bjobs?\b|work.?order/.test(fname)) scores.job += 4;
  if (/invoice/.test(fname)) scores.invoice += 4;
  if (/client|customer|contact/.test(fname)) scores.client += 4;
  if (/request|lead|inquir/.test(fname)) scores.request += 4;
  if (/visit/.test(fname)) scores.visit += 4;

  // A plain owner spreadsheet (name, email, price, date) is almost always a list of quotes.
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total === 0) {
    const hasMoney = has(/total|amount|price|value|quote|estimate/);
    return { kind: hasMoney ? "quote" : "client", confidence: 0.35, scores };
  }
  const ranked = (Object.entries(scores) as [RecordKind, number][]).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const confidence = Math.max(0.3, Math.min(0.98, (top![1] - (second?.[1] ?? 0) + 1) / (top![1] + 1)));
  return { kind: top![0], confidence, scores };
}

export function detectSource(table: Table, fileName = ""): { source: SourceSystem; confidence: number } {
  const headers = table.headers.map((h) => h.trim());
  const text = [...headers, ...table.preamble, fileName].join(" \n ");
  let best: SourceSystem = "spreadsheet";
  let bestScore = 0;
  for (const { source, patterns } of SOURCE_SIGNALS) {
    let s = 0;
    for (const re of patterns) if (headers.some((h) => re.test(h)) || re.test(text)) s++;
    if (s > bestScore) {
      bestScore = s;
      best = source;
    }
  }
  if (bestScore < 2) return { source: bestScore === 1 ? best : "spreadsheet", confidence: bestScore === 1 ? 0.4 : 0.5 };
  return { source: best, confidence: Math.min(0.95, 0.5 + bestScore * 0.12) };
}

export function detect(table: Table, fileName = "", forceKind?: RecordKind): Detection {
  const k = detectKind(table, fileName);
  const kind = forceKind ?? k.kind;
  const s = detectSource(table, fileName);
  const mapping = mapColumns(table, kind);
  const warnings: string[] = [];
  const f = mapping.fields;
  if (f.email === undefined && f.phone === undefined && f.mobile === undefined) warnings.push("No email or phone column found — we can't reach anyone on this list without one.");
  if (f.name === undefined && f.firstName === undefined && f.company === undefined) warnings.push("No customer name column found.");
  if (kind === "quote" || kind === "job" || kind === "invoice") {
    if (f.total === undefined && f.subtotal === undefined) warnings.push("No dollar amount column found — values will be estimated from your average job.");
    if (f.status === undefined) warnings.push("No status column found — we'll infer what happened from the dates and your other files.");
  }
  if (!["createdOn", "sentOn", "issuedOn", "scheduledOn", "completedOn", "clientCreatedOn"].some((x) => f[x as Field] !== undefined))
    warnings.push("No date column found — we can't tell how old these records are.");
  return {
    kind,
    kindConfidence: forceKind ? 1 : k.confidence,
    kindScores: k.scores,
    source: s.source,
    sourceConfidence: s.confidence,
    mapping,
    warnings,
  };
}
