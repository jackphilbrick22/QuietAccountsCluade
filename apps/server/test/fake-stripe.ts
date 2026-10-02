import { createHmac } from "node:crypto";
import type { StripeEvent } from "../src/providers/stripe.ts";

/*
 * A fake Stripe for tests, behind the real client's fetch: it reads the form-encoded bodies and the Idempotency-Key
 * header, and keeps customers, saved cards, Checkout Sessions, PaymentIntents and refunds. A key used again returns
 * what it returned the first time (as Stripe does for 24 hours, `forgetKeys` after), whatever happened since. Cards by
 * their last four: 4242 pays, 0002 is declined, 0077 sits processing until `settle`. A PaymentIntent or a Checkout
 * Session for a customer Stripe doesn't have (deleted since) is refused outright, as Stripe does.
 */

export interface FakeCall {
  method: string;
  path: string;
  body: Record<string, any>;
  key?: string;
}

type Obj = Record<string, any>;

/** "a[b][0][c]=x" as { a: { b: { 0: { c: "x" } } } } (lists come back as objects keyed 0, 1, ...). */
function parseForm(params: URLSearchParams): Obj {
  const out: Obj = {};
  for (const [k, v] of params) {
    const path = k.replace(/\]/g, "").split("[");
    let at = out;
    path.forEach((p, i) => {
      if (i === path.length - 1) at[p] = v;
      else at = at[p] ??= {};
    });
  }
  return out;
}

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const missing = (what: string) => respond(404, { error: { type: "invalid_request_error", code: "resource_missing", message: `No such ${what}` } });

