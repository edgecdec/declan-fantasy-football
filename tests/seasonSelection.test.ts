import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RememberedSeason, buildSeasonRange, resolveDefaultSeason, resolveSeasonSelection,
} from '@/services/common/seasonService';
import { SleeperNflState } from '@/services/sleeper/sleeperService';

function state(season: string, season_type = 'regular', week = 3): SleeperNflState {
  return {
    season, season_type, week, leg: week,
    previous_season: String(Number(season) - 1),
  } as unknown as SleeperNflState;
}

/** Same, but with `previous_season` missing — Sleeper types it as present, the wire need not. */
function stateWithoutPrevious(season: string, season_type: string): SleeperNflState {
  return { season, season_type, week: 1, leg: 1 } as unknown as SleeperNflState;
}
const remembered = (season: string, pickedWhenCurrent: string): RememberedSeason =>
  ({ season, pickedWhenCurrent });

test('with nothing remembered, the Sleeper default is used and nothing is dropped', () => {
  for (const mode of ['draft', 'roster', 'results'] as const) {
    const s = state('2026');
    const got = resolveSeasonSelection(null, s, mode);
    assert.equal(got.season, resolveDefaultSeason(s, mode));
    assert.equal(got.dropRemembered, false);
  }
});

test('a choice made in the current season is honoured', () => {
  const s = state('2026');
  const got = resolveSeasonSelection(remembered('2023', '2026'), s, 'results');
  assert.equal(got.season, '2023');
  assert.equal(got.dropRemembered, false);
});

test('a choice that outlived its season is dropped, not honoured', () => {
  // Picking 2025 during 2025 must not pin the page to 2025 once 2026 starts.
  const got = resolveSeasonSelection(remembered('2025', '2025'), state('2026'), 'results');
  assert.equal(got.dropRemembered, true);
  assert.notEqual(got.season, '2025');
  assert.equal(got.season, resolveDefaultSeason(state('2026'), 'results'));
});

test('a choice outside the selectable range is dropped', () => {
  const s = state('2026');
  assert.ok(!buildSeasonRange('2026').includes('2009'), 'precondition: 2009 is not offerable');
  const got = resolveSeasonSelection(remembered('2009', '2026'), s, 'results');
  assert.equal(got.dropRemembered, true);
  assert.equal(got.season, resolveDefaultSeason(s, 'results'));
  // A future season is equally unofferable.
  const future = resolveSeasonSelection(remembered('2031', '2026'), s, 'results');
  assert.equal(future.dropRemembered, true);
});

test('every season the dropdown offers can be remembered', () => {
  const s = state('2026');
  for (const season of buildSeasonRange('2026')) {
    const got = resolveSeasonSelection(remembered(season, '2026'), s, 'results');
    assert.equal(got.season, season, `${season} should round-trip`);
    assert.equal(got.dropRemembered, false);
  }
});

test('modes are independent, so a results page is not dragged to a season with no games', () => {
  // The whole reason selections are stored per mode: during the preseason, `draft` points
  // at the upcoming season while `results` must stay on the last one that was played.
  const preseason = state('2026', 'pre', 1);
  const draftDefault = resolveDefaultSeason(preseason, 'draft');
  const resultsDefault = resolveDefaultSeason(preseason, 'results');
  assert.notEqual(draftDefault, resultsDefault, 'precondition: the two modes disagree in preseason');
  // Remembering the draft season must not change what results resolves to.
  const got = resolveSeasonSelection(null, preseason, 'results');
  assert.equal(got.season, resultsDefault);
});

test('the decision never returns an empty season', () => {
  for (const type of ['pre', 'regular', 'post', 'off']) {
    for (const mode of ['draft', 'roster', 'results'] as const) {
      const got = resolveSeasonSelection(null, state('2026', type), mode);
      assert.ok(/^\d{4}$/.test(got.season), `bad season for ${type}/${mode}: "${got.season}"`);
    }
  }
});

test('a missing previous_season still yields a real year, not undefined', () => {
  // Preseason + results mode is the only path that reads previous_season, and it is the
  // path where an absent field used to produce `undefined` from a function typed to return
  // a string — every caller then fetched a year of "undefined".
  const got = resolveSeasonSelection(null, stateWithoutPrevious('2026', 'pre'), 'results');
  assert.equal(got.season, '2025');
  for (const type of ['pre', 'regular', 'post', 'off']) {
    for (const mode of ['draft', 'roster', 'results'] as const) {
      const s = resolveSeasonSelection(null, stateWithoutPrevious('2026', type), mode).season;
      assert.ok(/^\d{4}$/.test(s), `bad season for ${type}/${mode}: "${s}"`);
    }
  }
});
