import test from 'node:test';
import assert from 'node:assert/strict';
import { isGameLive } from '@/lib/plays/sleeperPlays';

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
