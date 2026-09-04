'use client';

import * as React from 'react';
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  TableContainer, Tooltip, LinearProgress, Alert,
} from '@mui/material';
import { MARKET_SIDE_COLORS } from '@/constants/colors';

/**
 * Season-long playoff and title odds from simulating the rest of the schedule.
 *
 * Playoff and title are shown side by side on purpose, because they are not equally
 * trustworthy and the difference is the point. Playoff qualification is thirteen
 * games of signal and backtests well; the title adds a three-game single-elimination
 * bracket that washes most of an edge out. Presenting only the title number would
 * imply more precision than the model has.
 */

type Result = {
  rosterId: number;
  displayName: string;
  titleProb: number;
  playoffProb: number;
  titleSe: number;
  playoffSe: number;
  expectedWins: number;
  weekMean: number;
};

type Payload = {
  ok: boolean;
  currentWeek: number;
  lastRegularWeek: number;
  playoffTeams: number;
  sims: number;
  weeksRemaining: number;
  model: { teamWeekSd: number; leagueMeanScore: number; persistence: number; maxFaabEdgePoints: number };
  results: Result[];
};

/** One-hue magnitude bar. Probability is magnitude, so a single hue, not a ramp. */
function ProbBar({ p, colorKey }: { p: number; colorKey: 'a' | 'b' }) {
  return (
    <Box sx={{ position: 'relative', height: 8, width: '100%', minWidth: 48 }}>
      <Box
        sx={{
          position: 'absolute', left: 0, top: 0, height: 8,
          width: `${Math.max(1, p * 100)}%`,
          bgcolor: MARKET_SIDE_COLORS[colorKey],
          borderRadius: '0 4px 4px 0',
        }}
      />
    </Box>
  );
}

export default function SeasonOdds({ leagueId }: { leagueId: string }) {
  const [data, setData] = React.useState<Payload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    fetch(`/api/betting/season-odds?leagueId=${encodeURIComponent(leagueId)}`, {
      credentials: 'same-origin',
    })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!mounted) return;
        if (!res.ok) setError(body.error ?? 'Could not run the simulation.');
        else setData(body);
      })
      .catch(() => mounted && setError('Could not run the simulation.'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [leagueId]);

  if (loading) return <LinearProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return null;

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2, mb: 1.5 }}>
        <Typography variant="h6" gutterBottom>Season outlook</Typography>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
          {data.sims.toLocaleString()} simulations of the remaining {data.weeksRemaining} week
          {data.weeksRemaining === 1 ? '' : 's'} on the real schedule, with the current week
          carried in from where it actually stands. Top {data.playoffTeams} make the playoffs.
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Manager</TableCell>
                <TableCell align="right">
                  <Tooltip title="Chance of reaching the playoffs. This is the number the model is actually good at.">
                    <span>Playoffs</span>
                  </Tooltip>
                </TableCell>
                <TableCell sx={{ width: 80 }} />
                <TableCell align="right">
                  <Tooltip title="Chance of winning it all. Read this loosely — see the note below.">
                    <span>Title</span>
                  </Tooltip>
                </TableCell>
                <TableCell sx={{ width: 80 }} />
                <TableCell align="right">
                  <Tooltip title="Mean final regular-season wins across all simulations"><span>Exp W</span></Tooltip>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Points per week the simulation used for this team, after shrinking any observed edge">
                    <span>Pts/wk</span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.results.map(r => (
                <TableRow key={r.rosterId}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.displayName}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    {(r.playoffProb * 100).toFixed(1)}%
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' '}±{(r.playoffSe * 100).toFixed(1)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 0 }}><ProbBar p={r.playoffProb} colorKey="a" /></TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    {(r.titleProb * 100).toFixed(1)}%
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' '}±{(r.titleSe * 100).toFixed(1)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 0 }}><ProbBar p={r.titleProb} colorKey="b" /></TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>{r.expectedWins.toFixed(1)}</TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>{r.weekMean.toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Alert severity="warning" sx={{ mb: 1.5 }}>
        <strong>Trust the playoff number more than the title number.</strong> Backtested on
        this league&apos;s five completed seasons: playoff odds score a Brier of 0.150 against
        a 0.240 base rate and calibrate closely (teams given 75&ndash;100% made it 90.5% of the
        time). The title number does not beat picking at random — the eventual champion was
        rated 7.9% on average against a 10% baseline. That is not a bug in the simulation, it
        is the format: a weekly team sd of {data.model.teamWeekSd} makes one playoff game
        nearly a coin flip, so even a 10-point-per-week edge only wins three straight about a
        quarter of the time.
      </Alert>

      <Alert severity="info">
        Every constant is fitted from this league&apos;s own 650 completed team-weeks
        (2021&ndash;2025) in its own scoring, not assumed. Weekly team sd{' '}
        {data.model.teamWeekSd}, league mean {data.model.leagueMeanScore}. An observed
        scoring edge is shrunk to {(data.model.persistence * 100).toFixed(0)}% of itself,
        because that is how much of a first-half edge actually carried into the second half
        (r = 0.33) — week-to-week noise is 2.2&times; the real spread between teams, so most
        of a hot start is luck. Remaining FAAB moves a team by at most{' '}
        {data.model.maxFaabEdgePoints} points a week; the historical correlation between FAAB
        spent and scoring is noise (&minus;0.28 pooled), so that term reflects the optionality
        to patch an injury rather than a measured effect.
      </Alert>
    </Box>
  );
}
