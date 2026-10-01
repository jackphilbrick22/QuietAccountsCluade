import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSample, leadCode } from "@qa/engine";
import { loadConfig } from "../src/config.ts";
import { buildDeps } from "../src/main.ts";
import { deliverOwnerMessages, sendDue } from "../src/core/ops.ts";
import type { TextToSend } from "../src/core/textsToSend.ts";
import { LogEmailProvider } from "../src/providers/email.ts";
import { ManualNotifier } from "../src/providers/sms.ts";
import { handoffToast, ourAnswerLabel, ownerSendToast, type HandoffResult } from "../../web/src/live/ownerSend.ts";
import { addLead, harness, PHONE, SECRET, TOKEN, WH, type Harness } from "./harness.ts";

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

/** A server with owner texts by hand, as production runs until Twilio clears. */
const manual = () => make({ notifier: new ManualNotifier() });
const list = async (h: Harness) => (await h.api("GET", "/api/texts-to-send")).json as TextToSend[];
const paste = (h: Harness, bid: string, text: string) => h.api("POST", `/api/businesses/${bid}/owner-texts`, { text });
const markSent = (h: Harness, bid: string, mid: string) => h.api("POST", `/api/businesses/${bid}/owner-messages/${mid}/sent`);
const approved = async (h: Harness, bid: string) => ((await h.api("GET", `/api/businesses/${bid}/touches?status=approved&limit=5000`)).json.items as unknown[]).length;
const stateOf = (h: Harness, bid: string) => h.d.accounts.peek(bid)!.state;

/** A tree shop with a year of quotes read and the free round planned: the welcome text waits for the owner's OK. */
async function planned(h: Harness, bid = "ridge"): Promise<void> {
  await h.business(bid);
  const sample = generateSample({ trade: "tree", asOf: "2026-09-29", months: 12, quotesPerMonth: 25 });
  expect((await h.api("POST", `/api/businesses/${bid}/imports`, { files: sample.files.map((f) => ({ name: f.name, text: f.text, kind: f.kind })) })).status).toBe(200);
  expect((await h.api("POST", `/api/businesses/${bid}/plan`, {})).json.awaitingOk).toBe(true);
  await deliverOwnerMessages(h.d);
}

