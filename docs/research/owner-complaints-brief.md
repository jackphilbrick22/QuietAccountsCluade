# Quiet Accounts decision brief: Tree, Fence, Painting, Cleaning

**Date:** 2026-09-30. **For:** the product lead. **Built from:** the tree, fence, painting, cleaning and nurture-tools sweeps, the SMS-legality and where-quotes-live gap-fills, and the adjacent-industries research at `/tmp/claude-0/-home-user-QuietAccountsCluade/df31b6b3-e55e-5a1b-af55-9ebad860a767/scratchpad/`, which covers the sweep JSONs and `pitch-research-adjacent-industries.json`.

**Evidence tags**
- **[O]** owner or operator voice
- **[B]** buyer or homeowner voice
- **[D]** vendor doc or pricing page, used to state what a product does
- **[V]** vendor, marketer or builder claim
- **[S]** seen only as a search snippet because the page was blocked
- **[A]** our own arithmetic on the cited numbers
- **[U]** unverified

Before any quote goes into public copy, re-check it on its source page. Some passes read pages through a summarizer. Reddit in 2025–26 is full of vendor posts disguised as owner posts (ArboStar shills in r/arborists, tool builders in r/CleaningBusiness and r/FenceBuilding). Those were discounted or flagged.

---

## 0. Decisions this brief supports (one screen)

1. **The wedge is the backlog plus the follow-through, not the send.**
   - Every native tool runs forward only and stops early.
     - Jobber: "will not apply to any past items retroactively" and "Campaigns are not sent retroactively" [D].
     - Housecall Pro (HCP): the estimate must "fall within the automation cadence you currently have set" [D].
     - PaintScout: "A follow-up will not send if it is added after the estimate has already met the trigger condition" [D].
   - The core promise is: sweep the backlog on day one, follow every quote to an explicit yes or no, read and answer every reply, and text the owner the hot ones.
2. **Launch order: Tree first, Cleaning second, then Fence and Painting once "send us whatever you have" intake exists.**
   - Jobber is the top tool in tree:
     - 33% of forum owners (9/27)
     - 7% of Google Maps listings
     - 554 Jobber-confirmed tree leads already in the bank
   - Jobber is nearly absent in fence (1/25 owners, 3% of websites) and painting (0/12 owners, 1/82 websites). Those quotes live in Fence Cloud/CFS, QuickBooks, invoice apps, Excel, paper, PaintScout and DripJobs.
3. **Channel reality: launch email-first from the contractor's own name and domain. SMS only where it is lawful.**
   - SMS is fine for:
     - the one reply to a homeowner who texted first, called and was missed, or used a form with an SMS disclosure
     - updates on approved jobs
     - alerts to the owner
   - Quote follow-up by SMS needs the consent captured at request time. WA, MD and OK require it, and carriers require it for 10DLC registration.
   - Old-quote sweeps and rebooking default to email plus postcard.
   - "Texts from your own number" works only for VoIP or landline numbers (hosted SMS). It does not work for a personal mobile or a Google Voice number.
4. **Correct one claim in our copy.**
   - Do not say "no tool reads and answers replies". Jobber's AI Receptionist ($29/mo for 30 conversations) "answers every text sent to your dedicated phone number" [D].
   - The true claim: nothing in the owner's stack reads the *email* replies to quotes, chases every quote to a yes or no, turns "not now, try spring" into a dated follow-up, or tells the owner which replies are ready to buy.
5. **Do not promise a recurring 15–20%.**
   - Our internal measured recovery is about 2.7% by count (`/home/user/QuietAccountsCluade/docs/research/market-brief.md`).
   - Simulated year one is mostly backlog: a tree shop at 50% close shows 16.9% in year one vs 6.7% at steady state on mid priors.
   - Sell dollars and jobs, and split the backlog from the ongoing flow.
6. **Keep these out: AI voice, estimating and takeoff, scheduling, invoicing, blasts, review requests, auto-discounts and financing terms in messages.** Section 3 explains why.

---

## 1. The breakage map

The dollar logic uses sourced tickets and lead costs. Arithmetic is marked [A]. Where a claim has no primary source, the table says so. The fee reference is the $497/mo offer used in the market brief.

### TREE (Jobber, Arborgold, SingleOps, ArboStar, paper bid books)

| Leak | How it happens in tree | Evidence | Dollar logic |
|---|---|---|---|
| **T1. Calls and requests unanswered while climbing, and in storm surges** | The estimator is on a rope or saw all day and callers hang up. Storms bring hundreds of calls in days. Jobber gives a web request only "an email copy", and its only request automation is auto-archive. The Receptionist is an inbound-only add-on. | "Over 50% of the callers won't leave a message." [O] Kessler, TreeBuzz 2018 · "we are not quite ready for an office person yet but I feel like we are missing leads" [O] · Rogue Tree: "roughly 200 to 300 calls" in 2 weeks after the June 2022 storms (Daily Record) · Buyer: "less than 24 hours into this and have 4 quotes and have decided on a company" [B] r/homeowners 1wolwfe | Each silent caller wastes the lead fee already paid (HomeAdvisor ~$18–30/lead [O], 2016; LSA $25–75 [V] Tree Traction) plus the job (Angi average removal $750; owner/buyer-posted jobs $1,200–$7,000). No primary source says what share of calls is lost. |
| **T2. Silent quotes after the site visit** | Follow-up happens at night or never. Built-in tools are capped and tier-gated:<br>• Jobber: 2 follow-ups, Connect+ ($139)<br>• SingleOps: 1 at 0–30 days, Plus+ ($350+) [S]<br>• Arborgold: email-only, Professional+ ($299+ with an annual contract)<br>• HCP: 3, fixed timing, not retroactive<br>• Aspire: none<br>Jobber auto-archives quotes left in "awaiting response". | "the most annoying thing is still following up on sent estimates… in the evening you lose time checking who replied and who didn't" [O] (the thread may be marketing) · "endless treadmill of bids" [O] Cafferky, TreeBuzz 2026 · Industry norm is a text the same day and a call at 5 business days (TCI/Mayer Tree) | Buyers collect 3–10 bids. Forum win rates of 20–30% are only a snippet [S/U]. At 400 estimates a year (TreeBuzz) and a 25% win rate, about 300 quotes a year end without a win [A]. One revived $1,800–$3,800 job covers 4–8 months of the fee [A]. |
| **T3. Proposals that never arrive** | The FSM sends from one shared email sender and reports "sent" whether or not it was. The owner thinks he is being ghosted. | "only received by the client about 50% of the time… we've lost tens of thousands of dollars… popup that says 'email sent successfully' whether or not" [O] Arborgold, Capterra 2023 (one reviewer) | That owner reports tens of thousands lost. No base rate across tools. |
| **T4. Price shock and multi-bid losses with no second conversation** | Bids for the same job differ by 2x. Nobody asks why or offers phasing (remove now, grind the stump later). No FSM captures the loss reason. | $3,200 vs $7,000 for the same job · "king's ransom" [B] · "Got bids for 1200 bucks… did it myself" [B] · a Jobber Community user asked for declined-with-reason [S] | With spreads that wide, "too high" is often about scope or inclusions. No source gives a recovery rate. |
| **T5. Deferred buyers never recontacted** | "Wait till it dies" buyers, budget next year, 30-day expiry. Tools stop at 30–90 days. | "I'd wait to see if it starts to die" [B] · "short on cash… This year we had the money" [B] · "My estimates are set to expire because of people just like you." [O] · "I had a guy respond to a quote five years later. I didn't respond back." [O] | The job goes to whoever is in front of the buyer when they are ready. A dead tree can "triple" the price [O]. |
| **T6. Yeses lost in the backlog** | 8-week to 3-month backlogs, and storms push schedules back. Nothing keeps a long-dated yes warm. | "series of storms that put the schedule back by 3 months… sometimes you loose clients/contracts" [O] · a homeowner cancelled when the crew was 2.5 months out [B] | A signed job lost means the full ticket plus the estimate visit. |
| **T7. Replies nobody reads** | SingleOps routes replies to the sending rep [S]. Jobber emails go to a designated team member. The rep is in the field. | Same "evening… who replied" line | Hot replies go cold. No source for the share. |
| **T8. Pruning and PHC cycles not worked** | Mature trees need pruning every 3–5 years (Davey) and PHC renews yearly.<br>• Arborgold renewals: Professional+, batch print or email, no documented chase of non-responders.<br>• Jobber campaigns: an email-only add-on, not retroactive. | "We used to have 75+ leads a month… down to 5… surviving off referrals and repeat customers." [O] r/arborists 2025 · "when it's a referral bid, I'm licking my chops" [O] | A past customer costs no lead fee. Paid estimates reportedly close near 100% [S/U]. |
| **T9. Automations paid for, never switched on** | Tiers cost $300–550/mo, contracts are annual, setup is abandoned. | "learning curve was so steep we ended up abandoning it" [O] ArboStar Capterra 2025 · SingleOps "a week of tutoring… still displeased" [O] | The owner pays for a follow-up engine that sends nothing. |

