'use client';

import * as React from 'react';
import {
  Paper, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TableSortLabel, Avatar, Box,
} from '@mui/material';
import { LeagueBenchmarkResult } from '@/services/stats/positionalBenchmarks';
import { getPositionColor } from '@/constants/colors';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
const RAINBOW_BG = 'linear-gradient(90deg, red, orange, yellow, green, dodgerblue, blueviolet, red)';

type SortField = 'name' | 'total' | (typeof POSITIONS)[number];
type SortDir = 'asc' | 'desc';

type ManagerRow = {
  userId: string;
  displayName: string;
  avatar: string;
  /** Efficiency diff vs league avg per position */
  posDiff: Record<string, number>;
  /** Total efficiency diff across all positions */
  totalDiff: number;
};

function buildRows(result: LeagueBenchmarkResult): ManagerRow[] {
  return Object.entries(result.allRosterStats).map(([userId, posStats]) => {
    const meta = result.rosterMeta[userId];
    let totalDiff = 0;
    const posDiff: Record<string, number> = {};
    for (const pos of POSITIONS) {
      const user = posStats[pos]?.avgPointsPerStarter || 0;
      const league = result.leagueAverageStats[pos]?.avgPointsPerStarter || 0;
      const diff = user - league;
      posDiff[pos] = diff;
      totalDiff += diff;
    }
    return {
      userId,
      displayName: meta?.displayName || 'Unknown',
      avatar: meta?.avatar || '',
      posDiff,
      totalDiff,
    };
  });
}

export default function LeagueEfficiencyTable({
  result, currentUserId,
}: {
  result: LeagueBenchmarkResult;
  currentUserId?: string;
}) {
  const [sortField, setSortField] = React.useState<SortField>('total');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');

  const rows = React.useMemo(() => buildRows(result), [result]);

  const sorted = React.useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortField === 'name') return a.displayName.localeCompare(b.displayName) * dir;
      if (sortField === 'total') return (a.totalDiff - b.totalDiff) * dir;
      return ((a.posDiff[sortField] || 0) - (b.posDiff[sortField] || 0)) * dir;
    });
  }, [rows, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    setSortDir(sortField === field && sortDir === 'desc' ? 'asc' : 'desc');
    setSortField(field);
  };

  const colorForDiff = (diff: number) => diff > 0 ? 'success.main' : diff < 0 ? 'error.main' : 'text.secondary';

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>Positional Efficiency vs League Average (per starter)</Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>
                <TableSortLabel active={sortField === 'name'} direction={sortField === 'name' ? sortDir : 'asc'} onClick={() => handleSort('name')}>
                  Manager
                </TableSortLabel>
              </TableCell>
              {POSITIONS.map(pos => (
                <TableCell key={pos} align="right">
                  <TableSortLabel active={sortField === pos} direction={sortField === pos ? sortDir : 'asc'} onClick={() => handleSort(pos)}>
                    <Box component="span" sx={{ color: getPositionColor(pos), fontWeight: 700 }}>{pos}</Box>
                  </TableSortLabel>
                </TableCell>
              ))}
              <TableCell align="right">
                <TableSortLabel active={sortField === 'total'} direction={sortField === 'total' ? sortDir : 'asc'} onClick={() => handleSort('total')}>
                  Total
                </TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map(row => {
              const isCurrentUser = row.userId === currentUserId;
              return (
                <TableRow
                  key={row.userId}
                  hover
                  sx={isCurrentUser ? {
                    backgroundImage: RAINBOW_BG,
                    backgroundSize: '400% 100%',
                    animation: 'rainbowSlide 3.5s linear infinite',
                    '@keyframes rainbowSlide': { '0%': { backgroundPosition: '0% 50%' }, '100%': { backgroundPosition: '400% 50%' } },
                    '& .MuiTableCell-root': { bgcolor: 'transparent', fontWeight: 700 },
                  } : undefined}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar src={row.avatar ? `https://sleepercdn.com/avatars/${row.avatar}` : undefined} sx={{ width: 24, height: 24 }}>
                        {row.displayName[0]}
                      </Avatar>
                      {row.displayName}
                    </Box>
                  </TableCell>
                  {POSITIONS.map(pos => (
                    <TableCell key={pos} align="right" sx={{ color: colorForDiff(row.posDiff[pos]), fontWeight: 600 }}>
                      {row.posDiff[pos] > 0 ? '+' : ''}{row.posDiff[pos].toFixed(1)}
                    </TableCell>
                  ))}
                  <TableCell align="right" sx={{ color: colorForDiff(row.totalDiff), fontWeight: 700 }}>
                    {row.totalDiff > 0 ? '+' : ''}{row.totalDiff.toFixed(1)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
