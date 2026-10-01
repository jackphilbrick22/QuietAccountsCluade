import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDays, generateSample, OFF_SEASON, type BusinessProfile, type Customer } from "@qa/engine";
import { pollReplies } from "../src/core/backstop.ts";
import { handleInbound, rescan, sendDue, syncSequencer } from "../src/core/ops.ts";
import { senderName } from "../src/core/senders.ts";
import { tick } from "../src/core/worker.ts";
import { inboxesText, parseInboxes } from "../../web/src/live/inboxes.ts";
import { diff, settingsKey } from "../../web/src/live/settings.ts";
import type { Llm } from "../src/agents/llm.ts";
import { createInstantlyProvider, parseInstantlyWebhook, type InstantlyProvider } from "../src/integrations/instantly/index.ts";
import { fakeInstantly, type Call } from "./fake-instantly.ts";
import { harness, WH, type Harness } from "./harness.ts";

/**
 * BRIEF A3: Instantly sets the sender's name per inbox, so a client sends only from inboxes of its own, each named for
 * it ("Sarah at Capital City Landscaping") and read back before its first activation and after every change, never one
 * in a campaign this server didn't make, never one another client has, and never the server's pool. And §4: Jack's
 * cold email runs in the same workspace; its replies and errors are logged and nothing more.
 */

const SARAH = "sarah@capcity-mail.com";
const OFFICE = "office@capcity-mail.com";
const PAT = "pat.lee@gmail.com";
const KIM = "kim.ng@yahoo.com";
const LEE = "lee.ross@gmail.com";
/** Dow's owner texts from his own cell. */
const ED_CELL = "+16035550111";

let open: Harness[] = [];
let dirs: string[] = [];
afterEach(() => {
  for (const h of open) h.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  open = [];
  dirs = [];
});

/** A server on a stateful fake Instantly: campaigns it made, the leads in them, and every inbox's name. */
function setup(opts: { emails?: unknown[]; dir?: string; env?: Record<string, string> } = {}) {
  const campaigns = new Map<string, { name: string; steps: number; status: number }>();
  const api = fakeInstantly({
    "GET /campaigns": (c) => ({ body: { items: [...campaigns].filter(([, x]) => x.name === c.query.search).map(([id, x]) => ({ id, name: x.name, status: x.status })) } }),
    "POST /campaigns": (c) => {
      const id = `camp-${campaigns.size + 1}`;
      campaigns.set(id, { name: c.body.name, steps: c.body.sequences[0].steps.length, status: 0 });
      return { body: { id, status: 0 } };
    },
    "GET /campaigns/:id": (c) => {
      const x = campaigns.get(c.path.split("/")[2]!)!;
      return { body: { id: c.path.split("/")[2], status: x.status, sequences: [{ steps: Array.from({ length: x.steps }, () => ({ type: "email" })) }] } };
    },
    "POST /campaigns/:id/activate": (c) => {
      campaigns.get(c.path.split("/")[2]!)!.status = 1;
      return { body: { status: 1 } };
    },
    "POST /campaigns/:id/pause": (c) => {
      campaigns.get(c.path.split("/")[2]!)!.status = 2;
      return { body: { status: 2 } };
    },
    "POST /leads/add": (c) => ({ body: { leads_uploaded: c.body.leads.length, created_leads: c.body.leads.map((l: { email: string }, index: number) => ({ index, id: `lead-${index}`, email: l.email })) } }),
    "POST /leads/list": () => ({ body: { items: [] } }),
    "GET /emails": () => ({ body: { items: opts.emails ?? [] } }),
    "GET /emails/:id": (c) => ({ body: (opts.emails as { id: string }[] | undefined)?.find((e) => e.id === c.path.split("/")[2]) }),
    "POST /emails/reply": () => ({ body: { id: "answer-1" } }),
    "GET /webhooks": () => ({ body: { items: [] } }),
  });
  const email: InstantlyProvider = createInstantlyProvider({ apiKey: "k", fetch: api.fetch, sleep: async () => {}, maxRetries: 0 });
  const h = harness({ email, dir: opts.dir, env: opts.env });
  open.push(h);
  h.d.parsers.instantly = (b) => parseInstantlyWebhook(b, h.now());
  const logs: string[] = [];
  h.d.log = (m) => void logs.push(m);
  const claude: string[] = [];
  const llm: Llm = { model: "fake", structured: async (_schema, o) => (claude.push(o.purpose), null) };
  return { h, api, campaigns, email, logs, claude, llm };
}

