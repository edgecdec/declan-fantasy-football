import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAGUE_MEAN_SCORE, MAX_FAAB_EDGE_POINTS, PROJECTION_PERSISTENCE, TEAM_WEEK_SD,
  TRUE_SKILL_SD, TeamState, effectiveWeekMean, observedShrinkage, simulateBracket,
  simulateSeason,
} from '@/lib/betting/seasonSim';

/**
 * Guards on the season model. Every case here corresponds to something that was
 * actually wrong at some point, not a hypothetical.
 */

const LEAGUE_MEAN = 129.3;

function team(over: Partial<TeamState> = {}): TeamState {
  return {
    rosterId: 1, ownerId: null, displayName: 't',
    wins: 0, losses: 0, ties: 0, pointsFor: 0,
    projectedWeekMean: LEAGUE_MEAN, observedWeekMean: null, weeksPlayed: 0,
    faabRemaining: 0.5,
    leagueMeanScore: LEAGUE_MEAN, leagueMeanProjection: LEAGUE_MEAN,
    currentBanked: 0, currentRemainingMean: 0, currentRemainingSd: 0,
    ...over,
  };
}

test('observedShrinkage matches the fitted variance decomposition', () => {
  for (const [n, want] of [[1, 0.035], [3, 0.098], [6, 0.179], [10, 0.267], [13, 0.321]] as const) {
    assert.ok(
      Math.abs(observedShrinkage(n) - want) < 0.005,
      `k(${n}) = ${observedShrinkage(n).toFixed(3)}, expected ~${want}`,
    );
  }
});

test('observedShrinkage is 0 with no games and rises strictly with games played', () => {
  assert.equal(observedShrinkage(0), 0);
  assert.equal(observedShrinkage(-3), 0);
  for (let n = 1; n < 40; n++) {
    assert.ok(observedShrinkage(n + 1) > observedShrinkage(n), `not increasing at n=${n}`);
  }
  // Even with a full season it must stay well under 1 — the whole finding is that most
  // of an observed edge is luck.
  assert.ok(observedShrinkage(13) < 0.4);
});

test('a preseason projection edge is shrunk to near nothing (the 29.6% bug)', () => {
  const flat = effectiveWeekMean(team());
  const strong = effectiveWeekMean(team({ projectedWeekMean: LEAGUE_MEAN + 9.8 }));
  const edge = strong - flat;
  // Previously this was taken at face value and produced a +9.8 pts/wk season edge.
  assert.ok(edge > 0, 'the projection should still tilt the estimate');
  assert.ok(edge < 0.6, `projected edge leaked through: +${edge.toFixed(2)} pts/wk`);
  assert.ok(Math.abs(edge - 9.8 * PROJECTION_PERSISTENCE) < 1e-9);
});

test('the projection is measured against the field, not the historical scoring level', () => {
  // Projections sit on a different scale from actual scores. A team projected exactly at
  // the field average must land on the field's scoring level, whatever that scale is.
  const t = team({ projectedWeekMean: 137, leagueMeanProjection: 137, leagueMeanScore: 125.4 });
  assert.ok(Math.abs(effectiveWeekMean(t) - 125.4) < 1e-9);
});

test('an observed edge is carried forward more as games accumulate', () => {
  const edgeAt = (weeks: number) =>
    effectiveWeekMean(team({ observedWeekMean: LEAGUE_MEAN + 10, weeksPlayed: weeks }))
    - effectiveWeekMean(team({ observedWeekMean: LEAGUE_MEAN, weeksPlayed: weeks }));
  const one = edgeAt(1), six = edgeAt(6), thirteen = edgeAt(13);
  assert.ok(one < 0.5, `1 week should barely move it, got ${one.toFixed(2)}`);
  assert.ok(six > one && thirteen > six, 'confidence must grow with sample size');
  assert.ok(thirteen < 4, `even a full season should not carry a +10 edge fully: ${thirteen.toFixed(2)}`);
});

test('FAAB is centred and capped at exactly the documented amount', () => {
  const full = effectiveWeekMean(team({ faabRemaining: 1 }));
  const empty = effectiveWeekMean(team({ faabRemaining: 0 }));
  const half = effectiveWeekMean(team({ faabRemaining: 0.5 }));
  assert.ok(Math.abs((full - empty) - MAX_FAAB_EDGE_POINTS) < 1e-9);
  // Half budget is the neutral point, so FAAB cannot shift the whole league's level.
  assert.ok(Math.abs(half - LEAGUE_MEAN) < 1e-9);
});

