import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSample } from "@qa/engine";
import { loadConfig } from "../src/config.ts";
import { Db } from "../src/db/sqlite.ts";
import { Repo } from "../src/db/repo.ts";
import { Accounts } from "../src/core/accounts.ts";
import { tick } from "../src/core/worker.ts";
import { createApp, type HttpDeps } from "../src/http/app.ts";
import { LogEmailProvider } from "../src/providers/email.ts";
import { LogNotifier } from "../src/providers/sms.ts";
import { sign } from "../src/core/ops.ts";

/**
 * The whole loop through the real HTTP API, worker and SQLite file:
 * create → import exports → plan the free round → worker sends on schedule →
 * homeowner replies → owner gets the hand-off text → owner texts "booked 2400" →
 * recovered revenue → stop/unsubscribe honored → Friday report → restart from disk intact.
 */
const dir = mkdtempSync(join(tmpdir(), "qa-e2e-"));
const dbPath = join(dir, "qa.db");
let now = new Date("2026-09-29T14:00:00Z"); // Tue 10:00 America/New_York
const TOKEN = "test-operator-token-123";
const WH = "test-webhook-secret";

function makeDeps(): HttpDeps & { email: LogEmailProvider; notifier: LogNotifier } {
  const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: TOKEN, APP_SECRET: "test-app-secret-0123456789", WEBHOOK_SECRET: WH, PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false" });
  const accounts = new Accounts(new Repo(new Db(dbPath)));
  return {
    cfg,
    accounts,
    email: new LogEmailProvider({ quiet: true }),
    notifier: new LogNotifier(true),
    llm: null,
    fsm: {},
    log: () => {},
    clock: () => now,
    parsers: {},
  };
}

let d: ReturnType<typeof makeDeps>;
let app: ReturnType<typeof createApp>;
let bid = "";
let ownerToken = "";
const sample = generateSample({ trade: "tree", asOf: "2026-09-29" });

async function api(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json: json as Record<string, unknown> };
}

async function advanceTo(iso: string, ticks = 1) {
  now = new Date(iso);
  for (let i = 0; i < ticks; i++) await tick(d);
}

