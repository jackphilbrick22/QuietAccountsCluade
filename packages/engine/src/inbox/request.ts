import { extractEmails, phonesInText } from "../util.ts";

/**
 * A new request the owner forwarded to us: a website contact form, an Angi / Thumbtack / Google / Yelp lead
 * alert, or a plain email from a homeowner. Every shop gets these in its inbox; most sit there until someone
 * has a minute. Forwarding them (by hand or with one Gmail filter) puts them on the same always-on track as a
 * Jobber request: answered from the office 7am to 8pm, and the owner texted who it is.
 *
 * Rules first (labelled form fields, the forwarded message's own sender, the subject line); anything they
 * can't read goes to a person (and, when it's on, a second read by Claude). Never a guess at an email address.
 */
export interface RequestEmail {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  job?: string;
  /** Where it came from, in the owner's words: "Angi", "your website", "a forwarded email". */
  source: string;
  /** "labelled" = read from form fields; "loose" = pieced together from the text. */
  read: "labelled" | "loose";
}

export interface RequestEmailResult {
  lead?: RequestEmail;
  /** Why it isn't a request we can act on, for the operator. */
  why?: string;
}

const SOURCES: [RegExp, string][] = [
  [/\bangi\b|angi\.com|homeadvisor/i, "Angi"],
  [/thumbtack/i, "Thumbtack"],
  [/local ?services|google (lsa|guaranteed|screened)|localservices|ads-noreply@google/i, "Google"],
  [/\byelp\b/i, "Yelp"],
  [/nextdoor/i, "Nextdoor"],
  [/houzz/i, "Houzz"],
  [/\bporch\b/i, "Porch"],
  [/networx/i, "Networx"],
  [/\bbark\.com|\bbark\b/i, "Bark"],
  [/facebook|meta lead/i, "Facebook"],
  [/getjobber|jobber/i, "your Jobber request form"],
  [/wix|squarespace|wordpress|wpforms|gravity ?forms|contact form 7|godaddy|weebly|jotform|formspree|typeform|web ?form|contact form|form submission|website/i, "your website"],
];

/** Addresses that are the platform, not the homeowner. Relay addresses built for replying (Yelp's messaging) stay. */
const NOT_A_PERSON = /^(no-?reply|do-?not-?reply|donotreply|notifications?|alerts?|leads?|support|info|hello|team|mailer-daemon|postmaster|wordpress|forms?|submissions?)@|@(angi|homeadvisor|thumbtack|google|yelp|nextdoor|houzz|porch|networx|bark|facebook|facebookmail|wix|squarespace|jotform|typeform|getjobber|jobber|mailchimp|sendgrid)\.(com|net|io)$/i;

type Field = "name" | "first" | "last" | "email" | "phone" | "address" | "city" | "zip" | "job";
const LABELS: [RegExp, Field][] = [
  [/^(full name|your name|name|customer|customer name|client|client name|contact|contact name|homeowner)$/i, "name"],
  [/^(first name|first)$/i, "first"],
  [/^(last name|last|surname)$/i, "last"],
  [/^(e-?mail|e-?mail address|your e-?mail|customer e-?mail)$/i, "email"],
  [/^(phone|phone number|cell|cell phone|mobile|mobile phone|telephone|tel|best phone|contact number|customer phone)$/i, "phone"],
  [/^(address|street|street address|property address|service address|job address|job location|location|property)$/i, "address"],
  [/^(city|town|city\/town)$/i, "city"],
  [/^(zip|zip code|postal code|zipcode)$/i, "zip"],
  [/^(message|details|comments?|description|project|project details|project description|service|services|service needed|service requested|services needed|what do you need( done)?\??|request|job|job description|job details|how can we help( you)?\??|tell us about your project|task|category|work needed|notes?)$/i, "job"],
];

const clean = (s: string) => s.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();

function labelOf(raw: string): Field | undefined {
  const l = clean(raw).replace(/[:*]+$/, "").trim();
  return LABELS.find(([re]) => re.test(l))?.[1];
}

/** The forwarded message's own headers ("---------- Forwarded message ---------\nFrom: Angi <leads@angi.com>"). */
function forwardedFrom(text: string): string | undefined {
  const m = text.match(/(?:forwarded message|original message|begin forwarded message)[\s\S]{0,200}?\n\s*from:\s*(.+)/i);
  return m?.[1]?.trim();
}

