import { beforeAll, describe, expect, it } from "vitest";
import { paceOnePass, INBOX_DAILY, NOTES_SPAN_DAYS, type PaceInput } from "../src/cadence/pace.ts";
import { planOutreach } from "../src/cadence/plan.ts";
import { scan, type ScanResult } from "../src/breakage/detect.ts";
import { MONTHLY_REFILL, refillRate } from "../src/breakage/refill.ts";
import { kickoffText, passEndText, passProgress, passPromise, weeklyReport } from "../src/reports/owner.ts";
import { billingCheck, closeIfDue, endPass, find, markSent, ownerApproves, passEndIfDue, passEndMoved, planBatch, setBookedOut } from "../src/runtime/agents.ts";
import { dropSettled } from "../src/runtime/settled.ts";
import { emptyState, type AccountState } from "../src/runtime/state.ts";
import { isOnePass, monthlyPlan, onePassPlan, PLAN_STAGES, stageFits } from "../src/plans.ts";
import type { Opportunity, PlanState, Reply, Touch } from "../src/model.ts";
import { addDays, monthName, weekday } from "../src/util.ts";
import { ago, ASOF, customer, dataset, quote } from "./fixtures.ts";

/** BRIEF B3: the one pass. The whole list once, paced from its end date, ended with the tally and the refill check. */

const WEEKDAYS = [1, 2, 3, 4, 5];
const sendsOn = (d: string) => WEEKDAYS.includes(weekday(d));
/** A Monday: the pass's first send day. */
const START = "2026-10-05";
const END = addDays(START, 30);
const CUTOFF = addDays(END, -NOTES_SPAN_DAYS);

const pace = (over: Partial<PaceInput> = {}) => paceOnePass({ notes: Array(600).fill(3), startOn: START, endOn: END, inboxes: 5, sendsOn, ...over });

/** A tree shop with `n` quotes nobody answered, the newest sent `ago(30)`, each a day older than the last. */
function shop(n: number, plan: Partial<PlanState> = onePassPlan(), inboxes = 5): AccountState {
  const customers = Array.from({ length: n }, (_, i) => customer(`c${i}`, { name: `Person ${i}`, firstName: `P${i}` }));
  const quotes = customers.map((c, i) => quote(`q${i}`, c.id, { sentOn: ago(30 + i) }));
  const ds = dataset({ customers, quotes, business: { sendDays: WEEKDAYS, persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0.1 }, fromEmails: Array.from({ length: inboxes }, (_, i) => `sarah${i}@ridgeline-mail.com`) } });
  ds.business.plan = { ...ds.business.plan, ...plan };
  return emptyState(ds, `${ASOF}T12:00:00`);
}

const firstNotes = (st: AccountState) => st.touches.filter((t) => t.step === 1 && t.status !== "cancelled");
const lastFirst = (st: AccountState) => firstNotes(st).map((t) => t.dueAt.slice(0, 10)).sort().pop()!;
/** Notes to go or gone, by day. */
const perDay = (st: AccountState) => {
  const n: Record<string, number> = {};
  for (const t of st.touches) if (t.status !== "cancelled") n[t.dueAt.slice(0, 10)] = (n[t.dueAt.slice(0, 10)] ?? 0) + 1;
  return n;
};
/** Each person's days, note by note. */
const byPerson = (st: AccountState) => {
  const days = new Map<string, string[]>();
  for (const t of [...st.touches].sort((a, b) => a.step - b.step)) if (t.status !== "cancelled") days.set(t.customerId, [...(days.get(t.customerId) ?? []), t.dueAt.slice(0, 10)]);
  return [...days.values()];
};

