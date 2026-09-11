import { getDb } from '@/lib/db';

/**
 * What an open bet is worth right now, and therefore what an account is actually worth.
 *
 * The balance alone understates people mid-slate, and the reason is structural rather than a
 * display choice: a stake leaves the balance the moment the bet is placed, so someone who has
 * $1,000 and bets $500 on a side that is now 90% to win reads as $500. They are plainly worth
 * more than that. "At risk" says how much is out there but nothing about how it is going.
 *
 * So each open position is marked to market: its expected payout at the CURRENT line.
 *
 *   value = P(this side wins now) x (stake + profit)
 *   live worth = balance + the sum of those
 *
 * Two decisions in that formula are worth stating, because both could reasonably have gone the
 * other way:
 *
 * 1. IT USES THE FAIR PROBABILITY, NOT THE PRICE. `markets.prob_a` is the simulation's honest
 *    estimate; `price_a`/`price_b` are that estimate shaded to carry the house edge, so their
 *    implied probabilities deliberately sum above 100%. Valuing both sides off the shaded
 *    prices would make the two halves of a matchup add up to more than the money on it.
 *
 * 2. IT IS AN EXPECTATION, NOT A CASH-OUT. There is nobody to sell a position to here, so this
 *    is what the bet is worth on average, not what you could take today. A consequence that
 *    looks like a bug and is not: a bet is worth slightly LESS than its stake the instant it is
 *    placed, because the price paid included the vig. On a true coin flip at -110, $100 becomes
 *    $95.45 of expected value immediately. That gap is the edge, and hiding it would be the
 *    dishonest choice.
 *
 * Ties are ignored, exactly as the pricing ignores them: fantasy scores carry decimals, so an
 * exact push is vanishingly rare, and a market only ever prices two sides. A push that does
 * happen refunds the stake, and a settled market is valued on its result rather than its line.
 */

export type OpenPosition = {
  wagerId: string;
  marketId: string;
  leagueId: string;
  season: string;
  week: number;
  matchupId: number;
  side: 'a' | 'b';
  /** Who was backed, and who against. */
  pick: string;
  against: string;
  stakeCents: number;
  toWinCents: number;
  /** American odds locked in at placement. */
  price: number;
  /** Probability this side wins, from the latest priced line. Fair, not vig-shaded. */
  winProbability: number;
  /** The probability at which this bet breaks even at the price paid. */
  breakEvenProbability: number;
  /** Expected payout at the current probability. */
  valueCents: number;
  /** How much the position has gained or lost since it was struck, in expectation. */
  unrealisedCents: number;
  /** When the line behind winProbability was last recomputed. */
  pricedAt: string;
  placedAt: string;
};

export type AccountValuation = {
  balanceCents: number;
  /** Total stake on unsettled bets — money already out of the balance. */
  openStakeCents: number;
  /** Expected return of every open position at current odds. */
  liveValueCents: number;
  /** balance + liveValue: what the account is worth right now. */
  equityCents: number;
  /** liveValue - openStake: the open book's gain or loss so far, in expectation. */
  unrealisedPnlCents: number;
  positions: OpenPosition[];
  /** Oldest line behind any of these numbers, so the UI can admit to being stale. */
  oldestPricedAt: string | null;
};

/** Expected payout of a position at a given win probability. */
export function positionValueCents(
  stakeCents: number,
  toWinCents: number,
  winProbability: number,
): number {
  const p = Math.min(1, Math.max(0, winProbability));
  return Math.round(p * (stakeCents + toWinCents));
}

/**
 * The probability at which a bet is a coin flip in money terms.
 *
 * Comparing it against the current probability is the cleanest read on whether a bet is
 * winning: above break-even it is ahead of the price paid, below it is behind — regardless of
 * whether the side happens to be favoured.
 */
export function breakEvenProbability(stakeCents: number, toWinCents: number): number {
  const payout = stakeCents + toWinCents;
  return payout > 0 ? stakeCents / payout : 0;
}

