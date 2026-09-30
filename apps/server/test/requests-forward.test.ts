import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { Db } from "../src/db/sqlite.ts";
import { Repo } from "../src/db/repo.ts";
import { Accounts } from "../src/core/accounts.ts";
import { createApp, type HttpDeps } from "../src/http/app.ts";
import { LogEmailProvider } from "../src/providers/email.ts";
import { LogNotifier } from "../src/providers/sms.ts";

const WEB_FORM = `---------- Forwarded message ---------
From: Wix Forms <no-reply@wix.com>
Subject: New form submission: Request a quote

Name: Karen Whitfield
Email: karen.whitfield@gmail.com
Phone: (603) 555-0142
Address: 14 Oak Ln, Concord NH
Message: There's a big oak leaning toward the garage. Can someone come look?`;

/** A request that sits in the owner's inbox is a lead going cold. Forwarded to us, it's answered from the office. */
describe("new requests the owner forwards", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-fwd-"));
  const dbPath = join(dir, "qa.db");
  const TOKEN = "test-operator-token-123";
  const WH = "test-webhook-secret";
  const now = new Date("2026-09-29T14:00:00Z"); // 10am in Concord
  let d: HttpDeps;
  let app: ReturnType<typeof createApp>;
  let n = 0;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await res.json()) as Record<string, unknown>;
  };
  const forward = async (to: string, subject: string, text: string) => {
    const res = await app.request(`/webhooks/inbound-email/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: `fwd-${++n}`, From: "Dave Ridge <dave@ridgelinetree.com>", To: to, Subject: subject, TextBody: text }) });
    return (await res.json()) as Record<string, unknown>;
  };
  const make = async (id: string, paying: boolean) => {
    await api("POST", "/businesses", { id, name: "Ridgeline Tree Co.", trade: "tree", ownerName: "Dave Ridge", ownerPhone: "+16035550199", ownerEmail: "dave@ridgelinetree.com", signerName: "Sarah", mailingAddress: "14 Mill Rd, Concord, NH 03301", city: "Concord", state: "NH", timezone: "America/New_York" });
    if (paying) await api("PATCH", `/businesses/${id}`, { plan: { stage: "paying", paidOn: "2026-09-01" } });
    return (await api("GET", `/businesses/${id}/links`)) as { requestsToken: string; requestsAddress?: string };
  };

  beforeAll(() => {
    const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: TOKEN, APP_SECRET: "test-app-secret-0123456789", WEBHOOK_SECRET: WH, PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false", INBOUND_DOMAIN: "in.qa.test" });
    d = { cfg, accounts: new Accounts(new Repo(new Db(dbPath))), email: new LogEmailProvider({ quiet: true }), notifier: new LogNotifier(true), llm: null, fsm: {}, log: () => {}, clock: () => now, parsers: {} };
    app = createApp(d);
  });
  afterAll(() => {
    d.accounts.repo.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives each client a forwarding address", async () => {
    const l = await make("ridge", true);
    expect(l.requestsAddress).toBe(`requests+${l.requestsToken}@in.qa.test`);
  });

  it("answers a forwarded website request from the office and texts the owner who it is", async () => {
    const l = (await api("GET", "/businesses/ridge/links")) as { requestsAddress: string };
    const r = await forward(l.requestsAddress, "Fwd: New form submission: Request a quote", WEB_FORM);
    expect(r).toMatchObject({ ok: true, taken: true, answered: 1 });
    const st = d.accounts.peek("ridge")!.state;
    expect(st.dataset.requests).toHaveLength(1);
    const note = st.touches.find((t) => t.track === "new_request")!;
    expect(note.status).toBe("sent");
    const mail = (d.email as LogEmailProvider).sent.find((m) => m.to === "karen.whitfield@gmail.com")!;
    expect(mail.text).toMatch(/Thanks for reaching out to Ridgeline Tree Co/);
    const text = (d.notifier as LogNotifier).sent.find((m) => m.text.includes("NEW REQUEST"))!.text;
    expect(text).toContain("Karen Whitfield");
    expect(text).toContain("Came in through your website; you forwarded it");
    // the owner's Gmail filter and a forward by hand: one answer
    const again = await forward(l.requestsAddress, "Fwd: New form submission: Request a quote", WEB_FORM);
    expect(again).toMatchObject({ taken: true, duplicate: true, answered: 0 });
    expect((d.email as LogEmailProvider).sent.filter((m) => m.to === "karen.whitfield@gmail.com")).toHaveLength(1);
  });

  it("what it can't read goes to a person, never a guess", async () => {
    const l = (await api("GET", "/businesses/ridge/links")) as { requestsAddress: string };
    const r = await forward(l.requestsAddress, "Fwd: Jess M. is looking for tree trimming", "From: Thumbtack <no-reply@thumbtack.com>\n\nJess M. needs tree trimming in Concord, NH. Respond in the Thumbtack app.");
    expect(r).toMatchObject({ taken: false });
    const items = (await api("GET", "/review")).items as { kind: string; title?: string; detail?: string }[];
    const alert = items.find((i) => i.kind === "alert" && i.title === "A forwarded request we couldn't read")!;
    expect(alert.detail).toContain("Thumbtack usually keeps their contact in its app");
  });

  it("before the paid plan it's kept and passed to the operator, not answered", async () => {
    const l = await make("ridge-trial", false);
    const r = await forward(`requests+${l.requestsToken}@in.qa.test`, "Fwd: New form submission", WEB_FORM.replace("karen.whitfield@gmail.com", "k.w@example.org"));
    expect(r).toMatchObject({ taken: true, answered: 0 });
    expect(d.accounts.peek("ridge-trial")!.state.touches).toHaveLength(0);
    const items = (await api("GET", "/review")).items as { kind: string; businessId: string; title?: string }[];
    expect(items.some((i) => i.businessId === "ridge-trial" && i.kind === "alert" && /Forwarded request from Karen Whitfield/.test(i.title ?? ""))).toBe(true);
  });

  it("a forged address is ignored", async () => {
    expect(await forward("requests+not-a-real-token@in.qa.test", "Fwd: hi", WEB_FORM)).toMatchObject({ ignored: true });
  });
});
