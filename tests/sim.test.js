import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSim } from '../static/sim/sim.js';
import { RULES, SPECIES } from '../static/sim/params.js';
import { WIDTH, HEIGHT, GRID_W, CELL, MOUNTAIN, FERTILE, DESERT, cellIndex, seasonAt } from '../static/sim/world.js';

const snapshot = (sim) => JSON.stringify([sim.creatures, [...sim.food], sim.species, Array.from(sim.terrain)]);

function run(seed, ticks) {
  const sim = createSim({ seed });
  sim.generate();
  for (let i = 0; i < ticks; i++) sim.step(1, 0.4);
  return sim;
}

// A world with no creatures or food, for placing creatures by hand.
function emptyWorld() {
  const sim = createSim({ seed: 7 });
  sim.generate();
  sim.creatures = [];
  sim.food.clear();
  return sim;
}

// A walkable spot chosen by its distance to water and its temperature.
function findCell(sim, wanted) {
  for (let y = 5; y < HEIGHT; y += 10) {
    for (let x = 5; x < WIDTH; x += 10) {
      const cell = cellIndex(x, y);
      if (!sim.blocked[cell] && wanted(sim.waterDistance[cell], sim.temperature[cell])) return { x, y };
    }
  }
  throw new Error('no suitable cell in this world');
}

// Inland, and mild enough that a Meadowfolk-like creature is at home.
const inlandMild = (d, temp) => d > 3 && d < 1e8 && Math.abs(temp - 18) < 3;

let nextId = 1000;

