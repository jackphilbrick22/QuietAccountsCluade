/**
 * The only outside numbers Quiet Accounts is allowed to show an owner.
 * Every entry has a traceable source. Anything not in this file — "80% of sales need
 * five follow-ups", "82% higher conversion with texts" — stays out of the product.
 * First-party numbers (this business's own results) always beat these.
 */
export interface Claim {
  id: string;
  /** What we can say, in plain words. */
  text: string;
  /** Short attribution shown under the claim. */
  source: string;
  url: string;
  year: number;
  /** How much weight to put on it. */
  caveat: string;
}

export const CLAIMS: Claim[] = [
  {
    id: "thrive-2025-followup-income",
    text: "Nearly half of contractors doing $10M+ say following up on estimates brings in 11–15% of their income.",
    source: "ServiceTitan 2025 Residential Services Report (Thrive Analytics, 1,000+ contractors)",
    url: "https://www.servicetitan.com/press/residential-industry-report-2025",
    year: 2025,
    caveat: "Self-reported, mostly HVAC/plumbing/electrical/roofing. Quote only with this attribution.",
  },
  {
    id: "arbostar-2025-tree-conversion",
    text: "In tree work, about 4 in 10 estimates never turn into a job.",
    source: "ArboStar, a year of tree-company records (2025 data, published Apr 2026)",
    url: "https://arbostar.com/education-hub/where-tree-service-companies-actually-lose-money",
    year: 2026,
    caveat: "Vendor data; sample size not disclosed. 61% average estimate-to-job (62.3% at 3–9 staff, 65.3% at 10–25, 56.7% at 26+). Say 'never became jobs', never 'went quiet'. Tree pages only.",
  },
  {
    id: "jobber-2026-win-rates",
    text: "Only about a third of home-service owners close more than 70% of their quotes.",
    source: "Jobber 2026 Home Service Trends Report (1,050 owners, Dec 2025)",
    url: "https://www.getjobber.com/home-service-trends-report/",
    year: 2026,
    caveat: "Self-reported win rates; 36% win more than 70%, 33% win 51–70%. Cleaning and lawn owners are the most likely not to know their own number.",
  },
  {
    id: "jobber-2026-lead-response",
    text: "Only about 1 in 5 home-service pros answer a new request within the hour. In tree care it's 21%, in cleaning 26%.",
    source: "Jobber 2026 Home Service Trends Report (1,050 owners, Dec 2025)",
    url: "https://www.getjobber.com/home-service-trends-report/",
    year: 2026,
    caveat: "Self-reported by owners. Don't cite the same page's '70% of customers expect a same-day response' — the page never says which survey it comes from.",
  },
  {
    id: "hcp-not-retroactive",
    text: "Built-in estimate follow-ups only run on estimates sent after you turn them on — every older quote gets nothing.",
    source: "Housecall Pro Help Center (automation rules); Workiz Help Center",
    url: "https://help.housecallpro.com/",
    year: 2026,
    caveat: "Documented product behavior.",
  },
  {
    id: "jobber-two-reminders",
    text: "Jobber's quote follow-ups send at most two reminders, and only while a quote is still 'awaiting response'.",
    source: "Jobber Help Center — Automations",
    url: "https://help.getjobber.com/en/articles/automations/",
    year: 2026,
    caveat: "Documented product behavior. Requires the Connect plan or higher.",
  },
  {
    id: "jobber-automations-not-retroactive",
    text: "Jobber's custom automations don't reach quotes from before they were set up.",
    source: "Jobber Help Center — Custom Automation Builder",
    url: "https://help.getjobber.com/en/articles/custom-automation-builder/",
    year: 2026,
    caveat: 'Documented for custom automations ("will not apply to any past items retroactively"). The built-in quote reminder\'s behavior on older quotes isn\'t documented: check it on a Jobber test account before saying it about the built-in one.',
  },
  {
    id: "tcia-followup-standard",
    text: "The tree-care trade press recommends checking the quote arrived the same day, calling at five business days, and getting a yes or no within two to three weeks.",
    source: "TCI Magazine (Tree Care Industry Association), 'A successful sales process outline'",
    url: "https://tcimag.tcia.org/sales-marketing/a-successful-sales-process-outline/",
    year: 2024,
    caveat: "Guidance, not a measured result.",
  },
  {
    id: "epa-septic-interval",
    text: "The EPA says a household septic system should be inspected at least every three years and pumped every three to five.",
    source: "US EPA — How to Care for Your Septic System",
    url: "https://www.epa.gov/septic/how-care-your-septic-system",
    year: 2024,
    caveat: "Alternative systems with pumps or floats need a yearly check.",
  },
  {
    id: "servicetitan-repeat-share",
    text: "For residential contractors, repeat customers bring in about 39% of revenue.",
    source: "ServiceTitan Residential Services Report 2023 (Thrive Analytics, 1,000+ contractors)",
    url: "https://www.servicetitan.com/press/industry-trends-residential-services",
    year: 2023,
    caveat: "Survey; mostly HVAC/plumbing/electrical. The same report's 71% is business from word-of-mouth referrals — not repeat jobs.",
  },
  {
    id: "hubspot-plain-text",
    text: "The more an email looks like a designed newsletter, the fewer people open it — even one image lowers clicks.",
    source: "HubSpot first-party data (500M+ marketing emails plus A/B tests)",
    url: "https://blog.hubspot.com/marketing/plain-text-vs-html-emails-data",
    year: 2025,
    caveat: "Measured opens and clicks, not replies.",
  },
  {
    id: "angi-pays-regardless",
    text: "Angi charges pros for every match, whether or not they end up doing the job.",
    source: "Angi Inc. 10-K, fiscal 2025",
    url: "https://www.sec.gov/Archives/edgar/data/1705110/000170511026000011/angi-20251231.htm",
    year: 2026,
    caveat: "Filing wording: 'regardless of whether the Pro ultimately provides the requested service'.",
  },
  {
    id: "lead-cost-by-trade",
    text: "A request from a Google Local Services ad costs about $38 for tree work, $33 for painting and $33 for cleaning; a painting request from Google search costs about $138.",
    source: "99 Calls LSA data (Apr–Jun 2026); LocaliQ search benchmarks (3,211 campaigns, 2024–25, localiq.com/blog/home-services-search-advertising-benchmarks)",
    url: "https://99calls.com/blog/lsa-cost-per-lead-by-industry",
    year: 2026,
    caveat: "Agency and platform data, not a survey of every shop. Fence has no solid figure. Always show the source beside the number; the owner's own cost beats it.",
  },
  {
    id: "angi-putting-off",
    text: "71% of homeowners put off at least one home project last year; interior painting was one of the most put off.",
    source: "Angi 2025 State of Home Spending Pulse (1,000 homeowners)",
    url: "https://www.angi.com/press/angis-2025-state-of-home-spending-pulse-report",
    year: 2025,
    caveat: "Use for 'a quiet quote usually isn't a no', not as a win rate.",
  },
  {
    id: "hcp-hire-again",
    text: "68% of homeowners say they'd hire the same company again.",
    source: "Housecall Pro customer service report (1,040 homeowners, Oct 2025)",
    url: "https://www.housecallpro.com/resources/home-service-customer-service-report-trends-statistics/",
    year: 2025,
    caveat: "Stated intent, not measured repeat hiring.",
  },
  {
    id: "jobber-homebuyers-no-answer",
    text: "Of 800 new homeowners, 15% had to chase a pro again and again, and 9% never heard back at all.",
    source: "Jobber Recent Homebuyer Report (Coleman Parkes, May 2026)",
    url: "https://www.getjobber.com/recent-homebuyer-report/",
    year: 2026,
    caveat: "The page doesn't say whether the base is all 800 or only those who hired.",
  },
  {
    id: "yelp-reply-within-hour",
    text: "People are twice as likely to write back when a pro replies within the hour.",
    source: "Yelp for Business (platform data, May 2025)",
    url: "https://business.yelp.com/resources/articles/4-tips-for-turning-job-requests-into-sales/",
    year: 2025,
    caveat: "Measures replies, not hires; method not published.",
  },
  {
    id: "google-lsa-responsiveness",
    text: "Google ranks Local Services ads partly on how fast you answer; missed calls can count against you.",
    source: "Google Local Services Help",
    url: "https://support.google.com/localservices/answer/7527305?hl=en",
    year: 2026,
    caveat: "Documented ranking factor; weight not disclosed.",
  },
];

