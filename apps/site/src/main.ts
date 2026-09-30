import type { AuditFile, AuditOptions, AuditResult } from "./audit.ts";
import { TRADES, isTrade, tradeFromHash, type SiteTrade, type TakeBack, type TradeCopy } from "./trades.ts";
import AuditWorker from "./worker.ts?worker&inline";
import logoUrl from "./assets/logo-mark.svg";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const n = (x: number) => Math.round(x).toLocaleString("en-US");
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (x: number) => usd.format(Math.round(x));
/** Big figures to the nearest $100, so nobody reads a model as a ledger. */
const about = (x: number) => money(x >= 1000 ? Math.round(x / 100) * 100 : x);
const PRICE = 497;
const YEAR = PRICE * 12;
/** Kept in step with audit.ts; the page doesn't load the engine itself, only the worker does. */
const ADDRESS_SLOT = "[your business address]";
const monthYear = (iso?: string) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "");
const nextMonth = () => new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString("en-US", { month: "long" });
/** What goes with the file on Start. Bigger than this and we ask for the file by text instead. */
const MAX_FILES = 5;
const MAX_BYTES = 8 * 1024 * 1024;

/* ------------------------------ who's here ------------------------------ */

/**
 * Personal links from our own outreach: ?t=<token>&c=Nelson+Fence+LLC&n=DAVID. The company name is tidied
 * (no LLC/Inc, no SHOUTING) and dropped into the preview note and the form; `t` goes back with a sign-up as `ref`.
 * The trade comes from ?trade=, a trade-named ?t=, or the #hash.
 */
