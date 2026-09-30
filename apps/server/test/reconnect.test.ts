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
import { encrypt } from "../src/core/crypto.ts";
import { syncFsm } from "../src/core/ops.ts";
import { ProviderError, type FsmConnector } from "../src/contracts.ts";

/** A client whose Jobber login died never stalls silently: the owner gets one reconnect link. */
const dir = mkdtempSync(join(tmpdir(), "qa-reconnect-"));
const dbPath = join(dir, "qa.db");
const SECRET = "test-app-secret-0123456789";
let d: HttpDeps & { notifier: LogNotifier };
let pulls = 0;
const deadJobber: FsmConnector = {
  source: "jobber",
  authorizeUrl: () => "https://jobber.test/auth",
  exchangeCode: async () => ({ accessToken: "a" }),
  refresh: async () => ({ accessToken: "a" }),
  pull: async () => {
    pulls++;
    throw new ProviderError("Jobber token request failed (401): invalid_grant", "jobber", 401, false);
  },
  verifyWebhook: () => true,
  parseWebhook: () => undefined,
};

beforeAll(async () => {
  const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: "test-operator-token-000", APP_SECRET: SECRET, WEBHOOK_SECRET: "test-webhook-secret", PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false" });
  d = { cfg, accounts: new Accounts(new Repo(new Db(dbPath))), email: new LogEmailProvider({ quiet: true }), notifier: new LogNotifier(true), llm: null, fsm: { jobber: deadJobber }, log: () => {}, clock: () => new Date("2026-09-30T14:00:00Z"), parsers: {} };
  const app = createApp(d);
  await app.request("/api/businesses", { method: "POST", headers: { authorization: "Bearer test-operator-token-000", "content-type": "application/json" }, body: JSON.stringify({ id: "ridge", name: "Ridgeline Tree Co.", trade: "tree", ownerName: "Dave Ridge", ownerPhone: "+16035550199", signerName: "Sarah", mailingAddress: "14 Mill Rd, Concord, NH 03301", state: "NH" }) });
  d.accounts.repo.putIntegration("ridge", "jobber", { accountId: "acct1", secret: encrypt(SECRET, JSON.stringify({ accessToken: "x", refreshToken: "y" })), status: "connected" });
});
afterAll(() => {
  d.accounts.repo.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Jobber disconnects", () => {
  it("marks the link as needing a reconnect and texts the owner a one-tap link, once", async () => {
    await expect(syncFsm(d, "ridge", "jobber")).rejects.toThrow(/invalid_grant/);
    expect(d.accounts.repo.getIntegration("ridge", "jobber")!.status).toBe("needs_reconnect");
    const text = d.notifier.sent.at(-1)!.text;
    expect(text).toMatch(/Jobber logged us out/);
    expect(text).toContain("https://qa.test/oauth/jobber/start?state=");
    // no hammering a dead login, and no second text
    const before = d.notifier.sent.length;
    expect(await syncFsm(d, "ridge", "jobber")).toBeUndefined();
    expect(pulls).toBe(1);
    expect(d.notifier.sent.length).toBe(before);
  });
});
