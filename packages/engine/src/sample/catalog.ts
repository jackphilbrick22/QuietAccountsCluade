import type { TradeId } from "../model.ts";

/** [title, low, high, weight, optional add-on?] — realistic line-ups per trade. */
export type CatalogItem = { title: string; low: number; high: number; weight: number; addOn?: { name: string; low: number; high: number } };

export const CATALOG: Partial<Record<TradeId, CatalogItem[]>> = {
  // Tree prices follow HomeAdvisor/Fixr: removal ~$400-$1,100 (big trees ~$2k+), trimming $175-$750, stumps $150-$300.
  tree: [
    { title: "Oak removal + stump", low: 1400, high: 4800, weight: 3, addOn: { name: "Stump grinding", low: 200, high: 450 } },
    { title: "Remove 2 pines over garage", low: 1600, high: 4200, weight: 2, addOn: { name: "Stump grinding", low: 250, high: 500 } },
    { title: "Crown thinning, 3 maples", low: 700, high: 1800, weight: 4 },
    { title: "Hazard ash near house", low: 900, high: 2800, weight: 3, addOn: { name: "Stump grinding", low: 150, high: 350 } },
    { title: "Stump grinding x3", low: 250, high: 600, weight: 5 },
    { title: "Deadwood removal - large oak", low: 450, high: 1200, weight: 4 },
    { title: "Clearance pruning over roof", low: 350, high: 900, weight: 6 },
    { title: "Storm cleanup - split maple", low: 600, high: 2400, weight: 3 },
    { title: "Lot clearing 1/2 acre", low: 3500, high: 9000, weight: 1 },
    { title: "Cable & brace silver maple", low: 450, high: 1100, weight: 2 },
    { title: "Emerald ash borer treatment", low: 200, high: 600, weight: 2 },
    { title: "Hedge trimming & shaping", low: 200, high: 600, weight: 4 },
    { title: "Remove leaning birch by driveway", low: 600, high: 1600, weight: 4, addOn: { name: "Stump grinding", low: 150, high: 350 } },
    { title: "Spruce removal - back yard", low: 800, high: 2400, weight: 3, addOn: { name: "Stump grinding", low: 200, high: 400 } },
    { title: "Willow removal by pond", low: 1200, high: 3200, weight: 2 },
    { title: "Prune 2 oaks off power line", low: 500, high: 1400, weight: 3 },
    { title: "Hemlock removal x2 - front yard", low: 1200, high: 3200, weight: 2 },
  ],
  septic: [
    { title: "Routine pump-out 1000 gal", low: 350, high: 650, weight: 10, addOn: { name: "Install risers & lids", low: 450, high: 950 } },
    { title: "Septic inspection for home sale", low: 300, high: 550, weight: 4 },
    { title: "Baffle repair", low: 350, high: 900, weight: 3 },
    { title: "Effluent pump replacement", low: 1200, high: 2400, weight: 2 },
    { title: "Line jetting - backup", low: 250, high: 500, weight: 3 },
    { title: "Drain field replacement", low: 8500, high: 24000, weight: 1 },
    { title: "Install effluent filter", low: 250, high: 450, weight: 2 },
    { title: "Riser install", low: 450, high: 950, weight: 2 },
  ],
  lawn: [
    { title: "Weekly mowing - season", low: 1400, high: 3600, weight: 8 },
    { title: "Fertilization & weed control program", low: 350, high: 900, weight: 6 },
    { title: "Fall aeration & overseed", low: 250, high: 650, weight: 5 },
    { title: "Spring clean-up", low: 250, high: 700, weight: 5, addOn: { name: "Mulch beds (6 yds)", low: 450, high: 900 } },
    { title: "Fall leaf clean-up", low: 300, high: 900, weight: 5 },
    { title: "Sod - front yard", low: 1800, high: 5500, weight: 1 },
  ],
  fence: [
    { title: "150 ft 6' cedar privacy fence", low: 5200, high: 9800, weight: 5, addOn: { name: "Seal & stain", low: 700, high: 1400 } },
    { title: "Vinyl privacy fence - back yard", low: 6500, high: 12500, weight: 4 },
    { title: "Aluminum pool fence", low: 4200, high: 9000, weight: 2 },
    { title: "Fence repair - 2 sections", low: 450, high: 1400, weight: 4 },
    { title: "Chain link 4' - dog run", low: 1800, high: 3800, weight: 2 },
    { title: "Replace gate + latch", low: 400, high: 1100, weight: 3 },
    // a New England shop's other everyday installs, so an owner's list reads like his own (not nine privacy fences in a row)
    { title: "Split rail fence - 200 ft", low: 2400, high: 5200, weight: 2 },
    { title: "White picket fence - front yard", low: 2200, high: 4800, weight: 2 },
    { title: "Wood stockade fence - 120 ft", low: 3200, high: 6400, weight: 2 },
  ],
  concrete: [
    { title: "Replace driveway 24x40", low: 7500, high: 16000, weight: 4, addOn: { name: "Seal after cure", low: 350, high: 800 } },
    { title: "Stamped patio 16x20", low: 6000, high: 13500, weight: 3 },
    { title: "Front walkway + steps", low: 2800, high: 6500, weight: 4 },
    { title: "Garage floor replacement", low: 4200, high: 9000, weight: 2 },
    { title: "Crack repair & mudjack", low: 600, high: 1800, weight: 3 },
    { title: "Shed pad 12x16", low: 1600, high: 3200, weight: 2 },
  ],
  pressure_washing: [
    { title: "House wash - soft wash", low: 300, high: 750, weight: 8, addOn: { name: "Gutter brightening", low: 150, high: 300 } },
    { title: "Roof soft wash", low: 450, high: 1200, weight: 4 },
    { title: "Driveway & walks", low: 180, high: 450, weight: 6 },
    { title: "Deck clean + seal", low: 550, high: 1600, weight: 3 },
    { title: "Fence wash", low: 250, high: 700, weight: 2 },
  ],
  // Prices below follow HomeAdvisor/Fixr/ZenMaid ranges from the research; demos should look like the owner's world.
  landscape: [
    { title: "Front bed redesign + mulch", low: 1500, high: 5000, weight: 5, addOn: { name: "Steel edging", low: 300, high: 700 } },
    { title: "Paver patio 14x16", low: 6000, high: 14000, weight: 3 },
    { title: "Spring cleanup + mulch", low: 350, high: 900, weight: 6 },
    { title: "Retaining wall - 40 ft", low: 4500, high: 12000, weight: 2 },
    { title: "Sod install back yard", low: 2500, high: 7000, weight: 3 },
    { title: "Shrub planting - 8 shrubs", low: 900, high: 2400, weight: 4 },
    { title: "Landscape lighting - 12 fixtures", low: 2800, high: 6500, weight: 2 },
  ],
  gutter: [
    { title: "Gutter cleaning - 2 story", low: 175, high: 350, weight: 8, addOn: { name: "Gutter guards", low: 900, high: 2200 } },
    { title: "Seamless gutters - 140 ft", low: 1800, high: 4200, weight: 4 },
    { title: "Gutter guard install", low: 1200, high: 3200, weight: 4 },
    { title: "Downspout repair + extensions", low: 180, high: 450, weight: 3 },
    { title: "Gutter repair - re-pitch & seal", low: 250, high: 650, weight: 3 },
  ],
  window_cleaning: [
    { title: "Exterior window cleaning - 25 windows", low: 250, high: 500, weight: 8, addOn: { name: "Screen cleaning", low: 60, high: 150 } },
    { title: "Interior + exterior windows", low: 400, high: 850, weight: 5 },
    { title: "Skylights + hard-water removal", low: 250, high: 700, weight: 2 },
    { title: "Post-construction window clean", low: 600, high: 1500, weight: 1 },
  ],
  pool: [
    { title: "Pool opening", low: 250, high: 400, weight: 7, addOn: { name: "Chemical start-up", low: 80, high: 160 } },
    { title: "Pool closing", low: 200, high: 350, weight: 6 },
    { title: "Pump replacement", low: 900, high: 1800, weight: 3 },
    { title: "Heater repair", low: 350, high: 1200, weight: 2 },
    { title: "Liner replacement", low: 3500, high: 6500, weight: 2 },
    { title: "Filter clean + service", low: 150, high: 350, weight: 4 },
  ],
  pest: [
    { title: "Quarterly pest plan - first service", low: 180, high: 320, weight: 7 },
    { title: "Termite treatment - liquid", low: 1200, high: 2800, weight: 3, addOn: { name: "Bait station monitoring", low: 300, high: 500 } },
    { title: "Mosquito & tick season program", low: 400, high: 900, weight: 4 },
    { title: "Rodent exclusion", low: 450, high: 1500, weight: 3 },
    { title: "Wasp nest removal", low: 150, high: 350, weight: 4 },
    { title: "Bed bug heat treatment", low: 1200, high: 3000, weight: 1 },
  ],
  hvac: [
    { title: "AC replacement - 3 ton", low: 5500, high: 9500, weight: 3 },
    { title: "Furnace replacement", low: 4200, high: 8000, weight: 3 },
    { title: "Heat pump install", low: 7000, high: 14000, weight: 2 },
    { title: "AC tune-up", low: 120, high: 220, weight: 7, addOn: { name: "Maintenance plan", low: 150, high: 300 } },
    { title: "Furnace repair - igniter", low: 250, high: 650, weight: 5 },
    { title: "Ductless mini-split - 2 zone", low: 5000, high: 11000, weight: 2 },
  ],
  junk_removal: [
    { title: "Garage clean-out - full truck", low: 550, high: 850, weight: 5 },
    { title: "Basement clean-out", low: 400, high: 1100, weight: 4 },
    { title: "Estate clean-out", low: 1200, high: 3500, weight: 2 },
    { title: "Hot tub removal", low: 350, high: 700, weight: 2 },
    { title: "Single item pickup - couch", low: 90, high: 200, weight: 5 },
    { title: "Shed demolition + haul", low: 600, high: 1500, weight: 2 },
  ],
  painting: [
    { title: "Exterior house painting", low: 3200, high: 9500, weight: 4, addOn: { name: "Trim & shutters", low: 600, high: 1500 } },
    { title: "Interior - 3 rooms", low: 1500, high: 3800, weight: 5 },
    { title: "Deck stain", low: 600, high: 1600, weight: 4 },
    { title: "Kitchen cabinet painting", low: 3500, high: 7500, weight: 2 },
    { title: "Front door + trim", low: 300, high: 700, weight: 3 },
  ],
  roofing: [
    { title: "Roof replacement - asphalt 25 sq", low: 8000, high: 16000, weight: 3 },
    { title: "Roof repair - leak at chimney", low: 400, high: 1500, weight: 6 },
    { title: "Flashing replacement", low: 450, high: 1200, weight: 3 },
    { title: "Storm damage repair", low: 800, high: 4500, weight: 3 },
    { title: "Roof inspection", low: 150, high: 350, weight: 4 },
    { title: "Skylight replacement", low: 1200, high: 2800, weight: 2 },
  ],
  irrigation: [
    { title: "Sprinkler system install - 6 zones", low: 2500, high: 5000, weight: 3 },
    { title: "Spring start-up", low: 75, high: 150, weight: 6 },
    { title: "Winterization / blow-out", low: 75, high: 150, weight: 6 },
    { title: "Valve repair", low: 150, high: 450, weight: 4 },
    { title: "Controller upgrade - smart", low: 300, high: 700, weight: 3 },
    { title: "Drip line for beds", low: 400, high: 1200, weight: 2 },
  ],
  chimney: [
    { title: "Chimney sweep & inspection", low: 180, high: 350, weight: 8 },
    { title: "Level 2 inspection - home sale", low: 300, high: 600, weight: 3 },
    { title: "Chimney cap + crown repair", low: 450, high: 1400, weight: 4 },
    { title: "Liner replacement", low: 2500, high: 5500, weight: 2 },
    { title: "Tuckpointing - chimney", low: 800, high: 2500, weight: 3 },
    { title: "Dryer vent cleaning", low: 120, high: 220, weight: 3 },
  ],
  cleaning: [
    { title: "Deep clean - 3 bed 2 bath", low: 280, high: 480, weight: 6, addOn: { name: "Inside oven + fridge", low: 60, high: 120 } },
    { title: "Move-out clean", low: 350, high: 700, weight: 4 },
    { title: "Bi-weekly cleaning - first visit", low: 150, high: 220, weight: 6 },
    { title: "Post-construction clean", low: 500, high: 1200, weight: 1 },
    { title: "Carpet cleaning - 4 rooms", low: 180, high: 350, weight: 3 },
  ],
  // Jobber's bid guide puts a full holiday package at about $750-$5,000; permanent systems run about $2,000-$6,000+.
  holiday_lighting: [
    { title: "Christmas lights - roofline", low: 750, high: 2200, weight: 8, addOn: { name: "Wreath + bows for the front door", low: 120, high: 300 } },
    { title: "Holiday lighting - roofline + 2 trees", low: 1400, high: 3800, weight: 5, addOn: { name: "Mini lights on the front bushes", low: 250, high: 650 } },
    { title: "Mini lights - front tree wrap", low: 400, high: 1200, weight: 3 },
    { title: "Garland + wreaths on porch", low: 350, high: 900, weight: 2 },
    { title: "Holiday lights - driveway + walkway", low: 450, high: 1200, weight: 2 },
    { title: "Permanent lighting - front roofline", low: 2400, high: 6500, weight: 2 },
    { title: "Christmas light takedown & storage", low: 150, high: 450, weight: 1 },
    { title: "Bistro string lights - backyard party", low: 500, high: 1500, weight: 1 },
  ],
  // Cost vs Value 2025: a wood deck addition averages about $18,263 and a composite one about $25,096.
  deck: [
    { title: "New pressure treated deck 14x16", low: 9000, high: 22000, weight: 5, addOn: { name: "Post cap lights", low: 400, high: 1100 } },
    { title: "Composite deck 16x20 - Trex", low: 16000, high: 34000, weight: 4, addOn: { name: "Lights on the stair risers", low: 350, high: 900 } },
    { title: "Deck replacement - cedar", low: 11000, high: 26000, weight: 3 },
    { title: "Deck stain & seal", low: 900, high: 2400, weight: 5 },
    { title: "Deck repair - rotted boards + joists", low: 800, high: 3500, weight: 4 },
    { title: "Deck railing - aluminum + new stairs", low: 2500, high: 7500, weight: 3 },
    { title: "Pergola 12x14", low: 5500, high: 14000, weight: 2 },
    { title: "Screened porch on existing deck", low: 14000, high: 38000, weight: 1 },
  ],
  general: [
    { title: "Deck repair - replace boards", low: 600, high: 2500, weight: 4 },
    { title: "Drywall patch + paint", low: 250, high: 700, weight: 5 },
    { title: "Exterior door install", low: 450, high: 1200, weight: 3 },
    { title: "Bathroom fan replacement", low: 250, high: 600, weight: 3 },
    { title: "Fence repair - 2 sections", low: 300, high: 900, weight: 3 },
  ],
};

