import { describe, expect, it } from "vitest";
import { classifyService, detectTrade, jobPhrase, seasonFit, playbook, PLAYBOOKS } from "../src/trades/index.ts";
import { CATALOG } from "../src/sample/catalog.ts";
import { lint } from "../src/copy/lint.ts";
import { footer } from "../src/copy/render.ts";
import { bannedStatIn, lintMarketing } from "../src/claims.ts";
import type { TradeId } from "../src/model.ts";
import { business } from "./fixtures.ts";

const ALL_TRADES = (Object.keys(PLAYBOOKS) as TradeId[]).filter((t) => t !== "general");
/** A shop's titles, repeated so every title is a real share of the export. */
const shop = (...titles: [string, number][]) => titles.flatMap(([t, n]) => Array<string>(n).fill(t));

describe("trade playbooks", () => {
  it("phrases jobs the way people talk", () => {
    expect(jobPhrase("Oak removal + stump", "tree")).toBe("the oak");
    expect(jobPhrase("Two pines over garage", "tree")).toBe("the pines over the garage");
    expect(jobPhrase("Crown thinning, 3 maples", "tree")).toBe("the maples");
    expect(jobPhrase("Hazard ash near house", "tree")).toBe("the ash over the house");
    expect(jobPhrase("Stump grinding x3", "tree")).toBe("the stumps");
    expect(jobPhrase("Pump out 1000 gal tank", "septic")).toBe("the pump-out");
    expect(jobPhrase("Effluent pump replacement", "septic")).toBe("the effluent pump");
    expect(jobPhrase("Routine pumping", "septic")).toBe("the pump-out");
    expect(jobPhrase("150 ft 6' cedar privacy", "fence")).toBe("the privacy fence");
    expect(jobPhrase("Replace driveway 24x40", "concrete")).toBe("the driveway");
    expect(jobPhrase("Something odd", "tree")).toBe("the tree work");
  });
  it("classifies services with repair/hazard words winning over materials", () => {
    expect(classifyService("Oak removal + stump", [], ["tree"]).service.id).toBe("tree.removal");
    expect(classifyService("Stump grinding x3", [], ["tree"]).service.id).toBe("tree.stump");
    expect(classifyService("Vinyl fence repair", [], ["fence"]).service.id).toBe("fence.repair");
    expect(classifyService("150 ft cedar privacy fence", [], ["fence"]).service.id).toBe("fence.install");
    expect(classifyService("Pump out + riser", [], ["septic"]).service.id).toBe("septic.pump");
    expect(classifyService("Fall aeration & overseed", [], ["lawn"]).service.id).toBe("lawn.aerate");
    expect(classifyService("House wash + gutters", [], ["pressure_washing"]).service.id).toBe("pw.house");
  });
  it("never counts across line items or units: a line item repeating the title stays singular", () => {
    const li = (name: string) => [{ name, total: 0 }];
    expect(jobPhrase("AC replacement - 3 ton", "hvac", li("AC replacement"))).toBe("the AC");
    expect(jobPhrase("Lot clearing 1/2 acre", "tree", li("Lot clearing 1/2 acre"))).toBe("the lot");
    expect(jobPhrase("Fence repair - 2 sections", "fence", li("Fence repair - 2 sections"))).toBe("the fence");
    expect(jobPhrase("Replace 2 AC units", "hvac")).toBe("the ACs");
    expect(jobPhrase("Remove 2 cherry trees", "tree")).toBe("the cherries");
    // a service phrase never takes an "s": "the house washs"
    expect(jobPhrase("2 house washes", "pressure_washing")).toBe("the house wash");
  });
  it("deadwood and limb removal are pruning, not a take-down", () => {
    expect(classifyService("Deadwood removal - large oak", [], ["tree"]).service.id).toBe("tree.prune_oak");
    expect(classifyService("Dead limb removal over roof", [], ["tree"]).service.id).toBe("tree.prune");
    expect(classifyService("Branch removal - maple", [], ["tree"]).service.id).toBe("tree.prune");
    expect(classifyService("Dead ash removal", [], ["tree"]).service.id).toBe("tree.removal");
  });
  it("knows seasons by climate", () => {
    const aer = playbook("lawn").services.find((s) => s.id === "lawn.aerate")!;
    expect(seasonFit(aer, "cold", 9)).toBe("now");
    expect(seasonFit(aer, "cold", 7)).toBe("soon");
    expect(seasonFit(aer, "cold", 1)).toBe("off");
    const removal = playbook("tree").services[0]!;
    expect(seasonFit(removal, "cold", 1)).toBe("now");
  });
});

