import type { BreakageType, MessageAngle } from "../model.ts";

/**
 * The note library. Written the way a person at a small trade company writes:
 * short, plain, specific to the job, one easy question, no links, no exclamation marks.
 *
 * Tokens: {first} {signer} {company} {job} {when} {priceClause} {freshLook} {street} {streetName} {city}
 *         {crewLine} {worse} {timingLine} {interval} {service} {mainJob} {option} {why}
 *         {years} {number} {balance} {ownerFirst} {phoneLine} {freeLook}
 * Season: {inSeason} (the work is in season on the send day), {seasonMonth} (else, the month it's back),
 *         {nearTerm} / {held} (strict-season work out of season never gets a near-term slot), {waitLine},
 *         {dueAsk} (the question for seasonal work that comes back every year; it replaces {interval}).
 * Next jobs: {ask} (the follow-on's own question, "Want it on a regular schedule?") or {noAsk} (it has none).
 * Regulars: {quietSince} ("September 5": a regular who just missed their usual visit) or {notRecent}.
 * Lines that end up empty after rendering are dropped.
 */
export interface NoteTemplate {
  id: string;
  angle: MessageAngle;
  subject: string;
  body: string;
  /** Only use when these tokens resolved to something. */
  needs?: string[];
}

export interface StepPlan {
  step: number;
  /** Days after the first note. */
  day: number;
  /** Candidate angles in order of preference; the first whose needs are met wins. */
  angles: MessageAngle[];
}

const CLOSE_QUESTION = "If you don't mind me asking, was it timing, price, or did you go with someone else? One word back helps us a lot.";