/** Route trades: the regular visit each sample regular gets, and how often. */
export const RECURRING_VISIT: Partial<Record<TradeId, { title: string; price: number; everyDays: number }>> = {
  lawn: { title: "Mowing visit", price: 55, everyDays: 14 },
  pressure_washing: { title: "House wash - soft wash", price: 425, everyDays: 180 },
  pool: { title: "Weekly pool service", price: 140, everyDays: 7 },
  pest: { title: "Quarterly pest service", price: 135, everyDays: 91 },
  cleaning: { title: "Bi-weekly cleaning", price: 176, everyDays: 14 },
  window_cleaning: { title: "Window cleaning", price: 325, everyDays: 182 },
  gutter: { title: "Gutter cleaning", price: 190, everyDays: 182 },
  hvac: { title: "Maintenance plan tune-up", price: 160, everyDays: 182 },
  chimney: { title: "Annual chimney sweep", price: 254, everyDays: 365 },
  holiday_lighting: { title: "Christmas lights - install & takedown", price: 1350, everyDays: 365 },
};

/**
 * Trades that sell in one part of the year: how busy each month is (January first), in place of the
 * peak-month default. Holiday lights are sold August to November; spring quotes are permanent lighting.
 */
export const MONTH_WEIGHT: Partial<Record<TradeId, number[]>> = {
  holiday_lighting: [0.15, 0.1, 0.15, 0.2, 0.2, 0.25, 0.4, 0.9, 1.6, 2, 1.5, 0.5],
};

