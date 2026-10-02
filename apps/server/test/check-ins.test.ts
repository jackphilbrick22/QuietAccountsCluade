import { afterEach, describe, expect, it } from "vitest";
import { addDays, leadCode, type Opportunity, type Reply, type Touch } from "@qa/engine";
import { deliverOwnerMessages } from "../src/core/ops.ts";
import { tick } from "../src/core/worker.ts";
import type { LogEmailProvider } from "../src/providers/email.ts";
import type { TextToSend } from "../src/core/textsToSend.ts";
import { LogNotifier, ManualNotifier } from "../src/providers/sms.ts";
import { addLead, harness, PHONE, person, WH, type Harness } from "./harness.ts";

/**
 * BRIEF B6: "Did it book?" two days after a hand-off and again at 14, through the worker and the normal owner-text path,
 * and the fresh export at a one pass's end: asked once, and what its import shows booked waits for Jack's word.
 */

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

function make(opts: Parameters<typeof harness>[0] = {}): Harness {
  const h = harness(opts);
  open.push(h);
  return h;
}

/** The worker at 11am in New Hampshire (10am once the clocks go back), each day from `from` through `to`. */
async function days(h: Harness, from: string, to: string): Promise<void> {
  for (let day = from; day <= to; day = addDays(day, 1)) {
    h.setNow(`${day}T15:00:00Z`);
    await tick(h.d);
  }
}

/** The check-in texts, oldest first: their day, text and how they went. */
const checkIns = (h: Harness, bid = "ridge") =>
  h.d.accounts.repo
    .ownerMessages(bid)
    .filter((m) => m.kind === "check_in")
    .reverse()
    .map((m) => ({ on: m.at.slice(0, 10), text: m.text, delivery: m.delivery }));
const line = (name: string, rid: string) => `Did ${name} book? Reply BOOKED $amount #${leadCode(rid)}, or NO #${leadCode(rid)}.`;
const review = async (h: Harness) => (await h.api("GET", "/api/review")).json.items as Record<string, any>[];

/** A tree shop whose owner had Karen Whitfield's yes texted to him Tuesday, Sep 29 at 10am. */
async function shop(h: Harness, bid = "ridge", over: Record<string, unknown> = {}): Promise<void> {
  await h.business(bid, over);
  await addLead(h, bid, `r-${bid}`, "Karen Whitfield", "2026-09-29T10:00:00");
}