const params = new URLSearchParams(location.search);
const tidy = (s: string | null, max: number) =>
  (s ?? "")
    .replace(/[<>]/g, "")
    .replace(/,?\s*\b(llc|l\.l\.c\.|inc\.?|incorporated|co\.?,? ?llc|corp\.?|ltd\.?)$/i, "")
    .trim()
    .slice(0, max)
    // ALL CAPS from a list becomes Title Case; anything already mixed-case is left alone (keeps "ABC Tree")
    .replace(/^[^a-z]*$/, (all) => all.replace(/\b([A-Z])([A-Z']+)\b/g, (_, a: string, b: string) => a + b.toLowerCase()));
const who = { company: tidy(params.get("c"), 60), first: tidy(params.get("n"), 30).split(/\s+/)[0] ?? "" };
const ref = params.get("t")?.trim().slice(0, 120) || undefined;
const tradeParam = params.get("trade") ?? params.get("t");
/** Ad and cold-email visits: the logo isn't a link and the footer shows only the address and the text number. */
const campaign = ["t", "c", "n", "gclid", "fbclid", "msclkid"].some((k) => params.has(k)) || /cpc|ppc|paid|ads?|email/i.test(params.get("utm_medium") ?? "");

let trade: TradeCopy = TRADES[isTrade(tradeParam) ? tradeParam : tradeFromHash(location.hash)];

function setT(key: string, html: string) {
  document.querySelectorAll<HTMLElement>(`[data-t="${key}"]`).forEach((el) => (el.innerHTML = html));
}

/* ------------------------------ quotes or estimates ------------------------------ */

/**
 * The painting page says "estimates" wherever the others say "quotes". Anything marked data-keep stays as written:
 * real results ("old quotes"), Jobber's own words ("Quotes report"), and the note preview.
 */
const originalText = new WeakMap<Text, string>();
/** Nouns only: "what you quote" and "so you can quote today's" keep the verb. */
const toEstimates = (s: string) =>
  s.replace(/\b([Aa]) quote\b/g, "$1n estimate").replace(/(?<!\b(?:you|can) )\b([Qq])uote(s?)\b/g, (_, q: string, pl: string) => `${q === "Q" ? "E" : "e"}stimate${pl}`);
function wordPass(root: Node = $("main")) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest("[data-keep], script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const orig = originalText.get(node) ?? node.data;
    if (trade.word === "estimates") {
      originalText.set(node, orig);
      const next = toEstimates(orig);
      if (node.data !== next) node.data = next;
    } else if (node.data !== orig) node.data = orig;
  }
}
const Q = (s: string) => (trade.word === "estimates" ? toEstimates(s) : s);

/* ------------------------------ trade ------------------------------ */

const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

function heading(t: TradeCopy) {
  return who.first ? `${who.first}, ${t.h1.charAt(0).toLowerCase()}${t.h1.slice(1)}` : t.h1;
}

function applyTrade(t: TradeCopy) {
  trade = t;
  document.documentElement.dataset.trade = t.id;
  setT("eyebrow", esc(t.eyebrow));
  setT("h1", esc(heading(t)));
  setT("loss", esc(t.loss));
  setT("lossSource", esc(t.lossSource));
  setT("lede", esc(t.lede));
  const p = t.proof;
  setT("tallyCap", esc([`${p.shop}, ${p.where}`, p.kind, p.list, "first 150"].filter(Boolean).join(" · ")));
  setT("asked", String(p.asked));
  setT("wrote", String(p.wroteBack));
  setT("booked", String(p.booked));
  setT("jobs", `<small>${p.jobsPre}</small> ${esc(p.jobs)}`);
  setT("tallyQuote", esc(p.quote));
  setT("tallyBy", esc(`${p.quoteBy}.`));
  const other = $("#otherTrade");
  other.hidden = !p.otherTrade;
  other.textContent = p.otherTrade ?? "";
  setT("dropH2", esc(t.dropH2));
  setT("exportHint", esc(t.exportHint));
  setT("sampleNoun", esc(t.sampleNoun));
  setT("quietH2", esc(t.quietH2));
  setT("pain", esc(t.pain));
  setT("paidText", esc(t.paid.text));
  setT("paidSrc", esc(t.paid.source));
  setT("reqSaid", esc(t.request.said));
  setT("reqAck", esc(t.request.ack));
  setT("bookedCmd", esc(t.ready.booked));
  setT("journey", t.journey.map(([d, what, yes]) => `<li${yes ? ' class="yes"' : ""}><span class="d">Day ${esc(d)}</span><span>${esc(what)}</span></li>`).join(""));
  setT("ledger", t.ledger.map((r) => `<tr>${r.map((c, i) => `<td${i === 4 ? ' class="amt"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join(""));
  const won = t.ledger.slice(0, 2);
  const wonValue = won.reduce((s, r) => s + Number(r[4].replace(/[^0-9]/g, "")), 0);
  // Same lines, same order as the real Friday text (engine reports/owner.ts weeklyReport).
  setT(
    "friday",
    esc(
      [
        `Dave, 2 jobs came back this week — ${money(wonValue)}.`,
        "",
        "Notes out: 61 (to 38 people)",
        "Always on: answered 4 new requests, followed up 9 new quotes",
        "Wrote back: 7",
        "Want a price or a date: 3",
        `Booked: 2 · ${money(wonValue)}`,
        // before-only: a before-and-after drop here would read as a typical result
        "Your quiet rate before we started: 41%. Tracked here every Friday.",
        "Your average time to call them back: 3h",
      ].join("\n"),
    ),
  );
  const r = t.ready;
  // The hand-off text ends the way the real one does: the exact replies, and the #code.
  $("#feed").innerHTML =
    `<p class="qw-day">Today</p>` +
    `<div class="qw-push"><img class="qw-app" src="${logoUrl}" alt=""><div><div class="qw-top"><span>Quiet Accounts</span><span>9:12 AM</span></div><b class="qw-title">${esc(r.name)} ${esc(r.wants)}</b><span class="qw-sub">${esc(r.job)}</span><span class="qw-said">${esc(r.said)}</span><span class="qw-meta">${esc(r.meta)}</span><span class="qw-win"><i>${CHECK}</i><span><b>${esc(r.value)}</b> ${esc(r.valueTail)}</span></span><span class="qw-cmd">Text back BOOKED + amount, DONE, or NO · #K7Q</span></div></div>` +
    `<div class="qw-me"><small>You · 9:40 AM</small><span>${esc(r.booked)}</span></div>` +
    `<div class="qw-push qw-small"><img class="qw-app" src="${logoUrl}" alt=""><div><div class="qw-top"><span>Quiet Accounts</span></div><span class="qw-conf">Booked: ${esc(r.name)}, ${esc(r.value)}. Added to your results.</span></div></div>`;
  $<HTMLInputElement>("#company").placeholder = t.companyExample;
  if (!last) {
    const a = $("#anchor");
    a.hidden = !t.anchor;
    a.textContent = t.anchor ?? "";
  }
  if (last) render(last);
  wordPass();
}

window.addEventListener("hashchange", () => {
  const h = location.hash.slice(1);
  if (isTrade(h)) {
    applyTrade(TRADES[h as SiteTrade]);
    $("#top").scrollIntoView({ behavior: "smooth" });
  }
});

/* ------------------------------ the audit ------------------------------ */

let worker: Worker | undefined;
let seq = 0;
const pending = new Map<number, (r: { result?: AuditResult; error?: string }) => void>();

function audit(req: { files: AuditFile[] } | { sample: TradeCopy["engine"] }, opts: AuditOptions): Promise<AuditResult> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    try {
      worker ??= new AuditWorker();
    } catch {
      reject(new Error("This browser wouldn't run the reader."));
      return;
    }
    worker.onmessage = (e: MessageEvent<{ id: number; result?: AuditResult; error?: string }>) => pending.get(e.data.id)?.(e.data);
    worker.onerror = () => {
      for (const [, done] of pending) done({ error: "Something went wrong reading that file." });
      pending.clear();
    };
    pending.set(id, (r) => {
      pending.delete(id);
      if (r.result) resolve(r.result);
      else reject(new Error(r.error ?? "Something went wrong reading that file."));
    });
    worker.postMessage({ id, ...req, opts });
  });
}

/** Excel's classic CSV is Windows-1252; everything else is UTF-8 (or UTF-16 with a byte-order mark). */
function decode(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(b);
  }
}

let last: AuditResult | undefined;
let lastSample = false;
/** The made-up company name a sample filled in, so it can be cleared before the owner's own file. */
let sampleCompany = "";
/** The raw text of the owner's own files, kept from the drop, sent only if they tap Start and tick the box. */
let files: AuditFile[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* The two optional guesses while it reads. Nothing preselected; "Skip, just show me" skips both. */
const guess: { month?: string; cost?: number; costPlus?: boolean; costNone?: boolean; costUnsure?: boolean } = {};
let guessDone = false;
let releaseGuess: (() => void) | undefined;
/** A number the owner typed or tapped for what a request costs (never a figure we picked for him). */
let costTyped: number | undefined;
/** The owner's pick in the take-back step: 1 in takeN. */
let takeN: number | undefined;
let takeIsGuess = false;

/** Both answered, or skipped. It can happen before the reading finishes. */
let guessSettled = false;
function settleGuess() {
  guessSettled = true;
  releaseGuess?.();
}

function guessGate(): Promise<void> {
  if (guessDone || guessSettled) {
    guessDone = true;
    return Promise.resolve();
  }
  return new Promise((res) => {
    releaseGuess = () => {
      guessDone = true;
      releaseGuess = undefined;
      res();
    };
  });
}

function pickChip(group: HTMLElement, btn: HTMLElement) {
  group.querySelectorAll<HTMLElement>(".chip").forEach((c) => c.setAttribute("aria-pressed", c === btn ? "true" : "false"));
}

function onGuess() {
  $("#guessSkip").textContent = guess.month || guess.cost !== undefined || guess.costNone || guess.costUnsure ? "That's it, show me" : "Skip, just show me";
  const both = !!guess.month && (guess.cost !== undefined || guess.costNone || guess.costUnsure);
  if (both) setTimeout(settleGuess, 350);
}

$("#qMonth").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".chip");
  if (!b) return;
  pickChip($("#qMonth"), b);
  guess.month = b.dataset.v;
  onGuess();
});
$("#qCost").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".chip");
  if (!b) return;
  pickChip($("#qCost"), b);
  const v = b.dataset.v ?? "";
  guess.costNone = v === "0";
  guess.costUnsure = v === "unsure";
  guess.costPlus = v === "100+";
  guess.cost = guess.costNone || guess.costUnsure ? undefined : Number.parseInt(v, 10);
  onGuess();
});
$("#guessSkip").addEventListener("click", settleGuess);

