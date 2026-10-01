import { addDays, cancelPlan, counted, daysBetween, leadCode, markContacted, NUDGE_MAX_AGE_HOURS, ownerApproves, paidYearOn, peopleNamed, renewPlan, round2, setBookedOut, skipPerson, totals, underWay, undoCancel, type AccountState, type BusinessProfile, type Reply } from "@qa/engine";
import { localIso } from "./clock.ts";
import { readLeadTextWithClaude } from "../agents/ownerText.ts";
import { deliverOwnerMessages, finishCancelWithdrawals, fsmNote, holdSending, raiseAlert, parseBusyUntil, queueFsmNote, setBusinessPaused, setOwnerTexts, withdrawMoved, type Deps, type FsmNote } from "./ops.ts";

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
const APPROVE_WORD = "(ok|okay|k|kk|yes|yep|yeah|yup|ya|sure|go|go ahead|go for it|send|send it|send them|start|start it|looks good|look good|sounds good|good to go|approve|approved|do it|lets go|let s go|perfect|great|fine|all good|thats fine|that s fine|love it|good)";
const APPROVE_TAIL = "(thanks|thank you|thx|ty|jack|man|please|pls|first note|the first note|go ahead|go for it|send it|send them|and send it|and send them|looks good|sounds good|perfect|great|good|all good|lets go|let s go)";
/** Commands that still work, as themselves, while the first note waits for the OK (anything else is about the note). */
const WHILE_WAITING = /^(pause|resume|status|cancel|undo|open|help|renew|monthly|yearly|(busy|booked out|booked solid|slammed|full)( (until|till|thru|through|for) [a-z0-9 ]{1,20}| \d{1,2} (days?|weeks?|months?))?|(skip|remove|take off|leave off|leave out|do not (email|write|contact)|don t (email|write|contact)) .+)$/;
const APPROVE = new RegExp(`^${APPROVE_WORD}( ${APPROVE_TAIL})*$`);
/** CANCEL on its own (or "cancel the service"); "cancel the note to Karen" is not cancelling the service. */
const CANCEL_ALL = /^cancel( (the|my|our|service|plan|subscription|everything|it|all|quiet|accounts|account|yes|confirm|please|now))*$/;
/** A yes said first: "Go ahead" and "Go for it" too (a bare "go" only on its own; "Go with Hey instead" is not a yes). */
const AFFIRM = /^(yes|yeah|yep|yup|ya|sure|ok|okay|sounds good|go ahead|go for it|go(?=\W*$)|let'?s (do it|go|keep going|keep it going)|keep (it )?going|i'?m in|deal|absolutely|definitely|do it)\b/;
/** The whole text is a yes (matched against the words only): "Keep it going", "I'm in, thanks". Not "Ok but…". */
const WHOLE_YES = /^(yes|yeah|yep|yup|ya|sure|ok|okay|sounds good|go|go ahead|go for it|let s (do it|go|keep going|keep it going)|lets (do it|go|keep going|keep it going)|keep (it )?going|i m in|im in|deal|absolutely|definitely|do it)( (thanks|thank you|thx|ty|jack|man|please|pls|cool|great|perfect|awesome|sounds good|got it))*$/;
/**
 * STATUS, said as the command (matched against the words only): "Status", "Numbers", "How's it going?", "How are we
 * doing". Any other "how…" ("How do I cancel?", "How do I take someone off the list?") is a question for a person.
 */
const STATUS = /^((status|stats|numbers)( update| report| please)?|how (s|is|are) (it|we|things|everything|the numbers)( (going|doing|looking))?( so far)?|how we doing)$/;
/**
 * Booked-out mode, said as the command (matched against the words only): "BUSY", "busy until Nov 15", "busy till
 * 11/15", "busy 6 weeks", "We're booked solid thru Aug 3", "slammed for 3 weeks". Only a day we can count to: "Busy
 * today, will call her tomorrow" or "booked solid till spring" is not a command (the lead, or a person, reads it).
 */
