import { addDays, cancelPlan, counted, daysBetween, leadCode, markContacted, ownerApproves, peopleNamed, renewPlan, round2, setBookedOut, skipPerson, totals, undoCancel, type AccountState, type BusinessProfile, type Reply } from "@qa/engine";
import { localIso } from "./clock.ts";
import { deliverOwnerMessages, fsmNote, holdSending, raiseAlert, parseBusyUntil, queueFsmNote, setBusinessPaused, setOwnerTexts, withdrawMoved, type Deps, type FsmNote } from "./ops.ts";

/**
 * The owner never opens the dashboard: they answer our texts.
 *
 *   About a lead:      BOOKED 2400 #K7Q · DONE · NO · QUOTED · NO ANSWER   (the #code is on every hand-off text)
 *   About the service: PAUSE · RESUME · BUSY until Nov 15 · OPEN · STATUS · RENEW · MONTHLY · CANCEL (UNDO within a day)
 *   About a person:    SKIP Karen Whitfield — off every list (already won it, said no on the phone, a friend)
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
/** "SKIP Karen Whitfield", "remove the Whitfields", "don't email Karen Whitfield". */
const SKIP = /^(skip|remove|take off|leave off|leave out|do not (email|write|contact)|don t (email|write|contact))\s+(.+)$/;
/**
 * An OK to the first note in the welcome text: the whole text has to be an approval ("OK", "Looks good, thanks").
 * "OK but don't email Karen" is a change, not an OK. Matched against the words only (punctuation dropped).
 */
const APPROVE_WORD = "(ok|okay|k|kk|yes|yep|yeah|yup|ya|sure|go|go ahead|send|send it|send them|start|start it|looks good|look good|sounds good|good to go|approve|approved|do it|lets go|let s go|perfect|great|fine|all good|thats fine|that s fine|love it|good)";
const APPROVE_TAIL = "(thanks|thank you|thx|ty|jack|man|please|pls|first note|the first note|go ahead|send it|looks good|sounds good|perfect|great|good|all good|lets go|let s go)";
const APPROVE = new RegExp(`^${APPROVE_WORD}( ${APPROVE_TAIL})*$`);
/** CANCEL on its own (or "cancel the service"); "cancel the note to Karen" is not cancelling the service. */
const CANCEL_ALL = /^cancel( (the|my|our|service|plan|subscription|everything|it|all|quiet|accounts|account|yes|confirm|please|now))*$/;
const AFFIRM = /^(yes|yeah|yep|yup|ya|sure|ok|okay|sounds good|let'?s (do it|go|keep going|keep it going)|keep (it )?going|i'?m in|deal|absolutely|definitely|do it)\b/;

const HELP_TEXT =
  'About a lead: BOOKED 2400 #code, DONE, NO or QUOTED (the #code is on the lead text). About a person: SKIP and their name takes them off the list. About the service: PAUSE, RESUME, BUSY until Nov 15, OPEN, STATUS, CANCEL. STOP turns off our texts (your follow-ups keep running); START turns them back on.';

