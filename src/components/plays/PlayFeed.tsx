'use client';

import * as React from 'react';
import {
  Alert, Box, Button, CircularProgress, Chip, FormControlLabel, Paper, Switch, Tooltip, Typography,
} from '@mui/material';
import PlayCard from '@/components/plays/PlayCard';
import type { FeedEntry } from '@/services/plays/playFeed';

/**
 * The Zone: live play-by-play, scored in every league you are in at once.
 *
 * The thing Sleeper's own version cannot do is the cross-league view. Sleeper shows one league
 * at a time, so with eighteen leagues open you cannot see that the catch you just watched was
 * +2.6 for you in one league and +2.1 against you in another. That is the reason this exists.
 *
 * Reads only. Capture runs server-side on a cron, because a browser poll multiplies by every
 * open tab and plays cannot be fetched back after the game — so this is a view over what was
 * already banked, and refreshing it costs Sleeper nothing.
 *
 * Takes the season, week and username from its parent rather than owning pickers of its own:
 * it lives as a tab beside the other weekly views, and a tab that could disagree with the page
 * it sits on about which week it is showing would be worse than useless.
 */

/** Matches the poller's cadence; refreshing faster only re-renders the same plays. */
const REFRESH_MS = 30_000;

/**
 * One page. The client keeps what it already has and asks only for what is new.
 *
 * Measured before choosing: a full week is 145 KB, and refetching it every 30 seconds is 146 MB an
 * hour of egress across ten viewers. CPU was never the constraint (0.18s warm to replay 2,630 plays
 * across 18 leagues) — re-sending what the browser already holds was.
 *
 * Held in memory rather than localStorage, deliberately. A 145 KB feed written every 30 seconds is
 * exactly how localStorage fills up, and a full localStorage has taken this site down mid-analysis
 * before. A reload refetches one page, which is cheap.
 */
const PAGE_SIZE = 100;

/** Kept in step with BIG_PLAY_POINTS in the feed route, purely for the label. */
const BIG_PLAY_POINTS = 2;

type FeedResponse = {
  ok: boolean;
  error?: string;
  season?: string;
  week?: number;
  leagues?: { leagueId: string; leagueName: string }[];
  failedLeagues?: string[];
  playsStored?: number;
  latencySeconds?: number | null;
  entries?: FeedEntry[];
  newestSequence?: number | null;
  oldestSequence?: number | null;
  hasMore?: boolean;
  fetchedAt?: string;
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Tooltip title={hint ?? ''} arrow disableHoverListener={!hint}>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
          {label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
      </Box>
    </Tooltip>
  );
}

