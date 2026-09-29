/**
 * Instantly API v2: a small fetch wrapper with retries, timeouts and typed errors.
 *
 * VERIFIED
 *  - Base URL: server https://api.instantly.ai, every endpoint under /api/v2 (OpenAPI spec
 *    https://api.instantly.ai/openapi/api_v2.json, `servers`).
 *  - Auth header: `Authorization: Bearer <API key>`. https://developer.instantly.ai/getting-started/authorization
 *  - Rate limits: 100 requests/second and 6,000 requests/minute, shared by the whole workspace (every key, API v1
 *    and v2). Going over either limit returns HTTP 429. https://developer.instantly.ai/getting-started/rate-limit
 *  - Error body on 4xx: `{ statusCode, error, message }` (every error response in the OpenAPI spec).
 *  - Paginated lists return `{ items, next_starting_after }`, and the next page is requested with
 *    `?starting_after=<cursor>&limit<=100` (e.g. GET /campaigns, GET /webhooks, GET /block-lists-entries).
 *  - Instantly's own CLI (npm @instantlyai/cli 0.2.7, dist/index.js `request`) sends Content-Type only when there
 *    is a body. It honours `Retry-After` (seconds) on 429, retries 5xx, and never retries a write that timed out.
 *    This client follows the same rules.
 *
 * ASSUMED
 *  - `Retry-After` may be missing (the docs don't mention it). Without it we use exponential backoff with jitter.
 *  - A 5xx or timeout on a non-idempotent write (create campaign, create webhook) may still have landed, so it is not
 *    retried here. The caller re-checks by listing instead (see provider.ensureCampaign / webhooks.ensureWebhooks).
 */
import type { Fetch } from "../../contracts.ts";
import { ProviderError } from "../../contracts.ts";

export const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";
export const INSTANTLY = "instantly";

export type Sleep = (ms: number) => Promise<void>;
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export type QueryValue = string | number | boolean | null | undefined;

export interface InstantlyClientOptions {
  apiKey: string;
  fetch?: Fetch;
  /** Injectable for tests; defaults to setTimeout. */
  sleep?: Sleep;
  baseUrl?: string;
  /** Per attempt, including reading the body. Default 30s. */
  timeoutMs?: number;
  /** Retries after the first attempt. Default 4. */
  maxRetries?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Jitter source in [0,1). Injectable for deterministic tests. */
  random?: () => number;
}

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  /**
   * True when repeating the request after an unknown outcome (timeout, network error, 5xx) cannot do harm.
   * Defaults to true for GET/PATCH/DELETE and false for POST. A 429 is always retried, because Instantly rejected it.
   */
  idempotent?: boolean;
}

export interface Page<T> {
  items?: T[];
  next_starting_after?: string | null;
}

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class InstantlyClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: Fetch;
  private readonly sleep: Sleep;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly random: () => number;

  constructor(opts: InstantlyClientOptions) {
    if (!opts.apiKey?.trim()) throw new ProviderError("Instantly API key is missing", INSTANTLY);
    this.apiKey = opts.apiKey.trim();
    this.baseUrl = (opts.baseUrl ?? INSTANTLY_API_BASE).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = opts.sleep ?? realSleep;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = Math.max(0, opts.maxRetries ?? 4);
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.backoffMaxMs = opts.backoffMaxMs ?? 20_000;
    this.random = opts.random ?? Math.random;
  }

  get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>("GET", path, { query });
  }
  post<T>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("POST", path, { ...opts, body });
  }
  patch<T>(path: string, body: unknown, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("PATCH", path, { ...opts, body });
  }
  delete<T>(path: string, opts: Omit<RequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("DELETE", path, opts);
  }

  /** Walks a cursor-paginated GET list (`items` + `next_starting_after`). */
  async *paginate<T>(path: string, query: Record<string, QueryValue> = {}, opts: { pageSize?: number; maxPages?: number } = {}): AsyncGenerator<T> {
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 100));
    const maxPages = opts.maxPages ?? 20;
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.get<Page<T> | undefined>(path, { ...query, limit: pageSize, starting_after: cursor });
      const items = Array.isArray(res?.items) ? res.items : [];
      for (const item of items) yield item;
      const next = res?.next_starting_after ?? undefined;
      if (!next || items.length === 0 || next === cursor) return;
      cursor = next;
    }
  }

  async request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.url(path, opts.query);
    const idempotent = opts.idempotent ?? method !== "POST";
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const what = `Instantly ${method} ${path}`;

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let status: number;
      let text: string;
      let retryAfter: string | null = null;
      try {
        const res = await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
        status = res.status;
        retryAfter = res.headers.get("retry-after");
        text = await res.text();
      } catch (e) {
        const timedOut = controller.signal.aborted;
        const err = new ProviderError(
          timedOut ? `${what} timed out after ${this.timeoutMs}ms` : `${what} failed: ${e instanceof Error ? e.message : String(e)}`,
          INSTANTLY,
          undefined,
          true,
        );
        if (idempotent && attempt < this.maxRetries) {
          await this.sleep(this.retryDelay(attempt));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }

      if (status >= 200 && status < 300) {
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new ProviderError(`${what} returned a body that is not JSON`, INSTANTLY, status);
        }
      }

      const retryable = status === 429 || status >= 500;
      const err = new ProviderError(`${what} → ${status}: ${errorMessage(text)}`, INSTANTLY, status, retryable);
      const mayRetry = status === 429 || (retryable && idempotent);
      if (mayRetry && attempt < this.maxRetries) {
        await this.sleep(this.retryDelay(attempt, retryAfter));
        continue;
      }
      throw err;
    }
  }

  /** Wait before retry number `attempt` (0-based): the server's Retry-After if given, else exponential with equal jitter. */
  retryDelay(attempt: number, retryAfter?: string | null): number {
    const fromHeader = parseRetryAfter(retryAfter);
    if (fromHeader !== undefined) return Math.min(fromHeader, this.backoffMaxMs * 3);
    const exp = Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** attempt);
    return Math.round(exp / 2 + this.random() * (exp / 2));
  }

  private url(path: string, query?: Record<string, QueryValue>): string {
    const u = new URL(this.baseUrl + (path.startsWith("/") ? path : `/${path}`));
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    }
    return u.toString();
  }
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

function errorMessage(text: string): string {
  if (!text) return "no response body";
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
    const msg = typeof parsed.message === "string" ? parsed.message : typeof parsed.error === "string" ? parsed.error : text;
    return msg.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}
