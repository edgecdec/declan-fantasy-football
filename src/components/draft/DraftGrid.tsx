'use client';

import * as React from 'react';
import { Box, Paper, Typography, Chip } from '@mui/material';
import { SleeperDraft, SleeperDraftPick } from '@/services/sleeper/sleeperService';
import { getPositionColor, getPositionBgColor } from '@/constants/colors';

type Props = {
  draft: SleeperDraft;
  grid: (SleeperDraftPick | null)[][];
  ownershipMap: Map<string, number>;
  rosterOwnerMap: Map<number, string>;
  currentUserRosterId: number | null;
  getSlotOrder: (round: number, teams: number, draftType: string) => number[];
  focusedTeam: number | null;
  onSelectTeam: (rosterId: number | null) => void;
};

export default function DraftGrid({ draft, grid, ownershipMap, rosterOwnerMap, currentUserRosterId, getSlotOrder, focusedTeam, onSelectTeam }: Props) {
  const teams = draft.settings.teams;
  const rounds = draft.settings.rounds;
  const draftType = draft.type || 'snake';

  return (
    <Box sx={{ overflowX: 'auto', width: '100%' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: `40px repeat(${teams}, minmax(120px, 1fr))`, gap: 1, minWidth: teams * 130 }}>
        {/* Header Row */}
        <Box sx={{ textAlign: 'center', p: 1, fontWeight: 'bold' }}>Rd</Box>
        {Array.from({ length: teams }, (_, i) => {
          const rosterId = i + 1;
          const isFocused = focusedTeam === rosterId;
          return (
            <Box
              key={i}
              onClick={() => onSelectTeam(isFocused ? null : rosterId)}
              sx={{
                textAlign: 'center', p: 1, bgcolor: isFocused ? 'primary.main' : 'background.paper',
                color: isFocused ? 'primary.contrastText' : 'text.primary',
                borderRadius: 1, cursor: 'pointer', userSelect: 'none',
                '&:hover': { bgcolor: isFocused ? 'primary.dark' : 'action.hover' },
              }}
            >
              <Typography variant="caption" noWrap>{rosterOwnerMap.get(rosterId) || `Team ${rosterId}`}</Typography>
            </Box>
          );
        })}

        {/* Draft Rounds */}
        {focusedTeam === null && grid.map((_row, roundIdx) => {
          const round = roundIdx + 1;
          const slotOrder = getSlotOrder(round, teams, draftType);

          return (
            <React.Fragment key={roundIdx}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                {round}
              </Box>

              {slotOrder.map((draftSlot, colIdx) => {
                const pick = grid[roundIdx][draftSlot - 1];
                const actualOwnerId = ownershipMap.get(`${round}-${draftSlot}`);
                const isTraded = actualOwnerId !== undefined && actualOwnerId !== draftSlot;
                const isTradedToCurrentUser = isTraded && currentUserRosterId !== null && actualOwnerId === currentUserRosterId;

                const isPicked = !!pick;
                const position = pick?.metadata?.position || 'BENCH';
                const bgColor = isPicked ? getPositionBgColor(position, 0.2) : 'rgba(255,255,255,0.05)';
                const borderColor = isTradedToCurrentUser
                  ? 'warning.main'
                  : isPicked ? getPositionColor(position) : 'rgba(255,255,255,0.1)';

                const ownerName = isTraded ? rosterOwnerMap.get(actualOwnerId) : undefined;
                const pickNumber = roundIdx * teams + colIdx + 1;

                return (
                  <Paper
                    key={draftSlot}
                    sx={{
                      p: 1, height: 80, display: 'flex', flexDirection: 'column', justifyContent: 'center',
                      bgcolor: bgColor, border: isTradedToCurrentUser ? '2px solid' : '1px solid',
                      borderColor, position: 'relative',
                    }}
                  >
                    <Typography variant="caption" sx={{ position: 'absolute', top: 2, left: 4, opacity: 0.5 }}>
                      {round}.{draftSlot.toString().padStart(2, '0')}
                    </Typography>

                    {isTraded && !isPicked && (
                      <Chip
                        label={ownerName || `Team ${actualOwnerId}`}
                        size="small"
                        color={isTradedToCurrentUser ? 'warning' : 'default'}
                        variant="outlined"
                        sx={{ position: 'absolute', top: 2, right: 2, height: 18, fontSize: '0.6rem' }}
                      />
                    )}

                    {isPicked ? (
                      <>
                        <Typography variant="body2" fontWeight="bold" noWrap title={pick.metadata.first_name + ' ' + pick.metadata.last_name}>
                          {pick.metadata.first_name} {pick.metadata.last_name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: getPositionColor(position), fontWeight: 'bold' }}>
                          {position} <Typography component="span" variant="caption" color="text.secondary">- {pick.metadata.team}</Typography>
                        </Typography>
                        {isTraded && (
                          <Typography variant="caption" sx={{ fontSize: '0.6rem', color: isTradedToCurrentUser ? 'warning.main' : 'text.secondary' }}>
                            via trade → {ownerName || `Team ${actualOwnerId}`}
                          </Typography>
                        )}
                      </>
                    ) : (
                      <Typography variant="caption" align="center" sx={{ opacity: 0.3, mt: isTraded ? 1 : 0 }}>
                        Pick {pickNumber}
                      </Typography>
                    )}
                  </Paper>
                );
              })}
            </React.Fragment>
          );
        })}
      </Box>
    </Box>
  );
}
