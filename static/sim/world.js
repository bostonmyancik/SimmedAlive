// The map: its size, lakes, distance-to-water, and temperature.
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

// Fills `distance` with each cell's step count to the nearest water cell.
export function computeWaterDistance(water, distance) {
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
// season, any heat wave or cold snap (`boost`), and the weather fronts.
export function updateTemperature(temperature, fronts, tick, boost, params) {
  const season = params.seasonSwing * Math.sin(tick / RULES.seasonLength) + boost;
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const x = gx * CELL + 5, y = gy * CELL + 5;
      let t = RULES.baseTemp + params.tempGradient * (2 * y / HEIGHT - 1) + season;
      for (const front of fronts) {
        const dx = wrapDistance(x - front.x, WIDTH), dy = wrapDistance(y - front.y, HEIGHT);
        t += front.strength * Math.exp(-(dx * dx + dy * dy) / RULES.frontRadiusSq);
      }
      temperature[gy * GRID_W + gx] = t;
    }
  }
}
