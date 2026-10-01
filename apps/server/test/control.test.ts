import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerNewRequests, closeIfDue, find, ledgerPass, markSent, planBatch, sendHealth, type BusinessProfile, type Customer, type Quote, type Reply, type Touch } from "@qa/engine";
import { loadConfig } from "../src/config.ts";
import { Db } from "../src/db/sqlite.ts";
import { Repo } from "../src/db/repo.ts";
import { Accounts } from "../src/core/accounts.ts";
import { checkWebhooks, registerWebhooks } from "../src/core/backstop.ts";
import { plan, rescan, sign, syncSequencer } from "../src/core/ops.ts";
import { runTasks } from "../src/core/worker.ts";
import { createApp, type HttpDeps } from "../src/http/app.ts";
import { LogNotifier } from "../src/providers/sms.ts";
import { createInstantlyProvider, parseInstantlyWebhook, type InstantlyProvider } from "../src/integrations/instantly/index.ts";
import { fakeInstantly } from "./fake-instantly.ts";

/**
 * In Instantly mode every note of a pushed person already sits in Instantly. Everything that stops a business —
 * the owner's PAUSE / CANCEL YES / BUSY texts, the owner-link pause, the Settings stage, deleting the client and the
 * Guard's brake — has to reach Instantly, and OPEN/RESUME has to undo it. A lead Instantly won't take is marked and
 * shown, never re-uploaded every minute, and a webhook that couldn't be registered is visible until it is.
 */
const dir = mkdtempSync(join(tmpdir(), "qa-ctl-"));
const dbPath = join(dir, "qa.db");
const TOKEN = "test-operator-token-654";
const WH = "test-webhook-secret";
const SECRET = "test-app-secret-0123456789";
let now = new Date("2026-09-29T14:00:00Z"); // Tue 10:00 New York
const BLOCKED = "blocked.person@gmail.com";

/* ------------------------------ a stateful fake Instantly ------------------------------ */

