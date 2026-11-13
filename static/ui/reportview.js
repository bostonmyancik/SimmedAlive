// The full report window (templates/report.html). It asks the life sim page
// that opened it for a report (see report.js) and lays it out. The report is a
// snapshot: press Refresh to rebuild it from the world as it is now.

import { METRICS, drawLineChart, drawFamilyTree } from './charts.js';
import { speciesCsv } from './report.js';
import { storyText } from './story.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (n) => (n === null || n === undefined ? '–' : Math.round(n).toLocaleString('en-US'));
const num = (n, places = 1) => (n === null || n === undefined ? '–' : n.toFixed(places));
const pct = (n) => (n === null || n === undefined ? '–' : n > 0 && n < 0.01 ? '<1%' : Math.round(n * 100) + '%');
const dot = (color) => '<span class="dot" style="background:' + esc(color) + '"></span>';
const named = (name, color) => (color ? dot(color) : '') + esc(name);

const LAND = [
  ['water', 'Water', '#3b82c4'], ['plain', 'Plain', '#9cbf5f'], ['fertile', 'Fertile', '#4f9a3c'],
  ['desert', 'Desert', '#d9b45b'], ['mountain', 'Mountain', '#8a8076'],
];
const EVENT_NAMES = {
  species: 'New species', evolve: 'Evolution', ability: 'Abilities', extinct: 'Extinctions', boom: 'Booms', crash: 'Crashes',
  heat: 'Heat waves', cold: 'Cold snaps', drought: 'Droughts', plague: 'Plagues', meteor: 'Meteors', sickness: 'Sickness', mutation: 'Mutation',
};

let latest = null;       // { report, chart } from the life sim page
let eventKind = null;    // the event kind shown, or null for all

function host() {
  if (window.opener && !window.opener.closed) return window.opener;
  return window.parent !== window ? window.parent : null;
}

function source() {
  try {
    return host()?.lifesimCharts?.report ? host().lifesimCharts : null;
  } catch {
    return null;
  }
}

const tile = (label, value, sub = '') =>
  '<div class="tile"><div class="label">' + label + '</div><div class="value">' + value + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';

const table = (head, rows) =>
  '<thead><tr>' + head.map(([text, cls]) => '<th' + (cls ? ' class="' + cls + '"' : '') + '>' + text + '</th>').join('') + '</tr></thead>' +
  '<tbody>' + rows.join('') + '</tbody>';

function renderOverview(r) {
  const w = r.world;
  $('madeAt').textContent = 'Seed ' + w.seed + ' · tick ' + fmt(w.tick) + (w.tick < w.latestTick ? ' (viewing the past; now is ' + fmt(w.latestTick) + ')' : '') +
    ' · made ' + new Date(r.madeAt).toLocaleTimeString();
  $('tiles').innerHTML = [
    tile('World age', fmt(w.tick) + ' ticks', 'Year ' + w.year + ', ' + w.season.toLowerCase()),
    w.scenario ? tile('Scenario', esc(w.scenario)) : '',
    tile('Creatures', fmt(w.creatures), 'of a cap of ' + fmt(w.creatureCap)),
    tile('Living species', fmt(w.livingSpecies), fmt(w.speciesEver) + ' have taken hold in all'),
    tile('Extinct species', fmt(w.extinctSpecies)),
    tile('Births', fmt(w.births)),
    tile('Deaths', fmt(w.deaths)),
    tile('Plants', fmt(w.plants)),
    tile('Carcasses', fmt(w.carcasses)),
    tile('Can swim', fmt(w.swimmers), pct(w.creatures ? w.swimmers / w.creatures : 0) + ' of creatures'),
    tile('Sick', fmt(w.sick), pct(w.creatures ? w.sick / w.creatures : 0) + ' of creatures'),
    tile('Drought', w.drought ? 'Yes' : 'No'),
  ].join('');
  $('landBar').innerHTML = LAND.map(([key, , color]) => '<span style="width:' + w.landCover[key] * 100 + '%;background:' + color + '"></span>').join('');
  $('landKey').innerHTML = LAND.map(([key, label, color]) => '<span>' + dot(color) + label + ' ' + pct(w.landCover[key]) + '</span>').join('');
}

