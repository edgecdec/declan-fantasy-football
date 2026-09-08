'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SeasonDefaultMode,
  buildSeasonRange,
  getNflStateOrFallback,
  resolveSeasonSelection,
} from '@/services/common/seasonService';
import { safeLocalSet } from '@/services/common/cacheService';

/**
 * Remembered season selections, keyed by mode.
 *
 * Per mode rather than one global year on purpose: the modes exist precisely because
 * pages flip to a new season at different times (a results page should not jump to a
 * season with no games played just because the draft page did), so sharing one value
 * across them would defeat that.
 */
const STORAGE_PREFIX = 'declanalytics_season_';

/**
 * A stored choice records which season was CURRENT when it was made, so it can be
 * discarded once the calendar moves on. Without that, picking 2025 once would pin a page
 * to 2025 forever, including after 2026 started.
 */
type StoredSeason = { season: string; pickedWhenCurrent: string };

function readStored(mode: SeasonDefaultMode): StoredSeason | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + mode);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.season === 'string' && typeof parsed?.pickedWhenCurrent === 'string') {
      return parsed as StoredSeason;
    }
  } catch {
    // Unparseable: treat as nothing stored.
  }
  return null;
}

type UseSeasonResult = {
  /** Currently selected season. Seeded from Sleeper, then user-controlled. */
  season: string;
  /** Select a different season. Any season in `seasons` is valid. */
  setSeason: (season: string) => void;
  /** Every selectable season, newest first. */
  seasons: string[];
  /** True until Sleeper's calendar state resolves. */
  loading: boolean;
};

/**
 * Seeds a page's season from Sleeper's calendar rather than a hardcoded year,
 * using the flip rule for `mode` (see SeasonDefaultMode).
 *
 * Renders once with an empty season while state is in flight; callers should
 * treat `loading` as "don't fetch yet" so they don't fire a request against the
 * wrong year and then immediately refire against the right one.
 *
 * Once the user picks a season we stop tracking Sleeper's default — their choice wins,
 * and is remembered across navigation and reloads so moving between pages does not reset
 * the year. A remembered choice is dropped once Sleeper's current season advances past
 * the one it was made in, or if it falls outside the selectable range.
 */
export default function useSeason(mode: SeasonDefaultMode): UseSeasonResult {
  const [season, setSeasonState] = useState('');
  const [currentSeason, setCurrentSeason] = useState('');
  const [userPicked, setUserPicked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Read what was remembered, but do not apply it yet: it has to be validated against
    // Sleeper's calendar first, and callers gate rendering on `loading` anyway, so there
    // is nothing on screen to flash. (Applying it here also trips the react-hooks rule
    // against synchronous setState in an effect, for the same reason — it would be a
    // wasted extra render.)
    const stored = readStored(mode);

    getNflStateOrFallback()
      .then((state) => {
        if (!mounted) return;
        setCurrentSeason(state.season);
        // Don't clobber a selection the user made while state was in flight.
        if (userPicked) return;

        const { season: chosen, dropRemembered } = resolveSeasonSelection(stored, state, mode);
        if (dropRemembered) {
          // Drop it rather than leaving a value that will be rejected on every visit.
          try {
            localStorage.removeItem(STORAGE_PREFIX + mode);
          } catch {
            // Nothing to do; the staleness check rejects it again next time.
          }
        }
        setSeasonState(chosen);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
    // `userPicked` is deliberately omitted: this should run once per mode, and
    // re-running it after a user selection would re-seed the default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const setSeason = useCallback((next: string) => {
    setUserPicked(true);
    setSeasonState(next);
    // Only an explicit choice is remembered. Seeding from Sleeper's default must not be
    // written back, or the default would freeze the first time any page loaded.
    if (currentSeason) {
      safeLocalSet(
        STORAGE_PREFIX + mode,
        JSON.stringify({ season: next, pickedWhenCurrent: currentSeason } satisfies StoredSeason),
      );
    }
  }, [mode, currentSeason]);

  const seasons = useMemo(
    () => (currentSeason ? buildSeasonRange(currentSeason) : []),
    [currentSeason]
  );

  return { season, setSeason, seasons, loading };
}
