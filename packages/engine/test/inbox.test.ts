import { describe, expect, it } from "vitest";
import { cleanReplyText } from "../src/inbox/clean.ts";
import { findTimeExpressions, pickFollowUp, readReply, seasonDate } from "../src/inbox/index.ts";
import type { ISODate, ReplyIntent } from "../src/model.ts";

const ASOF: ISODate = "2026-09-29";

interface Case {
  text: string;
  intent: ReplyIntent;
  subject?: string;
  from?: string;
  asOf?: ISODate;
  followUpOn?: ISODate;
  phone?: string;
  bestTime?: string;
  timeframe?: string;
  urgency?: "high" | "normal" | "low";
  competitor?: boolean;
  price?: boolean;
  needsHuman?: boolean;
  /** A substring the owner summary must contain. */
  summary?: string;
}

/* ------------------------------------------------------------------ */
/* cleanReplyText                                                      */
/* ------------------------------------------------------------------ */

describe("cleanReplyText", () => {
  it("cuts Gmail quoted history, even when the header wraps", () => {
    const raw = `Yes please, mornings are best.\n\nOn Tue, May 3, 2025 at 9:12 AM Sarah Ridge <\nsarah@ridgelinetree.com> wrote:\n\n> Hi Mike, still want the oak by the driveway taken down?\n> Reply stop to unsubscribe.`;
    expect(cleanReplyText(raw)).toBe("Yes please, mornings are best.");
  });
  it("cuts single-line On ... wrote: headers", () => {
    const raw = "Call me after 5\r\n\r\nOn Mon, Sep 21, 2026, 8:00 AM Dave <dave@x.com> wrote:\r\nStill want the oak done?";
    expect(cleanReplyText(raw)).toBe("Call me after 5");
  });
  it("cuts Outlook From/Sent header blocks", () => {
    const raw = `We went with someone else, thanks.\n\nFrom: Sarah <sarah@ridgeline.com>\nSent: Tuesday, September 22, 2026 9:12 AM\nTo: Mike Sanders <mike@gmail.com>\nSubject: The oak by the driveway\n\nHi Mike, ...`;
    expect(cleanReplyText(raw)).toBe("We went with someone else, thanks.");
  });
  it("cuts -----Original Message----- and underscore separators", () => {
    expect(cleanReplyText("Not now, try in spring\n-----Original Message-----\nFrom: Sarah\nunsubscribe")).toBe("Not now, try in spring");
    expect(cleanReplyText("How much?\n________________________________\nFrom: Sarah\nSent: Monday")).toBe("How much?");
  });
  it("drops > quoted lines, including interleaved ones", () => {
    const raw = "> Still want the stump ground?\nYes\n> Mornings or afternoons?\nMornings";
    expect(cleanReplyText(raw)).toBe("Yes\nMornings");
  });
  it("removes mobile / webmail signatures", () => {
    expect(cleanReplyText("Yes go ahead\n\nSent from my iPhone")).toBe("Yes go ahead");
    expect(cleanReplyText("sure\nSent from Yahoo Mail for iPhone")).toBe("sure");
    expect(cleanReplyText("Stop\n\nGet Outlook for iOS")).toBe("Stop");
    expect(cleanReplyText("ok sounds good Sent from my iPhone")).toBe("ok sounds good");
    expect(cleanReplyText("Sounds good\nSent from my Verizon, Samsung Galaxy smartphone")).toBe("Sounds good");
  });
  it("cuts at the -- signature delimiter", () => {
    expect(cleanReplyText("Please call me.\n-- \nMike Sanders\nSanders Plumbing | 603-555-0100")).toBe("Please call me.");
  });
  it("keeps closings and names", () => {
    expect(cleanReplyText("Yes please.\n\nThanks,\nMike")).toBe("Yes please.\n\nThanks,\nMike");
  });
  it("strips HTML, Gmail quote containers and entities", () => {
    const html = `<html><head><style>p{color:red}</style></head><body><div dir="ltr">Yes please!&nbsp; Tom &amp; Jerry&#39;s house.</div><div><br></div><div class="gmail_quote"><div class="gmail_attr">On Tue, Sep 22, 2026 Sarah wrote:</div><blockquote>Still want it? unsubscribe</blockquote></div></body></html>`;
    expect(cleanReplyText(html)).toBe("Yes please! Tom & Jerry's house.");
  });
  it("collapses whitespace and zero-width junk", () => {
    expect(cleanReplyText("  yes​   please \n\n\n\n call   me  ")).toBe("yes please\n\ncall me");
  });
  it("returns empty for a reply that is only quoted history", () => {
    expect(cleanReplyText("On Tue, Sep 22, 2026 at 9:12 AM Sarah <s@x.com> wrote:\n> hi")).toBe("");
    expect(cleanReplyText("")).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* Date math                                                           */
/* ------------------------------------------------------------------ */

describe("follow-up date math (asOf 2026-09-29)", () => {
  const f = (text: string, asOf: ISODate = ASOF) => pickFollowUp(findTimeExpressions(text, asOf), asOf)?.date;
  it("resolves seasons to their anchors", () => {
    expect(f("in the spring")).toBe("2027-03-15");
    expect(f("next summer")).toBe("2027-06-01");
    expect(f("this winter")).toBe("2026-12-01");
    expect(f("next fall")).toBe("2027-09-15");
    expect(f("later this fall")).toBe("2026-10-29"); // already fall: 30 days out
    expect(f("in the fall", "2026-05-10")).toBe("2026-09-15");
    expect(f("try me in the spring", "2026-02-01")).toBe("2026-03-15");
    expect(seasonDate("winter", "", "2027-01-10")).toBe("2027-02-09");
  });
  it("resolves relative and named times", () => {
    expect(f("next month")).toBe("2026-10-29");
    expect(f("in 2 weeks")).toBe("2026-10-13");
    expect(f("in 3 months")).toBe("2026-12-29");
    expect(f("a few weeks")).toBe("2026-10-20");
    expect(f("a couple of months")).toBe("2026-11-29");
    expect(f("in a month or two")).toBe("2026-11-29");
    expect(f("maybe in March")).toBe("2027-03-01");
    expect(f("in october")).toBe("2026-10-01");
    expect(f("mid March")).toBe("2027-03-15");
    expect(f("after the holidays")).toBe("2027-01-05");
    expect(f("after the holidays", "2026-12-20")).toBe("2027-01-05");
    expect(f("next year")).toBe("2027-01-15");
    expect(f("once the ground freezes")).toBe("2026-12-01");
    expect(f("after thanksgiving")).toBe("2026-12-01");
    expect(f("when it warms up")).toBe("2027-03-15");
  });
  it("does not read 'the tree could fall' or 'may' as dates", () => {
    expect(f("the tree could fall on the house")).toBeUndefined();
    expect(f("we may want to add the stump")).toBeUndefined();
    expect(f("we did it 3 months ago")).toBeUndefined();
  });
  it("treats 'before winter' as a deadline, not a deferral", () => {
    const e = findTimeExpressions("can you do it before winter", ASOF);
    expect(e[0]?.kind).toBe("deadline");
    expect(pickFollowUp(e, ASOF)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Corpus                                                              */
/* ------------------------------------------------------------------ */

const QUOTED = `\n\nOn Tue, Sep 22, 2026 at 9:12 AM Sarah Ridge <sarah@ridgelinetree.com> wrote:\n> Hi Mike, just checking in on the oak by the driveway. Still want it taken down?\n> If you'd rather not hear from us, reply stop and we'll unsubscribe you.\n> Sarah, Ridgeline Tree Co`;
const OUTLOOK = `\n\n________________________________\nFrom: Sarah Ridge <sarah@ridgelinetree.com>\nSent: Tuesday, September 22, 2026 9:12 AM\nTo: Karen <karen@comcast.net>\nSubject: Your fence quote\n\nHi Karen, still thinking about the fence? Unsubscribe any time.`;

const WANTS_IT: Case[] = [
  { text: "Yes", intent: "wants_it", needsHuman: false },
  { text: "yes please", intent: "wants_it" },
  { text: "Y", intent: "wants_it" },
  { text: "\u{1F44D}", intent: "wants_it" },
  { text: "Sure", intent: "wants_it" },
  { text: "Call me", intent: "wants_it" },
  { text: "ok", intent: "wants_it" },
  { text: "Please do", intent: "wants_it" },
  { text: "When?", intent: "wants_it" },
  { text: "Yes we still need it done. Call me after 5 at 603-555-0142", intent: "wants_it", phone: "+16035550142", bestTime: "after 5", summary: "Wants it done" },
  { text: "Hi Sarah, yes we still want the oak taken down. When can you come out?", intent: "wants_it" },
  { text: "YES PLEASE COME TAKE A LOOK", intent: "wants_it" },
  { text: "still need it! the big pine is leaning toward the garage now, asap", intent: "wants_it", urgency: "high", summary: "Urgent" },
  { text: "Go ahead and schedule it. Mornings are best for me.", intent: "wants_it", bestTime: "mornings" },
  { text: "Can you come out next week? I'm home Tuesday and Thursday.", intent: "wants_it", timeframe: "next week" },
  { text: "We're ready to move forward. Let me know what day works.", intent: "wants_it" },
  { text: "Lets do it. Weekends are best, or text me 603.555.0199", intent: "wants_it", phone: "+16035550199", bestTime: "weekends" },
  { text: "yeah we still need the stump ground out, whenever you can get to it", intent: "wants_it" },
  { text: "Still intrested. Give me a call", intent: "wants_it" },
  { text: "Septic is backing up again, please send someone", intent: "wants_it", urgency: "high" },
  { text: "Yes, and do you also do stump grinding?", intent: "wants_it", needsHuman: true },
  { text: "Sure, go ahead. Are you guys insured?", intent: "wants_it", needsHuman: true },
  { text: "No, we still need it done", intent: "wants_it" },
  { text: "We definitely want to get this done before winter", intent: "wants_it", timeframe: "before winter" },
  { text: "yes" + QUOTED, intent: "wants_it" },
  { text: "yes\n\nSent from my iPhone" + QUOTED, intent: "wants_it" },
  { text: "Put us on the schedule please. Gate code is 4471.", intent: "wants_it" },
  { text: "sounds good, what day works for you?", intent: "wants_it" },
  { text: "I'm interested. Call my cell (603) 555-0177 anytime", intent: "wants_it", phone: "+16035550177", bestTime: "anytime" },
  { text: "tree is dead and hanging over the driveway. can someone come look this week?", intent: "wants_it", urgency: "high", timeframe: "this week" },
  { text: "Please call me at 603 555 0123 after 6pm", intent: "wants_it", phone: "+16035550123", bestTime: "after 6pm" },
  { text: "Yea go ahead", intent: "wants_it" },
  { text: "Approved! Send the crew", intent: "wants_it" },
  { text: "ok sounds good", intent: "wants_it" },
  { text: "Can you do it the week of Oct 12?", intent: "wants_it" },
  { text: "When can your crew start?", intent: "wants_it" },
  { text: "Yes!! Been meaning to call you guys", intent: "wants_it" },
  { text: "Absolutely, the sooner the better.", intent: "wants_it", urgency: "high" },
  { text: "we are still interested in the fence. what does your schedule look like", intent: "wants_it" },
  { text: "yes pls call me 6035550142 thx", intent: "wants_it", phone: "+16035550142" },
  { text: "Hi Sarah - Yes! We still want to get the 3 pines by the garage down before the snow flies. Mornings are best. - Tom", intent: "wants_it", bestTime: "mornings", timeframe: "before the snow flies" },
  { text: "ya still need the septic pumped, its starting to smell", intent: "wants_it" },
  { text: "Please don't call, email is better. Yes we want it.", intent: "wants_it" },
  { text: "Can you stop by Tuesday to look at it?", intent: "wants_it" },
  { text: "STOP BY ANYTIME, GATE IS OPEN", intent: "wants_it" },
  { text: "I am interested", intent: "wants_it" },
  { text: "How soon could you get out here? Tree is leaning on the neighbors fence", intent: "wants_it", urgency: "high" },
  { text: "When is the soonest you can come?", intent: "wants_it" },
  { text: "Yes. My cell is 603-555-0188. Best after 4pm.", intent: "wants_it", phone: "+16035550188", bestTime: "after 4pm", summary: "call (603) 555-0188 after 4pm" },
  { text: "Please call my husband Tom at 603-555-0133, he handles this.", intent: "wants_it", phone: "+16035550133" },
  { text: "yes!!! \u{1F44D}", intent: "wants_it" },
  { text: "Sorry for the late reply, been crazy busy. We do still need the driveway sealed.", intent: "wants_it" },
  { text: "The tree fell on my shed last night. Can you come out asap?", intent: "wants_it", urgency: "high" },
  { text: "we're selling the house and need the dead tree gone before closing", intent: "wants_it", urgency: "high", timeframe: "before closing" },
  { text: "Not interested in the stump grinding, but we still want the tree down", intent: "wants_it" },
  { text: "Yes still want it, we can do next month if that's easier for you", intent: "wants_it" },
  { text: "Yes. Can you give me a call? 603-555-0110 is my cell. Weekends are best.", intent: "wants_it", phone: "+16035550110", bestTime: "weekends" },
  { text: "the septic alarm is going off again, need someone out here", intent: "wants_it", urgency: "high" },
  { text: "Definately still want it done", intent: "wants_it" },
  { text: "Hello, still need the gutters cleaned and the roof washed. Anytime next week works.", intent: "wants_it" },
];

const WANTS_PRICE: Case[] = [
  { text: "How much?", intent: "wants_price", price: true, summary: "Asked for an updated price." },
  { text: "Can you send me an updated price?", intent: "wants_price" },
  { text: "What would it cost now?", intent: "wants_price" },
  { text: "Is the price the same as last year?", intent: "wants_price", summary: "old price" },
  { text: "Any discount if we do both trees?", intent: "wants_price" },
  { text: "Too expensive. Any wiggle room?", intent: "wants_price", summary: "better price" },
  { text: "Not right now but send me a price", intent: "wants_price" },
  { text: "Can you requote? we only want the front 2 trees now", intent: "wants_price" },
  { text: "Still interested but the price was a little high", intent: "wants_price" },
  { text: "can you do better on the price? we got another quote for $1800", intent: "wants_price", competitor: true },
  { text: "What's your price for pumping these days?", intent: "wants_price" },
  { text: "Please resend the estimate, I lost it", intent: "wants_price" },
  { text: "Is that $2,400 still good?", intent: "wants_price" },
  { text: "Would you do it for $1500 cash?", intent: "wants_price" },
  { text: "Hi, what would you charge to grind the stump too?", intent: "wants_price" },
  { text: "Could you email me a new quote? We might want to add the back fence.", intent: "wants_price" },
  { text: "Did the price go up?", intent: "wants_price" },
  { text: "how much to just do the front yard", intent: "wants_price" },
  { text: "Send me the numbers again and I'll talk to my wife", intent: "wants_price" },
  { text: "It's more than we wanted to spend. Can you come down at all?", intent: "wants_price" },
  { text: "price?", intent: "wants_price" },
  { text: "Do you offer financing or payment plans?", intent: "wants_price" },
  { text: "Hey Dave, we got a quote from another company that was way lower. Can you do any better?", intent: "wants_price", competitor: true },
  { text: "Our old quote was $3,200. Is that still good?", intent: "wants_price" },
  { text: "Whats the damage for the two maples now" + OUTLOOK, intent: "wants_price" },
];

const QUESTION: Case[] = [
  { text: "Do you also do stump grinding?", intent: "question", needsHuman: true, summary: 'Question: "Do you also do stump grinding?"' },
  { text: "Are you insured?", intent: "question", needsHuman: true },
  { text: "Is this the same company as Ridgeline Tree that did my neighbor's yard?", intent: "question" },
  { text: "How long would the job take? We have a dog.", intent: "question" },
  { text: "What kind of warranty do you give on the concrete?", intent: "question" },
  { text: "Do you haul away the wood or leave it?", intent: "question" },
  { text: "Did you get my last email?", intent: "question" },
  { text: "Are you licensed in NH?", intent: "question" },
  { text: "Will you need to come inside the house?", intent: "question" },
  { text: "Which crew would be doing the work?", intent: "question" },
  { text: "why?", intent: "question" },
  { text: "Is it safe to leave it through the winter?", intent: "question" },
  { text: "Is this still available?", intent: "question" },
  { text: "do you guys take credit cards", intent: "question" },
];

const LATER: Case[] = [
  { text: "Try me in the spring", intent: "later", followUpOn: "2027-03-15", summary: "Try again in spring (Mar 15)." },
  { text: "Maybe next spring", intent: "later", followUpOn: "2027-03-15" },
  { text: "after the holidays", intent: "later", followUpOn: "2027-01-05" },
  { text: "Not this year. Next year for sure.", intent: "later", followUpOn: "2027-01-15" },
  { text: "maybe in March", intent: "later", followUpOn: "2027-03-01" },
  { text: "Once the ground freezes we can talk", intent: "later", followUpOn: "2026-12-01" },
  { text: "Reach out next month", intent: "later", followUpOn: "2026-10-29" },
  { text: "Not right now, check back in a few weeks", intent: "later", followUpOn: "2026-10-20" },
  { text: "In 2 months", intent: "later", followUpOn: "2026-11-29" },
  { text: "We want to wait until summer", intent: "later", followUpOn: "2027-06-01" },
  { text: "Not yet. Waiting on the insurance adjuster.", intent: "later" },
  { text: "Can you try again in January? Money is tight until then.", intent: "later", followUpOn: "2027-01-01" },
  { text: "Hold off for now please, maybe after tax season", intent: "later", followUpOn: "2027-04-20" },
  { text: "Not interested right now, maybe next year", intent: "later", followUpOn: "2027-01-15" },
  { text: "Try us again in 3 weeks", intent: "later", followUpOn: "2026-10-20" },
  { text: "Contact me later this fall", intent: "later", followUpOn: "2026-10-29" },
  { text: "next fall would be better", intent: "later", followUpOn: "2027-09-15" },
  { text: "Too busy right now. Please follow up in a couple of months.", intent: "later", followUpOn: "2026-11-29" },
  { text: "Can you come in the spring?", intent: "later", followUpOn: "2027-03-15" },
  { text: "No thanks, maybe next year", intent: "later", followUpOn: "2027-01-15" },
  { text: "Probably when it warms up", intent: "later", followUpOn: "2027-03-15" },
  { text: "We'll hold off until after Thanksgiving", intent: "later", followUpOn: "2026-12-01" },
  { text: "Mid March would work better for us", intent: "later", followUpOn: "2027-03-15" },
  { text: "in the fall", intent: "later", asOf: "2026-05-10", followUpOn: "2026-09-15" },
  { text: "After the holidays please", intent: "later", asOf: "2026-12-20", followUpOn: "2027-01-05" },
  { text: "try me in the spring", intent: "later", asOf: "2026-02-01", followUpOn: "2026-03-15" },
  { text: "Not now", intent: "later", summary: "Not now" },
  { text: "Maybe later", intent: "later" },
  { text: "Let's revisit in a month or two", intent: "later", followUpOn: "2026-11-29" },
  { text: "Yes, but not until spring", intent: "later", followUpOn: "2027-03-15" },
  { text: "Interested, but not until after the holidays", intent: "later", followUpOn: "2027-01-05" },
  { text: "I'll pass for now, maybe in the spring", intent: "later", followUpOn: "2027-03-15" },
  { text: "yes, still want it, but not until the spring" + QUOTED, intent: "later", followUpOn: "2027-03-15" },
  { text: "Next month", intent: "later", followUpOn: "2026-10-29" },
  { text: "Not now, the bank account is empty lol", intent: "later" },
  { text: "Hi Sarah. We're waiting on our tax refund, can you reach out in a few weeks?", intent: "later", followUpOn: "2026-10-20" },
];

const ALREADY_DONE: Case[] = [
  { text: "We had it done already, thanks", intent: "already_done" },
  { text: "Someone else did it", intent: "already_done", competitor: true },
  { text: "We went with another company", intent: "already_done", competitor: true, summary: "went with someone else" },
  { text: "Did it myself", intent: "already_done", summary: "did it themselves" },
  { text: "The tree fell in the last storm and the town took it away", intent: "already_done" },
  { text: "All set, thanks!", intent: "already_done" },
  { text: "Got it taken care of in August", intent: "already_done" },
  { text: "Tree was taken down last month by the power company", intent: "already_done" },
  { text: "My husband and his brother cut it down over the summer.", intent: "already_done" },
  { text: "Already had the tank pumped by another company in July", intent: "already_done", competitor: true },
  { text: "we hired someone local, sorry", intent: "already_done", competitor: true },
  { text: "It's been taken care of.", intent: "already_done" },
  { text: "Nope, all set. Went with the other guy", intent: "already_done", competitor: true },
  { text: "the tree is gone, the storm took it", intent: "already_done" },
  { text: "We ended up going with a cheaper quote", intent: "already_done", competitor: true },
  { text: "Tree fell over in the storm.", intent: "already_done" },
  { text: "We went with someone else, maybe next year for the back trees", intent: "already_done", competitor: true },
  { text: "had a guy from church do it", intent: "already_done" },
  { text: "Thank you but we're all set" + OUTLOOK, intent: "already_done" },
];

const NOT_INTERESTED: Case[] = [
  { text: "No", intent: "not_interested" },
  { text: "No thanks", intent: "not_interested" },
  { text: "not interested", intent: "not_interested", summary: "Not interested" },
  { text: "Not interested, thank you.", intent: "not_interested" },
  { text: "NOT INTERESTED", intent: "not_interested" },
  { text: "We decided not to do the fence.", intent: "not_interested" },
  { text: "Too expensive", intent: "not_interested", price: true, summary: "price is too high" },
  { text: "nope", intent: "not_interested" },
  { text: "We don't need it anymore", intent: "not_interested" },
  { text: "never mind, we're going to leave the tree", intent: "not_interested" },
  { text: "no thank you we will pass", intent: "not_interested" },
  { text: "Not at this time.", intent: "not_interested" },
  { text: "I'm good, thanks", intent: "not_interested" },
  { text: "We changed our minds and will not be moving forward.", intent: "not_interested" },
  { text: "Thanks but no. Way out of our budget.", intent: "not_interested", price: true },
  { text: "No longer interested", intent: "not_interested" },
  { text: "\u{1F44E}", intent: "not_interested" },
  { text: "We're going to do it ourselves", intent: "not_interested" },
  { text: "We no longer need the stump ground", intent: "not_interested" },
  { text: "no" + QUOTED, intent: "not_interested" },
  { text: "Nah we're good", intent: "not_interested" },
  { text: "No thanks, too expensive", intent: "not_interested", price: true },
];

const MOVED: Case[] = [
  { text: "We sold the house in June.", intent: "moved" },
  { text: "I no longer own that property", intent: "moved" },
  { text: "We moved to Florida last year", intent: "moved" },
  { text: "sold it, you'll need to contact the new owners", intent: "moved" },
  { text: "The house was sold, please update your records", intent: "moved" },
  { text: "We don't live there anymore.", intent: "moved" },
  { text: "My mother passed away and the house is being sold.", intent: "moved", needsHuman: true, summary: "handle with care" },
  { text: "Not my house anymore", intent: "moved" },
  { text: "we relocated for work, sorry", intent: "moved" },
  { text: "Moved out in May, not our problem anymore lol", intent: "moved" },
  { text: "Sold the house last year, who is this?", intent: "moved" },
];

const WRONG_PERSON: Case[] = [
  { text: "Wrong number", intent: "wrong_person" },
  { text: "Who is this?", intent: "wrong_person" },
  { text: "I never asked for a quote", intent: "wrong_person" },
  { text: "You have the wrong person", intent: "wrong_person" },
  { text: "wrong email, I don't know any Mike", intent: "wrong_person" },
  { text: "I think you have me confused with someone else", intent: "wrong_person" },
  { text: "We never requested an estimate from your company.", intent: "wrong_person" },
  { text: "Sorry, I don't know what this is about", intent: "wrong_person" },
  { text: "Nobody by that name lives here", intent: "wrong_person" },
  { text: "who are you people", intent: "wrong_person" },
  { text: "I don't have a septic tank", intent: "wrong_person" },
  { text: "what is this about?", intent: "wrong_person" },
];

const STOP: Case[] = [
  { text: "Stop", intent: "stop", summary: "Asked to stop — removed." },
  { text: "STOP", intent: "stop" },
  { text: "unsubscribe", intent: "stop" },
  { text: "Please remove me from your list", intent: "stop" },
  { text: "take me off your mailing list", intent: "stop" },
  { text: "Don't email me again", intent: "stop" },
  { text: "quit emailing me", intent: "stop" },
  { text: "yes but please stop emailing me", intent: "stop" },
  { text: "take me off your list, we went with someone else", intent: "stop" },
  { text: "Stop sending me these", intent: "stop" },
  { text: "Please unsubscribe me. Thanks.", intent: "stop" },
  { text: "No more emails please", intent: "stop" },
  { text: "remove", intent: "stop" },
  { text: "Opt out", intent: "stop" },
  { text: "Not interested. Please stop contacting me.", intent: "stop" },
  { text: "Try me in the spring. Actually no, just take me off the list.", intent: "stop" },
  { text: "We still need the tree done but don't contact me by email anymore", intent: "stop" },
  { text: "STOP" + QUOTED, intent: "stop" },
  { text: "", subject: "Unsubscribe", intent: "stop" },
  { text: "please stop", intent: "stop" },
  { text: "Leave me alone", intent: "stop" },
  { text: "Sold the house. Please remove me.", intent: "stop" },
  { text: "Wrong person, stop emailing me", intent: "stop" },
  { text: "Not now. And please remove my email from your list", intent: "stop" },
  { text: "stop.\n\nSent from my iPhone", intent: "stop" },
];

const COMPLAINT: Case[] = [
  { text: "This is spam", intent: "complaint", needsHuman: true, summary: "Complaint" },
  { text: "How did you get my email address?", intent: "complaint" },
  { text: "I've reported this as spam.", intent: "complaint" },
  { text: "Stop spamming me", intent: "complaint" },
  { text: "F*** off", intent: "complaint" },
  { text: "This is the third email. I already told you no. Leave me alone.", intent: "complaint" },
  { text: "I'm going to report you to the BBB", intent: "complaint" },
  { text: "Who gave you my info? This is harassment.", intent: "complaint" },
  { text: "Why do you keep emailing me??", intent: "complaint" },
  { text: "you people are idiots", intent: "complaint" },
  { text: "Take me off your list or I'm calling my lawyer", intent: "complaint" },
  { text: "This is a scam isn't it", intent: "complaint" },
  { text: "Who is this? How did you get my email?", intent: "complaint" },
  { text: "yes we want it done but how did you get my email", intent: "complaint" },
];

const AUTO_REPLY: Case[] = [
  { text: "I am out of the office until October 5 with limited access to email. I will respond upon my return.", subject: "Automatic reply: The oak by the driveway", intent: "auto_reply", summary: "Auto-reply" },
  { text: "Thank you for your email. I am currently out of the office and will return on Monday.", intent: "auto_reply" },
  { text: "I'm on vacation until 10/12.", subject: "Out of Office", intent: "auto_reply" },
  { text: "This is an automated response. We have received your message and will get back to you within 2 business days.", intent: "auto_reply" },
  { text: "I will be out of the office through Friday. For urgent matters please call 603-555-0100.", intent: "auto_reply" },
  { text: "This mailbox is no longer monitored.", intent: "auto_reply" },
  { text: "I'm away from my desk.", subject: "Auto: Re: still want the oak done?", intent: "auto_reply" },
  { text: "I am currently traveling with limited access to email.", intent: "auto_reply" },
];

const BOUNCE: Case[] = [
  { text: "Address not found. Your message wasn't delivered to mike@example.net because the address couldn't be found.", from: "MAILER-DAEMON@mx.google.com", subject: "Delivery Status Notification (Failure)", intent: "bounce", summary: "bounced" },
  { text: "Delivery has failed to these recipients or groups: karen@comcast.net. The email address you entered couldn't be found.", subject: "Undeliverable: Still want the oak done?", intent: "bounce" },
  { text: "Mail delivery failed: returning message to sender. 550 5.1.1 User unknown", from: "postmaster@mail.example.com", intent: "bounce" },
  { text: "The recipient's mailbox is full and can't accept messages now.", intent: "bounce" },
  { text: "This is the mail system at host mx.example.com. I'm sorry to have to inform you that your message could not be delivered.", subject: "Returned mail: see transcript for details", intent: "bounce" },
  { text: "Your message to tom@aol.com couldn't be delivered.\n\nOriginal message:\nHi Tom, still want the stump ground? Reply STOP to unsubscribe.", from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", intent: "bounce" },
  { text: "Hi Tom, still want the fence? Unsubscribe here.", subject: "Mail Delivery Failure", intent: "bounce" },
];

const UNCLEAR: Case[] = [
  { text: "Thanks", intent: "unclear", needsHuman: true, summary: "Unclear" },
  { text: "Got it", intent: "unclear" },
  { text: "Received", intent: "unclear" },
  { text: "", intent: "unclear" },
  { text: "My husband handles this stuff", intent: "unclear" },
  { text: "Hmm let me think about it", intent: "unclear" },
  { text: "Forwarding to my wife", intent: "unclear" },
  { text: "I'm not sure we still need it", intent: "unclear" },
  { text: "Mike", intent: "unclear" },
];

/** Mixed replies written after the first design, used to check the rules generalize. */
const MIXED: Case[] = [
  { text: "Yes we would like to proceed with the quote you sent", intent: "wants_it" },
  { text: "Hi! Sorry we never got back to you. Is the offer still good? We'd like to get it done this fall.", intent: "wants_price" },
  { text: "We're not ready yet, the HOA hasn't approved it", intent: "later" },
  { text: "Please give me a call when you get a chance, 978-555-2231", intent: "wants_it" },
  { text: "no longer needed, thank you", intent: "not_interested" },
  { text: "Nope. We moved.", intent: "moved" },
  { text: "i dont think so", intent: "not_interested" },
  { text: "Not interested thanks", intent: "not_interested" },
  { text: "Can we do it in two weeks?", intent: "wants_it" },
  { text: "yes, but I need to talk to my husband first", intent: "wants_it" },
  { text: "I would like a new estimate please", intent: "wants_price" },
  { text: "Let me talk to my wife and get back to you", intent: "later" },
  { text: "We had a guy do it for half the price", intent: "already_done" },
  { text: "My neighbor's tree service already took it down", intent: "already_done" },
  { text: "Please take us off your email list. Thank you", intent: "stop" },
  { text: "U guys still doing driveways?", intent: "question" },
  { text: "Stop emailing me or I will report you", intent: "complaint" },
  { text: "Out of town til the 15th, hit me up after that", intent: "later" },
  { text: "The oak is still there lol, yes come get it", intent: "wants_it" },
  { text: "i'll call you tomorrow", intent: "wants_it" },
  { text: "Not this fall. Maybe in the spring.", intent: "later" },
  { text: "Who is Sarah?", intent: "wrong_person" },
  { text: "No need, all done", intent: "already_done" },
  { text: "We don't need the tree removed anymore, it died and fell over", intent: "not_interested" },
  { text: "Yes definitely!! When can you start?", intent: "wants_it" },
  { text: "Please send me the updated quote and available dates", intent: "wants_price" },
  { text: "is it still 1200?", intent: "wants_price" },
  { text: "we might be interested in the spring", intent: "later" },
  { text: "Is this a real person?", intent: "question" },
  { text: "unsubscribe me please and thank you", intent: "stop" },
  { text: "I'm confused, what quote?", intent: "wrong_person" },
  { text: "we are good for now thanks", intent: "not_interested" },
  { text: "already done", intent: "already_done" },
  { text: "Tuesday works", intent: "wants_it" },
  { text: "give me a ring", intent: "wants_it" },
  { text: "not needed", intent: "not_interested" },
  { text: "Hold off till next year", intent: "later" },
  { text: "We'd love to but money is tight right now", intent: "later" },
  { text: "The quote was too high, we're going to wait", intent: "later" },
  { text: "Please don't send any more of these", intent: "stop" },
  { text: "Remove me from this list immediately", intent: "stop" },
  { text: "I want off this list", intent: "stop" },
  { text: "how do I unsubscribe", intent: "stop" },
  { text: "Enough with the emails", intent: "complaint" },
  { text: "stop stop stop", intent: "stop" },
  { text: "Yes please stop by when you're in the area", intent: "wants_it" },
  { text: "We don't want to stop the project, just need a new price", intent: "wants_price" },
  { text: "Not interested in being contacted", intent: "stop" },
  { text: "we're not interested, please don't contact us again", intent: "stop" },
  { text: "I'm not NOT interested lol, just busy. Try me next month", intent: "later" },
  { text: "Never got the quote, can you resend it?", intent: "wants_price" },
  { text: "We still haven't had it done, yes come out", intent: "wants_it" },
  { text: "Its not taken care of yet, we still need it", intent: "wants_it" },
  { text: "no rush, but yes we still want it", intent: "wants_it" },
  { text: "No problem, go ahead and book it", intent: "wants_it" },
  { text: "No, we haven't found anyone yet. Still need it done.", intent: "wants_it" },
  { text: "No. Please call me.", intent: "wants_it" },
  { text: "Ok but not until after the new year", intent: "later" },
  { text: "Not sure yet, maybe after Christmas", intent: "later" },
  { text: "We're moving in the spring so we won't need it", intent: "not_interested" },
  { text: "The previous owner must have requested this. We just bought the house.", intent: "wrong_person" },
  { text: "Hello, we just bought this house. The previous owners probably got the quote but we'd love a price too", intent: "wants_price" },
  { text: "Out of office: I will be back Monday October 5th.", intent: "auto_reply" },
  { text: "I'm on vacation, back next week, will call you then", intent: "wants_it" },
  { text: "Tree came down in the storm last week. Need it cleaned up asap", intent: "wants_it" },
  { text: "tree came down", intent: "already_done" },
  { text: "DO NOT CONTACT", intent: "stop" },
  { text: "Fine. Do it.", intent: "wants_it" },
  { text: "$$$?", intent: "wants_price" },
  { text: "We'll think about it", intent: "unclear" },
  { text: "Can you do Saturday?", intent: "wants_it" },
  { text: "morning works best, call 603-555-9012", intent: "wants_it" },
  { text: "nope not interested", intent: "not_interested" },
  { text: "Is it the same price as before or did it go up", intent: "wants_price" },
  { text: "What's the earliest you can get here?", intent: "wants_it" },
  { text: "Hi, this is Mike's wife, he passed in July. We won't be needing the service.", intent: "not_interested" },
  { text: "We are not interested and please remove us", intent: "stop" },
  { text: "Who's this from?", intent: "wrong_person" },
  { text: "Actually yes. Our neighbor's tree is leaning on our fence now too", intent: "wants_it" },
  { text: "<div>yes pls</div><div class=\"gmail_quote\">On Mon wrote: unsubscribe</div>", intent: "wants_it" },
  { text: "<p>Please remove me from your mailing list.</p><p>Thank you</p>", intent: "stop" },
  { text: "yse please call me", intent: "wants_it" },
  { text: "HOW MUCH NOW", intent: "wants_price" },
  { text: "WE SOLD THE HOUSE", intent: "moved" },
  { text: "no thank u\n\nFrom: Ridgeline Tree <office@ridgelinetree.com>\nSent: Monday, September 28, 2026 8:02 AM\nTo: jdoe@yahoo.com\nSubject: Your oak\n\nStill want it? Reply STOP to opt out.", intent: "not_interested" },
  { text: "sure thing, what time\n\nFrom: Ridgeline Tree <office@ridgelinetree.com>\nSent: Monday, September 28, 2026 8:02 AM\nTo: jdoe@yahoo.com\nSubject: Your oak\n\nStill want it? Reply STOP to opt out.", intent: "wants_it" },
  { text: "Were not intersted", intent: "not_interested" },
  { text: "Hi there. Tree is still standing and still leaning. Please come", intent: "wants_it" },
  { text: "thx but we got someone", intent: "already_done" },
  { text: "Hello I am away on holiday until 12 October with no access to email.", intent: "auto_reply" },
  { text: "", intent: "bounce", subject: "Delivery Status Notification (Delay)", from: "mailer-daemon@google.com" },
  { text: "Message blocked. Your message to x@y.com has been blocked.", intent: "bounce", subject: "Undeliverable: Your oak", from: "postmaster@outlook.com" },
  { text: "I'll have to check with my wife and get back to you in a week or two", intent: "later" },
  { text: "I have a question about the quote, can you call me?", intent: "wants_it" },
  { text: "What does the price include? Does it include hauling?", intent: "question" },
  { text: "can u text me instead 6035551234", intent: "wants_it" },
  { text: "No, go away", intent: "stop" },
  { text: "We did it already", intent: "already_done" },
  { text: "Don't need it. Thanks", intent: "not_interested" },
  { text: "Sounds great! See you Thursday.", intent: "wants_it" },
  { text: "i am intrested but money is tight until december", intent: "later" },
  { text: "Please take my wife off too, she got the same email", intent: "stop" },
  { text: "not at the moment, thanks for checking", intent: "later" },
  { text: "Is Dave still running the company?", intent: "question" },
  { text: "how did u get this email??? stop", intent: "complaint" },
  { text: "You guys did great work last time. Yes let's do the back yard too", intent: "wants_it" },
  { text: "Next week works. Any day but Wed.", intent: "wants_it" },
  { text: "The fence is fine for now", intent: "not_interested" },
  { text: "Yes—please send the updated quote.", intent: "wants_price" },
];

const GROUPS: [string, Case[]][] = [
  ["wants_it", WANTS_IT],
  ["wants_price", WANTS_PRICE],
  ["question", QUESTION],
  ["later", LATER],
  ["already_done", ALREADY_DONE],
  ["not_interested", NOT_INTERESTED],
  ["moved", MOVED],
  ["wrong_person", WRONG_PERSON],
  ["stop", STOP],
  ["complaint", COMPLAINT],
  ["auto_reply", AUTO_REPLY],
  ["bounce", BOUNCE],
  ["unclear", UNCLEAR],
  ["mixed", MIXED],
];

const ALL: Case[] = GROUPS.flatMap(([, cs]) => cs);

function read(c: Case) {
  return readReply({
    text: c.text,
    asOf: c.asOf ?? ASOF,
    ...(c.subject !== undefined ? { subject: c.subject } : {}),
    ...(c.from !== undefined ? { from: c.from } : {}),
  });
}

describe("readReply corpus", () => {
  it("has a large corpus covering every intent", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(160);
    const intents = new Set(ALL.map((c) => c.intent));
    for (const i of ["wants_it", "wants_price", "question", "later", "already_done", "not_interested", "moved", "wrong_person", "stop", "complaint", "auto_reply", "bounce", "unclear"] as ReplyIntent[]) {
      expect(intents.has(i)).toBe(true);
    }
  });

  for (const [group, cases] of GROUPS) {
    describe(group, () => {
      for (const c of cases) {
        const name = `${JSON.stringify(c.text.split("\n")[0]!.slice(0, 70))}${c.subject ? ` [subj: ${c.subject}]` : ""}${c.asOf ? ` @${c.asOf}` : ""}`;
        it(name, () => {
          const r = read(c);
          const ctx = `signals: ${r.signals.join(" | ")}`;
          expect(r.intent, ctx).toBe(c.intent);
          if (c.followUpOn !== undefined) expect(r.extracted.followUpOn, ctx).toBe(c.followUpOn);
          if (c.phone !== undefined) expect(r.extracted.phone).toBe(c.phone);
          if (c.bestTime !== undefined) expect(r.extracted.bestTime).toBe(c.bestTime);
          if (c.timeframe !== undefined) expect(r.extracted.timeframe).toBe(c.timeframe);
          if (c.urgency !== undefined) expect(r.extracted.urgency).toBe(c.urgency);
          if (c.competitor !== undefined) expect(!!r.extracted.mentionsCompetitor).toBe(c.competitor);
          if (c.price !== undefined) expect(!!r.extracted.mentionsPrice).toBe(c.price);
          if (c.needsHuman !== undefined) expect(r.needsHuman, ctx).toBe(c.needsHuman);
          if (c.summary !== undefined) expect(r.summary).toContain(c.summary);
        });
      }
    });
  }
});

describe("readReply invariants", () => {
  const readings = ALL.map((c) => ({ c, r: read(c) }));
  it("summaries are one line, under 70 chars, no emoji", () => {
    for (const { c, r } of readings) {
      expect(r.summary.length, c.text).toBeLessThan(70);
      expect(r.summary, c.text).not.toMatch(/\n/);
      expect(r.summary, c.text).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(r.summary.length).toBeGreaterThan(5);
    }
  });
  it("confidence is within 0..1 and needsHuman follows the rules", () => {
    for (const { c, r } of readings) {
      expect(r.confidence, c.text).toBeGreaterThanOrEqual(0);
      expect(r.confidence, c.text).toBeLessThanOrEqual(1);
      if (["question", "complaint", "unclear"].includes(r.intent) || r.confidence < 0.6) expect(r.needsHuman, c.text).toBe(true);
    }
  });
  it("stop and bounce are read with high confidence", () => {
    for (const { c, r } of readings) {
      if (r.intent === "stop" || r.intent === "bounce") expect(r.confidence, c.text).toBeGreaterThanOrEqual(0.9);
    }
  });
  it("followUpOn is only set for later, and always after asOf", () => {
    for (const { c, r } of readings) {
      if (r.extracted.followUpOn) {
        expect(r.intent, c.text).toBe("later");
        expect(r.extracted.followUpOn > (c.asOf ?? ASOF), c.text).toBe(true);
      }
    }
  });
  it("is deterministic", () => {
    for (const { c, r } of readings.slice(0, 40)) expect(read(c)).toEqual(r);
  });
  it("returns the cleaned text it classified", () => {
    const r = readReply({ text: "Yes please\n\nSent from my iPhone" + QUOTED, asOf: ASOF });
    expect(r.cleaned).toBe("Yes please");
    expect(r.intent).toBe("wants_it");
    expect(r.needsHuman).toBe(false);
  });
  it("extracts extras the owner needs in the text", () => {
    const r = readReply({ text: "Yes still need the oak down, it's leaning on the garage. Call me after 5, 603-555-0142.", asOf: ASOF });
    expect(r.intent).toBe("wants_it");
    expect(r.extracted).toMatchObject({ phone: "+16035550142", bestTime: "after 5", urgency: "high" });
    expect(r.summary).toBe("Urgent: wants it done — call (603) 555-0142 after 5.");
  });
});
