import { createHash } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  BREAKAGE_LABEL,
  closeMessage,
  guaranteeCheck,
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
} from "@qa/engine";
import { z } from "zod";
import { instantlyWebhookKey } from "../integrations/instantly/webhooks.ts";
import type { InboundEvent } from "../contracts.ts";
import { encrypt } from "../core/crypto.ts";
import { NotFound } from "../core/accounts.ts";
import { replyEmailKey } from "../core/backstop.ts";
import { localIso } from "../core/clock.ts";
import { answerInThread, approve, deliverOwnerMessages, handleInbound, importFiles, ownerCommand, plan, rescan, sign, syncFsm, unsubscribeByToken, verifySigned, type Deps } from "../core/ops.ts";
import { verifyTwilioSignature } from "../providers/sms.ts";

export interface HttpDeps extends Deps {
  parsers: { instantly?: (body: unknown) => InboundEvent | undefined };
}

type Env = { Variables: { bid?: string; actor: string } };

const TRADES = ["tree", "lawn", "landscape", "septic", "fence", "concrete", "pressure_washing", "gutter", "window_cleaning", "pool", "pest", "hvac", "junk_removal", "painting", "roofing", "irrigation", "chimney", "cleaning", "general"] as const;

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
  voice: z.object({ mentionPrice: z.boolean(), offerOptions: z.boolean(), wordSwaps: z.array(z.tuple([z.string(), z.string()])) }).partial().optional(),
  persistence: z.object({ seasonalCheckIn: z.boolean(), maxNotesPerYear: z.number().int().min(1).max(12), holdoutPct: z.number().min(0).max(0.3) }).partial().optional(),
  plan: z.object({ stage: z.enum(["trial", "paying", "paused", "cancelled"]), trialSize: z.number().int().min(10).max(1000), monthlyPrice: z.number().min(0), paidOn: z.string().optional() }).partial().optional(),
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
    if (err instanceof z.ZodError) return c.json({ error: "Invalid input", issues: err.issues }, 400);
    d.log(`[http] ${c.req.method} ${c.req.path} failed: ${err.stack ?? err}`);
    return c.json({ error: "Something went wrong on our side." }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true, businesses: repo.listBusinesses().length, email: d.email.name, sms: d.notifier.name, ai: d.llm ? d.llm.model : null, time: d.clock().toISOString() }));

  /* ----------------------------- auth ----------------------------- */
  const operator: MiddlewareHandler<Env> = async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const a = Buffer.from(token);
    const b = Buffer.from(d.cfg.OPERATOR_TOKEN);
    if (a.length !== b.length || !a.equals(b)) return c.json({ error: "Operator token required" }, 401);
    c.set("actor", "operator");
    await next();
  };
  const owner: MiddlewareHandler<Env> = async (c, next) => {
    const payload = verifySigned(d.cfg.APP_SECRET, c.req.param("token") ?? "");
    if (!payload?.startsWith("owner|")) return c.json({ error: "This link isn't valid anymore." }, 401);
    c.set("bid", payload.slice("owner|".length));
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
    repo.audit(id, "operator", "business.create", { name: input.name });
    return c.json({ id, ownerLink: `${d.cfg.PUBLIC_URL}/o/${sign(d.cfg.APP_SECRET, `owner|${id}`)}`, importAddressToken: sign(d.cfg.APP_SECRET, `import|${id}`) }, 201);
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
    await d.accounts.withAccount(id, (state) => {
      const b = state.dataset.business;
      const { voice, persistence, plan: planPatch, ...rest } = patch;
      Object.assign(b, rest);
      if (rest.ownerName) b.ownerFirstName = rest.ownerName.split(/\s+/)[0] ?? b.ownerFirstName;
      if (voice) b.voice = { ...b.voice, ...voice };
      if (persistence) b.persistence = { ...b.persistence, ...persistence };
      if (planPatch) b.plan = { ...b.plan, ...planPatch };
    });
    repo.audit(id, "operator", "business.update", patch);
    return c.json({ ok: true });
  });

  op.delete("/businesses/:id", (c) => {
    const id = c.req.param("id");
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
    d.accounts.setPaused(c.req.param("id"), paused);
    if (d.email.kind === "sequencer") {
      const state = d.accounts.peek(c.req.param("id"))?.state;
      const campaigns = new Set((state?.touches ?? []).map((t) => t.providerId?.split(":")[1]).filter(Boolean) as string[]);
      for (const cid of campaigns) await d.email.pauseCampaign(state!.dataset.business, cid, paused);
    }
    repo.audit(c.req.param("id"), "operator", paused ? "pause" : "resume");
    return c.json({ ok: true });
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
    const body = z.object({ subject: z.string().min(1).max(120).optional(), body: z.string().min(20).max(4000).optional(), status: z.enum(["approved", "planned", "cancelled"]).optional() }).parse(await c.req.json());
    let ok = false;
    await d.accounts.withAccount(c.req.param("id"), async (state) => {
      const t = state.touches.find((x) => x.id === c.req.param("tid"));
      if (!t || t.status === "sent") return;
      const { lint } = await import("@qa/engine");
      if (body.subject) t.subject = body.subject;
      if (body.body) t.body = body.body;
      if (body.status) t.status = body.status;
      t.flags = lint(t.subject ?? "", t.body, { firstName: "", job: "", requireJob: false });
      ok = true;
    });
    return c.json({ ok });
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
    d.accounts.repo.db.run("UPDATE owner_messages SET delivery = 'pending' WHERE business_id = ? AND id = ? AND delivery IN ('review','failed')", c.req.param("id"), c.req.param("mid"));
    await deliverOwnerMessages(d, c.req.param("id"), { allowBilling: true });
    repo.audit(c.req.param("id"), "operator", "owner-message.approve", { id: c.req.param("mid") });
    return c.json({ ok: true });
  });

  op.get("/businesses/:id/close-preview", (c) => {
    const l = d.accounts.peek(c.req.param("id"));
    if (!l) throw new NotFound("No such business");
    return c.json({ text: closeMessage(l.state) });
  });

  op.post("/businesses/:id/sync", async (c) => c.json((await syncFsm(d, c.req.param("id"), "jobber")) ?? { error: "Not connected" }));

  op.get("/businesses/:id/links", (c) => {
    const id = c.req.param("id");
    return c.json({
      owner: `${d.cfg.PUBLIC_URL}/o/${sign(d.cfg.APP_SECRET, `owner|${id}`)}`,
      connectJobber: `${d.cfg.PUBLIC_URL}/oauth/jobber/start?state=${encodeURIComponent(sign(d.cfg.APP_SECRET, `oauth|jobber|${id}`))}`,
      importToken: sign(d.cfg.APP_SECRET, `import|${id}`),
    });
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
        if (r.intent === "unclear" && r.status === "new") {
          items.push({ kind: "unclear", ...biz, at: r.receivedAt, replyId: r.id, ...person, text: r.text.slice(0, 1000) });
        } else if ((r.intent === "wants_it" || r.intent === "wants_price" || r.intent === "question") && r.status === "handed_off" && !r.ownerContactedAt) {
          const hours = (Date.parse(nowLocal) - Date.parse(r.handedOffAt ?? r.receivedAt)) / 3_600_000;
          if (hours >= sla) items.push({ kind: "late_lead", ...biz, at: r.handedOffAt ?? r.receivedAt, replyId: r.id, ...person, intent: r.intent, hours: Math.round(hours), text: r.text.slice(0, 1000) });
        }
      }
      const flagged = s.touches.filter((t) => t.flags.length && (t.status === "planned" || t.status === "approved")).slice(0, 100);
      for (const t of flagged)
        items.push({ kind: "flagged_note", ...biz, at: t.dueAt, touchId: t.id, customerId: t.customerId, name: people.get(t.customerId)?.name ?? "", step: t.step, status: t.status, subject: t.subject ?? "", body: t.body, flags: t.flags });
      for (const m of [...repo.ownerMessages(b.id, { delivery: "review" }), ...repo.ownerMessages(b.id, { delivery: "failed" })])
        items.push({ kind: "owner_message", ...biz, at: m.at, messageId: m.id, messageKind: m.kind, delivery: m.delivery, text: m.text });
    }
    items.sort((x, y) => (String(x.at) < String(y.at) ? -1 : 1));
    return c.json({ now: d.clock().toISOString(), slaHours: sla, items });
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
    d.accounts.setPaused(c.get("bid")!, paused);
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
    if (!repo.logWebhook(id, "instantly", raw, d.clock().toISOString())) return c.json({ ok: true, duplicate: true });
    const ev = d.parsers.instantly?.(safeJson(raw));
    if (!ev) {
      repo.finishWebhook(id, "ignored");
      return c.json({ ok: true, ignored: true });
    }
    // One reply, one reading: the reply backstop claims the same key when it reads this email first.
    const emailKey = ev.type === "reply" && ev.replyEmailId ? replyEmailKey("instantly", ev.replyEmailId) : undefined;
    if (emailKey && !repo.logWebhook(emailKey, "instantly", raw, d.clock().toISOString())) {
      repo.finishWebhook(id, "ignored", undefined, "already read by the reply check");
      return c.json({ ok: true, duplicate: true });
    }
    try {
      const bid = await handleInbound(d, ev);
      repo.finishWebhook(id, "processed", bid);
      if (emailKey) repo.finishWebhook(emailKey, "processed", bid);
    } catch (e) {
      repo.finishWebhook(id, "failed", undefined, (e as Error).message);
      repo.enqueue("inbound.retry", { event: JSON.stringify(ev) }, { runAt: new Date(d.clock().getTime() + 60000).toISOString() });
    }
    return c.json({ ok: true });
  });

  /**
   * Inbound email (Postmark/Mailgun-style JSON or {from, subject, text}).
   * Two jobs: replies to our notes, and owners forwarding their Jobber/HCP export emails
   * to their import address ("import+<token>@...") — the files are read automatically.
   */
  app.post("/webhooks/inbound-email/:secret", async (c) => {
    if (!secretOk(c)) return c.json({ error: "forbidden" }, 403);
    const raw = await c.req.text();
    const body = safeJson(raw) as Record<string, unknown> | undefined;
    if (!body) return c.json({ error: "Expected JSON" }, 400);
    const id = `email:${String(body.MessageID ?? body["message-id"] ?? createHash("sha1").update(raw).digest("hex"))}`;
    if (!repo.logWebhook(id, "email", raw, d.clock().toISOString())) return c.json({ ok: true, duplicate: true });
    const from = String((body.FromFull as { Email?: string } | undefined)?.Email ?? body.From ?? body.from ?? body.sender ?? "");
    const to = String(body.To ?? body.to ?? body.recipient ?? "");
    const subject = String(body.Subject ?? body.subject ?? "");
    const text = String(body.StrippedTextReply || body.TextBody || body["stripped-text"] || body.text || body["body-plain"] || "");
    const headers = (body.Headers as { Name: string; Value: string }[] | undefined) ?? [];
    const inReplyTo = headers.find((h) => /^in-reply-to$/i.test(h.Name))?.Value ?? (body["In-Reply-To"] as string | undefined);
    const attachments = ((body.Attachments as { Name: string; Content: string; ContentType?: string }[] | undefined) ?? []).filter((a) => /\.(csv|tsv|txt)$/i.test(a.Name) || /csv/.test(a.ContentType ?? ""));
    const importToken = to.match(/import\+([A-Za-z0-9_.-]+)@/)?.[1];
    if (importToken) {
      const payload = verifySigned(d.cfg.APP_SECRET, importToken);
      if (!payload?.startsWith("import|") || !attachments.length) {
        repo.finishWebhook(id, "ignored", undefined, "bad import token or no CSV attachment");
        return c.json({ ok: true, ignored: true });
      }
      const bid = payload.slice("import|".length);
      // Excel's classic CSV is Windows-1252, not UTF-8
      const files = attachments.map((a) => ({ name: a.Name, text: decodeText(Buffer.from(a.Content, "base64")) }));
      const res = await importFiles(d, bid, files);
      repo.finishWebhook(id, "processed", bid);
      return c.json({ ok: true, imported: res });
    }
    try {
      const messageId = headers.find((h) => /^message-id$/i.test(h.Name))?.Value ?? (body["Message-ID"] as string | undefined);
      const bid = await handleInbound(d, { type: "reply", from, subject, text, receivedAt: new Date(String(body.Date ?? d.clock().toISOString())).toISOString(), inReplyTo, messageId });
      repo.finishWebhook(id, bid ? "processed" : "ignored", bid);
    } catch (e) {
      repo.finishWebhook(id, "failed", undefined, (e as Error).message);
      throw e;
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
  app.get("/oauth/jobber/start", (c) => {
    const conn = d.fsm.jobber;
    const state = c.req.query("state") ?? "";
    if (!conn) return c.text("Jobber isn't configured on this server.", 404);
    if (!verifySigned(d.cfg.APP_SECRET, state)?.startsWith("oauth|jobber|")) return c.text("This connect link isn't valid.", 400);
    return c.redirect(conn.authorizeUrl(state, `${d.cfg.PUBLIC_URL}/oauth/jobber/callback`));
  });

  app.get("/oauth/jobber/callback", async (c) => {
    const conn = d.fsm.jobber;
    if (!conn) return c.text("Jobber isn't configured on this server.", 404);
    const payload = verifySigned(d.cfg.APP_SECRET, c.req.query("state") ?? "");
    const code = c.req.query("code");
    if (!payload?.startsWith("oauth|jobber|") || !code) return c.text("Connection failed: the link expired or was changed. Ask us for a new one.", 400);
    const bid = payload.slice("oauth|jobber|".length);
    const tokens = await conn.exchangeCode(code, `${d.cfg.PUBLIC_URL}/oauth/jobber/callback`);
    repo.putIntegration(bid, "jobber", { accountId: tokens.accountId ?? null, secret: encrypt(d.cfg.APP_SECRET, JSON.stringify(tokens)), status: "connected", cursor: null, lastError: null });
    repo.enqueue("jobber.sync", { initial: true }, { businessId: bid, dedupeKey: `jobber.sync:${bid}` });
    repo.audit(bid, "owner", "jobber.connected", { accountId: tokens.accountId });
    return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected</title><body style="font:16px/1.5 system-ui;padding:40px;max-width:520px;margin:auto"><h2>Jobber is connected.</h2><p>We're reading your quotes now. You'll get a text when your drawer scan is ready. You can close this page.</p></body>`);
  });

  return app;
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
