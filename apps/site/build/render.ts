import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { claim } from "@qa/engine";
import { JACK, NETLIFY_FIELDS } from "../src/form.ts";
import { fillIn, MINE } from "../src/note.ts";
import { sums, whole as n } from "../src/calc.ts";
import { LABEL, MONTHLY, ONE_PASS, PAGES, VIEWS, viewPage, type Offer, type Proof, type SitePage, type Slider, type Software } from "../src/trades.ts";
import { exampleHandoff, exampleNote, SLOTS } from "./examples.ts";

/**
 * Fills each page's <!--qa:name--> markers at build time (and in dev), from src/trades.ts, the engine's claims and
 * the engine's own words. The shared pieces live here once (the form, the button, the labels, the footer), so a new
 * page is its HTML and an entry in PAGES. An unknown marker fails the build.
 */
export const ADDRESS = "9 Carter St, Concord, NH 03301";
export const CALL = "https://calendly.com/jackphilbrick/quick-question-15-min";
export const IMPORT_EMAIL = "quotes@quietaccounts.com";
/** The privacy and terms pages the live site already serves (privacy.html, terms.html): the consent box mentions texts. */
export const POLICIES = [
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
] as const;
/** Signs the example note until he types his own first name. */
export const EXAMPLE_SIGNER = "Sarah";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const usd = (x: number) => `$${n(x)}`;
const k = (x: number) => `$${Math.round(x / 100) / 10}k`;
const arrow = `<span class="arr" aria-hidden="true">&rarr;</span>`;
const SOFTWARE: [Software, string][] = [
  ["jobber", "Jobber"],
  ["housecall_pro", "Housecall Pro"],
  ["other", "Something else"],
];

/** The page a path builds: a trade's page, or one of the violet views (main-site, cold-email-page). */
export function pageFor(path: string): SitePage | undefined {
  const at = (id: string) => path === `/${id}/index.html` || path === `/${id}/`;
  const view = VIEWS.find((v) => at(v.id));
  return view ? viewPage(view) : PAGES.find((p) => at(p.id));
}

export function sitePages(): Plugin {
  return {
    name: "qa-site-pages",
    transformIndexHtml: { order: "pre", handler: (html, ctx) => renderPage(html, pageFor(ctx.path)) },
    // in dev, /lawn is /lawn/index.html, as Netlify serves it
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query = ""] = (req.url ?? "").split("?");
        if ([...PAGES, ...VIEWS].some((p) => path === `/${p.id}`)) req.url = `${path}/${query ? `?${query}` : ""}`;
        next();
      });
    },
  };
}

export function renderPage(html: string, page?: SitePage): string {
  return html.replace(/<!--qa:([\w:-]+)-->/g, (_m, key: string) => fragment(key, page));
}

function fragment(key: string, page?: SitePage): string {
  const [name, arg] = key.split(":") as [string, string | undefined];
  if (name === "claim" || name === "source") {
    const c = claim(arg ?? "");
    if (!c) throw new Error(`No claim "${arg}" in packages/engine/src/claims.ts`);
    return esc(name === "claim" ? c.text : c.source);
  }
  // a result in the page's own words: the label
  if (key === "label") return esc(LABEL);
  if (name === "footer") return footer();
  if (name === "card") return card(arg as Offer);
  if (!page) throw new Error(`<!--qa:${key}--> needs a page in PAGES`);
  switch (name) {
    case "form":
      return form(page, arg === "open");
    case "cta":
      return cta(page);
    case "sticky":
      return sticky(page);
    case "tally":
      return tally(page.proofs[0]!);
    case "results":
      return page.proofs.map(result).join("\n");
    case "ranges":
      return ranges(page.proofs);
    case "calc":
      return calc(page);
    case "note":
      return note(page);
    case "handoff":
      return handoff(page);
    case "works":
      return works(page, arg === "chips");
    case "film":
      return film(page);
  }
  throw new Error(`Unknown marker <!--qa:${key}-->`);
}

