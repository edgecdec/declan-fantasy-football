'use client';

import * as React from 'react';
import { 
  Container, 
  Typography, 
  Box, 
  Grid, 
  Card, 
  CardContent, 
  CardActions, 
  Button, 
  TextField, 
  Avatar,
  IconButton,
  Tooltip
} from '@mui/material';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';
import LogoutIcon from '@mui/icons-material/Logout';

export default function HomePage() {
  const { user, fetchUser, logout, loading } = useUser();
  const [usernameInput, setUsernameInput] = React.useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput) return;
    try {
      await fetchUser(usernameInput);
    } catch (e) {
      alert('User not found!');
    }
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ my: 6, textAlign: 'center' }}>
        
        {/* Welcome / Login Section */}
        {user ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 6 }}>
            <Avatar 
              src={`https://sleepercdn.com/avatars/${user.avatar}`} 
              sx={{ width: 100, height: 100, mb: 2, border: '4px solid #fff', boxShadow: 3 }}
            />
            <Typography variant="h3" component="h1" gutterBottom fontWeight="bold">
              Welcome back, {user.display_name}!
            </Typography>
            <Button 
              variant="outlined" 
              color="error" 
              startIcon={<LogoutIcon />} 
              onClick={logout}
              sx={{ mt: 1 }}
            >
              Change User
            </Button>
          </Box>
        ) : (
          <Box sx={{ maxWidth: 500, mx: 'auto', mb: 6 }}>
            <Typography variant="h2" component="h1" gutterBottom fontWeight="bold">
              Fantasy Analytics
            </Typography>
            <Typography variant="h6" color="text.secondary" sx={{ mb: 4 }}>
              Enter your Sleeper username to unlock personalized insights.
            </Typography>
            
            <form onSubmit={handleLogin}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField 
                  fullWidth 
                  label="Sleeper Username" 
                  variant="outlined" 
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  disabled={loading}
                />
                <Button 
                  type="submit" 
                  variant="contained" 
                  size="large"
                  disabled={loading || !usernameInput}
                  sx={{ px: 4 }}
                >
                  {loading ? '...' : 'Go'}
                </Button>
              </Box>
            </form>
            
            <Button 
              variant="text" 
              size="small" 
              onClick={() => fetchUser('edgecdec')} 
              disabled={loading}
              sx={{ mt: 1, textTransform: 'none', color: 'text.secondary', '&:hover': { color: 'primary.main', bgcolor: 'transparent', textDecoration: 'underline' } }}
            >
              Don't have a username? Try <strong>&nbsp;edgecdec</strong>
            </Button>
          </Box>
        )}

        <Typography variant="h5" component="h2" gutterBottom color="text.secondary" sx={{ opacity: user ? 1 : 0.5 }}>
          Dominate your league with advanced tools and rankings.
        </Typography>
      </Box>

      {/* Feature Cards */}
      <Grid container spacing={4} sx={{ mt: 2 }}>
        {[
          { title: 'Expected Wins', desc: 'Calculate your luck with All-Play win rates.', href: '/expected-wins', cta: 'Analyze Luck' },
          { title: 'Positional Benchmarks', desc: 'Compare your positional output and efficiency against league averages.', href: '/performance/positional', cta: 'View Benchmarks' },
          { title: 'Season Review', desc: 'Analyze your final placements and playoff performance.', href: '/performance', cta: 'View Results' },
          { title: 'Legacy Analyzer', desc: 'Explore all-time history, rivalries, and head-to-head records.', href: '/league-history', cta: 'Explore History' },
          { title: 'Roster Medic', desc: 'Scan rosters for empty spots, IR violations, and inactive starters.', href: '/medic', cta: 'Scan Rosters' },
          { title: 'Portfolio Tracker', desc: 'Track your player exposure across all leagues.', href: '/portfolio', cta: 'Analyze Portfolio' },
          { title: 'Player Database', desc: 'Search and filter all active NFL players.', href: '/players', cta: 'Search Players' },
        ].map((feature) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={feature.title}>
            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Typography gutterBottom variant="h5" component="div">
                  {feature.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {feature.desc}
                </Typography>
              </CardContent>
              <CardActions>
                <Link href={feature.href} passHref style={{ width: '100%' }}>
                  <Button size="large" variant="contained" fullWidth>
                    {feature.cta}
                  </Button>
                </Link>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Container>
  );
}
