// The simulation itself: world generation and the per-tick rules.
// Nothing here touches the page, so it runs in the browser and under Node.

import { SPECIES, DEFAULT_PARAMS, RULES } from './params.js';
import { mulberry32 } from './rng.js';
import { SpatialGrid } from './grid.js';
import { spawnCreature, makeOffspring } from './creatures.js';
import { TRAITS, traitDistance, traitsOf, nameSpecies, colorForSpecies } from './species.js';
import { pack, unpack } from './pack.js';
import {
  GRID_W, GRID_H, CELL, WIDTH, HEIGHT, PLAIN, FERTILE, DESERT, MOUNTAIN,
  cellIndex, wrapDistance, generateLakes, generateMountains, classifyLand, computeWaterDistance, updateTemperature,
} from './world.js';

const BUCKET_SIZE = 40; // pixels; roughly a typical vision radius

// Directions a creature probes when looking for a better temperature.
const TEMP_PROBES = [[30, 0], [-30, 0], [0, 30], [0, -30]];

// Velocity of each weather front in pixels per tick. They alternate warm, cold.
const FRONT_DRIFTS = [[0.12, 0.05], [-0.09, 0.07], [0.07, -0.06], [-0.11, -0.04]];

const TERRAIN_FERTILITY = [];
TERRAIN_FERTILITY[PLAIN] = RULES.terrainFertility.plain;
TERRAIN_FERTILITY[FERTILE] = RULES.terrainFertility.fertile;
TERRAIN_FERTILITY[DESERT] = RULES.terrainFertility.desert;
TERRAIN_FERTILITY[MOUNTAIN] = 0;

// What the terrain brush can paint.
const PAINT_KINDS = { plain: PLAIN, fertile: FERTILE, desert: DESERT, mountain: MOUNTAIN };

const SAVE_VERSION = 1;
const CREATURE_FIELDS = [
  'id', 'parentId', 'species', 'x', 'y', 'heading', 'energy', 'hydration', 'thirsty', 'age',
  'bornTick', 'generation', 'offspring', ...TRAITS, 'swimmer', 'detour', 'blocked', 'slide',
];