const campaigns = new Map<string, { name: string; steps: number; status: number }>();
const leads = new Map<string, { id: string; email: string; campaign: string; status: number }>();
const blocklist = new Set<string>([BLOCKED]);
let webhooks: { id: string; target_hook_url: string; event_type: string; status: number }[] = [];
let webhooksDown = false;
const seg = (path: string, i: number) => path.split("/")[i]!;
const api = fakeInstantly({
  "GET /campaigns": (c) => ({ body: { items: [...campaigns].filter(([, x]) => x.name === c.query.search).map(([id, x]) => ({ id, name: x.name, status: x.status })) } }),
  "POST /campaigns": (c) => {
    const id = String(c.body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    campaigns.set(id, { name: c.body.name, steps: c.body.sequences[0].steps.length, status: 0 });
    return { body: { id, status: 0 } };
  },
  "GET /campaigns/:id": (c) => {
    const x = campaigns.get(seg(c.path, 2));
    return x ? { body: { id: seg(c.path, 2), status: x.status, sequences: [{ steps: Array.from({ length: x.steps }, () => ({ type: "email" })) }] } } : { status: 404, body: { message: "no campaign" } };
  },
  "POST /campaigns/:id/activate": (c) => {
    campaigns.get(seg(c.path, 2))!.status = 1;
    return { body: { status: 1 } };
  },
  "POST /campaigns/:id/pause": (c) => {
    campaigns.get(seg(c.path, 2))!.status = 2;
    return { body: { status: 2 } };
  },
  "POST /leads/add": (c) => {
    const created: { index: number; id: string; email: string }[] = [];
    let inBlocklist = 0;
    (c.body.leads as { email: string }[]).forEach((l, index) => {
      if (blocklist.has(l.email)) return void inBlocklist++;
      const id = `lead-${c.body.campaign_id}-${l.email}`;
      if (!leads.has(id)) leads.set(id, { id, email: l.email, campaign: c.body.campaign_id, status: 1 });
      created.push({ index, id, email: l.email });
    });
    return { body: { leads_uploaded: created.length, in_blocklist: inBlocklist, created_leads: created } };
  },
  "POST /leads/list": (c) => ({ body: { items: [...leads.values()].filter((l) => l.campaign === c.body.campaign && (c.body.contacts as string[]).includes(l.email)) } }),
  "DELETE /leads/:id": (c) => {
    leads.delete(decodeURIComponent(seg(c.path, 2)));
    return { body: {} };
  },
  "POST /block-lists-entries": (c) => {
    blocklist.add(c.body.bl_value);
    return { body: { id: "bl" } };
  },
  "GET /webhooks": () => (webhooksDown ? { status: 403, body: { message: "API key lacks webhooks scope" } } : { body: { items: webhooks } }),
  "POST /webhooks": (c) => {
    webhooks.push({ id: `w${webhooks.length + 1}`, target_hook_url: c.body.target_hook_url, event_type: c.body.event_type, status: 1 });
    return { body: { id: `w${webhooks.length}` } };
  },
  "POST /webhooks/:id/resume": () => ({ body: { status: 1 } }),
});

/* ------------------------------ app ------------------------------ */

let d: HttpDeps & { email: InstantlyProvider; notifier: LogNotifier };
let app: ReturnType<typeof createApp>;
const st = (bid: string) => d.accounts.peek(bid)!.state;
const person = (email: string): Customer => {
  const first = email.split(".")[0]!.replace(/^./, (c) => c.toUpperCase());
  return { id: `c-${first.toLowerCase()}`, sourceIds: [first], name: `${first} Lee`, firstName: first, lastName: "Lee", emails: [email], phones: [], properties: [], tags: [], address: { street: "3 Elm St", city: "Concord", state: "NH", zip: "03301" } };
};
let phoneSeq = 300;
const profile = (id: string, name: string, stage: "trial" | "paying"): BusinessProfile => ({
  id, name, trade: "tree", otherTrades: [], software: "jobber", ownerName: "Dave Ridge", ownerFirstName: "Dave", ownerPhone: `+1603555${String(phoneSeq++).padStart(4, "0")}`,
  signerName: "Sarah", signerRole: "office", timezone: "America/New_York", sendDays: [2, 3, 4], sendWindow: [8, 11], blackoutWeeks: [], minQuoteValue: 0,
  minQuoteAgeDays: 21, maxQuoteAgeMonths: 36, weeklyNewContacts: 50, openCrewWeeks: [], voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] },
  persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0 }, channels: { email: "live" }, mailingAddress: "14 Mill Rd, Concord, NH 03301",
  plan: stage === "paying" ? { stage, trialSize: 150, monthlyPrice: 497, freeMonths: [], paidOn: "2026-08-01" } : { stage, trialSize: 150, monthlyPrice: 497, freeMonths: [] },
  createdOn: "2026-08-01",
});
const note = (bid: string, c: Customer, step: number, over: Partial<Touch> = {}): Touch => ({
  id: `${bid}-${c.id}-${step}`, opportunityId: `${bid}-${c.id}`, customerId: c.id, channel: "email", step, angle: "check_in",
  dueAt: step === 1 ? "2026-09-30T09:15" : "2026-10-06T09:15", status: "approved", subject: step === 1 ? "the maples" : "", body: `Note ${step} about the maples. Reply "stop" to opt out.\n\nX · 14 Mill Rd`, flags: [], ...over,
});
/** A client whose people were already handed to Instantly (every note of their sequence). */
async function pushed(id: string, name: string, emails: string[], stage: "trial" | "paying" = "paying"): Promise<BusinessProfile> {
  const p = profile(id, name, stage);
  await d.accounts.create(p, "2026-09-29");
  await d.accounts.withAccount(id, (s) => {
    s.dataset = { ...s.dataset, customers: emails.map(person) };
    for (const c of s.dataset.customers) s.touches.push(note(id, c, 1), note(id, c, 2));
  });
  await syncSequencer(d, id, d.email);
  return p;
}
const campaignsOf = (bid: string) => [...new Set(st(bid).touches.map((t) => t.providerId?.split(":")[1]).filter(Boolean) as string[])];
const statusOf = (bid: string) => campaignsOf(bid).map((c) => campaigns.get(c)!.status);
const leadsIn = (bid: string) => [...leads.values()].filter((l) => campaignsOf(bid).includes(l.campaign)).map((l) => l.email).sort();
const sms = async (from: string, body: string) => (await app.request(`/webhooks/sms/${WH}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: from, Body: body }) })).text();
const op = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const review = async () => (await op("GET", "/api/review")).json.items as { kind: string; businessId: string; title?: string; detail?: string }[];

beforeAll(() => {
  const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: TOKEN, APP_SECRET: SECRET, WEBHOOK_SECRET: WH, PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false" });
  const email = createInstantlyProvider({ apiKey: "k", fetch: api.fetch, sendingAccounts: ["sarah@mail.test"], sleep: async () => {}, maxRetries: 0 });
  d = { cfg, accounts: new Accounts(new Repo(new Db(dbPath))), email, notifier: new LogNotifier(true), llm: null, fsm: {}, log: () => {}, clock: () => now, parsers: { instantly: (b) => parseInstantlyWebhook(b, now) } };
  app = createApp(d);
});
afterAll(() => {
  d.accounts.repo.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("stopping a business reaches Instantly", () => {
  it("the owner's PAUSE text pauses its campaigns; RESUME turns them back on", async () => {
    const p = await pushed("pine", "Pine Tree", ["amy.lee@gmail.com", "bo.lee@gmail.com"]);
    expect(statusOf("pine")).toEqual([1]);
    expect(await sms(p.ownerPhone!, "PAUSE")).toMatch(/Paused/);
    expect(statusOf("pine")).toEqual([2]);
    expect(await sms(p.ownerPhone!, "RESUME")).toMatch(/Back on/);
    expect(statusOf("pine")).toEqual([1]);
  });

  it("the owner-link pause does the same, both ways", async () => {
    const token = sign(SECRET, "owner|pine");
    await app.request(`/api/owner/${token}/pause`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: true }) });
    expect(statusOf("pine")).toEqual([2]);
    await app.request(`/api/owner/${token}/pause`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: false }) });
    expect(statusOf("pine")).toEqual([1]);
  });

  it("CANCEL YES pauses the campaigns, pulls every lead still waiting on a note, and RESUME never restarts them", async () => {
    const p = await pushed("cedar", "Cedar Tree", ["cy.lee@gmail.com", "di.lee@gmail.com"]);
    expect(leadsIn("cedar")).toEqual(["cy.lee@gmail.com", "di.lee@gmail.com"]);
    expect(await sms(p.ownerPhone!, "CANCEL")).toMatch(/cancelled/);
    expect(statusOf("cedar")).toEqual([2]);
    await runTasks(d);
    expect(leadsIn("cedar")).toEqual([]);
    await sms(p.ownerPhone!, "RESUME");
    expect(statusOf("cedar")).toEqual([2]);
  });

  it("CANCEL on a sending platform says who UNDO can't bring back: people already part-way through their notes", async () => {
    const p = await pushed("hemlock", "Hemlock Tree", ["fa.lee@gmail.com", "gu.lee@gmail.com"]);
    await d.accounts.withAccount("hemlock", (s) => {
      const first = s.touches.find((t) => t.customerId === "c-fa" && t.step === 1)!;
      first.status = "sent";
      first.sentAt = "2026-09-29T09:15:00";
    });
    const done = await sms(p.ownerPhone!, "CANCEL");
    expect(done).toContain("Text UNDO by");
    expect(done).toContain("the 1 person already part-way through their notes won't get the rest");
    expect(done).not.toContain("it all picks back up");
  });

  it("a reply stops every record at that address on Instantly too; an out-of-office stops nothing there", async () => {
    await pushed("alder", "Alder Tree", ["jen.lee@gmail.com", "mike.lee@gmail.com"]);
    // Mike's record also carries the family address Jen writes from; his lead went up under his own address
    await d.accounts.withAccount("alder", (s) => {
      s.dataset.customers = s.dataset.customers.map((c) => (c.id === "c-mike" ? { ...c, emails: [...c.emails, "jen.lee@gmail.com"] } : c));
    });
    const hook = (body: Record<string, unknown>) => app.request(`/webhooks/instantly/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timestamp: "2026-09-30T14:00:00.000Z", campaign_id: campaignsOf("alder")[0], ...body }) });
    await hook({ event_type: "auto_reply_received", lead_email: "jen.lee@gmail.com", email_id: "em-ooo", reply_text: "I am out of the office until October 12." });
    await runTasks(d);
    expect(leadsIn("alder")).toEqual(["jen.lee@gmail.com", "mike.lee@gmail.com"]);
    await hook({ event_type: "reply_received", lead_email: "jen.lee@gmail.com", email_id: "em-stop", reply_text: "Please stop emailing us." });
    await runTasks(d);
    expect(leadsIn("alder")).toEqual([]);
    expect(st("alder").touches.filter((t) => t.status === "approved")).toEqual([]);
  });

  it("Settings: stage Paused or Cancelled stops sending there too; back to paying turns it on", async () => {
    await pushed("spruce", "Spruce Tree", ["ed.lee@gmail.com"]);
    await op("PATCH", "/api/businesses/spruce", { plan: { stage: "paused" } });
    expect(d.accounts.peek("spruce")!.paused).toBe(true);
    expect(statusOf("spruce")).toEqual([2]);
    await op("PATCH", "/api/businesses/spruce", { plan: { stage: "paying" } });
    expect(d.accounts.peek("spruce")!.paused).toBe(false);
    expect(statusOf("spruce")).toEqual([1]);
    await op("PATCH", "/api/businesses/spruce", { plan: { stage: "cancelled" } });
    expect(statusOf("spruce")).toEqual([2]);
    expect(st("spruce").touches.filter((t) => t.status === "approved")).toEqual([]);
    await runTasks(d);
    expect(leadsIn("spruce")).toEqual([]);
  });

  it("deleting a client pauses its campaigns and pulls its leads first", async () => {
    await pushed("larch", "Larch Tree", ["fay.lee@gmail.com"]);
    const [cid] = campaignsOf("larch");
    expect((await op("DELETE", "/api/businesses/larch")).status).toBe(200);
    expect(campaigns.get(cid!)!.status).toBe(2);
    await runTasks(d);
    expect([...leads.values()].filter((l) => l.campaign === cid)).toEqual([]);
  });

  it("BUSY pulls notes Instantly already holds when it moves them, and they're pushed again when due", async () => {
    const p = profile("birch", "Birch Tree", "paying");
    await d.accounts.create(p, "2026-09-29");
    await d.accounts.withAccount("birch", (s) => {
      const c = person("gus.lee@gmail.com");
      const q: Quote = { id: "q1", customerId: c.id, title: "Crown thinning, 3 maples", lineItems: [], total: 1500, status: "awaiting_response", rawStatus: "Awaiting response", sentOn: "2026-07-01", jobIds: [] };
      s.dataset = { ...s.dataset, customers: [c], quotes: [q] };
      find(s, "2026-09-29T10:00:00");
      planBatch(s, "2026-09-29T10:00:00", { startOn: "2026-09-30", approve: true });
    });
    await syncSequencer(d, "birch", d.email);
    const cids = campaignsOf("birch");
    const held = () => [...leads.values()].filter((l) => cids.includes(l.campaign)).map((l) => l.email);
    expect(held()).toEqual(["gus.lee@gmail.com"]);
    const reply = await sms(p.ownerPhone!, "BUSY 8 weeks");
    expect(reply).toMatch(/Moved 1/);
    expect(held()).toEqual([]);
    expect(st("birch").touches.filter((t) => t.status === "approved").every((t) => !t.providerId)).toBe(true);
    const adds = api.callsTo("POST", "/leads/add").length;
    await syncSequencer(d, "birch", d.email);
    expect(api.callsTo("POST", "/leads/add").length).toBe(adds);
  });
});

