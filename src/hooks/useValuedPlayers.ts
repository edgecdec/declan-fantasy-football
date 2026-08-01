'use client';

import * as React from 'react';
import { SleeperDraft } from '@/services/sleeper/sleeperService';
import { VBDService, LeagueSettings, Player } from '@/services/draft/vbdService';

/** Computes vbd_value for every player in the given rankings (drafted or not),
 *  so both the Best Available and Team Value views share one calculation. */
export default function useValuedPlayers(players: Player[], draft: SleeperDraft): Player[] {
  return React.useMemo(() => {
    const superFlexSlots = draft.settings.slots_super_flex || 0;
    // Sleeper renames the flex slot to slots_rec_flex once a super flex slot
    // also exists, rather than keeping slots_flex around.
    const flexSlots = draft.settings.slots_flex ?? draft.settings.slots_rec_flex ?? 0;

    const settings: LeagueSettings = {
      teams: draft.settings.teams,
      format: superFlexSlots > 0 ? 'superflex' : 'standard',
      roster: {
        QB: draft.settings.slots_qb,
        RB: draft.settings.slots_rb,
        WR: draft.settings.slots_wr,
        TE: draft.settings.slots_te,
        FLEX: flexSlots,
        SUPER_FLEX: superFlexSlots,
        K: draft.settings.slots_k,
        DEF: draft.settings.slots_def,
      },
    };
    return VBDService.calculate(players, settings);
  }, [players, draft]);
}
