import test from 'node:test';
import assert from 'node:assert/strict';
import { bestAvailableLineup, type LineupCandidate } from '@/services/betting/bestLineup';

/**
 * Fielding the lineup a manager will actually field.
 *
 * Two things here are easy to get confidently wrong, and both did happen:
 *
 *  - Waivers used to be consulted ONLY for a slot no rostered player could fill, and only at K
 *    or DEF. That made a real, obvious upgrade invisible: a manager starting a projected-4 tight
 *    end with eight better ones unrostered was priced as though he would not notice.
 *  - Assuming the upgrade always happens is the opposite error. The pool is shared and the
 *    projections are noisy, so an unguarded version has every team streaming the same defence
 *    and lifts all of them at once.
 *
 * So the behaviour under test is a THRESHOLD, not a switch, plus the contention accounting that
 * stops one waiver player being awarded to ten teams.
 */

const SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN'];

function player(
  playerId: string,
  position: string,
  projectedPoints: number,
  overrides: Partial<LineupCandidate> = {},
): LineupCandidate {
  return {
    playerId,
    position,
    projectedPoints,
    actualPoints: 0,
    gameState: 'pre',
    remainingMinutes: 60,
    ...overrides,
  };
}

/** Five options at a position, so a stream window is full rather than truncated. */
function tier(position: string, top: number): LineupCandidate[] {
  return [0, 1, 2, 3, 4].map(i => player(`fa-${position}-${i}`, position, top - i * 0.5));
}

const FREE_AGENTS = [
  ...tier('QB', 18),
  ...tier('RB', 9),
  ...tier('WR', 10),
  ...tier('TE', 8.3),
  ...tier('K', 8),
  ...tier('DEF', 8.5),
];

/** A full, competent lineup: nothing here should tempt the waiver wire. */
function solidStarters(): (LineupCandidate | null)[] {
  return [
    player('qb', 'QB', 22),
    player('rb', 'RB', 15),
    player('wr', 'WR', 16),
    player('te', 'TE', 12),
    player('flex', 'WR', 13),
    player('k', 'K', 9),
    player('def', 'DEF', 11),
  ];
}

test('a slot no rostered player can fill is streamed from waivers', () => {
  const starters = solidStarters();
  starters[5] = null; // no kicker rostered at all

  const result = bestAvailableLineup(SLOTS, starters, [], FREE_AGENTS);

  assert.equal(result.unfilledSlots.length, 0);
  const streamedK = result.streamed.find(s => s.slot === 'K');
  assert.ok(streamedK, 'the empty kicker slot should be streamed');
  // Mean of 8.0, 7.5, 7.0, 6.5, 6.0.
  assert.equal(streamedK.projectedPoints, 7);
  assert.ok(streamedK.spread > 0, 'not knowing which kicker is real extra uncertainty');
});

test('a competently filled lineup is left alone — no slot is streamed', () => {
  const result = bestAvailableLineup(SLOTS, solidStarters(), [], FREE_AGENTS);

  assert.deepEqual(result.streamed, []);
  assert.deepEqual(result.unfilledSlots, []);
  assert.equal(result.starters.length, 7);
});

test('a marginal waiver edge is ignored, because it is inside the projection noise', () => {
  const starters = solidStarters();
  // Tier mean for TE is 7.3; a 6.0 tight end is worse, but only by 1.3.
  starters[3] = player('te', 'TE', 6);

  const result = bestAvailableLineup(SLOTS, starters, [], FREE_AGENTS);

  assert.deepEqual(result.streamed, [], 'a sub-threshold gain must not trigger a pickup');
  assert.ok(result.starters.some(p => p.playerId === 'te'));
});

test('a clear upgrade IS taken, at a position that is not K or DEF', () => {
  const starters = solidStarters();
  // The real case: one rostered tight end projected 4.0 with better ones unrostered.
  starters[3] = player('sadiq', 'TE', 4);

  const result = bestAvailableLineup(SLOTS, starters, [], FREE_AGENTS);

  const streamedTe = result.streamed.find(s => s.slot === 'TE');
  assert.ok(streamedTe, 'a tight end should be streamable, not just a kicker or defence');
  assert.equal(streamedTe.projectedPoints, 7.3);
  assert.ok(
    !result.starters.some(p => p.playerId === 'sadiq'),
    'the man he replaces should not also be starting',
  );
  assert.ok(result.demoted.some(p => p.playerId === 'sadiq'));
});

