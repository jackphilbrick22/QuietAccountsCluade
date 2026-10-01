import { afterEach, describe, expect, it } from "vitest";
import { earlyLeaveRefund, feesPaid, generateSample, grossFees, guaranteeCheck, leadCode, paidYearOn, type OwnerMessage } from "@qa/engine";
import { deliverOwnerMessages, sendDue } from "../src/core/ops.ts";
import { readAmount, readLeadText } from "../src/core/owner.ts";
import { tick } from "../src/core/worker.ts";
import { ProviderError, type OwnerNotifier } from "../src/contracts.ts";
import { LogEmailProvider } from "../src/providers/email.ts";
import { LogNotifier } from "../src/providers/sms.ts";
import { addLead, harness, type Harness } from "./harness.ts";

let open: Harness[] = [];
const make = (...a: Parameters<typeof harness>) => {
  const h = harness(...a);
  open.push(h);
  return h;
};
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

/** A server that sells the yearly plan (FEATURE_YEARLY=on): RENEW, the renewal, refunds and UNDO after CANCEL. */
const yearlyOn = () => make({ env: { FEATURE_YEARLY: "on" } });

const state = (h: Harness, bid: string) => h.d.accounts.peek(bid)!.state;
const reply = (h: Harness, bid: string, rid: string) => state(h, bid).replies.find((r) => r.id === rid)!;
const pushOwner = (h: Harness, bid: string, m: Partial<OwnerMessage> & { id: string }) =>
  h.d.accounts.withAccount(bid, (s) => {
    s.ownerMessages.push({ at: "2026-09-29T09:30:00", kind: "handoff", text: "🌳 NEW — Kim Tran\nText back BOOKED + amount, DONE, or NO · #AAA", ...m });
  });