async function start(req: { files: AuditFile[] } | { sample: TradeCopy["engine"] }, label: string) {
  const sec = $("#audit");
  sec.hidden = false;
  $("#result").hidden = true;
  $("#auditErr").hidden = true;
  $("#auditSub").hidden = true;
  lastSample = "sample" in req;
  sec.classList.toggle("is-sample", lastSample);
  $("#auditEyebrow").textContent = lastSample ? `Sample · a made-up ${trade.sampleNoun}. Your file shows your real number.` : "Your quote audit";
  $("#auditH").textContent = Q(label);
  const steps = $("#steps");
  steps.innerHTML = `<li class="on"><span>${Q(`Reading ${lastSample ? "five years of sample quotes" : "your file"}…`)}</span></li>`;
  $("#guess").hidden = guessDone;
  $("#reading").hidden = false;
  sec.scrollIntoView({ behavior: "smooth", block: "start" });

  // The sample's made-up company never carries over to the owner's own file.
  const pc = $<HTMLInputElement>("#pCompany");
  if (!lastSample && sampleCompany && pc.value === sampleCompany) pc.value = who.company;
  const began = performance.now();
  let r: AuditResult;
  try {
    r = await audit(req, { company: pc.value || undefined, signer: $<HTMLInputElement>("#pSigner").value || undefined });
  } catch (err) {
    steps.innerHTML = "";
    $("#guess").hidden = true;
    $("#auditH").textContent = "That file didn't read.";
    const e = $("#auditErr");
    e.hidden = false;
    e.textContent = `${err instanceof Error ? err.message : String(err)} Try the quotes report straight from your software, as a CSV. Stuck? Text 603-340-7673 and we'll look at it with you.`;
    return;
  }
  if (!r.quotes) {
    steps.innerHTML = "";
    $("#guess").hidden = true;
    $("#auditH").textContent = Q("We couldn't find any quotes in that file.");
    const e = $("#auditErr");
    e.hidden = false;
    e.textContent = Q("This works from a quotes (or estimates) report: one row per quote, with a date, an amount and a status. In Jobber that's Reports → Quotes report. Text 603-340-7673 if you'd like a hand.");
    return;
  }
  const hadResult = !!last;
  last = r;
  if (lastSample) {
    if (!pc.value) sampleCompany = r.company;
    pc.value = r.company;
  } else if (pc.value) {
    $<HTMLInputElement>("#company").value = pc.value;
    $<HTMLInputElement>("#otCompany").value = pc.value;
  }

  // Stream what was found, in their numbers only.
  const lines = [
    `Read <b>${n(r.quotes)}</b> quotes${r.from ? `, ${monthYear(r.from)} to ${monthYear(r.to)}` : ""}.`,
    `<b>${n(r.won.count)}</b> became work. <b>${n(r.saidNo.count)}</b> got a no.`,
    `<b>${n(r.silent.count)}</b> never got a yes or a no.`,
    r.requestsNeverPriced ? `<b>${n(r.requestsNeverPriced)}</b> requests in the last year never got a price.` : "",
    r.pastCustomersNotBack ? `<b>${n(r.pastCustomersNotBack)}</b> past customers haven't been back.` : "",
    r.hottest ? `Writing the first note to <b>${esc(r.hottest.name)}</b>.` : "",
  ].filter(Boolean);
  await sleep(Math.max(0, 500 - (performance.now() - began)));
  steps.innerHTML = lines.map((l) => `<li><span>${Q(l)}</span></li>`).join("");
  const items = [...steps.querySelectorAll("li")];
  for (const li of items) {
    li.classList.add("on");
    await sleep(hadResult ? 120 : 380);
    li.classList.add("done");
  }
  await guessGate();
  $("#guess").hidden = true;
  render(r);
  if (!hadResult) $("#auditH").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ------------------------------ the reveal ------------------------------ */

const isClean = (r: AuditResult) => r.silent.count === 0 || (r.quietWindow.quotes >= 20 && r.quietRate < 0.1);
const pctText = (x: number) => `${Math.round(x * 100)}%`;
function inTen(rate: number): string {
  const t = Math.round(rate * 10);
  if (rate >= 0.15 && t >= 1) return `${t} in 10`;
  return rate > 0 ? `about 1 in ${Math.max(2, Math.round(1 / rate))}` : "none of the";
}

/** R10 works on quiet quotes, or on a cleaning company's past customers when the file has them. */
function takePool(r: AuditResult): { tb: TakeBack; count: number; past: boolean } {
  const past = !!trade.takePast && r.pastCustomersNotBack > 0;
  return { tb: past ? trade.takePast! : trade.take, count: past ? r.pastCustomersNotBack : r.silent.count, past };
}

function render(r: AuditResult) {
  const clean = isClean(r);
  const range = r.from ? `${monthYear(r.from)} to ${monthYear(r.to)}` : "";
  const sub = $("#auditSub");
  $("#reading").hidden = true;

  // R1
  $("#auditH").textContent = Q(
    clean
      ? r.silent.count === 0
        ? "Every quote got an answer. That's rare."
        : `Your quiet rate is ${pctText(r.quietRate)}. That's rare.`
      : `${money(r.silent.value)} is sitting in quotes nobody answered.`,
  );
  sub.hidden = clean;
  sub.textContent = Q(
    `${n(r.silent.count)} quotes${range ? `, ${range}` : ""}.` + (r.fresh.count ? ` Not counted: ${n(r.fresh.count)} sent in the last two weeks. They're still fresh.` : ""),
  );

  // R3 the quiet rate, the same number the Friday report uses
  const w = r.quietWindow;
  $("#rRateA").hidden = !w.quotes;
  $("#rPct").textContent = pctText(r.quietRate);
  $("#rPctWhat").textContent = Q(
    w.quotes >= 20
      ? `In the last two years, ${inTen(r.quietRate)} quotes that had time for an answer never got one.`
      : `In the last two years, ${n(w.quiet)} of your ${n(w.quotes)} quotes that had time for an answer never got one.`,
  );
  // R5 and R2
  const pm = r.perMonth;
  $("#rMonthLabel").textContent = pm.value > 0 ? "Every month, about" : "Every month";
  $("#rMonth").hidden = !(pm.value > 0);
  $("#rMonth").textContent = about(pm.value);
  $("#rMonthWhat").textContent = Q(pm.value > 0 ? `of what you quote goes quiet. That's ${Math.round(pm.shareOfQuoted * 100)} cents of every quoted dollar, and nobody said no to it.` : "Nothing you quoted in the last year went quiet.");
  const g = $("#rGuess");
  const perMonth = Math.round(r.quietPerMonth);
  const said = guessLine(guess.month, perMonth);
  g.hidden = !said;
  g.innerHTML = said;

  // R4
  const sent = r.won.count + r.saidNo.count + r.silent.count + r.fresh.count;
  $("#rSent").textContent = Q(`${n(sent)} quotes sent`);
  $("#rRange").textContent = range;
  const total = Math.max(1, sent);
  const row = (cls: string, label: string, x: { count: number; value: number }) =>
    `<li class="${cls}"><span>${label} <span class="num sm">· ${money(x.value)}</span></span><b>${n(x.count)}</b><span class="bar"><i style="width:${Math.max(1.5, (x.count / total) * 100).toFixed(1)}%"></i></span></li>`;
  $("#rSplit").innerHTML = row("won", "Became work", r.won) + row("no", "Said no", r.saidNo) + row("quiet", "Never answered", r.silent) + (r.fresh.count ? row("fresh", "Still fresh", r.fresh) : "");
  $("#rTold").innerHTML = r.saidNo.count
    ? `Only <b>${n(r.saidNo.count)}</b> ${r.saidNo.count === 1 ? "person" : "people"} told you no. The other <b>${n(r.silent.count)}</b> never said anything.`
    : `Nobody told you no. <b>${n(r.silent.count)}</b> never said anything.`;

  // R7 warmest first
  const bucket = (labels: string[]) => r.byAge.filter((a) => labels.includes(a.label)).reduce((s, a) => ({ count: s.count + a.count, value: s.value + a.value }), { count: 0, value: 0 });
  const ages = [
    { k: "Last 90 days", ...bucket(["Last 3 months"]) },
    { k: "3–12 months", ...bucket(["3–6 months", "6–12 months"]) },
    { k: "1–2 years", ...bucket(["1–2 years"]) },
    { k: "Over 2 years", ...bucket(["Over 2 years"]) },
  ].filter((a) => a.count);
  $("#rAgeRow").innerHTML = ages.map((a, i) => `<div class="age${i === 0 ? " warm" : ""}"><span class="k">${a.k}</span><b>${n(a.count)}</b><span class="v">${money(a.value)}</span></div>`).join("");
  $("#rAges").hidden = !ages.length;

  // R8
  const cl = r.callList;
  $("#rCalls").hidden = !cl.people;
  if (cl.people) {
    $("#rCallsH").textContent = `Worth a call from you: ${n(cl.people)} ${cl.people === 1 ? "person" : "people"}, ${money(cl.value)}.`;
    const parts = [cl.bigQuotes ? `${n(cl.bigQuotes)} quote${cl.bigQuotes === 1 ? "" : "s"} over $10,000` : "", cl.phoneOnly ? `${n(cl.phoneOnly)} with only a phone number` : ""].filter(Boolean);
    $("#rCallsP").textContent = Q(`${parts.join(" and ")}. We don't email these. You get the list, biggest first.`);
  }
  $("#rSpent").classList.toggle("wide", !cl.people);

  renderSpent();
  renderNote();
  renderTake();
  renderGo();

  // The clean file: nearly every quote got an answer.
  for (const id of ["#rRate", "#rAges", "#rSpent", "#rCalls", "#rNote", "#rTakeCol", "#go"]) $(id).classList.toggle("off", clean);
  $("#rClean").hidden = !clean;
  if (clean) renderClean(r);

  // Everything else on the page that follows his numbers.
  const a = $("#anchor");
  if (r.typicalQuote) {
    a.hidden = false;
    a.innerHTML = `${lastSample ? "This sample's" : "Your"} typical quote is <b>${money(r.typicalQuote)}</b>. ${covers(r.typicalQuote)}`;
  }
  if (!lastSample) {
    $("#stripTag").textContent = "From your file";
    $("#sSent").textContent = `${n(sent)} quotes sent`;
    $("#sSplit").innerHTML =
      row("won", "Became work", r.won).replace(/<span class="num sm">[^<]*<\/span>/, "") +
      row("no", "Said no", r.saidNo).replace(/<span class="num sm">[^<]*<\/span>/, "") +
      row("quiet", "Never answered", r.silent).replace(/<span class="num sm">[^<]*<\/span>/, "") +
      (r.fresh.count ? row("fresh", "Still fresh", r.fresh).replace(/<span class="num sm">[^<]*<\/span>/, "") : "");
    $("#sRate").textContent = pctText(r.quietRate);
    $("#sMoney").textContent = money(r.silent.value);
  }
  const odd = r.warnings.filter((x) => !/no email or phone/i.test(x));
  $("#auditErr").hidden = lastSample || !odd.length;
  $("#auditErr").textContent = !lastSample && odd.length ? `From your file: ${odd.slice(0, 3).join(" ")}` : "";
  $("#auditErr").classList.toggle("soft", true);

  setCalls();
  consentLabels();
  $("#result").hidden = false;
  wordPass($("#audit"));
  wordPass($("#quiet"));
}

function guessLine(month: string | undefined, file: number): string {
  if (!month) return "";
  if (month === "idk") return `Now you know: <b>${n(file)}</b> a month.`;
  const [lo, hi] = month === "10+" ? [10, Infinity] : (month.split("-").map(Number) as [number, number]);
  const shown = month.replace("-", "–");
  if (file > hi) return `You guessed ${shown} a month. Your file says <b>${n(file)}</b>.`;
  if (file < lo) return `You guessed ${shown}. Your file says <b>${n(file)}</b>. Better than you thought.`;
  return `You guessed ${shown} a month. Your file says <b>${n(file)}</b>. You know your numbers.`;
}

const covers = (typical: number) => (typical >= PRICE ? "One yes a month covers it." : `${Math.ceil(PRICE / typical)} yeses a month cover it.`);

/** R6: lead money, only ever multiplied by a number the owner gave us. */
function renderSpent() {
  const r = last;
  if (!r) return;
  const body = $("#rSpentBody");
  body.hidden = !!guess.costNone;
  if (guess.costNone) return;
  const cost = guess.cost ?? costTyped;
  const line = $("#rSpentLine");
  const ask = $("#rCostAsk");
  const typed = guess.cost === undefined;
  line.hidden = cost === undefined;
  if (cost !== undefined) {
    const plus = !typed && guess.costPlus;
    line.innerHTML = Q(`${n(r.silent.count)} quiet quotes at ${plus ? "$100 or more" : `about ${money(cost)}`} a request: ${plus ? "at least" : "around"} <b>${money(r.silent.count * cost)}</b> spent on people nobody finished with.`);
  }
  // Not sure, or skipped: the trade's sourced figure, asked as a question. Nothing is multiplied until he answers.
  ask.hidden = !typed;
  if (typed) {
    $("#rCostText").textContent = trade.costAsk.text;
    $("#rCostSrc").textContent = trade.costAsk.source ? `(${trade.costAsk.source})` : "";
    $("#rCostPicks").innerHTML = trade.costAsk.picks.map((p) => `<button type="button" class="chip" data-cost="${p}" aria-pressed="${costTyped === p ? "true" : "false"}">About ${money(p)}</button>`).join("");
  }
}

$("#rCostIn").addEventListener("input", () => {
  const v = Number.parseInt($<HTMLInputElement>("#rCostIn").value.replace(/[^0-9]/g, ""), 10);
  costTyped = v > 0 && v < 100_000 ? v : undefined;
  renderSpent();
});
$("#rCostPicks").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-cost]");
  if (!b) return;
  costTyped = Number(b.dataset.cost);
  $<HTMLInputElement>("#rCostIn").value = String(costTyped);
  renderSpent();
});

