import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bracketState, decidedResults, roundLengthText, roundName, roundWeeks, simulateBracketLive, winnersPath,
  type BracketMatch, type BracketSimInput,
} from '@/lib/betting/playoffBracket';
import { bracketCells, bracketImageHeight, matchupLine, renderBracketImage } from '@/lib/betting/bracketImage';
import type { BracketResponse, BracketTeam } from '@/lib/betting/playoffOdds';
import { renderPlayoffsText } from '../bot/src/playoffsView';

/**
 * /playoffs once the playoffs start: the live winners bracket.
 *
 * The Sleeper rules behind these were measured on real completed brackets, not assumed: round
 * length from `playoff_round_type` (20 of 20 decided matches reproduced by summed round points),
 * and re-seeding from `playoff_seed_type` (Forever League 2024 re-seeded after a seed-6 upset;
 * thirteen seed_type-0 brackets with that upset all stayed fixed).
 */

// A six-team field: rosters are named by seed (roster 1 = seed 1 … roster 6 = seed 6).
const seeds = new Map([1, 2, 3, 4, 5, 6].map(s => [s, s]));
/** Sleeper's own shape, as Forever League's bracket arrives before round one: byes waiting on "TBD". */
const sixTeam = (over: Partial<Record<number, Partial<BracketMatch>>> = {}): BracketMatch[] => [
  { r: 1, m: 1, t1: 4, t2: 5, w: null, l: null, ...over[1] },
  { r: 1, m: 2, t1: 6, t2: 3, w: null, l: null, ...over[2] },
  { r: 2, m: 3, t1: 1, t2: null, w: null, l: null, ...over[3] },
  { r: 2, m: 4, t1: 2, t2: null, w: null, l: null, ...over[4] },
  { r: 2, m: 5, t1: null, t2: null, w: null, l: null, p: 5 },
  { r: 3, m: 6, t1: null, t2: null, w: null, l: null, t1_from: { w: 3 }, t2_from: { w: 4 }, p: 1, ...over[6] },
  { r: 3, m: 7, t1: null, t2: null, w: null, l: null, t1_from: { l: 3 }, t2_from: { l: 4 }, p: 3 },
];

const input = (over: Partial<BracketSimInput>): BracketSimInput => ({
  bracket: sixTeam(), seeds, reseed: false, weeks: roundWeeks(12, 2, 3), currentWeek: 12,
  actual: new Map(), live: new Map(), means: new Map([1, 2, 3, 4, 5, 6].map(s => [s, 120])),
  sims: 4000, seed: 9, ...over,
});
const odds = (r: ReturnType<typeof simulateBracketLive>, id: number) => r.teams.find(t => t.rosterId === id)!;

test('round length: one week, a two-week final, or two weeks every round', () => {
  assert.deepEqual(roundWeeks(15, 0, 3), [[15], [16], [17]]);
  assert.deepEqual(roundWeeks(14, 1, 3), [[14], [15], [16, 17]], 'Graham\'s: a two-week final');
  assert.deepEqual(roundWeeks(12, 2, 3), [[12, 13], [14, 15], [16, 17]], 'Forever: two-week rounds');
  assert.equal(roundLengthText(2), 'two-week rounds');
  assert.equal(roundLengthText(1), 'one-week rounds, two-week final');
  assert.deepEqual([1, 2, 3].map(r => roundName(r, 3)), ['QUARTERS', 'SEMIS', 'FINAL']);
  assert.deepEqual(winnersPath(sixTeam()).map(m => m.m), [1, 2, 3, 4, 6], 'placement games are not the title path');
});

test('the probabilities close: everyone alive in a round sums to its slots, one champion', () => {
  const r = simulateBracketLive(input({}));
  for (const [round, slots] of [[2, 4], [3, 2]] as const) {
    const sum = r.teams.reduce((a, t) => a + t.reach[round - 1], 0);
    assert.ok(Math.abs(sum - slots) < 1e-9, `round ${round}: ${sum}`);
  }
  assert.ok(Math.abs(r.teams.reduce((a, t) => a + t.title, 0) - 1) < 1e-9);
  assert.equal(odds(r, 1).reach[1], 1, 'a bye is through to the semis');
  assert.deepEqual([r.rounds, r.currentRound, r.champion], [3, 1, null]);
});

