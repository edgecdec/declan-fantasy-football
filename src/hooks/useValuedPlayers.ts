'use client';

import * as React from 'react';
import { SleeperDraft } from '@/services/sleeper/sleeperService';
import { VBDService, LeagueSettings, Player } from '@/services/draft/vbdService';

/** Computes vbd_value for every player in the given rankings (drafted or not),
 *  so both the Best Available and Team Value views share one calculation. */
export default function useValuedPlayers(players: Player[], draft: SleeperDraft): Player[] {
  return React.useMemo(() => {
    const settings: LeagueSettings = {
      teams: draft.settings.teams,
      format: 'standard',
      roster: {
        QB: draft.settings.slots_qb,
        RB: draft.settings.slots_rb,
        WR: draft.settings.slots_wr,
        TE: draft.settings.slots_te,
        FLEX: draft.settings.slots_flex,
        SUPER_FLEX: 0,
        K: draft.settings.slots_k,
        DEF: draft.settings.slots_def,
      },
    };
    return VBDService.calculate(players, settings);
  }, [players, draft]);
}
