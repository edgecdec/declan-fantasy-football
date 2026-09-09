import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '@/lib/db';
import {
  breakEvenProbability,
  lineIsStale,
  positionValueCents,
  valueOpenPositions,
  valueOpenPositionsForAccounts,
  weeksWithOpenPositions,
} from '@/lib/betting/valuation';
import { priceSides } from '@/services/betting/liveOdds';
import { profitForStake } from '@/services/betting/liveOdds';

/**
 * Marking an open bet to market. The scratch database comes from run-tests.mjs.
 *
 * The assertion that matters most is the counter-intuitive one: a bet is worth LESS than its
 * stake the moment it is placed, because the price carried the vig. If someone "fixes" that by
 * valuing positions off the shaded price, both sides of a matchup start adding up to more than
 * the money on it — so the test states the property explicitly rather than leaving it to be
 * rediscovered.
 */

const ACCOUNT = 'acct-valuation-test';
let seq = 0;

function seedAccount(id = ACCOUNT, balance = 100_000) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO accounts (id, sleeper_user_id, username, display_name, balance_cents)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, `sleeper-${id}`, `user-${id}`, `User ${id}`, balance);
}

/** One market plus one open wager on it, returning the ids. */
function seedBet(opts: {
  probA: number;
  side: 'a' | 'b';
  stakeCents: number;
  price: number;
  winner?: string | null;
  pricedAt?: string;
  week?: number;
  accountId?: string;
}) {
  const db = getDb();
  seq += 1;
  const marketId = `mkt-${seq}`;
  const wagerId = `wgr-${seq}`;
  db.prepare(
    `INSERT INTO markets
       (id, league_id, season, week, matchup_id, roster_a, roster_b, owner_a, owner_b,
        name_a, name_b, prob_a, price_a, price_b, status, winner, remaining_minutes, priced_at)
     VALUES (?, 'L1', '2026', ?, ?, 1, 2, 'ua', 'ub', 'Alice', 'Bob', ?, -110, -110, ?, ?, 30, ?)`,
  ).run(
    marketId, opts.week ?? 1, seq, opts.probA,
    opts.winner ? 'settled' : 'open', opts.winner ?? null,
    opts.pricedAt ?? '2026-09-09 20:00:00',
  );
  db.prepare(
    `INSERT INTO wagers (id, account_id, market_id, side, stake_cents, price, to_win_cents, status, placed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'))`,
  ).run(wagerId, opts.accountId ?? ACCOUNT, marketId, opts.side, opts.stakeCents, opts.price,
        profitForStake(opts.stakeCents, opts.price));
  return { marketId, wagerId };
}

function clearBets() {
  const db = getDb();
  db.prepare("DELETE FROM wagers WHERE account_id LIKE 'acct-valuation%'").run();
  db.prepare("DELETE FROM markets WHERE league_id = 'L1'").run();
}

test('the pure formulas are what they claim', () => {
  // 60% chance of a $190 payout.
  assert.equal(positionValueCents(10_000, 9_000, 0.6), 11_400);
  assert.equal(positionValueCents(10_000, 9_000, 0), 0);
  assert.equal(positionValueCents(10_000, 9_000, 1), 19_000);
  // Out-of-range probabilities are clamped rather than producing a nonsense value.
  assert.equal(positionValueCents(10_000, 9_000, 1.4), 19_000);
  assert.equal(positionValueCents(10_000, 9_000, -0.2), 0);

  // $100 to win $90.91 breaks even at 52.4% — the -110 implied probability.
  assert.ok(Math.abs(breakEvenProbability(10_000, 9_091) - 0.5238) < 0.001);
  assert.equal(breakEvenProbability(0, 0), 0);
});

