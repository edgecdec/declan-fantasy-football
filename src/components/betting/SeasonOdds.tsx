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
  model: {
    teamWeekSd: number;
    trueSkillSd: number;
    leagueMeanScore: number;
    leagueMeanProjection: number;
    observedShrinkage: number;
    projectionPersistence: number;
    maxFaabEdgePoints: number;
  };
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
        <strong>Trust the playoff number more than the title number.</strong> Backtested
        across this league&apos;s five completed seasons, playoff odds beat the base rate
        clearly (Brier 0.14 against 0.24) and calibrate close to the diagonal — teams given
        75&ndash;100% made it 91% of the time. The title number does not beat picking at
        random. That is the format, not a bug: at a weekly team sd of {data.model.teamWeekSd}
        {' '}one playoff game is nearly a coin flip, so even a 10-point-per-week edge wins
        three straight only about a quarter of the time.
      </Alert>

      <Alert severity="info" sx={{ mb: 1.5 }}>
        <strong>Why nobody is a big favourite this early.</strong> Teams really do differ,
        but only by about <strong>{data.model.trueSkillSd} points a week</strong>, and weekly
        noise is {(data.model.teamWeekSd / data.model.trueSkillSd).toFixed(1)}&times; that.
        Decomposing 650 real team-weeks: the observed spread of team season averages is 7.5
        points, but luck alone over 13 games would produce 6.2 of it, so only{' '}
        <strong>32%</strong> of the apparent difference between these teams is real. An
        observed scoring edge is carried forward at{' '}
        {(data.model.observedShrinkage * 100).toFixed(0)}% of face value at this point in
        the season, rising as games accumulate.
      </Alert>

      <Alert severity="info">
        <strong>Preseason projections are worth almost nothing here, and are weighted
        accordingly.</strong> Regressing each team&apos;s week-1 projected lineup against
        what it actually averaged that season, across all 50 completed team-seasons, gives
        r = +0.03 (slope {data.model.projectionPersistence}) — indistinguishable from zero at
        this sample size. So a projected edge enters at{' '}
        {(data.model.projectionPersistence * 100).toFixed(1)}% of its size: a team projected
        9 points clear of the field is modelled about a third of a point clear. Two reasons
        it fails. Most of the raw gap is roster <em>shape</em>, not strength — a
        receiver-heavy lineup projects far above the field at WR and far below at RB, which
        nets to nothing. And much of the rest sits in the positions projections predict
        worst: defence projections explain 7% of week-1 variance, and a defence&apos;s week-1
        score correlates with its rest-of-season average at r = &minus;0.01, &minus;0.05,
        +0.03 across three seasons. Defence is not sticky. Remaining FAAB moves a team by at
        most {data.model.maxFaabEdgePoints} points a week; the historical correlation between
        FAAB spent and scoring is noise (&minus;0.28 pooled), so that term stands for the
        option to patch an injury rather than a measured effect.
      </Alert>
    </Box>
  );
}