type Setup = ReturnType<typeof setup>;
const profile = (h: Harness, bid: string): BusinessProfile => h.d.accounts.peek(bid)!.state.dataset.business;
const sync = (s: Setup, bid: string) => syncSequencer(s.h.d, bid, s.email);
const account = (method: string, path: string, email: string) => (c: Call) => c.method === method && decodeURIComponent(c.path) === `${path}/${email}`;
const named = (s: Setup, email: string) => s.api.calls.filter(account("PATCH", "/accounts", email)).map((c) => c.body);
const pushes = (s: Setup) => s.api.callsTo("POST", "/leads/add").length;
const hook = (h: Harness, body: unknown) => h.app.request(`/webhooks/instantly/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const alerts = async (h: Harness) => ((await h.api("GET", "/api/review")).json.items as { kind: string; alertKind?: string; businessId: string; seq: number; title: string; detail: string }[]).filter((x) => x.kind === "alert" && x.alertKind === "senders");

/** A lawn client with notes approved and due tomorrow, as an existing account would have them. */
async function client(s: Pick<Setup, "h">, bid: string, over: Record<string, unknown> = {}, people: string[] = [PAT]): Promise<void> {
  await s.h.business(bid, { name: "Capital City Landscaping", trade: "lawn", ...over });
  await queue(s, bid, people);
}

/** Two notes each for more people, approved, the first due tomorrow. */
async function queue(s: Pick<Setup, "h">, bid: string, people: string[]): Promise<void> {
  await s.h.d.accounts.withAccount(bid, (st) => {
    const n = st.dataset.customers.length;
    const customers: Customer[] = people.map((email, i) => ({ id: `${bid}-c${n + i}`, sourceIds: [`${bid}-c${n + i}`], name: "Pat Lee", firstName: "Pat", lastName: "Lee", emails: [email], phones: [], properties: [], tags: [] }));
    st.dataset.customers = [...st.dataset.customers, ...customers];
    for (const c of customers)
      for (const step of [1, 2])
        st.touches.push({ id: `${c.id}-${step}`, opportunityId: `${c.id}-o`, customerId: c.id, channel: "email", step, angle: "check_in", dueAt: step === 1 ? "2026-09-30T09:15" : "2026-10-04T09:15", status: "approved", subject: step === 1 ? "the hedges" : "", body: `Note ${step} about the hedges.`, flags: [] });
  });
}

describe("a client's own inboxes", () => {
  it("a client with no inbox of its own isn't planned, from the console or by the worker, and never falls back to a server pool", async () => {
    const s = setup();
    const { h } = s;
    await h.business("ridge", { name: "Capital City Landscaping", trade: "lawn" });
    const sample = generateSample({ trade: "lawn", asOf: "2026-09-29", months: 12, quotesPerMonth: 10 });
    await h.api("POST", "/api/businesses/ridge/imports", { files: sample.files.map((f) => ({ name: f.name, text: f.text, kind: f.kind })) });
    const refused = await h.api("POST", "/api/businesses/ridge/plan", {});
    expect(refused.status).toBe(409);
    expect(refused.json.error).toBe("Add this client's own sending inbox first (Settings, “Notes come from (inboxes)”). In Instantly its notes go only from its own inboxes.");
    expect(h.d.accounts.peek("ridge")!.state.touches).toHaveLength(0);
    // paying: the worker's nightly top-up passes it by, without an error every minute of the night
    await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", paidOn: "2026-08-01" } });
    h.setNow("2026-09-30T07:00:00Z"); // 3am New York
    const night = await tick(h.d);
    expect(night.errors).toEqual([]);
    expect(h.d.accounts.peek("ridge")!.state.touches).toHaveLength(0);
    // with an inbox it plans, and every campaign it makes sends from that inbox alone
    expect((await h.api("PATCH", "/api/businesses/ridge", { fromEmails: [SARAH] })).status).toBe(200);
    h.setNow("2026-10-01T07:00:00Z");
    expect((await tick(h.d)).planned).toBeGreaterThan(0);
    h.setNow("2026-10-01T07:01:00Z");
    expect((await tick(h.d)).sent).toBeGreaterThan(0);
    expect(s.api.callsTo("POST", "/campaigns").length).toBeGreaterThan(0);
    for (const c of s.api.callsTo("POST", "/campaigns")) expect(c.body.email_list).toEqual([SARAH]);
  }, 30_000);

  it("an account with notes and no inbox hands nothing to Instantly, and says why where Jack looks", async () => {
    const s = setup();
    await client(s, "ridge");
    expect(await sync(s, "ridge")).toEqual({ sent: 0, failed: 0, held: 0 });
    expect(s.api.callsTo("POST", "/campaigns")).toHaveLength(0);
    expect(pushes(s)).toBe(0);
    expect(profile(s.h, "ridge").senders?.refused).toBe("it has no sending inbox of its own; add one in Settings");
    // the client page shows it (its profile), and Needs a person has it once
    expect((await s.h.api("GET", "/api/businesses/ridge")).json.business.senders.refused).toMatch(/no sending inbox/);
    await sync(s, "ridge");
    expect(await alerts(s.h)).toEqual([expect.objectContaining({ businessId: "ridge", title: "Capital City Landscaping: nothing goes out until its inboxes are fixed" })]);
    // an inbox in Settings checks again at once; one in Jack's cold campaign is refused for that, and Needs a person
    // has the new reason only
    s.api.inbox(OFFICE).campaigns = [{ campaign_id: "cold-oct", campaign_name: "Oct cold: lawn owners" }];
    await s.h.api("PATCH", "/api/businesses/ridge", { fromEmails: [OFFICE] });
    await sync(s, "ridge");
    const cold = `${OFFICE} is in “Oct cold: lawn owners”, a campaign this server didn't make; take it out in Instantly, since client inboxes never send cold email`;
    expect(profile(s.h, "ridge").senders?.refused).toBe(cold);
    expect((await alerts(s.h)).map((a) => a.detail)).toEqual([`${cold}. Checked again within 15 minutes, or as soon as Settings change.`]);
    // its own inbox: named, handed over, and the alert is closed
    await s.h.api("PATCH", "/api/businesses/ridge", { fromEmails: [SARAH] });
    expect((await sync(s, "ridge")).sent).toBe(1);
    expect(profile(s.h, "ridge").senders?.refused).toBeUndefined();
    expect(await alerts(s.h)).toEqual([]);
  });

  it("names each inbox before its first activation and reads it back: “Sarah” “at Capital City Landscaping”", async () => {
    const s = setup();
    await client(s, "ridge", { fromEmails: [SARAH, OFFICE] });
    expect((await sync(s, "ridge")).sent).toBe(1);
    for (const inbox of [SARAH, OFFICE]) {
      expect(named(s, inbox)).toEqual([{ first_name: "Sarah", last_name: "at Capital City Landscaping" }]);
      expect(s.api.calls.filter(account("GET", "/accounts", inbox))).toHaveLength(1);
      expect(s.api.inbox(inbox)).toMatchObject({ first_name: "Sarah", last_name: "at Capital City Landscaping" });
    }
    // in that order: its campaigns looked at, the name set and read back, and only then a campaign made and started
    const at = (pred: (c: Call) => boolean) => s.api.calls.findIndex(pred);
    expect(at(account("GET", "/account-campaign-mappings", SARAH))).toBeLessThan(at(account("PATCH", "/accounts", SARAH)));
    expect(at(account("GET", "/accounts", OFFICE))).toBeLessThan(at((c) => c.method === "POST" && c.path === "/campaigns"));
    expect(at((c) => c.path.endsWith("/activate"))).toBeGreaterThan(at((c) => c.method === "POST" && c.path === "/campaigns"));
    expect(s.api.callsTo("POST", "/campaigns")[0]!.body.email_list).toEqual([SARAH, OFFICE]);
    expect(s.h.d.accounts.peek("ridge")!.state.events.some((e) => e.title === "Its inboxes send as “Sarah at Capital City Landscaping” in Instantly")).toBe(true);
    // nothing changed: no more calls about the inboxes
    const calls = s.api.calls.length;
    await sync(s, "ridge");
    expect(s.api.calls.length).toBe(calls);
  });

  it("a From name goes on the inboxes as it's written: its first word, then the rest", () => {
    const b = { signerName: " Sarah ", name: "Capital  City Landscaping" } as BusinessProfile;
    expect(senderName(b)).toEqual({ first: "Sarah", last: "at Capital City Landscaping" });
    expect(senderName({ ...b, fromName: "Sarah Mills" })).toEqual({ first: "Sarah", last: "Mills" });
    expect(senderName({ ...b, fromName: " Megan at  Capital City " })).toEqual({ first: "Megan", last: "at Capital City" });
    expect(senderName({ ...b, fromName: "Sarah" })).toEqual({ first: "Sarah", last: "" });
  });

  it("the inboxes field in Settings shows the list a save sends: the text as typed, and the saved list again after Discard", () => {
    const saved = [SARAH];
    // a second inbox typed (any case, any separator): shown as typed, and the form's list is what it reads as
    const typed = `${SARAH}; Office@CapCity-Mail.com, `;
    const list = parseInboxes(typed);
    expect(list).toEqual([SARAH, OFFICE]);
    expect(inboxesText(typed, list)).toBe(typed);
    // Discard puts the saved list back in the form: the field shows it, not what was typed
    expect(inboxesText(typed, saved)).toBe(SARAH);
    expect(inboxesText(typed, [])).toBe("");
    expect(inboxesText("", [SARAH, OFFICE])).toBe(`${SARAH}, ${OFFICE}`);
  });

  it("a name that doesn't read back holds the client until it does; Instantly is asked again every 15 minutes", async () => {
    const s = setup();
    s.api.inbox(SARAH).keepsName = true;
    await client(s, "ridge", { fromEmails: [SARAH] });
    await sync(s, "ridge");
    expect(profile(s.h, "ridge").senders?.refused).toBe(`${SARAH} reads “Jack Philbrick” in Instantly, not “Sarah at Capital City Landscaping”`);
    expect(s.api.callsTo("POST", "/campaigns")).toHaveLength(0);
    expect(pushes(s)).toBe(0);
    expect((await alerts(s.h))[0]!.detail).toMatch(/reads “Jack Philbrick” in Instantly/);
    // fixed in Instantly: picked up on the next check, not every minute before it
    s.api.inbox(SARAH).keepsName = false;
    s.h.setNow("2026-09-29T14:05:00Z");
    await sync(s, "ridge");
    expect(named(s, SARAH)).toHaveLength(1);
    expect(pushes(s)).toBe(0);
    s.h.setNow("2026-09-29T14:16:00Z");
    expect((await sync(s, "ridge")).sent).toBe(1);
    expect(named(s, SARAH)).toHaveLength(2);
    expect(profile(s.h, "ridge").senders?.refused).toBeUndefined();
    expect(await alerts(s.h)).toEqual([]);
  });

  it("an inbox alert marked handled while the client is still refused is back in Needs a person on the next check", async () => {
    const s = setup();
    s.api.inbox(SARAH).keepsName = true;
    await client(s, "ridge", { fromEmails: [SARAH] });
    await sync(s, "ridge");
    const why = `${SARAH} reads “Jack Philbrick” in Instantly, not “Sarah at Capital City Landscaping”`;
    const [open] = await alerts(s.h);
    // Jack changes something in Instantly that doesn't cure it, and marks it handled
    expect((await s.h.api("POST", `/api/businesses/ridge/alerts/${open!.seq}/done`)).status).toBe(200);
    expect(await alerts(s.h)).toEqual([]);
    s.h.setNow("2026-09-29T14:16:00Z");
    await sync(s, "ridge");
    expect(profile(s.h, "ridge").senders?.refused).toBe(why);
    expect((await alerts(s.h)).map((a) => a.detail)).toEqual([`${why}. Checked again within 15 minutes, or as soon as Settings change.`]);
    // still one, check after check
    s.h.setNow("2026-09-29T14:32:00Z");
    await sync(s, "ridge");
    expect(await alerts(s.h)).toHaveLength(1);
    expect(pushes(s)).toBe(0);
  });

  it("a check that finds the same reason again leaves Jack's unsaved Settings alone", async () => {
    const s = setup();
    s.api.inbox(SARAH).keepsName = true;
    await client(s, "ridge", { fromEmails: [SARAH] });
    await sync(s, "ridge");
    const saved = async () => (await s.h.api("GET", "/api/businesses/ridge")).json.business as BusinessProfile;
    const before = await saved();
    s.h.setNow("2026-09-29T14:16:00Z");
    await sync(s, "ridge");
    const after = await saved();
    // the check's own record moved on (when it last looked); nothing the form edits did, so the form isn't started over
    expect(after.senders).not.toEqual(before.senders);
    expect(settingsKey(after)).toBe(settingsKey(before));
    // a save (his own, or anyone's) does start it over
    await s.h.api("PATCH", "/api/businesses/ridge", { fromEmails: [OFFICE] });
    expect(settingsKey(await saved())).not.toBe(settingsKey(after));
  });

  it("a From name emptied in Settings goes back to who signs, at the business, on the inboxes too", async () => {
    const s = setup();
    await client(s, "dows", { name: "Dow's Tree Service", signerName: "Sarah", fromName: "Sarah Mills", fromEmails: [SARAH] });
    await sync(s, "dows");
    expect(s.api.inbox(SARAH)).toMatchObject({ first_name: "Sarah", last_name: "Mills" });
    // Mike signs now, and the From name is emptied as its hint says: the save sends both
    const was = structuredClone(profile(s.h, "dows"));
    const patch = diff(was, { ...was, signerName: "Mike", fromName: "" });
    expect(patch).toEqual({ signerName: "Mike", fromName: null });
    expect((await s.h.api("PATCH", "/api/businesses/dows", patch)).status).toBe(200);
    expect(profile(s.h, "dows").fromName).toBeUndefined();
    await sync(s, "dows");
    expect(s.api.inbox(SARAH)).toMatchObject({ first_name: "Mike", last_name: "at Dow's Tree Service" });
    // emptied on its own, it's a change to save (not “Everything saved”); empty and still empty is nothing to save
    expect(diff(was, { ...was, fromName: " " })).toEqual({ fromName: null });
    const now = profile(s.h, "dows");
    expect(diff(now, { ...now, fromName: "" })).toEqual({});
  });

  it("a refusal once it's live pauses the campaigns it already has, until its inboxes are right again", async () => {
    const s = setup();
    await client(s, "ridge", { fromEmails: [SARAH] });
    await sync(s, "ridge");
    const [camp] = [...s.campaigns.keys()];
    expect(s.campaigns.get(camp!)!.status).toBe(1);
    // a new signer whose name doesn't stick: its campaign would go on sending under the old one
    s.api.inbox(SARAH).keepsName = true;
    await s.h.api("PATCH", "/api/businesses/ridge", { signerName: "Megan" });
    await sync(s, "ridge");
    expect(profile(s.h, "ridge").senders?.refused).toBe(`${SARAH} reads “Sarah at Capital City Landscaping” in Instantly, not “Megan at Capital City Landscaping”`);
    expect(s.campaigns.get(camp!)!.status).toBe(2);
    s.h.setNow("2026-09-29T14:10:00Z");
    await sync(s, "ridge");
    expect(s.campaigns.get(camp!)!.status).toBe(2);
    // the name sticks on the next check: back on, as Megan
    s.api.inbox(SARAH).keepsName = false;
    s.h.setNow("2026-09-29T14:16:00Z");
    await sync(s, "ridge");
    expect(s.api.inbox(SARAH)).toMatchObject({ first_name: "Megan", last_name: "at Capital City Landscaping" });
    expect(s.campaigns.get(camp!)!.status).toBe(1);
    // every inbox taken off in Settings: paused again
    await s.h.api("PATCH", "/api/businesses/ridge", { fromEmails: [] });
    await sync(s, "ridge");
    expect(profile(s.h, "ridge").senders?.refused).toBe("it has no sending inbox of its own; add one in Settings");
    expect(s.campaigns.get(camp!)!.status).toBe(2);
  });

  it("an inbox in a campaign this server didn't make is refused, and its name is left alone", async () => {
    const s = setup();
    s.api.inbox(SARAH).campaigns = [{ campaign_id: "cold-oct", campaign_name: "Oct cold: lawn owners" }];
    await client(s, "ridge", { fromEmails: [SARAH] });
    await sync(s, "ridge");
    expect(profile(s.h, "ridge").senders?.refused).toBe(`${SARAH} is in “Oct cold: lawn owners”, a campaign this server didn't make; take it out in Instantly, since client inboxes never send cold email`);
    // Jack's cold campaign keeps its sender: the name was never touched
    expect(named(s, SARAH)).toEqual([]);
    expect(s.api.inbox(SARAH)).toMatchObject({ first_name: "Jack", last_name: "Philbrick" });
    expect(s.api.callsTo("POST", "/campaigns")).toHaveLength(0);
    expect(pushes(s)).toBe(0);
    // an inbox Instantly doesn't have is refused too
    const t = setup();
    t.api.inbox(SARAH).missing = true;
    await client(t, "ridge", { fromEmails: [SARAH] });
    await sync(t, "ridge");
    expect(profile(t.h, "ridge").senders?.refused).toBe(`Instantly has no inbox ${SARAH}; connect it there first`);
    expect(pushes(t)).toBe(0);
  });

  it("an inbox Instantly won't name (an API key that can't update accounts) holds the client like any refusal, checked again every 15 minutes", async () => {
    const s = setup();
    let denied = true;
    let tries = 0;
    const fetch: typeof s.api.fetch = async (input, init) => {
      if (init?.method !== "PATCH" || !String(input).includes("/accounts/")) return s.api.fetch(input, init);
      tries++;
      return denied ? new Response(JSON.stringify({ message: "This API key can't update accounts" }), { status: 403, headers: { "content-type": "application/json" } }) : s.api.fetch(input, init);
    };
    const email = createInstantlyProvider({ apiKey: "k", fetch, sleep: async () => {}, maxRetries: 0 });
    s.h.d.email = email;
    await client(s, "ridge", { fromEmails: [SARAH] });
    expect(await syncSequencer(s.h.d, "ridge", email)).toEqual({ sent: 0, failed: 0, held: 0 });
    expect(profile(s.h, "ridge").senders?.refused).toBe(`Instantly wouldn't name ${SARAH} (Instantly PATCH /accounts/sarah%40capcity-mail.com → 403: This API key can't update accounts)`);
    expect(s.api.callsTo("POST", "/campaigns")).toHaveLength(0);
    expect(pushes(s)).toBe(0);
    expect((await alerts(s.h)).map((a) => a.businessId)).toEqual(["ridge"]);
    // the key fixed: not asked again every minute, but on the next check
    denied = false;
    s.h.setNow("2026-09-29T14:05:00Z");
    await syncSequencer(s.h.d, "ridge", email);
    expect(tries).toBe(1);
    expect(pushes(s)).toBe(0);
    s.h.setNow("2026-09-29T14:16:00Z");
    expect((await syncSequencer(s.h.d, "ridge", email)).sent).toBe(1);
    expect(tries).toBe(2);
    expect(s.api.inbox(SARAH)).toMatchObject({ first_name: "Sarah", last_name: "at Capital City Landscaping" });
    expect(await alerts(s.h)).toEqual([]);
  });

  it("Instantly out of reach holds nothing for good: no refusal, tried again next minute", async () => {
    const s = setup();
    await client(s, "ridge", { fromEmails: [SARAH] });
    const down = fakeInstantly({ "GET /account-campaign-mappings/:email": () => ({ status: 503, body: { message: "down" } }) });
    const flaky = createInstantlyProvider({ apiKey: "k", fetch: down.fetch, sleep: async () => {}, maxRetries: 0 });
    expect(await syncSequencer(s.h.d, "ridge", flaky)).toEqual({ sent: 0, failed: 0, held: 0 });
    expect(profile(s.h, "ridge").senders).toBeUndefined();
    expect(s.logs.some((l) => /couldn't check its inboxes/.test(l))).toBe(true);
    expect((await sync(s, "ridge")).sent).toBe(1);
  });

  it("renames the inboxes when the signer or the name changes, and sends later changes to the campaigns it made", async () => {
    const s = setup();
    await client(s, "ridge", { fromEmails: [SARAH], signerRole: "owner" });
    await sync(s, "ridge");
    const [camp] = [...s.campaigns.keys()];
    expect(s.api.callsTo("PATCH", `/campaigns/${camp}`)).toHaveLength(0);
    // the signer: renamed, and its own campaign is no reason to refuse
    await s.h.api("PATCH", "/api/businesses/ridge", { signerName: "Megan" });
    await sync(s, "ridge");
    expect(named(s, SARAH).at(-1)).toEqual({ first_name: "Megan", last_name: "at Capital City Landscaping" });
    expect(profile(s.h, "ridge").senders?.refused).toBeUndefined();
    // a From name
    await s.h.api("PATCH", "/api/businesses/ridge", { fromName: "Megan Ross" });
    await sync(s, "ridge");
    expect(named(s, SARAH).at(-1)).toEqual({ first_name: "Megan", last_name: "Ross" });
    // send days, window and timezone go to the campaign it already has
    await s.h.api("PATCH", "/api/businesses/ridge", { sendDays: [1, 3, 5], sendWindow: [8, 11], timezone: "America/Chicago" });
    await sync(s, "ridge");
    expect(s.api.callsTo("PATCH", `/campaigns/${camp}`).at(-1)!.body).toEqual({
      campaign_schedule: { schedules: [{ name: "Quiet Accounts", timing: { from: "08:00", to: "11:00" }, days: { "0": false, "1": true, "2": false, "3": true, "4": false, "5": true, "6": false }, timezone: "America/Chicago" }] },
      email_list: [SARAH],
      daily_max_leads: 25,
    });
    // and the pace: 100 new people a week over three send days
    await s.h.api("PATCH", "/api/businesses/ridge", { weeklyNewContacts: 100 });
    await sync(s, "ridge");
    expect(s.api.callsTo("PATCH", `/campaigns/${camp}`).at(-1)!.body.daily_max_leads).toBe(34);
    // a second inbox: named, then the campaign sends from both
    await s.h.api("PATCH", "/api/businesses/ridge", { fromEmails: [SARAH, OFFICE] });
    await sync(s, "ridge");
    expect(named(s, OFFICE)).toEqual([{ first_name: "Megan", last_name: "Ross" }]);
    // (a save that doesn't name the timezone, the trade or the signer's role leaves them as they are)
    expect(s.api.callsTo("PATCH", `/campaigns/${camp}`).at(-1)!.body).toMatchObject({ email_list: [SARAH, OFFICE], campaign_schedule: { schedules: [{ timezone: "America/Chicago" }] } });
    expect(profile(s.h, "ridge")).toMatchObject({ trade: "lawn", timezone: "America/Chicago", signerRole: "owner" });
    expect(s.api.made.get(camp!)!.email_list).toEqual([SARAH, OFFICE]);
    // once per change
    const updates = s.api.callsTo("PATCH", `/campaigns/${camp}`).length;
    await sync(s, "ridge");
    expect(s.api.callsTo("PATCH", `/campaigns/${camp}`)).toHaveLength(updates);
  });

  it("a campaign update that fails holds new notes back until it goes, and a resume waits for it", async () => {
    const s = setup();
    await client(s, "ridge", { fromEmails: [SARAH] }, [PAT]);
    await sync(s, "ridge");
    const [camp] = [...s.campaigns.keys()];
    await s.h.api("POST", "/api/businesses/ridge/pause", { paused: true });
    expect(s.campaigns.get(camp!)!.status).toBe(2);
    await s.h.api("PATCH", "/api/businesses/ridge", { sendWindow: [9, 12] });
    const down = fakeInstantly({ "PATCH /campaigns/:id": () => ({ status: 400, body: { message: "bad schedule" } }) });
    s.h.d.email = createInstantlyProvider({ apiKey: "k", fetch: down.fetch, sleep: async () => {}, maxRetries: 0 });
    await s.h.api("POST", "/api/businesses/ridge/pause", { paused: false });
    // still paused in Instantly: it would otherwise send on the old hours
    expect(s.campaigns.get(camp!)!.status).toBe(2);
    expect(profile(s.h, "ridge").platformPaused).toBeDefined();
    s.h.d.email = s.email;
    await sync(s, "ridge");
    expect(s.api.callsTo("PATCH", `/campaigns/${camp}`).at(-1)!.body.campaign_schedule.schedules[0].timing).toEqual({ from: "09:00", to: "12:00" });
    expect(s.campaigns.get(camp!)!.status).toBe(1);
  });

  it("a campaign that can't take the client's new inboxes is paused until it can: it would go on sending from the old ones", async () => {
    const s = setup();
    await client(s, "capital", { fromEmails: [SARAH] });
    await client(s, "dows", { name: "Dow's Tree Service", signerName: "Ed", ownerPhone: ED_CELL }, [KIM]);
    await sync(s, "capital");
    const [camp] = [...s.campaigns.keys()];
    let broken = true;
    const fetch: typeof s.api.fetch = async (input, init) => (broken && init?.method === "PATCH" && String(input).includes("/campaigns/") ? new Response(JSON.stringify({ message: "bad request" }), { status: 400, headers: { "content-type": "application/json" } }) : s.api.fetch(input, init));
    const flaky = createInstantlyProvider({ apiKey: "k", fetch, sleep: async () => {}, maxRetries: 0 });
    s.h.d.email = flaky;
    // new hours that don't reach it: it keeps sending on the old ones, and nothing new is handed over meanwhile
    await s.h.api("PATCH", "/api/businesses/capital", { sendWindow: [8, 11] });
    await syncSequencer(s.h.d, "capital", flaky);
    expect(s.campaigns.get(camp!)!.status).toBe(1);
    // a new inbox that doesn't reach it: paused
    await s.h.api("PATCH", "/api/businesses/capital", { fromEmails: [OFFICE] });
    await syncSequencer(s.h.d, "capital", flaky);
    expect(s.campaigns.get(camp!)!.status).toBe(2);
    expect(profile(s.h, "capital").platformPaused?.why).toBe("an inbox change its campaigns in Instantly don't have yet");
    // held, it doesn't keep its old inbox from the client that has it now
    await s.h.api("PATCH", "/api/businesses/dows", { fromEmails: [SARAH] });
    expect((await syncSequencer(s.h.d, "dows", flaky)).sent).toBe(1);
    expect(s.api.inbox(SARAH)).toMatchObject({ first_name: "Ed", last_name: "at Dow's Tree Service" });
    // once the update goes through, back on from the new inbox, and only then
    broken = false;
    await syncSequencer(s.h.d, "capital", flaky);
    expect(s.api.made.get(camp!)!.email_list).toEqual([OFFICE]);
    expect(s.campaigns.get(camp!)!.status).toBe(1);
    expect(profile(s.h, "capital").platformPaused).toBeUndefined();
    const last = (pred: (c: Call) => boolean) => s.api.calls.map(pred).lastIndexOf(true);
    expect(last((c) => c.method === "PATCH" && c.path === `/campaigns/${camp}`)).toBeLessThan(last((c) => c.path === `/campaigns/${camp}/activate`));
  });

  it("a campaign update that keeps failing still takes back people it can no longer write to, while the campaign sends on", async () => {
    const s = setup();
    await client(s, "capital", { fromEmails: [SARAH] }, [PAT, KIM]);
    await sync(s, "capital");
    const [camp] = [...s.campaigns.keys()];
    // (no send days at all isn't saved: no campaign could take it)
    const days = profile(s.h, "capital").sendDays;
    expect((await s.h.api("PATCH", "/api/businesses/capital", { sendDays: [] })).status).toBe(400);
    expect(profile(s.h, "capital").sendDays).toEqual(days);
    const fetch: typeof s.api.fetch = async (input, init) => (init?.method === "PATCH" && String(input).includes("/campaigns/") ? new Response(JSON.stringify({ message: "bad request" }), { status: 400, headers: { "content-type": "application/json" } }) : s.api.fetch(input, init));
    const flaky = createInstantlyProvider({ apiKey: "k", fetch, sleep: async () => {}, maxRetries: 0 });
    s.h.d.email = flaky;
    // new hours that don't reach its campaign, and Pat marked do-not-contact in the owner's software
    await s.h.api("PATCH", "/api/businesses/capital", { sendWindow: [8, 11] });
    await s.h.d.accounts.withAccount("capital", (st) => void (st.dataset.customers.find((c) => c.emails[0] === PAT)!.doNotContact = true));
    const listed = s.api.callsTo("POST", "/leads/list").length;
    expect(await syncSequencer(s.h.d, "capital", flaky)).toEqual({ sent: 0, failed: 0, held: 0 });
    // its campaign sends on, on the old hours, without Pat
    expect(s.campaigns.get(camp!)!.status).toBe(1);
    expect(s.api.callsTo("POST", "/leads/list").slice(listed).map((c) => [c.body.campaign, c.body.contacts])).toEqual([[camp, [PAT]]]);
    const notes = (email: string) => {
      const st = s.h.d.accounts.peek("capital")!.state;
      const c = st.dataset.customers.find((x) => x.emails[0] === email)!;
      return st.touches.filter((t) => t.customerId === c.id).map((t) => t.status);
    };
    expect(notes(PAT)).toEqual(["cancelled", "cancelled"]);
    expect(notes(KIM)).toEqual(["approved", "approved"]);
  });
});

