import type { ReplyIntent } from "../model.ts";

/** Realistic homeowner replies used by the simulator. {job} {signer} {phone} {day} are filled in. */
export const SIM_REPLIES: Partial<Record<ReplyIntent, string[]>> = {
  wants_it: [
    "Yes, still want it done. Any day next week works.",
    "Hi {signer}, yes please. Can you call me after 5? {phone}",
    "Yes! That's still on my list. Go ahead and schedule it.",
    "Still need it. The {job} got worse over the winter honestly. When can you come?",
    "Yeah let's do it. Same as the quote is fine.",
    "Yes. Is {day} possible?",
    "We do still want this. My husband forgot to call you back. Please put us on the schedule.",
    "Yes please call me {phone}",
    "Perfect timing actually, we were just talking about it. Let's go ahead.",
    "sure, go ahead",
  ],
  wants_price: [
    "Is the price still the same as last year?",
    "Could you send me an updated price? We might be ready now.",
    "How much would it be now? And could you do it before the holidays?",
    "Can you requote? We'd want to add the stump too.",
    "Interested but the price was a little high. Any wiggle room?",
    "What would it cost to just do the part by the house for now?",
  ],
  question: [
    "Do you also do stump grinding?",
    "Are you guys insured? My neighbor had a bad experience.",
    "Is this the same company that came out in the spring? Who was the guy?",
  ],
  later: [
    "Not right now, maybe in the spring.",
    "We're going to wait until after the holidays. Check back in January?",
    "Try me next year, money's tight right now.",
    "Can you reach out again in March?",
  ],
  already_done: [
    "We had someone else take care of it, thanks.",
    "Already done, thanks for checking.",
    "It came down in the storm actually. All set.",
    "My brother in law did it. Thanks though.",
    "Got it taken care of last summer.",
  ],
  not_interested: ["No thank you.", "We decided not to do it. Thanks.", "Not interested, thanks."],
  moved: ["We sold the house in May, sorry.", "We moved out of state last year."],
  wrong_person: ["I think you have the wrong person, I never asked for a quote.", "Who is this?"],
  stop: ["Please take me off your list.", "Stop", "unsubscribe", "Please don't email me again."],
  auto_reply: ["I am out of the office until Monday with limited access to email. I will respond when I return.", "Automatic reply: Thank you for your email. I'm on vacation and will reply when I'm back."],
};

/** Given a reply happened, how likely each kind is. Positive share is set per opportunity. */
export const NON_POSITIVE_MIX: [ReplyIntent, number][] = [
  ["already_done", 0.36],
  ["later", 0.17],
  ["not_interested", 0.13],
  ["stop", 0.11],
  ["auto_reply", 0.1],
  ["moved", 0.07],
  ["wrong_person", 0.03],
  ["question", 0.03],
];