function renderNote() {
  const r = last;
  const h = r?.hottest;
  const mail = $("#mail");
  if (!r || !h) {
    mail.hidden = true;
    $("#mCap").textContent = "";
    return;
  }
  mail.hidden = false;
  const company = $<HTMLInputElement>("#pCompany").value.trim() || r.company;
  const signer = $<HTMLInputElement>("#pSigner").value.trim() || "Sarah";
  const swap = (s: string) => s.split(r.company).join(company).replace(/\bSarah\b/g, signer);
  const body = swap(h.body);
  const cut = body.lastIndexOf(`\n\n${company} · `);
  const main = cut > 0 ? body.slice(0, cut) : body;
  const foot = cut > 0 ? body.slice(cut + 2) : "";
  const typed = !!$<HTMLInputElement>("#pCompany").value.trim() || lastSample;
  const slot = (s: string) => {
    let x = esc(s).replace(esc(ADDRESS_SLOT), `<span class="slot">${esc(ADDRESS_SLOT)}</span>`);
    if (!typed) x = x.split(esc(company)).join(`<span class="slot">${esc(company)}</span>`);
    return x;
  };
  $("#mTo").textContent = h.name;
  $("#mSubject").textContent = swap(h.subject);
  $("#mBody").innerHTML = slot(main) + (foot ? `<span class="mail-foot">${slot(foot)}</span>` : "");
  const first = h.name.split(" ")[0];
  const next = h.notes >= 3 ? "Notes 2 and 3 go" : h.notes === 2 ? "Note 2 goes" : "";
  $("#mCap").textContent = Q(
    `Note 1 of ${h.notes} to ${first}, about ${h.job ? `the ${h.job}` : "the quote"} (${money(h.value)}, quiet ${n(h.quietDays)} days). ` +
      (next ? `${next} only if ${first} hasn't answered, and stop the minute anyone does. ` : "") +
      `Read it like ${first} would. What would you change?`,
  );
}

