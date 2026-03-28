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

      const foundDrafts = await SleeperService.getDrafts(currentUser.user_id, year);
      foundDrafts.sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));

      // Fetch leagues in parallel to classify drafts
      const uniqueLeagueIds = [...new Set(foundDrafts.map(d => d.league_id))];
      const leagues = await Promise.all(uniqueLeagueIds.map(id => SleeperService.getLeague(id)));
      const realLeagueIds = new Set(
        uniqueLeagueIds.filter((id, i) => leagues[i] && REAL_LEAGUE_STATUSES.has(leagues[i]!.status))
      );

      setRealDrafts(foundDrafts.filter(d => realLeagueIds.has(d.league_id)));
      setMockDrafts(foundDrafts.filter(d => !realLeagueIds.has(d.league_id)));
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

      <Alert severity="warning" sx={{ mb: 4 }}>
        <strong>Development Mode Only:</strong> This feature is currently under active construction. Rankings are simulated.
      </Alert>

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
