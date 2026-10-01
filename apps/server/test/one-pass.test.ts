import { afterEach, describe, expect, it } from "vitest";
import { addDays, dueTouches, monthName, NOTES_SPAN_DAYS, type AccountState, type BusinessProfile, type Quote, type Touch } from "@qa/engine";
import { deliverOwnerMessages, sendDue, syncSequencer } from "../src/core/ops.ts";
import { holdsInboxes } from "../src/core/senders.ts";
import type { LogEmailProvider } from "../src/providers/email.ts";
import { runTasks, tick } from "../src/core/worker.ts";
import { createInstantlyProvider, type InstantlyProvider } from "../src/integrations/instantly/index.ts";
import { lateLine, planRequest } from "../../web/src/live/planning.ts";
import { diff } from "../../web/src/live/settings.ts";
import { fakeInstantly } from "./fake-instantly.ts";
import { addLead, harness, person, type Harness } from "./harness.ts";

/**
 * BRIEF B3: the one pass. A plan kind of its own with its own stages, the whole list once paced from its end date on
 * its inboxes, its own welcome and end texts, and none of the monthly plan's free round, top-ups, rescans or billing.
 */

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

function make(env: Record<string, string> = {}, email?: InstantlyProvider): Harness {
  const h = harness({ env, email });
  open.push(h);
  return h;
}

const inboxes = (n: number) => Array.from({ length: n }, (_, i) => `sarah${i}@ridgeline-mail.com`);
const profile = (h: Harness, bid: string): BusinessProfile => h.d.accounts.peek(bid)!.state.dataset.business;
const review = async (h: Harness) => (await h.api("GET", "/api/review")).json.items as { kind: string; alertKind?: string; businessId: string; title?: string; detail?: string; messageKind?: string; messageId?: string }[];

/** Someone we can write to (the harness's people have placeholder addresses). */
const homeowner = (id: string, name: string) => ({ ...person(id, name), emails: [`${id}@gmail.com`] });

/** A quote nobody answered, the `i`th newest: a month old and a day older each. */
function quote(customerId: string, i: number): Quote {
  return { id: `q${i}`, customerId, title: "Crown thinning, 3 maples", lineItems: [], total: 1500, status: "awaiting_response", rawStatus: "Awaiting response", sentOn: addDays("2026-09-29", -30 - i), jobIds: [] };
}

/** A tree shop on a one pass: `people` old quotes, `n` inboxes of its own, an account that says to hold back 10%. */
async function pass(h: Harness, bid: string, people: number, n: number): Promise<void> {
  await h.business(bid, { fromEmails: inboxes(n) });
  await h.d.accounts.withAccount(bid, (s) => {
    s.dataset.customers = Array.from({ length: people }, (_, i) => homeowner(`${bid}-c${i}`, `Person ${i}`));
    s.dataset.quotes = s.dataset.customers.map((c, i) => quote(c.id, i));
  });
  expect((await h.api("PATCH", `/api/businesses/${bid}`, { plan: { kind: "one_pass", stage: "running" }, persistence: { holdoutPct: 0.1 } })).status).toBe(200);
  await h.api("POST", `/api/businesses/${bid}/scan`);
}

/** A client's notes to go or gone, by day. */
function notesByDay(h: Harness, bid: string): Record<string, number> {
  const n: Record<string, number> = {};
  for (const t of h.d.accounts.peek(bid)!.state.touches) if (t.status !== "cancelled") n[t.dueAt.slice(0, 10)] = (n[t.dueAt.slice(0, 10)] ?? 0) + 1;
  return n;
}
const firsts = (h: Harness, bid: string) => h.d.accounts.peek(bid)!.state.touches.filter((t) => t.step === 1 && t.status !== "cancelled");
const lastFirst = (h: Harness, bid: string) => firsts(h, bid).map((t) => t.dueAt.slice(0, 10)).sort().pop()!;

describe("the one pass in the operator API", () => {
  it("takes the one pass's kind, terms and stages, and refuses a stage that doesn't belong to the kind", async () => {
    const h = make();
    await h.business("ridge");
    // a monthly plan is never done, and a one pass is never in a free round or paying
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "done" } })).json.error).toBe("A monthly plan is in its free round, paying, paused or cancelled: “done” isn't one of its stages.");
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "one_pass" } })).status).toBe(400);
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "one_pass", stage: "running" } })).status).toBe(200);
    expect(profile(h, "ridge").plan).toMatchObject({ kind: "one_pass", stage: "running", pricePerBooking: 250, capBookings: 4, windowDays: 60, freeFirst: 0 });
    const paying = await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying" } });
    expect(paying.status).toBe(400);
    expect(paying.json.error).toBe("A one pass runs, is done, is paused or is cancelled: “paying” isn't one of its stages.");
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { freeFirst: 150, targetEndOn: "2026-11-20", pricePerBooking: 250, capBookings: 4, windowDays: 60 } })).status).toBe(200);
    expect(profile(h, "ridge").plan).toMatchObject({ freeFirst: 150, targetEndOn: "2026-11-20" });
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { capBookings: 0 } })).status).toBe(400);
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "monthly", stage: "trial", trialSize: 150, monthlyPrice: 497 } })).status).toBe(200);
    expect(profile(h, "ridge").plan.kind).toBe("monthly");
  });

  it("a sign-up from a one-pass page gets a one pass that hasn't started, and its file can still follow it in", async () => {
    const h = make();
    const form = { company: "Tall Pine Tree", first: "Ryan", cell: "603-555-0123", consent: true, offer: "one_pass" };
    const first = await h.api("POST", "/start", form, { auth: false });
    const bid = first.json.id as string;
    expect(profile(h, bid).plan).toMatchObject({ kind: "one_pass", stage: "running", pricePerBooking: 250, capBookings: 4 });
    expect(profile(h, bid).plan.startedOn).toBeUndefined();
    expect(profile(h, bid).plan.targetEndOn).toBeUndefined();
    // an untouched one pass takes the owner's file from a second Start, and is ready to plan
    const csv = ["Client name,Email,Quote #,Title,Total,Status,Sent", ...Array.from({ length: 5 }, (_, i) => `Pat Lee ${i},pat${i}@gmail.com,${100 + i},Oak removal,1800,Awaiting response,2026-0${3 + i}-10`)].join("\n");
    await h.api("POST", "/start", { ...form, files: [{ name: "quotes.csv", text: csv }] }, { auth: false });
    expect(h.d.accounts.peek(bid)!.state.dataset.quotes.length).toBe(5);
    expect((await review(h)).some((x) => x.kind === "ready" && x.businessId === bid)).toBe(true);
    // a monthly page's sign-up is the free round, as before
    const monthly = await h.api("POST", "/start", { ...form, company: "Capital City Landscaping", cell: "603-555-0124", offer: "monthly" }, { auth: false });
    expect(profile(h, monthly.json.id as string).plan).toEqual({ stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [] });
  });
});

