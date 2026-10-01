# Quiet Accounts: build brief for the coding session

Oct 1, 2026 · from Jack · repo `QuietAccountsCluade`, branch `claude/quiet-accounts-v1`, starting at `2726e98`

This brief replaces the offer in the blueprint, the site-v3 copy deck and the decisions in STATUS.md wherever they disagree. The plan behind it is "The Two-Offer Plan" (doc 101 in my project).

(Saved verbatim from Jack's message. Line numbers below refer to commit `2726e98`; the code has moved since, so find
things by name. Work was built on top of the later fixes on this branch, not reset to `2726e98`.)

**The two reference pages.** They come with this brief: `reference/lawn-page.html` and `reference/cold-email-page.html`.
- Save them in `apps/site/reference/`. Don't build them.
- The public site gets rebuilt from them (§5).
- If the files didn't come through, they're these two Claude artifacts:
  - "Quiet Accounts for Landscapers": https://claude.ai/code/artifact/a262161f-db8d-47be-b205-6058b1305e2c
  - "Quiet Accounts Cold Email Page": https://claude.ai/code/artifact/8d26ea54-ee7c-43b0-9158-ea4821827e5d

## 0. The short version

The engine is good: finding people, writing the notes, reading replies, the ledger, and the owner's OK on the first note. It was built for one big offer: a $497 "everything" retainer with new-request answering, a yearly plan and refunds. I'm selling two smaller offers instead (§2). So:

1. Switch off what neither offer sells.
2. Fix what would break the first clients: lawn and cleaning exports, the sender's name, booking texts, and owner texts without Twilio.
3. Build lawn seasons, the one-pass mode and billing.
4. Rebuild the public site from the two reference pages, using the rules in §5.

Nothing goes live from your session (§1).

## 1. Ground rules

- **Nothing live.**
  - Don't send real email or texts, write to Instantly, call Stripe in live mode, deploy, touch DNS or buy anything.
  - Use the log providers, fakes and, if I give you one, a Stripe test key.
  - Committing and pushing to this branch is fine.
  - Where something can only be checked live, write the steps for me under "Live steps for Jack" in STATUS.md.
- **Order.**
  - Do Phase A, then B, then C, with the items in each phase in order.
  - One commit per item, with `pnpm check` green before each.
  - Every change gets new tests and a STATUS.md entry: what changed, what's left.
- **Scope freeze.**
  - No new trades, channels or features beyond this list.
  - No more review rounds on owner-text wording. The only parser changes are the three bugs in A4 and the NOT OURS command in B4.
- **Keep the safety you built.**
  - Nothing sends before the owner OKs the first note.
  - "Stop" always wins.
  - Every note carries the postal address.
  - The bounce brake stays.
- **Words.** These apply to owner texts, notes, the console and the site.
  - **Monthly promise.** One of two forms, nothing else: "Any month nobody asks to come back is free." or "Any month nobody asks to come back, you don't pay."
  - **One-pass promise:** "You pay $250 for each job that books, never more than $1,000. Nothing books, you owe nothing."
  - **Banned words:** "money-back", "risk-free", "guaranteed X%" and "free trial" (16 CFR 239.3 and 251.1).
  - **"Free" always has its price beside it, buttons included:** "First 150 free, then $497 a month if you say yes."
  - **No invented product names:** no Money Map, Reply Desk, Ready Text, Every Month After or Year Floor. Use plain words: "your list", "the replies", "the text you get".
  - **Results labels.**
    - Every result carries "Owner-reported. First 150 people. No comparison group."
    - Dow's Tree Service appears only with "Dow's is owned by Jack's uncle." (16 CFR 255.5). That includes any range or total that counts Dow's.
    - Lead with Capital City on lawn and cleaning, and with Nelson Fence on tree, painting and fence.
  - **Outside numbers** come only from `packages/engine/src/claims.ts`, with the source beside them.

## 2. The two offers

| | Monthly: "Your past customers, back on your schedule" | One pass: pay per booking |
|---|---|---|
| Trades | Lawn and landscaping, residential cleaning | Tree, painting, fence (fence from January) |
| The list | Past customers who stopped booking, then each month's new drop-offs | Every old quote that never booked plus every past customer, once |
| Price | First 150 people free, then $497 a month, only if the owner says yes | No card to start. $250 per booked job, capped at $1,000 (4 jobs) |
| If nothing comes back | Any month nobody asks to come back is free. We text before every charge | He pays $0. A booked job that cancels before the work gets its $250 back |
| How it ends | Cancel by text, any time | When the list is done (about 4 weeks). Then monthly if his list refills, or a rerun next season |
| Smallest list | 150 past customers with an email, plus about 30 more lapsing or coming due each month | 150 people with an email |

### The rules the code must use

Each rule has one definition, shared by the code, the texts and the site.

**"Asked to come back" (monthly).** Someone we wrote to asks for a date, a price or their old slot.
- In code that's the existing `WANTS` set: `wants_it` or `wants_price` (`engine/reports/owner.ts:10`).
- Only replies to our follow-up notes count. That's the existing `fromFollowUp` rule (same file, lines 585–592).
- The rule stays; only the words change (A6).

**Billable booking (one pass).** A booking is billable only when all six of these hold:
1. **A real reply.** The person replied to one of this pass's notes.
   - The reply's intent isn't `stop`, `not_interested`, `wrong_person`, `complaint`, `auto_reply` or `bounce`.
   - Replies to new-request answers never count.
2. **Booked within 60 days.** The booking's date is within 60 days after that reply.
   - Use the date the booking was made: the job's created date, the quote's approved date, the invoice's issued date, or the day of the owner's BOOKED text or my console entry.
   - If an export has only the work date, use that. It errs in the owner's favor.
3. **One per customer.** It's that customer's first billable booking: one charge per customer, however many jobs.
4. **Under the cap.** It's within the pass's cap of four.
   - The cap counts charges that weren't refunded. A booking disputed after its charge holds its place until I decide.
   - On a `freeFirst` pass, bookings from the free people don't count toward the cap.
5. **Not disputed.** The owner hasn't marked it "not ours".
6. **Before any cancel.** It's dated before the owner cancelled. Bookings after a CANCEL aren't billable.

**Who gets monthly.**
- Only an owner whose list refills with about 30 newly lapsed or due customers a month, averaged over the last 12 months.
- Show that number in the console when a free 150 or a one pass ends.
- Below it, he's offered the one pass instead.

**Two variants of the one pass:**
- **`freeFirst: 150`.** Forest Green and United Tree Pro were promised a free 150, so bookings from their first 150 people aren't billable.
- **The rest of a lawn or cleaning list.** A lawn or cleaning owner who won't go monthly can have a one pass on the rest of his list. A booking is then billable only if the customer went back on a regular schedule (cleaning), or booked a season or a job over $500 (lawn).

