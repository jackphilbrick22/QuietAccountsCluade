import { afterEach, describe, expect, it } from "vitest";
import { sign, syncFsm, writeFsmNote } from "../src/core/ops.ts";
import { encrypt } from "../src/core/crypto.ts";
import { runTasks, tick } from "../src/core/worker.ts";
import { bodyCap } from "../src/http/app.ts";
import { buildCampaignBody } from "../src/integrations/instantly/campaign.ts";
import { ProviderError, type FsmConnector, type OAuthTokens, type OwnerNotifier, type PulledRecords } from "../src/contracts.ts";
import { LogEmailProvider } from "../src/providers/email.ts";
import { LogNotifier } from "../src/providers/sms.ts";
import { addLead, harness, SECRET, WH, type Harness } from "./harness.ts";

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

const empty = (): PulledRecords => ({ customers: [], quotes: [], jobs: [], invoices: [], requests: [], warnings: [] });

function fakeJobber(over: Partial<FsmConnector> = {}): FsmConnector & { calls: { refresh: number; pull: number } } {
  const calls = { refresh: 0, pull: 0 };
  return {
    calls,
    source: "jobber",
    authorizeUrl: (state, redirect) => `https://jobber.test/auth?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirect)}`,
    exchangeCode: async (code) => ({ accessToken: `a-${code}`, refreshToken: "r1", accountId: code.startsWith("other") ? "acct-other" : "acct-1", accountName: code.startsWith("other") ? "Someone Else LLC" : "Ridgeline" }),
    refresh: async (t) => {
      calls.refresh++;
      return { ...t, accessToken: "fresh", expiresAt: "2099-01-01T00:00:00Z" };
    },
    pull: async () => {
      calls.pull++;
      return empty();
    },
    verifyWebhook: (_raw, headers) => headers["x-jobber-hmac-sha256"] === "good",
    parseWebhook: () => undefined,
    ...over,
  };
}

const items = async (h: Harness) => (await h.api("GET", "/api/review")).json.items as Record<string, unknown>[];

describe("request bodies are capped before they're read (n5)", () => {
  it("webhooks take 256 KB, imports 25 MB, everything else 2 MB", () => {
    expect(bodyCap("/webhooks/jobber")).toBe(256 * 1024);
    expect(bodyCap(`/webhooks/sms/${WH}`)).toBe(256 * 1024);
    expect(bodyCap(`/webhooks/inbound-email/${WH}`)).toBe(25 * 1024 * 1024);
    expect(bodyCap("/api/businesses/ridge/imports")).toBe(25 * 1024 * 1024);
    expect(bodyCap("/api/businesses/ridge")).toBe(2 * 1024 * 1024);
  });

  it("an unsigned Jobber webhook is refused unread, and an oversized one with 413", async () => {
    const h = make({ fsm: { jobber: fakeJobber() } });
    const big = "x".repeat(300 * 1024);
    expect((await h.app.request("/webhooks/jobber", { method: "POST", body: big })).status).toBe(401);
    expect((await h.app.request("/webhooks/jobber", { method: "POST", headers: { "x-jobber-hmac-sha256": "good" }, body: big })).status).toBe(413);
    expect((await h.app.request("/webhooks/jobber", { method: "POST", headers: { "x-jobber-hmac-sha256": "good" }, body: "{}" })).status).toBe(200);
    expect((await h.app.request(`/webhooks/sms/${WH}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `Body=${big}` })).status).toBe(413);
  });

  it("an import takes a real export's size; an ordinary route doesn't", async () => {
    const h = make();
    await h.business("ridge");
    const padded = `{"files":[]}${" ".repeat(3 * 1024 * 1024)}`;
    expect((await h.api("POST", "/api/businesses/ridge/imports", padded)).status).toBe(400); // read, then refused as empty
    expect((await h.api("PATCH", "/api/businesses/ridge", padded)).status).toBe(413);
  });
});

describe("owner, import and connect links can be rotated (n6)", () => {
  it("a new client's links carry its key; rotating kills the old ones", async () => {
    const h = make();
    const created = await h.business("ridge");
    const oldOwner = String(created.ownerLink).split("/o/")[1]!;
    expect((await h.app.request(`/api/owner/${oldOwner}/overview`)).status).toBe(200);
    const rotated = (await h.api("POST", "/api/businesses/ridge/links/rotate")).json as { owner: string; importToken: string; connectJobber: string };
    expect((await h.app.request(`/api/owner/${oldOwner}/overview`)).status).toBe(401);
    expect((await h.app.request(`/api/owner/${rotated.owner.split("/o/")[1]}/overview`)).status).toBe(200);
    expect(rotated.importToken).not.toBe(created.importAddressToken);
    // an emailed export to the old import address is ignored
    const res = await h.app.request(`/webhooks/inbound-email/${WH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ MessageID: "m-old-import", From: "dave@x.com", To: `import+${created.importAddressToken}@in.qa.test`, Subject: "quotes", Attachments: [{ Name: "q.csv", Content: Buffer.from("Client name,Client email,Title,Total\nA B,a@b.com,Oak,900\n").toString("base64") }] }),
    });
    expect(((await res.json()) as { ignored?: boolean }).ignored).toBe(true);
  });

  it("a client made before link keys keeps its old links until the first rotation", async () => {
    const h = make();
    await h.business("legacy");
    h.d.accounts.repo.db.run("UPDATE businesses SET link_key = NULL WHERE id = 'legacy'");
    const legacy = sign(SECRET, "owner|legacy");
    expect((await h.app.request(`/api/owner/${legacy}/overview`)).status).toBe(200);
    await h.api("POST", "/api/businesses/legacy/links/rotate");
    expect((await h.app.request(`/api/owner/${legacy}/overview`)).status).toBe(401);
  });
});