export function readRequestEmail(input: { subject?: string; text: string; from?: string; ignore?: string[] }): RequestEmailResult {
  const subject = clean((input.subject ?? "").replace(/^\s*((fwd?|fw|re)\s*:\s*)+/i, ""));
  const text = input.text.replace(/\r/g, "");
  const inner = forwardedFrom(text);
  const sender = [inner, input.from, subject].filter(Boolean).join(" ");
  const source = SOURCES.find(([re]) => re.test(sender))?.[1] ?? SOURCES.find(([re]) => re.test(text.slice(0, 1500)))?.[1] ?? "a forwarded email";

  // Labelled fields: "Name: Karen", "**Phone** 603…", or a label alone on a line with its value on the next.
  const got: Partial<Record<Field, string>> = {};
  const lines = text.split("\n").map((l) => l.replace(/^[>\s]+/, "").trimEnd());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const kv = line.match(/^\s*\**\s*([A-Za-z][A-Za-z /?-]{1,40}?)\s*\**\s*[:：]\s*(.*)$/);
    if (kv) {
      const f = labelOf(kv[1]!);
      if (!f || got[f]) continue;
      let v = clean(kv[2]!);
      // a message runs on over the next lines until a blank line or another label
      if (f === "job") {
        for (let j = i + 1; j < lines.length && lines[j]!.trim() && !/^\s*\**\s*[A-Za-z][A-Za-z /?-]{1,40}?\s*\**\s*[:：]/.test(lines[j]!); j++) v = `${v} ${clean(lines[j]!)}`.trim();
      }
      if (!v && lines[i + 1]?.trim()) v = clean(lines[i + 1]!);
      if (v) got[f] = v;
      continue;
    }
    const f = labelOf(line);
    if (f && !got[f]) {
      const next = lines.slice(i + 1).find((x) => x.trim());
      if (next && !labelOf(next)) got[f] = clean(next);
    }
  }

  const skip = new Set((input.ignore ?? []).map((e) => e.toLowerCase()));
  const usable = (e: string) => !skip.has(e.toLowerCase()) && !NOT_A_PERSON.test(e);
  const labelledEmail = got.email ? extractEmails(got.email).find(usable) : undefined;
  const looseEmail = extractEmails(text).find(usable);
  // The homeowner writing to the business directly and the owner forwarding it: the inner From is them.
  const innerEmail = inner ? extractEmails(inner).find(usable) : undefined;
  const email = labelledEmail ?? innerEmail ?? looseEmail;
  const phone = (got.phone ? phonesInText(got.phone)[0] : undefined) ?? phonesInText(text)[0];

  let name = got.name ?? ([got.first, got.last].filter(Boolean).join(" ") || undefined);
  if (!name) {
    // "New lead from Karen W.", "Karen Whitfield is looking for tree removal", "Karen Whitfield requested a quote"
    const s = subject.match(/(?:lead|request|message|inquiry|quote request|job request)\s+from\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,2})/) ?? subject.match(/^([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,2})\s+(?:is looking for|needs|wants|requested|sent you)/);
    const fromName = inner?.match(/^"?([^"<@]+?)"?\s*</)?.[1]?.trim();
    name = s?.[1] ?? (innerEmail && fromName && !NOT_A_PERSON.test(innerEmail) ? fromName : undefined);
  }
  let job = got.job;
  if (!job) {
    const s = subject.match(/(?:is looking for|needs|wants|requested)\s+(.+)$/i) ?? subject.match(/^new\s+(.+?)\s+(?:request|lead|job)\b/i);
    job = s?.[1];
  }
  if (!job && innerEmail) {
    // a homeowner's own email: the first real sentence after the forwarded headers
    const body = text.split(/\n\s*\n/).slice(1).map(clean).find((p) => p.length > 15 && !/^(from|to|sent|date|subject|cc):/i.test(p));
    job = body?.slice(0, 280);
  }
  const address = [got.address, got.city, got.zip].filter(Boolean).join(", ") || undefined;
  const read: RequestEmail["read"] = got.name || got.first || got.email || got.phone ? "labelled" : "loose";

  if (!email && !phone) return { why: `No email or phone for the person in this ${source === "a forwarded email" ? "email" : `${source} email`}. ${source === "Thumbtack" || source === "Google" ? `${source} usually keeps their contact in its app: answer them there.` : "Check it by hand."}` };
  if (!name && !job) return { why: "Couldn't tell who's asking or for what." };
  return { lead: { name: name ? name.slice(0, 80) : undefined, email, phone, address: address?.slice(0, 160), job: job ? job.slice(0, 280) : undefined, source, read } };
}
