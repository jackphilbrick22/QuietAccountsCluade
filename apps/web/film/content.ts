/**
 * The service film's words and numbers, out of the software itself. Nothing on screen is typed in: the company's
 * records are the sample generator's (made for a made-up company, profiles.ts), the people who stopped and what
 * they're worth are the engine's scan, the note is the engine's note, the welcome and hand-off texts are the engine's
 * owner texts, the replies are the simulator's run through the real Inbox reader, and the texts back to the owner
 * ("Done — the first notes go out…", "Booked: …") are the server's own answers to his OK and his BOOKED.
 *
 *   pnpm --filter @qa/web film:content [trade]       (writes film/content.json; another trade writes content.<trade>.json)
 *   … [trade] --states <dir>                         (also writes the account as it stands at each step, for the app)
 *   FILM_SAMPLE_SEED=film-tree-7 FILM_OUT=<file> …   (another business for the trade, written elsewhere: for when the
 *                                                     names on screen repeat and another seed is wanted)
 *
 * A monthly trade (lawn, cleaning) is the free 150 and its close; a one pass (fence, tree) is the whole list once,
 * newest first, from as many inboxes as its 30 days need, and its last text once the list is done, with the charges
 * its bookings made settled by the engine's billing.
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
  billableBookings,
  BREAKAGE_LABEL,
  callListNamed,
  chargePaid,
  emptyDataset,
  emptyState,
  find,
  fmtMoney,
  generateSample,
  growingSeason,
  handoffText,
  holdsPlace,
  isOnePass,
  leadCode,
  onePassPlan,
  passEndIfDue,
  passPaid,
  passPromise,
  planBatch,
  readFiles,
  SEASONAL_TRADES,
  settleCharges,
  simulate,
  soldMonthly,
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
import { SIM_REPLIES } from "@qa/engine/sim/replies.ts";
import { PROFILES, type FilmProfile } from "./profiles.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const trade = (process.argv[2] ?? "lawn") as keyof typeof PROFILES;
const profile = PROFILES[trade];
if (!profile) throw new Error(`No film profile for "${trade}". Add one in film/profiles.ts.`);
const OUT = process.env.FILM_OUT ?? join(HERE, trade === "lawn" ? "content.json" : `content.${trade}.json`);

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
    // the trade's offer (BRIEF §2): the free 150 then monthly for lawn and cleaning, one pass for the rest
    plan: soldMonthly(p.trade) ? base.plan : onePassPlan(),
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
// FILM_SAMPLE_SEED tries another business (when the names on screen repeat): the profile's seed is the film's
if (process.env.FILM_SAMPLE_SEED) p.sampleSeed = process.env.FILM_SAMPLE_SEED;
const sample = generateSample({ trade: p.trade, asOf: p.asOf, seed: p.sampleSeed, businessName: p.company.name, ownerName: p.company.ownerName, signerName: p.company.signerName });
const business = companyProfile(p, sample.business);
const files = p.exportFiles.map((name) => {
  const f = sample.files.find((x) => x.name === name);
  if (!f) throw new Error(`The sample has no ${name}: ${sample.files.map((x) => x.name).join(", ")}`);
  // the profile's own names for the sample shop's work (fence: vinyl, not cedar or pickets)
  let text = f.text;
  for (const [from, to] of p.retitle ?? []) {
    if (!text.includes(from) && !sample.files.some((x) => x.text.includes(from))) throw new Error(`retitle: no "${from}" in the sample`);
    text = text.split(from).join(to);
  }
  return { ...f, text };
});
const pass = isOnePass(business.plan);

/** His export read, the list found, and the round (or the pass) planned, as on the morning we text him. */
function planned(b: BusinessProfile) {
  const st = emptyState(emptyDataset(b, p.asOf), `${p.exportAt}:00`);
  readFiles(st, files, `${p.exportAt}:00`);
  for (const c of st.dataset.customers) c.phones = c.phones.map(testExchange);
  find(st, `${p.asOf}T08:01:00`);
  // the free round is its 150; a one pass is the whole list, once, newest first
  planBatch(st, `${p.asOf}T08:02:00`, { startOn: addDays(p.asOf, 1), limitPeople: pass ? undefined : b.plan.trialSize });
  return st;
}
// A one pass is paced to finish in its 30 days with no inbox over 30 notes a day: it sends from as many inboxes as its
// pace asks for (the console's "N more inboxes would meet the end date"), the way Jack sets one up. Off screen.
if (pass) {
  const more = planned(structuredClone(business)).dataset.business.plan.pace?.late?.moreInboxes ?? 0;
  business.fromEmails = Array.from({ length: 1 + more }, (_, i) => `${business.ownerFirstName.toLowerCase()}${i ? i + 1 : ""}@${p.company.domain}`);
}
const start = planned(business);
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

/**
 * The four films sit side by side on the site (every trade page has a switch to the others), so a reply shown in one
 * is never shown in another: "Try me next year, money's tight right now." in two films reads as a script. Replies are
 * compared by the simulator's line they come from ("Yes. Is Tuesday possible?" and "Yes. Is Thursday possible?" are one
 * line). Each film keeps clear of the films before it in FILM_ORDER (lawn first: it's the film Jack approved), and
 * says which films after it now need writing again.
 */
const FILM_ORDER = ["lawn", "cleaning", "fence", "tree"] as const;
const SIM_LINES = Object.values(SIM_REPLIES).flat() as string[];
const lineOf = (text: string) => SIM_LINES.find((t) => templateRe(t).test(text.trim())) ?? text.trim();
const filmFile = (t: string) => join(HERE, t === "lawn" ? "content.json" : `content.${t}.json`);
const linesIn = (t: string): Map<string, string> => {
  try {
    const c = JSON.parse(readFileSync(filmFile(t), "utf8")) as { replies: { shown: { text: string }[] } };
    return new Map(c.replies.shown.map((r) => [lineOf(r.text), r.text]));
  } catch {
    return new Map();
  }
};
const myPlace = FILM_ORDER.indexOf(trade as (typeof FILM_ORDER)[number]);
/** The reply lines the films before this one show (to keep clear of), and the films after it (to say which to redo). */
const takenBefore = new Set(FILM_ORDER.filter((_, i) => myPlace < 0 || i < myPlace).flatMap((t) => [...linesIn(t).keys()]));
const shownAfter = FILM_ORDER.filter((t, i) => myPlace >= 0 && i > myPlace).map((t) => ({ trade: t, lines: linesIn(t) }));

