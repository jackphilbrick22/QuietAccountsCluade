import { describe, expect, it } from "vitest";
import { scan } from "../src/breakage/detect.ts";
import { HOLIDAYS_LINE, holidayOn, holidaysOf } from "../src/cadence/holidays.ts";
import { paceOnePass, NOTES_SPAN_DAYS } from "../src/cadence/pace.ts";
import { allowedDay, nextAllowed, planOutreach } from "../src/cadence/plan.ts";
import { dueTouches } from "../src/runtime/agents.ts";
import { emptyState } from "../src/runtime/state.ts";
import { generateSample } from "../src/sample/generate.ts";
import type { Touch } from "../src/model.ts";
import { addDays, weekday } from "../src/util.ts";
import { customer, dataset } from "./fixtures.ts";

/**
 * Jack's answer (Oct 1): no customer note goes out on a US holiday, worked out for each year, in the client's own local
 * days. Planning, a one pass's pace and the sender all skip them.
 */

const MON_FRI = [1, 2, 3, 4, 5];
const days = (ds: ReturnType<typeof dataset>, from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (allowedDay(ds, d)) out.push(d);
  return out;
};

describe("the holidays, worked out for each year", () => {
  it("2026: July 4 is a Saturday, so Friday July 3 is held too; Thanksgiving is November 26", () => {
    expect(Object.fromEntries(holidaysOf(2026))).toEqual({
      "2026-01-01": "New Year's Day",
      "2026-05-25": "Memorial Day",
      "2026-07-04": "Independence Day",
      "2026-07-03": "Independence Day (observed)",
      "2026-09-07": "Labor Day",
      "2026-11-26": "Thanksgiving",
      "2026-11-27": "the day after Thanksgiving",
      "2026-12-24": "Christmas Eve",
      "2026-12-25": "Christmas Day",
    });
  });

  it("2027: July 4 on a Sunday holds the Monday after; Christmas on a Saturday holds Friday the 24th, once; New Year's 2028 on a Saturday holds Friday December 31", () => {
    expect(Object.fromEntries(holidaysOf(2027))).toEqual({
      "2027-01-01": "New Year's Day",
      "2027-05-31": "Memorial Day",
      "2027-07-04": "Independence Day",
      "2027-07-05": "Independence Day (observed)",
      "2027-09-06": "Labor Day",
      "2027-11-25": "Thanksgiving",
      "2027-11-26": "the day after Thanksgiving",
      "2027-12-24": "Christmas Eve",
      "2027-12-25": "Christmas Day",
      "2027-12-31": "New Year's Day (observed)",
    });
    expect(holidayOn("2027-12-31")).toBe("New Year's Day (observed)");
  });

  it("2028: New Year's Day is a Saturday (its Friday was in 2027); Christmas Eve on a Sunday holds nothing more", () => {
    expect(Object.fromEntries(holidaysOf(2028))).toEqual({
      "2028-01-01": "New Year's Day",
      "2028-05-29": "Memorial Day",
      "2028-07-04": "Independence Day",
      "2028-09-04": "Labor Day",
      "2028-11-23": "Thanksgiving",
      "2028-11-24": "the day after Thanksgiving",
      "2028-12-24": "Christmas Eve",
      "2028-12-25": "Christmas Day",
    });
    expect(holidayOn("2027-12-30")).toBeUndefined();
  });

  it("a Sunday New Year's or Christmas holds the Monday after", () => {
    expect(holidayOn("2023-01-02")).toBe("New Year's Day (observed)");
    expect(holidayOn("2022-12-26")).toBe("Christmas Day (observed)");
  });

  it("Memorial Day, Labor Day and Thanksgiving land on their own weekday every year", () => {
    for (let y = 2026; y <= 2040; y++) {
      const named = (name: string) => [...holidaysOf(y)].find(([, n]) => n === name)![0];
      const memorial = named("Memorial Day");
      expect([weekday(memorial), memorial.slice(5, 7), addDays(memorial, 7).slice(5, 7)], `${y}`).toEqual([1, "05", "06"]);
      const labor = named("Labor Day");
      expect([weekday(labor), labor.slice(5, 7), Number(labor.slice(8)) <= 7], `${y}`).toEqual([1, "09", true]);
      const thanks = named("Thanksgiving");
      expect([weekday(thanks), Number(thanks.slice(8)) >= 22 && Number(thanks.slice(8)) <= 28], `${y}`).toEqual([4, true]);
      expect(named("the day after Thanksgiving")).toBe(addDays(thanks, 1));
    }
  });

  it("the send days' footnote names each one", () => {
    for (const name of ["New Year's Day", "Memorial Day", "July 4", "Labor Day", "Thanksgiving and the Friday after", "Christmas Eve", "Christmas Day"]) expect(HOLIDAYS_LINE).toContain(name);
  });
});