describe("holiday lighting", () => {
  const svc = (title: string, items: string[] = []) => classifyService(title, items.map((name) => ({ name, total: 0 })), ["holiday_lighting"]).service.id;

  it("tells the install from the takedown, a permanent system and its add-ons", () => {
    expect(svc("Christmas lights - roofline")).toBe("light.install");
    expect(svc("Holiday lighting - roofline + 2 trees")).toBe("light.install");
    // a package that includes the takedown is still the install
    expect(svc("Christmas lights install + takedown")).toBe("light.install");
    expect(svc("Christmas lights", ["Roofline C9 warm white", "Takedown & storage"])).toBe("light.install");
    expect(svc("Holiday lighting - roofline + takedown & storage")).toBe("light.install");
    expect(svc("Christmas light takedown & storage")).toBe("light.takedown");
    expect(svc("Takedown - roofline + 2 trees")).toBe("light.takedown");
    expect(svc("Light removal")).toBe("light.takedown");
    expect(svc("Permanent lighting - front roofline")).toBe("light.permanent");
    expect(svc("Roofline permanent lights")).toBe("light.permanent");
    expect(svc("Permanent lighting add-on - garage")).toBe("light.addon");
    expect(svc("Bistro string lights - backyard party")).toBe("light.event");
  });

  it("names the lights the way people do", () => {
    expect(jobPhrase("Christmas lights - roofline", "holiday_lighting")).toBe("the roofline lights");
    expect(jobPhrase("Mini lights - front tree wrap", "holiday_lighting")).toBe("the lights on the front tree");
    expect(jobPhrase("Wrap 2 front trees", "holiday_lighting")).toBe("the lights on the front trees");
    expect(jobPhrase("Wreath x2", "holiday_lighting")).toBe("the wreaths");
    expect(jobPhrase("Garland on porch railing", "holiday_lighting")).toBe("the garland");
    expect(jobPhrase("Porch lights - holiday", "holiday_lighting")).toBe("the lights on the porch");
    expect(jobPhrase("Holiday lights - driveway + walkway", "holiday_lighting")).toBe("the lights along the driveway");
    expect(jobPhrase("Permanent lighting - front roofline", "holiday_lighting")).toBe("the permanent lights");
    expect(jobPhrase("Permanent lighting add-on - garage", "holiday_lighting")).toBe("extending the permanent lights");
    expect(jobPhrase("Christmas light takedown & storage", "holiday_lighting")).toBe("the light takedown");
    expect(jobPhrase("Holiday lighting package", "holiday_lighting")).toBe("the holiday lights");
    expect(jobPhrase("Smith residence", "holiday_lighting")).toBe("the lights");
  });

  it("sells August to December on a yearly clock, with a timing line that is plain fact", () => {
    const install = playbook("holiday_lighting").services.find((s) => s.id === "light.install")!;
    expect(seasonFit(install, "cold", 9)).toBe("now");
    expect(seasonFit(install, "cold", 7)).toBe("soon");
    expect(seasonFit(install, "cold", 3)).toBe("off");
    expect([install.reserviceMonths, install.kind, install.dueAsk]).toEqual([12, "maintenance", "Want the lights up again this year?"]);
    expect(install.timingLine?.cold).toBe("Most of our install dates for November fill in October.");
    expect(install.followOns?.map((f) => f.serviceId)).toEqual(["light.permanent"]);
    expect(playbook("holiday_lighting").services.find((s) => s.id === "light.permanent")!.followOns?.map((f) => f.serviceId)).toEqual(["light.addon"]);
  });
});

