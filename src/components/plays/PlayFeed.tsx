'use client';

import * as React from 'react';
import {
  Alert, Box, CircularProgress, Chip, FormControlLabel, Paper, Switch, Tooltip, Typography,
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

/** Enough to cover a full slate's worth of scoring plays without shipping a whole week. */
const FEED_LIMIT = 120;

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
  const [data, setData] = React.useState<FeedResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!username || !season || !week) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        username, season, week: String(week), limit: String(FEED_LIMIT),
        ...(startersOnly ? { startersOnly: '1' } : {}),
        ...(bigPlaysOnly ? { bigPlaysOnly: '1' } : {}),
      });
      const res = await fetch(`/api/plays/feed?${params}`);
      const body: FeedResponse = await res.json();
      if (!body.ok) {
        setError(body.error ?? 'Could not load the feed.');
        setData(null);
      } else {
        setError(null);
        setData(body);
      }
    } catch {
      setError('Could not reach the feed.');
    } finally {
      setLoading(false);
    }
  }, [username, season, week, startersOnly, bigPlaysOnly]);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => {
    const id = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const entries = data?.entries ?? [];

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
              <Stat label="Plays shown" value={String(entries.length)} />
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
              : 'No plays yet involving anyone in your lineups this week.'}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {entries.map(entry => <PlayCard key={entry.playId} entry={entry} />)}
      </Box>

      {/*
        * Said plainly rather than left to be discovered. Sleeper's play feed is offence-only —
        * one full week carried a single sack and no interceptions league-wide — so team
        * defences genuinely cannot appear here, and a reader who does not know that would
        * reasonably conclude the feed is broken.
        */}
      {entries.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          Team defences do not appear: Sleeper&apos;s play feed carries offence only, so DEF
          points come from the periodic stats feed instead. Everything else — QB, RB, WR, TE, K —
          reconciles to the cent against Sleeper&apos;s official totals.
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
