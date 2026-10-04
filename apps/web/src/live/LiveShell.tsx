import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound, ListChecks, LogOut, MessageSquare, MonitorPlay, Plus, Users } from "lucide-react";
import { useApp } from "../store/app";
import { Button, cx, inputCls, navCls, NavBadge, Wordmark } from "../components/ui";
import { API_BASE, type ReviewQueue, type TextToSendRow } from "./api";
import { useApi, useLive } from "./store";
import { LiveClients, NewClient } from "./Clients";
import { LiveClient } from "./Client";
import { LiveReview } from "./Review";
import { TextsToSend } from "./TextsToSend";
import { SetupPanel } from "./Setup";
import { consoleAside, consoleMain, consoleRoot, Dot, navRow, sideLink, topLink } from "./look";


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
    <div className={cx(consoleRoot, "lg:grid lg:grid-cols-[248px_minmax(0,1fr)]")}>
      <aside className={consoleAside}>
        <div className="flex items-center justify-between gap-2">
          <Wordmark sub="Live" />
          <span className="flex shrink-0 gap-0.5 lg:hidden">
            <button type="button" className={topLink} onClick={() => go({ area: "welcome", tab: "today" })}>
              Demo
            </button>
            <button type="button" className={topLink} onClick={() => signOut()}>
              Sign out
            </button>
          </span>
        </div>
        <nav className={navRow} aria-label="Live console">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => go({ area: "live", tab: n.id })}
              aria-current={tab === n.id || (n.id === "clients" && (tab === "client" || tab === "new")) ? "page" : undefined}
              className={cx(navCls(tab === n.id || (n.id === "clients" && (tab === "client" || tab === "new"))), "shrink-0")}
            >
              <n.icon size={17} aria-hidden="true" />
              <span className="flex-1">{n.label}</span>
              {n.id !== "clients" && badge[n.id] > 0 && <NavBadge>{badge[n.id]}</NavBadge>}
            </button>
          ))}
          <button type="button" onClick={() => go({ area: "live", tab: "new" })} className={cx(navCls(false), "shrink-0")}>
            <Plus size={17} aria-hidden="true" /> Add client
          </button>
        </nav>
        <div className="mt-auto hidden flex-col gap-3 lg:flex">
          <div className="flex flex-col divide-y divide-line overflow-hidden rounded-box border border-line bg-sunken empty:hidden">
            {health && (
              <div className="flex flex-col px-3.5 py-3 text-[12px] leading-relaxed text-ink-3">
                <div className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold text-ink">
                  <span className="grid w-[13px] place-items-center">
                    <Dot tone="ok" />
                  </span>
                  Server connected
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
          </div>
          <div className="flex flex-col gap-0.5">
            <button type="button" className={sideLink} onClick={() => go({ area: "welcome", tab: "today" })}>
              <MonitorPlay size={16} aria-hidden="true" className="text-ink-3" /> Demo mode
            </button>
            <button type="button" className={sideLink} onClick={() => signOut()}>
              <LogOut size={16} aria-hidden="true" className="text-ink-3" /> Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className={consoleMain}>
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
    <div className={cx(consoleRoot, "relative isolate grid place-items-center overflow-hidden bg-bg px-4 py-10")}>
      {/* the site's hero glow, behind the card */}
      <div aria-hidden="true" className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[620px] w-[min(900px,150vw)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(150,120,255,0.2),rgba(150,120,255,0))]" />
      <div className="flex w-full max-w-[440px] flex-col items-center gap-6">
        <div className="flex justify-center">
          <Wordmark sub="Live" />
        </div>
        <div className="w-full rounded-[26px] border border-line bg-surface px-5 py-6 shadow-card sm:px-7 sm:py-7">
          <div className="flex flex-col gap-2">
            <h1 className="text-[28px] sm:text-[30px]">Operator sign-in</h1>
            <p className="text-[14.5px] leading-relaxed text-ink-2">Paste the operator token once. It stays in this browser until you sign out.</p>
          </div>
          <form
            className="mt-5 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void signIn(token).then((ok) => {
                setBusy(false);
                if (ok) go({ area: "live", tab: "clients" });
              });
            }}
          >
            <label htmlFor="op-token" className="text-[13.5px] font-semibold text-ink-2">
              Operator token
            </label>
            <input id="op-token" type="password" autoComplete="current-password" className={cx(inputCls, "max-sm:px-3.5 max-sm:placeholder:text-[14px]")} value={token} onChange={(e) => setToken(e.target.value)} placeholder="From OPERATOR_TOKEN on the server" />
            {error && (
              <p role="alert" className="text-[13.5px] font-semibold text-bad">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="mt-2 w-full" disabled={busy}>
              <KeyRound size={17} aria-hidden="true" /> {busy ? "Checking…" : "Sign in"}
            </Button>
          </form>
          <p className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-[12.5px] leading-relaxed text-ink-3">
            <span className="grid h-5 shrink-0 place-items-center">
              <Dot tone={health ? "ok" : "bad"} />
            </span>
            <span className="min-w-0">
              Server: <span className="font-mono break-all">{API_BASE || (typeof location !== "undefined" ? location.origin : "")}</span> ·{" "}
              {health ? <span className="font-semibold text-ok">reachable ({health.businesses} clients)</span> : <span className="font-semibold text-bad">not reachable</span>}
            </span>
          </p>
        </div>
        <button type="button" onClick={() => go({ area: "welcome", tab: "today" })} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line-2 bg-surface px-5 text-[14px] font-semibold text-ink-2 transition-colors hover:border-accent-line hover:bg-accent-wash hover:text-ink">
          <ArrowLeft size={15} aria-hidden="true" /> Back to the demo
        </button>
      </div>
    </div>
  );
}
