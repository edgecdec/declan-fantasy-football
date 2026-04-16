'use client';

import * as React from 'react';
import {
  Paper, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TableSortLabel, Avatar, Box,
} from '@mui/material';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { SeasonDecisionSummary } from '@/types/lineup';

const RAINBOW_BG = 'linear-gradient(90deg, red, orange, yellow, green, dodgerblue, blueviolet, red)';

type SortField = 'rank' | 'name' | 'accuracy' | 'pointsLeft' | 'optimalWeeks';
type SortDir = 'asc' | 'desc';

type ManagerDecisionRow = {
  userId: string;
  displayName: string;
  avatar: string;
  accuracy: number;
  pointsLeft: number;
  totalWeeks: number;
  optimalWeeks: number;
};

export default function LeagueDecisionsTable({
  summaries, currentUserId, leagueId,
}: {
  summaries: SeasonDecisionSummary[];
  currentUserId?: string;
  leagueId: string;
}) {
  const [sortField, setSortField] = React.useState<SortField>('accuracy');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');
  const [userMap, setUserMap] = React.useState<Record<string, { displayName: string; avatar: string }>>({});

  // Fetch user display names and avatars
  React.useEffect(() => {
    SleeperService.getLeagueUsers(leagueId).then(users => {
      SleeperService.getRosters(leagueId).then(rosters => {
        const map: Record<string, { displayName: string; avatar: string }> = {};
        for (const roster of rosters) {
          const u = users.find(usr => usr.user_id === roster.owner_id);
          if (u && roster.owner_id) {
            map[roster.owner_id] = { displayName: u.display_name, avatar: u.avatar || '' };
          }
        }
        setUserMap(map);
      });
    });
  }, [leagueId]);

  const rows: ManagerDecisionRow[] = React.useMemo(() =>
    summaries.map(s => {
      const uid = s.userId || '';
      const meta = userMap[uid];
      const totalWeeks = s.weeklyDecisions.length;
      const optimalWeeks = s.weeklyDecisions.filter(w => w.isOptimal).length;
      return {
        userId: uid,
        displayName: meta?.displayName || uid,
        avatar: meta?.avatar || '',
        accuracy: s.decisionAccuracy,
        pointsLeft: s.totalPointsLeftOnBench,
        totalWeeks,
        optimalWeeks,
      };
    }),
  [summaries, userMap]);

  const sorted = React.useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const s = [...rows].sort((a, b) => {
      switch (sortField) {
        case 'name': return a.displayName.localeCompare(b.displayName) * dir;
        case 'accuracy': return (a.accuracy - b.accuracy) * dir;
        case 'pointsLeft': return (a.pointsLeft - b.pointsLeft) * dir;
        case 'optimalWeeks': return (a.optimalWeeks - b.optimalWeeks) * dir;
        default: return 0;
      }
    });
    // Add rank after sort
    return s.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [rows, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    setSortDir(sortField === field && sortDir === 'desc' ? 'asc' : 'desc');
    setSortField(field);
  };

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>Start/Sit Decision Leaderboard</Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={50}>#</TableCell>
              <TableCell>
                <TableSortLabel active={sortField === 'name'} direction={sortField === 'name' ? sortDir : 'asc'} onClick={() => handleSort('name')}>
                  Manager
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={sortField === 'accuracy'} direction={sortField === 'accuracy' ? sortDir : 'asc'} onClick={() => handleSort('accuracy')}>
                  Optimal Lineup Rate
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={sortField === 'optimalWeeks'} direction={sortField === 'optimalWeeks' ? sortDir : 'asc'} onClick={() => handleSort('optimalWeeks')}>
                  Optimal Weeks
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={sortField === 'pointsLeft'} direction={sortField === 'pointsLeft' ? sortDir : 'asc'} onClick={() => handleSort('pointsLeft')}>
                  Proj Pts Left on Bench
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
                  <TableCell>{row.rank}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar src={row.avatar ? `https://sleepercdn.com/avatars/${row.avatar}` : undefined} sx={{ width: 24, height: 24 }}>
                        {row.displayName[0]}
                      </Avatar>
                      {row.displayName}
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ color: row.accuracy >= 50 ? 'success.main' : 'error.main', fontWeight: 600 }}>
                    {row.accuracy.toFixed(1)}%
                  </TableCell>
                  <TableCell align="right">
                    {row.optimalWeeks} / {row.totalWeeks}
                  </TableCell>
                  <TableCell align="right" sx={{ color: row.pointsLeft > 0 ? 'error.main' : 'success.main', fontWeight: 600 }}>
                    {row.pointsLeft > 0 ? `−${row.pointsLeft.toFixed(1)}` : '0.0'}
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
