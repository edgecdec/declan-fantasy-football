'use client';

import * as React from 'react';
import {
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Box,
  LinearProgress,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import { HistoricalTradeData, SeasonTradeStats } from '@/types/trade';
import useTableSort from '@/hooks/useTableSort';

type AllTimeManagerStats = {
  username: string;
  totalTrades: number;
  tradesWon: number;
  tradesLost: number;
  totalMargin: number;
  bestMargin: number;
  worstMargin: number;
  seasonsActive: number;
};

function EffVal({ value }: { value: number }) {
  const color = value > 0 ? 'success.main' : value < 0 ? 'error.main' : 'text.secondary';
  return (
    <Typography component="span" sx={{ color, fontWeight: 'bold', fontSize: 'inherit' }}>
      {value > 0 ? '+' : ''}{value.toFixed(1)}
    </Typography>
  );
}

function buildAllTimeStats(seasons: SeasonTradeStats[]): AllTimeManagerStats[] {
  const map = new Map<string, AllTimeManagerStats>();
  for (const season of seasons) {
    for (const [username, s] of Object.entries(season.managerStats)) {
      const existing = map.get(username);
      if (existing) {
        existing.totalTrades += s.totalTrades;
        existing.tradesWon += s.tradesWon;
        existing.tradesLost += s.tradesLost;
        existing.totalMargin += s.totalMargin;
        existing.seasonsActive++;
        // Best/worst need per-trade granularity — approximate from season totals
        // We'll use the season's total margin as a proxy for best/worst season
      } else {
        map.set(username, {
          username,
          totalTrades: s.totalTrades,
          tradesWon: s.tradesWon,
          tradesLost: s.tradesLost,
          totalMargin: s.totalMargin,
          bestMargin: s.totalMargin,
          worstMargin: s.totalMargin,
          seasonsActive: 1,
        });
      }
    }
  }
  // Recalculate best/worst season margin per manager
  for (const season of seasons) {
    for (const [username, s] of Object.entries(season.managerStats)) {
      const m = map.get(username);
      if (!m) continue;
      if (s.totalMargin > m.bestMargin) m.bestMargin = s.totalMargin;
      if (s.totalMargin < m.worstMargin) m.worstMargin = s.totalMargin;
    }
  }
  return Array.from(map.values());
}

function AllTimeLeaderboard({ data }: { data: HistoricalTradeData }) {
  const stats = React.useMemo(() => buildAllTimeStats(data.seasons), [data.seasons]);
  const { sorted, order, orderBy, handleSort } = useTableSort(stats, 'totalMargin');

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <HistoryIcon color="primary" />
        <Typography variant="h6">All-Time Trade Leaderboard</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          ({data.seasons.length} prior season{data.seasons.length !== 1 ? 's' : ''})
        </Typography>
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40 }}>#</TableCell>
              <TableCell>
                <TableSortLabel active={orderBy === 'username'} direction={orderBy === 'username' ? order : 'asc'} onClick={() => handleSort('username')}>Manager</TableSortLabel>
              </TableCell>
              <TableCell align="center">
                <TableSortLabel active={orderBy === 'seasonsActive'} direction={orderBy === 'seasonsActive' ? order : 'asc'} onClick={() => handleSort('seasonsActive')}>Seasons</TableSortLabel>
              </TableCell>
              <TableCell align="center">
                <TableSortLabel active={orderBy === 'totalTrades'} direction={orderBy === 'totalTrades' ? order : 'asc'} onClick={() => handleSort('totalTrades')}>Trades</TableSortLabel>
              </TableCell>
              <TableCell align="center">
                <TableSortLabel active={orderBy === 'tradesWon'} direction={orderBy === 'tradesWon' ? order : 'asc'} onClick={() => handleSort('tradesWon')}>Won</TableSortLabel>
              </TableCell>
              <TableCell align="center">
                <TableSortLabel active={orderBy === 'tradesLost'} direction={orderBy === 'tradesLost' ? order : 'asc'} onClick={() => handleSort('tradesLost')}>Lost</TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={orderBy === 'totalMargin'} direction={orderBy === 'totalMargin' ? order : 'asc'} onClick={() => handleSort('totalMargin')}>Total +/-</TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={orderBy === 'bestMargin'} direction={orderBy === 'bestMargin' ? order : 'asc'} onClick={() => handleSort('bestMargin')}>Best Season</TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={orderBy === 'worstMargin'} direction={orderBy === 'worstMargin' ? order : 'asc'} onClick={() => handleSort('worstMargin')}>Worst Season</TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((m, idx) => (
              <TableRow key={m.username} hover>
                <TableCell>{idx + 1}</TableCell>
                <TableCell sx={{ fontWeight: 'bold' }}>{m.username}</TableCell>
                <TableCell align="center">{m.seasonsActive}</TableCell>
                <TableCell align="center">{m.totalTrades}</TableCell>
                <TableCell align="center" sx={{ color: 'success.main' }}>{m.tradesWon}</TableCell>
                <TableCell align="center" sx={{ color: 'error.main' }}>{m.tradesLost}</TableCell>
                <TableCell align="right"><EffVal value={m.totalMargin} /></TableCell>
                <TableCell align="right"><EffVal value={m.bestMargin} /></TableCell>
                <TableCell align="right"><EffVal value={m.worstMargin} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

function SeasonBreakdownTable({ data }: { data: HistoricalTradeData }) {
  const allManagers = React.useMemo(() => {
    const set = new Set<string>();
    for (const s of data.seasons) {
      for (const username of Object.keys(s.managerStats)) set.add(username);
    }
    return Array.from(set).sort();
  }, [data.seasons]);

  const sortedSeasons = React.useMemo(
    () => [...data.seasons].sort((a, b) => b.season.localeCompare(a.season)),
    [data.seasons],
  );

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Typography variant="h6" gutterBottom>Year-by-Year Breakdown</Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Season</TableCell>
              <TableCell align="center">Trades</TableCell>
              {allManagers.map((m) => (
                <TableCell key={m} align="right">{m}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedSeasons.map((s) => (
              <TableRow key={s.season} hover>
                <TableCell sx={{ fontWeight: 'bold' }}>{s.season}</TableCell>
                <TableCell align="center">{s.tradeCount}</TableCell>
                {allManagers.map((m) => {
                  const ms = s.managerStats[m];
                  if (!ms || ms.totalTrades === 0) {
                    return <TableCell key={m} align="right"><Typography variant="body2" color="text.secondary">—</Typography></TableCell>;
                  }
                  return (
                    <TableCell key={m} align="right">
                      <EffVal value={ms.totalMargin} />
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                        ({ms.tradesWon}W-{ms.tradesLost}L)
                      </Typography>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

type Props = {
  data: HistoricalTradeData | null;
  loading: boolean;
};

export default function HistoricalTradeLeaderboard({ data, loading }: Props) {
  if (loading && !data) {
    return (
      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography align="center" gutterBottom>Loading historical trade data...</Typography>
        <LinearProgress />
      </Paper>
    );
  }

  if (!data || data.seasons.length === 0) {
    if (loading) {
      return (
        <Paper sx={{ p: 3, mb: 2 }}>
          <Typography align="center" gutterBottom>Loading historical trade data...</Typography>
          <LinearProgress />
        </Paper>
      );
    }
    return (
      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography align="center" color="text.secondary">No historical trade data found for prior seasons.</Typography>
      </Paper>
    );
  }

  return (
    <>
      {loading && <LinearProgress sx={{ mb: 1 }} />}
      <AllTimeLeaderboard data={data} />
      <SeasonBreakdownTable data={data} />
    </>
  );
}
