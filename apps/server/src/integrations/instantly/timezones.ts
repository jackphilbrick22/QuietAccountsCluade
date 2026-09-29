/**
 * Map a business's IANA timezone onto the short list of zone names Instantly accepts in a campaign schedule.
 *
 * VERIFIED
 *  - `campaign_schedule.schedules[].timezone` is a closed enum of 102 names (identical on create and patch).
 *    It has no America/New_York, America/Los_Angeles, America/Denver or America/Phoenix. It appears to hold one
 *    representative zone per Windows-style group (Eastern = America/Detroit, Pacific = America/Dawson...).
 *    Source: OpenAPI spec https://api.instantly.ai/openapi/api_v2.json (POST /api/v2/campaigns), rendered at
 *    https://developer.instantly.ai/api-reference/campaign/create-campaign
 *  - Instantly's own CLI (npm @instantlyai/cli 0.2.7, src/commands/campaigns/create.ts) uses "America/Detroit"
 *    for its "Mon-Fri 9am-5pm ET" default schedule, so Detroit is Instantly's Eastern Time.
 *
 * ASSUMED / CAVEATS
 *  - US Pacific → "America/Dawson". It is the enum's only Pacific entry. Current tzdata, however, has Dawson
 *    (Yukon) on permanent UTC-7 since 2020. If Instantly resolves the name with current tzdata, a Pacific business
 *    sends one hour early (local clock) from November to March. Check the schedule's label once in the Instantly UI.
 *  - The alias table covers North America plus a few common zones. Any other zone is matched by UTC offset in
 *    January and July (same offsets and same DST behaviour), using this machine's Intl tz data.
 */
import { ProviderError } from "../../contracts.ts";

export const INSTANTLY_TIMEZONES = [
  "Etc/GMT+12", "Etc/GMT+11", "Etc/GMT+10", "America/Anchorage", "America/Dawson", "America/Creston",
  "America/Chihuahua", "America/Boise", "America/Belize", "America/Chicago", "America/Bahia_Banderas",
  "America/Regina", "America/Bogota", "America/Detroit", "America/Indiana/Marengo", "America/Caracas",
  "America/Asuncion", "America/Glace_Bay", "America/Campo_Grande", "America/Anguilla", "America/Santiago",
  "America/St_Johns", "America/Sao_Paulo", "America/Argentina/La_Rioja", "America/Araguaina", "America/Godthab",
  "America/Montevideo", "America/Bahia", "America/Noronha", "America/Scoresbysund", "Atlantic/Cape_Verde",
  "Africa/Casablanca", "America/Danmarkshavn", "Europe/Isle_of_Man", "Atlantic/Canary", "Africa/Abidjan",
  "Arctic/Longyearbyen", "Europe/Belgrade", "Africa/Ceuta", "Europe/Sarajevo", "Africa/Algiers", "Africa/Windhoek",
  "Asia/Nicosia", "Asia/Beirut", "Africa/Cairo", "Asia/Damascus", "Europe/Bucharest", "Africa/Blantyre",
  "Europe/Helsinki", "Europe/Istanbul", "Asia/Jerusalem", "Africa/Tripoli", "Asia/Amman", "Asia/Baghdad",
  "Europe/Kaliningrad", "Asia/Aden", "Africa/Addis_Ababa", "Europe/Kirov", "Europe/Astrakhan", "Asia/Tehran",
  "Asia/Dubai", "Asia/Baku", "Indian/Mahe", "Asia/Tbilisi", "Asia/Yerevan", "Asia/Kabul", "Antarctica/Mawson",
  "Asia/Yekaterinburg", "Asia/Karachi", "Asia/Kolkata", "Asia/Colombo", "Asia/Kathmandu", "Antarctica/Vostok",
  "Asia/Dhaka", "Asia/Rangoon", "Antarctica/Davis", "Asia/Novokuznetsk", "Asia/Hong_Kong", "Asia/Krasnoyarsk",
  "Asia/Brunei", "Australia/Perth", "Asia/Taipei", "Asia/Choibalsan", "Asia/Irkutsk", "Asia/Dili", "Asia/Pyongyang",
  "Australia/Adelaide", "Australia/Darwin", "Australia/Brisbane", "Australia/Melbourne", "Antarctica/DumontDUrville",
  "Australia/Currie", "Asia/Chita", "Antarctica/Macquarie", "Asia/Sakhalin", "Pacific/Auckland", "Etc/GMT-12",
  "Pacific/Fiji", "Asia/Anadyr", "Asia/Kamchatka", "Etc/GMT-13", "Pacific/Apia",
] as const;

export type InstantlyTimezone = (typeof INSTANTLY_TIMEZONES)[number];

const ACCEPTED: ReadonlySet<string> = new Set(INSTANTLY_TIMEZONES);

function group(target: InstantlyTimezone, names: string[]): [string, InstantlyTimezone][] {
  return names.map((n) => [n, target]);
}

