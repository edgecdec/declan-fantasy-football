'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { Container, Box, Paper, Typography, Button, Chip, LinearProgress, Grid, Alert, IconButton, Tooltip } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import BarChartIcon from '@mui/icons-material/BarChart';
import PageHeader from '@/components/common/PageHeader';
import DraftBoard from '@/components/draft/DraftBoard';
import DraftSidePanel from '@/components/draft/DraftSidePanel';
import { useUser } from '@/context/UserContext';
import { SleeperService, SleeperDraft, SleeperDraftPick, SleeperTradedPick } from '@/services/sleeper/sleeperService';
import { recommendedDynastyVariant, recommendedRedraftVariant } from '@/services/draft/rankingsVariant';
import Link from 'next/link';

const DYNASTY_LEAGUE_TYPE = 2;

const DRAFT_STATUS_PRIORITY: Record<string, number> = {
  drafting: 0,
  paused: 1,
  pre_draft: 2,
  complete: 3,
};

function selectBestDraft(drafts: SleeperDraft[]): SleeperDraft | null {
  if (drafts.length === 0) return null;
  return [...drafts].sort((a, b) => {
    const pA = DRAFT_STATUS_PRIORITY[a.status] ?? 99;
    const pB = DRAFT_STATUS_PRIORITY[b.status] ?? 99;
    return pA - pB;
  })[0];
}

