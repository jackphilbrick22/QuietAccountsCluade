import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSample } from "@qa/engine";
import { loadConfig } from "../src/config.ts";
import { Db } from "../src/db/sqlite.ts";
import { Repo } from "../src/db/repo.ts";
import { Accounts } from "../src/core/accounts.ts";
import { createApp, type HttpDeps } from "../src/http/app.ts";
import { LogEmailProvider } from "../src/providers/email.ts";
import { LogNotifier } from "../src/providers/sms.ts";
import { parseBusyUntil } from "../src/core/ops.ts";

describe("parseBusyUntil", () => {
  const today = "2026-09-29";
  it("reads weeks, days and months", () => {
    expect(parseBusyUntil("busy 6 weeks", today)).toBe("2026-11-10");
    expect(parseBusyUntil("busy for 10 days", today)).toBe("2026-10-09");
    expect(parseBusyUntil("booked out 2 months", today)).toBe("2026-11-29");
  });
  it("reads month names and m/d, rolling into next year when past", () => {
    expect(parseBusyUntil("busy until nov 15", today)).toBe("2026-11-15");
    expect(parseBusyUntil("busy till december", today)).toBe("2026-12-01");
    expect(parseBusyUntil("busy until 11/15", today)).toBe("2026-11-15");
    expect(parseBusyUntil("busy until march", today)).toBe("2027-03-01");
    expect(parseBusyUntil("booked solid thru aug 3", today)).toBe("2027-08-03");
  });
  it("defaults plain busy to four weeks", () => {
    expect(parseBusyUntil("busy", today)).toBe("2026-10-27");
  });
});

