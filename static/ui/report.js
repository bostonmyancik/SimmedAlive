// The full report (templates/report.html): everything known about a world,
// gathered into plain data that can be shown, printed or downloaded.
// buildReport() reads a sim and the chart history; it changes neither.

import { DEFAULT_PARAMS, RULES } from '../sim/params.js';
import { TRAITS } from '../sim/species.js';
import { ABILITY_NAMES } from '../sim/abilities.js';
import { SCENARIOS } from '../sim/scenarios.js';
import { PLAIN, FERTILE, DESERT, MOUNTAIN, seasonAt } from '../sim/world.js';

// Per-creature numbers summarised across the living population.
const CREATURE_NUMBERS = [
  ['speed', 'Speed'], ['vision', 'Vision'], ['strength', 'Strength'], ['preferredTemp', 'Preferred temperature (°C)'],
  ['diet', 'Share of meat in diet'], ['energy', 'Energy'], ['hydration', 'Water'], ['age', 'Age (ticks)'],
  ['generation', 'Generation'], ['offspring', 'Young'],
];

// Lowest, average, middle and highest of a list of numbers, or null if empty.
export function spread(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return {
    min: sorted[0],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    max: sorted[sorted.length - 1],
  };
}

// Highest head count of each species in the history: { id: { count, tick } }.
function peaksIn(history) {
  const peaks = {};
  for (const sample of history) {
    for (const id in sample.counts) {
      if (!peaks[id] || sample.counts[id] > peaks[id].count) peaks[id] = { count: sample.counts[id], tick: sample.tick };
    }
  }
  return peaks;
}

// The share of the map covered by each kind of ground.
function landCover(sim) {
  const cells = sim.terrain.length;
  const tally = { water: 0, plain: 0, fertile: 0, desert: 0, mountain: 0 };
  for (let i = 0; i < cells; i++) {
    if (sim.water[i]) tally.water++;
    else if (sim.terrain[i] === FERTILE) tally.fertile++;
    else if (sim.terrain[i] === DESERT) tally.desert++;
    else if (sim.terrain[i] === MOUNTAIN) tally.mountain++;
    else if (sim.terrain[i] === PLAIN) tally.plain++;
  }
  for (const key in tally) tally[key] /= cells;
  return tally;
}