type Row = {
  wager_id: string;
  account_id: string;
  market_id: string;
  league_id: string;
  season: string;
  week: number;
  matchup_id: number;
  side: string;
  stake_cents: number;
  to_win_cents: number;
  price: number;
  placed_at: string;
  prob_a: number;
  winner: string | null;
  name_a: string | null;
  name_b: string | null;
  roster_a: number;
  roster_b: number;
  priced_at: string;
};

/**
 * The probability to value a position at.
 *
 * A market with a result is valued on the result, not on the line it last carried. That only
 * matters in the window between a game finishing and settlement running, but in that window
 * the line is stale and the answer is already known, so using it would show a decided bet as
 * uncertain.
 */
function probabilityFor(row: Row): number {
  const side = row.side === 'a' ? 'a' : 'b';
  if (row.winner === 'a' || row.winner === 'b') return row.winner === side ? 1 : 0;
  return side === 'a' ? row.prob_a : 1 - row.prob_a;
}

/** The columns every valuation needs, so the two entry points cannot drift apart. */
const OPEN_POSITION_SELECT = `
  SELECT w.id AS wager_id, w.account_id, w.market_id, w.side, w.stake_cents, w.to_win_cents,
         w.price, w.placed_at,
         m.league_id, m.season, m.week, m.matchup_id, m.prob_a, m.winner,
         m.name_a, m.name_b, m.roster_a, m.roster_b, m.priced_at
  FROM wagers w JOIN markets m ON m.id = w.market_id
  WHERE w.status = 'open'`;

function toPosition(row: Row): OpenPosition {
  const side = row.side === 'a' ? 'a' : 'b';
  // A push refunds the stake, so the position is worth exactly what was staked.
  const isPush = row.winner === 'push';
  const winProbability = probabilityFor(row);
  const valueCents = isPush
    ? row.stake_cents
    : positionValueCents(row.stake_cents, row.to_win_cents, winProbability);
  return {
    wagerId: row.wager_id,
    marketId: row.market_id,
    leagueId: row.league_id,
    season: row.season,
    week: row.week,
    matchupId: row.matchup_id,
    side,
    pick: (side === 'a' ? row.name_a : row.name_b) ?? `Roster ${side === 'a' ? row.roster_a : row.roster_b}`,
    against: (side === 'a' ? row.name_b : row.name_a) ?? `Roster ${side === 'a' ? row.roster_b : row.roster_a}`,
    stakeCents: row.stake_cents,
    toWinCents: row.to_win_cents,
    price: row.price,
    winProbability,
    breakEvenProbability: breakEvenProbability(row.stake_cents, row.to_win_cents),
    valueCents,
    unrealisedCents: valueCents - row.stake_cents,
    pricedAt: row.priced_at,
    placedAt: row.placed_at,
  };
}

function summarise(balanceCents: number, positions: OpenPosition[]): AccountValuation {
  const openStakeCents = positions.reduce((s, p) => s + p.stakeCents, 0);
  const liveValueCents = positions.reduce((s, p) => s + p.valueCents, 0);
  return {
    balanceCents,
    openStakeCents,
    liveValueCents,
    equityCents: balanceCents + liveValueCents,
    unrealisedPnlCents: liveValueCents - openStakeCents,
    positions,
    // The oldest line, not the newest: the number is only as fresh as its stalest input.
    oldestPricedAt: positions.reduce<string | null>(
      (oldest, p) => (oldest === null || p.pricedAt < oldest ? p.pricedAt : oldest),
      null,
    ),
  };
}

/**
 * Marks an account's unsettled bets to the latest priced line.
 *
 * `leagueId` scopes it to one bankroll, which is what a league page needs: since balances are
 * per-league, an equity figure that mixed leagues would not reconcile with the balance beside it.
 * Omit it for a whole-account view, and pass the matching balance.
 */
