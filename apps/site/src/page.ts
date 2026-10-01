import { sums, whole as n } from "./calc.ts";
import { companyFromQuery, netlifyBody, numberFromQuery, refFor, signupBody, smsLink, type Signup } from "./form.ts";
import { fillIn } from "./note.ts";

/**
 * The page's one form, its notes, its buttons and the sticky bar. The first press of the button only shows his note
 * and the text he'd get (a ?co= link shows them on load); nothing leaves the page until the second press, with his
 * name, cell and the consent box. No engine here: the notes were written at build time, and this only fills in his
 * company and name.
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
let signedUp = false;

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

async function send(s: Signup): Promise<boolean> {
  try {
    const res = server
      ? await fetch(`${server}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signupBody(s)) })
      : await fetch("/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: netlifyBody(s) });
    return res.ok;
  } catch {
    return false;
  }
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
  signedUp = true;
  stick();
});

/* ------------------------------ every other button leads back to the form ------------------------------ */

for (const a of all<HTMLAnchorElement>('a[href="#start"]')) {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    if (signedUp || reveal.hidden) {
      $("#start").scrollIntoView({ behavior: smooth(), block: "start" });
      if (!signedUp) company.focus({ preventScroll: true });
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
  sticky.classList.toggle("show", !signedUp && ![...inView.values()].some(Boolean));
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
