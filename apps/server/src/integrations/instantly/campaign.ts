/**
 * What a Quiet Accounts campaign looks like inside Instantly, as pure builders (no I/O).
 *
 * Instantly only sends; Quiet Accounts writes each note. So the campaign's step templates hold nothing but
 * variables: step N sends subject {{sN}} and body {{bN}}, and every lead brings its own sN/bN in custom_variables.
 * Instantly can't skip an empty step, so there is one campaign per (business, number of notes).
 *
 * VERIFIED
 *  - POST /api/v2/campaigns body: name, campaign_schedule{ schedules[{ name, timing{from,to "HH:MM"},
 *    days{"0".."6": bool}, timezone(enum) }] }, sequences[{ steps[{ type:"email", delay, delay_unit, variants[{subject, body}] }] }]
 *    (only sequences[0] is used), email_list, daily_limit, daily_max_leads, stop_on_reply, stop_on_auto_reply,
 *    text_only, first_email_text_only, link_tracking, open_tracking, stop_for_company, prioritize_new_leads,
 *    insert_unsubscribe_header, match_lead_esp. `additionalProperties: false`, `name` and `campaign_schedule` required.
 *    https://developer.instantly.ai/api-reference/campaign/create-campaign (spec: https://api.instantly.ai/openapi/api_v2.json)
 *  - `delay` is the wait before sending the NEXT email; `delay_unit` defaults to "days". So step 1's delay is the
 *    gap to step 2. Days are calendar days (weekends count), and a step that falls outside the schedule waits for
 *    the next active window. https://help.instantly.ai/en/articles/7916860-time-to-wait-between-steps
 *    (The Instantly MCP tool's description, "delay before sending this step", contradicts this. We follow the spec
 *    and the help article.)
 *  - Threading: a follow-up step with an EMPTY subject carries over the previous step's subject and goes in the same
 *    thread. A different subject starts a new thread. Follow-ups also go from the same sending account by default.
 *    https://help.instantly.ai/en/articles/7914807-keep-email-sequences-in-the-same-thread
 *  - Bodies are HTML: "Use `<br/>` tags for delivered email line breaks" (variant.body in the spec), and a bare
 *    "\n" is not delivered as a line break. Instantly's own CLI (npm @instantlyai/cli 0.2.7, INSTANTLY.md "Email Body
 *    Formatting — CRITICAL" and src/core/format.ts `bodyToHtml`) converts plain-text body custom variables to
 *    `<div>line</div>`, with `<div><br /></div>` for a blank line. We do the same.
 *  - days: "0" = Sunday, the JS getDay() order. Instantly's CLI default "Mon-Fri" schedule is
 *    {0:false,1..5:true,6:false}.
 *  - daily_max_leads = "The daily maximum new leads to contact". If it is at or above the campaign's daily limit,
 *    only step 1 goes out and follow-ups starve.
 *    https://help.instantly.ai/en/articles/6759494-how-to-prioritize-new-leads-over-follow-ups
 *  - stop_for_company stops the whole domain when one lead replies. It must stay off: our people are homeowners on
 *    gmail.com / yahoo.com.
 *  - Instantly also caps emails per company (domain) per day unless `limit_emails_per_company_override` is
 *    `{ mode: "disabled" }`. Every homeowner on gmail.com is "one company" to it, so every campaign disables it.
 *  - A campaign sends step 1 to new leads only after follow-ups (prioritize_new_leads=false), under
 *    daily_max_leads, email_gap minutes apart plus a random wait, inside its schedule. That is right for a
 *    nurture sequence and wrong for the answer to a new request, so each business has a second, 1-step
 *    "instant" campaign: new leads first, no new-lead cap, minimal gaps, every day 7:00–20:00 local.
 *  - PATCH /api/v2/campaigns/{id} takes the create fields, all optional (`minProperties: 1`): campaign_schedule,
 *    email_list, daily_max_leads... A campaign is made once and kept, so later changes to the schedule or the
 *    inboxes go through it. https://developer.instantly.ai/api-reference/campaign/patch-campaign
 *  - email_list is the inboxes the campaign sends from. A client's campaigns list only the client's own inboxes;
 *    nothing falls back to a server-wide pool.
 *
 * ASSUMED
 *  - The API accepts "" as a follow-up subject, as the UI does. (The spec requires the field and sets no minLength.)
 *  - Custom variables are substituted into the body HTML as-is. So they carry the HTML (escaped text in divs), and
 *    text_only makes Instantly send the plain-text rendering of it.
 *  - Instantly doesn't re-expand "{{...}}" found inside a variable's value.
 *  - daily_limit caps the whole campaign (the spec says "The daily limit for sending emails"; the MCP tool says
 *    per account). We pass the configured number through unchanged, except on a one pass: 30 for each of its inboxes,
 *    the pace's own limit, which each inbox's account daily_limit (PATCH /accounts/{email}) also holds it to.
 *  - A daily_max_leads of 0 might read as "unlimited" (the help article says blank means unlimited), so it is never sent as 0.
 *    The instant campaign leaves it out (blank = unlimited).
 *  - email_gap / random_wait_max are minutes. 0 might read as "use the default", so the instant campaign sends 1.
 */
