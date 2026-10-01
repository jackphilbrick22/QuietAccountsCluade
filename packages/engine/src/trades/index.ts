import type { LineItem, SeasonFit, TradeId } from "../model.ts";
import { OFFERED_TRADES, PLAYBOOKS } from "./playbooks.ts";
import { climateOf, type Climate, type ServiceDef, type TradePlaybook } from "./types.ts";

export { OFFERED_TRADES, PLAYBOOKS, TRADE_OPTIONS } from "./playbooks.ts";
export { climateOf, WARM_STATES, type Climate, type ServiceDef, type TradePlaybook } from "./types.ts";
export { comesBackEachSeason, goneForSeason, growingSeason, SEASONAL_TRADES, sellingFrom, sellingSeason, sellingWindow, shopSeasonEnd, stateOf, tradesOf, type Season } from "./seasons.ts";

export function playbook(trade: TradeId | undefined): TradePlaybook {
  return PLAYBOOKS[trade ?? "general"] ?? PLAYBOOKS.general;
}

/** Words that say little about which service it is (materials, filler). */
const GENERIC = /^(new|install(ation)?|fence|tree|trees|lawn|service|services|work|wood|vinyl|cedar|aluminum|board|picket|maint(enance)?|clean|check|plan|program|treatment|routine|lot)$/i;

const PRIORITY: Record<ServiceDef["kind"], number> = { hazard: 30, repair: 20, maintenance: 5, recurring: 5, improvement: 0 };

function earliestSpecific(text: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  let generic = -1;
  while ((m = g.exec(text))) {
    if (m[0] === "") {
      g.lastIndex++;
      continue;
    }
    const word = m[0].trim();
    if (!GENERIC.test(word)) return m.index;
    if (generic < 0) generic = m.index + 1000; // generic matches only count when nothing specific matched
  }
  return generic;
}

/**
 * The service for work whose title names none we know ("Firewood delivery", "No heat", "Fall cleanup"): plain work,
 * with no clock, no follow-on and no season of its own, so no note says it was a tune-up or a removal.
 */
export const UNKNOWN_SERVICE_ID = "gen.work";

/** Which service a quote/job is for, across the business's trades. `matched` is false when the title names none. */
export function classifyService(title: string, lineItems: LineItem[] = [], trades: TradeId[] = ["general"]): { trade: TradeId; service: ServiceDef; matched: boolean } {
  const lines = [title, ...lineItems.map((l) => l.name)];
  const text = lines.join(" · ");
  const excepted = (s: ServiceDef): boolean => {
    if (!s.unless) return false;
    if (!s.unlessPrimaryLine) return s.unless.test(text);
    // the line that says what the job is: the title, or the first line item naming this work or its exception
    const primary = lines.find((l) => s.match.test(l) || s.unless!.test(l));
    return primary !== undefined && s.unless.test(primary);
  };
  let best: { trade: TradeId; service: ServiceDef; score: number } | undefined;
  for (const t of trades) {
    for (const s of playbook(t).services) {
      if (s.id === "gen.work" || excepted(s)) continue;
      const idx = earliestSpecific(text, s.match);
      if (idx < 0) continue;
      const score = idx - PRIORITY[s.kind];
      if (!best || score < best.score) best = { trade: t, service: s, score };
    }
  }
  if (best) return { trade: best.trade, service: best.service, matched: true };
  // never the trade's first service: "Firewood delivery" isn't a removal, "No heat" isn't a tune-up
  return { trade: trades[0] ?? "general", service: PLAYBOOKS.general.services.find((s) => s.id === UNKNOWN_SERVICE_ID)!, matched: false };
}

export function findService(serviceId: string): { trade: TradeId; service: ServiceDef } | undefined {
  for (const pb of Object.values(PLAYBOOKS)) {
    const s = pb.services.find((x) => x.id === serviceId);
    if (s) return { trade: pb.id, service: s };
  }
  return undefined;
}

function pluralize(phrase: string, matched: string): string {
  const m = matched.toLowerCase();
  const lastWord = (x: string) => (x.toLowerCase().split(/\s+/).pop() ?? "").replace(/[^a-z]/g, "");
  // only the object word itself takes the plural: "the oaks", never "the house washs"
  if (!lastWord(m).startsWith(lastWord(phrase).replace(/y$/, ""))) return phrase;
  if (/ies$/.test(m) && /y$/.test(phrase)) return phrase.slice(0, -1) + "ies";
  if (/(ches|shes|xes|sses)$/.test(m) && !/(ches|shes|xes|sses)$/.test(phrase)) return phrase + "es";
  if (/[^s]s$/.test(m) && !/s$/.test(phrase)) return phrase + "s";
  return phrase;
}