describe("a sync that shows the quote approved", () => {
  it("takes back the follow-ups Instantly still holds, so a booked customer gets no more", async () => {
    await d.accounts.create(profile("oak", "Oak Tree", "paying"), "2026-09-29");
    await d.accounts.withAccount("oak", (s) => {
      const c = person("kim.lee@gmail.com");
      const q: Quote = { id: "q1", customerId: c.id, title: "Dead oak over the garage", lineItems: [], total: 1800, status: "awaiting_response", rawStatus: "Awaiting response", sentOn: "2026-07-01", jobIds: [] };
      s.dataset = { ...s.dataset, customers: [c], quotes: [q] };
      find(s, "2026-09-29T10:00:00");
      planBatch(s, "2026-09-29T10:00:00", { startOn: "2026-09-30", approve: true });
    });
    await syncSequencer(d, "oak", d.email);
    const cids = campaignsOf("oak");
    const held = () => [...leads.values()].filter((l) => cids.includes(l.campaign)).map((l) => l.email);
    expect(held()).toEqual(["kim.lee@gmail.com"]);
    expect(st("oak").touches.length).toBeGreaterThan(1);
    expect(st("oak").touches.every((t) => t.providerId)).toBe(true);
    // note 1 went; then Kim approves the quote online, and the next Jobber sync brings in the job it became
    await d.accounts.withAccount("oak", (s) => {
      markSent(s, s.touches.find((t) => t.step === 1)!.id, "2026-09-30T09:15:00");
      s.dataset = {
        ...s.dataset,
        quotes: s.dataset.quotes.map((q) => ({ ...q, status: "converted" as const, approvedOn: "2026-10-01", convertedOn: "2026-10-01", jobIds: ["j1"] })),
        jobs: [{ id: "j1", customerId: "c-kim", title: "Dead oak over the garage", lineItems: [], total: 1800, status: "scheduled", rawStatus: "Scheduled", createdOn: "2026-10-01", scheduledOn: "2026-10-09", quoteId: "q1" }],
      };
      ledgerPass(s, "2026-10-01T12:00:00");
    });
    await syncSequencer(d, "oak", d.email);
    expect(held()).toEqual([]);
    const rest = st("oak").touches.filter((t) => t.step > 1);
    expect(rest.map((t) => [t.status, t.lastError])).toEqual(rest.map(() => ["cancelled", "No longer needed: the quote became a job"]));
    expect(st("oak").events.some((e) => e.title === "Stopped the follow-ups to Kim Lee")).toBe(true);
    // and nothing is pushed again
    const adds = api.callsTo("POST", "/leads/add").length;
    await syncSequencer(d, "oak", d.email);
    expect(api.callsTo("POST", "/leads/add").length).toBe(adds);
  });
});

