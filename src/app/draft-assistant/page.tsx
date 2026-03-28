'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Container, Typography, Box, Paper, Button, Alert, List, ListItem, ListItemText, ListItemButton, Chip, Divider, LinearProgress } from '@mui/material';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';
import YearSelector from '@/components/common/YearSelector';
import { useUser } from '@/context/UserContext';
import { SleeperService, SleeperDraft } from '@/services/sleeper/sleeperService';

export default function DraftAssistantPage() {
  const router = useRouter();
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');
  const [year, setYear] = React.useState(String(new Date().getFullYear()));
  const [loading, setLoading] = React.useState(false);
  const [drafts, setDrafts] = React.useState<SleeperDraft[]>([]);

  React.useEffect(() => {
    if (user) {
      setUsername(user.username);
    } else {
      const saved = localStorage.getItem('sleeper_usernames');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.length > 0) setUsername(parsed[0]);
        } catch (e) { /* ignore */ }
      }
    }
  }, [user]);

  const handleFindDrafts = async () => {
    if (!username) return;
    setLoading(true);
    setDrafts([]);

    try {
      let currentUser = user;
      if (!currentUser || currentUser.username.toLowerCase() !== username.toLowerCase()) {
        currentUser = await SleeperService.getUser(username);
        if (!currentUser) throw new Error('User not found');
        fetchUser(username);
      }

      const foundDrafts = await SleeperService.getDrafts(currentUser.user_id, year);

      const statusOrder: Record<string, number> = { drafting: 0, paused: 1, pre_draft: 2, complete: 3 };
      foundDrafts.sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));

      setDrafts(foundDrafts);
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

      {drafts.length > 0 && (
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
    </Container>
  );
}