describe("pacing a one pass from its end date", () => {
  it("600 people on five inboxes: the last first note goes 12 days before the end, no inbox over 30 a day", () => {
    const p = pace();
    expect(p.late).toBeUndefined();
    expect(p.endOn).toBe(END);
    expect(p.lastFirst! <= CUTOFF).toBe(true);
    expect(p.days.reduce((n, d) => n + d.first, 0)).toBe(600);
    // two follow-ups each, follow-ups included in the cap
    expect(p.days.reduce((n, d) => n + d.followUps, 0)).toBe(1200);
    for (const d of p.days) expect(d.first + d.followUps).toBeLessThanOrEqual(5 * INBOX_DAILY);
    for (const d of p.days) expect(sendsOn(d.day)).toBe(true);
  });

  it.each(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"])("whatever weekday it starts (%s): on time on five inboxes, a few days late on three", (start) => {
    const end = addDays(start, 30);
    expect(pace({ startOn: start, endOn: end }).late).toBeUndefined();
    // a cut-off on a Monday full of follow-ups never pushes the end weeks out
    const { canMeet, moreInboxes } = pace({ startOn: start, endOn: end, inboxes: 3 }).late!;
    expect(canMeet > end && canMeet <= addDays(end, 7)).toBe(true);
    expect(moreInboxes).toBe(1);
  });

  it("spreads the first notes over the send days up to the cut-off instead of front-loading them", () => {
    const p = pace({ notes: Array(150).fill(3) });
    const firsts = p.days.filter((d) => d.first);
    // 15 send days from Monday Oct 5 to Friday Oct 23: ten a day
    expect(firsts.map((d) => d.first)).toEqual(Array(15).fill(10));
    expect(p.lastFirst).toBe(CUTOFF);
  });

  it("the same pass on three inboxes can't make it: it names the date they can meet and the inboxes that would meet the first", () => {
    const p = pace({ inboxes: 3 });
    expect(p.late).toBeDefined();
    const { canMeet, moreInboxes } = p.late!;
    expect(canMeet > END).toBe(true);
    // the schedule given is the one that meets that date, never over the cap
    expect(p.endOn).toBe(canMeet);
    expect(p.lastFirst! <= addDays(canMeet, -NOTES_SPAN_DAYS)).toBe(true);
    for (const d of p.days) expect(d.first + d.followUps).toBeLessThanOrEqual(3 * INBOX_DAILY);
    // a day sooner can't be met
    expect(pace({ inboxes: 3, endOn: addDays(canMeet, -1) }).late).toBeDefined();
    // and the inboxes named are the fewest that meet the first date
    expect(pace({ inboxes: 3 + moreInboxes! }).late).toBeUndefined();
    expect(pace({ inboxes: 3 + moreInboxes! - 1 }).late).toBeDefined();
  });

  it("follow-ups go the way Instantly sends them: 4 days after note 1, 5 after note 2, waiting past days off", () => {
    // Monday's note 1, Friday's note 2, then Wednesday's note 3 (Friday + 5 is Wednesday)
    const p = pace({ notes: [3], endOn: addDays(START, 60) });
    expect(p.days.map((d) => [d.day, d.first, d.followUps])).toEqual([
      ["2026-10-05", 1, 0],
      ["2026-10-09", 0, 1],
      ["2026-10-14", 0, 1],
    ]);
    // a Thursday start: note 2 lands on Monday (Thursday + 4 is a Sunday)
    expect(paceOnePass({ notes: [2], startOn: "2026-10-08", endOn: "2026-12-01", inboxes: 1, sendsOn }).days.map((d) => d.day)).toEqual(["2026-10-08", "2026-10-12"]);
  });

  it("follow-ups go ahead of new people, and the notes already on the calendar keep their room", () => {
    // a day the follow-ups fill, nobody new starts, though people are still waiting for a later day
    const p = pace();
    const full = p.days.filter((d) => d.followUps === 5 * INBOX_DAILY);
    expect(full.length).toBeGreaterThan(0);
    for (const d of full) expect(d.first).toBe(0);
    expect(p.days.some((x) => x.day > full[0]!.day && x.first > 0)).toBe(true);
    const busy = paceOnePass({ notes: Array(10).fill(1), startOn: START, endOn: END, inboxes: 1, sendsOn, busy: new Map([[START, INBOX_DAILY]]) });
    expect(busy.days.some((d) => d.day === START)).toBe(false);
  });

  it("gives each person the days of their notes: in the order they start, +4 and +5 or the first send day with room after", () => {
    const sendDay = (d: string): string => (sendsOn(d) ? d : sendDay(addDays(d, 1)));
    for (const p of [pace(), pace({ inboxes: 3 })]) {
      // every note is on a day the schedule counts, and the days add up to it
      const byDay = new Map<string, number>();
      for (const days of p.people) for (const d of days) byDay.set(d, (byDay.get(d) ?? 0) + 1);
      expect(Object.fromEntries(byDay)).toEqual(Object.fromEntries(p.days.map((d) => [d.day, d.first + d.followUps])));
      for (const [i, [first, second, third]] of p.people.entries()) {
        expect(first! >= (p.people[i - 1]?.[0] ?? START)).toBe(true);
        expect(second! >= sendDay(addDays(first!, 4))).toBe(true);
        expect(third! >= sendDay(addDays(second!, 5))).toBe(true);
      }
    }
    // three inboxes are full on some days: a follow-up due then waits for the next day with room
    expect(pace({ inboxes: 3 }).people.some(([first, second]) => second! > sendDay(addDays(first!, 4)))).toBe(true);
    // each person has as many days as notes
    expect(paceOnePass({ notes: [3, 2, 1], startOn: START, endOn: END, inboxes: 1, sendsOn }).people.map((x) => x.length)).toEqual([3, 2, 1]);
  });

  it("an end date with no send day left before its cut-off is met by no number of inboxes", () => {
    const p = pace({ endOn: addDays(START, 5) });
    expect(p.late?.canMeet).toBeDefined();
    expect(p.late?.moreInboxes).toBeUndefined();
  });

  it("a 10,000-person list on one inbox is paced too: the date it can meet is years out, and the inboxes that would meet the first", { timeout: 60_000 }, () => {
    const p = pace({ notes: Array(10_000).fill(3), inboxes: 1 });
    expect(p.late!.canMeet > "2030-01-01").toBe(true);
    expect(p.late!.moreInboxes).toBeGreaterThan(40);
    expect(p.days.reduce((n, d) => n + d.first, 0)).toBe(10_000);
    for (const d of p.days) expect(d.first + d.followUps).toBeLessThanOrEqual(INBOX_DAILY);
    expect(pace({ notes: Array(10_000).fill(3), inboxes: 1 + p.late!.moreInboxes! }).late).toBeUndefined();
  });

  it("people with fewer notes take less room: one note each needs no follow-ups at all", () => {
    const p = pace({ notes: Array(600).fill(1), inboxes: 2 });
    expect(p.late).toBeUndefined();
    expect(p.days.every((d) => d.followUps === 0)).toBe(true);
    expect(pace({ notes: Array(600).fill(3), inboxes: 2 }).late).toBeDefined();
  });

  it("nobody to start is on time", () => {
    expect(pace({ notes: [] })).toEqual({ days: [], people: [], lastFirst: undefined, endOn: END });
  });
});

describe("the plan's kinds and stages", () => {
  it("a one pass runs, is done, paused or cancelled; a monthly plan (or one with no kind) is in its free round, paying, paused or cancelled", () => {
    expect(PLAN_STAGES).toEqual({ monthly: ["trial", "paying", "paused", "cancelled"], one_pass: ["running", "done", "paused", "cancelled"] });
    expect(stageFits({ stage: "trial" })).toBe(true);
    expect(stageFits({ stage: "done" })).toBe(false);
    expect(stageFits({ kind: "one_pass", stage: "paying" })).toBe(false);
    expect(stageFits({ kind: "one_pass", stage: "done" })).toBe(true);
  });

  it("a new one pass has the brief's terms and no start until it's planned", () => {
    const p = onePassPlan();
    expect(p).toMatchObject({ kind: "one_pass", stage: "running", pricePerBooking: 250, capBookings: 4, windowDays: 60, freeFirst: 0 });
    expect(p.startedOn).toBeUndefined();
    expect(p.targetEndOn).toBeUndefined();
    expect(isOnePass(p)).toBe(true);
    expect(isOnePass(monthlyPlan())).toBe(false);
  });
});

