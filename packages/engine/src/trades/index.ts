import type { LineItem, SeasonFit, TradeId } from "../model.ts";
import { PLAYBOOKS } from "./playbooks.ts";
import { climateOf, type Climate, type ServiceDef, type TradePlaybook } from "./types.ts";

export { PLAYBOOKS, TRADE_OPTIONS } from "./playbooks.ts";
export { climateOf, WARM_STATES, type Climate, type ServiceDef, type TradePlaybook } from "./types.ts";

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

/** Which service a quote/job is for, across the business's trades. */
export function classifyService(title: string, lineItems: LineItem[] = [], trades: TradeId[] = ["general"]): { trade: TradeId; service: ServiceDef; matched: boolean } {
  const text = [title, ...lineItems.map((l) => l.name)].join(" · ");
  let best: { trade: TradeId; service: ServiceDef; score: number } | undefined;
  for (const t of trades) {
    for (const s of playbook(t).services) {
      if (s.id === "gen.work") continue;
      const idx = earliestSpecific(text, s.match);
      if (idx < 0) continue;
      const score = idx - PRIORITY[s.kind];
      if (!best || score < best.score) best = { trade: t, service: s, score };
    }
  }
  if (best) return { trade: best.trade, service: best.service, matched: true };
  const t = trades[0] ?? "general";
  const pb = playbook(t);
  return { trade: t, service: pb.services[0] ?? PLAYBOOKS.general.services[0]!, matched: false };
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
  const text = [title, ...lineItems.slice(0, 3).map((l) => l.name)].join(" ");
  for (const [re, phrase] of custom) if (re.test(text)) return phrase;
  let object: string | undefined;
  for (const [re, phrase] of pb.objects) {
    const m = text.match(re);
    if (m) {
      object = pluralize(phrase, m[0]);
      const counted =
        new RegExp(`\\b(two|three|four|five|six|several|multiple|[2-9]|1[0-9]|2[0-9])\\s+(?!(?:gal|gallons?|ft|foot|feet|sq|yds?|yards?|in|inch|lf|x)\\b)(\\w+\\s+)?${m[0]}`, "i").test(text) ||
        /\bx\s?[2-9]\b|\(\s*(qty:?\s*)?[2-9]\s*\)|\bqty:?\s*[2-9]\b/i.test(text);
      if (counted && !/s$/.test(object)) object = pluralize(phrase, /(ch|sh|x|ss)$/i.test(m[0]) ? m[0] + "es" : m[0] + "s");
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
