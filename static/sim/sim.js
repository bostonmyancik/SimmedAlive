// The simulation itself: world generation and the per-tick rules.
// Nothing here touches the page, so it runs in the browser and under Node.

import { SPECIES, DEFAULT_PARAMS, RULES } from './params.js';
import { mulberry32 } from './rng.js';
import { SpatialGrid } from './grid.js';
import { spawnCreature, makeOffspring } from './creatures.js';
import {
  GRID_W, GRID_H, WIDTH, HEIGHT,
  cellIndex, generateLakes, computeWaterDistance, updateTemperature,
} from './world.js';

const BUCKET_SIZE = 40; // pixels; roughly a typical vision radius

// Directions a creature probes when looking for a better temperature.
const TEMP_PROBES = [[30, 0], [-30, 0], [0, 30], [0, -30]];

// Velocity of each weather front in pixels per tick. They alternate warm, cold.
const FRONT_DRIFTS = [[0.12, 0.05], [-0.09, 0.07], [0.07, -0.06], [-0.11, -0.04]];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Creates a simulation. Call sim.generate() to build a world, then sim.step().
//   seed:   the same seed always gives the same world
//   params: overrides for DEFAULT_PARAMS
export function createSim({ seed = 1, params = {} } = {}) {
  const P = { ...DEFAULT_PARAMS, ...params };
  let random = mulberry32(seed);

  const sim = {
    seed,
    params: P,
    species: SPECIES,
    water: new Uint8Array(GRID_W * GRID_H),          // 1 = water
    waterDistance: new Float32Array(GRID_W * GRID_H), // cells to nearest water
    temperature: new Float32Array(GRID_W * GRID_H),
    food: new SpatialGrid(WIDTH, HEIGHT, BUCKET_SIZE), // items are { x, y }
    creatures: [],
    fronts: [],
    tick: 0,
    temperatureBoost: 0, // set to +9 / -9 for a heat wave / cold snap
    kills: SPECIES.map(() => 0),
    generate,
    step,
    stats,
    addFood,
    fertility,
  };

  // Rebuilt at the start of every tick to find nearby enemies quickly.
  const creatureGrid = new SpatialGrid(WIDTH, HEIGHT, BUCKET_SIZE);

  function refreshTemperature() {
    updateTemperature(sim.temperature, sim.fronts, sim.tick, sim.temperatureBoost, P);
  }

  // Builds a fresh world. Pass a new seed, or omit it to rebuild the same one.
  function generate(newSeed = sim.seed) {
    sim.seed = newSeed;
    random = mulberry32(newSeed);
    sim.food.clear();
    sim.creatures = [];
    sim.tick = 0;
    sim.temperatureBoost = 0;
    sim.kills = SPECIES.map(() => 0);

    generateLakes(sim.water, random);
    computeWaterDistance(sim.water, sim.waterDistance);

    // Warm and cold fronts, each drifting in its own direction.
    sim.fronts = FRONT_DRIFTS.map(([vx, vy], i) => ({
      x: random() * WIDTH,
      y: random() * HEIGHT,
      vx,
      vy,
      strength: i % 2 ? -P.frontStrength : P.frontStrength,
    }));
    refreshTemperature();

    // Each species starts in its own band: cold north, mild middle, hot south.
    for (let s = 0; s < SPECIES.length; s++) {
      for (let i = 0; i < RULES.startPerSpecies; i++) {
        let x, y, tries = 0;
        do {
          x = random() * WIDTH;
          y = clamp((s + 0.5) * HEIGHT / 3 + (random() - 0.5) * HEIGHT * 0.26, 0, HEIGHT - 1);
        } while (sim.water[cellIndex(x, y)] && tries++ < 50);
        sim.creatures.push(spawnCreature(s, x, y, random));
      }
    }

    for (let i = 0; i < RULES.startFood; i++) {
      const x = random() * WIDTH, y = random() * HEIGHT;
      addFood(x, y);
    }
  }

  // Places a piece of food unless the spot is water. Returns whether it landed.
  function addFood(x, y) {
    if (sim.water[cellIndex(x, y)]) return false;
    sim.food.add({ x, y });
    return true;
  }

  // Chance (0 to 1) that food sprouting in a land cell takes hold:
  // higher near water, much lower in extreme cold or heat.
  function fertility(cell) {
    const temp = sim.temperature[cell];
    const nearWater = 0.2 + 0.8 * Math.exp(-sim.waterDistance[cell] / 5);
    const climate = temp < -4 || temp > 40 ? 0.15 : 1;
    return nearWater * climate;
  }

  // Food sprouts at random spots, subject to how fertile the land is there.
  function growFood(foodRate) {
    let budget = foodRate * P.foodGrowth;
    while (budget > 0) {
      if (random() < budget && sim.food.size < RULES.maxFood) {
        const x = random() * WIDTH, y = random() * HEIGHT;
        const cell = cellIndex(x, y);
        if (!sim.water[cell]) {
          if (random() < fertility(cell)) sim.food.add({ x, y });
        }
      }
      budget -= 1;
    }
  }

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

  // One creature's turn: fight, decide where to go, move, pay upkeep, breed.
  function act(c, born, mutationRate) {
    const cell = cellIndex(c.x, c.y);
    const temp = sim.temperature[cell];
    const stress = Math.max(0, Math.abs(temp - c.preferredTemp) - P.tempTolerance);

    // What can it see? (Sight does not cross the east-west wrap.)
    const visionSq = c.vision * c.vision;
    const distSqTo = (o) => (o.x - c.x) * (o.x - c.x) + (o.y - c.y) * (o.y - c.y);
    const food = sim.food.nearest(c.x, c.y, visionSq);
    const foodDistSq = food ? distSqTo(food) : visionSq;
    const enemy = creatureGrid.nearest(c.x, c.y, visionSq, (o) => o.species !== c.species && o.energy > 0);
    const enemyDistSq = enemy ? distSqTo(enemy) : visionSq;

    // Fight any enemy within reach. Creatures hit weaker outside their climate.
    if (enemy && enemyDistSq < RULES.attackRangeSq) {
      enemy.energy -= P.combatDamage * c.strength * (stress > 0 ? P.awayDamageFactor : 1);
      if (enemy.energy <= 0) {
        c.energy += RULES.killEnergy;
        sim.kills[c.species]++;
      }
    }

    if (c.hydration < RULES.thirstyBelow) c.thirsty = true;
    if (c.hydration >= RULES.quenchedAt) c.thirsty = false;

    // Decide where to go. The first rule that applies wins.
    let move = c.speed;
    const mustFlee = enemy
      && enemy.strength > c.strength * RULES.fleeStrengthRatio
      && enemyDistSq < P.fleeDistance * P.fleeDistance;
    const canHunt = enemy
      && enemy.strength < c.strength * RULES.huntStrengthRatio
      && c.energy < P.huntEnergy
      && (!food || enemyDistSq < foodDistSq);

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
    } else if (food) {
      c.heading = Math.atan2(food.y - c.y, food.x - c.x);
      if (foodDistSq < Math.max(RULES.minEatRangeSq, c.speed * c.speed)) {
        sim.food.remove(food);
        c.energy += RULES.foodEnergy;
      }
    } else if (stress > 0) {
      headTowardComfort(c);
    } else {
      c.heading += (random() - 0.5) * 0.5; // wander
    }

    // Move, turning away from water and the north and south edges.
    if (move) {
      const nx = (c.x + Math.cos(c.heading) * move + WIDTH) % WIDTH;
      const ny = c.y + Math.sin(c.heading) * move;
      if (ny < 0 || ny >= HEIGHT || sim.water[cellIndex(nx, ny)]) {
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
      born.push(makeOffspring(c, mutationRate, P.tempMutationScale, random));
    }
  }

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

    creatureGrid.clear();
    for (const c of sim.creatures) creatureGrid.add(c);

    const born = [];
    for (const c of sim.creatures) {
      if (c.energy <= 0) continue; // killed earlier this tick
      act(c, born, mutationRate);
    }

    sim.creatures = sim.creatures
      .filter((c) => c.energy > 0 && c.hydration > 0 && c.age < RULES.maxAge)
      .concat(born);
    sim.tick++;
  }

  // Per-species head count, average traits, kills and highest generation.
  function stats() {
    return SPECIES.map((_, s) => {
      const members = sim.creatures.filter((c) => c.species === s);
      const average = (key) => members.reduce((sum, c) => sum + c[key], 0) / (members.length || 1);
      return {
        count: members.length,
        speed: average('speed'),
        vision: average('vision'),
        strength: average('strength'),
        preferredTemp: average('preferredTemp'),
        maxGeneration: members.reduce((max, c) => Math.max(max, c.generation), 0),
        kills: sim.kills[s],
      };
    });
  }

  return sim;
}
