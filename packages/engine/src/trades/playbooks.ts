import type { TradeId } from "../model.ts";
import type { TradePlaybook } from "./types.ts";

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const WORK_PHRASE: Partial<Record<TradeId, string>> = {"tree": "the tree work", "lawn": "the lawn work", "landscape": "the landscaping", "septic": "the septic work", "fence": "the fence", "concrete": "the concrete work", "pressure_washing": "the washing", "gutter": "the gutter work", "window_cleaning": "the window cleaning", "pool": "the pool work", "pest": "the pest treatment", "hvac": "the heating and cooling work", "junk_removal": "the clean-out", "painting": "the painting", "roofing": "the roof work", "irrigation": "the sprinkler work", "chimney": "the chimney work", "cleaning": "the cleaning", "general": "the work we quoted"};

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
      match: /\b(remov|take down|takedown|cut down|fell|drop|hazard|dead|leaning|crane)/i,
      phrase: "the tree removal",
      season: { cold: ALL, warm: ALL },
      kind: "hazard",
      followOns: [
        { serviceId: "tree.stump", afterDays: [3, 120], why: "stumps left behind after removals are the most common add-on" },
        { serviceId: "tree.plant", afterDays: [30, 365], why: "replacement planting after a removal" },
      ],
      worseIfWaiting: "A tree that needed to come down doesn't get easier to take down — it gets heavier, more brittle, and closer to the house.",
      timingLine: {
        cold: "Leaf-off months make removals quicker and cleaner, and the ground is firm for equipment.",
        warm: "Getting ahead of storm season is the cheapest time to deal with it.",
      },
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
      worseIfWaiting: "Limbs that are over the roof or wires only get longer and heavier each season.",
      timingLine: {
        cold: "Oaks can only be pruned safely in the dormant months, when oak wilt can't spread, so the winter schedule is the one to get on.",
        warm: "Oaks are safest to prune in the coldest part of winter, so that's the schedule to get on.",
      },
    },
    {
      id: "tree.ash",
      label: "Ash borer treatment",
      // Penn State Extension: applications in May or early June
      match: /\b(emerald ash|ash borer|eab)\b|\bash\b[^.·]{0,20}\b(treat|inject|protect)/i,
      phrase: "the ash treatment",
      season: { cold: [4, 5, 6], warm: [3, 4, 5] },
      reserviceMonths: 24,
      kind: "repair",
      strictSeason: true,
      worseIfWaiting: "Once borers get into an ash it usually dies within a few years, and a dead ash gets brittle and harder to take down safely.",
      timingLine: {
        cold: "Ash treatments only work when they go in around May or early June, so it's worth getting on the spring list now.",
        warm: "Ash treatments work best when they go in during spring, so it's worth getting on that list now.",
      },
    },
    {
      id: "tree.prune",
      label: "Pruning / trimming",
      match: /\b(prun|trim|thin|raise|reduc|crown|deadwood|clearance|lift|shape|cabling|brac)/i,
      phrase: "the pruning",
      season: { cold: [1, 2, 3, 4, 10, 11, 12], warm: [1, 2, 3, 11, 12] },
      reserviceMonths: 36,
      kind: "maintenance",
      worseIfWaiting: "Limbs that are over the roof or wires only get longer and heavier each season.",
      timingLine: {
        cold: "Dormant season (late fall through early spring) is the best time for most pruning.",
        warm: "Winter is the best window for most pruning before spring growth starts.",
      },
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
    [/(back ?yard|backyard|rear)/i, "out back"],
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
    },
    {
      id: "land.hardscape",
      label: "Hardscape (patio, walls, walkways)",
      match: /\b(patio|paver|retaining|wall|walkway|walk|firepit|fire pit|steps|stone|flagstone|hardscape|outdoor kitchen)/i,
      phrase: "the patio project",
      season: { cold: [4, 5, 6, 7, 8, 9, 10, 11], warm: ALL },
      kind: "improvement",
      followOns: [{ serviceId: "land.lighting", afterDays: [14, 365], why: "lighting finishes a new patio" }],
      timingLine: {
        cold: "Hardscape crews book out months ahead for spring — getting on the list now is how it gets built before summer.",
        warm: "Cooler months are the best time to build before the heat.",
      },
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
        { serviceId: "septic.riser", afterDays: [0, 365], why: "risers make every future pump-out faster and cheaper" },
        { serviceId: "septic.filter", afterDays: [0, 365], why: "an effluent filter protects the drain field" },
      ],
      worseIfWaiting: "Solids that build past the baffle go out to the drain field — and a drain field is the part that costs thousands.",
      timingLine: {
        cold: "Best to get it done before the ground freezes and the lid gets hard to reach.",
        warm: "Heavy rain season is hard on a full tank — better to pump it before then.",
      },
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
        { serviceId: "fence.stain", afterDays: [60, 540], why: "new wood fences should be sealed within the first year" },
        { serviceId: "fence.gate", afterDays: [0, 365], why: "gate hardware and self-closers after install" },
      ],
      timingLine: {
        cold: "Spring is the busiest fence season — the install calendar fills months out.",
        warm: "Getting on the calendar now beats the spring rush.",
      },
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
    [/back ?yard|rear/i, "out back"],
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
      followOns: [{ serviceId: "conc.seal", afterDays: [30, 365], why: "new concrete should be sealed after it cures" }],
      timingLine: {
        cold: "Pour season ends when nights drop near freezing — the last slots go fast.",
        warm: "Cooler months are the best time to pour before the summer heat.",
      },
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
        { serviceId: "pw.gutter", afterDays: [0, 365], why: "gutter brightening and clean-out pair with a house wash" },
        { serviceId: "pw.window", afterDays: [0, 60], why: "clean windows after a wash" },
      ],
      timingLine: { cold: "Spring is when the green and black streaks show up worst.", warm: "Getting ahead of pollen and mildew season." },
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
    [/roof/i, "the roof"],
    [/driveway/i, "the driveway"],
    [/deck/i, "the deck"],
    [/fence/i, "the fence"],
    [/patio/i, "the patio"],
    [/(house|siding|home)/i, "the house"],
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
  };
}

