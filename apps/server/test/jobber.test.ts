import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BusinessProfile, Dataset } from "@qa/engine";
// Deep imports keep this suite independent of engine modules other engineers are still writing.
import { emptyDataset, ingestFile, mergePulled } from "@qa/engine/ingest/index.ts";
import { makeId } from "@qa/engine/util.ts";
import type { Fetch, OAuthTokens } from "../src/contracts.ts";
import { ProviderError } from "../src/contracts.ts";
import {
  CLIENTS_QUERY,
  createJobberConnector,
  estimateQueryCost,
  FOLLOW_UPS_OFF_TAG,
  INVOICES_QUERY,
  JOBBER_EXTRAS,
  JOBBER_GRAPHQL_URL,
  JOBBER_GRAPHQL_VERSION,
  JOBBER_TOKEN_URL,
  JobberClient,
  JOBS_QUERY,
  mapJobStatus,
  PAGE_COST_BUDGET,
  PAGE_SIZE,
  QUOTE_PAGE_SIZE,
  QUOTES_QUERY,
  REQUESTS_QUERY,
} from "../src/integrations/jobber/index.ts";

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

const CLIENT_ID = "qa-client-id";
const SECRET = "qa-client-secret";
const NOW = Date.parse("2026-09-29T12:00:00Z");