### FENCE (Fence Cloud/CFS, QuickBooks, invoice apps, Excel, paper; Jobber is rare)

| Leak | How it happens in fence | Evidence | Dollar logic |
|---|---|---|---|
| **F1. Missed calls and web requests while installing** | The owner is on the auger. He triages voicemail once or twice a day. Jobber has no request follow-up, only auto-archive. | "when I'm installing or making gates, I can't do estimates and paperwork" [O] · "Other companies don't return calls, emails, texts promptly." [O] · "ghosted by literally every company that does… fence/deck installation" [B] · secondhand $4k job lost mid-build (the post pitches a tool) | Tickets are $3,277 (Angi average) to the $7k–16k seen in owner posts. No source for the share of calls missed. |
| **F2. Quote sent days late** | Takeoffs are done at night by hand or in Excel. | A homeowner still waiting Friday for Wednesday's estimate [B] · "may be a few days until you can send a quote" [O] · "didn't followup at all. So I then did the work myself." [B] | A job lost before the price was ever seen. |
| **F3. One or two nudges during a multi-week decision** | Buyers get 3 bids, check with the spouse, pull money together, check the HOA. Jobber stops at 2 follow-ups; HCP resends the same PDF 3 times, then auto-declines. | "no one wants to drop 7k on the spot… then I lose to the big boys on the follow up" [O] · "spend hours on diagram and estimate, get ghosted" [O] | Owner-reported close rates run 30–75%. At one shop's 20–30 quotes a week in spring and a 30–40% close rate, 12–21 quotes a week don't close, worth $84k–147k of *quoted* value at $7k [A]. That is quoted value, not recoverable value. |
| **F4. Last season's bids never revived** | Northern shops shut down for winter. HCP is not retroactive. | "1 follow-up on a bid i put in last year" [O] · "I only have 6 months to make my living for the year." [O] | Demand that wakes on its own proves the value of a spring sweep. |
| **F5. Stale-price exposure** | Jobber quotes "don't expire in client hub" [D]. Steel and aluminum tariffs rose to 50% (June 2025), and lumber keeps moving. | "any previous online estimate is useless" [O] · hard costs "up by 5-10%" per job [O] | 5–10% creep on a $7k job is $350–700 of margin per revived quote [A]. |
| **F6. "Yes, but" stalls (HOA, permit, survey pins, insurance date)** | No CRM stage or clock for these. Permits are often pushed onto the homeowner. | "They did [the permit] and we paid a deposit immediately." [B] · surveyors require prepayment [O] | The deal sits in limbo with no owner. |
| **F7. Approved, but no deposit, no date and no contact** | The deposit gates the schedule. Jobber's "Convert to Job" is manual. Owners booked 6 weeks out have no office staff. | "booked 6 weeks out… roughly 30 people patiently waiting. I have no office staff" [O] · "not communicate at all… gave the business to a family connection" [B] | 30 waiting jobs is about $98k at Angi's $3,277, or about $210k at a $7k ticket [A]. That is signed work riding on silence. |
| **F8. Booked-out losses** | The owner says "full" or goes quiet instead of pre-booking with a deposit. | "Ive lost jobs because we are slammed packed with work." [O] | Jobs lost at peak demand. |
| **F9. Sticker shock and DIY** | One big number and no options. Jobber/Wisetack financing needs $12.5k/mo revenue and 10+ reviews [D]. | "$16k… did it myself for under 5k" [B] · "everyone is shocked at the price" [O] | — |
| **F10. Bad-fit ghosting and missed reschedule messages** | Owners ghost bad fits on purpose. Reschedules go by ad-hoc text. | a bad review from a missed reschedule message [O] | Damage to reputation. |
| **F11. Past customers and referrals not worked** (hypothesis) | Treated as one-and-done. | ">50% of my business was referrals from the previous season" [O] | Thin evidence, so test it. |

### PAINTING (PaintScout, QuickBooks, DripJobs, Estimate Rocket; Jobber rare)

