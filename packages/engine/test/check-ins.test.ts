import { describe, expect, it } from "vitest";
import { billableBookings } from "../src/ledger/billable.ts";
import { chargePaid, chargeRefunded, decideFound, foundWaiting, settleCharges, type BillingOpts } from "../src/runtime/charges.ts";
import { checkIn, CHECK_IN_DAYS, endPass, exportAskIfDue, markContacted, QUESTION_OPEN_DAYS, reconcile, relabelReply } from "../src/runtime/agents.ts";
import { emptyState, type AccountState, type OwnerMessage } from "../src/runtime/state.ts";
import { exportAskText, leadCode } from "../src/reports/owner.ts";
import { onePassPlan } from "../src/plans.ts";
import type { Opportunity, Reply, Touch } from "../src/model.ts";
import { MONTHLY_REFILL } from "../src/breakage/refill.ts";
import { addDays, weekday } from "../src/util.ts";
import { customer, dataset } from "./fixtures.ts";

/** BRIEF B6: "Did it book?" two days after a hand-off and again at 14, and the fresh export at a one pass's end. */

const NAMES = ["Karen Whitfield", "Mike Sanderson", "Ann Lee", "Bob Ray"];

/** A shop whose owner has had no hand-off yet. */
function shop(): AccountState {
  const customers = NAMES.map((name, i) => customer(`c${i}`, { name }));
  return emptyState(dataset({ customers }), "2026-09-29T08:00:00");
}

/** `cid` said yes and was texted to the owner at `at` (local time). */
function handedOff(st: AccountState, cid: string, at: string): Reply {
  const r: Reply = { id: `r-${cid}`, customerId: cid, channel: "email", receivedAt: at, handedOffAt: at, from: `${cid}@gmail.com`, text: "Yes please", intent: "wants_it", confidence: 0.95, extracted: {}, status: "handed_off" };
  st.replies.push(r);
  return r;
}

/**
 * The worker's daily run at 9:30 each morning from `from` through `to`: the check-in texts, by day. `paused` and
 * `yesNoOut` say on which days the client is paused, and a question a bare yes or no answers is out to the owner.
 */
function mornings(st: AccountState, from: string, to: string, opts: { paused?: (day: string) => boolean; yesNoOut?: (day: string) => boolean } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const m = checkIn(st, `${day}T09:30:00`, { paused: opts.paused?.(day), yesNoOut: opts.yesNoOut?.(day) });
    if (m) out[day] = m.text;
  }
  return out;
}

const line = (name: string, cid: string) => `Did ${name} book? Reply BOOKED $amount #${leadCode(`r-${cid}`)}, or NO #${leadCode(`r-${cid}`)}.`;

