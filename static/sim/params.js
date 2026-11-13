// Every tuning value for the simulation lives in this file.

// The founding species and their starting traits. New species branch off these
// as lineages drift. `diet` runs from 0 (eats only plants) to 1 (eats only meat).
// `startCount` overrides RULES.startPerSpecies.
export const SPECIES = [
  { name: 'Frostbacks', color: '#7F77DD', speed: 1.5, vision: 34, strength: 1.7, preferredTemp: 6, diet: 0.15 },
  { name: 'Meadowfolk', color: '#D4537E', speed: 1.7, vision: 30, strength: 1.3, preferredTemp: 18, diet: 0.05 },
  { name: 'Sunchasers', color: '#BA7517', speed: 2.0, vision: 24, strength: 1.9, preferredTemp: 30, diet: 0.3 },
  { name: 'Nightstalkers', color: '#3FA796', speed: 2.1, vision: 40, strength: 2.2, preferredTemp: 18, diet: 0.85, startCount: 15 },
];

// Balance settings. Pass overrides to createSim({ params: { ... } }).
export const DEFAULT_PARAMS = {
  // Climate
  tempTolerance: 6,        // degrees from preferred temperature before stress starts
  tempGradient: 13,        // north-south spread, plus or minus this around BASE_TEMP
  seasonSwing: 3,          // size of the seasonal swing in degrees
  frontStrength: 8,        // peak degrees added (or removed) by a weather front
  climateShift: 0,         // degrees added everywhere, for colder or hotter worlds
  scenario: null,          // key of the scenario the world was started from (see scenarios.js), if any

  // Food
  foodGrowth: 26,          // multiplier on the food supply slider

  // Combat
  combatDamage: 0.2,       // damage per tick per point of strength
  awayDamageFactor: 0.25,  // damage multiplier when fighting outside your climate
  huntEnergy: 100,         // a half-meat-eater hunts below this energy; scales with diet
  dietDamageBonus: 3,      // extra damage for meat-eaters: times (1 + this * diet)
  dietSpecialization: 1.2, // above 1, in-between diets get less from both plants and meat
  fleeDistance: 25,        // distance at which a creature flees a much stronger one

  // Upkeep and breeding
  strengthUpkeep: 0.006,   // energy cost per tick of strength (times strength squared)
  sizeSlowdown: 0.25,      // share of top speed lost per point of strength above 1, so strength 3 moves at 2/3 of its speed
  stressCost: 0.05,        // energy cost per tick per degree of temperature stress
  maxBreedingStress: 0,    // most stress at which a creature can still reproduce
  tempMutationScale: 2,    // how fast preferred temperature mutates

  // Swimming
  swimmerLandPace: 0.9,    // a swimmer's speed on land, as a share of a non-swimmer's
  swimmerShare: 0.2,       // share of the founding creatures that can swim; their young inherit it

  // Random disasters
  autoDisasters: false,    // let disasters strike on their own now and then
  autoDisasterEvery: 15000, // average ticks between them (a year is about 18,850)

  // Speciation
  speciationDistance: 1.6, // how far traits must drift from a species' founder to split off

  // Evolution. Every so often a whole species shifts toward what its members
  // have become, so a lineage can change over time without splitting.
  evolveEvery: 2000,       // ticks between these shifts
  evolveRate: 0.15,        // share of the gap between the species and its members closed each time
  evolveStep: 0.7,         // how far (in trait distance) a species must change to reach a new stage

  // Living world
  plantSeeding: 0.25,       // share of new plants that sprout beside an existing one
  disease: true,           // let sickness break out and spread between creatures of a species
  sicknessBoost: 1,        // multiplier on how easily sickness passes between creatures
  herding: 0.15,           // how strongly an idle creature drifts toward others of its species (0 to 1)
  migration: true,         // creatures well out of their climate set off toward a better one
  dayNight: true,          // days and nights: sight is short at night except for night eyes

  // Abilities
  abilities: true,         // let creatures gain special abilities
  abilityChance: 0.001,    // chance a newborn gains one; times its species' stage
};

