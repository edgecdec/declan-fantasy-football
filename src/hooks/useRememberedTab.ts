'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { safeLocalSet } from '@/services/common/cacheService';

/**
 * The tab a page should open on, remembered across visits.
 *
 * Someone who lives on the Rooting Interest tab during a slate had to click back to it on every
 * navigation, and the auto-refresh made that worse.
 *
 * Uses useSyncExternalStore rather than reading localStorage in an effect and calling setState —
 * the same reasoning as useRememberedUsername, and not a style preference: the React Compiler is
 * enabled here and rejects a synchronous setState inside an effect outright, so the first version
 * of this hook failed the build. `serverSnapshot` renders the default tab, and the client's first
 * commit has the remembered one, which also avoids a hydration mismatch since the server has no
 * localStorage.
 */

/** localStorage is not reactive, so there is nothing to subscribe to; the contract needs a fn. */
const subscribe = () => () => {};

function readTab(storageKey: string, tabCount: number, defaultTab: number): number {
  if (typeof window === 'undefined') return defaultTab;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return defaultTab;
    const stored = Number(raw);
    // Validated against the CURRENT tab count. A stored index from a release with more tabs would
    // otherwise select a tab that no longer exists and render nothing at all.
    return Number.isInteger(stored) && stored >= 0 && stored < tabCount ? stored : defaultTab;
  } catch {
    // Storage blocked or unavailable — the default tab is a fine outcome.
    return defaultTab;
  }
}

export default function useRememberedTab(
  storageKey: string,
  tabCount: number,
  defaultTab = 0,
): [number, (tab: number) => void] {
  const remembered = useSyncExternalStore(
    subscribe,
    () => readTab(storageKey, tabCount, defaultTab),
    () => defaultTab,
  );
  // Null until the reader picks a tab, so the remembered one shows through until then.
  const [chosen, setChosen] = useState<number | null>(null);

  const select = useCallback(
    (next: number) => {
      setChosen(next);
      // safeLocalSet rather than a bare setItem: a full localStorage throws, and that has taken
      // this site down mid-analysis before.
      safeLocalSet(storageKey, String(next));
    },
    [storageKey],
  );

  return [chosen ?? remembered, select];
}
