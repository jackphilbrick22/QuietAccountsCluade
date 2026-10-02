import type { TradeId } from "@qa/engine";
import type { AuditFile, AuditResult } from "./audit.ts";
import { sums, whole as n } from "./calc.ts";
import { companyFromQuery, netlifyBody, numberFromQuery, refFor, signupBody, smsLink, withFile, type Signup } from "./form.ts";
import { fillIn } from "./note.ts";
import type { AuditRequest } from "./worker.ts";
import AuditWorker from "./worker.ts?worker";

/**
 * The page's one form, its notes, its buttons and the sticky bar. The first press of the button only shows his note
 * and the text he'd get (a ?co= link shows them on load); nothing leaves the page until the second press, with his
 * name, cell and the consent box. No engine here: the notes were written at build time, and this only fills in his
 * company and name. The engine comes only with a file he drops after signing up, in the audit's worker.
 */
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const all = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];
const server = import.meta.env.VITE_SERVER_URL?.replace(/\/+$/, "");
const smooth = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

const form = $<HTMLFormElement>("#form");
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
const company = field("company");
const first = field("first");
const cell = field("cell");
const consent = field("consent");
const software = field("software");
const reveal = $("#reveal");
const button = $<HTMLButtonElement>("#submit");
/** What he signed up with: a file he drops afterwards goes to the server with it. */
let signup: Signup | undefined;

/* ------------------------------ his note, as he types ------------------------------ */

function paint() {
  const co = company.value.trim() || company.placeholder;
  const signer = first.value.trim() || form.dataset.signer!;
  for (const el of all("[data-template]")) el.textContent = fillIn(el.dataset.template!, co, signer);
  for (const el of all("[data-company]")) el.textContent = co;
  $("#sigHint").hidden = !!first.value.trim();
}
company.addEventListener("input", paint);
first.addEventListener("input", paint);

const fromLink = companyFromQuery(location.search);
if (fromLink) {
  company.value = fromLink;
  reveal.hidden = false;
  paint();
}

/* ------------------------------ where your jobs live ------------------------------ */

const picks = all<HTMLButtonElement>(".sw");
picks.forEach((b, i) => {
  b.addEventListener("click", () => {
    software.value = b.dataset.sw!;
    for (const o of picks) {
      o.classList.toggle("on", o === b);
      o.setAttribute("aria-checked", String(o === b));
    }
  });
  b.addEventListener("keydown", (e) => {
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? picks[(i + 1) % picks.length] : e.key === "ArrowLeft" || e.key === "ArrowUp" ? picks[(i + picks.length - 1) % picks.length] : undefined;
    if (next) {
      e.preventDefault();
      next.click();
      next.focus();
    }
  });
});

/* ------------------------------ the button: show, then send ------------------------------ */

/** Marks each field right or wrong; the first wrong one, if any. */
function check(rules: [HTMLInputElement, boolean][]): HTMLInputElement | undefined {
  for (const [el, ok] of rules) el.setAttribute("aria-invalid", String(!ok));
  return rules.find(([, ok]) => !ok)?.[0];
}

