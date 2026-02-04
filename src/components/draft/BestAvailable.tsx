'use client';

import * as React from 'react';
import { Box, Paper, Typography, Divider, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip } from '@mui/material';
import { SleeperDraft, SleeperDraftPick } from '@/services/sleeper/sleeperService';
import { VBDService, LeagueSettings, Player } from '@/services/draft/vbdService';
import { MOCK_RANKINGS } from '@/data/mockRankings';
import { getPositionColor, getPositionBgColor } from '@/constants/colors';

type Props = {
  draft: SleeperDraft;
  picks: SleeperDraftPick[];
};

export default function BestAvailable({ draft, picks }: Props) {
  const [bestAvailable, setBestAvailable] = React.useState<Player[]>([]);

  React.useEffect(() => {
    // 1. Filter out drafted players
    const takenIds = new Set(picks.map(p => p.player_id));
    const available = MOCK_RANKINGS.filter(p => !takenIds.has(p.player_id));

    // 2. Prepare Settings
    const settings: LeagueSettings = {
      teams: draft.settings.teams,
      format: 'standard', // Detect from settings if possible, assume standard for mock
      roster: {
        QB: draft.settings.slots_qb,
        RB: draft.settings.slots_rb,
        WR: draft.settings.slots_wr,
        TE: draft.settings.slots_te,
        FLEX: draft.settings.slots_flex,
        SUPER_FLEX: 0, // Not in basic settings obj usually, would need full settings scan
        K: draft.settings.slots_k,
        DEF: draft.settings.slots_def
      }
    };

    // 3. Calculate VBD
    const calculated = VBDService.calculate(available, settings);
    setBestAvailable(calculated);

  }, [draft, picks]);

  return (
    <Paper sx={{ p: 2, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h6" gutterBottom>Best Available (VBD)</Typography>
      <Divider sx={{ mb: 1 }} />
      
      <TableContainer sx={{ flexGrow: 1 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Rank</TableCell>
              <TableCell>Player</TableCell>
              <TableCell align="right">Proj</TableCell>
              <TableCell align="right">Value</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bestAvailable.slice(0, 15).map((player) => (
              <TableRow key={player.player_id} hover>
                <TableCell>{player.rank}</TableCell>
                <TableCell>
                  <Box>
                    <Typography variant="body2" fontWeight="bold">{player.name}</Typography>
                    <Box component="span" sx={{ 
                      fontSize: '0.75rem', 
                      color: getPositionColor(player.position), 
                      bgcolor: getPositionBgColor(player.position, 0.1),
                      px: 0.5, py: 0.25, borderRadius: 0.5,
                      fontWeight: 'bold'
                    }}>
                      {player.position}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      {player.team}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell align="right">{player.projected_points}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold', color: (player.vbd_value || 0) > 0 ? 'success.main' : 'text.primary' }}>
                  {(player.vbd_value || 0).toFixed(1)}
                </TableCell>
              </TableRow>
            ))}
            {bestAvailable.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center">No players found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