test('bye opponents: a re-seeding bracket sends the top seed to the worst survivor, a fixed one does not', () => {
  // Round one done: seed 4 beat 5, seed 6 beat 3 — the upset that tells the two rules apart.
  const bracket = sixTeam({ 1: { w: 4, l: 5 }, 2: { w: 6, l: 3 } });
  // Seed 1 crushes anyone, seed 2 loses to anyone, 4 beats 6: the final shows who met whom.
  const means = new Map([[1, 1000], [2, 0], [3, 120], [4, 500], [5, 120], [6, 400]]);
  const reseed = simulateBracketLive(input({ bracket, means, reseed: true, currentWeek: 14 }));
  assert.equal(odds(reseed, 4).reach[2], 1, 're-seed: 1 v 6 and 2 v 4, so 4 reaches the final');
  assert.equal(odds(reseed, 6).reach[2], 0);
  const fixed = simulateBracketLive(input({ bracket, means, reseed: false, currentWeek: 14 }));
  assert.equal(odds(fixed, 6).reach[2], 1, 'fixed: 1 v W(4v5) and 2 v W(3v6), so 6 reaches the final');
  assert.equal(odds(fixed, 4).reach[2], 0);
});

test('a decided round is a fact: the winner is through, the loser is out', () => {
  const r = simulateBracketLive(input({ bracket: sixTeam({ 1: { w: 5, l: 4 } }) }));
  assert.equal(odds(r, 5).reach[1], 1);
  assert.equal(odds(r, 4).reach[1], 0);
  assert.equal(odds(r, 4).title, 0);
});

test('a two-week round in progress banks its first week and adds the live one', () => {
  // Week 12 is over (seed 6 put up 160 to seed 3's 60); week 13 is live and even.
  const actual = new Map([['12:6', 160], ['12:3', 60], ['12:4', 100], ['12:5', 100]]);
  const live = new Map([3, 4, 5, 6].map(id => [id, { banked: 0, remainingMean: 120, remainingSd: 22 }]));
  const r = simulateBracketLive(input({ actual, live, currentWeek: 13 }));
  assert.ok(odds(r, 6).reach[1] > 0.99, `a 100-point first-week lead is near-decisive: ${odds(r, 6).reach[1]}`);
  // Banked points carry: the same bracket from week 12, before the lead, is a coin flip.
  const fresh = simulateBracketLive(input({}));
  assert.ok(Math.abs(odds(fresh, 6).reach[1] - 0.5) < 0.04);
});

test('a one-week round with the live week nearly over follows the live score', () => {
  const live = new Map([[4, { banked: 140, remainingMean: 0, remainingSd: 0 }], [5, { banked: 90, remainingMean: 0, remainingSd: 0 }],
    [3, { banked: 100, remainingMean: 10, remainingSd: 5 }], [6, { banked: 100, remainingMean: 10, remainingSd: 5 }]]);
  const r = simulateBracketLive(input({ weeks: roundWeeks(15, 0, 3), currentWeek: 15, live }));
  assert.equal(odds(r, 4).reach[1], 1);
  assert.equal(odds(r, 5).reach[1], 0);
});

test('a two-week final adds both weeks; results report the summed round', () => {
  const weeks = roundWeeks(14, 1, 3);
  const bracket = sixTeam({ 1: { w: 4, l: 5 }, 2: { w: 3, l: 6 }, 3: { t2: 4, w: 1, l: 4 }, 4: { t2: 3, w: 2, l: 3 } });
  const actual = new Map([['14:4', 130], ['14:5', 110], ['14:3', 120], ['14:6', 100], ['15:1', 140], ['15:4', 101], ['15:2', 99], ['15:3', 98], ['16:1', 150], ['16:2', 90]]);
  const r = simulateBracketLive(input({ bracket, weeks, actual, currentWeek: 17, live: new Map([[1, { banked: 0, remainingMean: 100, remainingSd: 10 }], [2, { banked: 0, remainingMean: 100, remainingSd: 10 }]]) }));
  assert.ok(odds(r, 1).title > 0.99, 'a 60-point lead after week one of a two-week final');
  const res = decidedResults(bracket, weeks, actual);
  assert.deepEqual(res.map(x => [x.round, x.winner, x.loser, x.winnerPoints, x.loserPoints]), [
    [1, 4, 5, 130, 110], [1, 3, 6, 120, 100], [2, 1, 4, 140, 101], [2, 2, 3, 99, 98],
  ]);
});

