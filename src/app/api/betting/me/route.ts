import { NextResponse } from 'next/server';
import { getAuthUser, setTokenCookie, signToken } from '@/lib/auth';
import {
  NEGATIVE_OPEN_EXPOSURE_CAP_CENTS,
  findAccountById,
  getLedger,
} from '@/lib/betting/accounts';
import { BETTING_LEAGUES } from '@/lib/betting/leagues';
import { getDb } from '@/lib/db';
import { settleQuietly } from '@/lib/betting/settlement';

export const dynamic = 'force-dynamic';

/** GET — the signed-in account, its balance, its ledger, and where it may bet. */
export async function GET(request: Request) {
  const auth = getAuthUser(request);
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }

  // Settle anything whose games have finished before reading balances, so a payout
  // shows up on the same refresh that reveals the result rather than the next one.
  await settleQuietly();

  const account = findAccountById(auth.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, error: 'Account no longer exists.' }, { status: 401 });
  }

  const leagueRows = getDb()
    .prepare('SELECT league_id, season FROM account_leagues WHERE account_id = ?')
    .all(account.id) as { league_id: string; season: string }[];

  const leagues = leagueRows.map(row => ({
    leagueId: row.league_id,
    season: row.season,
    label: BETTING_LEAGUES.find(l => l.leagueId === row.league_id)?.label ?? 'Unknown league',
  }));

  /*
   * Every bet this account has ever placed, resolved or not.
   *
   * This can't be derived from the ledger, which is the natural assumption: a LOSS
   * writes no ledger row at all, because the stake already left the balance at
   * placement and debiting again would charge it twice. So a ledger-only history
   * shows "Bet placed" and then nothing, and a losing bet appears to have silently
   * evaporated. The wager rows are the record of what happened; the ledger is the
   * record of money moving. Both are needed.
   */
  const bets = getDb()
    .prepare(
      `SELECT w.id, w.side, w.stake_cents, w.price, w.to_win_cents, w.status,
              w.placed_at, w.settled_at,
              m.league_id, m.season, m.week, m.matchup_id,
              m.roster_a, m.roster_b, m.name_a, m.name_b,
              m.winner, m.final_a, m.final_b
       FROM wagers w JOIN markets m ON m.id = w.market_id
       WHERE w.account_id = ?
       ORDER BY w.placed_at DESC
       LIMIT 200`,
    )
    .all(account.id) as Record<string, unknown>[];

  const openStakeCents = bets
    .filter(b => b.status === 'open')
    .reduce((sum, b) => sum + (b.stake_cents as number), 0);

  // Realised P&L only. An open bet has no result yet, and counting its stake as a
  // loss would show everyone deep in the red the moment they bet.
  const settledStake = bets
    .filter(b => b.status === 'won' || b.status === 'lost')
    .reduce((sum, b) => sum + (b.stake_cents as number), 0);
  const settledReturn = bets
    .filter(b => b.status === 'won')
    .reduce((sum, b) => sum + (b.stake_cents as number) + (b.to_win_cents as number), 0);

  // Slide the session forward on every authenticated read. The token is good for
  // 7 days from issue, so without this an active user gets logged out a week
  // after signing in for no reason; with it, only genuine inactivity expires them.
  const refreshedToken = signToken({
    accountId: account.id,
    username: account.username,
    isAdmin: account.is_admin === 1,
  });

  return NextResponse.json({
    ok: true,
    user: {
      username: account.username,
      displayName: account.display_name,
      isAdmin: account.is_admin === 1,
    },
    balanceCents: account.balance_cents,
    // Surfaced so the UI can explain the rule before someone tries to bet.
    negativeExposureCapCents: NEGATIVE_OPEN_EXPOSURE_CAP_CENTS,
    leagues,
    bets,
    openStakeCents,
    settledStakeCents: settledStake,
    settledReturnCents: settledReturn,
    realisedPnlCents: settledReturn - settledStake,
    ledger: getLedger(account.id).map(e => ({
      id: e.id,
      amountCents: e.amount_cents,
      reason: e.reason,
      createdAt: e.created_at,
    })),
  }, { headers: { 'Set-Cookie': setTokenCookie(refreshedToken) } });
}