**Which leaks each trade works.** This is the planner's `types` filter (`cadence/plan.ts:16`), set by trade so it holds for both offers.
- **Lawn, landscape and cleaning:** `lapsed_regular`, `one_and_done`, `service_due`. Plus `missed_upsell`, but only cleaning's one-time-to-regular follow-on (`TO_RECURRING`, `serviceId: "clean.recurring"`, `trades/playbooks.ts:1321`).
- **Tree, painting and fence:** `unanswered_quote`, `archived_quote`, `changes_requested`, `approved_unscheduled`, `unquoted_request`, `declined_quote`, `one_and_done`, `lapsed_regular`, `service_due`.
- **Never:** `unpaid_invoice`, `declined_option`, or any other `missed_upsell`.

### Launch calendar

Cold email runs in Instantly by hand; your software isn't in that path.

- **Lawn:** emails Oct 5–16. First lawn client about Oct 12.
- **Tree:** emails Oct 19–30. First tree client about Oct 26.
  - Ryan and David may start a one pass on their past customers sooner. I'll run those by hand until B3 and B4 land.
- **Cleaning:** Nov 2–13. **Painting:** Nov 16–25.
- **Readout:** Dec 1.

## 3. Software changes

S = a few hours, M = one to two days. Brackets give the plan's fix number.

### Phase A: before the first client (by Friday, Oct 9)

#### A1. Switch off what neither offer sells (S)

Why: these promise things one person can't deliver, or that neither offer sells, and some of them are on the site today.

- **New-request answering.**
  - What it is:
    - the always-on track and the `requests+` addresses;
    - the instant campaign (`instantly/campaign.ts:234–247`);
    - the auto-answer that promises a call "today" (`copy/render.ts:337–352`);
    - inbound request reading (`engine/inbox/request.ts`; `http/app.ts:1007–1027`; `core/ops.ts:1355–1426`).
  - Put it behind `FEATURE_NEW_REQUESTS`, default off.
  - Off means no instant campaign, no `requests+` address shown anywhere and no automatic answer. An inbound email goes to the review queue as plain mail.
- **The instant answer to hot replies** (`ackFor`, `reports/owner.ts:115`).
  - Why it goes: it promises the homeowner a call "today" on the owner's behalf, and the pages say a person reads every reply.
  - Today it's on unless a profile says `autoAck: false` (`reports/owner.ts:117`; the field is at `model.ts:281`).
  - Set `autoAck: false` in `defaultProfile` (`http/app.ts:137–173`), and migrate existing accounts.
- **The 10% holdout.** New accounts default to `holdoutPct: 0` (`http/app.ts:169`). A migration sets existing accounts to 0.
- **The yearly plan.** Behind `FEATURE_YEARLY`, default off:
  - `renewalIfDue`, `settleYears` and `renewPlan` (`runtime/agents.ts:802–880`);
  - the year fields (`engine/model.ts:332–345`) and the year texts (`reports/owner.ts:438`, `475–528`);
  - RENEW, YEARLY and ANNUAL (`core/owner.ts:371–394`). Keep the trial's MONTHLY yes (`core/owner.ts:381–387`);
  - UNDO after CANCEL (`core/owner.ts:426–458`; `core/ops.ts:799–823`).
- **CANCEL stays.**
  - Keep `cancelPlan` (`runtime/agents.ts:881`). Cancelling takes one text and is final.
  - Drop "Text UNDO" from the cancel replies (`core/owner.ts:376`, `403`, `422`).
- **Forecasts and fit tiers** (`breakage/forecast.ts:232–397`; `reports/owner.ts:408–414`).
  - Never show them to owners or on the site, and they gate nothing.
  - They told a lawn shop and a cleaning shop "Your typical quote is $0", and marked both not eligible for the guarantee.
- **Trades.**
  - Detection, the console and sign-up use only lawn, landscape, cleaning, tree, fence and painting.
  - Keep the other 14 playbooks in code, but out of detection and menus. They cause misreads, like "Standard Cleaning" read as a deck company.
- **Jobber login and sync.** Hide them from the console and owner texts; exports only for now. Keep the code.
- **Leak types.** Apply the by-trade `types` filter from §2.
- **Invented names.** Rename them in plain words wherever they show:
  - "Money Map" becomes "List" (`web/live/Client.tsx:16`, `440`).
  - "Reply Desk" becomes "Replies" (`Client.tsx:18`).
  - "Ready Text" becomes "Hand-off text" (`web/live/parts.tsx:325`; `web/screens/owner/Results.tsx:11`).
  - "Every Month After" (`Client.tsx:262`) goes with new-request answering.
  - Fix the comments that use them too (`http/app.ts:807`; `reports/owner.ts:227`).
- **The current site, today.** Until A7 replaces it:
  - take the two "New requests answered from your office, 7am to 8pm" lines out of `apps/site/index.html` (lines 449 and 522);
  - retitle its named-part headings in plain words.
- **Promises nobody can keep from abroad.**
  - "Jack will put everything back himself today" (`core/owner.ts:435`, `448`) and refunds "within 5 business days" (`runtime/agents.ts:900`) go behind the yearly flag.
  - No owner text promises same-day action from me.

Done when the grep in §6 comes back clean. A new account has holdout 0, autoAck off, no new-request track and no yearly plan.

#### A2. Read lawn and cleaning exports (M) [fix 1]

Why: lawn and cleaning owners send one export, Jobber's Visits report, and it's read as a jobs file.
- 1,640 visits collapse into 40 people.
- Lapsed weekly customers come out as one-time customers.
- With rows newest-first, every active customer gets flagged.

**Detect the Visits report as `visit`.**
- Its columns, from Jobber's help page: Job #, Date, Visit title, Client name, Client email, Client phone, Service street/city/state/ZIP, Visit completed, Assigned to, Line items, One-off job ($), Visit based ($), Scheduled duration, Time tracked, Job type.
- Today the scores tie 7–7 and "job" wins on list order (`ingest/detect.ts:213–216`).

**Keep every visit.**
- Don't key visits on Job # (`ingest/normalize.ts:217`).
- Don't let later rows overwrite earlier ones (`normalize.ts:277–278`).
- Each visit is its own record, grouped by client.

**Read the date and amount.**
- Map a plain "Date" column to the visit date. Today only named date columns map (`ingest/fields.ts:143–144`, `178–181`).
- The amount is "Visit based ($)", or "One-off job ($)" when that's the one filled in.

**Map client-list headers.**
- "Last Visit", "Last Appointment", "Last Booking Date", "Last Cleaning" and "Last Service" map to `lastJobOn` (`fields.ts:150`).
- Never to the last name (`fields.ts:75`) or the created date (`fields.ts:137`).

