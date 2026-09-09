import test from 'node:test';
import assert from 'node:assert/strict';
import {
  insertNewPlays,
  observedLatencySeconds,
  playCount,
  playsForWeek,
  recentPlays,
} from '@/lib/plays/playStore';

/**
 * The scratch database comes from run-tests.mjs, which sets BETTING_DB_PATH for the whole
 * run. It cannot be set from inside this file: the store resolves the path on its first
 * call, and a top-level `await import` to delay that makes tsc emit a module Node then
 * refuses to load as CommonJS.
 */

const play = (id: string, sequence: number, extra: Record<string, unknown> = {}) => ({
  play_id: id,
  game_id: 'G1',
  sequence,
  time: Date.now(),
  metadata: { description: `play ${id}` },
  play_stats: [{ player_id: '4046', stats: { rush_yd: 5 } }],
  ...extra,
});

test('a repeated play is banked once and reported once', () => {
  const first = insertNewPlays('2026', 1, 'G1', [play('a', 1), play('b', 2)]);
  assert.equal(first.length, 2);

  // This is the case that makes a 20-play polling window viable: at a 60s cadence almost
  // everything in the window has already been seen, and only genuinely new plays may be
  // announced. Returning repeats would replay the same touchdown every minute.
  const second = insertNewPlays('2026', 1, 'G1', [play('a', 1), play('b', 2), play('c', 3)]);
  assert.deepEqual(second.map(p => p.playId), ['c']);
  assert.equal(playCount('2026', 1), 3);
});

test('a play without an id is skipped rather than stored empty', () => {
  const before = playCount('2026', 1);
  const fresh = insertNewPlays('2026', 1, 'G1', [{ play_id: '' } as never]);
  assert.equal(fresh.length, 0);
  assert.equal(playCount('2026', 1), before);
});

test('missing play_stats is stored as an empty list, not null', () => {
  insertNewPlays('2026', 1, 'G1', [play('d', 4, { play_stats: null })]);
  const stored = playsForWeek('2026', 1).find(p => p.playId === 'd');
  assert.ok(stored);
  assert.deepEqual(stored.playStats, []);
});

test('weeks are isolated from each other', () => {
  insertNewPlays('2026', 2, 'G9', [play('w2', 1)]);
  assert.equal(playCount('2026', 2), 1);
  assert.ok(!playsForWeek('2026', 1).some(p => p.playId === 'w2'));
});

test('a stored play keeps its original first_seen_at', () => {
  const before = playsForWeek('2026', 1).find(p => p.playId === 'a')!.firstSeenAt;
  insertNewPlays('2026', 1, 'G1', [play('a', 1)]);
  const after = playsForWeek('2026', 1).find(p => p.playId === 'a')!.firstSeenAt;
  // first_seen_at is a measurement of when WE saw the play, and the live-latency figure is
  // computed from it. Re-stamping it on every poll would drive that measurement to zero and
  // make a badly lagging feed look instant.
  assert.equal(after, before);
});

test('recentPlays returns newest first and respects the limit', () => {
  const rows = recentPlays('2026', 1, 2);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].sequence! >= rows[1].sequence!);
});

test('latency is null with nothing to measure, and a median otherwise', () => {
  assert.equal(observedLatencySeconds('2026', 99), null);

  const now = Date.now();
  insertNewPlays('2026', 50, 'G50', [
    { play_id: 'L1', game_id: 'G50', sequence: 1, time: now - 30_000, metadata: {}, play_stats: [] },
    { play_id: 'L2', game_id: 'G50', sequence: 2, time: now - 20_000, metadata: {}, play_stats: [] },
    { play_id: 'L3', game_id: 'G50', sequence: 3, time: now - 10_000, metadata: {}, play_stats: [] },
  ]);
  const latency = observedLatencySeconds('2026', 50);
  assert.ok(latency !== null);
  // The median of ~30s, ~20s and ~10s behind. Generous bounds: SQLite stamps to whole
  // seconds, so exact equality would be flaky.
  assert.ok(latency >= 15 && latency <= 25, `median latency was ${latency}`);
});

test('a play timestamped in a backfill is excluded from the latency figure', () => {
  const now = Date.now();
  insertNewPlays('2026', 51, 'G51', [
    // Days old — a reconcile pass picking up an old game. Left in, it would swamp the
    // median and make live capture look broken.
    { play_id: 'B1', game_id: 'G51', sequence: 1, time: now - 86_400_000, metadata: {}, play_stats: [] },
    { play_id: 'B2', game_id: 'G51', sequence: 2, time: now - 5_000, metadata: {}, play_stats: [] },
  ]);
  const latency = observedLatencySeconds('2026', 51);
  assert.ok(latency !== null && latency < 60, `latency was ${latency}`);
});
