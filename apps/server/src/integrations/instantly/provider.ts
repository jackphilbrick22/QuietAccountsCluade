/**
 * Instantly as the Quiet Accounts sending engine (SequencerProvider).
 * Instantly owns mailbox rotation, warmup and send timing; we own every word and read every reply.
 *
 * VERIFIED (spec: https://api.instantly.ai/openapi/api_v2.json)
 *  - GET  /api/v2/campaigns?search=&limit<=100&starting_after= → { items: Campaign[], next_starting_after }.
 *    `search` is "Search by campaign name". Campaign.status: 0 Draft, 1 Active, 2 Paused, 3 Completed,
 *    4 Running Subsequences, -1 Accounts Unhealthy, -2 Bounce Protect, -99 Account Suspended.
 *    https://developer.instantly.ai/api-reference/campaign/list-campaign
 *  - POST /api/v2/campaigns → Campaign (id, status). GET /api/v2/campaigns/{id} → Campaign incl. sequences.
 *  - POST /api/v2/campaigns/{id}/activate and /pause (no body) → Campaign.
 *    https://developer.instantly.ai/api-reference/campaign/activatestart-or-resume-a-campaign ,
 *    https://developer.instantly.ai/api-reference/campaign/stopor-pause-a-campaign
 *  - POST /api/v2/leads/add: 1..1000 leads to exactly one of campaign_id / list_id. Lead fields: email, first_name,
 *    last_name, company_name, custom_variables (string|number|boolean|null values; keys get registered on the
 *    campaign). Flags: skip_if_in_workspace (overrides the other skip_if flags), skip_if_in_campaign,
 *    skip_if_in_list, verify_leads_on_import. It checks the workspace blocklist. Response: total_sent,
 *    leads_uploaded, in_blocklist, duplicated_leads, skipped_count, invalid_email_count, duplicate_email_count,
 *    created_leads[{ index, id, email }]. Counts only, so skip reasons are per batch, not per email.
 *    https://developer.instantly.ai/api-reference/lead/add-leads-in-bulk-to-a-campaign-or-list
 *  - POST /api/v2/leads/list { campaign, contacts: [emails], limit<=100, starting_after } → { items: Lead[] }.
 *    Lead.status: 1 Active, 2 Paused, 3 Completed, -1 Bounced, -2 Unsubscribed, -3 Skipped; also email_reply_count.
 *    https://developer.instantly.ai/api-reference/lead/list-leads
 *  - DELETE /api/v2/leads/{id} deletes one lead. CAUTION: DELETE /api/v2/leads with only campaign_id deletes EVERY
 *    lead in the campaign, so it is never used here.
 *    https://developer.instantly.ai/api-reference/lead/delete-lead , .../lead/delete-leads-in-bulk
 *  - POST /api/v2/block-lists-entries { bl_value } (email or domain) → entry. GET ?search= lists entries.
 *    https://developer.instantly.ai/api-reference/blocklistentry/create-block-list-entry
 *  - A deleted lead that gets re-uploaded restarts at step 1, and Instantly recommends not deleting leads that
 *    replied. https://help.instantly.ai/en/articles/13886841-why-follow-ups-are-still-sending-to-leads-who-replied
 *    So stopLead keeps leads Instantly has already stopped, which keeps reply tracking and the workspace skip intact.
 *
 * ASSUMED
 *  - A new campaign is a Draft (status 0) and a campaign whose leads all finished becomes Completed (3). Neither
 *    sends to new leads until activated, so upsertLeads activates 0/3 after adding leads (activateDrafts). It never
 *    resumes a campaign someone Paused (2).
 *  - Campaign-name search may be fuzzy, so we filter for an exact name. Two businesses with the same name would share
 *    a lookup on cold start. The in-memory cache is keyed by business id and is not affected.
 *  - A POST /block-lists-entries for an existing entry errors (400/409). We then confirm it via ?search= and treat it
 *    as done.
 *  - After a lead replies, Instantly (stop_on_reply) stops it: it moves to Completed and/or email_reply_count > 0.
 */
import type { BusinessProfile } from "@qa/engine";
import type { Fetch, SequencerProvider } from "../../contracts.ts";
import { ProviderError } from "../../contracts.ts";
import {
  toInstantlyHtml,
  MAX_LEADS_PER_REQUEST,
  buildCampaignBody,
  campaignName,
  checkSteps,
  leadProblem,
  looksLikeEmail,
  normalizeEmail,
  toInstantlyLead,
  type CampaignSettings,
  type InstantlyLeadInput,
} from "./campaign.ts";
import { InstantlyClient, INSTANTLY, type Sleep } from "./client.ts";
import { ensureWebhooks, type EnsureWebhooksResult } from "./webhooks.ts";

