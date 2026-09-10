import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PTS_ALLOW_BRACKETS,
  YDS_ALLOW_BRACKETS,
  bracketFor,
  bracketMoments,
  bracketPoints,
  defenseBracketAdjustment,
  pricesBrackets,
  remainingScoringShare,
} from '@/services/betting/defenseBrackets';

/**
 * The defence bracket correction.
 *
 * The behaviour worth pinning down is the pair of endpoints — nothing credited at kickoff, the
 * true bracket at the whistle — and the middle case a simpler time-based rule gets wrong, where
 * a defence is sliding into a WORSE bracket rather than merely losing the one it holds.
 */

/** A league paying 10/7/4/1/0/-1/-4 on points allowed, like three of this user's. */
const SCORING: Record<string, number> = {
  pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1,
  pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4,
};

const adjust = (minutesRemaining: number, currentPtsAllow: number, projectedPtsAllow = 23) =>
  defenseBracketAdjustment({
    scoring: SCORING, currentPtsAllow, currentYdsAllow: 0, projectedPtsAllow, minutesRemaining,
  });

test('brackets map values to the right slot, including the edges', () => {
  assert.equal(bracketFor(PTS_ALLOW_BRACKETS, 0).key, 'pts_allow_0');
  assert.equal(bracketFor(PTS_ALLOW_BRACKETS, 1).key, 'pts_allow_1_6');
  assert.equal(bracketFor(PTS_ALLOW_BRACKETS, 6).key, 'pts_allow_1_6');
  assert.equal(bracketFor(PTS_ALLOW_BRACKETS, 7).key, 'pts_allow_7_13');
  assert.equal(bracketFor(PTS_ALLOW_BRACKETS, 34).key, 'pts_allow_28_34');
  assert.equal(bracketFor(PTS_ALLOW_BRACKETS, 35).key, 'pts_allow_35p');
  assert.equal(bracketFor(PTS_ALLOW_BRACKETS, 99).key, 'pts_allow_35p');
  // Sleeper's yards names overlap at the boundary; 100 belongs to the first bracket.
  assert.equal(bracketFor(YDS_ALLOW_BRACKETS, 100).key, 'yds_allow_0_100');
  assert.equal(bracketFor(YDS_ALLOW_BRACKETS, 101).key, 'yds_allow_100_199');
});

test('a league pricing no brackets contributes nothing', () => {
  assert.equal(pricesBrackets(PTS_ALLOW_BRACKETS, {}), false);
  assert.equal(bracketPoints(PTS_ALLOW_BRACKETS, {}, 0), 0);
  const a = defenseBracketAdjustment({
    scoring: {}, currentPtsAllow: 0, currentYdsAllow: 0, minutesRemaining: 60,
  });
  assert.deepEqual(a, { credited: 0, expected: 0, variance: 0, correction: 0 });
});

test('the scoring clock is the measured quarter curve, not minutes over sixty', () => {
  assert.equal(remainingScoringShare(60), 1);
  assert.equal(remainingScoringShare(0), 0);
  // Measured cumulative shares: 20.1% by the end of Q1, 50.4% by halftime, 71.2% by Q3.
  assert.ok(Math.abs(remainingScoringShare(45) - (1 - 0.201)) < 1e-9);
  assert.ok(Math.abs(remainingScoringShare(30) - (1 - 0.504)) < 1e-9);
  assert.ok(Math.abs(remainingScoringShare(15) - (1 - 0.712)) < 1e-9);
  // Halftime is where a linear rule happens to agree, which is why it survives a spot check.
  assert.ok(Math.abs(remainingScoringShare(30) - 0.5) < 0.005);
  // The end of Q1 is where it does not: linear claims 25% elapsed against a measured 20.1%.
  assert.ok(remainingScoringShare(45) - 0.75 > 0.04);
});

test('the clock is clamped, so a stray value cannot invert the correction', () => {
  assert.equal(remainingScoringShare(999), 1);
  assert.equal(remainingScoringShare(-5), 0);
});

test('at kickoff the whole spurious shutout bonus is removed', () => {
  const a = adjust(60, 0);
  assert.equal(a.credited, 10);
  // What is left is the projected bracket for a defence expected to allow 23 — near nothing.
  assert.ok(a.expected < 1.5, `expected ${a.expected}`);
  assert.ok(a.correction < -8.5, `correction ${a.correction}`);
});

test('at the final whistle the correction is exactly zero', () => {
  // Nothing left to project, so the credited bracket IS the answer and must not be disturbed —
  // a non-zero correction here would move a settled score.
  for (const pa of [0, 3, 10, 17, 24, 31, 45]) {
    const a = adjust(0, pa);
    assert.equal(a.correction, 0, `points allowed ${pa}`);
    assert.equal(a.expected, bracketPoints(PTS_ALLOW_BRACKETS, SCORING, pa));
    assert.equal(a.variance, 0);
  }
});

test('a defence being run over slides toward a WORSE bracket, not toward zero', () => {
  // The case a shrink-by-time rule cannot express. Down 28 at halftime, the current bracket pays
  // -1; halving that gives -0.5, while another ~11 points are coming and 35+ pays -4.
  const a = adjust(30, 28);
  assert.equal(a.credited, -1);
  assert.ok(a.expected < -1, `expected ${a.expected} should be worse than the credited -1`);
  const shrinkRule = a.credited * (1 - 30 / 60);
  assert.ok(a.expected < shrinkRule - 1, `model ${a.expected} vs shrink rule ${shrinkRule}`);
});

