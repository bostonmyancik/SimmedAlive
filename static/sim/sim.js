// The simulation itself: world generation and the per-tick rules.
// Nothing here touches the page, so it runs in the browser and under Node.

import { SPECIES, DEFAULT_PARAMS, RULES } from './params.js';
import { mulberry32 } from './rng.js';
import { SpatialGrid } from './grid.js';
import { spawnCreature, makeOffspring, breedEnergy } from './creatures.js';
import { TRAITS, traitDistance, traitsOf, nameSpecies, colorForSpecies, normalizeFounders } from './species.js';
import { pack, unpack } from './pack.js';
import { ABILITIES, ABILITY_NAMES, inheritAbility, abilityPower } from './abilities.js';
import {
  GRID_W, GRID_H, CELL, WIDTH, HEIGHT, PLAIN, FERTILE, DESERT, MOUNTAIN,
  cellIndex, wrapDistance, daylightAt, generateLakes, generateMountains, classifyLand, computeWaterDistance, updateTemperature,
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
  'ability', 'cooldown', 'frozen', 'dashing', 'sick', 'immune', 'nightEyes',
];

// How the event log describes a species changing, trait by trait: [more, less].
const CHANGE_WORDS = {
  speed: ['faster', 'slower'],
  vision: ['sharper-eyed', 'shorter-sighted'],
  strength: ['stronger', 'weaker'],
  preferredTemp: ['suited to warmer weather', 'suited to colder weather'],
  diet: ['more meat-eating', 'more plant-eating'],
};