describe("owner texts BUSY / OPEN", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-sms-"));
  const dbPath = join(dir, "qa.db");
  const TOKEN = "test-operator-token-123";
  const WH = "test-webhook-secret";
  const now = new Date("2026-09-29T14:00:00Z");
  let d: HttpDeps;
  let app: ReturnType<typeof createApp>;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await res.json()) as Record<string, unknown>;
  };
  const sms = async (body: string) => {
    const res = await app.request(`/webhooks/sms/${WH}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: "+16035550199", Body: body }) });
    return res.text();
  };
  const firstNotes = async () => {
    const t = await api("GET", "/api/businesses/ridge-tree/touches?limit=5000");
    return (t.items as { step: number; dueAt: string; status: string }[]).filter((x) => x.step === 1 && x.status === "approved");
  };

  beforeAll(async () => {
    const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: TOKEN, APP_SECRET: "test-app-secret-0123456789", WEBHOOK_SECRET: WH, PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false" });
    d = { cfg, accounts: new Accounts(new Repo(new Db(dbPath))), email: new LogEmailProvider({ quiet: true }), notifier: new LogNotifier(true), llm: null, fsm: {}, log: () => {}, clock: () => now, parsers: {} };
    app = createApp(d);
    const sample = generateSample({ trade: "tree", asOf: "2026-09-29" });
    await api("POST", "/api/businesses", { id: "ridge-tree", name: "Ridgeline Tree Co.", trade: "tree", ownerName: "Dave Ridge", ownerPhone: "+16035550199", signerName: "Sarah", mailingAddress: "14 Mill Rd, Concord, NH 03301", city: "Concord", state: "NH", timezone: "America/New_York" });
    await api("POST", "/api/businesses/ridge-tree/imports", { files: sample.files.map((f) => ({ name: f.name, text: f.text, kind: f.kind })) });
    await api("POST", "/api/businesses/ridge-tree/plan", { approve: true });
  });
  afterAll(() => {
    d.accounts.repo.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("holds new work until about three weeks before the schedule opens", async () => {
    const before = await firstNotes();
    expect(before.some((x) => x.dueAt < "2026-11-03")).toBe(true);
    const reply = await sms("BUSY 8 weeks");
    expect(reply).toContain("new work waits");
    expect(reply).toMatch(/Moved \d+/);
    const after = await firstNotes();
    // the only first notes left before the floor are people who already said yes
    const early = after.filter((x) => x.dueAt < "2026-11-03");
    const ov = await api("GET", "/api/businesses/ridge-tree");
    expect((ov.business as { bookedOutUntil?: string }).bookedOutUntil).toBe("2026-11-24");
    expect(early.length).toBeLessThan(before.filter((x) => x.dueAt < "2026-11-03").length);
  });

  it("brings held notes back when the owner texts OPEN", async () => {
    const reply = await sms("open");
    expect(reply).toContain("back on");
    const after = await firstNotes();
    expect(after.some((x) => x.dueAt < "2026-10-10")).toBe(true);
    const ov = await api("GET", "/api/businesses/ridge-tree");
    expect((ov.business as { bookedOutUntil?: string }).bookedOutUntil).toBeUndefined();
  });

  it("still logs bookings: 'booked 2400' is not a busy command", async () => {
    const reply = await sms("booked 2400");
    expect(reply).not.toContain("new work waits");
  });

  it("a yearly owner texts MONTHLY to go month to month, RENEW for another year", async () => {
    await api("PATCH", "/api/businesses/ridge-tree", { plan: { stage: "paying", billing: "annual", paidOn: "2025-10-20", yearsPaidOn: ["2025-10-20"] } });
    const monthly = await sms("monthly");
    expect(monthly).toContain("month to month from October 20");
    let ov = await api("GET", "/api/businesses/ridge-tree");
    expect((ov.business as { plan: { billing: string; paidOn: string } }).plan).toMatchObject({ billing: "monthly", paidOn: "2026-10-20" });
    const year = await sms("Renew");
    expect(year).toMatch(/another year from .* Jack will text you the payment link\./);
    ov = await api("GET", "/api/businesses/ridge-tree");
    expect((ov.business as { plan: { billing: string } }).plan.billing).toBe("annual");
  });

  it("cancels by text: facts first, then CANCEL YES does it", async () => {
    const first = await sms("cancel");
    expect(first).toContain("CANCEL YES");
    let ov = await api("GET", "/api/businesses/ridge-tree");
    expect((ov.business as { plan: { stage: string } }).plan.stage).not.toBe("cancelled");
    const done = await sms("Cancel yes");
    expect(done).toContain("cancelled");
    ov = await api("GET", "/api/businesses/ridge-tree");
    expect((ov.business as { plan: { stage: string } }).plan.stage).toBe("cancelled");
    expect(ov.paused).toBe(true);
    expect((ov.counts as { queued: number }).queued).toBe(0);
  });
});

describe("the owner texts SKIP and a name", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-skip-"));
  const dbPath = join(dir, "qa.db");
  const TOKEN = "test-operator-token-123";
  const WH = "test-webhook-secret";
  const now = new Date("2026-09-29T14:00:00Z");
  let d: HttpDeps;
  let app: ReturnType<typeof createApp>;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await res.json()) as Record<string, unknown>;
  };
  const sms = async (body: string) => {
    const res = await app.request(`/webhooks/sms/${WH}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: "+16035550199", Body: body }) });
    return res.text();
  };

  beforeAll(async () => {
    const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: TOKEN, APP_SECRET: "test-app-secret-0123456789", WEBHOOK_SECRET: WH, PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false" });
    d = { cfg, accounts: new Accounts(new Repo(new Db(dbPath))), email: new LogEmailProvider({ quiet: true }), notifier: new LogNotifier(true), llm: null, fsm: {}, log: () => {}, clock: () => now, parsers: {} };
    app = createApp(d);
    const sample = generateSample({ trade: "tree", asOf: "2026-09-29" });
    await api("POST", "/api/businesses", { id: "ridge-tree", name: "Ridgeline Tree Co.", trade: "tree", ownerName: "Dave Ridge", ownerPhone: "+16035550199", signerName: "Sarah", mailingAddress: "14 Mill Rd, Concord, NH 03301", city: "Concord", state: "NH", timezone: "America/New_York" });
    await api("POST", "/api/businesses/ridge-tree/imports", { files: sample.files.map((f) => ({ name: f.name, text: f.text, kind: f.kind })) });
    await api("POST", "/api/businesses/ridge-tree/plan", { approve: true });
  });
  afterAll(() => {
    d.accounts.repo.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("takes one person off every list and stops what's queued for them", async () => {
    const st = d.accounts.peek("ridge-tree")!.state;
    const queued = st.touches.filter((t) => t.status === "approved");
    const target = queued.map((t) => st.dataset.customers.find((c) => c.id === t.customerId)!).find((c) => st.dataset.customers.filter((x) => x.name === c.name).length === 1)!;
    const reply = await sms(`Skip ${target.name}`);
    expect(reply).toContain(`${target.name} is off the list`);
    const after = d.accounts.peek("ridge-tree")!.state;
    expect(after.dataset.customers.find((c) => c.id === target.id)!.doNotContact).toBe(true);
    expect(after.touches.filter((t) => t.customerId === target.id && (t.status === "approved" || t.status === "planned"))).toHaveLength(0);
    expect(after.events.at(-1)!.title).toBe(`${target.name} taken off the list`);
  });

  it("asks when a name fits more than one person, and hands an unknown name to a person", async () => {
    const st = d.accounts.peek("ridge-tree")!.state;
    const last = st.dataset.customers.map((c) => c.lastName).find((ln) => ln && st.dataset.customers.filter((c) => c.lastName === ln && !c.doNotContact).length > 1)!;
    const ask = await sms(`SKIP ${last}`);
    expect(ask).toMatch(/That fits \d+:/);
    expect(ask).toContain("Text SKIP with the full name");
    const none = await sms("skip Zebediah Quackenbush");
    expect(none).toContain("couldn't find");
  });
});

