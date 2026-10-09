import type { TradeId } from "@qa/engine";
import type { AuditFile, AuditResult } from "./audit.ts";
import { sums, whole as n } from "./calc.ts";
import { companyFromQuery, netlifyBody, numberFromQuery, refFor, signupBody, smsLink, withFile, type Signup } from "./form.ts";
import { fillIn, MINE } from "./note.ts";
import type { AuditRequest } from "./worker.ts";
import AuditWorker from "./worker.ts?worker";

/**
 * The page's one form, its notes, its buttons and the sticky bar. The first press of the button only shows his note
 * and the text he'd get (a ?co= link shows them on load); nothing leaves the page until the second press, with his
 * name, cell and the consent box. No engine here: the notes were written at build time, and this only fills in his
 * company and name. The engine comes only with a file he drops after signing up, in the audit's worker.
 */
// Jobber sends an owner back with ?code=: to whatever page he lands on, it's the Jobber function's (it opens his room)
if (/[?&]code=/.test(location.search)) location.replace(`/jobber/manage${location.search}`);

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
  const typed = company.value.trim();
  const co = typed || company.placeholder;
  const signer = first.value.trim() || form.dataset.signer!;
  // the consent box never puts the example company in his mouth: until he types his own, it's "my company"
  for (const el of all("[data-template]")) el.textContent = fillIn(el.dataset.template!, typed || !el.closest(".consent") ? co : MINE, signer);
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

// the cold email page: the company his link brought is a line he can change, and the page says it's his
const coLine = document.querySelector<HTMLElement>("#coLine");
if (coLine && fromLink.length >= 2) {
  coLine.hidden = false;
  $("#coField").hidden = true;
  $("#coChange").addEventListener("click", () => {
    coLine.hidden = true;
    $("#coField").hidden = false;
    company.focus();
  });
}
for (const el of all("[data-if-link]")) el.hidden = !fromLink;
for (const el of all("[data-if-no-link]")) el.hidden = !!fromLink;

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
// on the cold email page the bar hides while its own button shows; elsewhere, while the hero or the closing block does
const hiders = all("[data-hides-sticky]");
for (const el of hiders.length ? [...hiders, ...all("#final")] : all("#hero, #final")) watch.observe(el);

/* ------------------------------ the film: it plays where it is, while he can see it ------------------------------ */

/** Sets the film going. Called below through a catch: the film is the page's feature, but the money calculator and
 * everything after it are the page's own, so nothing a browser makes of the film may stop them. */
