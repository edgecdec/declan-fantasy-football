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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Box,
  Chip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { TradeEfficiencyResult } from '@/types/trade';
import useTableSort from '@/hooks/useTableSort';

type ManagerTradeStats = {
  username: string;
  totalTrades: number;
  tradesWon: number;
  tradesLost: number;
  totalMargin: number;
  bestMargin: number;
  worstMargin: number;
  trades: ManagerTradeRow[];
};

type ManagerTradeRow = {
  transactionId: string;
  week: number;
  opponent: string;
  myEff: number;
  oppEff: number;
  margin: number;
  trade: TradeEfficiencyResult;
};

function buildManagerStats(trades: TradeEfficiencyResult[], rosterToUsername?: Record<number, string>): ManagerTradeStats[] {
  const map = new Map<string, ManagerTradeStats>();

  // Seed all managers from roster map so 0-trade managers appear
  if (rosterToUsername) {
    for (const username of Object.values(rosterToUsername)) {
      if (!map.has(username)) {
        map.set(username, { username, totalTrades: 0, tradesWon: 0, tradesLost: 0, totalMargin: 0, bestMargin: 0, worstMargin: 0, trades: [] });
      }
    }
  }

  for (const trade of trades) {
    for (let i = 0; i < 2; i++) {
      const mySide = trade.sides[i];
      const oppSide = trade.sides[1 - i];
      const margin = mySide.totalEfficiency - oppSide.totalEfficiency;
      const won = margin > 1;
      const lost = margin < -1;

      const row: ManagerTradeRow = {
        transactionId: trade.transactionId,
        week: trade.week,
        opponent: oppSide.username,
        myEff: mySide.totalEfficiency,
        oppEff: oppSide.totalEfficiency,
        margin,
        trade,
      };

      const existing = map.get(mySide.username);
      if (existing) {
        existing.totalTrades++;
        existing.tradesWon += won ? 1 : 0;
        existing.tradesLost += lost ? 1 : 0;
        existing.totalMargin += margin;
        if (existing.trades.length === 0) {
          existing.bestMargin = margin;
          existing.worstMargin = margin;
        } else {
          existing.bestMargin = Math.max(existing.bestMargin, margin);
          existing.worstMargin = Math.min(existing.worstMargin, margin);
        }
        existing.trades.push(row);
      } else {
        map.set(mySide.username, {
          username: mySide.username,
          totalTrades: 1,
          tradesWon: won ? 1 : 0,
          tradesLost: lost ? 1 : 0,
          totalMargin: margin,
          bestMargin: margin,
          worstMargin: margin,
          trades: [row],
        });
      }
    }
  }

  return Array.from(map.values());
}

function EffVal({ value }: { value: number }) {
  const color = value > 0 ? 'success.main' : value < 0 ? 'error.main' : 'text.secondary';
  return (
    <Typography component="span" sx={{ color, fontWeight: 'bold', fontSize: 'inherit' }}>
      {value > 0 ? '+' : ''}{value.toFixed(1)}
    </Typography>
  );
}

