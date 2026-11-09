// Creating creatures: the starting population and mutated offspring.

import { SPECIES, RULES } from './params.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A first-generation creature with its species' starting traits.
export function spawnCreature(species, x, y, random) {
  const base = SPECIES[species];
  return {
    species,
    x,
    y,
    heading: random() * 6.28,
    energy: RULES.startEnergy,
    hydration: 80 + random() * 20,
    thirsty: false,
    age: 0,
    generation: 1,
    speed: base.speed,
    vision: base.vision,
    strength: base.strength,
    preferredTemp: base.preferredTemp,
  };
}

// A child born next to its parent, with each trait nudged at random.
// The parent's energy must already have been halved; the child gets the same.
export function makeOffspring(parent, mutationRate, tempMutationScale, random) {
  const mutate = (value, scale, [lo, hi]) => clamp(value + (random() - 0.5) * mutationRate * scale, lo, hi);
  const limits = RULES.traitLimits;
  return {
    species: parent.species,
    x: parent.x,
    y: parent.y,
    heading: random() * 6.28,
    energy: parent.energy,
    hydration: parent.hydration,
    thirsty: false,
    age: 0,
    generation: parent.generation + 1,
    speed: mutate(parent.speed, 1, limits.speed),
    vision: mutate(parent.vision, RULES.visionMutationScale, limits.vision),
    strength: mutate(parent.strength, 1, limits.strength),
    preferredTemp: mutate(parent.preferredTemp, tempMutationScale, limits.preferredTemp),
  };
}
