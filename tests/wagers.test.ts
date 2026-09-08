import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Money-path guards.
 *
 * db.ts resolves its file from process.cwd() at module load, so the cwd has to be moved
 * to a scratch directory BEFORE the module is imported — hence the dynamic imports below.
 * node --test gives each file its own process, so this cannot leak into other tests.
 */
const scratch = mkdtempSync(path.join(tmpdir(), 'betting-test-'));
mkdirSync(path.join(scratch, 'data'), { recursive: true });
process.chdir(scratch);

type Mod = typeof import('@/lib/betting/wagers');
type DbMod = typeof import('@/lib/db');

let wagers: Mod;
let getDb: DbMod['getDb'];

async function load() {
  if (!wagers) {
    wagers = await import('@/lib/betting/wagers');
    ({ getDb } = await import('@/lib/db'));
  }
  return { wagers, db: getDb() };
}

function seedAccount(db: ReturnType<DbMod['getDb']>, name: string, cents: number, sleeperId: string) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO accounts (id, sleeper_user_id, username, display_name, balance_cents)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, sleeperId, name, name, cents);
  db.prepare(`INSERT INTO ledger (id, account_id, amount_cents, reason) VALUES (?, ?, ?, 'initial_grant')`)
    .run(randomUUID(), id, cents);
  return id;
}

