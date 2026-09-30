# Same breakage in other industries: ranked candidates, top 5 to add next, and ones to avoid

Research date: 2026-09-30. Evidence tags: [H] primary, [M] secondary or self-reported, [L] anecdote or vendor blog. "est." means my own estimate, not a sourced number. Reddit could not be searched from here, and LawnSite, ContractorTalk, Garage Journal, AQUA and Angi pages were blocked. Where a quote below came from a search snippet and not from reading the page, it says so.

## Bottom line

- **Add next:**
  1. Holiday and permanent lighting installers
  2. Hardscape and landscape design-build
  3. Deck and outdoor-structure builders
  4. Exterior cleaning: pressure and soft washing, windows, gutters and gutter guards
  5. Garage floor coatings (epoxy and polyaspartic)
- **Industries we hadn't noticed:** holiday lighting, decks and floor coatings.
  - Holiday lighting appears only as a seasonal hook in `docs/research/market-brief.md` line 192.
  - Decks appear only as a staining sub-service (`pw.deck`, `paint.deck`).
  - Floor coatings appear only as a "garage floor" match inside the concrete playbook.
- **Avoid for now:**
  - Residential solar.
  - Dental and med-spa consults.
  - Trades where the date or the urgency forces a decision: moving, junk removal, mobile mechanics.
  - Wedding and event vendors.
  - Anything driven by insurance: storm roofing, restoration.
  - Franchise and dealer networks that own the customer list.
- **Common filter.** An owner-run shop fits when:
  - its quotes come from paid leads;
  - its export shows 150 or more quiet quotes or past customers;
  - one booked job covers $497;
  - there is a clock for past customers;
  - it runs on Jobber or Housecall Pro, so no new importer is needed.

## Ranked table