const BUSY = /^(we re |we are |were |i m |im |i am )?(busy|booked (out|solid|up|full)|slammed|full)( (until|till|til|thru|through) ((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*( \d{1,2}(st|nd|rd|th)?)?|\d{1,2} \d{1,2})( 20\d\d)?| (for )?(the next )?\d{1,2} (days?|weeks?|wks?|months?|mos?))?$/;
/**
 * RENEW / MONTHLY / YEARLY, said as the command (matched against the words only): "Renew", "Monthly please", "Yearly
 * plan", "Renew for another year". "Monthly cleaning booked 180" or "Annual service booked 250" is about a lead (the
 * lead, or a person, reads it), never a plan change.
 */
const PLAN = /^(renew|yearly|annual|monthly|month to month)( (plan|it|please|pls|thanks|thank you|thx|ty|jack|for (another|a|one more) year))*$/;
/**
 * RESUME said as a go-ahead (matched against the words only): "Go", "Go ahead", "Go for it, thanks", "Go ahead and
 * resume", "Go ahead and start it back up". With the close or the renewal out it's a yes to that instead. "Go with Hey
 * instead" is not one.
 */
const GO_RESUME = /^go( ahead| for it)?( (and )?(resume|restart|unpause|start( it| them| sending)?( back)?( up| again)?|turn (it|them) back on|send (it|them)|keep (it )?going|thanks|thank you|thx|ty|jack|man|please|pls))*$/;
/**
 * A no and nothing else (matched against the words only): "No", "Nope", "No thanks", "Not interested", "Pass for now".
 * With the close or the renewal out, that's the answer to it, not a lead.
 */
const BARE_NO = /^(no|nope|not interested|(we ll |i ll )?pass)( (thanks|thank you|thx|ty|jack|man|sorry|for now|not now|not right now|not this time|im good|i m good|we re good|were good))*$/;
/** The whole text is a lead outcome with nothing after it: "No", "Nope", "Done", "Not a fit", "Called him". */
const BARE_OUTCOME = /^(no|nope|lost|pass|passed|dead|not a fit|no go|not interested|no thanks|went with someone else|done|called|reached|talked|spoke)( (him|her|them|it|already|today))?$/;
/**
 * A lead outcome said first, the way a lead text gets answered (matched against the words only): "Booked 2400",
 * "$2,400 booked", "Quoted her", "No answer", "Left a VM", "She won't pick up". While a first note waits, a short
 * outcome counts only in this shape; "Say booked solid", "Don't say quoted" and "Mention we won an award" don't.
 */
const OUTCOME_FIRST = /^((he|she|they|just|already|finally) )?(booked|book it|sold|won|got the job|closed|quoted|re ?quoted|sent|gave|emailed|texted|no answer|no response|no pick ?up|didn ?t (answer|pick up)|did not (answer|pick up)|won ?t (answer|pick up)|left|voice ?mail|vm|called|\d+)\b/;
/** Words that change a note: "Say estimate, not quoted", "Change sold to finished", "Booked is fine, use scheduled instead". */
const NOTE_EDIT = /\b(say|add|remove|change|use|put|write|mention|instead|replace|swap|take out|leave out|drop|delete|reword|call it)\b/;

const HELP_TEXT =
  'About a lead: BOOKED 2400 #code, DONE, NO or QUOTED (the #code is on the lead text). About a person: SKIP and their name takes them off the list. About the service: PAUSE, RESUME, BUSY until Nov 15, OPEN, STATUS, CANCEL. STOP turns off our texts (your follow-ups keep running); START turns them back on.';

/** Words that are commands, never a business's short name. */
const COMMAND_WORDS = new Set(["skip", "remove", "undo", "pause", "resume", "open", "busy", "booked", "book", "done", "no", "status", "cancel", "yes", "stop", "start", "renew", "monthly", "yearly", "quoted", "sold", "won", "lost", "full", "free", "hold", "go", "help"]);
const NAME_NOISE = new Set(["the", "and", "co", "company", "inc", "llc", "ltd", "services", "service", "of"]);

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const digitsOf = (phone: string | undefined) => (phone ?? "").replace(/\D/g, "").slice(-10);

/** Letters only: "360 Tree Care" is "TC"; a clash gets the next letters of the last word ("TCA"). */
function initials(name: string, taken: string[]): string {
  const ws = words(name).filter((x) => /^[a-z]/.test(x) && !/\d/.test(x));
  let tag = ws.map((x) => x[0]).join("") || "biz";
  const last = ws.at(-1) ?? "biz";
  for (let i = 1; taken.includes(tag.toUpperCase()) && i < last.length; i++) tag += last[i];
  return tag;
}

/** For each client on the phone: the first word of its name no other client on that phone shares ("AAA", "LANDSCAPING"). */
export function shortNames(bizs: { id: string; profile: { name: string } }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of bizs) {
    const others = new Set(bizs.filter((o) => o.id !== b.id).flatMap((o) => words(o.profile.name)));
    // never a word with a digit in it: "360" in "360 Tree Care" would be read as $360 as well as the business
    const w = words(b.profile.name).find((x) => x.length >= 2 && !/\d/.test(x) && !NAME_NOISE.has(x) && !COMMAND_WORDS.has(x) && !others.has(x));
    // no word of its own: its initials, never a piece of its id (that can be all digits, and read as dollars)
    out.set(b.id, (w ?? initials(b.profile.name, [...out.values()])).toUpperCase());
  }
  return out;
}

/* ------------------------------ reading a text about a lead ------------------------------ */

