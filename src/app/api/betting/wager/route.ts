import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { findAccountById } from '@/lib/betting/accounts';
import { accountCanBetInLeague } from '@/lib/betting/leagues';
import { placeWager } from '@/lib/betting/wagers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** POST { marketId, side, stakeCents } — place a wager at the server's price. */
export async function POST(request: Request) {
  const auth = getAuthUser(request);
  if (!auth) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  const account = findAccountById(auth.accountId);
  if (!account) return NextResponse.json({ ok: false, error: 'Account not found.' }, { status: 401 });

  let body: { marketId?: unknown; side?: unknown; stakeCents?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request body.' }, { status: 400 });
  }

  const marketId = typeof body.marketId === 'string' ? body.marketId : '';
  const side = body.side === 'a' || body.side === 'b' ? body.side : null;
  const stakeCents = typeof body.stakeCents === 'number' ? Math.round(body.stakeCents) : NaN;

  if (!marketId || !side || !Number.isFinite(stakeCents)) {
    return NextResponse.json(
      { ok: false, error: 'marketId, side ("a" or "b") and stakeCents are required.' },
      { status: 400 },
    );
  }

  // Note the price is NOT taken from the request. placeWager reads it off the
  // market row this server priced, so a forged price is impossible.
  const market = getDb()
    .prepare('SELECT league_id FROM markets WHERE id = ?')
    .get(marketId) as { league_id: string } | undefined;
  if (!market) return NextResponse.json({ ok: false, error: 'No such market.' }, { status: 404 });

  if (!accountCanBetInLeague(account.id, market.league_id)) {
    return NextResponse.json(
      { ok: false, error: 'You are not a member of this league.' },
      { status: 403 },
    );
  }

  const result = placeWager(account.id, account.sleeper_user_id, marketId, side, stakeCents);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    wagerId: result.wagerId,
    balanceCents: result.balanceCents,
    toWinCents: result.toWinCents,
  });
}
