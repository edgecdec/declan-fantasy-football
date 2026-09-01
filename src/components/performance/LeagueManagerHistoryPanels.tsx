'use client';

import * as React from 'react';
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TableSortLabel, ToggleButton, ToggleButtonGroup,
  Chip, Tooltip, alpha, useTheme,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import RemoveIcon from '@mui/icons-material/Remove';
import { LeagueManagerHistory } from '@/services/stats/historicalManagers';
import useTableSort from '@/hooks/useTableSort';

/** Metrics the season-by-season strip can display. */
const SEASON_METRICS = [
  { value: 'lineupEfficiency', label: 'Lineup Efficiency', unit: '%', digits: 1 },
  { value: 'optimalRate', label: 'Optimal Rate', unit: '%', digits: 0 },
  { value: 'avgPositionalEdge', label: 'Positional Edge', unit: '', digits: 1 },
] as const;

type SeasonMetric = typeof SEASON_METRICS[number]['value'];

/** A trend smaller than this is noise, not a direction. */
const TREND_DEADBAND = 0.5;

type Props = {
  history: LeagueManagerHistory;
  currentUserId?: string;
};

type MatrixRow = {
  ownerId: string;
  displayName: string;
  isYou: boolean;
  seasonsPlayed: number;
  weakest: string;
  avg: number | null;
} & Record<string, string | number | boolean | null>;

/**
 * Diverging green/red fill scaled to the strongest deviation on screen, so the
 * contrast stays useful whether the spread is 1 point or 20.
 */
function useCellColor() {
  const theme = useTheme();
  return React.useCallback((deviation: number | null, maxAbs: number): string => {
    if (deviation == null || maxAbs === 0) return 'transparent';
    const intensity = Math.min(Math.abs(deviation) / maxAbs, 1);
    const a = 0.12 + intensity * 0.5;
    if (deviation > 0) return alpha(theme.palette.success.main, a);
    if (deviation < 0) return alpha(theme.palette.error.main, a);
    return 'transparent';
  }, [theme]);
}

function valueColor(deviation: number | null): string {
  if (deviation == null) return 'text.disabled';
  if (deviation > 0) return 'success.main';
  if (deviation < 0) return 'error.main';
  return 'text.secondary';
}

function fmt(value: number | null, digits: number, signed: boolean): string {
  if (value == null) return '—';
  const s = value.toFixed(digits);
  return signed && value > 0 ? `+${s}` : s;
}

