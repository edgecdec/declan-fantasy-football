'use client';

import * as React from 'react';
import { Box, Paper, Typography, Chip } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { SleeperDraft, SleeperDraftPick } from '@/services/sleeper/sleeperService';
import { getPositionColor, getPositionBgColor } from '@/constants/colors';

const RAINBOW_CYCLE_SECONDS = 3.5;

const spinGradient = keyframes`
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
`;

const CONIC_GRADIENT = 'conic-gradient(red, orange, yellow, green, dodgerblue, blueviolet, red)';

type Props = {
  draft: SleeperDraft;
  grid: (SleeperDraftPick | null)[][];
  ownershipMap: Map<string, number>;
  rosterOwnerMap: Map<number, string>;
  slotToRosterId: Map<number, number>;
  currentUserRosterId: number | null;
  getSlotOrder: (round: number, teams: number, draftType: string) => number[];
  focusedTeam: number | null;
  onSelectTeam: (rosterId: number | null) => void;
};

export default function DraftGrid({ draft, grid, ownershipMap, rosterOwnerMap, slotToRosterId, currentUserRosterId, getSlotOrder, focusedTeam, onSelectTeam }: Props) {
  const teams = draft.settings.teams;
  const rounds = draft.settings.rounds;
  const draftType = draft.type || 'snake';

  const getRosterId = (draftSlot: number) => slotToRosterId.get(draftSlot) ?? draftSlot;

  return (
    <Box sx={{ overflowX: 'auto', width: '100%' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: `40px repeat(${teams}, minmax(120px, 1fr))`, gap: 1, minWidth: teams * 130 }}>
        {/* Header Row */}
        <Box sx={{ textAlign: 'center', p: 1, fontWeight: 'bold' }}>Rd</Box>
        {Array.from({ length: teams }, (_, i) => {
          const draftSlot = i + 1;
          const rosterId = getRosterId(draftSlot);
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
        {focusedTeam === null && (() => {
          let userPickIdx = 0;
          return grid.map((_row, roundIdx) => {
          const round = roundIdx + 1;
          const slotOrder = getSlotOrder(round, teams, draftType);

          return (
            <React.Fragment key={roundIdx}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                {round}
              </Box>

              {Array.from({ length: teams }, (_, colIdx) => {
                const draftSlot = colIdx + 1;
                const rosterId = getRosterId(draftSlot);
                const pick = grid[roundIdx][colIdx];
                const actualOwnerId = ownershipMap.get(`${round}-${rosterId}`);
                const isTraded = actualOwnerId !== undefined && actualOwnerId !== rosterId;
                const isTradedToCurrentUser = isTraded && currentUserRosterId !== null && actualOwnerId === currentUserRosterId;
                const effectiveOwnerId = actualOwnerId ?? rosterId;
                const isCurrentUserPick = currentUserRosterId !== null && effectiveOwnerId === currentUserRosterId;

                const isPicked = !!pick;
                const position = pick?.metadata?.position || 'BENCH';
                const bgColor = isPicked ? getPositionBgColor(position, 0.2) : 'rgba(255,255,255,0.05)';
                const borderColor = isTradedToCurrentUser
                  ? 'warning.main'
                  : isPicked ? getPositionColor(position) : 'rgba(255,255,255,0.1)';

                const ownerName = isTraded ? rosterOwnerMap.get(actualOwnerId) : undefined;
                const snakePosition = slotOrder.indexOf(draftSlot);
                const pickNumber = roundIdx * teams + snakePosition + 1;

                const pickDelay = isCurrentUserPick ? userPickIdx++ : 0;

                const cellContent = (
                  <>
                    <Typography variant="caption" sx={{ position: 'absolute', top: 2, left: 4, opacity: 0.5 }}>
                      {round}.{(snakePosition + 1).toString().padStart(2, '0')}
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
                            ↔️ {ownerName || `Team ${actualOwnerId}`}
                          </Typography>
                        )}
                      </>
                    ) : (
                      <Typography variant="caption" align="center" sx={{ opacity: 0.3, mt: isTraded ? 1 : 0 }}>
                        Pick {pickNumber}
                      </Typography>
                    )}
                  </>
                );

                if (isCurrentUserPick) {
                  return (
                    <Box
                      key={draftSlot}
                      sx={{
                        position: 'relative',
                        borderRadius: 1,
                        overflow: 'hidden',
                        height: 80,
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          top: '-50%', left: '-50%',
                          width: '200%', height: '200%',
                          background: CONIC_GRADIENT,
                          animation: `${spinGradient} ${RAINBOW_CYCLE_SECONDS}s linear infinite`,
                          animationDelay: `${-pickDelay * 0.5}s`,
                        },
                      }}
                    >
                      <Paper
                        sx={{
                          position: 'absolute',
                          inset: '2px',
                          borderRadius: 'inherit',
                          bgcolor: bgColor,
                          p: 1,
                          display: 'flex', flexDirection: 'column', justifyContent: 'center',
                        }}
                      >
                        {cellContent}
                      </Paper>
                    </Box>
                  );
                }

                return (
                  <Paper
                    key={draftSlot}
                    sx={{
                      p: 1, height: 80, display: 'flex', flexDirection: 'column', justifyContent: 'center',
                      bgcolor: bgColor,
                      border: isTradedToCurrentUser ? '2px solid' : '1px solid',
                      borderColor,
                      position: 'relative',
                    }}
                  >
                    {cellContent}
                  </Paper>
                );
              })}
            </React.Fragment>
          );
        });
        })()}
      </Box>
    </Box>
  );
}
