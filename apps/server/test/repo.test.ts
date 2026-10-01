import { afterEach, describe, expect, it } from "vitest";
import { addDays, reconcile, scan, type AccountState } from "@qa/engine";
import { harness, type Harness } from "./harness.ts";

/**
 * What an import or the ledger takes away stays away: a visit a re-sent report no longer has, a client list's earlier
 * date, a booking taken off the ledger. The account reads the same from SQLite (after a restart, an eviction from the
 * cache, or a failed operation) as it did in memory.
 */
const HEAD = "Job #,Date,Visit title,Client name,Client email,Visit completed,Visit based ($),Job type";
const weekly = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 7)) out.push(d);
  return out;
};
const rows = (job: number, name: string, dates: string[], doneTo: string) =>
  dates.map((d) => `${job},${d},Weekly mowing,${name},${name.split(" ")[0]!.toLowerCase()}@gmail.com,${d <= doneTo ? "Yes" : "No"},45.00,Recurring`);
const file = (lines: string[]) => ({ name: "Visits Report.csv", text: [HEAD, ...lines].join("\n") });

let h: Harness;
afterEach(() => h?.close());

/** The account as it is in memory, then as SQLite has it once the cache lets it go. */
async function bothWays<T>(id: string, read: (s: AccountState) => T): Promise<[T, T]> {
  const warm = await h.d.accounts.withAccount(id, (s) => read(s), { save: false });
  h.d.accounts.forget(id);
  const cold = await h.d.accounts.withAccount(id, (s) => read(s), { save: false });
  return [warm, cold];
}

describe("deletions that last", () => {
  it("a visit a re-sent report no longer has stays gone, and a client list's earlier date too", async () => {
    h = harness({ now: "2026-06-01T14:00:00Z" });
    await h.business("greenline", { name: "Greenline Lawn Care", trade: "lawn" });
    // June 1st: Mike weekly through November, nothing marked. September 1st: his job was closed after June 8th.
    await h.d.accounts.withAccount("greenline", (s) => {
      reconcile(s, [file([...rows(901, "Mike Sanderson", weekly("2026-04-06", "2026-11-02"), ""), ...rows(902, "Linda Whitfield", weekly("2026-04-07", "2026-11-03"), "")])], "2026-06-01T14:00:00Z");
    });
    await h.d.accounts.withAccount("greenline", (s) => {
      reconcile(s, [file([...rows(901, "Mike Sanderson", weekly("2026-04-06", "2026-06-08"), ""), ...rows(902, "Linda Whitfield", weekly("2026-04-07", "2026-11-03"), "")])], "2026-09-01T14:00:00Z");
      // Karen is on the client list alone: August's list, then September's
      reconcile(s, [{ name: "Clients.csv", text: "Client name,Email,Last Visit\nKaren Brennan,karen@gmail.com,2026-08-20\n" }], "2026-09-01T14:00:00Z");
      reconcile(s, [{ name: "Clients.csv", text: "Client name,Email,Last Visit\nKaren Brennan,karen@gmail.com,2026-08-27\n" }], "2026-09-01T14:00:00Z");
    });
    const [warm, cold] = await bothWays("greenline", (s) => ({
      jobs: s.dataset.jobs.map((j) => j.id).sort(),
      found: scan(s.dataset).opportunities.map((o) => [o.customerId, o.type, o.suppressed ?? "", o.anchorDate]),
    }));
    expect(warm.jobs).toHaveLength(10 + 31 + 1);
    expect(warm.found).toEqual([[expect.any(String), "lapsed_regular", "", "2026-06-08"]]);
    expect(cold).toEqual(warm);
  });

  it("a booking taken off the ledger stays off", async () => {
    h = harness({ now: "2026-08-14T14:00:00Z" });
    await h.business("greenline", { name: "Greenline Lawn Care", trade: "lawn" });
    const linda = (to: string) => rows(300, "Linda Whitfield", weekly("2026-04-07", "2026-10-27"), to);
    const mike = rows(100, "Mike Sanderson", weekly("2026-04-06", "2026-06-08"), "2026-06-08");
    await h.d.accounts.withAccount("greenline", (s) => {
      reconcile(s, [file([...mike, ...linda("2026-08-11")])], "2026-08-14T14:00:00Z");
      const id = s.dataset.customers.find((c) => c.emails.includes("mike@gmail.com"))!.id;
      s.outreach = [{ customerId: id, firstTouchOn: "2026-08-14", lastTouchOn: "2026-08-14" }];
      s.replies = [{ id: "r1", customerId: id, channel: "email", receivedAt: "2026-08-14T15:00:00", from: "mike@gmail.com", text: "Yes, put me back on", intent: "wants_it", confidence: 0.9, extracted: {}, status: "done" }];
    });
    // August 26th: his new job's first visit went by on the 24th, not marked yet: it counts for now
    await h.d.accounts.withAccount("greenline", (s) => {
      reconcile(s, [file([...mike, ...rows(9001, "Mike Sanderson", weekly("2026-08-24", "2026-09-28"), ""), ...linda("2026-08-11")])], "2026-08-26T14:00:00Z");
      expect(s.recoveries.map((r) => r.value)).toEqual([45]);
    });
    // September 9th: the shop has marked through the 8th, and none of his were done
    await h.d.accounts.withAccount("greenline", (s) => {
      reconcile(s, [file([...mike, ...rows(9001, "Mike Sanderson", weekly("2026-08-24", "2026-09-28"), ""), ...linda("2026-09-08")])], "2026-09-09T14:00:00Z");
    });
    const [warm, cold] = await bothWays("greenline", (s) => s.recoveries.map((r) => [r.record.id, r.value]));
    expect(warm).toEqual([]);
    expect(cold).toEqual(warm);
    // and the next pass has nothing to take off again
    h.d.accounts.forget("greenline");
    const after = await h.d.accounts.withAccount("greenline", (s) => {
      reconcile(s, [], "2026-09-10T14:00:00Z");
      return [s.recoveries.length, s.events.filter((e) => e.title.startsWith("Taken off the ledger")).length];
    });
    expect(after).toEqual([0, 1]);
  });
});