export default function LeagueManagerHistoryPanels({ history, currentUserId }: Props) {
  const cellColor = useCellColor();
  const [metric, setMetric] = React.useState<SeasonMetric>('lineupEfficiency');

  const { managers, seasons, activePositions, cells, avgPositionalEdge, seasonsPlayed } = history;

  // ---- Panel 1: where each manager is weak, averaged over every season ----
  const matrixRows: MatrixRow[] = React.useMemo(() => managers.map(m => {
    const perPos = avgPositionalEdge[m.ownerId] ?? {};
    const present = activePositions
      .map(p => ({ pos: p, edge: perPos[p] }))
      .filter((e): e is { pos: string; edge: number } => e.edge != null);
    const worst = present.reduce<{ pos: string; edge: number } | null>(
      (acc, e) => (acc === null || e.edge < acc.edge ? e : acc), null,
    );
    const row: MatrixRow = {
      ownerId: m.ownerId,
      displayName: m.displayName,
      isYou: m.ownerId === currentUserId,
      seasonsPlayed: seasonsPlayed[m.ownerId] ?? 0,
      weakest: worst && worst.edge < 0 ? worst.pos : '—',
      avg: present.length > 0 ? present.reduce((s, e) => s + e.edge, 0) / present.length : null,
    };
    for (const p of activePositions) row[p] = perPos[p] ?? null;
    return row;
  }), [managers, avgPositionalEdge, activePositions, seasonsPlayed, currentUserId]);

  const { sorted, order, orderBy, handleSort } = useTableSort<MatrixRow>(matrixRows, 'avg', 'asc');

  const matrixMaxAbs = React.useMemo(() => {
    let max = 0;
    for (const r of matrixRows) {
      for (const p of activePositions) {
        const v = r[p];
        if (typeof v === 'number') max = Math.max(max, Math.abs(v));
      }
    }
    return max;
  }, [matrixRows, activePositions]);

  // ---- Panel 2: the same managers season by season ----
  const metricMeta = SEASON_METRICS.find(m => m.value === metric) ?? SEASON_METRICS[0];

  /**
   * Values are shown raw but coloured by deviation from that season's mean.
   * Lineup efficiency sits in a narrow band (most managers land in the 90s), so
   * colouring on the absolute number would paint the whole grid one shade and
   * hide exactly the differences this panel exists to surface.
   */
  const seasonMeans = React.useMemo(() => {
    const means: Record<string, number | null> = {};
    for (const s of seasons) {
      const vals: number[] = [];
      for (const m of managers) {
        const v = cells[m.ownerId]?.[s]?.[metric];
        if (v != null) vals.push(v);
      }
      means[s] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    return means;
  }, [seasons, managers, cells, metric]);

  const stripMaxAbs = React.useMemo(() => {
    let max = 0;
    for (const m of managers) {
      for (const s of seasons) {
        const v = cells[m.ownerId]?.[s]?.[metric];
        const mean = seasonMeans[s];
        if (v != null && mean != null) max = Math.max(max, Math.abs(v - mean));
      }
    }
    return max;
  }, [managers, seasons, cells, metric, seasonMeans]);

  const trendFor = React.useCallback((ownerId: string): number | null => {
    const withData = seasons
      .map(s => cells[ownerId]?.[s]?.[metric])
      .filter((v): v is number => v != null);
    if (withData.length < 2) return null;
    return withData[withData.length - 1] - withData[0];
  }, [seasons, cells, metric]);

  if (managers.length === 0 || seasons.length === 0) return null;

  const spanLabel = seasons.length === 1
    ? seasons[0]
    : `${seasons[0]}–${seasons[seasons.length - 1]}`;

  return (
    <Box>
      {/* ---------------- Where managers struggle ---------------- */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>Where Managers Struggle</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Points per start against the league average for the same season, then averaged over {spanLabel}.
          Green is above the league, red below. Sort any position to find who is weakest there.
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sortDirection={orderBy === 'displayName' ? order : false}>
                  <TableSortLabel
                    active={orderBy === 'displayName'}
                    direction={orderBy === 'displayName' ? order : 'asc'}
                    onClick={() => handleSort('displayName')}
                  >
                    Manager
                  </TableSortLabel>
                </TableCell>
                {activePositions.map(p => (
                  <TableCell key={p} align="center" sortDirection={orderBy === p ? order : false}>
                    <TableSortLabel
                      active={orderBy === p}
                      direction={orderBy === p ? order : 'asc'}
                      onClick={() => handleSort(p)}
                    >
                      {p}
                    </TableSortLabel>
                  </TableCell>
                ))}
                <TableCell align="center" sortDirection={orderBy === 'avg' ? order : false}>
                  <TableSortLabel
                    active={orderBy === 'avg'}
                    direction={orderBy === 'avg' ? order : 'asc'}
                    onClick={() => handleSort('avg')}
                  >
                    Overall
                  </TableSortLabel>
                </TableCell>
                <TableCell align="center">Weakest</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map(row => (
                <TableRow
                  key={row.ownerId}
                  sx={row.isYou ? { bgcolor: 'action.hover' } : undefined}
                >
                  <TableCell sx={{ fontWeight: row.isYou ? 'bold' : 'regular', whiteSpace: 'nowrap' }}>
                    {row.displayName}
                    {row.isYou && <Chip label="You" size="small" color="primary" sx={{ ml: 1, height: 18 }} />}
                    {row.seasonsPlayed < seasons.length && (
                      <Tooltip title={`Only ${row.seasonsPlayed} of ${seasons.length} seasons`}>
                        <Chip label={`${row.seasonsPlayed}/${seasons.length}`} size="small" variant="outlined" sx={{ ml: 1, height: 18 }} />
                      </Tooltip>
                    )}
                  </TableCell>
                  {activePositions.map(p => {
                    const v = typeof row[p] === 'number' ? (row[p] as number) : null;
                    return (
                      <TableCell
                        key={p}
                        align="center"
                        sx={{
                          bgcolor: cellColor(v, matrixMaxAbs),
                          color: valueColor(v),
                          fontWeight: 'bold',
                          transition: 'background-color 0.3s',
                        }}
                      >
                        {fmt(v, 1, true)}
                      </TableCell>
                    );
                  })}
                  <TableCell align="center" sx={{ color: valueColor(row.avg), fontWeight: 'bold' }}>
                    {fmt(row.avg, 1, true)}
                  </TableCell>
                  <TableCell align="center">
                    {row.weakest === '—'
                      ? <Typography variant="body2" color="text.secondary">—</Typography>
                      : <Chip label={row.weakest} size="small" color="error" variant="outlined" />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* ---------------- Season by season ---------------- */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 1 }}>
          <Typography variant="h6">Season by Season</Typography>
          <ToggleButtonGroup
            value={metric}
            exclusive
            size="small"
            onChange={(_, v: SeasonMetric | null) => v && setMetric(v)}
          >
            {SEASON_METRICS.map(m => (
              <ToggleButton key={m.value} value={m.value}>{m.label}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {metricMeta.label} per season. Figures are as-is; shading compares each manager to that
          season&apos;s league average, so a green cell means they beat their peers that year.
          Trend is the change from their first season here to their most recent.
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Manager</TableCell>
                {seasons.map(s => (
                  <TableCell key={s} align="center" sx={{ fontWeight: 'bold' }}>{s}</TableCell>
                ))}
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>Trend</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map(row => {
                const trend = trendFor(row.ownerId);
                return (
                  <TableRow key={row.ownerId} sx={row.isYou ? { bgcolor: 'action.hover' } : undefined}>
                    <TableCell sx={{ fontWeight: row.isYou ? 'bold' : 'regular', whiteSpace: 'nowrap' }}>
                      {row.displayName}
                    </TableCell>
                    {seasons.map(s => {
                      const v = cells[row.ownerId]?.[s]?.[metric] ?? null;
                      const mean = seasonMeans[s];
                      const deviation = v != null && mean != null ? v - mean : null;
                      return (
                        <TableCell
                          key={s}
                          align="center"
                          sx={{
                            bgcolor: cellColor(deviation, stripMaxAbs),
                            color: valueColor(deviation),
                            fontWeight: 'bold',
                            transition: 'background-color 0.3s',
                          }}
                        >
                          {v == null ? '—' : `${fmt(v, metricMeta.digits, metric === 'avgPositionalEdge')}${metricMeta.unit}`}
                        </TableCell>
                      );
                    })}
                    <TableCell align="center">
                      {trend == null ? (
                        <Typography variant="body2" color="text.secondary">—</Typography>
                      ) : Math.abs(trend) < TREND_DEADBAND ? (
                        <Tooltip title="Essentially flat"><RemoveIcon fontSize="small" color="disabled" /></Tooltip>
                      ) : trend > 0 ? (
                        <Tooltip title={`Up ${trend.toFixed(1)}${metricMeta.unit} since ${seasons[0]}`}>
                          <ArrowUpwardIcon fontSize="small" color="success" />
                        </Tooltip>
                      ) : (
                        <Tooltip title={`Down ${Math.abs(trend).toFixed(1)}${metricMeta.unit} since ${seasons[0]}`}>
                          <ArrowDownwardIcon fontSize="small" color="error" />
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
