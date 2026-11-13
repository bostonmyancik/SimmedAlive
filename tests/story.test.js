import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSim } from '../static/sim/sim.js';
import { makeSample } from '../static/ui/charts.js';
import { buildReport } from '../static/ui/report.js';
import { storyText } from '../static/ui/story.js';

function report(ticks = 3000, seed = 7) {
  const sim = createSim({ seed });
  sim.generate();
  const history = [];
  for (let t = 0; t < ticks; t++) {
    sim.step(1, 0.4);
    if (sim.tick % 40 === 0) history.push(makeSample(sim.tick, sim.species, sim.stats()));
  }
  return { sim, report: buildReport({ sim, history }) };
}

test('the story text asks for a story and names every species that took hold', () => {
  const { report: r } = report();
  const text = storyText(r);
  assert.match(text, /^# The world of seed 7/);
  assert.match(text, /Please write a story/);
  for (const sp of [...r.living, ...r.extinct]) assert.ok(text.includes(sp.name), sp.name + ' is missing');
  assert.match(text, /## What happened, in order/);
  assert.ok(!/undefined|NaN/.test(text), 'no undefined or NaN in the text');
});

test('the chronicle is in time order and covers every new species', () => {
  const { report: r } = report();
  const text = storyText(r);
  const chronicle = text.split('## What happened, in order')[1].split('\n## ')[0];
  const ticks = [...chronicle.matchAll(/\(tick ([\d,]+)\)/g)].map((m) => +m[1].replace(/,/g, ''));
  assert.deepEqual(ticks, [...ticks].sort((a, b) => a - b));
  for (const sp of [...r.living, ...r.extinct].filter((s) => s.parent)) assert.ok(chronicle.includes(sp.name + ' split from'), sp.name);
});

test('a world with no one left still makes sense', () => {
  const { sim } = report(10);
  sim.creatures = [];
  for (const sp of sim.species) if (sp.count) { sp.count = 0; sp.extinctTick = sim.tick; }
  const text = storyText(buildReport({ sim, history: [] }));
  assert.match(text, /no creatures are left alive/);
  assert.match(text, /None\. Every species has died out\./);
  assert.ok(!/undefined|NaN/.test(text));
});

test('a long history stays a manageable size', () => {
  const { sim, report: r } = report(200);
  // Hundreds of short-lived species and a full event log.
  const founder = r.living[0];
  for (let i = 0; i < 400; i++) {
    r.extinct.push({ ...founder, id: 1000 + i, name: 'Lost ' + i, alive: false, count: 0, share: 0, parent: founder.name,
      lineage: [founder.name, 'Lost ' + i], bornTick: i * 10, extinctTick: i * 10 + 50, lasted: 50, kills: 0, peak: null, stage: 1, abilities: [], children: [] });
  }
  r.events = Array.from({ length: 500 }, (_, i) => ({ tick: i * 5, kind: i % 2 ? 'boom' : 'drought', species: null, text: 'Event ' + i }));
  const text = storyText(r);
  assert.ok(text.length < 120000, 'text is ' + text.length + ' characters');
  assert.ok(text.includes('Short-lived species, briefly'));
  assert.ok(sim.tick > 0);
});
