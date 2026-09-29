import { beforeAll, describe, expect, it } from "vitest";
import {
  approveAll,
  billingCheck,
  closeIfDue,
  dueTouches,
  find,
  ledgerPass,
  markContacted,
  markSent,
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
import { leadCode, lossReasons } from "../src/reports/owner.ts";
import { emptyDataset, toCSV } from "../src/ingest/index.ts";
import { generateSample, type Sample } from "../src/sample/generate.ts";
import type { Plan } from "../src/cadence/plan.ts";
import type { Touch } from "../src/model.ts";
import { addDays, mondayOf, weekday } from "../src/util.ts";
import { ASOF } from "./fixtures.ts";

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

  it("the weekly report leads with what came back, then the counts", () => {
    const { s, sent, yes } = week1();
    markContacted(s, yes.id, `${START}T17:30:00`, "booked", 2400);
    const msg = reportWeek(s, "2026-10-09T16:00:00");
    expect(msg.kind).toBe("weekly");
    const lines = msg.text.split("\n");
    expect(lines[0]).toBe("Dave, 1 job came back this week — $2,400.");
    expect(msg.text).toContain(`Notes out: ${sent.length} (to ${sent.length} people)`);
    expect(msg.text).toContain("Wrote back: 2"); // the yes and the stop; out-of-office doesn't count
    expect(msg.text).toContain("Want a price or a date: 1");
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
    it("a month where nobody asked for a price or a date is free", () => {
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
    it("stays quiet away from the charge date, and on the trial", () => {
      expect(billingCheck(paying(fresh()), "2026-10-15T09:00:00")).toBeUndefined();
      expect(billingCheck(fresh(), "2026-10-31T09:00:00")).toBeUndefined();
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
    expect(msg.text).toContain("any month nobody asks for a price or a date, you don't pay");
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
