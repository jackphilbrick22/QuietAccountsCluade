/**
 * Jobber FsmConnector: OAuth, full/incremental pull, webhooks, notes.
 *
 * VERIFIED (read 2026-09-29):
 * - OAuth 2.0 authorization-code grant. Authorize: https://api.getjobber.com/api/oauth/authorize
 *   ?response_type=code&client_id=&redirect_uri=&state=. Token: POST https://api.getjobber.com/api/oauth/token,
 *   application/x-www-form-urlencoded, client_id + client_secret + grant_type=authorization_code + code + redirect_uri;
 *   refresh with grant_type=refresh_token + refresh_token. Response: { access_token, refresh_token } and, on refresh,
 *   `expires_at` like "2024-04-09 21:04:31 UTC" (plus an optional `warning`). Access tokens are JWTs whose payload
 *   `exp` is the expiry; default lifetime 60 minutes. Docs recommend calling `account { id name }` right after connecting.
 *   https://developer.getjobber.com/docs/building_your_app/app_authorization
 * - Refresh-token rotation is ON by default (required for the App Marketplace): every refresh returns a NEW refresh
 *   token, the old one dies, and the same refresh token must never be redeemed twice. So refreshed tokens are handed
 *   to `onTokens` (persist them!) and also returned on the pull result as `tokens`.
 *   https://developer.getjobber.com/docs/building_your_app/refresh_token_rotation
 * - Webhooks: POST, JSON for apps created after 2022-04-11, body
 *   { data: { webHookEvent: { topic, appId, accountId, itemId, occurredAt } } } ("occuredAt" for apps created before
 *   2023-12-08 — the introspected WebHookPayload type still spells it that way, so both are accepted).
 *   Signature: header X-Jobber-Hmac-SHA256 = base64(HMAC-SHA256(key = OAuth client secret, raw body)).
 *   Deliveries are at-least-once and must be answered within 1 second (process asynchronously).
 *   https://developer.getjobber.com/docs/using_jobbers_api/setting_up_webhooks
 * - Topics (WebHookTopicEnum, introspected): see JOBBER_WEBHOOK_TOPICS below.
 * - Incremental filters: clients/quotes/invoices/requests(filter: { updatedAt: { after } }); jobs has no updatedAt
 *   filter, so incremental job pulls sort UPDATED_AT DESCENDING and stop at `since` (same approach as the amp-labs
 *   production connector, github.com/amp-labs/connectors providers/jobber/README.md).
 *
 * ASSUMED:
 * - `maxPages` caps pages PER RESOURCE (default 400 = 20,000 records each). If any resource is cut short, nextSince
 *   stays at the previous `since` so nothing is skipped, and a warning says so.
 * - nextSince = max updatedAt seen, but never later than (pull start − 5 min), so records edited while the pull was
 *   running are re-read next time instead of being skipped. Re-reading is harmless (records upsert by id).
 * - Note mutations (quoteCreateNote / clientCreateNote) are verified against the schema only, not a live account.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Customer, Invoice, Job, Quote, ServiceRequest } from "@qa/engine";
import type { Fetch, FsmConnector, OAuthTokens, PulledRecords } from "../../contracts.ts";
import { ProviderError } from "../../contracts.ts";
import { JobberClient, type Connection } from "./graphql.ts";
import { customerRef, FOLLOW_UPS_OFF_TAG, mapClient, mapClientRef, mapInvoice, mapJob, mapQuote, mapRequest } from "./map.ts";
import {
  ACCOUNT_QUERY,
  CLIENTS_QUERY,
  INVOICES_QUERY,
  JOBS_QUERY,
  NOTE_MUTATIONS,
  PAGE_SIZE,
  QUOTE_BY_NUMBER_QUERY,
  QUOTE_PAGE_SIZE,
  QUOTES_QUERY,
  REQUESTS_QUERY,
  type ApiClient,
  type ApiClientRef,
  type ApiInvoice,
  type ApiJob,
  type ApiQuote,
  type ApiRequest,
} from "./queries.ts";

export const JOBBER_AUTHORIZE_URL = "https://api.getjobber.com/api/oauth/authorize";
export const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
export const JOBBER_SIGNATURE_HEADER = "X-Jobber-Hmac-SHA256";
/** Documented default access-token lifetime, used only when neither the response nor the JWT says. */
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_MAX_PAGES = 400;
/** Records edited this close to the pull start are re-read next time. */
const WATERMARK_SAFETY_MS = 5 * 60 * 1000;

