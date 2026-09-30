import { emptyDataset, emptyState, type AccountState, type BusinessProfile } from "@qa/engine";
import type { Loaded, Repo } from "../db/repo.ts";

/**
 * Every change to a business goes through `withAccount`: one business at a time (a promise-chain
 * lock per business), loaded once and kept warm in memory, and written back as a diff in one
 * transaction when the callback finishes. Webhooks and the worker can hit the same business
 * concurrently without clobbering each other.
 */
export class Accounts {
  private cache = new Map<string, { loaded: Loaded; touched: number }>();
  private locks = new Map<string, Promise<unknown>>();
  constructor(
    readonly repo: Repo,
    private opts: { maxCached?: number; now?: () => string } = {},
  ) {}

  now(): string {
    return this.opts.now ? this.opts.now() : new Date().toISOString();
  }

  /** Create a new business with an empty dataset. */
  async create(profile: BusinessProfile, asOf: string): Promise<AccountState> {
    if (this.repo.exists(profile.id)) throw new Error(`Business ${profile.id} already exists`);
    const state = emptyState(emptyDataset(profile, asOf), this.now());
    const loaded = this.repo.create(state, this.now());
    this.cache.set(profile.id, { loaded, touched: Date.now() });
    this.evict();
    return state;
  }

  /** Run `fn` with exclusive access to the business's state, then persist what changed. */
  async withAccount<T>(id: string, fn: (state: AccountState, ctx: { paused: boolean }) => T | Promise<T>, opts: { save?: boolean } = {}): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => mine);
    this.locks.set(id, chained);
    await prev;
    try {
      const loaded = this.load(id);
      if (!loaded) throw new NotFound(`No business ${id}`);
      const out = await fn(loaded.state, { paused: loaded.paused });
      if (opts.save !== false) this.repo.save(loaded, this.now());
      return out;
    } catch (e) {
      // A failed operation may have half-mutated the cached copy: drop it so the next read is clean.
      this.cache.delete(id);
      throw e;
    } finally {
      release();
      if (this.locks.get(id) === chained) this.locks.delete(id);
    }
  }

  /** Read-only snapshot (no lock, no save). Safe for API reads. */
  peek(id: string): Loaded | undefined {
    return this.load(id);
  }

  setPaused(id: string, paused: boolean): void {
    this.repo.setPaused(id, paused);
    const c = this.cache.get(id);
    if (c) c.loaded.paused = paused;
  }

  forget(id: string): void {
    this.cache.delete(id);
  }

  private load(id: string): Loaded | undefined {
    const hit = this.cache.get(id);
    if (hit) {
      hit.touched = Date.now();
      return hit.loaded;
    }
    const loaded = this.repo.load(id);
    if (!loaded) return undefined;
    this.cache.set(id, { loaded, touched: Date.now() });
    this.evict();
    return loaded;
  }

  private evict(): void {
    const max = this.opts.maxCached ?? 200;
    if (this.cache.size <= max) return;
    const oldest = [...this.cache.entries()].sort((a, b) => a[1].touched - b[1].touched).slice(0, this.cache.size - max);
    for (const [k] of oldest) if (!this.locks.has(k)) this.cache.delete(k);
  }
}

export class NotFound extends Error {}
/** Something has to be filled in before this can run (a 409 with the message, for the operator). */
export class NotReady extends Error {}