describe("SMS_PROVIDER=manual (A5)", () => {
  const prod = { OPERATOR_TOKEN: TOKEN, APP_SECRET: SECRET, WEBHOOK_SECRET: WH, PUBLIC_URL: "https://qa.test" };
  const twilio = { SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+16035550100" };

  it("is the production default until Twilio clears; dev keeps the log, and a set provider is kept", () => {
    expect(loadConfig(prod).SMS_PROVIDER).toBe("manual");
    expect(loadConfig({}).SMS_PROVIDER).toBe("log");
    expect(loadConfig({ ...prod, SMS_PROVIDER: "log" }).SMS_PROVIDER).toBe("log");
    expect(loadConfig({ ...prod, ...twilio }).SMS_PROVIDER).toBe("twilio");
    // nothing is texted from the server by hand, so it doesn't need production secrets; Twilio still does
    expect(loadConfig({ SMS_PROVIDER: "manual" }).SMS_PROVIDER).toBe("manual");
    expect(() => loadConfig(twilio)).toThrow(/development secrets/);
    expect(() => loadConfig({ ...prod, SMS_PROVIDER: "carrier-pigeon" })).toThrow(/SMS_PROVIDER/);
  });

  it("the server texts owners by hand in production, by Twilio once it's set", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-manual-"));
    try {
      for (const [env, name] of [[prod, "manual"], [{ ...prod, ...twilio }, "twilio"]] as const) {
        const deps = buildDeps({ ...env, DATABASE_PATH: join(dir, `${name}.db`), MAIL_CHECK: "off" });
        expect(deps.notifier.name).toBe(name);
        deps.accounts.repo.db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the health check says owner texts go by hand", async () => {
    expect((await manual().api("GET", "/api/health")).json.sms).toBe("manual");
  });
});

describe("Texts to send and Paste their reply (A5)", () => {
  it("the welcome text waits on the list, pasting OK starts the first round exactly as a texted OK does", async () => {
    const h = manual();
    await planned(h);
    const [welcome, ...rest] = await list(h);
    expect(rest).toEqual([]);
    expect(welcome).toMatchObject({ businessId: "ridge", businessName: "Ridgeline Tree Co.", ownerFirstName: "Dave", phone: PHONE, kind: "kickoff" });
    expect(welcome!.text).toContain("Reply OK and the first");
    // on the list is not sent: it waits for Jack, and no note goes before the owner's OK
    expect(((await h.api("GET", "/api/businesses/ridge/owner-messages")).json as { id: string; delivery: string }[]).find((m) => m.id === welcome!.messageId)!.delivery).toBe("manual");
    expect(await approved(h, "ridge")).toBe(0);
    expect(stateOf(h, "ridge").awaitingOwnerOk).toBeTruthy();

    // Jack texts it from his phone and marks it sent: it leaves the list, sent by hand at that moment
    h.setNow("2026-09-29T14:05:00Z");
    expect((await markSent(h, "ridge", welcome!.messageId)).json).toEqual({ ok: true });
    expect(await list(h)).toEqual([]);
    expect(((await h.api("GET", "/api/businesses/ridge/owner-messages?delivery=sent")).json as { id: string; channel: string; delivered_at: string }[])[0]).toMatchObject({ id: welcome!.messageId, channel: "manual", delivered_at: "2026-09-29T14:05:00.000Z" });
    expect((await markSent(h, "ridge", welcome!.messageId)).status).toBe(409);

    // the owner texts OK back to Jack's phone; Jack pastes it
    const ok = await paste(h, "ridge", "OK");
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ businessId: "ridge", queued: true });
    expect(ok.json.reply).toContain("the first notes go out");
    expect(stateOf(h, "ridge").awaitingOwnerOk).toBeFalsy();
    const started = await approved(h, "ridge");
    expect(started).toBeGreaterThan(0);
    // the answer is on the list, to text back
    expect(await list(h)).toMatchObject([{ businessId: "ridge", phone: PHONE, kind: "reply", text: ok.json.reply }]);
    // logged as their text, like one that came to our number
    expect((await h.api("GET", "/api/businesses/ridge/owner-texts")).json).toMatchObject([{ from_phone: PHONE, body: "OK", reply: ok.json.reply }]);

    // the same OK texted to our number does exactly the same
    const twin = make();
    await planned(twin);
    expect(await twin.sms("OK")).toBe(ok.json.reply);
    expect(await approved(twin, "ridge")).toBe(started);
  });

  it("a homeowner's yes: the hand-off lands on the list, and pasting BOOKED with its code records the booking", async () => {
    const h = manual();
    await planned(h);
    await paste(h, "ridge", "OK");
    h.setNow("2026-09-30T13:30:00Z"); // Wed 9:30 New York, inside the send window
    await sendDue(h.d, "ridge");
    const note = (h.d.email as LogEmailProvider).sent[0]!;
    const res = await h.app.request(`/webhooks/inbound-email/${WH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ MessageID: "m-yes-1", From: note.to, To: "sarah@ridgeline-mail.com", Subject: `Re: ${note.subject}`, TextBody: "Yes please, still need it done. Call me after 5.", Date: "2026-09-30T14:10:00Z" }),
    });
    expect(res.status).toBe(200);
    h.setNow("2026-09-30T18:00:00Z");
    const handoff = (await list(h)).find((t) => t.kind === "handoff")!;
    expect(handoff).toMatchObject({ businessId: "ridge", ownerFirstName: "Dave", phone: PHONE });
    expect(handoff.text).toMatch(/NEW/);
    const code = handoff.text.match(/#([A-Z0-9]{3})\b/)![1]!;
    const lead = stateOf(h, "ridge").replies.find((r) => leadCode(r.id) === code)!;
    expect(lead.status).toBe("handed_off");

    const booked = await paste(h, "ridge", `BOOKED 2400 #${code}`);
    expect(booked.json).toMatchObject({ handled: "booked", queued: true });
    expect(booked.json.reply).toMatch(/^Booked: .+, \$2,400/);
    expect(stateOf(h, "ridge").replies.find((r) => r.id === lead.id)).toMatchObject({ outcome: "booked", outcomeValue: 2400 });
    expect(stateOf(h, "ridge").recoveries.map((r) => r.value)).toEqual([2400]);
    // newest first: the answer, then the hand-off it was about
    const after = await list(h);
    expect(after[0]).toMatchObject({ kind: "reply", text: booked.json.reply });
    expect(after.map((t) => t.messageId)).toContain(handoff.messageId);
  });

  it("a money text reaches the list only after Jack approves it", async () => {
    const h = manual();
    await h.business("ridge");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.ownerMessages.push({ id: "om-pre", at: "2026-09-29T09:00:00", kind: "precharge", text: "Dave, your card is charged on the 1st." });
    });
    await deliverOwnerMessages(h.d);
    expect(await list(h)).toEqual([]);
    expect(((await h.api("GET", "/api/review")).json.items as { kind: string; messageId?: string }[]).filter((i) => i.kind === "owner_message").map((i) => i.messageId)).toEqual(["om-pre"]);
    const r = await h.api("POST", "/api/businesses/ridge/owner-messages/om-pre/send");
    expect(r.json).toEqual({ ok: true, delivery: "manual" });
    expect(ownerSendToast(r.json)).toBe("Approved: it's on Texts to send for you to text them");
    expect(await list(h)).toMatchObject([{ messageId: "om-pre", kind: "precharge", text: "Dave, your card is charged on the 1st." }]);
    expect(((await h.api("GET", "/api/review")).json.items as { kind: string }[]).some((i) => i.kind === "owner_message")).toBe(false);
  });

  it("restoring a cancelled yearly plan takes its refund text off the list", async () => {
    const h = make({ notifier: new ManualNotifier(), env: { FEATURE_YEARLY: "on" } });
    await h.business("ridge");
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "paying", billing: "annual", paidOn: "2025-10-20", yearsPaidOn: ["2025-10-20"] } })).status).toBe(200);
    expect((await paste(h, "ridge", "CANCEL")).json.reply).toMatch(/comes back to your card/);
    const refund = ((await h.api("GET", "/api/businesses/ridge/owner-messages?delivery=review")).json as { id: string; kind: string }[]).find((m) => m.kind === "refund")!;
    expect((await h.api("POST", `/api/businesses/ridge/owner-messages/${refund.id}/send`)).json).toMatchObject({ ok: true, delivery: "manual" });
    expect((await list(h)).map((t) => t.kind)).toContain("refund");
    expect((await h.api("POST", "/api/businesses/ridge/restore-plan")).status).toBe(200);
    expect((await list(h)).map((t) => t.kind)).not.toContain("refund");
    expect(((await h.api("GET", "/api/businesses/ridge/owner-messages?delivery=cancelled")).json as { id: string }[]).map((m) => m.id)).toEqual([refund.id]);
  });

  it("a pasted text from a client with no cell on file is refused, with the reason", async () => {
    const h = manual();
    await h.business("nocell", { ownerPhone: undefined });
    const r = await paste(h, "nocell", "OK");
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("There's no cell on file for Dave, so their text can't be read as theirs. Add their cell in Settings first.");
    expect((await h.api("GET", "/api/businesses/nocell/owner-texts")).json).toEqual([]);
    expect(await list(h)).toEqual([]);
    expect((await paste(h, "nobody", "OK")).status).toBe(404);
    expect((await paste(h, "nocell", "   ")).status).toBe(400);
  });

  it("PAUSE and CANCEL work pasted; after CANCEL only its answer is left to text them", async () => {
    const h = manual();
    await h.business("ridge");
    // a hand-off, and a pre-charge Jack approved, wait on the list
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T09:30:00");
    expect((await h.api("POST", "/api/businesses/ridge/replies/r1/handoff")).json).toMatchObject({ delivery: "manual" });
    await h.d.accounts.withAccount("ridge", (s) => {
      s.ownerMessages.push({ id: "om-pre", at: "2026-09-29T09:00:00", kind: "precharge", text: "Dave, your card is charged on the 1st." });
    });
    await deliverOwnerMessages(h.d);
    expect((await h.api("POST", "/api/businesses/ridge/owner-messages/om-pre/send")).json).toEqual({ ok: true, delivery: "manual" });
    const pause = await paste(h, "ridge", "PAUSE");
    expect(pause.json).toMatchObject({ handled: "pause", queued: true });
    expect(h.d.accounts.peek("ridge")!.paused).toBe(true);
    expect((await list(h)).map((t) => t.kind).sort()).toEqual(["handoff", "precharge", "reply"]);

    h.setNow("2026-09-29T14:10:00Z");
    const cancel = await paste(h, "ridge", "CANCEL");
    expect(cancel.json).toMatchObject({ handled: "cancel", queued: true });
    expect(cancel.json.reply).toContain("No more notes, no more charges.");
    expect(stateOf(h, "ridge").dataset.business.plan.stage).toBe("cancelled");
    // no charge notice after "no more charges": what waited goes no further, as with Twilio
    await deliverOwnerMessages(h.d);
    expect((await list(h)).map((t) => [t.kind, t.text])).toEqual([["reply", cancel.json.reply]]);
    expect(h.d.accounts.repo.ownerMessageDelivery("ridge", "om-pre")).toEqual({ delivery: "skipped", channel: null, error: "Cancelled: nothing more goes to the owner." });
    expect(((await h.api("GET", "/api/businesses/ridge/owner-messages?delivery=skipped")).json as { kind: string }[]).map((m) => m.kind).sort()).toEqual(["handoff", "precharge", "reply"]);
  });

  it("set to Cancelled in the console, what waits for them leaves the list, except a refund we owe them", async () => {
    const h = manual();
    await h.business("ridge");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.ownerMessages.push(
        { id: "om-week", at: "2026-09-29T08:00:00", kind: "weekly", text: "Dave, this week: 3 replies, 1 booked." },
        { id: "om-refund", at: "2026-09-29T08:30:00", kind: "refund", text: "Dave, $300 is back on your card." },
      );
    });
    await deliverOwnerMessages(h.d);
    expect((await h.api("POST", "/api/businesses/ridge/owner-messages/om-refund/send")).json).toEqual({ ok: true, delivery: "manual" });
    expect((await list(h)).map((t) => t.messageId)).toEqual(["om-refund", "om-week"]);
    expect((await h.api("PATCH", "/api/businesses/ridge", { plan: { stage: "cancelled" } })).status).toBe(200);
    expect((await list(h)).map((t) => t.messageId)).toEqual(["om-refund"]);
    expect(h.d.accounts.repo.ownerMessageDelivery("ridge", "om-week")).toMatchObject({ delivery: "skipped", error: "Cancelled: nothing more goes to the owner." });
    // Jack still texts the refund and marks it sent
    expect((await markSent(h, "ridge", "om-refund")).json).toEqual({ ok: true });
    expect(await list(h)).toEqual([]);
  });

  it("STOP wins: what waits for them leaves the list, and only the answer to the STOP goes back until START", async () => {
    const h = manual();
    await h.business("ridge", { ownerEmail: undefined });
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T09:30:00");
    expect((await h.api("POST", "/api/businesses/ridge/replies/r1/handoff")).status).toBe(200);
    expect((await list(h)).map((t) => t.kind)).toEqual(["handoff"]);

    const stop = await paste(h, "ridge", "STOP");
    expect(stop.json).toMatchObject({ handled: "texts_off", queued: true });
    expect((await list(h)).map((t) => [t.kind, t.text])).toEqual([["reply", stop.json.reply]]);
    // the hand-off goes the way any text to them goes now: no email on file, so to Jack's review queue
    await deliverOwnerMessages(h.d);
    expect(((await h.api("GET", "/api/review")).json.items as { kind: string; messageKind?: string }[]).find((i) => i.kind === "owner_message")).toMatchObject({ messageKind: "handoff" });

    const booked = await paste(h, "ridge", `BOOKED 2400 #${leadCode("r1")}`);
    expect(booked.json).toMatchObject({ handled: "booked", queued: false, why: "They texted STOP, so nothing goes to their phone until they text START." });
    expect(stateOf(h, "ridge").recoveries.map((r) => r.value)).toEqual([2400]);
    expect(await list(h)).toHaveLength(1);

    h.setNow("2026-09-29T14:10:00Z");
    const start = await paste(h, "ridge", "START");
    expect(start.json).toMatchObject({ queued: true });
    expect((await list(h))[0]).toMatchObject({ kind: "reply", text: start.json.reply });
  });

  it("one cell, two clients: the answer is filed under the client the text was about", async () => {
    const h = manual();
    await h.business("aaa-tree", { name: "AAA Tree" });
    await h.business("bbb-tree", { name: "BBB Tree" });
    await addLead(h, "bbb-tree", "r-b", "Al Moss", "2026-09-29T09:30:00");
    const r = await paste(h, "aaa-tree", `booked 900 #${leadCode("r-b")}`);
    expect(r.json).toMatchObject({ businessId: "bbb-tree", handled: "booked", queued: true });
    expect(await list(h)).toMatchObject([{ businessId: "bbb-tree", businessName: "BBB Tree", kind: "reply" }]);
  });

  it("is the operator's only", async () => {
    const h = manual();
    await h.business("ridge");
    expect((await h.api("GET", "/api/texts-to-send", undefined, { auth: false })).status).toBe(401);
    expect((await h.api("POST", "/api/businesses/ridge/owner-texts", { text: "OK" }, { auth: false })).status).toBe(401);
    expect((await h.api("POST", "/api/businesses/ridge/owner-messages/om-1/sent", undefined, { auth: false })).status).toBe(401);
    expect((await h.api("GET", "/api/businesses/ridge/owner-texts")).json).toEqual([]);
  });
});

