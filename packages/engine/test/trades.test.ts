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
  it("knows seasons by climate", () => {
    const aer = playbook("lawn").services.find((s) => s.id === "lawn.aerate")!;
    expect(seasonFit(aer, "cold", 9)).toBe("now");
    expect(seasonFit(aer, "cold", 7)).toBe("soon");
    expect(seasonFit(aer, "cold", 1)).toBe("off");
    const removal = playbook("tree").services[0]!;
    expect(seasonFit(removal, "cold", 1)).toBe("now");
  });
});
