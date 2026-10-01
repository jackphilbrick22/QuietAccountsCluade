import { afterEach, describe, expect, it } from "vitest";
import { generateSample, weekday } from "@qa/engine";
import { loadConfig, signupOrigins } from "../src/config.ts";
import { harness, SECRET, WH, type Harness } from "./harness.ts";

/**
 * BRIEF A6: new accounts send Monday to Friday mornings; the console edits a client's trade and time zone; a sign-up's
 * time zone is guessed from the cell's area code; a server sending for real won't take sign-ups from any origin; and
 * the owner's texts count who asked to come back.
 */

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

const profile = (h: Harness, bid: string) => h.d.accounts.peek(bid)!.state.dataset.business;
const signup = (h: Harness, cell: string, company = "Capital City Landscaping") =>
  h.app.request("/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company, first: "Tom", cell, trade: "lawn", consent: true }) });

describe("send days", () => {
  it("a new account sends Monday to Friday, 7 to 10 in the morning, from the console or the site", async () => {
    const h = make();
    await h.business("ridge");
    expect(profile(h, "ridge")).toMatchObject({ sendDays: [1, 2, 3, 4, 5], sendWindow: [7, 10] });
    const r = await signup(h, "(603) 555-0177");
    const id = ((await r.json()) as { id: string }).id;
    expect(profile(h, id)).toMatchObject({ sendDays: [1, 2, 3, 4, 5], sendWindow: [7, 10] });
  });

  it("its first round is planned on weekdays only, Mondays and Fridays too", { timeout: 60_000 }, async () => {
    const h = make();
    await h.business("ridge");
    const sample = generateSample({ trade: "tree", asOf: "2026-09-29" });
    expect((await h.api("POST", "/api/businesses/ridge/imports", { files: sample.files.map((f) => ({ name: f.name, text: f.text, kind: f.kind })) })).status).toBe(200);
    expect((await h.api("POST", "/api/businesses/ridge/plan", {})).json.people).toBe(150);
    const days = new Set(h.d.accounts.peek("ridge")!.state.touches.map((t) => weekday(t.dueAt.slice(0, 10))));
    expect([...days].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("an existing account keeps the days it has", async () => {
    const h = make();
    await h.business("ridge");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.business.sendDays = [2, 3, 4];
    });
    const again = h.restart();
    open.push(again);
    expect(profile(again, "ridge").sendDays).toEqual([2, 3, 4]);
  });
});

describe("Settings: trade and time zone", () => {
  it("saves a new trade and time zone, and a save of anything else leaves them (and who signs) as they are", async () => {
    const h = make();
    await h.business("ridge", { signerRole: "owner", timezone: "America/Chicago" });
    expect((await h.api("PATCH", "/api/businesses/ridge", { name: "Ridgeline Tree Service" })).status).toBe(200);
    expect(profile(h, "ridge")).toMatchObject({ name: "Ridgeline Tree Service", trade: "tree", timezone: "America/Chicago", signerRole: "owner" });
    expect((await h.api("PATCH", "/api/businesses/ridge", { trade: "painting", timezone: "America/Denver" })).status).toBe(200);
    expect(profile(h, "ridge")).toMatchObject({ trade: "painting", timezone: "America/Denver", signerRole: "owner" });
    expect((await h.api("GET", "/api/businesses/ridge")).json.business).toMatchObject({ trade: "painting", timezone: "America/Denver" });
    // nothing imported yet, so there's no list to read again
    expect(h.d.accounts.peek("ridge")!.state.scan).toBeUndefined();
  });

  it("refuses a time zone the server doesn't know, on a new client or a change", async () => {
    const h = make();
    await h.business("ridge");
    const bad = await h.api("PATCH", "/api/businesses/ridge", { timezone: "Eastern" });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.json)).toContain("Not a time zone");
    expect(profile(h, "ridge").timezone).toBe("America/New_York");
    expect((await h.api("POST", "/api/businesses", { name: "Oak & Sons", ownerName: "Al", signerName: "Al", mailingAddress: "1 Main St, Concord, NH 03301", timezone: "Mars/Olympus_Mons" })).status).toBe(400);
  });

  it("a new trade reads the list again right away; other changes don't", { timeout: 60_000 }, async () => {
    const h = make();
    await h.business("ridge");
    const sample = generateSample({ trade: "tree", asOf: "2026-09-29" });
    await h.api("POST", "/api/businesses/ridge/imports", { files: sample.files.map((f) => ({ name: f.name, text: f.text, kind: f.kind })) });
    const scanned = () => h.d.accounts.repo.listBusinesses().find((b) => b.id === "ridge")!.scannedAt;
    const fenceWork = () => h.d.accounts.peek("ridge")!.state.scan!.opportunities.some((o) => o.serviceId.startsWith("fence."));
    expect(fenceWork()).toBe(false);
    h.setNow("2026-09-29T15:00:00Z");
    await h.api("PATCH", "/api/businesses/ridge", { trade: "tree", name: "Ridgeline" });
    expect(scanned()).not.toBe("2026-09-29T15:00:00.000Z");
    await h.api("PATCH", "/api/businesses/ridge", { trade: "fence" });
    expect(scanned()).toBe("2026-09-29T15:00:00.000Z");
    expect(fenceWork()).toBe(true);
  });
});