describe("decks", () => {
  const svc = (title: string) => classifyService(title, [], ["deck"]).service.id;

  it("classifies builds, composite, replacements, railings, covers, staining, repairs and lighting", () => {
    expect(svc("New pressure treated deck 14x16")).toBe("deck.build");
    expect(svc("Cedar deck with stairs")).toBe("deck.build");
    expect(svc("Composite deck 16x20 - Trex")).toBe("deck.composite");
    expect(svc("Composite deck replacement")).toBe("deck.composite");
    expect(svc("Deck replacement - cedar")).toBe("deck.replace");
    expect(svc("Tear out and rebuild deck")).toBe("deck.replace");
    expect(svc("Deck railing - aluminum + new stairs")).toBe("deck.railing");
    expect(svc("Trex railing")).toBe("deck.railing");
    expect(svc("Pergola 12x14")).toBe("deck.pergola");
    expect(svc("Screened porch on existing deck")).toBe("deck.pergola");
    expect(svc("Deck stain & seal")).toBe("deck.stain");
    expect(svc("Deck repair - rotted boards + joists")).toBe("deck.repair");
    expect(svc("Replace 6 deck boards")).toBe("deck.repair");
    expect(svc("Post cap lights")).toBe("deck.lighting");
  });

  it("follows a wood deck with a stain two to three years on, and never a composite one", () => {
    const pb = playbook("deck");
    const next = (id: string) => pb.services.find((s) => s.id === id)!.followOns?.map((f) => [f.serviceId, f.afterDays]) ?? [];
    expect(next("deck.build")).toEqual([["deck.stain", [730, 1095]], ["deck.lighting", [14, 540]], ["deck.pergola", [60, 540]]]);
    expect(next("deck.replace")).toEqual([["deck.stain", [730, 1095]]]);
    expect(next("deck.composite").map(([id]) => id)).toEqual(["deck.lighting", "deck.pergola"]);
    const stain = pb.services.find((s) => s.id === "deck.stain")!;
    expect([stain.kind, stain.reserviceMonths]).toEqual(["maintenance", 30]);
    expect(pb.services.find((s) => s.id === "deck.repair")!.kind).toBe("repair");
  });

  it("names the job", () => {
    expect(jobPhrase("New pressure treated deck 14x16", "deck")).toBe("the new deck");
    expect(jobPhrase("Composite deck 16x20 - Trex", "deck")).toBe("the composite deck");
    expect(jobPhrase("New deck + pergola", "deck")).toBe("the new deck");
    expect(jobPhrase("Deck stain & seal", "deck")).toBe("the deck staining");
    expect(jobPhrase("Gazebo in back yard", "deck")).toBe("the gazebo in the backyard");
    expect(jobPhrase("16x20 deck", "deck")).toBe("the deck");
  });
});

describe("painting", () => {
  const pb = playbook("painting");
  const svc = (title: string) => classifyService(title, [], ["painting"]).service.id;
  const byId = (id: string) => pb.services.find((s) => s.id === id)!;

  it.each([
    ["Exterior house painting", "paint.exterior"],
    ["Exterior repaint - 2 story colonial", "paint.exterior"],
    ["Siding + soffits", "paint.exterior"],
    ["Interior - 3 rooms", "paint.interior"],
    ["Living room, hallway + ceilings", "paint.interior"],
    ["Kitchen walls", "paint.interior"],
    ["Kitchen cabinet painting", "paint.cabinets"],
    ["Bathroom vanity", "paint.cabinets"],
    ["Deck stain", "paint.deck"],
    ["Fence stain & seal", "paint.deck"],
    ["Front door + trim", "paint.trim"],
    ["Baseboards and doors", "paint.trim"],
    ["Exterior trim + shutters", "paint.exterior"],
    ["Drywall patch + paint", "paint.drywall"],
    ["Water damage ceiling repair", "paint.drywall"],
    ["Power wash prep", "paint.wash"],
    ["Exterior repaint - power wash, scrape, prime, 2 coats", "paint.exterior"],
  ])("%s is %s", (title, id) => {
    expect(svc(title)).toBe(id);
  });

  it("names the job the way a homeowner would", () => {
    expect(jobPhrase("Exterior house painting", "painting")).toBe("the exterior painting");
    expect(jobPhrase("Kitchen cabinet painting", "painting")).toBe("the cabinets");
    expect(jobPhrase("Interior - 3 rooms", "painting")).toBe("the interior painting");
    expect(jobPhrase("Paint 3 bedrooms", "painting")).toBe("the bedrooms");
    expect(jobPhrase("Front door + trim", "painting")).toBe("the front door");
    expect(jobPhrase("House power wash", "painting")).toBe("the power washing");
    expect(jobPhrase("Deck stain", "painting")).toBe("the deck");
  });

  it("repaints come around on honest clocks; cabinets, trim and repairs have none", () => {
    expect([byId("paint.exterior").reserviceMonths, byId("paint.interior").reserviceMonths, byId("paint.deck").reserviceMonths]).toEqual([72, 60, 30]);
    for (const id of ["paint.cabinets", "paint.trim", "paint.drywall"]) expect(byId(id).reserviceMonths).toBeUndefined();
    expect(byId("paint.cabinets").kind).toBe("improvement");
    expect(byId("paint.drywall").kind).toBe("repair");
  });

  it("exterior season runs May to October in cold climates; inside work any time", () => {
    const ext = byId("paint.exterior");
    expect(ext.season.cold).toEqual([5, 6, 7, 8, 9, 10]);
    expect(seasonFit(ext, "cold", 2)).toBe("off");
    expect(seasonFit(ext, "cold", 7)).toBe("now");
    expect(seasonFit(byId("paint.interior"), "cold", 1)).toBe("now");
    expect(seasonFit(byId("paint.interior"), "cold", 7)).toBe("now");
  });

  it("timing lines are plain and only go out in the months they're true", () => {
    const ext = byId("paint.exterior");
    expect(ext.timingLine?.cold).toBe("Spring exterior dates usually book up by April.");
    // a spring line is only true while spring is still ahead
    expect(ext.timingMonths?.cold).toEqual([1, 2, 3]);
    const int = byId("paint.interior");
    expect(int.timingLine?.cold).toBe("Winter is a good time for inside work: no weather delays.");
    expect(int.timingMonths?.cold).toEqual([11, 12, 1, 2, 3]);
  });

  it("offers exterior clients the inside, and a stain after the house; a patch leads to the room", () => {
    const next = (id: string) => byId(id).followOns?.map((f) => f.serviceId) ?? [];
    expect(next("paint.exterior")).toEqual(["paint.interior", "paint.deck"]);
    expect(byId("paint.exterior").followOns![0]!.pitch).toBe("We paint inside too, if there are any rooms you've been meaning to get to.");
    expect(next("paint.drywall")).toEqual(["paint.interior"]);
    expect(next("paint.cabinets")).toEqual([]);
  });

  it("knows why painting quotes die and works them without a price cut", () => {
    const why = pb.whyQuotesDie.join(" | ");
    expect(why).toMatch(/three or more bids/);
    expect(why).toMatch(/budget/);
    expect(why).toMatch(/spring/);
    expect(why).toMatch(/spouse/);
    expect(pb.quoteAngles).toEqual(["check_in", "timing", "revise", "crew_nearby", "close_file"]);
  });
});