/** The one button and the price line beside it. Every one on a page leads back to the form. */
function cta(p: SitePage, full = false): string {
  return `<div class="cta${full ? " full" : ""}"><a class="btn" href="#start">${esc(p.words.button)} ${arrow}</a><span class="price-line">${esc(p.words.priceLine)}</span></div>`;
}

function sticky(p: SitePage): string {
  const [line, small] = p.words.sticky;
  return `<div class="sticky" id="sticky" aria-hidden="true"><span>${esc(line)}<small>${esc(small)}</small></span><a class="btn" href="#start" tabindex="-1">${esc(p.words.button)} ${arrow}</a></div>`;
}

const labelLine = `<p class="label">${esc(LABEL)}</p>`;
const jobsText = (x: Proof) => `${usd(x.value)}${x.over ? "+" : ""}`;

function tally(x: Proof): string {
  return `<figure class="tally"><figcaption>${esc(x.shop)}, ${esc(x.where)} &middot; ${x.otherTrade ? esc(x.otherTrade) : `first ${x.asked}`}</figcaption><div class="tally-row"><div><b>${x.asked}</b><span>asked</span></div><div><b>${x.wroteBack}</b><span>wrote back</span></div><div><b>${x.booked}</b><span>booked</span></div><div class="hot"><b>${k(x.value)}${x.over ? "+" : ""}</b><span>in jobs</span></div></div>${labelLine}</figure>`;
}

function result(x: Proof): string {
  const s = x.shot;
  return `<article class="card"><h3>${esc(x.shop)}</h3><p class="meta">${esc(x.where)} &middot; ${esc(x.otherTrade ?? x.list)}</p><p class="money">${jobsText(x)}<small>in jobs</small></p><div class="mini"><span><b>${x.asked}</b> asked</span><span><b>${x.wroteBack}</b> wrote back</span><span><b>${x.booked}</b> booked</span></div><p class="note">${esc(x.note)}</p>${labelLine}<figure class="shot"><img src="/src/assets/${s.file}" width="${s.width}" height="${s.height}" loading="lazy" alt="${esc(s.alt)}"><figcaption>${esc(s.by)}</figcaption></figure></article>`;
}

/** What the first 150 got the shops, as ranges, labeled. */
function ranges(proofs: Proof[]): string {
  const span = (f: (x: Proof) => number, show: (v: number) => string) => {
    const v = proofs.map(f);
    return `${show(Math.min(...v))}&ndash;${show(Math.max(...v))}`;
  };
  return `<div class="expect"><p>What the first 150 got ${["one", "two", "three"][proofs.length - 1] ?? proofs.length} shops</p><div class="expect-row"><span><b>${span((x) => x.wroteBack, String)}</b>wrote back</span><span><b>${span((x) => x.booked, String)}</b>booked</span><span><b>${span((x) => x.value, k)}</b>in jobs</span></div>${labelLine}</div>`;
}

/** A slider whose starting number is an example, and says so until he slides it (or a link sets it). */
function slider(id: string, out: string, s: Slider): string {
  return `<div class="slider"><label for="${id}"><span>${esc(s.label)}</span><span class="val"><output id="${out}" for="${id}">${s.money ? usd(s.value) : n(s.value)}</output><small class="eg" id="${id}Eg">Example</small></span></label><input type="range" id="${id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}"></div>`;
}

/**
 * The money: his count times his average job, at the lead shop's own rate; on a one pass, also what he'd pay for
 * those jobs, with his past customers on top. Works out the defaults for no-JS. A ?q= link's count is an estimate, and
 * the line saying so waits hidden for it. A link's ?j=, his average job, never sets a slider that's a regular's year.
 */
