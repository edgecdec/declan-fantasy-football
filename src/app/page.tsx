import * as React from 'react';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Button from '@mui/material/Button';
import Link from 'next/link';

export default function HomePage() {
  return (
    <Container maxWidth="lg">
      <Box sx={{ my: 4, textAlign: 'center' }}>
        <Typography variant="h2" component="h1" gutterBottom sx={{ fontWeight: 'bold' }}>
          Fantasy Football Analytics
        </Typography>
        <Typography variant="h5" component="h2" gutterBottom color="text.secondary">
          Dominate your league with advanced tools and rankings.
        </Typography>
      </Box>

      <Grid container spacing={4} sx={{ mt: 4 }}>
        {[
          { title: 'Portfolio Tracker', desc: 'Track your player exposure across all leagues.', href: '/portfolio', cta: 'Analyze Portfolio' },
          { title: 'Expected Wins', desc: 'Calculate your luck with All-Play win rates.', href: '/expected-wins', cta: 'Analyze Luck' },
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