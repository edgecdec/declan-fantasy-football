'use client';

import * as React from 'react';
import { Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel } from '@mui/material';
import { SleeperDraftPick } from '@/services/sleeper/sleeperService';
import { Player } from '@/services/draft/vbdService';
import useTableSort from '@/hooks/useTableSort';

type Props = {
  valuedPlayers: Player[];
  picks: SleeperDraftPick[];
  rosterOwnerMap: Map<number, string>;
  rosterIdToOwnerIdMap: Map<number, string>;
  currentUserId?: string;
};

type TeamTotal = {
  rosterId: number;
  teamName: string;
  totalValue: number;
  pickCount: number;
};

export default function TeamValueRankings({ valuedPlayers, picks, rosterOwnerMap, rosterIdToOwnerIdMap, currentUserId }: Props) {
  const currentUserRosterId = React.useMemo(() => {
    if (!currentUserId) return null;
    for (const [rosterId, ownerId] of rosterIdToOwnerIdMap.entries()) {
      if (ownerId === currentUserId) return rosterId;
    }
    return null;
  }, [currentUserId, rosterIdToOwnerIdMap]);

  const teamTotals = React.useMemo(() => {
    const valueById = new Map(valuedPlayers.map(p => [p.player_id, p.vbd_value ?? 0]));
    const totals = new Map<number, TeamTotal>();

    for (const pick of picks) {
      const rosterId = pick.roster_id;
      if (rosterId == null) continue;

      const existing = totals.get(rosterId) || {
        rosterId,
        teamName: rosterOwnerMap.get(rosterId) || `Team ${rosterId}`,
        totalValue: 0,
        pickCount: 0,
      };
      existing.totalValue += valueById.get(pick.player_id) ?? 0;
      existing.pickCount += 1;
      totals.set(rosterId, existing);
    }

    return [...totals.values()];
  }, [valuedPlayers, picks, rosterOwnerMap]);

  const { sorted: sortedTeams, order, orderBy, handleSort } = useTableSort(teamTotals, 'totalValue', 'desc');

  return (
    <Box sx={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <TableContainer sx={{ flexGrow: 1 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold' }}>#</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>
                <TableSortLabel active={orderBy === 'teamName'} direction={orderBy === 'teamName' ? order : 'asc'} onClick={() => handleSort('teamName')}>Team</TableSortLabel>
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                <TableSortLabel active={orderBy === 'totalValue'} direction={orderBy === 'totalValue' ? order : 'desc'} onClick={() => handleSort('totalValue')}>Value</TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedTeams.map((team, index) => {
              const isCurrentUser = currentUserRosterId !== null && team.rosterId === currentUserRosterId;
              return (
                <TableRow
                  key={team.rosterId}
                  hover
                  sx={{
                    bgcolor: isCurrentUser ? 'action.selected' : undefined,
                    '& td:first-of-type': { borderLeft: isCurrentUser ? '4px solid' : 'none', borderLeftColor: 'primary.main' },
                  }}
                >
                  <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>{index + 1}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight="bold">{team.teamName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {team.pickCount} pick{team.pickCount !== 1 ? 's' : ''}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight="bold" sx={{ color: team.totalValue > 0 ? 'success.main' : 'text.primary' }}>
                      {team.totalValue.toFixed(1)}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
            {sortedTeams.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} align="center">No picks yet</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
