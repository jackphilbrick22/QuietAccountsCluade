/**
 * The seams between the Quiet Accounts core and the outside world.
 * Every integration implements one of these; the core never imports a vendor SDK directly.
 */
import type { BusinessProfile, Customer, Invoice, Job, Quote, ServiceRequest, Touch } from "@qa/engine";

/* ------------------------------------------------------------------ */
/* Outbound email                                                      */
/* ------------------------------------------------------------------ */

export interface OutboundMessage {
  businessId: string;
  touchId: string;
  customerId: string;
  to: string;
  toName: string;
  fromName: string;
  /** The sending mailbox. For "direct" providers this is the From address. */
  fromEmail?: string;
  replyTo?: string;
  subject: string;
  /** Plain text. We never send HTML: plain notes read like a person and land in the primary inbox. */
  text: string;
  /** Thread follow-ups onto the first note. */
  inReplyTo?: string;
  references?: string[];
  /** RFC 8058 one-click unsubscribe target. */
  unsubscribeUrl?: string;
}

export interface SendResult {
  /** Provider message id (used to match replies to notes). */
  providerId: string;
  /** RFC 5322 Message-ID when the provider exposes it. */
  messageId?: string;
}

/**
 * "direct": we decide when each note goes and hand it to the provider (SMTP, Gmail, Postmark...).
 * "sequencer": a cold-email platform (Instantly) owns mailbox rotation, warmup and send timing;
 *              we push each person with their pre-written notes and it reports back via webhooks.
 */
export type OutboundProvider = DirectProvider | SequencerProvider;

export interface DirectProvider {
  kind: "direct";
  name: string;
  send(msg: OutboundMessage): Promise<SendResult>;
}

/** One person's full sequence, rendered by the Writer. */
export interface SequencedLead {
  customerId: string;
  opportunityId: string;
  email: string;
  firstName: string;
  lastName: string;
  companyName?: string;
  /** Notes in order; step 1 first. dueAt is our planned local time (a sequencer may shift it). */
  notes: { touchId: string; step: number; subject: string; body: string; dueAt: string }[];
}

export interface SequencerProvider {
  kind: "sequencer";
  name: string;
  /**
   * Make sure the business has a campaign ready to receive leads; returns its id. `instant` is the business's
   * separate 1-step campaign for answers to new requests: it sends new leads first, uncapped, every day 7:00–20:00.
   */
  ensureCampaign(business: BusinessProfile, opts: { maxSteps: number; instant?: boolean }): Promise<{ campaignId: string }>;
  /** Add or update leads (idempotent by email). */
  upsertLeads(business: BusinessProfile, campaignId: string, leads: SequencedLead[]): Promise<{ added: number; skipped: { email: string; why: string }[] }>;
  /**
   * Stop everything for one address (reply, stop, bounce) and blocklist it where supported. "withdrawn" is us taking
   * back notes that shouldn't go (the owner cancelled, moved them, or marked the person do-not-contact): no blocklist.
   */
  stopLead(business: BusinessProfile, campaignId: string, email: string, reason: "replied" | "unsubscribed" | "bounced" | "complained" | "withdrawn"): Promise<void>;
  pauseCampaign(business: BusinessProfile, campaignId: string, paused: boolean): Promise<void>;
  /** Answer a reply in its own thread, from the mailbox it came in on. Refuses when the thread isn't addressed to `to`. */
  replyTo?(business: BusinessProfile, thread: { replyEmailId: string; account: string; to: string; subject: string }, text: string): Promise<void>;
  /** Emails the platform received since `since` (ISO): the backstop for replies its webhooks never announced. */
  receivedSince?(since: string, opts: { folder: "primary" | "others" }): Promise<PlatformEmail[]>;
  /** The emails in one thread (to tie a reply from an unknown address to the person we wrote to). */
  threadEmails?(threadId: string): Promise<PlatformEmail[]>;
  /** Re-enable webhooks the platform disabled after failed deliveries. Returns the ones resumed. */
  resumeWebhooks?(): Promise<{ id: string; url: string; eventType?: string }[]>;
  /** Register our webhook with the platform (idempotent). */
  registerWebhooks?(url: string): Promise<unknown>;
}

/** One email in the sending platform's inbox. */
export interface PlatformEmail {
  id: string;
  threadId?: string;
  from: string;
  /** The lead the platform filed it under (may differ from `from`: a spouse, a forward). */
  lead?: string;
  to: string[];
  /** Our mailbox it came in on. */
  account?: string;
  subject?: string;
  text: string;
  receivedAt: string;
  /** When the platform recorded it (its reply detection can lag the email by hours). */
  createdAt: string;
  campaignId?: string;
  sentByUs: boolean;
}

