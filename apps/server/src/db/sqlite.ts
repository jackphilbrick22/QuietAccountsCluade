import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

/**
 * Storage: one SQLite file (WAL mode). Records are JSON documents keyed by (business, id)
 * with the columns the worker and the API filter on pulled out and indexed.
 * Single-process by design: all writes for a business go through that business's lock.
 */
const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE businesses (
    id TEXT PRIMARY KEY,
    profile TEXT NOT NULL,
    as_of TEXT NOT NULL,
    summary TEXT,
    scan_stats TEXT,
    scan_primary TEXT,
    scanned_at TEXT,
    paused INTEGER NOT NULL DEFAULT 0,
    trial_completed_on TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE records (
    business_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    customer_id TEXT,
    data TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (business_id, kind, id)
  ) WITHOUT ROWID;
  CREATE INDEX records_customer ON records(business_id, customer_id);
  CREATE TABLE contacts (
    email TEXT NOT NULL,
    business_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    PRIMARY KEY (email, business_id)
  ) WITHOUT ROWID;
  CREATE TABLE opportunities (
    business_id TEXT NOT NULL,
    id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    type TEXT NOT NULL,
    score REAL NOT NULL,
    value REAL NOT NULL,
    suppressed TEXT,
    data TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (business_id, id)
  ) WITHOUT ROWID;
  CREATE INDEX opps_rank ON opportunities(business_id, suppressed, score DESC);
  CREATE TABLE touches (
    business_id TEXT NOT NULL,
    id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    step INTEGER NOT NULL,
    status TEXT NOT NULL,
    due_at TEXT NOT NULL,
    sent_at TEXT,
    provider_id TEXT,
    data TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (business_id, id)
  ) WITHOUT ROWID;
  CREATE INDEX touches_due ON touches(status, due_at);
  CREATE INDEX touches_customer ON touches(business_id, customer_id);
  CREATE INDEX touches_provider ON touches(provider_id);
  CREATE TABLE replies (
    business_id TEXT NOT NULL,
    id TEXT NOT NULL,
    customer_id TEXT,
    intent TEXT NOT NULL,
    status TEXT NOT NULL,
    received_at TEXT NOT NULL,
    data TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (business_id, id)
  ) WITHOUT ROWID;
  CREATE INDEX replies_status ON replies(business_id, status, received_at);
  CREATE TABLE recoveries (
    business_id TEXT NOT NULL,
    id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    value REAL NOT NULL,
    came_back_on TEXT NOT NULL,
    data TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (business_id, id)
  ) WITHOUT ROWID;
  CREATE TABLE outreach (
    business_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    holdout INTEGER NOT NULL,
    data TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (business_id, customer_id)
  ) WITHOUT ROWID;
  CREATE TABLE suppressions (
    business_id TEXT NOT NULL,
    email TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (business_id, email)
  ) WITHOUT ROWID;
  CREATE TABLE events (
    business_id TEXT NOT NULL,
    id TEXT NOT NULL,
    at TEXT NOT NULL,
    agent TEXT NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (business_id, id)
  ) WITHOUT ROWID;
  CREATE INDEX events_at ON events(business_id, at);
  CREATE TABLE owner_messages (
    business_id TEXT NOT NULL,
    id TEXT NOT NULL,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    delivery TEXT NOT NULL DEFAULT 'pending',
    channel TEXT,
    delivered_at TEXT,
    provider_id TEXT,
    error TEXT,
    data TEXT NOT NULL,
    PRIMARY KEY (business_id, id)
  ) WITHOUT ROWID;
  CREATE INDEX owner_messages_delivery ON owner_messages(delivery, at);
  CREATE TABLE integrations (
    business_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    account_id TEXT,
    secret TEXT,
    settings TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'connected',
    cursor TEXT,
    last_sync_at TEXT,
    last_error TEXT,
    PRIMARY KEY (business_id, kind)
  ) WITHOUT ROWID;
  CREATE INDEX integrations_account ON integrations(kind, account_id);
  CREATE TABLE webhook_log (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL,
    business_id TEXT,
    body TEXT NOT NULL,
    error TEXT
  );
  CREATE INDEX webhook_log_at ON webhook_log(received_at);
  CREATE TABLE audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id TEXT,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT
  );
  CREATE TABLE tasks (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id TEXT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    run_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
    last_error TEXT,
    dedupe_key TEXT UNIQUE
  );
  CREATE INDEX tasks_due ON tasks(status, run_at);
  `,
  /* 2 */ `
  CREATE TABLE inbound_review (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    reason TEXT NOT NULL,
    candidates TEXT NOT NULL,
    event TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    business_id TEXT
  );
  CREATE INDEX inbound_review_open ON inbound_review(status, at);
  `,
];

export class Db {
  readonly raw: DatabaseSync;
  private stmts = new Map<string, StatementSync>();

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec("CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)");
    const row = this.raw.prepare("SELECT v FROM schema_version").get() as { v: number } | undefined;
    let v = row?.v ?? 0;
    if (!row) this.raw.prepare("INSERT INTO schema_version (v) VALUES (0)").run();
    while (v < MIGRATIONS.length) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[v]!);
        v++;
        this.raw.prepare("UPDATE schema_version SET v = ?").run(v);
      });
    }
  }

  /** Cached prepared statement. */
  q(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  all<T>(sql: string, ...params: SqlParam[]): T[] {
    return this.q(sql).all(...params) as T[];
  }

  get<T>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.q(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SqlParam[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.q(sql).run(...params);
  }

  private depth = 0;
  /** Nested-safe transaction. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    this.raw.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const out = fn();
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.raw.close();
  }
}

export type SqlParam = string | number | bigint | null | Uint8Array;