/**
 * Names a viewer knows from somewhere else. The sample's first and last names are drawn apart, so now and then they
 * meet as a cartoon character ("Hank Hill"), a sitcom's ("Rachel Green") or a celebrity's ("Tim Cook"), and the film
 * reads as made up. None of them is ever on screen.
 */
const FAMOUS = new Set(
  [
    "Hank Hill", "Rachel Green", "Tim Allen", "Steve Allen", "Paul Allen", "Tim Cook", "Sam Cook", "Sam Adams", "Amy Adams", "Ryan Adams",
    "Chris Evans", "Bill Evans", "Chris Martin", "Steve Martin", "Mark Martin", "Jim Morrison", "Nick Carter", "Gary Carter", "Joe Walsh",
    "Tina Turner", "Gary Cooper", "Chris Cooper", "Carol King", "Gail King", "Joan Collins", "Amy Grant", "Tim Scott", "Pete Parker",
    "Kevin Parker", "Steve Young", "Mike Johnson", "Tara Reed", "Sean Hayes", "Ken Rogers", "Pat Morris", "Ben Stone", "Kelly Clark",
    "Kevin Hart", "Ryan Murphy", "Andre Young", "Jim Carter", "Mike Evans", "Ryan Phillips", "Gary Collins", "Pat Sullivan",
  ].map((n) => n.toLowerCase()),
);
const famous = (name: string) => FAMOUS.has(name.trim().toLowerCase());
/**
 * A reply that puts off to the month or season it came in reads wrong: "Can you reach out again in March?" written in
 * March, "maybe in the spring" on the last day of April.
 */
const MONTH_WORDS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SEASON_OF = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "winter"];
const timeReads = (r: Reply) => {
  const m = Number(r.receivedAt.slice(5, 7)) - 1;
  return !new RegExp(`\\b(?:in|until|till|after) (?:the )?(?:${MONTH_WORDS[m]}|${SEASON_OF[m]})\\b`, "i").test(r.text);
};
/** A reply this film can show: it reads as this trade's and as of its day, and no film before it shows its line. */
const reads = (r: Reply) => !p.avoidInReplies.test(r.text) && timeReads(r) && !takenBefore.has(lineOf(r.text));
/** The three people the welcome text's call list names (the engine's pick), and a person's first name. */
const callNamed = callListNamed(start.summary!.callList.top);
const firstOf = (name: string) => name.trim().split(/\s+/)[0]!.toLowerCase();
const firstDayIds = new Set(firsts.filter((t) => t.dueAt.slice(0, 10) === firstNote.dueAt.slice(0, 10)).map((t) => t.customerId));

/** Two notes that read the same once the greeting's name is set aside. */
const sameNote = (a: string, b: string) => a.replace(/^Hi [^,\n]+,/, "") === b.replace(/^Hi [^,\n]+,/, "");

/**
 * The record a person is on the list for, as his export has it: the quote that never booked (its title, the day it
 * went, its price, its number), or their last job.
 */
function recordOf(st: AccountState, o: Opportunity) {
  if (o.source.kind === "quote") {
    const q = st.dataset.quotes.find((x) => x.id === o.source.id);
    return q ? { kind: "quote" as const, title: q.title, on: q.sentOn ?? q.createdOn ?? null, total: q.total, number: q.number ?? null } : undefined;
  }
  if (o.source.kind === "job") {
    const j = st.dataset.jobs.find((x) => x.id === o.source.id);
    return j ? { kind: "job" as const, title: j.title, on: j.completedOn ?? j.scheduledOn ?? j.createdOn ?? null, total: j.total ?? null, number: j.number ?? null } : undefined;
  }
  return undefined;
}

/** The ledger's rows before his that the Overview shows (they reach the card's bottom fade). */
const LEDGER_ROWS_BEFORE = 4;
/** The bookings after his that land in the ledger as the weeks go by; the figures above it count the rest to the end. */
const LEDGER_ROWS_AFTER = 2;
const OTHER_KINDS = ["wants_price", "later", "already_done", "moved", "not_interested"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/**
 * Whether the owner's call (his BOOKED) comes no sooner than our answer said it would: on the day it named ("today",
 * "tomorrow", "on Monday", counted from when the answer went) and, if it named a time ("after 5"), not before it.
 */
function keepsPromise(r: Reply): boolean {
  const at = r.bookedAt ?? r.ownerContactedAt;
  const ack = r.ack?.text ?? "";
  if (!at || !ack) return true;
  const from = (r.ack?.sentAt ?? r.receivedAt).slice(0, 10);
  const named = /give you a call(?: at [^,]*?)? (today|tomorrow|on (Monday|Tuesday|Wednesday|Thursday|Friday))(?: after (\d{1,2}))?\b/.exec(ack);
  if (!named) return true;
  let day = from;
  if (named[1] === "tomorrow") day = addDays(from, 1);
  else if (named[2]) {
    day = addDays(from, 1);
    while (WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()] !== named[2]) day = addDays(day, 1);
  }
  if (at.slice(0, 10) < day) return false;
  const after = named[3] ? (Number(named[3]) % 12) + 12 : 0;
  return !(at.slice(0, 10) === day && Number(at.slice(11, 13)) < after);
}
const custIn = (st: AccountState, id: string | undefined) => st.dataset.customers.find((c) => c.id === id);
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
 * of person first in the list. On a one pass it's an old quote, for the work the profile names (`featureWork`: a
 * fence, a removal), and its quote's price agrees with the booking like a job's.
 */