const gid = (type: string, n: number | string) => Buffer.from(`gid://Jobber/${type}/${n}`).toString("base64");
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (exp: number) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ exp, account_id: 1 })}.sig`;

interface Call {
  url: string;
  headers: Record<string, string>;
  form?: URLSearchParams;
  op?: string;
  vars?: Record<string, any>;
  query?: string;
}
interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function mockFetch(handle: (c: Call) => Reply) {
  const calls: Call[] = [];
  const fetch: Fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const call: Call = { url, headers };
    if (url === JOBBER_TOKEN_URL) call.form = new URLSearchParams(String(init?.body ?? ""));
    else {
      const b = JSON.parse(String(init?.body ?? "{}"));
      call.op = b.operationName;
      call.vars = b.variables;
      call.query = b.query;
    }
    calls.push(call);
    const r = handle(call);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", ...r.headers } });
  };
  return { fetch, calls };
}

const cost = (requested = 800, available = 9000) => ({
  cost: { requestedQueryCost: requested, actualQueryCost: 120, throttleStatus: { maximumAvailable: 10000, currentlyAvailable: available, restoreRate: 500 } },
});
const gql = (data: unknown, ext: unknown = cost()) => ({ body: { data, extensions: ext } });
const conn = <T>(nodes: T[], endCursor: string | null = null) => ({ nodes, pageInfo: { hasNextPage: !!endCursor, endCursor } });

function clock() {
  let t = NOW;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

/** Await a promise that must reject; returns the ProviderError it rejected with. */
async function failure(p: Promise<unknown>): Promise<ProviderError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  if (!(e instanceof ProviderError)) throw new Error(`expected a ProviderError, got ${String(e)}`);
  return e;
}

const TOKENS: OAuthTokens = { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: "2026-09-29T13:00:00.000Z", accountId: gid("Account", 77), accountName: "Ridgeline Tree Co" };

const biz: BusinessProfile = {
  id: "b1", name: "Ridgeline Tree Co", trade: "tree", otherTrades: [], software: "unknown", ownerName: "Dave Ridge", ownerFirstName: "Dave",
  signerName: "Sarah", signerRole: "office", timezone: "America/New_York", sendDays: [2, 3, 4], sendWindow: [8, 11], blackoutWeeks: [],
  minQuoteValue: 300, minQuoteAgeDays: 21, maxQuoteAgeMonths: 36, weeklyNewContacts: 50, channels: { email: "live" },
  openCrewWeeks: [], voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] }, persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0.1 },
  plan: { stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [] }, createdOn: "2026-09-01",
};

/* ------------------------------------------------------------------ */
/* Fixtures: what Jobber's API returns (shapes per the live schema)    */
/* ------------------------------------------------------------------ */

const ADDR_OAK = { street1: "14 Oak Ln", street2: "", city: "Concord", province: "NH", postalCode: "03301" };
const ADDR_HILL = { street1: "1 Hillside Common", street2: "Clubhouse", city: "Bow", province: "NH", postalCode: "03304" };
const ADDR_MARCO = { street1: "9 Elm Rd", street2: "", city: "Hopkinton", province: "NH", postalCode: "03229" };

const ref = (id: string, name: string, firstName: string, lastName: string, companyName: string | null = null, isCompany = false) => ({ id, name, firstName, lastName, companyName, isCompany });
const DANA_ID = gid("Client", 1);
const MARCO_ID = gid("Client", 2);
const HILL_ID = gid("Client", 3);
const DANA_REF = ref(DANA_ID, "Dana Whitfield", "Dana", "Whitfield");
const MARCO_REF = ref(MARCO_ID, "Marco Reyes", "Marco", "Reyes");
const HILL_REF = ref(HILL_ID, "Hillside HOA", "Pat", "Moore", "Hillside HOA", true);

const CLIENT_DANA = {
  ...DANA_REF,
  isLead: false,
  isArchived: false,
  createdAt: "2023-04-02T10:15:00-04:00",
  updatedAt: "2026-09-20T09:00:00-04:00",
  receivesFollowUps: true,
  receivesQuoteFollowUps: true,
  emails: [
    { address: "D.Whitfield@Gmail.com", primary: false },
    { address: "Dana@WhitfieldHome.net", primary: true },
  ],
  phones: [
    { number: "603-555-0142", primary: false },
    { number: "(603) 555-0199", primary: true },
  ],
  billingAddress: ADDR_OAK,
  tags: { nodes: [{ label: "Tree" }, { label: "Repeat" }] },
  clientProperties: { nodes: [{ address: ADDR_OAK }, { address: { street1: "200 Lake Shore Dr", street2: "", city: "Gilford", province: "NH", postalCode: "03249" } }] },
};
const CLIENT_MARCO = {
  ...MARCO_REF,
  isLead: true,
  isArchived: false,
  createdAt: "2025-10-30T11:00:00-04:00",
  updatedAt: "2026-06-02T10:00:00-04:00",
  receivesFollowUps: true,
  receivesQuoteFollowUps: false, // the owner switched quote follow-ups off for Marco in Jobber
  emails: [{ address: "marco.reyes@outlook.com", primary: true }],
  phones: [{ number: "+1 603 555 0100", primary: true }],
  billingAddress: { street1: "", street2: "", city: "", province: "", postalCode: "" },
  tags: { nodes: [] },
  clientProperties: { nodes: [{ address: ADDR_MARCO }] },
};
const CLIENT_HILL = {
  ...HILL_REF,
  isLead: false,
  isArchived: false,
  createdAt: "2024-01-15T09:00:00-05:00",
  updatedAt: "2026-07-01T09:00:00-04:00",
  receivesFollowUps: true,
  receivesQuoteFollowUps: true,
  emails: [{ address: "board@hillsidehoa.org", primary: true }],
  // the office line with an extension, and a placeholder someone typed in
  phones: [{ number: "603-224-1234 ext. 12", primary: true }, { number: "555-555-5555", primary: false }],
  billingAddress: ADDR_HILL,
  tags: { nodes: [{ label: "Commercial" }] },
  clientProperties: { nodes: [{ address: ADDR_HILL }] },
};

const line = (name: string, totalPrice: number, extra: Record<string, unknown> = {}) => ({ name, description: "", quantity: 1, unitPrice: totalPrice, totalPrice, optional: false, recommended: null, textOnly: false, ...extra });

const Q1042 = {
  id: gid("Quote", 1042),
  quoteNumber: "1042",
  quoteStatus: "approved",
  title: "Remove dead oak by driveway",
  createdAt: "2026-08-01T09:00:00-04:00",
  updatedAt: "2026-08-20T10:00:00-04:00",
  sentAt: "2026-08-02T08:30:00-04:00",
  clientHubViewedAt: "2026-08-03T19:12:00-04:00",
  transitionedAt: "2026-08-10T12:00:00-04:00",
  lastTransitioned: { approvedAt: "2026-08-10T12:00:00-04:00", changesRequestedAt: null, convertedAt: null },
  amounts: { subtotal: 2150, total: 2150 },
  client: DANA_REF,
  property: { address: ADDR_OAK },
  salesperson: { name: { full: "Dave Ridge" } },
  request: null,
  jobs: { nodes: [] },
  lineItems: {
    nodes: [
      line("Oak removal", 1800, { description: "Dead red oak by the driveway, crane access" }),
      line("Stump grinding", 350, { optional: true, recommended: false }), // offered, customer left it off
      line("Wood chip haul-away", 350, { optional: true, recommended: true }),
      line("Gate code 4411 — call on arrival", 0, { textOnly: true, quantity: 0 }),
    ],
  },
};
const Q1043 = {
  id: gid("Quote", 1043),
  quoteNumber: "1043",
  quoteStatus: "converted",
  title: "Storm cleanup — common area",
  createdAt: "2026-07-01T09:00:00-04:00",
  updatedAt: "2026-07-15T12:00:00-04:00",
  sentAt: "2026-07-02T09:00:00-04:00",
  clientHubViewedAt: null,
  transitionedAt: "2026-07-15T12:00:00-04:00",
  lastTransitioned: { approvedAt: "2026-07-14T08:00:00-04:00", changesRequestedAt: null, convertedAt: "2026-07-15T12:00:00-04:00" },
  amounts: { subtotal: 4800, total: 4800 },
  client: HILL_REF,
  property: { address: ADDR_HILL },
  salesperson: { name: { full: "Dave Ridge" } },
  request: { id: gid("Request", 9) },
  jobs: { nodes: [{ jobNumber: 310 }] },
  lineItems: { nodes: [line("Remove 3 downed limbs", 4800)] },
};
const Q1044 = {
  id: gid("Quote", 1044),
  quoteNumber: "1044",
  quoteStatus: "awaiting_response",
  title: "Hedge trim + mulch",
  createdAt: "2026-05-28T09:00:00-04:00",
  updatedAt: "2026-06-01T10:00:00-04:00",
  sentAt: "2026-06-01T10:00:00-04:00",
  clientHubViewedAt: null,
  transitionedAt: "2026-06-01T10:00:00-04:00",
  lastTransitioned: { approvedAt: null, changesRequestedAt: null, convertedAt: null },
  amounts: { subtotal: 600, total: 600 },
  client: MARCO_REF,
  property: { address: ADDR_MARCO },
  salesperson: null,
  request: null,
  jobs: { nodes: [] },
  lineItems: { nodes: [line("Hedge trim", 600), line("Mulch refresh", 240, { optional: true, recommended: false })] },
};
const Q1045 = {
  id: gid("Quote", 1045),
  quoteNumber: "1045",
  quoteStatus: "archived",
  title: "Two pines over garage",
  createdAt: "2026-02-27T09:00:00-05:00",
  updatedAt: "2026-05-05T08:00:00-04:00",
  sentAt: "2026-03-01T09:00:00-05:00",
  clientHubViewedAt: "2026-03-02T21:00:00-05:00",
  transitionedAt: "2026-05-05T08:00:00-04:00",
  lastTransitioned: { approvedAt: null, changesRequestedAt: null, convertedAt: null },
  amounts: { subtotal: 4850, total: 4850 },
  client: DANA_REF,
  property: { address: ADDR_OAK },
  salesperson: { name: { full: "Dave Ridge" } },
  request: null,
  jobs: { nodes: [] },
  lineItems: { nodes: [line("Remove two white pines", 4850)] },
};

const job = (n: number, client: unknown, jobStatus: string, extra: Record<string, unknown> = {}) => ({
  id: gid("Job", n),
  jobNumber: n,
  title: `Job ${n}`,
  jobStatus,
  jobType: "ONE_OFF",
  createdAt: "2026-07-15T12:05:00-04:00",
  updatedAt: "2026-07-15T12:05:00-04:00",
  startAt: null,
  endAt: null,
  completedAt: null,
  total: 0,
  client,
  quote: null,
  property: null,
  ...extra,
});
const J310 = job(310, HILL_REF, "upcoming", {
  title: "Storm cleanup — common area",
  total: 4800,
  startAt: "2026-10-06T08:00:00-04:00",
  updatedAt: "2026-09-25T16:00:00-04:00", // the newest change anywhere in the account
  quote: { quoteNumber: "1043" },
  property: { address: ADDR_HILL },
});
const J311 = job(311, DANA_REF, "archived", { title: "Spring pruning", total: 900, createdAt: "2025-04-01T09:00:00-04:00", updatedAt: "2025-04-20T15:00:00-04:00", startAt: "2025-04-18T08:00:00-04:00", completedAt: "2025-04-20T15:00:00-04:00" });
const J312 = job(312, MARCO_REF, "action_required", { title: "Lot clearing", total: 3000, createdAt: "2026-03-01T09:00:00-05:00", updatedAt: "2026-04-01T09:00:00-04:00" });
const J313 = job(313, DANA_REF, "active", { title: "Monthly plant health care", jobType: "RECURRING", total: 1200, createdAt: "2026-01-05T09:00:00-05:00", updatedAt: "2026-09-01T09:00:00-04:00", startAt: "2026-01-10T08:00:00-05:00" });

const inv = (n: number, client: unknown, invoiceStatus: string, total: number, balance: number, extra: Record<string, unknown> = {}) => ({
  id: gid("Invoice", n),
  invoiceNumber: String(n),
  subject: `For services rendered`,
  invoiceStatus,
  createdAt: "2026-07-20T09:00:00-04:00",
  updatedAt: "2026-07-20T09:00:00-04:00",
  issuedDate: "2026-07-20T09:00:00-04:00",
  dueDate: "2026-08-19T09:00:00-04:00",
  receivedDate: null,
  amounts: { total, invoiceBalance: balance },
  client,
  jobs: { nodes: [] },
  ...extra,
});
const I5001 = inv(5001, HILL_REF, "sent_not_due", 4800, 4800, { jobs: { nodes: [{ jobNumber: 310 }] }, dueDate: "2026-10-20T00:00:00-04:00" });
const I5002 = inv(5002, DANA_REF, "voided", 250, 0);
const I5003 = inv(5003, DANA_REF, "paid", 900, 0, { jobs: { nodes: [{ jobNumber: 311 }] }, issuedDate: "2025-04-21T09:00:00-04:00", receivedDate: "2025-05-01T10:00:00-04:00" });

const R9 = { id: gid("Request", 9), title: "Storm damage in common area", requestStatus: "converted", createdAt: "2026-06-28T08:00:00-04:00", updatedAt: "2026-07-01T09:00:00-04:00", source: "Phone", assessment: null, client: HILL_REF, property: { address: ADDR_HILL }, quotes: { nodes: [{ quoteNumber: "1043" }] } };
const R10 = { id: gid("Request", 10), title: "Price to take down a leaning maple", requestStatus: "archived", createdAt: "2025-11-02T08:00:00-04:00", updatedAt: "2026-01-02T08:00:00-05:00", source: "Online booking", assessment: null, client: MARCO_REF, property: { address: ADDR_MARCO }, quotes: { nodes: [] } };
const R11 = { id: gid("Request", 11), title: "Look at the birch by the lake house", requestStatus: "needs_approval", createdAt: "2026-09-20T08:00:00-04:00", updatedAt: "2026-09-21T08:00:00-04:00", source: "Client hub", assessment: { startAt: "2026-10-02T13:00:00-04:00", completedAt: null }, client: DANA_REF, property: null, quotes: { nodes: [] } };

/** A two-page Jobber account (clients and quotes span two pages each). */
function fullAccountHandler(c: Call): Reply {
  if (c.url === JOBBER_TOKEN_URL) throw new Error("unexpected token call");
  expect(c.url).toBe(JOBBER_GRAPHQL_URL);
  expect(c.headers["X-JOBBER-GRAPHQL-VERSION"]).toBe(JOBBER_GRAPHQL_VERSION);
  expect(c.headers.Authorization).toBe("Bearer access-1");
  switch (c.op) {
    case "QaClients":
      expect(c.vars!.first).toBe(PAGE_SIZE);
      return c.vars!.after === "cur-c1" ? gql({ clients: conn([CLIENT_MARCO, CLIENT_HILL]) }) : gql({ clients: conn([CLIENT_DANA], "cur-c1") });
    case "QaQuotes":
      expect(c.vars!.first).toBe(QUOTE_PAGE_SIZE);
      return c.vars!.after === "cur-q1" ? gql({ quotes: conn([Q1044, Q1045]) }) : gql({ quotes: conn([Q1042, Q1043], "cur-q1") });
    case "QaJobs":
      return gql({ jobs: conn([J310, J311, J312, J313]) });
    case "QaInvoices":
      return gql({ invoices: conn([I5001, I5002, I5003]) });
    case "QaRequests":
      return gql({ requests: conn([R9, R10, R11]) });
    default:
      throw new Error(`unexpected op ${c.op}`);
  }
}

/* ------------------------------------------------------------------ */
/* OAuth                                                               */
/* ------------------------------------------------------------------ */

describe("Jobber OAuth", () => {
  it("builds the documented authorize URL", () => {
    const c = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET });
    const u = new URL(c.authorizeUrl("signed-state", "https://app.quietaccounts.com/oauth/jobber"));
    expect(`${u.origin}${u.pathname}`).toBe("https://api.getjobber.com/api/oauth/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.quietaccounts.com/oauth/jobber");
    expect(u.searchParams.get("state")).toBe("signed-state");
  });

  it("exchanges a code for tokens (expiry from the JWT) and records the account", async () => {
    const exp = Math.floor(NOW / 1000) + 3600;
    const { fetch, calls } = mockFetch((c) => {
      if (c.url === JOBBER_TOKEN_URL) return { body: { access_token: jwt(exp), refresh_token: "refresh-A" } };
      expect(c.op).toBe("QaAccount");
      expect(c.headers.Authorization).toBe(`Bearer ${jwt(exp)}`);
      expect(c.headers["X-JOBBER-GRAPHQL-VERSION"]).toBe(JOBBER_GRAPHQL_VERSION);
      return gql({ account: { id: gid("Account", 77), name: "Ridgeline Tree Co" } });
    });
    const c = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, now: () => NOW });
    const t = await c.exchangeCode("the-code", "https://app.quietaccounts.com/oauth/jobber");
    expect(calls[0]!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(calls[0]!.form!)).toEqual({
      client_id: CLIENT_ID,
      client_secret: SECRET,
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "https://app.quietaccounts.com/oauth/jobber",
    });
    expect(t).toEqual({
      accessToken: jwt(exp),
      refreshToken: "refresh-A",
      expiresAt: new Date(exp * 1000).toISOString(),
      accountId: gid("Account", 77),
      accountName: "Ridgeline Tree Co",
    });
  });

  it("refreshes with the rotated refresh token and keeps the account", async () => {
    const { fetch, calls } = mockFetch(() => ({ body: { access_token: "access-2", refresh_token: "refresh-2", expires_at: "2026-09-29 13:30:00 UTC" } }));
    const c = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, now: () => NOW });
    const t = await c.refresh(TOKENS);
    expect(Object.fromEntries(calls[0]!.form!)).toEqual({ client_id: CLIENT_ID, client_secret: SECRET, grant_type: "refresh_token", refresh_token: "refresh-1" });
    expect(t).toEqual({ ...TOKENS, accessToken: "access-2", refreshToken: "refresh-2", expiresAt: "2026-09-29T13:30:00.000Z" });
  });

  it("fails clearly when Jobber rejects the refresh token", async () => {
    const { fetch } = mockFetch(() => ({ status: 401, body: { error: "invalid_grant", error_description: "The provided refresh token is not valid." } }));
    const c = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch });
    const err = await failure(c.refresh(TOKENS));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(401);
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/refresh token is not valid/);
    await expect(c.refresh({ accessToken: "a" })).rejects.toThrow(/reconnect/);
  });
});

/* ------------------------------------------------------------------ */
/* GraphQL client                                                      */
/* ------------------------------------------------------------------ */

describe("JobberClient", () => {
  it("refreshes once on 401, retries, and hands the new tokens to onTokens", async () => {
    const seen: OAuthTokens[] = [];
    const { fetch, calls } = mockFetch((c) => {
      if (c.url === JOBBER_TOKEN_URL) return { body: { access_token: "access-2", refresh_token: "refresh-2", expires_at: "2026-09-29 14:00:00 UTC" } };
      if (c.headers.Authorization === "Bearer access-1") return { status: 401, body: { message: "Token not recognized" } };
      return gql({ account: { id: "A", name: "N" } });
    });
    const conn = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, now: () => NOW, onTokens: (next) => void seen.push(next) });
    const client = conn.client(TOKENS);
    const data = await client.query<{ account: { id: string } }>("QaAccount", "query QaAccount { account { id name } }");
    expect(data.account.id).toBe("A");
    expect(calls.map((c) => (c.url === JOBBER_TOKEN_URL ? "token" : c.headers.Authorization))).toEqual(["Bearer access-1", "token", "Bearer access-2"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2", accountId: TOKENS.accountId });
    expect(client.tokens.accessToken).toBe("access-2");
  });

  it("refreshes before a request when the token is about to expire", async () => {
    const { fetch, calls } = mockFetch((c) => (c.url === JOBBER_TOKEN_URL ? { body: { access_token: "access-2", refresh_token: "refresh-2" } } : gql({ ok: true })));
    const conn = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, now: () => NOW });
    await conn.client({ ...TOKENS, expiresAt: new Date(NOW + 10_000).toISOString() }).query("Q", "query Q { ok }");
    expect(calls[0]!.url).toBe(JOBBER_TOKEN_URL);
    expect(calls[1]!.headers.Authorization).toBe("Bearer access-2");
  });

  it("gives up with a non-retryable error when the token is still rejected after one refresh", async () => {
    const { fetch } = mockFetch((c) => (c.url === JOBBER_TOKEN_URL ? { body: { access_token: "access-2", refresh_token: "refresh-2" } } : { status: 401, body: { message: "Token not recognized" } }));
    const conn = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, now: () => NOW });
    const err = await failure(conn.client(TOKENS).query("Q", "query Q { ok }"));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(401);
  });

  it("waits out the leaky bucket before a query it can't afford yet", async () => {
    const ck = clock();
    // The server says this query costs 1,100 points and only 100 are left; 500 come back per second.
    const { fetch } = mockFetch(() => gql({ ok: true }, cost(1100, 100)));
    const client = new JobberClient({ tokens: TOKENS, fetch, sleep: ck.sleep, now: ck.now });
    await client.query("QaQuotes", "query QaQuotes { ok }");
    expect(ck.sleeps).toEqual([]); // nothing known yet: no wait
    await client.query("QaQuotes", "query QaQuotes { ok }");
    expect(ck.sleeps).toEqual([2000]); // (1100 - 100) / 500 per second
    expect(client.waits[0]!.reason).toMatch(/need 1100/);
  });

  it("counts points restored while time passed", async () => {
    let t = NOW;
    const sleeps: number[] = [];
    const { fetch } = mockFetch(() => gql({ ok: true }, cost(1100, 100)));
    const client = new JobberClient({ tokens: TOKENS, fetch, sleep: async (ms) => void sleeps.push(ms), now: () => t });
    await client.query("Q", "query Q { ok }");
    t += 1000; // +500 points
    await client.query("Q", "query Q { ok }");
    expect(sleeps).toEqual([1000]); // (1100 - 600) / 500
  });

  it("retries a THROTTLED response after the deficit refills", async () => {
    const ck = clock();
    let n = 0;
    const { fetch, calls } = mockFetch(() => {
      if (n++ === 0) {
        return { body: { errors: [{ message: "Throttled", extensions: { code: "THROTTLED", documentation: "https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits" } }], extensions: cost(3000, 500) } };
      }
      return gql({ ok: true }, cost(3000, 7000));
    });
    const client = new JobberClient({ tokens: TOKENS, fetch, sleep: ck.sleep, now: ck.now });
    await expect(client.query("Q", "query Q { ok }")).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(ck.sleeps).toEqual([5000]); // (3000 - 500) / 500
  });

  it("backs off on 5xx and 429, and stops after 5 retries", async () => {
    const ck = clock();
    let n = 0;
    const { fetch } = mockFetch(() => (n++ === 0 ? { status: 503, body: { message: "unavailable" } } : gql({ ok: 1 })));
    await new JobberClient({ tokens: TOKENS, fetch, sleep: ck.sleep, now: ck.now }).query("Q", "query Q { ok }");
    expect(ck.sleeps).toEqual([1000]);

    const ck2 = clock();
    const { fetch: f429, calls } = mockFetch(() => ({ status: 429, body: { message: "Too Many Requests" } }));
    const err = await failure(new JobberClient({ tokens: TOKENS, fetch: f429, sleep: ck2.sleep, now: ck2.now }).query("Q", "query Q { ok }"));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(calls).toHaveLength(6);
    expect(ck2.sleeps).toEqual([1000, 2000, 4000, 8000, 16000]);

    const ck3 = clock();
    const { fetch: fRetryAfter } = mockFetch(() => (ck3.sleeps.length ? gql({ ok: 1 }) : { status: 429, headers: { "retry-after": "7" } }));
    await new JobberClient({ tokens: TOKENS, fetch: fRetryAfter, sleep: ck3.sleep, now: ck3.now }).query("Q", "query Q { ok }");
    expect(ck3.sleeps).toEqual([7000]);
  });

  it("surfaces GraphQL errors as ProviderError", async () => {
    const { fetch } = mockFetch(() => ({ body: { data: null, errors: [{ message: "Field 'nope' doesn't exist on type 'Quote'", path: ["quotes", "nope"] }] } }));
    const err = await failure(new JobberClient({ tokens: TOKENS, fetch }).query("Q", "query Q { ok }"));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.provider).toBe("jobber");
    expect(err.message).toMatch(/nope.*quotes\.nope/);
  });

  it("refuses a query that could never fit in the bucket", async () => {
    const { fetch, calls } = mockFetch(() => gql({}));
    const err = await failure(new JobberClient({ tokens: TOKENS, fetch }).query("Q", "query Q { quotes { nodes { lineItems { nodes { a b } } } } }"));
    expect(err).toBeInstanceOf(ProviderError);
    expect(calls).toHaveLength(0);
  });

  it("pages with endCursor", async () => {
    const { fetch, calls } = mockFetch((c) => gql({ things: c.vars!.after ? conn([{ n: 3 }]) : conn([{ n: 1 }, { n: 2 }], "abc") }));
    const client = new JobberClient({ tokens: TOKENS, fetch });
    const got: number[] = [];
    for await (const page of client.paginate<{ n: number }, { things: any }>("T", "query T($first: Int, $after: String) { things(first: $first, after: $after) { nodes { n } pageInfo { hasNextPage endCursor } } }", { first: 2 }, (d) => d.things)) {
      got.push(...page.nodes.map((x) => x.n));
    }
    expect(got).toEqual([1, 2, 3]);
    expect(calls.map((c) => c.vars!.after)).toEqual([null, "abc"]);
  });

  it("estimates query cost by the documented rules and keeps every page under budget", () => {
    // examples from https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits
    expect(estimateQueryCost(`query { quote(id: "MTc1") { id cost title client { id firstName } } }`)).toBe(7);
    expect(estimateQueryCost(`query { quotes(first: 10) { edges { node { id cost quoteNumber quoteStatus title } } } }`)).toBe(50);
    expect(estimateQueryCost(`query { quotes { edges { node { id cost quoteNumber quoteStatus title } } } }`)).toBe(500);
    expect(estimateQueryCost(`query Q($n: Int) { quotes(first: $n) { nodes { id } } }`, { n: 7 })).toBe(7);
    const pages = [
      [CLIENTS_QUERY, PAGE_SIZE],
      [QUOTES_QUERY, QUOTE_PAGE_SIZE],
      [JOBS_QUERY, PAGE_SIZE],
      [INVOICES_QUERY, PAGE_SIZE],
      [REQUESTS_QUERY, PAGE_SIZE],
    ] as const;
    for (const [q, first] of pages) {
      const c = estimateQueryCost(q, { first });
      expect(c).toBeGreaterThan(100);
      expect(c).toBeLessThanOrEqual(PAGE_COST_BUDGET);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Pull + mapping + merge into the engine                              */
/* ------------------------------------------------------------------ */

describe("Jobber pull", () => {
  async function fullPull() {
    const ck = clock();
    const { fetch, calls } = mockFetch(fullAccountHandler);
    const progress: string[] = [];
    const c = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, sleep: ck.sleep, now: ck.now, read: JOBBER_EXTRAS });
    const pulled = await c.pull(TOKENS, { onProgress: (m) => progress.push(m) });
    return { pulled, calls, progress };
  }

  it("backfills every page and maps records into engine shape", async () => {
    const { pulled, calls, progress } = await fullPull();
    expect(calls.map((c) => c.op)).toEqual(["QaClients", "QaClients", "QaQuotes", "QaQuotes", "QaJobs", "QaInvoices", "QaRequests"]);
    expect(calls[1]!.vars!.after).toBe("cur-c1");
    expect(calls[3]!.vars!.after).toBe("cur-q1");
    // full backfill: no filters, no sort
    for (const c of calls) {
      expect(c.vars!.filter).toBeUndefined();
      expect(c.vars!.sort).toBeUndefined();
    }
    expect(progress.some((m) => /clients — page 2, 3 so far/.test(m))).toBe(true);
    expect(pulled.stats.counts).toEqual({ customers: 3, quotes: 4, jobs: 4, invoices: 3, requests: 3 });
    expect(pulled.tokens).toBeUndefined();

    // customers: provisional ids, primary contact first, normalized
    const dana = pulled.customers.find((c) => c.id === `jobber:${DANA_ID}`)!;
    expect(dana.sourceIds).toEqual([`jobber:${DANA_ID}`]);
    expect(dana.emails).toEqual(["dana@whitfieldhome.net", "d.whitfield@gmail.com"]);
    expect(dana.phones).toEqual(["+16035550199", "+16035550142"]);
    expect(dana.address).toEqual({ street: "14 Oak Ln", city: "Concord", state: "NH", zip: "03301" });
    expect(dana.properties.map((p) => p.street)).toEqual(["14 Oak Ln", "200 Lake Shore Dr"]);
    expect(dana.tags).toEqual(["Tree", "Repeat"]);
    expect(dana.createdOn).toBe("2023-04-02");
    expect(dana.doNotContact).toBeUndefined();
    expect(dana.smsConsent).toBeUndefined(); // never inferred

    const marco = pulled.customers.find((c) => c.id === `jobber:${MARCO_ID}`)!;
    expect(marco.doNotContact).toBe(true);
    expect(marco.tags).toContain(FOLLOW_UPS_OFF_TAG);
    expect(marco.tags).toContain("Jobber: lead");
    expect(marco.address).toEqual({ street: "9 Elm Rd", city: "Hopkinton", state: "NH", zip: "03229" }); // blank billing -> property

    const hill = pulled.customers.find((c) => c.id === `jobber:${HILL_ID}`)!;
    expect(hill.isCommercial).toBe(true);
    expect(hill).toMatchObject({ name: "Hillside HOA", companyName: "Hillside HOA", firstName: "Pat", lastName: "Moore" });
    expect(hill.address?.street).toBe("1 Hillside Common Clubhouse");
    // the extension is dropped (it used to be glued on: +603224123412) and the placeholder rejected
    expect(hill.phones).toEqual(["+16032241234"]);

    // the approved quote with an optional item the customer left off
    const q1042 = pulled.quotes.find((q) => q.number === "1042")!;
    expect(q1042).toMatchObject({
      id: makeId("q", "jobber", "1042"),
      sourceId: gid("Quote", 1042),
      customerId: `jobber:${DANA_ID}`,
      status: "approved",
      rawStatus: "approved",
      total: 2150,
      createdOn: "2026-08-01",
      sentOn: "2026-08-02",
      viewedOn: "2026-08-03",
      approvedOn: "2026-08-10",
      salesperson: "Dave Ridge",
      property: { street: "14 Oak Ln", city: "Concord", state: "NH", zip: "03301" },
    });
    expect(q1042.lineItems).toEqual([
      { name: "Oak removal", description: "Dead red oak by the driveway, crane access", quantity: 1, unitPrice: 1800, total: 1800 },
      { name: "Stump grinding", quantity: 1, unitPrice: 350, total: 350, optional: true, selected: false },
      { name: "Wood chip haul-away", quantity: 1, unitPrice: 350, total: 350, optional: true, selected: true },
    ]); // the text-only line is dropped

    // undecided quote: an unrecommended option is not a "no" yet
    const q1044 = pulled.quotes.find((q) => q.number === "1044")!;
    expect(q1044.status).toBe("awaiting_response");
    expect(q1044.lineItems[1]).toEqual({ name: "Mulch refresh", quantity: 1, unitPrice: 240, total: 240, optional: true });

    const q1043 = pulled.quotes.find((q) => q.number === "1043")!;
    expect(q1043).toMatchObject({ status: "converted", convertedOn: "2026-07-15", approvedOn: "2026-07-14", jobIds: [makeId("j", "jobber", "310")] });
    const q1045 = pulled.quotes.find((q) => q.number === "1045")!;
    expect(q1045).toMatchObject({ status: "archived", archivedOn: "2026-05-05", sentOn: "2026-03-01", viewedOn: "2026-03-02" });

    const j = Object.fromEntries(pulled.jobs.map((x) => [x.number!, x]));
    expect(j["310"]).toMatchObject({ id: makeId("j", "jobber", "310"), status: "scheduled", scheduledOn: "2026-10-06", quoteRef: "1043", quoteId: makeId("q", "jobber", "1043"), total: 4800 });
    expect(j["311"]).toMatchObject({ status: "completed", completedOn: "2025-04-20", rawStatus: "archived" });
    expect(j["312"]).toMatchObject({ status: "on_hold", rawStatus: "action_required" });
    expect(j["313"]).toMatchObject({ status: "active", recurring: true });

    const i = Object.fromEntries(pulled.invoices.map((x) => [x.number!, x]));
    expect(i["5001"]).toMatchObject({ id: makeId("i", "jobber", "5001"), status: "awaiting_payment", total: 4800, balance: 4800, issuedOn: "2026-07-20", dueOn: "2026-10-20", jobRef: "310" });
    expect(i["5002"]).toMatchObject({ status: "void", balance: 0 });
    expect(i["5003"]).toMatchObject({ status: "paid", paidOn: "2025-05-01", jobRef: "311" });

    const r = Object.fromEntries(pulled.requests.map((x) => [x.sourceId!, x]));
    expect(r[gid("Request", 10)]).toMatchObject({ id: makeId("r", "jobber", gid("Request", 10)), status: "archived", source: "Online booking", createdOn: "2025-11-02" });
    expect(r[gid("Request", 11)]).toMatchObject({ status: "assessment_scheduled", assessmentOn: "2026-10-02", rawStatus: "needs_approval" });
    expect(r[gid("Request", 9)]).toMatchObject({ status: "converted", quoteRef: "1043" });

    // newest updatedAt anywhere (job 310, 2026-09-25 16:00 -04:00)
    expect(pulled.nextSince).toBe("2026-09-25T20:00:00.000Z");
    expect(pulled.warnings).toEqual([]);
  });

  it("merges into the engine with CSV-compatible ids and resolved customers", async () => {
    const { pulled } = await fullPull();
    const ds = mergePulled(emptyDataset(biz, "2026-09-29"), pulled, "jobber");

    expect(ds.business.software).toBe("jobber");
    expect(ds.customers).toHaveLength(3);
    const customerIds = new Set(ds.customers.map((c) => c.id));
    for (const rec of [...ds.quotes, ...ds.jobs, ...ds.invoices, ...ds.requests]) {
      expect(rec.customerId.startsWith("jobber:")).toBe(false);
      expect(customerIds.has(rec.customerId)).toBe(true);
    }

    const q = (n: string) => ds.quotes.find((x) => x.id === makeId("q", "jobber", n))!;
    expect(q("1042").status).toBe("approved");
    expect(q("1042").lineItems.find((l) => l.name === "Stump grinding")).toMatchObject({ optional: true, selected: false });
    expect(q("1043").status).toBe("converted");
    expect(q("1043").jobIds).toEqual([makeId("j", "jobber", "310")]);
    expect(q("1044").status).toBe("awaiting_response");
    expect(q("1045").status).toBe("archived");

    const j310 = ds.jobs.find((x) => x.id === makeId("j", "jobber", "310"))!;
    expect(j310.quoteId).toBe(makeId("q", "jobber", "1043"));
    expect(ds.invoices.find((x) => x.id === makeId("i", "jobber", "5001"))!.jobId).toBe(j310.id);

    const archivedReq = ds.requests.find((x) => x.id === makeId("r", "jobber", gid("Request", 10)))!;
    expect(archivedReq.status).toBe("archived");
    expect(archivedReq.quoteId).toBeUndefined(); // asked for a price, never quoted

    const marco = ds.customers.find((c) => c.sourceIds.includes(`jobber:${MARCO_ID}`))!;
    expect(marco.doNotContact).toBe(true);
    expect(marco.tags).toContain(FOLLOW_UPS_OFF_TAG);
    expect(ds.customers.find((c) => c.sourceIds.includes(`jobber:${HILL_ID}`))!.isCommercial).toBe(true);
  });

  it("lands on the same records a CSV import made (no duplicates when a CSV business connects Jobber)", async () => {
    const CSV = `Quote #,Client name,Client email,Client phone,Property,Title,Status,Created date,Sent date,Approved date,Converted date,Total ($),Salesperson