describe("the console says where a hand-off went (A5)", () => {
  /** "Hand it to the owner" and "What they mean", as the console's buttons do: the route's answer and the toast. */
  const handoff = async (h: Harness, bid: string, rid: string, again = false) => {
    const r = await h.api("POST", `/api/businesses/${bid}/replies/${rid}/handoff`);
    return { json: r.json as HandoffResult, toast: handoffToast(r.json, { again }) };
  };
  const relabel = async (h: Harness, rid: string, intent: string, marked: string) => {
    const r = await h.api("POST", `/api/businesses/ridge/replies/${rid}/intent`, { intent });
    return { json: r.json as HandoffResult, toast: handoffToast(r.json, { marked }) };
  };
  const unclear = { intent: "unclear", status: "new", handedOffAt: undefined, text: "Might be interested, what would it cost?" } as const;

  it("by hand: a hand-off or a yes is on Texts to send, never texted", async () => {
    const h = manual();
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T09:30:00");
    await addLead(h, "ridge", "ru", "Dan Ruiz", "2026-09-29T09:00:00", unclear);
    await addLead(h, "ridge", "rl", "Al Moss", "2026-09-29T09:10:00", unclear);

    const again = await handoff(h, "ridge", "r1", true);
    expect(again.json).toEqual({ ok: true, delivery: "manual", channel: null, error: null });
    expect(again.toast).toBe("On Texts to send for you to text the owner");
    const price = await relabel(h, "ru", "wants_price", "Marked wants a price");
    expect(price.json).toMatchObject({ ok: true, delivery: "manual" });
    expect(price.toast).toBe("Marked wants a price — on Texts to send for you to text the owner");
    expect((await list(h)).map((t) => t.kind)).toEqual(["handoff", "handoff"]);
    // a label that hands nothing off, or a yes the owner already has, says only what it marked
    const later = await relabel(h, "rl", "later", "Marked later");
    expect(later.json).toEqual({ ok: true });
    expect(later.toast).toBe("Marked later");
    expect((await relabel(h, "ru", "wants_it", "Marked a yes")).toast).toBe("Marked a yes");
    expect(await list(h)).toHaveLength(2);
  });

  it("by text, the words are as before; emailed, or nowhere to send it, it says so", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T09:30:00");
    await addLead(h, "ridge", "ru", "Dan Ruiz", "2026-09-29T09:00:00", unclear);
    await addLead(h, "ridge", "rq", "Al Moss", "2026-09-29T09:10:00", unclear);
    await addLead(h, "ridge", "rc", "Jo Pike", "2026-09-29T08:00:00", { ownerContactedAt: "2026-09-29T09:00:00" });

    expect(await handoff(h, "ridge", "r1", true)).toEqual({ json: { ok: true, delivery: "sent", channel: "log", error: null }, toast: "Texted to the owner again" });
    expect((await handoff(h, "ridge", "rq")).toast).toBe("Texted to the owner");
    expect((await relabel(h, "ru", "wants_it", "Marked a yes")).toast).toBe("Marked a yes — texted to the owner");
    // the owner already called them: nothing new goes
    expect(await handoff(h, "ridge", "rc", true)).toEqual({ json: { ok: true }, toast: "Nothing new to text: the owner has already called them" });
    // they texted STOP: the hand-off is emailed
    await h.sms("STOP");
    h.setNow("2026-09-29T15:00:00Z");
    expect(await handoff(h, "ridge", "r1", true)).toMatchObject({ json: { delivery: "sent", channel: "email" }, toast: "Emailed to the owner again" });

    await h.business("nocell", { ownerPhone: undefined, ownerEmail: undefined });
    await addLead(h, "nocell", "rn", "Lu Park", "2026-09-29T09:30:00");
    const none = await handoff(h, "nocell", "rn", true);
    expect(none.json).toMatchObject({ ok: true, delivery: "failed" });
    expect(none.toast).toBe("Not texted: it's waiting for you in Needs a person. No cell on file and no email on file. Pass it on yourself.");
  });

  it("Needs a person labels our answer to a pasted text by where it waits", async () => {
    const h = manual();
    await h.business("ridge");
    const answers = async () => ((await h.api("GET", "/api/review")).json.items as { kind: string; handled?: string }[]).filter((i) => i.kind === "owner_text").map((i) => ourAnswerLabel("manual", i.handled));
    expect((await paste(h, "ridge", "purple elephant")).json).toMatchObject({ handled: "unrecognized", queued: true });
    expect(await answers()).toEqual(["Our answer (on Texts to send, unless they'd texted STOP)"]);
    h.setNow("2026-09-29T14:05:00Z");
    expect((await paste(h, "ridge", "STOP")).json).toMatchObject({ handled: "texts_off", queued: true });
    expect(await answers()).toEqual(["Our answer (on Texts to send, unless they'd texted STOP)", "Our answer (on Texts to send)"]);
    // by Twilio (or the log in dev), the webhook's answer went back in the same exchange
    expect(ourAnswerLabel("twilio", "unrecognized")).toBe("We texted back");
    expect(ourAnswerLabel("log", "texts_off")).toBe("We texted back");
  });
});
