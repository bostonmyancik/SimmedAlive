// Wires the page together: the animation loop, tools, panels and bottom bar.
// The simulation rules live in ../sim/.

import { createSim } from '../sim/sim.js';
import { randomSeed } from '../sim/rng.js';
import { RULES } from '../sim/params.js';
import { WIDTH, HEIGHT, PLAIN, FERTILE, DESERT, MOUNTAIN, cellIndex, seasonAt, wrapDistance } from '../sim/world.js';
import { createCamera } from './camera.js';
import { createMapView, terrainColors } from './mapview.js';
import { AUTOSAVE_NAME, listSaves, getSave, getAutosave, putSave, deleteSave } from './saves.js';
import { SAMPLE_EVERY, drawLineChart, drawTimeline, drawFamilyTree, windowStart, windowSpan } from './charts.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 12];
const REFRESH_EVERY = 6; // frames between panel and layer refreshes
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const dot = (color) => '<span class="dot" style="background:' + color + '"></span>';

// Open the page with ?seed=123 to replay a particular world.
const urlSeed = Number(new URLSearchParams(location.search).get('seed'));
const hasUrlSeed = Number.isInteger(urlSeed) && urlSeed > 0;
const sim = createSim({ seed: hasUrlSeed ? urlSeed : randomSeed() });

const canvas = $('world');
const camera = createCamera(WIDTH, HEIGHT);
const map = createMapView(canvas, sim, camera);

const AUTOSAVE_EVERY_MS = 5000;
const BRUSH_TOOLS = ['food', 'terrain', 'warm', 'cool']; // drag to paint with these
const TOOL_TIPS = {
  food: 'Drag to scatter plants.',
  terrain: 'Drag to paint. Water and mountains block movement.',
  warm: 'Drag to warm the land. It fades over time.',
  cool: 'Drag to cool the land. It fades over time.',
  meteor: 'Click the map to strike. Everything inside the circle dies.',
};

let paused = false;
let tool = 'select';       // 'select' | 'food' | 'terrain' | 'warm' | 'cool' | 'meteor'
let brushKind = 'water';   // what the terrain brush paints
let hover = null;          // pointer position over the map, in view pixels
let autosavedTick = -1;    // tick of the last successful autosave
let worldEdited = false;   // the world changed without the tick advancing (brush, disaster, new world)
let savingNow = false;     // an autosave request is in flight
let selected = null;       // the creature shown in the Inspector
let selectedDiedAt = null; // tick at which it died, if it has
let following = false;     // keep the camera on the selected creature
let history = [];          // samples: { tick, counts, traits }
let debt = 0;              // fractional ticks owed to the simulation
let frameCount = 0;
let eventsShown = -1;      // fingerprint of the event list already rendered

// Species worth showing: founders, and new ones once they have taken hold.
const shownSpecies = () => sim.species.filter((sp) => sp.established);
const livingSpecies = () => shownSpecies().filter((sp) => sp.count > 0).sort((a, b) => b.count - a.count);

function dietWords(diet) {
  const percent = Math.round(diet * 100) + '% meat';
  if (diet < 0.1) return 'Plants (' + percent + ')';
  if (diet < 0.4) return 'Mostly plants (' + percent + ')';
  if (diet < 0.6) return 'Mixed (' + percent + ')';
  if (diet < 0.9) return 'Mostly meat (' + percent + ')';
  return 'Meat (' + percent + ')';
}

// ---------- Panels ----------

function refreshSpecies() {
  const stats = sim.stats();
  const living = livingSpecies();
  const total = sim.creatures.length || 1;
  $('cards').innerHTML = living.map((sp) => {
    const st = stats[sp.id];
    return '<div class="card">' +
      '<div class="name">' + dot(sp.color) + sp.name +
      (sp.parent !== null ? '<span class="split">from ' + sim.species[sp.parent].name + '</span>' : '') + '</div>' +
      '<div class="count">' + fmt(sp.count) + '</div>' +
      '<div class="share"><i style="background:' + sp.color + ';width:' + (sp.count / total * 100) + '%"></i></div>' +
      '<dl class="facts">' +
      '<dt>Diet</dt><dd>' + dietWords(st.diet) + '</dd>' +
      '<dt>Speed</dt><dd>' + st.speed.toFixed(1) + '</dd>' +
      '<dt>Strength</dt><dd>' + st.strength.toFixed(1) + '</dd>' +
      '<dt>Vision</dt><dd>' + Math.round(st.vision) + '</dd>' +
      '<dt>Prefers</dt><dd>' + Math.round(st.preferredTemp) + '°C</dd>' +
      '<dt>Kills</dt><dd>' + fmt(sp.kills) + '</dd>' +
      '<dt>Latest generation</dt><dd>' + st.maxGeneration + '</dd>' +
      '</dl></div>';
  }).join('');
  const extinct = shownSpecies().filter((sp) => sp.count === 0);
  $('extinctList').textContent = extinct.length ? 'Extinct: ' + extinct.map((sp) => sp.name).join(', ') : '';
}

