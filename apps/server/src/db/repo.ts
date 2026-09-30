import { createHash } from "node:crypto";
import type { AccountState, AgentEvent, BusinessProfile, Opportunity, OwnerMessage, Recovery, Reply, Touch } from "@qa/engine";
import type { OutreachRecord } from "@qa/engine";
import type { Db } from "./sqlite.ts";

/** A loaded account plus what each record looked like when loaded (to write back only changes). */
export interface Loaded {
  state: AccountState;
  paused: boolean;
  hashes: Map<string, string>;
  eventIds: Set<string>;
  messageIds: Set<string>;
  suppressionKeys: Set<string>;
  scannedAt?: string;
  /**
   * The dataset arrays as of the last save. Imports and syncs replace these arrays (never edit records in
   * place), so when every array is the same object with the same length, no record changed and the
   * 10k-row hash pass is skipped. That keeps a send (one touch changes) cheap.
   */
  savedArrays?: unknown[][];
  savedLengths?: number[];
  /** Same idea for the scan: a re-scan builds a new opportunities array; nothing edits one afterwards. */
  savedOpps?: unknown[];
  savedOppsLength?: number;
}

const RECORD_KINDS = ["customer", "quote", "job", "invoice", "request", "import"] as const;
type RecordKind = (typeof RECORD_KINDS)[number];

function h(v: unknown): string {
  return createHash("sha1").update(JSON.stringify(v)).digest("base64url").slice(0, 22);
}

export interface BusinessRow {
  id: string;
  profile: string;
  as_of: string;
  paused: number;
  summary: string | null;
  scanned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OwnerTextRow {
  seq: number;
  business_id: string | null;
  at: string;
  from_phone: string;
  body: string;
  reply: string;
  /** What the text did: "booked", "pause", "cancel", "unrecognized", "accepted", "ask_which", ... */
  handled: string;
  needs_person: number;
  done_at: string | null;
}

export class Repo {
  constructor(readonly db: Db) {}

  /* ----------------------------- businesses ----------------------------- */

  listBusinesses(): { id: string; profile: BusinessProfile; asOf: string; paused: boolean; scannedAt?: string; summary?: AccountState["summary"] }[] {
    return this.db
      .all<BusinessRow>("SELECT id, profile, as_of, paused, summary, scanned_at, created_at, updated_at FROM businesses ORDER BY created_at")
      .map((r) => ({ id: r.id, profile: JSON.parse(r.profile) as BusinessProfile, asOf: r.as_of, paused: !!r.paused, scannedAt: r.scanned_at ?? undefined, summary: r.summary ? JSON.parse(r.summary) : undefined }));
  }

  exists(id: string): boolean {
    return !!this.db.get("SELECT 1 FROM businesses WHERE id = ?", id);
  }

  create(state: AccountState, now: string): Loaded {
    const b = state.dataset.business;
    this.db.run("INSERT INTO businesses (id, profile, as_of, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", b.id, JSON.stringify(b), state.dataset.asOf, now, now);
    const loaded: Loaded = { state, paused: false, hashes: new Map(), eventIds: new Set(), messageIds: new Set(), suppressionKeys: new Set() };
    this.save(loaded, now);
    return loaded;
  }

  delete(id: string): void {
    this.db.tx(() => {
      for (const t of ["records", "contacts", "opportunities", "touches", "replies", "recoveries", "outreach", "suppressions", "events", "owner_messages", "integrations", "tasks", "owner_texts", "oauth_states", "worker_marks", "alerts"])
        this.db.run(`DELETE FROM ${t} WHERE business_id = ?`, id);
      this.db.run("DELETE FROM businesses WHERE id = ?", id);
    });
  }

  setPaused(id: string, paused: boolean): void {
    this.db.run("UPDATE businesses SET paused = ? WHERE id = ?", paused ? 1 : 0, id);
  }

  /* ----------------------------- load ----------------------------- */

