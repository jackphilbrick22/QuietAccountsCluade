import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendHealth, type BusinessProfile, type Customer } from "@qa/engine";
import { loadConfig } from "../src/config.ts";
import { Db } from "../src/db/sqlite.ts";
import { Repo } from "../src/db/repo.ts";
import { Accounts } from "../src/core/accounts.ts";
import { sendDue } from "../src/core/ops.ts";
import { runTasks } from "../src/core/worker.ts";
import { createApp, type HttpDeps } from "../src/http/app.ts";
import { LogEmailProvider } from "../src/providers/email.ts";
import { LogNotifier } from "../src/providers/sms.ts";

/**
 * Two clients in the same town share homeowners. A reply is routed by the note it answers (its thread), never by
 * guessing among the businesses that know the address: a stop is honored where it was meant (or everywhere it
 * could have been meant), a yes reaches only the right owner, a bounce notice from the mail system acts on the
 * note it bounced, and a reply nobody can place waits for a person. Failed deliveries are retried, once.
 */
const dir = mkdtempSync(join(tmpdir(), "qa-route-"));
const dbPath = join(dir, "qa.db");
const TOKEN = "test-operator-token-456";
const WH = "test-webhook-secret";
let now = new Date("2026-09-30T14:00:00Z"); // Wed 10:00 New York

const AAA = "aaa-tree";
const BBB = "bbb-tree";
const PHONE = { [AAA]: "+16035550101", [BBB]: "+16035550202" } as const;
const JANE = "jane.roberts@gmail.com";
const BILL = "bill.iverson@yahoo.com";
const KIM = "kim.ng@yahoo.com"; // only AAA's
const MAX = "max.ortiz@aol.com";
const LOU = "lou.park@gmail.com";
const ANN = "ann.cho@gmail.com";
const SUE = "sue.baker@gmail.com";
const BOTH = [JANE, BILL, MAX, LOU, ANN, SUE];

const person = (email: string): Customer => {
  const first = email.split(".")[0]!.replace(/^./, (c) => c.toUpperCase());
  return { id: `c-${first.toLowerCase()}`, sourceIds: [first], name: `${first} Smith`, firstName: first, lastName: "Smith", emails: [email], phones: [], properties: [], tags: [] };
};
const profile = (id: string, name: string): BusinessProfile => ({
  id, name, trade: "tree", otherTrades: [], software: "jobber", ownerName: "Dave Ridge", ownerFirstName: "Dave", ownerPhone: PHONE[id as keyof typeof PHONE],
  signerName: "Sam", signerRole: "office", timezone: "America/New_York", sendDays: [0, 1, 2, 3, 4, 5, 6], sendWindow: [7, 18], blackoutWeeks: [], minQuoteValue: 0,
  minQuoteAgeDays: 21, maxQuoteAgeMonths: 36, weeklyNewContacts: 50, openCrewWeeks: [], voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] },
  persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0 }, channels: { email: "live" }, mailingAddress: "14 Mill Rd, Concord, NH 03301",
  plan: { stage: "paying", trialSize: 150, monthlyPrice: 497, freeMonths: [], paidOn: "2026-08-01" }, createdOn: "2026-08-01", autoAck: true,
});