describe("planning a one pass", () => {
  it("600 people on five inboxes: the whole list at once, newest first, no holdout, the last first note 12 days before the end", { timeout: 120_000 }, () => {
    const st = shop(600);
    const p = planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    expect(p.people).toHaveLength(600);
    // nobody held back to measure lift, though the account says 10%
    expect(p.holdout).toEqual([]);
    expect(st.outreach.filter((o) => o.holdout)).toEqual([]);
    const plan = st.dataset.business.plan;
    expect(plan.startedOn).toBe(START);
    expect(plan.targetEndOn).toBe(END);
    expect(lastFirst(st) <= CUTOFF).toBe(true);
    expect(plan.pace).toEqual({ inboxes: 5, endOn: END, lastFirst: lastFirst(st), dailyNew: Math.max(...p.pace!.days.map((d) => d.first)) });
    // newest first: each day's people have newer quotes than the next day's
    const days = new Map<string, number[]>();
    for (const t of firstNotes(st)) days.set(t.dueAt.slice(0, 10), [...(days.get(t.dueAt.slice(0, 10)) ?? []), Number(t.customerId.slice(1))]);
    const spans = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([, xs]) => [Math.min(...xs), Math.max(...xs)]);
    expect(spans[0]![0]).toBe(0);
    for (let i = 1; i < spans.length; i++) expect(spans[i]![0]).toBe(spans[i - 1]![1]! + 1);
    // the planner follows the pace day by day; the platform's new-lead cap is its busiest day, and the monthly weekly
    // pace is left as it was
    const byDay = new Map<string, number>();
    for (const t of firstNotes(st)) byDay.set(t.dueAt.slice(0, 10), (byDay.get(t.dueAt.slice(0, 10)) ?? 0) + 1);
    expect(Object.fromEntries(byDay)).toEqual(Object.fromEntries(p.pace!.days.filter((d) => d.first).map((d) => [d.day, d.first])));
    expect(plan.pace!.dailyNew).toBe(Math.max(...byDay.values()));
    expect(st.dataset.business.weeklyNewContacts).toBe(75);
    // the owner's OK to the first note still comes first
    expect(st.touches.every((t) => t.status === "planned")).toBe(true);
    expect(st.awaitingOwnerOk).toBeDefined();
    expect(st.ownerMessages.filter((m) => m.kind === "kickoff")).toHaveLength(1);
  });

  it("the same pass on three inboxes plans to the date it can meet, and says so; planned again on five, it's paced again", { timeout: 120_000 }, () => {
    const st = shop(600, onePassPlan(), 3);
    const p = planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    expect(p.holdout).toEqual([]);
    const late = st.dataset.business.plan.pace!.late!;
    expect(late.canMeet > END).toBe(true);
    expect(late.moreInboxes).toBeGreaterThan(0);
    expect(lastFirst(st) <= addDays(late.canMeet, -NOTES_SPAN_DAYS)).toBe(true);
    expect(st.events.some((e) => e.detail?.includes(`3 inboxes can't finish by ${END}: it ends about ${late.canMeet}.`))).toBe(true);
    // the inboxes come, and it's planned again before the owner's OK
    st.dataset.business.fromEmails = Array.from({ length: 3 + late.moreInboxes! }, (_, i) => `sarah${i}@ridgeline-mail.com`);
    const again = planBatch(st, `${ASOF}T13:00:00`, { startOn: START });
    expect(again.people).toHaveLength(600);
    expect(firstNotes(st)).toHaveLength(600);
    expect(lastFirst(st) <= CUTOFF).toBe(true);
    expect(st.dataset.business.plan.pace).toMatchObject({ inboxes: 3 + late.moreInboxes!, endOn: END });
    expect(st.dataset.business.plan.pace!.late).toBeUndefined();
  });

  it("puts each person's follow-ups on the pace's days, so notes sent by the server itself keep every inbox at 30 a day too", { timeout: 120_000 }, () => {
    const st = shop(600);
    const p = planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    const byDay = new Map<string, number>();
    for (const t of st.touches) byDay.set(t.dueAt.slice(0, 10), (byDay.get(t.dueAt.slice(0, 10)) ?? 0) + 1);
    expect(Object.fromEntries(byDay)).toEqual(Object.fromEntries(p.pace!.days.map((d) => [d.day, d.first + d.followUps])));
    for (const n of byDay.values()) expect(n).toBeLessThanOrEqual(5 * INBOX_DAILY);
    // newest first: the i-th person planned has the pace's i-th days
    const days = (id: string) => st.touches.filter((t) => t.customerId === id).sort((a, b) => a.step - b.step).map((t) => t.dueAt.slice(0, 10));
    expect(p.people.map(days)).toEqual(p.pace!.people);
  });

  it("one pace for the whole pass: people planned after the OK leave its last first note where it is, and a new end date is checked against all of it", { timeout: 120_000 }, () => {
    const st = shop(600);
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    const before = st.dataset.business.plan.pace!;
    ownerApproves(st, `${START}T06:00:00`);
    // three new quotes come in a later file, and Jack plans them
    const more = Array.from({ length: 3 }, (_, i) => customer(`new${i}`, { name: `New ${i}` }));
    st.dataset.customers.push(...more);
    st.dataset.quotes.push(...more.map((c, i) => quote(`qn${i}`, c.id, { sentOn: ago(25 + i) })));
    find(st, "2026-10-06T12:00:00");
    expect(planBatch(st, "2026-10-06T12:00:00", { startOn: "2026-10-07" }).people).toHaveLength(3);
    const plan = st.dataset.business.plan;
    expect(plan.pace).toMatchObject({ inboxes: 5, endOn: END, lastFirst: before.lastFirst });
    expect(plan.pace!.late).toBeUndefined();
    expect(lastFirst(st)).toBe(before.lastFirst);
    // an end date its 600 approved notes miss: late, though the three alone would make it
    plan.targetEndOn = addDays(before.lastFirst, NOTES_SPAN_DAYS - 7);
    expect(passEndMoved(st)).toBe(true);
    expect(plan.pace!.late).toEqual({ canMeet: addDays(before.lastFirst, NOTES_SPAN_DAYS) });
  });

  it("a late pass stays late when more people are planned after the OK, to the latest date any of it can meet", { timeout: 120_000 }, () => {
    const st = shop(600, onePassPlan(), 3);
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    const before = st.dataset.business.plan.pace!;
    expect(before.late).toBeDefined();
    ownerApproves(st, `${START}T06:00:00`);
    const more = Array.from({ length: 5 }, (_, i) => customer(`new${i}`, { name: `New ${i}` }));
    st.dataset.customers.push(...more);
    st.dataset.quotes.push(...more.map((c, i) => quote(`qn${i}`, c.id, { sentOn: ago(25 + i) })));
    find(st, "2026-10-06T12:00:00");
    expect(planBatch(st, "2026-10-06T12:00:00", { startOn: "2026-10-07" }).people).toHaveLength(5);
    expect(st.dataset.business.plan.pace).toMatchObject({ lastFirst: before.lastFirst, late: before.late });
  });

  it("planned again on the same inboxes and end date, what's planned stays (a change to a note waiting for the OK too)", () => {
    const st = shop(20);
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    const first = st.touches.find((t) => t.step === 1)!;
    first.body = "Changed by hand.";
    const again = planBatch(st, `${ASOF}T13:00:00`, { startOn: START });
    expect(again.people).toEqual([]);
    expect(st.touches.filter((t) => t.status === "cancelled")).toEqual([]);
    expect(st.touches.find((t) => t.id === first.id)!.body).toBe("Changed by hand.");
  });

  it("across Thanksgiving week: nothing on Thursday or Friday, on five inboxes it meets its date, on three it names the one it can", { timeout: 120_000 }, () => {
    const start = "2026-11-16";
    const end = addDays(start, 30);
    const onTime = shop(600);
    expect(planBatch(onTime, `${ASOF}T12:00:00`, { startOn: start }).people).toHaveLength(600);
    expect(onTime.dataset.business.plan.pace).toMatchObject({ endOn: end });
    expect(onTime.dataset.business.plan.pace!.late).toBeUndefined();
    expect(lastFirst(onTime) <= addDays(end, -NOTES_SPAN_DAYS)).toBe(true);
    const late = shop(600, onePassPlan(), 3);
    planBatch(late, `${ASOF}T12:00:00`, { startOn: start });
    expect(late.dataset.business.plan.pace!.late).toEqual({ canMeet: "2026-12-21", moreInboxes: 1 });
    expect(late.events.some((e) => e.detail?.includes(`3 inboxes can't finish by ${end}: it ends about 2026-12-21.`))).toBe(true);
    for (const st of [onTime, late]) {
      expect(perDay(st)["2026-11-25"]).toBeGreaterThan(0);
      expect(perDay(st)["2026-11-26"]).toBeUndefined();
      expect(perDay(st)["2026-11-27"]).toBeUndefined();
      expect(perDay(st)["2026-11-30"]).toBeGreaterThan(0);
    }
  });

  it("past the free round's 150, with no 40% share for any kind of leak", () => {
    const st = shop(200);
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    // all of one kind: the free round would keep it to 40% of its people first
    expect(new Set(firstNotes(st).map((t) => t.customerId)).size).toBe(200);
  });

  it("a monthly plan keeps its own gates: a paying one holds back its share and goes at the weekly pace, with no start or end day", () => {
    const st = shop(200, { ...monthlyPlan(), stage: "paying" });
    const p = planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    expect(p.holdout.length).toBeGreaterThan(0);
    expect(p.pace).toBeUndefined();
    expect(Math.max(...p.weeks.map((w) => w.newPeople))).toBeLessThanOrEqual(75);
    expect(st.dataset.business.plan.startedOn).toBeUndefined();
    expect(st.dataset.business.weeklyNewContacts).toBe(75);
  });

  it("planned with nobody on its list yet, it hasn't started", () => {
    const st = shop(0);
    expect(planBatch(st, `${ASOF}T12:00:00`, { startOn: START }).people).toEqual([]);
    expect(st.dataset.business.plan).toMatchObject({ kind: "one_pass", stage: "running" });
    expect(st.dataset.business.plan.startedOn).toBeUndefined();
    expect(st.dataset.business.plan.targetEndOn).toBeUndefined();
    expect(st.ownerMessages).toEqual([]);
  });

  it("the owner's late OK moves the pass's start and end with its notes", () => {
    const st = shop(10);
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    ownerApproves(st, "2026-10-07T08:00:00");
    expect(st.dataset.business.plan.startedOn).toBe("2026-10-07");
    expect(st.dataset.business.plan.targetEndOn).toBe(addDays(END, 2));
  });

  it("a late pass's late OK paces it again from the OK's day: its pace is the one its new days meet", { timeout: 60_000 }, () => {
    const st = shop(600, onePassPlan(), 3);
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    expect(st.dataset.business.plan.pace!.late).toBeDefined();
    ownerApproves(st, "2026-10-08T08:00:00");
    // what the pacing gives the same list from Thursday to an end date three days on
    const p = pace({ startOn: "2026-10-08", endOn: addDays(END, 3), inboxes: 3 });
    expect(p.late).toBeDefined();
    const plan = st.dataset.business.plan;
    expect(plan).toMatchObject({ startedOn: "2026-10-08", targetEndOn: addDays(END, 3) });
    expect(plan.pace).toEqual({ inboxes: 3, endOn: addDays(END, 3), lastFirst: p.lastFirst, dailyNew: Math.max(...p.days.map((d) => d.first)), late: p.late });
    expect(perDay(st)).toEqual(Object.fromEntries(p.days.map((d) => [d.day, d.first + d.followUps])));
  });

  it("a late OK paces it on the inboxes it has by then", { timeout: 60_000 }, () => {
    const st = shop(600, onePassPlan(), 3);
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    expect(st.dataset.business.plan.pace!.late).toBeDefined();
    // two inboxes added in Settings, and no plan since
    st.dataset.business.fromEmails = Array.from({ length: 5 }, (_, i) => `sarah${i}@ridgeline-mail.com`);
    ownerApproves(st, "2026-10-08T08:00:00");
    expect(st.dataset.business.plan.pace).toMatchObject({ inboxes: 5, endOn: addDays(END, 3) });
    expect(st.dataset.business.plan.pace!.late).toBeUndefined();
    for (const n of Object.values(perDay(st))) expect(n).toBeLessThanOrEqual(5 * INBOX_DAILY);
  });

  describe("an OK two to six days late", () => {
    // 600 people on five inboxes, planned from Wednesday Sep 30
    let base: AccountState;
    beforeAll(() => {
      base = shop(600);
      planBatch(base, `${ASOF}T12:00:00`, { startOn: "2026-09-30" });
    });

    it.each([
      ["2026-10-02", "2026-10-02"],
      ["2026-10-03", "2026-10-05"],
      ["2026-10-05", "2026-10-05"],
      ["2026-10-06", "2026-10-06"],
    ])("said on %s: paced again from %s, no day over 30 an inbox, the 30 days from there", { timeout: 60_000 }, (ok, from) => {
      const st = structuredClone(base);
      const words = new Map(st.touches.map((t) => [t.id, t.body]));
      ownerApproves(st, `${ok}T08:00:00`);
      const plan = st.dataset.business.plan;
      expect(plan).toMatchObject({ startedOn: from, targetEndOn: addDays(from, 30) });
      for (const [day, n] of Object.entries(perDay(st))) {
        expect(n).toBeLessThanOrEqual(5 * INBOX_DAILY);
        expect(day >= from && sendsOn(day)).toBe(true);
      }
      // each person's notes keep their words, and their gaps
      expect(new Map(st.touches.map((t) => [t.id, t.body]))).toEqual(words);
      for (const days of byPerson(st)) {
        expect(days[1]! >= addDays(days[0]!, 4)).toBe(true);
        expect(days[2]! >= addDays(days[1]!, 5)).toBe(true);
      }
      // the pace record says what the notes do: on time on five inboxes from any of these days
      expect(plan.pace).toMatchObject({ inboxes: 5, endOn: addDays(from, 30), lastFirst: lastFirst(st) });
      expect(plan.pace!.late).toBeUndefined();
      expect(lastFirst(st) <= addDays(from, 30 - NOTES_SPAN_DAYS)).toBe(true);
      expect(st.touches.every((t) => t.status === "approved")).toBe(true);
    });
  });

  it("an end date set once its notes are approved: met by the notes it has, or the date they meet; before the OK, the next plan paces it again", () => {
    const st = shop(600, onePassPlan(), 3);
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    const plan = st.dataset.business.plan;
    const { canMeet } = plan.pace!.late!;
    const { dailyNew } = plan.pace!;
    // waiting for the OK, a date the planned notes don't meet is left to the next plan, which paces the list again
    plan.targetEndOn = addDays(canMeet, -1);
    expect(passEndMoved(st)).toBe(false);
    expect(plan.pace).toMatchObject({ endOn: END, late: { canMeet } });
    // the date they can meet is theirs at once (the alert's "or set the end date to" it)
    plan.targetEndOn = canMeet;
    expect(passEndMoved(st)).toBe(true);
    expect(plan.pace).toEqual({ inboxes: 3, endOn: canMeet, lastFirst: addDays(canMeet, -NOTES_SPAN_DAYS), dailyNew });
    ownerApproves(st, `${START}T06:00:00`);
    // and it holds at the OK
    expect(plan.pace).toEqual({ inboxes: 3, endOn: canMeet, lastFirst: addDays(canMeet, -NOTES_SPAN_DAYS), dailyNew });
    // a sooner date can't be met by notes already approved: more inboxes wouldn't change them
    plan.targetEndOn = END;
    expect(passEndMoved(st)).toBe(true);
    expect(plan.pace).toEqual({ inboxes: 3, endOn: END, lastFirst: addDays(canMeet, -NOTES_SPAN_DAYS), dailyNew, late: { canMeet } });
    expect(passEndMoved(st)).toBe(false);
  });

  it("the rest of a list after its free round: the pass's own welcome and the owner's OK, and its own progress", () => {
    const st = shop(30, monthlyPlan());
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START, limitPeople: 10 });
    ownerApproves(st, `${START}T06:00:00`);
    for (const t of st.touches) markSent(st, t.id, `${t.dueAt}:00`);
    st.dataset.business.plan = onePassPlan();
    expect(planBatch(st, "2026-11-02T12:00:00", { startOn: "2026-11-02" }).people).toHaveLength(20);
    const welcomes = st.ownerMessages.filter((m) => m.kind === "kickoff");
    expect(welcomes).toHaveLength(2);
    expect(welcomes[1]!.refs).toEqual([{ kind: "pass", id: "2026-11-02" }]);
    expect(st.awaitingOwnerOk).toBe("2026-11-02T12:00:00");
    expect(passProgress(st)).toEqual({ people: 20, started: 0, sent: 0, notes: 60 });
    // planned again on another inbox before the OK: the free round's notes don't stop it being paced again
    st.dataset.business.fromEmails = ["sarah0@ridgeline-mail.com"];
    planBatch(st, "2026-11-02T13:00:00", { startOn: "2026-11-02" });
    expect(st.touches.filter((t) => t.lastError === "Paced again")).toHaveLength(60);
    expect(st.dataset.business.plan.pace!.inboxes).toBe(1);
  });

  it("planOutreach ranks a one pass newest first and never holds anyone back, called on its own too", () => {
    const st = shop(40);
    find(st, `${ASOF}T12:00:00`);
    const p = planOutreach(st.dataset, st.scan!, { startOn: START });
    expect(p.holdout).toEqual([]);
    expect(p.people[0]).toBe("c0");
    expect(p.pace).toBeUndefined();
  });
});