/** Quotes a typical owner-run shop writes in a month, where it differs from the default. */
export const QUOTES_PER_MONTH: Partial<Record<TradeId, number>> = {
  septic: 48,
  lawn: 55,
  pressure_washing: 60,
  // research: 20-60 a month from September to November
  holiday_lighting: 30,
  // research: 8-20 a month in season
  deck: 16,
};

export const FIRST_NAMES = [
  "Mike", "Tom", "Kara", "Gail", "Dave", "Sarah", "Jen", "Chris", "Pat", "Linda", "Rob", "Karen", "Steve", "Amy", "Brian", "Lisa", "Mark", "Nancy", "Jim", "Donna",
  "Paul", "Beth", "Kevin", "Sue", "Greg", "Julie", "Tim", "Laura", "Jeff", "Diane", "Scott", "Michelle", "Eric", "Heather", "Bill", "Carol", "Dan", "Megan", "Ryan", "Kim",
  "Joe", "Anne", "Matt", "Rachel", "Andy", "Erin", "Sam", "Holly", "Nick", "Tara", "Ben", "Wendy", "Luis", "Maria", "Raj", "Priya", "Wei", "Mei", "Andre", "Keisha",
  "Frank", "Ellen", "Doug", "Joan", "Ken", "Ruth", "Walt", "Peggy", "Gary", "Deb", "Craig", "Tina", "Sean", "Kelly", "Jon", "Molly", "Pete", "Grace", "Hank", "Joyce",
];

