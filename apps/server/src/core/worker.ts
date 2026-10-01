import { billingCheck, chase, closeIfDue, find, isOnePass, isoWeekKey, passEndIfDue, renewalIfDue, reportWeek, type BusinessProfile } from "@qa/engine";
import { checkWebhooks, pollReplies } from "./backstop.ts";
import { backupIfDue } from "./backup.ts";
import { localIso } from "./clock.ts";
import { noInbox } from "./senders.ts";
import { features } from "../config.ts";
import { deliverOwnerMessages, handleInbound, holdReason, holdSending, plan, sendAck, sendDue, staleRecords, syncFsm, writeFsmNote, type AckTask, type Deps } from "./ops.ts";

/**
 * The heartbeat. Every minute, for every business, in its own local time:
 *  - Sender: send what's due (or hand the week's people to the sequencer)
 *  - Dispatcher: nudge the owner about hot leads nobody has called
 *  - Reporter: Friday afternoon report; the close after the free round; the pre-charge text; with the yearly plan
 *    sold (FEATURE_YEARLY), the renewal ask and settling a year; a one pass's end once its list is done
 *  - Finder: nightly re-scan (ages, seasons and suppressions change daily)
 *  - Writer: nightly top-up for paying monthly accounts so the list keeps being worked at the weekly pace (a one pass
 *    is the whole list once: never topped up)
 *  - Reader/Ledger: hourly sync from connected software, then match who came back
 *  - Inbox backstop: replies the sending platform never announced by webhook; its disabled webhooks
 *  - Backup: the nightly copy of the database
 *  - background tasks queue (webhook follow-ups, retries)
 * Each step is isolated: one business failing never stops the others, and one slow business never holds up the
 * rest: each gets a time budget, after which the tick moves on and that business's turn finishes in the background
 * (it's skipped until then, so nothing is ever sent twice). A cancelled business gets no more work at all.
 */
export interface TickReport {
  businesses: number;
  sent: number;
  failed: number;
  ownerMessages: number;
  synced: number;
  planned: number;
  errors: string[];
  /** Businesses skipped because their previous turn is still running. */
  busy: number;
  ms: number;
}

/** What /api/health shows about the worker: is it ticking, how long a tick takes, how far behind each client is. */
export interface WorkerStats {
  ticks: number;
  running: boolean;
  lastTickStartedAt?: string;
  lastTickAt?: string;
  lastTickMs?: number;
  lastErrors: string[];
  /** Per business: when its last turn finished, how long it took, and whether it ran over its budget. */
  businesses: Map<string, { lastVisitAt?: string; lastMs?: number; overBudget?: boolean }>;
  /** Businesses whose turn (or task) is still running past its budget. */
  inflight: Set<string>;
}

const statsByDeps = new WeakMap<object, WorkerStats>();

export function workerStats(d: Deps): WorkerStats {
  let s = statsByDeps.get(d);
  if (!s) statsByDeps.set(d, (s = { ticks: 0, running: false, lastErrors: [], businesses: new Map(), inflight: new Set() }));
  return s;
}

/**
 * Run one business's work with a time budget. Past it, the caller moves on and the work finishes in the background;
 * the business stays "in flight" (skipped by the next tick and by its queued tasks) until it does.
 */
