import { describe, expect, it } from "vitest";
import { scan } from "../src/breakage/detect.ts";
import { lint } from "../src/copy/lint.ts";
import { renderNote, type RenderedNote } from "../src/copy/render.ts";
import { SEQUENCES } from "../src/copy/templates.ts";
import { readReply } from "../src/inbox/classify.ts";
import { closeMessage, guaranteeCheck, kickoffText, wantedWords, weeklyReport } from "../src/reports/owner.ts";
import { billingCheck, brakesLine, find, sendHealth, SEND_BRAKES } from "../src/runtime/agents.ts";
import { emptyState, type AccountState } from "../src/runtime/state.ts";
import { generateSample } from "../src/sample/generate.ts";
import { isTimeZone, TIMEZONES, zoneForCell } from "../src/timezones.ts";
import type { Customer, Dataset, Opportunity, PlanState, Reply, ReplyIntent, Touch, TradeId } from "../src/model.ts";
import { ASOF, ago, customer, dataset, job, oneOpp, quote } from "./fixtures.ts";

/** BRIEF A6: the guarantee's words, send days, brakes, time zones and note copy. */

const ONE_PASS: Pick<PlanState, "kind"> = { kind: "one_pass" };

/** An account with `wants` people who asked for a date or a price this week, out of `people` written to. */
function week(people: number, wants: number, kind?: PlanState["kind"]): AccountState {
  const ids = Array.from({ length: people }, (_, i) => `p${i}`);
  const st = emptyState(dataset({ customers: ids.map((id, i) => customer(id, { name: `Person ${i + 1}`, firstName: `P${i}` })) }), `${ASOF}T12:00:00Z`);
  st.dataset.business.plan = { ...st.dataset.business.plan, ...(kind ? { kind } : {}) };
  st.touches = ids.map((id): Touch => ({ id: `t-${id}`, opportunityId: `o-${id}`, customerId: id, channel: "email", step: 1, angle: "check_in", dueAt: `${ASOF}T09:00`, sentAt: `${ASOF}T09:00:00`, status: "sent", body: "", flags: [] }));
  st.replies = ids.slice(0, wants).map((id, i): Reply => ({ id: `r${i}`, customerId: id, touchId: `t-${id}`, channel: "email", receivedAt: `${ASOF}T15:00:00`, from: `${id}@x.com`, text: "Same day as before?", intent: "wants_it", confidence: 0.9, extracted: {}, status: "done", ownerContactedAt: `${ASOF}T16:00:00` }));
  return st;
}

describe("the guarantee's count, worded by plan kind", () => {
  it("monthly (or a plan with no kind) says 'asked to come back'; the one pass says 'wanted the work'", () => {
    expect(wantedWords({})).toEqual({ label: "Asked to come back", past: "asked to come back", present: "asks to come back" });
    expect(wantedWords({ kind: "monthly" })).toEqual(wantedWords({}));
    expect(wantedWords(ONE_PASS)).toEqual({ label: "Wanted the work", past: "wanted the work", present: "wants the work" });
  });

  it("the Friday text: 'Asked to come back: 3' on the monthly plan, 'Wanted the work: 3' on the one pass", () => {
    const monthly = weeklyReport(week(6, 3), ASOF);
    expect(monthly).toContain("Dave, 3 people asked to come back this week.");
    expect(monthly).toContain("\nAsked to come back: 3\n");
    const pass = weeklyReport(week(6, 3, "one_pass"), ASOF);
    expect(pass).toContain("Dave, 3 people wanted the work this week.");
    expect(pass).toContain("\nWanted the work: 3\n");
    for (const t of [monthly, pass]) expect(t).not.toMatch(/price or a date/i);
  });

  it("the close counts who asked to come back, and promises everyone who drops off each month in the monthly words", () => {
    const text = closeMessage(week(6, 2));
    expect(text).toContain("Dave, from the free 150, Person 1 and Person 2 asked to come back.");
    expect(text).toContain("From 6 notes to 6 people, 2 wrote back and 2 asked to come back.");
    expect(text).toContain("$497 a month keeps it going on the rest of the list and everyone who drops off each month.");
    expect(text).toContain("And the guarantee: any month nobody asks to come back, you don't pay.");
    expect(text).not.toMatch(/price or a date|every new quote/i);
  });

  it("a free month says nobody asked to come back, in the text and the Guard's note", () => {
    const st = week(6, 0);
    st.dataset.business.plan = { ...st.dataset.business.plan, stage: "paying", paidOn: "2026-09-01" };
    const g = guaranteeCheck(st, "2026-09-29")!;
    expect(g.free).toBe(true);
    expect(g.text).toContain("Dave, nobody we followed up with asked to come back since September 1, so this month is free");
    expect(g.text).toContain("The record: 6 notes out, 0 replies, and nobody asked to come back.");
    billingCheck(st, "2026-09-29T09:00:00");
    expect(st.events.at(-1)!.detail).toBe("Nobody asked to come back this period, so you won't be charged.");
  });
});