function renderPopulation(r) {
  $('popHint').textContent = r.historyFrom === null
    ? 'No history yet.'
    : 'Share of creatures by species now, then head counts from tick ' + fmt(r.historyFrom) + ' to ' + fmt(r.world.latestTick) + '.';
  $('shareBar').innerHTML = r.living.map((sp) => '<span title="' + esc(sp.name) + ' ' + pct(sp.share) + '" style="width:' + sp.share * 100 + '%;background:' + esc(sp.color) + '"></span>').join('');
  $('popKey').innerHTML = r.living.map((sp) => '<span>' + named(sp.name, sp.color) + ' · ' + fmt(sp.count) + ' (' + pct(sp.share) + ')</span>').join('');
  drawChart();
  $('timeline').innerHTML = table([['Tick'], ['Creatures'], ['Species']],
    r.timeline.map((row) => '<tr><td>' + fmt(row.tick) + '</td><td>' + fmt(row.creatures) + '</td><td>' + fmt(row.species) + '</td></tr>'));
}

function drawChart() {
  if (!latest) return;
  const { history, shown, latestTick } = latest.chart;
  drawLineChart($('popChart'), history, shown, latestTick, METRICS.count, true);
}

const abilityText = (list) => list.length
  ? list.map((a) => esc(a.name) + (a.share === null ? '' : ' ' + pct(a.share))).join(', ')
  : '<span class="muted">None</span>';

function renderSpecies(r) {
  $('livingTable').innerHTML = table(
    [['Species'], ['Count'], ['Share'], ['Split from', 'text'], ['Born'], ['Age'], ['Stage'], ['Peak'], ['Kills'], ['Speed'], ['Strength'],
      ['Vision'], ['Prefers'], ['Meat'], ['Swim'], ['Night eyes'], ['Sick'], ['Top gen.'], ['Abilities', 'text'], ['Gave rise to', 'text']],
    r.living.map((sp) => '<tr><td>' + named(sp.name, sp.color) + '</td><td>' + fmt(sp.count) + '</td><td>' + pct(sp.share) + '</td>' +
      '<td class="text">' + esc(sp.parent ?? '–') + '</td><td>' + fmt(sp.bornTick) + '</td><td>' + fmt(sp.lasted) + '</td><td>' + sp.stage + '</td>' +
      '<td>' + (sp.peak ? fmt(sp.peak.count) + ' <span class="muted">@' + fmt(sp.peak.tick) + '</span>' : '–') + '</td>' +
      '<td>' + fmt(sp.kills) + '</td><td>' + num(sp.traits.speed, 2) + '</td><td>' + num(sp.traits.strength, 2) + '</td>' +
      '<td>' + num(sp.traits.vision, 0) + '</td><td>' + num(sp.traits.preferredTemp) + '°C</td><td>' + pct(sp.traits.diet) + '</td>' +
      '<td>' + pct(sp.swimmers) + '</td><td>' + pct(sp.nightEyes) + '</td><td>' + pct(sp.sick) + '</td><td>' + fmt(sp.maxGeneration) + '</td>' +
      '<td class="text wrap">' + abilityText(sp.abilities) + '</td><td class="text wrap">' + (esc(sp.children.join(', ')) || '<span class="muted">–</span>') + '</td></tr>'));

  $('extinctTable').innerHTML = r.extinct.length ? table(
    [['Species'], ['Split from', 'text'], ['Born'], ['Died out'], ['Lasted'], ['Stage'], ['Peak'], ['Kills'], ['Speed'], ['Strength'],
      ['Vision'], ['Prefers'], ['Meat'], ['Abilities', 'text'], ['Gave rise to', 'text']],
    r.extinct.map((sp) => '<tr><td>' + named(sp.name, sp.color) + '</td><td class="text">' + esc(sp.parent ?? '–') + '</td>' +
      '<td>' + fmt(sp.bornTick) + '</td><td>' + fmt(sp.extinctTick) + '</td><td>' + fmt(sp.lasted) + '</td><td>' + sp.stage + '</td>' +
      '<td>' + (sp.peak ? fmt(sp.peak.count) : '–') + '</td><td>' + fmt(sp.kills) + '</td>' +
      '<td>' + num(sp.traits.speed, 2) + '</td><td>' + num(sp.traits.strength, 2) + '</td><td>' + num(sp.traits.vision, 0) + '</td>' +
      '<td>' + num(sp.traits.preferredTemp) + '°C</td><td>' + pct(sp.traits.diet) + '</td>' +
      '<td class="text wrap">' + abilityText(sp.abilities) + '</td><td class="text wrap">' + (esc(sp.children.join(', ')) || '<span class="muted">–</span>') + '</td></tr>'))
    : '<tbody><tr><td class="muted">No species has died out yet.</td></tr></tbody>';
}