describe("connecting Jobber (n8, n49)", () => {
  it("each trip to Jobber gets a single-use state that expires in 30 minutes", async () => {
    const jobber = fakeJobber();
    const h = make({ fsm: { jobber } });
    await h.business("ridge");
    const links = (await h.api("GET", "/api/businesses/ridge/links")).json as { connectJobber: string };
    const start = async () => {
      const res = await h.app.request(links.connectJobber.replace("https://qa.test", ""));
      expect(res.status).toBe(302);
      const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
      expect(state).not.toBe(new URL(links.connectJobber).searchParams.get("state"));
      return state;
    };
    const s1 = await start();
    const ok = await h.app.request(`/oauth/jobber/callback?state=${s1}&code=first`);
    expect(ok.status).toBe(200);
    expect(h.d.accounts.repo.getIntegration("ridge", "jobber")!.account_id).toBe("acct-1");
    expect((await h.app.request(`/oauth/jobber/callback?state=${s1}&code=again`)).status).toBe(400); // spent
    const s2 = await start();
    h.setNow("2026-09-29T14:31:00Z");
    expect((await h.app.request(`/oauth/jobber/callback?state=${s2}&code=late`)).status).toBe(400); // expired
    expect((await h.app.request(`/oauth/jobber/callback?state=${encodeURIComponent(sign(SECRET, "oauth|jobber|ridge"))}&code=x`)).status).toBe(400); // the old signed state
  });

  it("never re-binds a client to a different Jobber account; the operator is alerted", async () => {
    const h = make({ fsm: { jobber: fakeJobber() } });
    await h.business("ridge");
    const links = (await h.api("GET", "/api/businesses/ridge/links")).json as { connectJobber: string };
    const trip = async (code: string) => {
      const res = await h.app.request(links.connectJobber.replace("https://qa.test", ""));
      const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
      return h.app.request(`/oauth/jobber/callback?state=${state}&code=${code}`);
    };
    expect((await trip("first")).status).toBe(200);
    const before = h.d.accounts.repo.getIntegration("ridge", "jobber")!;
    const res = await trip("other-account");
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("different Jobber account");
    const after = h.d.accounts.repo.getIntegration("ridge", "jobber")!;
    expect(after.account_id).toBe("acct-1");
    expect(after.secret).toBe(before.secret);
    const alert = (await items(h)).find((i) => i.kind === "alert")!;
    expect(alert.title).toBe("Someone tried to connect a different Jobber account");
    expect(String(alert.detail)).toContain("acct-other");
    // the same account reconnecting is fine; the operator can disconnect to switch on purpose
    expect((await trip("again")).status).toBe(200);
    await h.api("DELETE", "/api/businesses/ridge/integrations/jobber");
    expect((await trip("other-account")).status).toBe(200);
  });

  it("the first sync texts the owner as the connect page promised, and puts the client in 'ready'", async () => {
    const h = make({ fsm: { jobber: fakeJobber() } });
    await h.business("ridge");
    const links = (await h.api("GET", "/api/businesses/ridge/links")).json as { connectJobber: string };
    const res = await h.app.request(links.connectJobber.replace("https://qa.test", ""));
    const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
    await h.app.request(`/oauth/jobber/callback?state=${state}&code=first`);
    await runTasks(h.d);
    expect((h.d.notifier as LogNotifier).sent.at(-1)!.text).toMatch(/^Dave, we're connected to your Jobber/);
    expect((await items(h)).map((i) => i.kind)).toEqual(["ready"]);
  });
});

describe("a dead Jobber login never stalls quietly (n49)", () => {
  const connect = (h: Harness, tokens: OAuthTokens) => h.d.accounts.repo.putIntegration("ridge", "jobber", { accountId: "acct-1", secret: encrypt(SECRET, JSON.stringify(tokens)), status: "connected", lastSyncAt: "2026-09-29T12:00:00Z" });

  it("an expired token whose refresh is refused marks the link and texts the owner, once", async () => {
    const jobber = fakeJobber({
      refresh: async () => {
        jobber.calls.refresh++;
        throw new ProviderError("Jobber token request failed (401): invalid_grant", "jobber", 401, false);
      },
    });
    const h = make({ fsm: { jobber } });
    await h.business("ridge");
    connect(h, { accessToken: "old", refreshToken: "dead", expiresAt: "2026-09-29T13:00:00Z" });
    await tick(h.d);
    const integ = h.d.accounts.repo.getIntegration("ridge", "jobber")!;
    expect(integ.status).toBe("needs_reconnect");
    expect(integ.last_error).toMatch(/invalid_grant/);
    expect(jobber.calls.pull).toBe(0);
    expect((h.d.notifier as LogNotifier).sent.at(-1)!.text).toMatch(/Jobber logged us out.*https:\/\/qa\.test\/oauth\/jobber\/start\?state=/s);
    for (let i = 1; i <= 3; i++) {
      h.setNow(new Date(Date.parse("2026-09-29T14:00:00Z") + i * 60000).toISOString());
      await tick(h.d);
    }
    expect(jobber.calls.refresh).toBe(1);
    expect((h.d.notifier as LogNotifier).sent.filter((m) => /logged us out/.test(m.text))).toHaveLength(1);
  });

  it("a passing failure is recorded and retried in 15 minutes, not every minute", async () => {
    const jobber = fakeJobber({
      pull: async () => {
        jobber.calls.pull++;
        throw new ProviderError("Jobber 503", "jobber", 503, true);
      },
    });
    const h = make({ fsm: { jobber } });
    await h.business("ridge");
    connect(h, { accessToken: "ok", refreshToken: "r" });
    h.d.accounts.repo.putIntegration("ridge", "jobber", { lastSyncAt: null });
    await tick(h.d);
    expect(h.d.accounts.repo.getIntegration("ridge", "jobber")).toMatchObject({ status: "connected", last_error: "Jobber 503" });
    h.setNow("2026-09-29T14:05:00Z");
    await tick(h.d);
    expect(jobber.calls.pull).toBe(1);
    h.setNow("2026-09-29T14:16:00Z");
    await tick(h.d);
    expect(jobber.calls.pull).toBe(2);
  });

  it("a note written back to Jobber with a dead login asks for a reconnect too", async () => {
    const jobber = fakeJobber({ writeNote: async () => Promise.reject(new ProviderError("Jobber GraphQL 401: unauthorized", "jobber", 401, false)) });
    const h = make({ fsm: { jobber }, env: { JOBBER_WRITE_NOTES: "on" } });
    await h.business("ridge");
    connect(h, { accessToken: "ok" });
    await expect(writeFsmNote(h.d, "ridge", { kind: "client", sourceId: "Z2lk", text: "hi" })).rejects.toThrow(/unauthorized/);
    expect(h.d.accounts.repo.getIntegration("ridge", "jobber")!.status).toBe("needs_reconnect");
    expect(await syncFsm(h.d, "ridge", "jobber")).toBeUndefined();
  });
});

describe("each client can send as itself (n51)", () => {
  it("uses the client's From name and address when set, the server's otherwise", async () => {
    const h = make();
    const email = h.d.email as LogEmailProvider;
    await h.business("ridge", { fromEmail: "sarah@ridgelinetree.com", fromName: "Sarah at Ridgeline" });
    await h.business("plain", { name: "Plain Tree" });
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T08:00:00", { intent: "question" });
    await addLead(h, "plain", "r2", "Dan Ruiz", "2026-09-29T08:00:00", { intent: "question" });
    expect((await h.api("POST", "/api/businesses/ridge/replies/r1/answer", { text: "Yes, we can grind the stump the same day." })).status).toBe(200);
    expect(email.sent.at(-1)).toMatchObject({ to: "c-r1@example.org", fromEmail: "sarah@ridgelinetree.com", fromName: "Sarah at Ridgeline" });
    expect((await h.api("POST", "/api/businesses/plain/replies/r2/answer", { text: "Yes, we can grind the stump the same day." })).status).toBe(200);
    expect(email.sent.at(-1)).toMatchObject({ fromName: "Sarah at Plain Tree" });
    expect(email.sent.at(-1)!.fromEmail).toBeUndefined();
    expect((await h.api("PATCH", "/api/businesses/plain", { fromEmail: "not an email" })).status).toBe(400);
    // Instantly: the client's own mailbox, else the server's rotation
    const pool = { sendingAccounts: ["box1@qa-mail.com", "box2@qa-mail.com"] };
    expect(buildCampaignBody(h.d.accounts.peek("ridge")!.state.dataset.business, 3, pool).email_list).toEqual(["sarah@ridgelinetree.com"]);
    expect(buildCampaignBody(h.d.accounts.peek("plain")!.state.dataset.business, 3, pool).email_list).toEqual(pool.sendingAccounts);
  });
});

describe("'Needs a person' can finish the job (n52)", () => {
  it("sends the AI draft in the thread, hands a reply to the owner, or drops the draft", async () => {
    const h = make();
    const notifier = h.d.notifier as LogNotifier;
    await h.business("ridge");
    await addLead(h, "ridge", "rq", "Kim Tran", "2026-09-29T09:30:00", { intent: "question", text: "Could you just grind the stump?", draft: { text: "Yes, we grind stumps too. Dave will call you with a price.", needsOwner: true, at: "2026-09-29T09:31:00" } });
    await addLead(h, "ridge", "ru", "Dan Ruiz", "2026-09-29T09:00:00", { intent: "unclear", status: "new", handedOffAt: undefined, text: "Might be interested, what would it cost?" });
    let queue = await items(h);
    expect(queue.find((i) => i.kind === "draft")).toMatchObject({ replyId: "rq", draft: "Yes, we grind stumps too. Dave will call you with a price.", draftNeedsOwner: true });
    expect(queue.find((i) => i.kind === "unclear")).toMatchObject({ replyId: "ru" });

    expect((await h.api("POST", "/api/businesses/ridge/replies/rq/answer", { useDraft: true })).status).toBe(200);
    expect((h.d.email as LogEmailProvider).sent.at(-1)).toMatchObject({ to: "c-rq@example.org", text: "Yes, we grind stumps too. Dave will call you with a price." });
    const handed = notifier.sent.length;
    expect((await h.api("POST", "/api/businesses/ridge/replies/ru/handoff")).status).toBe(200);
    expect(notifier.sent.length).toBe(handed + 1);
    expect(notifier.sent.at(-1)!.text).toMatch(/NEW — Dan Ruiz/);
    queue = await items(h);
    expect(queue.map((i) => i.kind)).toEqual([]);
    // a late lead can be texted to the owner again
    h.setNow("2026-09-29T20:00:00Z");
    expect((await items(h)).map((i) => `${i.kind}:${i.replyId}`).sort()).toEqual(["late_lead:rq", "late_lead:ru"]);
    expect((await h.api("POST", "/api/businesses/ridge/replies/rq/handoff")).status).toBe(200);
    expect(notifier.sent.at(-1)!.text).toMatch(/NEW — Kim Tran/);
    expect((await h.api("DELETE", "/api/businesses/ridge/replies/rq/draft")).status).toBe(404); // already sent and cleared
    expect((await h.api("POST", "/api/businesses/ridge/replies/nope/handoff")).status).toBe(404);
  });

  it("an unclear reply the operator answered leaves the queue (typed, or the draft as-is)", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "ru1", "Dan Ruiz", "2026-09-29T09:00:00", { intent: "unclear", status: "new", handedOffAt: undefined, text: "Might be interested, what would it cost?" });
    await addLead(h, "ridge", "ru2", "Kim Tran", "2026-09-29T09:10:00", { intent: "unclear", status: "new", handedOffAt: undefined, text: "Is this the tree people?", draft: { text: "Yes, this is Ridgeline Tree. Dave will call you about the oak.", needsOwner: false, at: "2026-09-29T09:11:00" } });
    expect((await items(h)).filter((i) => i.kind === "unclear").map((i) => i.replyId)).toEqual(["ru1", "ru2"]);
    expect((await h.api("POST", "/api/businesses/ridge/replies/ru1/answer", { text: "It depends on the tree. Dave can come look for free this week." })).status).toBe(200);
    expect((await h.api("POST", "/api/businesses/ridge/replies/ru2/answer", { useDraft: true })).status).toBe(200);
    expect((await items(h)).filter((i) => i.kind === "unclear")).toEqual([]);
    const st = h.d.accounts.peek("ridge")!.state;
    expect(st.replies.find((r) => r.id === "ru1")).toMatchObject({ status: "done", intent: "unclear" });
    expect(st.events.at(-1)!.title).toBe("Answered Kim Tran by hand");
    // a reply read before this rule (answered, still "new") doesn't come back either
    await h.d.accounts.withAccount("ridge", (s) => {
      s.replies.find((r) => r.id === "ru1")!.status = "new";
    });
    expect((await items(h)).filter((i) => i.kind === "unclear")).toEqual([]);
  });
});

