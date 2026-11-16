import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bracketByes, bracketRounds, playBracket, simulateBracket, simulateSeason, type TeamState,
} from '@/lib/betting/seasonSim';
import { pctText, playoffStatus, roundNames, type PlayoffTeam, type PlayoffsResponse } from '@/lib/betting/playoffOdds';
import { columnValue, playoffColumns, playoffsImageHeight, renderPlayoffsImage } from '@/lib/betting/playoffsImage';
import { playoffsImageEmbed, renderPlayoffsText } from '../bot/src/playoffsView';

/**
 * /playoffs: the round-by-round extension of the season simulation, the proven-only clinch marks,
 * and the card and text that show them.
 *
 * The constraint that matters most is the one the brief set: the betting market prices from
 * simulateSeason, so its default output must not move. The standard bracket is opt-in, and for the
 * six-team field every betting league uses, it is checked here to crown the same champion in every
 * single simulation as the market's bracket.
 */

const MEAN = 129.3;
const team = (id: number, over: Partial<TeamState> = {}): TeamState => ({
  rosterId: id, ownerId: null, displayName: `t${id}`,
  wins: 0, losses: 0, ties: 0, pointsFor: 0,
  projectedWeekMean: MEAN, observedWeekMean: null, weeksPlayed: 0, faabRemaining: 0.5,
  leagueMeanScore: MEAN, leagueMeanProjection: MEAN,
  currentBanked: 0, currentRemainingMean: 0, currentRemainingSd: 0, ...over,
});

const ten = () => Array.from({ length: 10 }, (_, i) =>
  team(i + 1, { wins: 9 - i, losses: i, pointsFor: 1300 - i * 20, observedWeekMean: 140 - i * 2, weeksPlayed: 9 }));
const pairs: [number, number][] = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]];
const schedule = (weeks: number) => Array.from({ length: weeks }, (_, w) => ({ week: w + 11, pairs }));

test('six teams: the standard bracket crowns the same champions as the market\'s, draw for draw', () => {
  const base = { teams: ten(), remainingSchedule: schedule(3), currentWeekLive: false, currentWeekPairs: [], playoffTeams: 6, sims: 5000, seed: 99 };
  const legacy = simulateSeason(base);
  const standard = simulateSeason({ ...base, bracket: 'standard' });
  for (const l of legacy) {
    const s = standard.find(x => x.rosterId === l.rosterId)!;
    assert.equal(s.titleProb, l.titleProb, `title, roster ${l.rosterId}`);
    assert.equal(s.playoffProb, l.playoffProb);
    assert.equal(s.expectedWins, l.expectedWins);
  }
  // And the default output carries nothing new.
  assert.equal(legacy[0].roundProbs, undefined);
  assert.equal(legacy[0].byeProb, undefined);
});

test('the standard bracket plays six teams in the market\'s order: 4v5, 3v6, 1 v that, 2 v that', () => {
  const order = (fn: (score: (id: number) => number) => unknown) => {
    const calls: number[] = [];
    fn(id => { calls.push(id); return 1000 - id; });
    return calls;
  };
  const seeded = [101, 102, 103, 104, 105, 106];
  assert.deepEqual(order(s => playBracket(seeded, s)), order(s => simulateBracket(seeded, s)));
  assert.deepEqual(order(s => playBracket([1, 2, 3, 4], s)), order(s => simulateBracket([1, 2, 3, 4], s)));
});

test('round reach: everyone alive in round 1, byes skip it, the champion clears the final', () => {
  const { champion, reached } = playBracket([11, 12, 13, 14, 15, 16], id => 1000 - id); // better seed always wins
  assert.equal(champion, 11);
  assert.equal(reached.get(11), 4, 'champion: three rounds then the title');
  assert.equal(reached.get(12), 3, 'lost the final');
  assert.equal(reached.get(13), 2, 'won the quarter, lost the semi');
  assert.equal(reached.get(16), 1, 'lost the quarter');
  assert.deepEqual([bracketRounds(6), bracketByes(6)], [3, 2]);
  assert.deepEqual([bracketRounds(4), bracketByes(4)], [2, 0]);
  assert.deepEqual([bracketRounds(8), bracketByes(8)], [3, 0]);
  assert.deepEqual([bracketRounds(12), bracketByes(12)], [4, 4]);
});

