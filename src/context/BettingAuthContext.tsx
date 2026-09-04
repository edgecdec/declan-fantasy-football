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

export function BettingAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<BettingUser | null>(null);
  const [balanceCents, setBalanceCents] = React.useState(0);
  const [leagues, setLeagues] = React.useState<BettingLeagueRef[]>([]);
  const [ledger, setLedger] = React.useState<LedgerRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch('/api/betting/me', { credentials: 'same-origin' });
      if (!res.ok) {
        // 401 is the normal anonymous case, not an error worth surfacing.
        setUser(null);
        setBalanceCents(0);
        setLeagues([]);
        setLedger([]);
        return;
      }
      const data = await res.json();
      setUser(data.user);
      setBalanceCents(data.balanceCents ?? 0);
      setLeagues(data.leagues ?? []);
      setLedger(data.ledger ?? []);
    } catch {
      setUser(null);
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
