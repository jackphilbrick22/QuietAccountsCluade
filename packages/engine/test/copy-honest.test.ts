import { describe, expect, it } from "vitest";
import { scan } from "../src/breakage/detect.ts";
import { renderNote, type RenderedNote } from "../src/copy/render.ts";
import { lint } from "../src/copy/lint.ts";
import { SEQUENCES } from "../src/copy/templates.ts";
import { planOutreach } from "../src/cadence/plan.ts";
import { generateSample } from "../src/sample/generate.ts";
import type { BreakageType, Customer, Dataset, Opportunity, TradeId } from "../src/model.ts";
import { ASOF, ago, customer, dataset, job, oneOpp, quote, request } from "./fixtures.ts";

/** Every planned step of one opportunity's sequence, rendered for `sendOn` (steps a sequence lacks are skipped). */
function notes(ds: Dataset, o: Opportunity, c: Customer, sendOn: string): RenderedNote[] {
  return SEQUENCES[o.type].steps.map((s) => renderNote(o, c, { ds, sendOn }, s.step)).filter((n): n is RenderedNote => !!n);
}

/** Everything above the footer. */
const main = (n: RenderedNote) => n.body.split(/\n\n[^\n]*·[^\n]*\n/)[0]!;

/** Any ask for a near-term slot: a day, a week, "openings coming up", "fit it in", "while we're over your way". */
const NEAR_TERM = /reply with a (couple of )?(day|days|week)|lock one in|openings coming up|set a date|fit it in|while we're over your way|get you on the schedule/i;

/* ------------------------------------------------------------------ */
/* Strict-season work: never a near-term slot out of season             */
/* ------------------------------------------------------------------ */

