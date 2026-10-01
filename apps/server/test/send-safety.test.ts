import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerNewRequests, find, ledgerPass, markSent, planBatch, sendHealth, type BusinessProfile, type Customer, type Touch } from "@qa/engine";
import { loadConfig } from "../src/config.ts";
import { Db } from "../src/db/sqlite.ts";
import { Repo } from "../src/db/repo.ts";
import { Accounts } from "../src/core/accounts.ts";
import { sendDue } from "../src/core/ops.ts";
import { createApp, type HttpDeps } from "../src/http/app.ts";
import { SmtpEmailProvider } from "../src/providers/email.ts";
import { LogNotifier } from "../src/providers/sms.ts";
import { ProviderError, type DirectProvider, type OutboundMessage, type SendResult } from "../src/contracts.ts";

/**
 * Sending straight from the client's mailbox (SMTP): a note is claimed before the mail server sees it, so a
 * timeout after the server took it, a crash, or two overlapping sends never mails it twice; a hard "no such
 * mailbox" is a bounce (suppressed, counted, and notes 2–3 stop); a quota block doesn't blame the person; and a
 * note that lost its stop line or address is held.
 */
const dir = mkdtempSync(join(tmpdir(), "qa-send-"));
const dbPath = join(dir, "qa.db");
const TOKEN = "test-operator-token-987";
let now = new Date("2026-09-30T14:00:00Z"); // Wed 10:00 New York

type Outcome = "ok" | Error | ((m: OutboundMessage) => Promise<SendResult>);
class ScriptedSmtp implements DirectProvider {
  readonly kind = "direct" as const;
  readonly name = "smtp";
  delivered: OutboundMessage[] = [];
  script = new Map<string, Outcome[]>();
  async send(m: OutboundMessage): Promise<SendResult> {
    const next = this.script.get(m.to)?.shift() ?? "ok";
    if (typeof next === "function") return next(m);
    if (next instanceof Error) throw next;
    await new Promise((r) => setTimeout(r, 5));
    this.delivered.push(m);
    return { providerId: `<${m.touchId}@mail.test>`, messageId: `<${m.touchId}@mail.test>` };
  }
}

const person = (email: string): Customer => {
  const first = email.split(".")[0]!.replace(/^./, (c) => c.toUpperCase());
  return { id: `c-${first.toLowerCase()}`, sourceIds: [first], name: `${first} Lee`, firstName: first, lastName: "Lee", emails: [email], phones: [], properties: [], tags: [] };
};
const BODY = (n: number) => `Note ${n} about the maples. Still want them done? Reply "stop" and we won't write again.\n\nRidge Tree · 14 Mill Rd, Concord, NH`;
const profile = (id: string): BusinessProfile => ({
  id, name: "Ridge Tree", trade: "tree", otherTrades: [], software: "jobber", ownerName: "Dave Ridge", ownerFirstName: "Dave", ownerPhone: "+16035550199",
  signerName: "Sarah", signerRole: "office", timezone: "America/New_York", sendDays: [0, 1, 2, 3, 4, 5, 6], sendWindow: [7, 18], blackoutWeeks: [], minQuoteValue: 0,
  minQuoteAgeDays: 21, maxQuoteAgeMonths: 36, weeklyNewContacts: 50, openCrewWeeks: [], voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] },
  persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0 }, channels: { email: "live" }, mailingAddress: "14 Mill Rd, Concord, NH 03301",
  plan: { stage: "paying", trialSize: 150, monthlyPrice: 497, freeMonths: [], paidOn: "2026-08-01" }, createdOn: "2026-08-01",
});