function setMeter(id, text, fraction) {
  $(id).textContent = text;
  $(id + 'Bar').style.width = Math.max(0, Math.min(1, fraction)) * 100 + '%';
}

function refreshInspector() {
  $('inspEmpty').hidden = !!selected;
  $('inspBody').hidden = !selected;
  if (!selected) return;
  const c = selected;
  if (selectedDiedAt === null && !sim.creatures.includes(c)) {
    selectedDiedAt = sim.tick;
    setFollowing(false);
  }

  const sp = sim.species[c.species];
  const here = sim.temperature[cellIndex(c.x, c.y)];
  const gap = here - c.preferredTemp;
  const stressed = Math.abs(gap) > sim.params.tempTolerance;
  let status;
  if (selectedDiedAt !== null) status = 'Died at tick ' + fmt(selectedDiedAt);
  else status = [c.thirsty ? 'Thirsty' : null, stressed ? (gap > 0 ? 'Too hot' : 'Too cold') : null]
    .filter(Boolean).join(' · ') || 'Comfortable';

  $('inspTitle').innerHTML = dot(sp.color) + sp.name;
  $('inspStatus').textContent = status;
  setMeter('inspEnergy', Math.max(0, c.energy).toFixed(0) + ' (splits above ' + RULES.breedEnergy + ')', c.energy / RULES.breedEnergy);
  setMeter('inspWater', Math.max(0, c.hydration).toFixed(0) + ' of 100', c.hydration / 100);
  setMeter('inspAge', fmt(c.age) + ' of ' + fmt(RULES.maxAge) + ' ticks', c.age / RULES.maxAge);
  $('inspGen').textContent = c.generation;
  $('inspSpeed').textContent = c.speed.toFixed(2);
  $('inspVision').textContent = c.vision.toFixed(0);
  $('inspStrength').textContent = c.strength.toFixed(2);
  $('inspDiet').textContent = dietWords(c.diet);
  $('inspPrefers').textContent = c.preferredTemp.toFixed(1) + '°C';
  $('inspHere').textContent = here.toFixed(1) + '°C';
  $('inspBorn').textContent = c.bornTick ? 'Tick ' + fmt(c.bornTick) : 'At the start';
  $('inspOffspring').textContent = c.offspring;
  $('inspAncestry').innerHTML = sim.lineage(c.species)
    .map((id) => dot(sim.species[id].color) + sim.species[id].name).join(' &rarr; ') +
    '<br>Generation ' + c.generation + ' of its line.';
  $('inspFollow').disabled = selectedDiedAt !== null;
}

function setFollowing(on) {
  following = on;
  $('inspFollow').setAttribute('aria-pressed', on);
  $('inspFollow').textContent = on ? 'Following' : 'Follow';
}

function select(creature) {
  selected = creature;
  selectedDiedAt = null;
  setFollowing(false);
  refreshInspector();
  if (creature) showTab('inspector');
}

function refreshEvents() {
  const newest = sim.events.length ? sim.events[sim.events.length - 1].tick : -1;
  const key = newest * 1000 + sim.events.length;
  if (key === eventsShown) return;
  eventsShown = key;
  $('eventsEmpty').hidden = sim.events.length > 0;
  $('events').innerHTML = sim.events.slice().reverse().map((e) =>
    '<li class="' + e.kind + '"><span class="pip"></span><span class="when">Tick ' + fmt(e.tick) + '</span><span>' + e.text + '</span></li>').join('');
}

function showTab(name) {
  for (const tab of document.querySelectorAll('.tabs [role=tab]')) {
    const on = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', on);
    $('tab-' + tab.dataset.tab).hidden = !on;
  }
  $('sidebar').classList.add('open');
  drawCharts();
}