export function valueOpenPositions(
  accountId: string,
  balanceCents: number,
  leagueId?: string,
): AccountValuation {
  const db = getDb();
  const rows = leagueId
    ? (db
        .prepare(
          `${OPEN_POSITION_SELECT} AND w.account_id = ? AND m.league_id = ?
           ORDER BY w.placed_at DESC`,
        )
        .all(accountId, leagueId) as Row[])
    : (db
        .prepare(`${OPEN_POSITION_SELECT} AND w.account_id = ? ORDER BY w.placed_at DESC`)
        .all(accountId) as Row[]);
  return summarise(balanceCents, rows.map(toPosition));
}

/**
 * The same valuation for many accounts at once, for a standings table.
 *
 * One query rather than one per account, and scoped to the league whose standings are being shown.
 * That scoping is required now that bankrolls are per-league: the balance in the table is that
 * league's, so counting another league's open bets against it would produce a "worth" that
 * reconciles with nothing on the page.
 */
export function valueOpenPositionsForAccounts(
  accounts: { id: string; balanceCents: number }[],
  leagueId: string,
): Map<string, AccountValuation> {
  const out = new Map<string, AccountValuation>();
  if (accounts.length === 0) return out;

  const placeholders = accounts.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `${OPEN_POSITION_SELECT} AND m.league_id = ? AND w.account_id IN (${placeholders})
       ORDER BY w.placed_at DESC`,
    )
    .all(leagueId, ...accounts.map(a => a.id)) as Row[];

  const byAccount = new Map<string, OpenPosition[]>();
  for (const row of rows) {
    const list = byAccount.get(row.account_id);
    if (list) list.push(toPosition(row));
    else byAccount.set(row.account_id, [toPosition(row)]);
  }
  for (const a of accounts) {
    out.set(a.id, summarise(a.balanceCents, byAccount.get(a.id) ?? []));
  }
  return out;
}

/** The distinct league weeks an account has money riding on, for a targeted re-price. */
export function weeksWithOpenPositions(
  accountId: string,
): { leagueId: string; season: string; week: number; pricedAt: string }[] {
  return getDb()
    .prepare(
      `SELECT m.league_id AS leagueId, m.season AS season, m.week AS week,
              MIN(m.priced_at) AS pricedAt
       FROM wagers w JOIN markets m ON m.id = w.market_id
       WHERE w.account_id = ? AND w.status = 'open'
       GROUP BY m.league_id, m.season, m.week`,
    )
    .all(accountId) as { leagueId: string; season: string; week: number; pricedAt: string }[];
}

/**
 * The distinct league weeks ANY member of a league has money riding on.
 *
 * The standings equivalent of weeksWithOpenPositions: a standings table values everybody's
 * positions, so it has to refresh every line behind them, not just the viewer's.
 */
export function weeksWithOpenPositionsInLeague(
  leagueId: string,
): { leagueId: string; season: string; week: number; pricedAt: string }[] {
  return getDb()
    .prepare(
      `SELECT m.league_id AS leagueId, m.season AS season, m.week AS week,
              MIN(m.priced_at) AS pricedAt
       FROM wagers w JOIN markets m ON m.id = w.market_id
       WHERE w.status = 'open' AND m.league_id = ?
       GROUP BY m.league_id, m.season, m.week`,
    )
    .all(leagueId) as { leagueId: string; season: string; week: number; pricedAt: string }[];
}

/**
 * Whether a line is stale enough to be worth re-pricing.
 *
 * Shared so the dashboard and the standings cannot disagree about what "live" means, and so the
 * unparseable case is handled once — an unreadable timestamp counts as stale, which costs a call
 * rather than silently serving an unknown-age number as current.
 */
export function lineIsStale(pricedAt: string, maxAgeSeconds: number): boolean {
  const age = (Date.now() - Date.parse(`${pricedAt.replace(' ', 'T')}Z`)) / 1000;
  return !Number.isFinite(age) || age >= maxAgeSeconds;
}