function followable(st: AccountState): { featured: Reply; score: number }[] {
  const out: { featured: Reply; score: number }[] = [];
  const recs = [...st.recoveries].filter((x) => !x.disputed).sort((a, b) => (a.cameBackOn < b.cameBackOn ? -1 : a.cameBackOn > b.cameBackOn ? 1 : 0));
  for (const r of st.replies) {
    const rank = wantsRank(r.text);
    const o = st.scan?.opportunities.find((x) => x.id === r.opportunityId);
    if (r.intent !== "wants_it" || r.outcome !== "booked" || rank < 0 || !reads(r) || !o || !p.featureTypes.includes(o.type)) continue;
    const touch = st.touches.find((t) => t.id === r.touchId);
    if (touch?.step !== 1 || r.customerId === firstNote.customerId) continue;
    const rec = recordOf(st, o);
    if (!rec || p.seasonJob.test(rec.title) || (p.featureWork && !p.featureWork.test(rec.title))) continue;
    // a regular who stopped was a regular: six visits or more ("Used you 2 times" and a $325 booking is no regular)
    if (o.type === "lapsed_regular" && st.dataset.jobs.filter((j) => j.customerId === r.customerId).length < 6) continue;
    const agree = (x: number | null | undefined) => x !== undefined && x !== null && Math.abs(x - o.value) <= 0.25 * o.value;
    if (!agree(r.outcomeValue) || (o.type !== "lapsed_regular" && !agree(rec.total))) continue;
    if (sameNote(touch.body ?? "", firstNote.body ?? "")) continue;
    // a one pass's notes are each about their own quote: the one we follow isn't for the same job as the welcome
    // text's first note (both are on screen: "the birch by the driveway" twice reads as one template)
    if (pass && o.jobPhrase === st.scan?.opportunities.find((x) => x.id === firstNote.opportunityId)?.jobPhrase) continue;
    // nor of the first name of anyone the welcome text's call list names, nor on a one pass for their job (his phone
    // shows both: "Nancy Stone (vinyl fence in the backyard)" above the one we follow, Nancy Donovan's vinyl fence,
    // reads as one; a lawn book is mowing through and through)
    const name = custIn(st, r.customerId)?.name ?? "";
    if (famous(name) || callNamed.some((x) => (pass && x.job === o.jobPhrase.replace(/^the /, "")) || firstOf(x.name) === firstOf(name))) continue;
    const callHour = Number((r.bookedAt ?? r.ownerContactedAt ?? "").slice(11, 13));
    if (!(callHour >= 9 && callHour < 19)) continue;
    const kinds = new Set(st.replies.filter((x) => x.receivedAt < r.receivedAt && x.customerId && reads(x) && OTHER_KINDS.includes(x.intent)).map((x) => x.intent));
    const mine = recs.findIndex((x) => x.match === "owner_reported" && x.record.id === r.id);
    const after = mine < 0 ? 9 : recs.length - 1 - mine;
    const hour = Number(r.receivedAt.slice(11, 13));
    // what reads as scripted: a note, a reply or a booking exactly on the hour ("9:00 AM", "7:00 PM")
    const onHour = [touch.dueAt, r.receivedAt, r.bookedAt ?? r.ownerContactedAt ?? ""].filter((x) => x.slice(14, 16) === "00").length;
    // our answer promised when he'd call ("today", "tomorrow after 5", "on Monday"): his BOOKED comes then or after,
    // never before it (both are on screen)
    if (!keepsPromise(r)) continue;
    // the round's last text names him among its bookings, as the film follows him to it (a one pass's names nobody)
    const close = st.ownerMessages.find((m) => m.kind === "close");
    const unnamed = close && !close.text.includes(custIn(st, r.customerId)?.name ?? "\u0000") ? 1 : 0;
    // a one pass follows an old quote (a year or more): the one nobody asked about again, the pass's whole point
    const fresh = pass && rec.on && Date.parse(p.asOf) - Date.parse(rec.on) < 365 * 864e5 ? 1 : 0;
    // a reply in the night is answered at 7 (his hand-off then says "At 7am we'll write back…"): the daytime reads plainer
    const night = hour < 7 || hour >= 21 ? 1 : 0;
    // the hand-off says the old price is old and to re-price it: a re-price after a year or more goes up, so on a one
    // pass he books at or over the quote (booking under it reads backwards)
    const under = pass && rec.total && (r.outcomeValue ?? 0) < rec.total ? 1 : 0;
    const score = 100 * Math.max(0, 3 - kinds.size) + 50 * after + rank * 10 + (hour >= 8 && hour < 20 ? 0 : 50) + 250 * night + p.featureTypes.indexOf(o.type) + 40 * onHour + 60 * unnamed + 150 * fresh + 120 * under;
    out.push({ featured: r, score });
  }
  return out.sort((a, b) => a.score - b.score);
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
  const picks = followable(st);
  return { seed, bookedValue: t.bookedValue, contacted: t.contacted, pick: picks[0], picks };
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
// A one pass ends when its list is done (passEndIfDue): every note sent or stopped by a reply, then a few days for the
// replies to its last notes (a week, or three once its end date has passed). Its last text is the tally and what he paid, so
// the pass's charges are settled first by the engine's own billing: a charge for each billable booking, in the order
// they booked, up to the cap, each paid (Jack's OK and the owner's link are the steps between them, off screen).
// The run as the film ends it: at the free round's close, or the one pass's last text. The Overview, the ledger and the
// close all read from here, so the console and his phone say the same thing.
function endingOf(fin: AccountState) {
  const passEnd = (() => {
    if (!pass) return undefined;
    const out = fin.touches.filter((t) => t.status === "sent" || t.status === "delivered" || t.status === "bounced");
    const last = out.map((t) => (t.sentAt ?? t.dueAt).slice(0, 10)).sort().pop()!;
    for (let day = addDays(last, 1); day <= fin.dataset.asOf; day = addDays(day, 1)) {
      const at = `${day}T09:00:00`;
      const st = asAt(fin, at);
      for (let i = 0; i < 12; i++) {
        settleCharges(st, at, { stripe: false });
        const open = (st.dataset.business.plan.charges ?? []).filter((c) => c.status !== "paid" && holdsPlace(c));
        if (!open.length) break;
        for (const c of open) chargePaid(st, c.id, at, { by: "outside" });
      }
      const m = passEndIfDue(st, at);
      if (m) return { at, text: m.text, state: st };
    }
    throw new Error(`The one pass didn't end by ${fin.dataset.asOf}: raise simDays in profiles.ts`);
  })();
  const closeMsg = fin.ownerMessages.find((m) => m.kind === "close");
  const endState = passEnd?.state ?? (closeMsg ? asAt(fin, closeMsg.at) : fin);
  return { passEnd, closeMsg, endState };
}

/**
 * The ledger's rows the Overview can show: newest on top, so the few before his that sit above the card's bottom fade,
 * his, and the ones after. (A one pass books dozens; the rest of them are in the figures, under the fade.)
 */
function ledgerOf(fin: AccountState, f: Reply, endState: AccountState) {
  // When each booking reached his results: the moment he told us (his BOOKED), else the day his records show it.
  const reachedAt = (x: AccountState["recoveries"][number]) => (x.match === "owner_reported" ? fin.replies.find((r) => r.id === x.record.id)?.bookedAt : undefined) ?? `${x.cameBackOn}T23:59:59`;
  const at = f.ownerContactedAt!;
  const recoveries = [...endState.recoveries].filter((r) => !r.disputed).sort((x, y) => (reachedAt(x) < reachedAt(y) ? -1 : reachedAt(x) > reachedAt(y) ? 1 : 0));
  const featuredRec = recoveries.find((r) => r.match === "owner_reported" && r.record.id === f.id);
  const earlier = recoveries.filter((r) => r !== featuredRec && reachedAt(r) < at);
  const later = recoveries.filter((r) => r !== featuredRec && reachedAt(r) >= at);
  const shown = [...earlier.slice(-LEDGER_ROWS_BEFORE), ...(featuredRec ? [featuredRec] : []), ...later.slice(0, LEDGER_ROWS_AFTER)];
  return { reachedAt, featuredRec, earlier, later, shown };
}
// --seed <simSeed> looks at one particular run (to compare picks); the film uses the best-scoring one whose ledger
// keeps clear of the names the film has already put on screen (the welcome text's first note, the call list): the
// ledger is the run's own, so a clash is a reason to take the next run, never to drop a row from it
const seedArg = process.argv.includes("--seed") ? process.argv[process.argv.indexOf("--seed") + 1] : undefined;
const surname = (name: string) => name.trim().split(/\s+/).at(-1)!.toLowerCase();
const shownFirst = [custIn(start, firstNote.customerId)!.name, ...callNamed.map((x) => x.name)];
/**
 * Two people among the names a run fixes on screen (with the welcome's first note and the call list) sharing a
 * surname, or one of them a name a viewer knows from somewhere else.
 */
const clashes = (names: string[]) => {
  const all = [...new Set([...shownFirst, ...names.filter(Boolean)])];
  return all.some((n, i) => all.findIndex((m) => surname(m) === surname(n)) !== i) || all.some(famous);
};
/**
 * First names that meet where they're read together, as the Replies view keeps them apart: two of the ledger's rows
 * ("Mike Wright" over "Mike Martin"), the welcome text's first note and its call list ("Nancy Stone" there, Nancy
 * Donovan followed), and a name in the round's last text beside a different person in the ledger it sits next to
 * ("Tim Donovan" in the text, "Tim Green" in the ledger). How many pairs: each costs a run's pick some of its score, so
 * a much better story can carry one (lawn's two Sarahs, rows apart), and an even one goes to the run without.
 */
const firstNamesMeet = (ledgerNames: string[], closeNames: string[]) => {
  const pairs = (names: string[]) => {
    const all = [...new Set(names.filter(Boolean))];
    return all.reduce((n, a, i) => n + all.slice(i + 1).filter((b) => firstOf(a) === firstOf(b)).length, 0);
  };
  const ledger = [...new Set(ledgerNames.filter(Boolean))];
  const textOnly = [...new Set(closeNames)].filter((n) => !ledger.includes(n));
  return pairs(ledger) + pairs(shownFirst) + textOnly.reduce((n, a) => n + ledger.filter((b) => firstOf(a) === firstOf(b)).length, 0);
};
/** What a pair of first names meeting costs a run's pick (its score: lower is better). */
const FIRST_NAMES_MEET = 150;
/** The names the round's last text gives (the free round's names its first bookings; a one pass's names nobody). */
const closeNames = (fin: AccountState, text: string | undefined) => (text ? fin.dataset.customers.filter((c) => c.name && text.includes(c.name)).map((c) => c.name) : []);
/**
 * On a one pass the Overview shows Booked's jobs beside the console's Billable bookings ("4 of 4 · 7 more past the
 * cap"): they must add up wherever both are on screen (as his booking lands, and as the ledger's last row does). A
 * booking the billing doesn't count (booked before they wrote back, one person twice) would leave them a job apart.
 */
const billingAddsUp = (fin: AccountState, f: Reply, ledger: ReturnType<typeof ledgerOf>) => {
  if (!pass) return true;
  const shownLast = ledger.shown.at(-1);
  const moments = [f.ownerContactedAt!, ...(shownLast ? [ledger.reachedAt(shownLast)] : [])];
  return moments.every((iso) => {
    const st = asAt(fin, `${iso}Z`);
    const b = billableBookings(st);
    const jobs = ledger.earlier.length + ledger.shown.filter((r) => !ledger.earlier.includes(r) && ledger.reachedAt(r) <= iso).length;
    return b.billable.length + b.overCap.length === jobs && totals(st).booked === jobs;
  });
};
let picked: { chosen: (typeof typical)[number]; final: AccountState; featured: Reply; ending: ReturnType<typeof endingOf>; ledger: ReturnType<typeof ledgerOf> } | undefined;
// every reply the film could follow in every typical run, best first (a run's second-best can beat another's best)
const candidates = (seedArg ? typical.filter((r) => r.seed === seedArg) : typical).flatMap((r) => r.picks.map((pk) => ({ run: r, pk }))).sort((a, b) => a.pk.score - b.pk.score);
// the best story, its score plus what its first names meeting cost: once the next candidate's own score can't beat
// the best so far, the search stops
let best = Infinity;
for (const { run: cand, pk } of candidates) {
  if (pk.score >= best) break;
  const fin = run(cand.seed);
  const f = fin.replies.find((r) => r.id === pk.featured.id)!;
  const ending = endingOf(fin);
  const ledger = ledgerOf(fin, f, ending.endState);
  const ledgerNames = ledger.shown.map((r) => custIn(fin, r.customerId)?.name ?? "");
  const fixed = [custIn(fin, f.customerId)!.name, ...ledgerNames];
  const why = clashes(fixed) ? "names repeat" : !billingAddsUp(fin, f, ledger) ? "billing doesn't add up" : "";
  const meet = firstNamesMeet(ledgerNames, closeNames(fin, ending.closeMsg?.text));
  if (process.argv.includes("--picks")) console.log(`  ${cand.seed} ${pk.score} ${custIn(fin, f.customerId)!.name} ${f.receivedAt} ${f.outcomeValue} "${f.text.slice(0, 40)}": ${why || (meet ? `${meet} first names meet` : "ok")} (${[...shownFirst, ...fixed].join(", ")})`.slice(0, 260));
  if (!seedArg && why) continue;
  if (pk.score + meet * FIRST_NAMES_MEET >= best) continue;
  best = pk.score + meet * FIRST_NAMES_MEET;
  picked = { chosen: { ...cand, pick: pk }, final: fin, featured: f, ending, ledger };
  if (seedArg) break;
}
if (!picked) throw new Error("No typical run had a reply the film can follow: widen simSeeds or preferWants in profiles.ts");
const chosen = picked.chosen;
const spread = { runs: runs.length, reachedEveryone: healthy.length, bookedValue: { low: healthy[0]!.bookedValue, quarter: low, median: q(0.5), threeQuarters: high, high: healthy.at(-1)!.bookedValue } };
const final = picked.final;
const featured = picked.featured;
const simSeed = chosen.seed;


/* ------------------------------ the booking, as he texts it ------------------------------ */

// The run had him call back and book; the film shows him texting BOOKED. The server answers that text on the state
// as it stood just before: replies that hadn't come in yet aren't there, and calls he hadn't made yet aren't made.
/** The run as it stood at a moment: replies not in yet aren't there, and calls not made yet (from `iso` on) aren't made. */
function asAt(st: AccountState, iso: string): AccountState {
  const out = structuredClone(st);
  out.replies = out.replies.filter((r) => r.receivedAt <= iso);
  for (const r of out.replies)
    if (r.ownerContactedAt && r.ownerContactedAt >= iso) {
      for (const k of ["ownerContactedAt", "bookedAt", "outcome", "outcomeValue"] as const) delete r[k];
      r.status = "handed_off";
      out.recoveries = out.recoveries.filter((x) => !(x.match === "owner_reported" && x.record.id === r.id));
    }
  out.recoveries = out.recoveries.filter((x) => x.cameBackOn <= iso.slice(0, 10));
  out.dataset.asOf = iso.slice(0, 10);
  return out;
}
const bookedAt = featured.ownerContactedAt!;
const bookedValue = featured.outcomeValue!;
const before = asAt(final, bookedAt);
const code = leadCode(featured.id);
const bookedText = `BOOKED ${bookedValue} #${code}`;
const booked = await ownerTexts(before, bookedAt, bookedText);

/* ------------------------------ the end: the free round's close, or the one pass's last text ------------------------------ */

const { passEnd, closeMsg, endState } = picked.ending;

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
  const record = recordOf(final, o) ?? null;
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
    // the quote that never booked, or the last job: what the List's date says ("Quoted Apr 2025", "Last here Jun 2025")
    record,
  };
};