// ---------- Charts and bottom bar ----------

const traitMetric = (trait, label) => ({ label, floor: 0, valueOf: (s, id) => (s.counts[id] ? s.traits[id][trait] : null) });
const METRICS = {
  count: { fromZero: true, label: (v) => fmt(v) + ' creatures', valueOf: (s, id) => s.counts[id] ?? null },
  speed: traitMetric('speed', (v) => v.toFixed(2)),
  vision: traitMetric('vision', (v) => v.toFixed(0)),
  strength: traitMetric('strength', (v) => v.toFixed(2)),
  preferredTemp: { ...traitMetric('preferredTemp', (v) => v.toFixed(1) + '°C'), floor: -Infinity },
  diet: traitMetric('diet', (v) => Math.round(v * 100) + '% meat'),
};

function drawCharts() {
  const shown = shownSpecies();
  drawTimeline($('timeline'), history, shown, sim.tick);
  if ($('tab-charts').hidden) return;
  drawLineChart($('hist'), history, shown, sim.tick, METRICS[$('metric').value]);
  $('chartKey').innerHTML = livingSpecies().map((sp) => '<span>' + dot(sp.color) + sp.name + '</span>').join('');
  drawFamilyTree($('tree'), shown, sim.species, sim.tick);
}

function refreshClock() {
  const { year, season } = seasonAt(sim.tick);
  $('clock').textContent = 'Tick ' + fmt(sim.tick) + ' · Year ' + year + ' · ' + season
    + (sim.tick < sim.droughtUntil ? ' · Drought' : '');
}

function refreshMarkers() {
  const start = windowStart(sim.tick), span = windowSpan(sim.tick);
  $('markers').innerHTML = sim.events.filter((e) => e.tick >= start).map((e) =>
    '<span class="marker ' + e.kind + '" style="left:' + ((e.tick - start) / span * 100).toFixed(2) + '%" title="' +
    e.text + ' (tick ' + fmt(e.tick) + ')"></span>').join('');
}

function refreshAll() {
  refreshSpecies();
  refreshInspector();
  refreshEvents();
  refreshClock();
  refreshMarkers();
  refreshLegend();
  drawCharts();
  $('banner').hidden = sim.creatures.length > 0;
}

// ---------- Map overlays ----------

function terrainKey() {
  const colors = terrainColors();
  const swatch = (kind, name) => '<span><span class="sw" style="background:' + colors[kind] + '"></span>' + name + '</span>';
  return swatch(FERTILE, 'Fertile') + swatch(PLAIN, 'Plain') + swatch(DESERT, 'Desert') + swatch(MOUNTAIN, 'Mountain');
}

function territoryKey() {
  const living = livingSpecies();
  return living.slice(0, 6).map((sp) => '<span>' + dot(sp.color) + sp.name + '</span>').join('') +
    (living.length > 6 ? '<span>+' + (living.length - 6) + ' more</span>' : '');
}

const LEGENDS = {
  temperature: () => 'Cold<span class="ramp" style="background:linear-gradient(90deg,#378add,transparent,#e24b4a)"></span>Hot',
  fertility: () => 'Barren<span class="ramp" style="background:linear-gradient(90deg,transparent,#639922)"></span>Fertile',
  territory: territoryKey,
  none: terrainKey,
};
let legendShown = '';

function refreshLegend() {
  const html = LEGENDS[map.layer]();
  if (html === legendShown) return;
  legendShown = html;
  $('legend').innerHTML = html;
}

function setLayer(name) {
  map.layer = name;
  map.paintLayer();
  for (const b of $('layers').children) b.setAttribute('aria-pressed', b.dataset.layer === name);
  refreshLegend();
}

function setTool(name) {
  tool = name;
  for (const b of document.querySelectorAll('.tool')) b.setAttribute('aria-pressed', b.dataset.tool === name);
  canvas.classList.toggle('brush', name !== 'select');
  $('toolopts').hidden = !(name in TOOL_TIPS);
  $('kinds').hidden = name !== 'terrain';
  $('sizeRow').hidden = !BRUSH_TOOLS.includes(name);
  $('toolTip').textContent = TOOL_TIPS[name] || '';
  // Show the layer the tool changes.
  if (name === 'terrain') setLayer('none');
  if (name === 'warm' || name === 'cool') setLayer('temperature');
}

