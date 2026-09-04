import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { accountCanBetInLeague, findBettingLeague } from '@/lib/betting/leagues';
import { findAccountById } from '@/lib/betting/accounts';
import { priceLeagueWeek } from '@/lib/betting/pricing';
import { openExposureCents } from '@/lib/betting/wagers';
import { NEGATIVE_OPEN_EXPOSURE_CAP_CENTS } from '@/lib/betting/constants';
import { getDb } from '@/lib/db';
import { settleQuietly } from '@/lib/betting/settlement';

export const dynamic = 'force-dynamic';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

/** GET ?leagueId=&week= — server-priced markets, plus this account's wagers. */
export async function GET(request: Request) {
  const auth = getAuthUser(request);
  if (!auth) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  // Settle anything whose games have finished before reading balances, so a payout
  // shows up on the same refresh that reveals the result rather than the next one.
  await settleQuietly();

  const account = findAccountById(auth.accountId);
  if (!account) return NextResponse.json({ ok: false, error: 'Account not found.' }, { status: 401 });

  const url = new URL(request.url);
  const leagueId = url.searchParams.get('leagueId') ?? '';
  const cfg = findBettingLeague(leagueId);
  if (!cfg) return NextResponse.json({ ok: false, error: 'Not a betting league.' }, { status: 404 });

  if (!accountCanBetInLeague(account.id, leagueId)) {
    return NextResponse.json(
      { ok: false, error: 'You are not a member of this league.' },
      { status: 403 },
    );
  }

  let week = Number(url.searchParams.get('week'));
  if (!Number.isInteger(week) || week < 1) {
    // The week being played, which is what we price — not completedWeekCount(),
    // which deliberately excludes the in-progress week.
    const state = await fetch(`${SLEEPER_BASE}/state/nfl`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
    week = Math.max(1, Number(state?.week) || 1);
  }

  const markets = await priceLeagueWeek(leagueId, week);

  const myWagers = getDb()
    .prepare(
      `SELECT w.id, w.market_id, w.side, w.stake_cents, w.price, w.to_win_cents, w.status,
              w.placed_at, m.matchup_id
       FROM wagers w JOIN markets m ON m.id = w.market_id
       WHERE w.account_id = ? AND m.league_id = ? AND m.season = ? AND m.week = ?
       ORDER BY w.placed_at DESC`,
    )
    .all(account.id, leagueId, cfg.season, week) as unknown[];

  return NextResponse.json({
    ok: true,
    week,
    league: { leagueId, season: cfg.season, label: cfg.label },
    // So the UI can grey out your own matchup rather than letting you click it.
    mySleeperUserId: account.sleeper_user_id,
    balanceCents: account.balance_cents,
    openExposureCents: openExposureCents(account.id),
    negativeExposureCapCents: NEGATIVE_OPEN_EXPOSURE_CAP_CENTS,
    markets,
    myWagers,
  });
}