function ManagerTradeDetail({ row }: { row: ManagerTradeRow }) {
  const mySideIdx = row.trade.sides[0].username === row.opponent ? 1 : 0;
  const mySide = row.trade.sides[mySideIdx];
  const oppSide = row.trade.sides[1 - mySideIdx];

  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', py: 1 }}>
      {[mySide, oppSide].map((side) => (
        <Box key={side.username} sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="caption" fontWeight="bold" gutterBottom component="div">
            {side.username} received:
          </Typography>
          {side.players.map((p) => (
            <Box key={p.playerId} sx={{ display: 'flex', justifyContent: 'space-between', px: 1, py: 0.25 }}>
              <Typography variant="body2">{p.name} <Chip label={p.position} size="small" sx={{ height: 16, fontSize: '0.65rem', ml: 0.5 }} /></Typography>
              <EffVal value={p.totalSeasonEfficiency} />
            </Box>
          ))}
          {(side.draftPicks ?? []).map((dp, i) => (
            <Box key={`pick-${i}`} sx={{ display: 'flex', justifyContent: 'space-between', px: 1, py: 0.25 }}>
              <Typography variant="body2">
                {dp.season} Rd {dp.round}
                {dp.resolvedPlayer && <Typography component="span" variant="body2" color="text.secondary"> → {dp.resolvedPlayer}</Typography>}
              </Typography>
              {dp.efficiency ? <EffVal value={dp.efficiency.totalSeasonEfficiency} /> : <Typography variant="body2" color="text.secondary">N/A</Typography>}
            </Box>
          ))}
          {(side.faabItems ?? []).map((fb, i) => (
            <Box key={`faab-${i}`} sx={{ px: 1, py: 0.25 }}>
              <Typography variant="body2">${fb.amount} FAAB</Typography>
            </Box>
          ))}
          <Box sx={{ px: 1, pt: 0.5, borderTop: 1, borderColor: 'divider', mt: 0.5 }}>
            <Typography variant="body2">Total: <EffVal value={side.totalEfficiency} /></Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function ManagerTrades({ stats }: { stats: ManagerTradeStats }) {
  const sorted = React.useMemo(
    () => [...stats.trades].sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin)),
    [stats.trades]
  );

  return (
    <Box>
      {sorted.map((row) => (
        <Accordion key={row.transactionId} disableGutters sx={{ '&:before': { display: 'none' }, bgcolor: 'transparent' }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
              <Chip label={`Wk ${row.week}`} size="small" sx={{ height: 22, fontSize: '0.75rem' }} />
              <Typography variant="body2" sx={{ flex: 1 }}>vs {row.opponent}</Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">{row.myEff.toFixed(1)} vs {row.oppEff.toFixed(1)}</Typography>
                <EffVal value={row.margin} />
                {row.margin > 1 ? (
                  <Chip label="W" size="small" color="success" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 'bold' }} />
                ) : row.margin < -1 ? (
                  <Chip label="L" size="small" color="error" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 'bold' }} />
                ) : (
                  <Chip label="—" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                )}
              </Box>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <ManagerTradeDetail row={row} />
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}

export default function ManagerTradeLeaderboard({ trades, rosterToUsername }: { trades: TradeEfficiencyResult[]; rosterToUsername?: Record<number, string> }) {
  const stats = React.useMemo(() => buildManagerStats(trades, rosterToUsername), [trades, rosterToUsername]);
  const { sorted, order, orderBy, handleSort } = useTableSort(stats, 'totalMargin');
  const [expanded, setExpanded] = React.useState<string | false>(false);

  if (stats.length === 0) return null;

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <EmojiEventsIcon color="primary" />
        <Typography variant="h6">Manager Trade Leaderboard</Typography>
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
                <TableSortLabel active={orderBy === 'bestMargin'} direction={orderBy === 'bestMargin' ? order : 'asc'} onClick={() => handleSort('bestMargin')}>Best</TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={orderBy === 'worstMargin'} direction={orderBy === 'worstMargin' ? order : 'asc'} onClick={() => handleSort('worstMargin')}>Worst</TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((m, idx) => (
              <React.Fragment key={m.username}>
                <TableRow
                  hover
                  sx={{ cursor: 'pointer', '& > td': { borderBottom: expanded === m.username ? 0 : undefined } }}
                  onClick={() => setExpanded(expanded === m.username ? false : m.username)}
                >
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>{m.username}</TableCell>
                  <TableCell align="center">{m.totalTrades}</TableCell>
                  <TableCell align="center" sx={{ color: 'success.main' }}>{m.tradesWon}</TableCell>
                  <TableCell align="center" sx={{ color: 'error.main' }}>{m.tradesLost}</TableCell>
                  <TableCell align="right"><EffVal value={m.totalMargin} /></TableCell>
                  <TableCell align="right">{m.totalTrades > 0 ? <EffVal value={m.bestMargin} /> : <Typography component="span" color="text.secondary" fontSize="inherit">N/A</Typography>}</TableCell>
                  <TableCell align="right">{m.totalTrades > 0 ? <EffVal value={m.worstMargin} /> : <Typography component="span" color="text.secondary" fontSize="inherit">N/A</Typography>}</TableCell>
                </TableRow>
                {expanded === m.username && (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ p: 0, bgcolor: 'action.hover' }}>
                      <ManagerTrades stats={m} />
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