const CODE = /#\s?([a-z0-9]{3})\b/i;
/** A phone's curly apostrophe (the iPhone default) reads as a straight one: "Didn’t book it" is "Didn't book it". */
const APOSTROPHE = /[‘’ʼ`´]/g;
const NO_ANSWER = /\b(no answer|didn'?t answer|did not answer|no response|voice ?mail|vm|left (a )?(message|msg|vm|voice ?mail)|not picking up|didn'?t pick up|won'?t (pick up|answer)|no pick ?up)\b/;
/**
 * No booking: "didn't book", "never bought", "won't book it", "not gonna sign", "hasn't booked yet". "She won't go
 * above 1200" is haggling, not a no.
 */
const NOT_BOOKED = /\b(not|didn'?t|did not|never|no)\s+(even |end up |ended up |actually |really )?(book|booked|booking|sold|won|buy|bought|go)\b|\b(won'?t|will not|wouldn'?t|would not|not gonna|not going to|isn'?t gonna|isn'?t going to|doesn'?t want to|does not want to|don'?t want to)\s+(book|buy|sign|hire|do it|go ahead|go with (us|me|it|our))\b|\b(hasn'?t|has not|haven'?t|have not|hadn'?t|had not|isn'?t|is not|aren'?t|are not)\s+(\w+ )?(booked|bought|sold|signed|decided|committed)\b/;
const NOT_BOOKED_ALL = new RegExp(NOT_BOOKED.source, "g");
/** ...but not over: "hasn't booked yet", "not sold yet", "won't book unless we come down to 1800". Never a loss either. */
const NOT_YET = /\b(yet|unless|until|till|til)\b|\b(hasn'?t|has not|haven'?t|have not)\b/;
/**
 * Someone else got the job, or there's no job to get: "booked someone else", "They found someone cheaper", "went with
 * another roofer", "Someone else already did it", "sold the house". Shopping around is not that: "she's getting
 * another quote", "she has another guy coming out Thursday" are still our lead. (Global: it's cut out of the text
 * before BOOKED looks.)
 */
const ELSEWHERE_VERB = "(booked|book|hired|hire|hiring|chose|choose|picked|pick|used|use|using|signed|found|contracted|gave it|gave the job)";
const ELSEWHERE_WHO = "((someone|somebody) (else|cheaper)|(another|a different|the other|a cheaper|some other|a local) (company|guy|contractor|crew|outfit|service|tree service|landscaper|painter|roofer|fence company|cleaner|\\w+ (company|service|guy|contractor))|a competitor|the competition)";
/**
 * Shopping around, not hired: "she has another guy coming out Thursday", "has another company giving her a price".
 * Only after a "has/got another guy": once someone else "got the job", the price that follows is why we lost it.
 */
const SHOPPING = "(?!['’]s (quote|price|bid|estimate)|.{0,40}\\b(coming|come out|looking|look at|to bid|to quote|bidding|quoting|getting|giving|quot|bid|pric|estimat))";
/** Right after "someone else already…": giving a price is shopping ("already quoted her 1800", "did an estimate too"). */
const GAVE_A_PRICE = "(?! (quoted|bid|priced|(gave|got) (her|him|them) (a |an |their )?(price|quote|estimate|bid|number)|(a|an|their) (quote|estimate|bid|price)|(her|him|them) (a|an) (quote|estimate|bid|price)))";
/** "she's got another guy", "had someone else": hired, unless what follows says they're only shopping. */
const ELSEWHERE_HAS = `\\b(has|got|had)( with| to)? ${ELSEWHERE_WHO}\\b${SHOPPING}`;
/** The same, before the shopping check: a booking next to it ("has another guy, he won the bid") goes to a person. */
const ELSEWHERE_HAS_ANY = new RegExp(`\\b(has|got|had)( with| to)? ${ELSEWHERE_WHO}\\b`);
/** "went with another roofer", "going w/ someone else". */
const WENT_WITH_WHO = `\\b(went|going|gone|go) (with\\b|w/|w\\b) ?(${ELSEWHERE_WHO}|someone|somebody)\\b`;
/** Someone else as the subject: "Someone else already did it", "The other guy got the job", "Another company won the bid". */
const ELSEWHERE_SUBJ = "((someone|somebody) else|(another|the other|a different) (company|guy|contractor|crew|outfit|\\w+ (company|service|guy|contractor)))";
const ELSEWHERE_DID = `\\b${ELSEWHERE_SUBJ} (did|does|already|got|won|booked|hired|sold|is doing|will do)\\b${GAVE_A_PRICE}|\\b${ELSEWHERE_SUBJ} (has|had)\\b${SHOPPING}`;
const ELSEWHERE = new RegExp(`\\b${ELSEWHERE_VERB}( with| to| w/)? ${ELSEWHERE_WHO}\\b|${ELSEWHERE_HAS}|${WENT_WITH_WHO}|${ELSEWHERE_DID}|\\b(sold|selling) (the|his|her|their) (house|home|place|property)\\b|\\bwent elsewhere\\b|\\blost (it|the job|that one|out)\\b`, "g");
/**
 * "went with …" naming neither someone else nor us: "She went with the 2 tree option", "went with Plan B". Maybe ours,
 * maybe not: a person reads it. A capitalized name ("She went with Davey") is someone else.
 */
const WENT_WITH_OTHER = /\b(went|going|gone|go) (with\b|w\/|w\b) ?(?!(it|us|me|my|mine|our|ours|you|this|that|these|those|the (\S+ ){0,3}(option|package|quote|price|plan|one)|option|plan|package|\$|\d)\b)\S/;
const WENT_WITH_NAME = /\b(?:went|going|gone|go) (?:with|w\/) ?([A-Z][a-zA-Z'’]+)/;
const NOT_A_NAME = new Set(["I", "My", "Me", "Our", "Ours", "Us", "The", "That", "This", "Option", "Plan", "Package", "It", "Your", "You"]);
/**
 * Another company or person in the story: "someone else", "other guy", "another plumber", "the competition", "her
 * regular guy", or a name after a hiring word ("She booked Bartlett"). Broad on purpose: sending a text to Claude
 * costs nothing, reading someone else's win as ours puts their price on the owner's ledger.
 */
const THIRD_PARTY = /\b((someone|somebody) (else|cheaper)|(the |some |a )?(other|another|different) \w+|competitors?|competition|(her|his|their) (regular|usual|own) \w+)\b/i;
const HIRED_A_NAME = /\b(booked|hired|chose|picked|used|went with|going with|go with|gave it to|gave the job to)\s+(?!I\b)[A-Z][a-z]+/;
export function mentionsCompetitor(text: string): boolean {
  const t = text.replace(APOSTROPHE, "'").replace(/#\s?[a-z0-9]{3}\b/gi, " ");
  return THIRD_PARTY.test(t) || HIRED_A_NAME.test(t);
}
/** The words of a text, lowercased, without the #code, the business's short name or punctuation ("$2,400" stays whole). */
function plainWords(text: string, shortName?: string): string {
  // "@" is "at": "Booked @ 1030" is a time, never $1,030
  const t = text.replace(APOSTROPHE, "'").replace(/#\s?[a-z0-9]{3}\b/gi, " ").replace(/@/g, " at ").toLowerCase().replace(/(\d),(\d{3})/g, "$1$2").replace(/[^a-z0-9$.'\s]/g, " ").replace(/\.(?!\d)/g, " ");
  return t.split(/\s+/).filter((w) => w && (!shortName || w !== shortName.toLowerCase())).join(" ");
}
const AMT = "\\$?\\d+(\\.\\d+)?k?";
/**
 * A booking that is plainly the owner's, in the words of the command we give them ("BOOKED 2400 #K7Q"): the word and
 * the amount ("Booked 2400", "Sold it 2.4k", "Won it, 3200"), the amount alone, or the homeowner booking us ("She
 * booked us for 2400"). Nothing in between: every free-form object tried so far ("the cheaper guy", "her tmrw 1030",
 * "the low bidder") let someone else's win or an appointment time through. Anything else read as a booking goes to
 * Claude, or to a person.
 */
const PLAIN_BOOKING = new RegExp(
  `^(just )?(booked|sold|won|closed)( it)?( for)?( ${AMT})?$` + `|^${AMT}( (booked|sold))?$` + `|^(she|he|they) (just )?(booked|hired|picked|chose) us( for)?( ${AMT})?$`,
);
/** A day, a time or a date anywhere in it: a number next to one may be "at 1030" or "March 2027", not a price. */
const TIMEY = /\b(at|today|tonight|tomorrow|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|am|pm|morning|afternoon|evening|noon)\b/;
/**
 * At most one number, a real job's worth, and no day or time beside it: "Booked for 11" and "Booked her for Thursday
 * at 1030" are appointments, not an $11 or $1,030 job.
 */
function plainAmount(words: string): boolean {
  const nums = words.match(/\$?\d+(\.\d+)?k?/g) ?? [];
  if (nums.length > 1) return false;
  if (!nums.length) return true;
  if (TIMEY.test(words)) return false;
  // "Booked for 930", "booked it for 2027": after "for", a bare number that could be a clock time or a year is an
  // appointment as often as a price ("for 1800", "$930" and "BOOKED 930" stay plain)
  const bare = nums[0]!;
  if (/\bfor\b/.test(words) && /^\d{3,4}$/.test(bare)) {
    const v = Number(bare);
    const clock = Number(bare.slice(-2)) < 60 && Number(bare.slice(0, -2)) >= 1 && Number(bare.slice(0, -2)) <= 12;
    if (clock || (v >= 1900 && v <= 2099)) return false;
  }
  const n = nums[0]!.replace("$", "");
  return Number(n.replace(/k$/, "")) * (n.endsWith("k") ? 1000 : 1) >= 50;
}
/** "She went with my quote", "went with us": our booking. */
const WENT_WITH_US = /\bwent with (me|us|mine|ours|(my|our) (quote|price|bid|estimate))\b/;
const BOOKED = /\b(booked(?! (solid|out|up|full)\b)|book it|sold(?! out\b)|won(?!')|got the job|closed (it|the deal))\b/;
const QUOTED = /\b(quoted|re-?quoted|(sent|gave|emailed|texted) (him |her |them )?(a |an |the )?(new |updated )?(price|quote|estimate|number))\b/;
const LOST = /^no\b(?!\s+(problem|prob|worries|sweat))|\b(lost|pass(ed)?|dead|not a fit|nope|no go|not interested|no thanks|too expensive|chose someone)\b/;
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
 * booking (it answers the close, or nothing), and "called, no answer" is a no answer, not a win. Nothing negated is
 * a booking ("Won't book it", "hasn't booked yet"), and nor is someone else's ("They booked someone else"). A text
 * that says both ways ("Booked 2400, beat the other guy's price") is `unclear`: a person reads it.
 */
export function readLeadText(text: string): { outcome?: Reply["outcome"]; amount: number; unclear?: true } | undefined {
  const body = text.replace(/#\s?[a-z0-9]{3}\b/gi, " ");
  const t = body.toLowerCase().replace(APOSTROPHE, "'").replace(/\s+/g, " ").trim();
  const amount = readAmount(body);
  if (NO_ANSWER.test(t)) return { outcome: "no_answer", amount: 0 };
  // what's left once someone else's booking and every negated phrase are cut out: a booking there is ours
  const ours = t.replace(ELSEWHERE, " ");
  const elsewhere = ours !== t;
  const positive = ours.replace(NOT_BOOKED_ALL, " ");
  const negated = positive !== ours;
  const name = body.match(WENT_WITH_NAME)?.[1];
  const named = !!name && !NOT_A_NAME.has(name);
  const other = !named && WENT_WITH_OTHER.test(positive) && !WENT_WITH_US.test(positive);
  const booked = BOOKED.test(positive) || WENT_WITH_US.test(positive) || (amount > 0 && /^\$?\s?[\d,]+(\.\d{1,2})?\s?k?[.!]*$/.test(t));
  const shopping = ELSEWHERE_HAS_ANY.test(positive);
  // "Booked 2400, she won't sign up for the maintenance plan": a booking and a no in one text is a person's call
  if (booked && (elsewhere || negated || named || other || shopping)) return { amount: 0, unclear: true };
  if (booked) return { outcome: "booked", amount };
  // not booked yet is still open: they were reached, with a price if the owner gave one
  if (negated) return NOT_YET.test(t) ? { outcome: QUOTED.test(t) ? "quoted" : undefined, amount: 0 } : { outcome: "lost", amount: 0 };
  if (elsewhere || named) return { outcome: "lost", amount: 0 };
  // "went with the 2 tree option": ours or not, a person reads it
  if (other) return { amount: 0, unclear: true };
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
  const t = text.trim().toLowerCase().replace(APOSTROPHE, "'");
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
  // (a lead handed off more than a week ago is the operator's to chase, not something a text is likely answering)
  const otherOpen = (skip?: Biz) => all.some((x) => x !== skip && (hasWaitingLead(d, x.id, true) || outstanding(d, x.id, "close") || outstanding(d, x.id, "renewal"))) || (!!skip && hasWaitingLead(d, skip.id, true));
  // While a first note waits, a text is about something else only when it reads like an answer to it: a short lead
  // outcome said first ("booked 2400", "no answer") with a lead waiting, a bare "no" or "done" with one handed over
  // this week, or a yes and nothing more with the close or renewal out. "No, say Hey", "Ok but change the sign-off",
  // "Say estimate, not quoted" and "Add that we won Best of Concord 2025" are changes to the note.
  // "No, say Hey instead of Hi" is a change to the note, whatever else is open on the phone.
  const aboutOther = () => {
    const scope = named ? [named] : all;
    const lead = readLeadText(text);
    // words as the owner typed them, less the #code and the business's name ("Booked $2,400 for the oak" is five)
    const typed = text.replace(CODE, " ").trim().split(/\s+/).filter((w) => !named || w.toLowerCase().replace(/[^a-z0-9]/g, "") !== tags.get(named.id)!.toLowerCase()).length;
    const clear = !!lead && (lead.outcome === "booked" || lead.outcome === "no_answer" || lead.outcome === "quoted") && typed <= 5 && OUTCOME_FIRST.test(bare) && !NOTE_EDIT.test(bare);
    return (clear && scope.some((x) => hasWaitingLead(d, x.id))) || (BARE_OUTCOME.test(bare) && scope.some((x) => hasWaitingLead(d, x.id, true))) || (WHOLE_YES.test(bare) && scope.some((x) => outstanding(d, x.id, "close") || outstanding(d, x.id, "renewal")));
  };
  // A change to a first note waiting for the OK. With two waiting and neither named, which note it's for is the
  // owner's to say, and a person sees it too: never read as a lead, never dropped.
  const noteChange = (): OwnerCommandResult =>
    waitingOk.length > 1
      ? {
          businessId: waitingOk[0]!.id,
          reply: `${joinOr(waitingOk.map((b) => b.profile.name), "and")} are ${waitingOk.length === 2 ? "both" : "all"} waiting for your OK on the first note. Which one is that about? Text it again with the name, like ${joinOr(waitingOk.map((b) => `"${example} ${tags.get(b.id)}"`), "or")}. Nothing goes out until you say OK.`,
          handled: "first_note_change",
          needsPerson: true,
        }
      : { businessId: waitingOk[0]!.id, reply: `${tag(waitingOk[0]!)}Got it — we'll make that change and text you the note again. Nothing goes out until you say OK.`, handled: "first_note_change", needsPerson: true };
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

  // While a first note waits for the OK (one business's or two's), only exact commands act; anything else ("Hold on,
  // change the greeting", "How many people is this going to?") is about the first note.
  if (waitingOk.length && !hasCode && !WHILE_WAITING.test(bare) && !aboutOther()) return noteChange();

  /* ---- the service (one client at a time) ---- */
  // A #code names a lead, so a text with one is about that lead whatever word it starts with ("Monthly cleaning booked
  // 180 #K7Q", "Hold off on #K7Q, she's away till November", "Free estimate sent #K7Q"): never a plan change, a pause
  // or booked-out mode. It goes on to the lead below, or to a person; CANCEL and UNDO with a code get their own answer.
  const command = hasCode ? "" : bare;
  if (/^(pause|stop sending|hold)\b/.test(command)) {
    if (!one) return askWhich();
    await pause(d, one.id, true);
    return { businessId: one.id, reply: `${tag(one)}Paused. No notes will go out until you text RESUME.`, handled: "pause" };
  }
  // "Go ahead" / "Go for it" with the close or the renewal out is a yes to it (below), never RESUME
  const goYes = /^go\b/.test(command) && (one ? [one] : all).some((b) => outstanding(d, b.id, "close") || outstanding(d, b.id, "renewal"));
  if ((/^(resume|unpause)\b/.test(command) || GO_RESUME.test(command)) && !goYes) {
    if (!one) return askWhich();
    if (one.profile.plan.stage === "cancelled") return { businessId: one.id, reply: `${tag(one)}You're cancelled, so nothing's running. Want back in? Reply here and Jack will set it up.`, handled: "resume_cancelled", needsPerson: true };
    // The plan itself is paused (a year ran out with no renewal, or Jack paused it): RESUME can't start it again, so
    // it never says "Back on" while nothing goes out. The pause stays, and a person reads it.
    if (one.profile.plan.stage === "paused") {
      const p = one.profile.plan;
      const lapsed = p.billing === "annual" && !paidYearOn(one.profile, nowLocal(d, d.accounts.peek(one.id)!.state).slice(0, 10));
      return {
        businessId: one.id,
        reply: `${tag(one)}${lapsed ? `Your year ended, so everything's still paused. Text MONTHLY to pick back up at $${Math.round(p.monthlyPrice).toLocaleString("en-US")} a month, or RENEW for another year.` : "Your plan is paused on our side, so nothing's going out yet."} Jack will read this too.`,
        handled: "resume_plan_paused",
        needsPerson: true,
      };
    }
    await pause(d, one.id, false);
    return { businessId: one.id, reply: `${tag(one)}Back on. Notes resume on your next send day.`, handled: "resume" };
  }
  if (STATUS.test(command)) {
    const lines = (one ? [one] : all).map((b) => {
      const s = d.accounts.peek(b.id)!.state;
      const wants = s.replies.filter((r) => r.intent === "wants_it" || r.intent === "wants_price").length;
      const booked = counted(s.recoveries).reduce((a, r) => a + r.value, 0);
      return `${tag(b)}So far: ${s.touches.filter((x) => x.status === "sent").length} notes out, ${wants} asked for a price or a date, $${Math.round(booked).toLocaleString("en-US")} booked.`;
    });
    return { businessId: fallback().id, reply: lines.join("\n"), handled: "status" };
  }
  // A plan word with a reason after it ("Monthly - the year is too expensive", "Renew, already talked to Jack") is the
  // plan choice and could be a lead's outcome too: a person reads it, and no lead is touched. Only a booking ("Monthly
  // cleaning booked 180") goes on to the lead, where Claude or a person reads it.
  if (/^(renew|yearly|annual|monthly|month to month)\b/.test(command) && !PLAN.test(command) && readLeadText(text)?.outcome !== "booked") {
    const b = fallback();
    return { businessId: b.id, reply: `${tag(b)}Jack will read this and get back to you. To change your plan, text just RENEW or MONTHLY. About a lead? Text it with the #code.`, handled: "plan_unclear", needsPerson: true };
  }
  // Yearly plans: RENEW keeps the year, MONTHLY goes month to month. YEARLY switches a monthly plan over.
  if (PLAN.test(command)) {
    if (!one) return askWhich();
    if (one.profile.plan.stage === "cancelled") {
      const c = d.accounts.peek(one.id)!.state.cancelled;
      return { businessId: one.id, reply: `${tag(one)}You're cancelled, so nothing's running.${c ? " Didn't mean to cancel? Text UNDO." : " Want back in? Reply here and Jack will set it up."}`, handled: "renew_cancelled", needsPerson: !c };
    }
    const choice = /^(monthly|month to month)/.test(bare) ? "monthly" : "year";
    // A trial owner picking a plan is a yes to the close: Jack sends the payment link and marks them paying. Nothing
    // turns paying on a text alone.
    if (one.profile.plan.stage === "trial") {
      await d.accounts.withAccount(one.id, (state) => {
        const at = nowLocal(d, state);
        state.events.push({ id: `ev_owner_plan_${at}`, at, agent: "reporter", kind: "review", title: `${state.dataset.business.ownerFirstName} picked ${choice === "year" ? "the year" : "month to month"}`, detail: `“${text.trim().slice(0, 160)}” — send the payment link, then mark them paying.` });
      });
      return { businessId: one.id, reply: `${tag(one)}Great — ${choice === "year" ? "the year" : "month to month"} it is. Jack will text you the payment link.`, handled: "accepted_close", needsPerson: true };
    }
    // Jack collects every payment, so a change (or a year waiting on its link) goes to his queue; a repeat changes nothing.
    const stageBefore = one.profile.plan.stage;
    let r: ReturnType<typeof renewPlan> | undefined;
    await d.accounts.withAccount(one.id, (state) => {
      r = renewPlan(state, choice, nowLocal(d, state));
    });
    // a year that ran out is back on with MONTHLY; an owner's own PAUSE (or Jack's Paused stage) stays
    if (stageBefore === "paused" && d.accounts.peek(one.id)!.state.dataset.business.plan.stage === "paying") await pause(d, one.id, false);
    return { businessId: one.id, reply: `${tag(one)}${r!.reply}`, handled: r!.handled, ...(r!.forOperator ? { needsPerson: true } : {}) };
  }
  // Month to month, cancel by text: one text does it (a yearly plan gets back what it didn't use). UNDO within a day puts it all back.
  if (/^(cancel|undo)\b/.test(bare) && hasCode)
    return { businessId: fallback().id, reply: `${one ? tag(one) : ""}About that lead: text NO and the #code if it's off, or BOOKED + amount + the #code. To cancel the whole service, text CANCEL on its own. Jack will read this too.`, handled: "cancel_code", needsPerson: true };
  if (/^cancel\b/.test(bare) && !CANCEL_ALL.test(bare))
    return { businessId: fallback().id, reply: `${one ? tag(one) : ""}Did you mean to cancel the whole service? Text CANCEL on its own for that. To take one person off, text SKIP and their name. Jack will read this too.`, handled: "cancel_unclear", needsPerson: true };
  if (CANCEL_ALL.test(bare)) {
    if (!one) return askWhich();
    const s = d.accounts.peek(one.id)!.state;
    if (s.dataset.business.plan.stage === "cancelled") return { businessId: one.id, reply: `${tag(one)}You're already cancelled.${s.cancelled ? " Didn't mean it? Text UNDO." : " Want back in? Reply here and Jack will set it up."}`, handled: "cancel_again" };
    let r = { stopped: 0, refund: 0, line: "" };
    let until = "";
    let partWay = 0;
    let renewed = false;
    await d.accounts.withAccount(one.id, (state) => {
      const at = nowLocal(d, state);
      r = cancelPlan(state, at, { paused: one.paused });
      // a renewed year that hadn't started may or may not have been paid: Jack checks, and refunds it if it was
      renewed = !!state.cancelled?.years?.length;
      until = `${fmtClock(at)} tomorrow`;
      // a sending platform can't take someone back mid-sequence: UNDO won't give them the rest of their notes
      if (d.email.kind === "sequencer") partWay = new Set(underWay(state, (state.cancelled?.touches ?? []).map((x) => x.id)).map((x) => x.customerId)).size;
    });
    // cancel everywhere: the platform's campaigns pause and leads still waiting are taken back
    await holdSending(d, one.id, "cancel").catch((e) => d.log(`[owner] ${one.id} cancel on the sending platform failed: ${(e as Error).message}`));
    d.accounts.repo.audit(one.id, "owner-sms", "cancel", { stopped: r.stopped, refund: r.refund });
    // a yearly refund text goes straight to the operator's queue: they issue it, then send it
    if (r.refund) await deliverOwnerMessages(d, one.id);
    const tt = totals(d.accounts.peek(one.id)!.state);
    return {
      businessId: one.id,
      reply: `${tag(one)}Done — cancelled. No more notes, no more charges.${r.line ? ` ${r.line}` : ""} So far: ${tt.booked} booked, $${Math.round(tt.bookedValue).toLocaleString("en-US")} on your ledger, and everything we found stays yours. Didn't mean it? Text UNDO${multi ? ` ${tags.get(one.id)}` : ""} by ${until} ${partWay ? `to pick back up; the ${partWay === 1 ? "1 person" : `${partWay} people`} already part-way through their notes won't get the rest.` : "and it all picks back up."}`,
      handled: "cancel",
      ...(renewed ? { needsPerson: true } : {}),
    };
  }
  if (/^undo\b/.test(bare)) {
    const pool = (one ? [one] : all).filter((b) => d.accounts.peek(b.id)?.state.cancelled);
    if (pool.length > 1) return askWhich();
    const b = pool[0];
    if (!b) return { businessId: fallback().id, reply: "There's nothing to undo. Text HELP for what you can text us.", handled: "undo_nothing" };
    // the cancel's platform withdrawals run now, before anything is pushed again; if the platform refuses, a person does it
    const cleared = d.accounts.peek(b.id)?.state.cancelled?.refund ? true : await finishCancelWithdrawals(d, b.id);
    if (!cleared) {
      await raiseAlert(d, b.id, { kind: "undo_platform", title: `${b.profile.name} wants to undo their cancel`, detail: "The sending platform didn't take back the cancelled notes yet, so nothing was restored. Try the restore once it's reachable." });
      return { businessId: b.id, reply: `${tag(b)}Glad you're staying. Jack will put everything back himself today and text you.`, handled: "undo_platform", needsPerson: true };
    }
    let r: ReturnType<typeof undoCancel>;
    let renewed = false;
    await d.accounts.withAccount(b.id, (state) => {
      renewed = !!state.cancelled?.years?.length;
      r = undoCancel(state, nowLocal(d, state), { platform: d.email.kind === "sequencer" });
    });
    const res = r!;
    if (!res || "refused" in res) {
      // a yearly refund may already be on its way: a person puts it back, never the software
      if (res && res.refused === "refund")
        await raiseAlert(d, b.id, { kind: "undo_refund", title: `${b.profile.name} wants to undo their cancel`, detail: "A yearly refund was set up when they cancelled. If you haven't issued it, use Restore plan (it withdraws the refund). If you have, settle that with them first." });
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
    const lost = res.stopped ? ` ${res.stopped} ${res.stopped === 1 ? "person was" : "people were"} part-way through their notes; those follow-ups stay stopped.` : "";
    return { businessId: b.id, reply: `${tag(b)}Back on.${res.stopped ? "" : " Nothing was lost."} ${res.restored ? `${res.restored} ${res.restored === 1 ? "note is" : "notes are"} back in line.` : "We'll pick up on your next send day."}${lost}${res.paused ? " You'd paused before, so it stays paused until you text RESUME." : ""}`, handled: "undo_cancel", ...(renewed ? { needsPerson: true } : {}) };
  }
  // "BUSY until Nov 15" / "busy 6 weeks" / "OPEN": new work waits for room on the schedule.
  if (BUSY.test(command)) {
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
  if (/^(open|not busy|free|room|slow)\b/.test(command)) {
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
    const said = text.replace(CODE, " ").trim().toLowerCase().replace(APOSTROPHE, "'").replace(/^(skip|remove|take off|leave off|leave out|do not (email|write|contact)|don'?t (email|write|contact))\s+/, "");
    const full = said.split(/[,.;!?()]| - | — | because | they | she | he | we /)[0]!.trim() || skip[4]!;
    // "SKIP John Smith" where SMITH is also a business's short name: the name as written is searched everywhere
    // first; only when it finds nobody is the short name taken as naming the business
    const short = named ? tags.get(named.id)!.toLowerCase() : "";
    const stripped = short ? full.split(/\s+/).filter((w) => w !== short).join(" ").trim() : full;
    let who = full;
    let hits = all.flatMap((b) => peopleNamed(d.accounts.peek(b.id)!.state, full).map((c) => ({ b, c })));
    if (!hits.length && named && stripped && stripped !== full) {
      who = stripped;
      hits = peopleNamed(d.accounts.peek(named.id)!.state, stripped).map((c) => ({ b: named, c }));
    }
    // nobody by that name while a first note waits: "Remove 'sold out'" is about the note
    if (!hits.length && waitingOk.length && !hasCode) return noteChange();
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
  // While a first note waits for the OK, anything that isn't an answer to something else is a change to it.
  if (waitingOk.length && !hasCode && !aboutOther()) return noteChange();

  let lead = readLeadText(text);
  // Another company in it ("the other guy had a lower bid and got the job", "she has another guy coming out"): whose
  // win it is, or whether she's only shopping, is Claude's read with a person behind it, never the patterns' alone.
  // And a booking puts money on the ledger: the patterns record one only when it's plainly the owner's ("booked
  // 2400", "she booked us for 2400"); "Davey got the job, 1800" is Claude's, or a person's, to read.
  const plainText = plainWords(text, named ? tags.get(named.id) : undefined);
  const plainBooking = lead?.outcome === "booked" && PLAIN_BOOKING.test(plainText) && plainAmount(plainText);
  if ((mentionsCompetitor(text) && (lead || hasCode)) || (lead?.outcome === "booked" && !plainBooking)) lead = await readLeadTextWithClaude(d.llm, text);
  // it says both ways ("Booked 2400, she won't sign up for the plan"): a person marks it, never a guess. The lead it's
  // about stops getting "still waiting" nudges meanwhile: the owner just told us something happened.
  if (lead?.unclear) {
    const code = text.match(CODE)?.[1]?.toUpperCase();
    const pool = hasCode ? all : named ? [named] : all;
    const hits = pool.flatMap((b) => (d.accounts.peek(b.id)?.state.replies ?? []).filter((r) => r.status === "handed_off" && !r.ownerContactedAt && (!code || leadCode(r.id) === code)).map((r) => ({ b, r })));
    // only when the #code names it: without one, the only lead still waiting may not be the one the text is about
    if (hits.length === 1 && code) {
      const { b, r } = hits[0]!;
      await d.accounts.withAccount(b.id, (state) => {
        const live = state.replies.find((x) => x.id === r.id);
        if (live) live.nudges = Math.max(live.nudges ?? 0, 2);
      });
    }
    return { businessId: hits[0]?.b.id ?? fallback().id, reply: `${one ? tag(one) : ""}Thanks — that one could go either way, so Jack will read it and mark the lead himself. Next time: BOOKED + amount + the #code, or NO + the #code.`, handled: "unclear_lead", needsPerson: true };
  }
  // A bare "No" / "Not interested" with the close or the renewal out answers that, not a lead: it never marks one lost.
  // A person reads it (it could still be about a lead, so the reply says how to name one).
  if (lead?.outcome === "lost" && !hasCode && BARE_NO.test(bare)) {
    const asked = (one ? [one] : all).find((b) => outstanding(d, b.id, "close") || outstanding(d, b.id, "renewal"));
    if (asked) return { businessId: asked.id, reply: `${tag(asked)}Got it — Jack will read this and get back to you. About a lead? Text NO and the #code.`, handled: outstanding(d, asked.id, "close") ? "close_no" : "renewal_no", needsPerson: true };
  }
  if (lead) {
    // a #code names the lead on its own; a business name mentioned in passing never overrides it
    const res = await leadCommand(d, text, lead, hasCode ? all : named ? [named] : all, multi, tags, named);
    // read as a lead, no code, while a first note waits: a person looks too, in case it was about the note
    return waitingOk.length && !hasCode ? { ...res, needsPerson: true } : res;
  }

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
    // a paused owner's "Go ahead" may mean RESUME as much as the renewal: a person reads it too
    const goPaused = !!b?.paused && /^go\b/.test(bare);
    if (b) return { businessId: b.id, reply: `${tag(b)}Great — which one: RENEW for another year, or MONTHLY to go month to month?${goPaused ? " Your notes are still paused: text RESUME to restart them." : ""}`, handled: "ask_renewal", ...(goPaused ? { needsPerson: true } : {}) };
    // nothing open to answer: a yes and nothing more is just a yes; more after it ("Ok resume", "Ok, also skip the
    // Hendersons") goes to a person below, never swallowed by "Got it"
    if (WHOLE_YES.test(bare)) return { businessId: fallback().id, reply: "Got it. About a lead? Text BOOKED + amount + the #code, DONE, or NO.", handled: "ack" };
  }

  // While the first note waits for their OK, anything else is a change they want made to it (one with a #code is
  // about that lead, and goes to a person below).
  if (waitingOk.length && !hasCode) return noteChange();
  return { businessId: fallback().id, reply: `Thanks — Jack will read this and get back to you. For a lead, text BOOKED + amount + the #code, DONE, or NO. Text HELP for everything else.`, handled: "unrecognized", needsPerson: true };
}

/** How long a lead the owner already told us about stays one a text without a #code could be about. */
const REPORTED_DAYS = 14;

async function leadCommand(d: Deps, text: string, lead: { outcome?: Reply["outcome"]; amount: number }, pool: Biz[], multi: boolean, tags: Map<string, string>, named?: Biz): Promise<OwnerCommandResult> {
  const code = text.match(CODE)?.[1]?.toUpperCase();
  const { outcome, amount } = lead;
  const waiting = (r: Reply) => r.status === "handed_off" && !r.ownerContactedAt;
  // Without a code, a lead the owner told us about lately can still be what the text is about: the amount after "What's
  // the job worth?", "She booked us for 2400" days after QUOTED, "No wait, it was 2400 not 240" after a booking. It
  // counts next to the leads still waiting, so one that happens to be waiting never gets it by default.
  const reported = (r: Reply, today: string) => {
    const last = [r.ownerContactedAt, r.bookedAt].filter((x): x is string => !!x).sort().at(-1);
    if (r.status !== "done" || !last || r.outcome === "lost" || daysBetween(last.slice(0, 10), today) > REPORTED_DAYS) return false;
    if (outcome === "booked") return r.outcome !== "booked" || (amount > 0 && !r.outcomeValue);
    if (outcome === "quoted") return !r.outcome || r.outcome === "no_answer";
    return outcome === "lost";
  };
  const hits: { biz: Biz; reply: Reply; waiting: boolean; name: string }[] = [];
  for (const b of pool) {
    const s = d.accounts.peek(b.id)?.state;
    if (!s) continue;
    const today = nowLocal(d, s).slice(0, 10);
    for (const r of s.replies)
      if (code ? leadCode(r.id) === code : waiting(r) || reported(r, today)) hits.push({ biz: b, reply: r, waiting: waiting(r), name: s.dataset.customers.find((c) => c.id === r.customerId)?.name ?? r.from });
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
  // a code that fits leads in two businesses: the business the owner names breaks the tie
  if (code && named && picks.length > 1 && picks.some((p) => p.biz.id === named.id)) picks = picks.filter((p) => p.biz.id === named.id);
  // "Booked 2400 MJK": the code typed without its "#" (in capitals, as it's on the lead text) picks one of them
  if (!code && picks.length > 1) {
    const typed = new Set(text.match(/\b(?=[A-Z0-9]*[A-Z])[A-Z0-9]{3}\b/g) ?? []);
    const byCode = picks.filter((p) => typed.has(leadCode(p.reply.id)));
    if (byCode.length === 1) picks = byCode;
  }
  const who = (h: (typeof hits)[number]) => `${h.name}${multi ? ` (${h.biz.profile.name})` : ""} #${leadCode(h.reply.id)}`;
  const example = text.replace(CODE, " ").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").toUpperCase().slice(0, 30) || "BOOKED 2400";
  const fallbackBiz = pool.length === 1 ? pool[0]! : pool.find((b) => hits.some((h) => h.biz.id === b.id)) ?? pool[0]!;
  if (!picks.length)
    return code
      ? { businessId: fallbackBiz.id, reply: `No lead with #${code}.${multi ? " Check the code on the lead text." : ""}`, handled: "no_lead" }
      : // a booking we can't place is never dropped: a person puts it on the right lead
        { businessId: fallbackBiz.id, reply: `Nobody's waiting on a call right now.${outcome === "booked" ? " Jack will read this and put it on the right lead." : ""}`, handled: "no_lead", needsPerson: outcome === "booked" };
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
        : picks.every((p) => p.waiting)
          ? `Which one? ${picks.length} are waiting: ${list.map(who).join(", ")}. Text it again with the code, like "${example} #${leadCode(list[0]!.reply.id)}".`
          : `Which one? That could be ${joinOr(list.map(who), "or")}. Text it again with the code, like "${example} #${leadCode(list[0]!.reply.id)}".`,
      handled: "ask_lead",
      // a booking must never be lost to a question: a person sees it too, as they do one that may be about a lead
      // the owner already told us about
      needsPerson: !!code || picks.some((p) => !p.waiting),
    };
  }
  const target = picks[0]!;
  const bid = target.biz.id;
  // Taking a booking back moves its dollars off the ledger: a plain "NO #K7Q" does it; anything longer ("#K7Q she won't
  // sign up for the monthly plan though"), or with no code at all, is more likely about something else, so a person
  // reads it first.
  if (target.reply.outcome === "booked" && outcome !== "booked" && (!code || text.replace(CODE, " ").trim().split(/\s+/).length > 3))
    return { businessId: bid, reply: `${multi ? `${target.biz.profile.name}: ` : ""}${target.name} is booked on your results. To take that back, text NO #${leadCode(target.reply.id)}. Jack will read this too.`, handled: "booked_kept", needsPerson: true };
  // A NO without a code whose only fit is a lead the owner already told us about (quoted, reached, no answer) may be
  // about anything else we asked: it never closes that lead out on its own. A person reads it; NO + the #code does it.
  if (outcome === "lost" && !code && !target.waiting)
    return { businessId: bid, reply: `${multi ? `${target.biz.profile.name}: ` : ""}Is that about ${target.name}? To mark that lead not a fit, text NO #${leadCode(target.reply.id)}. Jack will read this too.`, handled: "lost_unsure", needsPerson: true };
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
function hasWaitingLead(d: Deps, bid: string, fresh = false): boolean {
  const s = d.accounts.peek(bid)?.state;
  if (!s) return false;
  const now = nowLocal(d, s);
  return s.replies.some((r) => r.status === "handed_off" && !r.ownerContactedAt && (!fresh || Date.parse(`${now.slice(0, 19)}Z`) - Date.parse(`${(r.handedOffAt ?? r.receivedAt).slice(0, 19)}Z`) < NUDGE_MAX_AGE_HOURS * 3_600_000));
}

function outstanding(d: Deps, bid: string, kind: "close" | "renewal"): boolean {
  const s = d.accounts.peek(bid)?.state;
  if (!s) return false;
  const b = s.dataset.business;
  if (kind === "close" && b.plan.stage !== "trial") return false;
  if (kind === "renewal" && (b.plan.stage !== "paying" || b.plan.billing !== "annual")) return false;
  const today = nowLocal(d, s).slice(0, 10);
  // a renewal already answered (a year from its end is on the books) is never asked again; MONTHLY ends it above
  const answered = (m: (typeof s.ownerMessages)[number]) => kind === "renewal" && !!m.refs?.some((r) => r.kind === "year_end" && (b.plan.yearsPaidOn ?? []).some((y) => y >= r.id));
  return s.ownerMessages.some((m) => m.kind === kind && daysBetween(m.at.slice(0, 10), today) <= (kind === "close" ? 21 : 45) && !answered(m));
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