/** Numbers we have checked and must never use. */
export const BANNED_STATS: { text: string; why: string; pattern: RegExp }[] = [
  { text: "80% of sales need 5+ follow-ups / 2% close on first contact", why: "Traces to a 1942 survey of under 40 people; the most-cited author revised it in 2025.", pattern: /\b80\s?%[^.]{0,60}(follow|contact|touch)|\b2\s?%[^.]{0,40}first (contact|call)/i },
  { text: "44% give up after one follow-up / 48% never follow up", why: "No source; companion figures to the 80% myth.", pattern: /\b(44|48)\s?%[^.]{0,50}(give up|never follow)/i },
  { text: "64% say no four times / 72% never follow up / 87% give up after one", why: "Recycled vendor blog myths with no primary study.", pattern: /\b(64|72|87)\s?%[^.]{0,50}(say no|never follow|give up)/i },
  { text: "82% higher conversion with text messages", why: "No source. The traceable 2013 Leads360 study says 40%, in mortgage/insurance, not trades.", pattern: /\b82\s?%[^.]{0,40}(higher|more)/i },
  { text: "SMS 98% open / 45% response rate", why: "Recycled marketing stat with no published method.", pattern: /\b98\s?%[^.]{0,30}open/i },
  { text: "7x more likely to win / 8x higher close rate if you respond in 5 minutes", why: "HBR and InsideSales measured contact and qualification, not sales.", pattern: /\b(7|8|9|21|60|100)\s?(x|times)[^.]{0,60}(win|close|closing|likely)/i },
  { text: "ServiceTitan 2024 Field Service Benchmark: +12–16 point close-rate lift / 18–24% of lost bids recovered", why: "Fabricated attribution; the real report has no quote data.", pattern: /field service benchmark|18\s?[-–]\s?24\s?%[^.]{0,30}(lost|bids)/i },
  { text: "Lawn care offers a 217% ROI", why: "Cites only 'recent industry reports'.", pattern: /\b217\s?%/i },
  { text: "60–70% of estimates die from silence", why: "SEO content with no primary source.", pattern: /\b60\s?[-–]\s?70\s?%[^.]{0,40}(estimate|quote)/i },
  { text: "Following up within an hour closes 30–50% more", why: "No primary source for trades.", pattern: /\b30\s?[-–]\s?50\s?%[^.]{0,40}(more|close)/i },
  { text: "44% / 35% / 25% first-year revenue growth from field-service software", why: "Measures revenue run through the platform, not business growth.", pattern: /\b(44|35|25)\s?%[^.]{0,40}revenue growth/i },
  { text: "PCA 2025: painters close 22% / 38% never decided / 28% color paralysis", why: "No traceable PCA report; copied from a vendor blog with no link.", pattern: /\b22\s?%[^.]{0,40}clos|\b38\s?%[^.]{0,40}never decid|colou?r paralysis/i },
  { text: "78% (or 83%) hire the first company to respond", why: "Stated preference from lead-response vendors, not measured hires.", pattern: /\b(78|83)\s?%[^.]{0,60}(first|respond)/i },
  { text: "62% of calls go unanswered / 48% of home-service calls unanswered", why: "411 Locals 2016 (85 businesses), and a misreading of Invoca's 52% who reach a person.", pattern: /\b(62|48)\s?%[^.]{0,40}(call|phone)[^.]{0,30}(unanswered|missed|go to voicemail)/i },
  { text: "25–40% of estimates are recoverable / contractors follow up only 10–25% of the time", why: "Unsourced agency and SEO content.", pattern: /\b25\s?[-–]\s?40\s?%[^.]{0,40}(recover|estimate)|\b10\s?[-–]\s?25\s?%[^.]{0,40}(follow|time)/i },
  { text: "5% more retention = 25–95% more profit", why: "Bain's figure is for financial services, not home services.", pattern: /25\s?(%|percent)?\s?(to|[-–])\s?95\s?%/i },
];

