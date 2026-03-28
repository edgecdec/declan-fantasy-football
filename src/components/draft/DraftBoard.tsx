'use client';

import * as React from 'react';
import { Box } from '@mui/material';
import { SleeperDraft, SleeperDraftPick, SleeperTradedPick } from '@/services/sleeper/sleeperService';
import TeamFilter from '@/components/draft/TeamFilter';
import TeamPicksList from '@/components/draft/TeamPicksList';
import DraftGrid from '@/components/draft/DraftGrid';

type Props = {
  draft: SleeperDraft;
  picks: SleeperDraftPick[];
  tradedPicks?: SleeperTradedPick[];
  rosterOwnerMap?: Map<number, string>;
  rosterIdToOwnerIdMap?: Map<number, string>;
  currentUserId?: string;
};

function buildPickOwnershipMap(tradedPicks: SleeperTradedPick[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const tp of tradedPicks) {
    map.set(`${tp.round}-${tp.roster_id}`, tp.owner_id);
  }
  return map;
}

function isReversedRound(round: number, draftType: string): boolean {
  if (draftType === 'linear') return false;
  return round % 2 === 0;
}

function getSlotOrder(round: number, teams: number, draftType: string): number[] {
  const normal = Array.from({ length: teams }, (_, i) => i + 1);
  return isReversedRound(round, draftType) ? [...normal].reverse() : normal;
}

export default function DraftBoard({ draft, picks, tradedPicks = [], rosterOwnerMap = new Map(), rosterIdToOwnerIdMap = new Map(), currentUserId }: Props) {
  const teams = draft.settings.teams;
  const rounds = draft.settings.rounds;
  const draftType = draft.type || 'snake';
  const ownershipMap = React.useMemo(() => buildPickOwnershipMap(tradedPicks), [tradedPicks]);
  const [focusedTeam, setFocusedTeam] = React.useState<number | null>(null);

  const currentUserRosterId = React.useMemo(() => {
    if (!currentUserId) return null;
    for (const [rosterId, ownerId] of rosterIdToOwnerIdMap.entries()) {
      if (ownerId === currentUserId) return rosterId;
    }
    return null;
  }, [currentUserId, rosterIdToOwnerIdMap]);

  const grid: (SleeperDraftPick | null)[][] = Array.from({ length: rounds }, () =>
    Array(teams).fill(null)
  );
  picks.forEach(pick => {
    const r = pick.round - 1;
    const s = pick.draft_slot - 1;
    if (r >= 0 && r < rounds && s >= 0 && s < teams) grid[r][s] = pick;
  });

  const focusedSlots = React.useMemo(() => {
    if (focusedTeam === null) return [];
    const slots: { round: number; pickNumber: number; pick: SleeperDraftPick | null; isTraded: boolean; originalOwnerName?: string }[] = [];
    for (let r = 0; r < rounds; r++) {
      const round = r + 1;
      const slotOrder = getSlotOrder(round, teams, draftType);
      for (let colIdx = 0; colIdx < slotOrder.length; colIdx++) {
        const draftSlot = slotOrder[colIdx];
        const actualOwnerId = ownershipMap.get(`${round}-${draftSlot}`);
        const ownerId = actualOwnerId ?? draftSlot;
        if (ownerId === focusedTeam) {
          const isTraded = actualOwnerId !== undefined && actualOwnerId !== draftSlot;
          slots.push({ round, pickNumber: r * teams + colIdx + 1, pick: grid[r][draftSlot - 1], isTraded, originalOwnerName: isTraded ? rosterOwnerMap.get(draftSlot) : undefined });
        }
      }
    }
    return slots;
  }, [focusedTeam, rounds, teams, draftType, ownershipMap, grid, rosterOwnerMap]);

  return (
    <Box>
      <TeamFilter teams={teams} rosterOwnerMap={rosterOwnerMap} focusedTeam={focusedTeam} onSelect={setFocusedTeam} />
      {focusedTeam !== null ? (
        <TeamPicksList slots={focusedSlots} teamName={rosterOwnerMap.get(focusedTeam) || `Team ${focusedTeam}`} />
      ) : (
        <DraftGrid draft={draft} grid={grid} ownershipMap={ownershipMap} rosterOwnerMap={rosterOwnerMap} currentUserRosterId={currentUserRosterId} getSlotOrder={getSlotOrder} />
      )}
    </Box>
  );
}
