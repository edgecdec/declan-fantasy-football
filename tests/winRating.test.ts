import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RATING_SCALE, RATING_THRESHOLDS, WinRatingKey, rateWinProbability,
} from '@/services/week/winRating';

test('the scale is seven ratings, ordered from solid-you to solid-them', () => {
  assert.equal(RATING_SCALE.length, 7);
  assert.deepEqual(RATING_SCALE.map(r => r.key), [
    'solid_you', 'likely_you', 'lean_you', 'tossup', 'lean_them', 'likely_them', 'solid_them',
  ]);
  RATING_SCALE.forEach((r, i) => assert.equal(r.index, i, `${r.key} index`));
});

test('ratings are symmetric — p and 1-p mirror each other', () => {
  // The rating must never depend on which side of a matchup you look from. Swept finely and
  // including the exact band boundaries, because that is where it broke: |p-0.5| and
  // |(1-p)-0.5| are not always bit-identical in floating point.
  const boundaries = [0.25, 0.4, 0.45, 0.5, 0.55, 0.6, 0.75];
  for (const b of boundaries) {
    for (const p of [b, 1 - b, b + 1e-15, b - 1e-15]) {
      const a = rateWinProbability(p);
      const m = rateWinProbability(1 - p);
      assert.equal(a.index + m.index, 6, `boundary ${b} at p=${p} broke the mirror`);
    }
  }
  for (let p = 0; p <= 1.0001; p += 0.001) {
    const a = rateWinProbability(p);
    const b = rateWinProbability(1 - p);
    assert.equal(a.index + b.index, 6, `p=${p.toFixed(2)} broke the mirror`);
    assert.equal(a.step, b.step, `p=${p.toFixed(2)} step mismatch`);
    if (a.favours === null) assert.equal(b.favours, null);
    else assert.notEqual(a.favours, b.favours);
  }
});

test('a coin flip is a toss-up, and the band matches the validated thresholds', () => {
  assert.equal(rateWinProbability(0.5).key, 'tossup');
  assert.equal(rateWinProbability(0.5).favours, null);
  assert.equal(rateWinProbability(0.5).step, 0);
  // 45-55 inclusive of the interior, per the thresholds checked against real matchups.
  assert.equal(rateWinProbability(0.549).key, 'tossup');
  assert.equal(rateWinProbability(0.451).key, 'tossup');
  // The band boundary belongs to the favoured side, on both sides, exactly.
  assert.equal(rateWinProbability(RATING_THRESHOLDS.lean).key, 'lean_you');
  assert.equal(rateWinProbability(1 - RATING_THRESHOLDS.lean).key, 'lean_them', 'mirrors exactly');
});

test('each band starts exactly at its threshold', () => {
  const { lean, likely, solid } = RATING_THRESHOLDS;
  assert.equal(rateWinProbability(lean).key, 'lean_you');
  assert.equal(rateWinProbability(likely - 0.001).key, 'lean_you');
  assert.equal(rateWinProbability(likely).key, 'likely_you');
  assert.equal(rateWinProbability(solid - 0.001).key, 'likely_you');
  assert.equal(rateWinProbability(solid).key, 'solid_you');
  assert.equal(rateWinProbability(1).key, 'solid_you');
  assert.equal(rateWinProbability(0).key, 'solid_them');
});

test('the rating is monotonic in the probability', () => {
  // Sorting by rating index must never disagree with sorting by probability.
  let prev = 7;
  for (let p = 0; p <= 1.0001; p += 0.005) {
    const idx = rateWinProbability(p).index;
    assert.ok(idx <= prev, `rating went the wrong way at p=${p.toFixed(3)}`);
    prev = idx;
  }
});

test('out-of-range input is clamped rather than producing a bad rating', () => {
  for (const bad of [-1, -0.5, 1.5, 42]) {
    const r = rateWinProbability(bad);
    assert.ok(RATING_SCALE.some(s => s.key === r.key), `no valid rating for ${bad}`);
  }
  assert.equal(rateWinProbability(-1).key, 'solid_them');
  assert.equal(rateWinProbability(2).key, 'solid_you');
});

test('a preseason slate lands mostly on or near toss-up', () => {
  // The real week-1 probabilities from 12 leagues. The expectation the design was built
  // around: before anyone plays, almost everything should be a toss-up or a lean, and
  // nothing should be Solid.
  const week1 = [0.517, 0.524, 0.475, 0.538, 0.462, 0.461, 0.566, 0.574, 0.594, 0.347, 0.730, 0.215];
  const counts = new Map<WinRatingKey, number>();
  for (const p of week1) {
    const k = rateWinProbability(p).key;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  assert.equal(counts.get('tossup') ?? 0, 6, 'half the slate should be a toss-up');
  const nearTossup = week1.filter(p => rateWinProbability(p).step <= 1).length;
  assert.equal(nearTossup, 9, 'nine of twelve at toss-up or lean before anyone plays');
  // Solid should be rare rather than absent: it fired 12 times in 650 historical
  // predictions, and one lopsided week-1 line (21.5%) genuinely earns it.
  const solid = (counts.get('solid_you') ?? 0) + (counts.get('solid_them') ?? 0);
  assert.equal(solid, 1, 'exactly the one lopsided matchup is Solid');
  assert.equal(counts.get('solid_you') ?? 0, 0, 'and none of them favour you');
});
