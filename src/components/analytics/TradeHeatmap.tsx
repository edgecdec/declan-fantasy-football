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
  Box,
  Tooltip,
} from '@mui/material';
import GridOnIcon from '@mui/icons-material/GridOn';
import { TradeEfficiencyResult } from '@/types/trade';

type H2HCell = {
  margin: number;
  tradeCount: number;
  bestMargin: number;
  worstMargin: number;
};

function buildH2HMatrix(trades: TradeEfficiencyResult[]): {
  managers: string[];
  matrix: Map<string, H2HCell>;
  maxAbs: number;
} {
  const pairMap = new Map<string, H2HCell>();
  const managerSet = new Set<string>();

  for (const trade of trades) {
    if (!trade?.sides?.[0] || !trade?.sides?.[1]) continue;
    const [a, b] = trade.sides;
    const aId = a.ownerId || a.username;
    const bId = b.ownerId || b.username;
    if (!aId || !bId) continue;
    managerSet.add(aId);
    managerSet.add(bId);

    const margin = a.totalEfficiency - b.totalEfficiency;

    const keyAB = `${aId}|${bId}`;
    const cellAB = pairMap.get(keyAB) ?? { margin: 0, tradeCount: 0, bestMargin: -Infinity, worstMargin: Infinity };
    cellAB.margin += margin;
    cellAB.tradeCount++;
    cellAB.bestMargin = Math.max(cellAB.bestMargin, margin);
    cellAB.worstMargin = Math.min(cellAB.worstMargin, margin);
    pairMap.set(keyAB, cellAB);

    const keyBA = `${bId}|${aId}`;
    const cellBA = pairMap.get(keyBA) ?? { margin: 0, tradeCount: 0, bestMargin: -Infinity, worstMargin: Infinity };
    cellBA.margin -= margin;
    cellBA.tradeCount++;
    cellBA.bestMargin = Math.max(cellBA.bestMargin, -margin);
    cellBA.worstMargin = Math.min(cellBA.worstMargin, -margin);
    pairMap.set(keyBA, cellBA);
  }

  let maxAbs = 0;
  for (const cell of pairMap.values()) {
    if (Math.abs(cell.margin) > maxAbs) maxAbs = Math.abs(cell.margin);
  }

  const managers = Array.from(managerSet).sort();
  return { managers, matrix: pairMap, maxAbs };
}

function getCellColor(value: number, maxAbs: number): string {
  if (maxAbs === 0) return 'transparent';
  const intensity = Math.min(Math.abs(value) / maxAbs, 1);
  const alpha = 0.15 + intensity * 0.55;
  return value > 0
    ? `rgba(102, 187, 106, ${alpha})`
    : value < 0
      ? `rgba(239, 83, 80, ${alpha})`
      : 'transparent';
}

type Props = {
  historicalTrades: TradeEfficiencyResult[];
  currentTrades: TradeEfficiencyResult[];
  ownerIdToUsername?: Record<string, string>;
};

export default function TradeHeatmap({ historicalTrades, currentTrades, ownerIdToUsername = {} }: Props) {
  const allTrades = React.useMemo(
    () => [...historicalTrades, ...currentTrades],
    [historicalTrades, currentTrades],
  );

  const { managers, matrix, maxAbs } = React.useMemo(
    () => buildH2HMatrix(allTrades),
    [allTrades],
  );

  if (managers.length < 2) return null;

  const getName = (id: string) => ownerIdToUsername[id] || id;

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <GridOnIcon color="primary" />
        <Typography variant="h6">Head-to-Head Trade Matrix</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Total +/- from all trades between each pair of managers. Green = row manager won, red = lost.
      </Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 2 }} />
              {managers.map((m) => (
                <TableCell
                  key={m}
                  align="center"
                  sx={{ fontWeight: 'bold', fontSize: '0.7rem', whiteSpace: 'nowrap', px: 1 }}
                >
                  {getName(m)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {managers.map((row) => (
              <TableRow key={row}>
                <TableCell
                  sx={{
                    fontWeight: 'bold',
                    fontSize: '0.75rem',
                    whiteSpace: 'nowrap',
                    position: 'sticky',
                    left: 0,
                    bgcolor: 'background.paper',
                    zIndex: 1,
                  }}
                >
                  {getName(row)}
                </TableCell>
                {managers.map((col) => {
                  if (row === col) {
                    return (
                      <TableCell
                        key={col}
                        align="center"
                        sx={{ bgcolor: 'action.disabledBackground', px: 1 }}
                      >
                        —
                      </TableCell>
                    );
                  }
                  const cell = matrix.get(`${row}|${col}`);
                  if (!cell || cell.tradeCount === 0) {
                    return (
                      <TableCell key={col} align="center" sx={{ color: 'text.disabled', px: 1 }}>
                        —
                      </TableCell>
                    );
                  }
                  return (
                    <Tooltip
                      key={col}
                      arrow
                      title={
                        <Box>
                          <Typography variant="body2" fontWeight="bold">
                            {getName(row)} vs {getName(col)}
                          </Typography>
                          <Typography variant="body2">
                            Trades: {cell.tradeCount}
                          </Typography>
                          <Typography variant="body2">
                            Total +/-: {cell.margin > 0 ? '+' : ''}{cell.margin.toFixed(1)}
                          </Typography>
                          <Typography variant="body2">
                            Best: {cell.bestMargin > 0 ? '+' : ''}{cell.bestMargin.toFixed(1)}
                          </Typography>
                          <Typography variant="body2">
                            Worst: {cell.worstMargin > 0 ? '+' : ''}{cell.worstMargin.toFixed(1)}
                          </Typography>
                        </Box>
                      }
                    >
                      <TableCell
                        align="center"
                        sx={{
                          bgcolor: getCellColor(cell.margin, maxAbs),
                          fontWeight: 'bold',
                          fontSize: '0.75rem',
                          color: cell.margin > 0 ? 'success.main' : cell.margin < 0 ? 'error.main' : 'text.secondary',
                          cursor: 'help',
                          px: 1,
                          transition: 'background-color 0.3s',
                        }}
                      >
                        {cell.margin > 0 ? '+' : ''}{cell.margin.toFixed(1)}
                      </TableCell>
                    </Tooltip>
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
