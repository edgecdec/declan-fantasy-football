import test from 'node:test';
import assert from 'node:assert/strict';
import { nflWeekIsComplete } from '@/lib/betting/settlement';

/**
 * These are the highest-stakes assertions in the suite.
 *
 * `nflWeekIsComplete` returning a wrong `true` settles every open market on whatever
 * Sleeper last reported, moving real balances. A degraded ESPN response has no
 * unfinished games in it, which a naive boolean reads as "the week is over" — so the
 * function must return null ("cannot tell") rather than false, and every one of these
 * cases must decline to settle.
 */

const realFetch = globalThis.fetch;
function stub(impl: () => unknown) {
  globalThis.fetch = impl as unknown as typeof fetch;
}
function games(n: number, state = 'post') {
  return {
    ok: true,
    json: async () => ({
      events: Array.from({ length: n }, () => ({ competitions: [{ status: { type: { state } } }] })),
    }),
  };
}

test.afterEach(() => { globalThis.fetch = realFetch; });

test('a full slate of finals is complete', async () => {
  stub(() => games(16));
  assert.equal(await nflWeekIsComplete('2025', 3), true);
  stub(() => games(13)); // bye-heavy but real
  assert.equal(await nflWeekIsComplete('2025', 3), true);
});

test('an empty or truncated response is unknown, NOT complete', async () => {
  for (const n of [0, 1, 5, 11]) {
    stub(() => games(n));
    assert.equal(
      await nflWeekIsComplete('2025', 3), null,
      `${n} events must be treated as a degraded response`,
    );
  }
  stub(() => ({ ok: true, json: async () => ({}) }));
  assert.equal(await nflWeekIsComplete('2025', 3), null, 'no events key');
  stub(() => ({ ok: true, json: async () => ({ events: null }) }));
  assert.equal(await nflWeekIsComplete('2025', 3), null, 'null events');
});

test('an upstream failure is unknown, NOT complete', async () => {
  stub(() => ({ ok: false, status: 503, json: async () => ({}) }));
  assert.equal(await nflWeekIsComplete('2025', 3), null, 'HTTP 503');
  stub(() => { throw new Error('network down'); });
  assert.equal(await nflWeekIsComplete('2025', 3), null, 'network throw');
  stub(() => ({ ok: true, json: async () => { throw new Error('bad json'); } }));
  assert.equal(await nflWeekIsComplete('2025', 3), null, 'unparseable body');
});

test('one unfinished game means the week is not over', async () => {
  for (const state of ['pre', 'in']) {
    stub(() => ({
      ok: true,
      json: async () => ({
        events: Array.from({ length: 16 }, (_, i) => ({
          competitions: [{ status: { type: { state: i === 15 ? state : 'post' } } }],
        })),
      }),
    }));
    assert.equal(await nflWeekIsComplete('2025', 3), false, `one game in state "${state}"`);
  }
});

test('an unrecognised or missing game state counts as unfinished', async () => {
  for (const state of [undefined, null, '', 'halftime', 'postponed']) {
    stub(() => ({
      ok: true,
      json: async () => ({
        events: Array.from({ length: 16 }, (_, i) => ({
          competitions: [{ status: { type: { state: i === 15 ? state : 'post' } } }],
        })),
      }),
    }));
    assert.equal(await nflWeekIsComplete('2025', 3), false, `state ${String(state)} must not settle`);
  }
});

test('a malformed event shape does not throw or settle', async () => {
  stub(() => ({
    ok: true,
    json: async () => ({
      events: [...Array.from({ length: 15 }, () => ({ competitions: [{ status: { type: { state: 'post' } } }] })),
        { competitions: [] }],
    }),
  }));
  assert.equal(await nflWeekIsComplete('2025', 3), false, 'an event with no competition');
});
