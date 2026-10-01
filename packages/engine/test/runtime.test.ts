import { beforeAll, describe, expect, it } from "vitest";
import {
  answerNewRequests,
  approveAll,
  billingCheck,
  dropStaleAnswers,
  HELD_FOR_GOOD,
  renewalIfDue,
  renewPlan,
  closeIfDue,
  dueTouches,
  find,
  ledgerPass,
  markContacted,
  markSent,
  ownerApproves,
  planBatch,
  readFiles,
  receiveReply,
  reconcile,
  reportWeek,
  sendHealth,
  setBookedOut,
  type DueTouch,
} from "../src/runtime/agents.ts";
import { emptyState, type AccountState } from "../src/runtime/state.ts";
import { dropSettled } from "../src/runtime/settled.ts";
import { closeMessage, feesPaid, leadCode, lossReasons, offerYear } from "../src/reports/owner.ts";
import { quietRates } from "../src/breakage/quiet.ts";
import { summarize } from "../src/breakage/forecast.ts";
import { scan } from "../src/breakage/detect.ts";
import { emptyDataset, toCSV } from "../src/ingest/index.ts";
import { generateSample, type Sample } from "../src/sample/generate.ts";
import type { Plan } from "../src/cadence/plan.ts";
import type { Touch } from "../src/model.ts";
import { addDays, mondayOf, weekday } from "../src/util.ts";
import { ago, ASOF, customer, dataset, job, NEW_REQUESTS, quote, request } from "./fixtures.ts";

const NOW = `${ASOF}T12:00:00Z`;
const START = "2026-10-06"; // Tuesday; the sample sends Tue-Thu, 7-10am
const DAY1_SEND = `${START}T09:59`;

let sample: Sample;
let base: AccountState;
let plan: Plan;
let approved: number;

beforeAll(() => {
  sample = generateSample({ trade: "tree", asOf: ASOF });
  base = emptyState(emptyDataset(structuredClone(sample.business), ASOF), NOW);
  readFiles(base, sample.files, NOW);
  find(base, NOW);
  plan = planBatch(base, NOW, { startOn: START, limitPeople: 150 });
  approved = approveAll(base, NOW);
}, 30_000);

/** An independent copy of the account after the free round was planned and approved. */
const fresh = (): AccountState => structuredClone(base);

/** Send everything due at `at` (as the Sender would) and return what went. */
function sendDue(state: AccountState, at: string): DueTouch[] {
  const { due } = dueTouches(state, at);
  for (const d of due) markSent(state, d.touch.id, `${at}:00`, `msg-${d.touch.id}`);
  return due;
}

const touchesOf = (state: AccountState, customerId: string): Touch[] => state.touches.filter((t) => t.customerId === customerId).sort((a, b) => a.step - b.step);
const from = (d: DueTouch) => `${d.customerName} <${d.to}>`;

/* ------------------------------------------------------------------ */

describe("Reader and Finder", () => {
  it("reads every export into one clean customer list", () => {
    const ds = base.dataset;
    expect(ds.customers).toHaveLength(sample.dataset.customers.length);
    expect(ds.quotes).toHaveLength(sample.dataset.quotes.length);
    expect(ds.jobs).toHaveLength(sample.dataset.jobs.length);
    expect(ds.invoices).toHaveLength(sample.dataset.invoices.length);
    expect(ds.requests).toHaveLength(sample.dataset.requests.length);
    const read = base.events.filter((e) => e.agent === "reader" && e.kind === "action").map((e) => e.title);
    expect(read).toEqual(sample.files.map((f) => `Read ${f.name}`));
    expect(base.events.some((e) => e.agent === "reader" && /customers? in one clean list/.test(e.title))).toBe(true);
  });
  it("finds the breakage, summarizes it and says who it left alone", () => {
    expect(base.scan!.opportunities.length).toBeGreaterThan(500);
    expect(base.summary!.totalValue).toBeGreaterThan(base.summary!.reachableValue);
    expect(base.events.find((e) => e.agent === "finder" && e.kind === "win")!.title).toMatch(/^Found \$[\d,]+ left on the table$/);
    expect(base.events.some((e) => e.agent === "guard" && /alone on purpose/.test(e.title))).toBe(true);
  });
});

describe("Writer and Sender: the batch", () => {
  it("plans the free round for 150 people with no holdout, then approves it", () => {
    expect(plan.people).toHaveLength(150);
    expect(plan.holdout).toEqual([]);
    expect(base.outreach).toEqual([]);
    expect(approved).toBe(plan.touches.length);
    expect(base.touches).toHaveLength(plan.touches.length);
    expect(base.touches.every((t) => t.status === "approved")).toBe(true);
    expect(approveAll(fresh(), NOW)).toBe(0);
    expect(base.events.some((e) => e.agent === "writer" && e.title === `Wrote ${plan.touches.length} notes for 150 people`)).toBe(true);
  });
  it("a second batch never re-contacts anyone already planned", () => {
    const s = fresh();
    const next = planBatch(s, NOW, { startOn: "2026-11-03", limitPeople: 50 });
    expect(next.people).toHaveLength(50);
    const first = new Set(plan.people);
    expect(next.people.some((id) => first.has(id))).toBe(false);
    expect(s.touches.filter((t) => t.status === "planned")).toHaveLength(next.touches.length);
  });
  it("people planned again after their notes were cancelled get new note ids, never a second note with the same id", () => {
    const s = fresh();
    for (const t of s.touches) t.status = "cancelled";
    const again = planBatch(s, NOW, { startOn: "2026-11-03" });
    expect(again.people.length).toBeGreaterThan(0);
    expect(new Set(s.touches.map((t) => t.id)).size).toBe(s.touches.length);
    // the plan the caller gets back names the notes as they were saved
    const ids = new Set(s.touches.map((t) => t.id));
    expect(again.touches.every((t) => ids.has(t.id))).toBe(true);
  });
  it("someone taken off the list is never planned again, even from the scan made before", async () => {
    const { skipPerson } = await import("../src/runtime/agents.ts");
    const s = fresh();
    const who = s.touches[0]!.customerId;
    skipPerson(s, who, NOW, "The owner texted SKIP");
    expect(s.scan!.primary.some((o) => o.customerId === who)).toBe(false);
    s.scan = { ...s.scan!, primary: [...s.scan!.primary, ...s.scan!.opportunities.filter((o) => o.customerId === who)] };
    const again = planBatch(s, NOW, { startOn: "2026-11-03" });
    expect(again.people).not.toContain(who);
  });
  it("a top-up never doubles the weekly pace: what's already scheduled counts", () => {
    const s = fresh();
    s.dataset.business.plan.stage = "paying";
    planBatch(s, NOW, { startOn: START, limitPeople: 300 });
    planBatch(s, NOW, { startOn: START });
    const perWeek = new Map<string, number>();
    for (const t of s.touches.filter((x) => x.step === 1)) perWeek.set(mondayOf(t.dueAt.slice(0, 10)), (perWeek.get(mondayOf(t.dueAt.slice(0, 10))) ?? 0) + 1);
    expect(Math.max(...perWeek.values())).toBeLessThanOrEqual(s.dataset.business.weeklyNewContacts);
  });
  it("a paying account holds out a comparison group and records it", () => {
    const s = fresh();
    s.dataset.business.plan.stage = "paying";
    const p = planBatch(s, NOW, { startOn: "2026-11-03", limitPeople: 100 });
    expect(p.holdout.length).toBeGreaterThan(0);
    const held = s.outreach.filter((o) => o.holdout);
    expect(held.map((o) => o.customerId).sort()).toEqual([...p.holdout].sort());
    expect(p.touches.some((t) => p.holdout.includes(t.customerId))).toBe(false);
  });
});

