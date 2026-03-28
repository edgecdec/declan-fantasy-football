'use client';

import * as React from 'react';
import { Box } from '@mui/material';
import { SleeperDraft, SleeperDraftPick, SleeperTradedPick } from '@/services/sleeper/sleeperService';
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

function buildSlotToRosterIdMap(draft: SleeperDraft): Map<number, number> {
  const map = new Map<number, number>();
  if (draft.slot_to_roster_id) {
    for (const [slot, rosterId] of Object.entries(draft.slot_to_roster_id)) {
      map.set(Number(slot), rosterId);
    }
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
  const slotToRosterId = React.useMemo(() => buildSlotToRosterIdMap(draft), [draft]);
  const [focusedTeam, setFocusedTeam] = React.useState<number | null>(null);

  const currentUserRosterId = React.useMemo(() => {
    if (!currentUserId) return null;
    for (const [rosterId, ownerId] of rosterIdToOwnerIdMap.entries()) {
      if (ownerId === currentUserId) return rosterId;
    }
    return null;
  }, [currentUserId, rosterIdToOwnerIdMap]);

  // Grid indexed by [round][draft_slot - 1]
  const grid: (SleeperDraftPick | null)[][] = Array.from({ length: rounds }, () =>
    Array(teams).fill(null)
  );
  picks.forEach(pick => {
    const r = pick.round - 1;
    const s = pick.draft_slot - 1;
    if (r >= 0 && r < rounds && s >= 0 && s < teams) grid[r][s] = pick;
  });

  // Resolve roster_id for a draft_slot, falling back to slot number if no mapping
  const getRosterId = React.useCallback((draftSlot: number) => {
    return slotToRosterId.get(draftSlot) ?? draftSlot;
  }, [slotToRosterId]);

  const focusedSlots = React.useMemo(() => {
    if (focusedTeam === null) return [];
    const slots: { round: number; pickNumber: number; pick: SleeperDraftPick | null; isTraded: boolean; originalOwnerName?: string }[] = [];
    for (let r = 0; r < rounds; r++) {
      const round = r + 1;
      const slotOrder = getSlotOrder(round, teams, draftType);
      for (let colIdx = 0; colIdx < slotOrder.length; colIdx++) {
        const draftSlot = slotOrder[colIdx];
        const rosterId = getRosterId(draftSlot);
        const actualOwnerId = ownershipMap.get(`${round}-${rosterId}`);
        const ownerId = actualOwnerId ?? rosterId;
        if (ownerId === focusedTeam) {
          const isTraded = actualOwnerId !== undefined && actualOwnerId !== rosterId;
          slots.push({ round, pickNumber: r * teams + colIdx + 1, pick: grid[r][draftSlot - 1], isTraded, originalOwnerName: isTraded ? rosterOwnerMap.get(rosterId) : undefined });
        }
      }
    }
    return slots;
  }, [focusedTeam, rounds, teams, draftType, ownershipMap, grid, rosterOwnerMap, getRosterId]);

  return (
    <Box>
      <DraftGrid draft={draft} grid={grid} ownershipMap={ownershipMap} rosterOwnerMap={rosterOwnerMap} slotToRosterId={slotToRosterId} currentUserRosterId={currentUserRosterId} getSlotOrder={getSlotOrder} focusedTeam={focusedTeam} onSelectTeam={setFocusedTeam} />
      {focusedTeam !== null && (
        <TeamPicksList slots={focusedSlots} teamName={rosterOwnerMap.get(focusedTeam) || `Team ${focusedTeam}`} />
      )}
    </Box>
  );
}
