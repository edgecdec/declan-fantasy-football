'use client';

import * as React from 'react';
import {
  Paper, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TableSortLabel, Avatar, Box,
} from '@mui/material';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { SeasonDecisionSummary } from '@/types/lineup';

const RAINBOW_BG = 'linear-gradient(90deg, red, orange, yellow, green, dodgerblue, blueviolet, red)';

type SortField = 'rank' | 'name' | 'skillEff' | 'netSkill' | 'netSkillWk' | 'optimalWeeks';
type SortDir = 'asc' | 'desc';

type ManagerRow = {
  userId: string;
  displayName: string;
  avatar: string;
  skillEfficiency: number;
  netSkillPlusMinus: number;
  netSkillPerWeek: number;
  optimalWeeks: number;
  totalWeeks: number;
};

export default function LeagueDecisionsTable({
  summaries, currentUserId, leagueId,
}: {
  summaries: SeasonDecisionSummary[];
  currentUserId?: string;
  leagueId: string;
}) {
  const [sortField, setSortField] = React.useState<SortField>('skillEff');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');
  const [userMap, setUserMap] = React.useState<Record<string, { displayName: string; avatar: string }>>({});

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

  const rows: ManagerRow[] = React.useMemo(() =>
    summaries.map(s => {
      const uid = s.userId || '';
      const meta = userMap[uid];
      return {
        userId: uid,
        displayName: meta?.displayName || uid,
        avatar: meta?.avatar || '',
        skillEfficiency: s.skillEfficiency,
        netSkillPlusMinus: s.netSkillPlusMinus,
        netSkillPerWeek: s.netSkillPerWeek,
        optimalWeeks: s.optimalWeeks,
        totalWeeks: s.weeklyDecisions.length,
      };
    }),
  [summaries, userMap]);

  const sorted = React.useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const s = [...rows].sort((a, b) => {
      switch (sortField) {
        case 'name': return a.displayName.localeCompare(b.displayName) * dir;
        case 'skillEff': {
          const diff = a.skillEfficiency - b.skillEfficiency;
          return diff !== 0 ? diff * dir : (a.netSkillPlusMinus - b.netSkillPlusMinus) * dir;
        }
        case 'netSkill': return (a.netSkillPlusMinus - b.netSkillPlusMinus) * dir;
        case 'netSkillWk': return (a.netSkillPerWeek - b.netSkillPerWeek) * dir;
        case 'optimalWeeks': return (a.optimalWeeks - b.optimalWeeks) * dir;
        default: return 0;
      }
    });
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
                <TableSortLabel active={sortField === 'skillEff'} direction={sortField === 'skillEff' ? sortDir : 'asc'} onClick={() => handleSort('skillEff')}>
                  Skill Efficiency %
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={sortField === 'netSkill'} direction={sortField === 'netSkill' ? sortDir : 'asc'} onClick={() => handleSort('netSkill')}>
                  Net Skill +/−
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={sortField === 'netSkillWk'} direction={sortField === 'netSkillWk' ? sortDir : 'asc'} onClick={() => handleSort('netSkillWk')}>
                  +/− per Wk
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={sortField === 'optimalWeeks'} direction={sortField === 'optimalWeeks' ? sortDir : 'asc'} onClick={() => handleSort('optimalWeeks')}>
                  Optimal Weeks
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
                  <TableCell align="right" sx={{ color: row.skillEfficiency >= 100 ? 'success.main' : 'error.main', fontWeight: 600 }}>
                    {row.skillEfficiency.toFixed(1)}%
                  </TableCell>
                  <TableCell align="right" sx={{ color: row.netSkillPlusMinus >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>
                    {row.netSkillPlusMinus >= 0 ? '+' : ''}{row.netSkillPlusMinus.toFixed(1)}
                  </TableCell>
                  <TableCell align="right" sx={{ color: row.netSkillPerWeek >= 0 ? 'success.main' : 'error.main' }}>
                    {row.netSkillPerWeek >= 0 ? '+' : ''}{row.netSkillPerWeek.toFixed(2)}
                  </TableCell>
                  <TableCell align="right">
                    {row.optimalWeeks} / {row.totalWeeks}
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
