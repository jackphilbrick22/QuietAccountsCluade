/**
 * The company on screen in the service film, one per trade. Each is made up (a plausible local business, not a real
 * one: the name was searched before use) and is the only thing that changes when the film is rendered for another
 * trade. Everything else on screen comes out of the software run for this company (content.ts).
 *
 * To film another trade: add a profile here (its trade, a made-up company in a real town, the season its notes sell
 * in) and run `pnpm --filter @qa/web film:content <trade>`.
 */
import type { ISODate, TradeId } from "@qa/engine";

export interface FilmCompany {
  /** The business name, everywhere: the console, the notes' signature, the owner's texts. */
  name: string;
  /** The owner: the man who gets the texts and books the work. */
  ownerName: string;
  /** Who signs the notes. The owner's own first name means the notes go out "in your name". */
  signerName: string;
  city: string;
  state: string;
  zip: string;
  /** The postal address every note carries (CAN-SPAM). A PO box, so it's nobody's house. */
  mailingAddress: string;
  /** Off screen (owner email, reply-to, website), so nothing anywhere says "example". */
  domain: string;
}

export interface FilmProfile {
  trade: TradeId;
  company: FilmCompany;
  /** The day we read his export and text him: inside the trade's selling window, so the first notes go the next send day. */
  asOf: ISODate;
  /**
   * When his export reaches us: an ordinary owner's hour for paperwork, the evening before `asOf`, so a night's work
   * sits between his file and our first text (a team that writes each note, not a bot that answers in two minutes).
   */
  exportAt: string;
  /** Jobs that run a whole season (a "Weekly mowing - season" dated in April ran all summer): never the one we follow. */
  seasonJob: RegExp;
  /** Days the round is played forward after his OK. */
  simDays: number;
  /** The sample business's seed (its customers and jobs), and the replies' seeds tried in order (content.ts). */
  sampleSeed: string;
  simSeeds: string[];
  /** The one export he sends: the sample's file of that name, read alone. */
  exportFile: string;
  /** What his software calls it, for the file chip ("Jobber · Jobs report"). */
  software: string;
  /** The kinds of people the film follows (BREAKAGE types), most wanted first. */
  featureTypes: string[];
  /**
   * The replies the film can show, by preference. They're the simulator's own words (engine/src/sim/replies.ts);
   * these only say which read naturally for this trade, and the order to prefer them in.
   */
  preferWants: string[];
  /** Words that make a simulated reply read as another trade's ("stump") or another person's ("my husband"). */
  avoidInReplies: RegExp;
}

export const PROFILES: Partial<Record<TradeId, FilmProfile>> = {
  lawn: {
    trade: "lawn",
    company: {
      name: "Desrochers Lawn & Landscape",
      ownerName: "Kyle Desrochers",
      signerName: "Kyle",
      city: "Bow",
      state: "NH",
      zip: "03304",
      mailingAddress: "PO Box 214, Bow, NH 03304",
      domain: "desrocherslawn.com",
    },
    // A Monday in February: lawn's spring selling window (January to March), when a mowing shop's past customers
    // hear "we'd love to have you back on the schedule" and the whole round of 150 goes out before it closes.
    asOf: "2026-02-09",
    // Sunday night, 9:47: he sends it after the kids are down; our first text reaches him Monday at 8:02
    exportAt: "2026-02-08T21:47",
    seasonJob: /season|program/i,
    simDays: 45,
    sampleSeed: "film-lawn-27",
    simSeeds: Array.from({ length: 60 }, (_, i) => `film-lawn-replies-${i + 1}`),
    exportFile: "Jobs Report.csv",
    software: "Jobber",
    featureTypes: ["lapsed_regular", "one_and_done"],
    preferWants: [
      "Yes! That's still on my list. Go ahead and schedule it.",
      "Perfect timing actually, we were just talking about it. Let's go ahead.",
      "Yes, still want it done. Any day next week works.",
      "Hi {signer}, yes please. Can you call me after 5? {phone}",
      "Still need it. The {job} got worse over the winter honestly. When can you come?",
    ],
    avoidInReplies: /stump|holiday|husband|storm|the part by the house|requote|never asked for a quote|neighbor|in the spring\?|came out in the spring/i,
  },
};
