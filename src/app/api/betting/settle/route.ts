import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { findAccountById } from '@/lib/betting/accounts';
import { runDueSettlements } from '@/lib/betting/settlement';

export const dynamic = 'force-dynamic';

/**
 * POST — force a settlement sweep, bypassing the debounce.
 *
 * The lazy sweep on the read routes is what normally settles a week; this exists so
 * a stuck week can be pushed through and inspected without waiting for someone to
 * load a page. Admin-only, because it reports every skip reason across every
 * account's markets.
 */
export async function POST(request: Request) {
  const auth = getAuthUser(request);
  if (!auth) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  const account = findAccountById(auth.accountId);
  if (!account || account.is_admin !== 1) {
    return NextResponse.json({ ok: false, error: 'Admins only.' }, { status: 403 });
  }

  const result = await runDueSettlements(true);
  return NextResponse.json({ ok: true, ...result });
}
