import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { findAccountById } from '@/lib/betting/accounts';
import { accountCanBetInLeague, findBettingLeague } from '@/lib/betting/leagues';
import { settleQuietly } from '@/lib/betting/settlement';
import { buildLeaderboard } from '@/lib/betting/leaderboardData';

export const dynamic = 'force-dynamic';

/**
 * Standings across the league: who is up, who is down, and what is still live.
 *
 * Balances are shown to every member rather than kept private — the whole point of
 * fake money is the bragging rights, and it is a shared ledger among ten people who
 * know each other.
 *
 * The query itself lives in `lib/betting/leaderboardData.ts` so the Discord bot serves the same
 * numbers from the same code. This handler is the browser's door onto it: session, membership, and
 * nothing else.
 */
export async function GET(request: Request) {
  const auth = getAuthUser(request);
  if (!auth) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  // Settle anything whose games have finished before reading balances, so a payout
  // shows up on the same refresh that reveals the result rather than the next one.
  await settleQuietly();

  const account = findAccountById(auth.accountId);
  if (!account) return NextResponse.json({ ok: false, error: 'Account not found.' }, { status: 401 });

  const leagueId = new URL(request.url).searchParams.get('leagueId') ?? '';
  if (!findBettingLeague(leagueId)) {
    return NextResponse.json({ ok: false, error: 'Not a betting league.' }, { status: 404 });
  }
  if (!accountCanBetInLeague(account.id, leagueId)) {
    return NextResponse.json(
      { ok: false, error: 'You are not a member of this league.' },
      { status: 403 },
    );
  }

  // Non-null by construction: findBettingLeague above is the same check buildLeaderboard makes.
  const data = await buildLeaderboard(leagueId, account.id);
  return NextResponse.json({ ok: true, ...data });
}
