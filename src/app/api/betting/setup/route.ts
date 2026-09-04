import { NextResponse } from 'next/server';
import { hashPassword, signToken, setTokenCookie } from '@/lib/auth';
import { completeSetup, resolveSetupToken } from '@/lib/betting/accounts';

export const dynamic = 'force-dynamic';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/** GET ?token=… — validate a setup link and tell the form whose account it is. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const account = resolveSetupToken(token);

  if (!account) {
    return NextResponse.json(
      { ok: false, error: 'This setup link is invalid, already used, or expired.' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    username: account.username,
    displayName: account.display_name,
    alreadySetUp: account.password_hash !== null,
  });
}

/** POST { token, password } — set the password, consume the link, sign in. */
export async function POST(request: Request) {
    let body: { token?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request body.' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing setup token.' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const account = completeSetup(token, hashPassword(password));
  if (!account) {
    return NextResponse.json(
      { ok: false, error: 'This setup link is invalid, already used, or expired.' },
      { status: 404 },
    );
  }

  // Sign them straight in — they just proved they hold the link.
  const jwtToken = signToken({
    accountId: account.id,
    username: account.username,
    isAdmin: account.is_admin === 1,
  });

  return NextResponse.json(
    {
      ok: true,
      user: { username: account.username, displayName: account.display_name },
      balanceCents: account.balance_cents,
    },
    { headers: { 'Set-Cookie': setTokenCookie(jwtToken) } },
  );
}
