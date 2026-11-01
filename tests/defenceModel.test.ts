import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDefenceRow, normalizeDefenceProjection } from '@/services/stats/defenceProjection';
import { calculateProjectedPoints, scoreStatLine } from '@/services/stats/scoring';
import {
  PTS_ALLOW_BRACKETS,
  projectedBracketMoments,
} from '@/services/betting/defenseBrackets';
import {
  DEF_LEVEL_GUARD_POINTS,
  MIN_TRAILING_TEAM_GAMES,
  PRIOR_SEASON_WEIGHT_TEAM_GAMES,
  applyDefenceModel,
  buildDefenceModel,
  defenceMoments,
  defenceProjectedPoints,
  trailingActualMoments,
  type DefenceHistory,
  type DefenceStarterFields,
} from '@/services/betting/defenceModel';
import { loadDefenceHistory, parseDefenceWeek } from '@/services/betting/defenceHistory';
import { sideDistribution, starterMoments, winProbability, type StarterInput } from '@/services/betting/liveOdds';
import { bestAvailableLineup, type LineupCandidate } from '@/services/betting/bestLineup';

/**
 * Team-defence projection repair and the league-relative DEF model.
 *
 * The regression case is real: Graham's 2026 week 7, Junebugge 107.70 vs 125.04 with only DAL's
 * defence left to play (MNF), so the price is P(DAL scores 17.35+). The site quoted that at 28.51%;
 * DEFs reached 17.35 in that league's scoring 9.9% of the time in 2026. The fixture is Sleeper's
 * own data for that week, cut to the keys the league scores (tests/fixtures/def_grahams_2026w7.json),
 * so the test is hermetic. The expected model numbers were computed independently by the study's
 * Python implementation (ff-def-projections/scripts/centred.py), so this is a cross-check of two
 * implementations, not of the code against itself.
 */

type Fixture = {
  scoring: Record<string, number>;
  keys: string[];
  prior: number[][];
  current: number[][];
  projections: Record<string, Record<string, number>>;
  junebugge: { banked: number; opponent: number; defence: string };
};

// Compiled to .test-build/tests, so the source fixture is two levels up; npm test runs from the root.
const FIXTURE = 'tests/fixtures/def_grahams_2026w7.json';
const fixture: Fixture = JSON.parse(readFileSync(
  existsSync(path.resolve(__dirname, '../..', FIXTURE)) ? path.resolve(__dirname, '../..', FIXTURE) : FIXTURE,
  'utf8',
));
const unpack = (rows: number[][]) =>
  rows.map(r => Object.fromEntries(fixture.keys.map((k, i) => [k, r[i]]).filter(([, v]) => v !== 0)));
const HISTORY: DefenceHistory = { prior: unpack(fixture.prior), current: unpack(fixture.current) };
const G = fixture.scoring;
const DAL = fixture.projections.DAL;

