import test from 'node:test';
import assert from 'node:assert/strict';
import { RATING_RAMP } from '@/constants/colors';
import { RATING_SCALE, rateWinProbability } from '@/services/week/winRating';

/** The breakdown's arithmetic, independent of how it is drawn. */
function breakdown(probabilities: number[]) {
  const byKey = new Map(RATING_SCALE.map(r => [r.key, 0]));
  for (const p of probabilities) {
    const k = rateWinProbability(p).key;
    byKey.set(k, (byKey.get(k) ?? 0) + 1);
  }
  const counts = RATING_SCALE.map(r => ({ rating: r, count: byKey.get(r.key) ?? 0 }));
  return {
    counts,
    you: counts.filter(c => c.rating.favours === 'you').reduce((s, c) => s + c.count, 0),
    them: counts.filter(c => c.rating.favours === 'them').reduce((s, c) => s + c.count, 0),
    tossups: counts.find(c => c.rating.key === 'tossup')!.count,
  };
}

test('every rating in the ramp has a colour, and no colour is reused', () => {
  const keys = RATING_SCALE.map(r => r.key);
  for (const k of keys) assert.ok(RATING_RAMP[k], `no colour for ${k}`);
  const used = keys.map(k => RATING_RAMP[k]);
  assert.equal(new Set(used).size, used.length, 'each step must be its own hue');
});

test('the ramp gets darker toward each pole, which is the whole convention', () => {
  // Relative luminance: the outer steps must be darker than the inner ones on each side, or
  // "darker means a stronger call" is not what the reader sees.
  const lum = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  assert.ok(lum(RATING_RAMP.solid_you) < lum(RATING_RAMP.likely_you), 'solid you darker than likely');
  assert.ok(lum(RATING_RAMP.likely_you) < lum(RATING_RAMP.lean_you), 'likely you darker than lean');
  assert.ok(lum(RATING_RAMP.solid_them) < lum(RATING_RAMP.likely_them), 'solid them darker than likely');
  assert.ok(lum(RATING_RAMP.likely_them) < lum(RATING_RAMP.lean_them), 'likely them darker than lean');
});

test('counts total the number of matchups, and every bucket is present', () => {
  const probs = [0.52, 0.47, 0.57, 0.73, 0.215, 0.50, 0.62, 0.80];
  const b = breakdown(probs);
  assert.equal(b.counts.length, 7, 'all seven buckets, occupied or not');
  assert.equal(b.counts.reduce((s, c) => s + c.count, 0), probs.length);
  assert.equal(b.you + b.them + b.tossups, probs.length, 'nothing falls between the sides');
});

test('side totals exclude toss-ups, the way a seat bar is read', () => {
  const b = breakdown([0.5, 0.5, 0.5, 0.62]);
  assert.equal(b.tossups, 3);
  assert.equal(b.you, 1);
  assert.equal(b.them, 0);
  assert.notEqual(b.you, 4, 'a toss-up is not yet anybody\'s');
});

test('the real week-1 slate breaks down as 0-1-3-6-0-1-1', () => {
  // Measured from the live probabilities, not assumed: 73.0% is Likely you rather than Lean,
  // and 34.7% is Likely them. Pinned so a threshold change has to be deliberate.
  const week1 = [0.517, 0.524, 0.475, 0.538, 0.462, 0.461, 0.566, 0.574, 0.594, 0.347, 0.730, 0.215];
  const b = breakdown(week1);
  assert.deepEqual(b.counts.map(c => c.count), [0, 1, 3, 6, 0, 1, 1]);
  assert.equal(b.you, 4);
  assert.equal(b.them, 2);
  assert.equal(b.tossups, 6, 'half the slate is a toss-up before anyone plays');
  assert.equal(b.you + b.them + b.tossups, 12);
});

test('an empty week produces zeros rather than throwing', () => {
  const b = breakdown([]);
  assert.equal(b.counts.reduce((s, c) => s + c.count, 0), 0);
  assert.equal(b.you, 0);
  assert.equal(b.them, 0);
});
