# QUIET ACCOUNTS SITE v3: JUDGED AND SYNTHESIZED COPY DECK

Draft A (loss-first) wins, and its structure is the base of the final copy. The final copy passes the repo's own marketing linter with nothing flagged.

The biggest open item is in the software, not the copy. "New requests answered from your office, 7am to 8pm" needs a live feed of new requests, and nothing supplies one today (checklist item 13).

## 1. SCORES (1-10)

| Criterion | A loss-first | B system-first | C proof-first |
|---|---|---|---|
| 1. 5-second clarity (phone, truck) | 8 | 9 | 7 |
| 2. Loss framing, honest numbers | 9 | 6 | 7 |
| 3. Becker (few words, result, bet, skimmer, no escape) | 8 | 8 | 8 |
| 4. Proof use | 7 | 8 | 9 |
| 5. Compliance | 7 | 6 | 6 |
| 6. Founder lines + brand voice | 9 | 7 | 8 |
| 7. Differentiation vs Jobber / AI tools | 7 | 9 | 7 |
| **Total /70** | **55** | **53** | **52** |

**A wins on structure.**
- **Strengths:**
  - It keeps the founder's H1.
  - It puts a sourced loss line in the hero.
  - Its reveal runs in the right order: dollars, then rate, then per month, then lead money plus the founder's line, then finished work, then his own estimate, then an honest price band.
  - It uses all three founder lines and has the best skim path.
- **Weak spots:**
  - The hero tally has no owner-reported label.
  - The "$900" tree anchor is unsourced.
  - R8 says "quotes over $10,000", but the engine's call-list rule is relative (caution.ts:50).
  - "Nothing goes to your customers until you've OK'd…" is still in the copy.
  - Its Jobber row "Two reminders vs up to three notes" is a weak contrast.

**B is clearest at a glance and has the best Jobber table.**
- **Strengths:**
  - Its Jobber rows are the strongest: "A reminder with a button / A note about their job" and "Who does the work".
  - Its "Not canned reminders" lede is the sharpest line against AI tools.
- **Loses points:**
  - There is no loss in the hero.
  - The H1 "We chase every quote" overclaims, because big and phone-only quotes go to the owner's call list.
  - "Until a yes or a no" and "Every quote followed to a yes or a no" contradict the three-note cap.
  - FAQ 6 pairs PAUSE with OPEN. The parser pairs PAUSE with RESUME and BUSY with OPEN (apps/server/src/core/owner.ts:9).
  - UNDO does not exist.
  - The Year Floor goes on the public page before counsel has read it.

**C has the best proof craft.**
- **Strengths:**
  - It carries Ryan's text in the hero.
  - It gives honest expectation rates: 1 in 12 wrote back, 1 in 37 booked.
  - Its anchor comes from Dow's real job average.
  - It has "Expired isn't no. Archived isn't no." and a How-we-count panel.
- **Loses points:**
  - The cleaning H1 is a landscaper's result ("150 past customers. 17 booked. About $34,000.") on a "For cleaning companies" page. That misleads under 16 CFR 255.2.
  - The AI line "most sign you up for a year" is a claim about competitors resting on [M]/[L] evidence.
  - UNDO does not exist.
  - "Careful: 1 in 65" can't be traced to any constant in forecast.ts.
  - The numbers-first H1 fails the "what is this?" test.

**Synthesis rule:** A's section order and hero go on top.
- **From B:**
  - the lede contrast;
  - the Jobber table rows;
  - the result headlines for the five parts;
  - the "still fresh" column;
  - the clean-file branch;
  - the button logic for more than 150 quiet quotes;
  - the lead-cost question wording.
- **From C:**
  - Ryan's line and the expectation rates;
  - the guess-high branch;
  - "Only [31] told you no" and the expired/archived fine print;
  - "Expired isn't no";
  - "Read it like Karen would";
  - the real-average anchors;
  - the "does it send from my email" FAQ;
  - the painting H1;
  - the How-we-count text.
- Every figure was re-checked against its source; the results are in section 4.

---

## 2. FINAL COPY (tree is the default; trade swaps are in section 3)

Tokens in [brackets] come from the owner's file. The sample values add up: 412 quotes = 204 won + 31 no + 163 never answered + 14 still fresh.

The guarantee is stated three times: **G1** in the hero, **G2** on the price card and **G3** in the final call to action. The FAQ gives its terms.

### 2.1 Header
- Logo: **Quiet Accounts**
- One button. Before the audit: **See my quiet quotes** (scrolls to the drop box). After the audit: **Start free**.
- Ad and cold-email pages: the logo is not a link, there is no menu, and the footer shows only the address and the text number.

### 2.2 Hero
- **Eyebrow:** For tree services
- **H1:** Your quotes don't say no. They go quiet.
  - Test B: "All the follow-up. None of the chasing."
- **Lede:** About 4 in 10 tree estimates never become a job.¹ We follow up the ones that went quiet, in your company's name, and text you when someone's ready to book.
- **Promise, orange (G1):** Quiet month? Free month. Any month nobody asks you for a price or a date, you don't pay.
- **Ticks:** We work your first 150 customers free · Then $497 a month, only if you say yes · No card · Nothing changes in Jobber · Cancel by text
- **Tally:** Dow's Tree Service, NH · old quotes · first 150 → 150 asked · 12 wrote back · 4 booked · $10k+ in jobs
  - Caption: "Honestly I was pretty skeptical at first…" Ryan's text, unedited. Owner-reported, no comparison group.