test('a finished postseason has a champion and nothing left to play', () => {
  const done = sixTeam({ 1: { w: 4, l: 5 }, 2: { w: 3, l: 6 }, 3: { t2: 4, w: 1, l: 4 }, 4: { t2: 3, w: 2, l: 3 }, 6: { t1: 1, t2: 2, w: 2, l: 1 } });
  assert.deepEqual(bracketState(done), { rounds: 3, currentRound: 4, champion: 2 });
  assert.equal(bracketState(sixTeam()).champion, null);
});

const team = (over: Partial<BracketTeam>): BracketTeam => ({
  rosterId: 1, name: 'edgecdec', seed: 2, wins: 8, losses: 3, ties: 0, opponent: null,
  roundPoints: null, opponentPoints: null, reach: [1, 0.585], title: 0.334, ...over,
});
const board = (over: Partial<BracketResponse> = {}): BracketResponse => ({
  phase: 'bracket', league: { leagueId: '1356169593978097664', name: 'Forever League', season: '2026' },
  currentWeek: 12, playoffWeekStart: 12, rounds: 3, currentRound: 1, roundLength: 'two-week rounds', reseed: true, sims: 20000,
  columns: [{ round: 2, label: 'SEMIS' }, { round: 3, label: 'FINAL' }],
  teams: [team({}), team({ rosterId: 5, name: 'cemisme', seed: 5, opponent: 'Junebugge', roundPoints: 0, opponentPoints: 0, reach: [0.65, 0.31], title: 0.15 })],
  results: [], ...over,
});

test('the bracket card: a bye is a proven 100, a score shows once there is one', async () => {
  assert.deepEqual(bracketCells(team({})).map(c => c.text), ['100', '59', '33']);
  assert.equal(bracketCells(team({ opponent: 'X', reach: [1, 0.5] }))[0].text, '>99', 'a simulated certainty is not a bye');
  assert.equal(matchupLine(team({ opponent: 'Junebugge', roundPoints: 0, opponentPoints: 0 }), 'Quarters'), 'quarters vs Junebugge');
  assert.equal(matchupLine(team({ opponent: 'Junebugge', roundPoints: 140.2, opponentPoints: 99.5 }), 'Quarters'), 'quarters vs Junebugge · 140.2–99.5');
  for (const b of [board(), board({ results: [{ round: 1, label: 'QUARTERS', winner: 'cemisme', loser: 'Junebugge', winnerPoints: 287.4, loserPoints: 251.2 }] })]) {
    const buf = Buffer.from(await renderBracketImage(b).arrayBuffer());
    assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG');
    assert.equal(buf.readUInt32BE(20), bracketImageHeight(b));
  }
});

test('the bracket text fallback: alive teams, later rounds, results, a phone\'s width', () => {
  const e = renderPlayoffsText(board({ results: [{ round: 1, label: 'QUARTERS', winner: 'cemisme', loser: 'Junebugge', winnerPoints: 287.4, loserPoints: 251.2 }] }));
  const lines = e.description!.split('\n');
  for (const l of lines) assert.ok(l.length <= 44, `"${l}" is too wide for a phone`);
  assert.match(lines[1], /^alive\s+rec\s+semi\s+fin\s+ttl$/);
  assert.match(lines[2], /^2 edgecdec\^\s+8-3\s+100\s+59\s+33$/);
  assert.ok(lines.some(l => /^qf\s+cemisme beat Junebugge 287\.4-251\.2$/.test(l)));
  assert.equal(e.title, 'Forever League — playoffs, round 1 of 3');
  assert.match(e.footer!.text, /two-week rounds, re-seeded each round/);
});
