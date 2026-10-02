import { createHash, randomBytes } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
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
  type Features,
  type FileIn,
  type Reply,
  type TradeId,
  type SourceSystem,
  fmtMoney,
  undoCancel,
  htmlToText,
  quietRates,
  OFFERED_TRADES,
  addDays,
  addMonths,
  annualRefund,
  grossFees,
  round2,
  isTimeZone,
  TIMEZONES,
  zoneForCell,
  endPass,
  isOnePass,
  billsPass,
  monthlyPlan,
  ONE_PASS,
  onePassPlan,
  passEndMoved,
  passProgress,
  refillRate,
  stageFits,
  billableBookings,
  CHARGE_TEXTS,
  isMonth,
  type PlanState,
  plural,
  soldMonthly,
  paidTogether,
  stoppedCustomers,
} from "@qa/engine";
import { z } from "zod";
import { features, signupOrigins } from "../config.ts";
import { instantlyWebhookKey } from "../integrations/instantly/webhooks.ts";
import type { InboundEvent } from "../contracts.ts";
import { encrypt } from "../core/crypto.ts";
import { NotFound, NotReady } from "../core/accounts.ts";
import { replyEmailKey, webhookSetup } from "../core/backstop.ts";
import { coldEvent, holdsInboxes, inboxTaken } from "../core/senders.ts";
import { localIso } from "../core/clock.ts";
import { setupHealth } from "../core/health.ts";
import { approveChargeText, decideChargeOp, decideFoundOp, markPaid, openPay, pasteCustomer, sendLinkAgain, settleBilling, stripeEvent } from "../core/billing.ts";
import { verifyStripeSignature, type StripeEvent } from "../providers/stripe.ts";
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
  finishCancelWithdrawals,
  linkToken,
  ownerLink,
  paceAlert,
  plan,
  raiseAlert,
  readLinkToken,
  requestToOldAddress,
  rescan,
  rotateLinks,
  setBusinessPaused,
  sign,
  staleLinkToken,
  syncFsm,
  takeBackForChange,
  unsubscribeByToken,
  verifySigned,
  type Deps,
} from "../core/ops.ts";
import { ownerCommand, shortNames } from "../core/owner.ts";
import { pasteOwnerText, textsToSend } from "../core/textsToSend.ts";
import { workerHealth } from "../core/worker.ts";
import { verifyTwilioSignature } from "../providers/sms.ts";

export interface HttpDeps extends Deps {
  parsers: { instantly?: (body: unknown) => InboundEvent | undefined };
}

type Env = { Variables: { bid?: string; actor: string } };

/** One the runtime knows: an unknown zone would stop the account's clock. */
const TimeZone = z.string().refine(isTimeZone, "Not a time zone. Use one like America/Chicago.");

const TRADES = ["tree", "lawn", "landscape", "septic", "fence", "concrete", "pressure_washing", "gutter", "window_cleaning", "pool", "pest", "hvac", "junk_removal", "painting", "roofing", "irrigation", "chimney", "cleaning", "holiday_lighting", "deck", "general"] as const satisfies readonly TradeId[];
// a trade the engine knows but this list leaves out fails the typecheck here
const _everyTrade: Record<Exclude<TradeId, (typeof TRADES)[number]>, never> = {};

/** A client's own sending inboxes: lowercase, each once. */
const Inboxes = z
  .array(z.string().trim().toLowerCase().email())
  .max(20)
  .transform((xs) => [...new Set(xs)]);

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
  timezone: TimeZone.default("America/New_York"),
  replyTo: z.string().email().optional(),
  /** This client's own sending inboxes and the name on them. Left out: no inbox (direct mail: the server's sender), "<signer> at <business>". */
  fromEmails: Inboxes.optional(),
  fromName: z.string().min(2).max(80).optional(),
  businessPhone: z.string().optional(),
  avgJobValue: z.number().positive().optional(),
  annualRevenue: z.number().positive().optional(),
});

// .partial() keeps .default(): a field a patch leaves out must stay as it is, not go back to its default
const ProfilePatch = CreateBusiness.partial().extend({
  trade: z.enum(TRADES).optional(),
  signerRole: z.enum(["owner", "office"]).optional(),
  timezone: TimeZone.optional(),
  // null clears it: the inboxes go back to "<signer> at <business>" (and are renamed)
  fromName: z.string().min(2).max(80).nullable().optional(),
  // none would leave its campaigns in Instantly unable to take any change
  sendDays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
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
      kind: z.enum(["monthly", "one_pass"]),
      // which of these a plan may take depends on its kind (PLAN_STAGES)
      stage: z.enum(["trial", "paying", "running", "done", "paused", "cancelled"]),
      trialSize: z.number().int().min(10).max(1000),
      monthlyPrice: z.number().min(0),
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      billing: z.enum(["monthly", "annual"]),
      annualPrice: z.number().min(0),
      yearsPaidOn: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
      // the one pass's terms
      pricePerBooking: z.number().min(0).max(100000),
      capBookings: z.number().int().min(1).max(100),
      windowDays: z.number().int().min(1).max(365),
      freeFirst: z.number().int().min(0).max(10000),
      // null empties it (patchPlan)
      targetEndOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
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
    fromEmails: input.fromEmails,
    fromName: input.fromName,
    businessPhone: input.businessPhone,
    mailingAddress: input.mailingAddress,
    city: input.city,
    state: input.state,
    timezone: input.timezone,
    avgJobValue: input.avgJobValue,
    annualRevenue: input.annualRevenue,
    // weekday mornings, Monday to Friday
    sendDays: [1, 2, 3, 4, 5],
    sendWindow: [7, 10],
    blackoutWeeks: [],
    minQuoteValue: 300,
    minQuoteAgeDays: 21,
    maxQuoteAgeMonths: 36,
    weeklyNewContacts: 75,
    openCrewWeeks: [],
    // a person reads every reply: no instant answer on the owner's behalf
    autoAck: false,
    voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] },
    // everyone on the list gets the notes: no comparison group held back
    persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0 },
    channels: { email: "live", call_task: "ready", postcard: "coming_soon", sms: "coming_soon", voicemail: "coming_soon", retarget: "coming_soon" },
    plan: monthlyPlan(),
    createdOn: today,
  };
}

/** A plan with a Settings change on it. "Done by" emptied is 30 days from the pass's first send day (none until it's planned). */
function patchPlan(plan: PlanState, patch: z.infer<typeof ProfilePatch>["plan"]): PlanState {
  const { targetEndOn, ...rest } = patch ?? {};
  return { ...plan, ...rest, ...(targetEndOn === null ? { targetEndOn: plan.startedOn && addDays(plan.startedOn, ONE_PASS.days) } : targetEndOn ? { targetEndOn } : {}) };
}

/** A plan that hasn't started yet: a free round, or a one pass, with nothing planned (the caller checks the notes). */
function notStarted(b: BusinessProfile): boolean {
  return b.plan.stage === "trial" || (isOnePass(b.plan) && b.plan.stage === "running");
}

/** A one pass's billable bookings within the cap and past it, and the names of the people its charges are for. */
function billing(state: AccountState) {
  const count = billableBookings(state);
  const names = Object.fromEntries((state.dataset.business.plan.charges ?? []).map((c) => [c.customerId, state.dataset.customers.find((x) => x.id === c.customerId)?.name ?? ""]));
  return { billable: count.billable.length, overCap: count.overCap.length, names };
}

