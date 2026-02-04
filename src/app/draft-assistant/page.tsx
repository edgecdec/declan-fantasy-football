'use client';

import * as React from 'react';
import { Container, Typography, Box, Paper, Button, Alert, List, ListItem, ListItemText, ListItemButton, Chip, Divider, LinearProgress } from '@mui/material';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';
import YearSelector from '@/components/common/YearSelector';
import { useUser } from '@/context/UserContext';
import { SleeperService, SleeperDraft } from '@/services/sleeper/sleeperService';

export default function DraftAssistantPage() {
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');
  // Drafts happen early, so default to actual current year (e.g. Feb 2026 = 2026 season)
  const [year, setYear] = React.useState(String(new Date().getFullYear()));
  
  const [loading, setLoading] = React.useState(false);
  const [drafts, setDrafts] = React.useState<SleeperDraft[]>([]);
  const [selectedDraft, setSelectedDraft] = React.useState<SleeperDraft | null>(null);

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

  const handleFindDrafts = async () => {
    if (!username) return;
    setLoading(true);
    setDrafts([]);
    setSelectedDraft(null);

    try {
      let currentUser = user;
      // Ensure we have the correct user object if username changed manually
      if (!currentUser || currentUser.username.toLowerCase() !== username.toLowerCase()) {
        currentUser = await SleeperService.getUser(username);
        if (!currentUser) throw new Error('User not found');
        fetchUser(username); // Update context
      }

      const foundDrafts = await SleeperService.getDrafts(currentUser.user_id, year);
      
      // Filter out completed ones? Maybe keep them for testing/review.
      // Sort by status: drafting -> pre_draft -> complete
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

  const handleSelectDraft = (draft: SleeperDraft) => {
    setSelectedDraft(draft);
    // TODO: Load picks and rankings
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader 
        title="Live Draft Assistant" 
        subtitle="Real-time draft companion with dynamic rankings and VBD analysis." 
      />

      <Alert severity="warning" sx={{ mb: 4 }}>
        <strong>Development Mode Only:</strong> This feature is currently under active construction. Data may be mocked or unavailable.
      </Alert>

      {/* Connection Panel */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>Connect to Draft</Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <UserSearchInput username={username} setUsername={setUsername} disabled={loading} />
          <YearSelector 
            userId={user?.user_id} 
            selectedYear={year} 
            onChange={setYear} 
            disabled={loading}
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
                      secondary={`${draft.type} • ${draft.settings.teams} Teams`}
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

      {/* Draft Board Placeholder */}
      {selectedDraft && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h4" gutterBottom>Connected to: {selectedDraft.metadata.name}</Typography>
          <Typography>ID: {selectedDraft.draft_id}</Typography>
          <Button variant="outlined" onClick={() => setSelectedDraft(null)} sx={{ mt: 2 }}>Back to List</Button>
        </Box>
      )}
    </Container>
  );
}
