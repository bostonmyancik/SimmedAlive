import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSim } from '../static/sim/sim.js';
import { makeSample } from '../static/ui/charts.js';
import { buildReport, speciesCsv, spread } from '../static/ui/report.js';

function runWorld(ticks = 600) {
  const sim = createSim({ seed: 7 });
  sim.generate();
  const history = [];
  for (let t = 0; t < ticks; t++) {
    sim.step(1, 0.4);
    if (sim.tick % 40 === 0) history.push(makeSample(sim.tick, sim.species, sim.stats()));
  }
  return { sim, history };
}

test('spread gives lowest, average, middle and highest', () => {
  assert.deepEqual(spread([4, 1, 3, 2]), { min: 1, mean: 2.5, median: 2.5, max: 4 });
  assert.equal(spread([]), null);
});

test('the report covers the world, every established species and every creature', () => {
  const { sim, history } = runWorld();
  const report = buildReport({ sim, history, settings: { foodRate: 1, mutationRate: 0.4 } });
  const established = sim.species.filter((sp) => sp.established);
  assert.equal(report.world.creatures, sim.creatures.length);
  assert.equal(report.living.length + report.extinct.length, established.length);
  assert.equal(report.living.reduce((n, sp) => n + sp.count, 0), sim.creatures.filter((c) => sim.species[c.species].established).length);
  assert.ok(Math.abs(Object.values(report.world.landCover).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(report.creatures.age.max, Math.max(...sim.creatures.map((c) => c.age)));
  assert.equal(report.events.length, sim.events.length);
  assert.equal(report.settings.foodRate, 1);
  for (const sp of report.living) assert.ok(sp.peak.count >= 1);
  // Plain data: it survives JSON unchanged.
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
});

test('building a report leaves the world untouched', () => {
  const { sim, history } = runWorld(200);
  const before = JSON.stringify(sim.save());
  buildReport({ sim, history });
  assert.equal(JSON.stringify(sim.save()), before);
});

test('the species CSV has a header and a line per species, with commas quoted', () => {
  const { sim, history } = runWorld(200);
  sim.species[0].name = 'Odd, "named"';
  const report = buildReport({ sim, history });
  const lines = speciesCsv(report).trim().split('\n');
  assert.equal(lines.length, 1 + report.living.length + report.extinct.length);
  assert.match(lines[0], /^name,status,count/);
  assert.ok(lines.some((line) => line.startsWith('"Odd, ""named"""')));
});
