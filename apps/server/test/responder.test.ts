import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSample, type Reply } from "@qa/engine";
import { loadConfig } from "../src/config.ts";
import { Db } from "../src/db/sqlite.ts";
import { Repo } from "../src/db/repo.ts";
import { Accounts } from "../src/core/accounts.ts";
import { createApp, type HttpDeps } from "../src/http/app.ts";
import { LogEmailProvider } from "../src/providers/email.ts";
import { LogNotifier } from "../src/providers/sms.ts";
import type { Llm } from "../src/agents/llm.ts";

/**
 * The responder: a homeowner asks a question in reply to a note; it's read, handed to the owner, answered
 * instantly, a specific answer is drafted, and the operator sends it in the same thread with one click.
 */
const dir = mkdtempSync(join(tmpdir(), "qa-resp-"));
const dbPath = join(dir, "qa.db");
const TOKEN = "test-operator-token-789";
const WH = "test-webhook-secret";
const now = new Date("2026-09-30T14:00:00Z"); // Wed 10:00 New York

// A stand-in for Claude: no second opinion on the reading, a fixed grounded draft for questions.
const fakeLlm: Llm = {
  model: "test",
  async structured(_schema, opts) {
    if (opts.purpose === "inbox.draft") return { draft: "Yes, we grind stumps too. Dave will call you today to add it to the oak.\n\nSarah", needsOwner: false } as never;
    return null;
  },
};

let d: HttpDeps & { email: LogEmailProvider };
let app: ReturnType<typeof createApp>;
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

beforeAll(async () => {
  const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: TOKEN, APP_SECRET: "test-app-secret-0123456789", WEBHOOK_SECRET: WH, PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false" });
  d = { cfg, accounts: new Accounts(new Repo(new Db(dbPath))), email: new LogEmailProvider({ quiet: true }), notifier: new LogNotifier(true), llm: fakeLlm, fsm: {}, log: () => {}, clock: () => now, parsers: {} };
  app = createApp(d);
  const sample = generateSample({ trade: "tree", asOf: "2026-09-30" });
  await api("POST", "/api/businesses", { id: "ridge", name: "Ridgeline Tree Co.", ownerName: "Dave Ridge", ownerPhone: "+16035550199", signerName: "Sarah", mailingAddress: "14 Mill Rd, Concord, NH 03301", state: "NH", timezone: "America/New_York" });
  await api("POST", "/api/businesses/ridge/imports", { files: sample.files.map((f) => ({ name: f.name, text: f.text, kind: f.kind })) });
});
afterAll(() => {
  d.accounts.repo.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the responder", () => {
  it("reads the trade from the files when none was given", async () => {
    const ov = await api("GET", "/api/businesses/ridge");
    expect((ov.json.business as { trade: string }).trade).toBe("tree");
  });

  it("drafts a specific answer to a question and sends it in their thread with one click", async () => {
    const st = d.accounts.peek("ridge")!.state;
    const c = st.dataset.customers.find((x) => x.emails.length)!;
    const res = await app.request(`/webhooks/inbound-email/${WH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ MessageID: "m-q-1", From: c.emails[0], Subject: "Re: the oak", TextBody: "Do you also do stump grinding?", Headers: [{ Name: "Message-ID", Value: "<q1@mail.test>" }] }),
    });
    expect(res.status).toBe(200);
    const r = d.accounts.peek("ridge")!.state.replies.find((x) => x.from === c.emails[0]) as Reply;
    expect(r.intent).toBe("question");
    expect(r.draft?.text).toMatch(/stump/);
    expect(r.thread?.messageId).toBe("<q1@mail.test>");
    // no instant answer went on the owner's behalf: a person reads every reply (a new account has autoAck off)
    expect(r.answers).toBeUndefined();

    const sent = await api("POST", `/api/businesses/ridge/replies/${r.id}/answer`, { useDraft: true });
    expect(sent.status).toBe(200);
    const last = d.email.sent.at(-1)!;
    expect(last.to).toBe(c.emails[0]);
    expect(last.inReplyTo).toBe("<q1@mail.test>");
    expect(last.subject).toBe("Re: the oak");
    expect(last.text).toMatch(/grind stumps/);
    const after = d.accounts.peek("ridge")!.state.replies.find((x) => x.id === r.id)!;
    expect(after.draft).toBeUndefined();
    expect(after.answers?.map((a) => a.by)).toEqual(["operator"]);
  });

  it("refuses to send an unsourced stat or anything to someone who asked us to stop", async () => {
    const st = d.accounts.peek("ridge")!.state;
    const r = st.replies[0]!;
    const bad = await api("POST", `/api/businesses/ridge/replies/${r.id}/answer`, { text: "80% of sales need 5 follow-ups, so here's another!" });
    expect(bad.status).toBe(400);
    const c = st.dataset.customers.filter((x) => x.emails.length)[1]!;
    await app.request(`/webhooks/inbound-email/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: "m-stop-9", From: c.emails[0], Subject: "Re: x", TextBody: "stop emailing me" }) });
    const stop = d.accounts.peek("ridge")!.state.replies.find((x) => x.from === c.emails[0])!;
    const blocked = await api("POST", `/api/businesses/ridge/replies/${stop.id}/answer`, { text: "Sorry to bother you." });
    expect(blocked.status).toBe(400);
    expect(String(blocked.json.error)).toMatch(/stop/);
  });
});