describe("a 600-person one pass", () => {
  it("on five inboxes: the whole list after the owner's OK, its last first note 12 days before the end; no holdout, rescan or top-up", { timeout: 120_000 }, async () => {
    const h = make();
    await pass(h, "ridge", 600, 5);
    const r = await h.api("POST", "/api/businesses/ridge/plan", planRequest(profile(h, "ridge")));
    // no 150 limit, and the first note waits for the owner's OK
    expect(r.json).toMatchObject({ people: 600, awaitingOk: true, textSent: true });
    expect(r.json.late).toBeUndefined();
    const plan = profile(h, "ridge").plan;
    expect(plan.startedOn).toBe("2026-09-30");
    expect(plan.targetEndOn).toBe("2026-10-30");
    expect(lastFirst(h, "ridge") <= addDays(plan.targetEndOn!, -NOTES_SPAN_DAYS)).toBe(true);
    const state = h.d.accounts.peek("ridge")!.state;
    expect(state.touches.every((t) => t.status === "planned")).toBe(true);
    expect(state.outreach.filter((o) => o.holdout)).toEqual([]);
    expect((await review(h)).filter((x) => x.alertKind === "pace")).toEqual([]);
    const welcome = h.d.accounts.repo.ownerMessages("ridge").find((m) => m.kind === "kickoff")!.text;
    expect(welcome).toContain("You pay $250 for each job that books, never more than $1,000. Nothing books, you owe nothing.");
    expect(welcome).not.toMatch(/497|free/i);
    expect(await h.sms("OK")).toContain("Done — the first notes go out");
    expect(h.d.accounts.peek("ridge")!.state.touches.every((t) => t.status === "approved")).toBe(true);
    // more people turn up in a later file: no nightly top-up plans them (a paying monthly plan would); and someone written
    // to long ago stays off the list after the nightly scan (a monthly list takes them back after 150 days)
    await h.d.accounts.withAccount("ridge", (s) => {
      s.outreach.push({ customerId: "ridge-c0", firstTouchOn: "2026-03-02", lastTouchOn: "2026-03-02" });
      const more = Array.from({ length: 20 }, (_, i) => homeowner(`ridge-new${i}`, `New ${i}`));
      s.dataset.customers = [...s.dataset.customers, ...more];
      s.dataset.quotes = [...s.dataset.quotes, ...more.map((c, i) => quote(c.id, 700 + i))];
    });
    h.setNow("2026-10-01T07:30:00Z"); // 3:30am in New Hampshire
    expect((await tick(h.d)).planned).toBe(0);
    expect(new Set(firsts(h, "ridge").map((t) => t.customerId)).size).toBe(600);
    expect(h.d.accounts.peek("ridge")!.state.scan!.opportunities.find((o) => o.customerId === "ridge-c0")!.suppressed).toBe("recently_contacted");
    expect(h.d.accounts.repo.mark("ridge", "nightly")).toBe("2026-10-01");
  });

  it("on three inboxes: the 'date can't be met' alert names the date it can meet and the inboxes that would meet the first", { timeout: 120_000 }, async () => {
    const h = make();
    await pass(h, "ridge", 600, 3);
    const r = await h.api("POST", "/api/businesses/ridge/plan", {});
    expect(r.json.people).toBe(600);
    const { canMeet, moreInboxes } = r.json.late as { canMeet: string; moreInboxes: number };
    expect(canMeet > "2026-10-30").toBe(true);
    expect(moreInboxes).toBeGreaterThan(0);
    expect(profile(h, "ridge").plan.pace).toMatchObject({ inboxes: 3, endOn: "2026-10-30", late: { canMeet, moreInboxes } });
    // planned to the date it can meet, with nobody held back
    expect(lastFirst(h, "ridge") <= addDays(canMeet, -NOTES_SPAN_DAYS)).toBe(true);
    expect(h.d.accounts.peek("ridge")!.state.outreach.filter((o) => o.holdout)).toEqual([]);
    const alerts = (await review(h)).filter((x) => x.alertKind === "pace");
    expect(alerts).toHaveLength(1);
    const day = `${monthName(canMeet).slice(0, 3)} ${Number(canMeet.slice(8))}`;
    expect(alerts[0]!.title).toBe("Ridgeline Tree Co.: the pass can't finish by Oct 30 on 3 inboxes");
    const more = moreInboxes === 1 ? "1 more inbox" : `${moreInboxes} more inboxes`;
    expect(alerts[0]!.detail).toBe(`It's planned to finish by ${day}, the soonest they can do it at 30 a day each. ${more} would finish it by Oct 30: add them in Settings and plan again before the owner's OK. Or set the end date to ${day}.`);
    // the inboxes come, and Jack plans again before the owner's OK: paced again, on time, and the alert is closed
    await h.api("PATCH", "/api/businesses/ridge", { fromEmails: inboxes(3 + moreInboxes) });
    const again = await h.api("POST", "/api/businesses/ridge/plan", {});
    expect(again.json).toMatchObject({ people: 600, awaitingOk: true, textSent: true });
    expect(again.json.late).toBeUndefined();
    expect(lastFirst(h, "ridge") <= "2026-10-18").toBe(true);
    expect((await review(h)).filter((x) => x.alertKind === "pace")).toEqual([]);
  });
});

describe("a 600-person one pass the server sends itself", () => {
  it("goes from each of its inboxes in turn, none over 30 a day, and a person's notes from one inbox while it has room", { timeout: 120_000 }, async () => {
    const h = make();
    const log = h.d.email as LogEmailProvider;
    await pass(h, "ridge", 600, 5);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    await h.sms("OK");
    const planned = notesByDay(h, "ridge");
    // its first four send days at 9:59am there: everything due goes, follow-ups on Monday
    const sent = new Map<string, Map<string, number>>();
    for (const day of ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05"]) {
      h.setNow(`${day}T13:59:00Z`);
      const before = log.sent.length;
      await sendDue(h.d, "ridge", { maxPerTick: 1000 });
      const by = new Map<string, number>();
      for (const m of log.sent.slice(before)) by.set(m.fromEmail!, (by.get(m.fromEmail!) ?? 0) + 1);
      sent.set(day, by);
      expect(log.sent.length - before).toBe(planned[day]);
      // from one inbox, a day's notes would be up to five times its 30
      expect([...by.values()].every((n) => n <= 30)).toBe(true);
    }
    expect(Math.max(...[...sent.keys()].map((d) => planned[d]!))).toBeGreaterThan(4 * 30);
    expect(new Set([...sent.values()].flatMap((by) => [...by.keys()]))).toEqual(new Set(inboxes(5)));
    // each note says the inbox it went from; a follow-up goes from its note 1's unless that one was full that day
    const state = h.d.accounts.peek("ridge")!.state;
    const firstFrom = new Map(state.touches.filter((t) => t.step === 1).map((t) => [t.customerId, t.fromEmail]));
    const followUps = state.touches.filter((t) => t.step > 1 && t.status === "sent");
    expect(followUps.length).toBeGreaterThan(0);
    for (const t of followUps) if (t.fromEmail !== firstFrom.get(t.customerId)) expect(sent.get(t.sentAt!.slice(0, 10))!.get(firstFrom.get(t.customerId)!)).toBe(30);
    expect(log.sent.every((m) => m.fromEmail === state.touches.find((t) => t.id === m.touchId)!.fromEmail)).toBe(true);
  });
});

