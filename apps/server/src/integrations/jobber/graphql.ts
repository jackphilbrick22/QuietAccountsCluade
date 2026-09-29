/**
 * Jobber GraphQL transport: auth header, version header, token refresh, rate limiting, retries, paging.
 *
 * VERIFIED (read 2026-09-29):
 * - Endpoint POST https://api.getjobber.com/api/graphql, JSON only, `Authorization: Bearer <token>`.
 *   https://developer.getjobber.com/docs/using_jobbers_api/api_queries_and_mutations
 * - `X-JOBBER-GRAPHQL-VERSION` header is required on every request; versions are dates. The newest
 *   active version in the changelog is 2026-09-25 (its only breaking change removes
 *   NoteAttachmentAttributes.signedBlobId, which we don't use). Responses carry
 *   `extensions.versioning.warning` when a version nears end of support — we surface it.
 *   https://developer.getjobber.com/docs/using_jobbers_api/api_versioning
 *   https://developer.getjobber.com/docs/changelog
 * - Rate limits: 2,500 requests / 5 min per app+account (HTTP 429), plus a query-cost leaky bucket
 *   (maximumAvailable 10,000, restoreRate 500/s) reported in `extensions.cost` as
 *   { requestedQueryCost, actualQueryCost, throttleStatus { maximumAvailable, currentlyAvailable, restoreRate } }.
 *   A query whose requestedQueryCost exceeds currentlyAvailable gets
 *   `errors[].extensions.code === "THROTTLED"` (HTTP 200). Cost rules: every field costs 1 except
 *   edges/nodes/node (0); a connection costs first|last × its selection (100 when neither is given).
 *   https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits
 * - An expired/invalid access token answers HTTP 401 (live probe: `{"message":"Token not recognized"}`);
 *   access tokens live 60 minutes. https://developer.getjobber.com/docs/building_your_app/app_authorization
 * - A request without a token gets HTTP 200 with `errors[].extensions.code === "UNAUTHENTICATED"` (live probe),
 *   so that code is treated like a 401.
 * - Relay paging: `first`/`after` args, `pageInfo { hasNextPage endCursor }`, `nodes`.
 *
 * ASSUMED:
 * - Backoff schedule (1s, 2s, 4s, 8s, 16s; capped 30s; Retry-After honored when present) is ours, not Jobber's.
 * - The pre-flight cost estimate is our own parser of the documented rules; after the first response we use the
 *   server's own `requestedQueryCost` for that query name, which is exact for later pages of the same query.
 */
import type { Fetch, OAuthTokens } from "../../contracts.ts";
import { ProviderError } from "../../contracts.ts";

export const JOBBER_GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
/** Newest active version in https://developer.getjobber.com/docs/changelog as of 2026-09-29. Change only after reading the changelog. */
export const JOBBER_GRAPHQL_VERSION = "2026-09-25";
/** Documented bucket defaults (used until the first response reports the real numbers). */
export const JOBBER_MAX_COST = 10_000;
export const JOBBER_RESTORE_RATE = 500;
export const MAX_RETRIES = 5;

export interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export interface QueryCostInfo {
  requestedQueryCost?: number;
  actualQueryCost?: number;
  throttleStatus?: ThrottleStatus;
}

export interface GraphQLErrorItem {
  message: string;
  path?: (string | number)[];
  extensions?: { code?: string; [k: string]: unknown };
}

export interface JobberClientOptions {
  tokens: OAuthTokens;
  fetch?: Fetch;
  version?: string;
  /** Called with the new tokens whenever the client refreshes. Persist them: Jobber rotates refresh tokens. */
  onTokens?: (next: OAuthTokens, prev: OAuthTokens) => void | Promise<void>;
  /** The connector's refresh(). Without it a 401 is fatal. */
  refresh?: (tokens: OAuthTokens) => Promise<OAuthTokens>;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  url?: string;
  maxRetries?: number;
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor?: string | null;
}

export interface Connection<T> {
  nodes: T[];
  pageInfo: PageInfo;
}