describe("reading an owner's text about a lead (n12, n38)", () => {
  it("never takes digits in the #code, dates, times or phone numbers as the amount", () => {
    expect(readAmount("booked #RK9")).toBe(0);
    expect(readAmount("booked 2400 #G3K")).toBe(2400);
    expect(readAmount("BOOKED $2,400.50 #K7Q")).toBe(2400.5);
    expect(readAmount("booked 2.4k")).toBe(2400);
    expect(readAmount("sold it 5k!")).toBe(5000);
    expect(readAmount("booked for 10/15 at 3pm")).toBe(0);
    expect(readAmount("booked, call 603-555-0142")).toBe(0);
    expect(readAmount("booked 3 trees for 1800")).toBe(1800);
  });
  it("a plain yes is never a booking, and 'no answer' wins over 'yes'", () => {
    expect(readLeadText("Yes, called her, no answer")).toEqual({ outcome: "no_answer", amount: 0 });
    expect(readLeadText("yes left a voicemail")).toEqual({ outcome: "no_answer", amount: 0 });
    expect(readLeadText("Yes, keep it going")).toBeUndefined();
    expect(readLeadText("yes")).toBeUndefined();
    expect(readLeadText("scheduled a site visit tuesday")).toBeUndefined();
    expect(readLeadText("booked 2400 #G3K")).toEqual({ outcome: "booked", amount: 2400 });
    expect(readLeadText("2400 #G3K")).toEqual({ outcome: "booked", amount: 2400 });
    expect(readLeadText("booked #RK9")).toEqual({ outcome: "booked", amount: 0 });
    expect(readLeadText("didn't book, too pricey")).toEqual({ outcome: "lost", amount: 0 });
    expect(readLeadText("No")).toEqual({ outcome: "lost", amount: 0 });
    expect(readLeadText("no problem")).toBeUndefined();
    expect(readLeadText("sent her a price")).toEqual({ outcome: "quoted", amount: 0 });
    expect(readLeadText("called")).toEqual({ outcome: undefined, amount: 0 });
    // "won't" is never a win
    expect(readLeadText("She won't go above 1200")).toBeUndefined();
    expect(readLeadText("He won't pick up")).toEqual({ outcome: "no_answer", amount: 0 });
    expect(readLeadText("won it, 3200")).toEqual({ outcome: "booked", amount: 3200 });
    // nothing negated is a booking, nor is someone else's; the iPhone's curly apostrophe reads like a straight one
    const lost = { outcome: "lost" as const, amount: 0 };
    const open = { outcome: undefined, amount: 0 }; // reached, not booked yet: never lost either
    const table: [string, ReturnType<typeof readLeadText>][] = [
      ["Won't book it", lost],
      ["won’t book it", lost],
      ["wont book", lost],
      ["He will not book", lost],
      ["Not gonna book it", lost],
      ["Didn’t book it", lost],
      ["didnt book it", lost],
      ["They booked someone else", lost],
      ["Lost it, they booked someone cheaper", lost],
      ["went with someone else", lost],
      ["He's going with someone else", lost],
      ["booked with another company", lost],
      ["He sold the house", lost],
      ["Won't book it unless we come down to 1800", open],
      ["hasn't booked yet", open],
      ["hasn’t booked yet", open],
      ["Not booked yet", open],
      ["Quoted him 2400, hasn't booked yet", { outcome: "quoted", amount: 0 }],
      ["He won’t pick up", { outcome: "no_answer", amount: 0 }],
      ["Didn’t answer", { outcome: "no_answer", amount: 0 }],
      // both ways at once: a person reads it
      ["Booked 2400, she won't sign up for the maintenance plan", { amount: 0, unclear: true }],
      ["Booked the oak 2400, she hasn't decided on the maple yet", { amount: 0, unclear: true }],
      ["Sold 3200, not gonna buy the stump grinding", { amount: 0, unclear: true }],
      ["Booked 2400 but they hired someone else for the stump", { amount: 0, unclear: true }],
      // another company mentioned is not another company hired
      ["Booked 2400, beat the other guy's price", { outcome: "booked", amount: 2400 }],
      ["Quoted her 2400, she's going with it", { outcome: "quoted", amount: 0 }],
      ["Quoted 2400, she's getting a price from another company too", { outcome: "quoted", amount: 0 }],
      ["Talked to her, she's getting quotes from another company", open],
      ["Called her, the other guy never showed up", open],
      // shopping around is still our lead
      ["Quoted her 2400, she's getting another quote", { outcome: "quoted", amount: 0 }],
      ["talked to her, she's getting another bid", open],
      // someone else got it, however it's said
      ["They found someone else", lost],
      ["Found someone cheaper", lost],
      ["got someone else to do it", lost],
      ["Someone else already did it", lost],
      ["another company did it", lost],
      ["she's got another guy", lost],
      ["went with another tree company", lost],
      ["they went with another roofer", lost],
      ["went with a local guy", lost],
      ["She went with Davey", lost],
      ["went w/someone else", lost],
      ["Going w someone else", lost],
      // one of our own options is not someone else; an option or plan we can't place goes to a person
      ["She went with the 2400 option", undefined],
      ["She went with my quote, 2400", { outcome: "booked", amount: 2400 }],
      ["Went with my price", { outcome: "booked", amount: 0 }],
      ["She's going with option 2, 3200", undefined],
      ["Decided to go with the $2,400 option", undefined],
      ["She went with the 2 tree option, 1800", undefined],
      ["Going with plan B", undefined],
      ["She went with the cheaper guy from town", { amount: 0, unclear: true }],
      // someone else won it, however it's said, with or without the price that lost it
      ["Someone else got the job, 1800 cheaper than my quote", lost],
      ["Another company got the job at a lower price", lost],
      ["Someone else got the job, lower bid", lost],
      ["Another guy got the job, beat my price", lost],
      ["Another company won the bid at 1800", lost],
      ["Someone else won the bid at 1800", lost],
      ["The other guy got the job for 1800", lost],
      ["Someone else booked it for 1800", lost],
      ["The other company won it", lost],
      ["She had another company, they won the bid", { amount: 0, unclear: true }],
      // shopping around, not hired
      ["Quoted 2400, she has another guy coming out Thursday", { outcome: "quoted", amount: 0 }],
      ["Quoted her 2400, someone else is coming out tomorrow to bid", { outcome: "quoted", amount: 0 }],
      ["Quoted 1800. She's got another company coming out Friday", { outcome: "quoted", amount: 0 }],
      ["Quoted 2400, she has the other guy's quote at 3000", { outcome: "quoted", amount: 0 }],
      ["Talked to her, someone else is looking at it Friday", open],
      ["Quoted 2400, she has another company giving her a price", { outcome: "quoted", amount: 0 }],
      ["Quoted 2400, someone else already quoted her 1800", { outcome: "quoted", amount: 0 }],
      ["Quoted 2400, she has another guy doing an estimate Friday", { outcome: "quoted", amount: 0 }],
      ["Quoted 2400, the other guy already quoted her 2000", { outcome: "quoted", amount: 0 }],
      ["someone else did an estimate too", undefined],
      // busy, not a booking
      ["We're booked solid till spring", undefined],
      ["Sold out till spring", undefined],
      // still bookings
      ["Booked the dead oak, 1800", { outcome: "booked", amount: 1800 }],
      ["SOLD 2.4k", { outcome: "booked", amount: 2400 }],
      ["No problem, booked him 900", { outcome: "booked", amount: 900 }],
    ];
    for (const [text, want] of table) expect(readLeadText(text), text).toEqual(want);
    // a competitor's estimate is shopping, never a loss
    expect(readLeadText("Called her, someone else already gave her an estimate")?.outcome).not.toBe("lost");
  });

  it("another company in the text: Claude reads whose win it was, a written amount only, and a person when unsure (review 12)", async () => {
    const h = make();
    await h.business("ridge");
    const said: string[] = [];
    let answer: { outcome: string; amount: number | null } = { outcome: "lost", amount: null };
    const texts = async (text: string, rid: string) => {
      await addLead(h, "ridge", rid, "Kim Tran", "2026-09-29T08:00:00");
      return h.sms(`${text} #${leadCode(rid)}`);
    };
    // no Claude: a person reads it, nothing is marked, and the lead isn't nudged as if nobody had called
    expect(await texts("Another tree service had a better price and won the job, 1800", "c0")).toMatch(/^Thanks — that one could go either way/);
    expect(reply(h, "ridge", "c0").status).toBe("handed_off");
    expect(reply(h, "ridge", "c0").nudges).toBe(2);
    h.d.llm = { model: "stub", structured: async (_s: unknown, o: { user: string }) => (said.push(o.user), answer) } as never;
    try {
      expect(await texts("Another tree service had a better price and won the job, 1800", "c1")).toMatch(/^Got it — Kim Tran marked not a fit\./);
      expect(await texts("The other guy had a lower bid and got the job", "c2")).toMatch(/^Got it — Kim Tran marked not a fit\./);
      expect(state(h, "ridge").recoveries).toEqual([]);
      answer = { outcome: "quoted", amount: null };
      expect(await texts("Quoted 2400, she has another guy coming out Thursday", "c3")).toMatch(/^Got it — Kim Tran has a price\. We'll count it when it books\./);
      // a booking's amount has to be written in the text: never a figure Claude made up
      answer = { outcome: "booked", amount: 3000 };
      expect(await texts("Beat the other guy's price, she booked us for 2400", "c4")).toMatch(/^Booked: Kim Tran\. What's the job worth\?/);
      answer = { outcome: "booked", amount: 2400 };
      expect(await texts("Beat the other guy's price, she booked us for 2400", "c5")).toMatch(/^Booked: Kim Tran, \$2,400\./);
      answer = { outcome: "unclear", amount: null };
      expect(await texts("Someone else already quoted her 1800 and she booked them", "c6")).toMatch(/^Thanks — that one could go either way/);
      // everyday shorthand for someone else's win reaches Claude too, never the booking patterns
      answer = { outcome: "lost", amount: null };
      for (const [i, t] of ["Other guy got the job, 1800", "Someone cheaper got the job for 1500", "Another plumber won the bid at 2100", "Competition got the job, 1900", "She booked Bartlett for 1800", "Her regular guy got the job"].entries())
        expect(await texts(t, `d${i}`), t).toMatch(/^Got it — Kim Tran marked not a fit\./);
      expect(said.length).toBe(12);
      // only the booking Claude read as ours, at the amount written in it
      expect(state(h, "ridge").recoveries.map((r) => r.value)).toEqual([2400]);
    } finally {
      h.d.llm = null;
    }
  });

  it("a booking is recorded by the patterns only when it's plainly the owner's; anything else is Claude's or a person's (review 14)", async () => {
    const h = make();
    await h.business("ridge");
    let n = 0;
    const texts = async (text: string) => {
      const rid = `p${n++}`;
      await addLead(h, "ridge", rid, "Kim Tran", "2026-09-29T08:00:00");
      return { out: await h.sms(`${text} #${leadCode(rid)}`), rid };
    };
    // plain bookings, no Claude key needed
    for (const [t, amount] of [["booked 2400", 2400], ["BOOKED $2,400", 2400], ["Booked it for 1800", 1800], ["She booked us for 2400", 2400], ["SOLD 2.4k", 2400], ["2400", 2400], ["Won it, 3200", 3200]] as const) {
      const { out, rid } = await texts(t);
      expect(out, t).toMatch(/^Booked: Kim Tran, \$/);
      expect(reply(h, "ridge", rid).outcomeValue, t).toBe(amount);
    }
    const before = state(h, "ridge").recoveries.length;
    // someone else's win, however it's said: with no key a person reads it, nothing is booked
    const others = ["Davey got the job, 1800", "A cheaper guy won the bid, 1500", "She booked with Davey for 1800", "Davey was cheaper, she booked them for 1800", "Her tree guy got the job, 1500", "Bartlett got the job for 1800", "SavATree got the job, 1900", "Lowballer won it, 1200", "Booked with Davey, 1800",
      // review 15: someone else in the object, she/he/they as the winner, a time read as the price
      "She booked the cheaper guy, 1500", "She booked her guy, 1800", "She booked her tree guy for 1800", "They booked the first guy, 1500", "She booked the lowest bid, 1500", "She booked him for 1500", "They got the job, 1800", "He won it, 1500", "They won the bid, 1500", "Booked her for 10 tomorrow, 2400", "Booked at 10 today, 950", "Booked for 11",
      // review 16: a time without a colon, or a year
      "Booked her for Thursday at 930", "Booked tomorrow at 1030", "Booked the estimate tomorrow at 1030", "Booked the job Thursday 830", "She booked us tomorrow at 1030", "Booked him at 130", "Booked her for March 2027",
      // review 17: shorthand times, appointment words, a trade named as the thing booked
      "Booked her tmrw 1030", "Booked her in for 1030", "Booked the estimate for 1030", "Booked her for weds 1030", "Booked her for May 2027", "Booked the cheaper roofer, 1500", "Booked the low bidder, 1500", "Booked their roofer 1800", "Booked the davey boys 1800",
      // review 18: "@" is "at"
      "Booked @ 1030", "Booked it @ 930", "She booked us @ 1030",
      // review 19: a clock time or a year right after "for"
      "Booked for 930", "Booked for 1030", "She booked us for 1030", "Booked it for 2027"];
    for (const t of others) expect((await texts(t)).out, t).toMatch(/^Thanks — that one could go either way/);
    expect(state(h, "ridge").recoveries.length).toBe(before);
    // with Claude, it reads them
    let asked = 0;
    h.d.llm = { model: "stub", structured: async () => (asked++, { outcome: "lost", amount: null }) } as never;
    try {
      for (const t of others) expect((await texts(t)).out, t).toMatch(/^Got it — Kim Tran marked not a fit\./);
    } finally {
      h.d.llm = null;
    }
    expect(asked).toBe(others.length);
    expect(state(h, "ridge").recoveries.length).toBe(before);
  });

  it("a negated booking, or someone else's, never books the lead or puts a dollar on the ledger (review 7)", async () => {
    const h = make();
    await h.business("ridge");
    const cases: [string, string][] = [
      ["Won't book it unless we come down to 1800", "Thanks — Kim Tran marked as reached."],
      ["Quoted him 2400, hasn't booked yet", "Got it — Kim Tran has a price. We'll count it when it books."],
      ["He sold the house", "Got it — Kim Tran marked not a fit."],
      ["Didn’t book it", "Got it — Kim Tran marked not a fit."],
    ];
    for (const [i, [text, want]] of cases.entries()) {
      const rid = `r${i}`;
      await addLead(h, "ridge", rid, "Kim Tran", "2026-09-29T08:00:00");
      expect(await h.sms(`${text} #${leadCode(rid)}`), text).toBe(want);
      expect(reply(h, "ridge", rid).outcome, text).not.toBe("booked");
    }
    expect(state(h, "ridge").recoveries).toEqual([]);
    expect(state(h, "ridge").events.some((e) => /^Booked/.test(e.title))).toBe(false);
    // it says both ways: the lead waits for a person, who sees the text
    await addLead(h, "ridge", "r-both", "Al Moss", "2026-09-29T08:00:00");
    expect(await h.sms(`Booked 2400, she won't sign up for the maintenance plan #${leadCode("r-both")}`)).toMatch(/^Thanks — that one could go either way, so Jack will read it and mark the lead himself\./);
    expect(reply(h, "ridge", "r-both").status).toBe("handed_off");
    expect(h.d.accounts.repo.ownerTexts("ridge")[0]).toMatchObject({ handled: "unclear_lead", needs_person: 1 });
    expect(state(h, "ridge").recoveries).toEqual([]);
    // a booking on the ledger is only taken back by a plain NO; a longer text about it goes to a person
    await addLead(h, "ridge", "r-kept", "Bea Cole", "2026-09-29T08:00:00");
    expect(await h.sms(`Booked 2400 #${leadCode("r-kept")}`)).toContain("Booked: Bea Cole, $2,400");
    expect(await h.sms(`#${leadCode("r-kept")} she won't sign up for the monthly plan though`)).toMatch(/Bea Cole is booked on your results\. To take that back, text NO #/);
    expect(state(h, "ridge").recoveries.filter((r) => !r.disputed).map((r) => r.value)).toEqual([2400]);
    expect(await h.sms(`NO #${leadCode("r-kept")}`)).toContain("Bea Cole marked not a fit");
    expect(state(h, "ridge").recoveries.filter((r) => !r.disputed)).toEqual([]);
  });
});

describe("one owner, two businesses on one cell (n4, n48)", () => {
  it("a business's short name is never a number, so it's never read as a dollar amount", async () => {
    const { shortNames } = await import("../src/core/owner.ts");
    const names = shortNames([{ id: "a", profile: { name: "Ridgeline Tree Co." } }, { id: "b", profile: { name: "360 Tree Care" } }]);
    expect(names.get("b")).toBe("CARE");
    // no word of its own: letters, never a piece of the id
    const two = shortNames([{ id: "ridgeline-tree-care-1a2b3", profile: { name: "Ridgeline Tree Care" } }, { id: "360-tree-care-20481", profile: { name: "360 Tree Care" } }]);
    expect(two.get("360-tree-care-20481")).toBe("TC");
    expect(two.get("360-tree-care-20481")).not.toMatch(/\d/);
  });

  it("SKIP searches the name as written first, even when a word in it is also a business's short name", async () => {
    const h = make();
    await h.business("aaa-tree", { name: "AAA Tree" });
    await h.business("bbb-tree", { name: "BBB Tree" });
    await addLead(h, "aaa-tree", "r-a", "John Bbb", "2026-09-29T08:00:00");
    await addLead(h, "bbb-tree", "r-b", "John Doe", "2026-09-29T09:00:00");
    expect(await h.sms("SKIP John Bbb")).toBe("AAA Tree: Done — John Bbb is off the list. We won't write to them again.");
    expect(state(h, "bbb-tree").dataset.customers.find((c) => c.name === "John Doe")!.doNotContact).toBeFalsy();
  });

  it("a #code with CANCEL is about the lead, never the whole service", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T08:00:00");
    expect(await h.sms(`Cancel #${leadCode("r1")}`)).toContain("To cancel the whole service, text CANCEL on its own");
    expect(state(h, "ridge").dataset.business.plan.stage).not.toBe("cancelled");
  });

  it("while one business waits for its OK, an old lead in the other never turns a change to the note into a command", async () => {
    const h = make();
    await h.business("aaa-tree", { name: "AAA Tree" });
    await h.business("bbb-tree", { name: "BBB Tree" });
    await addLead(h, "bbb-tree", "r-bbb-old", "Kim Tran", "2026-09-10T10:00:00");
    await h.d.accounts.withAccount("aaa-tree", (s) => {
      s.awaitingOwnerOk = "2026-09-29T09:00:00";
    });
    // short edits that mention quoted, booked, sold or won are edits too (review 7): a person gets each one
    const shortEdits = ["Say estimate, not quoted", "Say we're booked till spring", "Mention we won an award", "Change sold to finished", "Say booked solid", "Don't say quoted", "Don’t say sold", "Remove 'sold out'", "Quoted, change to estimate"];
    for (const text of ["No, say Hey instead of Hi", "Hold on, can you change the greeting to Hey AAA", "Free quote, not free estimate AAA", "Go with Hey instead of Hi AAA", "Add that we won Best of Concord 2025", "Say we won't email them again", "Say we sent them an estimate last year", ...shortEdits]) {
      expect(await h.sms(text), text).toMatch(/^AAA Tree: Got it — we'll make that change/);
      expect(h.d.accounts.repo.ownerTexts("aaa-tree")[0], text).toMatchObject({ body: text, handled: "first_note_change", needs_person: 1 });
    }
    expect(reply(h, "bbb-tree", "r-bbb-old").status).toBe("handed_off");
    expect(state(h, "bbb-tree").recoveries).toEqual([]);
    expect(h.d.accounts.peek("aaa-tree")!.paused).toBe(false);
    // a lead that just came in: a short "no" with more after it is still about the note; a booking is about the lead
    await addLead(h, "bbb-tree", "r-bbb-new", "Al Moss", "2026-09-29T09:20:00");
    for (const text of ["No, say Hey", "No, too pushy", ...shortEdits]) expect(await h.sms(text), text).toMatch(/^AAA Tree: Got it — we'll make that change/);
    expect(reply(h, "bbb-tree", "r-bbb-new").status).toBe("handed_off");
    expect(reply(h, "bbb-tree", "r-bbb-old").status).toBe("handed_off");
    // the close is out for BBB: "Ok but…" is a change to AAA's note, never a yes to BBB's plan
    await h.d.accounts.withAccount("bbb-tree", (s) => {
      s.ownerMessages.push({ id: "om-close-bbb", at: "2026-09-25T09:00:00", kind: "close", text: "Your free round is done…" });
    });
    for (const text of ["Ok but say Hey instead of Hi", "Sure, change the sign-off to Mike"]) expect(await h.sms(text), text).toMatch(/^AAA Tree: Got it — we'll make that change/);
    expect(state(h, "bbb-tree").events.some((e) => /said yes to keep going/.test(e.title))).toBe(false);
    expect(await h.sms(`booked 2400 #${leadCode("r-bbb-new")}`)).toContain("Booked: Al Moss, $2,400");
    expect(await h.sms("booked 1800")).not.toMatch(/make that change/);
    // read as a lead with no code while a note waits: a person looks too
    expect(h.d.accounts.repo.ownerTexts("bbb-tree")[0]).toMatchObject({ body: "booked 1800", handled: "booked", needs_person: 1 });
  });

  it("with both businesses waiting for their OK, a change to a note asks which one and reaches a person; it never acts on a lead (review 7)", async () => {
    const h = make();
    await h.business("aaa-tree", { name: "AAA Tree" });
    await h.business("bbb-tree", { name: "BBB Tree" });
    for (const bid of ["aaa-tree", "bbb-tree"])
      await h.d.accounts.withAccount(bid, (s) => {
        s.awaitingOwnerOk = "2026-09-29T09:00:00";
      });
    const latest = () => h.d.accounts.repo.db.all<{ body: string; handled: string; needs_person: number }>("SELECT * FROM owner_texts ORDER BY seq DESC LIMIT 1")[0]!;
    const which = /^AAA Tree and BBB Tree are both waiting for your OK on the first note\. Which one is that about\? Text it again with the name, like ".+ AAA" or ".+ BBB"\. Nothing goes out until you say OK\.$/;
    // nothing else open: never "Nobody's waiting on a call" or a bare "Got it" that drops the text
    for (const text of ["No, say Hey instead of Hi", "Say we emailed them last spring", "Take out the part where we called", "Let's do it", "Absolutely", "Say estimate, not quoted"]) {
      expect(await h.sms(text), text).toMatch(which);
      expect(latest(), text).toMatchObject({ body: text, handled: "first_note_change", needs_person: 1 });
    }
    // a lead waiting in BBB: the same texts never mark it lost or quoted
    await addLead(h, "bbb-tree", "r-bbb", "Kim Tran", "2026-09-29T09:20:00");
    for (const text of ["No, say Hey instead of Hi", "No, too pushy", "Don't say quoted", "Say we're booked till spring"]) {
      expect(await h.sms(text), text).toMatch(which);
      expect(latest(), text).toMatchObject({ body: text, handled: "first_note_change", needs_person: 1 });
    }
    expect(reply(h, "bbb-tree", "r-bbb").status).toBe("handed_off");
    expect(state(h, "bbb-tree").recoveries).toEqual([]);
    // an OK with no name still asks which; with the name it's that business's note
    expect(await h.sms("OK")).toMatch(/^This number runs AAA Tree and BBB Tree\. Which one\?/);
    expect(await h.sms("Say Hey instead of Hi AAA")).toMatch(/^AAA Tree: Got it — we'll make that change/);
    expect(await h.sms("OK AAA")).toMatch(/^AAA Tree: Done — the first notes go out/);
    expect(state(h, "bbb-tree").awaitingOwnerOk).toBeTruthy();
    // a lead outcome said plainly is still about the lead, and a person looks too
    expect(await h.sms("booked 2400")).toBe("BBB Tree: Booked: Kim Tran, $2,400. Added to your results.");
    expect(latest()).toMatchObject({ handled: "booked", needs_person: 1 });
  });

  it("a trial owner texting MONTHLY or YEARLY goes to Jack for the payment link; nothing turns paying on a text", async () => {
    const h = yearlyOn();
    await h.business("aaa-tree", { name: "AAA Tree" });
    await h.d.accounts.withAccount("aaa-tree", (s) => {
      s.awaitingOwnerOk = "2026-09-29T09:00:00";
    });
    for (const text of ["Monthly", "yearly"]) {
      expect(await h.sms(text)).toMatch(/it is\. Jack will text you the payment link\./);
      expect(state(h, "aaa-tree").dataset.business.plan.stage).toBe("trial");
      expect(state(h, "aaa-tree").awaitingOwnerOk).toBeTruthy();
    }
    // MONTHLY's first month waits for Jack's OK; the year is his to settle by hand
    expect(h.d.accounts.repo.ownerTexts("aaa-tree").map((t) => [t.body, t.handled, t.needs_person])).toEqual([
      ["yearly", "accepted_by_hand", 1],
      ["Monthly", "accepted_close", 1],
    ]);
  });

  it("books by the #code in the text, pauses and cancels only the one named, and asks instead of guessing", async () => {
    const h = yearlyOn();
    await h.business("aaa-tree", { name: "AAA Tree" });
    const second = await h.business("bbb-tree", { name: "BBB Tree" });
    expect(String((second.warnings as string[])[0])).toMatch(/AAA Tree uses the same cell.*PAUSE BBB/);
    await addLead(h, "aaa-tree", "r-aaa-1", "Dan Ruiz", "2026-09-29T08:00:00");
    await addLead(h, "bbb-tree", "r-bbb-1", "Kim Tran", "2026-09-29T09:00:00");

    // the code on BBB's hand-off text finds BBB's lead, and the $ is the amount, not the code's digits
    const booked = await h.sms(`booked 2400 #${leadCode("r-bbb-1")}`);
    expect(booked).toBe("BBB Tree: Booked: Kim Tran, $2,400. Added to your results. 1 more waiting.");
    expect(reply(h, "bbb-tree", "r-bbb-1")).toMatchObject({ outcome: "booked", outcomeValue: 2400 });
    expect(state(h, "bbb-tree").recoveries.map((r) => r.value)).toEqual([2400]);
    expect(reply(h, "aaa-tree", "r-aaa-1").status).toBe("handed_off");

    // no code: the one lead still waiting across both is unambiguous
    expect(await h.sms("booked 1800")).toContain("AAA Tree: Booked: Dan Ruiz, $1,800.");
    // two waiting (one each): ask, never guess
    await addLead(h, "aaa-tree", "r-aaa-2", "Bea Cole", "2026-09-29T09:10:00");
    await addLead(h, "bbb-tree", "r-bbb-2", "Al Moss", "2026-09-29T09:20:00");
    const which = await h.sms("booked 900");
    expect(which).toMatch(/^Which one\? 2 are waiting: Al Moss \(BBB Tree\) #\w{3}, Bea Cole \(AAA Tree\) #\w{3}\. Text it again with the code, like "BOOKED 900 #\w{3}"\.$/);
    expect(reply(h, "aaa-tree", "r-aaa-2").status).toBe("handed_off");
    expect(reply(h, "bbb-tree", "r-bbb-2").status).toBe("handed_off");

    // service commands need the business when the phone runs two
    expect(await h.sms("PAUSE")).toBe('This number runs AAA Tree and BBB Tree. Which one? Text it again with the name, like "PAUSE AAA" or "PAUSE BBB".');
    expect(h.d.accounts.peek("aaa-tree")!.paused || h.d.accounts.peek("bbb-tree")!.paused).toBe(false);
    expect(await h.sms("pause bbb")).toBe("BBB Tree: Paused. No notes will go out until you text RESUME.");
    expect(h.d.accounts.peek("bbb-tree")!.paused).toBe(true);
    expect(h.d.accounts.peek("aaa-tree")!.paused).toBe(false);

    expect(await h.sms("CANCEL")).toMatch(/Which one\?.*"CANCEL AAA" or "CANCEL BBB"/);
    expect(state(h, "aaa-tree").dataset.business.plan.stage).toBe("trial");
    expect(await h.sms("cancel BBB")).toMatch(/^BBB Tree: Done — cancelled\..*Text UNDO BBB by .* tomorrow/);
    // UNDO puts a (non-yearly) cancel back by itself, the same day
    expect(await h.sms("undo")).toMatch(/^BBB Tree: Back on\. Nothing was lost\./);
    expect(state(h, "bbb-tree").dataset.business.plan.stage).toBe("trial");
    expect(await h.sms("cancel BBB")).toMatch(/^BBB Tree: Done — cancelled/);
    expect(state(h, "bbb-tree").dataset.business.plan.stage).toBe("cancelled");
    expect(state(h, "aaa-tree").dataset.business.plan.stage).toBe("trial");
    expect(h.d.accounts.peek("aaa-tree")!.paused).toBe(false);

    const status = await h.sms("status");
    expect(status.split("\n")).toHaveLength(2);
    expect(status).toMatch(/^AAA Tree: So far:.*\nBBB Tree: So far:.*\$2,400 booked\.$/);
    // every text is on file for the operator
    expect(h.d.accounts.repo.ownerTexts("bbb-tree").map((t) => t.handled)).toContain("cancel");
  });

  it("ignores a From with fewer than ten digits, even for a client with no cell", async () => {
    const h = make();
    await h.business("no-cell", { ownerPhone: undefined });
    expect(await h.sms("CANCEL YES", "")).toMatch(/don't recognize this number/);
    expect(await h.sms("pause", "+1555")).toMatch(/don't recognize this number/);
    expect(state(h, "no-cell").dataset.business.plan.stage).toBe("trial");
  });
});

describe("one owner, one business: what a text does (n12, n38, n48)", () => {
  it("'Yes' to the close goes to the operator, not onto the newest lead", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Beth Gallagher", "2026-09-29T08:00:00");
    await pushOwner(h, "ridge", { id: "om-close", kind: "close", text: "Dave, the free 150 is done. Say yes by Friday 2 and the next batch goes out next week." });
    expect(await h.sms("Yes, let's keep going")).toBe("Great — Jack will text you the payment link, and the next batch goes out next week.");
    expect(reply(h, "ridge", "r1")).toMatchObject({ status: "handed_off" });
    expect(reply(h, "ridge", "r1").outcome).toBeUndefined();
    const review = (await h.api("GET", "/api/review")).json.items as { kind: string; handled?: string; text?: string; seq?: number }[];
    const yes = review.find((i) => i.kind === "owner_text")!;
    expect(yes).toMatchObject({ handled: "accepted_close", text: "Yes, let's keep going" });
    // "Called her, no answer" is a no answer, and stays out of the ledger
    expect(await h.sms("Yes, called her, no answer")).toBe("Got it — no answer from Beth Gallagher. Try again tomorrow.");
    expect(reply(h, "ridge", "r1").outcome).toBe("no_answer");
    expect(state(h, "ridge").recoveries).toEqual([]);
    // handled: the item leaves the queue
    await h.api("POST", `/api/businesses/ridge/owner-texts/${yes.seq}/done`);
    expect(((await h.api("GET", "/api/review")).json.items as { kind: string }[]).some((i) => i.kind === "owner_text")).toBe(false);
  });

  it("a code ending in a digit is never the amount, and a corrected amount replaces the first", async () => {
    const h = make();
    await h.business("ridge");
    let rid = "r-0";
    for (let i = 0; !/\d$/.test(leadCode(rid)); i++) rid = `r-${i}`;
    const code = leadCode(rid);
    await addLead(h, "ridge", rid, "Kim Tran", "2026-09-29T08:00:00");
    expect(await h.sms(`booked #${code}`)).toBe(`Booked: Kim Tran. What's the job worth? Text "booked 2400 #${code}".`);
    expect(state(h, "ridge").recoveries).toEqual([]);
    expect(await h.sms(`booked 240 #${code}`)).toBe("Booked: Kim Tran, $240. Added to your results.");
    expect(await h.sms(`booked 2400 #${code}`)).toBe("Booked: Kim Tran, $2,400. Added to your results.");
    expect(state(h, "ridge").recoveries.map((r) => r.value)).toEqual([2400]);
  });

  it("with two leads waiting, a text with no code asks which; with the code it acts", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T08:00:00");
    await addLead(h, "ridge", "r2", "Dan Ruiz", "2026-09-29T09:00:00");
    expect(await h.sms("booked 2400")).toBe(`Which one? 2 are waiting: Dan Ruiz #${leadCode("r2")}, Kim Tran #${leadCode("r1")}. Text it again with the code, like "BOOKED 2400 #${leadCode("r2")}".`);
    expect(state(h, "ridge").replies.every((r) => r.status === "handed_off")).toBe(true);
    expect(await h.sms(`NO #${leadCode("r1")}`)).toBe("Got it — Kim Tran marked not a fit. 1 more waiting.");
    expect(await h.sms("booked 2400")).toBe("Booked: Dan Ruiz, $2,400. Added to your results.");
  });

  it("a text we can't read goes to the operator with a reply that says so", async () => {
    const h = make();
    await h.business("ridge");
    expect(await h.sms("my truck broke down, call me when you can")).toMatch(/^Thanks — Jack will read this and get back to you\./);
    const items = (await h.api("GET", "/api/review")).json.items as { kind: string; text: string; handled: string }[];
    expect(items).toEqual([expect.objectContaining({ kind: "owner_text", text: "my truck broke down, call me when you can", handled: "unrecognized" })]);
    const log = (await h.api("GET", "/api/businesses/ridge/owner-texts")).json as { body: string }[];
    expect(log[0]!.body).toBe("my truck broke down, call me when you can");
    // "don't email the Johnsons" is a skip; with no Johnsons on file it goes to the operator too, and says so
    expect(await h.sms("don't email the Johnsons, they're family")).toBe(`I couldn't find "the johnsons" in your records. Jack will check and take them off by hand.`);
  });
});

describe("carrier keywords and cancelling (n27)", () => {
  it("STOP turns our texts off (hand-offs go by email instead), START turns them back on", async () => {
    const h = make();
    const notifier = h.d.notifier as LogNotifier;
    const email = h.d.email as LogEmailProvider;
    await h.business("ridge");
    const stop = await h.sms("STOP");
    expect(stop).toBe("OK — no more texts from us. Your follow-ups keep running; hot leads and reports come to dave@ridgelinetree.com instead. Text START to get texts again. To end the service itself, text CANCEL.");
    expect(state(h, "ridge").dataset.business.ownerTextsOff).toMatchObject({ by: "owner" });
    expect(state(h, "ridge").dataset.business.plan.stage).toBe("trial");
    await pushOwner(h, "ridge", { id: "om-1" });
    await deliverOwnerMessages(h.d, "ridge");
    expect(notifier.sent).toHaveLength(0);
    expect(email.sent.at(-1)).toMatchObject({ to: "dave@ridgelinetree.com", fromName: "Quiet Accounts" });
    expect(email.sent.at(-1)!.text).toContain("The owner texted STOP, so this came by email.");
    expect(h.d.accounts.repo.ownerMessages("ridge")[0]).toMatchObject({ delivery: "sent", channel: "email" });

    expect(await h.sms("start")).toBe("Texts are back on.");
    expect(state(h, "ridge").dataset.business.ownerTextsOff).toBeUndefined();
    await pushOwner(h, "ridge", { id: "om-2", at: "2026-09-29T09:40:00" });
    await deliverOwnerMessages(h.d, "ridge");
    expect(notifier.sent).toHaveLength(1);
  });

  it("after CANCEL nothing more goes to the owner: no Friday report, no reminders, no queued texts", async () => {
    const h = make();
    const notifier = h.d.notifier as LogNotifier;
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T08:00:00");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.touches.push({ id: "t1", opportunityId: "o1", customerId: "c-r1", channel: "email", step: 1, angle: "check_in", dueAt: "2026-09-29T08:00", status: "sent", sentAt: "2026-09-29T08:00:00", body: "Hi Kim", flags: [] });
    });
    expect(await h.sms("cancel")).toMatch(/^Done — cancelled\. No more notes, no more charges\./);
    await pushOwner(h, "ridge", { id: "om-late", kind: "info", text: "Heads up" });
    for (const at of ["2026-10-02T20:30:00Z", "2026-10-09T20:30:00Z", "2026-10-16T20:30:00Z"]) {
      h.setNow(at); // Fridays, 4:30pm New York
      await tick(h.d);
    }
    expect(notifier.sent).toEqual([]);
    const s = state(h, "ridge");
    expect(s.ownerMessages.filter((m) => m.kind === "weekly" || m.kind === "sla_nudge")).toEqual([]);
    expect(h.d.accounts.repo.ownerMessages("ridge").find((m) => m.id === "om-late")!.delivery).toBe("skipped");
    // START afterwards turns texts on, but never un-cancels
    expect(await h.sms("RESUME")).toMatch(/You're cancelled, so nothing's running/);
    expect(state(h, "ridge").dataset.business.plan.stage).toBe("cancelled");
  });
});

describe("owner messages never vanish into a log (n46)", () => {
  it("no cell: emailed through the mail provider; no email route either: failed, in the review queue", async () => {
    const h = make();
    const email = h.d.email as LogEmailProvider;
    await h.business("mail-only", { ownerPhone: undefined });
    await h.business("nothing", { ownerPhone: undefined, ownerEmail: undefined });
    const ov = (await h.api("GET", "/api/businesses/mail-only")).json as { readiness: { ready: boolean; gaps: { id: string; level: string }[] } };
    expect(ov.readiness.gaps.find((g) => g.id === "no_owner_cell")?.level).toBe("blocker");
    await pushOwner(h, "mail-only", { id: "om-a" });
    await pushOwner(h, "nothing", { id: "om-b" });
    await deliverOwnerMessages(h.d);
    expect(h.d.accounts.repo.ownerMessages("mail-only")[0]).toMatchObject({ delivery: "sent", channel: "email" });
    expect(email.sent.at(-1)!.text).toContain("No cell on file, so this came by email.");
    expect(h.d.accounts.repo.ownerMessages("nothing")[0]).toMatchObject({ delivery: "failed", channel: null });
    const items = (await h.api("GET", "/api/review")).json.items as { kind: string; businessId: string; delivery?: string }[];
    expect(items).toEqual([expect.objectContaining({ kind: "owner_message", businessId: "nothing", delivery: "failed" })]);
  });

  it("a carrier opt-out (Twilio 21610) switches the owner to email and tells the operator", async () => {
    const refused: OwnerNotifier = {
      name: "twilio",
      notify: async () => {
        throw new ProviderError("Twilio 400 (21610): Attempt to send to unsubscribed recipient", "twilio", 400, false);
      },
    };
    const h = make({ notifier: refused });
    await h.business("ridge");
    await pushOwner(h, "ridge", { id: "om-1" });
    await deliverOwnerMessages(h.d, "ridge");
    expect(state(h, "ridge").dataset.business.ownerTextsOff).toMatchObject({ by: "carrier" });
    expect(h.d.accounts.repo.ownerMessages("ridge")[0]).toMatchObject({ delivery: "sent", channel: "email" });
    const items = (await h.api("GET", "/api/review")).json.items as { kind: string; title?: string }[];
    expect(items.find((i) => i.kind === "alert")!.title).toMatch(/refuses our texts/);
  });
});

describe("reminders survive a restart (n17, n53)", () => {
  it("SKIP survives a deploy: the person stays off the list", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r-erin", "Erin Grant", "2026-09-29T08:00:00");
    // one more save first, so the lists are ones the database has already seen
    await h.d.accounts.withAccount("ridge", () => {});
    expect(await h.sms("Don't email Erin Grant, they're family")).toContain("Erin Grant is off the list");
    const a = h.restart();
    open.push(a);
    expect(a.d.accounts.peek("ridge")!.state.dataset.customers.find((c) => c.id === "c-r-erin")!.doNotContact).toBe(true);
  });

  it("a renewal ask is never asked twice after a deploy, however many texts came since", async () => {
    const h = yearlyOn();
    await h.business("ridge");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.ownerMessages.push({ id: "om-renewal", at: "2026-09-20T09:00:00", kind: "renewal", text: "Your year with us ends Oct 20.", refs: [{ kind: "year_end", id: "2026-10-20" }] });
    });
    for (let i = 0; i < 320; i++) h.d.accounts.repo.db.run("INSERT INTO owner_messages (business_id, id, at, kind, text, delivery, data) VALUES (?, ?, ?, 'handoff', 'x', 'sent', ?)", "ridge", `om-h-${i}`, `2026-09-2${1 + (i % 8)}T10:00:00`, JSON.stringify({ id: `om-h-${i}`, at: "2026-09-21T10:00:00", kind: "handoff", text: "x" }));
    const a = h.restart();
    open.push(a);
    expect(a.d.accounts.peek("ridge")!.state.ownerMessages.some((m) => m.id === "om-renewal")).toBe(true);
  });

  it("the wait for the OK, the quiet rate before we started and a CANCEL all survive a deploy", async () => {
    const h = yearlyOn();
    await h.business("ridge");
    const before = { rate: 0.42, quiet: 21, quotes: 50, value: 61200, on: "2026-09-29" } as never;
    await h.d.accounts.withAccount("ridge", (s) => {
      s.awaitingOwnerOk = "2026-09-29T09:00:00";
      s.quietBefore = before;
    });
    const a = h.restart();
    open.push(a);
    expect(a.d.accounts.peek("ridge")!.state).toMatchObject({ awaitingOwnerOk: "2026-09-29T09:00:00", quietBefore: before });
    expect(await a.sms("OK")).toContain("the first notes go out");
    expect(await a.sms("CANCEL")).toMatch(/Done — cancelled/);
    const b = a.restart();
    open.push(b);
    expect(b.d.accounts.peek("ridge")!.state.cancelled?.stageBefore).toBe("trial");
    expect(await b.sms("UNDO")).toMatch(/^Back on\./);
    expect(b.d.accounts.peek("ridge")!.state.dataset.business.plan.stage).toBe("trial");
    const c = b.restart();
    open.push(c);
    expect(c.d.accounts.peek("ridge")!.state.cancelled).toBeUndefined();
  });

  it("a lead nudged twice is never nudged again after a deploy, however many texts came since", async () => {
    const h = make();
    const notifier = h.d.notifier as LogNotifier;
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Bill Iverson", "2026-09-29T10:00:00");
    for (const at of ["2026-09-29T18:30:00Z", "2026-09-30T14:30:00Z"]) {
      h.setNow(at);
      await tick(h.d);
    }
    const nudges = () => notifier.sent.filter((m) => /still waiting/.test(m.text)).length;
    expect(nudges()).toBe(2);
    // 320 later owner texts push the nudges out of the recent-messages window
    for (let i = 0; i < 320; i++) h.d.accounts.repo.db.run("INSERT INTO owner_messages (business_id, id, at, kind, text, delivery, data) VALUES (?, ?, ?, 'info', 'x', 'sent', ?)", "ridge", `om-x-${i}`, `2026-10-01T09:${String(i % 60).padStart(2, "0")}:00`, JSON.stringify({ id: `om-x-${i}`, at: "2026-10-01T09:00:00", kind: "info", text: "x" }));
    const after = h.restart();
    open.push(after);
    const n2 = after.d.notifier as LogNotifier;
    for (const at of ["2026-10-01T14:30:00Z", "2026-10-02T14:30:00Z"]) {
      after.setNow(at);
      await tick(after.d);
    }
    expect(n2.sent.filter((m) => /still waiting/.test(m.text))).toEqual([]);
    expect(after.d.accounts.peek("ridge")!.state.replies[0]!.nudges).toBe(2);
  });
});

describe("final review: what an owner's text is about", () => {
  const latest = (h: Harness, bid: string) => h.d.accounts.repo.ownerTexts(bid)[0]!;

  it("with no #code, a lead the owner already reported counts next to the one waiting: it asks, never books or loses the other (final 8)", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r-karen", "Karen Whitfield", "2026-09-29T08:00:00");
    await addLead(h, "ridge", "r-bob", "Bob Jones", "2026-09-29T09:00:00");
    const karen = leadCode("r-karen");
    const bob = leadCode("r-bob");
    // the amount right after "What's the job worth?": Karen's or Bob's, so it asks, and a person sees it
    expect(await h.sms(`Booked #${karen}`)).toBe(`Booked: Karen Whitfield. What's the job worth? Text "booked 2400 #${karen}". 1 more waiting.`);
    expect(await h.sms("2400")).toBe(`Which one? That could be Bob Jones #${bob} or Karen Whitfield #${karen}. Text it again with the code, like "2400 #${bob}".`);
    expect(latest(h, "ridge")).toMatchObject({ handled: "ask_lead", needs_person: 1 });
    expect(reply(h, "ridge", "r-bob").status).toBe("handed_off");
    expect(reply(h, "ridge", "r-bob").ownerContactedAt).toBeUndefined();
    expect(state(h, "ridge").recoveries).toEqual([]);
    // a correction after a booking never marks the waiting lead lost
    expect(await h.sms(`booked 240 #${karen}`)).toBe("Booked: Karen Whitfield, $240. Added to your results. 1 more waiting.");
    expect(await h.sms("No wait, it was 2400 not 240")).toMatch(/^Which one\? That could be Bob Jones #\w{3} or Karen Whitfield #\w{3}\. Text it again with the code/);
    expect(latest(h, "ridge")).toMatchObject({ handled: "ask_lead", needs_person: 1 });
    expect(reply(h, "ridge", "r-bob").status).toBe("handed_off");
    expect(reply(h, "ridge", "r-bob").outcome).toBeUndefined();
    // a new booking with an amount is still the one waiting's: Karen's figure is already in
    expect(await h.sms("booked 1800")).toBe("Booked: Bob Jones, $1,800. Added to your results.");
    expect(state(h, "ridge").recoveries.filter((r) => !r.disputed).map((r) => r.value)).toEqual([240, 1800]);
  });

  it("with only the reported lead, the amount alone goes to it; a NO without the code never takes a booking back, and a booking is never dropped (final 8, A4)", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r-karen", "Karen Whitfield", "2026-09-29T08:00:00");
    const karen = leadCode("r-karen");
    expect(await h.sms(`Booked #${karen}`)).toBe(`Booked: Karen Whitfield. What's the job worth? Text "booked 2400 #${karen}".`);
    // once "Nobody's waiting on a call right now" (and Karen's $2,400 never reached the ledger)
    expect(await h.sms("2400")).toBe("Booked: Karen Whitfield, $2,400. Added to your results.");
    expect(state(h, "ridge").recoveries.map((r) => r.value)).toEqual([2400]);
    expect(await h.sms("No")).toBe(`Karen Whitfield is booked on your results. To take that back, text NO #${karen}. Jack will read this too.`);
    expect(latest(h, "ridge")).toMatchObject({ handled: "booked_kept", needs_person: 1 });
    expect(state(h, "ridge").recoveries.filter((r) => !r.disputed).map((r) => r.value)).toEqual([2400]);
    // a booking we can't place reaches a person (A4)
    expect(await h.sms("Booked 900")).toBe("Got it, Jack will match it.");
    expect(latest(h, "ridge")).toMatchObject({ handled: "match_booking", needs_person: 1 });
  });

  it("QUOTED, then a booking days later with no #code while another lead waits: it asks; the code books it (final 8)", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r-kim", "Kim Tran", "2026-09-29T09:30:00");
    const kim = leadCode("r-kim");
    expect(await h.sms(`Quoted her 2400 #${kim}`)).toBe("Got it — Kim Tran has a price. We'll count it when it books.");
    h.setNow("2026-10-02T14:00:00Z");
    await addLead(h, "ridge", "r-dan", "Dan Ruiz", "2026-10-02T08:00:00");
    expect(await h.sms("She booked us for 2400")).toMatch(/^Which one\? That could be Dan Ruiz #\w{3} or Kim Tran #\w{3}\./);
    expect(latest(h, "ridge")).toMatchObject({ handled: "ask_lead", needs_person: 1 });
    expect(reply(h, "ridge", "r-dan").status).toBe("handed_off");
    expect(state(h, "ridge").recoveries).toEqual([]);
    expect(await h.sms(`She booked us for 2400 #${kim}`)).toBe("Booked: Kim Tran, $2,400. Added to your results. 1 more waiting.");
    expect(reply(h, "ridge", "r-dan").status).toBe("handed_off");
  });

  it("the code typed without its '#' picks the lead it names (final 8)", async () => {
    const h = make();
    await h.business("ridge");
    let rid = "r-0";
    for (let i = 0; !/^[A-Z]{3}$/.test(leadCode(rid)); i++) rid = `r-${i}`;
    const karen = leadCode(rid);
    await addLead(h, "ridge", rid, "Karen Whitfield", "2026-09-29T08:00:00");
    await addLead(h, "ridge", "r-bob", "Bob Jones", "2026-09-29T09:00:00");
    expect(await h.sms(`Booked #${karen}`)).toMatch(/^Booked: Karen Whitfield\. What's the job worth\?/);
    h.d.llm = { model: "stub", structured: async () => ({ outcome: "booked", amount: 2400 }) } as never;
    try {
      expect(await h.sms(`Booked 2400 ${karen}`)).toBe("Booked: Karen Whitfield, $2,400. Added to your results. 1 more waiting.");
    } finally {
      h.d.llm = null;
    }
    expect(reply(h, "ridge", "r-bob").status).toBe("handed_off");
    expect(state(h, "ridge").recoveries.map((r) => r.value)).toEqual([2400]);
  });

  it("'Go for it' / 'Go ahead' answers the close or the renewal, never RESUME; RESUME still resumes (final 9)", async () => {
    const h = yearlyOn();
    await h.business("ridge");
    await pushOwner(h, "ridge", { id: "om-close", kind: "close", text: "Dave, the free 150 is done. Say yes by Friday 2 and the next batch goes out next week." });
    for (const text of ["Go for it", "Go ahead", "Go ahead and keep it going", "Go!"]) {
      expect(await h.sms(text), text).toBe("Great — Jack will text you the payment link, and the next batch goes out next week.");
      // with the yearly plan sold, which one is Jack's to settle: no first month's text
      expect(latest(h, "ridge"), text).toMatchObject({ handled: "accepted_by_hand", needs_person: 1 });
    }
    expect(state(h, "ridge").dataset.business.plan.months).toBeUndefined();
    expect(state(h, "ridge").events.some((e) => /said yes to keep going/.test(e.title))).toBe(true);
    expect(state(h, "ridge").dataset.business.plan.stage).toBe("trial");

    // the renewal: the yes is kept, and asked which, never "Back on"
    const r = yearlyOn();
    await r.business("ridge");
    await r.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", billing: "annual", paidOn: "2025-10-20", yearsPaidOn: ["2025-10-20"] } });
    await r.d.accounts.withAccount("ridge", (s) => {
      s.ownerMessages.push({ id: "om-renewal", at: "2026-09-20T09:00:00", kind: "renewal", text: "Your year with us ends Oct 20.", refs: [{ kind: "year_end", id: "2026-10-20" }] });
    });
    expect(await r.sms("Go ahead")).toBe("Great — which one: RENEW for another year, or MONTHLY to go month to month?");
    expect(latest(r, "ridge")).toMatchObject({ handled: "ask_renewal" });
    expect(state(r, "ridge").dataset.business.plan.yearsPaidOn).toEqual(["2025-10-20"]);

    // nothing outstanding: RESUME (and a bare GO) still resume
    const p = make();
    await p.business("ridge");
    for (const text of ["RESUME", "go"]) {
      expect(await p.sms("PAUSE")).toMatch(/^Paused\./);
      expect(await p.sms(text), text).toBe("Back on. Notes resume on your next send day.");
      expect(p.d.accounts.peek("ridge")!.paused, text).toBe(false);
    }
  });

  it("a text with a #code is about that lead: never a plan change, a pause or booked-out mode (final 11)", async () => {
    const h = make();
    await h.business("ridge");
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", billing: "monthly", paidOn: "2026-06-01" } });
    await addLead(h, "ridge", "r1", "Karen Whitfield", "2026-09-29T08:00:00");
    const code = leadCode("r1");
    for (const text of [`Monthly cleaning booked 180 #${code}`, `Annual contract, booked 1200 #${code}`, `Hold off on #${code}, she's away till November`, `Full removal booked #${code}`, `Busy today, will call her tomorrow #${code}`]) {
      expect(await h.sms(text), text).not.toMatch(/month to month|another year|Paused|new work waits|Back on/);
      expect(latest(h, "ridge"), text).toMatchObject({ needs_person: 1 });
      expect(latest(h, "ridge").handled, text).not.toMatch(/^(renew_|pause|busy|open)/);
    }
    expect(state(h, "ridge").dataset.business.plan).toMatchObject({ stage: "paying", billing: "monthly", paidOn: "2026-06-01" });
    expect(h.d.accounts.peek("ridge")!.paused).toBe(false);
    expect(state(h, "ridge").dataset.business.bookedOutUntil).toBeUndefined();
    expect(reply(h, "ridge", "r1").status).toBe("handed_off");
    // booked out: "Free estimate sent #code" never clears it
    expect(await h.sms("BUSY until Nov 15")).toContain("new work waits");
    expect(await h.sms(`Free estimate sent #${code}`)).not.toContain("new work is back on");
    expect(latest(h, "ridge")).toMatchObject({ handled: "unrecognized", needs_person: 1 });
    expect(state(h, "ridge").dataset.business.bookedOutUntil).toBe("2026-11-15");
  });

  it("BUSY is booked-out mode only when it's said as the command; 'Busy today, will call her tomorrow' is not (final 12)", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Karen Whitfield", "2026-09-29T08:00:00");
    const until = () => state(h, "ridge").dataset.business.bookedOutUntil;
    for (const text of ["Busy today, will call her tomorrow", "busy till tomorrow", "We're booked solid till spring", "Slammed this week, will get to her Friday"]) {
      expect(await h.sms(text), text).not.toContain("new work waits");
      expect(until(), text).toBeUndefined();
      expect(latest(h, "ridge"), text).toMatchObject({ handled: "unrecognized", needs_person: 1 });
    }
    expect(reply(h, "ridge", "r1").status).toBe("handed_off");
    for (const [text, day] of [["BUSY until Nov 15", "2026-11-15"], ["busy 6 weeks", "2026-11-10"], ["I'm slammed for 3 weeks", "2026-10-20"], ["We're booked solid thru 11/20", "2026-11-20"], ["Busy", "2026-10-27"]] as const) {
      expect(await h.sms(text), text).toContain("new work waits");
      expect(until(), text).toBe(day);
    }
  });

  it("STATUS is the command, never any question that starts with 'How' (final 13)", async () => {
    const h = make();
    await h.business("ridge");
    for (const text of ["How do I take someone off the list?", "How do I cancel?", "How much is the year?"]) {
      expect(await h.sms(text), text).toMatch(/^Thanks — Jack will read this and get back to you\./);
      expect(latest(h, "ridge"), text).toMatchObject({ handled: "unrecognized", needs_person: 1 });
    }
    for (const text of ["Status", "Numbers", "How's it going?", "How are we doing", "how’s it looking so far"]) {
      expect(await h.sms(text), text).toMatch(/^So far: 0 notes out/);
      expect(latest(h, "ridge"), text).toMatchObject({ handled: "status", needs_person: 0 });
    }
  });
});

describe("final review: the plan by text and in Settings", () => {
  const plan = (h: Harness, bid: string) => state(h, bid).dataset.business.plan;
  const lastText = (h: Harness, bid: string) => h.d.accounts.repo.ownerTexts(bid)[0]!;
  const yearly = async (h: Harness, bid: string, paidOn: string) => {
    // what the console's Settings sends for a yearly plan
    expect((await h.api("PATCH", `/api/businesses/${bid}`, { plan: { stage: "paying", billing: "annual", paidOn, yearsPaidOn: [paidOn] } })).status).toBe(200);
  };

  it("Settings records a yearly plan, and a monthly owner's months stay in their fees when they go yearly", async () => {
    const h = yearlyOn();
    await h.business("ridge");
    await yearly(h, "ridge", "2026-09-29");
    expect(plan(h, "ridge")).toMatchObject({ stage: "paying", billing: "annual", paidOn: "2026-09-29", yearsPaidOn: ["2026-09-29"] });
    // a quiet month on a yearly plan refunds a twelfth instead of "you won't be charged"
    expect(feesPaid(state(h, "ridge").dataset.business, "2026-10-15").total).toBe(4970);
    await h.business("bbb-tree", { name: "BBB Tree" });
    await h.api("PATCH", "/api/businesses/bbb-tree", { plan: { stage: "paying", paidOn: "2026-06-01" } });
    // the first paid day alone (a bare API call) still makes it a paid year
    await h.api("PATCH", "/api/businesses/bbb-tree", { plan: { billing: "annual", paidOn: "2026-09-15" } });
    expect(plan(h, "bbb-tree")).toMatchObject({ billing: "annual", paidOn: "2026-09-15", yearsPaidOn: ["2026-09-15"], priorFees: 4 * 497 });
    expect(feesPaid(state(h, "bbb-tree").dataset.business, "2026-09-29").total).toBe(4 * 497 + 4970);
  });

  it("RENEW from a paying owner goes to Jack for the payment link, once; the renewal isn't asked again", async () => {
    const h = yearlyOn();
    await h.business("ridge");
    await yearly(h, "ridge", "2025-10-20");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.ownerMessages.push({ id: "om-renewal", at: "2026-09-20T09:00:00", kind: "renewal", text: "Your year with us ends Oct 20.", refs: [{ kind: "year_end", id: "2026-10-20" }] });
    });
    expect(await h.sms("RENEW")).toBe("Done — another year from October 20, same price. The guarantee still runs every month. Jack will text you the payment link.");
    expect(lastText(h, "ridge")).toMatchObject({ handled: "renew_year", needs_person: 1 });
    const review = (await h.api("GET", "/api/review")).json.items as { kind: string; handled?: string }[];
    expect(review.some((i) => i.kind === "owner_text" && i.handled === "renew_year")).toBe(true);
    expect(state(h, "ridge").events.some((e) => e.kind === "review" && /chose another year/.test(e.title))).toBe(true);
    // a "sounds good" later isn't asked "RENEW or MONTHLY?" again
    expect(await h.sms("Sounds good")).not.toMatch(/which one: RENEW/);
    expect(await h.sms("Renew")).toBe("You're already renewed from October 20. Nothing else to do.");
    expect(lastText(h, "ridge")).toMatchObject({ handled: "renew_already", needs_person: 0 });
    expect(plan(h, "ridge").yearsPaidOn).toEqual(["2025-10-20", "2026-10-20"]);
  });

  it("YEARLY from a monthly owner changes nothing until it's paid; MONTHLY again never moves the charge date", async () => {
    const h = yearlyOn();
    await h.business("ridge");
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", paidOn: "2026-06-01" } });
    expect(await h.sms("Yearly")).toBe("Great — the year it is. Jack will text you the payment link, and your year starts the day it's paid.");
    expect(lastText(h, "ridge")).toMatchObject({ handled: "renew_year_pay_first", needs_person: 1 });
    expect(plan(h, "ridge")).toMatchObject({ paidOn: "2026-06-01", stage: "paying" });
    expect(plan(h, "ridge").billing).not.toBe("annual");
    expect(await h.sms("monthly")).toBe("You're already month to month at $497 a month. Nothing else to do.");
    expect(plan(h, "ridge").paidOn).toBe("2026-06-01");
  });

  it("RESUME after a year ran out says so and goes to a person; nothing sends while the plan is paused", { timeout: 60_000 }, async () => {
    // 9:30am New York: the daily checks run, inside the send window
    const h = make({ now: "2026-09-29T13:30:00Z", env: { FEATURE_YEARLY: "on" } });
    await h.business("ridge");
    const sample = generateSample({ trade: "tree", asOf: "2026-09-29" });
    await h.api("POST", "/api/businesses/ridge/imports", { files: sample.files.map((f) => ({ name: f.name, text: f.text, kind: f.kind })) });
    await h.api("POST", "/api/businesses/ridge/plan", { approve: true });
    await yearly(h, "ridge", "2025-09-29");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.ownerMessages.push({ id: "om-renewal", at: "2026-09-01T09:00:00", kind: "renewal", text: "Your year with us ends Sep 29.", refs: [{ kind: "year_end", id: "2026-09-29" }] });
    });
    // the 9am checks: the year ran out with no yes
    await tick(h.d);
    expect(plan(h, "ridge").stage).toBe("paused");
    expect(h.d.accounts.peek("ridge")!.paused).toBe(true);
    await h.d.accounts.withAccount("ridge", (s) => {
      // one note due now (the free round's OK was given long ago)
      s.awaitingOwnerOk = undefined;
      const t = s.touches.find((x) => x.status === "approved" && x.step === 1)!;
      t.dueAt = "2026-09-29T09:00";
    });
    const sentBefore = state(h, "ridge").touches.filter((t) => t.status === "sent").length;
    expect(await h.sms("RESUME")).toBe("Your year ended, so everything's still paused. Text MONTHLY to pick back up at $497 a month, or RENEW for another year. Jack will read this too.");
    expect(lastText(h, "ridge")).toMatchObject({ handled: "resume_plan_paused", needs_person: 1 });
    expect(h.d.accounts.peek("ridge")!.paused).toBe(true);
    // even with the pause flag cleared by hand, the direct sender honors the plan's own pause
    // and the console says so instead of "Sending resumed"
    expect((await h.api("POST", "/api/businesses/ridge/pause", { paused: false })).json).toMatchObject({ ok: true, held: "plan_paused" });
    expect((await sendDue(h.d, "ridge")).sent).toBe(0);
    expect(state(h, "ridge").touches.filter((t) => t.status === "sent").length).toBe(sentBefore);
    // RENEW after the year ran out waits for the payment; MONTHLY picks back up now
    expect(await h.sms("renew")).toContain("Everything stays paused until then.");
    expect(plan(h, "ridge").stage).toBe("paused");
    await h.api("POST", "/api/businesses/ridge/pause", { paused: true });
    expect(await h.sms("monthly")).toBe("Done — month to month from September 29, $497 a month, cancel by text any time.");
    expect(plan(h, "ridge")).toMatchObject({ stage: "paying", billing: "monthly", paidOn: "2026-09-29" });
    expect(h.d.accounts.peek("ridge")!.paused).toBe(false);
    expect((await sendDue(h.d, "ridge")).sent).toBeGreaterThan(0);
  });
});

