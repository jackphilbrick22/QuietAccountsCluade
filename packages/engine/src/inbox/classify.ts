/**
 * Inbox agent — reads a homeowner's reply and decides what it means.
 *
 * Pure, deterministic rules (no model, no network). The design:
 *   1. clean the reply (quoted history, signatures, HTML) — see clean.ts
 *   2. normalize (lowercase, "don't" -> "dont", "no rush" -> "norush" so it is not read as a negation)
 *   3. run pattern tables per intent; every hit is `strong` or `weak`, and positive patterns are
 *      negation-checked ("not interested" never counts as "interested")
 *   4. resolve with the legal/safety PRIORITY ORDER:
 *        stop / complaint  >  bounce / auto_reply  >  moved / wrong_person
 *        >  already_done / not_interested  >  later  >  wants_it / wants_price / question
 *      Strong hits are resolved first in that order, then weak hits, so a stray "no" or
 *      "the tree fell" never outranks an explicit "please come out asap".
 *      Machine-generated bounces (mailer-daemon, DSN) are recognized before stop, because they
 *      quote our own footer back and cannot carry a human's opt-out.
 *   5. extract phone / best time / timeframe / price / competitor / urgency / followUpOn
 *   6. write a one-line summary for the owner's text message
 */
import type { ISODate, ReplyExtract, ReplyIntent } from "../model.ts";
import { addDays, addMonths, daysBetween, fmtPhone, mondayOf, monthOf, phonesInText, toISODate, weekday, yearOf } from "../util.ts";
import { cleanReplyText } from "./clean.ts";

export interface ReplyReading {
  intent: ReplyIntent;
  confidence: number;
  extracted: ReplyExtract;
  signals: string[];
  cleaned: string;
  needsHuman: boolean;
  summary: string;
}

export interface ReadReplyInput {
  text: string;
  subject?: string;
  from?: string;
  asOf: ISODate;
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

/** Lowercase, straighten quotes, drop intra-word apostrophes, neutralize "no problem"-style phrases. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’ʼ`´′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, " - ")
    .replace(/(\w)'(\w)/g, "$1$2") // don't -> dont, we're -> were, it's -> its
    .replace(/\bno (problem|problems|worries|worry|issue|issues|big deal|pressure|biggie)\b/g, "noproblem")
    .replace(/\bnot a problem\b/g, "noproblem")
    .replace(/\bno (rush|hurry)\b/g, "norush")
    .replace(/\bnot in a (rush|hurry)\b/g, "norush")
    .replace(/\bno doubt\b/g, "nodoubt")
    .replace(/\bno matter\b/g, "nomatter")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** Drop a leading greeting / pleasantry so "Hi Sarah, yes please" starts with "yes". */
function stripLead(t: string): string {
  let s = t;
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s
      .replace(/^(hi|hello|hey|hiya|howdy|good (morning|afternoon|evening|day)|morning|afternoon|dear|greetings)\b[^\n,.!?:-]{0,30}[,.!:\n-]+\s*/, "")
      .replace(/^(thanks|thank you|thx|ty)( so much| very much)? (for|4) (the |your )?(reaching out|following up|follow ?up|checking in|check ?in|the email|your email|the note|your note|the reminder|reminder|getting back|writing|message|email|note)[^\n,.!?]{0,20}[,.!\n-]+\s*/, "")
      .trim();
    if (s === before) break;
  }
  return s;
}

/** Split into sentences / clauses on terminal punctuation, semicolons and newlines. */
export function splitSentences(t: string): string[] {
  return t
    .split(/(?<=[.!?])\s+|\n+|;\s*/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

const NEGATOR = /^(not|no|dont|doesnt|didnt|isnt|arent|wasnt|werent|wont|cant|cannot|never|neither|nor|without|hardly|nobody|nothing|havent|hasnt|hadnt|wouldnt|shouldnt|couldnt|aint|nope|nah)$/;
const FUTURE_WORD = /^(get|getting|need|needs|needed|want|wants|wanted|like|wanna|hoping|hope|would|could|can|will|should|must|when|once|until|till|if|before|after|make|sure|to|be|gotta|trying|try|plan|planning)$/;

/** Is the match at `index` negated within its own clause ("not interested", "dont still need")? */
export function negatedBefore(text: string, index: number, window = 3): boolean {
  const before = text.slice(Math.max(0, index - 60), index);
  const clause = before.split(/[.!?;\n,]|\bbut\b|\bhowever\b|\bthough\b/).pop() ?? "";
  const words = clause.trim().split(/\s+/).filter(Boolean).slice(-window);
  return words.some((w) => NEGATOR.test(w.replace(/[^a-z]/g, "")));
}

/** Is the (past-tense-looking) match actually about the future ("need to get it taken care of")? */
function futureBefore(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 50), index);
  const clause = before.split(/[.!?;\n,]|\bbut\b/).pop() ?? "";
  const words = clause.trim().split(/\s+/).filter(Boolean).slice(-4);
  return words.some((w) => FUTURE_WORD.test(w.replace(/[^a-z]/g, "")));
}

const NEG_INSIDE = /\b(not|dont|doesnt|wont|cant|isnt|arent|never|no longer)\b/;

export interface Pat {
  re: RegExp;
  label: string;
  strong: boolean;
  /** Discard matches negated in their clause (or containing a negator). */
  neg?: boolean;
  /** Discard matches that follow a future/modal word ("need to get it taken care of"). */
  fut?: boolean;
  /** For wants_it: a commitment to proceed (go ahead / book / come out), not just interest. */
  commit?: boolean;
  /** For not_interested: a hard no that a later-date mention does not soften. */
  hard?: boolean;
  /** For not_interested: this hit is only a price objection ("too expensive"). */
  price?: boolean;
}

export interface Hit {
  intent: ReplyIntent;
  label: string;
  strong: boolean;
  index: number;
  end: number;
  commit?: boolean;
  hard?: boolean;
  price?: boolean;
}

function globalize(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
}

/** First non-negated match of a pattern, or undefined. Records discarded negations in `negated`. */
function findHit(text: string, p: Pat, intent: ReplyIntent, negated: string[]): Hit | undefined {
  const re = globalize(p.re);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (p.neg && (negatedBefore(text, m.index) || NEG_INSIDE.test(m[0]))) {
      negated.push(`${intent}:${p.label}`);
      continue;
    }
    if (p.fut && futureBefore(text, m.index)) {
      negated.push(`${intent}:${p.label}(future)`);
      continue;
    }
    return {
      intent,
      label: p.label,
      strong: p.strong,
      index: m.index,
      end: m.index + m[0].length,
      ...(p.commit ? { commit: true } : {}),
      ...(p.hard ? { hard: true } : {}),
      ...(p.price ? { price: true } : {}),
    };
  }
  return undefined;
}