| Leak | How it happens in painting | Evidence | Dollar logic |
|---|---|---|---|
| **P1. Estimates left on read** (the biggest leak) | Estimates are written after work. Buyers collect 3+ bids and never tell the losers. | "win rate of 24.75%" at 4–12 estimates a week [O] · "We get Maybe 3 calls a year from people declining. They just don't and never have." [O] · "I don't really care to follow up usually" [O] | At 4–12 estimates a week and a 24.75% win rate, 3–9 estimates a week are lost, almost all silently [A]. At Angi's $3,178 average exterior that is about $9.6k–28.7k of quoted value a week [A]. |
| **P2. Discount reflex** | The only "follow-up" is a price cut. | "offering to cut up to 30-40% from the original price" [O] r/smallbusiness | On a $10k job, $3–4k of margin leaks even when the job is won [A]. |
| **P3. Old, archived and rejected bids that still convert** | DripJobs: archiving means "No Drips or further communication" [D]. PaintScout is not retroactive and skips estimates once they are viewed [D]. | "a customer call me today to set a date for a bid I gave them 2 years ago" [O] | The value of a back-catalog sweep reaching back 24+ months. |
| **P4. Budget-gap losses** | Nobody offers "worst sides now, the rest in 6–12 months". | "didn't realize it was a 20k job and budgeted… 10 to 15k" [O] | A phased job keeps part of the ticket. |
| **P5. Lost to whoever responds first** | Booked-out painters are slow to estimate. | "called a week later they'd already hired someone" [O] · "Remember: you are the last person they called." [O] · "3 months for a painting company to come over and give me an estimate" [B] | — |
| **P6. Replies handed back to the busy owner** | DripJobs: "When the lead replies, the drips stop and you take over" [D]. Jobi AI only drafts. After-hours replies "stay in DripJobs" [D]. | "Replying to all the emails you let go too long." [O] | The warmest moment is exactly when the system goes quiet. |
| **P7. Seasonal dead zone** | Exterior season runs roughly May to Sept/Oct in cold climates. Exterior bids pushed "to spring" are forgotten, and interiors are never sold to exterior clients. | "Thanksgiving to tax time we're pretty much dead in the water" [O] · "people are surprised that we do interior painting if we paint their exterior" [O] | Winter backlog left unfilled. |
| **P8. Approved jobs stall, leaving schedule gaps** | "Family stuff, money stuff" delays. | "My month is booked but everyone is delayed or stalled." [O] | Crews sit through an idle week. |
| **P9. Paid shared leads burned** | Owners either make one fast call or pile on. | Angi "$50-$159 for 1 lead" [O] · "7 out of 10 will ghost you" [O] · "10 phone calls in 10 minutes" [O] · "$80k a year" HomeAdvisor at a $1M painter [O] | Owners pay for every shared lead whether or not it answers. |
| **P10. Repaint and restain cycles never worked** | Tools stop at a review request. DripJobs blasts land in Promotions "by design" [D]. | Decks 2–3 years, wood siding 3–7, exterior 5–10, interiors 3–10 (Fixr/HomeAdvisor); HOA condos about every 5 [O] | A marketer says "painting is one of the weaker verticals for this" [V]. Treat this as a "should", not the headline. |
| **P11. Canned copy and silent tool failures** | "Emails in the campaigns should be generic" (Estimate Rocket docs) [D]. | DripJobs 6am sends, duplicates and missing messages [O] · Estimate Rocket can't list estimates never viewed [O] | — |

### CLEANING (Jobber, BookingKoala, Launch27, ZenMaid, MaidCentral)

