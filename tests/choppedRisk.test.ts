import test from 'node:test';
import assert from 'node:assert/strict';
import { eliminationProbabilities, type RosterScore } from '@/services/week/choppedRisk';

/**
 * "What is the chance I post the lowest score" in a format with no opponent.
 *
 * The properties worth pinning are the ones a plausible-looking implementation gets wrong: that
 * the probabilities form a distribution (someone finishes last), that they respond to the SPREAD
 * and not just the mean, and that a finished week collapses to the arithmetic answer rather than
 * to a smeared-out guess.
 */

const roster = (rosterId: number, mean: number, sd = 25, banked = 0): RosterScore => ({
  rosterId,
  banked,
  mean,
  sd,
});

/** N rosters that are indistinguishable from one another. */
const identical = (n: number): RosterScore[] =>
  Array.from({ length: n }, (_, i) => roster(i + 1, 110));

test('exchangeable rosters each carry 1/N of the risk', () => {
  for (const n of [2, 8, 15, 17]) {
    const p = eliminationProbabilities(identical(n));
    for (const v of p.values()) {
      assert.ok(
        Math.abs(v - 1 / n) < 1e-3,
        `${n} identical rosters should each be ${(1 / n).toFixed(4)}, got ${v.toFixed(4)}`,
      );
    }
  }
});

test('the probabilities are a distribution — exactly one roster finishes last', () => {
  const field = [roster(1, 95), roster(2, 110, 30), roster(3, 130, 18), roster(4, 104, 22)];
  const total = [...eliminationProbabilities(field).values()].reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(total - 1) < 1e-6, `expected 1, got ${total}`);
});

test('risk is ordered by projection when the spreads match', () => {
  const field = [roster(1, 90), roster(2, 110), roster(3, 130)];
  const p = eliminationProbabilities(field);
  assert.ok(p.get(1)! > p.get(2)!);
  assert.ok(p.get(2)! > p.get(3)!);
});

test('spread matters, not only the mean', () => {
  /*
   * Two rosters project the same total, but one is far more volatile. The volatile one is likelier
   * to post the very low score that gets it chopped, so a model reading only the mean would call
   * these equal and be wrong.
   */
  const p = eliminationProbabilities([
    roster(1, 110, 45),
    roster(2, 110, 12),
    roster(3, 125, 25),
    roster(4, 125, 25),
  ]);
  assert.ok(
    p.get(1)! > p.get(2)!,
    'the volatile roster should carry more elimination risk at equal projection',
  );
});

test('a finished week is arithmetic: the actual lowest score is out', () => {
  // sd 0 everywhere — every game final, nothing left to happen.
  const p = eliminationProbabilities([
    roster(1, 88, 0, 88),
    roster(2, 121, 0, 121),
    roster(3, 99, 0, 99),
  ]);
  assert.ok(p.get(1)! > 0.999, `the 88 should be out for certain, got ${p.get(1)}`);
  assert.ok(p.get(2)! < 1e-6);
  assert.ok(p.get(3)! < 1e-6);
});

test('a large lead is near-zero risk, but never negative', () => {
  const p = eliminationProbabilities([
    roster(1, 200, 20),
    roster(2, 100, 20),
    roster(3, 105, 20),
  ]);
  assert.ok(p.get(1)! < 0.001, `a 95-point lead should be safe, got ${p.get(1)}`);
  for (const v of p.values()) assert.ok(v >= 0);
});

test('a bigger field means less risk each, for the same roster', () => {
  const small = eliminationProbabilities(identical(6)).get(1)!;
  const large = eliminationProbabilities(identical(17)).get(1)!;
  assert.ok(large < small, 'being one of 17 is safer than being one of 6');
});

test('degenerate fields do not throw or divide by zero', () => {
  assert.equal(eliminationProbabilities([]).size, 0);
  const solo = eliminationProbabilities([roster(1, 100)]);
  assert.equal(solo.get(1), 1);
});

test('two chopped leagues of 17 and 15 put expected eliminations near 0.12', () => {
  /*
   * The real shape of this account, and the sanity check on the headline number: it must land
   * around a tenth of a league, not near 1. A version that reported a PERCENTAGE, or that counted
   * eliminated rosters as live, would fail this by a wide margin.
   */
  const a = eliminationProbabilities(identical(17)).get(1)!;
  const b = eliminationProbabilities(identical(15)).get(1)!;
  const expected = a + b;
  assert.ok(expected > 0.1 && expected < 0.15, `expected ~0.125, got ${expected.toFixed(3)}`);
});