async function withBudget(d: Deps, bid: string, report: TickReport, label: string, fn: () => Promise<void>, visit: boolean): Promise<void> {
  const s = workerStats(d);
  const budget = d.cfg.WORKER_BUSINESS_BUDGET_MS;
  const started = Date.now();
  s.inflight.add(bid);
  const work = fn()
    .catch((e) => {
      report.errors.push(`${bid} ${label}: ${(e as Error).message}`);
      d.log(`[worker] ${bid} ${label} failed: ${(e as Error).stack ?? e}`);
    })
    .finally(() => {
      s.inflight.delete(bid);
      if (visit) s.businesses.set(bid, { lastVisitAt: d.clock().toISOString(), lastMs: Date.now() - started, overBudget: Date.now() - started > budget });
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const over = await Promise.race([work.then(() => false), new Promise<boolean>((r) => (timer = setTimeout(() => r(true), budget)))]);
  clearTimeout(timer);
  if (over) {
    report.errors.push(`${bid} ${label}: still running after ${Math.round(budget / 1000)}s — moved on to the other clients; it finishes in the background`);
    d.log(`[worker] ${bid} ${label} is over its ${budget}ms budget; continuing with the others`);
  }
}

export async function tick(d: Deps): Promise<TickReport> {
  const report: TickReport = { businesses: 0, sent: 0, failed: 0, ownerMessages: 0, synced: 0, planned: 0, errors: [], busy: 0, ms: 0 };
  const s = workerStats(d);
  const t0 = Date.now();
  s.running = true;
  s.lastTickStartedAt = d.clock().toISOString();
  try {
    const now = d.clock();
    const all = d.accounts.repo.listBusinesses();
    for (const id of s.businesses.keys()) if (!all.some((b) => b.id === id)) s.businesses.delete(id);
    for (const biz of all) {
      report.businesses++;
      if (s.inflight.has(biz.id)) {
        report.busy++;
        continue;
      }
      await withBudget(d, biz.id, report, "turn", () => businessTurn(d, biz, now, report), true);
    }
    // The sending platform: replies its webhooks missed (every few minutes), webhooks it switched off (every 15).
    // Then the database's daily backup.
    for (const [name, fn] of [["reply check", pollReplies], ["webhook check", checkWebhooks], ["backup", backupIfDue]] as const) {
      try {
        await fn(d);
      } catch (e) {
        report.errors.push(`${name}: ${(e as Error).message}`);
        d.log(`[worker] ${name} failed: ${(e as Error).message}`);
      }
    }
    await runTasks(d, report);
  } finally {
    report.ms = Date.now() - t0;
    s.running = false;
    s.ticks++;
    s.lastTickMs = report.ms;
    s.lastTickAt = d.clock().toISOString();
    s.lastErrors = report.errors.slice(-20);
  }
  return report;
}

type Biz = ReturnType<Deps["accounts"]["repo"]["listBusinesses"]>[number];

/** One business's turn in a tick. */
async function businessTurn(d: Deps, biz: Biz, now: Date, report: TickReport): Promise<void> {
  const bid = biz.id;
  const tz = biz.profile.timezone || "America/New_York";
  const local = localIso(now, tz);
  const today = local.slice(0, 10);
  const hour = Number(local.slice(11, 13));
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  // Cancelled by text: no notes, no reminders, no reports, no billing texts, no more reading their software. A one pass
  // that's done sends nothing more either, but its late replies still reach the owner.
  const cancelled = biz.profile.plan.stage === "cancelled";
  const done = biz.profile.plan.stage === "done";
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      report.errors.push(`${bid} ${name}: ${(e as Error).message}`);
      d.log(`[worker] ${bid} ${name} failed: ${(e as Error).stack ?? e}`);
    }
  };

  await step("clock", async () => {
    await d.accounts.withAccount(bid, (state) => {
      if (state.dataset.asOf !== today) state.dataset.asOf = today;
    });
  });

  // (a finished pass still comes here: nothing of it is sent, and its campaigns on the platform stay held)
  if (!biz.paused && !cancelled)
    await step("send", async () => {
      const r = await sendDue(d, bid);
      report.sent += r.sent;
      report.failed += r.failed;
    });

  await step("dispatch", async () => {
    if (!cancelled) {
      let lapsed = false;
      let ended = false;
      // The daily checks run once a day from 9am local, marked done in the database: a restart or a slow tick
      // at 9:00 can't skip them for the day.
      const daily = hour >= 9 && d.accounts.repo.mark(bid, "daily") !== today;
      await d.accounts.withAccount(bid, (state) => {
        chase(state, local, d.cfg.SLA_FIRST_NUDGE_HOURS);
        if (daily) {
          const f = features(d.cfg);
          closeIfDue(state, local, f);
          billingCheck(state, local);
          ended = !!passEndIfDue(state, local);
          // A yearly plan never renews by itself: ask a month out, pause at the end if nobody said yes.
          if (f.yearly && renewalIfDue(state, local)?.refs?.some((r) => r.kind === "year_end") && state.dataset.business.plan.stage === "paused") lapsed = true;
        }
        // Friday from 4pm local: the week in plain English (once per ISO week)
        if (day === 5 && hour >= 16) {
          const wk = isoWeekKey(today);
          const already = state.ownerMessages.some((m) => m.kind === "weekly" && isoWeekKey(m.at.slice(0, 10)) === wk);
          const active = state.touches.some((t) => t.status === "sent");
          if (!already && active && !done) reportWeek(state, local);
        }
      });
      if (daily) d.accounts.repo.setMark(bid, "daily", today);
      if (lapsed) await holdSending(d, bid, "pause");
      // the list is done: nothing more goes, and its inboxes are free for another client
      if (ended) await holdSending(d, bid, "done");
    }
    report.ownerMessages += await deliverOwnerMessages(d, bid);
  });

  if (cancelled) return;

  // Nightly (once, between 2 and 6am local): re-scan unless a sync just did, and keep paying accounts' pipeline full.
  // Marked done in the database, so neither a restart nor an hourly Jobber sync (which re-scans) skips the top-up.
  if (hour >= 2 && hour < 6 && d.accounts.repo.mark(bid, "nightly") !== today)
    await step("nightly", async () => {
      const last = biz.scannedAt ? Date.parse(biz.scannedAt) : 0;
      if (now.getTime() - last > 20 * 3600000) {
        await d.accounts.withAccount(bid, (state) => find(state, local, features(d.cfg)));
        d.accounts.repo.markScanned(bid, now.toISOString());
      }
      // with Instantly, a client with no inbox of its own isn't planned (its page says so); nor is a lawn shop's in its
      // season from records two weeks old (Jack is asked for fresh ones)
      if (!isOnePass(biz.profile.plan) && biz.profile.plan.stage === "paying" && !biz.paused && !noInbox(d, biz.profile) && !(await staleRecords(d, bid))) {
        const p = await plan(d, bid, { approve: true });
        report.planned += p.people;
      }
      d.accounts.repo.setMark(bid, "nightly", today);
    });

  // Hourly sync with connected software; after a failure, wait 15 minutes rather than retry every minute.
  const integ = d.accounts.repo.getIntegration(bid, "jobber");
  const due = !!integ && integ.status === "connected" && (!integ.last_sync_at || now.getTime() - Date.parse(integ.last_sync_at) > 55 * 60000);
  const backoff = !!integ?.last_error && !!integ.last_attempt_at && now.getTime() - Date.parse(integ.last_attempt_at) < 15 * 60000;
  if (due && !backoff)
    await step("sync", async () => {
      const r = await syncFsm(d, bid, "jobber");
      if (r) report.synced += r.records;
    });
}