describe("the worker at fifty clients (n54, n11)", () => {
  it("/api/health says how long a tick took and how far behind each client is", async () => {
    const h = make({ env: { WORKER_ENABLED: "true" } });
    await h.business("ridge");
    await tick(h.d);
    const pub = (await h.api("GET", "/api/health", undefined, { auth: false })).json as { ok: boolean; worker: Record<string, unknown> };
    expect(pub.ok).toBe(true);
    expect(pub.worker).toMatchObject({ stalled: false, ticks: 1, behind: 0, maxLagSeconds: 0 });
    expect(typeof pub.worker.lastTickMs).toBe("number");
    expect(pub.worker.businesses).toBeUndefined(); // client ids only with the operator token
    h.setNow("2026-09-29T14:20:00Z");
    const op = (await h.api("GET", "/api/health")).json as { ok: boolean; worker: { stalled: boolean; businesses: { id: string; lagSeconds: number }[] } };
    expect(op.ok).toBe(false);
    expect(op.worker.stalled).toBe(true);
    expect(op.worker.businesses).toEqual([expect.objectContaining({ id: "ridge", lagSeconds: 1200 })]);
  });

  it("one slow client doesn't hold up the rest; it's skipped until its turn finishes", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const sent: string[] = [];
    const notifier: OwnerNotifier = {
      name: "slow",
      notify: async (to, text) => {
        if (text.includes("slow")) await slow;
        sent.push(text);
        return { id: `n${sent.length}`, channel: "sms" };
      },
    };
    const h = make({ notifier, env: { WORKER_BUSINESS_BUDGET_MS: "50" } });
    await h.business("a-slow", { name: "Slow Tree" });
    await h.business("b-fine", { name: "Fine Tree", ownerPhone: "+16035550142" });
    await h.d.accounts.withAccount("a-slow", (s) => void s.ownerMessages.push({ id: "om-slow", at: "2026-09-29T09:00:00", kind: "info", text: "slow" }));
    await h.d.accounts.withAccount("b-fine", (s) => void s.ownerMessages.push({ id: "om-fine", at: "2026-09-29T09:00:00", kind: "info", text: "fine" }));
    const t0 = Date.now();
    const r1 = await tick(h.d);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r1.errors.some((e) => /a-slow turn: still running/.test(e))).toBe(true);
    expect(sent).toEqual(["fine"]);
    const r2 = await tick(h.d);
    expect(r2.busy).toBe(1);
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toEqual(["fine", "slow"]);
    expect((await tick(h.d)).busy).toBe(0);
  });

  it("the daily checks run from 9am even when no tick lands at 9:00, once a day", async () => {
    const h = make({ now: "2026-10-09T14:17:00Z" }); // 10:17 local
    await h.business("ridge");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.touches.push({ id: "t1", opportunityId: "o1", customerId: "c1", channel: "email", step: 1, angle: "check_in", dueAt: "2026-09-30T08:00", status: "sent", sentAt: "2026-09-30T08:00:00", body: "Hi", flags: [] });
    });
    await tick(h.d);
    expect(h.d.accounts.peek("ridge")!.state.ownerMessages.filter((m) => m.kind === "close")).toHaveLength(1);
    expect(h.d.accounts.repo.mark("ridge", "daily")).toBe("2026-10-09");
  });

  it("the nightly top-up runs once a night even when an hourly sync just re-scanned", async () => {
    const h = make({ now: "2026-10-09T07:10:00Z" }); // 3:10am local
    await h.business("ridge");
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", paidOn: "2026-09-01" } });
    h.d.accounts.repo.markScanned("ridge", "2026-10-09T07:00:00Z");
    const r = await tick(h.d);
    expect(r.errors).toEqual([]);
    expect(h.d.accounts.repo.mark("ridge", "nightly")).toBe("2026-10-09");
  });

  it("no billing text for the first paid day, and none after cancelling (n11)", async () => {
    const h = make({ now: "2026-10-15T13:30:00Z" }); // 9:30 local
    await h.business("paid-today", { name: "Paid Tree" });
    await h.business("gone", { name: "Gone Tree", ownerPhone: "+16035550142" });
    await h.api("PATCH", "/api/businesses/paid-today", { plan: { stage: "paying", paidOn: "2026-10-15" } });
    await h.api("PATCH", "/api/businesses/gone", { plan: { stage: "cancelled", paidOn: "2026-09-15" } });
    for (const at of ["2026-10-15T13:30:00Z", "2026-10-16T13:30:00Z", "2026-10-17T13:30:00Z"]) {
      h.setNow(at);
      await tick(h.d);
    }
    for (const bid of ["paid-today", "gone"]) {
      const s = h.d.accounts.peek(bid)!.state;
      expect(s.ownerMessages.filter((m) => ["precharge", "free_month"].includes(m.kind))).toEqual([]);
      expect(s.dataset.business.plan.freeMonths).toEqual([]);
    }
  });
});