function calc(p: SitePage): string {
  const lead = p.proofs[0]!;
  const c = p.calc;
  const pay = p.words.pay;
  const m = sums(c.count.value, c.job.value, lead, pay);
  const data = `data-booked="${lead.booked}" data-asked="${lead.asked}"${pay ? ` data-each="${pay.each}" data-cap="${pay.cap}"` : ""}${c.perYear ? " data-per-year" : ""}`;
  const paid = pay ? `<p class="pay">You'd pay <b id="rPay">${usd(m.pay!)}</b>, that's <b id="rShare">${m.share}</b> of it.</p>` : "";
  const estimate = c.estimate ? `<p class="fine" id="estNote" hidden>${esc(c.estimate)}</p>` : "";
  const counts = c.result ?? { jobs: "jobs booked", value: `left on the table${pay ? ", plus your past customers" : ""}` };
  return `<div class="calc" id="calc" ${data}>${slider("cN", "oN", c.count)}${slider("cJ", "oJ", c.job)}<div class="calc-out" aria-live="polite"><p class="rate">${esc(c.rateLine)}</p><div class="big"><div><b>${m.rate}</b><span>${esc(c.rateLabel)}</span></div><div><b id="rJobs">${n(m.jobs)}</b><span>${esc(counts.jobs)}</span></div><div class="hot"><b id="rVal">${usd(m.value)}</b><span>${esc(counts.value)}</span></div></div>${paid}<p class="fine">${esc(c.fine)}</p>${estimate}${labelLine}</div>${cta(p, true)}</div>`;
}

/**
 * The first note, as the engine writes it: shown filled in for the page's example company, with the engine's
 * {company} and {signer} version beside it for the page to fill in as he types.
 */
function note(p: SitePage): string {
  const shown = exampleNote(p.trade, p.companyExample, EXAMPLE_SIGNER);
  const open = exampleNote(p.trade, SLOTS.company, SLOTS.signer);
  return `<div class="ex ex-note"><div class="nh"><span>Note 1 &middot; Example</span><span>from your office</span></div><div class="nb" data-template="${esc(open.main)}">${esc(shown.main)}</div><div class="nf" data-template="${esc(open.foot)}">${esc(shown.foot)}</div></div>`;
}

/** The text the owner gets when someone wants the work, as the engine writes it. */
function handoff(p: SitePage): string {
  return `<div class="ex qw-feed"><p class="qw-day">Example &middot; a text to you</p><div class="sms"><small>Quiet Accounts &middot; 9:12 AM</small><p>${esc(exampleHandoff(p.trade))}</p></div></div>`;
}

/**
 * The page's one form. The hero shows only the company and the button; the first press opens his note and the text
 * he'd get, and sends nothing (a ?co= link opens them on load). The same button then sends the rest. Once the note
 * shows, a button that leads on to the rest sits where the first one was, so one stays on his first screen at 390px.
 * A static copy named "start" lets Netlify Forms find the fields when there's no server.
 *
 * `open` (the cold email page): his email already showed him the note, so every field shows from the start and the
 * first press sends. A ?co= link shows his company as a line he can change, and the note waits one tap away.
 */