// A plant-eating Meadowfolk (species 1) unless overridden.
function creature(overrides) {
  return {
    id: nextId++, parentId: null, species: 1, x: 0, y: 0, heading: 0, energy: 60, hydration: 90,
    thirsty: false, age: 0, bornTick: 0, generation: 1, offspring: 0,
    speed: 1.7, vision: 30, strength: 1.3, preferredTemp: 18, diet: 0,
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

test('a new world starts with every founding species on walkable land', () => {
  const sim = run(3, 0);
  assert.equal(sim.species.length, SPECIES.length);
  sim.species.forEach((sp, i) => assert.equal(sp.count, SPECIES[i].startCount ?? RULES.startPerSpecies));
  for (const f of sim.food) assert.equal(sim.blocked[cellIndex(f.x, f.y)], 0);
  for (const c of sim.creatures) assert.equal(sim.blocked[cellIndex(c.x, c.y)], 0);
});

test('the world has every kind of terrain, and water and mountains are blocked', () => {
  const sim = run(42, 0);
  for (const kind of [MOUNTAIN, FERTILE, DESERT]) assert.ok(sim.terrain.includes(kind));
  sim.blocked.forEach((b, i) => assert.equal(b, sim.water[i] || sim.terrain[i] === MOUNTAIN ? 1 : 0));
  assert.equal(sim.fertility(sim.terrain.indexOf(MOUNTAIN)), 0);
});

test('the ecosystem keeps going: creatures breed and stay on walkable land', () => {
  const sim = createSim({ seed: 42 });
  sim.generate();
  for (let i = 0; i < 4000; i++) { // longer than one lifespan, so survivors were born in the sim
    sim.step(1, 0.4);
    if (i % 100 === 0) for (const c of sim.creatures) assert.equal(sim.blocked[cellIndex(c.x, c.y)], 0);
  }
  assert.ok(sim.creatures.length > 100, 'the population collapsed');
  assert.ok(sim.species.slice(0, SPECIES.length).filter((sp) => sp.count > 0).length >= 2, 'founders died out');
  for (const c of sim.creatures) {
    assert.ok(c.generation > 1);
    for (const key of ['x', 'y', 'energy', 'hydration', 'speed', 'vision', 'strength', 'preferredTemp', 'diet']) {
      assert.ok(Number.isFinite(c[key]), key + ' is not a number');
    }
  }
  assert.equal(sim.species.reduce((sum, sp) => sum + sp.count, 0), sim.creatures.length);
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

test('a plant-eater eats a plant it reaches', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  const c = creature({ ...spot });
  sim.creatures = [c];
  assert.ok(sim.addFood(spot.x + 2, spot.y));
  sim.step(0, 0);
  assert.equal(sim.food.size, 0);
  assert.ok(c.energy > 60 + RULES.foodEnergy - 1);
});

test('a meat-eater gets nothing from plants and leaves them alone', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  const c = creature({ ...spot, diet: 1 });
  sim.creatures = [c];
  sim.addFood(spot.x + 2, spot.y);
  sim.step(0, 0);
  assert.equal(sim.food.size, 1);
  assert.ok(c.energy < 60);
});

test('food cannot be dropped in water or on mountains', () => {
  const sim = emptyWorld();
  for (const i of [sim.water.indexOf(1), sim.terrain.indexOf(MOUNTAIN)]) {
    assert.equal(sim.addFood((i % GRID_W) * CELL + 5, Math.floor(i / GRID_W) * CELL + 5), false);
  }
  assert.equal(sim.food.size, 0);
});

// Leaves one carcass at `spot` by letting a creature starve there.
function leaveCarcass(sim, spot) {
  sim.creatures = [creature({ ...spot, energy: 0.01 })];
  sim.step(0, 0);
  assert.equal(sim.carcasses.size, 1);
}

test('the dead leave a carcass that a meat-eater eats and a plant-eater ignores', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  leaveCarcass(sim, spot);

  const grazer = creature({ x: spot.x + 2, y: spot.y, diet: 0 });
  sim.creatures = [grazer];
  sim.step(0, 0);
  assert.equal(sim.carcasses.size, 1);

  const hunter = creature({ x: spot.x + 2, y: spot.y, diet: 1, energy: 5 });
  sim.creatures = [hunter];
  sim.step(0, 0);
  assert.equal(sim.carcasses.size, 0);
  assert.ok(hunter.energy > 5 + RULES.carcassEnergy - 1);
});

test('an uneaten carcass rots away', () => {
  const sim = emptyWorld();
  leaveCarcass(sim, findCell(sim, inlandMild));
  for (let i = 0; i <= RULES.carcassLifetime + 1; i++) sim.step(0, 0);
  assert.equal(sim.carcasses.size, 0);
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
  const spot = findCell(sim, inlandMild);
  const temp = sim.temperature[cellIndex(spot.x, spot.y)];
  const attacker = creature({ ...spot, species: 0, strength: 3, preferredTemp: temp });
  const victim = creature({ x: spot.x + 3, y: spot.y, species: 1, energy: 0.3, preferredTemp: temp });
  sim.creatures = [attacker, victim];
  sim.step(0, 0);
  assert.deepEqual(sim.species.map((sp) => sp.kills), [1, 0, 0, 0]);
  assert.deepEqual(sim.creatures, [attacker]);
  assert.equal(sim.carcasses.size, 1);
});

test('meat-eaters bite harder', () => {
  const damage = (diet) => {
    const sim = emptyWorld();
    const spot = findCell(sim, inlandMild);
    const victim = creature({ x: spot.x + 3, y: spot.y, species: 1, speed: 0.3 });
    sim.creatures = [creature({ ...spot, species: 0, diet }), victim];
    sim.step(0, 0);
    return 60 - victim.energy;
  };
  assert.ok(damage(1) > damage(0) * 2);
});

test('creatures do not attack their own species', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  const a = creature({ ...spot });
  const b = creature({ x: spot.x + 3, y: spot.y });
  sim.creatures = [a, b];
  sim.step(0, 0);
  assert.ok(a.energy > 59 && b.energy > 59);
});

test('a well-fed, comfortable creature splits and the child inherits its traits', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  const parent = creature({ ...spot, energy: 150, preferredTemp: sim.temperature[cellIndex(spot.x, spot.y)] });
  sim.creatures = [parent];
  sim.step(0, 0); // mutation rate 0: an exact copy
  assert.equal(sim.creatures.length, 2);
  const child = sim.creatures[1];
  assert.equal(child.generation, 2);
  assert.equal(child.parentId, parent.id);
  assert.equal(child.species, parent.species);
  assert.equal(parent.offspring, 1);
  assert.equal(child.energy, parent.energy);
  assert.deepEqual(
    [child.speed, child.vision, child.strength, child.preferredTemp, child.diet],
    [parent.speed, parent.vision, parent.strength, parent.preferredTemp, parent.diet],
  );
});

// Two well-fed Meadowfolk whose traits have drifted far from the species' founder.
function driftedParents(sim) {
  const spot = findCell(sim, inlandMild);
  const temp = sim.temperature[cellIndex(spot.x, spot.y)];
  const drifted = { energy: 150, preferredTemp: temp, speed: 4, strength: 3.5 };
  return [creature({ ...spot, ...drifted }), creature({ x: spot.x + 60, y: spot.y, ...drifted })];
}