/* ------------------------------------------------------------------ */
/* Inbound events (normalized from any provider's webhooks)            */
/* ------------------------------------------------------------------ */

export type InboundEvent =
  | {
      type: "reply";
      businessId?: string;
      campaignId?: string;
      from: string;
      subject?: string;
      text: string;
      receivedAt: string;
      inReplyTo?: string;
      /** The thread's earlier Message-IDs (References header), oldest first. */
      references?: string[];
      /** Who it was addressed to (our reply-to inboxes), when known. */
      to?: string[];
      providerLeadId?: string;
      /** RFC Message-ID of their reply (direct mail), so our answer threads under it. */
      messageId?: string;
      /** Sequencer: the provider's id for their reply email, and our mailbox that received it. */
      replyEmailId?: string;
      toAccount?: string;
      /** Sequencer: the record the lead was uploaded for (our lead variable), when there's no thread to go by. */
      customerId?: string;
      /** Sequencer: the exact note answered (our qa_touch_N lead variable). */
      touchId?: string;
    }
  | { type: "sent"; businessId?: string; campaignId?: string; email: string; step?: number; providerId?: string; sentAt: string; touchId?: string }
  | { type: "bounce"; businessId?: string; campaignId?: string; email: string; at: string; detail?: string }
  | { type: "unsubscribe"; businessId?: string; campaignId?: string; email: string; at: string }
  | { type: "complaint"; businessId?: string; campaignId?: string; email: string; at: string }
  /** A sending mailbox broke (disconnected, suspended): nothing from it goes out until someone fixes it. */
  | { type: "account_error"; businessId?: string; campaignId?: string; account?: string; detail?: string; at: string };

/* ------------------------------------------------------------------ */
/* Owner notifications (texts to the business owner)                   */
/* ------------------------------------------------------------------ */

export interface OwnerNotifier {
  name: string;
  /** Send a text (or email fallback) to the owner. Returns a provider id. */
  notify(to: { phone?: string; email?: string }, text: string): Promise<{ id: string; channel: "sms" | "email" | "log" }>;
}

/* ------------------------------------------------------------------ */
/* Field-service software connections (Jobber, Housecall Pro, ...)     */
/* ------------------------------------------------------------------ */

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** ISO time the access token expires. */
  expiresAt?: string;
  accountId?: string;
  accountName?: string;
  scope?: string;
}

/** Records pulled straight from the software's API, already in engine shape. */
export interface PulledRecords {
  customers: Customer[];
  quotes: Quote[];
  jobs: Job[];
  invoices: Invoice[];
  requests: ServiceRequest[];
  /** Cursor/high-water mark for the next incremental pull (e.g. max updatedAt). */
  nextSince?: string;
  /** Anything the sync wants a human to know (rate limited, partial page, schema drift). */
  warnings: string[];
}

export interface FsmConnector {
  source: "jobber" | "housecall_pro" | "servicetitan";
  /** URL to send the owner to for consent. `state` is our signed business token. */
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  refresh(tokens: OAuthTokens): Promise<OAuthTokens>;
  /** Full backfill when `since` is undefined, else incremental. Must page and respect rate limits. */
  pull(tokens: OAuthTokens, opts: { since?: string; maxPages?: number; onProgress?: (msg: string) => void }): Promise<PulledRecords>;
  /** Verify a webhook request's signature. */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean;
  /** Parse a webhook payload into "something about this record changed". */
  parseWebhook(rawBody: string): { topic: string; accountId: string; itemId: string; occurredAt: string } | undefined;
  /** Leave a note on the customer/quote so the office sees what happened (reply text, booked, stop). */
  writeNote?(tokens: OAuthTokens, target: { kind: "client" | "quote"; sourceId: string }, text: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Helpers shared by providers                                         */
/* ------------------------------------------------------------------ */

export type Fetch = typeof fetch;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly retryable = false,
    /** The provider may have taken the message before failing (a timeout after DATA): never resend blindly. */
    readonly maybeSent = false,
  ) {
    super(message);
  }
}

export function touchToLeadNote(t: Touch) {
  return { touchId: t.id, step: t.step, subject: t.subject ?? "", body: t.body, dueAt: t.dueAt };
}
