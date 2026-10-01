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
    // back to yearly from the running year's end, never a year overlapping it from today
    expect(year).toMatch(/another year from October 20, .* Jack will text you the payment link\./);
    ov = await api("GET", "/api/businesses/ridge-tree");
    expect((ov.business as { plan: { billing: string; yearsPaidOn: string[] } }).plan).toMatchObject({ billing: "annual", yearsPaidOn: ["2025-10-20", "2026-10-20"] });
  });

  it("cancels in one text and refunds the unused year; UNDO then goes to a person, never the software", async () => {
    const done = await sms("cancel");
    expect(done).toMatch(/Done — cancelled\. No more notes, no more charges\./);
    // a yearly plan with nothing on its ledger yet: never more than the jobs it brought in (the year floor). The renewed
    // year was only texted, never known to be paid, so it's never promised: Jack refunds it if it was paid
    expect(done).toContain("$4,970.00 of your year comes back to your card within 5 business days. If you'd already paid for the year you renewed from October 20, Jack will refund all of it.");
    expect(done).not.toContain("$9,940");
    expect(done).toMatch(/Text UNDO by \d{1,2}(:\d\d)?(am|pm) tomorrow/);
    let ov = await api("GET", "/api/businesses/ridge-tree");
    expect((ov.business as { plan: { stage: string } }).plan.stage).toBe("cancelled");
    expect(ov.paused).toBe(true);
    expect((ov.counts as { queued: number }).queued).toBe(0);
    // the refund text is held for the operator (they issue it, then send), even though the client is cancelled
    const held = (await api("GET", "/api/businesses/ridge-tree/owner-messages?delivery=review")) as unknown as { kind: string; text: string }[];
    expect(held.find((m) => m.kind === "refund")!.text).toMatch(/goes back to your card within 5 business days/);
    // money may already be on its way, so UNDO is a person's job
    const undo = await sms("undo");
    expect(undo).toContain("Jack will put everything back himself");
    // a year-floor refund owed from an earlier year is waiting too: restoring the plan never withdraws that one
    const floor = { id: "om-floor-2024", at: "2026-09-20T09:00:00", kind: "refund", text: "Your year's numbers: $12.00 goes back to your card.", refs: [{ kind: "year_floor", id: "2024-10-20" }] };
    d.accounts.repo.db.run("INSERT INTO owner_messages (business_id, id, at, kind, text, data, delivery) VALUES ('ridge-tree', ?, ?, 'refund', ?, ?, 'review')", floor.id, floor.at, floor.text, JSON.stringify(floor));
    // the operator restores it (the refund was never issued): plan back, refund withdrawn, the year floor intact
    const restore = await app.request("/api/businesses/ridge-tree/restore-plan", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(restore.status).toBe(200);
    const after = await api("GET", "/api/businesses/ridge-tree");
    expect((after.business as { plan: { stage: string; yearRefunds?: unknown[] } }).plan.stage).toBe("paying");
    expect((after.business as { plan: { yearRefunds?: unknown[] } }).plan.yearRefunds ?? []).toHaveLength(0);
    expect(((await api("GET", "/api/businesses/ridge-tree/owner-messages?delivery=review")) as unknown as { id: string; kind: string }[]).filter((m) => m.kind === "refund").map((m) => m.id)).toEqual([floor.id]);
    // and a second restore finds nothing to do
    expect((await app.request("/api/businesses/ridge-tree/restore-plan", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(409);
    await sms("cancel");
    const review = (await api("GET", "/api/review")).items as { kind: string; alertKind?: string }[];
    expect(review.some((i) => i.kind === "alert" && i.alertKind === "undo_refund")).toBe(true);
    // "cancel the note to Karen" is never read as cancelling the service
    expect(await sms("Cancel the note to Karen, she already booked")).toContain("Text CANCEL on its own");
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

  it("an OK with a change in it is a change, never a start", async () => {
    for (const text of ["OK but don't email Karen Whitfield, she's my neighbor", "Looks good but change 'free estimate' to 'free quote'", "Send me the full list first", "No, say Hey instead of Hi", "cancel the note to the Smiths", "Hold on, can you change the greeting to Hey", "How many people is this going to?", "Free quote, not free estimate"]) {
      const reply = await sms(text);
      expect(reply, text).toMatch(/we'll make that change|Text CANCEL on its own/);
      expect(await approved(), text).toBe(0);
    }
  });

  it("starts on OK, once", async () => {
    const reply = await sms("Go for it");
    expect(reply).toContain("the first notes go out");
    const n = await approved();
    expect(n).toBeGreaterThan(0);
    const ov = await api("GET", "/api/businesses/ridge-tree");
    expect(ov.awaitingOwnerOk).toBeFalsy();
    // a second OK is just an OK now, not a second start
    expect(await sms("ok")).not.toContain("the first notes go out");
    expect(await approved()).toBe(n);
  });

  it("a top-up while the owner's OK is pending waits for it too", async () => {
    const d2 = d.accounts.peek("ridge-tree")!.state;
    // put the account back to waiting for the OK, with nothing approved, and plan again
    await d.accounts.withAccount("ridge-tree", (st) => {
      for (const t of st.touches) if (t.status === "approved") t.status = "planned";
      st.awaitingOwnerOk = "2026-09-29T10:00:00";
    });
    expect(d2).toBeTruthy();
    // more room in the round (a fuller export came in): the top-up plans more people, all waiting for the OK
    await api("PATCH", "/api/businesses/ridge-tree", { plan: { trialSize: 400 } });
    const p = await api("POST", "/api/businesses/ridge-tree/plan", {});
    expect(p.people as number).toBeGreaterThan(0);
    expect(p.awaitingOk).toBe(true);
    expect(await approved()).toBe(0);
  });
});
