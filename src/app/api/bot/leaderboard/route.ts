import { NextResponse } from 'next/server';
import { requireBot, resolveDiscordAccount } from '@/lib/betting/botApi';
import { accountCanBetInLeague, findBettingLeague } from '@/lib/betting/leagues';
import { settleQuietly } from '@/lib/betting/settlement';
import { buildLeaderboard } from '@/lib/betting/leaderboardData';

export const dynamic = 'force-dynamic';

/**
 * League standings for a Discord command — the same numbers the website shows, from the same code.
 *
 * `discordUserId` is optional. Without it the standings are still returned, just with no `isMe`
 * flag: `/balances` is useful to someone who has not linked an account, and the figures are public
 * within the league anyway. With it, membership is enforced exactly as the browser route does, so
 * linking an account cannot become a way to read a league you are not in.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const leagueId = params.get('leagueId') ?? '';
  if (!findBettingLeague(leagueId)) {
    return NextResponse.json({ ok: false, error: 'Not a betting league.' }, { status: 404 });
  }

  const discordUserId = params.get('discordUserId');
  let viewerAccountId = '';
  if (discordUserId) {
    const resolved = resolveDiscordAccount(discordUserId);
    if ('error' in resolved) return resolved.error;
    if (!accountCanBetInLeague(resolved.account.id, leagueId)) {
      return NextResponse.json(
        { ok: false, error: 'You are not a member of this league.' },
        { status: 403 },
      );
    }
    viewerAccountId = resolved.account.id;
  }

  await settleQuietly();
  const data = await buildLeaderboard(leagueId, viewerAccountId);
  return NextResponse.json({ ok: true, ...data });
}