function form(p: SitePage, open = false): string {
  const w = p.words;
  const consent = (company: string) => esc(fillIn(w.consent, company, ""));
  const picker = SOFTWARE.map(([id, name], i) => `<button type="button" class="sw sw-${id}${i ? "" : " on"}" data-sw="${id}" role="radio" aria-checked="${i ? "false" : "true"}"><b>${name}</b><small>${esc(w.picker[id])}</small></button>`).join("");
  const steps = SOFTWARE.map(([id], i) => `<p data-step="${id}"${i ? " hidden" : ""}>${p.exportStep[id]}</p>`).join("");
  const co = esc(p.companyExample);
  const sig = (where: string) => `<p class="rv-sig" id="sigHint">Signed ${EXAMPLE_SIGNER}, an example name, until you type yours ${where}.</p>`;
  const shown = open
    ? ""
    : `
    ${cta(p, true)}
    <p class="rv-h" id="revealH" tabindex="-1">Your first note, from <span data-company>${co}</span></p>
    ${note(p)}
    ${sig("below")}
    <p class="rv-h">The text you get when someone wants the work</p>
    ${handoff(p)}`;
  const line = open ? `\n  <div class="co-line" id="coLine" hidden><span class="co-k">Your company</span><b data-company>${co}</b><button type="button" class="co-change" id="coChange" aria-controls="coField">Change</button></div>` : "";
  const peek = open ? `\n  <details class="peek"><summary><span>See your first note, with <span data-company>${co}</span> on it</span></summary>${note(p)}${sig("above")}</details>` : "";
  return `<div class="fcard${open ? " open" : ""}" id="start">
<form id="form" data-page="${esc(p.id)}" data-trade="${esc(p.trade)}" data-offer="${w.offer}" data-signer="${EXAMPLE_SIGNER}"${open ? " data-open" : ""} autocomplete="on" novalidate>${line}
  <div class="field"${open ? ' id="coField"' : ""}><label for="company">Your company name</label><input id="company" name="company" autocomplete="organization" maxlength="120" required placeholder="${co}"></div>
  <div class="reveal" id="reveal"${open ? "" : " hidden"}>${shown}
    <div class="fgrid">
      <div class="field"><label for="first">Your first name</label><input id="first" name="first" autocomplete="given-name" maxlength="60" required placeholder="Dave"></div>
      <div class="field"><label for="cell">Your cell <small>(the yeses come here)</small></label><input id="cell" name="cell" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="40" required placeholder="555-555-0100"></div>
      <div class="field"><span class="swlbl" id="swLbl">Where your jobs live</span><div class="swpick" role="radiogroup" aria-labelledby="swLbl">${picker}</div><input type="hidden" id="software" name="software" value="jobber"></div>
      <label class="consent"><input type="checkbox" id="consent" name="consent" required><span data-template="${consent(SLOTS.company)}">${consent(open ? MINE : p.companyExample)}</span></label>
    </div>
  </div>
  <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  <div class="cta full"${open ? " data-hides-sticky" : ""}><button class="btn" type="submit" id="submit">${esc(w.button)} ${arrow}</button><span class="price-line">${esc(w.priceLine)}</span></div>
  <p class="err" id="formErr" role="alert" hidden>That didn't go through. <a id="smsJack" href="sms:${JACK.tel}">Text Jack at ${JACK.text}.</a></p>
  <p class="fine2">Nothing goes to your customers until you OK the first note.</p>${peek}
</form>
<div class="done" id="done" tabindex="-1" hidden>
  <h3 id="doneH">Got it. One thing left.</h3>
  <p class="lead">${esc(w.sendUs)}</p>
  <div class="dstep"><span class="n">1</span><div>${steps}</div></div>
  <div class="dstep"><span class="n">2</span><p>${esc(w.forward)}<br><span class="drop">${IMPORT_EMAIL}</span></p></div>
  ${fileDrop(p)}
  <div class="dstep"><span class="n">3</span><div><p>You'll get a text from <b>Jack</b> within one business day with the first note to read. Change anything you want and text OK. The first notes go out the next weekday morning.</p>${p.ask ? `<p class="pace">${esc(p.ask)}</p>` : ""}</div></div>
</div>
</div>
<form name="start" data-netlify="true" netlify-honeypot="website" hidden>${NETLIFY_FIELDS.map((f) => `<input name="${f}">`).join("")}</form>`;
}

/**
 * The other way to send the file, in the step after the form: he drops it (or picks it, on a phone) and the audit
 * reads it on his screen, in a worker that loads only then. The result shows right here (page.ts fills it in): on a
 * one-pass page the quotes nobody answered, and on every page the past customers who haven't booked since, with the
 * first note to one of them. Nothing leaves until he presses send, and that needs a server; without one he forwards
 * the email as usual. A one-pass page asks for two exports: a send with only one of them says which is still to come.
 */