describe("verification review: owner texts that read two ways", () => {
  const latest = (h: Harness, bid: string) => h.d.accounts.repo.ownerTexts(bid)[0]!;
  const plan = (h: Harness, bid: string) => state(h, bid).dataset.business.plan;
  const renewalOut = (h: Harness, bid: string, paidOn: string, yearEnd: string) =>
    h.d.accounts.withAccount(bid, (s) => {
      s.dataset.business.plan = { ...s.dataset.business.plan, stage: "paying", billing: "annual", paidOn, yearsPaidOn: [paidOn] };
      s.ownerMessages.push({ id: "om-renewal", at: "2026-09-20T09:00:00", kind: "renewal", text: "Your year with us ends soon.", refs: [{ kind: "year_end", id: yearEnd }] });
    });

  it("a lead text without a #code that starts with Monthly / Annual / Yearly is about the lead, never a plan change (sweep 3)", async () => {
    const h = yearlyOn();
    await h.business("ridge");
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", billing: "monthly", paidOn: "2026-06-01" } });
    await addLead(h, "ridge", "r1", "Karen Whitfield", "2026-09-29T08:00:00");
    for (const text of ["Monthly cleaning booked 180", "Monthly maintenance booked 180"]) {
      expect(await h.sms(text), text).not.toMatch(/month to month|another year|the year it is/);
      expect(latest(h, "ridge"), text).toMatchObject({ handled: "unclear_lead", needs_person: 1 });
    }
    expect(plan(h, "ridge")).toMatchObject({ stage: "paying", billing: "monthly", paidOn: "2026-06-01" });
    // read as Karen's booking, it goes on her lead
    h.d.llm = { model: "stub", structured: async () => ({ outcome: "booked", amount: 180 }) } as never;
    try {
      expect(await h.sms("Monthly cleaning booked 180")).toBe("Booked: Karen Whitfield, $180. Added to your results.");
    } finally {
      h.d.llm = null;
    }
    // the command itself, with a harmless tail, still answers
    expect(await h.sms("Monthly please")).toBe("You're already month to month at $497 a month. Nothing else to do.");
    expect(latest(h, "ridge")).toMatchObject({ handled: "monthly_already" });

    // a yearly owner (year from Mar 1): no renewal recorded early, no switch to month to month
    const y = yearlyOn();
    await y.business("ridge");
    await y.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", billing: "annual", paidOn: "2026-03-01", yearsPaidOn: ["2026-03-01"] } });
    await addLead(y, "ridge", "r1", "Karen Whitfield", "2026-09-29T08:00:00");
    for (const text of ["Annual service booked 250", "Yearly contract booked 1200", "Monthly maintenance booked 180"]) {
      expect(await y.sms(text), text).not.toMatch(/month to month|another year|the year it is/);
      expect(latest(y, "ridge"), text).toMatchObject({ handled: "unclear_lead", needs_person: 1 });
    }
    expect(plan(y, "ridge")).toMatchObject({ billing: "annual", paidOn: "2026-03-01", yearsPaidOn: ["2026-03-01"] });
    expect(plan(y, "ridge").priorFees).toBeUndefined();
    expect(reply(y, "ridge", "r1").status).toBe("handed_off");
    expect(await y.sms("Renew for another year")).toMatch(/^Done — another year from March 1/);
    expect(plan(y, "ridge").yearsPaidOn).toEqual(["2026-03-01", "2027-03-01"]);
  });

  it("a plan word with a reason after it goes to a person and never touches the lead waiting (second check 2)", async () => {
    const h = yearlyOn();
    await h.business("ridge");
    await renewalOut(h, "ridge", "2025-10-20", "2026-10-20");
    await addLead(h, "ridge", "r1", "Karen Whitfield", "2026-09-29T08:00:00");
    for (const text of ["Monthly - the year is too expensive", "Yearly is too expensive, monthly please", "Monthly, no thanks on the year", "Monthly. Talked it over with my wife", "Renew, already talked to Jack"]) {
      expect(await h.sms(text), text).toBe("Jack will read this and get back to you. To change your plan, text just RENEW or MONTHLY. About a lead? Text it with the #code.");
      expect(latest(h, "ridge"), text).toMatchObject({ handled: "plan_unclear", needs_person: 1 });
    }
    expect(reply(h, "ridge", "r1")).toMatchObject({ status: "handed_off" });
    expect(reply(h, "ridge", "r1").outcome).toBeUndefined();
    expect(plan(h, "ridge")).toMatchObject({ billing: "annual", yearsPaidOn: ["2025-10-20"] });
  });

  it("a bare No to the close or the renewal never marks a lead the owner already reported lost; a person reads it (sweep 6)", async () => {
    const h = make({ now: "2026-09-24T14:00:00Z" });
    await h.business("ridge");
    await addLead(h, "ridge", "r-kim", "Kim Tran", "2026-09-24T09:00:00");
    const kim = leadCode("r-kim");
    expect(await h.sms(`Quoted her #${kim}`)).toBe("Got it — Kim Tran has a price. We'll count it when it books.");
    h.setNow("2026-09-29T14:00:00Z");
    await pushOwner(h, "ridge", { id: "om-close", kind: "close", text: "Dave, the free 150 is done. Say yes by Friday 2 and the next batch goes out next week." });
    for (const text of ["No", "Nope", "No thanks", "Not interested", "Pass for now"]) {
      expect(await h.sms(text), text).toBe("Got it — Jack will read this and get back to you. About a lead? Text NO and the #code.");
      expect(latest(h, "ridge"), text).toMatchObject({ handled: "close_no", needs_person: 1 });
    }
    expect(reply(h, "ridge", "r-kim").outcome).toBe("quoted");

    // nothing outstanding: a NO without the code still never closes her out on its own; NO #code does
    const p = make({ now: "2026-09-24T14:00:00Z" });
    await p.business("ridge");
    await addLead(p, "ridge", "r-kim", "Kim Tran", "2026-09-24T09:00:00");
    expect(await p.sms(`Called her, done #${kim}`)).toBe("Thanks — Kim Tran marked as reached.");
    p.setNow("2026-09-29T14:00:00Z");
    for (const text of ["No", "Pass for now"]) {
      expect(await p.sms(text), text).toBe(`Is that about Kim Tran? To mark that lead not a fit, text NO #${kim}. Jack will read this too.`);
      expect(latest(p, "ridge"), text).toMatchObject({ handled: "lost_unsure", needs_person: 1 });
    }
    expect(reply(p, "ridge", "r-kim").outcome).toBeUndefined();
    expect(await p.sms(`NO #${kim}`)).toBe("Got it — Kim Tran marked not a fit.");
    // a bare NO still answers a lead waiting on a call
    await addLead(p, "ridge", "r-dan", "Dan Ruiz", "2026-09-29T09:00:00");
    expect(await p.sms("No")).toBe("Got it — Dan Ruiz marked not a fit.");

    // the renewal out: "No thanks" is about the renewal
    const r = make({ now: "2026-09-24T14:00:00Z" });
    await r.business("ridge");
    await addLead(r, "ridge", "r-kim", "Kim Tran", "2026-09-24T09:00:00");
    expect(await r.sms(`Quoted her #${kim}`)).toBe("Got it — Kim Tran has a price. We'll count it when it books.");
    r.setNow("2026-09-29T14:00:00Z");
    await renewalOut(r, "ridge", "2025-10-20", "2026-10-20");
    expect(await r.sms("No thanks")).toBe("Got it — Jack will read this and get back to you. About a lead? Text NO and the #code.");
    expect(latest(r, "ridge")).toMatchObject({ handled: "renewal_no", needs_person: 1 });
    expect(reply(r, "ridge", "r-kim").outcome).toBe("quoted");
  });

  it("a go-ahead after PAUSE resumes when nothing else is open; a yes with more after it reaches a person (sweep 7)", async () => {
    const h = yearlyOn();
    await h.business("ridge");
    for (const text of ["Go ahead and resume", "Go ahead and start it back up", "Go ahead, thanks", "Go for it, thanks"]) {
      expect(await h.sms("PAUSE")).toMatch(/^Paused\./);
      expect(await h.sms(text), text).toBe("Back on. Notes resume on your next send day.");
      expect(latest(h, "ridge"), text).toMatchObject({ handled: "resume" });
      expect(h.d.accounts.peek("ridge")!.paused, text).toBe(false);
    }
    // a yes with more after it and nothing open to answer: a person reads it, never a bare "Got it"
    expect(await h.sms("PAUSE")).toMatch(/^Paused\./);
    for (const text of ["Ok resume", "Go ahead and call her"]) {
      expect(await h.sms(text), text).toMatch(/^Thanks — Jack will read this and get back to you\./);
      expect(latest(h, "ridge"), text).toMatchObject({ handled: "unrecognized", needs_person: 1 });
    }
    for (const text of ["Ok thanks", "Ok cool", "Yes perfect", "Okay sounds good"]) {
      expect(await h.sms(text), text).toBe("Got it. About a lead? Text BOOKED + amount + the #code, DONE, or NO.");
      expect(latest(h, "ridge"), text).toMatchObject({ handled: "ack", needs_person: 0 });
    }

    // paused with the renewal out: "Go" is the renewal's yes, and a person reads it too
    const r = yearlyOn();
    await r.business("ridge");
    await renewalOut(r, "ridge", "2025-10-20", "2026-10-20");
    expect(await r.sms("PAUSE")).toMatch(/^Paused\./);
    expect(await r.sms("Go")).toBe("Great — which one: RENEW for another year, or MONTHLY to go month to month? Your notes are still paused: text RESUME to restart them.");
    expect(latest(r, "ridge")).toMatchObject({ handled: "ask_renewal", needs_person: 1 });
    expect(r.d.accounts.peek("ridge")!.paused).toBe(true);
  });
});

