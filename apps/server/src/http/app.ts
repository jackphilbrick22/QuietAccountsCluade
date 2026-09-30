import { createHash, randomBytes } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import {
  BREAKAGE_LABEL,
  closeMessage,
  guaranteeCheck,
  handoffText,
  lift,
  sendHealth,
  totals,
  weekNumbers,
  mondayOf,
  readiness,
  relabelReply,
  COUNTING_RULES,
  decodeText,
  disputeRecovery,
  ledgerCSV,
  ledgerRows,
  normalizePhone,
  type AccountState,
  type BusinessProfile,
  type FileIn,
  type Reply,
  type TradeId,
  type SourceSystem,
  fmtMoney,
  htmlToText,
  quietRates,
} from "@qa/engine";
import { z } from "zod";
import { instantlyWebhookKey } from "../integrations/instantly/webhooks.ts";
import type { InboundEvent } from "../contracts.ts";
import { encrypt } from "../core/crypto.ts";
import { NotFound, NotReady } from "../core/accounts.ts";
import { replyEmailKey, webhookSetup } from "../core/backstop.ts";
import { localIso } from "../core/clock.ts";
import {
  answerInThread,
  approve,
  clearSendBrake,
  connectJobberLink,
  deliverOwnerMessages,
  handleInbound,
  holdSending,
  importFiles,
  takeForwardedRequest,
  linkToken,
  ownerLink,
  plan,
  raiseAlert,
  readLinkToken,
  rescan,
  rotateLinks,
  setBusinessPaused,
  sign,
  syncFsm,
  unsubscribeByToken,
  verifySigned,
  type Deps,
} from "../core/ops.ts";
import { ownerCommand, shortNames } from "../core/owner.ts";
import { workerHealth } from "../core/worker.ts";
import { verifyTwilioSignature } from "../providers/sms.ts";

export interface HttpDeps extends Deps {
  parsers: { instantly?: (body: unknown) => InboundEvent | undefined };
}

type Env = { Variables: { bid?: string; actor: string } };

const TRADES = ["tree", "lawn", "landscape", "septic", "fence", "concrete", "pressure_washing", "gutter", "window_cleaning", "pool", "pest", "hvac", "junk_removal", "painting", "roofing", "irrigation", "chimney", "cleaning", "holiday_lighting", "deck", "general"] as const satisfies readonly TradeId[];
// a trade the engine knows but this list leaves out fails the typecheck here
const _everyTrade: Record<Exclude<TradeId, (typeof TRADES)[number]>, never> = {};

const CreateBusiness = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]{3,48}$/)
    .optional(),
  name: z.string().min(2),
  /** Optional: left out, the first import reads it from their own quote and job titles. */
  trade: z.enum(TRADES).default("general"),
  ownerName: z.string().min(1),
  ownerPhone: z.string().optional(),
  ownerEmail: z.string().email().optional(),
  signerName: z.string().min(1),
  signerRole: z.enum(["owner", "office"]).default("office"),
  mailingAddress: z.string().min(8),
  city: z.string().optional(),
  state: z.string().length(2).optional(),
  timezone: z.string().default("America/New_York"),
  replyTo: z.string().email().optional(),
  /** This client's own sending address and name (direct mail). Left out: the server's sender, "<signer> at <business>". */
  fromEmail: z.string().email().optional(),
  fromName: z.string().min(2).max(80).optional(),
  businessPhone: z.string().optional(),
  avgJobValue: z.number().positive().optional(),
  annualRevenue: z.number().positive().optional(),
});

const ProfilePatch = CreateBusiness.partial().extend({
  sendDays: z.array(z.number().int().min(0).max(6)).optional(),
  sendWindow: z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)]).optional(),
  weeklyNewContacts: z.number().int().min(5).max(1000).optional(),
  minQuoteValue: z.number().min(0).optional(),
  minQuoteAgeDays: z.number().int().min(0).max(365).optional(),
  maxQuoteAgeMonths: z.number().int().min(1).max(120).optional(),
  blackoutWeeks: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  openCrewWeeks: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  voice: z.object({ mentionPrice: z.boolean(), offerOptions: z.boolean(), freeLook: z.boolean(), wordSwaps: z.array(z.tuple([z.string(), z.string()])) }).partial().optional(),
  persistence: z.object({ seasonalCheckIn: z.boolean(), maxNotesPerYear: z.number().int().min(1).max(12), holdoutPct: z.number().min(0).max(0.3) }).partial().optional(),
  plan: z
    .object({
      stage: z.enum(["trial", "paying", "paused", "cancelled"]),
      trialSize: z.number().int().min(10).max(1000),
      monthlyPrice: z.number().min(0),
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      billing: z.enum(["monthly", "annual"]),
      annualPrice: z.number().min(0),
      yearsPaidOn: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    })
    .partial()
    .optional(),
});

const Files = z.object({ files: z.array(z.object({ name: z.string().min(1), text: z.string().min(1), kind: z.enum(["quote", "job", "invoice", "client", "request", "visit"]).optional() })).min(1).max(20) });
const Outcome = z.object({ outcome: z.enum(["booked", "quoted", "lost", "no_answer"]).optional(), value: z.number().nonnegative().optional() });

function defaultProfile(input: z.infer<typeof CreateBusiness>, id: string, today: string): BusinessProfile {
  return {
    id,
    name: input.name,
    trade: input.trade as TradeId,
    otherTrades: [],
    software: "unknown",
    ownerName: input.ownerName,
    ownerFirstName: input.ownerName.split(/\s+/)[0] ?? input.ownerName,
    ownerPhone: input.ownerPhone,
    ownerEmail: input.ownerEmail,
    signerName: input.signerName,
    signerRole: input.signerRole,
    replyTo: input.replyTo,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    businessPhone: input.businessPhone,
    mailingAddress: input.mailingAddress,
    city: input.city,
    state: input.state,
    timezone: input.timezone,
    avgJobValue: input.avgJobValue,
    annualRevenue: input.annualRevenue,
    sendDays: [2, 3, 4],
    sendWindow: [7, 10],
    blackoutWeeks: [],
    minQuoteValue: 300,
    minQuoteAgeDays: 21,
    maxQuoteAgeMonths: 36,
    weeklyNewContacts: 75,
    openCrewWeeks: [],
    voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] },
    persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0.1 },
    channels: { email: "live", call_task: "ready", postcard: "coming_soon", sms: "coming_soon", voicemail: "coming_soon", retarget: "coming_soon" },
    plan: { stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [] },
    createdOn: today,
  };
}

/** Compact business overview for dashboards (never the whole dataset). */
export function overview(state: AccountState, paused: boolean) {
  const b = state.dataset.business;
  const t = totals(state);
  const hot = state.replies.filter((r) => (r.intent === "wants_it" || r.intent === "wants_price" || r.intent === "question") && r.status === "handed_off" && !r.ownerContactedAt);
  return {
    business: b,
    paused,
    asOf: state.dataset.asOf,
    summary: state.summary,
    readiness: readiness(state.dataset),
    totals: t,
    week: weekNumbers(state, mondayOf(state.dataset.asOf)),
    lift: lift(state.outreach, state.recoveries),
    quiet: quietRates(state),
    awaitingOwnerOk: state.awaitingOwnerOk,
    health: sendHealth(state),
    guarantee: b.plan.paidOn ? guaranteeCheck(state, state.dataset.asOf) : undefined,
    counts: {
      customers: state.dataset.customers.length,
      quotes: state.dataset.quotes.length,
      jobs: state.dataset.jobs.length,
      invoices: state.dataset.invoices.length,
      requests: state.dataset.requests.length,
      queued: state.touches.filter((x) => x.status === "approved" || x.status === "planned").length,
      sent: state.touches.filter((x) => x.status === "sent").length,
    },
    waitingOnOwner: hot.map((r) => ({ id: r.id, name: state.dataset.customers.find((c) => c.id === r.customerId)?.name ?? r.from, intent: r.intent, receivedAt: r.receivedAt, text: r.text.slice(0, 280) })),
    recoveredValue: t.bookedValue,
    events: state.events.slice(-40).reverse(),
  };
}

