import { describe, expect, it } from "vitest";
import { scan } from "../src/breakage/detect.ts";
import { goesOutOn, planOutreach } from "../src/cadence/plan.ts";
import { renderNote } from "../src/copy/render.ts";
import { emptyDataset, ingestFile } from "../src/ingest/index.ts";
import type { BreakageType, BusinessProfile, Dataset, ISODate } from "../src/model.ts";
import { closeIfDue, dueTouches, find, markSent, OFF_SEASON, ownerApproves, planBatch } from "../src/runtime/agents.ts";
import { emptyState } from "../src/runtime/state.ts";
import { generateSample } from "../src/sample/generate.ts";
import { goneForSeason, growingSeason, sellingSeason, sellingWindow, shopSeasonEnd } from "../src/trades/index.ts";
import { addDays } from "../src/util.ts";
import { ago, business, customer, dataset, invoice, job, oneOpp, oppsFor, reachable } from "./fixtures.ts";
import { NH_MOWING, SEASON_SCANS, seasonalClients, visitsReport, type SeasonalClient, type Story } from "./lawn-fixtures.ts";

const lawn = (over: Partial<BusinessProfile> = {}) => business({ trade: "lawn", name: "Greenline Lawn Care", avgJobValue: undefined, ...over });
const NH = growingSeason(lawn());

/** The seasonal shop's Visits report as it stands on `asOf`, read and scanned: in New Hampshire unless `over` says, mowing `mows`. */
const shopOn = (asOf: ISODate, over: Partial<BusinessProfile> = {}, mows = NH_MOWING) => {
  const clients = seasonalClients(asOf, mows);
  const ds = ingestFile(emptyDataset(lawn(over), asOf), visitsReport(clients, "newest"), "Visits Report.csv", `${asOf}T12:00:00Z`).dataset;
  const r = scan(ds);
  const id = (c: SeasonalClient) => ds.customers.find((x) => x.emails.includes(c.email))!.id;
  const who = (...stories: Story[]) => clients.filter((c) => stories.includes(c.story)).map(id).sort();
  return { clients, ds, r, id, who };
};

