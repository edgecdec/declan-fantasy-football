import { NextResponse } from 'next/server';
import { requireBot, resolveDiscordAccount } from '@/lib/betting/botApi';
import { MIN_STAKE_CENTS, placeWager } from '@/lib/betting/wagers';

export const dynamic = 'force-dynamic';

/**
 * Places a bet on behalf of a linked Discord user.
 *
 * This route deliberately contains NO betting logic. It resolves the Discord id to an account and
 * calls `placeWager`, which is the same function the website's own route calls — so every integrity
 * rule applies unchanged and without being restated here:
 *
 *   - refusal to bet on your own matchup
 *   - the stake fits the league bankroll
 *   - NEGATIVE_OPEN_EXPOSURE_CAP_CENTS while in the red
 *   - the price comes from the server's `markets` row, never from the caller
 *   - `outcomeInDoubt`, so a market whose result is settled cannot be bet
 *
 * Reimplementing any of that for Discord is how the two surfaces would come to disagree about what
 * is allowed, and the disagreement would be found by whoever exploited it.
 */
export async function POST(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;

  let body: { discordUserId?: string; marketId?: string; side?: string; stakeCents?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected a JSON body.' }, { status: 400 });
  }

  const resolved = resolveDiscordAccount(body.discordUserId ?? null);
  if ('error' in resolved) return resolved.error;
  const { account } = resolved;

  const marketId = body.marketId?.trim();
  if (!marketId) {
    return NextResponse.json({ ok: false, error: 'marketId is required.' }, { status: 400 });
  }
  if (body.side !== 'a' && body.side !== 'b') {
    return NextResponse.json({ ok: false, error: 'side must be "a" or "b".' }, { status: 400 });
  }
  /*
   * Integer cents, checked here rather than trusted. A float arriving from a Discord number option
   * (49.99 dollars becoming 4998.999999) would otherwise reach the ledger, where everything is an
   * integer and a fractional cent is a silent corruption.
   */
  const stakeCents = Number(body.stakeCents);
  if (!Number.isInteger(stakeCents) || stakeCents < MIN_STAKE_CENTS) {
    return NextResponse.json(
      { ok: false, error: `Stake must be a whole number of cents, at least ${MIN_STAKE_CENTS}.` },
      { status: 400 },
    );
  }

  const result = placeWager(account.id, account.sleeper_user_id, marketId, body.side, stakeCents);
  if (!result.ok) {
    // placeWager's own status and message are passed through: it knows why it refused, and
    // paraphrasing would lose the reason someone needs to act on.
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    wagerId: result.wagerId,
    balanceCents: result.balanceCents,
    toWinCents: result.toWinCents,
    account: { username: account.username, displayName: account.display_name },
  });
}
