import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StatLine, addStats, derivedBonusStats, normalisePlayStats, scorePlayForPlayer, scoreStatLine,
} from '@/services/plays/playScoring';

/** Half-PPR with a first-down bonus and yardage milestones — the real shape of a league. */
const SCORING: Record<string, number> = {
  rec: 0.5, rec_yd: 0.1, rec_td: 6,
  rush_yd: 0.1, rush_td: 6, rush_att: 0,
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
  fum_lost: -2,
  bonus_fd_rb: 0.5, bonus_fd_wr: 0.5, bonus_fd_te: 0.5, bonus_fd_qb: 0.5,
  bonus_rec_te: 0.5,
  bonus_rush_yd_100: 3, bonus_rec_yd_100: 3, bonus_rush_rec_yd_100: 2,
  bonus_pass_yd_300: 3,
};

test('a plain stat line scores by multiplying each key', () => {
  // Mark Andrews' real 27-yard touchdown catch.
  const line: StatLine = { rec: 1, rec_yd: 27, rec_td: 1, rec_tgt: 1 };
  assert.equal(scoreStatLine(line, SCORING), 0.5 + 2.7 + 6);
});

test('unscored stats are ignored rather than counted as zero-or-one', () => {
  // The play feed carries many stats a league does not score (rec_yar, rec_20_29, off_snp).
  const withNoise: StatLine = { rec: 1, rec_yd: 10, rec_yar: 4, rec_20_29: 1, rec_tgt: 1 };
  assert.equal(scoreStatLine(withNoise, SCORING), 0.5 + 1.0);
});

test('a per-event bonus fires once per occurrence', () => {
  const b = derivedBonusStats('RB', {}, { rush_fd: 1, rush_yd: 12, rush_att: 1 });
  assert.equal(b.bonus_fd_rb, 1);
  // Two first downs on one play cannot happen, but two receptions-with-first-down can across
  // a stat line, and the bonus must count them all.
  const two = derivedBonusStats('WR', {}, { rec_fd: 1, rush_fd: 1 });
  assert.equal(two.bonus_fd_wr, 2);
});

test('the first-down bonus is position-specific, and a QB counts passing first downs', () => {
  // bonus_fd_qb includes pass_fd, which is why the source list differs by position.
  assert.equal(derivedBonusStats('QB', {}, { pass_fd: 1 }).bonus_fd_qb, 1);
  assert.equal(derivedBonusStats('RB', {}, { pass_fd: 1 }).bonus_fd_rb, undefined,
    'a running back does not earn a bonus for a passing first down');
  assert.equal(derivedBonusStats('WR', {}, { rec_fd: 1 }).bonus_fd_wr, 1);
  assert.equal(derivedBonusStats('K', {}, { rec_fd: 1 }).bonus_fd_k, undefined,
    'kickers have no position bonus');
});

test('a milestone fires exactly once, on the play that crosses it', () => {
  // 95 yards, then a 10-yard run: the bonus belongs to THIS play.
  const crossing = derivedBonusStats('RB', { rush_yd: 95 }, { rush_yd: 10 });
  assert.equal(crossing.bonus_rush_yd_100, 1);
  // The very next play must NOT re-award it. This is the bug the before/after comparison
  // exists to prevent — scoring on "total >= 100" would pay it out for the rest of the game.
  const after = derivedBonusStats('RB', { rush_yd: 105 }, { rush_yd: 4 });
  assert.equal(after.bonus_rush_yd_100, undefined);
});

test('a milestone does not fire early', () => {
  assert.equal(derivedBonusStats('RB', { rush_yd: 80 }, { rush_yd: 10 }).bonus_rush_yd_100, undefined);
  assert.equal(derivedBonusStats('RB', { rush_yd: 99 }, { rush_yd: 1 }).bonus_rush_yd_100, 1,
    'exactly 100 counts');
});

test('a combined-yardage milestone sums its component stats', () => {
  // 60 rushing + 45 receiving crosses 100 combined without crossing either alone.
  const b = derivedBonusStats('RB', { rush_yd: 60, rec_yd: 35 }, { rec_yd: 10 });
  assert.equal(b.bonus_rush_rec_yd_100, 1);
  assert.equal(b.bonus_rush_yd_100, undefined, 'rushing alone is only at 60');
  assert.equal(b.bonus_rec_yd_100, undefined, 'receiving alone is only at 45');
});