import { ANSWER_HOURS, FOLLOW_UP_GAPS, INBOX_DAILY, isOnePass, type BusinessProfile } from "@qa/engine";
import type { SequencedLead } from "../../contracts.ts";
import { ProviderError } from "../../contracts.ts";
import { toInstantlyTimezone, type InstantlyTimezone } from "./timezones.ts";

/** Most notes one person gets in one sequence. */
export const MAX_STEPS = 3;
/** Days Instantly waits after note 1 before note 2 (one definition: the engine paces a one pass by it). */
export const STEP2_DELAY_DAYS = FOLLOW_UP_GAPS[0];
/** Days Instantly waits after note 2 before note 3. */
export const STEP3_DELAY_DAYS = FOLLOW_UP_GAPS[1];
/** Instantly's documented max leads per POST /leads/add. */
export const MAX_LEADS_PER_REQUEST = 1000;

/** Custom-variable keys on each lead. Step templates reference sN/bN. The qa_* keys are for us (webhooks, support). */
export const VAR = {
  subject: (step: number) => `s${step}`,
  body: (step: number) => `b${step}`,
  touch: (step: number) => `qa_touch_${step}`,
  businessId: "qa_business_id",
  customerId: "qa_customer_id",
  opportunityId: "qa_opportunity_id",
} as const;

export interface CampaignSettings {
  dailyLimit?: number;
  /** Follow-ups reply in note 1's thread (empty template subject). Default true. */
  threadFollowUps?: boolean;
  /** Instantly `insert_unsubscribe_header` (List-Unsubscribe). Default true. */
  insertUnsubscribeHeader?: boolean;
}

export interface InstantlySchedule {
  schedules: { name: string; timing: { from: string; to: string }; days: Record<string, boolean>; timezone: InstantlyTimezone }[];
}

export interface InstantlyStep {
  type: "email";
  delay: number;
  delay_unit: "days";
  variants: { subject: string; body: string }[];
}

export interface CreateCampaignBody {
  name: string;
  campaign_schedule: InstantlySchedule;
  sequences: { steps: InstantlyStep[] }[];
  email_list?: string[];
  daily_limit?: number;
  daily_max_leads?: number;
  /** Minutes between emails, and the most extra random minutes on top. */
  email_gap?: number;
  random_wait_max?: number;
  stop_on_reply: boolean;
  stop_on_auto_reply: boolean;
  stop_for_company: boolean;
  limit_emails_per_company_override: { mode: "disabled" };
  text_only: boolean;
  first_email_text_only: boolean;
  link_tracking: boolean;
  open_tracking: boolean;
  insert_unsubscribe_header: boolean;
  prioritize_new_leads: boolean;
  match_lead_esp: boolean;
}

/** The lead object for POST /api/v2/leads/add. */
export interface InstantlyLeadInput {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  custom_variables: Record<string, string>;
}

const displayName = (business: Pick<BusinessProfile, "name">) => business.name.replace(/\s+/g, " ").trim();

/**
 * Campaigns are found by name after a restart, so the name carries the business id: two clients with the same name
 * (franchise locations, a test copy of a client) must never share a mailbox, a schedule or a pause.
 */
export function campaignName(business: Pick<BusinessProfile, "id" | "name">, steps: number): string {
  return `QA · ${displayName(business)} · ${business.id} · ${steps}-step`;
}

/** The business's always-open campaign for answers to new requests. */
export function instantCampaignName(business: Pick<BusinessProfile, "id" | "name">): string {
  return `QA · ${displayName(business)} · ${business.id} · instant`;
}

/**
 * The name campaigns had before it carried the business id. A business whose notes already sit in one keeps using
 * it; nobody else is given it (see ensureCampaign).
 */
export function legacyCampaignName(business: Pick<BusinessProfile, "name">, steps: number | "instant"): string {
  return `QA · ${displayName(business)} · ${steps === "instant" ? "instant" : `${steps}-step`}`;
}

export function checkSteps(maxSteps: number): number {
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS) {
    throw new ProviderError(`A sequence must have 1-${MAX_STEPS} notes (got ${maxSteps})`, "instantly");
  }
  return maxSteps;
}

