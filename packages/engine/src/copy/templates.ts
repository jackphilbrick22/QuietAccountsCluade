import type { BreakageType, MessageAngle } from "../model.ts";

/**
 * The note library. Written the way a person at a small trade company writes:
 * short, plain, specific to the job, one easy question, no links, no exclamation marks.
 *
 * Tokens: {first} {signer} {company} {job} {when} {priceClause} {freshLook} {street} {streetName} {city}
 *         {crewLine} {worse} {timingLine} {interval} {service} {mainJob} {option} {why}
 *         {years} {number} {balance} {ownerFirst} {phoneLine}
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
      body: "Hi {first},\n\nIt's {signer} at {company}. You got a price from us {when} for {job}{priceClause}.\n\nWe never heard back, and that's on us for not following up. Is it still something you want done?\n\n{freshLook}\n\nIf you went another way, that's fine. Just reply \"pass\" and I'll close it out.\n\n{signer}",
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
      body: "{first}, one thing worth knowing about {job}: {worse}\n\nIf you'd like us to take another look first, just reply and we'll set it up. No charge to look.\n\n{signer}",
    },
  ],
  "quote.timing": [
    {
      id: "q2t",
      angle: "timing",
      subject: "Re: {job}",
      needs: ["timingLine"],
      body: "{first}, {timingLine}\n\nIf you'd like {job} taken care of, reply with a day or two that work and we'll get you on the schedule.\n\n{signer}",
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
      needs: ["bigJob"],
      body: "{first}, if the timing's better now for {job}, just reply \"yes\" and I'll have someone reach out to set a date.\n\nIf it was the price, say so. There's usually another way to do it, like splitting it into two visits or doing the most important part first.\n\n{signer}",
    },
    {
      id: "q2e2",
      angle: "easy_yes",
      subject: "Re: {job}",
      body: "{first}, if the timing's better now for {job}, just reply \"yes\" and I'll have someone reach out to set a date.\n\nNo pressure either way.\n\n{signer}",
    },
  ],
  "quote.close_file": [
    {
      id: "q3",
      angle: "close_file",
      subject: "Re: {job}",
      body: `Last note from me on this, {first}. If {job} is handled, no need to reply. If it's still on your list, reply and we'll get you a date.\n\n${CLOSE_QUESTION}\n\n{signer}`,
    },
  ],

  /* ------------------------ changes requested ------------------------ */
  "changes.check_in": [
    {
      id: "c1",
      angle: "check_in",
      subject: "your revised quote for {job}",
      body: "Hi {first},\n\nIt's {signer} at {company}. You asked us for some changes on the quote for {job} {when}, and I don't think we ever got you the revised version. That's on us.\n\nDo you still want it? Tell me what you'd like changed and I'll get you an updated price this week.\n\n{signer}",
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
      body: "Hi {first},\n\n{signer} at {company}. You gave us the go-ahead on {job} {when}, and it looks like it never made it onto the schedule. I'm sorry about that.\n\nAre you still wanting it done? Reply with a couple of days that work and I'll lock one in.\n\n{signer}",
    },
  ],
  "approved.schedule": [
    {
      id: "a2",
      angle: "schedule",
      subject: "Re: getting {job} on the schedule",
      body: "{first}, checking back on {job}. We've got openings coming up. Want one of them?\n\n{signer}",
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

  /* ------------------------ add-ons passed on ------------------------ */
  "option.check_in": [
    {
      id: "o1",
      angle: "next_step",
      subject: "{option}",
      body: "Hi {first},\n\nIt's {signer} at {company}. When we did {mainJob} {when}, you passed on {option}, which made sense at the time.\n\nIf you'd like it done now, we can usually fit it in while a crew's in your area. Want me to set it up?\n\n{signer}",
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
      subject: "{streetName}",
      needs: ["streetName"],
      body: "Hi {first},\n\nIt's {signer} at {company}. We did {job} for you {when} on {streetName}. It's been about {years}.\n\nIs there anything around the place you've been meaning to get to? Happy to swing by and take a look. No charge to look.\n\n{signer}",
    },
    {
      id: "p1b",
      angle: "check_in",
      subject: "checking in from {company}",
      body: "Hi {first},\n\nIt's {signer} at {company}. We took care of {job} for you {when}.\n\nIf there's anything on your list this season, reply and we'll get you a price. Always glad to help a past customer.\n\n{signer}",
    },
  ],
  "past.timing": [
    {
      id: "p2",
      angle: "timing",
      subject: "Re: {streetName}",
      needs: ["timingLine", "streetName"],
      body: "{first}, {timingLine}\n\nIf there's anything you'd like looked at before then, reply and we'll come by while we're in the area.\n\n{signer}",
    },
    {
      // no street on file: stays in the thread opened by "checking in from {company}"
      id: "p2b",
      angle: "timing",
      subject: "Re: checking in from {company}",
      needs: ["timingLine"],
      body: "{first}, {timingLine}\n\nIf there's anything you'd like looked at before then, just reply and we'll set it up.\n\n{signer}",
    },
  ],
  "past.close_file": [
    {
      id: "p3",
      angle: "close_file",
      subject: "Re: {streetName}",
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
      body: "Hi {first},\n\n{signer} at {company}. We used to take care of {job} for you, and the last time was {when}. We'd love to have you back on the schedule.\n\nWant me to save you a spot? Just reply and I'll set it up.\n\n{signer}",
    },
  ],
  "regular.close_file": [
    {
      id: "g3",
      angle: "close_file",
      subject: "Re: {job}",
      body: "{first}, was there something we could have done better? An honest answer helps us, and if you want us back, we'll make it right.\n\n{signer}",
    },
  ],

  "due.check_in": [
    {
      id: "s1",
      angle: "due_now",
      subject: "{job}",
      body: "Hi {first},\n\nIt's {signer} at {company}. We did {job} for you {when}, and you're coming up on when it's due again. Every {interval} is the rule of thumb.\n\nWant me to get you on the schedule? Reply with a week that works.\n\n{signer}",
    },
  ],
  "due.problem_grows": [
    {
      id: "s2",
      angle: "problem_grows",
      subject: "Re: {job}",
      needs: ["worse"],
      body: "{first}, the reason it's worth staying on schedule: {worse}\n\nReply with a week that works and we'll take care of it.\n\n{signer}",
    },
  ],

  "upsell.check_in": [
    {
      id: "u1",
      angle: "next_step",
      subject: "{option}",
      body: "Hi {first},\n\n{signer} at {company}. When we did {mainJob} for you {when}, we never talked about {option}. {why}\n\nWant a price? Reply and I'll put one together.\n\n{signer}",
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

/** Which template families and steps each breakage type uses. */
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
      { step: 2, day: 5, angles: ["problem_grows", "close_file"] },
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
    "changes.timing": ["quote.timing"],
    "request.timing": ["quote.timing"],
    "request.easy_yes": ["quote.easy_yes"],
    "request.close_file": ["quote.close_file"],
    "approved.schedule": ["approved.schedule"],
    "option.next_step": ["option.check_in"],
    "option.close_file": ["quote.close_file"],
    "declined.check_in": ["declined.check_in"],
    "past.check_in": ["past.check_in"],
    "past.timing": ["past.timing"],
    "regular.check_in": ["regular.check_in"],
    "due.due_now": ["due.check_in"],
    "due.close_file": ["quote.close_file"],
    "upsell.next_step": ["upsell.check_in"],
    "upsell.close_file": ["quote.close_file"],
    "invoice.reminder": ["invoice.reminder"],
  };
  // the opening note of every family lives under "<family>.check_in"
  const opener = step === 1 ? [`${family}.check_in`] : [];
  return [...new Set([...opener, direct, ...(alias[direct] ?? [])])];
}