let d: HttpDeps & { email: ScriptedSmtp };
let app: ReturnType<typeof createApp>;
const st = (bid: string) => d.accounts.peek(bid)!.state;
const touches = (bid: string, email: string) => st(bid).touches.filter((t) => t.customerId === st(bid).dataset.customers.find((c) => c.emails.includes(email))!.id).sort((a, b) => a.step - b.step);
const to = (email: string) => d.email.delivered.filter((m) => m.to === email);
const op = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
async function client(id: string, emails: string[]): Promise<void> {
  await d.accounts.create(profile(id), "2026-09-29");
  await d.accounts.withAccount(id, (s) => {
    s.dataset = { ...s.dataset, customers: emails.map(person) };
    for (const c of s.dataset.customers)
      for (const step of [1, 2, 3])
        s.touches.push({ id: `${id}-${c.id}-${step}`, opportunityId: `${id}-${c.id}`, customerId: c.id, channel: "email", step, angle: "check_in", dueAt: step === 1 ? "2026-09-30T08:00" : `2026-10-0${step + 1}T09:00`, status: "approved", subject: step === 1 ? "the maples" : "Re: the maples", body: BODY(step), flags: [] } as Touch);
  });
}

beforeAll(() => {
  const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: TOKEN, APP_SECRET: "test-app-secret-0123456789", WEBHOOK_SECRET: "test-webhook-secret", PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false" });
  d = { cfg, accounts: new Accounts(new Repo(new Db(dbPath))), email: new ScriptedSmtp(), notifier: new LogNotifier(true), llm: null, fsm: {}, log: () => {}, clock: () => now, parsers: {} };
  app = createApp(d);
});
afterAll(() => {
  d.accounts.repo.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a note is never sent twice", () => {
  it("a timeout after the server took the message leaves it 'sending' for a person to check — never re-sent", async () => {
    await client("one", ["amy.lee@gmail.com"]);
    d.email.script.set("amy.lee@gmail.com", [
      async (m) => {
        d.email.delivered.push(m); // the server accepted it...
        throw new ProviderError("Timeout waiting for server response", "smtp", 0, true, true); // ...then the line went quiet
      },
    ]);
    expect(await sendDue(d, "one")).toMatchObject({ sent: 0, failed: 1 });
    expect(touches("one", "amy.lee@gmail.com")[0]!.status).toBe("sending");
    now = new Date(now.getTime() + 30 * 60_000);
    await sendDue(d, "one");
    expect(to("amy.lee@gmail.com")).toHaveLength(1);
    // it waits in the operator's queue, who settles it
    const items = (await op("GET", "/api/review")).json.items as { kind: string; touchId?: string }[];
    const item = items.find((i) => i.kind === "unsure_send")!;
    expect(item.touchId).toBe("one-c-amy-1");
    expect((await op("PATCH", `/api/businesses/one/touches/${item.touchId}`, { status: "sent" })).json.ok).toBe(true);
    expect(touches("one", "amy.lee@gmail.com")[0]!.status).toBe("sent");
  });

  it("two overlapping sends (the worker and a console Sync) mail each note once", async () => {
    await client("two", ["bo.lee@gmail.com", "cy.lee@gmail.com", "di.lee@gmail.com"]);
    await Promise.all([sendDue(d, "two"), sendDue(d, "two"), sendDue(d, "two")]);
    for (const e of ["bo.lee@gmail.com", "cy.lee@gmail.com", "di.lee@gmail.com"]) expect(to(e)).toHaveLength(1);
    expect(st("two").touches.filter((t) => t.step === 1).map((t) => t.status)).toEqual(["sent", "sent", "sent"]);
  });
});