test('a player displaced by a streamer can still fill another slot he is eligible for', () => {
  /*
   * Losing your slot to a pickup must not remove you from the roster. Isolating that needs a
   * pool the flex slot cannot also raid: normally a flex tier is a SUPERSET of the tight-end
   * tier, so anyone worth upgrading away at TE is worth upgrading away at FLEX too. Here the
   * board holds exactly one tight end and no other flex-eligible body, so the single pickup
   * fills TE and the FLEX slot has to fall back to the man it displaced.
   */
  const thinBoard = [player('fa-te', 'TE', 8.3), ...tier('K', 8), ...tier('DEF', 8.5)];
  const starters = solidStarters();
  starters[3] = player('sadiq', 'TE', 4);
  starters[4] = null;

  const result = bestAvailableLineup(SLOTS, starters, [], thinBoard);

  assert.deepEqual(result.streamed.map(s => s.slot), ['TE']);
  assert.ok(
    result.starters.some(p => p.playerId === 'sadiq'),
    'losing the TE slot should not remove him from the roster entirely',
  );
  assert.deepEqual(result.unfilledSlots, [], 'the FLEX slot is covered by the displaced player');
});

test('the roster beats waivers whenever it can, even when only just', () => {
  const starters = solidStarters();
  starters[3] = null;
  // On the bench and better than the tier mean of 7.3 — so he plays, no pickup.
  const bench = [player('benched-te', 'TE', 11)];

  const result = bestAvailableLineup(SLOTS, starters, bench, FREE_AGENTS);

  assert.deepEqual(result.streamed, []);
  assert.ok(result.promoted.some(p => p.playerId === 'benched-te'));
});

test('a player whose game has kicked off is never displaced by a waiver upgrade', () => {
  const starters = solidStarters();
  starters[3] = player('playing', 'TE', 4, { gameState: 'in', remainingMinutes: 30 });

  const result = bestAvailableLineup(SLOTS, starters, [], FREE_AGENTS);

  assert.deepEqual(result.streamed, [], 'a locked slot cannot be streamed');
  assert.ok(result.starters.some(p => p.playerId === 'playing'));
});

test('two teams needing the same position do not both get the top of the board', () => {
  const shared = new Map<string, number>();
  const needsTe = () => {
    const s = solidStarters();
    s[3] = null;
    return s;
  };

  const first = bestAvailableLineup(SLOTS, needsTe(), [], FREE_AGENTS, shared);
  const second = bestAvailableLineup(SLOTS, needsTe(), [], FREE_AGENTS, shared);

  const a = first.streamed.find(s => s.slot === 'TE');
  const b = second.streamed.find(s => s.slot === 'TE');
  assert.ok(a && b);
  assert.ok(
    b.projectedPoints < a.projectedPoints,
    'the second streamer must average a tier further down the board',
  );
  assert.ok(
    !b.options.some(o => o.playerId === a.options[0].playerId),
    'the best option cannot be awarded to both teams',
  );
});

test('streaming a multi-position slot depletes every position it could have drawn from', () => {
  const shared = new Map<string, number>();
  const flexOpen = () => {
    const s = solidStarters();
    s[4] = null;
    return s;
  };
  bestAvailableLineup(SLOTS, flexOpen(), [], FREE_AGENTS, shared);

  // FLEX is RB/WR/TE, so all three advance — never awarding the same body twice.
  assert.equal(shared.get('RB'), 1);
  assert.equal(shared.get('WR'), 1);
  assert.equal(shared.get('TE'), 1);
  assert.equal(shared.get('QB') ?? 0, 0);
});

test('a slot with nothing available anywhere is reported unfilled, not silently zero', () => {
  const starters = solidStarters();
  starters[6] = null;
  const noDefences = FREE_AGENTS.filter(p => p.position !== 'DEF');

  const result = bestAvailableLineup(SLOTS, starters, [], noDefences);

  assert.deepEqual(result.unfilledSlots, ['DEF']);
  assert.deepEqual(result.streamed, []);
});
