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
  /** `from` is the socket's peer address (what @hono/node-server hands the app); `headers` are whatever the caller writes. */
  const start = async (body: unknown, from = `10.0.0.${++ip}`, headers: Record<string, string> = {}, on = app) => {
    const res = await on.request("/start", { method: "POST", headers: { "content-type": "application/json", origin: "https://quietaccounts.com", ...headers }, body: JSON.stringify(body) }, { incoming: { socket: { remoteAddress: from } } });
    return { status: res.status, json: (await res.json()) as Record<string, unknown>, cors: res.headers.get("access-control-allow-origin") };
  };
  const bizNamed = (name: string) => d.accounts.repo.listBusinesses().filter((b) => b.profile.name === name);
  const alertsFor = (bid: string) => d.accounts.repo.openAlerts(bid);
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

  it("never pours a stranger's file into an account that's running: the operator is told instead", async () => {
    // Maple Ridge is planned now. Someone with its name and cell (both public) sends a file through the form.
    const maple = bizNamed("Maple Ridge Tree Co")[0]!.id;
    const st = d.accounts.peek(maple)!.state;
    const before = { customers: st.dataset.customers.length, requests: st.dataset.requests.length, quotes: st.dataset.quotes.length, imports: st.dataset.imports.length };
    const junk = { name: "requests.csv", text: "Client name,Email,Title,Created\nA Stranger,victim1@example.org,Tree work,2026-09-29\nB Stranger,victim2@example.org,Tree work,2026-09-29\n" };
    const r = await start({ ...form, files: [junk, ...files.slice(0, 1)] });
    expect(r.status).toBe(201);
    // the answer says nothing about the account it matched
    expect(r.json.id).toBe("thanks");
    expect(bizNamed("Maple Ridge Tree Co")).toHaveLength(1);
    const after = d.accounts.peek(maple)!.state.dataset;
    expect({ customers: after.customers.length, requests: after.requests.length, quotes: after.quotes.length, imports: after.imports.length }).toEqual(before);
    expect(after.customers.some((c) => c.emails.includes("victim1@example.org"))).toBe(false);
    const alert = alertsFor(maple).find((a) => a.title === "Maple Ridge Tree Co came back through the site with a file")!;
    expect(alert.detail).toContain("requests.csv");
    expect(alert.detail).toContain("Nothing was added");
  });

  it("an operator-made or paying client is never changed from the form, even untouched", async () => {
    const made = await api("POST", "/businesses", { name: "Birch Hill Tree", ownerName: "Ann Birch", ownerPhone: "603-555-0177", signerName: "Ann", mailingAddress: "1 Birch Rd, Concord, NH 03301" });
    const bid = made.json.id as string;
    await api("PATCH", `/businesses/${bid}`, { plan: { stage: "paying", paidOn: "2026-09-01" } });
    const r = await start({ ...form, company: "birch hill tree", first: "Ann", cell: "(603) 555-0177", files });
    expect(r.status).toBe(201);
    expect(d.accounts.peek(bid)!.state.dataset.quotes).toHaveLength(0);
    expect(alertsFor(bid).some((a) => /came back through the site with a file/.test(a.title))).toBe(true);
  });

  it("the owner who pressed Start without a file can come back with it (an untouched sign-up only)", async () => {
    const first = await start({ ...form, company: "Pine Knot Tree", first: "Sam", cell: "603-555-0188" });
    const id = first.json.id as string;
    expect(d.accounts.peek(id)!.state.dataset.business.signup).toEqual({ from: "site" });
    expect(d.accounts.peek(id)!.state.dataset.quotes).toHaveLength(0);
    await start({ ...form, company: "Pine Knot Tree", first: "Sam", cell: "603-555-0188", files });
    expect(bizNamed("Pine Knot Tree")).toHaveLength(1);
    expect(d.accounts.peek(id)!.state.dataset.quotes.length).toBeGreaterThan(100);
  });

  it("a new company on a cell that's already a client's: made without that cell, and the operator is warned", async () => {
    const maple = bizNamed("Maple Ridge Tree Co")[0]!.id;
    const r = await start({ ...form, company: "Your card was declined - call 555-0100", first: "Dave", cell: "603.555.0142" });
    expect(r.status).toBe(201);
    const id = r.json.id as string;
    const b = d.accounts.peek(id)!.state.dataset.business;
    // no owner cell, so the owner's texts never see it; the cell waits with the sign-up for the operator
    expect(b.ownerPhone).toBeUndefined();
    expect(b.signup).toEqual({ from: "site", sharedCell: "+16035550142" });
    const alert = alertsFor(id).find((a) => a.kind === "signup")!;
    expect(alert.detail).toContain("already the owner cell for Maple Ridge Tree Co");
    // the real owner's texts still name one business, and never carry this one's name
    const { ownerCommand } = await import("../src/core/owner.ts");
    const res = await ownerCommand(d, "+16035550142", "STATUS");
    expect(res.businessId).toBe(maple);
    expect(res.handled).not.toBe("ask_which");
    expect(res.reply).not.toContain("declined");
    // pressing Start again with the same name finds the same sign-up, not a third account
    await start({ ...form, company: "Your card was declined - call 555-0100", first: "Dave", cell: "603.555.0142" });
    expect(bizNamed("Your card was declined - call 555-0100")).toHaveLength(1);
    // once the operator sets the cell, it's the owner's like any other
    await api("PATCH", `/businesses/${id}`, { ownerPhone: "603-555-0142" });
    expect(d.accounts.peek(id)!.state.dataset.business).toMatchObject({ ownerPhone: "+16035550142", signup: { from: "site" } });
  });

  it("tells the operator which offer and trade the owner signed up for, and keeps where he came from", async () => {
    const ref = "page=lawn&src=k12&utm_source=instantly&utm_campaign=lawn-oct";
    const r = await start({ ...form, company: "Green Acre Lawn", first: "Pat", cell: "603-555-0122", software: "housecall_pro", trade: "lawn", offer: "monthly", ref });
    expect(r.status).toBe(201);
    const id = r.json.id as string;
    expect(d.accounts.peek(id)!.state.dataset.business).toMatchObject({ trade: "lawn", software: "housecall_pro" });
    expect(alertsFor(id).find((a) => a.kind === "signup")!.detail).toContain("Offer: monthly. Trade: lawn.");
    const row = d.accounts.repo.db.get<{ detail: string }>("SELECT detail FROM audit WHERE business_id = ? AND action = 'signup'", id)!;
    expect(JSON.parse(row.detail)).toMatchObject({ ref, offer: "monthly", trade: "lawn" });
    const onePass = await start({ ...form, company: "Tall Pine Tree", first: "Ryan", cell: "603-555-0123", offer: "one_pass" });
    expect(alertsFor(onePass.json.id as string).find((a) => a.kind === "signup")!.detail).toContain("Offer: one pass. Trade: tree.");
    // only the two offers there are; a ref longer than the page ever sends is refused, not cut
    expect((await start({ ...form, company: "Odd Offer Co", cell: "603-555-0124", offer: "yearly" })).status).toBe(400);
    expect((await start({ ...form, company: "Long Ref Co", cell: "603-555-0125", ref: "x".repeat(201) })).status).toBe(400);
  });

  it("keeps only the site's own audit numbers", async () => {
    await start({ ...form, company: "Oak Hollow Tree", first: "Lee", cell: "603-555-0133", audit: { quotes: 12, perMonth: 900, junk: "x".repeat(5000) } as unknown as Record<string, number> });
    const id = bizNamed("Oak Hollow Tree")[0]!.id;
    const row = d.accounts.repo.db.get<{ detail: string }>("SELECT detail FROM audit WHERE business_id = ? AND action = 'signup'", id)!;
    expect(JSON.parse(row.detail).audit).toEqual({ quotes: 12, perMonth: 900 });
    expect(row.detail).not.toContain("xxxx");
  });

  it("slows down a script: five tries an hour from one address, whatever X-Forwarded-For it writes", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await start({ ...form, consent: false }, "10.9.9.9", { "x-forwarded-for": `198.51.100.${i}` })).status);
    expect(codes.slice(0, 5).every((c) => c === 400)).toBe(true);
    expect(codes[5]).toBe(429);
    // someone else is still let through
    expect((await start({ ...form, consent: false }, "10.9.9.10")).status).toBe(400);
  });

  it("behind a trusted proxy, the address it appended is the caller (never the one the caller wrote)", async () => {
    const proxied = createApp({ ...d, cfg: { ...d.cfg, TRUSTED_PROXY_HOPS: 1 } });
    const codes: number[] = [];
    // the proxy (10.0.9.1) appends the real caller last; the caller varies what it writes in front
    for (let i = 0; i < 6; i++) codes.push((await start({ ...form, consent: false }, "10.0.9.1", { "x-forwarded-for": `203.0.113.${i}, 192.0.2.7` }, proxied)).status);
    expect(codes[5]).toBe(429);
    // a different caller through the same proxy has their own count
    expect((await start({ ...form, consent: false }, "10.0.9.1", { "x-forwarded-for": "192.0.2.8" }, proxied)).status).toBe(400);
  });

  it("takes only so many new sign-ups an hour, server-wide", async () => {
    const capped = createApp({ ...d, cfg: { ...d.cfg, SIGNUPS_PER_HOUR: 2 } });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await start({ ...form, company: `Capped Tree ${i}`, cell: `603-555-02${10 + i}` }, `10.7.0.${i}`, {}, capped)).status);
    expect(codes).toEqual([201, 201, 429]);
    expect(bizNamed("Capped Tree 2")).toHaveLength(0);
  });
});
