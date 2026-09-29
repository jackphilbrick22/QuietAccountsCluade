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
    text: "In tree service, about 39% of estimates never turn into a job.",
    source: "ArboStar 2025 tree-service CRM data",
    url: "https://arbostar.com/education-hub/where-tree-service-companies-actually-lose-money",
    year: 2025,
    caveat: "Vendor data; sample size not disclosed. 61% average estimate-to-job conversion (56.7% at 26+ employees).",
  },
  {
    id: "jobber-2026-win-rates",
    text: "Only about a third of home-service owners close more than 70% of their quotes.",
    source: "Jobber 2026 Home Service Trends Report (1,050 owners, Dec 2025)",
    url: "https://www.getjobber.com/",
    year: 2025,
    caveat: "Self-reported win rates; 69% say they win more than half.",
  },
  {
    id: "jobber-2026-lead-response",
    text: "Only about 1 in 5 home-service pros answer a new lead within the hour. In tree care it's 21%.",
    source: "Jobber 2026 Home Service Trends Report (1,050 owners, Dec 2025)",
    url: "https://www.getjobber.com/",
    year: 2025,
    caveat: "Self-reported by owners.",
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
    url: "https://help.getjobber.com/",
    year: 2026,
    caveat: "Documented product behavior. Requires the Connect plan or higher.",
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
    text: "Repeat customers made up 39% of revenue and 71% of jobs for residential contractors.",
    source: "ServiceTitan Residential Service Report 2023 (1,000+ contractors, not only its customers)",
    url: "https://www.servicetitan.com/",
    year: 2023,
    caveat: "Survey; mostly HVAC/plumbing/electrical.",
  },
  {
    id: "hubspot-plain-text",
    text: "The more an email looks like a designed newsletter, the fewer people open it — even one image lowers clicks.",
    source: "HubSpot first-party data (500M+ marketing emails plus A/B tests)",
    url: "https://blog.hubspot.com/marketing/plain-text-vs-html-emails-data",
    year: 2025,
    caveat: "Measured opens and clicks, not replies.",
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
  { text: "5% more retention = 25–95% more profit", why: "Bain's figure is for financial services, not home services.", pattern: /25\s?(%|percent)?\s?(to|[-–])\s?95\s?%/i },
];

/** The banned stat a piece of copy repeats, if any. Used by the note linter and the AI writer's guardrail. */
export function bannedStatIn(text: string): string | undefined {
  return BANNED_STATS.find((b) => b.pattern.test(text))?.text;
}

export function claim(id: string): Claim | undefined {
  return CLAIMS.find((c) => c.id === id);
}
