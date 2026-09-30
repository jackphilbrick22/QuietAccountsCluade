/**
 * Client for the Quiet Accounts server (`apps/server`, Hono). Operator routes need the operator token
 * as a Bearer header. Same origin in production; `VITE_API_BASE` points dev builds elsewhere
 * (the Vite dev server already proxies /api to localhost:8787).
 */
import type {
  AgentEvent,
  BusinessProfile,
  DrawerSummary,
  GuaranteeCheck,
  LiftReport,
  Opportunity,
  Readiness,
  RecordKind,
  Reply,
  ReplyIntent,
  ScanStats,
  sendHealth,
  SourceSystem,
  Touch,
  WeekNumbers,
} from "@qa/engine";

export const API_BASE: string = String(import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
const TOKEN_KEY = "qa:opToken";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: the token lives for this tab only */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: { path: (string | number)[]; message: string }[],
  ) {
    super(message);
  }
}

let memToken: string | null = null;
export function setSessionToken(t: string | null): void {
  memToken = t;
}

export async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, token?: string | null): Promise<T> {
  const t = token ?? memToken ?? getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check the connection and try again.", 0);
  }
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; issues?: ApiError["issues"] };
    throw new ApiError(d.error ?? `Request failed (${res.status})`, res.status, d.issues);
  }
  return data as T;
}

/* ------------------------------ response shapes ------------------------------ */

export type SendHealth = ReturnType<typeof sendHealth>;

/** GET /api/businesses/:id — the server's overview(). The list route returns the same per client. */
export interface Overview {
  business: BusinessProfile;
  paused: boolean;
  asOf?: string;
  summary?: DrawerSummary;
  readiness?: Readiness;
  totals?: { booked: number; bookedValue: number; contacted: number; replied: number; wants: number; remaining: number };
  week?: WeekNumbers;
  lift?: LiftReport;
  health?: SendHealth;
  guarantee?: GuaranteeCheck;
  counts?: { customers: number; quotes: number; jobs: number; invoices: number; requests: number; queued: number; sent: number };
  waitingOnOwner?: { id: string; name: string; intent: ReplyIntent; receivedAt: string; text: string }[];
  recoveredValue?: number;
  events?: AgentEvent[];
}

export interface OppPage {
  total: number;
  page: number;
  items: (Opportunity & { label: string; customer?: string })[];
}

export interface TouchPage {
  total: number;
  items: Touch[];
}

export interface OwnerMessageRow {
  id: string;
  at: string;
  kind: "handoff" | "sla_nudge" | "weekly" | "close" | "precharge" | "free_month" | "info" | string;
  text: string;
  delivery: "pending" | "sent" | "review" | "failed" | "skipped" | string;
  channel: string | null;
  delivered_at: string | null;
}

export interface Links {
  owner: string;
  connectJobber: string;
  importToken: string;
}

export interface Person {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
}

export interface FileRow {
  id: string;
  fileName: string;
  importedAt: string;
  source: SourceSystem;
  kind: RecordKind;
  rows: number;
  accepted: number;
  rejected: number;
  warnings: string[];
}

export interface Integrations {
  jobber: { available: boolean; connected: boolean; status: string; lastSyncAt: string | null; lastError: string | null };
}

export interface ImportResult {
  files: { file: string; kind: string; source: string; accepted: number; rows: number; warnings: string[]; assisted: boolean }[];
  overview: Overview;
}

export interface PlanResult {
  people: number;
  notes: number;
  firstDay?: string;
  lastDay?: string;
  personalized: number;
}

export interface Health {
  ok: boolean;
  businesses: number;
  email: string;
  sms: string;
  ai: string | null;
  time: string;
}

interface ReviewBase {
  businessId: string;
  businessName: string;
  at: string;
}
export type ReviewItem =
  | (ReviewBase & { kind: "unclear"; replyId: string; customerId?: string; name: string; phone?: string; email?: string; text: string })
  | (ReviewBase & { kind: "late_lead"; replyId: string; customerId?: string; name: string; phone?: string; email?: string; intent: ReplyIntent; hours: number; text: string })
  | (ReviewBase & { kind: "flagged_note"; touchId: string; customerId: string; name: string; step: number; status: string; subject: string; body: string; flags: string[] })
  | (ReviewBase & { kind: "owner_message"; messageId: string; messageKind: string; delivery: string; text: string })
  /** A reply nobody could place (businessId is ""): a person says whose it is. */
  | (ReviewBase & { kind: "unmatched_reply"; id: string; from: string; subject: string; text: string; reason: string; candidates: { businessId: string; businessName: string }[] })
  | (ReviewBase & { kind: "brake"; reason: string; queued: number })
  | (ReviewBase & { kind: "unsure_send"; touchId: string; customerId: string; name: string; step: number; subject: string; error: string })
  | (ReviewBase & { kind: "not_taken"; touchId: string; customerId: string; name: string; reason: string })
  /** The sending platform itself (businessId is ""). */
  | (ReviewBase & { kind: "platform"; title: string; detail: string });

export interface ReviewQueue {
  now: string;
  slaHours: number;
  items: ReviewItem[];
}

export type { Reply, Touch, AgentEvent, ScanStats };