/** The banned stat a piece of copy repeats, if any. Used by the note linter and the AI writer's guardrail. */
export function bannedStatIn(text: string): string | undefined {
  return BANNED_STATS.find((b) => b.pattern.test(text))?.text;
}

export function claim(id: string): Claim | undefined {
  return CLAIMS.find((c) => c.id === id);
}

/**
 * Checks our OWN marketing and onboarding copy (landing page, audit, sales texts) against the lines that
 * got HomeAdvisor and others in trouble. Returns the problems; empty = fine to publish.
 */
export function lintMarketing(text: string): string[] {
  const out: string[] = [];
  const t = text.replace(/\s+/g, " ");
  const banned = bannedStatIn(t);
  if (banned) out.push(`Repeats an unsourced stat: ${banned}`);
  if (/\bguarantee[ds]?\b[^.]{0,40}\b\d{1,3}\s?%/i.test(t) || /\b\d{1,3}\s?%[^.]{0,40}\bguarantee[ds]?\b/i.test(t)) out.push("Guarantees a percentage — the guarantee is about replies, never a lift figure");
  if (/\brisk[- ]free\b/i.test(t)) out.push('"Risk-free" — say exactly what happens instead ("Any month nobody asks to come back is free.")');
  if (/\bmoney[- ]back\b/i.test(t)) out.push('"Money-back" means a full refund on request under the FTC Guarantee Guides — we don\'t offer that; describe the free month instead');
  if (/\bup to \d{1,3}\s?%/i.test(t) && !/\b(typical|median|most (shops|owners))\b/i.test(t)) out.push('"Up to N%" without the typical result beside it');
  if (/\b(only|just) \d+ (spots|slots|openings) (left|remaining)\b|\b(expires|ends) (tonight|today|soon)\b/i.test(t)) out.push("Scarcity or deadline language — only with a real, enforced limit");
  if (/\bexclusive (territory|area|market)\b/i.test(t)) out.push("Territory exclusivity — only if the system enforces it");
  if (/\b(ai|artificial intelligence)[- ]powered\b/i.test(t)) out.push('Leads with "AI" — owners distrust it; lead with the result');
  return out;
}
