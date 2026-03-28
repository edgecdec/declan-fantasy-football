'use client';

import * as React from 'react';
import { Box } from '@mui/material';
import { SleeperDraft, SleeperDraftPick, SleeperTradedPick } from '@/services/sleeper/sleeperService';
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

  return (
    <Box>
      <DraftGrid draft={draft} grid={grid} ownershipMap={ownershipMap} rosterOwnerMap={rosterOwnerMap} slotToRosterId={slotToRosterId} currentUserRosterId={currentUserRosterId} getSlotOrder={getSlotOrder} focusedTeam={focusedTeam} onSelectTeam={setFocusedTeam} />
    </Box>
  );
}