function brushRadius() {
  return tool === 'meteor' ? RULES.meteorRadius : +$('brushSize').value;
}

// The circle to outline under the pointer, in world pixels.
function brushOutline() {
  if (!hover || tool === 'select') return null;
  const at = camera.toWorld(hover.x, hover.y);
  return { x: at.x, y: at.y, radius: brushRadius() };
}

// ---------- World ----------

function newWorld(seed) {
  sim.generate(seed);
  showWorld();
}

// Points the page at whatever world the sim now holds (new or loaded).
// `savedHistory` is the chart history that came with a loaded world.
function showWorld(savedHistory = []) {
  history = savedHistory;
  worldEdited = true;
  debt = 0;
  eventsShown = -1;
  select(null);
  $('seedInput').value = sim.seed;
  // Keep the address bar shareable.
  window.history.replaceState(null, '', '?seed=' + sim.seed);
  map.paintWorld();
  map.paintLayer();
  if (!history.length) sample();
  refreshAll();
}

function sample() {
  history.push({ tick: sim.tick, counts: sim.species.map((sp) => sp.count), traits: sim.stats() });
  const start = windowStart(sim.tick);
  while (history.length > 1 && history[1].tick <= start) history.shift();
}

function tick() {
  for (const c of sim.creatures) {
    c.prevX = c.x;
    c.prevY = c.y;
  }
  sim.step(+$('fRate').value, +$('mut').value);
  if (sim.tick % SAMPLE_EVERY === 0) sample();
}

function frame() {
  const speed = SPEEDS[+$('spd').value];
  if (!paused && sim.creatures.length) {
    debt += speed;
    let ran = false;
    while (debt >= 1 && sim.creatures.length) {
      tick();
      debt -= 1;
      ran = true;
    }
    if (ran && ++frameCount % REFRESH_EVERY === 0) {
      map.paintLayer();
      refreshAll();
    }
  }
  const interp = speed < 1 && !paused ? debt : 1;
  const alive = selectedDiedAt === null ? selected : null;
  if (following && alive) {
    const glide = interp < 1 && alive.prevX !== undefined && Math.abs(alive.x - alive.prevX) < 50;
    camera.centerOn(
      glide ? alive.prevX + (alive.x - alive.prevX) * interp : alive.x,
      glide ? alive.prevY + (alive.y - alive.prevY) * interp : alive.y,
    );
  }
  map.draw(interp, alive, brushOutline());
  requestAnimationFrame(frame);
}

// ---------- Tools ----------

// One dab of the current brush at a point in the view.
function paint(sx, sy) {
  const at = camera.toWorld(sx, sy);
  if (at.y < 0 || at.y >= HEIGHT) return;
  worldEdited = true;
  const radius = brushRadius();
  if (tool === 'food') {
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * 6.283, distance = Math.sqrt(Math.random()) * radius;
      sim.addFood((at.x + Math.cos(angle) * distance + WIDTH) % WIDTH,
        Math.min(HEIGHT - 1, Math.max(0, at.y + Math.sin(angle) * distance)));
    }
  } else if (tool === 'terrain') {
    sim.paintTerrain(at.x, at.y, radius, brushKind);
    map.paintWorld();
    map.paintLayer();
  } else {
    sim.paintTemperature(at.x, at.y, radius, tool === 'warm' ? 0.8 : -0.8);
    map.paintLayer();
  }
}

function creatureNear(at) {
  const reach = Math.max(10, 16 / camera.zoom);
  let best = null, bestDistSq = reach * reach;
  for (const c of sim.creatures) {
    const dx = wrapDistance(c.x - at.x, WIDTH), dy = c.y - at.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = c;
    }
  }
  return best;
}

function clickMap(sx, sy) {
  const at = camera.toWorld(sx, sy);
  if (at.y < 0 || at.y >= HEIGHT) return;
  if (tool === 'meteor') {
    worldEdited = true;
    sim.meteor(at.x, at.y);
    map.paintWorld();
    map.paintLayer();
    refreshAll();
  } else if (tool === 'select') {
    select(creatureNear(at));
  }
}

