import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StatLine, addStats, derivedBonusStats, displayPoints, isNonPlayStat, normalisePlayStats,
  scorePlayForPlayer, scoreStatLine,
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
  assert.ok(Math.abs(s.base - (0.5 + 1.2)) < 1e-9);
  // first down 0.5 + TE reception 0.5 + crossing 100 receiving yards 3 + combined 100 -> 2
  assert.ok(Math.abs(s.bonus - (0.5 + 0.5 + 3 + 2)) < 1e-9);
  assert.equal(s.total, s.base + s.bonus, 'total is the exact sum, unrounded');
  assert.equal(s.bonusStats.bonus_rec_yd_100, 1);
});

test('points are NOT rounded per play, because the error accumulates', () => {
  // A league pricing yards at 0.125 produces three decimals on most plays. Rounding each play
  // put one running back 0.08 above his official total over a single week, and every player in
  // that league off by a multiple of 0.02. Sleeper computes from season totals, so we have to
  // accumulate exactly.
  const fractional = { rush_yd: 0.125, rec_yd: 0.125 };
  const play = scorePlayForPlayer({ rush_yd: 7 }, {}, 'RB', fractional);
  assert.equal(play.total, 0.875, 'the exact value survives, not 0.88');

  // Summing ten such plays exactly matches scoring the total at once; rounding each would not.
  let exact = 0;
  for (let i = 0; i < 10; i++) exact += scorePlayForPlayer({ rush_yd: 7 }, {}, 'RB', fractional).total;
  assert.ok(Math.abs(exact - 8.75) < 1e-9, `accumulated ${exact}, expected 8.75`);
  let rounded = 0;
  for (let i = 0; i < 10; i++) rounded += Math.round(0.875 * 100) / 100;
  assert.notEqual(rounded, 8.75, 'per-play rounding really does drift — that was the bug');

  assert.equal(displayPoints(0.875), '0.88', 'rounding belongs at the display edge');
});

test('defensive and IDP stats are ignored when scoring a play', () => {
  // The play feed both under-reports real defensive events AND credits IDP stats to offensive
  // players — a quarterback showed idp_ff: 2 against an official 0. In an IDP league that was
  // worth 6 points on one player. Defence has to come from the stats feed instead.
  const idpLeague = { ...SCORING, idp_ff: 3, idp_tkl_solo: 2, sack: 1, int: 2, def_td: 6 };
  const bogus = scorePlayForPlayer({ idp_ff: 2, idp_tkl_solo: 2, sack: 1 }, {}, 'QB', idpLeague);
  assert.equal(bogus.total, 0, 'none of it may score from a play');

  // The same line IS scored when it comes from the authoritative stats feed.
  assert.equal(scoreStatLine({ idp_ff: 2, sack: 1 }, idpLeague, false), 3 * 2 + 1);
  assert.equal(scoreStatLine({ idp_ff: 2, sack: 1 }, idpLeague, true), 0);
});

test('the non-play exclusion covers whole families, not a fixed list', () => {
  // A new idp_/def_ key appearing upstream must not silently start scoring from plays.
  for (const k of ['idp_anything', 'def_new_thing', 'tkl_whatever', 'pts_allow_0', 'yds_allow_0_100']) {
    assert.ok(isNonPlayStat(k), `${k} should be excluded`);
  }
  for (const k of ['rec', 'rec_yd', 'rush_td', 'pass_yd', 'bonus_fd_rb', 'xpm', 'fgm']) {
    assert.ok(!isNonPlayStat(k), `${k} must still score from plays`);
  }
});

test('offensive scoring is unaffected by the exclusion', () => {
  const s = scorePlayForPlayer({ rec: 1, rec_yd: 27, rec_td: 1 }, {}, 'WR', SCORING);
  assert.equal(s.base, 0.5 + 2.7 + 6);
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
