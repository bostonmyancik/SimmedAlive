// Draws the world onto the map canvas: terrain, the chosen layer, water,
// plants, carcasses and creatures.

import { GRID_W, GRID_H, WIDTH, HEIGHT, PLAIN, FERTILE, DESERT, MOUNTAIN } from '../sim/world.js';
import { RULES } from '../sim/params.js';

// Territory is counted on a coarser grid so neighbours blend into regions.
const TERRITORY_W = GRID_W / 4;
const TERRITORY_H = GRID_H / 4;

// Land colours for the light and dark themes.
export const TERRAIN_COLORS = {
  light: { [PLAIN]: '#b9c47f', [FERTILE]: '#74b052', [DESERT]: '#ebc77c', [MOUNTAIN]: '#9a9ca8' },
  dark: { [PLAIN]: '#56603a', [FERTILE]: '#2d5e2c', [DESERT]: '#c39a52', [MOUNTAIN]: '#80838f' },
};

// Everything else the map draws, per theme. Water runs from `shallow` at the
// shore to `deep` a few cells out. Creatures are drawn in a richer version of
// their species colour (saturation and lightness multiplied by `creatureBoost`,
// lightness capped at `creatureMaxLight`) with an outline.
const THEMES = {
  light: {
    shallow: '#4cc0e8', deep: '#1f78c2', plant: '#2f6e12', carcass: '#6b3f2a',
    creatureBoost: [1.4, 1], creatureMaxLight: 0.55, outline: 'rgba(20,20,20,0.75)',
  },
  dark: {
    shallow: '#2aa7d6', deep: '#1565a8', plant: '#d4f05a', carcass: '#f0d0b8',
    creatureBoost: [1.4, 1.25], creatureMaxLight: 0.85, outline: 'rgba(10,10,10,0.85)',
  },
};
const WATER_DEPTH_CELLS = 3; // cells from shore at which water is at its deepest colour

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const themeName = () => (darkQuery.matches ? 'dark' : 'light');
export const terrainColors = () => TERRAIN_COLORS[themeName()];

// The dot in the middle of a creature with a special ability.
export const ABILITY_COLORS = {
  camouflage: '#9a9a8a',
  dash: '#f2d04b',
  spit: '#f08a2c',
  freeze: '#bfe8ff',
  pull: '#e35bd0',
};

const rgbCache = new Map();
function hexToRgb(hex) {
  let rgb = rgbCache.get(hex);
  if (!rgb) {
    const n = parseInt(hex.slice(1), 16);
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, rgb);
  }
  return rgb;
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToCss([h, s, l]) {
  return 'hsl(' + h.toFixed(1) + ',' + (s * 100).toFixed(1) + '%,' + (l * 100).toFixed(1) + '%)';
}

// The richer colour a species is drawn in on the map, per theme.
const vividCache = new Map();
function vivid(hex, theme) {
  const key = hex + theme.creatureMaxLight;
  let color = vividCache.get(key);
  if (!color) {
    const [h, s, l] = rgbToHsl(hexToRgb(hex));
    const [sBoost, lBoost] = theme.creatureBoost;
    color = hslToCss([h, Math.min(1, s * sBoost), Math.min(theme.creatureMaxLight, l * lBoost)]);
    vividCache.set(key, color);
  }
  return color;
}