function fileDrop(p: SitePage): string {
  const quotes = p.words.offer === "one_pass" ? (p.quotes ?? "quotes") : undefined;
  const none = quotes
    ? `We couldn't find ${quotes} nobody answered or past customers to write to in that file. It needs your ${quotes} or your past jobs, with dates and your customers' emails, like Jobber's Quotes report or its Visits report.`
    : "We couldn't find past customers to write to in that file. It needs your visits or jobs, with dates and your clients' emails, like Jobber's Visits report.";
  const quoteResult = quotes
    ? `<div class="dz-r" id="rQuotes" hidden><p class="dz-h"><span id="rqValue"></span> is sitting in <span id="rqCount"></span> nobody answered.</p><p class="dz-s" id="rqRange"></p><p class="dz-k">When they were sent</p><div class="dz-rows" id="rqAges"></div></div>`
    : "";
  const email = quotes ? "the emails" : "the email";
  // page.ts shows the one that names what his sends haven't brought yet
  const need = quotes
    ? `<p class="dz-ok" data-need="past" role="status" hidden>Your ${quotes} are in. For your past customers, drop your visits or jobs export here too, or forward it as above.</p>
      <p class="dz-ok" data-need="quotes" role="status" hidden>Your past customers are in. For your ${quotes} nobody answered, drop your ${quotes} export here too, or forward it as above.</p>`
    : "";
  return `<div class="dfile" id="dfile"${quotes ? ` data-quotes="${quotes}"` : ""}>
    <label class="dz" id="dz"><b>Have the file already? Drop it here.</b><span>Or choose it below. It's read right here, on your screen, and goes nowhere until you send it.</span><input type="file" id="dzFile" multiple accept=".csv,.tsv,.txt,text/csv,text/plain"></label>
    <p class="dz-busy" id="dzBusy" role="status" hidden>Reading it on your screen&hellip;</p>
    <p class="err" id="dzErr" role="alert" hidden>That file didn't read. Send the export as your software made it, as a CSV, or forward ${email} as above.</p>
    <div class="dz-out" id="dzOut" hidden>
      <p class="dz-files" id="dzFiles"></p>
      ${quoteResult}
      <div class="dz-r" id="rPast" hidden><p class="dz-h" id="rpHead"></p><p class="dz-s" id="rpPaid"></p><p class="dz-k">When they were last here</p><div class="dz-rows" id="rpWhen"></div></div>
      <p class="dz-s" id="dzNone" hidden>${esc(none)}</p>
      <div class="ex ex-note" id="rNote" hidden><div class="nh"><span id="rnTo"></span><span>from your office</span></div><div class="nb" id="rnBody"></div><div class="nf" id="rnFoot"></div></div>
      <div id="dzSend" hidden><button type="button" class="btn2" id="dzSendB">Send this file</button></div>
      <p class="dz-ok" id="dzSent" role="status" hidden>It's all in, so there's no email to forward. Jack will text you the first note to read.</p>
      ${need}
      <p class="err" id="dzSendErr" role="alert" hidden>That didn't go through. Forward ${email} as above, or <a id="smsFile" href="sms:${JACK.tel}">text Jack at ${JACK.text}</a>.</p>
      <p class="dz-s" id="dzFwd" hidden>To send ${quotes ? "them" : "it"}, forward ${email} as above, as usual.</p>
    </div>
  </div>`;
}

/** The trust footer: the postal address, the text number, and the only place the 15-minute call is offered. */
function footer(): string {
  const policies = POLICIES.map(([href, name]) => `<a href="${href}">${name}</a>`).join(" &middot; ");
  return `<footer class="foot"><div class="wrap"><span>Quiet Accounts &middot; ${ADDRESS} &middot; ${new Date().getFullYear()}</span><span>Text <a href="sms:${JACK.tel}">${JACK.text}</a> &middot; <a href="${CALL}">Rather talk it through? 15 minutes</a></span><span>${policies}</span></div></footer>`;
}

