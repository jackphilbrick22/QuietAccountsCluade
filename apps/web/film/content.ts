/**
 * The service film's words and numbers, out of the software itself. Nothing on screen is typed in: the company's
 * records are the sample generator's (made for a made-up company, profiles.ts), the people who stopped and what
 * they're worth are the engine's scan, the note is the engine's note, the welcome and hand-off texts are the engine's
 * owner texts, the replies are the simulator's run through the real Inbox reader, and the texts back to the owner
 * ("Done — the first notes go out…", "Booked: …") are the server's own answers to his OK and his BOOKED.
 *
 *   pnpm --filter @qa/web film:content [trade]       (writes film/content.json; another trade writes content.<trade>.json)
 *   … [trade] --states <dir>                         (also writes the account as it stands at each step, for the app)
 *
 * Runs on tsx (the server's), since the owner-text replies come from the server's code. Same output every run.
 *
 * Two things are changed on what the sample generator makes, and only these, both before the engine reads anything
 * or writes a word:
 *  - the business profile: the made-up company's name, owner, town and PO box (the sample's own is a placeholder
 *    company with "example" addresses);
 *  - the customers' phone numbers: the sample's are (603) 555-xxxx, which reads as fake on screen. They keep their
 *    last four digits and take the 958 or 959 exchange instead, which the North American plan reserves in every area
 *    code for line testing: real-looking, and never anyone's number.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addDays,
  BREAKAGE_LABEL,
  emptyDataset,
  emptyState,
  find,
  fmtMoney,
  generateSample,
  growingSeason,
  handoffText,
  isOnePass,
  leadCode,
  passPromise,
  planBatch,
  readFiles,
  SEASONAL_TRADES,
  simulate,
  totals,
  wantedWords,
  type AccountState,
  type BusinessProfile,
  type Opportunity,
  type Reply,
  type Touch,
} from "@qa/engine";
import { loadConfig } from "../../server/src/config.ts";
import { Db } from "../../server/src/db/sqlite.ts";
import { Repo } from "../../server/src/db/repo.ts";
import { Accounts } from "../../server/src/core/accounts.ts";
import { ownerCommand } from "../../server/src/core/owner.ts";
import { localIso } from "../../server/src/core/clock.ts";
import { LogEmailProvider } from "../../server/src/providers/email.ts";
import { LogNotifier } from "../../server/src/providers/sms.ts";
import { PROFILES, type FilmProfile } from "./profiles.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const trade = (process.argv[2] ?? "lawn") as keyof typeof PROFILES;
const profile = PROFILES[trade];
if (!profile) throw new Error(`No film profile for "${trade}". Add one in film/profiles.ts.`);
const OUT = join(HERE, trade === "lawn" ? "content.json" : `content.${trade}.json`);

/* ------------------------------ the company ------------------------------ */

const TEST_EXCHANGES = ["958", "959"];
/** (603) 555-1234 → (603) 958-1234: the 958/959 exchanges are reserved for line testing, never a subscriber's. */
function testExchange(e164: string): string {
  const m = /^\+1(\d{3})555(\d{4})$/.exec(e164);
  if (!m) return e164;
  return `+1${m[1]}${TEST_EXCHANGES[Number(m[2]) % 2]}${m[2]}`;
}

function companyProfile(p: FilmProfile, base: BusinessProfile): BusinessProfile {
  const c = p.company;
  const first = c.ownerName.split(" ")[0]!;
  return {
    ...base,
    id: c.name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name: c.name,
    ownerName: c.ownerName,
    ownerFirstName: first,
    signerName: c.signerName,
    ownerEmail: `${first.toLowerCase()}@${c.domain}`,
    replyTo: `office@${c.domain}`,
    website: c.domain,
    ownerPhone: testExchange(base.ownerPhone ?? ""),
    businessPhone: base.businessPhone ? testExchange(base.businessPhone) : undefined,
    mailingAddress: c.mailingAddress,
    city: c.city,
    state: c.state,
  };
}

/* ------------------------------ the server, for the owner's texts ------------------------------ */

