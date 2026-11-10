// Wires the page together: the animation loop, tools, panels and bottom bar.
// The simulation rules live in ../sim/.

import { createSim } from '../sim/sim.js';
import { randomSeed } from '../sim/rng.js';
import { RULES } from '../sim/params.js';
import { WIDTH, HEIGHT, PLAIN, FERTILE, DESERT, MOUNTAIN, cellIndex, seasonAt, wrapDistance } from '../sim/world.js';
import { createCamera } from './camera.js';
import { createMapView, terrainColors } from './mapview.js';
import { AUTOSAVE_NAME, listSaves, getSave, getAutosave, putSave, deleteSave } from './saves.js';
import { METRICS, SAMPLE_EVERY, drawLineChart, drawTimeline, drawFamilyTree, windowStart, windowSpan } from './charts.js';

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
const CHECKPOINT_EVERY = 400; // ticks between the checkpoints that rewinding uses
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

// Rewinding. The page keeps a checkpoint of the whole world every so often.
// Dragging the timeline loads the checkpoint before the chosen tick and
// replays forward to it. Until the sim runs or is edited again, everything up
// to `latestTick` is kept, so you can scrub back and forth; after that, the
// run carries on from where you are and the old future is dropped.
let checkpoints = [];      // [{ tick, text, foodRate, mutationRate }], oldest first
let latestTick = 0;        // the newest tick this run has reached ("now")
let scrubbing = false;     // the timeline is being dragged
const inPast = () => sim.tick < latestTick;
let selected = null;       // the creature shown in the Inspector
let selectedDiedAt = null; // tick at which it died, if it has
let following = false;     // keep the camera on the selected creature
let history = [];          // samples: { tick, counts, traits }
let debt = 0;              // fractional ticks owed to the simulation
let frameCount = 0;
let meteorDrawnAt = -1;    // tick of the newest meteor whose scorch mark is drawn
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

// Cards are built once per species and then updated in place, so a click on
// a card's header is never lost to a redraw.
const cards = new Map(); // species id -> { root, count, share, facts }
let allCollapsed = readPreference('lifesim.cardsCollapsed') === 'yes';
const flipped = new Set(); // species whose card differs from the "all" setting
const isCollapsed = (id) => allCollapsed !== flipped.has(id);

function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function showCollapsed(id) {
  const card = cards.get(id);
  card.root.classList.toggle('collapsed', isCollapsed(id));
  card.head.setAttribute('aria-expanded', !isCollapsed(id));
}

function makeCard(sp) {
  const root = document.createElement('div');
  root.className = 'card';
  root.innerHTML =
    '<button class="cardhead" title="Show or hide details">' + dot(sp.color) + '<span class="name"></span><span class="count"></span>' +
    '<svg class="chev" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5l4 4 4-4"/></svg></button>' +
    '<div class="share"><i style="background:' + sp.color + '"></i></div><dl class="facts"></dl>';
  const card = {
    root,
    head: root.querySelector('.cardhead'),
    count: root.querySelector('.count'),
    share: root.querySelector('.share i'),
    facts: root.querySelector('.facts'),
  };
  root.querySelector('.name').textContent = sp.name;
  card.head.onclick = () => {
    if (!flipped.delete(sp.id)) flipped.add(sp.id);
    showCollapsed(sp.id);
  };
  cards.set(sp.id, card);
  showCollapsed(sp.id);
  return card;
}

function setAllCollapsed(on) {
  allCollapsed = on;
  flipped.clear();
  for (const id of cards.keys()) showCollapsed(id);
  $('collapseAll').textContent = on ? 'Expand all' : 'Collapse all';
  try { localStorage.setItem('lifesim.cardsCollapsed', on ? 'yes' : 'no'); } catch { /* not remembered */ }
}