1042,Dana Whitfield,dana@whitfieldhome.net,(603) 555-0199,"14 Oak Ln, Concord, NH 03301",Remove dead oak by driveway,Awaiting response,2026-08-01,2026-08-02,,,"$2,150.00",Dave Ridge
1045,Dana Whitfield,dana@whitfieldhome.net,(603) 555-0199,"14 Oak Ln, Concord, NH 03301",Two pines over garage,Archived,2026-02-27,2026-03-01,,,"4,850.00",Dave Ridge
`;
    const fromCsv: Dataset = ingestFile(emptyDataset(biz, "2026-09-29"), CSV, "Quotes Report.csv", "2026-09-29T12:00:00Z").dataset;
    expect(fromCsv.quotes.map((x) => x.id).sort()).toEqual([makeId("q", "jobber", "1042"), makeId("q", "jobber", "1045")].sort());
    const csvDana = fromCsv.customers[0]!;

    const { pulled } = await fullPull();
    const ds = mergePulled(fromCsv, pulled, "jobber");
    expect(ds.quotes).toHaveLength(4); // 1042 + 1045 updated in place, 1043 + 1044 new
    expect(ds.customers).toHaveLength(3);
    const dana = ds.customers.find((c) => c.id === csvDana.id)!;
    expect(dana.sourceIds).toContain(`jobber:${DANA_ID}`);
    const q1042 = ds.quotes.find((x) => x.id === makeId("q", "jobber", "1042"))!;
    expect(q1042.customerId).toBe(csvDana.id);
    expect(q1042.status).toBe("approved"); // the API's fresher status wins
    expect(q1042.sourceId).toBe(gid("Quote", 1042));
  });

  it("pulls incrementally: updatedAt filters, newest-first jobs that stop at `since`, and link-only client stand-ins", async () => {
    const since = "2026-09-01T00:00:00.000Z";
    const ck = clock();
    const { fetch, calls } = mockFetch((c) => {
      if (c.op === "QaJobs") {
        expect(c.vars!.sort).toEqual([{ key: "UPDATED_AT", direction: "DESCENDING" }]);
        expect(c.vars!.filter).toBeUndefined();
        return gql({ jobs: conn([J310, J311, J312], "more-jobs") }); // J311 is older than since -> stop, don't page on
      }
      expect(c.vars!.filter).toEqual({ updatedAt: { after: since } });
      if (c.op === "QaClients") return gql({ clients: conn([]) });
      if (c.op === "QaQuotes") return gql({ quotes: conn([{ ...Q1042, quoteStatus: "converted", updatedAt: "2026-09-24T09:00:00-04:00", lastTransitioned: { ...Q1042.lastTransitioned, convertedAt: "2026-09-24T09:00:00-04:00" } }]) });
      if (c.op === "QaInvoices") return gql({ invoices: conn([]) });
      if (c.op === "QaRequests") return gql({ requests: conn([]) });
      throw new Error(c.op);
    });
    const c = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, sleep: ck.sleep, now: ck.now, read: JOBBER_EXTRAS });
    const pulled = await c.pull(TOKENS, { since });
    expect(calls.filter((x) => x.op === "QaJobs")).toHaveLength(1);
    expect(pulled.jobs.map((j) => j.number)).toEqual(["310"]);
    expect(pulled.customers.map((x) => x.id).sort()).toEqual([`jobber:${DANA_ID}`, `jobber:${HILL_ID}`].sort());
    expect(pulled.customers.every((x) => x.emails.length === 0)).toBe(true); // stand-ins only
    expect(pulled.nextSince).toBe("2026-09-25T20:00:00.000Z");

    // fold onto the full first sync: nothing duplicated, status moves forward
    const first = await fullPull();
    const base = mergePulled(emptyDataset(biz, "2026-09-29"), first.pulled, "jobber");
    const next = mergePulled(base, pulled, "jobber");
    expect(next.customers).toHaveLength(3);
    expect(next.quotes).toHaveLength(4);
    const q = next.quotes.find((x) => x.id === makeId("q", "jobber", "1042"))!;
    expect(q.status).toBe("converted");
    expect(q.customerId).toBe(base.quotes.find((x) => x.id === q.id)!.customerId);
    const dana = next.customers.find((x) => x.sourceIds.includes(`jobber:${DANA_ID}`))!;
    expect(dana.emails).toEqual(["dana@whitfieldhome.net", "d.whitfield@gmail.com"]); // stand-in didn't wipe anything
  });

  it("the listed app reads clients and quotes only, unless more is allowed", async () => {
    const ck = clock();
    const { fetch, calls } = mockFetch(fullAccountHandler);
    const c = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, sleep: ck.sleep, now: ck.now });
    const pulled = await c.pull(TOKENS, {});
    expect([...new Set(calls.map((x) => x.op))]).toEqual(["QaClients", "QaQuotes"]);
    expect(pulled.stats.counts).toMatchObject({ quotes: 4, jobs: 0, invoices: 0, requests: 0 });
    expect(pulled.warnings).toEqual([]);
  });

  it("skips a resource Jobber won't share, without failing the sync or asking to reconnect", async () => {
    const ck = clock();
    const { fetch } = mockFetch((x) => (x.op === "QaJobs" ? { body: { data: null, errors: [{ message: "Access denied: missing read_jobs scope", path: ["jobs"] }], extensions: cost() } } : fullAccountHandler(x)));
    const c = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, sleep: ck.sleep, now: ck.now, read: JOBBER_EXTRAS });
    const pulled = await c.pull(TOKENS, {});
    expect(pulled.stats.counts).toMatchObject({ quotes: 4, jobs: 0, invoices: 3, requests: 3 });
    expect(pulled.warnings.join(" ")).toMatch(/didn't share jobs/);
  });

  it("stops at maxPages, warns, and doesn't advance the watermark", async () => {
    const ck = clock();
    const { fetch, calls } = mockFetch((c) => {
      const key = { QaClients: "clients", QaQuotes: "quotes", QaJobs: "jobs", QaInvoices: "invoices", QaRequests: "requests" }[c.op!]!;
      const node = { QaClients: CLIENT_DANA, QaQuotes: Q1042, QaJobs: J310, QaInvoices: I5001, QaRequests: R11 }[c.op!];
      return gql({ [key]: conn([node], `next-${c.op}`) });
    });
    const c = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, sleep: ck.sleep, now: ck.now, read: JOBBER_EXTRAS });
    const pulled = await c.pull(TOKENS, { maxPages: 1, since: "2026-01-01T00:00:00.000Z" });
    expect(calls).toHaveLength(5);
    expect(pulled.warnings.filter((w) => /maxPages/.test(w))).toHaveLength(5);
    expect(pulled.nextSince).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns refreshed tokens when the access token expired mid-pull", async () => {
    const ck = clock();
    let expired = false;
    const { fetch } = mockFetch((c) => {
      if (c.url === JOBBER_TOKEN_URL) return { body: { access_token: "access-2", refresh_token: "refresh-2" } };
      if (c.op === "QaJobs" && c.headers.Authorization === "Bearer access-1") {
        expired = true;
        return { status: 401, body: { message: "Token not recognized" } };
      }
      const r = fullAccountHandler({ ...c, headers: { ...c.headers, Authorization: "Bearer access-1" } });
      return r;
    });
    const saved: OAuthTokens[] = [];
    const c = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, sleep: ck.sleep, now: ck.now, onTokens: (t) => void saved.push(t), read: JOBBER_EXTRAS });
    const pulled = await c.pull(TOKENS, {});
    expect(expired).toBe(true);
    expect(pulled.tokens).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2", accountId: TOKENS.accountId });
    expect(saved).toHaveLength(1);
    expect(pulled.stats.counts.jobs).toBe(4);
  });

  it("maps every Jobber job status", () => {
    expect(mapJobStatus("upcoming")).toBe("scheduled");
    expect(mapJobStatus("today")).toBe("active");
    expect(mapJobStatus("active")).toBe("active");
    expect(mapJobStatus("expiring_within_30_days")).toBe("active");
    expect(mapJobStatus("unscheduled")).toBe("unscheduled");
    expect(mapJobStatus("action_required")).toBe("on_hold");
    expect(mapJobStatus("on_hold")).toBe("on_hold");
    expect(mapJobStatus("late")).toBe("late");
    expect(mapJobStatus("requires_invoicing")).toBe("requires_invoicing");
    expect(mapJobStatus("archived", "2026-01-01T00:00:00Z")).toBe("completed");
    expect(mapJobStatus("archived", null)).toBe("archived");
    expect(mapJobStatus("something_new")).toBe("unknown");
  });
});

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

describe("Jobber webhooks", () => {
  const c = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET });
  const body = JSON.stringify({ data: { webHookEvent: { topic: "QUOTE_APPROVED", appId: "3ef22a50-072d-430c-a78f-b7646657560b", accountId: gid("Account", 77), itemId: gid("Quote", 1042), occurredAt: "2026-09-29T10:00:00-04:00" } } });
  const sign = (raw: string, secret = SECRET) => createHmac("sha256", secret).update(raw).digest("base64");

  it("verifies the base64 HMAC-SHA256 signature", () => {
    expect(c.verifyWebhook(body, { "X-Jobber-Hmac-SHA256": sign(body) })).toBe(true);
    expect(c.verifyWebhook(body, { "x-jobber-hmac-sha256": sign(body) })).toBe(true); // Node lowercases header names
    expect(c.verifyWebhook(body + " ", { "x-jobber-hmac-sha256": sign(body) })).toBe(false);
    expect(c.verifyWebhook(body, { "x-jobber-hmac-sha256": sign(body, "some-other-secret") })).toBe(false);
    expect(c.verifyWebhook(body, { "x-jobber-hmac-sha256": "not base64 at all" })).toBe(false);
    expect(c.verifyWebhook(body, {})).toBe(false);
  });

  it("parses the payload, including the old `occuredAt` spelling", () => {
    expect(c.parseWebhook(body)).toEqual({ topic: "QUOTE_APPROVED", accountId: gid("Account", 77), itemId: gid("Quote", 1042), occurredAt: "2026-09-29T10:00:00-04:00" });
    const old = JSON.stringify({ data: { webHookEvent: { topic: "CLIENT_UPDATE", appId: "x", accountId: "MQ==", itemId: "Mg==", occuredAt: "2021-08-12T16:31:36-06:00" } } });
    expect(c.parseWebhook(old)).toEqual({ topic: "CLIENT_UPDATE", accountId: "MQ==", itemId: "Mg==", occurredAt: "2021-08-12T16:31:36-06:00" });
    expect(c.parseWebhook("not json")).toBeUndefined();
    expect(c.parseWebhook(JSON.stringify({ data: {} }))).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

describe("Jobber notes", () => {
  it("writes a quote note by Jobber id, or looks the id up from a CSV quote number", async () => {
    const { fetch, calls } = mockFetch((c) => {
      if (c.op === "QaQuoteByNumber") return gql({ quotes: { nodes: [{ id: gid("Quote", 1042), quoteNumber: "1042" }] } });
      if (c.op === "QaQuoteNote") return gql({ quoteCreateNote: { quoteNote: { id: "n1" }, userErrors: [] } });
      if (c.op === "QaClientNote") return gql({ clientCreateNote: { clientNote: { id: "n2" }, userErrors: [] } });
      throw new Error(c.op);
    });
    const conn = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, now: () => NOW });
    await conn.writeNote!(TOKENS, { kind: "quote", sourceId: gid("Quote", 1042) }, "Quiet Accounts: Dana replied — wants it done in October.");
    expect(calls[0]).toMatchObject({ op: "QaQuoteNote", vars: { id: gid("Quote", 1042), message: "Quiet Accounts: Dana replied — wants it done in October." } });
    expect(calls[0]!.query).toMatch(/quoteCreateNote\(quoteId: \$id, input: \{ message: \$message \}\)/);

    await conn.writeNote!(TOKENS, { kind: "quote", sourceId: "1042" }, "booked");
    expect(calls.slice(1).map((c) => [c.op, c.vars])).toEqual([
      ["QaQuoteByNumber", { number: 1042 }],
      ["QaQuoteNote", { id: gid("Quote", 1042), message: "booked" }],
    ]);

    await conn.writeNote!(TOKENS, { kind: "client", sourceId: `jobber:${DANA_ID}` }, "stop");
    expect(calls[3]).toMatchObject({ op: "QaClientNote", vars: { id: DANA_ID, message: "stop" } });
  });

  it("throws when Jobber reports userErrors", async () => {
    const { fetch } = mockFetch(() => gql({ clientCreateNote: { clientNote: null, userErrors: [{ message: "Client not found", path: ["clientId"] }] } }));
    const conn = createJobberConnector({ clientId: CLIENT_ID, clientSecret: SECRET, fetch, now: () => NOW });
    await expect(conn.writeNote!(TOKENS, { kind: "client", sourceId: "bogus" }, "x")).rejects.toThrow(/Client not found/);
  });
});
