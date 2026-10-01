import { describe, expect, it } from "vitest";
import { scan } from "../src/breakage/detect.ts";
import { renderNote, renderRequestAck, type RenderedNote } from "../src/copy/render.ts";
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

/* ------------------------------------------------------------------ */
/* Painting: the season decides the second note                         */
/* ------------------------------------------------------------------ */

describe("painting notes follow the painting year", () => {
  const painter = (asOf: string, title: string, sentOn: string) =>
    dataset({
      asOf,
      business: { trade: "painting", name: "Brushline Painting" },
      customers: [customer("c1", { firstName: "Rachel", address: undefined })],
      quotes: [quote("q1", "c1", { title, total: 6800, sentOn })],
    });

  it("an exterior quote gone quiet over the winter: in February the second note books spring, honestly", () => {
    const ds = painter("2027-02-09", "Exterior repaint - 2 story colonial", "2026-10-14");
    const o = oneOpp(scan(ds), "c1", "unanswered_quote");
    expect(o.serviceId).toBe("paint.exterior");
    const [n1, n2, n3] = notes(ds, o, ds.customers[0]!, "2027-02-09");
    expect(main(n1!)).toMatch(/the exterior painting/);
    expect(n2!.templateId).toBe("q2tp");
    expect(main(n2!)).toBe("Rachel, spring exterior dates usually book up by April.\n\nIf you'd still like the exterior painting done, want me to put you down for the first open week in May?\n\nSarah");
    expect(main(n2!)).not.toMatch(NEAR_TERM);
    for (const n of [n1!, n2!, n3!]) expect(n.flags).toEqual([]);
  });

  it("the spring line never goes out once spring is here or gone", () => {
    for (const sendOn of ["2027-05-11", "2027-08-10", "2026-11-10"]) {
      const ds = painter(sendOn, "Exterior repaint - 2 story colonial", "2026-03-02");
      const o = oneOpp(scan(ds), "c1", "unanswered_quote");
      for (const n of notes(ds, o, ds.customers[0]!, sendOn)) {
        expect(main(n), sendOn).not.toMatch(/book up by April/);
        expect(n.flags).toEqual([]);
      }
    }
  });

  it("inside work gets the winter line in winter, and not in July", () => {
    const dec = painter("2026-12-08", "Interior - living room, hallway + ceilings", "2026-10-01");
    const o = oneOpp(scan(dec), "c1", "unanswered_quote");
    expect(o.serviceId).toBe("paint.interior");
    const n2 = notes(dec, o, dec.customers[0]!, "2026-12-08")[1]!;
    expect(main(n2)).toContain("winter is a good time for inside work: no weather delays.");
    expect(n2.flags).toEqual([]);
    const jul = painter("2027-07-13", "Interior - living room, hallway + ceilings", "2027-05-01");
    for (const n of notes(jul, oneOpp(scan(jul), "c1", "unanswered_quote"), jul.customers[0]!, "2027-07-13")) expect(main(n)).not.toMatch(/winter/i);
  });

  it("an exterior client is told the same crew paints inside", () => {
    const ds = dataset({ asOf: "2026-12-08", business: { trade: "painting", name: "Brushline Painting" }, customers: [customer("c1", { firstName: "Ann" })], jobs: [job("j1", "c1", { title: "Exterior house painting", total: 7200, completedOn: "2026-08-20" })] });
    const up = scan(ds).opportunities.filter((o) => o.type === "missed_upsell").map((o) => o.serviceId);
    expect(up.sort()).toEqual(["paint.deck", "paint.interior"]);
    const o = scan(ds).opportunities.find((x) => x.type === "missed_upsell" && x.serviceId === "paint.interior")!;
    const n = renderNote(o, ds.customers[0]!, { ds, sendOn: "2026-12-08" }, 1)!;
    expect(main(n)).toContain("When we took care of the exterior painting for you back in August, we never talked about the interior painting. We paint inside too, if there are any rooms you've been meaning to get to.");
    expect(n.flags).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Cleaning: a missed visit, and the one-time client                    */
/* ------------------------------------------------------------------ */

describe("cleaning notes", () => {
  const biz = { trade: "cleaning" as const, name: "Tidewell Home Cleaning", avgJobValue: 180, minQuoteValue: 100 };
  const regular = (lastDaysAgo: number) =>
    dataset({
      business: biz,
      customers: [customer("c1", { firstName: "Megan" })],
      jobs: Array.from({ length: 10 }, (_, i) => job(`j${i}`, "c1", { title: "Bi-weekly cleaning", recurring: true, total: 180, completedOn: ago(lastDaysAgo + (9 - i) * 14) })),
    });

  it("a biweekly client three weeks out is asked back by the date of the last visit, not 'we used to'", () => {
    const ds = regular(28);
    const o = oneOpp(scan(ds), "c1", "lapsed_regular");
    const [n1, n2] = notes(ds, o, ds.customers[0]!, ASOF);
    expect(n1!.templateId).toBe("g1r");
    expect(main(n1!)).toBe(
      "Hi Megan,\n\nSarah at Tidewell Home Cleaning. We haven't been by for the regular cleaning since September 1, and I wanted to make sure you're all set.\n\nWant us back on your usual schedule? Reply with a day that works and I'll put you back on.\n\nSarah",
    );
    expect(main(n2!)).toContain("If you'd like us back for the regular cleaning, just reply and I'll hold you a spot.");
    for (const n of [n1!, n2!]) expect(n.flags).toEqual([]);
  });

  it("months later it's the plain 'we used to' note again, and other trades never get the short one", () => {
    const ds = regular(150);
    expect(notes(ds, oneOpp(scan(ds), "c1", "lapsed_regular"), ds.customers[0]!, ASOF)[0]!.templateId).toBe("g1");
    const lawn = dataset({ business: { trade: "lawn", avgJobValue: 55, minQuoteValue: 150 }, customers: [customer("c1")], jobs: Array.from({ length: 8 }, (_, i) => job(`j${i}`, "c1", { title: "Mowing visit", recurring: true, total: 55, completedOn: ago(62 + (7 - i) * 14) })) });
    expect(notes(lawn, oneOpp(scan(lawn), "c1", "lapsed_regular"), lawn.customers[0]!, ASOF)[0]!.templateId).toBe("g1");
  });

  it("a deep clean is asked about a regular schedule, never 'want a price'", () => {
    const ds = dataset({ business: biz, customers: [customer("c1", { firstName: "Megan" })], jobs: [job("j1", "c1", { title: "Deep clean - 3 bed 2 bath", total: 380, completedOn: ago(4) })] });
    const o = scan(ds).opportunities.find((x) => x.type === "missed_upsell" && x.serviceId === "clean.recurring")!;
    const [n1, n2] = notes(ds, o, ds.customers[0]!, ASOF);
    expect([n1!.templateId, n2!.templateId]).toEqual(["u1a", "u3a"]);
    expect(main(n1!)).toContain("We did the deep clean for you last week. If you'd like the house to stay that way, we can come back every week, every other week or once a month.\n\nWant it on a regular schedule? Reply with what works and I'll set it up.");
    expect(main(n2!)).toContain("Want it on a regular schedule? Just reply and I'll set it up.");
    for (const n of [n1!, n2!]) {
      expect(main(n)).not.toMatch(/want a price|never talked about/i);
      expect(n.flags).toEqual([]);
    }
    // every other trade's next-job note still asks for a price
    const tree = dataset({ customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Oak removal", completedOn: ago(40), total: 2000 })] });
    const stump = scan(tree).opportunities.find((x) => x.type === "missed_upsell" && x.serviceId === "tree.stump")!;
    expect(notes(tree, stump, tree.customers[0]!, ASOF).map((n) => n.templateId)).toEqual(["u1", "u3"]);
  });
});

/* ------------------------------------------------------------------ */
/* The first answer to a new request asks what the owner needs          */
/* ------------------------------------------------------------------ */

describe("the first answer asks the trade's intake questions", () => {
  const ack = (trade: TradeId, name: string, title: string, address = true) => {
    const ds = dataset({ business: { trade, name } });
    const c = customer("c1", { firstName: "Karen", address: address ? { street: "14 Oak Ln", city: "Concord", state: "NH", zip: "03301" } : undefined });
    return renderRequestAck(ds, request("r1", "c1", { title }), c, "2026-09-29T10:15:00");
  };
  const paragraphs = (body: string) => body.split(/\n\n[^\n]*·[^\n]*\n/)[0]!.split("\n\n");

  it.each([
    ["tree", "Ridgeline Tree Co.", "Two pines by the garage need to come down", false, "If it's easy, reply with a photo or two and the address."],
    ["tree", "Ridgeline Tree Co.", "Oak over the garage", true, "If it's easy, reply with a photo or two."],
    ["fence", "Stonewall Fence Co.", "Privacy fence along the back line", true, "If you can, reply with roughly how many feet, the material you're thinking of, any gates, and whether there's an HOA."],
    ["painting", "Brushline Painting", "Need a painter", true, "Is it inside or outside, and when are you hoping to have it done?"],
    ["painting", "Brushline Painting", "Repaint the living room and hallway", true, "When are you hoping to have it done?"],
    ["cleaning", "Tidewell Home Cleaning", "Looking for a house cleaner", true, "How many bedrooms and bathrooms, is it a one-time clean or regular, and any pets?"],
  ] as const)("%s (%s): %s", (trade, name, title, address, line) => {
    const a = ack(trade, name, title, address);
    const p = paragraphs(a.body);
    // the call-back promise first, then the one question, then the usual last line
    expect(p[1]).toMatch(/will give you a call today to set up a time to take a look\.$/);
    expect(p[2]).toBe(line);
    expect(p[3]).toBe("If there's a better time or number to reach you, just reply here.");
    expect(a.flags).toEqual([]);
    expect(a.body).not.toMatch(/\$\d/);
  });

  it("a trade without an intake question keeps today's answer, word for word", () => {
    const a = ack("septic", "Granite State Septic", "Septic pump-out");
    expect(paragraphs(a.body)).toEqual([
      "Hi Karen,",
      "Thanks for reaching out to Granite State Septic about the pump-out. Dave will give you a call today to set up a time to take a look.",
      "If there's a better time or number to reach you, just reply here.",
      "Sarah",
    ]);
  });
});