/** A small pass planned, OK'd and every note out by `lastOn`. */
async function sentPass(h: Harness, bid: string, lastOn: string): Promise<void> {
  await pass(h, bid, 5, 1);
  await h.api("POST", `/api/businesses/${bid}/plan`, {});
  await h.d.accounts.withAccount(bid, (s) => {
    s.awaitingOwnerOk = undefined;
    for (const t of s.touches) Object.assign(t, { status: "sent", sentAt: `${lastOn}T08:00:00` } satisfies Partial<Touch>);
  });
}

describe("the end of a one pass", () => {
  it("the worker ends it when the list is done: the end text waits for Jack (even with billing texts on auto) and never mentions $497", async () => {
    const h = make({ AUTO_SEND_BILLING_TEXTS: "true" });
    await sentPass(h, "ridge", "2026-10-28");
    h.setNow("2026-10-30T13:30:00Z");
    await tick(h.d);
    expect(profile(h, "ridge").plan.stage).toBe("running");
    h.setNow("2026-10-31T13:30:00Z"); // the end date gone by, 9:30am there
    await tick(h.d);
    expect(profile(h, "ridge").plan).toMatchObject({ stage: "done", doneOn: "2026-10-31" });
    const end = (await review(h)).find((x) => x.kind === "owner_message" && x.messageKind === "pass_end")!;
    expect(end).toBeDefined();
    const text = h.d.accounts.repo.ownerMessages("ridge").find((m) => m.kind === "pass_end")!.text;
    expect(text.split("\n")[0]).toBe("Dave, your list is done. Asked 5, 0 wrote back, 0 wanted the work, 0 booked.");
    expect(text).toContain("I'll check back next season.");
    expect(text).not.toMatch(/497|free/i);
    // nothing else of the monthly plan's: no free-round close, no billing text
    expect(h.d.accounts.repo.ownerMessages("ridge").filter((m) => ["close", "precharge", "free_month"].includes(m.kind))).toEqual([]);
    await deliverOwnerMessages(h.d, "ridge");
    expect(h.d.accounts.repo.ownerMessages("ridge", { delivery: "review" }).map((m) => m.kind)).toEqual(["pass_end"]);
    // Jack approves it, and it goes
    const sent = await h.api("POST", `/api/businesses/ridge/owner-messages/${end.messageId}/send`);
    expect(sent.json.ok).toBe(true);
  });

  it("nothing sends after it's done, and no Friday report", async () => {
    const h = make();
    await sentPass(h, "ridge", "2026-10-20");
    h.setNow("2026-10-31T13:30:00Z");
    await tick(h.d);
    expect(profile(h, "ridge").plan.stage).toBe("done");
    // a note left approved somehow, to someone not written to yet
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.customers.push(homeowner("ridge-late", "Late Person"));
      s.touches.push({ ...s.touches[0]!, id: "late-1", customerId: "ridge-late", opportunityId: "o-late", status: "approved", sentAt: undefined, chases: undefined, dueAt: "2026-11-09T08:00" });
    });
    h.setNow("2026-11-06T21:30:00Z"); // Friday, 4:30pm there (EST from Nov 1)
    await tick(h.d);
    expect(h.d.accounts.peek("ridge")!.state.ownerMessages.filter((m) => m.kind === "weekly" && m.at >= "2026-11")).toEqual([]);
    // never goes, even inside the send window
    h.setNow("2026-11-09T13:30:00Z"); // Monday, 8:30am there
    expect((await sendDue(h.d, "ridge")).sent).toBe(0);
    expect(h.d.accounts.peek("ridge")!.state.touches.find((t) => t.id === "late-1")!.status).toBe("approved");
  });

  it("marked done in Settings: whatever's queued stops, the end text waits for Jack, and RESUME doesn't start it again", async () => {
    const h = make();
    await pass(h, "ridge", 5, 1);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "done" } })).status).toBe(200);
    const s = h.d.accounts.peek("ridge")!.state;
    expect(s.touches.filter((t) => t.status === "planned" || t.status === "approved")).toEqual([]);
    expect(s.awaitingOwnerOk).toBeUndefined();
    expect(s.ownerMessages.filter((m) => m.kind === "pass_end")).toHaveLength(1);
    expect(h.d.accounts.peek("ridge")!.paused).toBe(false);
    expect((await h.api("POST", "/api/businesses/ridge/pause", { paused: false })).json.held).toBe("plan_done");
    expect(await h.sms("RESUME")).toBe("Your list is done, so there's nothing left to send. Jack will read this too.");
    // planning a finished pass is refused
    expect((await h.api("POST", "/api/businesses/ridge/plan", {})).status).toBe(409);
  });

  it.each([
    ["done", "after the owner's OK"],
    ["cancelled", "after the owner's OK"],
    ["cancelled", "before the owner's OK"],
  ])("marked %s in Settings %s, with an end date it misses in the same save: no alert, and nothing planned again", async (stage, when) => {
    const h = make();
    await pass(h, "ridge", 5, 1);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    if (when.startsWith("after")) await h.sms("OK");
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage, targetEndOn: "2026-10-02" } })).status).toBe(200);
    const s = h.d.accounts.peek("ridge")!.state;
    expect(s.touches.filter((t) => t.status === "planned" || t.status === "approved")).toEqual([]);
    expect(h.d.accounts.repo.openAlerts("ridge").filter((a) => a.kind === "pace")).toEqual([]);
    expect(h.d.accounts.repo.ownerMessages("ridge").filter((m) => m.kind === "kickoff")).toHaveLength(1);
  });

  it("cancelled by text, its \"can't finish by\" alert is closed too", async () => {
    const h = make();
    await pass(h, "ridge", 5, 1);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    await h.sms("OK");
    h.d.accounts.repo.addAlert({ businessId: "ridge", at: h.now().toISOString(), kind: "pace", title: "Ridgeline Tree Co.: the pass can't finish by Oct 30 on 1 inbox", detail: "…" });
    expect(await h.sms("CANCEL")).toContain("Done — cancelled.");
    expect(h.d.accounts.repo.openAlerts("ridge")).toEqual([]);
  });

  it("lets its inboxes go the way a cancel does: another client may have them, and its inbox check and alert are cleared", async () => {
    const h = make();
    await pass(h, "ridge", 5, 2);
    await h.business("pine", { name: "Tall Pine Tree" });
    // while the pass runs, its inboxes are its own
    expect((await h.api("PATCH", "/api/businesses/pine", { fromEmails: [inboxes(1)[0]] })).status).toBe(409);
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.business.senders = { key: "k", at: "2026-09-29T10:00:00", refused: "sarah0@ridgeline-mail.com reads “Jack Philbrick” in Instantly, not “Sarah at Ridgeline Tree Co.”" };
    });
    h.d.accounts.repo.addAlert({ businessId: "ridge", at: h.now().toISOString(), kind: "senders", title: "Ridgeline Tree Co.: nothing goes out until its inboxes are fixed", detail: "…" });
    h.d.accounts.repo.addAlert({ businessId: "ridge", at: h.now().toISOString(), kind: "pace", title: "Ridgeline Tree Co.: the pass can't finish by Oct 30 on 2 inboxes", detail: "…" });
    expect(holdsInboxes(profile(h, "ridge"))).toBe(true);
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "done" } });
    expect(holdsInboxes(profile(h, "ridge"))).toBe(false);
    expect(profile(h, "ridge").senders).toBeUndefined();
    // nor is there an end date left to meet
    expect(h.d.accounts.repo.openAlerts("ridge")).toEqual([]);
    expect((await h.api("PATCH", "/api/businesses/pine", { fromEmails: [inboxes(1)[0]] })).status).toBe(200);
  });
});

