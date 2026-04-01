'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  Container, Box, Paper, Typography, LinearProgress, Alert, Button,
  ToggleButtonGroup, ToggleButton, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TableSortLabel,
} from '@mui/material';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine, ZAxis,
} from 'recharts';
import Link from 'next/link';
import PageHeader from '@/components/common/PageHeader';
import { useUser } from '@/context/UserContext';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { calculateDraftEfficiency, aggregateManagerDraftEfficiency, fetchHistoricalDraftEfficiency } from '@/services/stats/draftEfficiency';
import { DraftPickEfficiency, LogCurveCoefficients, HistoricalDraftData } from '@/types/draftEfficiency';
import { getPositionColor } from '@/constants/colors';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
const RAINBOW_BG = 'linear-gradient(90deg, red, orange, yellow, green, dodgerblue, blueviolet, red)';

type SortField = 'rank' | 'username' | 'totalEfficiency' | 'avgPerPick' | 'pickCount';
type SortDir = 'asc' | 'desc';

function buildCurveData(curve: LogCurveCoefficients, maxPick: number) {
  const pts: { pickNumber: number; totalEfficiency: number }[] = [];
  for (let x = 1; x <= maxPick; x++) {
    pts.push({ pickNumber: x, totalEfficiency: Math.round((curve.a * Math.log(x) + curve.b) * 100) / 100 });
  }
  return pts;
}

function formatPickLabel(pick: DraftPickEfficiency): string {
  const round = pick.round;
  const slot = pick.pickNumber - (round - 1) * (pick.draftSlot || 1);
  return `${round}.${String(slot).padStart(2, '0')}`;
}

function bestWorstPosition(bd: Record<string, { total: number; count: number; avg: number }>): string {
  const entries = Object.entries(bd);
  if (entries.length === 0) return '-';
  entries.sort((a, b) => b[1].avg - a[1].avg);
  const best = entries[0];
  const worst = entries[entries.length - 1];
  if (entries.length === 1) return `${best[0]}: ${best[1].avg > 0 ? '+' : ''}${best[1].avg}`;
  return `Best: ${best[0]} (${best[1].avg > 0 ? '+' : ''}${best[1].avg}) / Worst: ${worst[0]} (${worst[1].avg > 0 ? '+' : ''}${worst[1].avg})`;
}

function PickTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Record<string, unknown> }> }) {
  if (!active || !payload?.[0]) return null;
  const raw = payload[0].payload;
  if (!raw.playerName) return null;
  const p = raw as unknown as DraftPickEfficiency;
  return (
    <Paper sx={{ p: 1.5, maxWidth: 240 }}>
      <Typography variant="subtitle2" fontWeight="bold">{p.playerName}</Typography>
      <Typography variant="caption" color="text.secondary">
        {p.position} • {p.team} • Pick {formatPickLabel(p)}
      </Typography>
      <Box sx={{ mt: 0.5 }}>
        <Typography variant="body2">Efficiency: {p.totalEfficiency > 0 ? '+' : ''}{p.totalEfficiency}</Typography>
        <Typography variant="body2">Weeks Started: {p.weeksStarted}</Typography>
        <Typography variant="body2">Avg/Week: {p.avgEfficiencyPerWeek > 0 ? '+' : ''}{p.avgEfficiencyPerWeek}</Typography>
        <Typography variant="body2">Drafted by: {p.draftedByUsername}</Typography>
        {p.changedTeams && <Typography variant="body2" color="warning.main">Changed teams mid-season</Typography>}
      </Box>
    </Paper>
  );
}