test('a bet is worth LESS than its stake the instant it is placed — that gap is the vig', () => {
  seedAccount();
  clearBets();
  // A true coin flip, priced with the house edge, backed for $100.
  const priced = priceSides(0.5);
  seedBet({ probA: 0.5, side: 'a', stakeCents: 10_000, price: priced.oddsA });

  const v = valueOpenPositions(ACCOUNT, 100_000);
  assert.equal(v.positions.length, 1);
  assert.ok(v.liveValueCents < 10_000, `expected under stake, got ${v.liveValueCents}`);
  assert.ok(v.unrealisedPnlCents < 0);
  // Break-even sits above the true probability by exactly the edge, which is why.
  assert.ok(v.positions[0].breakEvenProbability > v.positions[0].winProbability);
});

test('a favourite that moved your way is worth more than the stake', () => {
  seedAccount();
  clearBets();
  // Struck at -110 when it was a coin flip; the line has since moved to 90%.
  seedBet({ probA: 0.9, side: 'a', stakeCents: 10_000, price: -110 });

  const v = valueOpenPositions(ACCOUNT, 100_000);
  const p = v.positions[0];
  assert.equal(p.winProbability, 0.9);
  assert.equal(p.valueCents, Math.round(0.9 * (10_000 + p.toWinCents)));
  assert.ok(p.unrealisedCents > 0);
  assert.ok(p.winProbability > p.breakEvenProbability);
});

test('side b is valued on the complement, not on prob_a', () => {
  seedAccount();
  clearBets();
  seedBet({ probA: 0.8, side: 'b', stakeCents: 10_000, price: 250 });

  const p = valueOpenPositions(ACCOUNT, 100_000).positions[0];
  assert.ok(Math.abs(p.winProbability - 0.2) < 1e-9);
  assert.equal(p.pick, 'Bob');
  assert.equal(p.against, 'Alice');
});

test('equity is balance plus the live value of the open book', () => {
  seedAccount();
  clearBets();
  seedBet({ probA: 0.5, side: 'a', stakeCents: 10_000, price: -110 });
  seedBet({ probA: 0.7, side: 'a', stakeCents: 20_000, price: -150 });

  const v = valueOpenPositions(ACCOUNT, 55_000);
  assert.equal(v.openStakeCents, 30_000);
  assert.equal(v.liveValueCents, v.positions.reduce((s, p) => s + p.valueCents, 0));
  assert.equal(v.equityCents, 55_000 + v.liveValueCents);
  assert.equal(v.unrealisedPnlCents, v.liveValueCents - 30_000);
});

test('a decided market is valued on its result, not on its last line', () => {
  seedAccount();
  clearBets();
  // Settled in favour of a while the stale line still said a was a 30% underdog. Only happens
  // in the window before settlement runs, but in that window the answer is already known.
  const { wagerId } = seedBet({ probA: 0.3, side: 'a', stakeCents: 10_000, price: 200, winner: 'a' });
  const won = valueOpenPositions(ACCOUNT, 0).positions.find(p => p.wagerId === wagerId)!;
  assert.equal(won.winProbability, 1);
  assert.equal(won.valueCents, 10_000 + won.toWinCents);

  clearBets();
  const lost = seedBet({ probA: 0.9, side: 'a', stakeCents: 10_000, price: -110, winner: 'b' });
  const p = valueOpenPositions(ACCOUNT, 0).positions.find(x => x.wagerId === lost.wagerId)!;
  assert.equal(p.winProbability, 0);
  assert.equal(p.valueCents, 0);
});

test('a push is worth exactly the stake, because it refunds', () => {
  seedAccount();
  clearBets();
  seedBet({ probA: 0.9, side: 'a', stakeCents: 12_345, price: -110, winner: 'push' });
  const p = valueOpenPositions(ACCOUNT, 0).positions[0];
  assert.equal(p.valueCents, 12_345);
  assert.equal(p.unrealisedCents, 0);
});