/** A throwaway server (its own SQLite file, a clock we set) that answers the owner's texts with its real code. */
function server(dir: string) {
  let now = new Date(0);
  const d = {
    cfg: loadConfig({ DATABASE_PATH: join(dir, "film.db"), OPERATOR_TOKEN: "film-operator-token", APP_SECRET: "film-app-secret-0123456789", WEBHOOK_SECRET: "film-webhook", PUBLIC_URL: "https://film.invalid", WORKER_ENABLED: "false" }),
    accounts: new Accounts(new Repo(new Db(join(dir, "film.db")))),
    email: new LogEmailProvider({ quiet: true }),
    notifier: new LogNotifier(true),
    llm: null,
    fsm: {},
    log: () => {},
    clock: () => now,
    parsers: {},
  };
  return {
    d,
    /** Set the clock to a local wall time in the business's zone. */
    at(local: string, tz: string) {
      let guess = Date.parse(`${local.slice(0, 19)}Z`);
      for (let i = 0; i < 3; i++) guess += Date.parse(`${local.slice(0, 19)}Z`) - Date.parse(`${localIso(new Date(guess), tz)}Z`);
      now = new Date(guess);
    },
    close() {
      d.accounts.repo.db.close();
    },
  };
}

/** Put an engine state into the throwaway server as a business of its own, and text it as the owner. */
async function ownerTexts(state: AccountState, at: string, text: string): Promise<{ reply: string; state: AccountState }> {
  const dir = mkdtempSync(join(tmpdir(), "qa-film-"));
  const s = server(dir);
  try {
    const b = state.dataset.business;
    await s.d.accounts.create(b, state.dataset.asOf);
    await s.d.accounts.withAccount(b.id, (live) => void Object.assign(live, structuredClone(state)));
    s.at(at, b.timezone);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await ownerCommand(s.d as any, b.ownerPhone!, text);
    return { reply: res.reply, state: structuredClone(s.d.accounts.peek(b.id)!.state) };
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------ the run ------------------------------ */

const p = profile;
const sample = generateSample({ trade: p.trade, asOf: p.asOf, seed: p.sampleSeed, businessName: p.company.name, ownerName: p.company.ownerName, signerName: p.company.signerName });
const business = companyProfile(p, sample.business);
const file = sample.files.find((f) => f.name === p.exportFile);
if (!file) throw new Error(`The sample has no ${p.exportFile}: ${sample.files.map((f) => f.name).join(", ")}`);

const start = emptyState(emptyDataset(business, p.asOf), `${p.exportAt}:00`);
readFiles(start, [file], `${p.exportAt}:00`);
for (const c of start.dataset.customers) c.phones = c.phones.map(testExchange);
find(start, `${p.asOf}T08:01:00`);
planBatch(start, `${p.asOf}T08:02:00`, { startOn: addDays(p.asOf, 1), limitPeople: business.plan.trialSize });
const kickoffMsg = start.ownerMessages.find((m) => m.kind === "kickoff");
if (!kickoffMsg) throw new Error("No welcome text: the round didn't plan");
const firsts = start.touches.filter((t) => t.step === 1).sort((x, y) => (x.dueAt < y.dueAt ? -1 : x.dueAt > y.dueAt ? 1 : 0));
const firstNote = firsts[0]!;

// He reads the welcome text over his coffee and texts back OK.
const okAt = `${p.asOf}T08:40:00`;
const ok = await ownerTexts(start, okAt, "OK");
const approved = ok.state;

/* ------------------------------ choosing the replies to show ------------------------------ */

const templateRe = (t: string) => new RegExp(`^${t.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(signer|phone|job|day)\}/g, ".+?")}$`);
const wantsRank = (text: string) => p.preferWants.findIndex((t) => templateRe(t).test(text.trim()));
const reads = (r: Reply) => !p.avoidInReplies.test(r.text);
const firstDayIds = new Set(firsts.filter((t) => t.dueAt.slice(0, 10) === firstNote.dueAt.slice(0, 10)).map((t) => t.customerId));

/** Two notes that read the same once the greeting's name is set aside. */
const sameNote = (a: string, b: string) => a.replace(/^Hi [^,\n]+,/, "") === b.replace(/^Hi [^,\n]+,/, "");

const OTHER_KINDS = ["wants_price", "later", "already_done", "moved", "not_interested"];
/**
 * The reply the film follows in one run, scored (lower is better), or none it can follow. It must be someone a lawn
 * owner believes: their last job one visit, not a season's contract (a weekly-mowing season dated in April ran all
 * summer, so "last here April" would be wrong, and booking its renewal is no win-back); not the welcome text's first
 * note's person, and a note that reads differently from that one (the film shows both); a booking he texts in working
 * hours. Its figures must tell one story: what he books is within a quarter of what the List says they're worth, and
 * so is their last job unless they're a regular (whose last job is one visit of many). Then, best first: a reply that
 * comes after the other kinds of reply have come in (the Replies view on screen holds only replies from before his
 * hand-off text, and the sort has something to sort); a booking at or near the end of the round (the ledger on screen
 * then needs no rows after his); the likeliest words; a reply in the daytime (his text comes when they write); the kind
 * of person first in the list.
 */
function followable(st: AccountState): { featured: Reply; score: number } | undefined {
  let out: { featured: Reply; score: number } | undefined;
  const recs = [...st.recoveries].filter((x) => !x.disputed).sort((a, b) => (a.cameBackOn < b.cameBackOn ? -1 : a.cameBackOn > b.cameBackOn ? 1 : 0));
  for (const r of st.replies) {
    const rank = wantsRank(r.text);
    const o = st.scan?.opportunities.find((x) => x.id === r.opportunityId);
    if (r.intent !== "wants_it" || r.outcome !== "booked" || rank < 0 || !reads(r) || !o || !p.featureTypes.includes(o.type)) continue;
    const touch = st.touches.find((t) => t.id === r.touchId);
    if (touch?.step !== 1 || r.customerId === firstNote.customerId) continue;
    const job = o.source.kind === "job" ? st.dataset.jobs.find((j) => j.id === o.source.id) : undefined;
    if (!job || p.seasonJob.test(job.title)) continue;
    const agree = (x: number | undefined) => x !== undefined && Math.abs(x - o.value) <= 0.25 * o.value;
    if (!agree(r.outcomeValue) || (o.type !== "lapsed_regular" && !agree(job.total))) continue;
    if (sameNote(touch.body ?? "", firstNote.body ?? "")) continue;
    const callHour = Number((r.bookedAt ?? r.ownerContactedAt ?? "").slice(11, 13));
    if (!(callHour >= 9 && callHour < 19)) continue;
    const kinds = new Set(st.replies.filter((x) => x.receivedAt < r.receivedAt && x.customerId && reads(x) && OTHER_KINDS.includes(x.intent)).map((x) => x.intent));
    const mine = recs.findIndex((x) => x.match === "owner_reported" && x.record.id === r.id);
    const after = mine < 0 ? 9 : recs.length - 1 - mine;
    const hour = Number(r.receivedAt.slice(11, 13));
    const score = 100 * Math.max(0, 3 - kinds.size) + 50 * after + rank * 10 + (hour >= 8 && hour < 20 ? 0 : 50) + p.featureTypes.indexOf(o.type);
    if (!out || score < out.score) out = { featured: r, score };
  }
  return out;
}
const run = (seed: string) => {
  const st = structuredClone(approved);
  simulate(st, addDays(p.asOf, 1), p.simDays, { seed });
  return st;
};

// Every seed is played out. Only a run that reached all 150 (the bounce brake never tripped) and whose result sits in
// the middle half of all the runs is used: the film follows a typical round, never a lucky one.
const runs = p.simSeeds.map((seed) => {
  const st = run(seed);
  const t = totals(st);
  return { seed, bookedValue: t.bookedValue, contacted: t.contacted, pick: followable(st) };
});
const healthy = runs.filter((r) => r.contacted === approved.touches.filter((t) => t.step === 1).length).sort((x, y) => x.bookedValue - y.bookedValue);
if (!healthy.length) throw new Error("No run reached the whole round");
const q = (f: number) => healthy[Math.min(healthy.length - 1, Math.floor(f * healthy.length))]!.bookedValue;
const [low, high] = [q(0.25), q(0.75)];
const typical = healthy.filter((r) => r.bookedValue >= low && r.bookedValue <= high && r.pick).sort((x, y) => x.pick!.score - y.pick!.score);
if (process.argv.includes("--picks"))
  for (const r of typical) {
    const f = r.pick!.featured;
    console.log(`  ${r.seed}  $${r.bookedValue}  score ${r.pick!.score}  ${f.receivedAt}  ${f.outcomeValue}  ${f.text}  (${f.customerId})`);
  }
// --seed <simSeed> looks at one particular run (to compare picks); the film uses the best-scoring one
const seedArg = process.argv.includes("--seed") ? process.argv[process.argv.indexOf("--seed") + 1] : undefined;
const chosen = seedArg ? typical.find((r) => r.seed === seedArg) : typical[0];
if (!chosen) throw new Error("No typical run had a reply the film can follow: widen simSeeds or preferWants in profiles.ts");
const spread = { runs: runs.length, reachedEveryone: healthy.length, bookedValue: { low: healthy[0]!.bookedValue, quarter: low, median: q(0.5), threeQuarters: high, high: healthy.at(-1)!.bookedValue } };
const final = run(chosen.seed);
const featured = final.replies.find((r) => r.id === chosen.pick!.featured.id)!;
const simSeed = chosen.seed;


/* ------------------------------ the booking, as he texts it ------------------------------ */

// The run had him call back and book; the film shows him texting BOOKED. The server answers that text on the state
// as it stood just before: replies that hadn't come in yet aren't there, and calls he hadn't made yet aren't made.
const bookedAt = featured.ownerContactedAt!;
const bookedValue = featured.outcomeValue!;
const before = structuredClone(final);
before.replies = before.replies.filter((r) => r.receivedAt <= bookedAt);
for (const r of before.replies)
  if (r.ownerContactedAt && r.ownerContactedAt >= bookedAt) {
    for (const k of ["ownerContactedAt", "bookedAt", "outcome", "outcomeValue"] as const) delete r[k];
    r.status = "handed_off";
    before.recoveries = before.recoveries.filter((x) => !(x.match === "owner_reported" && x.record.id === r.id));
  }
before.recoveries = before.recoveries.filter((x) => x.cameBackOn <= bookedAt.slice(0, 10));
before.dataset.asOf = bookedAt.slice(0, 10);
const code = leadCode(featured.id);
const bookedText = `BOOKED ${bookedValue} #${code}`;
const booked = await ownerTexts(before, bookedAt, bookedText);

/* ------------------------------ what goes in the film ------------------------------ */

const cust = (id: string | undefined) => final.dataset.customers.find((c) => c.id === id);
const oppOf = (id: string | undefined) => final.scan!.opportunities.find((o) => o.id === id);
const appLabels = (() => {
  // The Unibox's own words for each kind of reply (apps/web/src/components/lead.tsx), so the film says what the app says.
  const src = readFileSync(join(HERE, "../src/components/lead.tsx"), "utf8");
  return Object.fromEntries([...src.matchAll(/^\s+(\w+): \{ label: "([^"]+)", tone: "(\w+)" \}/gm)].map((m) => [m[1]!, { label: m[2]!, tone: m[3]! }]));
})();

const person = (o: Opportunity) => {
  const c = cust(o.customerId)!;
  const job = o.source.kind === "job" ? final.dataset.jobs.find((j) => j.id === o.source.id) : undefined;
  return {
    name: c.name,
    firstName: c.firstName,
    street: c.address?.street ?? "",
    town: c.address?.city ?? "",
    type: o.type,
    typeLabel: BREAKAGE_LABEL[o.type].title,
    typeShort: BREAKAGE_LABEL[o.type].short,
    job: o.jobPhrase,
    // as the List and Opportunities tables print it ("mowing", not "the mowing")
    what: o.jobPhrase.replace(/^the /, ""),
    lastDone: o.lastDoneOn ?? o.anchorDate ?? null,
    value: o.value,
    why: o.reason,
    // the job in his export this person is on the list for: its own title, date and price
    lastJob: job ? { title: job.title, on: job.completedOn ?? job.scheduledOn ?? job.createdOn ?? null, total: job.total ?? null } : null,
  };
};

const summary = start.summary!;

/* ------------------------------ names on screen: no two alike ------------------------------ */

// A generated book of 1,100 customers repeats surnames and streets; the few dozen the film shows must not ("Rachel
// McCarthy" beside "Greg McCarthy" gives the data away). Some names are fixed by the run (the one we follow, the
// ledger, the welcome text's call list); the rows chosen below keep clear of them and of each other.
const surname = (name: string) => name.trim().split(/\s+/).at(-1)!.toLowerCase();
const streetName = (street: string) => street.replace(/^\d+\s+/, "").toLowerCase();
const fixedNames = [
  cust(featured.customerId)!.name,
  ...final.recoveries.filter((r) => !r.disputed).map((r) => cust(r.customerId)?.name ?? ""),
  ...summary.callList.top.slice(0, 3).map((x) => x.name),
].filter(Boolean);
const usedSurnames = new Map<string, string>(); // surname → the full name using it
const usedStreets = new Set<string>([streetName(cust(featured.customerId)!.address?.street ?? "")]);
for (const n of fixedNames) if (!usedSurnames.has(surname(n))) usedSurnames.set(surname(n), n);
/** Whether a person can be shown beside everyone already chosen; if so, they're chosen. */
function takeName(name: string, street?: string): boolean {
  const owner = usedSurnames.get(surname(name));
  if (owner && owner !== name) return false;
  if (street !== undefined) {
    if (/\bmain st\b/i.test(street)) return false;
    if (!fixedNames.includes(name) && usedStreets.has(streetName(street))) return false;
    usedStreets.add(streetName(street));
  }
  usedSurnames.set(surname(name), name);
  return true;
}
const round = new Set(firsts.map((t) => t.customerId));
// The people the round writes to, as the scan ranks them: the first-day ones first, the welcome text's person on top.
const roundPeople = firsts
  .map((t) => start.scan!.opportunities.find((o) => o.id === t.opportunityId)!)
  .slice(0, 12)
  .map(person);

// The other replies the Replies view shows, one of each other kind, that read naturally for this trade: the sorting.
// Only replies from before his: the view stands as it did when his hand-off text went, so the console never runs
// ahead of the phone beside it.
// One more who wants the work (a price, else the job; the earliest), then one of each kind that doesn't (the latest,
// so one of them comes in after the other who wants the work and lands below them: the sort shows as they arrive).
const SORT_ORDER = [["wants_price", "wants_it"], ["later"], ["already_done"], ["moved"], ["not_interested"], ["stop"]];
const others: Reply[] = [];
// side by side in one list, two people with the same first name read as a generator's ("Tom Hall", "Tom Abbott")
const firstName = (x: Reply) => cust(x.customerId)?.name.split(/\s+/)[0]?.toLowerCase();
for (const kinds of SORT_ORDER) {
  const fits = (x: Reply) => x.id !== featured.id && x.receivedAt < featured.receivedAt && reads(x) && !!x.customerId && ![featured, ...others].some((y) => firstName(y) === firstName(x));
  const pool = kinds[0] === "wants_price" ? final.replies : [...final.replies].reverse();
  const r = kinds.map((k) => pool.find((x) => x.intent === k && fits(x) && takeName(cust(x.customerId)!.name))).find(Boolean);
  if (r) others.push(r);
  if (others.length === 4) break;
}

// The rows of his list the film shows: the first day's people as the scan ranks them, the one we follow among them,
// no two the same worth (a run of identical estimates reads as made up even when it's the engine's arithmetic).
const tableRows = (() => {
  const day1 = firsts.filter((t) => firstDayIds.has(t.customerId)).map((t) => start.scan!.opportunities.find((o) => o.id === t.opportunityId)!);
  const rows: Opportunity[] = [];
  const featuredOpp = start.scan!.opportunities.find((o) => o.id === featured.opportunityId)!;
  // a seasonal shop's people last here in its season (the sample's one-off jobs fall on any day, a lawn program's in December)
  const season = SEASONAL_TRADES.has(p.trade) ? growingSeason(business) : undefined;
  const inSeason = (o: Opportunity) => {
    const on = (o.lastDoneOn ?? o.anchorDate ?? "").slice(5);
    return !season || (on >= season.opens && on <= season.fallEnds);
  };
  for (const o of day1) {
    if (rows.length >= 7) break;
    const c = cust(o.customerId)!;
    if (o === featuredOpp || (inSeason(o) && o.value !== featuredOpp.value && !rows.some((x) => x.value === o.value) && takeName(c.name, c.address?.street ?? ""))) rows.push(o);
  }
  if (!rows.includes(featuredOpp)) rows.splice(rows.length - 1, 1, featuredOpp);
  // the one we follow third, well above the list's bottom fade
  rows.splice(2, 0, ...rows.splice(rows.indexOf(featuredOpp), 1));
  return rows.map(person);
})();

const noteOf = (customerId: string) => {
  const t = final.touches.find((x) => x.customerId === customerId && x.step === 1)!;
  const footerAt = t.body!.lastIndexOf(`\n\n${business.name} · `);
  return { to: cust(customerId)!.name, sendAt: t.dueAt, subject: t.subject, body: t.body!.slice(0, footerAt).trim(), footer: t.body!.slice(footerAt).trim(), full: t.body };
};

const replyOut = (r: Reply) => ({
  name: cust(r.customerId)?.name ?? null,
  receivedAt: r.receivedAt,
  intent: r.intent,
  label: appLabels[r.intent]?.label ?? r.intent,
  tone: appLabels[r.intent]?.tone ?? "neutral",
  text: r.text,
  job: oppOf(r.opportunityId)?.jobPhrase ?? null,
  ack: r.ack?.text ?? null,
  outcome: r.outcome ?? null,
  outcomeValue: r.outcomeValue ?? null,
});

// When each booking reached his results: the moment he told us (his BOOKED), else the day his records show it.
const reachedAt = (x: AccountState["recoveries"][number]) => (x.match === "owner_reported" ? final.replies.find((r) => r.id === x.record.id)?.bookedAt : undefined) ?? `${x.cameBackOn}T23:59:59`;
// The Replies tab's chips (apps/web/src/live/ClientWork.tsx) as they stand once the shown replies are in.
const WANTS = ["wants_it", "wants_price", "question"];
const shownUntil = featured.receivedAt;
const inBy = final.replies.filter((r) => r.receivedAt <= shownUntil);
const replyChips = {
  at: shownUntil,
  wantedTheWork: inBy.filter((r) => WANTS.includes(r.intent)).length,
  later: inBy.filter((r) => r.intent === "later").length,
  closedOut: inBy.filter((r) => !WANTS.includes(r.intent) && !["later", "unclear", "auto_reply", "bounce"].includes(r.intent)).length,
  everything: inBy.length,
};

const recoveries = [...final.recoveries].filter((r) => !r.disputed).sort((x, y) => (reachedAt(x) < reachedAt(y) ? -1 : reachedAt(x) > reachedAt(y) ? 1 : 0));
const featuredRec = recoveries.find((r) => r.match === "owner_reported" && r.record.id === featured.id);
const earlier = recoveries.filter((r) => r !== featuredRec && reachedAt(r) < bookedAt);
const runningBefore = earlier.reduce((s, r) => s + r.value, 0);
const end = totals(final);
const handoff = final.ownerMessages.find((m) => m.kind === "handoff" && m.refs?.some((x) => x.kind === "customer" && x.id === featured.customerId));
const sent = final.touches.filter((t) => t.status === "sent" || t.status === "delivered");

// The round's tally as it stood at a moment (the engine's own count: who wrote back, and who asked to come back).
const tallyAt = (iso: string) => {
  const st = structuredClone(final);
  st.replies = st.replies.filter((r) => r.receivedAt <= iso);
  const t = totals(st);
  return { replied: t.replied, asked: t.wants };
};
const atBooking = tallyAt(bookedAt);

// The free round's last text (the close) and his YES to it, answered by the server's own code. The film shows the
// close's tally and its price line, not its "And the guarantee:" line (BRIEF §1: the promise is never a heading; the
// film's own chip says it in the brief's words), nor its "Say yes by" deadline, nor "There are … more behind them".
const closeMsg = final.ownerMessages.find((m) => m.kind === "close");
const plusMinutes = (local: string, min: number) => new Date(Date.parse(`${local.slice(0, 19)}Z`) + min * 60_000).toISOString().slice(0, 19);
const yesAt = closeMsg ? plusMinutes(closeMsg.at, 26) : undefined;
const yes = closeMsg && yesAt ? await ownerTexts(final, yesAt, "YES") : undefined;
const closeShown = closeMsg?.text
  .split("\n\n")
  .filter((x) => !/^(And the guarantee|Say yes by|There are |Or pay for the year|https?:)/.test(x))
  .join("\n\n");
const intentCount = (k: string[]) => final.replies.filter((r) => k.includes(r.intent)).length;

const content = {
  _about:
    "Generated by apps/web/film/content.ts from the software itself; regenerate, never hand-edit. Every string and number here is the engine's or the server's output for the made-up company in film/profiles.ts.",
  generatedFrom: { trade: p.trade, asOf: p.asOf, sampleSeed: p.sampleSeed, simSeed, simDays: p.simDays, spread },
  company: {
    name: business.name,
    ownerName: business.ownerName,
    ownerFirstName: business.ownerFirstName,
    signerName: business.signerName,
    town: `${p.company.city}, ${p.company.state}`,
    mailingAddress: business.mailingAddress,
    trade: p.trade,
  },
  // The offer the company is on, in the brief's words (BRIEF §1). Monthly (lawn, cleaning): "free" beside its price,
  // and the one monthly promise. A one pass (tree, painting, fence) has its own promise, in the engine's words.
  offer: isOnePass(business.plan)
    ? { kind: "one_pass", lines: [passPromise(business.plan)], wanted: wantedWords(business.plan) }
    : {
        kind: "monthly",
        trialSize: business.plan.trialSize,
        monthlyPrice: business.plan.monthlyPrice,
        lines: [`First ${business.plan.trialSize} free, then ${fmtMoney(business.plan.monthlyPrice)}/mo if you say yes.`, "Any month nobody asks to come back, you don't pay."],
        wanted: wantedWords(business.plan),
      },
  export: {
    software: p.software,
    // when it reached us, and when we read it: the same moment
    receivedAt: p.exportAt,
    fileName: file.name,
    rows: file.text.trim().split("\n").length - 1,
    records: start.dataset.jobs.length,
    customers: start.dataset.customers.length,
    years: `${start.dataset.jobs.map((j) => j.createdOn ?? "").filter(Boolean).sort()[0]?.slice(0, 4)}–${p.asOf.slice(0, 4)}`,
  },
  found: {
    pastCustomersNotBack: summary.onTheTable.pastCustomersNotBack,
    opportunities: summary.opportunities,
    reachablePeople: summary.reachablePeople,
    reachableValue: summary.reachableValue,
    totalValue: summary.totalValue,
    byType: summary.byType.map((t) => ({ type: t.type, label: BREAKAGE_LABEL[t.type].title, explain: BREAKAGE_LABEL[t.type].explain, found: t.count, reachable: t.reachable, value: t.value, reachableValue: t.reachableValue })),
    leftAlone: Object.entries(start.scan!.stats.suppressedBy).map(([why, n]) => ({ why, n })),
  },
  round: {
    people: round.size,
    firstDay: firstNote.dueAt.slice(0, 10),
    firstDayPeople: firstDayIds.size,
    notesPlanned: start.touches.length,
    people12: roundPeople,
    table: tableRows,
  },
  note: noteOf(firstNote.customerId),
  // The Notes tab's chips (ClientWork.tsx): every note waits for his OK, then all are scheduled; the first day's go out.
  noteChips: {
    waitingForApproval: start.touches.filter((t) => t.status === "planned").length,
    scheduledAfterOk: approved.touches.filter((t) => t.status === "approved").length,
    sentFirstDay: final.touches.filter((t) => (t.status === "sent" || t.status === "delivered") && t.dueAt.slice(0, 10) === firstNote.dueAt.slice(0, 10)).length,
    scheduledAfterFirstDay: approved.touches.filter((t) => t.status === "approved").length - final.touches.filter((t) => (t.status === "sent" || t.status === "delivered") && t.dueAt.slice(0, 10) === firstNote.dueAt.slice(0, 10)).length,
    sentByEnd: sent.length,
  },
  notesGoingOut: firsts.slice(0, 8).map((t) => ({ to: cust(t.customerId)!.name, sendAt: t.dueAt, subject: t.subject, job: oppOf(t.opportunityId)?.jobPhrase ?? null })),
  // The Notes tab's rows the film shows: the first day's first notes in send order, the one we follow among them.
  notesTable: (() => {
    const f = firsts.find((t) => t.customerId === featured.customerId)!;
    // the first day's notes, and among them one about another job if the day has one (not five rows of "the mowing")
    const day1 = firsts.filter((t) => t !== f && firstDayIds.has(t.customerId));
    const other = day1.find((t) => t.subject !== f.subject && takeName(cust(t.customerId)!.name));
    const rest: Touch[] = [];
    for (const t of day1) {
      if (rest.length >= (other ? 3 : 4)) break;
      if (t !== other && takeName(cust(t.customerId)!.name)) rest.push(t);
    }
    const rows = [f, ...rest, ...(other ? [other] : [])];
    return rows.sort((x, y) => (x.dueAt < y.dueAt ? -1 : 1)).map((t) => ({ to: cust(t.customerId)!.name, sendAt: t.dueAt, note: t.step, subject: t.subject, featured: t.customerId === featured.customerId }));
  })(),
  ownerTexts: {
    // what we found, as the welcome text says it (its first paragraph after the greeting): the List scene's one line
    foundLine: kickoffMsg.text.split("\n\n")[0]!.replace(/^.*?it's Quiet Accounts\.\s*/, ""),
    welcome: { at: kickoffMsg.at, text: kickoffMsg.text },
    ok: { at: okAt, text: "OK", reply: ok.reply },
    handoff: handoff ? { at: handoff.at, text: handoff.text } : { at: featured.handedOffAt, text: handoffText(final, featured) },
    booked: { at: bookedAt, text: bookedText, reply: booked.reply },
    close: closeMsg && yes && yesAt ? { at: closeMsg.at, text: closeShown!, yes: { at: yesAt, text: "YES", reply: yes.reply } } : null,
  },
  featured: {
    ...person(oppOf(featured.opportunityId)!),
    phone: cust(featured.customerId)?.phones[0] ?? null,
    note: noteOf(featured.customerId!),
    reply: replyOut(featured),
    code,
    bookedValue,
  },
  replies: {
    shown: [featured, ...others].map(replyOut),
    all: [...final.replies].sort((x, y) => (x.receivedAt < y.receivedAt ? -1 : 1)).map((r) => ({ name: cust(r.customerId)?.name ?? null, receivedAt: r.receivedAt, intent: r.intent, label: appLabels[r.intent]?.label ?? r.intent })),
    chips: replyChips,
    counts: {
      total: final.replies.length,
      wants: intentCount(["wants_it", "wants_price", "question"]),
      later: intentCount(["later"]),
      closedOut: intentCount(["already_done", "not_interested", "moved", "wrong_person", "stop", "complaint"]),
      autoOrBounce: intentCount(["auto_reply", "bounce"]),
    },
  },
  recovered: {
    before: runningBefore,
    added: bookedValue,
    after: runningBefore + bookedValue,
    jobsBefore: earlier.length,
    jobsAfter: earlier.length + 1,
    // the engine's tally when he texted his BOOKED (the Overview's "asked to come back" tile), and at the round's end
    atBooking,
    endOfRun: { asOf: final.dataset.asOf, booked: end.booked, bookedValue: end.bookedValue, contacted: end.contacted, notesSent: sent.length, replied: end.replied, askedToComeBack: end.wants },
    ledger: recoveries.map((r) => ({ name: cust(r.customerId)?.name ?? null, reachedAt: reachedAt(r), cameBackOn: r.cameBackOn, value: r.value, job: oppOf(r.opportunityId)?.jobPhrase ?? null, what: oppOf(r.opportunityId)?.jobPhrase.replace(/^the /, "") ?? null, match: r.match })),
  },
  closeText: final.ownerMessages.find((m) => m.kind === "close")?.text ?? null,
};

// No two people on screen share a surname, no street shows twice, and none is a Main St (see takeName).
{
  const names = [...new Set([...content.round.table.map((x) => x.name), ...content.notesTable.map((x) => x.to), ...content.replies.shown.map((x) => x.name ?? ""), ...content.recovered.ledger.map((x) => x.name ?? ""), ...summary.callList.top.slice(0, 3).map((x) => x.name), content.featured.name])].filter(Boolean);
  const twice = names.filter((n, i) => names.findIndex((m) => surname(m) === surname(n)) !== i);
  const streets = [...new Map([...content.round.table, content.featured].map((x) => [x.name, x.street])).values()];
  const street2 = streets.filter((x, i) => streets.findIndex((y) => streetName(y) === streetName(x)) !== i || /\bmain st\b/i.test(x));
  if (twice.length || street2.length) throw new Error(`Names on screen repeat (${[...twice, ...street2].join(", ")}): try another sampleSeed in profiles.ts`);
}

// Nothing on screen may say these (the brief, and Jack: "It shouldn't look like it's just some demonstration").
const shown = JSON.stringify({ ...content, _about: "", generatedFrom: {} });
const banned = /\b(example|sample|demo|simulated|placeholder|lorem|john doe|123 main)\b|money-back|risk-free|free trial|guaranteed \d|555-\d{4}/i;
const hit = banned.exec(shown);
if (hit) throw new Error(`content.json would show "${hit[0]}": ${shown.slice(Math.max(0, hit.index - 80), hit.index + 80)}`);

writeFileSync(OUT, `${JSON.stringify(content, null, 2)}\n`);

// The account at each step, to open in the app itself (IndexedDB "acct:<id>") and see the real screens with this
// company in them. Big (the whole export is in it), so it goes wherever it's asked to, never into the repo.
const statesAt = process.argv.indexOf("--states");
if (statesAt > 0 && process.argv[statesAt + 1]) {
  const dir = process.argv[statesAt + 1]!;
  const steps: Record<string, AccountState> = { "1-found": start, "2-approved": approved, "3-before-booking": before, "4-booked": booked.state, "5-end": final };
  for (const [name, st] of Object.entries(steps)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(st));
  console.log(`  states in ${dir}: ${Object.keys(steps).join(", ")}`);
}
console.log(`Wrote ${OUT}`);
console.log(`  ${content.company.name} (${content.company.town}), sim seed ${simSeed}`);
console.log(`  featured: ${content.featured.name}, ${content.featured.job}: "${featured.text}" → booked ${fmtMoney(bookedValue)}`);
console.log(`  recovered ${fmtMoney(content.recovered.before)} → ${fmtMoney(content.recovered.after)}; end of run ${fmtMoney(end.bookedValue)} from ${end.booked} jobs`);
