# Quiet Accounts: conversion and product brief

Sources: the research findings on Hyros and Becker, Explee, Instantly and open-source reuse, plus a check against the repo (`apps/web/src/screens/Welcome.tsx`, `Onboarding.tsx`, `packages/engine/src/breakage/forecast.ts`, `runtime/agents.ts`, `claims.ts`).

## 0. Corrections to read first

1. **"First 150 free" means the first 150 *people* in one owner's list, worked free. It does not mean 150 free businesses.** The code stores it as `plan.trialSize: 150`, the console labels it "Free round size (people)", and the fit check's `volume` test is "the free round needs 150". Three research recommendations read it the other way and should be dropped:
   - "37 of 150 taken" and "real count of free spots left" (Explee and Becker notes).
   - "150 free clients" as a cost driver (Instantly notes).
   
   The site line "First 150 free." is ambiguous to visitors too. Reword it to: **"We work your first 150 customers free."** There is no real scarcity here, so show no counter at all. Only add a cap such as "onboarding 10 shops a month" if it is actually true.
2. **Becker's "find the loss → put a dollar value on it → charge ~20% of that value → annual VIP plus refund guarantee" sequence is unverified.** The "$232M SaaS pitch" transcript could not be retrieved (https://www.youtube.com/watch?v=8i0ZIHDI024). Verified things that point the same way:
   - AIR bills "about 4-5% of the revenue it generates" (https://x.com/ZssBecker/status/1974097911098069091).
   - HubSpot "started charging a year upfront" (https://hyros.com/updates/facebook-lessons/).
   - Black Friday "grandfather pricing / VIP ad analyst upgrade" (https://hyros.com/black-friday-2026).
   
   Use it as an internal pricing check only, never as a quoted claim.
3. **The "instant replies" promise is not instant today.** New-request answers go into the shared nurture campaign, where they:
   - wait behind follow-ups (`prioritize_new_leads=false`),
   - count against `daily_max_leads`,
   - are spaced by Instantly's default 9-minute gap plus up to 5 random minutes,
   - wait for the send window.
   
   Don't print "answered in minutes" until this is fixed and the ledger measures it.
4. **"Nothing goes out until you OK it" may not be literally true.** New-request answers and hot-reply acks send automatically. Either word it as "You read and OK your notes before we start", or verify that automatic sends use only pre-approved templates.

## 1. Conversion principles, ordered by impact

**1. Show the owner's own lost money before asking for anything.** This combines Hyros's "the platform says X, what really happened is Y" gap with Explee's instant result.
- The Hyros pattern: "Meta pixel — 5 of 7 closes missed. Lost ad income $66,240" and "Your ad platform saw $0 / HYROS attributed $12,000" (https://hyros.com/call-tracking).
- Application: the Silent Quote Audit becomes the product demo. It is built from `silentAudit()` in `forecast.ts`, which already exists.
- Table format:
  - **Jobber shows:** [N] quotes sent.
  - **What actually happened:** [a] won · [b] said no · [c] never answered = **$[X] sitting quiet**.
- Add a quote-journey strip under it, clearly labelled as a sample: Day 0 quote $2,400 → Day 9 no reply → Day 23 our note → Day 24 "can you do Tuesday?" → Day 31 paid.
- Becker: "$15,000 of that is going to be wasted. You could just keep that." (https://hyros.com/updates/facebook-ad-script/).

**2. A big, automatic guarantee, stated three times.** Becker's big bet: "This refrigerator will cool your food, or it's free."
- Hyros says it 3–4 times per page. It is also Hyros's weak spot: the terms require a written request within 90 days, auto-renew, allow price changes at renewal and bar refunds after a chargeback (https://hyros.com/terms), and third parties report refund disputes.
- Quiet Accounts' version is already automatic. `billingCheck()` records a free month and texts the owner before every charge. Market that.
- Wording:
  - **Short name:** "Quiet month? Free month."
  - **Hero, under the button:** "Any month nobody asks you for a price or a date, you don't pay."
  - **Pricing:** "Again: any month nobody asks for a price or a date is free. You don't claim it. We text you before every charge, and in a quiet month the text says *this month is free*."
  - **FAQ, first question, "What exactly is the guarantee?":** "Each month, if not one person we followed up with asks you for a price, a visit or a date, we don't charge you for that month. Nothing to fill out, no window to miss. It's counted on your ledger by published rules [link]. No contract, cancel by text, no renewal at a new price."

**3. Headline: same inputs, more output, in owner words.** Sell the result, not the mechanism.
- Hyros: "Same ad spend. 15% more sales."
- Becker: "people don't give a damn about tracking", and a headline's job is "to get people to read the rest of it" (https://hyros.com/updates/ad-landing-page-tips/).
- Replace the current H1 "Nothing left on the table." (generic). Test:
  - **A:** "Same quotes. Same Jobber. Nothing goes quiet."
  - **B (Explee's outcome + time + free):** "See the money in your unanswered quotes. 60 seconds, free."
  - **C (problem-first):** "Your quotes don't say no. They go quiet."
- **Sub:** "Every new request answered, every quote followed to a yes or a no, past customers brought back when they're due, and a text to you the minute someone's ready."
- Use a percentage only where `fit.canSay15` allows it. Otherwise use the owner's own dollar figure.

**4. Put the CTA on the reveal, not on a sales call.**
- Primary button: **"Show me my quiet quotes"** (Jobber OAuth).
- Secondary text link: "Not on Jobber? Send your quotes export."
- Trust line under the button, Hyros style ("Set up for you · Results in days · No changes to your ads"): "No card · Nothing changes in Jobber · Cancel by text."
- After the reveal, the next button is "Follow up on all [n] like this — free."
- Avoid "Book a demo" and "Get started". Keep "Find my money" as the A/B control.

**5. One plan, everything included, priced against the owner's own number.**
- Hyros: "One plan… No tiers. No add-ons. Every account gets the whole system." (https://hyros.com/pricing-ai-tracking).
- The card: **"$497 a month. Everything."** Then the seven promises, each written as a result:
  - every request answered;
  - every quote followed to yes or no;
  - every yes scheduled;
  - past customers brought back when due;
  - replies read and answered;
  - hot leads texted to you;
  - a ledger of every job we brought back.
- Anchor with the owner's own figure, which the fit check already computes (`medianQuote`): "Your typical quote is $[median]. One yes a month covers it." The generic fallback is "One tree job (~$875) covers the month".
- An optional single line of humor is fine (Hyros's "A baby elephant — Disclaimer: you may not actually get an elephant").
- **Annual VIP option** (Becker's upfront-cash principle, with Hyros's trust failures removed):
  - **Offer:** "Founding owner, paid yearly: $4,970. 12 months for the price of 10 ($414/mo)."
  - **Included:**
    - price locked as long as you stay;
    - the monthly guarantee still runs, and any quiet month refunds $414 to your card automatically;
    - cancel by text anytime, unused months refunded;
    - no auto-renew: we text 30 days before the year ends, and nothing renews without a yes;
    - VIP perks only if they are really delivered, such as a named operator with a direct text line and a pre-season list review before the owner's busy months.
  - **Where to show it:** one secondary line under the monthly price on the site. Pitch it mainly at the close after the free round (`closeMessage`), using the owner's own ledger numbers.
  - **Internal gate (the unverified ~20% rule):** offer annual only when the careful year-one estimate is at least 5× the annual fee (about $24,850). Today the fit check's `payback` bar is only 1× ($5,964, `forecast.ts`). Add a 5× "strong" bar before pushing annual.

**6. Truth as the brand: one number everywhere, and nothing fake.**
- Hyros shows 10–15% / 15–20% / 20–30% / 52% across pages, and its Black Friday page had two deadlines (9/30 in the banner, 9/18 in the body).
- Explee's hero counter is a clock formula, "Only N trial spots left this hour" is generated in the browser, and its countdown resets. Its Trustpilot rating is 3.1/5, 42% one-star, mostly over the timer and card charges (https://www.trustpilot.com/review/explee.com).
- Application:
  - no counters, countdowns or scarcity;
  - every figure is either the owner's own data or labelled "sample" or "estimate from [source]";
  - facts only from `CLAIMS`, which already have sources;
  - extend `lintMarketing` to block jargon (breakage, cadence, sequence, attribution, holdout, CRM, "AI agent", leverage, seamless, unlock) and to block any percentage other than the one allowed by `canSay15`.

**7. No way out of the funnel for paid and cold-email traffic.**
- Becker: "You should have no escape from the funnel."
- Ad and cold-email landing pages get no navigation and one button.
- The current public page shows "Demo console" and "Operator sign-in" in its header. Move those to a separate URL.
- Add a skimmer FAQ with plain answers:
  - Does it send as me?
  - Will customers feel spammed?
  - What if they already said no by phone?
  - What if I'm booked out? (texting BUSY/OPEN already exists)
  - How do I stop it?
  - Is it legal?

**8. Proof: sourced facts now, a ledger "conga line" later.**
- Now: the existing "Why the money is still there" facts:
  - Jobber sends at most two reminders;
  - about 1 in 5 pros answer within the hour;
  - about 39% of tree estimates never become a job.
- Plus a labelled sample ledger and the published counting rules.
- Once real: a long scroll of ledger rows, e.g. "Stump grinding · $650 · quiet 34 days · replied after note 2 · booked".
- Case studies in Hyros's format: Case 01 · Business · Town → big number → 3 stat chips → owner quote → 4 "what we did" steps.
- No celebrity logos, no hype percentages, and no Jobber logo used in a way that implies endorsement.

**9. Present the call as setup, not sales, and make it optional.**
- Hyros: "Book Setup Call… On this short call we will: …"
- Keep "no sales call" as the default. Add a secondary link, "Rather we set it up with you? 10 minutes", and A/B test it.
- After signup, the confirmation page and kickoff text say: what we found, when the first notes go out, and the only replies you need to send.

**10. Test cold-email angles like Becker's "ugly ads", and pick one end of the market.**
- Becker's roofer test: "The third message went insane… Run ugly, simple ads 'til kingdom comes."
- Run 3–5 plain emails, one angle each: money sitting in your quotes / no quote goes quiet / past customers due / the free-month bet. Judge on replies and audits started, not opens.
- First line qualifies the reader: "Do you quote jobs in Jobber?"
- Align the site's trade list. The eyebrow currently says "tree, lawn, septic, fence, concrete and wash", but the offer says tree, fence, painting, cleaning. Say who it's not for: franchises and call-center shops.

### Page order

**Main site:**
1. Hero: H1, sub, one button, export link, trust chips, guarantee line.
2. The leak: "Jobber shows / what actually happened" table plus the quote-journey strip (sample-labelled until connected).
3. How it works: 3 true steps: Connect Jobber → read and OK your notes → take the calls.
4. What runs without you: the seven promises, each shown as a real product fragment.
5. Why the money is still there: sourced facts.
6. Proof: ledger rows plus counting rules.
7. Pricing: one plan, guarantee "Again.", annual line.
8. FAQ: guarantee first.
9. Final CTA with the guarantee a third time.

**Ad and cold-email variant:** sections 1, 2, 3, a short 7, 8 and 9, with no navigation.

## 2. What to borrow from Explee's instant-result onboarding

Borrow:
- **One ask before value.**
  - Explee's hero is a single URL input with no signup, email or card.
  - The current `Onboarding.tsx` asks for trade, software, business name, first name, signer, mailing address, an export guide and a file before showing anything.
  - Move everything except the Jobber connection or file to the moment before the first note is sent.
- **A live, streamed reveal.**
  - Explee streams six steps with status lines.
  - For Quiet Accounts, stream real counts only: "Reading [412] quotes, [Jan 2024–Sep 2026]…" → "[163] never got a yes or a no" → one big number in the accent color, "$[X] sitting in quotes nobody answered" → "[38] past customers due" → "[5] said yes, never scheduled".
  - Do not copy Explee's canned "312 matches…" lines.
- **"Looks right / Looks off" at each group.**
  - Example: "These 12 still say open. Did you win or lose any by phone?"
  - This cleans the data and removes the owner's biggest fear: following up on a job they already closed.
- **One finished piece of work before any ask.**
  - Explee drafts the "hottest lead" email before its paywall.
  - For Quiet Accounts: the single hottest quiet quote (name, job, $, days quiet) plus the note we'd send, in the owner's voice. Button: "Follow up on all [163] like this — free."
  - Don't blur the list, since it's the owner's own data. What the button unlocks is the sending.
- **A pre-connect estimator for cold traffic.**
  - Explee's `/quote` page shows a baseline number first, then "Refined for your market".
  - Two inputs, quotes per month × average job, give a range labelled with its source. For tree, the source is the ArborStar claim that 39% of estimates never become jobs, labelled as "never became jobs", not as "never answered".
  - Then: "Connect Jobber to see your real number."
- **"Email me this list"** partway through, for owners who aren't ready. It also gives them something to forward to a spouse or office manager.
- **A consent line at activation:** "I authorize Quiet Accounts to follow up on behalf of {business}."

Don't copy:
- the clock-driven counters, "spots left this hour" or countdowns;
- asking for a card before value, or auto-recharge;
- auto-sending after an approval window lapses (reviewers report exactly this: https://www.salesforge.ai/blog/explee-review).

Also state the setup time honestly. If each business gets its own mailbox, warm-up takes 2–3 weeks unless you buy pre-warmed accounts at about $10/mo each. So the reveal is instant, but the first-send date must be shown truthfully ("First notes go out [date]").

## 3. Instantly: what to adopt vs keep in-house

**Adopt Instantly as the pipe (Hyper Growth plan, $97/mo, one workspace):**
- Mailboxes, warmup, sending and threading.
- Replies in the thread via `POST /api/v2/emails/reply`.
- Webhooks on `all_events`, which is the only way to receive `campaign_completed_for_lead_without_reply` (the "sequence ended with no reply" signal).
- Custom lead labels and `update-interest-status`, to mirror our verdicts (won 4, lost −3, wrong person −2).
- A "later" subsequence moved in by our scheduler.
- Out-of-Office Smart Pause, free.
- Email verification for old-customer lists only, 0.25 credits each.
- `sending-status`, `accounts/test/vitals` and warmup scores in the ops console.
- The two free inbox-placement tests per template.

**Keep in-house (the brain):**
- The reply classifier, the Claude second opinion, the owner hand-off and all reply writing.
- Don't turn on the AI Reply Agent or Inbox Manager. Reasons:
  - it costs 5 credits per reply generated, even ones never sent;
  - its drafts can't be approved through the API;
  - the campaigns an agent covers are fixed at creation;
  - it has no Jobber context and books through Calendly.
- Don't turn on Instantly-tag-triggered subsequences or AI blocklist triggers either.

**Fix before marketing claims depend on it:**
1. **The reply recipient check does nothing.** `provider.replyTo` sends a `to` field that the API doesn't have. Before replying, call `GET /emails/{reply_to_uuid}` and abort on a recipient mismatch, which is what Instantly's own CLI does.
2. **Give instant answers their own 1-step campaign per business:**
   - `prioritize_new_leads=true`, no new-lead cap;
   - a low `email_gap`, and a send window covering every waking hour, 7 days a week;
   - response time logged on the ledger.
3. **Turn on "Disable Global Lead Status Synchronization"**, and decide whether one business's stop should blocklist that homeowner for every business. With the default, one homeowner's reply silently stops every other business's follow-ups to that person.
4. **Add a missed-reply backstop:**
   - poll `GET /emails` (20 requests/min, including `emode_others`) to catch spouse and forwarded replies;
   - handle `account_error` events;
   - re-enable webhooks that have switched themselves off.
5. Set `limit_emails_per_company_override: disabled`. The docs don't say gmail.com-style domains are exempt from the per-company limit.
6. Move the webhook secret from the URL into a header.
7. Never give owners Instantly logins: workspace members see every client's campaigns and data.

## 4. Open-source adoptions (5, with licenses)

| # | What | License | Action |
|---|---|---|---|
| 1 | **libphonenumber-js** v1.13.14 | MIT (repo), Apache-2.0 LICENSE file (Google metadata) | **Adopt now.** It fixes confirmed bugs: "603-224-1234 ext. 12" becomes "+603224123412"; 555-555-5555 is picked as a callback number; the owner's cell is passed to Twilio without E.164 normalisation. Use `/max` on the server and keep it off the marketing bundle. The "hot leads texted to you" promise depends on it. |
| 2 | **read-excel-file** v9.3.10 | MIT (dependencies all MIT) | **Later.** Accept .xlsx uploads and emailed .xlsx imports (17 KB gzipped, loaded only when needed). Avoid the SheetJS npm package, unchanged since 2022. |
| 3 | **postal-mime** v4.0.0 | MIT-0 | **Only if inbound email moves to raw MIME** (e.g. SES or Cloudflare). Today Postmark/Mailgun and Instantly already send parsed JSON. |
| 4 | **Crisp email-reply-parser** | MIT (keep notice) | **Port its patterns, don't add the package**, which is Node-only. Add Spanish, Portuguese, French and German "wrote" headers, the De:/Enviado:/Para: block and "Enviado desde mi…" to `clean.ts`. Today a Spanish Outlook reply keeps our whole earlier note. |
| 5 | **Chatwoot conversation model** | MIT Expat (excluding `enterprise/`) | **Copy the design only:** `waiting_since`, `snoozed_until` (from followUpOn), `first_reply_at`, priority, an "unattended" queue, and first-response and reply-time figures. This makes "replies answered instantly" something the ledger can prove. |

**No-library must-fix:** uploaded CSVs are always decoded as UTF-8 (`File.text()` in `files.tsx`, `toString("utf8")` for emailed imports). Excel's classic CSV save turns "José O'Brien" into "Jos� O�Brien", so a note can go out as "Hi Jos�".
- Fix: try `TextDecoder('utf-8', {fatal:true})`, fall back to windows-1252, and detect the UTF-16LE byte-order mark.
- Add a lint check for the � character in names and greetings.

**Skip:** chrono-node (the in-house parser beat it on seasons, holidays and "last March"), papaparse, deep-email-validator, planer, talon, html-to-text, mailparser, BullMQ, pg-boss, graphile-worker, Dittofeed. Also skip Laudspeaker: its LICENSE file says MIT but its README says AGPL-3.0, and it is no longer developed.

## 5. Design direction: "crafted, not AI slop, not corporate"

Reference points: current hyros.com uses P22 Mackinac serif + Geist Mono, #FCFBF8 / #1F1E1D, and one indigo accent (#5150F6). Explee uses #f6f5f3, Geist at weight 400, one emerald accent reserved for outcomes, and mono uppercase labels. The current Quiet Accounts tokens are already close: warm off-white `#f6f4f0`, navy ink `#0f2433`, Geist Mono for figures.

**Change:**
- **Headline weight.** The H1 is currently Outfit extrabold at 62px. Move to weight 400–500 with tight tracking (−0.03em). Consider testing a serif for the H1 only.
- **One accent, one meaning.** Orange (`#f4511e`) marks money figures and the single primary button, nothing else. Semantic colors (ok, warn, bad, info) stay in the console.
- **Show the product as exact fragments of real outputs,** each with a one-line takeaway caption in Hyros's style ("HYROS tracked 460 closes — 30% more than Meta reported"):
  - the owner's hot-lead text ("Dave will call you Monday");
  - the Friday text;
  - one ledger row in mono with tabular numbers;
  - one reply thread.
- **Replace the three step cards** that use lucide icons (an AI-template tell) with numbered mono labels plus a real fragment.

**Crafted looks like:**
- owner words ("quotes nobody answered", "said yes, never got scheduled");
- exact figures ($18,340, not "$18k+");
- one narrow column and a lot of white space;
- 17–18px body text for owners reading on a phone in the truck, with a sticky bottom CTA on mobile;
- a single dry joke at most.

**AI slop looks like:** gradient blobs, 3D or illustrations, icon-in-circle feature grids, "Supercharge / Unlock / Seamless / AI-powered" badges, stock photos of smiling contractors, emoji, animated counters with made-up numbers.

**Corporate looks like:** "solutions / platform / leverage", logo walls, "Request a demo", long forms, and a guarantee buried in legalese.

## Still unverified or open

- The Becker transcript: the 20% rule and annual VIP framework.
- The G2 "5.0" badge on Explee (G2 blocked fetching).
- Whether the webhook's `email_id` on `reply_received` is the lead's reply or our sent email.
- Whether lead custom variables are filled in inside subsequence templates.
- Whether Jobber allows its name or logo in marketing ("Connect Jobber" is fine; a logo implying endorsement is not).
- Whether "nothing goes out until you OK it" holds for automatic instant replies.