describe("sweep: a renewed year that may never be paid, and moving the first paid day", () => {
  const plan = (h: Harness) => state(h, "ridge").dataset.business.plan;
  const biz = (h: Harness) => state(h, "ridge").dataset.business;
  const lastText = (h: Harness) => h.d.accounts.repo.ownerTexts("ridge")[0]!;
  // a yearly plan paid Oct 20, 2025; RENEW by text adds the year from Oct 20, 2026
  const yearly = async (h: Harness, opts: { paidForItself?: boolean } = {}) => {
    await h.business("ridge");
    expect((await settings(h, { billing: "annual", paidOn: "2025-10-20", yearsPaidOn: ["2025-10-20"] })).status).toBe(200);
    if (opts.paidForItself)
      await h.d.accounts.withAccount("ridge", (s) => {
        s.recoveries.push({ id: "rec-y1", customerId: "c-y1", record: { kind: "job", id: "j-y1" }, value: 9000, cameBackOn: "2026-03-10", match: "same_record", confidence: 1, tier: "traced" });
      });
  };
  // what the console's Settings saves for the plan (the paid years only when they changed)
  const settings = (h: Harness, p: Record<string, unknown>) => h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", ...p } });

  it("RENEW, then Monthly in Settings: the renewed year comes off, so a year never paid is never refunded or settled (sweep 1)", async () => {
    const h = yearlyOn();
    await yearly(h, { paidForItself: true });
    expect(await h.sms("RENEW")).toContain("another year from October 20");
    // the owner would rather go month to month: Billing Monthly and First paid day Oct 20, saved together
    expect((await settings(h, { billing: "monthly", paidOn: "2026-10-20" })).status).toBe(200);
    expect(plan(h)).toMatchObject({ billing: "monthly", paidOn: "2026-10-20", yearsPaidOn: ["2025-10-20"], priorFees: 4970 });
    expect(paidYearOn(biz(h), "2027-01-15")).toBeUndefined();
    // a CANCEL in January promises nothing back: the paid year ended, and the monthly months were used
    h.setNow("2027-01-15T15:00:00Z");
    const done = await h.sms("CANCEL");
    expect(done).toMatch(/^Done — cancelled\./);
    expect(done).not.toMatch(/comes back to your card|refund/);
    expect(plan(h).yearRefunds ?? []).toEqual([]);
    expect(feesPaid(biz(h), "2027-01-15").total).toBe(4970 + 3 * 497);
  });

  it("MONTHLY then RENEW by text, never paid: taking the year off in Settings sticks, and the first year counts once (sweep 1)", async () => {
    for (const fix of ["take the year off", "set the day back"] as const) {
      const h = yearlyOn();
      await yearly(h);
      expect(await h.sms("monthly")).toContain("month to month from October 20");
      expect(await h.sms("renew")).toContain("another year from October 20");
      expect(plan(h)).toMatchObject({ billing: "annual", paidOn: "2026-10-20", yearsPaidOn: ["2025-10-20", "2026-10-20"], priorFees: 4970 });
      // the payment link is never paid: Jack clicks x on the year, or sets First paid day back to the year before
      const res = fix === "take the year off" ? await settings(h, { billing: "annual", paidOn: "2026-10-20", yearsPaidOn: ["2025-10-20"] }) : await settings(h, { billing: "annual", paidOn: "2025-10-20" });
      expect(res.status, fix).toBe(200);
      expect(plan(h), fix).toMatchObject({ billing: "annual", paidOn: "2025-10-20", priorFees: 0 });
      expect(plan(h).yearsPaidOn, fix).toEqual(fix === "take the year off" ? ["2025-10-20"] : ["2025-10-20", "2026-10-20"]);
      // one year paid, counted once
      expect(grossFees(biz(h), "2026-10-01").total, fix).toBe(4970);
    }
  });

  it("the renewed year is paid and Jack sets First paid day to it: the year before stays paid, judged and refundable (sweep 2)", async () => {
    const h = yearlyOn();
    await yearly(h);
    await h.sms("RENEW");
    // what the console sends: the day moves to a year already listed, and the years don't change
    expect((await settings(h, { billing: "annual", paidOn: "2026-10-20" })).status).toBe(200);
    expect(plan(h)).toMatchObject({ billing: "annual", paidOn: "2026-10-20", yearsPaidOn: ["2025-10-20", "2026-10-20"], priorFees: 4970 });
    expect(grossFees(biz(h), "2026-09-29").total).toBe(4970);
    expect(grossFees(biz(h), "2026-11-01").total).toBe(9940);
    expect(paidYearOn(biz(h), "2026-09-29")).toBe("2025-10-20");
    // the running year's last month is still judged, and leaving now still gets its early-leave math
    expect(guaranteeCheck(state(h, "ridge"), "2026-09-29")!.chargeOn).toBe("2026-10-20");
    expect(earlyLeaveRefund(state(h, "ridge"), "2026-09-29")).toMatchObject({ yearStart: "2025-10-20", refund: 4970 });
    // a day inside the year it started still only corrects it
    const c = yearlyOn();
    await yearly(c);
    expect((await settings(c, { billing: "annual", paidOn: "2025-10-25", yearsPaidOn: ["2025-10-25"] })).status).toBe(200);
    expect(plan(c)).toMatchObject({ paidOn: "2025-10-25", yearsPaidOn: ["2025-10-25"] });
    expect(plan(c).priorFees ?? 0).toBe(0);
    expect(grossFees(biz(c), "2026-09-29").total).toBe(4970);
  });

  it("a quiet last month dated the day the first paid day moves to still comes off the year it ended (second check 1)", async () => {
    for (const billing of ["annual", "monthly"] as const) {
      const h = yearlyOn();
      await yearly(h);
      await h.sms("RENEW");
      // the year's last month was quiet: its refund is dated the day the renewed year starts
      await h.d.accounts.withAccount("ridge", (s) => {
        s.dataset.business.plan.freeMonths = ["2026-10-20"];
      });
      expect(feesPaid(biz(h), "2026-10-19").total, billing).toBe(4970);
      // Jack moves the first paid day to it afterwards: the renewed year once paid, or month to month from it
      expect((await settings(h, { billing, paidOn: "2026-10-20" })).status, billing).toBe(200);
      expect(feesPaid(biz(h), "2026-10-26").total, billing).toBe(billing === "annual" ? 9525.83 : 5052.83);
    }
  });

  it("CANCEL after a RENEW that was only texted promises nothing for the renewed year, goes to Jack, and UNDO by text works (sweep 4, 5)", async () => {
    const h = yearlyOn();
    await yearly(h, { paidForItself: true });
    await h.sms("RENEW");
    h.setNow("2026-10-01T14:00:00Z");
    const done = await h.sms("CANCEL");
    expect(done).toContain("If you'd already paid for the year you renewed from October 20, Jack will refund all of it.");
    expect(done).not.toMatch(/\$4,970|comes back to your card/);
    expect(done).toContain("and it all picks back up.");
    expect(lastText(h)).toMatchObject({ handled: "cancel", needs_person: 1 });
    expect(state(h, "ridge").cancelled).toMatchObject({ years: ["2026-10-20"] });
    expect(state(h, "ridge").cancelled!.refund).toBeUndefined();
    // nothing waits in the queue as owed to them
    expect(h.d.accounts.repo.ownerMessages("ridge", { delivery: "review" }).filter((m) => m.kind === "refund")).toEqual([]);
    // UNDO by text puts it all back, the renewed year too, and Jack sees it
    expect(await h.sms("UNDO")).toMatch(/^Back on\./);
    expect(lastText(h)).toMatchObject({ handled: "undo_cancel", needs_person: 1 });
    expect(plan(h)).toMatchObject({ stage: "paying", yearsPaidOn: ["2025-10-20", "2026-10-20"] });
  });
});



