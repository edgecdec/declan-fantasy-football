'use client';

import * as React from 'react';

/**
 * The betting session — a real, server-signed identity, deliberately separate
 * from UserContext.
 *
 * UserContext holds a Sleeper username typed into a box and cached in
 * localStorage; it exists so the analytics pages can look up ANY manager, and it
 * is forgeable by design. Money cannot ride on that, so betting keeps its own
 * httpOnly-cookie session and never reads from UserContext. The two are never
 * synced, and /betting always labels which account it is acting as.
 */

export type BettingUser = {
  username: string;
  displayName: string;
  isAdmin: boolean;
};

export type BettingLeagueRef = {
  leagueId: string;
  season: string;
  label: string;
};

export type LedgerRow = {
  id: string;
  amountCents: number;
  reason: string;
  createdAt: string;
};

type BettingAuthState = {
  user: BettingUser | null;
  balanceCents: number;
  leagues: BettingLeagueRef[];
  ledger: LedgerRow[];
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const BettingAuthContext = React.createContext<BettingAuthState | undefined>(undefined);

/**
 * Cached hint about who was signed in last, so the nav can render the Declan
 * Dollars entry immediately on load instead of popping in a moment later.
 *
 * This is NOT authentication. The only credential is the httpOnly cookie, which
 * the browser sends and JavaScript cannot read or forge. Faking this key gets you
 * a nav link and nothing else — every /api/betting handler still verifies the
 * cookie, so a stale or tampered hint just lands you on the sign-in panel.
 */
const SESSION_HINT_KEY = 'declanalytics_betting_session_hint';

function readSessionHint(): BettingUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_HINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.username === 'string' ? (parsed as BettingUser) : null;
  } catch {
    return null;
  }
}

function writeSessionHint(user: BettingUser | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (user) localStorage.setItem(SESSION_HINT_KEY, JSON.stringify(user));
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Storage full or blocked — the cookie still works, we just lose the hint.
  }
}

export function BettingAuthProvider({ children }: { children: React.ReactNode }) {
  // Seeded from the hint so a reload doesn't flash the nav item away.
  const [user, setUser] = React.useState<BettingUser | null>(null);
  const [balanceCents, setBalanceCents] = React.useState(0);
  const [leagues, setLeagues] = React.useState<BettingLeagueRef[]>([]);
  const [ledger, setLedger] = React.useState<LedgerRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Read after mount, not in the initial state, so the server-rendered markup and
  // the first client render agree and hydration doesn't mismatch.
  React.useEffect(() => {
    const hint = readSessionHint();
    if (hint) setUser(hint);
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch('/api/betting/me', { credentials: 'same-origin' });
      if (!res.ok) {
        // 401 is the normal anonymous case, not an error worth surfacing. Clear
        // the hint too, or the nav would keep advertising a dead session.
        setUser(null);
        setBalanceCents(0);
        setLeagues([]);
        setLedger([]);
        writeSessionHint(null);
        return;
      }
      const data = await res.json();
      setUser(data.user);
      setBalanceCents(data.balanceCents ?? 0);
      setLeagues(data.leagues ?? []);
      setLedger(data.ledger ?? []);
      writeSessionHint(data.user ?? null);
    } catch {
      // A network blip is not proof of sign-out, so keep the hint and leave the
      // cookie to decide on the next successful call.
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const login = React.useCallback(async (username: string, password: string) => {
    setError(null);
    const res = await fetch('/api/betting/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ action: 'login', username, password }),
    });
    const data = await res.json().catch(() => ({ error: 'Unexpected response.' }));
    if (!res.ok) {
      setError(data.error ?? 'Sign in failed.');
      throw new Error(data.error ?? 'Sign in failed.');
    }
    await refresh();
  }, [refresh]);

  const logout = React.useCallback(async () => {
    await fetch('/api/betting/auth', { method: 'DELETE', credentials: 'same-origin' });
    setUser(null);
    setBalanceCents(0);
    setLeagues([]);
    setLedger([]);
    writeSessionHint(null);
  }, []);

  const value = React.useMemo(
    () => ({ user, balanceCents, leagues, ledger, loading, error, login, logout, refresh }),
    [user, balanceCents, leagues, ledger, loading, error, login, logout, refresh],
  );

  return <BettingAuthContext.Provider value={value}>{children}</BettingAuthContext.Provider>;
}

export function useBettingAuth(): BettingAuthState {
  const ctx = React.useContext(BettingAuthContext);
  if (!ctx) throw new Error('useBettingAuth must be used within a BettingAuthProvider');
  return ctx;
}
