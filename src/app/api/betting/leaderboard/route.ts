import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { findAccountById } from '@/lib/betting/accounts';
import { accountCanBetInLeague, findBettingLeague } from '@/lib/betting/leagues';
import { START_BALANCE_CENTS } from '@/lib/betting/constants';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Standings across the league: who is up, who is down, and what is still live.
 *
 * Balances are shown to every member rather than kept private — the whole point of
 * fake money is the bragging rights, and it is a shared ledger among ten people who
 * know each other.
 */
export async function GET(request: Request) {
  const auth = getAuthUser(request);
  if (!auth) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  const account = findAccountById(auth.accountId);
  if (!account) return NextResponse.json({ ok: false, error: 'Account not found.' }, { status: 401 });

  const leagueId = new URL(request.url).searchParams.get('leagueId') ?? '';
  const cfg = findBettingLeague(leagueId);
  if (!cfg) return NextResponse.json({ ok: false, error: 'Not a betting league.' }, { status: 404 });
  if (!accountCanBetInLeague(account.id, leagueId)) {
    return NextResponse.json({ ok: false, error: 'You are not a member of this league.' }, { status: 403 });
  }

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
      `SELECT a.id AS account_id, a.username, a.display_name, a.balance_cents,
              CASE WHEN a.password_hash IS NULL THEN 0 ELSE 1 END AS claimed,
              COALESCE((SELECT SUM(stake_cents) FROM wagers w
                        WHERE w.account_id = a.id AND w.status = 'open'), 0) AS open_stake,
              COALESCE((SELECT COUNT(*) FROM wagers w
                        WHERE w.account_id = a.id AND w.status = 'open'), 0) AS open_count,
              COALESCE((SELECT COUNT(*) FROM wagers w
                        WHERE w.account_id = a.id AND w.status <> 'open'), 0) AS settled_count,
              COALESCE((SELECT COUNT(*) FROM wagers w
                        WHERE w.account_id = a.id AND w.status = 'won'), 0) AS won,
              COALESCE((SELECT COUNT(*) FROM wagers w
                        WHERE w.account_id = a.id AND w.status = 'lost'), 0) AS lost,
              COALESCE((SELECT COUNT(*) FROM wagers w
                        WHERE w.account_id = a.id AND w.status = 'void'), 0) AS void_count,
              COALESCE((SELECT SUM(stake_cents) FROM wagers w WHERE w.account_id = a.id), 0) AS total_staked,
              -- Profit counts RESOLVED wagers only. Summing every wager_place ledger
              -- row would show someone with nothing but open bets at -100%, when in
              -- fact they have lost nothing yet — that stake is at risk, not gone.
              COALESCE((SELECT SUM(stake_cents) FROM wagers w
                        WHERE w.account_id = a.id AND w.status <> 'open'), 0) AS settled_staked,
              COALESCE((SELECT SUM(l.amount_cents) FROM ledger l
                        WHERE l.account_id = a.id
                          AND l.reason IN ('wager_win','wager_void')), 0) AS returns
       FROM accounts a
       JOIN account_leagues al ON al.account_id = a.id
       WHERE al.league_id = ?
       ORDER BY a.balance_cents DESC, a.display_name ASC`,
    )
    .all(leagueId) as Row[];

  const standings = rows.map(r => {
    const net = r.returns - r.settled_staked;
    return {
    accountId: r.account_id,
    displayName: r.display_name,
    isMe: r.account_id === account.id,
    claimed: r.claimed === 1,
    balanceCents: r.balance_cents,
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

  // Every open position in the league, so people can see who backed whom.
  const openPositions = db
    .prepare(
      `SELECT a.display_name AS bettor, w.side, w.stake_cents, w.price, w.to_win_cents,
              m.matchup_id, m.week
       FROM wagers w
       JOIN accounts a ON a.id = w.account_id
       JOIN markets m ON m.id = w.market_id
       WHERE m.league_id = ? AND w.status = 'open'
       ORDER BY w.stake_cents DESC`,
    )
    .all(leagueId) as unknown[];

  return NextResponse.json({
    ok: true,
    league: { leagueId, season: cfg.season, label: cfg.label },
    startBalanceCents: START_BALANCE_CENTS,
    standings,
    openPositions,
  });
}