**Lapse in client lists.**
- A client list gives one date per person, so it has no rhythm, and `lapsed_regular` needs two or more visits (`breakage/detect.ts:496`).
- Use a frequency column when there is one. Otherwise use the trade's longest threshold: 45 days for cleaning (`playbooks.ts:1339`). Not the 300-day one-and-done floor (`breakage/assumptions.ts:111`).
- Lawn client lists wait for B2's seasons.

**Read bookings exports as visits.**
- A bookings export (Booking ID, Service, Frequency, Booking Date, Price, Status) reads as visits, not quotes (`ingest/detect.ts:207–212`).
- Today 480 bookings become 480 won quotes.

**One row per job.** In Jobber's Jobs report and sync shape, a recurring job that ended four months ago is a lapsed regular. Today nothing is found.

**Readiness.** Ask lawn and cleaning shops for visits or invoices first, not quotes (`breakage/readiness.ts:92–122`).

Done when these new fixtures pass:
- **Jobber Visits, newest-first and oldest-first.** 1,640 rows give 40 customers with their full history, every lapsed weekly customer is found as `lapsed_regular`, and 0 active customers are flagged.
- **A cleaning client list with "Last Cleaning".** Everyone past the threshold is found, as whichever past-customer type fits, and 0 active clients are flagged.
- **A bookings file.** It reads as visits, with the same results as the Visits fixture.

#### A3. The sender's name (S, plus inboxes) [fix 2]

Why: Instantly sets the sender name per inbox, not per campaign, and the code never sets one (`instantly/campaign.ts:96–117`, `295–311`). A homeowner would see "Jack Philbrick" on a note signed "Sarah at Capital City Landscaping".

**Inboxes per client.**
- A client sends only from inboxes assigned to it.
  - A monthly client needs one.
  - A one pass needs about one per 120 people on a 30-day pass, because Instantly sends follow-ups at +4 and +5 days (`instantly/campaign.ts:60–62`). 600 people means five inboxes, or a longer pass.
- Make this a list, `fromEmails`. Today it's a single `fromEmail` (`engine/model.ts:231`).
- With `EMAIL_PROVIDER=instantly`, refuse to plan or activate a client with none.
- Client notes never fall back to the server-wide `INSTANTLY_SENDING_ACCOUNTS` (`campaign.ts:213–225`; `main.ts:36`).

**One client per inbox.** Refuse an inbox that another client already has, unless that client is cancelled or its one pass is done.

**Name each inbox before its first activation** (`instantly/provider.ts:348–349`), and again whenever an inbox, the signer or the name changes:
1. **Set the name** with `PATCH /api/v2/accounts/{email}`.
   - If `fromName` is set (`model.ts:233`), its first word goes in `first_name` and the rest in `last_name`.
   - Otherwise `first_name` is the signer ("Sarah") and `last_name` is "at {business name}".
2. **Read it back** with `GET /api/v2/accounts/{email}`. Refuse to activate if it doesn't match.
3. **Check its campaigns** with `GET /api/v2/account-campaign-mappings/{email}`. Refuse if the inbox is in any campaign this server didn't create. Client inboxes never go in cold campaigns.

**Fix the Settings hint** (`web/live/ClientWork.tsx:549–550`). "Notes come from (name)" now sets the inboxes' name in Instantly.

**Push later changes** (send days, window, inboxes) to the client's existing campaigns. Today campaigns are created once and never updated (`provider.ts:173–189`).

Done when tests against a fake Instantly client cover each refusal and the name write-and-check. No real API calls.

#### A4. Booking texts that get lost or invented (S) [fix 3]

**"BOOKED 2400" with no code after a DONE.**
- Today the reply is "Nobody's waiting on a call right now," and nothing is recorded (`core/owner.ts:590`, `607–610`).
- Instead, reply "Got it, Jack will match it," and put the text and the business in my queue.

**"Which one?" with no code.**
- It's never flagged to me today: `needsPerson` is only set when there's a code (`owner.ts:617–625`).
- Always flag a booking-looking text that gets the "which one?" reply.

**Phone numbers read as amounts.**
- A bare number that looks like a phone number (7 or more digits) is never a booking amount. Nor is any amount over $100,000 (`owner.ts:174–198`, `239`).
- Send it to me. Today "6035550142" booked $6,035,550,142.

Done when each of the three has a test.

#### A5. Owner texts without Twilio (S)

Why: Twilio waits on carrier registration, which takes weeks. Without it, owner texts are marked sent but only written to the server log (`providers/sms.ts:10–19`; `core/ops.ts:1184–1186`), so I never see them.

**A manual mode.**
- Add `SMS_PROVIDER=manual`, the production default until Twilio clears.
- Every owner text goes to a "Texts to send" list in the console, with the owner, the number, the text, a Copy button and a "Sent" button.
- Money texts still wait for my approval first (`ops.ts:1151`, `1176–1180`).

**A "Paste their reply" box on each client.** What I paste goes through the same handler as the Twilio webhook: OK, BOOKED, NOT OURS (once B4 adds it), PAUSE and CANCEL.

Done when:
- a hand-off lands in the list;
- pasting "OK" starts the first round;
- pasting "BOOKED 2400 #K7Q" records the booking.

#### A6. Small ones (S)

**Guarantee wording.** Change every owner-facing "price or a date", worded by plan kind.
- Monthly says "asked to come back". One pass says "wanted the work".
- Find them with `grep -rn "price or a date" packages apps`:
  - engine: `reports/owner.ts` (177, 284, 305, 386, 390, 393, 437, 576, 605), `runtime/agents.ts:793`, `claims.ts:205`;
  - server: `core/owner.ts:343`, `367`;
  - web: `screens/ops/Billing.tsx`, `screens/Welcome.tsx`, `screens/owner/Results.tsx`, `screens/owner/Today.tsx`;
  - site: `friday.ts:14`, plus `index.html`, which §5 replaces.
- The Friday line "Want a price or a date: 3" becomes "Asked to come back: 3" (monthly) or "Wanted the work: 3" (one pass).
- The monthly close also promises "every new quote you write" (`reports/owner.ts:392`). Make it "everyone who drops off each month".
- Add classifier tests that "put me back on", "same day as before" and "can you come back" are `wants_it`.

**Send days.** Monday to Friday, 7–10 a.m. local: `sendDays: [1, 2, 3, 4, 5]` (`http/app.ts:160`). Days count from 0 = Sunday.

**Settings.**
- Timezone and trade become editable (`ClientWork.tsx:543–556`, `677`).
- Sign-up guesses the timezone from the cell's area code instead of fixing Eastern (`http/app.ts:895–897`). I confirm it.

**Console brakes.** Show the real thresholds.
- The console says "Auto-pause at 4% bounces or 0.3% complaints" (`web/live/Client.tsx:296`).
- The real brakes trip at 3% bounces after 40 sends, 0.1% complaints after 300, and 1% "who is this?" replies after 100 (`runtime/agents.ts:420–422`).