export function runPatterns(text: string, pats: Pat[], intent: ReplyIntent, negated: string[]): Hit[] {
  const out: Hit[] = [];
  for (const p of pats) {
    const h = findHit(text, p, intent, negated);
    if (h) out.push(h);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Pattern tables (run against normalized text)                        */
/* ------------------------------------------------------------------ */

const PRONOUN_YOU = "(?:you|u|ya|yall|you guys|you all|your (?:company|office|business|people|guys|crew|team))";

export const STOP_PATS: Pat[] = [
  { re: /\bun-?sub(?:scribe|scribed|scribing|scription)?\b/, label: "unsubscribe", strong: true },
  { re: /\bopt(?:ing|ed)?[\s-]?out\b/, label: "opt out", strong: true },
  { re: /\bremove (?:me|us|myself|ourselves|her|him|my (?:wife|husband|spouse|partner|mom|mother|dad|father)|this (?:e-?mail|address|account)|(?:my|our) (?:name|names|e-?mail|email address|e-?mail address|address|info|information|contact|contact info|number|family))\b/, label: "remove me", strong: true },
  { re: /\b(?:take|get|drop|delete|scratch|strike|cross|pull|leave) (?:me|us|her|him|them|my (?:name|e-?mail|email address|address|info|wife|husband|spouse|partner|mom|mother|dad|father|son|daughter)|our (?:name|e-?mail|address|info)) (?:off|from|out of)\b/, label: "take me off", strong: true },
  { re: /\boff (?:of )?(?:your|the|this|ur|all|any|every) (?:e-?mail(?:ing)? |mailing |contact |call |marketing |distribution |customer |sales |spam )?lists?\b/, label: "off your list", strong: true },
  { re: /\b(?:stop|quit|cease|discontinue|end) (?:e-?mailing|mailing|sending|contacting|texting|messaging|writing|calling|bothering|spamming|bugging|harassing|pestering|soliciting|reaching out|following up|with (?:the|these|your|all)|these|those|all (?:the |these |this )?(?:e-?mails?|messages?|contact)|the (?:e-?mails?|emails|messages?|texts?|mail|spam|solicitations?|follow ?ups?)|your (?:e-?mails?|emails|messages?|texts?|mail|spam)|e-?mails?\b|messages\b|it\b|this\b|now\b|immediately\b)/, label: "stop emailing", strong: true },
  { re: /\b(?:please|pls|plz|just) stop\b(?! by| over| in\b| out| at\b| on\b)/, label: "please stop", strong: true },
  { re: new RegExp(`\\b(?:do not|dont|never|pls dont|please dont|please do not|dont ever|do not ever|never ever) (?:e-?mail|mail|contact|write(?: to)?|message|solicit|spam|bother|reach out to|send (?:me |us )?(?:any ?more|anything|more|another|further|these|those|any))(?: (?:me|us|this (?:e-?mail|address|account)))?\\b`), label: "do not contact", strong: true },
  { re: /\b(?:do not|dont|never|please dont|please do not) (?:call|text|phone) (?:me|us) (?:again|anymore|any more|ever)\b/, label: "do not call again", strong: true },
  { re: /\bno (?:more|further) (?:e-?mails?|emails|messages?|contact|solicitations?|mailings?|mail|texts?|follow ?ups?|marketing|spam)\b/, label: "no more emails", strong: true },
  { re: /\b(?:leave|let) (?:me|us) (?:alone|be)\b|\bgo away\b|\bget lost\b/, label: "leave me alone", strong: true },
  { re: /\b(?:dont|do not|no longer) (?:want|wish|care) to (?:receive|get|be contacted|hear from (?:you|u)|be on|be (?:e-?mailed|emailed)|get (?:e-?mails|emails))/, label: "no longer wish to receive", strong: true },
  { re: /\b(?:dont|do not) want (?:any more|anymore|more|further|any|your) (?:e-?mails?|emails|messages?|mail|contact|solicitations?|marketing|spam)\b/, label: "dont want emails", strong: true },
  { re: /\bdo not (?:contact|e-?mail|mail|solicit)\b/, label: "do not contact", strong: true },
  { re: /\bnot interested in (?:being (?:contacted|e-?mailed|emailed|solicited)|hearing from|receiving|these|your (?:e-?mails|emails|messages|marketing)|any (?:e-?mails|emails|more))\b|\b(?:want|wants) (?:off|out of) (?:this|your|the) (?:list|mailing list)\b/, label: "no contact wanted", strong: true },
  { re: /\b(?:stop|cease|end) (?:all )?(?:contact|communications?|correspondence)\b/, label: "cease contact", strong: true },
  { re: /\bdo not (?:call|contact|e-?mail|mail) list\b/, label: "do-not-contact list", strong: true },
];

/** Sentence-level stop: the whole sentence is just "stop" / "remove" / "unsubscribe". */
export const STOP_SENTENCE = /^(?:please |pls |plz )?(?:stop[\s,.!]+)*(?:stop|remove(?: me| us)?|unsubscribe(?: me)?|opt out)(?: it| now| please| pls| plz| thanks| thank you| this| all| immediately| asap)?[\s.!]*$/;

export const COMPLAINT_PATS: Pat[] = [
  { re: /\bspam(?:ming|med|mer|mers|my)?\b/, label: "spam", strong: true },
  { re: /\bjunk (?:mail|e-?mail|email)\b/, label: "junk mail", strong: true },
  { re: /\breport(?:ed|ing)? (?:you|u|this|it|these|them|your (?:company|business|e-?mails?|emails))\b/, label: "reported", strong: true },
  { re: /\b(?:marked|marking|mark|flagged|flagging|flag) (?:this|it|you|these|them|your e-?mails?) as (?:spam|junk|phishing)\b/, label: "marked as spam", strong: true },
  { re: /\b(?:bbb|better business bureau|ftc|fcc|attorney general|consumer protection|can-?spam|tcpa|do not call registry)\b/, label: "regulator", strong: true },
  { re: /\b(?:how|where|why) (?:did|do|does|would|the hell did) (?:you|u|ya|yall|you guys|your company) (?:get|find|obtain|have) (?:my|our|this) (?:e-?mail|email|address|info|information|name|number|contact|details)/, label: "how did you get my email", strong: true },
  { re: /\bhowd (?:you|u) get (?:my|our|this)\b/, label: "how did you get my email", strong: true },
  { re: /\bwho gave (?:you|u) (?:my|our|this)\b/, label: "who gave you my info", strong: true },
  { re: /\b(?:harass(?:ment|ing|ed)?|stalk(?:ing|er)?)\b/, label: "harassment", strong: true },
  { re: /\b(?:lawyer|attorney|sue (?:you|u|your)|legal action|lawsuit|cease and desist|small claims)\b/, label: "legal threat", strong: true },
  { re: /\bscam(?:mer|mers|my|ming)?\b/, label: "scam", strong: true },
  { re: /\b(?:fuck (?:you|u|off|yourself|yourselves|this|that|your|ya)|f+u+c+k+ (?:you|u|off)|fck (?:you|u|off)|f\*+ (?:off|you|u)|screw (?:you|u|off|yourselves)|piss off|go to hell|damn you|stfu|bite me|shove it|leave me the f\w*)\b/, label: "profanity at sender", strong: true },
  { re: /\b(?:assholes?|a\*+hole|bastards?|bitch\w*|idiots?|morons?|scammers?|jackass\w*|dickhead\w*|clowns|losers)\b/, label: "insult", strong: true },
  { re: /(?:\bfuck\w*|\bf\*+k\b|\bf\*{2,}|\bfck\w*|\bshit\w*|\bbullshit\b|\bwtf\b|\bgoddamn\w*|\bdamn it\b|\bpissed\b)/, label: "profanity", strong: false },
  { re: /\benough (?:with )?(?:the |these |your |all the )?(?:e-?mails|emails|messages|spam|follow ?ups)\b/, label: "enough with the emails", strong: true },
  { re: /\b(?:sick (?:and tired )?of|fed up|enough already|how dare|shame on you|worst (?:company|service|business)|never (?:use|hire|do business with|call) (?:you|your)|stop harassing|unsolicited|(?:do not|dont) appreciate|very rude|so rude|unprofessional)\b/, label: "angry", strong: true },
  { re: new RegExp(`\\bwhy (?:do|are|does|would|did|the hell|tf) ${PRONOUN_YOU} (?:keep|keeps|still|continue|even)\\b`), label: "why do you keep", strong: true },
  { re: /\b(?:you|your (?:e-?mails?|emails|messages?|company)|this|these (?:e-?mails?|emails|messages?)) (?:are|is) (?:so |very |really |getting |beyond )?(?:annoying|ridiculous|obnoxious|harassment|creepy|intrusive|out of line|a joke|inappropriate)\b/, label: "you are annoying", strong: true },
  { re: /\b(?:already|i) told (?:you|u|yall|your (?:office|guy|company|people))\b/, label: "already told you", strong: false },
  { re: /\bhow many times\b/, label: "how many times", strong: false },
  { re: /\b(?:third|3rd|fourth|4th|fifth|5th) (?:time|e-?mail|email|message)\b/, label: "repeat contact", strong: false },
  { re: new RegExp(`\\b${PRONOUN_YOU} (?:keep|keeps|continue to|continue) (?:e-?mailing|emailing|sending|contacting|bugging|messaging|writing|reaching out|following up)\\b`), label: "you keep emailing", strong: false },
  { re: /\b(?:annoyed|annoying|irritated|irritating|infuriating)\b/, label: "annoyed", strong: false },
];

export const BOUNCE_FROM = /(?:mailer-daemon|postmaster|mail delivery (?:subsystem|system)|maildelivery|\bbounces?[@+])/i;
export const BOUNCE_SUBJECT = /\b(?:undeliverable|undelivered|delivery status notification|delivery (?:has )?failed|delivery failure|failure notice|returned mail|mail delivery (?:failed|failure|subsystem)|message not delivered|delivery incomplete|could not be delivered|non-?delivery|mail system error|returned to sender|delayed mail|message delayed)\b/i;
export const BOUNCE_BODY = /\b(?:address not found|mailbox (?:is )?(?:full|unavailable|not found|disabled|inactive)|mailbox (?:quota )?exceeded|over (?:the )?quota|quota exceeded|user unknown|unknown user|no such (?:user|recipient|mailbox|address)|recipient (?:address )?rejected|(?:address|account|mailbox|user|recipient)\b[^.\n]{0,40}\b(?:does not exist|doesnt exist|is disabled|has been disabled|is inactive)|delivery has failed|delivery to the following recipients? (?:has )?failed|message delivery failed|(?:couldnt|could not|cannot|cant) be delivered|(?:wasnt|was not|hasnt been|has not been) delivered|permanent(?:ly)? fail(?:ure|ed)|550[ -]5\.\d\.\d|5\.1\.1|5\.2\.2|554 5\.\d\.\d|delivery status notification|mail delivery subsystem|the e-?mail account that you tried to reach|undeliverable|message (?:was )?rejected|smtp error|remote server returned|diagnostic-code|mailer-daemon)\b/;

export const AUTO_SUBJECT = /(?:\b(?:automatic reply|auto[\s-]?reply|autoreply|auto[\s-]?response|autoresponder|out of (?:the )?office|ooo|vacation (?:reply|response|message|notice|autoreply)|away from (?:my|the) (?:office|desk))\b|^\s*auto:)/i;
export const AUTO_PATS: Pat[] = [
  { re: /\bthis is an? (?:automated|automatic|auto-generated|auto generated|computer generated)\b/, label: "automated message", strong: true },
  { re: /\b(?:automatic reply|auto[\s-]?reply|autoreply|auto[\s-]?response|auto-generated|autoresponder)\b/, label: "auto reply", strong: true },
  { re: /\bout of (?:the )?office\b/, label: "out of office", strong: true },
  { re: /\baway from (?:my|the) (?:office|desk)\b/, label: "away from office", strong: true },
  { re: /\blimited (?:access to (?:e-?mail|my e-?mail|email|my email)|e-?mail access|email access)\b/, label: "limited email access", strong: true },
  { re: /\b(?:upon|on|after) my return\b|\buntil my return\b/, label: "upon my return", strong: true },
  { re: /\b(?:this|the) (?:mailbox|inbox|e-?mail (?:address|account)|email (?:address|account)) is (?:no longer |not )(?:being )?(?:monitored|in use|active|checked)\b/, label: "mailbox not monitored", strong: true },
  { re: /\bdo not reply to this (?:e-?mail|message|email)\b/, label: "do not reply", strong: true },
  { re: /\b(?:thank you|thanks) for (?:your|contacting|reaching)\b[^.\n]{0,40}\b(?:we|i) (?:will|shall)(?: be)? (?:respond|reply|get back|be in touch|contact you|return)\b[^.\n]{0,50}\b(?:as soon as|shortly|within|promptly|business|possible)\b/, label: "we will respond shortly", strong: true },
  { re: /\bi will be out\b[^.\n]{0,60}\b(?:return|returning|back (?:on|in)|until|through|thru)\b/, label: "i will be out", strong: true },
  { re: /\b(?:i am|im|i will be|ill be|we are|were) (?:currently )?(?:away|out|traveling|travelling|on (?:vacation|leave|holiday|pto|maternity leave|paternity leave|medical leave))\b[^.\n]{0,40}\b(?:until|through|thru|till|til|returning|return|back on|back in)\b/, label: "away until", strong: false },
];

export const WRONG_PATS: Pat[] = [
  { re: /\bwrong (?:number|e-?mail|email address|e-?mail address|person|guy|lady|gal|address|house|customer|contact|name|account|people|family|persons?)\b/, label: "wrong person", strong: true },
  { re: /\b(?:who is|whos|who are|who r|who the hell is|who the hell are) (?:this|you|u|ya|yall|you guys|you people|these people)\b/, label: "who is this", strong: true },
  { re: /\b(?:i|we) (?:never|didnt|did not|have never|havent|have not|never ever|do not|dont|never once) (?:asked|requested|ask|request|contacted|called|reached out|filled out|signed up|hired|used|wanted|remember(?: asking| requesting| getting| contacting)?|got in touch)\b[^.!?\n]{0,40}\b(?:quote|quotes|estimate|estimates|bid|price|you|your|yall|service|services|work|anything|any|for (?:this|that|it)|company|business)\b/, label: "never asked for a quote", strong: true },
  { re: /\b(?:i|we) (?:dont|do not) know (?:who (?:you are|this is|u are|you people are|yall are)|you|what (?:this|youre|you are|this e-?mail|this email) (?:is )?(?:about|talking about|referring to|for)|what this is|any(?:one|body) (?:named|by (?:that|the) name|called))\b/, label: "dont know you", strong: true },
  { re: /\bnever (?:heard of|used|did business with|done business with|dealt with|hired|called) (?:you|your|this|u|yall|them)\b/, label: "never heard of you", strong: true },
  { re: /\b(?:you|u|youve|you have|you got|youre|you are) (?:must )?(?:have |got |ve got |have got )?(?:the wrong|me (?:mixed up|confused)|mixed me up|confused me)\b/, label: "you have the wrong person", strong: true },
  { re: /\bmust (?:have|be) (?:the )?wrong\b|\bmistaken (?:me )?(?:for|with)\b|\bconfused (?:me )?with (?:someone|somebody|another)\b/, label: "mistaken identity", strong: true },
  { re: /\b(?:no|not) (?:idea|sure|clue) (?:who|what) (?:you are|this is|youre|this e-?mail is|youre talking about|this is about|you mean)\b/, label: "no idea who you are", strong: true },
  { re: /\b(?:no one|nobody|no \w+) (?:here )?(?:by that name|named)\b|\b(?:doesnt|does not|dont|do not) live here\b/, label: "no such person here", strong: true },
  { re: /\b(?:this|that|it) (?:isnt|is not|was not|wasnt|aint|is) (?:not )?(?:me|my (?:quote|job|tree|address|e-?mail|email|name|account))\b(?! (?:anymore|any more|any longer))/, label: "not me", strong: true },
  { re: /\b(?:i|we) (?:dont|do not) (?:have|own) (?:a|any) (?:tree|trees|septic|septic (?:tank|system)|pool|fence|lawn|yard|driveway|patio|deck)s?\b(?! (?:anymore|any more|now|any longer))/, label: "dont have that", strong: false },
  { re: /\bwhat (?:is this|this is|is this e-?mail|is this email)(?: about| regarding| for| in reference to| referring to)?\b/, label: "what is this", strong: false },
  { re: /\bdo i know (?:you|u)\b/, label: "do i know you", strong: false },
  { re: /\b(?:previous|prior|old|former) (?:owners?|homeowners?|tenants?|residents?|people)\b|\b(?:we|i) (?:just |recently )?(?:bought|purchased|moved into|closed on) (?:the|this|that) (?:house|home|property|place)\b/, label: "new occupant", strong: false },
  { re: /\bwhat (?:quote|estimate|tree|job|fence|project|work|appointment)\s*\?|\bi (?:never|dont remember) (?:got|getting|receiving) (?:a|any) (?:quote|estimate)\b/, label: "what quote?", strong: true },
  { re: /\b(?:im|i am) (?:confused|lost)\b/, label: "confused", strong: false },
];

/** Whole message "who is Sarah?" — they don't know the signer. */
export const WHO_IS_NAME = /^(?:um+ |uh+ |sorry,? |hi,? )?who(?: is|s) (?!doing|coming|this|that|it|the|going|in|on)[a-z]+\s*\??$/;

export const MOVED_PATS: Pat[] = [
  { re: /\b(?:we|i|they|have|had|just|already|recently|finally) (?:just |already |recently |finally )?sold\b(?! (?:on|out|me|us)\b)/, label: "sold the house", strong: true },
  { re: /\bsold (?:the|that|this|our|my|his|her|their|moms|dads|mothers|fathers|parents) (?:house|home|property|place|condo|lot|land|farm|residence|rental|camp|cottage|townhouse)\b/, label: "sold the house", strong: true },
  { re: /\b(?:house|home|property|place|condo) (?:was|has been|got|is|been|has) (?:been )?sold\b/, label: "house was sold", strong: true },
  { re: /\b(?:we|i|ive|weve|we have|i have|family|mom|dad|my (?:mother|father|parents|mom|dad)|parents|she|he|they|tenant|tenants|the owners?) (?:have |has |just |already |recently |since )*(?:moved|relocated)\b(?! (?:the|it|our|my|some|a|that|those|them|stuff|things|everything|in the)\b)/, label: "moved", strong: true },
  { re: /\bmoved (?:out|away|out of state|across the country|to (?:another|a new|florida|arizona|texas|the|north|south|carolina)|last (?:year|month|week|spring|summer|fall|winter))\b/, label: "moved away", strong: true },
  { re: /\bno longer (?:own|live|reside|have (?:the|that|this) (?:house|home|property|place)|at (?:that|this) (?:address|house|property)|the (?:owner|homeowner)|living there|there)\b/, label: "no longer own", strong: true },
  { re: /\b(?:dont|do not) (?:own|live (?:at|in)|reside at|have) (?:that|this|the) (?:house|home|property|place|address)(?: anymore| any more| any longer| now)?\b/, label: "dont own", strong: true },
  { re: /\b(?:dont|do not) live there\b/, label: "dont live there", strong: true },
  { re: /\bnot (?:the owner|the homeowner|living there|my (?:house|home|property|place) (?:anymore|any more|any longer|now))\b/, label: "not the owner", strong: true },
  { re: /\b(?:isnt|is not|not|no longer) (?:my|our) (?:house|home|property|place)(?: anymore| any more| any longer)\b/, label: "not our house anymore", strong: true },
  { re: /\b(?:the )?new (?:owners?|homeowners?|family|buyers?)\b/, label: "new owners", strong: true },
  { re: /\b(?:selling|listing|putting|put) (?:the|our|my) (?:house|home|property|place)(?: on the market| up for sale)?\b|\b(?:house|home|property) (?:is )?(?:under contract|on the market|for sale|being sold)\b/, label: "selling the house", strong: false },
  { re: /\b(?:passed away|passed on|deceased|has passed|in hospice|nursing home|assisted living)\b|\b(?:he|she|husband|wife|mother|father|mom|dad) passed\b/, label: "owner passed / care home", strong: false },
  { re: /\b(?:downsized|downsizing|relocating|moving (?:out|away|soon|next month|to))\b/, label: "moving", strong: false },
];

const DONE_SUBJECT = "(?:someone|somebody|some(?:one|body) else|another (?:company|guy|contractor|outfit|crew|service|business|tree (?:service|company|guy)|landscaper|septic (?:company|guy))|a different (?:company|guy|contractor|crew|outfit)|the other (?:company|guy|contractor|crew)|a (?:friend|neighbor|buddy|relative|family member|local guy|guy)|(?:my|our) (?:husband|wife|son|brother|dad|father|neighbor|neighbors|friend|buddy|son in law|brother in law|nephew|uncle|cousin|landlord|hoa)|the (?:city|town|county|state|village|utility|utilities|power company|electric company|landlord|hoa|association|insurance(?: company)?)|(?:the )?(?:power|electric|utility|cable) company)";

export const DONE_PATS: Pat[] = [
  { re: /\balready (?:been )?(?:done|did it|taken care of|took care of|cut|removed|pumped|fixed|handled|finished|completed|replaced|installed|poured|washed|cleaned|repaired|serviced|taken down|mowed|trimmed|ground|built|sealed|went with|hired|booked|scheduled (?:it|with)|signed with|contracted)\b/, label: "already done", strong: true, neg: true },
  { re: /\balready (?:have|had|got|found) (?:it|that|them|this|someone|somebody|a guy|a company|another|a contractor|the (?:work|job|tree|stump|fence|tank|driveway|patio|lawn|yard)[^.!?\n]{0,15}(?:done|removed|cut|pumped|taken care of))/, label: "already had it done", strong: true, neg: true },
  { re: /\b(?:is|are|was|were) already (?:gone|down|done|removed|taken care of|cut|fixed|pumped|finished)\b/, label: "already gone", strong: true, neg: true },
  { re: /\b(?:got|had|have had|have gotten|finally got|finally had) (?:it|that|them|this|everything|the (?:work|job|tree|trees|stump|stumps|fence|tank|septic|driveway|patio|walkway|house|deck|roof|lawn|yard|oak|maple|pine|limbs?|branches))? ?(?:all )?(?:done|taken care of|handled|finished|removed|cut(?: down)?|taken down|pumped(?: out)?|fixed|replaced|installed|poured|repaired|washed|ground(?: down)?|cleaned|mowed|trimmed)\b/, label: "had it done", strong: true, neg: true, fut: true },
  { re: /\b(?:had|got|hired|found|used|paid) (?:someone|somebody|a guy|another (?:company|guy|contractor|crew|outfit|service)|a (?:friend|neighbor|buddy|relative|local guy|local company|different company|cheaper)|my (?:brother|son|nephew|cousin|neighbor|friend|buddy|uncle|husband|brother in law|son in law))\b/, label: "had someone else", strong: true, neg: true, fut: true },
  { re: /\b(?:taken care of|took care of (?:it|that|them|this|everything))\b/, label: "taken care of", strong: true, neg: true, fut: true },
  { re: /\b(?:all set|all squared away|all taken care of|all done|were covered|we are covered|covered already)\b/, label: "all set", strong: true, neg: true, fut: true },
  { re: new RegExp(`\\b${DONE_SUBJECT}\\b[^.!?\\n]{0,40}?\\b(?:did|done|took care|took it|took them|took (?:it |them )?down|came (?:out )?and|cut (?:it|them|down)|removed|handled|fixed|finished|installed|built|poured|washed|pumped|got to it|got it done|ended up doing|already)\\b`), label: "someone else did it", strong: true, neg: true },
  { re: /\b(?:went|gone|going|decided to go|chose to go|ended up going|opted to go|well go|will go|goin|gonna go|are going|were going) with\b(?! (?:you|your|u|yall|the (?:oak|option|first|second|plan|smaller|bigger|cheaper option)|option|plan|it\b))/, label: "went with someone else", strong: true, neg: true },
  { re: /\b(?:hired|chose|picked|booked|selected|signed with|contracted with|used) (?:someone|somebody|another|a different|a cheaper|other|a guy|a local|a friend|the other|a company|a contractor)\b/, label: "hired someone else", strong: true, neg: true },
  { re: /\b(?:did|done|did the work|took care of it|handled it|fixed it|cut it|removed it|pumped it|did it|took it down) (?:it |them |that |the work |the job )?(?:myself|ourselves|ourself|himself|herself|themselves)\b/, label: "did it ourselves", strong: true, neg: true },
  { re: /\b(?:i|we|husband|my husband|hubby|my wife|my son|my dad) (?:did|cut|removed|took down|took care of|fixed|built|poured|washed|handled|mowed|trimmed|ground|dug|pulled|sealed|replaced|painted) (?:it|them|that|those|the (?:tree|trees|stump|stumps|work|job|fence|driveway|patio|limbs?|branches|deck|lawn|gutters)|down)\b/, label: "did it ourselves", strong: true, neg: true, fut: true },
  { re: /\b(?:tree|trees|it|they|oak|maple|pine|limb|limbs|branch|branches|stump|stumps|birch|ash|elm|spruce)\b[^.!?\n]{0,20}\b(?:was|were|has been|have been|got|is|are) (?:already )?(?:taken down|cut down|removed|taken out|gone|ground out|ground down|pulled out|dealt with)\b/, label: "tree is gone", strong: true, neg: true },
  { re: /\b(?:its|it was|it has been|it got|they were|theyve been|thats been|that was|this was|that got|everything is|everything was|job is|work is|work was) (?:already |all )?(?:done|handled|fixed|replaced|removed|pumped|taken care of|finished|completed|resolved|sorted|sorted out|dealt with)\b/, label: "its done", strong: true, neg: true, fut: true },
  { re: /\b(?:tree|trees|it|oak|maple|pine|limb|branch|the big one)\b[^.!?\n]{0,15}\b(?:fell|fell down|came down|blew down|went down|blew over|toppled|uprooted)\b/, label: "tree fell", strong: false, neg: true },
  { re: /\bstorm (?:took|knocked|brought) (?:it|them|the tree|that tree|the oak|the limb)(?: down| out| over)?\b/, label: "storm took it", strong: false },
];

export const NOT_INTERESTED_PATS: Pat[] = [
  { re: /\b(?:not|no longer|not really|not that|not very|not at all|nor|not too|not so) (?:interested|intrested|intersted|interseted|interesed)\b(?! (?:right now|at the moment|for now|this year|now|yet|currently|this season|until|till|at present|in (?:the )?(?:spring|summer|fall|winter)))/, label: "not interested", strong: true },
  { re: /\buninterested\b|\bnot in the market\b/, label: "not interested", strong: true },
  { re: /\b(?:im|were|we are|i am) (?:not|no longer) (?:looking|shopping|pursuing)\b/, label: "not looking", strong: true },
  { re: /\bno,? (?:thank(?:s| you| u)|thx|ty)\b|\bno,? but thank(?:s| you)\b|\bthanks?(?: you)?,? but no\b/, label: "no thanks", strong: true },
  { re: /\bno,? (?:were|we are|im|i am) (?:good|fine|ok|okay|all good)\b/, label: "no were good", strong: true },
  { re: /\bnot for (?:me|us)\b|\bnot (?:needed|necessary|required|worth it|worth the money|worth the cost)\b/, label: "not needed", strong: true, hard: true },
  { re: /\b(?:decided|chose|choosing|deciding|decide|going) (?:not to|against|to pass|to not|to leave (?:it|them|the)|to skip|to keep (?:it|them|the))\b/, label: "decided not to", strong: true },
  { re: /\b(?:dont|do not|no longer|dont really|do not really|wont|will not|dont even) (?:need|want|require) (?:it|them|this|that|those|the (?:work|service|services|job|tree|stump|quote|estimate|fence|patio|driveway|removal|pumping)|anything|your services|any (?:work|service|help)|to (?:do|proceed|move forward|go ahead|go forward|pursue))\b/, label: "dont need it", strong: true, hard: true },
  { re: /\bno longer (?:need|needed|require|want)\b/, label: "no longer need", strong: true, hard: true },
  { re: /\b(?:never ?mind|nvm|forget it|forget about it|scratch that)\b/, label: "never mind", strong: true, hard: true },
  { re: /\b(?:ill|well|i will|we will|gonna|going to|have to|will|think ill|think well|going to have to|im going to|were going to|gotta|must|shall) pass\b|\bpassing (?:on (?:this|it|that|this one)|for now)\b|^pass\b/, label: "pass", strong: true },
  { re: /\b(?:leave|leaving|keep|keeping) (?:it|them|the tree|the trees|things) (?:as is|alone|the way it is|the way they are|standing)\b/, label: "leave it", strong: true, hard: true },
  { re: /\bnot (?:going to|gonna|planning to|planning on|looking to|moving|able to) (?:do|proceed|move forward|go ahead|go forward|pursue|happen|do it|use you|hire)\b/, label: "not going ahead", strong: true },
  { re: /\b(?:not|wont be|will not be|no longer) (?:needing|pursuing|proceeding|moving forward|going forward|using (?:you|your)|hiring)\b/, label: "not proceeding", strong: true },
  { re: /\b(?:going to|gonna|will|decided to|planning to|plan to|well|ill) (?:do|handle|tackle|diy) (?:it|this|that|them) (?:myself|ourselves|ourself)\b|\bdiy\b/, label: "doing it themselves", strong: true, hard: true },
  { re: /\b(?:is|are|looks?|seems?|its|theyre) (?:fine|ok|okay|good|holding up|doing ok|doing fine) (?:for now|as is|the way (?:it|they) (?:is|are))\b/, label: "fine as is", strong: true },
  { re: /\bnot at this time\b|\bat this time,? no\b/, label: "not at this time", strong: true },
  { re: /\b(?:i|we) (?:dont|do not) think so\b|^(?:i )?dont think so\b|\b(?:i|we) (?:dont|do not) think (?:we|well|i|ill) (?:need|want|will|be|go)\b/, label: "dont think so", strong: true },
  { re: /^no need\b|\bno need (?:to|for|anymore|any more)\b/, label: "no need", strong: true },
  { re: /\b(?:not|no longer|not really) (?:interested|intrested|intersted) at (?:that|this|the|your) (?:price|cost|number)\b/, label: "not at that price", strong: true, price: true },
  { re: /\b(?:too|to|way too|much too|a bit too|a little too|bit too|little too) (?:expensive|pricey|high|steep|much|rich|costly|much money)\b|\b(?:a bit|a little|kinda|kind of|pretty|really|very|so|way) (?:expensive|pricey|steep|costly)\b/, label: "too expensive", strong: true, price: true },
  { re: /\b(?:price|quote|estimate|bid|cost|number) (?:is|was|seems|seemed) (?:too |a bit |a little |way |pretty |really |very )?(?:high|steep|much|expensive|pricey|crazy|insane|outrageous)\b/, label: "too expensive", strong: true, price: true },
  { re: /\b(?:out of|over|above|beyond|not in) (?:my|our|the) (?:price range|budget|range)\b|\b(?:cant|can not|cannot|could not|couldnt) afford\b(?! (?:it |to )?(?:right now|now|this year|at the moment|yet))|\bmore than (?:i|we) (?:want|wanted|can|could|are willing|were willing|would like) (?:to )?(?:spend|pay)\b|\b(?:way|much|a lot) (?:more|higher) than (?:i|we) (?:expected|thought|budgeted)\b|\bsticker shock\b/, label: "too expensive", strong: true, price: true },
  { re: /\bchanged (?:my|our) minds?\b/, label: "changed our mind", strong: false },
  { re: /^(?:im|were|we are|i am|all) (?:good|fine|all good)\b|\b(?:im|were|we are|i am) good,? (?:thanks|thank you|thx|for now)\b/, label: "im good", strong: false },
];

/** Whole-message "no". */
export const BARE_NO = /^(?:no+|nope|nah|naw|no sir|no maam|negative|n|not really|no way|hard pass|pass|no,? thanks?|no thank you)[\s.!]*$/;
/** Leading "no" on a longer message (weak). */
export const LEAD_NO = /^(?:no+|nope|nah|naw)\b/;

export const LATER_PATS: Pat[] = [
  { re: /\bnot (?:right )?now\b/, label: "not now", strong: true },
  { re: /\bnot (?:yet|just yet|quite yet|ready(?: yet| now| right now| to (?:commit|decide|move forward|go ahead|do it|schedule))?|this (?:year|season|fall|spring|summer|winter|month|week|time around|time)|until|till|til|before)\b/, label: "not yet", strong: true },
  { re: /\bnot (?:at the moment|currently|for now|for a while|anytime soon|any time soon|in the near future)\b/, label: "not at the moment", strong: true },
  { re: /\b(?:not|no longer|not really) (?:interested|intrested|intersted) (?:right now|at the moment|for now|this year|now|yet|currently|this season|until|till|at present|in (?:the )?(?:spring|summer|fall|winter))\b/, label: "not interested right now", strong: true },
  { re: /\b(?:maybe|possibly|perhaps|probably|hopefully|might be|could be|likely|prob) (?:in |next |this |after |later|around |by |sometime|some time|early |late |mid |once |when |closer |towards? |the |come )/, label: "maybe later", strong: true },
  { re: /\btry (?:me|us|back|again|later)\b/, label: "try me later", strong: true },
  { re: /\b(?:ill|i will|well|we will|let me|i need to|we need to|have to|i can|we can)\b[^.!?\n]{0,50}\bget back to (?:you|u|ya)\b|\bwill get back to (?:you|u)\b/, label: "ill get back to you", strong: true },
  { re: /\bask (?:me|us) again\b|\brevisit\b|\bcircle back\b/, label: "ask again", strong: true },
  { re: /\b(?:reach|check|circle|touch|follow) (?:back|out|base|up)(?: with (?:me|us))?\b[^.!?\n]{0,25}\b(?:in (?:the |a |an |\d|two|three|four|six|few|couple)|after|next|around|this (?:spring|summer|fall|winter)|later|closer|toward|towards|when|once|come|early|sometime|mid|end of|january|february|march|april|june|july|august|september|october|november|december)\b/, label: "check back later", strong: true },
  { re: /\b(?:get|come) back to (?:me|us)\b[^.!?\n]{0,20}\b(?:in (?:the |a |an |\d|two|three|few|couple)|after|next|around|later|closer|toward|towards|when|once|come|early|sometime)\b/, label: "get back to me later", strong: true },
  { re: /\b(?:contact|e-?mail|call|ping|text|message|write|try|hit|hit up|reach out to|remind) (?:me|us)(?: again| back| up)? (?:after that|then|at that point|later|sometime|closer to|toward|towards|down the road|in the future|after the (?:holidays|new year|first of the year)|next (?:year|season|spring|summer|fall|winter|month)|in (?:the )?(?:spring|summer|fall|autumn|winter|new year)|in (?:a few|a couple(?: of)?|\d+|two|three|four|five|six) (?:weeks|months)|in (?:january|february|march|april|may|june|july|august|september|october|november|december)|this (?:spring|summer|winter)|early next|once|when (?:it|the|things|we))\b/, label: "contact me later", strong: true },
  { re: /\b(?:hold|holding|put|putting|keep) (?:it |this |that |things )?(?:off|on hold)\b|\bon the back ?burner\b|\bbackburner\b|\bon hold\b/, label: "on hold", strong: true },
  { re: /\b(?:going to|gonna|will|well|have to|need to|want to|gotta|decided to|better) (?:just )?wait\b(?! (?:to hear|and see what you))/, label: "going to wait", strong: true, neg: true },
  { re: /\bpostpon(?:e|ed|ing)\b|\b(?:push|pushing|pushed) (?:it|this|that) (?:back|out|off)\b|\bput (?:it|this|that) off\b|\bdelay(?:ing)? (?:it|this|that)\b/, label: "postpone", strong: true },
  { re: /\b(?:wait|waiting|hold off|holding off) (?:until|till|til|for (?:the |a |spring|summer|fall|winter|next|insurance|approval|funds|money|our|my)|a (?:bit|while|few|little|couple)|on (?:it|this|that|insurance|the insurance|approval|the hoa|hoa|the permit|permits?|funds|money|the bank|a loan|my tax refund|tax refund|our tax refund|the adjuster)|to see|and see|till after|until after)\b/, label: "wait until", strong: true, neg: true },
  { re: /\b(?:maybe later|later on|at a later (?:date|time)|down the road|in the future|at some point|someday|some day|eventually|another time|some other time|not the right time|bad time|not a good time|timing (?:isnt|is not) (?:right|good)|timing is bad)\b/, label: "sometime later", strong: true },
  { re: /\b(?:cant|cannot|can not) (?:afford|do) (?:it|this|that)? ?(?:right now|now|this year|at the moment|yet|until)\b/, label: "cant afford right now", strong: true },
  { re: /\blater\b(?! (?:today|tonight|this (?:week|afternoon|morning|evening)))/, label: "later", strong: false },
  { re: /\b(?:budget|money|funds|cash|finances)\b[^.!?\n]{0,20}\b(?:tight|short|low|limited)\b/, label: "budget tight", strong: false },
  { re: /\b(?:busy|swamped|slammed|traveling|out of town|away)\b[^.!?\n]{0,20}\b(?:right now|at the moment|this (?:month|week|fall)|until)\b/, label: "busy right now", strong: false },
];

export const PRICE_INVITE = /\b(?:wiggle room|come down|go down|lower (?:the |your |that )?(?:price|number|it|quote|cost|bid)|better (?:price|deal|number|rate|offer)|do (?:any )?better|best (?:price|you can do|offer|deal)|bottom line|price match|(?:match|beat) (?:the|their|that|his|her|this|other|a|any) (?:other )?(?:price|quote|bid|number|offer|estimate)|cheaper|knock (?:off|some|a)|shave (?:off|some)|sharpen (?:your|the) pencil|negotiable|negotiate|discount(?:ed|s)?|payment plans?|financing|finance it|make payments|meet (?:me|us) (?:in the middle|halfway)|work with (?:me|us) on (?:the )?(?:price|cost)|flexible on (?:the )?price|less (?:money|expensive)|for less|lower price|lower number|reduce(?:d)? (?:the )?(?:price|cost|quote)|any (?:deals?|specials?|promos?|coupons?|flexibility))\b|\b(?:do|take|accept|go|come in|meet) (?:it |that |the job )?(?:for|at) \$?\s?\d[\d,]*\b|\bif (?:you|u) (?:can|could) (?:do|come down|lower|match|beat|get it)\b/;

export const WANTS_PRICE_PATS: Pat[] = [
  { re: /(?<!\b(?:got|have|had|received|getting|get|gotten) )\b(?:updated|new|current|revised|fresh|another|re-?done|redone|todays|this years|latest|ballpark|rough|written|final) (?:price|quote|qoute|estimate|bid|pricing|number|figure|proposal|cost|price quote)s?\b/, label: "updated price", strong: true, neg: true },
  { re: /\b(?:resend|re-send)\b|\bsend (?:it|that) (?:again|over again)\b/, label: "resend the quote", strong: true, neg: true },
  { re: /^\$+\s*\?*$/, label: "how much", strong: true },
  { re: /\bre-?quote\b|\bre-?price\b|\breprice\b|\bre-?estimate\b|\bre-?bid\b|\bupdate (?:the|my|your|our|that) (?:quote|price|estimate|bid|pricing)\b/, label: "requote", strong: true, neg: true },
  { re: /\b(?:send|email|e-mail|give|get|shoot|text|mail|forward|resend|re-send|drop) (?:me |us |over |it |that )?(?:a |an |the |your |updated |new |some |another |that |over |my |our )?(?:price|quote|qoute|estimate|bid|pricing|number|ballpark|figure|cost|costs|numbers|prices|proposal|rate|rates|breakdown)\b/, label: "send a price", strong: true, neg: true },
  { re: /\b(?:what|how much) (?:would|will|does|did|is|was|do|should|might|could) (?:it|that|this|they|the (?:\w+ )?(?:job|work|tree|removal|stump|pumping|fence|patio|driveway|price|cost|total|quote)|you|u|yall|it all) (?:cost|run|be|charge|come to|set me back|total|run me|come out to)\b/, label: "what would it cost", strong: true },
  { re: /\bhow much\b(?! (?:longer|time|notice|lead time|more time|work|of the|of a|damage|room|space))/, label: "how much", strong: true },
  { re: /\b(?:what|whats|what is|what was|what are|whats your|what is your) (?:(?:the |your |its |it |my |our |a )(?:price|prices|cost|costs|rate|rates|charge|damage|total|pricing|quote|estimate|bill|going rate)|(?:price|prices|cost|costs|rate|rates|charge|damage|total|pricing|going rate))\b/, label: "whats the price", strong: true },
  { re: /\b(?:same|still the same|still good|still valid|still stand|still apply|still hold|honor|honour|lock in|locked in)\b[^.?!\n]{0,30}\b(?:price|quote|estimate|pricing|number|rate|deal|offer|discount)\b/, label: "same price?", strong: true },
  { re: /\b(?:price|quote|estimate|pricing|number|rate|offer|deal|discount)\b[^.?!\n]{0,25}\b(?:still (?:good|valid|the same|stand|standing|apply|hold|available|in effect)|the same|gone up|go up|went up|changed|increased)\b/, label: "same price?", strong: true },
  { re: /\b(?:same|old|original) (?:price|quote|estimate|number)\b/, label: "same price?", strong: true },
  { re: /\b(?:need|want|like|love|appreciate|looking for|interested in|would like|get) (?:a|an|the|updated|new|your) (?:price|quote|estimate|bid|number|ballpark)\b/, label: "wants a price", strong: true, neg: true },
  { re: /(?<!\bwhat )\b(?:cost|price|pricing|quote|estimate|rate)s?\s*\?/, label: "price?", strong: true },
  { re: /\bstill (?:\$\s?\d|\d[\d,]{2,}\b)|\$\s?\d[\d,.]*k?\s*(?:still\b|\?)/, label: "same price?", strong: true },
];

/** Words a request can open with: "Yes please, ...", "Thanks, and ...". */
const ASK_LEAD = "(?:(?:yes|yeah|yep|sure|ok|okay|please|pls|plz|thanks|thank you|and|just)[,!.]?\\s+)*";
/** A past customer's old slot: "same day as before", "the same time as last year". */
const OLD_SLOT = "(?:the |our |my )?same (?:day|days|time|times|schedule) as (?:before|last (?:year|time|season))\\b";

export const WANTS_IT_PATS: Pat[] = [
  // commitments
  { re: /\bgo ahead\b(?! and (?:send|e-?mail|give|text|shoot|update|requote|re-quote|get me|mail))|\bgo for it\b|\blets (?:do (?:it|this|that)|go|roll|get (?:it|this|that|started|going|it on|er done)|set (?:it|that|something) up|schedule|book|move forward|proceed|make it happen|plan|get (?:you|yall) out)\b/, label: "go ahead", strong: true, neg: true, commit: true },
  { re: /(?:^|[.!?,;]\s*|\b(?:yes|yeah|yep|sure|ok|okay|please|pls|lets|lets just|go ahead and|ready to|want to|wanna|want you to|you can)\s+)do it\b(?! (?:myself|ourselves|ourself|for|at|cheaper|next|in the|this (?:spring|summer|fall|winter)|after))/, label: "do it", strong: true, neg: true, commit: true },
  { re: /\b(?:book|schedule|shedule|scedule) (?:it|me|us|that|this|the (?:work|job|removal|pumping)|a time|something|an appointment|a visit|a day|a date)\b|\bput (?:me|us|it|that) (?:on|in|down)(?: for| on| the)?\b|\bsign (?:me|us) up\b|\bset (?:it|me|us|something|a time|a day|a date|that|this) up\b|\bpencil (?:me|us|it) in\b|\block (?:it|me|us) in\b|\bcount (?:me|us) in\b/, label: "schedule me", strong: true, neg: true, commit: true },
  { re: /\bget (?:me|us|it|this|that) (?:on|in) (?:the|your) (?:schedule|calendar|books?|list)\b|\b(?:move|moving|go|going) forward\b|\bproceed\b/, label: "schedule me", strong: true, neg: true, commit: true },
  // a past customer asking for their old slot back. "Put me (or us) back on (the schedule)" opening its clause or after
  // please, can you or you could; "same day as before" after I want, I'd like, keep or can you with no "but" after it,
  // or bare as the reply's last words. Never "put it back in the shed", "why would you put me back on your list?",
  // "they keep the same day as before", "I'd like the same day as before but we're moving" or "Same day as before, but
  // we can't afford it this year".
  { re: new RegExp(`(?:(?<=(?:^|[.!?,;:\\n])\\s*)${ASK_LEAD}|\\b(?:please|pls|plz|(?<!\\bwhy )(?:can|could|would|will) ${PRONOUN_YOU}(?: please| pls| plz| just)?|${PRONOUN_YOU} (?:can|could)) )put (?:me|us) back (?:(?:on|in) (?:the|your|our) (?:(?:regular|usual|old|weekly|mowing|cleaning) )?(?:schedule|list|route|rotation|calendar|books)\\b|on(?= ?(?:please|pls|plz|thanks|thank you)?(?:[.!?,;:\\n]|$)))`), label: "old slot back", strong: true, neg: true, commit: true },
  { re: new RegExp(`(?:(?<=(?:^|[.!?,;:\\n])\\s*)${ASK_LEAD}(?:keep(?: (?:me|us) on)?|would (?:like|love|prefer)|want|need)|\\b(?:(?:i|we)(?: still| really| just| do)? (?:want|wanna|need)|(?:id|wed|(?:i|we) would) (?:like|love|prefer)|(?<!\\bwhy )(?:can|could|would|will) (?:${PRONOUN_YOU}|we|i)(?: please| just)?(?: (?:do|come|keep|have|get|go back to|put|book|schedule)(?: (?:me|us|it))?(?: (?:on|in|at|for|down for))?)?)) ${OLD_SLOT}(?![^.!?\\n]*\\b(?:but|though|except|however)\\b)`), label: "old slot back", strong: true, neg: true, commit: true },
  { re: new RegExp(`(?<=(?:^|[.!?\\n])\\s*)${ASK_LEAD}${OLD_SLOT}(?:,? (?:please|pls|plz|thanks|thank you|works(?: for (?:me|us))?|is fine|would be great))*[.!?]*(?:[\\s,]+(?:thanks|thank you|thx|cheers)[,.!]*(?:\\s+(?!anyway\\b)[a-z]+){0,2}[.!]*)?$`), label: "old slot back", strong: true, neg: true, commit: true },
  { re: /\b(?:approve|approved|accept|accepted|accepting)\b(?! (?:that|your apology))|\bsign(?:ed)? (?:the|your) (?:quote|estimate|contract|proposal)\b|\bsigned it\b|\b(?:send|pay|put down) (?:the |a )?deposit\b/, label: "approved", strong: true, neg: true, commit: true },
  { re: /\b(?:yes|yeah|yep|yup|sure|ok|okay)[,!. ]*(?:please|pls|plz|go ahead|lets do it|do it|definitely|absolutely|of course|for sure)\b|\bplease do\b|\b(?:yes|yeah|yep),? (?:we|i) (?:do|still|would|are|am|need|want)\b/, label: "yes please", strong: true, neg: true, commit: true },
  { re: /\b(?:im|were|we are|i am|we r|all) ready\b|\bready when (?:you|u) are\b|\bwhenever (?:you|u|yall) (?:can|are|have|get)\b|\bsooner the better\b|\bthe sooner the better\b/, label: "ready", strong: true, neg: true, commit: true },
  // come out / look
  { re: /\b(?:come|coming|swing|stop|pop|drop) (?:out|by|over|and (?:look|see|take a look)|take a look|look|have a look|see (?:it|them|the)|give it a look|check (?:it|out))\b/, label: "come look", strong: true, neg: true, commit: true },
  { re: new RegExp(`\\bwhen (?:can|could|would|will|are|is|do) (?:${PRONOUN_YOU}|the crew|someone|somebody|they) (?:be able to )?(?:come|be|do|start|get|make it|fit|schedule|swing|stop|have|out|available|free|here|there|able|begin|squeeze)\\b`), label: "when can you come", strong: true, neg: true, commit: true },
  { re: /\b(?:next|first|earliest|soonest) (?:available|opening|openings|slot|date|day|appointment|availability)\b|\bwhat (?:does|is) your (?:schedule|availability|calendar)\b|\bwhat (?:day|days|time|times|date)s? (?:works|work|would work|is good|are (?:you|u) (?:available|free))\b/, label: "when can you come", strong: true, neg: true, commit: true },
  { re: /\b(?:any|have any|got any|do you have|you have|is there any) (?:openings?|availability|time|room|slots?|spots?|days?) (?:next|this|in|on|for|coming|soon|before|left)\b/, label: "any openings", strong: true, neg: true, commit: true },
  { re: new RegExp(`\\b(?:can|could|would|will|are) (?:${PRONOUN_YOU}|someone|somebody|they) (?:be able to |still |please )?(?:come|come out|come by|stop by|swing by|send someone|make it|do it(?! (?:for|at|cheaper|myself))|fit (?:me|us|it) in|start|get (?:to it|out|here|over|started|it done|us in|me in|this done)|squeeze (?:me|us|it) in|do (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|this week|this weekend|next weekend|mornings?|afternoons?)|schedule (?:me|us|it)|book (?:me|us|it)|come look|take care of it|do the (?:work|job)|be here|be out|pencil)\\b`), label: "can you come", strong: true, neg: true, commit: true },
  { re: /\b(?:you|u|yall|your crew) (?:can|could) (?:come|stop by|swing by|start|do it)\b|\bfeel free to (?:come|stop|swing)\b/, label: "you can come", strong: true, neg: true, commit: true },
  { re: /\b(?:asap|a\.s\.a\.p|as soon as (?:possible|you can)|right away|how soon|how quickly|earliest|soonest|first available|at your earliest)\b/, label: "asap", strong: true, neg: true, commit: true },
  { re: /\b(?:available|free|home|around)\b[^.!?\n]{0,20}\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|tomorrow|this week|next week|weekends?|weekdays?|afternoons?|mornings?|evenings?|after \d|anytime|any time|all week|most days)\b/, label: "available", strong: true, neg: true, commit: true },
  { re: /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|this week|weekend|any ?day|any ?time|anytime)\b[^.!?\n]{0,15}\b(?:works|work|would work|is (?:good|fine|great|best|ok|okay|perfect)|are (?:good|fine|great|best)|good|fine|ok|okay)\b|\b(?:works|work) for (?:me|us)\b/, label: "day works", strong: true, neg: true, commit: true },
  // need / want / interest
  { re: /\b(?:still|definitely|really|do|def|absolutely|yes we|yes i|we|i|we still|i still|we do|i do|we definitely|would|wed|id|and|also|just|but) (?:need|want|would like|wanna|needs|wants|like) (?:it|this|that|them|these|those|you|yall|the (?:work|job|tree|trees|stump|stumps|service|fence|patio|driveway|removal|pump ?out|pumping|oak|maple|pine|walkway|wall|deck|house|limbs?|branches|cleaning|washing|mowing|cleanup|clean up)|to (?:get|have|go|schedule|book|move|proceed|do (?:it|this|that|the)|set)|someone|somebody|a crew|your crew|(?:it|them|this|that) (?:done|gone|removed|cut|pumped|taken care of|taken down|scheduled|looked at)|the (?:[a-z]+ ){1,2}(?:tree|trees|stump|stumps|fence|patio|driveway|oak|maple|pine|limbs?|branches|tank|work|job|walkway|wall|deck|gutters|roof|lawn|yard)(?: (?:done|gone|removed|cut|down|pumped|taken care of|taken down|ground|cleaned|washed|sealed|installed|replaced|fixed))?)\b/, label: "still need it", strong: true, neg: true },
  { re: /\b(?:still|very|definitely|def|yes|yes im|yes we are|are|am|im|were|we are|i am|is|remain|quite|really) (?:interested|intrested|intersted|interseted)\b/, label: "still interested", strong: true, neg: true },
  { re: /\b(?:call|phone|ring|text|txt|holler at) (?:me|us)\b|\b(?:please|pls|plz) (?:call|text)\b|\bgive (?:me|us) a (?:call|ring|shout|buzz|text|holler)\b|\b(?:you can )?reach (?:me|us) (?:at|on|by)\b|\bmy (?:cell|number|phone|cell phone|mobile|#|cell #|phone number|cell number) (?:is|:)|\b(?:call|text) (?:me )?(?:at|on) \(?\d|\bcall\s*\(?\d{3}|\bbest (?:number|way to reach (?:me|us)|time to call)\b|\b(?:can|could) we (?:talk|chat|set up a time|meet|schedule|book|do it|do (?:this|that)|get (?:it|this|that) (?:done|scheduled|on)|set (?:it|that|this) up)\b|\blets (?:talk|chat)\b/, label: "call me", strong: true, neg: true },
  // weak positives
  { re: /^(?:[a-z]{2,12}[,:-]\s*)?(?:yes+|yeah|yea|ya|yep|yup|yessir|yes sir|yes maam|absolutely|definitely|definately|of course|certainly|correct|affirmative|you bet|indeed)\b/, label: "yes", strong: false, neg: true },
  { re: /^(?:[a-z]{2,12}[,:-]\s*)?(?:sure|sure thing|perfect|great|awesome|sounds good|sounds great|sounds fine|that works|works|deal|agreed|alright|all right|fine|cool|excellent|wonderful)\b/, label: "sure", strong: false, neg: true },
  { re: /^(?:ok|okay|k|kk|okie|okey|oki)\b/, label: "ok", strong: false, neg: true },
  { re: /^(?:y|yes|ya)[\s.!]*$/, label: "yes", strong: false },
  { re: /^(?:please|pls|plz)[\s.!]*$/, label: "please", strong: false },
  { re: /\b(?:interested|intrested|intersted|interseted)\b/, label: "interested", strong: false, neg: true },
  { re: /\bsounds (?:good|great|perfect|fine)\b|\b(?:yes|yeah|yep|yup)\b/, label: "yes", strong: false, neg: true },
  { re: /^when\s*\??[\s.!]*$|^what (?:day|time)\s*\??$/, label: "when?", strong: false },
];

export const QUESTION_PATS: Pat[] = [
  { re: /\b(?:same|same (?:guy|guys|people|outfit|crew)) (?:company|as|that|who)\b|\bsame company\b/, label: "same company?", strong: true },
  { re: /\b(?:are|r|is) (?:you|u|yall|you guys|your company) (?:still )?(?:insured|licensed|bonded|certified|local|still in business|in business|a real company|family owned|legit)\b/, label: "insured?", strong: true },
  { re: /\bdo (?:you|u|yall|you guys) (?:also |still |even |guys )?(?:do|offer|handle|provide|remove|grind|haul|take|work|service|install|pump|sell|clean|trim|carry|accept|have|need|require|charge)\b/, label: "do you do", strong: true },
  { re: /\b(?:how long|what kind|which|what type|what size|how many|how big|how deep|is it safe|will (?:you|it|they)|would (?:you|it|they)|should (?:i|we)|does (?:it|that|this)|did (?:you|u)|have (?:you|u)|who (?:is|would be) (?:doing|coming|the)|what (?:happens|about|if|does|do you|would you))\b/, label: "asks", strong: false },
];

const INTERROGATIVE_START = /^(?:do|does|did|are|is|can|could|will|would|what|whats|how|who|whos|why|where|which|when|have|has|should|any chance|is there|are there|am i|was it|were you)\b/;

export const URGENT_HIGH = /\b(?:asap|a\.s\.a\.p|urgent|urgently|emergency|emergencies|right away|immediately|as soon as possible|sooner the better|leaning(?! (?:towards?|to (?:go|do|wait|hold)))|leans(?! towards?)|dead tree|dead trees|dying|hanging(?! in there| out)|hangers?|widowmaker|widow maker|storm|storm damage|fell on|on (?:the|my|our) (?:house|roof|garage|car|fence|power lines?|shed)|power lines?|leak|leaks|leaking|leaky|backing up|backed up|back(?:ing)? up into|overflow(?:ing|ed)?|sewage|flood(?:ing|ed)?|dangerous|danger|hazard|hazardous|unsafe|split (?:trunk|in half)|about to (?:fall|come down|go)|going to fall|gonna fall|could fall|cracked (?:in half|limb)|alarm (?:is )?going off)\b/;
export const URGENT_LOW = /\b(?:norush|not urgent|no urgency|whenever(?! you can)|take your time|not a priority|low priority|at your convenience|when you get a chance|when you have (?:a chance|time)|no big hurry|not in a big hurry|not time sensitive)\b/;

export const COMPETITOR = /\b(?:someone else|somebody else|another (?:company|guy|contractor|outfit|crew|service|business|tree (?:service|company|guy)|landscaper)|different (?:company|guy|contractor|crew|outfit)|other (?:company|companies|guy|guys|contractor|contractors|outfit|crew)|went with|going with (?:someone|somebody|another|a different|the other)|hired (?:someone|somebody|another|a (?:guy|company|contractor|local))|(?:got|have|received|getting|had|gotten|get) (?:a |an |another |other |a couple(?: of)? |a few |two |three |several |some |more |better |cheaper |lower |second )*(?:other |more |better |cheaper |lower |second )?(?:quotes?|estimates?|bids?|prices?) from|(?:got|have|received|getting|gotten) (?:another|other|a couple(?: of)?|a few|two|three|several|more|a second|a cheaper|a lower|a better) (?:quotes?|estimates?|bids?)|competitor|cheaper (?:quote|price|bid|estimate|elsewhere|guy|company)|better (?:price|quote|deal) (?:from|elsewhere)|elsewhere|(?:beat|match) (?:their|the other|his|that other|the other guys) (?:price|quote|bid)|other (?:quote|quotes|estimate|estimates|bid|bids))\b/;

export const PRICE_WORDS = /(?:\$\s?\d|\b(?:price|prices|pricing|priced|cost|costs|costing|budget|expensive|cheap|cheaper|afford|discount|how much|charge|fee|rate|dollars|bucks|deal|wiggle room|pricey)\b)/;

/* ------------------------------------------------------------------ */
/* Time expressions & follow-up date math                              */
/* ------------------------------------------------------------------ */

export interface TimeExpr {
  /** The words as the person wrote them (normalized): "in the spring", "before winter". */
  phrase: string;
  index: number;
  end: number;
  /** defer = "not until then"; deadline = "before/by then"; near = within days; past = already happened. */
  kind: "defer" | "deadline" | "near" | "past";
  date?: ISODate;
  /** Owner-facing label for summaries: "in spring", "in March", "next month". */
  label: string;
  /** Specificity used to pick the follow-up date when several are mentioned. */
  spec: number;
  /** Worded as a deferral ("after the holidays", "until spring"), so it means "later" even when close. */
  explicit?: boolean;
  /** "not this fall" — the person ruled this time out. */
  negated?: boolean;
}

type Season = "spring" | "summer" | "fall" | "winter";
const SEASON_START: Record<Season, [number, number]> = { spring: [3, 15], summer: [6, 1], fall: [9, 15], winter: [12, 1] };

const MONTH_WORDS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  few: 3, "a few": 3, couple: 2, "a couple": 2, "a couple of": 2, "couple of": 2, several: 4,
};

const WEEKDAY_NUM: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const WEEKDAY_FULL = new Set(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]);
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * "Friday" = the next Friday after asOf (said on a Friday, that's a week out; "this friday" allows today).
 * "next Friday" = the Friday of next week: a week later than plain "Friday" when that one is still in this
 * (Monday-start) week, the same day when this week's has already gone.
 */
export function weekdayDate(asOf: ISODate, day: number, which: "" | "this" | "next" = ""): ISODate {
  let ahead = (day - weekday(asOf) + 7) % 7;
  if (ahead === 0 && which !== "this") ahead = 7;
  const date = addDays(asOf, ahead);
  return which === "next" && mondayOf(date) === mondayOf(asOf) ? addDays(date, 7) : date;
}

/** Next date with this month/day strictly after asOf. */
export function nextOccurrence(asOf: ISODate, month: number, day: number): ISODate | undefined {
  const y = yearOf(asOf);
  const d = toISODate(y, month, day);
  if (!d) return undefined;
  return d > asOf ? d : toISODate(y + 1, month, day);
}

function inSeason(season: Season, asOf: ISODate): boolean {
  const md = asOf.slice(5);
  switch (season) {
    case "spring":
      return md >= "03-15" && md < "06-01";
    case "summer":
      return md >= "06-01" && md < "09-15";
    case "fall":
      return md >= "09-15" && md < "12-01";
    case "winter":
      return md >= "12-01" || md < "03-15";
  }
}

/**
 * spring -> next Mar 15, summer -> Jun 1, fall/autumn -> Sep 15, winter -> Dec 1.
 * Already inside that season and not "next <season>"  -> 30 days out ("later this fall").
 * "late/end of <season>" -> 60 days after the season starts; "mid" -> 45.
 */
export function seasonDate(season: Season, modifier: string, asOf: ISODate): ISODate | undefined {
  const [m, d] = SEASON_START[season];
  if (inSeason(season, asOf) && !/\bnext\b/.test(modifier)) return addDays(asOf, 30);
  const start = nextOccurrence(asOf, m, d);
  if (!start) return undefined;
  if (/\b(late|end)\b/.test(modifier)) return addDays(start, 60);
  if (/\b(mid|middle)\b/.test(modifier)) return addDays(start, 45);
  return start;
}

function pastBefore(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 24), index);
  return /\b(last|past|every|since|each|once a|twice a|the past|the last|for the past|ago)\s*$/.test(before) ||
    /\b(passed|died|moved|sold|was|were|did|had|got|happened|started|finished|came|went|bought|removed|pumped|cut|fell)\s+(?:in|on|back in|during|over|around|this|last)?\s*$/.test(before);
}

