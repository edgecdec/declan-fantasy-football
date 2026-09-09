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
import { priceLeagueWeek } from '@/lib/betting/pricing';
import { valueOpenPositions, weeksWithOpenPositions } from '@/lib/betting/valuation';

export const dynamic = 'force-dynamic';

/**
 * How stale a line may be before the dashboard re-prices it.
 *
 * Re-pricing costs an ESPN call plus three Sleeper calls per league week, so it is not done on
 * every load — but a "live" figure computed off a ten-minute-old line is not live. 45s is under
 * the page's own refresh cadence, so a viewer sitting on the dashboard sees the number move.
 */
const REPRICE_AFTER_SECONDS = 45;

/** Bounds the work when an account somehow has open bets across many weeks. */
const MAX_WEEKS_TO_REPRICE = 4;

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

  /*
   * Refresh the lines behind any open bet before valuing them.
   *
   * Only the weeks this account actually has money on, so the cost is proportional to their
   * exposure rather than to the size of the league. Stale-only and capped, because the point is
   * a live number, not a fresh call for its own sake — and a pricing failure must not take the
   * dashboard down, so each one is swallowed and the previous line is used instead.
   */
  const stale = weeksWithOpenPositions(account.id)
    .filter(w => {
      const age = (Date.now() - Date.parse(`${w.pricedAt.replace(' ', 'T')}Z`)) / 1000;
      return !Number.isFinite(age) || age >= REPRICE_AFTER_SECONDS;
    })
    .slice(0, MAX_WEEKS_TO_REPRICE);
  await Promise.all(
    stale.map(w => priceLeagueWeek(w.leagueId, w.week).catch(() => undefined)),
  );

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

  /*
   * What the open book is worth at the current odds.
   *
   * The balance alone reads as though a staked dollar has evaporated, because it left the
   * balance at placement and does not come back until settlement. This is the other half of the
   * picture: see src/lib/betting/valuation.ts for why it uses the fair probability rather than
   * the priced one, and why a fresh bet is worth slightly less than its stake.
   */
  const valuation = valueOpenPositions(account.id, account.balance_cents);
  const openStakeCents = valuation.openStakeCents;

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
    liveValueCents: valuation.liveValueCents,
    equityCents: valuation.equityCents,
    unrealisedPnlCents: valuation.unrealisedPnlCents,
    openPositions: valuation.positions,
    pricedAt: valuation.oldestPricedAt,
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