- **Footnote ¹:** ArboStar, 2025 tree-service data.

**Drop box**
- **H2:** How much is sitting in your quotes?
- **Hint:** About 10 seconds. Every quote that never got a yes or a no, what it's worth, and the first note we'd send.
- **Drop target:** **Show me my quiet quotes** / Drop your quotes file or tap to choose · CSV from Jobber, Housecall Pro, QuickBooks or a spreadsheet
- **Where's the file?** In Jobber: Reports → Quotes report → All time → Export CSV. Jobber emails it to you.
- No file handy? **Try a sample tree company.**
- **Privacy line, today (true now):** It runs here in your browser. Your file never leaves this computer.
  - Once file upload on Start ships: Runs in your browser. Your file stays on this computer unless you tap Start.

### 2.3 While it reads
Both taps are optional, and there is a "Skip, just show me" link. Nothing is pre-selected.
- "While we read it: two quick ones."
- **How many quotes a month go quiet on you?** 0–2 · 3–5 · 6–10 · 10+ · No idea
- **What does a new request cost you, on average? Count the free ones too.** Nothing · $10 · $25 · $50 · $100+ · Not sure

**Streamed lines** (real counts only):
1. Read [412] quotes, [Jan 2024] to [Sep 2026].
2. [204] became work. [31] got a no.
3. [163] never got a yes or a no.
4. *(only if the file has them)* [31] requests never got a price.
5. Writing the first note to [Karen Whitfield].

### 2.4 The reveal (in order)
- **Eyebrow:** Your quote audit
  - Sample version: "Sample · a made-up tree company. Your file shows your real number."
- **R1 (H2):** [$486,400] is sitting in quotes nobody answered.
  - Under it: [163] quotes, [Jan 2024] to [Sep 2026]. Not counted: [14] sent in the last two weeks. They're still fresh.
- **R2, his guess against his file:**
  - Guessed low: "You guessed [3–5] a month. Your file says [7]."
  - Guessed high: "You guessed 10+. Your file says [4]. Better than you thought."
  - No idea: "Now you know: [7] a month."
- **R3:** Your quiet rate: **[41%]**. [4 in 10] quotes that had time for an answer never got one.
- **R4, two columns:**
  - **Your software shows:** [412] quotes sent
  - **What actually happened:** Became work [204] · Said no [31] · Never answered [163] · Still fresh [14], each with its $
  - Under both: Only [31] people told you no. The other [163] never said anything.
  - Fine print: Expired or archived with no reason counts as never answered. Your software closed those, not your customer.
- **R5:** Every month about [$20,300] of what you quote goes quiet. That's [40] cents of every quoted dollar, and nobody said no to it.
- **R6, what he paid for them:**
  - With his own figure: [163] quiet quotes at about [$50] a request: around [$8,150] spent on people nobody finished with.
  - If he tapped Not sure: A tree request from Google's Local Services ads runs about $38 (99 Calls, Apr–Jun 2026). Higher or lower for you? [$ field]
    - Multiply only by a number he confirms or types.
  - If he tapped Nothing: skip this line.
  - Then always: **You spent the time getting a lead. We make sure it doesn't get wasted.**
- **R7, warmest first:** Last 90 days [24] · [$61,800] / 3–12 months [71] · [$208,300] / 1–2 years [68] · [$216,300]
  - Caption: Newest go first. Anything over six months old gets asked without the old price, so you can quote today's.
- **R8:** **Worth a call from you: [7] people, [$118,000].** [4] quotes far bigger than your usual and [3] with only a phone number. We don't email these. You get the list, biggest first.
- **R9:** Eyebrow "Your first note, already written". Fields: Your company · Signed by. Then the email.
  - Caption: Note 1 of 3 to [Karen], about the [leaning oak] ([$2,400], quiet [49] days). Notes 2 and 3 go only if she hasn't answered, and stop the minute anyone does. Read it like [Karen] would. What would you change?
- **R10:** If [Karen] wrote back "Can you do October?", you'd take it. How many of your [163] would?
  - Choices, none pre-selected: **Like Dow's and Nelson's: 1 in 37** · **Half that: 1 in 75** · **My guess: 1 in [__]**
  - Label: Dow's and Nelson's own count, first 150. Owner-reported, no comparison group.
  - Result: **Your number: about [$Z] a year.** [$B] from quotes already sitting there, plus [$O] from new ones going quiet. Your estimate, not a promise.
  - If his guess beats 1 in 37: "You picked 1 in [20]. Dow's and Nelson got about 1 in 37, so we'll price against theirs."
  - If the file has quotes only: "Past customers book back more often. Capital City's did: 17 of 150. Add your clients export →"
- **R11, price against his number** (the price card moves up here and carries G2):
  - **$497 a month. Everything.** A year of it is $5,964, less any quiet month.
  - $20 or less per $100 of his number: That's about [$P] for every $100 sitting there.
  - $21–40: On paper it's close, and we won't pretend otherwise. That's why your first 150 are free: you see your real number before you pay a dollar.
  - Over $40: At your numbers, start with the free 150 and let the result decide.
  - Always: Your typical quote is [$2,400]. One yes a month covers it.
    - If his typical quote is under $497: "[k] yeses a month cover it."
  - Quiet month? Free month. Any month nobody asks you for a price or a date, you don't pay.
- **R12, the button:**
  - [n] ≤ 150: **Start on these [n]. Free. →**
  - [n] > 150: **Start on the likeliest 150. Free. →**
  - Under it: No card. You OK the first note. Then $497 a month, only if you say yes.
  - Links: Email me this · Rather talk it through? 15 minutes