/** Words that are commands, never a business's short name. */
const COMMAND_WORDS = new Set(["skip", "remove", "undo", "pause", "resume", "open", "busy", "booked", "book", "done", "no", "status", "cancel", "yes", "stop", "start", "renew", "monthly", "yearly", "quoted", "sold", "won", "lost", "full", "free", "hold", "go", "help"]);
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

  /* ---- the first note: nothing goes out until the owner says OK ---- */
  const waitingOk = (one ? [one] : all).filter((b) => !!d.accounts.peek(b.id)?.state.awaitingOwnerOk && b.profile.plan.stage !== "cancelled");
  const hasCode = CODE.test(text);
  // something else on this phone an "ok" or a "yes" could be answering: a lead waiting on a call, the close, the renewal
  const otherOpen = (skip?: Biz) => all.some((x) => x !== skip && (hasWaitingLead(d, x.id) || outstanding(d, x.id, "close") || outstanding(d, x.id, "renewal"))) || (!!skip && hasWaitingLead(d, skip.id));
  if (waitingOk.length && !hasCode && APPROVE.test(bare)) {
    if (waitingOk.length > 1) return askWhich();
    const b = waitingOk[0]!;
    const explicit = !!named || /\bfirst note\b/.test(bare);
    if (!explicit && otherOpen(b))
      return { businessId: b.id, reply: `${tag(b)}Is that OK for the first note? Text "OK first note"${multi ? ` ${tags.get(b.id)}` : ""} to start it. About a lead? Text BOOKED + amount + the #code, DONE, or NO.`, handled: "ask_ok" };
    if (bare === "yes") await setOwnerTexts(d, fromPhone, undefined); // YES is a carrier opt-in word too
    let r: { approved: number; firstDay?: string } = { approved: 0 };
    await d.accounts.withAccount(b.id, (state) => {
      r = ownerApproves(state, nowLocal(d, state));
    });
    const when = r.firstDay ? fmtDay(r.firstDay) : "your next send day";
    return { businessId: b.id, reply: `${tag(b)}Done — the first notes go out ${when}. When someone wants a price or a date, you'll get a text with their name and number.`, handled: "approved_first_note" };
  }

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
    if (one.profile.plan.stage === "cancelled") {
      const c = d.accounts.peek(one.id)!.state.cancelled;
      return { businessId: one.id, reply: `${tag(one)}You're cancelled, so nothing's running.${c ? " Didn't mean to cancel? Text UNDO." : " Want back in? Reply here and Jack will set it up."}`, handled: "renew_cancelled", needsPerson: !c };
    }
    const choice = /^(monthly|month to month)/.test(bare) ? "monthly" : "year";
    let reply = "";
    await d.accounts.withAccount(one.id, (state) => {
      reply = renewPlan(state, choice, nowLocal(d, state));
    });
    await pause(d, one.id, false);
    return { businessId: one.id, reply: `${tag(one)}${choice === "year" ? `${reply} Jack will text you the payment link.` : reply}`, handled: `renew_${choice}` };
  }
  // Month to month, cancel by text: one text does it (a yearly plan gets back what it didn't use). UNDO within a day puts it all back.
  if (/^cancel\b/.test(bare) && !CANCEL_ALL.test(bare))
    return { businessId: fallback().id, reply: `${one ? tag(one) : ""}Did you mean to cancel the whole service? Text CANCEL on its own for that. To take one person off, text SKIP and their name. Jack will read this too.`, handled: "cancel_unclear", needsPerson: true };
  if (CANCEL_ALL.test(bare)) {
    if (!one) return askWhich();
    const s = d.accounts.peek(one.id)!.state;
    if (s.dataset.business.plan.stage === "cancelled") return { businessId: one.id, reply: `${tag(one)}You're already cancelled.${s.cancelled ? " Didn't mean it? Text UNDO." : " Want back in? Reply here and Jack will set it up."}`, handled: "cancel_again" };
    let r = { stopped: 0, refund: 0, line: "" };
    let until = "";
    await d.accounts.withAccount(one.id, (state) => {
      const at = nowLocal(d, state);
      r = cancelPlan(state, at, { paused: one.paused });
      until = `${fmtClock(at)} tomorrow`;
    });
    // cancel everywhere: the platform's campaigns pause and leads still waiting are taken back
    await holdSending(d, one.id, "cancel").catch((e) => d.log(`[owner] ${one.id} cancel on the sending platform failed: ${(e as Error).message}`));
    d.accounts.repo.audit(one.id, "owner-sms", "cancel", { stopped: r.stopped, refund: r.refund });
    // a yearly refund text goes straight to the operator's queue: they issue it, then send it
    if (r.refund) await deliverOwnerMessages(d, one.id);
    const tt = totals(d.accounts.peek(one.id)!.state);
    return {
      businessId: one.id,
      reply: `${tag(one)}Done — cancelled. No more notes, no more charges.${r.line ? ` ${r.line}` : ""} So far: ${tt.booked} booked, $${Math.round(tt.bookedValue).toLocaleString("en-US")} on your ledger, and everything we found stays yours. Didn't mean it? Text UNDO${multi ? ` ${tags.get(one.id)}` : ""} by ${until} and it all picks back up.`,
      handled: "cancel",
    };
  }
  if (/^undo\b/.test(bare)) {
    const pool = (one ? [one] : all).filter((b) => d.accounts.peek(b.id)?.state.cancelled);
    if (pool.length > 1) return askWhich();
    const b = pool[0];
    if (!b) return { businessId: fallback().id, reply: "There's nothing to undo. Text HELP for what you can text us.", handled: "undo_nothing" };
    let r: ReturnType<typeof undoCancel>;
    await d.accounts.withAccount(b.id, (state) => {
      r = undoCancel(state, nowLocal(d, state));
    });
    const res = r!;
    if (!res || "refused" in res) {
      // a yearly refund may already be on its way: a person puts it back, never the software
      if (res && res.refused === "refund")
        await raiseAlert(d, b.id, { kind: "undo_refund", title: `${b.profile.name} wants to undo their cancel`, detail: "A yearly refund was set up when they cancelled. If it's already issued, settle that first; then set them back to paying and text them." });
      return {
        businessId: b.id,
        reply: res && res.refused === "refund" ? `${tag(b)}Glad you're staying. A refund was already set up for your year, so Jack will put everything back himself today and text you.` : `${tag(b)}It's been more than a day, so Jack will set you back up himself. He'll text you.`,
        handled: res && res.refused === "refund" ? "undo_refund" : "undo_late",
        needsPerson: true,
      };
    }
    // the owner had paused before cancelling: it stays paused
    if (!res.paused) await holdSending(d, b.id, "resume").catch((e) => d.log(`[owner] ${b.id} resume on the sending platform failed: ${(e as Error).message}`));
    d.accounts.repo.audit(b.id, "owner-sms", "undo_cancel", { restored: res.restored });
    return { businessId: b.id, reply: `${tag(b)}Back on — nothing was lost. ${res.restored ? `${res.restored} ${res.restored === 1 ? "note is" : "notes are"} back in line.` : "We'll pick up on your next send day."}${res.paused ? " You'd paused before, so it stays paused until you text RESUME." : ""}`, handled: "undo_cancel" };
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

  /* ---- a person: off every list ---- */
  const skip = bare.match(SKIP);
  if (skip) {
    // The name is what comes before any reason: "don't email the Johnsons, they're family".
    const said = text.replace(CODE, " ").trim().toLowerCase().replace(/^(skip|remove|take off|leave off|leave out|do not (email|write|contact)|don'?t (email|write|contact))\s+/, "");
    const short = named ? tags.get(named.id)!.toLowerCase() : "";
    const who = said.split(/[,.;!?()]| - | — | because | they | she | he | we /)[0]!.split(/\s+/).filter((w) => !short || w !== short).join(" ").trim() || skip[4]!;
    const pool = one ? [one] : all;
    const hits = pool.flatMap((b) => peopleNamed(d.accounts.peek(b.id)!.state, who).map((c) => ({ b, c })));
    if (!hits.length)
      return { businessId: fallback().id, reply: `I couldn't find "${who}" in your records. Jack will check and take them off by hand.`, handled: "skip_unknown", needsPerson: true };
    if (hits.length > 1) {
      const shown = hits.slice(0, 4).map((h) => `${h.c.name}${h.c.address?.street ? ` (${h.c.address.street})` : ""}${multi ? `, ${h.b.profile.name}` : ""}`);
      return { businessId: hits[0]!.b.id, reply: `That fits ${hits.length}: ${shown.join("; ")}${hits.length > 4 ? "; …" : ""}. Text SKIP with the full name, or the name and street.`, handled: "skip_which" };
    }
    const { b, c } = hits[0]!;
    let r = { cancelled: 0, withdrawn: [] as string[] };
    await d.accounts.withAccount(b.id, (state) => {
      r = skipPerson(state, c.id, nowLocal(d, state), `The owner texted "${text.trim().slice(0, 80)}"`);
    });
    await withdrawMoved(d, b.id, r.withdrawn);
    d.accounts.repo.audit(b.id, "owner-sms", "skip", { customerId: c.id });
    return { businessId: b.id, reply: `${tag(b)}Done — ${c.name} is off the list. We won't write to them again.`, handled: "skip" };
  }

  /* ---- a lead ---- */
  // While one business waits for the OK and nothing else is open, anything else is a change to the first note.
  if (waitingOk.length === 1 && !hasCode && !otherOpen())
    return { businessId: waitingOk[0]!.id, reply: `${tag(waitingOk[0]!)}Got it — we'll make that change and text you the note again. Nothing goes out until you say OK.`, handled: "first_note_change", needsPerson: true };

  const lead = readLeadText(text);
  // a #code names the lead on its own; a business name mentioned in passing never overrides it
  if (lead) return leadCommand(d, text, lead, hasCode ? all : named ? [named] : all, multi, tags);

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

  // While the first note waits for their OK, anything else is a change they want made to it.
  if (waitingOk.length === 1)
    return { businessId: waitingOk[0]!.id, reply: `${tag(waitingOk[0]!)}Got it — we'll make that change and text you the note again. Nothing goes out until you say OK.`, handled: "first_note_change", needsPerson: true };
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
      note = fsmNote(state, r.customerId, r.opportunityId, `Quiet Accounts: owner marked ${name} ${outcome === "booked" ? `booked${amount > 0 ? ` ($${amount.toLocaleString("en-US")})` : ""}` : "quoted"} after they answered ${r.opportunityId?.startsWith("req:") ? "our reply to their request" : "our follow-up"}.`);
    reply =
      outcome === "booked"
        ? amount > 0
          ? r.opportunityId?.startsWith("req:")
            ? `Booked: ${name}, $${amount.toLocaleString("en-US")}. Nice. They came in as a new request, so that one's all yours: we don't count it on our ledger.`
            : `Booked: ${name}, $${amount.toLocaleString("en-US")}. Added to your results.`
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
/** A lead we texted the owner that nobody has called yet. */
function hasWaitingLead(d: Deps, bid: string): boolean {
  return !!d.accounts.peek(bid)?.state.replies.some((r) => r.status === "handed_off" && !r.ownerContactedAt);
}

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

/** "4:05pm" from a local ISO time. */
function fmtClock(iso: string): string {
  const [h, m] = iso.slice(11, 16).split(":").map(Number) as [number, number];
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}
