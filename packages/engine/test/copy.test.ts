import { beforeAll, describe, expect, it } from "vitest";
import { dueDate, scan, type ScanResult } from "../src/breakage/detect.ts";
import { crewLine, footer, renderNote } from "../src/copy/render.ts";
import { lint } from "../src/copy/lint.ts";
import { SEQUENCES } from "../src/copy/templates.ts";
import { BANNED_STATS, bannedStatIn } from "../src/claims.ts";
import { generateSample, type Sample } from "../src/sample/generate.ts";
import type { BreakageType, Customer, Dataset, Job, Opportunity, TradeId } from "../src/model.ts";
import { findService, playbook } from "../src/trades/index.ts";
import { greetingName } from "../src/util.ts";
import { ASOF, ago, business, customer, dataset, job, oneOpp, oppsFor, quote } from "./fixtures.ts";

const TRADES = ["tree", "septic", "lawn", "fence", "pressure_washing", "holiday_lighting", "deck"] as const;
const ALL_TYPES = Object.keys(SEQUENCES) as BreakageType[];
const SEND_ON = "2026-10-01"; // Thursday, two days after the sample's as-of date

/** Everything a note sent to a homeowner must (and must never) contain. Returns what's wrong. */
function problemsWith(subject: string, body: string, flags: string[], ds: Dataset, c: Customer): string[] {
  const p: string[] = [];
  if (flags.length) p.push(`lint: ${flags.join("; ")}`);
  if (!body.includes('Reply "stop"')) p.push("no stop line");
  if (!body.includes(ds.business.mailingAddress!)) p.push("no business address");
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org)\b/i.test(subject + "\n" + body)) p.push("has a link");
  if (/!/.test(subject + body)) p.push("has an exclamation mark");
  if (/\d\s?%|percent/i.test(subject + body)) p.push("has a percentage");
  // a follow-up's "Re: " repeats note 1's subject exactly, so it doesn't count toward the length
  if (!subject || subject.replace(/^Re: /, "").length > 60) p.push(`subject length ${subject.length}`);
  // with no first name, a follow-up leaves the name out rather than saying "there, …"
  if (greetingName(c.firstName) === "there" ? /^there,|, there[.?]/m.test(body) : !body.includes(greetingName(c.firstName))) p.push("doesn't greet them by name");
  if (!body.includes(ds.business.signerName)) p.push("not signed");
  if (/\{\w+\}|undefined|NaN/.test(subject + body)) p.push("unfilled token");
  return p;
}

/* ------------------------------------------------------------------ */
/* Every breakage type, every step, on every sample trade              */
/* ------------------------------------------------------------------ */

interface TradeCase {
  sample: Sample;
  byType: Map<BreakageType, Opportunity[]>;
  customers: Map<string, Customer>;
}

/**
 * Some trades never produce a type from their sample (lawn services have no follow-on work; the fence
 * sample's only re-service clock is an add-on). Borrow a real past job and point it at a real service.
 */
const SYNTHESIZE: Partial<Record<BreakageType, (r: ScanResult, trade: TradeId) => Opportunity>> = {
  missed_upsell: (r, trade) => {
    const donor = r.opportunities.find((o) => o.source.kind === "job" && !o.suppressed)!;
    const pb = playbook(trade);
    const lead = pb.services.find((s) => s.followOns?.length);
    const next = lead ? findService(lead.followOns![0]!.serviceId)!.service : pb.services[pb.services.length - 1]!;
    return { ...donor, id: `${donor.id}-upsell`, type: "missed_upsell", serviceId: next.id, jobPhrase: next.phrase, reason: `Did the last job a while back. ${next.label} was never offered — it goes naturally with that work.` };
  },
  service_due: (r, trade) => {
    const donor = r.opportunities.find((o) => o.source.kind === "job" && !o.suppressed)!;
    const svc = playbook(trade).services.find((s) => s.reserviceMonths && s.kind !== "recurring")!;
    return { ...donor, id: `${donor.id}-due`, type: "service_due", serviceId: svc.id, jobPhrase: svc.phrase };
  },
  declined_quote: (r) => {
    const donor = r.opportunities.find((o) => o.type === "archived_quote")!;
    return { ...donor, id: `${donor.id}-no`, type: "declined_quote" };
  },
  // only a real routine lapses (a fence sample's repeat customers are one-off jobs)
  lapsed_regular: (r, trade) => {
    const donor = r.opportunities.find((o) => o.source.kind === "job" && !o.suppressed)!;
    const svc = playbook(trade).services.find((s) => s.kind === "maintenance" || s.kind === "recurring")!;
    return { ...donor, id: `${donor.id}-lapsed`, type: "lapsed_regular", serviceId: svc.id, jobPhrase: svc.phrase };
  },
};

