/**
 * Instantly.ai integration: Instantly sends (mailbox rotation, warmup, schedules); Quiet Accounts decides what is
 * sent and reads every reply.
 *
 * Each module's header lists what was verified in Instantly's docs (with URLs) and what was assumed. Sources used:
 *  - API v2 OpenAPI spec: https://api.instantly.ai/openapi/api_v2.json (indexed at https://developer.instantly.ai/llms.txt)
 *  - Guides: https://developer.instantly.ai/getting-started/authorization ,
 *    https://developer.instantly.ai/getting-started/rate-limit , https://developer.instantly.ai/guides/webhook-events
 *  - Help centre: threading https://help.instantly.ai/en/articles/7914807-keep-email-sequences-in-the-same-thread ,
 *    step delays https://help.instantly.ai/en/articles/7916860-time-to-wait-between-steps
 *  - Instantly's official CLI on npm (@instantlyai/cli 0.2.7): default schedule, body HTML conversion, retry rules.
 *
 * Wiring: createInstantlyProvider({ apiKey: INSTANTLY_API_KEY, sendingAccounts: INSTANTLY_SENDING_ACCOUNTS split on
 * commas, dailyLimit: INSTANTLY_DAILY_LIMIT }). On boot, call provider.ensureWebhooks(webhookUrlFor(PUBLIC_URL,
 * WEBHOOK_SECRET)). Mount POST `${INSTANTLY_WEBHOOK_PATH}/:secret`, check it with webhookSecretMatches, dedupe with
 * instantlyWebhookKey, then call parseInstantlyWebhook. The worker (core/backstop.ts) also reads received emails
 * the webhooks missed and resumes webhooks Instantly disabled.
 */
export { InstantlyClient, INSTANTLY_API_BASE, type InstantlyClientOptions, type RequestOptions, type Sleep } from "./client.ts";
export {
  MAX_STEPS,
  STEP2_DELAY_DAYS,
  STEP3_DELAY_DAYS,
  MAX_LEADS_PER_REQUEST,
  VAR,
  buildCampaignBody,
  buildInstantCampaignBody,
  buildInstantSchedule,
  buildSchedule,
  buildSteps,
  campaignName,
  dailyNewLeads,
  instantCampaignName,
  toInstantlyHtml,
  toInstantlyLead,
  toReplyHtml,
  type CreateCampaignBody,
  type InstantlyLeadInput,
} from "./campaign.ts";
export { INSTANTLY_TIMEZONES, toInstantlyTimezone, type InstantlyTimezone } from "./timezones.ts";
export {
  DEFAULT_WEBHOOK_EVENTS,
  INSTANTLY_WEBHOOK_PATH,
  SUBSCRIBABLE_EVENT_TYPES,
  ensureWebhooks,
  htmlToText,
  instantlyWebhookKey,
  isInstantlyAutoReply,
  parseInstantlyWebhook,
  resumeDisabledWebhooks,
  webhookSecretMatches,
  webhookUrlFor,
  type EnsureWebhooksResult,
  type InstantlyWebhookPayload,
} from "./webhooks.ts";
export { addressesIn, recipientsOf, toPlatformEmail, type InstantlyEmail } from "./emails.ts";
export { createInstantlyProvider, type InstantlyProvider, type InstantlyProviderOptions } from "./provider.ts";