function pushExpr(out: TimeExpr[], e: TimeExpr): void {
  // Keep the longer / more specific of two overlapping matches.
  for (let i = 0; i < out.length; i++) {
    const o = out[i]!;
    if (e.index < o.end && o.index < e.end) {
      const eLen = e.end - e.index;
      const oLen = o.end - o.index;
      if (e.spec > o.spec || (e.spec === o.spec && eLen > oLen)) out[i] = e;
      return;
    }
  }
  out.push(e);
}

const DEADLINE_PREP = /\b(before|by|ahead of|prior to)\b/;
const EXPLICIT_PREP = /\b(after|until|till|til|once|following|past)\b/;

/** Find every time expression in normalized text, resolved against asOf. */
export function findTimeExpressions(text: string, asOf: ISODate): TimeExpr[] {
  const t = normalizeForMatch(text);
  const out: TimeExpr[] = [];
  const hasNextYear = /\bnext year\b/.test(t);
  const whole = t.replace(/[^a-z ]/g, "").trim();
  let m: RegExpExecArray | null;

  // Seasons: "next spring", "in the fall", "before winter", "late summer"
  const seasonRe = /\b((?:(?:this|next|last|past|early|late|mid|later|sometime|coming|come|in|until|till|til|after|before|by|around|over|during|through|thru|toward|towards|into|the|for|of|ahead|prior|to|end|beginning|start|middle) ){0,4})(spring|springtime|summer|summertime|fall|autumn|winter|wintertime)\b/g;
  while ((m = seasonRe.exec(t))) {
    const pre = m[1] ?? "";
    const word = m[2] ?? "";
    const season: Season = word.startsWith("spring") ? "spring" : word.startsWith("summer") ? "summer" : word.startsWith("winter") ? "winter" : "fall";
    if (word === "fall" && !pre.trim() && !/^(?:fall|the fall|in the fall)$/.test(whole)) continue; // "the tree could fall"
    if (word === "fall" && /^(?:the |to |of )$/.test(pre)) continue;
    if (/\b(last|past)\b/.test(pre)) {
      pushExpr(out, { phrase: m[0].trim(), index: m.index, end: m.index + m[0].length, kind: "past", label: "", spec: 0 });
      continue;
    }
    const deadline = DEADLINE_PREP.test(pre);
    const date = seasonDate(season, pre, asOf);
    const isNext = /\bnext\b/.test(pre);
    pushExpr(out, {
      ...(EXPLICIT_PREP.test(pre) ? { explicit: true } : {}),
      phrase: m[0].trim(),
      index: m.index + (m[0].length - m[0].trimStart().length),
      end: m.index + m[0].length,
      kind: deadline ? "deadline" : "defer",
      ...(date ? { date } : {}),
      label: `${isNext ? "next" : "in"} ${season}`,
      spec: 5,
    });
  }

  // Months: "in March", "mid October", "after Jan 5", "late may"
  const monthRe = /\b((?:(?:early|mid|middle of|late|end of|the end of|beginning of|the beginning of|start of|the start of|first of|the first of|first week of|in|until|till|til|after|before|by|around|this|next|come|sometime in|toward|towards|into|through|thru|over|during|last|past|since|the|of) )*)(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\b\.?(?: (\d{1,2})(?:st|nd|rd|th)?\b)?/g;
  while ((m = monthRe.exec(t))) {
    const pre = m[1] ?? "";
    const word = m[2] ?? "";
    const dayStr = m[3];
    const month = MONTH_WORDS[word];
    if (!month) continue;
    const isFullSafe = word.length > 3 && word !== "march" && word !== "may";
    const onlyMonth = whole === word || whole === `in ${word}` || whole === `maybe ${word}` || whole === `maybe in ${word}`;
    if (!isFullSafe && !pre.trim() && !dayStr && !onlyMonth) continue;
    if (word === "may" && !dayStr && !/\b(early|mid|middle of|late|end of|beginning of|start of|first of|in|until|till|til|after|before|by|around|next|sometime in|come|through|thru)\s*$/.test(pre) && !onlyMonth) continue;
    if (/\b(last|past|since)\b/.test(pre) || pastBefore(t, m.index)) {
      pushExpr(out, { phrase: m[0].trim(), index: m.index, end: m.index + m[0].length, kind: "past", label: "", spec: 0 });
      continue;
    }
    let day = dayStr ? Number(dayStr) : 1;
    if (!dayStr && /\b(mid|middle)\b/.test(pre)) day = 15;
    if (!dayStr && /\b(late|end)\b/.test(pre)) day = 20;
    let date = nextOccurrence(asOf, month, day);
    if (date && hasNextYear && yearOf(date) === yearOf(asOf)) date = toISODate(yearOf(asOf) + 1, month, day);
    const deadline = DEADLINE_PREP.test(pre);
    const days = date ? daysBetween(asOf, date) : 99;
    pushExpr(out, {
      ...(EXPLICIT_PREP.test(pre) ? { explicit: true } : {}),
      phrase: m[0].trim(),
      index: m.index,
      end: m.index + m[0].length,
      kind: deadline ? "deadline" : days <= 7 && dayStr ? "near" : "defer",
      ...(date ? { date } : {}),
      label: dayStr ? `after ${MONTH_SHORT[month - 1]} ${day}` : `in ${MONTH_FULL[month - 1]}`,
      spec: dayStr ? 6 : 5,
    });
  }

  // Numeric dates: "after 10/15", "on 11/2"
  const numRe = /\b(after|on|by|before|until|till|around)? ?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((m = numRe.exec(t))) {
    const mo = Number(m[2]);
    const dd = Number(m[3]);
    if (mo < 1 || mo > 12 || dd < 1 || dd > 31) continue;
    let date: ISODate | undefined;
    if (m[4]) {
      let y = Number(m[4]);
      if (m[4].length === 2) y += 2000;
      date = toISODate(y, mo, dd);
    } else date = nextOccurrence(asOf, mo, dd);
    if (!date || date <= asOf) continue;
    const prep = m[1] ?? "";
    const days = daysBetween(asOf, date);
    pushExpr(out, {
      phrase: m[0].trim(), index: m.index, end: m.index + m[0].length,
      kind: DEADLINE_PREP.test(prep) ? "deadline" : days <= 7 ? "near" : "defer",
      date, label: `after ${MONTH_SHORT[mo - 1]} ${dd}`, spec: 6,
    });
  }

  const fixed: { re: RegExp; month?: number; day?: number; label: string; spec: number; kind?: TimeExpr["kind"]; season?: Season; nextYear?: boolean }[] = [
    { re: /\b(?:after|past|following|until after|till after|til after|once|in|into) (?:the )?(?:holidays|holiday season|christmas|xmas|new year|new years|the new year|first of the year)\b/g, month: 1, day: 5, label: "after the holidays", spec: 5 },
    { re: /\b(?:after|past|following|until after|once) thanksgiving\b/g, month: 12, day: 1, label: "after Thanksgiving", spec: 5 },
    { re: /\b(?:before|by|ahead of|prior to) (?:the )?(?:holidays|christmas|xmas|thanksgiving|new year|new years|the new year)\b/g, label: "before the holidays", spec: 5, kind: "deadline" },
    { re: /\b(?:(?:beginning|start|first part) of )?(?:early |sometime |later |late |in )?next (?:year|yr)\b|\bnot this year\b|\bafter this year\b|\bthis coming year\b|\b(?:beginning|start) of (?:the )?(?:next )?year\b/g, nextYear: true, label: "next year", spec: 2 },
    { re: /\b(?:once|when|after|until|till|til|as soon as) (?:the )?ground (?:freezes|is frozen|froze|gets hard|hardens|firms up)\b|\bfrozen ground\b/g, season: "winter", label: "once the ground freezes", spec: 5 },
    { re: /\bbefore (?:the )?ground (?:freezes|is frozen|froze)\b/g, label: "before the ground freezes", spec: 5, kind: "deadline" },
    { re: /\b(?:when|once|after|until|till|as soon as) (?:it|the weather|things|the ground|temperatures?|temps) (?:warms? up|gets warmer|get warmer|breaks|thaws?|dries out|dry out|dries up)\b|\b(?:when|once|after) the (?:snow|frost) (?:melts|is gone|thaws|goes|clears)\b|\bwarmer weather\b|\bwhen it thaws\b/g, season: "spring", label: "in spring", spec: 5 },
    { re: /\b(?:after|once|when|until) (?:the )?leaves (?:fall|drop|come down|are down|are off|have fallen|fell)\b/g, month: 11, day: 1, label: "after the leaves drop", spec: 5 },
    { re: /\btax (?:refund|return)\b|\bget (?:my|our) refund\b/g, month: 3, day: 1, label: "after tax refunds", spec: 3 },
    { re: /\b(?:after|past|once) tax (?:season|time|day)\b|\bafter taxes\b/g, month: 4, day: 20, label: "after tax season", spec: 3 },
    { re: /\b(?:end of (?:the |this )?year|year end|year-end)\b/g, month: 12, day: 1, label: "at year end", spec: 4 },
    { re: /\bnext season\b/g, season: "spring", label: "next season", spec: 4 },
  ];
  for (const f of fixed) {
    const re = f.re;
    re.lastIndex = 0;
    while ((m = re.exec(t))) {
      let date: ISODate | undefined;
      if (f.kind !== "deadline") {
        if (f.nextYear) date = `${yearOf(asOf) + 1}-01-15`;
        else if (f.season) date = seasonDate(f.season, "next", asOf);
        else if (f.month && f.day) date = nextOccurrence(asOf, f.month, f.day);
      }
      const pre = t.slice(Math.max(0, m.index - 12), m.index);
      const deadline = f.kind === "deadline" || /\b(before|by|ahead of|prior to)\s*$/.test(pre);
      pushExpr(out, {
        phrase: m[0].trim(), index: m.index, end: m.index + m[0].length,
        kind: deadline ? "deadline" : "defer",
        ...(date && !deadline ? { date, explicit: true } : {}),
        label: f.label, spec: f.spec,
      });
    }
  }

  // "in 2020-something"
  const yearRe = /\b(?:in|until|till|til|by|around|sometime in) (20\d\d)\b/g;
  while ((m = yearRe.exec(t))) {
    const y = Number(m[1]);
    if (y <= yearOf(asOf)) continue;
    pushExpr(out, { phrase: m[0], index: m.index, end: m.index + m[0].length, kind: "defer", date: `${y}-01-15`, label: `in ${y}`, spec: 2 });
  }

  // Relative: "in 3 weeks", "a few months", "a couple of weeks", "in a month or two"
  const relRe = /\b(?:(in|within|about|another|give (?:it|me|us)|wait|after|for|around|like|maybe|roughly|next|the next|over the next|another) )?(a few|few|a couple of|a couple|couple of|couple|several|an|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})(?:\s*(?:-|or|to)\s*(one|two|three|four|five|six|seven|eight|nine|ten|twelve|\d{1,2}))? (days?|weeks?|wks?|months?|mos?)\b(?: or (two|three|so))?(?! ago)/g;
  while ((m = relRe.exec(t))) {
    if (pastBefore(t, m.index)) continue;
    const prep = m[1] ?? "";
    const a = m[2] ?? "";
    const b = m[3] ?? m[5];
    let n = NUMBER_WORDS[a] ?? Number(a);
    if (b && b !== "so") n = Math.max(n, NUMBER_WORDS[b] ?? Number(b));
    if (!Number.isFinite(n) || n <= 0) continue;
    const unit = m[4] ?? "";
    if ((a === "a" || a === "an" || a === "one") && !prep && !b && /\b(?:once|twice|per|every|each|a)\s*$/.test(t.slice(Math.max(0, m.index - 8), m.index))) continue;
    let date: ISODate;
    if (unit.startsWith("d")) date = addDays(asOf, n);
    else if (unit.startsWith("w")) date = addDays(asOf, 7 * n);
    else date = n === 1 ? addDays(asOf, 30) : addMonths(asOf, n);
    const days = daysBetween(asOf, date);
    const words = m[0].replace(/^(?:give (?:it|me|us)|wait|about|like|maybe|roughly|around|for|within|after) /, "").trim();
    pushExpr(out, {
      phrase: m[0].trim(), index: m.index, end: m.index + m[0].length,
      kind: days < 14 && !/^(in|after|wait|give)/.test(prep) ? "near" : "defer",
      date, label: /^(in|next|the next|another)\b/.test(words) ? words : `in ${words}`, spec: 4,
    });
  }

  // "next week" / "next month"
  const nextRe = /\b(?:early |later |late |the end of |end of |the beginning of |beginning of |the following |following )?next (week|month)\b|\bthe following (week|month)\b/g;
  while ((m = nextRe.exec(t))) {
    const unit = m[1] ?? m[2] ?? "week";
    const date = unit === "week" ? addDays(asOf, 7) : addDays(asOf, 30);
    pushExpr(out, { phrase: m[0].trim(), index: m.index, end: m.index + m[0].length, kind: "defer", date, label: `next ${unit}`, spec: 3 });
  }

  // Deadlines: "before the snow", "by closing"
  const deadRe = /\b(?:before|by|ahead of|prior to) (?:the )?(?:snow(?: flies)?|cold(?: weather)?|it gets (?:cold|colder)|freeze|frost|first frost|storm season|hurricane season|closing|the sale|we sell|we list|listing|the party|the wedding|graduation|end of the (?:month|year)|end of (?:month|year)|the leaves fall|leaf season|the inspection|inspection|our closing|we move|the move)\b/g;
  while ((m = deadRe.exec(t))) {
    pushExpr(out, { phrase: m[0].trim(), index: m.index, end: m.index + m[0].length, kind: "deadline", label: m[0].trim(), spec: 3 });
  }

  // Near-term: "tomorrow", "this week", "asap"
  const nearRe = /\b(?:today|tonight|tomorrow|tmrw|tmw|this (?:week|weekend|afternoon|morning|evening|month)|next weekend|asap|right away|end of (?:the )?(?:week|month)|a day or two)\b/g;
  while ((m = nearRe.exec(t))) {
    pushExpr(out, { phrase: m[0].trim(), index: m.index, end: m.index + m[0].length, kind: "near", label: m[0].trim(), spec: 1 });
  }

  // Weekdays: "Friday", "next tuesday", "sat morning", "this thu", "by wed"
  const dayRe = /\b((?:(?:this|next|coming|last|past|on|by|before|until|till|til|thru|through|after) ){0,2})(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues|tue|weds|wed|thurs|thur|thu|fri|sat|sun|mon)\b\.?(?: (morning|afternoon|evening|night|am|pm)\b)?/g;
  while ((m = dayRe.exec(t))) {
    const pre = m[1] ?? "";
    const word = m[2] ?? "";
    // "sat", "sun", "wed" are ordinary words on their own: an abbreviation needs "this/next/on..." or "morning"
    if (!WEEKDAY_FULL.has(word) && !pre && !m[3]) continue;
    if (/\b(last|past)\b/.test(pre) || pastBefore(t, m.index)) {
      pushExpr(out, { phrase: m[0].trim(), index: m.index, end: m.index + m[0].length, kind: "past", label: "", spec: 0 });
      continue;
    }
    const date = weekdayDate(asOf, WEEKDAY_NUM[word.slice(0, 3)]!, /\bnext\b/.test(pre) ? "next" : /\bthis\b/.test(pre) ? "this" : "");
    const days = daysBetween(asOf, date);
    pushExpr(out, {
      ...(EXPLICIT_PREP.test(pre) ? { explicit: true } : {}),
      phrase: m[0].trim(), index: m.index, end: m.index + m[0].length,
      kind: DEADLINE_PREP.test(pre) ? "deadline" : days <= 7 ? "near" : "defer",
      date, label: `${/\bnext\b/.test(pre) ? "next" : "on"} ${DAY_FULL[weekday(date)]}`, spec: 5,
    });
  }

  // Day of month: "til the 15th", "after the 3rd"
  const domRe = /\b(until|till|til|after|by|on|before|around|past) the (\d{1,2})(?:st|nd|rd|th)\b/g;
  while ((m = domRe.exec(t))) {
    const dd = Number(m[2]);
    if (dd < 1 || dd > 31) continue;
    let y = yearOf(asOf);
    let mo = monthOf(asOf);
    let date = toISODate(y, mo, dd);
    if (!date || date <= asOf) {
      mo += 1;
      if (mo > 12) { mo = 1; y += 1; }
      date = toISODate(y, mo, dd);
    }
    if (!date) continue;
    const prep = m[1] ?? "";
    pushExpr(out, {
      phrase: m[0].trim(), index: m.index, end: m.index + m[0].length,
      kind: DEADLINE_PREP.test(prep) ? "deadline" : "defer",
      date, label: `after the ${m[2]}${m[0].replace(/^.*\d/, "")}`, spec: 5,
      ...(EXPLICIT_PREP.test(prep) ? { explicit: true } : {}),
    });
  }

  for (const e of out) {
    if (/\bnot\s*$/.test(t.slice(Math.max(0, e.index - 6), e.index)) && !/^(until|till|til|before|after)\b/.test(e.phrase)) e.negated = true;
  }
  return out.sort((x, y) => x.index - y.index);
}

