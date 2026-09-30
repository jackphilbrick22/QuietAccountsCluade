import { beforeAll, describe, expect, it } from "vitest";
import { emptyState, fmtMoney, generateSample, renderNote, scan, type AccountState, type Opportunity, type Touch } from "@qa/engine";
import { invented, personalizeFirstNote } from "../src/agents/writer.ts";
import type { Llm } from "../src/agents/llm.ts";

/**
 * The AI rewrite of a first note goes out under the owner's name with no human in between, so anything it
 * adds beyond the template and the record — a price, a date, a deal, a crew — throws the rewrite away.
 */
const ASOF = "2026-09-29";

/** A stand-in for Claude that writes whatever the test says. */
const llmSaying = (subject: string, body: string): Llm => ({
  model: "test",
  async structured(_schema, opts) {
    return (opts.purpose === "writer.personalize" ? { subject, body } : null) as never;
  },
});

let state: AccountState;
let o: Opportunity;
let t: Touch;
let first: string;

function setUp(mentionPrice: boolean, stale = false) {
  const sample = generateSample({ trade: "tree", asOf: ASOF });
  const ds = sample.dataset;
  ds.business.voice = { ...ds.business.voice, mentionPrice };
  state = emptyState(ds, `${ASOF}T12:00:00Z`);
  state.scan = scan(ds);
  // a dead quote to someone with a first name, young enough that the price may be repeated (or not)
  o = state.scan.primary.find((x) => x.type === "unanswered_quote" && (stale ? x.ageDays > 200 : x.ageDays < 150) && ds.customers.find((c) => c.id === x.customerId)?.firstName)!;
  const c = ds.customers.find((x) => x.id === o.customerId)!;
  first = c.firstName;
  const n = renderNote(o, c, { ds, sendOn: ASOF }, 1)!;
  t = { id: "t1", opportunityId: o.id, customerId: c.id, channel: "email", step: 1, angle: n.angle, dueAt: `${ASOF}T09:00`, status: "approved", subject: n.subject, body: n.body, flags: n.flags };
}

/** A rewrite that only rephrases: no numbers, dates, deals or crews. */
const plain = () => `Hi ${first},\n\nSarah at Ridgeline Tree Co. again, about ${o.jobPhrase} we looked at for you. Is it still something you'd like done, or should I close it out?\n\nSarah`;
const withLine = (line: string) => plain().replace(/\n\nSarah$/, `\n\n${line}\n\nSarah`);

describe("the AI writer's guardrail", () => {
  beforeAll(() => setUp(false));

  it("keeps a rewrite that only rephrases the template", async () => {
    const r = await personalizeFirstNote(llmSaying(t.subject!, plain()), state, o, t);
    expect(r).not.toBeNull();
    expect(r!.flags).toEqual([]);
    expect(r!.body).toContain('Reply "stop"');
  });

  it.each([
    ["a discount and a crew date", "We have a crew open next Tuesday and I can take 200 off the original number if we get you on the books this week."],
    ["a spelled-out price when the owner said no prices", "It's still 850 dollars like we quoted, and we could be out tomorrow morning."],
    ["a warranty and a price match", "We're fully insured, give a 5 year warranty on the work, and we'll match any written quote."],
    ["a percentage", "I can knock ten percent off if you book now."],
    ["a dollar amount", "It would come to about $1,200 now."],
    ["a date", "We could do it the week of October 12."],
    ["a weekday", "Could Thursday work for a quick look?"],
    ["openings on the schedule", "We have openings next week if you want one."],
    ["a crew nearby", "Our crew is nearby, so we can swing it easily."],
    ["free work", "We'd throw in the stump grinding for free."],
    ["a made-up number", "We did 3 other trees on your street last fall."],
    ["a guarantee", "Our work is guaranteed, so there's no risk to you."],
  ])("throws away a rewrite that adds %s", async (_what, line) => {
    expect(await personalizeFirstNote(llmSaying(t.subject!, withLine(line)), state, o, t)).toBeNull();
  });

  it("checks the subject too", async () => {
    expect(await personalizeFirstNote(llmSaying("20% off the oak this week", plain()), state, o, t)).toBeNull();
  });
});

describe("the original price, only when the owner allows it", () => {
  it("may repeat the quoted amount when mentionPrice is on, never another one", async () => {
    setUp(true);
    const price = fmtMoney(o.value);
    expect(await personalizeFirstNote(llmSaying(t.subject!, withLine(`It was ${price} when we priced it.`)), state, o, t)).not.toBeNull();
    expect(await personalizeFirstNote(llmSaying(t.subject!, withLine(`It was ${fmtMoney(o.value - 100)} when we priced it.`)), state, o, t)).toBeNull();
  });
  it("never repeats an old quote's price, even with mentionPrice on", async () => {
    setUp(true, true);
    expect(await personalizeFirstNote(llmSaying(t.subject!, withLine(`It was ${fmtMoney(o.value)} when we priced it.`)), state, o, t)).toBeNull();
  });
  it("rejects the amount when mentionPrice is off", async () => {
    setUp(false);
    expect(await personalizeFirstNote(llmSaying(t.subject!, withLine(`It was ${fmtMoney(o.value)} when we priced it.`)), state, o, t)).toBeNull();
  });
});

describe("invented()", () => {
  const template = "Hi Mike,\n\nYou got a price from us back in May for the oak on 14 Oak Ln. Want me to get you on the schedule this week?\n\nSarah";
  it("allows what the template already says", () => {
    expect(invented("Mike, the oak on 14 Oak Ln from back in May: still want it on the schedule this week?", template)).toEqual([]);
  });
  it("names exactly what was added", () => {
    expect(invented("We can do the oak for $900 next Monday, and it's guaranteed.", template)).toEqual(["900", "$", "Monday", "guaranteed"]);
  });
});