export const LAST_NAMES = [
  "Sanderson", "Alvarez", "Whitfield", "Ortiz", "Miller", "Johnson", "Brennan", "Carter", "Dubois", "Fischer", "Gallagher", "Hayes", "Iverson", "Jensen", "Kowalski", "Larkin",
  "Morrison", "Nguyen", "O'Brien", "Patel", "Quinn", "Reyes", "Sullivan", "Thompson", "Underwood", "Vasquez", "Walsh", "Young", "Zimmerman", "Abbott", "Barnes", "Coleman",
  "Donovan", "Ellis", "Foster", "Grant", "Holt", "Ingram", "Jordan", "Keller", "Lambert", "McCarthy", "Nolan", "Owens", "Pierce", "Russo", "Stone", "Tran", "Vaughn",
  "Webb", "Chen", "Kim", "Lopez", "Martin", "Clark", "Lewis", "Hall", "Allen", "King", "Wright", "Scott", "Green", "Baker", "Adams", "Nelson", "Hill", "Campbell", "Mitchell",
  "Roberts", "Turner", "Phillips", "Parker", "Evans", "Edwards", "Collins", "Stewart", "Morris", "Rogers", "Reed", "Cook", "Morgan", "Bell", "Murphy", "Bailey", "Cooper",
];