describe("planning a one pass while the owner is booked out, or out of season", () => {
  it("booked out: the whole pass waits for the day new work may start, and runs its 30 days from there", () => {
    const st = shop(100);
    st.dataset.business.bookedOutUntil = "2026-12-15";
    const p = planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    expect(p.people).toHaveLength(100);
    expect(p.skipped).toEqual([]);
    // three weeks before the schedule opens up
    expect(st.dataset.business.plan).toMatchObject({ startedOn: "2026-11-24", targetEndOn: "2026-12-24" });
    expect(firstNotes(st).every((t) => t.dueAt >= "2026-11-24")).toBe(true);
    expect(lastFirst(st) <= addDays("2026-12-24", -NOTES_SPAN_DAYS)).toBe(true);
    expect(st.dataset.business.plan.pace!.late).toBeUndefined();
    expect(Number.isFinite(st.dataset.business.weeklyNewContacts)).toBe(true);
    expect(st.dataset.business.weeklyNewContacts).toBeGreaterThan(0);
  });

  it("booked out for a shorter spell on two inboxes: nobody is left off", () => {
    const st = shop(100, onePassPlan(), 2);
    st.dataset.business.bookedOutUntil = "2026-11-05";
    const p = planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    expect(p.people).toHaveLength(100);
    expect(st.dataset.business.plan).toMatchObject({ startedOn: "2026-10-15", targetEndOn: "2026-11-14" });
    expect(st.dataset.business.plan.pace!.late).toBeUndefined();
  });

  it("booked out past an end date Jack set: it's late, and it names the date it can meet", () => {
    const st = shop(100, onePassPlan({ targetEndOn: "2026-11-30" }));
    st.dataset.business.bookedOutUntil = "2026-12-15";
    expect(planBatch(st, `${ASOF}T12:00:00`, { startOn: START }).people).toHaveLength(100);
    const late = st.dataset.business.plan.pace!.late!;
    expect(late.canMeet >= addDays("2026-11-24", NOTES_SPAN_DAYS)).toBe(true);
    expect(late.moreInboxes).toBeUndefined();
  });

  it("nothing in season: nobody planned, each one skipped with the reason, and the pass hasn't started", () => {
    const st = shop(20);
    find(st, `${ASOF}T12:00:00`);
    // holiday lights are asked about August to December: a pass starting in February finds none in season
    st.scan = { ...st.scan!, opportunities: Array.from({ length: 20 }, (_, i) => opp(`c${i}`, "service_due", ago(300), { serviceId: "light.install" })) };
    const p = planBatch(st, `${ASOF}T12:00:00`, { startOn: "2027-02-01" });
    expect(p.people).toEqual([]);
    expect(p.skipped).toHaveLength(20);
    expect(new Set(p.skipped.map((x) => x.why))).toEqual(new Set(["Out of season: Holiday light install"]));
    const plan = st.dataset.business.plan;
    expect([plan.startedOn, plan.targetEndOn, plan.pace]).toEqual([undefined, undefined, undefined]);
    expect(st.dataset.business.weeklyNewContacts).toBe(75);
    expect(st.ownerMessages).toEqual([]);
  });
});