const close = (actual: number, expected: number, tol: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} not within ${tol} of ${expected}`);

// --- The repair ------------------------------------------------------------------------------

test("Sleeper's DEF def_pr_yd is punt + kick return yards (the bug, pinned to the feed snapshot)", () => {
  for (const [team, row] of Object.entries(fixture.projections)) {
    close(row.def_pr_yd, row.pr_yd + row.def_kr_yd, 0.02, `${team} def_pr_yd identity`);
  }
});

test('repair: def_pr_yd becomes punt yards, offence keys go, st_td becomes def_st_td', () => {
  const raw = { pts_allow: 22, def_pr_yd: 136.42, pr_yd: 15.86, def_kr_yd: 120.55, pass_int_td: 0.1, st_td: 0.03, sack: 2.4 };
  const row = normalizeDefenceProjection(raw);
  assert.equal(row.def_pr_yd, 15.86);
  assert.equal(row.def_kr_yd, 120.55);
  assert.equal(row.pr_yd, undefined);
  assert.equal(row.pass_int_td, undefined);
  assert.equal(row.st_td, undefined);
  assert.equal(row.def_st_td, 0.03);
  assert.equal(row.sack, 2.4);
  assert.equal(raw.def_pr_yd, 136.42, 'the input is not mutated');
});

test('repair: return yards are scored once, not twice', () => {
  const scoring = { def_pr_yd: 0.04, pr_yd: 0.04, def_kr_yd: 0.02 };
  const raw = { pts_allow: 22, def_pr_yd: 136.42, pr_yd: 15.86, def_kr_yd: 120.55 };
  close(scoreStatLine(raw, scoring), 8.502, 0.001, 'as Sleeper publishes it');
  // 15.86 punt yards once at 0.04, 120.55 kick yards once at 0.02.
  close(calculateProjectedPoints(raw, scoring), 15.86 * 0.04 + 120.55 * 0.02, 1e-9, 'repaired');
});

test('repair: a defence is no longer charged for its own projected pick-six', () => {
  const scoring = { pass_int_td: -6, int: 2 };
  close(calculateProjectedPoints({ pts_allow: 21, int: 0.8, pass_int_td: 0.1 }, scoring), 1.6, 1e-9, 'pts');
});

test('repair leaves def_pr_yd alone once Sleeper stops sending pr_yd (i.e. fixes the feed)', () => {
  assert.equal(normalizeDefenceProjection({ pts_allow: 20, def_pr_yd: 16 }).def_pr_yd, 16);
});

test('individual returners are not team defences, even though they carry def_kr_yd', () => {
  // A real 2026 week-9 WR row: Sleeper puts def_kr_yd and pr_yd on ~300 returners.
  const wr = { def_kr_yd: 5.65, pr_yd: 16.76, pr: 1.57, rec: 4.1 };
  assert.equal(isDefenceRow(wr), false);
  const scoring = { def_kr_yd: 0.04, pr_yd: 0.04, rec: 0.5 };
  assert.equal(calculateProjectedPoints(wr, scoring), scoreStatLine(wr, scoring));
  assert.equal(isDefenceRow(DAL), true);
});

test('repair: the single bracket flag becomes probabilities, and the live correction removes exactly them', () => {
  const row = normalizeDefenceProjection(DAL);
  const total = PTS_ALLOW_BRACKETS.reduce((s, b) => s + (row[b.key] ?? 0), 0);
  close(total, 1, 1e-9, 'bracket probabilities sum');
  const bracketKeysScore = PTS_ALLOW_BRACKETS.reduce((s, b) => s + (row[b.key] ?? 0) * (G[b.key] ?? 0), 0);
  close(projectedBracketMoments(DAL, G).mean, bracketKeysScore, 1e-9, 'projected bracket');
});

// --- The model on Sleeper's real week ----------------------------------------------------------

test("model on Graham's week 7 reproduces the study's independent implementation", () => {
  const model = buildDefenceModel({ scoring: G, projections: fixture.projections, history: HISTORY })!;
  assert.ok(model);
  // Expected values from ff-def-projections/scripts/centred.py on the same Sleeper data.
  close(model.actualMean, 9.7604, 0.005, 'mu_L');
  close(model.actualSd, 5.6250, 0.005, 'sigma_L');
  close(model.slateMean, 10.2001, 0.005, 'xbar');
  const x = defenceProjectedPoints(DAL, model);
  close(x, 11.0428, 0.005, 'DAL repaired projection');
  const m = defenceMoments(x, model);
  close(m.mean, 10.5104, 0.005, 'DAL mean');
  close(Math.sqrt(m.variance), 5.4562, 0.005, 'DAL sd');
  assert.equal(model.sampleSize, HISTORY.current.length + PRIOR_SEASON_WEIGHT_TEAM_GAMES);
});

test('Junebugge week 7: 28.51% under the old shape, ~10.5% under the league-relative model', () => {
  const { banked, opponent } = fixture.junebugge;
  const final = (id: string, points: number): StarterInput => ({
    playerId: id, position: 'WR', actualPoints: points, projectedPoints: 0,
    gameState: 'post', remainingMinutes: 0,
  });
  const opponentSide = sideDistribution([final('opp', opponent)]);
  const dalCandidate: DefenceStarterFields = {
    playerId: 'DAL', position: 'DEF', gameState: 'pre', remainingMinutes: 60,
    projectedPoints: calculateProjectedPoints(DAL, G),
  };

  // BEFORE: what the site priced — the raw row scored, on the old DEF shape.
  const before = sideDistribution([
    final('rest', banked),
    { ...dalCandidate, actualPoints: 0, projectedPoints: scoreStatLine(DAL, G) },
  ]);
  close(scoreStatLine(DAL, G), 15.72, 0.01, 'raw DAL projection');
  close(winProbability(before, opponentSide), 0.2851, 0.002, 'old price');

  // AFTER: the shared candidate pricing every page uses.
  const model = buildDefenceModel({ scoring: G, projections: fixture.projections, history: HISTORY });
  const { candidate } = applyDefenceModel(dalCandidate, model, G, undefined, DAL);
  const after = sideDistribution([final('rest', banked), { ...candidate, actualPoints: 0 }]);
  const p = winProbability(after, opponentSide);
  close(p, 0.105, 0.003, 'new price');
  // Anchors: 2026 base rate of a DEF reaching 17.35 in this scoring is 9.9%; similar-projection
  // team-games 2021-26 hit 15.3%. The old 28.5% was outside both.
  assert.ok(p > 0.08 && p < 0.153);
});

test('the level guard: quiet on repaired rows, fires on a slate that sits off the league level', () => {
  const model = buildDefenceModel({ scoring: G, projections: fixture.projections, history: HISTORY })!;
  assert.equal(model.guard.fired, false, `repaired level ${model.guard.level}`);
  assert.ok(Math.abs(model.guard.level) < 1);
  // Sleeper's rows as published sit ~+4 above what DEFs actually score in this league (2026).
  assert.ok(model.guard.rawLevel > DEF_LEVEL_GUARD_POINTS, `raw level ${model.guard.rawLevel}`);
  assert.equal(model.guard.identityRows, model.guard.slateRows);

  // A feed that over-projects every defence by 3 sacks (3 pts here) trips it.
  const inflated = Object.fromEntries(
    Object.entries(fixture.projections).map(([t, r]) => [t, { ...r, sack: (r.sack ?? 0) + 3 }]),
  );
  const off = buildDefenceModel({ scoring: G, projections: inflated, history: HISTORY })!;
  assert.equal(off.guard.fired, true);
  close(off.guard.level - model.guard.level, 3 * G.sack, 1e-6, 'level shift');
  // ...and the price does not move, because the model is centred on the slate.
  close(
    defenceMoments(defenceProjectedPoints(inflated.DAL, off), off).mean,
    defenceMoments(defenceProjectedPoints(DAL, model), model).mean,
    1e-6,
    'centred mean',
  );

  // Sleeper fixing def_pr_yd on one row is noticed.
  const fixedOne = { ...fixture.projections, DAL: { ...DAL, def_pr_yd: DAL.pr_yd } };
  const changed = buildDefenceModel({ scoring: G, projections: fixedOne, history: HISTORY })!;
  assert.equal(changed.guard.identityRows, changed.guard.slateRows - 1);
});

// --- The model's mechanics -------------------------------------------------------------------

const line = (points: number) => ({ sack: points });
const SACKS = { sack: 1 };

test('trailing level: the prior season counts as three weeks, the current season row by row', () => {
  const history = {
    prior: Array.from({ length: 10 }, () => line(10)),
    current: Array.from({ length: 32 }, () => line(6)),
  };
  const m = trailingActualMoments(history, SACKS)!;
  close(m.mean, (32 * 6 + 10 * PRIOR_SEASON_WEIGHT_TEAM_GAMES) / (32 + PRIOR_SEASON_WEIGHT_TEAM_GAMES), 1e-9, 'mu');
  // Week 1: the prior season alone.
  close(trailingActualMoments({ prior: [line(4), line(8)], current: [] }, SACKS)!.mean, 6, 1e-9, 'week 1');
  close(trailingActualMoments({ prior: [line(4), line(8)], current: [] }, SACKS)!.sd, 2, 1e-9, 'week 1 sd');
});

test('model: mean = mu + 0.89 (x - xbar), sd = 0.97 sigma, whatever the projection level', () => {
  const history = { prior: [line(4), line(8)], current: [] };
  const projections = { A: { pts_allow: 20, sack: 12 }, B: { pts_allow: 20, sack: 8 }, X: { rec: 3 } };
  const model = buildDefenceModel({ scoring: SACKS, projections, history })!;
  close(model.slateMean, 10, 1e-9, 'xbar over DEF rows only');
  close(defenceMoments(12, model).mean, 6 + 0.89 * 2, 1e-9, 'A');
  close(defenceMoments(8, model).mean, 6 - 0.89 * 2, 1e-9, 'B');
  close(Math.sqrt(defenceMoments(12, model).variance), 0.97 * 2, 1e-9, 'sd');
});

test('model: unavailable without enough history or without a slate', () => {
  const short = { prior: [], current: Array.from({ length: MIN_TRAILING_TEAM_GAMES - 1 }, () => line(6)) };
  assert.equal(buildDefenceModel({ scoring: SACKS, projections: { A: { pts_allow: 20 } }, history: short }), null);
  assert.equal(buildDefenceModel({ scoring: SACKS, projections: { X: { rec: 3 } }, history: HISTORY }), null);
});

test('no model: the repaired projection is priced on the position shape, as a fallback', () => {
  const c: DefenceStarterFields = {
    playerId: 'DAL', position: 'DEF', gameState: 'pre', remainingMinutes: 60,
    projectedPoints: calculateProjectedPoints(DAL, G),
  };
  const { candidate } = applyDefenceModel(c, null, G, undefined, DAL);
  assert.equal(candidate.moments, undefined);
  assert.equal(candidate.projectedPoints, c.projectedPoints);
});

test('not a defence: untouched', () => {
  const model = buildDefenceModel({ scoring: G, projections: fixture.projections, history: HISTORY });
  const wr: DefenceStarterFields = { playerId: '1', position: 'WR', gameState: 'pre', remainingMinutes: 60, projectedPoints: 11 };
  assert.equal(applyDefenceModel(wr, model, G, undefined, { rec: 5 }).candidate, wr);
});

test('kickoff is continuous: a live 0-0 defence prices the same as one yet to kick off', () => {
  const model = buildDefenceModel({ scoring: G, projections: fixture.projections, history: HISTORY })!;
  const base = { playerId: 'DAL', position: 'DEF' as const, projectedPoints: calculateProjectedPoints(DAL, G) };
  const pre = applyDefenceModel({ ...base, gameState: 'pre', remainingMinutes: 60 }, model, G, undefined, DAL).candidate;
  // At the first snap Sleeper credits the shutout bonus (10 in this league) and nothing else.
  const live = applyDefenceModel({ ...base, gameState: 'in', remainingMinutes: 60 }, model, G, {}, DAL).candidate;
  const preSide = sideDistribution([{ ...pre, actualPoints: 0 }]);
  const liveSide = sideDistribution([{ ...live, actualPoints: G.pts_allow_0 }]);
  close(liveSide.mean, preSide.mean, 1e-6, 'mean');
  close(liveSide.variance, preSide.variance, 1e-6, 'variance');
  // And the shutout bonus is not believed.
  assert.ok(liveSide.mean < 12, `live mean ${liveSide.mean}`);
});

test('a final defence is its score: no model, no correction', () => {
  const model = buildDefenceModel({ scoring: G, projections: fixture.projections, history: HISTORY })!;
  const done = applyDefenceModel(
    { playerId: 'DAL', position: 'DEF', gameState: 'post', remainingMinutes: 0, projectedPoints: 9 },
    model, G, { pts_allow: 24 }, DAL,
  ).candidate;
  const side = sideDistribution([{ ...done, actualPoints: 7 }]);
  assert.equal(side.mean, 7);
  assert.equal(side.variance, 0);
});

test('a streamed defence tier carries the average of its options’ moments', () => {
  const def = (id: string, proj: number, mean: number): LineupCandidate => ({
    playerId: id, position: 'DEF', projectedPoints: proj, actualPoints: 0, gameState: 'pre',
    remainingMinutes: 60, moments: { mean, variance: 30 },
  });
  const pool = [def('a', 12, 10), def('b', 11, 9), def('c', 10, 8), def('d', 9, 7), def('e', 8, 6)];
  const result = bestAvailableLineup(['DEF'], [null], [], pool, new Map());
  const streamer = result.starters[0];
  assert.deepEqual(streamer.moments, { mean: 8, variance: 30 });
  assert.equal(starterMoments(10, 'DEF').mean !== 8, true, 'the shape would have priced it differently');
});

// --- The history loader ----------------------------------------------------------------------

test('history rows: played games only, numeric stats only, Sleeper totals dropped', () => {
  const lines = parseDefenceWeek([
    { stats: { gp: 1, sack: 3, pts_allow_14_20: 1, pts_ppr: 9, pos_rank_std: 4, fan_pts_allow_qb: 20 } },
    { stats: { gp: 0, sack: 0 } },
    { stats: null },
  ]);
  assert.deepEqual(lines, [{ gp: 1, sack: 3, pts_allow_14_20: 1 }]);
  assert.deepEqual(parseDefenceWeek({ error: 'x' }), []);
});

test('history: the whole prior season plus completed weeks, fetched once, failures retried', async () => {
  const calls: string[] = [];
  let fail = true;
  const fetcher = async (url: string) => {
    calls.push(url);
    if (fail && url.includes('/2030/2?')) throw new Error('boom');
    return [{ stats: { gp: 1, sack: 2 } }];
  };
  const first = await loadDefenceHistory('2031', 3, fetcher);
  assert.equal(calls.filter(u => u.includes('/2030/')).length, 18, 'prior season, 18 weeks');
  assert.deepEqual(calls.filter(u => u.includes('/2031/')).map(u => u.split('?')[0].split('/').pop()), ['1', '2']);
  assert.ok(calls.every(u => u.includes('position%5B%5D=DEF')), 'DEF rows only');
  assert.equal(first.prior.length, 17, 'the failed week is missing, not fatal');
  assert.equal(first.current.length, 2);

  fail = false;
  calls.length = 0;
  const second = await loadDefenceHistory('2031', 3, fetcher);
  assert.deepEqual(calls.map(u => u.split('?')[0].split('/').slice(-2).join('/')), ['2030/2'], 'only the failure is refetched');
  assert.equal(second.prior.length, 18);
});