describe("the first answer asks what the owner needs", () => {
  it("never asks what the request already says", async () => {
    const { intakeAsk } = await import("../src/copy/render.ts");
    const req = (title: string) => ({ id: "r1", customerId: "c1", title, status: "new" as const, rawStatus: "new" });
    const who = { id: "c1", sourceIds: [], name: "Megan Ortiz", firstName: "Megan", lastName: "Ortiz", emails: [], phones: [], properties: [], tags: [] };
    expect(intakeAsk(business({ trade: "cleaning" }), req("Deep clean, 3 bed 2 bath, we have a dog"), who)).toBe("");
    expect(intakeAsk(business({ trade: "cleaning" }), req("Need a house cleaning"), who)).toContain("bedrooms");
    expect(intakeAsk(business({ trade: "fence" }), req("About 160 ft of cedar privacy fence"), who)).toBe("");
    expect(intakeAsk(business({ trade: "fence" }), req("New fence for the back yard"), who)).toContain("how many feet");
  });
  it("each main trade has one short intake question; everything else asks nothing extra", () => {
    expect(playbook("tree").intakeAsk).toBe("If it's easy, reply with a photo or two{andAddress}.");
    expect(playbook("fence").intakeAsk).toBe("If you can, reply with roughly how many feet, the material you're thinking of, any gates, and whether there's an HOA.");
    expect(playbook("painting").intakeAsk).toBe("Is it inside or outside, and when are you hoping to have it done?");
    expect(playbook("cleaning").intakeAsk).toBe("How many bedrooms and bathrooms, is it a one-time clean or regular, and any pets?");
    expect(playbook("septic").intakeAsk).toBeUndefined();
    for (const t of ALL_TRADES) {
      for (const ask of [playbook(t).intakeAsk, playbook(t).intakeAskNamed].filter((x): x is string => !!x)) {
        // one sentence, and never a price or a date
        expect(ask.match(/[.?](\s|$)/g)?.length).toBe(1);
        expect(ask).not.toMatch(/\$|\d|price|cost|quote|today|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday/i);
      }
    }
  });
});