describe("BUSY and OPEN on a one pass", () => {
  /** 600 people on five inboxes, OK'd, with its first day's notes out. */
  const running = () => {
    const st = shop(600);
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    ownerApproves(st, `${START}T06:00:00`);
    for (const t of st.touches) if (t.dueAt.startsWith(START)) markSent(st, t.id, `${t.dueAt}:00`);
    return st;
  };
  /** The pace record matches the notes: its last first note, and its busiest day of first notes to come. */
  const recorded = (st: AccountState) => {
    const toCome: Record<string, number> = {};
    for (const t of firstNotes(st)) if (t.status === "approved" || t.status === "planned") toCome[t.dueAt.slice(0, 10)] = (toCome[t.dueAt.slice(0, 10)] ?? 0) + 1;
    expect(st.dataset.business.plan.pace).toMatchObject({ lastFirst: lastFirst(st), dailyNew: Math.max(...Object.values(toCome)) });
  };

  it("BUSY mid-pass: everyone not written to waits for the day new work may start, paced from there, and it's late to the date that can be met", { timeout: 60_000 }, () => {
    const st = running();
    const started = new Set(st.touches.filter((t) => t.status === "sent").map((t) => t.customerId));
    const before = new Map(st.touches.map((t) => [t.id, t.dueAt]));
    const r = setBookedOut(st, "2026-11-20", "2026-10-06T09:00:00");
    expect(r.moved).toBe(600 - started.size);
    // Friday Oct 30 is three weeks before the schedule opens up
    for (const t of st.touches) {
      if (started.has(t.customerId)) expect(t.dueAt).toBe(before.get(t.id));
      else if (t.step === 1) expect(t.dueAt >= "2026-10-30").toBe(true);
    }
    for (const n of Object.values(perDay(st))) expect(n).toBeLessThanOrEqual(5 * INBOX_DAILY);
    expect(st.touches.filter((t) => !started.has(t.customerId)).every((t) => t.heldDays! > 0)).toBe(true);
    // under way, it keeps its dates; its pace says it can't meet the end, and when it can
    const plan = st.dataset.business.plan;
    expect(plan).toMatchObject({ startedOn: START, targetEndOn: END });
    recorded(st);
    expect(plan.pace!.late!.canMeet).toBe(addDays(lastFirst(st), NOTES_SPAN_DAYS));
    expect(plan.pace!.late!.moreInboxes).toBeUndefined();

    // OPEN the next day: they're paced again from the next send day, not all put on it
    const back = setBookedOut(st, undefined, "2026-10-07T09:00:00");
    expect(back.moved).toBe(600 - started.size);
    expect(Math.min(...firstNotes(st).filter((t) => !started.has(t.customerId)).map((t) => Number(t.dueAt.slice(8, 10))))).toBe(8);
    for (const n of Object.values(perDay(st))) expect(n).toBeLessThanOrEqual(5 * INBOX_DAILY);
    expect(st.touches.every((t) => t.heldDays === undefined)).toBe(true);
    recorded(st);
    expect(plan.pace!.late).toBeUndefined();
    expect(lastFirst(st) <= CUTOFF).toBe(true);
  });

  it("BUSY before it has written to anyone: the whole pass waits, and its 30 days run from the day it may start", { timeout: 60_000 }, () => {
    const st = shop(100);
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    setBookedOut(st, "2026-12-15", `${ASOF}T15:00:00`);
    // as when it's planned booked out
    expect(st.dataset.business.plan).toMatchObject({ startedOn: "2026-11-24", targetEndOn: "2026-12-24" });
    expect(firstNotes(st).every((t) => t.dueAt >= "2026-11-24")).toBe(true);
    expect(st.dataset.business.plan.pace!.late).toBeUndefined();
    recorded(st);
    // nothing new to wait for: BUSY for a shorter spell moves nobody
    expect(setBookedOut(st, "2026-12-01", `${ASOF}T16:00:00`).moved).toBe(0);
  });
});