describe("the welcome text", () => {
  const welcome = (trade: TradeId, plan: Partial<PlanState> = {}) => {
    const st = emptyState(generateSample({ trade, asOf: ASOF }).dataset, `${ASOF}T12:00:00Z`);
    st.dataset.business.plan = { ...st.dataset.business.plan, ...plan };
    find(st, `${ASOF}T12:00:00`);
    return { st, text: kickoffText(st, "2026-09-30", 150) };
  };

  it.each(["lawn", "landscape", "cleaning"] as const)("%s opens with the past customers who haven't been back, not quiet quotes", (trade) => {
    const { st, text } = welcome(trade);
    const gone = st.summary!.onTheTable.pastCustomersNotBack;
    expect(gone).toBeGreaterThan(0);
    const opener = text.split("\n")[0]!;
    expect(opener).toBe(`Dave, it's Quiet Accounts. Going through your records, ${gone.toLocaleString("en-US")} past customers haven't been back.`);
    expect(opener).not.toMatch(/quote/i);
  }, 60_000);

  it.each(["tree", "painting", "fence"] as const)("%s still opens with the shop's quiet quotes", (trade) => {
    expect(welcome(trade).text.split("\n")[0]).toMatch(/% of your quotes never got a yes or a no\. All told, [\d,]+ quotes/);
  }, 60_000);

  it("ends with the free 150's price beside it on the monthly plan, or a plan with no kind", () => {
    const last = (text: string) => text.split("\n").at(-1);
    expect(last(welcome("lawn").text)).toBe("The first 150 are free, then $497 a month if you say yes.");
    expect(last(welcome("cleaning", { kind: "monthly" }).text)).toBe("The first 150 are free, then $497 a month if you say yes.");
    // the one pass never mentions $497
    expect(welcome("tree", ONE_PASS).text).not.toContain("$497");
  }, 60_000);

  it("tells the owner he gets a text when someone asks to come back, or wants the work on a one pass", () => {
    expect(welcome("lawn").text).toContain("When someone asks to come back, I'll text you their name, number and what they said.");
    expect(welcome("tree", ONE_PASS).text).toContain("When someone wants the work, I'll text you their name, number and what they said.");
  }, 60_000);
});