**Sign-up origins.**
- In production settings (the same condition as `config.ts:92`), refuse to start with `SIGNUPS=on` and no `SIGNUP_ORIGINS`.
- Today it falls back to "*" (`http/app.ts:810–811`).
- Dev and tests are unaffected.

**Note copy** (`copy/templates.ts`):
- **Line 45:** drop "That's on us for not following up". Jobber may have followed up already.
- **Lines 171 and 213:** drop "I'll get you an updated price this week" and "We've got openings coming up". Nothing backs them.
- **Line 310:** a subject that's only the street name ("Oak Ln") uses the job instead.
- **Line 318:** cut "Always glad to help a past customer".

#### A7. Site: the lawn page and the front page (S–M)

See §5. The lawn page needs to be up by Oct 9 for owners who look us up after block 1's emails.

#### A8. Deploy kit, not a deploy (S)

- **Dockerfile.** Node 22.5+ and pnpm. It builds the console and runs the server and worker in one process.
- **`.env.example`.** Every setting, each marked required or optional, with what happens without it.
- **The database.** `DATABASE_PATH` sits on a mounted volume. A nightly SQLite backup (`VACUUM INTO` a dated file) keeps 14 days.
- **A README section, "Run it":**
  - one always-on host with a disk: Fly, Render, Railway with a volume, or a small VPS. Not serverless;
  - an https `PUBLIC_URL`, `TRUSTED_PROXY_HOPS` and `SIGNUP_ORIGINS`;
  - the Instantly and Stripe webhook URLs.
- **The health page.** It shows whether the Instantly webhooks are OK, the SMS mode, the Stripe mode (manual, test or live) and the last backup time.

### Phase B: before the first one-pass booking and the first $497 (by Friday, Oct 23)

#### B1. Site: the tree page, plus painting and fence from the same template (S–M)

See §5. Tree goes first, by Oct 16, because tree emails start Oct 19. Painting and fence come with it: painting is needed by Nov 13, and fence stays unlinked until January.

#### B2. Lawn seasons (M) [fix 4]

Why: there's no off-season. Run on Jan 15, it flagged 100 of 100 active weekly customers and planned "We'd love to have you back on the schedule" to every one.

**Seasons for recurring work.**
- Recurring lawn and landscape work (mowing, maintenance) gets a season by climate. Use the playbook's season arrays (`trades/playbooks.ts:204`).
- A customer whose last visit was at the end of last season isn't lapsed in the off-season.

**What lapsed means.** Either one of these:
- He didn't come back in the first four weeks of his usual season.
- He stopped mid-season, missing three or more of his usual visits.

**When lapsed notes go out.**
- Only in the selling windows:
  - fall cleanup, from now to mid-November in the north;
  - "keep your spot for spring", January to March.
- Never in December.
- The regular sequence gets a timing line (`copy/templates.ts:569–575`).

**One-off seasonal work.** Fall and spring cleanup, aeration and mulch are `service_due` in their season and wait outside it. The between-seasons guard (`breakage/detect.ts:412–428`) skips recurring services at line 416.

**Value a weekly regular** by in-season weeks (about 28 in New Hampshire), not 52 (`detect.ts:505`).

**Make the sample generator seasonal** so the tests see winter. Today it mows every 14 days all year (`sample/catalog.ts:194`).

Done when, on a seasonal fixture:
- scans on Oct 15, Jan 15, Mar 1 and Jun 15 flag 0 active customers;
- October finds last season's fall-cleanup customers;
- January to March finds lapsed regulars, with spring wording;
- nothing is planned in December.

#### B3. One-pass mode (M) [fix 5]

Why: a list never ends today.
- It rescans after 150 days (`runtime/agents.ts:97`).
- Paying accounts top up every night (`core/worker.ts:194–197`).
- The owner texts say "first 150 free, then $497" (`reports/owner.ts:184`, `391–393`).

**The plan type.** Add `plan.kind: "monthly" | "one_pass"` (`engine/model.ts:323`).

| One-pass field | Default |
|---|---|
| `pricePerBooking` | 250 |
| `capBookings` | 4 |
| `windowDays` | 60 |
| `targetEndOn` | start + 30 days |
| `freeFirst` | 0 (or 150) |

**Its own stages.** A one pass runs `running`, then `done`, plus `paused` and `cancelled`. Every gate that checks `plan.stage` today must check `plan.kind` first:

| Gate | Monthly | One pass |
|---|---|---|
| The first-note OK (`core/ops.ts:270`, today `stage === "trial"`) | as today | applies |
| The 150 limit (`core/ops.ts:267`) | as today | doesn't apply |
| Nightly top-ups (`core/worker.ts:194`) | as today | doesn't apply |
| Ranking (`cadence/plan.ts:108`) | as today | newest first |
| `planBatch`, which sets holdout and rank from `isTrial` (`runtime/agents.ts:121–128`) | as today | no holdout, newest first |
| The console's plan button, which caps plans outside the trial at `weeklyNewContacts × 4` (`web/live/Client.tsx:49–55`) | as today | no cap beyond the inbox math |
| `untouchedSignup`, which requires `trial` (`http/app.ts:855`; C1 relies on it) | as today | an untouched one-pass sign-up counts too |
| The stage values the operator API accepts (`http/app.ts:122`) | as today | add the one-pass stages |
| The $497 `billingCheck` (`runtime/agents.ts:779`) | as today | doesn't apply |
| The free-round close (`agents.ts:758`) | as today | replaced by the one-pass end |

**The whole list, once.** No holdout, no 40% type cap (`cadence/plan.ts:53`, `108–123`), no rescans and no top-ups.

**Pace from the end date.**
- Each person's notes end within about 12 days (`copy/templates.ts:513–599`). So spread first notes over the send days until about 12 days before `targetEndOn`.
- Model the follow-ups the way Instantly sends them. They go at +4 and +5 days (`instantly/campaign.ts:60–62`), ahead of new leads (`:210`).
- Never go over 30 sends a day per assigned inbox, follow-ups included.
- When the date can't be met, tell me two things: which date can be met, and how many more inboxes would meet the first one.

**One-pass owner texts.** They never mention $497, and they say "free" only on a `freeFirst` pass.
- **A welcome.**
- **The hand-offs**, as today.
- **The money texts** (B4).
- **An end text.**
  - It gives the tally: "Asked 412, 38 wrote back, 9 wanted the work, 6 booked. You paid $1,000, the cap."
  - Then the refill check: monthly if about 30 or more lapse or come due each month, otherwise "I'll check back next season".
  - I approve it before it goes.

**The console** shows the plan kind, list size, sent so far against the end date, billable bookings (x of 4) and charges.

Done when:
- a 600-person pass on five inboxes gets its last first note out by `targetEndOn` minus 12 days;
- the same pass on three inboxes raises the "date can't be met" alert, naming the date it can meet;
- neither has a holdout, a rescan or a top-up.