| Leak | How it happens in cleaning | Evidence | Dollar logic |
|---|---|---|---|
| **C1. No instant two-way reply** | Buyers message several companies and the first reply wins. How the tools handle a new inquiry:<br>• ZenMaid: a "Pending tab… that you have yet to contact", and one-way SMS [D]<br>• Jobber: the acknowledgment "can only be sent via email" [D]<br>• Launch27: emails the owner [D]<br>• MaidCentral: texts "only… during business hours" [D] | "10 cleaners and one full time back office agent, but we still miss calls" [O] · "every company acted like they were too busy" [B] · an LSA call booked in "12 minutes" [O] | Lead cost: LSA $60–100, PPC $40–60 [O]. |
| **C2. Quotes die after one price** | ZenMaid has no estimate follow-up at all. Jobber stops at 2. The walkthrough requirement adds another step where leads drop. | "lost probably 75% after the quote" [O] · "as soon as I give them a rough estimate… ghosted" [O] | At $60–100 per lead, three of every four quoted leads are paid for and lost (one owner's figure) [A]. |
| **C3. Objections end the thread** | "Too expensive" and "ask my husband" get no second touch. BookingKoala blurs lead details on anything below the $197 Premium plan. | "nothing like paying for these leads and losing them due to 'it's to expensive' or 'let me speak to my husband first'" [O] · "pay for the highest monthly package at $197… to see the details of leads that you have already paid Google" [O] | — |
| **C4. Booking abandonment** | Leads are sent off to "book online" and never do. | "knocks my booking rate down to like 50%" [O] | — |
| **C5. One-time, deep and move-out cleans never converted to recurring** | BookingKoala's "One-Time to Recurring" funnel is a list of people to phone [D]. | "we don't really track the retention as much as we should" [O] | One biweekly client at $214.60 a visit is about $5,580 a year [A]. |
| **C6. Recurring clients lapse quietly** | ZenMaid marks a client "Former" only after 6 weeks and sends one Pro Max email [D]. Owners find lost clients through CSV exports into ChatGPT [D]. | MaidCentral index: churn of 6.89% a month (7.54% at small companies) [V, 150K+ cleanings/mo] | About 57% of a recurring book is gone in 12 months unless replaced [A]. On 90 clients that is about 6 a month, or about $34k of annual run-rate lost each month [A]. |
| **C7. Replies vanish** | ZenMaid texts come from a do-not-reply number whose replies "may not be delivered at all" [D]. MaidCentral sequences keep firing after a reply [D]. | Clients block the number (Capterra, paraphrased) | — |
| **C8. Old estimates and dormant clients** | No tool sweeps the backlog. | "1,000 old contacts… previous customers, old estimates and people who had asked… but never booked" [O] | — |
| **C9. Owner capacity** | The owner is the office, the quoter and often a cleaner. | "every time I make my systems more efficient… we gain more clients and I'm overwhelmed again" [O] · cleaning is "always supply constrained" [O] | We need a booked-out mode, or we book work they can't staff. |

**Cross-trade speed gap.** Jobber's own 2026 survey says "over 55% expect a response within the hour" but only "20% [of pros] respond within the hour", 26% in cleaning [V].

---

## 2. Why the existing tools fail, in owners' words

### Nine structural reasons that hold across tools

1. **Follow-ups are capped.**
   - Jobber: 2.
   - HCP: 3, then it auto-declines the estimate.
   - SingleOps: 1.
   - Estimate Rocket: 5 canned emails.
2. **Follow-ups are tier-gated.**
   - Jobber Connect: $139.
   - SingleOps Plus: $350+.
   - Arborgold Professional: $299+.
   - PaintScout: custom follow-ups are in a $1,999 success package.
   - BookingKoala: $197.
3. **Automations only run forward, so the backlog never gets touched.**
4. **Sending is automated; answering is not.** "Sending is instant and scales. Answering doesn't." [V agency-side]
5. **Copy is canned or AI-sounding.** "anything that sounded scripted got ignored" [O].
6. **Channels are blocked.**
   - Email-only campaigns.
   - 10DLC and EIN hurdles.
   - HCP marketing SMS is "Opted Out by default" [D].
7. **Leads that never enter the FSM get zero automation.** "It is sooo annoying putting leads into the software." [O]
8. **Setup is left to the owner.** "I've got questions about how peopls set triggers… in jobber" [O]. "front-loaded work… Pay a marketer" [O].
9. **Tools report activity and lock owners in, but never report booked jobs.** Podium, Hatch and Workiz contracts; HCP add-on stacking.

### "You thought Jobber had this handled. It doesn't." (all [D] unless marked)

| What owners assume | What Jobber actually does |
|---|---|
| New requests get answered | The client gets an email copy. The only request automation is "Automatically archive requests". Stale leads disappear from view instead of being chased. |
| Quotes get chased | "Up to two reminders", sent by the same channel as the quote, max 90 days, Connect+ ($139/mo). Jobber Academy advises: "if they don't respond after your second quote follow-up, it may be time to move on" (per the earlier Jobber-lens research). No documentation that a text or email reply stops them. |
| Old quotes get worked | Custom automations (Grow+) "will not apply to any past items retroactively". Campaigns "are not sent retroactively". Auto-archive hides dead quotes. |
| Past customers get brought back | Campaigns are email-only, a paid add-on (the sweeps read $79 and $99 on the same pricing page; re-check), and not retroactive. There is no mass text. Owners paste texts to "about 600 clients" by hand [S]. There is no trade-cycle logic. |
| A yes gets scheduled | An admin push notification, then a manual "Convert to Job". |
| Replies get handled | Email replies go to one designated person, and the campaign reply-to "cannot be changed". The AI Receptionist answers calls and texts to the Jobber number only ($29 for 30 conversations, then $0.79 each). It does no outbound chasing and turns unresolved conversations into "Needs action" tasks. |
| Quote prices stay current | "Quotes don't expire in client hub", so a customer can approve a stale price months later. |
| New AI fixes it | Teammate (beta, 2026-09-23) drafts quotes and campaigns "for review and approval". The owner still has to act. |

Owners' words on Jobber:
- "Every time I encounter a technical issue or a missing feature, the only solution offered is to upgrade." (Trustpilot, Jun 2026)
- "I lost hundreds of clients because they don't allow text message marketing even though they charge like 300+ for the premium package" (App Store, painter, 2026)
- "Jobber seems to make email campaigns easy, but not bulk personalized texts." (r/pressurewashing)
- "[AI Receptionist] less like a form with a voice" and "argue with a customer saying Sunday is not possible" (Jobber Community) [S]
- "Trying to do this with jobber. Trying to figure it ut the correct timing tho between pushy and starting from scratch or losing customer." (cleaner)

### By tool (the structural limit, then owner words)

- **Housecall Pro.**
  - Pipeline sends 3 estimate follow-ups, then declines the estimate.
  - "You cannot change the timing… with Smart Recommendations enabled" [D].
  - Not retroactive. Lead-board contact stages are moved by hand [D].
  - Pipeline is an add-on (owner reports $50/mo).
  - "$189 monthly plus all the ad-ons… $50 for pipeline and it's missed several of my leads causing me to miss out on leads I paid for" [O].
  - "the AI assistant was just a better voicemail and had 0 affect on my sales" [O].
  - "I'm a contractor not a nerd." [O]
- **SingleOps (Granum).**
  - Follow-ups only on Plus ($350–385/mo). Replies go to the rep [S].
  - "They will make you sign a year contract and there is no way out" [O].
  - "they will lock you in… then ghost you after you sign" [O].
  - Trustpilot 1.2/5.
- **Arborgold.**
  - Proposal follow-up is email-only, Professional+, annual contract, 60 days' notice to cancel [D].
  - Renewals are batch-only with no chase of non-responders [D].
  - Proposals reach clients "about 50% of the time" [O].
  - "support is terrible" [O].
- **ArboStar.**
  - No public doc on follow-up count or timing. SMS is free only for the first 3 months [D].
  - "the learning curve was so steep we ended up abandoning it" [O].
  - Pro-ArboStar threads carry heavy astroturf.
- **Aspire.** "There is not built-in follow up or reminder system for prospects, making it easy for opportunities to be overlooked." [O]
- **DripJobs.**
  - Drips stop on a reply, and then "you take over" [D]. SMS needs the $25 Chat add-on [D].
  - Archiving a proposal ends all contact [D].
  - "customers get repeat messages or do not receive messages at all" [O].
  - "It will.send reminders to people at 6am" [O].
  - Its case-study page is live with "[PLACEHOLDER — Customer quote]" beside a "20% to 45% close rate" claim.
- **PaintScout.**
  - Follow-ups attach only to new quotes and skip estimates once viewed. A reply that is neither accept nor decline doesn't stop them [D].
  - "getting our estimator on board has been a challenge" [O].
- **Estimate Rocket.**
  - "Emails in the campaigns should be generic" [D].
  - "It does not keep track of or display a list of the estimates that have not been viewed" [O].
- **JobNimbus.**
  - Caps active automations at 10/30/100 by tier [D].
  - "JobNimbus is horrible for fencing… it is for roofing, period." [O]
- **Fence Cloud.** $220–545/mo [D]. It tracks leads and does not chase them. No independent reviews exist.
- **mySalesman.**
  - About $300/mo for a ballpark widget. The owner still texts each lead by hand: "You text them asking if they are ok with it" [O].
- **ZenMaid.**
  - No estimate follow-up. One-way SMS from a do-not-reply number.
  - One "Come Back" email, Pro Max only. Leads need "placeholder appointments" to get any message [D].
  - "It charged for every text message that went out." [O]
- **BookingKoala.**
  - Hot leads are blurred below $197. Its funnels are call lists ("you can call the lead a couple of times") [D].
  - "Gatekeeping and extortion" [O].
  - "Tens of thousands in bookings gone… because of API errors" [O].
- **Launch27/Automaid.**
  - The quote form emails the owner "so you can reach out" [D].
  - "needs to have internal log of text messages" [O].
- **MaidCentral.**
  - Real sequences, but about $450/mo. Business-hours texts only, and replies don't stop the sequence [D].
  - "Learning curve, especially during onboarding" [O].
- **GoHighLevel, snapshots and agencies.**
  - A DIY toolkit: repliers "exit the automation… and land in a human's inbox" [V].
  - "Apply yourself to learn GHL. It's front-loaded work" [O].
  - "complicated as all heck" [O].
- **Podium and Hatch.**
  - Annual contracts and demo-gated pricing.
  - "ridiculous auto-renewal clause because they know their software sucks" [O].
  - "took over three months… to release my phone number ($1800)" [O].
- **NiceJob Repeats.** Fixed timing ("we maintain control over the schedule") and 2 SMS plus 2 emails [D]. It asks the customer to rebook and books nothing.
- **Angi and HomeAdvisor as a lead source.**
  - "about 7 out of 10 will ghost you" [O].
  - "some clients just simply won't respond even tho I call within 5 minutes" [O].
- **Paper, QuickBooks and Sheets.**
  - "more and more difficult to keep track of all the bids in my old analog paper bid books" [O].
  - "I use a notebook full of shit even I can't read." [O]

---

## 3. The no-bloat core feature set

**The rule:** a feature ships only if it turns an existing lead, quote or customer into a booked job, and it answers a named leak.

The owner's whole interface is text alerts plus a monthly page. There is no dashboard to learn.

### MUST (launch)

| # | Feature | Leak it answers | Evidence | Channel and legal notes |
|---|---|---|---|---|
| M1 | **Done-for-you intake.** A Jobber API connection, or "send us whatever you have": CSV, Sheets, QuickBooks estimates, PaintScout or Fence Cloud exports, even phone photos of a carbon bid book, which we transcribe. | T9, and the fact that fence and painting quotes don't live in Jobber | Where-quotes-live: fence has Jobber at 1/25 and about 44% on invoice apps, Excel, paper or homemade tools. "I've got questions about how peopls set triggers" [O] | — |
| M2 | **Day-one sweep of every open, archived or unconverted quote and request, plus lapsed clients.** Ranked by value and recency, with an owner veto that excludes quotes priced to lose and bad fits. | T2, T5, F4, P3, C8 | Retroactivity limits in Jobber, HCP and PaintScout [D]. "bid I gave them 2 years ago" [O]. "1 follow-up on a bid i put in last year" [O] | Email plus postcard by default. SMS only with box-2 consent and a DNC scrub. |
| M3 | **Follow every open quote to an explicit yes or no.**<br>• Short notes in the owner's name, citing the job (address, scope, price, season).<br>• Stops on any reply. Branches on whether the quote was viewed (Jobber exposes `clientHubViewedAt`).<br>• Never discounts by default.<br>• Includes a "price held until [date]" line where materials move.<br>• Cadences by trade: tree follows the TCI norm (same day, then ~day 5); painting uses day 2 ("send a follow up email 2 days after and usually get a yes or no" [O]); cleaning uses days 3 and 5, then stops [O]; fence runs 4–8 weeks plus a spring touch. | T2, F3, F5, P1, C2 | Jobber's 2-cap, HCP's 3-then-decline, "lose to the big boys on the follow up" [O], "silence is almost never a no" [O] | Email by default. SMS only with box-1 consent and no Jobber text collision. |
| M4 | **Reply desk.** Reads every email reply and every text to *our* number. Sorts it as: book me / question / price objection / not now + when / went elsewhere / DIY / waiting on HOA, permit or survey / stop. Answers routine replies within rules the owner approves, turns "not now" into a dated re-open, and records the loss reason. | T7, P6, C7, F6 | "you take over the conversation" [D DripJobs]; "Replying to all the emails you let go too long" [O]; "randomly text back two weeks later… I'm scrambling" [O] | Never answer texts on the Jobber number. A stop on any channel suppresses every channel. |
| M5 | **Hot-lead text to the owner.** One-tap actions: call now / send times / let it run. Nothing else goes to the owner. | T1, T7, C1 | "check the replies once i'm actually done for the day" [O]; Jobber's "Needs action" task queue [D] | SMS OK, from our own registered brand with the owner's opt-in. |
| M6 | **Instant first reply to every new request.** Covers Jobber requests and forwarded Angi, Thumbtack and web-form emails. Asks the 2–3 intake questions that matter for the trade:<br>• tree: photos, hazard, address<br>• fence: linear feet, material, gates, HOA, survey pins, plus the owner's per-foot range<br>• cleaning: beds and baths, one-time vs recurring, pets<br>• painting: interior or exterior, timing<br>Offers the next estimate slot. | T1, F1, P5, C1 | Jobber's email-copy-only reply [D]; MaidCentral business hours [D]; 4 quotes in under 24h [B] | Email always. One informational SMS only if the homeowner texted first, called and was missed, or used a form with a disclosure. No offers in it. |
| M7 | **Yes to scheduled to kept.** Detects approved jobs that are unscheduled or unpaid. Sends two time windows or a deposit link. Sends "you're still on the list" and storm or weather delay updates. | T6, F7, lawn case | "approved the quote and signed it. No communication after" [B]; "30 people patiently waiting… no office staff" [O]; storms "sometimes you loose clients/contracts" [O] | Informational SMS OK. No upsell in it. |
| M8 | **Cleaning retention loop.** Asks one-time, deep and move-out clients to go recurring (2–3 touches within 10 days), and watches for lapses: a biweekly client at 21+ days, anyone at 30–45 days. | C5, C6 | Churn 6.89%/mo [V]; ZenMaid's 6-week "Former" rule and single email [D] | Email, plus SMS for clients who ticked box 2 (easy to collect at booking). |
| M9 | **Monthly one-page result.** Jobs booked from quiet leads, dollars won (from paid invoices, not opens), loss reasons, what is still open, and the quiet rate. | All leaks; owners can't see the leak | ZenMaid churn via "Upload each CSV file to ChatGPT" [D]; "we don't really track the retention" [O] | — |
| M10 | **Compliance, built in and never sold as a feature.** Consent capture kit (two unchecked boxes), DNC scrub outside the EBR windows, an internal DNC list across channels, quiet hours, the Jobber collision guard, a copy linter (no discount, "in your area" or financing lines in informational messages), and a sender-number check (hosted VoIP vs a new local number that rings through). | Makes SMS lawful | Mantha v. QuoteWizard ($19MM on quote follow-up texts); Vickers v. Precision Painting; Boger v. The Maids; WA RCW 19.190 | — |

### SHOULD (next 1–2 quarters)

- **S1. Trade-timed deferral re-opens.**
  - Tree: after leaf-out or after a storm.
  - Painting: exterior bids re-opened in late winter; winter interiors sold in Aug–Oct.
  - Fence: pre-season spring slots.
  - Cleaning: whatever date the client gave ("text me next month").
  - Evidence: T5, P7, F4.
- **S2. Price-shock branch with options the owner approves.** Phase it; good, better, best; what's included (stump grinding, haul-away, certificate of insurance); and "ask me about financing" with no terms. Evidence: T4, P2, P4, F9.
- **S3. Fence launch pack: stale-price guard plus stall states** (HOA, permit, survey, insurance), with check-ins every 5–7 days. This is required before we sell to fence. Evidence: F5, F6.
- **S4. Rebooking on the trade's own cycle.**
  - Tree: pruning every 3–5 years; PHC renewals from 60 days out, including non-responders.
  - Painting: decks 24–30 months; exterior 60–84 months.
  - Fence: stain every 2–3 years.
  - Default channel is email plus postcard. Evidence: T8, P10.
- **S5. Booked-out mode.** An honest wait time in the first reply, a waitlist, and outreach paused while the calendar is full. Evidence: F8, P5, C9.
- **S6. Delivery check.** If a quote is unopened after 48h, resend it another way and flag the owner. Evidence: T3, the Estimate Rocket complaint. Get counsel on the wording of any resend by SMS.
- **S7. Quote-not-sent nudge to the owner** 24h after a site visit with no quote. Evidence: F2, P1.
- **S8. Don't-chase list** plus a polite decline or referral text. Evidence: F10.
- **S9. Abandoned booking-form recovery** for cleaning (BookingKoala, Launch27), where the data is reachable. Evidence: C4.
- **S10. Conversion by lead source in the monthly page.** Evidence: P9, C3.

### LATER

- Tree storm mode: triage by hazard in the auto-reply during surges.
- Missed-call text-back. It needs counsel sign-off, a callable number, and a check that Jobber's Receptionist is not already sending "SMS send back".
- Log phone, text and Facebook leads into Jobber as requests.
- Painting gap filler for stalled approved jobs.
- Confirmations and reschedules for estimate visits.
- Photo intake for cleaning deep and move-out quotes.
- Fence warranty and storm check-ins. This is a hypothesis.

### LEAVE OUT (tempting, and why)

- **AI voice answering and outbound calls.**
  - Buyers resent it: "I personally hate the AI voice… couldn't take some extra time to take my money" [O].
  - HCP's version "had 0 affect on my sales" [O].
  - Jobber already sells a receptionist.
  - Artificial voice needs consent under the TCPA however the number was dialed.
- **Estimating, takeoff, drawings and ballpark widgets.**
  - A crowded category (Fence Cloud, mySalesman, FenceWiz, ArcSite, PaintScout), and the leak comes *after* the quote.
  - Only the owner's own per-foot range goes into the first reply, as text.
- **Scheduling, dispatch, invoicing, payroll, job costing and pipeline boards.**
  - The FSM does these.
  - Owners hate bloat: "Does 15 things mostly terribly" [O]; "a $300/mo platform with 40 modules" [builder].
- **Mass blasts, newsletters and social posts.**
  - They land in Promotions ("Normal And Expected Behavior", DripJobs) [D].
  - "anything that sounded scripted got ignored" [O].
  - Marketing SMS needs consent.
- **Review and reputation requests.** Jobber, NiceJob and CompanyCam already do them, they book no jobs, and NiceJob draws complaints about too many asks.
- **Auto-discounts, fake urgency and "crew in your area".**
  - Margin leak (painting's 30–40% cuts).
  - The FCC treats "in your area" home-repair messages as advertisements (03-153 n.477). Homeowners in the Ever-Green Tree Care case complained about it.
- **Financing calculators and payment amounts in messages.** Reg Z trigger terms. FL and TX count credit solicitation as a sales call.
- **Lead generation, ads, SEO or selling leads.**
  - Owners are hostile to agencies ("sit in their mom's bedroom at home doing some SEO" [O]).
  - They fear resale: "worried that software companies will sell that info as a lead" [O].
- **Answering texts on the Jobber number, or texting from a second number while Jobber texts.** Two numbers look "kind of scammy" [builder], and it collides with Jobber.
- **An owner dashboard or mobile app to learn.** "I'm a contractor not a nerd." [O]
- **Commercial janitorial, and franchise networks that own the customer list.**

---

## 4. What keeps the owner paying every month (leaks that refill)

1. **New leads arrive every week.**
   - A cleaning owner gets 40–60 new leads a month [O].
   - Tree needs "~30 leads per week" to keep a crew busy [O].
   - Painters send 4–20 estimates a week [O].
   - One fence shop sends 20–30 quotes a week in spring [O].
   - Each lead reopens M6, M3 and M4.
2. **Most quotes are lost, and nearly all of them silently, every month.** Painting win rates of 24.75–50% on non-referral work, "Maybe 3 calls a year from people declining" [O], and a cleaning owner "lost probably 75% after the quote" [O].
3. **Replies arrive daily, and the owner is on a ladder.** "done for the day" checking [O]. Ghosts return "two weeks later" [O].
4. **Signed jobs wait weeks to months.** Tree backlogs run 8 weeks to 3 months and storms reset them. A fence shop was booked 6 weeks out with 30 waiting. That makes M7 continuous work.
5. **Cleaning churn refills the win-back pool monthly.** At 6.89% a month [V], that is about 6 lapsed clients a month on a 90-client book [A].
6. **Every month, some group of customers comes due.**
   - Tree: dormant-season pruning in fall; post-storm checks.
   - Painting: winter-interior outreach in Aug–Oct; exterior reopen in late winter.
   - Fence: spring pre-booking.
   - Cleaning: the post-holiday lull ("we always get a little nervous" [O]) and spring clean.
7. **Proof arrives monthly.** Owners never see jobs recovered from their current tools, and that is why they cancel them (Podium: "last payment… after not using their service for 10 months" [O]). M9 is the retention mechanism.

**Retention risks to design for**
- **Year one is mostly backlog.** Simulated tree shops at 50% close show 16.9% in year one vs 6.7% at steady state on mid priors. Measured recovery is about 2.7% by count. The ongoing flow (items 1–6) has to justify the fee on its own.
- **Winter in cold markets.** Fence and painting owners resent paying retainers in winter [O]. Offer a winter pause, or winter-specific work: pre-selling spring, the backlog sweep, interiors.
- **Contract hate.** SingleOps, Arborgold, Podium and Workiz lock-ins are top complaints. Month-to-month terms, plus "keep your number and your data", are part of what keeps owners.
- **Cleaning is limited by staff, not demand.** Value comes from recurring mix and win-back, not volume. Without booked-out mode (S5), we cause cancellations.

---

## 5. Loss numbers we can defend

### Cost of a paid lead

| Trade | Figure | Source status |
|---|---|---|
| Tree | HomeAdvisor ~$18–30 per lead, win or lose | Owner, TreeBuzz 2016 (dated). Current figures (LSA $25–75; Google Ads $85–110; Thumbtack $20–60 "shared with 4 or 5 pros") are **vendor claims** from Tree Traction. |
| Fence | — | **No primary source.** Agency claims of $55–175 per shared lead are unverified. |
| Painting | Angi $40–159 per lead; $289.97 for 4 leads (~$72 [A]); Thumbtack $40–100; $80k a year on HomeAdvisor at a $1M painter | Owner-reported (App Store reviews, r/paint, r/sweatystartup). |
| Cleaning | LSA $60–100; PPC $40–60; Thumbtack ~$57 [A: $400 for 7 leads, 1 conversion]; LSA ~$30 [A: $150 for 5]; Meta $6–9 at ~8% close | Owner-reported (r/cleaningbusiness). |

### Value at stake per lead (ticket size)

| Trade | Figure | Source status |
|---|---|---|
| Tree | Angi average removal $750 ($200–2,000+, up to $10,000); jobs posted by owners and buyers $1,200–$7,000; $3,800 settled after 5 quotes | Consumer guide, plus owner and buyer posts. |
| Fence | Angi average $3,277 ($1,860–4,843); owner posts $7k–16k; $26–65+ per foot | Consumer guide, plus owner posts. |
| Painting | Angi exterior $3,178; Fixr $6,242–11,617; owner jobs $20–24k | Consumer guides, plus owner posts. |
| Cleaning | $219.50 per job ($214.60 at small companies); a biweekly client ≈ $5,580 a year [A]; one big house "close to 1k/mo" [O] | MaidCentral vendor data. |

A "wasted lead" costs the lead fee, plus the estimate visit, plus lost gross profit. Only the fee and the ticket have sources. **No primary source prices the estimate visit or the margin.**

### Share of leads the contractor never answers

- **No primary source in any of the four trades.**
- Closest proxies:
  - Jobber's 2026 survey: 20% of pros respond within an hour, 60% the same day, so about 40% don't reply the same day [V/A].
  - Tree: "Over 50% of the callers won't leave a message" [O]. That describes caller behavior, not the contractor's response rate.
  - HBR 2011: firms that replied within an hour were nearly 7x more likely to qualify the lead (cross-industry, dated).
- **Measure it ourselves.** Our audit can compute time-to-first-reply per shop from Jobber request timestamps.

### Share of quotes that go silent

- **No primary source for the share that is truly silent (as opposed to lost).** What can be defended:
  - Painting: win rates of 24.75%, 40%, 40–50% and ~66% on homeowner bids, versus ~90% for referral-only shops. Losses are almost all silent: "Maybe 3 calls a year from people declining" [O, one owner].
  - Fence: close rates of 30%, 40%, 50–70%, 75% and "3-4 of 10" [O].
  - Cleaning: "lost probably 75% after the quote" [O, one owner]; 7–8 closes from 80–100 Meta leads [O].
  - Lawn and landscaping, an adjacent trade: "About 40% of them just never reply" [O].
  - Tree: a 20–30% win rate [S/U]. TCI: "even if only 50% of the jobs confirm".
- **Unverified:** "Level Index" figures of 38.1% conversion on all quotes vs 73.9% on decided quotes, which would mean about 48% never get a decision [A on U].
- **Don't pair these.** Jobber's survey says "69% of pros report a win rate of more than 50%". That is self-reported vendor data and conflicts with export-based data.

### Other defensible numbers

- Cleaning recurring churn: 6.89% a month, 7.54% at small companies [V, MaidCentral index Aug 2026]. That is about 57% a year [A].
- One Arborgold owner reports proposal delivery of "about 50%". This is anecdote, not a base rate.
- Our own figures:
  - Measured recovery is about 2.7% by count (internal).
  - Capital City Lawn: 17 of 150 lapsed regulars booked, 11.3% (CI 7.2–17.4%). Owner-reported, no holdout group.
  - Nelson Fence: "we picked up 4 jobs from people that had already gotten a quote and just never got back to us". Named with permission.

### Never repeat these

- DripJobs: "65% vs 25% industry".
- "21x within 5 minutes"
- "80% of sales after 5+ follow-ups"
- "78% go with the first responder"
- Arborgold: "81% more sales"
- "92% of PHC clients renew"
- Jobber: "80% of campaigns lead to new work"
- StumpIQ: "40+ Arborgold failures"
- DripJobs' placeholder case study.

---

## 6. Other industries ranked by fit

**Filter:**
- the owner runs the shop and quotes come from paid leads
- 150+ quiet quotes or past customers in the export
- one booked job covers the fee
- there is a clock for past customers
- the shop is on Jobber or HCP (no new importer needed)

Every new trade is **UNPROVEN** until 2–3 exports pass: 150+ quotes stale for 30+ days, a 50%+ quiet share, and a median ticket of $1,500+.

| Rank | Industry | Fit | Why |
|---|---|---|---|
| 1 | **Lawn and landscape maintenance** (already in the engine) | 9 | Strongest owner evidence of the exact leak ("40%… never reply", "If they called back great, if not we forgot about them", an approved quote with no scheduling). Jobber-heavy (8.7% Maps flag). Our best proof is Capital City. |
| 2 | Holiday and permanent lighting | 9 | Rebooks every 12 months; tickets $750–5,000 [V Jobber]; runs on Jobber; returning clients book Sept–Oct. The leak itself is unproven. Sell it as a line inside multi-season shops. |
| 3 | Hardscape and landscape design-build | 9 | Big tickets, books out in spring, Jobber/LMN. |
| 4 | Decks and outdoor structures | 8 | Buys like fence ($18–25k, permits, season); 49% of shops have 5 or fewer staff (NADRA); a 24–36 month restain clock. It is the natural extension of fence. |
| 5 | Exterior cleaning: pressure and soft wash, windows, gutters | 8 | Clearest owner evidence ("follow-up email… a text… mark them as DOA"); Jobber-heavy. Tickets are low, so target shops with 2+ trucks. |
| 6 | Garage floor coatings | 7 | Paid-lead volume, ~$2.5k tickets. Weak past-customer clock. Skip Home Depot partner installers. |
| 7 | Asphalt sealcoating | 7 | A 2–3 year reseal clock. Treat it as a clock inside the concrete playbook. |
| 8 | Septic (already in the bank) | 7 | 4% Maps Jobber flag; clean-out clock. |
| 9–12 | Owner-run HVAC replacement; retail (non-insurance) roofing; standby generators; pool service | 6 | Crowded (ServiceTitan) or need a new importer (JobNimbus). Roofing needs insurance guards. |
| 13–17 | Pest, countertops, garage doors, flooring, detailing | 5 | Recurring plans already sold, mostly urgent repairs, or one-time buyers. |
| 18 | Remodel and cabinets | 4 | Too few quotes per shop. |
| 19 | Wedding and event vendors | 3 | No repeat purchase, and email reaches less than a third of inquiries. |
| 20 | Moving, junk removal, mobile mechanics | 2 | The date forces the decision. |
| 21 | Solar; dental and med-spa | 1 | Sales orgs and heavy regulation (TX solar registration, HIPAA). |

**Avoid:** insurance-driven work (storm roofing, restoration), franchise and dealer networks that own the customer list, and commercial janitorial.

---

## 7. The best owner-language lines for copy (verbatim, sourced)

Owner voice unless marked [B]. Re-check each on its page before publishing, and don't name Reddit users without permission.

**Following up feels bad and never happens**
1. "For us, the most annoying thing is still following up on sent estimates. You work in the field all day, then in the evening you lose time checking who replied and who didn't." (r/arborists 1pu2x77/nvp4y0h; the thread is suspected marketing, so use with care)
2. "Just feeling like I'm on the endless treadmill of bids and customer pleasing to keep the crew busy and make payroll." (Ryan Cafferky, TreeBuzz 2026, treebuzz.com/forum/threads/love-tree-work-not-the-tree-business.50730/)
3. "I knock, measure, give prices, but no one wants to drop 7k on the spot. They need to pull money, get the wife on board, fulfill other obligations first, have other bids, then I lose to the big boys on the follow up lol." (reddit.com/r/FenceBuilding/comments/1typzw9/)
4. "My old process was: talk to lead, spend hours on diagram and estimate, get ghosted." (reddit.com/r/sweatystartup/comments/1s7ali7/)
5. "If follow-up is case by case, it gets decided by mood, and the mood is always "I don't want to seem pushy," so it quietly never happens." (reddit.com/r/cleaningbusiness/comments/1waq2dz/_/p8k1y22/)
6. "I send maybe 10-15 quotes a week. About 40% of them just never reply. I follow up manually sometimes but I keep forgetting and it feels awkward." (reddit.com/r/lawncare/comments/1tbwomm/)
7. "If they called back great, if not we forgot about them." (Ohio landscaper, reddit.com/r/sweatystartup/comments/1u2xtf3/)
8. "I hate doing follow-ups for quotes… it makes me feel awkward…" (Daniel Holliday, Grizzly Tree Experts, Jobber Academy, getjobber.com/academy/quote-follow-up-email-templates/)

**Silence isn't a no**
9. "The thing about commercial is silence is almost never a no." (reddit.com/r/cleaningbusiness/comments/1waq2dz/_/p8rfqqy/)
10. "We get Maybe 3 calls a year from people declining. They just don't and never have." (reddit.com/r/paint/comments/1t7v9dg/_/okthgbn/)
11. "I just had a customer call me today to set a date for a bid I gave them 2 years ago." (reddit.com/r/paint/comments/1toi3y4/_/oo1zcpu/)
12. "So far this year, i have already gotten 3 new calls for business and 1 follow-up on a bid i put in last year." (reddit.com/comments/1qwvjfc/_/o3s2y3i)
13. "Sometimes its not a no its a not yet." (reddit.com/r/smallbusiness/comments/1tmc36b/_/onrv34a/)

**Speed and missed leads**
14. "Remember: you are the last person they called. Not the first person." (reddit.com/r/paint/comments/1t7v9dg/_/okt1k34/)
15. "couple of times I'd been busy and then called a week later they'd already hired someone." (reddit.com/r/paint/comments/w5qf4l/_/ih9vdeo/)
16. "most jobs are done before you ever get over to look at them." (OasisTree, TreeBuzz 2016, treebuzz.com/forum/threads/has-anybody-used-home-advisor.34471/)
17. "Over 50% of the callers won't leave a message." (Brad Kessler, TreeBuzz 2018, treebuzz.com/forum/threads/answering-service.37710/)
18. "We are not quite ready for an office person yet but I feel like we are missing leads" (Jasonk, same thread)
19. "I have 10 cleaners and one full time back office agent, but we still miss calls." (reddit.com/r/cleaningbusiness/comments/1sg1kui/_/of1odaw)
20. "when I'm installing or making gates, I can't do estimates and paperwork." (reddit.com/comments/1nt0qlp/_/ngq6jih)

**Paid leads wasted**
21. "Lead cost here can be between $60-$100, so nothing like paying for these leads and losing them due to "it's to expensive" or "let me speak to my husband first"…" (reddit.com/r/cleaningbusiness/comments/1tvzhkx/_/opkvlzl)
22. "I lost mine at the quotes stage… Anyway, lost probably 75% after the quote." (reddit.com/r/cleaningbusiness/comments/1tnfp0d/_/onvggmc)

**The yes that slips away**
23. "Were booked 6 weeks out. Thats roughly 30 people patiently waiting. I have no office staff, so trying to have the time to txt and call all of these people would be ridiculous." (reddit.com/comments/1ox8vji/_/now9vdr)
24. "I've worked series of storms that put the schedule back by 3 months. It's a balancing act, where sometimes you loose clients/contracts." (Evo, TreeBuzz 2019, treebuzz.com/forum/threads/emergency-work.41173/)
25. [B] "I approved the quote and signed it. No communication after. I called and texted, left messages. Nothing." (reddit.com/r/lawncare/comments/uq5wdv/)

**Past customers**
26. "its crazy how much time you waste just chasing people who already liked your work last spring." (reddit.com/r/pressurewashing/comments/1smgmik/)
27. "We're basically surviving off referrals and repeat customers." (reddit.com/r/arborists/comments/1mwf3aj/)
28. "every year from Thanksgiving to tax time we're pretty much dead in the water" (reddit.com/r/paint/comments/1ppvovh/)

**Trust and anti-software (for positioning, not headlines)**
29. "The messages that worked were short and casual, anything that sounded scripted got ignored." (reddit.com/r/sweatystartup/comments/1u2xtf3/)
30. "I'm a contractor not a nerd." (Housecall Pro App Store review, 2025-04-09)
31. "they want you to pay for the highest monthly package at $197 per month to see the details of leads that you have already paid Google etc to get to your website." (Trustpilot, BookingKoala, May 2026)
32. "I'm worried that software companies will sell that info as a lead to others in my region." (reddit.com/comments/1wn8fqd/_/pbd4kgf)

**Proof lines**
33. "we picked up 4 jobs from people that had already gotten a quote and just never got back to us" (David, Nelson Fence, named with permission)
34. [B] "The one contractor who did follow up quickly got my business even though his price was slightly higher." (reddit.com/r/HomeImprovement/comments/1qjhtbr/)

**Do not use as verbatim:**
- Jobber Community lines. They are search snippets from a blocked page.
- The ZenMaid "clients blocking reminder text numbers" line. It is a paraphrase.
- The market brief's PWR line "Email blast was to about 40 and closed 5". It is mis-sourced (the thread is about pump sprayers).
- Promotional posts ("I hated feeling like a desperate salesman…").

---

## Appendix: open items for the product lead

**Validate with pilot exports**
- Fence Cloud/CFS and PaintScout exports (2 samples each).
- Quiet-quote share and ticket size per trade.
- Time-to-first-reply per shop.

**Counsel sign-off needed**
- Is an unaccepted estimate a 3-month inquiry or an 18-month transaction for EBR purposes?
- Which follow-up templates count as telemarketing (Mantha vs Sunrun)?
- The OK and MD "selection or dialing" wording.
- Missed-call text-back.
- The outcome of the FCC revocation vote on Sept 30, 2026.
- Jobber's terms on texting its clients.

**Price conflicts to re-check**
- Jobber Marketing Suite: $79 vs $99. The Campaigns add-on alone was cited at $29.
- Jobber two-way texting: the SMS gap-fill read Connect+ on the pricing page; the fence sweep read Grow+.
- HCP Pipeline: add-on vs included.

**Engineering flags** (the line numbers in the sweeps have drifted, so re-verify)
- `/home/user/QuietAccountsCluade/packages/engine/src/trades/playbooks.ts`: the painting playbook is still a thin `simple()` config, and `paint.interior` has no reserviceMonths. Add budget-gap/phase-it, 3-bid silence, wait-for-spring, stalled-approved, booked-out and interior/exterior cross-sell.
- `/home/user/QuietAccountsCluade/apps/server/src/integrations/jobber/map.ts`: correctly does not infer consent from `smsAllowed`, but should treat `smsAllowed === false` as SMS suppression.
- `/home/user/QuietAccountsCluade/packages/engine/src/ingest/fields.ts`: a queued task says untagged statuses such as "Unsigned" (Estimate Rocket's open status), "Not sent" and "Unscheduled" are misread. Re-test before adding new importers.