  load(id: string, opts: { eventLimit?: number } = {}): Loaded | undefined {
    const row = this.db.get<BusinessRow & { scan_stats: string | null; scan_primary: string | null; trial_completed_on: string | null }>(
      "SELECT * FROM businesses WHERE id = ?",
      id,
    );
    if (!row) return undefined;
    const hashes = new Map<string, string>();
    const bucket: Record<RecordKind, unknown[]> = { customer: [], quote: [], job: [], invoice: [], request: [], import: [] };
    for (const r of this.db.all<{ kind: RecordKind; id: string; data: string; hash: string }>("SELECT kind, id, data, hash FROM records WHERE business_id = ?", id)) {
      bucket[r.kind].push(JSON.parse(r.data));
      hashes.set(`rec:${r.kind}:${r.id}`, r.hash);
    }
    const docs = <T>(table: string, key = "id"): T[] =>
      this.db.all<{ k: string; data: string; hash: string }>(`SELECT ${key} AS k, data, hash FROM ${table} WHERE business_id = ?`, id).map((r) => {
        hashes.set(`${table}:${r.k}`, r.hash);
        return JSON.parse(r.data) as T;
      });
    const opportunities = docs<Opportunity>("opportunities");
    const touches = docs<Touch>("touches");
    const replies = docs<Reply>("replies");
    const recoveries = docs<Recovery>("recoveries");
    const outreach = docs<OutreachRecord>("outreach", "customer_id");
    const suppressions: AccountState["suppressions"] = {};
    const suppressionKeys = new Set<string>();
    for (const s of this.db.all<{ email: string; reason: string }>("SELECT email, reason FROM suppressions WHERE business_id = ?", id)) {
      suppressions[s.email] = s.reason as "unsubscribed" | "bounced" | "complained";
      suppressionKeys.add(`${s.email}|${s.reason}`);
    }
    const eventLimit = opts.eventLimit ?? 300;
    const events = this.db
      .all<{ data: string }>("SELECT data FROM events WHERE business_id = ? ORDER BY at DESC LIMIT ?", id, eventLimit)
      .map((r) => JSON.parse(r.data) as AgentEvent)
      .reverse();
    const messages = this.db
      .all<{ data: string }>(
        // Billing texts and SLA nudges always load: "already sent?" is decided from them, and a nudge that fell out
        // of the window would otherwise go out again after every restart.
        "SELECT data FROM owner_messages WHERE business_id = ? AND (kind IN ('close','precharge','free_month','sla_nudge') OR id IN (SELECT id FROM owner_messages WHERE business_id = ? ORDER BY at DESC LIMIT 300)) ORDER BY at",
        id,
        id,
      )
      .map((r) => JSON.parse(r.data) as OwnerMessage);
    const primaryIds: string[] = row.scan_primary ? JSON.parse(row.scan_primary) : [];
    const oppById = new Map(opportunities.map((o) => [o.id, o]));
    const state: AccountState = {
      dataset: {
        business: JSON.parse(row.profile) as BusinessProfile,
        customers: bucket.customer as AccountState["dataset"]["customers"],
        quotes: bucket.quote as AccountState["dataset"]["quotes"],
        jobs: bucket.job as AccountState["dataset"]["jobs"],
        invoices: bucket.invoice as AccountState["dataset"]["invoices"],
        requests: bucket.request as AccountState["dataset"]["requests"],
        imports: bucket.import as AccountState["dataset"]["imports"],
        asOf: row.as_of,
      },
      scan: row.scan_stats ? { opportunities, primary: primaryIds.map((x) => oppById.get(x)).filter((x): x is Opportunity => !!x), stats: JSON.parse(row.scan_stats) } : undefined,
      summary: row.summary ? JSON.parse(row.summary) : undefined,
      touches,
      replies,
      recoveries,
      outreach,
      suppressions,
      events,
      ownerMessages: messages,
      trialCompletedOn: row.trial_completed_on ?? undefined,
      updatedAt: row.updated_at,
    };
    return {
      state,
      paused: !!row.paused,
      hashes,
      eventIds: new Set(events.map((e) => e.id)),
      messageIds: new Set(messages.map((m) => m.id)),
      suppressionKeys,
      scannedAt: row.scanned_at ?? undefined,
    };
  }