const gutter = simple(
  "gutter", "Gutter service", "gutter company", [120, 350, 6000], 0.5, { cold: [4, 5, 10, 11], warm: [3, 10, 11, 12] },
  [
    { id: "gutter.clean", label: "Gutter cleaning", match: /\b(clean|clear|flush|debris|leaves)/i, phrase: "the gutter cleaning", season: { cold: [4, 5, 10, 11, 12], warm: [3, 4, 10, 11, 12] }, reserviceMonths: 6, kind: "maintenance", worseIfWaiting: "Overflowing gutters dump water right at the foundation.", followOns: [{ serviceId: "gutter.guard", afterDays: [0, 365], why: "guards end the twice-a-year cleaning" }] },
    { id: "gutter.guard", label: "Gutter guards", match: /\b(guard|screen|cover|leaf ?filter|mesh)/i, phrase: "the gutter guards", season: { cold: ALL, warm: ALL }, kind: "improvement" },
    { id: "gutter.install", label: "New gutters", match: /\b(install|new|seamless|replace|downspout)/i, phrase: "the new gutters", season: { cold: [4, 5, 6, 7, 8, 9, 10, 11], warm: ALL }, kind: "improvement" },
    { id: "gutter.repair", label: "Gutter repair", match: /\b(repair|leak|sag|reattach|pitch)/i, phrase: "the gutter repair", season: { cold: ALL, warm: ALL }, kind: "repair" },
  ],
  [[/gutter/i, "the gutters"], [/downspout/i, "the downspouts"]],
  ["Easy to forget until the next storm", "Guard quotes feel expensive next to a cleaning", "Nobody reminds them in the fall"],
  "We're doing gutters on a few houses near you and can add one more.", 100,
);

const windowCleaning = simple(
  "window_cleaning", "Window cleaning", "window cleaning company", [150, 400, 2000], 0.5, { cold: [4, 5, 9, 10], warm: [3, 4, 10, 11] },
  [
    { id: "win.clean", label: "Window cleaning", match: /\b(window|glass|screen|track|interior|exterior)/i, phrase: "the window cleaning", season: { cold: [3, 4, 5, 6, 9, 10, 11], warm: ALL }, reserviceMonths: 6, kind: "maintenance" },
  ],
  [[/window/i, "the windows"]],
  ["Nice-to-have that slides", "They meant to book before the holidays", "Nobody asked again the next season"],
  "We're working on your street next week and have room for one more house.", 100,
);

