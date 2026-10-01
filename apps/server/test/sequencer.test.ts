import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerNewRequests, weeklyReport, type BusinessProfile, type Customer, type Touch } from "@qa/engine";
import { features, loadConfig } from "../src/config.ts";
import { Db } from "../src/db/sqlite.ts";
import { Repo } from "../src/db/repo.ts";
import { Accounts } from "../src/core/accounts.ts";
import { checkWebhooks, pollReplies, REPLY_POLL_MS, WORKSPACE } from "../src/core/backstop.ts";
import { syncSequencer } from "../src/core/ops.ts";
import { createApp, type HttpDeps } from "../src/http/app.ts";
import { LogNotifier } from "../src/providers/sms.ts";
import { createInstantlyProvider, parseInstantlyWebhook, type InstantlyProvider } from "../src/integrations/instantly/index.ts";
import { fakeInstantly, type Call } from "./fake-instantly.ts";

/**
 * Sending through Instantly, end to end against a fake Instantly API: answers to new requests go through their
 * own always-open campaign, send times come from Instantly, replies its webhooks miss are read by the backstop
 * (once), disabled webhooks are turned back on and a broken mailbox is flagged to the operator.
 */
const dir = mkdtempSync(join(tmpdir(), "qa-seq-"));
const dbPath = join(dir, "qa.db");
const WH = "test-webhook-secret";
let now = new Date("2026-09-30T02:40:00Z"); // Tue 22:40 in New York
const BID = "ridge";
const PAT = "pat.lee@gmail.com";
const KIM = "kim.ng@yahoo.com";
const MAILBOX = "sarah@ridge-mail.com";

const person = (id: string, email: string, first: string): Customer => ({ id, sourceIds: [id], name: `${first} Lee`, firstName: first, lastName: "Lee", emails: [email], phones: [], properties: [], tags: [] });

const profile: BusinessProfile = {
  id: BID, name: "Ridgeline Tree Co", trade: "tree", otherTrades: [], software: "jobber", ownerName: "Dave Ridge", ownerFirstName: "Dave", ownerPhone: "+16035550199",
  signerName: "Sarah", signerRole: "office", timezone: "America/New_York", sendDays: [2, 3, 4], sendWindow: [8, 11], blackoutWeeks: [], minQuoteValue: 0,
  minQuoteAgeDays: 21, maxQuoteAgeMonths: 36, weeklyNewContacts: 50, openCrewWeeks: [], voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] },
  persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0 }, channels: { email: "live" }, mailingAddress: "14 Mill Rd, Concord, NH 03301",
  plan: { stage: "paying", trialSize: 150, monthlyPrice: 497, freeMonths: [], paidOn: "2026-08-01" }, createdOn: "2026-08-01",
};

/* ------------------------------ fake Instantly ------------------------------ */

const inbox: { primary: unknown[]; others: unknown[]; threads: Record<string, unknown[]>; byId: Record<string, unknown> } = { primary: [], others: [], threads: {}, byId: {} };
let webhooks: unknown[] = [];
const api = fakeInstantly({
  "GET /campaigns": () => ({ body: { items: [] } }),
  "POST /campaigns": (c) => ({ body: { id: c.body.name.endsWith("instant") ? "camp-now" : `camp-${c.body.sequences[0].steps.length}`, status: 0 } }),
  "GET /campaigns/:id": (c) => {
    const id = c.path.split("/").pop()!;
    return { body: { id, status: 0, sequences: [{ steps: Array.from({ length: id === "camp-now" ? 1 : Number(id.slice(5)) }, () => ({ type: "email" })) }] } };
  },
  "POST /leads/add": (c) => ({ body: { leads_uploaded: c.body.leads.length, created_leads: c.body.leads.map((l: { email: string }, index: number) => ({ index, id: `lead-${l.email}`, email: l.email })) } }),
  "POST /leads/list": () => ({ body: { items: [] } }),
  "POST /campaigns/:id/activate": () => ({ body: { status: 1 } }),
  "GET /emails": (c) => ({ body: { items: c.query.search ? (inbox.threads[c.query.search.slice("thread:".length)] ?? []) : c.query.mode === "emode_others" ? inbox.others : inbox.primary } }),
  "GET /emails/:id": (c) => (inbox.byId[c.path.split("/").pop()!] ? { body: inbox.byId[c.path.split("/").pop()!] } : { status: 404, body: { message: "not found" } }),
  "POST /emails/reply": () => ({ body: { id: "our-answer" } }),
  "GET /webhooks": () => ({ body: { items: webhooks } }),
  "POST /webhooks/:id/resume": () => ({ body: { status: 1 } }),
});
const posts = (path: string): Call[] => api.callsTo("POST", path);