/**
 * The phrase a person would use for the work: "the oak by the driveway",
 * "the pines over the garage", "the septic pump-out".
 */
export function jobPhrase(title: string, trade: TradeId, lineItems: LineItem[] = [], custom: [RegExp, string][] = []): string {
  const pb = playbook(trade);
  // items stay apart, so "AC replacement - 3 ton" + "AC replacement" never reads as "3 ton AC"
  const text = [title, ...lineItems.slice(0, 3).map((l) => l.name)].join(" · ");
  for (const [re, phrase] of custom) if (re.test(text)) return phrase;
  let object: string | undefined;
  for (const [re, phrase] of pb.objects) {
    const m = text.match(re);
    if (m) {
      object = pluralize(phrase, m[0]);
      const counted =
        new RegExp(`\\b(two|three|four|five|six|several|multiple|[2-9]|1[0-9]|2[0-9])\\s+(?!(?:gal|gallons?|ft|foot|feet|sq|yds?|yards?|in|inch|lf|x|tons?|acres?|sections?|zones?|panels?|posts?|stor(?:y|ies)|br|bed(?:room)?s?|bath(?:room)?s?|hours?|hrs?|visits?|weeks?|months?|years?)\\b)(\\w+\\s+)?${m[0]}`, "i").test(text) ||
        /\bx\s?[2-9]\b|\(\s*(qty:?\s*)?[2-9]\s*\)|\bqty:?\s*[2-9]\b/i.test(text);
      if (counted && !/s$/.test(object)) object = pluralize(phrase, /(ch|sh|x|ss)$/i.test(m[0]) ? m[0] + "es" : /[^aeiou]y$/i.test(m[0]) ? m[0].slice(0, -1) + "ies" : m[0] + "s");
      break;
    }
  }
  if (object) {
    for (const [re, place] of pb.places) {
      if (re.test(text) && !object.includes(place.split(" ").pop()!)) return `${object} ${place}`;
    }
    return object;
  }
  const { service, matched } = classifyService(title, lineItems, [trade]);
  if (matched) return service.phrase;
  return pb.workPhrase;
}

export function seasonFit(service: ServiceDef, climate: Climate, month: number): SeasonFit {
  const months = service.season[climate] ?? service.season.cold ?? [];
  if (!months.length || months.length >= 12) return "now";
  if (months.includes(month)) return "now";
  const next1 = (month % 12) + 1;
  const next2 = (next1 % 12) + 1;
  if (months.includes(next1) || months.includes(next2)) return "soon";
  return "off";
}

/** Months until this service is next in season (0 = now). */
export function monthsUntilSeason(service: ServiceDef, climate: Climate, month: number): number {
  const months = service.season[climate] ?? service.season.cold ?? [];
  if (!months.length) return 0;
  for (let i = 0; i < 12; i++) {
    const m = ((month - 1 + i) % 12) + 1;
    if (months.includes(m)) return i;
  }
  return 0;
}

export function isPeak(trade: TradeId, climate: Climate, month: number): boolean {
  return playbook(trade).peakMonths[climate].includes(month);
}

export function businessClimate(state: string | undefined): Climate {
  return climateOf(state);
}