// How the event log names an ability a species has taken up.
const ABILITY_PHRASES = {
  camouflage: 'camouflage',
  dash: 'a burst of speed',
  spit: 'spitting',
  freeze: 'the power to freeze',
  pull: 'a grabbing tongue',
};

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
    // { id, name, color, parent, bornTick, extinctTick, established, count, kills,
    //   origin, stage, stageOrigin, abilities }
    // `origin` is the species' typical traits, which shift as it evolves;
    // `stage` counts how many times it has changed enough to be called a new
    // stage, and `stageOrigin` is where it stood at the start of this one.
    // `abilities` lists the abilities most of its members have.
    species: [],
    // The species a new world starts with. Change them with setFounders().
    founders: normalizeFounders(SPECIES, SPECIES[0]),
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
    projectiles: [],     // spit in flight: { x, y, vx, vy, species, damage, ticks }
    effects: [],         // recent ability flashes, for drawing only: { kind, tick, x, y, ... }
    fronts: [],
    events: [],          // the event log: { tick, kind, species, text }
    tick: 0,
    temperatureBoost: 0, // degrees added everywhere; fades over time
    droughtUntil: 0,     // a drought is on while tick < droughtUntil
    generate,
    populate,
    setFounders,
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
    fillTerrain,
    paintTemperature,
    save,
    load,
    watch,
    // Record holders for the hall of fame. See freshRecords().
    records: freshRecords(),
    // The life story of the creature being watched (see watch()), or null.
    biography: null,
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

  // Sets the species that new worlds start with: a list of
  // { name, color, startCount, speed, vision, strength, preferredTemp, diet }.
  // Values out of range are brought into it. An empty list restores the originals.
  function setFounders(list) {
    const tidy = normalizeFounders(Array.isArray(list) ? list : [], SPECIES[1]);
    sim.founders = tidy.length ? tidy : normalizeFounders(SPECIES, SPECIES[0]);
  }

  // Builds a fresh world. Pass a new seed, or omit it to rebuild the same one.
  //   map:      'random' builds lakes, mountains and land from the seed;
  //             'blank' is open plain with no water, ready to be painted;
  //             'keep' leaves the terrain as it is.
  //   populate: false leaves the world empty until populate() is called, so
  //             the map can be painted first.
  //   lakes:    how many lakes a random map has (RULES.lakeCount by default)
  function generate(newSeed = sim.seed, { map = 'random', populate: populateNow = true, lakes = RULES.lakeCount } = {}) {
    sim.seed = newSeed;
    random = mulberry32(newSeed);
    nextCreatureId = 1;
    sim.food.clear();
    sim.carcasses.clear();
    carcassQueue = [];
    sim.creatures = [];
    sim.projectiles = [];
    sim.effects = [];
    sim.events = [];
    sim.tick = 0;
    sim.temperatureBoost = 0;
    sim.droughtUntil = 0;
    sim.tempOffset.fill(0);
    sim.records = freshRecords();
    sim.biography = null;

    if (map === 'blank') {
      sim.water.fill(0);
      sim.terrain.fill(PLAIN);
      computeWaterDistance(sim.water, sim.terrain, sim.waterDistance);
    } else if (map !== 'keep') {
      generateLakes(sim.water, random, lakes);
      generateMountains(sim.terrain, sim.water, random);
      computeWaterDistance(sim.water, sim.terrain, sim.waterDistance);
      classifyLand(sim.terrain, sim.water, sim.waterDistance, random);
    }
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

    sim.species = [];
    if (populateNow) populate();
  }

  // Puts the founding species and the first plants into a world that has none
  // yet. Returns false, changing nothing, if there is no land with a way to
  // water for them to live on, or if the world is already populated.
  function populate() {
    if (sim.species.length) return false;
    const livable = [];
    for (let cell = 0; cell < sim.blocked.length; cell++) if (habitable(cell)) livable.push(cell);
    if (!livable.length) return false;

    sim.species = sim.founders.map((founder, id) => ({
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
      stage: 1,
      stageOrigin: traitsOf(founder),
      abilities: [],
      swims: P.swimmerShare >= RULES.swimSpreadAt,
      nocturnal: founder.diet > 0.5,
      lastTrendCount: founder.startCount,
    }));

    // Each founding species starts in the latitude band that suits its climate.
    // If that band has nowhere to live (on a hand-made map, say), anywhere livable will do.
    sim.founders.forEach((founder, id) => {
      const latitude = clamp(((founder.preferredTemp - RULES.baseTemp) / P.tempGradient + 1) / 2, 0.16, 0.84);
      for (let i = 0; i < founder.startCount; i++) {
        let x, y, tries = 0;
        do {
          x = random() * WIDTH;
          y = clamp((latitude + (random() - 0.5) * 0.26) * HEIGHT, 0, HEIGHT - 1);
        } while (!habitable(cellIndex(x, y)) && tries++ < 50);
        if (!habitable(cellIndex(x, y))) {
          const cell = livable[Math.floor(random() * livable.length)];
          x = (cell % GRID_W + random()) * CELL;
          y = (Math.floor(cell / GRID_W) + random()) * CELL;
        }
        sim.creatures.push(spawnCreature(nextCreatureId++, id, founder, x, y, P.swimmerShare, random));
      }
    });
    countSpecies();

    for (let i = 0; i < RULES.startFood; i++) {
      const x = random() * WIDTH, y = random() * HEIGHT;
      addFood(x, y);
    }
    return true;
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
    const plants = P.plantSeeding > 0 ? [...sim.food] : [];
    while (budget > 0) {
      if (random() < budget && sim.food.size < RULES.maxFood) {
        let x = random() * WIDTH, y = random() * HEIGHT;
        // Some seedlings sprout beside a plant that is already growing, so
        // plants spread out from where they are and grazed-bare land is slow to recover.
        if (plants.length && random() < P.plantSeeding) {
          const parent = plants[Math.floor(random() * plants.length)];
          const angle = random() * 6.283, distance = random() * RULES.seedRange;
          x = (parent.x + Math.cos(angle) * distance + WIDTH) % WIDTH;
          y = clamp(parent.y + Math.sin(angle) * distance, 0, HEIGHT - 1);
        }
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

  // Paints the whole connected area of the same terrain as the cell at (x, y),
  // like a paint bucket. Returns how many cells changed.
  function fillTerrain(x, y, kind) {
    if (kind !== 'water' && !(kind in PAINT_KINDS)) throw new Error('Unknown terrain: ' + kind);
    const start = cellIndex(x, y);
    const isWater = sim.water[start], land = sim.terrain[start];
    const same = (cell) => sim.water[cell] === isWater && (isWater || sim.terrain[cell] === land);
    const newWater = kind === 'water' ? 1 : 0, newLand = kind === 'water' ? PLAIN : PAINT_KINDS[kind];
    if (isWater === newWater && (isWater || land === newLand)) return 0;
    const seen = new Uint8Array(sim.water.length);
    const queue = [start];
    seen[start] = 1;
    let changed = 0;
    while (queue.length) {
      const cell = queue.pop();
      sim.water[cell] = newWater;
      sim.terrain[cell] = newLand;
      changed++;
      const gx = cell % GRID_W, gy = (cell / GRID_W) | 0;
      const next = [gy * GRID_W + (gx + 1) % GRID_W, gy * GRID_W + (gx - 1 + GRID_W) % GRID_W];
      if (gy > 0) next.push(cell - GRID_W);
      if (gy < GRID_H - 1) next.push(cell + GRID_W);
      for (const n of next) {
        if (seen[n] || !same(n)) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    terrainChanged();
    return changed;
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
    const target = sim.species.reduce((a, b) => (!a || b.count > a.count ? b : a), null);
    if (!target || !target.count) return 0;
    let died = 0;
    for (const c of sim.creatures) {
      if (c.species === target.id && c.energy > 0 && random() < RULES.plagueDeathRate) {
        c.energy = 0; // removed, leaving a carcass, at the end of the next tick
        if (watched(c)) sim.biography.cause = 'Killed by a plague';
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
        if (watched(c)) sim.biography.cause = 'Killed by a meteor';
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

  // ---------- Hall of fame ----------

  // Each record names who holds it: { value, tick, name, color } where name
  // and colour are its species'. `births` and `deaths` are plain totals.
  function freshRecords() {
    return { births: 0, deaths: 0, peakPopulation: null, peakSpecies: null, mostOffspring: null, highestGeneration: null };
  }

  // Takes a record if `value` beats it.
  function beat(key, value, speciesId) {
    const held = sim.records[key];
    if (held && held.value >= value) return;
    const sp = speciesId === null ? null : sim.species[speciesId];
    sim.records[key] = { value, tick: sim.tick, name: sp ? sp.name : null, color: sp ? sp.color : null };
  }

  // Checks a creature against the records about individual creatures.
  function creatureRecords(c) {
    beat('mostOffspring', c.offspring, c.species);
    beat('highestGeneration', c.generation, c.species);
  }

  // ---------- Life story ----------

  // Starts (or with null, stops) keeping a life story of one creature from
  // now on. The story is { id, since, entries: [{ tick, text }], counts }.
  function watch(id) {
    sim.biography = id === null || id === undefined ? null : {
      id, since: sim.tick, entries: [], cause: null, fleeing: false, migrating: false,
      counts: { plants: 0, carcasses: 0, kills: 0, young: 0, abilityUses: 0 },
    };
  }

  const watched = (c) => sim.biography !== null && c.id === sim.biography.id;

  function note(c, text) {
    if (!watched(c)) return;
    const entries = sim.biography.entries;
    entries.push({ tick: sim.tick, text });
    if (entries.length > RULES.maxBiography) entries.shift();
  }

  const aSpecies = (id) => {
    const name = sim.species[id].name;
    return (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name.replace(/s$/, '');
  };

  // A kill, from both sides. `how` is '' for a bite or ' with spit'.
  function noteKill(killerId, killerSpecies, victim, how) {
    if (sim.biography && sim.biography.id === killerId) {
      sim.biography.counts.kills++;
      sim.biography.entries.push({ tick: sim.tick, text: 'Killed ' + aSpecies(victim.species) + how });
    }
    if (watched(victim)) sim.biography.cause = 'Killed by ' + aSpecies(killerSpecies) + how;
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
      species: sim.species.map(copySpecies),
      creatures: sim.creatures.map((c) => CREATURE_FIELDS.map((field) => c[field])),
      projectiles: sim.projectiles.map((p) => ({ ...p })),
      food: [...sim.food].map((f) => [f.x, f.y]),
      carcasses: [...sim.carcasses].map((k) => [k.x, k.y, k.tick, k.species]),
      events: sim.events.map((e) => ({ ...e })),
      records: JSON.parse(JSON.stringify(sim.records)),
    };
  }

  // A deep copy of a species record. Saves from before species evolved lack
  // the stage and abilities, so they start at stage 1 with none.
  function copySpecies(sp) {
    return {
      ...sp,
      origin: { ...sp.origin },
      stage: sp.stage || 1,
      stageOrigin: { ...(sp.stageOrigin || sp.origin) },
      abilities: [...(sp.abilities || [])],
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
    sim.species = data.species.map(copySpecies);
    livingSpecies = sim.species.filter((sp) => sp.count > 0).length;
    sim.events = data.events.map((e) => ({ ...e }));
    sim.creatures = data.creatures.map((values) => {
      const c = {};
      CREATURE_FIELDS.forEach((field, i) => { c[field] = values[i]; });
      c.swimmer = !!c.swimmer; // saves from before swimming existed
      c.detour = c.detour || 0;
      c.blocked = c.blocked || 0;
      c.slide = c.slide ?? null;
      c.ability = c.ability ?? null; // saves from before abilities existed
      c.cooldown = c.cooldown || 0;
      c.frozen = c.frozen || 0;
      c.dashing = c.dashing || 0;
      c.sick = c.sick || 0; // saves from before sickness existed
      c.immune = c.immune || 0;
      c.nightEyes = !!c.nightEyes; // saves from before day and night
      return c;
    });
    sim.projectiles = (data.projectiles || []).map((p) => ({ ...p }));
    sim.effects = [];
    sim.records = { ...freshRecords(), ...JSON.parse(JSON.stringify(data.records || {})) }; // older saves start afresh
    sim.biography = null;

    sim.food.clear();
    const wet = (x, y) => sim.water[cellIndex(x, y)] === 1;
    for (const [x, y] of data.food) sim.food.add({ x, y, wet: wet(x, y) });
    sim.carcasses.clear();
    // Carcasses from older saves have no species, so anyone may eat them.
    carcassQueue = data.carcasses.map(([x, y, tick, species = null]) => ({ x, y, tick, species, eaten: false, wet: wet(x, y) }));
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
      stage: 1,
      stageOrigin: { ...origin },
      // An ability its parent species already had comes with it.
      abilities: child.ability && home.abilities.includes(child.ability) ? [child.ability] : [],
      swims: home.swims,
      nocturnal: home.nocturnal,
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
    beat('peakPopulation', sim.creatures.length, null);

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
      if (sp.established) beat('peakSpecies', sp.count, sp.id);
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

  // ---------- Evolution ----------

  // Each established species shifts part of the way toward the average of its
  // members, so the whole species changes as they do instead of only ever
  // splitting. Once it has changed far enough from where its current stage
  // began, it reaches a new stage, which also makes abilities likelier.
  function evolveSpecies() {
    const sums = sim.species.map(() => null);
    for (const c of sim.creatures) {
      let sum = sums[c.species];
      if (!sum) {
        sum = sums[c.species] = { n: 0 };
        for (const trait of TRAITS) sum[trait] = 0;
      }
      sum.n++;
      for (const trait of TRAITS) sum[trait] += c[trait];
    }
    for (const sp of sim.species) {
      const sum = sums[sp.id];
      if (!sum || !sp.established || sum.n < RULES.establishedAt) continue;
      for (const trait of TRAITS) sp.origin[trait] += (sum[trait] / sum.n - sp.origin[trait]) * P.evolveRate;
      if (traitDistance(sp.origin, sp.stageOrigin) < P.evolveStep) continue;
      sp.stage++;
      logEvent('evolve', sp.name + ' evolved to stage ' + sp.stage + ': ' + describeChange(sp.stageOrigin, sp.origin), sp.id);
      sp.stageOrigin = { ...sp.origin };
    }
  }

  // The biggest changes between two sets of traits, in words.
  function describeChange(before, after) {
    const changes = TRAITS
      .map((trait) => ({ trait, by: (after[trait] - before[trait]) / RULES.traitScales[trait] }))
      .filter((change) => Math.abs(change.by) >= 0.2)
      .sort((a, b) => Math.abs(b.by) - Math.abs(a.by))
      .slice(0, 3)
      .map(({ trait, by }) => CHANGE_WORDS[trait][by > 0 ? 0 : 1]);
    if (changes.length < 2) return changes[0] || 'changed a little in many ways';
    return changes.slice(0, -1).join(', ') + ' and ' + changes[changes.length - 1];
  }

  // Notes when an ability has spread through most of a species, or died out of it.
  // Also notes when a species takes to the water, or leaves it.
  function reviewAbilities() {
    for (const c of sim.creatures) creatureRecords(c);
    const held = sim.species.map(() => ({}));
    const swimmers = sim.species.map(() => 0);
    const nightEyed = sim.species.map(() => 0);
    for (const c of sim.creatures) {
      if (c.ability) held[c.species][c.ability] = (held[c.species][c.ability] || 0) + 1;
      if (c.swimmer) swimmers[c.species]++;
      if (c.nightEyes) nightEyed[c.species]++;
    }
    for (const sp of sim.species) {
      if (!sp.established || sp.count < RULES.establishedAt) continue;
      const nightShare = nightEyed[sp.id] / sp.count;
      if (sp.nocturnal === undefined) sp.nocturnal = nightShare >= RULES.swimSpreadAt; // older saves
      if (!sp.nocturnal && nightShare >= RULES.swimSpreadAt) {
        sp.nocturnal = true;
        logEvent('ability', sp.name + ' took to the night', sp.id);
      } else if (sp.nocturnal && nightShare < RULES.swimFadeAt) {
        sp.nocturnal = false;
        logEvent('ability', sp.name + ' went back to the daytime', sp.id);
      }
      const swimShare = swimmers[sp.id] / sp.count;
      if (sp.swims === undefined) sp.swims = swimShare >= RULES.swimSpreadAt; // older saves
      if (!sp.swims && swimShare >= RULES.swimSpreadAt) {
        sp.swims = true;
        logEvent('ability', sp.name + ' took to the water', sp.id);
      } else if (sp.swims && swimShare < RULES.swimFadeAt) {
        sp.swims = false;
        logEvent('ability', sp.name + ' gave up swimming', sp.id);
      }
      for (const name of ABILITIES) {
        const share = (held[sp.id][name] || 0) / sp.count;
        const has = sp.abilities.includes(name);
        if (!has && share >= RULES.abilitySpreadAt) {
          sp.abilities.push(name);
          logEvent('ability', sp.name + ' evolved ' + ABILITY_PHRASES[name], sp.id);
        } else if (has && share < RULES.abilityFadeAt) {
          sp.abilities.splice(sp.abilities.indexOf(name), 1);
          logEvent('ability', sp.name + ' lost ' + ABILITY_PHRASES[name], sp.id);
        }
      }
    }
  }

  // ---------- Abilities in use ----------

  // Whether creature `o` is hidden from a viewer `distSq` away from it.
  const hiddenFrom = (o, distSq) => P.abilities && o.ability === 'camouflage'
    && distSq > RULES.abilities.camouflage.seenWithin * RULES.abilities.camouflage.seenWithin;

  // Uses the creature's ability on `enemy` (the nearest one it can see) when
  // it is ready and the moment suits it. `fleeing` is true when it is running
  // away and `hunting` when it is going after the enemy.
  function useAbility(c, enemy, enemyDistSq, fleeing, hunting) {
    if (!P.abilities || !c.ability || c.cooldown > 0 || !enemy) return;
    const rule = RULES.abilities[c.ability];
    if (!rule.cost || c.energy < rule.cost + 10) return;
    const power = abilityPower(c.ability, c.strength);
    const outOfReach = enemyDistSq >= RULES.attackRangeSq;
    let used = false;

    if (c.ability === 'dash') {
      if (fleeing) {
        c.dashing = power.ticks;
        used = true;
      }
    } else if (c.ability === 'spit') {
      // Spit stings, holding the target still for a moment: worth it to catch prey or to get away.
      if ((fleeing || hunting) && outOfReach && enemyDistSq <= power.range * power.range) {
        const angle = Math.atan2(enemy.y - c.y, enemy.x - c.x);
        sim.projectiles.push({
          x: c.x, y: c.y,
          vx: Math.cos(angle) * rule.speedPx, vy: Math.sin(angle) * rule.speedPx,
          species: c.species, owner: c.id, damage: power.damage, stun: rule.stun,
          ticks: Math.ceil(power.range / rule.speedPx) + 2,
        });
        used = true;
      }
    } else if (c.ability === 'freeze') {
      // Kept for when it matters: running away, closing in, or already fighting.
      if (enemyDistSq <= power.radius * power.radius && (fleeing || hunting || !outOfReach)) {
        creatureGrid.forEachNear(c.x, c.y, power.radius, (o) => {
          if (o.energy > 0 && isHostile(c.species, o.species)) {
            o.frozen = Math.max(o.frozen || 0, power.ticks);
            note(o, 'Was frozen by ' + aSpecies(c.species));
          }
        });
        sim.effects.push({ kind: 'freeze', tick: sim.tick, x: c.x, y: c.y, radius: power.radius });
        used = true;
      }
    } else if (c.ability === 'pull') {
      if (!fleeing && outOfReach && enemyDistSq <= power.range * power.range && enemy.strength < c.strength) {
        // Drag the enemy to just in front of the puller, unless a mountain is in the way there.
        const distance = Math.sqrt(enemyDistSq);
        const x = (c.x + (enemy.x - c.x) / distance * 5 + WIDTH) % WIDTH;
        const y = clamp(c.y + (enemy.y - c.y) / distance * 5, 0, HEIGHT - 1);
        if (sim.terrain[cellIndex(x, y)] !== MOUNTAIN) {
          sim.effects.push({ kind: 'pull', tick: sim.tick, x: c.x, y: c.y, fromX: enemy.x, fromY: enemy.y });
          const oldX = enemy.x, oldY = enemy.y;
          enemy.x = x;
          enemy.y = y;
          creatureGrid.move(enemy, oldX, oldY);
          enemy.frozen = Math.max(enemy.frozen || 0, power.hold);
          note(enemy, 'Was dragged in by ' + aSpecies(c.species));
          used = true;
        }
      }
    }
    if (used) {
      c.cooldown = rule.cooldown;
      c.energy -= rule.cost;
      if (watched(c)) {
        if (!sim.biography.counts.abilityUses) note(c, 'Used its ' + ABILITY_NAMES[c.ability].toLowerCase() + ' for the first time while watched');
        sim.biography.counts.abilityUses++;
      }
    }
  }

  // Spit flies straight on and hits the first enemy of its species it reaches.
  function moveProjectiles() {
    const flying = [];
    for (const p of sim.projectiles) {
      let hit = null;
      for (let half = 0; half < 2 && !hit; half++) {
        p.x = (p.x + p.vx / 2 + WIDTH) % WIDTH;
        p.y += p.vy / 2;
        hit = creatureGrid.nearest(p.x, p.y, 16, (o) => o.energy > 0 && isHostile(p.species, o.species));
      }
      p.ticks--;
      if (hit) {
        hit.energy -= p.damage;
        hit.frozen = Math.max(hit.frozen || 0, p.stun || 0);
        if (hit.energy <= 0) {
          sim.species[p.species].kills++;
          noteKill(p.owner, p.species, hit, ' with spit');
        } else {
          note(hit, 'Was hit by spit from ' + aSpecies(p.species));
        }
        sim.effects.push({ kind: 'hit', tick: sim.tick, x: p.x, y: p.y });
      } else if (p.ticks > 0 && p.y >= 0 && p.y < HEIGHT) {
        flying.push(p);
      }
    }
    sim.projectiles = flying;
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

  // Points a creature toward whichever nearby spot is closest to its preferred
  // temperature. Migrating, it also looks much further north and south.
  function headTowardComfort(c, migrating = false) {
    let best = 1e9;
    const far = RULES.migrateProbe;
    for (const [ax, ay] of migrating ? [...TEMP_PROBES, [0, far], [0, -far]] : TEMP_PROBES) {
      const probe = cellIndex((c.x + ax + WIDTH) % WIDTH, clamp(c.y + ay, 0, HEIGHT - 1));
      const gap = Math.abs(sim.temperature[probe] - c.preferredTemp);
      if (gap < best) {
        best = gap;
        c.heading = Math.atan2(ay, ax);
      }
    }
  }

  // Turns an idle creature part of the way toward the nearest member of its
  // species it can see, unless they are already close, so herds and packs form.
  function herd(c, visionSq) {
    const spacingSq = RULES.herdSpacing * RULES.herdSpacing;
    const mate = creatureGrid.nearest(c.x, c.y, visionSq, (o) => o.species === c.species && o !== c
      && (o.x - c.x) * (o.x - c.x) + (o.y - c.y) * (o.y - c.y) > spacingSq);
    if (!mate) return;
    const toward = Math.atan2(mate.y - c.y, mate.x - c.x);
    const turn = Math.atan2(Math.sin(toward - c.heading), Math.cos(toward - c.heading));
    c.heading += turn * P.herding;
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

  // Share of a plant's or a carcass's energy a creature gets, from the share
  // of its diet that is that kind of food. Above 1, `dietSpecialization` makes
  // in-between diets digest both kinds less well, so specialists can compete.
  const digests = (share) => share ** P.dietSpecialization;

  // A sick creature passes it on to healthy members of its species close by,
  // and gets better after a while, then cannot catch it again for a time.
  // Now and then a healthy one falls sick by itself.
  function sickness(c) {
    const rule = RULES.sickness;
    if (c.immune > 0) c.immune--;
    if (c.sick > 0) {
      creatureGrid.forEachNear(c.x, c.y, rule.contactRange, (o) => {
        if (o.species === c.species && !o.sick && !o.immune && o.energy > 0 && random() < rule.spreadChance * P.sicknessBoost) {
          o.sick = rule.length;
          note(o, 'Caught a sickness from one of its own kind');
        }
      });
      if (--c.sick === 0) {
        c.immune = rule.immunity;
        note(c, 'Got over its sickness');
      }
    } else if (!c.immune && random() < rule.outbreakChance) {
      c.sick = rule.length;
      note(c, 'Fell sick');
    }
  }

  // Notes when sickness takes hold in a species, and when it has passed.
  function reviewSickness() {
    const sick = sim.species.map(() => 0);
    for (const c of sim.creatures) if (c.sick > 0) sick[c.species]++;
    for (const sp of sim.species) {
      if (!sp.outbreak && sp.established && sick[sp.id] >= RULES.sickness.noticeAt) {
        sp.outbreak = true;
        logEvent('sickness', 'A sickness is spreading among ' + sp.name, sp.id);
      } else if (sp.outbreak && sick[sp.id] === 0) {
        sp.outbreak = false;
        if (sp.count > 0) logEvent('sickness', 'The sickness among ' + sp.name + ' has passed', sp.id);
      }
    }
  }

  // How far a creature sees right now, as a share of its full sight.
  function sightFactor(c) {
    if (!P.dayNight) return 1;
    const light = daylightAt(sim.tick);
    return c.nightEyes
      ? 1 - (1 - RULES.nightEyesDaySight) * light
      : 1 - (1 - RULES.nightSight) * (1 - light);
  }

  // Upkeep: being fast, sharp-eyed, strong or out of your climate all cost
  // energy, and so does having an ability. Water runs low faster in the heat.
  function payUpkeep(c, stress, swimming, temp) {
    c.energy -= 0.08 + 0.035 * c.speed * c.speed + 0.0025 * c.vision
      + P.strengthUpkeep * c.strength * c.strength + P.stressCost * stress
      + (swimming ? RULES.swimCost : 0) + (c.ability ? RULES.abilityUpkeep : 0)
      + (c.sick > 0 ? RULES.sickness.cost : 0);
    c.hydration -= RULES.thirstRate * (1 + Math.max(0, temp - RULES.hotAbove) / 12)
      * (inDrought() ? RULES.droughtThirstFactor : 1);
    c.age++;
  }

  // Fight, decide where to go, move, pay upkeep, breed.
  function act(c, born, mutationRate) {
    const cell = cellIndex(c.x, c.y);
    const temp = sim.temperature[cell];
    const stress = Math.max(0, Math.abs(temp - c.preferredTemp) - P.tempTolerance);
    const swimming = sim.water[cell] === 1;
    if (c.cooldown > 0) c.cooldown--;
    if (P.disease) sickness(c);

    // Frozen (or held after a pull): it can do nothing but wait it out.
    if (c.frozen > 0) {
      c.frozen--;
      payUpkeep(c, stress, swimming, temp);
      return;
    }

    // What can it see? (Sight does not cross the east-west wrap.)
    const sight = c.vision * sightFactor(c);
    const visionSq = sight * sight;
    const distSqTo = (o) => (o.x - c.x) * (o.x - c.x) + (o.y - c.y) * (o.y - c.y);
    const enemy = creatureGrid.nearest(c.x, c.y, visionSq,
      (o) => o.energy > 0 && isHostile(c.species, o.species) && !hiddenFrom(o, distSqTo(o)));
    const enemyDistSq = enemy ? distSqTo(enemy) : visionSq;

    // The best meal in sight: a plant or a carcass, weighing what this
    // creature's diet gets out of it against how far away it is.
    const plantWorth = RULES.foodEnergy * digests(1 - c.diet);
    const meatWorth = RULES.carcassEnergy * digests(c.diet);
    // Only swimmers go for what is lying in water; the rest would just pace the shore.
    const reachable = c.swimmer ? undefined : onDryLand;
    const plant = plantWorth > 0 ? sim.food.nearest(c.x, c.y, visionSq, reachable) : null;
    // Nobody eats its own kind.
    const edible = (k) => k.species !== c.species && (c.swimmer || !k.wet);
    const carcass = meatWorth > 0 ? sim.carcasses.nearest(c.x, c.y, visionSq, edible) : null;
    const appeal = (item, worth) => (item ? worth / (Math.sqrt(distSqTo(item)) + 20) : 0);
    const meal = appeal(carcass, meatWorth) > appeal(plant, plantWorth) ? carcass : plant;
    const mealDistSq = meal ? distSqTo(meal) : visionSq;

    // Fight any enemy within reach. Meat-eaters bite harder; everyone hits
    // weaker outside their climate.
    if (enemy && enemyDistSq < RULES.attackRangeSq) {
      enemy.energy -= P.combatDamage * c.strength * (1 + P.dietDamageBonus * c.diet)
        * (stress > 0 ? P.awayDamageFactor : 1);
      if (enemy.energy <= 0) {
        sim.species[c.species].kills++;
        noteKill(c.id, c.species, enemy, '');
      }
    }

    if (c.hydration < RULES.thirstyBelow) c.thirsty = true;
    if (c.hydration >= RULES.quenchedAt) c.thirsty = false;

    // Decide where to go. The first rule that applies wins. While on a detour
    // round an obstacle the creature still eats and drinks what it reaches,
    // but keeps its course rather than turning back toward what it was after.
    const course = c.heading;
    // A heavier body is slower: above strength 1 each point costs a share of top speed.
    const pace = c.speed / (1 + P.sizeSlowdown * Math.max(0, c.strength - 1));
    let move = pace * (swimming ? RULES.swimSpeedFactor : c.swimmer ? P.swimmerLandPace : 1);
    const mustFlee = enemy
      && enemy.strength > c.strength * RULES.fleeStrengthRatio
      && enemyDistSq < P.fleeDistance * P.fleeDistance;
    // The more meat in its diet, the less hungry a creature needs to be to hunt.
    const canHunt = enemy
      && enemy.strength < c.strength * RULES.huntStrengthRatio
      && c.energy < P.huntEnergy * 2 * c.diet
      && (!meal || enemyDistSq < mealDistSq);

    useAbility(c, enemy, enemyDistSq, mustFlee, canHunt);
    if (c.dashing > 0) {
      c.dashing--;
      move *= RULES.abilities.dash.speed;
    }

    if (watched(c)) {
      const bio = sim.biography;
      if (mustFlee && !bio.fleeing) note(c, 'Ran from ' + aSpecies(enemy.species));
      bio.fleeing = !!mustFlee;
      const migrating = P.migration && stress > RULES.migrateAbove && !mustFlee && !c.thirsty && !canHunt;
      if (migrating && !bio.migrating) note(c, 'Set off to find ' + (temp < c.preferredTemp ? 'somewhere warmer' : 'somewhere cooler'));
      bio.migrating = migrating;
    }

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
    } else if (P.migration && stress > RULES.migrateAbove && !canHunt) {
      headTowardComfort(c, true); // far out of its climate: move on before stopping to feed
    } else if (canHunt) {
      c.heading = Math.atan2(enemy.y - c.y, enemy.x - c.x);
    } else if (meal) {
      c.heading = Math.atan2(meal.y - c.y, meal.x - c.x);
      if (mealDistSq < Math.max(RULES.minEatRangeSq, pace * pace)) {
        if (meal === carcass) {
          sim.carcasses.remove(meal);
          meal.eaten = true;
          c.energy += meatWorth;
          if (watched(c)) sim.biography.counts.carcasses++;
        } else {
          sim.food.remove(meal);
          c.energy += plantWorth;
          if (watched(c)) sim.biography.counts.plants++;
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
      // Only a well-fed creature keeps to its herd; a hungry one roams for food.
      // (Not on a mountain, where it may be stranded and should keep moving.)
      if (P.herding > 0 && c.energy > breedEnergy(c) * RULES.herdWhenFed && sim.terrain[cell] !== MOUNTAIN) herd(c, visionSq);
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

    payUpkeep(c, stress, swimming, temp);

    // Well-fed, comfortable creatures split in two. Bigger ones need more energy first.
    const roomLeft = sim.creatures.length + born.length < RULES.maxCreatures;
    if (c.energy > breedEnergy(c) && stress <= P.maxBreedingStress && roomLeft) {
      c.energy /= 2;
      c.offspring++;
      const child = makeOffspring(nextCreatureId++, c, sim.tick, mutationRate, P, random);
      const chance = P.abilities ? P.abilityChance * sim.species[c.species].stage : 0;
      if (inheritAbility(child, c, chance, random)) {
        logEvent('mutation', 'A newborn ' + sim.species[c.species].name + ' gained ' + ABILITY_NAMES[child.ability], c.species);
      }
      assignSpecies(child);
      born.push(child);
      sim.records.births++;
      beat('highestGeneration', child.generation, child.species);
      if (watched(c)) {
        sim.biography.counts.young++;
        note(c, child.species === c.species ? 'Had young' : 'Had young that founded or joined ' + sim.species[child.species].name);
      }
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
    moveProjectiles();

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
        sim.records.deaths++;
        creatureRecords(c);
        if (watched(c)) {
          const bio = sim.biography;
          note(c, bio.cause || (c.age >= RULES.maxAge ? 'Died of old age' : c.hydration <= 0 ? 'Died of thirst' : 'Starved'));
        }
        const carcass = { x: c.x, y: c.y, tick: sim.tick, species: c.species, eaten: false, wet: sim.water[cellIndex(c.x, c.y)] === 1 };
        sim.carcasses.add(carcass);
        carcassQueue.push(carcass);
      }
    }
    sim.creatures = survivors.concat(born);
    sim.tick++;
    countSpecies();
    if (sim.tick % P.evolveEvery === 0) evolveSpecies();
    if (sim.tick % RULES.abilityReviewEvery === 0) reviewAbilities();
    if (sim.tick % RULES.sicknessReviewEvery === 0) reviewSickness();
    sim.effects = sim.effects.filter((e) => sim.tick - e.tick < RULES.effectTicks);
  }

  // Average traits, share of swimmers and of each ability, and highest generation for every species, indexed like
  // sim.species. (Head counts and kills are on the species records.)
  function stats() {
    const out = sim.species.map(() => ({ speed: 0, vision: 0, strength: 0, preferredTemp: 0, diet: 0, swimmers: 0, nightEyes: 0, sick: 0, maxGeneration: 0, abilities: {} }));
    for (const c of sim.creatures) {
      const s = out[c.species];
      for (const trait of TRAITS) s[trait] += c[trait];
      if (c.swimmer) s.swimmers++;
      if (c.nightEyes) s.nightEyes++;
      if (c.sick > 0) s.sick++;
      if (c.ability) s.abilities[c.ability] = (s.abilities[c.ability] || 0) + 1;
      if (c.generation > s.maxGeneration) s.maxGeneration = c.generation;
    }
    out.forEach((s, id) => {
      const n = sim.species[id].count || 1;
      for (const trait of TRAITS) s[trait] /= n;
      s.swimmers /= n; // the share of the species that can swim
      s.nightEyes /= n; // ...that has night eyes
      s.sick /= n;      // ...and that is sick
      for (const name in s.abilities) s.abilities[name] /= n; // the share with each ability
    });
    return out;
  }

  return sim;
}