/* ------------------------------ app ------------------------------ */

let d: HttpDeps & { email: InstantlyProvider; notifier: LogNotifier };
let app: ReturnType<typeof createApp>;
const state = () => d.accounts.peek(BID)!.state;
const touch = (pred: (t: Touch) => boolean) => state().touches.find(pred)!;
const webhook = (body: unknown) => app.request(`/webhooks/instantly/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: "test-operator-token-321", APP_SECRET: "test-app-secret-0123456789", WEBHOOK_SECRET: WH, PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false", FEATURE_NEW_REQUESTS: "on" });
  const email = createInstantlyProvider({ apiKey: "k", fetch: api.fetch, sendingAccounts: [MAILBOX] });
  d = { cfg, accounts: new Accounts(new Repo(new Db(dbPath))), email, notifier: new LogNotifier(true), llm: null, fsm: {}, log: () => {}, clock: () => now, parsers: { instantly: (b) => parseInstantlyWebhook(b, now) } };
  app = createApp(d);
  await d.accounts.create(profile, "2026-09-29");
  await d.accounts.withAccount(BID, (s) => {
    s.dataset = {
      ...s.dataset,
      customers: [person("c1", PAT, "Pat"), person("c2", KIM, "Kim")],
      requests: [{ id: "r1", customerId: "c1", title: "Oak over the garage", status: "new", rawStatus: "New", createdOn: "2026-09-29", createdAt: "2026-09-30T02:30:00Z" }],
    };
    // Kim is in a two-note nurture sequence
    for (const step of [1, 2])
      s.touches.push({ id: `t_kim_${step}`, opportunityId: "opp_kim", customerId: "c2", channel: "email", step, angle: "check_in", dueAt: step === 1 ? "2026-09-30T09:15" : "2026-10-04T09:15", status: "approved", subject: step === 1 ? "the maples" : "", body: `Note ${step} to Kim about the maples.`, flags: [] });
    // Pat's request came in at 10:30pm
    answerNewRequests(s, "2026-09-29T22:40:00", { features: features(cfg) });
  });
});
afterAll(() => {
  d.accounts.repo.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("answers to new requests go through their own campaign", () => {
  it("routes the instant answer to the instant campaign and the nurture notes to their own", async () => {
    const r = await syncSequencer(d, BID, d.email);
    expect(r).toEqual({ sent: 2, failed: 0, held: 0 });
    const created = posts("/campaigns").map((c) => c.body);
    const instant = created.find((b) => b.name.endsWith("instant"))!;
    expect(instant).toMatchObject({ prioritize_new_leads: true, limit_emails_per_company_override: { mode: "disabled" }, stop_for_company: false, email_gap: 1, random_wait_max: 1 });
    expect(instant.campaign_schedule.schedules[0]).toMatchObject({ timing: { from: "07:00", to: "20:00" }, days: { "0": true, "1": true, "2": true, "3": true, "4": true, "5": true, "6": true } });
    expect(instant.daily_max_leads).toBeUndefined();
    const nurture = created.find((b) => b.name.endsWith("2-step"))!;
    expect(nurture).toMatchObject({ prioritize_new_leads: false, limit_emails_per_company_override: { mode: "disabled" } });

    const adds = posts("/leads/add").map((c) => ({ campaign: c.body.campaign_id, emails: c.body.leads.map((l: { email: string }) => l.email) }));
    expect(adds).toEqual(expect.arrayContaining([{ campaign: "camp-now", emails: [PAT] }, { campaign: "camp-2", emails: [KIM] }]));
    const answer = touch((t) => t.instant === true);
    expect(answer.providerId).toBe(`instantly:camp-now:${PAT}:1`);
    // written for 7am, when the campaign's window opens
    expect(answer.dueAt).toBe("2026-09-30T07:00");
    expect(answer.body).toMatch(/Dave will give you a call today/);
    expect(touch((t) => t.id === "t_kim_2").providerId).toBe(`instantly:camp-2:${KIM}:2`);
  });

  it("records when Instantly actually sent each note, in local time, keeping the campaign in the id", async () => {
    const answer = touch((t) => t.instant === true);
    now = new Date("2026-09-30T11:02:00Z");
    // the answer: named by our qa_touch_1 variable
    await webhook({ event_type: "email_sent", timestamp: "2026-09-30T11:02:00.000Z", campaign_id: "camp-now", lead_email: PAT, step: 1, email_id: "em-sent-1", qa_touch_1: answer.id });
    // Kim's first note: no variable, matched by campaign + step
    await webhook({ event_type: "email_sent", timestamp: "2026-09-30T13:20:00.000Z", campaign_id: "camp-2", lead_email: KIM, step: 1, email_id: "em-sent-2" });
    expect(touch((t) => t.id === answer.id)).toMatchObject({ status: "sent", sentAt: "2026-09-30T07:02:00", providerId: `instantly:camp-now:${PAT}:1` });
    expect(touch((t) => t.id === "t_kim_1")).toMatchObject({ status: "sent", sentAt: "2026-09-30T09:20:00", providerId: `instantly:camp-2:${KIM}:1` });
    expect(touch((t) => t.id === "t_kim_2").status).toBe("approved");
    // it came in at 10:40pm and went at 7:02am: answered, but not "within minutes"
    const report = weeklyReport(state(), "2026-09-28");
    expect(report).toMatch(/Always on: answered 1 new request/);
    expect(report).not.toMatch(/within minutes/);
  });
});

describe("the reply backstop", () => {
  const email = (id: string, over: Record<string, unknown>) => ({
    id, thread_id: "th-pat", timestamp_created: "2026-09-30T14:50:00.000Z", timestamp_email: "2026-09-30T14:49:00.000Z", subject: "Re: Your request: oak over the garage",
    from_address_email: PAT, to_address_email_list: MAILBOX, eaccount: MAILBOX, lead: PAT, i_sent: false, body: { text: "Yes please, call me." }, ...over,
  });

  beforeAll(() => {
    now = new Date("2026-09-30T15:00:00Z"); // 11:00 local
    const fromPat = email("em-r1", { body: { text: "Yes, please come look at the oak. Call me after 5." } });
    const fromSpouse = email("em-r2", { from_address_email: "Jo Lee <jo.lee@gmail.com>", lead: null, timestamp_created: "2026-09-30T14:55:00.000Z", body: { text: "Hi, this is Pat's wife. Yes we want it done, please call 603-224-1234." } });
    const newsletter = email("em-junk", { from_address_email: "deals@shop.example", lead: null, thread_id: "th-junk", body: { text: "Big sale" } });
    inbox.primary = [fromPat];
    inbox.others = [fromSpouse, newsletter];
    inbox.threads = { "th-pat": [email("em-ours", { from_address_email: MAILBOX, to_address_email_list: PAT, i_sent: true, lead: null })] };
    inbox.byId = { "em-r1": fromPat, "em-r2": fromSpouse };
  });

  it("reads replies no webhook announced — including a spouse's, filed under Others — once", async () => {
    const before = d.notifier.sent.length;
    const r = await pollReplies(d);
    expect(r).toEqual({ checked: 3, processed: 2, unmatched: 1 });
    const [primary, others] = api.callsTo("GET", "/emails").filter((c) => !c.query.search);
    expect(primary!.query).toMatchObject({ email_type: "received", min_timestamp_created: "2026-09-30T14:00:00.000Z" });
    expect(primary!.query.mode).toBeUndefined();
    expect(others!.query).toMatchObject({ email_type: "received", mode: "emode_others" });

    const replies = state().replies;
    expect(replies.find((x) => x.thread?.replyEmailId === "em-r1")).toMatchObject({ from: PAT, customerId: "c1", intent: "wants_it" });
    // the spouse's reply is Pat's lead, tied to the note we sent Pat
    expect(replies.find((x) => x.thread?.replyEmailId === "em-r2")).toMatchObject({ from: "jo.lee@gmail.com", customerId: "c1", intent: "wants_it", extracted: { phone: "+16032241234" } });
    expect(d.notifier.sent.length).toBeGreaterThan(before);
    // Both wrote back to our answer to Pat's request: their words (and the new number) join that lead for the owner,
    // who's already calling. No second "thanks" goes out and no second hand-off is made.
    expect(posts("/emails/reply")).toHaveLength(0);
    expect(replies.filter((x) => x.followUpOf === "req:r1")).toHaveLength(2);
    expect(d.notifier.sent.slice(before).map((m) => m.text).join("\n")).toContain("(603) 224-1234");
    // the cursor sits in the workspace's integration record, a few minutes before the newest email seen
    expect(d.accounts.repo.getIntegration(WORKSPACE, "instantly")).toMatchObject({ cursor: "2026-09-30T14:50:00.000Z", last_error: null });
  });

  it("polls at most every few minutes, and never reads the same email twice", async () => {
    const calls = api.calls.length;
    expect(await pollReplies(d)).toBeUndefined();
    expect(api.calls.length).toBe(calls);
    now = new Date(now.getTime() + REPLY_POLL_MS);
    const replies = state().replies.length;
    expect(await pollReplies(d)).toMatchObject({ processed: 0 });
    expect(state().replies.length).toBe(replies);
    // the late webhook for a reply the poll already read is a duplicate
    const res = await webhook({ event_type: "reply_received", timestamp: "2026-09-30T14:50:00.000Z", campaign_id: "camp-now", lead_email: PAT, email_id: "em-r1", email_account: MAILBOX, reply_text: "Yes, please come look at the oak. Call me after 5." });
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(state().replies.length).toBe(replies);
  });

  it("a reply the webhook read first is skipped by the poll", async () => {
    const late = email("em-r3", { lead: KIM, from_address_email: KIM, thread_id: "th-kim", timestamp_created: "2026-09-30T15:20:00.000Z", body: { text: "Not this year, try us in the spring." } });
    inbox.byId["em-r3"] = late;
    await webhook({ event_type: "reply_received", timestamp: "2026-09-30T15:19:00.000Z", campaign_id: "camp-2", lead_email: KIM, email_id: "em-r3", email_account: MAILBOX, reply_text: "Not this year, try us in the spring." });
    const replies = state().replies.length;
    inbox.primary = [late];
    inbox.others = [];
    now = new Date(now.getTime() + REPLY_POLL_MS);
    expect(await pollReplies(d)).toMatchObject({ checked: 1, processed: 0 });
    expect(state().replies.length).toBe(replies);
  });

  it("holds a hot reply's instant answer until 7:00 when it lands at night", async () => {
    now = new Date("2026-10-01T03:00:00Z"); // 11pm local
    inbox.byId["em-r4"] = email("em-r4", { from_address_email: KIM, lead: KIM });
    await webhook({ event_type: "reply_received", timestamp: "2026-10-01T03:00:00.000Z", campaign_id: "camp-2", lead_email: KIM, email_id: "em-r4", email_account: MAILBOX, reply_text: "Actually yes, please come out and look. Call me." });
    const acks = d.accounts.repo.db.all<{ run_at: string }>("SELECT run_at FROM tasks WHERE type = 'reply.ack'");
    expect(acks.map((t) => t.run_at)).toEqual(["2026-10-01T11:00:00.000Z"]); // 7:00 New York
  });

  it("an email left over when a poll runs out of thread lookups is read next time, never written off", async () => {
    now = new Date("2026-10-01T03:10:00Z");
    const junk = (n: number) => email(`em-n${n}`, { from_address_email: `news${n}@shop.example`, lead: null, thread_id: `th-n${n}`, timestamp_created: `2026-10-01T03:0${n}:00.000Z`, body: { text: "Big sale" } });
    const husband = email("em-r5", { from_address_email: "Sam Ng <sam.ng@gmail.com>", lead: null, thread_id: "th-kim", timestamp_created: "2026-10-01T03:05:00.000Z", body: { text: "Kim's husband here. Yes, we'd like it done, call 603-555-0188." } });
    inbox.primary = [];
    inbox.others = [junk(1), junk(2), junk(3), husband];
    inbox.threads["th-kim"] = [email("em-ours-kim", { from_address_email: MAILBOX, to_address_email_list: KIM, i_sent: true, lead: null, thread_id: "th-kim" })];
    inbox.byId["em-r5"] = husband;
    expect(await pollReplies(d)).toEqual({ checked: 4, processed: 0, unmatched: 3 });
    now = new Date(now.getTime() + REPLY_POLL_MS);
    expect(await pollReplies(d)).toMatchObject({ processed: 1 });
    expect(state().replies.find((x) => x.thread?.replyEmailId === "em-r5")).toMatchObject({ from: "sam.ng@gmail.com", customerId: "c2" });
  });

  it("a spouse with a record of their own answering our note to someone else: it goes in with that note", async () => {
    await d.accounts.withAccount(BID, (s) => {
      s.dataset.customers = [...s.dataset.customers, { ...s.dataset.customers[0]!, id: "c3", sourceIds: ["c3"], name: "Jo Lee", firstName: "Jo", emails: ["jo.lee@gmail.com"] }];
    });
    now = new Date("2026-10-01T03:30:00Z");
    const jo = email("em-r6", { from_address_email: "Jo Lee <jo.lee@gmail.com>", lead: PAT, thread_id: "th-pat", timestamp_created: "2026-10-01T03:25:00.000Z", body: { text: "This is Pat's wife. Please stop emailing him." } });
    inbox.primary = [];
    inbox.others = [jo];
    inbox.byId["em-r6"] = jo;
    expect(await pollReplies(d, { force: true })).toMatchObject({ processed: 1 });
    expect(state().replies.find((x) => x.thread?.replyEmailId === "em-r6")).toMatchObject({ from: "jo.lee@gmail.com", customerId: "c1", intent: "stop" });
    expect(state().suppressions[PAT]).toBe("unsubscribed");
  });

  it("a spouse's reply in the request answer's thread stays with the request, even with a fence note sent lately", async () => {
    await d.accounts.withAccount(BID, (st) => {
      st.touches.push({ id: "t_pat_fence", opportunityId: "opp_fence", customerId: "c1", channel: "email", step: 1, angle: "check_in", dueAt: "2026-09-29T09:00", status: "sent", sentAt: "2026-09-29T09:00:00", providerId: `instantly:camp-1:${PAT}:1`, subject: "the fence", body: "About the fence.", flags: [] });
    });
    now = new Date("2026-10-01T03:50:00Z");
    inbox.threads["th-pat"] = [email("em-ours", { from_address_email: MAILBOX, to_address_email_list: PAT, i_sent: true, lead: null, campaign_id: "camp-now" })];
    const wife = email("em-r8", { from_address_email: "Jo Park <jo.park@gmail.com>", lead: null, thread_id: "th-pat", timestamp_created: "2026-10-01T03:46:00.000Z", body: { text: "Hi, this is Pat's wife. Yes please come look at the oak, call 603-224-1234." } });
    inbox.primary = [];
    inbox.others = [wife];
    inbox.byId["em-r8"] = wife;
    expect(await pollReplies(d, { force: true })).toMatchObject({ processed: 1 });
    expect(state().replies.find((x) => x.thread?.replyEmailId === "em-r8")!.followUpOf).toBe("req:r1");
  });

  it("a spouse with her own record and no lead on the email: our note in the thread says who she's writing about", async () => {
    now = new Date("2026-10-01T04:00:00Z");
    inbox.threads["th-kim2"] = [email("em-ours-kim2", { from_address_email: MAILBOX, to_address_email_list: KIM, i_sent: true, lead: null, thread_id: "th-kim2", campaign_id: "camp-2" })];
    const jo = email("em-r9", { from_address_email: "jo.lee@gmail.com", lead: null, thread_id: "th-kim2", timestamp_created: "2026-10-01T03:56:00.000Z", body: { text: "This is Kim's wife. Please stop emailing her." } });
    inbox.primary = [];
    inbox.others = [jo];
    inbox.byId["em-r9"] = jo;
    expect(await pollReplies(d, { force: true })).toMatchObject({ processed: 1 });
    expect(state().replies.find((x) => x.thread?.replyEmailId === "em-r9")).toMatchObject({ customerId: "c2", intent: "stop" });
    expect(state().suppressions[KIM]).toBe("unsubscribed");
  });

  it("the person we wrote to, following up in her own thread after her spouse wrote there, is still herself", async () => {
    now = new Date("2026-10-01T04:10:00Z");
    // Pat's thread now also holds Jo's earlier reply (from her own record's address)
    inbox.threads["th-pat3"] = [
      email("em-ours-pat3", { from_address_email: MAILBOX, to_address_email_list: PAT, i_sent: true, lead: null, thread_id: "th-pat3", campaign_id: "camp-now" }),
      email("em-jo-earlier", { from_address_email: "jo.lee@gmail.com", lead: null, thread_id: "th-pat3" }),
    ];
    const pat = email("em-r10", { from_address_email: PAT, lead: null, thread_id: "th-pat3", timestamp_created: "2026-10-01T04:06:00.000Z", body: { text: "Following up on what Jo said, Thursday works. Call my cell." } });
    inbox.primary = [];
    inbox.others = [pat];
    inbox.byId["em-r10"] = pat;
    expect(await pollReplies(d, { force: true })).toMatchObject({ processed: 1 });
    expect(state().replies.find((x) => x.thread?.replyEmailId === "em-r10")!.customerId).toBe("c1");
  });

  it("the note a reply answers comes from its own campaign, never the newest note in another", async () => {
    now = new Date("2026-10-01T03:40:00Z");
    const jo = email("em-r7", { from_address_email: "jo.lee@gmail.com", lead: KIM, thread_id: "th-kim", campaign_id: "camp-2", timestamp_created: "2026-10-01T03:36:00.000Z", body: { text: "Hi, Kim's neighbour Jo here on her account. She'd like the maples done, please call." } });
    inbox.primary = [];
    inbox.others = [jo];
    inbox.byId["em-r7"] = jo;
    expect(await pollReplies(d, { force: true })).toMatchObject({ processed: 1 });
    const r = state().replies.find((x) => x.thread?.replyEmailId === "em-r7")!;
    expect(r.customerId).toBe("c2");
    expect(state().touches.find((t) => t.id === r.touchId)!.providerId).toMatch(/^instantly:camp-2:/);
  });
});

describe("keeping Instantly's side healthy", () => {
  it("turns a disabled webhook back on and tells the operator, at most every 15 minutes", async () => {
    webhooks = [{ id: "w1", target_hook_url: `https://qa.test/webhooks/instantly/${WH}`, event_type: "all_events", status: -1 }];
    expect(await checkWebhooks(d)).toEqual({ resumed: 1 });
    expect(posts("/webhooks/w1/resume")).toHaveLength(1);
    expect(state().events.at(-1)).toMatchObject({ kind: "warning", title: expect.stringMatching(/switched off a webhook — turned back on/) });
    expect(await checkWebhooks(d)).toBeUndefined();
    expect(posts("/webhooks/w1/resume")).toHaveLength(1);
  });

  it("flags a broken sending mailbox (account_error) where the operator already looks", async () => {
    const res = await webhook({ event_type: "account_error", timestamp: "2026-10-01T03:05:00.000Z", campaign_id: "camp-2", email_account: MAILBOX, error: "SMTP authentication failed" });
    expect(res.status).toBe(200);
    const ev = state().events.at(-1)!;
    expect(ev).toMatchObject({ agent: "guard", kind: "warning", title: `Instantly: ${MAILBOX} has an error` });
    expect(ev.detail).toMatch(/SMTP authentication failed/);
    // the operator console's overview shows it
    const ov = await app.request(`/api/businesses/${BID}`, { headers: { authorization: "Bearer test-operator-token-321" } });
    expect(((await ov.json()) as { events: { title: string }[] }).events[0]!.title).toBe(`Instantly: ${MAILBOX} has an error`);
  });
});