const summary = start.summary!;

const { reachedAt, earlier } = picked.ledger;
const runningBefore = earlier.reduce((s, r) => s + r.value, 0);
const ledgerShown = picked.ledger.shown;

/* ------------------------------ names on screen: no two alike ------------------------------ */

// A generated book of 1,100 customers repeats surnames and streets; the few dozen the film shows must not ("Rachel
// McCarthy" beside "Greg McCarthy" gives the data away). Some names are fixed by the run (the one we follow, the
// ledger, the welcome text's call list); the rows chosen below keep clear of them and of each other.
const streetName = (street: string) => street.replace(/^\d+\s+/, "").toLowerCase();
const fixedNames = [
  cust(featured.customerId)!.name,
  // the welcome text's first note: the Notes table's first row, as his phone shows it to him
  cust(firstNote.customerId)!.name,
  ...ledgerShown.map((r) => cust(r.customerId)?.name ?? ""),
  ...callNamed.map((x) => x.name),
].filter(Boolean);
const usedSurnames = new Map<string, string>(); // surname → the full name using it
const usedStreets = new Set<string>([streetName(cust(featured.customerId)!.address?.street ?? "")]);
for (const n of fixedNames) if (!usedSurnames.has(surname(n))) usedSurnames.set(surname(n), n);
/** Whether a person can be shown beside everyone already chosen (no surname or street twice, nobody famous). */
function nameFree(name: string, street?: string): boolean {
  const owner = usedSurnames.get(surname(name));
  if ((owner && owner !== name) || famous(name)) return false;
  if (street !== undefined && (/\bmain st\b/i.test(street) || (!fixedNames.includes(name) && usedStreets.has(streetName(street))))) return false;
  return true;
}
/** Whether a person can be shown beside everyone already chosen; if so, they're chosen. */
function takeName(name: string, street?: string): boolean {
  if (!nameFree(name, street)) return false;
  if (street !== undefined) usedStreets.add(streetName(street));
  usedSurnames.set(surname(name), name);
  return true;
}
const round = new Set(firsts.map((t) => t.customerId));
// The people the round writes to, as the scan ranks them: the first-day ones first, the welcome text's person on top.
const roundPeople = firsts
  .map((t) => start.scan!.opportunities.find((o) => o.id === t.opportunityId)!)
  .slice(0, 12)
  .map(person);

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
  // side by side, two people with the same first name read as a generator's (as in the Replies view)
  const first = (o: Opportunity) => cust(o.customerId)!.name.split(/\s+/)[0]!.toLowerCase();
  // a one pass's list is old quotes for every kind of job: no job twice among the rows (a lawn list of "mowing" is
  // what a lawn book is; nine privacy fences in a row is a generator's)
  const what = (o: Opportunity) => o.jobPhrase.replace(/^the /, "");
  const sameJob = (o: Opportunity) => pass && [featuredOpp, ...rows].some((x) => x !== o && what(x) === what(o));
  // a trade whose everyday work must show (cleaning's regulars) keeps room for enough of it among the seven
  const mix = p.staple;
  const staple = (o: Opportunity) => !!mix?.job.test(what(o));
  // seven rows: the one we follow and six others
  for (const o of day1) {
    const others = rows.filter((x) => x !== featuredOpp).length;
    if (others >= 6 && (rows.includes(featuredOpp) || !day1.includes(featuredOpp))) break;
    if (o !== featuredOpp && others >= 6) continue;
    const c = cust(o.customerId)!;
    const sameFirst = [featuredOpp, ...rows].some((x) => x !== o && first(x) === first(o));
    // rows of the everyday work still wanted, and the rows left for them
    const need = mix ? Math.max(0, mix.list - [...new Set([...rows, featuredOpp])].filter(staple).length) : 0;
    if (o !== featuredOpp && !staple(o) && 6 - others <= need) continue;
    if (o === featuredOpp || (inSeason(o) && !sameFirst && !sameJob(o) && o.value !== featuredOpp.value && !rows.some((x) => x.value === o.value) && takeName(c.name, c.address?.street ?? ""))) rows.push(o);
  }
  if (!rows.includes(featuredOpp)) rows.push(featuredOpp);
  // a one pass's list is old quotes and past customers both: a past customer among the rows you can read (second)
  if (pass && !rows.filter((o) => o !== featuredOpp).slice(0, 3).some((o) => o.source.kind === "job")) {
    const at = rows.findIndex((o) => o.source.kind === "job");
    const past =
      at >= 0
        ? rows.splice(at, 1)[0]
        : start.scan!.opportunities.find((o) => {
            if (o.source.kind !== "job" || !round.has(o.customerId) || rows.includes(o) || sameJob(o) || o.value === featuredOpp.value) return false;
            const c = cust(o.customerId)!;
            return !rows.some((x) => first(x) === first(o)) && takeName(c.name, c.address?.street ?? "");
          });
    if (past) {
      rows.splice(1, 0, past);
      if (rows.length > 7) rows.splice(rows.findLastIndex((o) => o !== featuredOpp), 1);
    }
  }
  // the one we follow third, well above the list's bottom fade
  rows.splice(2, 0, ...rows.splice(rows.indexOf(featuredOpp), 1));
  // never the same job more than `maxRun` rows in a row (four deep cleans stacked read as a template): a row that would
  // make one trades places with the next row of another job (the one we follow stays third)
  if (mix)
    for (let i = mix.maxRun; i < rows.length; i++) {
      if (!rows.slice(i - mix.maxRun, i).every((x) => what(x) === what(rows[i]!))) continue;
      const j = rows.findIndex((x, k) => k > i && x !== featuredOpp && what(x) !== what(rows[i]!));
      if (j > i && rows[i] !== featuredOpp) [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    }
  return rows.map(person);
})();