["#pCompany", "#pSigner"].forEach((s) =>
  $(s).addEventListener("input", () => {
    renderNote();
    const c = $<HTMLInputElement>("#pCompany").value.trim();
    if (c && !lastSample) {
      $<HTMLInputElement>("#company").value = c;
      $<HTMLInputElement>("#otCompany").value = c;
    }
    const sg = $<HTMLInputElement>("#pSigner").value.trim();
    if (sg && !lastSample) $<HTMLInputElement>("#otSigner").value = sg;
    consentLabels();
  }),
);

/** R10 and R11: what might come back, priced against the lower of his guess and the shops' own rate. */
function renderTake() {
  const r = last;
  if (!r) return;
  const { tb, count, past } = takePool(r);
  const first = r.hottest?.name.split(" ")[0];
  const ask = trade.takeAsk.replace("{month}", nextMonth());
  $("#takeQ").innerHTML = Q(`If ${first ? esc(first) : "one of them"} wrote back “${esc(ask)}”, you'd take it. How many of your ${n(count)} ${past ? "past customers" : "quiet quotes"} would?`);
  const A = $("#takeA");
  const B = $("#takeB");
  const C = $("#takeC");
  A.textContent = `${tb.like}: 1 in ${tb.n}`;
  B.textContent = `Half that: 1 in ${tb.half}`;
  A.setAttribute("aria-pressed", String(!takeIsGuess && takeN === tb.n));
  B.setAttribute("aria-pressed", String(!takeIsGuess && takeN === tb.half));
  C.classList.toggle("on", takeIsGuess && !!takeN);
  $("#takeLbl").textContent = tb.label;
  $("#takeNudge").hidden = r.hasPastWork || lastSample;

  const out = $("#takeOut");
  const each = r.typicalQuiet ?? r.typicalQuote ?? 0;
  out.hidden = !takeN;
  let yearNumber = 0;
  if (takeN) {
    const priced = Math.max(takeN, tb.n);
    const rate = 1 / priced;
    const back = count * rate * each;
    const ongoing = past ? 0 : r.quietPerMonth * 12 * rate * each;
    yearNumber = back + ongoing;
    if (!each) {
      $("#takeNum").textContent = Q("Your file has no amounts on its quotes, so there's no dollar figure to put on it.");
      $("#takeWhy").textContent = "";
    } else {
      $("#takeNum").innerHTML = `${lastSample ? "The sample's" : "Your"} number: about <b>${about(yearNumber)}</b> in the first year.`;
      $("#takeWhy").textContent = Q(
        `${about(back)} from ${past ? "past customers who haven't been back" : "quotes already sitting there"}` +
          (ongoing > 0 ? `, plus ${about(ongoing)} from new ones going quiet` : "") +
          `, at ${lastSample ? "its" : "your"} typical ${past ? "job" : "quiet quote"} of ${money(each)}. ${lastSample ? "An estimate" : "Your estimate"}, not a promise.`,
      );
    }
    const note = $("#takeNote");
    note.hidden = !(takeIsGuess && takeN < tb.n);
    note.textContent = `You picked 1 in ${n(takeN)}. ${tb.theirs} got about 1 in ${tb.n}, so we'll price against theirs.`;
  }

  // R11
  const band = $("#rBand");
  if (!takeN || !yearNumber) {
    band.textContent = "Pick one above and we'll put the price against that number.";
    band.classList.remove("hot");
  } else {
    const per100 = Math.round((YEAR / yearNumber) * 100);
    band.classList.add("hot");
    band.textContent =
      per100 <= 20
        ? `That's about ${per100 < 1 ? "less than $1" : money(per100)} for every $100 you'd take back.`
        : per100 <= 40
          ? "On paper it's close, and we won't pretend otherwise. That's why your first 150 are free: you see your real number before you pay a dollar."
          : "At your numbers, start with the free 150 and let the result decide.";
  }
  $("#rCover").innerHTML = r.typicalQuote ? `${lastSample ? "This sample's" : "Your"} typical quote is <b>${money(r.typicalQuote)}</b>. ${covers(r.typicalQuote)}` : "";
  $("#rCover").hidden = !r.typicalQuote;
}