// Every species that took hold, from the start of the run to now, each
// branching from the one it split from.
function renderTree(r) {
  const all = [...r.living, ...r.extinct];
  $('treeHint').textContent = all.length
    ? fmt(all.length) + ' species over the whole run, ' + fmt(r.living.length) + ' still alive. Each line runs from when the species appeared to now, or to a cross where it died out, and branches from the one it split from.'
    : 'No species yet.';
  $('treeNow').textContent = 'Tick ' + fmt(r.world.tick);
  drawTree();
}

function drawTree() {
  if (!latest) return;
  const r = latest.report;
  // drawFamilyTree looks parents up by id, so place each species at its id.
  const byId = [];
  const tree = [...r.living, ...r.extinct].sort((a, b) => a.id - b.id).map((sp) => (byId[sp.id] = {
    id: sp.id, name: sp.name, color: sp.color, parent: sp.treeParent, count: sp.count,
    bornTick: sp.bornTick, extinctTick: sp.alive ? null : sp.extinctTick,
  }));
  drawFamilyTree($('tree'), tree, byId, r.world.tick, 0);
}

function renderCreatures(r) {
  const rows = Object.values(r.creatures).filter((row) => row.mean !== undefined);
  const places = (label) => (/Speed|Strength/.test(label) ? 2 : /meat/.test(label) ? 2 : 1);
  $('creatureTable').innerHTML = rows.length ? table([['Measure'], ['Lowest'], ['Average'], ['Middle'], ['Highest']],
    rows.map((row) => {
      const p = places(row.label);
      const show = /meat/.test(row.label) ? pct : (v) => num(v, p);
      return '<tr><td>' + row.label + '</td><td>' + show(row.min) + '</td><td>' + show(row.mean) + '</td><td>' + show(row.median) + '</td><td>' + show(row.max) + '</td></tr>';
    }))
    : '<tbody><tr><td class="muted">No creatures are alive.</td></tr></tbody>';
  $('abilities').innerHTML = r.abilityHolders.length
    ? '<dl class="facts">' + r.abilityHolders.map((a) => '<dt>' + esc(a.name) + '</dt><dd>' + fmt(a.count) + ' creatures (' + pct(a.share) + ')</dd>').join('') + '</dl>'
    : '<p class="hint">No living creature has an ability.</p>';
}

function renderRecords(r) {
  const rec = r.records;
  const holder = (h, unit = '') => (h ? fmt(h.value) + unit + ' <span class="muted">' + (h.name ? named(h.name, h.color) + ', ' : '') + 'tick ' + fmt(h.tick) + '</span>' : '–');
  const all = [...r.living, ...r.extinct];
  const best = (score) => all.reduce((a, sp) => (!a || score(sp) > score(a) ? sp : a), null);
  const longest = best((sp) => sp.lasted), deadliest = best((sp) => sp.kills), evolved = best((sp) => sp.stage);
  const who = (sp) => named(sp.name, sp.color) + (sp.alive ? ', still alive' : ', died out at tick ' + fmt(sp.extinctTick));
  $('recordList').innerHTML =
    '<dt>Biggest population</dt><dd>' + holder(rec.peakPopulation, ' creatures') + '</dd>' +
    '<dt>Biggest species</dt><dd>' + holder(rec.peakSpecies, ' members') + '</dd>' +
    '<dt>Longest-lasting species</dt><dd>' + (longest ? fmt(longest.lasted) + ' ticks <span class="muted">' + who(longest) + '</span>' : '–') + '</dd>' +
    '<dt>Most kills</dt><dd>' + (deadliest && deadliest.kills ? fmt(deadliest.kills) + ' <span class="muted">' + who(deadliest) + '</span>' : '–') + '</dd>' +
    '<dt>Most evolved</dt><dd>' + (evolved && evolved.stage > 1 ? 'Stage ' + evolved.stage + ' <span class="muted">' + who(evolved) + '</span>' : '–') + '</dd>' +
    '<dt>Most young from one creature</dt><dd>' + holder(rec.mostOffspring) + '</dd>' +
    '<dt>Longest family line</dt><dd>' + holder(rec.highestGeneration, ' generations') + '</dd>';
}

