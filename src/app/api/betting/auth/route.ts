import { NextResponse } from 'next/server';
import {
  clearTokenCookie,
  getAuthUser,
  setTokenCookie,
  signToken,
  verifyPassword,
} from '@/lib/auth';
import { findAccountById, findAccountByUsername } from '@/lib/betting/accounts';

export const dynamic = 'force-dynamic';

const GENERIC_LOGIN_ERROR = 'Incorrect username or password.';

/** GET — session check. */
export async function GET(request: Request) {
  const auth = getAuthUser(request);
  if (!auth) return NextResponse.json({ ok: false, user: null });

  const account = findAccountById(auth.accountId);
  if (!account) return NextResponse.json({ ok: false, user: null });

  return NextResponse.json({
    ok: true,
    user: {
      username: account.username,
      displayName: account.display_name,
      isAdmin: account.is_admin === 1,
    },
  });
}

/** POST { action: 'login', username, password } */
export async function POST(request: Request) {
  let body: { action?: unknown; username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request body.' }, { status: 400 });
  }

  if (body.action !== 'login') {
    return NextResponse.json(
      { ok: false, error: 'Unsupported action. Accounts are created from a setup link.' },
      { status: 400 },
    );
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    return NextResponse.json({ ok: false, error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  const account = findAccountByUsername(username);

  // A not-yet-set-up account gets a specific, actionable message. These are the
  // league's own public Sleeper names, so there is no username enumeration to
  // guard against here — a generic error would just strand people who haven't
  // opened their link yet.
  if (account && account.password_hash === null) {
    return NextResponse.json(
      { ok: false, error: 'This account has not been set up yet — use your setup link.' },
      { status: 403 },
    );
  }

  if (!account || !verifyPassword(password, account.password_hash as string)) {
    return NextResponse.json({ ok: false, error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  const token = signToken({
    accountId: account.id,
    username: account.username,
    isAdmin: account.is_admin === 1,
  });

  return NextResponse.json(
    {
      ok: true,
      user: {
        username: account.username,
        displayName: account.display_name,
        isAdmin: account.is_admin === 1,
      },
    },
    { headers: { 'Set-Cookie': setTokenCookie(token) } },
  );
}

/** DELETE — logout. */
export async function DELETE() {
  return NextResponse.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearTokenCookie() } },
  );
}