/** An Instantly that keeps the campaigns made in it and the leads in them (`dailyLimit`: the server's INSTANTLY_DAILY_LIMIT). */
function instantly(opts: { dailyLimit?: number } = {}) {
  const campaigns = new Map<string, { name: string; steps: number; status: number }>();
  const leads = new Map<string, { id: string; email: string; campaign: string }>();
  const id = (path: string) => decodeURIComponent(path.split("/")[2]!);
  const set = (path: string, status: number) => {
    campaigns.get(id(path))!.status = status;
    return { body: { status } };
  };
  const api = fakeInstantly({
    "GET /campaigns": (c) => ({ body: { items: [...campaigns].filter(([, x]) => x.name === c.query.search).map(([cid, x]) => ({ id: cid, name: x.name, status: x.status })) } }),
    "POST /campaigns": (c) => {
      const cid = `camp-${campaigns.size + 1}`;
      campaigns.set(cid, { name: c.body.name, steps: c.body.sequences[0].steps.length, status: 0 });
      return { body: { id: cid, status: 0 } };
    },
    "GET /campaigns/:id": (c) => {
      const x = campaigns.get(id(c.path))!;
      return { body: { id: id(c.path), status: x.status, sequences: [{ steps: Array.from({ length: x.steps }, () => ({ type: "email" })) }] } };
    },
    "POST /campaigns/:id/activate": (c) => set(c.path, 1),
    "POST /campaigns/:id/pause": (c) => set(c.path, 2),
    "POST /leads/add": (c) => {
      const created = (c.body.leads as { email: string }[]).map((l, index) => {
        const lid = `lead-${c.body.campaign_id}-${l.email}`;
        leads.set(lid, { id: lid, email: l.email, campaign: c.body.campaign_id });
        return { index, id: lid, email: l.email };
      });
      return { body: { leads_uploaded: created.length, created_leads: created } };
    },
    "POST /leads/list": (c) => ({ body: { items: [...leads.values()].filter((l) => l.campaign === c.body.campaign && (c.body.contacts as string[]).includes(l.email)) } }),
    "DELETE /leads/:id": (c) => {
      leads.delete(id(c.path));
      return { body: {} };
    },
    "GET /emails": () => ({ body: { items: [] } }),
    "GET /webhooks": () => ({ body: { items: [] } }),
  });
  return { api, campaigns, leads, email: createInstantlyProvider({ apiKey: "k", fetch: api.fetch, sleep: async () => {}, maxRetries: 0, ...opts }) };
}

describe("a one pass on Instantly, once it's done", () => {
  /**
   * A five-person pass the owner said OK to, every person's notes handed to Instantly on their first note's day (the
   * next morning), and an inbox alert and a "can't finish by" alert open.
   */
  async function handedOver(h: Harness, email: InstantlyProvider): Promise<void> {
    await pass(h, "ridge", 5, 1);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    await h.sms("OK");
    h.setNow("2026-09-30T10:00:00Z"); // 6am there
    await syncSequencer(h.d, "ridge", email);
    expect(profile(h, "ridge").senders).toBeDefined();
    h.d.accounts.repo.addAlert({ businessId: "ridge", at: h.now().toISOString(), kind: "senders", title: "Ridgeline Tree Co.: nothing goes out until its inboxes are fixed", detail: "…" });
    h.d.accounts.repo.addAlert({ businessId: "ridge", at: h.now().toISOString(), kind: "pace", title: "Ridgeline Tree Co.: the pass can't finish by Oct 30 on 1 inbox", detail: "…" });
  }
  const statuses = (f: ReturnType<typeof instantly>) => [...f.campaigns.values()].map((x) => x.status);
  const cleared = (h: Harness) => {
    expect(profile(h, "ridge").senders).toBeUndefined();
    expect(h.d.accounts.repo.openAlerts("ridge").map((a) => a.kind)).toEqual([]);
  };

  it("marked done in Settings: its campaigns are paused, the leads still waiting taken back, and they stay paused", async () => {
    const f = instantly();
    const h = make({}, f.email);
    await handedOver(h, f.email);
    expect(statuses(f)).toEqual([1]);
    expect(f.leads.size).toBeGreaterThan(0);
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "done" } });
    expect(statuses(f)).toEqual([2]);
    cleared(h);
    await runTasks(h.d);
    expect(f.leads.size).toBe(0);
    // the next minutes never turn them back on
    await syncSequencer(h.d, "ridge", f.email);
    h.setNow("2026-09-30T13:00:00Z");
    await tick(h.d);
    expect(statuses(f)).toEqual([2]);
  });

  it("ended by the worker once the list is done: the same tick pauses its campaigns and clears its inbox check and alert", async () => {
    const f = instantly();
    const h = make({}, f.email);
    await handedOver(h, f.email);
    await h.d.accounts.withAccount("ridge", (s) => {
      for (const t of s.touches) Object.assign(t, { status: "sent", sentAt: "2026-10-02T08:00:00" } satisfies Partial<Touch>);
    });
    h.setNow("2026-10-09T13:30:00Z"); // a week after the last note, 9:30am there
    await tick(h.d);
    expect(profile(h, "ridge").plan.stage).toBe("done");
    expect(statuses(f)).toEqual([2]);
    cleared(h);
    h.setNow("2026-10-09T13:31:00Z");
    await tick(h.d);
    await syncSequencer(h.d, "ridge", f.email);
    expect(statuses(f)).toEqual([2]);
  });
});

