/**
 * A forgiving CSV/TSV reader for the files owners actually send:
 * BOMs, Excel quoting, embedded newlines, report titles above the header,
 * "Totals" rows at the bottom, semicolon exports from European Excel.
 */

export interface Table {
  headers: string[];
  rows: string[][];
  /** Lines skipped above the header (report titles, date ranges). */
  preamble: string[];
  delimiter: string;
}

export function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 20000).split(/\r?\n/).slice(0, 25);
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const counts = sample.map((l) => countOutsideQuotes(l, d)).filter((c) => c > 0);
    if (!counts.length) continue;
    // most common count, weighted by how many lines agree
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let modeCount = 0;
    let mode = 0;
    for (const [c, f] of freq) if (f > modeCount || (f === modeCount && c > mode)) [mode, modeCount] = [c, f];
    const score = modeCount * Math.log2(mode + 1);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (!q && c === d) n++;
  }
  return n;
}

export function parseRows(text: string, delimiter?: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter ?? sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"' && cur.trim() === "") {
      q = true;
      cur = "";
    } else if (c === d) {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

const HEADER_HINTS =
  /(name|client|customer|email|phone|address|street|city|state|zip|quote|estimate|job|invoice|status|total|amount|date|created|title|description|number|#|id|balance|property)/i;

/** Find the header row: the first row with several distinct, label-like cells. */
function findHeaderIndex(rows: string[][]): number {
  const limit = Math.min(rows.length, 15);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < limit; i++) {
    const r = rows[i]!;
    const nonEmpty = r.filter(Boolean);
    if (nonEmpty.length < 2) continue;
    const labelish = nonEmpty.filter((c) => c.length < 60 && !/^[\d$.,\-/: ]+$/.test(c)).length;
    const hinted = nonEmpty.filter((c) => HEADER_HINTS.test(c)).length;
    const unique = new Set(nonEmpty.map((c) => c.toLowerCase())).size === nonEmpty.length ? 1 : 0;
    // the next row should be at least as wide
    const next = rows[i + 1];
    const widthOk = next ? (next.filter(Boolean).length >= Math.min(2, nonEmpty.length) ? 1 : 0) : 0;
    const score = hinted * 3 + labelish + unique * 2 + widthOk * 2 + nonEmpty.length * 0.2;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
    if (hinted >= 3 && unique) return i;
  }
  return bestIdx;
}

export function parseTable(text: string): Table {
  const delimiter = sniffDelimiter(text);
  const all = parseRows(text, delimiter);
  if (!all.length) return { headers: [], rows: [], preamble: [], delimiter };
  const h = findHeaderIndex(all);
  const headers = dedupeHeaders(all[h]!.map((x) => x.replace(/\s+/g, " ").trim()));
  const width = headers.length;
  const rows = all
    .slice(h + 1)
    .filter((r) => !isTotalsRow(r))
    .map((r) => {
      if (r.length === width) return r;
      if (r.length > width) return r.slice(0, width);
      return [...r, ...Array(width - r.length).fill("")];
    });
  return { headers, rows, preamble: all.slice(0, h).map((r) => r.filter(Boolean).join(" ")), delimiter };
}

function dedupeHeaders(hs: string[]): string[] {
  const seen = new Map<string, number>();
  return hs.map((x, i) => {
    const base = x || `Column ${i + 1}`;
    const n = seen.get(base.toLowerCase()) ?? 0;
    seen.set(base.toLowerCase(), n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
}

function isTotalsRow(r: string[]): boolean {
  const first = r.find((c) => c !== "") ?? "";
  if (/^(grand )?totals?:?$/i.test(first) || /^total (for|of)\b/i.test(first)) return true;
  // rows where only numbers remain (a sum line) and fewer than a third of cells filled
  const filled = r.filter(Boolean);
  return filled.length > 0 && filled.length <= Math.max(1, Math.floor(r.length / 4)) && filled.every((c) => /^[\d$.,\-()]+$/.test(c)) && r.length > 4;
}

/**
 * A text cell a spreadsheet would run as a formula (=, +, -, @, tab or CR first) gets a leading ' so Excel and
 * Sheets show it as text. Homeowner-written text lands in these files. Plain numbers, dates and phone numbers
 * ("-120.50", "+1 603 555 0199") are left alone: they can't call a function.
 */
export function neutralizeFormula(s: string): string {
  if (!/^[=+\-@\t\r]/.test(s)) return s;
  if (/^[+-]?[\d\s().,/-]*\d[\d\s().,/-]*$/.test(s)) return s;
  return `'${s}`;
}

/** Serialize rows back to CSV (for exports / Instantly uploads). Text that would run as a formula is neutralized. */
export function toCSV(headers: string[], rows: (string | number | undefined | null)[][]): string {
  const esc = (v: string | number | undefined | null) => {
    const s = v == null ? "" : typeof v === "number" ? String(v) : neutralizeFormula(String(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}
