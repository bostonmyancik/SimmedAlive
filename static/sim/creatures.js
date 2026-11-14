// Creating creatures: the starting population and mutated offspring.

import { RULES } from './params.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The energy a creature must have before it splits in two: less for small
// creatures, more for big ones.
export function breedEnergy(creature) {
  return RULES.breedEnergyBase + RULES.breedEnergyPerStrength * creature.strength;
}

// A first-generation creature with its species' founding traits.
export function spawnCreature(id, species, traits, x, y, swimmerShare, random) {
  return {
    id,
    parentId: null,
    species,
    x,
    y,
    heading: random() * 6.28,
    energy: RULES.startEnergy,
    hydration: 80 + random() * 20,
    thirsty: false,
    age: 0,
    bornTick: 0,
    generation: 1,
    offspring: 0,
    speed: traits.speed,
    vision: traits.vision,
    strength: traits.strength,
    preferredTemp: traits.preferredTemp,
    diet: traits.diet,
    swimmer: random() < swimmerShare,
    detour: 0,  // ticks left of holding course around an obstacle
    blocked: 0, // how many detours in a row it has needed
    slide: null, // the compass heading it is following round the obstacle, if any
    ability: null, // one of ABILITIES (see abilities.js), or null
    cooldown: 0,   // ticks before it can use its ability again
    frozen: 0,     // ticks left unable to move or fight (frozen, or held after a pull)
    dashing: 0,    // ticks left of a dash
    sick: 0,       // ticks left of being sick
    immune: 0,     // ticks left of being unable to catch sickness
    nightEyes: traits.diet > 0.5, // sees well at night, less well by day; hunting founders start with it
    lifespan: 0,   // ticks it will live unless something kills it first; the sim sets this
    breedWait: 0,  // ticks before it can have young
  };
}

// A child born next to its parent, with each trait nudged at random.
// The parent's energy must already have been halved; the child gets the same.
// The child starts in its parent's species; the sim may then move it.
export function makeOffspring(id, parent, tick, mutationRate, params, random) {
  const mutate = (value, scale, [lo, hi]) => clamp(value + (random() - 0.5) * mutationRate * scale, lo, hi);
  const limits = RULES.traitLimits;
  return {
    id,
    parentId: parent.id,
    species: parent.species,
    x: parent.x,
    y: parent.y,
    heading: random() * 6.28,
    energy: parent.energy,
    hydration: parent.hydration,
    thirsty: false,
    age: 0,
    bornTick: tick,
    generation: parent.generation + 1,
    offspring: 0,
    speed: mutate(parent.speed, 1, limits.speed),
    vision: mutate(parent.vision, RULES.visionMutationScale, limits.vision),
    strength: mutate(parent.strength, 1, limits.strength),
    preferredTemp: mutate(parent.preferredTemp, params.tempMutationScale, limits.preferredTemp),
    diet: mutate(parent.diet, RULES.dietMutationScale, limits.diet),
    // Swimming is inherited, though now and then a newborn differs from its parent.
    swimmer: random() < RULES.swimFlip ? !parent.swimmer : parent.swimmer,
    detour: 0,
    blocked: 0,
    slide: null,
    ability: null, // the sim decides whether it inherits its parent's
    cooldown: 0,
    frozen: 0,
    dashing: 0,
    sick: 0,
    immune: 0,
    nightEyes: random() < RULES.nightEyesFlip ? !parent.nightEyes : !!parent.nightEyes,
    lifespan: 0, // the sim sets this
    breedWait: params.matureAge,
  };
}
