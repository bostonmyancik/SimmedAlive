// A plain-text (Markdown) telling of a world, for pasting into a chat with
// Claude and asking for a story. It is made from a report (see report.js) and
// favours words over numbers: who lived where, who came from whom, and what
// happened when.

import { seasonAt } from '../sim/world.js';

const MAX_CHRONICLE = 300;      // lines in "What happened", oldest first
const MAX_DETAILED_EXTINCT = 60; // extinct species described in full; the rest are listed by name
const MINOR = new Set(['boom', 'crash', 'ability']); // dropped first when the chronicle is too long

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const pct = (n) => Math.round(n * 100) + '%';
const when = (tick) => {
  const { year, season } = seasonAt(tick);
  return 'Year ' + year + ', ' + season.toLowerCase() + ' (tick ' + fmt(tick) + ')';
};

function dietWords(diet) {
  if (diet < 0.1) return 'eats only plants';
  if (diet < 0.4) return 'eats mostly plants';
  if (diet < 0.6) return 'eats plants and meat alike';
  if (diet < 0.9) return 'eats mostly meat';
  return 'eats only meat';
}

function climateWords(temp) {
  if (temp < 8) return 'cold lands';
  if (temp < 15) return 'cool lands';
  if (temp < 22) return 'mild lands';
  if (temp < 28) return 'warm lands';
  return 'hot lands';
}

// "faster than most" and so on, comparing a value with the average over every species.
function compared(value, mean, more, less) {
  if (!mean) return null;
  const ratio = value / mean;
  if (ratio > 1.25) return 'much ' + more + ' than most';
  if (ratio > 1.08) return more + ' than most';
  if (ratio < 0.75) return 'much ' + less + ' than most';
  if (ratio < 0.92) return less + ' than most';
  return null;
}

function describe(sp, means) {
  const t = sp.traits;
  const words = [
    compared(t.speed, means.speed, 'faster', 'slower'),
    compared(t.strength, means.strength, 'stronger', 'weaker'),
    compared(t.vision, means.vision, 'sharper-eyed', 'shorter-sighted'),
    dietWords(t.diet),
    'likes ' + climateWords(t.preferredTemp),
  ].filter(Boolean);
  return words.join(', ');
}

function speciesBlock(sp, means, historyFrom) {
  const lines = ['### ' + sp.name + (sp.alive ? ' (alive, ' + fmt(sp.count) + ' members, ' + pct(sp.share) + ' of all creatures)' : ' (extinct)')];
  lines.push('- Nature: ' + describe(sp, means) + '.');
  lines.push('- Traits: speed ' + sp.traits.speed.toFixed(2) + ', strength ' + sp.traits.strength.toFixed(2) + ', vision ' + Math.round(sp.traits.vision) +
    ', prefers ' + sp.traits.preferredTemp.toFixed(1) + '°C, diet ' + pct(sp.traits.diet) + ' meat.');
  lines.push(sp.parent
    ? '- Ancestry: ' + sp.lineage.join(' → ') + '. Appeared ' + when(sp.bornTick) + '.'
    : '- A founding species, there from the start.');
  if (!sp.alive) lines.push('- Died out ' + when(sp.extinctTick) + ', after ' + fmt(sp.lasted) + ' ticks.');
  else lines.push('- Has lasted ' + fmt(sp.lasted) + ' ticks so far.');
  const deeds = [];
  if (sp.kills) deeds.push(fmt(sp.kills) + ' kills');
  // The chart history only reaches back so far, so an older species' peak may not be its all-time one.
  if (sp.peak) deeds.push('peak of ' + fmt(sp.peak.count) + ' members' + (historyFrom !== null && historyFrom > sp.bornTick ? ' since tick ' + fmt(historyFrom) : ''));
  if (sp.stage > 1) deeds.push('evolved to stage ' + sp.stage);
  if (deeds.length) lines.push('- Deeds: ' + deeds.join(', ') + '.');
  if (sp.alive) {
    const ways = [];
    if (sp.swimmers >= 0.05) ways.push(pct(sp.swimmers) + ' can swim');
    if (sp.nightEyes >= 0.05) ways.push(pct(sp.nightEyes) + ' have night eyes');
    if (sp.sick >= 0.05) ways.push(pct(sp.sick) + ' are sick');
    if (ways.length) lines.push('- Now: ' + ways.join(', ') + '.');
  }
  if (sp.abilities.length) lines.push('- Abilities: ' + sp.abilities.map((a) => a.name + (a.share === null ? '' : ' (' + pct(a.share) + ')')).join(', ') + '.');
  if (sp.children.length) lines.push('- Gave rise to: ' + sp.children.join(', ') + '.');
  return lines.join('\n');
}

// The chronicle, oldest first. Appearances and extinctions come from the
// species themselves, so they cover the whole run even when the event log has
// forgotten its early days; everything else comes from the log.
function chronicle(report) {
  const all = [...report.living, ...report.extinct];
  const entries = [];
  for (const sp of all) {
    if (sp.parent) entries.push({ tick: sp.bornTick, kind: 'species', text: sp.name + ' split from ' + sp.parent });
    if (!sp.alive) entries.push({ tick: sp.extinctTick, kind: 'extinct', text: sp.name + ' died out' });
  }
  for (const e of report.events) {
    if (e.kind === 'species' || e.kind === 'extinct' || e.kind === 'mutation') continue;
    entries.push(e);
  }
  entries.sort((a, b) => a.tick - b.tick);
  let kept = entries.length > MAX_CHRONICLE ? entries.filter((e) => !MINOR.has(e.kind)) : entries;
  let note = kept.length < entries.length ? 'Booms, crashes and changes in abilities are left out to keep this short.' : '';
  if (kept.length > MAX_CHRONICLE) {
    kept = kept.slice(-MAX_CHRONICLE);
    note = 'Only the most recent ' + MAX_CHRONICLE + ' happenings are listed' + (note ? ', and booms, crashes and changes in abilities are left out' : '') + '.';
  }
  return { lines: kept.map((e) => '- ' + when(e.tick) + ': ' + e.text), note };
}

