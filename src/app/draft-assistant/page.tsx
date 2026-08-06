'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Container, Typography, Box, Paper, Button, Alert, List, ListItemText, ListItemButton, Chip, Divider, LinearProgress, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';
import YearSelector from '@/components/common/YearSelector';
import { useUser } from '@/context/UserContext';
import { SleeperService, SleeperDraft } from '@/services/sleeper/sleeperService';

const REAL_LEAGUE_STATUSES = new Set(['in_season', 'complete', 'playoffs']);
const STATUS_ORDER: Record<string, number> = { drafting: 0, paused: 1, pre_draft: 2, complete: 3 };

function DraftListItem({ draft, onSelect }: { draft: SleeperDraft; onSelect: (d: SleeperDraft) => void }) {
  return (
    <ListItemButton onClick={() => onSelect(draft)}>
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
  );
}

export default function DraftAssistantPage() {
  const router = useRouter();
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');
  const [year, setYear] = React.useState(String(new Date().getFullYear()));
  const [loading, setLoading] = React.useState(false);
  const [realDrafts, setRealDrafts] = React.useState<SleeperDraft[]>([]);
  const [mockDrafts, setMockDrafts] = React.useState<SleeperDraft[]>([]);

  React.useEffect(() => {
    if (user) {
      setUsername(user.username);
    } else {
      const saved = localStorage.getItem('sleeper_usernames');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.length > 0) setUsername(parsed[0]);
        } catch { /* ignore */ }
      }
    }
  }, [user]);

  const handleFindDrafts = async () => {
    if (!username) return;
    setLoading(true);
    setRealDrafts([]);
    setMockDrafts([]);

    try {
      let currentUser = user;
      if (!currentUser || currentUser.username.toLowerCase() !== username.toLowerCase()) {
        currentUser = await SleeperService.getUser(username);
        if (!currentUser) throw new Error('User not found');
        fetchUser(username);
      }

      const [userDrafts, userLeagues] = await Promise.all([
        SleeperService.getDrafts(currentUser.user_id, year),
        SleeperService.getLeagues(currentUser.user_id, year),
      ]);

      // The user-level drafts API can miss drafts from renewed dynasty leagues.
      // Cross-reference with league-level drafts to find any missing ones.
      const draftMap = new Map(userDrafts.map(d => [d.draft_id, d]));
      const realLeagues = userLeagues.filter(l => REAL_LEAGUE_STATUSES.has(l.status));
      const leagueDraftResults = await Promise.all(
        realLeagues.map(l => SleeperService.getLeagueDrafts(l.league_id))
      );
      for (const drafts of leagueDraftResults) {
        for (const d of drafts) {
          if (!draftMap.has(d.draft_id)) draftMap.set(d.draft_id, d);
        }
      }

      const foundDrafts = [...draftMap.values()];
      foundDrafts.sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));

      // Classify drafts as real or mock. Any league the user actually belongs to
      // (per the /leagues endpoint) counts as real, regardless of its current
      // status — a league sitting in "pre_draft" is still a real league, just
      // one that hasn't drafted yet.
      const allLeagueIds = [...new Set(foundDrafts.map(d => d.league_id))];
      const realLeagueIdSet = new Set(userLeagues.map(l => l.league_id));
      // Fetch league info for any draft league_ids not already known
      const unknownIds = allLeagueIds.filter(id => !realLeagueIdSet.has(id));
      if (unknownIds.length > 0) {
        const extraLeagues = await Promise.all(unknownIds.map(id => SleeperService.getLeague(id)));
        for (let i = 0; i < unknownIds.length; i++) {
          if (extraLeagues[i] && REAL_LEAGUE_STATUSES.has(extraLeagues[i]!.status)) {
            realLeagueIdSet.add(unknownIds[i]);
          }
        }
      }

      setRealDrafts(foundDrafts.filter(d => realLeagueIdSet.has(d.league_id)));
      setMockDrafts(foundDrafts.filter(d => !realLeagueIdSet.has(d.league_id)));
    } catch (e) {
      console.error(e);
      alert('Error fetching drafts');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDraft = (draft: SleeperDraft) => {
    router.push(`/draft-assistant/${draft.league_id}`);
  };

  const hasDrafts = realDrafts.length > 0 || mockDrafts.length > 0;

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader
        title="Live Draft Assistant"
        subtitle="Real-time draft companion with dynamic rankings and VBD analysis."
      />

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

      {realDrafts.length > 0 && (
        <Paper sx={{ mb: 4 }}>
          <List disablePadding>
            {realDrafts.map((draft, index) => (
              <React.Fragment key={draft.draft_id}>
                {index > 0 && <Divider />}
                <DraftListItem draft={draft} onSelect={handleSelectDraft} />
              </React.Fragment>
            ))}
          </List>
        </Paper>
      )}

      {mockDrafts.length > 0 && (
        <Accordion defaultExpanded={realDrafts.length === 0} sx={{ mb: 4 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography>Mock Drafts ({mockDrafts.length})</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>
            <List disablePadding>
              {mockDrafts.map((draft, index) => (
                <React.Fragment key={draft.draft_id}>
                  {index > 0 && <Divider />}
                  <DraftListItem draft={draft} onSelect={handleSelectDraft} />
                </React.Fragment>
              ))}
            </List>
          </AccordionDetails>
        </Accordion>
      )}

      {!loading && hasDrafts && realDrafts.length === 0 && mockDrafts.length > 0 && (
        <Alert severity="info" sx={{ mb: 4 }}>
          No real league drafts found for {year}. Only mock drafts are shown.
        </Alert>
      )}
    </Container>
  );
}