/** WebHookTopicEnum values that matter to Quiet Accounts (introspected; the enum has more). */
export const JOBBER_WEBHOOK_TOPICS = [
  "APP_CONNECT",
  "APP_DISCONNECT",
  "CLIENT_CREATE",
  "CLIENT_UPDATE",
  "CLIENT_DESTROY",
  "QUOTE_CREATE",
  "QUOTE_UPDATE",
  "QUOTE_SENT",
  "QUOTE_APPROVED",
  "QUOTE_DESTROY",
  "JOB_CREATE",
  "JOB_UPDATE",
  "JOB_CLOSED",
  "JOB_DESTROY",
  "INVOICE_CREATE",
  "INVOICE_UPDATE",
  "INVOICE_DESTROY",
  "REQUEST_CREATE",
  "REQUEST_UPDATE",
  "REQUEST_DESTROY",
  "VISIT_COMPLETE",
] as const;

export interface JobberConnectorOptions {
  clientId: string;
  clientSecret: string;
  fetch?: Fetch;
  version?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /**
   * Called whenever tokens are refreshed mid-call (pull, writeNote). MUST persist them: with refresh-token rotation
   * the previous refresh token is dead the moment a new one is issued. `prev.accountId` identifies the account.
   */
  onTokens?: (next: OAuthTokens, prev: OAuthTokens) => void | Promise<void>;
  /**
   * What else to read besides clients and quotes. The listed app asks only for read access to clients and quotes,
   * so the default is nothing more; jobs, invoices and requests are read only when the app's scopes allow it.
   * A resource Jobber refuses is skipped with a warning; it never fails the sync or looks like a dead connection.
   */
  read?: JobberExtra[];
}

export type JobberExtra = "jobs" | "invoices" | "requests";
export const JOBBER_EXTRAS: JobberExtra[] = ["jobs", "invoices", "requests"];

export interface JobberPullStats {
  pages: number;
  requests: number;
  waitedMs: number;
  counts: { customers: number; quotes: number; jobs: number; invoices: number; requests: number };
}

export interface JobberPulledRecords extends PulledRecords {
  /** Present when the access token was refreshed during the pull — save these. */
  tokens?: OAuthTokens;
  stats: JobberPullStats;
}

export interface JobberConnector extends FsmConnector {
  source: "jobber";
  pull(tokens: OAuthTokens, opts: { since?: string; maxPages?: number; onProgress?: (msg: string) => void }): Promise<JobberPulledRecords>;
  /** A GraphQL client bound to these tokens (auto-refresh, throttling) for one-off reads. */
  client(tokens: OAuthTokens): JobberClient;
}