describe("a newer quote on a one pass", () => {
  it("someone whose follow-ups it stopped isn't planned again (each person once); on a monthly plan they are", () => {
    const run = (plan: PlanState) => {
      const st = emptyState(dataset({ business: { plan, sendDays: WEEKDAYS, fromEmails: ["sarah@ridgeline-mail.com"] }, customers: [customer("c1")], quotes: [quote("q1", "c1", { title: "Dead oak over the garage", total: 2400 })] }), `${ASOF}T12:00:00`);
      planBatch(st, `${ASOF}T12:00:00`, { startOn: START, approve: true });
      // part-way through: note 1 out, then a revised quote stops the rest
      const n1 = st.touches.find((t) => t.step === 1)!;
      markSent(st, n1.id, `${n1.dueAt}:00`, "msg-n1");
      st.dataset.quotes = [...st.dataset.quotes, quote("q2", "c1", { title: "Dead oak over the garage, revised", total: 2000, sentOn: "2026-10-06" })];
      expect(dropSettled(st, "2026-10-07T12:00:00").map((t) => t.lastError)).toContain("No longer needed: they've had a new quote since");
      // the revised quote is old enough to follow up
      st.dataset.asOf = "2026-10-28";
      find(st, "2026-10-28T03:00:00");
      return planBatch(st, "2026-10-28T03:00:00", { startOn: "2026-10-28", approve: true }).people;
    };
    expect(run(onePassPlan())).toEqual([]);
    expect(run({ ...monthlyPlan(), stage: "paying", paidOn: ago(40) })).toEqual(["c1"]);
  });
});

describe("no rescan on a one pass", () => {
  it("someone written to 200 days ago is back on a monthly list after 150 days, never on a one pass's", () => {
    const state = (plan: PlanState) => {
      const st = shop(1, plan);
      st.outreach.push({ customerId: "c0", firstTouchOn: ago(200), lastTouchOn: ago(200) });
      find(st, `${ASOF}T12:00:00`);
      return st.scan!.opportunities.find((o) => o.customerId === "c0")!;
    };
    expect(state(monthlyPlan()).suppressed).toBeUndefined();
    expect(state(onePassPlan()).suppressed).toBe("recently_contacted");
  });
});

/** A one pass part-way: `sent` people's three notes out (the last on `lastOn`), `left` notes still queued. */
function underWay(sent: number, lastOn: string, left = 0): AccountState {
  const st = shop(sent + 5, onePassPlan({ startedOn: START, targetEndOn: END }));
  find(st, `${ASOF}T12:00:00`);
  for (let i = 0; i < sent; i++)
    for (const step of [1, 2, 3]) st.touches.push(note(`c${i}`, step, "sent", lastOn));
  for (let i = 0; i < left; i++) st.touches.push(note(`c${sent + i}`, 1, "approved", lastOn));
  return st;
}

function note(customerId: string, step: number, status: Touch["status"], on: string): Touch {
  return { id: `t-${customerId}-${step}`, opportunityId: `o-${customerId}`, customerId, channel: "email", step, angle: "check_in", dueAt: `${on}T08:00`, ...(status === "sent" ? { sentAt: `${on}T08:00:00` } : {}), status, body: "", flags: [] };
}

function reply(id: string, customerId: string, intent: Reply["intent"]): Reply {
  return { id, customerId, channel: "email", receivedAt: "2026-10-20T10:00:00", from: `${customerId}@gmail.com`, text: "Hi", intent, confidence: 0.9, extracted: {}, status: "done" };
}