export const STREETS = [
  "Oak Ln", "Pine St", "Maple Ct", "Elm Rd", "River Rd", "Hillside Dr", "Birch Way", "Mill Rd", "Pleasant St", "School St", "Church St", "Main St", "Ridge Rd", "Forest Ave",
  "Meadow Ln", "Brook St", "Orchard Rd", "Summit Ave", "Cedar Ct", "Spruce St", "Walnut St", "Chestnut Dr", "Laurel Ln", "Juniper Rd", "Hawthorne Way", "Pond Rd",
  "Old County Rd", "Sunset Dr", "Valley View Rd", "Stark Hwy", "Bog Rd", "Hopkinton Rd", "Village St", "Lake Shore Dr", "Autumn Ln", "Fox Run", "Deer Path", "Stone Wall Ln",
];

export const TOWNS: { city: string; state: string; zip: string }[] = [
  { city: "Concord", state: "NH", zip: "03301" },
  { city: "Bow", state: "NH", zip: "03304" },
  { city: "Hopkinton", state: "NH", zip: "03229" },
  { city: "Pembroke", state: "NH", zip: "03275" },
  { city: "Loudon", state: "NH", zip: "03307" },
  { city: "Canterbury", state: "NH", zip: "03224" },
  { city: "Henniker", state: "NH", zip: "03242" },
  { city: "Dunbarton", state: "NH", zip: "03046" },
  { city: "Boscawen", state: "NH", zip: "03303" },
  { city: "Chichester", state: "NH", zip: "03258" },
];

export const EMAIL_DOMAINS = ["gmail.com", "gmail.com", "gmail.com", "yahoo.com", "comcast.net", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "myfairpoint.net"];