export function createJobberConnector(opts: JobberConnectorOptions): JobberConnector {
  const doFetch: Fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const now = opts.now ?? Date.now;

  async function tokenRequest(params: Record<string, string>): Promise<OAuthTokens> {
    const body = new URLSearchParams({ client_id: opts.clientId, client_secret: opts.clientSecret, ...params });
    let res: Response;
    try {
      res = await doFetch(JOBBER_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: body.toString(),
      });
    } catch (err) {
      throw new ProviderError(`Could not reach Jobber to get tokens: ${err instanceof Error ? err.message : String(err)}`, "jobber", undefined, true);
    }
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      const why = String(json.error_description ?? json.error ?? json.message ?? text.slice(0, 200) ?? "");
      throw new ProviderError(`Jobber token request failed (${res.status})${why ? `: ${why}` : ""}`, "jobber", res.status, res.status >= 500 || res.status === 429);
    }
    const accessToken = typeof json.access_token === "string" ? json.access_token : "";
    if (!accessToken) throw new ProviderError("Jobber token response had no access_token.", "jobber", res.status, false);
    const tokens: OAuthTokens = { accessToken };
    if (typeof json.refresh_token === "string" && json.refresh_token) tokens.refreshToken = json.refresh_token;
    tokens.expiresAt = tokenExpiry(json, accessToken, now());
    if (typeof json.scope === "string" && json.scope) tokens.scope = json.scope;
    return tokens;
  }

  const connector: JobberConnector = {
    source: "jobber",

    authorizeUrl(state: string, redirectUri: string): string {
      const q = new URLSearchParams({ response_type: "code", client_id: opts.clientId, redirect_uri: redirectUri, state });
      return `${JOBBER_AUTHORIZE_URL}?${q.toString()}`;
    },

    async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
      const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
      // Docs: collect the account id/name right away (it's how later webhooks and disconnects are matched).
      // A failure here must not lose the tokens — the code is single-use — so it's best-effort.
      try {
        const data = await connector.client(tokens).query<{ account: { id: string; name: string } | null }>("QaAccount", ACCOUNT_QUERY);
        if (data.account?.id) tokens.accountId = data.account.id;
        if (data.account?.name) tokens.accountName = data.account.name;
      } catch {
        /* accountId stays empty; the caller can look it up later with client(tokens) */
      }
      return tokens;
    },

    async refresh(tokens: OAuthTokens): Promise<OAuthTokens> {
      if (!tokens.refreshToken) throw new ProviderError("No Jobber refresh token on file; the owner needs to reconnect Jobber.", "jobber", 401, false);
      const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refreshToken });
      return {
        ...tokens,
        accessToken: fresh.accessToken,
        // rotation ON: a new one every time; OFF: the same one comes back
        refreshToken: fresh.refreshToken ?? tokens.refreshToken,
        expiresAt: fresh.expiresAt,
        ...(fresh.scope ? { scope: fresh.scope } : {}),
      };
    },

    client(tokens: OAuthTokens): JobberClient {
      return new JobberClient({
        tokens,
        fetch: doFetch,
        version: opts.version,
        sleep: opts.sleep,
        now,
        refresh: (t) => connector.refresh(t),
        onTokens: opts.onTokens,
      });
    },

    async pull(tokens, pullOpts): Promise<JobberPulledRecords> {
      const since = pullOpts.since;
      const sinceMs = since ? Date.parse(since) : undefined;
      if (since && !Number.isFinite(sinceMs)) throw new ProviderError(`Bad "since" for Jobber pull: ${since}`, "jobber", undefined, false);
      const maxPages = Math.max(1, pullOpts.maxPages ?? DEFAULT_MAX_PAGES);
      const progress = pullOpts.onProgress ?? (() => {});
      const startedAt = now();

      const client = connector.client(tokens);
      const warnings: string[] = [];
      const warn = (m: string) => {
        if (!warnings.includes(m)) warnings.push(m);
      };
      const customers = new Map<string, Customer>();
      const clientRefs = new Map<string, ApiClientRef>();
      const quotes: Quote[] = [];
      const jobs: Job[] = [];
      const invoices: Invoice[] = [];
      const requests: ServiceRequest[] = [];
      let maxUpdated = Number.NEGATIVE_INFINITY;
      let truncated = false;
      let pages = 0;
      const seen = (updatedAt: string | null | undefined) => {
        const t = updatedAt ? Date.parse(updatedAt) : Number.NaN;
        if (Number.isFinite(t) && t > maxUpdated) maxUpdated = t;
      };
      const noteRef = (c: ApiClientRef | null | undefined) => {
        if (c?.id && !clientRefs.has(c.id)) clientRefs.set(c.id, c);
      };
      const updatedFilter = since ? { updatedAt: { after: since } } : undefined;

      /** Page one resource, feeding each node to `take`. `take` returns false to stop early (jobs, newest-first). */
      async function walk<TNode, TData>(
        label: string,
        name: string,
        query: string,
        variables: Record<string, unknown>,
        select: (d: TData) => Connection<TNode> | null | undefined,
        take: (node: TNode) => boolean | void,
      ) {
        let count = 0;
        let stopped = false;
        let lastHasNext = false;
        for await (const page of client.paginate<TNode, TData>(name, query, variables, select, { maxPages })) {
          pages++;
          for (const node of page.nodes) {
            if (take(node) === false) {
              stopped = true;
              break;
            }
            count++;
          }
          lastHasNext = page.pageInfo.hasNextPage;
          progress(`Jobber: ${label} — page ${page.page}, ${count.toLocaleString("en-US")} so far`);
          if (stopped) break;
        }
        if (!stopped && lastHasNext) {
          truncated = true;
          warn(`Stopped reading Jobber ${label} after ${maxPages} pages (maxPages); the rest will be read on the next sync.`);
        }
        return count;
      }

      progress(since ? `Jobber: reading changes since ${since}` : "Jobber: reading everything (first sync)");

      const extras = new Set(opts.read ?? []);
      /** Read an optional resource; if this app isn't allowed to see it, say so and carry on. */
      async function optional(label: JobberExtra, run: () => Promise<unknown>) {
        if (!extras.has(label)) return;
        try {
          await run();
        } catch (err) {
          if (!(err instanceof ProviderError) || err.retryable || err.status === 401 || !/GraphQL error/.test(err.message)) throw err;
          warn(`Jobber didn't share ${label} with this app, so they were skipped: ${err.message.slice(0, 160)}`);
        }
      }

      await walk<ApiClient, { clients: Connection<ApiClient> }>("clients", "QaClients", CLIENTS_QUERY, { first: PAGE_SIZE, filter: updatedFilter }, (d) => d.clients, (c) => {
        seen(c.updatedAt);
        customers.set(customerRef(c.id), mapClient(c));
      });

      await walk<ApiQuote, { quotes: Connection<ApiQuote> }>("quotes", "QaQuotes", QUOTES_QUERY, { first: QUOTE_PAGE_SIZE, filter: updatedFilter }, (d) => d.quotes, (q) => {
        seen(q.updatedAt);
        noteRef(q.client);
        const m = mapQuote(q, warn);
        if (m) quotes.push(m);
      });

      await optional("jobs", () =>
        walk<ApiJob, { jobs: Connection<ApiJob> }>(
          "jobs",
          "QaJobs",
          JOBS_QUERY,
          // jobs can't be filtered by updatedAt: newest-first and stop at `since`
          { first: PAGE_SIZE, sort: sinceMs !== undefined ? [{ key: "UPDATED_AT", direction: "DESCENDING" }] : undefined },
          (d) => d.jobs,
          (j) => {
            const t = j.updatedAt ? Date.parse(j.updatedAt) : Number.NaN;
            if (sinceMs !== undefined && Number.isFinite(t) && t < sinceMs) return false;
            seen(j.updatedAt);
            noteRef(j.client);
            const m = mapJob(j, warn);
            if (m) jobs.push(m);
          },
        ),
      );

      await optional("invoices", () =>
        walk<ApiInvoice, { invoices: Connection<ApiInvoice> }>("invoices", "QaInvoices", INVOICES_QUERY, { first: PAGE_SIZE, filter: updatedFilter }, (d) => d.invoices, (inv) => {
          seen(inv.updatedAt);
          noteRef(inv.client);
          const m = mapInvoice(inv, warn);
          if (m) invoices.push(m);
        }),
      );

      await optional("requests", () =>
        walk<ApiRequest, { requests: Connection<ApiRequest> }>("requests", "QaRequests", REQUESTS_QUERY, { first: PAGE_SIZE, filter: updatedFilter }, (d) => d.requests, (r) => {
          seen(r.updatedAt);
          noteRef(r.client);
          const m = mapRequest(r, warn);
          if (m) requests.push(m);
        }),
      );

      // Clients referenced by records but not pulled (unchanged since `since`): add link-only stand-ins.
      for (const [id, ref] of clientRefs) if (!customers.has(customerRef(id))) customers.set(customerRef(id), mapClientRef(ref));

      const full = [...customers.values()].filter((c) => c.tags.length || c.emails.length || c.phones.length);
      const off = full.filter((c) => c.tags.includes(FOLLOW_UPS_OFF_TAG)).length;
      if (full.length >= 20 && off / full.length >= 0.9) {
        warn(`${off} of ${full.length} Jobber clients have follow-ups turned off, so they're marked do-not-contact. If that's an account-wide default rather than the owner's choice per person, review before sending.`);
      }
      for (const w of client.versionWarnings) warn(`Jobber API: ${w}`);

      let nextSince: string | undefined;
      if (truncated) nextSince = since;
      else if (Number.isFinite(maxUpdated)) nextSince = new Date(Math.min(maxUpdated, startedAt - WATERMARK_SAFETY_MS)).toISOString();
      else nextSince = since;
      // never move the watermark backwards
      if (nextSince && since && Date.parse(nextSince) < (sinceMs ?? 0)) nextSince = since;

      const out: JobberPulledRecords = {
        customers: [...customers.values()],
        quotes,
        jobs,
        invoices,
        requests,
        nextSince,
        warnings,
        stats: {
          pages,
          requests: client.requests,
          waitedMs: client.waits.reduce((s, w) => s + w.ms, 0),
          counts: { customers: customers.size, quotes: quotes.length, jobs: jobs.length, invoices: invoices.length, requests: requests.length },
        },
      };
      if (client.refreshed) out.tokens = client.tokens;
      progress(`Jobber: done — ${quotes.length} quotes, ${jobs.length} jobs, ${invoices.length} invoices, ${requests.length} requests, ${customers.size} clients`);
      return out;
    },

    verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean {
      const want = JOBBER_SIGNATURE_HEADER.toLowerCase();
      let sig: string | undefined;
      for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === want && v) sig = v.trim();
      if (!sig) return false;
      const expected = createHmac("sha256", opts.clientSecret).update(rawBody, "utf8").digest();
      let given: Buffer;
      try {
        given = Buffer.from(sig, "base64");
      } catch {
        return false;
      }
      return given.length === expected.length && timingSafeEqual(given, expected);
    },

    parseWebhook(rawBody: string) {
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        return undefined;
      }
      const ev = (json as { data?: { webHookEvent?: Record<string, unknown> } } | null)?.data?.webHookEvent;
      if (!ev || typeof ev !== "object") return undefined;
      const topic = typeof ev.topic === "string" ? ev.topic : "";
      const accountId = typeof ev.accountId === "string" ? ev.accountId : "";
      const itemId = typeof ev.itemId === "string" ? ev.itemId : "";
      const occurredAt = typeof ev.occurredAt === "string" ? ev.occurredAt : typeof ev.occuredAt === "string" ? ev.occuredAt : "";
      if (!topic || !accountId) return undefined;
      return { topic, accountId, itemId, occurredAt };
    },

    async writeNote(tokens, target, text) {
      const client = connector.client(tokens);
      let id = target.sourceId.replace(/^jobber:/, "").trim();
      if (!id) throw new ProviderError("No Jobber id to write the note on.", "jobber", undefined, false);
      if (target.kind === "quote" && /^#?\d+$/.test(id)) {
        // a quote known only by number (CSV import): look up its Jobber id
        const n = Number(id.replace("#", ""));
        const found = await client.query<{ quotes: { nodes: { id: string }[] } }>("QaQuoteByNumber", QUOTE_BY_NUMBER_QUERY, { number: n });
        const qid = found.quotes.nodes[0]?.id;
        if (!qid) throw new ProviderError(`Jobber has no quote #${n}.`, "jobber", 404, false);
        id = qid;
      }
      const kind = target.kind;
      const data = await client.query<Record<string, { userErrors?: { message: string }[] } | null>>(
        kind === "quote" ? "QaQuoteNote" : "QaClientNote",
        NOTE_MUTATIONS[kind],
        { id, message: text },
      );
      const payload = data[kind === "quote" ? "quoteCreateNote" : "clientCreateNote"];
      const errs = payload?.userErrors ?? [];
      if (!payload || errs.length) {
        throw new ProviderError(`Jobber didn't save the note: ${errs.map((e) => e.message).join("; ") || "no response"}`, "jobber", undefined, false);
      }
    },
  };
  return connector;
}

/** Expiry from `expires_at` ("2024-04-09 21:04:31 UTC"), `expires_in`, the JWT's `exp`, else the documented 60 minutes. */
export function tokenExpiry(json: Record<string, unknown>, accessToken: string, nowMs: number): string {
  const ea = json.expires_at;
  if (typeof ea === "string" && ea) {
    let t = Date.parse(ea);
    if (!Number.isFinite(t)) t = Date.parse(ea.trim().replace(/ UTC$/i, "Z").replace(" ", "T"));
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  if (typeof ea === "number" && Number.isFinite(ea)) return new Date(ea * 1000).toISOString();
  const ei = Number(json.expires_in);
  if (Number.isFinite(ei) && ei > 0) return new Date(nowMs + ei * 1000).toISOString();
  const exp = jwtExp(accessToken);
  if (exp) return new Date(exp * 1000).toISOString();
  return new Date(nowMs + DEFAULT_TOKEN_TTL_MS).toISOString();
}

function jwtExp(token: string): number | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}