describe("the Guard's brake in Instantly mode", () => {
  it("pauses the campaigns and pushes nobody new; the operator sees it, clears it, and sending resumes", async () => {
    await pushed("guard", "Guard Tree", ["hal.lee@gmail.com"]);
    await d.accounts.withAccount("guard", (s) => {
      const c = s.dataset.customers[0]!;
      for (let i = 0; i < 146; i++) s.touches.push(note("guard", c, 1, { id: `old-${i}`, opportunityId: `old-${i}`, status: "sent", sentAt: "2026-09-01T09:00:00" }));
      // from others we wrote to (not Hal: someone who wrote back gets nothing more)
      const wrong = (id: string): Reply => ({ id, channel: "email", receivedAt: "2026-09-02T09:00:00", from: "x@y.com", text: "who is this", intent: "wrong_person", confidence: 1, extracted: {}, status: "done" });
      s.replies.push(wrong("w1"), wrong("w2"));
      const newbie = person("ida.lee@gmail.com");
      s.dataset = { ...s.dataset, customers: [...s.dataset.customers, newbie] };
      s.touches.push(note("guard", newbie, 1), note("guard", newbie, 2));
    });
    expect(sendHealth(st("guard")).paused).toBe(true);
    await syncSequencer(d, "guard", d.email);
    expect(statusOf("guard")).toEqual([2]);
    expect(leadsIn("guard")).toEqual(["hal.lee@gmail.com"]);
    expect(st("guard").events.some((e) => e.kind === "warning" && /brake/i.test(e.title))).toBe(true);
    expect((await review()).some((i) => i.kind === "brake" && i.businessId === "guard")).toBe(true);
    // once is enough: the next tick doesn't pause again
    const pauses = api.callsTo("POST", `/campaigns/${campaignsOf("guard")[0]}/pause`).length;
    await syncSequencer(d, "guard", d.email);
    expect(api.callsTo("POST", `/campaigns/${campaignsOf("guard")[0]}/pause`).length).toBe(pauses);

    expect((await op("POST", "/api/businesses/guard/health/clear")).status).toBe(200);
    expect(sendHealth(st("guard")).paused).toBe(false);
    expect(statusOf("guard")).toEqual([1]);
    await syncSequencer(d, "guard", d.email);
    expect(leadsIn("guard")).toEqual(["hal.lee@gmail.com", "ida.lee@gmail.com"]);
    expect((await review()).some((i) => i.kind === "brake" && i.businessId === "guard")).toBe(false);
  });

  it("Instantly's bounces count toward the brake", async () => {
    await pushed("aspen", "Aspen Tree", ["jo.lee@gmail.com"]);
    const res = await app.request(`/webhooks/instantly/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event_type: "email_sent", timestamp: "2026-09-30T13:20:00.000Z", campaign_id: campaignsOf("aspen")[0], lead_email: "jo.lee@gmail.com", step: 1, email_id: "em-1" }) });
    expect(res.status).toBe(200);
    await app.request(`/webhooks/instantly/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event_type: "email_bounced", timestamp: "2026-09-30T13:25:00.000Z", campaign_id: campaignsOf("aspen")[0], lead_email: "jo.lee@gmail.com", step: 1 }) });
    expect(st("aspen").suppressions["jo.lee@gmail.com"]).toBe("bounced");
    expect(sendHealth(st("aspen")).bounces).toBe(1);
  });
});

