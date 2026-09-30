import { addDays, counted, daysBetween, leadCode, markContacted, renewPlan, round2, setBookedOut, totals, type AccountState, type BusinessProfile, type Reply } from "@qa/engine";
import { localIso } from "./clock.ts";
import { fsmNote, holdSending, parseBusyUntil, queueFsmNote, setBusinessPaused, setOwnerTexts, withdrawMoved, type Deps, type FsmNote } from "./ops.ts";

/**
 * The owner never opens the dashboard: they answer our texts.
 *
 *   About a lead:      BOOKED 2400 #K7Q · DONE · NO · QUOTED · NO ANSWER   (the #code is on every hand-off text)
 *   About the service: PAUSE · RESUME · BUSY until Nov 15 · OPEN · STATUS · RENEW · MONTHLY · CANCEL, then CANCEL YES
 *   About our texts:   STOP turns them off (the follow-ups keep running; hand-offs go by email) · START turns them on
 *
 * Carrier keywords. STOP, STOPALL, UNSUBSCRIBE, END, QUIT, REVOKE and OPTOUT opt a number out at the carrier, so they
 * mean exactly that here too: texts off, nothing else changes. START and UNSTOP opt back in. CANCEL is also on
 * Twilio's default opt-out list: take it off the Messaging Service's opt-out keywords (Advanced Opt-Out) so CANCEL
 * reaches us as the first step of cancelling. If a carrier opts the owner out anyway, the next text fails with
 * Twilio 21610 and deliverOwnerMessages switches them to email and tells the operator, instead of failing quietly.
 *
 * One phone can own several clients (one owner, two brands). A text is matched to a client by the #code in it,
 * else by the client's name in it ("PAUSE LANDSCAPING"), else — for a lead — by the only lead waiting across them.
 * Anything still ambiguous gets a question back, never a guess. Every text is logged; the ones we can't act on
 * (and a "yes" to the paid plan) land in the operator's "Needs a person".
 */

export interface OwnerCommandResult {
  businessId?: string;
  reply: string;
  /** What the text did, for the log ("booked", "pause", "ask_which", "unrecognized"...). */
  handled?: string;
  /** The operator should read it: free-form text, a yes to the paid plan, texts turned off. */
  needsPerson?: boolean;
}

interface Biz {
  id: string;
  profile: BusinessProfile;
  paused: boolean;
}

const OPT_OUT = /^(stop|stop ?all|unsubscribe|end|quit|revoke|opt ?out)$/;
const OPT_IN = /^(start|unstop)$/;
const HELP = /^(help|info|commands)$/;
const AFFIRM = /^(yes|yeah|yep|yup|ya|sure|ok|okay|sounds good|let'?s (do it|go|keep going|keep it going)|keep (it )?going|i'?m in|deal|absolutely|definitely|do it)\b/;

const HELP_TEXT =
  'About a lead: BOOKED 2400 #code, DONE, NO or QUOTED (the #code is on the lead text). About the service: PAUSE, RESUME, BUSY until Nov 15, OPEN, STATUS, CANCEL. STOP turns off our texts (your follow-ups keep running); START turns them back on.';

/** Words that are commands, never a business's short name. */
const COMMAND_WORDS = new Set(["pause", "resume", "open", "busy", "booked", "book", "done", "no", "status", "cancel", "yes", "stop", "start", "renew", "monthly", "yearly", "quoted", "sold", "won", "lost", "full", "free", "hold", "go", "help"]);
const NAME_NOISE = new Set(["the", "and", "co", "company", "inc", "llc", "ltd", "services", "service", "of"]);

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const digitsOf = (phone: string | undefined) => (phone ?? "").replace(/\D/g, "").slice(-10);

/** For each client on the phone: the first word of its name no other client on that phone shares ("AAA", "LANDSCAPING"). */
export function shortNames(bizs: { id: string; profile: { name: string } }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of bizs) {
    const others = new Set(bizs.filter((o) => o.id !== b.id).flatMap((o) => words(o.profile.name)));
    const w = words(b.profile.name).find((x) => x.length >= 2 && !NAME_NOISE.has(x) && !COMMAND_WORDS.has(x) && !others.has(x));
    out.set(b.id, (w ?? b.id.split("-").pop() ?? b.id).toUpperCase());
  }
  return out;
}

/* ------------------------------ reading a text about a lead ------------------------------ */

