'use client';

import * as React from 'react';
import { Card, CardContent, Grid, Typography, Divider } from '@mui/material';

type LuckSummaryCardProps = {
  actualWins: number;
  expectedWins: number;
  totalOpportunities: number;
  pointsFor: number;
  pointsAgainst: number;
  showAdvanced?: boolean;
};

export default function LuckSummaryCard({ 
  actualWins, 
  expectedWins, 
  totalOpportunities, 
  pointsFor, 
  pointsAgainst, 
  showAdvanced = false 
}: LuckSummaryCardProps) {
  
  const diff = actualWins - expectedWins;
  const pointsDiff = pointsFor - pointsAgainst;

  const actualPct = totalOpportunities > 0 ? (actualWins / totalOpportunities) * 100 : 0;
  const expectedPct = totalOpportunities > 0 ? (expectedWins / totalOpportunities) * 100 : 0;

  return (
    <Card sx={{ mb: 4, bgcolor: '#0d47a1', color: 'white', border: '1px solid rgba(255,255,255,0.1)', boxShadow: 4 }}>
      <CardContent>
        <Grid container spacing={4} textAlign="center">
          <Grid size={{ xs: 12, md: 4 }}>
            <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.7)' }}>Actual</Typography>
            <Typography variant="h3" fontWeight="bold">
              {actualWins.toFixed(0)} <Typography component="span" variant="h5" sx={{ color: 'rgba(255,255,255,0.5)' }}>Wins</Typography>
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>Win Rate: {actualPct.toFixed(1)}%</Typography>
          </Grid>
          
          <Grid size={{ xs: 12, md: 4 }}>
            <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.7)' }}>Expected</Typography>
            <Typography variant="h3" fontWeight="bold">
              {expectedWins.toFixed(1)} <Typography component="span" variant="h5" sx={{ color: 'rgba(255,255,255,0.5)' }}>Wins</Typography>
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>Exp. Win Rate: {expectedPct.toFixed(1)}%</Typography>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.7)' }}>Luck</Typography>
            <Typography variant="h3" fontWeight="bold" sx={{ color: diff > 0 ? '#66bb6a' : '#ef5350' }}>
              {diff > 0 ? '+' : ''}{diff.toFixed(1)}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>Wins vs Expected</Typography>
          </Grid>

          {showAdvanced && (
            <>
              <Grid size={{ xs: 12 }}><Divider sx={{ bgcolor: 'rgba(255,255,255,0.1)' }} /></Grid>
              
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.7)' }}>Points For</Typography>
                <Typography variant="h4" fontWeight="bold">{pointsFor.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Typography>
              </Grid>
              
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.7)' }}>Points Against</Typography>
                <Typography variant="h4" fontWeight="bold">{pointsAgainst.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Typography>
              </Grid>

              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.7)' }}>Point Diff</Typography>
                <Typography variant="h4" fontWeight="bold" sx={{ color: pointsDiff > 0 ? '#66bb6a' : '#ef5350' }}>
                  {pointsDiff > 0 ? '+' : ''}{pointsDiff.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </Typography>
              </Grid>
            </>
          )}
        </Grid>
      </CardContent>
    </Card>
  );
}
