// Species records: how far a creature has drifted from its species, and the
// names and colours given to new species.

import { RULES } from './params.js';

export const TRAITS = ['speed', 'vision', 'strength', 'preferredTemp', 'diet'];

// How different two sets of traits are. 1 means "one scale apart" overall.
export function traitDistance(a, b) {
  let sum = 0;
  for (const trait of TRAITS) {
    const d = (a[trait] - b[trait]) / RULES.traitScales[trait];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function traitsOf(source) {
  const traits = {};
  for (const trait of TRAITS) traits[trait] = source[trait];
  return traits;
}

const CLIMATE_WORDS = [
  [4, ['Frost', 'Snow', 'Ice', 'Rime']],
  [12, ['Mist', 'Pine', 'Stone', 'Grey']],
  [23, ['Meadow', 'Moss', 'Reed', 'Fern']],
  [31, ['Sun', 'Dust', 'Amber', 'Gold']],
  [Infinity, ['Ember', 'Dune', 'Ash', 'Scorch']],
];

// Picks a name that hints at where the species lives and how it gets by.
export function nameSpecies(traits, random, taken) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const first = pick(CLIMATE_WORDS.find(([limit]) => traits.preferredTemp < limit)[1]);
  let seconds;
  if (traits.diet > 0.6) seconds = ['stalkers', 'fangs', 'hunters', 'claws'];
  else if (traits.diet > 0.3) seconds = ['prowlers', 'pickers', 'rovers'];
  else if (traits.strength > 2.2) seconds = ['backs', 'horns', 'hides'];
  else if (traits.speed > 2.2) seconds = ['runners', 'darters', 'chasers'];
  else if (traits.vision > 45) seconds = ['watchers', 'seekers'];
  else seconds = ['folk', 'grazers', 'browsers', 'walkers'];
  const base = first + pick(seconds);
  let name = base;
  for (let n = 2; taken.has(name); n++) name = base + ' ' + n;
  return name;
}

function hueOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  let hue;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  return (hue * 60 + 360) % 360;
}

function hslToHex(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(hue / 60) % 6];
  const hex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + hex(r) + hex(g) + hex(b);
}

// A colour (#rrggbb) for a new species, with the hue furthest from the
// colours already in use so that living species are easy to tell apart.
export function colorForSpecies(index, colorsInUse) {
  const used = colorsInUse.map(hueOf);
  let bestHue = 0, bestGap = -1;
  for (let hue = 0; hue < 360; hue += 12) {
    let gap = 360;
    for (const other of used) {
      const d = Math.abs(hue - other);
      gap = Math.min(gap, d > 180 ? 360 - d : d);
    }
    if (gap > bestGap) {
      bestGap = gap;
      bestHue = hue;
    }
  }
  // Alternate lighter and darker so close hues still differ.
  return hslToHex(bestHue, 0.6, index % 2 ? 0.64 : 0.5);
}