describe("planning around them", () => {
  const ds = dataset({ business: { sendDays: MON_FRI } });

  it("a holiday is never a send day, and the next one after it is the first that is", () => {
    expect(days(ds, "2026-11-23", "2026-12-01")).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-30", "2026-12-01"]);
    expect(nextAllowed(ds, "2026-11-26")).toBe("2026-11-30");
    expect(nextAllowed(ds, "2026-07-03")).toBe("2026-07-06");
    expect(nextAllowed(ds, "2027-12-24")).toBe("2027-12-27");
    expect(nextAllowed(ds, "2027-12-31")).toBe("2028-01-03");
    expect(nextAllowed(ds, "2026-12-31")).toBe("2026-12-31");
  });

  it("a monthly round planned across Thanksgiving and Christmas sends nothing on them, follow-ups included", () => {
    const sample = generateSample({ trade: "tree", asOf: "2026-11-20" });
    const tree = { ...sample.dataset, business: { ...sample.dataset.business, sendDays: MON_FRI, weeklyNewContacts: 40 } };
    const plan = planOutreach(tree, scan(tree), { startOn: "2026-11-23", limitPeople: 150 });
    expect(plan.people.length).toBeGreaterThan(100);
    const on = new Set(plan.touches.map((t) => t.dueAt.slice(0, 10)));
    expect(on.has("2026-11-25")).toBe(true);
    for (const d of on) expect(holidayOn(d), d).toBeUndefined();
    // a follow-up that would land on a holiday goes the next send day instead
    expect(plan.touches.some((t) => t.step > 1 && t.dueAt.slice(0, 10) === "2026-11-30")).toBe(true);
  });
});

describe("a one pass paced across Thanksgiving week", () => {
  const sendsOn = (d: string) => allowedDay(dataset({ business: { sendDays: MON_FRI } }), d);
  const START = "2026-11-16";
  const END = addDays(START, 30);

  it("600 people on five inboxes: nothing on Thursday or Friday, and it still meets its date", () => {
    const p = paceOnePass({ notes: Array(600).fill(3), startOn: START, endOn: END, inboxes: 5, sendsOn });
    expect(p.late).toBeUndefined();
    expect(p.lastFirst! <= addDays(END, -NOTES_SPAN_DAYS)).toBe(true);
    const on = p.days.map((d) => d.day);
    expect(on).not.toContain("2026-11-26");
    expect(on).not.toContain("2026-11-27");
    for (const person of p.people) for (const d of person) expect(holidayOn(d), d).toBeUndefined();
    // the follow-ups owed on Thanksgiving and the Friday went on Monday
    expect(p.days.find((d) => d.day === "2026-11-30")).toMatchObject({ followUps: 150 });
  });

  it("on three it can't make it: it says the date it can meet, and plans to it, still nothing on the holidays", () => {
    const p = paceOnePass({ notes: Array(600).fill(3), startOn: START, endOn: END, inboxes: 3, sendsOn });
    expect(p.late).toEqual({ canMeet: "2026-12-21", moreInboxes: 1 });
    expect(p.endOn).toBe("2026-12-21");
    for (const person of p.people) for (const d of person) expect(holidayOn(d), d).toBeUndefined();
  });
});

describe("a note planned for a holiday before they were held", () => {
  const touch = (id: string, on: string, over: Partial<Touch> = {}): Touch => ({ id, opportunityId: `o-${id}`, customerId: "c1", channel: "email", step: 1, angle: "check_in", dueAt: `${on}T08:00`, status: "approved", subject: "The maples", body: "A note.", flags: [], ...over });

  it("waits for the next send day, an answer to a request included", () => {
    const st = emptyState(dataset({ customers: [customer("c1"), customer("c2")], business: { sendDays: MON_FRI } }), "2026-11-20T09:00:00");
    st.touches.push(touch("t1", "2026-11-26"), touch("rq1", "2026-11-26", { customerId: "c2", opportunityId: "req:r1", track: "new_request", instant: true }));
    expect(dueTouches(st, "2026-11-26T09:00").held.map((x) => [x.touch.id, x.why])).toEqual([
      ["t1", "A holiday: Thanksgiving"],
      ["rq1", "A holiday: Thanksgiving"],
    ]);
    expect(dueTouches(st, "2026-11-27T09:00").held.find((x) => x.touch.id === "t1")?.why).toBe("A holiday: the day after Thanksgiving");
    expect(dueTouches(st, "2026-11-27T09:00").due).toEqual([]);
    expect(dueTouches(st, "2026-11-30T09:00").due.map((x) => x.touch.id)).toContain("t1");
  });
});