// How many cells each water cell is from the shore (0 on land).
function shoreDistance(water) {
  const d = new Float32Array(GRID_W * GRID_H).fill(1e9);
  const queue = [];
  for (let i = 0; i < d.length; i++) {
    if (!water[i]) {
      d[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % GRID_W, y = (i / GRID_W) | 0;
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ny = y + ay;
      if (ny < 0 || ny >= GRID_H) continue;
      const j = ny * GRID_W + (x + ax + GRID_W) % GRID_W;
      if (d[j] > d[i] + 1) {
        d[j] = d[i] + 1;
        queue.push(j);
      }
    }
  }
  return d;
}

function offscreen(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d'), image: new ImageData(w, h) };
}

export function createMapView(canvas, sim, camera) {
  const ctx = canvas.getContext('2d');
  const land = offscreen(GRID_W, GRID_H);
  const water = offscreen(GRID_W, GRID_H);
  const overlay = offscreen(GRID_W, GRID_H);
  const territory = offscreen(TERRITORY_W, TERRITORY_H);
  let dpr = 1;

  const view = {
    layer: 'temperature', // 'temperature' | 'fertility' | 'territory' | 'none'
    resize,
    paintWorld,
    paintLayer,
    draw,
  };

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    camera.resize(w, h);
  }

  // Paints the terrain and water. Call once per new world (and on a theme change).
  function paintWorld() {
    const colors = terrainColors(), theme = THEMES[themeName()];
    const shallow = hexToRgb(theme.shallow), deep = hexToRgb(theme.deep);
    const depth = shoreDistance(sim.water);
    const landData = land.image.data, waterData = water.image.data;
    waterData.fill(0);
    for (let i = 0; i < GRID_W * GRID_H; i++) {
      const [r, g, b] = hexToRgb(colors[sim.terrain[i]]);
      landData[i * 4] = r;
      landData[i * 4 + 1] = g;
      landData[i * 4 + 2] = b;
      landData[i * 4 + 3] = 255;
      if (sim.water[i]) {
        // Deeper further from the shore. Cell 1 is the edge, so it is the shallowest.
        const t = Math.min(1, (depth[i] - 1) / (WATER_DEPTH_CELLS - 1));
        waterData[i * 4] = shallow[0] + (deep[0] - shallow[0]) * t;
        waterData[i * 4 + 1] = shallow[1] + (deep[1] - shallow[1]) * t;
        waterData[i * 4 + 2] = shallow[2] + (deep[2] - shallow[2]) * t;
        waterData[i * 4 + 3] = 240;
      }
    }
    land.ctx.putImageData(land.image, 0, 0);
    water.ctx.putImageData(water.image, 0, 0);
  }
  darkQuery.addEventListener('change', paintWorld);

  function paintTemperature() {
    const data = overlay.image.data;
    for (let i = 0; i < GRID_W * GRID_H; i++) {
      const t = sim.temperature[i] - RULES.baseTemp;
      const [r, g, b] = t > 0 ? [226, 75, 74] : [55, 138, 221];
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = Math.min(110, Math.abs(t) * 7);
    }
    overlay.ctx.putImageData(overlay.image, 0, 0);
  }

  function paintFertility() {
    const data = overlay.image.data;
    for (let i = 0; i < GRID_W * GRID_H; i++) {
      data[i * 4] = 99;
      data[i * 4 + 1] = 153;
      data[i * 4 + 2] = 34;
      data[i * 4 + 3] = sim.fertility(i) * 170;
    }
    overlay.ctx.putImageData(overlay.image, 0, 0);
  }

  // Colours each area by the species with the most creatures there.
  function paintTerritory() {
    // Count only the species alive now, however many there have ever been.
    const living = sim.species.filter((sp) => sp.count > 0);
    const slot = new Map(living.map((sp, i) => [sp.id, i]));
    const n = Math.max(1, living.length);
    const counts = new Uint16Array(TERRITORY_W * TERRITORY_H * n);
    for (const c of sim.creatures) {
      const s = slot.get(c.species);
      if (s === undefined) continue; // born since the last head count
      const tx = Math.min(TERRITORY_W - 1, Math.floor(c.x / WIDTH * TERRITORY_W));
      const ty = Math.min(TERRITORY_H - 1, Math.max(0, Math.floor(c.y / HEIGHT * TERRITORY_H)));
      counts[(ty * TERRITORY_W + tx) * n + s]++;
    }
    const data = territory.image.data;
    for (let i = 0; i < TERRITORY_W * TERRITORY_H; i++) {
      let top = 0, topCount = 0;
      for (let s = 0; s < n; s++) {
        if (counts[i * n + s] > topCount) {
          topCount = counts[i * n + s];
          top = s;
        }
      }
      const [r, g, b] = hexToRgb(living[top] ? living[top].color : '#000000');
      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = Math.min(140, topCount * 45);
    }
    territory.ctx.putImageData(territory.image, 0, 0);
  }

  // Refreshes the active layer from the current state of the world.
  function paintLayer() {
    if (view.layer === 'temperature') paintTemperature();
    else if (view.layer === 'fertility') paintFertility();
    else if (view.layer === 'territory') paintTerritory();
  }

  // Draws one copy of the world. `minX` and `maxX` are the visible world x range.
  function drawWorld(minX, maxX, interp, selected) {
    const theme = THEMES[themeName()];
    ctx.drawImage(land.canvas, 0, 0, WIDTH, HEIGHT);
    if (view.layer === 'territory') ctx.drawImage(territory.canvas, 0, 0, WIDTH, HEIGHT);
    else if (view.layer !== 'none') ctx.drawImage(overlay.canvas, 0, 0, WIDTH, HEIGHT);
    ctx.drawImage(water.canvas, 0, 0, WIDTH, HEIGHT);

    // Plants are bright dots.
    ctx.fillStyle = theme.plant;
    ctx.beginPath();
    for (const f of sim.food) {
      if (f.x < minX || f.x > maxX) continue;
      ctx.moveTo(f.x + 1.8, f.y);
      ctx.arc(f.x, f.y, 1.8, 0, 6.29);
    }
    ctx.fill();

    // Carcasses are small crosses.
    ctx.strokeStyle = theme.carcass;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const k of sim.carcasses) {
      if (k.x < minX || k.x > maxX) continue;
      ctx.moveTo(k.x - 2.5, k.y - 2.5);
      ctx.lineTo(k.x + 2.5, k.y + 2.5);
      ctx.moveTo(k.x + 2.5, k.y - 2.5);
      ctx.lineTo(k.x - 2.5, k.y + 2.5);
    }
    ctx.stroke();

    for (const c of sim.creatures) {
      let x = c.x, y = c.y;
      // At slow speeds, glide between ticks (but not across the wrap seam).
      if (interp < 1 && c.prevX !== undefined && Math.abs(c.x - c.prevX) < 50) {
        x = c.prevX + (c.x - c.prevX) * interp;
        y = c.prevY + (c.y - c.prevY) * interp;
      }
      if (x < minX || x > maxX) continue;
      const r = 2 + 1.3 * c.strength, color = vivid(sim.species[c.species].color, theme);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.29);
      ctx.fill();
      ctx.strokeStyle = theme.outline;
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(c.heading) * (r + 4), y + Math.sin(c.heading) * (r + 4));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (c.ability) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, r * 0.45), 0, 6.29);
        ctx.fillStyle = ABILITY_COLORS[c.ability];
        ctx.fill();
      }
      if (c.frozen > 0) {
        ctx.beginPath();
        ctx.arc(x, y, r + 1.5, 0, 6.29);
        ctx.strokeStyle = '#e8f6ff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (c.thirsty) {
        ctx.beginPath();
        ctx.arc(x, y, r + 2, 0, 6.29);
        ctx.strokeStyle = '#378ADD';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (c === selected) {
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, 6.29);
        ctx.strokeStyle = css('--text');
        ctx.lineWidth = 2 / Math.max(1, camera.zoom);
        ctx.stroke();
      }
    }
  }

  // Spit in flight, and the brief flash when an ability is used.
  function drawAbilities(minX, maxX) {
    ctx.fillStyle = ABILITY_COLORS.spit;
    ctx.beginPath();
    for (const p of sim.projectiles) {
      if (p.x < minX || p.x > maxX) continue;
      ctx.moveTo(p.x + 1.6, p.y);
      ctx.arc(p.x, p.y, 1.6, 0, 6.29);
    }
    ctx.fill();

    for (const e of sim.effects) {
      if (e.x < minX || e.x > maxX) continue;
      const fade = 1 - (sim.tick - e.tick) / RULES.effectTicks;
      if (fade <= 0) continue;
      ctx.globalAlpha = fade;
      ctx.beginPath();
      if (e.kind === 'freeze') {
        // A ring that spreads out to the edge of the freeze.
        ctx.arc(e.x, e.y, e.radius * (1.1 - fade * 0.6), 0, 6.29);
        ctx.strokeStyle = ABILITY_COLORS.freeze;
        ctx.lineWidth = 2;
      } else if (e.kind === 'pull') {
        // The line the victim was dragged along (not across the wrap seam).
        if (Math.abs(e.fromX - e.x) > 200) continue;
        ctx.moveTo(e.fromX, e.fromY);
        ctx.lineTo(e.x, e.y);
        ctx.strokeStyle = ABILITY_COLORS.pull;
        ctx.lineWidth = 1.5;
      } else {
        ctx.arc(e.x, e.y, 3 + (1 - fade) * 4, 0, 6.29); // spit landing
        ctx.strokeStyle = ABILITY_COLORS.spit;
        ctx.lineWidth = 1.2;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // interp: 0..1 position between the previous tick and this one.
  // brush: { x, y, radius } in world pixels to outline, or null.
  function draw(interp, selected, brush) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = css('--bg');
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const zoom = camera.zoom, left = camera.left(), top = camera.top();
    const right = left + camera.viewW / zoom;
    // The view can straddle the east-west seam, so draw each copy that is visible.
    for (const offset of [-WIDTH, 0, WIDTH]) {
      if (offset + WIDTH <= left || offset >= right) continue;
      const scale = dpr * zoom;
      ctx.setTransform(scale, 0, 0, scale, (offset - left) * scale, -top * scale);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, WIDTH, HEIGHT);
      ctx.clip();
      drawWorld(left - offset - 12, right - offset + 12, interp, selected);
      drawAbilities(left - offset - 40, right - offset + 40);
      if (brush) {
        ctx.strokeStyle = css('--text');
        ctx.lineWidth = 1.5 / zoom;
        for (const shift of [-WIDTH, 0, WIDTH]) {
          ctx.beginPath();
          ctx.arc(brush.x + shift, brush.y, brush.radius, 0, 6.29);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  return view;
}