beforeAll(() => {
  d = makeDeps();
  app = createApp(d);
});
afterAll(() => {
  d.accounts.repo.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("end to end", () => {
  it("rejects calls without the operator token", async () => {
    const res = await app.request("/api/businesses");
    expect(res.status).toBe(401);
  });

  it("creates a business", async () => {
    const r = await api("POST", "/api/businesses", {
      id: "ridgeline-tree",
      name: "Ridgeline Tree Co.",
      trade: "tree",
      ownerName: "Dave Ridge",
      ownerPhone: "+16035550199",
      signerName: "Sarah",
      mailingAddress: "14 Mill Rd, Concord, NH 03301",
      city: "Concord",
      state: "NH",
      timezone: "America/New_York",
    });
    expect(r.status).toBe(201);
    bid = r.json.id as string;
    expect(bid).toBe("ridgeline-tree");
    expect(String(r.json.ownerLink)).toContain("https://qa.test/o/");
    ownerToken = String(r.json.ownerLink).split("/o/")[1]!;
  });

  it("reads three years of Jobber exports and finds the breakage", async () => {
    const r = await api("POST", `/api/businesses/${bid}/imports`, { files: sample.files.map((f) => ({ name: f.name, text: f.text, kind: f.kind })) });
    expect(r.status).toBe(200);
    const files = r.json.files as { kind: string; accepted: number; source: string }[];
    expect(files.map((f) => f.kind)).toEqual(["quote", "client", "job", "invoice", "request"]);
    expect(files[0]!.source).toBe("jobber");
    const ov = r.json.overview as { summary: { totalValue: number; reachablePeople: number; fit: { verdict: string } } };
    expect(ov.summary.totalValue).toBeGreaterThan(1_000_000);
    expect(ov.summary.reachablePeople).toBeGreaterThan(1000);
    expect(["strong", "good"]).toContain(ov.summary.fit.verdict);
    const opps = await api("GET", `/api/businesses/${bid}/opportunities?status=reachable&per=10`);
    expect((opps.json.items as unknown[]).length).toBe(10);
  });

  it("plans the free round: 150 people, notes about their own jobs, nothing flagged", async () => {
    const r = await api("POST", `/api/businesses/${bid}/plan`, {});
    expect(r.json.people).toBe(150);
    expect(r.json.firstDay).toBe("2026-09-30");
    expect(r.json.awaitingOk).toBe(true);
    // one tap: the welcome text shows the owner the first note word for word; nothing goes until they say OK
    const msgs = await api("GET", `/api/businesses/${bid}/owner-messages`);
    const welcome = (msgs.json as unknown as { kind: string; text: string }[]).find((m) => m.kind === "kickoff")!;
    expect(welcome.text).toMatch(/% of your quotes never got a yes or a no/);
    expect(welcome.text).toContain("Here's the first note, going out from Sarah:");
    expect(welcome.text).toContain("Reply OK and the first");
    expect(welcome.text).not.toContain('Reply "stop"'); // the footer is the same on every note, so it's left off
    expect(((await api("GET", `/api/businesses/${bid}/touches?status=approved&limit=10`)).json.items as unknown[]).length).toBe(0);
    const ok = await app.request(`/webhooks/sms/${WH}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: "+16035550199", Body: "OK" }) });
    expect(await ok.text()).toContain("the first notes go out");
    const t = await api("GET", `/api/businesses/${bid}/touches?status=approved&limit=1000`);
    const items = t.json.items as { flags: string[]; body: string; step: number }[];
    expect(items.length).toBeGreaterThan(300);
    expect(items.filter((x) => x.flags.length)).toHaveLength(0);
    expect(items[0]!.body).toContain('Reply "stop"');
    // planning again doesn't double up the free round
    const again = await api("POST", `/api/businesses/${bid}/plan`, {});
    expect(again.json.people).toBe(0);
  });

  it("sends only on send days, inside send hours, at a safe pace", async () => {
    await advanceTo("2026-09-29T15:00:00Z"); // Tue 11:00 — after the window, and nothing due yet
    expect(d.email.sent).toHaveLength(0);
    await advanceTo("2026-09-30T13:30:00Z", 6); // Wed 09:30 local — inside 7-10
    const wed = d.email.sent.length;
    expect(wed).toBeGreaterThan(0);
    expect(wed).toBeLessThanOrEqual(25 * 6);
    const first = d.email.sent[0]!;
    expect(first.fromName).toBe("Sarah at Ridgeline Tree Co.");
    expect(first.unsubscribeUrl).toContain("https://qa.test/u/");
    expect(first.text).not.toMatch(/https?:\/\/(?!qa\.test)/);
    // Saturday: nothing goes out
    const before = d.email.sent.length;
    await advanceTo("2026-10-03T13:30:00Z", 2);
    expect(d.email.sent.length).toBe(before);
  });

  it("reads a homeowner's yes and texts the owner right away", async () => {
    const target = d.email.sent[0]!;
    const res = await app.request(`/webhooks/inbound-email/${WH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ MessageID: "m-yes-1", From: target.to, To: "sarah@ridgeline-mail.com", Subject: `Re: ${target.subject}`, TextBody: "Yes please, still need it done. Call me after 5 at 603-555-0142\n\nOn Wed, Sep 30, 2026 Sarah wrote:\n> Hi", Date: "2026-10-03T14:10:00Z" }),
    });
    expect(res.status).toBe(200);
    const text = d.notifier.sent.at(-1)?.text ?? "";
    expect(text).toMatch(/NEW/);
    expect(text).toMatch(/Wants it done/);
    expect(text).toMatch(/\(603\) 555-0142/);
    expect(text).toMatch(/#[A-Z0-9]{3}/);
    // they got an instant answer in their thread (Saturday, so the promise is Monday, not "today")
    const ack = d.email.sent.at(-1)!;
    expect(ack.to).toBe(target.to);
    expect(ack.subject).toMatch(/^Re: /);
    expect(ack.text).toMatch(/Dave, who'll give you a call at \(603\) 555-0142 on Monday/);
    expect(text).toContain("We already wrote back that you'll call them on Monday.");
    // the same webhook again is ignored (idempotent)
    const dup = await app.request(`/webhooks/inbound-email/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: "m-yes-1", From: target.to, Subject: "x", TextBody: "Yes" }) });
    expect(((await dup.json()) as { duplicate?: boolean }).duplicate).toBe(true);
    // their remaining notes are cancelled
    const ov = await api("GET", `/api/businesses/${bid}`);
    expect((ov.json.waitingOnOwner as unknown[]).length).toBe(1);
  });

  it("lets the owner log the booking by texting back", async () => {
    const res = await app.request(`/webhooks/sms/${WH}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: "+16035550199", Body: "booked 2400" }) });
    const xml = await res.text();
    expect(xml).toContain("Booked:");
    expect(xml).toContain("$2,400");
    const ov = await api("GET", `/api/businesses/${bid}`);
    expect(ov.json.recoveredValue).toBe(2400);
    expect((ov.json.waitingOnOwner as unknown[]).length).toBe(0);
    const unknown = await app.request(`/webhooks/sms/${WH}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: "+15550000000", Body: "booked 10" }) });
    expect(await unknown.text()).toContain("don't recognize");
  });

  it("honors stop replies and unsubscribe links everywhere", { timeout: 60_000 }, async () => {
    const who = d.email.sent[1]!;
    await app.request(`/webhooks/inbound-email/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: "m-stop-1", From: who.to, Subject: "Re: x", TextBody: "Please take me off your list" }) });
    const other = d.email.sent[2]!;
    const token = other.unsubscribeUrl!.split("/u/")[1]!;
    const page = await app.request(`/u/${token}`, { method: "POST" });
    expect(await page.text()).toContain("unsubscribed");
    const t = await api("GET", `/api/businesses/${bid}/touches?limit=5000`);
    const items = t.json.items as { to?: string; customerId: string; status: string }[];
    const sent = d.email.sent.length;
    await advanceTo("2026-10-06T13:30:00Z", 8); // next Tuesday
    const later = d.email.sent.slice(sent).map((m) => m.to);
    expect(later).not.toContain(who.to);
    expect(later).not.toContain(other.to);
    expect(items.length).toBeGreaterThan(0);
    const bad = await app.request("/u/not-a-real-token");
    expect(await bad.text()).toContain("didn't work");
  });

  it("sends the Friday report", async () => {
    await advanceTo("2026-10-09T20:10:00Z"); // Fri 16:10 local
    const weekly = d.notifier.sent.find((m) => /here's your week|came back this week|asked for a price/.test(m.text));
    expect(weekly).toBeTruthy();
  });

  it("survives a restart with nothing lost", async () => {
    const before = await api("GET", `/api/businesses/${bid}`);
    const d2 = makeDeps();
    const app2 = createApp(d2);
    const res = await app2.request(`/api/businesses/${bid}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const after = (await res.json()) as Record<string, unknown>;
    expect(after.recoveredValue).toBe(before.json.recoveredValue);
    expect((after.counts as { sent: number }).sent).toBe((before.json.counts as { sent: number }).sent);
    expect((after.totals as { replied: number }).replied).toBe((before.json.totals as { replied: number }).replied);
    d2.accounts.repo.db.close();
  });

  it("owner links are scoped to one business", async () => {
    const token = ownerToken;
    const ok = await app.request(`/api/owner/${token}/overview`);
    expect(ok.status).toBe(200);
    const forged = await app.request(`/api/owner/${token.slice(0, -2)}xx/overview`);
    expect(forged.status).toBe(401);
    // a link without this client's link key (the old unversioned kind) doesn't open it
    expect((await app.request(`/api/owner/${sign("test-app-secret-0123456789", `owner|${bid}`)}/overview`)).status).toBe(401);
  });

  it("shows the owner a ledger they can check, and 'not ours' takes a win out of every number", async () => {
    const token = ownerToken;
    const res = await app.request(`/api/owner/${token}/ledger`);
    const ledger = (await res.json()) as { rules: string[]; rows: { id: string; value: number; counts: boolean; match: string; theyWrote?: string }[] };
    expect(ledger.rules.join(" ")).toMatch(/180 days/);
    const win = ledger.rows.find((r) => r.value === 2400)!;
    expect(win.counts).toBe(true);
    expect(win.match).toBe("you told us you booked it");
    expect(win.theyWrote).toMatch(/Yes please/);
    const csv = await (await app.request(`/api/owner/${token}/ledger.csv`)).text();
    expect(csv.split("\n")[0]).toContain("How we matched it");
    const dispute = await app.request(`/api/owner/${token}/ledger/${win.id}/not-ours`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "already booked by phone" }) });
    expect(((await dispute.json()) as { ok: boolean }).ok).toBe(true);
    const ov = await api("GET", `/api/businesses/${bid}`);
    expect(ov.json.recoveredValue).toBe(0);
  });
});
