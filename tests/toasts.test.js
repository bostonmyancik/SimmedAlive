import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOAST_GROUPS, defaultToastSettings, tidyToastSettings, wantsToast } from '../static/ui/toasts.js';

const event = (kind) => ({ tick: 1, kind, species: null, text: kind });

test('by default alerts are on for everything except newborns gaining abilities', () => {
  const settings = defaultToastSettings();
  assert.equal(settings.enabled, true);
  for (const kind of ['species', 'extinct', 'boom', 'crash', 'evolve', 'ability', 'heat', 'cold', 'drought', 'plague', 'meteor']) {
    assert.equal(wantsToast(settings, event(kind)), true, kind);
  }
  assert.equal(wantsToast(settings, event('mutation')), false);
});

test('switching a group off silences all of its kinds, and the main switch silences everything', () => {
  const settings = defaultToastSettings();
  settings.groups.weather = false;
  assert.equal(wantsToast(settings, event('heat')), false);
  assert.equal(wantsToast(settings, event('drought')), false);
  assert.equal(wantsToast(settings, event('meteor')), true);
  settings.enabled = false;
  assert.equal(wantsToast(settings, event('meteor')), false);
});

test('unknown event kinds never pop up', () => {
  assert.equal(wantsToast(defaultToastSettings(), event('base')), false);
});

test('every event kind the sim logs belongs to exactly one group', () => {
  const kinds = TOAST_GROUPS.flatMap((g) => g.kinds);
  assert.equal(new Set(kinds).size, kinds.length);
  for (const kind of ['species', 'extinct', 'boom', 'crash', 'evolve', 'ability', 'mutation', 'heat', 'cold', 'drought', 'plague', 'meteor']) {
    assert.ok(kinds.includes(kind), kind);
  }
});

test('stored settings are tidied: bad values fall back to defaults, good ones are kept', () => {
  assert.deepEqual(tidyToastSettings(null), defaultToastSettings());
  assert.deepEqual(tidyToastSettings('nonsense'), defaultToastSettings());
  const tidy = tidyToastSettings({ enabled: false, groups: { weather: false, mutation: 'yes', unknown: true } });
  assert.equal(tidy.enabled, false);
  assert.equal(tidy.groups.weather, false);
  assert.equal(tidy.groups.mutation, false); // not a boolean, so the default
  assert.equal('unknown' in tidy.groups, false);
});