describe("hard rejections", () => {
  it("'no such mailbox' on note 1 is a bounce: suppressed, counted, and notes 2–3 never go", async () => {
    await client("three", ["ed.lee@gmail.com", "fay.lee@gmail.com"]);
    d.email.script.set("ed.lee@gmail.com", [new ProviderError("550 5.1.1 The email account that you tried to reach does not exist", "smtp", 550, false)]);
    await sendDue(d, "three");
    const [n1, n2, n3] = touches("three", "ed.lee@gmail.com");
    expect(n1!.status).toBe("bounced");
    expect(st("three").suppressions["ed.lee@gmail.com"]).toBe("bounced");
    expect([n2!.status, n3!.status]).toEqual(["cancelled", "cancelled"]);
    expect(sendHealth(st("three")).bounces).toBe(1);
    now = new Date("2026-10-05T14:00:00Z");
    await sendDue(d, "three");
    expect(to("ed.lee@gmail.com")).toHaveLength(0);
  });

  it("a quota block isn't the person's fault: nobody is suppressed and the note waits", async () => {
    now = new Date("2026-09-30T14:00:00Z");
    await client("four", ["gus.lee@gmail.com", "hal.lee@gmail.com"]);
    d.email.script.set("gus.lee@gmail.com", [new ProviderError("550 5.4.5 Daily user sending quota exceeded", "smtp", 550, false)]);
    d.email.script.set("hal.lee@gmail.com", [new ProviderError("550 5.4.5 Daily user sending quota exceeded", "smtp", 550, false)]);
    await sendDue(d, "four");
    expect(st("four").suppressions).toEqual({});
    expect(touches("four", "gus.lee@gmail.com")[0]!.status).toBe("approved");
    expect(touches("four", "hal.lee@gmail.com")[0]!.status).toBe("approved");
  });

  it("note 1 that keeps failing ends its sequence: no follow-up arrives as a first contact", async () => {
    await client("five", ["ida.lee@gmail.com"]);
    d.email.script.set("ida.lee@gmail.com", Array.from({ length: 6 }, () => new ProviderError("451 4.3.0 Temporary server error, try again later", "smtp", 451, true)));
    for (let i = 0; i < 6; i++) {
      await sendDue(d, "five");
      now = new Date(now.getTime() + 60 * 60_000);
    }
    const [n1, n2, n3] = touches("five", "ida.lee@gmail.com");
    expect(n1!.status).toBe("skipped");
    expect([n2!.status, n3!.status]).not.toContain("approved");
    now = new Date("2026-10-06T14:00:00Z");
    await sendDue(d, "five");
    expect(to("ida.lee@gmail.com")).toHaveLength(0);
  });

  it("the SMTP provider tells a maybe-sent timeout from a refused connection and a hard rejection", async () => {
    const smtp = new SmtpEmailProvider("smtp://localhost:2525", { from: "sarah@ridge.test" });
    const fail = (e: object) => ((smtp as unknown as { transport: { sendMail: () => Promise<never> } }).transport = { sendMail: async () => Promise.reject(Object.assign(new Error("boom"), e)) });
    const msg = { businessId: "x", touchId: "t", customerId: "c", to: "a@b.com", toName: "A", fromName: "S", subject: "s", text: "t" };
    fail({ code: "ETIMEDOUT", command: "DATA" });
    await expect(smtp.send(msg)).rejects.toMatchObject({ retryable: true, maybeSent: true });
    fail({ code: "ECONNECTION", command: "CONN" });
    await expect(smtp.send(msg)).rejects.toMatchObject({ retryable: true, maybeSent: false });
    fail({ responseCode: 550, response: "550 5.1.1 no such user", command: "RCPT TO" });
    await expect(smtp.send(msg)).rejects.toMatchObject({ retryable: false, maybeSent: false, status: 550 });
  });
});

describe("the quality gate", () => {
  it("an edit that drops the stop line and address is held, and never sent", async () => {
    now = new Date("2026-09-30T14:00:00Z");
    await client("six", ["jo.lee@gmail.com"]);
    const res = await op("PATCH", "/api/businesses/six/touches/six-c-jo-1", { body: "Hi Jo, still want the maples done this fall? Let me know and we'll get you on the schedule." });
    expect(res.json.ok).toBe(true);
    expect(res.json.flags).toEqual(expect.arrayContaining(["Missing the stop line (required)", "Missing the business address (required)"]));
    expect(touches("six", "jo.lee@gmail.com")[0]!.status).toBe("planned");
    // even if someone approves it anyway, it doesn't go
    await d.accounts.withAccount("six", (s) => void (s.touches.find((t) => t.id === "six-c-jo-1")!.status = "approved"));
    await sendDue(d, "six");
    expect(to("jo.lee@gmail.com")).toHaveLength(0);
  });

  it("follow-ups are linted as follow-ups: a threaded 'Re:' isn't flagged", async () => {
    const res = await op("PATCH", "/api/businesses/six/touches/six-c-jo-2", { body: `${BODY(2)}` });
    expect(res.json.flags).not.toEqual(expect.arrayContaining([expect.stringMatching(/Fake Re/)]));
  });
});