describe("a one pass's pace in Instantly", () => {
  it("its campaign and inboxes carry the pace as it is (30 a day each, its busiest day of new people) whatever the server's limit, and each person goes on their day", { timeout: 120_000 }, async () => {
    const f = instantly({ dailyLimit: 40 });
    const h = make({}, f.email);
    await pass(h, "ridge", 600, 5);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    await h.sms("OK");
    h.setNow("2026-09-30T10:00:00Z"); // its first send day, 6am there
    await syncSequencer(h.d, "ridge", f.email);
    const byDay = new Map<string, number>();
    for (const t of firsts(h, "ridge")) byDay.set(t.dueAt.slice(0, 10), (byDay.get(t.dueAt.slice(0, 10)) ?? 0) + 1);
    const { dailyNew } = profile(h, "ridge").plan.pace!;
    expect(dailyNew).toBe(Math.max(...byDay.values()));
    // any other client's new people a day would be halved under the server's 40
    expect(dailyNew).toBeGreaterThanOrEqual(40);
    expect(f.api.callsTo("POST", "/campaigns").map((c) => [c.body.daily_limit, c.body.daily_max_leads])).toEqual([[150, dailyNew]]);
    for (const inbox of inboxes(5)) expect(f.api.inbox(inbox).daily_limit).toBe(30);
    // the monthly plan's weekly pace is left as it was
    expect(profile(h, "ridge").weeklyNewContacts).toBe(75);
    // nobody reaches Instantly ahead of their first note's day, so it never starts more than the day's people
    const due = (on: string) => firsts(h, "ridge").filter((t) => t.dueAt.slice(0, 10) <= on).length;
    expect(f.leads.size).toBe(due("2026-09-30"));
    h.setNow("2026-10-01T10:00:00Z");
    await syncSequencer(h.d, "ridge", f.email);
    expect(f.leads.size).toBe(due("2026-10-01"));
    expect(due("2026-10-01")).toBeLessThan(600);
  });

  it("an inbox whose daily limit doesn't read back at 30 is refused, as a name that doesn't is", async () => {
    const f = instantly();
    const h = make({}, f.email);
    Object.assign(f.api.inbox(inboxes(1)[0]!), { daily_limit: 50, keepsLimit: true });
    await pass(h, "ridge", 5, 1);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    await h.sms("OK");
    h.setNow("2026-09-30T10:00:00Z");
    await syncSequencer(h.d, "ridge", f.email);
    expect(profile(h, "ridge").senders?.refused).toBe("sarah0@ridgeline-mail.com's daily limit reads 50 in Instantly, not the 30 this pass is paced on");
    expect(f.leads.size).toBe(0);
  });

  it("back on monthly after a pass, the Plan button asks for four weeks of the weekly pace it had", { timeout: 120_000 }, async () => {
    const h = make();
    await pass(h, "ridge", 600, 5);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "monthly", stage: "paying", trialSize: 150, monthlyPrice: 497 } })).status).toBe(200);
    expect(planRequest(profile(h, "ridge"))).toEqual({ limit: 300 });
  });
});

describe("the one pass's owner texts", () => {
  it("a paying monthly plan made a one pass: its Friday text says nothing of the monthly fees, and the overview has no monthly promise", async () => {
    const h = make();
    await h.business("ridge", { fromEmails: inboxes(1) });
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", paidOn: "2026-08-03" } })).status).toBe(200);
    expect((await h.api("GET", "/api/businesses/ridge")).json.guarantee).toBeDefined();
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.customers = Array.from({ length: 5 }, (_, i) => homeowner(`ridge-c${i}`, `Person ${i}`));
      s.dataset.quotes = s.dataset.customers.map((c, i) => quote(c.id, i));
    });
    // as Settings saves it: the kind and the pass's stage, over the plan it was (its first paid day kept)
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "one_pass", stage: "running" } })).status).toBe(200);
    expect(profile(h, "ridge").plan).toMatchObject({ kind: "one_pass", paidOn: "2026-08-03", monthlyPrice: 497 });
    expect((await h.api("GET", "/api/businesses/ridge")).json.guarantee).toBeUndefined();
    await h.api("POST", "/api/businesses/ridge/scan");
    await h.api("POST", "/api/businesses/ridge/plan", {});
    await h.sms("OK");
    await h.d.accounts.withAccount("ridge", (s) => {
      for (const t of s.touches) if (t.step === 1) Object.assign(t, { status: "sent", sentAt: `${t.dueAt}:00` } satisfies Partial<Touch>);
    });
    h.setNow("2026-10-02T20:30:00Z"); // Friday, 4:30pm there
    await tick(h.d);
    const weekly = h.d.accounts.repo.ownerMessages("ridge").find((m) => m.kind === "weekly")!.text;
    // where a monthly plan's "You've paid us $994" would follow
    expect(weekly.split("\n").at(-1)).toMatch(/^Since you started: 0 booked, \$0\./);
    expect(weekly).not.toMatch(/paid us|497|994/);
  });

  it("MONTHLY after the pass goes to Jack: nothing changes on a text alone, and no $497", async () => {
    const h = make();
    await pass(h, "ridge", 5, 1);
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "done" } });
    const reply = await h.sms("Monthly");
    expect(reply).toBe("Great. Jack will text you how it works.");
    expect(profile(h, "ridge").plan).toMatchObject({ kind: "one_pass", stage: "done" });
    expect(profile(h, "ridge").plan.paidOn).toBeUndefined();
    const logged = h.d.accounts.repo.ownerTexts("ridge", { open: true });
    expect(logged.map((t) => t.handled)).toEqual(["pass_monthly"]);
  });

  /**
   * A pass whose list refills by 30 a month, done with Person 1's late reply handed off and waiting: its end text offers
   * to keep going monthly, and Jack sends it (or not yet).
   */
  async function offered(h: Harness, send: boolean): Promise<void> {
    await sentPass(h, "ridge", "2026-10-20");
    await addLead(h, "ridge", "late1", "Person 1", "2026-10-29T09:00:00");
    await h.d.accounts.withAccount("ridge", (s) => {
      const like = s.scan!.opportunities[0]!;
      s.scan!.opportunities.push(...Array.from({ length: 360 }, (_, i) => ({ ...like, id: `lapsed-${i}`, customerId: `lapsed-${i}`, type: "lapsed_regular" as const, anchorDate: addDays("2026-10-29", -i), suppressed: undefined })));
    });
    h.setNow("2026-10-30T13:00:00Z");
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "done" } });
    await deliverOwnerMessages(h.d, "ridge");
    const end = h.d.accounts.repo.ownerMessages("ridge").find((m) => m.kind === "pass_end")!;
    expect(end.text).toContain("That's enough to keep this going monthly: reply here and Jack will text you how it works.");
    if (send) expect((await h.api("POST", `/api/businesses/ridge/owner-messages/${end.id}/send`)).json.ok).toBe(true);
  }
  const lead = (h: Harness) => h.d.accounts.peek("ridge")!.state.replies.find((r) => r.id === "late1")!;
  const handled = (h: Harness) => h.d.accounts.repo.ownerTexts("ridge").map((t) => [t.handled, t.needs_person]);

  it("a yes to the end text's offer goes to Jack, however it's said, with a late lead waiting", async () => {
    const h = make();
    await offered(h, true);
    for (const yes of ["Yes", "Keep it going", "Go ahead", "Sounds good", "ok"]) expect(await h.sms(yes)).toBe("Great. Jack will text you how it works.");
    expect(handled(h)).toEqual(Array(5).fill(["pass_monthly", 1]));
    expect(profile(h, "ridge").plan).toMatchObject({ kind: "one_pass", stage: "done" });
    expect(lead(h)).toMatchObject({ status: "handed_off" });
  });

  it("a no to it goes to Jack too, and never marks the lead waiting not a fit", async () => {
    const h = make();
    await offered(h, true);
    expect(await h.sms("No thanks")).toBe("Got it — Jack will read this and get back to you. About a lead? Text NO and the #code.");
    expect(handled(h)).toEqual([["pass_end_no", 1]]);
    expect(lead(h)).toMatchObject({ status: "handed_off" });
    expect(lead(h).outcome).toBeUndefined();
  });

  it("before Jack sends it, nothing's been offered: a yes is just a yes", async () => {
    const h = make();
    await offered(h, false);
    expect(await h.sms("Yes")).toBe("Got it. About a lead? Text BOOKED + amount + the #code, DONE, or NO.");
  });
});

