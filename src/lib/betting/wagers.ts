import { randomUUID } from 'crypto';
import { getDb } from '@/lib/db';
import { NEGATIVE_OPEN_EXPOSURE_CAP_CENTS } from '@/lib/betting/constants';
import { profitForStake } from '@/services/betting/liveOdds';

/** Smallest wager, so the ledger doesn't fill with penny bets. */
export const MIN_STAKE_CENTS = 100; // $1

export type MarketRow = {
  id: string;
  league_id: string;
  season: string;
  week: number;
  matchup_id: number;
  roster_a: number;
  roster_b: number;
  owner_a: string | null;
  owner_b: string | null;
  prob_a: number;
  price_a: number;
  price_b: number;
  status: string;
  winner: string | null;
  remaining_minutes: number;
};

export type WagerRow = {
  id: string;
  account_id: string;
  market_id: string;
  side: string;
  stake_cents: number;
  price: number;
  to_win_cents: number;
  status: string;
  placed_at: string;
  settled_at: string | null;
};

export type PlaceResult =
  | { ok: true; wagerId: string; balanceCents: number; toWinCents: number }
  | { ok: false; error: string; status: number };

/** Total stake on wagers that have not settled yet. */
export function openExposureCents(accountId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(stake_cents), 0) AS total
       FROM wagers WHERE account_id = ? AND status = 'open'`,
    )
    .get(accountId) as { total: number };
  return row.total;
}

/**
 * Places a wager.
 *
 * Every check happens inside one transaction alongside the ledger write, so two
 * simultaneous requests cannot both pass a balance check and overdraw. better-sqlite3
 * is synchronous, which makes the transaction genuinely serialising.
 */
export function placeWager(
  accountId: string,
  sleeperUserId: string | null,
  marketId: string,
  side: 'a' | 'b',
  stakeCents: number,
): PlaceResult {
  const db = getDb();

  if (!Number.isInteger(stakeCents) || stakeCents < MIN_STAKE_CENTS) {
    return { ok: false, error: `Minimum wager is ${MIN_STAKE_CENTS} cents.`, status: 400 };
  }

  const run = db.transaction((): PlaceResult => {
    const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(marketId) as
      | MarketRow
      | undefined;
    if (!market) return { ok: false, error: 'No such market.', status: 404 };

    if (market.status !== 'open') {
      return {
        ok: false,
        error:
          market.status === 'closed'
            ? 'This market is closed — under 30 minutes of game action remain.'
            : 'This market is no longer taking action.',
        status: 409,
      };
    }

    // You cannot bet on a matchup you are playing in. This is the integrity rule:
    // otherwise you could back your opponent and then bench your own starters for a
    // guaranteed win. Refusing the bet removes the incentive entirely rather than
    // trying to detect tanking after the fact.
    if (sleeperUserId && (market.owner_a === sleeperUserId || market.owner_b === sleeperUserId)) {
      return {
        ok: false,
        error: 'You cannot bet on your own matchup.',
        status: 403,
      };
    }

    const account = db
      .prepare('SELECT id, balance_cents FROM accounts WHERE id = ?')
      .get(accountId) as { id: string; balance_cents: number } | undefined;
    if (!account) return { ok: false, error: 'Account not found.', status: 401 };

    const openStake = (
      db
        .prepare(
          `SELECT COALESCE(SUM(stake_cents), 0) AS total
           FROM wagers WHERE account_id = ? AND status = 'open'`,
        )
        .get(accountId) as { total: number }
    ).total;

    if (account.balance_cents < 0) {
      // Under water: capped on TOTAL unsettled stake, not per bet, so someone deep
      // in the hole can't stack the cap across every matchup in a week.
      const remaining = NEGATIVE_OPEN_EXPOSURE_CAP_CENTS - openStake;
      if (stakeCents > remaining) {
        return {
          ok: false,
          error:
            remaining <= 0
              ? `Your balance is negative, so you may have at most ${NEGATIVE_OPEN_EXPOSURE_CAP_CENTS} cents in open wagers. You are at your limit.`
              : `Your balance is negative, so open wagers are capped at ${NEGATIVE_OPEN_EXPOSURE_CAP_CENTS} cents total. You have ${remaining} left.`,
          status: 400,
        };
      }
    } else if (stakeCents > account.balance_cents) {
      return { ok: false, error: 'Stake exceeds your balance.', status: 400 };
    }

    const price = side === 'a' ? market.price_a : market.price_b;
    const toWin = profitForStake(stakeCents, price);
    const wagerId = randomUUID();

    db.prepare(
      `INSERT INTO wagers (id, account_id, market_id, side, stake_cents, price, to_win_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(wagerId, accountId, marketId, side, stakeCents, price, toWin);

    // The stake leaves the balance now; a win returns stake + profit at settlement.
    db.prepare(
      `INSERT INTO ledger (id, account_id, amount_cents, reason, ref_id)
       VALUES (?, ?, ?, 'wager_place', ?)`,
    ).run(randomUUID(), accountId, -stakeCents, wagerId);
    db.prepare('UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?').run(
      stakeCents,
      accountId,
    );

    const after = (
      db.prepare('SELECT balance_cents FROM accounts WHERE id = ?').get(accountId) as {
        balance_cents: number;
      }
    ).balance_cents;

    return { ok: true, wagerId, balanceCents: after, toWinCents: toWin };
  });

  return run();
}

