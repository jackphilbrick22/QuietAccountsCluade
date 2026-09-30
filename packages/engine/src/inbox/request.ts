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
  /** Only a person can decide (two people in one forward): no second read guesses either. */
  final?: boolean;
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

/** Mailbox providers anyone can have an address at: never read as "the business's own domain". */
const FREE_MAIL = /^(gmail|googlemail|ymail|rocketmail|aol|icloud|me|mac|msn|comcast|verizon|att|sbcglobal|bellsouth|charter|cox|earthlink|frontier|optonline|rr|roadrunner|twc|windstream|centurylink|juno|netzero|protonmail|proton|pm|gmx|mail|zoho|fastmail|hey|myfairpoint|q)\.(com|net|me)$|^(yahoo|hotmail|outlook|live)\.[a-z.]+$/i;

const HEADER_LINE = /^\**\s*(from|date|sent|subject|to|cc|bcc|reply-to)\s*\**\s*:/i;

/**
 * Each forwarded message's own header block ("From: …", "Date: …", "Subject: …", "To: …"), outermost first.
 * A "From:" with no other header under it is a form's field, not a message. `end` is the first line after it.
 */
function headerBlocks(lines: string[]): { from: string; start: number; end: number; to: string[] }[] {
  const out: { from: string; start: number; end: number; to: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^\**\s*from\s*\**\s*:\s*\**\s*(.*)$/i);
    if (!m) continue;
    let j = i + 1;
    let others = 0;
    const to: string[] = [];
    let field = "";
    // headers run until a blank line; a wrapped To:/Cc: list carries on without a label
    for (; j < lines.length && lines[j]!.trim(); j++) {
      const h = lines[j]!.match(HEADER_LINE);
      if (h) {
        others++;
        field = h[1]!.toLowerCase();
      } else if (!(/^(to|cc|bcc)$/.test(field) && /@/.test(lines[j]!) && !/[:：]/.test(lines[j]!))) break;
      if (/^(to|cc|bcc|reply-to)$/.test(field)) to.push(...extractEmails(lines[j]!));
    }
    if (!others) continue;
    out.push({ from: m[1]!.trim(), start: i, end: j, to });
    i = j - 1;
  }
  return out;
}

/**
 * One of the business's own addresses: listed in `ignore`, or at one of `ignoreDomains` exactly (a free mailbox
 * domain like gmail.com never counts as theirs, whoever's address it came from; a platform's relay subdomain, like
 * Yelp's messaging one, isn't the business's either).
 */
export function isBusinessAddress(email: string, own: { ignore?: string[]; ignoreDomains?: string[] }): boolean {
  const e = email.toLowerCase().trim();
  if ((own.ignore ?? []).some((x) => x.toLowerCase().trim() === e)) return true;
  const domain = e.split("@")[1] ?? "";
  return (own.ignoreDomains ?? []).map((x) => x.toLowerCase().trim().replace(/^@/, "")).some((dm) => dm === domain && dm.includes(".") && !FREE_MAIL.test(dm));
}

export function readRequestEmail(input: {
  subject?: string;
  text: string;
  from?: string;
  /** The business's own addresses (and the forwarder's): never the person asking. */
  ignore?: string[];
  /** The business's own domains: nobody at them is the person asking. Free mailbox domains (gmail.com…) are skipped. */
  ignoreDomains?: string[];
  /** The business's own numbers (the owner's cell, the shop line): never the person asking. */
  ignorePhones?: string[];
}): RequestEmailResult {
  const subject = clean((input.subject ?? "").replace(/^\s*((fwd?|fw|re)\s*:\s*)+/i, ""));
  const text = input.text.replace(/\r/g, "");
  const all = text.split("\n").map((l) => l.replace(/^[>\s]+/, "").trimEnd());
  // A forward (or a forward of a forward): the person is in the innermost message. The forwarder's own words and
  // signature above it, and every forwarded header block (To:, Cc:), are the business's, never the lead's.
  const blocks = headerBlocks(all);
  // Two or more people (not the business, not a platform) in the chain: a property manager forwarding a tenant, an
  // office forwarding a customer from a personal address. Which one is asking is a person's call, never a guess.
  const people = [...new Set(blocks.map((b) => extractEmails(b.from)[0]).filter((e): e is string => !!e && !NOT_A_PERSON.test(e) && !isBusinessAddress(e, input) && !(input.ignore ?? []).some((x) => x.toLowerCase() === e)))];
  if (people.length > 1) return { why: `This forward has more than one person in it (${people.slice(0, 3).join(", ")}). Check who's asking and answer them by hand.`, final: true };
  const innermost = blocks.at(-1);
  const inner = innermost?.from;
  const lines = innermost ? all.slice(innermost.end) : all;
  const body = lines.join("\n");
  const sender = [inner, input.from, subject].filter(Boolean).join(" ");
  const source = SOURCES.find(([re]) => re.test(sender))?.[1] ?? SOURCES.find(([re]) => re.test(body.slice(0, 1500)))?.[1] ?? "a forwarded email";

  // Labelled fields: "Name: Karen", "**Phone** 603…", or a label alone on a line with its value on the next.
  const got: Partial<Record<Field, string>> = {};
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

  const usable = (e: string) => !NOT_A_PERSON.test(e) && !isBusinessAddress(e, input);
  // who the forwarded messages were addressed to (the business, the next forwarder), wherever they turn up again
  const addressed = new Set(blocks.flatMap((b) => b.to));
  const labelledEmail = got.email ? extractEmails(got.email).find(usable) : undefined;
  const looseEmail = extractEmails(body).find((e) => usable(e) && !addressed.has(e));
  // The homeowner writing to the business directly and the owner forwarding it: the innermost From is them.
  const innerEmail = inner ? extractEmails(inner).find(usable) : undefined;
  const email = labelledEmail ?? innerEmail ?? looseEmail;
  const ten = (p: string) => p.replace(/\D/g, "").slice(-10);
  const ownPhones = new Set((input.ignorePhones ?? []).map(ten).filter((p) => p.length === 10));
  const theirs = (p: string) => !ownPhones.has(ten(p));
  const phone = (got.phone ? phonesInText(got.phone).find(theirs) : undefined) ?? phonesInText(body).find(theirs);

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
    // a homeowner's own email: the first real sentence after the innermost forwarded headers
    const first = body.split(/\n\s*\n/).map(clean).find((p) => p.length > 15 && !HEADER_LINE.test(p));
    job = first?.slice(0, 280);
  }
  const address = [got.address, got.city, got.zip].filter(Boolean).join(", ") || undefined;
  const read: RequestEmail["read"] = got.name || got.first || got.email || got.phone ? "labelled" : "loose";

  if (!email && !phone) return { why: `No email or phone for the person in this ${source === "a forwarded email" ? "email" : `${source} email`}. ${source === "Thumbtack" || source === "Google" ? `${source} usually keeps their contact in its app: answer them there.` : "Check it by hand."}` };
  if (!name && !job) return { why: "Couldn't tell who's asking or for what." };
  return { lead: { name: name ? name.slice(0, 80) : undefined, email, phone, address: address?.slice(0, 160), job: job ? job.slice(0, 280) : undefined, source, read } };
}