/** The Stripe-Signature header Stripe would send for this body at `t` (seconds). */
export function signStripe(secret: string, body: string, t: number): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export function fakeStripe() {
  const calls: FakeCall[] = [];
  const customers = new Map<string, Obj>();
  const methods = new Map<string, Obj>();
  const sessions = new Map<string, Obj>();
  const intents = new Map<string, Obj>();
  const refunds = new Map<string, Obj>();
  const keys = new Map<string, { route: string; status: number; body: unknown }>();
  const drops: { match: string; when: "before" | "after" }[] = [];
  let n = 0;
  const next = (prefix: string) => `${prefix}_test_${++n}`;
  const intentOut = (pi: Obj, expand: boolean) => ({ ...pi, payment_method: expand && pi.payment_method ? methods.get(pi.payment_method) : pi.payment_method });

  const card = (customer: string | undefined, last4: string): Obj => {
    const pm = { id: next("pm"), object: "payment_method", type: "card", card: { brand: "visa", last4 }, customer: customer ?? null };
    methods.set(pm.id, pm);
    return pm;
  };
  const decline = (pi: Obj) => {
    pi.status = "requires_payment_method";
    pi.last_payment_error = { type: "card_error", code: "card_declined", decline_code: "generic_decline", message: "Your card was declined." };
  };

  /** One request, as Stripe would answer it (before the idempotency layer). */
  function handle(method: string, path: string, body: Obj, query: URLSearchParams): Response {
    const route = `${method} ${path}`;
    let m: RegExpMatchArray | null;
    if (route === "POST /v1/customers") {
      const c = { id: next("cus"), object: "customer", name: body.name, email: body.email, phone: body.phone, metadata: body.metadata ?? {}, invoice_settings: { default_payment_method: null } };
      customers.set(c.id, c);
      return respond(200, c);
    }
    if ((m = route.match(/^GET \/v1\/customers\/([^/]+)$/))) return customers.has(m[1]!) ? respond(200, customers.get(m[1]!)) : missing("customer");
    if ((m = route.match(/^GET \/v1\/customers\/([^/]+)\/payment_methods$/))) {
      if (!customers.has(m[1]!)) return missing("customer");
      return respond(200, { object: "list", data: [...methods.values()].filter((x) => x.customer === m![1]).reverse() });
    }
    if (route === "POST /v1/checkout/sessions") {
      if (body.customer && !customers.has(body.customer)) return respond(400, { error: { type: "invalid_request_error", code: "resource_missing", param: "customer", message: `No such customer: '${body.customer}'` } });
      const s = { id: next("cs"), object: "checkout.session", status: "open", payment_status: "unpaid", payment_intent: null, ...body, url: "" };
      s.url = `https://checkout.stripe.test/c/pay/${s.id}`;
      sessions.set(s.id, s);
      return respond(200, s);
    }
    if ((m = route.match(/^GET \/v1\/checkout\/sessions\/([^/]+)$/))) return sessions.has(m[1]!) ? respond(200, sessions.get(m[1]!)) : missing("checkout.session");
    if ((m = route.match(/^POST \/v1\/checkout\/sessions\/([^/]+)\/expire$/))) {
      const s = sessions.get(m[1]!);
      if (!s) return missing("checkout.session");
      if (s.status !== "open") return respond(400, { error: { type: "invalid_request_error", message: `Only Checkout Sessions with a status in ["open"] can be expired. This one is ${s.status}.` } });
      s.status = "expired";
      return respond(200, s);
    }
    if (route === "POST /v1/payment_intents") {
      if (body.customer && !customers.has(body.customer)) return respond(400, { error: { type: "invalid_request_error", code: "resource_missing", param: "customer", message: `No such customer: '${body.customer}'` } });
      const pi = { id: next("pi"), object: "payment_intent", amount: Number(body.amount), currency: body.currency, customer: body.customer ?? null, payment_method: body.payment_method ?? null, metadata: body.metadata ?? {}, status: body.payment_method ? "requires_confirmation" : "requires_payment_method", last_payment_error: null };
      intents.set(pi.id, pi);
      return respond(200, pi);
    }
    if ((m = route.match(/^POST \/v1\/payment_intents\/([^/]+)\/confirm$/))) {
      const pi = intents.get(m[1]!);
      if (!pi) return missing("payment_intent");
      if (pi.status !== "requires_confirmation") return respond(400, { error: { type: "invalid_request_error", code: "payment_intent_unexpected_state", message: `This PaymentIntent's status is ${pi.status}.` } });
      const last4 = methods.get(pi.payment_method)?.card.last4;
      if (last4 === "0002") {
        decline(pi);
        return respond(402, { error: { ...pi.last_payment_error, payment_intent: pi } });
      }
      pi.status = last4 === "0077" ? "processing" : "succeeded";
      return respond(200, pi);
    }
    if ((m = route.match(/^GET \/v1\/payment_intents\/([^/]+)$/))) {
      const pi = intents.get(m[1]!);
      return pi ? respond(200, intentOut(pi, query.getAll("expand[0]").includes("payment_method"))) : missing("payment_intent");
    }
    if (route === "POST /v1/refunds") {
      const pi = intents.get(body.payment_intent);
      if (!pi || pi.status !== "succeeded") return respond(400, { error: { type: "invalid_request_error", message: "Nothing to refund" } });
      if (pi.refunded) return respond(400, { error: { type: "invalid_request_error", code: "charge_already_refunded", message: "Already refunded" } });
      pi.refunded = true;
      const r = { id: next("re"), object: "refund", status: "succeeded", payment_intent: pi.id, amount: pi.amount };
      refunds.set(r.id, r);
      return respond(200, r);
    }
    return respond(404, { error: { type: "invalid_request_error", message: `Unrecognized request URL (${route})` } });
  }

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = parseForm(new URLSearchParams(String(init?.body ?? "")));
    const key = headers.get("idempotency-key") ?? undefined;
    const route = `${method} ${url.pathname}`;
    calls.push({ method, path: url.pathname, body, ...(key ? { key } : {}) });
    const drop = drops.findIndex((x) => route.includes(x.match));
    const dropped = drop >= 0 ? drops.splice(drop, 1)[0] : undefined;
    if (dropped?.when === "before") throw new TypeError("fetch failed");
    let res: Response;
    const seen = key ? keys.get(key) : undefined;
    if (seen) res = seen.route === route ? respond(seen.status, seen.body) : respond(400, { error: { type: "idempotency_error", message: "Keys are for one request" } });
    else {
      res = handle(method, url.pathname, body, url.searchParams);
      if (key) keys.set(key, { route, status: res.status, body: await res.clone().json() });
    }
    if (dropped?.when === "after") throw new TypeError("fetch failed");
    return res;
  };

  const event = (type: string, object: Obj): StripeEvent => ({ id: next("evt"), type, created: Math.floor(Date.now() / 1000), data: { object: structuredClone(object) } });

  return {
    fetch: fetchImpl as typeof fetch,
    calls,
    customers,
    sessions,
    intents,
    refunds,
    event,
    /** The owner pays at Checkout with a card: what Stripe would send. A decline leaves the session open to try again. */
    pay(sessionId: string, last4 = "4242"): StripeEvent[] {
      const s = sessions.get(sessionId)!;
      if (s.status !== "open") throw new Error(`session ${sessionId} is ${s.status}`);
      let pi = s.payment_intent ? intents.get(s.payment_intent)! : undefined;
      if (!pi) {
        const item = s.line_items["0"];
        pi = { id: next("pi"), object: "payment_intent", amount: Number(item.price_data.unit_amount) * Number(item.quantity), currency: item.price_data.currency, customer: s.customer, payment_method: null, metadata: s.payment_intent_data?.metadata ?? {}, status: "requires_payment_method", last_payment_error: null };
        intents.set(pi.id, pi);
        s.payment_intent = pi.id;
      }
      const pm = card(s.payment_intent_data?.setup_future_usage ? s.customer : undefined, last4);
      pi.payment_method = pm.id;
      if (last4 === "0002") {
        decline(pi);
        return [event("payment_intent.payment_failed", pi)];
      }
      Object.assign(pi, { status: "succeeded", last_payment_error: null });
      Object.assign(s, { status: "complete", payment_status: "paid" });
      return [event("payment_intent.succeeded", pi), event("checkout.session.completed", s)];
    },
    expire(sessionId: string): StripeEvent {
      const s = sessions.get(sessionId)!;
      s.status = "expired";
      return event("checkout.session.expired", s);
    },
    /** A processing PaymentIntent goes through, or doesn't. */
    settle(piId: string, ok: boolean): StripeEvent {
      const pi = intents.get(piId)!;
      if (ok) pi.status = "succeeded";
      else decline(pi);
      return event(ok ? "payment_intent.succeeded" : "payment_intent.payment_failed", pi);
    },
    /** A customer Jack's own payment link made, with a saved card. */
    customerWithCard(last4 = "4242", opts: { default?: boolean } = {}): { customer: string; paymentMethod: string } {
      const c = { id: next("cus"), object: "customer", metadata: {}, invoice_settings: { default_payment_method: null as string | null } };
      customers.set(c.id, c);
      const pm = card(c.id, last4);
      if (opts.default) c.invoice_settings.default_payment_method = pm.id;
      return { customer: c.id, paymentMethod: pm.id };
    },
    /** A card on an existing customer (it becomes the newest). */
    addCard(customer: string, last4: string): string {
      return card(customer, last4).id;
    },
    /** The next request matching `match` ("POST /v1/payment_intents"): "before" never reaches Stripe; "after" is done, but the answer is lost. */
    dropNext(match: string, when: "before" | "after"): void {
      drops.push({ match, when });
    },
    /** A day went by: Stripe has forgotten the keys used so far, and one used again makes something new. */
    forgetKeys(): void {
      keys.clear();
    },
    /** Money Stripe took and kept: PaymentIntents that succeeded and weren't refunded. */
    kept(): Obj[] {
      return [...intents.values()].filter((pi) => pi.status === "succeeded" && !pi.refunded);
    },
  };
}

export type FakeStripe = ReturnType<typeof fakeStripe>;