// The Notes tab's rows the film shows: the first day's first notes in send order, the one we follow among them.
const notesRows = (() => {
  const f = firsts.find((t) => t.customerId === featured.customerId)!;
  const byDue = (x: Touch, y: Touch) => (x.dueAt < y.dueAt ? -1 : 1);
  // the first day's notes, the welcome text's first note on top (the note his phone shows him), and among them one
  // about another job if the day has one (not five rows of "the mowing"); a one pass's, no job twice
  const day1 = firsts.filter((t) => t !== f && firstDayIds.has(t.customerId));
  const job = (t: Touch) => oppOf(t.opportunityId)?.jobPhrase;
  const name = (t: Touch) => cust(t.customerId)!.name;
  // a note at exactly 7:00 AM reads as scripted; on a one pass (a dozen inboxes sending at once) the rows are a few
  // minutes apart, not four in two minutes
  const onHour = (t: Touch) => t.dueAt.slice(14, 16) === "00";
  const minute = (t: Touch) => Number(t.dueAt.slice(11, 13)) * 60 + Number(t.dueAt.slice(14, 16));
  let rows: Touch[];
  const mix = p.staple;
  if (mix) {
    // a trade whose everyday work must show (cleaning's regulars): the earliest three of the first day's notes that, with
    // his and the first note, give at least `notes` rows of it, never the same job more than `maxRun` rows in a row,
    // and no surname or first name twice
    const pool = day1.filter((t) => t !== firstNote && !onHour(t) && nameFree(name(t))).slice(0, 18);
    const fits = (pick: Touch[]) => {
      const all = [f, firstNote, ...pick].sort(byDue);
      const subjects = all.map((t) => t.subject);
      if (all.filter((t) => mix.job.test(job(t)?.replace(/^the /, "") ?? "")).length < mix.notes) return false;
      if (subjects.some((x, i) => i >= mix.maxRun && subjects.slice(i - mix.maxRun, i).every((y) => y === x))) return false;
      const names = all.map(name);
      return names.every((n, i) => names.findIndex((m) => surname(m) === surname(n) || firstOf(m) === firstOf(n)) === i);
    };
    let pick: Touch[] | undefined;
    for (let i = 0; i < pool.length && !pick; i++)
      for (let j = i + 1; j < pool.length && !pick; j++)
        for (let k = j + 1; k < pool.length && !pick; k++) if (fits([pool[i]!, pool[j]!, pool[k]!])) pick = [pool[i]!, pool[j]!, pool[k]!];
    if (!pick) throw new Error(`The first day's notes can't show ${mix.notes} rows of ${mix.job}: lower staple.notes in profiles.ts`);
    for (const t of pick) takeName(name(t));
    rows = [f, firstNote, ...pick];
  } else {
    // a row's subject names its job ("the chain link on Pine St"), not "checking in from Boisvert Fence Co."
    const named = (t: Touch) => t.subject.includes(job(t)?.replace(/^the /, "") ?? "\u0000");
    // side by side, no first name twice ("Bill Hall", "Bill Cooper") and no street twice in the subjects ("the chain
    // link on Pine St" over "the fence repair on Pine St")
    const street = (t: Touch) => / on ([A-Z][\w ]+)$/.exec(t.subject)?.[1];
    const apart = (t: Touch, chosen: Touch[]) => chosen.every((x) => firstOf(name(x)) !== firstOf(name(t)) && (!street(t) || street(x) !== street(t)));
    const spread = (t: Touch, chosen: Touch[]) => !pass || chosen.every((x) => Math.abs(minute(x) - minute(t)) >= 3);
    const other = day1.find((t) => t !== firstNote && t.subject !== f.subject && !onHour(t) && named(t) && apart(t, [f, firstNote]) && spread(t, [firstNote]) && takeName(name(t)));
    const rest: Touch[] = [firstNote];
    for (const strict of [true, false])
      for (const t of day1) {
        if (rest.length >= (other ? 3 : 4)) break;
        const chosen = [f, ...rest, ...(other ? [other] : [])];
        if (t === other || rest.includes(t) || (pass && chosen.some((x) => job(x) === job(t)))) continue;
        // and a subject the table's column holds whole ("getting the ash removal over the house on th…" is cut)
        if (strict && (onHour(t) || !named(t) || t.subject.length > 42 || !apart(t, chosen) || !spread(t, [...rest, ...(other ? [other] : [])]))) continue;
        if (takeName(name(t))) rest.push(t);
      }
    rows = [f, ...rest, ...(other ? [other] : [])];
  }
  return rows.sort(byDue).map((t) => ({ to: name(t), sendAt: t.dueAt, note: t.step, subject: t.subject, featured: t.customerId === featured.customerId }));
})();

