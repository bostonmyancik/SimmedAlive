import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSim } from '../static/sim/sim.js';
import { RULES, SPECIES } from '../static/sim/params.js';
import { WIDTH, HEIGHT, cellIndex } from '../static/sim/world.js';

const snapshot = (sim) => JSON.stringify([sim.creatures, [...sim.food], sim.kills]);

function run(seed, ticks) {
  const sim = createSim({ seed });
  sim.generate();
  for (let i = 0; i < ticks; i++) sim.step(1, 0.4);
  return sim;
}

// An empty world with one lake-free strip of creatures placed by hand.
function emptyWorld() {
  const sim = createSim({ seed: 7 });
  sim.generate();
  sim.creatures = [];
  sim.food.clear();
  return sim;
}

// A dry-land spot, optionally far from or next to water.
function findCell(sim, wanted) {
  for (let y = 5; y < HEIGHT; y += 10) {
    for (let x = 5; x < WIDTH; x += 10) {
      const cell = cellIndex(x, y);
      if (!sim.water[cell] && wanted(sim.waterDistance[cell], sim.temperature[cell])) return { x, y };
    }
  }
  throw new Error('no suitable cell in this world');
}

function creature(overrides) {
  return {
    species: 1, x: 0, y: 0, heading: 0, energy: 60, hydration: 90, thirsty: false,
    age: 0, generation: 1, speed: 1.7, vision: 30, strength: 1.3, preferredTemp: 18,
    ...overrides,
  };
}

test('the same seed gives the same world and the same history', () => {
  assert.equal(snapshot(run(42, 400)), snapshot(run(42, 400)));
});

test('different seeds give different worlds', () => {
  assert.notEqual(snapshot(run(1, 0)), snapshot(run(2, 0)));
});

test('regenerating without a seed rebuilds the same world', () => {
  const sim = run(5, 200);
  sim.generate();
  assert.equal(snapshot(sim), snapshot(run(5, 0)));
});

test('a new world starts with every species and no food in water', () => {
  const sim = run(3, 0);
  for (const s of sim.stats()) assert.equal(s.count, RULES.startPerSpecies);
  for (const f of sim.food) assert.equal(sim.water[cellIndex(f.x, f.y)], 0);
  for (const c of sim.creatures) assert.equal(sim.water[cellIndex(c.x, c.y)], 0);
});

test('the ecosystem keeps going: creatures breed and all species survive', () => {
  const sim = run(42, 4000); // longer than one lifespan, so survivors were born in the sim
  for (const s of sim.stats()) {
    assert.ok(s.count > 0, 'a species died out');
    assert.ok(s.maxGeneration > 1, 'a species never bred');
  }
  for (const c of sim.creatures) {
    for (const key of ['x', 'y', 'energy', 'hydration', 'speed', 'vision', 'strength', 'preferredTemp']) {
      assert.ok(Number.isFinite(c[key]), key + ' is not a number');
    }
  }
});

test('population and natural food stay within their caps', () => {
  const sim = createSim({ seed: 9 });
  sim.generate();
  for (let i = 0; i < 1500; i++) {
    sim.step(2, 0.4);
    assert.ok(sim.creatures.length <= RULES.maxCreatures);
    assert.ok(sim.food.size <= RULES.maxFood);
  }
});

test('a creature eats food it reaches', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, (d) => d > 3);
  const c = creature({ ...spot, preferredTemp: sim.temperature[cellIndex(spot.x, spot.y)] });
  sim.creatures = [c];
  assert.ok(sim.addFood(spot.x + 2, spot.y));
  sim.step(0, 0);
  assert.equal([...sim.food].length, 0);
  assert.ok(c.energy > 60 + RULES.foodEnergy - 1);
});

test('food cannot be dropped in water', () => {
  const sim = emptyWorld();
  const i = sim.water.indexOf(1);
  assert.equal(sim.addFood((i % 68) * 10 + 5, Math.floor(i / 68) * 10 + 5), false);
  assert.equal(sim.food.size, 0);
});

test('a thirsty creature at the shore stands still and drinks', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, (d) => d === 1);
  const c = creature({ ...spot, hydration: 30 });
  sim.creatures = [c];
  sim.step(0, 0);
  assert.equal(c.thirsty, true);
  assert.deepEqual([c.x, c.y], [spot.x, spot.y]);
  assert.ok(c.hydration > 30);
});

test('a creature damages an enemy in reach and is credited with the kill', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, (d) => d > 3);
  const temp = sim.temperature[cellIndex(spot.x, spot.y)];
  const attacker = creature({ ...spot, species: 0, strength: 3, preferredTemp: temp });
  const victim = creature({ x: spot.x + 3, y: spot.y, species: 1, energy: 0.3, preferredTemp: temp });
  sim.creatures = [attacker, victim];
  sim.step(0, 0);
  assert.deepEqual(sim.kills, [1, 0, 0]);
  assert.deepEqual(sim.creatures, [attacker]);
});

test('creatures do not attack their own species', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, (d) => d > 3);
  const a = creature({ ...spot });
  const b = creature({ x: spot.x + 3, y: spot.y });
  sim.creatures = [a, b];
  sim.step(0, 0);
  assert.ok(a.energy > 59 && b.energy > 59);
});

test('a well-fed, comfortable creature splits and the child inherits its traits', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, (d) => d > 3);
  const parent = creature({ ...spot, energy: 150, preferredTemp: sim.temperature[cellIndex(spot.x, spot.y)] });
  sim.creatures = [parent];
  sim.step(0, 0); // mutation rate 0: an exact copy
  assert.equal(sim.creatures.length, 2);
  const child = sim.creatures[1];
  assert.equal(child.generation, 2);
  assert.equal(child.energy, parent.energy);
  assert.deepEqual(
    [child.speed, child.vision, child.strength, child.preferredTemp],
    [parent.speed, parent.vision, parent.strength, parent.preferredTemp],
  );
});

test('a creature outside its climate does not breed', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, (d) => d > 3);
  const temp = sim.temperature[cellIndex(spot.x, spot.y)];
  sim.creatures = [creature({ ...spot, energy: 150, preferredTemp: temp + 20 })];
  sim.step(0, 0);
  assert.equal(sim.creatures.length, 1);
});

test('creatures die of old age, starvation and thirst', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, (d) => d > 3);
  sim.creatures = [
    creature({ ...spot, age: RULES.maxAge - 1 }),
    creature({ ...spot, energy: 0.01 }),
    creature({ ...spot, hydration: 0.01 }),
  ];
  sim.step(0, 0);
  assert.equal(sim.creatures.length, 0);
});

test('parameter overrides apply without changing the defaults', () => {
  const sim = createSim({ seed: 1, params: { foodGrowth: 0 } });
  assert.equal(sim.params.foodGrowth, 0);
  assert.equal(createSim().params.foodGrowth, 5);
  assert.equal(sim.species, SPECIES);
});