function seedMarket(
  db: ReturnType<DbMod['getDb']>,
  opts: { week?: number; matchupId?: number; ownerA?: string; ownerB?: string; status?: string } = {},
) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO markets (id, league_id, season, week, matchup_id, roster_a, roster_b,
       owner_a, owner_b, prob_a, price_a, price_b, status, remaining_minutes)
     VALUES (?, 'L1', '2026', ?, ?, 1, 2, ?, ?, 0.5, -110, -110, ?, 600)`,
  ).run(
    id, opts.week ?? 1, opts.matchupId ?? Math.floor(Math.random() * 1e6),
    opts.ownerA ?? 'ownerA', opts.ownerB ?? 'ownerB', opts.status ?? 'open',
  );
  return id;
}

function ledgerMatchesBalances(db: ReturnType<DbMod['getDb']>) {
  const rows = db.prepare(
    `SELECT a.username, a.balance_cents AS bal,
            COALESCE((SELECT SUM(amount_cents) FROM ledger WHERE account_id = a.id), 0) AS sum
     FROM accounts a`,
  ).all() as { username: string; bal: number; sum: number }[];
  return rows.every(r => r.bal === r.sum);
}

test('a stake below the minimum is refused', async () => {
  const { wagers: w, db } = await load();
  const acct = seedAccount(db, 'min', 100_000, 'sl-min');
  const m = seedMarket(db);
  for (const bad of [0, -500, 99, 1.5]) {
    const r = w.placeWager(acct, 'sl-min', m, 'a', bad);
    assert.equal(r.ok, false, `accepted stake ${bad}`);
  }
  assert.ok(ledgerMatchesBalances(db));
});

test('you cannot bet on your own matchup, on either side', async () => {
  const { wagers: w, db } = await load();
  const acct = seedAccount(db, 'player', 100_000, 'sl-player');
  const mine = seedMarket(db, { ownerA: 'sl-player' });
  // The integrity rule: otherwise you could back your opponent and bench your starters.
  for (const side of ['a', 'b'] as const) {
    const r = w.placeWager(acct, 'sl-player', mine, side, 1000);
    assert.equal(r.ok, false);
    assert.equal((r as { status: number }).status, 403);
  }
  const asB = seedMarket(db, { ownerB: 'sl-player' });
  assert.equal(w.placeWager(acct, 'sl-player', asB, 'a', 1000).ok, false, 'also when you are side B');
  // A market you are not in is fine.
  assert.equal(w.placeWager(acct, 'sl-player', seedMarket(db), 'a', 1000).ok, true);
});

test('a closed or settled market takes no action', async () => {
  const { wagers: w, db } = await load();
  const acct = seedAccount(db, 'late', 100_000, 'sl-late');
  for (const status of ['closed', 'settled', 'void']) {
    const m = seedMarket(db, { status });
    const r = w.placeWager(acct, 'sl-late', m, 'a', 1000);
    assert.equal(r.ok, false, `accepted a bet on a ${status} market`);
  }
});

test('a positive balance may be staked in full but not beyond', async () => {
  const { wagers: w, db } = await load();
  const acct = seedAccount(db, 'rich', 5_000, 'sl-rich');
  assert.equal(w.placeWager(acct, 'sl-rich', seedMarket(db), 'a', 5_001).ok, false, 'over balance');
  assert.equal(w.placeWager(acct, 'sl-rich', seedMarket(db), 'a', 5_000).ok, true, 'exactly balance');
  const bal = (db.prepare('SELECT balance_cents b FROM accounts WHERE id=?').get(acct) as { b: number }).b;
  assert.equal(bal, 0, 'the stake leaves the balance at placement');
  assert.ok(ledgerMatchesBalances(db));
});

test('a negative balance is capped on TOTAL open stake, not per bet', async () => {
  const { wagers: w, db } = await load();
  const acct = seedAccount(db, 'under', -2_000, 'sl-under');
  const cap = 10_000;
  // Four bets of 2,500 exactly reach the cap...
  for (let i = 0; i < 4; i++) {
    assert.equal(w.placeWager(acct, 'sl-under', seedMarket(db), 'a', 2_500).ok, true, `bet ${i + 1}`);
  }
  assert.equal(w.openExposureCents(acct), cap);
  // ...and the next one, however small, must be refused.
  assert.equal(w.placeWager(acct, 'sl-under', seedMarket(db), 'a', 100).ok, false, 'cap not enforced');
  assert.ok(ledgerMatchesBalances(db));
});

test('settlement pays the winner, and a loss writes no ledger row', async () => {
  const { wagers: w, db } = await load();
  const win = seedAccount(db, 'winner', 100_000, 'sl-w');
  const lose = seedAccount(db, 'loser', 100_000, 'sl-l');
  const matchupId = 4242;
  const m = seedMarket(db, { week: 5, matchupId });
  const a = w.placeWager(win, 'sl-w', m, 'a', 10_000);
  const b = w.placeWager(lose, 'sl-l', m, 'b', 10_000);
  assert.ok(a.ok && b.ok);

  const res = w.settleFinishedMarkets('L1', '2026', 5, new Map([[matchupId, { a: 120.5, b: 99.25 }]]));
  assert.equal(res.settled, 1);

  const rows = db.prepare('SELECT status FROM wagers WHERE market_id = ?').all(m) as { status: string }[];
  assert.deepEqual(rows.map(r => r.status).sort(), ['lost', 'won']);

  // The stake already left the balance at placement, so a loss must be a status change
  // only. A second debit would charge it twice.
  const loserLedger = db.prepare(
    `SELECT COUNT(*) c FROM ledger l JOIN wagers w ON w.id = l.ref_id
     WHERE w.status = 'lost' AND l.reason <> 'wager_place'`,
  ).get() as { c: number };
  assert.equal(loserLedger.c, 0);
  assert.ok(ledgerMatchesBalances(db), 'balances must still equal the ledger');

  // Final scores are recorded so a later stat correction is auditable.
  const mk = db.prepare('SELECT winner, final_a, final_b FROM markets WHERE id=?').get(m) as
    { winner: string; final_a: number; final_b: number };
  assert.equal(mk.winner, 'a');
  assert.ok(Math.abs(mk.final_a - 120.5) < 1e-9 && Math.abs(mk.final_b - 99.25) < 1e-9);
});

test('settlement is idempotent — it cannot pay twice', async () => {
  const { wagers: w, db } = await load();
  const acct = seedAccount(db, 'twice', 100_000, 'sl-twice');
  const matchupId = 777;
  const m = seedMarket(db, { week: 9, matchupId });
  assert.ok(w.placeWager(acct, 'sl-twice', m, 'a', 5_000).ok);
  const scores = new Map([[matchupId, { a: 130, b: 100 }]]);

  const first = w.settleFinishedMarkets('L1', '2026', 9, scores);
  assert.equal(first.settled, 1);
  const after = (db.prepare('SELECT balance_cents b FROM accounts WHERE id=?').get(acct) as { b: number }).b;
  const rowsBefore = (db.prepare('SELECT COUNT(*) c FROM ledger').get() as { c: number }).c;

  for (let i = 0; i < 3; i++) {
    const again = w.settleFinishedMarkets('L1', '2026', 9, scores);
    assert.equal(again.settled, 0, 'a settled market must not re-settle');
    assert.equal(again.paid, 0);
  }
  const now = (db.prepare('SELECT balance_cents b FROM accounts WHERE id=?').get(acct) as { b: number }).b;
  assert.equal(now, after, 'balance moved on a repeat settlement');
  assert.equal((db.prepare('SELECT COUNT(*) c FROM ledger').get() as { c: number }).c, rowsBefore);
  assert.ok(ledgerMatchesBalances(db));
});

test('a tie voids and refunds the stake', async () => {
  const { wagers: w, db } = await load();
  const acct = seedAccount(db, 'push', 100_000, 'sl-push');
  const matchupId = 5150;
  const m = seedMarket(db, { week: 11, matchupId });
  assert.ok(w.placeWager(acct, 'sl-push', m, 'a', 7_000).ok);
  const res = w.settleFinishedMarkets('L1', '2026', 11, new Map([[matchupId, { a: 111.1, b: 111.1 }]]));
  assert.equal(res.paid, 7_000, 'a push returns exactly the stake');
  const row = db.prepare('SELECT status FROM wagers WHERE market_id=?').get(m) as { status: string };
  assert.equal(row.status, 'void');
  const bal = (db.prepare('SELECT balance_cents b FROM accounts WHERE id=?').get(acct) as { b: number }).b;
  assert.equal(bal, 100_000, 'a push leaves the balance where it started');
  assert.ok(ledgerMatchesBalances(db));
});

test('the client cannot influence the price it gets', async () => {
  const { wagers: w, db } = await load();
  const acct = seedAccount(db, 'forge', 100_000, 'sl-forge');
  const m = seedMarket(db);
  db.prepare('UPDATE markets SET price_a = ? WHERE id = ?').run(-250, m);
  const r = w.placeWager(acct, 'sl-forge', m, 'a', 10_000);
  assert.ok(r.ok);
  const row = db.prepare('SELECT price, to_win_cents FROM wagers WHERE id=?').get((r as { wagerId: string }).wagerId) as
    { price: number; to_win_cents: number };
  // Taken from the server's market row, and the payout derived from it.
  assert.equal(row.price, -250);
  assert.equal(row.to_win_cents, 4_000);
});