#### B4. $250 per booking, capped at $1,000 (M) [fix 6]

Why: there are no payments anywhere in the code, and the ledger can't be the bill.
- It counts a quote approved with no reply, up to 180 days later, with one credit per job (`ledger/attribution.ts:34–37`, `116–148`).
- Its "wrote back" includes "stop" and "not interested" (`runtime/agents.ts:681–685`).

**The count.** Add `billableBookings()` in the engine, built from the ledger but using §2's rule.
- Key it by customer and booking.
- A booking I record by hand can be replaced by the same booking from an export with a different id (`agents.ts:689–694`). That must never bill twice.

**The charge log**, kept on the plan.
- Each charge has an id, customer, booking, amount (25000 cents), status, Stripe ids and times.
- Statuses run `heads_up` → `approved` → `link_sent` or `charging` → `paid`, `failed`, `refunded` or `skipped`.
- The charge id comes from the pass and the customer, so a booking seen twice can't make a second charge.
- Everything is idempotent by charge id.
- It accepts a charge I mark as already paid outside the software, and a Stripe customer id I paste in (§4).

**The texts.** Every money text includes the lead's code and goes through the money-text approval (`core/ops.ts:1151`).
- **Booking 1:** "Karen Whitfield booked (#K7Q). That's your first $250. Here's the link: [/pay link]. It saves your card for the rest, and I text before every charge."
- **Bookings 2–4:** "Mike Sanderson booked (#M2D). $250 goes on your card ending 4242 on Thursday, $500 of your $1,000. Not ours? Reply NOT OURS #M2D." After I approve it, the card is charged one business day later, unless NOT OURS comes in first.
- **After four:** "That's four, the $1,000 cap. Anything else that books from this pass is yours."

**The NOT OURS command.** Add one new owner-text command, "NOT OURS #code". It's the only new parser rule.
- Before the charge, it cancels the charge.
- After it, it goes to me, and I decide the refund.

**A booked job cancelled before the work** gets a refund after I approve it.

**Stripe settings.**
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- Refuse an `sk_live_` key unless `STRIPE_ALLOW_LIVE=true`. I set that at deploy.
- **Manual mode** (no key): each charge shows in my queue as "Send the $250 link" or "Charge his saved card", with a Done button.

**The payment link.**
- The owner gets a stable link, `/pay/{signed token}`, built on the existing signed links (`core/ops.ts:135–147`).
- Never send a raw Checkout URL. Those expire within 24 hours.
- Opening the link creates a fresh Checkout Session for that charge if it isn't paid yet, or says it's paid.

**The first charge.** Create a Customer (metadata: the business id), then a Checkout Session with:
- `mode: "payment"`, `payment_method_types: ["card"]`, the `customer`, and one $250 line item named "Booked job: Karen W. (Dow's Tree Service)". Cards only, so nothing settles days later by bank debit;
- `payment_intent_data.setup_future_usage: "off_session"`;
- `custom_text.submit.message`: "$250 per booked job, up to $1,000. Each later charge comes after a text.";
- metadata with the business id and charge id;
- a plain thanks page as the success URL;
- the idempotency key `{chargeId}:checkout:{n}`, where n counts the sessions made for that charge.

**The webhook**, `POST /webhooks/stripe`, with a verified signature.
- **Link charges.**
  - A link charge is paid only on `checkout.session.completed` with `payment_status: "paid"`.
  - `checkout.session.expired` only means that session is gone; the `/pay` link makes a new one.
  - Don't fail it on `payment_intent.payment_failed`. Checkout fires that on each declined try while the owner can still retry.
  - On paid, retrieve the PaymentIntent with `expand: ["payment_method"]`. Store the customer, the payment method, the brand and the last 4.
- **Later charges** settle on `payment_intent.succeeded` or `payment_intent.payment_failed`.

**Later charges.**
1. Create the PaymentIntent unconfirmed, with `customer` and `payment_method`. Its idempotency key is `{chargeId}:pi`.
2. Store its id on the charge.
3. Confirm it with `off_session: true`.

**After a restart**, retrieve it by the stored id:
- `requires_confirmation`: confirm it.
- `processing`: wait for the webhook.
- `succeeded`: mark it paid.
- Anything else (`requires_payment_method`, `requires_action`, `canceled`): mark it failed. After my OK, the owner gets the `/pay` link.

Idempotency keys expire after 24 hours, so the stored id is what prevents double charges.

**Refunds.** `refunds.create` on the PaymentIntent, after my OK.

Done when these hold with a fake Stripe client:
- the cap holds at 4, and a refund frees its place;
- a customer with two jobs is charged once;
- a booking 61 days after the reply isn't billable;
- a "stop" replier who books isn't billable;
- `freeFirst: 150` works;
- NOT OURS works both before and after a charge;
- a cancelled job is refunded;
- a declined first try followed by a paid one ends paid;
- a webhook retried three times, or a worker restart mid-charge, never charges twice.

#### B5. Monthly billing on the saved card (S–M)

Why: the pre-charge flow exists, but the charge itself happens by hand outside the software. The flow lives in `runtime/agents.ts:777–796`, runs daily at `core/worker.ts:160–166`, and is approved at `core/ops.ts:1176–1180`.

**The first $497.**
- When the owner says yes after the free 150, he gets a `/pay` link for the first $497 that saves the card.
- It uses the same Customer, cards-only Checkout, `setup_future_usage` and webhook rules as B4.
- I approve that text.

**Each month after.**
- The existing pre-charge text goes out two days before, and I approve it.
- Then the saved card is charged off-session on the charge date, the B4 way.
- In a free month (the existing `guaranteeCheck`), there's no charge, and the "free month" text goes instead.

**No subscription.**
- No Stripe subscription and no auto-renewing link. A charge happens only through this approved path.
- Cancel by text stops the next one.

Done when:
- a quiet month charges nothing;
- a cancel the day before charges nothing;
- a retried webhook never double-charges.

#### B6. "Did it book?" check-ins (S)

**After each hand-off.**
- Two days later, and again at 14 days, I get a queue item (in manual mode), or the owner gets a text.
- The text: "Did Karen Whitfield book? Reply BOOKED $amount #K7Q, or NO #K7Q."

**At the end of a one pass.**
1. Ask the owner for a fresh export.
2. On import, match it against everyone who wrote back.
3. List any new billable bookings for me to confirm before a heads-up goes out.

### Phase C: before the cleaning block (by Friday, Oct 30)

#### C1. The site audit for past customers (M) [fix 7]

Why: any file without quotes ends at "We couldn't find any quotes in that file" (`apps/site/src/main.ts:287–295`), even when the engine found past customers. A lawn invoices file with 40 past customers was thrown away.