**One-tap start** (opens under the button)
- Fields: Cell (replies get texted here) · Company (from your file) · Who signs the notes
- ☐ Send this file to Quiet Accounts and follow up with my customers on behalf of [Company].
- Button: **Start my free 150 →**
- Fine print: We text you about your account only. Reply STOP to our texts any time.
- Done screen: "Got it, [Dave]. Jack will text you your first note, written to one of your real customers, within one business day. Reply OK and it starts."

**Clean file**
- H2: "Your quiet rate is [6%]. That's rare."
- "Nearly every quote gets an answer. You don't need us for quotes."
- If past customers were found: "Your [212] past customers who haven't been back might be a different story." Button: **Start on my past customers. Free.**
- If none were found: "Past customers who haven't booked in a year? Drop your clients export."

### 2.5 The quiet rate (for owners who scroll without dropping a file)
- **Eyebrow:** The number your software doesn't show
- **H2:** Your software counts quotes sent. Not quotes answered.
- **Pain:** The removal you priced in May is still leaning over their roof. Nobody called them back, and they didn't call you.
- **Body:** It just sits at "awaiting response" until it expires. Expired isn't no. Archived isn't no. The share that never got a yes or a no is your quiet rate. Nobody publishes one for the trades. Your file has yours.
- **Example strip** (tagged EXAMPLE; it switches to his own numbers after an audit):
  - Your software shows 412 quotes sent.
  - What actually happened: 204 became work · 31 said no · 163 never answered.
  - **Quiet rate 41% · $486,400 sitting quiet.**
- **Three facts:**
  - **Quiet usually isn't no.** In 2025, 71% of homeowners said they'd put off at least one home project (Angi).
  - **You paid for every one.** A tree request from Google's Local Services ads runs about $38, win or lose (99 Calls, 2026).
  - **The big shops know it.** Nearly half of contractors doing $10M+ say following up on estimates brings in 11–15% of their income (ServiceTitan, 2025).
- **Close:** You spent the time getting a lead. We make sure it doesn't get wasted.
- **Button:** Find my quiet rate ↑

### 2.6 Results
- **Eyebrow:** Results
- **H2:** 450 quiet customers asked. About $64,000 in jobs.
- **Sub:** Three shops' own count of their first 150. Owner-reported, no comparison group. Old quotes: about 1 in 12 wrote back and 1 in 37 booked. Past customers: about 1 in 9 booked. Your free 150 shows your real number.
- **Cards** (with the unedited text screenshots):
  - **Dow's Tree Service** · NH · old quotes · **$10,000+** · 150 asked · 12 wrote back · 4 booked · "He was skeptical going in." · Ryan's text, unedited
  - **Nelson Fence** · CT · old quotes, some four years old · **about $19,800** · 150 · 12 · 4 · "People who got a quote and never got back to him." · David's text, unedited
  - **Capital City Landscaping** · NH · past customers · **about $34,000** · 150 · 28 · 17 · "21 said yes. He had room for 17." · Tom's text, unedited
- **Under the cards:** Want to ask them yourself? Text 603-340-7673 and we'll pass on their number.
- **Use only if true:** These are the only three shops that have finished a first 150 so far.

### 2.7 How it works: five parts
- **Eyebrow:** How it works
- **H2:** Nothing on the table. No leads wasted.
- **Sub:** Five parts. You run none of them. Your part: send the file, OK the first note, take the calls.

1. **The Money Map.** Know what's there before a note goes out.
   - Everyone worth going back to (quiet quotes, requests that never got a price, past customers who are due), what each is worth, likeliest first.
   - Your biggest quotes and phone-only people go on your call list.
   - The audit above is page one.
2. **The Notes.** Notes about their job, not reminders with a button.
   - Up to three short emails about each person's own job, in your company's name.
   - You OK the first one. They stop the minute anyone answers.
   - Fragment: the journey strip, tagged EXAMPLE.
3. **The Reply Desk.** Every reply read. You never open the inbox.
   - Software sorts every reply, and a person checks anything that isn't a plain yes or a stop.
   - "Stop" is off the list that minute. "Ask me in spring" gets asked in spring.
4. **The Ready Text.** Someone's ready. It's on your phone.
   - You get their name, number, job, their own words and the best time to call.
   - Text back **BOOKED 2400** and it goes on your ledger, traced to the note that brought them back.
   - **BUSY until Nov 15**, **PAUSE** and **CANCEL** work the same way.
   - Fragments: the phone push and the ledger rows, tagged EXAMPLE.
   - Caption: Every ledger line names the record in your software and the note they answered.
5. **Every Month After.** The new ones too.
   - New requests answered from your office, 7am to 8pm.
   - Every new quote followed up.
   - Past customers asked back when they're due.
   - Every Friday, your quiet rate: before we started, and now.
   - Caption: held until response time is measured (section 7, item 17).

### 2.8 Jobber and AI tools
- **Eyebrow:** Doesn't Jobber already follow up?
- **H2:** Jobber sends reminders. We get answers.
- **Sub:** If Jobber's follow-up were going to book the job, it would be booked already.

| | Jobber's quote follow-ups | Quiet Accounts |
|---|---|---|
| Who does the work | You set it up | We do |
| Quotes from before you turned it on | Not reached* | Asked, newest first |
| What your customer gets | A reminder with a button | A short note about their own job |
| Who reads the replies | You, in your inbox | Read for you, then texted to you |
| A month nobody asks for a price or a date | You pay anyway | **$0** |

