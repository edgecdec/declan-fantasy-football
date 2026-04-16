'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Box,
  Grid,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  Button,
  IconButton,
  Tooltip
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { LeagueBenchmarkResult } from '@/services/stats/positionalBenchmarks';
import { SleeperLeague } from '@/services/sleeper/sleeperService';
import StartsTooltip from '@/components/performance/StartsTooltip';

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

interface LeagueBreakdownProps {
  item: {
    league: SleeperLeague;
    result: LeagueBenchmarkResult;
    category: 'included' | 'excluded';
  };
  onToggle: (leagueId: string) => void;
  onViewImpacts: (impacts: any[]) => void;
}

export default function LeagueBreakdown({ item, onToggle, onViewImpacts }: LeagueBreakdownProps) {
  const { result: res, category } = item;
  const isIncluded = category === 'included';

  return (
    <Grid size={{ xs: 12 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', opacity: isIncluded ? 1 : 0.75 }}>
        <Tooltip title={isIncluded ? 'Exclude' : 'Include'}>
          <IconButton size="small" onClick={() => onToggle(res.leagueId)} color={isIncluded ? 'error' : 'success'} sx={{ mt: 1.5, mr: 1 }}>
            {isIncluded ? <RemoveCircleOutlineIcon /> : <AddCircleOutlineIcon />}
          </IconButton>
        </Tooltip>
        <Accordion sx={{ flexGrow: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h6">{res.leagueName}</Typography>
              <Link href={`/skill/league/${res.leagueId}`} passHref onClick={(e) => e.stopPropagation()}>
                <Button variant="text" size="small" sx={{ textTransform: 'none', minWidth: 'auto' }}>
                  Leaguemate Comparison →
                </Button>
              </Link>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={4}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="subtitle1" gutterBottom align="center">Average Weekly Output</Typography>
                <Box sx={{ height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={VALID_POSITIONS.map(pos => ({ pos, You: res.userStats[pos].avgPointsPerWeek, Avg: res.leagueAverageStats[pos].avgPointsPerWeek }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="pos" />
                      <YAxis />
                      <RechartsTooltip />
                      <Legend />
                      <Bar dataKey="You" fill="#8884d8" />
                      <Bar dataKey="Avg" fill="#82ca9d" />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="subtitle1" gutterBottom align="center">Efficiency (Points Per Start)</Typography>
                <Box sx={{ height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={VALID_POSITIONS.map(pos => ({ pos, You: res.userStats[pos].avgPointsPerStarter, Avg: res.leagueAverageStats[pos].avgPointsPerStarter }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="pos" />
                      <YAxis />
                      <RechartsTooltip />
                      <Legend />
                      <Bar dataKey="You" fill="#ffc658" />
                      <Bar dataKey="Avg" fill="#82ca9d" />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />
            <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>League Player Impact (Points Over League Avg)</Typography>
            <Grid container spacing={4}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>Top Contributors (Carriers)</Typography>
                {res.playerImpacts.slice(0, 5).map(p => (
                  <Box key={p.playerId} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, p: 1, bgcolor: 'rgba(76, 175, 80, 0.1)', borderRadius: 1 }}>
                    <Box>
                      <Typography variant="body2" fontWeight="bold">{p.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {p.position} • <StartsTooltip weeksStarted={p.weeksStarted} startedWeeks={p.startedWeeks} />
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="body2" fontWeight="bold" color="#66bb6a">+{p.totalPOLA.toFixed(1)}</Typography>
                      <Typography variant="caption" color="text.secondary">+{p.avgPOLA.toFixed(1)} / wk</Typography>
                    </Box>
                  </Box>
                ))}
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>Underperformers (Anchors)</Typography>
                {[...res.playerImpacts].reverse().slice(0, 5).map(p => (
                  <Box key={p.playerId} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, p: 1, bgcolor: 'rgba(239, 83, 80, 0.1)', borderRadius: 1 }}>
                    <Box>
                      <Typography variant="body2" fontWeight="bold">{p.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {p.position} • <StartsTooltip weeksStarted={p.weeksStarted} startedWeeks={p.startedWeeks} />
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="body2" fontWeight="bold" color="#ef5350">{p.totalPOLA.toFixed(1)}</Typography>
                      <Typography variant="caption" color="text.secondary">{p.avgPOLA.toFixed(1)} / wk</Typography>
                    </Box>
                  </Box>
                ))}
              </Grid>
            </Grid>

            <Box sx={{ mt: 2, textAlign: 'center', display: 'flex', gap: 2, justifyContent: 'center' }}>
              <Button variant="outlined" size="small" onClick={() => onViewImpacts(res.playerImpacts)}>
                View All League Players
              </Button>
              <Link href={`/performance/positional/league/${res.leagueId}`} passHref>
                <Button variant="contained" size="small" color="primary">
                  Full League Report
                </Button>
              </Link>
            </Box>
          </AccordionDetails>
        </Accordion>
      </Box>
    </Grid>
  );
}
