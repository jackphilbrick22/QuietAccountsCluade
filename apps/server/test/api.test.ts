import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSample, type Reply } from "@qa/engine";
import { loadConfig } from "../src/config.ts";
import { Db } from "../src/db/sqlite.ts";
import { Repo } from "../src/db/repo.ts";
import { Accounts } from "../src/core/accounts.ts";
import { deliverOwnerMessages } from "../src/core/ops.ts";
import { createApp, type HttpDeps } from "../src/http/app.ts";
import { LogEmailProvider } from "../src/providers/email.ts";
import { LogNotifier } from "../src/providers/sms.ts";

/**
 * The read-only routes the live operator console uses on top of the core API:
 * the cross-client "needs a person" queue, contact lookups, imported files and integration status.
 */
const dir = mkdtempSync(join(tmpdir(), "qa-api-"));
const dbPath = join(dir, "qa.db");
const now = new Date("2026-09-29T14:00:00Z"); // Tue 10:00 America/New_York
const TOKEN = "test-operator-token-456";

function makeDeps(): HttpDeps & { notifier: LogNotifier } {
  const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: TOKEN, APP_SECRET: "test-app-secret-0123456789", WEBHOOK_SECRET: "test-webhook-secret", PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false" });
  return {
    cfg,
    accounts: new Accounts(new Repo(new Db(dbPath))),
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
const bid = "ridgeline-tree";
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
  return { status: res.status, json: json as never };
}

type Item = { kind: string; businessId: string; businessName: string; replyId?: string; touchId?: string; messageId?: string; name?: string; hours?: number; flags?: string[]; delivery?: string };

beforeAll(async () => {
  d = makeDeps();
  app = createApp(d);
  const r = await api("POST", "/api/businesses", {
    id: bid,
    name: "Ridgeline Tree Co.",
    trade: "tree",
    ownerName: "Dave Ridge",
    ownerPhone: "+16035550199",
    signerName: "Sarah",
    mailingAddress: "14 Mill Rd, Concord, NH 03301",
    state: "NH",
  });
  expect(r.status).toBe(201);
  const imp = await api("POST", `/api/businesses/${bid}/imports`, { files: sample.files.map((f) => ({ name: f.name, text: f.text, kind: f.kind })) });
  expect(imp.status).toBe(200);
  const p = await api("POST", `/api/businesses/${bid}/plan`, {});
  expect((p.json as { people: number }).people).toBe(150);
});

afterAll(() => {
  d.accounts.repo.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("operator console reads", () => {
  it("need the operator token", async () => {
    for (const path of ["/api/review", `/api/businesses/${bid}/people?ids=x`, `/api/businesses/${bid}/files`, `/api/businesses/${bid}/integrations`]) {
      const res = await app.request(path);
      expect(res.status).toBe(401);
    }
  });

  it("lists the files we've read, newest first, without column mappings", async () => {
    const r = await api("GET", `/api/businesses/${bid}/files`);
    expect(r.status).toBe(200);
    const files = r.json as { fileName: string; kind: string; source: string; rows: number; accepted: number; mapping?: unknown }[];
    expect(files).toHaveLength(sample.files.length);
    expect(files.map((f) => f.kind).sort()).toEqual(["client", "invoice", "job", "quote", "request"]);
    expect(files.every((f) => f.source === "jobber" || f.kind === "client")).toBe(true);
    expect(files[0]!.accepted).toBeGreaterThan(0);
    expect(files[0]).not.toHaveProperty("mapping");
    expect((await api("GET", "/api/businesses/nope/files")).status).toBe(404);
  });

  it("looks up names and contact details for customer ids", async () => {
    const t = await api("GET", `/api/businesses/${bid}/touches?limit=3`);
    const ids = (t.json as { items: { customerId: string }[] }).items.map((x) => x.customerId);
    const r = await api("GET", `/api/businesses/${bid}/people?ids=${[...ids, "not-a-customer"].join(",")}`);
    expect(r.status).toBe(200);
    const people = r.json as { id: string; name: string; email: string | null }[];
    expect(people.map((p) => p.id).sort()).toEqual([...new Set(ids)].sort());
    expect(people.every((p) => p.name && p.email)).toBe(true);
    expect((await api("GET", `/api/businesses/${bid}/people`)).json).toEqual([]);
    expect((await api("GET", "/api/businesses/nope/people?ids=a")).status).toBe(404);
  });

  it("reports integration status without secrets", async () => {
    const r = await api("GET", `/api/businesses/${bid}/integrations`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ jobber: { available: false, connected: false, status: "not_connected", lastSyncAt: null, lastError: null } });
    expect(JSON.stringify(r.json)).not.toMatch(/secret|token/i);
    expect((await api("GET", "/api/businesses/nope/integrations")).status).toBe(404);
  });

  it("queues everything that needs a person across clients, and drops items once handled", async () => {
    // A clean free round needs nobody.
    const empty = await api("GET", "/api/review");
    expect(empty.status).toBe(200);
    expect((empty.json as { items: Item[]; slaHours: number }).items).toEqual([]);
    expect((empty.json as { slaHours: number }).slaHours).toBe(4);

    // Set up one of each: an unclear reply, a hot lead waiting 10h, a fresh hot lead, a flagged note, and the close waiting for review.
    let flaggedId = "";
    await d.accounts.withAccount(bid, (s) => {
      const [a, b, c] = s.dataset.customers.filter((x) => x.emails.length);
      const reply = (id: string, customerId: string, intent: Reply["intent"], at: string, status: Reply["status"]): Reply => ({ id, customerId, channel: "email", receivedAt: at, from: "x@example.org", text: "hmm", intent, confidence: 0.5, extracted: {}, status, handedOffAt: status === "handed_off" ? at : undefined });
      s.replies.push(reply("r-unclear", a!.id, "unclear", "2026-09-28T09:00:00", "new"));
      s.replies.push(reply("r-late", b!.id, "wants_it", "2026-09-29T00:00:00", "handed_off"));
      s.replies.push(reply("r-fresh", c!.id, "wants_price", "2026-09-29T09:30:00", "handed_off"));
      const t = s.touches.find((x) => x.status === "approved")!;
      t.flags = ["Reads like a template"];
      flaggedId = t.id;
      s.ownerMessages.push({ id: "om-close", at: "2026-09-29T09:00:00", kind: "close", text: "Dave, the free 150 is done." });
    });
    await deliverOwnerMessages(d, bid); // billing texts wait for an operator
    const r = await api("GET", "/api/review");
    const items = (r.json as { items: Item[] }).items;
    const kinds = items.map((i) => `${i.kind}:${i.replyId ?? i.touchId ?? i.messageId}`).sort();
    expect(kinds).toEqual(["flagged_note:" + flaggedId, "late_lead:r-late", "owner_message:om-close", "unclear:r-unclear"]);
    expect(items.every((i) => i.businessId === bid && i.businessName === "Ridgeline Tree Co.")).toBe(true);
    expect(items.find((i) => i.kind === "late_lead")!.hours).toBe(10);
    expect(items.find((i) => i.kind === "flagged_note")!.flags).toEqual(["Reads like a template"]);
    expect(items.find((i) => i.kind === "owner_message")!.delivery).toBe("review");
    expect(items.find((i) => i.kind === "unclear")!.name).toBeTruthy();

    // Handle them through the normal routes; the queue empties.
    await api("POST", `/api/businesses/${bid}/replies/r-late/outcome`, { outcome: "booked", value: 1800 });
    await api("PATCH", `/api/businesses/${bid}/touches/${flaggedId}`, { status: "cancelled" });
    await api("POST", `/api/businesses/${bid}/owner-messages/om-close/send`);
    const after = (await api("GET", "/api/review")).json as { items: Item[] };
    expect(after.items.map((i) => i.kind)).toEqual(["unclear"]);
  });
});