describe("the rest of a list after its free round", () => {
  it("a one pass after a finished free round starts with its own welcome and the owner's OK, and counts only its own people", { timeout: 60_000 }, async () => {
    const h = make();
    await h.business("ridge", { fromEmails: inboxes(2) });
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.customers = Array.from({ length: 40 }, (_, i) => homeowner(`ridge-c${i}`, `Person ${i}`));
      s.dataset.quotes = s.dataset.customers.map((c, i) => quote(c.id, i));
    });
    await h.api("PATCH", "/api/businesses/ridge", { plan: { trialSize: 10 } });
    await h.api("POST", "/api/businesses/ridge/scan");
    expect((await h.api("POST", "/api/businesses/ridge/plan", {})).json).toMatchObject({ people: 10, awaitingOk: true });
    await h.sms("OK");
    await h.d.accounts.withAccount("ridge", (s) => {
      for (const t of s.touches) Object.assign(t, { status: "sent", sentAt: `${t.dueAt}:00` } satisfies Partial<Touch>);
    });
    const free = new Set(h.d.accounts.peek("ridge")!.state.touches.map((t) => t.customerId));
    // no monthly for him: the rest of his list, once
    await h.api("PATCH", "/api/businesses/ridge", { plan: { kind: "one_pass", stage: "running" } });
    h.setNow("2026-10-26T14:00:00Z");
    const r = await h.api("POST", "/api/businesses/ridge/plan", {});
    expect(r.json).toMatchObject({ people: 30, awaitingOk: true, textSent: true });
    const state = () => h.d.accounts.peek("ridge")!.state;
    const own = (s: AccountState) => s.touches.filter((t) => !free.has(t.customerId));
    expect(own(state()).every((t) => t.status === "planned")).toBe(true);
    const welcome = h.d.accounts.repo.ownerMessages("ridge").filter((m) => m.kind === "kickoff");
    expect(welcome).toHaveLength(2);
    expect(welcome[0]!.text).toContain("You pay $250 for each job that books, never more than $1,000. Nothing books, you owe nothing.");
    expect((await h.api("GET", "/api/businesses/ridge")).json.pass).toEqual({ people: 30, started: 0, sent: 0, notes: r.json.notes });
    expect(await h.sms("OK")).toContain("Done — the first notes go out");
    expect(own(state()).every((t) => t.status === "approved")).toBe(true);
    // its tally is its own: a free-round person who writes back now isn't in it
    const [first] = free;
    const theirs = own(state())[0]!.customerId;
    await h.d.accounts.withAccount("ridge", (s) => {
      for (const t of own(s)) Object.assign(t, { status: "sent", sentAt: `${t.dueAt}:00` } satisfies Partial<Touch>);
      s.replies.push(...[first!, theirs].map((customerId, i) => ({ id: `rep${i}`, customerId, channel: "email" as const, receivedAt: "2026-11-20T10:00:00", from: `${customerId}@gmail.com`, text: "Yes please", intent: "wants_it" as const, confidence: 0.9, extracted: {}, status: "done" as const })));
    });
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "done" } });
    expect(h.d.accounts.repo.ownerMessages("ridge").find((m) => m.kind === "pass_end")!.text.split("\n")[0]).toBe("Dave, your list is done. Asked 30, 1 wrote back, 1 wanted the work, 0 booked.");
  });
});

