import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '@/lib/db';
import { marketPhase, type BotMarket, type BotMarketsResponse } from '@/lib/betting/botMarkets';
import { loadMarkets } from '@/lib/betting/marketsData';
import { boardPhase, marketsImageHeight, renderMarketsImage } from '@/lib/betting/marketsImage';
import { luckImageHeight, luckScale, renderLuckImage, signedLuck } from '@/lib/betting/luckImage';
import { parseLuckSort, sortLuckTeams } from '@/lib/betting/luckSort';
import type { LuckResponse, LuckTeam } from '@/lib/betting/luckData';
import { matchupImageHeight, renderMatchupImage, type ImageMatchup, type ImageSlot } from '@/lib/betting/matchupImage';
import { CARD_W } from '@/lib/betting/imageKit';
import { marketsImageEmbed, marketsImageName } from '../bot/src/marketsView';

/**
 * The three bot pictures — /markets, /luck, /matchup — and the reads behind them.
 *
 * A broken picture fails quietly: the bot falls back to text, so nobody sees an error, only a worse
 * message. These render each card for real and check it is a PNG of the size the layout says it
 * should be, which is what catches a satori layout that collapsed (the first draft of the shared
 * card rendered its header and silently dropped every row beneath it).
 */

assert.ok(
  process.env.BETTING_DB_DIR || process.env.BETTING_DB_PATH,
  'run via npm test so the database is a scratch file',
);