export const TEMPLATES: Record<string, NoteTemplate[]> = {
  /* ------------------------ dead quotes ------------------------ */
  "quote.check_in": [
    {
      id: "q1a",
      angle: "check_in",
      subject: "{job}",
      // someone we've written to before gets another opener
      needs: ["neverFollowed"],
      body: "Hi {first},\n\nIt's {signer} at {company}. You got a price from us {when} for {job}{priceClause}.\n\nWe never heard back. Is it still something you want done?\n\n{freshLook}\n\nIf you went another way, that's fine. Just reply \"pass\" and I'll close it out.\n\n{signer}",
    },
    {
      id: "q1b",
      angle: "check_in",
      subject: "{job} on {streetName}",
      needs: ["streetName"],
      body: "Hi {first},\n\n{signer} here from {company}. I'm going back through quotes we never closed out, and yours for {job} {when} is one of them.\n\nStill need it done, or did you get it taken care of?\n\n{freshLook}\n\n{signer}",
    },
    {
      id: "q1c",
      angle: "check_in",
      subject: "{job}",
      body: "Hi {first},\n\nThis is {signer} with {company}. We priced {job} for you {when}{priceClause}. Did you still want us to take care of that?\n\n{freshLook}\n\nIf not, just reply \"pass\" and I'll close it out.\n\n{signer}",
    },
  ],
  "quote.problem_grows": [
    {
      id: "q2p",
      angle: "problem_grows",
      subject: "Re: {job}",
      needs: ["worse"],
      body: "{first}, one thing worth knowing about {job}: {worse}\n\nIf you'd like us to take another look first, just reply and we'll set it up.{freeLook}\n\n{signer}",
    },
  ],
  "quote.timing": [
    {
      id: "q2t",
      angle: "timing",
      subject: "Re: {job}",
      needs: ["timingLine", "inSeason"],
      body: "{first}, {timingLine}\n\nIf you'd like {job} taken care of, reply with a day or two that work and we'll get you on the schedule.\n\n{signer}",
    },
    {
      // out of season: book ahead, never "reply with a day"
      id: "q2tp",
      angle: "timing",
      subject: "Re: {job}",
      needs: ["timingLine", "seasonMonth"],
      body: "{first}, {timingLine}\n\nIf you'd still like {job} done, want me to put you down for the first open week in {seasonMonth}?\n\n{signer}",
    },
  ],
  "quote.crew_nearby": [
    {
      id: "q2c",
      angle: "crew_nearby",
      subject: "Re: {job}",
      needs: ["crewLine"],
      body: "{first}, {crewLine} Happy to take care of {job} while we're over your way.\n\nWant me to put you down?\n\n{signer}",
    },
  ],
  "quote.easy_yes": [
    {
      id: "q2e",
      angle: "easy_yes",
      subject: "Re: {job}",
      needs: ["bigJob", "nearTerm"],
      body: "{first}, if the timing's better now for {job}, just reply \"yes\" and I'll have someone reach out to set a date.\n\nIf it was the price, say so. There's usually another way to do it, like splitting it into two visits or doing the most important part first.\n\n{signer}",
    },
    {
      id: "q2e2",
      angle: "easy_yes",
      subject: "Re: {job}",
      needs: ["nearTerm"],
      body: "{first}, if the timing's better now for {job}, just reply \"yes\" and I'll have someone reach out to set a date.\n\nNo pressure either way.\n\n{signer}",
    },
  ],
  "quote.close_file": [
    {
      id: "q3",
      angle: "close_file",
      subject: "Re: {job}",
      body: `Last note from me on this, {first}. If you've already taken care of {job}, no need to reply. If it's still on your list, reply and we'll get you a date.\n\n${CLOSE_QUESTION}\n\n{signer}`,
    },
  ],

  /* ------------------------ fresh quotes (always-on) ------------------------ */
  // A quote that went out in the last few weeks. Nobody has dropped the ball yet — this is the follow-up
  // owners mean to do and don't: make sure it landed, answer questions, give an easy yes, then close it out.
  "fresh.check_in": [
    {
      id: "f1a",
      angle: "check_in",
      subject: "{job}",
      body: "Hi {first},\n\nIt's {signer} at {company}. Just making sure the quote for {job} came through okay.\n\nAny questions on it, or anything you'd like changed? Happy to go over it on the phone too.\n\n{signer}",
    },
    {
      id: "f1b",
      angle: "check_in",
      subject: "{job}",
      body: "Hi {first},\n\n{signer} here from {company}. Wanted to check that the quote for {job} landed and made sense.\n\nIf anything's unclear, or you'd like it done a little differently, just reply and I'll sort it out.\n\n{signer}",
    },
  ],
  "fresh.easy_yes": [
    {
      id: "f2e",
      angle: "easy_yes",
      subject: "Re: {job}",
      needs: ["nearTerm"],
      body: "{first}, any thoughts on the quote for {job}?\n\nIf you'd like to go ahead, just reply \"yes\" and I'll get you on the schedule. If something doesn't fit, tell me and I'll rework it.\n\n{signer}",
    },
  ],
  // The last note asks for an answer either way, and offers another option in the same breath: a fresh
  // quote that goes unanswered is usually the price, the timing or the scope, and "no" closes the file.
  "fresh.close_file": [
    {
      id: "f3o",
      angle: "close_file",
      subject: "Re: {job}",
      needs: ["bigJob"],
      body: "{first}, last note from me on {job}.\n\nIf the number is the sticking point, there's usually another way to do it, like splitting it into two visits or doing the most important part first. Tell me what would work and I'll price it that way.\n\nIf you've gone another way, no problem. A one-word reply lets me close it out.\n\n{signer}",
    },
    {
      id: "f3r",
      angle: "close_file",
      subject: "Re: {job}",
      body: "{first}, last note from me on {job}.\n\nIf something about it isn't working, like the price, the timing or part of the work, tell me and I'll put together another option. If you've gone another way, that's fine too. One line back lets me close it out.\n\n{signer}",
    },
  ],

  /* ------------------------ changes requested ------------------------ */
  "changes.check_in": [
    {
      id: "c1",
      angle: "check_in",
      subject: "your revised quote for {job}",
      body: "Hi {first},\n\nIt's {signer} at {company}. You asked us for some changes on the quote for {job} {when}, and I don't think we ever got you the revised version. That's on us.\n\nDo you still want it? Tell me what you'd like changed.\n\n{signer}",
    },
  ],
  "changes.revise": [
    {
      id: "c2",
      angle: "revise",
      subject: "Re: your revised quote for {job}",
      needs: ["bigJob"],
      body: "{first}, if it helps, we can split {job} into two visits or trim it back to the part that matters most right now.\n\nReply and tell me what you're thinking, and I'll price it that way.\n\n{signer}",
    },
    {
      id: "c2b",
      angle: "revise",
      subject: "Re: your revised quote for {job}",
      body: "{first}, if something in the quote for {job} didn't fit, like the timing or part of the work, tell me and I'll rework it.\n\nOne line back is plenty.\n\n{signer}",
    },
  ],

  /* ------------------------ said yes, never scheduled ------------------------ */
  "approved.check_in": [
    {
      id: "a1",
      angle: "schedule",
      subject: "getting {job} on the schedule",
      needs: ["nearTerm"],
      body: "Hi {first},\n\n{signer} at {company}. You gave us the go-ahead on {job} {when}, and it looks like it never made it onto the schedule. I'm sorry about that.\n\nAre you still wanting it done? Reply with a couple of days that work and I'll lock one in.\n\n{signer}",
    },
    {
      id: "a1h",
      angle: "schedule",
      subject: "getting {job} on the schedule",
      needs: ["held"],
      body: "Hi {first},\n\n{signer} at {company}. You gave us the go-ahead on {job} {when}, and it looks like it never made it onto the schedule. I'm sorry about that.\n\n{waitLine} If you still want it done, want me to put you down for the first open week in {seasonMonth}?\n\n{signer}",
    },
  ],
  "approved.schedule": [
    {
      id: "a2",
      angle: "schedule",
      subject: "Re: getting {job} on the schedule",
      needs: ["nearTerm"],
      body: "{first}, checking back on {job}. Want me to get it on the schedule?\n\n{signer}",
    },
    {
      id: "a2h",
      angle: "schedule",
      subject: "Re: getting {job} on the schedule",
      needs: ["held"],
      body: "{first}, checking back on {job}. It has to wait until {seasonMonth}, but I can hold you a spot now. Want one?\n\n{signer}",
    },
  ],
  "approved.close_file": [
    {
      id: "a3",
      angle: "close_file",
      subject: "Re: getting {job} on the schedule",
      body: "{first}, I'll stop bugging you about {job}. If you still want it, reply any time and we'll put you on the calendar.\n\n{signer}",
    },
  ],

  /* ------------------------ never quoted ------------------------ */
  "request.check_in": [
    {
      id: "r1",
      angle: "check_in",
      subject: "your quote for {job}",
      body: "Hi {first},\n\nIt's {signer} at {company}. You reached out {when} about {job}, and we never got you a price. That's on us.\n\nIs it still something you need? If so, reply and I'll get you a quote, usually within a couple of days.\n\n{signer}",
    },
  ],
  // They never got a price, so nothing here asks about "the price" or books the work itself.
  "request.timing": [
    {
      id: "r2t",
      angle: "timing",
      subject: "Re: your quote for {job}",
      needs: ["timingLine", "inSeason"],
      body: "{first}, {timingLine}\n\nIf you'd still like a price on {job}, reply with a day or two that work and we'll come take a look.\n\n{signer}",
    },
  ],
  "request.easy_yes": [
    {
      id: "r2e",
      angle: "easy_yes",
      subject: "Re: your quote for {job}",
      body: "{first}, if you'd still like a price on {job}, just reply \"yes\" and I'll have someone reach out to set up a time to take a look.\n\nNo pressure either way.\n\n{signer}",
    },
  ],
  "request.close_file": [
    {
      id: "r3",
      angle: "close_file",
      subject: "Re: your quote for {job}",
      body: "Last note from me on this, {first}. If you've already got {job} taken care of, no need to reply. If not, reply and I'll get you a price.\n\n{signer}",
    },
  ],

  /* ------------------------ add-ons passed on ------------------------ */
  "option.check_in": [
    {
      id: "o1",
      angle: "next_step",
      subject: "{option}",
      needs: ["nearTerm"],
      body: "Hi {first},\n\nIt's {signer} at {company}. When we took care of {mainJob} {when}, you passed on {option}, which made sense at the time.\n\nIf you'd like it done now, we can usually fit it in while a crew's in your area. Want me to set it up?\n\n{signer}",
    },
    {
      id: "o1h",
      angle: "next_step",
      subject: "{option}",
      needs: ["held"],
      body: "Hi {first},\n\nIt's {signer} at {company}. When we took care of {mainJob} {when}, you passed on {option}, which made sense at the time.\n\n{waitLine} If you'd like it done, want me to put you down for the first open week in {seasonMonth}?\n\n{signer}",
    },
  ],
  // About the add-on they passed on, never the job we already did.
  "option.close_file": [
    {
      id: "o2",
      angle: "close_file",
      subject: "Re: {option}",
      body: "Last note from me on {option}, {first}. If you'd still like it done, reply any time and we'll get it on the calendar. If not, no need to reply.\n\n{signer}",
    },
  ],

  /* ------------------------ said no ------------------------ */
  "declined.check_in": [
    {
      id: "d1",
      angle: "check_in",
      subject: "{job}",
      body: "Hi {first},\n\n{signer} at {company}. You went a different way on {job} {when}, and that's completely fine.\n\nIf it never got done, or the timing works better now, we'd be glad to help. If not, no reply needed.\n\n{signer}",
    },
  ],

  /* ------------------------ past customers ------------------------ */
  "past.check_in": [
    {
      id: "p1",
      angle: "check_in",
      subject: "{job}",
      needs: ["streetName"],
      body: "Hi {first},\n\nIt's {signer} at {company}. We took care of {job} for you {when} on {streetName}. It's been about {years}.\n\nIs there anything around the place you've been meaning to get to? Happy to swing by and take a look.{freeLook}\n\n{signer}",
    },
    {
      id: "p1b",
      angle: "check_in",
      subject: "checking in from {company}",
      body: "Hi {first},\n\nIt's {signer} at {company}. We took care of {job} for you {when}.\n\nIf there's anything on your list this season, reply and we'll get you a price.\n\n{signer}",
    },
  ],
  "past.timing": [
    {
      id: "p2",
      angle: "timing",
      subject: "Re: {job}",
      needs: ["timingLine", "streetName"],
      body: "{first}, {timingLine}\n\nIf there's anything you'd like looked at, reply and we'll come by while we're in the area.\n\n{signer}",
    },
    {
      // no street on file: stays in the thread opened by "checking in from {company}"
      id: "p2b",
      angle: "timing",
      subject: "Re: checking in from {company}",
      needs: ["timingLine"],
      body: "{first}, {timingLine}\n\nIf there's anything you'd like looked at, just reply and we'll set it up.\n\n{signer}",
    },
  ],
  "past.close_file": [
    {
      id: "p3",
      angle: "close_file",
      subject: "Re: {job}",
      needs: ["streetName"],
      body: "Last one from me, {first}. If everything's in good shape, no reply needed. If not, reply and we'll get you a date.\n\n{signer}",
    },
    {
      id: "p3b",
      angle: "close_file",
      subject: "Re: checking in from {company}",
      body: "Last one from me, {first}. If everything's in good shape, no reply needed. If not, reply and we'll get you a date.\n\n{signer}",
    },
  ],

  "regular.check_in": [
    {
      id: "g1",
      angle: "check_in",
      subject: "{job}",
      needs: ["notRecent"],
      body: "Hi {first},\n\n{signer} at {company}. We used to take care of {job} for you, and the last time was {when}. We'd love to have you back on the schedule.\n\nWant me to save you a spot? Just reply and I'll set it up.\n\n{signer}",
    },
    {
      // a regular who just missed their usual visit (cleaning at three weeks): not "we used to", just the ask back
      id: "g1r",
      angle: "check_in",
      subject: "{job}",
      needs: ["quietSince"],
      body: "Hi {first},\n\n{signer} at {company}. We haven't been by for {job} since {quietSince}, and I wanted to make sure you're all set.\n\nWant us back on your usual schedule? Reply with a day that works and I'll put you back on.\n\n{signer}",
    },
  ],
  "regular.close_file": [
    {
      id: "g3",
      angle: "close_file",
      subject: "Re: {job}",
      // no hint that something went wrong: most people just had no more work
      body: "{first}, if you're all set, no reply needed. If you'd like us back for {job}, just reply and I'll hold you a spot.\n\n{signer}",
    },
  ],

  "due.check_in": [
    {
      id: "s1",
      angle: "due_now",
      subject: "{job}",
      needs: ["nearTerm", "interval"],
      body: "Hi {first},\n\nIt's {signer} at {company}. We did {job} for you {when}, and you're coming up on when it's due again. {interval} is the rule of thumb.\n\nWant me to get you on the schedule? Reply with a week that works.\n\n{signer}",
    },
    {
      id: "s1h",
      angle: "due_now",
      subject: "{job}",
      needs: ["held", "interval"],
      body: "Hi {first},\n\nIt's {signer} at {company}. We did {job} for you {when}, and you're coming up on when it's due again. {interval} is the rule of thumb.\n\n{waitLine} Want me to put you down for the first open week in {seasonMonth}?\n\n{signer}",
    },
    {
      // seasonal work that comes back every year (holiday lights): ask the plain question, no rule of thumb
      id: "s1a",
      angle: "due_now",
      subject: "{job}",
      needs: ["nearTerm", "dueAsk"],
      body: "Hi {first},\n\nIt's {signer} at {company}. We did {job} for you {when}. {dueAsk}\n\n{timingLine}\n\nIf so, just reply \"yes\" and I'll get you on the schedule.\n\n{signer}",
    },
  ],
  "due.problem_grows": [
    {
      id: "s2",
      angle: "problem_grows",
      subject: "Re: {job}",
      needs: ["worse", "nearTerm"],
      body: "{first}, the reason it's worth staying on schedule: {worse}\n\nReply with a week that works and we'll take care of it.\n\n{signer}",
    },
    {
      id: "s2h",
      angle: "problem_grows",
      subject: "Re: {job}",
      needs: ["worse", "held"],
      body: "{first}, the reason it's worth staying on schedule: {worse}\n\nWant me to put you down for the first open week in {seasonMonth}?\n\n{signer}",
    },
  ],
  "due.easy_yes": [
    {
      id: "s2e",
      angle: "easy_yes",
      subject: "Re: {job}",
      needs: ["nearTerm"],
      body: "{first}, following up on {job}. If you'd like it done, just reply \"yes\" and I'll have someone reach out to set a date.\n\n{signer}",
    },
    {
      id: "s2eh",
      angle: "easy_yes",
      subject: "Re: {job}",
      needs: ["held"],
      body: "{first}, following up on {job}. It has to wait until {seasonMonth}, but I can hold you a spot now. Want one?\n\n{signer}",
    },
  ],
  // Nothing was ever priced, so no "was it the price" question.
  "due.close_file": [
    {
      id: "s3",
      angle: "close_file",
      subject: "Re: {job}",
      body: "Last note from me on {job}, {first}. If that's already taken care of, no need to reply. If not, reply any time and we'll get it on the calendar.\n\n{signer}",
    },
  ],

  "upsell.check_in": [
    {
      id: "u1",
      angle: "next_step",
      subject: "{option}",
      needs: ["noAsk"],
      body: "Hi {first},\n\n{signer} at {company}. When we took care of {mainJob} for you {when}, we never talked about {option}. {why}\n\nWant a price? Reply and I'll put one together.\n\n{signer}",
    },
    {
      // the follow-on asks its own question: a one-time clean becoming a regular one isn't "a price"
      id: "u1a",
      angle: "next_step",
      subject: "{option}",
      needs: ["ask"],
      body: "Hi {first},\n\n{signer} at {company}. We did {mainJob} for you {when}. {why}\n\n{ask} Reply with what works and I'll set it up.\n\n{signer}",
    },
  ],
  "upsell.close_file": [
    {
      id: "u3",
      angle: "close_file",
      subject: "Re: {option}",
      needs: ["noAsk"],
      body: "Last note from me on {option}, {first}. If you'd like a price, reply and I'll put one together. If not, no need to reply.\n\n{signer}",
    },
    {
      id: "u3a",
      angle: "close_file",
      subject: "Re: {option}",
      needs: ["ask"],
      body: "Last note from me on this, {first}. {ask} Just reply and I'll set it up. If not, no need to reply.\n\n{signer}",
    },
  ],

  /* ------------------------ invoices (opt-in) ------------------------ */
  "invoice.reminder": [
    {
      id: "i1",
      angle: "reminder",
      subject: "invoice {number}",
      body: "Hi {first},\n\n{signer} at {company} here. Our records show invoice {number} for {balance} is still open. If you've already sent it, thank you. Just let me know and I'll check on our end.\n\nIf it slipped through the cracks, reply here and I'll resend it.\n\n{signer}",
    },
  ],
};