describe("the growing season, by where the business is", () => {
  it("New Hampshire mows mid-April to the end of October: about 28 weeks", () => {
    expect(NH).toMatchObject({ climate: "cold", opens: "04-15", closes: "10-31", days: 199, fallEnds: "11-15" });
    expect(Math.round(NH.days / 7)).toBe(28);
    // a profile with no state reads it from the mailing address; with neither, it's the north's, the shortest
    expect(growingSeason({ mailingAddress: "9 Carter St, Concord, NH 03301" })).toEqual(NH);
    expect(growingSeason({})).toEqual(NH);
  });

  it("the rest of the cold states open in March and sell fall clean-up to the end of November; warm states mow February to November", () => {
    expect(growingSeason({ state: "PA" })).toMatchObject({ climate: "cold", opens: "03-01", closes: "10-31", fallEnds: "11-30" });
    expect(growingSeason({ mailingAddress: "12 Palm Ave, Tampa, FL 33602" })).toMatchObject({ climate: "warm", opens: "02-01", closes: "11-30" });
  });

  it("sells in fall clean-up season and January to March: never in summer, never in December", () => {
    const at = (day: ISODate, season = NH) => sellingWindow(season, day);
    expect(["2026-07-15", "2026-08-31", "2026-11-16", "2026-12-01", "2026-12-31", "2027-04-01", "2027-06-15"].map((d) => at(d))).toEqual(Array(7).fill(undefined));
    expect(["2026-09-01", "2026-10-15", "2026-11-15"].map((d) => at(d))).toEqual(["fall", "fall", "fall"]);
    expect(["2027-01-01", "2027-01-15", "2027-03-01", "2027-03-31"].map((d) => at(d))).toEqual(["spring", "spring", "spring", "spring"]);
    expect(at("2026-11-20", growingSeason({ state: "PA" }))).toBe("fall");
  });

  it("a note is written for one selling season, by its year: spring is the first half, fall the second", () => {
    expect(["2027-01-04", "2027-03-31", "2027-06-30", "2027-07-01", "2027-11-15", "2027-12-31"].map(sellingSeason)).toEqual(["2027-spring", "2027-spring", "2027-spring", "2027-fall", "2027-fall", "2027-fall"]);
  });

  it("a regular is gone four weeks into his usual season without him, or after three missed visits mid-season; never over the winter", () => {
    const gone = (last: ISODate, asOf: ISODate, every = 7, startedOn?: ISODate) => goneForSeason(NH, { visit: last, seen: last }, asOf, { every, quietDays: 53, startedOn });
    // the end of last season: not gone over the winter, gone once the season is four weeks open without him
    expect(gone("2025-10-28", "2026-01-15")).toBe(false);
    expect(gone("2025-10-28", "2026-05-12")).toBe(false);
    expect(gone("2025-10-28", "2026-05-13")).toBe(true);
    // one who usually starts in late May is given his own four weeks
    expect(gone("2025-10-28", "2026-06-10", 7, "2025-05-25")).toBe(false);
    expect(gone("2025-10-28", "2026-06-23", 7, "2025-05-25")).toBe(true);
    // mid-season: three missed weekly visits, six weeks for one every other week; a season's close cuts the count short
    expect(gone("2026-07-10", "2026-07-31")).toBe(false);
    expect(gone("2026-07-10", "2026-08-01")).toBe(true);
    expect(gone("2026-07-10", "2026-08-21", 14)).toBe(false);
    expect(gone("2026-07-10", "2026-08-22", 14)).toBe(true);
    expect(gone("2026-10-15", "2027-03-01")).toBe(false);
    expect(gone("2026-10-01", "2027-03-01")).toBe(true);
    // a visit or a bill before the season opened misses nothing: he's gone four weeks in, as anyone back from the winter
    expect(gone("2026-03-20", "2026-05-12")).toBe(false);
    expect(gone("2026-03-20", "2026-05-13")).toBe(true);
  });

  it("his season ends where the shop's mowing ended that year, or earlier where he usually stops", () => {
    const usual = { every: 7, quietDays: 53 };
    const gone = (last: ISODate, asOf: ISODate, shopEnded?: ISODate, ended?: ISODate[]) => goneForSeason(NH, { visit: last, seen: last }, asOf, { ...usual, ended }, shopEnded);
    // the shop stopped mowing October 5th: its regulars' last mows that week missed nothing, all winter
    expect(gone("2026-10-05", "2026-11-02", "2026-10-05")).toBe(false);
    expect(gone("2026-10-01", "2027-01-15", "2026-10-05")).toBe(false);
    expect(gone("2026-09-10", "2027-01-15", "2026-10-05")).toBe(true);
    // a shop that mowed this past week is still in its season
    expect(gone("2026-09-01", "2026-09-29", "2026-09-25")).toBe(true);
    // one who mows to late September every year, as he did last year, is between seasons; one who stopped in July isn't
    expect(gone("2026-09-22", "2027-01-15", "2026-10-29", ["2025-09-23"])).toBe(false);
    expect(gone("2026-07-10", "2027-01-15", "2026-10-29", ["2025-09-23"])).toBe(true);
    // one season that ended early (he quit in May and was won back) says nothing about this one; two running do
    expect(gone("2026-07-13", "2026-09-15", "2026-09-14", ["2025-05-12"])).toBe(true);
    expect(gone("2026-08-24", "2027-01-15", "2026-10-29", ["2025-08-25", "2024-08-19"])).toBe(false);
    expect(gone("2026-08-24", "2027-01-15", "2026-10-29", ["2025-08-25", "2024-06-03"])).toBe(true);
    // a fall clean-up after he quit the mowing in July makes up for no missed mow; any work of ours is being back for a season
    expect(goneForSeason(NH, { visit: "2026-07-14", seen: "2026-10-20" }, "2027-01-15", usual)).toBe(true);
    expect(goneForSeason(NH, { visit: "2025-10-28", seen: "2026-05-02" }, "2026-06-01", usual)).toBe(false);
  });

  it("the shop's mowing ended where three in four of its regulars still on it late in the season stopped", () => {
    // two who quit in July, five done to the first week of October, one to the end of it
    expect(shopSeasonEnd(NH, ["2026-07-10", "2026-07-13", "2026-10-05", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-29"])).toBe("2026-10-02");
    // a regular or two done later than the rest don't carry it on
    expect(shopSeasonEnd(NH, ["2026-10-05", "2026-10-29"])).toBe("2026-10-05");
    expect(shopSeasonEnd(NH, [...Array(5).fill("2026-10-05"), "2026-10-29", "2026-10-30"])).toBe("2026-10-05");
    // records of mowing that stop before mid-September are short, not the season
    expect(shopSeasonEnd(NH, ["2026-07-10", "2026-08-20", "2026-09-18"])).toBeUndefined();
    expect(shopSeasonEnd(NH, ["2026-08-20", "2026-09-19"])).toBe("2026-09-19");
    expect(shopSeasonEnd(NH, [])).toBeUndefined();
  });
});

/** Still on the schedule on each day: the regulars, one new in 2026, one who always starts in mid-June, one who only mows the summer. */
const ACTIVE = (asOf: ISODate): Story[] => ["regular", "regularWithCleanup", "newIn2026", "lateStarter", "summerOnly", ...(asOf < "2027-06-01" ? (["doneAfter2026"] as const) : [])];

/** A scan of the seasonal shop flags none of its active customers, by any kind of opportunity, and finds every lapsed regular. */
function flagsOnlyTheLapsed({ clients, r, who }: ReturnType<typeof shopOn>, asOf: ISODate): void {
  const active = new Set(who(...ACTIVE(asOf)));
  expect(active.size).toBeGreaterThanOrEqual(17);
  expect(r.opportunities.filter((o) => active.has(o.customerId)), asOf).toEqual([]);
  const lapsed = who(...clients.filter((c) => c.lapsed).map((c) => c.story));
  expect(lapsed.length).toBe(asOf < "2027-06-01" ? 5 : 8);
  // each one, ready to write to, and the first thing to write to them about
  expect(lapsed.map((x) => reachable(r, x, "lapsed_regular").length), asOf).toEqual(lapsed.map(() => 1));
  for (const x of lapsed) expect(r.primary.find((p) => p.customerId === x)?.type).toBe("lapsed_regular");
}

describe("a mowing shop through the seasons", () => {
  it.each(SEASON_SCANS)("on %s it flags no active customer, by any kind of opportunity, and finds every lapsed regular", (asOf) => flagsOnlyTheLapsed(shopOn(asOf), asOf));

  it("October finds last season's fall-cleanup and aeration customers, due now; a spring clean-up waits for spring", () => {
    const { r, who } = shopOn("2026-10-15");
    for (const x of who("fallCleanup")) expect(r.primary.find((p) => p.customerId === x)).toMatchObject({ type: "service_due", serviceId: "lawn.cleanup" });
    expect(r.primary.find((p) => p.customerId === who("aeration")[0])).toMatchObject({ type: "service_due", serviceId: "lawn.aerate" });
    // between seasons is not "hired you once and never came back"
    for (const x of who("springCleanup")) expect(oppsFor(r, x)).toEqual([]);
    expect(who("springCleanup").map((x) => oppsFor(shopOn("2027-03-20").r, x).map((o) => [o.type, o.serviceId]))).toEqual([[["service_due", "lawn.cleanup"]], [["service_due", "lawn.cleanup"]]]);
  });

  it("over the winter the clean-ups wait: last fall's clean-up isn't a past customer to write to in January", () => {
    const { r, who } = shopOn("2027-01-15");
    for (const x of who("fallCleanup", "springCleanup", "aeration")) expect(oppsFor(r, x)).toEqual([]);
  });

  it("a weekly regular is worth the season's 28 weeks, not 52; one every other week, 14", () => {
    const { r, clients, id } = shopOn("2026-10-15");
    const stopped = clients.filter((c) => c.story === "stoppedJuly2026");
    const value = (c: SeasonalClient) => oneOpp(r, id(c), "lapsed_regular");
    expect(stopped.map((c) => [c.every, value(c).value])).toEqual([[7, 28 * 45], [7, 28 * 45], [14, 14 * 55]]);
    expect(value(stopped[0]!).evidence).toContain("Worth about $1,260 a year as a regular");
  });

  /** What a plan made on `day` writes, to whom, and on which days. */
  const planOn = (day: ISODate) => {
    const { ds, r, who } = shopOn(day);
    const plan = planOutreach(ds, r, { startOn: day });
    return { r, plan, who, days: plan.touches.map((t) => t.dueAt.slice(0, 10)).sort() };
  };

  it("in the fall window, lapsed regulars get the fall clean-up line and last season's clean-ups their own notes", () => {
    const { plan, who } = planOn("2026-10-15");
    expect([...plan.people].sort()).toEqual(who("stoppedJuly2026", "stoppedAfter2025", "fallCleanup", "aeration"));
    const regulars = new Set(who("stoppedJuly2026", "stoppedAfter2025"));
    const second = plan.touches.filter((t) => regulars.has(t.customerId) && t.step === 2);
    expect(second).toHaveLength(regulars.size);
    for (const t of second) expect(t.body).toContain("we're putting the fall clean-up schedule together now. If you'd like the leaves taken care of this year, reply and I'll put you on it.");
    for (const t of plan.touches) expect(t.flags).toEqual([]);
  });

  it("January to March, lapsed regulars are asked to keep their spot for spring", () => {
    for (const day of ["2027-01-15", "2027-03-01"]) {
      const { plan, who } = planOn(day);
      const regulars = new Set(who("stoppedJuly2026", "stoppedAfter2025"));
      // in March the clean-ups are in season too, and get their own notes
      expect([...plan.people].sort(), day).toEqual(day < "2027-03-01" ? [...regulars] : who("stoppedJuly2026", "stoppedAfter2025", "fallCleanup", "springCleanup"));
      const theirs = plan.touches.filter((t) => regulars.has(t.customerId));
      expect(theirs.filter((t) => t.step === 1).map((t) => t.body.split("\n\n")[1])).toEqual(Array(5).fill(expect.stringMatching(/^Sarah at Greenline Lawn Care\. We used to take care of the mowing for you, and the last time was/)));
      expect(theirs.filter((t) => t.step === 2).map((t) => t.body.split("\n\n")[0])).toEqual(Array(5).fill(expect.stringMatching(/, we're setting the spring routes now\. Want me to keep your spot for spring\? Just reply and I'll hold it\.$/)));
      for (const t of plan.touches) expect(t.flags).toEqual([]);
    }
  });

  it("nothing is planned in December, and nothing in the north after mid-November", () => {
    const dec = planOn("2026-12-01");
    expect(reachable(dec.r, dec.who("stoppedJuly2026")[0]!, "lapsed_regular")).toHaveLength(1);
    expect(dec.plan.touches).toEqual([]);
    expect(planOn("2026-12-28").plan.touches).toEqual([]);
    // planned on November 10th: first notes go, follow-ups that would land past the 15th are left off
    const nov = planOn("2026-11-10");
    expect([...nov.plan.people].sort()).toEqual(nov.who("stoppedJuly2026", "stoppedAfter2025", "fallCleanup"));
    expect(nov.days.every((d) => d <= "2026-11-15")).toBe(true);
    expect(nov.plan.touches.filter((t) => t.step === 1)).toHaveLength(nov.plan.people.length);
    // in summer the crews are full: lapsed regulars wait for the fall window
    expect(planOn("2027-06-15").plan.touches).toEqual([]);
  });

  /** The shop's round planned on `day` (lapsed regulars, and in the fall last fall's clean-ups), waiting for the owner's OK. */
  const round = (day: ISODate = "2026-11-10", over: Partial<BusinessProfile> = {}) => {
    const { ds, who } = shopOn(day, over);
    const st = emptyState(ds, `${day}T12:00:00`);
    find(st, `${day}T12:00:00`);
    const ids = new Set(planBatch(st, `${day}T12:00:00`, { startOn: day }).touches.map((t) => t.id));
    const planned = st.touches.filter((t) => ids.has(t.id));
    expect(st.awaitingOwnerOk).toBeTruthy();
    expect(planned.some((t) => who("stoppedJuly2026").includes(t.customerId))).toBe(true);
    return { st, who, planned };
  };
  /** The worker's nightly rescan: last fall's clean-ups are out of season by December, and leave the scan. */
  const rescan = (st: ReturnType<typeof round>["st"], day: ISODate) => {
    st.dataset.asOf = day;
    find(st, `${day}T03:00:00`);
  };
  /** The note 2s that would go out on `at`, and why the rest of the approved notes are held. */
  const lines = (st: ReturnType<typeof round>["st"], at: string) => dueTouches(st, at).due.filter((x) => x.touch.step === 2).map((x) => x.touch.body.split("\n\n")[0]);
  const FALL_LINE = /we're putting the fall clean-up schedule together now/;
  const SPRING_LINE = /we're setting the spring routes now/;

  it("an OK that comes after the fall window closed writes the round again for spring: nothing goes out in December", () => {
    const { st, who, planned } = round();
    expect(planned.filter((t) => who("fallCleanup").includes(t.customerId))).toHaveLength(3);
    rescan(st, "2026-12-01");
    const r = ownerApproves(st, "2026-12-01T08:00:00");
    // the fall round is cancelled, and the lapsed regulars' notes are written for the first send day in January
    expect(r).toEqual({ approved: 10, late: { people: 8, firstDay: "2027-01-05" } });
    expect(planned.map((t) => [t.status, t.lastError])).toEqual(planned.map(() => ["cancelled", OFF_SEASON]));
    expect(dueTouches(st, "2026-12-01T09:59").due).toEqual([]);
    expect(dueTouches(st, "2026-12-29T09:59").due).toEqual([]);
    const jan = st.touches.filter((t) => t.status === "approved");
    expect([...new Set(jan.map((t) => t.customerId))].sort()).toEqual(who("stoppedJuly2026", "stoppedAfter2025"));
    expect(jan.map((t) => t.season)).toEqual(jan.map(() => "2027-spring"));
    expect(jan.filter((t) => t.step === 2).map((t) => t.body.split("\n\n")[0])).toEqual(Array(5).fill(expect.stringMatching(SPRING_LINE)));
    expect(dueTouches(st, "2027-01-05T09:59").due.map((x) => x.touch.step)).toEqual([1, 1, 1, 1, 1]);
    // no new welcome text: the owner already said OK
    expect(st.ownerMessages.filter((m) => m.kind === "kickoff")).toHaveLength(1);
  });

  it("an OK in January to a round written in November writes it again for spring: no fall line goes out in January", () => {
    const { st, who, planned } = round("2026-11-03");
    expect(planned.filter((t) => t.step === 2 && who("stoppedJuly2026", "stoppedAfter2025").includes(t.customerId)).map((t) => t.body)).toEqual(Array(5).fill(expect.stringMatching(FALL_LINE)));
    rescan(st, "2027-01-06");
    // the moved notes would all fall in the spring window, but they were written for the fall
    expect(ownerApproves(st, "2027-01-06T08:00:00")).toEqual({ approved: 10, late: { people: 8, firstDay: "2027-01-06" } });
    expect(planned.map((t) => [t.status, t.lastError])).toEqual(planned.map(() => ["cancelled", OFF_SEASON]));
    for (const t of st.touches.filter((x) => x.status === "approved")) markSent(st, t.id, `${t.dueAt.slice(0, 10)}T09:00:00`);
    expect(st.touches.filter((t) => t.status === "sent" && t.step === 2).map((t) => t.body.split("\n\n")[0])).toEqual(Array(5).fill(expect.stringMatching(SPRING_LINE)));
  });

  it("an OK the round's season has room for sends it as planned", () => {
    const { st } = round();
    expect(ownerApproves(st, "2026-11-11T08:00:00")).toEqual({ approved: 8, firstDay: "2026-11-11" });
  });

  it("an OK that leaves only part of the round inside the window writes the rest again for January, and counts them", () => {
    // two new people a day: planned on November 3rd, it runs to the 10th; OK'd on the 12th, all but the first day's run past the 15th
    const { st, planned } = round("2026-11-03", { weeklyNewContacts: 6 });
    const firsts = planned.filter((t) => t.step === 1);
    expect([...new Set(firsts.map((t) => t.dueAt.slice(0, 10)))].sort()).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-10"]);
    const r = ownerApproves(st, "2026-11-12T08:00:00");
    expect(r).toMatchObject({ firstDay: "2026-11-12", late: { people: firsts.length - 2, firstDay: "2027-01-05" } });
    // the first day's people go on the 12th, their follow-ups past the 15th don't; nobody hears from us after it in 2026
    const approved = st.touches.filter((t) => t.status === "approved");
    expect(approved.filter((t) => t.dueAt < "2027").map((t) => [t.step, t.dueAt.slice(0, 10)])).toEqual([[1, "2026-11-12"], [1, "2026-11-12"]]);
    expect(planned.filter((t) => t.status === "cancelled").map((t) => t.lastError)).toEqual(Array(planned.length - 2).fill(OFF_SEASON));
    expect(approved.filter((t) => t.dueAt > "2027").map((t) => t.season)).toEqual(Array(r.approved - 2).fill("2027-spring"));
    expect(st.events.at(-1)!.detail).toContain(`${firsts.length - 2} people's first notes would have gone after their season closed: the round was written again for the next one, from 2027-01-05.`);
  });

  it("notes OK'd in time that sat out the window (a pause) never go in December, the clean-ups a rescan dropped included", () => {
    const { st, planned } = round();
    ownerApproves(st, "2026-11-10T12:30:00");
    rescan(st, "2026-12-01");
    expect(st.scan!.opportunities.filter((o) => o.serviceId === "lawn.cleanup")).toEqual([]);
    const { due, held } = dueTouches(st, "2026-12-01T09:59");
    expect(due).toEqual([]);
    expect(held.map((h) => h.why)).toEqual(Array(planned.length).fill(OFF_SEASON));
  });

  it("a pause from November to January never sends the fall follow-ups in the spring window", () => {
    const { st, who } = round("2026-11-03");
    ownerApproves(st, "2026-11-03T06:00:00");
    for (const { touch } of dueTouches(st, "2026-11-03T09:59").due) markSent(st, touch.id, "2026-11-03T09:00:00");
    const regulars = who("stoppedJuly2026", "stoppedAfter2025");
    const fallSeconds = st.touches.filter((t) => t.step === 2 && regulars.includes(t.customerId));
    expect(fallSeconds.map((t) => [t.status, t.body.split("\n\n")[0]])).toEqual(Array(5).fill(["approved", expect.stringMatching(FALL_LINE)]));
    // back on January 5th: the spring window is open, but those were written for the fall
    expect(lines(st, "2027-01-05T09:59")).toEqual([]);
    const held = dueTouches(st, "2027-01-05T09:59").held;
    expect(fallSeconds.map((t) => held.find((h) => h.touch === t)?.why)).toEqual(Array(5).fill(OFF_SEASON));
  });

  it("a spring round paused until September never sends its spring line in the fall window", () => {
    const { st, planned } = round("2027-03-23");
    ownerApproves(st, "2027-03-23T06:00:00");
    expect(planned.filter((t) => t.step === 2).map((t) => t.body)).toContainEqual(expect.stringMatching(SPRING_LINE));
    const { due, held } = dueTouches(st, "2027-09-01T09:59");
    expect(due).toEqual([]);
    expect(held.map((h) => h.why)).toEqual(Array(planned.length).fill(OFF_SEASON));
  });
});

/** `who`'s visits of `title` each week from `from` to `to`, marked recurring. */
const weekly = (title: string, from: ISODate, to: ISODate, who = "c1") => {
  const jobs = [];
  for (let d = from, i = 0; d <= to; d = addDays(d, 7), i++) jobs.push(job(`${who}-${from}-${i}`, who, { title, recurring: true, total: 45, completedOn: d }));
  return jobs;
};
/** The shop's jobs done by `asOf`, scanned then. */
const shop = (trade: "lawn" | "landscape", jobs: ReturnType<typeof job>[], asOf: ISODate) =>
  scan(dataset({ asOf, business: { trade, name: "Greenline", avgJobValue: undefined }, customers: [...new Set(jobs.map((j) => j.customerId))].map((id) => customer(id)), jobs: jobs.filter((j) => j.completedOn! <= asOf) }));

describe("a shop's season ends where its own mowing does", () => {
  const SHOPS: [string, Partial<BusinessProfile>, [string, string]][] = [
    ["a New Hampshire shop that stops mowing October 5th", {}, ["04-20", "10-05"]],
    ["a Minnesota shop that stops October 2nd", { state: "MN", mailingAddress: "220 Superior St, Duluth, MN 55802" }, ["04-27", "10-02"]],
    ["a Georgia shop that stops November 1st", { state: "GA", mailingAddress: "88 Peachtree St, Atlanta, GA 30303" }, ["02-15", "11-01"]],
  ];

  it.each(SHOPS)("%s: after it and all winter, it flags no active customer and finds every lapsed regular", (_, over, mows) => {
    for (const asOf of ["2026-11-02", ...SEASON_SCANS]) flagsOnlyTheLapsed(shopOn(asOf, over, mows), asOf);
  }, 60_000);

  const REGULARS = ["r1", "r2", "r3", "r4", "r5"];
  /** Five weekly regulars, all new in 2026, done April 20th to October 5th; and one who stopped in July. */
  const season = (title: string) => [...REGULARS.flatMap((who) => weekly(title, "2026-04-20", "2026-10-05", who)), ...weekly(title, "2026-04-20", "2026-07-13", "q1")];

  it.each([
    ["lawn", "Weekly mowing", "Lawn mowing", "2026-10-29", "lawn.mow"],
    ["lawn", "Weekly mowing", "Final mow & leaf cleanup", "2026-10-29", "lawn.mow"],
    ["landscape", "Bed maintenance & weeding", "Mulch beds", "2026-10-27", "land.mulch"],
    ["landscape", "Bed maintenance & weeding", "Fall mulch refresh", "2026-10-27", "land.mulch"],
  ] as const)("a %s shop's “%s” stopped October 5th: a one-off “%s” for someone else on %s doesn't make its regulars lapsed all winter", (trade, routine, oneOff, on, serviceId) => {
    const jobs = [...season(routine), job("late", "c9", { title: oneOff, total: 60, completedOn: on })];
    for (const asOf of ["2026-11-10", "2027-01-15", "2027-03-01"]) {
      const r = shop(trade, jobs, asOf);
      expect(REGULARS.flatMap((x) => oppsFor(r, x)), asOf).toEqual([]);
      expect(oppsFor(r, "q1").map((o) => [o.type, o.serviceId]), asOf).toEqual([["lapsed_regular", serviceId]]);
    }
  });

  it("one regular mowed to the end of October doesn't carry the season on for the five who stopped October 5th", () => {
    const jobs = [...season("Weekly mowing"), ...weekly("Weekly mowing", "2026-04-23", "2026-10-29", "c9")];
    for (const asOf of ["2026-11-10", "2027-01-15", "2027-03-01"]) {
      const r = shop("lawn", jobs, asOf);
      expect([...REGULARS, "c9"].flatMap((x) => oppsFor(r, x)), asOf).toEqual([]);
      expect(oppsFor(r, "q1").map((o) => o.type), asOf).toEqual(["lapsed_regular"]);
    }
  });

  it("a Minnesota shop that sends only invoices, stopping October 2nd: after it and all winter, it flags no active regular", () => {
    /** `who`'s mowing billed each week from `from` to `to`, and paid. */
    const billed = (who: string, from: ISODate, to: ISODate) => {
      const out = [];
      for (let d = from; d <= to; d = addDays(d, 7)) out.push(invoice(`${who}-${d}`, who, { subject: "Weekly mowing", total: 45, balance: 0, status: "paid", rawStatus: "Paid", issuedOn: d, dueOn: d, paidOn: d }));
      return out;
    };
    // six weekly regulars, all new in 2026, billed Monday to Saturday from late April to October 2nd and again from late
    // April 2027; and one who stopped in July
    const regulars = ["r1", "r2", "r3", "r4", "r5", "r6"];
    const invoices = [...regulars.flatMap((who, i) => [...billed(who, addDays("2026-04-27", i), "2026-10-02"), ...billed(who, addDays("2027-04-26", i), "2027-10-01")]), ...billed("q1", "2026-04-27", "2026-07-13")];
    const business = { trade: "lawn" as const, name: "Greenline", state: "MN", mailingAddress: "220 Superior St, Duluth, MN 55802", avgJobValue: undefined };
    for (const asOf of ["2026-11-02", ...SEASON_SCANS]) {
      const r = scan(dataset({ asOf, business, customers: [...regulars, "q1"].map((id) => customer(id)), invoices: invoices.filter((i) => i.issuedOn! <= asOf) }));
      expect(regulars.flatMap((x) => oppsFor(r, x)), asOf).toEqual([]);
      expect(oppsFor(r, "q1").map((o) => [o.type, o.serviceId]), asOf).toEqual([["lapsed_regular", "lawn.mow"]]);
    }
  });
});

describe("a regular on an Active job, in a Visits report that ends on the scan day", () => {
  // September 1st: the shop's regulars are on Active recurring jobs (the jobs report), and the Visits report runs up
  // to today, so it has nobody's next visit. Tom was away for August (his visits taken off) and is back on the 7th.
  const asOf: ISODate = "2026-09-01";
  const clients = seasonalClients(asOf).map((c) => ({ ...c, visits: c.visits.filter((v) => v.date <= asOf && !(c.name === "Tom Alvarez" && v.date >= "2026-08-10")) }));
  const tom = clients.find((c) => c.name === "Tom Alvarez")!;
  const on = clients.filter((c) => !c.lapsed && c.visits.some((v) => v.recurring && v.date >= "2026-01-01"));
  const JOBS = [
    "Job #,Client name,Client email,Title,Job status,Job type,Created date,Start date,Completed date,Total ($)",
    ...on.map((c) => `${c.visits.find((v) => v.recurring && v.date >= "2026-01-01")!.job},${c.name},${c.email},Weekly mowing,Active,Recurring,03/20/2026,04/20/2026,,0`),
  ].join("\n");
  const read = (withJobs: boolean) => {
    const visits = ingestFile(emptyDataset(lawn(), asOf), visitsReport(clients, "newest"), "Visits Report.csv", `${asOf}T12:00:00Z`).dataset;
    return withJobs ? ingestFile(visits, JOBS, "Jobs Report.csv", `${asOf}T12:00:00Z`).dataset : visits;
  };
  const idOf = (ds: Dataset) => ds.customers.find((x) => x.emails.includes(tom.email))!.id;

  it("is left alone: his job says he's on the schedule, though no visit of it is still to come in the file", () => {
    expect(tom.story).toBe("regular");
    // the Visits report alone has him three missed visits gone
    const alone = read(false);
    expect(oneOpp(scan(alone), idOf(alone), "lapsed_regular").suppressed).toBeUndefined();
    const ds = read(true);
    expect(oneOpp(scan(ds), idOf(ds), "lapsed_regular").suppressed).toBe("active_work");
    const st = emptyState(ds, `${asOf}T12:00:00`);
    find(st, `${asOf}T12:00:00`);
    planBatch(st, "2026-09-02T12:00:00", { startOn: "2026-09-02" });
    expect(st.touches.filter((t) => t.customerId === idOf(ds))).toEqual([]);
  }, 60_000);
});

describe("a regular's routine is what he's had all season", () => {
  it("a mowing regular who quit in July and had a fall clean-up since is gone in the fall and spring windows", () => {
    const jobs = [...weekly("Weekly mowing", "2026-04-20", "2026-07-13"), job("leaf", "c1", { title: "Fall leaf cleanup", total: 180, completedOn: "2026-10-20" })];
    for (const asOf of ["2026-11-10", "2027-01-15", "2027-03-01"]) expect(oneOpp(shop("lawn", jobs, asOf), "c1", "lapsed_regular").serviceId, asOf).toBe("lawn.mow");
  });

  it("a regular won back after he quit one May, who quits again in July, is gone in the fall and spring windows; one who stops in August every year isn't", () => {
    const mowing = (who: string, ...seasons: [ISODate, ISODate][]) => seasons.flatMap(([from, to]) => weekly("Weekly mowing", from, to, who));
    const jobs = [
      ...mowing("c1", ["2025-04-20", "2025-05-12"], ["2026-04-20", "2026-07-13"]),
      ...mowing("c2", ["2024-06-01", "2024-08-24"], ["2025-06-01", "2025-08-24"], ["2026-06-01", "2026-08-24"]),
      // the shop's other regular mows to the end of October
      ...mowing("c3", ["2025-04-20", "2025-10-26"], ["2026-04-20", "2026-10-25"]),
    ];
    for (const asOf of ["2026-09-15", "2026-10-15", "2027-01-15", "2027-03-01"]) {
      const r = shop("lawn", jobs, asOf);
      expect(oneOpp(r, "c1", "lapsed_regular").serviceId, asOf).toBe("lawn.mow");
      expect([...oppsFor(r, "c2"), ...oppsFor(r, "c3")], asOf).toEqual([]);
    }
  });

  it("a landscaper's weekly bed care is a seasonal routine: stopped in July, he's a lapsed regular, never mulch coming due", () => {
    const jobs = weekly("Bed maintenance & weeding", "2026-04-20", "2026-07-13");
    for (const asOf of ["2026-09-15", "2026-10-15", "2027-01-15", "2027-06-15"]) {
      const r = shop("landscape", jobs, asOf);
      expect(oppsFor(r, "c1").map((o) => [o.type, o.serviceId]), asOf).toEqual([["lapsed_regular", "land.mulch"]]);
    }
    // one who kept it up to the end of the season is between seasons
    expect(oppsFor(shop("landscape", weekly("Bed maintenance & weeding", "2026-04-20", "2026-10-26"), "2027-01-15"), "c1")).toEqual([]);
  });

  it("a landscaper's mowing is mowing", () => {
    expect(oneOpp(shop("landscape", weekly("Mow, edge & trim", "2026-04-20", "2026-07-13"), "2026-10-15"), "c1", "lapsed_regular").serviceId).toBe("lawn.mow");
  });
});

describe("one-off seasonal work: due in its season, waiting outside it", () => {
  const mulch = (asOf: ISODate) =>
    scan(dataset({ asOf, business: { trade: "landscape", name: "Greenline Landscaping", avgJobValue: undefined }, customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Mulch beds", total: 400, completedOn: "2026-05-10" })] }));

  it("mulch done last May is due next spring, waits through the summer and comes due again in the fall; never a one-and-done in between", () => {
    for (const asOf of ["2026-10-15", "2027-01-15", "2027-08-01"]) expect(oppsFor(mulch(asOf), "c1"), asOf).toEqual([]);
    for (const asOf of ["2027-05-01", "2027-09-15"]) expect(oneOpp(mulch(asOf), "c1", "service_due").serviceId, asOf).toBe("land.mulch");
  });

  it("a lawn shop's mulch and a landscaper's clean-ups and aeration are the same seasonal work", () => {
    const once = (trade: "lawn" | "landscape", title: string, on: ISODate, asOf: ISODate) =>
      oppsFor(scan(dataset({ asOf, business: { trade, name: "Greenline", avgJobValue: undefined }, customers: [customer("c1")], jobs: [job("j1", "c1", { title, total: 300, completedOn: on })] })), "c1").map((o) => [o.type, o.serviceId]);
    expect(once("landscape", "Fall cleanup", "2025-10-21", "2026-10-15")).toEqual([["service_due", "lawn.cleanup"]]);
    expect(once("landscape", "Fall cleanup", "2025-10-21", "2027-01-15")).toEqual([]);
    expect(once("landscape", "Core aeration & overseed", "2025-09-16", "2026-10-15")).toEqual([["service_due", "lawn.aerate"]]);
    expect(once("lawn", "Mulch beds", "2026-05-10", "2027-05-01")).toEqual([["service_due", "land.mulch"]]);
  });

  it("their notes go in the work's season, never in December", () => {
    const lawnShop = lawn();
    const cleanup = { type: "service_due" as const, serviceId: "lawn.cleanup" };
    expect(["2026-10-15", "2026-11-12", "2026-11-25", "2026-12-08", "2027-01-12", "2027-03-16", "2027-06-15"].map((d) => goesOutOn(lawnShop, cleanup, d))).toEqual([true, true, false, false, false, true, false]);
    // further south, fall clean-up sells to the end of November
    expect(goesOutOn(lawn({ state: "PA" }), cleanup, "2026-11-25")).toBe(true);
    // a lawn shop's past customers hear from it in the selling windows only
    expect(["2026-08-18", "2026-10-15", "2026-11-17", "2026-12-08", "2027-02-09"].map((d) => goesOutOn(lawnShop, { type: "lapsed_regular", serviceId: "lawn.mow" }, d))).toEqual([false, true, false, false, true]);
  });
});

describe("year-round work keeps its own clock", () => {
  const cleaningShop = business({ trade: "cleaning", name: "Tidewell Home Cleaning", avgJobValue: 180 });

  it("a cleaning regular is gone at three weeks in January, and written to in December", () => {
    for (const asOf of ["2026-12-08", "2027-01-15"]) {
      const jobs = Array.from({ length: 8 }, (_, i) => job(`j${i}`, "c1", { title: "Bi-weekly cleaning", recurring: true, total: 180, completedOn: ago(21 + (7 - i) * 14, asOf) }));
      const ds: Dataset = { ...dataset({ customers: [customer("c1")], jobs }), business: cleaningShop, asOf };
      const r = scan(ds);
      const o = oneOpp(r, "c1", "lapsed_regular");
      // a year of visits every other week, and the close-out note, not a lawn window's line
      expect(o.value).toBe(26 * 180);
      const plan = planOutreach(ds, r, { startOn: asOf });
      expect(plan.people).toEqual(["c1"]);
      expect(renderNote(o, ds.customers[0]!, { ds, sendOn: asOf }, 2)!.templateId).toBe("g3");
    }
    expect(["2026-07-14", "2026-12-08"].map((d) => goesOutOn(cleaningShop, { type: "lapsed_regular", serviceId: "clean.recurring" }, d))).toEqual([true, true]);
  });
});

describe("the sample generator sees winter", () => {
  const MOW = "Mowing visit";

  it("a lawn sample mows only in the growing season; a cleaning sample cleans all year", () => {
    const lawnJobs = generateSample({ trade: "lawn", asOf: "2027-01-15" }).dataset.jobs.filter((j) => j.title === MOW);
    expect(lawnJobs.length).toBeGreaterThan(500);
    for (const j of lawnJobs) expect(j.completedOn!.slice(5) >= NH.opens && j.completedOn!.slice(5) <= NH.closes, j.completedOn).toBe(true);
    const months = new Set(generateSample({ trade: "cleaning", asOf: "2027-01-15" }).dataset.jobs.filter((j) => j.recurring).map((j) => j.completedOn?.slice(5, 7)));
    expect(months.has("12") && months.has("01") && months.has("07")).toBe(true);
  }, 60_000);

  it("scanned on January 15th, it flags none of the regulars who mowed to the end of the season, and plans nothing to them", () => {
    const { dataset: ds } = generateSample({ trade: "lawn", asOf: "2027-01-15" });
    const lastOf = (only?: string) => {
      const m = new Map<string, ISODate>();
      for (const j of ds.jobs) if ((!only || j.title === only) && j.completedOn && j.completedOn > (m.get(j.customerId) ?? "")) m.set(j.customerId, j.completedOn);
      return m;
    };
    const lastMow = lastOf(MOW);
    const lastWork = lastOf();
    const active = [...lastMow].filter(([, d]) => d >= "2026-10-15").map(([id]) => id);
    expect(active.length).toBeGreaterThan(20);
    const r = scan(ds);
    const pastCustomer = new Set<BreakageType>(["lapsed_regular", "one_and_done", "service_due", "missed_upsell"]);
    expect(r.opportunities.filter((o) => active.includes(o.customerId) && pastCustomer.has(o.type))).toEqual([]);
    // the regulars who stopped mid-season, and had no work of any kind since, are found
    const stopped = [...lastMow].filter(([id, d]) => d >= "2026-05-01" && d < "2026-09-15" && lastWork.get(id) === d).map(([id]) => id);
    expect(stopped.length).toBeGreaterThan(0);
    for (const x of stopped) expect(oppsFor(r, x, "lapsed_regular")).toHaveLength(1);
    const plan = planOutreach(ds, r, { startOn: "2027-01-19" });
    expect(plan.people.length).toBeGreaterThan(0);
    expect(plan.people.filter((x) => active.includes(x))).toEqual([]);
    expect(plan.firstDay).toBe("2027-01-19");
  }, 60_000);
});

describe("a regular with no visits of his own to say when his season starts", () => {
  const SHOPS: [string, string][] = [
    ["PA", "5 Market St, Harrisburg, PA 17101"],
    ["OH", "200 High St, Columbus, OH 43215"],
    ["GA", "88 Peachtree St, Atlanta, GA 30303"],
    ["TX", "300 Congress Ave, Austin, TX 78701"],
  ];
  /** The shop's file as exported on `asOf`, read and scanned: who it flags, by email. */
  const flagged = (csv: string, name: string, state: string, mailingAddress: string, asOf: ISODate) => {
    const ds = ingestFile(emptyDataset(lawn({ state, mailingAddress }), asOf), csv, name, `${asOf}T12:00:00Z`).dataset;
    const email = new Map(ds.customers.map((c) => [c.id, c.emails[0]!]));
    return scan(ds).opportunities.map((o) => [email.get(o.customerId), o.type]);
  };
  // weekly regulars mowed to the last week of October, and one who stopped in July
  const LIST = `Client name,Email,Last Visit,Frequency
Mike Sanderson,mike@gmail.com,2026-10-22,Weekly
Linda Whitfield,linda@gmail.com,2026-10-26,Weekly
Tom Alvarez,tom@gmail.com,2026-10-29,Every other week
Karen Brennan,karen@gmail.com,2026-07-10,Weekly
`;
  const RECURRING = `Job #,Job title,Client name,Client email,Client phone number,Service street,Billing type,Visits assigned to,Line items,Total ($),Completed visits,Number of invoices,Schedule start date,Schedule end date
610,Weekly mowing,Mike Sanderson,mike@gmail.com,717-224-1100,12 Oak Ln,Per visit,Crew 1,Mow,4200,70,70,04/08/2024,10/29/2026
611,Weekly mowing,Linda Whitfield,linda@gmail.com,717-224-1101,15 Pine St,Per visit,Crew 1,Mow,2900,50,50,04/07/2025,10/26/2026
`;

  it.each(SHOPS)("in %s, a client list's regulars mowed to late October aren't gone in March or early April, before a shop may have started; by June they are", (state, address) => {
    for (const asOf of ["2027-03-01", "2027-03-29", "2027-03-30", "2027-04-10"]) expect(flagged(LIST, "Clients.csv", state, address, asOf), `${state} ${asOf}`).toEqual([["karen@gmail.com", "lapsed_regular"]]);
    expect(flagged(LIST, "Clients.csv", state, address, "2027-06-01").sort()).toEqual([
      ["karen@gmail.com", "lapsed_regular"],
      ["linda@gmail.com", "lapsed_regular"],
      ["mike@gmail.com", "lapsed_regular"],
      ["tom@gmail.com", "lapsed_regular"],
    ]);
  });

  it("in Pennsylvania, a Recurring Jobs report's jobs that ran to late October aren't gone in March or early April", () => {
    const [state, address] = SHOPS[0]!;
    for (const asOf of ["2027-03-29", "2027-04-10"]) expect(flagged(RECURRING, "Recurring Jobs Report.csv", state, address, asOf), asOf).toEqual([]);
    expect(flagged(RECURRING, "Recurring Jobs Report.csv", state, address, "2027-06-01")).toHaveLength(2);
  });
});

describe("a lawn shop that bills by the month, with no jobs file", () => {
  const MONTH = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const first = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;
  /**
   * `who`'s bill for each month he was mowed, April to October 2025 and April to `lastMonth` 2026: dated the month's
   * last day, or billed in arrears on the 1st after it.
   */
  const bills = (who: string, lastMonth: number, when: "end" | "arrears") =>
    [2025, 2026].flatMap((y) =>
      [4, 5, 6, 7, 8, 9, 10]
        .filter((m) => y === 2025 || m <= lastMonth)
        .map((m) => {
          const on = when === "end" ? addDays(first(y, m + 1), -1) : first(y, m + 1);
          return invoice(`${who}-${y}-${m}`, who, { subject: `Lawn maintenance - ${MONTH[m]}`, total: 180, balance: 0, status: "paid", rawStatus: "Paid", issuedOn: on, dueOn: on, paidOn: on });
        }),
    );
  const REGULARS = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"];
  /** Eight regulars billed to the season's end, and three who quit after June, July and August 2026. */
  const shopOn = (when: "end" | "arrears", asOf: ISODate) => {
    const invoices = [...REGULARS.flatMap((who) => bills(who, 10, when)), ...bills("june", 6, when), ...bills("july", 7, when), ...bills("august", 8, when)];
    return scan(dataset({ asOf, business: { trade: "lawn", name: "Greenline", avgJobValue: undefined }, customers: [...REGULARS, "june", "july", "august"].map((id) => customer(id)), invoices: invoices.filter((i) => i.issuedOn! <= asOf) }));
  };

  it.each(["end", "arrears"] as const)("billed at the month's %s: whoever quit after June, July or August is found in the fall and spring windows, and no regular", (when) => {
    for (const asOf of ["2026-11-10", "2027-01-15", "2027-03-01"]) {
      const r = shopOn(when, asOf);
      expect(REGULARS.flatMap((x) => oppsFor(r, x)), asOf).toEqual([]);
      expect(["june", "july", "august"].map((x) => reachable(r, x, "lapsed_regular").length), asOf).toEqual([1, 1, 1]);
    }
    expect(REGULARS.flatMap((x) => oppsFor(shopOn(when, "2026-10-15"), x))).toEqual([]);
  });
});

describe("between exports, the season is read only as far as the records reach", () => {
  /** The shop's Visits report as exported on `exported`, scanned again each night to `asOf` with nothing newer. */
  const later = (exported: ISODate, asOf: ISODate) => {
    const shop = shopOn(exported);
    return { ...shop, r: scan({ ...shop.ds, asOf }) };
  };

  it("a September export rescanned every night through the fall and winter flags no active regular, and still finds who stopped", () => {
    for (const asOf of ["2026-09-25", "2026-09-29", "2026-10-07", "2026-10-15", "2026-11-10", "2027-01-15", "2027-03-01"]) {
      const { r, who } = later("2026-09-08", asOf);
      const active = new Set(who(...ACTIVE("2026-09-08")));
      expect(r.opportunities.filter((o) => active.has(o.customerId)).map((o) => o.type), asOf).toEqual([]);
      expect(who("stoppedJuly2026", "stoppedAfter2025").map((x) => reachable(r, x, "lapsed_regular").length), asOf).toEqual([1, 1, 1, 1, 1]);
    }
  }, 60_000);

  it("the launch export, never sent again, doesn't make every regular gone the next September", () => {
    const { r, who } = later("2026-10-08", "2027-09-01");
    const active = new Set(who(...ACTIVE("2026-10-08")));
    expect(r.opportunities.filter((o) => active.has(o.customerId)).map((o) => o.type)).toEqual([]);
    expect(who("stoppedJuly2026").map((x) => reachable(r, x, "lapsed_regular").length)).toEqual([1, 1, 1]);
  });
});

describe("a regular who quit late in the season with his job left open", () => {
  const HEAD = "Job #,Date,Visit title,Client name,Client email,Visit completed,Visit based ($),Job type";
  /** Weekly visits from `from` to `to`, marked done through `doneTo`. */
  const rows = (job: number, name: string, from: ISODate, to: ISODate, doneTo: ISODate) => {
    const out: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 7)) out.push(`${job},${d},Weekly mowing,${name},${name.split(" ")[0]!.toLowerCase()}@gmail.com,${d <= doneTo ? "Yes" : "No"},45.00,Recurring`);
    return out;
  };
  const NAMES = ["Linda Whitfield", "Tom Alvarez", "Karen Brennan", "Steve Coutu", "Donna Duval", "Paul Ellis", "Janet Fortin", "Gary Gagnon", "Ruth Hale", "Brian Irwin", "Carol Jacques", "Kevin Kimball"];
  // exported October 8th, at launch: twelve regulars on the calendar to the end of October; Mike quit after September 7th,
  // and his job was never closed (its visits since read "No", and the rest of October is still on the calendar)
  const EXPORT = [
    HEAD,
    ...NAMES.flatMap((name, i) => rows(800 + i, name, addDays("2026-04-20", i % 5), "2026-10-29", "2026-10-07")),
    ...rows(900, "Mike Sanderson", "2026-04-20", "2026-10-26", "2026-09-07"),
  ].join("\n");

  it("is found once his calendar's dates have passed, in the fall window and the spring one; no regular is", () => {
    const ds = ingestFile(emptyDataset(lawn(), "2026-10-08"), EXPORT, "Visits Report.csv", "2026-10-08T12:00:00Z").dataset;
    const mike = ds.customers.find((c) => c.emails.includes("mike@gmail.com"))!.id;
    // on the day: his October visits are on the calendar, so he's left alone
    expect(reachable(scan(ds), mike, "lapsed_regular")).toEqual([]);
    for (const asOf of ["2026-10-29", "2026-11-10", "2027-01-15", "2027-03-01"]) {
      const r = scan({ ...ds, asOf });
      expect(reachable(r, mike, "lapsed_regular").map((o) => o.anchorDate), asOf).toEqual(["2026-09-07"]);
      expect(r.opportunities.filter((o) => o.customerId !== mike), asOf).toEqual([]);
    }
  });
});

describe("a lawn shop's winter work", () => {
  /** `who`'s snow plowing through each winter in `winters`, a push every week or two from December to March. */
  const plowed = (who: string, winters: number[]) =>
    winters.flatMap((y) =>
      [`${y}-12-08`, `${y}-12-19`, `${y + 1}-01-05`, `${y + 1}-01-14`, `${y + 1}-01-27`, `${y + 1}-02-09`, `${y + 1}-02-20`, `${y + 1}-03-06`].map((d, i) =>
        job(`${who}-${y}-${i}`, who, { title: "Snow plowing", recurring: true, total: 65, completedOn: d }),
      ),
    );

  it.each(["lawn", "landscape"] as const)("a %s shop's plow customers, plowed every winter, aren't lapsed mowing regulars", (trade) => {
    const jobs = [
      ...["r1", "r2", "r3"].flatMap((who) => [...weekly("Weekly mowing", "2025-04-21", "2025-10-27", who), ...weekly("Weekly mowing", "2026-04-20", "2026-10-26", who)]),
      ...plowed("p1", [2024, 2025, 2026]),
      ...plowed("p2", [2025, 2026]),
      // one who had a spring clean-up too: it comes due in its season, but he's no mowing regular gone
      ...plowed("p3", [2025, 2026]),
      job("p3-cleanup", "p3", { title: "Spring cleanup", total: 160, completedOn: "2026-04-14" }),
    ];
    for (const asOf of ["2026-10-15", "2026-11-10", "2027-01-15", "2027-03-01", "2027-06-15"]) {
      const r = shop(trade, jobs, asOf);
      expect([...oppsFor(r, "p1"), ...oppsFor(r, "p2"), ...oppsFor(r, "p3", "lapsed_regular")].map((o) => [o.type, o.reason]), asOf).toEqual([]);
    }
  });
});

describe("the free 150 for a shop that starts late in a selling window", () => {
  const SPRING_LINE = /we're setting the spring routes now/;
  /** A New Hampshire lawn shop on its free round: 220 weekly regulars who all stopped in July, Monday to Friday, 75 new people a week. */
  const trial = (asOf: ISODate) => {
    const ids = Array.from({ length: 220 }, (_, i) => `c${i}`);
    const ds = dataset({
      asOf,
      business: { trade: "lawn", name: "Greenline Lawn Care", avgJobValue: undefined, sendDays: [1, 2, 3, 4, 5] },
      customers: ids.map((id) => customer(id)),
      jobs: ids.flatMap((id) => weekly("Weekly mowing", "2026-04-20", "2026-07-13", id)),
    });
    const st = emptyState(ds, `${asOf}T07:00:00`);
    planBatch(st, `${asOf}T07:00:00`, { startOn: asOf, limitPeople: 150 });
    return st;
  };
  const firstDays = (st: ReturnType<typeof trial>) => st.touches.filter((t) => t.step === 1 && t.status !== "cancelled").map((t) => t.dueAt.slice(0, 10)).sort();
  /** Everything approved and due by `day` goes out on its day. */
  const sendThrough = (st: ReturnType<typeof trial>, day: ISODate) => {
    for (const t of st.touches) if (t.status === "approved" && t.dueAt.slice(0, 10) <= day) markSent(st, t.id, t.dueAt);
  };

  it("planned November 9th, the round is the whole 150: the rest start in January, written for spring, and the trial isn't closed after the fall's", () => {
    const st = trial("2026-11-09");
    const days = firstDays(st);
    expect(days).toHaveLength(150);
    expect(days.filter((d) => d < "2027")).toEqual(Array(75).fill(expect.stringMatching(/^2026-11-(09|1[0-3])$/)));
    expect(days.filter((d) => d > "2027")[0]).toBe("2027-01-01");
    expect(st.touches.filter((t) => t.dueAt.slice(0, 10) > "2026-11-15" && t.dueAt < "2027")).toEqual([]);
    const spring = st.touches.filter((t) => t.dueAt > "2027");
    expect(spring.map((t) => t.season)).toEqual(spring.map(() => "2027-spring"));
    expect(spring.filter((t) => t.step === 2).map((t) => t.body.split("\n\n")[0])).toEqual(Array(75).fill(expect.stringMatching(SPRING_LINE)));
    // the welcome text says the whole 150, and when the last of them go
    expect(st.ownerMessages.find((m) => m.kind === "kickoff")!.text).toContain("then the rest of your 150 over the next few weeks (the last 75 from Friday, January 1)");
    expect(ownerApproves(st, "2026-11-09T06:00:00")).toMatchObject({ firstDay: "2026-11-09" });
    sendThrough(st, "2026-11-15");
    expect(closeIfDue(st, "2026-11-20T09:00:00")).toBeUndefined();
    expect(st.trialCompletedOn).toBeUndefined();
    sendThrough(st, "2027-01-31");
    expect(closeIfDue(st, "2027-02-01T09:00:00")!.text).toMatch(/From \d+ notes to 150 people[\s\S]*the next batch goes out next week\./);
  });

  it.each([
    ["planned March 22nd, late in the spring window", "2027-03-22", "2027-03-31", 120],
    ["signed up in summer, when no window is open", "2027-06-15", "2027-06-15", 0],
  ])("%s, the round is the whole 150, the rest from September 1st, and the trial isn't closed before they've gone", (_, day, windowEnds, inWindow) => {
    const st = trial(day);
    const days = firstDays(st);
    expect(days).toHaveLength(150);
    expect(days.filter((d) => d <= windowEnds)).toHaveLength(inWindow);
    expect(days.filter((d) => d > windowEnds)[0]).toBe("2027-09-01");
    const fall = st.touches.filter((t) => t.dueAt > "2027-09");
    expect(fall.map((t) => t.season)).toEqual(fall.map(() => "2027-fall"));
    ownerApproves(st, `${day}T06:00:00`);
    sendThrough(st, windowEnds);
    expect(closeIfDue(st, "2027-04-07T09:00:00")).toBeUndefined();
    expect(closeIfDue(st, "2027-07-07T09:00:00")).toBeUndefined();
  });

  it("a round a pause cut short at the window's close goes on in the next one: the trial isn't closed, asking for $497, after a third of it", () => {
    const st = trial("2026-11-02");
    expect(firstDays(st).every((d) => d <= "2026-11-13")).toBe(true);
    ownerApproves(st, "2026-11-02T06:00:00");
    sendThrough(st, "2026-11-04");
    // paused on the 4th, back December 1st: the rest are held past their season, and the Sender cancels them for good
    for (const { touch, why } of dueTouches(st, "2026-12-01T09:59").held) {
      expect(why).toBe(OFF_SEASON);
      touch.status = "cancelled";
      touch.lastError = why;
    }
    const went = new Set(st.touches.filter((t) => t.status === "sent").map((t) => t.customerId));
    expect(went.size).toBe(45);
    expect(closeIfDue(st, "2026-12-08T09:00:00")).toBeUndefined();
    const rest = st.touches.filter((t) => t.step === 1 && t.status === "approved");
    expect(rest).toHaveLength(105);
    expect(rest.every((t) => t.dueAt > "2027-01" && !went.has(t.customerId))).toBe(true);
  });

  it("a round done by mid-November closes with the date its next batch can go: never “next week” in December", () => {
    const st = trial("2026-10-26");
    expect(firstDays(st)).toHaveLength(150);
    ownerApproves(st, "2026-10-26T06:00:00");
    sendThrough(st, "2026-11-15");
    const close = closeIfDue(st, "2026-11-20T09:00:00")!.text;
    expect(close).toContain("Say yes by Friday 27 and the next batch goes out Friday, January 1.");
  });
});