// The other replies the Replies view shows, one of each other kind, that read naturally for this trade: the sorting.
// Only replies from before his: the view stands as it did when his hand-off text went, so the console never runs
// ahead of the phone beside it.
// One more who wants the work (a price, else the job; the earliest), then one of each kind that doesn't (the latest,
// so one of them comes in after the other who wants the work and lands below them: the sort shows as they arrive).
const SORT_ORDER = [["wants_price", "wants_it"], ["later"], ["already_done"], ["moved"], ["not_interested"], ["stop"]];
const others: Reply[] = [];
// side by side in one list, two people with the same first name read as a generator's ("Tom Hall", "Tom Abbott")
const firstName = (x: Reply) => cust(x.customerId)?.name.split(/\s+/)[0]?.toLowerCase();
// nor the same initials in their avatars ("JL" over "JL": Joan Lewis, Jim Lambert)
const initialsOf = (x: Reply) => (cust(x.customerId)?.name ?? "").split(/\s+/).map((w) => w[0]).join("").toUpperCase();
for (const kinds of SORT_ORDER) {
  const fits = (x: Reply) => x.id !== featured.id && x.receivedAt < featured.receivedAt && reads(x) && !!x.customerId && ![featured, ...others].some((y) => firstName(y) === firstName(x) || initialsOf(y) === initialsOf(x));
  const pool = kinds[0] === "wants_price" ? final.replies : [...final.replies].reverse();
  const r = kinds.map((k) => pool.find((x) => x.intent === k && fits(x) && takeName(cust(x.customerId)!.name))).find(Boolean);
  if (r) others.push(r);
  if (others.length === 4) break;
}

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