describe("a late pass once the owner said OK", () => {
  it("the OK paces it again from its day and moves the alert's dates; the end date it names closes it; emptying Done by puts 30 days from the start back", { timeout: 120_000 }, async () => {
    const h = make();
    await pass(h, "ridge", 600, 3);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    const day = (x: string) => `${monthName(x).slice(0, 3)} ${Number(x.slice(8))}`;
    // the owner says OK on Monday, five days after the first send day
    h.setNow("2026-10-05T13:00:00Z");
    expect(await h.sms("OK")).toContain("Done — the first notes go out Oct 5");
    expect(profile(h, "ridge").plan).toMatchObject({ startedOn: "2026-10-05", targetEndOn: "2026-11-04", pace: { endOn: "2026-11-04" } });
    // paced again from Monday, not moved five days (Wednesday's to Friday's notes would land on the Mondays together)
    for (const [d, n] of Object.entries(notesByDay(h, "ridge"))) expect([d >= "2026-10-05", n <= 3 * 30]).toEqual([true, true]);
    const moved = profile(h, "ridge").plan.pace!.late!.canMeet;
    expect(moved > "2026-11-04" && lastFirst(h, "ridge") <= addDays(moved, -NOTES_SPAN_DAYS)).toBe(true);
    const alerts = async () => (await review(h)).filter((x) => x.alertKind === "pace");
    expect((await alerts()).map((a) => [a.title, a.detail])).toEqual([[`Ridgeline Tree Co.: the pass can't finish by Nov 4 on 3 inboxes`, `Its notes are approved as they are, and the last of them finish by ${day(moved)}. Set the end date to ${day(moved)}.`]]);
    expect(lateLine(profile(h, "ridge"), { approved: true })).toBe(`This pass can't finish by Nov 4: its notes are approved as they are, and the last of them finish by ${day(moved)}. Set the end date to ${day(moved)}.`);
    // Jack sets the date it names
    await h.api("PATCH", "/api/businesses/ridge", { plan: { targetEndOn: moved } });
    expect(profile(h, "ridge").plan.pace!.late).toBeUndefined();
    expect(await alerts()).toEqual([]);
    expect(lateLine(profile(h, "ridge"), { approved: true })).toBeUndefined();
    // "Done by" emptied in Settings: 30 days from the first send day again, and late again
    const before = profile(h, "ridge");
    const patch = diff(before, { ...before, plan: { ...before.plan, targetEndOn: undefined } });
    expect(patch.plan?.targetEndOn).toBeNull();
    expect((await h.api("PATCH", "/api/businesses/ridge", patch)).status).toBe(200);
    expect(profile(h, "ridge").plan).toMatchObject({ targetEndOn: "2026-11-04", pace: { late: { canMeet: moved } } });
    expect(await alerts()).toHaveLength(1);
  });

  it("people planned after the OK don't close the alert: the pass's last first note is still where it was", { timeout: 120_000 }, async () => {
    const h = make();
    await pass(h, "ridge", 600, 3);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    const before = profile(h, "ridge").plan.pace!;
    await h.sms("OK");
    const alerts = async () => (await review(h)).filter((x) => x.alertKind === "pace");
    expect(await alerts()).toHaveLength(1);
    // five new quotes come in a later file, and Jack plans them
    await h.d.accounts.withAccount("ridge", (s) => {
      const more = Array.from({ length: 5 }, (_, i) => homeowner(`ridge-new${i}`, `New ${i}`));
      s.dataset.customers = [...s.dataset.customers, ...more];
      s.dataset.quotes = [...s.dataset.quotes, ...more.map((c, i) => quote(c.id, -5 + i))];
    });
    await h.api("POST", "/api/businesses/ridge/scan");
    const r = await h.api("POST", "/api/businesses/ridge/plan", {});
    expect(r.json).toMatchObject({ people: 5, late: { canMeet: before.late!.canMeet } });
    expect(profile(h, "ridge").plan.pace).toMatchObject({ lastFirst: before.lastFirst, late: { canMeet: before.late!.canMeet } });
    expect(lastFirst(h, "ridge")).toBe(before.lastFirst);
    expect((await alerts()).map((a) => a.title)).toEqual(["Ridgeline Tree Co.: the pass can't finish by Oct 30 on 3 inboxes"]);
    expect(lateLine(profile(h, "ridge"), { approved: true })).toBeDefined();
  });

  it("before the OK, the late note says what more inboxes would do", () => {
    const b = { plan: { stage: "running", kind: "one_pass", targetEndOn: "2026-10-30", pace: { inboxes: 3, endOn: "2026-10-30", lastFirst: "2026-10-21", late: { canMeet: "2026-11-02", moreInboxes: 1 } } } } as BusinessProfile;
    expect(lateLine(b, { approved: false })).toBe("This pass can't finish by Oct 30 on 3 inboxes: the soonest is Nov 2. 1 more inbox would: add them in Settings and plan again before the owner's OK, or set the end date to Nov 2.");
  });
});

describe("BUSY and OPEN on a running one pass", () => {
  it("everyone not written to is paced again, no day over 30 an inbox, and Jack hears when it can finish", { timeout: 120_000 }, async () => {
    const h = make();
    await pass(h, "ridge", 600, 5);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    await h.sms("OK");
    // its first day's notes went
    await h.d.accounts.withAccount("ridge", (s) => {
      for (const t of s.touches) if (t.dueAt.startsWith("2026-09-30")) Object.assign(t, { status: "sent", sentAt: `${t.dueAt}:00` } satisfies Partial<Touch>);
    });
    const waiting = 600 - firsts(h, "ridge").filter((t) => t.status === "sent").length;
    const alerts = async () => (await review(h)).filter((x) => x.alertKind === "pace");
    const day = (x: string) => `${monthName(x).slice(0, 3)} ${Number(x.slice(8))}`;
    h.setNow("2026-10-01T13:00:00Z");
    expect(await h.sms("Busy until Nov 20")).toContain(`Moved ${waiting} people already queued.`);
    // they wait for Oct 30, three weeks before the schedule opens up, paced from there; the pass keeps its dates
    for (const n of Object.values(notesByDay(h, "ridge"))) expect(n).toBeLessThanOrEqual(5 * 30);
    expect(firsts(h, "ridge").filter((t) => t.status === "approved").every((t) => t.dueAt >= "2026-10-30")).toBe(true);
    const plan = profile(h, "ridge").plan;
    expect(plan).toMatchObject({ startedOn: "2026-09-30", targetEndOn: "2026-10-30", pace: { lastFirst: lastFirst(h, "ridge") } });
    const { canMeet } = plan.pace!.late!;
    expect((await alerts()).map((a) => [a.title, a.detail])).toEqual([["Ridgeline Tree Co.: the pass can't finish by Oct 30 on 5 inboxes", `Its notes are approved as they are, and the last of them finish by ${day(canMeet)}. Set the end date to ${day(canMeet)}.`]]);
    // OPEN: paced again from the next send day, not all put on it, and on time again
    expect(await h.sms("Open")).toBe(`Great — new work is back on. ${waiting} people we'd held will hear from us starting your next send day.`);
    const byDay = notesByDay(h, "ridge");
    for (const n of Object.values(byDay)) expect(n).toBeLessThanOrEqual(5 * 30);
    expect(byDay["2026-10-02"]).toBeLessThan(waiting);
    expect(profile(h, "ridge").plan.pace!.late).toBeUndefined();
    expect(await alerts()).toEqual([]);
  });
});

