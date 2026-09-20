import { getDb } from '@/lib/db';
import { findBettingLeague } from '@/lib/betting/leagues';
import { START_BALANCE_CENTS } from '@/lib/betting/constants';
import { priceLeagueWeek } from '@/lib/betting/pricing';
import {
  lineIsStale,
  valueOpenPositionsForAccounts,
  weeksWithOpenPositionsInLeague,
} from '@/lib/betting/valuation';

/**
 * League standings for Declan Dollars: who is up, who is down, what is still live.
 *
 * Lifted out of the route handler so the website and the Discord bot call ONE implementation.
 * Duplicating this query is how the two surfaces start quietly disagreeing about someone's
 * balance, and the aggregates here are subtle enough to diverge in ways nobody would notice --
 * every wager total is joined through `markets` to this specific league, and profit deliberately
 * counts resolved wagers only so a portfolio of open bets does not read as -100%.
 *
 * Takes the viewer explicitly rather than reading a session, because the bot has no cookie. The
 * viewer only decides the `isMe` flag; every other number is the same for everyone, which is the
 * point of a shared ledger among people who know each other.
 */
export const REPRICE_AFTER_SECONDS = 45;
const MAX_WEEKS_TO_REPRICE = 4;

export async function buildLeaderboard(leagueId: string, viewerAccountId: string) {
  const cfg = findBettingLeague(leagueId);
  if (!cfg) return null;

  const db = getDb();

  type Row = {
    account_id: string;
    username: string;
    display_name: string;
    balance_cents: number;
    claimed: number;
    open_stake: number;
    open_count: number;
    settled_count: number;
    won: number;
    lost: number;
    void_count: number;
    total_staked: number;
    /** Stake on wagers that have actually resolved. */
    settled_staked: number;
    /** Everything paid back out on resolved wagers — wins and refunded ties. */
    returns: number;
  };

  const rows = db
    .prepare(
      // al.balance_cents, not a.balance_cents: this league's bankroll is what this table ranks.
      `SELECT a.id AS account_id, a.username, a.display_name, al.balance_cents AS balance_cents,
              CASE WHEN a.password_hash IS NULL THEN 0 ELSE 1 END AS claimed,
              -- Every wager aggregate is joined through markets to THIS league. Without that,
              -- a second league's bets would show up in this league's record and ROI.
              COALESCE((SELECT SUM(w.stake_cents) FROM wagers w JOIN markets m ON m.id = w.market_id
                        WHERE w.account_id = a.id AND w.status = 'open' AND m.league_id = al.league_id), 0) AS open_stake,
              COALESCE((SELECT COUNT(*) FROM wagers w JOIN markets m ON m.id = w.market_id
                        WHERE w.account_id = a.id AND w.status = 'open' AND m.league_id = al.league_id), 0) AS open_count,
              COALESCE((SELECT COUNT(*) FROM wagers w JOIN markets m ON m.id = w.market_id
                        WHERE w.account_id = a.id AND w.status <> 'open' AND m.league_id = al.league_id), 0) AS settled_count,
              COALESCE((SELECT COUNT(*) FROM wagers w JOIN markets m ON m.id = w.market_id
                        WHERE w.account_id = a.id AND w.status = 'won' AND m.league_id = al.league_id), 0) AS won,
              COALESCE((SELECT COUNT(*) FROM wagers w JOIN markets m ON m.id = w.market_id
                        WHERE w.account_id = a.id AND w.status = 'lost' AND m.league_id = al.league_id), 0) AS lost,
              COALESCE((SELECT COUNT(*) FROM wagers w JOIN markets m ON m.id = w.market_id
                        WHERE w.account_id = a.id AND w.status = 'void' AND m.league_id = al.league_id), 0) AS void_count,
              COALESCE((SELECT SUM(w.stake_cents) FROM wagers w JOIN markets m ON m.id = w.market_id
                        WHERE w.account_id = a.id AND m.league_id = al.league_id), 0) AS total_staked,
              -- Profit counts RESOLVED wagers only. Summing every wager_place ledger
              -- row would show someone with nothing but open bets at -100%, when in
              -- fact they have lost nothing yet — that stake is at risk, not gone.
              COALESCE((SELECT SUM(w.stake_cents) FROM wagers w JOIN markets m ON m.id = w.market_id
                        WHERE w.account_id = a.id AND w.status <> 'open' AND m.league_id = al.league_id), 0) AS settled_staked,
              COALESCE((SELECT SUM(l.amount_cents) FROM ledger l
                        WHERE l.account_id = a.id AND l.league_id = al.league_id
                          AND l.reason IN ('wager_win','wager_void')), 0) AS returns
       FROM accounts a
       JOIN account_leagues al ON al.account_id = a.id
       WHERE al.league_id = ?
       ORDER BY a.display_name ASC`,
    )
    .all(leagueId) as Row[];

  /*
   * Refresh the lines behind everyone's open bets, then value them.
   *
   * A standings table values every member's positions, not just the viewer's, so it has to
   * refresh every line behind them. Stale-only, capped, and each failure swallowed: a pricing
   * hiccup should cost freshness, not the standings.
   */
  const stale = weeksWithOpenPositionsInLeague(leagueId)
    .filter(w => lineIsStale(w.pricedAt, REPRICE_AFTER_SECONDS))
    .slice(0, MAX_WEEKS_TO_REPRICE);
  await Promise.all(stale.map(w => priceLeagueWeek(w.leagueId, w.week).catch(() => undefined)));

  const valuations = valueOpenPositionsForAccounts(
    rows.map(r => ({ id: r.account_id, balanceCents: r.balance_cents })),
    leagueId,
  );

  const standings = rows.map(r => {
    const net = r.returns - r.settled_staked;
    const v = valuations.get(r.account_id);
    return {
    accountId: r.account_id,
    displayName: r.display_name,
    isMe: r.account_id === viewerAccountId,
    claimed: r.claimed === 1,
    balanceCents: r.balance_cents,
    // What the account is worth right now: settled balance plus the expected return of every
    // open bet at the current line. This is what the table ranks on — a balance alone ranks
    // whoever has bet least highest mid-slate, since a stake leaves the balance at placement.
    liveValueCents: v?.liveValueCents ?? 0,
    equityCents: v?.equityCents ?? r.balance_cents,
    unrealisedPnlCents: v?.unrealisedPnlCents ?? 0,
    openStakeCents: r.open_stake,
    openCount: r.open_count,
    settledCount: r.settled_count,
    won: r.won,
    lost: r.lost,
    voided: r.void_count,
    totalStakedCents: r.total_staked,
    settledStakedCents: r.settled_staked,
    bettingNetCents: net,
    // Return on resolved stake, so an open position doesn't drag it. Null until
    // something has actually settled.
    roi: r.settled_staked > 0 ? net / r.settled_staked : null,
    };
  });

  // Every open position in the league, so people can see who backed whom — and how it is going.
  const openRows = db
    .prepare(
      `SELECT w.id AS wager_id, a.display_name AS bettor, w.side, w.stake_cents, w.price,
              w.to_win_cents, m.matchup_id, m.week, m.name_a, m.name_b
       FROM wagers w
       JOIN accounts a ON a.id = w.account_id
       JOIN markets m ON m.id = w.market_id
       WHERE m.league_id = ? AND w.status = 'open'
       ORDER BY w.stake_cents DESC`,
    )
    .all(leagueId) as {
      wager_id: string; bettor: string; side: string; stake_cents: number; price: number;
      to_win_cents: number; matchup_id: number; week: number;
      name_a: string | null; name_b: string | null;
    }[];

  // Reuse the per-account valuations rather than recomputing: same numbers by construction, so
  // a position can never be worth one thing in the standings row and another in this list.
  const positionByWager = new Map(
    [...valuations.values()].flatMap(v => v.positions.map(p => [p.wagerId, p] as const)),
  );

  const openPositions = openRows.map(r => {
    const p = positionByWager.get(r.wager_id);
    return {
      bettor: r.bettor,
      side: r.side,
      pick: (r.side === 'a' ? r.name_a : r.name_b) ?? r.side.toUpperCase(),
      stakeCents: r.stake_cents,
      price: r.price,
      toWinCents: r.to_win_cents,
      matchupId: r.matchup_id,
      week: r.week,
      winProbability: p?.winProbability ?? null,
      valueCents: p?.valueCents ?? null,
      unrealisedCents: p?.unrealisedCents ?? null,
    };
  });

  return {
    league: { leagueId, season: cfg.season, label: cfg.label },
    startBalanceCents: START_BALANCE_CENTS,
    // Ranked on live worth rather than balance. Ties broken by name so the order is stable
    // between refreshes instead of shuffling.
    standings: standings.sort(
      (x, y) => y.equityCents - x.equityCents || x.displayName.localeCompare(y.displayName),
    ),
    openPositions,
  };
}