/** The always-on sequence for a quote sent in the last few weeks (replaces the FSM's two canned reminders). */
export const FRESH_SEQUENCE: { family: string; steps: StepPlan[] } = {
  family: "fresh",
  steps: [
    { step: 1, day: 0, angles: ["check_in"] },
    { step: 2, day: 5, angles: ["easy_yes", "crew_nearby", "timing", "problem_grows"] },
    { step: 3, day: 12, angles: ["close_file"] },
  ],
};

/**
 * Which sequence an opportunity runs. With always-on, a quote sent in the last few weeks gets the fresh
 * follow-up; the backlog sweep (and anything older) runs its type's sequence.
 */
export function sequenceFor(o: { type: BreakageType; ageDays: number }, alwaysOn = false): { family: string; steps: StepPlan[] } {
  if (alwaysOn && o.type === "unanswered_quote" && o.ageDays <= FRESH_SEQUENCE_MAX_AGE) return FRESH_SEQUENCE;
  return SEQUENCES[o.type];
}
const FRESH_SEQUENCE_MAX_AGE = 30;

/** Which template families and steps each breakage type uses. Never more than three notes to one person. */
export const SEQUENCES: Record<BreakageType, { family: string; steps: StepPlan[] }> = {
  unanswered_quote: {
    family: "quote",
    steps: [
      { step: 1, day: 0, angles: ["check_in"] },
      { step: 2, day: 4, angles: ["crew_nearby", "problem_grows", "timing", "easy_yes"] },
      { step: 3, day: 9, angles: ["close_file"] },
    ],
  },
  archived_quote: {
    family: "quote",
    steps: [
      { step: 1, day: 0, angles: ["check_in"] },
      { step: 2, day: 4, angles: ["crew_nearby", "timing", "problem_grows", "easy_yes"] },
      { step: 3, day: 9, angles: ["close_file"] },
    ],
  },
  changes_requested: {
    family: "changes",
    steps: [
      { step: 1, day: 0, angles: ["check_in"] },
      { step: 2, day: 3, angles: ["revise"] },
      { step: 3, day: 8, angles: ["close_file"] },
    ],
  },
  approved_unscheduled: {
    family: "approved",
    steps: [
      { step: 1, day: 0, angles: ["schedule"] },
      { step: 2, day: 3, angles: ["schedule"] },
      { step: 3, day: 7, angles: ["close_file"] },
    ],
  },
  unquoted_request: {
    family: "request",
    steps: [
      { step: 1, day: 0, angles: ["check_in"] },
      { step: 2, day: 4, angles: ["timing", "easy_yes"] },
      { step: 3, day: 9, angles: ["close_file"] },
    ],
  },
  declined_option: {
    family: "option",
    steps: [
      { step: 1, day: 0, angles: ["next_step"] },
      { step: 2, day: 7, angles: ["close_file"] },
    ],
  },
  declined_quote: { family: "declined", steps: [{ step: 1, day: 0, angles: ["check_in"] }] },
  one_and_done: {
    family: "past",
    steps: [
      { step: 1, day: 0, angles: ["check_in"] },
      { step: 2, day: 7, angles: ["timing", "close_file"] },
    ],
  },
  lapsed_regular: {
    family: "regular",
    steps: [
      { step: 1, day: 0, angles: ["check_in"] },
      { step: 2, day: 6, angles: ["close_file"] },
    ],
  },
  service_due: {
    family: "due",
    steps: [
      { step: 1, day: 0, angles: ["due_now"] },
      // never two "last note" notes in a row
      { step: 2, day: 5, angles: ["problem_grows", "easy_yes"] },
      { step: 3, day: 12, angles: ["close_file"] },
    ],
  },
  missed_upsell: {
    family: "upsell",
    steps: [
      { step: 1, day: 0, angles: ["next_step"] },
      { step: 2, day: 7, angles: ["close_file"] },
    ],
  },
  unpaid_invoice: {
    family: "invoice",
    steps: [
      { step: 1, day: 0, angles: ["reminder"] },
      { step: 2, day: 7, angles: ["reminder"] },
    ],
  },
};

/** Map an angle to the template key for a family, with sensible fallbacks. */
export function templateKey(family: string, angle: MessageAngle, step = 1): string[] {
  const direct = `${family}.${angle}`;
  const alias: Record<string, string[]> = {
    "changes.close_file": ["quote.close_file"],
    "fresh.crew_nearby": ["quote.crew_nearby"],
    "fresh.timing": ["quote.timing"],
    "fresh.problem_grows": ["quote.problem_grows"],
    "changes.timing": ["quote.timing"],
    "approved.schedule": ["approved.schedule"],
    "option.next_step": ["option.check_in"],
    "declined.check_in": ["declined.check_in"],
    "past.check_in": ["past.check_in"],
    "past.timing": ["past.timing"],
    "regular.check_in": ["regular.check_in"],
    "due.due_now": ["due.check_in"],
    "upsell.next_step": ["upsell.check_in"],
    "invoice.reminder": ["invoice.reminder"],
  };
  // the opening note of every family lives under "<family>.check_in"
  const opener = step === 1 ? [`${family}.check_in`] : [];
  return [...new Set([...opener, direct, ...(alias[direct] ?? [])])];
}