describe("a late pass's end date before the owner's OK", () => {
  const alerts = async (h: Harness) => (await review(h)).filter((x) => x.alertKind === "pace");
  const day = (x: string) => `${monthName(x).slice(0, 3)} ${Number(x.slice(8))}`;

  it("set to the date the alert names, it's met at once: the alert closes and the console says nothing, then and after Jack's Approve", { timeout: 120_000 }, async () => {
    const h = make();
    await pass(h, "ridge", 600, 3);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    const { canMeet } = profile(h, "ridge").plan.pace!.late!;
    expect(await alerts(h)).toHaveLength(1);
    const notes = h.d.accounts.peek("ridge")!.state.touches.map((t) => [t.id, t.dueAt]);
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { targetEndOn: canMeet } })).status).toBe(200);
    expect(profile(h, "ridge").plan.pace).toMatchObject({ endOn: canMeet });
    expect(profile(h, "ridge").plan.pace!.late).toBeUndefined();
    expect(await alerts(h)).toEqual([]);
    expect(lateLine(profile(h, "ridge"), { approved: false })).toBeUndefined();
    // the notes are as they were, and no second welcome went
    expect(h.d.accounts.peek("ridge")!.state.touches.map((t) => [t.id, t.dueAt])).toEqual(notes);
    expect(h.d.accounts.repo.ownerMessages("ridge").filter((m) => m.kind === "kickoff")).toHaveLength(1);
    // the owner said OK by phone: Jack approves in the console
    expect((await h.api("POST", "/api/businesses/ridge/approve")).json.approved).toBe(notes.length);
    expect(await alerts(h)).toEqual([]);
    expect(lateLine(profile(h, "ridge"), { approved: true })).toBeUndefined();
  });

  it("set to one its planned notes miss, the whole list is paced to it at once, with a fresh welcome for the owner", { timeout: 120_000 }, async () => {
    const h = make();
    await pass(h, "ridge", 600, 5);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    expect(await alerts(h)).toEqual([]);
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { targetEndOn: "2026-10-14" } })).status).toBe(200);
    const pace = profile(h, "ridge").plan.pace!;
    expect(pace).toMatchObject({ inboxes: 5, endOn: "2026-10-14" });
    // five inboxes can't start 600 people in the three send days before Oct 2: it's late, and says what would do it
    const { canMeet, moreInboxes } = pace.late!;
    expect(lastFirst(h, "ridge") <= addDays(canMeet, -NOTES_SPAN_DAYS)).toBe(true);
    expect((await alerts(h)).map((a) => a.title)).toEqual(["Ridgeline Tree Co.: the pass can't finish by Oct 14 on 5 inboxes"]);
    expect(lateLine(profile(h, "ridge"), { approved: false })).toContain(`the soonest is ${day(canMeet)}. ${moreInboxes === 1 ? "1 more inbox" : `${moreInboxes} more inboxes`} would`);
    expect(h.d.accounts.peek("ridge")!.state.touches.filter((t) => t.lastError === "Paced again").length).toBeGreaterThan(0);
    expect(h.d.accounts.repo.ownerMessages("ridge").filter((m) => m.kind === "kickoff")).toHaveLength(2);
    expect(h.d.accounts.peek("ridge")!.state.awaitingOwnerOk).toBeDefined();
  });

  it("Jack's Approve turns the alert to the one for approved notes, as the owner's OK does", { timeout: 120_000 }, async () => {
    const h = make();
    await pass(h, "ridge", 600, 3);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    const { canMeet } = profile(h, "ridge").plan.pace!.late!;
    expect((await alerts(h))[0]!.detail).toContain("plan again before the owner's OK");
    await h.api("POST", "/api/businesses/ridge/approve");
    expect((await alerts(h)).map((a) => a.detail)).toEqual([`Its notes are approved as they are, and the last of them finish by ${day(canMeet)}. Set the end date to ${day(canMeet)}.`]);
  });

  it("Jack's Approve days after its first planned day paces it again from that morning: nothing overdue goes at once", { timeout: 120_000 }, async () => {
    const h = make();
    await pass(h, "ridge", 600, 5);
    await h.api("POST", "/api/businesses/ridge/plan", {});
    const notes = h.d.accounts.peek("ridge")!.state.touches.length;
    // the owner said OK by phone, and Jack approves the next Monday at 8am there, five days after the first send day
    h.setNow("2026-10-05T12:00:00Z");
    expect((await h.api("POST", "/api/businesses/ridge/approve")).json.approved).toBe(notes);
    expect(profile(h, "ridge").plan).toMatchObject({ startedOn: "2026-10-05", targetEndOn: "2026-11-04", pace: { endOn: "2026-11-04", lastFirst: lastFirst(h, "ridge") } });
    expect(profile(h, "ridge").plan.pace!.late).toBeUndefined();
    for (const [d, n] of Object.entries(notesByDay(h, "ridge"))) expect([d >= "2026-10-05", n <= 5 * 30]).toEqual([true, true]);
    // what's due that morning is that morning's
    const { due } = dueTouches(h.d.accounts.peek("ridge")!.state, "2026-10-05T08:00:00");
    expect(due.length).toBeGreaterThan(0);
    expect(due.every((x) => x.touch.dueAt.startsWith("2026-10-05"))).toBe(true);
    expect(await alerts(h)).toEqual([]);
  });

  it("the late note says nothing once the date it can meet is the end date", () => {
    const b = { plan: { stage: "running", kind: "one_pass", targetEndOn: "2026-11-02", pace: { inboxes: 3, endOn: "2026-10-30", lastFirst: "2026-10-21", late: { canMeet: "2026-11-02", moreInboxes: 1 } } } } as BusinessProfile;
    expect(lateLine(b, { approved: false })).toBeUndefined();
    expect(lateLine(b, { approved: true })).toBeUndefined();
  });
});

describe("the console", () => {
  const b = (plan: Partial<BusinessProfile["plan"]>): BusinessProfile => ({ weeklyNewContacts: 75, plan: { stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [], ...plan } }) as BusinessProfile;

  it("the Plan button caps a paying monthly plan at four weeks of its pace, never the free round or a one pass", () => {
    expect(planRequest(b({ stage: "paying" }))).toEqual({ limit: 300 });
    expect(planRequest(b({}))).toEqual({});
    expect(planRequest(b({ kind: "one_pass", stage: "running" }))).toEqual({});
  });

  it("a Settings save sends a one pass's own terms (never the free round's size), and its kind when it changed", () => {
    const before = b({});
    const after = b({ kind: "one_pass", stage: "running", trialSize: 0, monthlyPrice: 0, pricePerBooking: 250, capBookings: 4, windowDays: 60, freeFirst: 150, targetEndOn: "2026-11-20" });
    expect(diff(before, after).plan).toEqual({ kind: "one_pass", stage: "running", pricePerBooking: 250, capBookings: 4, windowDays: 60, freeFirst: 150, targetEndOn: "2026-11-20" });
    expect(diff(after, { ...after, plan: { ...after.plan, stage: "done" } }).plan).toEqual({ stage: "done", pricePerBooking: 250, capBookings: 4, windowDays: 60, freeFirst: 150, targetEndOn: "2026-11-20" });
  });

  it("the overview shows the pass's list and progress, and how fast the list refills once it's over", async () => {
    const h = make();
    await sentPass(h, "ridge", "2026-10-20");
    let o = (await h.api("GET", "/api/businesses/ridge")).json;
    expect(o.pass).toEqual({ people: 5, started: 5, sent: o.pass.notes, notes: o.pass.notes });
    expect(o.refill).toBeUndefined();
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "done" } });
    o = (await h.api("GET", "/api/businesses/ridge")).json;
    expect(o.refill).toEqual({ perMonth: 0, monthly: false });
    // and a free 150, once it's done
    await h.business("cap", { name: "Capital City Landscaping", trade: "lawn" });
    expect((await h.api("GET", "/api/businesses/cap")).json.pass).toBeUndefined();
    await h.d.accounts.withAccount("cap", (s) => {
      s.trialCompletedOn = "2026-09-20";
    });
    await h.api("POST", "/api/businesses/cap/scan");
    expect((await h.api("GET", "/api/businesses/cap")).json.refill).toEqual({ perMonth: 0, monthly: false });
  });
});