describe("the owner OKs the first note by text", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-ok-"));
  const dbPath = join(dir, "qa.db");
  const TOKEN = "test-operator-token-123";
  const WH = "test-webhook-secret";
  const now = new Date("2026-09-29T14:00:00Z");
  let d: HttpDeps;
  let app: ReturnType<typeof createApp>;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await res.json()) as Record<string, unknown>;
  };
  const sms = async (body: string) => {
    const res = await app.request(`/webhooks/sms/${WH}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: "+16035550199", Body: body }) });
    return res.text();
  };
  const approved = async () => ((await api("GET", "/api/businesses/ridge-tree/touches?status=approved&limit=5000")).items as unknown[]).length;

  beforeAll(async () => {
    const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: TOKEN, APP_SECRET: "test-app-secret-0123456789", WEBHOOK_SECRET: WH, PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false" });
    d = { cfg, accounts: new Accounts(new Repo(new Db(dbPath))), email: new LogEmailProvider({ quiet: true }), notifier: new LogNotifier(true), llm: null, fsm: {}, log: () => {}, clock: () => now, parsers: {} };
    app = createApp(d);
    const sample = generateSample({ trade: "tree", asOf: "2026-09-29" });
    await api("POST", "/api/businesses", { id: "ridge-tree", name: "Ridgeline Tree Co.", trade: "tree", ownerName: "Dave Ridge", ownerPhone: "+16035550199", signerName: "Sarah", mailingAddress: "14 Mill Rd, Concord, NH 03301", city: "Concord", state: "NH", timezone: "America/New_York" });
    await api("POST", "/api/businesses/ridge-tree/imports", { files: sample.files.map((f) => ({ name: f.name, text: f.text, kind: f.kind })) });
  });
  afterAll(() => {
    d.accounts.repo.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("plans the free round but sends nothing until the owner says OK", async () => {
    const p = await api("POST", "/api/businesses/ridge-tree/plan", {});
    expect(p.awaitingOk).toBe(true);
    expect(await approved()).toBe(0);
    const ov = await api("GET", "/api/businesses/ridge-tree");
    expect(ov.awaitingOwnerOk).toBeTruthy();
  });

  it("takes anything but OK as a change request and still sends nothing", async () => {
    const reply = await sms("Can you say we're in Concord not Bow");
    expect(reply).toContain("we'll make that change");
    expect(reply).toContain("Nothing goes out until you say OK");
    expect(await approved()).toBe(0);
    const inbox = await api("GET", "/api/review");
    expect(JSON.stringify(inbox)).toContain("first_note_change");
  });

  it("starts on OK, once", async () => {
    const reply = await sms("Looks good");
    expect(reply).toContain("the first notes go out");
    const n = await approved();
    expect(n).toBeGreaterThan(0);
    const ov = await api("GET", "/api/businesses/ridge-tree");
    expect(ov.awaitingOwnerOk).toBeFalsy();
    // a second OK is just an OK now, not a second start
    expect(await sms("ok")).not.toContain("the first notes go out");
    expect(await approved()).toBe(n);
  });
});
