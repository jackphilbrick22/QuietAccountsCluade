import { afterEach, describe, expect, it } from "vitest";
import type { Customer } from "@qa/engine";
import { deliverOwnerMessages, handleInbound, sendDue } from "../src/core/ops.ts";
import { LogEmailProvider } from "../src/providers/email.ts";
import { LogNotifier } from "../src/providers/sms.ts";
import { harness, type Harness } from "./harness.ts";

/**
 * Jack's answer (Oct 1): no customer note goes out on a US holiday, in the client's own local day. Sent straight from
 * the server, a note planned for one before they were held waits for the next send day; the owner's texts still go.
 */

let open: Harness[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

const PAT: Customer = { id: "c-pat", sourceIds: ["c-pat"], name: "Pat Lee", firstName: "Pat", lastName: "Lee", emails: ["pat.lee@gmail.com"], phones: [], properties: [], tags: [] };

/** A tree client sending straight from the server, with note 1 to Pat approved for Thanksgiving morning (planned before holidays were held). */
async function client(): Promise<{ h: Harness; mail: LogEmailProvider; texts: LogNotifier }> {
  const mail = new LogEmailProvider({ quiet: true });
  const texts = new LogNotifier(true);
  const h = harness({ email: mail, notifier: texts });
  open.push(h);
  await h.business("ridge");
  await h.d.accounts.withAccount("ridge", (s) => {
    s.dataset.customers = [PAT];
    s.dataset.business.plan = { ...s.dataset.business.plan, stage: "paying", paidOn: "2026-10-01" };
    s.touches.push({ id: "t-pat-1", opportunityId: "o-pat", customerId: PAT.id, channel: "email", step: 1, angle: "check_in", dueAt: "2026-11-26T08:00", status: "approved", subject: "The maples", body: "Still want the maples done?", flags: [] });
  });
  return { h, mail, texts };
}

describe("a note planned for a holiday, sent straight from the server", () => {
  it("waits through Thanksgiving and the Friday after, and goes Monday morning", async () => {
    const { h, mail } = await client();
    for (const at of ["2026-11-26T14:00:00Z", "2026-11-27T14:00:00Z"]) {
      h.setNow(at);
      expect(await sendDue(h.d, "ridge"), at).toMatchObject({ sent: 0, held: 1 });
    }
    expect(h.d.accounts.peek("ridge")!.state.touches[0]).toMatchObject({ status: "approved" });
    // Monday, 9am in New Hampshire
    h.setNow("2026-11-30T14:00:00Z");
    expect(await sendDue(h.d, "ridge")).toMatchObject({ sent: 1 });
    expect(mail.sent.map((m) => m.to)).toEqual(["pat.lee@gmail.com"]);
  });

  it("goes by the client's own day: Wednesday evening in California is already Thanksgiving in New Hampshire", async () => {
    const { h, mail } = await client();
    expect((await h.api("PATCH", "/api/businesses/ridge", { timezone: "America/Los_Angeles", sendWindow: [7, 23] })).status).toBe(200);
    await h.d.accounts.withAccount("ridge", (s) => void (s.touches[0]!.dueAt = "2026-11-25T08:00"));
    // 9pm Wednesday there, midnight here: it goes
    h.setNow("2026-11-26T05:00:00Z");
    expect(await sendDue(h.d, "ridge")).toMatchObject({ sent: 1 });
    expect(mail.sent).toHaveLength(1);
  });

  it("the owner's texts aren't held: a homeowner who answers on Thanksgiving reaches him that day", async () => {
    const { h, texts } = await client();
    await h.d.accounts.withAccount("ridge", (s) => {
      Object.assign(s.touches[0]!, { dueAt: "2026-11-25T08:00", status: "sent", sentAt: "2026-11-25T08:00:00", providerId: "<t-pat-1@mail.test>" });
    });
    h.setNow("2026-11-26T15:00:00Z");
    await handleInbound(h.d, { type: "reply", businessId: "ridge", from: PAT.emails[0]!, text: "Yes please, come do the maples.", receivedAt: "2026-11-26T15:00:00.000Z", inReplyTo: "<t-pat-1@mail.test>" });
    await deliverOwnerMessages(h.d, "ridge");
    expect(texts.sent.map((t) => t.text)).toEqual([expect.stringContaining("Pat Lee")]);
  });
});

describe("the days the owner is told", () => {
  it("BUSY names the first send day three weeks before he has room: never Thanksgiving or the Friday after", async () => {
    const { h } = await client();
    h.setNow("2026-11-02T15:00:00Z");
    expect(await h.sms("BUSY until Dec 17")).toContain("We'll start writing to those folks around Nov 30 so replies land when you can take them.");
    expect(await h.sms("BUSY until Dec 15")).toContain("around Nov 24 so");
  });
});