// Drag to pan (or to paint, with a brush tool), pinch or scroll to zoom, click
// to use the current tool. With a brush, drag with the right or middle button
// (or two fingers) to pan.
const pointers = new Map();
let dragged = false;
let painting = false;
let pinchDist = 0;
let pinchMid = null;

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  pointers.set(e.pointerId, { ...pointerPos(e), startX: e.clientX, startY: e.clientY });
  if (pointers.size === 1) {
    dragged = false;
    painting = e.button === 0 && BRUSH_TOOLS.includes(tool);
    if (painting) paint(pointerPos(e).x, pointerPos(e).y);
  } else {
    painting = false;
  }
  pinchDist = 0;
  pinchMid = null;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerleave', () => { hover = null; });

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  const pos = pointerPos(e);
  hover = pos;
  if (!p) return;
  if (painting) {
    paint(pos.x, pos.y);
  } else if (pointers.size === 1) {
    if (!dragged && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 4) {
      dragged = true;
      canvas.classList.add('dragging');
      setFollowing(false); // panning by hand takes the camera back
    }
    if (dragged) camera.panBy(pos.x - p.x, pos.y - p.y);
  }
  p.x = pos.x;
  p.y = pos.y;
  if (pointers.size === 2) {
    dragged = true;
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (pinchDist) camera.zoomAt(mid.x, mid.y, dist / pinchDist);
    if (pinchMid) camera.panBy(mid.x - pinchMid.x, mid.y - pinchMid.y);
    pinchDist = dist;
    pinchMid = mid;
  }
});

