// The pop-out charts window (templates/charts.html). It shows every chart at
// once, large, and reads its data live from the life sim page that opened it.

import { METRICS, drawLineChart, drawFamilyTree, windowStart, windowSpan } from './charts.js';

const REFRESH_MS = 500;
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const dot = (color) => '<span class="dot" style="background:' + color + '"></span>';

let data = null;      // the latest reading from the main page
let hoverTick = null; // the tick under the pointer, shared by every chart

// The window running the life sim: the one that opened this window, or the
// one this page is embedded in. Null if there is none or it has been closed.
function host() {
  if (window.opener && !window.opener.closed) return window.opener;
  return window.parent !== window ? window.parent : null;
}

// The object the life sim page publishes for us, or null if it is not there.
function source() {
  try {
    return host()?.lifesimCharts || null;
  } catch {
    return null; // that window has gone somewhere we may not read
  }
}

// One card per metric; population first and full width.
const charts = Object.entries(METRICS).map(([name, metric]) => {
  const card = document.createElement('section');
  card.className = 'chart' + (name === 'count' ? ' wide' : '');
  card.innerHTML = '<h2></h2><div class="plot"><canvas></canvas><div class="cross" hidden></div></div>';
  card.querySelector('h2').textContent = metric.title;
  $('grid').append(card);
  const chart = { metric, plot: card.querySelector('.plot'), canvas: card.querySelector('canvas'), cross: card.querySelector('.cross') };
  chart.plot.addEventListener('pointermove', (e) => showTip(chart, e));
  chart.plot.addEventListener('pointerleave', hideTip);
  return chart;
});

// The sample closest to a tick.
function sampleAt(tick) {
  let best = null;
  for (const sample of data.history) {
    if (!best || Math.abs(sample.tick - tick) < Math.abs(best.tick - tick)) best = sample;
  }
  return best;
}

// Lists every species' value at the tick under the pointer, largest first.
function showTip(chart, e) {
  if (!data || !data.history.length) return;
  const rect = chart.plot.getBoundingClientRect();
  const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const sample = sampleAt(windowStart(data.latestTick) + fraction * windowSpan(data.latestTick));
  hoverTick = sample.tick;

  const rows = data.shown
    .map((sp) => ({ sp, value: chart.metric.valueOf(sample, sp.id) }))
    .filter((row) => row.value !== null && (chart.metric !== METRICS.count || row.value > 0))
    .sort((a, b) => b.value - a.value);
  const tip = $('tip');
  tip.innerHTML = '<div class="when">Tick ' + fmt(sample.tick) + '</div>' + (rows.length
    ? rows.map((row) => '<div class="row">' + dot(row.sp.color) + '<span>' + row.sp.name + '</span><span>' + chart.metric.label(row.value) + '</span></div>').join('')
    : '<div class="row">No species alive</div>');
  tip.hidden = false;
  // Keep the box beside the pointer and inside the window.
  const x = e.clientX + 16 + tip.offsetWidth > window.innerWidth ? e.clientX - 16 - tip.offsetWidth : e.clientX + 16;
  tip.style.left = Math.max(4, x) + 'px';
  tip.style.top = Math.max(4, Math.min(window.innerHeight - tip.offsetHeight - 4, e.clientY + 12)) + 'px';
  placeCrosshairs();
}

function hideTip() {
  hoverTick = null;
  $('tip').hidden = true;
  placeCrosshairs();
}

// A line at the hovered tick on every chart, so they can be read across.
function placeCrosshairs() {
  for (const chart of charts) {
    chart.cross.hidden = hoverTick === null || !data;
    if (chart.cross.hidden) continue;
    chart.cross.style.left = (hoverTick - windowStart(data.latestTick)) / windowSpan(data.latestTick) * 100 + '%';
  }
}

function refresh() {
  const from = source();
  $('status').hidden = !!from;
  document.querySelector('main').hidden = !from;
  if (!from) {
    data = null;
    $('clock').textContent = '';
    $('status').innerHTML = host()
      ? 'Waiting for the life sim page to finish loading…'
      : 'These charts need the life sim page open in another window or tab. <a href="/">Go to the life sim</a> and open them from its Charts tab.';
    return;
  }
  data = from.read();
  $('clock').textContent = 'Seed ' + data.seed + ' · tick ' + fmt(data.tick) +
    (data.tick < data.latestTick ? ' (viewing the past; now is ' + fmt(data.latestTick) + ')' : '');
  $('key').innerHTML = data.living.map((sp) => '<span>' + dot(sp.color) + sp.name + ' · ' + fmt(sp.count) + '</span>').join('');
  for (const chart of charts) drawLineChart(chart.canvas, data.history, data.shown, data.latestTick, chart.metric, true);
  drawFamilyTree($('tree'), data.shown, data.species, data.tick);
  placeCrosshairs();
}

setInterval(refresh, REFRESH_MS);
window.addEventListener('resize', refresh);
refresh();
