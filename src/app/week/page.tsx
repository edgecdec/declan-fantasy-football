'use client';

import * as React from 'react';
import {
  Alert, Box, Button, Chip, Container, Divider, LinearProgress, MenuItem, Paper, Select,
  Tab, Tabs, Tooltip, Typography,
} from '@mui/material';
import MuiLink from '@mui/material/Link';
import DataTable, { Column } from '@/components/common/DataTable';
import SmartTable, { SmartColumn } from '@/components/common/SmartTable';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';
import NetLeaguesBar from '@/components/week/NetLeaguesBar';
import MatchupScoreboard from '@/components/week/MatchupScoreboard';
import WinRatingScale from '@/components/week/WinRatingScale';
import RatingBreakdown from '@/components/week/RatingBreakdown';
import PlayFeed from '@/components/plays/PlayFeed';
import { rateWinProbability } from '@/services/week/winRating';
import useRememberedUsername from '@/hooks/useRememberedUsername';
import { useUser } from '@/context/UserContext';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { getNflStateOrFallback } from '@/services/common/seasonService';
import {
  LeagueWeekOutlook, RootingLeagueRef, RootingRow, WeeklyOutlook, buildWeeklyOutlook,
} from '@/services/week/weeklyOutlook';
import { leagueUrl } from '@/services/common/leagueLinks';
import { getPositionColor } from '@/constants/colors';
import { formatProjection, formatScore, formatScoreDelta } from '@/services/common/formatPoints';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

/** Live pages refresh on the same cadence the NFL scoreboard proxy revalidates. */
const REFRESH_MS = 30_000;

/**
 * A league name, always clickable.
 *
 * Project rule: any mention of a league links to it. One component so that is true by
 * construction rather than by remembering.
 */
function LeagueLink({ leagueId, name, noWrap }: { leagueId: string; name: string; noWrap?: boolean }) {
  return (
    <MuiLink
      href={leagueUrl(leagueId)}
      target="_blank"
      rel="noopener noreferrer"
      underline="hover"
      color="inherit"
      onClick={e => e.stopPropagation()}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.4,
        maxWidth: '100%', ...(noWrap ? { whiteSpace: 'nowrap' } : {}),
      }}
      title={`Open ${name} on Sleeper`}
    >
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</Box>
      <OpenInNewIcon sx={{ fontSize: 12, opacity: 0.5, flexShrink: 0 }} />
    </MuiLink>
  );
}

const STATUS_LABEL: Record<string, { label: string; color: 'default' | 'success' | 'warning' }> = {
  not_started: { label: 'Not started', color: 'default' },
  live: { label: 'Live', color: 'success' },
  final: { label: 'Final', color: 'warning' },
};

/**
 * One starting slot with both managers' players side by side.
 *
 * Pairing by slot is meaningful because both sides of a matchup share the league's
 * roster_positions, so row 3 really is my RB2 against their RB2. This uses the lineup as
 * actually set, not the priced lineup, which returns locked players first and so carries no
 * slot meaning.
 */
type PairedSlot = {
  index: number;
  slot: string;
  minePoints: number;
  mineProjected: number;
  theirsPoints: number;
  theirsProjected: number;
  mineName: string | null;
  minePosition: string | null;
  mineState: string;
  theirsName: string | null;
  theirsPosition: string | null;
  theirsState: string;
  /** Points I am up in this slot; negative means losing it. */
  edge: number;
};

const STATE_MARK: Record<string, string> = { pre: '○', in: '●', post: '✓', unknown: '·' };

/**
 * A position or slot label in the project's position colour.
 *
 * Uses `getPositionColor` from constants/colors rather than a local map — three other files
 * already redefine that palette locally, which is how they drift.
 *
 * Applied as TEXT colour, not as a fill. Those colours are deliberately light (L 0.71-0.84)
 * because the app uses them for chart strokes and labels on a dark surface, where that is
 * right; as solid fills they sit outside the validator's band and DEF (#94a3b8, chroma
 * 0.035) reads gray. The letters are always present next to the colour, so identity never
 * rests on hue alone — which also covers the RB/QB pair sitting at ΔE 7.9 for deuteranopia.
 */