const hhmm = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export function buildSchedule(business: Pick<BusinessProfile, "sendDays" | "sendWindow" | "timezone">, ref?: Date): InstantlySchedule {
  const days = new Set(business.sendDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (days.size === 0) throw new ProviderError("Business has no send days", "instantly");
  const [start, end] = business.sendWindow;
  if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 24 && start < end)) {
    throw new ProviderError(`Bad send window [${start}, ${end}]`, "instantly");
  }
  const dayMap: Record<string, boolean> = {};
  for (let d = 0; d <= 6; d++) dayMap[String(d)] = days.has(d);
  return {
    schedules: [
      {
        name: "Quiet Accounts",
        timing: { from: hhmm(start), to: end === 24 ? "23:59" : hhmm(end) },
        days: dayMap,
        timezone: toInstantlyTimezone(business.timezone, ref),
      },
    ],
  };
}

export function buildSteps(steps: number, threadFollowUps = true): InstantlyStep[] {
  checkSteps(steps);
  const gapAfter = [STEP2_DELAY_DAYS, STEP3_DELAY_DAYS];
  return Array.from({ length: steps }, (_, i) => {
    const n = i + 1;
    const last = n === steps;
    return {
      type: "email",
      // The last step has no next email, so its delay is unused.
      delay: last ? 0 : (gapAfter[i] ?? STEP3_DELAY_DAYS),
      delay_unit: "days",
      variants: [{ subject: n === 1 || !threadFollowUps ? `{{${VAR.subject(n)}}}` : "", body: `{{${VAR.body(n)}}}` }],
    };
  });
}

/**
 * New people per send day so the business's weekly cap holds, leaving room under daily_limit for follow-ups. A one pass
 * gives its pace's busiest day as it is, kept under its campaigns' daily limit (at or above it, follow-ups starve).
 */
export function dailyNewLeads(business: Pick<BusinessProfile, "weeklyNewContacts" | "sendDays" | "plan">, dailyLimit?: number): number | undefined {
  const paced = isOnePass(business.plan) ? business.plan.pace?.dailyNew : undefined;
  if (paced) return Math.max(1, dailyLimit ? Math.min(paced, dailyLimit - 1) : paced);
  const days = new Set(business.sendDays.filter((d) => d >= 0 && d <= 6)).size;
  if (!(business.weeklyNewContacts > 0) || days === 0) return undefined;
  let n = Math.max(1, Math.ceil(business.weeklyNewContacts / days));
  if (dailyLimit && dailyLimit > 0 && n >= dailyLimit) n = Math.max(1, Math.floor(dailyLimit / 2));
  return n;
}

/** What every Quiet Accounts campaign shares: plain text, no tracking, stop on a human reply, no per-company caps. */
function baseBody(name: string, schedule: InstantlySchedule, steps: InstantlyStep[], settings: CampaignSettings): CreateCampaignBody {
  const body: CreateCampaignBody = {
    name,
    campaign_schedule: schedule,
    sequences: [{ steps }],
    stop_on_reply: true,
    // An out-of-office shouldn't end the sequence. The reply still reaches us and the Inbox agent reads it.
    stop_on_auto_reply: false,
    // Homeowners share gmail.com: a "company" is not a household.
    stop_for_company: false,
    limit_emails_per_company_override: { mode: "disabled" },
    text_only: true,
    first_email_text_only: true,
    link_tracking: false,
    open_tracking: false,
    insert_unsubscribe_header: settings.insertUnsubscribeHeader ?? true,
    // Follow-ups first (Instantly's default): a started conversation beats a new one.
    prioritize_new_leads: false,
    match_lead_esp: false,
  };
  if (settings.dailyLimit && settings.dailyLimit > 0) body.daily_limit = settings.dailyLimit;
  return body;
}

/**
 * A client sends only from its own inboxes, so one client's list never spends another's reputation, and never from
 * the cold-email ones. With none there's no campaign to make.
 */
function inboxesOf(business: Pick<BusinessProfile, "name" | "fromEmails">): string[] {
  const inboxes = business.fromEmails ?? [];
  if (!inboxes.length) throw new ProviderError(`${displayName(business)} has no sending inbox of its own`, "instantly");
  return inboxes;
}

/**
 * A one pass sends up to 30 a day from each of its inboxes, follow-ups included (INBOX_DAILY, what its pace counts on),
 * whatever the server's daily limit says; any other client goes by the server's.
 */
function nurtureSettings(business: BusinessProfile, settings: CampaignSettings): CampaignSettings {
  return isOnePass(business.plan) ? { ...settings, dailyLimit: INBOX_DAILY * inboxesOf(business).length } : settings;
}

