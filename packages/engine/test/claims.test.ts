import { describe, expect, it } from "vitest";
import { bannedStatIn, claim, CLAIMS } from "../src/claims.ts";

/** The only outside numbers and facts the pages may show: each one traceable, none of them a banned stat. */
describe("claims", () => {
  it("every claim has its own id, a source and a link to it, and repeats no banned stat", () => {
    expect(new Set(CLAIMS.map((c) => c.id)).size).toBe(CLAIMS.length);
    for (const c of CLAIMS) {
      expect(c.text.trim(), c.id).not.toBe("");
      expect(c.source.trim(), c.id).not.toBe("");
      expect(c.url, c.id).toMatch(/^https:\/\//);
      expect(bannedStatIn(c.text), c.id).toBeUndefined();
    }
  });

  it("the landscaping lead cost carries both figures and both sources", () => {
    const c = claim("lead-cost-landscaping")!;
    expect(c.text).toBe("A landscaping lead costs about $118 from Google search ads and about $37 from Google's Local Services ads.");
    expect(c.source).toMatch(/LocaliQ/);
    expect(c.source).toMatch(/99 Calls/);
  });

  it("the painting lead cost is LocaliQ's search figure, with LocaliQ's own page", () => {
    const c = claim("lead-cost-painting")!;
    expect(c.text).toBe("A painting request from Google search costs about $138.");
    expect(c.source).toMatch(/^LocaliQ/);
    expect(c.url).toBe("https://localiq.com/blog/home-services-search-advertising-benchmarks/");
  });

  it("the two cleaning figures are MaidCentral's index and our arithmetic on it, and each says its own number", () => {
    const churn = claim("cleaning-churn")!;
    expect(churn.text).toBe("A cleaning company holding steady at 100 regulars loses about 80 a year and replaces them (MaidCentral: 6.89% a month).");
    expect(churn.figure).toBe(6.89);
    // 100 regulars, 6.89% of them a month, for twelve months: about 80
    expect(Math.round((100 * churn.figure! * 12) / 100 / 10) * 10).toBe(80);
    const regular = claim("cleaning-regular-value")!;
    expect(regular.text).toBe("One biweekly client is worth about $5,580 a year.");
    expect(regular.figure).toBe(5580);
    // $214.60 a visit, every other week
    expect(Math.round((214.6 * 26) / 10) * 10).toBe(regular.figure);
    for (const c of [churn, regular]) {
      expect(c.source).toMatch(/^MaidCentral Professional Cleaning Index, Aug 2026/);
      expect(c.url).toBe("https://maidcentral.com/cleaning-industry-statistics-2026/");
      expect(c.caveat).toMatch(/owner-complaints-brief\.md line \d+/);
    }
    expect(churn.source).not.toBe(regular.source);
  });

  it("a claim's figure, where it has one, is the number its text says", () => {
    for (const c of CLAIMS.filter((x) => x.figure !== undefined)) expect(c.text, c.id).toContain(c.figure!.toLocaleString("en-US"));
  });

  it("Jobber facts say only what its Help Center says: two reminders up to 90 days out, and no price for Campaigns", () => {
    expect(claim("jobber-two-reminders")!.text).toMatch(/up to two reminders.*90 days/);
    for (const id of ["jobber-campaigns-not-retroactive", "jobber-campaigns-add-on"]) {
      const c = claim(id)!;
      expect(c.url).toMatch(/^https:\/\/help\.getjobber\.com\//);
      expect(c.text).not.toMatch(/\$\d/);
    }
  });
});