describe("did it book? (BRIEF B6)", () => {
  it("a hand-off nobody answers: texted to the owner on day 2 and again on day 14, and nothing more", async () => {
    const h = make();
    await shop(h);
    await days(h, "2026-09-29", "2026-11-30");
    expect(checkIns(h)).toEqual([
      { on: "2026-10-01", text: line("Karen Whitfield", "r-ridge"), delivery: "sent" },
      { on: "2026-10-13", text: line("Karen Whitfield", "r-ridge"), delivery: "sent" },
    ]);
    expect((h.d.notifier as LogNotifier).sent.filter((x) => x.text.startsWith("Did ")).map((x) => x.to.phone)).toEqual([PHONE, PHONE]);
  });

  it("the owner's answer stops them: BOOKED before day 2, NO before day 14", async () => {
    const h = make();
    await shop(h);
    await addLead(h, "ridge", "r-mike", "Mike Sanderson", "2026-09-29T11:00:00");
    h.setNow("2026-09-30T20:00:00Z");
    // the reply the check-in asks for, amount filled in
    expect(await h.sms(`BOOKED $2,400 #${leadCode("r-ridge")}`)).toBe("Booked: Karen Whitfield, $2,400. Added to your results. 1 more waiting.");
    await days(h, "2026-10-01", "2026-10-05");
    expect(checkIns(h).map((x) => [x.on, x.text])).toEqual([["2026-10-01", line("Mike Sanderson", "r-mike")]]);
    expect(await h.sms(`NO #${leadCode("r-mike")}`)).toBe("Got it — Mike Sanderson marked not a fit.");
    await days(h, "2026-10-06", "2026-11-30");
    expect(checkIns(h)).toHaveLength(1);
  });

  it("DONE (as the hand-off asks) or QUOTED doesn't say whether it booked: both still go, and the answer to them stops the rest", async () => {
    const h = make();
    await shop(h);
    await addLead(h, "ridge", "r-mike", "Mike Sanderson", "2026-09-29T11:00:00");
    h.setNow("2026-09-29T20:00:00Z");
    expect(await h.sms(`DONE #${leadCode("r-ridge")}`)).toBe("Thanks — Karen Whitfield marked as reached. 1 more waiting.");
    await days(h, "2026-09-30", "2026-10-01");
    h.setNow("2026-10-02T20:00:00Z");
    expect(await h.sms(`QUOTED #${leadCode("r-mike")}`)).toBe("Got it — Mike Sanderson has a price. We'll count it when it books.");
    await days(h, "2026-10-02", "2026-10-13");
    const both = `${line("Karen Whitfield", "r-ridge")}\n${line("Mike Sanderson", "r-mike")}`;
    expect(checkIns(h).map((x) => [x.on, x.text])).toEqual([
      ["2026-10-01", both],
      ["2026-10-13", both],
    ]);
    // the answers the day-14 one asks for
    h.setNow("2026-10-13T20:00:00Z");
    expect(await h.sms(`BOOKED $2,400 #${leadCode("r-ridge")}`)).toBe("Booked: Karen Whitfield, $2,400. Added to your results.");
    expect(await h.sms(`NO #${leadCode("r-mike")}`)).toBe("Got it — Mike Sanderson marked not a fit.");
    expect(h.d.accounts.peek("ridge")!.state.replies.map((r) => r.outcome)).toEqual(["booked", "lost"]);
  });

  it("an answer that could go either way stops them too, while Jack reads it, after DONE as well", async () => {
    const h = make();
    await shop(h);
    await addLead(h, "ridge", "r-mike", "Mike Sanderson", "2026-09-29T11:00:00");
    h.setNow("2026-09-30T20:00:00Z");
    expect(await h.sms(`Booked 2400, she won't sign up for the maintenance plan #${leadCode("r-ridge")}`)).toMatch(/^Thanks — that one could go either way/);
    expect(await h.sms(`DONE #${leadCode("r-mike")}`)).toBe("Thanks — Mike Sanderson marked as reached. 1 more waiting.");
    await days(h, "2026-10-01", "2026-10-01");
    expect(checkIns(h).map((x) => x.text)).toEqual([line("Mike Sanderson", "r-mike")]);
    h.setNow("2026-10-01T20:00:00Z");
    expect(await h.sms(`Booked 1800 but he wants it done after Christmas #${leadCode("r-mike")}`)).toMatch(/^Thanks — that one could go either way/);
    await days(h, "2026-10-02", "2026-11-30");
    expect(checkIns(h)).toHaveLength(1);
  });

  it("two leads due the same day share one text, each line with its own code", async () => {
    const h = make();
    await shop(h);
    await addLead(h, "ridge", "r-mike", "Mike Sanderson", "2026-09-29T16:45:00");
    await days(h, "2026-09-29", "2026-10-02");
    expect(checkIns(h)).toEqual([{ on: "2026-10-01", text: `${line("Karen Whitfield", "r-ridge")}\n${line("Mike Sanderson", "r-mike")}`, delivery: "sent" }]);
  });

  it("by hand (SMS_PROVIDER=manual) it waits on Texts to send, and the answer pasted back records the booking", async () => {
    const h = make({ notifier: new ManualNotifier() });
    await shop(h);
    await days(h, "2026-09-29", "2026-10-01");
    const list = (await h.api("GET", "/api/texts-to-send")).json as TextToSend[];
    expect(list.find((t) => t.kind === "check_in")).toMatchObject({ businessId: "ridge", ownerFirstName: "Dave", phone: PHONE, text: line("Karen Whitfield", "r-ridge") });
    const pasted = await h.api("POST", "/api/businesses/ridge/owner-texts", { text: `BOOKED $1800 #${leadCode("r-ridge")}` });
    expect(pasted.json).toMatchObject({ handled: "booked", reply: "Booked: Karen Whitfield, $1,800. Added to your results." });
    await days(h, "2026-10-02", "2026-11-30");
    expect(checkIns(h)).toHaveLength(1);
  });

  it("one still on Texts to send when the owner texts STOP never goes another way (no email, nothing for Jack)", async () => {
    const h = make({ notifier: new ManualNotifier() });
    await shop(h, "ridge", { ownerEmail: "dave@ridgelinetree.com" });
    await days(h, "2026-09-29", "2026-10-01");
    expect(checkIns(h).map((x) => x.delivery)).toEqual(["manual"]);
    await h.sms("STOP");
    await deliverOwnerMessages(h.d, "ridge");
    expect(checkIns(h).map((x) => x.delivery)).toEqual(["skipped"]);
    // the other texts waiting for him go by email, as any does once texts are off; this one doesn't
    expect((h.d.email as LogEmailProvider).sent.length).toBeGreaterThan(0);
    expect((h.d.email as LogEmailProvider).sent.filter((m) => m.text.includes("book?"))).toEqual([]);
    expect(((await h.api("GET", "/api/texts-to-send")).json as TextToSend[]).some((t) => t.kind === "check_in")).toBe(false);
    expect((await review(h)).some((x) => x.kind === "owner_message" && x.messageKind === "check_in")).toBe(false);
  });

  it("a restart never sends one twice, even one that came before the day was marked done", async () => {
    const h = make();
    await shop(h);
    await days(h, "2026-09-29", "2026-10-01");
    // the server stopped after the text was made, before the day's checks were marked done
    h.d.accounts.repo.setMark("ridge", "daily", "2026-09-30");
    const again = h.restart();
    open.push(again);
    await days(again, "2026-10-01", "2026-10-13");
    const third = again.restart();
    open.push(third);
    third.d.accounts.repo.setMark("ridge", "daily", "2026-10-12");
    await days(third, "2026-10-13", "2026-11-30");
    expect(checkIns(third).map((x) => x.on)).toEqual(["2026-10-01", "2026-10-13"]);
  });

  it("an owner with two businesses on one cell gets one a day: the second's goes the next weekday", async () => {
    const h = make();
    await shop(h);
    await shop(h, "pine", { name: "Tall Pine Tree" });
    await days(h, "2026-09-29", "2026-10-16");
    expect(checkIns(h).map((x) => x.on)).toEqual(["2026-10-01", "2026-10-13"]);
    expect(checkIns(h, "pine").map((x) => x.on)).toEqual(["2026-10-02", "2026-10-14"]);
  });

  it("nothing while the client is paused, to an owner who texted STOP, or once cancelled; held up a few days, it goes after RESUME", async () => {
    const paused = make();
    await shop(paused);
    expect(await paused.sms("PAUSE")).toMatch(/^Paused\./);
    await days(paused, "2026-09-29", "2026-10-05");
    expect(checkIns(paused)).toEqual([]);
    expect(await paused.sms("RESUME")).toMatch(/^Back on\./);
    await days(paused, "2026-10-06", "2026-10-31");
    expect(checkIns(paused).map((x) => x.on)).toEqual(["2026-10-06", "2026-10-13"]);

    for (const text of ["STOP", "CANCEL"]) {
      const h = make();
      await shop(h);
      await h.sms(text);
      await days(h, "2026-09-29", "2026-10-31");
      expect(checkIns(h), text).toEqual([]);
    }
  });

  it("while the close is out, none goes: the owner's yes is the close's. Once he's paying, the one held up goes", async () => {
    const h = make();
    await shop(h);
    // the free round's last note went a week ago: the close goes with the day's checks
    await h.d.accounts.withAccount("ridge", (s) => {
      s.touches.push({ id: "t-last", opportunityId: "o-last", customerId: "c-r-ridge", channel: "email", step: 1, angle: "check_in", dueAt: "2026-09-21T08:00", sentAt: "2026-09-21T08:00:00", status: "sent", body: "", flags: [] });
    });
    await days(h, "2026-09-29", "2026-10-01");
    expect(h.d.accounts.repo.ownerMessages("ridge").map((m) => m.kind)).toContain("close");
    expect(checkIns(h)).toEqual([]);
    h.setNow("2026-10-01T20:00:00Z");
    expect(await h.sms("Yes")).toBe("Great — Jack will text you the payment link, and the next batch goes out next week.");
    // a no to it never marks the lead not a fit either
    expect(await h.sms("No")).toBe("Got it — Jack will read this and get back to you. About a lead? Text NO and the #code.");
    expect(h.d.accounts.peek("ridge")!.state.replies[0]).toMatchObject({ status: "handed_off" });
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying" } })).status).toBe(200);
    await days(h, "2026-10-02", "2026-10-31");
    expect(checkIns(h).map((x) => [x.on, x.text])).toEqual([
      ["2026-10-02", line("Karen Whitfield", "r-ridge")],
      ["2026-10-13", line("Karen Whitfield", "r-ridge")],
    ]);
  });

  it.each([
    ["Jack sets him paying eight days after day 2: it goes that day, and day 14's on its day", "2026-10-09", ["2026-10-09", "2026-10-13"]],
    ["nobody moves the stage: it goes once the close's three weeks are up", undefined, ["2026-10-22"]],
  ])("held by the close however long he takes to pay after his yes: %s", async (_, paying, on) => {
    let h = make();
    await shop(h);
    // the free round's last note went Sep 23: the close goes the day after Karen's hand-off
    await h.d.accounts.withAccount("ridge", (s) => {
      s.touches.push({ id: "t-last", opportunityId: "o-last", customerId: "c-r-ridge", channel: "email", step: 1, angle: "check_in", dueAt: "2026-09-23T08:00", sentAt: "2026-09-23T08:00:00", status: "sent", body: "", flags: [] });
    });
    await days(h, "2026-09-29", "2026-10-01");
    expect(h.d.accounts.repo.ownerMessages("ridge").find((m) => m.kind === "close")?.at.slice(0, 10)).toBe("2026-09-30");
    h.setNow("2026-10-01T20:00:00Z");
    expect(await h.sms("Yes")).toBe("Great — Jack will text you the payment link, and the next batch goes out next week.");
    await days(h, "2026-10-02", "2026-10-08");
    // a restart while it's held keeps it
    h = h.restart();
    open.push(h);
    if (paying) expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying" } })).status).toBe(200);
    await days(h, "2026-10-09", "2026-11-30");
    expect(checkIns(h).map((x) => [x.on, x.text])).toEqual(on.map((day) => [day, line("Karen Whitfield", "r-ridge")]));
  });

  it("with nothing else asked, NO answers it; a bare yes is asked for BOOKED and the code, and Jack reads it too", async () => {
    const h = make();
    await shop(h);
    await days(h, "2026-09-29", "2026-10-01");
    h.setNow("2026-10-01T20:00:00Z");
    expect(await h.sms("Yes")).toBe("Got it. About a lead? Text BOOKED + amount + the #code, DONE, or NO.");
    expect(h.d.accounts.peek("ridge")!.state.replies[0]).toMatchObject({ status: "handed_off" });
    expect(await h.sms("No")).toBe("Got it — Karen Whitfield marked not a fit.");
    expect(h.d.accounts.repo.ownerTexts("ridge", { open: true }).map((x) => x.body)).toEqual(["Yes"]);
    await days(h, "2026-10-02", "2026-11-30");
    expect(checkIns(h)).toHaveLength(1);
    // once he's said, a yes is just a yes again
    h.setNow("2026-11-30T20:00:00Z");
    await h.sms("Yes");
    expect(h.d.accounts.repo.ownerTexts("ridge", { open: true })).toHaveLength(1);
  });

  it("after DONE, a bare NO to it is about that lead however late it was asked: Jack reads it, and the reply gives the code", async () => {
    const h = make();
    await h.business("ridge");
    // handed over on a Saturday and reached that day: day 14 is a Saturday too, so it's asked on the Monday, 16 days on
    await addLead(h, "ridge", "r-sat", "Karen Whitfield", "2026-10-03T10:00:00");
    h.setNow("2026-10-03T18:00:00Z");
    expect(await h.sms(`DONE #${leadCode("r-sat")}`)).toBe("Thanks — Karen Whitfield marked as reached.");
    await days(h, "2026-10-04", "2026-10-19");
    expect(checkIns(h).map((x) => x.on)).toEqual(["2026-10-05", "2026-10-19"]);
    h.setNow("2026-10-19T20:00:00Z");
    expect(await h.sms("No")).toBe(`Is that about Karen Whitfield? To mark that lead not a fit, text NO #${leadCode("r-sat")}. Jack will read this too.`);
    expect(await h.sms("Yes")).toBe("Got it. About a lead? Text BOOKED + amount + the #code, DONE, or NO.");
    expect(h.d.accounts.repo.ownerTexts("ridge", { open: true }).map((x) => x.body)).toEqual(["Yes", "No"]);
    expect(h.d.accounts.peek("ridge")!.state.replies[0]!.outcome).toBeUndefined();
  });

  it("with the yearly plan sold, a renewal ask written the morning one is due holds it too", async () => {
    const h = make({ env: { FEATURE_YEARLY: "on" } });
    await shop(h);
    // the year ends Oct 31: the ask goes a month out, the morning of day 2
    await h.d.accounts.withAccount("ridge", (s) => {
      Object.assign(s.dataset.business.plan, { stage: "paying", billing: "annual", paidOn: "2025-10-31" });
    });
    await days(h, "2026-09-29", "2026-10-01");
    expect(h.d.accounts.repo.ownerMessages("ridge").find((m) => m.kind === "renewal")?.at.slice(0, 10)).toBe("2026-10-01");
    expect(checkIns(h)).toEqual([]);
    // he renews (Jack puts the year on the books): the one held up goes the next morning, and day 14's on its day
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.business.plan.yearsPaidOn = ["2025-10-31", "2026-10-31"];
    });
    await days(h, "2026-10-02", "2026-10-31");
    expect(checkIns(h).map((x) => x.on)).toEqual(["2026-10-02", "2026-10-13"]);
  });

  it("an owner whose other business has the close out gets none for this one either", async () => {
    const h = make();
    await shop(h);
    await h.business("pine", { name: "Tall Pine Tree" });
    await h.d.accounts.withAccount("pine", (s) => {
      s.ownerMessages.push({ id: "om-close-pine", at: "2026-09-28T09:30:00", kind: "close", text: "Your free round is done." });
    });
    await days(h, "2026-09-29", "2026-10-19");
    expect(checkIns(h)).toEqual([]);
    // three weeks on, the close is no longer what a yes answers: the one held for it goes (day 14's, as day 2's is past)
    await days(h, "2026-10-20", "2026-10-31");
    expect(checkIns(h).map((x) => x.on)).toEqual(["2026-10-20"]);
  });

  it("never about someone who said stop, or a lead the owner marked lost", async () => {
    const h = make();
    await shop(h);
    await addLead(h, "ridge", "r-lost", "Mike Sanderson", "2026-09-29T11:00:00", { outcome: "lost", status: "done", ownerContactedAt: "2026-09-29T15:00:00" });
    await h.d.accounts.withAccount("ridge", (s) => {
      s.suppressions["c-r-ridge@example.org"] = "unsubscribed";
    });
    await days(h, "2026-09-29", "2026-10-31");
    expect(checkIns(h)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

/** A Monday: the pass's first send day. */
const START = "2026-10-05";
const NAMES = ["Karen Whitfield", "Mike Sanderson", "Ann Lee"];

/** A tree shop's one pass that wrote to three people on Oct 5; Karen and Ann said yes on Oct 8. Its import address's token. */
async function pass(h: Harness): Promise<string> {
  const { importAddressToken } = (await h.business("ridge")) as { importAddressToken: string };
  expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "one_pass", stage: "running", targetEndOn: addDays(START, 30) } })).status).toBe(200);
  await h.d.accounts.withAccount("ridge", (s) => {
    s.dataset.customers = NAMES.map((name, i) => person(`c${i}`, name));
    s.dataset.business.plan.startedOn = START;
    s.touches = s.dataset.customers.map((c): Touch => ({ id: `t-${c.id}`, opportunityId: `o-${c.id}`, customerId: c.id, channel: "email", step: 1, angle: "check_in", dueAt: `${START}T08:00`, sentAt: `${START}T08:00:00`, status: "sent", body: "", flags: [] }));
    s.outreach = s.dataset.customers.map((c) => ({ customerId: c.id, opportunityId: `o-${c.id}`, firstTouchOn: START, lastTouchOn: START }));
    for (const cid of ["c0", "c2"])
      s.replies.push({ id: `r-${cid}`, customerId: cid, touchId: `t-${cid}`, channel: "email", receivedAt: "2026-10-08T10:00:00", handedOffAt: "2026-10-08T10:01:00", from: `${cid}@example.org`, text: "Yes please", intent: "wants_it", confidence: 0.95, extracted: {}, status: "handed_off" } satisfies Reply);
  });
  return importAddressToken;
}