let d: HttpDeps & { email: LogEmailProvider; notifier: LogNotifier };
let app: ReturnType<typeof createApp>;
const st = (bid: string) => d.accounts.peek(bid)!.state;
const cust = (bid: string, email: string) => st(bid).dataset.customers.find((c) => c.emails.includes(email))!;
const queued = (bid: string, email: string) => st(bid).touches.filter((t) => t.customerId === cust(bid, email).id && t.status === "approved").length;
/** The Message-ID of the note `bid` sent to `email` (what the homeowner's In-Reply-To carries). */
const noteId = (bid: string, email: string) => d.email.sent.find((m) => m.businessId === bid && m.to === email)!.messageId!;
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const inbound = async (body: Record<string, unknown>) => {
  const res = await app.request(`/webhooks/inbound-email/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const threaded = (id: string) => [{ Name: "In-Reply-To", Value: id }];
const textsTo = (bid: string) => d.notifier.sent.filter((m) => m.to.phone === PHONE[bid as keyof typeof PHONE]);

beforeAll(async () => {
  const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: TOKEN, APP_SECRET: "test-app-secret-0123456789", WEBHOOK_SECRET: WH, PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false" });
  d = { cfg, accounts: new Accounts(new Repo(new Db(dbPath))), email: new LogEmailProvider({ quiet: true }), notifier: new LogNotifier(true), llm: null, fsm: {}, log: () => {}, clock: () => now, parsers: {} };
  app = createApp(d);
  for (const [id, name] of [[AAA, "AAA Tree"], [BBB, "BBB Tree"]] as const) {
    await d.accounts.create(profile(id, name), "2026-09-29");
    const emails = id === AAA ? [...BOTH, KIM] : BOTH;
    await d.accounts.withAccount(id, (s) => {
      s.dataset = { ...s.dataset, customers: emails.map(person) };
      for (const c of s.dataset.customers)
        for (const step of [1, 2, 3])
          s.touches.push({
            id: `${id}-${c.id}-${step}`, opportunityId: `${id}-${c.id}`, customerId: c.id, channel: "email", step, angle: "check_in",
            dueAt: step === 1 ? "2026-09-30T08:00" : `2026-10-0${step + 3}T09:00`, status: "approved", subject: step === 1 ? "the maples" : "Re: the maples",
            body: `Note ${step} about the maples. Still want them done? Reply "stop" and we won't write again.\n\n${name} · 14 Mill Rd, Concord, NH`, flags: [],
          });
    });
  }
  await sendDue(d, AAA);
  await sendDue(d, BBB);
});
afterAll(() => {
  d.accounts.repo.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("routing a reply to the business it answers", () => {
  it("both businesses wrote to the shared homeowners", () => {
    expect(d.email.sent.filter((m) => m.businessId === AAA)).toHaveLength(7);
    expect(d.email.sent.filter((m) => m.businessId === BBB)).toHaveLength(6);
  });

  it("a stop answering BBB's note is honored at BBB — the business that wrote it", async () => {
    await inbound({ MessageID: "m-jane-stop", From: JANE, Subject: "Re: the maples", TextBody: "Please take me off your list", Headers: threaded(noteId(BBB, JANE)) });
    expect(st(BBB).suppressions[JANE]).toBe("unsubscribed");
    expect(queued(BBB, JANE)).toBe(0);
    // AAA's own conversation with her is untouched
    expect(st(AAA).suppressions[JANE]).toBeUndefined();
    expect(queued(AAA, JANE)).toBe(2);
  });

  it("a yes answering BBB's note reaches BBB's owner only, answered in BBB's name", async () => {
    const aaaTexts = textsTo(AAA).length;
    await inbound({ MessageID: "m-bill-yes", From: BILL, Subject: "Re: the maples", TextBody: "Yes, please call me, 603-555-0142", Headers: threaded(noteId(BBB, BILL)) });
    expect(textsTo(AAA)).toHaveLength(aaaTexts);
    expect(textsTo(BBB).at(-1)!.text).toMatch(/Bill/);
    expect(st(BBB).replies.some((r) => r.from === BILL)).toBe(true);
    expect(st(AAA).replies.some((r) => r.from === BILL)).toBe(false);
    const ack = d.email.sent.at(-1)!;
    expect(ack).toMatchObject({ businessId: BBB, to: BILL, fromName: "Sam at BBB Tree" });
  });

  it("a bounce notice from the mail system acts on the note it bounced", async () => {
    await inbound({
      MessageID: "m-dsn-kim", From: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", Subject: "Delivery Status Notification (Failure)",
      TextBody: `Your message wasn't delivered to ${KIM} because the address couldn't be found. 550 5.1.1`, Headers: threaded(noteId(AAA, KIM)),
    });
    expect(st(AAA).suppressions[KIM]).toBe("bounced");
    expect(queued(AAA, KIM)).toBe(0);
    expect(sendHealth(st(AAA)).bounces).toBe(1);
  });

  it("a bounce notice that doesn't thread still finds the address it names — at every business that has it", async () => {
    await inbound({ MessageID: "m-dsn-max", From: "postmaster@aol.com", Subject: "Undeliverable", TextBody: `Delivery to the following recipient failed permanently: ${MAX}\n550 5.1.1 user unknown` });
    expect(st(AAA).suppressions[MAX]).toBe("bounced");
    expect(st(BBB).suppressions[MAX]).toBe("bounced");
  });

  it("a stop from an address we never wrote to, in our thread, stops the person we wrote to", async () => {
    await inbound({ MessageID: "m-lou-alias", From: "lou.park@work-mail.com", Subject: "Re: the maples", TextBody: "Please stop emailing me.", Headers: threaded(noteId(AAA, LOU)) });
    expect(queued(AAA, LOU)).toBe(0);
    expect(st(AAA).suppressions[LOU]).toBe("unsubscribed");
    expect(queued(BBB, LOU)).toBe(2);
  });

  it("a stop nobody can place is honored at every business that knows the address", async () => {
    await inbound({ MessageID: "m-ann-stop", From: ANN, Subject: "hello", TextBody: "Unsubscribe me please." });
    expect(st(AAA).suppressions[ANN]).toBe("unsubscribed");
    expect(st(BBB).suppressions[ANN]).toBe("unsubscribed");
    expect(queued(AAA, ANN) + queued(BBB, ANN)).toBe(0);
  });

  it("a yes nobody can place texts no owner: it waits for a person, who sends it on", async () => {
    const texts = d.notifier.sent.length;
    const sent = d.email.sent.length;
    await inbound({ MessageID: "m-sue-yes", From: SUE, Subject: "about the tree", TextBody: "Yes, we'd like to go ahead. Call me." });
    expect(d.notifier.sent.length).toBe(texts);
    expect(d.email.sent.length).toBe(sent);
    expect(st(AAA).replies.some((r) => r.from === SUE) || st(BBB).replies.some((r) => r.from === SUE)).toBe(false);
    const review = (await api("GET", "/api/review")).json.items as { kind: string; id: string; candidates: { businessId: string }[]; from: string }[];
    const item = review.find((i) => i.kind === "unmatched_reply" && i.from === SUE)!;
    expect(item.candidates.map((c) => c.businessId).sort()).toEqual([AAA, BBB]);
    const res = await api("POST", `/api/inbound-review/${encodeURIComponent(item.id)}`, { businessId: BBB });
    expect(res.status).toBe(200);
    expect(textsTo(BBB).at(-1)!.text).toMatch(/Sue/);
    expect(((await api("GET", "/api/review")).json.items as { kind: string }[]).some((i) => i.kind === "unmatched_reply")).toBe(false);
  });

  it("a reply from an address nobody knows, answering nothing we sent, waits for a person too", async () => {
    await inbound({ MessageID: "m-stranger", From: "someone@else.com", Subject: "tree work?", TextBody: "Do you do stump grinding? Call me." });
    const review = (await api("GET", "/api/review")).json.items as { kind: string; from: string; candidates: unknown[] }[];
    expect(review.find((i) => i.kind === "unmatched_reply" && i.from === "someone@else.com")!.candidates).toEqual([]);
  });
});

describe("a queued answer", () => {
  it("never goes to someone who asked us to stop after the yes it answers", async () => {
    now = new Date("2026-10-01T01:30:00Z"); // 9:30pm New York: the answer waits for 7am
    await inbound({ MessageID: "m-lou-yes", From: LOU, Subject: "Re: the maples", TextBody: "Yes, please call me about the maples.", Date: now.toISOString(), Headers: threaded(noteId(BBB, LOU)) });
    expect(d.accounts.repo.db.all("SELECT 1 FROM tasks WHERE type = 'reply.ack' AND business_id = ?", BBB)).toHaveLength(1);
    now = new Date("2026-10-01T09:00:00Z"); // 5am
    await inbound({ MessageID: "m-lou-stop", From: LOU, Subject: "Re: the maples", TextBody: "Actually, please stop emailing me.", Date: now.toISOString(), Headers: threaded(noteId(BBB, LOU)) });
    const sent = d.email.sent.length;
    now = new Date("2026-10-01T11:05:00Z"); // 7:05am
    await runTasks(d);
    expect(d.email.sent.slice(sent).filter((m) => m.to === LOU)).toEqual([]);
    expect(st(BBB).replies.find((r) => r.from === LOU && r.intent === "wants_it")!.ack!.error).toMatch(/stop/);
  });
});

describe("inbound delivery failures are retried, and read once", () => {
  it("a delivery that failed is processed on the provider's retry, and the queued retry doesn't read it again", async () => {
    const accounts = d.accounts as unknown as { withAccount: Accounts["withAccount"] };
    const real = accounts.withAccount.bind(d.accounts);
    let fail = true;
    accounts.withAccount = (async (id: string, fn: never, opts?: never) => {
      if (fail && id === AAA) {
        fail = false;
        throw new Error("database is locked");
      }
      return real(id, fn, opts);
    }) as Accounts["withAccount"];
    const body = { MessageID: "m-jane-yes", From: JANE, Subject: "Re: the maples", TextBody: "Yes please, come look at the maples. Call me.", Date: "2026-09-30T15:00:00Z", Headers: threaded(noteId(AAA, JANE)) };
    const texts = textsTo(AAA).length;
    const first = await inbound(body);
    accounts.withAccount = real;
    expect(first.status).toBe(200);
    expect(st(AAA).replies.filter((r) => r.from === JANE)).toHaveLength(0);
    // the provider retries the same message: not a duplicate, because it never got through
    const retry = await inbound(body);
    expect(retry.json.duplicate).toBeUndefined();
    expect(st(AAA).replies.filter((r) => r.from === JANE)).toHaveLength(1);
    // our own queued retry finds it already read
    now = new Date(now.getTime() + 5 * 60_000);
    await runTasks(d);
    expect(st(AAA).replies.filter((r) => r.from === JANE)).toHaveLength(1);
    expect(textsTo(AAA).length).toBe(texts + 1);
    // and once it's through, a third delivery is a duplicate
    expect((await inbound(body)).json.duplicate).toBe(true);
  });

  it("a delivery whose processing died mid-way (a restart) is taken again once it's clearly stale", async () => {
    d.accounts.repo.db.run("INSERT INTO webhook_log (id, source, received_at, status, body) VALUES (?, 'email', ?, 'received', '{}')", "email:m-max-yes", new Date(now.getTime() - 10 * 60_000).toISOString());
    await inbound({ MessageID: "m-max-yes", From: "max.ortiz@aol.com", Subject: "Re: the maples", TextBody: "Yes please, call me.", Headers: threaded(noteId(AAA, MAX)) });
    expect(st(AAA).replies.some((r) => r.from === MAX && r.intent === "wants_it")).toBe(true);
  });
});