describe("one inbox sends for one client", () => {
  it("is refused while another client has it, and free once that client is cancelled", async () => {
    const h = harness();
    open.push(h);
    await h.business("capital", { name: "Capital City Landscaping", fromEmails: [SARAH] });
    const dup = await h.api("POST", "/api/businesses", { id: "dows", name: "Dow's Tree Service", ownerName: "Ed Dow", signerName: "Ed", mailingAddress: "2 Pine Rd, Concord, NH 03301", fromEmails: [" Sarah@CapCity-Mail.com "] });
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe(`${SARAH} already sends for Capital City Landscaping. One inbox sends for one client: give this one its own.`);
    await h.business("dows", { name: "Dow's Tree Service" });
    expect((await h.api("PATCH", "/api/businesses/dows", { fromEmails: [OFFICE, SARAH] })).status).toBe(409);
    expect((await h.api("PATCH", "/api/businesses/dows", { fromEmails: [OFFICE] })).status).toBe(200);
    // cancelled, Capital City lets it go
    await h.api("PATCH", "/api/businesses/capital", { plan: { stage: "cancelled" } });
    expect((await h.api("PATCH", "/api/businesses/dows", { fromEmails: [OFFICE, SARAH] })).status).toBe(200);
    expect(h.d.accounts.peek("dows")!.state.dataset.business.fromEmails).toEqual([OFFICE, SARAH]);
    // and can't come back holding it
    const back = await h.api("PATCH", "/api/businesses/capital", { plan: { stage: "trial" } });
    expect(back.status).toBe(409);
    expect(back.json.error).toMatch(/already sends for Dow's Tree Service/);
    expect(h.d.accounts.peek("capital")!.state.dataset.business.plan.stage).toBe("cancelled");
    // a save that leaves the inboxes alone is never refused
    expect((await h.api("PATCH", "/api/businesses/capital", { city: "Concord" })).status).toBe(200);
  });

  it("two clients that hold the same inbox anyway (restored by hand) are both held, the one already sending too", async () => {
    const s = setup();
    await client(s, "capital", { fromEmails: [SARAH] });
    await client(s, "dows", { name: "Dow's Tree Service" }, [KIM]);
    expect((await sync(s, "capital")).sent).toBe(1);
    const [camp] = [...s.campaigns.keys()];
    await s.h.d.accounts.withAccount("dows", (st) => void (st.dataset.business.fromEmails = [SARAH]));
    await queue(s, "capital", [LEE]);
    expect(await sync(s, "dows")).toEqual({ sent: 0, failed: 0, held: 0 });
    expect(await sync(s, "capital")).toEqual({ sent: 0, failed: 0, held: 0 });
    expect(profile(s.h, "dows").senders?.refused).toBe(`${SARAH} already sends for Capital City Landscaping, and one inbox sends for one client`);
    expect(profile(s.h, "capital").senders?.refused).toBe(`${SARAH} already sends for Dow's Tree Service, and one inbox sends for one client`);
    expect(pushes(s)).toBe(1);
    expect(s.campaigns.get(camp!)!.status).toBe(2);
    expect((await alerts(s.h)).map((a) => a.businessId).sort()).toEqual(["capital", "dows"]);
    // Dow's cancelled: its inboxes are nobody's to fix any more, so its alert leaves Needs a person
    await s.h.api("PATCH", "/api/businesses/dows", { plan: { stage: "cancelled" } });
    expect((await alerts(s.h)).map((a) => a.businessId)).toEqual(["capital"]);
  });

  it("an inbox handed back to a client that returns is named for it again before anything of its goes", async () => {
    const s = setup();
    await client(s, "capital", { fromEmails: [SARAH] });
    await client(s, "dows", { name: "Dow's Tree Service", signerName: "Ed", ownerPhone: ED_CELL }, [KIM]);
    await sync(s, "capital");
    const [camp] = [...s.campaigns.keys()];
    await s.h.api("PATCH", "/api/businesses/capital", { plan: { stage: "cancelled" } });
    expect((await s.h.api("PATCH", "/api/businesses/dows", { fromEmails: [SARAH] })).status).toBe(200);
    expect((await sync(s, "dows")).sent).toBe(1);
    expect(s.api.inbox(SARAH)).toMatchObject({ first_name: "Ed", last_name: "at Dow's Tree Service" });
    await s.h.api("PATCH", "/api/businesses/dows", { plan: { stage: "cancelled" } });
    expect((await s.h.api("PATCH", "/api/businesses/capital", { plan: { stage: "trial" } })).status).toBe(200);
    await queue(s, "capital", [LEE]);
    expect((await sync(s, "capital")).sent).toBe(1);
    expect(s.api.inbox(SARAH)).toMatchObject({ first_name: "Sarah", last_name: "at Capital City Landscaping" });
    // named for it and read back before its campaign was turned back on, and before anyone new was handed over
    const last = (pred: (c: Call) => boolean) => s.api.calls.map(pred).lastIndexOf(true);
    const readBack = last(account("GET", "/accounts", SARAH));
    expect(named(s, SARAH).at(-1)).toEqual({ first_name: "Sarah", last_name: "at Capital City Landscaping" });
    expect(readBack).toBeLessThan(last((c) => c.path === `/campaigns/${camp}/activate`));
    expect(readBack).toBeLessThan(last((c) => c.path === "/leads/add"));
  });

  it("a cancelled client isn't restored onto an inbox another client has now: not by Restore plan, not by UNDO", async () => {
    const s = setup({ env: { FEATURE_YEARLY: "on" } });
    await client(s, "capital", { fromEmails: [SARAH] });
    await client(s, "dows", { name: "Dow's Tree Service", signerName: "Ed", ownerPhone: ED_CELL }, [KIM]);
    await sync(s, "capital");
    expect(await s.h.sms("CANCEL")).toMatch(/^Done — cancelled\./);
    expect((await s.h.api("PATCH", "/api/businesses/dows", { fromEmails: [SARAH] })).status).toBe(200);
    await sync(s, "dows");
    const restore = await s.h.api("POST", "/api/businesses/capital/restore-plan");
    expect(restore.status).toBe(409);
    expect(restore.json.error).toBe(`${SARAH} already sends for Dow's Tree Service. One inbox sends for one client: give this one its own.`);
    expect(await s.h.sms("UNDO")).toBe("Glad you're staying. Jack will set you back up himself and text you.");
    expect(profile(s.h, "capital").plan.stage).toBe("cancelled");
    const review = (await s.h.api("GET", "/api/review")).json.items as { kind: string; alertKind?: string; businessId: string; detail: string }[];
    expect(review.filter((x) => x.alertKind === "undo_inbox")).toEqual([expect.objectContaining({ businessId: "capital", detail: `${SARAH} sends for Dow's Tree Service now, and one inbox sends for one client. Give them an inbox of their own in Settings, then restore the plan.` })]);
    // Dow's goes on as it was
    expect(profile(s.h, "dows").senders?.refused).toBeUndefined();
    expect(s.api.inbox(SARAH)).toMatchObject({ first_name: "Ed", last_name: "at Dow's Tree Service" });
    // with an inbox of its own, the plan is restored and sends from that
    await s.h.api("PATCH", "/api/businesses/capital", { fromEmails: [OFFICE] });
    expect((await s.h.api("POST", "/api/businesses/capital/restore-plan")).status).toBe(200);
    expect(profile(s.h, "capital").plan.stage).toBe("trial");
    expect(s.api.inbox(OFFICE)).toMatchObject({ first_name: "Sarah", last_name: "at Capital City Landscaping" });
  });

  it("an inbox moved to another client is named for it only once the first client's campaign has let go of it", async () => {
    const s = setup();
    await client(s, "capital", { fromEmails: [SARAH] });
    await client(s, "dows", { name: "Dow's Tree Service", signerName: "Ed", ownerPhone: ED_CELL }, [KIM]);
    await sync(s, "capital");
    const [camp] = [...s.campaigns.keys()];
    await s.h.api("PATCH", "/api/businesses/capital", { fromEmails: [OFFICE] });
    expect((await s.h.api("PATCH", "/api/businesses/dows", { fromEmails: [SARAH] })).status).toBe(200);
    // Dow's turn first: Capital City's campaign still sends from it, as Capital City
    expect(await sync(s, "dows")).toEqual({ sent: 0, failed: 0, held: 0 });
    expect(profile(s.h, "dows").senders?.refused).toBe(`${SARAH} is still in “${s.campaigns.get(camp!)!.name}”, Capital City Landscaping's campaign; it sends for this client once that campaign stops sending from it`);
    expect(named(s, SARAH)).toEqual([{ first_name: "Sarah", last_name: "at Capital City Landscaping" }]);
    // Capital City's campaign moves to its new inbox; Dow's is named on its next check
    await sync(s, "capital");
    expect(s.api.made.get(camp!)!.email_list).toEqual([OFFICE]);
    s.h.setNow("2026-09-29T14:16:00Z");
    expect((await sync(s, "dows")).sent).toBe(1);
    expect(s.api.inbox(SARAH)).toMatchObject({ first_name: "Ed", last_name: "at Dow's Tree Service" });
    expect(s.campaigns.get(camp!)!.status).toBe(1);
  });

  it("a reply is answered in its thread only while no other client sends from the inbox it came in on", async () => {
    const theirs = (id: string, lead: string) => ({ id, thread_id: `th-${id}`, from_address_email: lead, to_address_email_list: SARAH, lead, i_sent: false });
    const s = setup({ emails: [theirs("em-pat", PAT), theirs("em-kim", KIM)] });
    await client(s, "capital", { fromEmails: [SARAH] }, [PAT, KIM]);
    await client(s, "dows", { name: "Dow's Tree Service", signerName: "Ed", ownerPhone: ED_CELL }, [LEE]);
    // (an account from before the instant answer was switched off)
    await s.h.d.accounts.withAccount("capital", (st) => void (st.dataset.business.autoAck = true));
    await sync(s, "capital");
    const [camp] = [...s.campaigns.keys()];
    const reply = (id: string, lead: string) => hook(s.h, { event_type: "reply_received", timestamp: s.h.now().toISOString(), campaign_id: camp, lead_email: lead, email_account: SARAH, email_id: id, reply_subject: "Re: the hedges", reply_text: "Yes please, come do the hedges." });
    const replies = () => s.h.d.accounts.peek("capital")!.state.replies;
    const answer = () => s.h.api("POST", `/api/businesses/capital/replies/${replies()[0]!.id}/answer`, { text: "Thursday morning works. Sarah" });
    const answered = () => s.api.callsTo("POST", "/emails/reply").map((c) => c.body.eaccount);
    // Pat's instant answer and Jack's go from the inbox Pat wrote to
    await reply("em-pat", PAT);
    expect(replies()[0]!.ack?.sentAt).toBeDefined();
    expect((await answer()).status).toBe(200);
    expect(answered()).toEqual([SARAH, SARAH]);
    // taken off Capital City, it still answers for it: nobody else has it
    await s.h.api("PATCH", "/api/businesses/capital", { fromEmails: [OFFICE] });
    await sync(s, "capital");
    expect((await answer()).status).toBe(200);
    expect(answered()).toHaveLength(3);
    // given to Dow's and named for it: an answer from it would go out as “Ed at Dow's Tree Service”
    expect((await s.h.api("PATCH", "/api/businesses/dows", { fromEmails: [SARAH] })).status).toBe(200);
    expect((await sync(s, "dows")).sent).toBe(1);
    expect(s.api.inbox(SARAH)).toMatchObject({ first_name: "Ed", last_name: "at Dow's Tree Service" });
    const refused = `${SARAH} sends for Dow's Tree Service now, and one inbox sends for one client: answer them by hand`;
    const again = await answer();
    expect(again.status).toBe(400);
    expect(again.json.error).toBe(refused);
    // Kim's reply to Capital City's note on it: no instant answer either
    await reply("em-kim", KIM);
    expect(replies().find((r) => r.from === KIM)!.ack).toMatchObject({ error: refused });
    expect(replies().find((r) => r.from === KIM)!.ack?.sentAt).toBeUndefined();
    expect(answered()).toHaveLength(3);
  });
  it("a reply isn't answered from an inbox that went to another client, even once that client is cancelled: it carries their name", async () => {
    const theirs = (id: string, lead: string) => ({ id, thread_id: `th-${id}`, from_address_email: lead, to_address_email_list: SARAH, lead, i_sent: false });
    const s = setup({ emails: [theirs("em-pat", PAT)] });
    await client(s, "capital", { fromEmails: [SARAH] }, [PAT]);
    await client(s, "dows", { name: "Dow's Tree Service", signerName: "Ed", ownerPhone: ED_CELL }, [LEE]);
    await s.h.d.accounts.withAccount("capital", (st) => void (st.dataset.business.autoAck = true));
    await sync(s, "capital");
    const [camp] = [...s.campaigns.keys()];
    // sarah@ off Capital City and on Dow's, renamed for it; then Dow's cancels, and a cancel never names it back
    await s.h.api("PATCH", "/api/businesses/capital", { fromEmails: [OFFICE] });
    await sync(s, "capital");
    expect((await s.h.api("PATCH", "/api/businesses/dows", { fromEmails: [SARAH] })).status).toBe(200);
    expect((await sync(s, "dows")).sent).toBe(1);
    await s.h.api("PATCH", "/api/businesses/dows", { plan: { stage: "cancelled" } });
    expect(s.api.inbox(SARAH)).toMatchObject({ first_name: "Ed", last_name: "at Dow's Tree Service" });
    // Pat answers Capital City's note on it: no instant answer, and none from the console
    await hook(s.h, { event_type: "reply_received", timestamp: s.h.now().toISOString(), campaign_id: camp, lead_email: PAT, email_account: SARAH, email_id: "em-pat", reply_subject: "Re: the hedges", reply_text: "Yes please, come do the hedges." });
    const r = s.h.d.accounts.peek("capital")!.state.replies[0]!;
    const refused = `${SARAH} went to Dow's Tree Service, and may still carry its name in Instantly: answer them by hand`;
    expect(r.ack).toMatchObject({ error: refused });
    const answer = await s.h.api("POST", `/api/businesses/capital/replies/${r.id}/answer`, { text: "Thursday morning works. Sarah" });
    expect(answer.status).toBe(400);
    expect(answer.json.error).toBe(refused);
    expect(s.api.callsTo("POST", "/emails/reply")).toEqual([]);
    // Dow's own late replies on it are still answered: it's named for Dow's
    await s.h.d.accounts.withAccount("dows", (st) => void st.replies.push({ ...r, id: "rep-dows", customerId: undefined }));
    expect((await s.h.api("POST", "/api/businesses/dows/replies/rep-dows/answer", { text: "Thanks. Ed" })).status).toBe(200);
    expect(s.api.callsTo("POST", "/emails/reply").map((c) => c.body.eaccount)).toEqual([SARAH]);
  });
});

describe("existing accounts", () => {
  it("keep their one address as their one inbox, and the campaigns their notes are in stay the server's own", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-inbox-mig-"));
    try {
      const h = harness({ dir });
      const db = h.d.accounts.repo.db;
      db.run("INSERT INTO businesses (id, profile, as_of, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", "old", JSON.stringify({ id: "old", name: "Old Lawn", fromEmail: " Sarah@OldLawn-Mail.com " }), "2026-09-01", "2026-09-01", "2026-09-01");
      db.run("INSERT INTO businesses (id, profile, as_of, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", "none", JSON.stringify({ id: "none", name: "No Inbox" }), "2026-09-01", "2026-09-01", "2026-09-01");
      const touch = (id: string, provider: string, data: object) => db.run("INSERT INTO touches (business_id, id, customer_id, opportunity_id, step, status, due_at, provider_id, data, hash) VALUES ('old', ?, 'c1', 'o1', 1, 'sent', '2026-09-01T09:00', ?, ?, 'h')", id, provider, JSON.stringify(data));
      touch("t1", "instantly:camp-9:pat.lee@gmail.com:1", {});
      touch("t2", "instantly:camp-now:kim.ng@yahoo.com:1", { instant: true });
      db.run("UPDATE schema_version SET v = 4");
      db.run("DROP TABLE campaigns");
      h.close();
      const again = harness({ dir });
      const row = (id: string) => JSON.parse(again.d.accounts.repo.db.get<{ profile: string }>("SELECT profile FROM businesses WHERE id = ?", id)!.profile);
      expect(row("old")).toEqual({ id: "old", name: "Old Lawn", fromEmails: ["sarah@oldlawn-mail.com"] });
      expect(row("none")).toEqual({ id: "none", name: "No Inbox" });
      expect(again.d.accounts.repo.campaignsOf("instantly", "old")).toEqual([
        { id: "camp-9", kind: "nurture" },
        { id: "camp-now", kind: "instant" },
      ]);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("one already live in Instantly is checked on its first sync after the upgrade, with nothing new to hand over", async () => {
    const OLD = "sarah@oldlawn-mail.com";
    const dir = mkdtempSync(join(tmpdir(), "qa-inbox-live-"));
    dirs.push(dir);
    // before: one address on the profile (or none), and notes handed to campaigns that sent from the server's pool:
    // all sent for one, a follow-up still waiting in Instantly for the other
    const h = harness({ dir });
    await client({ h }, "old", { name: "Old Lawn Co" }, [PAT]);
    await client({ h }, "none", { name: "No Inbox Lawn" }, [KIM]);
    for (const [bid, camp, sent] of [["old", "camp-old", 2], ["none", "camp-none", 1]] as const)
      await h.d.accounts.withAccount(bid, (st) => {
        for (const t of st.touches) {
          t.providerId = `instantly:${camp}:${st.dataset.customers[0]!.emails[0]}:${t.step}`;
          if (t.step <= sent) Object.assign(t, { status: "sent", sentAt: "2026-09-25T09:15:00" });
        }
      });
    const db = h.d.accounts.repo.db;
    db.run("UPDATE businesses SET profile = json_set(profile, '$.fromEmail', ' Sarah@OldLawn-Mail.com ') WHERE id = 'old'");
    db.run("UPDATE schema_version SET v = 4");
    db.run("DROP TABLE campaigns");
    h.close();
    // after: the first sync names its inbox, reads it back and moves its campaign onto it
    const s = setup({ dir });
    for (const id of ["camp-old", "camp-none"]) s.campaigns.set(id, { name: id, steps: 2, status: 1 });
    s.api.inbox(OLD).campaigns = [{ campaign_id: "camp-old", campaign_name: "Old Lawn Co" }];
    expect(await sync(s, "old")).toEqual({ sent: 0, failed: 0, held: 0 });
    expect(named(s, OLD)).toEqual([{ first_name: "Sarah", last_name: "at Old Lawn Co" }]);
    expect(s.api.calls.filter(account("GET", "/accounts", OLD))).toHaveLength(1);
    expect(s.api.callsTo("PATCH", "/campaigns/camp-old").map((c) => c.body.email_list)).toEqual([[OLD]]);
    expect(s.campaigns.get("camp-old")!.status).toBe(1);
    // with no inbox of its own, its campaign (still on the pool, as Jack Philbrick) is paused
    await sync(s, "none");
    expect(profile(s.h, "none").senders?.refused).toBe("it has no sending inbox of its own; add one in Settings");
    expect(s.campaigns.get("camp-none")!.status).toBe(2);
    expect(pushes(s)).toBe(0);
  });
});

describe("cold email in the same workspace", () => {
  const coldReply = { event_type: "reply_received", timestamp: "2026-09-29T15:00:00.000Z", campaign_id: "cold-oct", lead_email: PAT, email_account: "jack@qa-outreach.com", email_id: "em-cold-1", reply_text: "Sounds interesting, tell me more about the free 150." };
  it("a reply to a cold campaign is only logged: no Claude read, no review item, no client's reply — even from a client's customer", async () => {
    const s = setup();
    s.h.d.llm = s.llm;
    await client(s, "ridge", { fromEmails: [SARAH] });
    await sync(s, "ridge");
    const res = await hook(s.h, coldReply);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(s.claude).toEqual([]);
    expect(s.h.d.accounts.repo.inboundReviews()).toEqual([]);
    expect(s.h.d.accounts.peek("ridge")!.state.replies).toEqual([]);
    expect(s.logs.some((l) => l.includes("cold email: campaign cold-oct isn't one this server made"))).toBe(true);
    // no campaign on it, at an inbox no client sends from: the same
    expect(await (await hook(s.h, { ...coldReply, campaign_id: undefined, email_id: "em-cold-2" })).json()).toEqual({ ok: true, ignored: true });
    expect(s.claude).toEqual([]);
    // the client's own campaign is read as ever
    const camp = [...s.campaigns.keys()][0];
    expect(await (await hook(s.h, { ...coldReply, campaign_id: camp, email_account: SARAH, email_id: "em-ours", reply_text: "Yes please, come do the hedges." })).json()).toEqual({ ok: true });
    expect(s.claude).toHaveLength(1);
    expect(s.h.d.accounts.peek("ridge")!.state.replies).toHaveLength(1);
  });

  it("a stop on an inbox the client no longer sends from, with no campaign on it, is still honoured", async () => {
    const stop = { id: "em-stop-1", thread_id: "th-pat", timestamp_created: "2026-09-29T13:50:00.000Z", timestamp_email: "2026-09-29T13:49:00.000Z", subject: "Re: the hedges", from_address_email: PAT, to_address_email_list: SARAH, eaccount: SARAH, lead: PAT, campaign_id: null, i_sent: false, body: { text: "Please stop emailing me." } };
    const s = setup({ emails: [stop] });
    await client(s, "ridge", { fromEmails: [SARAH] });
    await sync(s, "ridge");
    // its inbox swapped in Settings, and its campaign moved onto the new one
    await s.h.api("PATCH", "/api/businesses/ridge", { fromEmails: [OFFICE] });
    await sync(s, "ridge");
    expect(profile(s.h, "ridge").pastInboxes).toEqual([SARAH]);
    expect(await pollReplies(s.h.d, { force: true })).toMatchObject({ processed: 1 });
    const st = s.h.d.accounts.peek("ridge")!.state;
    expect(st.replies).toEqual([expect.objectContaining({ from: PAT, intent: "stop" })]);
    expect(st.suppressions[PAT]).toBe("unsubscribed");
    expect(st.touches.filter((t) => t.status === "approved")).toEqual([]);
  });

  it("the reply check leaves cold email alone too", async () => {
    const cold = { id: "em-cold-3", thread_id: "th-cold", timestamp_created: "2026-09-29T13:30:00.000Z", timestamp_email: "2026-09-29T13:29:00.000Z", subject: "Re: your past customers", from_address_email: PAT, to_address_email_list: "jack@qa-outreach.com", eaccount: "jack@qa-outreach.com", lead: PAT, campaign_id: "cold-oct", i_sent: false, body: { text: "Sure, send me the details." } };
    const s = setup({ emails: [cold, { ...cold, id: "em-cold-4", campaign_id: null }] });
    s.h.d.llm = s.llm;
    await client(s, "ridge", { fromEmails: [SARAH] });
    expect(await pollReplies(s.h.d, { force: true })).toMatchObject({ processed: 0 });
    expect(s.claude).toEqual([]);
    expect(s.h.d.accounts.peek("ridge")!.state.replies).toEqual([]);
    expect(s.h.d.accounts.repo.inboundReviews()).toEqual([]);
    // never looked at again
    const thread = s.api.calls.filter((c) => c.query.search).length;
    s.h.setNow("2026-09-29T14:10:00Z");
    expect(await pollReplies(s.h.d, { force: true })).toMatchObject({ processed: 0 });
    expect(s.api.calls.filter((c) => c.query.search)).toHaveLength(thread);
  });

  it("an error on an inbox no client uses warns nobody; one on a client's inbox warns that client only", async () => {
    const s = setup();
    await client(s, "capital", { fromEmails: [SARAH] });
    await client(s, "dows", { name: "Dow's Tree Service", fromEmails: [OFFICE] }, [KIM]);
    await sync(s, "capital");
    await sync(s, "dows");
    const warnings = (bid: string) => s.h.d.accounts.peek(bid)!.state.events.filter((e) => e.title.startsWith("Instantly:"));
    const error = { event_type: "account_error", timestamp: "2026-09-29T15:00:00.000Z", email_account: "jack@qa-outreach.com", error: "SMTP authentication failed" };
    expect(await (await hook(s.h, error)).json()).toEqual({ ok: true, ignored: true });
    // even past the webhook's filter (a retried event), it reaches no client
    expect(await handleInbound(s.h.d, { type: "account_error", account: "jack@qa-outreach.com", detail: "SMTP authentication failed", at: "2026-09-29T15:00:00.000Z" })).toEqual({ businessIds: [] });
    expect([...warnings("capital"), ...warnings("dows")]).toEqual([]);
    await hook(s.h, { ...error, email_account: OFFICE, timestamp: "2026-09-29T15:01:00.000Z" });
    expect(warnings("dows").map((e) => e.title)).toEqual([`Instantly: ${OFFICE} has an error`]);
    expect(warnings("capital")).toEqual([]);
  });
});

describe("a lawn shop's seasons on the sending platform", () => {
  const ADDRESS = { NH: "14 Mill Rd, Concord, NH 03301", PA: "5 Market St, Harrisburg, PA 17101" };

  /**
   * A lawn shop with Pat, mowed every week from April until he stopped in July (and, when asked, Kim, whose fall
   * clean-up last October is due again, and Lee, mowed every other week until he stopped in June), planned at `now`
   * at the shop's pace: the round waits for the owner's OK.
   */
  async function lawnShop(s: Pick<Setup, "h">, state: keyof typeof ADDRESS, now: string, more: { kim?: boolean; lee?: boolean; weeklyNewContacts?: number } = {}) {
    const { h } = s;
    h.setNow(now);
    await h.business("cap", { name: "Capital City Landscaping", trade: "lawn", fromEmails: [SARAH], state, mailingAddress: ADDRESS[state] });
    // Tuesday to Thursday, as these windows were worked out for (new accounts send Monday to Friday)
    expect((await h.api("PATCH", "/api/businesses/cap", { sendDays: [2, 3, 4] })).status).toBe(200);
    if (more.weeklyNewContacts) expect((await h.api("PATCH", "/api/businesses/cap", { weeklyNewContacts: more.weeklyNewContacts })).status).toBe(200);
    const rows: string[] = [];
    for (let d = "2026-04-21"; d <= "2026-07-07"; d = addDays(d, 7)) rows.push(`701,${d},Weekly mowing,Pat Lee,${PAT},Yes,45.00,Recurring`);
    if (more.lee) for (let d = "2026-04-23"; d <= "2026-06-04"; d = addDays(d, 14)) rows.push(`703,${d},Biweekly mowing,Lee Ross,${LEE},Yes,55.00,Recurring`);
    if (more.kim) rows.push(`702,2025-10-21,Fall cleanup,Kim Ng,${KIM},Yes,180.00,One-off`);
    const text = ["Job #,Date,Visit title,Client name,Client email,Visit completed,Visit based ($),Job type", ...rows].join("\n");
    expect((await h.api("POST", "/api/businesses/cap/imports", { files: [{ name: "Visits Report.csv", text }] })).status).toBe(200);
    return (await h.api("POST", "/api/businesses/cap/plan", {})).json;
  }
  const touches = (s: Pick<Setup, "h">) => s.h.d.accounts.peek("cap")!.state.touches;
  const offSeasonAlerts = async (h: Harness) => ((await h.api("GET", "/api/review")).json.items as { kind: string; alertKind?: string; title: string; detail: string }[]).filter((x) => x.kind === "alert" && x.alertKind === "off_season_ok");
  const leads = (s: Setup) => s.api.callsTo("POST", "/leads/add").flatMap((c) => c.body.leads as { email: string; custom_variables: Record<string, string> }[]);
  const withdrawn = (s: Setup) => s.api.callsTo("POST", "/leads/list").flatMap((c) => c.body.contacts as string[]);

  it("an OK that comes after the fall window closed is told the truth: the round is written again for January, and Jack sees it", async () => {
    const s = setup();
    const { h } = s;
    expect(await lawnShop(s, "NH", "2026-11-10T15:00:00Z")).toMatchObject({ people: 1, notes: 1, firstDay: "2026-11-11", awaitingOk: true });
    h.setNow("2026-12-01T13:00:00Z");
    expect(await h.sms("OK")).toBe("Done. The season for these notes has closed, so they're written again for the next one, and the first go out Jan 5. When someone asks to come back, you'll get a text with their name and number.");
    expect((await offSeasonAlerts(h)).map((x) => [x.title, x.detail])).toEqual([
      ["Capital City Landscaping's OK came after the season closed for 1 person", "Their notes were cancelled, and the round written again for the next selling window, the first on 2027-01-05. Look it over before then."],
    ]);
    expect(touches(s).map((t) => [t.status, t.dueAt.slice(0, 10), t.lastError])).toEqual([
      ["cancelled", "2026-12-01", OFF_SEASON],
      ["approved", "2027-01-05", undefined],
      ["approved", "2027-01-12", undefined],
    ]);
    // nothing reaches the platform in December, not even the week before it opens (it would send note 1 at once)
    await sync(s, "cap");
    h.setNow("2026-12-29T15:00:00Z");
    await sync(s, "cap");
    expect(pushes(s)).toBe(0);
    h.setNow("2027-01-04T15:00:00Z");
    await sync(s, "cap");
    expect(leads(s).map((l) => Object.keys(l.custom_variables).filter((k) => /^b\d$/.test(k)))).toEqual([["b1", "b2"]]);
  });

  it("an OK Jack records in the console goes the same way: in December the round is written again for January, and he's told why", async () => {
    const s = setup();
    const { h } = s;
    await lawnShop(s, "NH", "2026-11-10T15:00:00Z");
    h.setNow("2026-12-01T13:00:00Z");
    expect((await h.api("POST", "/api/businesses/cap/approve")).json).toEqual({ approved: 2, late: { people: 1, firstDay: "2027-01-05" } });
    expect(touches(s).map((t) => [t.status, t.dueAt.slice(0, 10), t.lastError])).toEqual([
      ["cancelled", "2026-12-01", OFF_SEASON],
      ["approved", "2027-01-05", undefined],
      ["approved", "2027-01-12", undefined],
    ]);
    expect((await offSeasonAlerts(h)).map((x) => x.title)).toEqual(["Capital City Landscaping's OK came after the season closed for 1 person"]);
    expect(h.d.accounts.peek("cap")!.state.awaitingOwnerOk).toBeUndefined();
  });

  it("an OK that leaves part of the round past the window tells the owner how many wait, and Jack sees it", async () => {
    // two new people a day: planned for November 3rd and 4th, OK'd on Thursday the 12th, the second day's would go the 17th
    const s = setup();
    const { h } = s;
    expect(await lawnShop(s, "NH", "2026-11-02T15:00:00Z", { kim: true, lee: true, weeklyNewContacts: 5 })).toMatchObject({ people: 3, firstDay: "2026-11-03" });
    const email = (t: { customerId: string }) => h.d.accounts.peek("cap")!.state.dataset.customers.find((c) => c.id === t.customerId)!.emails[0];
    const firsts = () => touches(s).filter((t) => t.step === 1).map((t) => [email(t), t.dueAt.slice(0, 10), t.status]);
    expect(firsts()).toEqual([
      [KIM, "2026-11-03", "planned"],
      [PAT, "2026-11-03", "planned"],
      [LEE, "2026-11-04", "planned"],
    ]);
    h.setNow("2026-11-12T13:00:00Z");
    expect(await h.sms("OK")).toBe(
      "Done — the first notes go out Nov 12. The season closes before 1 more person could hear from you, so theirs are written again for the next one, and go out from Jan 5. When someone asks to come back, you'll get a text with their name and number.",
    );
    expect(firsts()).toEqual([
      [KIM, "2026-11-12", "approved"],
      [PAT, "2026-11-12", "approved"],
      [LEE, "2026-11-17", "cancelled"],
      [LEE, "2027-01-05", "approved"],
    ]);
    expect((await offSeasonAlerts(h)).map((x) => x.title)).toEqual(["Capital City Landscaping's OK came after the season closed for 1 person"]);
  });

  it("a pause from November to January takes the fall follow-ups back from the platform before it restarts", async () => {
    const s = setup();
    const { h } = s;
    expect(await lawnShop(s, "NH", "2026-11-02T15:00:00Z")).toMatchObject({ people: 1, notes: 2, firstDay: "2026-11-03" });
    await h.sms("OK");
    await sync(s, "cap");
    expect(leads(s).map((l) => l.custom_variables.b2)).toEqual([expect.stringMatching(/we're putting the fall clean-up schedule together now/)]);
    // the platform sends note 1 on the 3rd, then the owner pauses until January, when the spring window is open
    const n1 = touches(s)[0]!;
    await hook(h, { event_type: "email_sent", timestamp: "2026-11-03T14:30:00.000Z", campaign_id: n1.providerId!.split(":")[1], lead_email: PAT, step: 1, email_id: "em-1", qa_touch_1: n1.id });
    await h.sms("PAUSE");
    h.setNow("2027-01-05T15:00:00Z");
    await h.sms("RESUME");
    const calls = s.api.calls.map((c) => `${c.method} ${c.path}`);
    expect(calls.indexOf("POST /leads/list")).toBeLessThan(calls.lastIndexOf("POST /campaigns/camp-1/activate"));
    expect(withdrawn(s)).toEqual([PAT]);
    expect(touches(s).map((t) => [t.step, t.status, t.lastError])).toEqual([
      [1, "sent", undefined],
      [2, "cancelled", OFF_SEASON],
    ]);
  });

  it.each([
    ["the fall follow-up, paused from November into the spring window", "2026-11-02T15:00:00Z", "2026-11-03T14:59:00Z", "2027-01-05T14:59:00Z"],
    ["the spring follow-up, paused from March into the fall window", "2027-03-22T14:00:00Z", "2027-03-23T13:59:00Z", "2027-09-01T13:59:00Z"],
  ])("sent directly, %s never goes", async (_, planned, sent, back) => {
    const h = harness();
    open.push(h);
    expect(await lawnShop({ h }, "NH", planned)).toMatchObject({ people: 1, notes: 2 });
    await h.sms("OK");
    h.setNow(sent);
    expect((await sendDue(h.d, "cap")).sent).toBe(1);
    await h.sms("PAUSE");
    h.setNow(back);
    await h.sms("RESUME");
    expect((await sendDue(h.d, "cap")).sent).toBe(0);
    expect(touches({ h }).map((t) => [t.step, t.status, t.lastError])).toEqual([
      [1, "sent", undefined],
      [2, "cancelled", OFF_SEASON],
    ]);
  });

  it("a late OK hands over only the notes still inside the window: note 2 past it is cancelled, in Pennsylvania and in the north", async () => {
    for (const [state, planned, ok, kept, cut] of [
      ["PA", "2026-11-17T15:00:00Z", "2026-11-25T13:00:00Z", "2026-11-25", "2026-12-01"],
      ["NH", "2026-11-03T15:00:00Z", "2026-11-12T13:00:00Z", "2026-11-12", "2026-11-18"],
    ] as const) {
      const s = setup();
      const { h } = s;
      expect(await lawnShop(s, state, planned)).toMatchObject({ people: 1, notes: 2 });
      h.setNow(ok);
      await h.sms("OK");
      await sync(s, "cap");
      expect(leads(s).map((l) => [l.email, l.custom_variables.b1 !== undefined, l.custom_variables.b2])).toEqual([[PAT, true, undefined]]);
      expect(s.api.callsTo("POST", "/campaigns").map((c) => c.body.sequences[0].steps.length)).toEqual([1]);
      expect(touches(s).map((t) => [t.step, t.dueAt.slice(0, 10), t.status, t.lastError])).toEqual([
        [1, kept, "approved", undefined],
        [2, cut, "cancelled", OFF_SEASON],
      ]);
    }
  });

  it("notes held past their day are judged by when the platform would send them: note 2 four days after note 1", async () => {
    const s = setup();
    const { h } = s;
    // planned Tuesday the 17th for the 18th and 24th, OK'd at once, then paused before anything went
    expect(await lawnShop(s, "PA", "2026-11-17T15:00:00Z")).toMatchObject({ people: 1, notes: 2 });
    await h.sms("OK");
    await h.sms("PAUSE");
    // back on Friday the 27th: note 1 goes now, so the platform would send note 2 on December 1st
    h.setNow("2026-11-27T15:00:00Z");
    await h.sms("RESUME");
    await sync(s, "cap");
    expect(leads(s).map((l) => l.custom_variables.b2)).toEqual([undefined]);
    expect(touches(s).map((t) => [t.step, t.status, t.lastError])).toEqual([
      [1, "approved", undefined],
      [2, "cancelled", OFF_SEASON],
    ]);
  });

  it("after a pause that outlasted the window, nothing is handed over, the clean-up a rescan dropped included", async () => {
    const s = setup();
    const { h } = s;
    expect(await lawnShop(s, "NH", "2026-11-10T15:00:00Z", { kim: true })).toMatchObject({ people: 2, firstDay: "2026-11-11" });
    await h.sms("OK");
    await h.sms("PAUSE");
    h.setNow("2026-12-01T08:00:00Z"); // 3am New York: the nightly rescan
    await rescan(h.d, "cap");
    expect(h.d.accounts.peek("cap")!.state.scan!.opportunities.map((o) => o.type)).toEqual(["lapsed_regular"]);
    h.setNow("2026-12-01T15:00:00Z");
    await h.sms("RESUME");
    await sync(s, "cap");
    expect(pushes(s)).toBe(0);
    expect(touches(s).map((t) => [t.status, t.lastError])).toEqual(touches(s).map(() => ["cancelled", OFF_SEASON]));
  });

  it("notes the platform already holds are taken back once the window's over: on a resume, before the campaigns restart, or on the next sync", async () => {
    for (const resume of [true, false]) {
      const s = setup();
      const { h } = s;
      await lawnShop(s, "PA", "2026-11-17T15:00:00Z");
      await h.sms("OK");
      await sync(s, "cap");
      expect(leads(s).map((l) => l.custom_variables.b2 !== undefined)).toEqual([true]);
      if (resume) await h.sms("PAUSE");
      h.setNow("2026-12-02T15:00:00Z");
      if (resume) {
        await h.sms("RESUME");
        const calls = s.api.calls.map((c) => `${c.method} ${c.path}`);
        expect(calls.indexOf("POST /leads/list")).toBeLessThan(calls.lastIndexOf("POST /campaigns/camp-1/activate"));
      } else await sync(s, "cap");
      expect(withdrawn(s)).toEqual([PAT]);
      expect(touches(s).map((t) => [t.status, t.lastError])).toEqual([
        ["cancelled", OFF_SEASON],
        ["cancelled", OFF_SEASON],
      ]);
    }
  });

  it("in its season, records over two weeks old hold the nightly top-up, and Jack is asked once for a fresh export", async () => {
    const s = setup();
    const { h } = s;
    h.setNow("2026-09-08T15:00:00Z");
    await h.business("cap", { name: "Capital City Landscaping", trade: "lawn", fromEmails: [SARAH], state: "NH", mailingAddress: ADDRESS.NH });
    expect((await h.api("PATCH", "/api/businesses/cap", { plan: { stage: "paying", paidOn: "2026-09-01" } })).status).toBe(200);
    /** The Visits report as exported on `on`: Pat, mowed every week from April until he stopped in July. */
    const exportOn = async (on: string) => {
      h.setNow(`${on}T15:00:00Z`);
      const rows: string[] = [];
      for (let d = "2026-04-21"; d <= "2026-07-07"; d = addDays(d, 7)) rows.push(`701,${d},Weekly mowing,Pat Lee,${PAT},Yes,45.00,Recurring`);
      const text = ["Job #,Date,Visit title,Client name,Client email,Visit completed,Visit based ($),Job type", ...rows].join("\n");
      expect((await h.api("POST", "/api/businesses/cap/imports", { files: [{ name: "Visits Report.csv", text }] })).status).toBe(200);
    };
    const wrote = () => h.d.accounts.peek("cap")!.state.events.filter((e) => e.agent === "writer" && e.title.startsWith("Wrote")).length;
    const stale = async () => ((await h.api("GET", "/api/review")).json.items as { kind: string; alertKind?: string; title: string; detail: string }[]).filter((x) => x.kind === "alert" && x.alertKind === "stale_records");
    /** The worker's night (3:10am in New Hampshire) on `on`: whether it planned. */
    const night = async (on: string) => {
      const before = wrote();
      h.setNow(`${on}T07:10:00Z`);
      expect((await tick(h.d)).errors).toEqual([]);
      return wrote() > before;
    };
    await exportOn("2026-09-08");
    expect(await night("2026-09-09")).toBe(true);
    expect(touches(s).filter((t) => t.step === 1)).toHaveLength(1);
    expect(await night("2026-09-22")).toBe(true);
    // fifteen days on, nothing new is planned from them, and Jack is asked, once
    expect(await night("2026-09-23")).toBe(false);
    expect(await night("2026-09-24")).toBe(false);
    expect((await stale()).map((x) => [x.title, x.detail])).toEqual([
      ["Capital City Landscaping's records are 15 days old", "The newest is from 2026-09-08, so who stopped since can't be told from them, and nothing new is planned. Ask for a fresh Visits report (or invoices)."],
    ]);
    await exportOn("2026-09-24");
    expect(await night("2026-09-25")).toBe(true);
    // after the season, the records are as old as the season's end: nothing to ask for
    expect(await night("2026-11-20")).toBe(true);
  }, 30_000);

  it("a note 1 taken back from the platform may have gone (its “sent” never came back): nobody plans him a second first note", async () => {
    const s = setup();
    const { h } = s;
    await lawnShop(s, "PA", "2026-11-17T15:00:00Z");
    await h.sms("OK");
    await sync(s, "cap");
    expect(pushes(s)).toBe(1);
    // the platform sends note 1 the next morning, but its webhook never comes: by December it's still waiting, as far as we know
    h.setNow("2026-12-02T15:00:00Z");
    await sync(s, "cap");
    expect(touches(s).map((t) => [t.step, t.status, t.lastError])).toEqual([
      [1, "cancelled", OFF_SEASON],
      [2, "cancelled", OFF_SEASON],
    ]);
    // the spring window: the free round's top-up, and Jack's plan, leave him be
    h.setNow("2027-01-05T13:00:00Z");
    expect((await h.api("POST", "/api/businesses/cap/plan", {})).json).toMatchObject({ people: 0, notes: 0 });
    expect(touches(s)).toHaveLength(2);
  });
});
