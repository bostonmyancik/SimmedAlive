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

  // Food
  foodGrowth: 26,          // multiplier on the food supply slider

  // Combat
  combatDamage: 0.2,       // damage per tick per point of strength
  awayDamageFactor: 0.25,  // damage multiplier when fighting outside your climate
  huntEnergy: 30,          // a half-meat-eater hunts below this energy; scales with diet
  dietDamageBonus: 3,      // extra damage for meat-eaters: times (1 + this * diet)
  fleeDistance: 25,        // distance at which a creature flees a much stronger one

  // Upkeep and breeding
  strengthUpkeep: 0.006,   // energy cost per tick of strength (times strength squared)
  stressCost: 0.05,        // energy cost per tick per degree of temperature stress
  maxBreedingStress: 0,    // most stress at which a creature can still reproduce
  tempMutationScale: 2,    // how fast preferred temperature mutates

  // Speciation
  speciationDistance: 1.6, // how far traits must drift from a species' founder to split off
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
  maxFood: 1800,               // natural growth stops here (dropped food can exceed it)
  maxCreatures: 1800,
  maxAge: 3000,

  startEnergy: 60,
  foodEnergy: 28,
  carcassEnergy: 100,           // meat in a dead creature (a pure meat-eater gets all of it)
  carcassLifetime: 600,        // ticks before a carcass rots away
  breedEnergy: 110,            // a creature above this splits in two
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

  // How readily food grows on each kind of land (water and mountains grow none).
  terrainFertility: { plain: 0.8, fertile: 1.6, desert: 0.15 },

  // Speciation. A trait difference of one "scale" counts as a distance of 1.
  traitScales: { speed: 1, vision: 25, strength: 1, preferredTemp: 8, diet: 0.35 },
  maxLivingSpecies: 12,        // no new species appear while this many are alive
  establishedAt: 10,           // members a new species needs before it is announced

  // Event log
  trendCheckEvery: 1500,       // ticks between boom and crash checks
  trendFactor: 2,              // population must double (or halve) between checks...
  trendMinChange: 40,          // ...and change by at least this many creatures
  maxEvents: 500,
};