/** The follow-up date to use: most specific deferral, earliest mention on ties. */
export function pickFollowUp(exprs: TimeExpr[], asOf: ISODate): TimeExpr | undefined {
  let best: TimeExpr | undefined;
  for (const e of exprs) {
    if (e.kind !== "defer" || !e.date || e.date <= asOf || e.negated) continue;
    if (!best || e.spec > best.spec) best = e;
  }
  return best;
}

export function fmtShortDate(d: ISODate): string {
  return `${MONTH_SHORT[monthOf(d) - 1]} ${Number(d.slice(8, 10))}`;
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

/** First real phone number in the reply (E.164, no extension). A placeholder like 555-555-5555 is skipped. */
export function extractPhone(text: string): string | undefined {
  return phonesInText(text)[0];
}

export function extractBestTime(t: string): string | undefined {
  const clock = /\b(after|past|around|before|between|from)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.|oclock|o clock)?(?:\s*(?:and|-|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)?)(?!\s*(?:\/|weeks?|months?|days?|years?|hours?|hrs?|min|minutes|th\b|st\b|nd\b|rd\b|%|ft|feet|inch|trees?|\$|\d))/.exec(t);
  if (clock) return `${clock[1]} ${(clock[2] ?? "").replace(/\s+/g, " ").trim()}`;
  const at = /\bat (\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/.exec(t);
  if (at) return `at ${(at[1] ?? "").replace(/\s+/g, "")}`;
  const phrase = /\b(after work|after school|after dinner|before work)\b/.exec(t);
  if (phrase) return phrase[1];
  if (/\b(?:lunch ?time|lunch break|on my lunch|at lunch|at noon|around noon)\b/.test(t)) return "lunchtime";
  if (/(?<!good )\bmornings?\b|\bin the am\b|\bearly (?:in the )?day\b/.test(t)) return "mornings";
  if (/(?<!good )\bafternoons?\b/.test(t)) return "afternoons";
  if (/(?<!good )\bevenings?\b|\bat night\b|\bnights\b|\btonight\b/.test(t)) return "evenings";
  if (/(?<!\b(?:this|next) )\bweekends?\b|\bsaturdays\b|\bsundays\b|\bon the weekend\b/.test(t)) return "weekends";
  if (/\bweekdays?\b|\bduring the week\b/.test(t)) return "weekdays";
  if (/\b(?:any ?time|all day|any day|whenever)\b/.test(t)) return "anytime";
  return undefined;
}

function sentenceSpans(t: string): { s: string; start: number; end: number }[] {
  const out: { s: string; start: number; end: number }[] = [];
  let from = 0;
  for (const s of splitSentences(t)) {
    const start = t.indexOf(s, from);
    const at = start >= 0 ? start : from;
    out.push({ s, start: at, end: at + s.length });
    from = at + s.length;
  }
  return out;
}

function isInterrogative(s: string): boolean {
  if (/\?\s*$/.test(s) || /\?/.test(s)) return true;
  if (QUESTION_PATS.some((p) => p.strong && p.re.test(s))) return true;
  const m = INTERROGATIVE_START.exec(s);
  if (!m) return false;
  const words = s.split(/\s+/);
  return words.length >= 3 && /^(you|u|it|this|that|there|the|your|we|i|they|yall|he|she|anyone|someone|my|our)$/.test(words[1] ?? "");
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

const MAX_SUMMARY = 69;

function fit(candidates: string[]): string {
  for (const c of candidates) if (c.length <= MAX_SUMMARY) return c;
  const last = candidates[candidates.length - 1] ?? "";
  return last.length <= MAX_SUMMARY ? last : last.slice(0, MAX_SUMMARY - 3).replace(/\s+\S*$/, "") + "...";
}

function callPhrase(bestTime: string | undefined, phone: string | undefined): string | undefined {
  const when = bestTime === "lunchtime" ? "at lunch" : bestTime;
  if (phone && when) return `call ${fmtPhone(phone)} ${when}`;
  if (phone) return `call ${fmtPhone(phone)}`;
  if (when) return `call ${when}`;
  return undefined;
}

function quoteQuestion(q: string): string {
  const prefix = 'Question: "';
  const room = MAX_SUMMARY - prefix.length - 1;
  let body = q.replace(/\s+/g, " ").trim();
  if (body.length > room) body = body.slice(0, room - 3).replace(/\s+\S*$/, "") + "...";
  return `${prefix}${body}"`;
}

interface SummaryCtx {
  extracted: ReplyExtract;
  question?: string;
  hasQuestion: boolean;
  priceAsk: boolean;
  priceInvite: boolean;
  sameCheck: boolean;
  follow?: TimeExpr;
  priceObjection: boolean;
  diy: boolean;
  sensitive: boolean;
  weakAuto: boolean;
}

function summarize(intent: ReplyIntent, c: SummaryCtx): string {
  const x = c.extracted;
  const call = callPhrase(x.bestTime, x.phone);
  switch (intent) {
    case "wants_it": {
      const head = x.urgency === "high" ? "Urgent: wants it done" : "Wants it done";
      const tf = x.timeframe && !/^(asap|right away)$/.test(x.timeframe) ? ` ${x.timeframe}` : x.timeframe ? " ASAP" : "";
      const qp = c.hasQuestion ? "; has a question" : c.priceAsk ? "; asked about price" : "";
      const tail = call ? ` — ${call}.` : ".";
      return fit([
        `${head}${tf}${qp}${tail}`,
        `${head}${qp}${tail}`,
        `${head}${tf}${qp}.`,
        `${head}${tail}`,
        `${head}${qp}.`,
        `${head}.`,
      ]);
    }
    case "wants_price": {
      const head = c.priceInvite
        ? x.mentionsCompetitor
          ? "Wants a better price (has another quote)"
          : "Asked for a better price"
        : c.sameCheck
          ? "Asked if the old price still stands"
          : "Asked for an updated price";
      return fit([call ? `${head} — ${call}.` : `${head}.`, `${head}.`]);
    }
    case "question":
      return c.question ? fit([quoteQuestion(c.question), "Has a question — please reply."]) : "Has a question — please reply.";
    case "later": {
      const f = c.follow;
      if (f?.date) return fit([`Try again ${f.label} (${fmtShortDate(f.date)}).`, `Try again ${fmtShortDate(f.date)}.`]);
      return "Not now — follow up later.";
    }
    case "already_done":
      if (x.mentionsCompetitor) return "Already done — went with someone else.";
      if (c.diy) return "Already done — did it themselves.";
      return "Already taken care of — closed out.";
    case "not_interested":
      if (c.priceObjection) return "Not interested — said the price is too high.";
      return "Not interested — closed out.";
    case "moved":
      return c.sensitive ? "Owner passed away or moved — handle with care." : "Moved / sold the house — closed out.";
    case "wrong_person":
      return "Wrong person — removed from list.";
    case "stop":
      return "Asked to stop — removed.";
    case "complaint":
      return "Complaint — removed. Read and reply personally.";
    case "auto_reply":
      return c.weakAuto ? "Looks like an away message — please check." : "Auto-reply (out of office) — no action.";
    case "bounce":
      return "Email bounced — bad address, removed.";
    case "unclear":
      return "Unclear reply — please read it.";
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const THUMBS_UP = /(?:\u{1F44D}|\u{1F44C}|✅|✔️?|☑️?|\u{1F64C}|\u{1F4AF}|\u{1F91D})/u;
const THUMBS_DOWN = /\u{1F44E}/u;
const UNCERTAIN = /\b(?:not sure|unsure|i think|might|possibly|perhaps|probably|not certain|thinking about|considering|on the fence)\b/;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function readReply(input: ReadReplyInput): ReplyReading {
  const asOf = input.asOf;
  const subject = input.subject ?? "";
  const from = input.from ?? "";
  const raw = input.text ?? "";
  const cleaned = cleanReplyText(raw);
  const subjNorm = normalizeForMatch(subject);
  const subjCore = subjNorm.replace(/^(?:\s*(?:re|fw|fwd|aw|sv)\s*:\s*)+/, "").trim();
  const isReplySubject = /^\s*(?:re|fw|fwd|aw|sv)\s*:/i.test(subject);
  const body = cleaned || (subject && !isReplySubject ? subject.trim() : "");
  const t = stripLead(normalizeForMatch(body));
  const rawNorm = normalizeForMatch(raw);

  const signals: string[] = [];
  const negated: string[] = [];
  const hits: Hit[] = [];
  const push = (h: Hit) => hits.push(h);
  const run = (intent: ReplyIntent, pats: Pat[]) => hits.push(...runPatterns(t, pats, intent, negated));
  const flag = (intent: ReplyIntent, label: string, strong: boolean, index = 0, extra: Partial<Hit> = {}) =>
    push({ intent, label, strong, index, end: index, ...extra });

  /* ---- machine-generated mail ---- */
  let bounceWhy: string | undefined;
  if (BOUNCE_FROM.test(from)) bounceWhy = "from mailer-daemon";
  else if (BOUNCE_SUBJECT.test(subject)) bounceWhy = "delivery-failure subject";
  else {
    const bm = BOUNCE_BODY.exec(rawNorm);
    if (bm) bounceWhy = `body: ${bm[0]}`;
  }
  const autoSubject = AUTO_SUBJECT.test(subject);
  const noReplyFrom = /\b(?:no-?reply|do-?not-?reply|donotreply)\b/i.test(from);

  /* ---- pattern hits ---- */
  run("stop", STOP_PATS);
  const spans = sentenceSpans(t);
  for (const sp of spans) if (STOP_SENTENCE.test(sp.s)) flag("stop", "stop", true, sp.start, { end: sp.end });
  if (/\bSTOP\b(?! BY| OVER| IN\b| OUT\b| AT\b| ON\b)/.test(body)) flag("stop", "STOP in caps", true);
  if (/\b(?:unsubscribe|remove me|opt[- ]?out)\b/.test(subjCore) || /^stop\b/.test(subjCore)) flag("stop", "subject", true);
  run("complaint", COMPLAINT_PATS);
  run("auto_reply", AUTO_PATS);
  if (noReplyFrom) flag("auto_reply", "no-reply sender", false);
  run("wrong_person", WRONG_PATS);
  if (WHO_IS_NAME.test(t)) flag("wrong_person", "who is <name>?", true, 0, { end: t.length });
  run("moved", MOVED_PATS);
  run("already_done", DONE_PATS);
  run("not_interested", NOT_INTERESTED_PATS);
  if (BARE_NO.test(t)) flag("not_interested", "no", true);
  else if (LEAD_NO.test(t)) flag("not_interested", "leading no", false);
  if (THUMBS_DOWN.test(body)) flag("not_interested", "thumbs down", !t.replace(/[^a-z]/g, ""));
  run("later", LATER_PATS);
  run("wants_price", WANTS_PRICE_PATS);
  const inviteM = PRICE_INVITE.exec(t);
  const priceInvite = !!inviteM && !negatedBefore(t, inviteM.index) && !/\b(?:went with|hired|chose|going with)\b[^.!?\n]{0,30}$/.test(t.slice(0, inviteM.index));
  if (priceInvite && inviteM) flag("wants_price", "price invite", true, inviteM.index, { end: inviteM.index + inviteM[0].length });
  run("wants_it", WANTS_IT_PATS);
  if (THUMBS_UP.test(body)) flag("wants_it", "thumbs up", false);

  /* ---- time ---- */
  const exprs = findTimeExpressions(t, asOf);
  for (const e of exprs) if (e.kind !== "past") signals.push(`time:${e.phrase}${e.date ? `=${e.date}` : ""}${e.kind !== "defer" ? `(${e.kind})` : ""}`);
  const follow = pickFollowUp(exprs, asOf);
  const followDays = follow?.date ? daysBetween(asOf, follow.date) : undefined;
  const farEnough = follow && followDays !== undefined && (followDays >= 21 || follow.explicit === true);
  if (farEnough && follow) flag("later", `time:${follow.label}`, false, follow.index);
  else if (exprs.some((e) => e.kind === "near" || e.kind === "deadline" || (e.kind === "defer" && e.date && daysBetween(asOf, e.date) < 21))) flag("wants_it", "time:soon", false);

  /* ---- urgency ---- */
  const urgNeg: string[] = [];
  const urgentHit = findHit(t, { re: URGENT_HIGH, label: "urgent", strong: true, neg: true }, "wants_it", urgNeg);
  if (urgentHit) flag("wants_it", "urgent problem", false, urgentHit.index);

  /* ---- questions ---- */
  const consumes = (h: Hit) => h.strong || h.intent === "wrong_person" || h.intent === "complaint" || h.intent === "moved" || h.intent === "auto_reply";
  const realQuestions = spans.filter(
    (sp) => isInterrogative(sp.s) && !hits.some((h) => consumes(h) && h.index >= sp.start && h.index < sp.end && h.end > h.index),
  );
  const q = realQuestions.length > 0;
  const questionText = q ? originalSentence(cleaned || body, realQuestions[0]!.s) : undefined;

  /* ---- resolve ---- */
  const S = (i: ReplyIntent) => hits.some((h) => h.intent === i && h.strong);
  const W = (i: ReplyIntent) => hits.some((h) => h.intent === i && !h.strong);
  const A = (i: ReplyIntent) => hits.some((h) => h.intent === i);
  const rules: string[] = [];
  let intent: ReplyIntent = "unclear";
  let conf = 0.3;

  const niStrong = hits.filter((h) => h.intent === "not_interested" && h.strong);
  const positiveInterest = hits.some((h) => h.intent === "wants_it" && /still interested|still need it|interested/.test(h.label));
  const wantsItS = S("wants_it");
  const wantsPriceS = S("wants_price");
  const commit = hits.some((h) => h.intent === "wants_it" && h.strong && h.commit);
  const laterStrong = S("later");
  const hasDate = !!follow?.date;

  if (bounceWhy) {
    intent = "bounce";
    conf = bounceWhy.startsWith("body") ? 0.9 : 0.98;
    rules.push("machine mail recognized before human intents");
  } else if (S("complaint")) {
    intent = "complaint";
    conf = 0.9;
    if (S("stop")) rules.push("complaint + stop: complaint (suppress and escalate)");
  } else if (S("stop")) {
    if (W("complaint")) {
      intent = "complaint";
      conf = 0.85;
      rules.push("stop with annoyance: complaint (suppress and escalate)");
    } else {
      intent = "stop";
      conf = 0.97;
    }
    if (A("wants_it") || A("wants_price") || A("later")) rules.push("stop beats every other intent");
  } else if (autoSubject || S("auto_reply")) {
    intent = "auto_reply";
    conf = autoSubject && S("auto_reply") ? 0.98 : 0.92;
  } else if (S("moved")) {
    intent = "moved";
    conf = 0.9;
  } else if (S("wrong_person")) {
    intent = "wrong_person";
    conf = 0.9;
  } else if (S("already_done") || niStrong.length > 0) {
    const onlyPrice = !S("already_done") && niStrong.length > 0 && niStrong.every((h) => h.price);
    const soft = !S("already_done") && niStrong.every((h) => !h.hard);
    const butAt = t.search(/\bbut\b/);
    const butRule =
      !S("already_done") && butAt > 0 && niStrong.every((h) => h.index < butAt) &&
      hits.some((h) => h.intent === "wants_it" && h.strong && h.index > butAt);
    if (onlyPrice && (priceInvite || positiveInterest)) {
      intent = "wants_price";
      conf = 0.8;
      rules.push("price objection that invites a lower number: wants_price");
    } else if (butRule && !(laterStrong || farEnough)) {
      intent = "wants_it";
      conf = 0.7;
      rules.push("'not X, but still want Y': wants_it");
    } else if (soft && (laterStrong || farEnough)) {
      intent = "later";
      conf = hasDate ? 0.8 : 0.72;
      rules.push("soft no with a future time: later");
    } else if (W("complaint")) {
      intent = "complaint";
      conf = 0.7;
      rules.push("no with annoyance: complaint");
    } else if (S("already_done")) {
      intent = "already_done";
      conf = 0.88;
    } else {
      intent = "not_interested";
      conf = niStrong.some((h) => h.label === "no") ? 0.8 : 0.9;
    }
  } else if (laterStrong) {
    if (!hasDate && wantsPriceS) {
      intent = "wants_price";
      conf = 0.8;
      rules.push("vague 'not now' + explicit price request: wants_price");
    } else if (!hasDate && wantsItS) {
      intent = "wants_it";
      conf = 0.65;
      rules.push("vague 'not now' + explicit ask to act: wants_it");
    } else if (hasDate && followDays !== undefined && followDays <= 14 && wantsItS) {
      intent = "wants_it";
      conf = 0.75;
      rules.push("near date + ask to act: wants_it");
    } else {
      intent = "later";
      conf = hasDate ? 0.9 : 0.8;
    }
  } else if (hasDate && farEnough && followDays !== undefined) {
    if (wantsPriceS) {
      intent = "wants_price";
      conf = 0.8;
    } else if (q && !wantsItS) {
      intent = "question";
      conf = 0.75;
    } else if (wantsItS && followDays <= 45) {
      intent = "wants_it";
      conf = 0.8;
      rules.push("wants it within ~6 weeks: wants_it with timeframe");
    } else {
      intent = "later";
      conf = 0.85;
      if (A("wants_it")) rules.push("yes, but far out: later");
    }
  } else if (wantsItS && (commit || !wantsPriceS)) {
    intent = "wants_it";
    conf = 0.9;
  } else if (wantsPriceS) {
    intent = "wants_price";
    conf = 0.9;
  } else if (q) {
    if (A("wants_it") && !W("wrong_person")) {
      intent = "wants_it";
      conf = 0.75;
      rules.push("yes + question: wants_it, needs a person");
    } else {
      intent = "question";
      conf = 0.8;
    }
  } else if (W("complaint")) {
    intent = "complaint";
    conf = 0.6;
  } else if (W("auto_reply")) {
    intent = "auto_reply";
    conf = 0.55;
  } else if (W("moved")) {
    intent = "moved";
    conf = 0.65;
  } else if (W("wrong_person")) {
    intent = "wrong_person";
    conf = 0.65;
  } else if (W("already_done")) {
    intent = "already_done";
    conf = 0.65;
  } else if (W("not_interested")) {
    intent = "not_interested";
    conf = 0.65;
  } else if (W("later")) {
    intent = "later";
    conf = hasDate ? 0.75 : 0.6;
  } else if (W("wants_it")) {
    intent = "wants_it";
    const weakConf: Record<string, number> = { yes: 0.85, sure: 0.8, interested: 0.8, "when?": 0.75, please: 0.7, "thumbs up": 0.7, "urgent problem": 0.7, ok: 0.65, "time:soon": 0.6 };
    conf = Math.max(...hits.filter((h) => h.intent === "wants_it").map((h) => weakConf[h.label] ?? 0.65));
  } else if (!t) {
    conf = 0.2;
  }

  /* ---- confidence adjustments ---- */
  const leadIntent = intent === "wants_it" || intent === "wants_price" || intent === "later" || intent === "question";
  if (leadIntent || intent === "already_done" || intent === "not_interested") {
    const others = new Set(hits.filter((h) => h.strong && h.intent !== intent && h.intent !== "question").map((h) => h.intent));
    // Overrides the resolution rules intended (e.g. wants_it inside later) cost less than real contradictions.
    const penalty = Math.min(0.15, others.size * 0.05);
    conf -= penalty;
    if ((intent === "wants_it" || intent === "wants_price") && UNCERTAIN.test(t)) conf -= 0.1;
    if (intent === "wants_it" && W("not_interested")) conf -= 0.05;
  }
  conf = round2(Math.max(0.05, Math.min(0.99, conf)));

  /* ---- extraction ---- */
  const extracted: ReplyExtract = {};
  const phone = extractPhone(cleaned || body);
  if (phone) extracted.phone = phone;
  const lead = leadIntent || intent === "unclear";
  const bestTime = lead ? extractBestTime(t) : undefined;
  if (bestTime) extracted.bestTime = bestTime;
  const tf = exprs.find((e) => e.kind !== "past" && !e.negated);
  if (tf && intent !== "bounce" && intent !== "auto_reply") extracted.timeframe = tf.phrase;
  const priceObjection = hits.some((h) => h.price);
  const priceAsk = A("wants_price");
  if (PRICE_WORDS.test(t) || priceAsk || priceObjection) extracted.mentionsPrice = true;
  if (COMPETITOR.test(t)) extracted.mentionsCompetitor = true;
  if (urgentHit) extracted.urgency = "high";
  else if (URGENT_LOW.test(t)) extracted.urgency = "low";
  else if (intent === "later") extracted.urgency = "low";
  else if (intent === "wants_it" || intent === "wants_price" || intent === "question") extracted.urgency = "normal";
  if (intent === "later" && follow?.date) extracted.followUpOn = follow.date;

  /* ---- human review ---- */
  const sensitive = hits.some((h) => h.label === "owner passed / care home");
  const needsHuman =
    intent === "question" ||
    intent === "complaint" ||
    intent === "unclear" ||
    conf < 0.6 ||
    (intent === "wants_it" && q) ||
    (leadIntent && q) ||
    sensitive;

  /* ---- signals ---- */
  for (const h of hits) signals.push(`${h.intent}:${h.label}${h.strong ? "" : "(weak)"}`);
  if (bounceWhy) signals.push(`bounce:${bounceWhy}`);
  if (autoSubject) signals.push("auto_reply:subject");
  for (const n of negated) signals.push(`negated:${n}`);
  for (const r of realQuestions) signals.push(`question:${r.s}`);
  for (const r of rules) signals.push(`rule:${r}`);
  if (sensitive) signals.push("sensitive:bereavement or care home");
  if (!cleaned && raw.trim()) signals.push("clean:nothing left after removing quotes/signature");

  const summary = summarize(intent, {
    extracted,
    ...(questionText ? { question: questionText } : {}),
    hasQuestion: q,
    priceAsk,
    priceInvite,
    sameCheck: hits.some((h) => h.label === "same price?"),
    ...(follow ? { follow } : {}),
    priceObjection,
    diy: hits.some((h) => /did it ourselves|doing it themselves/.test(h.label)),
    sensitive,
    weakAuto: intent === "auto_reply" && !autoSubject && !S("auto_reply"),
  });

  return { intent, confidence: conf, extracted, signals: [...new Set(signals)], cleaned, needsHuman, summary };
}

/** Find the original-case sentence that normalizes to `norm` (for quoting a question to the owner). */
function originalSentence(text: string, norm: string): string {
  for (const s of splitSentences(text)) {
    const n = stripLead(normalizeForMatch(s));
    if (n === norm || n.includes(norm) || norm.includes(n)) {
      const lead = s.length - stripLeadOriginal(s).length;
      return s.slice(lead).trim() || s.trim();
    }
  }
  return norm;
}

function stripLeadOriginal(s: string): string {
  return s.replace(/^(hi|hello|hey|hiya|good (morning|afternoon|evening))\b[^,.!?:-]{0,30}[,.!:-]+\s*/i, "");
}