test('round, bye and seed probabilities add up the way a bracket must', () => {
  for (const [field, alive] of [[6, [6, 4, 2]], [8, [8, 4, 2]], [4, [4, 2]]] as const) {
    const out = simulateSeason({
      teams: ten(), remainingSchedule: schedule(3), currentWeekLive: false, currentWeekPairs: [],
      playoffTeams: field, sims: 4000, seed: 5, bracket: 'standard',
    });
    alive.forEach((n, r) => {
      const sum = out.reduce((a, t) => a + t.roundProbs![r], 0);
      assert.ok(Math.abs(sum - n) < 1e-9, `${field}-team round ${r + 1}: ${sum} alive`);
    });
    assert.ok(Math.abs(out.reduce((a, t) => a + t.titleProb, 0) - 1) < 1e-9);
    assert.ok(Math.abs(out.reduce((a, t) => a + t.byeProb!, 0) - bracketByes(field)) < 1e-9);
    for (const t of out) {
      assert.ok(Math.abs(t.roundProbs![0] - t.playoffProb) < 1e-12, 'alive in round 1 = made the playoffs');
      for (let r = 1; r < t.roundProbs!.length; r++) assert.ok(t.roundProbs![r] <= t.roundProbs![r - 1] + 1e-12);
      assert.ok(t.titleProb <= t.roundProbs![t.roundProbs!.length - 1] + 1e-12);
      assert.ok(Math.abs(t.seedProbs!.reduce((a, b) => a + b, 0) - t.playoffProb) < 1e-9);
    }
    for (let k = 0; k < field; k++) assert.ok(Math.abs(out.reduce((a, t) => a + t.seedProbs![k], 0) - 1) < 1e-9);
  }
});

test('the median game adds about half a win a week, and only when asked for', () => {
  const run = (medianGame: boolean) => simulateSeason({
    teams: Array.from({ length: 10 }, (_, i) => team(i + 1)), remainingSchedule: schedule(4),
    currentWeekLive: false, currentWeekPairs: [], playoffTeams: 6, sims: 4000, seed: 3, bracket: 'standard', medianGame,
  });
  const extra = run(true).reduce((a, t) => a + t.expectedWins, 0) - run(false).reduce((a, t) => a + t.expectedWins, 0);
  assert.ok(Math.abs(extra - 4 * 5) < 1e-9, 'five median wins handed out per week');
});

test('a division winner is seeded ahead of a better wildcard record', () => {
  // Team 10 is the worst team but the only one in division 2, so it wins it outright.
  const divisions = new Map(Array.from({ length: 10 }, (_, i) => [i + 1, i === 9 ? 2 : 1]));
  const out = simulateSeason({
    teams: ten(), remainingSchedule: [], currentWeekLive: false, currentWeekPairs: [],
    playoffTeams: 4, sims: 200, seed: 1, bracket: 'standard', divisions,
  });
  const t10 = out.find(t => t.rosterId === 10)!;
  assert.equal(t10.playoffProb, 1);
  assert.equal(t10.seedProbs![1], 1, 'seed 2: the second division winner');
});

test('clinch marks are proofs from win bounds, never a simulated 100%', () => {
  const t = (rosterId: number, wins: number, gamesLeft: number) => ({ rosterId, wins, ties: 0, gamesLeft });
  // One game left, four spots, two byes.
  const status = playoffStatus([
    t(1, 9, 1), t(2, 8, 1), t(3, 7, 1), t(4, 7, 1), t(5, 6, 1), t(6, 3, 1), t(7, 2, 1), t(8, 2, 1), t(9, 1, 1), t(10, 0, 1),
  ], 4, 2);
  assert.equal(status.get(1), 'bye', 'only one other team can even reach nine wins');
  assert.equal(status.get(2), 'in', 'three others can reach eight: a place, but not a bye');
  assert.equal(status.get(3), null, 'four others can reach seven, and a tie goes to points for — not settled');
  assert.equal(status.get(5), null, 'two teams are surely ahead, not four: still alive');
  assert.equal(status.get(6), 'out', 'five teams already have more wins than 3-6 can reach');
  assert.equal(status.get(10), 'out');
  // Graham's after week 9, four games left: the simulation has two teams at >99.9% and one at 0.0%,
  // and not one of those is provable — nobody gets a mark.
  const grahams = [6, 6, 6, 6, 6, 4, 4, 2, 3, 2].map((w, i) => t(i + 1, w, 4));
  assert.ok([...playoffStatus(grahams, 6, 2).values()].every(v => v === null));
  // A runaway leader IS provable four weeks out, once only a few others can reach its total.
  const runaway = playoffStatus(Array.from({ length: 10 }, (_, i) => t(i + 1, 9 - i, 4)), 6, 2);
  assert.equal(runaway.get(1), 'in', '9-0: only four others can reach nine');
});

