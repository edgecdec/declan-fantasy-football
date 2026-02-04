'use client';

import * as React from 'react';
import { Box, Paper, Typography, Tooltip, Avatar } from '@mui/material';
import { SleeperDraft, SleeperDraftPick } from '@/services/sleeper/sleeperService';
import { getPositionColor, getPositionBgColor } from '@/constants/colors';

type Props = {
  draft: SleeperDraft;
  picks: SleeperDraftPick[];
  playerData?: any; // Fallback for player info
};

export default function DraftBoard({ draft, picks }: Props) {
  const teams = draft.settings.teams;
  const rounds = draft.settings.rounds;
  
  // Create a grid: round -> slot -> pick
  const grid: (SleeperDraftPick | null)[][] = Array.from({ length: rounds }, () => 
    Array(teams).fill(null)
  );

  // Populate grid
  picks.forEach(pick => {
    // Sleeper rounds/slots are 1-based
    const r = pick.round - 1; 
    const s = pick.draft_slot - 1;
    
    if (r >= 0 && r < rounds && s >= 0 && s < teams) {
      grid[r][s] = pick;
    }
  });

  return (
    <Box sx={{ overflowX: 'auto', width: '100%' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: `40px repeat(${teams}, minmax(120px, 1fr))`, gap: 1, minWidth: teams * 130 }}>
        
        {/* Header Row (Team Slots) */}
        <Box sx={{ textAlign: 'center', p: 1, fontWeight: 'bold' }}>Rd</Box>
        {Array.from({ length: teams }, (_, i) => (
          <Box key={i} sx={{ textAlign: 'center', p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
            Team {i + 1}
          </Box>
        ))}

        {/* Draft Rounds */}
        {grid.map((row, roundIdx) => (
          <React.Fragment key={roundIdx}>
            {/* Round Number */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
              {roundIdx + 1}
            </Box>
            
            {/* Picks */}
            {row.map((pick, slotIdx) => {
              const isPicked = !!pick;
              const pickNumber = (roundIdx * teams) + (roundIdx % 2 !== 0 && draft.type === 'snake' ? (teams - slotIdx) : (slotIdx + 1));
              
              // Correct Pick Number Calculation for Snake
              // Actually, sleeper pick object HAS pick_no. Use that if available, else calculate.
              // Wait, grid mapping:
              // Snake Round 1: Slot 1 = Pick 1. Slot 12 = Pick 12.
              // Snake Round 2: Slot 12 = Pick 13. Slot 1 = Pick 24.
              // So mapping pick to [r][s] uses pick.draft_slot which Sleeper provides correctly for the column.
              
              const position = pick?.metadata?.position || 'BENCH';
              const bgColor = isPicked ? getPositionBgColor(position, 0.2) : 'rgba(255,255,255,0.05)';
              const borderColor = isPicked ? getPositionColor(position) : 'rgba(255,255,255,0.1)';

              return (
                <Paper 
                  key={slotIdx} 
                  sx={{ 
                    p: 1, 
                    height: 80, 
                    display: 'flex', 
                    flexDirection: 'column', 
                    justifyContent: 'center',
                    bgcolor: bgColor,
                    border: '1px solid',
                    borderColor: borderColor,
                    position: 'relative'
                  }}
                >
                  <Typography variant="caption" sx={{ position: 'absolute', top: 2, left: 4, opacity: 0.5 }}>
                    {roundIdx + 1}.{(slotIdx + 1).toString().padStart(2, '0')}
                  </Typography>
                  
                  {isPicked ? (
                    <>
                      <Typography variant="body2" fontWeight="bold" noWrap title={pick.metadata.first_name + ' ' + pick.metadata.last_name}>
                        {pick.metadata.first_name} {pick.metadata.last_name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: getPositionColor(position), fontWeight: 'bold' }}>
                        {position} <Typography component="span" variant="caption" color="text.secondary">- {pick.metadata.team}</Typography>
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="caption" align="center" sx={{ opacity: 0.3 }}>
                      Pick {(roundIdx * teams) + (slotIdx + 1) /* Approx */}
                    </Typography>
                  )}
                </Paper>
              );
            })}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}
