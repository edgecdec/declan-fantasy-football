'use client';

import * as React from 'react';
import { Box, Paper, Typography, Chip } from '@mui/material';
import { SleeperDraft, SleeperDraftPick, SleeperTradedPick } from '@/services/sleeper/sleeperService';
import { getPositionColor, getPositionBgColor } from '@/constants/colors';

type Props = {
  draft: SleeperDraft;
  picks: SleeperDraftPick[];
  tradedPicks?: SleeperTradedPick[];
  rosterOwnerMap?: Map<number, string>;
  rosterIdToOwnerIdMap?: Map<number, string>;
  currentUserId?: string;
};

/** Build a map: "round-roster_id" → owner_id (the actual current owner after trades) */
function buildPickOwnershipMap(tradedPicks: SleeperTradedPick[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const tp of tradedPicks) {
    map.set(`${tp.round}-${tp.roster_id}`, tp.owner_id);
  }
  return map;
}

/**
 * Determine if a round is reversed (picks go right-to-left) based on draft type.
 * Snake: even rounds are reversed.
 * Third-round reversal: rounds 2 AND 3 are reversed, then alternates in pairs (6,7 / 10,11 etc).
 * Linear: never reversed.
 */
function isReversedRound(round: number, draftType: string): boolean {
  if (draftType === 'linear') return false;
  // Standard snake: even rounds reversed
  return round % 2 === 0;
}

/**
 * Get the slot order for a given round. Returns an array of draft_slot values (1-based)
 * in the order they should be displayed left-to-right.
 */
function getSlotOrder(round: number, teams: number, draftType: string): number[] {
  const normal = Array.from({ length: teams }, (_, i) => i + 1);
  return isReversedRound(round, draftType) ? [...normal].reverse() : normal;
}

export default function DraftBoard({ draft, picks, tradedPicks = [], rosterOwnerMap = new Map(), rosterIdToOwnerIdMap = new Map(), currentUserId }: Props) {
  const teams = draft.settings.teams;
  const rounds = draft.settings.rounds;
  const draftType = draft.type || 'snake';
  const ownershipMap = React.useMemo(() => buildPickOwnershipMap(tradedPicks), [tradedPicks]);

  const currentUserRosterId = React.useMemo(() => {
    if (!currentUserId) return null;
    for (const [rosterId, ownerId] of rosterIdToOwnerIdMap.entries()) {
      if (ownerId === currentUserId) return rosterId;
    }
    return null;
  }, [currentUserId, rosterIdToOwnerIdMap]);

  // Build grid indexed by [round][draft_slot] (both 0-based)
  const grid: (SleeperDraftPick | null)[][] = Array.from({ length: rounds }, () =>
    Array(teams).fill(null)
  );

  picks.forEach(pick => {
    const r = pick.round - 1;
    const s = pick.draft_slot - 1;
    if (r >= 0 && r < rounds && s >= 0 && s < teams) {
      grid[r][s] = pick;
    }
  });

  return (
    <Box sx={{ overflowX: 'auto', width: '100%' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: `40px repeat(${teams}, minmax(120px, 1fr))`, gap: 1, minWidth: teams * 130 }}>

        {/* Header Row — always shows round 1 order */}
        <Box sx={{ textAlign: 'center', p: 1, fontWeight: 'bold' }}>Rd</Box>
        {Array.from({ length: teams }, (_, i) => {
          const name = rosterOwnerMap.get(i + 1);
          return (
            <Box key={i} sx={{ textAlign: 'center', p: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
              <Typography variant="caption" noWrap>{name || `Team ${i + 1}`}</Typography>
            </Box>
          );
        })}

        {/* Draft Rounds */}
        {grid.map((row, roundIdx) => {
          const round = roundIdx + 1;
          const slotOrder = getSlotOrder(round, teams, draftType);

          return (
            <React.Fragment key={roundIdx}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                {round}
              </Box>

              {slotOrder.map((draftSlot, colIdx) => {
                const pick = grid[roundIdx][draftSlot - 1];
                const originalRosterId = draftSlot;
                const actualOwnerId = ownershipMap.get(`${round}-${originalRosterId}`);
                const isTraded = actualOwnerId !== undefined && actualOwnerId !== originalRosterId;
                const isTradedToCurrentUser = isTraded && currentUserRosterId !== null && actualOwnerId === currentUserRosterId;

                const isPicked = !!pick;
                const position = pick?.metadata?.position || 'BENCH';
                const bgColor = isPicked ? getPositionBgColor(position, 0.2) : 'rgba(255,255,255,0.05)';
                const borderColor = isTradedToCurrentUser
                  ? 'warning.main'
                  : isPicked ? getPositionColor(position) : 'rgba(255,255,255,0.1)';

                const ownerName = isTraded ? rosterOwnerMap.get(actualOwnerId) : undefined;

                // Calculate overall pick number based on snake order
                const pickNumber = (roundIdx * teams) + colIdx + 1;

                return (
                  <Paper
                    key={draftSlot}
                    sx={{
                      p: 1,
                      height: 80,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      bgcolor: bgColor,
                      border: isTradedToCurrentUser ? '2px solid' : '1px solid',
                      borderColor,
                      position: 'relative',
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
