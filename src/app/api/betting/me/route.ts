import { NextResponse } from 'next/server';
import { getAuthUser, setTokenCookie, signToken } from '@/lib/auth';
import {
  NEGATIVE_OPEN_EXPOSURE_CAP_CENTS,
  findAccountById,
  getLedger,
} from '@/lib/betting/accounts';
import { BETTING_LEAGUES } from '@/lib/betting/leagues';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET — the signed-in account, its balance, its ledger, and where it may bet. */
export async function GET(request: Request) {
  const auth = getAuthUser(request);
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }

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
    ledger: getLedger(account.id).map(e => ({
      id: e.id,
      amountCents: e.amount_cents,
      reason: e.reason,
      createdAt: e.created_at,
    })),
  }, { headers: { 'Set-Cookie': setTokenCookie(refreshedToken) } });
}
