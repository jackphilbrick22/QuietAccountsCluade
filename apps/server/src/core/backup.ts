import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statfsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Config } from "../config.ts";
import { WORKSPACE } from "./backstop.ts";
import type { Deps } from "./ops.ts";

/**
 * The nightly copy of the database: `VACUUM INTO` a dated file (a consistent snapshot, taken while the server keeps
 * running), the newest 14 kept, or fewer on a disk too small for them. The worker makes one a day from 7am UTC, the
 * small hours for US clients. The files go in BACKUP_DIR, or a "backups" folder next to the database (the same
 * volume). Each one opens like any SQLite file: to restore, stop the server and put it at DATABASE_PATH.
 */
export const BACKUPS_KEPT = 14;
/** What a backup leaves free on its disk, so the live database (and its WAL) keeps writing until the next one. */
export const BACKUP_SPARE_BYTES = 64 * 2 ** 20;
const BACKUP_HOUR_UTC = 7;
/** After a failure (a full disk, say), the next try waits this long rather than hitting the disk every tick. */
const RETRY_MS = 60 * 60_000;

/** What the last backup did, kept in the database for the health page. */
export interface BackupRecord {
  at?: string;
  file?: string;
  failedAt?: string;
  error?: string;
}

/** Where the backups go; none for an in-memory database. */
export function backupDir(cfg: Config): string | undefined {
  if (cfg.DATABASE_PATH === ":memory:") return undefined;
  return resolve(cfg.BACKUP_DIR || join(dirname(cfg.DATABASE_PATH), "backups"));
}

const stem = (cfg: Config) => basename(cfg.DATABASE_PATH).replace(/\.[^.]*$/, "");

/** The backups on disk, newest first. */
export function backupFiles(cfg: Config): string[] {
  const dir = backupDir(cfg);
  if (!dir) return [];
  const prefix = `${stem(cfg)}-`;
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}\.db$/.test(f.slice(prefix.length)))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function lastBackup(d: Deps): BackupRecord {
  return JSON.parse(d.accounts.repo.mark(WORKSPACE, "backup") ?? "{}") as BackupRecord;
}

/** The worker's daily backup: once a UTC day, from 7am. Undefined when it isn't due. */
export function backupIfDue(d: Deps): BackupRecord | undefined {
  const now = d.clock();
  if (!backupDir(d.cfg) || now.getUTCHours() < BACKUP_HOUR_UTC) return undefined;
  const last = lastBackup(d);
  if (last.at?.slice(0, 10) === now.toISOString().slice(0, 10)) return undefined;
  if (last.failedAt && now.getTime() - Date.parse(last.failedAt) < RETRY_MS) return undefined;
  return backupNow(d);
}

/** Write today's backup (replacing one made earlier today), keeping the newest 14 with it. */
export function backupNow(d: Deps): BackupRecord {
  const dir = backupDir(d.cfg);
  if (!dir) throw new Error("An in-memory database has nothing to back up");
  const repo = d.accounts.repo;
  const now = d.clock().toISOString();
  const file = join(dir, `${stem(d.cfg)}-${now.slice(0, 10)}.db`);
  // copied under a temporary name first: a crash mid-copy never leaves half a file that looks like a backup
  const partial = join(dir, `${stem(d.cfg)}.partial`);
  try {
    mkdirSync(dir, { recursive: true });
    rmSync(partial, { force: true });
    makeRoom(d, dir, basename(file));
    repo.db.run("VACUUM INTO ?", partial);
    renameSync(partial, file);
  } catch (e) {
    if (existsSync(partial)) rmSync(partial);
    repo.setMark(WORKSPACE, "backup", JSON.stringify({ ...lastBackup(d), failedAt: now, error: (e as Error).message }));
    throw e;
  }
  const done: BackupRecord = { at: now, file };
  repo.setMark(WORKSPACE, "backup", JSON.stringify(done));
  d.log(`[backup] copied the database to ${file}`);
  return done;
}

/**
 * Before the copy: drop all but the newest 13 older copies (today's makes 14), then the oldest of those while the disk
 * can't hold the copy and BACKUP_SPARE_BYTES besides. A disk too small even with every older copy gone keeps them and
 * gets no copy: a backup that filled the volume would stop the database itself from writing.
 */
function makeRoom(d: Deps, dir: string, today: string): void {
  const older = backupFiles(d.cfg).filter((f) => f !== today);
  const sizes = older.map((f) => statSync(join(dir, f)).size);
  const { page_count, page_size } = d.accounts.repo.db.get<{ page_count: number; page_size: number }>("SELECT page_count, page_size FROM pragma_page_count, pragma_page_size")!;
  const need = page_count * page_size + BACKUP_SPARE_BYTES;
  const { bavail, bsize } = statfsSync(dir);
  let keep = Math.min(older.length, BACKUPS_KEPT - 1);
  let free = bavail * bsize + sizes.slice(keep).reduce((a, b) => a + b, 0);
  while (free < need && keep > 0) free += sizes[--keep]!;
  const mb = (n: number) => `${(n / 2 ** 20).toFixed(1)} MB`;
  if (free < need) throw new Error(`Not enough disk space for a backup: ${mb(need)} needed, ${mb(free)} available even without the older copies`);
  for (const old of older.slice(keep)) rmSync(join(dir, old), { force: true });
}