/** Words that name a trade's own work. When a title has one, it outvotes broad service patterns. */
const TRADE_WORDS: Partial<Record<TradeId, RegExp>> = {
  tree: /\b(trees?|oaks?|maples?|pines?|spruces?|birch(es)?|ash|hemlocks?|willows?|stumps?|prun\w*|limbs?|arbor\w*|crown thin\w*|cabl(e|ing) & brac\w*)\b/i,
  fence: /\b(fenc\w*|gates?|pickets?|chain ?link|privacy)\b/i,
  // "driveway" alone is as likely a wash as a pour; replacing or pouring one is concrete work
  concrete: /\b(concrete|slab|mudjack\w*|pour\w*|stamped|flatwork|sealcoat\w*|asphalt|(replace|new|install)\w* driveway|driveway (replace\w*|install\w*|extension))\b/i,
  // "pressure treated" is lumber, not a wash
  pressure_washing: /\b(pressure(?![- ]treated)|power ?wash\w*|soft ?wash\w*|house wash|surface clean\w*|driveway (&|and) walks?|(driveway|patio|deck|siding) (clean|wash)\w*)\b/i,
  gutter: /\b(gutters?|downspouts?)\b/i,
  pool: /\b(pool|spa|liner)\b/i,
  roofing: /\b(roof\w*|shingles?|flashing|skylights?|re-?roof)\b/i,
  chimney: /\b(chimney|flue|fireplace|dryer vent|tuckpoint\w*)\b/i,
  window_cleaning: /\b(windows?|skylights?|screens?)\b/i,
  painting: /\b(paint\w*|stain\w*|primer|cabinets?)\b/i,
  irrigation: /\b(sprinklers?|irrigation|drip line|blow-?out|backflow|winteriz\w*|start-?up)\b/i,
  lawn: /\b(mow\w*|lawn|aerat\w*|overseed\w*|fertiliz\w*|weed\w*|grub)\b/i,
  landscape: /\b(landscap\w*|mulch|pavers?|retaining|sod|shrubs?|plantings?|beds?)\b/i,
  septic: /\b(septic|pump-?out|drain ?field|leach\w*|effluent|baffles?|risers?|aerobic)\b/i,
  hvac: /\b(hvac|furnace|a\/?c|air condition\w*|heat pump|mini-?split|duct\w*|thermostat|tune-?up|igniter)\b/i,
  pest: /\b(pest|termites?|rodents?|mosquito\w*|ticks?|wasps?|hornets?|bed ?bugs?|ants?)\b/i,
  junk_removal: /\b(junk|haul\w*|clean-?out|debris|dumpster|demolition|removal - |pickup)\b/i,
  // "Standard Cleaning" is what booking software (BookingKoala, Launch27) calls a regular house clean
  cleaning: /\b(maid|move-?out|deep clean|standard clean\w*|bi-?weekly clean\w*|house ?clean\w*|carpet clean\w*|post-construction clean)\b/i,
  // plain "lights" is landscape and path lighting too; these name holiday or permanent roofline work
  holiday_lighting: /\b(christmas|xmas|holiday (light\w*|decor\w*|display)|c9s?|c7s?|mini[- ]lights|wreaths?|garlands?|roofline|permanent (led |house |home |roofline |track |eave |christmas |holiday )?light\w*|trimlight|gemstone lights?|jellyfish lights?|light(s|ing)? (take-?down|removal|storage)|take-?down (&|and|\+|\/) storage)\b/i,
  // "deck stain" and "deck wash" are shared with painting and washing on purpose, so neither shop reads as a second
  // trade of the other; a pool deck is the pool's
  deck: /\b(?<!pool )decks?\b|\b(decking|pergolas?|trex|timbertech|azek|fiberon|joists?|screen(ed)?[- ](in )?porch)\b/i,
};

/**
 * Words that settle a title by themselves. "Christmas lights - roofline + 2 trees" names a roof and trees, but it is
 * lighting work: it votes for lighting alone.
 */
const SETTLED_BY: Partial<Record<TradeId, RegExp>> = {
  holiday_lighting: /\b((christmas|xmas|holiday) (lights?|lighting|light install\w*|decor\w*|display)|c9s?|c7s?|mini[- ]lights|permanent (led |house |home |roofline |track |eave |christmas |holiday )?light(s|ing)?|trimlight|gemstone lights?|jellyfish lights?)\b/i,
};

/**
 * Which trade(s) this business is, read from its own quote and job titles — so setup never asks.
 * Each title votes: for the trades whose own words it uses, else for the trades whose services it fits;
 * a title that fits one trade counts fully, one that fits three counts a third to each. Only the trades the offers
 * sell are candidates: "Standard Cleaning" is a cleaning job, never a deck company's.
 */
export function detectTrade(titles: string[]): { trade: TradeId; others: TradeId[]; confidence: number; counts: Partial<Record<TradeId, number>> } {
  const counts: Partial<Record<TradeId, number>> = {};
  const only: Partial<Record<TradeId, number>> = {};
  const all = OFFERED_TRADES;
  let classified = 0;
  for (const title of titles.slice(0, 3000)) {
    if (!title) continue;
    let fits = all.filter((t) => TRADE_WORDS[t]?.test(title));
    const settled = fits.filter((t) => SETTLED_BY[t]?.test(title));
    if (settled.length) fits = settled;
    if (!fits.length)
      fits = all.filter((t) => playbook(t).services.some((sv) => { if (sv.unless?.test(title)) return false; const i = earliestSpecific(title, sv.match); return i >= 0 && i < 1000; }));
    if (!fits.length) continue;
    classified++;
    for (const t of fits) counts[t] = (counts[t] ?? 0) + 1 / fits.length;
    if (fits.length === 1) only[fits[0]!] = (only[fits[0]!] ?? 0) + 1;
  }
  const ranked = (Object.entries(counts) as [TradeId, number][]).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || classified < 5) return { trade: "general", others: [], confidence: 0, counts };
  const [top, n] = ranked[0]!;
  // a second trade needs real work of its own (5+ titles only it could mean), not shared words
  const others = ranked.slice(1).filter(([t, c]) => c / classified >= 0.15 && (only[t] ?? 0) >= 5).map(([t]) => t).slice(0, 3);
  return { trade: top, others, confidence: Math.round((n / classified) * 100) / 100, counts };
}
