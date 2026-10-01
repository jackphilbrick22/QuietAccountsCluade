import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSample, OFFERED_TRADES, type Customer, type ServiceRequest, type Touch } from "@qa/engine";
import { runAudit } from "../../site/src/audit.ts";
import { features, loadConfig } from "../src/config.ts";
import { linkToken, syncFsm } from "../src/core/ops.ts";
import { encrypt } from "../src/core/crypto.ts";
import { tick } from "../src/core/worker.ts";
import { createInstantlyProvider } from "../src/integrations/instantly/index.ts";
import type { FsmConnector } from "../src/contracts.ts";
import { LogNotifier } from "../src/providers/sms.ts";
import { fakeInstantly } from "./fake-instantly.ts";
import { harness, person, SECRET, WH, type Harness } from "./harness.ts";

/**
 * BRIEF A1: what neither offer sells is off unless the server says so. New-request answering sits behind
 * FEATURE_NEW_REQUESTS and the yearly plan behind FEATURE_YEARLY, both off by default; every account answers no hot
 * reply on the owner's behalf and holds nobody back.
 */

let open: Harness[] = [];
const make = (...a: Parameters<typeof harness>) => {
  const h = harness(...a);
  open.push(h);
  return h;
};
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

const state = (h: Harness, bid: string) => h.d.accounts.peek(bid)!.state;
const items = async (h: Harness) => (await h.api("GET", "/api/review")).json.items as Record<string, unknown>[];
const texts = (h: Harness) => (h.d.notifier as LogNotifier).sent.map((m) => m.text);
/** A client paying month to month, as the console's Settings sets it. */
const payingClient = async (h: Harness, bid: string, over: Record<string, unknown> = {}) => {
  await h.business(bid, over);
  expect((await h.api("PATCH", `/api/businesses/${bid}`, { plan: { stage: "paying", billing: "monthly", paidOn: "2026-08-01" } })).status).toBe(200);
};

describe("the switches", () => {
  it("new-request answering and the yearly plan are off unless set, and the engine gets them as set", () => {
    const base = { OPERATOR_TOKEN: "test-operator-token-789", APP_SECRET: SECRET, WEBHOOK_SECRET: WH };
    const off = loadConfig(base);
    expect([off.FEATURE_NEW_REQUESTS, off.FEATURE_YEARLY]).toEqual(["off", "off"]);
    expect(features(off)).toEqual({ newRequests: false, yearly: false });
    expect(features(loadConfig({ ...base, FEATURE_NEW_REQUESTS: "on" }))).toEqual({ newRequests: true, yearly: false });
    expect(features(loadConfig({ ...base, FEATURE_YEARLY: "on" }))).toEqual({ newRequests: false, yearly: true });
    expect(() => loadConfig({ ...base, FEATURE_YEARLY: "yes" })).toThrow(/FEATURE_YEARLY/);
  });
});