const holder = (h, unit = '') => (h ? fmt(h.value) + unit + (h.name ? ', ' + h.name : '') + ', ' + when(h.tick) : null);

export function storyText(report) {
  const w = report.world;
  const all = [...report.living, ...report.extinct];
  const mean = (trait) => (all.length ? all.reduce((a, sp) => a + sp.traits[trait], 0) / all.length : 0);
  const means = { speed: mean('speed'), strength: mean('strength'), vision: mean('vision') };
  const { year, season } = seasonAt(w.tick);
  const land = w.landCover;

  const out = [];
  out.push('# The world of seed ' + w.seed);
  out.push('');
  out.push('Below is the history of a simulated world of evolving creatures, exported from my life sim. ' +
    'Please write a story about this world: its founding species, the rise and fall of their descendants, the hunters and the hunted, ' +
    'and the disasters and turning points along the way. Stay true to the facts below, but bring them to life. ' +
    'Feel free to give the species characters, cultures and voices of their own.');
  out.push('');
  out.push('## About this world');
  out.push('- It has run for ' + fmt(w.tick) + ' ticks and is now in year ' + year + ', ' + season.toLowerCase() + '. A year is about 18,850 ticks; a creature lives at most 3,000.');
  if (w.scenario) out.push('- It began from the "' + w.scenario + '" scenario.');
  out.push('- The land is ' + pct(land.plain) + ' open plain, ' + pct(land.fertile) + ' fertile ground, ' + pct(land.desert) + ' desert, ' +
    pct(land.mountain) + ' mountain and ' + pct(land.water) + ' water. The north is cold and the south hot; weather fronts drift across.');
  out.push('- Creatures eat plants or meat, must drink, fight other species, and split in two when well fed. ' +
    'Young inherit their parent\'s traits with small changes; a line that drifts far enough becomes a new species.');
  out.push('- Births so far: ' + fmt(w.births) + '. Deaths: ' + fmt(w.deaths) + '. Species that took hold: ' + fmt(w.speciesEver) +
    ', of which ' + fmt(w.extinctSpecies) + ' have died out.');
  out.push('- Now: ' + (w.creatures ? fmt(w.creatures) + ' creatures of ' + fmt(w.livingSpecies) + ' species' : 'no creatures are left alive') +
    ', ' + fmt(w.plants) + ' plants' + (w.drought ? ', and a drought is on' : '') + '.');
  if (w.tick < w.latestTick) out.push('- This is a look back in time: the world has since run on to tick ' + fmt(w.latestTick) + '.');

  out.push('');
  out.push('## The species alive today');
  out.push(report.living.length ? report.living.map((sp) => speciesBlock(sp, means, report.historyFrom)).join('\n\n') : 'None. Every species has died out.');

  out.push('');
  out.push('## Species that died out');
  if (!report.extinct.length) out.push('None yet.');
  else {
    // The ones with the biggest stories in full: long-lived, numerous or deadly.
    const weight = (sp) => sp.lasted + (sp.peak ? sp.peak.count * 20 : 0) + sp.kills * 5 + (sp.parent ? 0 : 1e9);
    const detailed = new Set([...report.extinct].sort((a, b) => weight(b) - weight(a)).slice(0, MAX_DETAILED_EXTINCT).map((sp) => sp.id));
    const inOrder = [...report.extinct].sort((a, b) => a.bornTick - b.bornTick);
    out.push(inOrder.filter((sp) => detailed.has(sp.id)).map((sp) => speciesBlock(sp, means, report.historyFrom)).join('\n\n'));
    const brief = inOrder.filter((sp) => !detailed.has(sp.id));
    if (brief.length) {
      out.push('');
      out.push('Short-lived species, briefly: ' + brief.map((sp) => sp.name + ' (' + (sp.parent ? 'from ' + sp.parent + ', ' : '') + 'ticks ' + fmt(sp.bornTick) + '–' + fmt(sp.extinctTick) + ')').join('; ') + '.');
    }
  }

  const { lines, note } = chronicle(report);
  out.push('');
  out.push('## What happened, in order');
  if (note) out.push(note);
  out.push(lines.length ? lines.join('\n') : 'Nothing notable yet.');

  const r = report.records;
  const records = [
    ['Biggest population', holder(r.peakPopulation, ' creatures')],
    ['Biggest single species', holder(r.peakSpecies, ' members')],
    ['Most young from one creature', holder(r.mostOffspring)],
    ['Longest family line', holder(r.highestGeneration, ' generations')],
  ].filter(([, text]) => text);
  if (records.length) {
    out.push('');
    out.push('## Records');
    for (const [label, text] of records) out.push('- ' + label + ': ' + text + '.');
  }
  return out.join('\n') + '\n';
}