function refreshSpecies() {
  const stats = sim.stats();
  const living = livingSpecies();
  const total = sim.creatures.length || 1;
  $('speciesSummary').textContent = fmt(sim.creatures.length) + ' creatures · ' + living.length + ' species';

  const livingIds = new Set(living.map((sp) => sp.id));
  for (const [id, card] of cards) {
    if (livingIds.has(id)) continue;
    card.root.remove();
    cards.delete(id);
  }
  const container = $('cards');
  living.forEach((sp, position) => {
    const card = cards.get(sp.id) || makeCard(sp);
    const st = stats[sp.id];
    card.count.textContent = fmt(sp.count);
    card.share.style.width = (sp.count / total * 100) + '%';
    card.facts.innerHTML =
      (sp.parent !== null ? '<dt>Split from</dt><dd>' + sim.species[sp.parent].name + '</dd>' : '') +
      '<dt>Diet</dt><dd>' + dietWords(st.diet) + '</dd>' +
      '<dt>Can swim</dt><dd>' + Math.round(st.swimmers * 100) + '%</dd>' +
      '<dt>Speed</dt><dd>' + st.speed.toFixed(1) + '</dd>' +
      '<dt>Strength</dt><dd>' + st.strength.toFixed(1) + '</dd>' +
      '<dt>Vision</dt><dd>' + Math.round(st.vision) + '</dd>' +
      '<dt>Prefers</dt><dd>' + Math.round(st.preferredTemp) + '°C</dd>' +
      '<dt>Kills</dt><dd>' + fmt(sp.kills) + '</dd>' +
      '<dt>Latest generation</dt><dd>' + st.maxGeneration + '</dd>';
    // Keep the cards sorted by population, moving one only when its place changed.
    if (container.children[position] !== card.root) container.insertBefore(card.root, container.children[position] || null);
  });
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
  $('inspSwims').textContent = c.swimmer ? 'Yes' : 'No';
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
  // A meteor that struck by itself has scorched the land, so redraw the terrain.
  if (sim.events.some((e) => e.kind === 'meteor' && e.tick > meteorDrawnAt)) {
    meteorDrawnAt = newest;
    map.paintWorld();
  }
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

function drawCharts() {
  const shown = shownSpecies();
  drawTimeline($('timeline'), history, shown, latestTick);
  if ($('tab-charts').hidden) return;
  drawLineChart($('hist'), history, shown, latestTick, METRICS[$('metric').value]);
  $('chartKey').innerHTML = livingSpecies().map((sp) => '<span>' + dot(sp.color) + sp.name + '</span>').join('');
  drawFamilyTree($('tree'), shown, sim.species, sim.tick);
}

function refreshClock() {
  const { year, season } = seasonAt(sim.tick);
  $('clock').textContent = (inPast() ? 'Viewing tick ' + fmt(sim.tick) + ' of ' + fmt(latestTick) : 'Tick ' + fmt(sim.tick))
    + ' · Year ' + year + ' · ' + season + (sim.tick < sim.droughtUntil ? ' · Drought' : '');
  $('toNow').hidden = !inPast();
  $('pause').textContent = !paused ? 'Pause' : inPast() ? 'Resume from here' : 'Resume';
}

// Where a tick sits along the timeline, as a percentage of its width.
function timelinePercent(tick) {
  return (tick - windowStart(latestTick)) / windowSpan(latestTick) * 100;
}

// Event marks, the playhead, and the dimmed stretch after it when viewing the past.
function refreshMarkers() {
  const start = windowStart(latestTick);
  $('markers').innerHTML = sim.events.filter((e) => e.tick >= start).map((e) =>
    '<span class="marker ' + e.kind + '" style="left:' + timelinePercent(e.tick).toFixed(2) + '%"></span>').join('');
  const at = Math.max(0, timelinePercent(sim.tick));
  $('playhead').style.left = at + '%';
  $('future').hidden = !inPast();
  $('future').style.left = at + '%';
  $('future').style.right = (100 - timelinePercent(latestTick)) + '%';
}

// The swimmer share and random disasters are part of the world's settings, so
// a loaded or rewound world brings its own values back to the controls.
function refreshWorldSettings() {
  $('autoDisasters').checked = !!sim.params.autoDisasters;
  if (document.activeElement === $('swimShare')) return;
  const percent = Math.round(sim.params.swimmerShare * 100);
  $('swimShare').value = percent;
  $('swimOut').textContent = percent + '%';
}

function refreshAll() {
  refreshWorldSettings();
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
  checkpoints = [];
  latestTick = sim.tick;
  checkpoint();
  cards.clear();
  flipped.clear();
  $('cards').textContent = '';
  debt = 0;
  eventsShown = -1;
  meteorDrawnAt = sim.tick;
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

// ---------- Rewinding ----------

// Records the whole world at this tick so the timeline can come back to it.
function checkpoint() {
  checkpoints = checkpoints.filter((c) => c.tick < sim.tick);
  checkpoints.push({
    tick: sim.tick,
    text: JSON.stringify(sim.save()),
    foodRate: +$('fRate').value,
    mutationRate: +$('mut').value,
  });
  // Keep one checkpoint at or before the start of the timeline, and drop older ones.
  const start = windowStart(latestTick);
  while (checkpoints.length > 1 && checkpoints[1].tick <= start) checkpoints.shift();
}

// The run is about to change from a point in the past: that point becomes
// "now", and what used to come after it is dropped.
function branchHere() {
  if (!inPast()) return;
  latestTick = sim.tick;
  history = history.filter((s) => s.tick <= sim.tick);
  checkpoints = checkpoints.filter((c) => c.tick <= sim.tick);
}

// Call after the user changes the world by hand (a brush stroke or a disaster).
function worldWasEdited() {
  worldEdited = true;
  checkpoint();
}

// Moves the world to `target`, pausing it. With `exact`, replays from the
// checkpoint before `target` to land on that very tick; without, stops at the
// checkpoint, which is quick enough to do while the timeline is being dragged.
function goTo(target, exact) {
  if (!checkpoints.length) return;
  // Leaving the present: make sure we can come back to it.
  if (!inPast() && checkpoints[checkpoints.length - 1].tick !== sim.tick) checkpoint();
  target = Math.min(latestTick, Math.max(checkpoints[0].tick, Math.round(target)));
  let from = checkpoints[0];
  for (const c of checkpoints) if (c.tick <= target) from = c;

  paused = true;
  debt = 0;
  // The world can stay as it is if it is already at the checkpoint, or (when
  // replaying) somewhere between the checkpoint and the target.
  const reuse = exact ? sim.tick >= from.tick && sim.tick <= target : sim.tick === from.tick;
  if (reuse && (!exact || sim.tick === target)) {
    refreshClock();
    refreshMarkers();
    return;
  }
  if (!reuse) sim.load(JSON.parse(from.text));
  if (exact) while (sim.tick < target && sim.creatures.length) sim.step(from.foodRate, from.mutationRate);

  eventsShown = -1;
  meteorDrawnAt = sim.tick;
  select(null);
  map.paintWorld();
  map.paintLayer();
  refreshAll();
}

function tick() {
  branchHere();
  for (const c of sim.creatures) {
    c.prevX = c.x;
    c.prevY = c.y;
  }
  sim.step(+$('fRate').value, +$('mut').value);
  latestTick = sim.tick;
  if (sim.tick % SAMPLE_EVERY === 0) sample();
  if (sim.tick % CHECKPOINT_EVERY === 0) checkpoint();
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
  branchHere();
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
    branchHere();
    sim.meteor(at.x, at.y);
    worldWasEdited();
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
    if (painting) {
      worldWasEdited(); // one checkpoint per brush stroke
      refreshAll();
    } else if (!dragged && e.type === 'pointerup' && e.button === 0) clickMap(p.x, p.y);
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
  refreshClock();
}

// ---------- Timeline scrubbing ----------

const timelineBox = $('timelineBox');

function timelinePointer(e) {
  const rect = timelineBox.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const tick = Math.round(windowStart(latestTick) + fraction * windowSpan(latestTick));
  return { x: fraction * rect.width, width: rect.width, tick: Math.min(latestTick, Math.max(checkpoints[0]?.tick ?? 0, tick)) };
}

// Shows the tick under the pointer, and any event marked within a few pixels of it.
function showScrubTip(e) {
  const at = timelinePointer(e);
  const ticksPerPixel = windowSpan(latestTick) / at.width;
  let near = null;
  for (const event of sim.events) {
    const gap = Math.abs(event.tick - at.tick);
    if (gap <= ticksPerPixel * 5 && (!near || gap < Math.abs(near.tick - at.tick))) near = event;
  }
  const tip = $('scrubTip'), x = timelinePercent(at.tick) / 100 * at.width;
  tip.textContent = 'Tick ' + fmt(at.tick) + (near ? ' · ' + near.text : '');
  tip.hidden = false;
  tip.style.left = Math.min(at.width - tip.offsetWidth / 2, Math.max(tip.offsetWidth / 2, x)) + 'px';
  $('scrubLine').hidden = false;
  $('scrubLine').style.left = x + 'px';
  return at;
}

function hideScrubTip() {
  $('scrubTip').hidden = true;
  $('scrubLine').hidden = true;
}

timelineBox.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  try { timelineBox.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  scrubbing = true;
  goTo(showScrubTip(e).tick, false);
});
timelineBox.addEventListener('pointermove', (e) => {
  const at = showScrubTip(e);
  if (scrubbing) goTo(at.tick, false);
});
function scrubEnd(e) {
  if (!scrubbing) return;
  scrubbing = false;
  goTo(timelinePointer(e).tick, true); // land on the exact tick
  if (e.pointerType !== 'mouse') hideScrubTip();
}
timelineBox.addEventListener('pointerup', scrubEnd);
timelineBox.addEventListener('pointercancel', scrubEnd);
timelineBox.addEventListener('pointerleave', () => { if (!scrubbing) hideScrubTip(); });

// ---------- Saving ----------
// Worlds are stored by the server in a SQLite file. The current run is
// autosaved every few seconds and restored when the page loads.

function setSaveStatus(text) {
  $('saveStatus').textContent = text;
}

// The world plus the chart history, ready to store.
const snapshot = () => ({ sim: sim.save(), history });

async function autosave() {
  // While looking at the past, leave the autosave at the present.
  if (savingNow || inPast() || (sim.tick === autosavedTick && !worldEdited)) return;
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
$('swimShare').oninput = (e) => {
  sim.params.swimmerShare = +e.target.value / 100;
  $('swimOut').textContent = e.target.value + '%';
  worldEdited = true;
};
$('autoDisasters').onchange = (e) => {
  sim.params.autoDisasters = e.target.checked;
  worldEdited = true;
};
$('spd').oninput = (e) => ($('spdOut').textContent = SPEEDS[+e.target.value] + 'x');
const disaster = (strike) => () => { branchHere(); strike(); worldWasEdited(); refreshAll(); };
$('toNow').onclick = () => goTo(latestTick, true);
$('collapseAll').onclick = () => setAllCollapsed(!allCollapsed);
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

// The pop-out charts window (templates/charts.html) reads the live data from here.
window.lifesimCharts = {
  read: () => ({
    history,
    shown: shownSpecies(),
    living: livingSpecies(),
    species: sim.species,
    latestTick,
    tick: sim.tick,
    seed: sim.seed,
  }),
};
// "Expand here" shows the same charts page over this one, for when a separate
// window is not wanted or the browser will not open one.
function setChartsOverlay(open) {
  const overlay = $('chartsOverlay');
  overlay.hidden = !open;
  let frame = overlay.querySelector('iframe');
  if (open && !frame) {
    frame = document.createElement('iframe');
    frame.src = '/charts';
    frame.title = 'Charts';
    overlay.append(frame);
  } else if (!open && frame) {
    frame.remove(); // stops it redrawing while out of sight
  }
}
$('expandCharts').onclick = () => setChartsOverlay(true);
$('closeCharts').onclick = () => setChartsOverlay(false);

let chartsWindow = null;
$('popCharts').onclick = () => {
  // Bring the charts window forward if it is still open; otherwise open one.
  if (!chartsWindow || chartsWindow.closed) chartsWindow = window.open('/charts', '_blank', 'popup,width=1280,height=860');
  $('popHint').hidden = !!chartsWindow;
  if (chartsWindow) chartsWindow.focus();
};
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
  if (e.key === 'Escape' && !$('chartsOverlay').hidden) return setChartsOverlay(false);
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
setAllCollapsed(allCollapsed);
start();
