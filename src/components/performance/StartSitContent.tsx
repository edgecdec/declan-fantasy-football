'use client';

import * as React from 'react';
import {
  Box, Paper, Typography, LinearProgress, Grid,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableSortLabel, Chip, Collapse, IconButton, Tooltip,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useUser } from '@/context/UserContext';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { analyzeMultiLeagueSeason } from '@/services/stats/lineupOptimizer';
import { SeasonDecisionSummary, LineupMistake, PositionAccuracy, WeeklyDecision } from '@/types/lineup';
import UserSearchInput from '@/components/common/UserSearchInput';
import YearSelector from '@/components/common/YearSelector';
import { getPositionColor } from '@/constants/colors';
import useSeason from '@/hooks/useSeason';

const TOP_N = 5;
const HIGH_ACC = 90;
const MID_ACC = 70;

/* ── Helper types ── */
type LeagueWeekRow = {
  leagueId: string;
  leagueName: string;
  netSkill: number;
  mistakeCount: number;
  decision: WeeklyDecision;
};

type WeekRow = {
  week: number;
  netSkill: number;
  leagues: LeagueWeekRow[];
};

/* ── Helpers ── */
function weekSkill(d: WeeklyDecision): number {
  return d.optimal.mistakes.reduce((s, m) => s + (m.actualDiff ?? 0), 0);
}

