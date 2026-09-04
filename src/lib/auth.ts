import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

/**
 * Session auth for the betting feature.
 *
 * Deliberately fails closed on a missing secret rather than falling back to a
 * committed dev default: a hardcoded fallback means an unset env var silently
 * ships a publicly-known signing key, which anyone could use to mint a session
 * for any account.
 */
const JWT_SECRET = process.env.JWT_SECRET;

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = '7d';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Distinct from other apps' `token` cookie so the two can never be confused. */
export const TOKEN_COOKIE = 'betting_token';

export type AuthUser = {
  accountId: string;
  username: string;
  isAdmin: boolean;
};

function requireSecret(): string {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not set — refusing to sign or verify sessions');
  }
  return JWT_SECRET;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, requireSecret(), { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, requireSecret()) as AuthUser;
  } catch {
    return null;
  }
}

/**
 * Reads the session off a request. Returns null for anonymous callers — every
 * protected handler must check this itself; there is no middleware guard.
 */
export function getAuthUser(request: Request): AuthUser | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== TOKEN_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value ? verifyToken(decodeURIComponent(value)) : null;
  }
  return null;
}

/** `Secure` is set because the site is HTTPS-only. */
export function setTokenCookie(token: string): string {
  return `${TOKEN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearTokenCookie(): string {
  return `${TOKEN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