$("#takeA").addEventListener("click", () => {
  if (!last) return;
  takeN = takePool(last).tb.n;
  takeIsGuess = false;
  renderTake();
  wordPass($("#rTakeCol"));
});
$("#takeB").addEventListener("click", () => {
  if (!last) return;
  takeN = takePool(last).tb.half;
  takeIsGuess = false;
  renderTake();
  wordPass($("#rTakeCol"));
});
$("#takeIn").addEventListener("input", () => {
  const v = Number.parseInt($<HTMLInputElement>("#takeIn").value.replace(/[^0-9]/g, ""), 10);
  if (v >= 2 && v <= 5000) {
    takeN = v;
    takeIsGuess = true;
  } else if (takeIsGuess) takeN = undefined;
  renderTake();
  wordPass($("#rTakeCol"));
});
$("#takeC").addEventListener("click", () => $<HTMLInputElement>("#takeIn").focus());

/** R12: the button. */
function renderGo() {
  const r = last;
  if (!r) return;
  const { count } = takePool(r);
  const btn = $("#goBtn");
  const arr = `<span class="arr" aria-hidden="true">&rarr;</span>`;
  if (lastSample) {
    btn.innerHTML = `Now try it on my own file <span class="arr" aria-hidden="true">&uarr;</span>`;
    $("#goFine").textContent = "That was a sample. Your own file shows your real number, in about 10 seconds, in your browser.";
    $("#goLinks").hidden = true;
  } else {
    btn.innerHTML = `${count <= 150 ? `Start on these ${n(count)}. Free.` : "Start on the likeliest 150. Free."} ${arr}`;
    $("#goFine").textContent = "No card. You OK the first note. Then $497 a month, only if you say yes.";
    $("#goLinks").hidden = false;
    $<HTMLAnchorElement>("#emailMe").href = emailBody(r);
  }
}

function emailBody(r: AuditResult): string {
  const lines = [
    Q(`${money(r.silent.value)} is sitting in ${n(r.silent.count)} quotes nobody answered${r.from ? ` (${monthYear(r.from)} to ${monthYear(r.to)})` : ""}.`),
    r.quietWindow.quotes ? Q(`Quiet rate: ${pctText(r.quietRate)} of my quotes in the last two years never got a yes or a no.`) : "",
    r.perMonth.value > 0 ? Q(`Every month about ${about(r.perMonth.value)} of what I quote goes quiet.`) : "",
    r.callList.people ? `Worth a call: ${n(r.callList.people)} people, ${money(r.callList.value)}.` : "",
    "",
    `Run it again: ${location.href.split("#")[0]}`,
  ].filter((l, i, a) => l || a[i - 1]);
  return `mailto:?subject=${encodeURIComponent(Q("My quote audit"))}&body=${encodeURIComponent(lines.join("\n"))}`;
}

function renderClean(r: AuditResult) {
  const has = r.pastCustomersNotBack > 0;
  $("#cleanPast").textContent = has
    ? `Your ${n(r.pastCustomersNotBack)} past customers who haven't been back might be a different story.`
    : "Past customers who haven't booked in a year? Drop your clients export.";
  const btn = $("#cleanGo");
  btn.innerHTML = has ? `Start on my past customers. Free. <span class="arr" aria-hidden="true">&rarr;</span>` : "Add my clients export";
  btn.hidden = lastSample && has;
  $("#cleanFine").hidden = !has || lastSample;
  $("#cleanHint").hidden = has;
}

/* ------------------------------ one-tap start ------------------------------ */

function openOneTap() {
  const wrap = $("#oneTapWrap");
  wrap.hidden = false;
  const c = $<HTMLInputElement>("#otCompany");
  if (!c.value) c.value = $<HTMLInputElement>("#pCompany").value.trim() || who.company;
  const f = $<HTMLInputElement>("#otFirst");
  if (!f.value && who.first) f.value = who.first;
  const s = $<HTMLInputElement>("#otSigner");
  if (!s.value) s.value = $<HTMLInputElement>("#pSigner").value.trim();
  consentLabels();
  wrap.scrollIntoView({ behavior: "smooth", block: "center" });
  const empty = [f, $<HTMLInputElement>("#otCell"), c].find((x) => !x.value.trim());
  setTimeout(() => (empty ?? f).focus({ preventScroll: true }), 350);
}

const ownFile = () => !!last && !lastSample && files.length > 0;