**Where it lives.** In the "Got it. One thing left." step, as the other way to send the file: "Have the file already? Drop it here."
- It shows the result right there.
- With a server, it sends the file with a second `/start` POST. The server already accepts a returning owner's file for an untouched sign-up (`http/app.ts:847–856`); B3 makes that work for one-pass sign-ups too.
- Without a server, it shows the result and asks him to forward the email as usual.
- No "Try a sample" on these pages.

**Past-customer results.** Accept them on their own. Show:
- who stopped and when: last 3 months, 3–12 months, last season;
- what they used to pay;
- the first note to one lapsed regular, with the owner's company name in it.

**Trade detection.**
- Pass the page's trade into the audit (`main.ts:277`).
- Include invoice subjects and visit titles in trade detection (`site/src/audit.ts:130`).
- Teach "Standard Cleaning" and "Recurring Cleaning" as cleaning.

**Export hints.** Stop pointing cleaning owners to Jobber's Re-engagement report, which has no emails (`site/index.html:226`). Point them to the Visits report.

**Privacy.** Nothing leaves the browser until he presses send.

#### C2. Cleaning software exports (S)

- **New exports.** Read BookingKoala, Launch27 and ZenMaid exports.
  - Take their column names from their help pages, not guesses, and add a fixture for each.
  - Their frequency column gives the regular rhythm. Read Completed and Cancelled statuses.
- **Keep** cleaning's one-time-to-regular note working.

#### C3. Site: the cleaning page (S)

See §5.

### Later (don't build now)

- **Twilio live**, after carrier registration: switch `SMS_PROVIDER`.
- **A per-lead "Booked? $___" link** on the signed owner link (`core/ops.ts:135–147`).
- **Jobber sync**, for checking bookings.
- **A separate Instantly workspace for client notes**, at about 10 clients. Today unsubscribes block across the whole workspace (`instantly/provider.ts:354–358`).
- **New-request answering and the yearly plan** stay behind their flags.

## 4. What Jack does by hand meanwhile

You don't build these. They're listed so you know what the software must not fight.

**Cold email.** I send it from Instantly myself, in campaigns your server doesn't create, in the same workspace for now.
- Never pause, edit or attach inboxes to those campaigns.
- Their events reach your webhook and reply check too, because the webhook covers the whole workspace. Today that goes wrong in two ways:
  - an unmatched human reply gets a Claude read and lands in the review queue (`core/ops.ts:988–1016`);
  - an error on an inbox no client uses warns every client (`core/ops.ts:909–913`).
- Drop events from campaigns and inboxes the server didn't create before any Claude call, and log them only. Add a test with a reply to a cold campaign.

**Stripe.** Until B4 and B5 land, I use Stripe payment links that save the card. So the charge log must accept:
- a charge I mark as already paid outside the software;
- a Stripe customer id I paste in, so later charges use the card that link saved.

**Owner texts.** Until A5 lands, I text owners from my phone.

## 5. The public site

**Build from the reference pages, not from the current site.** I like these two more than the site you built. Port their design, structure and copy, with the edits below.

- **`reference/lawn-page.html`** ("Quiet Accounts for Landscapers") is the base for the **monthly** pages: lawn and cleaning.
- **`reference/cold-email-page.html`** ("Quiet Accounts Cold Email Page") is the base for the **one-pass** pages: tree, painting and fence. It's still on the free-150 offer, so it needs every edit listed below.

**Keep from the reference pages:**
- the colors: navy `#0F2433`, orange `#F4511E`, paper `#F6F4F0`;
- the fonts: Outfit, Manrope, Geist Mono;
- the logo and the layout.

**Keep from `apps/site`:**
- the audit engine (`audit.ts`, `worker.ts`);
- the `/start` hookup;
- `trades.ts` as the per-trade data file, updated to this brief: a lawn entry, the proof order, the labels.

**Drop:** the v3 design, the five named parts, "7am to 8pm", and the forecasts and fit tiers.

**The build.**
- Today `build:site` (root `package.json`) runs `build:single`, which can't build several pages.
- Point it at `vite build`, with one `rollupOptions.input` per page.
- Import the worker without `&inline` (`apps/site/src/main.ts:4`), so it loads only when a file is dropped.

### Pages

| Path | Offer | Base | Ready by |
|---|---|---|---|
| `/` | both | new, short | Oct 9 |
| `/lawn` | monthly | lawn page | Oct 9 |
| `/tree` | one pass | cold page | Oct 16 |
| `/cleaning` | monthly | lawn page | Oct 30 |
| `/painting` | one pass | cold page | Nov 13 |
| `/fence` | one pass | cold page | built, not linked (January) |

**The front page, `/`.**
- The logo and one line: "We write to your old customers and quotes in your name. You get a text when one wants the work."
- Two cards, then the footer, and nothing else:
  - "Lawn and cleaning: past customers back on your schedule. First 150 free, then $497 a month if you say yes."
  - "Tree, painting and fence: one pass through your old quotes and past customers. $250 per booked job, never more than $1,000."
- Each card links only pages that are built. On Oct 9 that's `/lawn` and, once it's built, `/tree`.

### The rules: Becker's, plus what explee.com does well

**1. The first screen gives the result, the price and the risk.**
- The headline is the result.
- The guarantee is in the line under it, readable in five seconds.
- "Free" sits next to its price.

**2. A personal result before any ask.** This is explee's "paste your website", done our way.
- The hero holds one field, "Your company name", and the page's button.
- Pressing it doesn't send anything. The hero opens in place to show his first note, with his company and signer in it ("It's Sarah at Ridgeline Tree Co…"), and the text he'd get when someone wants the work.
- The rest of the form follows, with the same button, which sends it. Nothing is sent before that second press.
- A `?co=` link opens it already filled in.
- Each page has one form, and it's this one. The lawn page's bottom "Start here" block becomes a closing call to action whose button scrolls back up to it.

**3. Show the finished work, not features.** That's the note, the replies, the text the owner gets and the Friday report. Anything invented is labeled "Example".

**4. One action.**
- Every button on a page has the same label and leads to that one form:
  - monthly pages: "Start my free 150 →", with "then $497/mo if you say yes" right beside it;
  - one-pass pages: "Get my first note →".
- No nav menu, no header button, no second call to action, no "learn more".
- On phones, a sticky bottom bar carries the button and its price line.
- The 15-minute call link lives only in the footer.

**5. Proof, labeled.** Unedited owner texts, the label from §1, and the family disclosure wherever Dow's appears.

**6. Answer the fears in the FAQ:** my customers, my email and domain, who's writing, control, cost, cancel.

**7. No fake urgency.** No countdowns, live counters or "3 spots left". Only real timing, like "The schedule thins out once the leaves are down".

**8. Phone first.**
- At 390px wide, the headline, the guarantee and the button show without scrolling.
- One column, with tap targets of 44px or more.

