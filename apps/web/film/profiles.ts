/**
 * The company on screen in the service film, one per trade. Each is made up (a plausible local business, not a real
 * one: the name was searched before use) and is the only thing that changes when the film is rendered for another
 * trade. Everything else on screen comes out of the software run for this company (content.ts).
 *
 * To film another trade: add a profile here (its trade, a made-up company in a real town, the season its notes sell
 * in) and run `pnpm --filter @qa/web film:content <trade>`.
 *
 * Every company is in a real town near Concord, NH, where the sample's customers live (Bow, Hopkinton, Pembroke,
 * Henniker…), with a PO box for its address and its customers' numbers in the 958/959 exchanges (content.ts). Names
 * were web-searched before use; what was searched, and when, is beside each one.
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
  /**
   * The exports he sends, the sample's files of those names, read together: a monthly trade's past visits (one file);
   * a one-pass trade's old quotes and past jobs (two, as its page asks: "the same for Visits").
   */
  exportFiles: string[];
  /** What his software calls it, for the file chip ("Jobber · Jobs report"). */
  software: string;
  /**
   * The work the one we follow was quoted or done, by its title in his export: a fence company follows an old quote
   * for a fence (not a gate latch), a tree company a removal. Unset: any.
   */
  featureWork?: RegExp;
  /**
   * Work titles in his export, renamed before the film reads it: the sample's shop does wood fences, Jack's film is
   * for a vinyl one (Oct 9: "I hated the brown and I don't like any picket stuff"). Off screen; the engine's sample
   * catalog is left as it is.
   */
  retitle?: [string, string][];
  /** The kinds of people the film follows (BREAKAGE types), most wanted first. */
  featureTypes: string[];
  /**
   * The replies the film can show, by preference. They're the simulator's own words (engine/src/sim/replies.ts);
   * these only say which read naturally for this trade, and the order to prefer them in.
   */
  preferWants: string[];
  /** Words that make a simulated reply read as another trade's ("stump") or another person's ("my husband"). */
  avoidInReplies: RegExp;
  /**
   * The trade's everyday work, which the List and the Notes table must show enough of (a cleaning company is its
   * regulars and "the regular cleaning", not four deep cleans stacked): at least `list` of the List's seven rows and
   * `notes` of the Notes table's five are this job (the one we follow counts), and neither shows one job more than
   * `maxRun` rows in a row. Unset: the scan's order as it comes.
   */
  staple?: { job: RegExp; list: number; notes: number; maxRun: number };
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
    exportFiles: ["Jobs Report.csv"],
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
  // Searched Oct 8, 2026: "Theriault Home Cleaning", "Theriault cleaning service NH", "Nicole Theriault" cleaning: no
  // such business anywhere in the results (nearest: Theresa Maid Services, NC; Theresa's Cleaning, NJ). A
  // Franco-American family name, common in New Hampshire, on an owner-run house cleaning company in Hopkinton.
  cleaning: {
    trade: "cleaning",
    company: {
      name: "Theriault Home Cleaning",
      ownerName: "Nicole Theriault",
      signerName: "Nicole",
      city: "Hopkinton",
      state: "NH",
      zip: "03229",
      mailingAddress: "PO Box 382, Hopkinton, NH 03229",
      domain: "theriaultcleaning.com",
    },
    // A Monday in early March: cleaning's spring busy months (March and April), when a regular who stopped hears "we'd
    // love to have you back on the schedule"; the free 150 go out over the next few weeks.
    asOf: "2026-03-02",
    // Sunday night, 8:52
    exportAt: "2026-03-01T20:52",
    // no cleaning job runs a season
    seasonJob: /^$/,
    simDays: 45,
    sampleSeed: "film-cleaning-1",
    simSeeds: Array.from({ length: 60 }, (_, i) => `film-cleaning-replies-${i + 1}`),
    exportFiles: ["Jobs Report.csv"],
    software: "Jobber",
    // a regular who stopped coming first ("the regular cleaning"), then a one-time or deep clean
    featureTypes: ["lapsed_regular", "one_and_done", "missed_upsell"],
    preferWants: [
      "Yes! That's still on my list. Go ahead and schedule it.",
      "Perfect timing actually, we were just talking about it. Let's go ahead.",
      "Yes, still want it done. Any day next week works.",
      "Hi {signer}, yes please. Can you call me after 5? {phone}",
      "Yeah let's do it. Same as the quote is fine.",
      "Yes. Is {day} possible?",
      "Yes please call me {phone}",
    ],
    avoidInReplies: /stump|holiday|husband|storm|the part by the house|requote|never asked for a quote|neighbor|in the spring|came out in the spring|got worse over the winter|same as the quote|came down/i,
    // a house cleaning company's book is its regulars, every week or two; deep cleans come between
    staple: { job: /^regular cleaning/, list: 3, notes: 3, maxRun: 2 },
  },
  // Searched Oct 8, 2026: "Boisvert Fence", "Boisvert fence company New Hampshire", "Marc Boisvert" fence: no such
  // business (nearest: Boise, Idaho fence companies; Therrien Fence, Manchester NH, a different name). A Franco-American
  // family name on a fence company in Pembroke.
  fence: {
    trade: "fence",
    company: {
      name: "Boisvert Fence Co.",
      ownerName: "Marc Boisvert",
      signerName: "Marc",
      city: "Pembroke",
      state: "NH",
      zip: "03275",
      mailingAddress: "PO Box 117, Pembroke, NH 03275",
      domain: "boisvertfence.com",
    },
    // A Monday in March, as fence season opens: last year's quotes, asked again before the spring rush. The one pass
    // runs its 30 days from the next day, and its pass-end text comes a week after its last notes.
    asOf: "2026-03-09",
    exportAt: "2026-03-08T21:14",
    seasonJob: /^$/,
    simDays: 45,
    sampleSeed: "film-fence-4",
    simSeeds: Array.from({ length: 60 }, (_, i) => `film-fence-replies-${i + 1}`),
    exportFiles: ["Quotes Report.csv", "Jobs Report.csv"],
    software: "Jobber",
    // a vinyl fence company (Jack, Oct 9): the sample shop's cedar, picket and stockade fences are vinyl ones here
    retitle: [
      ["150 ft 6' cedar privacy fence", "150 ft 6' vinyl privacy fence"],
      ["White picket fence - front yard", "White vinyl fence - front yard"],
      ["Wood stockade fence - 120 ft", "Tan vinyl privacy - 120 ft"],
    ],
    // an old quote for a vinyl or privacy fence, not a gate latch, a two-section repair or a split rail
    featureWork: /vinyl|privacy|pool/i,
    featureTypes: ["unanswered_quote", "archived_quote", "changes_requested"],
    preferWants: [
      "Yes, still want it done. Any day next week works.",
      "Yeah let's do it. Same as the quote is fine.",
      "Yes! That's still on my list. Go ahead and schedule it.",
      "Perfect timing actually, we were just talking about it. Let's go ahead.",
      "Hi {signer}, yes please. Can you call me after 5? {phone}",
      "Yes. Is {day} possible?",
      "Yes please call me {phone}",
    ],
    avoidInReplies: /stump|holiday|husband|storm|the part by the house|never asked for a quote|neighbor|came out in the spring|came down|got worse over the winter/i,
  },
  // Searched Oct 8, 2026: "Corriveau Tree" service, "Derek Corriveau" tree: no such business or person in tree work.
  // Tried first and dropped: "Lavoie Tree Service" (a Matt Lavoie runs Tree Sawyer Inc. in Rindge, NH) and "Plourde
  // Tree" (nothing found, but kept clear of after Lavoie). A Franco-American family name on a tree company in Henniker.
  tree: {
    trade: "tree",
    company: {
      name: "Corriveau Tree Service",
      ownerName: "Derek Corriveau",
      signerName: "Derek",
      city: "Henniker",
      state: "NH",
      zip: "03242",
      mailingAddress: "PO Box 506, Henniker, NH 03242",
      domain: "corriveautree.com",
    },
    // A Monday in mid-April, tree work's spring season: last year's quotes for removals and pruning, asked again
    asOf: "2026-04-13",
    exportAt: "2026-04-12T20:31",
    seasonJob: /^$/,
    simDays: 45,
    // seed 3's welcome text called three lot clearings in a row ("lot clearing, lot clearing, lot clearing"), and its
    // first note's person shared a surname with every typical run's ledger; seed 5's call list is two lot clearings
    // and a big pruning job, and its runs keep clear
    sampleSeed: "film-tree-5",
    simSeeds: Array.from({ length: 60 }, (_, i) => `film-tree-replies-${i + 1}`),
    exportFiles: ["Quotes Report.csv", "Jobs Report.csv"],
    software: "Jobber",
    // an old quote for a removal (a hazard tree, an oak with its stump), not deadwood pruning
    featureWork: /^(?!deadwood).*(remov|hazard)/i,
    featureTypes: ["unanswered_quote", "archived_quote", "changes_requested"],
    // first, the reply that names the tree ("The oak got worse over the winter honestly")
    preferWants: [
      "Still need it. The {job} got worse over the winter honestly. When can you come?",
      "Yes, still want it done. Any day next week works.",
      "Yeah let's do it. Same as the quote is fine.",
      "Yes! That's still on my list. Go ahead and schedule it.",
      "Hi {signer}, yes please. Can you call me after 5? {phone}",
      "Yes. Is {day} possible?",
      "Yes please call me {phone}",
    ],
    avoidInReplies: /holiday|husband|the part by the house|never asked for a quote|neighbor|came out in the spring/i,
  },
};