describe("reading the trade from their own titles", () => {
  it("every trade reads as itself from its sample titles, with no second trade", () => {
    for (const trade of ALL_TRADES) {
      const d = detectTrade((CATALOG[trade] ?? []).flatMap((i) => Array<string>(i.weight).fill(i.title)));
      expect([trade, d.trade, d.others]).toEqual([trade, trade, []]);
    }
  });

  it("a lighting shop reads as holiday lighting, even though its titles name the roofline and the trees", () => {
    const d = detectTrade(
      shop(
        ["Christmas lights - roofline", 8],
        ["Holiday lighting - roofline + 2 trees", 6],
        ["Christmas light installation", 5],
        ["C9 roofline + wreath", 3],
        ["Permanent lighting - front roofline", 3],
        ["Christmas light takedown & storage", 3],
        ["Wrap 3 trees - mini lights", 3],
      ),
    );
    expect(d.trade).toBe("holiday_lighting");
    expect(d.others).toEqual([]);
    expect(d.counts.roofing ?? 0).toBe(0);
    expect(d.counts.tree ?? 0).toBe(0);
  });

  it("Christmas lights are never read as general, landscape or roofing work", () => {
    const d = detectTrade(shop(["Christmas lights", 3], ["Christmas lights install", 2], ["Xmas lights - roofline", 2]));
    expect(d.trade).toBe("holiday_lighting");
    expect(d.confidence).toBe(1);
  });

  it("a deck builder reads as decks, with no second trade from staining, washing or pressure-treated lumber", () => {
    const d = detectTrade(
      shop(
        ["New pressure treated deck 14x16", 6],
        ["Composite deck 16x20 - Trex", 5],
        ["Deck replacement - cedar", 4],
        ["Deck stain & seal", 6],
        ["Deck clean & seal", 3],
        ["Pergola 12x14", 3],
        ["Deck repair - rotted boards", 4],
        ["Pressure treated deck stairs", 3],
      ),
    );
    expect(d.trade).toBe("deck");
    expect(d.others).toEqual([]);
    expect(d.counts.pressure_washing ?? 0).toBeLessThan(2);
  });

  it("a painting shop that stains decks still reads as painting", () => {
    expect(detectTrade(shop(["Deck stain", 10], ["Exterior house painting", 6], ["Interior - 3 rooms", 5], ["Kitchen cabinet painting", 3]))).toMatchObject({ trade: "painting", others: [] });
  });

  it("washing decks, working over decks or lighting a patio keeps a shop's own trade", () => {
    expect(detectTrade(shop(["House wash - soft wash", 8], ["Deck wash", 6], ["Deck cleaning", 4], ["Driveway & walks", 5]))).toMatchObject({ trade: "pressure_washing", others: [] });
    expect(detectTrade(shop(["Remove oak over deck", 6], ["Prune maple by the deck", 4], ["Stump grinding x3", 5]))).toMatchObject({ trade: "tree", others: [] });
    expect(detectTrade(shop(["Landscape lighting - 12 fixtures", 6], ["Paver patio 14x16", 5], ["Front bed redesign + mulch", 5]))).toMatchObject({ trade: "landscape", others: [] });
  });

  it("a landscaper who hangs lights every fall has lighting as a second line of work", () => {
    expect(detectTrade(shop(["Spring cleanup + mulch", 12], ["Paver patio 14x16", 6], ["Christmas lights - roofline", 8]))).toMatchObject({ trade: "landscape", others: ["holiday_lighting"] });
  });
});

describe("what every trade says to a homeowner", () => {
  /** Every line a playbook can put in a note: timing, why waiting hurts, why it waits, the due question, follow-on pitches. */
  const lines = (t: TradeId) =>
    [
      ...playbook(t).services.flatMap((s) => [...Object.values(s.timingLine ?? {}), s.worseIfWaiting, s.waitLine, s.dueAsk, ...(s.followOns ?? []).flatMap((f) => [f.pitch, f.ask])]),
      playbook(t).intakeAsk?.replace("{andAddress}", " and the address"),
      playbook(t).intakeAskNamed,
    ].filter((x): x is string => !!x);
  const SCARCITY = /\b(only \d+|spots? left|slots? left|last chance|hurry|act fast|book (now|today|by)|before (it'?s|they'?re) gone|deadline|expires?|while (they|supplies) last|risk[- ]free)\b/i;

  it.each(ALL_TRADES)("%s: plain lines, with no stats, no scarcity and nothing a spam filter flags", (trade) => {
    for (const line of lines(trade)) {
      const body = `Hi Mike,\n\nIt's Sarah at the company. ${line}\n\nWant a price? Reply and I'll put one together.\n\nSarah\n\n${footer(business())}`;
      expect([line, lint("a note", body, { firstName: "Mike", job: "", requireJob: false })]).toEqual([line, []]);
      expect([line, lintMarketing(line)]).toEqual([line, []]);
      expect(bannedStatIn(line)).toBeUndefined();
      expect(line).not.toMatch(SCARCITY);
    }
  });
});