describe("replies asking for their old slot back", () => {
  it.each(["put me back on", "Please put us back on the schedule", "same day as before", "Same day as before?", "can you come back", "Can you come back next week?"])("'%s' is wants_it", (text) => {
    expect(readReply({ text, asOf: ASOF }).intent).toBe("wants_it");
  });
  it.each([
    "Put me back on the mowing schedule",
    "put us back in the rotation",
    "Put me back on!",
    "Yes, same day as before",
    "Same day as last year please",
    "We'd like the same time as before",
    "I want the same day as before",
    "Could you do the same time as last year",
    "Can you keep us on the same day as before?",
    "Keep us on the same day as before",
    "I'd prefer the same day as before",
    "Could you please put us back on the schedule?",
    "Sure, put us back on the schedule",
    "We'd love it if you could put us back on the schedule",
    "Yes please put us back on. Same day works.",
    // bare, as the reply's last words: past a please or a thanks and the name under it
    "Same day as last year is fine.",
    "Same day as before would be great, thanks!",
    "Same day as before.\nThanks,\nMike",
  ])("'%s', asked for, is wants_it", (text) => {
    expect(readReply({ text, asOf: ASOF }).intent).toBe("wants_it");
  });
  it("not when it's turned down", () => {
    for (const text of ["Don't put me back on the list", "No thanks, not the same day as before", "I don't want the same day as before"]) expect(readReply({ text, asOf: ASOF }).intent).not.toBe("wants_it");
  });
  it.each([
    // things put back, by them or by us
    "They put them back in the wrong cupboards last time",
    "You guys put it back in the wrong spot last year, not happy",
    "We put them back in the garage ourselves",
    "Put it back in the shed when you're done",
    "We fixed the gate ourselves and put it back on the hinges. All good.",
    "My husband took the shutters off and put them back on himself last summer.",
    "The fence panel blew down but my neighbor put it back in place. We're fine.",
    // a list nobody wants to be on
    "Put me back on the no contact list",
    "Please put me back on the do-not-mail list.",
    // the old day, told not asked for
    "We use another company now, they come the same day as before",
    "The crew came the same day as always and left a mess",
    "Your crew came the same time as last year and damaged the lawn, I want a refund",
    "You guys came the same day as before and never finished",
    "The crew came Tuesday, same time as last year, and left a mess.",
    "We switched to GreenCo and they keep the same day as before.",
    "My new guy will keep the same schedule as last year, thanks anyway.",
    // the old day, then something else
    "Same day as before was a disaster, the crew never showed.",
    "Same time as last year, they charged me twice. Please fix this.",
    "Same day as before, no. Tuesdays don't work anymore.",
    "Thanks for reaching out. Same day as last year is fine but we're doing it ourselves this year.",
    "Same day as before? Thanks anyway.",
    // put back by someone else, or asked why
    "You put us back on the schedule without asking and charged us",
    "They put us back on the calendar last year and nobody showed",
    "Why would you put me back on the schedule?",
  ])("'%s' isn't wants_it", (text) => {
    expect(readReply({ text, asOf: ASOF }).intent).not.toBe("wants_it");
  });
  it.each([
    ["Same day as before. We're good for now", "not_interested"],
    ["Same day as before, but honestly we can't afford it this year.", "later"],
    ["I prefer the same day as before but we're moving in November", "later"],
    ["I'd like the same day as before but we're moving in November", "later"],
    ["Same time as last year? We're good, my son mows now.", "question"],
    ["Why did you put me back on your list? I asked to be removed.", "question"],
    ["Who put me back on your list?", "question"],
  ] as const)("'%s' still reads as %s", (text, intent) => {
    expect(readReply({ text, asOf: ASOF }).intent).toBe(intent);
  });
});

