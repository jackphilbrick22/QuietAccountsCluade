import { bannedStatIn } from "../claims.ts";

/**
 * The quality gate every note passes before it can be sent.
 * Flags are reasons a human (or the Writer agent) must look again. Empty = clean.
 */
const SPAMMY = [
  /\bfree\b/i, /\bguarantee[ds]?\b/i, /\bact now\b/i, /\blimited time\b/i, /\burgent\b/i, /\bdiscount\b/i, /\bdeal\b/i, /\bcheap\b/i,
  /\bclick\b/i, /\boffer expires\b/i, /\bwinner\b/i, /\bcash\b/i, /\b100%/i, /\bcongratulations\b/i, /\bspecial promotion\b/i, /\bexclusive\b/i,
  /\bdon'?t miss\b/i, /\bonce in a lifetime\b/i, /\brisk[- ]free\b/i, /\bno obligation\b/i, /\$\$+/,
];
/** Phrases that make a note read like marketing or a bot. Owners and homeowners spot them instantly. */
const CANNED = [
  /\bi hope (this|my) (email|note|message)? ?finds you well\b/i, /\bvalued (customer|client)\b/i, /\btouch(ing)? base\b/i, /\bcircle back\b/i,
  /\bdon'?t hesitate to\b/i, /\bat your earliest convenience\b/i, /\bper my last\b/i, /\bwe appreciate your business\b/i,
  /\bas an ai\b/i, /\bi'?m reaching out\b/i, /\bjust checking in to see\b/i, /\bexciting (news|offer)\b/i,
];
const ACRONYMS = new Set(["HOA", "LLC", "USA", "ASAP", "AC", "HVAC", "PM", "AM", "OK", "NH", "TX", "FL", "CA", "NY", "EAB", "PHC", "DIY"]);

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export function lint(subject: string, body: string, ctx: { firstName: string; job: string; requireJob?: boolean; step?: number; commercial?: boolean }): string[] {
  const flags: string[] = [];
  const unresolved = (subject + body).match(/\{\w+\}/g);
  if (unresolved) flags.push(`Unfilled blank: ${[...new Set(unresolved)].join(", ")}`);
  // everything above the footer (the "Company · address" line starts it)
  const main = body.split(/\n\n[^\n]*·[^\n]*\n/)[0] ?? body;
  const words = wordCount(main);
  if (words > 120) flags.push(`Long (${words} words) — short notes get more replies`);
  if (words < 15) flags.push(`Very short (${words} words)`);
  if (/https?:\/\/|www\./i.test(main)) flags.push("Has a link — plain notes without links land in the inbox and read like a person");
  if (/!/.test(main) || /!/.test(subject)) flags.push("Exclamation mark — reads like marketing");
  for (const re of SPAMMY) if (re.test(main) || re.test(subject)) flags.push(`Spam-filter word: "${(main.match(re) ?? subject.match(re))?.[0]}"`);
  const shouting = (main + " " + subject).split(/\s+/).filter((w) => /^[A-Z]{4,}$/.test(w.replace(/[^A-Za-z]/g, "")) && !ACRONYMS.has(w.replace(/[^A-Za-z]/g, "")));
  if (shouting.length) flags.push(`ALL CAPS: ${shouting.slice(0, 3).join(", ")}`);
  if (!/reply|\?|tell me|let me know|one line back/i.test(main)) flags.push("No ask — every note should end with an easy question");
  if ((ctx.requireJob ?? true) && ctx.job && !main.toLowerCase().includes(ctx.job.toLowerCase())) flags.push("Doesn't mention their job");
  if (!/Reply "stop"/.test(body)) flags.push("Missing the stop line (required)");
  if (!/·/.test(body)) flags.push("Missing the business address (required)");
  for (const re of CANNED) if (re.test(main) || re.test(subject)) flags.push(`Sounds canned: "${(main.match(re) ?? subject.match(re))?.[0]}"`);
  const banned = bannedStatIn(main + " " + subject);
  if (banned) flags.push(`Repeats an unsourced stat ("${banned}")`);
  else if (/\d\s?%/.test(main)) flags.push("Has a percentage — notes to homeowners never quote stats");
  // a reply's "Re: " doesn't count: it has to repeat note 1's subject exactly to thread
  if (subject.replace(/^re:\s*/i, "").length > 60) flags.push("Subject too long");
  if (/^re:\s*re:/i.test(subject)) flags.push("Double Re:");
  // no first name: "there, checking back…" / "Last note from me on this, there." read like a mail merge
  if ((ctx.step ?? 1) > 1 && (/^there,/i.test(main.trim()) || /, there[.?]/i.test(main))) flags.push('Uses "there" as a name mid-thread');
  // "Re:" is only honest on a real reply in the same thread — never on a first note.
  if ((ctx.step ?? 1) === 1 && /^(re|fwd?):/i.test(subject)) flags.push("Fake Re:/Fwd: on a first note");
  if (ctx.commercial && !/You're getting this/.test(body)) flags.push("Missing the why-you're-getting-this line (required)");
  return flags;
}