export function buildCampaignBody(business: BusinessProfile, steps: number, settings: CampaignSettings = {}, ref?: Date): CreateCampaignBody {
  const own = nurtureSettings(business, settings);
  const body = { ...baseBody(campaignName(business, steps), buildSchedule(business, ref), buildSteps(steps, own.threadFollowUps ?? true), own), email_list: inboxesOf(business) };
  const perDay = dailyNewLeads(business, own.dailyLimit);
  if (perDay !== undefined) body.daily_max_leads = perDay;
  return body;
}

/**
 * What a later change to the business moves in a campaign made earlier: its schedule, its inboxes, its new-lead pace
 * (and a one pass's daily limit, which goes with its inboxes).
 */
export function buildCampaignUpdate(business: BusinessProfile, opts: { instant?: boolean }, settings: CampaignSettings = {}, ref?: Date): Pick<CreateCampaignBody, "campaign_schedule" | "email_list" | "daily_limit" | "daily_max_leads"> {
  if (opts.instant) return { campaign_schedule: buildInstantSchedule(business, ref), email_list: inboxesOf(business) };
  const own = nurtureSettings(business, settings);
  const perDay = dailyNewLeads(business, own.dailyLimit);
  return { campaign_schedule: buildSchedule(business, ref), email_list: inboxesOf(business), ...(isOnePass(business.plan) ? { daily_limit: own.dailyLimit } : {}), ...(perDay !== undefined ? { daily_max_leads: perDay } : {}) };
}

/** Every day, ANSWER_HOURS (7:00–20:00) local: a request that lands at night is answered at 7:00. */
export function buildInstantSchedule(business: Pick<BusinessProfile, "timezone">, ref?: Date): InstantlySchedule {
  return buildSchedule({ timezone: business.timezone, sendDays: [0, 1, 2, 3, 4, 5, 6], sendWindow: [ANSWER_HOURS[0], ANSWER_HOURS[1]] }, ref);
}

/** The 1-step campaign that answers a new request within minutes: new leads first, no new-lead cap, minimal gaps. */
export function buildInstantCampaignBody(business: BusinessProfile, settings: CampaignSettings = {}, ref?: Date): CreateCampaignBody {
  return {
    ...baseBody(instantCampaignName(business), buildInstantSchedule(business, ref), buildSteps(1), settings),
    email_list: inboxesOf(business),
    prioritize_new_leads: true,
    email_gap: 1,
    random_wait_max: 1,
  };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain-text note → the HTML Instantly delivers line-for-line (one div per line, `<div><br /></div>` for blank lines). */
export function toInstantlyHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .map((line) => {
      const t = line.trim();
      return t === "" ? "<div><br /></div>" : `<div>${escapeHtml(t)}</div>`;
    })
    .join("");
}

/** A POST /emails/reply body: HTML-escaped text with `<br/>` line breaks (only html carries them). */
export function toReplyHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n?/g, "\n").trim()).replace(/\n/g, "<br/>");
}

/** Subjects are one line of plain text. */
export function cleanSubject(subject: string): string {
  return subject.replace(/\s+/g, " ").trim();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
export const looksLikeEmail = (email: string) => EMAIL_RE.test(email);

/** Why this lead can't go into a campaign with `steps` steps, or undefined when it can. */
export function leadProblem(lead: SequencedLead, steps: number): string | undefined {
  const notes = [...lead.notes].sort((a, b) => a.step - b.step);
  if (notes.length === 0) return "no notes to send";
  if (notes.length !== steps) return `has ${notes.length} note(s) but the campaign has ${steps} step(s)`;
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!;
    if (note.step !== i + 1) return `notes must be steps 1..${notes.length} (found step ${note.step})`;
    if (!note.body.trim()) return `note ${note.step} has an empty body`;
  }
  if (!cleanSubject(notes[0]!.subject)) return "note 1 has no subject";
  return undefined;
}

export function toInstantlyLead(business: Pick<BusinessProfile, "id">, lead: SequencedLead): InstantlyLeadInput {
  const vars: Record<string, string> = {
    [VAR.businessId]: business.id,
    [VAR.customerId]: lead.customerId,
    [VAR.opportunityId]: lead.opportunityId,
  };
  for (const note of lead.notes) {
    vars[VAR.subject(note.step)] = cleanSubject(note.subject);
    vars[VAR.body(note.step)] = toInstantlyHtml(note.body);
    vars[VAR.touch(note.step)] = note.touchId;
  }
  const out: InstantlyLeadInput = { email: normalizeEmail(lead.email), custom_variables: vars };
  if (lead.firstName?.trim()) out.first_name = lead.firstName.trim();
  if (lead.lastName?.trim()) out.last_name = lead.lastName.trim();
  if (lead.companyName?.trim()) out.company_name = lead.companyName.trim();
  return out;
}
