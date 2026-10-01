import { createHmac, timingSafeEqual } from "node:crypto";
import type { Fetch } from "../contracts.ts";
import { ProviderError } from "../contracts.ts";

/**
 * The few Stripe calls billing needs (BRIEF B4), over fetch: form-encoded bodies, an Idempotency-Key on every write.
 * Idempotency keys expire after 24 hours, so the ids stored on a charge are what stop a second charge; the keys only
 * cover a retry or a restart within the day.
 */

export interface StripeCustomer {
  id: string;
  deleted?: boolean;
  invoice_settings?: { default_payment_method?: string | null };
}

export interface StripePaymentMethod {
  id: string;
  card?: { brand?: string; last4?: string };
}

export interface StripeCheckoutSession {
  id: string;
  url?: string | null;
  status?: "open" | "complete" | "expired";
  payment_status?: "paid" | "unpaid" | "no_payment_required";
  payment_intent?: string | null;
  customer?: string | null;
  metadata?: Record<string, string>;
}

export interface StripePaymentIntent {
  id: string;
  status: "requires_payment_method" | "requires_confirmation" | "requires_action" | "processing" | "requires_capture" | "canceled" | "succeeded";
  amount?: number;
  customer?: string | null;
  /** An id, or the method itself when retrieved with expand. */
  payment_method?: string | StripePaymentMethod | null;
  last_payment_error?: { message?: string; code?: string; decline_code?: string } | null;
  metadata?: Record<string, string>;
}

export interface StripeRefund {
  id: string;
  status?: string;
}

export interface StripeEvent {
  id: string;
  type: string;
  created?: number;
  data: { object: Record<string, unknown> };
}

export type Params = { [k: string]: string | number | boolean | undefined | Params | (string | Params)[] };

/** Stripe said no. A card error on a confirm carries the PaymentIntent as it now stands. */
export class StripeError extends ProviderError {
  constructor(
    message: string,
    status: number | undefined,
    readonly type?: string,
    readonly code?: string,
    readonly paymentIntent?: StripePaymentIntent,
  ) {
    super(`Stripe ${status ?? "network"}: ${message}`, "stripe", status, !status || status === 429 || status >= 500);
  }
}

export interface StripeClient {
  createCustomer(p: Params, key: string): Promise<StripeCustomer>;
  retrieveCustomer(id: string): Promise<StripeCustomer>;
  /** The customer's saved cards, newest first. */
  listCards(customer: string): Promise<StripePaymentMethod[]>;
  createCheckoutSession(p: Params, key: string): Promise<StripeCheckoutSession>;
  /** An open session can't be paid any more (refused when it's complete or expired already). */
  expireCheckoutSession(id: string, key: string): Promise<StripeCheckoutSession>;
  createPaymentIntent(p: Params, key: string): Promise<StripePaymentIntent>;
  confirmPaymentIntent(id: string, p: Params, key: string): Promise<StripePaymentIntent>;
  /** With its payment method expanded (the card's brand and last 4). */
  retrievePaymentIntent(id: string): Promise<StripePaymentIntent>;
  createRefund(p: Params, key: string): Promise<StripeRefund>;
}

/** Stripe's form encoding: nested objects as a[b][c], lists as a[0]. */
export function formEncode(p: Params, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? formEncode(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, x)));
    else if (typeof v === "object") formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export function createStripeClient(opts: { key: string; fetch?: Fetch; base?: string }): StripeClient {
  const f = opts.fetch ?? fetch;
  const base = opts.base ?? "https://api.stripe.com";
  const call = async <T>(method: "GET" | "POST", path: string, params: Params = {}, key?: string): Promise<T> => {
    const body = formEncode(params);
    const url = method === "GET" && [...body].length ? `${base}${path}?${body}` : `${base}${path}`;
    let res: Response;
    try {
      res = await f(url, {
        method,
        headers: { Authorization: `Bearer ${opts.key}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
        ...(method === "POST" ? { body } : {}),
      });
    } catch (e) {
      throw new StripeError((e as Error).message, undefined);
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; type?: string; code?: string; payment_intent?: StripePaymentIntent } };
    if (!res.ok) throw new StripeError(json.error?.message ?? res.statusText, res.status, json.error?.type, json.error?.code, json.error?.payment_intent);
    return json as T;
  };
  return {
    createCustomer: (p, key) => call("POST", "/v1/customers", p, key),
    retrieveCustomer: (id) => call("GET", `/v1/customers/${encodeURIComponent(id)}`),
    listCards: async (customer) => (await call<{ data: StripePaymentMethod[] }>("GET", `/v1/customers/${encodeURIComponent(customer)}/payment_methods`, { type: "card" })).data,
    createCheckoutSession: (p, key) => call("POST", "/v1/checkout/sessions", p, key),
    expireCheckoutSession: (id, key) => call("POST", `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, {}, key),
    createPaymentIntent: (p, key) => call("POST", "/v1/payment_intents", p, key),
    confirmPaymentIntent: (id, p, key) => call("POST", `/v1/payment_intents/${encodeURIComponent(id)}/confirm`, p, key),
    retrievePaymentIntent: (id) => call("GET", `/v1/payment_intents/${encodeURIComponent(id)}`, { expand: ["payment_method"] }),
    createRefund: (p, key) => call("POST", "/v1/refunds", p, key),
  };
}

/** How old a signed event may be (Stripe's own default): older ones are replays. */
export const STRIPE_TOLERANCE_SECONDS = 300;

/**
 * Stripe's Stripe-Signature header, checked the way Stripe documents it: t=<seconds>,v1=<hex HMAC-SHA256 of
 * "<t>.<raw body>" with the endpoint's signing secret>, any v1 matching, within five minutes of now.
 */
export function verifyStripeSignature(secret: string, rawBody: string, header: string | undefined, nowMs: number): boolean {
  if (!header) return false;
  const parts = header.split(",").map((x) => x.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > STRIPE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  return parts.some(([k, v]) => {
    if (k !== "v1" || !v) return false;
    const given = Buffer.from(v);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
