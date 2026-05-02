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

function buildAllTimeStats(seasons: SeasonTradeStats[], ownerIdToUsername: Record<string, string>): AllTimeManagerStats[] {
  const map = new Map<string, AllTimeManagerStats>();
  const nameMap = ownerIdToUsername ?? {};
  for (const season of seasons) {
    if (!season?.managerStats) continue;
    for (const [ownerId, s] of Object.entries(season.managerStats)) {
      if (!s) continue;
      const displayName = nameMap[ownerId] || ownerId;
      const existing = map.get(ownerId);
      if (existing) {
        existing.totalTrades += s.totalTrades ?? 0;
        existing.tradesWon += s.tradesWon ?? 0;
        existing.tradesLost += s.tradesLost ?? 0;
        existing.totalMargin += s.totalMargin ?? 0;
        existing.seasonsActive++;
        existing.username = displayName; // always use latest name
      } else {
        map.set(ownerId, {
          username: displayName,
          totalTrades: s.totalTrades ?? 0,
          tradesWon: s.tradesWon ?? 0,
          tradesLost: s.tradesLost ?? 0,
          totalMargin: s.totalMargin ?? 0,
          bestMargin: s.totalMargin ?? 0,
          worstMargin: s.totalMargin ?? 0,
          seasonsActive: 1,
        });
      }
    }
  }
  // Recalculate best/worst season margin per manager
  for (const season of seasons) {
    if (!season?.managerStats) continue;
    for (const [ownerId, s] of Object.entries(season.managerStats)) {
      if (!s) continue;
      const m = map.get(ownerId);
      if (!m) continue;
      if ((s.totalMargin ?? 0) > m.bestMargin) m.bestMargin = s.totalMargin ?? 0;
      if ((s.totalMargin ?? 0) < m.worstMargin) m.worstMargin = s.totalMargin ?? 0;
    }
  }
  return Array.from(map.values());
}

function AllTimeLeaderboard({ data }: { data: HistoricalTradeData }) {
  const stats = React.useMemo(() => buildAllTimeStats(data.seasons, data.ownerIdToUsername), [data.seasons, data.ownerIdToUsername]);
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
  const allManagerIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const s of data.seasons) {
      if (!s?.managerStats) continue;
      for (const ownerId of Object.keys(s.managerStats)) set.add(ownerId);
    }
    const nameMap = data.ownerIdToUsername ?? {};
    return Array.from(set).sort((a, b) => {
      const nameA = nameMap[a] || a;
      const nameB = nameMap[b] || b;
      return nameA.localeCompare(nameB);
    });
  }, [data.seasons, data.ownerIdToUsername]);

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
              {allManagerIds.map((id) => (
                <TableCell key={id} align="right">{(data.ownerIdToUsername ?? {})[id] || id}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedSeasons.map((s) => (
              <TableRow key={s.season} hover>
                <TableCell sx={{ fontWeight: 'bold' }}>{s.season}</TableCell>
                <TableCell align="center">{s.tradeCount}</TableCell>
                {allManagerIds.map((id) => {
                  const ms = (s.managerStats ?? {})[id];
                  if (!ms || ms.totalTrades === 0) {
                    return <TableCell key={id} align="right"><Typography variant="body2" color="text.secondary">—</Typography></TableCell>;
                  }
                  return (
                    <TableCell key={id} align="right">
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