/** Background tasks: deferred webhook work and retries. A task waits while its business's turn is still running. */
export async function runTasks(d: Deps, report?: TickReport): Promise<void> {
  const r = report ?? { businesses: 0, sent: 0, failed: 0, ownerMessages: 0, synced: 0, planned: 0, errors: [], busy: 0, ms: 0 };
  const s = workerStats(d);
  const now = d.clock();
  for (const t of d.accounts.repo.dueTasks(now.toISOString(), 25)) {
    if (t.business_id && s.inflight.has(t.business_id)) continue;
    const run = async () => {
      try {
        const p = JSON.parse(t.payload) as Record<string, string>;
        if (t.type === "jobber.sync" && t.business_id) await syncFsm(d, t.business_id, "jobber");
        else if (t.type === "inbound.retry") await handleInbound(d, JSON.parse(p.event!));
        else if (t.type === "reply.ack" && t.business_id) await sendAck(d, t.business_id, p as unknown as AckTask);
        else if (t.type === "jobber.note" && t.business_id) await writeFsmNote(d, t.business_id, { kind: p.kind as "quote" | "client", sourceId: p.sourceId!, text: p.text! });
        else if (t.type === "sequencer.stop" && d.email.kind === "sequencer" && p.bid) {
          const state = d.accounts.peek(p.bid)?.state;
          if (state) await d.email.stopLead(state.dataset.business, p.campaignId!, p.email!, p.reason as "replied");
        } else if (t.type === "sequencer.withdraw" && d.email.kind === "sequencer") {
          // notes taken back from the platform (a cancel, a delete, a move); the client may be gone by now
          const w = JSON.parse(t.payload) as { bid: string; profile: Pick<BusinessProfile, "id" | "name">; leads: { campaignId: string; email: string }[] };
          const b = d.accounts.peek(w.bid)?.state.dataset.business ?? (w.profile as BusinessProfile);
          for (const l of w.leads) await d.email.stopLead(b, l.campaignId, l.email, "withdrawn");
        } else if (t.type === "sequencer.pause" && d.email.kind === "sequencer") {
          // a campaign pause/restart that failed: do what's wanted now (a deleted client stays paused)
          const w = JSON.parse(t.payload) as { bid: string; campaignId: string; profile: Pick<BusinessProfile, "id" | "name"> };
          const l = d.accounts.peek(w.bid);
          const paused = !l || !!holdReason(l) || !!l.state.dataset.business.platformPaused;
          await d.email.pauseCampaign(l?.state.dataset.business ?? (w.profile as BusinessProfile), w.campaignId, paused);
        }
        d.accounts.repo.finishTask(t.seq, true);
      } catch (e) {
        const retryAt = t.attempts < 5 ? new Date(now.getTime() + 2 ** t.attempts * 60000).toISOString() : undefined;
        d.accounts.repo.finishTask(t.seq, false, (e as Error).message, retryAt);
        r.errors.push(`task ${t.type}: ${(e as Error).message}`);
      }
    };
    if (t.business_id) await withBudget(d, t.business_id, r, `task ${t.type}`, run, false);
    else await run();
  }
}