test('addStats accumulates without mutating the original', () => {
  const before: StatLine = { rush_yd: 10 };
  const after = addStats(before, { rush_yd: 5, rush_td: 1 });
  assert.deepEqual(after, { rush_yd: 15, rush_td: 1 });
  assert.deepEqual(before, { rush_yd: 10 }, 'the input must not be mutated');
});

test('addStats ignores non-numeric and non-finite values', () => {
  const out = addStats({ rec: 1 }, { rec: 1, junk: NaN, other: Infinity } as StatLine);
  assert.equal(out.rec, 2);
  assert.ok(!('junk' in out) && !('other' in out));
});

test('scorePlayForPlayer separates base points from bonus points', () => {
  // A 12-yard first-down catch by a tight end, at 95 receiving yards.
  const s = scorePlayForPlayer(
    { rec: 1, rec_yd: 12, rec_fd: 1 }, { rec_yd: 95 }, 'TE', SCORING,
  );
  assert.equal(s.base, 0.5 + 1.2);
  // first down 0.5 + TE reception 0.5 + crossing 100 receiving yards 3 + combined 100 -> 2
  assert.equal(s.bonus, 0.5 + 0.5 + 3 + 2);
  assert.equal(s.total, Math.round((s.base + s.bonus) * 100) / 100);
  assert.equal(s.bonusStats.bonus_rec_yd_100, 1);
});

test('points are rounded to two decimals, because floats drift over a game', () => {
  const s = scorePlayForPlayer({ pass_yd: 27 }, {}, 'QB', SCORING);
  assert.equal(s.total, 1.08);
  // 0.04 x 27 is 1.0800000000000003 unrounded; summed across 40 attempts that is visible.
  assert.equal(String(s.total).length <= 4, true);
});

test('a negative play scores negative, and a turnover is not softened', () => {
  assert.equal(scorePlayForPlayer({ rush_yd: -1, rush_att: 1 }, {}, 'QB', SCORING).total, -0.1);
  assert.equal(scorePlayForPlayer({ fum_lost: 1 }, {}, 'RB', SCORING).total, -2);
});

test('an unknown position still scores its base stats', () => {
  // Defensive players appear in play_stats; they must not throw, just earn no position bonus.
  const s = scorePlayForPlayer({ rush_yd: 20 }, {}, null, SCORING);
  assert.equal(s.base, 2);
  assert.equal(s.bonus, 0);
});

test('a league that scores no bonuses gets no bonus points', () => {
  const plain = { rec: 1, rec_yd: 0.1, rush_yd: 0.1 };
  const s = scorePlayForPlayer({ rec: 1, rec_fd: 1, rec_yd: 12 }, { rec_yd: 95 }, 'WR', plain);
  assert.equal(s.bonus, 0, 'bonus stats are derived but score nothing if unpriced');
});

test('a converted two-point pass scores for both passer and receiver', () => {
  // The play feed calls it conv_cmp/conv_pass_att; the scoring settings price pass_2pt. Without
  // translating, four players lost exactly 2.00 each over one real week.
  const passer = scorePlayForPlayer({ conv_cmp: 1, conv_pass_att: 1 }, {}, 'QB', SCORING);
  assert.equal(passer.total, 2, 'the passer earns pass_2pt');
  const receiver = scorePlayForPlayer({ conv_cmp: 1, conv_rec_att: 1 }, {}, 'WR', { ...SCORING, rec_2pt: 2 });
  assert.equal(receiver.total, 2, 'the receiver earns rec_2pt');
});

test('a FAILED two-point attempt scores nothing', () => {
  // conv_cmp is the success flag; the attempt keys alone must not pay out.
  const failed = scorePlayForPlayer({ conv_pass_att: 1 }, {}, 'QB', SCORING);
  assert.equal(failed.total, 0);
  const failedRec = scorePlayForPlayer({ conv_rec_att: 1 }, {}, 'WR', { ...SCORING, rec_2pt: 2 });
  assert.equal(failedRec.total, 0);
});

test('normalisePlayStats leaves ordinary plays untouched', () => {
  const plain: StatLine = { rec: 1, rec_yd: 12 };
  assert.equal(normalisePlayStats(plain), plain, 'the same object, not a copy, when nothing to do');
  const conv = normalisePlayStats({ conv_cmp: 1, conv_rush_att: 1 });
  assert.equal(conv.rush_2pt, 1);
  assert.equal(conv.conv_cmp, 1, 'the original keys survive for display');
});