describe("A4: booking texts that get lost or invented", () => {
  const latest = (h: Harness, bid: string) => h.d.accounts.repo.ownerTexts(bid)[0]!;

  it("a booking with no #code and nobody waiting goes to Jack to match, never onto a lead the owner already told us about", async () => {
    const h = make();
    await h.business("ridge");
    // nobody handed off yet
    expect(await h.sms("Booked 900")).toBe("Got it, Jack will match it.");
    expect(latest(h, "ridge")).toMatchObject({ body: "Booked 900", handled: "match_booking", needs_person: 1 });
    // DONE on the only lead, then the booking: it's Jack's to put on the right lead, with the text and the business
    await addLead(h, "ridge", "r-kim", "Kim Tran", "2026-09-29T08:00:00");
    expect(await h.sms("DONE")).toBe("Thanks — Kim Tran marked as reached.");
    expect(await h.sms("BOOKED 2400")).toBe("Got it, Jack will match it.");
    expect(latest(h, "ridge")).toMatchObject({ body: "BOOKED 2400", handled: "match_booking", needs_person: 1 });
    expect(reply(h, "ridge", "r-kim").outcome).toBeUndefined();
    expect(state(h, "ridge").recoveries).toEqual([]);
    const items = (await h.api("GET", "/api/review")).json.items as Record<string, unknown>[];
    expect(items).toContainEqual(expect.objectContaining({ kind: "owner_text", businessId: "ridge", businessName: "Ridgeline Tree Co.", text: "BOOKED 2400", reply: "Got it, Jack will match it." }));
    // a lead booked with no amount yet, next to Kim: the amount alone could be either one's, so it's Jack's to match too
    await addLead(h, "ridge", "r-al", "Al Moss", "2026-09-29T09:00:00");
    const al = leadCode("r-al");
    expect(await h.sms(`Booked #${al}`)).toBe(`Booked: Al Moss. What's the job worth? Text "booked 2400 #${al}".`);
    expect(await h.sms("2400")).toBe("Got it, Jack will match it.");
    expect(reply(h, "ridge", "r-al").outcomeValue).toBeUndefined();
    expect(state(h, "ridge").recoveries).toEqual([]);
    // the code still places it
    expect(await h.sms(`booked 2400 #${al}`)).toBe("Booked: Al Moss, $2,400. Added to your results.");
    // anything else with nobody waiting is still just that
    expect(await h.sms("DONE")).toBe("Nobody's waiting on a call right now.");
    // QUOTED on the only lead, then a booking days later: Jack's to match, as after DONE
    const q = make();
    await q.business("ridge");
    await addLead(q, "ridge", "r-kim", "Kim Tran", "2026-09-29T09:30:00");
    expect(await q.sms(`Quoted her 2400 #${leadCode("r-kim")}`)).toBe("Got it — Kim Tran has a price. We'll count it when it books.");
    q.setNow("2026-10-02T14:00:00Z");
    expect(await q.sms("She booked us for 2400")).toBe("Got it, Jack will match it.");
    expect(latest(q, "ridge")).toMatchObject({ handled: "match_booking", needs_person: 1 });
    expect(reply(q, "ridge", "r-kim").outcome).toBe("quoted");
    expect(state(q, "ridge").recoveries).toEqual([]);
  });

  it("the code typed without its '#' names the lead with nobody else waiting: after DONE, and after 'What's the job worth?'", async () => {
    const h = make();
    await h.business("ridge");
    // codes in letters only, as the owner would type them back
    const lettered = (p: string) => {
      let rid = `${p}-0`;
      for (let i = 0; !/^[A-Z]{3}$/.test(leadCode(rid)); i++) rid = `${p}-${i}`;
      return rid;
    };
    const [rk, ra] = [lettered("r-karen"), lettered("r-al")];
    const [karen, al] = [leadCode(rk), leadCode(ra)];
    await addLead(h, "ridge", rk, "Karen Whitfield", "2026-09-29T08:00:00");
    expect(await h.sms(`DONE #${karen}`)).toBe("Thanks — Karen Whitfield marked as reached.");
    expect(await h.sms("BOOKED 2400")).toBe("Got it, Jack will match it.");
    h.d.llm = { model: "stub", structured: async () => ({ outcome: "booked", amount: 2400 }) } as never;
    try {
      expect(await h.sms(`Booked 2400 ${karen}`)).toBe("Booked: Karen Whitfield, $2,400. Added to your results.");
      expect(latest(h, "ridge")).toMatchObject({ handled: "booked", needs_person: 0 });
      await addLead(h, "ridge", ra, "Al Moss", "2026-09-29T09:00:00");
      expect(await h.sms(`Booked #${al}`)).toBe(`Booked: Al Moss. What's the job worth? Text "booked 2400 #${al}".`);
      expect(await h.sms(`Booked 2400 ${al}`)).toBe("Booked: Al Moss, $2,400. Added to your results.");
    } finally {
      h.d.llm = null;
    }
    expect(state(h, "ridge").recoveries.map((r) => r.value)).toEqual([2400, 2400]);
  });

  it("every booking text that gets 'Which one?' is flagged to Jack, code or no code", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T08:00:00");
    await addLead(h, "ridge", "r2", "Dan Ruiz", "2026-09-29T09:00:00");
    expect(await h.sms("booked 2400")).toMatch(/^Which one\? 2 are waiting: Dan Ruiz #\w{3}, Kim Tran #\w{3}\./);
    expect(latest(h, "ridge")).toMatchObject({ body: "booked 2400", handled: "ask_lead", needs_person: 1 });
    expect(state(h, "ridge").replies.every((r) => r.status === "handed_off")).toBe(true);
    // one owner, two businesses, one lead waiting in each
    const two = make();
    await two.business("aaa-tree", { name: "AAA Tree" });
    await two.business("bbb-tree", { name: "BBB Tree" });
    await addLead(two, "aaa-tree", "r-a", "Bea Cole", "2026-09-29T09:10:00");
    await addLead(two, "bbb-tree", "r-b", "Al Moss", "2026-09-29T09:20:00");
    expect(await two.sms("Sold it 2.4k")).toMatch(/^Which one\? 2 are waiting: Al Moss \(BBB Tree\) #\w{3}, Bea Cole \(AAA Tree\) #\w{3}\./);
    expect(latest(two, "bbb-tree")).toMatchObject({ handled: "ask_lead", needs_person: 1 });
    expect(state(two, "aaa-tree").recoveries.concat(state(two, "bbb-tree").recoveries)).toEqual([]);
  });

  it("a phone number is never a booking amount, nor is anything over $100,000: Jack reads it, nothing is booked", async () => {
    const misread = ["booked 6035550142", "BOOKED 603-555-0142", "booked (603) 555-0142", "Booked 555-0142", "sold 603.555.0142", "booked 603 555 0142", "6035550142 booked", "booked 250000", "Booked $1,250,000", "sold it 150k"];
    for (const t of misread) {
      expect(readAmount(t), t).toBe(0);
      expect(readLeadText(t), t).toEqual({ amount: 0, unclear: true });
    }
    for (const [t, v] of [["booked 2400", 2400], ["BOOKED $2,400", 2400], ["booked 2.4k", 2400], ["booked 12500", 12500], ["Booked $100,000", 100000]] as const) {
      expect(readAmount(t), t).toBe(v);
      expect(readLeadText(t), t).toEqual({ outcome: "booked", amount: v });
    }
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T08:00:00");
    const code = leadCode("r1");
    for (const t of [`BOOKED 6035550142 #${code}`, "booked (603) 555-0142", "Booked 250000"]) {
      expect(await h.sms(t), t).toMatch(/^Thanks — that one could go either way, so Jack will read it and mark the lead himself\./);
      expect(latest(h, "ridge"), t).toMatchObject({ body: t, handled: "unclear_lead", needs_person: 1 });
    }
    // the bare number ("6035550142" once booked $6,035,550,142): with no booking word it's no lead text at all, and
    // Jack reads it
    for (const t of ["6035550142", "250000"]) {
      expect(readAmount(t), t).toBe(0);
      expect(readLeadText(t), t).toBeUndefined();
      expect(await h.sms(t), t).toMatch(/^Thanks — Jack will read this and get back to you\./);
      expect(latest(h, "ridge"), t).toMatchObject({ body: t, handled: "unrecognized", needs_person: 1 });
    }
    expect(reply(h, "ridge", "r1").status).toBe("handed_off");
    expect(state(h, "ridge").recoveries).toEqual([]);
    // Claude's second read is held to the same rule, whatever amount it reads
    let amount = 6035550142;
    h.d.llm = { model: "stub", structured: async () => ({ outcome: "booked", amount }) } as never;
    try {
      expect(await h.sms(`Beat the other guy's price, she booked us for 6035550142 #${code}`)).toMatch(/^Thanks — that one could go either way/);
      amount = 250000;
      expect(await h.sms(`Beat the other guy's price, she booked us for 250000 #${code}`)).toMatch(/^Thanks — that one could go either way/);
      expect(latest(h, "ridge")).toMatchObject({ handled: "unclear_lead", needs_person: 1 });
      amount = 2400;
      expect(await h.sms(`Beat the other guy's price, she booked us for 2400 #${code}`)).toBe("Booked: Kim Tran, $2,400. Added to your results.");
    } finally {
      h.d.llm = null;
    }
    expect(state(h, "ridge").recoveries.map((r) => r.value)).toEqual([2400]);
  });

  it("BOOKED 2400 #code, a booking with one lead waiting, NO #code and DONE still work", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T08:00:00");
    await addLead(h, "ridge", "r2", "Dan Ruiz", "2026-09-29T09:00:00");
    expect(await h.sms(`BOOKED 2400 #${leadCode("r1")}`)).toBe("Booked: Kim Tran, $2,400. Added to your results. 1 more waiting.");
    expect(await h.sms("booked 12500")).toBe("Booked: Dan Ruiz, $12,500. Added to your results.");
    expect(latest(h, "ridge")).toMatchObject({ handled: "booked", needs_person: 0 });
    await addLead(h, "ridge", "r3", "Al Moss", "2026-09-29T10:00:00");
    await addLead(h, "ridge", "r4", "Bea Cole", "2026-09-29T11:00:00");
    expect(await h.sms(`NO #${leadCode("r3")}`)).toBe("Got it — Al Moss marked not a fit. 1 more waiting.");
    expect(await h.sms("DONE")).toBe("Thanks — Bea Cole marked as reached.");
    expect(state(h, "ridge").recoveries.map((r) => r.value)).toEqual([2400, 12500]);
  });
});