const pool = simple(
  "pool", "Pool service", "pool company", [150, 1200, 15000], 0.45, { cold: [4, 5, 9], warm: [2, 3, 4, 5] },
  [
    { id: "pool.open", label: "Pool opening", match: /\b(open|start ?up|de-?winteriz|spring)/i, phrase: "the pool opening", season: { cold: [3, 4, 5], warm: [2, 3] }, reserviceMonths: 12, kind: "maintenance", timingLine: { cold: "Opening slots fill up by May.", warm: "Opening slots fill up early." } },
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
  "We've got a truck in your area with room on it.", 150,
);

const painting = simple(
  "painting", "Painting", "painting company", [400, 4500, 25000], 0.35, { cold: [4, 5, 6, 7, 8, 9], warm: [2, 3, 4, 10, 11] },
  [
    { id: "paint.exterior", label: "Exterior painting", match: /\b(exterior|siding|trim|house paint|outside|shutters|door)/i, phrase: "the exterior painting", season: { cold: [5, 6, 7, 8, 9], warm: [1, 2, 3, 4, 10, 11, 12] }, reserviceMonths: 84, kind: "improvement" },
    { id: "paint.interior", label: "Interior painting", match: /\b(interior|room|walls|ceiling|cabinet|kitchen|bath|inside)/i, phrase: "the interior painting", season: { cold: [1, 2, 3, 11, 12], warm: [6, 7, 8] }, kind: "improvement", timingLine: { cold: "Winter is the best time to get interior work scheduled quickly." } },
    { id: "paint.deck", label: "Deck & fence staining", match: /\b(deck|fence|stain)/i, phrase: "the staining", season: { cold: [5, 6, 7, 8, 9], warm: [3, 4, 5, 10, 11] }, reserviceMonths: 30, kind: "maintenance" },
  ],
  [[/cabinet/i, "the cabinets"], [/deck/i, "the deck"], [/trim/i, "the trim"], [/(exterior|house|siding)/i, "the house"]],
  ["Large ticket — they wanted to wait", "Color decisions stalled", "They meant to do it before selling"],
  "We're finishing a job near you and have a gap in the schedule.", 500,
);

const roofing = simple(
  "roofing", "Roofing", "roofing company", [300, 12000, 40000], 0.3, { cold: [4, 5, 6, 7, 8, 9, 10], warm: [2, 3, 4, 5, 9, 10, 11] },
  [
    { id: "roof.replace", label: "Roof replacement", match: /\b(replace|re-?roof|tear ?off|new roof|shingle|metal|full roof)/i, phrase: "the roof replacement", season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL }, kind: "improvement", worseIfWaiting: "A roof at the end of its life lets water in a little at a time — the decking and ceiling pay for it." },
    { id: "roof.repair", label: "Roof repair", match: /\b(repair|leak|flashing|patch|storm|hail|wind|missing shingle|boot)/i, phrase: "the roof repair", season: { cold: ALL, warm: ALL }, kind: "repair", worseIfWaiting: "Small leaks become ceiling and insulation jobs." },
    { id: "roof.inspect", label: "Inspection", match: /\b(inspect|check|maint)/i, phrase: "the roof inspection", season: { cold: ALL, warm: ALL }, reserviceMonths: 12, kind: "maintenance" },
  ],
  [[/flat roof/i, "the flat roof"], [/metal/i, "the metal roof"], [/chimney/i, "the chimney flashing"], [/roof/i, "the roof"]],
  ["Insurance claim uncertainty", "Big number — waiting on money", "Three-bid shopping"],
  "We're working on a roof near you and could come take a look while we're there.", 500,
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
    { id: "chim.sweep", label: "Sweep & inspection", match: /\b(sweep|clean|inspect|level|cam)/i, phrase: "the chimney sweep", season: { cold: [5, 6, 7, 8, 9, 10, 11], warm: [8, 9, 10, 11] }, reserviceMonths: 12, kind: "maintenance", timingLine: { cold: "Fall is when everyone calls at once — getting in before the first fire is the move." } },
    { id: "chim.repair", label: "Repair", match: /\b(repair|crown|cap|liner|flashing|tuckpoint|rebuild|damper|leak|crack)/i, phrase: "the chimney repair", season: { cold: [4, 5, 6, 7, 8, 9, 10], warm: ALL }, kind: "repair", worseIfWaiting: "Water that gets past a cracked crown works into the masonry every freeze." },
  ],
  [[/liner/i, "the liner"], [/crown/i, "the crown"], [/cap/i, "the cap"], [/(chimney|fireplace|flue)/i, "the chimney"]],
  ["Put off until the fall rush and then booked out", "Repair quotes deferred"],
  "We've got a sweep crew nearby with an open slot.", 150,
);

const cleaning = simple(
  "cleaning", "House cleaning", "cleaning company", [120, 220, 900], 0.5, { cold: [1, 3, 4, 11, 12], warm: [1, 3, 4, 11, 12] },
  [
    { id: "clean.recurring", label: "Recurring cleaning", match: /\b(weekly|bi-?weekly|every other|monthly|recurring|regular|maint)/i, phrase: "the regular cleaning", season: { cold: ALL, warm: ALL }, reserviceMonths: 1, kind: "recurring" },
    { id: "clean.deep", label: "Deep clean", match: /\b(deep|spring clean|first clean|initial|top to bottom)/i, phrase: "the deep clean", season: { cold: [3, 4, 5, 11, 12], warm: [3, 4, 11, 12] }, reserviceMonths: 6, kind: "maintenance" },
    { id: "clean.move", label: "Move in / out", match: /\b(move|vacat|rental|turnover|airbnb)/i, phrase: "the move-out clean", season: { cold: ALL, warm: ALL }, kind: "improvement" },
  ],
  [[/kitchen/i, "the kitchen"], [/(house|home)/i, "the house"]],
  ["Price compared to a solo cleaner", "They started 'next month' and never did", "Recurring clients drop quietly after a holiday"],
  "We have a team in your neighborhood with an opening this week.", 100,
);

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
  general,
};

export const TRADE_OPTIONS: { id: TradeId; label: string }[] = (Object.values(PLAYBOOKS) as TradePlaybook[])
  .filter((p) => p.id !== "general")
  .map((p) => ({ id: p.id, label: p.label }));
