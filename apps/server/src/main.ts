import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadConfig, isProductionLike } from "./config.ts";
import { Db } from "./db/sqlite.ts";
import { Repo } from "./db/repo.ts";
import { Accounts } from "./core/accounts.ts";
import { startWorker } from "./core/worker.ts";
import { createApp, type HttpDeps } from "./http/app.ts";
import { LogEmailProvider, SmtpEmailProvider } from "./providers/email.ts";
import { LogNotifier, TwilioNotifier } from "./providers/sms.ts";
import { createMailCheck } from "./providers/mailcheck.ts";
import { createLlm } from "./agents/llm.ts";
import { createInstantlyProvider, parseInstantlyWebhook, webhookUrlFor, type InstantlyProvider } from "./integrations/instantly/index.ts";
import { encrypt } from "./core/crypto.ts";
import { createJobberConnector } from "./integrations/jobber/index.ts";
import type { OutboundProvider } from "./contracts.ts";

// node:sqlite is stable enough for this use; keep its experimental banner out of the logs.
const emit = process.emitWarning.bind(process);
process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
  if (String(typeof w === "string" ? w : w.message).includes("SQLite")) return;
  return (emit as (...a: unknown[]) => void)(w, ...rest);
}) as typeof process.emitWarning;

export function buildDeps(env: Record<string, string | undefined> = process.env): HttpDeps {
  const cfg = loadConfig(env);
  const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
  const db = new Db(cfg.DATABASE_PATH);
  const accounts = new Accounts(new Repo(db));
  let email: OutboundProvider;
  if (cfg.EMAIL_PROVIDER === "smtp") email = new SmtpEmailProvider(cfg.SMTP_URL!, { from: cfg.SMTP_FROM });
  else if (cfg.EMAIL_PROVIDER === "instantly")
    email = createInstantlyProvider({ apiKey: cfg.INSTANTLY_API_KEY!, sendingAccounts: cfg.INSTANTLY_SENDING_ACCOUNTS?.split(",").map((s) => s.trim()).filter(Boolean), dailyLimit: cfg.INSTANTLY_DAILY_LIMIT });
  else email = new LogEmailProvider();
  const logNotifier = new LogNotifier();
  const notifier = cfg.SMS_PROVIDER === "twilio" ? new TwilioNotifier({ accountSid: cfg.TWILIO_ACCOUNT_SID!, authToken: cfg.TWILIO_AUTH_TOKEN!, from: cfg.TWILIO_FROM! }, fetch, logNotifier) : logNotifier;
  const llm = createLlm({ apiKey: cfg.ANTHROPIC_API_KEY, model: cfg.CLAUDE_MODEL, log });
  const fsm =
    cfg.JOBBER_CLIENT_ID && cfg.JOBBER_CLIENT_SECRET
      ? {
          jobber: createJobberConnector({
            clientId: cfg.JOBBER_CLIENT_ID,
            clientSecret: cfg.JOBBER_CLIENT_SECRET,
            // Jobber rotates refresh tokens: save every new pair or the connection dies on the next refresh.
            onTokens: (next, prev) => {
              const bid = prev.accountId ? accounts.repo.businessForIntegrationAccount("jobber", prev.accountId) : undefined;
              if (bid) accounts.repo.putIntegration(bid, "jobber", { secret: encrypt(cfg.APP_SECRET, JSON.stringify({ ...next, accountId: next.accountId ?? prev.accountId })) });
              else log("[jobber] refreshed tokens for an account we couldn't match — reconnect may be needed");
            },
          }),
        }
      : {};
  const mailCheck = cfg.MAIL_CHECK === "off" ? undefined : createMailCheck();
  return { cfg, accounts, email, notifier, llm, fsm, log, clock: () => new Date(), parsers: { instantly: parseInstantlyWebhook }, mailCheck };
}

export function start(env: Record<string, string | undefined> = process.env) {
  const deps = buildDeps(env);
  const { cfg, log } = deps;
  if (!isProductionLike(cfg)) log("[boot] running with development secrets — set OPERATOR_TOKEN, APP_SECRET and WEBHOOK_SECRET before going live");
  const app = createApp(deps);
  // The dashboard (built web app), when present.
  const webDist = resolve(import.meta.dirname, "../../web/dist");
  if (existsSync(webDist)) {
    const index = readFileSync(resolve(webDist, "index.html"), "utf8");
    app.use("/assets/*", serveStatic({ root: webDist }));
    app.get("/logo-mark.svg", serveStatic({ root: webDist }));
    app.get("*", (c) => (c.req.path.startsWith("/api") || c.req.path.startsWith("/webhooks") ? c.notFound() : c.html(index)));
  }
  const server = serve({ fetch: app.fetch, port: cfg.PORT }, (i) => log(`[boot] Quiet Accounts listening on :${i.port} · email=${deps.email.name} · owner texts=${deps.notifier.name} · AI=${deps.llm?.model ?? "off"} · Jobber=${deps.fsm.jobber ? "on" : "off"}`));
  const worker = cfg.WORKER_ENABLED === "true" ? startWorker(deps) : undefined;
  if (cfg.EMAIL_PROVIDER === "instantly") {
    (deps.email as InstantlyProvider)
      .ensureWebhooks(webhookUrlFor(cfg.PUBLIC_URL, cfg.WEBHOOK_SECRET))
      .then((r) => log(`[instantly] webhooks ready (${JSON.stringify(r)})`))
      .catch((e: Error) => log(`[instantly] couldn't register webhooks: ${e.message}`));
  }
  const shutdown = () => {
    log("[boot] shutting down");
    worker?.stop();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { deps, app, server };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!)) start();
