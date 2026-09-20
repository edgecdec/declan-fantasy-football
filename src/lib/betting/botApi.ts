import { NextResponse } from 'next/server';
import { getServiceCaller } from '@/lib/auth';
import { findAccountByDiscordId, type Account } from '@/lib/betting/accounts';

/**
 * Shared plumbing for `/api/bot/*`.
 *
 * Every one of those routes needs the same two steps — prove the caller is our bot, then resolve
 * which linked account it is acting for — and getting either wrong is a security bug rather than a
 * bug. Writing them once means a new route cannot forget.
 */

/** 401 unless the request carries the bot secret. */
export function requireBot(request: Request): NextResponse | null {
  if (getServiceCaller(request)) return null;
  return NextResponse.json({ ok: false, error: 'Unauthorised.' }, { status: 401 });
}

export type ResolvedCaller = { account: Account } | { error: NextResponse };

/**
 * The account behind a Discord user id.
 *
 * A distinct 404 body for "not linked", because that is the one error the bot should turn into
 * something helpful — "run /link first" — rather than a generic failure the user cannot act on.
 */
export function resolveDiscordAccount(discordUserId: string | null): ResolvedCaller {
  if (!discordUserId) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'discordUserId is required.' },
        { status: 400 },
      ),
    };
  }
  const account = findAccountByDiscordId(discordUserId);
  if (!account) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'not_linked', hint: 'Run /link to connect your Declan Dollars account.' },
        { status: 404 },
      ),
    };
  }
  return { account };
}
