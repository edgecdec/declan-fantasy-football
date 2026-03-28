'use client';

import * as React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { SleeperDraftPick, SleeperTradedPick } from '@/services/sleeper/sleeperService';
import { getPositionColor } from '@/constants/colors';

type PickSlot = {
  round: number;
  pickNumber: number;
  pick: SleeperDraftPick | null;
  isTraded: boolean;
  originalOwnerName?: string;
};

type Props = {
  slots: PickSlot[];
  teamName: string;
};

export default function TeamPicksList({ slots, teamName }: Props) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {teamName} — {slots.length} pick{slots.length !== 1 ? 's' : ''}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {slots.map((slot) => {
          const { pick, round, pickNumber } = slot;
          const position = pick?.metadata?.position || '';
          const playerName = pick
            ? `${pick.metadata.first_name} ${pick.metadata.last_name}`
            : 'TBD';

          return (
            <Paper
              key={`${round}-${pickNumber}`}
              sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 2 }}
            >
              <Typography variant="caption" sx={{ minWidth: 40, fontWeight: 'bold' }}>
                Rd {round}
              </Typography>
              <Typography variant="caption" sx={{ minWidth: 50, opacity: 0.6 }}>
                #{pickNumber}
              </Typography>
              {pick ? (
                <>
                  <Typography variant="body2" fontWeight="bold" noWrap sx={{ flex: 1 }}>
                    {playerName}
                  </Typography>
                  <Typography variant="caption" sx={{ color: getPositionColor(position), fontWeight: 'bold' }}>
                    {position}
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" sx={{ opacity: 0.4, flex: 1 }}>TBD</Typography>
              )}
              {slot.isTraded && slot.originalOwnerName && (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                  via {slot.originalOwnerName}
                </Typography>
              )}
            </Paper>
          );
        })}
      </Box>
    </Box>
  );
}
