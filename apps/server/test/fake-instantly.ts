import type { Fetch } from "../src/contracts.ts";

/* A fake Instantly API for tests: routes by "METHOD /path", records every call. */

export interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
  body: any;
  headers: Record<string, string>;
}
export type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
export type Handler = (call: Call) => Reply | Promise<Reply>;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/**
 * One sending inbox as the fake holds it: the name it sends under, the most it sends a day (none set at first), and
 * campaigns it's in that the fake didn't see made.
 */
export interface FakeInbox {
  first_name: string;
  last_name: string;
  daily_limit?: number;
  /** Campaigns made elsewhere (Jack's cold email), on top of the ones made or changed through the fake with it listed. */
  campaigns: { campaign_id: string; campaign_name: string }[];
  /** The name never changes, whatever is PATCHed (a read-back that doesn't match). */
  keepsName?: boolean;
  /** Nor does the daily limit. */
  keepsLimit?: boolean;
  /** Not connected in the workspace: 404. */
  missing?: boolean;
}

/**
 * Routes are "METHOD /path" with optional ":param" segments. An array answers call 1, 2, 3... in turn (the last repeats).
 * Unless a test routes them itself, the fake also serves the sending inboxes: PATCH / GET /accounts/{email} (every inbox
 * starts out as "Jack Philbrick"), GET /account-campaign-mappings/{email} and PATCH /campaigns/{id}. `inbox(email)` is
 * what it holds for one inbox; `made` is every campaign made (POST /campaigns) or changed through it, with its inboxes.
 */
export function fakeInstantly(routes: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  const inboxes = new Map<string, FakeInbox>();
  const inbox = (email: string): FakeInbox => {
    const key = decodeURIComponent(email).toLowerCase();
    if (!inboxes.has(key)) inboxes.set(key, { first_name: "Jack", last_name: "Philbrick", campaigns: [] });
    return inboxes.get(key)!;
  };
  const made = new Map<string, { name: string; email_list: string[] }>();
  const account = (c: Call) => {
    const email = decodeURIComponent(c.path.split("/")[2]!);
    return { email, x: inbox(email) };
  };
  const notFound: Reply = { status: 404, body: { statusCode: 404, error: "Not Found", message: "Resource not found" } };
  const builtIn: Record<string, Handler> = {
    "PATCH /accounts/:email": (c) => {
      const { email, x } = account(c);
      if (x.missing) return notFound;
      if (!x.keepsName) Object.assign(x, { first_name: c.body.first_name ?? x.first_name, last_name: c.body.last_name ?? x.last_name });
      if (!x.keepsLimit && c.body.daily_limit !== undefined) x.daily_limit = c.body.daily_limit;
      return { body: { email, first_name: x.first_name, last_name: x.last_name, daily_limit: x.daily_limit ?? null } };
    },
    "GET /accounts/:email": (c) => {
      const { email, x } = account(c);
      return x.missing ? notFound : { body: { email, first_name: x.first_name, last_name: x.last_name, daily_limit: x.daily_limit ?? null } };
    },
    "GET /account-campaign-mappings/:email": (c) => {
      const { email, x } = account(c);
      const ours = [...made].filter(([, m]) => m.email_list.includes(email)).map(([id, m]) => ({ campaign_id: id, campaign_name: m.name }));
      return x.missing ? notFound : { body: { items: [...x.campaigns, ...ours].map((m) => ({ ...m, timestamp_created: "2026-09-01T00:00:00.000Z", status: 1 })) } };
    },
    "PATCH /campaigns/:id": (c) => {
      const id = c.path.split("/")[2]!;
      const m = made.get(id) ?? { name: id, email_list: [] };
      made.set(id, { ...m, ...(c.body.email_list ? { email_list: c.body.email_list } : {}) });
      return { body: { id, name: m.name } };
    },
  };
  const find = (method: string, path: string) => {
    for (const table of [routes, builtIn])
      for (const [key, h] of Object.entries(table)) {
        const [m, pattern] = key.split(" ") as [string, string];
        if (m !== method) continue;
        const a = pattern.split("/");
        const b = path.split("/");
        if (a.length === b.length && a.every((seg, i) => seg.startsWith(":") || seg === b[i])) return { key, h };
      }
    return undefined;
  };
  const fetch: Fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v2/, "");
    const method = init?.method ?? "GET";
    const call: Call = {
      method,
      path,
      query: Object.fromEntries(url.searchParams),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: { ...(init?.headers as Record<string, string>) },
    };
    calls.push(call);
    const route = find(method, path);
    if (!route) return json(404, { statusCode: 404, error: "Not Found", message: `no fake for ${method} ${path}` });
    let handler = route.h;
    if (Array.isArray(handler)) {
      const n = seen.get(route.key) ?? 0;
      seen.set(route.key, n + 1);
      handler = handler[Math.min(n, handler.length - 1)]!;
    }
    const out = await handler(call);
    const id = (out.body as { id?: unknown } | undefined)?.id;
    if (method === "POST" && path === "/campaigns" && (out.status ?? 200) < 300 && typeof id === "string") made.set(id, { name: call.body.name, email_list: call.body.email_list ?? [] });
    return json(out.status ?? 200, out.body, out.headers);
  };
  return { fetch, calls, callsTo: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path), inbox, made };
}

export function recordingSleep() {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
}
