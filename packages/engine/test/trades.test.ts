import { describe, expect, it } from "vitest";
import { classifyService, jobPhrase, seasonFit, playbook } from "../src/trades/index.ts";

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