export default function LeagueDraftPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { user } = useUser();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = React.useState<SleeperDraft | null>(null);
  const [picks, setPicks] = React.useState<SleeperDraftPick[]>([]);
  const [isDynasty, setIsDynasty] = React.useState(false);
  const [recommendedDynastyVariantKey, setRecommendedDynastyVariantKey] = React.useState<string | null>(null);
  const [recommendedRedraftVariantKey, setRecommendedRedraftVariantKey] = React.useState<string | null>(null);
  const [rosteredPlayerIds, setRosteredPlayerIds] = React.useState<Set<string>>(new Set());
  const [tradedPicks, setTradedPicks] = React.useState<SleeperTradedPick[]>([]);
  const [rosterOwnerMap, setRosterOwnerMap] = React.useState<Map<number, string>>(new Map());
  const [rosterIdToOwnerIdMap, setRosterIdToOwnerIdMap] = React.useState<Map<number, string>>(new Map());
  const [refreshing, setRefreshing] = React.useState(false);
  const [panelCollapsed, setPanelCollapsed] = React.useState(false);

  React.useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [drafts, league, rosters, leagueUsers] = await Promise.all([
          SleeperService.getLeagueDrafts(leagueId),
          SleeperService.getLeague(leagueId),
          SleeperService.getRosters(leagueId),
          SleeperService.getLeagueUsers(leagueId),
        ]);

        if (cancelled) return;

        const best = selectBestDraft(drafts);
        if (!best) {
          setError('No drafts found for this league.');
          setLoading(false);
          return;
        }

        // Fetch full draft object to get slot_to_roster_id (league drafts endpoint omits it)
        const [fullDraft, fetchedPicks, draftTradedPicks] = await Promise.all([
          SleeperService.getDraft(best.draft_id),
          SleeperService.getDraftPicks(best.draft_id),
          SleeperService.getDraftTradedPicks(best.draft_id),
        ]);

        setSelectedDraft(fullDraft || best);

        if (cancelled) return;

        setPicks(fetchedPicks);
        setTradedPicks(draftTradedPicks);

        // Build roster_id → display_name map and roster_id → owner_id map
        const userDisplayNames = new Map<string, string>();
        for (const u of leagueUsers) {
          userDisplayNames.set(u.user_id, u.display_name || u.username);
        }
        const ownerMap = new Map<number, string>();
        const ownerIdMap = new Map<number, string>();
        for (const roster of rosters) {
          const name = userDisplayNames.get(roster.owner_id) || `Team ${roster.roster_id}`;
          ownerMap.set(roster.roster_id, name);
          if (roster.owner_id) ownerIdMap.set(roster.roster_id, roster.owner_id);
        }
        setRosterOwnerMap(ownerMap);
        setRosterIdToOwnerIdMap(ownerIdMap);

        const dynasty = league?.settings?.type === DYNASTY_LEAGUE_TYPE;
        setIsDynasty(dynasty);
        setRecommendedDynastyVariantKey(league ? recommendedDynastyVariant(league) : null);
        setRecommendedRedraftVariantKey(league ? recommendedRedraftVariant(league) : null);

        if (dynasty) {
          const ids = new Set<string>();
          for (const roster of rosters) {
            if (roster.players) {
              for (const pid of roster.players) ids.add(pid);
            }
          }
          setRosteredPlayerIds(ids);
        }
      } catch (e) {
        if (!cancelled) setError('Failed to load draft data.');
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [leagueId]);

  // Poll for picks during active drafts
  React.useEffect(() => {
    if (!selectedDraft || selectedDraft.status !== 'drafting') return;
    const interval = setInterval(async () => {
      try {
        const fetchedPicks = await SleeperService.getDraftPicks(selectedDraft.draft_id);
        setPicks(fetchedPicks);
      } catch (e) { console.error(e); }
    }, 15000);
    return () => clearInterval(interval);
  }, [selectedDraft]);

  const handleRefresh = async () => {
    if (!selectedDraft) return;
    setRefreshing(true);
    try {
      const fetchedPicks = await SleeperService.getDraftPicks(selectedDraft.draft_id);
      setPicks(fetchedPicks);
    } catch (e) { console.error(e); }
    setRefreshing(false);
  };

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <PageHeader title="Draft Assistant" subtitle="Loading draft..." />
        <LinearProgress />
      </Container>
    );
  }

  if (error || !selectedDraft) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <PageHeader title="Draft Assistant" subtitle="" />
        <Alert severity="error" sx={{ mb: 2 }}>{error || 'Draft not found.'}</Alert>
        <Button component={Link} href="/draft-assistant" variant="contained">Back to Drafts</Button>
      </Container>
    );
  }

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4 }}>
      <Box>
        <Paper sx={{ p: 2, mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: 'primary.dark', color: 'white' }}>
          <Box>
            <Typography variant="h5" fontWeight="bold">{selectedDraft.metadata.name || 'Draft'}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ opacity: 0.8 }}>
                {selectedDraft.draft_id} • {selectedDraft.status}
              </Typography>
              <Chip
                label={isDynasty ? 'Dynasty' : 'Redraft'}
                size="small"
                color={isDynasty ? 'secondary' : 'default'}
                variant="outlined"
                sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.5)' }}
              />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <IconButton
              component="a"
              href={`https://sleeper.com/draft/nfl/${selectedDraft.draft_id}`}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ color: 'white' }}
            >
              <OpenInNewIcon />
            </IconButton>
            <Button component={Link} href={`/draft-assistant/${leagueId}/efficiency`} variant="outlined" color="inherit" startIcon={<BarChartIcon />}>
              Efficiency
            </Button>
            <Button variant="outlined" color="inherit" onClick={handleRefresh} disabled={refreshing}>
              Refresh Board
            </Button>
            <Button component={Link} href="/draft-assistant" variant="contained" color="error">
              Back to Drafts
            </Button>
          </Box>
        </Paper>

        {refreshing && <LinearProgress sx={{ mb: 2 }} />}

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, lg: panelCollapsed ? 12 : 9 }} sx={{ transition: 'all 0.3s ease' }}>
            <DraftBoard draft={selectedDraft} picks={picks} tradedPicks={tradedPicks} rosterOwnerMap={rosterOwnerMap} rosterIdToOwnerIdMap={rosterIdToOwnerIdMap} currentUserId={user?.user_id} />
          </Grid>
          <Grid size={{ xs: 12, lg: 3 }} sx={{
            display: { xs: 'block', lg: panelCollapsed ? 'none' : 'block' },
            transition: 'all 0.3s ease',
          }}>
            <Box sx={{ height: 600, position: 'relative' }}>
              <DraftSidePanel
                draft={selectedDraft}
                picks={picks}
                rosteredPlayerIds={rosteredPlayerIds}
                rosterOwnerMap={rosterOwnerMap}
                rosterIdToOwnerIdMap={rosterIdToOwnerIdMap}
                currentUserId={user?.user_id}
                recommendedDynastyVariant={recommendedDynastyVariantKey}
                recommendedRedraftVariant={recommendedRedraftVariantKey}
              />
            </Box>
          </Grid>
        </Grid>
        <Tooltip title={panelCollapsed ? 'Show Best Available' : 'Hide Best Available'}>
          <IconButton
            onClick={() => setPanelCollapsed(prev => !prev)}
            sx={{
              position: 'fixed',
              right: panelCollapsed ? 16 : 'calc(25% + 8px)',
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 1200,
              bgcolor: 'primary.main',
              color: 'white',
              '&:hover': { bgcolor: 'primary.dark' },
              transition: 'right 0.3s ease',
              display: { xs: 'none', lg: 'flex' },
            }}
          >
            {panelCollapsed ? <ChevronLeftIcon /> : <ChevronRightIcon />}
          </IconButton>
        </Tooltip>
      </Box>
    </Container>
  );
}