/** IANA name → the Instantly enum entry for the same wall clock. */
const ALIASES: ReadonlyMap<string, InstantlyTimezone> = new Map([
  ...group("America/Detroit", [
    "America/New_York", "America/Toronto", "America/Montreal", "America/Nassau", "America/Iqaluit",
    "America/Nipigon", "America/Thunder_Bay", "America/Indiana/Indianapolis", "America/Indianapolis",
    "America/Fort_Wayne", "America/Indiana/Petersburg", "America/Indiana/Vevay", "America/Indiana/Vincennes",
    "America/Indiana/Winamac", "America/Kentucky/Louisville", "America/Louisville", "America/Kentucky/Monticello",
    "US/Eastern", "US/East-Indiana", "US/Michigan", "Canada/Eastern", "EST5EDT",
  ]),
  ...group("America/Chicago", [
    "America/Winnipeg", "America/Indiana/Knox", "America/Knox_IN", "America/Indiana/Tell_City", "America/Menominee",
    "America/North_Dakota/Center", "America/North_Dakota/New_Salem", "America/North_Dakota/Beulah",
    "America/Rainy_River", "America/Rankin_Inlet", "America/Resolute", "America/Matamoros", "US/Central",
    "US/Indiana-Starke", "Canada/Central", "CST6CDT",
  ]),
  ...group("America/Boise", [
    "America/Denver", "America/Edmonton", "America/Cambridge_Bay", "America/Inuvik", "America/Yellowknife",
    "America/Ojinaga", "America/Ciudad_Juarez", "America/Shiprock", "US/Mountain", "Canada/Mountain", "MST7MDT", "Navajo",
  ]),
  ...group("America/Creston", [
    "America/Phoenix", "America/Dawson_Creek", "America/Fort_Nelson", "America/Hermosillo", "America/Whitehorse",
    "US/Arizona", "Canada/Yukon", "MST",
  ]),
  ...group("America/Dawson", [
    "America/Los_Angeles", "America/Vancouver", "America/Tijuana", "America/Ensenada", "America/Santa_Isabel",
    "US/Pacific", "Canada/Pacific", "PST8PDT",
  ]),
  ...group("America/Anchorage", ["America/Juneau", "America/Nome", "America/Sitka", "America/Yakutat", "America/Metlakatla", "US/Alaska"]),
  ...group("Etc/GMT+10", ["Pacific/Honolulu", "Pacific/Johnston", "US/Hawaii", "HST"]),
  ...group("America/Glace_Bay", ["America/Halifax", "America/Moncton", "America/Goose_Bay", "America/Thule", "Atlantic/Bermuda", "Canada/Atlantic"]),
  ...group("America/Anguilla", ["America/Puerto_Rico", "America/St_Thomas", "America/Virgin", "America/Barbados", "America/Martinique", "America/Santo_Domingo"]),
  ...group("America/St_Johns", ["Canada/Newfoundland"]),
  ...group("America/Regina", ["America/Swift_Current", "Canada/Saskatchewan"]),
  ...group("America/Danmarkshavn", ["UTC", "Etc/UTC", "Etc/GMT", "GMT", "Etc/Universal", "Etc/Zulu"]),
  ...group("Europe/Isle_of_Man", ["Europe/London", "Europe/Dublin", "Europe/Guernsey", "Europe/Jersey", "Europe/Lisbon", "GB", "Eire"]),
  ...group("Australia/Melbourne", ["Australia/Sydney", "Australia/Canberra", "Australia/ACT", "Australia/NSW", "Australia/Victoria", "Australia/Hobart"]),
]);

type Offsets = readonly [january: string, july: string];

function offsetsOf(tz: string, year: number): Offsets | undefined {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" });
    const at = (month: number) => fmt.formatToParts(new Date(Date.UTC(year, month, 15, 12))).find((p) => p.type === "timeZoneName")?.value ?? "";
    return [at(0), at(6)];
  } catch {
    return undefined;
  }
}

/**
 * The Instantly timezone to put in a campaign schedule for a business in `iana`.
 * Throws a non-retryable ProviderError when nothing in Instantly's list keeps the same clock.
 */
export function toInstantlyTimezone(iana: string, ref: Date = new Date()): InstantlyTimezone {
  const tz = iana.trim();
  if (ACCEPTED.has(tz)) return tz as InstantlyTimezone;
  const alias = ALIASES.get(tz);
  if (alias) return alias;
  const year = ref.getUTCFullYear();
  const want = offsetsOf(tz, year);
  if (!want) throw new ProviderError(`Unknown timezone "${iana}"`, "instantly");
  for (const candidate of INSTANTLY_TIMEZONES) {
    const got = offsetsOf(candidate, year);
    if (got && got[0] === want[0] && got[1] === want[1]) return candidate;
  }
  throw new ProviderError(`Timezone "${iana}" has no equivalent in Instantly's schedule timezones; pick a nearby zone for the business`, "instantly");
}