/** Their export: each customer's job, made on its day. */
const jobs = (rows: [cid: string, made: string][]) => ({
  files: [{ name: "jobs.csv", text: `Job #,Client name,Client email,Title,Job status,Created date,Total\n${rows.map(([cid, made], i) => `${500 + i},${NAMES[Number(cid.slice(1))]},${cid}@example.org,Oak removal,Scheduled,${made},2400`).join("\n")}\n` }],
});
/** Jobber's Quotes report (each customer's quote approved on its day) and its Visits report (each one's visit done on its day). */
const reports = {
  quotes: (rows: [cid: string, approved: string][]) => ({
    name: "Quotes Report.csv",
    text: `Quote #,Client name,Client email,Title,Status,Sent date,Approved date,Total ($)\n${rows.map(([cid, on], i) => `${900 + i},${NAMES[Number(cid.slice(1))]},${cid}@example.org,Oak removal,Approved,2026-09-01,${on},2400`).join("\n")}\n`,
  }),
  visits: (rows: [cid: string, on: string][]) => ({
    name: "Visits Report.csv",
    text: `Job #,Date,Visit title,Client name,Client email,Visit completed,Visit based ($),Job type\n${rows.map(([cid, on], i) => `${700 + i},${on},Oak removal,${NAMES[Number(cid.slice(1))]},${cid}@example.org,Yes,2400.00,One-off`).join("\n")}\n`,
  }),
};
/** A file emailed to the owner's import address, as the inbound webhook brings it. */
const emailed = (h: Harness, token: string, f: { name: string; text: string }) =>
  h.app.request(`/webhooks/inbound-email/${WH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ MessageID: `m-${f.name}`, From: "dave@ridgelinetree.com", To: `import+${token}@in.qa.test`, Subject: "Export", TextBody: "", Attachments: [{ Name: f.name, Content: Buffer.from(f.text).toString("base64"), ContentType: "text/csv" }] }),
  });
/** Past customers who stopped coming over the last year, one a day: enough for the end text to offer monthly. */
const lapsed = (asOf: string): Opportunity[] =>
  Array.from({ length: 360 }, (_, i) => ({ id: `op-p${i}`, type: "lapsed_regular", customerId: `p${i}`, source: { kind: "job", id: `j-p${i}` }, value: 500, expectedValue: 100, recoverProbability: 0.2, score: 50, ageDays: 100, anchorDate: addDays(asOf, -i), reason: "", evidence: [], jobPhrase: "the job", serviceId: "tree.removal", seasonFit: "now", channels: ["email"] }));
const plan = (h: Harness) => h.d.accounts.peek("ridge")!.state.dataset.business.plan;
const moneyTexts = (h: Harness) => h.d.accounts.repo.ownerMessages("ridge").filter((m) => m.kind.startsWith("charge_"));

describe("the end of a one pass (BRIEF B6)", () => {
  it("the export ask goes out once, after the end text, and waits for Jack's OK like it", async () => {
    const h = make({ env: { AUTO_SEND_BILLING_TEXTS: "true" } });
    await pass(h);
    await days(h, "2026-11-09", "2026-11-16");
    const asks = h.d.accounts.repo.ownerMessages("ridge").filter((m) => m.kind === "export_ask");
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ delivery: "review", text: "Dave, one last thing: can you send me a fresh export of your jobs and quotes, the way you sent the first one? I'll check it against everyone who wrote back." });
    expect((await review(h)).filter((x) => x.kind === "owner_message").map((x) => x.messageKind).sort()).toEqual(["export_ask", "pass_end"]);
    // a restart, and the end marked again in Settings, ask nothing more
    const again = h.restart();
    open.push(again);
    expect((await again.api("PATCH", "/api/businesses/ridge", { plan: { stage: "running" } })).status).toBe(200);
    expect((await again.api("PATCH", "/api/businesses/ridge", { plan: { stage: "done" } })).status).toBe(200);
    await days(again, "2026-11-17", "2026-11-20");
    expect(again.d.accounts.repo.ownerMessages("ridge").filter((m) => m.kind === "export_ask")).toHaveLength(1);
    // Jack approves it, and it goes
    const sent = await again.api("POST", `/api/businesses/ridge/owner-messages/${asks[0]!.id}/send`);
    expect(sent.json).toMatchObject({ ok: true, delivery: "sent" });
  });

  it("the import after it lists the new billable bookings for Jack; no money text goes before he confirms, then B4's path", async () => {
    const h = make();
    await pass(h);
    await days(h, "2026-11-09", "2026-11-09");
    expect(plan(h)).toMatchObject({ stage: "done", endExport: { askedAt: "2026-11-09T10:00:00" } });
    h.setNow("2026-11-10T15:00:00Z");
    expect((await h.api("POST", "/api/businesses/ridge/imports", jobs([["c0", "2026-11-03"], ["c1", "2026-11-02"], ["c2", "2026-10-28"]]))).status).toBe(200);
    // Mike never wrote back: his job isn't one the pass bills
    const found = (await review(h)).filter((x) => x.kind === "booking_found");
    expect(found.map((x) => [x.name, x.code, x.on, x.value])).toEqual([
      ["Ann Lee", leadCode("r-c2"), "2026-10-28", 2400],
      ["Karen Whitfield", leadCode("r-c0"), "2026-11-03", 2400],
    ]);
    await days(h, "2026-11-10", "2026-11-12");
    expect(moneyTexts(h)).toEqual([]);
    expect(plan(h).charges ?? []).toEqual([]);
    // Jack confirms Ann's: its money text waits for his OK, as any booking's does
    expect((await h.api("POST", "/api/businesses/ridge/found/c2", { confirm: true })).json).toEqual({ ok: true });
    expect(moneyTexts(h).map((m) => [m.kind, m.delivery])).toEqual([["charge_link", "review"]]);
    expect(moneyTexts(h)[0]!.text).toMatch(/^Ann Lee booked \(#\w{3}\)\. That's your first \$250\./);
    expect((await review(h)).filter((x) => x.kind === "booking_found").map((x) => x.name)).toEqual(["Karen Whitfield"]);
    // decided once
    expect((await h.api("POST", "/api/businesses/ridge/found/c2", { confirm: false })).status).toBe(409);
  });

  it.each([
    ["to the import address, the Quotes report first", "quotes", "visits", "email"],
    ["to the import address, the Visits report first", "visits", "quotes", "email"],
    ["in the console, the Quotes report first", "quotes", "visits", "console"],
    ["in the console, the Visits report first", "visits", "quotes", "console"],
  ] as const)("the export as two files, %s: both files' bookings wait for Jack", async (_, first, second, via) => {
    const h = make();
    const token = await pass(h);
    await days(h, "2026-11-09", "2026-11-09");
    h.setNow("2026-11-10T15:00:00Z");
    const files = { quotes: reports.quotes([["c0", "2026-10-20"]]), visits: reports.visits([["c2", "2026-10-28"]]) };
    for (const f of [files[first], files[second]]) expect(via === "email" ? (await emailed(h, token, f)).status : (await h.api("POST", "/api/businesses/ridge/imports", { files: [f] })).status).toBe(200);
    expect((await review(h)).filter((x) => x.kind === "booking_found").map((x) => [x.name, x.on]).sort()).toEqual([
      ["Ann Lee", "2026-10-28"],
      ["Karen Whitfield", "2026-10-20"],
    ]);
    await days(h, "2026-11-10", "2026-11-12");
    expect(moneyTexts(h)).toEqual([]);
    expect(plan(h).charges ?? []).toEqual([]);
  });

  it("while the end text's offer to keep going monthly is out (or waits for Jack), no check-in and no export ask; after it, his Sure to the ask is no yes to monthly", async () => {
    const h = make();
    await pass(h);
    await h.d.accounts.withAccount("ridge", (s) => {
      s.scan = { opportunities: lapsed("2026-11-09"), primary: [], stats: { customers: 0, quotes: 0, jobs: 0, invoices: 0, requests: 0, suppressedBy: {} } };
    });
    // a late yes, handed over the morning the pass is done: its day 14 (Nov 23) is over a week before the offer closes
    await addLead(h, "ridge", "r-late", "Bob Ray", "2026-11-09T09:00:00");
    await days(h, "2026-11-09", "2026-11-09");
    const end = h.d.accounts.repo.ownerMessages("ridge").find((m) => m.kind === "pass_end")!;
    expect(end).toMatchObject({ delivery: "review", text: expect.stringContaining("enough to keep this going monthly") });
    await days(h, "2026-11-10", "2026-11-12");
    expect((await h.api("POST", `/api/businesses/ridge/owner-messages/${end.id}/send`)).json.ok).toBe(true);
    await days(h, "2026-11-13", "2026-11-30");
    expect(h.d.accounts.repo.ownerMessages("ridge").filter((m) => m.kind === "export_ask" || m.kind === "check_in")).toEqual([]);
    // his yes is the offer's: the only question out
    h.setNow("2026-11-20T20:00:00Z");
    expect(await h.sms("Sure")).toBe("Great. Jack will text you how it works.");
    // three weeks on, the offer has closed: the ask (for Jack's OK), and the check-in held for it
    await days(h, "2026-12-01", "2026-12-01");
    const ask = h.d.accounts.repo.ownerMessages("ridge").find((m) => m.kind === "export_ask")!;
    expect(ask.delivery).toBe("review");
    expect(checkIns(h).map((x) => [x.on, x.text])).toEqual([["2026-12-01", line("Bob Ray", "r-late")]]);
    expect((await h.api("POST", `/api/businesses/ridge/owner-messages/${ask.id}/send`)).json.ok).toBe(true);
    h.setNow("2026-12-01T20:00:00Z");
    expect(await h.sms("Sure, I'll send it tonight")).toBe("Thanks — Jack will read this and get back to you. For a lead, text BOOKED + amount + the #code, DONE, or NO. Text HELP for everything else.");
    const monthly = h.d.accounts.peek("ridge")!.state.events.filter((e) => e.title === "Dave wants to keep going monthly");
    expect(monthly).toHaveLength(1);
    expect(h.d.accounts.repo.ownerTexts("ridge").map((t) => t.handled)).toEqual(["unrecognized", "pass_monthly"]);
  });

  /** The pass's leads the owner reached on Oct 8, with no answer: no longer waiting on his call, nor told of lately. */
  const reached = (h: Harness, ids: string[]) =>
    h.d.accounts.withAccount("ridge", (s) => {
      for (const r of s.replies) if (ids.includes(r.id)) Object.assign(r, { status: "done", ownerContactedAt: "2026-10-08T15:00:00", outcome: "no_answer" });
    });
  const leads = (h: Harness) => h.d.accounts.peek("ridge")!.state.replies.map((r) => [r.id, r.status, r.outcome]);
  /** Jack lets the export ask written on the pass's last day go. */
  const sendAsk = async (h: Harness) => {
    const ask = h.d.accounts.repo.ownerMessages("ridge").find((m) => m.kind === "export_ask")!;
    expect((await h.api("POST", `/api/businesses/ridge/owner-messages/${ask.id}/send`)).json.ok).toBe(true);
  };
  const ASK_NO = "Got it — Jack will read this and get back to you. About a lead? Text NO and the #code.";

  it.each([
    ["Karen waiting on his call", ["r-c2"]],
    ["Karen and Ann both waiting", []],
    ["nobody waiting or told of lately", ["r-c0", "r-c2"]],
  ])("once the export ask has gone, a bare no or yes is its answer, never a lead's, and Jack reads it: %s", async (_, done) => {
    const h = make();
    await pass(h);
    await reached(h, done);
    await days(h, "2026-11-09", "2026-11-09");
    await sendAsk(h);
    const before = leads(h);
    h.setNow("2026-11-10T20:00:00Z");
    expect(await h.sms("No")).toBe(ASK_NO);
    expect(await h.sms("Yes")).toBe("Got it — Jack will read this and get back to you. About a lead? Text BOOKED + amount + the #code.");
    expect(leads(h)).toEqual(before);
    expect(h.d.accounts.repo.ownerTexts("ridge", { open: true }).map((t) => [t.body, t.handled])).toEqual([
      ["Yes", "export_yes"],
      ["No", "export_no"],
    ]);
  });

  it.each([
    ["an import is read", async (h: Harness) => void (await h.api("POST", "/api/businesses/ridge/imports", jobs([["c1", "2026-11-02"]])))],
    [
      "three weeks after it was written",
      async (h: Harness) => {
        h.setNow("2026-11-30T20:00:00Z");
        expect(await h.sms("No")).toBe(ASK_NO);
        h.setNow("2026-12-01T20:00:00Z");
      },
    ],
  ])("the export ask is out from when it goes until %s: then a bare no is the lead's again", async (_, close) => {
    const h = make();
    await pass(h);
    await reached(h, ["r-c2"]);
    await days(h, "2026-11-09", "2026-11-09");
    // waiting for Jack's OK, nothing's been asked: a yes is just a yes
    h.setNow("2026-11-09T20:00:00Z");
    expect(await h.sms("Yes")).toBe("Got it. About a lead? Text BOOKED + amount + the #code, DONE, or NO.");
    expect(h.d.accounts.repo.ownerTexts("ridge", { open: true })).toEqual([]);
    await sendAsk(h);
    h.setNow("2026-11-10T20:00:00Z");
    expect(await h.sms("No")).toBe(ASK_NO);
    await close(h);
    expect(await h.sms("No")).toBe("Got it — Karen Whitfield marked not a fit.");
    expect(leads(h)).toEqual([
      ["r-c0", "done", "lost"],
      ["r-c2", "done", "no_answer"],
    ]);
  });

  it("a yes with the export ask out and the close out on his other business could be either's: he's asked which", async () => {
    const h = make();
    await pass(h);
    await h.business("pine", { name: "Tall Pine Tree" });
    await days(h, "2026-11-09", "2026-11-09");
    await sendAsk(h);
    await h.d.accounts.withAccount("pine", (s) => {
      s.ownerMessages.push({ id: "om-close-pine", at: "2026-11-09T09:30:00", kind: "close", text: "Your free round is done." });
    });
    h.setNow("2026-11-10T20:00:00Z");
    expect(await h.sms("Yes")).toBe('This number runs Ridgeline Tree Co. and Tall Pine Tree. Which one? Text it again with the name, like "YES RIDGELINE" or "YES TALL".');
    expect(await h.sms("Yes tall")).toBe("Tall Pine Tree: Great — Jack will text you the payment link, and the next batch goes out next week.");
    expect(await h.sms("Yes ridgeline")).toBe("Ridgeline Tree Co.: Got it — Jack will read this and get back to you. About a lead? Text BOOKED + amount + the #code.");
  });

  it("one it brought past the cap isn't listed while the cap is full: once a refund frees a place, it waits for Jack like the rest", async () => {
    const h = make();
    await pass(h);
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { capBookings: 1 } })).status).toBe(200);
    await days(h, "2026-11-09", "2026-11-09");
    // Ann's booking, texted after the ask, takes B4's path; Jack was paid for it outside the software: the place is taken
    h.setNow("2026-11-09T20:00:00Z");
    expect(await h.sms(`BOOKED $2400 #${leadCode("r-c2")}`)).toMatch(/^Booked: Ann Lee, \$2,400\./);
    await days(h, "2026-11-10", "2026-11-10");
    expect((await h.api("POST", "/api/businesses/ridge/charges/paid", { customerId: "c2" })).status).toBe(200);
    // the export shows Karen's job: past the cap, so nothing for Jack yet
    await h.api("POST", "/api/businesses/ridge/imports", jobs([["c0", "2026-11-03"]]));
    expect(plan(h).endExport!.found!.map((f) => f.customerId)).toEqual(["c0"]);
    expect((await review(h)).filter((x) => x.kind === "booking_found")).toEqual([]);
    // the owner says Ann's wasn't ours, and Jack refunds it: Karen's has the place, once he confirms it
    expect(await h.sms(`NOT OURS #${leadCode("r-c2")}`)).toMatch(/was already charged, so Jack will look at it/);
    const ask = (await review(h)).find((x) => x.kind === "charge_ask")!;
    expect((await h.api("POST", `/api/businesses/ridge/charges/${ask.chargeId}/decide`, { refund: true })).json).toMatchObject({ done: "refunded", by: "hand" });
    expect((await review(h)).filter((x) => x.kind === "booking_found").map((x) => [x.name, x.code, x.on])).toEqual([["Karen Whitfield", leadCode("r-c0"), "2026-11-03"]]);
    await days(h, "2026-11-11", "2026-11-12");
    expect(plan(h).charges!.map((c) => [c.customerId, c.status])).toEqual([["c2", "refunded"]]);
  });

  it.each([
    ["Jack marks it paid outside the software", (h: Harness) => h.api("POST", "/api/businesses/ridge/charges/paid", { customerId: "c0" })],
    ["the owner texts NOT OURS", (h: Harness) => h.sms(`NOT OURS #${leadCode("r-c0")}`)],
  ])("one waiting leaves Needs a person once its customer has a charge: %s", async (_, charge) => {
    const h = make();
    await pass(h);
    await days(h, "2026-11-09", "2026-11-09");
    h.setNow("2026-11-10T15:00:00Z");
    await h.api("POST", "/api/businesses/ridge/imports", jobs([["c0", "2026-11-03"], ["c2", "2026-10-28"]]));
    const found = async () => (await review(h)).filter((x) => x.kind === "booking_found").map((x) => x.name);
    expect(await found()).toEqual(["Ann Lee", "Karen Whitfield"]);
    await charge(h);
    expect(plan(h).charges!.map((c) => c.customerId)).toEqual(["c0"]);
    expect(await found()).toEqual(["Ann Lee"]);
  });

  it("one Jack rejects never bills, whatever comes in after", async () => {
    const h = make();
    await pass(h);
    await days(h, "2026-11-09", "2026-11-09");
    h.setNow("2026-11-10T15:00:00Z");
    await h.api("POST", "/api/businesses/ridge/imports", jobs([["c0", "2026-11-03"]]));
    expect((await h.api("POST", "/api/businesses/ridge/found/c0", { confirm: false })).json).toEqual({ ok: true });
    expect((await review(h)).filter((x) => x.kind === "booking_found")).toEqual([]);
    expect(plan(h).charges).toMatchObject([{ customerId: "c0", status: "skipped", reason: "Not confirmed from the export at the pass's end" }]);
    // the same job in a later export, and the owner's BOOKED for her: still nothing to pay
    h.setNow("2026-11-16T15:00:00Z");
    await h.api("POST", "/api/businesses/ridge/imports", jobs([["c0", "2026-11-03"]]));
    expect(await h.sms(`BOOKED $2400 #${leadCode("r-c0")}`)).toMatch(/^Booked: Karen Whitfield, \$2,400\./);
    await days(h, "2026-11-16", "2026-11-20");
    expect(moneyTexts(h)).toEqual([]);
    expect(plan(h).charges!.map((c) => c.status)).toEqual(["skipped"]);
  });
});