export interface InstantlyProviderOptions {
  apiKey: string;
  fetch?: Fetch;
  sleep?: Sleep;
  /** Mailboxes the campaign rotates through (Instantly `email_list`). */
  sendingAccounts?: string[];
  /** Instantly campaign `daily_limit`. */
  dailyLimit?: number;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  random?: () => number;
  /** Follow-ups reply in note 1's thread (empty template subject). Default true. */
  threadFollowUps?: boolean;
  /** Instantly `insert_unsubscribe_header`. Default true. */
  insertUnsubscribeHeader?: boolean;
  /**
   * Instantly `skip_if_in_workspace` on upload. Default false: one workspace serves many businesses, and a
   * homeowner can be a customer of two of them. Per-business dedupe is ours; Instantly never adds an email to one campaign twice.
   */
  skipIfInWorkspace?: boolean;
  /** Activate a Draft/Completed campaign once it has leads. Never resumes a Paused one. Default true. */
  activateDrafts?: boolean;
  /** Leads per POST /leads/add, capped at Instantly's 1000. */
  leadsPerRequest?: number;
  /** "Now" for timezone offset matching. */
  now?: () => Date;
}

export type InstantlyProvider = SequencerProvider & {
  readonly client: InstantlyClient;
  /** Register workspace webhooks → url. Idempotent (lists first). Defaults to ["all_events"]. */
  ensureWebhooks(url: string, events?: readonly string[], opts?: { name?: string; headers?: Record<string, string> }): Promise<EnsureWebhooksResult>;
  /** The campaign name ensureCampaign uses. */
  campaignName(business: Pick<BusinessProfile, "name">, steps: number): string;
};

type StopReason = Parameters<SequencerProvider["stopLead"]>[3];

interface InstantlyCampaign {
  id: string;
  name?: string;
  status?: number;
  timestamp_created?: string;
  sequences?: { steps?: unknown[] }[];
}

interface InstantlyLead {
  id: string;
  email?: string | null;
  campaign?: string | null;
  status?: number;
  email_reply_count?: number;
}

interface AddLeadsResponse {
  leads_uploaded?: number;
  in_blocklist?: number;
  duplicated_leads?: number;
  skipped_count?: number;
  invalid_email_count?: number;
  duplicate_email_count?: number;
  created_leads?: { index: number; id: string; email?: string | null }[];
}

const CAMPAIGN = { draft: 0, active: 1, paused: 2, completed: 3 } as const;
const LEAD = { active: 1, paused: 2 } as const;
const BLOCKLIST_REASONS: ReadonlySet<StopReason> = new Set(["unsubscribed", "bounced", "complained"]);

