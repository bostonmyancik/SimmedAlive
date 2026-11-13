import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSim } from '../static/sim/sim.js';
import { inheritAbility, abilitiesFor, abilityPower } from '../static/sim/abilities.js';
import { breedEnergy } from '../static/sim/creatures.js';
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
    speed: 1.7, vision: 30, strength: 1.3, preferredTemp: 18, diet: 0, swimmer: false, detour: 0, blocked: 0, slide: null,
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
  for (const f of sim.food) {
    assert.notEqual(sim.terrain[cellIndex(f.x, f.y)], MOUNTAIN);
    assert.equal(f.wet, sim.water[cellIndex(f.x, f.y)] === 1);
  }
  for (const c of sim.creatures) assert.equal(sim.blocked[cellIndex(c.x, c.y)], 0);
  const swimmers = sim.creatures.filter((c) => c.swimmer).length / sim.creatures.length;
  assert.ok(swimmers > 0.1 && swimmers < 0.3, 'about a fifth should be able to swim');
});

test('the world has every kind of terrain, and water and mountains are blocked', () => {
  const sim = run(42, 0);
  for (const kind of [MOUNTAIN, FERTILE, DESERT]) assert.ok(sim.terrain.includes(kind));
  sim.blocked.forEach((b, i) => assert.equal(b, sim.water[i] || sim.terrain[i] === MOUNTAIN ? 1 : 0));
  assert.equal(sim.fertility(sim.terrain.indexOf(MOUNTAIN)), 0);
});

