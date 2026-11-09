// UI layer: rendering, controls, and the animation loop. The simulation rules live in sim/.
import { createSim } from './sim/sim.js';
import { randomSeed } from './sim/rng.js';
import { GRID_W as GW, GRID_H as GH, WIDTH as WW, HEIGHT as WH } from './sim/world.js';

{
  // Open the page with ?seed=123 to replay a particular world.
  const urlSeed = Number(new URLSearchParams(location.search).get('seed'));
  const S = createSim({ seed: Number.isInteger(urlSeed) && urlSeed > 0 ? urlSeed : randomSeed() });
  const SP = S.species;
  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 12];
  const $ = (id) => document.getElementById(id);

  const cv = $('world'), hv = $('hist');
  const c2 = cv.getContext('2d'), h2 = hv.getContext('2d');
  const tOff = document.createElement('canvas'), wOff = document.createElement('canvas');
  tOff.width = wOff.width = GW;
  tOff.height = wOff.height = GH;
  const tC = tOff.getContext('2d'), wC = wOff.getContext('2d');

  let H = [], paused = false, showT = true, W = 680, sc = 1, debt = 0, fc = 0;

  function css(v) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888780';
  }

  function size() {
    const d = window.devicePixelRatio || 1;
    W = cv.clientWidth || 680;
    sc = W / WW;
    cv.style.height = WH * sc + 'px';
    cv.width = W * d;
    cv.height = WH * sc * d;
    c2.setTransform(d * sc, 0, 0, d * sc, 0, 0);
    hv.width = W * d;
    hv.height = 110 * d;
    h2.setTransform(d, 0, 0, d, 0, 0);
  }

  function paintWater() {
    const im = wC.createImageData(GW, GH);
    for (let i = 0; i < GW * GH; i++) {
      if (S.water[i]) {
        im.data[i * 4] = 24; im.data[i * 4 + 1] = 95; im.data[i * 4 + 2] = 165; im.data[i * 4 + 3] = 215;
      }
    }
    wC.putImageData(im, 0, 0);
  }

  function paintTemp() {
    const im = tC.createImageData(GW, GH);
    for (let i = 0; i < GW * GH; i++) {
      const t = S.temperature[i] - 18;
      if (t > 0) { im.data[i * 4] = 226; im.data[i * 4 + 1] = 75; im.data[i * 4 + 2] = 74; }
      else { im.data[i * 4] = 55; im.data[i * 4 + 1] = 138; im.data[i * 4 + 2] = 221; }
      im.data[i * 4 + 3] = Math.min(110, Math.abs(t) * 7);
    }
    tC.putImageData(im, 0, 0);
  }

  function cards() {
    $('cards').innerHTML = SP.map((d, i) =>
      '<div class="card"><div class="label"><span class="dot" style="background:' + d.color + '"></span>' + d.name +
      '</div><div class="big" id="n' + i + '">0</div><div class="detail" id="d' + i + '"></div></div>').join('');
  }

  function stats() {
    S.stats().forEach((st, s) => {
      $('n' + s).textContent = st.count ? st.count : 'Extinct';
      $('d' + s).innerHTML = st.count
        ? 'Speed ' + st.speed.toFixed(1) + ' · strength ' + st.strength.toFixed(1) + ' · vision ' + Math.round(st.vision) +
          '<br>Likes ' + Math.round(st.preferredTemp) + '°C · ' + st.kills + ' kills · gen ' + st.maxGeneration
        : 'Wiped out after ' + st.kills + ' kills';
    });
  }

  function reset(seed) {
    S.generate(seed);
    $('seed').textContent = 'Seed ' + S.seed;
    H = [];
    debt = 0;
    paintWater();
    paintTemp();
    stats();
  }

  function tick() {
    for (const c of S.creatures) { c.px = c.x; c.py = c.y; }
    S.step(+$('fRate').value, +$('mut').value);
    if (S.tick % 40 === 0) {
      const n = [0, 0, 0];
      for (const c of S.creatures) n[c.species]++;
      H.push(n);
      if (H.length > 400) H.shift();
    }
  }

  function draw(fr) {
    c2.clearRect(0, 0, WW, WH);
    if (showT) c2.drawImage(tOff, 0, 0, WW, WH);
    c2.drawImage(wOff, 0, 0, WW, WH);
    c2.fillStyle = '#639922';
    for (const f of S.food) { c2.beginPath(); c2.arc(f.x, f.y, 1.8, 0, 6.29); c2.fill(); }
    for (const c of S.creatures) {
      let x = c.x, y = c.y;
      if (fr < 1 && c.px !== undefined && Math.abs(c.x - c.px) < 50) {
        x = c.px + (c.x - c.px) * fr;
        y = c.py + (c.y - c.py) * fr;
      }
      const r = 2 + 1.3 * c.strength, col = SP[c.species].color;
      c2.fillStyle = col;
      c2.beginPath(); c2.arc(x, y, r, 0, 6.29); c2.fill();
      c2.beginPath(); c2.moveTo(x, y);
      c2.lineTo(x + Math.cos(c.heading) * (r + 4), y + Math.sin(c.heading) * (r + 4));
      c2.strokeStyle = col; c2.lineWidth = 1.5; c2.stroke();
      if (c.thirsty) { c2.beginPath(); c2.arc(x, y, r + 2, 0, 6.29); c2.strokeStyle = '#378ADD'; c2.lineWidth = 1; c2.stroke(); }
    }
    if (!S.creatures.length) {
      c2.fillStyle = css('--text-secondary');
      c2.font = '16px sans-serif';
      c2.textAlign = 'center';
      c2.fillText('Everything died. Try a new world', WW / 2, WH / 2);
      c2.textAlign = 'left';
    }
  }

  function drawHist() {
    h2.clearRect(0, 0, W, 110);
    h2.strokeStyle = css('--border'); h2.lineWidth = 1;
    h2.beginPath(); h2.moveTo(0, 109.5); h2.lineTo(W, 109.5); h2.stroke();
    if (!H.length) return;
    const pm = Math.max(60, ...H.map((h) => Math.max(h[0], h[1], h[2])));
    h2.fillStyle = css('--text-muted'); h2.font = '11px sans-serif';
    h2.fillText(pm + ' creatures', 2, 11);
    for (let k = 0; k < 3; k++) {
      h2.beginPath(); h2.strokeStyle = SP[k].color; h2.lineWidth = 1.5;
      H.forEach((h, i) => {
        const x = (i / 399) * W, y = 108 - Math.min(1, h[k] / pm) * 94;
        i ? h2.lineTo(x, y) : h2.moveTo(x, y);
      });
      h2.stroke();
    }
  }

  function frame() {
    const sp = SPEEDS[+$('spd').value];
    if (!paused && S.creatures.length) {
      debt += sp;
      let ran = false;
      while (debt >= 1 && S.creatures.length) { tick(); debt -= 1; ran = true; }
      if (ran && ++fc % 6 === 0) { stats(); if (showT) paintTemp(); }
    }
    draw(sp < 1 && !paused ? debt : 1);
    drawHist();
    requestAnimationFrame(frame);
  }

  $('fRate').oninput = (e) => ($('fOut').textContent = (+e.target.value).toFixed(1));
  $('mut').oninput = (e) => ($('mutOut').textContent = (+e.target.value).toFixed(1));
  $('spd').oninput = (e) => ($('spdOut').textContent = SPEEDS[+e.target.value] + 'x');
  $('heat').onclick = () => { S.temperatureBoost = 9; };
  $('cold').onclick = () => { S.temperatureBoost = -9; };
  $('tmp').onclick = () => {
    showT = !showT;
    $('tmp').textContent = showT ? 'Hide temperature' : 'Show temperature';
    if (showT) paintTemp();
  };
  $('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause'; };
  $('reset').onclick = () => reset(randomSeed());
  cv.onclick = (e) => {
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / sc, y = (e.clientY - r.top) / sc;
    for (let i = 0; i < 30; i++) {
      const fx = Math.min(WW - 1, Math.max(0, x + (Math.random() - 0.5) * 60));
      const fy = Math.min(WH - 1, Math.max(0, y + (Math.random() - 0.5) * 60));
      S.addFood(fx, fy);
    }
  };
  document.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); $('pause').click(); } });
  window.addEventListener('resize', size);

  size();
  cards();
  reset();
  frame();
}
