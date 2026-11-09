// Wires the page together: the animation loop, tools, panels and bottom bar.
// The simulation rules live in ../sim/.

import { createSim } from '../sim/sim.js';
import { randomSeed } from '../sim/rng.js';
import { RULES } from '../sim/params.js';
import { WIDTH, HEIGHT, cellIndex, seasonAt, wrapDistance } from '../sim/world.js';
import { createCamera } from './camera.js';
import { createMapView } from './mapview.js';
import { SAMPLE_EVERY, drawPopulationChart, drawTimeline, windowStart, windowSpan } from './charts.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 12];
const REFRESH_EVERY = 6; // frames between panel and layer refreshes
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// Open the page with ?seed=123 to replay a particular world.
const urlSeed = Number(new URLSearchParams(location.search).get('seed'));
const sim = createSim({ seed: Number.isInteger(urlSeed) && urlSeed > 0 ? urlSeed : randomSeed() });
const species = sim.species;

const canvas = $('world');
const camera = createCamera(WIDTH, HEIGHT);
const map = createMapView(canvas, sim, camera);

let paused = false;
let tool = 'select';       // 'select' | 'food'
let selected = null;       // the creature shown in the Inspector
let selectedDiedAt = null; // tick at which it died, if it has
let history = [];          // [{ tick, counts }]
let events = [];           // [{ tick, kind, label }]
let alive = species.map(() => true);
let debt = 0;              // fractional ticks owed to the simulation
let frameCount = 0;

// ---------- Panels ----------

function buildSpeciesCards() {
  $('cards').innerHTML = species.map((sp, i) =>
    '<div class="card" id="card' + i + '">' +
    '<div class="name"><span class="dot" style="background:' + sp.color + '"></span>' + sp.name + '</div>' +
    '<div class="count" id="count' + i + '">0</div>' +
    '<div class="share"><i id="share' + i + '" style="background:' + sp.color + '"></i></div>' +
    '<dl class="facts" id="facts' + i + '"></dl></div>').join('');
  $('chartKey').innerHTML = species.map((sp) =>
    '<span><span class="dot" style="background:' + sp.color + '"></span>' + sp.name + '</span>').join('');
}

function refreshSpecies() {
  const stats = sim.stats();
  const total = stats.reduce((sum, st) => sum + st.count, 0) || 1;
  stats.forEach((st, i) => {
    $('card' + i).classList.toggle('extinct', !st.count);
    $('count' + i).textContent = st.count ? fmt(st.count) : 'Extinct';
    $('share' + i).style.width = (st.count / total * 100) + '%';
    $('facts' + i).innerHTML = st.count
      ? '<dt>Speed</dt><dd>' + st.speed.toFixed(1) + '</dd>' +
        '<dt>Strength</dt><dd>' + st.strength.toFixed(1) + '</dd>' +
        '<dt>Vision</dt><dd>' + Math.round(st.vision) + '</dd>' +
        '<dt>Prefers</dt><dd>' + Math.round(st.preferredTemp) + '°C</dd>' +
        '<dt>Kills</dt><dd>' + fmt(st.kills) + '</dd>' +
        '<dt>Latest generation</dt><dd>' + st.maxGeneration + '</dd>'
      : '<dt>Kills before dying out</dt><dd>' + fmt(st.kills) + '</dd>';

    if (alive[i] && !st.count) addEvent('extinct', species[i].name + ' died out');
    alive[i] = st.count > 0;
  });
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
  if (selectedDiedAt === null && !sim.creatures.includes(c)) selectedDiedAt = sim.tick;

  const sp = species[c.species];
  const here = sim.temperature[cellIndex(c.x, c.y)];
  const gap = here - c.preferredTemp;
  const stressed = Math.abs(gap) > sim.params.tempTolerance;
  let status;
  if (selectedDiedAt !== null) status = 'Died at tick ' + fmt(selectedDiedAt);
  else status = [c.thirsty ? 'Thirsty' : null, stressed ? (gap > 0 ? 'Too hot' : 'Too cold') : null]
    .filter(Boolean).join(' · ') || 'Comfortable';

  $('inspTitle').innerHTML = '<span class="dot" style="background:' + sp.color + '"></span>' + sp.name;
  $('inspStatus').textContent = status;
  setMeter('inspEnergy', Math.max(0, c.energy).toFixed(0) + ' (splits above ' + RULES.breedEnergy + ')', c.energy / RULES.breedEnergy);
  setMeter('inspWater', Math.max(0, c.hydration).toFixed(0) + ' of 100', c.hydration / 100);
  setMeter('inspAge', fmt(c.age) + ' of ' + fmt(RULES.maxAge) + ' ticks', c.age / RULES.maxAge);
  $('inspGen').textContent = c.generation;
  $('inspSpeed').textContent = c.speed.toFixed(2);
  $('inspVision').textContent = c.vision.toFixed(0);
  $('inspStrength').textContent = c.strength.toFixed(2);
  $('inspPrefers').textContent = c.preferredTemp.toFixed(1) + '°C';
  $('inspHere').textContent = here.toFixed(1) + '°C';
}