test('the ecosystem keeps going: creatures breed, stay off mountains, and only swimmers enter water', () => {
  const sim = createSim({ seed: 42 });
  sim.generate();
  for (let i = 0; i < 4000; i++) { // longer than one lifespan, so survivors were born in the sim
    sim.step(1, 0.4);
    if (i % 100 !== 0) continue;
    for (const c of sim.creatures) {
      const cell = cellIndex(c.x, c.y);
      assert.notEqual(sim.terrain[cell], MOUNTAIN);
      // A non-swimmer can only be in water if it was born there, moments ago.
      if (sim.water[cell] && !c.swimmer) assert.ok(c.age < 400, 'a non-swimmer is living in the water');
    }
  }
  assert.ok(sim.creatures.some((c) => c.swimmer) && sim.creatures.some((c) => !c.swimmer));
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

test('food can be dropped in water but not on mountains', () => {
  const sim = emptyWorld();
  const spotOf = (i) => [(i % GRID_W) * CELL + 5, Math.floor(i / GRID_W) * CELL + 5];
  assert.equal(sim.addFood(...spotOf(sim.terrain.indexOf(MOUNTAIN))), false);
  assert.equal(sim.addFood(...spotOf(sim.water.indexOf(1))), true);
  assert.deepEqual([...sim.food].map((f) => f.wet), [true]);
});

// A lake cell with open water to its east, and the dry cell on its west shore.
function findShore(sim) {
  for (let i = 1; i < sim.water.length - 3; i++) {
    const row = Math.floor(i / GRID_W);
    if (!sim.blocked[i - 1] && sim.water[i] && sim.water[i + 1] && sim.water[i + 2] && Math.floor((i + 2) / GRID_W) === row
        && Math.floor((i - 1) / GRID_W) === row) {
      return { land: { x: ((i - 1) % GRID_W) * CELL + 5, y: row * CELL + 5 }, water: { x: (i % GRID_W) * CELL + 15, y: row * CELL + 5 } };
    }
  }
  throw new Error('no shore in this world');
}

test('only a swimmer goes into the water for food', () => {
  const attempt = (swimmer) => {
    const sim = emptyWorld();
    const shore = findShore(sim);
    const c = creature({ ...shore.land, swimmer, vision: 40, preferredTemp: sim.temperature[cellIndex(shore.land.x, shore.land.y)] });
    sim.creatures = [c];
    sim.addFood(shore.water.x, shore.water.y);
    let wasInWater = false;
    for (let i = 0; i < 40 && sim.food.size; i++) {
      sim.step(0, 0);
      wasInWater = wasInWater || sim.water[cellIndex(c.x, c.y)] === 1;
    }
    return { ate: sim.food.size === 0, wasInWater };
  };
  assert.deepEqual(attempt(true), { ate: true, wasInWater: true });
  assert.deepEqual(attempt(false), { ate: false, wasInWater: false });
});

test('swimming is slower than walking and costs energy', () => {
  const sim = emptyWorld();
  const shore = findShore(sim);
  const temp = sim.temperature[cellIndex(shore.water.x, shore.water.y)];
  const inWater = creature({ ...shore.water, swimmer: true, heading: 0, preferredTemp: temp, hydration: 96 });
  const onLand = creature({ ...findCell(sim, inlandMild), heading: 0, hydration: 96 });
  onLand.preferredTemp = sim.temperature[cellIndex(onLand.x, onLand.y)];
  sim.creatures = [inWater, onLand];
  const startX = [inWater.x, onLand.x];
  sim.step(0, 0);
  const moved = [Math.abs(inWater.x - startX[0]), Math.abs(onLand.x - startX[1])];
  assert.ok(moved[0] > 0 && moved[0] < moved[1] * 0.75, 'moved ' + moved);
  assert.ok(inWater.energy < onLand.energy);
});

test('a non-swimmer that ends up in the water can walk out', () => {
  const sim = emptyWorld();
  const shore = findShore(sim);
  const c = creature({ ...shore.water, swimmer: false, heading: Math.PI, hydration: 96 });
  sim.creatures = [c];
  for (let i = 0; i < 30; i++) sim.step(0, 0);
  assert.equal(sim.water[cellIndex(c.x, c.y)], 0);
});

test('newborns can swim according to the swimmer share, whatever their parent does', () => {
  for (const share of [0, 1]) {
    const sim = createSim({ seed: 7, params: { swimmerShare: share } });
    sim.generate();
    assert.ok(sim.creatures.every((c) => c.swimmer === (share === 1)));
    sim.food.clear();
    const spot = findCell(sim, inlandMild);
    sim.creatures = [creature({ ...spot, swimmer: share === 0, energy: 150, preferredTemp: sim.temperature[cellIndex(spot.x, spot.y)] })];
    sim.step(0, 0);
    assert.equal(sim.creatures[1].swimmer, share === 1);
  }
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

test('a heavier body moves more slowly', () => {
  const stepLength = (strength) => {
    const sim = emptyWorld();
    const spot = findCell(sim, inlandMild);
    const c = creature({ ...spot, strength, speed: 2 });
    sim.creatures = [c];
    sim.step(0, 0);
    const dx = Math.abs(c.x - spot.x);
    return Math.hypot(Math.min(dx, WIDTH - dx), c.y - spot.y);
  };
  assert.ok(Math.abs(stepLength(1) - 2) < 1e-9, 'strength 1 moves at full speed');
  assert.ok(Math.abs(stepLength(0.5) - 2) < 1e-9, 'being weaker than 1 does not speed it up');
  assert.ok(Math.abs(stepLength(3) - 2 / (1 + 2 * 0.25)) < 1e-9, 'strength 3 moves at 2/3 of its speed');
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
  const drifted = { energy: 200, preferredTemp: temp, speed: 4, strength: 3.5 }; // big, so they need more to split
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

// ---------- World tools, disasters and saving ----------

test('painting water blocks the spot, and painting land opens it again', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  const cell = cellIndex(spot.x, spot.y);
  sim.addFood(spot.x, spot.y);

  sim.paintTerrain(spot.x, spot.y, 25, 'water');
  assert.equal(sim.water[cell], 1);
  assert.equal(sim.blocked[cell], 1);
  assert.equal(sim.waterDistance[cell], 0);
  assert.deepEqual([...sim.food].map((f) => f.wet), [true], 'the plant is now in water');

  sim.paintTerrain(spot.x, spot.y, 25, 'fertile');
  assert.equal(sim.water[cell], 0);
  assert.equal(sim.terrain[cell], FERTILE);
  assert.equal(sim.blocked[cell], 0);
  assert.ok(sim.waterDistance[cell] > 0);
  assert.deepEqual([...sim.food].map((f) => f.wet), [false]);

  sim.paintTerrain(spot.x, spot.y, 25, 'mountain');
  assert.equal(sim.blocked[cell], 1);
  assert.equal(sim.food.size, 0, 'plants under the new mountain should go');
  assert.throws(() => sim.paintTerrain(spot.x, spot.y, 25, 'lava'));
});

test('painting works across the east-west seam', () => {
  const sim = emptyWorld();
  sim.paintTerrain(2, HEIGHT / 2, 30, 'desert');
  assert.equal(sim.terrain[cellIndex(5, HEIGHT / 2)], DESERT);
  assert.equal(sim.terrain[cellIndex(WIDTH - 5, HEIGHT / 2)], DESERT);
});

test('the temperature brush warms a spot, leaves distant land alone, and fades', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  const cell = cellIndex(spot.x, spot.y);
  const far = cellIndex((spot.x + WIDTH / 2) % WIDTH, spot.y);
  const before = sim.temperature[cell], farBefore = sim.temperature[far];

  sim.paintTemperature(spot.x, spot.y, 60, 10);
  assert.ok(sim.temperature[cell] > before + 8);
  assert.equal(sim.temperature[far], farBefore);
  for (let i = 0; i < 40; i++) sim.paintTemperature(spot.x, spot.y, 60, 10);
  assert.ok(sim.tempOffset[cell] <= RULES.tempOffsetLimit);

  const painted = sim.tempOffset[cell];
  for (let i = 0; i < 3000; i++) sim.step(0, 0);
  assert.ok(sim.tempOffset[cell] < painted / 3);
});

test('a drought slows plant growth, then ends', () => {
  const grown = (withDrought) => {
    const sim = emptyWorld();
    if (withDrought) sim.drought();
    for (let i = 0; i < 300; i++) sim.step(1, 0);
    return sim.food.size;
  };
  assert.ok(grown(true) < grown(false) * 0.6);

  const sim = emptyWorld();
  sim.drought();
  for (let i = 0; i <= RULES.droughtLength; i++) sim.step(0, 0);
  assert.deepEqual(sim.events.filter((e) => e.kind === 'drought').map((e) => e.text), ['A drought began', 'The drought ended']);
});

test('a plague strikes only the most numerous species', () => {
  const sim = run(11, 0);
  const before = sim.species.map((sp) => sp.count);
  const largest = before.indexOf(Math.max(...before));
  const died = sim.plague();
  sim.step(0, 0);
  assert.ok(died > before[largest] * 0.4 && died < before[largest] * 0.8);
  assert.equal(sim.species[largest].count, before[largest] - died);
  assert.equal(sim.carcasses.size, died);
  assert.ok(sim.events.some((e) => e.kind === 'plague' && e.species === largest));
});

test('a meteor kills what is near, spares what is far, and scorches the land', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  const near = creature({ x: spot.x + 20, y: spot.y });
  const far = creature({ x: (spot.x + RULES.meteorRadius + 150) % WIDTH, y: spot.y });
  sim.creatures = [near, far];
  sim.addFood(spot.x + 5, spot.y);

  assert.equal(sim.meteor(spot.x, spot.y), 1);
  assert.equal(sim.food.size, 0);
  assert.equal(sim.terrain[cellIndex(spot.x, spot.y)], DESERT);
  assert.ok(sim.tempOffset[cellIndex(spot.x, spot.y)] > 10);
  sim.step(0, 0);
  assert.deepEqual(sim.creatures, [far]);
  assert.ok(sim.events.some((e) => e.kind === 'meteor'));
});

test('a saved world survives JSON and continues exactly as the original would', () => {
  const original = run(42, 700);
  original.paintTerrain(300, 300, 40, 'water');
  original.paintTemperature(600, 200, 80, -8);
  original.drought();
  for (let i = 0; i < 55; i++) original.step(1, 0.4); // stop between temperature refreshes
  const saved = JSON.parse(JSON.stringify(original.save()));

  const restored = createSim({ seed: 999 });
  restored.generate();
  restored.load(saved);
  assert.equal(restored.tick, original.tick);
  assert.equal(restored.seed, 42);
  assert.equal(snapshot(restored), snapshot(original));

  for (let i = 0; i < 600; i++) {
    original.step(1, 0.4);
    restored.step(1, 0.4);
  }
  assert.equal(snapshot(restored), snapshot(original));
  assert.deepEqual(restored.events, original.events);
  assert.equal(restored.carcasses.size, original.carcasses.size);
});

test('loading rejects a save from another version', () => {
  const sim = run(1, 0);
  assert.throws(() => sim.load({ ...sim.save(), version: 99 }));
  assert.throws(() => sim.load(null));
});

// ---------- Getting stuck ----------

test('a creature gets round a wall to reach food instead of pacing in front of it', () => {
  // A wide temperature tolerance keeps passing weather out of this test.
  const sim = createSim({ seed: 7, params: { tempTolerance: 100 } });
  sim.generate();
  sim.creatures = [];
  const spot = findCell(sim, (d, temp) => d > 8 && d < 1e8 && Math.abs(temp - 18) < 4); // mid-map, clear of the edges
  // A mountain wall 70 pixels long between the creature and a plant.
  for (let dy = -30; dy <= 30; dy += 10) sim.paintTerrain(spot.x + 20, spot.y + dy, 4, 'mountain');
  sim.food.clear();
  const c = creature({ ...spot, vision: 90, energy: 100 });
  sim.creatures = [c];
  assert.ok(sim.addFood(spot.x + 40, spot.y));
  for (let i = 0; i < 300 && sim.food.size; i++) sim.step(0, 0);
  assert.equal(sim.food.size, 0, 'the plant behind the wall was never reached');
  assert.deepEqual([c.blocked, c.slide, c.detour], [0, null, 0], 'it should stop detouring once it has eaten');
});

test('creatures caught under newly painted water or mountains get out', () => {
  for (const kind of ['water', 'mountain']) {
    const sim = createSim({ seed: 7, params: { tempTolerance: 100 } });
    sim.generate();
    sim.food.clear();
    const spot = findCell(sim, inlandMild);
    sim.creatures = Array.from({ length: 12 }, (_, i) =>
      creature({ x: spot.x + (i % 4) * 6 - 9, y: spot.y + Math.floor(i / 4) * 6 - 6, heading: i, energy: 100 }));
    sim.paintTerrain(spot.x, spot.y, 50, kind);
    for (let i = 0; i < 120; i++) sim.step(0, 0);
    assert.equal(sim.creatures.length, 12);
    for (const c of sim.creatures) assert.equal(sim.blocked[cellIndex(c.x, c.y)], 0, 'still stuck in ' + kind);
  }
});

test('plants do not pile up where nothing eats them', () => {
  const sim = emptyWorld();
  for (let i = 0; i < 4000; i++) sim.step(2, 0);
  for (const bucket of sim.food.buckets) assert.ok(bucket.length <= RULES.maxFoodNearby);
  for (const f of sim.food) assert.ok(sim.waterDistance[cellIndex(f.x, f.y)] < 1e8, 'a plant grew on land cut off from water');
});

// ---------- Random disasters ----------

test('auto mode strikes with every kind of disaster, and never when it is off', () => {
  const kinds = (params) => {
    const sim = createSim({ seed: 3, params });
    sim.generate();
    for (let i = 0; i < 6000; i++) sim.step(1, 0.4);
    const wanted = ['heat', 'cold', 'plague', 'meteor'];
    return new Set(sim.events.filter((e) => wanted.includes(e.kind) || e.text === 'A drought began').map((e) => e.kind));
  };
  assert.deepEqual([...kinds({ autoDisasters: true, autoDisasterEvery: 60 })].sort(), ['cold', 'drought', 'heat', 'meteor', 'plague']);
  assert.equal(kinds({ autoDisasters: false, autoDisasterEvery: 60 }).size, 0);
  assert.equal(kinds({}).size, 0, 'auto mode should be off unless asked for');
});

test('auto mode is rare by default and repeats exactly for the same seed', () => {
  const disasters = () => {
    const sim = createSim({ seed: 12, params: { autoDisasters: true } });
    sim.generate();
    for (let i = 0; i < 30000; i++) sim.step(1, 0.4);
    return sim.events.filter((e) => ['heat', 'cold', 'plague', 'meteor'].includes(e.kind) || e.text === 'A drought began');
  };
  const first = disasters();
  assert.ok(first.length <= 8, 'struck ' + first.length + ' times in 30,000 ticks');
  assert.deepEqual(disasters(), first);
});

test('droughts from auto mode do not overlap', () => {
  const sim = createSim({ seed: 4, params: { autoDisasters: true, autoDisasterEvery: 20 } });
  sim.generate();
  let last = -Infinity;
  for (let i = 0; i < 6000; i++) sim.step(0, 0);
  for (const e of sim.events) {
    if (e.text !== 'A drought began') continue;
    assert.ok(e.tick - last >= RULES.droughtLength, 'a drought began during another');
    last = e.tick;
  }
});

test('a world can start with species you describe, tidied into the allowed ranges', () => {
  const sim = createSim({ seed: 9 });
  sim.setFounders([
    { name: 'Glow<b>worms</b>', color: '#12ab9c', startCount: 40, speed: 2, vision: 50, strength: 1, preferredTemp: 20, diet: 0.5 },
    { name: '', color: 'red', startCount: 9999, speed: 99, vision: 'x', strength: -3, preferredTemp: 10, diet: 2 },
  ]);
  sim.generate();
  assert.deepEqual(sim.species.map((sp) => sp.name), ['Glowbwormsb', 'Meadowfolk']); // markup stripped; blank name replaced
  assert.deepEqual(sim.species.map((sp) => sp.count), [40, RULES.maxStartCount]);
  assert.equal(sim.species[0].color, '#12ab9c');
  const second = sim.founders[1];
  assert.equal(second.speed, RULES.traitLimits.speed[1]);
  assert.equal(second.strength, RULES.traitLimits.strength[0]);
  assert.equal(second.diet, 1);
  assert.equal(second.vision, SPECIES[1].vision); // unusable, so the fallback's
  assert.ok(sim.creatures.filter((c) => c.species === 0).every((c) => c.vision === 50 && c.diet === 0.5));
  for (let i = 0; i < 200; i++) sim.step(1, 0.4);

  sim.setFounders([]);
  assert.deepEqual(sim.founders.map((f) => f.name), SPECIES.map((f) => f.name));
});

test('a blank map waits to be painted, and is populated only once it has water', () => {
  const sim = createSim({ seed: 3 });
  sim.generate(3, { map: 'blank', populate: false });
  assert.ok(sim.water.every((w) => w === 0) && sim.terrain.every((t) => t === 0));
  assert.equal(sim.creatures.length + sim.food.size + sim.species.length, 0);
  assert.equal(sim.plague(), 0);
  assert.equal(sim.populate(), false); // nowhere to drink
  assert.equal(sim.creatures.length, 0);

  sim.paintTerrain(700, 340, 40, 'water');
  sim.paintTerrain(400, 340, 60, 'fertile');
  assert.equal(sim.populate(), true);
  assert.equal(sim.species.length, SPECIES.length);
  assert.equal(sim.creatures.length, sim.founders.reduce((sum, f) => sum + f.startCount, 0));
  assert.ok(sim.creatures.every((c) => !sim.blocked[cellIndex(c.x, c.y)]));
  assert.equal(sim.populate(), false); // already populated
  for (let i = 0; i < 300; i++) sim.step(1, 0.4);
  assert.ok(sim.creatures.length > 0);
});

test('an existing map can be kept and repopulated', () => {
  const sim = run(4, 100);
  const terrain = Array.from(sim.terrain), water = Array.from(sim.water);
  sim.generate(4, { map: 'keep', populate: false });
  assert.deepEqual(Array.from(sim.terrain), terrain);
  assert.deepEqual(Array.from(sim.water), water);
  assert.equal(sim.tick, 0);
  assert.equal(sim.creatures.length, 0);
  assert.equal(sim.populate(), true);
});

// ---------- Evolution ----------

test('a whole species shifts toward what its members have become, and reaches a new stage', () => {
  const sim = createSim({ seed: 7, params: { evolveEvery: 50, evolveRate: 0.5, evolveStep: 0.5 } });
  sim.generate();
  sim.creatures = [];
  sim.food.clear();
  const spot = findCell(sim, inlandMild);
  const home = sim.species[1];
  // Members a little stronger and faster than the species started out.
  for (let i = 0; i < 20; i++) {
    sim.creatures.push(creature({ x: spot.x + i, y: spot.y, energy: 100, strength: home.origin.strength + 1, speed: home.origin.speed + 0.5, preferredTemp: 18 }));
  }
  const before = { ...home.origin };
  for (let i = 0; i < 50; i++) sim.step(0, 0);
  assert.ok(Math.abs(home.origin.strength - (before.strength + 0.5)) < 1e-9, 'half the gap closed');
  assert.equal(home.stage, 2);
  const logged = sim.events.find((e) => e.kind === 'evolve');
  assert.ok(logged && logged.text.startsWith('Meadowfolk evolved to stage 2: stronger'), logged && logged.text);
});

test('evolution keeps a drifting species together: fewer species split off', () => {
  // Counts the species that were announced (reached 10 members), over two
  // worlds, since a single world can go either way.
  const splits = (params) => [1, 2].reduce((total, seed) => {
    const sim = createSim({ seed, params });
    sim.generate();
    for (let i = 0; i < 20000; i++) sim.step(1, 0.4);
    return total + sim.species.filter((sp) => sp.established).length;
  }, 0);
  assert.ok(splits({}) < splits({ evolveEvery: 1e9 }));
});

test('species from older saves start at stage 1 with no abilities', () => {
  const sim = run(4, 50);
  const data = JSON.parse(JSON.stringify(sim.save()));
  for (const sp of data.species) {
    delete sp.stage;
    delete sp.stageOrigin;
    delete sp.abilities;
  }
  for (const values of data.creatures) values.length -= 4; // no ability fields
  delete data.projectiles;
  const restored = createSim({ seed: 1 });
  restored.generate();
  restored.load(data);
  assert.ok(restored.species.every((sp) => sp.stage === 1 && sp.abilities.length === 0));
  assert.deepEqual(restored.species[0].stageOrigin, restored.species[0].origin);
  assert.ok(restored.creatures.every((c) => c.ability === null && c.frozen === 0 && c.cooldown === 0));
  for (let i = 0; i < 100; i++) restored.step(1, 0.4);
});

// ---------- Abilities ----------

test('a newborn inherits its parent ability, rarely loses it, and rarely gains one suited to its strength', () => {
  const always = () => 0, never = () => 0.999;
  const child = { strength: 1 };
  inheritAbility(child, { ability: 'spit' }, 0, never);
  assert.equal(child.ability, 'spit');
  inheritAbility(child, { ability: 'spit' }, 0, always); // the loss roll comes up
  assert.equal(child.ability, null);
  inheritAbility(child, { ability: null }, 0.001, never);
  assert.equal(child.ability, null);

  // Weak creatures only ever get the weak abilities, strong ones the weapons.
  assert.deepEqual(abilitiesFor(1), ['camouflage', 'dash']);
  assert.deepEqual(abilitiesFor(3), ['spit', 'freeze', 'pull']);
  for (let i = 0; i < 20; i++) {
    const weak = { strength: 0.8 }, strong = { strength: 3 };
    const roll = (() => { let n = 0; return () => (n++ === 0 ? 0 : i / 20); })();
    inheritAbility(weak, { ability: null }, 1, roll);
    assert.ok(['camouflage', 'dash'].includes(weak.ability));
    const roll2 = (() => { let n = 0; return () => (n++ === 0 ? 0 : i / 20); })();
    inheritAbility(strong, { ability: null }, 1, roll2);
    assert.ok(['spit', 'freeze', 'pull'].includes(strong.ability));
  }
  // Stronger means more powerful.
  assert.ok(abilityPower('freeze', 3).radius > abilityPower('freeze', 2).radius);
  assert.ok(abilityPower('spit', 3).damage > abilityPower('spit', 1.5).damage);
});

test('abilities are rare: few newborns gain one, and more as the species evolves', () => {
  const gained = (stage) => {
    const sim = emptyWorld();
    sim.species[1].stage = stage;
    const spot = findCell(sim, inlandMild);
    const temp = sim.temperature[cellIndex(spot.x, spot.y)];
    let count = 0;
    for (let i = 0; i < 4000; i++) {
      sim.creatures = [creature({ ...spot, energy: 150, preferredTemp: temp, strength: 2 })];
      sim.step(0, 0);
      count += sim.creatures.filter((c) => c.ability).length;
    }
    return count;
  };
  const early = gained(1), late = gained(5);
  assert.ok(early < 10, 'stage 1 gained ' + early + ' in 4000 births');
  assert.ok(late > early);
});

test('freeze stops nearby enemies moving and fighting, but not its own kind', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  const temp = sim.temperature[cellIndex(spot.x, spot.y)];
  const freezer = creature({ ...spot, species: 0, ability: 'freeze', strength: 2, energy: 80, preferredTemp: temp, speed: 0.01 });
  const enemy = creature({ x: spot.x + 12, y: spot.y, species: 1, strength: 2, energy: 80, preferredTemp: temp });
  const friend = creature({ x: spot.x - 12, y: spot.y, species: 0, energy: 80, preferredTemp: temp });
  sim.creatures = [freezer, enemy, friend];
  sim.step(0, 0);
  assert.ok(enemy.frozen > 0);
  assert.equal(friend.frozen || 0, 0);
  assert.equal(freezer.cooldown, RULES.abilities.freeze.cooldown);
  const at = [enemy.x, enemy.y];
  sim.step(0, 0);
  assert.deepEqual([enemy.x, enemy.y], at);
  assert.equal(sim.effects[0].kind, 'freeze');
});

test('spit flies at a distant enemy and hurts it', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  const temp = sim.temperature[cellIndex(spot.x, spot.y)];
  const spitter = creature({ ...spot, species: 0, ability: 'spit', strength: 2, energy: 80, preferredTemp: temp, speed: 0.01, diet: 0, vision: 60 });
  const target = creature({ x: spot.x + 30, y: spot.y, species: 1, energy: 50, preferredTemp: temp, speed: 0.01, strength: 2 });
  sim.creatures = [spitter, target];
  sim.step(0, 0);
  assert.equal(sim.projectiles.length, 1);
  for (let i = 0; i < 10 && sim.projectiles.length; i++) sim.step(0, 0);
  assert.equal(sim.projectiles.length, 0);
  assert.ok(target.energy < 50 - abilityPower('spit', 2).damage + 1);
});

test('pull drags a weaker enemy in, but not a stronger one', () => {
  const pulled = (enemyStrength) => {
    const sim = emptyWorld();
    const spot = findCell(sim, inlandMild);
    const temp = sim.temperature[cellIndex(spot.x, spot.y)];
    const puller = creature({ ...spot, species: 0, ability: 'pull', strength: 3, energy: 50, diet: 1, preferredTemp: temp, speed: 0.01, vision: 60 });
    const enemy = creature({ x: spot.x + 35, y: spot.y, species: 1, strength: enemyStrength, preferredTemp: temp, speed: 0.01, vision: 5 });
    sim.creatures = [puller, enemy];
    sim.step(0, 0);
    return Math.abs(enemy.x - puller.x);
  };
  assert.ok(pulled(1) < 8);
  assert.ok(pulled(3.5) > 30);
});

test('camouflage hides a creature from enemies until they are close', () => {
  const chases = (ability, distance) => {
    const sim = emptyWorld();
    const spot = findCell(sim, inlandMild);
    const temp = sim.temperature[cellIndex(spot.x, spot.y)];
    const hunter = creature({ ...spot, species: 0, strength: 3, diet: 1, energy: 20, vision: 60, preferredTemp: temp, heading: Math.PI });
    const prey = creature({ x: spot.x + distance, y: spot.y, species: 1, strength: 1, ability, preferredTemp: temp, speed: 0.01 });
    sim.creatures = [hunter, prey];
    sim.step(0, 0);
    return Math.abs(hunter.heading) < 0.3; // turned toward the prey
  };
  assert.equal(chases(null, 40), true);
  assert.equal(chases('camouflage', 40), false);
  assert.equal(chases('camouflage', 8), true);
});

test('dash carries a fleeing creature away faster', () => {
  const fled = (ability) => {
    const sim = emptyWorld();
    const spot = findCell(sim, inlandMild);
    const temp = sim.temperature[cellIndex(spot.x, spot.y)];
    const prey = creature({ ...spot, species: 1, strength: 0.8, speed: 1, ability, preferredTemp: temp, energy: 80 });
    const threat = creature({ x: spot.x + 15, y: spot.y, species: 0, strength: 3, preferredTemp: temp, speed: 0.01, energy: 80 });
    sim.creatures = [prey, threat];
    sim.step(0, 0);
    return Math.abs(prey.x - spot.x);
  };
  assert.ok(fled('dash') > fled(null) * 1.8);
});

test('with abilities switched off, nobody uses or gains one', () => {
  const sim = emptyWorld();
  sim.params.abilities = false;
  const spot = findCell(sim, inlandMild);
  const temp = sim.temperature[cellIndex(spot.x, spot.y)];
  const freezer = creature({ ...spot, species: 0, ability: 'freeze', strength: 2, energy: 80, preferredTemp: temp, speed: 0.01 });
  const enemy = creature({ x: spot.x + 12, y: spot.y, species: 1, strength: 2, energy: 80, preferredTemp: temp });
  sim.creatures = [freezer, enemy];
  sim.step(0, 0);
  assert.equal(enemy.frozen || 0, 0);

  const big = createSim({ seed: 2, params: { abilities: false, abilityChance: 1 } });
  big.generate();
  for (let i = 0; i < 1000; i++) big.step(1, 0.4);
  assert.ok(big.creatures.every((c) => !c.ability));
});

test('an ability that spreads through a species is logged, and so is losing it', () => {
  const sim = emptyWorld();
  const spot = findCell(sim, inlandMild);
  for (let i = 0; i < 20; i++) sim.creatures.push(creature({ x: spot.x + i * 3, y: spot.y, energy: 100, speed: 0.01, ability: i < 12 ? 'dash' : null, preferredTemp: 18 }));
  while (sim.tick < RULES.abilityReviewEvery) sim.step(0, 0);
  assert.deepEqual(sim.species[1].abilities, ['dash']);
  assert.ok(sim.events.some((e) => e.kind === 'ability' && e.text === 'Meadowfolk evolved a burst of speed'));
  for (const c of sim.creatures) {
    c.ability = null;
    c.energy = 100; // nothing to eat here
  }
  while (sim.tick < 2 * RULES.abilityReviewEvery) sim.step(0, 0);
  assert.deepEqual(sim.species[1].abilities, []);
  assert.ok(sim.events.some((e) => e.text === 'Meadowfolk lost a burst of speed'));
});

test('a world with abilities in play saves and continues exactly', () => {
  const original = createSim({ seed: 11, params: { abilityChance: 0.05 } });
  original.generate();
  for (let i = 0; i < 1500; i++) original.step(1, 0.4);
  assert.ok(original.creatures.some((c) => c.ability));
  const restored = createSim({ seed: 1 });
  restored.generate();
  restored.load(JSON.parse(JSON.stringify(original.save())));
  for (let i = 0; i < 500; i++) {
    original.step(1, 0.4);
    restored.step(1, 0.4);
  }
  assert.equal(snapshot(restored), snapshot(original));
  assert.deepEqual(restored.projectiles, original.projectiles);
});

test('small creatures split with less energy than big ones', () => {
  const splits = (strength, energy) => {
    const sim = emptyWorld();
    const spot = findCell(sim, inlandMild);
    sim.creatures = [creature({ ...spot, strength, energy, preferredTemp: sim.temperature[cellIndex(spot.x, spot.y)] })];
    sim.step(0, 0);
    return sim.creatures.length === 2;
  };
  assert.equal(breedEnergy({ strength: 1 }), 100);
  assert.equal(breedEnergy({ strength: 4 }), 190);
  assert.equal(splits(1, 105), true);
  assert.equal(splits(4, 100), false);
  assert.equal(splits(4, 200), true);
});
