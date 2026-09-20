import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import {
  findAccountByDiscordId,
  findAccountByUsername,
  setDiscordId,
} from '@/lib/betting/accounts';

export const dynamic = 'force-dynamic';

/**
 * Maps a Discord user to a Declan Dollars account, or unmaps one.
 *
 * ADMIN-DRIVEN for now, and the admin check lives in the BOT (`DISCORD_ADMIN_IDS`) rather than
 * here. That is deliberate: the bot secret is already the trust boundary for this API — anything
 * holding it can place bets — so a second authorisation layer at this route would be theatre. What
 * would be wrong is exposing this to a browser session, which is why it is under /api/bot and
 * guarded by the service secret alone.
 *
 * Self-serve linking is a follow-up, not an oversight. The obvious route — reuse `setup_tokens` —
 * is wrong, because that flow SETS A PASSWORD, and nobody should have to reset their password to
 * connect Discord. Doing it properly needs a short-lived code issued to an already-signed-in user
 * on the site, which is its own small flow. With seventeen known accounts and an admin who is in
 * the server, this covers the real need meanwhile.
 */
export async function POST(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;

  let body: { discordUserId?: string; username?: string; unlink?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected a JSON body.' }, { status: 400 });
  }

  const discordUserId = body.discordUserId?.trim();
  if (!discordUserId) {
    return NextResponse.json({ ok: false, error: 'discordUserId is required.' }, { status: 400 });
  }

  if (body.unlink) {
    const existing = findAccountByDiscordId(discordUserId);
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'That Discord user is not linked.' }, { status: 404 });
    }
    setDiscordId(existing.id, null);
    return NextResponse.json({ ok: true, unlinked: existing.username });
  }

  const username = body.username?.trim();
  if (!username) {
    return NextResponse.json({ ok: false, error: 'username is required.' }, { status: 400 });
  }
  const account = findAccountByUsername(username);
  if (!account) {
    return NextResponse.json({ ok: false, error: `No account "${username}".` }, { status: 404 });
  }

  // setDiscordId clears the id off any other account first, so re-linking somebody who already had
  // a different account cannot fail on the unique index or leave two rows pointing at one person.
  setDiscordId(account.id, discordUserId);
  return NextResponse.json({
    ok: true,
    linked: { username: account.username, displayName: account.display_name, discordUserId },
  });
}

/** Who is this Discord user? Backs /admin whois. */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;

  const discordUserId = new URL(request.url).searchParams.get('discordUserId')?.trim();
  if (!discordUserId) {
    return NextResponse.json({ ok: false, error: 'discordUserId is required.' }, { status: 400 });
  }
  const account = findAccountByDiscordId(discordUserId);
  if (!account) return NextResponse.json({ ok: true, linked: null });
  return NextResponse.json({
    ok: true,
    linked: { username: account.username, displayName: account.display_name },
  });
}
