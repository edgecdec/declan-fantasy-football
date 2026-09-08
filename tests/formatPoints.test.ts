import test from 'node:test';
import assert from 'node:assert/strict';
import { formatProjection, formatScore, formatScoreDelta } from '@/services/common/formatPoints';

test('scores show exactly two decimals', () => {
  assert.equal(formatScore(137.54), '137.54');
  assert.equal(formatScore(137.5), '137.50', 'padded, so a column stays aligned');
  assert.equal(formatScore(137), '137.00');
  assert.equal(formatScore(0), '0.00');
});

test('a score is never shown with more than two decimals', () => {
  // Sleeper occasionally reports more precision than it displays; the table must not.
  assert.equal(formatScore(12.3456789), '12.35');
  assert.equal(formatScore(1 / 3), '0.33');
});

test('two decimals are load-bearing, not decoration', () => {
  // Rounding to one decimal makes these two look tied when one of them actually won.
  const a = 121.44, b = 121.38;
  assert.notEqual(formatScore(a), formatScore(b));
  assert.equal(a.toFixed(1), b.toFixed(1), 'one decimal really does hide this result');
});

test('a negative score keeps its sign and precision', () => {
  // Defences can finish negative.
  assert.equal(formatScore(-3.25), '-3.25');
});

test('deltas carry an explicit sign, and zero is unsigned', () => {
  assert.equal(formatScoreDelta(16.62), '+16.62');
  assert.equal(formatScoreDelta(-16.62), '-16.62');
  assert.equal(formatScoreDelta(0), '0.00', 'zero is not "+0.00"');
});

test('projections stay at one decimal, because the extra digit is false precision', () => {
  assert.equal(formatProjection(12.47), '12.5');
  assert.equal(formatProjection(12), '12.0');
  assert.equal(formatProjection(0), '0.0');
});