$("#goBtn").addEventListener("click", () => {
  if (lastSample) $("#acard").scrollIntoView({ behavior: "smooth", block: "start" });
  else openOneTap();
});
$("#cleanGo").addEventListener("click", () => {
  if (last && last.pastCustomersNotBack > 0) openOneTap();
  else $<HTMLInputElement>("#addFile").click();
});
$("#addClients").addEventListener("click", () => $<HTMLInputElement>("#addFile").click());

function consentLabels() {
  const company = $<HTMLInputElement>("#otCompany").value.trim() || "my company";
  $("#otConsentText").textContent = `Send this file to Quiet Accounts and follow up with my customers on behalf of ${company}.`;
  const main = $<HTMLInputElement>("#company").value.trim() || "my company";
  $("#consentText").textContent = ownFile()
    ? `Send this file to Quiet Accounts and follow up with my customers on behalf of ${main}.`
    : "I authorize Quiet Accounts to follow up with my customers on behalf of my company.";
}
["#otCompany", "#company"].forEach((s) => $(s).addEventListener("input", consentLabels));

/** Where sign-ups go. Set <meta name="qa-signup" content="https://…"> on the live site; without it this is a preview. */
const endpoint = () => document.querySelector<HTMLMetaElement>('meta[name="qa-signup"]')?.content?.trim() || undefined;

interface Signup {
  company: string;
  first: string;
  cell: string;
  signer?: string;
  software?: string;
}
type SignupResult = { state: "sent" | "preview" | "failed"; error?: string; withFile: boolean; fileByText: boolean };

async function signup(o: Signup, sendFile: boolean): Promise<SignupResult> {
  let withFile = false;
  let fileByText = false;
  let payloadFiles: AuditFile[] | undefined;
  if (sendFile && files.length) {
    const bytes = files.reduce((s, f) => s + new Blob([f.text]).size, 0);
    if (files.length <= MAX_FILES && bytes <= MAX_BYTES) {
      payloadFiles = files.map((f) => ({ name: f.name, text: f.text }));
      withFile = true;
    } else fileByText = true;
  }
  const body = {
    company: o.company,
    first: o.first,
    cell: o.cell,
    ...(o.signer ? { signer: o.signer } : {}),
    trade: last?.trade ?? trade.engine,
    ...(o.software ? { software: o.software } : {}),
    consent: true as const,
    ...(payloadFiles ? { files: payloadFiles } : {}),
    ...(last && !lastSample ? { audit: { quotes: last.quotes, silent: { count: last.silent.count, value: last.silent.value }, perMonth: last.perMonth.value } } : {}),
    ...(ref ? { ref } : {}),
  };
  const url = endpoint();
  if (!url) return { state: "preview", withFile, fileByText };
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
    if (res.ok && data.ok !== false) return { state: "sent", withFile, fileByText };
    return { state: "failed", error: data.error, withFile, fileByText };
  } catch {
    return { state: "failed", withFile, fileByText };
  }
}

const failText = (error?: string) => `That didn't reach us${error ? ` (${error.replace(/\.$/, "")})` : ""}. Try again, or text 603-340-7673 with your company name and we'll take it from there.`;
const doneFine = (s: SignupResult) => [s.fileByText ? "We'll ask for the file by text." : "", s.state === "preview" ? "Preview: this page doesn't send your details anywhere yet." : ""].filter(Boolean).join(" ");

function check(fields: HTMLInputElement[], consent: HTMLInputElement): HTMLInputElement | undefined {
  let bad: HTMLInputElement | undefined;
  for (const el of fields) {
    const ok = !!el.value.trim() && (el.type !== "tel" || el.value.replace(/\D/g, "").length >= 10);
    el.setAttribute("aria-invalid", ok ? "false" : "true");
    if (!ok) bad ??= el;
  }
  if (!bad && !consent.checked) bad = consent;
  return bad;
}

const softwareOf = (src?: string) => (src === "jobber" ? "jobber" : src === "housecall_pro" ? "hcp" : src ? "other" : undefined);

$<HTMLFormElement>("#oneTap").addEventListener("submit", async (e) => {
  e.preventDefault();
  const get = (id: string) => $<HTMLInputElement>(`#${id}`);
  const bad = check([get("otFirst"), get("otCell"), get("otCompany")], get("otConsent"));
  if (bad) {
    bad.focus();
    return;
  }
  const form = e.target as HTMLFormElement;
  const btn = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  btn.disabled = true;
  const o: Signup = { company: get("otCompany").value.trim(), first: get("otFirst").value.trim(), cell: get("otCell").value.trim(), signer: get("otSigner").value.trim() || undefined, software: softwareOf(last?.source) };
  const s = await signup(o, true);
  btn.disabled = false;
  if (s.state === "failed") {
    const err = $("#otErr");
    err.hidden = false;
    err.textContent = failText(s.error);
    return;
  }
  $("#otErr").hidden = true;
  $("#otDoneH").textContent = `Got it, ${o.first}.`;
  $("#otDoneFine").textContent = doneFine(s);
  form.hidden = true;
  $("#otDone").hidden = false;
  started(o.first);
});

/* ------------------------------ the start form ------------------------------ */

const STEP1: Record<string, string> = {
  jobber: "In Jobber: <b>Reports → Quotes report → All time → Export CSV.</b> It doesn't download; Jobber emails it to your login address.",
  hcp: "In Housecall Pro: <b>Estimates → filter Open and Lost → Actions → Export.</b> It emails the file to whoever ran it.",
  other: "Export your quotes or estimates, with dates, from whatever you use, as a CSV or spreadsheet. Not sure how? Reply to our text and we'll walk you through it.",
};
let software = "jobber";
const cards = [...document.querySelectorAll<HTMLButtonElement>(".sw")];
cards.forEach((c, i) => {
  c.addEventListener("click", () => {
    software = c.dataset.sw!;
    cards.forEach((o) => {
      o.classList.toggle("on", o === c);
      o.setAttribute("aria-checked", o === c ? "true" : "false");
    });
  });
  c.addEventListener("keydown", (e) => {
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? cards[(i + 1) % cards.length] : e.key === "ArrowLeft" || e.key === "ArrowUp" ? cards[(i + cards.length - 1) % cards.length] : undefined;
    if (next) {
      e.preventDefault();
      next.click();
      next.focus();
    }
  });
});

