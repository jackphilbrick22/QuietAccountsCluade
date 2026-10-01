/** A throwaway server (its own SQLite file, a settable clock) for tests that drive the HTTP routes and the worker. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Customer, Reply } from "@qa/engine";
import { loadConfig } from "../src/config.ts";
import { Db } from "../src/db/sqlite.ts";
import { Repo } from "../src/db/repo.ts";
import { Accounts } from "../src/core/accounts.ts";
import { createApp, type HttpDeps } from "../src/http/app.ts";
import { LogEmailProvider } from "../src/providers/email.ts";
import { LogNotifier } from "../src/providers/sms.ts";
import type { FsmConnector, OutboundProvider, OwnerNotifier } from "../src/contracts.ts";
import type { StripeClient } from "../src/providers/stripe.ts";

export const TOKEN = "test-operator-token-789";
export const SECRET = "test-app-secret-0123456789";
export const WH = "test-webhook-secret";
export const PHONE = "+16035550199";

export interface Harness {
  d: HttpDeps & { email: OutboundProvider; notifier: OwnerNotifier };
  app: ReturnType<typeof createApp>;
  dbPath: string;
  setNow(iso: string): void;
  now(): Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api(method: string, path: string, body?: unknown, opts?: { auth?: boolean }): Promise<{ status: number; json: any }>;
  sms(body: string, from?: string): Promise<string>;
  business(id: string, over?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** A fresh process on the same database (a deploy or a restart). */
  restart(): Harness;
  close(): void;
}

export function harness(opts: { email?: OutboundProvider; notifier?: OwnerNotifier; fsm?: Partial<Record<"jobber", FsmConnector>>; stripe?: StripeClient; env?: Record<string, string>; now?: string; dir?: string } = {}): Harness {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "qa-harness-"));
  const dbPath = join(dir, "qa.db");
  let now = new Date(opts.now ?? "2026-09-29T14:00:00Z"); // Tue 10:00 New York
  const cfg = loadConfig({ DATABASE_PATH: dbPath, OPERATOR_TOKEN: TOKEN, APP_SECRET: SECRET, WEBHOOK_SECRET: WH, PUBLIC_URL: "https://qa.test", WORKER_ENABLED: "false", ...opts.env });
  const d = {
    cfg,
    accounts: new Accounts(new Repo(new Db(dbPath))),
    email: opts.email ?? new LogEmailProvider({ quiet: true }),
    notifier: opts.notifier ?? new LogNotifier(true),
    llm: null,
    fsm: opts.fsm ?? {},
    stripe: opts.stripe,
    log: () => {},
    clock: () => now,
    parsers: {},
  } as Harness["d"];
  const app = createApp(d);
  const h: Harness = {
    d,
    app,
    dbPath,
    setNow: (iso) => (now = new Date(iso)),
    now: () => now,
    async api(method, path, body, o = {}) {
      const res = await app.request(path, {
        method,
        headers: { ...(o.auth === false ? {} : { authorization: `Bearer ${TOKEN}` }), "content-type": "application/json" },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: res.status, json: json as never };
    },
    async sms(body, from = PHONE) {
      const res = await app.request(`/webhooks/sms/${WH}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: from, Body: body }) });
      const xml = await res.text();
      return (xml.match(/<Message>([\s\S]*)<\/Message>/)?.[1] ?? xml).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    },
    async business(id, over = {}) {
      const r = await h.api("POST", "/api/businesses", { id, name: "Ridgeline Tree Co.", trade: "tree", ownerName: "Dave Ridge", ownerPhone: PHONE, ownerEmail: "dave@ridgelinetree.com", signerName: "Sarah", mailingAddress: "14 Mill Rd, Concord, NH 03301", state: "NH", timezone: "America/New_York", ...over });
      if (r.status !== 201) throw new Error(`create ${id}: ${JSON.stringify(r.json)}`);
      return r.json;
    },
    restart() {
      return harness({ ...opts, dir, now: now.toISOString() });
    },
    close() {
      d.accounts.repo.db.close();
      if (!opts.dir) rmSync(dir, { recursive: true, force: true });
    },
  };
  return h;
}

export function person(id: string, name: string): Customer {
  const [firstName = name, lastName = ""] = name.split(" ");
  return { id, sourceIds: [id], name, firstName, lastName, emails: [`${id}@example.org`], phones: ["+16035550142"], address: { street: "14 Oak Ln", city: "Concord", state: "NH", zip: "03301" }, properties: [], tags: [] };
}

/** A homeowner who said yes, handed to the owner and not called yet. */
export async function addLead(h: Harness, bid: string, rid: string, name: string, at: string, over: Partial<Reply> = {}): Promise<Reply> {
  const cid = `c-${rid}`;
  const r: Reply = { id: rid, customerId: cid, channel: "email", receivedAt: at, handedOffAt: at, from: `${cid}@example.org`, text: "Yes please, still need it done.", intent: "wants_it", confidence: 0.95, extracted: {}, status: "handed_off", ...over };
  await h.d.accounts.withAccount(bid, (s) => {
    s.dataset.customers = [...s.dataset.customers, person(cid, name)];
    s.replies.push(r);
  });
  return r;
}
