import type { TradeId } from "../model.ts";
import type { TradePlaybook } from "./types.ts";

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const WORK_PHRASE: Partial<Record<TradeId, string>> = {"tree": "the tree work", "lawn": "the lawn work", "landscape": "the landscaping", "septic": "the septic work", "fence": "the fence", "concrete": "the concrete work", "pressure_washing": "the washing", "gutter": "the gutter work", "window_cleaning": "the window cleaning", "pool": "the pool work", "pest": "the pest treatment", "hvac": "the heating and cooling work", "junk_removal": "the clean-out", "painting": "the painting", "roofing": "the roof work", "irrigation": "the sprinkler work", "chimney": "the chimney work", "cleaning": "the cleaning", "holiday_lighting": "the lights", "deck": "the deck", "general": "the work we quoted"};

/* ================================================================== */
/* TREE                                                                */
/* ================================================================== */
const tree: TradePlaybook = {
  id: "tree",
  workPhrase: "the tree work",
  label: "Tree service",
  noun: "tree company",
  // HomeAdvisor: removal avg ~$750 ($200-$2,000); Fixr: trimming ~$450, stump ~$200. Own invoices always win.
  ticket: { low: 250, typical: 1100, high: 12000 },
  typicalCloseRate: 0.4,
  peakMonths: { cold: [4, 5, 6, 9, 10], warm: [3, 4, 5, 6, 9, 10] },
  services: [
    {
      id: "tree.removal",
      label: "Tree removal",
      // "deadwood removal" and "limb removal" are pruning: the tree stays
      match: /\b(?<!\b(?:dead ?wood|limbs?|branch(?:es)?)\s)(remov|take down|takedown|cut down|fell|drop|hazard|dead(?! ?wood|\s(?:limbs?|branch))|leaning|crane)/i,
      phrase: "the tree removal",
      season: { cold: ALL, warm: ALL },
      kind: "hazard",
      followOns: [
        { serviceId: "tree.stump", afterDays: [3, 120], why: "stumps left behind after removals are the most common add-on", pitch: "Grinding it out gets it out of the way of the mower and keeps it from sprouting." },
        { serviceId: "tree.plant", afterDays: [30, 365], why: "replacement planting after a removal", pitch: "If you'd like something planted where it stood, we can do that too." },
      ],
      worseIfWaiting: "A tree that needed to come down doesn't get easier to take down — it gets heavier, more brittle, and closer to the house.",
      timingLine: {
        cold: "Leaf-off months make removals quicker and cleaner, and the ground is firm for equipment.",
        warm: "Getting ahead of storm season is the cheapest time to take care of it.",
      },
      timingMonths: { cold: [10, 11, 12, 1, 2, 3], warm: [12, 1, 2, 3, 4, 5] },
    },
    {
      id: "tree.stump",
      label: "Stump grinding",
      match: /\b(stump|grind)/i,
      phrase: "the stump grinding",
      season: { cold: [3, 4, 5, 6, 7, 8, 9, 10, 11], warm: ALL },
      kind: "improvement",
      worseIfWaiting: "Old stumps sprout, rot and draw ants and termites — and they're in the way of every mow.",
    },
    {
      id: "tree.prune_oak",
      label: "Oak pruning",
      // UMN Extension: to avoid oak wilt, do not prune oaks from April to October
      match: /\boaks?\b[^.·]{0,40}\b(prun|trim|thin|raise|reduc|crown|deadwood|clearance|lift|shape)|\b(prun|trim|thin|raise|reduc|crown|deadwood|clearance|lift|shape)\w*\b[^.·]{0,40}\boaks?\b/i,
      phrase: "the oak pruning",
      season: { cold: [11, 12, 1, 2, 3], warm: [12, 1] },
      reserviceMonths: 36,
      kind: "maintenance",
      strictSeason: true,
      waitLine: "Oaks have to wait for the dormant season because of oak wilt.",
      worseIfWaiting: "Limbs that are over the roof or wires only get longer and heavier each season.",
      timingLine: {
        cold: "Oaks can only be pruned safely in the dormant months, when oak wilt can't spread, so the winter schedule is the one to get on.",
        warm: "Oaks are safest to prune in the coldest part of winter, so that's the schedule to get on.",
      },
      timingMonths: { cold: ALL, warm: ALL },
    },
    {
      id: "tree.ash",
      label: "Ash borer treatment",
      // Penn State Extension: applications in May or early June
      match: /\b(emerald ash|ash borer|eab)\b|\bash\b[^.·]{0,20}\b(treat|inject|protect)/i,
      phrase: "the ash treatment",
      season: { cold: [5, 6], warm: [3, 4, 5] },
      reserviceMonths: 24,
      kind: "repair",
      strictSeason: true,
      waitLine: "Ash treatments only work when they go in during the spring.",
      worseIfWaiting: "Once borers get into an ash it usually dies within a few years, and a dead ash gets brittle and harder to take down safely.",
      timingLine: {
        cold: "Ash treatments only work when they go in around May or early June, so it's worth getting on the spring list now.",
        warm: "Ash treatments work best when they go in during spring, so it's worth getting on that list now.",
      },
      timingMonths: { cold: ALL, warm: ALL },
    },
    {
      id: "tree.prune",
      label: "Pruning / trimming",
      match: /\b(prun|trim|thin|raise|reduc|crown|deadwood|dead wood|dead ?limb|limbs? (remov|up|back)|limbing|branch(es)? remov|clearance|lift|shape|cabling|brac)/i,
      phrase: "the pruning",
      season: { cold: [1, 2, 3, 4, 10, 11, 12], warm: [1, 2, 3, 11, 12] },
      reserviceMonths: 36,
      kind: "maintenance",
      worseIfWaiting: "Limbs that are over the roof or wires only get longer and heavier each season.",
      timingLine: {
        cold: "Dormant season (late fall through early spring) is the best time for most pruning.",
        warm: "Winter is the best window for most pruning before spring growth starts.",
      },
      timingMonths: { cold: [9, 10, 11, 12, 1, 2, 3], warm: [10, 11, 12, 1, 2] },
    },
    {
      id: "tree.storm",
      label: "Storm clean-up",
      match: /\b(storm|emergenc|fallen|uproot|broken|split|hanger|hung up)/i,
      phrase: "the storm damage",
      season: { cold: ALL, warm: ALL },
      kind: "hazard",
      worseIfWaiting: "Split and hung-up limbs are the ones that come down in the next wind.",
    },
    {
      id: "tree.health",
      label: "Plant health care",
      match: /\b(fertiliz|injection|treat|spray|insect|disease|borer|emerald ash|phc|deep root|soil)/i,
      phrase: "the tree treatment",
      season: { cold: [4, 5, 6, 9, 10], warm: [2, 3, 4, 5, 9, 10] },
      reserviceMonths: 12,
      kind: "maintenance",
    },
    {
      id: "tree.clearing",
      label: "Lot / land clearing",
      match: /\b(clear|lot|brush|mulch(ing)? (the )?(lot|land)|forestry|underbrush|view)/i,
      phrase: "the clearing",
      season: { cold: [1, 2, 3, 4, 10, 11, 12], warm: ALL },
      kind: "improvement",
    },
    {
      id: "tree.plant",
      label: "Planting",
      match: /\b(plant|install tree|new tree)/i,
      phrase: "the planting",
      season: { cold: [4, 5, 9, 10], warm: [10, 11, 12, 1, 2, 3] },
      kind: "improvement",
    },
  ],
  objects: [
    [/\boaks?\b/i, "the oak"],
    [/\bmaples?\b/i, "the maple"],
    [/\bpines?\b/i, "the pine"],
    [/\bash(es)?\b(?! tray)/i, "the ash"],
    [/\bbirch(es)?\b/i, "the birch"],
    [/\bspruces?\b/i, "the spruce"],
    [/\bhemlocks?\b/i, "the hemlock"],
    [/\bwillows?\b/i, "the willow"],
    [/\bpoplars?\b/i, "the poplar"],
    [/\bcottonwoods?\b/i, "the cottonwood"],
    [/\belms?\b/i, "the elm"],
    [/\bcedars?\b/i, "the cedar"],
    [/\bsycamores?\b/i, "the sycamore"],
    [/\bpalms?\b/i, "the palm"],
    [/\bpecans?\b/i, "the pecan"],
    [/\bmagnolias?\b/i, "the magnolia"],
    [/\bcrepe myrtles?\b/i, "the crepe myrtle"],
    [/\bhickor(y|ies)\b/i, "the hickory"],
    [/\bwalnuts?\b/i, "the walnut"],
    [/\bcherr(y|ies)\b/i, "the cherry"],
    [/\bstumps?\b/i, "the stump"],
    [/\bhedges?\b/i, "the hedges"],
    [/\blimbs?\b|\bbranch(es)?\b/i, "the limbs"],
    [/\blot\b/i, "the lot"],
  ],
  places: [
    [/driveway/i, "by the driveway"],
    [/garage/i, "over the garage"],
    [/(house|home|roof)/i, "over the house"],
    [/(power ?line|wire|line)/i, "by the lines"],
    [/(back ?yard|backyard|rear)/i, "in the backyard"],
    [/(front ?yard|front)/i, "out front"],
    [/(fence ?line|property line|neighbor)/i, "on the property line"],
    [/(deck|patio|pool)/i, "by the deck"],
    [/(street|road|curb)/i, "by the road"],
  ],
  whyQuotesDie: [
    "Price shock on big removals — they wanted to 'think about it' and never called back",
    "They were waiting for a better time (after the holidays, after tax season, before spring)",
    "Spouse or HOA had to sign off and nobody followed up",
    "They got three quotes and the decision stalled",
    "The tree wasn't an emergency yet — until it is",
  ],
  quoteAngles: ["check_in", "problem_grows", "timing", "crew_nearby", "close_file"],
  crewLine: "We've got a crew working nearby with a couple of open days.",
  minQuote: 400,
  freeLook: true,
  // what an arborist needs before he calls: what the tree looks like and where it is
  intakeAsk: "If it's easy, reply with a photo or two{andAddress}.",
};

