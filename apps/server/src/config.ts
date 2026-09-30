import { z } from "zod";

/**
 * Every setting comes from the environment. Anything optional that's missing just turns
 * the matching integration off (log-only providers stand in), so a laptop dev run needs nothing.
 */
const schema = z.object({
  PORT: z.coerce.number().default(8787),
  PUBLIC_URL: z.string().default("http://localhost:8787"),
  DATABASE_PATH: z.string().default("./.data/quiet-accounts.db"),
  /** Bearer token for the operator API and console. */
  OPERATOR_TOKEN: z.string().min(12).default("dev-operator-token-change-me"),
  /** Signs owner links, OAuth state and encrypts stored tokens. */
  APP_SECRET: z.string().min(16).default("dev-secret-change-me-please-0000"),
  /** Shared secret embedded in inbound webhook URLs (Instantly, inbound email, Twilio). */
  WEBHOOK_SECRET: z.string().min(12).default("dev-webhook-secret"),

  /** "log" | "smtp" | "instantly" */
  EMAIL_PROVIDER: z.enum(["log", "smtp", "instantly"]).default("log"),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  INSTANTLY_API_KEY: z.string().optional(),
  INSTANTLY_SENDING_ACCOUNTS: z.string().optional(),
  INSTANTLY_DAILY_LIMIT: z.coerce.number().optional(),

  /** "log" | "twilio" — texts to business owners (hand-offs, nudges, weekly report). */
  SMS_PROVIDER: z.enum(["log", "twilio"]).default("log"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),

  JOBBER_CLIENT_ID: z.string().optional(),
  JOBBER_CLIENT_SECRET: z.string().optional(),
  /**
   * What to read from Jobber besides clients and quotes: any of jobs, invoices, requests (comma-separated).
   * The listed app is read-only on clients and quotes, so the default is none. Add one only after the app's
   * scopes in the Jobber Developer Center include it.
   */
  JOBBER_READ: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.enum(["jobs", "invoices", "requests"]))),
  /** Leave a note on the Jobber quote when someone replies or books. Needs a write scope the listed app doesn't ask for. */
  JOBBER_WRITE_NOTES: z.enum(["off", "on"]).default("off"),

  /** Claude powers the second-opinion reply reader, note personalization and column mapping. Optional. */
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),
  /** Let the AI writer personalize first notes (every note still passes the quality gate). */
  AI_WRITER: z.enum(["off", "on"]).default("off"),

  /** Worker cadence. */
  WORKER_INTERVAL_MS: z.coerce.number().default(60_000),
  WORKER_ENABLED: z.enum(["true", "false"]).default("true"),
  /** How long one business's turn may hold up a tick before the worker moves on to the others. */
  WORKER_BUSINESS_BUDGET_MS: z.coerce.number().default(20_000),
  /** Texts about money (the close, pre-charge, free month) wait for an operator by default. */
  AUTO_SEND_BILLING_TEXTS: z.enum(["true", "false"]).default("false"),
  /** The domain your inbound email provider receives on; addresses are import+<token>@ and requests+<token>@ it. */
  INBOUND_DOMAIN: z.string().optional(),
  /** The site's Start form posts here (POST /start). Comma-separated origins allowed to call it; empty = any. */
  SIGNUP_ORIGINS: z.string().default(""),
  SIGNUPS: z.enum(["on", "off"]).default("on"),
  /** New sign-ups the whole server takes in an hour (on top of five tries an hour per address); past it, "text Jack". */
  SIGNUPS_PER_HOUR: z.coerce.number().int().min(1).default(30),
  /**
   * Proxies in front of the server that each append the caller's address to X-Forwarded-For (a load balancer = 1).
   * 0: the header is ignored (anyone can write it) and the socket's peer address is the caller.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** Pre-send check that each address's domain accepts mail (DNS MX). "off" skips it. */
  MAIL_CHECK: z.enum(["on", "off"]).default("on"),
  /** Owner-waiting threshold before the first nudge. */
  SLA_FIRST_NUDGE_HOURS: z.coerce.number().default(4),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Bad configuration: ${issues}`);
  }
  const c = parsed.data;
  if (c.EMAIL_PROVIDER === "smtp" && !c.SMTP_URL) throw new Error("EMAIL_PROVIDER=smtp needs SMTP_URL");
  if (c.EMAIL_PROVIDER === "instantly" && !c.INSTANTLY_API_KEY) throw new Error("EMAIL_PROVIDER=instantly needs INSTANTLY_API_KEY");
  if (c.SMS_PROVIDER === "twilio" && !(c.TWILIO_ACCOUNT_SID && c.TWILIO_AUTH_TOKEN && c.TWILIO_FROM)) throw new Error("SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM");
  // Sending real email or texts with public default secrets would let anyone forge replies and
  // unsubscribes, and a localhost PUBLIC_URL would break every unsubscribe link. Refuse to start.
  if ((c.EMAIL_PROVIDER !== "log" || c.SMS_PROVIDER !== "log") && env.ALLOW_DEV_SECRETS !== "true") {
    const weak = (["OPERATOR_TOKEN", "APP_SECRET", "WEBHOOK_SECRET"] as const).filter((k) => c[k].startsWith("dev-"));
    if (weak.length) throw new Error(`Refusing to send for real with development secrets: set ${weak.join(", ")}`);
    if (!/^https:\/\//.test(c.PUBLIC_URL) || /\/\/(localhost|127\.0\.0\.1)\b/.test(c.PUBLIC_URL)) throw new Error("PUBLIC_URL must be the public https address when sending for real (every unsubscribe link points at it)");
  }
  return c;
}

export function isProductionLike(c: Config): boolean {
  return !c.OPERATOR_TOKEN.startsWith("dev-") && !c.APP_SECRET.startsWith("dev-") && !c.WEBHOOK_SECRET.startsWith("dev-");
}
