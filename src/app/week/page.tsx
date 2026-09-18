'use client';

import * as React from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, Container, Divider, FormControlLabel, LinearProgress,
  ListItemText, MenuItem, Paper, Select, Switch, Tab, Tabs, Tooltip, Typography,
} from '@mui/material';
import MuiLink from '@mui/material/Link';
import DataTable, { Column } from '@/components/common/DataTable';
import SmartTable, { SmartColumn } from '@/components/common/SmartTable';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';
import NetLeaguesBar from '@/components/week/NetLeaguesBar';
import MatchupScoreboard from '@/components/week/MatchupScoreboard';
import ChoppedScoreboard from '@/components/week/ChoppedScoreboard';
import WinRatingScale from '@/components/week/WinRatingScale';
import RatingBreakdown from '@/components/week/RatingBreakdown';
import PlayFeed from '@/components/plays/PlayFeed';
import { rateWinProbability } from '@/services/week/winRating';
import useRememberedUsername from '@/hooks/useRememberedUsername';
import useRememberedTab from '@/hooks/useRememberedTab';
import { useUser } from '@/context/UserContext';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { getNflStateOrFallback } from '@/services/common/seasonService';
import {
  EliminationRisk, LeagueWeekOutlook, MatchupStatus, RootingLeagueRef, RootingRow, WeeklyOutlook,
  buildRootingRows, buildWeeklyOutlook,
} from '@/services/week/weeklyOutlook';
import {
  LEAGUE_FORMATS,
  LEAGUE_FORMAT_LABEL,
  LeagueFormat,
  leagueFormat,
} from '@/services/week/leagueFormat';
import { leagueUrl } from '@/services/common/leagueLinks';
import { getPositionColor } from '@/constants/colors';
import {
  formatProjection, formatScore, formatScoreDelta, formatWinProbability,
} from '@/services/common/formatPoints';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

/** Live pages refresh on the same cadence the NFL scoreboard proxy revalidates. */
const REFRESH_MS = 30_000;

/** Matchups, Rooting interest, The Zone. Bounds a remembered index that is no longer valid. */
const WEEK_TABS = 3;

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

/**
 * `rank` orders the Status column: what you want to watch first, then what has not started, then
 * what is over. Sorting on the label alphabetically would put Final above Live.
 */
const STATUS_LABEL: Record<
  string,
  { label: string; color: 'default' | 'success' | 'warning' | 'info'; rank: number }
