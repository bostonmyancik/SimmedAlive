// Every tuning value for the simulation lives in this file.

// Starting traits for each species.
export const SPECIES = [
  { name: 'Frostbacks', color: '#7F77DD', speed: 1.5, vision: 34, strength: 1.7, preferredTemp: 6 },
  { name: 'Meadowfolk', color: '#D4537E', speed: 1.7, vision: 30, strength: 1.3, preferredTemp: 18 },
  { name: 'Sunchasers', color: '#BA7517', speed: 2.0, vision: 24, strength: 1.9, preferredTemp: 30 },
];

// Balance settings. Pass overrides to createSim({ params: { ... } }).
export const DEFAULT_PARAMS = {
  // Climate
  tempTolerance: 6,        // degrees from preferred temperature before stress starts
  tempGradient: 13,        // north-south spread, plus or minus this around BASE_TEMP
  seasonSwing: 3,          // size of the seasonal swing in degrees
  frontStrength: 8,        // peak degrees added (or removed) by a weather front

  // Food
  foodGrowth: 20,          // multiplier on the food supply slider

  // Combat
  combatDamage: 0.2,       // damage per tick per point of strength
  awayDamageFactor: 0.25,  // damage multiplier when fighting outside your climate
  huntEnergy: 60,          // below this energy a creature hunts weaker species
  fleeDistance: 25,        // distance at which a creature flees a much stronger one

  // Upkeep and breeding
  strengthUpkeep: 0.006,   // energy cost per tick of strength (times strength squared)
  stressCost: 0.05,        // energy cost per tick per degree of temperature stress
  maxBreedingStress: 0,    // most stress at which a creature can still reproduce
  tempMutationScale: 2,    // how fast preferred temperature mutates
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
  killEnergy: 25,
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
  },
  visionMutationScale: 25,
};
