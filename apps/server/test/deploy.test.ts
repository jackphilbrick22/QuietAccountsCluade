import { existsSync, mkdirSync, readdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { schema } from "../src/config.ts";
import { BACKUP_SPARE_BYTES, backupFiles, backupIfDue, backupNow, BACKUPS_KEPT, lastBackup } from "../src/core/backup.ts";
import { registerWebhooks } from "../src/core/backstop.ts";
import { tick } from "../src/core/worker.ts";
import { createInstantlyProvider, INSTANTLY_WEBHOOK_PATH } from "../src/integrations/instantly/index.ts";
import { fakeInstantly } from "./fake-instantly.ts";
import { harness, WH, type Harness } from "./harness.ts";

/**
 * The deploy kit: the nightly database backup, the operator's health page, and the files a host builds from
 * (Dockerfile, .env.example, README) kept in step with the code.
 */
let open: Harness[] = [];
const make = (...a: Parameters<typeof harness>) => {
  const h = harness(...a);
  open.push(h);
  return h;
};
afterEach(() => {
  for (const h of open) h.close();
  open = [];
  volume.dir = "";
});

/** A small volume for the disk-space tests: the space free in `dir` is `size` less what the folder already holds. */
const volume = vi.hoisted(() => ({ dir: "", size: 0 }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  const used = (dir: string): number =>
    fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? used(`${dir}/${e.name}`) : fs.statSync(`${dir}/${e.name}`).size), 0);
  const statfsSync = (path: string) => (volume.dir && path.startsWith(volume.dir) ? { ...fs.statfsSync(path), bsize: 1, bavail: Math.max(0, volume.size - used(volume.dir)) } : fs.statfsSync(path));
  return { ...fs, statfsSync };
});
/** Puts the harness's database folder on a volume with `free` bytes left. */
const shrink = (h: Harness, free: number) => {
  volume.dir = dirname(h.dbPath);
  volume.size = Number.MAX_SAFE_INTEGER;
  volume.size -= statfsSync(volume.dir).bavail - free;
};
const backupsOf = (h: Harness) => join(dirname(h.dbPath), "backups");
const setup = async (h: Harness) => (await h.api("GET", "/api/health/setup")).json;