describe("the end of a one pass", () => {
  it("not while notes are still to go; once nothing's left and the end date has passed, it's done and the last text waits", () => {
    const st = underWay(12, "2026-11-02", 1);
    expect(passEndIfDue(st, "2026-11-10T09:00:00")).toBeUndefined();
    st.touches.find((t) => t.status === "approved")!.status = "sent";
    // nothing left, but the end date hasn't passed and the last note went yesterday: replies are still coming in
    expect(passEndIfDue(st, "2026-11-03T09:00:00")).toBeUndefined();
    const m = passEndIfDue(st, "2026-11-05T09:00:00")!;
    expect(m.kind).toBe("pass_end");
    expect(st.dataset.business.plan.stage).toBe("done");
    expect(st.dataset.business.plan.doneOn).toBe("2026-11-05");
    // once
    expect(passEndIfDue(st, "2026-11-06T09:00:00")).toBeUndefined();
    expect(endPass(st, "2026-11-06T09:00:00")).toBeUndefined();
    expect(st.ownerMessages.filter((x) => x.kind === "pass_end")).toHaveLength(1);
  });

  it("a late pass isn't done the morning its last notes go: their replies get three days to come in", () => {
    // the end date (Nov 4) is long gone when the last notes go out
    const st = underWay(10, "2026-11-09");
    expect(passEndIfDue(st, "2026-11-09T09:00:00")).toBeUndefined();
    expect(passEndIfDue(st, "2026-11-11T09:00:00")).toBeUndefined();
    expect(passEndIfDue(st, "2026-11-12T09:00:00")?.kind).toBe("pass_end");
  });

  it("a list done early ends a week after its last note", () => {
    const st = underWay(5, "2026-10-12");
    expect(passEndIfDue(st, "2026-10-18T09:00:00")).toBeUndefined();
    expect(passEndIfDue(st, "2026-10-19T09:00:00")?.kind).toBe("pass_end");
  });

  it("marked done by a person: whatever's queued is stopped, and the owner isn't waited on any more", () => {
    const st = underWay(3, "2026-10-12", 4);
    st.awaitingOwnerOk = "2026-10-01T09:00:00";
    endPass(st, "2026-10-14T09:00:00");
    expect(st.touches.filter((t) => t.status === "approved" || t.status === "planned")).toEqual([]);
    expect(st.touches.filter((t) => t.lastError === "Not sent: the pass is done")).toHaveLength(4);
    expect(st.awaitingOwnerOk).toBeUndefined();
  });

  it("the tally in the brief's shape, the one pass's words, never $497 and no 'free'", () => {
    const st = underWay(412, "2026-11-02");
    st.replies = [
      ...Array.from({ length: 9 }, (_, i) => reply(`w${i}`, `c${i}`, "wants_it")),
      reply("w9b", "c0", "wants_price"),
      ...Array.from({ length: 29 }, (_, i) => reply(`n${i}`, `c${20 + i}`, i % 2 ? "not_interested" : "stop")),
      reply("auto", "c60", "auto_reply"),
    ];
    st.recoveries = Array.from({ length: 6 }, (_, i) => ({ id: `rec${i}`, customerId: `c${i}`, record: { kind: "job" as const, id: `j${i}` }, value: 2400, cameBackOn: "2026-10-25", tier: "traced" as const, match: "owner_reported" as const, confidence: 1 }));
    // four of them charged and paid (B4)
    st.dataset.business.plan.charges = Array.from({ length: 4 }, (_, i) => ({ id: `chg${i}`, customerId: `c${i}`, code: "K7Q", amount: 25000, status: "paid" as const, via: "card" as const, at: "2026-10-26T09:00:00" }));
    const text = passEndText(st, "2026-11-05");
    expect(text.split("\n")[0]).toBe("Dave, your list is done. Asked 412, 38 wrote back, 9 wanted the work, 6 booked. You paid $1,000, the cap.");
    expect(text).toContain("I'll check back next season.");
    expect(text).not.toMatch(/\$497|497|free|asked to come back|price or a date/i);
  });

  it("the refill check: monthly when about 30 or more come due each month, else next season", () => {
    const st = underWay(5, "2026-11-02");
    const lapsed = (n: number): ScanResult => ({ ...st.scan!, opportunities: Array.from({ length: n }, (_, i) => opp(`p${i}`, "lapsed_regular", ago(i % 360, "2026-11-05"))) });
    st.scan = lapsed(12 * MONTHLY_REFILL);
    const monthly = passEndText(st, "2026-11-05");
    expect(monthly).toContain("About 30 more of your past customers stop coming or come due each month. That's enough to keep this going monthly: reply here and Jack will text you how it works.");
    expect(monthly).not.toMatch(/\$|free|next season/);
    st.scan = lapsed(12 * 20);
    expect(passEndText(st, "2026-11-05")).toContain("I'll check back next season.");
  });

  it("an end text offering monthly is marked as asking, so the owner's yes or no answers it", () => {
    const offer = (n: number) => {
      const st = underWay(5, "2026-11-02");
      st.scan = { ...st.scan!, opportunities: Array.from({ length: n }, (_, i) => opp(`p${i}`, "lapsed_regular", ago(i % 360, "2026-11-05"))) };
      return endPass(st, "2026-11-05T09:00:00")!.refs;
    };
    expect(offer(12 * MONTHLY_REFILL)).toEqual([{ kind: "monthly_offer", id: "2026-11-05" }]);
    expect(offer(12 * 20)).toBeUndefined();
  });

  it("after a free round, the tally is the pass's own: who it wrote to, their replies and their bookings", () => {
    const st = underWay(3, "2026-11-02");
    // a free round in September: five people written to, two wrote back, one booked
    for (let i = 0; i < 5; i++) st.touches.push({ ...note(`f${i}`, 1, "sent", "2026-09-10"), id: `free-${i}` });
    st.replies = [reply("fr1", "f0", "wants_it"), reply("fr2", "f1", "not_interested"), reply("pr1", "c0", "wants_it")];
    st.recoveries = [
      { id: "rf", customerId: "f0", record: { kind: "job", id: "jf" }, value: 900, cameBackOn: "2026-09-20", tier: "traced", match: "owner_reported", confidence: 1 },
      { id: "rp", customerId: "c0", record: { kind: "job", id: "jp" }, value: 2400, cameBackOn: "2026-10-25", tier: "traced", match: "owner_reported", confidence: 1 },
    ];
    expect(passEndText(st, "2026-11-05").split("\n")[0]).toBe("Dave, your list is done. Asked 3, 1 wrote back, 1 wanted the work, 1 booked. You paid nothing.");
    expect(passProgress(st)).toEqual({ people: 3, started: 3, sent: 9, notes: 9 });
  });
});

