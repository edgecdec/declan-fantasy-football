import test from 'node:test';
import assert from 'node:assert/strict';
import {
  liveSubLine, matchupAssetUrls, matchupImageHeight, matchupSummaryHeight, renderMatchupPng,
  renderMatchupSummaryImage, summaryStatus, topPerformers, type ImageMatchup, type ImageSlot,
} from '@/lib/betting/matchupImage';
import { sniffImageType } from '@/lib/betting/imageAssets';
import { matchupImageEmbed } from '../bot/src/matchupView';
import type { MatchupResponse } from '../bot/src/siteApi';

/**
 * /matchup's default view as a compact card: the detailed card's header, one status line, each
 * side's top performers, the biggest swing and the best bench — at about half the height.
 *
 * The status line is the part a reader takes away, so each state's wording is pinned: a lead
 * before kickoff is a projection, a lead during is on points banked, and only a final says "won".
 */

const slot = (over: Partial<ImageSlot>): ImageSlot => ({
  slot: 'WR', playerId: '1', name: 'Some Player', position: 'WR', team: 'BUF',
  points: 10, projectedPoints: 12, expectedPoints: 10, gameState: 'post', gameDetail: 'W 30-20 vs MIA', ...over,
});

/** Ten slots a side, points and projections spread so the top three are unambiguous. */
const lineup = (base: number, state: ImageSlot['gameState']): ImageSlot[] =>
  Array.from({ length: 10 }, (_, i) => slot({
    slot: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF'][i],
    playerId: String(base + i),
    name: `Player ${base + i}`,
    points: state === 'pre' ? 0 : 5 + ((i * 7) % 10) * 2,
    projectedPoints: 8 + ((i * 3) % 10),
    expectedPoints: state === 'pre' ? 8 + ((i * 3) % 10) : 5 + ((i * 7) % 10) * 2,
    gameState: state,
  }));

const matchup = (status: ImageMatchup['status']): ImageMatchup => {
  const state = status === 'not_started' ? 'pre' : status === 'final' ? 'post' : 'in';
  return {
    league: { name: "Graham's Football Fantasy" },
    week: 8,
    status,
    winProbability: 0.7,
    me: {
      displayName: 'edgecdec', teamName: 'CemIsntMe', avatar: 'abc123',
      banked: status === 'not_started' ? 0 : 136.8, projected: 145.0, playersRemaining: status === 'final' ? 0 : 1,
      lineup: lineup(100, state), bestBench: slot({ slot: 'BN', name: 'Bench Guy', playerId: '999', points: 26.1 }),
    },
    opponent: {
      displayName: 'cdalton3', teamName: null, avatar: null,
      banked: status === 'not_started' ? 0 : 130.7, projected: 131.8, playersRemaining: status === 'final' ? 0 : 1,
      lineup: lineup(200, state), bestBench: null,
    },
  };
};

test('status line: projected before kickoff, a lead with players left during, a result once final', () => {
  assert.deepEqual(summaryStatus(matchup('not_started')), { text: 'edgecdec projected to win by 13.2', side: 'me' });
  assert.deepEqual(summaryStatus(matchup('live')), { text: 'edgecdec leads by 6.1 with 2 to play', side: 'me' });
  assert.deepEqual(summaryStatus(matchup('final')), { text: 'edgecdec won by 6.1', side: 'me' });

  const behind = { ...matchup('between'), me: { ...matchup('between').me, banked: 120 } };
  assert.equal(summaryStatus(behind).text, 'cdalton3 leads by 10.7 with 2 to play');
  assert.equal(summaryStatus(behind).side, 'opponent');

  const level = { ...matchup('live'), opponent: { ...matchup('live').opponent, banked: 136.8 } };
  assert.equal(summaryStatus(level).text, 'Tied at 136.8 with 2 to play');
  assert.equal(summaryStatus(level).side, null);
  const tiedFinal = { ...matchup('final'), opponent: { ...matchup('final').opponent, banked: 136.8 } };
  assert.equal(summaryStatus(tiedFinal).text, 'Tied at 136.8');
});

