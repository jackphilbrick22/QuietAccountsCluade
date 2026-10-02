import { describe, expect, it } from "vitest";
import { onePassPlan, type BusinessProfile } from "@qa/engine";
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
import { fakeInstantly, recordingSleep } from "./fake-instantly.ts";

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
    fromEmails: ["sarah@oaksons-mail.com"],
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
      "GET /campaigns": () => ({ body: { items: [{ id: "near-miss", name: "QA · Oak & Sons Tree · biz_oak · 3-step (old)" }], next_starting_after: null } }),
      "POST /campaigns": (c) => ({ body: { id: "camp-3", name: c.body.name, status: 0 } }),
    });
    const p = createInstantlyProvider({ apiKey: "key_123", fetch: api.fetch, dailyLimit: 40 });

    expect(await p.ensureCampaign(business({ fromEmails: ["sarah@oaksons-mail.com", "dave@oaksons-mail.com"] }), { maxSteps: 3 })).toEqual({ campaignId: "camp-3" });

    const [list] = api.callsTo("GET", "/campaigns");
    expect(list!.query.search).toBe("QA · Oak & Sons Tree · biz_oak · 3-step");
    expect(list!.headers.Authorization).toBe("Bearer key_123");
    expect(list!.headers["Content-Type"]).toBeUndefined();

    const [create] = api.callsTo("POST", "/campaigns");
    expect(create!.headers["Content-Type"]).toBe("application/json");
    expect(create!.body).toEqual({
      name: "QA · Oak & Sons Tree · biz_oak · 3-step",
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
      limit_emails_per_company_override: { mode: "disabled" },
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
    expect(api.callsTo("POST", "/campaigns").at(-1)!.body.name).toBe("QA · Oak & Sons Tree · biz_oak · 1-step");
    expect(api.callsTo("POST", "/campaigns").at(-1)!.body.sequences[0].steps).toEqual([
      { type: "email", delay: 0, delay_unit: "days", variants: [{ subject: "{{s1}}", body: "{{b1}}" }] },
    ]);
  });

  it("finds an existing campaign by exact name on a cold start, and concurrent calls share one lookup", async () => {
    const exact = "QA · Oak & Sons Tree · biz_oak · 2-step";
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
    const exact = "QA · Oak & Sons Tree · biz_oak · 2-step";
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

  it("gives two clients with the same name their own campaigns, with their own mailbox, even after a restart", async () => {
    const made: { id: string; name: string; email_list?: string[]; timezone: string }[] = [];
    const api = fakeInstantly({
      "GET /campaigns": (c) => ({ body: { items: made.filter((x) => x.name === c.query.search) } }),
      "POST /campaigns": (c) => {
        made.push({ id: `camp-${made.length + 1}`, name: c.body.name, email_list: c.body.email_list, timezone: c.body.campaign_schedule.schedules[0].timezone });
        return { body: { id: made.at(-1)!.id, status: 0 } };
      },
    });
    const boston = business({ id: "mts-boston", name: "Monster Tree Service", fromEmails: ["office@mts-boston.com"] });
    const denver = business({ id: "mts-denver", name: "Monster Tree Service", fromEmails: ["office@mts-denver.com"], timezone: "America/Denver" });
    const first = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    const b = (await first.ensureCampaign(boston, { maxSteps: 2 })).campaignId;
    // a restart: nothing cached, every campaign found by name
    const second = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    const dv = (await second.ensureCampaign(denver, { maxSteps: 2 })).campaignId;
    expect(dv).not.toBe(b);
    expect(made).toEqual([
      { id: b, name: "QA · Monster Tree Service · mts-boston · 2-step", email_list: ["office@mts-boston.com"], timezone: "America/Detroit" },
      { id: dv, name: "QA · Monster Tree Service · mts-denver · 2-step", email_list: ["office@mts-denver.com"], timezone: "America/Boise" },
    ]);
    const third = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    expect((await third.ensureCampaign(boston, { maxSteps: 2 })).campaignId).toBe(b);
    expect((await third.ensureCampaign(denver, { maxSteps: 2 })).campaignId).toBe(dv);
    expect((await third.ensureCampaign(denver, { maxSteps: 1, instant: true })).campaignId).not.toBe(dv);
    expect(made.at(-1)!.name).toBe("QA · Monster Tree Service · mts-denver · instant");
  });

  it("a campaign named the old way (no business id) is kept by the business whose notes are in it, and nobody else", async () => {
    const legacy = "QA · Oak & Sons Tree · 2-step";
    const api = fakeInstantly({
      "GET /campaigns": (c) => ({ body: { items: c.query.search === legacy ? [{ id: "camp-old", name: legacy }] : [] } }),
      "POST /campaigns": (c) => ({ body: { id: `new-${c.body.name}`, status: 0 } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    // the business that pushed into it before the rename keeps using it
    expect(await p.ensureCampaign(business(), { maxSteps: 2, used: ["camp-other", "camp-old"] })).toEqual({ campaignId: "camp-old" });
    expect(api.callsTo("GET", "/campaigns").map((c) => c.query.search)).toEqual(["QA · Oak & Sons Tree · biz_oak · 2-step", legacy]);
    expect(api.callsTo("POST", "/campaigns")).toHaveLength(0);
    // another client with the same name, whose notes were never in it, gets its own
    const twin = business({ id: "biz_oak_2" });
    expect(await p.ensureCampaign(twin, { maxSteps: 2, used: ["camp-other"] })).toEqual({ campaignId: "new-QA · Oak & Sons Tree · biz_oak_2 · 2-step" });
    // and a business with no notes out yet never looks at old names at all
    const fresh = business({ id: "biz_oak_3" });
    const lookups = api.callsTo("GET", "/campaigns").length;
    await p.ensureCampaign(fresh, { maxSteps: 2 });
    expect(api.callsTo("GET", "/campaigns").length).toBe(lookups + 1);
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
/* Sending inboxes and campaign updates                                */
/* ------------------------------------------------------------------ */

describe("sending inboxes", () => {
  it("sets an inbox's name and reads it back at /accounts/{email}, and lists every campaign it's in, page by page", async () => {
    const api = fakeInstantly({
      "PATCH /accounts/:email": (c) => ({ body: { email: "sarah@oaksons-mail.com", ...c.body } }),
      "GET /accounts/:email": () => ({ body: { email: "sarah@oaksons-mail.com", first_name: "Sarah", last_name: null, status: 1 } }),
      "GET /account-campaign-mappings/:email": [
        () => ({ body: { items: [{ campaign_id: "camp-2", campaign_name: "QA · Oak & Sons Tree · biz_oak · 2-step", timestamp_created: "2026-09-02T00:00:00Z", status: 1 }], next_starting_after: "2026-09-02T00:00:00Z" } }),
        () => ({ body: { items: [{ campaign_id: "cold-1", campaign_name: "Cold: tree owners", timestamp_created: "2026-09-01T00:00:00Z", status: 2 }] } }),
      ],
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    await p.setInbox(" Sarah@OakSons-Mail.com", { first: "Sarah", last: "at Oak & Sons Tree" });
    const [patch] = api.calls;
    expect(patch).toMatchObject({ method: "PATCH", path: "/accounts/sarah%40oaksons-mail.com", body: { first_name: "Sarah", last_name: "at Oak & Sons Tree" } });
    expect(await p.readInbox("sarah@oaksons-mail.com")).toEqual({ first: "Sarah", last: "" });
    expect(await p.inboxCampaigns("sarah@oaksons-mail.com")).toEqual([
      { id: "camp-2", name: "QA · Oak & Sons Tree · biz_oak · 2-step" },
      { id: "cold-1", name: "Cold: tree owners" },
    ]);
    const pages = api.calls.filter((c) => c.path === "/account-campaign-mappings/sarah%40oaksons-mail.com");
    expect(pages.map((c) => c.query.starting_after)).toEqual([undefined, "2026-09-02T00:00:00Z"]);
  });

  it("a missing inbox is a 404 the caller can tell apart", async () => {
    const api = fakeInstantly({});
    api.inbox("gone@oaksons-mail.com").missing = true;
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    await expect(p.setInbox("gone@oaksons-mail.com", { first: "Sarah", last: "" })).rejects.toMatchObject({ status: 404 });
  });

  it("brings a campaign made earlier up to the business's schedule and inboxes (PATCH /campaigns/{id})", async () => {
    const api = fakeInstantly({ "GET /campaigns": () => ({ body: { items: [] } }) });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch, dailyLimit: 40 });
    const b = business({ sendDays: [1, 3], sendWindow: [9, 12], timezone: "America/Chicago", fromEmails: ["sarah@oaksons-mail.com", "dave@oaksons-mail.com"] });
    await p.updateCampaign(b, "camp-2", {});
    await p.updateCampaign(b, "camp-now", { instant: true });
    const [nurture, instant] = api.callsTo("PATCH", "/campaigns/camp-2").concat(api.callsTo("PATCH", "/campaigns/camp-now"));
    expect(nurture!.body).toEqual({
      campaign_schedule: { schedules: [{ name: "Quiet Accounts", timing: { from: "09:00", to: "12:00" }, days: { "0": false, "1": true, "2": false, "3": true, "4": false, "5": false, "6": false }, timezone: "America/Chicago" }] },
      email_list: ["sarah@oaksons-mail.com", "dave@oaksons-mail.com"],
      daily_max_leads: 25,
    });
    // the instant campaign keeps its every-day hours; only the timezone and inboxes move
    expect(instant!.body.campaign_schedule.schedules[0]).toMatchObject({ timing: { from: "07:00", to: "20:00" }, timezone: "America/Chicago" });
    expect(instant!.body.email_list).toEqual(["sarah@oaksons-mail.com", "dave@oaksons-mail.com"]);
    expect(instant!.body.daily_max_leads).toBeUndefined();
    // a business with no inbox of its own gets no campaign at all, made or updated
    await expect(p.updateCampaign(business({ fromEmails: [] }), "camp-2", {})).rejects.toThrow(/Oak & Sons Tree has no sending inbox of its own/);
    await expect(p.ensureCampaign(business({ id: "biz_new", fromEmails: undefined }), { maxSteps: 2 })).rejects.toThrow(/no sending inbox/);
    expect(api.callsTo("POST", "/campaigns")).toHaveLength(0);
  });

  it("a one pass's campaigns carry its pace as it is: 30 a day for each inbox and its busiest day of new people, whatever the server's limit", async () => {
    const api = fakeInstantly({ "GET /campaigns": () => ({ body: { items: [] } }), "POST /campaigns": () => ({ body: { id: "camp-3", status: 0 } }) });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch, dailyLimit: 40 });
    const inboxes = ["sarah@oaksons-mail.com", "dave@oaksons-mail.com", "pat@oaksons-mail.com"];
    const pass = (dailyNew: number) => business({ fromEmails: inboxes, plan: onePassPlan({ startedOn: "2026-10-05", targetEndOn: "2026-11-04", pace: { inboxes: 3, endOn: "2026-11-04", lastFirst: "2026-10-23", dailyNew } }) });
    // any other client's 50 a day would be halved under the server's 40
    await p.ensureCampaign(pass(50), { maxSteps: 3 });
    expect(api.callsTo("POST", "/campaigns")[0]!.body).toMatchObject({ daily_limit: 90, daily_max_leads: 50 });
    await p.updateCampaign(pass(50), "camp-3", {});
    expect(api.callsTo("PATCH", "/campaigns/camp-3")[0]!.body).toMatchObject({ daily_limit: 90, daily_max_leads: 50 });
    // a first day as full as the inboxes go stays one under the limit, where Instantly would starve the follow-ups
    await p.updateCampaign(pass(90), "camp-3", {});
    expect(api.callsTo("PATCH", "/campaigns/camp-3")[1]!.body).toMatchObject({ daily_limit: 90, daily_max_leads: 89 });
  });

  it("writes an inbox's daily limit with its name in one PATCH, and reads it back", async () => {
    const api = fakeInstantly({});
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    await p.setInbox("sarah@oaksons-mail.com", { first: "Sarah", last: "at Oak & Sons Tree", dailyLimit: 30 });
    expect(api.callsTo("PATCH", "/accounts/sarah%40oaksons-mail.com").map((c) => c.body)).toEqual([{ first_name: "Sarah", last_name: "at Oak & Sons Tree", daily_limit: 30 }]);
    expect(await p.readInbox("sarah@oaksons-mail.com")).toEqual({ first: "Sarah", last: "at Oak & Sons Tree", dailyLimit: 30 });
    // none set, none read
    expect(await p.readInbox("dave@oaksons-mail.com")).toEqual({ first: "Jack", last: "Philbrick" });
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
/* The instant campaign (answers to new requests)                      */
/* ------------------------------------------------------------------ */

describe("instant campaign", () => {
  it("is a separate 1-step campaign: new leads first, no new-lead cap, minimal gaps, every day 7:00–20:00 local", async () => {
    const api = fakeInstantly({
      "GET /campaigns": () => ({ body: { items: [] } }),
      "POST /campaigns": (c) => ({ body: { id: c.body.name.endsWith("instant") ? "camp-now" : "camp-1", status: 0 } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch, dailyLimit: 40 });
    expect(await p.ensureCampaign(business({ timezone: "America/Chicago" }), { maxSteps: 1, instant: true })).toEqual({ campaignId: "camp-now" });
    const [create] = api.callsTo("POST", "/campaigns");
    expect(api.callsTo("GET", "/campaigns")[0]!.query.search).toBe("QA · Oak & Sons Tree · biz_oak · instant");
    expect(create!.body).toEqual({
      name: "QA · Oak & Sons Tree · biz_oak · instant",
      campaign_schedule: {
        schedules: [
          {
            name: "Quiet Accounts",
            timing: { from: "07:00", to: "20:00" },
            days: { "0": true, "1": true, "2": true, "3": true, "4": true, "5": true, "6": true },
            timezone: "America/Chicago",
          },
        ],
      },
      sequences: [{ steps: [{ type: "email", delay: 0, delay_unit: "days", variants: [{ subject: "{{s1}}", body: "{{b1}}" }] }] }],
      email_list: ["sarah@oaksons-mail.com"],
      daily_limit: 40,
      email_gap: 1,
      random_wait_max: 1,
      stop_on_reply: true,
      stop_on_auto_reply: false,
      stop_for_company: false,
      limit_emails_per_company_override: { mode: "disabled" },
      text_only: true,
      first_email_text_only: true,
      link_tracking: false,
      open_tracking: false,
      insert_unsubscribe_header: true,
      prioritize_new_leads: true,
      match_lead_esp: false,
    });
    expect(create!.body.daily_max_leads).toBeUndefined();
    // cached apart from the 1-step nurture campaign
    expect(await p.ensureCampaign(business(), { maxSteps: 1, instant: true })).toEqual({ campaignId: "camp-now" });
    expect(await p.ensureCampaign(business(), { maxSteps: 1 })).toEqual({ campaignId: "camp-1" });
    expect(api.callsTo("POST", "/campaigns").map((c) => c.body.name)).toEqual(["QA · Oak & Sons Tree · biz_oak · instant", "QA · Oak & Sons Tree · biz_oak · 1-step"]);
    await expect(p.ensureCampaign(business(), { maxSteps: 2, instant: true })).rejects.toThrow(/one note/);
  });

  it("answers a returning homeowner again: a Completed lead is replaced, a still-sending one is left alone", async () => {
    const api = fakeInstantly({
      "GET /campaigns": () => ({ body: { items: [{ id: "camp-now", name: "QA · Oak & Sons Tree · biz_oak · instant" }] } }),
      "GET /campaigns/camp-now": () => ({ body: campaignWithSteps("camp-now", 1, 3) }),
      "POST /leads/list": () => ({
        body: {
          items: [
            { id: "old", email: "person0@example.com", campaign: "camp-now", status: 3 },
            { id: "busy", email: "person1@example.com", campaign: "camp-now", status: 1 },
          ],
        },
      }),
      "DELETE /leads/:id": (c) => ({ body: { id: c.path.split("/").pop() } }),
      "POST /leads/add": () => ({ body: { leads_uploaded: 1, created_leads: [{ index: 0, id: "new", email: "person0@example.com" }] } }),
      "POST /campaigns/:id/activate": () => ({ body: { id: "camp-now", status: 1 } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    const { campaignId } = await p.ensureCampaign(business(), { maxSteps: 1, instant: true });
    await p.upsertLeads(business(), campaignId, [lead(0, 1), lead(1, 1)]);
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /campaigns",
      "GET /campaigns/camp-now",
      "POST /leads/list",
      "DELETE /leads/old",
      "POST /leads/add",
      "POST /leads/list",
      "POST /campaigns/camp-now/activate",
    ]);
  });

  it("never deletes leads from a nurture campaign before adding", async () => {
    const api = fakeInstantly({
      "GET /campaigns/camp-2": () => ({ body: campaignWithSteps("camp-2", 2, 1) }),
      "POST /leads/add": () => ({ body: { leads_uploaded: 1, created_leads: [{ index: 0, id: "l0", email: "person0@example.com" }] } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    await p.upsertLeads(business(), "camp-2", [lead(0)]);
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /campaigns/camp-2", "POST /leads/add"]);
  });
});

/* ------------------------------------------------------------------ */
/* Answering in a thread                                               */
/* ------------------------------------------------------------------ */

describe("replyTo", () => {
  const theirReply = { id: "em-1", thread_id: "th-1", from_address_email: "Pat.Lee@Example.com", to_address_email_list: "sarah@oaksons-mail.com", lead: "pat.lee@example.com", i_sent: false };
  const thread = { replyEmailId: "em-1", account: "sarah@oaksons-mail.com", to: "pat.lee@example.com", subject: "Re: the oak" };

  it("checks the email's recipients first, then replies without a `to` field and with <br/> line breaks", async () => {
    const api = fakeInstantly({ "GET /emails/:id": () => ({ body: theirReply }), "POST /emails/reply": () => ({ body: { id: "sent-1" } }) });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    await p.replyTo!(business(), { ...thread, to: "PAT.LEE@example.com" }, "Thanks Pat!\r\n\r\nDave will call you today.\nSarah <office> & co");
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /emails/em-1", "POST /emails/reply"]);
    expect(api.calls[1]!.body).toEqual({
      reply_to_uuid: "em-1",
      eaccount: "sarah@oaksons-mail.com",
      subject: "Re: the oak",
      body: { text: "Thanks Pat!\r\n\r\nDave will call you today.\nSarah <office> & co", html: "Thanks Pat!<br/><br/>Dave will call you today.<br/>Sarah &lt;office&gt; &amp; co" },
    });
  });

  it("refuses (not retryable) and sends nothing when the email isn't to or from that person", async () => {
    const api = fakeInstantly({
      "GET /emails/:id": () => ({ body: { ...theirReply, from_address_email: "someone@else.com", lead: "someone@else.com" } }),
      "POST /emails/reply": () => ({ body: { id: "sent-1" } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    const err = await p.replyTo!(business(), thread, "Thanks!").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ provider: "instantly", retryable: false });
    expect((err as Error).message).toMatch(/not pat\.lee@example\.com/);
    expect(api.callsTo("POST", "/emails/reply")).toHaveLength(0);
  });

  it("counts the sender only when we didn't send it, and reads comma lists", async () => {
    const ours = { id: "em-2", from_address_email: "sarah@oaksons-mail.com", to_address_email_list: "pat.lee@example.com, Jo <jo.lee@example.com>", i_sent: true };
    const api = fakeInstantly({ "GET /emails/:id": () => ({ body: ours }), "POST /emails/reply": () => ({ body: {} }) });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    await expect(p.replyTo!(business(), { ...thread, replyEmailId: "em-2", to: "sarah@oaksons-mail.com" }, "x")).rejects.toBeInstanceOf(ProviderError);
    await p.replyTo!(business(), { ...thread, replyEmailId: "em-2", to: "jo.lee@example.com" }, "x");
    expect(api.callsTo("POST", "/emails/reply")).toHaveLength(1);
  });

  it("sends nothing when the email can't be read", async () => {
    const api = fakeInstantly({ "POST /emails/reply": () => ({ body: {} }) });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    await expect(p.replyTo!(business(), thread, "x")).rejects.toMatchObject({ status: 404 });
    expect(api.callsTo("POST", "/emails/reply")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Reply backstop API                                                  */
/* ------------------------------------------------------------------ */

describe("reply backstop API", () => {
  it("lists received emails since a time, from the main inbox and the Others folder", async () => {
    const email = {
      id: "em-9",
      thread_id: "th-9",
      timestamp_created: "2026-10-06T15:00:00.000Z",
      timestamp_email: "2026-10-06T14:58:00.000Z",
      subject: "Re: the oak",
      from_address_email: "Jo Lee <Jo.Lee@Example.com>",
      to_address_email_list: "sarah@oaksons-mail.com",
      eaccount: "sarah@oaksons-mail.com",
      lead: null,
      body: { html: "<div>Yes please &amp; thanks</div><div>Jo</div>" },
    };
    const api = fakeInstantly({ "GET /emails": [() => ({ body: { items: [email, { id: "junk" }], next_starting_after: null } }), () => ({ body: { items: [] } })] });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    expect(await p.receivedSince!("2026-10-06T14:00:00.000Z", { folder: "primary" })).toEqual([
      {
        id: "em-9",
        threadId: "th-9",
        from: "jo.lee@example.com",
        lead: undefined,
        to: ["sarah@oaksons-mail.com"],
        account: "sarah@oaksons-mail.com",
        subject: "Re: the oak",
        text: "Yes please & thanks\nJo",
        receivedAt: "2026-10-06T14:58:00.000Z",
        createdAt: "2026-10-06T15:00:00.000Z",
        campaignId: undefined,
        sentByUs: false,
      },
    ]);
    await p.receivedSince!("2026-10-06T14:00:00.000Z", { folder: "others" });
    const [primary, others] = api.callsTo("GET", "/emails");
    expect(primary!.query).toEqual({ email_type: "received", min_timestamp_created: "2026-10-06T14:00:00.000Z", limit: "100" });
    expect(others!.query).toEqual({ email_type: "received", min_timestamp_created: "2026-10-06T14:00:00.000Z", mode: "emode_others", limit: "100" });
  });

  it("finds a thread's emails, keeping only that thread", async () => {
    const api = fakeInstantly({
      "GET /emails": () => ({
        body: {
          items: [
            { id: "a", thread_id: "th-9", timestamp_created: "2026-10-05T13:00:00Z", from_address_email: "sarah@oaksons-mail.com", to_address_email_list: "pat.lee@example.com", i_sent: true },
            { id: "b", thread_id: "th-other", timestamp_created: "2026-10-05T13:00:00Z", from_address_email: "x@y.com" },
          ],
        },
      }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    const t = await p.threadEmails!("th-9");
    expect(t.map((e) => [e.id, e.to, e.sentByUs])).toEqual([["a", ["pat.lee@example.com"], true]]);
    expect(api.calls[0]!.query).toEqual({ search: "thread:th-9", limit: "20" });
  });

  it("resumes only webhooks Instantly disabled", async () => {
    const api = fakeInstantly({
      "GET /webhooks": () => ({
        body: {
          items: [
            { id: "w1", target_hook_url: "https://qa.example.com/webhooks/instantly/s", event_type: "all_events", status: -1 },
            { id: "w2", target_hook_url: "https://other.example.com/hook", event_type: "email_sent", status: 1 },
          ],
        },
      }),
      "POST /webhooks/:id/resume": () => ({ body: { status: 1 } }),
    });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    expect(await p.resumeWebhooks!()).toEqual([{ id: "w1", url: "https://qa.example.com/webhooks/instantly/s", eventType: "all_events" }]);
    expect(api.callsTo("POST", "/webhooks/w1/resume")).toHaveLength(1);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
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

  it("reads a campaign as sending only when it's Active or running subsequences", async () => {
    const statuses = [1, 4, 2, -2, -1, 0, 3, -99];
    const api = fakeInstantly({ "GET /campaigns/:id": statuses.map((status) => () => ({ body: campaignWithSteps("camp-2", 2, status) })) });
    const p = createInstantlyProvider({ apiKey: "k", fetch: api.fetch });
    const running: boolean[] = [];
    for (const _ of statuses) running.push(await p.campaignRunning(business(), "camp-2"));
    expect(running).toEqual([true, true, false, false, false, false, false, false]);
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(statuses.map(() => "GET /campaigns/camp-2"));
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
      replyEmailId: "0199b1a2-reply",
      toAccount: base.email_account,
      // no thread headers from Instantly: our lead variable names the record, the step the note
      customerId: "cus_1",
      inReplyTo: "instantly:camp-2:pat.lee@example.com:1",
    });
    expect(isInstantlyAutoReply(body)).toBe(false);
  });

  it("reply_received names the exact note through our qa_touch_N variable", () => {
    const body = { ...base, event_type: "reply_received", step: 1, email_id: "0199b1a2-reply", reply_text: "Yes please", qa_touch_1: "t_req_2" };
    expect(parseInstantlyWebhook(body, now)).toMatchObject({ type: "reply", touchId: "t_req_2", customerId: "cus_1" });
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

  it("email_sent names the exact note through our qa_touch_N variable", () => {
    const body = { ...base, event_type: "email_sent", step: 1, email_id: "0199b1a2-sent", qa_touch_1: "t_req_1", qa_touch_2: "t_other" };
    expect(parseInstantlyWebhook(body, now)).toMatchObject({ type: "sent", step: 1, touchId: "t_req_1" });
    expect(parseInstantlyWebhook({ ...body, qa_touch_1: undefined, payload: { qa_touch_1: "t_nested" } }, now)).toMatchObject({ touchId: "t_nested" });
  });

  it("account_error → an alert about the mailbox (it has no lead)", () => {
    const { lead_email: _l, ...noLead } = base;
    expect(parseInstantlyWebhook({ ...noLead, event_type: "account_error", email_account: "Sarah@Oaksons-Mail.com", error: "SMTP authentication failed" }, now)).toEqual({
      type: "account_error",
      businessId: "biz_oak",
      campaignId: "camp-2",
      account: "sarah@oaksons-mail.com",
      detail: "SMTP authentication failed",
      at: "2026-10-06T14:03:11.000Z",
    });
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