function select(creature) {
  selected = creature;
  selectedDiedAt = null;
  refreshInspector();
  if (creature) showTab('inspector');
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

// ---------- Bottom bar ----------

function addEvent(kind, label) {
  events.push({ tick: sim.tick, kind, label });
}

function refreshClock() {
  const { year, season } = seasonAt(sim.tick);
  $('clock').textContent = 'Tick ' + fmt(sim.tick) + ' · Year ' + year + ' · ' + season;
}

function refreshMarkers() {
  const start = windowStart(sim.tick), span = windowSpan(sim.tick);
  events = events.filter((e) => e.tick >= start);
  $('markers').innerHTML = events.map((e) =>
    '<span class="marker ' + e.kind + '" style="left:' + ((e.tick - start) / span * 100).toFixed(2) + '%" title="' +
    e.label + ' (tick ' + fmt(e.tick) + ')"></span>').join('');
}

function drawCharts() {
  drawPopulationChart($('hist'), history, species, sim.tick);
  drawTimeline($('timeline'), history, species, sim.tick);
}

function refreshAll() {
  refreshSpecies();
  refreshInspector();
  refreshClock();
  refreshMarkers();
  drawCharts();
  $('banner').hidden = sim.creatures.length > 0;
}

// ---------- Map overlays ----------

const LEGENDS = {
  temperature: 'Cold<span class="ramp" style="background:linear-gradient(90deg,#378add,transparent,#e24b4a)"></span>Hot',
  fertility: 'Barren<span class="ramp" style="background:linear-gradient(90deg,transparent,#639922)"></span>Fertile',
  territory: () => species.map((sp) => '<span><span class="dot" style="background:' + sp.color + '"></span>' + sp.name + '</span>').join(''),
  none: '',
};

function setLayer(name) {
  map.layer = name;
  map.paintLayer();
  for (const b of $('layers').children) b.setAttribute('aria-pressed', b.dataset.layer === name);
  const legend = LEGENDS[name];
  $('legend').innerHTML = typeof legend === 'function' ? legend() : legend;
}

function setTool(name) {
  tool = name;
  for (const b of document.querySelectorAll('.tool')) b.setAttribute('aria-pressed', b.dataset.tool === name);
  canvas.classList.toggle('food', name === 'food');
}

// ---------- World ----------

function newWorld(seed) {
  sim.generate(seed);
  history = [];
  events = [];
  alive = species.map(() => true);
  debt = 0;
  selected = null;
  $('seedInput').value = sim.seed;
  // Keep the address bar shareable.
  window.history.replaceState(null, '', '?seed=' + sim.seed);
  map.paintWater();
  map.paintLayer();
  sample();
  refreshAll();
}

function sample() {
  const counts = species.map(() => 0);
  for (const c of sim.creatures) counts[c.species]++;
  history.push({ tick: sim.tick, counts });
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
  map.draw(speed < 1 && !paused ? debt : 1, selectedDiedAt === null ? selected : null);
  requestAnimationFrame(frame);
}

// ---------- Tools ----------

function dropFood(at) {
  for (let i = 0; i < 30; i++) {
    const x = (at.x + (Math.random() - 0.5) * 60 + WIDTH) % WIDTH;
    const y = Math.min(HEIGHT - 1, Math.max(0, at.y + (Math.random() - 0.5) * 60));
    sim.addFood(x, y);
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
  if (tool === 'food') dropFood(at);
  else select(creatureNear(at));
}

// Drag to pan, pinch or scroll to zoom, click to use the current tool.
const pointers = new Map();
let dragged = false;
let pinchDist = 0;

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  pointers.set(e.pointerId, { ...pointerPos(e), startX: e.clientX, startY: e.clientY });
  if (pointers.size === 1) dragged = false;
  pinchDist = 0;
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const pos = pointerPos(e);
  if (pointers.size === 1) {
    if (!dragged && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 4) {
      dragged = true;
      canvas.classList.add('dragging');
    }
    if (dragged) camera.panBy(pos.x - p.x, pos.y - p.y);
  }
  p.x = pos.x;
  p.y = pos.y;
  if (pointers.size === 2) {
    dragged = true;
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist) camera.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinchDist);
    pinchDist = dist;
  }
});

function pointerEnd(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  pinchDist = 0;
  if (pointers.size === 0) {
    canvas.classList.remove('dragging');
    if (!dragged && e.type === 'pointerup') clickMap(p.x, p.y);
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

function weather(boost, kind, label) {
  sim.temperatureBoost = boost;
  addEvent(kind, label);
  refreshMarkers();
}

function loadSeed() {
  const seed = Number($('seedInput').value);
  if (Number.isInteger(seed) && seed > 0) newWorld(seed);
  else $('seedInput').value = sim.seed;
}

$('fRate').oninput = (e) => ($('fOut').textContent = (+e.target.value).toFixed(1));
$('mut').oninput = (e) => ($('mutOut').textContent = (+e.target.value).toFixed(1));
$('spd').oninput = (e) => ($('spdOut').textContent = SPEEDS[+e.target.value] + 'x');
$('heat').onclick = () => weather(9, 'heat', 'Heat wave');
$('cold').onclick = () => weather(-9, 'cold', 'Cold snap');
$('pause').onclick = togglePause;
$('reset').onclick = () => newWorld(randomSeed());
$('bannerNew').onclick = () => newWorld(randomSeed());
$('seedLoad').onclick = loadSeed;
$('seedInput').onkeydown = (e) => { if (e.key === 'Enter') loadSeed(); };
$('inspClear').onclick = () => select(null);
$('zoomIn').onclick = () => camera.zoomAt(camera.viewW / 2, camera.viewH / 2, 1.5);
$('zoomOut').onclick = () => camera.zoomAt(camera.viewW / 2, camera.viewH / 2, 1 / 1.5);
$('zoomFit').onclick = () => camera.fit();
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
  if (e.target.matches('input[type=text]')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePause();
  } else if (e.key === '1') setTool('select');
  else if (e.key === '2') setTool('food');
});

new ResizeObserver(() => map.resize()).observe($('map'));

map.resize();
camera.fill();
buildSpeciesCards();
setLayer('temperature');
newWorld(sim.seed);
frame();
