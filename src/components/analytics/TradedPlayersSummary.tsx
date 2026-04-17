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
  Chip,
  Box,
} from '@mui/material';
import { TradeEfficiencyResult } from '@/types/trade';
import { getPositionColor } from '@/constants/colors';
import useTableSort from '@/hooks/useTableSort';

type AggregatedPlayer = {
  playerId: string;
  name: string;
  position: string;
  timesTraded: number;
  teamEff: number;
  totalEff: number;
  tradedBy: string[];
  tradedTo: string[];
};

function buildAggregatedPlayers(trades: TradeEfficiencyResult[]): AggregatedPlayer[] {
  const map = new Map<string, AggregatedPlayer>();

  for (const trade of trades) {
    for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
      const receivingSide = trade.sides[sideIdx];
      const givingSide = trade.sides[1 - sideIdx];

      for (const p of receivingSide.players) {
        const existing = map.get(p.playerId);
        if (existing) {
          existing.timesTraded++;
          existing.teamEff += p.totalEfficiency;
          existing.totalEff += p.totalSeasonEfficiency;
          if (!existing.tradedBy.includes(givingSide.username)) existing.tradedBy.push(givingSide.username);
          if (!existing.tradedTo.includes(receivingSide.username)) existing.tradedTo.push(receivingSide.username);
        } else {
          map.set(p.playerId, {
            playerId: p.playerId,
            name: p.name,
            position: p.position,
            timesTraded: 1,
            teamEff: p.totalEfficiency,
            totalEff: p.totalSeasonEfficiency,
            tradedBy: [givingSide.username],
            tradedTo: [receivingSide.username],
          });
        }
      }

      for (const dp of receivingSide.draftPicks ?? []) {
        if (!dp.resolvedPlayerId || !dp.efficiency) continue;
        const existing = map.get(dp.resolvedPlayerId);
        if (existing) {
          existing.timesTraded++;
          existing.teamEff += dp.efficiency.totalEfficiency;
          existing.totalEff += dp.efficiency.totalSeasonEfficiency;
          if (!existing.tradedBy.includes(givingSide.username)) existing.tradedBy.push(givingSide.username);
          if (!existing.tradedTo.includes(receivingSide.username)) existing.tradedTo.push(receivingSide.username);
        } else {
          map.set(dp.resolvedPlayerId, {
            playerId: dp.resolvedPlayerId,
            name: dp.efficiency.name,
            position: dp.efficiency.position,
            timesTraded: 1,
            teamEff: dp.efficiency.totalEfficiency,
            totalEff: dp.efficiency.totalSeasonEfficiency,
            tradedBy: [givingSide.username],
            tradedTo: [receivingSide.username],
          });
        }
      }
    }
  }

  return Array.from(map.values());
}

function EffVal({ value }: { value: number }) {
  const color = value > 0 ? 'success.main' : value < 0 ? 'error.main' : 'text.secondary';
  return (
    <Typography component="span" sx={{ color, fontWeight: 'bold' }}>
      {value > 0 ? '+' : ''}{value.toFixed(1)}
    </Typography>
  );
}

export default function TradedPlayersSummary({ trades }: { trades: TradeEfficiencyResult[] }) {
  const aggregated = React.useMemo(() => buildAggregatedPlayers(trades), [trades]);
  const { sorted, order, orderBy, handleSort } = useTableSort(aggregated, 'totalEff');

  if (aggregated.length === 0) return null;

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Typography variant="h6" gutterBottom>Traded Players Summary</Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>
                <TableSortLabel active={orderBy === 'name'} direction={orderBy === 'name' ? order : 'asc'} onClick={() => handleSort('name')}>Player</TableSortLabel>
              </TableCell>
              <TableCell align="center">Pos</TableCell>
              <TableCell align="center">
                <TableSortLabel active={orderBy === 'timesTraded'} direction={orderBy === 'timesTraded' ? order : 'asc'} onClick={() => handleSort('timesTraded')}>#</TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={orderBy === 'teamEff'} direction={orderBy === 'teamEff' ? order : 'asc'} onClick={() => handleSort('teamEff')}>Team Eff</TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={orderBy === 'totalEff'} direction={orderBy === 'totalEff' ? order : 'asc'} onClick={() => handleSort('totalEff')}>Total Eff</TableSortLabel>
              </TableCell>
              <TableCell>Traded By</TableCell>
              <TableCell>Traded To</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((p) => (
              <TableRow key={p.playerId}>
                <TableCell>{p.name}</TableCell>
                <TableCell align="center">
                  <Chip label={p.position} size="small" sx={{ bgcolor: getPositionColor(p.position), color: '#fff', fontWeight: 'bold', height: 20, fontSize: '0.7rem' }} />
                </TableCell>
                <TableCell align="center">{p.timesTraded}</TableCell>
                <TableCell align="right"><EffVal value={p.teamEff} /></TableCell>
                <TableCell align="right"><EffVal value={p.totalEff} /></TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {p.tradedBy.map((u) => <Chip key={u} label={u} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />)}
                  </Box>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {p.tradedTo.map((u) => <Chip key={u} label={u} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />)}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