function renderSettings(r) {
  const s = r.settings;
  const show = (v) => esc(typeof v === 'number' ? +v.toFixed(4) : JSON.stringify(v));
  $('settingList').innerHTML =
    ('foodRate' in s ? '<dt>Food supply slider</dt><dd>' + show(s.foodRate) + '</dd>' : '') +
    ('mutationRate' in s ? '<dt>Mutation slider</dt><dd>' + show(s.mutationRate) + '</dd>' : '') +
    (s.changed.length
      ? s.changed.map((c) => '<dt>' + esc(c.key) + '</dt><dd>' + show(c.value) + ' <span class="muted">(usually ' + show(c.usual) + ')</span></dd>').join('')
      : '<dt>Other settings</dt><dd>All at their usual values</dd>');
}

function renderEvents(r) {
  const kinds = Object.keys(r.eventCounts).sort((a, b) => r.eventCounts[b] - r.eventCounts[a]);
  if (eventKind && !r.eventCounts[eventKind]) eventKind = null;
  $('eventHint').textContent = r.events.length
    ? fmt(r.events.length) + ' events in the log (it keeps the most recent ones), newest first.'
    : 'Nothing has happened yet.';
  $('eventFilter').innerHTML = r.events.length
    ? '<button data-kind="" aria-pressed="' + !eventKind + '">All ' + fmt(r.events.length) + '</button>' +
      kinds.map((k) => '<button data-kind="' + esc(k) + '" aria-pressed="' + (eventKind === k) + '">' + esc(EVENT_NAMES[k] || k) + ' ' + fmt(r.eventCounts[k]) + '</button>').join('')
    : '';
  const shown = r.events.filter((e) => !eventKind || e.kind === eventKind).reverse();
  $('eventTable').innerHTML = shown.length ? table([['Tick'], ['Kind', 'text'], ['What happened', 'text']],
    shown.map((e) => '<tr><td>' + fmt(e.tick) + '</td><td class="text">' + esc(EVENT_NAMES[e.kind] || e.kind) + '</td><td class="text wrap">' + esc(e.text) + '</td></tr>')) : '';
}

function render() {
  const r = latest.report;
  renderOverview(r);
  renderPopulation(r);
  renderSpecies(r);
  renderTree(r);
  renderCreatures(r);
  renderRecords(r);
  renderSettings(r);
  renderEvents(r);
}

function refresh() {
  const from = source();
  $('status').hidden = !!from;
  document.querySelector('main').hidden = !from;
  if (!from) {
    $('status').innerHTML = host()
      ? 'Waiting for the life sim page to finish loading…'
      : 'This report needs the life sim page open in another window or tab. <a href="/">Go to the life sim</a> and open it from its Records tab.';
    if (!latest) setTimeout(refresh, 500);
    return;
  }
  latest = from.report();
  render();
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileName = (ext) => 'lifesim-seed' + latest.report.world.seed + '-tick' + latest.report.world.tick + '.' + ext;

// Copies the story text. The clipboard can be refused (an embedded page, an
// older browser), so fall back to selecting a hidden text box and copying that.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement('textarea');
    box.value = text;
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.append(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return ok;
  }
}

function storyHint(text) {
  $('storyHint').textContent = text;
  $('storyHint').hidden = false;
}

$('copyStory').onclick = async () => {
  if (!latest) return;
  const text = storyText(latest.report);
  const kb = Math.max(1, Math.round(text.length / 1024));
  storyHint(await copyText(text)
    ? 'Copied ' + kb + ' KB of text. Paste it into a chat with Claude; it starts by asking for a story about this world.'
    : 'The browser would not copy. Use Download story file instead and attach it to the chat.');
};
$('downloadStory').onclick = () => {
  if (!latest) return;
  download(fileName('md').replace('.md', '-story.md'), storyText(latest.report), 'text/markdown');
  storyHint('Attach the downloaded file to a chat with Claude and ask for a story, or just send it as it is: it starts by asking for one.');
};
$('refresh').onclick = refresh;
$('print').onclick = () => window.print();
$('downloadJson').onclick = () => latest && download(fileName('json'), JSON.stringify(latest.report, null, 2), 'application/json');
$('downloadCsv').onclick = () => latest && download(fileName('csv'), speciesCsv(latest.report), 'text/csv');
$('eventFilter').onclick = (e) => {
  const button = e.target.closest('button[data-kind]');
  if (!button) return;
  eventKind = button.dataset.kind || null;
  renderEvents(latest.report);
};
window.addEventListener('resize', () => { drawChart(); drawTree(); });
refresh();
