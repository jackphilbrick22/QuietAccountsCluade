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

/** The site's Start button: the owner's file, their name and cell, and nothing goes out until a person looks. */
describe("sign-up from the site", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-signup-"));
  const dbPath = join(dir, "qa.db");
  const TOKEN = "test-operator-token-123";
  const now = new Date("2026-09-29T14:00:00Z");
  let d: HttpDeps;
  let app: ReturnType<typeof createApp>;
  let ip = 0;
  const start = async (body: unknown, from = `10.0.0.${++ip}`) => {
    const res = await app.request("/start", { method: "POST", headers: { "content-type": "application/json", origin: "https://quietaccounts.com", "x-forwarded-for": from }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown>, cors: res.headers.get("access-control-allow-origin") };
  };
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const sample = generateSample({ trade: "tree", asOf: "2026-09-29" });
  const files = sample.files.map((f) => ({ name: f.name, text: f.text }));
  const form = { company: "Maple Ridge Tree Co", first: "Dave", cell: "(603) 555-0142", software: "Jobber", trade: "tree", consent: true as const };

  beforeAll(() => {
    const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: TOKEN, APP_SECRET: "test-app-secret-0123456789", WEBHOOK_SECRET: "test-webhook-secret", PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false", SIGNUP_ORIGINS: "https://quietaccounts.com" });
    d = { cfg, accounts: new Accounts(new Repo(new Db(dbPath))), email: new LogEmailProvider({ quiet: true }), notifier: new LogNotifier(true), llm: null, fsm: {}, log: () => {}, clock: () => now, parsers: {} };
    app = createApp(d);
  });
  afterAll(() => {
    d.accounts.repo.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers the browser's preflight for the site's origin only", async () => {
    const ok = await app.request("/start", { method: "OPTIONS", headers: { origin: "https://quietaccounts.com", "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://quietaccounts.com");
    const other = await app.request("/start", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(other.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });

  it("needs the consent box and a cell we can text", async () => {
    const noConsent = await start({ ...form, consent: false });
    expect(noConsent.status).toBe(400);
    expect(noConsent.json.error).toContain("Tick the box");
    const badCell = await start({ ...form, cell: "12" });
    expect(badCell.status).toBe(400);
    expect(badCell.json.error).toContain("cell");
  });

  it("drops bots quietly", async () => {
    const r = await start({ ...form, company: "Spam Co", website: "http://spam.example" });
    expect(r.status).toBe(201);
    expect(d.accounts.repo.listBusinesses().some((b) => b.profile.name === "Spam Co")).toBe(false);
  });

  it("makes the account, reads the file and puts it in the operator's queue; nothing is sent", async () => {
    const r = await start({ ...form, files, audit: { quotes: 400, silent: { count: 160, value: 480000 }, perMonth: 20000 }, ref: "abc123" });
    expect(r.status).toBe(201);
    expect(r.cors).toBe("https://quietaccounts.com");
    const id = r.json.id as string;
    const st = d.accounts.peek(id)!.state;
    expect(st.dataset.business).toMatchObject({ name: "Maple Ridge Tree Co", ownerFirstName: "Dave", ownerPhone: "+16035550142", signerName: "Dave", signerRole: "owner", software: "jobber", mailingAddress: "" });
    expect(st.dataset.quotes.length).toBeGreaterThan(100);
    expect(st.touches).toHaveLength(0);
    expect(st.ownerMessages).toHaveLength(0);
    expect((d.notifier as LogNotifier).sent).toHaveLength(0);
    const items = (await api("GET", "/review")).json.items as { kind: string; businessId: string; title?: string; from?: string; needsAddress?: boolean; detail?: string }[];
    const mine = items.filter((i) => i.businessId === id);
    expect(mine).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "ready", from: "file", needsAddress: true }), expect.objectContaining({ kind: "alert", title: "New sign-up: Maple Ridge Tree Co" })]));
    expect(mine.find((i) => i.kind === "alert")!.detail).toMatch(/quotes never answered/);
  });

  it("won't plan until the mailing address is in; then the owner gets the first note to OK", async () => {
    const id = d.accounts.repo.listBusinesses().find((b) => b.profile.name === "Maple Ridge Tree Co")!.id;
    const early = await api("POST", `/businesses/${id}/plan`, {});
    expect(early.status).toBe(409);
    expect(early.json.error).toContain("mailing address");
    await api("PATCH", `/businesses/${id}`, { mailingAddress: "9 Carter St, Concord, NH 03301" });
    const p = await api("POST", `/businesses/${id}/plan`, {});
    expect(p.status).toBe(200);
    expect(p.json.awaitingOk).toBe(true);
    expect(d.accounts.peek(id)!.state.ownerMessages.find((m) => m.kind === "kickoff")!.text).toContain("Reply OK");
  });

  it("the same owner pressing Start again lands on the same account", async () => {
    const before = d.accounts.repo.listBusinesses().length;
    const r = await start({ ...form, cell: "603-555-0142" });
    expect(r.status).toBe(201);
    expect(d.accounts.repo.listBusinesses().length).toBe(before);
  });

  it("slows down a script: five tries an hour from one address", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await start({ ...form, consent: false }, "10.9.9.9")).status);
    expect(codes.slice(0, 5).every((c) => c === 400)).toBe(true);
    expect(codes[5]).toBe(429);
  });
});