$<HTMLFormElement>("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const get = (id: string) => f.querySelector<HTMLInputElement>(`#${id}`)!;
  const bad = check([get("company"), get("first"), get("cell")], get("consent"));
  if (bad) {
    bad.focus();
    return;
  }
  const btn = f.querySelector<HTMLButtonElement>("button[type=submit]")!;
  btn.disabled = true;
  const withFile = ownFile();
  const o: Signup = { company: get("company").value.trim(), first: get("first").value.trim(), cell: get("cell").value.trim(), signer: withFile ? $<HTMLInputElement>("#pSigner").value.trim() || undefined : undefined, software };
  const s = await signup(o, withFile);
  btn.disabled = false;
  if (s.state === "failed") {
    const err = $("#formErr");
    err.hidden = false;
    err.textContent = failText(s.error);
    return;
  }
  $("#formErr").hidden = true;
  const needFile = !s.withFile;
  $("#doneSteps").hidden = !needFile || s.fileByText;
  $("#doneFile").hidden = needFile && !s.fileByText;
  $("#step1").innerHTML = STEP1[software] ?? STEP1.other!;
  $("#doneH").textContent = needFile && !s.fileByText ? `Got it, ${o.first}. One thing left.` : `Got it, ${o.first}.`;
  $("#doneFine").textContent = doneFine(s);
  f.hidden = true;
  $("#done").hidden = false;
  started(o.first);
  $("#start").scrollIntoView({ behavior: "smooth", block: "start" });
});

let signedUp = false;
function started(first: string) {
  signedUp = true;
  sticky.classList.remove("show");
  document.body.classList.remove("stuck");
  const top = $<HTMLAnchorElement>("#topBtn");
  top.textContent = `Thanks, ${first}`;
  top.removeAttribute("href");
  top.classList.add("quiet");
}

/* ------------------------------ files in ------------------------------ */

async function readFiles(list: FileList | File[], add = false) {
  const picked = [...list].filter((f) => f.size > 0);
  if (!picked.length) return;
  const big = picked.find((f) => f.size > 40 * 1024 * 1024);
  if (big) {
    $("#audit").hidden = false;
    $("#result").hidden = true;
    $("#reading").hidden = true;
    $("#auditH").textContent = "That file is too big to read here.";
    const e = $("#auditErr");
    e.hidden = false;
    e.classList.remove("soft");
    e.textContent = Q(`${big.name} is over 40 MB. Export just quotes (not every report at once), or text 603-340-7673 and we'll take it from there.`);
    return;
  }
  const read = await Promise.all(picked.map(async (f) => ({ name: f.name, text: decode(await f.arrayBuffer()) })));
  // Kept exactly as read, for Start. A new drop replaces them; "add your clients export" adds to them.
  files = add && !lastSample ? [...files.filter((f) => !read.some((x) => x.name === f.name)), ...read] : read;
  $("#auditErr").classList.remove("soft");
  void start({ files }, add ? `Adding ${read.length === 1 ? read[0]!.name : `${read.length} files`}…` : `Reading ${read.length === 1 ? read[0]!.name : `${read.length} files`}…`);
}

const drop = $("#drop");
const input = $<HTMLInputElement>("#file");
input.addEventListener("change", () => {
  if (input.files) void readFiles(input.files);
  input.value = "";
});
const addInput = $<HTMLInputElement>("#addFile");
addInput.addEventListener("change", () => {
  if (addInput.files) void readFiles(addInput.files, true);
  addInput.value = "";
});
["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  }),
);
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files) void readFiles(e.dataTransfer.files);
});
$("#trySample").addEventListener("click", () => {
  files = [];
  void start({ sample: trade.engine }, `Reading a sample ${trade.sampleNoun}'s quotes…`);
});

/* ------------------------------ header, sticky bar ------------------------------ */

const sticky = $("#sticky");
const hero = $("#hero");
const startSec = $("#start");

/** Before an audit: what's your quiet rate. After one of their own: their own dollar figure. */
function setCalls() {
  const own = ownFile() && last && !isClean(last);
  const top = $<HTMLAnchorElement>("#topBtn");
  if (!signedUp) {
    top.textContent = last ? "Start my first 150" : "See my quiet quotes";
    top.href = last ? (own ? "#go" : "#start") : "#acard";
  }
  const btn = $<HTMLAnchorElement>("#stickyBtn");
  if (own && last) {
    $("#stickyText").innerHTML = `${money(last.silent.value)} sitting quiet<small>First 150 free · then $497 a month, only if you say yes</small>`;
    btn.textContent = "Start free";
    btn.href = "#go";
  } else {
    $("#stickyText").innerHTML = "What's your quiet rate?<small>10 seconds, in your browser</small>";
    btn.textContent = "Show me";
    btn.href = "#acard";
  }
}
[$("#topBtn"), $("#stickyBtn")].forEach((a) =>
  a.addEventListener("click", (e) => {
    if (a.getAttribute("href") === "#go" && ownFile()) {
      e.preventDefault();
      openOneTap();
    }
  }),
);

function stick() {
  if (signedUp) return;
  const y = window.scrollY;
  const past = y > hero.offsetTop + hero.offsetHeight - 80;
  const atForm = y + window.innerHeight > startSec.offsetTop + 120;
  const tap = $("#oneTapWrap");
  const atTap = !tap.hidden && !$("#audit").hidden && (() => { const b = tap.getBoundingClientRect(); return b.top < window.innerHeight && b.bottom > 0; })();
  // A clean file of their own: they know their rate, and there's no quote work to start.
  const cleanOwn = !!last && !lastSample && isClean(last);
  const show = past && !atForm && !atTap && !cleanOwn;
  sticky.classList.toggle("show", show);
  document.body.classList.toggle("stuck", show);
}
window.addEventListener("scroll", stick, { passive: true });
window.addEventListener("resize", stick);

/* ------------------------------ go ------------------------------ */

if (campaign) {
  $("#logo").removeAttribute("href");
  $("#footTrades").hidden = true;
}
applyTrade(trade);
if (who.company) {
  $<HTMLInputElement>("#pCompany").value = who.company;
  $<HTMLInputElement>("#company").value = who.company;
}
if (who.first) $<HTMLInputElement>("#first").value = who.first;
setCalls();
stick();
