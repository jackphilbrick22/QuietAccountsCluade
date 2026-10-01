# Quiet Accounts — build status

Updated every loop iteration. Newest first.

## 2026-10-01 — the two-offer brief (docs/BRIEF.md)

Jack's brief replaces the one big $497 offer with two: monthly for lawn and cleaning (first 150 free, then $497 a
month if the owner says yes; any month nobody asks to come back is free) and a one pass for tree, painting and fence
($250 per booked job, never more than $1,000). Built on top of this branch's later fixes, not reset to 2726e98.
Phase A, then B, then C, one commit per item, `pnpm check` green before each.

- Before the brief work: a third narrow check on the second verification pass found one regression, fixed
  (4f90adb). An owner's "Yes - deposit received" or "Yes - verbal" reads as a yes again, and a queued follow-up stops
  when its quote's status is one a person has to read (the hold only stopped new plans).

- **A1. Switch off what neither offer sells.**
  - New-request answering and the yearly plan sit behind FEATURE_NEW_REQUESTS and FEATURE_YEARLY, both off. Off
    means no always-on track (no answers to new requests, no day-2 fresh-quote follow-up), no requests+ address in
    any API or console response, no instant campaign; an email to a requests address is plain mail in the review
    queue. RENEW, YEARLY and ANNUAL change nothing and go to Jack; the trial's MONTHLY yes still works; no renewal
    ask, no year settle, no year offer at the close. CANCEL is final: no UNDO in its reply, UNDO not honoured (the
    operator's Restore plan has nothing to restore). No "within 5 business days" or "Jack will put everything back
    himself today" reaches an owner.
  - New accounts: autoAck off (a person reads every reply) and holdout 0; migration 4 moved existing accounts once.
  - Forecasts and fit tiers are gone from everything owners and visitors see, and gate nothing.
  - Trade detection (the site audit too), the console's menus and sign-up use only lawn, landscape, cleaning, tree,
    fence and painting; "Standard Cleaning" reads as cleaning. The other 14 playbooks stay in code.
  - Each plan works only the leaks the trade's offer sells, in one engine rule; a person whose first leak isn't sold
    is planned on their next one that is. "People still to work" counts the same people a plan can pick.
  - The console has no Jobber login or sync; Money Map is List, Reply Desk is Replies, Ready Text is Hand-off text.
  - The current site lost its two "7am to 8pm" lines and its part headings are plain words (A7 replaces it).
  - Left: the welcome text still opens with the shop's quiet quotes on lawn and cleaning (A6's wording pass); the
    demo's sample businesses keep a 10% holdout and auto-answers; a few operator hints mention "Yearly".
  - Brief notes: "the always-on track" also drove the day-2 fresh-quote follow-up and shorter detection windows, so
    all of it is behind FEATURE_NEW_REQUESTS; the planner's types filter only saw each person's top leak, so it now
    picks each person's first sold leak (on the 10k tree sample, 8,006 workable people).
  - Engine 1,342, server 311.

- **A2. Read lawn and cleaning exports** (engine only).
  - Jobber's Visits report reads as visits: every visit its own record under its client, the same result
    newest-first or oldest-first, with its date, job number, amount ("Visit based", or the one-off job's share) and
    crew ("Assigned to"). "Visit completed" is Yes/No; a visit not marked done counts as missed only when a later
    visit of the job, or the crew's own marking, has gone past it. A one-off job's visits are one job.
  - A Visits or bookings file is the whole calendar for the days it covers: a re-sent report replaces the earlier
    one's visits for its clients on those days.
  - Bookings exports (Booking ID, Service, Frequency, Booking Date, Price, Status) read as visits, not won quotes.
  - Client lists: "Last Visit", "Last Appointment", "Last Booking Date", "Last Cleaning", "Last Service" are the last
    visit; a frequency column sets the lapse, otherwise the trade's longest quiet spell (45 days for cleaning); lawn
    and landscape lists wait for B2.
  - A recurring job's single row (jobs report or sync) that ended months ago is a lapsed regular.
  - The ledger counts one job's visits as one booking; visits still on the calendar never count.
  - Readiness asks lawn, landscape and cleaning shops for the visits export first, never quotes.
  - Fixtures: a 40-client, 1,640-visit Jobber Visits report (newest-first, oldest-first, and amounts blank) gives 40
    customers with their full history, all 15 lapsed regulars found, 0 of the 25 active flagged; a bookings export
    with the same results; a cleaning client list with "Last Cleaning", with and without a frequency.
  - Left: lawn off-season and in-season values (B2); BookingKoala, Launch27, ZenMaid columns (C2); a crew that marks
    most clients daily but bills a few monthly reads those few's unmarked visits as missed (different "Assigned to"
    names keep them apart); leftover calendar visits of a never-closed job can still count as a comeback or a
    "crew nearby" line; Jobber's longer headers ("Service state/province", "Service ZIP/postal code") map the same
    way but have no test.
  - Brief notes: "Visit completed" is Yes/No, not a date; the 7-7 tie came from "Job #" scoring for jobs; the
    brief's bookings columns have no customer columns (the fixture adds them; real names wait for C2).
  - Engine 1,390. Checks under a 4-CPU load of 8-14 from parallel agents: the only failures were time limits (the
    10k-quote performance test, two copy tests, four server files), each green when rerun on its own; the scan
    takes the same time with and without A2 at the same load.

