'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SeasonDefaultMode,
  buildSeasonRange,
  getNflStateOrFallback,
  resolveDefaultSeason,
} from '@/services/common/seasonService';

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
 * Once the user picks a season we stop tracking Sleeper's default — their choice
 * wins for the rest of the visit.
 */
export default function useSeason(mode: SeasonDefaultMode): UseSeasonResult {
  const [season, setSeasonState] = useState('');
  const [currentSeason, setCurrentSeason] = useState('');
  const [userPicked, setUserPicked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    getNflStateOrFallback()
      .then((state) => {
        if (!mounted) return;
        setCurrentSeason(state.season);
        // Don't clobber a selection the user made while state was in flight.
        if (!userPicked) setSeasonState(resolveDefaultSeason(state, mode));
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
  }, []);

  const seasons = useMemo(
    () => (currentSeason ? buildSeasonRange(currentSeason) : []),
    [currentSeason]
  );

  return { season, setSeason, seasons, loading };
}