/** Width and height from a PNG's IHDR chunk, after asserting it is a PNG at all. */
async function png(res: Response): Promise<{ w: number; h: number; bytes: number }> {
  assert.equal(res.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

const market = (over: Partial<BotMarket> = {}): BotMarket => ({
  marketId: 'm1', matchupId: 1, nameA: 'edgecdec', nameB: 'Junebugge',
  probA: 0.61, priceA: -156, priceB: 130, status: 'open', remainingMinutes: 600,
  pointsA: 0, pointsB: 0, projectedA: 128.4, projectedB: 121.7,
  finalA: null, finalB: null, winner: null, ...over,
});

const board = (markets: BotMarket[]): BotMarketsResponse => ({
  league: { leagueId: '1383248044669046784', season: '2026', label: "Graham's Football Fantasy" },
  week: 9,
  markets,
});

const pre = market({ marketId: 'pre' });
const live = market({ marketId: 'live', status: 'closed', remainingMinutes: 120, pointsA: 84.2, pointsB: 71, projectedA: 110.3, projectedB: 98.8 });
const settled = market({
  marketId: 'done', status: 'settled', remainingMinutes: 0, probA: 0.999,
  pointsA: 131.2, pointsB: 119.8, finalA: 131.2, finalB: 119.8, winner: 'a',
});

test('marketPhase: pre, live, final (graded or awaiting it), void', () => {
  assert.equal(marketPhase(pre), 'pre');
  assert.equal(marketPhase(live), 'live');
  assert.equal(marketPhase(market({ pointsA: 0, pointsB: 12.4 })), 'live', 'a Thursday score with no game on');
  assert.equal(marketPhase(settled), 'final');
  assert.equal(marketPhase(market({ status: 'closed', remainingMinutes: 0, pointsA: 90, pointsB: 80 })), 'final');
  assert.equal(marketPhase(market({ status: 'void', remainingMinutes: 0 })), 'void');
  assert.equal(marketPhase(market({ pointsA: null, pointsB: null })), 'pre', 'a row from before scorelines were stored');
});

test('boardPhase: any game on makes the board live; all done makes it final', () => {
  assert.deepEqual(boardPhase([pre, pre]), { text: 'NOT STARTED', tone: 'upcoming' });
  assert.deepEqual(boardPhase([pre, live, settled]), { text: 'LIVE', tone: 'live' });
  assert.deepEqual(boardPhase([settled, settled]), { text: 'FINAL', tone: 'final' });
});

test('markets picture: a PNG as tall as its rows, for pre-game, live and final boards', async () => {
  for (const ms of [[pre, market({ marketId: 'p2' })], [live, pre, settled], [settled, { ...settled, marketId: 'd2', winner: 'b' }]]) {
    const { w, h, bytes } = await png(renderMarketsImage(board(ms)));
    assert.equal(w, CARD_W);
    assert.equal(h, marketsImageHeight(ms));
    assert.ok(bytes > 10_000, `a ${bytes}-byte PNG is too small to have drawn the rows`);
  }
  // A finished row drops the bar band, so a final board is shorter than a pre-game one.
  assert.ok(marketsImageHeight([settled]) < marketsImageHeight([pre]));
});

test('markets picture: a row priced before scorelines were stored still renders', async () => {
  const legacy = market({ pointsA: null, pointsB: null, projectedA: null, projectedB: null });
  const { h } = await png(renderMarketsImage(board([legacy])));
  assert.equal(h, marketsImageHeight([legacy]));
});

test('bot frames the markets picture with a per-league attachment name', () => {
  const data = board([pre]);
  const name = marketsImageName(data);
  assert.equal(name, 'markets-1383248044669046784-w9.png');
  assert.deepEqual(marketsImageEmbed(data, name).image, { url: `attachment://${name}` });
});

const luckTeam = (name: string, actualWins: number, expectedWins: number): LuckTeam => ({
  name, teamName: `${name} FC`, actualWins, expectedWins, luck: actualWins - expectedWins, pointsFor: 1000, pointsAgainst: 1000,
});

test('luck: expected wins by default, luckiest first on request; scale floors at one win; real minus signs', () => {
  const teams = [luckTeam('a', 3, 4.2), luckTeam('b', 5, 3.33), luckTeam('c', 4, 4), luckTeam('d', 4, 3.9)];
  assert.deepEqual(sortLuckTeams(teams, 'xw').map(t => t.name), ['a', 'c', 'd', 'b']);
  assert.deepEqual(sortLuckTeams(teams, 'luck').map(t => t.name), ['b', 'd', 'c', 'a']);
  assert.equal(parseLuckSort('luck'), 'luck');
  assert.equal(parseLuckSort(null), 'xw', 'no sort param means the power ranking');
  assert.equal(parseLuckSort('nonsense'), 'xw');
  // Equal expected wins break on points scored, as the JSON route always has.
  const tied = [{ ...luckTeam('low', 3, 3), pointsFor: 900 }, { ...luckTeam('high', 3, 3), pointsFor: 1100 }];
  assert.deepEqual(sortLuckTeams(tied, 'xw').map(t => t.name), ['high', 'low']);
  assert.ok(Math.abs(luckScale(teams) - 1.67) < 1e-9);
  assert.equal(luckScale([luckTeam('x', 2, 1.9)]), 1);
  assert.equal(signedLuck(1.666), '+1.67');
  assert.equal(signedLuck(-0.25), '−0.25');
  assert.equal(signedLuck(0.001), '0.00');
});

test('luck picture: a PNG with a row per team, in either order', async () => {
  const data: LuckResponse = {
    league: { leagueId: 'L', name: "Graham's Football Fantasy", season: '2026' },
    weeksCounted: 7,
    teams: Array.from({ length: 12 }, (_, i) => luckTeam(`manager${i}`, i % 7, 3 + (i % 5) * 0.4)),
  };
  const { w, h, bytes } = await png(renderLuckImage(data));
  assert.equal(w, CARD_W);
  assert.equal(h, luckImageHeight(12));
  assert.ok(bytes > 10_000);
  // The other order is the same card reordered: same size, different picture.
  const byLuck = renderLuckImage(data, 'luck');
  const byLuckBuf = Buffer.from(await byLuck.clone().arrayBuffer());
  assert.equal((await png(byLuck)).h, h);
  const byXw = Buffer.from(await renderLuckImage(data, 'xw').arrayBuffer());
  assert.ok(!byLuckBuf.equals(byXw), 'sorting by luck changed nothing');
  // Few weeks in still renders (the subtitle changes, not the layout).
  const early = await png(renderLuckImage({ ...data, weeksCounted: 2 }));
  assert.equal(early.h, h);
});

const slot = (over: Partial<ImageSlot>): ImageSlot => ({
  slot: 'RB', name: 'Somebody', position: 'RB', team: 'ATL',
  points: 12.3, projectedPoints: 14, expectedPoints: 14, gameState: 'post', gameDetail: 'W 24-17 vs NO', ...over,
});

const matchup = (status: ImageMatchup['status']): ImageMatchup => ({
  league: { name: "Graham's Football Fantasy" },
  week: 8,
  status,
  winProbability: 0.78,
  me: {
    displayName: 'edgecdec', teamName: 'CemIsntMe', banked: 136.8, projected: 145, playersRemaining: 1,
    lineup: [slot({ slot: 'QB', position: 'QB' }), slot({ gameState: 'pre', points: 0 }), slot({ slot: 'FLEX', gameState: 'in' })],
  },
  opponent: {
    displayName: 'cdalton3', teamName: 'Bandz Emeka Dance', banked: 128, projected: 138.2, playersRemaining: 1,
    lineup: [slot({ slot: 'QB', position: 'QB' }), slot({ name: null }), slot({ slot: 'FLEX' })],
  },
});

test('matchup picture: same card system, header drops the bar once final', async () => {
  for (const status of ['live', 'not_started', 'final'] as const) {
    const { w, h, bytes } = await png(renderMatchupImage(matchup(status), 'slot'));
    assert.equal(w, CARD_W);
    assert.equal(h, matchupImageHeight(matchup(status)));
    assert.ok(bytes > 10_000);
  }
  assert.ok(matchupImageHeight(matchup('final')) < matchupImageHeight(matchup('live')));
});

test('loadMarkets: the shared read behind both markets routes', async () => {
  getDb()
    .prepare(
      `INSERT INTO markets
         (id, league_id, season, week, matchup_id, roster_a, roster_b, name_a, name_b, prob_a,
          price_a, price_b, status, remaining_minutes, points_a, points_b, projected_a, projected_b)
       VALUES ('lm-1', '1383248044669046784', '2026', 9, 1, 1, 2, 'edgecdec', 'Junebugge', 0.61,
               -156, 130, 'open', 600, 0, 0, 128.4, 121.7)`,
    )
    .run();
  const ok = await loadMarkets(new URLSearchParams({ leagueId: '1383248044669046784', week: '9' }));
  assert.equal(ok.status, 200);
  if (ok.status !== 200) return;
  assert.equal(ok.body.league.label, "Graham's Football Fantasy");
  assert.equal(ok.body.week, 9);
  assert.deepEqual(ok.body.markets.map(m => [m.marketId, m.projectedA]), [['lm-1', 128.4]]);

  const missing = await loadMarkets(new URLSearchParams({ leagueId: 'not-a-league', week: '9' }));
  assert.equal(missing.status, 404);
});
