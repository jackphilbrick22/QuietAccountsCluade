import type { SetupHealth } from "./api";
import { ago } from "./parts";
import { useApi } from "./store";

const WEBHOOKS: Record<SetupHealth["instantly"]["webhooks"], string> = { ok: "OK", failing: "failing", unknown: "not registered yet", not_set_up: "not set up" };
const SMS: Record<string, string> = { log: "server log only", twilio: "Twilio", manual: "by hand" };
const STRIPE: Record<SetupHealth["stripe"], string> = { manual: "manual", test: "test mode", live: "live", unrecognized: "key not recognized" };

/** The deploy at a glance: Instantly's webhooks, how owner texts and billing go out, the last database backup. */
export function SetupPanel() {
  const { data: s } = useApi<SetupHealth>("/health/setup", { poll: 5 * 60_000 });
  if (!s) return null;
  const hooks = s.instantly;
  const backupFailed = !!s.backup.failedAt;
  return (
    <div className="rounded-md bg-bg px-3 py-2 text-[12px] text-ink-3">
      <div className="font-semibold text-ink-2">Setup</div>
      <div className={hooks.webhooks === "failing" ? "font-semibold text-bad" : undefined} title={hooks.error ?? undefined}>
        Instantly webhooks: {WEBHOOKS[hooks.webhooks]}
        {hooks.lastEventAt ? `, last ${ago(hooks.lastEventAt)}` : ""}
      </div>
      <div className={s.sms === "log" ? "text-warn" : undefined}>Owner texts: {SMS[s.sms] ?? s.sms}</div>
      <div className={s.stripe === "unrecognized" ? "font-semibold text-bad" : undefined}>Stripe: {STRIPE[s.stripe]}</div>
      <div className={backupFailed ? "font-semibold text-bad" : undefined} title={s.backup.error ?? s.backup.file ?? undefined}>
        {backupFailed ? `Backup failed ${ago(s.backup.failedAt)}` : `Last backup: ${s.backup.lastAt ? ago(s.backup.lastAt) : "none yet"}`}
        {s.backup.kept ? ` (${s.backup.kept} kept)` : ""}
      </div>
    </div>
  );
}
