# Quiet Accounts — build status

Updated every loop iteration. Newest first.

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
