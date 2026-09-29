import { describe, expect, it } from "vitest";
import { emailRisk, sendableEmail } from "@qa/engine";
import { createMailCheck } from "../src/providers/mailcheck.ts";

const err = (code: string) => Object.assign(new Error(code), { code });

describe("mail domain check", () => {
  it("accepts a domain with MX records", async () => {
    const check = createMailCheck({ lookupMx: async () => [{ exchange: "mx.example.net", priority: 10 }], lookupA: async () => [] });
    expect(await check("gooddomain.com")).toBe("ok");
  });
  it("flags a domain that doesn't exist", async () => {
    const check = createMailCheck({ lookupMx: async () => { throw err("ENOTFOUND"); }, lookupA: async () => { throw err("ENOTFOUND"); } });
    expect(await check("closed-isp.net")).toBe("no_mail");
  });
  it("flags a null MX (RFC 7505)", async () => {
    const check = createMailCheck({ lookupMx: async () => [{ exchange: ".", priority: 0 }] });
    expect(await check("nomail.org")).toBe("no_mail");
  });
  it("falls back to an A record when there's no MX", async () => {
    const check = createMailCheck({ lookupMx: async () => { throw err("ENODATA"); }, lookupA: async () => ["203.0.113.5"] });
    expect(await check("smallhost.com")).toBe("ok");
  });
  it("never blocks on a DNS hiccup", async () => {
    const check = createMailCheck({ lookupMx: async () => { throw err("ETIMEOUT"); } });
    expect(await check("slow-dns.com")).toBe("unknown");
  });
  it("caches per domain", async () => {
    let calls = 0;
    const check = createMailCheck({ lookupMx: async () => { calls++; return [{ exchange: "mx", priority: 1 }]; } });
    await check("a.com");
    await check("A.com");
    expect(calls).toBe(1);
  });
});

describe("address risk", () => {
  it("catches typos of the big providers and suggests the fix", () => {
    expect(emailRisk("mark@gmial.com")).toEqual({ ok: false, reason: "looks like a typo of gmail.com", suggestion: "mark@gmail.com" });
    expect(emailRisk("ann@hotmial.com").ok).toBe(false);
  });
  it("rejects placeholders and throwaway inboxes", () => {
    expect(emailRisk("none@none.com").ok).toBe(false);
    expect(emailRisk("noemail@gmail.com").ok).toBe(false);
    expect(emailRisk("x@mailinator.com").ok).toBe(false);
  });
  it("allows role inboxes but prefers a personal one", () => {
    expect(emailRisk("info@smithfamily.com")).toEqual({ ok: true, role: true });
    expect(sendableEmail(["info@smithfamily.com", "jane@smithfamily.com"])).toBe("jane@smithfamily.com");
    expect(sendableEmail(["info@smithfamily.com"])).toBe("info@smithfamily.com");
  });
  it("skips suppressed addresses", () => {
    expect(sendableEmail(["jane@x.com", "j2@x.com"], { "jane@x.com": "bounced" })).toBe("j2@x.com");
    expect(sendableEmail(["jane@x.com"], { "jane@x.com": "unsubscribed" })).toBeUndefined();
  });
});
