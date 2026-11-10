// The charts: a line chart per species (Charts tab), the species family tree,
// and the timeline strip in the bottom bar.
//
// The line chart and timeline show the same window: the most recent
// WINDOW_TICKS ticks, or the whole run so far while it is shorter than that.
// `history` is a list of samples: { tick, counts: [per species id], traits: [per species id] }.

export const SAMPLE_EVERY = 40;    // ticks between samples
export const WINDOW_TICKS = 16000; // how far back the charts look
const MIN_SPAN = 2000;             // a young world is not stretched wider than this
const TREE_ROW = 26;               // pixels per species in the family tree

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Matches the canvas resolution to its on-screen size. Returns null while hidden.
function prepare(canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// First tick shown, given the current tick.
export function windowStart(tick) {
  return Math.max(0, tick - WINDOW_TICKS);
}

// Number of ticks the charts span, given the current tick.
export function windowSpan(tick) {
  return Math.min(WINDOW_TICKS, Math.max(MIN_SPAN, tick));
}

const whole = (n) => Math.round(n).toLocaleString('en-US');
const traitMetric = (trait, title, label) =>
  ({ title, label, floor: 0, valueOf: (s, id) => (s.counts[id] ? s.traits[id][trait] : null) });

// Everything that can be charted per species. Each entry has a title and the
// options drawLineChart needs.
export const METRICS = {
  count: { title: 'Population', fromZero: true, label: (v) => whole(v) + ' creatures', valueOf: (s, id) => s.counts[id] ?? null },
  speed: traitMetric('speed', 'Average speed', (v) => v.toFixed(2)),
  vision: traitMetric('vision', 'Average vision', (v) => v.toFixed(0)),
  strength: traitMetric('strength', 'Average strength', (v) => v.toFixed(2)),
  preferredTemp: { ...traitMetric('preferredTemp', 'Average preferred temperature', (v) => v.toFixed(1) + '°C'), floor: -Infinity },
  diet: traitMetric('diet', 'Share of meat in diet', (v) => Math.round(v * 100) + '% meat'),
  swimmers: traitMetric('swimmers', 'Share that can swim', (v) => Math.round(v * 100) + '% can swim'),
};

// One line per species.
//   valueOf(sample, id): the number to plot, or null where the species has none
//   fromZero: start the y axis at zero (for head counts) instead of fitting the data
//   floor: the y axis never goes below this
//   label(value): text for a value on the y axis
//   detailed: draw grid lines with their values, and tick numbers along the bottom
export function drawLineChart(canvas, history, species, tick, { valueOf, fromZero, floor = -Infinity, label }, detailed = false) {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const start = windowStart(tick), span = windowSpan(tick);
  const plotTop = 16, plotBottom = h - (detailed ? 18 : 16);

  let lo = Infinity, hi = -Infinity;
  for (const sample of history) {
    for (const sp of species) {
      const v = valueOf(sample, sp.id);
      if (v === null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (lo > hi) lo = hi = 0;
  if (fromZero) lo = 0;
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = fromZero ? 0 : (hi - lo) * 0.08;
  lo = Math.max(floor, lo - pad);
  hi += pad;

  ctx.strokeStyle = css('--border');
  ctx.lineWidth = 1;
  ctx.fillStyle = css('--text-muted');
  ctx.font = '11px system-ui, sans-serif';
  if (detailed) {
    // Five grid lines, each labelled with its value, and tick numbers below.
    for (let i = 0; i <= 4; i++) {
      const y = Math.round(plotBottom - i / 4 * (plotBottom - plotTop)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(label(lo + (hi - lo) * i / 4), 2, y - 3);
    }
    const step = axisStep(span);
    for (let t = Math.ceil(start / step) * step; t <= start + span; t += step) {
      const text = t.toLocaleString('en-US'), width = ctx.measureText(text).width;
      const x = (t - start) / span * w;
      ctx.fillText(text, Math.min(w - width - 1, Math.max(1, x - width / 2)), h - 4);
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(0, plotBottom + 0.5);
    ctx.lineTo(w, plotBottom + 0.5);
    ctx.stroke();
    ctx.fillText(label(hi), 2, 11);
    ctx.fillText(label(lo), 2, h - 3);
  }

  for (const sp of species) {
    ctx.beginPath();
    ctx.strokeStyle = sp.color;
    ctx.lineWidth = detailed ? 2 : 1.5;
    let drawing = false;
    for (const sample of history) {
      const v = valueOf(sample, sp.id);
      if (v === null) {
        drawing = false;
        continue;
      }
      const x = (sample.tick - start) / span * w;
      const y = plotBottom - (v - lo) / (hi - lo) * (plotBottom - plotTop);
      if (drawing) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      drawing = true;
    }
    ctx.stroke();
  }
}

// Height of the tick labels under the timeline bands.
const AXIS_HEIGHT = 14;

// A round number of ticks between axis labels, giving at most about eight labels.
function axisStep(span) {
  for (const step of [100, 200, 500, 1000, 2000, 5000, 10000]) if (span / step <= 8) return step;
  return 20000;
}

// The timeline strip: stacked bands showing each species' share of the
// population over time, with tick labels underneath. `tick` is the newest
// tick reached, which sits at the right-hand end.
export function drawTimeline(canvas, history, species, tick) {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const start = windowStart(tick), span = windowSpan(tick);
  const bandsHeight = h - AXIS_HEIGHT;
  const xOf = (t) => (t - start) / span * w;
  ctx.fillStyle = css('--surface');
  ctx.fillRect(0, 0, w, bandsHeight);

  if (history.length >= 2) {
    const totals = history.map((s) => s.counts.reduce((a, b) => a + b, 0) || 1);
    let lower = history.map(() => 0);
    for (const sp of species) {
      const upper = history.map((s, i) => lower[i] + (s.counts[sp.id] || 0) / totals[i]);
      ctx.beginPath();
      history.forEach((s, i) => ctx.lineTo(xOf(s.tick), bandsHeight - upper[i] * bandsHeight));
      for (let i = history.length - 1; i >= 0; i--) ctx.lineTo(xOf(history[i].tick), bandsHeight - lower[i] * bandsHeight);
      ctx.closePath();
      ctx.fillStyle = sp.color;
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
      lower = upper;
    }
  }

  // Tick labels along the bottom.
  const step = axisStep(span);
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = css('--text-muted');
  ctx.strokeStyle = css('--border');
  ctx.lineWidth = 1;
  for (let t = Math.ceil(start / step) * step; t <= start + span; t += step) {
    const x = Math.round(xOf(t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, bandsHeight);
    ctx.lineTo(x, bandsHeight + 3);
    ctx.stroke();
    const text = t.toLocaleString('en-US');
    const width = ctx.measureText(text).width;
    ctx.fillText(text, Math.min(w - width - 1, Math.max(1, x - width / 2)), h - 2);
  }
}

// The family tree: one row per species, running from the tick it appeared to
// the tick it died out (or now), joined to the species it split from.
// `species` should hold only the species worth showing; a species whose parent
// is not among them hangs off its nearest ancestor that is.
export function drawFamilyTree(canvas, species, allSpecies, tick) {
  const shown = new Set(species.map((sp) => sp.id));
  const parentOf = (sp) => {
    let p = sp.parent;
    while (p !== null && !shown.has(p)) p = allSpecies[p].parent;
    return p;
  };
  // Order rows so each species sits under the one it split from.
  const children = new Map();
  for (const sp of species) {
    const p = parentOf(sp);
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(sp);
  }
  const rows = [];
  const visit = (sp) => {
    rows.push(sp);
    for (const child of children.get(sp.id) || []) visit(child);
  };
  for (const root of children.get(null) || []) visit(root);
  const rowOf = new Map(rows.map((sp, i) => [sp.id, i]));

  canvas.style.height = Math.max(1, rows.length) * TREE_ROW + 6 + 'px';
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w } = p;
  const left = 4, right = w - 10;
  const xOf = (t) => left + (tick ? t / tick : 0) * (right - left);
  const yOf = (id) => rowOf.get(id) * TREE_ROW + 19;
  const textColor = css('--text-secondary'), mutedColor = css('--text-muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.lineCap = 'round';

  for (const sp of rows) {
    const y = yOf(sp.id), x0 = xOf(sp.bornTick);
    const extinct = sp.extinctTick !== null;
    const x1 = Math.max(x0 + 2, xOf(extinct ? sp.extinctTick : tick));
    ctx.globalAlpha = extinct ? 0.45 : 1;

    const parent = parentOf(sp);
    if (parent !== null) {
      ctx.strokeStyle = allSpecies[parent].color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, yOf(parent));
      ctx.lineTo(x0, y);
      ctx.stroke();
    }
    ctx.strokeStyle = sp.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();

    if (extinct) {
      ctx.strokeStyle = mutedColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x1 + 2, y - 4);
      ctx.lineTo(x1 + 10, y + 4);
      ctx.moveTo(x1 + 10, y - 4);
      ctx.lineTo(x1 + 2, y + 4);
      ctx.stroke();
    }

    // Name above the line, pulled left if it would run off the edge.
    const text = sp.name + (extinct ? ' (extinct)' : ' · ' + sp.count);
    const textX = Math.min(x0 + (parent !== null ? 5 : 0), w - ctx.measureText(text).width - 2);
    ctx.fillStyle = extinct ? mutedColor : textColor;
    ctx.fillText(text, Math.max(2, textX), y - 7);
    ctx.globalAlpha = 1;
  }
}
