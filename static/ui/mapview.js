// Draws the world onto the map canvas: terrain, the chosen layer, water,
// plants, carcasses and creatures.

import { GRID_W, GRID_H, WIDTH, HEIGHT, PLAIN, FERTILE, DESERT, MOUNTAIN } from '../sim/world.js';
import { RULES } from '../sim/params.js';

// Territory is counted on a coarser grid so neighbours blend into regions.
const TERRITORY_W = GRID_W / 4;
const TERRITORY_H = GRID_H / 4;

// Land colours for the light and dark themes.
export const TERRAIN_COLORS = {
  light: { [PLAIN]: '#e6e2d3', [FERTILE]: '#cddbab', [DESERT]: '#ecd9a4', [MOUNTAIN]: '#8d8980' },
  dark: { [PLAIN]: '#262523', [FERTILE]: '#27331f', [DESERT]: '#3d3421', [MOUNTAIN]: '#63605a' },
};
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
export const terrainColors = () => (darkQuery.matches ? TERRAIN_COLORS.dark : TERRAIN_COLORS.light);

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
    const colors = terrainColors();
    const landData = land.image.data, waterData = water.image.data;
    waterData.fill(0);
    for (let i = 0; i < GRID_W * GRID_H; i++) {
      const [r, g, b] = hexToRgb(colors[sim.terrain[i]]);
      landData[i * 4] = r;
      landData[i * 4 + 1] = g;
      landData[i * 4 + 2] = b;
      landData[i * 4 + 3] = 255;
      if (sim.water[i]) {
        waterData[i * 4] = 24;
        waterData[i * 4 + 1] = 95;
        waterData[i * 4 + 2] = 165;
        waterData[i * 4 + 3] = 225;
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

  // Traces a wall from x0 to x1 with `teeth` battlements along the top.
  function battlements(x0, x1, top, bottom, teeth) {
    const step = (x1 - x0) / (teeth * 2 - 1), notch = Math.min(step, (bottom - top) * 0.35);
    ctx.moveTo(x0, bottom);
    for (let i = 0; i < teeth * 2 - 1; i++) {
      const y = i % 2 ? top + notch : top;
      ctx.lineTo(x0 + i * step, y);
      ctx.lineTo(x0 + (i + 1) * step, y);
    }
    ctx.lineTo(x1, bottom);
    ctx.closePath();
  }

  // A base: the ground it shelters, its fields if it farms, the building (a
  // tent, then a walled fort, then a castle with a keep), and bars for its
  // food store and, when damaged, its walls.
  function drawBase(base, isSelected, outline) {
    const info = sim.baseInfo(base), color = sim.species[base.species].color;
    const { x, y } = base, s = 9 + 4 * info.growth;

    ctx.beginPath();
    ctx.arc(x, y, RULES.baseRadius, 0, 6.29);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.13;
    ctx.fill();
    ctx.globalAlpha = info.underAttack ? 0.9 : 0.55;
    ctx.strokeStyle = info.underAttack ? '#e24b4a' : color;
    ctx.lineWidth = info.underAttack ? 1.6 : 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (base.farming) {
      ctx.beginPath();
      ctx.arc(x, y, RULES.farmRadius, 0, 6.29);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#639922';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = color;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (info.stage === 'camp') {
      ctx.moveTo(x - s, y + s * 0.7);
      ctx.lineTo(x, y - s * 0.8);
      ctx.lineTo(x + s, y + s * 0.7);
      ctx.closePath();
    } else {
      battlements(x - s, x + s, y - s * 0.3, y + s * 0.7, 3);
      if (info.stage === 'castle') battlements(x - s * 0.45, x + s * 0.45, y - s * 1.2, y - s * 0.05, 2);
    }
    ctx.fill();
    ctx.stroke();

    const bar = (top, fraction, fill) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(x - s, top, s * 2, 2);
      ctx.fillStyle = fill;
      ctx.fillRect(x - s, top, s * 2 * Math.max(0, Math.min(1, fraction)), 2);
    };
    bar(y + s * 0.7 + 2.5, (base.plants + base.meat) / info.store, '#8fc93a');
    if (base.health < info.maxHealth * 0.97) bar(y + s * 0.7 + 5.5, base.health / info.maxHealth, '#e24b4a');

    if (isSelected) {
      ctx.beginPath();
      ctx.arc(x, y, RULES.baseRadius + 4, 0, 6.29);
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2 / Math.max(1, camera.zoom);
      ctx.stroke();
    }
  }

  // Draws one copy of the world. `minX` and `maxX` are the visible world x range.
  function drawWorld(minX, maxX, interp, selected) {
    ctx.drawImage(land.canvas, 0, 0, WIDTH, HEIGHT);
    if (view.layer === 'territory') ctx.drawImage(territory.canvas, 0, 0, WIDTH, HEIGHT);
    else if (view.layer !== 'none') ctx.drawImage(overlay.canvas, 0, 0, WIDTH, HEIGHT);
    ctx.drawImage(water.canvas, 0, 0, WIDTH, HEIGHT);

    // Plants are green dots.
    ctx.fillStyle = '#639922';
    ctx.beginPath();
    for (const f of sim.food) {
      if (f.x < minX || f.x > maxX) continue;
      ctx.moveTo(f.x + 1.8, f.y);
      ctx.arc(f.x, f.y, 1.8, 0, 6.29);
    }
    ctx.fill();

    // Carcasses are small crosses.
    ctx.strokeStyle = css('--carcass');
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

    const outline = css('--text');
    for (const base of sim.bases) {
      const reach = RULES.farmRadius + 4;
      if (base.x >= minX - reach && base.x <= maxX + reach) drawBase(base, base === selected, outline);
    }

    for (const c of sim.creatures) {
      let x = c.x, y = c.y;
      // At slow speeds, glide between ticks (but not across the wrap seam).
      if (interp < 1 && c.prevX !== undefined && Math.abs(c.x - c.prevX) < 50) {
        x = c.prevX + (c.x - c.prevX) * interp;
        y = c.prevY + (c.y - c.prevY) * interp;
      }
      if (x < minX || x > maxX) continue;
      const r = 2 + 1.3 * c.strength, color = sim.species[c.species].color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.29);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(c.heading) * (r + 4), y + Math.sin(c.heading) * (r + 4));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (c.carrying) {
        // What it is carrying home rides on its back.
        ctx.beginPath();
        ctx.arc(x - Math.cos(c.heading) * (r + 1.5), y - Math.sin(c.heading) * (r + 1.5), 2, 0, 6.29);
        ctx.fillStyle = c.carrying === 2 ? css('--carcass') : '#639922';
        ctx.fill();
        ctx.strokeStyle = outline;
        ctx.lineWidth = 0.6;
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
