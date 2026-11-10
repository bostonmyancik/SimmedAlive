// Wires the page together: the animation loop, tools, panels and bottom bar.
// The simulation rules live in ../sim/.

import { createSim } from '../sim/sim.js';
import { randomSeed } from '../sim/rng.js';
import { RULES } from '../sim/params.js';
import { WIDTH, HEIGHT, PLAIN, FERTILE, DESERT, MOUNTAIN, cellIndex, seasonAt, wrapDistance } from '../sim/world.js';
import { createCamera } from './camera.js';
import { createMapView, terrainColors } from './mapview.js';
import { SAMPLE_EVERY, drawLineChart, drawTimeline, drawFamilyTree, windowStart, windowSpan } from './charts.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 12];
const REFRESH_EVERY = 6; // frames between panel and layer refreshes
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const dot = (color) => '<span class="dot" style="background:' + color + '"></span>';

// Open the page with ?seed=123 to replay a particular world.
const urlSeed = Number(new URLSearchParams(location.search).get('seed'));
const sim = createSim({ seed: Number.isInteger(urlSeed) && urlSeed > 0 ? urlSeed : randomSeed() });

const canvas = $('world');
const camera = createCamera(WIDTH, HEIGHT);
const map = createMapView(canvas, sim, camera);

let paused = false;
let tool = 'select';       // 'select' | 'food'
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
  $('clock').textContent = 'Tick ' + fmt(sim.tick) + ' · Year ' + year + ' · ' + season;
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
  canvas.classList.toggle('food', name === 'food');
}

// ---------- World ----------

function newWorld(seed) {
  sim.generate(seed);
  history = [];
  debt = 0;
  eventsShown = -1;
  select(null);
  $('seedInput').value = sim.seed;
  // Keep the address bar shareable.
  window.history.replaceState(null, '', '?seed=' + sim.seed);
  map.paintWorld();
  map.paintLayer();
  sample();
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
  map.draw(interp, alive);
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

function loadSeed() {
  const seed = Number($('seedInput').value);
  if (Number.isInteger(seed) && seed > 0) newWorld(seed);
  else $('seedInput').value = sim.seed;
}

$('fRate').oninput = (e) => ($('fOut').textContent = (+e.target.value).toFixed(1));
$('mut').oninput = (e) => ($('mutOut').textContent = (+e.target.value).toFixed(1));
$('spd').oninput = (e) => ($('spdOut').textContent = SPEEDS[+e.target.value] + 'x');
$('heat').onclick = () => { sim.heatWave(); refreshAll(); };
$('cold').onclick = () => { sim.coldSnap(); refreshAll(); };
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
  } else if (e.key === '1') setTool('select');
  else if (e.key === '2') setTool('food');
});

new ResizeObserver(() => map.resize()).observe($('map'));

map.resize();
camera.fill();
setLayer('none');
newWorld(sim.seed);
frame();