function filmOn(film: HTMLElement) {
  const fs = $("#filmFs");
  const pp = $<HTMLButtonElement>("#filmPP");
  type Video = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitRequestFullscreen?: () => Promise<void> | void; webkitDisplayingFullscreen?: boolean };
  const v = film.querySelector("video") as Video;
  const at = v.dataset.film!;
  // muted in the markup too: an iPhone plays a film on its own, in place, only when it's muted
  v.muted = true;
  /**
   * The square cut (close on what acts, so its words read): a phone held upright, and a tablet or window up to 900 px
   * that's taller than a phone on its side (at 768 the wide film's words are 8 px). A phone on its side gets the wide
   * film, as tall as his screen allows, and full screen. The same rule as trade.css's square box: change one, change
   * the other.
   */
  const phone = matchMedia("(max-width: 599px), (max-width: 899px) and (min-height: 500px)");
  /** The square; else the 1920 film where the box has the pixels for it (a laptop at 2x), the 1280 one where it doesn't. */
  const cutFor = () => (phone.matches ? "-phone" : v.getBoundingClientRect().width * (devicePixelRatio || 1) > 1300 ? "" : "-1280");
  /** Reduced motion, or a phone saving data: it doesn't start on its own, and nothing but its picture loads until he plays it. */
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches || !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  /** The cut it shows: none until he's near it. */
  let cut: string | undefined;
  /** He paused it (its button, a tap on the film, or the browser's own player in full screen): it stays paused, whatever the scrolling does. */
  let held = false;
  /** Enough of it on his screen to be worth playing (a quarter): off screen it rests, and costs no battery. */
  let seen = false;
  /** Any of it on his screen: his play plays it there, but not off his screen, where it waits until it's back. */
  let shown = false;
  /** Where a new cut picks up (a phone turned on its side mid-film), once it knows its length. */
  let from = 0;
  /** It can't play here (its file won't load, or won't decode): its strong still stays, with nothing to press. */
  let broken = false;
  const waits = () => pp.classList.contains("film-wait");
  /** In full screen the browser's own player is his, and the page leaves the film to it. */
  const full = () => document.fullscreenElement === v || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement === v || !!v.webkitDisplayingFullscreen;
  const picture = (name: "start" | "poster") => {
    if (cut === undefined) return;
    const src = `${at}${name}${cut}.jpg`;
    if (v.getAttribute("poster") !== src) v.poster = src;
  };
  /**
   * The one big play in the middle, on the film's strong still: waiting for him (reduced motion, Save-Data, or a
   * browser that won't start it on its own). It says what it does then, "Play the film", not a pressed "Pause";
   * playing, it's the pause toggle again, and the picture is the film's first frame, so it starts where it leaves off.
   */
  const waiting = (on: boolean) => {
    pp.classList.toggle("film-wait", on);
    pp.setAttribute("aria-label", on ? "Play the film" : "Pause the film");
    if (on) pp.removeAttribute("aria-pressed");
    else pp.setAttribute("aria-pressed", String(held));
    picture(on ? "poster" : "start");
  };
  const load = () => {
    v.preload = "auto";
    v.src = `${at}film${cut}.mp4`;
  };
  /** It won't play here: its strong still, and no button that does nothing. */
  const fail = () => {
    broken = true;
    picture("poster");
    pp.hidden = fs.hidden = true;
    v.style.cursor = "auto";
  };
  const play = () => {
    v.play().then(
      () => waiting(false),
      // only a real refusal (an iPhone in Low Power Mode) waits for him; a pause or a new cut before it started (AbortError) is no refusal
      (e: DOMException) => {
        if (e?.name === "NotAllowedError") waiting(true);
        else if (e?.name === "NotSupportedError") fail();
      },
    );
  };
  /** Play while it's on his screen and he hasn't paused it; otherwise rest. */
  const settle = () => {
    if (broken || full()) return;
    if (cut !== undefined && seen && !held && !waits()) {
      if (v.paused) play();
    } else if (!v.paused) v.pause();
  };

  // about a screen away (or his first press, if that comes sooner): the cut for his screen and its picture. Nothing of
  // it loads before, so a page he never scrolls near the film never loads it
  const arrive = () => {
    if (cut !== undefined) return;
    near.disconnect();
    cut = cutFor();
    waiting(still);
    if (!still) load();
    settle();
  };
  const near = new IntersectionObserver(([e]) => e?.isIntersecting && arrive(), { rootMargin: "75% 0px" });
  near.observe(v);
  new IntersectionObserver(
    ([e]) => {
      shown = !!e?.isIntersecting;
      seen = shown && e!.intersectionRatio >= 0.25;
      settle();
    },
    { threshold: [0, 0.25, 0.5] },
  ).observe(v);
  // the bar at the bottom of a phone steps aside while the film is on his screen
  watch.observe(v);
  // its pause is there from the start, so a keyboard comes to it before the film's "Full screen"
  pp.hidden = false;
  waiting(still);

  /** His press: "Pause" pauses and holds it paused, pressed again it plays; waiting for his play, it's that. */
  const toggle = () => {
    if (broken) return;
    arrive();
    if (waits()) {
      held = false;
      waiting(false);
      if (!v.getAttribute("src")) load();
      play();
      return;
    }
    held = !held;
    pp.setAttribute("aria-pressed", String(held));
    if (held) v.pause();
    else if (shown) play();
  };
  pp.addEventListener("click", toggle);
  // in full screen a tap is the browser's own player's
  v.addEventListener("click", () => full() || toggle());
  // the browser's own player pauses it or plays it in full screen: that's his choice too, kept when he's back on the page
  for (const type of ["pause", "play"])
    v.addEventListener(type, () => {
      if (!full() || waits()) return;
      held = v.paused;
      pp.setAttribute("aria-pressed", String(held));
    });
  const back = () => {
    if (full()) return;
    pp.setAttribute("aria-pressed", String(held));
    settle();
  };
  document.addEventListener("fullscreenchange", back);
  document.addEventListener("webkitfullscreenchange", back);
  v.addEventListener("webkitendfullscreen", back);
  v.addEventListener("error", fail);

  // a phone turned on its side, or back: the box changes shape (trade.css), and the film takes the cut for it, at the
  // same moment, playing or paused as it was
  phone.addEventListener("change", () => {
    const next = cutFor();
    if (cut === undefined || next === cut) return;
    const playing = !v.paused;
    cut = next;
    picture(waits() || broken ? "poster" : "start");
    if (!v.getAttribute("src") || broken) return;
    // turned back before the new cut knew its length: it still picks up where the first one was
    if (v.readyState) from = v.currentTime;
    load();
    if (playing) play();
  });
  v.addEventListener("loadedmetadata", () => {
    if (from) v.currentTime = from;
    from = 0;
  });

  // full screen where it's bigger than the page (trade.css hides it for the square cut, already its screen's shape)
  fs.hidden = !(v.requestFullscreen || v.webkitRequestFullscreen || v.webkitEnterFullscreen);
  fs.addEventListener("click", async () => {
    // waiting for his play: this is his play
    if (waits()) toggle();
    // before its size is known, an iPad's full screen can refuse: wait for it (a moment at most), then go
    if (v.readyState < 1) await new Promise((r) => (v.addEventListener("loadedmetadata", r, { once: true }), setTimeout(r, 1200)));
    try {
      if (v.requestFullscreen) await v.requestFullscreen();
      else if (v.webkitRequestFullscreen) await v.webkitRequestFullscreen();
      else v.webkitEnterFullscreen?.();
    } catch {
      try {
        v.webkitEnterFullscreen?.();
      } catch {
        // not allowed: it plays on the page as it was
      }
    }
  });
}
const film = document.querySelector<HTMLElement>("#film");
if (film) {
  try {
    filmOn(film);
  } catch (e) {
    // no picture to show yet: no film, rather than an empty box where it was
    film.hidden = true;
    console.error(e);
  }
}

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
  // and his average job (unless the slider is a regular's year); the slider keeps either within its range
  const q = numberFromQuery(location.search, "q");
  const j = numberFromQuery(location.search, "j");
  const estimate = document.querySelector<HTMLElement>("#estNote");
  if (q && estimate) {
    count.value = String(q);
    estimate.hidden = false;
    mine(count);
  }
  if (j && d.perYear === undefined) {
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
