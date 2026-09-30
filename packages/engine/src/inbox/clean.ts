/**
 * Reply cleaning — reduce a raw email reply to the words the person actually typed.
 *
 * Strips, in order:
 *   1. HTML (quoted-history containers, tags, entities)
 *   2. quoted history ("On ... wrote:", "-----Original Message-----", Outlook "From:/Sent:" blocks,
 *      "________________" separators, "> " lines, forwarded-message headers), also in Spanish,
 *      Portuguese, French and German ("El … escribió:", "Em … escreveu:", "Le … a écrit :", "De:/Enviado:")
 *   3. signatures ("Sent from my iPhone", "Enviado desde mi iPhone", "Get Outlook for iOS", "-- " delimiter, ...)
 *   4. excess whitespace
 *
 * Closings followed by a name ("Thanks, Mike") are kept; they are harmless to the classifier.
 */

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "...",
  mdash: "—",
  ndash: "–",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  zwnj: "",
  zwj: "",
  shy: "",
};

/** The Latin-1 block (U+00A0–U+00FF) in code-point order, so "José" survives as &eacute; / &Eacute;. */
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";
const NAMED = new Map<string, string>([...LATIN1.split(" ").map((n, i): [string, string] => [n, String.fromCharCode(0xa0 + i)]), ...Object.entries(ENTITIES)]);

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    }
    // Case matters for letters (&Eacute; vs &eacute;); shouted forms like &NBSP; fall back to lowercase.
    return NAMED.get(body) ?? NAMED.get(body.toLowerCase()) ?? whole;
  });
}

const HTML_HINT = /<\s*\/?\s*(html|body|div|p|br|span|blockquote|table|td|tr|font|b|i|strong|em|a|ul|ol|li|hr|h[1-6]|img|meta|style|head)\b[^>]*>/i;

