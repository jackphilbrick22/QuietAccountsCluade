import { billingCheck, chase, closeIfDue, find, isoWeekKey, reportWeek } from "@qa/engine";
import { localIso } from "./clock.ts";
import { deliverOwnerMessages, handleInbound, plan, sendAck, sendDue, syncFsm, writeFsmNote, type AckTask, type Deps } from "./ops.ts";

/**
 * The heartbeat. Every minute, for every business, in its own local time:
 *  - Sender: send what's due (or hand the week's people to the sequencer)
 *  - Dispatcher: nudge the owner about hot leads nobody has called
 *  - Reporter: Friday afternoon report; the close after the free round; the pre-charge text
 *  - Finder: nightly re-scan (ages, seasons and suppressions change daily)
 *  - Writer: nightly top-up for paying accounts so the list keeps being worked at the weekly pace
 *  - Reader/Ledger: hourly sync from connected software, then match who came back
 *  - background tasks queue (webhook follow-ups, retries)
 * Each step is isolated: one business failing never stops the others.
 */
export interface TickReport {
  businesses: number;
  sent: number;
  failed: number;
  ownerMessages: number;
  synced: number;
  planned: number;
  errors: string[];
}

export async function tick(d: Deps): Promise<TickReport> {
  const report: TickReport = { businesses: 0, sent: 0, failed: 0, ownerMessages: 0, synced: 0, planned: 0, errors: [] };
  const now = d.clock();
  for (const biz of d.accounts.repo.listBusinesses()) {
    report.businesses++;
    const bid = biz.id;
    const tz = biz.profile.timezone || "America/New_York";
    const local = localIso(now, tz);
    const hour = Number(local.slice(11, 13));
    const minute = Number(local.slice(14, 16));
    const day = new Date(`${local.slice(0, 10)}T12:00:00Z`).getUTCDay();
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
        if (state.dataset.asOf !== local.slice(0, 10)) state.dataset.asOf = local.slice(0, 10);
      });
    });

    if (!biz.paused)
      await step("send", async () => {
        const r = await sendDue(d, bid);
        report.sent += r.sent;
        report.failed += r.failed;
      });

    await step("dispatch", async () => {
      await d.accounts.withAccount(bid, (state) => {
        chase(state, local, d.cfg.SLA_FIRST_NUDGE_HOURS);
        if (hour === 9 && minute < 5) {
          closeIfDue(state, local);
          billingCheck(state, local);
        }
        // Friday 4pm local: the week in plain English (once per ISO week)
        if (day === 5 && hour === 16) {
          const wk = isoWeekKey(local.slice(0, 10));
          const already = state.ownerMessages.some((m) => m.kind === "weekly" && isoWeekKey(m.at.slice(0, 10)) === wk);
          const active = state.touches.some((t) => t.status === "sent");
          if (!already && active) reportWeek(state, local);
        }
      });
      report.ownerMessages += await deliverOwnerMessages(d, bid);
    });

    // Nightly (2am local): re-scan and keep paying accounts' pipeline full.
    if (hour === 2 && minute < 5) {
      const last = biz.scannedAt ? Date.parse(biz.scannedAt) : 0;
      if (now.getTime() - last > 20 * 3600000)
        await step("rescan", async () => {
          await d.accounts.withAccount(bid, (state) => find(state, local));
          d.accounts.repo.markScanned(bid, now.toISOString());
          if (biz.profile.plan.stage === "paying" && !biz.paused) {
            const p = await plan(d, bid, { approve: true });
            report.planned += p.people;
          }
        });
    }

    // Hourly sync with connected software.
    const integ = d.accounts.repo.getIntegration(bid, "jobber");
    if (integ && integ.status === "connected" && (!integ.last_sync_at || now.getTime() - Date.parse(integ.last_sync_at) > 55 * 60000))
      await step("sync", async () => {
        const r = await syncFsm(d, bid, "jobber");
        if (r) report.synced += r.records;
      });
  }
  await runTasks(d, report);
  return report;
}

/** Background tasks: deferred webhook work and retries. */
export async function runTasks(d: Deps, report?: TickReport): Promise<void> {
  const now = d.clock();
  for (const t of d.accounts.repo.dueTasks(now.toISOString(), 25)) {
    try {
      const p = JSON.parse(t.payload) as Record<string, string>;
      if (t.type === "jobber.sync" && t.business_id) await syncFsm(d, t.business_id, "jobber");
      else if (t.type === "inbound.retry") await handleInbound(d, JSON.parse(p.event!));
      else if (t.type === "reply.ack" && t.business_id) await sendAck(d, t.business_id, p as unknown as AckTask);
      else if (t.type === "jobber.note" && t.business_id) await writeFsmNote(d, t.business_id, { kind: p.kind as "quote" | "client", sourceId: p.sourceId!, text: p.text! });
      else if (t.type === "sequencer.stop" && d.email.kind === "sequencer" && p.bid) {
        const state = d.accounts.peek(p.bid)?.state;
        if (state) await d.email.stopLead(state.dataset.business, p.campaignId!, p.email!, p.reason as "replied");
      }
      d.accounts.repo.finishTask(t.seq, true);
    } catch (e) {
      const retryAt = t.attempts < 5 ? new Date(now.getTime() + 2 ** t.attempts * 60000).toISOString() : undefined;
      d.accounts.repo.finishTask(t.seq, false, (e as Error).message, retryAt);
      report?.errors.push(`task ${t.type}: ${(e as Error).message}`);
    }
  }
}

export function startWorker(d: Deps): { stop: () => void } {
  let running = false;
  let stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const r = await tick(d);
      if (r.sent || r.failed || r.ownerMessages || r.errors.length) d.log(`[worker] tick: ${r.businesses} businesses, ${r.sent} sent, ${r.failed} failed, ${r.ownerMessages} owner texts, ${r.errors.length} errors`);
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