describe("a sign-up's time zone", () => {
  const alert = (h: Harness, id: string) => h.d.accounts.repo.openAlerts(id).find((a) => a.kind === "signup")!.detail!;

  it("is guessed from the cell's area code, and the alert says so for the operator to check", async () => {
    const h = make();
    const r = await signup(h, "(312) 555-0142", "Lakeshore Lawn");
    const { id } = (await r.json()) as { id: string };
    expect(profile(h, id).timezone).toBe("America/Chicago");
    expect(alert(h, id)).toContain("Next: check the time zone (Central, guessed from the 312 area code), add their mailing address,");
    const west = (await (await signup(h, "(206) 555-0142", "Emerald Lawn")).json()) as { id: string };
    expect(profile(h, west.id).timezone).toBe("America/Los_Angeles");
  });

  it("is Eastern when the area code isn't one we know, and the alert says that too", async () => {
    const h = make();
    const { id } = (await (await signup(h, "(867) 555-0123", "Yukon Yards")).json()) as { id: string };
    expect(profile(h, id).timezone).toBe("America/New_York");
    expect(alert(h, id)).toContain("Next: check the time zone (Eastern, as we don't know that area code), add their mailing address,");
  });

  it("a second Start for the same account changes nothing about it", async () => {
    const h = make();
    const { id } = (await (await signup(h, "(312) 555-0142", "Lakeshore Lawn")).json()) as { id: string };
    await h.api("PATCH", `/api/businesses/${id}`, { timezone: "America/New_York" });
    await signup(h, "(312) 555-0142", "Lakeshore Lawn");
    expect(profile(h, id).timezone).toBe("America/New_York");
  });
});

describe("sign-up origins", () => {
  const live = { OPERATOR_TOKEN: "live-operator-token-789", APP_SECRET: SECRET, WEBHOOK_SECRET: WH, PUBLIC_URL: "https://app.quietaccounts.com", EMAIL_PROVIDER: "instantly", INSTANTLY_API_KEY: "k" };

  it("sending for real, the server won't start taking sign-ups from any origin", () => {
    expect(() => loadConfig(live)).toThrow(/SIGNUPS=on needs SIGNUP_ORIGINS/);
    expect(() => loadConfig({ ...live, EMAIL_PROVIDER: "log", SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+16035550100" })).toThrow(/SIGNUP_ORIGINS/);
    expect(loadConfig({ ...live, SIGNUP_ORIGINS: "https://quietaccounts.com" }).SIGNUP_ORIGINS).toBe("https://quietaccounts.com");
    expect(loadConfig({ ...live, SIGNUPS: "off" }).SIGNUPS).toBe("off");
  });

  it("a list of only commas is no list, read the same way as the CORS rule it guards", async () => {
    for (const SIGNUP_ORIGINS of [",", " , ", " ,, "]) expect(() => loadConfig({ ...live, SIGNUP_ORIGINS })).toThrow(/SIGNUPS=on needs SIGNUP_ORIGINS/);
    expect(signupOrigins(loadConfig({ ...live, SIGNUP_ORIGINS: " https://quietaccounts.com, ," }))).toEqual(["https://quietaccounts.com"]);
    const h = make({ env: { SIGNUP_ORIGINS: " https://quietaccounts.com, ," } });
    const ask = (origin: string) => h.app.request("/start", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } });
    expect((await ask("https://quietaccounts.com")).headers.get("access-control-allow-origin")).toBe("https://quietaccounts.com");
    expect((await ask("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("a dev server or a test still takes them from anywhere", async () => {
    expect(loadConfig({}).SIGNUP_ORIGINS).toBe("");
    expect(loadConfig({ ...live, EMAIL_PROVIDER: "log" }).SIGNUPS).toBe("on");
    const h = make();
    const r = await h.app.request("/start", { method: "OPTIONS", headers: { origin: "http://localhost:5174", "access-control-request-method": "POST" } });
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("the owner's texts count who asked to come back", () => {
  it("the OK and STATUS replies say 'asked to come back', or 'wanted the work' on a one pass", async () => {
    const h = make();
    await h.business("ridge");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.awaitingOwnerOk = "2026-09-29T09:00:00";
    });
    expect(await h.sms("OK")).toContain("When someone asks to come back, you'll get a text with their name and number.");
    expect(await h.sms("status")).toBe("So far: 0 notes out, 0 asked to come back, $0 booked.");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.business.plan.kind = "one_pass";
    });
    expect(await h.sms("status")).toBe("So far: 0 notes out, 0 wanted the work, $0 booked.");
  });
});
