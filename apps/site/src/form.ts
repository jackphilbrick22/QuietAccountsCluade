/**
 * What the start form sends, kept apart from the page so it can be tested without one. Page URLs carry only business
 * info (?co=, ?q=, ?j=, ?src=, UTM tags); the owner's name and cell only ever travel in the form's own POST.
 */
export const JACK = { text: "603-340-7673", tel: "+16033407673" };

export interface Signup {
  company: string;
  /** The form's "Your first name": /start calls it `first`, and signs the notes with it. */
  first: string;
  cell: string;
  software: string;
  trade: string;
  offer: "monthly" | "one_pass";
  ref: string;
  /** The honeypot: a field people can't see. Anything in it is a bot. */
  website: string;
}

/** The body /start takes. Consent is the box he ticked; the form never sends without it. */
export function signupBody(s: Signup): Record<string, string | true> {
  return {
    company: s.company,
    first: s.first,
    cell: s.cell,
    software: s.software,
    trade: s.trade,
    offer: s.offer,
    consent: true,
    ...(s.ref ? { ref: s.ref } : {}),
    ...(s.website ? { website: s.website } : {}),
  };
}

/** Every field the static copy of the form declares, so Netlify keeps all of them. */
export const NETLIFY_FIELDS = ["company", "first", "cell", "software", "trade", "offer", "consent", "ref", "website"] as const;

/** The same fields for Netlify Forms: URL-encoded, posted to "/" under the form's name. */
export function netlifyBody(s: Signup): string {
  return new URLSearchParams({ "form-name": "start", ...Object.fromEntries(Object.entries(signupBody(s)).map(([k, v]) => [k, String(v)])) }).toString();
}

/** `?co=` from our own links: the company, at most 60 characters. It only ever goes into a field or text, never HTML. */
export function companyFromQuery(search: string): string {
  return (new URLSearchParams(search).get("co") ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
}

/** `?q=` (his quote count, estimated from his public reviews) and `?j=` (his average job): a whole number, or nothing. */
export function numberFromQuery(search: string, key: "q" | "j"): number | undefined {
  const v = Number(new URLSearchParams(search).get(key)?.replace(/[$,\s]/g, ""));
  return Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
}

/** `ref`: the page, then any ?src= and UTM tags, cut to the 200 characters /start keeps (whole tags only). */
export function refFor(page: string, search: string): string {
  const ref = new URLSearchParams({ page });
  for (const [k, v] of new URLSearchParams(search)) if (k === "src" || k.startsWith("utm_")) ref.append(k, v);
  const all = ref.toString();
  return all.length <= 200 ? all : all.slice(0, all.lastIndexOf("&", 200));
}

/** When the send fails: a text to Jack with his company already in it, so the lead is never lost. */
export function smsLink(company: string, first: string): string {
  const body = `Hi Jack, it's ${first} at ${company}. I tried to sign up on your site and it didn't go through.`;
  return `sms:${JACK.tel}?&body=${encodeURIComponent(body)}`;
}
