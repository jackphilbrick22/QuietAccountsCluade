# Quiet Accounts — build status

Updated every loop iteration. Newest first.

## 2026-09-30 — iteration 3

**Published (private links)**
- Call card for Jack (the 15-minute sales call, his numbers in, the script filled in):
  https://claude.ai/artifact/ScU3nCP4u2RV6oVzJzNb3b

**Done and green** (engine 829 tests, server 219, web + site typecheck clean)
- One-tap start: the free round's first plan waits for the owner. The welcome text shows their quiet
  rate and the first note word for word; OK (or "looks good", "send it") starts it, anything else is a
  change request for the operator and nothing goes out.
- Sign-up from the site (`POST /start`): company, first name, cell, consent and the file they already
  read in their browser; the account is made, the file read, and a "New sign-up" alert plus a "ready"
  item land in the operator's queue. Nothing is sent until the operator adds the mailing address and
  plans. Planning now refuses without a postal address (every note carries it).
- New requests by email for every shop: a `requests+<token>@` address per client. Forwarded website
  forms, Angi / Thumbtack / Google / Yelp alerts and homeowners' own emails are read (rules, then Claude
  only when the rules can't, keeping only contact details that are in the email word for word), added
  to the records and answered from the office on the always-on track. Unreadable ones go to a person.
- Honest money: the quiet month counts only people we followed up with; answers to someone's own new
  request never open a ledger record or count as a comeback; one quiet-rate definition (two years,
  14+ days old) shared by the site, the welcome text and the Friday report.