function pointerEnd(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  pinchDist = 0;
  pinchMid = null;
  if (pointers.size === 0) {
    canvas.classList.remove('dragging');
    if (painting) refreshAll();
    else if (!dragged && e.type === 'pointerup' && e.button === 0) clickMap(p.x, p.y);
    painting = false;
  }
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const pos = pointerPos(e);
  camera.zoomAt(pos.x, pos.y, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

// ---------- Controls ----------

function togglePause() {
  paused = !paused;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
}

// ---------- Saving ----------
// Worlds are stored by the server in a SQLite file. The current run is
// autosaved every few seconds and restored when the page loads.

function setSaveStatus(text) {
  $('saveStatus').textContent = text;
}

// The world plus the chart history, ready to store.
const snapshot = () => ({ sim: sim.save(), history });

async function autosave() {
  if (savingNow || (sim.tick === autosavedTick && !worldEdited)) return;
  savingNow = true;
  const tick = sim.tick;
  try {
    await putSave(AUTOSAVE_NAME, snapshot());
    autosavedTick = tick;
    worldEdited = false;
    setSaveStatus('Autosaved at tick ' + fmt(tick) + '. A refresh picks up from there.');
    // Keep the list's autosave row current, unless a Delete button is waiting to be confirmed.
    if (!$('tab-settings').hidden && !$('saves').querySelector('.sure')) refreshSaves();
  } catch (error) {
    setSaveStatus('Autosave failed: ' + error.message);
  }
  savingNow = false;
}

async function saveWorld() {
  const name = $('saveName').value.trim();
  if (!name) return setSaveStatus('Type a name for this world first.');
  try {
    await putSave(name, snapshot());
    $('saveName').value = '';
    setSaveStatus('Saved "' + name + '" at tick ' + fmt(sim.tick) + '.');
    await refreshSaves();
  } catch (error) {
    setSaveStatus('Could not save: ' + error.message);
  }
}

// Replaces the running world with a stored one.
function restore(data) {
  sim.load(data.sim);
  showWorld(Array.isArray(data.history) ? data.history : []);
  autosavedTick = -1;
}

async function loadSave(id) {
  try {
    const saved = await getSave(id);
    restore(saved.data);
    setSaveStatus('Loaded "' + saved.name + '" from tick ' + fmt(saved.tick) + '.');
  } catch (error) {
    setSaveStatus('Could not load that world: ' + error.message);
  }
}

async function refreshSaves() {
  let saves;
  try {
    saves = await listSaves();
  } catch (error) {
    return setSaveStatus('Could not reach the saved worlds: ' + error.message);
  }
  const list = $('saves');
  list.textContent = '';
  for (const save of saves) {
    const item = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = save.name; // names are typed by the user, so never set as HTML
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = 'Tick ' + fmt(save.tick) + ' · ' + new Date(save.updated_at).toLocaleString();
    info.append(title, meta);

    const load = document.createElement('button');
    load.textContent = 'Load';
    load.onclick = () => loadSave(save.id);
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.onclick = async () => {
      // Ask once more before deleting: the first click only arms the button.
      if (!remove.classList.contains('sure')) {
        remove.classList.add('sure');
        remove.textContent = 'Really delete?';
        return;
      }
      try {
        await deleteSave(save.id);
        if (save.autosave) worldEdited = true; // so the running world is autosaved again
      } catch (error) {
        setSaveStatus('Could not delete: ' + error.message);
      }
      refreshSaves();
    };
    item.append(info, load, remove);
    list.append(item);
  }
}

// On page load: carry on from the autosave unless the address asks for a
// different world; otherwise start the world the address (or chance) picked.
async function start() {
  let restored = false;
  try {
    const saved = await getAutosave();
    if (saved && (!hasUrlSeed || saved.seed === sim.seed)) {
      restore(saved.data);
      autosavedTick = sim.tick;
      setSaveStatus('Picked up the autosave from tick ' + fmt(sim.tick) + '.');
      restored = true;
    }
  } catch (error) {
    setSaveStatus('Could not restore the autosave: ' + error.message);
  }
  if (!restored) newWorld(sim.seed);
  refreshSaves();
  setInterval(autosave, AUTOSAVE_EVERY_MS);
  // One last save when the tab is hidden or closed, while the page can still send it.
  document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
  frame();
}

function loadSeed() {
  const seed = Number($('seedInput').value);
  if (Number.isInteger(seed) && seed > 0) newWorld(seed);
  else $('seedInput').value = sim.seed;
}

$('fRate').oninput = (e) => ($('fOut').textContent = (+e.target.value).toFixed(1));
$('mut').oninput = (e) => ($('mutOut').textContent = (+e.target.value).toFixed(1));
$('spd').oninput = (e) => ($('spdOut').textContent = SPEEDS[+e.target.value] + 'x');
const disaster = (strike) => () => { strike(); worldEdited = true; refreshAll(); };
$('heat').onclick = disaster(sim.heatWave);
$('cold').onclick = disaster(sim.coldSnap);
$('drought').onclick = disaster(sim.drought);
$('plague').onclick = disaster(sim.plague);
$('saveWorld').onclick = saveWorld;
$('saveName').onkeydown = (e) => { if (e.key === 'Enter') saveWorld(); };
for (const b of $('kinds').children) {
  b.onclick = () => {
    brushKind = b.dataset.kind;
    for (const other of $('kinds').children) other.setAttribute('aria-pressed', other === b);
  };
}
$('pause').onclick = togglePause;
$('reset').onclick = () => newWorld(randomSeed());
$('bannerNew').onclick = () => newWorld(randomSeed());
$('seedLoad').onclick = loadSeed;
$('seedInput').onkeydown = (e) => { if (e.key === 'Enter') loadSeed(); };
$('metric').onchange = drawCharts;
$('inspClear').onclick = () => select(null);
$('inspFollow').onclick = () => {
  setFollowing(!following);
  // Zoom in enough to make following worthwhile.
  if (following && camera.zoom < 2) camera.zoomAt(camera.viewW / 2, camera.viewH / 2, 2 / camera.zoom);
};
$('zoomIn').onclick = () => camera.zoomAt(camera.viewW / 2, camera.viewH / 2, 1.5);
$('zoomOut').onclick = () => camera.zoomAt(camera.viewW / 2, camera.viewH / 2, 1 / 1.5);
$('zoomFit').onclick = () => { setFollowing(false); camera.fit(); };
$('handle').onclick = () => $('sidebar').classList.toggle('open');
for (const b of $('layers').children) b.onclick = () => setLayer(b.dataset.layer);
for (const b of document.querySelectorAll('.tool')) b.onclick = () => setTool(b.dataset.tool);
for (const tab of document.querySelectorAll('.tabs [role=tab]')) {
  tab.onclick = () => {
    const sidebar = $('sidebar');
    // On narrow screens, tapping the open tab again folds the sheet away.
    if (tab.getAttribute('aria-selected') === 'true' && sidebar.classList.contains('open')
        && matchMedia('(max-width: 760px)').matches) sidebar.classList.remove('open');
    else showTab(tab.dataset.tab);
  };
}

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input[type=text], select')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePause();
  } else if (e.key >= '1' && e.key <= '6') {
    setTool(['select', 'food', 'terrain', 'warm', 'cool', 'meteor'][e.key - 1]);
  }
});

new ResizeObserver(() => map.resize()).observe($('map'));

map.resize();
camera.fill();
setLayer('none');
start();