describe("oak pruning out of season", () => {
  const OAK = "Prune 2 oaks off power line";
  const oakDs = (asOf: string) => {
    const c = customer("c1", { firstName: "Holly" });
    return dataset({
      asOf,
      customers: [c, customer("c2", { firstName: "Tom" }), customer("c3", { firstName: "Ann" }), customer("c4", { firstName: "Raj" }), customer("c5", { firstName: "Jo" })],
      quotes: [
        quote("q1", "c1", { title: OAK, status: "approved", approvedOn: ago(60, asOf), sentOn: ago(70, asOf) }),
        quote("q2", "c2", { title: OAK, sentOn: ago(90, asOf) }),
        quote("q3", "c3", { title: OAK, status: "archived", sentOn: ago(120, asOf), archivedOn: ago(100, asOf) }),
      ],
      jobs: [job("j4", "c4", { title: "Oak pruning", completedOn: ago(3 * 365 + 10, asOf), total: 900 })],
      requests: [request("r5", "c5", { title: "Trim oaks over the driveway", createdOn: ago(30, asOf) })],
    });
  };

  it("in June, no note offers a day, a week, an opening or a crew — every ask is for the dormant season", () => {
    const ds = oakDs("2027-06-15");
    const r = scan(ds);
    const opps = (["approved_unscheduled", "unanswered_quote", "archived_quote", "service_due", "unquoted_request"] as BreakageType[]).map((type, i) => oneOpp(r, `c${i + 1}`, type));
    for (const o of opps) {
      expect(o.serviceId).toBe("tree.prune_oak");
      const c = ds.customers.find((x) => x.id === o.customerId)!;
      const all = notes(ds, o, c, "2027-06-15");
      expect(all.length).toBe(SEQUENCES[o.type].steps.length);
      for (const n of all) {
        expect(main(n), `${o.type} ${n.templateId}`).not.toMatch(NEAR_TERM);
        expect(n.angle).not.toBe("crew_nearby");
        expect(n.flags).toEqual([]);
      }
    }
    // the ones that ask for a date ask for November
    const approved = notes(ds, opps[0]!, ds.customers[0]!, "2027-06-15");
    expect(main(approved[0]!)).toContain("Oaks have to wait for the dormant season because of oak wilt. If you still want it done, want me to put you down for the first open week in November?");
    expect(main(approved[1]!)).toContain("It has to wait until November");
    const due = notes(ds, opps[3]!, ds.customers[3]!, "2027-06-15");
    expect(main(due[0]!)).toContain("first open week in November");
  });

  it("in January the same notes may ask for a day again", () => {
    const ds = oakDs("2027-01-12");
    const r = scan(ds);
    const n = renderNote(oneOpp(r, "c1", "approved_unscheduled"), ds.customers[0]!, { ds, sendOn: "2027-01-12" }, 1)!;
    expect(n.templateId).toBe("a1");
    expect(main(n)).toMatch(/Reply with a couple of days that work/);
  });

  it("deadwood on an oak is oak pruning, not a removal", () => {
    const ds = dataset({ asOf: "2027-06-15", customers: [customer("c1")], quotes: [quote("q1", "c1", { title: "Deadwood removal - large oak", sentOn: "2027-03-01" })] });
    const o = oneOpp(scan(ds), "c1", "unanswered_quote");
    expect(o.serviceId).toBe("tree.prune_oak");
    for (const n of notes(ds, o, ds.customers[0]!, "2027-06-15")) {
      expect(main(n)).not.toMatch(/needed to come down|take down/);
      expect(main(n)).not.toMatch(NEAR_TERM);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Season lines follow the send month                                  */
/* ------------------------------------------------------------------ */

describe("season lines", () => {
  /** An archived quote's second note (its angles put the timing line first when there's no crew line). */
  const step2 = (trade: TradeId, title: string, sendOn: string) => {
    const ds = dataset({ business: { trade, name: "Test Co." }, customers: [customer("c1", { address: undefined })], quotes: [quote("q1", "c1", { title, status: "archived", sentOn: ago(60), archivedOn: ago(50) })] });
    const o = oneOpp(scan(ds), "c1", "archived_quote");
    return renderNote(o, ds.customers[0]!, { ds, sendOn }, 2)!;
  };

  it("aeration's window line goes out in September, not in November", () => {
    expect(main(step2("lawn", "Fall aeration & overseed", "2026-09-15"))).toContain("late summer to early fall is the window");
    const nov = step2("lawn", "Fall aeration & overseed", "2026-11-10");
    expect(main(nov)).not.toMatch(/Late summer|window for aeration/);
    expect(nov.flags).toEqual([]);
  });
  it("'leaf-off months' is a winter line: never in June", () => {
    expect(main(step2("tree", "Remove dead ash", "2027-01-12"))).toContain("leaf-off months");
    expect(main(step2("tree", "Remove dead ash", "2027-06-15"))).not.toMatch(/Leaf-off/i);
  });
  it("out of season, the timing note books ahead instead of asking for a day", () => {
    const dec = step2("fence", "150 ft cedar privacy fence", "2026-12-08");
    expect(dec.templateId).toBe("q2tp");
    expect(main(dec)).toContain("spring is the busiest fence season");
    expect(main(dec)).toContain("want me to put you down for the first open week in March?");
    expect(main(dec)).not.toMatch(/reply with a day/);
    // a New Hampshire house wash in January doesn't talk about spring streaks and then ask for a day
    expect(main(step2("pressure_washing", "House wash - 2 story colonial", "2027-01-12"))).not.toMatch(/reply with a day/);
  });
  it("a past customer's timing note never says 'before then'", () => {
    const ds = dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Remove leaning pine", completedOn: ago(400), total: 1800 })] });
    const o = oneOpp(scan(ds), "c1", "one_and_done");
    for (const sendOn of ["2026-11-10", "2027-06-15"]) {
      const n = renderNote(o, ds.customers[0]!, { ds, sendOn }, 2)!;
      expect(main(n)).not.toMatch(/before then/);
      expect(n.flags).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ */
/* No first name: never "there, …" mid-thread                          */
/* ------------------------------------------------------------------ */

describe("people with no first name", () => {
  it("follow-ups drop the name instead of saying 'there, …' or ', there.'", () => {
    const people = Array.from({ length: 12 }, (_, i) => customer(`c${i}`, { firstName: "", name: "The Patels", address: i % 2 ? undefined : { street: `${10 + i} Oak Ln`, city: "Concord", state: "NH", zip: "03301" } }));
    const ds = dataset({
      customers: people,
      quotes: people.map((c, i) => quote(`q${i}`, c.id, { title: ["Prune maples by the driveway", "Remove dead ash", "Stump grinding x3"][i % 3]!, status: i % 2 ? "archived" : "changes_requested", sentOn: ago(90), archivedOn: ago(80), changesRequestedOn: ago(85) })),
    });
    const r = scan(ds);
    let followUps = 0;
    for (const o of r.opportunities) {
      for (const n of notes(ds, o, ds.customers.find((c) => c.id === o.customerId)!, ASOF)) {
        const m = main(n);
        if (n.templateId.match(/^(q1|c1)/)) {
          expect(m).toMatch(/^Hi there,/);
          continue;
        }
        followUps++;
        expect(m).not.toMatch(/^there,|, there[.?]/m);
        expect(m[0]).toBe(m[0]!.toUpperCase());
        expect(n.flags).toEqual([]);
      }
    }
    expect(followUps).toBeGreaterThan(10);
  });
  it("the linter catches it if one slips through", () => {
    const body = "there, checking back on the oak.\n\nSarah\n\nRidgeline Tree Co. · 14 Mill Rd\nYou're getting this sales follow-up because you asked us for a price.\nReply \"stop\" and you won't hear from us again.";
    expect(lint("Re: the oak", body, { firstName: "there", job: "the oak", step: 2 })).toContain('Uses "there" as a name mid-thread');
    expect(lint("Re: the oak", body.replace("there, checking back on the oak.", "Last note from me on this, there. Reply if you still want it?"), { firstName: "there", job: "the oak", step: 3 })).toContain('Uses "there" as a name mid-thread');
  });
});

/* ------------------------------------------------------------------ */
/* "No charge to look" only where looking is free                      */
/* ------------------------------------------------------------------ */

describe("no charge to look", () => {
  const problemNote = (trade: TradeId, title: string, freeLook?: boolean) => {
    const ds = dataset({ business: { trade, name: "Test Co.", voice: { mentionPrice: false, offerOptions: true, wordSwaps: [], freeLook } }, customers: [customer("c1", { address: undefined })], quotes: [quote("q1", "c1", { title, sentOn: ago(60) })] });
    const o = oneOpp(scan(ds), "c1", "unanswered_quote");
    return renderNote(o, ds.customers[0]!, { ds, sendOn: ASOF }, 2)!;
  };
  it("HVAC, septic and pest never promise a free visit by default", () => {
    for (const [trade, title] of [["hvac", "AC replacement - 3 ton"], ["septic", "Replace effluent pump"], ["pest", "Termite treatment - perimeter"]] as const) {
      const n = problemNote(trade, title);
      expect(n.templateId).toBe("q2p");
      expect(main(n)).toMatch(/take another look first, just reply and we'll set it up\.\n/);
      expect(main(n)).not.toMatch(/No charge/i);
    }
  });
  it("tree and fence say it, and the owner can turn it on or off", () => {
    expect(main(problemNote("tree", "Remove dead ash"))).toContain("No charge to look.");
    expect(main(problemNote("tree", "Remove dead ash", false))).not.toMatch(/No charge/);
    expect(main(problemNote("hvac", "AC replacement - 3 ton", true))).toContain("No charge to look.");
  });
  it("a past customer of a pest company isn't promised a free visit either", () => {
    const ds = dataset({ business: { trade: "pest", name: "Test Pest" }, customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Rodent exclusion", completedOn: ago(400), total: 600 })] });
    const n = renderNote(oneOpp(scan(ds), "c1", "one_and_done"), ds.customers[0]!, { ds, sendOn: ASOF }, 1)!;
    expect(n.templateId).toBe("p1");
    expect(main(n)).toContain("We took care of the rodent problem for you");
    expect(main(n)).not.toMatch(/No charge|We did the rodent/);
  });
});

/* ------------------------------------------------------------------ */
/* Threading: every follow-up is "Re: " + note 1's subject             */
/* ------------------------------------------------------------------ */

describe("follow-ups thread under note 1", () => {
  it.each(["tree", "fence", "painting", "cleaning", "septic", "hvac", "pest", "holiday_lighting", "deck"] as const)("%s: every later subject is exactly 'Re: ' + the first", (trade) => {
    const s = generateSample({ trade, asOf: ASOF });
    const r = scan(s.dataset);
    const plan = planOutreach(s.dataset, r, { startOn: "2026-10-01", applyHoldout: false, limitPeople: 150 });
    const first = new Map(plan.touches.filter((t) => t.step === 1).map((t) => [t.opportunityId, t.subject]));
    const later = plan.touches.filter((t) => t.step > 1);
    expect(later.length).toBeGreaterThan(50);
    const wrong = later.filter((t) => t.subject !== `Re: ${first.get(t.opportunityId)}`).map((t) => `${first.get(t.opportunityId)} -> ${t.subject}`);
    expect(wrong).toEqual([]);
    expect(later.filter((t) => t.flags.some((f) => /Subject too long/.test(f)))).toEqual([]);
  });
  it("a note rendered on its own (the console preview) threads the same way", () => {
    const ds = dataset({ customers: [customer("c1")], requests: [request("r1", "c1", { title: "Spruce out back leaning", createdOn: ago(40) })] });
    const o = oneOpp(scan(ds), "c1", "unquoted_request");
    const [n1, n2, n3] = notes(ds, o, ds.customers[0]!, ASOF);
    expect(n1!.subject).toBe("your quote for the spruce");
    expect(n2!.subject).toBe(`Re: ${n1!.subject}`);
    expect(n3!.subject).toBe(`Re: ${n1!.subject}`);
  });
});

/* ------------------------------------------------------------------ */
/* Nothing asks about a price that never existed                       */
/* ------------------------------------------------------------------ */

describe("work that was never priced", () => {
  const CLOSE = /was it timing, price|if the timing's better now/i;
  it("a request that never got a quote is never asked 'was it the price'", () => {
    const ds = dataset({ customers: [customer("c1", { firstName: "Diane" })], requests: [request("r1", "c1", { title: "Effluent pump alarm going off", createdOn: ago(120) })], business: { trade: "septic", name: "Granite State Septic" } });
    const o = oneOpp(scan(ds), "c1", "unquoted_request");
    const all = notes(ds, o, ds.customers[0]!, ASOF);
    expect(all).toHaveLength(3);
    for (const n of all) {
      expect(main(n)).not.toMatch(CLOSE);
      expect(n.flags).toEqual([]);
    }
    expect(main(all[1]!)).toMatch(/still like a price on the effluent pump/);
    expect(main(all[2]!)).toMatch(/reply and I'll get you a price/);
  });
  it("service reminders and missed add-ons close without the price question", () => {
    const due = dataset({ business: { trade: "septic", name: "Granite State Septic" }, customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Routine pump-out 1000 gal", total: 450, completedOn: ago(3 * 365 + 20) })] });
    const o = oneOpp(scan(due), "c1", "service_due");
    const dueNotes = notes(due, o, due.customers[0]!, ASOF);
    expect(dueNotes.map((n) => n.templateId)).toEqual(["s1", "s2", "s3"]);
    for (const n of dueNotes) expect(main(n)).not.toMatch(CLOSE);

    const up = dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Oak removal", completedOn: ago(40), total: 2000 })] });
    const u = scan(up).opportunities.find((x) => x.type === "missed_upsell" && x.serviceId === "tree.stump")!;
    for (const n of notes(up, u, up.customers[0]!, ASOF)) expect(main(n)).not.toMatch(CLOSE);
  });
});

/* ------------------------------------------------------------------ */
/* Grammar                                                             */
/* ------------------------------------------------------------------ */

describe("plain grammar", () => {
  it("never 'the stumps is handled'", () => {
    const ds = dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { title: "Stump grinding x3", sentOn: ago(60) })] });
    const n = renderNote(oneOpp(scan(ds), "c1", "unanswered_quote"), ds.customers[0]!, { ds, sendOn: ASOF }, 3)!;
    expect(main(n)).toContain("If you've already taken care of the stumps, no need to reply.");
    expect(main(n)).not.toMatch(/\bis handled\b/);
  });
  it("never 'out back back in April'", () => {
    const ds = dataset({ customers: [customer("c1")], quotes: [quote("q1", "c1", { title: "Remove spruce in backyard", status: "approved", approvedOn: "2026-04-10", sentOn: "2026-04-01" })] });
    const n = renderNote(oneOpp(scan(ds), "c1", "approved_unscheduled"), ds.customers[0]!, { ds, sendOn: ASOF }, 1)!;
    expect(main(n)).toContain("the spruce in the backyard back in April");
    expect(main(n)).not.toMatch(/back back/);
  });
  it("says 'about 2½ years', never '2.4 years'", () => {
    const ds = dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Remove leaning pine", completedOn: ago(880), total: 1800 })] });
    const o = oneOpp(scan(ds), "c1", "one_and_done");
    const n = renderNote(o, ds.customers[0]!, { ds, sendOn: ASOF }, 1)!;
    expect(n.templateId).toBe("p1");
    expect(main(n)).toContain("It's been about 2½ years.");
  });
  it("a yearly service is 'once a year', not 'every 12 months'", () => {
    const ds = dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Deep root fertilization", completedOn: ago(370), total: 400 })] });
    const n = renderNote(oneOpp(scan(ds), "c1", "service_due"), ds.customers[0]!, { ds, sendOn: ASOF }, 1)!;
    expect(main(n)).toContain("Once a year is the rule of thumb.");
  });
});

/* ------------------------------------------------------------------ */
/* The note is about the right job, in homeowner words                 */
/* ------------------------------------------------------------------ */

describe("the right job, in plain words", () => {
  it("a passed-on add-on's last note is about the add-on, not the job we already did", () => {
    const ds = dataset({
      business: { trade: "cleaning", name: "Bright Home Cleaning" },
      customers: [customer("c1", { firstName: "Maria" })],
      quotes: [quote("q1", "c1", { title: "Deep clean - 3br", status: "converted", convertedOn: ago(120), total: 480, lineItems: [{ name: "Deep clean - 3br", total: 380 }, { name: "Inside oven + fridge", total: 100, optional: true, selected: false }] })],
    });
    const o = oneOpp(scan(ds), "c1", "declined_option");
    const [n1, n2] = notes(ds, o, ds.customers[0]!, ASOF);
    expect(main(n1!)).toContain("you passed on inside oven + fridge");
    expect(n2!.subject).toBe("Re: inside oven + fridge");
    expect(main(n2!)).toContain("Last note from me on inside oven + fridge, Maria.");
    expect(main(n2!)).not.toMatch(/the cleaning|was it timing, price/);
  });
  it("a line item that starts with a verb reads as a thing", () => {
    const ds = dataset({
      business: { trade: "septic", name: "Granite State Septic" },
      customers: [customer("c1")],
      quotes: [quote("q1", "c1", { title: "Pump-out", status: "converted", convertedOn: ago(60), total: 900, lineItems: [{ name: "Pump-out", total: 450 }, { name: "Install risers & lids", total: 450, optional: true, selected: false }] })],
    });
    const n = renderNote(oneOpp(scan(ds), "c1", "declined_option"), ds.customers[0]!, { ds, sendOn: ASOF }, 1)!;
    expect(main(n)).toContain("you passed on the risers & lids");
  });
  it("a missed add-on is explained in a homeowner's sentence, never the owner's note", () => {
    const ds = dataset({ business: { trade: "fence", name: "Stonewall Fence Co." }, customers: [customer("c1")], jobs: [job("j1", "c1", { title: "150 ft cedar privacy fence", completedOn: ago(120), total: 6000 })] });
    const ups = scan(ds).opportunities.filter((o) => o.type === "missed_upsell");
    expect(new Set(ups.map((o) => o.id)).size).toBe(ups.length); // two add-ons from one job are two opportunities
    const gate = ups.find((o) => o.serviceId === "fence.gate")!;
    const m = main(renderNote(gate, ds.customers[0]!, { ds, sendOn: ASOF }, 1)!);
    expect(m).toContain("we never talked about the gate. Self-closing hinges and a solid latch keep the gate shut on its own.");
    expect(m).not.toMatch(/Gate hardware and self-closers after install/);
  });
  it("a pressure washer did 'the house wash', never 'the house' or 'the roof'", () => {
    const ds = dataset({
      business: { trade: "pressure_washing", name: "Clearview Exterior Wash" },
      customers: [customer("c1"), customer("c2")],
      jobs: [job("j1", "c1", { title: "House wash - 2 story", completedOn: ago(500), total: 450 }), job("j2", "c2", { title: "Roof soft wash", completedOn: ago(400), total: 700 })],
    });
    const r = scan(ds);
    const house = r.opportunities.find((o) => o.customerId === "c1" && o.type === "one_and_done")!;
    const roof = r.opportunities.find((o) => o.customerId === "c2" && o.type === "one_and_done")!;
    expect(house.jobPhrase).toBe("the house wash");
    expect(roof.jobPhrase).toBe("the roof cleaning");
    expect(main(renderNote(roof, ds.customers[1]!, { ds, sendOn: ASOF }, 1)!)).toContain("We took care of the roof cleaning for you");
  });
});
