import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeIfDue, find, markSent, planBatch, sendHealth, type BusinessProfile, type Customer, type Quote, type Reply, type Touch } from "@qa/engine";
import { loadConfig } from "../src/config.ts";
import { Db } from "../src/db/sqlite.ts";
import { Repo } from "../src/db/repo.ts";
import { Accounts } from "../src/core/accounts.ts";
import { checkWebhooks, registerWebhooks } from "../src/core/backstop.ts";
import { sign, syncSequencer } from "../src/core/ops.ts";
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

describe("the Guard's brake in Instantly mode", () => {
  it("pauses the campaigns and pushes nobody new; the operator sees it, clears it, and sending resumes", async () => {
    await pushed("guard", "Guard Tree", ["hal.lee@gmail.com"]);
    await d.accounts.withAccount("guard", (s) => {
      const c = s.dataset.customers[0]!;
      for (let i = 0; i < 146; i++) s.touches.push(note("guard", c, 1, { id: `old-${i}`, opportunityId: `old-${i}`, status: "sent", sentAt: "2026-09-01T09:00:00" }));
      const wrong = (id: string): Reply => ({ id, customerId: c.id, channel: "email", receivedAt: "2026-09-02T09:00:00", from: "x@y.com", text: "who is this", intent: "wrong_person", confidence: 1, extracted: {}, status: "done" });
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
