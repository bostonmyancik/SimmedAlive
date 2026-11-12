// Special abilities. A creature has at most one. It appears by rare mutation,
// is passed on to offspring, and is sometimes lost. Which abilities a newborn
// can gain depends on how strong it is: weak creatures get ways to hide and
// escape, strong ones get weapons. Every ability also works better the
// stronger its owner is.

import { RULES } from './params.js';

export const ABILITIES = ['camouflage', 'dash', 'spit', 'freeze', 'pull'];

// The abilities a creature of this strength could gain.
export function abilitiesFor(strength) {
  return ABILITIES.filter((name) => {
    const [lo, hi] = RULES.abilities[name].strength;
    return strength >= lo && strength < hi;
  });
}

// Settles a newborn's ability: it keeps its parent's (unless it is lost), and
// one with none may, rarely, gain one suited to its strength. `chance` is the
// chance of gaining one. Returns true if the ability is new in this creature.
export function inheritAbility(child, parent, chance, random) {
  child.ability = parent.ability || null;
  if (child.ability) {
    if (random() < RULES.abilityLoss) child.ability = null;
    return false;
  }
  if (random() >= chance) return false;
  const options = abilitiesFor(child.strength);
  if (!options.length) return false;
  child.ability = options[Math.floor(random() * options.length)];
  return true;
}

// The numbers for one use of an ability by a creature of this strength.
export function abilityPower(name, strength) {
  const a = RULES.abilities[name];
  switch (name) {
    case 'camouflage': return { seenWithin: a.seenWithin };
    case 'dash': return { ticks: Math.round(a.ticks * strength), speed: a.speed };
    case 'spit': return { range: a.range[0] + a.range[1] * strength, damage: a.damage * strength };
    case 'freeze': return { radius: a.radius[0] + a.radius[1] * strength, ticks: Math.round(a.ticks[0] + a.ticks[1] * strength) };
    case 'pull': return { range: a.range[0] + a.range[1] * strength, hold: a.hold };
    default: return {};
  }
}

// What each ability is called on the page.
export const ABILITY_NAMES = {
  camouflage: 'Camouflage',
  dash: 'Dash',
  spit: 'Spit',
  freeze: 'Freeze',
  pull: 'Pull',
};

// One line on what each ability does, for the page.
export const ABILITY_HINTS = {
  camouflage: 'Enemies only notice it up close',
  dash: 'Bursts away from danger',
  spit: 'Spits at enemies from a distance',
  freeze: 'Freezes enemies around it in place',
  pull: 'Drags a weaker enemy in to finish it',
};
