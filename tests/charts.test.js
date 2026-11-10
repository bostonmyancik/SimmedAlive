import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSim } from '../static/sim/sim.js';
import { makeSample, compactHistory, speciesInHistory, familyTreeSpecies, METRICS, WINDOW_TICKS } from '../static/ui/charts.js';

// A world with far more dead species on its books than living ones.
function crowdedBooks() {
  const sim = createSim({ seed: 3 });
  sim.generate();
  const founder = sim.species[0];
  for (let id = sim.species.length; id < 2000; id++) {
    sim.species.push({ ...founder, id, name: 'Lost ' + id, parent: 0, count: 0, established: true, bornTick: 10, extinctTick: 20 });
  }
  return sim;
}

test('a chart sample lists only living species, however many have existed', () => {
  const sim = crowdedBooks();
  const sample = makeSample(sim.tick, sim.species, sim.stats());
  const living = sim.species.filter((sp) => sp.count > 0);
  assert.deepEqual(Object.keys(sample.counts).map(Number), living.map((sp) => sp.id));
  assert.deepEqual(Object.keys(sample.traits), Object.keys(sample.counts));
  assert.ok(JSON.stringify(sample).length < 2000, 'sample is ' + JSON.stringify(sample).length + ' characters');
});

test('the metrics read a sample: values for the living, nothing for the rest', () => {
  const sim = crowdedBooks();
  const sample = makeSample(sim.tick, sim.species, sim.stats());
  assert.equal(METRICS.count.valueOf(sample, 0), sim.species[0].count);
  assert.equal(METRICS.speed.valueOf(sample, 0), sim.stats()[0].speed);
  assert.equal(METRICS.count.valueOf(sample, 1500), null);
  assert.equal(METRICS.diet.valueOf(sample, 1500), null);
});

test('history from older saves is converted, keeping its numbers', () => {
  const traits = (speed) => ({ speed, vision: 30, strength: 1, preferredTemp: 18, diet: 0, swimmers: 0, maxGeneration: 1 });
  const old = [{ tick: 40, counts: [12, 0, 7], traits: [traits(1.5), traits(0), traits(2)] }];
  const [sample] = compactHistory(old);
  assert.deepEqual(sample.counts, { 0: 12, 2: 7 });
  assert.equal(sample.traits[2].speed, 2);
  assert.equal(METRICS.count.valueOf(sample, 1), null);
  // Already in the new form: left alone.
  assert.deepEqual(compactHistory([sample]), [sample]);
});

test('charts loop over the species in the history, not every species ever', () => {
  const sim = crowdedBooks();
  const history = [makeSample(0, sim.species, sim.stats())];
  const charted = speciesInHistory(history, sim.species);
  assert.deepEqual(charted.map((sp) => sp.id), sim.species.filter((sp) => sp.count > 0).map((sp) => sp.id));
});

test('the family tree keeps the living and the recently lost', () => {
  const sim = crowdedBooks();
  const tick = WINDOW_TICKS * 3;
  sim.species[1500].extinctTick = tick - 100; // lost recently
  const tree = familyTreeSpecies(sim.species, tick);
  const living = sim.species.filter((sp) => sp.count > 0).length;
  assert.equal(tree.length, living + 1);
  assert.ok(tree.includes(sim.species[1500]));
});