**9. Fast.** No framework, plain TS. The audit worker loads only when a file is dropped.

**10. A trust footer:**
- "Quiet Accounts · 9 Carter St, Concord, NH 03301";
- text 603-340-7673;
- the 15-minute link (calendly.com/jackphilbrick/quick-question-15-min).

**Don't copy from explee:** its nav menu, its four or five different calls to action, its running total or its investor logos.

### Claims the software doesn't back: fix them on every page

- **"A person, not a bot, reads every reply."** This holds only with autoAck off (A1). Keep it.
- **"Every note that goes out is saved on your own page, word for word"** (cold page FAQ). There's no owner page yet. Cut it.
- **"All of it is deleted 30 days after the last thing that happens"** (cold page FAQ). There's no deletion job.
  - Say "Text us and we'll delete your list" instead.
  - I do that by hand with `DELETE /api/businesses/:id`.
- **"Pick the day the first 25 go out"** (both FAQs). The software doesn't do that.
  - Say "...change anything you want and text OK. The first notes go out the next weekday morning."
- **"Three short notes over about a week"** (both FAQs). Lapsed regulars get two (`copy/templates.ts:569–575`), and three notes span up to about 12 days. Say "Up to three short notes over a week or two."
- **The cancel answer.**
  - "Anything already scheduled that week still goes out; nothing after" is wrong: CANCEL stops everything at once (`core/ops.ts:781–796`).
  - Monthly: "Nothing goes out after that."
  - One pass: "Nothing goes out after that. You pay only for jobs from our notes that booked before you cancelled."
- **The example notes.** The lawn page's sample note says "a couple of open days near you", the same promise A6 cuts from the templates. Use a note the engine actually writes, rendered from the fixtures.
- **Jobber facts.** Add the "$29/month add-on" and the "up to two reminders… up to 90 days" lines to `claims.ts`, with their Jobber Help Center sources. If you can't find a line's source page, cut the line.
- **Lead costs.** Add them to `claims.ts` too: landscaping is about $118 from search ads and about $37 from Local Services ads (`docs/research/loss-evidence.md:91`).

### Monthly template (`/lawn`): edits to the lawn reference page

**The hero.**
- The line under the headline: "Done for you. Or you don't pay." becomes "Done for you. Any month nobody asks to come back, you don't pay."
- The ticks:
  - "First 150 free" becomes "First 150 free, then $497/mo if you say yes".
  - Keep "No call, no card" and "Your part: forward one email". Jobber's Visits report is one email, and it has the emails and dates.
- Under the tally: "Owner-reported. First 150 people. No comparison group."
- The text bubbles: label them "Example". Rename their customer "Tom Alvarez" to "Dan Alvarez", because Tom is Capital City's owner on the same page.
- Add the "Your company name" field (rule 2).

**The top of the page.**
- Drop the header's "Start free" button.
- The sticky bar becomes "First 150 free, then $497/mo if you say yes · Start my free 150 →".

**The comparison table.**
- The row "A month nobody asks for a price or a date" becomes "A month nobody asks to come back".
- Under the table: "Your software sends reminders going forward. We go back through everyone it never reached, and read every reply."

**Pricing.**
- The heading "Free until it's working." becomes "Free for the first 150. Then $497 a month, only if you say yes."
- The "After that" card:
  - "Any month nobody asks you for a price or a date is free." becomes "Any month nobody asks to come back is free."
  - Add "Only if you say yes after the first 150" and "We text you before every charge."
- The "What the first 150 got three shops" ranges count Dow's. Add the label and the disclosure.

**Results.** Capital City first, then Nelson Fence. Dow's card gets the disclosure, and every card gets the label.

**The closing block.** "Your first 150 are free." becomes "Your first 150 are free, then $497 a month if you say yes."

**The FAQ "Won't this annoy my customers?"** Its "The first 150 are free, so you see your own numbers before you pay anything" becomes "The first 150 are free (then $497 a month if you say yes), so you see your own numbers before you pay anything."

**New FAQs.**
- **"When do I pay, and how?"** "Nothing for the first 150. If you want it to keep going, say yes and we text you a link for the first $497; it saves your card. After that we text you two days before each month's charge, and any month nobody asked to come back, there's no charge."
- **"What counts as asking to come back?"** "Someone we wrote to asks for a date, a price or their old slot. You get each one by text, the same day."

**Remove** "Preview only: this page doesn't send anything."

### Cleaning variant (`/cleaning`): the monthly template, with cleaning words

**The headline:** "Clients who stopped booking, back on your schedule."

**The money section.**
- Headline: "You lose about 80 regulars a year."
- Body: "A cleaning company holding steady at 100 regulars loses about 80 a year and replaces them (MaidCentral: 6.89% a month). One biweekly client is worth about $5,580 a year."
- Add both figures to `claims.ts` with their sources: `docs/research/owner-complaints-brief.md` lines 369 ($5,580) and 395 (6.89%).

**The calculator:** regulars lost in the last year (80) × value per regular a year ($5,580) × 11%. The 11% is Capital City's rate, labeled "a landscaper's past customers".

**The note example:** a cleaning note the engine writes ("We haven't been by for the regular cleaning since September 1… Want us back on your usual schedule?").

**The export step.**
- Jobber: the Visits report.
- BookingKoala, Launch27, ZenMaid or a spreadsheet: "Send any export of your clients with their last cleaning date and email. We'll text you where to click."
- Only write menu paths you've checked in the vendor's help pages.

**The thank-you step:** "One question we'll text you: how many new regulars can you take this month? We pace the notes to that."

**New FAQ: "We're booked solid."** "Tell us how many you can take. We pace the notes to it."

### One-pass template (`/tree`): edits to the cold reference page

**The hero.**
- The eyebrow "Your free 150" becomes "For tree companies".
- The headline "Start your free 150." becomes "Your old quotes and past customers, booked."
- The line under it, "Your old quotes, booked. Done for you. Or you don't pay.", becomes "You pay $250 for each job that books, never more than $1,000. Nothing books, you owe nothing."
- The ticks become "No card to start", "No call, no contract" and "Your part: forward your exports (about five minutes)". With Jobber that's two emails: the Quotes report and the Visits report.
- The tally leads with Nelson Fence, with the label: CT, 150 asked, 12 wrote back, 4 booked, about $19,800.
- Keep the form-in-the-hero layout, with the button "Get my first note →".
- Remove the preview bar ("Preview · what Dave at Example Tree Co sees…") and "Preview only".

**The top of the page.**
- Drop the header's "Start free" button.
- The sticky bar "First 150 free · No call, no card · Start free" becomes "$250 per booked job, never more than $1,000 · Get my first note →".

