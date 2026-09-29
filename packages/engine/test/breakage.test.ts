import { beforeAll, describe, expect, it } from "vitest";
import { scan, type ScanResult } from "../src/breakage/detect.ts";
import { closeRate, silentAudit, summarize } from "../src/breakage/forecast.ts";
import { shopProfile } from "../src/breakage/profile.ts";
import { readiness } from "../src/breakage/readiness.ts";
import { ADJUST, BAND, TYPE_RANK } from "../src/breakage/assumptions.ts";
import { emptyDataset, ingestFile } from "../src/ingest/index.ts";
import { generateSample, type Sample } from "../src/sample/generate.ts";
import type { BreakageType, Customer, Dataset, Job } from "../src/model.ts";
import { addDays } from "../src/util.ts";
import { ASOF, ago, customer, dataset, invoice, job, oneOpp, oppsFor, quote, reachable, request } from "./fixtures.ts";

/* ------------------------------------------------------------------ */
/* Detectors: each fires on a minimal case, not on its near-miss        */
/* ------------------------------------------------------------------ */

describe("detectors", () => {
  describe("unanswered_quote", () => {
    it("fires on a sent quote nobody answered", () => {
      const r = scan(dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { sentOn: ago(60), total: 1500 })] }));
      const o = oneOpp(r, "c1", "unanswered_quote");
      expect(o.suppressed).toBeUndefined();
      expect(o.source).toEqual({ kind: "quote", id: "q1" });
      expect(o.value).toBe(1500);
      expect(o.ageDays).toBe(60);
      expect(o.anchorDate).toBe(ago(60));
      expect(o.jobPhrase).toBe("the maples");
      expect(o.channels).toContain("email");
      expect(o.expectedValue).toBeGreaterThan(0);
      expect(o.expectedValue).toBeLessThan(o.value);
    });
    it("does not fire on a converted quote", () => {
      const r = scan(dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "converted", approvedOn: ago(55), convertedOn: ago(55), jobIds: ["j1"] })] }));
      expect(oppsFor(r, "c1").filter((o) => ["unanswered_quote", "archived_quote"].includes(o.type))).toEqual([]);
    });
    it("does not fire while the quote is still inside its follow-up window", () => {
      const r = scan(dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { sentOn: ago(10) })] }));
      expect(oppsFor(r, "c1", "unanswered_quote")).toEqual([]);
    });
    it("does not fire when the customer later bought from the shop anyway", () => {
      const r = scan(dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { sentOn: ago(200) })], jobs: [job("j1", "c1", { title: "Crown thinning, 3 maples", completedOn: ago(100) })] }));
      expect(reachable(r, "c1", "unanswered_quote")).toEqual([]);
      expect(oneOpp(r, "c1", "unanswered_quote").suppressed).toBe("already_customer_again");
    });
  });

  describe("archived_quote", () => {
    it("fires on a quote filed away without a yes, anchored to the archive date", () => {
      const r = scan(dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "archived", sentOn: ago(200), archivedOn: ago(150) })] }));
      const o = oneOpp(r, "c1", "archived_quote");
      expect(o.suppressed).toBeUndefined();
      expect(o.anchorDate).toBe(ago(150));
      expect(o.ageDays).toBe(150);
    });
    it("also covers expired quotes", () => {
      const r = scan(dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "expired", sentOn: ago(90) })] }));
      expect(reachable(r, "c1", "archived_quote")).toHaveLength(1);
    });
    it("does not fire on a converted quote", () => {
      const r = scan(dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "converted", sentOn: ago(200), convertedOn: ago(190), jobIds: ["j1"] })] }));
      expect(oppsFor(r, "c1", "archived_quote")).toEqual([]);
    });
  });

  describe("changes_requested", () => {
    it("fires when a customer asked for changes and never got a revised quote", () => {
      const r = scan(dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "changes_requested", sentOn: ago(40), changesRequestedOn: ago(35) })] }));
      const o = oneOpp(r, "c1", "changes_requested");
      expect(o.suppressed).toBeUndefined();
      expect(o.anchorDate).toBe(ago(35));
    });
    it("does not fire once a newer quote went out after the change request", () => {
      const r = scan(
        dataset({
          customers: [customer("c1")],
          quotes: [
            quote("q1", "c1", { status: "changes_requested", sentOn: ago(40), changesRequestedOn: ago(35) }),
            quote("q2", "c1", { status: "archived", sentOn: ago(30), archivedOn: ago(25) }),
          ],
        }),
      );
      expect(oppsFor(r, "c1", "changes_requested")).toEqual([]);
    });
  });

  describe("approved_unscheduled", () => {
    it("fires on an approved quote with no job", () => {
      const r = scan(dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "approved", sentOn: ago(40), approvedOn: ago(30) })] }));
      const o = oneOpp(r, "c1", "approved_unscheduled");
      expect(o.source).toEqual({ kind: "quote", id: "q1" });
      expect(o.suppressed).toBeUndefined();
    });
    it("fires on a job that is still sitting unscheduled", () => {
      const r = scan(dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { status: "unscheduled", createdOn: ago(30), completedOn: undefined })] }));
      const o = oneOpp(r, "c1", "approved_unscheduled");
      expect(o.source).toEqual({ kind: "job", id: "j1" });
      // the unscheduled job itself is not "active work" that blocks its own opportunity
      expect(o.suppressed).toBeUndefined();
    });
    it("does not fire on an approved quote that already became a job", () => {
      const r = scan(
        dataset({
          customers: [customer("c1")],
          quotes: [quote("q1", "c1", { status: "approved", sentOn: ago(40), approvedOn: ago(30), jobIds: ["j1"] })],
          jobs: [job("j1", "c1", { quoteId: "q1", completedOn: ago(10) })],
        }),
      );
      expect(oppsFor(r, "c1", "approved_unscheduled")).toEqual([]);
    });
    it("does not fire on a yes that is only a few days old", () => {
      const r = scan(dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "approved", sentOn: ago(8), approvedOn: ago(5) })] }));
      expect(oppsFor(r, "c1", "approved_unscheduled")).toEqual([]);
    });
  });

  describe("unquoted_request", () => {
    it("fires on a request that never got a quote", () => {
      const r = scan(dataset({ customers: [customer("c1")], requests: [request("r1", "c1", { createdOn: ago(20) })] }));
      const o = oneOpp(r, "c1", "unquoted_request");
      expect(o.source).toEqual({ kind: "request", id: "r1" });
      expect(o.value).toBe(1000); // no price on a request: valued at the shop's typical job
      expect(o.evidence.join(" ")).toMatch(/typical job/);
      expect(o.suppressed).toBeUndefined();
    });
    it("does not fire on a request linked to a quote", () => {
      const r = scan(dataset({ customers: [customer("c1")], requests: [request("r1", "c1", { quoteId: "q1", status: "converted" })], quotes: [quote("q1", "c1", { status: "converted", sentOn: ago(18), convertedOn: ago(10), jobIds: [] })] }));
      expect(oppsFor(r, "c1", "unquoted_request")).toEqual([]);
    });
    it("does not fire when a quote went to the same person after the request", () => {
      const r = scan(dataset({ customers: [customer("c1")], requests: [request("r1", "c1", { createdOn: ago(60) })], quotes: [quote("q1", "c1", { sentOn: ago(55) })] }));
      expect(oppsFor(r, "c1", "unquoted_request")).toEqual([]);
    });
  });

  describe("declined_option", () => {
    const withOption = (selected: boolean, extraJobs: Job[] = []) =>
      dataset({
        customers: [customer("c1")],
        quotes: [
          quote("q1", "c1", {
            title: "Oak removal",
            status: "converted",
            sentOn: ago(70),
            approvedOn: ago(62),
            convertedOn: ago(60),
            total: 2000,
            jobIds: ["j1"],
            lineItems: [
              { name: "Oak removal", total: 2000 },
              { name: "Stump grinding", total: 400, optional: true, selected },
            ],
          }),
        ],
        jobs: [job("j1", "c1", { quoteId: "q1", title: "Oak removal", completedOn: ago(55), total: 2000 }), ...extraJobs],
      });
    it("fires on an optional line item the customer passed on", () => {
      const r = scan(withOption(false));
      const o = oneOpp(r, "c1", "declined_option");
      expect(o.value).toBe(400);
      expect(o.serviceId).toBe("tree.stump");
      expect(o.anchorDate).toBe(ago(60));
      expect(o.suppressed).toBeUndefined();
    });
    it("does not fire when the option was picked", () => {
      expect(oppsFor(scan(withOption(true)), "c1", "declined_option")).toEqual([]);
    });
    it("does not fire when the customer later bought that same service", () => {
      const r = scan(withOption(false, [job("j2", "c1", { title: "Stump grinding", completedOn: ago(20), total: 400 })]));
      expect(reachable(r, "c1", "declined_option")).toEqual([]);
      expect(oneOpp(r, "c1", "declined_option").suppressed).toBe("already_customer_again");
    });
  });

  describe("declined_quote", () => {
    it("fires on a no from a while ago", () => {
      const r = scan(dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "declined", sentOn: ago(200) })] }));
      expect(oneOpp(r, "c1", "declined_quote").suppressed).toBeUndefined();
    });
    it("does not fire on a fresh no", () => {
      const r = scan(dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "declined", sentOn: ago(60) })] }));
      expect(oppsFor(r, "c1", "declined_quote")).toEqual([]);
    });
  });

  describe("one_and_done", () => {
    it("fires on a single job long ago", () => {
      const r = scan(dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Stump grinding x3", completedOn: ago(400), total: 600 })] }));
      const o = oneOpp(r, "c1", "one_and_done");
      expect(o.source).toEqual({ kind: "job", id: "j1" });
      expect(o.suppressed).toBeUndefined();
    });
    it("does not fire on a recent single job", () => {
      const r = scan(dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Stump grinding x3", completedOn: ago(100) })] }));
      expect(oppsFor(r, "c1", "one_and_done")).toEqual([]);
    });
    it("does not fire on someone who hired the shop twice", () => {
      const r = scan(
        dataset({
          customers: [customer("c1")],
          jobs: [job("j1", "c1", { title: "Stump grinding x3", completedOn: ago(700) }), job("j2", "c1", { title: "Stump grinding", completedOn: ago(400) })],
        }),
      );
      expect(oppsFor(r, "c1", "one_and_done")).toEqual([]);
    });
  });

  describe("lapsed_regular", () => {
    const mowing = (lastDaysAgo: number): Dataset => {
      const jobs: Job[] = [];
      for (let i = 0; i < 8; i++) jobs.push(job(`j${i}`, "c1", { title: "Mowing visit", recurring: true, total: 55, completedOn: ago(lastDaysAgo + (7 - i) * 14) }));
      return dataset({ business: { trade: "lawn", avgJobValue: 55, minQuoteValue: 150 }, customers: [customer("c1")], jobs });
    };
    it("fires when a regular's rhythm stopped", () => {
      const o = oneOpp(scan(mowing(200)), "c1", "lapsed_regular");
      expect(o.suppressed).toBeUndefined();
      expect(o.source).toEqual({ kind: "job", id: "j7" });
      // a regular is valued at a year of visits, not one visit
      expect(o.value).toBeGreaterThan(55 * 10);
    });
    it("does not fire while the regular is still on rhythm", () => {
      expect(oppsFor(scan(mowing(10)), "c1", "lapsed_regular")).toEqual([]);
    });
  });

  describe("service_due", () => {
    const pumpOut = (monthsAgo: number) =>
      dataset({
        business: { trade: "septic", name: "Granite State Septic", avgJobValue: 475, minQuoteValue: 250 },
        customers: [customer("c1")],
        jobs: [job("j1", "c1", { title: "Routine pump-out 1000 gal", total: 450, completedOn: addDays(ASOF, -Math.round(monthsAgo * 30.44)) })],
      });
    it("fires when the trade's re-service clock has run out", () => {
      const o = oneOpp(scan(pumpOut(37)), "c1", "service_due");
      expect(o.serviceId).toBe("septic.pump");
      expect(o.suppressed).toBeUndefined();
      expect(o.reason).toMatch(/3 years/);
    });
    it("does not fire when the next pump-out is still far off", () => {
      expect(oppsFor(scan(pumpOut(12)), "c1", "service_due")).toEqual([]);
    });
  });

  describe("missed_upsell", () => {
    it("fires when the natural next job was never offered", () => {
      const r = scan(dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Oak removal", completedOn: ago(30), total: 1800 })] }));
      const stump = oppsFor(r, "c1", "missed_upsell").find((o) => o.serviceId === "tree.stump");
      expect(stump).toBeDefined();
      expect(stump!.source).toEqual({ kind: "job", id: "j1" });
      expect(stump!.suppressed).toBeUndefined();
    });
    it("does not fire when the original job already included it", () => {
      const r = scan(dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Oak removal + stump", completedOn: ago(30) })] }));
      expect(oppsFor(r, "c1", "missed_upsell").filter((o) => o.serviceId === "tree.stump")).toEqual([]);
    });
    it("does not fire when it was already quoted", () => {
      const r = scan(
        dataset({
          customers: [customer("c1")],
          jobs: [job("j1", "c1", { title: "Oak removal", completedOn: ago(30) })],
          quotes: [quote("q1", "c1", { title: "Stump grinding", total: 450, sentOn: ago(25) })],
        }),
      );
      expect(oppsFor(r, "c1", "missed_upsell").filter((o) => o.serviceId === "tree.stump")).toEqual([]);
    });
  });

  describe("unpaid_invoice", () => {
    it("fires on an invoice past due", () => {
      const r = scan(dataset({ customers: [customer("c1")], invoices: [invoice("i1", "c1", { balance: 850, dueOn: ago(30) })] }));
      const o = oneOpp(r, "c1", "unpaid_invoice");
      expect(o.value).toBe(850);
      expect(o.suppressed).toBeUndefined();
    });
    it("does not fire on a paid invoice, one only just due, or when collections are off", () => {
      const paid = scan(dataset({ customers: [customer("c1")], invoices: [invoice("i1", "c1", { status: "paid", balance: 0, paidOn: ago(20) })] }));
      expect(oppsFor(paid, "c1", "unpaid_invoice")).toEqual([]);
      const justDue = scan(dataset({ customers: [customer("c1")], invoices: [invoice("i1", "c1", { dueOn: ago(3) })] }));
      expect(oppsFor(justDue, "c1", "unpaid_invoice")).toEqual([]);
      const optedOut = scan(dataset({ customers: [customer("c1")], invoices: [invoice("i1", "c1")] }), { includeInvoices: false });
      expect(oppsFor(optedOut, "c1", "unpaid_invoice")).toEqual([]);
    });
    it("is never a customer's primary opportunity", () => {
      const r = scan(dataset({ customers: [customer("c1")], invoices: [invoice("i1", "c1")] }));
      expect(r.primary).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Suppression                                                         */
/* ------------------------------------------------------------------ */

describe("suppression", () => {
  /** One dead quote, 200 days old, for a customer shaped by `c`. */
  const deadQuote = (c: Partial<Customer> = {}, more: Partial<Dataset> & { business?: Partial<Dataset["business"]> } = {}) =>
    dataset({ ...more, customers: [customer("c1", c), ...(more.customers ?? [])], quotes: [quote("q1", "c1", { sentOn: ago(200) }), ...(more.quotes ?? [])] });
  const reason = (r: ScanResult) => oneOpp(r, "c1", "unanswered_quote").suppressed;

  it("baseline: the dead quote is reachable", () => {
    expect(reason(scan(deadQuote()))).toBeUndefined();
  });
  it("no_contact_info: no email, no mailing address, only a phone with no text consent", () => {
    const r = scan(deadQuote({ emails: [], phones: ["+16035550142"], address: undefined }));
    expect(reason(r)).toBe("no_contact_info");
    expect(oneOpp(r, "c1", "unanswered_quote").channels).toEqual(["call_task"]);
  });
  it("no_contact_info: the quote points at a customer we don't have", () => {
    const r = scan(dataset({ quotes: [quote("q1", "ghost", { sentOn: ago(200) })] }));
    expect(oneOpp(r, "ghost", "unanswered_quote").suppressed).toBe("no_contact_info");
  });
  it("do_not_contact: flagged in the shop's own system, or by the owner", () => {
    expect(reason(scan(deadQuote({ doNotContact: true })))).toBe("do_not_contact");
    expect(reason(scan(deadQuote(), { doNotContact: ["c1"] }))).toBe("do_not_contact");
  });
  it("unsubscribed / complained: the email is on our suppression list", () => {
    expect(reason(scan(deadQuote(), { suppressedEmails: { "c1@gmail.com": "unsubscribed" } }))).toBe("unsubscribed");
    expect(reason(scan(deadQuote(), { suppressedEmails: { "c1@gmail.com": "complained" } }))).toBe("complained");
  });
  it("do_not_contact outranks a complaint", () => {
    expect(reason(scan(deadQuote({ doNotContact: true }), { suppressedEmails: { "c1@gmail.com": "complained" } }))).toBe("do_not_contact");
  });
  it("bounced: the only email bounced and there's no other way to reach them", () => {
    expect(reason(scan(deadQuote({ address: undefined }), { suppressedEmails: { "c1@gmail.com": "bounced" } }))).toBe("bounced");
    // with a full mailing address a postcard can still go
    const r = scan(deadQuote(), { suppressedEmails: { "c1@gmail.com": "bounced" } });
    expect(reason(r)).toBeUndefined();
    expect(oneOpp(r, "c1", "unanswered_quote").channels).toEqual(["postcard"]);
  });
  it("already_customer_again: they came back on their own after the quote", () => {
    expect(reason(scan(deadQuote({}, { jobs: [job("j9", "c1", { title: "Hedge trimming", completedOn: ago(30) })] })))).toBe("already_customer_again");
  });
  it("active_work: an open job, or a fresh quote the salesperson is still working", () => {
    expect(reason(scan(deadQuote({}, { jobs: [job("j9", "c1", { status: "scheduled", scheduledOn: addDays(ASOF, 5), completedOn: undefined })] })))).toBe("active_work");
    expect(reason(scan(deadQuote({}, { quotes: [quote("q2", "c1", { title: "Hedge trimming", sentOn: ago(5) })] })))).toBe("active_work");
  });
  it("too_old: past the owner's max quote age", () => {
    const d = dataset({ business: { maxQuoteAgeMonths: 12 }, customers: [customer("c1")], quotes: [quote("q1", "c1", { sentOn: ago(500) })] });
    expect(reason(scan(d))).toBe("too_old");
    d.business.maxQuoteAgeMonths = 24;
    expect(reason(scan(d))).toBeUndefined();
  });
  it("below_minimum: worth less than the owner's floor", () => {
    const d = dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { sentOn: ago(200), total: 250 })] });
    expect(reason(scan(d))).toBe("below_minimum");
  });
  it("commercial: B2B accounts are handled separately unless included", () => {
    expect(reason(scan(deadQuote({ isCommercial: true })))).toBe("commercial");
    expect(reason(scan(deadQuote({ isCommercial: true }), { includeCommercial: true }))).toBeUndefined();
    // collections still apply to commercial accounts
    const inv = scan(dataset({ customers: [customer("c1", { isCommercial: true })], invoices: [invoice("i1", "c1")] }));
    expect(oneOpp(inv, "c1", "unpaid_invoice").suppressed).toBeUndefined();
  });
  it("recently_contacted: inside the cooldown after our last note", () => {
    expect(reason(scan(deadQuote(), { lastContacted: { c1: ago(30) } }))).toBe("recently_contacted");
    expect(reason(scan(deadQuote(), { lastContacted: { c1: ago(30) }, cooldownDays: 20 }))).toBeUndefined();
    expect(reason(scan(deadQuote(), { lastContacted: { c1: ago(200) } }))).toBeUndefined();
  });
  it("counts every suppression in the scan stats", () => {
    const r = scan(
      dataset({
        customers: [customer("a", { doNotContact: true }), customer("b", { isCommercial: true }), customer("c")],
        quotes: [quote("qa", "a", { sentOn: ago(200) }), quote("qb", "b", { sentOn: ago(200) }), quote("qc", "c", { sentOn: ago(200) })],
      }),
    );
    expect(r.stats.suppressedBy).toEqual({ do_not_contact: 1, commercial: 1 });
    expect(r.stats.quotes).toBe(3);
    expect(r.stats.customers).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/* Primary pick and scoring                                            */
/* ------------------------------------------------------------------ */

describe("primary pick", () => {
  it("picks the warmest type for a customer, not the highest score", () => {
    const r = scan(
      dataset({
        business: { trade: "septic", avgJobValue: 475, minQuoteValue: 250 },
        customers: [customer("c1")],
        jobs: [job("j1", "c1", { title: "Routine pump-out 1000 gal", total: 450, completedOn: addDays(ASOF, -1125) })],
        requests: [request("r1", "c1", { title: "Baffle repair", createdOn: ago(20) })],
      }),
    );
    const mine = oppsFor(r, "c1").filter((o) => !o.suppressed);
    expect(mine.map((o) => o.type).sort()).toEqual(["service_due", "unquoted_request"]);
    expect(r.primary).toHaveLength(1);
    expect(r.primary[0]!.type).toBe("unquoted_request");
  });

  describe("on a full sample", () => {
    let sample: Sample;
    let r: ScanResult;
    beforeAll(() => {
      sample = generateSample({ trade: "tree", asOf: ASOF });
      r = scan(sample.dataset);
    });
    it("gives exactly one primary per reachable customer", () => {
      const ids = r.primary.map((o) => o.customerId);
      expect(new Set(ids).size).toBe(ids.length);
      const workable = new Set(r.opportunities.filter((o) => !o.suppressed && o.type !== "unpaid_invoice").map((o) => o.customerId));
      expect(new Set(ids)).toEqual(workable);
    });
    it("never picks a suppressed opportunity or an invoice", () => {
      expect(r.primary.every((o) => !o.suppressed && o.type !== "unpaid_invoice")).toBe(true);
    });
    it("each primary is the customer's warmest reachable type", () => {
      const best = new Map<string, number>();
      for (const o of r.opportunities) if (!o.suppressed && o.type !== "unpaid_invoice") best.set(o.customerId, Math.min(best.get(o.customerId) ?? 99, TYPE_RANK[o.type]));
      for (const p of r.primary) expect(TYPE_RANK[p.type]).toBe(best.get(p.customerId));
    });
    it("is sorted by score, highest first", () => {
      for (let i = 1; i < r.primary.length; i++) expect(r.primary[i]!.score).toBeLessThanOrEqual(r.primary[i - 1]!.score);
    });
    it("keeps scores and probabilities in range", () => {
      for (const o of r.opportunities) {
        expect(o.score).toBeGreaterThanOrEqual(0);
        expect(o.score).toBeLessThanOrEqual(100);
        expect(o.recoverProbability).toBeGreaterThan(0);
        expect(o.recoverProbability).toBeLessThanOrEqual(0.65);
        expect(o.expectedValue).toBeCloseTo(o.value * o.recoverProbability, -1);
      }
    });
  });
});

describe("scoring", () => {
  /** Two quotes, identical except for what the test varies, for two identical customers. */
  const pair = (a: Partial<Parameters<typeof quote>[2]>, b: Partial<Parameters<typeof quote>[2]>, asOf = ASOF, avgJobValue = 1000) => {
    const r = scan(
      dataset({
        asOf,
        business: { avgJobValue },
        customers: [customer("a"), customer("b")],
        quotes: [quote("qa", "a", { sentOn: addDays(asOf, -60), ...a }), quote("qb", "b", { sentOn: addDays(asOf, -60), ...b })],
      }),
    );
    return [oneOpp(r, "a", "unanswered_quote"), oneOpp(r, "b", "unanswered_quote")] as const;
  };

  it("hazard work scores above maintenance work", () => {
    // November: both removals and pruning are in season, so only the kind of work differs
    const [hazard, maint] = pair({ title: "Hazard dead oak removal" }, { title: "Crown thinning, 3 maples" }, "2026-11-10");
    expect(hazard.serviceId).toBe("tree.removal");
    expect(maint.serviceId).toBe("tree.prune");
    expect(hazard.seasonFit).toBe(maint.seasonFit);
    expect(hazard.recoverProbability).toBeGreaterThan(maint.recoverProbability);
    expect(hazard.recoverProbability / maint.recoverProbability).toBeCloseTo(ADJUST.hazard, 1);
    expect(hazard.score).toBeGreaterThan(maint.score);
  });
  it("a quote they opened online scores above one they never opened", () => {
    const [viewed, unviewed] = pair({ viewedOn: ago(58) }, {});
    expect(viewed.recoverProbability).toBeGreaterThan(unviewed.recoverProbability);
    expect(viewed.recoverProbability / unviewed.recoverProbability).toBeCloseTo(ADJUST.viewed, 1);
  });
  it("a quote 4x+ the shop's typical job gets the big-ticket down-weight", () => {
    const [big, normal] = pair({ total: 4500 }, { total: 3500 });
    expect(big.recoverProbability / normal.recoverProbability).toBeCloseTo(ADJUST.bigTicket, 2);
    // "big" is relative to this shop: at a $5,000 typical job, $4,500 is ordinary
    const [same, other] = pair({ total: 4500 }, { total: 3500 }, ASOF, 5000);
    expect(same.recoverProbability).toBeCloseTo(other.recoverProbability, 3);
  });
  it("fresher quotes are more likely to come back", () => {
    const [fresh, stale] = pair({ sentOn: ago(60) }, { sentOn: ago(800) });
    expect(fresh.recoverProbability).toBeGreaterThan(stale.recoverProbability);
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  describe("lead source", () => {
    /** The same quote for a customer from `source` and one with no source on file. */
    const bySource = (source: string) => {
      const r = scan(dataset({ customers: [customer("a", { leadSource: source }), customer("b")], quotes: [quote("qa", "a"), quote("qb", "b")] }));
      return oneOpp(r, "a", "unanswered_quote").recoverProbability / oneOpp(r, "b", "unanswered_quote").recoverProbability;
    };
    it("referrals and repeat clients are more likely to come back", () => {
      expect(bySource("Referral")).toBeCloseTo(ADJUST.referral, 1);
      expect(bySource("Repeat")).toBeCloseTo(ADJUST.referral, 1);
      expect(bySource("Word of mouth")).toBeCloseTo(ADJUST.referral, 1);
    });
    it("shared-marketplace leads are less likely", () => {
      expect(bySource("HomeAdvisor")).toBeCloseTo(ADJUST.marketplace, 1);
      expect(bySource("Angi")).toBeCloseTo(ADJUST.marketplace, 1);
      expect(bySource("Thumbtack")).toBeCloseTo(ADJUST.marketplace, 1);
    });
    it("other sources don't move it", () => {
      expect(bySource("Google")).toBeCloseTo(1, 2);
      expect(bySource("Yard sign")).toBeCloseTo(1, 2);
    });
  });
});

describe("caution holds", () => {
  /** Twelve ordinary crown-thinning quotes around $1,000, plus whatever the test adds. */
  const shop = (extra: Parameters<typeof quote>[2] & { customer?: Partial<Customer> } = {}, ordinary = 12) => {
    const { customer: who, ...q } = extra;
    const customers = [customer("odd", who), ...Array.from({ length: ordinary }, (_, i) => customer(`c${i}`))];
    const quotes = [quote("q-odd", "odd", q), ...Array.from({ length: ordinary }, (_, i) => quote(`q${i}`, `c${i}`, { total: 800 + i * 40 }))];
    return dataset({ customers, quotes });
  };
  const odd = (r: ScanResult) => oneOpp(r, "odd", "unanswered_quote");

  it("an ordinary quote goes ahead", () => {
    expect(odd(scan(shop({ total: 1100 }))).caution).toBeUndefined();
  });
  it("a quote priced far outside what this shop charges for that work is held for a look", () => {
    const o = odd(scan(shop({ total: 9000 })));
    expect(o.caution).toHaveLength(1);
    expect(o.caution![0]).toMatch(/^Priced \d+x your usual for this work/);
    expect(o.suppressed).toBeUndefined(); // held, not thrown away
  });
  it("needs enough of the shop's own quotes for that work to judge the price", () => {
    expect(odd(scan(shop({ total: 9000 }, 8))).caution).toBeUndefined();
  });
  it("holds quotes that were never a real bid: realtors, HOAs, insurance, ballparks", () => {
    expect(odd(scan(shop({ title: "Crown thinning, 3 maples - estimate for realtor" }))).caution![0]).toMatch(/^Mentions "realtor"/);
    expect(odd(scan(shop({ title: "Ballpark: crown thinning" }))).caution![0]).toMatch(/Mentions "Ballpark"/);
    expect(odd(scan(shop({ customer: { companyName: "Maple Village HOA" } }))).caution![0]).toMatch(/Mentions "HOA"/);
    expect(odd(scan(shop({ customer: { tags: ["insurance claim"] } }))).caution![0]).toMatch(/Mentions "insurance claim"/);
  });
  it("an operator can clear the hold", () => {
    const d = shop({ total: 9000 });
    const held = odd(scan(d));
    expect(odd(scan(d, { cleared: [held.id] })).caution).toBeUndefined();
  });
  it("only dead quotes are judged on price", () => {
    const d = shop();
    d.quotes[0] = quote("q-odd", "odd", { status: "approved", approvedOn: ago(30), total: 9000 });
    expect(oneOpp(scan(d), "odd", "approved_unscheduled").caution).toBeUndefined();
  });
  it("suppressed people aren't flagged too", () => {
    expect(odd(scan(shop({ total: 9000, customer: { doNotContact: true } }))).caution).toBeUndefined();
  });
  it("people tagged as bad customers are never contacted", () => {
    for (const tag of ["Do not service", "Blacklisted", "bad payer", "sent to collections"]) {
      const r = scan(dataset({ customers: [customer("c1", { tags: [tag] })], quotes: [quote("q1", "c1", { sentOn: ago(200) })] }));
      expect(oneOpp(r, "c1", "unanswered_quote").suppressed, tag).toBe("do_not_contact");
    }
    const ok = scan(dataset({ customers: [customer("c1", { tags: ["VIP", "Referral"] })], quotes: [quote("q1", "c1", { sentOn: ago(200) })] }));
    expect(oneOpp(ok, "c1", "unanswered_quote").suppressed).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* summarize / fitCheck / closeRate / profile / readiness               */
/* ------------------------------------------------------------------ */

describe("summarize and fitCheck", () => {
  let sample: Sample;
  beforeAll(() => {
    sample = generateSample({ trade: "tree", asOf: ASOF });
  });

  it("a full sample is a strong fit and qualifies for the guarantee", () => {
    const s = summarize(sample.dataset, scan(sample.dataset));
    expect(s.fit.verdict).toBe("strong");
    expect(s.fit.guaranteeEligible).toBe(true);
    expect(s.fit.score).toBeGreaterThanOrEqual(85);
    for (const id of ["volume", "email", "ticket", "history", "payback"]) expect(s.fit.checks.find((c) => c.id === id)?.ok).toBe(true);
  });

  it("adds up what it found", () => {
    const r = scan(sample.dataset);
    const s = summarize(sample.dataset, r);
    const total = r.opportunities.reduce((a, o) => a + o.value, 0);
    const reach = r.opportunities.filter((o) => !o.suppressed).reduce((a, o) => a + o.value, 0);
    expect(s.totalValue).toBeCloseTo(total, 0);
    expect(s.reachableValue).toBeCloseTo(reach, 0);
    expect(s.opportunities).toBe(r.opportunities.length);
    expect(s.reachableValue).toBeLessThan(s.totalValue);
    expect(s.expected.conservative).toBeCloseTo(s.expected.likely * BAND.conservative, 0);
    expect(s.expected.strong).toBeCloseTo(s.expected.likely * BAND.strong, 0);
    for (let i = 1; i < s.byType.length; i++) expect(s.byType[i]!.reachableValue).toBeLessThanOrEqual(s.byType[i - 1]!.reachableValue);
    expect(s.revenueSource).toBe("invoices");
    expect(s.annualRevenue).toBeGreaterThan(0);
  });

  it("keeps unpaid invoices out of the lift and reports them as cash to collect", () => {
    const r = scan(sample.dataset);
    const withInv = summarize(sample.dataset, r);
    const inv = withInv.byType.find((t) => t.type === "unpaid_invoice")!;
    expect(inv.reachable).toBeGreaterThan(0);
    expect(withInv.cashToCollect.value).toBeCloseTo(inv.reachableValue, 0);
    expect(withInv.cashToCollect.expected).toBeCloseTo(inv.expected, 0);
    // the same data with collections off gives the same year-one new-work number
    const without = summarize(sample.dataset, scan(sample.dataset, { includeInvoices: false }));
    expect(without.cashToCollect).toEqual({ value: 0, expected: 0 });
    expect(withInv.yearOne.likely).toBeCloseTo(without.yearOne.likely, 0);
    expect(withInv.liftPct!.likely).toBeCloseTo(without.liftPct!.likely, 1);
  });

  it("a dataset whose only breakage is an unpaid invoice has no lift and no NaNs", () => {
    const ds = dataset({ customers: [customer("c1")], invoices: [invoice("i1", "c1")] });
    const s = summarize(ds, scan(ds));
    expect(s.cashToCollect.value).toBe(850);
    expect(s.yearOne).toEqual({ conservative: 0, likely: 0, strong: 0 });
    // (JSON turns NaN into null, so check the raw numbers)
    expect(s.pastCustomerShare).toBeUndefined();
    expect(Number.isFinite(s.paybackMultiple)).toBe(true);
  });

  it("a tiny dataset is not a fit yet, and says so", () => {
    const ds = dataset({
      customers: [customer("a"), customer("b"), customer("c")],
      quotes: [quote("qa", "a", { sentOn: ago(60) }), quote("qb", "b", { sentOn: ago(90), status: "archived" }), quote("qc", "c", { sentOn: ago(120) })],
    });
    const s = summarize(ds, scan(ds));
    expect(s.reachablePeople).toBe(3);
    expect(s.fit.guaranteeEligible).toBe(false);
    expect(s.fit.verdict).toBe("not_yet");
    expect(s.fit.checks.find((c) => c.id === "volume")?.ok).toBe(false);
    expect(s.fit.checks.find((c) => c.id === "payback")?.ok).toBe(false);
    expect(s.closeRate).toBeUndefined(); // too few quotes to say
    expect(s.fit.headline).toMatch(/Not enough/);
  });
});

describe("silentAudit", () => {
  const shop = () =>
    dataset({
      quotes: [
        quote("w1", "a", { status: "converted", total: 2000, sentOn: ago(100) }),
        quote("w2", "a", { status: "approved", total: 1000, sentOn: ago(50) }),
        quote("d1", "b", { status: "declined", total: 700, sentOn: ago(200) }),
        quote("c1", "c", { status: "changes_requested", total: 900, sentOn: ago(40) }),
        quote("s1", "d", { status: "awaiting_response", total: 500, sentOn: ago(30) }),
        quote("s2", "e", { status: "archived", total: 1500, sentOn: ago(150) }),
        quote("s3", "f", { status: "expired", total: 1200, sentOn: ago(400) }),
        quote("s4", "g", { status: "awaiting_response", total: 800, sentOn: ago(900) }),
        // not counted: too new to call, and never sent
        quote("new", "h", { total: 5000, sentOn: ago(5) }),
        quote("draft", "i", { status: "draft", total: 5000, sentOn: ago(60) }),
      ],
    });
  it("splits the shop's own quotes into won, said no, changes ignored and never answered", () => {
    const a = silentAudit(shop());
    expect(a.sent).toEqual({ count: 8, value: 8600 });
    expect(a.won).toEqual({ count: 2, value: 3000 });
    expect(a.declined).toEqual({ count: 1, value: 700 });
    expect(a.changesIgnored).toEqual({ count: 1, value: 900 });
    expect(a.silent).toEqual({ count: 4, value: 4000 });
    // of the 6 that didn't become work, 4 never got an answer
    expect(a.silentShareOfLost).toBe(0.67);
    expect(a.headline).toBe("Of 6 quotes that didn't turn into work, 4 (67%) never got a yes or a no — $4,000 that wasn't lost on price. Nobody answered.");
  });
  it("buckets the silent ones by age, newest first", () => {
    expect(silentAudit(shop()).byAge).toEqual([
      { label: "Last 3 months", count: 1, value: 500 },
      { label: "3–6 months", count: 1, value: 1500 },
      { label: "6–12 months", count: 0, value: 0 },
      { label: "1–2 years", count: 1, value: 1200 },
      { label: "Over 2 years", count: 1, value: 800 },
    ]);
  });
  it("says so when every quote got an answer", () => {
    const a = silentAudit(dataset({ quotes: [quote("w", "a", { status: "converted" }), quote("d", "b", { status: "declined" })] }));
    expect(a.silent.count).toBe(0);
    expect(a.headline).toBe("Every quote got an answer. That's rare.");
  });
  it("is part of the summary", () => {
    const ds = shop();
    expect(summarize(ds, scan(ds)).audit).toEqual(silentAudit(ds));
  });
});

describe("closeRate", () => {
  /** 25 quotes 40–700 days old: `won` of them converted. */
  const book = (won: number) => {
    const quotes = Array.from({ length: 25 }, (_, i) =>
      quote(`q${i}`, `c${i}`, {
        sentOn: ago(40 + i * 25),
        total: i < won ? 2000 : 1000,
        status: i < won ? "converted" : i % 2 ? "archived" : "awaiting_response",
      }),
    );
    return dataset({ customers: quotes.map((q) => customer(q.customerId)), quotes });
  };
  it("is computed from the shop's own quotes, by count and by dollars", () => {
    const cr = closeRate(book(10))!;
    expect(cr.quotes).toBe(25);
    expect(cr.byCount).toBe(0.4);
    expect(cr.byValue).toBeCloseTo((10 * 2000) / (10 * 2000 + 15 * 1000), 2);
  });
  it("ignores drafts, zero-dollar quotes and quotes younger than 30 days", () => {
    const ds = book(10);
    ds.quotes.push(quote("draft", "c0", { status: "draft", sentOn: ago(100) }), quote("zero", "c0", { total: 0, sentOn: ago(100) }), quote("young", "c0", { sentOn: ago(10) }));
    expect(closeRate(ds)!.quotes).toBe(25);
  });
  it("says nothing with fewer than 20 quotes", () => {
    const ds = book(10);
    ds.quotes = ds.quotes.slice(0, 19);
    expect(closeRate(ds)).toBeUndefined();
  });
  it("shows up on the summary", () => {
    const ds = book(10);
    expect(summarize(ds, scan(ds)).closeRate).toEqual(closeRate(ds));
  });
});

describe("shopProfile", () => {
  it("small tickets at high volume: work repeat business, most likely replies first", () => {
    // 800 one-off $55 visits in the last year: volume alone makes it a route business
    const jobs = Array.from({ length: 800 }, (_, i) => job(`j${i}`, `c${i}`, { title: "Mowing visit", total: 55, completedOn: ago(5 + (i % 350)) }));
    const p = shopProfile(dataset({ business: { trade: "lawn", avgJobValue: undefined }, jobs }), 55, 400);
    expect(p.ticketBand).toBe("small");
    expect(p.volumeBand).toBe("high");
    expect(p.repeatShare).toBe(0);
    expect(p.strategy.focus).toBe("repeat_work");
    expect(p.strategy.rank).toBe("reply");
  });
  it("small tickets with lots of regulars count as repeat work even at low volume", () => {
    const jobs: Job[] = [];
    for (let c = 0; c < 5; c++) for (let v = 0; v < 4; v++) jobs.push(job(`j${c}-${v}`, `c${c}`, { title: "House wash", total: 425, completedOn: ago(20 + v * 80) }));
    const p = shopProfile(dataset({ business: { trade: "pressure_washing", avgJobValue: undefined }, jobs }), 425, 50);
    expect(p.volumeBand).toBe("low");
    expect(p.repeatShare).toBe(1);
    expect(p.strategy.focus).toBe("repeat_work");
  });
  it("mid-size tickets are balanced and go dollars-first", () => {
    const jobs = Array.from({ length: 30 }, (_, i) => job(`j${i}`, `c${i}`, { total: 1200, completedOn: ago(10 + i * 10) }));
    const p = shopProfile(dataset({ jobs }), 1200, 300);
    expect(p.ticketBand).toBe("mid");
    expect(p.strategy.focus).toBe("balanced");
    expect(p.strategy.rank).toBe("dollars");
  });
  it("large one-off tickets: work the big quotes, most expected dollars first", () => {
    const jobs = Array.from({ length: 30 }, (_, i) => job(`j${i}`, `c${i}`, { title: "Cedar privacy fence", total: 6500, completedOn: ago(10 + i * 10) }));
    const ds = dataset({ business: { trade: "fence", avgJobValue: undefined }, jobs });
    const p = shopProfile(ds, 6500, 300);
    expect(p.ticketBand).toBe("large");
    expect(p.repeatShare).toBe(0);
    expect(p.strategy.focus).toBe("big_quotes");
    expect(p.strategy.rank).toBe("dollars");
    expect(p.strategy.personalizeAbove).toBe(0);
  });
  it("keeps the suggested weekly pace between 40 and 150", () => {
    const ds = dataset();
    expect(shopProfile(ds, 1000, 10).strategy.weeklyNewContacts).toBe(40);
    expect(shopProfile(ds, 1000, 100_000).strategy.weeklyNewContacts).toBe(150);
  });
  it("comes out of summarize, sized by the shop's own median job", () => {
    const fence = generateSample({ trade: "fence", asOf: ASOF });
    const s = summarize(fence.dataset, scan(fence.dataset));
    expect(s.profile.ticketBand).toBe("large");
    expect(s.profile.strategy.rank).toBe("dollars");
  });
});

describe("readiness", () => {
  it("a full export set is ready with nothing missing", () => {
    const s = generateSample({ trade: "septic", asOf: ASOF });
    const r = readiness(s.dataset);
    expect(r.ready).toBe(true);
    expect(r.gaps).toEqual([]);
    expect(r.monthsOfHistory).toBeGreaterThanOrEqual(36);
    expect(r.headline).toBe("Ready to start. We have everything we need.");
  });
  it("a quotes-only Jobber import is ready, and asks for the other files by Jobber menu path", () => {
    const s = generateSample({ trade: "tree", asOf: ASOF });
    const quotesFile = s.files.find((f) => f.kind === "quote")!;
    const ds = ingestFile(emptyDataset(s.business, ASOF), quotesFile.text, quotesFile.name, `${ASOF}T12:00:00Z`).dataset;
    const r = readiness(ds);
    expect(r.ready).toBe(true);
    const byId = Object.fromEntries(r.gaps.map((g) => [g.id, g]));
    expect(Object.keys(byId).sort()).toEqual(["no_clients", "no_invoices", "no_jobs", "no_requests"]);
    for (const g of r.gaps) expect(g.where).toMatch(/^Jobber: /);
    expect(byId.no_jobs!.where).toMatch(/One-off jobs and Recurring jobs/);
    expect(byId.no_invoices!.level).toBe("sharpen");
    expect(r.headline).toMatch(/^Ready to start\. 3 more files/);
  });
  it("no records at all is a blocker", () => {
    const r = readiness(dataset());
    expect(r.ready).toBe(false);
    expect(r.gaps.find((g) => g.level === "blocker")?.id).toBe("no_work_records");
    expect(r.headline).toMatch(/^Can't start yet/);
  });
  it("quotes with no emails anywhere is a blocker until a client list arrives", () => {
    const ds = dataset({ customers: [customer("a", { emails: [] }), customer("b", { emails: [] })], quotes: [quote("qa", "a"), quote("qb", "b")] });
    const r = readiness(ds);
    expect(r.ready).toBe(false);
    expect(r.gaps.find((g) => g.id === "no_emails")?.level).toBe("blocker");
    // once they've sent a client file, missing emails is an ask, not a blocker
    ds.imports.push({ id: "imp1", fileName: "clients.csv", importedAt: `${ASOF}T12:00:00Z`, source: "jobber", kind: "client", rows: 2, accepted: 2, rejected: 0, mapping: {}, warnings: [] });
    const after = readiness(ds);
    expect(after.gaps.find((g) => g.id === "no_emails")?.level).toBe("unlocks");
    expect(after.ready).toBe(true);
  });
});

/** Every BreakageType is exercised above; keep this list in sync with the model. */
const COVERED: BreakageType[] = [
  "unanswered_quote", "archived_quote", "changes_requested", "approved_unscheduled", "unquoted_request", "declined_option",
  "declined_quote", "one_and_done", "lapsed_regular", "service_due", "missed_upsell", "unpaid_invoice",
];
it("covers all twelve breakage types", () => {
  expect(new Set(COVERED).size).toBe(Object.keys(TYPE_RANK).length);
});

describe("what we may say about lift", () => {
  it("says 15–20% only when the shop's careful forecast reaches 15%, otherwise its own number", async () => {
    const { generateSample } = await import("../src/sample/generate.ts");
    const { scan } = await import("../src/breakage/detect.ts");
    const { summarize } = await import("../src/breakage/forecast.ts");
    for (const trade of ["tree", "septic", "fence"] as const) {
      const s = generateSample({ trade, asOf: "2026-09-29" });
      const sum = summarize(s.dataset, scan(s.dataset));
      const careful = sum.liftPct!.conservative;
      expect(sum.fit.canSay15).toBe(careful >= 15 && sum.fit.guaranteeEligible);
      if (sum.fit.canSay15) expect(sum.fit.liftLine).toContain("15–20%");
      else expect(sum.fit.liftLine).not.toContain("15–20%");
      expect(sum.fit.liftLine).toContain(`${Math.round(careful)}%`);
    }
  });
});

describe("marketing copy checker", () => {
  it("blocks the lines that get lead-gen companies in trouble", async () => {
    const { lintMarketing } = await import("../src/claims.ts");
    expect(lintMarketing("Guaranteed 20% more revenue!")).not.toEqual([]);
    expect(lintMarketing("Totally risk-free.")).not.toEqual([]);
    expect(lintMarketing("Money-back guarantee")).not.toEqual([]);
    expect(lintMarketing("Up to 40% more jobs")).not.toEqual([]);
    expect(lintMarketing("80% of sales need 5 follow-ups")).not.toEqual([]);
    expect(lintMarketing("Only 3 spots left")).not.toEqual([]);
    expect(lintMarketing("If nobody asks for a price or a date this month, you don't pay for it.")).toEqual([]);
  });
});