test('round names follow the bracket size', () => {
  assert.deepEqual(roundNames(6), { bye: 'BYE', semis: 'SEMIS', final: 'FINAL' });
  assert.deepEqual(roundNames(4), { bye: null, semis: 'SEMIS', final: 'FINAL' });
  assert.deepEqual(roundNames(8), { bye: null, semis: 'SEMIS', final: 'FINAL' });
  assert.equal(pctText(0.9996), '>99', 'a simulated near-certainty is not printed as one');
  assert.equal(pctText(1), '>99');
  assert.equal(pctText(0), '<1');
  assert.equal(pctText(0, 'no'), '0', 'proven out');
  assert.equal(pctText(0.6, 'yes'), '100', 'proven in');
  assert.equal(pctText(0.234), '23');
});

const pteam = (i: number, over: Partial<PlayoffTeam> = {}): PlayoffTeam => ({
  rosterId: i, name: `Manager${i}LongName`, wins: 9 - i, losses: i, ties: 0, pointsFor: 1200, projectedWins: 12 - i,
  gamesLeft: 4, playoffProb: Math.max(0, 1 - i * 0.12), byeProb: Math.max(0, 0.6 - i * 0.2), semisProb: Math.max(0, 0.8 - i * 0.1),
  finalProb: Math.max(0, 0.45 - i * 0.05), titleProb: Math.max(0, 0.23 - i * 0.025), seedProbs: [], status: null, ...over,
});

const board = (playoffTeams: number, byes: number, over: Partial<PlayoffsResponse> = {}): PlayoffsResponse => ({
  league: { leagueId: '1383248044669046784', name: "Graham's Football Fantasy", season: '2026' },
  currentWeek: 10, lastRegularWeek: 13, playoffWeekStart: 14, weeksRemaining: 4, playoffTeams, byes, sims: 20000,
  medianGame: false, divisions: false, boundsApply: true,
  teams: Array.from({ length: 10 }, (_, i) => pteam(i, i === 0 ? { status: 'bye' } : i === 9 ? { status: 'out' } : {})),
  ...over,
});

test('the card: a PNG at its computed height, with only the columns the format has', async () => {
  assert.deepEqual(playoffColumns(board(6, 2)).map(c => c.key), ['playoff', 'bye', 'semis', 'final', 'title']);
  assert.deepEqual(playoffColumns(board(8, 0)).map(c => c.key), ['playoff', 'semis', 'final', 'title']);
  for (const b of [board(6, 2), board(8, 0), board(4, 0, { medianGame: true })]) {
    const buf = Buffer.from(await renderPlayoffsImage(b).arrayBuffer());
    assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG');
    assert.equal(buf.readUInt32BE(16), 760);
    assert.equal(buf.readUInt32BE(20), playoffsImageHeight(b));
    assert.ok(buf.length > 20_000);
  }
  // Proven marks override the simulation; an eliminated team reads 0 everywhere.
  const b = board(6, 2);
  assert.deepEqual(columnValue(b.teams[0], 'bye'), { p: b.teams[0].byeProb, proven: 'yes' });
  assert.equal(columnValue(b.teams[9], 'title').proven, 'no');
  assert.equal(columnValue(b.teams[3], 'playoff').proven, null);
});

test('text fallback: same columns, proven marks only, the playoff line, a phone\'s width', () => {
  const e = renderPlayoffsText(board(6, 2));
  const lines = e.description!.split('\n');
  for (const l of lines) assert.ok(l.length <= 44, `"${l}" is too wide for a phone`);
  assert.match(lines[1], /^team\s+rec\s+PO\s+bye\s+semi\s+fin\s+ttl$/);
  assert.match(lines[2], /^Manager0Lo\^ /, 'proven bye marked');
  assert.match(lines[2], /\s100\s+100\s/, 'proven playoffs and bye print 100');
  assert.ok(lines.some(l => l.includes('playoff line')));
  assert.equal(lines.findIndex(l => l.includes('playoff line')), 2 + 6, 'after the sixth team');
  assert.match(lines[lines.length - 2], /^Manager9Lox .*\s0\s+0\s+0\s+0\s+0$/);
  assert.match(e.footer!.text, /top 6 make it, top 2 bye/);
  assert.match(e.footer!.text, /only when provable/);
  const eight = renderPlayoffsText(board(8, 0)).description!.split('\n')[1];
  assert.ok(!eight.includes('bye'), 'no bye column for an eight-team field');
  assert.deepEqual(playoffsImageEmbed(board(6, 2), 'playoffs.png').image, { url: 'attachment://playoffs.png' });
});