const end = totals(endState);
const handoff = final.ownerMessages.find((m) => m.kind === "handoff" && m.refs?.some((x) => x.kind === "customer" && x.id === featured.customerId));
const sent = endState.touches.filter((t) => t.status === "sent" || t.status === "delivered");

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
const plusMinutes = (local: string, min: number) => new Date(Date.parse(`${local.slice(0, 19)}Z`) + min * 60_000).toISOString().slice(0, 19);
const yesAt = closeMsg ? plusMinutes(closeMsg.at, 26) : undefined;
const yes = closeMsg && yesAt ? await ownerTexts(final, yesAt, "YES") : undefined;
const closeShown = closeMsg?.text
  .split("\n\n")
  .filter((x) => !/^(And the guarantee|Say yes by|There are |Or pay for the year|https?:)/.test(x))
  .join("\n\n");
// The one pass's last text: its tally and what he paid; not its offer to keep going monthly (the film's offer is the
// pass's own promise). Nothing for him to answer.
const passShown = passEnd?.text
  .split("\n\n")
  .filter((x) => !/keep this going monthly/.test(x))
  .join("\n\n");
const intentCount = (k: string[]) => endState.replies.filter((r) => k.includes(r.intent)).length;
/** The pass's bookings as its billing counts them (the console's "Billable bookings": one per customer, up to the cap). */
const billing = (st: AccountState) => {
  const b = billableBookings(st);
  const plan = st.dataset.business.plan;
  const cap = plan.capBookings ?? 0;
  // the console's Charges figure: what he's paid, of the most a pass can charge (apps/web/src/live/Client.tsx)
  return { billable: b.billable.length, overCap: b.overCap.length, cap, paid: passPaid(plan), most: (plan.pricePerBooking ?? onePassPlan().pricePerBooking ?? 0) * cap };
};