describe("the nightly backup", () => {
  it("writes a dated copy next to the database that opens and holds the data", async () => {
    const h = make({ now: "2026-10-01T07:30:00Z" });
    await h.business("ridge");
    const r = backupIfDue(h.d)!;
    expect(r.file).toBe(join(backupsOf(h), "qa-2026-10-01.db"));
    const copy = new DatabaseSync(r.file!, { readOnly: true });
    expect(copy.prepare("SELECT id FROM businesses").all()).toEqual([expect.objectContaining({ id: "ridge" })]);
    copy.close();
    expect(lastBackup(h.d)).toEqual({ at: "2026-10-01T07:30:00.000Z", file: r.file });
    // nothing half-written left beside it
    expect(readdirSync(backupsOf(h))).toEqual(["qa-2026-10-01.db"]);
  });

  it("runs once a UTC day from 7am: a second run the same day, or after a restart, writes nothing", async () => {
    const h = make({ now: "2026-10-01T06:59:00Z" });
    expect(backupIfDue(h.d)).toBeUndefined();
    expect(existsSync(backupsOf(h))).toBe(false);
    h.setNow("2026-10-01T07:00:00Z");
    expect(backupIfDue(h.d)?.file).toMatch(/qa-2026-10-01\.db$/);
    h.setNow("2026-10-01T23:59:00Z");
    expect(backupIfDue(h.d)).toBeUndefined();
    const after = h.restart();
    open.push(after);
    expect(backupIfDue(after.d)).toBeUndefined();
    expect(backupFiles(h.d.cfg)).toEqual(["qa-2026-10-01.db"]);
    expect(lastBackup(after.d).at).toBe("2026-10-01T07:00:00.000Z");
    after.setNow("2026-10-02T07:05:00Z");
    expect(backupIfDue(after.d)?.file).toMatch(/qa-2026-10-02\.db$/);
    expect(backupFiles(h.d.cfg)).toEqual(["qa-2026-10-02.db", "qa-2026-10-01.db"]);
  });

  it("keeps the newest 14 and never touches other files", async () => {
    const h = make({ now: "2026-10-01T08:00:00Z" });
    mkdirSync(backupsOf(h));
    for (let day = 15; day <= 30; day++) writeFileSync(join(backupsOf(h), `qa-2026-09-${day}.db`), "an older copy");
    const others = ["notes.txt", "other-2026-01-01.db", "qa-latest.db"];
    for (const f of others) writeFileSync(join(backupsOf(h), f), "not ours");
    backupNow(h.d);
    const kept = backupFiles(h.d.cfg);
    expect(kept).toHaveLength(BACKUPS_KEPT);
    expect(kept[0]).toBe("qa-2026-10-01.db");
    expect(kept.at(-1)).toBe("qa-2026-09-18.db");
    expect(readdirSync(backupsOf(h)).sort()).toEqual([...kept, ...others].sort());
  });

  it("on a disk too small for 14 copies, drops the oldest to make room and always leaves the database room to write", async () => {
    const h = make({ now: "2026-10-01T07:30:00Z" });
    await h.business("ridge");
    const copy = readFileSync(backupNow(h.d).file!).length;
    // room for the spare and two and a half more copies
    shrink(h, BACKUP_SPARE_BYTES + 2.5 * copy);
    const kept: number[] = [];
    for (let day = 2; day <= 20; day++) {
      h.setNow(`2026-10-${String(day).padStart(2, "0")}T07:30:00Z`);
      expect(backupIfDue(h.d)?.file).toMatch(new RegExp(`qa-2026-10-${String(day).padStart(2, "0")}\\.db$`));
      expect(statfsSync(volume.dir).bavail).toBeGreaterThanOrEqual(BACKUP_SPARE_BYTES);
      kept.push(backupFiles(h.d.cfg).length);
    }
    expect(kept).toEqual([2, ...Array(18).fill(3)]);
    expect(backupFiles(h.d.cfg)).toEqual(["qa-2026-10-20.db", "qa-2026-10-19.db", "qa-2026-10-18.db"]);
  });

  it("when the disk can't hold a copy even without the older ones, keeps them, writes nothing and says so", async () => {
    const h = make({ now: "2026-10-01T07:30:00Z" });
    await h.business("ridge");
    backupIfDue(h.d);
    shrink(h, BACKUP_SPARE_BYTES / 2);
    h.setNow("2026-10-02T07:30:00Z");
    expect((await tick(h.d)).errors).toEqual([expect.stringMatching(/^backup: Not enough disk space for a backup: 64\.\d MB needed, 32\.\d MB available even without the older copies$/)]);
    expect(readdirSync(backupsOf(h))).toEqual(["qa-2026-10-01.db"]);
    expect((await setup(h)).backup).toMatchObject({ lastAt: "2026-10-01T07:30:00.000Z", failedAt: "2026-10-02T07:30:00.000Z", error: expect.stringMatching(/Not enough disk space/), kept: 1 });
    // the live database still writes
    await h.business("cedar");
    expect(h.d.accounts.repo.exists("cedar")).toBe(true);
    // a bigger volume, and the next try an hour later goes through
    volume.size += 2 ** 30;
    h.setNow("2026-10-02T08:30:00Z");
    expect((await tick(h.d)).errors).toEqual([]);
    expect(backupFiles(h.d.cfg)).toEqual(["qa-2026-10-02.db", "qa-2026-10-01.db"]);
    expect(lastBackup(h.d)).toEqual({ at: "2026-10-02T08:30:00.000Z", file: join(backupsOf(h), "qa-2026-10-02.db") });
  });

  it("a copy that fails partway leaves no partial file behind", async () => {
    const h = make({ now: "2026-10-01T07:30:00Z" });
    // a folder holds today's name: the copy is written but can't be put in its place
    mkdirSync(join(backupsOf(h), "qa-2026-10-01.db", "x"), { recursive: true });
    expect(() => backupNow(h.d)).toThrow(/EISDIR|ENOTEMPTY/);
    expect(readdirSync(backupsOf(h))).toEqual(["qa-2026-10-01.db"]);
    expect(lastBackup(h.d).error).toMatch(/EISDIR|ENOTEMPTY/);
  });

  it("is the worker's: once a day into BACKUP_DIR; a failure shows on the health page and is retried an hour later", async () => {
    const h = make({ now: "2026-10-01T07:10:00Z" });
    // a folder under a file can't be made
    h.d.cfg.BACKUP_DIR = join(h.dbPath, "backups");
    expect((await tick(h.d)).errors).toEqual([expect.stringMatching(/^backup: ENOTDIR/)]);
    expect((await setup(h)).backup).toMatchObject({ lastAt: null, failedAt: "2026-10-01T07:10:00.000Z", error: expect.stringMatching(/ENOTDIR/) });
    const elsewhere = join(dirname(h.dbPath), "elsewhere");
    h.d.cfg.BACKUP_DIR = elsewhere;
    h.setNow("2026-10-01T07:40:00Z");
    expect((await tick(h.d)).errors).toEqual([]);
    expect(backupFiles(h.d.cfg)).toEqual([]);
    h.setNow("2026-10-01T08:10:00Z");
    await tick(h.d);
    await tick(h.d);
    expect(backupFiles(h.d.cfg)).toEqual(["qa-2026-10-01.db"]);
    expect(existsSync(backupsOf(h))).toBe(false);
    expect((await setup(h)).backup).toEqual({ lastAt: "2026-10-01T08:10:00.000Z", file: join(elsewhere, "qa-2026-10-01.db"), failedAt: null, error: null, kept: 1, dir: elsewhere });
  });
});