/** Quoted-history containers the big webmail clients wrap around the previous message. */
const HTML_QUOTE_START = [
  /<div[^>]*class=["'][^"']*gmail_quote[^"']*["'][^>]*>/i,
  /<div[^>]*class=["'][^"']*gmail_attr[^"']*["'][^>]*>/i,
  /<div[^>]*class=["'][^"']*yahoo_quoted[^"']*["'][^>]*>/i,
  /<div[^>]*id=["']?(divRplyFwdMsg|appendonsend|mail-editor-reference-message-container)["']?[^>]*>/i,
  /<blockquote[^>]*type=["']?cite["']?[^>]*>/i,
  /<div[^>]*class=["'][^"']*(moz-cite-prefix|protonmail_quote|zmail_extra|OutlookMessageHeader)[^"']*["'][^>]*>/i,
];

export function htmlToText(html: string): string {
  let s = html;
  // Cut at the first quoted-history container: everything after it is the old thread.
  let cut = -1;
  for (const re of HTML_QUOTE_START) {
    const m = re.exec(s);
    if (m && (cut < 0 || m.index < cut)) cut = m.index;
  }
  if (cut >= 0) s = s.slice(0, cut);
  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote\s*>/gi, "\n")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*hr\b[^>]*>/gi, "\n________________________________\n")
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|table|ul|ol)\s*>/gi, "\n")
    .replace(/<\s*(p|div|li|tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return s;
}

/* ------------------------- quoted history ------------------------- */

const SINGLE_LINE_QUOTE_HEADERS: RegExp[] = [
  // Gmail / Apple Mail / Yahoo: "On Tue, May 3, 2025 at 9:12 AM Sarah <sarah@x.com> wrote:"
  /^\s*on\b.{0,300}\bwrote\s*:?\s*$/i,
  // Some clients put the text before the header on the same line: "... Sarah wrote:" (Yahoo mobile)
  /^.{0,300}\b<[^>@\s]+@[^>\s]+>\s*wrote\s*:\s*$/i,
  /^\s*-{2,}\s*(original message|original|forwarded message|reply message)\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*(original message|forwarded message)\b/i,
  /^\s*_{8,}\s*$/,
  /^\s*={8,}\s*$/,
  /^\s*(begin forwarded message|forwarded message)\s*:?/i,
  /^\s*le\s.{0,200}\ba\s+[ée]crit\s*:\s*$/i,
  /^\s*el\s.{0,200}\bescribi[óo]\s*:\s*$/i,
  /^\s*em\s.{0,200}\bescreveu\s*:\s*$/i,
  /^\s*am\s.{0,200}\bschrieb\s.{0,100}:\s*$/i,
  /^\s*quoting\s.{1,120}:\s*$/i,
];

// Outlook's header block in English, Spanish, Portuguese, French and German ("De:/Enviado:/Para:/Asunto:").
const HEADER_FIELD =
  /^\s*\*?\s*(from|sent|date|to|cc|subject|reply-to|de|enviado(?: el)?|enviada|para|asunto|fecha|assunto|data|envoy[ée]|[àa]|objet|von|gesendet|an|betreff)\s*:\s*\*?/i;

function isOutlookBlockStart(lines: string[], i: number): boolean {
  const line = lines[i] ?? "";
  if (!/^\s*\*?\s*(from|de|von)\s*:\s*\*?\s*\S/i.test(line)) return false;
  // Need at least one more header field right after "From:" to be sure this is a header block.
  let fields = 0;
  for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
    const l = lines[j] ?? "";
    if (!l.trim()) continue;
    if (HEADER_FIELD.test(l)) fields++;
    else break;
  }
  return fields >= 1;
}

/** "On … wrote:" and its Spanish, Portuguese, French and German forms. */
const ON_WROTE: [RegExp, RegExp][] = [
  [/^\s*on\s+\S/i, /\bwrote\s*:?\s*$/i],
  [/^\s*el\s+\S/i, /\bescribi[óo]\s*:\s*$/i],
  [/^\s*em\s+\S/i, /\bescreveu\s*:\s*$/i],
  [/^\s*le\s+\S/i, /\ba\s+[ée]crit\s*:\s*$/i],
  [/^\s*am\s+\S/i, /\bschrieb\b.{0,100}:\s*$/i],
];

function isMultiLineOnWrote(lines: string[], i: number): boolean {
  const line = lines[i] ?? "";
  const pair = ON_WROTE.find(([on]) => on.test(line));
  if (!pair) return false;
  // "On Tue, May 3, 2025 at 9:12 AM Sarah Ridge <sarah@" + "ridgeline.com> wrote:"
  if (!/(\d{1,2}:\d{2}|\d{4}|\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|,)/i.test(line)) return false;
  for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
    if (pair[1].test(lines[j] ?? "")) return true;
  }
  return false;
}

/* --------------------------- signatures --------------------------- */

const SIGNATURE_LINES: RegExp[] = [
  /^\s*sent from my\b.{0,60}$/i,
  /^\s*sent from (yahoo|aol|outlook|mail|gmail|samsung|xfinity|comcast|at&t|att|verizon|the mail app|windows mail|proton)\b.{0,60}$/i,
  /^\s*sent (via|using|with|through|on)\b.{0,60}\b(app|iphone|ipad|android|mobile|mail|outlook|yahoo|gmail|blackberry|samsung|galaxy|phone|device|superhuman|spark|airmail)\b.{0,30}$/i,
  /^\s*get outlook for (ios|android|iphone|mac|windows)\b.*$/i,
  /^\s*(download|get) the (yahoo mail|outlook|gmail|aol) app\b.*$/i,
  /^\s*(this e-?mail|this message) (has been|was) (checked|scanned) for viruses\b.*$/i,
  /^\s*virus-free\.?\s*(www\.)?avast\.com.*$/i,
  /^\s*sent from xfinity connect\b.*$/i,
  // "Enviado desde mi iPhone", "Enviado do meu iPhone", "Envoyé de mon iPhone", "Von meinem iPhone gesendet"
  /^\s*(enviado desde|enviado do meu|envoy[ée] de mon|envoy[ée] depuis|gesendet von)\b.{0,60}$/i,
  /^\s*von meinem\b.{0,40}\bgesendet\s*\.?\s*$/i,
];

const INLINE_SIGNATURE = /\s*(sent from my (iphone|ipad|android|samsung\b[^.\n]{0,30}|galaxy[^.\n]{0,20}|verizon[^.\n]{0,30}|t-mobile[^.\n]{0,30}|smartphone|mobile device|phone)|sent from yahoo mail(?: for (?:iphone|android))?|get outlook for (?:ios|android)|enviado desde mi (?:iphone|ipad|android|samsung\b[^.\n]{0,30}|celular|m[óo]vil|tel[ée]fono)|enviado do meu (?:iphone|ipad|android|celular)|envoy[ée] de mon (?:iphone|ipad|t[ée]l[ée]phone))\s*\.?\s*$/i;

function isSignatureDelimiter(line: string): boolean {
  // RFC 3676 "-- " (many clients drop the trailing space, so accept a bare "--" too).
  return /^\s*--\s*$/.test(line);
}

/* ------------------------------ main ------------------------------ */

/**
 * Strip quoted history, signatures, HTML and noise from a reply, keeping the person's own words.
 * Deterministic and dependency-free.
 */
export function cleanReplyText(raw: string): string {
  if (!raw) return "";
  let s = String(raw);

  s = s.replace(/\r\n?/g, "\n");
  if (HTML_HINT.test(s)) s = htmlToText(s);
  s = decodeEntities(s);
  s = s
    .replace(/[​‌‍⁠﻿­]/g, "")
    .replace(/[   ]/g, " ")
    .replace(/\t/g, " ");

  const lines = s.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Quoted history: stop reading at the first header that introduces the old thread.
    if (SINGLE_LINE_QUOTE_HEADERS.some((re) => re.test(line))) break;
    if (isMultiLineOnWrote(lines, i)) break;
    if (isOutlookBlockStart(lines, i)) break;
    // Signatures: everything from here down is boilerplate or the old thread.
    if (SIGNATURE_LINES.some((re) => re.test(line))) break;
    if (isSignatureDelimiter(line)) break;
    // Inline-quoted lines ("> ...") are the old message, even when interleaved.
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }

  let out = kept
    .map((l) => l.replace(/ {2,}/g, " ").replace(/\s+$/g, "").replace(/^\s+/g, ""))
    .join("\n");
  // Signature glued onto the end of the last line ("Yes please Sent from my iPhone").
  out = out.replace(INLINE_SIGNATURE, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}