function PositionTag({ label, size = '0.7rem' }: { label: string; size?: string }) {
  return (
    <Box
      component="span"
      sx={{
        color: getPositionColor(label),
        fontWeight: 700,
        fontSize: size,
        letterSpacing: '0.03em',
      }}
    >
      {label}
    </Box>
  );
}

function PlayerCell({ name, position, state }: { name: string | null; position: string | null; state: string }) {
  if (!name) return <Box component="span" sx={{ color: 'text.disabled' }}>— empty —</Box>;
  return (
    <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
      <Tooltip title={state === 'post' ? 'Game final' : state === 'in' ? 'Playing now' : state === 'pre' ? 'Not started' : 'No game found'}>
        <Box component="span" sx={{ mr: 0.5, color: state === 'in' ? 'success.main' : 'text.disabled', fontSize: '0.7rem' }}>
          {STATE_MARK[state] ?? '·'}
        </Box>
      </Tooltip>
      {name}
      {position && <Box component="span" sx={{ ml: 0.6 }}><PositionTag label={position} /></Box>}
    </Box>
  );
}

function MatchupDetail({ row }: { row: LeagueWeekOutlook }) {
  if (!row.opponent) return null;
  const mine = row.me.lineup;
  const theirs = row.opponent.lineup;
  const slots = Math.max(mine.length, theirs.length);

  const paired: PairedSlot[] = Array.from({ length: slots }, (_, i) => {
    const a = mine[i];
    const b = theirs[i];
    return {
      index: i,
      slot: a?.slot ?? b?.slot ?? '—',
      minePoints: a?.points ?? 0,
      mineProjected: a?.projectedPoints ?? 0,
      theirsPoints: b?.points ?? 0,
      theirsProjected: b?.projectedPoints ?? 0,
      mineName: a?.name ?? null,
      minePosition: a?.position ?? null,
      mineState: a?.gameState ?? 'unknown',
      theirsName: b?.name ?? null,
      theirsPosition: b?.position ?? null,
      theirsState: b?.gameState ?? 'unknown',
      edge: (a?.points ?? 0) - (b?.points ?? 0),
    };
  });

  const columns: Column<PairedSlot>[] = [
    {
      id: 'slot',
      label: 'Slot',
      width: 78,
      tooltip: 'Roster slot, in the order Sleeper lists them. Sorting this returns to that order.',
      // Sorts by roster POSITION, not by the slot's name. Sorting the string gave
      // DEF, FLEX, K, QB, RB, RB, TE, WR, WR — alphabetical, which is not an order any
      // fantasy player recognises. Sleeper's order is simply roster_positions order.
      sortValue: r => r.index,
      render: r => <PositionTag label={r.slot} size="0.72rem" />,
    },
    { id: 'mineName', label: 'You', render: r => <PlayerCell name={r.mineName} position={r.minePosition} state={r.mineState} /> },
    { id: 'minePoints', label: 'Pts', numeric: true, render: r => <Box component="span" sx={{ fontWeight: 600 }}>{formatScore(r.minePoints)}</Box> },
    { id: 'mineProjected', label: 'Proj', numeric: true, tooltip: 'Full-week projection under this league\'s scoring', render: r => <Box component="span" sx={{ color: 'text.secondary' }}>{formatProjection(r.mineProjected)}</Box> },
    {
      id: 'edge',
      label: 'Slot edge',
      numeric: true,
      tooltip: 'Points you are ahead in this slot. Sort to find where the matchup is being won and lost.',
      render: r => (
        <Box component="span" sx={{ fontWeight: 600, color: r.edge > 0 ? 'success.main' : r.edge < 0 ? 'error.main' : 'text.disabled' }}>
          {formatScoreDelta(r.edge)}
        </Box>
      ),
    },
    { id: 'theirsPoints', label: 'Pts', numeric: true, render: r => <Box component="span" sx={{ fontWeight: 600 }}>{formatScore(r.theirsPoints)}</Box> },
    { id: 'theirsProjected', label: 'Proj', numeric: true, render: r => <Box component="span" sx={{ color: 'text.secondary' }}>{formatProjection(r.theirsProjected)}</Box> },
    { id: 'theirsName', label: row.opponent.displayName, render: r => <PlayerCell name={r.theirsName} position={r.theirsPosition} state={r.theirsState} /> },
  ];

  return (
    <Box sx={{ py: 1 }}>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
        <LeagueLink leagueId={row.leagueId} name={row.leagueName} /> · week {row.week} ·
        {' '}lineups as actually set. ○ not started · ● playing · ✓ final
      </Typography>
      <DataTable
        data={paired}
        columns={columns}
        keyField={r => String(r.index)}
        defaultSortBy="slot"
        defaultSortOrder="asc"
        defaultRowsPerPage={25}
        rowsPerPageOptions={[25]}
        noDataMessage="No lineup available."
      />
    </Box>
  );
}