describe("the health page (GET /api/health/setup)", () => {
  it("is for the operator only", async () => {
    const h = make();
    expect((await h.api("GET", "/api/health/setup", undefined, { auth: false })).status).toBe(401);
  });

  it("with the log providers: Instantly not set up, texts to the log, billing by hand, no backup yet", async () => {
    const h = make();
    expect(await setup(h)).toEqual({
      instantly: { webhooks: "not_set_up" },
      sms: "log",
      stripe: "manual",
      stripeWebhook: null,
      backup: { lastAt: null, file: null, failedAt: null, error: null, kept: 0, dir: backupsOf(h) },
    });
  });

  it("shows Stripe's mode from the key's prefix, never the key", async () => {
    for (const [key, mode] of [
      ["sk_test_51Qa8Kz", "test"],
      ["sk_live_51Qa8Kz", "live"],
      ["rk_live_51Qa8Kz", "live"],
      ["pk_live_51Qa8Kz", "unrecognized"],
    ]) {
      const h = make({ env: { STRIPE_SECRET_KEY: key!, STRIPE_WEBHOOK_SECRET: "whsec_test", STRIPE_ALLOW_LIVE: "true" } });
      const json = await setup(h);
      expect(json.stripe).toBe(mode);
      expect(JSON.stringify(json)).not.toContain("51Qa8Kz");
    }
  });

  it("says whether Instantly's webhooks are registered, and when the last delivery arrived", async () => {
    let down = true;
    const api = fakeInstantly({
      "GET /webhooks": () => (down ? { status: 403, body: { message: "API key lacks webhooks scope" } } : { body: { items: [] } }),
      "POST /webhooks": () => ({ body: { id: "w1" } }),
    });
    const h = make({ email: createInstantlyProvider({ apiKey: "k", fetch: api.fetch, sleep: async () => {}, maxRetries: 0 }) });
    expect((await setup(h)).instantly).toEqual({ webhooks: "unknown", checkedAt: null, error: null, lastEventAt: null });
    await registerWebhooks(h.d);
    expect((await setup(h)).instantly).toMatchObject({ webhooks: "failing", error: expect.stringMatching(/lacks webhooks scope/) });
    down = false;
    h.setNow("2026-09-29T14:15:00Z");
    await registerWebhooks(h.d);
    h.setNow("2026-09-29T15:00:00Z");
    const res = await h.app.request(`${INSTANTLY_WEBHOOK_PATH}/${WH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event_type: "email_opened", lead_email: "kim@example.org" }) });
    expect(res.status).toBe(200);
    expect((await setup(h)).instantly).toEqual({ webhooks: "ok", checkedAt: "2026-09-29T14:15:00.000Z", error: null, lastEventAt: "2026-09-29T15:00:00.000Z" });
  });
});

describe("the files a host builds from", () => {
  const root = resolve(import.meta.dirname, "../../..");
  const read = (f: string) => readFileSync(join(root, f), "utf8");

  it(".env.example lists every setting, each marked required, optional or coming, with what happens without it", () => {
    const env = read(".env.example");
    const keys = [...Object.keys(schema.shape), "ALLOW_DEV_SECRETS"];
    for (const key of keys) {
      expect(env, key).toMatch(new RegExp(`^(# )?${key}=`, "m"));
      const entry = env.split(/\n\s*\n/).find((block) => new RegExp(`^(# )?${key}=`, "m").test(block))!;
      expect(entry, key).toMatch(/^# [A-Z_, and]+ \((required|optional|coming)[^)]*\): /m);
      expect(entry, key).toMatch(/Without (it|them)/);
    }
    // switched off unless set on purpose
    for (const key of ["FEATURE_NEW_REQUESTS", "FEATURE_YEARLY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_ALLOW_LIVE"]) expect(env).toMatch(new RegExp(`^# ${key}=`, "m"));
    expect(env).toMatch(/^DATABASE_PATH=\/data\//m);
  });

  it("the Dockerfile builds on Node 22.5+ with the pinned pnpm, keeps the database on /data and starts the server", () => {
    const docker = read("Dockerfile");
    const node = [...docker.matchAll(/^FROM node:(\d+)/gm)].map((m) => Number(m[1]));
    expect(node.length).toBeGreaterThan(0);
    for (const major of node) expect(major).toBeGreaterThanOrEqual(22);
    expect(JSON.parse(read("package.json")).packageManager).toMatch(/^pnpm@/);
    expect(docker).toMatch(/corepack enable/);
    expect(docker).toMatch(/DATABASE_PATH=\/data\/quiet-accounts\.db/);
    expect(docker).toMatch(/pnpm --filter @qa\/web build/);
    // the worker starts in the same process unless WORKER_ENABLED=false
    expect(docker).toMatch(/CMD \["node", "--import", "tsx", .*"src\/main\.ts"\]/);
    expect(existsSync(join(root, "apps/server/src/main.ts"))).toBe(true);
    expect(JSON.parse(read("apps/server/package.json")).dependencies.tsx).toBeDefined();
    for (const [, from] of docker.matchAll(/^COPY (?!--from)(.+) \S+$/gm)) for (const f of from!.split(" ")) expect(existsSync(join(root, f)), f).toBe(true);
    // its port only to the proxy on the same machine
    expect(docker).toMatch(/^#\s+docker run -p 127\.0\.0\.1:8787:8787 /m);
    const ignore = read(".dockerignore").split("\n");
    for (const p of ["**/node_modules", "**/.data", "**/*.db*", "**/.env", ".git"]) expect(ignore).toContain(p);
  });

  it("the README's Run it section names the host, the settings, the webhook URLs, the volume and the backups", () => {
    const run = read("README.md").split("## Run it")[1]!;
    for (const s of ["Fly", "Render", "Railway", "VPS", "serverless", "PUBLIC_URL", "TRUSTED_PROXY_HOPS", "SIGNUP_ORIGINS", `PUBLIC_URL${INSTANTLY_WEBHOOK_PATH}/WEBHOOK_SECRET`, "PUBLIC_URL/webhooks/stripe", "/data", "VACUUM INTO", "14", "/api/health/setup"]) expect(run).toContain(s);
    // the volume is sized for the copies, and the spare it keeps is the one the backup leaves
    expect(run).toMatch(/about 16 times the database/);
    expect(run).toContain(`leaves ${BACKUP_SPARE_BYTES / 2 ** 20} MB for the database`);
  });

  it("the README's VPS command publishes the port to the proxy only, so nobody can skip it and pick their own address", () => {
    const run = read("README.md").split("## Run it")[1]!;
    const commands = run.match(/^docker run .*$/gm)!;
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain(" -p 127.0.0.1:8787:8787 ");
    expect(run).toMatch(/proxies that every request passes through/);
    expect(read(".env.example")).toMatch(/proxies every request passes through/);
  });
});