function buildWeekRows(summaries: SeasonDecisionSummary[]): WeekRow[] {
  const map = new Map<number, WeekRow>();
  for (const s of summaries) {
    for (const w of s.weeklyDecisions) {
      const skill = weekSkill(w);
      const entry = map.get(w.week) || { week: w.week, netSkill: 0, leagues: [] };
      entry.netSkill += skill;
      entry.leagues.push({
        leagueId: w.leagueId || s.leagueId,
        leagueName: w.leagueName || s.leagueName,
        netSkill: skill,
        mistakeCount: w.optimal.mistakes.length,
        decision: w,
      });
      map.set(w.week, entry);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.week - b.week);
}

function mergePositionAccuracy(summaries: SeasonDecisionSummary[]): PositionAccuracy[] {
  const map = new Map<string, { correct: number; total: number }>();
  for (const s of summaries) {
    for (const pa of s.positionAccuracy) {
      const e = map.get(pa.position) || { correct: 0, total: 0 };
      e.correct += pa.correct;
      e.total += pa.total;
      map.set(pa.position, e);
    }
  }
  return Array.from(map.entries())
    .map(([position, d]) => ({
      position, ...d, accuracy: d.total > 0 ? (d.correct / d.total) * 100 : 100,
    }))
    .sort((a, b) => a.accuracy - b.accuracy);
}

function fmtPts(v: number | undefined): string {
  return v != null ? v.toFixed(1) : '—';
}

function skillColor(v: number): 'success.main' | 'error.main' | 'text.secondary' {
  return v > 0 ? 'success.main' : v < 0 ? 'error.main' : 'text.secondary';
}

/* ── Lineup comparison (Level 3) ── */
function LineupTable({ decision }: { decision: WeeklyDecision }) {
  const { mistakes, actualLineup, optimalLineup } = decision.optimal;
  if (mistakes.length === 0) {
    return <Typography variant="body2" color="success.main" sx={{ py: 1 }}>✓ Optimal lineup set.</Typography>;
  }

  const mistakeMap = new Map<string, LineupMistake>();
  for (const m of mistakes) mistakeMap.set(m.slot + m.started.playerId, m);

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Slot</TableCell>
          <TableCell>You Started</TableCell>
          <TableCell align="right">Proj</TableCell>
          <TableCell align="right">Actual</TableCell>
          <TableCell>Optimal Pick</TableCell>
          <TableCell align="right">Proj</TableCell>
          <TableCell align="right">Actual</TableCell>
          <TableCell align="right">Skill +/−</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {actualLineup.map((a, i) => {
          const key = a.slot + a.playerId;
          const m = mistakeMap.get(key);
          if (!m) return null; // only show mistakes
          const o = optimalLineup[i];
          const diff = m.actualDiff;
          return (
            <TableRow key={i} sx={{ bgcolor: 'action.hover' }}>
              <TableCell>
                <Chip label={a.slot} size="small"
                  sx={{ bgcolor: getPositionColor(a.position), color: '#fff', fontWeight: 700, minWidth: 50 }} />
              </TableCell>
              <TableCell sx={{ color: 'error.main' }}>{m.started.playerName}</TableCell>
              <TableCell align="right">{fmtPts(m.started.projectedPoints)}</TableCell>
              <TableCell align="right">{fmtPts(m.started.actualPoints)}</TableCell>
              <TableCell sx={{ color: 'success.main' }}>{m.shouldHaveStarted.playerName}</TableCell>
              <TableCell align="right">{fmtPts(m.shouldHaveStarted.projectedPoints)}</TableCell>
              <TableCell align="right">{fmtPts(m.shouldHaveStarted.actualPoints)}</TableCell>
              <TableCell align="right" sx={{ color: diff != null ? skillColor(diff) : 'text.secondary', fontWeight: 600 }}>
                {diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}` : '—'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/* ── League row (Level 2) ── */
function LeagueRow({ row, expanded, onToggle }: {
  row: LeagueWeekRow; expanded: boolean; onToggle: () => void;
}) {
  return (
    <>
      <TableRow hover sx={{ cursor: 'pointer', '& > *': { borderBottom: expanded ? 'unset' : undefined } }} onClick={onToggle}>
        <TableCell sx={{ pl: 4 }}>
          <IconButton size="small">{expanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}</IconButton>
        </TableCell>
        <TableCell>{row.leagueName}</TableCell>
        <TableCell align="right" sx={{ color: skillColor(row.netSkill), fontWeight: 600 }}>
          {row.netSkill >= 0 ? '+' : ''}{row.netSkill.toFixed(1)}
        </TableCell>
        <TableCell align="right">
          {row.mistakeCount === 0
            ? <Chip label="✓ Optimal" size="small" color="success" variant="outlined" />
            : <Chip label={String(row.mistakeCount)} size="small" color="error" variant="outlined" />}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell sx={{ py: 0, border: 0 }} colSpan={4}>
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box sx={{ py: 2 }}><LineupTable decision={row.decision} /></Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

/* ── Weekly breakdown (Level 1) ── */
type SortField = 'week' | 'netSkill';
type SortDir = 'asc' | 'desc';

function WeeklyBreakdown({ rows }: { rows: WeekRow[] }) {
  const [sortField, setSortField] = React.useState<SortField>('week');
  const [sortDir, setSortDir] = React.useState<SortDir>('asc');
  const [expandedWeek, setExpandedWeek] = React.useState<number | null>(null);
  const [expandedLg, setExpandedLg] = React.useState<string | null>(null);

  const sorted = React.useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortField === 'week' ? a.week : a.netSkill;
      const bv = sortField === 'week' ? b.week : b.netSkill;
      return (av - bv) * dir;
    });
  }, [rows, sortField, sortDir]);

  const handleSort = (f: SortField) => {
    setSortDir(sortField === f && sortDir === 'asc' ? 'desc' : 'asc');
    setSortField(f);
  };

  return (
    <Paper sx={{ mb: 3 }}>
      <Typography variant="h6" sx={{ p: 2, pb: 1 }}>Weekly Breakdown</Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={40} />
              <TableCell>
                <TableSortLabel active={sortField === 'week'} direction={sortField === 'week' ? sortDir : 'asc'}
                  onClick={() => handleSort('week')}>Week</TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={sortField === 'netSkill'} direction={sortField === 'netSkill' ? sortDir : 'asc'}
                  onClick={() => handleSort('netSkill')}>Net Skill +/−</TableSortLabel>
              </TableCell>
              <TableCell align="right">Leagues</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map(row => {
              const open = expandedWeek === row.week;
              return (
                <React.Fragment key={row.week}>
                  <TableRow hover sx={{ cursor: 'pointer', '& > *': { borderBottom: open ? 'unset' : undefined } }}
                    onClick={() => { setExpandedWeek(open ? null : row.week); setExpandedLg(null); }}>
                    <TableCell><IconButton size="small">{open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}</IconButton></TableCell>
                    <TableCell>Week {row.week}</TableCell>
                    <TableCell align="right" sx={{ color: skillColor(row.netSkill), fontWeight: 600 }}>
                      {row.netSkill >= 0 ? '+' : ''}{row.netSkill.toFixed(1)}
                    </TableCell>
                    <TableCell align="right">{row.leagues.length}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ py: 0, border: 0 }} colSpan={4}>
                      <Collapse in={open} timeout="auto" unmountOnExit>
                        <Box sx={{ py: 1 }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell width={40} />
                                <TableCell>League</TableCell>
                                <TableCell align="right">Skill +/−</TableCell>
                                <TableCell align="right">Mistakes</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {row.leagues.map(lg => {
                                const lgKey = `${row.week}-${lg.leagueId}`;
                                return (
                                  <LeagueRow key={lgKey} row={lg}
                                    expanded={expandedLg === lgKey}
                                    onToggle={() => setExpandedLg(expandedLg === lgKey ? null : lgKey)} />
                                );
                              })}
                            </TableBody>
                          </Table>
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

/* ── Position accuracy chart ── */
function PositionAccuracyChart({ data }: { data: PositionAccuracy[] }) {
  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>Decision Accuracy by Position</Typography>
      <Box sx={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} unit="%" stroke="#888" />
            <YAxis dataKey="position" type="category" stroke="#aaa" width={80} />
            <RechartsTooltip
              contentStyle={{ backgroundColor: 'rgba(20,20,20,0.95)', border: '1px solid #444' }}
              formatter={(v: number | undefined) => [`${(v ?? 0).toFixed(1)}%`, 'Accuracy']}
            />
            <Bar dataKey="accuracy" name="Accuracy">
              {data.map((e, i) => (
                <Cell key={i} fill={e.accuracy >= HIGH_ACC ? '#66bb6a' : e.accuracy >= MID_ACC ? '#ffa726' : '#ef5350'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
}

/* ── Mistake list section ── */
function MistakesList({ title, mistakes }: { title: string; mistakes: LineupMistake[] }) {
  if (mistakes.length === 0) return null;
  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>{title}</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Slot</TableCell>
            <TableCell>Started</TableCell>
            <TableCell>Should Have Started</TableCell>
            <TableCell align="right">Skill +/−</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {mistakes.map((m, i) => (
            <TableRow key={i}>
              <TableCell>
                <Chip label={m.slot} size="small"
                  sx={{ bgcolor: getPositionColor(m.slot), color: '#fff', fontWeight: 700 }} />
              </TableCell>
              <TableCell sx={{ color: (m.actualDiff ?? 0) < 0 ? 'error.main' : 'success.main' }}>
                {m.started.playerName} ({fmtPts(m.started.actualPoints)})
              </TableCell>
              <TableCell sx={{ color: (m.actualDiff ?? 0) < 0 ? 'success.main' : 'error.main' }}>
                {m.shouldHaveStarted.playerName} ({fmtPts(m.shouldHaveStarted.actualPoints)})
              </TableCell>
              <TableCell align="right" sx={{ color: m.actualDiff != null ? skillColor(m.actualDiff) : 'text.secondary', fontWeight: 700 }}>
                {m.actualDiff != null ? `${m.actualDiff >= 0 ? '+' : ''}${m.actualDiff.toFixed(1)}` : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}

/* ── Main component ── */
export default function StartSitContent() {
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');
  // Start/sit accuracy needs played weeks to score decisions against, so seed to
  // the last season that produced games.
  const { season: year, setSeason: setYear } = useSeason('results');
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [summaries, setSummaries] = React.useState<SeasonDecisionSummary[]>([]);
  const prevTrigger = React.useRef('');

  React.useEffect(() => { if (user) setUsername(user.username); }, [user]);

  React.useEffect(() => {
    const key = `${username}|${year}`;
    if (username && key !== prevTrigger.current) {
      prevTrigger.current = key;
      const t = setTimeout(() => handleAnalyze(), 500);
      return () => clearTimeout(t);
    }
  }, [username, year]);

  const handleAnalyze = async () => {
    if (!username) return;
    setLoading(true);
    setSummaries([]);
    setProgress({ done: 0, total: 0 });
    try {
      let currentUser = user;
      if (!currentUser || currentUser.username.toLowerCase() !== username.toLowerCase()) {
        currentUser = await SleeperService.getUser(username);
        if (!currentUser) throw new Error('User not found');
        fetchUser(username);
      }
      const leagues = await SleeperService.getLeagues(currentUser.user_id, year);
      const valid = leagues.filter(l => !SleeperService.shouldIgnoreLeague(l));
      setProgress({ done: 0, total: valid.length });
      const results = await analyzeMultiLeagueSeason(valid, currentUser.user_id, year,
        (d, t) => setProgress({ done: d, total: t }));
      setSummaries(results);
    } catch (e) {
      console.error('Start/Sit analysis failed', e);
    } finally {
      setLoading(false);
    }
  };

  // All metrics use ACTUAL outcomes
  const allMistakes = summaries.flatMap(s => s.worstMistakes);

  // Skill Efficiency % averaged across leagues (don't sum raw points across different scoring)
  const avgSkillEfficiency = summaries.length > 0
    ? summaries.reduce((s, sm) => s + sm.skillEfficiency, 0) / summaries.length : 100;

  const totalWeeksAnalyzed = summaries.reduce((s, sm) => s + sm.weeklyDecisions.length, 0);
  const totalDecisionsAnalyzed = summaries.reduce(
    (s, sm) => s + sm.weeklyDecisions.reduce((ws, w) => ws + w.optimal.actualLineup.length, 0), 0,
  );

  // Net Skill +/- per week averaged across leagues
  const avgNetSkillPerWeek = summaries.length > 0
    ? summaries.reduce((s, sm) => s + sm.netSkillPerWeek, 0) / summaries.length : 0;

  const timesBeat = allMistakes.filter(m => m.actualDiff != null && m.actualDiff > 0).length;
  const netSkill = allMistakes.reduce((s, m) => s + (m.actualDiff ?? 0), 0);
  const posAccuracy = mergePositionAccuracy(summaries);
  const worstPosition = posAccuracy.length > 0 ? posAccuracy[0].position : '—';
  const weekRows = buildWeekRows(summaries);

  // Top 5 worst (most negative actualDiff) = should have trusted Sleeper
  const worst = [...allMistakes]
    .filter(m => m.actualDiff != null && m.actualDiff < 0)
    .sort((a, b) => (a.actualDiff ?? 0) - (b.actualDiff ?? 0))
    .slice(0, TOP_N);

  // Top 5 genius calls (most positive actualDiff) = user beat projections
  const genius = [...allMistakes]
    .filter(m => m.actualDiff != null && m.actualDiff > 0)
    .sort((a, b) => (b.actualDiff ?? 0) - (a.actualDiff ?? 0))
    .slice(0, TOP_N);

  return (
    <Box>
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <UserSearchInput username={username} setUsername={setUsername} disabled={loading} />
          <YearSelector userId={user?.user_id} selectedYear={year} onChange={setYear} disabled={loading} />
        </Box>
      </Paper>

      {loading && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Analyzing league {progress.done} of {progress.total}…
          </Typography>
          <LinearProgress
            variant={progress.total > 0 ? 'determinate' : 'indeterminate'}
            value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
          />
        </Box>
      )}

      {summaries.length === 0 && !loading && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 8 }}>
          Enter a username to analyze start/sit decisions.
        </Typography>
      )}

      {summaries.length > 0 && (
        <>
          {/* Summary cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Tooltip
                  arrow
                  title={
                    <Box sx={{ fontSize: '0.8rem', lineHeight: 1.6 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                        {avgSkillEfficiency.toFixed(4)}%
                      </Typography>
                      <div>Average across {summaries.length} league{summaries.length !== 1 ? 's' : ''}</div>
                      {summaries.map(s => (
                        <div key={s.leagueId}>
                          {s.leagueName}: {s.skillEfficiency.toFixed(2)}% ({s.totalActualStarted.toFixed(1)} / {s.totalActualOptimal.toFixed(1)})
                        </div>
                      ))}
                      <div style={{ marginTop: 4 }}>
                        {totalWeeksAnalyzed} weeks · {totalDecisionsAnalyzed} decisions
                      </div>
                    </Box>
                  }
                >
                  <Typography variant="h4" color={avgSkillEfficiency >= 100 ? 'success.main' : 'error.main'} sx={{ cursor: 'help' }}>
                    {avgSkillEfficiency.toFixed(2)}%
                  </Typography>
                </Tooltip>
                <Typography variant="body2" color="text.secondary">Skill Efficiency</Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h4" color="success.main">{timesBeat}</Typography>
                <Typography variant="body2" color="text.secondary">Times Beat Projections</Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h4" color={avgNetSkillPerWeek >= 0 ? 'success.main' : 'error.main'}>
                  {avgNetSkillPerWeek >= 0 ? '+' : ''}{avgNetSkillPerWeek.toFixed(2)}
                </Typography>
                <Typography variant="body2" color="text.secondary">Net Skill +/− per Wk</Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h4" color="warning.main">{worstPosition}</Typography>
                <Typography variant="body2" color="text.secondary">Worst Position</Typography>
              </Paper>
            </Grid>
          </Grid>

          <WeeklyBreakdown rows={weekRows} />

          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <PositionAccuracyChart data={posAccuracy} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <MistakesList title="Should Have Trusted Sleeper 😬" mistakes={worst} />
            </Grid>
          </Grid>

          <MistakesList title="Genius Calls 🧠" mistakes={genius} />
        </>
      )}
    </Box>
  );
}
