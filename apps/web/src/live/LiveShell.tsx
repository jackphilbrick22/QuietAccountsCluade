import { useEffect, useState } from "react";
import { KeyRound, ListChecks, LogOut, MessageSquare, MonitorPlay, Plus, Users } from "lucide-react";
import { useApp } from "../store/app";
import { cx, Wordmark } from "../components/ui";
import { Box, Btn, smallInputCls } from "../components/table";
import { API_BASE, type ReviewQueue, type TextToSendRow } from "./api";
import { useApi, useLive } from "./store";
import { LiveClients, NewClient } from "./Clients";
import { LiveClient } from "./Client";
import { LiveReview } from "./Review";
import { TextsToSend } from "./TextsToSend";
import { SetupPanel } from "./Setup";

const NAV = [
  { id: "clients", label: "Clients", icon: Users },
  { id: "review", label: "Needs a person", icon: ListChecks },
  { id: "texts", label: "Texts to send", icon: MessageSquare },
] as const;

export function LiveShell() {
  const token = useLive((s) => s.token);
  const loadHealth = useLive((s) => s.loadHealth);
  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);
  if (!token) return <SignIn />;
  return <Console />;
}

function Console() {
  const view = useApp((s) => s.view);
  const go = useApp((s) => s.go);
  const signOut = useLive((s) => s.signOut);
  const health = useLive((s) => s.health);
  const review = useApi<ReviewQueue>("/review", { poll: 60_000 });
  const texts = useApi<TextToSendRow[]>("/texts-to-send", { poll: 60_000 });
  const badge = { review: review.data?.items.length ?? 0, texts: texts.data?.length ?? 0 };
  const tab = view.tab === "client" && view.detail ? "client" : view.tab === "new" ? "new" : view.tab === "review" || view.tab === "texts" ? view.tab : "clients";

  return (
    <div className="min-h-full lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4 border-b border-line bg-surface px-4 py-4 lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0 lg:px-3 lg:py-5">
        <div className="flex items-center justify-between gap-2">
          <Wordmark sub="Live" />
          <span className="flex gap-1 lg:hidden">
            <button type="button" className="cursor-pointer rounded-lg px-2 py-1 text-[13px] font-semibold text-ink-3 hover:bg-surface-2" onClick={() => go({ area: "welcome", tab: "today" })}>
              Demo
            </button>
            <button type="button" className="cursor-pointer rounded-lg px-2 py-1 text-[13px] font-semibold text-ink-3 hover:bg-surface-2" onClick={() => signOut()}>
              Sign out
            </button>
          </span>
        </div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Live console">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => go({ area: "live", tab: n.id })}
              aria-current={tab === n.id || (n.id === "clients" && (tab === "client" || tab === "new")) ? "page" : undefined}
              className={cx(
                "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-[14px] font-semibold whitespace-nowrap",
                tab === n.id || (n.id === "clients" && (tab === "client" || tab === "new")) ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <n.icon size={17} />
              <span className="flex-1">{n.label}</span>
              {n.id !== "clients" && badge[n.id] > 0 && <span className="num rounded-full bg-accent px-2 text-[12px] leading-5 font-bold text-on-accent">{badge[n.id]}</span>}
            </button>
          ))}
          <button type="button" onClick={() => go({ area: "live", tab: "new" })} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-[14px] font-semibold whitespace-nowrap text-ink-2 hover:bg-surface-2 hover:text-ink">
            <Plus size={17} /> Add client
          </button>
        </nav>
        <div className="mt-auto hidden flex-col gap-2 lg:flex">
          {health && (
            <div className="rounded-md bg-bg px-3 py-2 text-[12px] text-ink-3">
              <div className="flex items-center gap-1.5 font-semibold text-ink-2">
                <span className="size-1.5 rounded-full bg-ok" /> Server connected
              </div>
              <div>Email: {health.email}</div>
              <div>Owner texts: {health.sms}</div>
              <div>AI reader: {health.ai ?? "off"}</div>
              {health.worker && health.worker.ticks > 0 && (
                <div className={health.worker.stalled || health.worker.behind ? "font-semibold text-bad" : undefined}>
                  {health.worker.stalled
                    ? `Worker stalled: no tick for ${Math.round((health.worker.secondsSinceLastTick ?? 0) / 60)} min`
                    : `Worker: ${((health.worker.lastTickMs ?? 0) / 1000).toFixed(1)}s a tick${health.worker.behind ? `, ${health.worker.behind} client${health.worker.behind === 1 ? "" : "s"} behind` : ""}`}
                </div>
              )}
            </div>
          )}
          <SetupPanel />
          <button type="button" className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-[13.5px] font-semibold text-ink-3 hover:bg-surface-2 hover:text-ink" onClick={() => go({ area: "welcome", tab: "today" })}>
            <MonitorPlay size={16} /> Demo mode
          </button>
          <button type="button" className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-[13.5px] font-semibold text-ink-3 hover:bg-surface-2 hover:text-ink" onClick={() => signOut()}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-[1320px] min-w-0 px-4 py-6 sm:px-6">
        {tab === "clients" && <LiveClients />}
        {tab === "new" && <NewClient />}
        {tab === "client" && <LiveClient id={view.detail!} />}
        {tab === "review" && <LiveReview queue={review} />}
        {tab === "texts" && <TextsToSend list={texts} />}
      </main>
    </div>
  );
}

function SignIn() {
  const signIn = useLive((s) => s.signIn);
  const error = useLive((s) => s.signInError);
  const health = useLive((s) => s.health);
  const go = useApp((s) => s.go);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-full place-items-center bg-bg px-4 py-10">
      <div className="flex w-full max-w-[420px] flex-col gap-5">
        <Wordmark sub="Live" />
        <Box className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <h1 className="font-body text-[20px] font-bold tracking-tight">Operator sign-in</h1>
            <p className="text-[13.5px] text-ink-2">Paste the operator token once. It stays in this browser until you sign out.</p>
          </div>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void signIn(token).then((ok) => {
                setBusy(false);
                if (ok) go({ area: "live", tab: "clients" });
              });
            }}
          >
            <label htmlFor="op-token" className="text-[12.5px] font-semibold text-ink-2">
              Operator token
            </label>
            <input id="op-token" type="password" autoComplete="current-password" className={smallInputCls} value={token} onChange={(e) => setToken(e.target.value)} placeholder="From OPERATOR_TOKEN on the server" />
            {error && (
              <p role="alert" className="text-[13px] text-bad">
                {error}
              </p>
            )}
            <Btn type="submit" variant="primary" disabled={busy}>
              <KeyRound size={15} /> {busy ? "Checking…" : "Sign in"}
            </Btn>
          </form>
          <p className="text-[12px] text-ink-3">
            Server: <span className="font-mono">{API_BASE || (typeof location !== "undefined" ? location.origin : "")}</span> ·{" "}
            {health ? <span className="text-ok">reachable ({health.businesses} clients)</span> : <span className="text-bad">not reachable</span>}
          </p>
        </Box>
        <button type="button" onClick={() => go({ area: "welcome", tab: "today" })} className="cursor-pointer self-start text-[13.5px] font-semibold text-ink-2 underline underline-offset-2 hover:text-ink">
          Back to the demo
        </button>
      </div>
    </div>
  );
}
