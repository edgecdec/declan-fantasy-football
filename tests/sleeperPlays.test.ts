import test from 'node:test';
import assert from 'node:assert/strict';
import { isGameLive, looksUnderway } from '@/lib/plays/sleeperPlays';

/**
 * Sleeper's status vocabulary is undocumented. Only `pre_game` and `complete` were seen
 * directly, so the classifier has to be right about the ones it has never seen — and the
 * two directions of error are not symmetric. Polling a finished game wastes one cheap
 * call; skipping a live one loses plays that cannot be fetched back later.
 */

test('pending and finished games are not live', () => {
  for (const s of ['pre_game', 'PRE_GAME', 'scheduled', 'complete', 'final', 'post_game']) {
    assert.equal(isGameLive(s), false, s);
  }
});

test('an abandoned game is not live', () => {
  for (const s of ['canceled', 'postponed']) assert.equal(isGameLive(s), false, s);
});

test('an unrecognised status is treated as live', () => {
  // Deliberate: an unknown status is far more likely to be a new in-progress state than a
  // new terminal one, and guessing "live" costs a call while guessing "over" costs data.
  for (const s of ['in_game', 'halftime', 'overtime', 'delayed']) {
    assert.equal(isGameLive(s), true, s);
  }
});

test('an empty status is not live', () => {
  assert.equal(isGameLive(''), false);
  assert.equal(isGameLive(undefined as unknown as string), false);
});

/**
 * The kickoff-time fallback. This exists because the status vocabulary is undocumented: if a
 * live game ever reports something the classifier reads as pending, capture would bank nothing
 * for the whole slate and there is no way to get those plays back later.
 */
test('a game past kickoff and not flagged complete looks underway', () => {
  const now = Date.UTC(2026, 8, 10, 1, 30);
  const kickoff = Date.UTC(2026, 8, 10, 0, 20);
  // Even a status the live-classifier would REJECT still reads as underway on the clock.
  assert.equal(looksUnderway({ game_id: 'g', status: 'pre_game', start_time: kickoff }, now), true);
  assert.equal(looksUnderway({ game_id: 'g', status: 'in_game', start_time: kickoff }, now), true);
});

test('a game before kickoff does not look underway', () => {
  const now = Date.UTC(2026, 8, 10, 0, 19);
  const kickoff = Date.UTC(2026, 8, 10, 0, 20);
  assert.equal(looksUnderway({ game_id: 'g', status: 'pre_game', start_time: kickoff }, now), false);
});

test('a finished or abandoned game never looks underway', () => {
  const kickoff = Date.UTC(2026, 8, 10, 0, 20);
  const now = kickoff + 60 * 60_000;
  for (const status of ['complete', 'final', 'canceled', 'postponed']) {
    assert.equal(looksUnderway({ game_id: 'g', status, start_time: kickoff }, now), false, status);
  }
});

test('a long-finished game stops looking underway even if the status never changed', () => {
  // Otherwise a game whose status is stuck would be polled forever, wasting a call a minute
  // against the rate limit for the rest of the season.
  const kickoff = Date.UTC(2026, 8, 10, 0, 20);
  assert.equal(looksUnderway({ game_id: 'g', status: 'pre_game', start_time: kickoff }, kickoff + 259 * 60_000), true);
  assert.equal(looksUnderway({ game_id: 'g', status: 'pre_game', start_time: kickoff }, kickoff + 261 * 60_000), false);
});

test('a missing kickoff time is not treated as underway', () => {
  assert.equal(looksUnderway({ game_id: 'g', status: 'pre_game', start_time: null }), false);
  assert.equal(looksUnderway({ game_id: 'g', status: 'pre_game' }), false);
});