describe("the operator's changes to notes Instantly already holds", () => {
  const NEW_WORDS = `Note 2, now about the oaks too. Want us to look at both?\n\nX · 14 Mill Rd\nYou're getting this because we quoted you. Reply "stop" to opt out.`;
  const added = (email: string) => api.callsTo("POST", "/leads/add").flatMap((c) => c.body.leads as { email: string; custom_variables: Record<string, string> }[]).filter((l) => l.email === email);

  it("before the first note goes, Don't send, Hold and new words take the person's notes back; they go again as they read now", async () => {
    await pushed("fir", "Fir Tree", ["nia.lee@gmail.com", "oz.lee@gmail.com", "pia.lee@gmail.com"]);
    expect(leadsIn("fir")).toEqual(["nia.lee@gmail.com", "oz.lee@gmail.com", "pia.lee@gmail.com"]);
    const edit = await op("PATCH", "/api/businesses/fir/touches/fir-c-nia-2", { body: NEW_WORDS });
    expect(edit).toMatchObject({ status: 200, json: { ok: true } });
    expect(st("fir").touches.filter((t) => t.customerId === "c-nia").map((t) => [t.status, t.providerId])).toEqual([["approved", undefined], ["approved", undefined]]);
    expect((await op("PATCH", "/api/businesses/fir/touches/fir-c-oz-2", { status: "cancelled" })).status).toBe(200);
    expect((await op("PATCH", "/api/businesses/fir/touches/fir-c-pia-2", { status: "planned" })).status).toBe(200);
    expect(leadsIn("fir")).toEqual([]);
    expect(st("fir").events.some((e) => e.title === "Took Nia Lee's notes back from the sending platform")).toBe(true);

    await syncSequencer(d, "fir", d.email);
    // Nia's go again with the new words, Oz's note 1 goes alone, and Pia waits while her note 2 is held
    expect(leadsIn("fir")).toEqual(["nia.lee@gmail.com", "oz.lee@gmail.com"]);
    expect(added("nia.lee@gmail.com").at(-1)!.custom_variables.b2).toContain("now about the oaks too");
    expect(added("oz.lee@gmail.com").at(-1)!.custom_variables.b2).toBeUndefined();
    expect(st("fir").touches.find((t) => t.id === "fir-c-pia-1")).toMatchObject({ status: "approved", providerId: undefined });

    // fixed and approved again: her notes go together
    expect(await op("PATCH", "/api/businesses/fir/touches/fir-c-pia-2", { body: NEW_WORDS, status: "approved" })).toMatchObject({ status: 200, json: { ok: true } });
    await syncSequencer(d, "fir", d.email);
    expect(leadsIn("fir")).toEqual(["nia.lee@gmail.com", "oz.lee@gmail.com", "pia.lee@gmail.com"]);
    expect(added("pia.lee@gmail.com")).toHaveLength(2);
  });

  it("part-way through, a change to one note is refused with the reason, and Don't send stops the rest of theirs", async () => {
    await d.accounts.create(profile("yew", "Yew Tree", "paying"), "2026-09-29");
    await d.accounts.withAccount("yew", (s) => {
      const c = person("rae.lee@gmail.com");
      s.dataset = { ...s.dataset, customers: [c] };
      s.touches.push(note("yew", c, 1), note("yew", c, 2), note("yew", c, 3, { dueAt: "2026-10-12T09:15" }));
    });
    await syncSequencer(d, "yew", d.email);
    expect(leadsIn("yew")).toEqual(["rae.lee@gmail.com"]);
    await d.accounts.withAccount("yew", (s) => {
      const first = s.touches.find((t) => t.step === 1)!;
      first.status = "sent";
      first.sentAt = "2026-09-30T09:15:00";
    });
    const edit = await op("PATCH", "/api/businesses/yew/touches/yew-c-rae-3", { body: NEW_WORDS });
    expect(edit.status).toBe(409);
    expect(edit.json.error).toMatch(/part-way through their notes/);
    expect((await op("PATCH", "/api/businesses/yew/touches/yew-c-rae-3", { status: "planned" })).status).toBe(409);
    expect(leadsIn("yew")).toEqual(["rae.lee@gmail.com"]);
    expect(st("yew").touches.find((t) => t.step === 3)!.body).not.toContain("now about the oaks");

    expect(await op("PATCH", "/api/businesses/yew/touches/yew-c-rae-3", { status: "cancelled" })).toMatchObject({ status: 200, json: { ok: true, alsoStopped: 1 } });
    expect(leadsIn("yew")).toEqual([]);
    expect(st("yew").touches.map((t) => t.status)).toEqual(["sent", "cancelled", "cancelled"]);
    // never handed over again: that would start them over at note 1
    await syncSequencer(d, "yew", d.email);
    expect(leadsIn("yew")).toEqual([]);
  });
});