describe("what a sync or a blocked mailbox changes", () => {
  it("a quote approved after note 1: the follow-ups due later never go, and all of them stop at once", async () => {
    now = new Date("2026-09-30T14:00:00Z"); // Wed 10:00 New York
    await d.accounts.create(profile("eight"), "2026-09-30");
    await d.accounts.withAccount("eight", (s) => {
      const c = person("lu.lee@gmail.com");
      s.dataset = { ...s.dataset, customers: [c], quotes: [{ id: "q1", customerId: c.id, title: "Dead oak over the garage", lineItems: [], total: 1800, status: "awaiting_response", rawStatus: "Awaiting response", sentOn: "2026-07-01", jobIds: [] }] };
      find(s, "2026-09-30T10:00:00");
      planBatch(s, "2026-09-30T10:00:00", { startOn: "2026-09-30", approve: true });
      const n1 = s.touches.find((t) => t.step === 1)!;
      markSent(s, n1.id, `${n1.dueAt}:00`, "<n1@mail.test>");
      s.dataset = {
        ...s.dataset,
        quotes: s.dataset.quotes.map((q) => ({ ...q, status: "converted" as const, approvedOn: "2026-10-02", convertedOn: "2026-10-02", jobIds: ["j1"] })),
        jobs: [{ id: "j1", customerId: c.id, title: "Dead oak over the garage", lineItems: [], total: 1800, status: "scheduled", rawStatus: "Scheduled", createdOn: "2026-10-02", scheduledOn: "2026-10-09", quoteId: "q1" }],
      };
      ledgerPass(s, "2026-10-02T12:00:00");
    });
    const rest = touches("eight", "lu.lee@gmail.com").filter((t) => t.step > 1);
    expect(rest.length).toBeGreaterThan(0);
    // the day note 2 comes due, nothing goes, and every note after it is cancelled too
    now = new Date(Date.parse(`${rest[0]!.dueAt}:00Z`) + 4 * 3_600_000);
    await sendDue(d, "eight");
    expect(to("lu.lee@gmail.com")).toHaveLength(0);
    expect(touches("eight", "lu.lee@gmail.com").filter((t) => t.step > 1).map((t) => t.status)).toEqual(rest.map(() => "cancelled"));
  });

  it("an answer to a new request is never sent at night or a day late still saying 'today': it's dropped and the owner told to call", async () => {
    now = new Date("2026-09-30T14:00:00Z"); // Wed 10:00 New York
    await d.accounts.create(profile("seven"), "2026-09-30");
    await d.accounts.withAccount("seven", (s) => {
      const c = { ...person("kay.lee@gmail.com"), phones: ["+16035550142"] };
      s.dataset = { ...s.dataset, customers: [c], requests: [{ id: "r1", customerId: c.id, title: "Oak over the garage", status: "new", rawStatus: "New", createdOn: "2026-09-30", createdAt: "2026-09-30T13:55:00Z" }] };
      expect(answerNewRequests(s, "2026-09-30T10:00:00")).toBe(1);
    });
    const answer = () => st("seven").touches.find((t) => t.track === "new_request")!;
    expect(answer().body).toMatch(/call today/);
    // a Workspace throttle that lasts all day
    d.email.script.set("kay.lee@gmail.com", Array.from({ length: 12 }, () => new ProviderError("421 4.7.0 Try again later, closing connection", "smtp", 421, true)));
    for (let i = 0; i < 12 && answer().status === "approved"; i++) {
      await sendDue(d, "seven");
      // the next try, at the time the retry was moved to (New York is UTC-4)
      now = new Date(Math.max(now.getTime() + 60_000, Date.parse(`${answer().dueAt}:00Z`) + 4 * 3_600_000));
    }
    const t = answer();
    expect(to("kay.lee@gmail.com")).toHaveLength(0);
    expect(t.status).toBe("cancelled");
    expect(t.lastError).toBe("Not sent: it would have gone after 8pm, past the day it was written for");
    // dropped at the 5:30pm refusal, before it could go at 8:30pm
    expect(t.attempts).toBe(6);
    expect(st("seven").ownerMessages.at(-1)!.text).toMatch(/our answer to Kay Lee's request didn't go out.*Call them/);
  });
});