const CODE = /#\s?([a-z0-9]{3})\b/i;
const NO_ANSWER = /\b(no answer|didn'?t answer|did not answer|no response|voice ?mail|vm|left (a )?(message|msg|vm|voice ?mail)|not picking up|didn'?t pick up|no pick ?up)\b/;
const NOT_BOOKED = /\b(not|didn'?t|did not|never|no)\s+(book|booked|sold|won|buy|bought|go)\b/;
const BOOKED = /\b(booked|book it|sold|won|got the job|closed (it|the deal))\b/;
const QUOTED = /\b(quoted|re-?quoted|(sent|gave|emailed|texted) (him |her |them )?(a |an |the )?(new |updated )?(price|quote|estimate|number))\b/;
const LOST = /^no\b(?!\s+(problem|prob|worries|sweat))|\b(lost|pass(ed)?|dead|not a fit|nope|went with|going with|no go|not interested|no thanks|too expensive|chose someone)\b/;
const REACHED = /\b(done|called|talked|reached|spoke|spoken|texted|emailed|contacted|handled|got (a )?hold of)\b/;

/**
 * The dollar amount in an owner's text: a standalone number ("2400", "$2,400", "2.4k"). Digits inside the #code,
 * dates ("10/15"), phone numbers, times ("3pm") and counts ("3 trees") are never the amount.
 */
export function readAmount(text: string): number {
  const body = text.replace(/#\s?[a-z0-9]{3}\b/gi, " ");
  const re = /(?:^|[\s$(:])\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(k)?(?![\w/:%@-]|\s?(?:am|pm|a\.m|p\.m|o'?clock|days?|weeks?|wks?|months?|mos?|hours?|hrs?|mins?|minutes?|years?|yrs?|ft|feet|trees?|stumps?|jobs?|people|leads?)\b)/gi;
  for (const m of body.matchAll(re)) {
    const v = Number(`${m[1]!.replace(/,/g, "")}.${m[2] ?? "0"}`) * (m[3] ? 1000 : 1);
    if (v >= 10) return round2(v);
  }
  return 0;
}

/**
 * What an owner's text says about a lead, or undefined when it says nothing about one. A plain "yes" is never a
 * booking (it answers the close, or nothing), and "called, no answer" is a no answer, not a win.
 */
export function readLeadText(text: string): { outcome?: Reply["outcome"]; amount: number } | undefined {
  const body = text.replace(/#\s?[a-z0-9]{3}\b/gi, " ");
  const t = body.toLowerCase().replace(/\s+/g, " ").trim();
  const amount = readAmount(body);
  if (NO_ANSWER.test(t)) return { outcome: "no_answer", amount: 0 };
  if (NOT_BOOKED.test(t)) return { outcome: "lost", amount: 0 };
  if (BOOKED.test(t) || (amount > 0 && /^\$?\s?[\d,]+(\.\d{1,2})?\s?k?[.!]*$/.test(t))) return { outcome: "booked", amount };
  if (QUOTED.test(t)) return { outcome: "quoted", amount: 0 };
  if (LOST.test(t)) return { outcome: "lost", amount: 0 };
  if (REACHED.test(t)) return { outcome: undefined, amount: 0 };
  return undefined;
}

/* ------------------------------ the command ------------------------------ */

/** Read one text from an owner, act on it, and log it for the operator. Returns the reply to text back. */
export async function ownerCommand(d: Deps, fromPhone: string, text: string): Promise<OwnerCommandResult> {
  const res = await run(d, fromPhone, text);
  d.accounts.repo.logOwnerText({ businessId: res.businessId, at: d.clock().toISOString(), from: fromPhone, body: text, reply: res.reply, handled: res.handled ?? "command", needsPerson: !!res.needsPerson });
  return res;
}

async function run(d: Deps, fromPhone: string, text: string): Promise<OwnerCommandResult> {
  const digits = digitsOf(fromPhone);
  const all: Biz[] = digits.length === 10 ? d.accounts.repo.listBusinesses().filter((b) => digitsOf(b.profile.ownerPhone) === digits) : [];
  if (!all.length) return { reply: "We don't recognize this number. Text from the phone we have on file for you.", handled: "unknown_number" };
  const multi = all.length > 1;
  const tags = shortNames(all);
  const said = words(text.replace(CODE, " "));
  // A client named in the text ("PAUSE LANDSCAPING"); its name is then left out of the command.
  const namedHits = multi ? all.filter((b) => said.includes(tags.get(b.id)!.toLowerCase())) : [];
  const named = namedHits.length === 1 ? namedHits[0] : undefined;
  const bare = named ? said.filter((w) => w !== tags.get(named.id)!.toLowerCase()).join(" ") : said.join(" ");
  const t = text.trim().toLowerCase();
  const one = multi ? named : all[0];
  const tag = (b: Biz) => (multi ? `${b.profile.name}: ` : "");
  const fallback = () => one ?? latestHandoff(d, all) ?? all[0]!;
  const example = text.replace(CODE, " ").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").toUpperCase().slice(0, 30);
  const askWhich = (): OwnerCommandResult => ({
    businessId: fallback().id,
    reply: `This number runs ${joinOr(all.map((b) => b.profile.name), "and")}. Which one? Text it again with the name, like ${joinOr(all.map((b) => `"${example} ${tags.get(b.id)}"`), "or")}.`,
    handled: "ask_which",
  });
  const directEmail = d.email.kind === "direct";

  /* ---- our texts (the phone as a whole) ---- */
  if (OPT_OUT.test(bare)) {
    await setOwnerTexts(d, fromPhone, { by: "owner" });
    const email = all.find((b) => b.profile.ownerEmail)?.profile.ownerEmail;
    const route = email && directEmail ? `hot leads and reports come to ${email} instead` : "Jack will pass hot leads on to you himself";
    return { businessId: fallback().id, reply: `OK — no more texts from us. Your follow-ups keep running; ${route}. Text START to get texts again. To end the service itself, text CANCEL.`, handled: "texts_off", needsPerson: true };
  }
  if (OPT_IN.test(bare)) {
    await setOwnerTexts(d, fromPhone, undefined);
    const paused = all.filter((b) => b.paused && b.profile.plan.stage !== "cancelled");
    return { businessId: fallback().id, reply: `Texts are back on.${paused.length ? " Your notes are still paused — text RESUME to restart them." : ""}`, handled: "texts_on" };
  }
  if (HELP.test(bare)) return { businessId: fallback().id, reply: HELP_TEXT, handled: "help" };

  /* ---- the service (one client at a time) ---- */
  if (/^(pause|stop sending|hold)\b/.test(bare)) {
    if (!one) return askWhich();
    await pause(d, one.id, true);
    return { businessId: one.id, reply: `${tag(one)}Paused. No notes will go out until you text RESUME.`, handled: "pause" };
  }
  if (/^(resume|unpause|go)\b/.test(bare)) {
    if (!one) return askWhich();
    if (one.profile.plan.stage === "cancelled") return { businessId: one.id, reply: `${tag(one)}You're cancelled, so nothing's running. Want back in? Reply here and Jack will set it up.`, handled: "resume_cancelled", needsPerson: true };
    await pause(d, one.id, false);
    return { businessId: one.id, reply: `${tag(one)}Back on. Notes resume on your next send day.`, handled: "resume" };
  }
  if (/^(status|how|numbers)\b/.test(bare)) {
    const lines = (one ? [one] : all).map((b) => {
      const s = d.accounts.peek(b.id)!.state;
      const wants = s.replies.filter((r) => r.intent === "wants_it" || r.intent === "wants_price").length;
      const booked = counted(s.recoveries).reduce((a, r) => a + r.value, 0);
      return `${tag(b)}So far: ${s.touches.filter((x) => x.status === "sent").length} notes out, ${wants} asked for a price or a date, $${Math.round(booked).toLocaleString("en-US")} booked.`;
    });
    return { businessId: fallback().id, reply: lines.join("\n"), handled: "status" };
  }
  // Yearly plans: RENEW keeps the year, MONTHLY goes month to month. YEARLY switches a monthly plan over.
  if (/^(renew|yearly|annual|monthly|month to month)\b/.test(bare)) {
    if (!one) return askWhich();
    const choice = /^(monthly|month to month)/.test(bare) ? "monthly" : "year";
    let reply = "";
    await d.accounts.withAccount(one.id, (state) => {
      reply = renewPlan(state, choice, nowLocal(d, state));
    });
    await pause(d, one.id, false);
    return { businessId: one.id, reply: `${tag(one)}${choice === "year" ? `${reply} Jack will text you the payment link.` : reply}`, handled: `renew_${choice}` };
  }
  // Month to month, cancel by text. CANCEL shows the facts; CANCEL YES does it.
  if (/^cancel\b/.test(bare)) {
    if (!one) return askWhich();
    const s = d.accounts.peek(one.id)!.state;
    if (s.dataset.business.plan.stage === "cancelled") return { businessId: one.id, reply: `${tag(one)}You're already cancelled. Want back in? Reply here and Jack will set it up.`, handled: "cancel_again" };
    if (!/^cancel (yes|confirm)\b/.test(bare)) {
      const tt = totals(s);
      const open = new Set(s.touches.filter((x) => x.status === "approved" || x.status === "planned").map((x) => x.customerId)).size;
      return {
        businessId: one.id,
        reply: `${tag(one)}No problem. So far: ${tt.booked} booked, $${Math.round(tt.bookedValue).toLocaleString("en-US")} traced. Cancelling stops notes to ${open} ${open === 1 ? "person" : "people"} still in line; everything we found stays yours. Text CANCEL YES${multi ? ` ${tags.get(one.id)}` : ""} to confirm. Only want our texts to stop? Text STOP instead — your follow-ups keep running.`,
        handled: "cancel_ask",
      };
    }
    await d.accounts.withAccount(one.id, (state) => {
      const at = nowLocal(d, state);
      state.dataset.business.plan.stage = "cancelled";
      let n = 0;
      for (const x of state.touches) if (x.status === "approved" || x.status === "planned") (x.status = "cancelled"), n++;
      state.events.push({ id: `ev_cancel_${at}`, at, agent: "guard", kind: "warning", title: "Owner cancelled by text", detail: `${n} queued notes stopped. No further charges, and no more texts to the owner.` });
    });
    // cancel everywhere: queued notes stop, the platform's campaigns pause and leads still waiting are taken back
    await holdSending(d, one.id, "cancel").catch((e) => d.log(`[owner] ${one.id} cancel on the sending platform failed: ${(e as Error).message}`));
    d.accounts.repo.audit(one.id, "owner-sms", "cancel", {});
    return { businessId: one.id, reply: `${tag(one)}Done — cancelled. No more notes, no more charges, and this is our last text. Your ledger link keeps working, and your data is yours to take. Thanks for giving us a shot.`, handled: "cancel" };
  }
  // "BUSY until Nov 15" / "busy 6 weeks" / "OPEN": new work waits for room on the schedule.
  if (/^(busy|booked (out|solid|up)|slammed|full)\b/.test(bare) && !/\$|\b\d{3,}\b(?!\s*(\/|-))/.test(t.replace(/\b(19|20)\d\d\b/, ""))) {
    if (!one) return askWhich();
    let reply = "";
    let pulled: string[] = [];
    await d.accounts.withAccount(one.id, (state) => {
      const today = nowLocal(d, state).slice(0, 10);
      const until = parseBusyUntil(t, today);
      const r = setBookedOut(state, until, nowLocal(d, state));
      pulled = r.withdrawn;
      reply = `Got it — new work waits until you have room. We'll start writing to those folks around ${fmtDay(addDays(until, -21))} so replies land when you can take them.${r.moved ? ` Moved ${r.moved} ${r.moved === 1 ? "person" : "people"} already queued.` : ""} Text OPEN when things free up.`;
    });
    await withdrawMoved(d, one.id, pulled);
    return { businessId: one.id, reply: `${tag(one)}${reply}`, handled: "busy" };
  }
  if (/^(open|not busy|free|room|slow)\b/.test(bare)) {
    if (!one) return askWhich();
    let reply = "";
    let pulled: string[] = [];
    await d.accounts.withAccount(one.id, (state) => {
      const r = setBookedOut(state, undefined, nowLocal(d, state));
      pulled = r.withdrawn;
      reply = `Great — new work is back on.${r.moved ? ` ${r.moved} ${r.moved === 1 ? "person" : "people"} we'd held will hear from us on your next send day.` : ""}`;
    });
    await withdrawMoved(d, one.id, pulled);
    return { businessId: one.id, reply: `${tag(one)}${reply}`, handled: "open" };
  }

  /* ---- a lead ---- */
  const lead = readLeadText(text);
  if (lead) return leadCommand(d, text, lead, named ? [named] : all, multi, tags);

  /* ---- "yes": the answer to the close (or the renewal), never a booking ---- */
  if (AFFIRM.test(t)) {
    if (bare === "yes") await setOwnerTexts(d, fromPhone, undefined); // YES is a carrier opt-in word too
    const pool = one ? [one] : all;
    const closing = pool.filter((b) => outstanding(d, b.id, "close"));
    const renewing = pool.filter((b) => outstanding(d, b.id, "renewal"));
    if (closing.length + renewing.length > 1) return askWhich();
    const b = closing[0] ?? renewing[0];
    if (b && closing.length) {
      await d.accounts.withAccount(b.id, (state) => {
        const at = nowLocal(d, state);
        state.events.push({ id: `ev_owner_yes_${at}`, at, agent: "reporter", kind: "review", title: `${state.dataset.business.ownerFirstName} said yes to keep going`, detail: `“${text.trim().slice(0, 160)}” — send the payment link, then mark them paying.` });
      });
      return { businessId: b.id, reply: `${tag(b)}Great — Jack will text you the payment link, and the next batch goes out next week.`, handled: "accepted_close", needsPerson: true };
    }
    if (b) return { businessId: b.id, reply: `${tag(b)}Great — which one: RENEW for another year, or MONTHLY to go month to month?`, handled: "ask_renewal" };
    return { businessId: fallback().id, reply: "Got it. About a lead? Text BOOKED + amount + the #code, DONE, or NO.", handled: "ack" };
  }

  return { businessId: fallback().id, reply: `Thanks — Jack will read this and get back to you. For a lead, text BOOKED + amount + the #code, DONE, or NO. Text HELP for everything else.`, handled: "unrecognized", needsPerson: true };
}

async function leadCommand(d: Deps, text: string, lead: { outcome?: Reply["outcome"]; amount: number }, pool: Biz[], multi: boolean, tags: Map<string, string>): Promise<OwnerCommandResult> {
  const code = text.match(CODE)?.[1]?.toUpperCase();
  const { outcome, amount } = lead;
  const waiting = (r: Reply) => r.status === "handed_off" && !r.ownerContactedAt;
  const hits: { biz: Biz; reply: Reply; waiting: boolean; name: string }[] = [];
  for (const b of pool) {
    const s = d.accounts.peek(b.id)?.state;
    if (!s) continue;
    for (const r of s.replies)
      if (code ? leadCode(r.id) === code : waiting(r)) hits.push({ biz: b, reply: r, waiting: waiting(r), name: s.dataset.customers.find((c) => c.id === r.customerId)?.name ?? r.from });
  }
  const live = hits.filter((h) => h.waiting);
  const newest = (xs: typeof hits) => xs.sort((a, b) => ((a.reply.handedOffAt ?? a.reply.receivedAt) < (b.reply.handedOffAt ?? b.reply.receivedAt) ? 1 : -1));
  // A code usually names a lead still waiting. With none waiting it's a correction ("booked 2400 #K7Q" after
  // "booked 240 #K7Q"): the newest lead with that code in each business, and the reply names who it went to.
  let picks = code ? live : hits;
  if (code && !live.length) {
    const perBiz = new Map<string, (typeof hits)[number]>();
    for (const h of newest(hits)) if (!perBiz.has(h.biz.id)) perBiz.set(h.biz.id, h);
    picks = [...perBiz.values()];
  }
  const who = (h: (typeof hits)[number]) => `${h.name}${multi ? ` (${h.biz.profile.name})` : ""} #${leadCode(h.reply.id)}`;
  const example = text.replace(CODE, " ").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").toUpperCase().slice(0, 30) || "BOOKED 2400";
  const fallbackBiz = pool.length === 1 ? pool[0]! : pool.find((b) => hits.some((h) => h.biz.id === b.id)) ?? pool[0]!;
  if (!picks.length)
    return code
      ? { businessId: fallbackBiz.id, reply: `No lead with #${code}.${multi ? " Check the code on the lead text." : ""}`, handled: "no_lead" }
      : { businessId: fallbackBiz.id, reply: "Nobody's waiting on a call right now.", handled: "no_lead" };
  if (picks.length > 1) {
    // Never guess: the wrong customer would get the booking, the Jobber note and the ledger line.
    const list = newest(picks).slice(0, 5);
    // Two waiting leads of one business share a code (rare): only a person can tell which one was meant.
    if (code && new Set(picks.map((p) => p.biz.id)).size === 1)
      return { businessId: list[0]!.biz.id, reply: `#${code} fits more than one lead (${list.map((h) => h.name).join(", ")}). Jack will check which one you meant.`, handled: "ask_lead", needsPerson: true };
    return {
      businessId: list[0]!.biz.id,
      reply: code
        ? `#${code} matches more than one lead: ${list.map(who).join(", ")}. Text it again with the business name, like "${example} #${code} ${tags.get(list[0]!.biz.id)}".`
        : `Which one? ${picks.length} are waiting: ${list.map(who).join(", ")}. Text it again with the code, like "${example} #${leadCode(list[0]!.reply.id)}".`,
      handled: "ask_lead",
    };
  }
  const target = picks[0]!;
  const bid = target.biz.id;
  let reply = "";
  let note: FsmNote | undefined;
  await d.accounts.withAccount(bid, (state) => {
    const r = state.replies.find((x) => x.id === target.reply.id);
    if (!r) return;
    const at = nowLocal(d, state);
    markContacted(state, r.id, at, outcome, outcome === "booked" && amount > 0 ? amount : undefined);
    // A correction ("booked 2400 #RK9" after "booked 240 #RK9") replaces the figure the owner gave before.
    if (outcome === "booked" && amount > 0) for (const rec of state.recoveries) if (rec.match === "owner_reported" && rec.record.id === r.id && !rec.disputed) rec.value = round2(amount);
    const name = target.name;
    if (outcome === "booked" || outcome === "quoted")
      note = fsmNote(state, r.customerId, r.opportunityId, `Quiet Accounts: owner marked ${name} ${outcome === "booked" ? `booked${amount > 0 ? ` ($${amount.toLocaleString("en-US")})` : ""}` : "quoted"} after they answered our follow-up.`);
    reply =
      outcome === "booked"
        ? amount > 0
          ? `Booked: ${name}, $${amount.toLocaleString("en-US")}. Added to your results.`
          : `Booked: ${name}. What's the job worth? Text "booked 2400 #${leadCode(r.id)}".`
        : outcome === "quoted"
          ? `Got it — ${name} has a price. We'll count it when it books.`
          : outcome === "lost"
            ? `Got it — ${name} marked not a fit.`
            : outcome === "no_answer"
              ? `Got it — no answer from ${name}. Try again tomorrow.`
              : `Thanks — ${name} marked as reached.`;
  });
  if (note) queueFsmNote(d, bid, note);
  const left = pool.reduce((n, b) => n + (d.accounts.peek(b.id)?.state.replies.filter(waiting).length ?? 0), 0);
  if (left) reply += ` ${left} more waiting.`;
  return { businessId: bid, reply: `${multi ? `${target.biz.profile.name}: ` : ""}${reply}`, handled: outcome ?? "reached" };
}

/* ------------------------------ helpers ------------------------------ */

async function pause(d: Deps, bid: string, paused: boolean): Promise<void> {
  try {
    await setBusinessPaused(d, bid, paused);
  } catch (e) {
    // Paused here regardless; the sending platform is retried by the operator's pause button.
    d.log(`[owner] ${bid} ${paused ? "pause" : "resume"} on the sending platform failed: ${(e as Error).message}`);
  }
}

/** A close (free round's results) or renewal question sent in the last three weeks, not yet answered. */
function outstanding(d: Deps, bid: string, kind: "close" | "renewal"): boolean {
  const s = d.accounts.peek(bid)?.state;
  if (!s) return false;
  const b = s.dataset.business;
  if (kind === "close" && b.plan.stage !== "trial") return false;
  if (kind === "renewal" && (b.plan.stage !== "paying" || b.plan.billing !== "annual")) return false;
  const today = nowLocal(d, s).slice(0, 10);
  return s.ownerMessages.some((m) => m.kind === kind && daysBetween(m.at.slice(0, 10), today) <= (kind === "close" ? 21 : 45));
}

/** The client whose lead was texted to this owner most recently. */
function latestHandoff(d: Deps, bizs: Biz[]): Biz | undefined {
  let best: { b: Biz; at: string } | undefined;
  for (const b of bizs)
    for (const r of d.accounts.peek(b.id)?.state.replies ?? []) {
      const at = r.handedOffAt ?? "";
      if (at && (!best || at > best.at)) best = { b, at };
    }
  return best?.b;
}

function nowLocal(d: Deps, state: AccountState): string {
  return localIso(d.clock(), state.dataset.business.timezone);
}

function joinOr(items: string[], word: "and" | "or"): string {
  return items.length <= 2 ? items.join(` ${word} `) : `${items.slice(0, -1).join(", ")}, ${word} ${items.at(-1)}`;
}

function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}`;
}
