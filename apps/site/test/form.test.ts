import { describe, expect, it } from "vitest";
import { companyFromQuery, netlifyBody, NETLIFY_FIELDS, refFor, signupBody, smsLink, type Signup } from "../src/form.ts";
import { blocks, lawn, rendered } from "./html.ts";

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
    const copy = blocks(rendered("lawn/index.html", lawn), /<form name="start"/, "form");
    expect(copy).toHaveLength(1);
    expect(copy[0]).toMatch(/data-netlify="true" netlify-honeypot="website" hidden/);
    expect([...copy[0]!.matchAll(/<input name="(\w+)">/g)].map((m) => m[1])).toEqual([...NETLIFY_FIELDS]);
  });

  it("?co= fills the company: at most 60 characters, never markup", () => {
    expect(companyFromQuery("?co=Green+Acre+Lawn&n=Pat")).toBe("Green Acre Lawn");
    expect(companyFromQuery("?co=%3Cscript%3Ealert(1)%3C%2Fscript%3E")).toBe("scriptalert(1)/script");
    expect(companyFromQuery(`?co=${"A".repeat(80)}`)).toHaveLength(60);
    expect(companyFromQuery("?co=%20%20Two%0A%20Lines%20")).toBe("Two Lines");
    expect(companyFromQuery("?src=k12")).toBe("");
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
