import test from 'node:test';
import assert from 'node:assert/strict';
import { SleeperService } from '@/services/sleeper/sleeperService';

/**
 * Concurrent callers must SHARE one request for whole-week data.
 *
 * The stats and projections endpoints return every player for a week and are identical for every
 * league, so twenty leagues priced concurrently used to issue twenty identical multi-megabyte
 * requests: the cache is checked before the fetch, and nothing populates it until one finishes, so
 * every caller missed. A real /week load made 39 calls to the same stats URL, 17 MB in total, and the
 * browser eventually failed them with a NetworkError, leaving the page stuck loading.
 *
 * CacheService no-ops in Node (it guards on `typeof window`), so these tests exercise the in-flight
 * sharing specifically rather than the cache — which is the half that was broken.
 */

function stubFetch(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    // A tick of latency, so concurrent callers genuinely overlap. With an instantly-resolved promise
    // the bug would not reproduce and the test would pass against the broken version.
    await new Promise(resolve => setTimeout(resolve, 25));
    return {
      ok: true,
      json: async () => ({ '4046': { pts_half_ppr: 21.5 } }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('twenty concurrent stats callers make ONE request', async () => {
  const { calls, restore } = stubFetch();
  try {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => SleeperService.getWeeklyStats('2026', 2)),
    );
    assert.equal(calls.length, 1, `expected 1 request, got ${calls.length}`);
    // Every caller gets the real data, not an empty object.
    for (const r of results) assert.equal(r['4046'].pts_half_ppr, 21.5);
  } finally {
    restore();
  }
});

test('projections share independently of stats', async () => {
  const { calls, restore } = stubFetch();
  try {
    await Promise.all([
      ...Array.from({ length: 10 }, () => SleeperService.getWeeklyProjections('2026', 3)),
      ...Array.from({ length: 10 }, () => SleeperService.getWeeklyStats('2026', 3)),
    ]);
    // One each — they are different URLs and must not collapse into each other.
    assert.equal(calls.length, 2, `expected 2 requests, got ${calls.length}: ${calls.join(', ')}`);
    assert.ok(calls.some(u => u.includes('/projections/')));
    assert.ok(calls.some(u => u.includes('/stats/')));
  } finally {
    restore();
  }
});

test('different weeks are not shared with each other', async () => {
  const { calls, restore } = stubFetch();
  try {
    await Promise.all([
      SleeperService.getWeeklyStats('2026', 4),
      SleeperService.getWeeklyStats('2026', 5),
    ]);
    assert.equal(calls.length, 2);
  } finally {
    restore();
  }
});

test('a FAILED fetch does not poison later attempts', async () => {
  /*
   * The trap in caching a promise: if the entry is left behind after a rejection, every later caller
   * gets the same failure for the life of the page and no retry is ever made. The entry has to be
   * cleared whatever happened.
   */
  const original = globalThis.fetch;
  let attempt = 0;
  globalThis.fetch = (async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('network down');
    return { ok: true, json: async () => ({ ok: { pts_half_ppr: 1 } }) } as unknown as Response;
  }) as typeof globalThis.fetch;

  try {
    const first = await SleeperService.getWeeklyStats('2026', 9);
    assert.deepEqual(first, {}, 'a failure yields an empty map rather than throwing');

    const second = await SleeperService.getWeeklyStats('2026', 9);
    assert.equal(attempt, 2, 'the second call must actually retry');
    assert.ok('ok' in second, 'and must get the real data');
  } finally {
    globalThis.fetch = original;
  }
});

test('sequential callers after completion still work', async () => {
  const { calls, restore } = stubFetch();
  try {
    await SleeperService.getWeeklyStats('2026', 7);
    await SleeperService.getWeeklyStats('2026', 7);
    // No cache in Node, so the second is a fresh request — the point is it SUCCEEDS rather than
    // returning a stale shared promise.
    assert.equal(calls.length, 2);
  } finally {
    restore();
  }
});
