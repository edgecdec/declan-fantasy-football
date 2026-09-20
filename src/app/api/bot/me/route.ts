import { NextResponse } from 'next/server';
import { requireBot, resolveDiscordAccount } from '@/lib/betting/botApi';
import { leagueBankrolls } from '@/lib/betting/accounts';
import { NEGATIVE_OPEN_EXPOSURE_CAP_CENTS } from '@/lib/betting/constants';
import { settleQuietly } from '@/lib/betting/settlement';
import { valueOpenPositions } from '@/lib/betting/valuation';
import { openExposureCents } from '@/lib/betting/wagers';

export const dynamic = 'force-dynamic';

/**
 * One linked user's money: bankrolls, live equity, open positions.
 *
 * Backs /balance and /slips. Deliberately per-league rather than one total, because the bankrolls
 * are genuinely separate — a bad week in one league does not shrink what you can stake in another,
 * and showing a single figure would imply otherwise.
 *
 * Marks positions to the CURRENT line rather than reporting the price they were struck at, which is
 * what makes "3 of 4 legs alive" possible later and what makes a balance meaningful mid-slate: a
 * stake leaves the bankroll at placement, so balance alone understates anyone with open bets.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;

  const resolved = resolveDiscordAccount(
    new URL(request.url).searchParams.get('discordUserId'),
  );
  if ('error' in resolved) return resolved.error;
  const { account } = resolved;

  // Same reason the browser route does it: a payout should appear on the request that reveals the
  // result, not the one after.
  await settleQuietly();

  const bankrolls = leagueBankrolls(account.id);
  const perLeague = bankrolls.map(b => {
    const valuation = valueOpenPositions(account.id, b.balanceCents, b.leagueId);
    return {
      leagueId: b.leagueId,
      season: b.season,
      balanceCents: b.balanceCents,
      openStakeCents: valuation.openStakeCents,
      liveValueCents: valuation.liveValueCents,
      equityCents: valuation.equityCents,
      unrealisedPnlCents: valuation.unrealisedPnlCents,
      openExposureCents: openExposureCents(account.id, b.leagueId),
      positions: valuation.positions,
    };
  });

  return NextResponse.json({
    ok: true,
    user: {
      username: account.username,
      displayName: account.display_name,
      isAdmin: account.is_admin === 1,
      discordUserId: account.discord_user_id,
    },
    leagues: perLeague,
    negativeExposureCapCents: NEGATIVE_OPEN_EXPOSURE_CAP_CENTS,
  });
}
