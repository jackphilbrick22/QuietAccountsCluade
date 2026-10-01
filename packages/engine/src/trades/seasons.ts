import type { BusinessProfile, ISODate, TradeId } from "../model.ts";
import { addDays, addMonths, daysBetween, minDate, parseAddress } from "../util.ts";
import { PLAYBOOKS } from "./playbooks.ts";
import { climateOf, type Climate, type ServiceDef } from "./types.ts";

/**
 * Lawn seasons. Mowing and maintenance contracts stop for the winter: a regular who was here at the end of last season
 * isn't gone over the winter, a weekly one is worth the season's weeks rather than 52, and the shop's past customers
 * hear from it when people buy lawn work (fall clean-up, spots for spring), never in December.
 */

/** The trades whose regular work runs in the growing season. */
export const SEASONAL_TRADES = new Set<TradeId>(["lawn", "landscape"]);

/**
 * The north: northern New England, Massachusetts and New York, the upper Great Lakes, the northern plains and Rockies,
 * and Alaska. Its growing season opens about six weeks into the cold climate's first month (New Hampshire mows
 * mid-April to the end of October, about 28 weeks), and fall clean-up sells until mid-November.
 */
const NORTH = new Set(["ME", "NH", "VT", "MA", "NY", "MI", "WI", "MN", "ND", "SD", "MT", "WY", "ID", "AK"]);
const NORTH_OPENS_LATE = 45;
/**
 * A shop's own season can end up to six weeks before its climate's close (Minnesota mows into early October); records
 * of regular work that stop earlier than that are short, not the season.
 */
const SEASON_ENDS_EARLY = 42;

/** The growing season's months, per climate, are the mowing's. */
const MOWING = PLAYBOOKS.lawn.services.find((s) => s.id === "lawn.mow")!;

export interface Season {
  climate: Climate;
  /** "MM-DD": when regular work starts and stops each year. */
  opens: string;
  closes: string;
  /** Days from opening to close: what a regular's visits a year count over. */
  days: number;
  /** "MM-DD": the last day fall clean-up is sold. */
  fallEnds: string;
}

/** The business's state: the one on its profile, else the one in its mailing address. */
export function stateOf(b: Pick<BusinessProfile, "state" | "mailingAddress">): string | undefined {
  return (b.state || parseAddress(b.mailingAddress)?.state)?.toUpperCase();
}

/**
 * The growing season where the business is, from the mowing's months in its climate. With no state to go on it's the
 * north's, the shortest: a season taken to open too early would call everyone who isn't back yet gone.
 */
export function growingSeason(b: Pick<BusinessProfile, "state" | "mailingAddress">): Season {
  const state = stateOf(b);
  const climate = climateOf(state);
  const north = climate === "cold" && (!state || NORTH.has(state));
  const months = MOWING.season[climate]!;
  const month = (m: number) => `2001-${String(m).padStart(2, "0")}-01`;
  const opens = addDays(month(Math.min(...months)), north ? NORTH_OPENS_LATE : 0);
  const closes = addDays(addMonths(month(Math.max(...months)), 1), -1);
  return { climate, opens: opens.slice(5), closes: closes.slice(5), days: daysBetween(opens, closes), fallEnds: north ? "11-15" : "11-30" };
}

/**
 * When a seasonal shop's past customers hear from it: fall clean-up, from September to mid-November in the north (the
 * end of November elsewhere), and spots for spring, January to March. Not in summer, when the crews are full, and
 * never in December.
 */
export function sellingWindow(season: Season, day: ISODate): "fall" | "spring" | undefined {
  const md = day.slice(5);
  if (md <= "03-31") return "spring";
  if (md >= "09-01" && md <= season.fallEnds) return "fall";
  return undefined;
}

/** The first selling day from `day` on: `day` itself inside a window, else September 1st or January 1st. */
export function sellingFrom(season: Season, day: ISODate): ISODate {
  if (sellingWindow(season, day)) return day;
  const y = Number(day.slice(0, 4));
  return day.slice(5) < "09-01" ? `${y}-09-01` : `${y + 1}-01-01`;
}

/**
 * The selling season a seasonal shop's note is written for, with its year: "2027-spring" (spots for spring from
 * January, then spring's clean-ups and mulch) or "2026-fall" (aeration from August, then fall clean-up). Every stretch
 * of days its notes may go out in lies inside one, and their words are that season's ("we're setting the spring routes
 * now"), so a note held into another (an OK that came late, a pause) never goes.
 */