/** "Works from your export": the software the page's FAQ already names, as plain words. `chips`: the list alone, under a heading the page writes. */
function works(p: SitePage, chips = false): string {
  const list = `<ul>${p.works.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`;
  return chips ? `<div class="works chips">${list}</div>` : `<div class="works"><p class="works-k">Works from your export</p>${list}</div>`;
}


/**
 * A film's length in seconds, from its MP4's movie header (moov → mvhd), so the film's spoken label never gives a
 * length the film doesn't have when a new cut lands.
 */
export function filmSeconds(trade: string, name = "film.mp4"): number {
  const file = `public/film/${trade}/${name}`;
  const mp4 = readFileSync(new URL(`../${file}`, import.meta.url));
  const find = (from: number, to: number, type: string) => {
    for (let at = from; at + 8 <= to; ) {
      const head = mp4.readUInt32BE(at);
      const size = head === 1 ? Number(mp4.readBigUInt64BE(at + 8)) : head || to - at;
      if (mp4.toString("latin1", at + 4, at + 8) === type) return [at + 8, at + size] as const;
      if (size < 8) break;
      at += size;
    }
    throw new Error(`No ${type} box in ${file}`);
  };
  const moov = find(0, mp4.length, "moov");
  const [at] = find(moov[0], moov[1], "mvhd");
  const v1 = mp4[at] === 1;
  return (v1 ? Number(mp4.readBigUInt64BE(at + 24)) : mp4.readUInt32BE(at + 16)) / mp4.readUInt32BE(at + (v1 ? 20 : 12));
}

/**
 * The film (Oct 9, 2026): the service running for a made-up company in the page's trade, a feature of the page under
 * the three lines that say what we do. It plays where it is, muted and looping, while he can see it. It costs nothing
 * until he's near it: the video has no src and no poster here; page.ts picks the cut for his screen (the square one
 * on a phone, else the 1280 or 1920 film) and its first frame as the picture until it plays. Nothing under it but full
 * screen: it shows how the service works, so it needs no caption (Jack, Oct 9). Without scripts there's nothing to
 * play: no film at all, not the browser's own empty player.
 */
function film(p: SitePage): string {
  if (!p.film) throw new Error(`<!--qa:film--> needs a film in src/trades.ts for ${p.id}`);
  const { to } = p.film;
  const at = `/film/${p.trade}/`;
  const secs = Math.floor(filmSeconds(p.trade));
  const play = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.6-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/></svg>`;
  const pause = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect fill="currentColor" x="6.5" y="5" width="4" height="14" rx="1.2"/><rect fill="currentColor" x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>`;
  const expand = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
  const label = `A ${secs}-second film, no sound: we write, in the owner's name, to ${to}, read every reply, and text the owner when one wants the work.`;
  return `<noscript><style>#film{display:none}</style></noscript>
<div class="film" id="film">
  <figure><div class="film-v"><video muted loop playsinline preload="none" width="1920" height="894" data-film="${at}" aria-label="${esc(label)}"></video><button type="button" class="film-pp" id="filmPP" aria-pressed="false" aria-label="Pause the film" hidden><span class="film-pp-i">${pause}${play}</span></button></div></figure>
  <div class="film-more"><button type="button" class="film-fs" id="filmFs" hidden>${expand}Full screen</button></div>
</div>`;
}

/** A front-page card: its offer in one line, and links only to the pages that are built and meant to be found. */
function card(offer: Offer): string {
  const c = (offer === "monthly" ? MONTHLY : ONE_PASS).card;
  const links = PAGES.filter((p) => p.words.offer === offer && !p.unlinked).map((p) => `<a class="go" href="/${p.id}">${esc(p.name)} ${arrow}</a>`);
  return `<article class="offer"><h2>${esc(c.title)}</h2><p>${esc(c.text)}</p>${links.join("")}</article>`;
}
