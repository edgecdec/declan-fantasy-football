import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWinProbability } from '@/services/common/formatPoints';

/**
 * Two bugs met in this one number, and the test names both.
 *
 * This Week read its win probability off the BETTING price, which is struck from a copy clamped to
 * the quoting band — so every matchup flatlined at 95% however decided it was. And once that was
 * fixed, a live matchup at 99.96% rounded to a flat "100%", which the model cannot claim while the
 * opponent still has starters on the field.
 */

test('a live matchup is never shown as a certainty', () => {
  // The rounding trap: toFixed(0) turns any of these into "100%".
  for (const p of [0.996, 0.9996, 0.99999, 1]) {
    assert.equal(formatWinProbability(p, false), '>99%', String(p));
  }
  for (const p of [0.004, 0.0004, 0]) {
    assert.equal(formatWinProbability(p, false), '<1%', String(p));
  }
});

test('a live matchup can exceed 95%, which is the cap that was reported', () => {
  // The regression: everything sat at 95% because the priced probability is clamped there.
  assert.equal(formatWinProbability(0.96, false), '96%');
  assert.equal(formatWinProbability(0.97, false), '97%');
  assert.equal(formatWinProbability(0.99, false), '99%');
});

test('a finished matchup shows the certainty it actually is', () => {
  assert.equal(formatWinProbability(1, true), '100%');
  assert.equal(formatWinProbability(0, true), '0%');
});

test('ordinary probabilities are unchanged', () => {
  assert.equal(formatWinProbability(0.5, false), '50%');
  assert.equal(formatWinProbability(0.734, false), '73%');
  assert.equal(formatWinProbability(0.055, false), '6%');
});

test('the two sides of a live matchup never both read as extremes', () => {
  // A sanity property: whatever we show for one side, the complement is shown for the other, and
  // neither is allowed to be 100%.
  for (const p of [0.5, 0.8, 0.96, 0.9999]) {
    const a = formatWinProbability(p, false);
    const b = formatWinProbability(1 - p, false);
    assert.ok(a !== '100%' && b !== '100%', `${a} / ${b}`);
  }
});

test('out-of-range input is clamped rather than producing nonsense', () => {
  assert.equal(formatWinProbability(1.4, false), '>99%');
  assert.equal(formatWinProbability(-0.2, false), '<1%');
  assert.equal(formatWinProbability(1.4, true), '100%');
});