| # | Industry | In engine today? | Quote-based? Typical ticket | Est. quotes/mo, owner-run shop | Software, and does it export quotes? | Past-customer clock | Season | Fit (1-10) |
|---|---|---|---|---|---|---|---|---|
| 1 | **Holiday + permanent lighting** | No (only a hook in the brief) | Yes. Full package "$750–$5,000" (Jobber) [M]. Permanent: "$2,000 to $6,000+" (Trimlight, snippet) [L] | 20–60, Sept–Nov ("50+ quotes a season") [L] | Jobber (has a holiday-lighting Academy section): Quotes CSV. Also HCP, QuoteIQ | **12 months.** Returning clients booked Sept–Oct | Sell Aug–Nov. Install "November 1st to the end of January" | **9** |
| 2 | **Hardscape / landscape design-build** | Partly (`land.hardscape`) | Yes. Paver patio avg "$3,800", range "$480 to $22,500" (Angi, snippet) [M]. Design-build $10–80k est. | 10–30 est. | Jobber (CSV), LMN, SynkedUP, Aspire. LMN export not verified | Paver sealing and additions 24–36 mo est.; lighting; plantings | Sell Jan–May | **9** |
| 3 | **Decks, pergolas, outdoor structures** | No (only staining) | Yes. Wood deck "$18,263", composite "$25,096" (Cost vs Value 2025) [M] | 8–20 in season est. | Jobber, JobTread ("export any report… as a CSV or Excel"), Buildertrend, Houzz Pro | Stain/seal 24–36 mo (engine's `paint.deck` = 30) | Sell Feb–Jun | **8** |
| 4 | **Exterior cleaning** (PW/soft wash, windows, gutters + guards) | Yes (`pressure_washing`, `window_cleaning`, `gutter`) | Yes. Low tickets ($300–900 est.); guards higher | 30–100 in season est. | Mostly Jobber; HCP, QuoteIQ | 6–36 mo | Mar–Nov | **8** |
| 5 | **Garage floor coatings** | No (concrete regex only) | Yes. Avg "$2,525", range "$750 to $5,800" (Angi, snippet) [M] | 20–50 est. | Jobber; Markate (CSV incl. "Estimate Status") | Weak (floor lasts). Cross-sell patio, basement, pool deck, neighbors | Year-round; cold limits cure in the North | **7** |
| 6 | Asphalt sealcoating / paving | Partly (`concrete`) | Yes. Driveways $300–1,000 est.; commercial lots larger | 30–80 est. | Jobber lists "Paving" | Reseal every 2–3 yrs [L] | Apr–Oct | 7 |
| 7 | HVAC replacement (owner-run) | Yes (`hvac`) | Yes. $8–15k est. | 15–40 est. | ServiceTitan (unsold-estimate SMS, up to 4 texts), HCP (Pipeline resends 3×), Jobber. All export | Tune-ups every 6–12 mo | Spring/fall | 6 |
| 8 | Retail roofing (not insurance) | Yes (`roofing`) | Yes. Asphalt re-roof "$31,871" (Cost vs Value, snippet) | 15–40 est. | JobNimbus (Estimate Report → CSV/Excel), AccuLynx, Roofr: new importer needed | 20+ yrs; gutters and repairs only | Mar–Nov | 6 |
| 9 | Home standby generators | No | Yes. "$8,000 to $20,000+" [L] | 5–25 est., spikes after outages | ServiceTitan / HCP / Jobber | Yearly maintenance | Storm seasons | 6 |
| 10 | Pool service (openings, heaters, liners); pool builders | Yes (`pool`) | Service $500–10k est.; builds $60k+ | Service 10–40; builders 3–10 est. | Skimmer "Quotes By Customer" report (sent/expired/approved/rejected) [H] | Open/close every year | Mar–May, Aug–Oct | 6 service / 4 builders |
| 11 | Pest + mosquito | Yes (`pest`) | Partly. Plans plus one-off/termite quotes | 20–60 inspections est. | FieldRoutes, PestPac, GorillaDesk ("All Estimates" report → CSV) | Quarterly; lapsed plans | Spring–fall | 5 |
| 12 | Countertop fabricators | No | Yes. $3–6k est. | 30–100 est. | Moraware CounterGo: quote views → Export .csv [H] | None (one-time) | Year-round | 5 |
| 13 | Garage doors | No | Partly. Replacement "$4,672" (Cost vs Value) [M]; mostly repair | 5–20 est. | ServiceTitan, HCP, Workiz (custom report → CSV) | Yearly tune-up | Year-round | 5 |
| 14 | Flooring | No | Yes. $3–10k est. | 20–60 est. | RollMaster, QFloors; installers on Jobber | Other rooms, years apart | Year-round | 5 |
| 15 | Auto detailing: ceramic coating / PPF | No | Yes. $1–7k est. | 10–30 est. | Urable (export not verified), Jobber, Square | Maintenance every 3–12 mo | Spring–summer | 5 |
| 16 | Kitchen/bath remodel, cabinets | No | Yes. Minor kitchen "$28,458" (Cost vs Value) [M] | 3–10 est. | JobTread (CSV), Buildertrend, Houzz Pro | Next project, years | Year-round | 4 |
| 17 | Wedding / event vendors | No | Yes (proposals) | 10–40 inquiries est. | HoneyBook, Dubsado | None (one-time) | Winter inquiry peak est. | 3 |
| 18 | Moving, junk removal, mobile mechanics | Junk yes | Moving yes; junk and mechanics priced on site | High | SmartMoving (built-in follow-ups), Jobber/HCP | Rare | Summer | 2 |
| 19 | Residential solar | No | Yes. $20k+ | Sales teams, not owner-run shops | Vertical CRMs | None | — | 1 |
| 20 | Dental / med-spa consults | No | "Treatment plans" | — | Dentrix / Open Dental; Boulevard / Zenoti | 6-mo recall | — | 1 |

## Evidence and compliance, by industry

1. **Holiday + permanent lighting**
   - Jobber bid guide: full lighting package "$750–$5,000". On unanswered bids: "If you haven't heard back after a day or two, send a short and polite message asking if they have any questions." It also says the leasing model "helps you land repeat work." [M] https://www.getjobber.com/academy/holiday-lighting/how-to-bid-christmas-light-installation/
   - Jobber tips: "The holiday lights season typically runs from November 1st to the end of January." [M] https://www.getjobber.com/academy/holiday-lighting/christmas-light-installation-business-tips/
   - Big Star Lights (a supplier): "You'll want to book your returning clients' installs in September and October." [L] https://bigstarlights.com/blogs/pro-installer-blog/how-to-generate-a-high-customer-return-rate-a-guide-for-holiday-light-installers
   - Big Star Lights, quoting an installer: "If I don't get back to them within 24 hours, I've already lost the job." Same page mentions "50+ quotes a season". [L] https://bigstarlights.com/blogs/pro-installer-blog/from-quote-to-close-the-pro-installer-s-guide-to-shortening-sales-cycles
   - christmaslights.io lays out a 14-day chase: "Day 1: Send text and email immediately after providing quote / Day 2: Phone call…" This shows unanswered quotes are the normal case. [L] https://christmaslights.io/post/christmas-light-q-and-a-pricing-installation-business-tips
   - Many lighting installers are landscapers, pressure washers or roofers doing lights as a side line. One Jobber podcast guest runs an exterior-cleaning company and does lights on the side. [M] https://getjobber.com/podcast/s2e6-dave-moerman/
   - Compliance: nothing special. Don't write invented deadlines like "book by Friday" (the brand bans fake scarcity). Franchise networks such as Christmas Decor may own the customer list and the domain.
   - **The breakage here is unproven.** No owner-level data shows lighting quotes going quiet. Check it on 2–3 exports.
2. **Hardscape / design-build**
   - An owner's blog, citing a LawnSite thread: "Most contractors self-report a 40% close rate on quotes." [L] https://gettinylawn.com/blog/quote-to-job-lag-killing-landscaping-close-rate/
   - SynkedUP (vendor): "Contractors who don't follow-up within that window are losing work they already earned." [L] https://synkedup.com/landscape-consultation/
   - Our strongest proof carries over: Capital City Landscaping (NH), 150 past customers, 28 wrote back, 17 booked, about $34,000. Owner-reported, no comparison group.
3. **Decks**
   - NADRA: "49% reported having five employees or fewer" and "44% are building 51 or more decks per year" (n=37) [M] https://www.nadra.org/blog/what-deck-builders-really-want
   - Tickets: https://zondahome.com/2025-cost-vs-value-report/
   - Evidence that deck quotes go quiet is thin. A deck builder's blog describes homeowners collecting three bids ("Three contractors came out…") [L] https://www.pinnacledecking.com/blog/why-deck-contractors-ghost/
   - Many fence companies also build decks, so the Nelson Fence story fits.
   - Compliance: permit lead times. Never state financing terms (see the note on financing in the guards below).
4. **Exterior cleaning**
   - Pressure Washing Resource, "Steve", Mar 28 2019: "95% of the time I email them the quote so I have a follow-up email that goes out if I don't hear back. If I still don't hear back I send a text and if I don't hear back from that I mark them as DOA." [L]
   - Same thread, AquaTeamPowerWash: "7 out of 10 I'll close with this followup call." [L]
   - Source: https://pressurewashingresource.com/community/t/follow-up-calls/18681
   - That is exactly the breakage: two canned touches, then the quote is written off.
   - Risk: low tickets. Target shops with 2+ trucks, and lead with past customers.
5. **Garage floor coatings**
   - Angi snippet: "$2,525 on average… $750 to $5,800" [M] https://www.angi.com/articles/epoxy-flooring-costs-advantages-and-installation.htm
   - "Estimates close at 30–50% with proper in-person presentation." [L] https://30daypivot.com/garagefloor_spoke_pricing
   - HomeAdvisor sells a "Concrete Floor Coating Apply" lead category, so these are paid leads [M]. Example: https://www.homeadvisor.com/tloc/Goffstown-NH/Concrete-Floor-Coating-Apply
   - Markate CSV includes "Estimate Status" (snippet) https://www.markate.com/product-updates?label_id=1&page=2
   - Penntek is "the exclusive concrete coatings partner of The Home Depot Home Services". Those installers don't own their customers, so skip them. https://penntek.com/
6. **Sealcoating**
   - Reseal every 2–3 years [L] https://www.bartsasphalt.com/blog/does-sealcoating-your-driveway-really-prolong-its-life/
   - Jobber lists "Paving" as an industry [H] https://www.getjobber.com/industries/
   - Best treated as a 24–36-month clock added to the concrete playbook, not a separate focus trade.
7. **HVAC**
   - ServiceTitan: 47% of $10M+ contractors say estimate follow-up brings 11–15% of income (already in the brief) [M] https://www.servicetitan.com/press/residential-industry-report-2025
   - A coach's example: "1,860 open estimates in a one-month period totalling $25 million" [L] https://www.servicetitan.com/blog/success-stories-following-up-on-estimates
   - That same page repeats the banned "82% higher" texting stat. Don't lift numbers from it.
   - Crowded category, and urgent failures close fast.
8. **Roofing**
   - ServiceTitan 2026 survey of more than 1,000 roofing companies: "Only 16% of contractors follow up with homeowners the same day for unsold estimates." [M] https://www.servicetitan.com/press/2026-roofing-exterior-market-report
   - Jobber's 2026 survey (1,050 owners): "Plumbing, Roofing, and Electrical pros report the highest close rates—likely due to urgent, high-need services." [M] https://www.getjobber.com/home-service-trends-report/
   - Texas: "It's also illegal in Texas for a contractor to offer to waive, rebate, or absorb a property policyholder's deductible." A roofer also can't act as a public adjuster on a job it is doing. [H] https://www.tdi.texas.gov/consumer/storms/roofing-and-insurance-know-the-law.html
   - JobNimbus reports export to CSV/Excel [H] https://support.jobnimbus.com/reports
9. **Generators**
   - Homeowners "feel the price number ($8,000 to $20,000+) and pause", and "need to think about it" often means the deal dies. [L] https://www.salesask.com/blog-posts/generator-installation-sales-training-ai-coaching-for-electrical-and-home-backup-contractors
   - Validate before adding.
10. **Pool**
    - AQUA snippet: "shoot for a 1 in 5 closing rate from face-to-face sales meetings" [M] https://www.aquamagazine.com/builder/article/15119418/pool-selling-secrets-from-a-marketing-guy
    - Skimmer reports [H] https://help.getskimmer.com/article/178-directory-of-skimmer-reports
    - Builders rarely have 150 quotes, so the first-150 offer fails for them.
11. **Pest**
    - New Jersey rule N.J.A.C. 7:30-2.12 (snippet): "no person shall advertise in a manner which states or implies that a pesticide… pest control technique or services including the use of pesticides, are non-toxic or safe." [H] https://regulations.justia.com/states/new-jersey/title-7/chapter-30/subchapter-2/section-7-30-2-12
    - We would need to add "safe" and "non-toxic" to the banned list for this trade.
    - GorillaDesk reports export to CSV [H] https://intercom.help/gorilladesk/en/articles/1090344-available-reports
12. **Countertops**
    - CounterGo exports quote views to CSV and has a "closed" status [H]: https://countergohelp.moraware.com/countergo-help/export-quotes-order-views and https://countergohelp.moraware.com/countergo-help/mark-a-quote-closed
    - Many quotes go to builders and designers, and homeowners buy once.
13. **Garage doors**
    - Snippet citing a 2026 valuation guide: "55 to 70 percent service and repair" work. Mostly urgent repairs. [L]
    - Workiz custom reports export to CSV [H] https://help.workiz.com/hc/en-us/articles/43912487947025-Exporting-a-custom-report-as-a-PDF-or-CSV
14. **Flooring**
    - Floor Covering News (Lisbeth Calandrino): "once a sale closes, many flooring businesses stop communicating" [M] https://www.fcnews.net/2025/12/retention-marketing-is-the-key-to-long-term-success/
15. **Detailing**
    - Only vendor claims were found. Most customers reach detailers by text or Instagram DM, so email is a weaker channel.
16. **Remodel**
    - Builder Prime (vendor, no source): "At least half of those homeowners who don't initially buy end up purchasing within the year." Don't reuse it. [L] https://www.builderprime.com/blog/how-to-close-more-sales-with-the-leads-you-already-have
    - Owner-run remodelers rarely have 150 quotes.
17. **Wedding / events**
    - Wedding Pro Survey (n=553): "Pros described couples disappearing after the initial inquiry, after receiving a proposal, or even after a consultation call." [M] https://saradoesseo.com/wedding-marketing/wedding-pro-survey-2025/
    - HoneyBook venue study: inquiries arrive by email only 27.2% of the time, texts 26.7%, Instagram 12.6% [M] https://techstartups.com/2026/08/04/wedding-venue-booking-inquiries-scattered-across-communication-channels-honeybook-data-shows/
    - The quiet-quote breakage matches, but there is no second purchase and email reaches under a third of inquiries.
18. **Moving / junk / mobile mechanics**
    - Census (ACS, snippet): "The percentage of movers to a different residence in 2024 was 11.8 percent", so asking past customers back rarely pays. [H] https://www.census.gov/topics/population/migration/guidance/acs-1yr.html
    - The move date forces a decision anyway, and moving software already auto-follows unbooked estimates.
    - Junk removal is priced on site with same-day pickup [M] https://www.getjobber.com/academy/junk-removal/how-to-price-a-junk-removal-job/
19. **Solar**
    - Texas: 5-business-day cancellation right (Occupations Code 1806.156), and retailer/salesperson registration from Sept 1, 2026 [H] https://www.tdlr.texas.gov/residential-solar-retailers/
    - Also Colorado SB25-299 https://leg.colorado.gov/bills/sb25-299, California SB 784 and Oregon HB 4029.
    - TCPA class actions, e.g. Momentum Solar up to $30M [M] https://www.classaction.org/news/up-to-30m-momentum-solar-settlement-ends-class-action-lawsuits-over-alleged-robocalls
    - Mostly sales organizations, not owner-run shops.
20. **Dental / med spa**
    - The breakage is real. ADA: "If too much time goes by before they are reappointed, it is less likely that they will come back." [H] https://www.ada.org/resources/practice/practice-management/accepted-treatment
    - But a vendor emailing patients needs a HIPAA business associate agreement [M] https://www.paubox.com/blog/hipaa-compliant-email-marketing-for-dentists
    - Health information in email, and state consumer-health-data laws, make it a different business.

## Top 5 to add next, and why

1. **Holiday + permanent lighting.**
   - Coming back every year is the whole business model. It is quoted, runs on Jobber, has four-figure tickets, and is sold right now (returning clients book Sept–Oct).
   - Many of our current targets (landscapers, pressure washers, roofers, gutter shops) already hang lights. So it is also an upsell line for existing clients.
   - Caveat: under the quiet-month guarantee, a lights-only shop pays for about 4 months a year. Sell it as a line inside a shop that works more than one season, or to lighting shops with 2+ seasons of past customers.
   - Engine: new `holiday_lighting`, 12-month clock, sends Aug 20–Oct 31, plus a "permanent lighting" upgrade note to past seasonal customers.
2. **Hardscape / design-build.**
   - Big tickets, spring book-out, and our best proof (Capital City).
   - Mostly marketing work (a focus page) plus the LMN/SynkedUP export steps. The engine already has `land.hardscape`.
3. **Decks and outdoor structures.**
   - Buys like fence (seasonal, permits, $18–25k), and the shops are small (49% have 5 or fewer employees).
   - Staining makes a real 24–36-month clock.
   - Engine: new `deck`, reusing the fence seasonality and the `paint.deck` interval.
4. **Exterior cleaning.**
   - Clearest owner evidence of the exact breakage: one email, one text, "DOA". Heavy Jobber use, and several clocks for past customers.
   - Already in the engine, so it only needs a focus page.
   - Qualify on revenue, because tickets are small.
5. **Garage floor coatings.**
   - Paid-lead volume ($2.5k tickets, HomeAdvisor category), so 150 quiet quotes pile up fast. Exports from Jobber/Markate.
   - Weak for past customers, so lead with quotes plus other surfaces and neighbors.
   - Engine: new `floor_coating`, split out of the concrete regex.

**Runners-up:** sealcoating (as a concrete clock), owner-run HVAC, retail roofing (needs a JobNimbus importer and insurance guards), generators.

## Guards to add if these go in

- **Financing (roofing, HVAC, decks, generators, remodel):** never quote payment amounts or terms in a note. Under Reg Z, stating those "trigger terms" requires full credit disclosures (12 CFR 1026.24(d); not fetched this session).
- **Roofing:** never mention deductibles or insurance claims.
- **Pest:** never say "safe" or "non-toxic".
- **Franchises and dealers:** confirm the owner controls the list and the sending domain.

## Validation before announcing

For each new trade, get exports from 2–3 shops and run the 10-second browser check. Add the trade only if all of these hold:

- 150 or more quotes with no yes/no after 30 days, or past customers past their due date;
- a quiet share of 50% or more;
- a median ticket of $1,500 or more (or $750 or more with a clock of 12 months or less).

Holiday lighting, decks and floor coatings are **unproven** until that is done. No shop results exist for any of them, and none should be implied.

## Flags for the parent

- `docs/research/market-brief.md` line 394 credits https://pressurewashingresource.com/community/t/need-help-staying-organized/19385 with "Email blast was to about 40 and closed 5". That thread is about storing pump sprayers. Re-source the quote or drop it.
- Jobber's 2026 survey says "69% of pros report a win rate of more than 50%". That is self-reported and conflicts with the export-based ~2.7% recovery figures. Don't pair them on the site.