**The calculator.**
- "If they book like Dow's quotes did" becomes "If they book like Nelson Fence's quotes did". It's the same 2.7%: 4 of 150.
- The proof line under it becomes "Nelson Fence, CT: 4 booked out of their first 150 old quotes. Older quotes book less often; your list shows your real rate."
- Add a line: "You'd pay $X, that's Y% of it", where X = min(jobs, 4) × $250. Then "plus your past customers."
- "Quote count: estimated from your public Google reviews" shows only when the link has `?q=`.

**How it works.**
- "Find every quote that never booked" becomes "Find every quote that never booked, and every past customer."
- Add "The whole list in about four weeks."

**The comparison table.** "Quotes up to four years old" becomes "Quotes up to three years old". The code stops at 36 months (`http/app.ts:165`).

**Pricing.** "Free until it's working." and its two cards become one card:
- the heading: "You pay when a job books.";
- the big line: "$250 per booked job. Never more than $1,000. Nothing books: $0.";
- "No card to start. When the first job books, we text you a link for the $250. It saves your card for the rest, and we text before every charge.";
- "What counts: someone wrote back to one of our notes and booked with you within 60 days. One charge per customer, however many jobs they book. Job cancels before the work? You get the $250 back.";
- "When it ends: when your list is done, about four weeks. No contract. Nothing renews."

**New FAQs.**
- **"Why $250?"** "Our two old-quote shops each booked 4 from 150. $250 is about a tenth of a typical tree job, and you pay it only after the customer's booked."
- **"When do I pay?"** The same as the pricing card.
- **"What if I book someone on my own?"** "Only people who wrote back to our notes count. If we text you a booking that wasn't ours, reply NOT OURS before the charge date and it's off. Already charged? Tell Jack, and if it wasn't ours, he refunds it."
- **"Is there a contract?"** "No. One pass through your list, then it's done. If your list keeps filling up, we'll offer to keep it going monthly."

**Results.** Nelson Fence first, then Dow's with the disclosure, then Capital City, labeled "a landscaper's past customers".

**The final block.** Keep "Those quotes get colder every week." Below it: "Winter is removal season. Nothing books, you owe nothing."

### Painting variant (`/painting`)

- **Words.** "Quotes" become "estimates".
- **Proof.** Nelson Fence, labeled "a fence company's old quotes: different trade, same kind of list".
- **Timing.** "Thanksgiving to tax time is slow. Fill it with estimates you already wrote."
- **Lead cost.** From `claims.ts`: "a painting request from Google search costs about $138", with its source.
- **"Why $250?"** "Our two old-quote shops each booked 4 from 150. You pay it only after the customer's booked." Name no tree job and no Dow's.
- **Calculator defaults.** From the painting entry in `trades.ts`, labeled as examples.

### The form (every page)

**Fields.** Company, Your first name, Your cell, where your jobs live (Jobber / Housecall Pro / Something else), and a consent checkbox.
- `/start` requires `consent: true` (`http/app.ts:839`).
- The reference form's `name` field maps to `/start`'s `first`.

**Consent text.**
- Monthly: "I run {Company}. Quiet Accounts can write to my past customers in my company's name and text me at this number about it. Msg & data rates may apply. Reply STOP to stop."
- One pass adds: "I'll pay $250 for each job that books from these notes (the customer wrote back and booked within 60 days), never more than $1,000. No card now."

**What the form sends.**
- Add `offer` ("monthly" or "one_pass") to the POST and to the `/start` schema. The operator alert shows it.
- Also send `trade`.
- Put the page, any `?src=` and any UTM parameters in `ref`, cut to 200 characters (`http/app.ts:843`).

**Where it goes.**
- With `VITE_SERVER_URL` set: `POST {VITE_SERVER_URL}/start` as JSON.
- Without it: Netlify Forms.
  - Give the form a static copy in the HTML so Netlify detects it, with form name "start" and a honeypot.
  - Send it with `fetch` to "/", URL-encoded, with `form-name=start`.
- Either way, the owner then sees the same "Got it. One thing left." step, with his software's export steps.

**On any error.**
- Show "That didn't go through. Text Jack at 603-340-7673."
- Make it an `sms:` link with the company filled in. Never lose the lead.

**URLs carry only business info.**
- Allowed: `?co=` (the company, at most 60 characters, escaped), `?q=` (quote estimate), `?j=` (average job) and `?src=`.
- Never a person's name, email or phone.

**Output.**
- `pnpm build:site` writes `apps/site/dist` for Netlify drag-and-drop, plus a zip.
- Send me screenshots of each page at 390px and 1280px wide.
- Don't deploy.

## 6. Done when

**Tests and words**
- [ ] `pnpm check` is green, with new tests for every item.
- [ ] `grep -rniE "7am to 8pm|money map|reply desk|ready text|every month after|year floor|money-back|risk-free|free trial" apps packages` finds nothing in text that an owner, a homeowner or a site visitor can see. Comments, tests and the claims lint list don't count.
- [ ] "price or a date" appears in no owner-facing string.

**New accounts**
- [ ] A new account has holdout 0 and autoAck off.
- [ ] It sends Monday to Friday, 7–10 a.m.
- [ ] Its SMS is in manual mode.
- [ ] It has no new-request track and no yearly plan.

**Engine**
- [ ] The Jobber Visits fixture gives 40 customers with their full history. Every lapsed one is found, and 0 active ones are flagged.
- [ ] The lawn fixture on Oct 15, Jan 15, Mar 1 and Jun 15 flags 0 active customers and plans nothing in December.

**Sending**
- [ ] A client can't plan or activate without its own inboxes.
- [ ] Each inbox's sender name is written and read back (fake Instantly).
- [ ] An inbox in a campaign the server didn't create is refused, and a reply to a cold campaign is only logged.
- [ ] The three booking-text bugs have tests.

**The one pass and billing**
- [ ] A 600-person one pass on five inboxes finishes by its date, with no holdout, rescan or top-up.
- [ ] On three inboxes, the same pass raises the alert and names the date it can meet.
- [ ] It ends with the tally and the refill check, and never mentions $497.
- [ ] Billing passes every case in B4 and B5 against fake Stripe.
- [ ] A live Stripe key is refused without `STRIPE_ALLOW_LIVE`.

**Site**
- [ ] `/`, `/lawn`, `/tree`, `/cleaning` and `/painting` are built from the reference pages, and `/fence` is built but not linked.
- [ ] Each page has one button label, no nav, the consent box, the labels and disclosures, and the postal address.
- [ ] Every "free" has its price beside it.
- [ ] At 390px, the hero button shows without scrolling.
- [ ] If you can run Lighthouse, mobile scores 90+ for performance and accessibility.

**Handover**
- [ ] STATUS.md has a "Live steps for Jack" list: env, deploy, the Stripe webhook, Instantly sender names, DNS, and turning on Netlify form detection.

At the end of each phase, send me five lines: what's done, what I need to do live, and anything in this brief that turned out to be wrong.