describe("two clients with the same name (franchise locations)", () => {
  it("each gets its own campaign: one's PAUSE never holds the other's notes, and one's RESUME never restarts the other's", async () => {
    const boston = await pushed("mts-boston", "Monster Tree Service", ["kate.lee@gmail.com"]);
    const denver = await pushed("mts-denver", "Monster Tree Service", ["lou.lee@gmail.com"]);
    expect(campaignsOf("mts-boston")).toHaveLength(1);
    expect(campaignsOf("mts-denver")).toHaveLength(1);
    expect(campaignsOf("mts-denver")[0]).not.toBe(campaignsOf("mts-boston")[0]);
    expect(campaigns.get(campaignsOf("mts-denver")[0]!)!.name).toBe("QA · Monster Tree Service · mts-denver · 2-step");
    expect(leadsIn("mts-boston")).toEqual(["kate.lee@gmail.com"]);
    expect(leadsIn("mts-denver")).toEqual(["lou.lee@gmail.com"]);
    expect(await sms(denver.ownerPhone!, "PAUSE")).toMatch(/Paused/);
    expect(statusOf("mts-denver")).toEqual([2]);
    expect(statusOf("mts-boston")).toEqual([1]);
    await sms(boston.ownerPhone!, "PAUSE");
    await sms(boston.ownerPhone!, "RESUME");
    expect(statusOf("mts-boston")).toEqual([1]);
    expect(statusOf("mts-denver")).toEqual([2]);
  });
});

describe("a lead Instantly won't take", () => {
  it("is marked skipped with the reason and shown, is never re-uploaded, and doesn't hold up the free round's close", async () => {
    await pushed("maple", "Maple Tree", ["kay.lee@gmail.com", BLOCKED], "trial");
    const blocked = st("maple").touches.filter((t) => t.customerId === "c-blocked");
    expect(blocked.map((t) => t.status)).toEqual(["skipped", "skipped"]);
    expect(blocked[0]!.lastError).toMatch(/blocklist/);
    expect(st("maple").events.some((e) => e.kind === "warning" && /Blocked Lee/.test(e.title))).toBe(true);
    expect((await review()).some((i) => i.kind === "not_taken" && i.businessId === "maple")).toBe(true);
    const uploads = () => api.callsTo("POST", "/leads/add").filter((c) => (c.body.leads as { email: string }[]).some((l) => l.email === BLOCKED)).length;
    expect(uploads()).toBe(1);
    await syncSequencer(d, "maple", d.email);
    await syncSequencer(d, "maple", d.email);
    expect(uploads()).toBe(1);
    // everyone else's notes go; a week later the close is written
    await d.accounts.withAccount("maple", (s) => {
      for (const t of s.touches) if (t.status === "approved") markSent(s, t.id, "2026-10-01T09:00:00");
      expect(closeIfDue(s, "2026-10-09T09:00:00")).toBeDefined();
    });
  });
});

