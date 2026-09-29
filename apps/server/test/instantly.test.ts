import { describe, expect, it } from "vitest";
import type { BusinessProfile } from "@qa/engine";
import type { Fetch, SequencedLead } from "../src/contracts.ts";
import { ProviderError } from "../src/contracts.ts";
import {
  INSTANTLY_TIMEZONES,
  InstantlyClient,
  buildSteps,
  createInstantlyProvider,
  instantlyWebhookKey,
  isInstantlyAutoReply,
  parseInstantlyWebhook,
  toInstantlyHtml,
  toInstantlyTimezone,
  webhookSecretMatches,
  webhookUrlFor,
} from "../src/integrations/instantly/index.ts";

/* ------------------------------------------------------------------ */
/* A fake Instantly API                                                */
/* ------------------------------------------------------------------ */

interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
  body: any;
  headers: Record<string, string>;
}
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
type Handler = (call: Call) => Reply | Promise<Reply>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Routes are "METHOD /path" with optional ":param" segments. An array answers call 1, 2, 3... in turn (the last repeats). */
function fakeInstantly(routes: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  const find = (method: string, path: string) => {
    for (const [key, h] of Object.entries(routes)) {
      const [m, pattern] = key.split(" ") as [string, string];
      if (m !== method) continue;
      const a = pattern.split("/");
      const b = path.split("/");
      if (a.length === b.length && a.every((seg, i) => seg.startsWith(":") || seg === b[i])) return { key, h };
    }
    return undefined;
  };
  const fetch: Fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v2/, "");
    const method = init?.method ?? "GET";
    const call: Call = {
      method,
      path,
      query: Object.fromEntries(url.searchParams),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: { ...(init?.headers as Record<string, string>) },
    };
    calls.push(call);
    const route = find(method, path);
    if (!route) return json(404, { statusCode: 404, error: "Not Found", message: `no fake for ${method} ${path}` });
    let handler = route.h;
    if (Array.isArray(handler)) {
      const n = seen.get(route.key) ?? 0;
      seen.set(route.key, n + 1);
      handler = handler[Math.min(n, handler.length - 1)]!;
    }
    const out = await handler(call);
    return json(out.status ?? 200, out.body, out.headers);
  };
  return { fetch, calls, callsTo: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path) };
}

function recordingSleep() {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function business(over: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id: "biz_oak",
    name: "Oak & Sons Tree",
    trade: "tree",
    otherTrades: [],
    software: "jobber",
    ownerName: "Dave Oakley",
    ownerFirstName: "Dave",
    signerName: "Sarah",
    signerRole: "office",
    replyTo: "sarah@oakandsons.com",
    timezone: "America/New_York",
    sendDays: [1, 2, 3, 4, 5],
    sendWindow: [8, 17],
    blackoutWeeks: [],
    minQuoteValue: 0,
    minQuoteAgeDays: 14,
    maxQuoteAgeMonths: 24,
    weeklyNewContacts: 50,
    openCrewWeeks: [],
    voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] },
    persistence: { seasonalCheckIn: true, maxNotesPerYear: 4, holdoutPct: 10 },
    channels: { email: "live" },
    plan: { stage: "trial", trialSize: 50, monthlyPrice: 500, freeMonths: [] },
    createdOn: "2026-09-01",
    ...over,
  };
}

const NOTE1 = "Hi Pat,\n\nStill thinking about the oak by the driveway? Q&A: <none>.\n\nSarah";
const NOTE2 = "Just floating this back up.\n\nSarah";

function lead(i: number, steps = 2, over: Partial<SequencedLead> = {}): SequencedLead {
  return {
    customerId: `cus_${i}`,
    opportunityId: `opp_${i}`,
    email: `Person${i}@Example.com`,
    firstName: "Pat",
    lastName: `Lee${i}`,
    notes: Array.from({ length: steps }, (_, k) => ({
      touchId: `t_${i}_${k + 1}`,
      step: k + 1,
      subject: k === 0 ? "the oak by the driveway" : "",
      body: k === 0 ? NOTE1 : NOTE2,
      dueAt: "2026-10-05T09:00:00-04:00",
    })),
    ...over,
  };
}

