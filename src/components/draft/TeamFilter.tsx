'use client';

import * as React from 'react';
import { Box, Button } from '@mui/material';

type Props = {
  teams: number;
  rosterOwnerMap: Map<number, string>;
  focusedTeam: number | null;
  onSelect: (rosterId: number | null) => void;
};

export default function TeamFilter({ teams, rosterOwnerMap, focusedTeam, onSelect }: Props) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
      <Button
        size="small"
        variant={focusedTeam === null ? 'contained' : 'outlined'}
        onClick={() => onSelect(null)}
        sx={{ minWidth: 48 }}
      >
        All
      </Button>
      {Array.from({ length: teams }, (_, i) => {
        const rosterId = i + 1;
        const name = rosterOwnerMap.get(rosterId) || `Team ${rosterId}`;
        const isActive = focusedTeam === rosterId;
        return (
          <Button
            key={rosterId}
            size="small"
            variant={isActive ? 'contained' : 'outlined'}
            onClick={() => onSelect(isActive ? null : rosterId)}
            sx={{ minWidth: 48 }}
          >
            {name}
          </Button>
        );
      })}
    </Box>
  );
}
