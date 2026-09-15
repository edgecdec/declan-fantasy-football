import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The all-play arithmetic, and the mid-season bug it hid.
 *
 * Sleeper returns a full set of matchups for the WHOLE season from day one, with `points: 0` on every
 * future week. The service filtered on `points !== null`, which passes for all of them, so every
 * unplayed week was counted: each team ties everyone at 0, `points === points` scores half a win
 * against each opponent, and the week hands out exactly 0.5 expected wins to every team plus an
 * opportunity. Measured on a real league in week 2: 12 phantom weeks, +6.0 expected wins each.
 *
 * The scoring loop itself is not exported, so this reproduces it exactly rather than importing it —
 * the point is to pin the ARITHMETIC that made a zero-scored week look like a tie for everyone.
 */
function allPlayWins(scores: number[], index: number): number {
  let wins = 0;
  for (let i = 0; i < scores.length; i++) {
    if (i === index) continue;
    if (scores[index] > scores[i]) wins += 1;
    if (scores[index] === scores[i]) wins += 0.5;
  }
  return wins / (scores.length - 1);
}

test('an unplayed week gives EVERY team half a win, which is why it had to be excluded', () => {
  const unplayed = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < unplayed.length; i++) {
    assert.equal(allPlayWins(unplayed, i), 0.5, `team ${i}`);
  }
  // Twelve such weeks is six expected wins from nothing at all.
  assert.equal(12 * 0.5, 6);
});

test('a played week distributes wins by score', () => {
  const scores = [150, 120, 100, 90, 80];
  // Top score beats everyone; bottom beats nobody.
  assert.equal(allPlayWins(scores, 0), 1);
  assert.equal(allPlayWins(scores, 4), 0);
  // The middle team beats the two below it, out of four opponents.
  assert.equal(allPlayWins(scores, 2), 0.5);
});

test('a genuine tie is still worth half a win', () => {
  // The rule itself is right — it was only ever wrong when applied to a week nobody played.
  assert.equal(allPlayWins([100, 100], 0), 0.5);
  assert.equal(allPlayWins([120, 100, 100], 1), 0.25);
});

test('the week total is what separates unplayed from played', () => {
  // The guard the fix adds, and why it is safe: a real week always has points on the board.
  const total = (s: number[]) => s.reduce((a, b) => a + b, 0);
  assert.equal(total([0, 0, 0, 0]) > 0, false);
  assert.equal(total([150, 120, 0, 90]) > 0, true);
  // A single team on a bye scoring nothing does not make the week unplayed.
  assert.equal(total([0, 110]) > 0, true);
});

test('expected wins over N played weeks cannot exceed N', () => {
  // The invariant the phantom weeks broke: after one real week, nobody can have six expected wins.
  const weeks = [[150, 120, 100], [90, 140, 130]];
  for (let team = 0; team < 3; team++) {
    const ew = weeks.reduce((sum, w) => sum + allPlayWins(w, team), 0);
    assert.ok(ew <= weeks.length, `team ${team} had ${ew} from ${weeks.length} weeks`);
    assert.ok(ew >= 0);
  }
});