describe("webhook registration", () => {
  it("a failure is visible to the operator and retried until it works", async () => {
    webhooksDown = true;
    expect(await registerWebhooks(d)).toBe(false);
    expect(((await (await app.request("/api/health")).json()) as { webhooks?: string }).webhooks).toBe("failing");
    const item = (await review()).find((i) => i.kind === "platform");
    expect(item?.detail).toMatch(/lacks webhooks scope/);
    webhooksDown = false;
    now = new Date(now.getTime() + 20 * 60_000);
    await checkWebhooks(d);
    expect(webhooks.map((w) => w.target_hook_url)).toEqual([`https://qa.test/webhooks/instantly/${WH}`]);
    expect(((await (await app.request("/api/health")).json()) as { webhooks?: string }).webhooks).toBe("ok");
    expect((await review()).some((i) => i.kind === "platform")).toBe(false);
  });
});

describe("someone who wrote back to our answer to their request", () => {
  const hook = (body: Record<string, unknown>) => app.request(`/webhooks/instantly/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("gets no follow-ups planned or handed to Instantly, and nor does anyone else at their address", async () => {
    now = new Date("2026-09-29T14:00:00Z"); // Tue 10:00 New York
    await d.accounts.create(profile("walnut", "Walnut Tree", "paying"), "2026-09-29");
    const pat = person("pat.lee@gmail.com");
    // their spouse's record, at the same address, with a quote of its own
    const jo: Customer = { ...person("jo.lee@gmail.com"), emails: ["pat.lee@gmail.com"] };
    await d.accounts.withAccount("walnut", (s) => {
      const q: Quote = { id: "q1", customerId: jo.id, title: "Crown thinning, 3 maples", lineItems: [], total: 1500, status: "awaiting_response", rawStatus: "Awaiting response", sentOn: "2026-07-01", jobIds: [] };
      s.dataset = { ...s.dataset, customers: [pat, jo], quotes: [q], requests: [{ id: "r1", customerId: pat.id, title: "Oak over the garage", status: "new", rawStatus: "New", createdOn: "2026-09-29", createdAt: "2026-09-29T13:30:00Z" }] };
      answerNewRequests(s, "2026-09-29T10:00:00");
    });
    await syncSequencer(d, "walnut", d.email);
    const answer = st("walnut").touches.find((t) => t.instant)!;
    const [, campaign] = answer.providerId!.split(":");
    await hook({ event_type: "email_sent", timestamp: "2026-09-29T14:02:00.000Z", campaign_id: campaign, lead_email: "pat.lee@gmail.com", step: 1, email_id: "em-answer", qa_touch_1: answer.id });
    expect(st("walnut").touches.find((t) => t.id === answer.id)!.status).toBe("sent");
    await hook({ event_type: "reply_received", timestamp: "2026-09-29T15:00:00.000Z", campaign_id: campaign, lead_email: "pat.lee@gmail.com", email_id: "em-pat", reply_text: "Thanks, but we already hired another company for this. Please don't follow up." });
    expect(st("walnut").replies.map((r) => r.intent)).toEqual(["already_done"]);
    // the 3am nightly two days on
    now = new Date("2026-10-01T07:00:00Z");
    await rescan(d, "walnut");
    expect((await plan(d, "walnut", { approve: true })).people).toBe(0);
    const adds = api.callsTo("POST", "/leads/add").length;
    await syncSequencer(d, "walnut", d.email);
    expect(api.callsTo("POST", "/leads/add").length).toBe(adds);
    expect(st("walnut").touches.filter((t) => !t.instant)).toEqual([]);
  });

  it("a record that turns out to share their address: its notes Instantly holds are taken back, and nothing more goes up", async () => {
    now = new Date("2026-09-29T14:00:00Z");
    await pushed("hazel", "Hazel Tree", ["ann.lee@gmail.com", "lu.lee@gmail.com"]);
    expect(leadsIn("hazel")).toEqual(["ann.lee@gmail.com", "lu.lee@gmail.com"]);
    await d.accounts.withAccount("hazel", (s) => {
      // Jo wrote to us from her own address; a sync since puts it on Lu's record (the same household)
      s.replies.push({ id: "r-jo", channel: "email", receivedAt: "2026-09-29T09:30:00", from: "jo.lee@gmail.com", text: "Yes please, call me.", intent: "wants_it", confidence: 0.9, extracted: {}, status: "handed_off" });
      s.dataset.customers = s.dataset.customers.map((c) => (c.id === "c-lu" ? { ...c, emails: [...c.emails, "jo.lee@gmail.com"] } : c));
    });
    await syncSequencer(d, "hazel", d.email);
    expect(leadsIn("hazel")).toEqual(["ann.lee@gmail.com"]);
    const lu = st("hazel").touches.filter((t) => t.customerId === "c-lu");
    expect(lu.map((t) => [t.status, t.lastError])).toEqual(lu.map(() => ["cancelled", "They replied — the sequence stops"]));
    expect(st("hazel").touches.filter((t) => t.customerId === "c-ann").every((t) => t.status === "approved")).toBe(true);
    const adds = api.callsTo("POST", "/leads/add").length;
    await syncSequencer(d, "hazel", d.email);
    expect(api.callsTo("POST", "/leads/add").length).toBe(adds);
  });
});

describe("the quote that stops a request's follow-up", () => {
  const hook = (body: Record<string, unknown>) => app.request(`/webhooks/instantly/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("is followed up itself at the nightly cadence: Instantly gets the quote's notes once the request's are taken back", async () => {
    now = new Date("2026-09-29T14:00:00Z"); // Tue 10:00 New York
    await d.accounts.create(profile("chestnut", "Chestnut Tree", "paying"), "2026-09-29");
    const sam = person("sam.lee@gmail.com");
    await d.accounts.withAccount("chestnut", (s) => {
      s.dataset = { ...s.dataset, customers: [sam], requests: [{ id: "r1", customerId: sam.id, title: "Oak over the garage", status: "new", rawStatus: "New", createdOn: "2026-09-29", createdAt: "2026-09-29T13:30:00Z" }] };
      answerNewRequests(s, "2026-09-29T10:00:00");
    });
    await syncSequencer(d, "chestnut", d.email);
    const answer = st("chestnut").touches.find((t) => t.instant)!;
    await hook({ event_type: "email_sent", timestamp: "2026-09-29T14:02:00.000Z", campaign_id: answer.providerId!.split(":")[1], lead_email: sam.emails[0], step: 1, email_id: "em-answer", qa_touch_1: answer.id });
    // the nightly two days on starts the request's follow-up, and Instantly sends its note 1
    now = new Date("2026-10-01T07:00:00Z");
    await rescan(d, "chestnut");
    expect((await plan(d, "chestnut", { approve: true })).people).toBe(1);
    await syncSequencer(d, "chestnut", d.email);
    const request = st("chestnut").touches.filter((t) => !t.instant);
    expect(request.every((t) => t.chases?.type === "unquoted_request" && t.providerId)).toBe(true);
    now = new Date("2026-10-06T13:00:00Z");
    const n1 = request.find((t) => t.step === 1)!;
    await hook({ event_type: "email_sent", timestamp: "2026-10-06T13:00:00.000Z", campaign_id: n1.providerId!.split(":")[1], lead_email: sam.emails[0], step: 1, email_id: "em-n1", qa_touch_1: n1.id });
    // Dave quotes after the site visit; the next sync stops the rest of the request's follow-up there
    now = new Date("2026-10-07T16:00:00Z");
    await d.accounts.withAccount("chestnut", (s) => {
      s.dataset = { ...s.dataset, quotes: [{ id: "q1", customerId: sam.id, title: "Oak over the garage", lineItems: [], total: 1800, status: "awaiting_response", rawStatus: "Awaiting response", sentOn: "2026-10-07", jobIds: [] }] };
      ledgerPass(s, "2026-10-07T12:00:00");
    });
    // (the answer's lead stays in the instant campaign: it went)
    const followUps = () => [...leads.values()].filter((l) => l.campaign !== answer.providerId!.split(":")[1] && campaignsOf("chestnut").includes(l.campaign)).map((l) => l.email);
    expect(followUps()).toEqual([sam.emails[0]]);
    await syncSequencer(d, "chestnut", d.email);
    expect(followUps()).toEqual([]);
    const rest = st("chestnut").touches.filter((t) => t.step > 1 && !t.instant);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.map((t) => [t.status, t.lastError])).toEqual(rest.map(() => ["cancelled", "No longer needed: their request got a quote"]));
    // the nightly once the quote is two days old: its own follow-up, handed to Instantly
    now = new Date("2026-10-09T07:00:00Z");
    await rescan(d, "chestnut");
    expect((await plan(d, "chestnut", { approve: true })).people).toBe(1);
    await syncSequencer(d, "chestnut", d.email);
    const chasing = st("chestnut").touches.filter((t) => t.chases?.id === "q1");
    expect(chasing.length).toBeGreaterThan(1);
    expect(chasing.every((t) => t.track === "fresh_quote" && t.status === "approved" && t.providerId)).toBe(true);
    expect(followUps()).toEqual([sam.emails[0]]);
    // and once: the next nightly adds nothing
    now = new Date("2026-10-10T07:00:00Z");
    await rescan(d, "chestnut");
    expect((await plan(d, "chestnut", { approve: true })).people).toBe(0);
  });
});
