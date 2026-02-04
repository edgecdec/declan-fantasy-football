'use client';

import * as React from 'react';
import { Container, Typography, Box, Paper, Button, Alert } from '@mui/material';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';
import YearSelector from '@/components/common/YearSelector';
import { useUser } from '@/context/UserContext';

export default function DraftAssistantPage() {
  const { user } = useUser();
  const [username, setUsername] = React.useState('');
  const [year, setYear] = React.useState('2025');

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
          <UserSearchInput username={username} setUsername={setUsername} />
          <YearSelector 
            userId={user?.user_id} 
            selectedYear={year} 
            onChange={setYear} 
          />
          <Button variant="contained" size="large" sx={{ height: 56 }}>
            Find Active Drafts
          </Button>
        </Box>
      </Paper>

      {/* Placeholder for future content */}
      <Box sx={{ textAlign: 'center', py: 8, opacity: 0.5 }}>
        <Typography variant="h4" gutterBottom>Draft Board Placeholder</Typography>
        <Typography>Rankings will appear here once the scraper pipeline is established.</Typography>
      </Box>
    </Container>
  );
}