function prepare(trade: (typeof TRADES)[number]): TradeCase {
  const sample = generateSample({ trade, asOf: ASOF });
  // The Jobber sample archives lost quotes; mark a slice of them declined so the "said no" play is exercised too.
  let n = 0;
  for (const q of sample.dataset.quotes) if (q.status === "archived" && n++ % 4 === 0) q.status = "declined";
  const r = scan(sample.dataset);
  const byType = new Map<BreakageType, Opportunity[]>();
  for (const o of r.opportunities) (byType.get(o.type) ?? byType.set(o.type, []).get(o.type)!).push(o);
  for (const type of ALL_TYPES) if (!byType.get(type)?.length && SYNTHESIZE[type]) byType.set(type, [SYNTHESIZE[type]!(r, trade)]);
  return { sample, byType, customers: new Map(sample.dataset.customers.map((c) => [c.id, c])) };
}

describe.each(TRADES)("renderNote on the %s sample", (trade) => {
  let tc: TradeCase;
  beforeAll(() => {
    tc = prepare(trade);
  });

  it.each(ALL_TYPES)("%s: steps 1-3 render clean", (type) => {
    const opps = tc.byType.get(type) ?? [];
    expect(opps.length, `the ${trade} sample has no ${type}`).toBeGreaterThan(0);
    const ds = tc.sample.dataset;
    const problems: string[] = [];
    let rendered = 0;
    for (const o of opps) {
      const c = tc.customers.get(o.customerId);
      if (!c) continue;
      for (const step of [1, 2, 3]) {
        const planned = SEQUENCES[type].steps.some((s) => s.step === step);
        const note = renderNote(o, c, { ds, sendOn: SEND_ON }, step);
        if (!planned) {
          if (note) problems.push(`${o.id} step ${step}: rendered a step the sequence doesn't have`);
          continue;
        }
        if (!note) {
          // the only step allowed to have no eligible template: a past-customer follow-up needs their street
          if (!(type === "one_and_done" && step > 1 && !c.address?.street)) problems.push(`${o.id} step ${step}: no note`);
          continue;
        }
        rendered++;
        for (const why of problemsWith(note.subject, note.body, note.flags, ds, c)) problems.push(`${o.id} step ${step}: ${why}\n${note.subject}\n${note.body}`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(rendered).toBeGreaterThanOrEqual(opps.length);
  });
});

/* ------------------------------------------------------------------ */
/* Stale quotes never repeat the old price                             */
/* ------------------------------------------------------------------ */

describe("stale-quote guard", () => {
  /** Twelve people with the same quote, half with a street on file (so every opener template gets picked). */
  const quotes = (ageDays: number, mentionPrice: boolean, status: "awaiting_response" | "archived" = "awaiting_response") => {
    const customers = Array.from({ length: 12 }, (_, i) => customer(`c${i}`, { firstName: ["Mike", "Tom", "Kara", "Gail"][i % 4]!, address: i % 2 ? undefined : { street: `${10 + i} Oak Ln`, city: "Concord", state: "NH", zip: "03301" } }));
    const ds = dataset({
      business: { voice: { mentionPrice, offerOptions: true, wordSwaps: [] } },
      customers,
      quotes: customers.map((c) => quote(`q-${c.id}`, c.id, { title: "Remove leaning birch by driveway", total: 2400, status, sentOn: ago(ageDays), archivedOn: status === "archived" ? ago(ageDays) : undefined })),
    });
    const r = scan(ds);
    return customers.map((c) => ({ c, o: oneOpp(r, c.id, status === "archived" ? "archived_quote" : "unanswered_quote"), ds }));
  };

  it("a quote older than 180 days never shows a dollar amount, even with mentionPrice on", () => {
    for (const status of ["awaiting_response", "archived"] as const) {
      for (const { c, o, ds } of quotes(200, true, status)) {
        for (const step of [1, 2, 3]) {
          const n = renderNote(o, c, { ds, sendOn: ASOF }, step)!;
          expect(n.subject + n.body).not.toMatch(/\$/);
          if (step === 1) expect(n.body).toMatch(/come take a fresh look first/);
        }
      }
    }
  });
  it("a fresh quote shows the price when the owner wants it", () => {
    for (const { c, o, ds } of quotes(60, true)) {
      const n = renderNote(o, c, { ds, sendOn: ASOF }, 1)!;
      expect(n.body).not.toMatch(/fresh look/);
      // the "{job} on {street}" opener has no price slot; the others always carry it
      if (!c.address) expect(n.body).toContain("($2,400)");
    }
  });
  it("a fresh quote leaves the price out by default", () => {
    for (const { c, o, ds } of quotes(60, false)) expect(renderNote(o, c, { ds, sendOn: ASOF }, 1)!.body).not.toMatch(/\$/);
  });
  it("the owner can move the line", () => {
    const at120 = quotes(120, true).find((x) => !x.c.address)!;
    expect(renderNote(at120.o, at120.c, { ds: at120.ds, sendOn: ASOF }, 1)!.body).toContain("($2,400)");
    const strict = { ...at120.ds, business: { ...at120.ds.business, voice: { ...at120.ds.business.voice, staleQuoteDays: 90 } } };
    const n = renderNote(at120.o, at120.c, { ds: strict, sendOn: ASOF }, 1)!;
    expect(n.body).not.toMatch(/\$/);
    expect(n.body).toMatch(/fresh look/);
  });
  it("the line is at 180 days: 180 still shows the price, 181 does not", () => {
    const at180 = quotes(180, true).find((x) => !x.c.address)!;
    const at181 = quotes(181, true).find((x) => !x.c.address)!;
    expect(renderNote(at180.o, at180.c, { ds: at180.ds, sendOn: ASOF }, 1)!.body).toContain("($2,400)");
    expect(renderNote(at181.o, at181.c, { ds: at181.ds, sendOn: ASOF }, 1)!.body).not.toMatch(/\$/);
  });
});

/* ------------------------------------------------------------------ */
/* Crew-nearby lines are true, and never offered out of season          */
/* ------------------------------------------------------------------ */

describe("crew nearby", () => {
  /** An oak pruning quote on Oak Ln, and a crew booked on the same street six days after `sendOn`. */
  const oakStreet = (sendOn: string, quoteSent: string, crewOn: string) => {
    const ds = dataset({
      asOf: sendOn,
      customers: [customer("c1", { address: { street: "14 Oak Ln", city: "Concord", state: "NH", zip: "03301" } }), customer("c2", { firstName: "Tom", address: { street: "20 Oak Ln", city: "Concord", state: "NH", zip: "03301" } })],
      quotes: [quote("q1", "c1", { title: "Prune oak over driveway", total: 900, sentOn: quoteSent })],
      jobs: [job("j2", "c2", { title: "Maple removal", status: "scheduled", scheduledOn: crewOn, completedOn: undefined })],
    });
    const o = oneOpp(scan(ds), "c1", "unanswered_quote");
    return { ds, o, c: ds.customers[0]! };
  };

  it("an oak pruning quote in July never mentions the crew, even with one on the same street", () => {
    const { ds, o, c } = oakStreet("2026-07-14", "2026-05-10", "2026-07-20");
    expect(o.serviceId).toBe("tree.prune_oak");
    // the crew really is there...
    expect(crewLine(ds, c, "2026-07-14")).toMatch(/crew working on Oak Ln/);
    // ...but pruning an oak in July spreads oak wilt, so no note offers the slot
    for (const step of [1, 2, 3]) {
      const n = renderNote(o, c, { ds, sendOn: "2026-07-14" }, step)!;
      expect(n.body).not.toMatch(/crew/i);
      expect(n.angle).not.toBe("crew_nearby");
      expect(n.flags).toEqual([]);
    }
  });
  it("the same quote in January may use the crew line", () => {
    const { ds, o, c } = oakStreet("2027-01-12", "2026-11-10", "2027-01-18");
    const n = renderNote(o, c, { ds, sendOn: "2027-01-12" }, 2)!;
    expect(n.angle).toBe("crew_nearby");
    expect(n.body).toContain("crew working on Oak Ln the week of January 18");
    expect(n.flags).toEqual([]);
  });
  it("offers no open days while the owner is booked out, but a crew on the street is still true", () => {
    const c = customer("c1", { address: { street: "14 Oak Ln", city: "Concord", state: "NH", zip: "03301" } });
    const booked = dataset({ customers: [c], business: { openCrewWeeks: ["2026-10-05"], bookedOutUntil: "2026-12-15" } });
    expect(crewLine(booked, c, ASOF)).toBeUndefined();
    const street = dataset({
      customers: [c, customer("c2", { address: { street: "9 Oak Ln", city: "Concord", state: "NH", zip: "03301" } })],
      jobs: [job("j2", "c2", { status: "scheduled", scheduledOn: "2026-10-07", completedOn: undefined })],
      business: { bookedOutUntil: "2026-12-15" },
    });
    expect(crewLine(street, c, ASOF)).toMatch(/crew working on Oak Ln/);
  });
  it("crew lines come only from the real schedule or the owner's open weeks", () => {
    const c = customer("c1", { address: { street: "14 Oak Ln", city: "Concord", state: "NH", zip: "03301" } });
    expect(crewLine(dataset({ customers: [c] }), c, ASOF)).toBeUndefined();
    const open = dataset({ customers: [c], business: { openCrewWeeks: ["2026-10-05"] } });
    expect(crewLine(open, c, ASOF)).toBe("We've got a couple of open days the week of October 5.");
    // the customer's own booked job is not "a crew nearby"
    const own = dataset({ customers: [c], jobs: [job("j1", "c1", { status: "scheduled", scheduledOn: "2026-10-02", completedOn: undefined })] });
    expect(crewLine(own, c, ASOF)).toBeUndefined();
    // a crew in the same town, not the same street
    const town = dataset({ customers: [c, customer("c2", { address: { street: "9 Elm St", city: "Concord", state: "NH", zip: "03301" } })], jobs: [job("j2", "c2", { status: "scheduled", scheduledOn: "2026-10-07", completedOn: undefined })] });
    expect(crewLine(town, c, ASOF)).toBe("We've got a crew working in Concord the week of October 5.");
    // more than three weeks out doesn't count
    const far = dataset({ customers: [c, customer("c2", { address: { street: "9 Oak Ln", city: "Concord", state: "NH", zip: "03301" } })], jobs: [job("j2", "c2", { status: "scheduled", scheduledOn: "2026-11-30", completedOn: undefined })] });
    expect(crewLine(far, c, ASOF)).toBeUndefined();
  });
});

describe("the easy out", () => {
  it("first notes on a dead quote let them say no in one word", () => {
    const customers = Array.from({ length: 10 }, (_, i) => customer(`c${i}`, { address: undefined }));
    const ds = dataset({ customers, quotes: customers.map((c) => quote(`q-${c.id}`, c.id)) });
    const r = scan(ds);
    const ids = new Set<string>();
    for (const c of customers) {
      const n = renderNote(oneOpp(r, c.id, "unanswered_quote"), c, { ds, sendOn: ASOF }, 1)!;
      ids.add(n.templateId);
      expect(n.body).toContain('reply "pass" and I\'ll close it out');
      expect(n.flags).toEqual([]);
    }
    expect(ids.size).toBeGreaterThan(1); // both opener variants carry it
  });
});

describe("voice", () => {
  it("applies the owner's word swaps", () => {
    const ds = dataset({ business: { voice: { mentionPrice: false, offerOptions: true, wordSwaps: [["quote", "estimate"]] } }, customers: [customer("c1")], quotes: [quote("q1", "c1", { status: "changes_requested", sentOn: ago(40), changesRequestedOn: ago(35) })] });
    const n = renderNote(oneOpp(scan(ds), "c1", "changes_requested"), ds.customers[0]!, { ds, sendOn: ASOF }, 1)!;
    expect(n.body).not.toMatch(/\bquote\b/i);
    expect(n.body).toMatch(/\bestimate\b/);
    expect(n.subject).toMatch(/estimate/);
  });
  it("greets people with no usable first name as 'there'", () => {
    const ds = dataset({ customers: [customer("c1", { firstName: "", name: "Acme Holdings LLC" })], quotes: [quote("q1", "c1")] });
    const n = renderNote(oneOpp(scan(ds), "c1", "unanswered_quote"), ds.customers[0]!, { ds, sendOn: ASOF }, 1)!;
    expect(n.body).toMatch(/^Hi there,/);
  });
});

/* ------------------------------------------------------------------ */
/* Seasonal clocks: last year's lights, a wood deck's stain            */
/* ------------------------------------------------------------------ */

describe("holiday lights come due again in the fall", () => {
  const lightsDs = (asOf: string, completedOn: string) =>
    dataset({
      asOf,
      business: { trade: "holiday_lighting", name: "Bright Nights Holiday Lighting", avgJobValue: 1500, minQuoteValue: 300 },
      customers: [customer("c1", { firstName: "Karen" })],
      jobs: [job("j1", "c1", { title: "Christmas lights - roofline", total: 1650, completedOn })],
    });
  const install = () => playbook("holiday_lighting").services.find((s) => s.id === "light.install")!;

  it("a September note to a customer whose lights went up last November asks, plainly, if they want them up again", () => {
    const ds = lightsDs("2026-09-15", "2025-11-08");
    const o = oneOpp(scan(ds), "c1", "service_due");
    expect([o.serviceId, o.seasonFit]).toEqual(["light.install", "now"]);
    expect(o.reason).toMatch(/due in October/);
    const [n1, n2, n3] = [1, 2, 3].map((step) => renderNote(o, ds.customers[0]!, { ds, sendOn: "2026-09-15" }, step)!);
    expect(n1!.templateId).toBe("s1a");
    expect(n1!.subject).toBe("the holiday lights");
    expect(n1!.body.split("\n\n").slice(0, 5).join("\n\n")).toBe(
      "Hi Karen,\n\nIt's Sarah at Bright Nights Holiday Lighting. We did the holiday lights for you last November. Want the lights up again this year?\n\nMost of our install dates for November fill in October.\n\nIf so, just reply \"yes\" and I'll get you on the schedule.\n\nSarah",
    );
    // no rule of thumb, nothing "due", no deadline
    expect(n1!.body).not.toMatch(/rule of thumb|due again|once a year|book by|spots? left|before .* gone/i);
    for (const n of [n1!, n2!, n3!]) {
      expect(n.flags).toEqual([]);
      expect(problemsWith(n.subject, n.body, n.flags, ds, ds.customers[0]!)).toEqual([]);
    }
    expect([n2!.subject, n3!.subject]).toEqual(["Re: the holiday lights", "Re: the holiday lights"]);
  });

  it("lights hung in December or taken down in January are due the same October, so the note still goes in September", () => {
    for (const done of ["2025-12-12", "2026-01-20"]) expect(oneOpp(scan(lightsDs("2026-09-15", done)), "c1", "service_due").reason).toMatch(/due in October/);
    expect(dueDate(install(), "2025-11-08")).toBe("2026-10-01");
    expect(dueDate(install(), "2026-01-20")).toBe("2026-10-01");
    expect(dueDate(install(), "2026-05-02")).toBe("2027-10-01");
    // work without a season keeps its plain clock
    expect(dueDate(playbook("septic").services.find((s) => s.id === "septic.pump")!, "2023-06-10")).toBe("2026-06-10");
  });

  it("nothing goes out in midsummer, and the timing line runs only while it's true", () => {
    expect(oppsFor(scan(lightsDs("2026-07-10", "2025-11-08")), "c1", "service_due")).toEqual([]);
    const ds = lightsDs("2026-11-20", "2025-11-08");
    const n = renderNote(oneOpp(scan(ds), "c1", "service_due"), ds.customers[0]!, { ds, sendOn: "2026-11-20" }, 1)!;
    expect(n.body).toMatch(/Want the lights up again this year\?/);
    expect(n.body).not.toMatch(/fill in October/);
    expect(n.flags).toEqual([]);
  });

  it("other trades' service-due notes keep their rule of thumb", () => {
    const ds = dataset({ business: { trade: "septic", name: "Granite State Septic" }, customers: [customer("c1")], jobs: [job("j1", "c1", { title: "Routine pump-out 1000 gal", total: 450, completedOn: ago(3 * 365 + 20) })] });
    const n = renderNote(oneOpp(scan(ds), "c1", "service_due"), ds.customers[0]!, { ds, sendOn: ASOF }, 1)!;
    expect(n.templateId).toBe("s1");
    expect(n.body).toContain("Every 3 years is the rule of thumb.");
  });
});

describe("a wood deck's stain", () => {
  const deckDs = (...jobs: Job[]) =>
    dataset({ business: { trade: "deck", name: "Kearsarge Deck & Porch", avgJobValue: 12000, minQuoteValue: 800 }, customers: [customer("c1", { firstName: "Paul" }), customer("c2", { firstName: "Dana" })], jobs });

  it("is offered two to three years after a wood build, and never after a composite one", () => {
    const ds = deckDs(
      job("j1", "c1", { title: "New pressure treated deck 14x16", total: 16500, completedOn: ago(800) }),
      job("j2", "c2", { title: "Composite deck 16x20 - Trex", total: 26000, completedOn: ago(800) }),
    );
    const r = scan(ds);
    const stain = oppsFor(r, "c1", "missed_upsell").find((o) => o.serviceId === "deck.stain")!;
    expect(stain).toBeDefined();
    expect(oppsFor(r, "c2", "missed_upsell").map((o) => o.serviceId)).not.toContain("deck.stain");
    const n = renderNote(stain, ds.customers[0]!, { ds, sendOn: ASOF }, 1)!;
    expect(n.body).toContain("When we took care of the new deck for you back in July 2024, we never talked about the deck staining. A wood deck holds up a lot longer when it's stained and sealed every couple of years.");
    expect(n.flags).toEqual([]);
  });

  it("is not offered in the first two years", () => {
    const r = scan(deckDs(job("j1", "c1", { title: "New pressure treated deck 14x16", total: 16500, completedOn: ago(400) })));
    expect(oppsFor(r, "c1", "missed_upsell").map((o) => o.serviceId)).toEqual(["deck.lighting", "deck.pergola"]);
  });

  it("then comes due every 30 months", () => {
    const ds = deckDs(job("j1", "c1", { title: "Deck stain & seal", total: 1600, completedOn: ago(915) }));
    const o = oneOpp(scan(ds), "c1", "service_due");
    expect(o.serviceId).toBe("deck.stain");
    const n = renderNote(o, ds.customers[0]!, { ds, sendOn: ASOF }, 1)!;
    expect(n.body).toContain("We did the deck staining for you back in March 2024, and you're coming up on when it's due again. Every 2½ years is the rule of thumb.");
    expect(n.flags).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The linter                                                          */
/* ------------------------------------------------------------------ */

describe("lint", () => {
  const JOB = "the oak by the driveway";
  const SUBJECT = "the oak by the driveway";
  const note = (extra = "") => `Hi Mike,\n\nIt's Sarah at Ridgeline Tree Co. You got a price from us last May for the oak by the driveway.${extra ? " " + extra : ""} Is it still something you want done?\n\nSarah\n\n${footer(business())}`;
  const ctx = { firstName: "Mike", job: JOB };

  it("passes a plain, clean note", () => {
    expect(lint(SUBJECT, note(), ctx)).toEqual([]);
  });

  /** A sentence that repeats each banned stat. */
  const EXAMPLES: string[] = [
    "80% of sales need five follow-ups.",
    "44% of salespeople give up after one try.",
    "64% of customers say no four times first.",
    "Texting gets 82% higher conversion.",
    "Texts see a 98% open rate.",
    "You're 7x more likely to win it if you call fast.",
    "The Field Service Benchmark shows it.",
    "Lawn care offers a 217% return.",
    "60-70% of estimates die from silence.",
    "Calling back in an hour closes 30-50% more.",
    "Shops see 35% revenue growth in year one.",
    "Only 22% of painting bids ever close.",
    "78% of homeowners hire the first company to respond.",
    "62% of calls to contractors go unanswered.",
    "25-40% of estimates are recoverable.",
    "Keeping 5% more customers means 25 to 95% more profit.",
  ];

  it("has an example for every banned stat", () => {
    expect(EXAMPLES).toHaveLength(BANNED_STATS.length);
  });
  it.each(BANNED_STATS.map((b, i) => [b.text, EXAMPLES[i]!] as const))("flags the banned stat: %s", (text, example) => {
    expect(bannedStatIn(example)).toBe(text);
    const flags = lint(SUBJECT, note(example), ctx);
    expect(flags).toContain(`Repeats an unsourced stat ("${text}")`);
    // in a subject line too
    expect(lint(example.replace(/\.$/, ""), note(), ctx)).toContain(`Repeats an unsourced stat ("${text}")`);
  });
  it("flags any percentage, even a made-up friendly one", () => {
    expect(lint(SUBJECT, note("We could take 15% off."), ctx)).toEqual(["Has a percentage — notes to homeowners never quote stats"]);
    expect(lint(SUBJECT, note("About 5 % of the tree is dead."), ctx)).toEqual(["Has a percentage — notes to homeowners never quote stats"]);
  });
  it("does not mistake a plain number for a stat", () => {
    expect(bannedStatIn("We did 3 oaks on your street.")).toBeUndefined();
    expect(lint(SUBJECT, note("We did 3 oaks on your street last week."), ctx)).toEqual([]);
  });
  it.each([
    ["I hope this email finds you well.", "I hope this email finds you well"],
    ["As a valued customer, we wanted to write.", "valued customer"],
    ["I wanted to touch base.", "touch base"],
    ["We can circle back next week.", "circle back"],
    ["Don't hesitate to call.", "Don't hesitate to"],
    ["I'm reaching out about it.", "I'm reaching out"],
    ["Reply at your earliest convenience.", "at your earliest convenience"],
  ])("flags canned phrasing: %s", (sentence, phrase) => {
    expect(lint(SUBJECT, note(sentence), ctx)).toEqual([`Sounds canned: "${phrase}"`]);
  });
  it("flags links, exclamation marks, missing footer lines and long subjects", () => {
    expect(lint(SUBJECT, note("See www.ridgeline.com for photos."), ctx)).toContain("Has a link — plain notes without links land in the inbox and read like a person");
    expect(lint(SUBJECT, note("Great news!"), ctx)).toContain("Exclamation mark — reads like marketing");
    expect(lint(SUBJECT, note().replace(/\nReply "stop".*$/, ""), ctx)).toContain("Missing the stop line (required)");
    expect(lint(SUBJECT, note().replace(/ · .*\n/, "\n"), ctx)).toContain("Missing the business address (required)");
    expect(lint("x".repeat(61), note(), ctx)).toContain("Subject too long");
    expect(lint(SUBJECT, note("Your {job} is ready."), ctx)).toContain("Unfilled blank: {job}");
  });
});