describe("a new account", () => {
  it("answers no hot reply on the owner's behalf and holds nobody back, from the console or the site", async () => {
    const h = make();
    await h.business("ridge");
    expect(state(h, "ridge").dataset.business).toMatchObject({ autoAck: false, persistence: { holdoutPct: 0 } });
    const r = await h.app.request("/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company: "Capital City Landscaping", first: "Tom", cell: "(603) 555-0177", trade: "lawn", consent: true }) });
    expect(r.status).toBe(201);
    const id = ((await r.json()) as { id: string }).id;
    expect(state(h, id).dataset.business).toMatchObject({ trade: "lawn", autoAck: false, persistence: { holdoutPct: 0 } });
  });

  it("signs up only for a trade the offers sell; any other is read from their file", async () => {
    const h = make();
    for (const [company, trade, want] of [["Clean Co", "cleaning", "cleaning"], ["Pump Co", "septic", "general"], ["Light Co", "holiday_lighting", "general"]] as const) {
      const r = await h.app.request("/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company, first: "Ann", cell: `(603) 555-0${company.length}${company.length}0`, trade, consent: true }) });
      const id = ((await r.json()) as { id: string }).id;
      expect([company, state(h, id).dataset.business.trade]).toEqual([company, want]);
    }
    // the operator's alert never points them at a Jobber login
    expect(h.d.accounts.repo.listBusinesses().flatMap((b) => h.d.accounts.repo.openAlerts(b.id)).map((a) => a.detail).join("\n")).not.toMatch(/Jobber/);
  });

  it("existing accounts are moved over once: autoAck off, nobody held back", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-offers-"));
    try {
      const h = harness({ dir });
      const old = (id: string, autoAck?: boolean) => JSON.stringify({ id, name: "Old Tree", ...(autoAck === undefined ? {} : { autoAck }), persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0.1 } });
      for (const [id, ack] of [["acked", true], ["unset", undefined]] as const)
        h.d.accounts.repo.db.run("INSERT INTO businesses (id, profile, as_of, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", id, old(id, ack), "2026-09-01", "2026-09-01", "2026-09-01");
      // as they were before this version
      h.d.accounts.repo.db.run("UPDATE schema_version SET v = 3");
      h.close();
      const again = harness({ dir });
      const profile = (id: string) => JSON.parse(again.d.accounts.repo.db.get<{ profile: string }>("SELECT profile FROM businesses WHERE id = ?", id)!.profile);
      for (const id of ["acked", "unset"]) expect(profile(id)).toEqual({ id, name: "Old Tree", autoAck: false, persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0 } });
      // once: an operator who turns either back on later keeps it
      again.d.accounts.repo.db.run("UPDATE businesses SET profile = json_set(profile, '$.persistence.holdoutPct', 0.1) WHERE id = 'acked'");
      again.close();
      const third = harness({ dir });
      expect(JSON.parse(third.d.accounts.repo.db.get<{ profile: string }>("SELECT profile FROM businesses WHERE id = 'acked'")!.profile).persistence.holdoutPct).toBe(0.1);
      expect(third.d.accounts.repo.db.get("SELECT v FROM schema_version")).toEqual({ v: 5 });
      third.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("new-request answering, off (the default)", () => {
  const ON = { env: { FEATURE_NEW_REQUESTS: "on", INBOUND_DOMAIN: "in.qa.test" } };
  const OFF = { env: { INBOUND_DOMAIN: "in.qa.test" } };
  // the owner forwards a website form to the address
  const inbound = (h: Harness, to: string) =>
    h.app.request(`/webhooks/inbound-email/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: `m-${to}`, From: "dave@ridgelinetree.com", To: to, Subject: "New request from your website", TextBody: "Name: Lisa Moore\nEmail: lisa.moore@outlook.com\nPhone: 603-555-0143\nMessage: Big oak over the garage, can you take a look?" }) });

  it("shows no requests address in any API response", async () => {
    const h = make(OFF);
    await h.business("ridge");
    const links = (await h.api("GET", "/api/businesses/ridge/links")).json;
    expect(links.importAddress).toMatch(/^import\+/);
    expect(JSON.stringify(links)).not.toMatch(/requests/);
    expect(JSON.stringify((await h.api("POST", "/api/businesses/ridge/links/rotate")).json)).not.toMatch(/requests/);
    for (const path of ["/api/businesses", "/api/businesses/ridge"]) expect(JSON.stringify((await h.api("GET", path)).json), path).not.toMatch(/requests\+/);
    expect((await h.api("GET", "/api/businesses/ridge")).json.features).toEqual({ newRequests: false, yearly: false });
    // turned on, the address is there
    const on = make(ON);
    await on.business("ridge");
    expect((await on.api("GET", "/api/businesses/ridge/links")).json.requestsAddress).toMatch(/^requests\+.*@in\.qa\.test$/);
    expect((await on.api("GET", "/api/businesses/ridge")).json.features).toEqual({ newRequests: true, yearly: false });
  });

  it("an email to a requests address is plain mail: nobody is answered, it waits in the review queue", async () => {
    const h = make(OFF);
    await payingClient(h, "ridge");
    const res = await inbound(h, `requests+${linkToken(h.d, "requests", "ridge")}@in.qa.test`);
    expect(((await res.json()) as Record<string, unknown>).taken).toBeUndefined();
    const s = state(h, "ridge");
    expect(s.dataset.requests).toEqual([]);
    expect(s.touches).toEqual([]);
    expect(texts(h)).toEqual([]);
    expect((await items(h)).filter((i) => i.kind === "unmatched_reply").map((i) => i.from)).toEqual(["dave@ridgelinetree.com"]);
    // turned on, the same email is a request, answered from the office
    const on = make(ON);
    await payingClient(on, "ridge");
    expect(((await (await inbound(on, `requests+${linkToken(on.d, "requests", "ridge")}@in.qa.test`)).json()) as Record<string, unknown>).taken).toBe(true);
    expect(state(on, "ridge").touches.filter((t) => t.track === "new_request")).toHaveLength(1);
  });

  it("a new request from Jobber gets no automatic answer, no instant campaign and no NEW REQUEST text", async () => {
    const run = async (opts: { env: Record<string, string> }) => {
      const api = fakeInstantly({
        "GET /campaigns": () => ({ body: { items: [] } }),
        "POST /campaigns": (c) => ({ body: { id: `camp-${c.body.name}`, status: 0 } }),
        "GET /campaigns/:id": () => ({ body: { id: "x", status: 0, sequences: [{ steps: [{ type: "email" }] }] } }),
        "POST /leads/add": (c) => ({ body: { leads_uploaded: c.body.leads.length, created_leads: c.body.leads.map((l: { email: string }, index: number) => ({ index, id: `lead-${l.email}`, email: l.email })) } }),
        "POST /leads/list": () => ({ body: { items: [] } }),
        "POST /campaigns/:id/activate": () => ({ body: { status: 1 } }),
      });
      const lisa: Customer = { ...person("c-lisa", "Lisa Moore"), sourceIds: ["jobber:c-lisa"], emails: ["lisa.moore@outlook.com"] };
      const request: ServiceRequest = { id: "jobber:r1", customerId: "c-lisa", title: "Big oak over the garage", status: "new", rawStatus: "New", createdOn: "2026-09-29", createdAt: "2026-09-29T13:50:00Z" };
      const jobber: FsmConnector = {
        source: "jobber",
        authorizeUrl: () => "https://jobber.test/auth",
        exchangeCode: async () => ({ accessToken: "a", refreshToken: "r" }),
        refresh: async (t) => t,
        pull: async () => ({ customers: [lisa], quotes: [], jobs: [], invoices: [], requests: [request], warnings: [] }),
        verifyWebhook: () => true,
        parseWebhook: () => undefined,
      };
      const h = make({ ...opts, fsm: { jobber }, email: createInstantlyProvider({ apiKey: "k", fetch: api.fetch, sleep: async () => {}, maxRetries: 0 }) });
      await payingClient(h, "ridge", { fromEmails: ["sarah@mail.test"] });
      h.d.accounts.repo.putIntegration("ridge", "jobber", { accountId: "acct-1", secret: encrypt(SECRET, JSON.stringify({ accessToken: "a", refreshToken: "r" })), status: "connected", lastSyncAt: "2026-09-29T12:00:00Z" });
      await syncFsm(h.d, "ridge", "jobber");
      return { h, campaigns: api.callsTo("POST", "/campaigns").map((c) => String(c.body.name)) };
    };
    const off = await run({ env: {} });
    expect(state(off.h, "ridge").dataset.requests.map((r) => r.title)).toEqual(["Big oak over the garage"]);
    expect(state(off.h, "ridge").touches).toEqual([]);
    expect(off.campaigns).toEqual([]);
    expect(texts(off.h).join("\n")).not.toMatch(/NEW REQUEST/);
    // turned on: answered through the instant campaign, and the owner gets the lead
    const on = await run({ env: { FEATURE_NEW_REQUESTS: "on" } });
    expect(state(on.h, "ridge").touches.filter((t: Touch) => t.instant)).toHaveLength(1);
    expect(on.campaigns.some((n) => n.endsWith("· instant"))).toBe(true);
    expect(texts(on.h).join("\n")).toMatch(/NEW REQUEST — Lisa Moore/);
  });
});

describe("the yearly plan, off (the default)", () => {
  const latest = (h: Harness, bid: string) => h.d.accounts.repo.ownerTexts(bid)[0]!;

  it("RENEW, YEARLY and ANNUAL change nothing and go to a person; the trial's MONTHLY yes still works", async () => {
    const h = make();
    await payingClient(h, "ridge");
    const before = JSON.stringify(state(h, "ridge").dataset.business.plan);
    for (const text of ["RENEW", "Yearly", "annual plan", "Renew for another year"]) {
      expect(await h.sms(text), text).toBe("Thanks — Jack will read this and get back to you. For a lead, text BOOKED + amount + the #code, DONE, or NO. Text HELP for everything else.");
      expect(latest(h, "ridge"), text).toMatchObject({ handled: "unrecognized", needs_person: 1 });
      expect(JSON.stringify(state(h, "ridge").dataset.business.plan), text).toBe(before);
    }
    const t = make();
    await t.business("trial");
    expect(await t.sms("Monthly")).toBe("Great — month to month it is. Jack will text you the payment link.");
    expect(latest(t, "trial")).toMatchObject({ handled: "accepted_close", needs_person: 1 });
    expect(await t.sms("Yearly")).not.toMatch(/the year it is/);
    expect(state(t, "trial").dataset.business.plan.stage).toBe("trial");
  });

  it("CANCEL is final: the reply never offers UNDO, and UNDO isn't honoured", async () => {
    const h = make();
    await payingClient(h, "ridge");
    const done = await h.sms("CANCEL");
    expect(done).toBe("Done — cancelled. No more notes, no more charges. So far: 0 booked, $0 on your ledger, and everything we found stays yours.");
    expect(state(h, "ridge").cancelled).toBeUndefined();
    expect(await h.sms("UNDO")).toBe("You're cancelled, so nothing's running. Want back in? Reply here and Jack will set it up.");
    expect(latest(h, "ridge")).toMatchObject({ handled: "undo_off", needs_person: 1 });
    expect(state(h, "ridge").dataset.business.plan.stage).toBe("cancelled");
    expect(await h.sms("CANCEL")).toBe("You're already cancelled. Want back in? Reply here and Jack will set it up.");
    expect((await h.api("POST", "/api/businesses/ridge/restore-plan")).status).toBe(409);
    expect(state(h, "ridge").dataset.business.plan.stage).toBe("cancelled");
    // nothing to undo on a running account either
    const r = make();
    await r.business("pine");
    expect(await r.sms("undo")).toBe("There's nothing to undo. Text HELP for what you can text us.");
  });

  it("no yearly promise reaches an owner: no refund 'within 5 business days', no 'Jack will put everything back himself today'", async () => {
    const h = make();
    await h.business("ridge");
    // a plan that reads as yearly (set before the switch): cancelling still promises no year's money back
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.business.plan = { ...s.dataset.business.plan, stage: "paying", billing: "annual", paidOn: "2026-06-01", yearsPaidOn: ["2026-06-01"] };
    });
    const done = await h.sms("CANCEL");
    expect(done).toMatch(/^Done — cancelled\./);
    const said = [done, await h.sms("UNDO"), ...texts(h), ...state(h, "ridge").ownerMessages.map((m) => m.text)].join("\n");
    expect(said).not.toMatch(/business days|put everything back|UNDO/);
    expect(state(h, "ridge").dataset.business.plan.yearRefunds).toBeUndefined();
  });

  it("no renewal ask, no settling a year, and the close never offers the year", async () => {
    // 9:30am New York: the daily checks run
    const h = make({ now: "2026-09-29T13:30:00Z" });
    await h.business("ridge");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.business.plan = { ...s.dataset.business.plan, stage: "paying", billing: "annual", paidOn: "2025-09-20", yearsPaidOn: ["2025-09-20"] };
    });
    await tick(h.d);
    const s = state(h, "ridge");
    expect(s.ownerMessages.filter((m) => m.kind === "renewal" || m.kind === "refund" || m.refs?.some((r) => r.kind === "year_floor"))).toEqual([]);
    expect(s.dataset.business.plan.settledYears).toBeUndefined();
    expect(s.dataset.business.plan.stage).toBe("paying");

    // the free round that brought back more than a year costs: still only the monthly offer
    const t = make();
    await t.business("trial");
    await t.d.accounts.withAccount("trial", (st) => {
      st.dataset.customers = [person("c1", "Kim Tran")];
      st.recoveries.push({ id: "big", customerId: "c1", record: { kind: "job", id: "j1" }, value: 9000, cameBackOn: "2026-09-20", match: "same_record", confidence: 1, tier: "traced" });
    });
    const close = (await t.api("GET", "/api/businesses/trial/close-preview")).json.text as string;
    expect(close).toMatch(/\$497 a month keeps it going/);
    expect(close).not.toMatch(/year|twelve months/i);
    const y = make({ env: { FEATURE_YEARLY: "on" } });
    await y.business("trial");
    await y.d.accounts.withAccount("trial", (st) => {
      st.dataset.customers = [person("c1", "Kim Tran")];
      st.recoveries.push({ id: "big", customerId: "c1", record: { kind: "job", id: "j1" }, value: 9000, cameBackOn: "2026-09-20", match: "same_record", confidence: 1, tier: "traced" });
    });
    expect((await y.api("GET", "/api/businesses/trial/close-preview")).json.text).toMatch(/Or pay for the year/);
  });

  it("the close never promises to follow every new quote, whatever is sold: it works everyone who drops off each month", async () => {
    const preview = async (h: Harness) => {
      await h.business("trial");
      return (await h.api("GET", "/api/businesses/trial/close-preview")).json.text as string;
    };
    for (const h of [make(), make({ env: { FEATURE_NEW_REQUESTS: "on" } })]) {
      const text = await preview(h);
      expect(text).not.toMatch(/new quote/);
      expect(text).toMatch(/keeps it going on the rest of the list and everyone who drops off each month\./);
    }
  });

  it("Settings can't set up a yearly plan", async () => {
    const h = make();
    await h.business("ridge");
    for (const plan of [{ billing: "annual", paidOn: "2026-09-29" }, { annualPrice: 4970 }, { yearsPaidOn: ["2026-09-29"] }]) {
      const r = await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", ...plan } });
      expect([JSON.stringify(plan), r.status]).toEqual([JSON.stringify(plan), 400]);
    }
    expect(state(h, "ridge").dataset.business.plan.stage).toBe("trial");
    // monthly billing saves as before
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", billing: "monthly", paidOn: "2026-09-29" } })).status).toBe(200);
    expect((await h.api("GET", "/api/businesses/ridge")).json.features).toEqual({ newRequests: false, yearly: false });
  });
});

describe("trades: only the six the offers sell are read", () => {
  it("the site's audit reads a shop as one of them, never as one of the other playbooks", { timeout: 60_000 }, () => {
    const audit = (trade: Parameters<typeof generateSample>[0]["trade"]) => runAudit(generateSample({ trade, asOf: "2026-09-29" }).files, { today: "2026-09-29" }).trade;
    expect(audit("lawn")).toBe("lawn");
    expect(audit("painting")).toBe("painting");
    for (const other of ["septic", "holiday_lighting", "deck"] as const) expect([...OFFERED_TRADES, "general"], other).toContain(audit(other));
    // "Standard Cleaning" is a cleaning shop's work, never a deck company's
    const csv = ["Client name,Client email,Quote title,Total,Status,Sent date", ...Array.from({ length: 12 }, (_, i) => `Pat Lee ${i},pat${i}@gmail.com,Standard Cleaning,180,Awaiting response,2026-0${(i % 8) + 1}-1${i % 9}`)].join("\n");
    expect(runAudit([{ name: "quotes.csv", text: csv }], { today: "2026-09-29" }).trade).toBe("cleaning");
  });
});