/** Compact business overview for dashboards (never the whole dataset). `features`: what this server sells beyond the two offers. */
export function overview(state: AccountState, paused: boolean, features: Features) {
  const b = state.dataset.business;
  const t = totals(state);
  const pass = isOnePass(b.plan);
  // a pass gone monthly still shows: its bookings are still billed
  const billed = pass || billsPass(b.plan);
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
    // the monthly promise is a monthly plan's (a one pass made from a paying one keeps its first paid day)
    guarantee: b.plan.paidOn && !pass ? guaranteeCheck(state, state.dataset.asOf) : undefined,
    // a one pass: its list, how far through, against its end date
    pass: billed ? passProgress(state) : undefined,
    // and what it bills: billable bookings (charged or waiting for one) against the cap, and who each charge is for
    billing: billed ? billing(state) : undefined,
    // "Who gets monthly": how fast the list refills, once a free 150 or a one pass is over
    refill: state.scan && (pass ? b.plan.stage === "done" : !!state.trialCompletedOn) ? refillRate(state.scan, state.dataset.asOf) : undefined,
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
    features,
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
        return l ? overview(l.state, l.paused, features(d.cfg)) : { business: b.profile, paused: b.paused };
      }),
    ),
  );

  op.post("/businesses", async (c) => {
    const input = CreateBusiness.parse(await c.req.json());
    const cell = ownerCell(input.ownerPhone);
    if (cell === null) return badCell(c);
    const taken = inboxTaken(d, input.id ?? "", input.fromEmails ?? []);
    if (taken) return inboxClash(c, taken);
    const id = input.id ?? `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32)}-${createHash("sha1").update(input.name + d.clock().toISOString()).digest("hex").slice(0, 5)}`;
    const today = localIso(d.clock(), input.timezone).slice(0, 10);
    await d.accounts.create(defaultProfile({ ...input, ownerPhone: cell }, id, today), today);
    // A fresh link key: a reused id never inherits an old client's links, not even as an "old address".
    rotateLinks(d, id, { created: true });
    repo.audit(id, "operator", "business.create", { name: input.name });
    return c.json({ id, ownerLink: ownerLink(d, id), importAddressToken: linkToken(d, "import", id), warnings: sharedCell(id, cell) }, 201);
  });

  op.get("/businesses/:id", (c) => {
    const l = d.accounts.peek(c.req.param("id"));
    if (!l) throw new NotFound("No such business");
    return c.json(overview(l.state, l.paused, features(d.cfg)));
  });

  op.patch("/businesses/:id", async (c) => {
    const patch = ProfilePatch.parse(await c.req.json());
    // the yearly plan is only set up where it's sold
    const p = patch.plan;
    if (!features(d.cfg).yearly && p && (p.billing === "annual" || p.annualPrice !== undefined || p.yearsPaidOn?.length)) return c.json({ error: "The yearly plan isn't sold here (FEATURE_YEARLY is off). Bill them monthly." }, 400);
    if (patch.ownerPhone !== undefined) {
      const cell = ownerCell(patch.ownerPhone);
      if (cell === null) return badCell(c);
      patch.ownerPhone = cell;
    }
    const id = c.req.param("id");
    // one inbox sends for one client: new inboxes, or a client taking its inboxes back (no longer cancelled), are
    // refused when another client holds one of them
    const now = d.accounts.peek(id)?.state.dataset.business;
    const next = now && { ...now, fromEmails: patch.fromEmails ?? now.fromEmails, plan: patchPlan(now.plan, patch.plan) };
    // a stage belongs to a kind of plan: a one pass runs, is done, paused or cancelled; a monthly plan never is "done"
    if (next && !stageFits(next.plan))
      return c.json({ error: `${isOnePass(next.plan) ? "A one pass runs, is done, is paused or is cancelled" : "A monthly plan is in its free round, paying, paused or cancelled"}: “${next.plan.stage}” isn't one of its stages.` }, 400);
    const taken = next && holdsInboxes(next) && (patch.fromEmails || !holdsInboxes(now)) ? inboxTaken(d, id, next.fromEmails ?? []) : undefined;
    if (taken) return inboxClash(c, taken);
    let stageBefore: string | undefined;
    let tradeBefore: string | undefined;
    let endMoved = false;
    let repace = false;
    await d.accounts.withAccount(id, (state) => {
      const b = state.dataset.business;
      stageBefore = b.plan.stage;
      tradeBefore = b.trade;
      const { voice, persistence, plan: planPatch, fromName, ...rest } = patch;
      // an inbox taken off still gets the replies to the notes it sent: they're never read as cold email
      const gone = rest.fromEmails ? (b.fromEmails ?? []).filter((x) => !rest.fromEmails!.includes(x)) : [];
      Object.assign(b, rest);
      if (fromName !== undefined) b.fromName = fromName ?? undefined;
      if (gone.length) b.pastInboxes = [...new Set([...(b.pastInboxes ?? []), ...gone])];
      // the operator set this owner's cell: a sign-up's unconfirmed one is settled
      if (rest.ownerPhone && b.signup?.sharedCell) b.signup = { from: b.signup.from };
      if (rest.ownerName) b.ownerFirstName = rest.ownerName.split(/\s+/)[0] ?? b.ownerFirstName;
      if (voice) b.voice = { ...b.voice, ...voice };
      if (persistence) b.persistence = { ...b.persistence, ...persistence };
      if (planPatch) {
        const before = b.plan;
        const next = patchPlan(before, planPatch);
        const listed = planPatch.yearsPaidOn;
        // Taking off the year the first paid day points to (MONTHLY then RENEW by text, never paid): the plan goes back
        // to the paid year before it.
        const back = next.billing === "annual" && before.paidOn && next.paidOn === before.paidOn && listed && !listed.includes(before.paidOn) ? [...listed].sort().filter((y) => y < before.paidOn!).pop() : undefined;
        if (back) next.paidOn = back;
        // The first paid day going back to an earlier paid year (that one taken off, or the day set back): the years from
        // there are the plan's again, so what they cost comes back out of priorFees, and they're counted once, not twice.
        if (next.billing === "annual" && before.paidOn && next.paidOn && next.paidOn < before.paidOn && (before.yearsPaidOn ?? []).includes(next.paidOn)) {
          const again = grossFees({ ...b, plan: { ...next, yearsPaidOn: (next.yearsPaidOn ?? []).filter((y) => y < before.paidOn!), priorFees: 0 } }, before.paidOn).total;
          next.priorFees = Math.max(0, round2((before.priorFees ?? 0) - again));
        }
        // Moving the first paid day forward starts a new arrangement from that day (a monthly plan the owner paid a year
        // for, a year going monthly, the renewed year once it's paid, a new year after one ran out): what they paid
        // before it stays in their fees. A yearly plan's day moved inside the year it started, with that year not kept,
        // only corrects the day; so does an earlier day, or a monthly plan's day moved on its own. (A billing switch
        // saved apart from its new day reads as a correction from the old one: the console saves them together.)
        const switched = (before.billing ?? "monthly") !== (next.billing ?? "monthly");
        const corrects = before.billing === "annual" && !!before.paidOn && !!next.paidOn && next.paidOn < addMonths(before.paidOn, 12) && !(listed ?? []).includes(before.paidOn);
        // what was paid is the years still listed before the new day (a year the console corrected isn't one of them)
        if (before.paidOn && next.paidOn && next.paidOn > before.paidOn && (switched || (next.billing === "annual" && !corrects))) {
          next.priorFees = grossFees({ ...b, plan: { ...before, yearsPaidOn: next.yearsPaidOn } }, addDays(next.paidOn, -1)).total;
          // a quiet last month of a paid year is dated the day the new arrangement starts: it's the old year's, so its
          // refund comes off what that year cost (the new arrangement only counts quiet months after its first day)
          const month = addMonths(next.paidOn, -1);
          if (before.billing === "annual" && b.plan.freeMonths.includes(next.paidOn) && (next.yearsPaidOn ?? []).some((y) => y <= month && month < addMonths(y, 12)))
            next.priorFees = round2(next.priorFees - annualRefund(b));
        }
        // month to month from that day: a year that would start on or after it (a renewal not taken) comes off, as with MONTHLY by text
        if (switched && next.billing !== "annual" && next.paidOn) next.yearsPaidOn = (next.yearsPaidOn ?? []).filter((y) => y < next.paidOn!);
        // a yearly plan's first paid day is one of its paid years, so its refunds, renewal ask and year floor all run
        if (next.billing === "annual" && next.paidOn && !(next.yearsPaidOn ?? []).includes(next.paidOn)) next.yearsPaidOn = [...(next.yearsPaidOn ?? []), next.paidOn].sort();
        // a plan made a one pass gets the pass's terms where it has none; a pass gone monthly is done that day (if not
        // before): its bookings are still billed by its terms, and the notes from then on are the monthly plan's
        b.plan = isOnePass(next) ? onePassPlan(next) : next;
        if (isOnePass(before) && !isOnePass(b.plan) && billsPass(b.plan)) b.plan.doneOn ??= localIso(d.clock(), b.timezone).slice(0, 10);
        // cancelled here as by text: nothing booked from today on is billed (a pass gone monthly keeps an earlier day).
        // Back from it, the day is gone, except on a cancelled pass taken to monthly: its bookings after it never bill.
        if (b.plan.stage === "cancelled" && stageBefore !== "cancelled") b.plan.cancelledOn ??= localIso(d.clock(), b.timezone).slice(0, 10);
        else if (b.plan.stage !== "cancelled" && (isOnePass(b.plan) || !billsPass(b.plan))) delete b.plan.cancelledOn;
        // a new end date: whether the notes it has meet it; before the owner's OK, one they don't is paced to at once
        // (never once the pass is over)
        if (isOnePass(b.plan) && b.plan.pace && b.plan.targetEndOn !== before.targetEndOn) {
          endMoved = passEndMoved(state);
          repace = !endMoved && b.plan.pace.endOn !== b.plan.targetEndOn && b.plan.stage !== "done" && b.plan.stage !== "cancelled";
        }
        // marked done: nothing more goes, and the end text waits for Jack
        if (b.plan.stage === "done" && stageBefore !== "done") endPass(state, localIso(d.clock(), b.timezone));
      }
    });
    // A stage of Paused, Cancelled or Done really stops sending (and the platform's campaigns); back to trial, paying or
    // running resumes.
    const stage = patch.plan?.stage;
    if (stage && stage !== stageBefore) {
      if (stage === "paused") await holdSending(d, id, "pause");
      else if (stage === "cancelled") {
        await holdSending(d, id, "cancel");
        // as CANCEL by text: the months not charged yet never are
        await settleBilling(d, id);
      }
      else if (stage === "done") await holdSending(d, id, "done");
      else if (stageBefore === "paused" || stageBefore === "cancelled" || stageBefore === "done") await holdSending(d, id, "resume");
    }
    // (a pass that can't be planned now, done or without its inboxes, is paced by its next plan)
    if (repace)
      await plan(d, id).catch((e: unknown) => {
        if (!(e instanceof NotReady)) throw e;
      });
    else if (endMoved) await paceAlert(d, id);
    // another trade reads the same records with its own services and leaks: the list follows it now, not tonight
    if (patch.trade && patch.trade !== tradeBefore && d.accounts.peek(id)?.state.scan) await rescan(d, id);
    repo.audit(id, "operator", "business.update", patch);
    return c.json({ ok: true, warnings: patch.ownerPhone ? sharedCell(id, patch.ownerPhone) : [] });
  });

  function inboxClash(c: Context<Env>, t: { inbox: string; by: string }) {
    return c.json({ error: `${t.inbox} already sends for ${t.by}. One inbox sends for one client: give this one its own.` }, 409);
  }

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
    return c.json({ files: res, overview: overview(d.accounts.peek(c.req.param("id"))!.state, false, features(d.cfg)) });
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

  op.post("/businesses/:id/approve", async (c) => c.json(await approve(d, c.req.param("id"))));

  // The owner wanted to undo a cancel that set up a yearly refund (or the platform was down): a person restores it.
  // Refused once a refund text went out, since money may already be back with them.
  op.post("/businesses/:id/restore-plan", async (c) => {
    const id = c.req.param("id");
    const l = d.accounts.peek(id);
    if (!l) throw new NotFound("No such business");
    const cancelled = l.state.cancelled;
    if (!cancelled) return c.json({ error: "Nothing to restore: they aren't cancelled by text." }, 409);
    // Only the cancel's own refund text: a year-floor refund that's owed stays owed whatever happens to the plan.
    const theirs = "business_id = ? AND kind = 'refund' AND at >= ? AND EXISTS (SELECT 1 FROM json_each(data, '$.refs') WHERE json_extract(value, '$.kind') = 'year_refund' AND json_extract(value, '$.id') = ?)";
    const args = [id, cancelled.at.slice(0, 19), cancelled.refund?.yearStart ?? ""] as const;
    const sent = !!cancelled.refund && !!repo.db.get(`SELECT 1 FROM owner_messages WHERE ${theirs} AND delivery = 'sent'`, ...args);
    if (sent) return c.json({ error: "The refund text already went out. Settle the refund with them first, then set the plan up by hand." }, 409);
    // one inbox sends for one client: one of theirs another client was given after the cancel is refused, as in Settings
    const taken = inboxTaken(d, id, l.state.dataset.business.fromEmails ?? []);
    if (taken) return inboxClash(c, taken);
    if (!(await finishCancelWithdrawals(d, id))) return c.json({ error: "The sending platform didn't take back the cancelled notes yet. Try again in a few minutes." }, 409);
    let res: ReturnType<typeof undoCancel>;
    await d.accounts.withAccount(id, (state) => {
      res = undoCancel(state, localIso(d.clock(), state.dataset.business.timezone), { override: true, platform: d.email.kind === "sequencer" });
    });
    const r = res!;
    if (!r || "refused" in r) return c.json({ error: "Couldn't restore it." }, 409);
    // the cancel's refund was never issued: its text is withdrawn
    if (cancelled.refund) repo.db.run(`UPDATE owner_messages SET delivery = 'cancelled' WHERE ${theirs} AND delivery IN ('review','pending','failed','manual')`, ...args);
    if (!r.paused) await holdSending(d, id, "resume");
    repo.audit(id, "operator", "restore-plan", r);
    return c.json({ ok: true, ...r });
  });

  // Resume clears the pause flag, but a plan that's paused (a year that ran out), cancelled or a finished pass still sends
  // nothing: say so instead of "Sending resumed".
  const planHold = (bid: string, paused: boolean): { held?: "plan_paused" | "plan_cancelled" | "plan_done" } => {
    const stage = d.accounts.peek(bid)?.state.dataset.business.plan.stage;
    return !paused && (stage === "paused" || stage === "cancelled" || stage === "done") ? { held: `plan_${stage}` } : {};
  };
  op.post("/businesses/:id/pause", async (c) => {
    const { paused } = z.object({ paused: z.boolean() }).parse(await c.req.json());
    if (!repo.exists(c.req.param("id"))) throw new NotFound("No such business");
    await holdSending(d, c.req.param("id"), paused ? "pause" : "resume");
    repo.audit(c.req.param("id"), "operator", paused ? "pause" : "resume");
    return c.json({ ok: true, ...planHold(c.req.param("id"), paused) });
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
    // a note the sending platform holds is taken back first, or the change would never reach it
    const taken = await takeBackForChange(d, c.req.param("id"), c.req.param("tid"), body);
    if (taken.refuse) return c.json({ ok: false, error: taken.refuse }, taken.status ?? 409);
    let ok = false;
    let flags: string[] = [];
    let alsoStopped = 0;
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
      if (taken.pulled) {
        for (const x of state.touches) {
          if (!taken.pulled.includes(x.id) || x.sentAt || x.status === "sent" || x.status === "delivered") continue;
          x.providerId = undefined;
          // part-way through: the platform can't skip one note, so the rest of theirs stop with it
          if (taken.underway && x.id !== t.id && (x.status === "approved" || x.status === "planned")) {
            x.status = "cancelled";
            x.lastError = "Stopped with a later note the operator pulled: the sending platform can't skip one note";
            alsoStopped++;
          }
        }
        const who = state.dataset.customers.find((x) => x.id === t.customerId)?.name ?? "this person";
        state.events.push({
          id: `ev_takeback_${t.id}_${at}`,
          at,
          agent: "sender",
          kind: "action",
          title: taken.underway ? `Stopped the rest of ${who}'s notes on the sending platform` : `Took ${who}'s notes back from the sending platform`,
          detail: taken.underway ? "They were part-way through, so nothing more goes to them." : "They go again, as they read now, when they're due.",
          refs: [{ kind: "customer", id: t.customerId }],
        });
      }
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
    return c.json({ ok, flags, ...(alsoStopped ? { alsoStopped } : {}) });
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

  // Where the hand-off text a reply action made went, now the dispatcher has run (nothing when it made none): the
  // console says what really happened, "on Texts to send" by hand, never "texted" unless it was.
  const handedTo = (bid: string, mid: string | undefined) => {
    const m = mid ? repo.ownerMessageDelivery(bid, mid) : undefined;
    return m ? { delivery: m.delivery, channel: m.channel, error: m.error } : {};
  };

  // A person sorts a reply the rules couldn't place; the same dispatch runs (yes → owner text, stop → suppress).
  const Intent = z.object({ intent: z.enum(["wants_it", "wants_price", "question", "later", "already_done", "not_interested", "moved", "wrong_person", "stop", "complaint", "auto_reply", "bounce", "unclear"]) });
  op.post("/businesses/:id/replies/:rid/intent", async (c) => {
    const { intent } = Intent.parse(await c.req.json());
    const bid = c.req.param("id");
    let found = false;
    const made = await d.accounts.withAccount(bid, (state) => {
      const n = state.ownerMessages.length;
      found = !!relabelReply(state, c.req.param("rid"), intent, localIso(d.clock(), state.dataset.business.timezone).slice(0, 19));
      return state.ownerMessages[n]?.id;
    });
    if (!found) return c.json({ error: "No such reply" }, 404);
    repo.audit(bid, c.get("actor") ?? "operator", "reply.intent", { rid: c.req.param("rid"), intent });
    await deliverOwnerMessages(d, bid);
    return c.json({ ok: true, ...handedTo(bid, made) });
  });

  // Hand a reply to the owner: a hot one is texted again; anything else is handed off as a question for them.
  op.post("/businesses/:id/replies/:rid/handoff", async (c) => {
    const bid = c.req.param("id");
    const rid = c.req.param("rid");
    let found = false;
    const made = await d.accounts.withAccount(bid, (state) => {
      const r = state.replies.find((x) => x.id === rid);
      if (!r) return;
      found = true;
      const n = state.ownerMessages.length;
      const now = localIso(d.clock(), state.dataset.business.timezone).slice(0, 19);
      if (r.status === "handed_off" && !r.ownerContactedAt)
        state.ownerMessages.push({ id: `om_again_${r.id}_${now}`, at: now, kind: "handoff", text: handoffText(state, r), refs: r.customerId ? [{ kind: "customer", id: r.customerId }] : undefined });
      else relabelReply(state, rid, r.intent === "wants_it" || r.intent === "wants_price" ? r.intent : "question", now);
      return state.ownerMessages[n]?.id;
    });
    if (!found) return c.json({ error: "No such reply" }, 404);
    repo.audit(bid, c.get("actor") ?? "operator", "reply.handoff", { rid });
    await deliverOwnerMessages(d, bid);
    return c.json({ ok: true, ...handedTo(bid, made) });
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
    // Operator approves a billing text (the close, pre-charge, free month) for delivery. A money text (a month's
    // pre-charge text too) moves its charge on first (its day, its link), or is withdrawn when the charge moved on
    // meanwhile; one that failed to send goes again with its link as it is now, or its card's day from today.
    const m = repo.db.get<{ kind: string; delivery: string }>("SELECT kind, delivery FROM owner_messages WHERE business_id = ? AND id = ?", c.req.param("id"), c.req.param("mid"));
    if (m && ((CHARGE_TEXTS as readonly string[]).includes(m.kind) || m.kind === "precharge") && (m.delivery === "review" || m.delivery === "failed")) {
      const r = await approveChargeText(d, c.req.param("id"), c.req.param("mid"));
      if (r.refused) return c.json({ ok: false, error: r.refused }, 409);
    }
    const moved = d.accounts.repo.db.run("UPDATE owner_messages SET delivery = 'pending' WHERE business_id = ? AND id = ? AND delivery IN ('review','failed')", c.req.param("id"), c.req.param("mid"));
    // nothing to send (already sent, or withdrawn): say so instead of reporting a send that didn't happen
    if (!Number(moved.changes)) return c.json({ ok: false, error: "That text isn't waiting to be sent any more (it was sent or withdrawn)." }, 409);
    await deliverOwnerMessages(d, c.req.param("id"), { approved: c.req.param("mid") });
    const after = repo.ownerMessageDelivery(c.req.param("id"), c.req.param("mid"));
    repo.audit(c.req.param("id"), "operator", "owner-message.approve", { id: c.req.param("mid"), delivery: after?.delivery });
    // 200 either way (the approval stands); the console reads ok/delivery and says what really happened
    const went = after?.delivery === "sent" || after?.delivery === "manual"; // manual: on Texts to send
    return c.json({ ok: went, delivery: after?.delivery, ...(went ? {} : { error: after?.error ?? undefined }) });
  });

  // Owner texts by hand (SMS_PROVIDER=manual): every client's texts waiting to be sent, newest first; the operator
  // texts one from his phone, then marks it sent.
  op.get("/texts-to-send", (c) => c.json(textsToSend(d)));
  op.post("/businesses/:id/owner-messages/:mid/sent", (c) => {
    if (!repo.sentByHand(c.req.param("id"), c.req.param("mid"), d.clock().toISOString())) return c.json({ error: "That text isn't waiting to be sent any more." }, 409);
    repo.audit(c.req.param("id"), c.get("actor") ?? "operator", "owner-message.sent_by_hand", { id: c.req.param("mid") });
    return c.json({ ok: true });
  });

  // Charges, a one pass's (BRIEF B4) and the months' (B5): one Jack was paid outside the software (or Done, with no
  // Stripe key; a booking's by its customer, a month by its id), a Stripe customer his own payment link saved the card
  // on, his answer to one waiting on him (a refund, a NOT OURS, a second payment), and a /pay link's text again for his OK.
  op.post("/businesses/:id/charges/paid", async (c) => {
    const who = z.union([z.object({ customerId: z.string().min(1) }), z.object({ chargeId: z.string().min(1) })]).parse(await c.req.json());
    const r = await markPaid(d, c.req.param("id"), who);
    if ("refused" in r) return c.json({ error: r.refused }, 409);
    repo.audit(c.req.param("id"), c.get("actor") ?? "operator", "charge.paid_outside", { charge: r.charge.id, ...who });
    return c.json({ ok: true, charge: r.charge });
  });
  op.post("/businesses/:id/charges/:cid/decide", async (c) => {
    const { refund } = z.object({ refund: z.boolean() }).parse(await c.req.json());
    const r = await decideChargeOp(d, c.req.param("id"), c.req.param("cid"), refund);
    if ("refused" in r) return c.json({ error: r.refused }, 409);
    repo.audit(c.req.param("id"), c.get("actor") ?? "operator", "charge.decide", { charge: c.req.param("cid"), ...r });
    return c.json({ ok: true, ...r });
  });
  // a booking the fresh export at a one pass's end brought (BRIEF B6): Jack confirms it before any money text, or not
  op.post("/businesses/:id/found/:customerId", async (c) => {
    const { confirm } = z.object({ confirm: z.boolean() }).parse(await c.req.json());
    const r = await decideFoundOp(d, c.req.param("id"), c.req.param("customerId"), confirm);
    if ("refused" in r) return c.json({ error: r.refused }, 409);
    repo.audit(c.req.param("id"), c.get("actor") ?? "operator", confirm ? "found.confirm" : "found.reject", { customerId: c.req.param("customerId") });
    return c.json({ ok: true });
  });
  op.post("/businesses/:id/charges/:cid/link", async (c) => {
    if (!repo.exists(c.req.param("id"))) throw new NotFound("No such business");
    const [made] = await sendLinkAgain(d, c.req.param("id"), c.req.param("cid"));
    if (!made) return c.json({ error: "That charge isn't waiting on its link." }, 409);
    repo.audit(c.req.param("id"), c.get("actor") ?? "operator", "charge.link_again", { charge: c.req.param("cid") });
    return c.json({ ok: true, messageId: made });
  });
  op.post("/businesses/:id/stripe-customer", async (c) => {
    const { customer } = z.object({ customer: z.string().trim().regex(/^cus_\w+$/, "A Stripe customer id, like cus_PQ8x2LmN0aB1cD") }).parse(await c.req.json());
    const r = await pasteCustomer(d, c.req.param("id"), customer);
    if ("refused" in r) return c.json({ error: r.refused }, 409);
    repo.audit(c.req.param("id"), c.get("actor") ?? "operator", "charge.customer", { customer });
    return c.json({ ok: true, card: r.card });
  });

  op.get("/businesses/:id/close-preview", (c) => {
    const l = d.accounts.peek(c.req.param("id"));
    if (!l) throw new NotFound("No such business");
    return c.json({ text: closeMessage(l.state, features(d.cfg)) });
  });

  op.post("/businesses/:id/sync", async (c) => c.json((await syncFsm(d, c.req.param("id"), "jobber")) ?? { error: "Not connected" }));

  const at = (kind: "import" | "requests", id: string) => (d.cfg.INBOUND_DOMAIN ? `${kind}+${linkToken(d, kind, id)}@${d.cfg.INBOUND_DOMAIN}` : undefined);
  const links = (id: string) => ({
    owner: ownerLink(d, id),
    connectJobber: connectJobberLink(d, id),
    importToken: linkToken(d, "import", id),
    importAddress: at("import", id),
    // Where the owner forwards new requests (website form, Angi, Thumbtack, a homeowner's email): only where answering
    // them is sold.
    ...(features(d.cfg).newRequests ? { requestsToken: linkToken(d, "requests", id), requestsAddress: at("requests", id) } : {}),
  });
  op.get("/businesses/:id/links", (c) => {
    if (!repo.exists(c.req.param("id"))) throw new NotFound("No such business");
    return c.json(links(c.req.param("id")));
  });
  // New owner, import and connect links for one client (a departed office manager, a forwarded text): every old one stops
  // working. A one pass's /pay links out are among them: each one's text goes again for his OK, with its new link.
  op.post("/businesses/:id/links/rotate", async (c) => {
    const id = c.req.param("id");
    if (!repo.exists(id)) throw new NotFound("No such business");
    rotateLinks(d, id);
    await sendLinkAgain(d, id);
    repo.audit(id, "operator", "links.rotate");
    return c.json(links(id));
  });

  // A text the owner sent the operator's phone, pasted in: the same handler as the Twilio webhook, from their cell.
  op.post("/businesses/:id/owner-texts", async (c) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(1600) }).parse(await c.req.json());
    const res = await pasteOwnerText(d, c.req.param("id"), text);
    if ("refused" in res) return c.json({ error: res.refused }, 409);
    repo.audit(res.businessId, c.get("actor") ?? "operator", "owner-text.paste", { body: text });
    return c.json(res);
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
   *   GET /api/health/setup                 the deploy: Instantly webhooks, SMS and Stripe modes, the last backup
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
        // answered by a person (in the console) is settled, even for a reply read before that marked it done
        if (r.intent === "unclear" && r.status === "new" && !r.answers?.some((a) => a.by !== "auto")) {
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
      if ((synced || lastFile) && !s.touches.length && notStarted(s.dataset.business))
        items.push({ kind: "ready", ...biz, at: (synced ? j!.last_sync_at : lastFile)!, from: synced ? "jobber" : "file", quotes: s.dataset.quotes.length, customers: s.dataset.customers.length, headline: readiness(s.dataset).headline, needsAddress: (s.dataset.business.mailingAddress?.trim() ?? "").length < 8 });
      const flagged = s.touches.filter((t) => t.flags.length && (t.status === "planned" || t.status === "approved")).slice(0, 100);
      for (const t of flagged)
        items.push({ kind: "flagged_note", ...biz, at: t.dueAt, touchId: t.id, customerId: t.customerId, name: people.get(t.customerId)?.name ?? "", step: t.step, status: t.status, subject: t.subject ?? "", body: t.body, flags: t.flags });
      for (const m of [...repo.ownerMessages(b.id, { delivery: "review" }), ...repo.ownerMessages(b.id, { delivery: "failed" })])
        items.push({ kind: "owner_message", ...biz, at: m.at, messageId: m.id, messageKind: m.kind, delivery: m.delivery, text: m.text });
      // charges waiting on a person (a one pass's, a month's): a refund, a NOT OURS or a second payment to decide; by hand
      // (no Stripe key), each one approved is his to collect (the card's from its day, once its text reached the
      // owner), then Done
      const plan = s.dataset.business.plan;
      for (const ch of [...(plan.charges ?? []), ...(plan.months ?? [])]) {
        const charge = isMonth(ch)
          ? { chargeId: ch.id, month: { on: ch.month, first: !!ch.first }, amount: ch.amount / 100 }
          : { chargeId: ch.id, customerId: ch.customerId, name: people.get(ch.customerId)?.name ?? "", code: ch.code, amount: ch.amount / 100 };
        if (ch.ask) items.push({ kind: "charge_ask", ...biz, at: ch.ask.at, ...charge, ask: ch.ask.kind, why: ch.ask.why, status: ch.status, refundBy: d.stripe && (ch.ask.paymentIntent ?? ch.stripe?.paymentIntent) ? "stripe" : "hand" });
        else if (!d.stripe && ch.status === "approved" && (ch.via === "link" || (ch.toldAt && (ch.chargeOn ?? "") <= nowLocal.slice(0, 10))))
          items.push({ kind: "charge_due", ...biz, at: ch.approvedAt ?? ch.at, ...charge, via: ch.via, last4: plan.card?.last4 ?? null });
      }
      // the bookings the fresh export at a one pass's end brought, each waiting for his word before any money text
      // (while it's still billable within the cap, with no charge yet: one past the cap waits until a place frees)
      const found = (plan.endExport?.found ?? []).filter((f) => f.confirmed === undefined && !plan.charges?.some((ch) => ch.customerId === f.customerId));
      const billable = found.length ? billableBookings(s).billable : [];
      for (const f of found) {
        const x = billable.find((y) => y.customerId === f.customerId);
        if (x) items.push({ kind: "booking_found", ...biz, at: f.at, customerId: f.customerId, name: people.get(f.customerId)?.name ?? "", code: x.code, on: x.on, value: x.value });
      }
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
  op.get("/health/setup", (c) => c.json(setupHealth(d)));
  /* --------------------------- end operator console reads --------------------------- */

  // (mounted after the owner routes below: op's "*" guard would otherwise swallow /api/owner/*)

  /* ----------------------------- owner API (signed link) ----------------------------- */
  const own = new Hono<Env>();
  own.use("/:token/*", owner);
  own.get("/:token/overview", (c) => {
    const l = d.accounts.peek(c.get("bid")!);
    if (!l) throw new NotFound("No such business");
    return c.json(overview(l.state, l.paused, features(d.cfg)));
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
    return c.json({ ok: true, ...planHold(c.get("bid")!, paused) });
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
  // consent. We make the account, read the file and put it in the operator's queue with their list ready.
  // Nothing goes to anyone from here: the operator adds the mailing address, looks at the first note and plans,
  // and only then does the owner get a text (the first note, word for word, waiting for their OK).
  const origins = signupOrigins(d.cfg);
  app.use("/start", cors({ origin: origins.length ? origins : "*", allowMethods: ["POST", "OPTIONS"], allowHeaders: ["content-type"], maxAge: 86400 }));
  // Five tries an hour per caller, and a ceiling on new sign-ups for the whole server: enough for a typo, not a script.
  const HOUR = 3_600_000;
  const signupHits = new Map<string, number[]>();
  let signupsTaken: number[] = [];
  /**
   * Who is calling. X-Forwarded-For is whatever the caller wrote unless our own proxies appended to it, so it's read
   * only when TRUSTED_PROXY_HOPS says how many did (that many entries from the right); otherwise the socket's peer.
   */
  const callerOf = (c: Context<Env>): string => {
    const hops = d.cfg.TRUSTED_PROXY_HOPS;
    if (hops > 0) {
      const chain = (c.req.header("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      if (chain.length >= hops) return chain[chain.length - hops]!;
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown"; // no socket (a request made in-process): one shared bucket
    }
  };
  const Signup = z.object({
    company: z.string().trim().min(2).max(120),
    first: z.string().trim().min(1).max(60),
    cell: z.string().max(40),
    signer: z.string().trim().max(60).optional(),
    trade: z.string().max(40).optional(),
    software: z.string().max(40).optional(),
    /** Which offer's page they signed up from. */
    offer: z.enum(["monthly", "one_pass"]).optional(),
    consent: z.literal(true),
    files: z.array(z.object({ name: z.string().min(1).max(200), text: z.string().min(1) })).max(5).optional(),
    // the site's own audit numbers and nothing else: unknown keys are dropped, never stored
    audit: z.object({ quotes: z.number(), silent: z.object({ count: z.number(), value: z.number() }), perMonth: z.number(), past: z.object({ people: z.number(), paid: z.number().optional() }) }).partial().optional(),
    ref: z.string().max(200).optional(),
    /** A field people can't see; anything in it is a bot. */
    website: z.string().max(500).optional(),
  });
  /**
   * A public form never changes an account someone relies on. The file from a second Start is read only into an
   * account this form made itself that's still an untouched trial (nothing planned or sent, no Jobber connection):
   * the owner coming back with the file they didn't have the first time.
   */
  const untouchedSignup = (bid: string): boolean => {
    const l = d.accounts.peek(bid);
    const b = l?.state.dataset.business;
    return !!b && b.signup?.from === "site" && notStarted(b) && !l!.state.touches.length && !repo.getIntegration(bid, "jobber");
  };
  app.post("/start", async (c) => {
    if (d.cfg.SIGNUPS !== "on") return c.json({ error: "Sign-ups are closed right now. Text Jack instead." }, 503);
    const now = d.clock().getTime();
    const ip = callerOf(c);
    const hits = (signupHits.get(ip) ?? []).filter((t) => t > now - HOUR);
    if (hits.length >= 5) return c.json({ error: "Too many tries. Text Jack instead." }, 429);
    // re-inserted at the end, so the map runs oldest caller first: old ones are let go, nobody's count is reset
    signupHits.delete(ip);
    signupHits.set(ip, [...hits, now]);
    for (const [k, v] of signupHits) {
      if (signupHits.size <= 5000 && v.at(-1)! > now - HOUR) break;
      signupHits.delete(k);
    }
    const parsed = Signup.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.issues.some((i) => i.path[0] === "consent") ? "Tick the box so we can follow up on your behalf." : "Something's missing. Check the company, your name and your cell." }, 400);
    const f = parsed.data;
    if (f.website) return c.json({ ok: true, id: "thanks" }, 201);
    const cell = ownerCell(f.cell);
    if (!cell) return c.json({ error: "That doesn't look like a cell we can text." }, 400);
    if ((f.files ?? []).reduce((a, x) => a + x.text.length, 0) > 9 * MB) return c.json({ error: "That file's too big to send here. Jack will ask for it by text." }, 413);
    signupsTaken = signupsTaken.filter((t) => t > now - HOUR);
    if (signupsTaken.length >= d.cfg.SIGNUPS_PER_HOUR) {
      d.log(`[signup] ${signupsTaken.length} sign-ups in the last hour; turned one away`);
      return c.json({ error: "We're taking a lot of sign-ups right now. Text Jack instead." }, 429);
    }
    signupsTaken.push(now);
    // only a trade the offers sell; anything else is read from their file
    const trade = OFFERED_TRADES.includes(f.trade as TradeId) ? (f.trade as TradeId) : "general";
    const software: SourceSystem = /jobber/i.test(f.software ?? "") ? "jobber" : /housecall/i.test(f.software ?? "") ? "housecall_pro" : "unknown";
    const businesses = repo.listBusinesses();
    const ten = (p: string | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);
    // The same owner pressing Start twice (or coming back with the file) lands on the same account.
    const again = businesses.find((b) => (b.profile.ownerPhone ?? b.profile.signup?.sharedCell) === cell && b.profile.name.toLowerCase() === f.company.toLowerCase());
    // A cell that's already another client's owner cell doesn't become a new account's: that owner's texts (PAUSE,
    // CANCEL) would stop naming one business, and our "which one?" would carry whatever this form called itself.
    const others = again ? [] : businesses.filter((b) => ten(b.profile.ownerPhone) === ten(cell));
    let id = again?.id;
    // a new account's time zone is a guess from the cell's area code, so the alert asks the operator to check it
    let zoneCheck = "";
    if (!id) {
      id = `${f.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "shop"}-${randomBytes(3).toString("hex")}`;
      const guessed = zoneForCell(cell);
      const zone = guessed ?? "America/New_York";
      zoneCheck = `check the time zone (${TIMEZONES.find(([z]) => z === zone)?.[1]}, ${guessed ? `guessed from the ${cell.slice(2, 5)} area code` : "as we don't know that area code"}), `;
      const today = localIso(d.clock(), zone).slice(0, 10);
      const signer = f.signer?.trim() || f.first;
      const profile = defaultProfile({ name: f.company, trade, ownerName: f.first, ownerPhone: others.length ? undefined : cell, signerName: signer, signerRole: signer.toLowerCase() === f.first.toLowerCase() ? "owner" : "office", mailingAddress: "", timezone: zone }, id, today);
      profile.software = software;
      profile.signup = others.length ? { from: "site", sharedCell: cell } : { from: "site" };
      // signed up from a one-pass page: a one pass, running from the day Jack first plans it
      if (f.offer === "one_pass") profile.plan = onePassPlan();
      await d.accounts.create(profile, today);
      rotateLinks(d, id, { created: true });
    }
    const mayRead = !again || untouchedSignup(id);
    const sent = (f.files ?? []).map((x) => `${x.name} (${Math.max(1, Math.round(x.text.length / 1024)).toLocaleString("en-US")} KB)`).join(", ");
    let read = "";
    if (f.files?.length && mayRead) {
      try {
        // read as the site's audit read it: the titles pick among the trades the page's offer sells
        const was = d.accounts.peek(id)!.state.dataset.business.trade;
        const res = await importFiles(d, id, f.files as FileIn[], trade === "general" ? undefined : trade);
        const s = d.accounts.peek(id)!.state;
        // what its offer works in the file: quotes nobody answered (not on a monthly trade's), and past customers
        const silent = soldMonthly(s.dataset.business.trade) ? undefined : s.summary?.audit?.silent;
        const past = s.scan ? stoppedCustomers(s.dataset, s.scan) : [];
        const paid = paidTogether(past);
        const found = [
          ...(silent?.count ? [`${plural(silent.count, "quote")} never answered, ${fmtMoney(silent.value, { compact: true })}`] : []),
          ...(past.length ? [`${plural(past.length, "past customer hasn't", "past customers haven't")} been back${paid ? ` (paid ${fmtMoney(paid, { compact: true })} in their last year)` : ""}`] : []),
        ];
        const readAs = s.dataset.business.trade !== was ? ` and reads as ${s.dataset.business.trade}` : "";
        read = `Their file is in (${res.map((r) => `${r.accepted} ${r.kind}s`).join(", ")})${readAs}: ${found.join(", and ") || "nobody in it to write to"}.`;
      } catch (e) {
        read = `Their file didn't read (${(e as Error).message.slice(0, 120)}). Ask them for the export by text.`;
      }
    } else if (f.files?.length)
      read = `They sent ${sent}. Nothing was added: a form on the site never changes an account that's already set up or running. If it's really them, ask for the file by text or send them their import address.`;
    else read = again ? "No file this time; nothing changed." : "No file yet. Ask for their export by text.";
    const shared = others.length
      ? ` Careful: ${cell} is already the owner cell for ${others.map((b) => b.profile.name).join(" and ")}, so it isn't set on this account. Texts from that cell still go to ${others.length === 1 ? "that client" : "those clients"} only, and nothing here is texted. If it really is the same owner, set the cell in this client's Settings; if not, delete this sign-up.`
      : "";
    const next = mayRead ? ` Next: ${others.length ? "check who this is, " : ""}${zoneCheck}add their mailing address, read the first note, then Plan — they get the first note by text and it waits for their OK.` : "";
    await raiseAlert(d, id, {
      kind: "signup",
      title: again ? `${f.company} came back through the site${f.files?.length ? " with a file" : ""}` : `New sign-up: ${f.company}`,
      detail: `${f.first}, ${cell}${f.software ? `, uses ${f.software}` : ""}.${f.offer ? ` Offer: ${f.offer === "one_pass" ? "one pass" : "monthly"}.` : ""}${f.trade ? ` Trade: ${trade}.` : ""} ${read}${shared}${next}`,
    });
    repo.audit(id, "public", again ? "signup.again" : "signup", { ref: f.ref, software: f.software, offer: f.offer, trade, audit: f.audit, files: f.files?.map((x) => ({ name: x.name, chars: x.text.length })), fileRead: !!f.files?.length && mayRead, ...(others.length ? { sharedCell: cell } : {}) });
    // a second Start says nothing about the account it matched
    return c.json({ ok: true, id: again ? "thanks" : id }, 201);
  });

  /* ----------------------------- unsubscribe ----------------------------- */
  const unsub = async (c: Context<Env>) => {
    const r = await unsubscribeByToken(d, c.req.param("token") ?? "");
    const msg = r.ok ? `You're unsubscribed${r.business ? ` from ${escapeHtml(r.business)}` : ""}. You won't hear from us again.` : "That link didn't work, but reply \"stop\" to any note and you'll be removed.";
    return c.html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><body style="font:16px/1.5 system-ui;padding:40px;max-width:520px;margin:auto"><p>${msg}</p></body>`);
  };
  app.get("/u/:token", unsub);
  app.post("/u/:token", unsub); // RFC 8058 one-click

  /* ----------------------------- the owner's /pay link ----------------------------- */
  // A one pass's payment link (BRIEF B4): never a raw Checkout URL, which expires; this one makes a fresh Checkout
  // each time it's opened unpaid. The thanks page is Checkout's success URL.
  const payPage = (title: string, body: string) =>
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px/1.5 system-ui;padding:40px;max-width:520px;margin:auto"><h2>${title}</h2><p>${body}</p></body>`;
  app.get("/pay/thanks", (c) => c.html(payPage("Thanks, it's paid", "Your card is saved for the rest, and you'll get a text before every charge. You can close this page.")));
  app.get("/pay/:token", async (c) => {
    const r = await openPay(d, c.req.param("token"));
    if ("redirect" in r) return c.redirect(r.redirect, 303);
    if (r.page === "paid") return c.html(payPage("Paid", "This one is paid. Thanks. You can close this page."));
    if (r.page === "nothing") return c.html(payPage("Nothing to pay", "There's nothing to pay on this link right now. Text Jack if that looks wrong."));
    return c.html(payPage("This link isn't valid anymore", "Text Jack and he'll send you a new one."), 404);
  });

  /* ----------------------------- webhooks ----------------------------- */
  // Stripe (BRIEF B4): the signature checked against the raw body; each event taken once by its id, and each change
  // guarded by the charge's status, so a retry, a replay or one out of order never charges or marks twice. A failure
  // answers 500, so Stripe sends it again.
  app.post("/webhooks/stripe", async (c) => {
    const secret = d.cfg.STRIPE_WEBHOOK_SECRET;
    if (!d.stripe || !secret) return c.json({ error: "Stripe isn't set up here" }, 404);
    const raw = await c.req.text();
    if (!verifyStripeSignature(secret, raw, c.req.header("stripe-signature"), d.clock().getTime())) return c.json({ error: "bad signature" }, 400);
    const ev = safeJson(raw) as StripeEvent | undefined;
    if (!ev?.id || !ev.data?.object) return c.json({ error: "Expected a Stripe event" }, 400);
    const id = `stripe:${ev.id}`;
    const claim = repo.claimWebhook(id, "stripe", raw, d.clock().toISOString());
    if (claim === "duplicate") return c.json({ ok: true, duplicate: true });
    if (claim === "busy") return c.json({ ok: false, busy: true }, 503, { "Retry-After": "120" });
    try {
      const r = await stripeEvent(d, ev);
      repo.finishWebhook(id, r.businessId ? "processed" : "ignored", r.businessId, r.note);
      return c.json({ ok: true });
    } catch (e) {
      repo.finishWebhook(id, "failed", undefined, (e as Error).message);
      d.log(`[stripe] ${ev.type} ${ev.id} failed: ${(e as Error).message}`);
      return c.json({ error: "failed" }, 500);
    }
  });

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
    // Jack's cold email shares the workspace: its events are logged, never read
    const cold = coldEvent(d, { campaignId: ev.campaignId, inbox: ev.type === "reply" ? ev.toAccount : ev.type === "account_error" ? ev.account : undefined });
    if (cold) {
      d.log(`[instantly] ${ev.type} left alone, cold email: ${cold}`);
      repo.finishWebhook(id, "ignored", undefined, `cold email: ${cold}`);
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
   * address ("import+<token>@...") — the files are read automatically; and, with FEATURE_NEW_REQUESTS, owners
   * forwarding new requests to their requests address ("requests+<token>@...") — answered from the office like a
   * Jobber request. Without it, an email to a requests address is plain mail: read like any other, and one we can't
   * place goes to the review queue.
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
    // Our requests+/import+ address may not be in To: a Gmail filter's forward or a BCC keeps the original To.
    const link = linkAddress(deliveredTo(body, headers));
    // New requests the owner forwards: the whole message (a forward is "quoted" text to a reply parser)
    const requestsToken = link?.kind === "requests" && features(d.cfg).newRequests ? link.token : undefined;
    if (requestsToken) {
      const bid = readLinkToken(d, "requests", requestsToken);
      const html = String(body.HtmlBody ?? body["body-html"] ?? body.html ?? "");
      const full = String(body.TextBody || body["body-plain"] || body.text || "") || (html ? htmlToText(html) : "");
      if (!bid) {
        // One we gave out before "Replace all links": not answered, but a person hears about it (it's someone asking for work).
        const old = staleLinkToken(d, "requests", requestsToken);
        if (old) {
          await requestToOldAddress(d, old, { subject, text: full, from });
          repo.finishWebhook(id, "processed", old, "requests address from before the links were replaced");
          return c.json({ ok: true, taken: false, oldAddress: true });
        }
        repo.finishWebhook(id, "ignored", undefined, "bad requests token");
        return c.json({ ok: true, ignored: true });
      }
      const res = await takeForwardedRequest(d, bid, { subject, text: full, from, receivedAt: d.clock().toISOString() });
      repo.finishWebhook(id, res.taken ? "processed" : "ignored", bid, res.why);
      return c.json({ ok: true, ...res });
    }
    const importToken = link?.kind === "import" ? link.token : undefined;
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

/** Headers that name the mailbox a message really went to when To doesn't (a filter's forward, a BCC, a redirect). */
const DELIVERY_HEADER = /^(delivered-to|x-original-to|x-forwarded-to|x-forwarded-for|envelope-to|x-envelope-to|x-rcpt-to|resent-to)$/i;

/**
 * Every address an inbound email was delivered or written to, the delivery address first: Postmark's
 * OriginalRecipient, Mailgun's envelope recipient, SendGrid's envelope, the delivery headers, then To, Cc and Bcc
 * (Postmark's ToFull/CcFull/BccFull too). A Gmail filter's forward keeps the original To (the shop's own inbox), so
 * our address is only in the first of these.
 */
function deliveredTo(body: Record<string, unknown>, headers: { Name: string; Value: string }[]): string[] {
  const out: string[] = [];
  const add = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") add((v as { Email?: unknown; email?: unknown }).Email ?? (v as { email?: unknown }).email);
  };
  const parsed = (v: unknown) => (typeof v === "string" ? safeJson(v) : v);
  add(body.OriginalRecipient);
  add(body.recipient);
  add((parsed(body.envelope) as { to?: unknown } | null | undefined)?.to);
  for (const h of headers) if (DELIVERY_HEADER.test(h.Name)) add(h.Value);
  // Mailgun sends the headers as JSON [[name, value], ...], and sometimes flattened onto the body
  const mailgun = parsed(body["message-headers"]);
  if (Array.isArray(mailgun)) for (const h of mailgun) if (Array.isArray(h) && DELIVERY_HEADER.test(String(h[0]))) add(h[1]);
  for (const [k, v] of Object.entries(body)) if (DELIVERY_HEADER.test(k)) add(v);
  for (const k of ["ToFull", "To", "to", "CcFull", "Cc", "cc", "BccFull", "Bcc", "bcc"]) add(body[k]);
  return out;
}

/** The first of our requests+<token> / import+<token> addresses among them. */
function linkAddress(addresses: string[]): { kind: "requests" | "import"; token: string } | undefined {
  for (const a of addresses) {
    const m = a.match(/(requests|import)\+([A-Za-z0-9_.-]+)@/);
    if (m) return { kind: m[1] as "requests" | "import", token: m[2]! };
  }
  return undefined;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** Element text in XML only needs &, < and > escaped; apostrophes stay readable in the owner's text. */
function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
