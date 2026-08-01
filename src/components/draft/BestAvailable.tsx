'use client';

import * as React from 'react';
import { Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { SleeperDraftPick } from '@/services/sleeper/sleeperService';
import { Player } from '@/services/draft/vbdService';
import { getPositionColor, getPositionBgColor } from '@/constants/colors';
import useTableSort from '@/hooks/useTableSort';

type Props = {
  valuedPlayers: Player[];
  picks: SleeperDraftPick[];
  rosteredPlayerIds?: Set<string>;
};

export default function BestAvailable({ valuedPlayers, picks, rosteredPlayerIds }: Props) {
  const [positionFilter, setPositionFilter] = React.useState('ALL');

  const bestAvailable = React.useMemo(() => {
    const takenIds = new Set(picks.map(p => p.player_id));
    return valuedPlayers.filter(p => {
      if (takenIds.has(p.player_id)) return false;
      if (rosteredPlayerIds?.has(p.player_id)) return false;
      return true;
    });
  }, [valuedPlayers, picks, rosteredPlayerIds]);

  const filteredPlayers = React.useMemo(() => {
    if (positionFilter === 'ALL') return bestAvailable;
    if (positionFilter === 'FLEX') return bestAvailable.filter(p => ['RB', 'WR', 'TE'].includes(p.position));
    return bestAvailable.filter(p => p.position === positionFilter);
  }, [bestAvailable, positionFilter]);

  const { sorted: sortedPlayers, order, orderBy, handleSort } = useTableSort(filteredPlayers, 'rank', 'asc');

  const handleFormatPositionFilter = (_: React.MouseEvent<HTMLElement>, newPos: string | null) => {
    if (newPos) setPositionFilter(newPos);
  };

  return (
    <Box sx={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <ToggleButtonGroup
        value={positionFilter}
        exclusive
        onChange={handleFormatPositionFilter}
        size="small"
        sx={{ mb: 2, flexWrap: 'wrap', '& .MuiToggleButton-root': { py: 0.5, px: 1, fontSize: '0.75rem' } }}
      >
        <ToggleButton value="ALL">ALL</ToggleButton>
        <ToggleButton value="QB" sx={{ color: getPositionColor('QB'), '&.Mui-selected': { bgcolor: getPositionBgColor('QB', 0.2), color: getPositionColor('QB') } }}>QB</ToggleButton>
        <ToggleButton value="RB" sx={{ color: getPositionColor('RB'), '&.Mui-selected': { bgcolor: getPositionBgColor('RB', 0.2), color: getPositionColor('RB') } }}>RB</ToggleButton>
        <ToggleButton value="WR" sx={{ color: getPositionColor('WR'), '&.Mui-selected': { bgcolor: getPositionBgColor('WR', 0.2), color: getPositionColor('WR') } }}>WR</ToggleButton>
        <ToggleButton value="TE" sx={{ color: getPositionColor('TE'), '&.Mui-selected': { bgcolor: getPositionBgColor('TE', 0.2), color: getPositionColor('TE') } }}>TE</ToggleButton>
        <ToggleButton value="FLEX">FLEX</ToggleButton>
      </ToggleButtonGroup>
      
      <TableContainer sx={{ flexGrow: 1 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold' }}>
                <TableSortLabel active={orderBy === 'rank'} direction={orderBy === 'rank' ? order : 'asc'} onClick={() => handleSort('rank')}>Rank</TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>
                <TableSortLabel active={orderBy === 'name'} direction={orderBy === 'name' ? order : 'asc'} onClick={() => handleSort('name')}>Player</TableSortLabel>
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                <TableSortLabel active={orderBy === 'vbd_value'} direction={orderBy === 'vbd_value' ? order : 'asc'} onClick={() => handleSort('vbd_value')}>Value</TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedPlayers.slice(0, 20).map((player) => {
              const rowBg = getPositionBgColor(player.position, 0.05);
              const borderLeft = `4px solid ${getPositionColor(player.position)}`;
              
              return (
                <TableRow 
                  key={player.player_id} 
                  hover
                  sx={{ 
                    bgcolor: rowBg, 
                    '& td:first-of-type': { borderLeft: borderLeft }
                  }}
                >
                  <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>{player.rank}</TableCell>
                  <TableCell>
                    <Box>
                      <Typography variant="body2" fontWeight="bold">{player.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {player.position} - {player.team}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <Box>
                      <Typography variant="body2" fontWeight="bold" sx={{ color: (player.vbd_value || 0) > 0 ? 'success.main' : 'text.primary' }}>
                        {(player.vbd_value || 0).toFixed(1)}
                      </Typography>
                      {player.projected_points !== undefined && (
                        <Typography variant="caption" color="text.secondary">
                          {player.projected_points} pts
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
            {sortedPlayers.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} align="center">No players found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