test('the fitted constants are the measured ones', () => {
  assert.equal(TEAM_WEEK_SD, 22.16);
  assert.equal(TRUE_SKILL_SD, 4.23);
  assert.equal(LEAGUE_MEAN_SCORE, 125.4);
  // Weekly noise must dwarf the real spread between teams; that relationship is the
  // reason the model refuses to be confident.
  assert.ok(TEAM_WEEK_SD / TRUE_SKILL_SD > 4);
});

test('bracket pairs seed 1 with the 4v5 winner and seed 2 with the 3v6 winner', () => {
  // Verified against all five completed seasons. A deterministic scoreOnce cannot
  // distinguish the two orientations (the strongest team wins either way), so assert on
  // the call order instead, which reveals who actually met whom.
  const seeded = [101, 102, 103, 104, 105, 106];
  const calls: number[] = [];
  simulateBracket(seeded, id => {
    calls.push(id);
    return 1000 - id; // higher seed always wins, so winners are predictable
  });
  assert.deepEqual(calls.slice(0, 2), [104, 105], 'first game should be seed 4 v seed 5');
  assert.deepEqual(calls.slice(2, 4), [103, 106], 'second game should be seed 3 v seed 6');
  assert.equal(calls[4], 101, 'seed 1 enters next');
  assert.equal(calls[5], 104, 'seed 1 must face the 4v5 winner, not the 3v6 winner');
  assert.equal(calls[6], 102, 'then seed 2');
  assert.equal(calls[7], 103, 'seed 2 must face the 3v6 winner');
});

test('bracket handles field sizes it does not expect without throwing', () => {
  const score = (id: number) => 1000 - id;
  assert.equal(simulateBracket([], score), null);
  assert.equal(simulateBracket([7], score), 7);
  assert.ok([1, 2, 3, 4].includes(simulateBracket([1, 2, 3, 4], score)!));
  assert.ok([1, 2, 3].includes(simulateBracket([1, 2, 3], score)!)); // odd size -> ladder
});

test('ten identical teams each get an equal share, and the totals close', () => {
  const teams = Array.from({ length: 10 }, (_, i) => team({ rosterId: i + 1 }));
  const pairs: [number, number][] = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]];
  const schedule = Array.from({ length: 12 }, (_, w) => ({ week: w + 2, pairs }));
  const out = simulateSeason({
    teams, remainingSchedule: schedule, currentWeekLive: false,
    currentWeekPairs: [], playoffTeams: 6, sims: 20000, seed: 42,
  });

  const titleSum = out.reduce((s, r) => s + r.titleProb, 0);
  const playoffSum = out.reduce((s, r) => s + r.playoffProb, 0);
  // Exactly one champion and exactly six qualifiers per simulation.
  assert.ok(Math.abs(titleSum - 1) < 1e-9, `title sum ${titleSum}`);
  assert.ok(Math.abs(playoffSum - 6) < 1e-9, `playoff sum ${playoffSum}`);
  for (const r of out) {
    assert.ok(r.titleProb > 0.07 && r.titleProb < 0.13, `${r.rosterId} title ${r.titleProb}`);
    assert.ok(r.playoffProb > 0.5 && r.playoffProb < 0.7, `${r.rosterId} playoff ${r.playoffProb}`);
  }
});

test('a banked win is worth about one expected win', () => {
  const mk = (wins: number) => Array.from({ length: 10 }, (_, i) =>
    team({ rosterId: i + 1, wins: i === 0 ? wins : 0 }));
  const pairs: [number, number][] = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]];
  const schedule = Array.from({ length: 12 }, (_, w) => ({ week: w + 2, pairs }));
  const run = (wins: number) => simulateSeason({
    teams: mk(wins), remainingSchedule: schedule, currentWeekLive: false,
    currentWeekPairs: [], playoffTeams: 6, sims: 20000, seed: 7,
  }).find(r => r.rosterId === 1)!;
  const delta = run(1).expectedWins - run(0).expectedWins;
  assert.ok(Math.abs(delta - 1) < 0.1, `banked win moved expected wins by ${delta.toFixed(2)}`);
});
