// Ready-made worlds to start from. Each changes some settings for that world
// only and may replace the founding species. "New world" goes back to normal.

import { RULES } from './params.js';

const byName = (list, name) => list.find((f) => f.name === name);

export const SCENARIOS = [
  {
    key: 'iceAge',
    name: 'Ice age',
    text: 'Ten degrees colder everywhere. Frostbacks are at home; the warm-weather species must adapt or crowd toward the equator.',
    params: { climateShift: -10 },
  },
  {
    key: 'hothouse',
    name: 'Hothouse',
    text: 'Nine degrees warmer and a fifth less plant growth. Thirst comes faster in the heat.',
    params: { climateShift: 9, foodGrowth: 21 },
  },
  {
    key: 'islands',
    name: 'Island chain',
    text: 'Three times the lakes, so land is broken into islands, and half the founders can swim.',
    lakes: RULES.lakeCount * 3,
    params: { swimmerShare: 0.5 },
  },
  {
    key: 'predators',
    name: 'Predator paradise',
    text: 'Four times the Nightstalkers, plus a second meat-eating species, the Duskfangs, from the cold north.',
    founders: (list) => [
      ...list.map((f) => (f.name === 'Nightstalkers' ? { ...f, startCount: 60 } : f)),
      { name: 'Duskfangs', color: '#C2453A', startCount: 40, speed: 1.8, vision: 36, strength: 2, preferredTemp: 8, diet: 0.8 },
    ],
  },
  {
    key: 'radiation',
    name: 'One species',
    text: 'Only Meadowfolk, 200 of them. Watch them spread out and split into new species to fill the world.',
    founders: (list) => [{ ...(byName(list, 'Meadowfolk') || list[0]), startCount: 200 }],
  },
  {
    key: 'crowded',
    name: 'Crowded world',
    text: 'Every founding species starts with 200 members and sickness spreads twice as easily between them.',
    founders: (list) => list.map((f) => ({ ...f, startCount: 200 })),
    params: { sicknessBoost: 2 },
  },
];

// Settings any scenario may change, put back to normal by an ordinary new world.
export const SCENARIO_PARAMS = ['climateShift', 'foodGrowth', 'sicknessBoost', 'scenario'];