- **Source line:** *Jobber Help Center: "up to two reminders about their quotes in 'awaiting response' status"; custom automations "will not apply to any past items retroactively."
- **AI line:** AI follow-up apps? Still software you run, and you pay for it whether anything books or not. Here a person checks every reply that isn't a plain yes or a stop, and a quiet month costs you nothing.
- **Close:** Keep Jobber. We work from its export.

### 2.9 Price
- **Eyebrow:** One plan
- **H2:** Free until it's working.
  - Test: "One yes a month covers it."

**Free card: "Your first 150", $0**
- What the first 150 got three shops (owner-reported): 12–28 wrote back · 4–17 booked · $10k–$34k in jobs
- ✓ No card, no call, no contract ✓ You OK the first note ✓ Every yes texted to you the same day
- Button: **Start my free 150 →**

**Paid card: "After that, everything", $497/month**
- **(G2)** Quiet month? Free month. Any month nobody asks you for a price or a date, you don't pay. You don't claim it: we text you before every charge, and in a quiet month the text says it's free. That's our bet.
- ✓ New requests answered from your office, 7am to 8pm
- ✓ Every quote followed up, three notes at most
- ✓ Past customers asked back when they're due
- ✓ Every reply read, every yes texted to you
- ✓ Your biggest quotes and phone-only people handed to you
- ✓ A ledger of every job we bring back
- ✓ Cancel by text
- **Anchor before an audit:** Dow's four jobs averaged over $2,500. Each one covers about five months of this.
- **Anchor after an audit:** Your typical quote is [$2,400]. One yes a month covers it.
- **Yearly line:** see section 5.

### 2.10 FAQ: "Straight answers / What owners ask first."
1. **What if nothing comes back?** Then you don't pay. Any month nobody we followed up with asks you for a price, a visit or a date is free. Nothing to claim: we text you before every charge, and in a quiet month the text says it's free. The counting rules are written down before we start. [How we count →]
2. **What do I have to do?** Send your quotes export, OK the first note, take the calls. Jobber, Housecall Pro, QuickBooks or a spreadsheet all work. No login, no new software.
3. **Will my customers feel pestered?** Three short notes at most, about their own job, then we stop. "Stop" is off the list that minute. We never text or call your customers.
4. **Is a bot answering my customers?** Software sorts every reply. A person checks anything that isn't a plain yes or a stop. Only routine answers go out on their own ("Thanks, Dave will call you today"), and they never promise a price or a date you didn't give.
5. **Does it send from my email?** No. Notes come from an office inbox we set up in your company's name ("Sarah at Dave's Tree"). Your own email and domain are never touched.
6. **What if I already won it, or they said no on the phone?** We check every name against your records first and skip anyone who booked. Text us a name and they're off.
7. **What if I'm booked solid?** Text BUSY until Nov 15. New work waits until about three weeks before you open up, and people who already said yes still get handled. Text OPEN when you want it back. PAUSE stops everything, and RESUME starts it again.
8. **How do I cancel?** Text CANCEL. We text back what's still scheduled. Reply CANCEL YES and it's done: no more notes, no more charges.
   - Once one-step cancel ships: "Text CANCEL. Billing stops that day."

### 2.11 Start (final call to action), sticky bar, footer
- **Eyebrow:** Start here
- **H2:** Your first 150 are free.
- **Sub:** Those quotes get colder every week. Four fields, one forwarded email, and your first note to read, by text, within one business day.
- **Ticks:** **(G3)** Any month nobody asks you for a price or a date, you don't pay · No card, no contract · Then $497 a month, only if you say yes · Cancel by text
- **Fields:** Company · Your first name · Cell (replies get texted here) · Where your quotes live (Jobber: emails you a file / Housecall Pro: forward one report / Something else)
- **Consent:** ☐ I authorize Quiet Accounts to follow up with my customers on behalf of my company.
- **Button:** **Start my free 150 →**
- **Fine print:** Nothing goes to your customers until you've read and OK'd the first note. We text you about your account only; reply STOP any time.
- **Sign-off:** **No quiet accounts.** Jack · Concord, NH · 603-340-7673
- **Done screen:** keep today's three forwarding steps.
- **Sticky bar (phone):**
  - Before the audit: "What's your quiet rate? · 10 seconds, in your browser" [Show me]
  - After the audit: "[$486,400] sitting quiet · First 150 free, no card" [Start free]
- **Footer:** Quiet Accounts · 9 Carter St, Concord, NH 03301 · Text 603-340-7673 · For tree / fence / painting / cleaning. Trade links appear on organic pages only.

---

## 3. PER-TRADE VARIANTS