/**
 * Settles every market for a league week whose games are all finished.
 *
 * Idempotent: a market already marked settled is skipped, and each wager moves out
 * of 'open' exactly once, so calling this repeatedly cannot pay twice. Winners are
 * credited stake plus profit; a tie voids and refunds.
 */
export function settleFinishedMarkets(
  leagueId: string,
  season: string,
  week: number,
  finalScores: Map<number, { a: number; b: number }>,
): { settled: number; paid: number } {
  const db = getDb();

  const run = db.transaction(() => {
    const markets = db
      .prepare(
        `SELECT * FROM markets
         WHERE league_id = ? AND season = ? AND week = ? AND status IN ('open','closed')`,
      )
      .all(leagueId, season, week) as MarketRow[];

    let settled = 0;
    let paid = 0;

    for (const market of markets) {
      const score = finalScores.get(market.matchup_id);
      if (!score) continue;

      const winner = score.a > score.b ? 'a' : score.b > score.a ? 'b' : 'push';

      // The scores are stored, not just the verdict, so that if a Sleeper stat
      // correction later moves a total we can see what we actually paid on.
      db.prepare(
        `UPDATE markets
         SET status = 'settled', winner = ?, final_a = ?, final_b = ?,
             settled_at = datetime('now')
         WHERE id = ?`,
      ).run(winner, score.a, score.b, market.id);
      settled++;

      const wagers = db
        .prepare(`SELECT * FROM wagers WHERE market_id = ? AND status = 'open'`)
        .all(market.id) as WagerRow[];

      for (const w of wagers) {
        if (winner === 'push') {
          db.prepare(
            `UPDATE wagers SET status = 'void', settled_at = datetime('now') WHERE id = ?`,
          ).run(w.id);
          credit(db, w.account_id, w.stake_cents, 'wager_void', w.id);
          paid += w.stake_cents;
          continue;
        }
        if (w.side === winner) {
          const payout = w.stake_cents + w.to_win_cents;
          db.prepare(
            `UPDATE wagers SET status = 'won', settled_at = datetime('now') WHERE id = ?`,
          ).run(w.id);
          credit(db, w.account_id, payout, 'wager_win', w.id);
          paid += payout;
        } else {
          // The stake already left the balance at placement, so a loss is just a
          // status change — no second debit, or it would be charged twice.
          db.prepare(
            `UPDATE wagers SET status = 'lost', settled_at = datetime('now') WHERE id = ?`,
          ).run(w.id);
        }
      }
    }
    return { settled, paid };
  });

  return run();
}

type DbHandle = ReturnType<typeof getDb>;

function credit(
  db: DbHandle,
  accountId: string,
  amountCents: number,
  reason: string,
  refId: string,
): void {
  db.prepare(
    `INSERT INTO ledger (id, account_id, amount_cents, reason, ref_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(randomUUID(), accountId, amountCents, reason, refId);
  db.prepare('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?').run(
    amountCents,
    accountId,
  );
}
