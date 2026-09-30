/**
 * The bytes of an uploaded or emailed export → text.
 *
 * Excel's classic "CSV (Comma delimited)" is Windows-1252, not UTF-8: read as UTF-8, "José O’Brien" becomes
 * "Jos� O�Brien" and the greeting "Hi Jos�". Excel's "Unicode Text" is UTF-16 with a BOM. So: a UTF-16 BOM
 * wins, then strict UTF-8 (which also covers plain ASCII), and only bytes that aren't valid UTF-8 are 1252.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return stripBom(new TextDecoder("utf-16le").decode(bytes));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return stripBom(new TextDecoder("utf-16be").decode(bytes));
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
