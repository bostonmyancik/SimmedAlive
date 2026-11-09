// The population chart (Charts tab) and the timeline strip (bottom bar).
// Both show the same window: the most recent WINDOW_TICKS ticks, or the whole
// run so far while it is shorter than that.

export const SAMPLE_EVERY = 40;    // ticks between population samples
export const WINDOW_TICKS = 16000; // how far back the charts look
const MIN_SPAN = 2000;             // a young world is not stretched wider than this

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

// One line per species. `history` is [{ tick, counts: [n, n, n] }, ...].
export function drawPopulationChart(canvas, history, species, tick) {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const start = windowStart(tick), span = windowSpan(tick);
  const peak = Math.max(60, ...history.map((s) => Math.max(...s.counts)));
  const plotTop = 16, plotBottom = h - 1.5;

  ctx.strokeStyle = css('--border');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(w, h - 0.5);
  ctx.stroke();
  ctx.fillStyle = css('--text-muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(peak + ' creatures', 2, 11);

  species.forEach((sp, k) => {
    ctx.beginPath();
    ctx.strokeStyle = sp.color;
    ctx.lineWidth = 1.5;
    history.forEach((s, i) => {
      const x = (s.tick - start) / span * w;
      const y = plotBottom - s.counts[k] / peak * (plotBottom - plotTop);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  });
}

// Stacked bands showing each species' share of the population over time.
export function drawTimeline(canvas, history, species, tick) {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const start = windowStart(tick), span = windowSpan(tick);
  ctx.fillStyle = css('--surface');
  ctx.fillRect(0, 0, w, h);
  if (history.length < 2) return;

  const xOf = (s) => (s.tick - start) / span * w;
  let lower = history.map(() => 0);
  species.forEach((sp, k) => {
    const upper = history.map((s, i) => {
      const total = s.counts.reduce((a, b) => a + b, 0) || 1;
      return lower[i] + s.counts[k] / total;
    });
    ctx.beginPath();
    history.forEach((s, i) => ctx.lineTo(xOf(s), h - upper[i] * h));
    for (let i = history.length - 1; i >= 0; i--) ctx.lineTo(xOf(history[i]), h - lower[i] * h);
    ctx.closePath();
    ctx.fillStyle = sp.color;
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
    lower = upper;
  });
}
