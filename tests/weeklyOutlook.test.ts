import test from 'node:test';
import assert from 'node:assert/strict';
import { LeagueWeekOutlook, buildRootingRows, remainingProjection, winSensitivity } from '@/services/week/weeklyOutlook';
import { SideDistribution } from '@/services/betting/liveOdds';

const dist = (mean: number, variance: number): SideDistribution =>
  ({ mean, variance, banked: 0, remaining: mean });

function starter(playerId: string, projectedPoints: number, gameState = 'pre', remainingMinutes = 60) {
  return { playerId, position: 'WR', actualPoints: 0, projectedPoints, gameState, remainingMinutes };
}

function league(
  name: string,
  mine: SideDistribution,
  theirs: SideDistribution,
  myStarters: ReturnType<typeof starter>[],
  theirStarters: ReturnType<typeof starter>[],
  status: 'not_started' | 'live' | 'final' = 'not_started',
): LeagueWeekOutlook {
  return {
    leagueId: name, leagueName: name, league: {} as never, week: 1,
    me: { distribution: mine, starters: myStarters } as never,
    opponent: { distribution: theirs, starters: theirStarters } as never,
    winProbability: 0.5, remainingMinutes: status === 'final' ? 0 : 600, status,
  };
}

test('remaining projection is full before kickoff, zero once final, prorated live', () => {
  assert.equal(remainingProjection(starter('p', 20, 'pre', 60)), 20);
  assert.equal(remainingProjection(starter('p', 20, 'post', 0)), 0);
  assert.equal(remainingProjection(starter('p', 20, 'in', 30)), 10);
  // An unmapped player (bye, free agent, unknown team) has no upside to root for.
  assert.equal(remainingProjection(starter('p', 20, 'unknown', 0)), 0);
  // A negative projection must not create negative rooting interest.
  assert.equal(remainingProjection(starter('p', -5, 'pre', 60)), 0);
});

test('win sensitivity peaks in a level matchup and collapses in a blowout', () => {
  const level = winSensitivity(dist(120, 400), dist(120, 400));
  const lopsided = winSensitivity(dist(200, 400), dist(100, 400));
  assert.ok(level > lopsided * 10, `level ${level} vs lopsided ${lopsided}`);
  assert.ok(lopsided >= 0);
  // Degenerate variance must not produce Infinity or NaN.
  assert.equal(winSensitivity(dist(120, 0), dist(120, 0)), 0);
});

test('a player only on my side is rooted FOR, and only on theirs is rooted AGAINST', () => {
  const rows = buildRootingRows([
    league('A', dist(120, 400), dist(120, 400), [starter('mine', 15)], [starter('theirs', 15)]),
  ], null);
  const mine = rows.find(r => r.playerId === 'mine')!;
  const theirs = rows.find(r => r.playerId === 'theirs')!;
  assert.ok(mine.netSwing > 0 && mine.netLeagues === 1);
  assert.equal(mine.againstPoints, 0);
  assert.ok(theirs.netSwing < 0 && theirs.netLeagues === -1);
  assert.equal(theirs.forPoints, 0);
});

test('net +/- counts leagues on each side', () => {
  // Same player starting for me in three leagues and against me in one.
  const d = () => dist(120, 400);
  const rows = buildRootingRows([
    league('L1', d(), d(), [starter('x', 12)], []),
    league('L2', d(), d(), [starter('x', 12)], []),
    league('L3', d(), d(), [starter('x', 12)], []),
    league('L4', d(), d(), [], [starter('x', 12)]),
  ], null);
  const x = rows.find(r => r.playerId === 'x')!;
  assert.equal(x.forLeagues.length, 3);
  assert.equal(x.againstLeagues.length, 1);
  assert.equal(x.netLeagues, 2);
  assert.ok(x.netSwing > 0, 'three for and one against should net positive');
  assert.deepEqual(x.forLeagues.sort(), ['L1', 'L2', 'L3']);
  assert.deepEqual(x.againstLeagues, ['L4']);
});

test('equal exposure on both sides cancels to zero', () => {
  const d = () => dist(120, 400);
  const rows = buildRootingRows([
    league('L1', d(), d(), [starter('x', 12)], []),
    league('L2', d(), d(), [], [starter('x', 12)]),
  ], null);
  const x = rows.find(r => r.playerId === 'x')!;
  assert.equal(x.netLeagues, 0);
  assert.ok(Math.abs(x.netSwing) < 1e-9, `swing should cancel, got ${x.netSwing}`);
  assert.ok(x.forPoints > 0 && x.againstPoints > 0, 'but both exposures are still reported');
});

test('league count and swing can disagree, and both are reported', () => {
  // +2 leagues, but every one of them is already decided; against me in one coin flip.
  const blowout = () => ({ mine: dist(220, 400), theirs: dist(100, 400) });
  const b1 = blowout(), b2 = blowout();
  const rows = buildRootingRows([
    league('Blowout1', b1.mine, b1.theirs, [starter('x', 15)], []),
    league('Blowout2', b2.mine, b2.theirs, [starter('x', 15)], []),
    league('CoinFlip', dist(120, 400), dist(120, 400), [], [starter('x', 15)]),
  ], null);
  const x = rows.find(r => r.playerId === 'x')!;
  assert.equal(x.netLeagues, 1, 'two for, one against');
  assert.ok(x.netSwing < 0, 'but the only matchup in the balance wants him to fail');
});

test('a finished matchup contributes no rooting interest', () => {
  const d = () => dist(120, 400);
  const rows = buildRootingRows([
    league('Done', d(), d(), [starter('x', 20)], [starter('y', 20)], 'final'),
  ], null);
  assert.equal(rows.length, 0, 'nothing left to root for once a matchup is final');
});

test('players whose games have finished drop out even in a live matchup', () => {
  const d = () => dist(120, 400);
  const rows = buildRootingRows([
    league('Live', d(), d(), [starter('done', 20, 'post', 0), starter('yet', 8)], [], 'live'),
  ], null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].playerId, 'yet');
});

test('rows are ordered by strength of feeling, strongest first', () => {
  const d = () => dist(120, 400);
  const rows = buildRootingRows([
    league('L', d(), d(), [starter('big', 25), starter('small', 3)], [starter('villain', 18)]),
  ], null);
  const magnitudes = rows.map(r => Math.abs(r.netSwing));
  for (let i = 1; i < magnitudes.length; i++) {
    assert.ok(magnitudes[i] <= magnitudes[i - 1], 'not sorted by magnitude');
  }
  assert.equal(rows[0].playerId, 'big');
});

test('netSwing is expected WINS, so it may exceed 1.0 across many leagues', () => {
  // The units trap: per league the term is a probability, but summed across leagues it is
  // a win count. A defence started in eight of my lineups really did come out at +1.33,
  // which rendered as "+133%" until the display was corrected.
  const d = () => dist(120, 400);
  const many = Array.from({ length: 8 }, (_, i) =>
    league(`L${i}`, d(), d(), [starter('def', 11)], []));
  const rows = buildRootingRows(many, null);
  const def = rows.find(r => r.playerId === 'def')!;
  assert.equal(def.netLeagues, 8);
  assert.ok(def.netSwing > 1, `expected over 1.0 win, got ${def.netSwing.toFixed(3)}`);
  // And one league alone must stay well under a single win.
  const one = buildRootingRows([league('L', d(), d(), [starter('def', 11)], [])], null)
    .find(r => r.playerId === 'def')!;
  assert.ok(one.netSwing > 0 && one.netSwing < 1, `one league should be <1 win, got ${one.netSwing}`);
});
