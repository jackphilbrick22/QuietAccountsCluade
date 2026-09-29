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
