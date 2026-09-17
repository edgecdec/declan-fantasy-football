import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bestAvailableLineup,
  priceWithStreamContention,
  type LineupCandidate,
} from '@/services/betting/bestLineup';

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

/**
 * A deep waiver board at one position.
 *
 * Twelve rather than five on purpose: contention WIDENS the averaging window, so a board only
 * STREAM_POOL_SIZE deep would give an identical mean at every level of demand and quietly make
 * the contention tests vacuous. It did exactly that on the first attempt.
 */
function tier(position: string, top: number): LineupCandidate[] {
  return Array.from({ length: 12 }, (_, i) =>
    player(`fa-${position}-${i}`, position, top - i * 0.5),
  );
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

test('contention thins the tier, and thins it equally for everyone in it', () => {
  const needsTe = () => {
    const s = solidStarters();
    s[3] = null;
    return s;
  };
  const tierWith = (rivals: number) => {
    const demand = new Map([['TE', rivals]]);
    const r = bestAvailableLineup(SLOTS, needsTe(), [], FREE_AGENTS, demand);
    return r.streamed.find(s => s.slot === 'TE')!.projectedPoints;
  };

  assert.ok(tierWith(4) < tierWith(1), 'four teams chasing a tight end must each get less');
  assert.equal(tierWith(4), tierWith(4), 'and all four get the SAME number');
});

test('a side is priced identically wherever it sits in the league', () => {
  /*
   * The bug this pins: contention used to be a running counter mutated as sides were priced, so
   * a team's projection depended on the order Sleeper returned the matchups, and side A of every
   * pair beat side B. The demand map is now read-only, so position in the list cannot matter.
   */
  const needsTe = () => {
    const s = solidStarters();
    s[3] = null;
    return s;
  };
  const demand = new Map([['TE', 3]]);
  const runs = [0, 1, 2].map(
    () => bestAvailableLineup(SLOTS, needsTe(), [], FREE_AGENTS, demand)
      .streamed.find(s => s.slot === 'TE')!.projectedPoints,
  );

  assert.deepEqual(runs, [runs[0], runs[0], runs[0]]);
  assert.equal(demand.get('TE'), 3, 'the demand map must not be mutated');
});

test('priceWithStreamContention settles on a demand count and applies it to everyone', () => {
  const needsDef = () => {
    const s = solidStarters();
    s[6] = null;
    return s;
  };
  const sides = [0, 1, 2, 3];

  const results = priceWithStreamContention(demand =>
    sides.map(() => bestAvailableLineup(SLOTS, needsDef(), [], FREE_AGENTS, demand)),
  );

  const values = results.map(r => r.streamed.find(s => s.slot === 'DEF')!.projectedPoints);
  assert.equal(new Set(values).size, 1, 'four teams streaming a defence all get one value');

  const solo = priceWithStreamContention(demand =>
    [0].map(() => bestAvailableLineup(SLOTS, needsDef(), [], FREE_AGENTS, demand)),
  )[0].streamed.find(s => s.slot === 'DEF')!.projectedPoints;
  assert.ok(values[0] < solo, 'and less than a team streaming uncontested');
});

test('an upgrade records the player it replaces; filling an empty slot does not', () => {
  const upgraded = solidStarters();
  upgraded[3] = player('sadiq', 'TE', 4);
  const up = bestAvailableLineup(SLOTS, upgraded, [], FREE_AGENTS)
    .streamed.find(s => s.slot === 'TE');
  assert.equal(up?.replaces?.playerId, 'sadiq');
  assert.equal(up?.replaces?.projectedPoints, 4);

  const empty = solidStarters();
  empty[5] = null;
  const fill = bestAvailableLineup(SLOTS, empty, [], FREE_AGENTS)
    .streamed.find(s => s.slot === 'K');
  assert.equal(fill?.replaces, undefined, 'an empty slot replaces nobody');
});

test('a slot with nothing available anywhere is reported unfilled, not silently zero', () => {
  const starters = solidStarters();
  starters[6] = null;
  const noDefences = FREE_AGENTS.filter(p => p.position !== 'DEF');

  const result = bestAvailableLineup(SLOTS, starters, [], noDefences);

  assert.deepEqual(result.unfilledSlots, ['DEF']);
  assert.deepEqual(result.streamed, []);
});
