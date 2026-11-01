import test from 'node:test';
import assert from 'node:assert/strict';
import { marketField, renderMarketsEmbed, scoreLine } from '../bot/src/marketsView';
import type { MarketRow, MarketsResponse } from '../bot/src/siteApi';

/**
 * /markets' board: the scoreline beside the odds.
 *
 * The cases that matter are the three states a matchup goes through — before kickoff, live, final —
 * plus the row priced before scorelines were stored, which must render exactly as the board did
 * before rather than as a fabricated 0.0 – 0.0.
 */

const market = (over: Partial<MarketRow> = {}): MarketRow => ({
  marketId: 'm1',
  matchupId: 1,
  nameA: 'edgecdec',
  nameB: 'Junebugge',
  probA: 0.61,
  priceA: -156,
  priceB: 130,
  status: 'open',
  remainingMinutes: 600,
  pointsA: 0,
  pointsB: 0,
  projectedA: 128.44,
  projectedB: 121.66,
  finalA: null,
  finalB: null,
  winner: null,
  ...over,
});

/** What a reader sees: markdown stripped. */
const visible = (s: string) => s.replace(/\*\*|`|_/g, '');

test('pre-game: projected final, meter, odds — no current score', () => {
  const f = marketField(market());
  assert.equal(f.name, 'edgecdec  vs  Junebugge');
  const lines = f.value.split('\n');
  assert.equal(lines[0], 'proj **128.4 – 121.7**');
  assert.match(lines[1], /^`[█░]{12}` {2}\*\*61%\*\*$/);
  assert.equal(lines[2], '-156 / +130');
  assert.equal(lines.length, 3);
  assert.ok(!f.value.includes('now'));
});

test('live: projected final leads, current score follows, closed tag kept', () => {
  const f = marketField(market({
    status: 'closed', remainingMinutes: 25, pointsA: 84.2, pointsB: 71, projectedA: 104.9, projectedB: 92.3,
  }));
  const lines = f.value.split('\n');
  assert.equal(lines[0], 'proj **104.9 – 92.3** · now 84.2 – 71.0');
  assert.equal(lines[2], '-156 / +130  ·  _closed_');
});

test('one side banked from Thursday counts as live even with no game on', () => {
  assert.equal(
    scoreLine(market({ pointsA: 0, pointsB: 18.6, projectedA: 128.4, projectedB: 123.1 })),
    'proj **128.4 – 123.1** · now 0.0 – 18.6',
  );
});

test('final: graded score and winner, without the meter or a -19900 line', () => {
  const f = marketField(market({
    status: 'settled', remainingMinutes: 0, probA: 0.999, priceA: -19900, priceB: 9900,
    pointsA: 131.2, pointsB: 119.8, projectedA: 131.2, projectedB: 119.8,
    finalA: 131.24, finalB: 119.8, winner: 'a',
  }));
  assert.equal(f.value, 'final **131.2 – 119.8** · edgecdec won');
  assert.ok(!f.value.includes('-19900'));
  assert.ok(!f.value.includes('█'));
});

test('final uses the graded score over the last priced one', () => {
  // A stat correction between the last tick and settlement: settlement is what was paid on.
  assert.equal(
    scoreLine(market({
      status: 'settled', remainingMinutes: 0, pointsA: 110, pointsB: 112, finalA: 113.5, finalB: 112, winner: 'a',
    })),
    'final **113.5 – 112.0** · edgecdec won',
  );
  assert.equal(
    scoreLine(market({ status: 'settled', remainingMinutes: 0, finalA: 100, finalB: 100, winner: 'push' })),
    'final **100.0 – 100.0** · push',
  );
});

test('games over but not yet settled: final score, no winner claimed', () => {
  const f = marketField(market({
    status: 'closed', remainingMinutes: 0, pointsA: 97.1, pointsB: 102.4, projectedA: 97.1, projectedB: 102.4,
  }));
  assert.equal(f.value, 'final **97.1 – 102.4**');
});

test('a row priced before scorelines were stored renders as the board always did', () => {
  const f = marketField(market({ pointsA: null, pointsB: null, projectedA: null, projectedB: null }));
  const lines = f.value.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^`[█░]{12}`/);
  assert.equal(lines[1], '-156 / +130');
  assert.ok(!f.value.includes('0.0'));
});

test('void: no scoreline, status shown', () => {
  const f = marketField(market({ status: 'void', pointsA: 50, pointsB: 40 }));
  assert.equal(scoreLine(market({ status: 'void' })), null);
  assert.ok(f.value.endsWith('_void_'));
});

test('mobile width: the scoreline stays short even with three-digit scores', () => {
  // ~40 characters is what fits a phone-width embed without wrapping.
  const line = scoreLine(market({ pointsA: 104.2, pointsB: 101, projectedA: 158.4, projectedB: 141.7 }))!;
  assert.ok(visible(line).length <= 40, `${visible(line)} is ${visible(line).length} chars`);
});

test('embed stays inside Discord limits and explains "proj"', () => {
  const data: MarketsResponse = {
    league: { leagueId: 'L', season: '2026', label: "Graham's Football Fantasy" },
    week: 9,
    markets: Array.from({ length: 30 }, (_, i) => market({
      marketId: `m${i}`, nameA: 'Coldst2EvaDoIt'.repeat(2), nameB: 'KarrasKarras'.repeat(2),
      pointsA: 104.2, pointsB: 101, projectedA: 158.4, projectedB: 141.7, status: 'closed',
    })),
  };
  const e = renderMarketsEmbed(data);
  assert.equal(e.title, "Graham's Football Fantasy — week 9");
  assert.equal(e.fields!.length, 25);
  for (const f of e.fields!) {
    assert.ok(f.name.length <= 256);
    assert.ok(f.value.length <= 1024);
  }
  const total = (e.title?.length ?? 0) + (e.footer?.text.length ?? 0)
    + e.fields!.reduce((n, f) => n + f.name.length + f.value.length, 0);
  assert.ok(total <= 6000, `embed is ${total} chars`);
  assert.match(e.footer!.text, /proj = projected final/);
});

test('a finished week does not explain a bar and odds it no longer shows', () => {
  const done = market({ status: 'settled', remainingMinutes: 0, finalA: 120, finalB: 110, winner: 'a' });
  const data: MarketsResponse = {
    league: { leagueId: 'L', season: '2026', label: 'L' }, week: 7, markets: [done, { ...done, marketId: 'm2' }],
  };
  assert.equal(renderMarketsEmbed(data).footer!.text, 'all games final');
  data.markets.push(market({ marketId: 'm3' }));
  assert.match(renderMarketsEmbed(data).footer!.text, /^proj = projected final/);
});