// Everything in one object.
//   sim:        the running simulation
//   history:    the chart samples ({ tick, counts, traits }), oldest first
//   latestTick: the newest tick the run has reached (later than sim.tick while viewing the past)
//   settings:   the slider values that are not part of sim.params, e.g. { foodRate, mutationRate }
export function buildReport({ sim, history = [], latestTick = sim.tick, settings = {} }) {
  const stats = sim.stats();
  const peaks = peaksIn(history);
  const established = sim.species.filter((sp) => sp.established);
  const total = sim.creatures.length;
  const { year, season } = seasonAt(sim.tick);
  const scenario = sim.params.scenario ? SCENARIOS.find((s) => s.key === sim.params.scenario) : null;

  // The nearest ancestor that took hold, so the family tree never points at a
  // species the report leaves out.
  const shownIds = new Set(established.map((sp) => sp.id));
  const treeParent = (sp) => {
    let p = sp.parent;
    while (p !== null && !shownIds.has(p)) p = sim.species[p].parent;
    return p;
  };

  const describe = (sp) => {
    const st = stats[sp.id];
    const alive = sp.count > 0;
    const peak = peaks[sp.id] || null;
    return {
      id: sp.id,
      name: sp.name,
      color: sp.color,
      alive,
      count: sp.count,
      share: total ? sp.count / total : 0,
      parent: sp.parent === null ? null : sim.species[sp.parent].name,
      treeParent: treeParent(sp),
      lineage: sim.lineage(sp.id).map((id) => sim.species[id].name),
      bornTick: sp.bornTick,
      extinctTick: alive ? null : sp.extinctTick,
      lasted: (alive ? sim.tick : sp.extinctTick) - sp.bornTick,
      stage: sp.stage || 1,
      kills: sp.kills || 0,
      peak: peak && { count: peak.count, tick: peak.tick },
      // Living species: the average of their members now. Extinct ones: the
      // species' typical traits when it was last seen.
      traits: Object.fromEntries(TRAITS.map((t) => [t, alive ? st[t] : sp.origin[t]])),
      swimmers: alive ? st.swimmers : null,
      nightEyes: alive ? st.nightEyes : null,
      sick: alive ? st.sick : null,
      maxGeneration: alive ? st.maxGeneration : null,
      abilities: alive
        ? Object.entries(st.abilities).sort((a, b) => b[1] - a[1]).map(([key, share]) => ({ name: ABILITY_NAMES[key] || key, share }))
        : (sp.abilities || []).map((key) => ({ name: ABILITY_NAMES[key] || key, share: null })),
      children: established.filter((other) => other.parent === sp.id).map((other) => other.name),
    };
  };

  const living = established.filter((sp) => sp.count > 0).sort((a, b) => b.count - a.count).map(describe);
  const extinct = established.filter((sp) => sp.count === 0).sort((a, b) => b.extinctTick - a.extinctTick).map(describe);

  const creatures = Object.fromEntries(CREATURE_NUMBERS.map(([key, label]) => [key, { label, ...spread(sim.creatures.map((c) => c[key])) }]));
  const abilityHolders = {};
  for (const c of sim.creatures) if (c.ability) abilityHolders[c.ability] = (abilityHolders[c.ability] || 0) + 1;

  const eventCounts = {};
  for (const e of sim.events) eventCounts[e.kind] = (eventCounts[e.kind] || 0) + 1;

  const changedSettings = Object.keys(DEFAULT_PARAMS)
    .filter((key) => key !== 'scenario' && JSON.stringify(sim.params[key]) !== JSON.stringify(DEFAULT_PARAMS[key]))
    .map((key) => ({ key, value: sim.params[key], usual: DEFAULT_PARAMS[key] }));

  // The population over the charted window, thinned to at most 40 rows.
  const step = Math.max(1, Math.ceil(history.length / 40));
  const timeline = history.filter((_, i) => i % step === 0 || i === history.length - 1).map((sample) => {
    const counts = Object.values(sample.counts);
    return { tick: sample.tick, creatures: counts.reduce((a, b) => a + b, 0), species: counts.length };
  });

  return {
    madeAt: new Date().toISOString(),
    world: {
      seed: sim.seed,
      tick: sim.tick,
      latestTick,
      year,
      season,
      scenario: scenario ? scenario.name : sim.params.scenario,
      creatures: total,
      creatureCap: RULES.maxCreatures,
      livingSpecies: living.length,
      speciesEver: established.length,
      extinctSpecies: extinct.length,
      births: sim.records.births,
      deaths: sim.records.deaths,
      plants: sim.food.size ?? [...sim.food].length,
      carcasses: sim.carcasses.size ?? [...sim.carcasses].length,
      swimmers: sim.creatures.filter((c) => c.swimmer).length,
      sick: sim.creatures.filter((c) => c.sick > 0).length,
      drought: sim.tick < sim.droughtUntil,
      landCover: landCover(sim),
    },
    records: JSON.parse(JSON.stringify(sim.records)),
    living,
    extinct,
    creatures,
    abilityHolders: Object.entries(abilityHolders).sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ name: ABILITY_NAMES[key] || key, count, share: total ? count / total : 0 })),
    timeline,
    historyFrom: history.length ? history[0].tick : null,
    events: sim.events.map((e) => ({ tick: e.tick, kind: e.kind, species: e.species === null ? null : sim.species[e.species]?.name ?? null, text: e.text })),
    eventCounts,
    settings: { ...settings, changed: changedSettings, all: { ...sim.params } },
  };
}

// One CSV line per species, living and extinct, for a spreadsheet.
export function speciesCsv(report) {
  const head = ['name', 'status', 'count', 'share', 'split_from', 'born_tick', 'extinct_tick', 'lasted_ticks', 'stage', 'kills',
    'peak_count', 'peak_tick', ...TRAITS, 'swimmers', 'night_eyes', 'sick', 'max_generation', 'abilities'];
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const text = typeof v === 'number' ? String(+v.toFixed(4)) : String(v);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const rows = [...report.living, ...report.extinct].map((sp) => [
    sp.name, sp.alive ? 'alive' : 'extinct', sp.count, sp.share, sp.parent, sp.bornTick, sp.extinctTick, sp.lasted, sp.stage, sp.kills,
    sp.peak?.count, sp.peak?.tick, ...TRAITS.map((t) => sp.traits[t]), sp.swimmers, sp.nightEyes, sp.sick, sp.maxGeneration,
    sp.abilities.map((a) => a.name + (a.share === null ? '' : ' ' + Math.round(a.share * 100) + '%')).join('; '),
  ]);
  return [head, ...rows].map((row) => row.map(cell).join(',')).join('\n') + '\n';
}
