import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchupButtonId,
  pairSlots,
  parseMatchupButtonId,
  renderMatchupDetail,
  renderMatchupSummary,
} from '../bot/src/matchupView';
import type { MatchupResponse, MatchupSlot } from '../bot/src/siteApi';

/**
 * /matchup's scoreboard and its slot-by-slot breakdown.
 *
 * The pairing and the edge are what matter: the breakdown exists to say where a matchup is being won
 * and lost, so an edge that reads 0.0 everywhere before kickoff, or a slot paired with the wrong
 * opponent slot, would make it useless while looking fine.
 */

type H2H = Extract<MatchupResponse, { headToHead: true }>;

const slot = (over: Partial<MatchupSlot>): MatchupSlot => ({
  slot: 'RB', name: 'Somebody', position: 'RB', team: 'ATL',
  points: 0, projectedPoints: 10, expectedPoints: 10, gameState: 'pre', ...over,
});

const matchup = (over: Partial<H2H> = {}): H2H => ({
  league: { leagueId: '1383248044669046784', name: 'Test League', season: '2026' },
  week: 4,
  rosterId: 3,
  displayName: 'egruis',
  headToHead: true,
  winProbability: 0.642,
  remainingMinutes: 300,
  status: 'live',
  me: {
    rosterId: 3, displayName: 'egruis', teamName: null, banked: 40.2, projected: 118.4, playersRemaining: 3,
    lineup: [
      slot({ slot: 'QB', name: 'Josh Allen', position: 'QB', points: 22.1, projectedPoints: 24, expectedPoints: 26.5, gameState: 'in' }),
      slot({ slot: 'RB', name: 'Bijan Robinson', projectedPoints: 18, expectedPoints: 18 }),
      slot({ slot: 'FLEX', name: 'Puka Nacua', position: 'WR', points: 18.1, projectedPoints: 16, expectedPoints: 18.1, gameState: 'post' }),
    ],
    assumedPromotions: [], assumedStreams: ['K'],
  },
  opponent: {
    rosterId: 7, displayName: 'cemisme', teamName: null, banked: 31.0, projected: 104.9, playersRemaining: 5,
    lineup: [
      slot({ slot: 'QB', name: 'Lamar Jackson', position: 'QB', points: 12, projectedPoints: 25, expectedPoints: 20, gameState: 'in' }),
      slot({ slot: 'RB', name: "De'Von Achane", projectedPoints: 21, expectedPoints: 21 }),
      slot({ slot: 'FLEX', name: null, position: null, projectedPoints: 0, expectedPoints: 0, gameState: 'unknown' }),
    ],
    assumedPromotions: [], assumedStreams: [],
  },
  ...over,
});

test('the scoreboard shows both names, the score, the projection and the odds', () => {
  const e = renderMatchupSummary(matchup());
  assert.match(e.title!, /Test League — week 4/);
  assert.match(e.description!, /\*\*egruis\*\* vs \*\*cemisme\*\*/);
  assert.match(e.description!, /40\.2 – 31\.0/);
  assert.match(e.description!, /proj \*\*118\.4\*\* – \*\*104\.9\*\*/);
  assert.match(e.description!, /64\.2% – 35\.8%/);
  assert.match(e.description!, /3 v 5 left to play/);
});

test('a final matchup names the winner instead of quoting odds', () => {
  const e = renderMatchupSummary(matchup({ status: 'final', winProbability: 1 }));
  assert.match(e.description!, /\*\*egruis\*\* won/);
  assert.ok(!/%/.test(e.description!), 'no probability once it is decided');
  assert.ok(!/left to play/.test(e.description!));
});

test('slots pair by roster position and the edge is on expected points', () => {
  const p = pairSlots(matchup());
  assert.deepEqual(p.map(x => x.slot), ['QB', 'RB', 'FLEX']);
  assert.equal(p[0].mine!.name, 'Josh Allen');
  assert.equal(p[0].theirs!.name, 'Lamar Jackson');
  // 26.5 - 20.0, not the 22.1 - 12.0 banked so far.
  assert.ok(Math.abs(p[0].edge - 6.5) < 1e-9);
  // Before kickoff both RBs have scored 0, but the slot is not even.
  assert.ok(Math.abs(p[1].edge + 3) < 1e-9);
});

test('the breakdown colours each slot by who is winning it', () => {
  const d = renderMatchupDetail(matchup(), 'slot').description!;
  assert.match(d, /```diff/);
  assert.match(d, /^\+ QB\s+\+6\.5$/m);
  assert.match(d, /^- RB\s+-3\.0$/m);
  // An empty slot is said, not skipped — an empty FLEX is a real disadvantage.
  assert.match(d, /— empty —/);
  // Points then projection, and who is playing right now.
  assert.match(d, /Josh Allen\s+22\.1 \/ 24\.0 ●/);
  assert.match(d, /Puka Nacua WR\s+18\.1 \/ 16\.0 ✓/);
});

test('sorting by edge runs biggest advantage to biggest deficit', () => {
  const d = renderMatchupDetail(matchup(), 'edge').description!;
  const order = [...d.matchAll(/^[+\- ] (\S+) +[+-]?\d/gm)].map(m => m[1]);
  assert.deepEqual(order, ['FLEX', 'QB', 'RB']);
});

test('model assumptions are disclosed, so a projection can be explained', () => {
  const d = renderMatchupDetail(matchup(), 'slot').description!;
  assert.match(d, /egruis: projection assumes a K off waivers/);
});

test('button ids round-trip and stay under Discord’s 100-character cap', () => {
  const id = matchupButtonId('1383248044669046784', 12, 4, 'edge');
  assert.ok(id.length < 100);
  assert.deepEqual(parseMatchupButtonId(id), {
    leagueId: '1383248044669046784', rosterId: 12, week: 4, view: 'edge',
  });
  assert.equal(parseMatchupButtonId('ob:1:2:time:'), null);
  assert.equal(parseMatchupButtonId('mu:1:2:3:bogus'), null);
});
