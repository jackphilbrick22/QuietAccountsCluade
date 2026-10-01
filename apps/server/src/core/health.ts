import { webhookSetup } from "./backstop.ts";
import { backupDir, backupFiles, lastBackup } from "./backup.ts";
import type { Deps } from "./ops.ts";

/**
 * The operator's health page (GET /api/health/setup): what a deploy can get wrong without anything crashing.
 * Each service's mode, never a key.
 */
export function setupHealth(d: Deps) {
  const hooks = webhookSetup(d);
  const backup = lastBackup(d);
  return {
    // replies, bounces and unsubscribes reach us through these; "unknown" until the first registration try
    instantly:
      d.email.name === "instantly"
        ? { webhooks: !hooks ? "unknown" : hooks.ok ? "ok" : "failing", checkedAt: hooks?.at ?? null, error: hooks?.error ?? null, lastEventAt: d.accounts.repo.lastWebhookAt("instantly") ?? null }
        : { webhooks: "not_set_up" },
    sms: d.notifier.name,
    stripe: stripeMode(d.cfg.STRIPE_SECRET_KEY),
    backup: { lastAt: backup.at ?? null, file: backup.file ?? null, failedAt: backup.failedAt ?? null, error: backup.error ?? null, kept: backupFiles(d.cfg).length, dir: backupDir(d.cfg) ?? null },
  };
}

/** Billing is by hand until a key is set; a key's prefix says test or live. */
export function stripeMode(key: string | undefined): "manual" | "test" | "live" | "unrecognized" {
  if (!key) return "manual";
  if (/^[sr]k_test_/.test(key)) return "test";
  return /^[sr]k_live_/.test(key) ? "live" : "unrecognized";
}