export default function PlayFeed({
  username, season, week,
}: { username: string; season: string; week: number }) {
  const [startersOnly, setStartersOnly] = React.useState(true);
  // Off by default: the full feed is the thing, and a filter that hides most of it should be a
  // choice rather than the state you arrive in.
  const [bigPlaysOnly, setBigPlaysOnly] = React.useState(false);
  // Also off by default. Most plays touch nobody's roster, and the feed's job is to say what a play
  // was worth to YOU — but for anyone who wants the whole game, it is one switch.
  const [allPlays, setAllPlays] = React.useState(false);

  const [data, setData] = React.useState<FeedResponse | null>(null);
  const [entries, setEntries] = React.useState<FeedEntry[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const query = React.useCallback(
    (extra: Record<string, string>) => new URLSearchParams({
      username, season, week: String(week), limit: String(PAGE_SIZE),
      ...(startersOnly ? { startersOnly: '1' } : {}),
      ...(bigPlaysOnly ? { bigPlaysOnly: '1' } : {}),
      ...(allPlays ? { allPlays: '1' } : {}),
      ...extra,
    }).toString(),
    [username, season, week, startersOnly, bigPlaysOnly, allPlays],
  );

  /** A full first page. Also the reset when a filter changes, since the window shifts. */
  const loadFirstPage = React.useCallback(async () => {
    if (!username || !season || !week) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/plays/feed?${query({})}`);
      const body: FeedResponse = await res.json();
      if (!body.ok) {
        setError(body.error ?? 'Could not load the feed.');
        setData(null);
        setEntries([]);
      } else {
        setError(null);
        setData(body);
        setEntries(body.entries ?? []);
        setHasMore(Boolean(body.hasMore));
      }
    } catch {
      setError('Could not reach the feed.');
    } finally {
      setLoading(false);
    }
  }, [username, season, week, query]);

  /**
   * Just the plays that arrived since the newest one held.
   *
   * The whole point of the cursor: a poll that finds nothing new sends back an empty list instead of
   * 145 KB the browser already has. Dedupe on play_id anyway — a correction can rewrite a play we
   * already hold, and it must replace rather than duplicate.
   */
  const pollNew = React.useCallback(async () => {
    if (!username || !season || !week) return;
    const newest = entries[0]?.sequence;
    if (newest == null) { void loadFirstPage(); return; }
    try {
      const res = await fetch(`/api/plays/feed?${query({ after: String(newest) })}`);
      const body: FeedResponse = await res.json();
      if (!body.ok) return;
      setData(prev => ({ ...(prev ?? {}), ...body, entries: undefined }));
      const fresh = body.entries ?? [];
      if (fresh.length === 0) return;
      setEntries(prev => {
        const seen = new Set(fresh.map(e => e.playId));
        return [...fresh, ...prev.filter(e => !seen.has(e.playId))];
      });
    } catch {
      // A failed poll leaves what is already on screen alone.
    }
  }, [username, season, week, query, entries, loadFirstPage]);

  /** One page further back, for scrolling. */
  const loadOlder = React.useCallback(async () => {
    if (!hasMore || loadingMore) return;
    const oldest = entries[entries.length - 1]?.sequence;
    if (oldest == null) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/plays/feed?${query({ before: String(oldest) })}`);
      const body: FeedResponse = await res.json();
      if (!body.ok) return;
      const older = body.entries ?? [];
      setEntries(prev => {
        const seen = new Set(prev.map(e => e.playId));
        return [...prev, ...older.filter(e => !seen.has(e.playId))];
      });
      setHasMore(Boolean(body.hasMore));
    } catch {
      // Leave the list as it is; the sentinel will retry when it scrolls back into view.
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, entries, query]);

  // A filter change shifts the window, so the held page no longer describes the request.
  React.useEffect(() => { void loadFirstPage(); }, [loadFirstPage]);

  React.useEffect(() => {
    const id = setInterval(() => { void pollNew(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [pollNew]);

  /** Loads the next page when the bottom sentinel scrolls into view. */
  const sentinel = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      es => { if (es.some(e => e.isIntersecting)) void loadOlder(); },
      // A little early, so the next page is usually there before the reader reaches the end.
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadOlder]);

  const latency = data?.latencySeconds;

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Tooltip
            title="Off also shows plays by players on the bench, whose points do not count."
            arrow
          >
            <FormControlLabel
              control={<Switch checked={startersOnly} onChange={e => setStartersOnly(e.target.checked)} />}
              label="Starters only"
            />
          </Tooltip>
          <Tooltip
            title={
              `Only plays worth ${BIG_PLAY_POINTS}+ points to someone, in some league. Measured on `
              + 'the largest swing either way, so a fumble or an interception counts as a big play.'
            }
            arrow
          >
            <FormControlLabel
              control={<Switch checked={bigPlaysOnly} onChange={e => setBigPlaysOnly(e.target.checked)} />}
              label="Big plays only"
            />
          </Tooltip>
          <Tooltip
            title="Includes every play of every game, even ones involving nobody in any of your lineups. A full NFL play-by-play with your points annotated where they apply."
            arrow
          >
            <FormControlLabel
              control={<Switch checked={allPlays} onChange={e => setAllPlays(e.target.checked)} />}
              label="Every play"
            />
          </Tooltip>
          {/*
            * There is deliberately no "only plays in my matchups" control.
            *
            * There used to be, and it was dead: the feed only ever contains players on your
            * roster or your opponents', in every league, so with "starters only" on it hid
            * exactly zero of 225 real plays. Measured, not assumed. The scope note below says
            * what the feed already is, which is what that toggle was really trying to express.
            */}
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 320 }}>
            Every play involving your starters or the ones you&apos;re playing against, across all
            your leagues. A blue edge means one of yours.
          </Typography>
          <Box sx={{ flex: 1 }} />
          {data?.ok && (
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <Stat label="Leagues" value={String(data.leagues?.length ?? 0)} />
              <Stat
                label="Plays captured"
                value={(data.playsStored ?? 0).toLocaleString()}
                hint="Plays banked for this week. Capture runs server-side; a play not stored while the game was on cannot be fetched back."
              />
              <Stat
                label="Feed lag"
                value={latency == null ? '—' : `${Math.round(latency)}s`}
                hint="Median gap between a play's own timestamp and when we first saw it. The number that says whether live capture is keeping up."
              />
              <Stat
                label="Plays shown"
                value={hasMore ? `${entries.length}+` : String(entries.length)}
                hint="Loaded so far. Scroll for more — the page holds what it has and asks only for what is new."
              />
              {loading && <CircularProgress size={16} sx={{ mt: 1 }} />}
            </Box>
          )}
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {data?.failedLeagues && data.failedLeagues.length > 0 && (
        // Named rather than silently dropped: a missing league looks identical to a league
        // where nothing happened, and the difference matters.
        <Alert severity="warning" sx={{ mb: 2 }}>
          Could not load {data.failedLeagues.join(', ')} — plays in{' '}
          {data.failedLeagues.length === 1 ? 'it' : 'them'} are missing from this feed.
        </Alert>
      )}

      {!loading && data?.ok && entries.length === 0 && (
        <Alert severity="info">
          {(data.playsStored ?? 0) === 0
            ? 'No plays captured for this week yet. The feed fills in once games kick off.'
            : bigPlaysOnly
              ? `No plays worth ${BIG_PLAY_POINTS}+ points yet. Turn off "big plays only" to see everything.`
              : allPlays
                ? 'No plays captured for this week yet.'
                : 'No plays yet involving anyone in your lineups this week. Turn on "every play" for the whole game.'}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {entries.map(entry => <PlayCard key={entry.playId} entry={entry} />)}
      </Box>

      {/*
        * The scroll target. A button as well as the observer, because an observer that never fires
        * — a short viewport, a browser without it — would strand the reader with no way to load more.
        */}
      {hasMore && (
        <Box ref={sentinel} sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <Button size="small" onClick={() => { void loadOlder(); }} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load earlier plays'}
          </Button>
        </Box>
      )}

      {/*
        * Said plainly rather than left to be discovered. Sleeper's play feed is offence-only —
        * one full week carried a single sack and no interceptions league-wide — so team
        * defences genuinely cannot appear here, and a reader who does not know that would
        * reasonably conclude the feed is broken.
        */}
      {entries.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          The smaller figure on each chip is that player&apos;s running total for the week in that
          league, as of this play. Sleeper&apos;s play feed carries offence only, so team defences
          do not appear at all and an IDP league&apos;s defensive points are missing from these
          totals. For QB, RB, WR, TE and K they reconcile to the cent against Sleeper&apos;s
          official numbers — measured at 132 of 134 player-league totals, with both exceptions in
          the one IDP league.
        </Typography>
      )}

      {data?.fetchedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Updated {new Date(data.fetchedAt).toLocaleTimeString()} · refreshes every{' '}
          {REFRESH_MS / 1000}s{' · '}
          <Chip size="small" label="newest first" sx={{ height: 16, fontSize: '0.62rem' }} />
        </Typography>
      )}
    </Box>
  );
}