// Turns (in radians) a blocked creature tries, gentlest first, to slide past an obstacle.
const SLIDE_TURNS = [0.35, 0.7, 1.05, 1.4, 1.75, 2.1, 2.45, 2.8];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Creates a simulation. Call sim.generate() to build a world, then sim.step().
//   seed:   the same seed always gives the same world
//   params: overrides for DEFAULT_PARAMS
export function createSim({ seed = 1, params = {} } = {}) {
  const P = { ...DEFAULT_PARAMS, ...params };
  let random = mulberry32(seed);
  let nextCreatureId = 1;

  const sim = {
    seed,
    params: P,
    // Every species that has ever existed; a creature's `species` indexes this.
    // { id, name, color, parent, bornTick, extinctTick, established, count, kills, origin }
    species: [],
    water: new Uint8Array(GRID_W * GRID_H),           // 1 = water
    terrain: new Uint8Array(GRID_W * GRID_H),         // PLAIN, FERTILE, DESERT or MOUNTAIN
    blocked: new Uint8Array(GRID_W * GRID_H),         // 1 = water or mountain
    waterDistance: new Float32Array(GRID_W * GRID_H), // cells to walk to water
    temperature: new Float32Array(GRID_W * GRID_H),
    tempOffset: new Float32Array(GRID_W * GRID_H),    // warming or cooling from brushes and meteors
    // `wet` marks plants and carcasses lying in water, which only swimmers go for.
    food: new SpatialGrid(WIDTH, HEIGHT, BUCKET_SIZE),     // plants: { x, y, wet }
    carcasses: new SpatialGrid(WIDTH, HEIGHT, BUCKET_SIZE), // meat: { x, y, tick, wet }
    creatures: [],
    fronts: [],
    events: [],          // the event log: { tick, kind, species, text }
    tick: 0,
    temperatureBoost: 0, // degrees added everywhere; fades over time
    droughtUntil: 0,     // a drought is on while tick < droughtUntil
    generate,
    step,
    stats,
    addFood,
    fertility,
    isHostile,
    lineage,
    heatWave: () => weather(9, 'heat', 'Heat wave'),
    coldSnap: () => weather(-9, 'cold', 'Cold snap'),
    drought,
    plague,
    meteor,
    paintTerrain,
    paintTemperature,
    save,
    load,
  };

  // Rebuilt at the start of every tick to find nearby enemies quickly.
  const creatureGrid = new SpatialGrid(WIDTH, HEIGHT, BUCKET_SIZE);
  let carcassQueue = []; // carcasses in the order they appeared, for rotting
  let livingSpecies = 0;

  function refreshTemperature() {
    updateTemperature(sim.temperature, sim.fronts, sim.tick, sim.temperatureBoost, P, sim.tempOffset);
  }

  function logEvent(kind, text, species = null) {
    sim.events.push({ tick: sim.tick, kind, species, text });
    if (sim.events.length > RULES.maxEvents) sim.events.shift();
  }

  function weather(boost, kind, text) {
    sim.temperatureBoost = boost;
    logEvent(kind, text);
  }

  // ---------- World generation ----------

  // Builds a fresh world. Pass a new seed, or omit it to rebuild the same one.
  function generate(newSeed = sim.seed) {
    sim.seed = newSeed;
    random = mulberry32(newSeed);
    nextCreatureId = 1;
    sim.food.clear();
    sim.carcasses.clear();
    carcassQueue = [];
    sim.creatures = [];
    sim.events = [];
    sim.tick = 0;
    sim.temperatureBoost = 0;
    sim.droughtUntil = 0;
    sim.tempOffset.fill(0);

    generateLakes(sim.water, random);
    generateMountains(sim.terrain, sim.water, random);
    computeWaterDistance(sim.water, sim.terrain, sim.waterDistance);
    classifyLand(sim.terrain, sim.water, sim.waterDistance, random);
    rebuildBlocked();

    // Warm and cold fronts, each drifting in its own direction.
    sim.fronts = FRONT_DRIFTS.map(([vx, vy], i) => ({
      x: random() * WIDTH,
      y: random() * HEIGHT,
      vx,
      vy,
      strength: i % 2 ? -P.frontStrength : P.frontStrength,
    }));
    refreshTemperature();

    sim.species = SPECIES.map((founder, id) => ({
      id,
      name: founder.name,
      color: founder.color,
      parent: null,
      bornTick: 0,
      extinctTick: null,
      established: true,
      count: 0,
      kills: 0,
      origin: traitsOf(founder),
      lastTrendCount: founder.startCount ?? RULES.startPerSpecies,
    }));

    // Each founding species starts in the latitude band that suits its climate.
    SPECIES.forEach((founder, id) => {
      const latitude = clamp(((founder.preferredTemp - RULES.baseTemp) / P.tempGradient + 1) / 2, 0.16, 0.84);
      for (let i = 0; i < (founder.startCount ?? RULES.startPerSpecies); i++) {
        let x, y, tries = 0;
        do {
          x = random() * WIDTH;
          y = clamp((latitude + (random() - 0.5) * 0.26) * HEIGHT, 0, HEIGHT - 1);
        } while (!habitable(cellIndex(x, y)) && tries++ < 50);
        sim.creatures.push(spawnCreature(nextCreatureId++, id, founder, x, y, P.swimmerShare, random));
      }
    });
    countSpecies();

    for (let i = 0; i < RULES.startFood; i++) {
      const x = random() * WIDTH, y = random() * HEIGHT;
      addFood(x, y);
    }
  }

  function rebuildBlocked() {
    for (let i = 0; i < sim.blocked.length; i++) sim.blocked[i] = sim.water[i] || sim.terrain[i] === MOUNTAIN ? 1 : 0;
  }

  // Land a creature can stand on and walk to water from.
  function habitable(cell) {
    return !sim.blocked[cell] && sim.waterDistance[cell] < 1e8;
  }

  // ---------- Food ----------

  // Places a plant unless the spot is a mountain. Returns whether it landed.
  function addFood(x, y) {
    const cell = cellIndex(x, y);
    if (sim.terrain[cell] === MOUNTAIN) return false;
    sim.food.add({ x, y, wet: sim.water[cell] === 1 });
    return true;
  }

  // Chance (0 to 1) that a plant sprouting in a cell takes hold: best on
  // fertile land near water, poor in desert and in extreme cold or heat.
  // Water grows a few plants of its own.
  function fertility(cell) {
    const temp = sim.temperature[cell];
    const climate = temp < -4 || temp > 40 ? 0.15 : 1;
    if (sim.water[cell]) return RULES.waterFertility * climate;
    if (sim.terrain[cell] === MOUNTAIN) return 0;
    // Land walled off from all water supports nothing, so no plants pile up there.
    if (sim.waterDistance[cell] > 1e8) return 0;
    const nearWater = 0.2 + 0.8 * Math.exp(-sim.waterDistance[cell] / 5);
    return Math.min(1, TERRAIN_FERTILITY[sim.terrain[cell]] * nearWater * climate);
  }

  // Plants sprout at random spots, subject to how fertile the land is there.
  function growFood(foodRate) {
    let budget = foodRate * P.foodGrowth * (inDrought() ? RULES.droughtFoodFactor : 1);
    while (budget > 0) {
      if (random() < budget && sim.food.size < RULES.maxFood) {
        const x = random() * WIDTH, y = random() * HEIGHT;
        // A patch that is already crowded grows no more. This keeps plants
        // nobody can reach from piling up and using the whole world's allowance.
        if (random() < fertility(cellIndex(x, y)) && sim.food.bucketAt(x, y).length < RULES.maxFoodNearby) addFood(x, y);
      }
      budget -= 1;
    }
  }

  function rotCarcasses() {
    let done = 0;
    while (done < carcassQueue.length && sim.tick - carcassQueue[done].tick > RULES.carcassLifetime) {
      const carcass = carcassQueue[done++];
      if (!carcass.eaten) sim.carcasses.remove(carcass);
    }
    if (done) carcassQueue = carcassQueue.slice(done);
  }

  // ---------- World tools and disasters ----------

  const inDrought = () => sim.tick < sim.droughtUntil;

  // Calls visit(cell, distance) for each grid cell whose centre is within
  // `radius` pixels of (x, y), allowing for the east-west wrap.
  function forCellsNear(x, y, radius, visit) {
    const reach = Math.ceil(radius / CELL) + 1;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let gy = Math.max(0, cy - reach); gy <= Math.min(GRID_H - 1, cy + reach); gy++) {
      for (let ax = -reach; ax <= reach; ax++) {
        const gx = ((cx + ax) % GRID_W + GRID_W) % GRID_W;
        const dx = wrapDistance(gx * CELL + CELL / 2 - x, WIDTH), dy = gy * CELL + CELL / 2 - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= radius) visit(gy * GRID_W + gx, distance);
      }
    }
  }

  const within = (item, x, y, radius) => {
    const dx = wrapDistance(item.x - x, WIDTH), dy = item.y - y;
    return dx * dx + dy * dy <= radius * radius;
  };

  // Call after the map changes: updates what blocks movement and the routes
  // to water, clears plants and carcasses off mountains, and notes which of
  // the rest are now in water.
  function terrainChanged() {
    rebuildBlocked();
    computeWaterDistance(sim.water, sim.terrain, sim.waterDistance);
    for (const plant of [...sim.food]) {
      const cell = cellIndex(plant.x, plant.y);
      if (sim.terrain[cell] === MOUNTAIN) sim.food.remove(plant);
      else plant.wet = sim.water[cell] === 1;
    }
    for (const carcass of [...sim.carcasses]) {
      const cell = cellIndex(carcass.x, carcass.y);
      if (sim.terrain[cell] === MOUNTAIN) {
        sim.carcasses.remove(carcass);
        carcass.eaten = true;
      } else {
        carcass.wet = sim.water[cell] === 1;
      }
    }
  }

  // Paints terrain in a circle. `kind` is 'water', 'plain', 'fertile', 'desert' or 'mountain'.
  function paintTerrain(x, y, radius, kind) {
    if (kind !== 'water' && !(kind in PAINT_KINDS)) throw new Error('Unknown terrain: ' + kind);
    forCellsNear(x, y, radius, (cell) => {
      sim.water[cell] = kind === 'water' ? 1 : 0;
      sim.terrain[cell] = kind === 'water' ? PLAIN : PAINT_KINDS[kind];
    });
    terrainChanged();
  }

  // Warms (positive `degrees`) or cools a circle, strongest at the centre.
  // The change fades away over a few thousand ticks.
  function paintTemperature(x, y, radius, degrees) {
    forCellsNear(x, y, radius, (cell, distance) => {
      sim.tempOffset[cell] = clamp(
        sim.tempOffset[cell] + degrees * (1 - distance / radius),
        -RULES.tempOffsetLimit, RULES.tempOffsetLimit,
      );
    });
    refreshTemperature();
  }

  // Plants grow poorly and creatures get thirsty faster for a while.
  function drought() {
    sim.droughtUntil = sim.tick + RULES.droughtLength;
    logEvent('drought', 'A drought began');
  }

  // A disease sweeps through the most numerous species. Returns how many died.
  function plague() {
    const target = sim.species.reduce((a, b) => (b.count > a.count ? b : a));
    if (!target.count) return 0;
    let died = 0;
    for (const c of sim.creatures) {
      if (c.species === target.id && c.energy > 0 && random() < RULES.plagueDeathRate) {
        c.energy = 0; // removed, leaving a carcass, at the end of the next tick
        died++;
      }
    }
    logEvent('plague', 'A plague killed ' + died + ' of ' + target.count + ' ' + target.name, target.id);
    return died;
  }

  // A meteor strikes (x, y): everything nearby dies, the land is scorched to
  // desert and stays hot for a while. Returns how many creatures died.
  function meteor(x, y) {
    const radius = RULES.meteorRadius;
    let died = 0;
    for (const c of sim.creatures) {
      if (c.energy > 0 && within(c, x, y, radius)) {
        c.energy = 0;
        died++;
      }
    }
    for (const plant of [...sim.food]) if (within(plant, x, y, radius)) sim.food.remove(plant);
    forCellsNear(x, y, radius * 0.7, (cell) => {
      if (!sim.water[cell] && sim.terrain[cell] !== MOUNTAIN) sim.terrain[cell] = DESERT;
    });
    paintTemperature(x, y, radius * 1.5, RULES.meteorHeat);
    logEvent('meteor', 'A meteor killed ' + died + (died === 1 ? ' creature' : ' creatures'));
    return died;
  }

  // In auto mode, a disaster strikes at random about once every
  // `autoDisasterEvery` ticks. Called once per tick.
  function maybeRandomDisaster() {
    if (!P.autoDisasters || random() >= 1 / P.autoDisasterEvery) return;
    const strikes = {
      heat: sim.heatWave,
      cold: sim.coldSnap,
      drought,
      plague,
      meteor: () => meteor(random() * WIDTH, random() * HEIGHT),
    };
    const weights = { ...RULES.autoDisasterWeights };
    if (inDrought()) weights.drought = 0; // one drought at a time
    let pick = random() * Object.values(weights).reduce((a, b) => a + b, 0);
    for (const kind of Object.keys(weights)) {
      pick -= weights[kind];
      if (pick < 0) return strikes[kind]();
    }
  }

  // ---------- Saving ----------

  // Everything needed to carry on later, as plain data that survives JSON.
  function save() {
    return {
      version: SAVE_VERSION,
      seed: sim.seed,
      params: { ...P },
      tick: sim.tick,
      rng: random.getState(),
      nextCreatureId,
      temperatureBoost: sim.temperatureBoost,
      droughtUntil: sim.droughtUntil,
      water: pack(sim.water),
      terrain: pack(sim.terrain),
      temperature: pack(sim.temperature),
      tempOffset: pack(sim.tempOffset),
      fronts: sim.fronts.map((f) => ({ ...f })),
      species: sim.species.map((sp) => ({ ...sp, origin: { ...sp.origin } })),
      creatures: sim.creatures.map((c) => CREATURE_FIELDS.map((field) => c[field])),
      food: [...sim.food].map((f) => [f.x, f.y]),
      carcasses: [...sim.carcasses].map((k) => [k.x, k.y, k.tick]),
      events: sim.events.map((e) => ({ ...e })),
    };
  }

  // Restores a world made by save(). The run then continues exactly as it would have.
  function load(data) {
    if (!data || data.version !== SAVE_VERSION) throw new Error('This save is from a different version');
    unpack(data.water, sim.water);
    unpack(data.terrain, sim.terrain);
    unpack(data.temperature, sim.temperature);
    unpack(data.tempOffset, sim.tempOffset);
    rebuildBlocked();
    computeWaterDistance(sim.water, sim.terrain, sim.waterDistance);

    Object.assign(P, data.params);
    sim.seed = data.seed;
    sim.tick = data.tick;
    random = mulberry32(0);
    random.setState(data.rng);
    nextCreatureId = data.nextCreatureId;
    sim.temperatureBoost = data.temperatureBoost;
    sim.droughtUntil = data.droughtUntil;
    sim.fronts = data.fronts.map((f) => ({ ...f }));
    sim.species = data.species.map((sp) => ({ ...sp, origin: { ...sp.origin } }));
    livingSpecies = sim.species.filter((sp) => sp.count > 0).length;
    sim.events = data.events.map((e) => ({ ...e }));
    sim.creatures = data.creatures.map((values) => {
      const c = {};
      CREATURE_FIELDS.forEach((field, i) => { c[field] = values[i]; });
      c.swimmer = !!c.swimmer; // saves from before swimming existed
      c.detour = c.detour || 0;
      c.blocked = c.blocked || 0;
      c.slide = c.slide ?? null;
      return c;
    });

    sim.food.clear();
    const wet = (x, y) => sim.water[cellIndex(x, y)] === 1;
    for (const [x, y] of data.food) sim.food.add({ x, y, wet: wet(x, y) });
    sim.carcasses.clear();
    carcassQueue = data.carcasses.map(([x, y, tick]) => ({ x, y, tick, eaten: false, wet: wet(x, y) }));
    for (const carcass of carcassQueue) sim.carcasses.add(carcass);
    carcassQueue.sort((a, b) => a.tick - b.tick);
  }

  // ---------- Species ----------

  // Species fight each other, except a species and the one it split from.
  function isHostile(a, b) {
    return a !== b && sim.species[a].parent !== b && sim.species[b].parent !== a;
  }

  // The chain of species ids from a founder down to `id`.
  function lineage(id) {
    const chain = [];
    for (let s = id; s !== null; s = sim.species[s].parent) chain.unshift(s);
    return chain;
  }

  // Decides which species a newborn belongs to. Usually its parent's; but a
  // child that has drifted too far from that species' founder joins a closely
  // related species it does resemble, or else founds a new one.
  function assignSpecies(child) {
    const home = sim.species[child.species];
    if (traitDistance(child, home.origin) <= P.speciationDistance) return;

    let best = null, bestDistance = P.speciationDistance;
    for (const other of sim.species) {
      if (other === home || other.count === 0) continue;
      const related = other.parent === home.id || home.parent === other.id
        || (other.parent !== null && other.parent === home.parent);
      if (!related) continue;
      const distance = traitDistance(child, other.origin);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = other;
      }
    }
    if (best) {
      child.species = best.id;
      return;
    }
    if (livingSpecies >= RULES.maxLivingSpecies) return;

    const origin = traitsOf(child);
    const id = sim.species.length;
    sim.species.push({
      id,
      name: nameSpecies(origin, random, new Set(sim.species.filter((s) => s.count || s.established).map((s) => s.name))),
      color: colorForSpecies(id, sim.species.filter((s) => s.count > 0).map((s) => s.color)),
      parent: home.id,
      bornTick: sim.tick,
      extinctTick: null,
      established: false,
      count: 1, // the newborn itself, so siblings born this tick can join
      kills: 0,
      origin,
      lastTrendCount: 0,
    });
    livingSpecies++;
    child.species = id;
  }

  // Updates each species' head count and logs what changed: a new species
  // taking hold, an extinction, a boom or a crash.
  function countSpecies() {
    for (const sp of sim.species) sp.count = 0;
    for (const c of sim.creatures) sim.species[c.species].count++;

    const trendCheck = sim.tick > 0 && sim.tick % RULES.trendCheckEvery === 0;
    livingSpecies = 0;
    for (const sp of sim.species) {
      if (sp.extinctTick !== null) continue;
      if (sp.count === 0) {
        sp.extinctTick = sim.tick;
        if (sp.established) logEvent('extinct', sp.name + ' died out', sp.id);
        continue;
      }
      livingSpecies++;
      if (!sp.established && sp.count >= RULES.establishedAt) {
        sp.established = true;
        sp.lastTrendCount = sp.count;
        logEvent('species', sp.name + ' split from ' + sim.species[sp.parent].name, sp.id);
      }
      if (trendCheck && sp.established) {
        const before = sp.lastTrendCount, now = sp.count;
        if (now >= before * RULES.trendFactor && now - before >= RULES.trendMinChange) {
          logEvent('boom', sp.name + ' boomed from ' + before + ' to ' + now, sp.id);
        } else if (now <= before / RULES.trendFactor && before - now >= RULES.trendMinChange) {
          logEvent('crash', sp.name + ' crashed from ' + before + ' to ' + now, sp.id);
        }
        sp.lastTrendCount = now;
      }
    }
  }

  // ---------- A creature's turn ----------

  // Points a thirsty creature at the neighbouring cell closest to water.
  function headTowardWater(c, cell) {
    const gx = cell % GRID_W, gy = (cell / GRID_W) | 0;
    let best = sim.waterDistance[cell], bestX = 0, bestY = 0;
    for (let ay = -1; ay <= 1; ay++) {
      for (let ax = -1; ax <= 1; ax++) {
        const ny = gy + ay;
        if (ny < 0 || ny >= GRID_H) continue;
        const d = sim.waterDistance[ny * GRID_W + (gx + ax + GRID_W) % GRID_W];
        if (d < best) {
          best = d;
          bestX = ax;
          bestY = ay;
        }
      }
    }
    if (bestX || bestY) c.heading = Math.atan2(bestY, bestX);
  }

  // Points a creature toward whichever nearby spot is closest to its preferred temperature.
  function headTowardComfort(c) {
    let best = 1e9;
    for (const [ax, ay] of TEMP_PROBES) {
      const probe = cellIndex((c.x + ax + WIDTH) % WIDTH, clamp(c.y + ay, 0, HEIGHT - 1));
      const gap = Math.abs(sim.temperature[probe] - c.preferredTemp);
      if (gap < best) {
        best = gap;
        c.heading = Math.atan2(ay, ax);
      }
    }
  }

  const onDryLand = (item) => !item.wet;

  // Points a creature that is in the water but cannot swim at the nearest dry
  // land, searching outward a ring of cells at a time.
  function headTowardLand(c, cell) {
    const gx = cell % GRID_W, gy = (cell / GRID_W) | 0;
    for (let ring = 1; ring <= 10; ring++) {
      for (let ay = -ring; ay <= ring; ay++) {
        const ny = gy + ay;
        if (ny < 0 || ny >= GRID_H) continue;
        // Only the cells on the edge of the ring are new.
        const stride = Math.abs(ay) === ring ? 1 : 2 * ring;
        for (let ax = -ring; ax <= ring; ax += stride) {
          if (sim.blocked[ny * GRID_W + (gx + ax + GRID_W) % GRID_W]) continue;
          c.heading = Math.atan2(ay, ax);
          return true;
        }
      }
    }
    return false;
  }

  // Whether a creature standing in cell `from` may step into cell `to`.
  // A creature that finds itself somewhere it could not have walked to (born
  // to a swimming parent in mid-lake, or painted over) is allowed to leave.
  function canEnter(c, from, to) {
    if (sim.terrain[to] === MOUNTAIN) return sim.terrain[from] === MOUNTAIN;
    if (sim.water[to]) return c.swimmer || sim.water[from] === 1;
    return true;
  }

  // Moves a creature one step in `heading` if nothing is in the way.
  function stepAlong(c, cell, heading, distance) {
    const nx = (c.x + Math.cos(heading) * distance + WIDTH) % WIDTH;
    const ny = c.y + Math.sin(heading) * distance;
    if (ny < 0 || ny >= HEIGHT || !canEnter(c, cell, cellIndex(nx, ny))) return false;
    const oldX = c.x, oldY = c.y;
    c.x = nx;
    c.y = ny;
    creatureGrid.move(c, oldX, oldY);
    return true;
  }

  // Fight, decide where to go, move, pay upkeep, breed.
  function act(c, born, mutationRate) {
    const cell = cellIndex(c.x, c.y);
    const temp = sim.temperature[cell];
    const stress = Math.max(0, Math.abs(temp - c.preferredTemp) - P.tempTolerance);

    // What can it see? (Sight does not cross the east-west wrap.)
    const visionSq = c.vision * c.vision;
    const distSqTo = (o) => (o.x - c.x) * (o.x - c.x) + (o.y - c.y) * (o.y - c.y);
    const enemy = creatureGrid.nearest(c.x, c.y, visionSq, (o) => o.energy > 0 && isHostile(c.species, o.species));
    const enemyDistSq = enemy ? distSqTo(enemy) : visionSq;

    // The best meal in sight: a plant or a carcass, weighing what this
    // creature's diet gets out of it against how far away it is.
    const plantWorth = RULES.foodEnergy * (1 - c.diet);
    const meatWorth = RULES.carcassEnergy * c.diet;
    // Only swimmers go for what is lying in water; the rest would just pace the shore.
    const reachable = c.swimmer ? undefined : onDryLand;
    const plant = plantWorth > 0 ? sim.food.nearest(c.x, c.y, visionSq, reachable) : null;
    const carcass = meatWorth > 0 ? sim.carcasses.nearest(c.x, c.y, visionSq, reachable) : null;
    const appeal = (item, worth) => (item ? worth / (Math.sqrt(distSqTo(item)) + 20) : 0);
    const meal = appeal(carcass, meatWorth) > appeal(plant, plantWorth) ? carcass : plant;
    const mealDistSq = meal ? distSqTo(meal) : visionSq;

    // Fight any enemy within reach. Meat-eaters bite harder; everyone hits
    // weaker outside their climate.
    if (enemy && enemyDistSq < RULES.attackRangeSq) {
      enemy.energy -= P.combatDamage * c.strength * (1 + P.dietDamageBonus * c.diet)
        * (stress > 0 ? P.awayDamageFactor : 1);
      if (enemy.energy <= 0) sim.species[c.species].kills++;
    }

    if (c.hydration < RULES.thirstyBelow) c.thirsty = true;
    if (c.hydration >= RULES.quenchedAt) c.thirsty = false;

    // Decide where to go. The first rule that applies wins. While on a detour
    // round an obstacle the creature still eats and drinks what it reaches,
    // but keeps its course rather than turning back toward what it was after.
    const course = c.heading;
    const swimming = sim.water[cell] === 1;
    let move = c.speed * (swimming ? RULES.swimSpeedFactor : 1);
    const mustFlee = enemy
      && enemy.strength > c.strength * RULES.fleeStrengthRatio
      && enemyDistSq < P.fleeDistance * P.fleeDistance;
    // The more meat in its diet, the less hungry a creature needs to be to hunt.
    const canHunt = enemy
      && enemy.strength < c.strength * RULES.huntStrengthRatio
      && c.energy < P.huntEnergy * 2 * c.diet
      && (!meal || enemyDistSq < mealDistSq);

    if (swimming && !c.swimmer && headTowardLand(c, cell)) {
      // Out of its depth: make for the shore before anything else.
    } else if (mustFlee) {
      c.heading = Math.atan2(c.y - enemy.y, c.x - enemy.x);
    } else if (c.thirsty) {
      if (sim.waterDistance[cell] <= 1) {
        c.hydration += RULES.drinkRate; // at the shore: stand still and drink
        move = 0;
      } else {
        headTowardWater(c, cell);
      }
    } else if (canHunt) {
      c.heading = Math.atan2(enemy.y - c.y, enemy.x - c.x);
    } else if (meal) {
      c.heading = Math.atan2(meal.y - c.y, meal.x - c.x);
      if (mealDistSq < Math.max(RULES.minEatRangeSq, c.speed * c.speed)) {
        if (meal === carcass) {
          sim.carcasses.remove(meal);
          meal.eaten = true;
          c.energy += meatWorth;
        } else {
          sim.food.remove(meal);
          c.energy += plantWorth;
        }
        // Got what it was after: no need to keep working round anything.
        c.blocked = 0;
        c.slide = null;
        c.detour = 0;
      }
    } else if (stress > 0) {
      headTowardComfort(c);
    } else {
      c.heading += (random() - 0.5) * 0.5; // wander
    }

    if (c.detour > 0) {
      c.detour--;
      c.heading = course;
    }

    // Move. Mountains, the north and south edges and (unless it can swim)
    // water are in the way; a blocked creature slides along the obstacle.
    if (move) {
      let moved = stepAlong(c, cell, c.heading, move);
      if (!moved) {
        // Take the gentlest turn that is open. If it is already working its
        // way along this obstacle, try the side it was going first, so it
        // follows the edge round instead of doubling back.
        const side = c.slide === null ? (random() < 0.5 ? 1 : -1) : Math.sin(c.slide - c.heading) >= 0 ? 1 : -1;
        search: for (const way of [side, -side]) {
          for (const turn of SLIDE_TURNS) {
            const heading = c.heading + way * turn;
            if (!stepAlong(c, cell, heading, move)) continue;
            c.heading = heading;
            c.slide = heading;
            moved = true;
            break search;
          }
        }
        // Hold the new course for a while, longer each time it happens again.
        c.blocked = Math.min(RULES.maxDetourRepeats, c.blocked + 1);
        c.detour = RULES.detourTicks * c.blocked + Math.floor(random() * RULES.detourTicks);
        if (!moved) c.heading += 1.5 + random(); // boxed in: turn and try again next tick
      }
    }
    // Being blocked is forgotten bit by bit.
    if (c.blocked && c.age % RULES.detourForgetTicks === 0 && --c.blocked === 0) c.slide = null;

    // Upkeep: being fast, sharp-eyed, strong or out of your climate all cost energy.
    c.energy -= 0.08 + 0.035 * c.speed * c.speed + 0.0025 * c.vision
      + P.strengthUpkeep * c.strength * c.strength + P.stressCost * stress
      + (swimming ? RULES.swimCost : 0);
    c.hydration -= RULES.thirstRate * (1 + Math.max(0, temp - RULES.hotAbove) / 12)
      * (inDrought() ? RULES.droughtThirstFactor : 1);
    c.age++;

    // Well-fed, comfortable creatures split in two.
    const roomLeft = sim.creatures.length + born.length < RULES.maxCreatures;
    if (c.energy > RULES.breedEnergy && stress <= P.maxBreedingStress && roomLeft) {
      c.energy /= 2;
      c.offspring++;
      const child = makeOffspring(nextCreatureId++, c, sim.tick, mutationRate, P, random);
      assignSpecies(child);
      born.push(child);
    }
  }

  // ---------- The tick ----------

  // Advances the world by one tick.
  //   foodRate:     the food supply slider (about 0.3 to 2)
  //   mutationRate: how much offspring traits vary (0 to 1)
  function step(foodRate, mutationRate) {
    for (const front of sim.fronts) {
      front.x = (front.x + front.vx + WIDTH) % WIDTH;
      front.y = (front.y + front.vy + HEIGHT) % HEIGHT;
    }
    sim.temperatureBoost *= RULES.boostDecay;
    if (sim.tick % 10 === 0) {
      for (let i = 0; i < sim.tempOffset.length; i++) sim.tempOffset[i] *= RULES.tempOffsetDecay;
      refreshTemperature();
    }
    if (sim.droughtUntil && sim.tick === sim.droughtUntil) logEvent('drought', 'The drought ended');

    maybeRandomDisaster();
    growFood(foodRate);
    rotCarcasses();

    creatureGrid.clear();
    for (const c of sim.creatures) creatureGrid.add(c);

    const born = [];
    for (const c of sim.creatures) {
      if (c.energy <= 0) continue; // killed earlier this tick
      act(c, born, mutationRate);
    }

    // The dead leave carcasses; the newborn join in.
    const survivors = [];
    for (const c of sim.creatures) {
      if (c.energy > 0 && c.hydration > 0 && c.age < RULES.maxAge) {
        survivors.push(c);
      } else {
        const carcass = { x: c.x, y: c.y, tick: sim.tick, eaten: false, wet: sim.water[cellIndex(c.x, c.y)] === 1 };
        sim.carcasses.add(carcass);
        carcassQueue.push(carcass);
      }
    }
    sim.creatures = survivors.concat(born);
    sim.tick++;
    countSpecies();
  }

  // Average traits, share of swimmers and highest generation for every species, indexed like
  // sim.species. (Head counts and kills are on the species records.)
  function stats() {
    const out = sim.species.map(() => ({ speed: 0, vision: 0, strength: 0, preferredTemp: 0, diet: 0, swimmers: 0, maxGeneration: 0 }));
    for (const c of sim.creatures) {
      const s = out[c.species];
      for (const trait of TRAITS) s[trait] += c[trait];
      if (c.swimmer) s.swimmers++;
      if (c.generation > s.maxGeneration) s.maxGeneration = c.generation;
    }
    out.forEach((s, id) => {
      const n = sim.species[id].count || 1;
      for (const trait of TRAITS) s[trait] /= n;
      s.swimmers /= n; // the share of the species that can swim
    });
    return out;
  }

  return sim;
}