- Owner texts: SKIP + a name (off every list, asks when a name fits several); CANCEL in one text with
  UNDO for a day (ROSCA's simple way to stop); leaving a yearly plan early costs no more than monthly
  would have, nor more than the jobs on the ledger in those months, and the rest is refunded (the
  refund text goes to the operator to issue).
- Claims library corrected from the loss research (ServiceTitan's 71% is referrals, not repeat jobs)
  and extended with sourced lead-cost, Angi, Housecall Pro, Jobber homebuyer, Yelp and Google lines;
  four more myths banned.

**Decisions (why)**
- Loss framing uses the owner's own file, never an industry "X% of quotes go quiet": no such figure
  exists. Outside numbers appear only with their source beside them.
- The site says "answered from your office, 7am to 8pm", not "in minutes", until the ledger measures it.
- The sign-up keeps a person in the loop before the first text: it stops a spammer's number getting
  texted, and Jack reads the first note before the owner does.

**In flight**
- Site v3 agent: the judged copy deck (loss-first), the audit pieces (guess chips, lead cost, "how many
  would you take back", price against his number), the five named parts, one-tap Start with the file.
- Trade-complaints research (tree, fence, painting, cleaning owners on their software): final critic pass.

**Next**
- Merge site v3, republish the site; name the parts in console and texts; adversarial re-review of
  everything since iteration 2; the plain-language breakdown and the Blueprint republish.

## 2026-09-30 — iteration 2

**Published (private links)**
- Site with the in-browser Quote Audit: https://claude.ai/artifact/SwTYKddjdyLiStT5EuJk7P (source `apps/site`).
- Breakage & Offer Blueprint v2: https://claude.ai/artifact/FfgLR9w8XWTJU3MYr3tfcj (copy in `docs/blueprint.html`).
- Research: `docs/research/market-brief.md`, `docs/research/conversion-brief.md`.

**Done and green** (engine 724 tests, server 99, web + site typecheck clean)
- Jobber listing kept: 3 notes max per quote (fresh-quote follow-up cut to 3), quotes >= $10k and
  phone-only people go to the owner's call list (kickoff text + console), Jobber read-only on clients
  and quotes by default (`JOBBER_READ`), write-back off unless `JOBBER_WRITE_NOTES=on`; a resource
  Jobber refuses is skipped with a warning, never a failed sync.
- Site (`apps/site`): drop a quotes export, the real engine runs in a worker in the browser and shows
  quotes never answered, the monthly leak, the call list and the first note already written. Tree,
  fence, painting, cleaning versions; one plan; guarantee said three times; results labelled
  owner-reported.
- Offer v2: yearly plan ($4,970 = 12 for 10), quiet months refund a twelfth automatically, never
  renews by itself (asked 30 days out; paused at year end without a yes), RENEW / MONTHLY by text,
  offered at the close only when the owner's own numbers make it an easy yes.
- Forecasts on evidence: research-brief priors (old quotes 2.5%, matching our 4 of 150) with per-type
  ranges; backlog vs ongoing split; fit tiers A / B / audit-only replace the old 15% rule; complaint
  brake at 0.1%; one shop's comparison group never "solid".
- Review fixes (engine): service-due notes use the date the work was done; the guarantee is never
  judged on the first payment day and cancelled accounts get no billing texts; one credit per job;
  top-ups count what's already scheduled.

**Decisions (why)**
- The instant result sells: an owner sees their own quiet-quote dollars in ten seconds before any
  signup (Explee pattern, without its fake counters or card-first trial).
- "15–20%" is never a blanket promise: only Tier A shops see a year-one range with the backlog share.
- AI drafts and sorts; the only automatic send is a fixed acknowledgment. A person approves anything
  about price, dates or scope, so "a person reads every reply" stays true.

**In flight**
- Backend hardening agent: Instantly reply recipient check, a real instant campaign for new requests,
  per-company cap off, reply backstop poller, libphonenumber, CSV encoding, reply cleaning, weekdays.
- Copy-fix agent: 11 confirmed copy findings (oak-wilt season asks, greetings, free-look, lapsed
  regulars, never-priced requests, owner-text originals, grammar, Re: threading, AI writer guardrail).

**Next**
- Server review fixes: route replies by thread (two clients sharing a homeowner), Instantly pause /
  cancel / BUSY / delete, send-state and bounce handling, owner-text parsing, security defaults.
- Re-review, then the plain-language breakdown and the ultimate offer for Jack.

## 2026-09-29 — iteration 1

**Done and green**
- Engine (`packages/engine`): ingest (Jobber/HCP/ServiceTitan/QuickBooks/any CSV), 12 breakage detectors,
  11 suppressions, scoring, forecast + fit check, 20 trade playbooks, note library + quality gate,
  cadence planner, reply reader (inbox), ledger/attribution with holdout lift, owner reports, runtime agents,
  simulator, sample generator. 405 tests pass; `tsc` clean.
- Server (`apps/server`): SQLite store, API, worker, webhooks (Instantly, inbound email, owner SMS, Jobber),
  Jobber OAuth + GraphQL sync + note write-back, Instantly sequencer, Claude agents (reply second opinion,
  first-note writer, column mapping). 68 tests pass incl. the full end-to-end loop; `tsc` clean.
- Dashboard (`apps/web`): owner view (Home, Unibox, Opportunities, Sequence, Recovered, Settings),
  operator console, onboarding. Builds; checked in a browser at 1280px and 390px.

**Decisions this iteration (why)**
- Tree service is the flagship trade; every trade runs on the same engine via its playbook. Tree has the most
  dead quotes per shop (~39% of estimates never convert), a low close rate on blind leads, hazard work that
  truly gets worse, and a winter slow season. Ticket size is *not* the reason — big quotes are down-weighted.
- The free round of 150 is ranked by likelihood to reply (the trial's job is proof), capped at 40% per leak so
  the owner sees wins from several leaks, dead quotes included. Paying accounts rank by expected dollars.
- "Big ticket" is relative to each shop's own typical job (4x median), never a national number.
- Quotes older than 180 days never repeat the old price; the note offers a fresh look and the owner's hand-off
  says to re-price.
- Oak pruning is never offered April–October (oak wilt); ash-borer treatment timed to May/early June.
- House-wash re-service moved from 12 to 36 months (owners report 3–10 years); aerobic septic on a 12-month clock.
- Every human reply gets a Claude second opinion (rules are ~83% right on unseen mail); a stop always stands and
  a possible "yes" is never dropped.
- Instantly: one workspace serves many businesses, so `skip_if_in_workspace` is off.
- Claims library: 10 sourced claims; 12 banned stats, now enforced by the note linter.

**Also this iteration**
- Shop profile (`breakage/profile.ts`): each shop's own ticket size, volume and repeat work set its strategy —
  small-ticket repeat shops lead with likeliest yeses; big-ticket one-off shops lead with expected dollars and
  get AI-drafted first notes on every quote. No per-trade configuration.
- Readiness (`breakage/readiness.ts`): the operator's "ask the owner for this next" list — which export is
  missing, what it unlocks, and the exact menu path in their software. In every client overview.
- Forecast honesty: unpaid invoices are cash to collect, not revenue lift, so they're out of the lift.
  Careful year-one lift on a ~50%-close shop: 15–19% across tree/septic/lawn/fence/pressure washing.
- Tree sample prices rebased on HomeAdvisor/Fixr (typical job ~$875).
- Worker 20x faster: saves skip unchanged records (idle tick 107ms → 6ms; 23 sends 1.24s → 60ms).
- Jobber write-back: replies and bookings leave a note on the quote in Jobber; rotated tokens always saved.

**Also (owner-voice + compliance research)**
- Easy "reply pass" in first notes; loss reasons ("5 went with someone else, 3 price") in the Friday text.
- Don't-chase holds: "go away" prices and realtor/HOA/insurance bids wait for an OK; bad-customer tags never contacted.
- Silent Quote Audit: won vs said no vs never answered, by age — the problem owners don't know they have.
- Booked-out mode: owner texts BUSY until <date> / OPEN; new work lands when there's room.
- Honest why-line on every commercial note (CAN-SPAM); no fake "Re:" on first notes.
- Address risk (typos, placeholders, throwaways, role inboxes last) + DNS check before sending.
- Brakes: pause at 3% bounces, 0.2% complaints, or 1% "who is this?".
- Instant answer to hot replies in the homeowner's thread ("Dave will call you Monday"), 7am–8pm local,
  never promising a price or a date; the owner's hand-off says what was promised.

**Also (offer research → product)**
- Recovered Ledger with published counting rules (traced 180 days / "came back after our note" 90 days,
  never counted), CSV + owner link, "not ours" disputes; guarantee evidence automatic; fees-vs-traced
  multiple in the weekly text; cancel by text; "15–20%" only when the shop's careful forecast reaches 15%;
  marketing copy checker.
- Unpaid invoices: detected for the owner's "cash to collect" only — never messaged (debt-collection law
  review pending from the research gap-fill).
- Live operator console on the real server; demo mode kept for sales calls.
- Test suite: engine 698, server 92.

**Next**
- Adversarial review (5 lenses + verifiers) running → fix confirmed findings.
- Research gap-fills + synthesis → Breakage & Offer Blueprint (publish) → final plain-language breakdown.
- Staggered holdout (held people start ~60 days late instead of never) so no owner permanently loses quotes.
- Sample catalogs for the other 14 trades + recurring visits for route trades (demo realism).
- Research synthesis → Breakage & Offer Blueprint (judge-panel the offer framing).
- Engine test suites for breakage/cadence/copy/ledger/reports/runtime + a 10k-row performance test.
- Worker tick speed (≈0.75s per business per tick in the e2e test).
- Adversarial review + fix passes; publish blueprint and demo.