/** Worker liveness for /api/health: stalled when no tick has finished in five intervals (or five minutes). */
export function workerHealth(d: Deps, opts: { detail: boolean }): Record<string, unknown> {
  const s = workerStats(d);
  const now = d.clock().getTime();
  const limit = Math.max(5 * d.cfg.WORKER_INTERVAL_MS, 5 * 60000);
  const since = (iso?: string) => (iso ? Math.round((now - Date.parse(iso)) / 1000) : null);
  const last = s.lastTickAt ?? (s.running ? s.lastTickStartedAt : undefined);
  const stalled = d.cfg.WORKER_ENABLED === "true" && s.ticks + (s.running ? 1 : 0) > 0 && (!last || now - Date.parse(last) > limit);
  const lags = [...s.businesses.entries()].map(([id, b]) => ({ id, lagSeconds: since(b.lastVisitAt), lastTurnMs: b.lastMs ?? null, overBudget: !!b.overBudget, running: s.inflight.has(id) }));
  const behind = lags.filter((b) => b.running || (b.lagSeconds ?? 0) * 1000 > limit);
  return {
    stalled,
    ticks: s.ticks,
    running: s.running,
    lastTickAt: s.lastTickAt ?? null,
    lastTickMs: s.lastTickMs ?? null,
    secondsSinceLastTick: since(s.lastTickAt),
    maxLagSeconds: lags.reduce<number | null>((m, b) => (b.lagSeconds === null ? m : Math.max(m ?? 0, b.lagSeconds)), null),
    behind: behind.length,
    ...(opts.detail ? { errors: s.lastErrors, businesses: lags.sort((a, b) => (b.lagSeconds ?? 0) - (a.lagSeconds ?? 0)) } : {}),
  };
}

export function startWorker(d: Deps): { stop: () => void } {
  let running = false;
  let stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const r = await tick(d);
      if (r.sent || r.failed || r.ownerMessages || r.errors.length || r.busy) d.log(`[worker] tick: ${r.businesses} businesses, ${r.sent} sent, ${r.failed} failed, ${r.ownerMessages} owner texts, ${r.busy} still busy, ${r.errors.length} errors, ${r.ms}ms`);
    } catch (e) {
      d.log(`[worker] tick crashed: ${(e as Error).stack ?? e}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, d.cfg.WORKER_INTERVAL_MS);
  void run();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