function MatchupsView({ data }: { data: WeeklyOutlook }) {
  if (data.matchups.length === 0) {
    return <Alert severity="info">No head-to-head matchups found for week {data.week}.</Alert>;
  }

  const columns: Column<LeagueWeekOutlook>[] = [
    {
      id: 'leagueName',
      label: 'League',
      width: 180,
      render: r => (
        <Typography variant="body2" component="div" noWrap>
          <LeagueLink leagueId={r.leagueId} name={r.leagueName} noWrap />
        </Typography>
      ),
    },
    {
      id: 'scoreboard',
      label: 'Matchup',
      sortable: false,
      // Not sortable itself: it presents four numbers at once, so there is no single
      // ordering it could mean. The numbers worth sorting on get their own columns below.
      render: r => (
        r.opponent ? (
          <MatchupScoreboard
            leftName="You"
            leftIsYou
            rightName={r.opponent.displayName}
            leftScore={r.me.distribution.banked}
            rightScore={r.opponent.distribution.banked}
            leftProjected={r.me.distribution.mean}
            rightProjected={r.opponent.distribution.mean}
            leftWinProbability={r.winProbability}
            leftToPlay={r.me.playersRemaining}
            rightToPlay={r.opponent.playersRemaining}
            final={r.status === 'final'}
          />
        ) : <Box component="span" sx={{ color: 'text.disabled' }}>no opponent this week</Box>
      ),
    },
    {
      id: 'margin',
      label: 'Margin',
      numeric: true,
      width: 90,
      tooltip: 'Points you are ahead right now. Sort ascending to find the games you are losing.',
      sortValue: r => (r.opponent ? r.me.distribution.banked - r.opponent.distribution.banked : null),
      render: r => {
        if (!r.opponent) return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>;
        const m = r.me.distribution.banked - r.opponent.distribution.banked;
        return (
          <Box component="span" sx={{
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: m > 0 ? 'success.main' : m < 0 ? 'error.main' : 'text.disabled',
          }}>
            {formatScoreDelta(m)}
          </Box>
        );
      },
    },
    {
      id: 'winProbability',
      label: 'Win %',
      numeric: true,
      width: 84,
      tooltip: 'Chance you win this matchup. The bar in the Matchup column is the same number.',
      render: r => (
        <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {(r.winProbability * 100).toFixed(0)}%
        </Box>
      ),
    },
    {
      id: 'rating',
      label: 'Rating',
      width: 172,
      tooltip: 'Forecast-style rating, Solid you through Toss-up to Solid them. Thresholds checked against 650 predictions from 325 real completed matchups. Sorts from most-favoured to least.',
      // Sorts along the scale rather than by the raw probability, so equal ratings group
      // together and the ordering matches what the reader sees.
      sortValue: r => rateWinProbability(r.winProbability).index,
      render: r => (
        r.opponent
          ? <WinRatingScale probability={r.winProbability} muted={r.status === 'final'} />
          : <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
      ),
    },
    {
      id: 'closeness',
      label: 'Closeness',
      numeric: true,
      width: 104,
      tooltip: 'Distance from a coin flip. Sort ascending to put the matchups actually in the balance at the top — this is the default.',
      sortValue: r => Math.abs(r.winProbability - 0.5),
      render: r => (
        <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          ±{(Math.abs(r.winProbability - 0.5) * 100).toFixed(0)}
        </Box>
      ),
    },
    {
      id: 'toPlay',
      label: 'To play',
      numeric: true,
      width: 96,
      tooltip: 'Your starters who can still score. A lead with nobody left is safe; the same lead with eight to play is not.',
      sortValue: r => r.me.playersRemaining,
      render: r => (
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {r.me.playersRemaining}
          {r.opponent && <Box component="span" sx={{ color: 'text.disabled' }}> / {r.opponent.playersRemaining}</Box>}
        </Box>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      render: r => {
        const s = STATUS_LABEL[r.status] ?? STATUS_LABEL.not_started;
        return <Chip label={s.label} color={s.color} size="small" variant="outlined" />;
      },
    },
  ];

  return (
    <DataTable
      data={data.matchups}
      columns={columns}
      keyField={r => r.leagueId}
      defaultSortBy="closeness"
      defaultSortOrder="asc"
      defaultRowsPerPage={25}
      rowsPerPageOptions={[10, 25, 50]}
      noDataMessage="No matchups this week."
      renderDetailPanel={r => <MatchupDetail row={r} />}
    />
  );
}

/** Which leagues a player is starting in, each one a link. */
function LeagueRefList({ label, refs, color }: { label: string; refs: RootingLeagueRef[]; color: string }) {
  if (refs.length === 0) return null;
  return (
    <Box sx={{ minWidth: 240 }}>
      <Typography variant="caption" sx={{ color, fontWeight: 700 }}>{label} ({refs.length})</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 0.5 }}>
        {refs.map(ref => (
          <Box key={ref.leagueId} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography variant="body2" component="div">
              <LeagueLink leagueId={ref.leagueId} name={ref.leagueName} />
            </Typography>
            {!ref.headToHead && (
              <Tooltip title="No head-to-head opponent in this format, so it counts toward the +/- but not the weighted number.">
                <Chip label="no opponent" size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
              </Tooltip>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function RootingDetail({ row }: { row: RootingRow }) {
  return (
    <Box sx={{ display: 'flex', gap: 5, flexWrap: 'wrap', py: 1 }}>
      <LeagueRefList label="Starting FOR you" refs={row.forLeagues} color="primary.main" />
      <LeagueRefList label="Starting AGAINST you" refs={row.againstLeagues} color="error.main" />
      <Box>
        <Typography variant="caption" color="text.secondary" display="block">Projected points at stake</Typography>
        <Typography variant="body2">
          {formatProjection(row.forPoints)} for · {formatProjection(row.againstPoints)} against
        </Typography>
        {row.swingLeagues > 0 && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Weighted across {row.swingLeagues} head-to-head league{row.swingLeagues === 1 ? '' : 's'}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function RootingView({ rows }: { rows: RootingRow[] }) {
  if (rows.length === 0) {
    return (
      <Alert severity="info">
        Nothing left to root for — every matchup this week is already decided, or no games remain.
      </Alert>
    );
  }
  const maxNet = Math.max(1, ...rows.map(r => Math.abs(r.netLeagues)));

  const columns: SmartColumn<RootingRow>[] = [
    {
      id: 'name',
      label: 'Player',
      render: r => (
        <Box component="span" sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{r.name}</Box>
      ),
    },
    {
      id: 'position',
      label: 'Pos',
      filterVariant: 'multi-select',
      render: r => (
        r.position
          ? <PositionTag label={r.position} size="0.75rem" />
          : <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
      ),
    },
    {
      id: 'netLeagues',
      label: 'Net +/−',
      numeric: true,
      width: 200,
      tooltip: 'Leagues starting him FOR you minus leagues starting him AGAINST you. +2 means two more of your matchups want him to go off than want him to disappear.',
      render: r => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
          <Box component="span" sx={{ fontWeight: 700, minWidth: 24, textAlign: 'right' }}>
            {r.netLeagues > 0 ? `+${r.netLeagues}` : r.netLeagues}
          </Box>
          <Box sx={{ width: 140 }}>
            <NetLeaguesBar
              net={r.netLeagues}
              max={maxNet}
              label={`${r.forLeagues.length} for, ${r.againstLeagues.length} against`}
            />
          </Box>
        </Box>
      ),
    },
    {
      id: 'forCount',
      label: 'For',
      numeric: true,
      sortValue: r => r.forLeagues.length,
      render: r => <>{r.forLeagues.length}</>,
    },
    {
      id: 'againstCount',
      label: 'Against',
      numeric: true,
      sortValue: r => r.againstLeagues.length,
      render: r => <>{r.againstLeagues.length}</>,
    },
    {
      id: 'netSwing',
      label: 'Wins at stake',
      numeric: true,
      tooltip: 'Expected wins riding on this player across all your leagues, weighting each matchup by how close it actually is. A count of wins, not a percentage, so it exceeds 1.00 for someone in several of your lineups. Sort descending for who you most want to succeed, ascending for who you most want to fail.',
      render: r => (
        r.swingLeagues === 0 ? (
          // No opponent anywhere, so there is no win probability to move. Saying "0.00"
          // would claim he does not matter; a dash says we cannot weight him.
          <Tooltip title="No head-to-head league — nothing to weight against, so this is not defined here.">
            <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
          </Tooltip>
        ) : (
          <Box component="span" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            {r.netSwing > 0 ? '+' : ''}{r.netSwing.toFixed(2)}
          </Box>
        )
      ),
    },
    {
      id: 'leagues',
      label: 'Leagues',
      sortable: false,
      render: r => (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
          {[
            r.forLeagues.length ? `▲ ${r.forLeagues.length}` : '',
            r.againstLeagues.length ? `▼ ${r.againstLeagues.length}` : '',
          ].filter(Boolean).join('  ')}
          {' · click to expand'}
        </Typography>
      ),
    },
  ];

  return (
    <>
      <SmartTable
        data={rows}
        columns={columns}
        keyField={r => r.playerId}
        renderDetailPanel={r => <RootingDetail row={r} />}
        defaultSortBy="netSwing"
        defaultSortOrder="desc"
        defaultRowsPerPage={25}
        rowsPerPageOptions={[25, 50, 100]}
        noDataMessage="Nobody left to root for."
      />
      <Alert severity="info" sx={{ mt: 1 }}>
        <strong>Net +/− counts leagues; wins-at-stake weights them.</strong> They can disagree,
        and when they do the weighted number is the better guide: a player you are +2 on across
        two matchups already decided matters less than one you are −1 on in a coin flip. Sort
        &quot;Wins at stake&quot; ascending to see who you most want to have a bad day. Only
        players whose NFL game has not finished appear, so this list empties out as the slate
        does.
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
              {updatedAt && (
                <Box sx={{ ml: 'auto' }}>
                  <Typography variant="caption" color="text.secondary">
                    Updated {updatedAt}{anyLive ? ' · refreshing every 30s' : ''}
                  </Typography>
                </Box>
              )}
            </Box>
            <Divider sx={{ my: 2 }} />
            <RatingBreakdown probabilities={data.matchups.map(m => m.winProbability)} />
          </Paper>

          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
            <Tab label={`Matchups (${data.matchups.length})`} />
            <Tab label={`Rooting interest (${data.rooting.length})`} />
            <Tab label="The Zone" />
          </Tabs>

          {tab === 0 && <MatchupsView data={data} />}
          {tab === 1 && <RootingView rows={data.rooting} />}
          {/* Takes the week from this page rather than owning a picker, so the tab can never
              disagree with the header about which week it is showing. */}
          {tab === 2 && week != null && (
            <PlayFeed username={username} season={season} week={week} />
          )}

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
                    <Chip
                      label={s.leagueName}
                      size="small"
                      variant="outlined"
                      component="a"
                      clickable
                      href={leagueUrl(s.leagueId)}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
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
