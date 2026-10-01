import { describe, expect, it } from "vitest";
import { emptyState, generateSample, weeklyReport, type Reply, type Touch } from "@qa/engine";
import { fridayExample } from "../../site/src/friday.ts";

/** A line with its numbers taken out: "Notes out: 61 (to 38 people)" and "Notes out: 6 (to 6 people)" are the same line. */
const shape = (line: string) => line.replace(/\$[\d,]+(?:\.\d+)?/g, "$#").replace(/\d+/g, "#");

/**
 * The old site's example Friday text (src/friday.ts) keeps to the real one until it goes: every line in it has to be
 * one the real Friday text writes (weeklyReport). What the pages say about Friday is checked on the built pages, with
 * the site's other word rules (apps/site/test/pages.test.ts).
 */
describe("the old site's Friday example", () => {
  it("uses only lines the real Friday text writes, in the same order", () => {
    const sample = generateSample({ trade: "tree", asOf: "2026-10-02" });
    const ds = { ...sample.dataset, business: { ...sample.dataset.business, ownerFirstName: "Dave" } };
    const st = emptyState(ds, "2026-10-02T09:00:00");
    const people = ds.customers.slice(0, 6);
    const touch = (i: number, over: Partial<Touch>): Touch => ({ id: `t${i}`, opportunityId: `o${i}`, customerId: people[i]!.id, channel: "email", step: 1, angle: "check_in", dueAt: "2026-09-29T08:00", sentAt: "2026-09-29T08:00:00", status: "sent", body: "", flags: [], ...over });
    // two new requests answered (the next morning, so not "within minutes") and two new quotes followed up
    st.touches.push(
      touch(0, { track: "new_request", askedAt: "2026-09-28T21:30" }),
      touch(1, { track: "new_request", askedAt: "2026-09-28T22:10" }),
      touch(2, { track: "fresh_quote" }),
      touch(3, { track: "fresh_quote" }),
      touch(4, {}),
      touch(5, {}),
    );
    const reply = (i: number): Reply => ({ id: `r${i}`, customerId: people[i]!.id, channel: "email", receivedAt: "2026-09-29T10:00:00", from: people[i]!.emails[0] ?? "x@example.org", text: "Yes, what would it cost now?", intent: "wants_price", confidence: 1, extracted: {}, status: "done", ownerContactedAt: "2026-09-29T13:00:00" });
    st.replies.push(reply(2), reply(3));
    for (const i of [2, 3]) st.recoveries.push({ id: `rec${i}`, customerId: people[i]!.id, record: { kind: "quote", id: `q${i}` }, value: 2400, cameBackOn: "2026-09-30", match: "same_record", confidence: 1, tier: "traced" });

    const real = weeklyReport(st, "2026-09-28").split("\n").map(shape);
    const example = fridayExample("Dave", "$4,250").filter(Boolean);
    let at = -1;
    for (const line of example) {
      const i = real.indexOf(shape(line), at + 1);
      expect(i, `the real Friday text never writes "${line}" here`).toBeGreaterThan(at);
      at = i;
    }
  });
});
