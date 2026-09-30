import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { Db } from "../src/db/sqlite.ts";
import { Repo } from "../src/db/repo.ts";
import { Accounts } from "../src/core/accounts.ts";
import { sign } from "../src/core/ops.ts";
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

  it("the owner's signature, the shop's inbox and its phone are never taken for the homeowner's", async () => {
    await api("POST", "/businesses", { id: "ridge-sig", name: "Ridgeline Tree Co.", trade: "tree", ownerName: "Dave Ridge", ownerPhone: "+16035550199", ownerEmail: "dave@ridgelinetree.com", businessPhone: "603-224-8811", signerName: "Sarah", mailingAddress: "14 Mill Rd, Concord, NH 03301", timezone: "America/New_York" });
    await api("PATCH", "/businesses/ridge-sig", { plan: { stage: "paying", paidOn: "2026-09-01" } });
    const l = (await api("GET", "/businesses/ridge-sig/links")) as { requestsAddress: string };
    const phoneOnly = `Can you get back to this one?\n\nDave Ridge\nRidgeline Tree Co. | (603) 224-8811\noffice@ridgelinetree.com\n\n---------- Forwarded message ---------\nFrom: Wix Forms <no-reply@wix.com>\nDate: Tue, Sep 29, 2026 at 6:12 PM\nSubject: New form submission\nTo: <office@ridgelinetree.com>\n\nName: Karen Whitfield\nPhone: (603) 555-0142\nMessage: Big oak leaning toward the garage.\n\nSent from ridgelinetree.com. Questions? sales@ridgelinetree.com or (603) 224-8811`;
    const r = await forward(l.requestsAddress, "Fwd: New form submission", phoneOnly);
    expect(r).toMatchObject({ taken: true, answered: 1 });
    const st = d.accounts.peek("ridge-sig")!.state;
    const karen = st.dataset.customers.find((c) => c.name === "Karen Whitfield")!;
    expect(karen).toMatchObject({ emails: [], phones: ["+16035550142"] });
    // nothing was mailed to the shop's own inbox; the owner is told to call
    expect((d.email as LogEmailProvider).sent.some((m) => /ridgelinetree\.com$/.test(m.to))).toBe(false);
    expect(st.ownerMessages.at(-1)!.text).toContain("No email on file");
  });

  it("the same person never gets two answers, even with two already queued (direct sending)", async () => {
    const { sendDue } = await import("../src/core/ops.ts");
    await api("POST", "/businesses", { id: "ridge-two", name: "Ridgeline Tree Co.", trade: "tree", ownerName: "Dave Ridge", ownerPhone: "+16035550199", signerName: "Sarah", mailingAddress: "14 Mill Rd, Concord, NH 03301", timezone: "America/New_York" });
    await d.accounts.withAccount("ridge-two", (s) => {
      s.dataset.customers.push({ id: "k1", sourceIds: [], name: "Kim Tran", firstName: "Kim", lastName: "Tran", emails: ["kim.tran@gmail.com"], phones: [], properties: [], tags: [] });
      for (const n of [1, 2])
        s.touches.push({ id: `t_ans_${n}`, opportunityId: `req:r${n}`, customerId: "k1", channel: "email", step: 1, angle: "check_in", dueAt: "2026-09-29T10:00", status: "approved", subject: `Your request ${n}`, body: `Hi Kim, thanks for reaching out (${n}). Dave will call you today.`, flags: [], instant: true, track: "new_request", askedAt: "2026-09-29T09:59" });
    });
    const before = (d.email as LogEmailProvider).sent.filter((m) => m.to === "kim.tran@gmail.com").length;
    await sendDue(d, "ridge-two");
    expect((d.email as LogEmailProvider).sent.filter((m) => m.to === "kim.tran@gmail.com").length).toBe(before + 1);
    const ts = d.accounts.peek("ridge-two")!.state.touches;
    expect(ts.map((t) => t.status).sort()).toEqual(["cancelled", "sent"]);
    expect(ts.find((t) => t.status === "cancelled")!.lastError).toMatch(/already had our answer/);
  });

  it("after 'Replace all links', a request sent to the old address reaches a person instead of vanishing", async () => {
    const old = (await api("GET", "/businesses/ridge/links")) as { requestsAddress: string };
    const fresh = (await api("POST", "/businesses/ridge/links/rotate")) as { requestsAddress: string };
    expect(fresh.requestsAddress).not.toBe(old.requestsAddress);
    const requests = d.accounts.peek("ridge")!.state.dataset.requests.length;
    const r = await forward(old.requestsAddress, "Fwd: New form submission", WEB_FORM.replace("karen.whitfield@gmail.com", "k.whit@example.org"));
    expect(r).toMatchObject({ ok: true, taken: false, oldAddress: true });
    // not answered (the old address was retired on purpose), but the operator has who and what
    expect(d.accounts.peek("ridge")!.state.dataset.requests).toHaveLength(requests);
    const items = (await api("GET", "/review")).items as { kind: string; businessId: string; title?: string; detail?: string }[];
    const alert = items.find((i) => i.businessId === "ridge" && i.title === "A request was forwarded to an old address")!;
    expect(alert.detail).toContain("Karen Whitfield");
    expect(alert.detail).toContain("k.whit@example.org");
    // the new address works; a forged one is still ignored
    expect(await forward(fresh.requestsAddress, "Fwd: New form submission", WEB_FORM.replace("karen.whitfield@gmail.com", "k.whit@example.org"))).toMatchObject({ taken: true });
    expect(await forward("requests+not-a-real-token@in.qa.test", "Fwd: hi", WEB_FORM)).toMatchObject({ ignored: true });
  });

  const oldAddressAlerts = async (bid: string) =>
    ((await api("GET", "/review")).items as { businessId: string; title?: string }[]).filter((i) => i.businessId === bid && i.title === "A request was forwarded to an old address");

  it("a deleted client's address never reaches a new client given the same id, not even as an 'old address' alert", async () => {
    const gone = await make("summit", true);
    const goneOwner = ((await api("GET", "/businesses/summit/links")) as { owner: string }).owner.split("/o/")[1]!;
    await api("DELETE", "/businesses/summit");
    const fresh = await make("summit", true);
    expect(fresh.requestsAddress).not.toBe(gone.requestsAddress);
    // the old company's website form still forwards here: their lead is not the new company's
    expect(await forward(gone.requestsAddress!, "Fwd: New form submission", WEB_FORM)).toMatchObject({ ok: true, ignored: true });
    expect(d.accounts.peek("summit")!.state.dataset.requests).toHaveLength(0);
    expect(await oldAddressAlerts("summit")).toEqual([]);
    expect((await app.request(`/api/owner/${goneOwner}/overview`)).status).toBe(401);
    // the new client's own replaced address still reaches a person
    await api("POST", "/businesses/summit/links/rotate");
    expect(await forward(fresh.requestsAddress!, "Fwd: New form submission", WEB_FORM)).toMatchObject({ taken: false, oldAddress: true });
    expect(await oldAddressAlerts("summit")).toHaveLength(1);
  });

  it("a client from before link keys: its keyless address is an old address after the first rotation, and nobody's once the id is reused", async () => {
    await make("elder", true);
    d.accounts.repo.db.run("UPDATE businesses SET link_key = NULL WHERE id = 'elder'");
    const keyless = `requests+${sign(d.cfg.APP_SECRET, "requests|elder")}@in.qa.test`;
    expect(await forward(keyless, "Fwd: New form submission", WEB_FORM)).toMatchObject({ taken: true });
    await api("POST", "/businesses/elder/links/rotate");
    expect(await forward(keyless, "Fwd: New form submission", WEB_FORM.replace("karen.whitfield@gmail.com", "k.w@example.org"))).toMatchObject({ taken: false, oldAddress: true });
    await api("DELETE", "/businesses/elder");
    await make("elder", true);
    expect(await forward(keyless, "Fwd: New form submission", WEB_FORM)).toMatchObject({ ignored: true });
    expect(await oldAddressAlerts("elder")).toEqual([]);
  });
});
