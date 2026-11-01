import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '@/lib/db';
import { readBotMarkets, type BotMarket } from '@/lib/betting/botMarkets';

/**
 * The shape `/api/bot/markets` serves. The scratch database comes from run-tests.mjs.
 *
 * What matters: the scoreline the pricing pass stored comes back on every row, a row priced before
 * that was stored comes back as nulls rather than zeros (zeros would render as a real 0.0 – 0.0
 * score), and the board stays scoped to one league.
 */

// Never let this file open data/betting.db, which holds real balances.
assert.ok(
  process.env.BETTING_DB_DIR || process.env.BETTING_DB_PATH,
  'run via npm test so the database is a scratch file',
);

let seq = 0;

function seed(opts: {
  league?: string;
  week?: number;
  probA: number;
  status?: string;
  remaining?: number;
  points?: [number, number] | null;
  projected?: [number, number] | null;
  final?: [number, number];
  winner?: string;
}) {
  seq += 1;
  const id = `bm-${seq}`;
  getDb()
    .prepare(
      `INSERT INTO markets
         (id, league_id, season, week, matchup_id, roster_a, roster_b, owner_a, owner_b,
          name_a, name_b, prob_a, price_a, price_b, status, remaining_minutes,
          points_a, points_b, projected_a, projected_b, final_a, final_b, winner)
       VALUES (?, ?, '2026', ?, ?, 1, 2, 'ua', 'ub', 'edgecdec', 'Junebugge', ?, -156, 130, ?, ?,
               ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, opts.league ?? 'L-bot', opts.week ?? 9, seq, opts.probA, opts.status ?? 'open',
      opts.remaining ?? 600,
      opts.points?.[0] ?? null, opts.points?.[1] ?? null,
      opts.projected?.[0] ?? null, opts.projected?.[1] ?? null,
      opts.final?.[0] ?? null, opts.final?.[1] ?? null, opts.winner ?? null,
    );
  return id;
}

test('the markets table carries the stored scoreline columns', () => {
  const cols = (getDb().prepare('PRAGMA table_info(markets)').all() as { name: string }[])
    .map(c => c.name);
  for (const c of ['points_a', 'points_b', 'projected_a', 'projected_b']) {
    assert.ok(cols.includes(c), `markets.${c} missing`);
  }
});

test('every row carries points, projected final and graded scores, keyed for the bot', () => {
  const pre = seed({ probA: 0.61, points: [0, 0], projected: [128.4, 121.7] });
  const live = seed({ probA: 0.55, status: 'open', remaining: 240, points: [84.2, 71], projected: [126.9, 120.3] });
  const done = seed({
    probA: 0.99, status: 'settled', remaining: 0, points: [131.2, 119.8], projected: [131.2, 119.8],
    final: [131.2, 119.8], winner: 'a',
  });

  const rows = readBotMarkets(getDb(), 'L-bot', 9);
  const byId = new Map(rows.map(r => [r.marketId, r]));

  const expectedKeys: (keyof BotMarket)[] = [
    'marketId', 'matchupId', 'nameA', 'nameB', 'probA', 'priceA', 'priceB', 'status',
    'remainingMinutes', 'pointsA', 'pointsB', 'projectedA', 'projectedB', 'finalA', 'finalB', 'winner',
  ];
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), [...expectedKeys].sort());

  assert.deepEqual(
    [byId.get(pre)!.pointsA, byId.get(pre)!.pointsB, byId.get(pre)!.projectedA, byId.get(pre)!.projectedB],
    [0, 0, 128.4, 121.7],
  );
  assert.deepEqual(
    [byId.get(live)!.pointsA, byId.get(live)!.pointsB, byId.get(live)!.projectedA],
    [84.2, 71, 126.9],
  );
  const d = byId.get(done)!;
  assert.deepEqual([d.status, d.finalA, d.finalB, d.winner], ['settled', 131.2, 119.8, 'a']);
  assert.equal(d.nameA, 'edgecdec');
  assert.equal(d.priceA, -156);
});

test('a row priced before scorelines were stored reads as null, not 0', () => {
  const old = seed({ league: 'L-legacy', probA: 0.5, points: null, projected: null });
  const [r] = readBotMarkets(getDb(), 'L-legacy', 9);
  assert.equal(r.marketId, old);
  assert.equal(r.pointsA, null);
  assert.equal(r.projectedB, null);
});

test('scoped to one league and week, closest matchup first', () => {
  seed({ league: 'L-order', probA: 0.9, projected: [140, 100] });
  const close = seed({ league: 'L-order', probA: 0.48, projected: [120, 121] });
  seed({ league: 'L-order', probA: 0.2, projected: [100, 130] });
  seed({ league: 'L-order', week: 8, probA: 0.5, projected: [1, 1] });
  seed({ league: 'L-other', probA: 0.5, projected: [1, 1] });

  const rows = readBotMarkets(getDb(), 'L-order', 9);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].marketId, close);
  assert.deepEqual(rows.map(r => r.probA), [0.48, 0.2, 0.9]);
});