  /* ----------------------------- save (diff) ----------------------------- */

  /** Write back everything that changed since load. Returns the number of rows written. */
  save(l: Loaded, now: string): number {
    const s = l.state;
    const bid = s.dataset.business.id;
    let written = 0;
    const seen = new Set<string>();
    const put = (key: string, value: unknown, write: (hash: string) => void) => {
      seen.add(key);
      const hv = h(value);
      if (l.hashes.get(key) === hv) return;
      write(hv);
      l.hashes.set(key, hv);
      written++;
    };
    this.db.tx(() => {
      const recs: [RecordKind, { id: string; customerId?: string }[]][] = [
        ["customer", s.dataset.customers],
        ["quote", s.dataset.quotes],
        ["job", s.dataset.jobs],
        ["invoice", s.dataset.invoices],
        ["request", s.dataset.requests],
        ["import", s.dataset.imports],
      ];
      const arrays = recs.map(([, arr]) => arr as unknown[]);
      const datasetUnchanged = !!l.savedArrays && arrays.every((a, i) => a === l.savedArrays![i] && a.length === l.savedLengths![i]);
      for (const [kind, arr] of datasetUnchanged ? [] : recs) {
        for (const r of arr) {
          put(`rec:${kind}:${r.id}`, r, (hv) => {
            this.db.run(
              "INSERT INTO records (business_id, kind, id, customer_id, data, hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(business_id, kind, id) DO UPDATE SET customer_id = excluded.customer_id, data = excluded.data, hash = excluded.hash",
              bid, kind, r.id, kind === "customer" ? r.id : (r.customerId ?? null), JSON.stringify(r), hv,
            );
            if (kind === "customer") {
              for (const e of (r as unknown as { emails: string[] }).emails) this.db.run("INSERT OR IGNORE INTO contacts (email, business_id, customer_id) VALUES (?, ?, ?)", e, bid, r.id);
            }
          });
        }
      }
      l.savedArrays = arrays;
      l.savedLengths = arrays.map((a) => a.length);
      const oppsUnchanged = !!s.scan && s.scan.opportunities === l.savedOpps && s.scan.opportunities.length === l.savedOppsLength;
      if (s.scan && !oppsUnchanged) {
        for (const o of s.scan.opportunities)
          put(`opportunities:${o.id}`, o, (hv) =>
            this.db.run(
              "INSERT INTO opportunities (business_id, id, customer_id, type, score, value, suppressed, data, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(business_id, id) DO UPDATE SET customer_id = excluded.customer_id, type = excluded.type, score = excluded.score, value = excluded.value, suppressed = excluded.suppressed, data = excluded.data, hash = excluded.hash",
              bid, o.id, o.customerId, o.type, o.score, o.value, o.suppressed ?? null, JSON.stringify(o), hv,
            ),
          );
      }
      for (const t of s.touches)
        put(`touches:${t.id}`, t, (hv) =>
          this.db.run(
            "INSERT INTO touches (business_id, id, customer_id, opportunity_id, step, status, due_at, sent_at, provider_id, data, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(business_id, id) DO UPDATE SET status = excluded.status, due_at = excluded.due_at, sent_at = excluded.sent_at, provider_id = excluded.provider_id, data = excluded.data, hash = excluded.hash",
            bid, t.id, t.customerId, t.opportunityId, t.step, t.status, t.dueAt, t.sentAt ?? null, t.providerId ?? null, JSON.stringify(t), hv,
          ),
        );
      for (const r of s.replies)
        put(`replies:${r.id}`, r, (hv) =>
          this.db.run(
            "INSERT INTO replies (business_id, id, customer_id, intent, status, received_at, data, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(business_id, id) DO UPDATE SET customer_id = excluded.customer_id, intent = excluded.intent, status = excluded.status, data = excluded.data, hash = excluded.hash",
            bid, r.id, r.customerId ?? null, r.intent, r.status, r.receivedAt, JSON.stringify(r), hv,
          ),
        );
      for (const r of s.recoveries)
        put(`recoveries:${r.id}`, r, (hv) =>
          this.db.run(
            "INSERT INTO recoveries (business_id, id, customer_id, value, came_back_on, data, hash) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(business_id, id) DO UPDATE SET value = excluded.value, came_back_on = excluded.came_back_on, data = excluded.data, hash = excluded.hash",
            bid, r.id, r.customerId, r.value, r.cameBackOn, JSON.stringify(r), hv,
          ),
        );
      for (const o of s.outreach)
        put(`outreach:${o.customerId}`, o, (hv) =>
          this.db.run(
            "INSERT INTO outreach (business_id, customer_id, holdout, data, hash) VALUES (?, ?, ?, ?, ?) ON CONFLICT(business_id, customer_id) DO UPDATE SET holdout = excluded.holdout, data = excluded.data, hash = excluded.hash",
            bid, o.customerId, o.holdout ? 1 : 0, JSON.stringify(o), hv,
          ),
        );
      for (const [email, reason] of Object.entries(s.suppressions)) {
        const k = `${email}|${reason}`;
        if (l.suppressionKeys.has(k)) continue;
        this.db.run("INSERT INTO suppressions (business_id, email, reason, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(business_id, email) DO UPDATE SET reason = excluded.reason", bid, email, reason, now);
        l.suppressionKeys.add(k);
        written++;
      }
      for (const e of s.events) {
        if (l.eventIds.has(e.id)) continue;
        this.db.run("INSERT OR IGNORE INTO events (business_id, id, at, agent, kind, data) VALUES (?, ?, ?, ?, ?, ?)", bid, e.id, e.at, e.agent, e.kind, JSON.stringify(e));
        l.eventIds.add(e.id);
        written++;
      }
      for (const m of s.ownerMessages) {
        if (l.messageIds.has(m.id)) continue;
        this.db.run("INSERT OR IGNORE INTO owner_messages (business_id, id, at, kind, text, data) VALUES (?, ?, ?, ?, ?, ?)", bid, m.id, m.at, m.kind, m.text, JSON.stringify(m));
        l.messageIds.add(m.id);
        written++;
      }
      // Opportunities that no longer exist after a re-scan.
      if (s.scan && !oppsUnchanged) {
        const stale = [...l.hashes.keys()].filter((k) => k.startsWith("opportunities:") && !seen.has(k));
        for (const k of stale) {
          this.db.run("DELETE FROM opportunities WHERE business_id = ? AND id = ?", bid, k.slice("opportunities:".length));
          l.hashes.delete(k);
          written++;
        }
      }
      l.savedOpps = s.scan?.opportunities;
      l.savedOppsLength = s.scan?.opportunities.length;
      this.db.run(
        "UPDATE businesses SET profile = ?, as_of = ?, summary = ?, scan_stats = ?, scan_primary = ?, trial_completed_on = ?, updated_at = ? WHERE id = ?",
        JSON.stringify(s.dataset.business),
        s.dataset.asOf,
        s.summary ? JSON.stringify(s.summary) : null,
        s.scan ? JSON.stringify(s.scan.stats) : null,
        s.scan ? JSON.stringify(s.scan.primary.map((o) => o.id)) : null,
        s.trialCompletedOn ?? null,
        now,
        bid,
      );
    });
    return written;
  }