describe("did it book? (BRIEF B6)", () => {
  it("a hand-off nobody answers is asked about on day 2 and again on day 14, and never again", () => {
    const st = shop();
    // a Tuesday
    handedOff(st, "c0", "2026-09-29T10:00:00");
    expect(mornings(st, "2026-09-29", "2026-12-31")).toEqual({ "2026-10-01": line("Karen Whitfield", "c0"), "2026-10-13": line("Karen Whitfield", "c0") });
    expect(st.replies[0]!.checkIns).toBe(CHECK_IN_DAYS.length);
    // the brief's words, with the lead's code from the hand-off
    expect(line("Karen Whitfield", "c0")).toMatch(/^Did Karen Whitfield book\? Reply BOOKED \$amount #\w{3}, or NO #\w{3}\.$/);
    expect(st.ownerMessages.map((m) => [m.kind, m.refs])).toEqual([
      ["check_in", [{ kind: "reply", id: "r-c0" }]],
      ["check_in", [{ kind: "reply", id: "r-c0" }]],
    ]);
  });

  it.each([
    ["BOOKED", "booked" as const],
    ["NO", "lost" as const],
  ])("%s before day 2 stops both; after the first, it stops the one on day 14", (_, outcome) => {
    const early = shop();
    handedOff(early, "c0", "2026-09-29T10:00:00");
    markContacted(early, "r-c0", "2026-09-30T16:00:00", outcome, outcome === "booked" ? 2400 : undefined);
    expect(mornings(early, "2026-09-29", "2026-12-31")).toEqual({});
    const late = shop();
    handedOff(late, "c0", "2026-09-29T10:00:00");
    expect(Object.keys(mornings(late, "2026-09-29", "2026-10-05"))).toEqual(["2026-10-01"]);
    markContacted(late, "r-c0", "2026-10-06T16:00:00", outcome, outcome === "booked" ? 2400 : undefined);
    expect(mornings(late, "2026-10-06", "2026-12-31")).toEqual({});
  });

  it.each([
    ["QUOTED", "quoted" as const],
    ["NO ANSWER", "no_answer" as const],
    ["DONE", undefined],
  ])("%s doesn't say whether it booked: both still go, until BOOKED or NO", (_, outcome) => {
    // he reached her the day she was handed over (DONE, as the hand-off and the nudge ask), or quoted her, or didn't
    // get through
    const st = shop();
    handedOff(st, "c0", "2026-09-29T10:00:00");
    markContacted(st, "r-c0", "2026-09-29T16:00:00", outcome);
    expect(mornings(st, "2026-09-29", "2026-12-31")).toEqual({ "2026-10-01": line("Karen Whitfield", "c0"), "2026-10-13": line("Karen Whitfield", "c0") });
    // QUOTED on day 3, and she books on day 10: the day-14 check-in is how we hear, unless he says first
    const told = shop();
    handedOff(told, "c0", "2026-09-29T10:00:00");
    expect(Object.keys(mornings(told, "2026-09-29", "2026-09-30"))).toEqual([]);
    markContacted(told, "r-c0", "2026-09-30T16:00:00", outcome);
    expect(Object.keys(mornings(told, "2026-10-01", "2026-10-05"))).toEqual(["2026-10-01"]);
    markContacted(told, "r-c0", "2026-10-08T16:00:00", "booked", 2400);
    expect(mornings(told, "2026-10-06", "2026-12-31")).toEqual({});
    // or NO after the first
    const lost = shop();
    handedOff(lost, "c0", "2026-09-29T10:00:00");
    markContacted(lost, "r-c0", "2026-09-30T16:00:00", outcome);
    expect(Object.keys(mornings(lost, "2026-09-29", "2026-10-01"))).toEqual(["2026-10-01"]);
    markContacted(lost, "r-c0", "2026-10-02T16:00:00", "lost");
    expect(mornings(lost, "2026-10-02", "2026-12-31")).toEqual({});
  });

  it("one who writes again after his call and is handed over anew is asked about on the new lead's days, not both", () => {
    const st = shop();
    handedOff(st, "c0", "2026-09-29T10:00:00");
    markContacted(st, "r-c0", "2026-09-29T16:00:00");
    expect(Object.keys(mornings(st, "2026-09-29", "2026-10-02"))).toEqual(["2026-10-01"]);
    // Friday she asks for a date: a lead of its own, with its own code
    st.replies.push({ ...handedOff(shop(), "c0", "2026-10-02T11:00:00"), id: "r-c0-2" });
    expect(mornings(st, "2026-10-03", "2026-12-31")).toEqual({ "2026-10-05": line("Karen Whitfield", "c0-2"), "2026-10-16": line("Karen Whitfield", "c0-2") });
  });

  it("a customer with no name on file is asked about by the address they wrote from", () => {
    const st = shop();
    // a spreadsheet row with only an email
    reconcile(st, [{ name: "clients.csv", text: "Client name,Client email,Last job date\n,pat@gmail.com,2025-06-01\n" }], "2026-09-29T08:00:00");
    const pat = st.dataset.customers.find((c) => c.emails.includes("pat@gmail.com"))!;
    expect(pat.name).toBe("");
    Object.assign(handedOff(st, pat.id, "2026-09-29T10:00:00"), { from: "pat@gmail.com" });
    const code = leadCode(`r-${pat.id}`);
    expect(mornings(st, "2026-09-29", "2026-10-01")).toEqual({ "2026-10-01": `Did pat@gmail.com book? Reply BOOKED $amount #${code}, or NO #${code}.` });
    expect(st.events.at(-1)?.title).toBe("Asked you whether pat@gmail.com booked");
  });

  it("two leads due the same day share one text, a line and a code each; one due on a weekend goes on the Monday", () => {
    const st = shop();
    handedOff(st, "c0", "2026-09-29T10:00:00");
    handedOff(st, "c1", "2026-09-29T15:30:00");
    // Thursday's and Friday's are due Saturday and Sunday: both Monday
    handedOff(st, "c2", "2026-10-01T11:00:00");
    handedOff(st, "c3", "2026-10-02T09:00:00");
    const texts = mornings(st, "2026-09-29", "2026-10-31");
    expect(texts).toEqual({
      "2026-10-01": [line("Karen Whitfield", "c0"), line("Mike Sanderson", "c1")].join("\n"),
      "2026-10-05": [line("Ann Lee", "c2"), line("Bob Ray", "c3")].join("\n"),
      "2026-10-13": [line("Karen Whitfield", "c0"), line("Mike Sanderson", "c1")].join("\n"),
      // their 14th days are weekdays: each on its own
      "2026-10-15": line("Ann Lee", "c2"),
      "2026-10-16": line("Bob Ray", "c3"),
    });
    for (const day of Object.keys(texts)) expect([0, 6]).not.toContain(weekday(day));
    expect(new Set(st.ownerMessages.map((m) => m.id)).size).toBe(5);
  });

  it("goes once: run again the same day, or after a restart that loaded none of the texts, nothing more goes", () => {
    const st = shop();
    handedOff(st, "c0", "2026-09-29T10:00:00");
    expect(checkIn(st, "2026-10-01T09:30:00")).toBeDefined();
    expect(checkIn(st, "2026-10-01T09:31:00")).toBeUndefined();
    st.ownerMessages = [];
    expect(mornings(st, "2026-10-01", "2026-10-12")).toEqual({});
    expect(Object.keys(mornings(st, "2026-10-13", "2026-12-31"))).toEqual(["2026-10-13"]);
  });

  it("not once their records show it booked, or the owner's charge for it; never about someone who said stop or was taken off the list", () => {
    const booked = shop();
    handedOff(booked, "c0", "2026-09-29T10:00:00");
    booked.recoveries.push({ id: "rec", customerId: "c0", record: { kind: "job", id: "j1" }, value: 2400, cameBackOn: "2026-09-30", match: "customer_id", confidence: 0.9, tier: "traced" });
    expect(mornings(booked, "2026-09-29", "2026-12-31")).toEqual({});
    // an older job of theirs isn't this booking
    booked.recoveries[0]!.cameBackOn = "2026-07-01";
    expect(Object.keys(mornings(booked, "2026-10-13", "2026-10-13"))).toEqual(["2026-10-13"]);

    const charged = shop();
    handedOff(charged, "c0", "2026-09-29T10:00:00");
    charged.dataset.business.plan = onePassPlan({ startedOn: "2026-09-21", charges: [{ id: "chg", customerId: "c0", code: leadCode("r-c0"), amount: 25000, status: "skipped", via: "link", at: "2026-09-30T10:00:00" }] });
    expect(mornings(charged, "2026-09-29", "2026-12-31")).toEqual({});

    for (const why of ["unsubscribed", "complained"] as const) {
      const stopped = shop();
      handedOff(stopped, "c0", "2026-09-29T10:00:00");
      stopped.suppressions["c0@gmail.com"] = why;
      expect(mornings(stopped, "2026-09-29", "2026-12-31")).toEqual({});
    }
    const skipped = shop();
    handedOff(skipped, "c0", "2026-09-29T10:00:00");
    skipped.dataset.customers[0] = { ...skipped.dataset.customers[0]!, doNotContact: true };
    expect(mornings(skipped, "2026-09-29", "2026-12-31")).toEqual({});
    // a person read the yes again and marked it something else: it's no lead
    const relabelled = shop();
    handedOff(relabelled, "c0", "2026-09-29T10:00:00");
    relabelReply(relabelled, "r-c0", "not_interested", "2026-09-29T12:00:00");
    expect(mornings(relabelled, "2026-09-29", "2026-12-31")).toEqual({});
  });

  it("nothing to a paused or cancelled client or an owner who texted STOP; one held up goes within a week of its day, never later", () => {
    for (const set of [(st: AccountState) => (st.dataset.business.plan.stage = "paused"), (st: AccountState) => (st.dataset.business.plan.stage = "cancelled"), (st: AccountState) => (st.dataset.business.ownerTextsOff = { at: "2026-09-29T12:00:00", by: "owner" })]) {
      const st = shop();
      handedOff(st, "c0", "2026-09-29T10:00:00");
      set(st);
      expect(mornings(st, "2026-09-29", "2026-12-31")).toEqual({});
    }
    // paused (PAUSE by text) through Monday: Thursday's goes Tuesday
    const resumed = shop();
    handedOff(resumed, "c0", "2026-09-29T10:00:00");
    expect(Object.keys(mornings(resumed, "2026-09-29", "2026-12-31", { paused: (day) => day <= "2026-10-05" }))).toEqual(["2026-10-06", "2026-10-13"]);
    // paused past a week from its day: that one never goes, the next does
    const long = shop();
    handedOff(long, "c0", "2026-09-29T10:00:00");
    expect(Object.keys(mornings(long, "2026-09-29", "2026-12-31", { paused: (day) => day <= "2026-10-08" }))).toEqual(["2026-10-13"]);
    expect(long.replies[0]!.checkIns).toBe(2);
    // and the one on day 14 isn't sent a week and more late either
    const later = shop();
    handedOff(later, "c0", "2026-09-29T10:00:00");
    expect(mornings(later, "2026-09-29", "2026-12-31", { paused: (day) => day <= "2026-10-21" })).toEqual({});
  });

  it("none while a question a yes or no answers is out; one that came due meanwhile goes the first weekday it isn't, however late", () => {
    // the close, written the day after the hand-off, is out its full three weeks (through Wednesday, Oct 21): day 2's
    // and day 14's came due meanwhile, and the latest goes on the Thursday, a week and more past its day
    const close = shop();
    handedOff(close, "c0", "2026-09-29T10:00:00");
    expect(mornings(close, "2026-09-29", "2026-12-31", { yesNoOut: (day) => day >= "2026-09-30" && day <= "2026-10-21" })).toEqual({ "2026-10-22": line("Karen Whitfield", "c0") });
    expect(close.replies[0]).toMatchObject({ checkIns: 2, checkInHeldOn: "2026-10-21" });
    // out until the Friday after day 2 (eight days on): it goes then, and day 14's on its day
    const answered = shop();
    handedOff(answered, "c0", "2026-09-29T10:00:00");
    expect(Object.keys(mornings(answered, "2026-09-29", "2026-12-31", { yesNoOut: (day) => day <= "2026-10-08" }))).toEqual(["2026-10-09", "2026-10-13"]);
    // ending on a Friday, it goes on the Monday
    const weekend = shop();
    handedOff(weekend, "c0", "2026-09-29T10:00:00");
    expect(Object.keys(mornings(weekend, "2026-09-29", "2026-12-31", { yesNoOut: (day) => day <= "2026-10-23" }))).toEqual(["2026-10-26"]);
    // only while nobody knows: his BOOKED meanwhile ends it
    const booked = shop();
    handedOff(booked, "c0", "2026-09-29T10:00:00");
    const out = (day: string) => day <= "2026-10-21";
    expect(mornings(booked, "2026-09-29", "2026-10-15", { yesNoOut: out })).toEqual({});
    markContacted(booked, "r-c0", "2026-10-15T16:00:00", "booked", 2400);
    expect(mornings(booked, "2026-10-16", "2026-12-31", { yesNoOut: out })).toEqual({});
    // one whose week was up before the question went out stays gone
    const old = shop();
    handedOff(old, "c0", "2026-09-01T10:00:00");
    expect(mornings(old, "2026-09-29", "2026-12-31", { yesNoOut: (day) => day <= "2026-10-21" })).toEqual({});
    expect(old.replies[0]!.checkInHeldOn).toBeUndefined();
    // a pause after it still drops one past its week: the question held day 2's on its day only, then PAUSE till the 9th
    const paused = shop();
    handedOff(paused, "c0", "2026-09-29T10:00:00");
    expect(Object.keys(mornings(paused, "2026-09-29", "2026-12-31", { yesNoOut: (day) => day <= "2026-10-01", paused: (day) => day >= "2026-10-02" && day <= "2026-10-09" }))).toEqual(["2026-10-13"]);
  });
});

/* ------------------------------------------------------------------ */

const START = "2026-10-05";
const STRIPE: BillingOpts = { stripe: true, payLink: (id) => `https://qa.test/pay/${id}` };

/** A tree shop's one pass that wrote to four people on Oct 5. */
function pass(): AccountState {
  const st = shop();
  const b = st.dataset.business;
  b.plan = onePassPlan({ startedOn: START, targetEndOn: addDays(START, 30) });
  st.dataset.customers = st.dataset.customers.map((c, i) => ({ ...c, firstName: c.name.split(" ")[0]!, emails: [`c${i}@gmail.com`] }));
  st.touches = st.dataset.customers.map((c): Touch => ({ id: `t-${c.id}`, opportunityId: `o-${c.id}`, customerId: c.id, channel: "email", step: 1, angle: "check_in", dueAt: `${START}T08:00`, sentAt: `${START}T08:00:00`, status: "sent", body: "", flags: [] }));
  st.outreach = st.dataset.customers.map((c) => ({ customerId: c.id, opportunityId: `o-${c.id}`, firstTouchOn: START, lastTouchOn: START }));
  return st;
}

/** `cid` wrote back yes to the pass's note on Oct 8, and was handed to the owner. */
function wrote(st: AccountState, cid: string): Reply {
  const r = handedOff(st, cid, "2026-10-08T10:00:00");
  r.touchId = `t-${cid}`;
  return r;
}

/** Jobber's Quotes report: each customer's quote, approved on its day. */
const quotesReport = (rows: [cid: string, approved: string][]) => ({
  name: "Quotes Report.csv",
  text: `Quote #,Client name,Client email,Title,Status,Sent date,Approved date,Total ($)\n${rows.map(([cid, approved], i) => `${900 + i},${NAMES[Number(cid.slice(1))]},${cid}@gmail.com,Oak removal,Approved,2026-09-01,${approved},2400`).join("\n")}\n`,
});

/** Jobber's Visits report: each customer's visit, done on its day. */
const visitsReport = (rows: [cid: string, on: string][]) => ({
  name: "Visits Report.csv",
  text: `Job #,Date,Visit title,Client name,Client email,Visit completed,Visit based ($),Job type\n${rows.map(([cid, on], i) => `${700 + i},${on},Oak removal,${NAMES[Number(cid.slice(1))]},${cid}@gmail.com,Yes,2400.00,One-off`).join("\n")}\n`,
});

/** Their export: each customer's job, made on its day. */
const jobs = (rows: [cid: string, made: string][]) => ({
  name: "jobs.csv",
  text: `Job #,Client name,Client email,Title,Job status,Created date,Total\n${rows.map(([cid, made], i) => `${500 + i},${NAMES[Number(cid.slice(1))]},${cid}@gmail.com,Oak removal,Scheduled,${made},2400`).join("\n")}\n`,
});

const kinds = (ms: OwnerMessage[]) => ms.map((m) => m.kind);

/** Past customers who stopped coming over the last year, one a day: enough for the end text to offer monthly. */
const lapsed = (n: number, asOf: string): Opportunity[] =>
  Array.from({ length: n }, (_, i) => ({ id: `op-p${i}`, type: "lapsed_regular", customerId: `p${i}`, source: { kind: "job", id: `j-p${i}` }, value: 500, expectedValue: 100, recoverProbability: 0.2, score: 50, ageDays: 100, anchorDate: addDays(asOf, -(i % 360)), reason: "", evidence: [], jobPhrase: "the job", serviceId: "tree.removal", seasonFit: "now", channels: ["email"] }));
const chargeOf = (st: AccountState, cid: string) => st.dataset.business.plan.charges?.find((c) => c.customerId === cid);

describe("the end of a one pass: a fresh export, and Jack's word on what it shows (BRIEF B6)", () => {
  it("asks the owner for a fresh export once, after the end text, waiting for Jack like it; not when nobody answered the notes", () => {
    const st = pass();
    wrote(st, "c0");
    endPass(st, "2026-11-05T09:30:00");
    expect(kinds(st.ownerMessages)).toEqual(["pass_end", "export_ask"]);
    expect(st.ownerMessages[1]!.text).toBe(exportAskText(st.dataset.business));
    expect(st.ownerMessages[1]!.text).toBe("Dave, one last thing: can you send me a fresh export of your jobs and quotes, the way you sent the first one? I'll check it against everyone who wrote back.");
    expect(st.ownerMessages[1]!.text).not.toMatch(/\$|free|money-back|risk-free|guarantee/i);
    expect(st.dataset.business.plan.endExport).toEqual({ askedAt: "2026-11-05T09:30:00" });
    // done again (back to running, then done), it isn't asked again
    st.dataset.business.plan.stage = "running";
    endPass(st, "2026-11-09T09:30:00");
    expect(kinds(st.ownerMessages)).toEqual(["pass_end", "export_ask"]);
    // nobody wrote back, or only to say stop: nothing an export could bill
    const quiet = pass();
    quiet.replies.push({ ...wrote(quiet, "c1"), id: "r-stop", intent: "stop", status: "done" });
    quiet.replies = quiet.replies.filter((r) => r.id === "r-stop");
    endPass(quiet, "2026-11-05T09:30:00");
    expect(kinds(quiet.ownerMessages)).toEqual(["pass_end"]);
    expect(quiet.dataset.business.plan.endExport).toBeUndefined();
    expect(exportAskIfDue(quiet, "2026-11-06T09:30:00")).toBeUndefined();
    // until a late yes comes in: then it's asked
    wrote(quiet, "c2");
    expect(exportAskIfDue(quiet, "2026-11-09T09:30:00")?.kind).toBe("export_ask");
  });

  it("when the end text offers to keep going monthly, the ask waits until that offer has closed: his yes to one never reads as a yes to the other", () => {
    const st = pass();
    wrote(st, "c0");
    st.scan = { opportunities: lapsed(12 * MONTHLY_REFILL, "2026-11-05"), primary: [], stats: { customers: 0, quotes: 0, jobs: 0, invoices: 0, requests: 0, suppressedBy: {} } };
    expect(endPass(st, "2026-11-05T09:30:00")!.refs).toEqual([{ kind: "monthly_offer", id: "2026-11-05" }]);
    expect(kinds(st.ownerMessages)).toEqual(["pass_end"]);
    // the worker looks each day: nothing while a yes or a no answers the offer
    const closes = addDays("2026-11-05", QUESTION_OPEN_DAYS);
    for (let day = "2026-11-05"; day <= closes; day = addDays(day, 1)) expect(exportAskIfDue(st, `${day}T09:30:00`)).toBeUndefined();
    expect(st.dataset.business.plan.endExport).toBeUndefined();
    expect(exportAskIfDue(st, `${addDays(closes, 1)}T09:30:00`)?.text).toBe(exportAskText(st.dataset.business));
    expect(st.dataset.business.plan.endExport).toEqual({ askedAt: "2026-11-27T09:30:00" });
    expect(st.events.at(-1)?.title).toBe("The ask for a fresh export waits for your OK");
    expect(exportAskIfDue(st, "2026-11-30T09:30:00")).toBeUndefined();
    expect(kinds(st.ownerMessages)).toEqual(["pass_end", "export_ask"]);
    // gone monthly meanwhile (Jack set it up after his yes): no pass end to ask at
    const monthly = pass();
    wrote(monthly, "c0");
    monthly.scan = st.scan;
    endPass(monthly, "2026-11-05T09:30:00");
    monthly.dataset.business.plan = { ...monthly.dataset.business.plan, kind: "monthly", stage: "trial" };
    expect(exportAskIfDue(monthly, "2026-11-30T09:30:00")).toBeUndefined();
  });

  it("the import after it is matched against everyone who wrote back: its new billable bookings wait for Jack, a booking texted before it doesn't", () => {
    const st = pass();
    for (const cid of ["c0", "c1", "c2"]) wrote(st, cid);
    // Mike's booking came by text during the pass: B4's path, charged already
    markContacted(st, "r-c1", "2026-10-20T16:00:00", "booked", 2400);
    settleCharges(st, "2026-10-20T16:05:00", STRIPE);
    expect(chargeOf(st, "c1")!.status).toBe("heads_up");
    endPass(st, "2026-11-05T09:30:00");
    // Karen's and Ann's jobs are in the export, and Bob's (who never wrote back)
    reconcile(st, [jobs([["c0", "2026-11-03"], ["c2", "2026-10-28"], ["c3", "2026-10-30"]])], "2026-11-09T10:00:00");
    const exp = st.dataset.business.plan.endExport!;
    expect(exp.readAt).toBe("2026-11-09T10:00:00");
    expect(exp.found!.map((f) => [f.customerId, f.on, f.code])).toEqual([
      ["c2", "2026-10-28", leadCode("r-c2")],
      ["c0", "2026-11-03", leadCode("r-c0")],
    ]);
    // Bob never wrote back: his job is on the ledger as after a note, never billed or listed
    expect(st.recoveries.find((r) => r.customerId === "c3")?.tier).toBe("after_note");
    // no money text for either until Jack says
    settleCharges(st, "2026-11-09T10:05:00", STRIPE);
    expect(chargeOf(st, "c0")).toBeUndefined();
    expect(chargeOf(st, "c2")).toBeUndefined();
    expect(kinds(st.ownerMessages).filter((k) => k.startsWith("charge_"))).toEqual(["charge_link"]);
    expect(st.events.find((e) => e.title.startsWith("The fresh export shows"))).toMatchObject({ kind: "review", title: "The fresh export shows 2 bookings from the pass: confirm before any charge", detail: expect.stringContaining("Ann Lee, Karen Whitfield") });
  });

  it("confirmed, it takes B4's path; not, it never bills, whatever comes in later", () => {
    const st = pass();
    for (const cid of ["c0", "c2"]) wrote(st, cid);
    endPass(st, "2026-11-05T09:30:00");
    reconcile(st, [jobs([["c0", "2026-11-03"], ["c2", "2026-10-28"]])], "2026-11-09T10:00:00");
    expect(decideFound(st, "c2", true, "2026-11-09T11:00:00")).toMatchObject({ confirmed: true, decidedAt: "2026-11-09T11:00:00" });
    expect(decideFound(st, "c0", false, "2026-11-09T11:01:00")).toMatchObject({ confirmed: false });
    // decided once
    expect(decideFound(st, "c0", true, "2026-11-09T11:02:00")).toBeUndefined();
    expect(foundWaiting(st.dataset.business.plan, "c2")).toBeUndefined();
    settleCharges(st, "2026-11-09T11:05:00", STRIPE);
    expect(chargeOf(st, "c2")).toMatchObject({ status: "heads_up", code: leadCode("r-c2"), bookedOn: "2026-10-28" });
    expect(st.ownerMessages.filter((m) => m.kind === "charge_link").map((m) => m.text)).toEqual([expect.stringMatching(/^Ann Lee booked \(#\w{3}\)\. That's your first \$250\./)]);
    expect(chargeOf(st, "c0")).toMatchObject({ status: "skipped", reason: "Not confirmed from the export at the pass's end", code: leadCode("r-c0") });
    // the owner texts BOOKED for her later, and another export shows her job again: still nothing
    markContacted(st, "r-c0", "2026-11-12T16:00:00", "booked", 2400);
    reconcile(st, [jobs([["c0", "2026-11-03"], ["c2", "2026-10-28"]])], "2026-11-20T10:00:00");
    settleCharges(st, "2026-11-20T10:05:00", STRIPE);
    expect(chargeOf(st, "c0")!.status).toBe("skipped");
    expect(billableBookings(st).billable.map((x) => x.customerId)).toEqual(["c2"]);
  });

  it.each([
    ["the Quotes report, then the Visits report", ["quotes", "visits"] as const],
    ["the Visits report, then the Quotes report", ["visits", "quotes"] as const],
  ])("every import after the ask waits for Jack: %s, as two emails; a booking by text goes B4's way", (_, order) => {
    const st = pass();
    for (const cid of ["c0", "c1", "c2", "c3"]) wrote(st, cid);
    endPass(st, "2026-11-05T09:30:00");
    // Karen's quote approved, Ann's visit done; a client list in between brings nothing
    const files = { quotes: quotesReport([["c0", "2026-10-20"]]), visits: visitsReport([["c2", "2026-10-28"]]) };
    reconcile(st, [files[order[0]]], "2026-11-09T10:00:00");
    reconcile(st, [{ name: "clients.csv", text: `Client name,Client email\n${NAMES[3]},c3@gmail.com\n` }], "2026-11-09T10:10:00");
    reconcile(st, [files[order[1]]], "2026-11-09T10:20:00");
    // Mike's job, in an export weeks on, waits too; Bob's booking by text doesn't
    reconcile(st, [jobs([["c1", "2026-11-10"]])], "2026-11-30T10:00:00");
    markContacted(st, "r-c3", "2026-11-30T16:00:00", "booked", 1800);
    settleCharges(st, "2026-11-30T16:05:00", { stripe: false });
    const exp = st.dataset.business.plan.endExport!;
    expect(exp.readAt).toBe("2026-11-09T10:00:00");
    expect(Object.fromEntries(exp.found!.map((f) => [f.customerId, [f.on, f.at]]))).toEqual({
      c0: ["2026-10-20", order[0] === "quotes" ? "2026-11-09T10:00:00" : "2026-11-09T10:20:00"],
      c2: ["2026-10-28", order[0] === "visits" ? "2026-11-09T10:00:00" : "2026-11-09T10:20:00"],
      c1: ["2026-11-10", "2026-11-30T10:00:00"],
    });
    for (const cid of ["c0", "c1", "c2"]) {
      expect(chargeOf(st, cid)).toBeUndefined();
      expect(foundWaiting(st.dataset.business.plan, cid)).toBeDefined();
    }
    expect(chargeOf(st, "c3")!.status).toBe("heads_up");
    expect(billableBookings(st).billable.map((x) => x.customerId).sort()).toEqual(["c0", "c1", "c2", "c3"]);
    // Jack hears of each file that brought one; the client list, after the first file, says nothing
    expect(st.events.filter((e) => e.title.startsWith("The fresh export")).map((e) => e.title)).toEqual(Array(3).fill("The fresh export shows a booking from the pass: confirm before any charge"));
  });

  it("one it brought past the cap waits too: a refund that frees a place still leaves it to Jack", () => {
    const st = pass();
    st.dataset.business.plan.capBookings = 1;
    for (const cid of ["c0", "c1"]) wrote(st, cid);
    markContacted(st, "r-c1", "2026-10-20T16:00:00", "booked", 2400);
    settleCharges(st, "2026-10-20T16:05:00", STRIPE);
    chargePaid(st, chargeOf(st, "c1")!.id, "2026-10-21T10:00:00", { by: "outside" });
    endPass(st, "2026-11-05T09:30:00");
    reconcile(st, [jobs([["c0", "2026-11-03"]])], "2026-11-09T10:00:00");
    expect(billableBookings(st).overCap.map((x) => x.customerId)).toEqual(["c0"]);
    expect(foundWaiting(st.dataset.business.plan, "c0")).toMatchObject({ customerId: "c0", on: "2026-11-03" });
    // Jack refunds Mike's $250: its place is free, and Karen's takes it only once he says
    chargeRefunded(st, chargeOf(st, "c1")!.id, "2026-11-10T10:00:00");
    expect(billableBookings(st).billable.map((x) => x.customerId)).toEqual(["c0"]);
    settleCharges(st, "2026-11-10T10:05:00", STRIPE);
    expect(chargeOf(st, "c0")).toBeUndefined();
    decideFound(st, "c0", true, "2026-11-10T11:00:00");
    settleCharges(st, "2026-11-10T11:05:00", STRIPE);
    expect(chargeOf(st, "c0")!.status).toBe("heads_up");
  });

  it("one past the cap by a BOOKED text before the import isn't the import's: once a refund frees a place, it bills B4's way", () => {
    const st = pass();
    st.dataset.business.plan.capBookings = 1;
    for (const cid of ["c0", "c1", "c2"]) wrote(st, cid);
    markContacted(st, "r-c1", "2026-10-20T16:00:00", "booked", 2400);
    settleCharges(st, "2026-10-20T16:05:00", STRIPE);
    chargePaid(st, chargeOf(st, "c1")!.id, "2026-10-21T10:00:00", { by: "outside" });
    // Karen's booking by text comes past the cap
    markContacted(st, "r-c0", "2026-10-22T16:00:00", "booked", 2400);
    settleCharges(st, "2026-10-22T16:05:00", STRIPE);
    expect(billableBookings(st).overCap.map((x) => x.customerId)).toEqual(["c0"]);
    endPass(st, "2026-11-05T09:30:00");
    // the export shows her job and Ann's: only Ann's is the export's to wait for Jack
    reconcile(st, [jobs([["c0", "2026-10-22"], ["c2", "2026-10-28"]])], "2026-11-09T10:00:00");
    expect(st.dataset.business.plan.endExport!.found!.map((f) => f.customerId)).toEqual(["c2"]);
    expect(foundWaiting(st.dataset.business.plan, "c0")).toBeUndefined();
    // Jack refunds Mike's $250: Karen's booking takes the place without him, as it would have before the ask
    chargeRefunded(st, chargeOf(st, "c1")!.id, "2026-11-10T10:00:00");
    settleCharges(st, "2026-11-10T10:05:00", STRIPE);
    expect(chargeOf(st, "c0")).toMatchObject({ status: "heads_up", code: leadCode("r-c0") });
    expect(chargeOf(st, "c2")).toBeUndefined();
  });

  it("an import with nothing new says so, and a pass that was never asked holds nothing", () => {
    const st = pass();
    wrote(st, "c0");
    endPass(st, "2026-11-05T09:30:00");
    reconcile(st, [jobs([["c3", "2026-11-03"]])], "2026-11-09T10:00:00");
    expect(st.dataset.business.plan.endExport).toMatchObject({ readAt: "2026-11-09T10:00:00", found: [] });
    expect(st.events.at(-1)?.title).toBe("The fresh export is in: nothing new booked from the pass");
    // a second file with nothing new from the pass needn't say so again
    reconcile(st, [jobs([["c3", "2026-11-03"]])], "2026-11-09T10:20:00");
    expect(st.events.filter((e) => e.title.startsWith("The fresh export"))).toHaveLength(1);
    const running = pass();
    wrote(running, "c0");
    reconcile(running, [jobs([["c0", "2026-11-03"]])], "2026-11-09T10:00:00");
    settleCharges(running, "2026-11-09T10:05:00", STRIPE);
    expect(chargeOf(running, "c0")!.status).toBe("heads_up");
  });
});
