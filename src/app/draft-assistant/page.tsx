'use client';

import * as React from 'react';
import { Container, Typography, Box, Paper, Button, Alert, List, ListItem, ListItemText, ListItemButton, Chip, Divider, LinearProgress, Grid } from '@mui/material';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';
import YearSelector from '@/components/common/YearSelector';
import { useUser } from '@/context/UserContext';
import { SleeperService, SleeperDraft, SleeperDraftPick, SleeperTradedPick, SleeperLeagueUser } from '@/services/sleeper/sleeperService';
import DraftBoard from '@/components/draft/DraftBoard';
import BestAvailable from '@/components/draft/BestAvailable';

const DYNASTY_LEAGUE_TYPE = 2;

export default function DraftAssistantPage() {
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');
  const [year, setYear] = React.useState(String(new Date().getFullYear()));
  
  const [loading, setLoading] = React.useState(false);
  const [drafts, setDrafts] = React.useState<SleeperDraft[]>([]);
  const [selectedDraft, setSelectedDraft] = React.useState<SleeperDraft | null>(null);
  const [picks, setPicks] = React.useState<SleeperDraftPick[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [isDynasty, setIsDynasty] = React.useState(false);
  const [rosteredPlayerIds, setRosteredPlayerIds] = React.useState<Set<string>>(new Set());
  const [tradedPicks, setTradedPicks] = React.useState<SleeperTradedPick[]>([]);
  const [rosterOwnerMap, setRosterOwnerMap] = React.useState<Map<number, string>>(new Map());

  // Init username
  React.useEffect(() => {
    if (user) {
      setUsername(user.username);
    } else {
      const saved = localStorage.getItem('sleeper_usernames');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.length > 0) setUsername(parsed[0]);
        } catch (e) {}
      }
    }
  }, [user]);

  // Poll for updates if connected
  React.useEffect(() => {
    let interval: NodeJS.Timeout;
    if (selectedDraft && selectedDraft.status === 'drafting') {
      interval = setInterval(fetchPicks, 15000); // 15s refresh
    }
    return () => clearInterval(interval);
  }, [selectedDraft]);

  const handleFindDrafts = async () => {
    if (!username) return;
    setLoading(true);
    setDrafts([]);
    setSelectedDraft(null);
    setPicks([]);

    try {
      let currentUser = user;
      if (!currentUser || currentUser.username.toLowerCase() !== username.toLowerCase()) {
        currentUser = await SleeperService.getUser(username);
        if (!currentUser) throw new Error('User not found');
        fetchUser(username);
      }

      const foundDrafts = await SleeperService.getDrafts(currentUser.user_id, year);
      
      const statusOrder = { 'drafting': 0, 'paused': 1, 'pre_draft': 2, 'complete': 3 };
      foundDrafts.sort((a, b) => {
        const sA = statusOrder[a.status as keyof typeof statusOrder] ?? 99;
        const sB = statusOrder[b.status as keyof typeof statusOrder] ?? 99;
        return sA - sB;
      });

      setDrafts(foundDrafts);

    } catch (e) {
      console.error(e);
      alert('Error fetching drafts');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDraft = async (draft: SleeperDraft) => {
    setSelectedDraft(draft);
    setRefreshing(true);
    setIsDynasty(false);
    setRosteredPlayerIds(new Set());
    setTradedPicks([]);
    setRosterOwnerMap(new Map());
    try {
      const [fetchedPicks, league, draftTradedPicks, rosters, leagueUsers] = await Promise.all([
        SleeperService.getDraftPicks(draft.draft_id),
        SleeperService.getLeague(draft.league_id),
        SleeperService.getDraftTradedPicks(draft.draft_id),
        SleeperService.getRosters(draft.league_id),
        SleeperService.getLeagueUsers(draft.league_id),
      ]);
      setPicks(fetchedPicks);
      setTradedPicks(draftTradedPicks);

      // Build roster_id → display_name map
      const userDisplayNames = new Map<string, string>();
      for (const u of leagueUsers) {
        userDisplayNames.set(u.user_id, u.display_name);
      }
      const ownerMap = new Map<number, string>();
      for (const roster of rosters) {
        const name = userDisplayNames.get(roster.owner_id) || `Team ${roster.roster_id}`;
        ownerMap.set(roster.roster_id, name);
      }
      setRosterOwnerMap(ownerMap);

      const dynasty = league?.settings?.type === DYNASTY_LEAGUE_TYPE;
      setIsDynasty(dynasty);

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
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  };

  const fetchPicks = async () => {
    if (!selectedDraft) return;
    try {
      const fetchedPicks = await SleeperService.getDraftPicks(selectedDraft.draft_id);
      setPicks(fetchedPicks);
    } catch (e) { console.error(e); }
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader 
        title="Live Draft Assistant" 
        subtitle="Real-time draft companion with dynamic rankings and VBD analysis." 
      />

      <Alert severity="warning" sx={{ mb: 4 }}>
        <strong>Development Mode Only:</strong> This feature is currently under active construction. Rankings are simulated.
      </Alert>

      {/* Connection Panel */}
      {!selectedDraft && (
        <Paper sx={{ p: 3, mb: 4 }}>
          <Typography variant="h6" gutterBottom>Connect to Draft</Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <UserSearchInput username={username} setUsername={setUsername} disabled={loading} />
            <YearSelector 
              userId={user?.user_id} 
              selectedYear={year} 
              onChange={setYear} 
              disabled={loading}
              requirePlayedGames={false}
            />
            <Button 
              variant="contained" 
              size="large" 
              sx={{ height: 56 }}
              onClick={handleFindDrafts}
              disabled={loading || !username}
            >
              {loading ? 'Scanning...' : 'Find Drafts'}
            </Button>
          </Box>
          {loading && <LinearProgress sx={{ mt: 2 }} />}
        </Paper>
      )}

      {/* Draft List */}
      {!selectedDraft && drafts.length > 0 && (
        <Paper sx={{ mb: 4 }}>
          <List>
            {drafts.map((draft, index) => (
              <React.Fragment key={draft.draft_id}>
                {index > 0 && <Divider />}
                <ListItem disablePadding>
                  <ListItemButton onClick={() => handleSelectDraft(draft)}>
                    <ListItemText 
                      primary={draft.metadata.name || `Draft ${draft.season}`}
                      secondary={`${draft.type} • ${draft.settings.teams} Teams • ${draft.settings.rounds} Rounds`}
                    />
                    <Chip 
                      label={draft.status.replace('_', ' ')} 
                      color={draft.status === 'drafting' ? 'success' : draft.status === 'complete' ? 'default' : 'warning'} 
                      size="small"
                    />
                  </ListItemButton>
                </ListItem>
              </React.Fragment>
            ))}
          </List>
        </Paper>
      )}

      {/* Connected Draft View */}
      {selectedDraft && (
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
              <Button variant="outlined" color="inherit" onClick={fetchPicks} disabled={refreshing}>
                Refresh Board
              </Button>
              <Button variant="contained" color="error" onClick={() => setSelectedDraft(null)}>
                Disconnect
              </Button>
            </Box>
          </Paper>

          {refreshing && <LinearProgress sx={{ mb: 2 }} />}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, lg: 9 }}>
              <DraftBoard draft={selectedDraft} picks={picks} tradedPicks={tradedPicks} rosterOwnerMap={rosterOwnerMap} currentUserId={user?.user_id} />
            </Grid>
            <Grid size={{ xs: 12, lg: 3 }}>
              <Box sx={{ height: 600 }}>
                <BestAvailable draft={selectedDraft} picks={picks} rosteredPlayerIds={rosteredPlayerIds} />
              </Box>
            </Grid>
          </Grid>
        </Box>
      )}
    </Container>
  );
}