- **A3. The sender's name and per-client inboxes.**
  - A client's sending inboxes are a list (fromEmails); an existing account's one address became its one inbox.
    With Instantly, a client with no inbox of its own isn't planned and nothing of its goes out; the server-wide
    INSTANTLY_SENDING_ACCOUNTS pool is gone.
  - One inbox sends for one client (one helper, `holdsInboxes`, that B3 extends with "one pass done"), checked in
    Settings, Restore plan and before every send.
  - Before a client's first activation and whenever its inboxes, signer or name change, each inbox is checked: in
    no campaign this server didn't make, in no other sending client's campaign, named for the client ("Sarah" / "at
    Capital City Landscaping", or the From name split at its first word), and the name read back. A refusal holds
    the client like a pause, shows on its page and in Needs a person (one alert per client), and is retried every 15
    minutes or at once on a Settings change.
  - Later changes to send days, hours, timezone, pace or inboxes go to the client's existing Instantly campaigns.
  - Cold email: webhook and reply-check events from campaigns the server didn't make, or inboxes no client uses or
    used, are only logged (no Claude read, no queue item); an error on an unused inbox warns nobody.
  - Also fixed: every Settings save was resetting trade, timezone and signer role to their defaults (zod's
    `.partial()` keeps `.default()`).
  - Brief notes: the three Instantly calls run campaigns-check first, so an inbox in a cold campaign is refused
    before it is renamed (renaming first would change the cold campaign's sender name); accounts without fromEmail
    used to send from the server pool and now send nothing until they get an inbox.
  - Left: the one-pass inbox math (B3); ending a pass must clear the inbox check the way a cancel does (B3); the
    new-client form has no inbox field (add it in Settings).
  - Server 340.

**Live steps for Jack**
- (A1) Leave FEATURE_NEW_REQUESTS and FEATURE_YEARLY unset (off) in production.
- (A3) Give each client its own inbox, connected in Instantly, in Settings before planning; keep client inboxes out
  of your cold campaigns. Check the Instantly API key can update accounts and campaigns and read account-campaign
  mappings (a client page saying "Instantly wouldn't name <inbox>" means it can't), and that Instantly takes an empty
  last name for a one-word From name. PATCH /campaigns has never run against live Instantly: if a client's activity
  says "Couldn't update this client's campaigns in Instantly", that campaign is still on its old settings.
- (A3) To move an inbox between clients, take it off the first client in Settings first; the second starts sending
  from it within about 15 minutes.

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

- Tenth adversarial review: 13 reported, 4 confirmed (13 → 11 → 7 → 4), all fixed and tested. An owner's
  BOOKED is matched to their records over the whole lead (from the month before they wrote back to the
  month after BOOKED), so a quote approved in October and a BOOKED texted in November count once, in
  either order. "Someone else got the job, 1800 cheaper", "Another company won the bid", "The other guy
  got the job" read as losses (the price that follows is why we lost it, not a booking); shopping words
  only protect a "has another guy coming out". A spouse with her own record replying in our thread with
  no lead on the email is tied to the person we wrote to through our note in that thread.
  Engine 1,232, server 258.

- Eleventh adversarial review: 7 reported, 2 confirmed (13 → 11 → 7 → 4 → 2), both fixed and tested. A
  competitor's price is shopping, not a loss ("she has another company giving her a price", "someone else
  already quoted her 1800"), while "someone else got the job, 1800 cheaper" stays a loss. In the reply
  poll, only our own notes say whose thread it is, so the person we wrote to following up after her spouse
  wrote there is still herself. Engine 1,232, server 259.

- Twelfth adversarial review: 2 confirmed, both about owner texts that mention another company ("the other
  guy had a lower bid and got the job" was booked for us; "she had another company do it, lower price" read
  as quoted). The patterns had been chasing these phrasings for several rounds, so the approach changed:
  an owner's lead text that mentions another company is read by Claude (apps/server/src/agents/ownerText.ts)
  for what happened to the owner's own company. An amount only counts if it's written in the text, and
  "unclear", an error or no Claude key sends it to a person. Plain commands still go through the rules.
  Engine 1,232, server 260.

- Thirteenth adversarial review: 2 confirmed, fixed. The gate that sends a text to Claude was too narrow:
  "Other guy got the job, 1800" (no "the"), "Someone cheaper got the job", "Competition got the job", "She
  booked Bartlett" still hit the booking patterns. It is now broad on purpose (any other/another/different
  + word, someone cheaper, competition, "her regular guy", a name after a hiring word): a text sent to Claude
  costs nothing, someone else's win read as ours costs the owner's ledger. A text that goes to Jack as
  unclear also stops the "still waiting" nudges for that lead. Engine 1,232, server 260.

- Fourteenth adversarial review: 3 reported, 1 confirmed: "Davey got the job, 1800" and other ways of
  naming a competitor still slipped past the list of competitor words and booked their price for us. The
  gate is now the other way round: a booking (money on the ledger) is recorded by the patterns only when
  it's plainly the owner's ("booked 2400", "Booked the dead oak, 1800", "She booked us for 2400", "SOLD
  2.4k"); any other text that reads as a booking goes to Claude, or to Jack with no key. An unclear text
  stops a lead's reminders only when its #code names that lead. Engine 1,232, server 261.

- Fifteenth adversarial review: 2 confirmed in the new plain-booking rule, fixed. It let someone else in as
  the thing booked ("She booked the cheaper guy, 1500"), took she/he/they as the winner ("They got the job,
  1800", "He won it") and read an appointment time as the price ("Booked her for 10 tomorrow, 2400" was
  $10). Now it's plain only with the owner (or no one) as the subject and a job, not a person or bid, as
  the object; she/he/they only when they booked "us/me/it"; one amount, last, and at least $50. Anything
  else goes to Claude or Jack. Engine 1,232, server 261.

- Sixteenth adversarial review: 1 reported, 1 confirmed, fixed: a time without a colon or a year was
  still taken as the price ("Booked her for Thursday at 1030" recorded $1,030). An amount is plain only with
  no day, date or time word anywhere in the text, and "at" no longer leads into an amount. Engine 1,232,
  server 261.

- Seventeenth adversarial review: the plain-booking rule's free "thing booked" slot was still a way in
  ("Booked her tmrw 1030" as $1,030, "Booked the cheaper roofer, 1500" as ours). The rule is now the command
  we teach the owner and nothing else: BOOKED 2400, booked it 2400, sold 2.4k, won it, the amount alone, or
  "she booked us for 2400". Any other booking text goes to Claude, or to Jack with no key. Engine 1,232,
  server 261.

- Eighteenth adversarial review: 2 confirmed, fixed. "@" is read as "at" ("Booked @ 1030" is a time, never
  $1,030), and a business's short name is never a word with a digit in it ("360 Tree Care" is CARE, so
  "BOOKED #K7Q 360" means $360, not the business). Engine 1,232, server 262.

- Nineteenth adversarial review: 1 confirmed (plus a low one), fixed. After "for", a bare number that could
  be a clock time or a year ("Booked for 930", "booked it for 2027") is Claude's or Jack's to read; "for
  1800", "$930" and "BOOKED 930" stay plain. A business with no word of its own gets its initials as its
  short name, never a piece of its id. Engine 1,232, server 262.

- Whole-codebase sweep (five lenses, each finding checked by a skeptic): 30 confirmed, all fixed and tested,
  in five batches.
  - Money and plans: Settings can record a yearly plan (billing, year price, paid years); a second RENEW
    changes nothing; RENEW and MONTHLY work from the paid year running today, so years never overlap; every
    plan change by text goes to Jack's queue to collect or refund; CANCEL takes a renewed year that hadn't
    started off the plan (the owner is told Jack refunds it only if it was paid); RESUME after a year ran out
    says it's still paused (and the direct sender honours a paused plan).
  - Owner texts: a text without a #code can be about a lead reported in the last 14 days, and asks when
    two fit; "Go ahead" answers the close or the renewal instead of running RESUME; a text with a #code is
    never a plan change, pause or booked-out command; BUSY and STATUS act only on the command shapes.
  - Sending: queued follow-ups stop once the quote is approved, becomes a job, gets onto the schedule, or the
    customer books or gets a new quote (in Instantly the lead is withdrawn); people whose request got our
    instant answer now get their follow-ups; a "today" answer is never sent late at night.
  - Surface: one Instantly campaign per client (the business id is in the name); forwarded requests and
    exports are read from every recipient field (Delivered-To, Cc, Bcc, provider envelopes); Don't send,
    Hold and edits reach Instantly or are refused with a reason; two records whose ids collide are kept apart.
  - Import: blank titles no longer crash it; archived quotes are dated by the quote, not the archive day;
    status words owners type (Done, Yes, Didn't sell) are read, and any we don't know is held for a person;
    "Leads…csv" with prices is read as quotes; unknown work never becomes the trade's first service; paid
    invoices and same-day sibling quotes count as coming back; re-sent sheets update rows in place; a
    shared phone no longer merges two people; the QuickBooks "Estimates by Customer" report imports.
  - Console: Resume on a plan that's paused or cancelled says nothing will send.
  - Engine 1,304, server 285.
- Known gaps left on purpose: an owner who edits a row's title or date before re-sending still gets a new
  record (the database save never deletes); an edit made in the seconds before Instantly's "sent" webhook
  arrives re-pushes from note 1 (BUSY's take-back has the same race).

- Verification pass over the sweep's fixes (four lenses, each finding checked by a skeptic): 17 reported, 14
  confirmed, all fixed and tested.
  - Record ids stay the 32-bit ones every stored account already has (a 64-bit switch would have duplicated
    records on the next Jobber pull or re-upload); a new record whose id is taken by a different one gets a
    salted id instead, for quotes, jobs, invoices, requests and forwarded leads.
  - Anyone who replied to our instant answer is never planned again, and nothing for them reaches Instantly;
    a newer quote that stops an older sequence gets its own follow-up.
  - Re-sent sheets with no title column match rows by customer and date (Notes edits no longer make a new
    quote); QuickBooks carry-down only on the real grouped report; "Sales by Customer Detail" reads as paid
    sales; "Yes - waiting on HOA" is a yes held for a person.
  - Settings: a renewed year can be taken off, going Monthly drops years not started, moving the first paid
    day forward keeps fees paid so far; switching billing asks for the day it starts.
  - Owner texts: "Monthly cleaning booked 180" is a lead, not a plan change; a bare "No" to the close or the
    renewal never marks a lead lost; "Go ahead and resume" resumes; "Ok cool" is a plain yes.
  - Engine 1,316, server 295.

- Second verification pass over those fixes: 6 reported, 5 confirmed (30 → 14 → 5), all fixed and tested.
  A renewal reply that starts with a plan word and gives a reason ("Monthly - the year is too expensive") goes
  to Jack and never touches a lead; "Yes - backed out", "Yes - changed mind", "Approved - cancelled" are held
  for a person, never told "you gave us the go-ahead"; a quote dated before the request's follow-up was planned
  is still the one chased; QuickBooks Desktop's Sales by Customer Detail (a Name column on every line) reads as
  paid sales; a quiet last month dated the day Jack moves the first paid day still comes off that year's fees.
  Engine 1,319, server 297.

**Next**
- Wrap up: the summary for Jack.

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