const content = {
  _about:
    "Generated by apps/web/film/content.ts from the software itself; regenerate, never hand-edit. Every string and number here is the engine's or the server's output for the made-up company in film/profiles.ts.",
  generatedFrom: { trade: p.trade, asOf: p.asOf, sampleSeed: p.sampleSeed, simSeed, simDays: p.simDays, spread, inboxes: business.fromEmails?.length ?? 1 },
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
    // each file he sends, and the records read from it (the Files tab's "Rows")
    files: files.map((f) => ({ fileName: f.name, kind: f.kind, rows: f.kind === "quote" ? start.dataset.quotes.length : f.kind === "job" ? start.dataset.jobs.length : start.dataset.customers.length })),
    quotes: start.dataset.quotes.length,
    records: start.dataset.jobs.length,
    customers: start.dataset.customers.length,
    years: `${[...start.dataset.jobs, ...start.dataset.quotes].map((j) => j.createdOn ?? "").filter(Boolean).sort()[0]?.slice(0, 4)}–${p.asOf.slice(0, 4)}`,
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
  notesTable: notesRows,
  ownerTexts: {
    // what we found, as the welcome text says it (its first paragraph after the greeting): the List scene's one line
    // (a one pass's runs on with its quotes' worth: its first sentence is the line)
    foundLine: (([line]) => (pass ? line!.replace(/^(.*?\.)\s.*$/, "$1") : line!))([kickoffMsg.text.split("\n\n")[0]!.replace(/^.*?it's Quiet Accounts\.\s*/, "")]),
    welcome: { at: kickoffMsg.at, text: kickoffMsg.text },
    ok: { at: okAt, text: "OK", reply: ok.reply },
    handoff: handoff ? { at: handoff.at, text: handoff.text } : { at: featured.handedOffAt, text: handoffText(final, featured) },
    booked: { at: bookedAt, text: bookedText, reply: booked.reply },
    close: passEnd ? { at: passEnd.at, text: passShown!, yes: null } : closeMsg && yes && yesAt ? { at: closeMsg.at, text: closeShown!, yes: { at: yesAt, text: "YES", reply: yes.reply } } : null,
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
    endOfRun: { asOf: endState.dataset.asOf, booked: end.booked, bookedValue: end.bookedValue, contacted: end.contacted, notesSent: sent.length, replied: end.replied, askedToComeBack: end.wants },
    // a one pass's billable bookings (the Overview's second figure) when he texted his BOOKED, and at its end
    // (and as the ledger's last row lands: the figures beside the rows on screen; the pass's end is its own beat)
    billing: pass ? { before: billing(before), atBooking: billing(booked.state), atLast: billing(asAt(final, `${reachedAt(ledgerShown.at(-1)!)}Z`)), end: billing(endState) } : null,
    ledger: ledgerShown.map((r) => ({ name: cust(r.customerId)?.name ?? null, reachedAt: reachedAt(r), cameBackOn: r.cameBackOn, value: r.value, job: oppOf(r.opportunityId)?.jobPhrase ?? null, what: oppOf(r.opportunityId)?.jobPhrase.replace(/^the /, "") ?? null, match: r.match })),
  },
  closeText: passEnd?.text ?? closeMsg?.text ?? null,
};

// No two people on screen share a surname, no street shows twice, and none is a Main St (see takeName).
{
  const names = [...new Set([...content.round.table.map((x) => x.name), ...content.notesTable.map((x) => x.to), ...content.replies.shown.map((x) => x.name ?? ""), ...content.recovered.ledger.map((x) => x.name ?? ""), ...callNamed.map((x) => x.name), content.featured.name])].filter(Boolean);
  const twice = names.filter((n, i) => names.findIndex((m) => surname(m) === surname(n)) !== i);
  const streets = [...new Map([...content.round.table, content.featured].map((x) => [x.name, x.street])).values()];
  const street2 = streets.filter((x, i) => streets.findIndex((y) => streetName(y) === streetName(x)) !== i || /\bmain st\b/i.test(x));
  if (twice.length || street2.length) throw new Error(`Names on screen repeat (${[...twice, ...street2].join(", ")}): try another sampleSeed in profiles.ts`);
  const known = names.filter(famous);
  if (known.length) throw new Error(`A name on screen is somebody's (${known.join(", ")}): try another sampleSeed in profiles.ts`);
}

// Nothing on screen may say these (the brief, and Jack: "It shouldn't look like it's just some demonstration").
const shown = JSON.stringify({ ...content, _about: "", generatedFrom: {} });
const banned = /\b(example|sample|demo|simulated|placeholder|lorem|john doe|123 main)\b|money-back|risk-free|free trial|guaranteed \d|555-\d{4}/i;
const hit = banned.exec(shown);
if (hit) throw new Error(`content.json would show "${hit[0]}": ${shown.slice(Math.max(0, hit.index - 80), hit.index + 80)}`);

writeFileSync(OUT, `${JSON.stringify(content, null, 2)}\n`);

// The films after this one in FILM_ORDER that now show one of its replies' lines: write them again (they keep clear).
for (const { trade: t, lines } of shownAfter) {
  const shared = content.replies.shown.map((r) => lines.get(lineOf(r.text))).filter(Boolean);
  if (shared.length) console.log(`  ${t}'s film shows ${shared.map((x) => `"${x}"`).join(", ")} too: run film:content ${t} again`);
}

// The account at each step, to open in the app itself (IndexedDB "acct:<id>") and see the real screens with this
// company in them. Big (the whole export is in it), so it goes wherever it's asked to, never into the repo.
const statesAt = process.argv.indexOf("--states");
if (statesAt > 0 && process.argv[statesAt + 1]) {
  const dir = process.argv[statesAt + 1]!;
  const steps: Record<string, AccountState> = { "1-found": start, "2-approved": approved, "3-before-booking": before, "4-booked": booked.state, "5-end": endState };
  for (const [name, st] of Object.entries(steps)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(st));
  console.log(`  states in ${dir}: ${Object.keys(steps).join(", ")}`);
}
console.log(`Wrote ${OUT}`);
console.log(`  ${content.company.name} (${content.company.town}), sim seed ${simSeed}`);
console.log(`  featured: ${content.featured.name}, ${content.featured.job}: "${featured.text}" → booked ${fmtMoney(bookedValue)}`);
console.log(`  recovered ${fmtMoney(content.recovered.before)} → ${fmtMoney(content.recovered.after)}; end of run ${fmtMoney(end.bookedValue)} from ${end.booked} jobs`);
