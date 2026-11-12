// The map: its size, lakes, terrain, distance-to-water, and temperature.
// The map is a grid of cells. It wraps around east-west but not north-south.

import { RULES } from './params.js';

export const GRID_W = 136;
export const GRID_H = 68;
export const CELL = 10; // pixels per grid cell
export const WIDTH = GRID_W * CELL;
export const HEIGHT = GRID_H * CELL;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Index of the grid cell containing pixel position (x, y).
export function cellIndex(x, y) {
  return clamp((y / CELL) | 0, 0, GRID_H - 1) * GRID_W + clamp((x / CELL) | 0, 0, GRID_W - 1);
}

// Shortest distance along an axis that wraps around at `span`.
export function wrapDistance(delta, span) {
  delta = Math.abs(delta);
  return delta > span / 2 ? span - delta : delta;
}

// Fills `water` (1 = water, 0 = land) with a few irregular lakes.
export function generateLakes(water, random) {
  water.fill(0);
  for (let k = 0; k < RULES.lakeCount; k++) {
    const cx = random() * GRID_W;
    const cy = 3 + random() * (GRID_H - 6);
    const radius = 2.2 + random() * 2.8;
    const phase1 = random() * 6;
    const phase2 = random() * 6;
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const dx = wrapDistance(gx - cx, GRID_W);
        const dy = gy - cy;
        const angle = Math.atan2(dy, gx - cx);
        // Wobble the shoreline so lakes are not perfect ovals.
        const shore = radius * (1 + 0.3 * Math.sin(angle * 3 + phase1) + 0.2 * Math.sin(angle * 5 + phase2));
        if (Math.sqrt(dx * dx + dy * dy * 1.6) < shore) water[gy * GRID_W + gx] = 1;
      }
    }
  }
}

// Kinds of land. Water is tracked separately.
export const PLAIN = 0, FERTILE = 1, DESERT = 2, MOUNTAIN = 3;

const smooth = (t) => t * t * (3 - 2 * t);

// Smooth random noise over the map. Returns f(u, v) in [0, 1] for u, v in
// [0, 1], which wraps around in u (east-west) like the map does.
function makeNoise(random, cols, rows) {
  const lattice = new Float32Array(cols * (rows + 1));
  for (let i = 0; i < lattice.length; i++) lattice[i] = random();
  return (u, v) => {
    const fx = u * cols, fy = v * rows;
    const x0 = Math.floor(fx) % cols, y0 = Math.min(rows - 1, Math.floor(fy));
    const x1 = (x0 + 1) % cols, y1 = y0 + 1;
    const tx = smooth(fx - Math.floor(fx)), ty = smooth(fy - y0);
    const top = lattice[y0 * cols + x0] * (1 - tx) + lattice[y0 * cols + x1] * tx;
    const bottom = lattice[y1 * cols + x0] * (1 - tx) + lattice[y1 * cols + x1] * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

// Raises mountain ranges on dry land. Everything else starts as plain.
export function generateMountains(terrain, water, random) {
  const broad = makeNoise(random, 6, 3), detail = makeNoise(random, 17, 8), gaps = makeNoise(random, 11, 5);
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const u = (gx + 0.5) / GRID_W, v = (gy + 0.5) / GRID_H;
      // Ranges follow the contour where the height noise crosses its midpoint,
      // and the `gaps` noise breaks them up so they have passes.
      const height = 0.7 * broad(u, v) + 0.3 * detail(u, v);
      const onRidge = Math.abs(height - 0.5) < 0.022;
      const i = gy * GRID_W + gx;
      terrain[i] = !water[i] && onRidge && gaps(u, v) > 0.42 ? MOUNTAIN : PLAIN;
    }
  }
}

// Turns plain land fertile (wet or by the shore) or into desert (dry and far from water).
export function classifyLand(terrain, water, waterDistance, random) {
  const broad = makeNoise(random, 7, 3), detail = makeNoise(random, 19, 9);
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const i = gy * GRID_W + gx;
      if (water[i] || terrain[i] === MOUNTAIN) continue;
      const u = (gx + 0.5) / GRID_W, v = (gy + 0.5) / GRID_H;
      const moisture = 0.7 * broad(u, v) + 0.3 * detail(u, v);
      if (waterDistance[i] <= 2 || moisture > 0.6) terrain[i] = FERTILE;
      else if (moisture < 0.42 && waterDistance[i] > 5) terrain[i] = DESERT;
    }
  }
}

// Fills `distance` with each cell's walking distance (in cells) to the nearest
// water. Mountains cannot be crossed; they and anywhere cut off stay at 1e9.
export function computeWaterDistance(water, terrain, distance) {
  distance.fill(1e9);
  const queue = [];
  for (let i = 0; i < water.length; i++) {
    if (water[i]) {
      distance[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const gx = i % GRID_W, gy = (i / GRID_W) | 0;
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = (gx + ax + GRID_W) % GRID_W, ny = gy + ay;
      if (ny < 0 || ny >= GRID_H) continue;
      const j = ny * GRID_W + nx;
      if (terrain[j] === MOUNTAIN) continue;
      if (distance[j] > distance[i] + 1) {
        distance[j] = distance[i] + 1;
        queue.push(j);
      }
    }
  }
}

const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const YEAR_TICKS = 2 * Math.PI * RULES.seasonLength;

// The year (starting at 1) and season name for a tick. Summer is the warm peak.
export function seasonAt(tick) {
  const phase = (tick / RULES.seasonLength) % (2 * Math.PI);
  const quarter = Math.floor(((phase + Math.PI / 4) % (2 * Math.PI)) / (Math.PI / 2));
  return { year: Math.floor(tick / YEAR_TICKS) + 1, season: SEASONS[quarter] };
}

// Recomputes the temperature of every cell: a north-south gradient, the
// season, any heat wave or cold snap (`boost`), the weather fronts, and
// `offset`, the per-cell warming or cooling left by brushes and meteors.
export function updateTemperature(temperature, fronts, tick, boost, params, offset) {
  const season = params.seasonSwing * Math.sin(tick / RULES.seasonLength) + boost;
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const x = gx * CELL + 5, y = gy * CELL + 5;
      let t = RULES.baseTemp + params.tempGradient * (2 * y / HEIGHT - 1) + season;
      for (const front of fronts) {
        const dx = wrapDistance(x - front.x, WIDTH), dy = wrapDistance(y - front.y, HEIGHT);
        t += front.strength * Math.exp(-(dx * dx + dy * dy) / RULES.frontRadiusSq);
      }
      temperature[gy * GRID_W + gx] = t + offset[gy * GRID_W + gx];
    }
  }
}