export default function DraftEfficiencyPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { user } = useUser();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [picks, setPicks] = React.useState<DraftPickEfficiency[]>([]);
  const [curve, setCurve] = React.useState<LogCurveCoefficients>({ a: 0, b: 0 });
  const [currentUserRosterId, setCurrentUserRosterId] = React.useState<number | null>(null);
  const [posFilter, setPosFilter] = React.useState<string[]>([]);
  const [sortBy, setSortBy] = React.useState<SortField>('totalEfficiency');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');
  const [draftName, setDraftName] = React.useState('');
  const [showHistorical, setShowHistorical] = React.useState(false);
  const [historicalData, setHistoricalData] = React.useState<HistoricalDraftData | null>(null);
  const [historicalLoading, setHistoricalLoading] = React.useState(false);

  React.useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [drafts, rosters] = await Promise.all([
          SleeperService.getLeagueDrafts(leagueId),
          SleeperService.getRosters(leagueId),
        ]);
        const completeDraft = drafts.find(d => d.status === 'complete') || drafts[0];
        if (!completeDraft) { setError('No drafts found.'); setLoading(false); return; }

        const fullDraft = await SleeperService.getDraft(completeDraft.draft_id);
        if (cancelled) return;
        setDraftName(fullDraft?.metadata?.name || completeDraft.metadata?.name || 'Draft');

        if (user?.user_id) {
          const roster = rosters.find(r => r.owner_id === user.user_id);
          if (roster) setCurrentUserRosterId(roster.roster_id);
        }

        const result = await calculateDraftEfficiency(leagueId, completeDraft.draft_id, completeDraft.season);
        if (cancelled) return;
        setPicks(result.picks);
        setCurve(result.curve);
      } catch (e) {
        if (!cancelled) setError('Failed to load draft efficiency data.');
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [leagueId, user?.user_id]);

  React.useEffect(() => {
    if (!showHistorical || historicalData) return;
    let cancelled = false;
    setHistoricalLoading(true);

    fetchHistoricalDraftEfficiency(
      leagueId,
      (partial) => { if (!cancelled) setHistoricalData(partial); },
    ).then((final) => {
      if (!cancelled) { setHistoricalData(final); setHistoricalLoading(false); }
    }).catch(() => {
      if (!cancelled) setHistoricalLoading(false);
    });

    return () => { cancelled = true; };
  }, [showHistorical, leagueId, historicalData]);

  const filteredPicks = React.useMemo(
    () => posFilter.length ? picks.filter(p => posFilter.includes(p.position)) : picks,
    [picks, posFilter]
  );

  const managers = React.useMemo(
    () => aggregateManagerDraftEfficiency(picks, posFilter.length ? posFilter : undefined),
    [picks, posFilter]
  );

  const sortedManagers = React.useMemo(() => {
    const ranked = managers.map((m, i) => ({ ...m, rank: i + 1 }));
    return [...ranked].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'username') return dir * a.username.localeCompare(b.username);
      if (sortBy === 'rank') return dir * (a.rank - b.rank);
      return dir * ((a[sortBy] as number) - (b[sortBy] as number));
    });
  }, [managers, sortBy, sortDir]);

  const curveData = React.useMemo(() => {
    const maxPick = picks.length > 0 ? Math.max(...picks.map(p => p.pickNumber)) : 0;
    return buildCurveData(curve, maxPick);
  }, [curve, picks]);

  const historicalCurveData = React.useMemo(() => {
    if (!showHistorical || !historicalData) return [];
    return historicalData.averagesByPick.map(h => ({
      pickNumber: h.pickNumber,
      totalEfficiency: h.avgEfficiency,
    }));
  }, [showHistorical, historicalData]);

  const filteredSeasonSummaries = React.useMemo(() => {
    if (!historicalData) return [];
    return historicalData.seasonSummaries;
  }, [historicalData]);

  const handleSort = (field: SortField) => {
    setSortDir(prev => sortBy === field ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setSortBy(field);
  };

  const handlePosFilter = (_: React.MouseEvent<HTMLElement>, newVal: string[]) => {
    setPosFilter(newVal);
  };

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <PageHeader title="Draft Efficiency" subtitle="Calculating..." />
        <LinearProgress />
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <PageHeader title="Draft Efficiency" subtitle="" />
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        <Button component={Link} href={`/draft-assistant/${leagueId}`} variant="contained">Back to Draft</Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader title="Draft Efficiency" subtitle={draftName} action={
        <Button component={Link} href={`/draft-assistant/${leagueId}`} variant="outlined">Back to Draft</Button>
      } />

      {/* Position Filter & Historical Toggle */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">Filter by position:</Typography>
        <ToggleButtonGroup value={posFilter} onChange={handlePosFilter} size="small">
          {POSITIONS.map(pos => (
            <ToggleButton key={pos} value={pos} sx={{ px: 1.5, color: getPositionColor(pos), '&.Mui-selected': { bgcolor: getPositionColor(pos), color: '#fff' } }}>
              {pos}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ToggleButtonGroup
          value={showHistorical ? ['historical'] : []}
          onChange={() => setShowHistorical(prev => !prev)}
          size="small"
        >
          <ToggleButton value="historical" sx={{ px: 2 }}>
            📊 Historical
          </ToggleButton>
        </ToggleButtonGroup>
        {historicalLoading && <Typography variant="caption" color="text.secondary">Loading historical data...</Typography>}
      </Box>

      {/* Scatter Plot */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Pick Efficiency vs. Draft Position</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
          Dots above the curve = steals • Dots below = busts
        </Typography>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="pickNumber" type="number" name="Pick #" label={{ value: 'Pick #', position: 'insideBottom', offset: -5 }} />
            <YAxis dataKey="totalEfficiency" type="number" name="Efficiency" label={{ value: 'Total Efficiency', angle: -90, position: 'insideLeft' }} />
            <ZAxis range={[30, 30]} />
            <ReferenceLine y={0} stroke="#666" strokeDasharray="4 4" />
            <Scatter name="Expected (log fit)" data={curveData} fill="#ff9800" line={{ stroke: '#ff9800', strokeWidth: 2 }} shape={() => null} />
            {showHistorical && historicalCurveData.length > 0 && (
              <Scatter name="Historical Avg" data={historicalCurveData} fill="#9e9e9e" line={{ stroke: '#9e9e9e', strokeWidth: 2, strokeDasharray: '6 3' }} shape={() => null} legendType="line" />
            )}
            {POSITIONS.map(pos => {
              const posData = filteredPicks.filter(p => p.position === pos);
              if (posData.length === 0) return null;
              return (
                <Scatter key={pos} name={pos} data={posData} fill={getPositionColor(pos)} opacity={0.85} />
              );
            })}
            <RechartsTooltip content={<PickTooltip />} />
          </ScatterChart>
        </ResponsiveContainer>
        {/* Legend */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1, justifyContent: 'center' }}>
          {POSITIONS.map(pos => (
            <Box key={pos} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: getPositionColor(pos) }} />
              <Typography variant="caption">{pos}</Typography>
            </Box>
          ))}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 16, height: 2, bgcolor: '#ff9800' }} />
            <Typography variant="caption">Expected (log fit)</Typography>
          </Box>
          {showHistorical && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 16, height: 2, bgcolor: '#9e9e9e', opacity: 0.5 }} />
              <Typography variant="caption">Historical Avg</Typography>
            </Box>
          )}
        </Box>
      </Paper>

      {/* Manager Leaderboard */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Manager Draft Leaderboard</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {([
                  ['rank', 'Rank'],
                  ['username', 'Manager'],
                  ['totalEfficiency', 'Total Efficiency'],
                  ['avgPerPick', 'Avg / Pick'],
                  ['pickCount', 'Picks'],
                ] as [SortField, string][]).map(([field, label]) => (
                  <TableCell key={field} sortDirection={sortBy === field ? sortDir : false}>
                    <TableSortLabel active={sortBy === field} direction={sortBy === field ? sortDir : 'desc'} onClick={() => handleSort(field)}>
                      {label}
                    </TableSortLabel>
                  </TableCell>
                ))}
                <TableCell>Best / Worst Position</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedManagers.map((m) => {
                const isUser = m.rosterId === currentUserRosterId;
                return (
                  <TableRow
                    key={m.rosterId}
                    sx={isUser ? {
                      backgroundImage: RAINBOW_BG,
                      backgroundSize: '200% 100%',
                      animation: 'rainbowSlide 3.5s linear infinite',
                      '@keyframes rainbowSlide': {
                        '0%': { backgroundPosition: '0% 0%' },
                        '100%': { backgroundPosition: '200% 0%' },
                      },
                    } : undefined}
                  >
                    <TableCell sx={{ fontWeight: isUser ? 'bold' : 'normal', color: isUser ? '#fff' : undefined }}>
                      {managers.findIndex(mgr => mgr.rosterId === m.rosterId) + 1}
                    </TableCell>
                    <TableCell sx={{ fontWeight: isUser ? 'bold' : 'normal', color: isUser ? '#fff' : undefined }}>
                      {m.username}{isUser ? ' (You)' : ''}
                    </TableCell>
                    <TableCell sx={{
                      fontWeight: isUser ? 'bold' : 'normal',
                      color: isUser ? '#fff' : m.totalEfficiency > 0 ? 'success.main' : m.totalEfficiency < 0 ? 'error.main' : 'text.primary',
                    }}>
                      {m.totalEfficiency > 0 ? '+' : ''}{m.totalEfficiency}
                    </TableCell>
                    <TableCell sx={{
                      color: isUser ? '#fff' : m.avgPerPick > 0 ? 'success.main' : m.avgPerPick < 0 ? 'error.main' : 'text.primary',
                    }}>
                      {m.avgPerPick > 0 ? '+' : ''}{m.avgPerPick}
                    </TableCell>
                    <TableCell sx={{ color: isUser ? '#fff' : undefined }}>{m.pickCount}</TableCell>
                    <TableCell sx={{ color: isUser ? '#fff' : undefined }}>
                      <Typography variant="caption" sx={{ color: 'inherit' }}>{bestWorstPosition(m.positionBreakdown)}</Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Historical Season Summaries */}
      {showHistorical && filteredSeasonSummaries.length > 0 && (
        <Paper sx={{ p: 2, mt: 3 }}>
          <Typography variant="h6" gutterBottom>League Draft Efficiency by Season</Typography>
          {historicalLoading && <LinearProgress sx={{ mb: 1 }} />}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Season</TableCell>
                  <TableCell>League</TableCell>
                  <TableCell>Total Efficiency</TableCell>
                  <TableCell>Avg / Pick</TableCell>
                  <TableCell>Picks</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredSeasonSummaries.map((s) => (
                  <TableRow key={`${s.season}-${s.leagueId}`}>
                    <TableCell>{s.season}</TableCell>
                    <TableCell>
                      <Link href={`/draft-assistant/${s.leagueId}/efficiency`} style={{ color: 'inherit', textDecoration: 'underline' }}>
                        {s.leagueName}
                      </Link>
                    </TableCell>
                    <TableCell sx={{ color: s.totalEfficiency > 0 ? 'success.main' : s.totalEfficiency < 0 ? 'error.main' : 'text.primary' }}>
                      {s.totalEfficiency > 0 ? '+' : ''}{s.totalEfficiency}
                    </TableCell>
                    <TableCell sx={{ color: s.avgPerPick > 0 ? 'success.main' : s.avgPerPick < 0 ? 'error.main' : 'text.primary' }}>
                      {s.avgPerPick > 0 ? '+' : ''}{s.avgPerPick}
                    </TableCell>
                    <TableCell>{s.pickCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Container>
  );
}