test('header sub line: projected final, who is left, and what they are expected to add', () => {
  assert.equal(liveSubLine({ projected: 145, banked: 136.8, playersRemaining: 1 }), 'proj 145.0 · 1 to play (+8.2)');
  assert.equal(liveSubLine({ projected: 136.8, banked: 136.8, playersRemaining: 0 }), 'proj 136.8 · all played');
});

test('top performers: by points once played, by projection before kickoff, three a side', () => {
  const live = topPerformers(matchup('live').me, 'live');
  assert.equal(live.length, 3);
  for (let i = 1; i < live.length; i++) assert.ok(live[i - 1].points >= live[i].points);
  const pre = topPerformers(matchup('not_started').me, 'not_started');
  for (let i = 1; i < pre.length; i++) assert.ok(pre[i - 1].projectedPoints >= pre[i].projectedPoints);
  // An empty slot is never a top performer.
  const holey = { ...matchup('live').me, lineup: [slot({ name: null, playerId: null, points: 99 }), slot({ points: 1 })] };
  assert.deepEqual(topPerformers(holey, 'live').map(s => s.points), [1]);
});

test('the summary asks only for the pictures it draws: two avatars and six headshots', () => {
  const urls = matchupAssetUrls(matchup('live'), 'sum');
  const keys = Object.keys(urls);
  assert.ok(keys.includes('avatar:me') && keys.includes('avatar:opponent'));
  assert.equal(keys.filter(k => k.startsWith('player:') || k.startsWith('team:')).length, 6);
  assert.ok(Object.keys(matchupAssetUrls(matchup('live'), 'slot')).length > keys.length);
});

test('summary card: a PNG at its computed height, about half the detailed card, in every state', async () => {
  for (const status of ['not_started', 'live', 'between', 'final'] as const) {
    const m = matchup(status);
    const buf = Buffer.from(await renderMatchupSummaryImage(m).arrayBuffer());
    assert.equal(sniffImageType(buf), 'image/png');
    assert.equal(buf.readUInt32BE(16), 760);
    assert.equal(buf.readUInt32BE(20), matchupSummaryHeight(m), status);
    const ratio = matchupSummaryHeight(m) / matchupImageHeight(m);
    assert.ok(ratio < 0.62, `${status}: summary is ${(ratio * 100).toFixed(0)}% of the detailed card`);
  }
});

test('a picture that will not decode falls back to initials on the summary card too', async () => {
  const bad = { 'avatar:me': 'data:image/jpeg;base64,iVBORw0KGgo=' };
  const buf = Buffer.from(await renderMatchupPng(matchup('live'), 'sum', bad));
  assert.equal(sniffImageType(buf), 'image/png');
  assert.equal(buf.readUInt32BE(20), matchupSummaryHeight(matchup('live')));
});

test('bot frames either picture with the scoreboard title, colour and the model notes', () => {
  const m = {
    league: { leagueId: '1383248044669046784', name: "Graham's Football Fantasy", season: '2026' },
    week: 8, rosterId: 3, displayName: 'edgecdec', headToHead: true, winProbability: 0.7,
    remainingMinutes: 60, status: 'live',
    me: { rosterId: 3, displayName: 'edgecdec', teamName: null, banked: 136.8, projected: 145, playersRemaining: 1,
      lineup: [], assumedPromotions: ['Josh Allen'], assumedStreams: [] },
    opponent: { rosterId: 4, displayName: 'cdalton3', teamName: null, banked: 130.7, projected: 131.8, playersRemaining: 1,
      lineup: [], assumedPromotions: [], assumedStreams: [] },
  } as unknown as Extract<MatchupResponse, { headToHead: true }>;
  const e = matchupImageEmbed(m, 'matchup.png');
  assert.equal(e.title, "Graham's Football Fantasy — week 8");
  assert.deepEqual(e.image, { url: 'attachment://matchup.png' });
  assert.equal(e.color, 0x57f287, 'winning colour for a 70% side');
  assert.match(e.description!, /edgecdec: projection assumes Josh Allen starting/);
});
