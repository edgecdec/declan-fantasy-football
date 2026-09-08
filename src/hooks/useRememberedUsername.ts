'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { safeLocalSet } from '@/services/common/cacheService';

const ACTIVE_KEY = 'sleeper_active_user';
const HISTORY_KEY = 'sleeper_usernames';

/**
 * The username a page should start with, remembered across navigation.
 *
 * Eight pages had their own copy of "read sleeper_usernames, JSON.parse it, take [0]",
 * and several ALSO read the active user, so which name a page opened with depended on
 * which of the two it happened to consult. The active user is the better source — it is
 * the one that was actually looked up — with the history as a fallback for a first visit
 * before any lookup has succeeded.
 *
 * Reads after mount rather than in the initial state so the server-rendered markup and
 * the first client render agree; seeding from localStorage during render would hydrate
 * mismatched.
 */
export function readRememberedUsername(): string {
  if (typeof window === 'undefined') return '';
  try {
    const active = localStorage.getItem(ACTIVE_KEY);
    if (active) {
      const parsed = JSON.parse(active);
      if (typeof parsed?.username === 'string' && parsed.username) return parsed.username;
    }
  } catch {
    // fall through to history
  }
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  } catch {
    // nothing remembered
  }
  return '';
}

/**
 * Records a username as the most recent, so the next page opens with it.
 *
 * Call this when a lookup actually succeeds, not on every keystroke — UserSearchInput
 * fires `onInputChange` per character, and persisting that would leave a half-typed name
 * as the remembered one.
 */
export function rememberUsername(username: string): void {
  const name = username.trim();
  if (!name) return;
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    const history: string[] = Array.isArray(raw)
      ? raw.filter((n): n is string => typeof n === 'string')
      : [];
    safeLocalSet(HISTORY_KEY, JSON.stringify([name, ...history.filter(n => n !== name)].slice(0, 5)));
  } catch {
    safeLocalSet(HISTORY_KEY, JSON.stringify([name]));
  }
}

/**
 * localStorage is not a reactive store, so there is nothing to subscribe to. The
 * subscribe function exists only to satisfy useSyncExternalStore's contract.
 */
const subscribe = () => () => {};
const serverSnapshot = () => '';

/**
 * Page-level username state, seeded from whatever was last used.
 *
 * Returns the same shape a page already keeps in local state, so adopting it is a one-line
 * change at each call site.
 *
 * Uses useSyncExternalStore rather than reading localStorage in an effect and calling
 * setState. Two reasons, and the second is the real one: setState synchronously inside an
 * effect causes a second render pass for a value that was available all along (and React's
 * lint rule rightly objects), and more importantly the server has no localStorage, so
 * seeding during render without a declared server snapshot hydrates mismatched. This is the
 * primitive built for exactly that: `serverSnapshot` renders empty, the client's first
 * commit has the remembered name.
 */
export default function useRememberedUsername(): {
  username: string;
  setUsername: (name: string) => void;
  /** Persist this name as the most recent. Call on a successful lookup. */
  remember: (name?: string) => void;
} {
  const remembered = useSyncExternalStore(subscribe, readRememberedUsername, serverSnapshot);
  // Null until the user edits the field, so the remembered value shows through until then
  // and an empty string they typed deliberately is still respected afterwards.
  const [typed, setTyped] = useState<string | null>(null);
  const username = typed ?? remembered;

  const setUsername = useCallback((name: string) => setTyped(name), []);

  const remember = useCallback((name?: string) => {
    rememberUsername(name ?? username);
  }, [username]);

  return { username, setUsername, remember };
}