| Slot | Tree (default) | Fence | Painting | Cleaning |
|---|---|---|---|---|
| Eyebrow | For tree services | For fence companies | For painting contractors | For cleaning companies |
| H1 | Your quotes don't say no. They go quiet. | Your quotes don't say no. They go quiet. | They didn't say no. They said they'd talk it over. | Your customers don't quit. They go quiet. |
| Lede, first sentence (loss) | About 4 in 10 tree estimates never become a job. | Only about a third of home-service owners say they close more than 7 in 10 of their quotes. | Interior painting is one of the projects homeowners put off most. Put off isn't no. | Most homeowners (68%) say they'd hire the same company again. How many of yours were never asked? |
| Lede, second sentence | We follow up the ones that went quiet, in your company's name, and text you when someone's ready to book. | same | We follow up the estimates that went quiet, in your company's name, and text you when someone's ready to book. | We ask back the customers who drifted, in your company's name, and text you when someone wants back on. |
| Drop box H2 | How much is sitting in your quotes? | same | How much is sitting in your estimates? | Who stopped coming, and what they were worth? |
| Where's the file | Jobber: Reports → Quotes report → All time → Export CSV | same | same | Jobber: Reports → Visits report (or Quotes report) → All time → Export CSV |
| Sample link | Try a sample tree company | Try a sample fence company | Try a sample painting company | Try a sample cleaning company |
| Section 2.5 H2 | Your software counts quotes sent. Not quotes answered. | same | Your software counts estimates sent. Not estimates answered. | Your software counts customers. Not the ones who stopped coming. |
| Pain line | The removal you priced in May is still leaning over their roof. Nobody called them back, and they didn't call you. | You measured, priced it and sent it. Then they waited on the neighbor, the pool, the tax refund, and nobody picked the phone back up. | They got three bids and said they'd talk it over. Nobody asked again. Be the one who does. | A deep clean that never became every other week. A regular who skipped March and never came back. Nobody asked. |
| "You paid for every one" | A tree request from Google's Local Services ads runs about $38, win or lose (99 Calls, 2026). | Angi charges pros for every match, "regardless of whether the Pro ultimately provides the requested service" (Angi 10-K, FY2025). | A painting request from Google search ads costs about $138, win or lose (LocaliQ, 2025). | A cleaning request from Google's Local Services ads runs about $33, win or lose (99 Calls, 2026). |
| R6 "Not sure" fallback | About $38, Google Local Services ads (99 Calls, Apr–Jun 2026) | "Nobody publishes a fence figure. What do you pay?" [$ field] | About $138 from Google search ads (LocaliQ), about $33 from Local Services ads (99 Calls). What do you pay? | About $33 from Google's Local Services ads (99 Calls, Apr–Jun 2026). What do you pay? |
| Speed caption (held; section 7, item 17) | Only about 1 in 5 tree companies answers a new request within the hour (Jobber, 2026). | Only about 1 in 5 home-service pros answers a new request within the hour (Jobber, 2026). | same as fence | About 1 in 4 cleaning companies answers a new request within the hour (Jobber, 2026). |
| Hero tally / proof | Dow's Tree Service, NH · old quotes · 150/12/4 · $10k+ · Ryan's line | Nelson Fence, CT · old quotes · 150/12/4 · about $19,800 · David's line: "we picked up 4 jobs from people that had already gotten a quote and just never got back to us." | Nelson Fence, labelled "fence shop · old quotes", plus: "No painting shop has finished a first 150 with us yet. These are a fence shop's old quotes." | Capital City Landscaping, labelled "landscaper · past customers", with Tom's line, plus: "No cleaning company has finished a first 150 with us yet. These are a landscaper's past customers." |
| Anchor before an audit | Dow's four jobs averaged over $2,500. Each one covers about five months of this. | Nelson's four jobs averaged about $4,950. Each one covers about ten months of this. | After the audit only | After the audit only |
| R10 choices | Like Dow's and Nelson's: 1 in 37 · Half that: 1 in 75 · My guess | Like Nelson's: 1 in 37 · Half that: 1 in 75 · My guess | Like Nelson's fence quotes: 1 in 37 · Half that: 1 in 75 · My guess | Like Capital City's past customers: 1 in 9 · Half that: 1 in 18 · My guess |
| Ready Text (EXAMPLE) | **Karen Whitfield wants it done** · Remove leaning oak · quoted Aug 12 · "Sorry, crazy summer. Is that price still good? Can you do October?" · 14 Oak Ln · after 4 · **$2,400 back on the table** → You: BOOKED 2400 | **Brian Lopes wants it done** · 160 ft cedar privacy · quoted Jun 3 · "We held off for the pool. Ready now if you can fit us in before the ground freezes." · 22 Village St · cell · **$7,850 back on the table** → BOOKED 7850 | **Rachel Moore wants it done** · Exterior repaint, colonial · quoted May 20 · "Still want it done, just needed to talk to my husband. Can you start before it gets cold?" · 41 Elm St · after 5 · **$6,200 back on the table** → BOOKED 6200 | **Megan Ortiz wants back on** · Every other Friday · last visit Mar 14 · "Yes please put us back on. Same day works." · 17 Harbor Rd · **$180 a visit back on the schedule** → BOOKED 180 |

The rest of the page is the same for every trade. On the painting page, body copy says "estimates" wherever the tree page says "quotes".

---

## 4. LOSS-FRAMED LINES AND THEIR SOURCES (checked 2026-09-30)

