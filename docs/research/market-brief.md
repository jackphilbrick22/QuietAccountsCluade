# Quiet Accounts: Product Research Brief

**v1.0 · 2026-09-30 · Head of Product · For engineering, copy and sales**

**Evidence tags:**
- **[H]** a primary source or documented product behavior.
- **[M]** credible secondary sources, vendor data or self-reported surveys.
- **[L]** anecdote or thin evidence.
- **UNPROVEN** our own estimate with no direct evidence. The product must show this label to owners.

Several research passes read pages through a summarizer, so check any quote against its source page before it goes into public marketing. Code paths are relative to `packages/engine/src/`.

## 0. Decisions this brief locks in

1. **The backlog is how we get in the door.** Every native tool only works going forward. Jobber: "Automations will not apply to any past items retroactively" and "Campaigns are not sent retroactively". Housecall Pro (HCP): "You would need to manually resend the older estimate". [H]
2. **We detect 12 types of breakage** across the chain from request to quote to job to invoice to rebook. For shops that already close well, dead quotes alone can't produce 15–20% (§8).
3. **Our quote priors are about 2x too high.** Seven of the twelve priors are UNPROVEN, and so are all the age and adjustment multipliers.
4. **We never promise "15–20%" as a recurring lift.** It appears only behind a gate, as a year-one range that separates backlog from ongoing revenue.
5. **At launch we send email only, from the contractor's own domain.** SMS needs stored written consent. AI voice stays locked.
6. **Reply handling is the part competitors can't easily copy.** Any reply stops the sequence. Only a request for a price or a date reaches the owner, by text.
7. **The owner vetoes the first batch.** This removes quotes priced to lose and realtor price checks.
8. **Proof is paid invoices plus a pooled holdout.** Email opens never count.
9. **Collections is opt-in and sent by the owner.** It stays out of lift, out of the guarantee and out of the Marketplace app.
10. **CSV import is a first-class path.** Jobber blocks Draft apps once they connect to more than 5 paying accounts. Its developer terms also say "only free Developer Apps" can be listed unless Jobber agrees otherwise ([terms](https://developer.getjobber.com/docs/legal/terms)). [H]

---

## 1. Breakage taxonomy

### 1.0 Rules that apply to every type

**Suppression.** Check at scoring time and again at send time, against live FSM data. Suppress when:
- the quote has converted, or the client has a newer approved quote, job or open request;
- `receivesQuoteFollowUps=false` (for quote plays) or `receivesInvoiceFollowUps=false` (for invoice plays);
- a client tag matches `/no campaign|unsubscrib|do not (contact|email)|dnc/i`;
- the client is on our suppression list;
- the account is commercial and the owner hasn't turned commercial on.

`receivesFollowUps` only controls Jobber's post-job survey. Treat it as a caution flag, not a hard stop.

**Owner veto before the first batch.** The system auto-flags three kinds of quote, and the owner's exclusions train future flags.
- **Priced at least 3x the owner's median for that service.** Some quotes were meant to lose: "the 'I don't wanna deal with you price' of almost 10x" (r/Construction).
- **Realtor, HOA, insurance or "3 bids" keywords.** These are often price checks: "they don't actually intend on having the work done" (TreeBuzz).
- **Bad-customer tags.**

**Stale price.** Once a quote is older than 180 days (`STALE_QUOTE_DAYS`), our notes never repeat the old number. Owners honor 30-day quotes for "six months or sometimes even a year", then re-bid. One raised a 2-year-old bid by about 15%. Another said "Everything has literally doubled". [M]

**Jobber overlap guard.** Wait until the API's `sentAt` (last send) is more than 90 days old, because 90 days is the cap on Jobber's native and custom automations. `linkedCommunications` and `nextScheduledFollowUpAt` exist only in Jobber's internal schema. If an app token turns out to be able to read them, switch to exact checks. [H]

**Kill switch.**
- Stop on `QUOTE_APPROVED`, `JOB_CREATE` or `REQUEST_CREATE`. Re-read tags and flags on `CLIENT_UPDATE`.
- Jobber has no webhook for messages or campaigns.
- Webhooks must be acknowledged within 1 second, are delivered at least once and are HMAC-signed.

**Write-back.** Notes and tags only. Never unarchive a quote or mark it awaiting response, because that could re-trigger Jobber's automations.

**Call list and capacity.** Quotes of $10k or more go on the owner's call list. When the owner is booked out, queue work until the calendar opens ("I am out over a month so there is no reason to even call them back", PWR).

### 1.1 Type matrix

Engine IDs match `assumptions.ts`. A prior is the share of eligible records that end up booked within about 90 days of a full sequence.

| Type | Detect (Jobber API · CSV · others) | Why incumbents miss it | Prior now → recommended | Play |
|---|---|---|---|---|
| **Quotes nobody answered** `unanswered_quote` | `awaiting_response`, no `jobs`. Age from `sentAt` (last send) or `createdAt`. Read `clientHubViewedAt`. CSV: `Status`, `Sent date` (first send), blank `Job #s`, and `Viewed in client hub`, which is **a date**, not yes/no | Jobber sends ≤2 reminders within ≤90 days, then its advice is "move on". Owners set "four days and 10 days". HCP stops at 3, ServiceTitan (ST) at 4, QuickBooks Online (QBO) sends none | 0.05 → **0.015–0.04** (mid 0.025); incremental 0.005–0.02. Our data: 8 of 300 booked (2.67%, CI 1.4–5.2%), no holdout. Covered California RCT: +1.3 pts on an 8.1% baseline ([NBER](https://www.nber.org/papers/w26153)) | 3 notes, then close the file, then re-queue by season. Viewed quotes go first |
| **Quotes filed away** `archived_quote` | `archived`, with `transitionedAt` as the archive time. CSV: `Archived date`. No public lost reason (`lostReason` is internal-schema only) | Auto-archive (a 90-day default is reported for new accounts [M]). The win-back campaign is paid, email-only and forward-only | 0.04 → **0.01–0.035** (mid 0.02), UNPROVEN | Same as above, but assume 2 reminders already went out. A fixed `transitionedAt − sentAt` gap means auto-archive |
| **Asked for changes** `changes_requested` | `changes_requested` with no newer quote. The API date is the last request; the CSV date is the first | The quote "becomes invisible in client hub until resent", and follow-ups skip this status | 0.15 → **0.05–0.20** (mid 0.10), UNPROVEN | Same-day owner alert with a draft revised quote. The homeowner gets a note only after the owner OKs it |
| **Said yes, never scheduled** `approved_unscheduled` | Approved quote with no job (`approvedAt`, or `createdAt` if the quote was never sent). Also unscheduled jobs and `uninvoicedTotal>0`. CSV: `Approved date` set, `Job #s` blank | Only internal dashboard prompts. "Ships passing in the night" (PWR) | 0.40 → **0.15–0.45** (mid 0.30), counted only after the owner answers "was this done?" (Y/N), since many are bookkeeping gaps. Comparison: 13–18% of signed homebuilder contracts cancel (10-Ks) [L] | Owner first, then "Want to lock in a date? We have [a real day] open near you" |
| **Asked for a price, never quoted** `unquoted_request` | Request with no quote (new, assessment_completed, overdue or archived), plus unsent drafts. The Requests CSV has no source column; join it from the Clients report | Jobber auto-archives requests, and Pipeline tasks are "internal only". 23% of firms never answered a web lead (HBR 2011) | 0.10 → **0.03–0.10** (mid 0.05), from an analog only | Nudge the owner with a draft quote. Note to the homeowner only if the request is under ~60 days old |
| **Add-ons left on the table** `declined_option` | **Jobber: API only.** On an approved quote, `optional=true` with `recommended=false` means the item wasn't included (validate on a live account). The CSV `Line items` column holds names only | Unselected options "will disappear" at conversion. On ST, a Won opportunity "no longer displays as open" | 0.05 → **0.02–0.06**, UNPROVEN | After `JOB_CLOSED`, at the trade's window: sealing 30+ days after a pour, stump after a removal, riser or filter after a pump-out, gutters after a wash, stain on a new fence |
| **Said no a while ago** `declined_quote` | **Jobber has no declined status.** Elsewhere: HCP declined/Lost, ST Dismissed, QBO Rejected | **A quote closed by software is not a customer "no".** HCP auto-expires and auto-declines estimates, and ST teams "clear the Follow Up tab daily". Anything expired, or closed with no reason, goes back to the unanswered-quote play | 0.015 → **0.005–0.015**, UNPROVEN | One "we can refresh this price" check-in after 120+ days |
| **Hired once, never back** `one_and_done` | One closed job 300+ days ago, not recurring, no open quote. Jobber's Client Re-Engagement Report is only a list | Reactivation needs the paid Marketing Suite, which is email-only and forward-only | 0.035 → **0.01–0.035** (mid 0.02). Only weak analogs (ANA: house lists respond at 9% vs 5% for prospect lists). This is the largest simulated bucket, so errors here matter most [L] | Only when the trade gives a reason: an interval, a season or a follow-on job |
| **Regulars gone quiet** `lapsed_regular` | 2+ past jobs and a current gap over 1.5x the client's median interval (minimum 45 days), or a recurring job that ended | Shows up only in reports. Jobber's "Re-engage past clients" campaign may already be running, so ask at onboarding | 0.09 → **0.05–0.12** (mid 0.08). Capital City Lawn: 17 of 150 booked (11.3%, CI 7.2–17.4%), owner-reported [L] | Pre-season "keep your regular day?", and ask why they stopped |
| **Due for service** `service_due` | Match the last job's service line to the §4 interval library. Use the technician's recommended date first, then septic tank size and occupants, then the default | No FSM has a due-date engine. Only 11% of tree firms say their plant health care (PHC) programs renew on their own (Granum poll) [L] | 0.10 → **0.04–0.12** (mid 0.08). Cochrane meta-analysis of reminders: +8 pts [M, analog] | Educational opener. After each job, ask "Want a reminder when it's due?" |
| **Next job nobody offered** `missed_upsell` | Completed service with no quote for any of its `followOns` | Nothing native does this. "I wish somebody had just told me… In fact, I did — with somebody else" (Pumper) | 0.03 → **0.01–0.04**, UNPROVEN | Follow-on offer timed to the trade |
| **Work done, not paid** `unpaid_invoice` | `invoiceStatus`, `dueDate`, `invoiceBalance`, `Invoice.linkedCommunications` (public). CSV: `Balance`, `Late by`, `Client last contacted` | **Mostly covered already**: Jobber sends 2 reminders, HCP 1–10, QBO up to 3 | 0.45 (no source) → **0.05 incremental** (0.01–0.10) at 14–60 days past due; 0.01 beyond 180 days. RCTs show +6.7, +2.7 and ~+1 pts. Xero US invoices are paid 8.5 days late on average anyway | Off by default. Follows the §6 collections rules, plus an owner-only lien-deadline alert. Excluded from lift and from the guarantee |

---

## 2. What the FSMs do and don't do

| Platform | Native follow-up | Hard limits | Backlog? | Reads replies? | Gate / price | Our ingest |
|---|---|---|---|---|---|---|
| **Jobber** | 2 quote reminders. Grow+ custom automations. Marketing Suite campaigns: "Win back lost leads", "Close on pending quotes", "Re-engage past clients" | Reminders only for awaiting-response quotes, ≤90 days, same channel and send time. Campaigns are **email-only**, one button, 15k-recipient cap. Quotes and requests auto-archive. Pipeline tasks and "quote reminders" are internal only | No | No (driven by status and date; 2-way text only on Grow) | Connect $139+. Marketing Suite $99 add-on (included on Plus). Pipeline $49 (Sept 2026) | GraphQL: Draft cap of 5 accounts, 2,500 requests per 5 min, 10k query-cost bucket. CSVs (emailed to the owner): Quotes, Requests, Invoices, Clients, Jobs, Client Communications |
| **Housecall Pro** | Pipeline resends the estimate 3 times. Campaigns | Timing is locked. Estimates auto-expire. Text campaigns reach ≤10 customers a day | No | No | Pipeline add-on (~$50). API only on MAX ($299/mo, billed annually) | Estimate list CSV (Outcome, open value, options) |
| **ServiceTitan** | Marketing Pro unsold-estimate SMS (≤4 texts). Atlas recommends. Manual CSR follow-up tab | Excludes Won and Dismissed. Needs two consent toggles. Unsold options on Won jobs are hidden | Audience-based | Stops on a call, booking or opt-out | Marketing Pro price not published (~$400–800+/mo reported) | Opportunity & Estimate Follow Up report |
| **Workiz / Service Autopilot / SingleOps** | Reminder rules | Workiz: paid add-on, future estimates only. Service Autopilot: Pro Plus $499. SingleOps: Premier $500–550 | No | No | Top tiers only; Service Autopilot has no open API | CSV |
| **Arborgold / Yardbook** | Proposal campaigns / beta reminders | Arborgold: new proposals only. Yardbook: email only; its Zapier only sees approvals | No | No | – | CSV |
| **LMN, QBO, Kickserv** | **None** for estimates | QBO estimates stay "Pending" forever. Kickserv only marks Lost by hand | – | – | – | CSV |

**None of them** works the backlog, classifies replies, spans the whole lifecycle or proves the follow-up caused the job. Vendors count any job booked after a message; Cooper Heating's "$1.8M" is counted that way. All of them are gated by plan or add-on.

Sources: [Jobber automations](https://help.getjobber.com/en/articles/automations/), [Jobber campaigns](https://help.getjobber.com/en/articles/campaigns-marketing-tools/), [HCP Pipeline FAQ](https://help.housecallpro.com/en/articles/6185346-pipeline-faqs), [HCP expiry](https://help.housecallpro.com/en/articles/7208856-estimates-configure-default-expiration-dates), [ST unsold-estimate SMS](https://help.servicetitan.com/docs/create-unsold-estimates-campaigns-using-sms), [SA pricing](https://www.serviceautopilot.com/pricing/), [SingleOps pricing](https://granum.com/singleops/pricing/), [Arborgold](https://help.arborgold.com/en/articles/new-job-automation), [Yardbook](https://support.yardbook.com/auto-estimate-reminders/), [LMN reviews](https://www.capterra.com/p/142064/LMN/reviews/), [QBO](https://www.paidnice.com/blog/estimate-follow-up-quickbooks), [Kickserv](https://help.kickserv.com/article/31-estimates).

**Unresolved:** fetches of Jobber's pricing page disagree on whether Core includes follow-ups. Ours on 2026-09-30 showed them starting at Connect. Don't claim "Core has none"; ask at onboarding.

---

## 3. Competitors and white space

| Product | What it does | Price | Setup | Guarantee | Main complaint |
|---|---|---|---|---|---|
| Jobber Marketing Suite | Template email campaigns, reviews, referrals | $99/mo add-on | Owner builds segments | None | "The customers I want the campaign geared toward are tricky to get right" |
| Jobber Teammate (beta, reported 2026-09-23 via Yahoo Finance; no help-center page yet) | AI drafts quotes and gap-filling campaigns for the owner to approve | Undisclosed | Owner approves everything | – | Too new |
| HCP Pipeline / ST Marketing Pro | Estimate resends; unsold-estimate SMS and email; Atlas AI recommendations | ~$50 / ~$400–800+ | Low / needs CSRs | None | "missed several of my leads"; "nickel and dime you for all the add ons" |
| Hatch (bought by Yelp, ~$270M) | AI CSR over SMS, email and voice; "rehash" of old estimates | $600–1,500/mo, annual | Weeks | None | "Spent 15 grand… promised 15%… didn't see any increase"; "The AI would just make things up"; sync failed silently |
| Podium / Birdeye / Broadly | Messaging, reviews, AI receptionist | $299–999, mostly annual | Moderate | Broadly: "cancel-anytime is the guarantee" | "predatory auto-renewals" |
| NiceJob / SendJim | Reviews, repeat business, direct mail | $75–125 / credits | Low | None | Only trigger on **closed jobs or paid invoices** |
| ToolDesk, Requestify, SouthSea, Carly | DIY Jobber follow-up | $35–199 | Owner sets up and approves | None | Forward-only; texting from a second number "looks… kind of scammy" |
| GoHighLevel reactivation agencies | Done-for-you SMS/email projects | Setup + ~$500/mo | Low | None | Unsourced "5–12%" and "20X" claims; "Sending is instant and scales. Answering doesn't." |

**White space:** we found no competitor that combines all of these:
- done for you;
- Jobber-first, plus HCP and CSV;
- the backlog plus the full customer lifecycle;
- timing tuned to each trade;
- 1:1 notes from the owner's own inbox;
- replies handled for the owner;
- proof taken from invoices;
- month-to-month billing with an automatic guarantee.

Lock-in is the category's top complaint, so being easy to leave is a feature in itself. Sources: [Hatch reviews](https://www.capterra.com/p/174914/Hatch/), [Yelp–Hatch](https://www.yelp-ir.com/news/press-releases/news-release-details/2026/Yelp-Accelerates-Strategy-with-Acquisition-of-AI-Lead-Management-Platform-Hatch/default.aspx), [Podium](https://www.trustpilot.com/review/podium.com), [Birdeye](https://contractortoolstack.com/software/birdeye/), [ToolDesk](https://www.tooldesk.co/jobber-sms-campaigns/), [GHL reactivation](https://github.com/guyfhh2/gohighlevel-database-reactivation), [Numa](https://www.prnewswire.com/news-releases/numa-unveils-the-first-ai-agent-platform-for-auto-dealerships-302350393.html).

---

## 4. Trade playbooks

The ticket sizes below are HomeAdvisor/Fixr consumer averages. Use them **only as a fallback**. Forecast from the contractor's own median and 75th-percentile invoice, because the public guides disagree with each other by 2–3x.

**Tree**
- **Ticket:** removal $400–1,100, trim $175–750, stump $150–300.
- **Why quotes die:** "1/3… non responsive, about 1/3 [shopped]… 1/3 or less… got someone else to do the job sooner" (TreeBuzz). Big jobs draw 3+ bids.
- **Close rates:** owners report ~33% on ad leads vs 75–85% on referrals [L]. ArboStar's average is 61% [M].
- **Triggers:**
  - Winter/dormant season: less turf damage, and a slow-season email to the client list "always gets things going".
  - **No oak-pruning nudges April–October** (UMN). `tree.prune_oak` already uses `strictSeason`.
  - Emerald ash borer (EAB) treatment runs May–June. Nudge March–May, then pitch removal afterward.
- **Upsells:** stump grinding, haul-away, PHC programs sold Jan–Mar. Offer financing only if the contractor has it enabled.
- **Angle:** "got someone sooner" is an availability problem, so offer a real open week.
- **Sample:** *"Hi Susan, it's Ryan at Dow's. Still want the dead ash by the driveway taken down? We have a crew in Bedford the week of the 14th. Thanks, Ryan"*

**Lawn / landscape**
- **Ticket:** ~$123 per visit, aeration ~$140, installs average $3,516 (range $200–14,750).
- **Main leak:** regulars who never re-sign.
- **Triggers:** Jan–Mar re-sign ("keep your regular service day"), crabgrass pre-emergent at ~55°F soil, seeding from late summer to early fall.
- **Close rates:** Jobber says lawn has the "widest variability".

**Septic**
- **Ticket:** ~$400 per pump-out, up to ~$1,100 if neglected. Owners wait because "they are afraid of costs".
- **Intervals:**
  - EPA: inspect at least every 3 years, pump every 3–5, and check alternative systems yearly.
  - Texas aerobic units require a maintenance contract, with reports every 4 months.
  - Tank size matters: a 750-gal tank with 3–5 people needs pumping about every 2 years; a 1,500-gal tank with 2 people, every 7–8 years.
  - **Fix:** `septic.pump` uses a flat 36 months. Use the technician's date first, then tank size and occupants.
- **Upsells:** risers, lids, filters. Customers take "the Band-Aid… [and] change their mind later".
- **Hooks:** SepticSmart Week (third week of September), point-of-sale inspection rules, local pump-out vouchers.
- **Angle:** *"Do you know when your tank was last pumped?"*

**Fence**
- **Ticket:** ~$3,277.
- **Why quotes stall:** permits, surveys ($200–545), HOA or height rules, neighbors. We have little owner-voice data here [L].
- **Triggers:** spring ("the install calendar fills months out"), pool-fence requirements, new homeowners.
- **Interval:** stain every 24–36 months.
- **Angle:** remove the blocker ("we can check HOA rules and pull the permit").
- **First-party:** Nelson Fence booked 4 of 150, ~$19,800 (owner-reported).

**Concrete**
- **Ticket:** driveway ~$6,400, patio ~$4,006.
- **Constraints:** a short pour window in cold weather, and permits. The stale-price guard matters most in this trade.
- **Intervals:** sealer every 1–3 years; asphalt sealcoat every 2–3 years, spring through fall.
- **Upsell:** a declined sealing line, offered 30+ days after the pour and in season.

**Pressure washing**
- **Ticket:** ~$312. Owners report 60–80% close rates when they follow up [L].
- **What works:**
  - an email on day 3;
  - a call within 24 hours of the quote being viewed ("7 out of 10 I'll close");
  - "We'll be in the area this Tuesday";
  - one blast to ~40 month-old bids "closed 5 the next day" (anecdote).
- **Deprioritize** replies that show explicit price shock.
- **Interval:** house wash every 24–60 months, **not 12** (`pw.house` is already 36). The yearly touch comes from roof, concrete and deck cross-sells.
- **Upsells:** gutters after a wash, sealing after concrete.

Sources: [TCI](https://tcimag.tcia.org/sales-marketing/a-successful-sales-process-outline/), [TreeBuzz](https://www.treebuzz.com/forum/threads/customer-interactions-with-quotes.42984/), [UMN pruning](https://extension.umn.edu/planting-and-growing-guides/pruning-trees-and-shrubs), [Penn State EAB](https://extension.psu.edu/emerald-ash-borer), [EPA septic](https://www.epa.gov/septic/how-care-your-septic-system), [Pumper](https://www.pumper.com/editorial/2026/05/septic-pumping-frequency-is-not-universal), [TCEQ](https://www.tceq.texas.gov/permitting/ossf/ossfmaintenance.html), [PWR](https://pressurewashingresource.com/community/t/follow-up-calls/18681), [HomeAdvisor fence](https://www.homeadvisor.com/cost/fencing/install-a-fence/).

**Other trades:**
- **Gutters:** every 6–12 months; guards still need cleaning every 2 years.
- **Chimney:** yearly (NFPA 211); remind May–Aug.
- **HVAC:** at the spring and fall clock changes.
- **Irrigation:** blow-out on NWS freeze alerts.
- **Pool:** open Mar–May, close Aug–Oct.
- **Snow and holiday lights:** sold Aug–Oct.
- **Cleaning:** win-back at 30–45 days.

---

## 5. Message and cadence principles

This evidence comes mostly from general and B2B email. **A/B-test every rule, and never advertise these numbers.**
1. **Plain text from a person.** Touch 1 has no links, images or tracking pixel. HubSpot found HTML-heavy email gets fewer opens and 21% lower clickthrough. [M]
2. **Short and simple.** 50–125 words, under 80 for touch 1, written at a 3rd–5th grade reading level (Boomerang, 40M emails; Instantly 2026). [M]
3. **End with one easy question.** Emails that asked 1–3 questions got about 50% more replies. [M]
4. **Honest subject lines** of 3–4 words. Never a fake "Re:" or "Fwd:" (Gmail rules, CAN-SPAM). [H]
5. **Sign off "Thanks," and a real name.**
6. **Only use facts from the record:** service, month, street, the note detail. Mention the price only if the owner opts in *and* the quote is under 180 days old.
7. **Give them an easy out.** "Just reply 'pass' and I'll close your file." Homeowners go silent because "It's easier to just not reply". Record every "pass" as a loss reason.
8. **Only honest urgency.** Offer an updated quote when the old one has expired. Mention a crew only if it really is nearby, and a filling calendar only if it really is filling. No discounts unless the owner enables them.
9. **Stop on any reply,** and get it to the owner within minutes. In InsideSales/MIT's B2B data, the odds of contact dropped 100x between 5 and 30 minutes. [M]
10. **Send weekdays 8–10am, recipient's local time.** Never 7pm–2am.

**Cadence.**
- **Fresh quotes:** day 2 (confirm it arrived), day 5–7, day 14–21, then stop. This follows TCIA's standard. Net it against Jobber's native reminders so homeowners aren't double-messaged.
- **Dead quotes:** note 1 is "Still want [job] at [street]?". Note 2 is a season, crew or phased-scope angle. Note 3 closes the file. Space them 3–7 days apart (`MAX_NOTES_PER_THREAD`=3). Re-queue at most twice a year, in season. Step 1 gets 58% of replies (Instantly).

**Why Jobber's canned follow-ups underperform:**
- They come from a shared platform sender, and they resend a link instead of asking a question.
- They go out on the same channel at the same time of day, with no sense of trade or season.
- They stop at 2 touches and 90 days, and skip `changes_requested`.
- Auto-archive and Jobber's own advice ("move on") end the thread for good.
- Nothing reads the replies.
- Campaigns are HTML templates that only run going forward.
- There's no easy "no" and no record of why a quote was lost.

Owners agree: "anything that sounded scripted got ignored."

**Banned in copy:**
- "I hope this finds you well" and "valued customer";
- a fake "Re:";
- any stat from §7's banned list;
- invented prices or dates;
- countdowns;
- posing as a customer;
- denying that the message is automated.

---

## 6. Channels and compliance: hard rules the software enforces

**Email (now)**
- **E1. CAN-SPAM.** Dead-quote and reactivation notes are **commercial email**, because the homeowner never agreed to the deal (15 U.S.C. 7702(17)). Every note needs:
  - accurate headers and an honest subject line;
  - the contractor's **postal address** in a plain-text footer;
  - an opt-out by reply ("Reply 'no thanks' and we won't reach out again");
  - DKIM-signed RFC 8058 `List-Unsubscribe` and `List-Unsubscribe-Post` headers.

  Honor opt-outs within 48 hours (the law allows 10 business days). Fines run up to $53,088 per email, and the contractor and Quiet Accounts are both liable. Whether plain notes meet the ad-identification rule is a **[COUNSEL]** question.
- **E2. Authentication.** SPF, DKIM and aligned DMARC must be in place before the first send. Gmail has been escalating rejections since Nov 2025. Microsoft rejects domains sending 5k+ emails a day with `550 5.7.515`.
- **E3. Sending domains.** Each contractor gets **one sending domain**: their real one or a clearly branded sibling. Never pool contractors on one domain, because Gmail counts the whole primary domain and bulk-sender status is permanent. Never spoof.
- **E4. Bounces.** Verify every address. Pause any inbox whose bounce rate hits **2–3%** in a day. Our B2B lists have bounced 16.1% lifetime and the Fence campaign 4 of 20, so Instantly's 5% pause threshold is too loose. Bad addresses go to the call or postcard list.
- **E5. Volume and complaints.** At most 25–30 emails per inbox per day, after 2+ weeks of warmup. Postmaster Tools hides data at low volume, so count "spam" and "who is this" replies as complaints and pause above 0.1%.
- **E6. Opens never count,** for success or for attribution.

**SMS (later, gated)**
- **S1. Consent.** Marketing texts need stored **express written consent**: the wording, timestamp and source. CTIA carrier rules require this whatever the TCPA says. **Dead quotes get no SMS by default.**
- **S2. Registration.** One A2P 10DLC registration per contractor brand, because unregistered traffic has been blocked since Feb 2025. Use one number per contractor.
- **S3. Do Not Call.** Scrub against the national DNC list at least every 31 days, and keep an internal list. The established-business-relationship exemption lasts **3 months after an inquiry** and **18 months after a purchase**. A personal do-not-call request overrides it. Treat texts as calls, even though the courts are split. Keep records 5 years.
- **S4. State rules.** Use the state of the service address:
  - baseline: weekdays 9am–7pm and at most 3 texts per 24 hours;
  - **no marketing texts to quote-only prospects in Texas** (SB 140);
  - versioned rules for FL, OK, OR, PA and TN. [COUNSEL]
- **S5. Opt-outs.** Accept any wording on any channel. Suppress within minutes, and send at most one non-marketing confirmation, within 5 minutes.

**Other channels**
- **V1. Voice.** Ringless voicemail and AI voice count as "artificial or prerecorded" calls (FCC 22-85, 24-17). They stay **disabled** unless written consent is on file. The owner can make live calls from the call list after DNC checks.
- **M1. Mail.** No consent needed, but honor do-not-mail requests. Lob postcards cost $0.62–0.91; USPS EDDM is $0.26 a piece and needs no names.
- **A1. Ad audiences.** Meta needs hashed data, a lawful basis, and opt-outs removed. Google Customer Match needs 90 days of history and $50k+ spend, so for most contractors it can only be used for exclusions.
- **I1. AI.** The AI classifies replies and drafts answers, but the only thing it sends on its own is a fixed acknowledgment. Questions about price, dates, discounts and scope go to the owner. It never denies being automated (Cal. B&P 17941). [COUNSEL]
- **P1. Platform and data.** No mass-distributed Jobber connect links, and no public announcements about Jobber before the app is Published. We act as a processor: no data mixed across contractors, and DPAs signed.

Sources: [FTC CAN-SPAM](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business), [Gmail senders](https://support.google.com/a/answer/81126), [RFC 8058](https://datatracker.ietf.org/doc/html/rfc8058), [47 CFR 64.1200](https://www.law.cornell.edu/cfr/text/47/64.1200), [CTIA](https://api.ctia.org/wp-content/uploads/2023/05/230523-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf), [state texting laws](https://www.tychron.com/guides/state-texting-laws/), [FCC 24-17](https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf), [Jobber categories](https://developer.getjobber.com/docs/building_your_app/approved_categories_of_apps/).

**Collections**
- **C1. Mode (a) only.** The owner approves each note, and it goes out unbranded from the owner's own mailbox, with replies going to the owner. **Mode (b), where AI or our staff write the notes, is a NO-GO without counsel sign-off.** CA, TX and WA laws reach anyone who writes collection forms.
- **C2. Scope.** Consumer invoices issued after the account connects, 14–60 days past due, with the last note by day 45. Email only, at most 2 notes, netted against the FSM's own reminders. The existing backlog goes on an owner-only "cash to collect" list.
- **C3. States.** **Exclude CA and WA.** In MA, only days 14–30. Quiet hours 8am–9pm.
- **C4. Stops and wording.** Stop on any dispute, "stop", attorney, bankruptcy or death. Never use "collections", "legal", "final notice", "credit report" or "lien".
- **C5. Marketplace.** Keep collections out of the Marketplace app, because "Debt Collections" is an unsupported category.

---

## 7. Numbers we may and may not cite

**We may cite these, with attribution.** This list mirrors `claims.ts`. First-party measured numbers always take priority.

| Claim | Source | Year | Trust |
|---|---|---|---|
| 47% of $10M+ contractors say estimate follow-up = 11–15% of income | [ServiceTitan/Thrive](https://www.servicetitan.com/press/residential-industry-report-2025), 1,000+ contractors | 2025 | M, self-reported, HVAC-heavy |
| Tree estimates: 61% become jobs, 39% never do | [ArboStar](https://arbostar.com/education-hub/where-tree-service-companies-actually-lose-money) | 2025 | M, vendor, n undisclosed |
| 69% report winning >50% of quotes; 36% win >70%; 20% reply within an hour (21% in tree); 59% say referrals/repeat are their top lead source | [Jobber Trends](https://www.getjobber.com/home-service-trends-report/), n=1,050, ±3pp | Dec 2025 | M, self-reported |
| 75% of recent buyers hired a pro within 2 years | Jobber Homebuyer Report, n=800 | 2026 | M |
| Repeat customers = 39% of revenue, 71% of volume | ServiceTitan Residential Report | 2023 | M |
| 23% of 2,241 firms never answered a web lead | HBR | 2011 | H, but old and cross-industry |
| Septic: inspect at least every 3 years, pump every 3–5; chimneys yearly; no oak pruning Apr–Oct; EAB treatment May–June | EPA, CSIA/NFPA 211, UMN, Penn State | current | H |
| Jobber: 2 reminders, 90 days, not retroactive. HCP: not retroactive. ST: 4 texts | Vendor help centers | 2026 | H |

**Fix in `claims.ts`:** the Jobber claims link to the homepage instead of the Trends Report, and the TCIA article is dated 2023, not 2024. For forecasting only, never marketing: the Instantly cold benchmark (3.43%), Cochrane's +8, Covered California's +1.3, HomeAdvisor tickets and the HubSpot data.

**We must NOT cite these:**
- **Sales folklore:** "80% need 5–12 contacts" and "2% on first contact" (a 1942 survey of fewer than 40 people); "44%/48% give up or never follow up"; "64/72/87%".
- **Channel stats:** "82% higher with texts"; "98% SMS opens"; HBR's 7x/60x/100x recast as win or close rates; "first responder wins 70–78%".
- **Vendor claims:**
  - Jobber: "2x faster", "80% of campaigns", "44% growth", "57% more quotes won".
  - HCP: "35%", "20%+ jobs", "400%".
  - ServiceTitan: "as high as 10%", "25% growth".
  - Hatch: "43% close days 2–30", "60% response".
  - Relentless: "5–12%", "20X". OnePath: "54%".
- **Fabricated:** anything credited to a "ServiceTitan 2024 Field Service Benchmark".
- **Other SEO numbers:** "60–70% die from silence", "217% lawn ROI", Bain's "25–95%" applied to trades, collectability-by-age tables, any financing close-rate lift.
- **Our own work:**
  - The first-150 results, unless labeled "owner-reported, no comparison group". They can't be matched to a send log: Instantly holds only 279 lifetime sends, all B2B.
  - The "Alex" proof item, which belongs to the fictional example client.

---

## 8. Forecasting inputs and fit score

**Priors.** These replace the values in `assumptions.ts`. Every dollar figure shows its evidence badge.

| Type | Now | Low | Mid | High | Evidence |
|---|---|---|---|---|---|
| approved_unscheduled | 0.40 | 0.15 | 0.30 | 0.45 | analog, after owner check |
| changes_requested | 0.15 | 0.05 | 0.10 | 0.20 | none |
| unquoted_request | 0.10 | 0.03 | 0.05 | 0.10 | analog RCT |
| unanswered_quote | 0.05 | 0.015 | 0.025 | 0.04 | owner-reported + RCT |
| archived_quote | 0.04 | 0.01 | 0.02 | 0.035 | none |
| service_due | 0.10 | 0.04 | 0.08 | 0.12 | analog meta-analysis |
| lapsed_regular | 0.09 | 0.05 | 0.08 | 0.12 | owner-reported + analog |
| declined_option | 0.05 | 0.02 | 0.03 | 0.06 | none |
| one_and_done | 0.035 | 0.01 | 0.02 | 0.035 | weak analog |
| missed_upsell | 0.03 | 0.01 | 0.02 | 0.04 | none |
| declined_quote | 0.015 | 0.005 | 0.01 | 0.015 | none (always empty on Jobber) |
| unpaid_invoice | 0.45 | 0.01 | 0.05 incr. | 0.10 | RCTs; excluded from lift |

`AGE_DECAY` and all `ADJUST` multipliers are UNPROVEN. Remove the ×1.25 age boost on fresh flow in `forecast.ts:196` until we have measured age buckets.

**Math.** Lift = Σ(rᵢ·Vᵢ)/R.
- R is trailing-12-month *paid* revenue.
- Vᵢ is the reachable dollars for breakage type i, after suppression and verification.
- rᵢ is the recovery prior for that type.
- For dead quotes alone, lift = r·(1−c)/c, where c is the close rate by value.

Recovery rate needed for a 15% lift from dead quotes alone:

| Close rate c | Recovery rate r needed |
|---|---|
| 35% | 8–11% |
| 50% | 15–20% |
| 70% | 35–47% |

Our measured rate is about 2.7% by count. We also ran the engine's *simulated* buckets, which are assumptions, not measurements:

| Shop | Priors | Year one | Steady state |
|---|---|---|---|
| Tree, 50% close | current | 29.8% | 11.6% |
| Tree, 50% close | mid | 16.9% | 6.7% |
| 70% close | mid | 11.5% | 4.7% |

**A reliable recurring 15–20% is not supported.** Most of year one is backlog.

**Fit score (the Breakage Audit, run on the contractor's own export)**
- **Inputs:**
  - R, from 10+ paid invoices over 12+ months. Never an owner-stated figure.
  - Close rate by value.
  - Vᵢ by type and age bucket (0–90 days, 91–365 days, 1–2 years, 2+ years).
  - Share of email addresses that verify as deliverable.
  - Lead-source mix.
  - Schedule density.
- **Lift bounds:** L_low = Σr_low·Vᵢ/R and L_mid = Σr_mid·Vᵢ/R. Invoices are excluded, and each bound is split into backlog and ongoing.
- **Tier A** requires all four:
  - L_mid ≥ 15%;
  - L_low ≥ 8%;
  - dead-quote V (unanswered + archived + changes_requested, 21 days to 36 months old) ≥ 1.5R;
  - warm non-quote V (approved_unscheduled + unquoted_request + service_due + lapsed_regular) ≥ 0.4R.

  A Tier A shop may be shown "X–Y% in year one, Z% of it one-time backlog". Never show "reliable 15–20%" or any recurring percentage. In simulation, 50%-close tree, lawn, septic and pressure-washing shops pass, fence is borderline, and no 70%-close shop passes.
- **Tier B** qualifies for the guarantee and is shown in dollars only. It requires Σr_low·Vᵢ ≥ 3× the annual fee ($17,892) and at least 150 reachable people.
- **Everyone else** gets the free audit only. Store the gate inputs so "we screen for fit" is a true statement. This replaces the "likely ≥ 8" rule in `fitCheck`.

**Calibration**
- Log type, age bucket, trade, channel and holdout flag on every homeowner lead, and report Wilson confidence intervals.
- Detecting a change from 1.2% to 2.7% needs **~1,331 per arm**. Pool holdouts across shops, and shrink per-shop rates toward the pooled rate.
- Use a **staggered start**: a random 10% of records begins 30–60 days late.
- `attribution.ts` calls 150+ "solid". Reserve "solid" for pooled arms of 1,000+ (Braze guidance), and label per-shop results "early" from N ≥ 50.

---

## 9. The owner's voice

**Verbatim**
- "I hate doing follow-ups for quotes… it makes me feel awkward… But I don't feel awkward about it because I'm not doing it personally." (Daniel Holliday, Grizzly Tree Experts, [Jobber Academy](https://www.getjobber.com/academy/quote-follow-up-email-templates/))
- "Feels like I am losing jobs not because of price but because I am bad at following up." ([r/sweatystartup](https://www.reddit.com/r/sweatystartup/comments/1sq13uo/lost_another_job_because_i_forgot_to_follow_up/))
- "If they want you they'll call you." … "But it does suck when it's a good sized job during a slow period." (PWR)
- "you're out mowing, driving, answering calls, dealing with weather, and the follow-up gets forgotten" (r/lawncare)
- "Email blast was to about 40 and closed 5 the next day." ([PWR](https://pressurewashingresource.com/community/t/need-help-staying-organized/19385))
- "The one contractor who did follow up quickly got my business even though his price was slightly higher." (homeowner, [r/HomeImprovement](https://www.reddit.com/r/HomeImprovement/comments/1qjhtbr/why_do_contractors_ghost_after_giving_estimates/))
- "People reallllly don't like talking to AI receptionists… I turned it off after about a week." (r/askplumbing)
- "Own your own stuff. Always." (r/smallbusiness)
- "we picked up 4 jobs from people that had already gotten a quote and just never got back to us" (David, Nelson Fence, named with permission)

**Use:**
- "quotes that went quiet"
- "nobody asked again"
- "people who want the work"
- "asked for a price or a date"
- "from your office email, in your words"
- "you own every reply"
- "cancel by text"
- "measured on jobs in your Jobber"
- "not lost on price; nobody answered"
- the trade's own words: bids, estimates, old quotes

**Avoid:**
- "AI-powered" as the headline
- "leads" on its own, which recalls Angi's "ghost leads"
- campaign, blast, drip, nurture
- "nothing left on the table" and "never lift a finger" (the owner still has to call people back)
- "guaranteed 15–20%", "risk-free", "money-back"
- astroturf forum stories

---

## 10. Offer, guarantee, attribution and claims

**The Hyros lesson.**
- **Keep** what works: a specific promise on the same inputs, measurement on real sales, done-for-you setup.
- **Fix** the credibility gap. Hyros says "you don't pay. Period.", but its terms require a written request within 90 days, a chargeback voids the refund, and plans auto-renew. Reviewers call it "a lie".
- **Our rule:** the guarantee is calculated from our data, not something the owner has to claim, and it matches the contract.

**Copy (lint-clean).**
- Main line: *"Every quote that went quiet gets followed up — from your office email, in your words. We text you the homeowners who want the work. Measured on jobs in your Jobber, not opens or clicks."*
- **Tier A only:** *"For companies that qualify, we aim to add 15–20% in the first year, mostly by winning back your backlog of quiet quotes. Before you pay, we show a conservative forecast from your own numbers. Results depend on how many quotes went quiet, your prices, your season and how fast you call back."*
- **Terms:** $497/mo, month to month, no setup fee. Cancel in one click or by text, or pause while booked out.
- **"First 150 quotes free":** state up front whether a card is needed, that it converts to $497, and what counts as a quote (16 CFR 251.1).

**Quiet Month Guarantee.** Never call it "money-back": 16 CFR 239.3 reserves that term for a full refund on request.
- The promise: *"If in any billing month not one homeowner replies asking for a price, a visit or a date, that month is free. We check it and credit it automatically."*
- **Counts:** replies classified as price_request, date_request, visit_request or yes.
- **Doesn't count:** auto-replies, opt-outs, "went elsewhere", wrong person.
- **Optional 90-Day Floor:** if traced jobs add up to less than 3× the fees paid by day 120, we refund the difference.

**Attribution (published as "How we count").**
- **Match keys, strongest first:**
  1. the same quote approved or converted;
  2. Jobber client ID;
  3. property plus name;
  4. email;
  5. E.164 phone;
  6. normalized address plus last name.
- **Tiers:**
  - **Traced:** the homeowner replied, or the same quote converted. 180-day window.
  - **Came back after our note:** no reply, but a match within 90 days. Shown separately and **excluded from ROI and the guarantee**.
  - **In conversation.**
- **Value:** the *paid* invoice amount, clawed back on refunds. One credit per job; the last touch wins.
- **"Not ours" button:** removes a line immediately.
- **Incrementality:** comes from the pooled holdout.

**Claim rules (extend `lintMarketing`).**
- Have a reasonable basis *before* publishing any claim. The FTC order against HomeAdvisor cost it up to $7.2M, in part over lead-to-job rates it couldn't substantiate.
- Show testimonials next to the median result and n. "Results not typical" alone fails 16 CFR 255.2(b). Disclose any perks given for testimonials. No AI-written or composite testimonials (16 CFR 465).
- No "up to N%" without the typical figure beside it. No countdowns. No territory claims we don't enforce. No "risk-free". The FTC has said "There is no AI exemption".
- **Case-study format (illustrative numbers):** *"537 quiet quotes → 31 asked for a date → 19 booked → $41,380 paid in 90 days, traced job by job. Median across n tree companies: $__."*

---

## 11. Prioritized features

**Must (v1)**
1. **Dual ingest.** A Jobber OAuth app (≤5 accounts while in Draft) plus CSV mappers:
   - Jobber: Quotes, Requests, Invoices, Clients, Jobs, Client Communications;
   - also HCP, ST, QBO, Kickserv, LMN, Aspire, Yardbook, ArboStar.

   Store both `firstSentOn` and `lastSentOn`. Start App Review prep now. *Evidence: 5-account cap; free-app clause.*
2. **Status normalizer.** Separates quotes the software closed from quotes the customer declined. *Evidence: HCP expiry, ST Dismissed.*
3. **12-type detector** with the global exclusions and the owner veto screen. *Evidence: §1.*
4. **Backlog sweep plus always-on,** with the 90-day Jobber guard and the webhook kill switch. *Evidence: no native tool touches the backlog.*
5. **Reply agent.**
   - Classifies replies as price, date, yes, question, not now, went elsewhere, objection, wrong person, stop, dispute or attorney.
   - Any reply stops the sequence. Hot replies go to the owner by SMS with tap-to-call.
   - Writes loss-reason notes back to the FSM.

   *Evidence: "Answering doesn't [scale]"; Hatch's AI made things up.*
6. **Copy engine and linter.** Grounded fields only, CAN-SPAM footer, stale-price guard, banned phrases and stats.
7. **Deliverability guardian.** Per-client domain, SPF/DKIM/DMARC checks, address verification, bounce and complaint circuit breakers, daily caps, seed tests. *Evidence: Gmail and Microsoft enforcement; our 16.1% bounce rate.*
8. **Cross-channel suppression and consent ledger,** synced to Jobber and Instantly.
9. **Recovered Ledger,** with a Monday proof text, a monthly statement and a "Not ours" button. *Evidence: 37% of contractors cite unclear ROI (ServiceTitan AI survey).*
10. **Breakage Audit and fit gate,** with tier rules, the backlog/ongoing split, evidence badges and the new priors. *Evidence: FTC v. HomeAdvisor.*
11. **Pooled holdout with staggered start.**
12. **Automatic Quiet Month engine,** with month-to-month billing and cancel in one click or by text. *Evidence: lock-in is the category's top complaint.*
13. **SMS-first owner interface.** Approvals, veto, "was this done?", and a 3-line weekly report. *Evidence: "running back to the truck to do it on the laptop isn't always an option."*
14. **Trade fixes.** Septic intervals from tank size and the technician's date; a working capacity throttle.
15. **Collections locked down.** Off by default, mode (a) only, state gate, 14–60 days past due.

**Should**
16. Scoring on viewed date, lead source, value, age, past-customer status and season. Report revenue by lead source.
17. Route-density offers that match scheduled visits to nearby dead quotes.
18. Speed-to-lead monitor on new requests.
19. Interval library with a post-job reminder opt-in, plus a lapsed-program detector (PHC, aerobic, pest, snow, lighting).
20. Route price objections to a phased scope, or to financing if the contractor has it enabled.
21. Sync-health monitor. *Evidence: Hatch's silent API failure.*
22. Onboarding questions about Jobber Campaigns and Mailchimp overlap. Ask Jobber for read access to `commsCampaigns`, `lostReason` and `linkedCommunications`.
23. Capture quotes that live outside the FSM (forwarded email, screenshot, notebook photo).
24. Owner-only lien-deadline alert (CA, TX, FL).

**Later**
25. SMS: consent kit, 10DLC setup service, DNC scrubbing, state rules pack.
26. Postcards for big quotes; EDDM to neighbors.
27. Storm and freeze triggers.
28. Meta audience sync.
29. Home-sale triggers.
30. Performance plan: a share of paid, traced invoices, capped at $497.
31. Public "State of Quiet Quotes" benchmark, with n and interquartile ranges.

---

## 12. Verify before relying on
- Jobber Core follow-ups.
- The 90-day auto-archive default and the Jan 29, 2026 cutoff (seen in a snippet only).
- A primary source for Jobber Teammate.
- Whether app tokens can read `linkedCommunications` and `lostReason`.
- Whether unarchiving a quote re-triggers Jobber's automations.
- Jobber's terms for paid apps.
- When the FCC's order on revoking consent is published.
- California DFPI's 90-day servicer exemption.
- A counsel opinion on collections and on the CAN-SPAM ad-identification wording.