test('offspring that drift far from their species found a new one, and siblings join it', () => {
  const sim = emptyWorld();
  sim.creatures = driftedParents(sim);
  sim.step(0, 0);
  assert.equal(sim.species.length, SPECIES.length + 1);
  const fresh = sim.species[SPECIES.length];
  assert.equal(fresh.parent, 1);
  assert.equal(fresh.count, 2);
  assert.equal(fresh.established, false);
  assert.match(fresh.color, /^#[0-9a-f]{6}$/);
  assert.ok(fresh.name.length > 3 && !SPECIES.some((sp) => sp.name === fresh.name));
  assert.deepEqual(sim.creatures.map((c) => c.species), [1, 1, fresh.id, fresh.id]);
  assert.deepEqual(sim.lineage(fresh.id), [1, fresh.id]);
});

test('a species and the one it split from do not fight, but other species do', () => {
  const sim = emptyWorld();
  sim.creatures = driftedParents(sim);
  sim.step(0, 0);
  const fresh = SPECIES.length;
  assert.equal(sim.isHostile(1, fresh), false);
  assert.equal(sim.isHostile(fresh, 1), false);
  assert.equal(sim.isHostile(0, fresh), true);
  assert.equal(sim.isHostile(1, 1), false);
});

test('the event log records a new species taking hold and species dying out', () => {
  const sim = emptyWorld();
  sim.creatures = driftedParents(sim);
  sim.step(0, 0);
  const fresh = sim.species[SPECIES.length];
  assert.ok(!sim.events.some((e) => e.kind === 'species'), 'announced before it took hold');

  const member = sim.creatures.find((c) => c.species === fresh.id);
  sim.creatures = Array.from({ length: RULES.establishedAt }, () => ({ ...member, id: nextId++, energy: 60 }));
  sim.step(0, 0);
  assert.equal(fresh.established, true);
  const born = sim.events.find((e) => e.kind === 'species');
  assert.equal(born.species, fresh.id);
  assert.equal(born.text, fresh.name + ' split from Meadowfolk');

  sim.creatures = [];
  sim.step(0, 0);
  const died = sim.events.filter((e) => e.kind === 'extinct').map((e) => e.species);
  assert.ok(died.includes(fresh.id));
  assert.equal(fresh.extinctTick, sim.tick);
});

test('booms and crashes are logged at the periodic check', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  const herd = (n) => Array.from({ length: n }, () => creature({ ...spot, energy: 60, hydration: 90 }));
  sim.species[1].lastTrendCount = 100;
  sim.creatures = herd(260);
  sim.tick = RULES.trendCheckEvery - 1;
  sim.step(0, 0);
  assert.ok(sim.events.some((e) => e.kind === 'boom' && e.species === 1));
  sim.creatures = herd(50);
  sim.tick = RULES.trendCheckEvery * 2 - 1;
  sim.step(0, 0);
  assert.ok(sim.events.some((e) => e.kind === 'crash' && e.species === 1));
});

test('heat waves and cold snaps change the temperature and are logged', () => {
  const sim = emptyWorld();
  sim.heatWave();
  assert.equal(sim.temperatureBoost, 9);
  sim.coldSnap();
  assert.equal(sim.temperatureBoost, -9);
  assert.deepEqual(sim.events.map((e) => e.kind), ['heat', 'cold']);
});

test('a creature outside its climate does not breed', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  const temp = sim.temperature[cellIndex(spot.x, spot.y)];
  sim.creatures = [creature({ ...spot, energy: 150, preferredTemp: temp + 20 })];
  sim.step(0, 0);
  assert.equal(sim.creatures.length, 1);
});

test('creatures die of old age, starvation and thirst', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
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
  assert.equal(createSim().params.foodGrowth, 26);
});

test('the year starts in spring and peaks in summer', () => {
  assert.deepEqual(seasonAt(0), { year: 1, season: 'Spring' });
  assert.equal(seasonAt(Math.round(RULES.seasonLength * Math.PI / 2)).season, 'Summer');
  assert.equal(seasonAt(Math.round(RULES.seasonLength * Math.PI)).season, 'Autumn');
  assert.equal(seasonAt(Math.round(RULES.seasonLength * Math.PI * 1.5)).season, 'Winter');
  assert.equal(seasonAt(Math.round(RULES.seasonLength * Math.PI * 2) + 10).year, 2);
});