/* ================================================================== */
/* LAWN CARE                                                           */
/* ================================================================== */
const lawn: TradePlaybook = {
  id: "lawn",
  workPhrase: "the lawn work",
  label: "Lawn care",
  noun: "lawn care company",
  ticket: { low: 45, typical: 450, high: 4000 },
  typicalCloseRate: 0.45,
  peakMonths: { cold: [3, 4, 5, 9], warm: [2, 3, 4, 9, 10] },
  services: [
    {
      id: "lawn.mow",
      label: "Weekly mowing",
      match: /\b(mow|maint(enance)?|weekly|bi-?weekly|cut(ting)?|lawn service|season(al)? (plan|contract))/i,
      phrase: "the mowing",
      season: { cold: [3, 4, 5, 6, 7, 8, 9, 10], warm: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
      reserviceMonths: 12,
      kind: "recurring",
      timingLine: {
        cold: "Spring routes fill up by April — the spots go to whoever says yes first.",
        warm: "Routes for the season are getting set now, and the best days go first.",
      },
      timingMonths: { cold: [1, 2, 3, 4], warm: [12, 1, 2] },
    },
    {
      id: "lawn.fert",
      label: "Fertilization & weed control",
      match: /\b(fert|weed|pre-?emergent|grub|lime|program|treatment|crabgrass|feed)/i,
      phrase: "the lawn program",
      season: { cold: [3, 4, 5, 8, 9], warm: [1, 2, 3, 9, 10] },
      reserviceMonths: 12,
      kind: "recurring",
      worseIfWaiting: "Pre-emergent only works if it's down before the weeds germinate — miss that window and it's a year of pulling crabgrass.",
    },
    {
      id: "lawn.aerate",
      label: "Aeration & overseeding",
      match: /\b(aerat|overseed|seed|dethatch|core)/i,
      phrase: "the aeration and overseeding",
      season: { cold: [8, 9, 10], warm: [4, 5, 6] },
      reserviceMonths: 12,
      kind: "maintenance",
      timingLine: {
        cold: "Late summer to early fall is the window for aeration and seed — it closes when the nights get cold.",
        warm: "Late spring is when warm-season grass recovers fastest from aeration.",
      },
      timingMonths: { cold: [7, 8, 9, 10], warm: [3, 4, 5, 6] },
    },
    {
      id: "lawn.cleanup",
      label: "Spring / fall clean-up",
      match: /\b(clean ?up|leaf|leaves|debris|spring clean|fall clean)/i,
      phrase: "the clean-up",
      season: { cold: [3, 4, 10, 11], warm: [1, 2, 11, 12] },
      reserviceMonths: 12,
      kind: "maintenance",
      timingLine: {
        cold: "Clean-up schedules fill fast once the leaves drop.",
        warm: "The clean-up calendar fills fast in late winter.",
      },
      timingMonths: { cold: [9, 10, 11], warm: [11, 12, 1, 2] },
    },
    {
      id: "lawn.sod",
      label: "Sod / renovation",
      match: /\b(sod|renovat|reseed|new lawn|grading|topsoil)/i,
      phrase: "the lawn renovation",
      season: { cold: [4, 5, 9, 10], warm: [3, 4, 5, 6, 7, 8, 9] },
      kind: "improvement",
    },
  ],
  objects: [
    [/front (yard|lawn)/i, "the front lawn"],
    [/back ?(yard|lawn)/i, "the backyard"],
    [/\blawn\b/i, "the lawn"],
    [/\bbeds?\b/i, "the beds"],
    [/\byard\b/i, "the yard"],
  ],
  places: [],
  whyQuotesDie: [
    "They signed up with whoever called back first in the spring rush",
    "Program pricing felt high next to a kid with a mower",
    "They meant to start 'next month' and the season got away",
    "Recurring customers quietly drop at the end of a season and nobody asks why",
  ],
  quoteAngles: ["check_in", "timing", "easy_yes", "crew_nearby", "close_file"],
  crewLine: "We've got a route running through your neighborhood with room for one or two more.",
  minQuote: 150,
  freeLook: true,
};

/* ================================================================== */
/* LANDSCAPE (design/build + maintenance)                             */
/* ================================================================== */
const landscape: TradePlaybook = {
  id: "landscape",
  workPhrase: "the landscaping",
  label: "Landscaping",
  noun: "landscaping company",
  ticket: { low: 300, typical: 3500, high: 60000 },
  typicalCloseRate: 0.3,
  peakMonths: { cold: [3, 4, 5, 9, 10], warm: [2, 3, 4, 9, 10, 11] },
  services: [
    {
      id: "land.mulch",
      label: "Mulch & bed maintenance",
      match: /\b(mulch|bed|edg|weed(ing)?|pine straw|rock)/i,
      phrase: "the mulch and beds",
      season: { cold: [4, 5, 6, 9, 10], warm: [2, 3, 4, 10, 11] },
      reserviceMonths: 12,
      kind: "maintenance",
      timingLine: { cold: "Spring mulch books out fast once the snow's gone.", warm: "Fresh mulch before the heat keeps the beds from drying out." },
      timingMonths: { cold: [2, 3, 4, 5], warm: [1, 2, 3, 4] },
    },
    {
      id: "land.hardscape",
      label: "Hardscape (patio, walls, walkways)",
      match: /\b(patio|paver|retaining|wall|walkway|walk|firepit|fire pit|steps|stone|flagstone|hardscape|outdoor kitchen)/i,
      phrase: "the patio project",
      season: { cold: [4, 5, 6, 7, 8, 9, 10, 11], warm: ALL },
      kind: "improvement",
      followOns: [{ serviceId: "land.lighting", afterDays: [14, 365], why: "lighting finishes a new patio", pitch: "A few lights make a new patio usable after dark." }],
      timingLine: {
        cold: "Hardscape crews book out months ahead for spring — getting on the list now is how it gets built before summer.",
        warm: "Cooler months are the best time to build before the heat.",
      },
      timingMonths: { cold: [11, 12, 1, 2, 3], warm: [10, 11, 12, 1, 2, 3] },
    },
    {
      id: "land.planting",
      label: "Planting & design",
      match: /\b(plant|shrub|design|install|perennial|tree install|landscape plan|foundation planting)/i,
      phrase: "the planting",
      season: { cold: [4, 5, 9, 10], warm: [10, 11, 12, 1, 2, 3] },
      kind: "improvement",
    },
    {
      id: "land.drainage",
      label: "Drainage",
      match: /\b(drain|french|grading|downspout|standing water|swale|dry well)/i,
      phrase: "the drainage work",
      season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "repair",
      worseIfWaiting: "Water that's pooling now is working on the foundation every time it rains.",
    },
    {
      id: "land.lighting",
      label: "Landscape lighting",
      match: /\b(light|lighting|lantern|uplight)/i,
      phrase: "the lighting",
      season: { cold: [3, 4, 5, 6, 7, 8, 9, 10, 11], warm: ALL },
      kind: "improvement",
    },
    {
      id: "land.maint",
      label: "Maintenance contract",
      match: /\b(maintenance|contract|weekly|seasonal service|full service|property care)/i,
      phrase: "the maintenance plan",
      season: { cold: [2, 3, 4], warm: [1, 2, 3] },
      reserviceMonths: 12,
      kind: "recurring",
    },
  ],
  objects: [
    [/\bpatio\b/i, "the patio"],
    [/retaining wall|\bwall\b/i, "the wall"],
    [/walkway|\bwalk\b/i, "the walkway"],
    [/fire ?pit/i, "the fire pit"],
    [/\bbeds?\b/i, "the beds"],
    [/\bfront\b/i, "the front yard"],
    [/\bback ?yard\b/i, "the backyard"],
  ],
  places: [],
  whyQuotesDie: [
    "Big project, big number — they wanted to save up or phase it",
    "They were waiting for spring and nobody was there when spring came",
    "Design fatigue: too many options, no next step",
    "They got busy and the project slid a year",
  ],
  quoteAngles: ["check_in", "revise", "timing", "crew_nearby", "close_file"],
  crewLine: "We've got a crew finishing up nearby and a couple of open days after.",
  minQuote: 500,
  freeLook: true,
};

/* ================================================================== */
/* SEPTIC                                                              */
/* ================================================================== */
const septic: TradePlaybook = {
  id: "septic",
  workPhrase: "the septic work",
  label: "Septic service",
  noun: "septic company",
  ticket: { low: 300, typical: 650, high: 25000 },
  typicalCloseRate: 0.55,
  peakMonths: { cold: [4, 5, 6, 9, 10], warm: [3, 4, 5, 9, 10] },
  services: [
    {
      id: "septic.aerobic",
      label: "Aerobic system maintenance",
      // TCEQ: aerobic units must be under a maintenance contract; EPA: alternative systems inspected yearly
      match: /\b(aerobic|atu|maintenance contract|service contract|spray (heads?|system)|chlorinator|chlorine tablets?)\b/i,
      phrase: "the aerobic system maintenance",
      season: { cold: ALL, warm: ALL },
      reserviceMonths: 12,
      kind: "recurring",
      worseIfWaiting: "Aerobic systems have pumps and air lines that need a yearly check to keep treating properly.",
    },
    {
      id: "septic.pump",
      label: "Pump-out",
      match: /\b(pump|clean ?out|routine|maintenance)/i,
      phrase: "the septic pump-out",
      season: { cold: [4, 5, 6, 7, 8, 9, 10, 11], warm: ALL },
      reserviceMonths: 36,
      kind: "maintenance",
      followOns: [
        { serviceId: "septic.riser", afterDays: [0, 365], why: "risers make every future pump-out faster and cheaper", pitch: "Risers bring the lids up to ground level, so there's no digging to find them at the next pump-out." },
        { serviceId: "septic.filter", afterDays: [0, 365], why: "an effluent filter protects the drain field", pitch: "An effluent filter catches solids before they can get out to the drain field." },
      ],
      worseIfWaiting: "Solids that build past the baffle go out to the drain field — and a drain field is the part that costs thousands.",
      timingLine: {
        cold: "Best to get it done before the ground freezes and the lid gets hard to reach.",
        warm: "Heavy rain season is hard on a full tank — better to pump it before then.",
      },
      timingMonths: { cold: [8, 9, 10, 11], warm: ALL },
    },
    {
      id: "septic.inspect",
      label: "Inspection",
      match: /\b(inspect|evaluation|certif|title 5|real estate|home sale|camera|dye test)/i,
      phrase: "the septic inspection",
      season: { cold: [3, 4, 5, 6, 7, 8, 9, 10], warm: ALL },
      reserviceMonths: 36,
      kind: "maintenance",
    },
    {
      id: "septic.repair",
      label: "Repair (baffle, pump, lines)",
      match: /\b(repair|baffle|replace pump|effluent pump|lift station|alarm|float|line|pipe|jett|backup|backing up|clog)/i,
      phrase: "the septic repair",
      season: { cold: ALL, warm: ALL },
      kind: "repair",
      worseIfWaiting: "A septic problem that's showing symptoms doesn't settle down — it usually shows up next as a backup.",
    },
    {
      id: "septic.riser",
      label: "Risers & lids",
      match: /\b(riser|lid)/i,
      phrase: "the riser install",
      season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "improvement",
    },
    {
      id: "septic.filter",
      label: "Effluent filter",
      match: /\b(filter)/i,
      phrase: "the effluent filter",
      season: { cold: ALL, warm: ALL },
      reserviceMonths: 12,
      kind: "maintenance",
    },
    {
      id: "septic.field",
      label: "Drain field / new system",
      match: /\b(drain ?field|leach|mound|new system|replacement system|install|perc)/i,
      phrase: "the drain field work",
      season: { cold: [5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "repair",
      worseIfWaiting: "A failing field gets more expensive the longer it's pushed — and it's a health issue once it surfaces.",
    },
  ],
  objects: [
    [/pump[- ]?out|\bpumping\b/i, "the pump-out"],
    [/effluent pump/i, "the effluent pump"],
    [/drain ?field|leach field/i, "the drain field"],
    [/\bbaffle/i, "the baffle"],
    [/\briser/i, "the risers"],
    [/\binspection/i, "the septic inspection"],
    [/\bjett|\bbackup|backing up/i, "the backup"],
    [/\btank\b/i, "the tank"],
    [/\bpump\b/i, "the pump"],
  ],
  places: [],
  whyQuotesDie: [
    "Pump-outs are out-of-sight, out-of-mind until something backs up",
    "Repair quotes scare people and they 'wait and see'",
    "Nobody reminds them when three years have gone by",
    "Home sellers who got an inspection quote and then sold",
  ],
  quoteAngles: ["check_in", "problem_grows", "timing", "crew_nearby", "close_file"],
  crewLine: "We've got the truck in your area next week and room for a couple more stops.",
  minQuote: 250,
  // a visit is a paid service call
  freeLook: false,
};

/* ================================================================== */
/* FENCE                                                               */
/* ================================================================== */
const fence: TradePlaybook = {
  id: "fence",
  workPhrase: "the fence",
  label: "Fence",
  noun: "fence company",
  ticket: { low: 500, typical: 5500, high: 30000 },
  typicalCloseRate: 0.3,
  peakMonths: { cold: [3, 4, 5, 6], warm: [2, 3, 4, 5, 10] },
  services: [
    {
      id: "fence.install",
      label: "New fence",
      match: /\b(install|new|privacy|vinyl|wood|cedar|aluminum|chain ?link|picket|ornamental|split rail|horse|farm|board|fence)/i,
      phrase: "the new fence",
      season: { cold: [3, 4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "improvement",
      followOns: [
        { serviceId: "fence.stain", afterDays: [60, 540], why: "new wood fences should be sealed within the first year", pitch: "A new wood fence holds up a lot longer if it's sealed in its first year." },
        { serviceId: "fence.gate", afterDays: [0, 365], why: "gate hardware and self-closers after install", pitch: "Self-closing hinges and a solid latch keep the gate shut on its own." },
      ],
      timingLine: {
        cold: "Spring is the busiest fence season — the install calendar fills months out.",
        warm: "Getting on the calendar now beats the spring rush.",
      },
      timingMonths: { cold: [11, 12, 1, 2, 3], warm: [10, 11, 12, 1, 2] },
    },
    {
      id: "fence.repair",
      label: "Fence repair",
      match: /\b(repair|replace (a )?(post|section|panel)|lean|storm|damage|broken|rotted|fix)/i,
      phrase: "the fence repair",
      season: { cold: ALL, warm: ALL },
      kind: "repair",
      worseIfWaiting: "One leaning section puts the load on the posts next to it — repairs spread.",
    },
    {
      id: "fence.gate",
      label: "Gate",
      match: /\b(gate|latch|hinge|opener)/i,
      phrase: "the gate",
      season: { cold: ALL, warm: ALL },
      kind: "repair",
    },
    {
      id: "fence.stain",
      label: "Staining / sealing",
      match: /\b(stain|seal|paint)/i,
      phrase: "the fence staining",
      season: { cold: [5, 6, 7, 8, 9], warm: [3, 4, 5, 10, 11] },
      reserviceMonths: 30,
      kind: "maintenance",
    },
    {
      id: "fence.pool",
      label: "Pool fence",
      match: /\b(pool)/i,
      phrase: "the pool fence",
      season: { cold: [3, 4, 5], warm: ALL },
      kind: "improvement",
    },
  ],
  objects: [
    [/privacy/i, "the privacy fence"],
    [/vinyl/i, "the vinyl fence"],
    [/(wood|cedar)/i, "the wood fence"],
    [/aluminum|ornamental/i, "the aluminum fence"],
    [/chain ?link/i, "the chain link"],
    [/\bgate\b/i, "the gate"],
    [/\bfence\b/i, "the fence"],
  ],
  places: [
    [/back ?yard|rear/i, "in the backyard"],
    [/pool/i, "around the pool"],
    [/front/i, "out front"],
  ],
  whyQuotesDie: [
    "Sticker shock after the linear-foot price",
    "Waiting on a survey, HOA approval or a neighbor to split the cost",
    "They were planning for 'spring' and spring came and went",
    "Material prices moved and nobody re-quoted",
  ],
  quoteAngles: ["check_in", "revise", "timing", "crew_nearby", "close_file"],
  crewLine: "We've got a crew installing nearby and an open slot on the calendar.",
  minQuote: 800,
  freeLook: true,
  // the four things a fence price turns on
  intakeAsk: "If you can, reply with roughly how many feet, the material you're thinking of, any gates, and whether there's an HOA.",
  intakeKnown: /\b\d{2,4}\s*(ft|feet|foot|linear|lf|')(?![a-z])/i,
};

/* ================================================================== */
/* CONCRETE                                                            */
/* ================================================================== */
const concrete: TradePlaybook = {
  id: "concrete",
  workPhrase: "the concrete work",
  label: "Concrete",
  noun: "concrete company",
  ticket: { low: 800, typical: 6500, high: 40000 },
  typicalCloseRate: 0.3,
  peakMonths: { cold: [4, 5, 6, 7, 8, 9], warm: [2, 3, 4, 5, 9, 10, 11] },
  services: [
    {
      id: "conc.driveway",
      label: "Driveway",
      match: /\b(driveway|drive way|apron|approach)/i,
      phrase: "the driveway",
      season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "improvement",
      followOns: [{ serviceId: "conc.seal", afterDays: [30, 365], why: "new concrete should be sealed after it cures", pitch: "New concrete holds up better against water and salt once it's sealed." }],
      timingLine: {
        cold: "Pour season ends when nights drop near freezing — the last slots go fast.",
        warm: "Cooler months are the best time to pour before the summer heat.",
      },
      timingMonths: { cold: [8, 9, 10], warm: [10, 11, 12, 1, 2, 3, 4] },
    },
    {
      id: "conc.patio",
      label: "Patio / slab",
      match: /\b(patio|slab|pad|stamped|shed pad|hot tub|basketball|court)/i,
      phrase: "the patio",
      season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "improvement",
    },
    {
      id: "conc.walk",
      label: "Walkways & steps",
      match: /\b(walk|sidewalk|steps|stairs|stoop|path)/i,
      phrase: "the walkway",
      season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "improvement",
    },
    {
      id: "conc.repair",
      label: "Repair / replacement",
      match: /\b(repair|crack|replace|tear out|remove|sinking|settl|trip hazard|lift|level|mudjack)/i,
      phrase: "the concrete repair",
      season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "repair",
      worseIfWaiting: "Water gets into cracks and freeze-thaw opens them wider every winter.",
    },
    {
      id: "conc.seal",
      label: "Sealing",
      match: /\b(seal|sealer|coat)/i,
      phrase: "the sealing",
      season: { cold: [5, 6, 7, 8, 9], warm: [3, 4, 5, 9, 10, 11] },
      reserviceMonths: 30,
      kind: "maintenance",
    },
    {
      id: "conc.foundation",
      label: "Foundation / garage floor",
      match: /\b(foundation|footing|garage floor|basement|wall)/i,
      phrase: "the foundation work",
      season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "repair",
    },
  ],
  objects: [
    [/driveway/i, "the driveway"],
    [/patio/i, "the patio"],
    [/(steps|stairs|stoop)/i, "the steps"],
    [/(walk|sidewalk)/i, "the walkway"],
    [/garage/i, "the garage floor"],
    [/slab|pad/i, "the slab"],
  ],
  places: [],
  whyQuotesDie: [
    "Big number, and they wanted to wait for a tax refund or a bonus",
    "Weather pushed the pour and nobody rescheduled",
    "They were comparing three bids and stalled",
    "They meant 'next season' and next season came",
  ],
  quoteAngles: ["check_in", "timing", "revise", "crew_nearby", "close_file"],
  crewLine: "We've got a pour scheduled near you and could add one more while the crew's in the area.",
  minQuote: 1000,
  freeLook: true,
};

/* ================================================================== */
/* PRESSURE WASHING / SOFT WASH                                        */
/* ================================================================== */
const pressure: TradePlaybook = {
  id: "pressure_washing",
  workPhrase: "the washing",
  label: "Pressure washing",
  noun: "pressure washing company",
  ticket: { low: 150, typical: 450, high: 2500 },
  typicalCloseRate: 0.5,
  peakMonths: { cold: [4, 5, 6, 9], warm: [3, 4, 5, 9, 10] },
  services: [
    {
      id: "pw.house",
      label: "House wash",
      match: /\b(house|siding|soft ?wash|exterior wash|home wash|vinyl|stucco|brick)/i,
      phrase: "the house wash",
      season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL },
      // owners report homeowners re-wash every 3-10 years, not yearly (PressureWashingResource)
      reserviceMonths: 36,
      kind: "maintenance",
      followOns: [
        { serviceId: "pw.gutter", afterDays: [0, 365], why: "gutter brightening and clean-out pair with a house wash", pitch: "Gutters can be brightened and cleared out so they match a clean house." },
        { serviceId: "pw.window", afterDays: [0, 60], why: "clean windows after a wash", pitch: "Windows can pick up spots from a wash, and a window cleaning finishes it off." },
      ],
      timingLine: { cold: "Spring is when the green and black streaks show up worst.", warm: "Getting ahead of pollen and mildew season." },
      timingMonths: { cold: [2, 3, 4, 5], warm: [11, 12, 1, 2] },
    },
    {
      id: "pw.roof",
      label: "Roof soft wash",
      match: /\b(roof|shingle|black streak|moss|algae|gloeocapsa)/i,
      phrase: "the roof cleaning",
      season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL },
      reserviceMonths: 30,
      kind: "maintenance",
      worseIfWaiting: "Algae and moss hold moisture against the shingles and shorten the roof's life.",
    },
    {
      id: "pw.flat",
      label: "Driveway & concrete",
      match: /\b(driveway|concrete|patio|walk|sidewalk|pool deck|pavers|flatwork|surface clean)/i,
      phrase: "the driveway cleaning",
      season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL },
      reserviceMonths: 24,
      kind: "maintenance",
    },
    {
      id: "pw.deck",
      label: "Deck & fence",
      match: /\b(deck|fence|wood|stain|seal)/i,
      phrase: "the deck",
      season: { cold: [5, 6, 7, 8, 9], warm: [3, 4, 5, 9, 10, 11] },
      reserviceMonths: 24,
      kind: "maintenance",
    },
    {
      id: "pw.gutter",
      label: "Gutters",
      match: /\b(gutter|downspout)/i,
      phrase: "the gutters",
      season: { cold: [4, 5, 10, 11], warm: [3, 4, 10, 11, 12] },
      reserviceMonths: 6,
      kind: "maintenance",
    },
    {
      id: "pw.window",
      label: "Windows",
      match: /\b(window)/i,
      phrase: "the windows",
      season: { cold: [4, 5, 6, 9, 10], warm: ALL },
      reserviceMonths: 12,
      kind: "maintenance",
    },
  ],
  objects: [
    [/roof/i, "the roof cleaning"],
    [/driveway/i, "the driveway cleaning"],
    [/deck/i, "the deck cleaning"],
    [/fence/i, "the fence cleaning"],
    [/patio/i, "the patio cleaning"],
    [/(house|siding|home)/i, "the house wash"],
  ],
  places: [],
  whyQuotesDie: [
    "It's a 'nice to have' — easy to put off",
    "They meant to book before a party or a sale and missed it",
    "Price-shopping against cheap guys",
    "Nobody called the next spring even though they paid last year",
  ],
  quoteAngles: ["check_in", "timing", "crew_nearby", "easy_yes", "close_file"],
  crewLine: "We're washing a couple of houses on your street next week and can fit one more.",
  minQuote: 150,
  freeLook: true,
};

/* ================================================================== */
/* HOLIDAY & PERMANENT LIGHTING                                        */
/* ================================================================== */
// Jobber's bid guide: a full holiday package runs about $750-$5,000; permanent systems about $2,000-$6,000+.
// Sold Aug-Nov, installed from November 1 to the end of January (Jobber); returning customers book in
// September and October (Big Star Lights). No shop's numbers yet, so the close rate is only a prior.
const SELL_LIGHTS = [8, 9, 10, 11, 12];
const PERMANENT_WORDS = "permanent|trimlight|gemstone|jellyfish|oelo|track (?:light\\w*|system)";
const TAKEDOWN_WORDS = "take-?downs?|take down|remov\\w*|storage|pack\\w* up";
/** What goes up: a quote that names it is the install, even when takedown and storage are on it too. */
const PUT_UP_WORDS = "install\\w*|hang\\w*|put up|package|lease\\w*|roofline|c9s?|c7s?|mini[- ]?lights?|wreaths?|garlands?|bows?|trees?|bush(?:es)?|shrubs?";
const LIGHT_ADDON = /\b(add-?ons?|extension|extend\w*|add (a |another |more )?(run|zone|section|side)|additional (run|zone|section|footage|feet|side)|expan\w*)/i;
const lighting: TradePlaybook = {
  id: "holiday_lighting",
  workPhrase: "the lights",
  label: "Holiday lighting",
  noun: "holiday lighting company",
  ticket: { low: 400, typical: 1500, high: 8000 },
  typicalCloseRate: 0.45,
  peakMonths: { cold: [9, 10, 11], warm: [9, 10, 11] },
  services: [
    {
      id: "light.install",
      label: "Holiday light install",
      match: /\b(christmas|xmas|holiday|c9s?|c7s?|mini[- ]?lights?|roofline|wreaths?|garlands?|install\w*|hang\w*|put up|lease\w*|rental|package|decor\w*|display)/i,
      // a permanent system, or a takedown visit ("Takedown - roofline", "Christmas light removal"), uses the same words
      unless: new RegExp(
        `\\b(${PERMANENT_WORDS})\\b|^\\W*((christmas|xmas|holiday) (lights?|lighting) )?(${TAKEDOWN_WORDS})\\b|^(?!.*\\b(${PUT_UP_WORDS})\\b)(?=.*\\b(${TAKEDOWN_WORDS})\\b)`,
        "i",
      ),
      phrase: "the holiday lights",
      season: { cold: SELL_LIGHTS, warm: SELL_LIGHTS },
      reserviceMonths: 12,
      // due October 1, so the note can go from late August, when returning customers book
      dueMonth: 10,
      dueAsk: "Want the lights up again this year?",
      kind: "maintenance",
      followOns: [
        {
          serviceId: "light.permanent",
          afterDays: [120, 540],
          why: "customers who hire you every fall are the ones who ask about permanent lights",
          pitch: "Permanent lights mount along the roofline once and stay up all year, so nobody has to hang them again each fall.",
        },
      ],
      timingLine: {
        cold: "Most of our install dates for November fill in October.",
        warm: "Most of our install dates for November fill in October.",
      },
      timingMonths: { cold: [8, 9, 10], warm: [8, 9, 10] },
    },
    {
      id: "light.takedown",
      label: "Takedown & storage",
      match: /\b(take-?downs?|take down|light(s|ing)? remov\w*|remov\w* (of )?(the )?(\w+ )?lights|storage|pack\w* up)/i,
      phrase: "the light takedown",
      season: { cold: [1, 2], warm: [1, 2] },
      // rides on the install: never a routine or a clock of its own
      kind: "improvement",
    },
    {
      id: "light.permanent",
      label: "Permanent lighting",
      match: new RegExp(`\\b(${PERMANENT_WORDS}|year[- ]round|app[- ]controlled|rgbw?)`, "i"),
      // adding a run to a system already up is the add-on, when that's what the quote is: a new system's own
      // "Additional footage - garage" line doesn't make it one
      unless: LIGHT_ADDON,
      unlessPrimaryLine: true,
      phrase: "the permanent lights",
      season: { cold: [3, 4, 5, 6, 7, 8, 9, 10, 11], warm: ALL },
      kind: "improvement",
      followOns: [
        {
          serviceId: "light.addon",
          afterDays: [60, 540],
          why: "owners often extend a permanent system to the garage or the back of the house once they've lived with the front",
          byPrimaryLine: true,
          pitch: "If you'd like the lights to run along the garage or the back of the house too, they can usually tie into the same controller.",
        },
      ],
      timingLine: {
        cold: "Permanent lights can go up any time the weather's decent, and the spring schedule is a lot quieter than the fall.",
        warm: "Permanent lights can go up any time of year, and the spring schedule is a lot quieter than the fall.",
      },
      timingMonths: { cold: [3, 4, 5], warm: [2, 3, 4, 5] },
    },
    {
      id: "light.addon",
      label: "Permanent lighting add-on",
      match: LIGHT_ADDON,
      phrase: "extending the permanent lights",
      season: { cold: [3, 4, 5, 6, 7, 8, 9, 10, 11], warm: ALL },
      kind: "improvement",
    },
    {
      id: "light.event",
      label: "Event & landscape lighting",
      match: /\b(event|wedding|party|parties|graduation|bistro|caf[eé]|string lights|patio lights|market lights|landscape light\w*|path lights?|up-?light\w*|outdoor lighting)/i,
      phrase: "the outdoor lighting",
      season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "improvement",
    },
  ],
  objects: [
    // extending a system already up reads as the add-on's own phrase, when the title (or the line naming it) says so
    [/(?<!^[^·]*\b(?:add-?ons?|extension|extend\w*|additional)\b.*)\bpermanent\b(?![^·]*\b(?:add-?ons?|extension|extend\w*|additional)\b)/i, "the permanent lights"],
    [/\broofline\b/i, "the roofline lights"],
    [/\bfront tree/i, "the lights on the front tree"],
    [/\bwreaths?\b/i, "the wreath"],
    [/\bgarlands?\b/i, "the garland"],
    [/\bporch\b/i, "the lights on the porch"],
    [/\bdriveway\b/i, "the lights along the driveway"],
    [/\bwalkway\b/i, "the lights along the walkway"],
  ],
  places: [],
  whyQuotesDie: [
    "Price shock the first year: a full roofline costs more than they pictured",
    "They waited, then figured every install date was gone",
    "They decided to hang the lights themselves this year",
    "They forgot about it until December, and by then it felt too late to ask",
    "Last year's customers expect you to call them, and nobody does",
  ],
  quoteAngles: ["check_in", "timing", "easy_yes", "crew_nearby", "close_file"],
  crewLine: "We've got a crew hanging lights in your neighborhood next week.",
  minQuote: 300,
  freeLook: true,
};

/* ================================================================== */
/* DECKS                                                               */
/* ================================================================== */
// Cost vs Value 2025: a wood deck addition averages about $18,263, a composite one about $25,096. Most builders
// are small shops (NADRA: 49% have five employees or fewer). Sold Feb-Jun; wood needs a stain and seal every
// 24-36 months (the painting playbook's deck interval is 30).
const DECK_STAIN = "A wood deck holds up a lot longer when it's stained and sealed every couple of years.";
const DECK_LIGHTS = "Post cap and stair lights make the steps easy to see after dark.";
const DECK_SHADE = "A pergola gives part of the deck some shade in the middle of the afternoon.";
const COMPOSITE = "composite|trex|timbertech|azek|fiberon|pvc";
const deck: TradePlaybook = {
  id: "deck",
  workPhrase: "the deck",
  label: "Decks",
  noun: "deck builder",
  ticket: { low: 600, typical: 12000, high: 60000 },
  typicalCloseRate: 0.3,
  peakMonths: { cold: [2, 3, 4, 5, 6], warm: [1, 2, 3, 4, 5, 10] },
  services: [
    {
      id: "deck.build",
      label: "New deck",
      match: /\b(new deck|deck (build\w*|install\w*|addition|extension|expan\w*)|build\w* (a |an |the )?(new )?deck|(pressure[- ]treated|pt|treated|cedar|redwood|mahogany|ipe|hardwood|wood|raised|elevated|multi-level|two-level|second[- ]story|ground[- ]level|floating|wrap-?around)\s+(\w+\s+)?deck)/i,
      // composite never needs a stain; tearing off an old deck is the replacement
      unless: new RegExp(`\\b(${COMPOSITE}|replace\\w*|resurfac\\w*|re-?deck\\w*|re-?board\\w*|tear[- ]?(off|out)|rebuild\\w*)\\b`, "i"),
      phrase: "the new deck",
      season: { cold: [2, 3, 4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "improvement",
      followOns: [
        { serviceId: "deck.stain", afterDays: [730, 1095], why: "a wood deck needs a stain and seal every two to three years", pitch: DECK_STAIN },
        { serviceId: "deck.lighting", afterDays: [14, 540], why: "lighting is the most common add-on to a new deck", pitch: DECK_LIGHTS },
        { serviceId: "deck.pergola", afterDays: [60, 540], why: "shade is the next thing people want once they use the deck", pitch: DECK_SHADE },
      ],
      timingLine: {
        cold: "Most decks that get built by early summer are planned over the winter and spring.",
        warm: "The cooler months are the easiest time to build before the summer heat.",
      },
      timingMonths: { cold: [1, 2, 3, 4], warm: [10, 11, 12, 1, 2] },
    },
    {
      id: "deck.composite",
      label: "Composite deck",
      match: new RegExp(`\\b(${COMPOSITE})`, "i"),
      // "Trex railing" or a PVC pergola on its own is that job, not a deck
      unless: /^(?!.*\bdeck)(?=.*\b(rail\w*|stairs?|steps|pergola\w*|porch\w*|cover\w*|lights?|lighting)\b)/i,
      phrase: "the composite deck",
      season: { cold: [2, 3, 4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "improvement",
      followOns: [
        { serviceId: "deck.lighting", afterDays: [14, 540], why: "lighting is the most common add-on to a new deck", pitch: DECK_LIGHTS },
        { serviceId: "deck.pergola", afterDays: [60, 540], why: "shade is the next thing people want once they use the deck", pitch: DECK_SHADE },
      ],
      timingLine: {
        cold: "Most decks that get built by early summer are planned over the winter and spring.",
        warm: "The cooler months are the easiest time to build before the summer heat.",
      },
      timingMonths: { cold: [1, 2, 3, 4], warm: [10, 11, 12, 1, 2] },
    },
    {
      id: "deck.railing",
      label: "Railings & stairs",
      match: /\b((replace\w*|new|install\w*|add\w*|rebuild\w*) (\w+ )?)?(rail\w*|stairs?|steps|balusters?|spindles?|handrails?|landing)/i,
      phrase: "the railing",
      season: { cold: [3, 4, 5, 6, 7, 8, 9, 10, 11], warm: ALL },
      kind: "improvement",
    },
    {
      id: "deck.pergola",
      label: "Pergolas, covers & porches",
      match: /\b(pergola\w*|gazebo\w*|arbor\w*|shade (sail|structure|cover)\w*|awning\w*|cover(ed)? (deck|patio|porch)|deck cover\w*|roof(ed)? over|screen(ed)?[- ](in )?porch|three[- ]season|sunroom|new porch|porch (build\w*|addition|roof))/i,
      phrase: "the pergola",
      season: { cold: [2, 3, 4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "improvement",
    },
    {
      id: "deck.replace",
      label: "Deck replacement",
      match: /\b(replace\w*|resurfac\w*|re-?deck\w*|re-?board\w*|tear[- ]?(off|out)|rebuild\w*)/i,
      unless: new RegExp(`\\b(${COMPOSITE})\\b`, "i"),
      phrase: "the deck replacement",
      season: { cold: [2, 3, 4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "improvement",
      followOns: [{ serviceId: "deck.stain", afterDays: [730, 1095], why: "a wood deck needs a stain and seal every two to three years", pitch: DECK_STAIN }],
    },
    {
      id: "deck.stain",
      label: "Staining & sealing",
      match: /\b(stain\w*|seal\w*|refinish\w*|restor\w*|brighten\w*|strip\w*|sand\w*|clean\w*|wash\w*|oil\w*)/i,
      phrase: "the deck staining",
      season: { cold: [5, 6, 7, 8, 9], warm: [3, 4, 5, 10, 11] },
      reserviceMonths: 30,
      kind: "maintenance",
      worseIfWaiting: "Once the old stain wears through, water soaks into the boards and they start to gray and crack.",
      timingLine: {
        cold: "Stain needs a few dry days in a row with warm nights, so late spring through early fall is when it goes on.",
        warm: "Stain goes on best when it isn't too hot, so spring and fall are the times to do it.",
      },
      timingMonths: { cold: [3, 4, 5, 6, 7, 8], warm: [2, 3, 4, 9, 10] },
    },
    {
      id: "deck.repair",
      label: "Deck repair",
      match: /\b(repair\w*|fix\w*|rot\w*|soft spots?|loose|wobbl\w*|sagg?\w*|replace (\d+ |a |some |the )?(\w+ )?boards?|board replace\w*|sister\w*|joists?|ledger|footings?|(rotted|rotten|loose|new|replace\w*) posts?)/i,
      phrase: "the deck repair",
      season: { cold: [3, 4, 5, 6, 7, 8, 9, 10, 11], warm: ALL },
      kind: "repair",
      worseIfWaiting: "Rot spreads from one board to the next and down into the framing, so a small repair now keeps it from becoming a bigger one.",
    },
    {
      id: "deck.lighting",
      label: "Deck lighting",
      match: /\b(light\w*|post caps?|riser lights?|lamps?|lantern\w*)/i,
      phrase: "the deck lighting",
      season: { cold: [3, 4, 5, 6, 7, 8, 9, 10, 11], warm: ALL },
      kind: "improvement",
    },
  ],
  // the service names the rest ("the new deck", "the railing", "the pergola"), so "new deck + pergola" stays the deck
  objects: [
    [/\bgazebo/i, "the gazebo"],
    [/screen(ed)?[- ](in )?porch/i, "the screened porch"],
  ],
  places: [
    [/(back ?yard|backyard|rear)/i, "in the backyard"],
    [/\bpool\b/i, "by the pool"],
  ],
  whyQuotesDie: [
    "Big number: they wanted to save up, or wait for a tax refund or a bonus",
    "They got three bids and the decision stalled",
    "Waiting on a permit, the HOA or a spouse, and nobody followed up",
    "They meant to build 'this summer' and the summer got away",
    "Wood or composite: too many choices and no next step",
  ],
  quoteAngles: ["check_in", "revise", "timing", "crew_nearby", "close_file"],
  crewLine: "We've got a crew building a deck near you and a few open days after.",
  minQuote: 800,
  freeLook: true,
};

/* ================================================================== */
/* The rest — compact but real                                         */
/* ================================================================== */
function simple(
  id: TradeId,
  label: string,
  noun: string,
  ticket: [number, number, number],
  close: number,
  peak: { cold: number[]; warm: number[] },
  services: TradePlaybook["services"],
  objects: TradePlaybook["objects"],
  why: string[],
  crew: string,
  min: number,
  freeLook = false,
): TradePlaybook {
  return {
    id,
    workPhrase: WORK_PHRASE[id] ?? "the work we quoted",
    label,
    noun,
    ticket: { low: ticket[0], typical: ticket[1], high: ticket[2] },
    typicalCloseRate: close,
    peakMonths: peak,
    services,
    objects,
    places: [],
    whyQuotesDie: why,
    quoteAngles: ["check_in", "timing", "problem_grows", "crew_nearby", "close_file"],
    crewLine: crew,
    minQuote: min,
    freeLook,
  };
}

const gutter = simple(
  "gutter", "Gutter service", "gutter company", [120, 350, 6000], 0.5, { cold: [4, 5, 10, 11], warm: [3, 10, 11, 12] },
  [
    { id: "gutter.clean", label: "Gutter cleaning", match: /\b(clean|clear|flush|debris|leaves)/i, phrase: "the gutter cleaning", season: { cold: [4, 5, 10, 11, 12], warm: [3, 4, 10, 11, 12] }, reserviceMonths: 6, kind: "maintenance", worseIfWaiting: "Overflowing gutters dump water right at the foundation.", followOns: [{ serviceId: "gutter.guard", afterDays: [0, 365], why: "guards end the twice-a-year cleaning", pitch: "Gutter guards cut down on how often they need cleaning out." }] },
    { id: "gutter.guard", label: "Gutter guards", match: /\b(guard|screen|cover|leaf ?filter|mesh)/i, phrase: "the gutter guards", season: { cold: ALL, warm: ALL }, kind: "improvement" },
    { id: "gutter.install", label: "New gutters", match: /\b(install|new|seamless|replace|downspout)/i, phrase: "the new gutters", season: { cold: [4, 5, 6, 7, 8, 9, 10, 11], warm: ALL }, kind: "improvement" },
    { id: "gutter.repair", label: "Gutter repair", match: /\b(repair|leak|sag|reattach|pitch)/i, phrase: "the gutter repair", season: { cold: ALL, warm: ALL }, kind: "repair" },
  ],
  [[/gutter/i, "the gutters"], [/downspout/i, "the downspouts"]],
  ["Easy to forget until the next storm", "Guard quotes feel expensive next to a cleaning", "Nobody reminds them in the fall"],
  "We're doing gutters on a few houses near you and can add one more.", 100, true,
);

const windowCleaning = simple(
  "window_cleaning", "Window cleaning", "window cleaning company", [150, 400, 2000], 0.5, { cold: [4, 5, 9, 10], warm: [3, 4, 10, 11] },
  [
    { id: "win.clean", label: "Window cleaning", match: /\b(window|glass|screen|track|interior|exterior)/i, phrase: "the window cleaning", season: { cold: [3, 4, 5, 6, 9, 10, 11], warm: ALL }, reserviceMonths: 6, kind: "maintenance" },
  ],
  [[/window/i, "the windows"]],
  ["Nice-to-have that slides", "They meant to book before the holidays", "Nobody asked again the next season"],
  "We're working on your street next week and have room for one more house.", 100, true,
);

const pool = simple(
  "pool", "Pool service", "pool company", [150, 1200, 15000], 0.45, { cold: [4, 5, 9], warm: [2, 3, 4, 5] },
  [
    { id: "pool.open", label: "Pool opening", match: /\b(open|start ?up|de-?winteriz|spring)/i, phrase: "the pool opening", season: { cold: [3, 4, 5], warm: [2, 3] }, reserviceMonths: 12, kind: "maintenance", timingLine: { cold: "Opening slots fill up by May.", warm: "Opening slots fill up early." }, timingMonths: { cold: [1, 2, 3, 4], warm: [11, 12, 1, 2] } },
    { id: "pool.close", label: "Pool closing", match: /\b(clos|winteriz|cover)/i, phrase: "the pool closing", season: { cold: [8, 9, 10], warm: [10, 11] }, reserviceMonths: 12, kind: "maintenance" },
    { id: "pool.weekly", label: "Weekly service", match: /\b(weekly|service|maint|chemical|clean)/i, phrase: "the weekly pool service", season: { cold: [5, 6, 7, 8, 9], warm: ALL }, reserviceMonths: 12, kind: "recurring" },
    { id: "pool.repair", label: "Equipment repair", match: /\b(pump|filter|heater|leak|repair|motor|liner|salt|cell|replace)/i, phrase: "the pool repair", season: { cold: ALL, warm: ALL }, kind: "repair", worseIfWaiting: "Equipment problems tend to fail completely at the worst time — mid-season." },
  ],
  [[/liner/i, "the liner"], [/heater/i, "the heater"], [/pump/i, "the pump"], [/filter/i, "the filter"], [/pool/i, "the pool"]],
  ["Put off until the season started, then they were booked", "Repair sticker shock", "Nobody reminds them about opening next spring"],
  "We're servicing pools on your street and have room on the route.", 150,
);

const pest = simple(
  "pest", "Pest control", "pest control company", [120, 450, 3500], 0.5, { cold: [4, 5, 6, 9], warm: [2, 3, 4, 5, 6] },
  [
    { id: "pest.plan", label: "Quarterly plan", match: /\b(quarter|plan|program|recurring|annual|general pest|perimeter)/i, phrase: "the pest plan", season: { cold: ALL, warm: ALL }, reserviceMonths: 3, kind: "recurring" },
    { id: "pest.termite", label: "Termites", match: /\b(termite|wdi|bait|trench)/i, phrase: "the termite treatment", season: { cold: [3, 4, 5, 6], warm: [2, 3, 4, 5] }, reserviceMonths: 12, kind: "repair", worseIfWaiting: "Termites don't stop on their own — damage keeps adding up quietly." },
    { id: "pest.mosquito", label: "Mosquito & tick", match: /\b(mosquito|tick|flea)/i, phrase: "the mosquito treatment", season: { cold: [5, 6, 7, 8, 9], warm: [3, 4, 5, 6, 7, 8, 9, 10] }, reserviceMonths: 12, kind: "recurring" },
    { id: "pest.rodent", label: "Rodents & wildlife", match: /\b(rodent|mice|mouse|rat|wildlife|squirrel|raccoon|bat|exclusion)/i, phrase: "the rodent work", season: { cold: [9, 10, 11, 12, 1], warm: ALL }, kind: "repair" },
  ],
  [[/termite/i, "the termites"], [/mosquito/i, "the mosquitoes"], [/(mice|mouse|rodent|rat)/i, "the rodent problem"], [/ant/i, "the ants"]],
  ["Symptoms went quiet so they waited", "Recurring plans cancelled over price", "They meant to start before spring"],
  "We have a tech in your neighborhood next week.", 100,
);

const hvac = simple(
  "hvac", "HVAC", "heating and cooling company", [150, 900, 18000], 0.45, { cold: [5, 6, 7, 10, 11, 12], warm: [4, 5, 6, 7, 8] },
  [
    { id: "hvac.tuneup", label: "Tune-up", match: /\b(tune|maint|check|clean|service|inspect|plan|agreement|membership)/i, phrase: "the tune-up", season: { cold: [3, 4, 5, 9, 10], warm: [2, 3, 4, 10, 11] }, reserviceMonths: 6, kind: "maintenance" },
    { id: "hvac.replace", label: "System replacement", match: /\b(replace|new system|install|heat pump|furnace|condenser|air handler|mini ?split|ductless|boiler)/i, phrase: "the system replacement", season: { cold: ALL, warm: ALL }, kind: "improvement", worseIfWaiting: "An old system usually picks the hottest or coldest week of the year to quit." },
    { id: "hvac.repair", label: "Repair", match: /\b(repair|leak|refrigerant|coil|capacitor|motor|compressor|not cooling|not heating)/i, phrase: "the repair", season: { cold: ALL, warm: ALL }, kind: "repair" },
  ],
  [[/furnace/i, "the furnace"], [/heat pump/i, "the heat pump"], [/(a\/?c|air condition|condenser)/i, "the AC"], [/boiler/i, "the boiler"], [/duct/i, "the ductwork"]],
  ["Replacement quotes are big and people limp the old unit along", "Financing wasn't offered or explained", "They got three bids"],
  "We have a tech in your area this week.", 150,
);

const junk = simple(
  "junk_removal", "Junk removal", "junk removal company", [150, 450, 3000], 0.55, { cold: [4, 5, 6, 7, 8], warm: [3, 4, 5, 6, 7, 8] },
  [{ id: "junk.haul", label: "Haul-away", match: /\b(junk|haul|remov|clean ?out|debris|demo|furniture|appliance|estate|garage|basement|shed)/i, phrase: "the clean-out", season: { cold: ALL, warm: ALL }, kind: "improvement" }],
  [[/garage/i, "the garage"], [/basement/i, "the basement"], [/shed/i, "the shed"], [/attic/i, "the attic"]],
  ["They decided to do it themselves 'this weekend'", "Timing tied to a move or sale that shifted"],
  "We've got a truck in your area with room on it.", 150, true,
);

/* ================================================================== */
/* PAINTING                                                            */
/* ================================================================== */
// Owner research (r/paint and r/Paintingbusiness, 2023-26): homeowners get three or more bids and never tell the
// losers no; the number lands over what they'd budgeted ("a 20k job… budgeted 10 to 15k"); exterior bids pushed
// "to spring" are never picked back up; and exterior clients are "surprised that we do interior painting". In cold
// climates the exterior season runs about May to October and is sold in late winter and spring, with winter
// interiors sold August to October for November to March. Repaint clocks (Fixr, HomeAdvisor): exterior 5-10 years,
// interior rooms 3-10, wood decks and fences 2-3. Cabinets are an improvement with no clock.
const PAINT_STAIN_WORSE = "Once the old stain wears through, water soaks into the boards and they start to gray and crack.";
const painting: TradePlaybook = {
  id: "painting",
  workPhrase: "the painting",
  label: "Painting",
  noun: "painting company",
  // Angi: exterior averages about $3,178; Fixr puts a full exterior repaint at $6,242-11,617. Own invoices always win.
  ticket: { low: 400, typical: 4500, high: 25000 },
  // owners report 25-50% on non-referral estimates
  typicalCloseRate: 0.35,
  peakMonths: { cold: [4, 5, 6, 7, 8, 9], warm: [2, 3, 4, 10, 11] },
  services: [
    {
      id: "paint.exterior",
      label: "Exterior repaint",
      match: /\b(exterior|siding|clapboard|stucco|soffits?|fascia|eaves|outside|house paint\w*|paint\w* (the )?house)/i,
      phrase: "the exterior painting",
      season: { cold: [5, 6, 7, 8, 9, 10], warm: [1, 2, 3, 4, 10, 11, 12] },
      reserviceMonths: 72,
      kind: "improvement",
      followOns: [
        { serviceId: "paint.interior", afterDays: [45, 540], why: "exterior clients often don't know the same crew paints inside", pitch: "We paint inside too, if there are any rooms you've been meaning to get to." },
        { serviceId: "paint.deck", afterDays: [14, 540], why: "a weathered deck or fence stands out next to fresh paint", pitch: "If there's a deck or fence that could use a fresh coat of stain, we do that too." },
      ],
      timingLine: {
        cold: "Spring exterior dates usually book up by April.",
        warm: "The cooler, drier months are the best time for exterior paint here.",
      },
      // a spring line is only true while spring is still ahead: January to March
      timingMonths: { cold: [1, 2, 3], warm: [10, 11, 12, 1, 2, 3] },
    },
    {
      id: "paint.interior",
      label: "Interior rooms",
      // "kitchen cabinets" and a "bathroom vanity" are the cabinets, not the walls
      match: /\b(interior|inside|rooms?|bedrooms?|bathrooms?(?! vanit)|hallways?|stairwells?|foyer|ceilings?|walls|accent wall|basement|kitchen(?! cabinet))\b/i,
      phrase: "the interior painting",
      season: { cold: ALL, warm: ALL },
      reserviceMonths: 60,
      kind: "improvement",
      timingLine: {
        cold: "Winter is a good time for inside work: no weather delays.",
        warm: "Summer is a good time for inside work, when it's too hot for painting outside.",
      },
      timingMonths: { cold: [11, 12, 1, 2, 3], warm: [6, 7, 8, 9] },
    },
    {
      id: "paint.deck",
      label: "Deck & fence stain",
      match: /\b(deck|fence|pergola|stain\w*)/i,
      phrase: "the staining",
      season: { cold: [5, 6, 7, 8, 9], warm: [3, 4, 5, 10, 11] },
      reserviceMonths: 30,
      kind: "maintenance",
      worseIfWaiting: PAINT_STAIN_WORSE,
      timingLine: {
        cold: "Stain needs a few dry days in a row with warm nights, so late spring through early fall is when it goes on.",
        warm: "Stain goes on best when it isn't too hot, so spring and fall are the times to do it.",
      },
      timingMonths: { cold: [3, 4, 5, 6, 7, 8], warm: [2, 3, 4, 9, 10] },
    },
    {
      id: "paint.cabinets",
      label: "Cabinets",
      match: /\b(cabinets?|vanit(y|ies)|built-?ins?)\b/i,
      phrase: "the cabinets",
      season: { cold: ALL, warm: ALL },
      kind: "improvement",
    },
    {
      id: "paint.trim",
      label: "Trim & doors",
      match: /\b(trim|doors?|shutters|baseboards?|crown mo(u)?lding|window frames?|railings?|spindles?)\b/i,
      phrase: "the trim",
      season: { cold: ALL, warm: ALL },
      kind: "improvement",
    },
    {
      id: "paint.drywall",
      label: "Drywall repair",
      match: /\b(drywall|sheet ?rock|plaster|nail pops?|water (damage|stains?)|patch(es|ing)?)\b/i,
      phrase: "the drywall repair",
      season: { cold: ALL, warm: ALL },
      kind: "repair",
      followOns: [
        { serviceId: "paint.interior", afterDays: [7, 180], why: "a patched wall often means the whole room gets repainted", pitch: "A painted patch can look a shade off from the wall around it, so if you'd like the whole room done to match, we can do that too." },
      ],
    },
    {
      id: "paint.wash",
      label: "Power wash prep",
      match: /\b(power ?wash\w*|pressure ?wash\w*|soft ?wash\w*|house wash)/i,
      phrase: "the power washing",
      season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL },
      kind: "maintenance",
    },
  ],
  objects: [
    [/\bcabinets?\b/i, "the cabinets"],
    [/\bexterior trim\b/i, "the exterior trim"],
    [/\b(exterior|siding|outside)\b/i, "the exterior painting"],
    [/\b(power|pressure|soft) ?wash/i, "the power washing"],
    [/\bhouse\b(?! ?wash)/i, "the house painting"],
    [/\bdeck\b/i, "the deck"],
    [/\bfence\b/i, "the fence"],
    [/\bfront door\b/i, "the front door"],
    [/\bgarage doors?\b/i, "the garage door"],
    [/\bshutters\b/i, "the shutters"],
    [/\btrim\b/i, "the trim"],
    [/\bkitchen\b/i, "the kitchen"],
    [/\bliving room\b/i, "the living room"],
    [/\bdining room\b/i, "the dining room"],
    [/\bfamily room\b/i, "the family room"],
    [/\bbedrooms?\b/i, "the bedroom"],
    [/\bbathrooms?\b/i, "the bathroom"],
    [/\bhallways?\b/i, "the hallway"],
    [/\bstairwells?\b/i, "the stairwell"],
    [/\bbasement\b/i, "the basement"],
    [/\bceilings?\b/i, "the ceiling"],
  ],
  places: [],
  whyQuotesDie: [
    "They got three or more bids and never told the others no",
    "The number came in over what they'd budgeted, and nobody offered to do the worst of it first",
    "Exterior work got pushed to 'spring' and nobody picked it back up",
    "They wanted to talk it over with a spouse first",
    "Another painter offered a start date sooner",
  ],
  // make sure it landed, then the season, then a smaller first phase; never a price cut
  quoteAngles: ["check_in", "timing", "revise", "crew_nearby", "close_file"],
  crewLine: "We're finishing a job near you and have a gap in the schedule.",
  minQuote: 500,
  freeLook: true,
  intakeAsk: "Is it inside or outside, and when are you hoping to have it done?",
  intakeAskNamed: "When are you hoping to have it done?",
};

const roofing = simple(
  "roofing", "Roofing", "roofing company", [300, 12000, 40000], 0.3, { cold: [4, 5, 6, 7, 8, 9, 10], warm: [2, 3, 4, 5, 9, 10, 11] },
  [
    { id: "roof.replace", label: "Roof replacement", match: /\b(replace|re-?roof|tear ?off|new roof|shingle|metal|full roof)/i, phrase: "the roof replacement", season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL }, kind: "improvement", worseIfWaiting: "A roof at the end of its life lets water in a little at a time — the decking and ceiling pay for it." },
    { id: "roof.repair", label: "Roof repair", match: /\b(repair|leak|flashing|patch|storm|hail|wind|missing shingle|boot)/i, phrase: "the roof repair", season: { cold: ALL, warm: ALL }, kind: "repair", worseIfWaiting: "Small leaks become ceiling and insulation jobs." },
    { id: "roof.inspect", label: "Inspection", match: /\b(inspect|check|maint)/i, phrase: "the roof inspection", season: { cold: ALL, warm: ALL }, reserviceMonths: 12, kind: "maintenance" },
  ],
  [[/flat roof/i, "the flat roof"], [/metal/i, "the metal roof"], [/chimney/i, "the chimney flashing"], [/roof/i, "the roof"]],
  ["Insurance claim uncertainty", "Big number — waiting on money", "Three-bid shopping"],
  "We're working on a roof near you and could come take a look while we're there.", 500, true,
);

const irrigation = simple(
  "irrigation", "Irrigation", "irrigation company", [90, 600, 8000], 0.5, { cold: [4, 5, 10], warm: [3, 4, 5, 6] },
  [
    { id: "irr.startup", label: "Spring start-up", match: /\b(start ?up|spring|turn on|activation|de-?winter)/i, phrase: "the spring start-up", season: { cold: [3, 4, 5], warm: [2, 3] }, reserviceMonths: 12, kind: "maintenance" },
    { id: "irr.winterize", label: "Winterization / blow-out", match: /\b(winter|blow ?out|shut ?down|fall)/i, phrase: "the blow-out", season: { cold: [9, 10, 11], warm: [11, 12] }, reserviceMonths: 12, kind: "maintenance", worseIfWaiting: "One hard freeze with water in the lines can crack the backflow and the pipes." },
    { id: "irr.install", label: "New system", match: /\b(install|new system|zone|drip|add)/i, phrase: "the irrigation install", season: { cold: [4, 5, 6, 7, 8, 9], warm: ALL }, kind: "improvement" },
    { id: "irr.repair", label: "Repair", match: /\b(repair|leak|head|valve|controller|broken|backflow)/i, phrase: "the sprinkler repair", season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL }, kind: "repair" },
  ],
  [[/backflow/i, "the backflow"], [/controller|timer/i, "the controller"], [/(sprinkler|irrigation)/i, "the sprinklers"]],
  ["They forgot until the first freeze", "Install quotes wait for the next season"],
  "We're doing blow-outs on your street and can add you to the route.", 90,
);

const chimney = simple(
  "chimney", "Chimney", "chimney company", [150, 450, 8000], 0.5, { cold: [8, 9, 10, 11], warm: [9, 10, 11] },
  [
    { id: "chim.sweep", label: "Sweep & inspection", match: /\b(sweep|clean|inspect|level|cam)/i, phrase: "the chimney sweep", season: { cold: [5, 6, 7, 8, 9, 10, 11], warm: [8, 9, 10, 11] }, reserviceMonths: 12, kind: "maintenance", timingLine: { cold: "Fall is when everyone calls at once — getting in before the first fire is the move." }, timingMonths: { cold: [7, 8, 9, 10] } },
    { id: "chim.repair", label: "Repair", match: /\b(repair|crown|cap|liner|flashing|tuckpoint|rebuild|damper|leak|crack)/i, phrase: "the chimney repair", season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL }, kind: "repair", worseIfWaiting: "Water that gets past a cracked crown works into the masonry every freeze." },
  ],
  [[/liner/i, "the liner"], [/crown/i, "the crown"], [/cap/i, "the cap"], [/(chimney|fireplace|flue)/i, "the chimney"]],
  ["Put off until the fall rush and then booked out", "Repair quotes deferred"],
  "We've got a sweep crew nearby with an open slot.", 150,
);

// A one-time, deep or move clean is the easiest client to put on a schedule, so the ask goes out within about ten
// days of the job (owner research; BookingKoala's own "One-Time to Recurring" funnel is just a list to phone).
const TO_RECURRING = { serviceId: "clean.recurring", afterDays: [2, 10] as [number, number], why: "one-time and deep cleans are the easiest clients to put on a regular schedule", pitch: "If you'd like the house to stay that way, we can come back every week, every other week or once a month.", ask: "Want it on a regular schedule?" };
const cleaning: TradePlaybook = {
  ...simple(
    "cleaning", "House cleaning", "cleaning company", [120, 220, 900], 0.5, { cold: [1, 3, 4, 11, 12], warm: [1, 3, 4, 11, 12] },
    [
      { id: "clean.recurring", label: "Recurring cleaning", match: /\b(weekly|bi-?weekly|every other|monthly|recurring|regular|maint)/i, phrase: "the regular cleaning", season: { cold: ALL, warm: ALL }, reserviceMonths: 1, kind: "recurring" },
      { id: "clean.deep", label: "Deep clean", match: /\b(deep|spring clean|first clean|initial|top to bottom)/i, phrase: "the deep clean", season: { cold: [3, 4, 5, 11, 12], warm: [3, 4, 11, 12] }, reserviceMonths: 6, kind: "maintenance", followOns: [TO_RECURRING] },
      { id: "clean.move", label: "Move in / out", match: /\b(move|vacat|rental|turnover|airbnb)/i, phrase: "the move-out clean", season: { cold: ALL, warm: ALL }, kind: "improvement", followOns: [{ ...TO_RECURRING, pitch: "If you'd like a hand once you're settled in, we can come every week, every other week or once a month.", ask: "Want us on a regular schedule?" }] },
      { id: "clean.once", label: "One-time clean", match: /\b(one[- ]?time|one[- ]?off|single (visit|clean\w*)|just once)\b/i, phrase: "the cleaning", season: { cold: ALL, warm: ALL }, kind: "improvement", followOns: [TO_RECURRING] },
    ],
    [[/kitchen/i, "the kitchen"], [/(house|home)/i, "the house cleaning"]],
    ["Price compared to a solo cleaner", "They started 'next month' and never did", "Recurring clients drop quietly after a holiday", "Had to ask a spouse first, and nobody asked again"],
    "We have a team in your neighborhood with an opening this week.", 100,
  ),
  intakeAsk: "How many bedrooms and bathrooms, is it a one-time clean or regular, and any pets?",
  intakeKnown: /\b\d\s*(bed|bedroom|br|bd)s?\b[\s\S]*\b\d(\.\d)?\s*(bath|bathroom|ba)s?\b/i,
  // A weekly or every-other-week client three weeks out has missed a visit; a monthly one at about six weeks.
  // (ZenMaid only calls a client "Former" at six weeks; MaidCentral puts recurring churn near 7% a month.)
  lapseAfterDays: [[16, 21], [35, 45]],
};

const general = simple(
  "general", "Home services", "company", [200, 1500, 20000], 0.4, { cold: [4, 5, 6, 9, 10], warm: [3, 4, 5, 10, 11] },
  [{ id: "gen.work", label: "Service", match: /.*/, phrase: "the work we quoted", season: { cold: ALL, warm: ALL }, kind: "improvement" }],
  [],
  ["Timing wasn't right", "Price needed a second look", "They got busy and it slipped"],
  "We've got a crew in your area with an open day.", 200,
);

export const PLAYBOOKS: Record<TradeId, TradePlaybook> = {
  tree,
  lawn,
  landscape,
  septic,
  fence,
  concrete,
  pressure_washing: pressure,
  gutter,
  window_cleaning: windowCleaning,
  pool,
  pest,
  hvac,
  junk_removal: junk,
  painting,
  roofing,
  irrigation,
  chimney,
  cleaning,
  holiday_lighting: lighting,
  deck,
  general,
};

/**
 * The trades the two offers sell to. Trade detection, the console's menus and sign-up use only these; the other
 * playbooks stay for accounts that already have them.
 */
export const OFFERED_TRADES: TradeId[] = ["lawn", "landscape", "cleaning", "tree", "fence", "painting"];

export const TRADE_OPTIONS: { id: TradeId; label: string }[] = OFFERED_TRADES.map((t) => ({ id: t, label: PLAYBOOKS[t].label }));
