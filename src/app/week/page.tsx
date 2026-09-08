'use client';

import * as React from 'react';
import {
  Alert, Box, Button, Chip, Container, Divider, LinearProgress, MenuItem, Paper, Select,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tab, Tabs, Tooltip,
  Typography,
} from '@mui/material';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';
import MatchupMeter from '@/components/betting/MatchupMeter';
import NetLeaguesBar from '@/components/week/NetLeaguesBar';
import useRememberedUsername from '@/hooks/useRememberedUsername';
import { useUser } from '@/context/UserContext';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { getNflStateOrFallback } from '@/services/common/seasonService';
import { RootingRow, WeeklyOutlook, buildWeeklyOutlook } from '@/services/week/weeklyOutlook';

/** Live pages refresh on the same cadence the NFL scoreboard proxy revalidates. */
const REFRESH_MS = 30_000;

const STATUS_LABEL: Record<string, { label: string; color: 'default' | 'success' | 'warning' }> = {
  not_started: { label: 'Not started', color: 'default' },
  live: { label: 'Live', color: 'success' },
  final: { label: 'Final', color: 'warning' },
};

function MatchupsView({ data }: { data: WeeklyOutlook }) {
  if (data.matchups.length === 0) {
    return <Alert severity="info">No head-to-head matchups found for week {data.week}.</Alert>;
  }
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>League</TableCell>
            <TableCell align="right">You</TableCell>
            <TableCell align="right">Opponent</TableCell>
            <TableCell sx={{ minWidth: 180 }}>Win probability</TableCell>
            <TableCell align="right">
              <Tooltip title="Projected final score, counting points already banked plus what the remaining starters are expected to add">
                <span>Projected</span>
              </Tooltip>
            </TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.matchups.map(m => {
            const status = STATUS_LABEL[m.status] ?? STATUS_LABEL.not_started;
            const opp = m.opponent;
            return (
              <TableRow key={m.leagueId} hover>
                <TableCell sx={{ maxWidth: 220 }}>
                  <Typography variant="body2" noWrap title={m.leagueName}>{m.leagueName}</Typography>
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {m.me.distribution.banked.toFixed(1)}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                  {opp ? `${opp.distribution.banked.toFixed(1)} · ${opp.displayName}` : '—'}
                </TableCell>
                <TableCell sx={{ py: 0.5 }}>
                  {opp ? (
                    <>
                      <MatchupMeter
                        probA={m.winProbability}
                        nameA="You"
                        nameB={opp.displayName}
                        muted={m.status === 'final'}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {(m.winProbability * 100).toFixed(0)}% to win
                        {m.status !== 'final' && ` · ${Math.round(m.remainingMinutes)} min of game left`}
                      </Typography>
                    </>
                  ) : '—'}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                  {m.me.distribution.mean.toFixed(1)}
                  {opp && ` – ${opp.distribution.mean.toFixed(1)}`}
                </TableCell>
                <TableCell>
                  <Chip label={status.label} color={status.color} size="small" variant="outlined" />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function RootingView({ rows }: { rows: RootingRow[] }) {
  const [showAll, setShowAll] = React.useState(false);
  if (rows.length === 0) {
    return (
      <Alert severity="info">
        Nothing left to root for — every matchup this week is already decided, or no games remain.
      </Alert>
    );
  }
  const maxNet = Math.max(1, ...rows.map(r => Math.abs(r.netLeagues)));
  const shown = showAll ? rows : rows.slice(0, 40);

  return (
    <>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Player</TableCell>
              <TableCell align="center">
                <Tooltip title="Leagues starting him FOR you minus leagues starting him AGAINST you. +2 means two more of your matchups want him to go off than want him to disappear.">
                  <span>Net +/&minus;</span>
                </Tooltip>
              </TableCell>
              <TableCell sx={{ width: 120 }} />
              <TableCell align="center">For / Against</TableCell>
              <TableCell align="right">
                <Tooltip title="Expected wins riding on this player across all your leagues, weighting each matchup by how close it actually is. A blowout barely counts; a coin flip counts a lot. Can exceed 1.0 when he is in several of your lineups.">
                  <span>Wins at stake</span>
                </Tooltip>
              </TableCell>
              <TableCell>Leagues</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map(r => {
              return (
                <TableRow key={r.playerId} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>{r.name}</Typography>
                    {r.position && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>{r.position}</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {r.netLeagues > 0 ? `+${r.netLeagues}` : r.netLeagues}
                  </TableCell>
                  <TableCell sx={{ py: 0 }}>
                    <NetLeaguesBar
                      net={r.netLeagues}
                      max={maxNet}
                      label={`${r.forLeagues.length} for, ${r.againstLeagues.length} against`}
                    />
                  </TableCell>
                  <TableCell align="center" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {r.forLeagues.length} / {r.againstLeagues.length}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
                      {/* Expected wins, not a probability — summed across leagues it can
                          exceed 1.0, so a percentage would read as nonsense. */}
                      {r.netSwing > 0 ? '+' : ''}{r.netSwing.toFixed(2)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography variant="caption" color="text.secondary" noWrap
                      title={[
                        r.forLeagues.length ? `For: ${r.forLeagues.join(', ')}` : '',
                        r.againstLeagues.length ? `Against: ${r.againstLeagues.join(', ')}` : '',
                      ].filter(Boolean).join(' | ')}>
                      {r.forLeagues.length > 0 && `▲ ${r.forLeagues.join(', ')}`}
                      {r.forLeagues.length > 0 && r.againstLeagues.length > 0 && '  '}
                      {r.againstLeagues.length > 0 && `▼ ${r.againstLeagues.join(', ')}`}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {rows.length > shown.length && (
        <Button size="small" sx={{ mt: 1 }} onClick={() => setShowAll(true)}>
          Show all {rows.length} players
        </Button>
      )}
      <Alert severity="info" sx={{ mt: 2 }}>
        <strong>Net +/&minus; counts leagues; wins-at-stake weights them.</strong> They can
        disagree, and when they do the weighted number is the better guide: a player you are
        +2 on across two matchups already decided matters less than one you are &minus;1 on in
        a coin flip. Wins at stake is a count of expected wins, not a percentage, so it goes
        above 1.00 for someone in several of your lineups. Only players whose NFL game has not
        finished appear, so this list empties out as the slate does.
      </Alert>
    </>
  );
}

export default function WeekPage() {
  const { username, setUsername, remember } = useRememberedUsername();
  const { fetchUser } = useUser();
  const [week, setWeek] = React.useState<number | null>(null);
  const [season, setSeason] = React.useState('');
  const [weeks, setWeeks] = React.useState<number[]>([]);
  const [data, setData] = React.useState<WeeklyOutlook | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState(0);
  const [updatedAt, setUpdatedAt] = React.useState<string>('');

  // Seed the season and the week being played from Sleeper's own calendar.
  React.useEffect(() => {
    getNflStateOrFallback().then(state => {
      setSeason(state.season);
      setWeek(prev => prev ?? Math.max(1, state.week));
      // Offer every week up to the one in progress; later weeks have no lineups set yet.
      setWeeks(Array.from({ length: Math.max(1, state.week) }, (_, i) => i + 1));
    });
  }, []);

  const load = React.useCallback(async (name: string, seasonArg: string, weekArg: number) => {
    setError(null);
    setLoading(true);
    try {
      const user = await SleeperService.getUser(name);
      if (!user) throw new Error(`No Sleeper user "${name}"`);
      remember(name);
      fetchUser(name).catch(() => { /* the header's copy is best-effort */ });
      const outlook = await buildWeeklyOutlook(user.user_id, seasonArg, weekArg);
      setData(outlook);
      setUpdatedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this week.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [remember, fetchUser]);

  // Poll while a slate is in progress. Stops once nothing is live, so a finished week does
  // not keep hitting Sleeper for an answer that cannot change.
  const anyLive = data?.matchups.some(m => m.status !== 'final') ?? false;
  React.useEffect(() => {
    if (!data || !anyLive || !username || !season || !week) return;
    const id = setInterval(() => { load(username, season, week); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [data, anyLive, username, season, week, load]);

  const expectedWins = data
    ? data.matchups.reduce((s, m) => s + m.winProbability, 0)
    : 0;
  const played = data?.matchups.length ?? 0;

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader
        title="This Week"
        subtitle="Every matchup you have going, and who you should be rooting for."
      />

      <Paper sx={{ p: 2.5, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <UserSearchInput username={username} setUsername={setUsername} disabled={loading} />
          <Select
            size="small"
            value={week ?? ''}
            onChange={e => setWeek(Number(e.target.value))}
            disabled={loading || weeks.length === 0}
            sx={{ height: 56, minWidth: 120 }}
          >
            {weeks.map(w => <MenuItem key={w} value={w}>Week {w}</MenuItem>)}
          </Select>
          <Button
            variant="contained"
            size="large"
            sx={{ height: 56 }}
            disabled={loading || !username || !week || !season}
            onClick={() => week && load(username, season, week)}
          >
            {loading ? 'Loading…' : 'Load Week'}
          </Button>
        </Box>
        {loading && <LinearProgress sx={{ mt: 2 }} />}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </Paper>

      {data && (
        <>
          <Paper sx={{ p: 2.5, mb: 2 }}>
            <Box sx={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Projected record, week {data.week}
                </Typography>
                <Typography variant="h4" sx={{ lineHeight: 1.2 }}>
                  {expectedWins.toFixed(1)}&ndash;{(played - expectedWins).toFixed(1)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  across {played} matchup{played === 1 ? '' : 's'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">Live now</Typography>
                <Typography variant="h6">
                  {data.matchups.filter(m => m.status === 'live').length}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">Coin flips</Typography>
                <Tooltip title="Matchups between 40% and 60% — the ones actually in the balance">
                  <Typography variant="h6">
                    {data.matchups.filter(m => Math.abs(m.winProbability - 0.5) <= 0.1).length}
                  </Typography>
                </Tooltip>
              </Box>
              {updatedAt && (
                <Box sx={{ ml: 'auto' }}>
                  <Typography variant="caption" color="text.secondary">
                    Updated {updatedAt}{anyLive ? ' · refreshing every 30s' : ''}
                  </Typography>
                </Box>
              )}
            </Box>
          </Paper>

          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
            <Tab label={`Matchups (${data.matchups.length})`} />
            <Tab label={`Rooting interest (${data.rooting.length})`} />
          </Tabs>

          {tab === 0 ? <MatchupsView data={data} /> : <RootingView rows={data.rooting} />}

          {data.skipped.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                Not shown ({data.skipped.length}) — listed rather than hidden, so a league missing
                here is never a mystery:
              </Typography>
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {data.skipped.map(s => (
                  <Tooltip key={s.leagueId} title={s.reason}>
                    <Chip label={s.leagueName} size="small" variant="outlined" />
                  </Tooltip>
                ))}
              </Box>
            </Paper>
          )}
        </>
      )}
    </Container>
  );
}