export function createApp(d: HttpDeps): Hono<Env> {
  const app = new Hono<Env>();
  const repo = d.accounts.repo;

  app.onError((err, c) => {
    if (err instanceof NotFound) return c.json({ error: err.message }, 404);
    if (err instanceof NotReady) return c.json({ error: err.message }, 409);
    if (err instanceof z.ZodError) return c.json({ error: "Invalid input", issues: err.issues }, 400);
    d.log(`[http] ${c.req.method} ${c.req.path} failed: ${err.stack ?? err}`);
    return c.json({ error: "Something went wrong on our side." }, 500);
  });

  // The Jobber webhook has no secret in its path: an unsigned request is turned away before a byte of its body is read.
  app.use("/webhooks/jobber", async (c, next) => {
    if (c.req.method === "POST" && d.fsm.jobber && !c.req.header("x-jobber-hmac-sha256")) return c.json({ error: "bad signature" }, 401);
    await next();
  });
  // Every body is capped before anyone reads it: the one process runs every client, so an unbounded POST
  // must never be buffered whole. Imports get room for real exports.
  app.use("*", (c, next) => bodyLimit({ maxSize: bodyCap(c.req.path), onError: (cc) => cc.json({ error: "That's too big for us to take." }, 413) })(c, next));

  const isOperator = (c: Context<Env>) => {
    const token = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const a = Buffer.from(token);
    const b = Buffer.from(d.cfg.OPERATOR_TOKEN);
    return a.length === b.length && a.equals(b);
  };

  // Is the worker ticking, how long does a tick take, how far behind is each client? Per-client detail needs the operator token.
  app.get("/api/health", (c) => {
    const worker = workerHealth(d, { detail: isOperator(c) });
    // the sending platform's webhooks (replies, bounces, unsubscribes arrive through them); no error text here, it's public
    const hooks = d.email.kind === "sequencer" ? webhookSetup(d) : undefined;
    const webhooks = d.email.kind !== "sequencer" ? undefined : !hooks ? "unknown" : hooks.ok ? "ok" : "failing";
    return c.json({ ok: !worker.stalled, businesses: repo.listBusinesses().length, email: d.email.name, sms: d.notifier.name, ai: d.llm ? d.llm.model : null, time: d.clock().toISOString(), worker, ...(webhooks ? { webhooks } : {}) });
  });

  /* ----------------------------- auth ----------------------------- */
  const operator: MiddlewareHandler<Env> = async (c, next) => {
    if (!isOperator(c)) return c.json({ error: "Operator token required" }, 401);
    c.set("actor", "operator");
    await next();
  };
  const owner: MiddlewareHandler<Env> = async (c, next) => {
    const bid = readLinkToken(d, "owner", c.req.param("token") ?? "");
    if (!bid) return c.json({ error: "This link isn't valid anymore." }, 401);
    c.set("bid", bid);
    c.set("actor", "owner");
    await next();
  };

  /* ----------------------------- operator API ----------------------------- */
  const op = new Hono<Env>();
  op.use("*", operator);

  op.get("/businesses", (c) =>
    c.json(
      repo.listBusinesses().map((b) => {
        const l = d.accounts.peek(b.id);
        return l ? overview(l.state, l.paused) : { business: b.profile, paused: b.paused };
      }),
    ),
  );

  op.post("/businesses", async (c) => {
    const input = CreateBusiness.parse(await c.req.json());
    const cell = ownerCell(input.ownerPhone);
    if (cell === null) return badCell(c);
    const id = input.id ?? `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32)}-${createHash("sha1").update(input.name + d.clock().toISOString()).digest("hex").slice(0, 5)}`;
    const today = localIso(d.clock(), input.timezone).slice(0, 10);
    await d.accounts.create(defaultProfile({ ...input, ownerPhone: cell }, id, today), today);
    // A fresh link key: a reused id never inherits an old client's links.
    rotateLinks(d, id);
    repo.audit(id, "operator", "business.create", { name: input.name });
    return c.json({ id, ownerLink: ownerLink(d, id), importAddressToken: linkToken(d, "import", id), warnings: sharedCell(id, cell) }, 201);
  });

  op.get("/businesses/:id", (c) => {
    const l = d.accounts.peek(c.req.param("id"));
    if (!l) throw new NotFound("No such business");
    return c.json(overview(l.state, l.paused));
  });

  op.patch("/businesses/:id", async (c) => {
    const patch = ProfilePatch.parse(await c.req.json());
    if (patch.ownerPhone !== undefined) {
      const cell = ownerCell(patch.ownerPhone);
      if (cell === null) return badCell(c);
      patch.ownerPhone = cell;
    }
    const id = c.req.param("id");
    let stageBefore: string | undefined;
    await d.accounts.withAccount(id, (state) => {
      const b = state.dataset.business;
      stageBefore = b.plan.stage;
      const { voice, persistence, plan: planPatch, ...rest } = patch;
      Object.assign(b, rest);
      if (rest.ownerName) b.ownerFirstName = rest.ownerName.split(/\s+/)[0] ?? b.ownerFirstName;
      if (voice) b.voice = { ...b.voice, ...voice };
      if (persistence) b.persistence = { ...b.persistence, ...persistence };
      if (planPatch) b.plan = { ...b.plan, ...planPatch };
    });
    // A stage of Paused or Cancelled really stops sending (and the platform's campaigns); back to trial/paying resumes.
    const stage = patch.plan?.stage;
    if (stage && stage !== stageBefore) {
      if (stage === "paused") await holdSending(d, id, "pause");
      else if (stage === "cancelled") await holdSending(d, id, "cancel");
      else if (stageBefore === "paused" || stageBefore === "cancelled") await holdSending(d, id, "resume");
    }
    repo.audit(id, "operator", "business.update", patch);
    return c.json({ ok: true, warnings: patch.ownerPhone ? sharedCell(id, patch.ownerPhone) : [] });
  });

  /** One owner may run two brands from one cell; that works, but texts that don't say which one get a question back. */
  function sharedCell(id: string, cell: string | undefined): string[] {
    const digits = (cell ?? "").replace(/\D/g, "").slice(-10);
    if (digits.length < 10) return [];
    const all = repo.listBusinesses().filter((b) => (b.profile.ownerPhone ?? "").replace(/\D/g, "").slice(-10) === digits);
    const others = all.filter((b) => b.id !== id);
    if (!others.length) return [];
    const tags = shortNames(all);
    return [`${others.map((b) => b.profile.name).join(", ")} ${others.length === 1 ? "uses" : "use"} the same cell. That's fine for one owner with two businesses: a text that doesn't say which one (by its #code or its name, like "PAUSE ${tags.get(id)}") gets a question back instead of a guess.`];
  }

  op.delete("/businesses/:id", async (c) => {
    const id = c.req.param("id");
    // nothing already handed to the sending platform keeps going in the name of a client that's gone
    await holdSending(d, id, "cancel");
    repo.delete(id);
    d.accounts.forget(id);
    repo.audit(id, "operator", "business.delete");
    return c.json({ ok: true });
  });

  op.post("/businesses/:id/imports", async (c) => {
    const { files } = Files.parse(await c.req.json());
    const res = await importFiles(d, c.req.param("id"), files as FileIn[]);
    return c.json({ files: res, overview: overview(d.accounts.peek(c.req.param("id"))!.state, false) });
  });

  op.post("/businesses/:id/scan", async (c) => {
    await rescan(d, c.req.param("id"));
    const l = d.accounts.peek(c.req.param("id"))!;
    return c.json({ summary: l.state.summary, stats: l.state.scan?.stats });
  });

  op.post("/businesses/:id/plan", async (c) => {
    const body = z.object({ startOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), limit: z.number().int().positive().optional(), approve: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(await plan(d, c.req.param("id"), body));
  });

  op.post("/businesses/:id/approve", async (c) => c.json({ approved: await approve(d, c.req.param("id")) }));

  op.post("/businesses/:id/pause", async (c) => {
    const { paused } = z.object({ paused: z.boolean() }).parse(await c.req.json());
    if (!repo.exists(c.req.param("id"))) throw new NotFound("No such business");
    await holdSending(d, c.req.param("id"), paused ? "pause" : "resume");
    repo.audit(c.req.param("id"), "operator", paused ? "pause" : "resume");
    return c.json({ ok: true });
  });

  // The Guard's send brake tripped; an operator looked (cleaned the list, fixed the sender name) and lets sending resume.
  op.post("/businesses/:id/health/clear", async (c) => {
    if (!repo.exists(c.req.param("id"))) throw new NotFound("No such business");
    await clearSendBrake(d, c.req.param("id"), "operator");
    repo.audit(c.req.param("id"), "operator", "health.clear");
    return c.json({ ok: true, health: sendHealth(d.accounts.peek(c.req.param("id"))!.state) });
  });

  op.get("/businesses/:id/opportunities", (c) => {
    const l = d.accounts.peek(c.req.param("id"));
    if (!l) throw new NotFound("No such business");
    const type = c.req.query("type");
    const status = c.req.query("status"); // reachable | suppressed
    const page = Math.max(1, Number(c.req.query("page") ?? 1));
    const per = Math.min(200, Math.max(10, Number(c.req.query("per") ?? 50)));
    let items = l.state.scan?.opportunities ?? [];
    if (type) items = items.filter((o) => o.type === type);
    if (status === "reachable") items = items.filter((o) => !o.suppressed);
    if (status === "suppressed") items = items.filter((o) => o.suppressed);
    const customers = new Map(l.state.dataset.customers.map((x) => [x.id, x]));
    return c.json({
      total: items.length,
      page,
      items: items.slice((page - 1) * per, page * per).map((o) => ({ ...o, label: BREAKAGE_LABEL[o.type].short, customer: customers.get(o.customerId)?.name })),
    });
  });

  op.get("/businesses/:id/touches", (c) => {
    const l = d.accounts.peek(c.req.param("id"));
    if (!l) throw new NotFound("No such business");
    const status = c.req.query("status");
    const items = l.state.touches.filter((t) => !status || t.status === status).sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1));
    return c.json({ total: items.length, items: items.slice(0, Number(c.req.query("limit") ?? 200)) });
  });

  op.patch("/businesses/:id/touches/:tid", async (c) => {
    // "sent" only settles a note stuck "sending" (the mail server may have taken it): a person checked the mailbox
    const body = z.object({ subject: z.string().min(1).max(120).optional(), body: z.string().min(20).max(4000).optional(), status: z.enum(["approved", "planned", "cancelled", "sent"]).optional() }).parse(await c.req.json());
    let ok = false;
    let flags: string[] = [];
    await d.accounts.withAccount(c.req.param("id"), async (state) => {
      const t = state.touches.find((x) => x.id === c.req.param("tid"));
      if (!t || t.status === "sent") return;
      const { lint, markSent, oppById, REQUIRED_FLAG } = await import("@qa/engine");
      const at = localIso(d.clock(), state.dataset.business.timezone).slice(0, 19);
      if (t.status === "sending") {
        if (!body.status || body.status === "planned") return;
        if (body.status === "sent") markSent(state, t.id, t.claimedAt ?? at);
        else t.status = body.status;
        t.claimedAt = undefined;
        ok = true;
        return;
      }
      if (body.status === "sent") return;
      if (body.subject) t.subject = body.subject;
      if (body.body) t.body = body.body;
      if (body.status) t.status = body.status;
      // linted as what it is: a follow-up may say "Re:", and every commercial note needs its why-line
      const commercial = oppById(state.scan?.opportunities, t.opportunityId)?.type !== "unpaid_invoice";
      t.flags = lint(t.subject ?? "", t.body, { firstName: "", job: "", requireJob: false, step: t.step, commercial });
      // an edit that broke something the law requires waits for a fix instead of going out
      if (t.status === "approved" && t.flags.some((f) => REQUIRED_FLAG.test(f))) t.status = "planned";
      flags = t.flags;
      ok = true;
    });
    return c.json({ ok, flags });
  });

  op.get("/businesses/:id/replies", (c) => {
    const l = d.accounts.peek(c.req.param("id"));
    if (!l) throw new NotFound("No such business");
    return c.json(l.state.replies.slice().sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)));
  });

  op.post("/businesses/:id/replies/:rid/outcome", async (c) => {
    const body = Outcome.parse(await c.req.json());
    await logOutcome(c.req.param("id"), c.req.param("rid"), body.outcome, body.value);
    return c.json({ ok: true });
  });

  // Write back in the homeowner's thread: a typed reply, or the AI draft as-is (one click).
  const Answer = z.object({ text: z.string().max(4000).optional(), useDraft: z.boolean().optional() });
  op.post("/businesses/:id/replies/:rid/answer", async (c) => {
    const body = Answer.parse(await c.req.json());
    const bid = c.req.param("id");
    const r = d.accounts.peek(bid)?.state.replies.find((x) => x.id === c.req.param("rid"));
    if (!r) return c.json({ error: "No such reply" }, 404);
    const text = body.useDraft ? r.draft?.text : body.text;
    if (!text) return c.json({ error: body.useDraft ? "No draft to send" : "Write something to send" }, 400);
    const res = await answerInThread(d, bid, r.id, text, "operator");
    if (!res.ok) return c.json({ error: res.error }, 400);
    repo.audit(bid, c.get("actor") ?? "operator", "reply.answer", { rid: r.id, draft: !!body.useDraft });
    return c.json({ ok: true });
  });

  // A person sorts a reply the rules couldn't place; the same dispatch runs (yes → owner text, stop → suppress).
  const Intent = z.object({ intent: z.enum(["wants_it", "wants_price", "question", "later", "already_done", "not_interested", "moved", "wrong_person", "stop", "complaint", "auto_reply", "bounce", "unclear"]) });
  op.post("/businesses/:id/replies/:rid/intent", async (c) => {
    const { intent } = Intent.parse(await c.req.json());
    const bid = c.req.param("id");
    let found = false;
    await d.accounts.withAccount(bid, (state) => {
      found = !!relabelReply(state, c.req.param("rid"), intent, localIso(d.clock(), state.dataset.business.timezone).slice(0, 19));
    });
    if (!found) return c.json({ error: "No such reply" }, 404);
    repo.audit(bid, c.get("actor") ?? "operator", "reply.intent", { rid: c.req.param("rid"), intent });
    await deliverOwnerMessages(d, bid);
    return c.json({ ok: true });
  });

  // Hand a reply to the owner: a hot one is texted again; anything else is handed off as a question for them.
  op.post("/businesses/:id/replies/:rid/handoff", async (c) => {
    const bid = c.req.param("id");
    const rid = c.req.param("rid");
    let found = false;
    await d.accounts.withAccount(bid, (state) => {
      const r = state.replies.find((x) => x.id === rid);
      if (!r) return;
      found = true;
      const now = localIso(d.clock(), state.dataset.business.timezone).slice(0, 19);
      if (r.status === "handed_off" && !r.ownerContactedAt)
        state.ownerMessages.push({ id: `om_again_${r.id}_${now}`, at: now, kind: "handoff", text: handoffText(state, r), refs: r.customerId ? [{ kind: "customer", id: r.customerId }] : undefined });
      else relabelReply(state, rid, r.intent === "wants_it" || r.intent === "wants_price" ? r.intent : "question", now);
    });
    if (!found) return c.json({ error: "No such reply" }, 404);
    repo.audit(bid, c.get("actor") ?? "operator", "reply.handoff", { rid });
    await deliverOwnerMessages(d, bid);
    return c.json({ ok: true });
  });

  // Drop an AI draft the operator won't send.
  op.delete("/businesses/:id/replies/:rid/draft", async (c) => {
    let found = false;
    await d.accounts.withAccount(c.req.param("id"), (state) => {
      const r = state.replies.find((x) => x.id === c.req.param("rid"));
      if (r?.draft) (r.draft = undefined), (found = true);
    });
    return found ? c.json({ ok: true }) : c.json({ error: "No draft on that reply" }, 404);
  });

  const Dispute = z.object({ reason: z.string().max(200).optional() });

  op.get("/businesses/:id/events", (c) => {
    const bid = c.req.param("id");
    const limit = Math.min(1000, Number(c.req.query("limit") ?? 200));
    const rows = d.accounts.repo.db.all<{ data: string }>("SELECT data FROM events WHERE business_id = ? ORDER BY at DESC LIMIT ?", bid, limit);
    return c.json(rows.map((r) => JSON.parse(r.data)));
  });

  op.get("/businesses/:id/owner-messages", (c) => c.json(repo.ownerMessages(c.req.param("id"), { delivery: c.req.query("delivery") })));

  op.post("/businesses/:id/owner-messages/:mid/send", async (c) => {
    // Operator approves a billing text (the close, pre-charge, free month) for delivery.
    const moved = d.accounts.repo.db.run("UPDATE owner_messages SET delivery = 'pending' WHERE business_id = ? AND id = ? AND delivery IN ('review','failed')", c.req.param("id"), c.req.param("mid"));
    // nothing to send (already sent, or withdrawn): say so instead of reporting a send that didn't happen
    if (!Number(moved.changes)) return c.json({ ok: false, error: "That text isn't waiting to be sent any more (it was sent or withdrawn)." }, 409);
    await deliverOwnerMessages(d, c.req.param("id"), { allowBilling: true });
    const after = repo.ownerMessages(c.req.param("id")).find((m) => m.id === c.req.param("mid"));
    repo.audit(c.req.param("id"), "operator", "owner-message.approve", { id: c.req.param("mid"), delivery: after?.delivery });
    return c.json({ ok: after?.delivery === "sent", delivery: after?.delivery });
  });

  op.get("/businesses/:id/close-preview", (c) => {
    const l = d.accounts.peek(c.req.param("id"));
    if (!l) throw new NotFound("No such business");
    return c.json({ text: closeMessage(l.state) });
  });

  op.post("/businesses/:id/sync", async (c) => c.json((await syncFsm(d, c.req.param("id"), "jobber")) ?? { error: "Not connected" }));

  const at = (kind: "import" | "requests", id: string) => (d.cfg.INBOUND_DOMAIN ? `${kind}+${linkToken(d, kind, id)}@${d.cfg.INBOUND_DOMAIN}` : undefined);
  const links = (id: string) => ({
    owner: ownerLink(d, id),
    connectJobber: connectJobberLink(d, id),
    importToken: linkToken(d, "import", id),
    importAddress: at("import", id),
    requestsToken: linkToken(d, "requests", id),
    /** Where the owner forwards new requests (website form, Angi, Thumbtack, a homeowner's email). */
    requestsAddress: at("requests", id),
  });
  op.get("/businesses/:id/links", (c) => {
    if (!repo.exists(c.req.param("id"))) throw new NotFound("No such business");
    return c.json(links(c.req.param("id")));
  });
  // New owner, import and connect links for one client (a departed office manager, a forwarded text): every old one stops working.
  op.post("/businesses/:id/links/rotate", (c) => {
    const id = c.req.param("id");
    if (!repo.exists(id)) throw new NotFound("No such business");
    rotateLinks(d, id);
    repo.audit(id, "operator", "links.rotate");
    return c.json(links(id));
  });

  // Every text the owner sent us, newest first, with what we did about it.
  op.get("/businesses/:id/owner-texts", (c) => c.json(repo.ownerTexts(c.req.param("id"), { limit: Math.min(500, Number(c.req.query("limit") ?? 100)) })));
  op.post("/businesses/:id/owner-texts/:seq/done", (c) => c.json({ ok: repo.finishOwnerText(c.req.param("id"), Number(c.req.param("seq")), d.clock().toISOString()) }));
  op.post("/businesses/:id/alerts/:seq/done", (c) => c.json({ ok: repo.finishAlert(c.req.param("id"), Number(c.req.param("seq")), d.clock().toISOString()) }));

  // Forget a Jobber connection (to connect a different account on purpose; the connect link won't switch accounts by itself).
  op.delete("/businesses/:id/integrations/jobber", (c) => {
    const id = c.req.param("id");
    if (!repo.exists(id)) throw new NotFound("No such business");
    repo.deleteIntegration(id, "jobber");
    repo.audit(id, "operator", "jobber.disconnect");
    return c.json({ ok: true });
  });

  /* ----------------------------- operator console reads -----------------------------
   * Read-only routes for the live operator console. None of them change anything.
   *   GET /api/review                       everything across all clients that needs a person
   *   GET /api/businesses/:id/people?ids=   names + contact details for customer ids (touches and replies carry ids only)
   *   GET /api/businesses/:id/files         the export files we've read for this business
   *   GET /api/businesses/:id/integrations  field-service connection status (never secrets)
   */
  op.get("/review", (c) => {
    const sla = d.cfg.SLA_FIRST_NUDGE_HOURS;
    const items: Record<string, unknown>[] = [];
    for (const b of repo.listBusinesses()) {
      const l = d.accounts.peek(b.id);
      if (!l) continue;
      const s = l.state;
      const biz = { businessId: b.id, businessName: s.dataset.business.name };
      const people = new Map(s.dataset.customers.map((x) => [x.id, x]));
      // same clock math as the worker's SLA nudges (local wall time)
      const nowLocal = localIso(d.clock(), s.dataset.business.timezone);
      for (const r of s.replies) {
        const who = r.customerId ? people.get(r.customerId) : undefined;
        const person = { customerId: r.customerId, name: who?.name ?? r.from, phone: r.extracted.phone ?? who?.phones[0], email: who?.emails[0] ?? r.from };
        // An AI-drafted answer nobody has sent yet rides along, so it can go out in one click.
        const draft = r.draft ? { draft: r.draft.text, draftNeedsOwner: r.draft.needsOwner } : {};
        if (r.intent === "unclear" && r.status === "new") {
          items.push({ kind: "unclear", ...biz, at: r.receivedAt, replyId: r.id, ...person, text: r.text.slice(0, 1000), ...draft });
        } else if ((r.intent === "wants_it" || r.intent === "wants_price" || r.intent === "question") && r.status === "handed_off" && !r.ownerContactedAt) {
          const hours = (Date.parse(nowLocal) - Date.parse(r.handedOffAt ?? r.receivedAt)) / 3_600_000;
          if (hours >= sla) items.push({ kind: "late_lead", ...biz, at: r.handedOffAt ?? r.receivedAt, replyId: r.id, ...person, intent: r.intent, hours: Math.round(hours), text: r.text.slice(0, 1000), ...draft });
          else if (r.draft) items.push({ kind: "draft", ...biz, at: r.draft.at, replyId: r.id, ...person, intent: r.intent, text: r.text.slice(0, 1000), ...draft });
        }
      }
      // Texts from the owner we couldn't act on (and a yes to the paid plan), and alerts that need a person.
      for (const t of repo.ownerTexts(b.id, { open: true }))
        items.push({ kind: "owner_text", ...biz, at: t.at, seq: t.seq, text: t.body, reply: t.reply, handled: t.handled });
      for (const a of repo.openAlerts(b.id)) items.push({ kind: "alert", ...biz, at: a.at, seq: a.seq, alertKind: a.kind, title: a.title, detail: a.detail ?? "" });
      // Jobber connected and read, nothing planned yet: ready for the operator to look and start the free round.
      // Or their file came in (a sign-up from the site, or an import): same thing, from a file.
      const j = repo.getIntegration(b.id, "jobber");
      const synced = j?.status === "connected" && !!j.last_sync_at;
      const lastFile = s.dataset.imports.at(-1)?.importedAt;
      if ((synced || lastFile) && !s.touches.length && s.dataset.business.plan.stage === "trial")
        items.push({ kind: "ready", ...biz, at: (synced ? j!.last_sync_at : lastFile)!, from: synced ? "jobber" : "file", quotes: s.dataset.quotes.length, customers: s.dataset.customers.length, headline: readiness(s.dataset).headline, needsAddress: (s.dataset.business.mailingAddress?.trim() ?? "").length < 8 });
      const flagged = s.touches.filter((t) => t.flags.length && (t.status === "planned" || t.status === "approved")).slice(0, 100);
      for (const t of flagged)
        items.push({ kind: "flagged_note", ...biz, at: t.dueAt, touchId: t.id, customerId: t.customerId, name: people.get(t.customerId)?.name ?? "", step: t.step, status: t.status, subject: t.subject ?? "", body: t.body, flags: t.flags });
      for (const m of [...repo.ownerMessages(b.id, { delivery: "review" }), ...repo.ownerMessages(b.id, { delivery: "failed" })])
        items.push({ kind: "owner_message", ...biz, at: m.at, messageId: m.id, messageKind: m.kind, delivery: m.delivery, text: m.text });
      // the Guard's brake is holding every note until a person looks
      const health = sendHealth(s);
      if (health.paused) {
        const queued = s.touches.filter((t) => t.status === "approved" || t.status === "planned").length;
        items.push({ kind: "brake", ...biz, at: s.events.find((e) => e.id.startsWith("ev_brake_"))?.at ?? nowLocal, reason: health.reason ?? "", queued });
      }
      // a send that may or may not have gone (a timeout after the server took it, or a crash mid-send)
      for (const t of s.touches.filter((x) => x.status === "sending"))
        if (t.lastError || !t.claimedAt || Date.parse(nowLocal) - Date.parse(t.claimedAt) > 10 * 60_000)
          items.push({ kind: "unsure_send", ...biz, at: t.claimedAt ?? t.dueAt, touchId: t.id, customerId: t.customerId, name: people.get(t.customerId)?.name ?? "", step: t.step, subject: t.subject ?? "", error: t.lastError ?? "The server stopped before it could say." });
      // people the sending platform wouldn't take (last 30 days)
      const cutoff = localIso(new Date(d.clock().getTime() - 30 * 86_400_000), s.dataset.business.timezone);
      for (const t of s.touches.filter((x) => x.status === "skipped" && x.step === 1 && x.lastError?.startsWith(`${d.email.name}:`) && x.dueAt >= cutoff.slice(0, 16)).slice(0, 50))
        items.push({ kind: "not_taken", ...biz, at: t.dueAt, touchId: t.id, customerId: t.customerId, name: people.get(t.customerId)?.name ?? "", reason: t.lastError!.slice(d.email.name.length + 1).trim() });
    }
    // replies nobody could place (an address several clients share, or one we never wrote to)
    const names = new Map(repo.listBusinesses().map((b) => [b.id, b.profile.name]));
    for (const r of repo.inboundReviews()) {
      const ev = r.event as { from?: string; subject?: string; text?: string; receivedAt?: string };
      items.push({ kind: "unmatched_reply", businessId: "", businessName: "", id: r.id, at: ev.receivedAt ?? r.at, from: (ev.from ?? "").toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/)?.[0] ?? ev.from ?? "", subject: ev.subject ?? "", text: String(ev.text ?? "").slice(0, 1000), reason: r.reason, candidates: r.candidates.filter((x) => names.has(x)).map((x) => ({ businessId: x, businessName: names.get(x)! })) });
    }
    // the sending platform can't reach us (webhooks never registered)
    const hooks = webhookSetup(d);
    if (hooks && !hooks.ok) items.push({ kind: "platform", businessId: "", businessName: d.email.name === "instantly" ? "Instantly" : d.email.name, at: hooks.at, title: "Webhooks aren't registered — replies, bounces and unsubscribes may not arrive", detail: hooks.error ?? "" });
    items.sort((x, y) => (String(x.at) < String(y.at) ? -1 : 1));
    return c.json({ now: d.clock().toISOString(), slaHours: sla, items });
  });

  // A reply nobody could place: a person says whose it is (it's then read there, like any reply), or drops it.
  op.post("/inbound-review/:rid", async (c) => {
    const body = z.object({ businessId: z.string().optional(), dismiss: z.boolean().optional() }).parse(await c.req.json());
    const r = repo.inboundReview(c.req.param("rid"));
    if (!r || r.status !== "open") return c.json({ error: "No such reply waiting" }, 404);
    if (body.dismiss) {
      repo.closeInboundReview(r.id, "dismissed");
      repo.audit(undefined, "operator", "inbound.dismiss", { id: r.id });
      return c.json({ ok: true });
    }
    if (!body.businessId || !repo.exists(body.businessId)) return c.json({ error: "Pick the client it belongs to" }, 400);
    await handleInbound(d, { ...(r.event as InboundEvent), businessId: body.businessId } as InboundEvent);
    repo.closeInboundReview(r.id, "assigned", body.businessId);
    repo.audit(body.businessId, "operator", "inbound.assign", { id: r.id });
    return c.json({ ok: true });
  });

  op.get("/businesses/:id/people", (c) => {
    const l = d.accounts.peek(c.req.param("id"));
    if (!l) throw new NotFound("No such business");
    const ids = new Set((c.req.query("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 500));
    return c.json(
      l.state.dataset.customers
        .filter((x) => ids.has(x.id))
        .map((x) => ({ id: x.id, name: x.name, email: x.emails[0] ?? null, phone: x.phones[0] ?? null, street: x.address?.street ?? null, city: x.address?.city ?? null })),
    );
  });

  op.get("/businesses/:id/files", (c) => {
    const l = d.accounts.peek(c.req.param("id"));
    if (!l) throw new NotFound("No such business");
    return c.json(
      l.state.dataset.imports
        .map((f) => ({ id: f.id, fileName: f.fileName, importedAt: f.importedAt, source: f.source, kind: f.kind, rows: f.rows, accepted: f.accepted, rejected: f.rejected, warnings: f.warnings }))
        .sort((x, y) => (x.importedAt < y.importedAt ? 1 : -1)),
    );
  });

  op.get("/businesses/:id/integrations", (c) => {
    const id = c.req.param("id");
    if (!repo.exists(id)) throw new NotFound("No such business");
    const j = repo.getIntegration(id, "jobber");
    return c.json({
      jobber: { available: !!d.fsm.jobber, connected: j?.status === "connected" && !!j.secret, status: j?.status ?? "not_connected", lastSyncAt: j?.last_sync_at ?? null, lastError: j?.last_error ?? null },
    });
  });
  /* --------------------------- end operator console reads --------------------------- */

  // (mounted after the owner routes below: op's "*" guard would otherwise swallow /api/owner/*)

  /* ----------------------------- owner API (signed link) ----------------------------- */
  const own = new Hono<Env>();
  own.use("/:token/*", owner);
  own.get("/:token/overview", (c) => {
    const l = d.accounts.peek(c.get("bid")!);
    if (!l) throw new NotFound("No such business");
    return c.json(overview(l.state, l.paused));
  });
  own.get("/:token/replies", (c) => {
    const l = d.accounts.peek(c.get("bid")!);
    if (!l) throw new NotFound("No such business");
    return c.json(l.state.replies.filter((r) => !["auto_reply", "bounce"].includes(r.intent)).sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)));
  });
  own.post("/:token/replies/:rid/outcome", async (c) => {
    const body = Outcome.parse(await c.req.json());
    await logOutcome(c.get("bid")!, c.req.param("rid"), body.outcome, body.value);
    return c.json({ ok: true });
  });
  own.post("/:token/pause", async (c) => {
    const { paused } = z.object({ paused: z.boolean() }).parse(await c.req.json());
    await holdSending(d, c.get("bid")!, paused ? "pause" : "resume");
    repo.audit(c.get("bid"), "owner", paused ? "pause" : "resume");
    return c.json({ ok: true });
  });
  // The Recovered Ledger on the owner's private link: every win, checkable against their own books.
  own.get("/:token/ledger", (c) => {
    const l = d.accounts.peek(c.get("bid")!);
    if (!l) throw new NotFound("No such business");
    return c.json({ rules: COUNTING_RULES, rows: ledgerRows(l.state), totals: totals(l.state) });
  });
  own.get("/:token/ledger.csv", (c) => {
    const l = d.accounts.peek(c.get("bid")!);
    if (!l) throw new NotFound("No such business");
    return c.body(ledgerCSV(l.state), 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="recovered-ledger.csv"' });
  });
  own.post("/:token/ledger/:rid/not-ours", async (c) => {
    const { reason } = Dispute.parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: await dispute(c.get("bid")!, c.req.param("rid"), reason ?? "not ours", "owner") });
  });
  app.route("/api/owner", own);

  op.get("/businesses/:id/ledger", (c) => {
    const l = d.accounts.peek(c.req.param("id"));
    if (!l) throw new NotFound("No such business");
    return c.json({ rules: COUNTING_RULES, rows: ledgerRows(l.state), totals: totals(l.state) });
  });
  op.get("/businesses/:id/ledger.csv", (c) => {
    const l = d.accounts.peek(c.req.param("id"));
    if (!l) throw new NotFound("No such business");
    return c.body(ledgerCSV(l.state), 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="recovered-ledger.csv"' });
  });
  op.post("/businesses/:id/ledger/:rid/not-ours", async (c) => {
    const { reason } = Dispute.parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: await dispute(c.req.param("id"), c.req.param("rid"), reason ?? "not ours", "operator") });
  });
  app.route("/api", op);

  async function dispute(bid: string, rid: string, reason: string, by: string): Promise<boolean> {
    let ok = false;
    await d.accounts.withAccount(bid, (state) => {
      ok = disputeRecovery(state, rid, reason, by, localIso(d.clock(), state.dataset.business.timezone).slice(0, 19));
    });
    if (ok) repo.audit(bid, by, "ledger.not_ours", { rid, reason });
    return ok;
  }

  async function logOutcome(bid: string, rid: string, outcome: Reply["outcome"], value?: number) {
    const { markContacted } = await import("@qa/engine");
    await d.accounts.withAccount(bid, (state) => markContacted(state, rid, localIso(d.clock(), state.dataset.business.timezone), outcome, value));
  }

  /* ------------------------ sign-up from the site ------------------------ */
  // The site's Start button: the owner's own file (read in their browser first), company, first name, cell and
  // consent. We make the account, read the file and put it in the operator's queue with the Money Map ready.
  // Nothing goes to anyone from here: the operator adds the mailing address, looks at the first note and plans,
  // and only then does the owner get a text (the first note, word for word, waiting for their OK).
  const origins = d.cfg.SIGNUP_ORIGINS.split(",").map((x) => x.trim()).filter(Boolean);
  app.use("/start", cors({ origin: origins.length ? origins : "*", allowMethods: ["POST", "OPTIONS"], allowHeaders: ["content-type"], maxAge: 86400 }));
  const signupHits = new Map<string, number[]>();
  const Signup = z.object({
    company: z.string().trim().min(2).max(120),
    first: z.string().trim().min(1).max(60),
    cell: z.string().max(40),
    signer: z.string().trim().max(60).optional(),
    trade: z.string().max(40).optional(),
    software: z.string().max(40).optional(),
    consent: z.literal(true),
    files: z.array(z.object({ name: z.string().min(1).max(200), text: z.string().min(1) })).max(5).optional(),
    audit: z.object({ quotes: z.number(), silent: z.object({ count: z.number(), value: z.number() }), perMonth: z.number() }).partial().passthrough().optional(),
    ref: z.string().max(200).optional(),
    /** A field people can't see; anything in it is a bot. */
    website: z.string().max(500).optional(),
  });
  app.post("/start", async (c) => {
    if (d.cfg.SIGNUPS !== "on") return c.json({ error: "Sign-ups are closed right now. Text Jack instead." }, 503);
    // five tries an hour from one address; enough for a typo, not for a script
    const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0]!.trim() || c.req.header("x-real-ip") || "local";
    const hour = Date.now() - 3_600_000;
    const hits = (signupHits.get(ip) ?? []).filter((t) => t > hour);
    if (hits.length >= 5) return c.json({ error: "Too many tries. Text Jack instead." }, 429);
    signupHits.set(ip, [...hits, Date.now()]);
    if (signupHits.size > 5000) signupHits.clear();
    const parsed = Signup.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues.some((i) => i.path[0] === "consent") ? "Tick the box so we can follow up on your behalf." : "Something's missing. Check the company, your name and your cell." }, 400);
    const f = parsed.data;
    if (f.website) return c.json({ ok: true, id: "thanks" }, 201);
    const cell = ownerCell(f.cell);
    if (!cell) return c.json({ error: "That doesn't look like a cell we can text." }, 400);
    if ((f.files ?? []).reduce((a, x) => a + x.text.length, 0) > 9 * MB) return c.json({ error: "That file's too big to send here. Jack will ask for it by text." }, 413);
    const trade = (TRADES as readonly string[]).includes(f.trade ?? "") ? (f.trade as TradeId) : "general";
    const software: SourceSystem = /jobber/i.test(f.software ?? "") ? "jobber" : /housecall/i.test(f.software ?? "") ? "housecall_pro" : "unknown";
    // The same owner pressing Start twice (or coming back with the file) lands on the same account.
    const again = repo.listBusinesses().find((b) => b.profile.ownerPhone === cell && b.profile.name.toLowerCase() === f.company.toLowerCase());
    let id = again?.id;
    if (!id) {
      id = `${f.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "shop"}-${randomBytes(3).toString("hex")}`;
      const today = localIso(d.clock(), "America/New_York").slice(0, 10);
      const signer = f.signer?.trim() || f.first;
      const profile = defaultProfile({ name: f.company, trade, ownerName: f.first, ownerPhone: cell, signerName: signer, signerRole: signer.toLowerCase() === f.first.toLowerCase() ? "owner" : "office", mailingAddress: "", timezone: "America/New_York" }, id, today);
      profile.software = software;
      await d.accounts.create(profile, today);
      rotateLinks(d, id);
    }
    let read = "";
    if (f.files?.length) {
      try {
        const res = await importFiles(d, id, f.files as FileIn[]);
        const s = d.accounts.peek(id)!.state;
        read = `Their file is in (${res.map((r) => `${r.accepted} ${r.kind}s`).join(", ")}): ${s.summary?.audit?.silent.count ?? 0} quotes never answered, ${fmtMoney(s.summary?.audit?.silent.value ?? 0, { compact: true })}.`;
      } catch (e) {
        read = `Their file didn't read (${(e as Error).message.slice(0, 120)}). Ask them for the export by text.`;
      }
    } else read = "No file yet. Ask for their export by text (or send the Connect Jobber link).";
    await raiseAlert(d, id, {
      kind: "signup",
      title: `New sign-up: ${f.company}`,
      detail: `${f.first}, ${cell}${f.software ? `, uses ${f.software}` : ""}. ${read} Next: add their mailing address, read the first note, then Plan — they get the first note by text and it waits for their OK.`,
    });
    repo.audit(id, "public", again ? "signup.again" : "signup", { ref: f.ref, software: f.software, audit: f.audit, files: f.files?.map((x) => x.name) });
    return c.json({ ok: true, id }, 201);
  });

  /* ----------------------------- unsubscribe ----------------------------- */
  const unsub = async (c: Context<Env>) => {
    const r = await unsubscribeByToken(d, c.req.param("token") ?? "");
    const msg = r.ok ? `You're unsubscribed${r.business ? ` from ${escapeHtml(r.business)}` : ""}. You won't hear from us again.` : "That link didn't work, but reply \"stop\" to any note and you'll be removed.";
    return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><body style="font:16px/1.5 system-ui;padding:40px;max-width:520px;margin:auto"><p>${msg}</p></body>`);
  };
  app.get("/u/:token", unsub);
  app.post("/u/:token", unsub); // RFC 8058 one-click

  /* ----------------------------- webhooks ----------------------------- */
  const secretOk = (c: Context<Env>) => {
    const s = c.req.param("secret") ?? "";
    const a = Buffer.from(s);
    const b = Buffer.from(d.cfg.WEBHOOK_SECRET);
    return a.length === b.length && a.equals(b);
  };

  app.post("/webhooks/instantly/:secret", async (c) => {
    if (!secretOk(c)) return c.json({ error: "forbidden" }, 403);
    const raw = await c.req.text();
    // Instantly retries deliveries; the event's own identity (not the raw bytes) dedupes them.
    const id = instantlyWebhookKey(safeJson(raw)) ?? `instantly:${createHash("sha1").update(raw).digest("hex")}`;
    // only a delivery that went through is a duplicate; one that failed or died mid-way is taken again
    const claim = repo.claimWebhook(id, "instantly", raw, d.clock().toISOString());
    if (claim === "duplicate") return c.json({ ok: true, duplicate: true });
    if (claim === "busy") return c.json({ ok: false, busy: true }, 503, { "Retry-After": "120" });
    const ev = d.parsers.instantly?.(safeJson(raw));
    if (!ev) {
      repo.finishWebhook(id, "ignored");
      return c.json({ ok: true, ignored: true });
    }
    // One reply, one reading: the reply backstop claims the same key when it reads this email first.
    const emailKey = ev.type === "reply" && ev.replyEmailId ? replyEmailKey("instantly", ev.replyEmailId) : undefined;
    const mine = emailKey ? repo.claimWebhook(emailKey, "instantly", raw, d.clock().toISOString()) : "new";
    if (mine === "duplicate" || mine === "busy") {
      repo.finishWebhook(id, "ignored", undefined, "already read by the reply check");
      return c.json({ ok: true, duplicate: true });
    }
    try {
      const done = await handleInbound(d, ev);
      const bids = done.businessIds.join(",") || undefined;
      repo.finishWebhook(id, "processed", bids, done.review);
      if (emailKey) repo.finishWebhook(emailKey, "processed", bids, done.review);
    } catch (e) {
      repo.finishWebhook(id, "failed", undefined, (e as Error).message);
      repo.enqueue("inbound.retry", { event: JSON.stringify(ev) }, { runAt: new Date(d.clock().getTime() + 60000).toISOString() });
    }
    return c.json({ ok: true });
  });

  /**
   * Inbound email (Postmark/Mailgun-style JSON or {from, subject, text}).
   * Three jobs: replies to our notes; owners forwarding their Jobber/HCP export emails to their import
   * address ("import+<token>@...") — the files are read automatically; and owners forwarding new requests
   * to their requests address ("requests+<token>@...") — answered from the office like a Jobber request.
   */
  app.post("/webhooks/inbound-email/:secret", async (c) => {
    if (!secretOk(c)) return c.json({ error: "forbidden" }, 403);
    const raw = await c.req.text();
    const body = safeJson(raw) as Record<string, unknown> | undefined;
    if (!body) return c.json({ error: "Expected JSON" }, 400);
    const id = `email:${String(body.MessageID ?? body["message-id"] ?? createHash("sha1").update(raw).digest("hex"))}`;
    // only a delivery that went through is a duplicate: the provider's retry of a failed one is taken again
    const claim = repo.claimWebhook(id, "email", raw, d.clock().toISOString());
    if (claim === "duplicate") return c.json({ ok: true, duplicate: true });
    if (claim === "busy") return c.json({ ok: false, busy: true }, 503, { "Retry-After": "120" });
    const from = String((body.FromFull as { Email?: string } | undefined)?.Email ?? body.From ?? body.from ?? body.sender ?? "");
    const to = String(body.To ?? body.to ?? body.recipient ?? "");
    const subject = String(body.Subject ?? body.subject ?? "");
    const text = String(body.StrippedTextReply || body.TextBody || body["stripped-text"] || body.text || body["body-plain"] || "");
    const headers = (body.Headers as { Name: string; Value: string }[] | undefined) ?? [];
    const header = (name: RegExp) => headers.find((h) => name.test(h.Name))?.Value;
    // the thread (In-Reply-To, then References) names the note it answers, and so the business
    const inReplyTo = header(/^in-reply-to$/i) ?? (body["In-Reply-To"] as string | undefined);
    const references = (header(/^references$/i) ?? (body.References as string | undefined) ?? "").split(/\s+/).filter(Boolean);
    const attachments = ((body.Attachments as { Name: string; Content: string; ContentType?: string }[] | undefined) ?? []).filter((a) => /\.(csv|tsv|txt)$/i.test(a.Name) || /csv/.test(a.ContentType ?? ""));
    // New requests the owner forwards: the whole message (a forward is "quoted" text to a reply parser)
    const requestsToken = to.match(/requests\+([A-Za-z0-9_.-]+)@/)?.[1];
    if (requestsToken) {
      const bid = readLinkToken(d, "requests", requestsToken);
      if (!bid) {
        repo.finishWebhook(id, "ignored", undefined, "bad requests token");
        return c.json({ ok: true, ignored: true });
      }
      const html = String(body.HtmlBody ?? body["body-html"] ?? body.html ?? "");
      const full = String(body.TextBody || body["body-plain"] || body.text || "") || (html ? htmlToText(html) : "");
      const res = await takeForwardedRequest(d, bid, { subject, text: full, from, receivedAt: d.clock().toISOString() });
      repo.finishWebhook(id, res.taken ? "processed" : "ignored", bid, res.why);
      return c.json({ ok: true, ...res });
    }
    const importToken = to.match(/import\+([A-Za-z0-9_.-]+)@/)?.[1];
    if (importToken) {
      const bid = readLinkToken(d, "import", importToken);
      if (!bid || !attachments.length) {
        repo.finishWebhook(id, "ignored", undefined, "bad import token or no CSV attachment");
        return c.json({ ok: true, ignored: true });
      }
      // Excel's classic CSV is Windows-1252, not UTF-8
      const files = attachments.map((a) => ({ name: a.Name, text: decodeText(Buffer.from(a.Content, "base64")) }));
      const res = await importFiles(d, bid, files);
      repo.finishWebhook(id, "processed", bid);
      return c.json({ ok: true, imported: res });
    }
    const messageId = header(/^message-id$/i) ?? (body["Message-ID"] as string | undefined);
    const ev: InboundEvent = { type: "reply", from, subject, text, receivedAt: new Date(String(body.Date ?? d.clock().toISOString())).toISOString(), inReplyTo, messageId, ...(references.length ? { references } : {}), ...(to ? { to: [to] } : {}) };
    try {
      const done = await handleInbound(d, ev);
      repo.finishWebhook(id, done.businessIds.length || done.review ? "processed" : "ignored", done.businessIds.join(",") || undefined, done.review);
    } catch (e) {
      // a stop or a yes must not be lost to a hiccup: retried from here (reading a reply twice is harmless)
      repo.finishWebhook(id, "failed", undefined, (e as Error).message);
      repo.enqueue("inbound.retry", { event: JSON.stringify(ev) }, { runAt: new Date(d.clock().getTime() + 60000).toISOString() });
      d.log(`[inbound] ${id} failed, retry queued: ${(e as Error).message}`);
    }
    return c.json({ ok: true });
  });

  /** The owner texts back ("booked 2400", "done", "pause"). Replies with TwiML. */
  app.post("/webhooks/sms/:secret", async (c) => {
    if (!secretOk(c)) return c.text("forbidden", 403);
    const form = (await c.req.parseBody()) as Record<string, string>;
    if (d.cfg.SMS_PROVIDER === "twilio" && d.cfg.TWILIO_AUTH_TOKEN) {
      const url = `${d.cfg.PUBLIC_URL.replace(/\/$/, "")}${c.req.path}`;
      if (!(await verifyTwilioSignature(d.cfg.TWILIO_AUTH_TOKEN, url, form, c.req.header("x-twilio-signature")))) return c.text("bad signature", 403);
    }
    const res = await ownerCommand(d, form.From ?? "", form.Body ?? "");
    repo.audit(res.businessId, "owner-sms", "command", { body: form.Body });
    return c.body(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXmlText(res.reply)}</Message></Response>`, 200, { "Content-Type": "text/xml" });
  });

  /** Jobber: something changed. Ack fast (1s budget), then sync in the background. */
  app.post("/webhooks/jobber", async (c) => {
    const conn = d.fsm.jobber;
    if (!conn) return c.json({ error: "Jobber not configured" }, 404);
    const raw = await c.req.text();
    if (!conn.verifyWebhook(raw, Object.fromEntries(Object.entries(c.req.header()).map(([k, v]) => [k.toLowerCase(), v])))) return c.json({ error: "bad signature" }, 401);
    const ev = conn.parseWebhook(raw);
    if (!ev) return c.json({ ok: true, ignored: true });
    const bid = repo.businessForIntegrationAccount("jobber", ev.accountId);
    if (bid) repo.enqueue("jobber.sync", { topic: ev.topic }, { businessId: bid, runAt: new Date(d.clock().getTime() + 90_000).toISOString(), dedupeKey: `jobber.sync:${bid}` });
    return c.json({ ok: true });
  });

  /* ----------------------------- OAuth: Jobber ----------------------------- */
  // The connect link (texted to the owner) is long-lived; each trip to Jobber gets its own single-use state that
  // expires in 30 minutes, so a copied authorize URL or browser history can't be replayed.
  const OAUTH_STATE_MS = 30 * 60000;
  app.get("/oauth/jobber/start", (c) => {
    const conn = d.fsm.jobber;
    if (!conn) return c.text("Jobber isn't configured on this server.", 404);
    const bid = readLinkToken(d, "oauth|jobber", c.req.query("state") ?? "");
    if (!bid) return c.text("This connect link isn't valid anymore. Ask us for a new one.", 400);
    const nonce = randomBytes(18).toString("base64url");
    repo.putOAuthState(nonce, bid, "jobber", new Date(d.clock().getTime() + OAUTH_STATE_MS).toISOString());
    return c.redirect(conn.authorizeUrl(nonce, `${d.cfg.PUBLIC_URL}/oauth/jobber/callback`));
  });

  app.get("/oauth/jobber/callback", async (c) => {
    const conn = d.fsm.jobber;
    if (!conn) return c.text("Jobber isn't configured on this server.", 404);
    const code = c.req.query("code");
    const bid = code ? repo.takeOAuthState(c.req.query("state") ?? "", "jobber", d.clock().toISOString()) : undefined;
    if (!bid || !repo.exists(bid)) return c.text("Connection failed: that link expired or was already used. Open the connect link we sent you again.", 400);
    const tokens = await conn.exchangeCode(code!, `${d.cfg.PUBLIC_URL}/oauth/jobber/callback`);
    // A connect link never moves a client to a different Jobber account: that would pour someone else's clients
    // and quotes into this contractor's notes. The operator is told, and can disconnect on purpose to switch.
    const cur = repo.getIntegration(bid, "jobber");
    if (cur?.account_id && tokens.accountId && cur.account_id !== tokens.accountId) {
      repo.audit(bid, "owner", "jobber.rebind_refused", { current: cur.account_id, attempted: tokens.accountId });
      await raiseAlert(d, bid, {
        kind: "jobber_rebind",
        title: "Someone tried to connect a different Jobber account",
        detail: `This client is connected to Jobber account ${cur.account_id}; the connect link was used with ${tokens.accountId}${tokens.accountName ? ` (${tokens.accountName})` : ""}. Nothing changed. If the owner really switched accounts, disconnect Jobber for them first, then send the connect link again.`,
      });
      return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not connected</title><body style="font:16px/1.5 system-ui;padding:40px;max-width:520px;margin:auto"><h2>That's a different Jobber account.</h2><p>This business is already connected to another Jobber account, so we didn't switch it. We've let Jack know; he'll sort it out with you.</p></body>`, 409);
    }
    repo.putIntegration(bid, "jobber", { accountId: tokens.accountId ?? null, secret: encrypt(d.cfg.APP_SECRET, JSON.stringify(tokens)), status: "connected", cursor: null, lastError: null });
    repo.enqueue("jobber.sync", { initial: true }, { businessId: bid, runAt: d.clock().toISOString(), dedupeKey: `jobber.sync:${bid}` });
    repo.audit(bid, "owner", "jobber.connected", { accountId: tokens.accountId });
    return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected</title><body style="font:16px/1.5 system-ui;padding:40px;max-width:520px;margin:auto"><h2>Jobber is connected.</h2><p>We're reading your quotes now. You'll get a text when your drawer scan is ready. You can close this page.</p></body>`);
  });

  return app;
}

const MB = 1024 * 1024;

/** The largest body each route takes: webhooks are small; imports (and exports forwarded by email) are files. */
export function bodyCap(path: string): number {
  if (path.startsWith("/webhooks/inbound-email/")) return 25 * MB;
  if (path === "/start") return 10 * MB;
  if (path.startsWith("/webhooks/")) return 256 * 1024;
  if (/^\/api\/businesses\/[^/]+\/imports$/.test(path)) return 25 * MB;
  return 2 * MB;
}

/** The owner's cell is Twilio's To, so it is stored as E.164. Undefined: none given; null: not a number we can text. */
function ownerCell(raw: string | undefined): string | undefined | null {
  if (raw === undefined || !raw.trim()) return undefined;
  return normalizePhone(raw) ?? null;
}

const BAD_CELL = "That owner's cell number doesn't look right. Use their real 10-digit mobile number, like 603-555-0142.";

function badCell(c: Context<Env>) {
  return c.json({ error: BAD_CELL, issues: [{ path: ["ownerPhone"], message: BAD_CELL }] }, 400);
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** Element text in XML only needs &, < and > escaped; apostrophes stay readable in the owner's text. */
function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
