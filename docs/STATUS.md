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

**Later in iteration 3**
- Site v3 merged and republished (same link): the judged loss-first copy, the full audit (guess chips,
  lead cost from his own number only, "how many would you take back" priced at the lower of his guess
  and our shops' rate), the five named parts, one-tap Start that sends his file. Lint clean on all
  four trades; the Friday example shows only the "before" rate.
- Blueprint v3 republished; Call card published.
- Two new trades: holiday / permanent lighting (a yearly rebook clock) and decks (a 24–36 month stain
  clock after a wood build). 20 trades.
- Second adversarial review: 38 findings, 36 confirmed, all fixed and tested. Money windows (quiet
  months belong to the period they end), exact cancel/undo, whole-text OKs, top-ups wait for the OK,
  forwarded requests read from the innermost message only, one answer per person, sign-up can never
  touch a live account, rate limit on the socket peer.
- Research saved in docs/research: owner complaints by trade, loss evidence, the call guide, the site
  v3 copy deck, adjacent industries.

**Deploy notes**
- Behind a load balancer set `TRUSTED_PROXY_HOPS` (e.g. 1), or every sign-up shares one rate limit.
- `SIGNUP_ORIGINS`, `INBOUND_DOMAIN`, `SIGNUPS_PER_HOUR` (default 30).
- Twilio: remove CANCEL from the Messaging Service opt-out keywords.

- Trade depth from owner research merged: non-Jobber quote statuses read right (Unsigned, Not sent,
  Unscheduled, Not sold...), a full painting playbook (repaint clocks, exterior in late winter,
  interiors sold in the fall), cleaning lapses at ~21 days for weekly/biweekly clients, new-request
  answers ask each trade's intake questions (and skip what the form already says).
- Third adversarial review: 30 reported, 21 confirmed, all fixed: platform-safe UNDO (the cancel's
  withdrawals run first; sequences under way stay stopped and the owner is told), a Restore plan action
  for the operator, pulled notes stop the rest of a sequence, the paid year keeps its guarantee after
  MONTHLY, stricter texts while the first note waits for OK, holiday-lights clocks only in season,
  one-time cleaning asks only to people not on a schedule, recreated ids never get old links.
- Plain-language breakdown for Jack: https://claude.ai/artifact/G2cLRQe3SJt53PWhrMNFZt (a doc he can edit
  and comment on). Engine 1,057 tests, server 242.

- Fourth adversarial review: 13 confirmed (2 duplicates), all fixed and tested. A "yes" to a follow-up
  with no thread is recorded against that note, not a request answer (so it counts for the guarantee
  and the ledger); fees stay right across a mid-year switch to monthly; a renewed year still judges the
  old year's last month after a missed check; Restore plan withdraws only the cancel's own refund text;
  a trial owner texting MONTHLY/YEARLY goes to Jack for the payment link (never "paying" on a text);
  while a first note waits, only a text that reads like an answer to a lead or the close acts on one;
  CANCEL on a sending platform says who UNDO can't bring back; a two-person forward never gets a
  Claude guess; quote statuses where the leading yes/no decides ("Accepted - not booked" is a yes,
  "Not sold yet" is open). Engine 1,085 tests, server 246.

- Fifth adversarial review: 14 reported, 6 confirmed, all fixed and tested. The big one predated it: the
  wait for the owner's OK, the "before we started" quiet rate and what a CANCEL stopped lived only in
  memory, so a deploy lost them (UNDO said "nothing to undo", Restore plan refused, an OK was ignored).
  They're saved with the account now, with a restart test. Also: a reply in the request answer's own
  thread stays with the request (only a no-thread reply with a follow-up sent lately moves to that note),
  and the thread decides between two records sharing an address; while a first note waits, only a bare
  outcome ("no", "done", "booked 2400") or a whole-text yes acts on another lead or plan ("won't" is never
  a win, and a year is never an amount in a note edit); "Sent - not sold - lost to competitor" is a no.
  Engine 1,101 tests, server 247.

- Sixth adversarial review (with a hunt for anything that only lived in memory): 17 reported, 13 confirmed,
  all fixed and tested. A skipped person no longer comes back after a deploy (records are replaced, not
  edited in place); re-planned notes get new ids (two notes with one id stuck, then went out in a burst);
  the reply poll leaves an email it had no lookups left for to the next poll instead of writing it off;
  renewal/kickoff/refund texts always load; replies from two records sharing one address go to the one
  the thread, Instantly's lead variable or the latest note names, a spouse's reply is credited to the
  person we wrote to, and a reply stops every record at that address. Owner texts: "won't book it",
  "hasn't booked yet", "booked someone else" and the iPhone apostrophe never book; note edits that mention
  booked/quoted stay note edits; two businesses both waiting for an OK get "which one?"; a NO after a
  BOOKED takes its dollars back off the ledger. Statuses: one no-vocabulary for every rule, open words on
  either side of "not sold", a leading no or "went with someone else" decides. Engine 1,154, server 252.

- Seventh adversarial review: 15 reported, 13 confirmed, all fixed and tested. Mostly the edges of the last
  round's wider word lists, so the rule now is: a text or status that reads two ways goes to a person or
  keeps its leading answer, never a guess. A booking with a "won't/hasn't" in the same text goes to Jack;
  another company only counts when someone was hired; a booking on the ledger is taken back only by a
  plain NO. Re-booking after a NO never double-counts a job already synced; a skipped person leaves the
  scan's plan list. Instantly replies name the exact note (qa_touch_N), a spouse's reply in someone else's
  thread goes with that note, a reply stops every record at the address on Instantly too, and an
  out-of-office stops nothing. Statuses: a leading yes keeps its yes ("Sold - went w/ black vinyl"),
  revision requests stay open, price reasons after "not sold" are a no, postponements stay open.
  Engine 1,190, server 255.

- Eighth adversarial review: 18 reported, 11 confirmed, all fixed and tested. Two ledger double counts that
  predate this round (a quote approved online and the job it became, landing in different syncs; a quiet
  comeback promoted next to the owner's BOOKED) now fold into one win. The reply poll takes the answered
  note from the email's own campaign, or passes only the person. Owner texts: "she's getting another
  quote" is still our lead; "They found someone else", "went with another roofer", "Someone else already
  did it" are losses. Statuses: an answer after a revision wins ("Requoted - sold"), "Went with ABC Fence"
  is a no unless it starts with a yes, our own lower price is not a no, waiting words after "not sold"
  stay open. New safety net: a status that says two things at once ("Approved - said no to the gate") is
  held for a person instead of being written to on a guess. Engine 1,219, server 256.

- Ninth adversarial review: 15 reported, 7 confirmed (13 → 11 → 7 over the last three passes), all fixed and
  tested. A BOOKED that follows an earlier QUOTED is dated when it booked, so the job in their records
  folds into it instead of counting twice; a quote marked "not ours" stays out when it becomes a job; a
  folded win keeps the day it came back, so no weekly report announces it twice. Owner texts: "went with"
  is a loss only when it names someone else (a capitalized name counts), "went with my quote" is a
  booking, an option or plan we can't place goes to a person, and shopping around ("has another guy
  coming out") stays open. The reply poll takes the campaign from our own note in the thread when the
  reply carries none. Statuses: someone else's lower price is a no however it's written. Engine 1,231,
  server 257.

**Next**
- A tenth review pass; stop when a pass finds nothing material.

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