test('settled wagers are excluded — this is the OPEN book only', () => {
  seedAccount();
  clearBets();
  const { wagerId } = seedBet({ probA: 0.5, side: 'a', stakeCents: 10_000, price: -110 });
  getDb().prepare("UPDATE wagers SET status = 'won' WHERE id = ?").run(wagerId);

  const v = valueOpenPositions(ACCOUNT, 42_000);
  assert.equal(v.positions.length, 0);
  assert.equal(v.liveValueCents, 0);
  // With nothing open, equity is just the balance — not a number quietly inflated by history.
  assert.equal(v.equityCents, 42_000);
  assert.equal(v.oldestPricedAt, null);
});

test('freshness reports the OLDEST line, since the total is only as fresh as its worst input', () => {
  seedAccount();
  clearBets();
  seedBet({ probA: 0.5, side: 'a', stakeCents: 10_000, price: -110, pricedAt: '2026-09-09 12:00:00' });
  seedBet({ probA: 0.5, side: 'a', stakeCents: 10_000, price: -110, pricedAt: '2026-09-09 20:00:00' });
  assert.equal(valueOpenPositions(ACCOUNT, 0).oldestPricedAt, '2026-09-09 12:00:00');
});

test('the weeks needing a re-price are the distinct league weeks with money on them', () => {
  seedAccount();
  clearBets();
  seedBet({ probA: 0.5, side: 'a', stakeCents: 10_000, price: -110, week: 3, pricedAt: '2026-09-09 12:00:00' });
  seedBet({ probA: 0.5, side: 'b', stakeCents: 10_000, price: -110, week: 3, pricedAt: '2026-09-09 09:00:00' });
  seedBet({ probA: 0.5, side: 'a', stakeCents: 10_000, price: -110, week: 4 });

  const weeks = weeksWithOpenPositions(ACCOUNT).sort((x, y) => x.week - y.week);
  assert.deepEqual(weeks.map(w => w.week), [3, 4]);
  // The oldest price in the week, so a week is re-priced if ANY of its lines is stale.
  assert.equal(weeks[0].pricedAt, '2026-09-09 09:00:00');
});

test('many accounts are valued in one pass, and identically to one at a time', () => {
  const other = 'acct-valuation-other';
  seedAccount();
  seedAccount(other, 50_000);
  clearBets();
  seedBet({ probA: 0.8, side: 'a', stakeCents: 10_000, price: -110 });
  seedBet({ probA: 0.2, side: 'a', stakeCents: 30_000, price: 300, accountId: other });

  const batch = valueOpenPositionsForAccounts([
    { id: ACCOUNT, balanceCents: 100_000 },
    { id: other, balanceCents: 50_000 },
  ]);

  // The batch path exists for the standings table; it must not be a second, subtly different
  // valuation. Compare it against the single-account path rather than against hand-computed
  // figures, so the two can never drift.
  for (const [id, balance] of [[ACCOUNT, 100_000], [other, 50_000]] as const) {
    assert.deepEqual(batch.get(id), valueOpenPositions(id, balance));
  }
  assert.equal(batch.get(other)!.openStakeCents, 30_000);
});

test('an account with nothing open is still present, worth exactly its balance', () => {
  const idle = 'acct-valuation-idle';
  seedAccount(idle, 77_000);
  clearBets();

  const batch = valueOpenPositionsForAccounts([{ id: idle, balanceCents: 77_000 }]);
  const v = batch.get(idle);
  // Omitting a bet-less account would drop them off the standings entirely rather than ranking
  // them on their balance.
  assert.ok(v);
  assert.equal(v.equityCents, 77_000);
  assert.equal(v.positions.length, 0);
});

test('valuing no accounts is empty, not a malformed IN () query', () => {
  assert.equal(valueOpenPositionsForAccounts([]).size, 0);
});

test('an unreadable price timestamp counts as stale', () => {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  assert.equal(lineIsStale(now, 45), false);
  assert.equal(lineIsStale('2020-01-01 00:00:00', 45), true);
  // Costs one pricing call rather than silently serving an unknown-age number as current.
  assert.equal(lineIsStale('not a date', 45), true);
});

test.after(() => clearBets());