describe("Guard: what goes out, and when", () => {
  const day1 = () => base.touches.filter((t) => t.dueAt.startsWith(START));

  it("nothing goes before its time", () => {
    expect(dueTouches(fresh(), `${START}T06:30`)).toEqual({ due: [], held: [] });
  });
  it("first notes go out inside the window on a send day, to a real address", () => {
    const { due, held } = dueTouches(fresh(), DAY1_SEND);
    expect(held).toEqual([]);
    expect(due.map((d) => d.touch.id).sort()).toEqual(day1().map((t) => t.id).sort());
    expect(due.every((d) => d.touch.step === 1)).toBe(true);
    for (const d of due) expect(base.dataset.customers.find((c) => c.id === d.touch.customerId)!.emails).toContain(d.to);
  });
  it("outside send hours they wait", () => {
    const { due, held } = dueTouches(fresh(), `${START}T10:30`);
    expect(due).toEqual([]);
    expect(held).toHaveLength(day1().length);
    expect(held.every((h) => h.why === "Outside send hours")).toBe(true);
  });
  it("not on a day the owner doesn't send", () => {
    const saturday = "2026-10-10";
    expect(weekday(saturday)).toBe(6);
    const { due, held } = dueTouches(fresh(), `${saturday}T09:00`);
    expect(due).toEqual([]);
    expect(held.length).toBeGreaterThan(day1().length);
    expect(held.every((h) => h.why === "Not a send day")).toBe(true);
  });
  it("someone who wrote back gets nothing more", () => {
    const s = fresh();
    const t = day1()[0]!;
    s.replies.push({ id: "r-x", customerId: t.customerId, channel: "email", receivedAt: `${START}T08:00:00`, from: "x", text: "call me", intent: "wants_it", confidence: 1, extracted: {}, status: "new" });
    const { due, held } = dueTouches(s, DAY1_SEND);
    expect(due.some((d) => d.touch.customerId === t.customerId)).toBe(false);
    expect(held.find((h) => h.touch.customerId === t.customerId)?.why).toBe("They replied — the sequence stops");
  });
  it("a suppressed address is never written to", () => {
    const s = fresh();
    const t = day1()[0]!;
    for (const e of s.dataset.customers.find((c) => c.id === t.customerId)!.emails) s.suppressions[e] = "bounced";
    const { due, held } = dueTouches(s, DAY1_SEND);
    expect(due.some((d) => d.touch.customerId === t.customerId)).toBe(false);
    expect(held.find((h) => h.touch.customerId === t.customerId)?.why).toMatch(/No sendable email/);
  });

  describe("sending health", () => {
    /** Mark `sent` touches sent and `bounced` more as bounced. */
    const history = (sent: number, bounced: number, complaints = 0) => {
      const s = fresh();
      const later = s.touches.filter((t) => !t.dueAt.startsWith(START));
      later.slice(0, sent).forEach((t) => (t.status = "sent"));
      later.slice(sent, sent + bounced).forEach((t) => (t.status = "bounced"));
      for (let i = 0; i < complaints; i++) s.replies.push({ id: `c${i}`, channel: "email", receivedAt: NOW, from: `angry${i}@gmail.com`, text: "spam", intent: "complaint", confidence: 1, extracted: {}, status: "done" });
      return s;
    };
    // Thresholds are tuned over time; these use numbers that are clearly bad or clearly fine.
    it("a high bounce rate pauses every send", () => {
      const s = history(60, 6); // ~9%
      const h = sendHealth(s);
      expect(h).toMatchObject({ sent: 66, bounces: 6, paused: true });
      const { due, held } = dueTouches(s, DAY1_SEND);
      expect(due).toEqual([]);
      expect(held.length).toBe(day1().length);
      expect(held.every((x) => x.why === h.reason && /^Bounce rate 9\.1%/.test(x.why))).toBe(true);
    });
    it("spam complaints pause every send", () => {
      const s = history(400, 0, 4); // 1%
      expect(sendHealth(s).paused).toBe(true);
      expect(sendHealth(s).reason).toMatch(/complain/i);
      expect(dueTouches(s, DAY1_SEND).due).toEqual([]);
    });
    it("healthy numbers, or too few sends to judge, don't pause", () => {
      expect(sendHealth(history(200, 0)).paused).toBe(false);
      expect(sendHealth(history(10, 3)).paused).toBe(false); // 23%, but only 13 sends
      expect(dueTouches(history(200, 0), DAY1_SEND).due.length).toBe(day1().length);
    });
  });
});

describe("Sender: marking sends", () => {
  it("records the send and opens one outreach record per person, from the opportunity's source", () => {
    const s = fresh();
    const sent = sendDue(s, DAY1_SEND);
    expect(sent.length).toBeGreaterThan(0);
    for (const d of sent) {
      const t = s.touches.find((x) => x.id === d.touch.id)!;
      expect(t).toMatchObject({ status: "sent", sentAt: `${DAY1_SEND}:00`, providerId: `msg-${t.id}` });
    }
    expect(s.outreach).toHaveLength(sent.length);
    for (const o of s.outreach) {
      const opp = s.scan!.opportunities.find((x) => x.id === o.opportunityId)!;
      expect(o).toMatchObject({ firstTouchOn: START, lastTouchOn: START, sourceId: opp.source.id });
      expect(o.holdout).toBeUndefined();
    }
  });
  it("a later note moves the last-touch date, not the first", () => {
    const s = fresh();
    const d = sendDue(s, DAY1_SEND)[0]!;
    const step2 = touchesOf(s, d.touch.customerId).find((t) => t.step === 2)!;
    const at = `${step2.dueAt.slice(0, 10)}T09:59`;
    expect(dueTouches(s, at).due.some((x) => x.touch.id === step2.id)).toBe(true);
    markSent(s, step2.id, `${at}:00`, "msg-2");
    const rec = s.outreach.filter((o) => o.customerId === d.touch.customerId);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ firstTouchOn: START, lastTouchOn: step2.dueAt.slice(0, 10) });
  });
});

describe("Inbox and Dispatcher", () => {
  let s: AccountState;
  let sent: DueTouch[];
  beforeAll(() => {
    s = fresh();
    sent = sendDue(s, DAY1_SEND);
  });
  const later = (d: DueTouch) => touchesOf(s, d.touch.customerId).filter((t) => t.step > 1);

  it("a yes goes to the owner by text, with a #code to book it back", () => {
    const a = sent[0]!;
    const r = receiveReply(s, { from: from(a), subject: `Re: ${a.touch.subject}`, text: "Yes please, we still want it done. Call me after 5.", receivedAt: `${START}T14:10:00` });
    expect(r).toMatchObject({ intent: "wants_it", status: "handed_off", handedOffAt: `${START}T14:10:00`, customerId: a.touch.customerId, touchId: a.touch.id, opportunityId: a.touch.opportunityId });
    const msg = s.ownerMessages.at(-1)!;
    expect(msg.kind).toBe("handoff");
    expect(msg.text).toContain(`#${leadCode(r.id)}`);
    expect(msg.text).toMatch(/Text back BOOKED \+ amount, DONE, or NO · #[A-Z0-9]{3}$/);
    expect(msg.text).toContain(a.customerName);
    expect(msg.text).toContain("They said: “Yes please, we still want it done. Call me after 5.”");
    expect(msg.text).toContain("(after 5)");
    // the rest of their sequence is cancelled: a person takes it from here
    expect(later(a).length).toBeGreaterThan(0);
    expect(later(a).every((t) => t.status === "cancelled")).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ agent: "dispatcher", kind: "win" });
  });
  it("a stop suppresses the address and cancels every remaining note", () => {
    const b = sent[1]!;
    const r = receiveReply(s, { from: from(b), text: "stop", receivedAt: `${START}T15:00:00` });
    expect(r).toMatchObject({ intent: "stop", status: "done" });
    expect(s.suppressions[b.to]).toBe("unsubscribed");
    expect(later(b).every((t) => t.status === "cancelled")).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ agent: "guard", kind: "action" });
    // and it sticks: the next scan marks them unsubscribed
    find(s, `${START}T16:00:00Z`);
    const mine = s.scan!.opportunities.filter((o) => o.customerId === b.touch.customerId);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((o) => o.suppressed === "unsubscribed")).toBe(true);
  });
  it("an out-of-office doesn't stop the sequence", () => {
    const c = sent[2]!;
    const r = receiveReply(s, { from: from(c), subject: `Automatic reply: ${c.touch.subject}`, text: "I am out of the office until October 20 with limited access to email.", receivedAt: `${START}T15:05:00` });
    expect(r).toMatchObject({ intent: "auto_reply", status: "done" });
    const next = later(c)[0]!;
    expect(next.status).toBe("approved");
    const { due, held } = dueTouches(s, `${next.dueAt.slice(0, 10)}T09:59`);
    expect(held.filter((h) => h.touch.customerId === c.touch.customerId)).toEqual([]);
    expect(due.some((d) => d.touch.id === next.id)).toBe(true);
  });
  it("a bounce from the mail system stops the notes to the dead address", () => {
    const d = sent[3]!;
    const r = receiveReply(s, {
      from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      subject: "Delivery Status Notification (Failure)",
      text: `Address not found. Your message wasn't delivered to ${d.to} because the address couldn't be found.`,
      receivedAt: `${START}T10:01:00`,
      inReplyTo: `msg-${d.touch.id}`,
    });
    expect(r.intent).toBe("bounce");
    expect(r.customerId).toBe(d.touch.customerId);
    expect(r.touchId).toBe(d.touch.id);
    expect(s.suppressions[d.to]).toBe("bounced");
    expect(s.suppressions["mailer-daemon@googlemail.com"]).toBeUndefined();
    expect(later(d).every((t) => t.status === "cancelled")).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ agent: "guard", title: `Bad address for ${d.customerName} — removed`, detail: d.to });
  });
  it("a bounce with no thread id is matched by the address it names", () => {
    const d = sent[6]!;
    const r = receiveReply(s, { from: "postmaster@mail.example.com", subject: "Undeliverable", text: `Delivery has failed to these recipients or groups: ${d.to}. The email address you entered couldn't be found.`, receivedAt: `${START}T10:02:00` });
    expect(r.intent).toBe("bounce");
    expect(r.customerId).toBe(d.touch.customerId);
    expect(s.suppressions[d.to]).toBe("bounced");
    expect(later(d).every((t) => t.status === "cancelled")).toBe(true);
  });
  it("a reply is matched to the exact note it answers when the provider id is known", () => {
    const e = sent[4]!;
    const r = receiveReply(s, { from: from(e), text: "Can you send me a new price?", receivedAt: `${START}T18:00:00`, inReplyTo: `msg-${e.touch.id}` });
    expect(r).toMatchObject({ intent: "wants_price", touchId: e.touch.id, status: "handed_off" });
  });
  it("a yes at 11pm is answered at 7am, and both the answer and the owner's text say the right day", () => {
    const g = sent[7]!;
    const r = receiveReply(s, { from: from(g), text: "Yes please, call me.", receivedAt: `${START}T23:10:00` });
    expect(r.intent).toBe("wants_it");
    // read at 7am Wednesday: "today"
    expect(r.ack!.text).toMatch(/give you a call today/);
    // the owner reads it Tuesday night: Wednesday is "tomorrow", and nothing has gone yet
    const msg = s.ownerMessages.at(-1)!.text;
    expect(msg).toContain("At 7am we'll write back that you'll call them tomorrow.");
    expect(msg).not.toContain("We already wrote back");
  });
  it("a spouse answering our note from their own address is still that customer's reply", () => {
    const f = sent[5]!;
    const r = receiveReply(s, { from: "Pat's husband <someone.else@example.net>", text: "Yes, we still want it done. Call me.", receivedAt: `${START}T18:05:00`, inReplyTo: `msg-${f.touch.id}` });
    expect(r).toMatchObject({ intent: "wants_it", customerId: f.touch.customerId, touchId: f.touch.id, from: "someone.else@example.net", status: "handed_off" });
    expect(later(f).every((t) => t.status === "cancelled")).toBe(true);
    expect(s.ownerMessages.at(-1)!.text).toContain(f.customerName);
  });
});