| # | Line on the page | Exact source wording | Source | Tag | In claims.ts? |
|---|---|---|---|---|---|
| 1 | About 4 in 10 tree estimates never become a job. | "Across the aggregated data, the average estimate-to-job conversion rate sits at 61%." (2025 data, published Apr 1, 2026) | https://arbostar.com/education-hub/where-tree-service-companies-actually-lose-money | [M] vendor data, sample size not disclosed | Yes (arbostar-2025-tree-conversion) |
| 2 | Only about a third of home-service owners say they close more than 7 in 10 of their quotes. | "More than a third say they close over 70% of quotes." (1,050 owners, Conjointly, Dec 2025, ±3 pts at 90%) | https://www.getjobber.com/home-service-trends-report/ | [M] self-reported | Yes (jobber-2026-win-rates; URL now fixed) |
| 3 | Only about 1 in 5 tree companies / home-service pros, and about 1 in 4 cleaning companies, answers a new request within the hour. | "20% respond within the hour"; Tree Care "21% reply to new leads within an hour"; Cleaning "26% replying within an hour" | same Jobber report | [M] | Yes (jobber-2026-lead-response now covers tree 21% and cleaning 26%) |
| 4 | In 2025, 71% of homeowners said they'd put off at least one home project. / Interior painting is one of the projects homeowners put off most. | "71% of homeowners have put off at least one home project this year." "The most commonly postponed projects include bathroom remodels (12%), interior painting (10%), and window replacements (10%)." | https://www.angi.com/press/angis-2025-state-of-home-spending-pulse-report | [M] | Yes (angi-putting-off) |
| 5 | A tree request from Google's Local Services ads runs about $38. (Painting and cleaning fallback: about $33.) | "The average moved from $33.93 in 2025 to $37.77 in 2026" (tree; Apr–Jun). Painting "$33.06 in 2026"; cleaning "$33.21 in 2026" | https://99calls.com/blog/lsa-cost-per-lead-by-industry | [M] agency data | Yes (lead-cost-by-trade: tree $38, painting $33, cleaning $33) |
| 6 | A painting request from Google search ads costs about $138. | Paint & Painting $138.38 (the same page has Cleaning/Maid $46.99 and a home-services average of $90.92; Apr 2024–Mar 2025; no fence or tree figure) | https://localiq.com/blog/home-services-search-advertising-benchmarks/ | [M] | Yes, painting $138 is inside lead-cost-by-trade, but that entry's url is only 99 Calls. **Add the LocaliQ URL.** Cleaning $47 isn't registered, so this deck uses the registered $33 figure. |
| 7 | Angi charges pros for every match, win or lose. | "fees paid by Pros for consumer matches (regardless of whether the Pro ultimately provides the requested service)" | https://www.sec.gov/Archives/edgar/data/1705110/000170511026000011/angi-20251231.htm | [H] SEC filing | Yes (angi-pays-regardless) |
| 8 | Most homeowners (68%) say they'd hire the same company again. | "Seventy-three percent of homeowners would refer a business after excellent service, and most (68%) say they'd hire the same company again." (1,040 US homeowners, SurveyMonkey, Oct 23, 2025) | https://www.housecallpro.com/resources/home-service-customer-service-report-trends-statistics/ | [M] vendor survey. Caveat: it sits next to "after excellent service", so never write "68% would come back if asked". | Yes (hcp-hire-again) |
| 9 | Nearly half of contractors doing $10M+ say following up on estimates brings in 11–15% of their income. | "Nearly half (47%) of contractors with annual revenue of $10 million or more said that following up on estimates results in 11-15% of their income" | https://www.servicetitan.com/press/residential-industry-report-2025 | [M] self-reported, mostly HVAC and plumbing | Yes (thrive-2025-followup-income) |
| 10 | Jobber: two reminders, only while "awaiting response". | "There are two quote follow-up automations available, so that you can send your clients up to two reminders about their quotes in 'awaiting response' status." | https://help.getjobber.com/en/articles/automations/ | [H] vendor docs | Yes (jobber-two-reminders). **Its url is still https://help.getjobber.com/; point it at /en/articles/automations/.** |
| 11 | Old quotes: "Not reached" | "No, automations will trigger when the trigger conditions are met. They will not apply to any past items retroactively." (custom automations) | https://help.getjobber.com/en/articles/custom-automation-builder/ | [H] for custom automations only. The built-in reminder is timed "based on the number of days after sending the original quote"; what it does to old quotes isn't documented. | **No. Add it, and test on the Jobber test account.** |
| 12 | Three shops: 150/12/4, over $10k; 150/12/4, about $19,800; 150/28/17, about $34,000; "about $64,000" in total | Ryan: "…bringing us back 4 jobs that we probably would've never gotten. We booked over 10k from it…" David: "…we picked up 4 jobs from people that had already gotten a quote and just never got back to us…" Tom: "…a bunch of people we thought were dead accounts end up getting back to us…" | First-party; merged-brief.md section 6 | [M] owner-reported, no comparison group | n/a (first-party) |
| 13 | 1 in 12 wrote back / 1 in 37 booked / 1 in 9 past customers booked / 1 in 75 ("half that") / $2,500 ≈ 5 months / $4,950 ≈ 10 months | Arithmetic: 12/150; 4/150 = 2.7%; 17/150 = 11.3%; $2,500 ÷ $497 = 5.0; $19,800 ÷ 4 = $4,950, and $4,950 ÷ $497 = 10.0 | Derived | MODEL (label it as the shops' own count) | n/a |
| 14 | Every R-line figure: $ sitting, quiet rate, per month, cents per dollar, lead money | The owner's own file | First-party | [H] his data | n/a |

Rules the final copy keeps:
- No outside figure is ever described as "went quiet". ArboStar says "never become a job", not "never answered".
- The lead-money total is multiplied only by a number the owner gave.
- Nothing on the banned-stats list is used: 80% / five follow-ups, 44, 48, 64, 72 or 87%, 82%, 98% open, 7x / 8x / 21x, "60–70% of estimates die", 30–50%, 217%, 25–95%.
- The page never says "AI-powered", "risk-free", "money-back", "guaranteed 15–20%", campaign, blast, drip or nurture, and has no countdowns or spot counters.
- "Leads" appears only inside the founder's two lines.
- `lintMarketing()` from claims.ts, run over the copy in sections 2 and 3, flags nothing.

---

## 5. YEARLY-PLAN WORDING

**Public price card, ship now.** Every clause is true in the engine today except the one marked.
> Rather pay yearly? **$4,970**, twelve months for the price of ten. A quiet month still comes back to your card ($414.17). Your price stays the same while you stay. Thirty days before the year ends we text you, and nothing renews without your yes.
>
> *Add only once it's built:* Cancel mid-year and the unused months come back to your card.

**Held for counsel.** Add it to the card later, with a "How we count" link. The engine already runs this (settleYears / yearFloor), and the private close text already promises it (owner.ts:383).
> If the jobs on your ledger don't add up to what you paid for the year, we send you the difference, 30 days after your year ends. Automatic. Offered when your first 150 shows the numbers fit.

**"How we count" panel.** This uses the engine's own definition (ledger/attribution.ts:35).
> A job counts as ours when the person wrote back to one of our notes, or when the exact quote we followed up on was approved, up to 180 days after our last note. Not counted: anyone who came back without writing back to a note, anyone who booked before our first note, and cancelled work.

**Private close text:** already in owner.ts, and offered only through the offerYear() gate. Keep it, with counsel's edits.

**Renewal text** (already in owner.ts:426): "Reply RENEW to keep $4,970 for another year, MONTHLY to go month to month at $497, or nothing and it simply ends."

---

## 6. COMPLIANCE FIXES MADE IN THE FINAL COPY

1. **Hero tally label.** It now says "Owner-reported, no comparison group" (16 CFR 255.2). Draft A had no label there.
2. **"Every quote" and "until a yes or a no" are gone.** Big quotes and phone-only quotes go to the owner, and there are three notes at most. The copy now says "three notes at most" and "the ones that went quiet".
3. **"Quotes over $10,000" became "quotes far bigger than your usual".** The engine's rule is relative: at least 3× the median, 1.5× the 90th percentile and 2× the typical job (caution.ts:50). The live site's FAQ has the same error.
4. **The cleaning H1 no longer shows another trade's result.** Proof from another trade always has that trade named next to it.
5. **Owner commands match the parser:**
   - BUSY / OPEN
   - PAUSE / RESUME
   - CANCEL, then CANCEL YES
   - UNDO is dropped, because it doesn't exist.
6. **No lock-in claim about competitors.** The AI line claims only what is true of any subscription tool.
7. **Guarantee terms are disclosed.**
   - The terms sit next to G2 and are spelled out in FAQ 1 (16 CFR 239.2).
   - It is never called "money-back" (239.3).
   - Every "free" sits next to "then $497 a month, only if you say yes" (16 CFR 251.1).
8. **No speed claim until it's measured.** "In minutes" is gone. The within-the-hour caption is held, because putting it next to "yours get an answer" implies we answer within the hour.
9. **Tree anchor.** The unsourced "$900 typical tree job" is replaced by Dow's real average.
10. **Owner text consent line** added to both forms.

Regulations cited:
- [H] 16 CFR 255.2 (consumer endorsements and generally expected results): https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255/section-255.2
- [H] 16 CFR 239 (guarantees; 239.3 on "money back"): https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-239
- [H] 16 CFR 251.1 ("free" offers): https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-251

---

## 7. PROMISES THE SOFTWARE MUST KEEP (engineer checklist)

Status key:
- **TRUE**: verified in the repo today.
- **VERIFY**: the code exists, but check how it behaves.
- **BUILD**: not there yet.
- **FIX**: the code or live copy contradicts the promise.

**Guarantee and billing**
1. **TRUE.** The quiet month is automatic, with a text before every charge (agents.ts billingCheck, owner.ts:528 guaranteeCheck).
   - **VERIFY** that money texts held for an operator (config.ts:58) can never go out after the charge date.
2. **FIX / VERIFY.** The copy says "nobody **we followed up with**", but the guarantee counts every wants_it / wants_price reply in the period (owner.ts:533).
   - Exclude replies that come through the new-request auto-answer track (touch.track "new_request", agents.ts:861).
   - Otherwise requests the owner would have got anyway cancel his free month.
3. **TRUE.** Yearly plan basics:
   - yearly = 10 × monthly (annualPrice);
   - a quiet month refunds 1/12 (annualRefund);
   - a renewal text goes 30 days before the year ends;
   - with no answer the account pauses, and nothing renews (renewalIfDue).
4. **VERIFY** "Your price stays the same": plan.annualPrice and monthlyPrice must be stored per business, not read from global config.
5. **BUILD.** A mid-year CANCEL on a yearly plan refunds nothing today (owner.ts:200–222). Build the unused-months refund, or leave that clause off.
6. **TRUE, counsel needed.** The Year Floor is live in the engine (settleYears / yearFloor) and already promised in the close text (owner.ts:383). Counsel should read both before the site states it.
7. **TRUE.** The offerYear() gate exists (owner.ts:396), so "Offered when your first 150 shows it fits" is accurate.

**Owner texts**
8. **TRUE.** These owner commands work today (apps/server/src/core/owner.ts):
   - BUSY until Nov 15 / OPEN
   - PAUSE / RESUME
   - CANCEL, then CANCEL YES
   - STOP, for our texts to the owner
9. **BUILD** one-step CANCEL (pitch C8) before the FAQ says "Billing stops that day".
10. **VERIFY** BOOKED 2400 needs a #code when more than one lead is waiting (owner.ts:47). Each Ready Text must print the exact reply to send.
11. **VERIFY / BUILD** "Text us a name and they're off": I found only the per-lead NO / DONE commands with a #code, not free-text removal by name.
12. **TRUE** "Reply OK and it starts": an OK to the first note starts sending, and nothing goes out before it (owner.ts:154–165). Anything else he texts while the note waits is treated as a change to it (owner.ts:277).

**Always-on (price card and "Every Month After")**
13. **BUILD / VERIFY. This is the biggest risk.** "New requests answered from your office, 7am to 8pm" needs a live feed of new requests.
    - The Jobber app's scopes are read clients and read quotes. Requests are read only if that scope is granted (jobber/connector.ts:107), and REQUEST_CREATE also needs the app published.
    - Owners who only export a CSV have no feed.
    - Either build another way in (forwarded web-form, Angi or Thumbtack emails), or show this line only to connected accounts.
14. **VERIFY** the send window: the instant campaign runs every day, 7:00–20:00 local (instantly/campaign.ts:234).
15. **BUILD / VERIFY** "Every new quote followed up" needs a live quote feed: the Jobber connection or a scheduled re-export.
16. **BUILD / VERIFY** "Past customers asked back when they're due" needs jobs or visits data. The Jobber jobs scope isn't granted, so this is CSV-only today.
17. **HOLD.** No "in minutes" or within-the-hour claim until real send times are measured on the ledger. The engine's weekly report already checks FAST_ANSWER_MINUTES before saying it.
    - **FIX** the live copy that says it anyway: index.html:155, :244 and :277, and main.ts:65.

**Replies and notes**
18. **VERIFY** that every reply that isn't a plain yes or a stop goes to the "Needs a person" queue before any automatic answer (classify.ts needsHuman, ops.ts:1169). State the staffed hours; the test-page config has 8am–8pm, Monday to Saturday.
19. **VERIFY** that automatic answers use only pre-approved templates and never contain a price or a date.
20. **VERIFY** "Nothing goes to your customers until you've OK'd the first note": no always-on sends before the owner's first OK.
21. **VERIFY** stop behaviour:
    - Notes stop the minute anyone answers: stop-on-reply plus our own cancel.
    - Decide Instantly's Global Lead Status Sync setting.
    - "Stop" goes on the blocklist the same minute.
22. **VERIFY** three notes at most per quote (maxEmails 3 and the template sets).
23. **TRUE.** Notes on quotes more than 180 days old leave out the old price (STALE_QUOTE_DAYS = 180, render.ts:84).
24. **TRUE.** We never text or call homeowners. New-request answers go by email; with no email, the owner is texted instead (agents.ts:881). Keep it that way.
25. **VERIFY** every yes is texted to the owner the same day, including replies that come in at night.
26. **TRUE.** Big quotes and phone-only people go on the call list (calllist.ts). The copy now matches the relative rule.

**Ledger and report**
27. **TRUE.** The Friday report shows the quiet rate before we started and now (owner.ts:297–300). It appears once at least 5 quotes are counted since the start.
28. **VERIFY** every ledger line shows the record in the owner's software and the note he answered. A job counts as ours when the person wrote back, or the same quote was approved within 180 days (attribution.ts:35).

**Audit and site**
29. **BUILD** the new audit pieces:
    - the guess chips;
    - the lead-cost chip ("count the free ones too");
    - the take-back step with 1 in 37 / 1 in 75 / own guess, priced against the lower of his guess and 1 in 37;
    - the price bands per $100;
    - the button logic for more than 150;
    - the "still fresh" column (sent less than 14 days ago);
    - the clean-file and quotes-only branches;
    - a visits or clients export path for cleaning;
    - "Email me this";
    - the sticky bar with his own dollar figure.
30. **FIX.** The page and the engine count quiet quotes differently.
    - quiet.ts:32 counts `declined` as answered.
    - The page counts expired or archived quotes with no reason as never answered.
    - The page's quiet rate must equal the Friday report's.
31. **BUILD** file upload on Start. main.ts:390–397 posts only summary counts today, so "unless you tap Start" and "Send this file…" are false until it ships. The interim privacy line is true.
32. **VERIFY** the sample audit is labelled "Sample" and every mock is labelled "EXAMPLE".

**Claims and permissions**
33. **FIX claims.ts before publishing.**
    - Most outside figures are now registered: angi-pays-regardless, lead-cost-by-trade, angi-putting-off, hcp-hire-again, and cleaning 26% inside jobber-2026-lead-response.
    - Still to do:
      - add the Jobber custom-automation "will not apply to any past items retroactively" claim;
      - add the LocaliQ URL to lead-cost-by-trade;
      - point jobber-two-reminders at /en/articles/automations/.
    - Run lintMarketing() over the final HTML.
34. **VERIFY** on the Jobber test account (Maple Ridge Tree Co) whether the built-in quote follow-ups fire on quotes sent before they were turned on. If they do, change "Not reached" to "Two reminders, timed from the day you sent it".
35. **VERIFY** before publishing:
    - the three owners still agree to "ask them yourself" and to being named;
    - "only three shops have finished a first 150" is true before that line is used;
    - the rule on naming Jobber while its app is unpublished: describe it in words only, no logo, no "Connect".

Deck file: /tmp/claude-0/-home-user-QuietAccountsCluade/df31b6b3-e55e-5a1b-af55-9ebad860a767/scratchpad/v3-final-deck.md