const wentThrough = (res: Promise<Response>) => res.then((r) => r.ok, () => false);
const toServer = (body: object) => wentThrough(fetch(`${server}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

function send(s: Signup): Promise<boolean> {
  return server ? toServer(signupBody(s)) : wentThrough(fetch("/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: netlifyBody(s) }));
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const co = company.value.trim();
  if (reveal.hidden) {
    const bad = check([[company, co.length >= 2]]);
    if (bad) return bad.focus();
    reveal.hidden = false;
    paint();
    const h = $("#revealH");
    h.focus({ preventScroll: true });
    h.scrollIntoView({ behavior: smooth(), block: "start" });
    return;
  }
  const bad = check([
    [company, co.length >= 2],
    [first, !!first.value.trim()],
    [cell, cell.value.replace(/\D/g, "").length >= 10],
    [consent, consent.checked],
  ]);
  if (bad) return bad.focus();
  button.disabled = true;
  const s: Signup = { company: co, first: first.value.trim(), cell: cell.value.trim(), software: software.value, trade: form.dataset.trade!, offer: form.dataset.offer as Signup["offer"], ref: refFor(form.dataset.page!, location.search), website: field("website").value };
  const ok = await send(s);
  button.disabled = false;
  const err = $("#formErr");
  if (!ok) {
    $<HTMLAnchorElement>("#smsJack").href = smsLink(s.company, s.first);
    err.hidden = false;
    return;
  }
  err.hidden = true;
  for (const p of all("[data-step]")) p.hidden = p.dataset.step !== s.software;
  $("#doneH").textContent = `Got it, ${s.first}. One thing left.`;
  form.hidden = true;
  const done = $("#done");
  done.hidden = false;
  done.focus({ preventScroll: true });
  $("#start").scrollIntoView({ behavior: smooth(), block: "start" });
  signup = s;
  stick();
});

/* ------------------------------ his file, read on his screen ------------------------------ */

const dz = $("#dz");
const dzFile = $<HTMLInputElement>("#dzFile");
const sendFile = $<HTMLButtonElement>("#dzSendB");
const noun = $("#dfile").dataset.quotes;
/** The files dropped since the last send: the Visits report joins the Quotes report dropped before it. */
let held: File[] = [];
/** The latest result, and the files it was read from. */
let read: { from: File[]; files: AuditFile[]; result: AuditResult } | undefined;
/** What his sends have brought the server so far: on a one-pass page, his quotes and his past jobs. */
const sent = { quotes: false, past: false };
let worker: Worker | undefined;
let turn = 0;

/** The audit, in its worker: loaded with the first file, and answering only the latest. */
function audit(id: number, files: AuditFile[], opts: AuditRequest["opts"]): Promise<AuditResult> {
  worker ??= new AuditWorker();
  return new Promise((resolve, reject) => {
    worker!.onmessage = (e: MessageEvent<{ id: number; result?: AuditResult; error?: string }>) => {
      if (e.data.id === id) (e.data.result ? resolve(e.data.result) : reject(new Error(e.data.error)));
    };
    // it didn't load, or it died: the next file starts a new one
    worker!.onerror = () => {
      worker?.terminate();
      worker = undefined;
      reject(new Error("The audit didn't load."));
    };
    worker!.postMessage({ id, files, opts } satisfies AuditRequest);
  });
}

async function take(picked: File[]) {
  if (!picked.length || !signup) return;
  const mine = ++turn;
  held = [...held.filter((f) => !picked.some((x) => x.name === f.name)), ...picked].slice(-5);
  const from = held;
  read = undefined;
  for (const id of ["#dzOut", "#dzErr"]) $(id).hidden = true;
  $("#dzBusy").hidden = false;
  try {
    const files = await Promise.all(from.map(async (f) => ({ name: f.name, text: await f.text() })));
    // a newer file came in while these were read: it reads them all again
    if (mine !== turn) return;
    read = { from, files, result: await audit(mine, files, { company: signup.company, signer: signup.first, trade: form.dataset.trade as TradeId }) };
    show(read);
  } catch {
    // what he just picked didn't read (a folder, say): the files before it read on, with his next one or alone
    held = held.filter((f) => !picked.includes(f));
    if (mine === turn) $("#dzErr").hidden = false;
  } finally {
    if (mine === turn) $("#dzBusy").hidden = true;
  }
}

dz.addEventListener("dragover", (e) => {
  e.preventDefault();
  dz.classList.add("over");
});
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("over");
  void take([...(e.dataTransfer?.files ?? [])]);
});
dzFile.addEventListener("change", () => {
  void take([...(dzFile.files ?? [])]);
  dzFile.value = "";
});

const money = (x: number) => `$${n(x)}`;
const count = (k: number, one: string, many: string) => `${n(k)} ${k === 1 ? one : many}`;
const monthYear = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** A row a cell at a time, as text: names from his file never go in as HTML. */
function rows(el: HTMLElement, list: string[][]) {
  el.replaceChildren(
    ...list.map((cells) => {
      const row = document.createElement("div");
      row.className = "dz-row";
      row.append(...cells.map((text) => Object.assign(document.createElement("span"), { textContent: text })));
      return row;
    }),
  );
}

/** What his file says: quotes nobody answered (one-pass pages), past customers who haven't been back, and a first note. */
function show({ files, result: r }: NonNullable<typeof read>) {
  const quotes = !!noun && r.silent.count > 0;
  const past = r.past;
  $("#dzFiles").textContent = `Read on your screen: ${files.map((f) => f.name).join(", ")}`;
  if (noun) {
    $("#rQuotes").hidden = !quotes;
    $("#rqValue").textContent = money(r.silent.value);
    $("#rqCount").textContent = count(r.silent.count, noun.slice(0, -1), noun);
    $("#rqRange").textContent = `Read ${count(r.quotes, noun.slice(0, -1), noun)}${r.from && r.to ? `, ${monthYear(r.from)} to ${monthYear(r.to)}` : ""}. ${n(r.won.count)} became work, ${n(r.saidNo.count)} got a no.`;
    rows($("#rqAges"), r.byAge.filter((a) => a.count).map((a) => [a.label, n(a.count), money(a.value)]));
  }
  $("#rPast").hidden = !past;
  if (past) {
    $("#rpHead").textContent = `${count(past.people, "past customer hasn't", "past customers haven't")} been back.`;
    // what they paid, only when his file says it for every one of them
    $("#rpPaid").hidden = !past.paid;
    $("#rpPaid").textContent = past.paid ? `In their last year with you, they paid ${money(past.paid)}${past.people > 1 ? " between them" : ""}.` : "";
    rows($("#rpWhen"), past.when.map((w) => [w.label, count(w.people, "person", "people"), ...(w.paid ? [money(w.paid)] : [])]));
  }
  const found = quotes || !!past;
  const note = quotes ? r.hottest : past?.note;
  $("#dzNone").hidden = found;
  $("#rNote").hidden = !note;
  $("#rnTo").textContent = note ? `Note 1 · to ${note.name}` : "";
  $("#rnBody").textContent = note?.body ?? "";
  $("#rnFoot").textContent = note?.foot ?? "";
  $("#dzSend").hidden = !server || !found;
  sendFile.textContent = files.length > 1 ? "Send these files" : "Send this file";
  $("#dzFwd").hidden = !!server || !found;
  for (const el of all("#dzSent, #dzSendErr, [data-need]")) el.hidden = true;
  $("#dzOut").hidden = false;
}

sendFile.addEventListener("click", async () => {
  if (!read || !signup) return;
  const { from, files, result: r } = read;
  const mine = turn;
  sendFile.disabled = true;
  const ok = await toServer(withFile(signup, files, r));
  sendFile.disabled = false;
  if (ok) {
    // the server has these: a file dropped from here on is sent on its own
    held = held.filter((f) => !from.includes(f));
    sent.quotes ||= r.quotes > 0;
    sent.past ||= r.hasPastWork || !!r.past;
  }
  // a file he picked while this went out has its own result, and its own send
  if (mine !== turn) return;
  // on a one-pass page, the export still to come: his past jobs, or his quotes
  const need = !noun || (sent.quotes && sent.past) ? "" : sent.quotes ? "past" : "quotes";
  $("#dzSend").hidden = ok;
  $("#dzSent").hidden = !ok || !!need;
  for (const el of all("[data-need]")) el.hidden = !ok || el.dataset.need !== need;
  $("#dzSendErr").hidden = ok;
  if (!ok) $<HTMLAnchorElement>("#smsFile").href = smsLink(signup.company, signup.first, `send my file${files.length > 1 ? "s" : ""}`);
});

/* ------------------------------ every other button leads back to the form ------------------------------ */

for (const a of all<HTMLAnchorElement>('a[href="#start"]')) {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    if (signup || reveal.hidden) {
      $("#start").scrollIntoView({ behavior: smooth(), block: "start" });
      if (!signup) company.focus({ preventScroll: true });
      return;
    }
    // his note is showing, so the form runs long: straight to the first field he hasn't filled
    const next = [company, first, cell].find((x) => !x.value.trim()) ?? consent;
    next.scrollIntoView({ behavior: smooth(), block: "center" });
    next.focus({ preventScroll: true });
  });
}

/* ------------------------------ the sticky bar: on phones, while the form is out of sight ------------------------------ */

const sticky = $("#sticky");
const inView = new Map<Element, boolean>();
function stick() {
  sticky.classList.toggle("show", !signup && ![...inView.values()].some(Boolean));
}
const watch = new IntersectionObserver((entries) => {
  for (const x of entries) inView.set(x.target, x.isIntersecting);
  stick();
});
for (const el of all("#hero, #final")) watch.observe(el);

/* ------------------------------ the money ------------------------------ */

const calc = document.querySelector<HTMLElement>("#calc");
if (calc) {
  const count = $<HTMLInputElement>("#cN");
  const job = $<HTMLInputElement>("#cJ");
  const d = calc.dataset;
  const lead = { booked: +d.booked!, asked: +d.asked! };
  const pay = d.each ? { each: +d.each, cap: +d.cap! } : undefined;
  const fill = (r: HTMLInputElement) => r.style.setProperty("--p", `${((+r.value - +r.min) / (+r.max - +r.min)) * 100}%`);
  const run = () => {
    const m = sums(+count.value, +job.value, lead, pay);
    $("#oN").textContent = n(+count.value);
    $("#oJ").textContent = `$${n(+job.value)}`;
    $("#rJobs").textContent = n(m.jobs);
    $("#rVal").textContent = `$${n(m.value)}`;
    if (pay) {
      $("#rPay").textContent = `$${n(m.pay!)}`;
      $("#rShare").textContent = m.share!;
    }
    fill(count);
    fill(job);
  };
  // his own number from here on, not an example
  const mine = (r: HTMLInputElement) => ($(`#${r.id}Eg`).hidden = true);
  // a link from Jack's email can carry his quote count, estimated from his public reviews (where the page says so),
  // and his average job; the slider keeps either within its range
  const q = numberFromQuery(location.search, "q");
  const j = numberFromQuery(location.search, "j");
  const estimate = document.querySelector<HTMLElement>("#estNote");
  if (q && estimate) {
    count.value = String(q);
    estimate.hidden = false;
    mine(count);
  }
  if (j) {
    job.value = String(j);
    mine(job);
  }
  for (const r of [count, job])
    r.addEventListener("input", () => {
      mine(r);
      run();
    });
  run();
}
