// Creating creatures: the starting population and mutated offspring.

import { RULES } from './params.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A first-generation creature with its species' founding traits.
export function spawnCreature(id, species, traits, x, y, random) {
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
  };
}

// A child born next to its parent, with each trait nudged at random.
// The parent's energy must already have been halved; the child gets the same.
// The child starts in its parent's species; the sim may then move it.
export function makeOffspring(id, parent, tick, mutationRate, tempMutationScale, random) {
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
    preferredTemp: mutate(parent.preferredTemp, tempMutationScale, limits.preferredTemp),
    diet: mutate(parent.diet, RULES.dietMutationScale, limits.diet),
  };
}
