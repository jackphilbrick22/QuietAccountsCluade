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

  it("Jobber facts say only what its Help Center says: two reminders up to 90 days out, and no price for Campaigns", () => {
    expect(claim("jobber-two-reminders")!.text).toMatch(/up to two reminders.*90 days/);
    for (const id of ["jobber-campaigns-not-retroactive", "jobber-campaigns-add-on"]) {
      const c = claim(id)!;
      expect(c.url).toMatch(/^https:\/\/help\.getjobber\.com\//);
      expect(c.text).not.toMatch(/\$\d/);
    }
  });
});
