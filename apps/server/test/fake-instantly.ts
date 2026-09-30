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

/** Routes are "METHOD /path" with optional ":param" segments. An array answers call 1, 2, 3... in turn (the last repeats). */
export function fakeInstantly(routes: Record<string, Handler | Handler[]>) {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  const find = (method: string, path: string) => {
    for (const [key, h] of Object.entries(routes)) {
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
    return json(out.status ?? 200, out.body, out.headers);
  };
  return { fetch, calls, callsTo: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path) };
}

export function recordingSleep() {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
}
