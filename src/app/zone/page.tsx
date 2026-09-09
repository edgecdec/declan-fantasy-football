'use client';

import * as React from 'react';
import {
  Alert, Box, Chip, CircularProgress, Container, FormControlLabel, MenuItem, Paper,
  Select, Switch, Tooltip, Typography,
} from '@mui/material';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';
import PlayCard from '@/components/plays/PlayCard';
import useRememberedUsername from '@/hooks/useRememberedUsername';
import { getNflStateOrFallback } from '@/services/common/seasonService';
import type { FeedEntry } from '@/services/plays/playFeed';

/**
 * The Zone: live play-by-play, scored in every league you are in at once.
 *
 * The thing Sleeper's own version cannot do is the cross-league view. Sleeper shows you one
 * league at a time, so with eighteen leagues open you cannot see that the catch you just
 * watched was +2.6 for you in one league and +2.1 against you in another. That is the whole
 * reason this exists.
 *
 * Reads only. Capture runs server-side on a cron, because a browser poll multiplies by every
 * open tab and plays cannot be fetched back after the game — so the page is a view over what
 * was already banked, and refreshing it costs Sleeper nothing.
 */

/** Matches the poller's cadence; refreshing faster only re-renders the same plays. */
const REFRESH_MS = 30_000;

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

export default function ZonePage() {
  const { username, setUsername, remember } = useRememberedUsername();
  const [season, setSeason] = React.useState('');
  const [week, setWeek] = React.useState<number | null>(null);
  const [weeks, setWeeks] = React.useState<number[]>([]);
  const [startersOnly, setStartersOnly] = React.useState(true);
  const [yoursOnly, setYoursOnly] = React.useState(false);
  const [data, setData] = React.useState<FeedResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getNflStateOrFallback().then(state => {
      if (cancelled) return;
      setSeason(String(state.season));
      setWeek(state.week);
      setWeeks(Array.from({ length: Math.max(1, state.week) }, (_, i) => i + 1));
    });
    return () => { cancelled = true; };
  }, []);

  const load = React.useCallback(async () => {
    if (!username || !season || !week) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        username, season, week: String(week), limit: '120',
        ...(startersOnly ? { startersOnly: '1' } : {}),
      });
      const res = await fetch(`/api/plays/feed?${params}`);
      const body: FeedResponse = await res.json();
      if (!body.ok) {
        setError(body.error ?? 'Could not load the feed.');
        setData(null);
      } else {
        setError(null);
        setData(body);
        remember(username);
      }
    } catch {
      setError('Could not reach the feed.');
    } finally {
      setLoading(false);
    }
  }, [username, season, week, startersOnly, remember]);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => {
    const id = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const entries = React.useMemo(() => {
    const all = data?.entries ?? [];
    return yoursOnly ? all.filter(e => e.touchesYou) : all;
  }, [data, yoursOnly]);

  const latency = data?.latencySeconds;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <PageHeader
        title="The Zone"
        subtitle="Every play, scored in every league you're in — what it was worth to you, and to whoever you're playing."
      />

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box sx={{ minWidth: 240, flex: 1 }}>
            <UserSearchInput username={username} setUsername={setUsername} disabled={loading} />
          </Box>
          <Select
            size="small"
            value={week ?? ''}
            onChange={e => setWeek(Number(e.target.value))}
            disabled={weeks.length === 0}
            sx={{ height: 56, minWidth: 120 }}
          >
            {weeks.map(w => <MenuItem key={w} value={w}>Week {w}</MenuItem>)}
          </Select>
          <FormControlLabel
            control={<Switch checked={startersOnly} onChange={e => setStartersOnly(e.target.checked)} />}
            label="Starters only"
          />
          <FormControlLabel
            control={<Switch checked={yoursOnly} onChange={e => setYoursOnly(e.target.checked)} />}
            label="Only plays in my matchups"
          />
        </Box>

        {data?.ok && (
          <Box sx={{ display: 'flex', gap: 3, mt: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Stat label="Leagues" value={String(data.leagues?.length ?? 0)} />
            <Stat
              label="Plays captured"
              value={(data.playsStored ?? 0).toLocaleString()}
              hint="Plays banked for this week. Capture runs server-side; a play not stored while the game was on cannot be fetched back."
            />
            <Stat
              label="Feed lag"
              value={latency == null ? '—' : `${Math.round(latency)}s`}
              hint="Median gap between a play's own timestamp and when we first saw it. The number that says whether live capture is actually keeping up."
            />
            <Stat label="Plays shown" value={String(entries.length)} />
            {loading && <CircularProgress size={16} sx={{ mt: 1 }} />}
          </Box>
        )}
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {data?.failedLeagues && data.failedLeagues.length > 0 && (
        // Named rather than silently dropped: a missing league looks identical to a league
        // where nothing happened, and the difference matters.
        <Alert severity="warning" sx={{ mb: 2 }}>
          Could not load {data.failedLeagues.join(', ')} — plays in {data.failedLeagues.length === 1 ? 'it' : 'them'} are missing from this feed.
        </Alert>
      )}

      {!loading && data?.ok && entries.length === 0 && (
        <Alert severity="info">
          {(data.playsStored ?? 0) === 0
            ? 'No plays captured for this week yet. The feed fills in once games kick off.'
            : 'No plays yet involving anyone in your lineups this week.'}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {entries.map(entry => <PlayCard key={entry.playId} entry={entry} />)}
      </Box>

      {data?.fetchedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          Updated {new Date(data.fetchedAt).toLocaleTimeString()} · refreshes every {REFRESH_MS / 1000}s
          {' · '}
          <Chip
            size="small"
            label="newest first"
            sx={{ height: 16, fontSize: '0.62rem' }}
          />
        </Typography>
      )}
    </Container>
  );
}
