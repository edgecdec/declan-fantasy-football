'use client';

import * as React from 'react';
import { Box, Paper, Tabs, Tab } from '@mui/material';
import { SleeperDraft, SleeperDraftPick } from '@/services/sleeper/sleeperService';
import { useCustomRankings } from '@/context/CustomRankingsContext';
import useValuedPlayers from '@/hooks/useValuedPlayers';
import RankingsSelector from '@/components/draft/RankingsSelector';
import BestAvailable from '@/components/draft/BestAvailable';
import TeamValueRankings from '@/components/draft/TeamValueRankings';

type Props = {
  draft: SleeperDraft;
  picks: SleeperDraftPick[];
  rosteredPlayerIds?: Set<string>;
  rosterOwnerMap: Map<number, string>;
  rosterIdToOwnerIdMap: Map<number, string>;
  currentUserId?: string;
};

export default function DraftSidePanel({ draft, picks, rosteredPlayerIds, rosterOwnerMap, rosterIdToOwnerIdMap, currentUserId }: Props) {
  const { activePlayers } = useCustomRankings();
  const valuedPlayers = useValuedPlayers(activePlayers, draft);
  const [tab, setTab] = React.useState(0);

  return (
    <Paper sx={{ p: 2, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="fullWidth"
        sx={{ minHeight: 36, mb: 1, '& .MuiTab-root': { minHeight: 36, py: 0, px: 1, fontSize: '0.75rem' } }}
      >
        <Tab label="Best Available" />
        <Tab label="Team Value" />
      </Tabs>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <RankingsSelector />
      </Box>

      {tab === 0 && (
        <BestAvailable valuedPlayers={valuedPlayers} picks={picks} rosteredPlayerIds={rosteredPlayerIds} />
      )}
      {tab === 1 && (
        <TeamValueRankings
          valuedPlayers={valuedPlayers}
          picks={picks}
          rosterOwnerMap={rosterOwnerMap}
          rosterIdToOwnerIdMap={rosterIdToOwnerIdMap}
          currentUserId={currentUserId}
        />
      )}
    </Paper>
  );
}