  markScanned(id: string, at: string): void {
    this.db.run("UPDATE businesses SET scanned_at = ? WHERE id = ?", at, id);
  }

  /* ----------------------------- lookups ----------------------------- */

  businessesForEmail(email: string): { businessId: string; customerId: string }[] {
    return this.db.all<{ business_id: string; customer_id: string }>("SELECT business_id, customer_id FROM contacts WHERE email = ?", email.toLowerCase()).map((r) => ({ businessId: r.business_id, customerId: r.customer_id }));
  }

  businessForTouchProvider(providerId: string): string | undefined {
    return this.db.get<{ business_id: string }>("SELECT business_id FROM touches WHERE provider_id = ?", providerId)?.business_id;
  }

  /** Businesses with notes handed to a provider, e.g. "instantly:" or "instantly:<campaign id>:". */
  businessesForProvider(prefix: string): string[] {
    const like = `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.db.all<{ business_id: string }>("SELECT DISTINCT business_id FROM touches WHERE provider_id LIKE ? ESCAPE '\\'", like).map((r) => r.business_id);
  }

  /* ----------------------------- owner message delivery ----------------------------- */

  pendingOwnerMessages(limit = 50): { business_id: string; id: string; kind: string; text: string }[] {
    return this.db.all("SELECT business_id, id, kind, text FROM owner_messages WHERE delivery = 'pending' ORDER BY at LIMIT ?", limit);
  }

  markOwnerMessage(bid: string, id: string, delivery: "sent" | "review" | "failed" | "skipped", fields: { channel?: string; providerId?: string; error?: string; at?: string } = {}): void {
    this.db.run(
      "UPDATE owner_messages SET delivery = ?, channel = COALESCE(?, channel), provider_id = COALESCE(?, provider_id), error = ?, delivered_at = COALESCE(?, delivered_at) WHERE business_id = ? AND id = ?",
      delivery, fields.channel ?? null, fields.providerId ?? null, fields.error ?? null, delivery === "sent" ? (fields.at ?? new Date().toISOString()) : null, bid, id,
    );
  }

  ownerMessages(bid: string, opts: { delivery?: string; limit?: number } = {}): { id: string; at: string; kind: string; text: string; delivery: string; channel: string | null; delivered_at: string | null }[] {
    return opts.delivery
      ? this.db.all("SELECT id, at, kind, text, delivery, channel, delivered_at FROM owner_messages WHERE business_id = ? AND delivery = ? ORDER BY at DESC LIMIT ?", bid, opts.delivery, opts.limit ?? 100)
      : this.db.all("SELECT id, at, kind, text, delivery, channel, delivered_at FROM owner_messages WHERE business_id = ? ORDER BY at DESC LIMIT ?", bid, opts.limit ?? 100);
  }

  /* ----------------------------- integrations ----------------------------- */

  getIntegration(bid: string, kind: string): { account_id: string | null; secret: string | null; settings: string; status: string; cursor: string | null; last_sync_at: string | null; last_error: string | null; last_attempt_at: string | null } | undefined {
    return this.db.get("SELECT account_id, secret, settings, status, cursor, last_sync_at, last_error, last_attempt_at FROM integrations WHERE business_id = ? AND kind = ?", bid, kind);
  }

  putIntegration(bid: string, kind: string, f: { accountId?: string | null; secret?: string | null; settings?: unknown; status?: string; cursor?: string | null; lastSyncAt?: string | null; lastError?: string | null; lastAttemptAt?: string | null }): void {
    const cur = this.getIntegration(bid, kind);
    this.db.run(
      "INSERT INTO integrations (business_id, kind, account_id, secret, settings, status, cursor, last_sync_at, last_error, last_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(business_id, kind) DO UPDATE SET account_id = excluded.account_id, secret = excluded.secret, settings = excluded.settings, status = excluded.status, cursor = excluded.cursor, last_sync_at = excluded.last_sync_at, last_error = excluded.last_error, last_attempt_at = excluded.last_attempt_at",
      bid,
      kind,
      f.accountId !== undefined ? f.accountId : (cur?.account_id ?? null),
      f.secret !== undefined ? f.secret : (cur?.secret ?? null),
      f.settings !== undefined ? JSON.stringify(f.settings) : (cur?.settings ?? "{}"),
      f.status ?? cur?.status ?? "connected",
      f.cursor !== undefined ? f.cursor : (cur?.cursor ?? null),
      f.lastSyncAt !== undefined ? f.lastSyncAt : (cur?.last_sync_at ?? null),
      f.lastError !== undefined ? f.lastError : (cur?.last_error ?? null),
      f.lastAttemptAt !== undefined ? f.lastAttemptAt : (cur?.last_attempt_at ?? null),
    );
  }

  deleteIntegration(bid: string, kind: string): void {
    this.db.run("DELETE FROM integrations WHERE business_id = ? AND kind = ?", bid, kind);
  }

  /* ----------------------------- OAuth state (single use) ----------------------------- */

  putOAuthState(nonce: string, bid: string, kind: string, expiresAt: string): void {
    this.db.run("INSERT INTO oauth_states (nonce, business_id, kind, expires_at) VALUES (?, ?, ?, ?)", nonce, bid, kind, expiresAt);
  }

  /** Spend a state: returns its business once, and only before it expires. Expired states are cleared on the way. */
  takeOAuthState(nonce: string, kind: string, now: string): string | undefined {
    return this.db.tx(() => {
      this.db.run("DELETE FROM oauth_states WHERE expires_at < ?", now);
      const row = this.db.get<{ business_id: string }>("SELECT business_id FROM oauth_states WHERE nonce = ? AND kind = ?", nonce, kind);
      if (row) this.db.run("DELETE FROM oauth_states WHERE nonce = ?", nonce);
      return row?.business_id;
    });
  }

  /* ----------------------------- links ----------------------------- */

  /** The random key inside this business's owner, import and connect links (undefined: made before keys existed). */
  linkKey(bid: string): string | undefined {
    return this.db.get<{ link_key: string | null }>("SELECT link_key FROM businesses WHERE id = ?", bid)?.link_key ?? undefined;
  }

  setLinkKey(bid: string, key: string): void {
    this.db.run("UPDATE businesses SET link_key = ? WHERE id = ?", key, bid);
  }

  /* ----------------------------- worker marks ----------------------------- */

  mark(bid: string, name: string): string | undefined {
    return this.db.get<{ value: string }>("SELECT value FROM worker_marks WHERE business_id = ? AND name = ?", bid, name)?.value;
  }

  setMark(bid: string, name: string, value: string): void {
    this.db.run("INSERT INTO worker_marks (business_id, name, value) VALUES (?, ?, ?) ON CONFLICT(business_id, name) DO UPDATE SET value = excluded.value", bid, name, value);
  }

  /* ----------------------------- texts from owners ----------------------------- */

  logOwnerText(t: { businessId?: string; at: string; from: string; body: string; reply: string; handled: string; needsPerson: boolean }): number {
    const r = this.db.run(
      "INSERT INTO owner_texts (business_id, at, from_phone, body, reply, handled, needs_person) VALUES (?, ?, ?, ?, ?, ?, ?)",
      t.businessId ?? null, t.at, t.from, t.body.slice(0, 2000), t.reply.slice(0, 2000), t.handled, t.needsPerson ? 1 : 0,
    );
    return Number(r.lastInsertRowid);
  }

  ownerTexts(bid: string, opts: { open?: boolean; limit?: number } = {}): OwnerTextRow[] {
    return opts.open
      ? this.db.all("SELECT * FROM owner_texts WHERE business_id = ? AND needs_person = 1 AND done_at IS NULL ORDER BY at DESC, seq DESC LIMIT ?", bid, opts.limit ?? 100)
      : this.db.all("SELECT * FROM owner_texts WHERE business_id = ? ORDER BY at DESC, seq DESC LIMIT ?", bid, opts.limit ?? 100);
  }

  finishOwnerText(bid: string, seq: number, at: string): boolean {
    return Number(this.db.run("UPDATE owner_texts SET done_at = ? WHERE business_id = ? AND seq = ? AND done_at IS NULL", at, bid, seq).changes) > 0;
  }

  /* ----------------------------- operator alerts ----------------------------- */

  addAlert(a: { businessId: string; at: string; kind: string; title: string; detail?: string }): number {
    return Number(this.db.run("INSERT INTO alerts (business_id, at, kind, title, detail) VALUES (?, ?, ?, ?, ?)", a.businessId, a.at, a.kind, a.title, a.detail ?? null).lastInsertRowid);
  }

  openAlerts(bid: string): { seq: number; at: string; kind: string; title: string; detail: string | null }[] {
    return this.db.all("SELECT seq, at, kind, title, detail FROM alerts WHERE business_id = ? AND done_at IS NULL ORDER BY at", bid);
  }

  finishAlert(bid: string, seq: number, at: string): boolean {
    return Number(this.db.run("UPDATE alerts SET done_at = ? WHERE business_id = ? AND seq = ? AND done_at IS NULL", at, bid, seq).changes) > 0;
  }

  businessForIntegrationAccount(kind: string, accountId: string): string | undefined {
    return this.db.get<{ business_id: string }>("SELECT business_id FROM integrations WHERE kind = ? AND account_id = ?", kind, accountId)?.business_id;
  }

  integrationsOfKind(kind: string): { business_id: string; status: string; last_sync_at: string | null }[] {
    return this.db.all("SELECT business_id, status, last_sync_at FROM integrations WHERE kind = ?", kind);
  }

  /* ----------------------------- webhooks, audit, tasks ----------------------------- */

  /** Returns false when this webhook id was already processed (idempotency). */
  logWebhook(id: string, source: string, body: string, at: string): boolean {
    const r = this.db.run("INSERT OR IGNORE INTO webhook_log (id, source, received_at, status, body) VALUES (?, ?, ?, 'received', ?)", id, source, at, body.slice(0, 200_000));
    return Number(r.changes) > 0;
  }

  hasWebhook(id: string): boolean {
    return !!this.db.get("SELECT 1 FROM webhook_log WHERE id = ?", id);
  }

  finishWebhook(id: string, status: "processed" | "ignored" | "failed", businessId?: string, error?: string): void {
    this.db.run("UPDATE webhook_log SET status = ?, business_id = ?, error = ? WHERE id = ?", status, businessId ?? null, error ?? null, id);
  }

  audit(businessId: string | undefined, actor: string, action: string, detail?: unknown): void {
    this.db.run("INSERT INTO audit (business_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)", businessId ?? null, new Date().toISOString(), actor, action, detail === undefined ? null : JSON.stringify(detail));
  }

  enqueue(type: string, payload: unknown, opts: { businessId?: string; runAt?: string; dedupeKey?: string } = {}): void {
    this.db.run(
      "INSERT OR IGNORE INTO tasks (business_id, type, payload, run_at, dedupe_key) VALUES (?, ?, ?, ?, ?)",
      opts.businessId ?? null, type, JSON.stringify(payload), opts.runAt ?? new Date().toISOString(), opts.dedupeKey ?? null,
    );
  }

  dueTasks(now: string, limit = 20): { seq: number; business_id: string | null; type: string; payload: string; attempts: number }[] {
    return this.db.all("SELECT seq, business_id, type, payload, attempts FROM tasks WHERE status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT ?", now, limit);
  }

  finishTask(seq: number, ok: boolean, error?: string, retryAt?: string): void {
    if (ok) this.db.run("UPDATE tasks SET status = 'done', dedupe_key = NULL WHERE seq = ?", seq);
    else if (retryAt) this.db.run("UPDATE tasks SET attempts = attempts + 1, last_error = ?, run_at = ? WHERE seq = ?", error ?? null, retryAt, seq);
    else this.db.run("UPDATE tasks SET status = 'failed', attempts = attempts + 1, last_error = ?, dedupe_key = NULL WHERE seq = ?", error ?? null, seq);
  }
}
