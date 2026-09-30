import { afterEach, describe, expect, it } from "vitest";
import { deliverOwnerMessages } from "../src/core/ops.ts";
import type { OwnerNotifier } from "../src/contracts.ts";
import { ownerSendToast } from "../../web/src/live/ownerSend.ts";
import { harness, type Harness } from "./harness.ts";

let open: Harness[] = [];
const make = (...a: Parameters<typeof harness>) => {
  const h = harness(...a);
  open.push(h);
  return h;
};
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

/** A billing text waiting for the operator's OK, as the close and the pre-charge text do. */
async function waiting(h: Harness, bid: string, id: string): Promise<void> {
  await h.d.accounts.withAccount(bid, (s) => {
    s.ownerMessages.push({ id, at: "2026-09-29T09:00:00", kind: "precharge", text: "Dave, your card is charged on the 1st." });
  });
  await deliverOwnerMessages(h.d, bid);
}

/** "Approve and send" in the console: the route's answer, and what the operator is told. */
async function approve(h: Harness, bid: string, id: string) {
  const r = await h.api("POST", `/api/businesses/${bid}/owner-messages/${id}/send`);
  return { status: r.status, json: r.json as { ok: boolean; delivery?: string; error?: string }, toast: r.status === 200 ? ownerSendToast(r.json) : undefined };
}

describe("approving a text to the owner says what really happened", () => {
  it("sent: says so", async () => {
    const h = make();
    await h.business("ridge");
    await waiting(h, "ridge", "om-1");
    const r = await approve(h, "ridge", "om-1");
    expect(r).toMatchObject({ status: 200, json: { ok: true, delivery: "sent" }, toast: "Approved and sent to the owner" });
    // approving it again: nothing is waiting, and the console shows the route's error instead of a success
    expect((await approve(h, "ridge", "om-1")).status).toBe(409);
  });

  it("no cell and no email on file: not sent, and why", async () => {
    const h = make();
    await h.business("ridge", { ownerPhone: undefined, ownerEmail: undefined });
    await waiting(h, "ridge", "om-1");
    const r = await approve(h, "ridge", "om-1");
    expect(r.json).toMatchObject({ ok: false, delivery: "failed", error: "No cell on file and no email on file. Pass it on yourself." });
    expect(r.toast).toBe("Not sent: it failed. No cell on file and no email on file. Pass it on yourself.");
    expect(r.toast).not.toMatch(/sent to the owner/);
  });

  it("the text provider errors: not sent", async () => {
    const broken: OwnerNotifier = { name: "broken", notify: async () => { throw new Error("Twilio is down"); } };
    const h = make({ notifier: broken });
    await h.business("ridge", { ownerEmail: undefined });
    await waiting(h, "ridge", "om-1");
    const r = await approve(h, "ridge", "om-1");
    expect(r.json).toMatchObject({ ok: false, delivery: "failed", error: "Twilio is down" });
    expect(r.toast).toBe("Not sent: it failed. Twilio is down");
  });

  it("a cancelled client: skipped, not sent", async () => {
    const h = make();
    await h.business("ridge");
    await waiting(h, "ridge", "om-1");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.dataset.business.plan.stage = "cancelled";
    });
    const r = await approve(h, "ridge", "om-1");
    expect(r.json).toMatchObject({ ok: false, delivery: "skipped" });
    expect(r.toast).toMatch(/^Not sent: skipped\./);
  });
});