describe("the send brakes", () => {
  /** `sent` notes out, and replies with these intents. */
  const health = (sent: number, replies: Partial<Record<ReplyIntent, number>>) => {
    const st = week(sent, 0);
    st.replies = Object.entries(replies).flatMap(([intent, n]) => Array.from({ length: n }, (_, i): Reply => ({ id: `${intent}${i}`, customerId: `p${i}`, channel: "email", receivedAt: `${ASOF}T15:00:00`, from: `p${i}@x.com`, text: "", intent: intent as ReplyIntent, confidence: 1, extracted: {}, status: "done" })));
    return sendHealth(st);
  };

  it("trip at 3% bounces after 40 sends, 0.1% complaints after 300, and 1% 'who is this?' replies after 100", () => {
    expect(SEND_BRAKES).toEqual({ bounces: { rate: 0.03, after: 40 }, complaints: { rate: 0.001, after: 300 }, unrecognized: { rate: 0.01, after: 100 } });
    expect(health(39, { bounce: 2 }).paused).toBe(false);
    expect(health(40, { bounce: 2 }).reason).toBe("Bounce rate 5.0% is over 3% — paused to protect the sending reputation. The list needs cleaning.");
    expect(health(100, { bounce: 3 }).paused).toBe(false);
    expect(health(299, { complaint: 1 }).paused).toBe(false);
    expect(health(300, { complaint: 1 }).reason).toBe("Spam complaints hit 0.33% — paused at 0.1%, well before Gmail's 0.3% limit.");
    expect(health(99, { wrong_person: 2 }).paused).toBe(false);
    expect(health(100, { wrong_person: 1 }).paused).toBe(false);
    expect(health(100, { wrong_person: 2 }).reason).toMatch(/^2 people didn't recognize the business or complained — paused\./);
  });

  it("the console says them in one line, from the same numbers", () => {
    expect(brakesLine()).toBe("Pauses on its own at 3% bounces after 40 sends, 0.1% complaints after 300, or 1% “who is this?” replies after 100.");
  });
});

describe("time zones", () => {
  it("guesses from a cell's area code, the split states by where most of them are", () => {
    const zone = (area: string) => zoneForCell(`+1${area}5550123`);
    expect(zone("603")).toBe("America/New_York");
    expect(zone("312")).toBe("America/Chicago");
    expect(zone("219")).toBe("America/Chicago"); // northwest Indiana
    expect(zone("317")).toBe("America/New_York"); // Indianapolis
    expect(zone("270")).toBe("America/Chicago"); // western Kentucky
    expect(zone("865")).toBe("America/New_York"); // Knoxville
    expect(zone("615")).toBe("America/Chicago"); // Nashville
    expect(zone("850")).toBe("America/Chicago"); // the Florida Panhandle: Pensacola to Panama City
    expect(zone("448")).toBe("America/Chicago"); // 850's overlay
    expect(zone("904")).toBe("America/New_York"); // Jacksonville
    expect(zone("915")).toBe("America/Denver"); // El Paso
    expect(zone("208")).toBe("America/Denver"); // Idaho
    expect(zone("602")).toBe("America/Phoenix");
    expect(zone("415")).toBe("America/Los_Angeles");
    expect(zone("907")).toBe("America/Anchorage");
    expect(zone("808")).toBe("Pacific/Honolulu");
    expect(zone("416")).toBe("America/New_York"); // Toronto
    expect(zone("604")).toBe("America/Los_Angeles"); // Vancouver
    expect(zone("306")).toBe("America/Regina");
    expect(zone("902")).toBe("America/Halifax");
    expect(zone("709")).toBe("America/St_Johns");
  });

  it("has no guess for a code it doesn't know or a number outside the US and Canada", () => {
    expect(zoneForCell("+19995550123")).toBeUndefined();
    expect(zoneForCell("+447700900123")).toBeUndefined();
    expect(zoneForCell("6035550123")).toBeUndefined();
  });

  it("every guess is a zone the console lists and the runtime knows", () => {
    const listed = new Set(TIMEZONES.map(([z]) => z));
    const guesses = new Set<string>();
    for (let code = 200; code < 1000; code++) {
      const z = zoneForCell(`+1${code}5550123`);
      if (z) guesses.add(z);
    }
    expect([...guesses].sort()).toEqual([...listed].sort());
    for (const z of listed) expect(isTimeZone(z), z).toBe(true);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});

describe("note copy", () => {
  /** Everything above the footer. */
  const main = (n: RenderedNote) => n.body.split(/\n\n[^\n]*·[^\n]*\n/)[0]!;
  const notes = (ds: Dataset, o: Opportunity, c: Customer, contactedBefore = false) =>
    SEQUENCES[o.type].steps.map((s) => renderNote(o, c, { ds, sendOn: ASOF, contactedBefore }, s.step)).filter((n): n is RenderedNote => !!n);
  const UNBACKED = /on us for not following up|updated price this week|openings coming up|always glad to help/i;

  it("no note on any sample promises what nobody backs, and every one keeps the address and the stop line", { timeout: 120_000 }, () => {
    for (const trade of ["tree", "lawn", "cleaning", "painting", "fence", "landscape"] as const) {
      const s = generateSample({ trade, asOf: ASOF });
      const r = scan(s.dataset);
      const seen = new Set<string>();
      for (const o of r.primary.slice(0, 400)) {
        const c = s.dataset.customers.find((x) => x.id === o.customerId)!;
        for (const contacted of [false, true])
          for (const n of notes(s.dataset, o, c, contacted)) {
            seen.add(n.templateId);
            expect(main(n), `${trade} ${n.templateId}`).not.toMatch(UNBACKED);
            expect(n.body, n.templateId).toContain(`${s.dataset.business.name} · ${s.dataset.business.mailingAddress}`);
            expect(n.body, n.templateId).toContain('Reply "stop" and you won\'t hear from us again.');
          }
      }
      expect(seen.size, trade).toBeGreaterThan(5);
    }
  });

  it("an old quote's first note asks plainly, without 'that's on us for not following up'", () => {
    const people = Array.from({ length: 12 }, (_, i) => customer(`c${i}`, { firstName: "Holly" }));
    const ds = dataset({ customers: people, quotes: people.map((c, i) => quote(`q${i}`, c.id, { title: "Remove leaning birch", sentOn: ago(90) })) });
    const r = scan(ds);
    const firsts = people.map((c) => renderNote(oneOpp(r, c.id, "unanswered_quote"), c, { ds, sendOn: ASOF }, 1)!);
    const n = firsts.find((x) => x.templateId === "q1a")!;
    expect(main(n)).toContain("We never heard back. Is it still something you want done?");
    expect(n.flags).toEqual([]);
  });

  it("changes asked for get no price by a day, and a yes never scheduled is offered no openings", () => {
    const ds = dataset({
      customers: [customer("c1"), customer("c2")],
      quotes: [
        quote("q1", "c1", { title: "Remove dead ash", status: "changes_requested", sentOn: ago(90), changesRequestedOn: ago(85) }),
        quote("q2", "c2", { title: "Remove dead ash", status: "approved", sentOn: ago(70), approvedOn: ago(60) }),
      ],
    });
    const r = scan(ds);
    const changes = renderNote(oneOpp(r, "c1", "changes_requested"), ds.customers[0]!, { ds, sendOn: ASOF }, 1)!;
    expect(changes.templateId).toBe("c1");
    expect(main(changes)).toContain("Do you still want it? Tell me what you'd like changed.\n\nSarah");
    const yes = oneOpp(r, "c2", "approved_unscheduled");
    const approved = notes(ds, yes, ds.customers[1]!).find((n) => n.templateId === "a2")!;
    expect(main(approved)).toBe(`Mike, checking back on ${yes.jobPhrase}. Want me to get it on the schedule?\n\nSarah`);
    for (const n of [changes, approved]) expect(n.flags).toEqual([]);
  });

  it("a past customer's subject is the job, never just the street", () => {
    const ds = dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Remove leaning pine", completedOn: ago(400), total: 1800 })] });
    const o = oneOpp(scan(ds), "c1", "one_and_done");
    const all = notes(ds, o, ds.customers[0]!);
    expect(all[0]!.templateId).toBe("p1");
    expect(main(all[0]!)).toContain("on Oak Ln");
    expect(all[0]!.subject).toBe(o.jobPhrase);
    for (const n of all.slice(1)) expect(n.subject).toBe(`Re: ${o.jobPhrase}`);
    for (const n of all) expect(n.subject).not.toMatch(/Oak Ln/);
  });

  it("a past customer with no street on file isn't told 'Always glad to help a past customer'", () => {
    const ds = dataset({ customers: [customer("c1", { address: undefined })], jobs: [job("j1", "c1", { title: "Remove leaning pine", completedOn: ago(400), total: 1800 })] });
    const n = renderNote(oneOpp(scan(ds), "c1", "one_and_done"), ds.customers[0]!, { ds, sendOn: ASOF }, 1)!;
    expect(n.templateId).toBe("p1b");
    expect(main(n)).toMatch(/reply and we'll get you a price\.\n\nSarah$/);
    expect(n.flags).toEqual([]);
  });

  it("the linter flags each of them if one comes back (the AI writer passes the same gate)", () => {
    const body = (line: string) => `Hi Mike,\n\nIt's Sarah at Ridgeline Tree Co. ${line} Want it done?\n\nSarah\n\nRidgeline Tree Co. · 14 Mill Rd, Concord, NH 03301\nYou're getting this sales follow-up because you asked us for a price.\nReply "stop" and you won't hear from us again.`;
    const flags = (line: string) => lint("the oak", body(line), { firstName: "Mike", job: "the oak", requireJob: false });
    expect(flags("We never heard back, and that's on us for not following up about the oak.")).toContain('Promises what nobody backs: "on us for not following up"');
    expect(flags("Tell me what you'd like changed on the oak and I'll get you an updated price this week.")).toContain('Promises what nobody backs: "price this week"');
    expect(flags("Checking back on the oak. We've got openings coming up.")).toContain('Promises what nobody backs: "openings coming up"');
    expect(flags("We took care of the oak for you. Always glad to help a past customer.")).toContain('Sounds canned: "Always glad to help"');
    expect(flags("We took care of the oak for you last spring.")).toEqual([]);
  });
});