// Fixed rules of the world. These are not exposed as tuning knobs yet.
export const RULES = {
  baseTemp: 18,
  seasonLength: 3000,          // ticks per radian of the seasonal sine wave
  boostDecay: 0.9994,          // per-tick fade of a heat wave or cold snap
  frontRadiusSq: 14000,        // spread of a weather front (pixels squared)
  lakeCount: 24,

  startPerSpecies: 100,
  startFood: 600,
  maxFoodNearby: 10,           // plants stop sprouting where this many already crowd one patch of ground
  maxFood: 1800,               // natural growth stops here (dropped food can exceed it)
  maxCreatures: 1800,
  maxFounders: 8,              // most founding species a world can start with
  maxStartCount: 200,          // most members a founding species can start with
  maxAge: 3000,

  startEnergy: 60,
  foodEnergy: 28,
  carcassEnergy: 100,           // meat in a dead creature (a pure meat-eater gets all of it)
  carcassLifetime: 600,        // ticks before a carcass rots away
  // A creature splits in two once its energy is above
  // breedEnergyBase + breedEnergyPerStrength x strength, so small creatures
  // breed sooner and big ones need more. Strength 1.3 splits at 109, 3 at 160.
  breedEnergyBase: 70,
  breedEnergyPerStrength: 30,
  attackRangeSq: 49,
  minEatRangeSq: 36,

  thirstyBelow: 40,
  quenchedAt: 95,
  drinkRate: 2.5,
  thirstRate: 0.04,
  hotAbove: 24,                // thirst grows faster above this temperature

  fleeStrengthRatio: 1.25,     // flee enemies at least this many times stronger
  huntStrengthRatio: 0.85,     // hunt enemies at most this many times as strong

  // Allowed range for each evolving trait.
  traitLimits: {
    speed: [0.3, 5],
    vision: [5, 120],
    strength: [0.2, 5],
    preferredTemp: [-8, 42],
    diet: [0, 1],
  },
  visionMutationScale: 25,
  dietMutationScale: 0.15,

  // How readily food grows on each kind of land (mountains grow none).
  terrainFertility: { plain: 0.8, fertile: 1.6, desert: 0.15 },
  waterFertility: 0.25,        // water plants, which only swimmers can reach

  // Swimming. Swimmers cross water; everyone else has to go around.
  swimSpeedFactor: 0.6,        // speed in water, as a share of speed on land
  swimCost: 0.05,              // extra energy per tick spent in water
  swimFlip: 0.02,              // chance a newborn can swim when its parent cannot, or the reverse
  swimSpreadAt: 0.4,           // share of swimmers before a species counts as swimming...
  swimFadeAt: 0.1,             // ...and the share below which it no longer does

  // Getting around obstacles. A blocked creature slides along the obstacle and
  // then keeps to that course for a while instead of turning straight back.
  detourTicks: 10,             // shortest detour; each repeat block in a row adds this much again
  maxDetourRepeats: 3,
  detourForgetTicks: 80,       // ticks for one repeat to be forgotten

  // Speciation. A trait difference of one "scale" counts as a distance of 1.
  traitScales: { speed: 1, vision: 25, strength: 1, preferredTemp: 8, diet: 0.35 },
  maxLivingSpecies: 12,        // no new species appear while this many are alive
  establishedAt: 10,           // members a new species needs before it is announced

  // Abilities. `strength` is the range of strength a newborn must be in to gain
  // one; the other numbers grow with the owner's strength as shown.
  abilityLoss: 0.003,          // chance a newborn does not inherit its parent's ability
  abilityUpkeep: 0.004,        // energy per tick that having any ability costs
  abilitySpreadAt: 0.4,        // share of a species with an ability before it counts as theirs...
  abilityFadeAt: 0.1,          // ...and the share below which it is lost again
  abilities: {
    camouflage: { strength: [0, 1.6], seenWithin: 12 },                 // enemies notice it only this close
    dash: { strength: [0, 2.2], ticks: 10, speed: 2.2, cooldown: 250, cost: 2 }, // ticks times strength
    spit: { strength: [1.3, 9], range: [30, 12], damage: 5, stun: 8, cooldown: 80, cost: 1.5, speedPx: 5 }, // range + 12 x strength; a hit holds the target `stun` ticks
    freeze: { strength: [1.9, 9], radius: [10, 6], ticks: [10, 10], cooldown: 400, cost: 4 },
    pull: { strength: [2.4, 9], range: [20, 10], hold: 4, cooldown: 500, cost: 3 }, // only a weaker enemy
  },
  abilityReviewEvery: 500,     // ticks between checks on which abilities each species has
  effectTicks: 12,             // how long the flash of an ability stays on the map

  // Day and night. Most creatures see half as far at midnight; a creature
  // with night eyes sees fully at night but less far by day.
  dayLength: 1200,             // ticks from one noon to the next
  nightSight: 0.5,             // sight at midnight without night eyes, as a share of full sight
  nightEyesDaySight: 0.5,      // sight at noon with night eyes, so on average neither kind sees further
  nightEyesFlip: 0.005,        // chance a newborn differs from its parent in having night eyes

  // Plants spreading
  seedRange: 16,               // how far from its parent plant a seedling sprouts, in pixels

  // Sickness. It breaks out now and then and passes between creatures of a
  // species that come close, so crowded species suffer most.
  sickness: {
    outbreakChance: 0.000002,  // chance per tick that a healthy creature falls sick by itself
    spreadChance: 0.02,        // chance per tick of passing it to each healthy member nearby
    contactRange: 10,          // pixels
    length: 400,               // ticks a creature stays sick
    cost: 0.15,                // extra energy per tick while sick
    immunity: 4000,            // ticks a creature cannot catch it again after recovering
    noticeAt: 15,              // sick members before the log notes an outbreak
  },
  sicknessReviewEvery: 100,    // ticks between checks for outbreaks starting or passing

  // Herding: an idle creature drifts toward the nearest member of its species
  // it can see, unless it is already this close.
  herdSpacing: 12,
  herdWhenFed: 0.6,            // ...and only once its energy is this share of what it needs to split

  // Migration: a creature this many degrees beyond what it tolerates looks
  // further afield for a better climate and goes there before feeding.
  migrateAbove: 3,
  migrateProbe: 90,            // pixels north and south it looks

  // World tools and disasters
  tempOffsetLimit: 20,         // most a brush can warm or cool a spot, in degrees
  tempOffsetDecay: 0.995,      // brushed temperature fades by this every 10 ticks
  droughtLength: 2500,         // ticks a drought lasts
  droughtFoodFactor: 0.3,      // plant growth during a drought
  droughtThirstFactor: 1.5,    // thirst during a drought
  plagueDeathRate: 0.6,        // share of the largest species a plague kills
  meteorRadius: 90,            // everything within this many pixels dies
  meteorHeat: 15,              // degrees of local warming at the impact

  // How likely each random disaster is, relative to the others.
  autoDisasterWeights: { heat: 5, cold: 5, drought: 4, plague: 3, meteor: 3 },

  // Event log
  trendCheckEvery: 1500,       // ticks between boom and crash checks
  trendFactor: 2,              // population must double (or halve) between checks...
  trendMinChange: 40,          // ...and change by at least this many creatures
  maxEvents: 500,
  maxBiography: 200,           // most entries kept in a watched creature's life story
};