const campaignWithSteps = (id: string, steps: number, status: number) => ({ id, name: "x", status, sequences: [{ steps: Array.from({ length: steps }, () => ({ type: "email" })) }] });

/* ------------------------------------------------------------------ */
/* ensureCampaign                                                      */
/* ------------------------------------------------------------------ */

describe("ensureCampaign", () => {
  it("creates the campaign with the business's schedule, variable-only steps and plain-text settings, then reuses it", async () => {
    const api = fakeInstantly({
      "GET /campaigns": () => ({ body: { items: [{ id: "near-miss", name: "QA · Oak & Sons Tree · 3-step (old)" }], next_starting_after: null } }),
      "POST /campaigns": (c) => ({ body: { id: "camp-3", name: c.body.name, status: 0 } }),
    });
    const p = createInstantlyProvider({ apiKey: "key_123", fetch: api.fetch, sendingAccounts: ["sarah@oaksons-mail.com", " dave@oaksons-mail.com "], dailyLimit: 40 });

    expect(await p.ensureCampaign(business(), { maxSteps: 3 })).toEqual({ campaignId: "camp-3" });

    const [list] = api.callsTo("GET", "/campaigns");
    expect(list!.query.search).toBe("QA · Oak & Sons Tree · 3-step");
    expect(list!.headers.Authorization).toBe("Bearer key_123");
    expect(list!.headers["Content-Type"]).toBeUndefined();

    const [create] = api.callsTo("POST", "/campaigns");
    expect(create!.headers["Content-Type"]).toBe("application/json");
    expect(create!.body).toEqual({
      name: "QA · Oak & Sons Tree · 3-step",
      campaign_schedule: {
        schedules: [
          {
            name: "Quiet Accounts",
            timing: { from: "08:00", to: "17:00" },
            days: { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false },
            timezone: "America/Detroit",
          },
        ],
      },
      sequences: [
        {
          steps: [
            { type: "email", delay: 4, delay_unit: "days", variants: [{ subject: "{{s1}}", body: "{{b1}}" }] },
            { type: "email", delay: 5, delay_unit: "days", variants: [{ subject: "", body: "{{b2}}" }] },
            { type: "email", delay: 0, delay_unit: "days", variants: [{ subject: "", body: "{{b3}}" }] },
          ],
        },
      ],
      email_list: ["sarah@oaksons-mail.com", "dave@oaksons-mail.com"],
      daily_limit: 40,
      daily_max_leads: 10,
      stop_on_reply: true,
      stop_on_auto_reply: false,
      stop_for_company: false,
      text_only: true,
      first_email_text_only: true,
      link_tracking: false,
      open_tracking: false,
      insert_unsubscribe_header: true,
      prioritize_new_leads: false,
      match_lead_esp: false,
    });

    // Cached by business id + steps: no more API calls.
    const before = api.calls.length;
    expect(await p.ensureCampaign(business(), { maxSteps: 3 })).toEqual({ campaignId: "camp-3" });
    expect(api.calls.length).toBe(before);

    // A different step count is a different campaign.
    await p.ensureCampaign(business(), { maxSteps: 1 });
    expect(api.callsTo("POST", "/campaigns").at(-1)!.body.name).toBe("QA · Oak & Sons Tree · 1-step");
    expect(api.callsTo("POST", "/campaigns").at(-1)!.body.sequences[0].steps).toEqual([
      { type: "email", delay: 0, delay_unit: "days", variants: [{ subject: "{{s1}}", body: "{{b1}}" }] },
    ]);
  });

  it("finds an existing campaign by exact name on a cold start, and concurrent calls share one lookup", async () => {
    const exact = "QA · Oak & Sons Tree · 2-step";
    const api = fakeInstantly({
      "GET /campaigns": () => ({
        body: {
          items: [
            { id: "fuzzy", name: `${exact} copy`, timestamp_created: "2026-08-01T00:00:00Z" },
            { id: "twin", name: exact, timestamp_created: "2026-09-02T00:00:00Z" },
            { id: "camp-2", name: exact, timestamp_created: "2026-09-01T00:00:00Z" },
          ],
        },
      }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    const [a, b] = await Promise.all([p.ensureCampaign(business(), { maxSteps: 2 }), p.ensureCampaign(business(), { maxSteps: 2 })]);
    expect(a.campaignId).toBe("camp-2");
    expect(b.campaignId).toBe("camp-2");
    expect(api.callsTo("GET", "/campaigns")).toHaveLength(1);
    expect(api.callsTo("POST", "/campaigns")).toHaveLength(0);
  });

  it("re-checks by name when a create fails with an unknown outcome", async () => {
    const exact = "QA · Oak & Sons Tree · 2-step";
    const api = fakeInstantly({
      "GET /campaigns": [() => ({ body: { items: [] } }), () => ({ body: { items: [{ id: "landed", name: exact }] } })],
      "POST /campaigns": () => ({ status: 502, body: { statusCode: 502, error: "Bad Gateway", message: "upstream" } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch, sleep: recordingSleep().sleep });
    expect(await p.ensureCampaign(business(), { maxSteps: 2 })).toEqual({ campaignId: "landed" });
    expect(api.callsTo("POST", "/campaigns")).toHaveLength(1); // not blindly retried
  });

  it("forgets a cached campaign that was deleted in Instantly", async () => {
    const api = fakeInstantly({
      "GET /campaigns": () => ({ body: { items: [] } }),
      "POST /campaigns": [() => ({ body: { id: "camp-old", status: 0 } }), () => ({ body: { id: "camp-new", status: 0 } })],
      "GET /campaigns/camp-old": () => ({ status: 404, body: { statusCode: 404, error: "Not Found", message: "Resource not found" } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    expect((await p.ensureCampaign(business(), { maxSteps: 2 })).campaignId).toBe("camp-old");
    await expect(p.upsertLeads(business(), "camp-old", [lead(0)])).rejects.toMatchObject({ status: 404 });
    expect((await p.ensureCampaign(business(), { maxSteps: 2 })).campaignId).toBe("camp-new");
  });

  it("rejects step counts Instantly campaigns aren't built for, and bad schedules", async () => {
    const api = fakeInstantly({ "GET /campaigns": () => ({ body: { items: [] } }) });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    await expect(p.ensureCampaign(business(), { maxSteps: 4 })).rejects.toBeInstanceOf(ProviderError);
    await expect(p.ensureCampaign(business(), { maxSteps: 0 })).rejects.toBeInstanceOf(ProviderError);
    await expect(p.ensureCampaign(business({ sendDays: [] }), { maxSteps: 2 })).rejects.toThrow(/no send days/);
    await expect(p.ensureCampaign(business({ sendWindow: [17, 8] }), { maxSteps: 2 })).rejects.toThrow(/send window/);
  });

  it("keeps follow-ups threaded (empty subject) unless threading is turned off", () => {
    expect(buildSteps(2).map((s) => s.variants[0]!.subject)).toEqual(["{{s1}}", ""]);
    expect(buildSteps(2, false).map((s) => s.variants[0]!.subject)).toEqual(["{{s1}}", "{{s2}}"]);
  });

  it("maps IANA zones onto Instantly's timezone list", () => {
    expect(toInstantlyTimezone("America/New_York")).toBe("America/Detroit");
    expect(toInstantlyTimezone("America/Chicago")).toBe("America/Chicago");
    expect(toInstantlyTimezone("America/Denver")).toBe("America/Boise");
    expect(toInstantlyTimezone("America/Phoenix")).toBe("America/Creston");
    expect(toInstantlyTimezone("America/Los_Angeles")).toBe("America/Dawson");
    expect(toInstantlyTimezone("Pacific/Honolulu")).toBe("Etc/GMT+10");
    // Not in the alias table: matched by January/July offsets.
    const paris = toInstantlyTimezone("Europe/Paris", new Date("2026-09-29T00:00:00Z"));
    expect(INSTANTLY_TIMEZONES).toContain(paris);
    expect(["Arctic/Longyearbyen", "Europe/Belgrade", "Africa/Ceuta", "Europe/Sarajevo"]).toContain(paris);
    expect(() => toInstantlyTimezone("Mars/Olympus_Mons")).toThrow(ProviderError);
  });
});

/* ------------------------------------------------------------------ */
/* upsertLeads                                                         */
/* ------------------------------------------------------------------ */

describe("upsertLeads", () => {
  it("uploads in chunks of 1000 with each note as custom variables, then starts the draft campaign", async () => {
    const api = fakeInstantly({
      "GET /campaigns/camp-2": () => ({ body: campaignWithSteps("camp-2", 2, 0) }),
      "POST /leads/add": (c) => ({
        body: {
          status: "success",
          total_sent: c.body.leads.length,
          leads_uploaded: c.body.leads.length,
          in_blocklist: 0,
          blocklist_used: null,
          duplicated_leads: 0,
          skipped_count: 0,
          invalid_email_count: 0,
          incomplete_count: 0,
          duplicate_email_count: 0,
          remaining_in_plan: 9000,
          created_leads: c.body.leads.map((l: { email: string }, index: number) => ({ index, id: `lead-${index}`, email: l.email })),
        },
      }),
      "POST /campaigns/camp-2/activate": () => ({ body: campaignWithSteps("camp-2", 2, 1) }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });

    const leads = Array.from({ length: 2050 }, (_, i) => lead(i));
    leads.push(lead(9000, 2, { email: "not-an-email" }));
    leads.push(lead(1, 2, { email: "PERSON1@example.com " })); // same person again
    leads.push(lead(9001, 3)); // 3 notes, 2-step campaign
    leads.push(lead(9002, 2, { notes: [lead(9002).notes[1]!] })); // only has step 2

    const result = await p.upsertLeads(business(), "camp-2", leads);
    expect(result.added).toBe(2050);
    expect(result.skipped).toEqual([
      { email: "not-an-email", why: "invalid email address" },
      { email: "PERSON1@example.com ", why: "duplicate email in this upload" },
      { email: "Person9001@Example.com", why: "has 3 note(s) but the campaign has 2 step(s)" },
      { email: "Person9002@Example.com", why: "has 1 note(s) but the campaign has 2 step(s)" },
    ]);

    const adds = api.callsTo("POST", "/leads/add");
    expect(adds.map((c) => c.body.leads.length)).toEqual([1000, 1000, 50]);
    for (const c of adds) {
      expect(c.body.campaign_id).toBe("camp-2");
      expect(c.body.skip_if_in_workspace).toBe(false);
    }
    expect(adds[0]!.body.leads[0]).toEqual({
      email: "person0@example.com",
      first_name: "Pat",
      last_name: "Lee0",
      custom_variables: {
        qa_business_id: "biz_oak",
        qa_customer_id: "cus_0",
        qa_opportunity_id: "opp_0",
        s1: "the oak by the driveway",
        b1: "<div>Hi Pat,</div><div><br /></div><div>Still thinking about the oak by the driveway? Q&amp;A: &lt;none&gt;.</div><div><br /></div><div>Sarah</div>",
        qa_touch_1: "t_0_1",
        s2: "",
        b2: "<div>Just floating this back up.</div><div><br /></div><div>Sarah</div>",
        qa_touch_2: "t_0_2",
      },
    });
    expect(api.callsTo("POST", "/campaigns/camp-2/activate")).toHaveLength(1);
  });

  it("counts people already in the campaign as added (idempotent) and explains real skips", async () => {
    const api = fakeInstantly({
      "GET /campaigns/camp-2": () => ({ body: campaignWithSteps("camp-2", 2, 1) }),
      "POST /leads/add": (c) => ({
        body: {
          total_sent: 3,
          leads_uploaded: 1,
          in_blocklist: 0,
          duplicated_leads: 0,
          skipped_count: 2,
          invalid_email_count: 0,
          duplicate_email_count: 0,
          created_leads: [{ index: 0, id: "lead-new", email: c.body.leads[0].email }],
        },
      }),
      "POST /leads/list": () => ({ body: { items: [{ id: "lead-old", email: "Person1@example.com", campaign: "camp-2", status: 1 }] } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    const result = await p.upsertLeads(business(), "camp-2", [lead(0), lead(1), lead(2)]);
    expect(result).toEqual({ added: 2, skipped: [{ email: "person2@example.com", why: "already in another campaign or list" }] });
    expect(api.callsTo("POST", "/leads/list")[0]!.body).toEqual({ campaign: "camp-2", contacts: ["person1@example.com", "person2@example.com"], limit: 100 });
    // Already active: nothing to start.
    expect(api.callsTo("POST", "/campaigns/camp-2/activate")).toHaveLength(0);
  });

  it("never resumes a campaign someone paused", async () => {
    const api = fakeInstantly({
      "GET /campaigns/camp-2": () => ({ body: campaignWithSteps("camp-2", 1, 2) }),
      "POST /leads/add": () => ({ body: { leads_uploaded: 1, created_leads: [{ index: 0, id: "l" }] } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    expect(await p.upsertLeads(business(), "camp-2", [lead(0, 1)])).toEqual({ added: 1, skipped: [] });
    expect(api.calls.some((c) => c.path.endsWith("/activate"))).toBe(false);
  });

  it("renders plain-text notes the way Instantly delivers line breaks", () => {
    expect(toInstantlyHtml("Hi Pat,\r\n\r\nThe oak — still there?\n  Sarah  ")).toBe("<div>Hi Pat,</div><div><br /></div><div>The oak — still there?</div><div>Sarah</div>");
  });
});

/* ------------------------------------------------------------------ */
/* stopLead / pauseCampaign                                            */
/* ------------------------------------------------------------------ */

describe("stopLead", () => {
  it("blocklists an unsubscribe first, then removes the still-sending lead from the campaign", async () => {
    const api = fakeInstantly({
      "POST /block-lists-entries": (c) => ({ body: { id: "bl-1", bl_value: c.body.bl_value, is_domain: false } }),
      "POST /leads/list": () => ({ body: { items: [{ id: "lead-9", email: "pat@example.com", campaign: "camp-2", status: 1, email_reply_count: 0 }] } }),
      "DELETE /leads/:id": () => ({ body: { id: "lead-9" } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    await p.stopLead(business(), "camp-2", " Pat@Example.com ", "unsubscribed");
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /block-lists-entries", "POST /leads/list", "DELETE /leads/lead-9"]);
    expect(api.calls[0]!.body).toEqual({ bl_value: "pat@example.com" });
    expect(api.calls[1]!.body).toEqual({ campaign: "camp-2", contacts: ["pat@example.com"], limit: 100 });
  });

  it("treats an existing blocklist entry as done", async () => {
    const api = fakeInstantly({
      "POST /block-lists-entries": () => ({ status: 400, body: { statusCode: 400, error: "Bad Request", message: "Entry already exists" } }),
      "GET /block-lists-entries": () => ({ body: { items: [{ id: "bl-1", bl_value: "pat@example.com" }] } }),
      "POST /leads/list": () => ({ body: { items: [] } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    await expect(p.stopLead(business(), "camp-2", "pat@example.com", "bounced")).resolves.toBeUndefined();
    expect(api.callsTo("GET", "/block-lists-entries")[0]!.query.search).toBe("pat@example.com");
  });

  it("leaves a replied lead Instantly already stopped (keeps reply tracking), removes one it missed, never blocklists replies", async () => {
    const api = fakeInstantly({
      "POST /leads/list": [
        () => ({ body: { items: [{ id: "seen", email: "a@example.com", campaign: "camp-2", status: 3, email_reply_count: 1 }] } }),
        () => ({ body: { items: [{ id: "missed", email: "b@example.com", campaign: "camp-2", status: 1, email_reply_count: 0 }] } }),
      ],
      "DELETE /leads/:id": () => ({ status: 404, body: { statusCode: 404, error: "Not Found", message: "gone already" } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    await p.stopLead(business(), "camp-2", "a@example.com", "replied");
    await p.stopLead(business(), "camp-2", "b@example.com", "replied"); // 404 on delete is fine
    expect(api.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/leads/missed"]);
    expect(api.calls.some((c) => c.path.startsWith("/block-lists-entries"))).toBe(false);
  });

  it("pauses and resumes a campaign without a body", async () => {
    const api = fakeInstantly({
      "POST /campaigns/:id/pause": () => ({ body: { id: "camp-2", status: 2 } }),
      "POST /campaigns/:id/activate": () => ({ body: { id: "camp-2", status: 1 } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    await p.pauseCampaign(business(), "camp-2", true);
    await p.pauseCampaign(business(), "camp-2", false);
    expect(api.calls.map((c) => c.path)).toEqual(["/campaigns/camp-2/pause", "/campaigns/camp-2/activate"]);
    expect(api.calls.every((c) => c.body === undefined && c.headers["Content-Type"] === undefined)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Client retries                                                      */
/* ------------------------------------------------------------------ */

describe("InstantlyClient", () => {
  it("retries a 429, honouring Retry-After, then succeeds", async () => {
    const api = fakeInstantly({
      "GET /campaigns/camp-2": [
        () => ({ status: 429, headers: { "retry-after": "2" }, body: { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded" } }),
        () => ({ body: { id: "camp-2" } }),
      ],
    });
    const { sleeps, sleep } = recordingSleep();
    const client = new InstantlyClient({ apiKey: "k", fetch: api.fetch, sleep });
    expect(await client.get("/campaigns/camp-2")).toEqual({ id: "camp-2" });
    expect(sleeps).toEqual([2000]);
    expect(api.calls).toHaveLength(2);
  });

  it("retries a 429 even on a non-idempotent write, with jittered backoff when there is no Retry-After", async () => {
    const api = fakeInstantly({
      "POST /webhooks": [() => ({ status: 429, body: { message: "Rate limit exceeded" } }), () => ({ status: 429, body: {} }), () => ({ body: { id: "w1" } })],
    });
    const { sleeps, sleep } = recordingSleep();
    const client = new InstantlyClient({ apiKey: "k", fetch: api.fetch, sleep, random: () => 0.5 });
    expect(await client.post("/webhooks", { target_hook_url: "https://x" })).toEqual({ id: "w1" });
    expect(sleeps).toEqual([375, 750]); // 500·2^n → half fixed + half jitter
  });

  it("gives up after maxRetries on 5xx with a retryable ProviderError", async () => {
    const api = fakeInstantly({ "GET /campaigns": () => ({ status: 503, body: { statusCode: 503, error: "Service Unavailable", message: "try later" } }) });
    const { sleeps, sleep } = recordingSleep();
    const client = new InstantlyClient({ apiKey: "k", fetch: api.fetch, sleep, maxRetries: 2, random: () => 0 });
    const err = await client.get("/campaigns").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ provider: "instantly", status: 503, retryable: true });
    expect((err as Error).message).toContain("try later");
    expect(sleeps).toEqual([250, 500]);
    expect(api.calls).toHaveLength(3);
  });

  it("does not retry a non-idempotent 5xx, and 4xx errors carry status and message", async () => {
    const api = fakeInstantly({
      "POST /webhooks": () => ({ status: 500, body: { message: "boom" } }),
      "POST /campaigns": () => ({ status: 400, body: { statusCode: 400, error: "Bad Request", message: "body must have required property 'name'" } }),
    });
    const client = new InstantlyClient({ apiKey: "k", fetch: api.fetch, sleep: recordingSleep().sleep });
    await expect(client.post("/webhooks", {})).rejects.toMatchObject({ status: 500, retryable: true });
    expect(api.callsTo("POST", "/webhooks")).toHaveLength(1);
    await expect(client.post("/campaigns", {})).rejects.toMatchObject({ status: 400, retryable: false, message: expect.stringContaining("required property 'name'") });
  });

  it("times out with AbortController and retries reads only", async () => {
    let calls = 0;
    const hang: Fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        calls++;
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const { sleeps, sleep } = recordingSleep();
    const client = new InstantlyClient({ apiKey: "k", fetch: hang, sleep, timeoutMs: 15, maxRetries: 1 });
    await expect(client.get("/campaigns")).rejects.toThrow(/timed out after 15ms/);
    expect(calls).toBe(2);
    expect(sleeps).toHaveLength(1);
    calls = 0;
    await expect(client.post("/campaigns", { name: "x" })).rejects.toMatchObject({ retryable: true });
    expect(calls).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

const base = {
  timestamp: "2026-10-06T14:03:11.000Z",
  workspace: "8c1e9d7a-0000-4000-8000-000000000001",
  campaign_id: "camp-2",
  campaign_name: "QA · Oak & Sons Tree · 2-step",
  lead_email: "Pat.Lee@Example.com",
  email_account: "sarah@oaksons-mail.com",
  // Lead data Instantly merges into the payload.
  first_name: "Pat",
  last_name: "Lee",
  qa_business_id: "biz_oak",
  qa_customer_id: "cus_1",
};

describe("parseInstantlyWebhook", () => {
  const now = new Date("2026-10-06T15:00:00.000Z");

  it("reply_received → reply, using reply_text", () => {
    const body = {
      ...base,
      event_type: "reply_received",
      step: 1,
      variant: 1,
      is_first: true,
      email_id: "0199b1a2-reply",
      unibox_url: "https://app.instantly.ai/app/unibox?thread_search=pat.lee%40example.com",
      reply_subject: "Re: the oak by the driveway",
      reply_text_snippet: "Yes! Can you come Thursday?",
      reply_text: "Yes! Can you come Thursday? Afternoons are best.\n\nOn Mon, Oct 5, 2026 Sarah wrote:\n> Hi Pat,",
      reply_html: "<div>Yes! Can you come Thursday? Afternoons are best.</div>",
    };
    expect(parseInstantlyWebhook(body, now)).toEqual({
      type: "reply",
      businessId: "biz_oak",
      campaignId: "camp-2",
      from: "pat.lee@example.com",
      subject: "Re: the oak by the driveway",
      text: "Yes! Can you come Thursday? Afternoons are best.\n\nOn Mon, Oct 5, 2026 Sarah wrote:\n> Hi Pat,",
      receivedAt: "2026-10-06T14:03:11.000Z",
    });
    expect(isInstantlyAutoReply(body)).toBe(false);
  });

  it("auto_reply_received → reply, text taken from reply_html when there is no reply_text", () => {
    const body = {
      ...base,
      event_type: "auto_reply_received",
      step: 2,
      reply_subject: "Automatic reply: the oak by the driveway",
      reply_html: "<html><head><style>p{}</style></head><body><p>I&#39;m away until Oct 12.</p><p>For urgent matters call 555&#8209;0100 &amp; leave a message.</p></body></html>",
    };
    const e = parseInstantlyWebhook(JSON.stringify(body), now);
    expect(e).toMatchObject({ type: "reply", from: "pat.lee@example.com", subject: "Automatic reply: the oak by the driveway" });
    expect(e && e.type === "reply" ? e.text : "").toBe("I'm away until Oct 12.\nFor urgent matters call 555‑0100 & leave a message.");
    expect(isInstantlyAutoReply(body)).toBe(true);
  });

  it("email_sent → sent with step and the Instantly email id", () => {
    const body = { ...base, event_type: "email_sent", step: 2, variant: 1, is_first: false, email_id: "0199b1a2-sent", email_subject: "Re: the oak by the driveway", email_text: "Just floating this back up." };
    expect(parseInstantlyWebhook(body, now)).toEqual({ type: "sent", businessId: "biz_oak", campaignId: "camp-2", email: "pat.lee@example.com", step: 2, providerId: "0199b1a2-sent", sentAt: "2026-10-06T14:03:11.000Z" });
  });

  it("email_bounced → bounce", () => {
    expect(parseInstantlyWebhook({ ...base, event_type: "email_bounced", step: 1 }, now)).toEqual({
      type: "bounce",
      businessId: "biz_oak",
      campaignId: "camp-2",
      email: "pat.lee@example.com",
      at: "2026-10-06T14:03:11.000Z",
      detail: "bounced on step 1",
    });
  });

  it("lead_unsubscribed → unsubscribe", () => {
    expect(parseInstantlyWebhook({ ...base, event_type: "lead_unsubscribed" }, now)).toEqual({ type: "unsubscribe", businessId: "biz_oak", campaignId: "camp-2", email: "pat.lee@example.com", at: "2026-10-06T14:03:11.000Z" });
  });

  it("a custom 'Spam complaint' label → complaint (Instantly has no built-in complaint event)", () => {
    expect(parseInstantlyWebhook({ ...base, event_type: "Spam complaint" }, now)).toMatchObject({ type: "complaint", email: "pat.lee@example.com" });
  });

  it("business id nested under payload, and a missing timestamp falls back to now", () => {
    const { qa_business_id: _drop, timestamp: _t, ...rest } = base;
    expect(parseInstantlyWebhook({ ...rest, event_type: "lead_unsubscribed", payload: { qa_business_id: "biz_nested" } }, now)).toMatchObject({ businessId: "biz_nested", at: now.toISOString() });
  });

  it("ignores events we don't act on and junk", () => {
    expect(parseInstantlyWebhook({ ...base, event_type: "email_opened" }, now)).toBeUndefined();
    expect(parseInstantlyWebhook({ ...base, event_type: "campaign_completed" }, now)).toBeUndefined();
    expect(parseInstantlyWebhook({ ...base, lead_email: undefined, event_type: "reply_received" }, now)).toBeUndefined();
    expect(parseInstantlyWebhook("not json", now)).toBeUndefined();
    expect(parseInstantlyWebhook(null, now)).toBeUndefined();
    expect(parseInstantlyWebhook([], now)).toBeUndefined();
  });

  it("gives each delivery a stable dedupe key", () => {
    const sent = { ...base, event_type: "email_sent", step: 1, email_id: "e1" };
    expect(instantlyWebhookKey(sent)).toBe(instantlyWebhookKey(JSON.stringify(sent)));
    expect(instantlyWebhookKey(sent)).toMatch(/^instantly:[0-9a-f]{40}$/);
    expect(instantlyWebhookKey({ ...sent, step: 2 })).not.toBe(instantlyWebhookKey(sent));
    expect(instantlyWebhookKey({})).toBeUndefined();
  });
});

describe("webhook registration", () => {
  it("builds the secret URL and checks secrets in constant time", () => {
    expect(webhookUrlFor("https://qa.example.com/", "s3cr3t/+x")).toBe("https://qa.example.com/webhooks/instantly/s3cr3t%2F%2Bx");
    expect(webhookSecretMatches("abc123abc123", "abc123abc123")).toBe(true);
    expect(webhookSecretMatches("abc123abc12", "abc123abc123")).toBe(false);
    expect(webhookSecretMatches(undefined, "abc123abc123")).toBe(false);
  });

  it("lists first, keeps existing hooks, resumes disabled ones and creates only what's missing", async () => {
    const url = webhookUrlFor("https://qa.example.com", "hook-secret-123");
    const api = fakeInstantly({
      "GET /webhooks": [
        () => ({
          body: {
            items: [
              { id: "w1", target_hook_url: url, event_type: "reply_received", campaign: null, status: 1 },
              { id: "w2", target_hook_url: url, event_type: "email_sent", campaign: null, status: -1 },
            ],
            next_starting_after: "w2",
          },
        }),
        () => ({ body: { items: [{ id: "w3", target_hook_url: "https://old.example.com/hook", event_type: "email_bounced", campaign: null, status: 1 }], next_starting_after: null } }),
      ],
      "POST /webhooks/:id/resume": () => ({ body: { id: "w2", status: 1 } }),
      "POST /webhooks": (c) => ({ body: { id: "w-new", ...c.body } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    const r = await p.ensureWebhooks(url, ["reply_received", "email_sent", "email_bounced"]);
    expect(r).toEqual({
      existing: [{ id: "w1", eventType: "reply_received" }],
      resumed: [{ id: "w2", eventType: "email_sent" }],
      created: [{ id: "w-new", eventType: "email_bounced" }],
    });
    expect(api.callsTo("GET", "/webhooks")[1]!.query.starting_after).toBe("w2");
    expect(api.callsTo("POST", "/webhooks")[0]!.body).toEqual({ target_hook_url: url, event_type: "email_bounced", name: "Quiet Accounts · email_bounced" });

    // Default subscription is all_events (the only way to get auto_reply_received).
    const api2 = fakeInstantly({ "GET /webhooks": () => ({ body: { items: [] } }), "POST /webhooks": (c) => ({ body: { id: "w-all", ...c.body } }) });
    const p2 = createInstantlyProvider({ apiKey: "k", fetch: api2.fetch });
    expect((await p2.ensureWebhooks(url)).created).toEqual([{ id: "w-all", eventType: "all_events" }]);
    await expect(p2.ensureWebhooks(url, ["auto_reply_received"])).rejects.toThrow(/all_events/);
  });
});