test('holding a shutout is worth more the later it gets', () => {
  const values = [60, 45, 30, 15, 2, 0].map(m => adjust(m, 0).expected);
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] > values[i - 1], `not increasing at index ${i}: ${values.join(', ')}`);
  }
  // And converges on the full bonus rather than overshooting it.
  assert.equal(values[values.length - 1], 10);
  assert.ok(values[values.length - 2] > 8, `two minutes left was only ${values[4]}`);
});

test('the opponent-specific projection moves the answer', () => {
  // Sleeper publishes pts_allow per team, so a defence facing a feeble offence must price better
  // than one facing a good offence at the same point in the game.
  const soft = adjust(60, 0, 14).expected;
  const hard = adjust(60, 0, 31).expected;
  assert.ok(soft > hard, `soft ${soft} should beat hard ${hard}`);
});

test('a missing projection falls back to the league mean rather than to zero', () => {
  // Zero would price every defence as an expected shutout, which is the original bug again.
  const a = defenseBracketAdjustment({
    scoring: SCORING, currentPtsAllow: 0, currentYdsAllow: 0, minutesRemaining: 60,
  });
  const withMean = adjust(60, 0, 22.71);
  assert.ok(Math.abs(a.expected - withMean.expected) < 1e-9);
});

test('uncertainty peaks mid-game rather than at kickoff, and is gone at the whistle', () => {
  /*
   * NOT monotonic, and that is correct rather than a defect — worth writing down because the
   * obvious expectation is wrong.
   *
   * The spread being measured is in PAYTABLE points, not in points allowed. At kickoff a defence
   * expected to allow 23 sits across the 14-20 / 21-27 / 28-34 brackets, which pay 1 / 0 / -1 —
   * barely any swing however uncertain the score is. Holding a shutout to halftime moves the
   * belief onto 1-6 / 7-13 / 14-20, paying 7 / 4 / 1, so there is far MORE money in play even
   * though less of the game remains. Asserting a monotonic decline here failed for that reason.
   */
  const kickoff = Math.sqrt(adjust(60, 0).variance);
  const halftime = Math.sqrt(adjust(30, 0).variance);
  const late = Math.sqrt(adjust(2, 0).variance);
  const final = Math.sqrt(adjust(0, 0).variance);

  assert.ok(halftime > kickoff, `halftime ${halftime} should exceed kickoff ${kickoff}`);
  // Once the answer is nearly settled the spread does collapse.
  assert.ok(late < halftime, `late ${late} should be under halftime ${halftime}`);
  assert.equal(final, 0);
  // The bracket alone carries multiple points of spread, which the old model had no idea about.
  assert.ok(kickoff > 1.5, `kickoff sd was only ${kickoff}`);
});

test('bracket probabilities are a distribution: the mean cannot escape the paytable', () => {
  const values = PTS_ALLOW_BRACKETS.map(b => SCORING[b.key]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  for (const mins of [60, 45, 30, 15, 5, 0]) {
    for (const pa of [0, 7, 14, 21, 28, 35, 50]) {
      const m = bracketMoments(PTS_ALLOW_BRACKETS, SCORING, pa + 23 * (mins / 60), 9.66, true);
      assert.ok(m.mean >= lo - 1e-9 && m.mean <= hi + 1e-9, `${mins}min ${pa}pa -> ${m.mean}`);
    }
  }
});

test('yards brackets are handled too, and independently of points', () => {
  const both = defenseBracketAdjustment({
    scoring: { ...SCORING, yds_allow_0_100: 5, yds_allow_550p: -5 },
    currentPtsAllow: 0, currentYdsAllow: 0, projectedPtsAllow: 23, projectedYdsAllow: 330,
    minutesRemaining: 60,
  });
  // 5 points of yards bonus is credited at kickoff on top of the 10 for points.
  assert.equal(both.credited, 15);
  assert.ok(both.correction < -13, `correction ${both.correction}`);
});

/** Prints the table quoted in the module doc comment, so those numbers are generated not typed. */
test('worked example', () => {
  const shrink = (c: number, m: number) => c * (1 - m / 60);
  const rows: [string, number, number][] = [
    ['kickoff, 0 allowed', 60, 0],
    ['end of Q1, 0 allowed', 45, 0],
    ['halftime, 0 allowed', 30, 0],
    ['halftime, 14 allowed', 30, 14],
    ['halftime, 28 allowed', 30, 28],
    ['end of Q3, 0 allowed', 15, 0],
    ['2 min left, 0 allowed', 2, 0],
    ['final, 24 allowed', 0, 24],
  ];
  const lines = rows.map(([label, mins, pa]) => {
    const a = adjust(mins, pa);
    return `  ${label.padEnd(23)} credited ${a.credited.toFixed(2).padStart(6)}`
      + `  model ${a.expected.toFixed(2).padStart(6)}`
      + `  sd ${Math.sqrt(a.variance).toFixed(2).padStart(5)}`
      + `  shrinkRule ${shrink(a.credited, mins).toFixed(2).padStart(6)}`;
  });
  console.log('\n' + lines.join('\n') + '\n');
  assert.equal(lines.length, rows.length);
});