export function createInstantlyProvider(opts: InstantlyProviderOptions): InstantlyProvider {
  const client = new InstantlyClient({
    apiKey: opts.apiKey,
    fetch: opts.fetch,
    sleep: opts.sleep,
    baseUrl: opts.baseUrl,
    timeoutMs: opts.timeoutMs,
    maxRetries: opts.maxRetries,
    random: opts.random,
  });
  const settings: CampaignSettings = {
    sendingAccounts: opts.sendingAccounts,
    dailyLimit: opts.dailyLimit,
    threadFollowUps: opts.threadFollowUps ?? true,
    insertUnsubscribeHeader: opts.insertUnsubscribeHeader ?? true,
  };
  const skipIfInWorkspace = opts.skipIfInWorkspace ?? false;
  const activateDrafts = opts.activateDrafts ?? true;
  const chunkSize = Math.min(MAX_LEADS_PER_REQUEST, Math.max(1, opts.leadsPerRequest ?? MAX_LEADS_PER_REQUEST));
  const now = opts.now ?? (() => new Date());

  /** `${businessId}:${steps}` → campaign id. */
  const campaignIds = new Map<string, string>();
  const inflight = new Map<string, Promise<string>>();

  const campaignPath = (id: string) => `/campaigns/${encodeURIComponent(id)}`;

  async function findCampaignByName(name: string): Promise<InstantlyCampaign | undefined> {
    const matches: InstantlyCampaign[] = [];
    for await (const c of client.paginate<InstantlyCampaign>("/campaigns", { search: name }, { maxPages: 5 })) {
      if (c?.id && c.name?.trim() === name) matches.push(c);
    }
    // Oldest first: if a retried create ever made a twin, everyone keeps converging on the same one.
    matches.sort((a, b) => (a.timestamp_created ?? "").localeCompare(b.timestamp_created ?? ""));
    return matches[0];
  }

  async function resolveCampaign(business: BusinessProfile, steps: number): Promise<string> {
    const name = campaignName(business, steps);
    const found = await findCampaignByName(name);
    if (found) return found.id;
    const body = buildCampaignBody(business, steps, settings, now());
    try {
      const created = await client.post<InstantlyCampaign>("/campaigns", body, { idempotent: false });
      if (!created?.id) throw new ProviderError(`Instantly created "${name}" but returned no id`, INSTANTLY);
      return created.id;
    } catch (e) {
      // The create may have landed before the failure; look once more before giving up.
      if (e instanceof ProviderError && e.retryable) {
        const again = await findCampaignByName(name).catch(() => undefined);
        if (again) return again.id;
      }
      throw e;
    }
  }

  async function getCampaign(campaignId: string): Promise<{ steps: number; status?: number }> {
    let c: InstantlyCampaign;
    try {
      c = await client.get<InstantlyCampaign>(campaignPath(campaignId));
    } catch (e) {
      // Deleted in Instantly: forget it so the next ensureCampaign resolves (or creates) it again.
      if (e instanceof ProviderError && e.status === 404) {
        for (const [key, id] of campaignIds) if (id === campaignId) campaignIds.delete(key);
      }
      throw e;
    }
    const steps = c?.sequences?.[0]?.steps?.length ?? 0;
    if (!steps) throw new ProviderError(`Instantly campaign ${campaignId} has no sequence steps`, INSTANTLY);
    return { steps, status: c.status };
  }

  /** Emails (lowercased) from `emails` that are already leads in this campaign. */
  async function emailsInCampaign(campaignId: string, emails: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < emails.length; i += 100) {
      const res = await client.post<{ items?: InstantlyLead[] }>(
        "/leads/list",
        { campaign: campaignId, contacts: emails.slice(i, i + 100), limit: 100 },
        { idempotent: true },
      );
      for (const lead of res?.items ?? []) if (lead.email) found.add(normalizeEmail(lead.email));
    }
    return found;
  }

  function skipReason(res: AddLeadsResponse, missing: number): string {
    const parts: [number, string][] = [
      [res.in_blocklist ?? 0, "on the Instantly blocklist"],
      [res.skipped_count ?? 0, skipIfInWorkspace ? "already a lead elsewhere in the Instantly workspace" : "already in another campaign or list"],
      [res.duplicated_leads ?? 0, "already in this campaign"],
      [res.invalid_email_count ?? 0, "Instantly rejected the address as invalid"],
      [res.duplicate_email_count ?? 0, "duplicated in the upload"],
    ];
    const hits = parts.filter(([n]) => n > 0);
    if (hits.length === 1 && hits[0]![0] >= missing) return hits[0]![1];
    if (hits.length === 0) return "not added by Instantly (no reason given)";
    return `not added by Instantly (${hits.map(([n, why]) => `${n} ${why}`).join("; ")})`;
  }

  async function blocklist(email: string): Promise<void> {
    try {
      await client.post("/block-lists-entries", { bl_value: email }, { idempotent: true });
    } catch (e) {
      if (!(e instanceof ProviderError) || !(e.status === 400 || e.status === 409 || e.status === 422)) throw e;
      // Probably already blocked. Confirm; otherwise surface the real error.
      const res = await client.get<{ items?: { bl_value?: string }[] }>("/block-lists-entries", { search: email, limit: 100 });
      if (!(res?.items ?? []).some((it) => it.bl_value && normalizeEmail(it.bl_value) === email)) throw e;
    }
  }

  const provider: InstantlyProvider = {
    kind: "sequencer",
    name: INSTANTLY,
    client,
    campaignName,

    async ensureCampaign(business, { maxSteps }) {
      const steps = checkSteps(maxSteps);
      const key = `${business.id}:${steps}`;
      const cached = campaignIds.get(key);
      if (cached) return { campaignId: cached };
      let pending = inflight.get(key);
      if (!pending) {
        pending = resolveCampaign(business, steps).finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      const campaignId = await pending;
      campaignIds.set(key, campaignId);
      return { campaignId };
    },

    async upsertLeads(business, campaignId, leads) {
      const skipped: { email: string; why: string }[] = [];
      if (leads.length === 0) return { added: 0, skipped };
      const campaign = await getCampaign(campaignId);

      const ready: InstantlyLeadInput[] = [];
      const seen = new Set<string>();
      for (const lead of leads) {
        const email = normalizeEmail(lead.email ?? "");
        if (!looksLikeEmail(email)) {
          skipped.push({ email: lead.email, why: "invalid email address" });
          continue;
        }
        if (seen.has(email)) {
          skipped.push({ email: lead.email, why: "duplicate email in this upload" });
          continue;
        }
        seen.add(email);
        const problem = leadProblem(lead, campaign.steps);
        if (problem) {
          skipped.push({ email: lead.email, why: problem });
          continue;
        }
        ready.push(toInstantlyLead(business, lead));
      }

      let added = 0;
      for (let i = 0; i < ready.length; i += chunkSize) {
        const chunk = ready.slice(i, i + chunkSize);
        const res = await client.post<AddLeadsResponse>(
          "/leads/add",
          { campaign_id: campaignId, leads: chunk, skip_if_in_workspace: skipIfInWorkspace, verify_leads_on_import: false },
          // Re-sending the same batch is harmless: Instantly never adds the same email to a campaign twice.
          { idempotent: true },
        );
        let missing: InstantlyLeadInput[];
        if (Array.isArray(res?.created_leads)) {
          const createdIdx = new Set(res.created_leads.map((c) => c.index));
          missing = chunk.filter((_, idx) => !createdIdx.has(idx));
        } else {
          missing = (res?.leads_uploaded ?? 0) >= chunk.length ? [] : chunk;
        }
        added += chunk.length - missing.length;
        if (missing.length === 0) continue;
        // Idempotency: a person already in THIS campaign (an earlier or retried upload) counts as added, not skipped.
        const already = await emailsInCampaign(campaignId, missing.map((m) => m.email));
        const why = skipReason(res ?? {}, missing.length - already.size);
        for (const m of missing) {
          if (already.has(m.email)) added++;
          else skipped.push({ email: m.email, why });
        }
      }

      if (activateDrafts && added > 0 && (campaign.status === CAMPAIGN.draft || campaign.status === CAMPAIGN.completed)) {
        await client.post(`${campaignPath(campaignId)}/activate`, undefined, { idempotent: true });
      }
      return { added, skipped };
    },

    async stopLead(_business, campaignId, rawEmail, reason) {
      const email = normalizeEmail(rawEmail);
      if (!looksLikeEmail(email)) throw new ProviderError(`Can't stop "${rawEmail}": not an email address`, INSTANTLY);
      // Blocklist first: it is the compliance-critical half, and it also stops any other campaign.
      if (BLOCKLIST_REASONS.has(reason)) await blocklist(email);

      const res = await client.post<{ items?: InstantlyLead[] }>(
        "/leads/list",
        { campaign: campaignId, contacts: [email], limit: 100 },
        { idempotent: true },
      );
      const leads = (res?.items ?? []).filter((l) => l.id && l.email && normalizeEmail(l.email) === email && (!l.campaign || l.campaign === campaignId));
      for (const lead of leads) {
        const stillSending = lead.status === undefined || lead.status === LEAD.active || lead.status === LEAD.paused;
        const instantlySawReply = reason === "replied" && (lead.email_reply_count ?? 0) > 0;
        // Leave leads Instantly already stopped: deleting them breaks reply tracking and lets a re-upload restart step 1.
        if (!stillSending || instantlySawReply) continue;
        try {
          await client.delete(`/leads/${encodeURIComponent(lead.id)}`);
        } catch (e) {
          if (!(e instanceof ProviderError && e.status === 404)) throw e;
        }
      }
    },

    // POST /emails/reply: answer in the same thread from the mailbox that received it. `to` makes Instantly
    // check the thread's recipient before sending, so a wrong id can never mail the wrong person.
    async replyTo(_business, thread, text) {
      await client.post("/emails/reply", {
        reply_to_uuid: thread.replyEmailId,
        eaccount: thread.account,
        subject: thread.subject,
        to: thread.to,
        body: { text, html: toInstantlyHtml(text) },
      });
    },

    async pauseCampaign(_business, campaignId, paused) {
      await client.post(`${campaignPath(campaignId)}/${paused ? "pause" : "activate"}`, undefined, { idempotent: true });
    },

    ensureWebhooks(url, events, webhookOpts) {
      return ensureWebhooks(client, url, events, webhookOpts);
    },
  };
  return provider;
}
