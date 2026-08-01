'use client';

import * as React from 'react';
import { Box, Paper, Typography, Chip, GlobalStyles } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { SleeperDraft, SleeperDraftPick } from '@/services/sleeper/sleeperService';
import { getPositionColor, getPositionBgColor } from '@/constants/colors';

// Rotating a masked, oversized conic-gradient disc behind a thin ring (via
// `transform: rotate`) looks like it's swirling from the center on a wide
// rectangle -- the disc doesn't conform to the box's own shape. Animating
// the gradient's own start angle instead keeps it perfectly conformal to
// the cell (a real border, not a cropped spinning circle). This needs the
// custom property registered as an <angle> so the browser can interpolate
// it smoothly; see the `@property` GlobalStyles below.
const RAINBOW_BORDER_WIDTH = 4;
const ROTATE_SECONDS = 4;
const rotateAngle = keyframes`
  to { --rainbow-angle: 360deg; }
`;

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
      <GlobalStyles
        styles={`
          @property --rainbow-angle {
            syntax: '<angle>';
            initial-value: 0deg;
            inherits: false;
          }
        `}
      />
      <Box sx={{ display: 'grid', gridTemplateColumns: `40px repeat(${teams}, minmax(80px, 1fr))`, gap: 0.5 }}>
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
        {grid.map((_row, roundIdx) => {
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

                const isFocusedTeamPick = focusedTeam !== null && effectiveOwnerId === focusedTeam;
                const fadeOpacity = focusedTeam !== null && !isFocusedTeamPick ? 0.1 : 1;

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
                        <Typography variant="body2" fontWeight="bold" noWrap sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={pick.metadata.first_name + ' ' + pick.metadata.last_name}>
                          {pick.metadata.first_name} {pick.metadata.last_name}
                        </Typography>
                        <Typography variant="caption" noWrap sx={{ color: getPositionColor(position), fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                        height: 80,
                        p: `${RAINBOW_BORDER_WIDTH}px`,
                        opacity: fadeOpacity,
                        transition: 'opacity 0.3s ease',
                        '--rainbow-angle': '0deg',
                        background: 'conic-gradient(from var(--rainbow-angle), red, orange, yellow, green, dodgerblue, blueviolet, red)',
                        animation: `${rotateAngle} ${ROTATE_SECONDS}s linear infinite`,
                      }}
                    >
                      <Paper
                        sx={{
                          position: 'relative',
                          height: '100%',
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
                      opacity: fadeOpacity,
                      transition: 'opacity 0.3s ease',
                    }}
                  >
                    {cellContent}
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