export function sellingSeason(day: ISODate): string {
  return `${day.slice(0, 4)}-${day.slice(5) < "07-01" ? "spring" : "fall"}`;
}

/**
 * The trades a business's work is read against: its own, and for a lawn or landscape shop the other seasonal
 * playbook too, so a landscaper's fall clean-up and a lawn shop's mulch are each the work they are.
 */
export function tradesOf(b: Pick<BusinessProfile, "trade" | "otherTrades">): TradeId[] {
  const own = [b.trade, ...b.otherTrades];
  return SEASONAL_TRADES.has(b.trade) ? [...new Set([...own, ...SEASONAL_TRADES])] : own;
}

const SEASONAL_WORK = new Set([...SEASONAL_TRADES].flatMap((t) => PLAYBOOKS[t].services));

/** Work that comes back each season and is sold in it: holiday lights, and a seasonal shop's clean-ups, aeration and mulch. */
export function comesBackEachSeason(svc: ServiceDef): boolean {
  return !!svc.dueMonth || (svc.kind === "maintenance" && !!svc.reserviceMonths && SEASONAL_WORK.has(svc));
}

/**
 * Where a seasonal shop's own regular work ended in a year, from where each of its regulars' routines did that year
 * (`lasts`): where three in four of those still on it in the season's last six weeks had stopped. Records that stop
 * earlier are short, not the season (a regular who quit in July), and a regular or two done later than the rest don't
 * carry it on for everyone.
 */
export function shopSeasonEnd(season: Season, lasts: ISODate[]): ISODate | undefined {
  const late = lasts.filter((d) => d >= addDays(`${d.slice(0, 4)}-${season.closes}`, -SEASON_ENDS_EARLY)).sort();
  return late[Math.floor((late.length - 1) * 0.75)];
}

/**
 * Whether a seasonal regular has stopped coming, by `asOf`. He has when he didn't come back in the first four weeks of
 * his usual season (the shop's, or later when he started later than that in the season of his last visit), or when he
 * stopped mid-season: his routine's last visit (`last.visit`) came three or more of his usual visits (`every` days
 * apart; with no rhythm to go on, quiet for `quietDays`) before his season ended. It ends where the shop's own regular
 * work ended that year (`shopEnded`, once it has: see shopSeasonEnd), or earlier where he usually stops: his routine's
 * last visit in the seasons before (`ended`, latest first) when it came late in the season (one who mows only the
 * summer), or at the same time two seasons running. One season that ended early (he quit in May, and was won back) says
 * nothing about this one. Only the season counts: whoever was here at the end of his season isn't gone over the winter.
 * Other work of ours since (a fall clean-up, a bill) makes up for no missed visit, but it's being back for a season
 * (`last.seen`).
 */
export function goneForSeason(
  season: Season,
  last: { visit: ISODate; seen: ISODate },
  asOf: ISODate,
  usual: { every?: number; quietDays: number; startedOn?: ISODate; ended?: ISODate[] },
  shopEnded?: ISODate,
): boolean {
  const year = last.visit.slice(0, 4);
  const closes = `${year}-${season.closes}`;
  const missed = usual.every ? usual.every * 3 : usual.quietDays;
  // a shop that did its regular work this past week is still in its season
  const shopEnds = shopEnded && shopEnded < closes && daysBetween(shopEnded, asOf) > 7 ? shopEnded : closes;
  const [before, prior] = (usual.ended ?? []).map((d) => `${year}${d.slice(4)}`);
  const his = before && (before >= addDays(closes, -SEASON_ENDS_EARLY) || (prior && Math.abs(daysBetween(prior, before)) < missed)) ? before : undefined;
  const ends = minDate(shopEnds, his)!;
  if (last.visit >= `${year}-${season.opens}` && daysBetween(last.visit, asOf < ends ? asOf : ends) > missed) return true;
  // his usual season opens with the shop's or with his own start, but four weeks before it closes at the latest
  const opensIn = (y: number) => {
    const shop = `${y}-${season.opens}`;
    const his = usual.startedOn ? `${y}${usual.startedOn.slice(4)}` : shop;
    const latest = addDays(`${y}-${season.closes}`, -28);
    return his <= shop ? shop : his < latest ? his : latest;
  };
  // the latest season four weeks open by now
  let y = Number(asOf.slice(0, 4));
  if (asOf < addDays(opensIn(y), 28)) y--;
  return last.seen < opensIn(y);
}
