import type { ISODate, Money, Quote } from "../model.ts";
import type { AccountState } from "../runtime/state.ts";
import { addDays, round2 } from "../util.ts";

/**
 * The quiet rate: of the quotes that had time for an answer (sent 14+ days ago, not drafts), the share
 * nobody ever said yes or no to. It's the one number the whole service exists to drive toward zero —
 * our "the ad platform under-reports your sales". Before we start it comes straight from the owner's
 * software; once we're working, any real reply from that person (yes, no, pass, later, a question)
 * counts as an answer too.
 */
export interface QuietRate {
  quotes: number;
  answered: number;
  quiet: number;
  /** quiet / quotes, 0..1 */
  rate: number;
  quietValue: Money;
}

export interface QuietRates {
  /** The twelve months before our first note: what their software shows. */
  before: QuietRate;
  /** Quotes written since we started (the always-on work). */
  since?: QuietRate;
  /** The old quiet quotes we followed up, and how many got an answer. */
  backlog?: { followed: number; answered: number };
  startedOn?: ISODate;
}

const WAIT_DAYS = 14;
/** The window the headline rate looks at: two years of quotes, the same everywhere it's shown. */
const WINDOW_DAYS = 730;
const ANSWERED = new Set(["approved", "converted", "declined", "changes_requested"]);
const NOT_AN_ANSWER = new Set(["auto_reply", "bounce"]);

const sentOn = (q: Quote) => q.sentOn ?? q.createdOn;

function rateOf(quotes: Quote[], answered: (q: Quote) => boolean): QuietRate {
  let a = 0;
  let quietValue = 0;
  for (const q of quotes) {
    if (answered(q)) a++;
    else quietValue += q.total;
  }
  const n = quotes.length;
  return { quotes: n, answered: a, quiet: n - a, rate: n ? round2((n - a) / n) : 0, quietValue: round2(quietValue) };
}

/**
 * The quiet rate straight from the owner's records, as of a day: quotes sent in the two years before it that
 * had two weeks to get an answer (no drafts, no $0), and the share that never got a yes or a no. The site's
 * audit, the welcome text and the Friday report's "before" all use this one definition.
 */
export function quietRateOf(ds: AccountState["dataset"], end: ISODate): QuietRate {
  const cut = addDays(end, -WAIT_DAYS);
  const from = addDays(end, -WINDOW_DAYS);
  const inWindow = ds.quotes.filter((q) => { const d = sentOn(q); return !!d && q.status !== "draft" && q.total > 0 && d >= from && d <= cut; });
  return rateOf(inWindow, (q) => ANSWERED.has(q.status));
}

export function quietRates(state: AccountState): QuietRates {
  const ds = state.dataset;
  const cut = addDays(ds.asOf, -WAIT_DAYS);
  const sent = state.touches.filter((t) => t.status === "sent" || t.status === "delivered");
  const startedOn = sent.map((t) => (t.sentAt ?? t.dueAt).slice(0, 10)).sort()[0];
  const before = quietRateOf(ds, startedOn ?? ds.asOf);
  if (!startedOn) return { before };

  // First real reply per person, so "answered" means they wrote back after the quote went out.
  const replied = new Map<string, ISODate>();
  for (const r of state.replies) {
    if (!r.customerId || NOT_AN_ANSWER.has(r.intent)) continue;
    const d = r.receivedAt.slice(0, 10);
    const prev = replied.get(r.customerId);
    if (!prev || d > prev) replied.set(r.customerId, d);
  }
  const answeredSince = (q: Quote) => ANSWERED.has(q.status) || (replied.get(q.customerId) ?? "") >= (sentOn(q) ?? "9999");
  const inSince = ds.quotes.filter((q) => { const d = sentOn(q); return !!d && q.status !== "draft" && q.total > 0 && d >= startedOn && d <= cut; });
  const since = inSince.length ? rateOf(inSince, answeredSince) : undefined;

  // The backlog: people whose old quote we followed up, and whether that got them talking.
  const followedQuote = new Set(
    (state.scan?.opportunities ?? [])
      .filter((o) => ["unanswered_quote", "archived_quote", "changes_requested"].includes(o.type) && sent.some((t) => t.opportunityId === o.id))
      .map((o) => o.customerId),
  );
  const firstNote = new Map<string, ISODate>();
  for (const t of sent) {
    const d = (t.sentAt ?? t.dueAt).slice(0, 10);
    if (!firstNote.has(t.customerId) || d < firstNote.get(t.customerId)!) firstNote.set(t.customerId, d);
  }
  let answered = 0;
  for (const c of followedQuote) if ((replied.get(c) ?? "") >= (firstNote.get(c) ?? "9999")) answered++;
  return { before, since, backlog: followedQuote.size ? { followed: followedQuote.size, answered } : undefined, startedOn };
}

/** "47%" — the way it's said to an owner. */
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