function opp(customerId: string, type: Opportunity["type"], anchorDate: string, over: Partial<Opportunity> = {}): Opportunity {
  return { id: `op-${customerId}-${type}`, type, customerId, source: { kind: "job", id: `j-${customerId}` }, value: 500, expectedValue: 100, recoverProbability: 0.2, score: 50, ageDays: 100, anchorDate, reason: "", evidence: [], jobPhrase: "the mowing", serviceId: "lawn.mowing", seasonFit: "now", channels: ["email"], ...over };
}

describe("who gets monthly: how fast the list refills", () => {
  const rate = (opportunities: Opportunity[]) => refillRate({ opportunities } as ScanResult, ASOF);

  it("past customers who stopped or came due in the last 12 months, a month on average", () => {
    expect(rate(Array.from({ length: 360 }, (_, i) => opp(`p${i}`, "lapsed_regular", ago(i)))).perMonth).toBe(30);
    expect(rate(Array.from({ length: 360 }, (_, i) => opp(`p${i}`, "lapsed_regular", ago(i)))).monthly).toBe(true);
    expect(rate(Array.from({ length: 300 }, (_, i) => opp(`p${i}`, "service_due", ago(i)))).monthly).toBe(false);
  });

  it("counts each person once, and a one-time customer from when the one-and-done wait is up", () => {
    expect(rate([opp("a", "lapsed_regular", ago(10)), opp("a", "service_due", ago(20), { id: "x" })]).perMonth).toBe(0);
    expect(rate(Array.from({ length: 12 }, (_, i) => opp(`p${i}`, "lapsed_regular", ago(10)))).perMonth).toBe(1);
    // a job 400 days ago was one-and-done 100 days ago; one 700 days ago, 400 days ago
    expect(rate(Array.from({ length: 12 }, (_, i) => opp(`p${i}`, "one_and_done", ago(400))))).toEqual({ perMonth: 1, monthly: false });
    expect(rate(Array.from({ length: 12 }, (_, i) => opp(`p${i}`, "one_and_done", ago(700)))).perMonth).toBe(0);
  });

  it("leaves out who came back, has work on, can't be emailed, stopped over a year ago, and old quotes; counts who we already wrote to", () => {
    const twelve = (over: Partial<Opportunity>, anchor = ago(10)) => Array.from({ length: 12 }, (_, i) => opp(`p${i}`, "lapsed_regular", anchor, over));
    expect(rate(twelve({ suppressed: "already_customer_again" })).perMonth).toBe(0);
    expect(rate(twelve({ suppressed: "active_work" })).perMonth).toBe(0);
    expect(rate(twelve({ channels: ["postcard"] })).perMonth).toBe(0);
    expect(rate(twelve({}, ago(400))).perMonth).toBe(0);
    expect(rate(Array.from({ length: 12 }, (_, i) => opp(`p${i}`, "unanswered_quote", ago(10)))).perMonth).toBe(0);
    expect(rate(twelve({ suppressed: "recently_contacted" })).perMonth).toBe(1);
  });

  it("from a real scan of a tree shop's quotes alone, nothing refills", () => {
    const st = shop(50);
    expect(refillRate(scan(st.dataset), ASOF)).toEqual({ perMonth: 0, monthly: false });
  });
});

describe("the one pass's gates", () => {
  it("no free-round close and no $497 billing check, whatever else the plan says", () => {
    const st = underWay(5, "2026-10-12");
    st.dataset.business.plan.paidOn = "2026-09-01";
    expect(closeIfDue(st, "2026-10-30T09:00:00")).toBeUndefined();
    expect(billingCheck(st, "2026-10-30T09:00:00")).toBeUndefined();
    // the same account on the monthly plan gets both
    st.dataset.business.plan = { ...monthlyPlan(), paidOn: "2026-09-01" };
    expect(closeIfDue(st, "2026-10-30T09:00:00")?.kind).toBe("close");
    st.dataset.business.plan.stage = "paying";
    expect(billingCheck(st, "2026-09-30T09:00:00")).toBeDefined();
    expect(passEndIfDue(st, "2026-12-30T09:00:00")).toBeUndefined();
  });

  it("a paying monthly plan made a one pass: its Friday text says nothing of what the monthly plan charged", () => {
    const st = underWay(5, "2026-10-12");
    const paying: PlanState = { ...monthlyPlan(), stage: "paying", paidOn: "2026-08-03" };
    st.dataset.business.plan = paying;
    expect(weeklyReport(st, "2026-10-12")).toContain("You've paid us $1,491.");
    // as Settings makes it: the one pass's terms over the plan it was
    st.dataset.business.plan = onePassPlan({ ...paying, kind: "one_pass", stage: "running", startedOn: START, targetEndOn: END });
    expect(weeklyReport(st, "2026-10-12")).not.toMatch(/paid us|497|1,491/);
  });
});

describe("the one pass's welcome", () => {
  const welcome = (plan: Partial<PlanState> = {}) => {
    const st = shop(30, onePassPlan(plan));
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START });
    return { st, text: st.ownerMessages.find((m) => m.kind === "kickoff")!.text };
  };

  it("its own words: newest first, one pass with its last day, the one-pass promise, never $497 or 'free'", () => {
    const { st, text } = welcome();
    const last = st.touches.map((t) => t.dueAt.slice(0, 10)).sort().pop()!;
    expect(text).toContain(`newest first, each one about their own job. It's one pass through your list: the last notes go out ${monthName(last)} ${Number(last.slice(8))}.`);
    expect(text).toContain("Nothing goes out until you say OK.");
    expect(text).toContain("When someone wants the work, I'll text you their name, number and what they said.");
    expect(text.split("\n").at(-1)).toBe("You pay $250 for each job that books, never more than $1,000. Nothing books, you owe nothing.");
    expect(text).not.toMatch(/497|free|most likely to answer/i);
  });

  it("a pass promised its first 150 free says so, with the price beside it", () => {
    const { text } = welcome({ freeFirst: 150 });
    expect(text.split("\n").at(-1)).toBe("Jobs from your first 150 people are free, as promised. For everyone after them: You pay $250 for each job that books, never more than $1,000. Nothing books, you owe nothing.");
    expect(text).not.toContain("497");
  });

  it("the promise in the pass's own numbers", () => {
    expect(passPromise({})).toBe("You pay $250 for each job that books, never more than $1,000. Nothing books, you owe nothing.");
    expect(passPromise({ pricePerBooking: 300, capBookings: 3 })).toBe("You pay $300 for each job that books, never more than $900. Nothing books, you owe nothing.");
  });

  it("a monthly welcome is as it was", () => {
    const st = shop(30, monthlyPlan());
    planBatch(st, `${ASOF}T12:00:00`, { startOn: START, limitPeople: 30 });
    expect(kickoffText(st, START, 30)).toContain("to the people most likely to answer");
  });
});