describe("Ledger and Reporter", () => {
  /** The first day sent, a yes (booked by the owner), a stop and an out-of-office. */
  function week1() {
    const s = fresh();
    const sent = sendDue(s, DAY1_SEND);
    const [a, b, c] = sent as [DueTouch, DueTouch, DueTouch];
    const yes = receiveReply(s, { from: from(a), text: "Yes please, call me.", receivedAt: `${START}T14:00:00` });
    receiveReply(s, { from: from(b), text: "stop", receivedAt: `${START}T15:00:00` });
    receiveReply(s, { from: from(c), text: "I am out of the office until October 20.", subject: "Out of Office", receivedAt: `${START}T15:30:00` });
    return { s, sent, yes, a };
  }

  it("the quiet rate: what their software showed before, and old quotes answered since", () => {
    const before = quietRates(fresh());
    expect(before.startedOn).toBeUndefined();
    // one definition everywhere: the site's audit and the welcome text show the same rate the report starts from
    const st = fresh();
    expect(summarize(st.dataset, scan(st.dataset)).audit.rate).toBe(before.before.rate);
    expect(before.before.quotes).toBeGreaterThan(50);
    expect(before.before.rate).toBeGreaterThan(0.2);
    const { s } = week1();
    s.dataset.asOf = "2026-10-09";
    const q = quietRates(s);
    expect(q.startedOn).toBe(START);
    // the out-of-office is not an answer; the yes and the stop are
    if (q.backlog) expect(q.backlog.answered).toBeLessThanOrEqual(2);
    const text = reportWeek(s, "2026-10-09T16:00:00").text;
    if (q.backlog) expect(text).toContain(`Old quotes answered so far: ${q.backlog.answered} of ${q.backlog.followed}`);
  });

  it("the owner texts back BOOKED: an owner-reported recovery", () => {
    const { s, yes, a } = week1();
    markContacted(s, yes.id, `${START}T17:30:00`, "booked", 2400);
    const r = s.replies.find((x) => x.id === yes.id)!;
    expect(r).toMatchObject({ status: "done", outcome: "booked", outcomeValue: 2400, ownerContactedAt: `${START}T17:30:00` });
    expect(s.recoveries).toHaveLength(1);
    expect(s.recoveries[0]).toMatchObject({ customerId: a.touch.customerId, value: 2400, match: "owner_reported", cameBackOn: START });
    expect(s.events.at(-1)!.title).toBe(`Booked: ${a.customerName} — $2,400`);
    // logging it twice doesn't double count
    markContacted(s, yes.id, `${START}T18:00:00`, "booked", 2400);
    expect(s.recoveries).toHaveLength(1);
  });

  it("a fresh export shows who came back on their own; the ledger finds them", () => {
    const { s, sent, yes } = week1();
    markContacted(s, yes.id, `${START}T17:30:00`, "booked", 2400);
    const e = sent[5]!;
    const who = s.dataset.customers.find((c) => c.id === e.touch.customerId)!;
    const jobsExport = toCSV(
      ["Job #", "Client name", "Client email", "Title", "Job status", "Created date", "Start date", "Total ($)"],
      [[9901, who.name, e.to, "Stump grinding", "Upcoming", "10/20/2026", "10/28/2026", "650.00"]],
    );
    const { newRecoveries, lift } = reconcile(s, [{ name: "Jobs Report (update).csv", text: jobsExport, kind: "job" }], "2026-10-23T12:00:00Z");
    expect(newRecoveries).toBe(1);
    const rec = s.recoveries.find((r) => r.customerId === e.touch.customerId)!;
    expect(rec).toMatchObject({ match: "customer_id", value: 650, cameBackOn: "2026-10-20", record: { kind: "job" } });
    // they never wrote back, so it shows as "came back after our note" and isn't counted toward the guarantee
    expect(rec.tier).toBe("after_note");
    expect(s.recoveries.find((r) => r.customerId === yes.customerId)!.tier).toBe("traced");
    expect(s.recoveries.filter((r) => r.customerId === yes.customerId)).toHaveLength(1); // not re-counted
    expect(lift.treated.cameBack).toBe(2);
    expect(lift.treated.value).toBe(3050);
    expect(lift.confidence).toBe("early"); // the free round has no holdout
    expect(s.dataset.asOf).toBe("2026-10-23");
    // a second pass over the same data finds nothing new
    expect(ledgerPass(s, "2026-10-24T12:00:00Z").newRecoveries).toBe(0);
  });

  it("a quote they approved and the job it became, in different syncs, are one win", () => {
    const { s, sent } = week1();
    const e = sent[6]!;
    const cid = e.touch.customerId;
    receiveReply(s, { from: from(e), text: "Yes, let's do it.", receivedAt: `${START}T16:00:00` });
    s.dataset.quotes = [...s.dataset.quotes, quote("q-new", cid, { title: "Pine removal", status: "approved", rawStatus: "Approved", total: 2000, createdOn: "2026-10-10", sentOn: "2026-10-10", approvedOn: "2026-10-12" })];
    ledgerPass(s, "2026-10-12T12:00:00Z");
    s.dataset.jobs = [...s.dataset.jobs, job("j-new", cid, { title: "Pine removal", status: "scheduled", rawStatus: "Upcoming", total: 2150, createdOn: "2026-10-14", quoteId: "q-new" })];
    ledgerPass(s, "2026-10-14T12:00:00Z");
    const mine = s.recoveries.filter((r) => r.customerId === cid && !r.disputed);
    expect(mine.map((r) => [r.record.kind, r.value])).toEqual([["job", 2150]]);
  });

  it("a quiet comeback that turns into a reply, after the owner already texted BOOKED: counted once", () => {
    const { s, sent } = week1();
    const e = sent[5]!;
    const cid = e.touch.customerId;
    s.dataset.jobs = [...s.dataset.jobs, job("j-call", cid, { title: "Stump grinding", status: "scheduled", rawStatus: "Upcoming", total: 650, createdOn: "2026-10-20" })];
    ledgerPass(s, "2026-10-20T12:00:00Z");
    expect(s.recoveries.find((r) => r.customerId === cid)!.tier).toBe("after_note");
    const yes = receiveReply(s, { from: from(e), text: "Yes please, when can you come?", receivedAt: "2026-10-21T10:00:00" });
    markContacted(s, yes.id, "2026-10-21T12:00:00", "booked", 650);
    ledgerPass(s, "2026-10-21T13:00:00Z");
    const counted = s.recoveries.filter((r) => r.customerId === cid && !r.disputed && r.tier === "traced");
    expect(counted.map((r) => r.value)).toEqual([650]);
  });

  it("QUOTED in October, BOOKED six weeks later: the booking is dated when it booked and the job counts once", () => {
    const { s, yes } = week1();
    markContacted(s, yes.id, "2026-10-07T10:00:00", "quoted");
    markContacted(s, yes.id, "2026-11-18T10:00:00", "booked", 4800);
    const mine = () => s.recoveries.filter((r) => r.customerId === yes.customerId && !r.disputed && r.tier !== "after_note");
    expect(mine().map((r) => r.cameBackOn)).toEqual(["2026-11-18"]);
    s.dataset.jobs = [...s.dataset.jobs, job("j-oak", yes.customerId!, { status: "scheduled", rawStatus: "Upcoming", total: 4800, createdOn: "2026-11-18" })];
    ledgerPass(s, "2026-11-19T12:00:00Z");
    expect(mine().map((r) => r.value)).toEqual([4800]);
  });

  it("approved online in October, BOOKED texted in November when it's scheduled: one job, either order", () => {
    const counted = (s: AccountState, cid: string) => s.recoveries.filter((r) => r.customerId === cid && !r.disputed && r.tier !== "after_note").map((r) => r.value);
    // the approval reaches the ledger first
    {
      const { s, yes } = week1();
      const cid = yes.customerId!;
      markContacted(s, yes.id, "2026-10-07T10:00:00", "quoted");
      s.dataset.quotes = [...s.dataset.quotes, quote("q-oak", cid, { status: "approved", rawStatus: "Approved", total: 4800, createdOn: "2026-10-07", sentOn: "2026-10-07", approvedOn: "2026-10-12" })];
      ledgerPass(s, "2026-10-12T12:00:00Z");
      markContacted(s, yes.id, "2026-11-16T10:00:00", "booked", 4800);
      s.dataset.jobs = [...s.dataset.jobs, job("j-oak", cid, { status: "scheduled", rawStatus: "Upcoming", total: 4800, createdOn: "2026-11-16", quoteId: "q-oak" })];
      ledgerPass(s, "2026-11-17T12:00:00Z");
      expect(counted(s, cid)).toEqual([4800]);
    }
    // the BOOKED text first, the job (created at the approval) after
    {
      const { s, yes } = week1();
      const cid = yes.customerId!;
      markContacted(s, yes.id, "2026-10-07T10:00:00", "quoted");
      markContacted(s, yes.id, "2026-11-16T10:00:00", "booked", 4800);
      s.dataset.jobs = [...s.dataset.jobs, job("j-oak", cid, { status: "scheduled", rawStatus: "Upcoming", total: 4800, createdOn: "2026-10-12" })];
      ledgerPass(s, "2026-11-17T12:00:00Z");
      expect(counted(s, cid)).toEqual([4800]);
    }
  });

  it("a quote marked not ours stays out when it becomes a job, and a folded win keeps the day it came back", async () => {
    const { disputeRecovery } = await import("../src/runtime/agents.ts");
    const { s, sent } = week1();
    const e = sent[6]!;
    const cid = e.touch.customerId;
    receiveReply(s, { from: from(e), text: "Yes, let's do it.", receivedAt: `${START}T16:00:00` });
    s.dataset.quotes = [...s.dataset.quotes, quote("q-a", cid, { status: "approved", rawStatus: "Approved", total: 2000, createdOn: "2026-10-08", sentOn: "2026-10-08", approvedOn: "2026-10-09" })];
    ledgerPass(s, "2026-10-09T12:00:00Z");
    const rec = s.recoveries.find((r) => r.customerId === cid && r.record.id === "q-a")!;
    // the other way first: folded, still dated the approval
    const t = structuredClone(s);
    t.dataset.jobs = [...t.dataset.jobs, job("j-a", cid, { status: "scheduled", rawStatus: "Upcoming", total: 2150, createdOn: "2026-10-13", quoteId: "q-a" })];
    ledgerPass(t, "2026-10-13T12:00:00Z");
    expect(t.recoveries.filter((r) => r.customerId === cid && !r.disputed).map((r) => [r.record.id, r.value, r.cameBackOn])).toEqual([["j-a", 2150, "2026-10-09"]]);
    // marked not ours: its job doesn't come back as a win
    expect(disputeRecovery(s, rec.id, "Booked through the website", "owner", "2026-10-10T09:00:00")).toBe(true);
    s.dataset.jobs = [...s.dataset.jobs, job("j-a", cid, { status: "scheduled", rawStatus: "Upcoming", total: 2150, createdOn: "2026-10-13", quoteId: "q-a" })];
    ledgerPass(s, "2026-10-13T12:00:00Z");
    expect(s.recoveries.filter((r) => r.customerId === cid && !r.disputed)).toEqual([]);
  });

  it("the weekly report leads with what came back, then the counts", () => {
    const { s, sent, yes } = week1();
    markContacted(s, yes.id, `${START}T17:30:00`, "booked", 2400);
    const msg = reportWeek(s, "2026-10-09T16:00:00");
    expect(msg.kind).toBe("weekly");
    const lines = msg.text.split("\n");
    expect(lines[0]).toBe("Dave, 1 job came back this week — $2,400.");
    expect(msg.text).toContain(`Notes out: ${sent.length} (to ${sent.length} people)`);
    expect(msg.text).toContain("Wrote back: 2"); // the yes and the stop; out-of-office doesn't count
    expect(msg.text).toContain("Asked to come back: 1");
    expect(msg.text).toContain("Booked: 1 · $2,400");
    expect(msg.text).toContain("Your average time to call them back: 4h");
    expect(msg.text).not.toMatch(/Why the quiet ones said no/);
  });

  it("the weekly report says why the quiet ones said no, once there are a few answers", () => {
    const { s, sent } = week1();
    const say = (i: number, text: string) => receiveReply(s, { from: from(sent[i]!), text, receivedAt: `${START}T16:0${i}:00` });
    say(5, "We went with someone else, thanks.");
    say(6, "Not now, try me in the spring.");
    expect(lossReasons(s).reduce((a, x) => a + x.count, 0)).toBe(2);
    expect(reportWeek(s, "2026-10-09T16:00:00").text).not.toMatch(/Why the quiet ones said no/);
    say(7, "No thanks, it was too expensive for us.");
    say(8, "We went with another company.");
    expect(lossReasons(s)).toEqual([
      { reason: "went with someone else", count: 2 },
      { reason: "timing", count: 1 },
      { reason: "price", count: 1 },
    ]);
    expect(reportWeek(s, "2026-10-09T16:00:00").text).toContain("Why the quiet ones said no: 2 went with someone else, 1 timing, 1 price.");
  });

  describe("the guarantee", () => {
    const paying = (s: AccountState) => {
      s.dataset.business.plan.stage = "paying";
      s.dataset.business.plan.paidOn = "2026-10-01";
      return s;
    };
    it("a month where nobody asked to come back is free", () => {
      const s = paying(fresh());
      const sent = sendDue(s, DAY1_SEND);
      receiveReply(s, { from: from(sent[0]!), text: "stop", receivedAt: `${START}T15:00:00` });
      receiveReply(s, { from: from(sent[1]!), text: "We went with someone else, thanks.", receivedAt: `${START}T15:00:00` });
      const msg = billingCheck(s, "2026-10-31T09:00:00")!;
      expect(msg.kind).toBe("free_month");
      expect(msg.text).toMatch(/this month is free/);
      expect(msg.text).toContain("You won't be charged on November 1");
      expect(s.dataset.business.plan.freeMonths).toEqual(["2026-11-01"]);
      expect(s.events.at(-1)!.title).toBe("Guarantee: this month is free");
      // said once
      expect(billingCheck(s, "2026-11-01T09:00:00")).toBeUndefined();
    });
    it("a month where someone asked is charged, and the owner sees who", () => {
      const s = paying(fresh());
      const sent = sendDue(s, DAY1_SEND);
      const yes = receiveReply(s, { from: from(sent[0]!), text: "Yes please, call me.", receivedAt: `${START}T14:00:00` });
      markContacted(s, yes.id, `${START}T17:30:00`, "booked", 2400);
      const msg = billingCheck(s, "2026-10-31T09:00:00")!;
      expect(msg.kind).toBe("precharge");
      expect(msg.text).toContain(`• ${sent[0]!.customerName}`);
      expect(msg.text).toContain("booked $2,400");
      expect(s.dataset.business.plan.freeMonths).toEqual([]);
    });
    it("never judges the day they start paying, and says nothing once they've cancelled", () => {
      for (const day of ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-03"]) expect(billingCheck(paying(fresh()), `${day}T09:00:00`)).toBeUndefined();
      const s = paying(fresh());
      expect(s.dataset.business.plan.freeMonths).toEqual([]);
      s.dataset.business.plan.stage = "cancelled";
      expect(billingCheck(s, "2026-10-31T09:00:00")).toBeUndefined();
    });
    it("stays quiet away from the charge date, and on the trial", () => {
      expect(billingCheck(paying(fresh()), "2026-10-15T09:00:00")).toBeUndefined();
      expect(billingCheck(fresh(), "2026-10-31T09:00:00")).toBeUndefined();
    });
  });

  describe("the yearly plan", () => {
    const yearly = (s: AccountState) => {
      const plan = s.dataset.business.plan;
      plan.stage = "paying";
      plan.billing = "annual";
      plan.paidOn = "2026-10-01";
      plan.yearsPaidOn = ["2026-10-01"];
      return s;
    };
    it("costs ten months, and a quiet month refunds a twelfth automatically", () => {
      const s = yearly(fresh());
      expect(feesPaid(s.dataset.business, "2026-10-15")).toMatchObject({ total: 4970 });
      const msg = billingCheck(s, "2026-10-31T09:00:00")!;
      expect(msg.kind).toBe("free_month");
      expect(msg.text).toContain("$414.17 goes back to your card on November 1");
      expect(feesPaid(s.dataset.business, "2026-11-15").total).toBe(4555.83);
    });
    it("asks thirty days before the year ends, once, and never renews by itself", () => {
      const s = yearly(fresh());
      expect(renewalIfDue(s, "2027-08-20T09:00:00")).toBeUndefined();
      const ask = renewalIfDue(s, "2027-09-05T09:00:00")!;
      expect(ask.kind).toBe("renewal");
      expect(ask.text).toMatch(/ends October 1\. Nothing renews unless you say so\./);
      expect(ask.text).toContain("Reply RENEW");
      expect(renewalIfDue(s, "2027-09-06T09:00:00")).toBeUndefined();
      const lapse = renewalIfDue(s, "2027-10-01T09:00:00")!;
      expect(lapse.text).toMatch(/nothing renewed, so everything is paused/);
      expect(s.dataset.business.plan.stage).toBe("paused");
    });
    it("RENEW adds a year from the year's end; MONTHLY goes month to month and keeps the fee history", () => {
      const s = yearly(fresh());
      expect(renewPlan(s, "year", "2027-09-10T09:00:00").reply).toContain("another year from October 1");
      expect(s.dataset.business.plan.yearsPaidOn).toEqual(["2026-10-01", "2027-10-01"]);
      const m = yearly(fresh());
      expect(renewPlan(m, "monthly", "2027-09-10T09:00:00").reply).toContain("month to month from October 1");
      expect(m.dataset.business.plan).toMatchObject({ billing: "monthly", paidOn: "2027-10-01", stage: "paying" });
      expect(feesPaid(m.dataset.business, "2027-10-15").total).toBe(4970 + 497);
    });
    it("at the year's end, a year that didn't pay for itself refunds the difference, automatically", () => {
      const s = yearly(fresh());
      // no traced jobs this year
      renewalIfDue(s, "2027-10-01T09:00:00");
      const floorMsg = s.ownerMessages.find((m) => m.refs?.some((r) => r.kind === "year_floor"))!;
      expect(floorMsg.text).toMatch(/didn't pay for itself, so \$4,970\.00 goes back to your card/);
      expect(s.dataset.business.plan.yearRefunds).toEqual([{ yearStart: "2026-10-01", amount: 4970 }]);
      expect(feesPaid(s.dataset.business, "2027-10-02").total).toBe(0);
      // said once
      renewalIfDue(s, "2027-10-02T09:00:00");
      expect(s.ownerMessages.filter((m) => m.refs?.some((r) => r.kind === "year_floor"))).toHaveLength(1);
    });
    it("a year whose traced jobs beat the fee refunds nothing and says so", () => {
      const s = yearly(fresh());
      const c = s.dataset.customers[0]!;
      s.recoveries.push({ id: "big", customerId: c.id, record: { kind: "job", id: "j-big" }, value: 7200, cameBackOn: "2027-03-01", match: "customer_id", confidence: 0.9, tier: "traced" });
      renewalIfDue(s, "2027-10-01T09:00:00");
      const floorMsg = s.ownerMessages.find((m) => m.refs?.some((r) => r.kind === "year_floor"))!;
      expect(floorMsg.text).toContain("$7,200 in jobs traced to our notes, against $4,970 you paid");
      expect(s.dataset.business.plan.yearRefunds ?? []).toEqual([]);
    });
    it("the close offers the year only when the free round already brought back what a year costs, never on a forecast", () => {
      const s = fresh();
      expect(offerYear(s, 3000)).toBe(false);
      expect(offerYear(s, 4969)).toBe(false);
      expect(offerYear(s, 5200)).toBe(true);
    });
    it("the close offers the year only where the server sells it", () => {
      const s = fresh();
      for (const t of s.touches) markSent(s, t.id, `${t.dueAt}:00`, `msg-${t.id}`);
      const c = s.dataset.customers[0]!;
      s.recoveries.push({ id: "big", customerId: c.id, record: { kind: "job", id: "j-big" }, value: 7200, cameBackOn: ASOF, match: "customer_id", confidence: 0.9, tier: "traced" });
      expect(closeMessage(s)).not.toMatch(/year|twelve months/i);
      expect(closeMessage(s, { yearly: true })).toMatch(/Or pay for the year: \$4,970, twelve months for the price of ten/);
    });
  });

  it("closes the free round a week after its last note", () => {
    const s = fresh();
    for (const t of s.touches) markSent(s, t.id, `${t.dueAt}:00`, `msg-${t.id}`);
    const last = s.touches.map((t) => t.dueAt.slice(0, 10)).sort().pop()!;
    expect(closeIfDue(s, `${addDays(last, 3)}T09:00:00`)).toBeUndefined();
    const msg = closeIfDue(s, `${addDays(last, 8)}T09:00:00`)!;
    expect(msg.kind).toBe("close");
    expect(msg.text).toMatch(/^Dave, the free 150 is done\./);
    expect(msg.text).toContain("any month nobody asks to come back, you don't pay");
    expect(s.trialCompletedOn).toBe(last);
    expect(closeIfDue(s, `${addDays(last, 9)}T09:00:00`)).toBeUndefined();
  });
});

describe("booked out", () => {
  const firstNote = (s: AccountState, oppId: string) => s.touches.filter((t) => t.opportunityId === oppId).sort((a, b) => a.step - b.step)[0]!;
  const typeOf = (s: AccountState, oppId: string) => s.scan!.opportunities.find((o) => o.id === oppId)!.type;
  const increasing = (s: AccountState) => {
    const byOpp = new Map<string, Touch[]>();
    for (const t of s.touches) (byOpp.get(t.opportunityId) ?? byOpp.set(t.opportunityId, []).get(t.opportunityId)!).push(t);
    for (const ts of byOpp.values()) {
      ts.sort((a, b) => a.step - b.step);
      for (let i = 1; i < ts.length; i++) expect(ts[i]!.dueAt.slice(0, 10) > ts[i - 1]!.dueAt.slice(0, 10)).toBe(true);
    }
  };

  it("new work waits until about three weeks before the schedule opens; started sequences and yeses don't", () => {
    const s = fresh();
    const started = new Set(sendDue(s, DAY1_SEND).map((d) => d.touch.opportunityId));
    const before = new Map(s.touches.map((t) => [t.id, t.dueAt]));
    const { moved } = setBookedOut(s, "2026-12-15", `${START}T12:00:00`);
    expect(moved).toBeGreaterThan(0);
    expect(s.dataset.business.bookedOutUntil).toBe("2026-12-15");
    const floor = "2026-11-24"; // 21 days before, a Tuesday
    for (const t of s.touches) {
      const type = typeOf(s, t.opportunityId);
      if (started.has(t.opportunityId) || type === "approved_unscheduled") expect(t.dueAt).toBe(before.get(t.id));
      else if (t.step === firstNote(s, t.opportunityId).step) {
        expect(t.dueAt.slice(0, 10) >= floor).toBe(true);
        expect(t.heldDays).toBeGreaterThan(0);
      }
    }
    increasing(s);
    expect(s.events.at(-1)!.title).toBe("Booked out until 2026-12-15 — new work waits");
  });
  it("clearing it brings held notes back", () => {
    const s = fresh();
    const before = new Map(s.touches.map((t) => [t.id, t.dueAt.slice(0, 10)]));
    setBookedOut(s, "2026-12-15", NOW);
    const { moved } = setBookedOut(s, undefined, NOW);
    expect(moved).toBeGreaterThan(0);
    expect(s.dataset.business.bookedOutUntil).toBeUndefined();
    for (const t of s.touches) {
      expect(t.heldDays).toBeUndefined();
      // back in the week it was first planned for
      expect(mondayOf(t.dueAt.slice(0, 10))).toBe(mondayOf(before.get(t.id)!));
    }
    increasing(s);
  });
  it("a new plan while booked out starts held work late and yeses now", () => {
    const s = fresh();
    s.touches = [];
    s.dataset.business.bookedOutUntil = "2026-12-15";
    const p = planBatch(s, NOW, { startOn: START, limitPeople: 150 });
    const types = new Map(s.scan!.primary.map((o) => [o.customerId, o.type]));
    const firsts = p.touches.filter((t) => t.step === 1);
    expect(firsts.length).toBe(150);
    for (const t of firsts) {
      const type = types.get(t.customerId)!;
      if (type === "approved_unscheduled") expect(t.dueAt.slice(0, 10) < "2026-11-24").toBe(true);
      else expect(t.dueAt.slice(0, 10) >= "2026-11-24").toBe(true);
    }
  });
});

describe("comparison group: a staggered start, never a permanent hold", () => {
  it("holds some people on a paying account, then plans and writes to them ~60 days later", () => {
    const s = fresh();
    s.dataset.business.plan.stage = "paying";
    s.dataset.business.persistence.holdoutPct = 0.2;
    const p1 = planBatch(s, NOW, { startOn: START, limitPeople: 200 });
    expect(p1.holdout.length).toBeGreaterThan(0);
    const heldId = p1.holdout[0]!;
    const rec = s.outreach.find((o) => o.customerId === heldId)!;
    expect(rec.holdout).toBe(true);
    expect(rec.releaseOn).toBe(addDays(START, 60));
    // before release: still not planned
    planBatch(s, NOW, { startOn: addDays(START, 30), limitPeople: 5000 });
    expect(s.touches.some((t) => t.customerId === heldId)).toBe(false);
    // after release: planned, and the first note marks when treatment began
    planBatch(s, NOW, { startOn: addDays(START, 61), limitPeople: 5000 });
    const first = s.touches.find((t) => t.customerId === heldId && t.step === 1);
    expect(first).toBeTruthy();
    markSent(s, first!.id, `${first!.dueAt.slice(0, 10)}T09:00:00`);
    expect(s.outreach.find((o) => o.customerId === heldId)!.treatedFrom).toBe(first!.dueAt.slice(0, 10));
    // still exactly one record per person (the store keys outreach by customer)
    expect(s.outreach.filter((o) => o.customerId === heldId)).toHaveLength(1);
  });
});

describe("a late start never bunches the notes up", () => {
  it("an OK that comes after the planned first day moves the whole round forward, spacing kept", () => {
    const s = fresh();
    for (const t of s.touches) if (t.status === "approved") t.status = "planned";
    const before = s.touches.filter((t) => t.status === "planned");
    const firstBefore = before.map((t) => t.dueAt.slice(0, 10)).sort()[0]!;
    const late = addDays(firstBefore, 13);
    const r = ownerApproves(s, `${late}T08:00:00`);
    expect(r.firstDay! >= late).toBe(true);
    // nothing is due before the OK arrived
    expect(s.touches.filter((t) => t.status === "approved").every((t) => t.dueAt.slice(0, 10) >= late)).toBe(true);
  });
  it("a follow-up waits the planned gap after the note before it actually went", () => {
    const s = fresh();
    const note2 = s.touches.find((t) => t.step === 2 && t.status === "approved")!;
    const note1 = s.touches.find((t) => t.opportunityId === note2.opportunityId && t.step === 1)!;
    // note 1 went out a week late; note 2's own date has come, but the gap after note 1 hasn't passed
    markSent(s, note1.id, `${note2.dueAt.slice(0, 10)}T08:00:00`, "msg-late");
    const { due, held } = dueTouches(s, `${note2.dueAt.slice(0, 10)}T09:30`);
    expect(due.some((d) => d.touch.id === note2.id)).toBe(false);
    expect(held.find((h) => h.touch.id === note2.id)?.why).toBe("Too soon after note 1");
  });
});

describe("a sequence whose note was pulled", () => {
  it("stops the rest instead of waiting forever for it", () => {
    const s = fresh();
    const n3 = s.touches.find((t) => t.step === 3 && t.status === "approved")!;
    const n1 = s.touches.find((t) => t.opportunityId === n3.opportunityId && t.step === 1)!;
    const n2 = s.touches.find((t) => t.opportunityId === n3.opportunityId && t.step === 2)!;
    markSent(s, n1.id, `${n1.dueAt.slice(0, 10)}T09:00:00`, "msg-1");
    n2.status = "cancelled";
    const { held } = dueTouches(s, `${n3.dueAt.slice(0, 10)}T09:30`);
    expect(held.find((h) => h.touch.id === n3.id)?.why).toBe("Note 2 never went out — the rest of the sequence stops");
  });
});

/* ------------------------------------------------------------------ */
/* Always-on accounts: what a sync changes about what's queued          */
/* ------------------------------------------------------------------ */

const paying = { plan: { stage: "paying" as const, trialSize: 150, monthlyPrice: 497, freeMonths: [], paidOn: ago(40) } };

describe("a follow-up stops once they've said yes", () => {
  /** A paying tree shop: Mike's $1,800 oak quote planned and approved, and note 1 sent. */
  const mike = (over: Partial<Parameters<typeof quote>[2]> = {}) => {
    const st = emptyState(dataset({ business: paying, customers: [customer("c1")], quotes: [quote("q1", "c1", { title: "Dead oak over the garage", total: 1800, sentOn: ago(60), ...over })] }), NOW);
    find(st, NOW);
    planBatch(st, NOW, { startOn: START, approve: true });
    return st;
  };
  const yes = (st: AccountState, on: string) => {
    st.dataset.quotes = st.dataset.quotes.map((q) => (q.id === "q1" ? { ...q, status: "converted" as const, approvedOn: on, convertedOn: on, jobIds: ["j1"] } : q));
    st.dataset.jobs = [job("j1", "c1", { title: "Dead oak over the garage", total: 1800, status: "scheduled", createdOn: on, scheduledOn: addDays(on, 7), completedOn: undefined, quoteId: "q1" })];
    ledgerPass(st, `${on}T12:00:00`);
  };

  it("approved online after note 1: the rest of the sequence never goes, and the operator sees why", () => {
    const st = mike();
    const [n1, ...rest] = touchesOf(st, "c1");
    expect(rest.length).toBeGreaterThanOrEqual(2);
    expect(sendDue(st, n1!.dueAt).map((d) => d.touch.id)).toEqual([n1!.id]);
    yes(st, "2026-10-08");
    // the ledger has the win...
    expect(st.recoveries.some((r) => r.customerId === "c1" && r.value === 1800)).toBe(true);
    // ...and note 2 is held for good, not sent to someone already booked
    const { due, held } = dueTouches(st, rest[0]!.dueAt);
    expect(due).toEqual([]);
    const why = held.find((h) => h.touch.id === rest[0]!.id)!.why;
    expect(why).toBe("No longer needed: the quote became a job");
    expect(why).toMatch(HELD_FOR_GOOD);
    // the Sender stops the whole rest at once
    expect(dropSettled(st, `${rest[0]!.dueAt}:00`).map((t) => t.id)).toEqual(rest.map((t) => t.id));
    expect(st.events.at(-1)).toMatchObject({ agent: "guard", title: "Stopped the follow-ups to Mike Sanderson", detail: "The quote became a job." });
    for (const t of rest) expect(sendDue(st, t.dueAt)).toEqual([]);
  });

  it("approved before note 1 went: note 1 doesn't go either", () => {
    const st = mike();
    const [n1] = touchesOf(st, "c1");
    st.dataset.quotes = st.dataset.quotes.map((q) => ({ ...q, status: "approved" as const, approvedOn: "2026-10-01" }));
    ledgerPass(st, "2026-10-01T12:00:00");
    expect(dueTouches(st, n1!.dueAt).held.find((h) => h.touch.id === n1!.id)!.why).toBe("No longer needed: the quote was approved");
  });

  it("a status a person has to read stops the rest: a yes with a note, a yes that came undone, one we don't know", () => {
    for (const [raw, why] of [
      ["Yes - deposit received", "the quote was approved"],
      ["Yes - backed out", "its status changed to one a person needs to read"],
      ["Assigned", "its status changed to one a person needs to read"],
    ] as const) {
      const st = mike();
      const [n1] = touchesOf(st, "c1");
      st.dataset.quotes = st.dataset.quotes.map((q) => ({ ...q, rawStatus: raw, status: raw.startsWith("Yes - d") ? ("approved" as const) : ("awaiting_response" as const), unreadStatus: raw.startsWith("Yes - d") ? undefined : true }));
      expect(dueTouches(st, n1!.dueAt).held.find((h) => h.touch.id === n1!.id)?.why, raw).toBe(`No longer needed: ${why}`);
    }
  });

  it("a job they booked since, or a new quote sent since, stops it too; nothing new, and it carries on", () => {
    const booked = mike();
    const [b1] = touchesOf(booked, "c1");
    expect(dueTouches(booked, b1!.dueAt).due.map((d) => d.touch.id)).toEqual([b1!.id]);
    booked.dataset.jobs = [job("j2", "c1", { title: "Stump grinding", status: "completed", createdOn: "2026-10-02", completedOn: "2026-10-03" })];
    expect(dueTouches(booked, b1!.dueAt).held[0]!.why).toBe("No longer needed: they've booked a job since");
    const requoted = mike();
    requoted.dataset.quotes = [...requoted.dataset.quotes, quote("q2", "c1", { title: "Dead oak, revised", sentOn: "2026-10-02" })];
    expect(dueTouches(requoted, touchesOf(requoted, "c1")[0]!.dueAt).held[0]!.why).toBe("No longer needed: they've had a new quote since");
  });

  it("'want to get it on the schedule?' stops when the job is scheduled, not when it's made and still unscheduled", () => {
    const st = mike({ status: "approved", approvedOn: ago(30) });
    const [n1] = touchesOf(st, "c1");
    expect(n1!.chases?.type).toBe("approved_unscheduled");
    st.dataset.quotes = st.dataset.quotes.map((q) => ({ ...q, status: "converted" as const, jobIds: ["j1"] }));
    st.dataset.jobs = [job("j1", "c1", { status: "unscheduled", createdOn: "2026-10-02", completedOn: undefined, quoteId: "q1" })];
    expect(dueTouches(st, n1!.dueAt).due.map((d) => d.touch.id)).toEqual([n1!.id]);
    st.dataset.jobs = [{ ...st.dataset.jobs[0]!, status: "scheduled", scheduledOn: "2026-10-20" }];
    expect(dueTouches(st, n1!.dueAt).held[0]!.why).toBe("No longer needed: the work is on the schedule now");
  });

  it("the unquoted-request follow-up stops when the quote goes out", () => {
    const st = emptyState(dataset({ business: paying, customers: [customer("c1")], requests: [request("r1", "c1", { createdOn: ago(10) })] }), NOW);
    find(st, NOW);
    planBatch(st, NOW, { startOn: START, approve: true });
    const [n1] = touchesOf(st, "c1");
    expect(n1!.chases?.type).toBe("unquoted_request");
    st.dataset.quotes = [quote("q9", "c1", { sentOn: "2026-10-02" })];
    expect(dueTouches(st, n1!.dueAt).held[0]!.why).toBe("No longer needed: their request got a quote");
  });
});

describe("always-on: someone whose request we answered is still followed up", () => {
  /** Mike's request came in Tuesday and our answer went at once. */
  const answered = (over: { quotes?: ReturnType<typeof quote>[]; sent?: boolean } = {}) => {
    const st = emptyState(dataset({ business: paying, customers: [customer("c1")], quotes: over.quotes ?? [], requests: [request("r1", "c1", { title: "Oak over the garage", createdOn: ASOF, createdAt: `${ASOF}T13:30:00Z` })] }), NOW);
    expect(answerNewRequests(st, `${ASOF}T10:00:00`, { features: NEW_REQUESTS })).toBe(1);
    const a = st.touches.find((t) => t.track === "new_request")!;
    if (over.sent !== false) markSent(st, a.id, `${ASOF}T10:02:00`, "msg-answer");
    return st;
  };
  const planOn = (st: AccountState, day: string) => {
    st.dataset.asOf = day;
    find(st, `${day}T03:00:00`, NEW_REQUESTS);
    return planBatch(st, `${day}T03:00:00`, { startOn: day, approve: true, features: NEW_REQUESTS });
  };

  it("the quote Dave sent after our answer gets its fresh-quote follow-up", () => {
    const st = answered();
    st.dataset.quotes = [quote("q1", "c1", { title: "Oak over the garage", total: 1800, sentOn: "2026-10-01" })];
    const p = planOn(st, "2026-10-05");
    expect(p.people).toEqual(["c1"]);
    expect(touchesOf(st, "c1").filter((t) => !t.instant).every((t) => t.track === "fresh_quote" && t.chases?.id === "q1")).toBe(true);
  });

  it("with no quote, the request's own follow-up takes over after two days", () => {
    const st = answered();
    const p = planOn(st, "2026-10-05");
    expect(p.people).toEqual(["c1"]);
    expect(touchesOf(st, "c1").find((t) => !t.instant)!.chases).toEqual({ type: "unquoted_request", kind: "request", id: "r1" });
  });

  it("never a second note on the heels of the answer: nothing older is dug up, and an answer still on its way holds them", () => {
    const old = [quote("q0", "c1", { title: "Crown thinning, 3 maples", sentOn: ago(200) })];
    // the day after: the old quote isn't chased at someone who just asked for new work
    expect(planOn(answered({ quotes: old }), "2026-09-30").people).toEqual([]);
    // an answer not yet gone: nothing is planned for them until it goes
    expect(planOn(answered({ sent: false }), "2026-10-05").people).toEqual([]);
    // a week on, the quote for the new work is followed up, not the old one
    const st = answered({ quotes: old });
    st.dataset.quotes = [...old, quote("q1", "c1", { title: "Oak over the garage", sentOn: "2026-10-01" })];
    expect(planOn(st, "2026-10-05").people).toEqual(["c1"]);
    expect(touchesOf(st, "c1").filter((t) => !t.instant).every((t) => t.chases?.id === "q1")).toBe(true);
  });

  it("someone who wrote back to our answer is the owner's to talk to: nothing is planned for them, or anyone at their address", () => {
    for (const text of ["Thanks, but we already hired another company for this. Please don't follow up.", "Sounds good, when can you come?"]) {
      const st = answered();
      // their spouse's record, at the same address, with a quote of its own
      st.dataset.customers.push(customer("c2", { name: "Jo Sanderson", firstName: "Jo", emails: ["c1@gmail.com"] }));
      st.dataset.quotes = [quote("q2", "c2", { sentOn: ago(60) })];
      receiveReply(st, { from: "c1@gmail.com", text, receivedAt: `${ASOF}T11:00:00`, inReplyTo: "msg-answer" });
      expect(planOn(st, "2026-10-05").people).toEqual([]);
      expect(st.touches.filter((t) => !t.instant)).toEqual([]);
    }
  });
});

describe("always-on: a newer quote that stops a follow-up gets followed up itself", () => {
  const planOn = (st: AccountState, day: string) => {
    st.dataset.asOf = day;
    find(st, `${day}T03:00:00`, NEW_REQUESTS);
    return planBatch(st, `${day}T03:00:00`, { startOn: day, approve: true, features: NEW_REQUESTS });
  };
  const sendFirst = (st: AccountState) => {
    const n1 = touchesOf(st, "c1").find((t) => t.step === 1 && !t.instant && t.status === "approved")!;
    markSent(st, n1.id, `${n1.dueAt}:00`, `msg-${n1.id}`);
    return n1;
  };

  it("the request's follow-up, stopped by the quote it asked for: that quote is chased instead, once", () => {
    const st = emptyState(dataset({ business: paying, customers: [customer("c1")], requests: [request("r1", "c1", { title: "Oak over the garage", createdOn: ASOF, createdAt: `${ASOF}T13:30:00Z` })] }), NOW);
    answerNewRequests(st, `${ASOF}T10:00:00`, { features: NEW_REQUESTS });
    markSent(st, st.touches[0]!.id, `${ASOF}T10:02:00`, "msg-answer");
    // the nightly two days on starts the request's follow-up, and its note 1 goes that morning
    expect(planOn(st, "2026-10-01").people).toEqual(["c1"]);
    expect(sendFirst(st).chases?.type).toBe("unquoted_request");
    // Dave quotes after the site visit: the rest of the request's follow-up stops
    st.dataset.quotes = [quote("q1", "c1", { title: "Oak over the garage", total: 1800, sentOn: "2026-10-05" })];
    const stopped = dropSettled(st, "2026-10-05T12:00:00");
    expect(stopped.map((t) => t.lastError)).toEqual(stopped.map(() => "No longer needed: their request got a quote"));
    // the quote gets its own fresh-quote follow-up once it's two days old...
    expect(planOn(st, "2026-10-07").people).toEqual(["c1"]);
    const chasing = touchesOf(st, "c1").filter((t) => t.chases?.id === "q1");
    expect(chasing.length).toBeGreaterThan(1);
    expect(chasing.every((t) => t.track === "fresh_quote" && t.status === "approved" && t.dueAt >= "2026-10-07")).toBe(true);
    // ...and only once
    expect(planOn(st, "2026-10-08").people).toEqual([]);
    sendFirst(st);
    expect(planOn(st, "2026-10-13").people).toEqual([]);
  });

  it("a quote dated before the request's follow-up was planned (the sheet came in later) is still the one chased", () => {
    const st = emptyState(dataset({ business: paying, customers: [customer("c1")], requests: [request("r1", "c1", { title: "Oak over the garage", createdOn: ASOF, createdAt: `${ASOF}T13:30:00Z` })] }), NOW);
    answerNewRequests(st, `${ASOF}T10:00:00`, { features: NEW_REQUESTS });
    markSent(st, st.touches[0]!.id, `${ASOF}T10:02:00`, "msg-answer");
    expect(planOn(st, "2026-10-01").people).toEqual(["c1"]);
    sendFirst(st);
    // Dave priced it on the 30th; the sheet with that quote comes in on the 5th
    st.dataset.quotes = [quote("q1", "c1", { title: "Oak over the garage", total: 1800, sentOn: "2026-09-30" })];
    expect(dropSettled(st, "2026-10-05T12:00:00").map((t) => t.lastError)).toContain("No longer needed: their request got a quote");
    expect(planOn(st, "2026-10-06").people).toEqual(["c1"]);
    const chasing = touchesOf(st, "c1").filter((t) => t.chases?.id === "q1");
    expect(chasing.length).toBeGreaterThan(1);
    expect(chasing.every((t) => t.status === "approved" && t.dueAt >= "2026-10-06")).toBe(true);
    expect(planOn(st, "2026-10-07").people).toEqual([]);
  });

  it("a revised quote that stopped the old quote's notes: the revised one is chased, never the old one again", () => {
    const st = emptyState(dataset({ business: paying, customers: [customer("c1")], quotes: [quote("q1", "c1", { title: "Dead oak over the garage", total: 2400, sentOn: ago(60) })] }), NOW);
    expect(planOn(st, ASOF).people).toEqual(["c1"]);
    sendFirst(st);
    st.dataset.quotes = [...st.dataset.quotes, quote("q2", "c1", { title: "Dead oak over the garage, revised", total: 2000, sentOn: "2026-10-02" })];
    // nothing while the old quote's notes are still queued (two sequences at once)...
    expect(planOn(st, "2026-10-05").people).toEqual([]);
    expect(dropSettled(st, "2026-10-05T12:00:00").map((t) => t.lastError)).toContain("No longer needed: they've had a new quote since");
    // ...then the revised quote's own
    expect(planOn(st, "2026-10-06").people).toEqual(["c1"]);
    const live = touchesOf(st, "c1").filter((t) => t.status === "approved");
    expect(live.length).toBeGreaterThan(1);
    expect(live.every((t) => t.chases?.id === "q2" && t.track === "fresh_quote")).toBe(true);
    expect(planOn(st, "2026-10-07").people).toEqual([]);
  });

  it("not for someone who has written back since, or bought", () => {
    const st = emptyState(dataset({ business: paying, customers: [customer("c1")], quotes: [quote("q1", "c1", { title: "Dead oak over the garage", total: 2400, sentOn: ago(60) })] }), NOW);
    planOn(st, ASOF);
    const n1 = sendFirst(st);
    st.dataset.quotes = [...st.dataset.quotes, quote("q2", "c1", { title: "Dead oak over the garage, revised", total: 2000, sentOn: "2026-10-02" })];
    dropSettled(st, "2026-10-02T12:00:00");
    expect(planOn(structuredClone(st), "2026-10-06").people).toEqual(["c1"]);
    const replied = structuredClone(st);
    receiveReply(replied, { from: "c1@gmail.com", text: "Thanks, we'll think it over.", receivedAt: "2026-10-03T11:00:00", inReplyTo: n1.providerId });
    expect(planOn(replied, "2026-10-06").people).toEqual([]);
    st.dataset.jobs = [job("j1", "c1", { title: "Dead oak over the garage", status: "scheduled", createdOn: "2026-10-04", scheduledOn: "2026-10-20", completedOn: undefined })];
    expect(planOn(st, "2026-10-06").people).toEqual([]);
  });
});

describe("an answer to a new request held up by the mailbox", () => {
  const queued = () => {
    const st = emptyState(dataset({ business: paying, customers: [customer("c1", { phones: ["+16035550142"] })], requests: [request("r1", "c1", { title: "Oak over the garage", createdOn: ASOF, createdAt: `${ASOF}T13:30:00Z` })] }), NOW);
    answerNewRequests(st, `${ASOF}T10:00:00`, { features: NEW_REQUESTS }); // Tuesday 10am: "Dave will give you a call today"
    const t = st.touches.find((x) => x.track === "new_request")!;
    expect(t.body).toMatch(/call today/);
    return { st, t };
  };

  it("is judged from when it was first due: retries past midnight never send it at night, a day late, saying 'today'", () => {
    const { st, t } = queued();
    // six refusals moved it to 8:30pm: past the answer hours of the day it was written for
    t.attempts = 6;
    t.dueAt = `${ASOF}T20:30`;
    const { due, held } = dueTouches(st, `${ASOF}T20:30`);
    expect(due).toEqual([]);
    expect(held[0]!.why).toBe("No longer needed: it would have gone after 8pm, past the day it was written for");
    // seven moved it to midnight: the 12-hour limit is still counted from 10am, not from the moved time
    t.attempts = 7;
    t.dueAt = "2026-09-30T00:00";
    expect(dueTouches(st, "2026-09-30T00:00").held[0]!.why).toBe("No longer needed: it would have gone 14 hours late");
    t.dueAt = "2026-09-30T07:30";
    expect(dueTouches(st, "2026-09-30T07:30").due).toEqual([]);
  });

  it("a retry moved past 8pm is dropped as soon as it's moved, and the owner is told to call", () => {
    const { st, t } = queued();
    t.attempts = 6;
    t.dueAt = `${ASOF}T20:30`;
    expect(dropStaleAnswers(st, `${ASOF}T17:30:00`).map((x) => x.id)).toEqual([t.id]);
    expect(t.status).toBe("cancelled");
    expect(st.ownerMessages.at(-1)!.text).toMatch(/didn't go out .*after 8pm.* Call them/);
  });

  it("an answer waiting for 7am is never dropped early", () => {
    const st = emptyState(dataset({ business: paying, customers: [customer("c1")], requests: [request("r1", "c1", { createdOn: ASOF, createdAt: `${ASOF}T21:30:00Z` })] }), NOW);
    answerNewRequests(st, `${ASOF}T22:40:00`, { features: NEW_REQUESTS });
    expect(dropStaleAnswers(st, `${ASOF}T23:00:00`)).toEqual([]);
    expect(dueTouches(st, "2026-09-30T07:00").due).toHaveLength(1);
  });
});