> = {
  live: { label: 'Live', color: 'success', rank: 0 },
  between: { label: 'Between games', color: 'info', rank: 1 },
  not_started: { label: 'Not started', color: 'default', rank: 2 },
  final: { label: 'Final', color: 'warning', rank: 3 },
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

/**
 * The formats this account actually plays this week, in display order.
 *
 * Derived rather than hardcoded: an account with no keeper league should not be offered a Keeper
 * chip that blanks the table.
 *
 * Elimination leagues must be counted from `eliminations`, NOT from the matchups. They have no
 * head-to-head pairing so they never appear in the matchup list at all — reading formats from
 * matchups alone left `chopped` permanently out of the selection, which silently filtered the
 * expected-eliminations figure to nothing.
 */
function presentFormats(data: WeeklyOutlook): LeagueFormat[] {
  const seen = new Set<LeagueFormat>(data.matchups.map(m => leagueFormat(m.league)));
  for (const e of data.eliminations) seen.add(e.format);
  return LEAGUE_FORMATS.filter(f => seen.has(f));
}

/**
 * Format filter, as a multiselect.
 *
 * Chips were the first attempt and they were the wrong control. This is a SELECTION, not a set of
 * independent toggles: chips gave every format its own lit/unlit state with no single place saying
 * what the current scope is, so "all on" and "all explicitly selected" looked identical, and the
 * first click had to guess whether you meant isolate or exclude. A dropdown has one summary line
 * that always states the scope, and multi-select semantics people already know.
 *
 * Lives in the header and scopes the whole page — the projected record, the rating bar, the rooting
 * netting and the Zone's play scoring all read it.
 */
function FormatFilter({
  present,
  active,
  counts,
  onChange,
}: {
  present: LeagueFormat[];
  active: LeagueFormat[];
  counts: Record<string, number>;
  onChange: (next: LeagueFormat[]) => void;
}) {
  if (present.length <= 1) return null;
  const allSelected = active.length === present.length;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography variant="caption" color="text.secondary">Leagues</Typography>
      <Select
        multiple
        size="small"
        value={active}
        onChange={e => {
          const next = (typeof e.target.value === 'string'
            ? e.target.value.split(',')
            : e.target.value) as LeagueFormat[];
          // Deselecting everything cannot be acted on, so it reads as a reset to all rather than
          // an empty page with no way back.
          onChange(next.length === 0 || next.length === present.length ? [] : next);
        }}
        renderValue={sel => {
          const chosen = sel as LeagueFormat[];
          const total = chosen.reduce((n, f) => n + (counts[f] ?? 0), 0);
          // The summary always states the scope, which is the whole point of using a dropdown.
          if (allSelected) return `All formats · ${total} leagues`;
          return `${chosen.map(f => LEAGUE_FORMAT_LABEL[f]).join(', ')} · ${total} leagues`;
        }}
        sx={{ minWidth: 260 }}
      >
        {present.map(f => (
          <MenuItem key={f} value={f}>
            <Checkbox checked={active.includes(f)} size="small" sx={{ py: 0, mr: 0.5 }} />
            <ListItemText
              primary={LEAGUE_FORMAT_LABEL[f]}
              secondary={`${counts[f] ?? 0} league${(counts[f] ?? 0) === 1 ? '' : 's'}`}
              sx={{ my: 0 }}
            />
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}

/**
 * One row of the week table: a head-to-head matchup, or an elimination league.
 *
 * Normalised to ONE shape so the columns do not each branch on kind, and so both sorts and the
 * rating scale work across the whole table. `probability` is win% for a matchup and safe% for an
 * elimination league: the same question — how likely is this to go my way — measured the only way
 * each format allows. That is what makes it honest to rate and sort them together.
 */
type WeekRow = {
  leagueId: string;
  leagueName: string;
  format: LeagueFormat;
  probability: number;
  /** Points ahead of the side that matters: the opponent, or the roster nearest the chop. */
  margin: number | null;
  playersRemaining: number;
  otherRemaining: number | null;
  status: MatchupStatus;
  h2h: LeagueWeekOutlook | null;
  chop: EliminationRisk | null;
};

function toWeekRows(
  matchups: LeagueWeekOutlook[],
  eliminations: EliminationRisk[],
): WeekRow[] {
  const rows: WeekRow[] = matchups.map(m => ({
    leagueId: m.leagueId,
    leagueName: m.leagueName,
    format: leagueFormat(m.league),
    probability: m.winProbability,
    margin: m.opponent ? m.me.distribution.banked - m.opponent.distribution.banked : null,
    playersRemaining: m.me.playersRemaining,
    otherRemaining: m.opponent?.playersRemaining ?? null,
    status: m.status,
    h2h: m,
    chop: null,
  }));

  for (const e of eliminations) {
    rows.push({
      leagueId: e.leagueId,
      leagueName: e.leagueName,
      format: e.format,
      // Safety, not risk, so bigger is better here exactly as it is for a win probability. A row
      // mixing the two conventions would sort and rate backwards half the time.
      probability: e.eliminated ? 0 : 1 - e.probability,
      margin: e.closestRival ? e.banked - e.closestRival.banked : null,
      playersRemaining: e.playersRemaining,
      otherRemaining: e.closestRival?.playersRemaining ?? null,
      status: e.status,
      h2h: null,
      chop: e,
    });
  }
  return rows;
}

function MatchupsView({ rows }: { rows: WeekRow[] }) {
  if (rows.length === 0) {
    return <Alert severity="info">No matchups in the selected formats.</Alert>;
  }

  const columns: Column<WeekRow>[] = [
    {
      id: 'leagueName',
      label: 'League',
      width: 180,
      // The format rides in this cell rather than taking a column of its own. This table is
      // already wider than a laptop viewport, and Status — the thing you now want to sort on —
      // was falling off the right edge.
      render: r => (
        <Box>
          <Typography variant="body2" component="div" noWrap>
            <LeagueLink leagueId={r.leagueId} name={r.leagueName} noWrap />
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 10 }}>
            {LEAGUE_FORMAT_LABEL[r.format]}
            {r.chop && !r.chop.eliminated && ' · lowest is out'}
            {r.chop?.eliminated && ' · eliminated'}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'scoreboard',
      label: 'Matchup',
      sortable: false,
      // Not sortable itself: it presents four numbers at once, so there is no single
      // ordering it could mean. The numbers worth sorting on get their own columns below.
      render: r => {
        if (r.chop) {
          if (r.chop.eliminated) {
            return <Box component="span" sx={{ color: 'text.disabled' }}>eliminated — no roster left</Box>;
          }
          return (
            <ChoppedScoreboard
              banked={r.chop.banked}
              projected={r.chop.projected}
              safeProbability={r.probability}
              activeRosters={r.chop.activeRosters}
              playersRemaining={r.chop.playersRemaining}
              rival={r.chop.closestRival}
              final={r.status === 'final'}
            />
          );
        }
        const m = r.h2h!;
        return m.opponent ? (
          <MatchupScoreboard
            leftName="You"
            leftIsYou
            rightName={m.opponent.displayName}
            leftScore={m.me.distribution.banked}
            rightScore={m.opponent.distribution.banked}
            leftProjected={m.me.distribution.mean}
            rightProjected={m.opponent.distribution.mean}
            leftWinProbability={m.winProbability}
            leftToPlay={m.me.playersRemaining}
            rightToPlay={m.opponent.playersRemaining}
            final={m.status === 'final'}
          />
        ) : <Box component="span" sx={{ color: 'text.disabled' }}>no opponent this week</Box>;
      },
    },
    {
      id: 'margin',
      label: 'Margin',
      numeric: true,
      width: 90,
      tooltip: 'Points you are ahead right now — of your opponent, or of the roster nearest the chop. Sort ascending to find where you are behind.',
      sortValue: r => r.margin,
      render: r => {
        if (r.margin == null) return <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>;
        const m = r.margin;
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
      label: 'Win / safe %',
      numeric: true,
      width: 96,
      tooltip: 'Chance you win the matchup — or, in an elimination league, the chance you are not the lowest score and survive. The bar in the Matchup column is the same number.',
      sortValue: r => r.probability,
      render: r => (
        <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {formatWinProbability(r.probability, r.status === 'final')}
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
      sortValue: r => rateWinProbability(r.probability).index,
      render: r => (
        r.h2h && !r.h2h.opponent
          ? <Box component="span" sx={{ color: 'text.disabled' }}>—</Box>
          : <WinRatingScale probability={r.probability} muted={r.status === 'final'} />
      ),
    },
    {
      id: 'closeness',
      label: 'Closeness',
      numeric: true,
      width: 104,
      tooltip: 'Distance from a coin flip. Sort ascending to put the matchups actually in the balance at the top — this is the default.',
      sortValue: r => Math.abs(r.probability - 0.5),
      render: r => (
        <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          ±{(Math.abs(r.probability - 0.5) * 100).toFixed(0)}
        </Box>
      ),
    },
    {
      id: 'toPlay',
      label: 'To play',
      numeric: true,
      width: 96,
      tooltip: 'Your starters who can still score. A lead with nobody left is safe; the same lead with eight to play is not.',
      sortValue: r => r.playersRemaining,
      render: r => (
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {r.playersRemaining}
          {r.otherRemaining != null && (
            <Box component="span" sx={{ color: 'text.disabled' }}> / {r.otherRemaining}</Box>
          )}
        </Box>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      tooltip: 'Live means a starter is on the field right now. Sort to bring those to the top.',
      // Without a sortValue this column has no backing field, so the comparator would read
      // undefined for every row and sorting would silently do nothing.
      sortValue: r => (STATUS_LABEL[r.status] ?? STATUS_LABEL.not_started).rank,
      render: r => {
        const s = STATUS_LABEL[r.status] ?? STATUS_LABEL.not_started;
        return <Chip label={s.label} color={s.color} size="small" variant="outlined" />;
      },
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      keyField={r => r.leagueId}
      defaultSortBy="closeness"
      defaultSortOrder="asc"
      defaultRowsPerPage={25}
      rowsPerPageOptions={[10, 25, 50]}
      noDataMessage="No matchups in the selected formats."
      renderDetailPanel={r => (r.h2h ? <MatchupDetail row={r.h2h} /> : null)}
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
  /*
   * Live-only is a row property, not a cell value, so it has no column to hang a dropdown off —
   * it goes in the table's own filter bar via toolbarExtra, keeping every control that narrows
   * the list in one place. Off by default: the full list is what the page is for.
   */
  const [liveOnly, setLiveOnly] = React.useState(false);
  const liveCount = rows.filter(r => r.gameState === 'in').length;
  const visible = React.useMemo(
    () => (liveOnly ? rows.filter(r => r.gameState === 'in') : rows),
    [rows, liveOnly],
  );

  if (rows.length === 0) {
    return (
      <Alert severity="info">
        Nothing left to root for — every matchup this week is already decided, or no games remain.
      </Alert>
    );
  }
  // Scaled against the WHOLE list, not the filtered one, so a bar does not change length when a
  // filter is applied and the comparison between rows stays honest.
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
      id: 'team',
      label: 'Team',
      // SmartTable derives the options from the data, so the dropdown lists exactly the teams
      // someone in your lineups actually plays for.
      filterVariant: 'multi-select',
      render: r => (
        r.team
          ? <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{r.team}</Box>
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
        data={visible}
        columns={columns}
        keyField={r => r.playerId}
        renderDetailPanel={r => <RootingDetail row={r} />}
        defaultSortBy="netSwing"
        defaultSortOrder="desc"
        defaultRowsPerPage={25}
        rowsPerPageOptions={[25, 50, 100]}
        noDataMessage={
          liveOnly ? 'Nobody you have a stake in is on the field right now.' : 'Nobody left to root for.'
        }
        toolbarExtra={
          <Tooltip
            title={
              liveCount === 0
                ? 'No games are in progress right now.'
                : `${liveCount} of these players are on the field right now.`
            }
            arrow
          >
            <FormControlLabel
              control={
                <Switch
                  checked={liveOnly}
                  onChange={e => setLiveOnly(e.target.checked)}
                  disabled={liveCount === 0}
                />
              }
              label={`Live only${liveCount > 0 ? ` (${liveCount})` : ''}`}
            />
          </Tooltip>
        }
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
  // Matchups / Rooting interest / The Zone, remembered so a slate-long stay on one tab survives
  // navigation and the auto-refresh.
  const [tab, setTab] = useRememberedTab('week_tab', WEEK_TABS, 0);
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

  /*
   * Load once on arrival, without waiting for a click.
   *
   * The username is remembered and the week comes from Sleeper's calendar, so everything needed is
   * already known — making someone press "Load Week" after every refresh was asking them to
   * re-supply what the page had. The ref guards it to a single automatic load, so clearing the
   * field or changing week is still the reader's call.
   *
   * Deferred through a timeout rather than called inline because `load` sets state synchronously,
   * and the React Compiler (enabled here) rejects that inside an effect — the same rule that
   * failed the build on the first version of useRememberedTab.
   */
  const autoLoaded = React.useRef(false);
  React.useEffect(() => {
    if (autoLoaded.current) return;
    if (!username || !season || !week) return;
    autoLoaded.current = true;
    const t = setTimeout(() => { load(username, season, week); }, 0);
    return () => clearTimeout(t);
  }, [username, season, week, load]);

  // Poll while a slate is in progress. Stops once nothing is live, so a finished week does
  // not keep hitting Sleeper for an answer that cannot change.
  const anyLive = data?.matchups.some(m => m.status !== 'final') ?? false;
  React.useEffect(() => {
    if (!data || !anyLive || !username || !season || !week) return;
    const id = setInterval(() => { load(username, season, week); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [data, anyLive, username, season, week, load]);

  /*
   * Format filter, held at PAGE level rather than inside the matchups table.
   *
   * The projected record is computed from it, so the state cannot live in the table — and the
   * chips are rendered in the header next to the record for the same reason. An empty array means
   * "all", so a newly loaded week is never accidentally filtered to nothing.
   */
  const [formats, setFormats] = React.useState<LeagueFormat[]>([]);
  const present = React.useMemo(
    () => (data ? presentFormats(data) : []),
    [data],
  );
  // An empty explicit selection is impossible to act on, so it collapses back to "all".
  const active = formats.length === 0 ? present : formats;
  const formatCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of data?.matchups ?? []) {
      const f = leagueFormat(m.league);
      counts[f] = (counts[f] ?? 0) + 1;
    }
    // Elimination leagues have no matchup row, so they would otherwise show a count of 0.
    for (const e of data?.eliminations ?? []) counts[e.format] = (counts[e.format] ?? 0) + 1;
    return counts;
  }, [data]);
  const shownMatchups = React.useMemo(
    () => (data ? data.matchups.filter(m => active.includes(leagueFormat(m.league))) : []),
    [data, active],
  );

  /*
   * Every matchup-derived headline reads the FILTERED set, not all of them.
   *
   * The record, the live count and the rating bar are the same win probabilities shown three
   * ways, so filtering one and not the others would have them contradict each other in the same
   * panel — "across 4 matchups" above a bar totalling 16.
   */
  /*
   * The RECORD counts head-to-head matchups only, because an elimination league has no win to
   * project — surviving is not a win. `liveNow` and the rating strip DO include them, because
   * those describe rows on the page and elimination rows carry a rating and a status like any
   * other. Each label says what it counts, which is what keeps the asymmetry honest.
   */
  const expectedWins = shownMatchups.reduce((s, m) => s + m.winProbability, 0);
  const played = shownMatchups.length;
  /*
   * Summed probabilities, so this is a COUNT of leagues, not a percentage: 1.0 means going out of
   * one league on average. With two chopped leagues it sits around a tenth, which is why it is
   * shown to two decimals rather than rounded to a whole number.
   */
  /*
   * Leagues in scope, for anything that is not a matchup row.
   *
   * Elimination leagues have no matchup, so they contribute their ids from `lineupOnly`. The Zone
   * takes this list, and rooting is rebuilt from it below.
   */
  const shownLineupOnly = React.useMemo(
    () => (data ? data.lineupOnly.filter(l => active.includes(l.format)) : []),
    [data, active],
  );
  const shownLeagueIds = React.useMemo(
    () => [...shownMatchups.map(m => m.leagueId), ...shownLineupOnly.map(l => l.leagueId)],
    [shownMatchups, shownLineupOnly],
  );
  /*
   * Rooting is RE-DERIVED for the filtered leagues rather than filtered row by row.
   *
   * A rooting row is a net across leagues — the same player can be for me in one and against me
   * in another — so dropping leagues has to recompute the netting, not hide rows. buildRootingRows
   * is pure and the scoreboard rides along on the result, so this needs no refetch.
   */
  const shownRooting = React.useMemo(() => {
    if (!data) return [];
    if (active.length === present.length) return data.rooting;
    return buildRootingRows(shownMatchups, data.games, shownLineupOnly);
  }, [data, active, present, shownMatchups, shownLineupOnly]);

  const shownEliminations = React.useMemo(
    () => (data ? data.eliminations.filter(e => active.includes(e.format)) : []),
    [data, active],
  );
  const expectedEliminations = shownEliminations.reduce((s, e) => s + e.probability, 0);

  /*
   * Matchups and elimination leagues in one table.
   *
   * Elimination leagues used to appear only inside a tooltip on the header figure, which is a poor
   * place for a league you are one bad week from being knocked out of. As a row they sit in the
   * same sort and read with the same anatomy as everything else.
   */
  const weekRows = React.useMemo(
    () => toWeekRows(shownMatchups, shownEliminations),
    [shownMatchups, shownEliminations],
  );
  const liveNow = weekRows.filter(r => r.status === 'live').length;

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
              {shownEliminations.length > 0 && (
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Expected eliminations
                  </Typography>
                  <Tooltip
                    arrow
                    title={
                      <Box component="span">
                        Chance of being chopped this week, summed across elimination leagues — so
                        1.0 means going out of one league on average. Usually a tenth or two.
                        {shownEliminations.map(e => (
                          <Box component="span" key={e.leagueId} sx={{ display: 'block', mt: 0.5 }}>
                            {e.leagueName}:{' '}
                            {e.eliminated
                              ? 'already out'
                              : `${(e.probability * 100).toFixed(1)}% of ${e.activeRosters} left`}
                          </Box>
                        ))}
                      </Box>
                    }
                  >
                    <Typography variant="h4" sx={{ lineHeight: 1.2, cursor: 'help' }}>
                      {expectedEliminations.toFixed(2)}
                    </Typography>
                  </Tooltip>
                  <Typography variant="caption" color="text.secondary">
                    across {shownEliminations.length} elimination league
                    {shownEliminations.length === 1 ? '' : 's'}
                  </Typography>
                </Box>
              )}
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">Live now</Typography>
                <Typography variant="h6">{liveNow}</Typography>
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
            {/* weekRows, so the strip counts the same rows the Rating column rates. */}
            <RatingBreakdown probabilities={weekRows.map(r => r.probability)} />
          </Paper>

          {/* Above the tabs, because it scopes ALL of them — the matchup table, the rooting
              netting and the Zone's play scoring — as well as the numbers above. Inside a tab it
              would look like it only applied to that tab. */}
          <Box sx={{ mb: 1.5 }}>
            <FormatFilter
              present={present}
              active={active}
              counts={formatCounts}
              onChange={setFormats}
            />
          </Box>

          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
            {/* weekRows, not shownMatchups: elimination leagues are rows in this table too, and a
                count that excluded them disagreed with the table right below it. */}
            <Tab label={`Matchups (${weekRows.length})`} />
            <Tab label={`Rooting interest (${shownRooting.length})`} />
            <Tab label="The Zone" />
          </Tabs>

          {tab === 0 && <MatchupsView rows={weekRows} />}
          {tab === 1 && <RootingView rows={shownRooting} />}
          {/* Takes the week from this page rather than owning a picker, so the tab can never
              disagree with the header about which week it is showing. */}
          {tab === 2 && week != null && (
            <PlayFeed
              username={username}
              season={season}
              week={week}
              leagueIds={active.length === present.length ? undefined : shownLeagueIds}
            />
          )}

          {/* Not on the Zone tab: those leagues are skipped for MATCHUP pricing, but the play
              feed covers every league, so listing them there would claim something is missing
              that is not. */}
          {tab !== 2 && data.skipped.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                Not shown ({data.skipped.length}) — listed rather than hidden, so a league missing
                here is never a mystery:
              </Typography>
              <Divider sx={{ my: 1 }} />
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {/* The reason is IN the label, not only in a tooltip. A tooltip you have to go
                    hunting for does not answer "why is this league missing" at a glance, and on a
                    touch screen it answers it not at all. */}
                {data.skipped.map(s => (
                  <Chip
                    key={s.leagueId}
                    label={
                      <Box component="span">
                        {s.leagueName}
                        <Box component="span" sx={{ color: 'text.secondary', ml: 0.6 }}>
                          — {s.reason}
                        </Box>
                      </Box>
                    }
                    size="small"
                    variant="outlined"
                    component="a"
                    clickable
                    href={leagueUrl(s.leagueId)}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                ))}
              </Box>
            </Paper>
          )}
        </>
      )}
    </Container>
  );
}
