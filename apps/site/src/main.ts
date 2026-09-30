import type { AuditFile, AuditOptions, AuditResult } from "./audit.ts";
import { TRADES, tradeFromHash, type SiteTrade, type TradeCopy } from "./trades.ts";
import AuditWorker from "./worker.ts?worker&inline";
import logoUrl from "./assets/logo-mark.svg";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const n = (x: number) => Math.round(x).toLocaleString("en-US");
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (x: number) => usd.format(Math.round(x));
/** Kept in step with audit.ts; the page doesn't load the engine itself, only the worker does. */
const ADDRESS_SLOT = "[your business address]";
const monthYear = (iso?: string) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "");

/* ------------------------------ trade ------------------------------ */

/**
 * Personal links from our own outreach: ?t=fence&c=Nelson+Fence+LLC&n=DAVID. The company name is tidied
 * (no LLC/Inc, no SHOUTING) and dropped into the preview note and the form. Nothing else is read.
 */
const params = new URLSearchParams(location.search);
const tidy = (s: string | null, max: number) =>
  (s ?? "")
    .replace(/[<>]/g, "")
    .replace(/,?\s*\b(llc|l\.l\.c\.|inc\.?|incorporated|co\.?,? ?llc|corp\.?|ltd\.?)$/i, "")
    .trim()
    .slice(0, max)
    // ALL CAPS from a lead list becomes Title Case; anything already mixed-case is left alone (keeps "ABC Tree")
    .replace(/^[^a-z]*$/, (all) => all.replace(/\b([A-Z])([A-Z']+)\b/g, (_, a: string, b: string) => a + b.toLowerCase()));
const who = { company: tidy(params.get("c"), 60), first: tidy(params.get("n"), 30).split(/\s+/)[0] ?? "" };
const tParam = params.get("t");

let trade: TradeCopy = TRADES[tParam && tParam in TRADES ? (tParam as SiteTrade) : tradeFromHash(location.hash)];

function setT(key: string, html: string) {
  document.querySelectorAll<HTMLElement>(`[data-t="${key}"]`).forEach((el) => (el.innerHTML = html));
}

const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

function applyTrade(t: TradeCopy) {
  trade = t;
  setT("eyebrow", esc(t.eyebrow));
  setT("h1", esc(t.h1));
  const p = t.proof;
  setT("tallyCap", esc(`${p.shop}, ${p.where} · ${p.list} · first 150`));
  setT("asked", String(p.asked));
  setT("wrote", String(p.wroteBack));
  setT("booked", String(p.booked));
  setT("jobs", esc(p.jobs));
  setT("exportHint", esc(t.exportHint));
  setT("sampleNoun", esc(t.sampleNoun));
  setT("reqSaid", esc(t.request.said));
  setT("reqAck", esc(t.request.ack));
  setT("journey", t.journey.map(([d, what, yes]) => `<li${yes ? ' class="yes"' : ""}><span class="d">Day ${esc(d)}</span><span>${esc(what)}</span></li>`).join(""));
  setT("ledger", t.ledger.map((r) => `<tr>${r.map((c, i) => `<td${i === 4 ? ' class="amt"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join(""));
  const won = t.ledger.slice(0, 2);
  const wonValue = won.reduce((s, r) => s + Number(r[4].replace(/[^0-9]/g, "")), 0);
  setT(
    "friday",
    esc(
      [
        `Dave, 2 jobs came back this week — ${money(wonValue)}.`,
        "Notes out: 61 (to 38 people)",
        "Always on: answered 4 new requests within minutes, followed up 9 new quotes",
        "Wrote back: 7",
        "Want a price or a date: 3",
        `Booked: 2 · ${money(wonValue)}`,
        "Your average time to call them back: 3h",
      ].join("\n"),
    ),
  );
  $("#feed").innerHTML =
    `<p class="qw-day">Today</p>` +
    t.texts
      .map(
        (x, i) =>
          `<div class="qw-push"><img class="qw-app" src="${logoUrl}" alt=""><div><div class="qw-top"><span>Quiet Accounts</span><span>${i ? "2:40 PM" : "9:12 AM"}</span></div><b class="qw-title">${esc(x.name)} wants it done</b><span class="qw-sub">${esc(x.job)}</span><span class="qw-said">${esc(x.said)}</span><span class="qw-meta">${esc(x.meta)}</span><span class="qw-win"><i>${CHECK}</i><span><b>${esc(x.value)}</b> back on the table</span></span></div></div>` +
          (i === 0 ? `<div class="qw-me"><small>You · 9:14 AM</small><span>${esc(t.ownerReply)}</span></div>` : ""),
      )
      .join("");
  $<HTMLInputElement>("#company").placeholder = t.id === "tree" ? "Ridgeline Tree Co." : t.id === "fence" ? "Stonewall Fence Co." : t.id === "painting" ? "Brushline Painting" : "Tidewell Home Cleaning";
}

window.addEventListener("hashchange", () => {
  const h = location.hash.slice(1);
  if ((Object.keys(TRADES) as string[]).includes(h)) {
    applyTrade(TRADES[h as SiteTrade]);
    $("#top").scrollIntoView({ behavior: "smooth" });
  }
});
applyTrade(trade);
if (who.company) {
  $<HTMLInputElement>("#pCompany").value = who.company;
  $<HTMLInputElement>("#company").value = who.company;
}
if (who.first) {
  $<HTMLInputElement>("#first").value = who.first;
  setT("h1", esc(`${who.first}, ${trade.h1.charAt(0).toLowerCase()}${trade.h1.slice(1)}`));
}

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function start(req: { files: AuditFile[] } | { sample: TradeCopy["engine"] }, label: string) {
  const sec = $("#audit");
  sec.hidden = false;
  $("#result").hidden = true;
  $("#auditErr").hidden = true;
  lastSample = "sample" in req;
  $("#auditEyebrow").textContent = lastSample ? `Sample · a made-up ${trade.sampleNoun}` : "Your quote audit";
  $("#auditH").textContent = label;
  const steps = $("#steps");
  steps.innerHTML = `<li class="on"><span>Reading ${lastSample ? "five years of sample quotes" : "your file"}…</span></li>`;
  sec.scrollIntoView({ behavior: "smooth", block: "start" });

  const began = performance.now();
  let r: AuditResult;
  try {
    r = await audit(req, { company: $<HTMLInputElement>("#pCompany").value || undefined, signer: $<HTMLInputElement>("#pSigner").value || undefined });
  } catch (err) {
    steps.innerHTML = "";
    $("#auditH").textContent = "That file didn't read.";
    const e = $("#auditErr");
    e.hidden = false;
    e.textContent = `${err instanceof Error ? err.message : String(err)} Try the quotes report straight from your software, as a CSV. Stuck? Text 603-340-7673 and we'll look at it with you.`;
    return;
  }
  if (!r.quotes) {
    steps.innerHTML = "";
    $("#auditH").textContent = "We couldn't find any quotes in that file.";
    const e = $("#auditErr");
    e.hidden = false;
    e.textContent = "This works from a quotes (or estimates) report: one row per quote, with a date, an amount and a status. In Jobber that's Reports → Quotes report. Text 603-340-7673 if you'd like a hand.";
    return;
  }
  last = r;
  if (!lastSample) $<HTMLInputElement>("#pCompany").placeholder = "Your company";
  else $<HTMLInputElement>("#pCompany").value = r.company;

  // Stream what was found, in their numbers, then the result.
  const lines = [
    `Read <b>${n(r.quotes)}</b> quotes${r.from ? `, ${monthYear(r.from)} to ${monthYear(r.to)}` : ""}.`,
    `<b>${n(r.won.count)}</b> became work. <b>${n(r.saidNo.count)}</b> got a no.`,
    `<b>${n(r.silent.count)}</b> never got a yes or a no.`,
    r.requestsNeverPriced ? `<b>${n(r.requestsNeverPriced)}</b> requests in the last year never got a price.` : "",
    r.pastCustomersNotBack ? `<b>${n(r.pastCustomersNotBack)}</b> past customers we can reach haven't been back.` : "",
    r.hottest ? `Wrote the first note to <b>${esc(r.hottest.name)}</b>.` : "",
  ].filter(Boolean);
  const wait = Math.max(0, 500 - (performance.now() - began));
  await sleep(wait);
  steps.innerHTML = lines.map((l) => `<li><span>${l}</span></li>`).join("");
  const items = [...steps.querySelectorAll("li")];
  for (const li of items) {
    li.classList.add("on");
    await sleep(380);
    li.classList.add("done");
  }
  // The quiet rate, from their own file: the one number the whole service drives toward zero.
  const sent = r.won.count + r.saidNo.count + r.silent.count;
  $("#auditH").textContent = r.silent.count && sent
    ? `${Math.round((r.silent.count / sent) * 100)}% of your quotes never got a yes or a no. ${money(r.silent.value)} is sitting quiet.`
    : "Every quote got an answer. That's rare.";
  render(r);
}

function render(r: AuditResult) {
  $("#rSilent").textContent = money(r.silent.value);
  $("#rSilentWhat").textContent = `${n(r.silent.count)} quotes${r.from ? `, ${monthYear(r.from)} to ${monthYear(r.to)}` : ""}`;
  const pm = r.perMonth;
  $("#rLine").textContent = pm.value > 0 ? `Every month about ${money(pm.value >= 1000 ? Math.round(pm.value / 100) * 100 : pm.value)} of what you quote goes quiet. That's ${Math.round(pm.shareOfQuoted * 100)} cents of every quoted dollar, and nobody said no to it.` : "";

  // What our first three shops saw on old quotes (4 of 150 booked; 1.5–4% across them), applied to this file.
  // Always labelled: owner-reported, no comparison group, an estimate.
  const asked = Math.min(150, r.silent.count);
  const lo = Math.round(asked * 0.015), hi = Math.round(asked * 0.04);
  const ifAsked = $("#rIf");
  const each = r.typicalQuiet ?? r.typicalQuote;
  ifAsked.hidden = !(hi >= 2 && each);
  if (each && !ifAsked.hidden)
    ifAsked.innerHTML = `If yours go like our first three shops, about <b>${lo}–${hi}</b> of the first ${n(asked)} book. At your typical unanswered quote of ${money(each)}, that's roughly <b>${money(lo * each)}–${money(hi * each)}</b>. <span>Owner-reported by those shops, no comparison group. Your free round shows your real number.</span>`;

  $("#rSent").textContent = `${n(r.won.count + r.saidNo.count + r.silent.count)} quotes sent`;
  $("#rRange").textContent = "Sent at least two weeks ago. Won, lost, or still “awaiting response”.";
  const total = Math.max(1, r.won.count + r.saidNo.count + r.silent.count);
  const row = (cls: string, label: string, x: { count: number; value: number }) =>
    `<li class="${cls}"><span>${label} <span class="num" style="color:var(--ink-3);font-weight:600">· ${money(x.value)}</span></span><b>${n(x.count)}</b><span class="bar"><i style="width:${Math.max(1.5, (x.count / total) * 100).toFixed(1)}%"></i></span></li>`;
  $("#rSplit").innerHTML = row("won", "Became work", r.won) + row("no", "Said no", r.saidNo) + row("quiet", "Never answered", r.silent);
  const share = Math.round(r.silentShareOfLost * 100);
  $("#rAges").innerHTML =
    (share ? `<span><b>${share}%</b> of the quotes you didn't win were never answered, not lost on price</span>` : "") +
    r.byAge.filter((a) => a.count).map((a) => `<span>${esc(a.label)}: <b>${n(a.count)}</b> · ${money(a.value)}</span>`).join("");

  const facts: [string, string][] = [];
  if (r.requestsNeverPriced) facts.push([n(r.requestsNeverPriced), "requests in the last year never got a price"]);
  if (r.pastCustomersNotBack) facts.push([n(r.pastCustomersNotBack), "past customers we can reach who haven't been back"]);
  if (r.typicalQuote) facts.push([money(r.typicalQuote), "your typical quote"]);
  if (r.wastedLeadSpend) facts.push([money(r.wastedLeadSpend), "a year in leads you paid for and never heard from again"]);
  facts.push([n(r.reachable), "people we could write to, in your name"]);
  $("#rFacts").innerHTML = facts.map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("");

  renderNote();

  const cl = r.callList;
  const calls = $("#rCalls");
  calls.hidden = !cl.people;
  if (cl.people) {
    $("#rCallsH").textContent = `Worth a call from you: ${n(cl.people)} ${cl.people === 1 ? "person" : "people"}, ${money(cl.value)}`;
    const parts = [cl.bigQuotes ? `${n(cl.bigQuotes)} quote${cl.bigQuotes === 1 ? "" : "s"} over $10,000` : "", cl.phoneOnly ? `${n(cl.phoneOnly)} with only a phone number` : ""].filter(Boolean);
    $("#rCallsP").textContent = `${parts.join(" and ")}. We don't email these. You get the list, biggest first.`;
  }
  const people = r.silent.count;
  $("#followAll").innerHTML = `Follow up on ${people > 150 ? `your first 150` : `all ${n(people)}`} like this. Free. <span class="arr" aria-hidden="true">&rarr;</span>`;
  $("#followFine").textContent =
    people > 150
      ? `We work your first 150 free, the likeliest to answer first. Then ${money(497)} a month for the rest and everything new, and any month nobody asks for a price or a date is free.`
      : "We work your first 150 free. You read and OK the first note before anything goes out.";
  // Rows with no way to reach anyone are expected in every export; only surface the unusual.
  const odd = r.warnings.filter((w) => !/no email or phone/i.test(w));
  $("#rWarns").textContent = !lastSample && odd.length ? `From your file: ${odd.slice(0, 3).join(" ")}` : "";

  if (r.typicalQuote) {
    const covers = r.typicalQuote >= 497 ? "One yes a month covers it." : `${Math.ceil(497 / r.typicalQuote)} yeses a month cover it.`;
    $("#anchor").innerHTML = `${lastSample ? "This sample's" : "Your"} typical quote is <b>${money(r.typicalQuote)}</b>. ${covers}`;
  }
  $("#result").hidden = false;
}

function renderNote() {
  const r = last;
  const h = r?.hottest;
  const mail = $("#mail");
  if (!r || !h) {
    mail.hidden = true;
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
    let h = esc(s).replace(esc(ADDRESS_SLOT), `<span class="slot">${esc(ADDRESS_SLOT)}</span>`);
    if (!typed) h = h.split(esc(company)).join(`<span class="slot">${esc(company)}</span>`);
    return h;
  };
  $("#mTo").textContent = h.name;
  $("#mSubject").textContent = swap(h.subject);
  $("#mBody").innerHTML = slot(main) + (foot ? `<span class="mail-foot">${slot(foot)}</span>` : "");
  const first = h.name.split(" ")[0];
  $("#mCap").textContent = `Note 1 of ${h.notes} to ${first}, about ${h.job ? `the ${h.job}` : "her quote"} (${money(h.value)}, quiet ${n(h.quietDays)} days). The next ones go only if ${first} hasn't answered, and stop the minute anyone does.`;
}

["#pCompany", "#pSigner"].forEach((s) =>
  $(s).addEventListener("input", () => {
    renderNote();
    const c = $<HTMLInputElement>("#pCompany").value.trim();
    if (c) $<HTMLInputElement>("#company").value = c;
  }),
);

async function readFiles(list: FileList | File[]) {
  const files = [...list].filter((f) => f.size > 0);
  if (!files.length) return;
  const big = files.find((f) => f.size > 40 * 1024 * 1024);
  if (big) {
    $("#audit").hidden = false;
    $("#auditH").textContent = "That file is too big to read here.";
    const e = $("#auditErr");
    e.hidden = false;
    e.textContent = `${big.name} is over 40 MB. Export just quotes (not every report at once), or text 603-340-7673 and we'll take it from there.`;
    return;
  }
  const read = await Promise.all(files.map(async (f) => ({ name: f.name, text: decode(await f.arrayBuffer()) })));
  void start({ files: read }, `Reading ${files.length === 1 ? files[0]!.name : `${files.length} files`}…`);
}

const drop = $("#drop");
const input = $<HTMLInputElement>("#file");
input.addEventListener("change", () => {
  if (input.files) void readFiles(input.files);
  input.value = "";
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
$("#trySample").addEventListener("click", () => void start({ sample: trade.engine }, `Reading a sample ${trade.sampleNoun}'s quotes…`));

/* ------------------------------ sticky bar ------------------------------ */

const sticky = $("#sticky");
const hero = $("#hero");
const startSec = $("#start");
function stick() {
  const y = window.scrollY;
  const past = y > hero.offsetTop + hero.offsetHeight - 80;
  const atForm = y + window.innerHeight > startSec.offsetTop + 120;
  sticky.classList.toggle("show", past && !atForm);
}
window.addEventListener("scroll", stick, { passive: true });
window.addEventListener("resize", stick);
stick();

/* ------------------------------ start form ------------------------------ */

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

/** Where sign-ups go. Set <meta name="qa-signup" content="https://…"> on the live site; without it this is a preview. */
const endpoint = document.querySelector<HTMLMetaElement>('meta[name="qa-signup"]')?.content;

$<HTMLFormElement>("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  const get = (id: string) => f.querySelector<HTMLInputElement>(`#${id}`)!;
  let bad: HTMLInputElement | undefined;
  for (const id of ["company", "first", "cell"]) {
    const el = get(id);
    const ok = !!el.value.trim() && (id !== "cell" || el.value.replace(/\D/g, "").length >= 10);
    el.setAttribute("aria-invalid", ok ? "false" : "true");
    if (!ok) bad ??= el;
  }
  const consent = get("consent");
  if (!bad && !consent.checked) bad = consent;
  if (bad) {
    bad.focus();
    return;
  }
  const lead = {
    company: get("company").value.trim(),
    first: get("first").value.trim(),
    cell: get("cell").value.trim(),
    software,
    trade: last?.trade ?? trade.engine,
    audit: last && !lastSample ? { quotes: last.quotes, silent: last.silent, perMonth: last.perMonth.value } : undefined,
  };
  let sent = false;
  if (endpoint) {
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(lead) });
      sent = res.ok;
    } catch {
      sent = false;
    }
  }
  $("#step1").innerHTML = STEP1[software] ?? STEP1.other!;
  $("#doneH").textContent = `Got it, ${lead.first}. One thing left.`;
  $("#doneFine").textContent = endpoint ? (sent ? "" : "That didn't reach us. Text 603-340-7673 with your company name and we'll take it from there.") : "Preview: this page doesn't send your details anywhere yet.";
  f.hidden = true;
  $("#done").hidden = false;
  startSec.scrollIntoView({ behavior: "smooth", block: "start" });
});