export interface Page<T> {
  nodes: T[];
  pageInfo: PageInfo;
  /** 1-based page number. */
  page: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class JobberClient {
  private _tokens: OAuthTokens;
  private readonly fetch: Fetch;
  private readonly version: string;
  private readonly onTokens?: JobberClientOptions["onTokens"];
  private readonly refreshFn?: JobberClientOptions["refresh"];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly url: string;
  private readonly maxRetries: number;
  private refreshing?: Promise<OAuthTokens>;
  /** Last bucket reading and when we saw it. */
  private throttle?: ThrottleStatus & { at: number };
  /** Server-reported requestedQueryCost per query name (exact for the next page of the same query). */
  private readonly knownCost = new Map<string, number>();
  /** Deprecation warnings Jobber attached to responses (extensions.versioning.warning). */
  readonly versionWarnings = new Set<string>();
  /** Every wait the client did for rate limiting, in ms (for logs/tests). */
  readonly waits: { ms: number; reason: string }[] = [];
  lastCost?: QueryCostInfo;
  requests = 0;

  constructor(opts: JobberClientOptions) {
    this._tokens = opts.tokens;
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.version = opts.version ?? JOBBER_GRAPHQL_VERSION;
    this.onTokens = opts.onTokens;
    this.refreshFn = opts.refresh;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
    this.url = opts.url ?? JOBBER_GRAPHQL_URL;
    this.maxRetries = opts.maxRetries ?? MAX_RETRIES;
  }

  /** Current tokens (changes after a refresh). */
  get tokens(): OAuthTokens {
    return this._tokens;
  }

  /** True once this client has refreshed at least once. */
  refreshed = false;

  /**
   * Run one GraphQL operation and return `data`. `queryName` keys the cost cache (use one name per document).
   * Throws ProviderError on GraphQL errors, exhausted retries, or auth failure.
   */
  async query<T>(queryName: string, query: string, variables: Record<string, unknown> = {}, opts: { cost?: number } = {}): Promise<T> {
    const cost = opts.cost ?? this.knownCost.get(queryName) ?? estimateQueryCost(query, variables);
    const max = this.throttle?.maximumAvailable ?? JOBBER_MAX_COST;
    if (cost > max) {
      throw new ProviderError(`Jobber query ${queryName} would cost ${cost} points; the most any query may cost is ${max}. Use a smaller page size.`, "jobber", undefined, false);
    }
    await this.maybeRefreshBeforeExpiry();

    let didAuthRetry = false;
    let attempt = 0;
    for (;;) {
      await this.waitForBudget(cost, queryName);
      let res: Response;
      try {
        this.requests++;
        res = await this.fetch(this.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${this._tokens.accessToken}`,
            "X-JOBBER-GRAPHQL-VERSION": this.version,
          },
          body: JSON.stringify({ query, variables, operationName: operationName(query) }),
        });
      } catch (err) {
        // network failure: retry with backoff
        if (attempt >= this.maxRetries) throw new ProviderError(`Jobber unreachable after ${attempt + 1} tries: ${errMsg(err)}`, "jobber", undefined, true);
        await this.backoff(attempt++, `network error: ${errMsg(err)}`);
        continue;
      }

      if (res.status === 401) {
        if (!didAuthRetry && this.refreshFn) {
          didAuthRetry = true;
          await this.forceRefresh();
          continue;
        }
        throw new ProviderError("Jobber rejected the access token (401). The owner needs to reconnect Jobber.", "jobber", 401, false);
      }
      if (res.status === 429) {
        if (attempt >= this.maxRetries) throw new ProviderError("Jobber request limit (2,500 requests / 5 min) still exceeded after retries.", "jobber", 429, true);
        await this.backoff(attempt++, "HTTP 429", retryAfterMs(res));
        continue;
      }
      if (res.status >= 500) {
        if (attempt >= this.maxRetries) throw new ProviderError(`Jobber server error ${res.status} after ${attempt + 1} tries.`, "jobber", res.status, true);
        await this.backoff(attempt++, `HTTP ${res.status}`, retryAfterMs(res));
        continue;
      }

      const text = await res.text();
      let body: { data?: T | null; errors?: GraphQLErrorItem[]; extensions?: { cost?: QueryCostInfo; versioning?: { version?: string; warning?: string } } };
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        throw new ProviderError(`Jobber returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`, "jobber", res.status, res.status >= 500);
      }
      if (!res.ok) {
        const msg = body.errors?.map((e) => e.message).join("; ") || (body as { message?: string }).message || text.slice(0, 200);
        throw new ProviderError(`Jobber HTTP ${res.status}: ${msg}`, "jobber", res.status, false);
      }

      this.readExtensions(queryName, body.extensions);

      const errors = body.errors ?? [];
      if (errors.some((e) => e.extensions?.code === "THROTTLED")) {
        if (attempt >= this.maxRetries) throw new ProviderError(`Jobber kept throttling ${queryName} after ${this.maxRetries} retries.`, "jobber", 429, true);
        const c = body.extensions?.cost;
        const ts = c?.throttleStatus;
        const deficit = ts && c?.requestedQueryCost !== undefined ? c.requestedQueryCost - ts.currentlyAvailable : 0;
        const wait = ts && deficit > 0 ? Math.ceil((deficit / Math.max(1, ts.restoreRate)) * 1000) : undefined;
        await this.backoff(attempt++, "THROTTLED", wait);
        continue;
      }
      if (errors.some((e) => e.extensions?.code === "UNAUTHENTICATED")) {
        if (!didAuthRetry && this.refreshFn) {
          didAuthRetry = true;
          await this.forceRefresh();
          continue;
        }
        throw new ProviderError(`Jobber says the app is not authenticated: ${errors.map((e) => e.message).join("; ")}`, "jobber", 401, false);
      }
      if (errors.length) {
        throw new ProviderError(`Jobber GraphQL error in ${queryName}: ${errors.map((e) => e.message + (e.path ? ` (at ${e.path.join(".")})` : "")).join("; ")}`, "jobber", res.status, false);
      }
      if (body.data == null) throw new ProviderError(`Jobber returned no data for ${queryName}.`, "jobber", res.status, false);
      return body.data;
    }
  }

  /**
   * Page through a Relay connection. Yields one page at a time; stop early with `break`.
   * `selectConnection` picks the connection out of `data` (e.g. d => d.quotes).
   * The query must declare `$first: Int` and `$after: String` and pass them to the connection.
   */
  async *paginate<TNode, TData = unknown>(
    queryName: string,
    query: string,
    variables: Record<string, unknown>,
    selectConnection: (data: TData) => Connection<TNode> | null | undefined,
    opts: { maxPages?: number } = {},
  ): AsyncGenerator<Page<TNode>, void, void> {
    let after: string | null | undefined = (variables.after as string | undefined) ?? null;
    let page = 0;
    const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
    while (page < maxPages) {
      const data = await this.query<TData>(queryName, query, { ...variables, after });
      const conn = selectConnection(data);
      if (!conn) throw new ProviderError(`Jobber response for ${queryName} had no connection.`, "jobber", undefined, false);
      page++;
      yield { nodes: conn.nodes ?? [], pageInfo: conn.pageInfo, page };
      if (!conn.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) return;
      after = conn.pageInfo.endCursor;
    }
  }

  /* ------------------------------ internals ------------------------------ */

  private readExtensions(queryName: string, ext: { cost?: QueryCostInfo; versioning?: { warning?: string } } | undefined) {
    if (ext?.versioning?.warning) this.versionWarnings.add(ext.versioning.warning);
    const c = ext?.cost;
    if (!c) return;
    this.lastCost = c;
    if (typeof c.requestedQueryCost === "number" && c.requestedQueryCost > 0) this.knownCost.set(queryName, c.requestedQueryCost);
    const ts = c.throttleStatus;
    if (ts && isNum(ts.currentlyAvailable) && isNum(ts.maximumAvailable) && isNum(ts.restoreRate)) {
      this.throttle = { maximumAvailable: ts.maximumAvailable, currentlyAvailable: ts.currentlyAvailable, restoreRate: ts.restoreRate, at: this.now() };
    }
  }

  /** Leaky bucket: if the points we expect to have now are short of `cost`, sleep for the deficit / restoreRate. */
  private async waitForBudget(cost: number, queryName: string) {
    const t = this.throttle;
    if (!t) return;
    const elapsedSec = Math.max(0, (this.now() - t.at) / 1000);
    const available = Math.min(t.maximumAvailable, t.currentlyAvailable + elapsedSec * t.restoreRate);
    if (available >= cost) return;
    const ms = Math.ceil(((cost - available) / Math.max(1, t.restoreRate)) * 1000);
    this.waits.push({ ms, reason: `budget for ${queryName}: need ${cost}, have ~${Math.floor(available)}` });
    await this.sleep(ms);
  }

  private async backoff(attempt: number, reason: string, hintMs?: number) {
    const ms = Math.min(30_000, Math.max(hintMs ?? 0, 1000 * 2 ** attempt));
    this.waits.push({ ms, reason });
    await this.sleep(ms);
  }

  private async maybeRefreshBeforeExpiry() {
    if (!this.refreshFn || !this._tokens.expiresAt || !this._tokens.refreshToken) return;
    const exp = Date.parse(this._tokens.expiresAt);
    if (Number.isFinite(exp) && exp - this.now() < 60_000) await this.forceRefresh();
  }

  /** One refresh at a time: concurrent callers share the same promise (Jobber rotates refresh tokens). */
  private async forceRefresh(): Promise<void> {
    if (!this.refreshFn) return;
    if (!this.refreshing) {
      const prev = this._tokens;
      this.refreshing = (async () => {
        const next = await this.refreshFn!(prev);
        this._tokens = next;
        this.refreshed = true;
        await this.onTokens?.(next, prev);
        return next;
      })().finally(() => {
        this.refreshing = undefined;
      });
    }
    await this.refreshing;
  }
}

/* ------------------------------------------------------------------ */
/* Query cost estimate (Jobber's documented rules)                     */
/* ------------------------------------------------------------------ */

const CONNECTION_DEFAULT = 100;

/**
 * Estimate requestedQueryCost for a document using the documented rules:
 * scalar/object field = 1 (+ its selection); edges/nodes/node = 0; a connection (a field taking
 * first/last, or selecting nodes/edges) = (first ?? last ?? 100) × its selection.
 * Matches the docs' examples (7 for a single quote with client, 50 for quotes(first: 10) with 5 fields, 500 without first).
 * Conservative: pageInfo/totalCount inside a connection are multiplied too.
 */
export function estimateQueryCost(query: string, variables: Record<string, unknown> = {}): number {
  const tokens = tokenize(query);
  let i = 0;
  // skip the operation header up to its first top-level selection set
  let paren = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === "(") paren++;
    else if (t === ")") paren--;
    else if (t === "{" && paren === 0) break;
    i++;
  }
  if (i >= tokens.length) return 0;

  const parseArgs = (): Record<string, unknown> => {
    // tokens[i] === "("
    const out: Record<string, unknown> = {};
    let depth = 0;
    let key: string | undefined;
    for (; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t === "(" || t === "{" || t === "[") {
        depth++;
        continue;
      }
      if (t === ")" || t === "}" || t === "]") {
        depth--;
        if (depth === 0) {
          i++;
          return out;
        }
        continue;
      }
      if (depth !== 1) continue;
      if (tokens[i + 1] === ":" && /^[A-Za-z_]/.test(t)) {
        key = t;
        i++; // skip ':'
        continue;
      }
      if (key) {
        out[key] = t.startsWith("$") ? variables[t.slice(1)] : /^-?\d+$/.test(t) ? Number(t) : t;
        key = undefined;
      }
    }
    return out;
  };

  const parseSelection = (): { cost: number; names: Set<string> } => {
    // tokens[i] === "{"
    i++;
    let cost = 0;
    const names = new Set<string>();
    while (i < tokens.length && tokens[i] !== "}") {
      const t = tokens[i]!;
      if (t === "...") {
        i++;
        if (tokens[i] === "on") i += 2;
        else if (tokens[i] !== "{") {
          i++; // named fragment spread: unknown cost
          continue;
        }
        if (tokens[i] === "{") {
          const s = parseSelection();
          cost += s.cost;
          for (const n of s.names) names.add(n);
        }
        continue;
      }
      let name = t;
      i++;
      if (tokens[i] === ":") {
        name = tokens[i + 1]!;
        i += 2;
      }
      names.add(name);
      let args: Record<string, unknown> = {};
      if (tokens[i] === "(") args = parseArgs();
      while (tokens[i] === "@") {
        i += 2;
        if (tokens[i] === "(") parseArgs();
      }
      let child = { cost: 0, names: new Set<string>() };
      if (tokens[i] === "{") child = parseSelection();
      if (name === "nodes" || name === "edges" || name === "node") {
        cost += child.cost;
      } else if ("first" in args || "last" in args || child.names.has("nodes") || child.names.has("edges")) {
        const n = Number(args.first ?? args.last ?? CONNECTION_DEFAULT) || CONNECTION_DEFAULT;
        cost += n * child.cost;
      } else {
        cost += 1 + child.cost;
      }
    }
    i++; // "}"
    return { cost, names };
  };

  return parseSelection().cost;
}

function tokenize(src: string): string[] {
  const clean = src.replace(/#[^\n]*/g, "");
  return clean.match(/"(?:[^"\\]|\\.)*"|\.\.\.|\$?[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?|[{}()[\]:!=,@]/g)?.filter((t) => t !== ",") ?? [];
}

function operationName(query: string): string | undefined {
  return query.match(/^\s*(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/m)?.[1];
}

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return secs * 1000;
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
