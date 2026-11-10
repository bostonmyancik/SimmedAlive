// The simulation itself: world generation and the per-tick rules.
// Nothing here touches the page, so it runs in the browser and under Node.

import { SPECIES, DEFAULT_PARAMS, RULES } from './params.js';
import { mulberry32 } from './rng.js';
import { SpatialGrid } from './grid.js';
import { spawnCreature, makeOffspring } from './creatures.js';
import { TRAITS, traitDistance, traitsOf, nameSpecies, colorForSpecies } from './species.js';
import {
  GRID_W, GRID_H, WIDTH, HEIGHT, PLAIN, FERTILE, DESERT, MOUNTAIN,
  cellIndex, generateLakes, generateMountains, classifyLand, computeWaterDistance, updateTemperature,
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
    food: new SpatialGrid(WIDTH, HEIGHT, BUCKET_SIZE),     // plants: { x, y }
    carcasses: new SpatialGrid(WIDTH, HEIGHT, BUCKET_SIZE), // meat: { x, y, tick }
    creatures: [],
    fronts: [],
    events: [],          // the event log: { tick, kind, species, text }
    tick: 0,
    temperatureBoost: 0, // degrees added everywhere; fades over time
    generate,
    step,
    stats,
    addFood,
    fertility,
    isHostile,
    lineage,
    heatWave: () => weather(9, 'heat', 'Heat wave'),
    coldSnap: () => weather(-9, 'cold', 'Cold snap'),
  };

  // Rebuilt at the start of every tick to find nearby enemies quickly.
  const creatureGrid = new SpatialGrid(WIDTH, HEIGHT, BUCKET_SIZE);
  let carcassQueue = []; // carcasses in the order they appeared, for rotting
  let livingSpecies = 0;

  function refreshTemperature() {
    updateTemperature(sim.temperature, sim.fronts, sim.tick, sim.temperatureBoost, P);
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

    generateLakes(sim.water, random);
    generateMountains(sim.terrain, sim.water, random);
    computeWaterDistance(sim.water, sim.terrain, sim.waterDistance);
    classifyLand(sim.terrain, sim.water, sim.waterDistance, random);
    for (let i = 0; i < sim.blocked.length; i++) sim.blocked[i] = sim.water[i] || sim.terrain[i] === MOUNTAIN ? 1 : 0;

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
        sim.creatures.push(spawnCreature(nextCreatureId++, id, founder, x, y, random));
      }
    });
    countSpecies();

    for (let i = 0; i < RULES.startFood; i++) {
      const x = random() * WIDTH, y = random() * HEIGHT;
      addFood(x, y);
    }
  }

  // Land a creature can stand on and walk to water from.
  function habitable(cell) {
    return !sim.blocked[cell] && sim.waterDistance[cell] < 1e8;
  }

  // ---------- Food ----------

  // Places a plant unless the spot is water or mountain. Returns whether it landed.
  function addFood(x, y) {
    if (sim.blocked[cellIndex(x, y)]) return false;
    sim.food.add({ x, y });
    return true;
  }

  // Chance (0 to 1) that a plant sprouting in a cell takes hold: best on
  // fertile land near water, poor in desert and in extreme cold or heat.
  function fertility(cell) {
    if (sim.blocked[cell]) return 0;
    const temp = sim.temperature[cell];
    const nearWater = 0.2 + 0.8 * Math.exp(-sim.waterDistance[cell] / 5);
    const climate = temp < -4 || temp > 40 ? 0.15 : 1;
    return Math.min(1, TERRAIN_FERTILITY[sim.terrain[cell]] * nearWater * climate);
  }

  // Plants sprout at random spots, subject to how fertile the land is there.
  function growFood(foodRate) {
    let budget = foodRate * P.foodGrowth;
    while (budget > 0) {
      if (random() < budget && sim.food.size < RULES.maxFood) {
        const x = random() * WIDTH, y = random() * HEIGHT;
        if (random() < fertility(cellIndex(x, y))) sim.food.add({ x, y });
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
    const plant = plantWorth > 0 ? sim.food.nearest(c.x, c.y, visionSq) : null;
    const carcass = meatWorth > 0 ? sim.carcasses.nearest(c.x, c.y, visionSq) : null;
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

    // Decide where to go. The first rule that applies wins.
    let move = c.speed;
    const mustFlee = enemy
      && enemy.strength > c.strength * RULES.fleeStrengthRatio
      && enemyDistSq < P.fleeDistance * P.fleeDistance;
    // The more meat in its diet, the less hungry a creature needs to be to hunt.
    const canHunt = enemy
      && enemy.strength < c.strength * RULES.huntStrengthRatio
      && c.energy < P.huntEnergy * 2 * c.diet
      && (!meal || enemyDistSq < mealDistSq);

    if (mustFlee) {
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
      }
    } else if (stress > 0) {
      headTowardComfort(c);
    } else {
      c.heading += (random() - 0.5) * 0.5; // wander
    }

    // Move, turning away from water, mountains and the north and south edges.
    if (move) {
      const nx = (c.x + Math.cos(c.heading) * move + WIDTH) % WIDTH;
      const ny = c.y + Math.sin(c.heading) * move;
      if (ny < 0 || ny >= HEIGHT || sim.blocked[cellIndex(nx, ny)]) {
        c.heading += 1.5 + random();
      } else {
        const oldX = c.x, oldY = c.y;
        c.x = nx;
        c.y = ny;
        creatureGrid.move(c, oldX, oldY);
      }
    }

    // Upkeep: being fast, sharp-eyed, strong or out of your climate all cost energy.
    c.energy -= 0.08 + 0.035 * c.speed * c.speed + 0.0025 * c.vision
      + P.strengthUpkeep * c.strength * c.strength + P.stressCost * stress;
    c.hydration -= RULES.thirstRate * (1 + Math.max(0, temp - RULES.hotAbove) / 12);
    c.age++;

    // Well-fed, comfortable creatures split in two.
    const roomLeft = sim.creatures.length + born.length < RULES.maxCreatures;
    if (c.energy > RULES.breedEnergy && stress <= P.maxBreedingStress && roomLeft) {
      c.energy /= 2;
      c.offspring++;
      const child = makeOffspring(nextCreatureId++, c, sim.tick, mutationRate, P.tempMutationScale, random);
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
    if (sim.tick % 10 === 0) refreshTemperature();

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
        const carcass = { x: c.x, y: c.y, tick: sim.tick, eaten: false };
        sim.carcasses.add(carcass);
        carcassQueue.push(carcass);
      }
    }
    sim.creatures = survivors.concat(born);
    sim.tick++;
    countSpecies();
  }

  // Average traits and highest generation for every species, indexed like
  // sim.species. (Head counts and kills are on the species records.)
  function stats() {
    const out = sim.species.map(() => ({ speed: 0, vision: 0, strength: 0, preferredTemp: 0, diet: 0, maxGeneration: 0 }));
    for (const c of sim.creatures) {
      const s = out[c.species];
      for (const trait of TRAITS) s[trait] += c[trait];
      if (c.generation > s.maxGeneration) s.maxGeneration = c.generation;
    }
    out.forEach((s, id) => {
      const n = sim.species[id].count || 1;
      for (const trait of TRAITS) s[trait] /= n;
    });
    return out;
  }

  return sim;
}
