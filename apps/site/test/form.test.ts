import { describe, expect, it } from "vitest";
import { companyFromQuery, netlifyBody, NETLIFY_FIELDS, numberFromQuery, refFor, signupBody, smsLink, type Signup } from "../src/form.ts";
import { PAGES } from "../src/trades.ts";
import { blocks, rendered } from "./html.ts";

const sign: Signup = { company: "Green Acre Lawn", first: "Pat", cell: "603-555-0122", software: "jobber", trade: "lawn", offer: "monthly", ref: "page=lawn&src=k12", website: "" };

describe("what the start form sends", () => {
  it("/start gets the form's name as `first`, the offer, the trade and the consent", () => {
    expect(signupBody(sign)).toEqual({ company: "Green Acre Lawn", first: "Pat", cell: "603-555-0122", software: "jobber", trade: "lawn", offer: "monthly", consent: true, ref: "page=lawn&src=k12" });
    // the honeypot goes along only when a bot filled it, so the server can drop it quietly
    expect(signupBody({ ...sign, website: "http://spam.example" }).website).toBe("http://spam.example");
  });

  it("Netlify gets the same fields, URL-encoded under the form's name, and its static copy declares every one", () => {
    const sent = new URLSearchParams(netlifyBody({ ...sign, website: "x" }));
    expect(sent.get("form-name")).toBe("start");
    expect([...sent.keys()].filter((k) => k !== "form-name").sort()).toEqual([...NETLIFY_FIELDS].sort());
    expect(sent.get("consent")).toBe("true");
    for (const p of PAGES) {
      const copy = blocks(rendered(`${p.id}/index.html`, p), /<form name="start"/, "form");
      expect(copy, p.id).toHaveLength(1);
      expect(copy[0]).toMatch(/data-netlify="true" netlify-honeypot="website" hidden/);
      expect([...copy[0]!.matchAll(/<input name="(\w+)">/g)].map((m) => m[1])).toEqual([...NETLIFY_FIELDS]);
    }
  });

  it("a one-pass page sends its offer and its trade the same way", () => {
    const tree = { ...sign, company: "Tall Pine Tree", trade: "tree", offer: "one_pass" as const, ref: "page=tree" };
    expect(signupBody(tree)).toMatchObject({ trade: "tree", offer: "one_pass", consent: true });
    expect(new URLSearchParams(netlifyBody(tree)).get("offer")).toBe("one_pass");
  });

  it("?co= fills the company: at most 60 characters, never markup", () => {
    expect(companyFromQuery("?co=Green+Acre+Lawn&n=Pat")).toBe("Green Acre Lawn");
    expect(companyFromQuery("?co=%3Cscript%3Ealert(1)%3C%2Fscript%3E")).toBe("scriptalert(1)/script");
    expect(companyFromQuery(`?co=${"A".repeat(80)}`)).toHaveLength(60);
    expect(companyFromQuery("?co=%20%20Two%0A%20Lines%20")).toBe("Two Lines");
    expect(companyFromQuery("?src=k12")).toBe("");
  });

  it("?q= and ?j= are whole numbers or nothing: never a name, never markup", () => {
    expect(numberFromQuery("?co=Tall+Pine&q=420&j=3100", "q")).toBe(420);
    expect(numberFromQuery("?q=420&j=%243%2C100", "j")).toBe(3100);
    expect(numberFromQuery("?q=419.6", "q")).toBe(420);
    for (const q of ["", "?q=", "?q=0", "?q=-5", "?q=Pat", "?q=4e400", "?j=1"]) expect(numberFromQuery(q, "q"), q).toBeUndefined();
  });

  it("`ref` is the page, ?src= and the UTM tags, cut to the 200 characters /start keeps, and never a name or a cell", () => {
    expect(refFor("lawn", "?co=Green+Acre&n=Pat&cell=6035550122&src=k12&utm_source=instantly&utm_campaign=lawn-oct")).toBe("page=lawn&src=k12&utm_source=instantly&utm_campaign=lawn-oct");
    expect(refFor("lawn", "")).toBe("page=lawn");
    const long = refFor("lawn", `?src=k12&utm_source=instantly&utm_content=${"é".repeat(20)}&utm_term=${"x".repeat(60)}`);
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long).toBe(`page=lawn&src=k12&utm_source=instantly&utm_content=${"%C3%A9".repeat(20)}`);
  });

  it("when it fails, the text to Jack already has his company in it", () => {
    const link = smsLink("O'Brien & Sons", "Pat");
    expect(link.startsWith("sms:+16033407673?&body=")).toBe(true);
    expect(decodeURIComponent(link.split("body=")[1]!)).toBe("Hi Jack, it's Pat at O'Brien & Sons. I tried to sign up on your site and it didn't go through.");
  });
});
