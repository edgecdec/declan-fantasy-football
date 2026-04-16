'use client';

import * as React from 'react';
import {
  Box, Paper, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  Chip, Collapse, IconButton,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { LineupMistake, PositionAccuracy, LineupSlot } from '@/types/lineup';
import { getPositionColor } from '@/constants/colors';
import { AggWeek, LeagueWeekDetail, SortField, SortDir } from '@/types/startSit';

const HIGH_ACCURACY = 90;
const MID_ACCURACY = 70;

const COLUMNS: { field: SortField; label: string }[] = [
  { field: 'week', label: 'Week' },
  { field: 'pointsLeft', label: 'Proj Pts Left on Bench' },
  { field: 'mistakes', label: 'Leagues' },
];

function formatPts(v: number | undefined): string {
  return v != null ? v.toFixed(1) : '—';
}

function diffColor(v: number | undefined): string {
  if (v == null) return 'text.secondary';
  return v > 0 ? 'success.main' : v < 0 ? 'error.main' : 'text.secondary';
}

/** Side-by-side actual vs optimal for one league+week */
function LineupComparison({ actual, optimal, mistakes }: {
  actual: LineupSlot[]; optimal: LineupSlot[]; mistakes: LineupMistake[];
}) {
  const mistakeSlots = new Set(mistakes.map(m => m.slot + m.started.playerId));
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
          <TableCell align="right">+/−</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {actual.map((a, i) => {
          const o = optimal[i];
          const isMistake = mistakeSlots.has(a.slot + a.playerId);
          const actualDiff = a.actualPoints != null && o?.actualPoints != null
            ? a.actualPoints - o.actualPoints : undefined;
          return (
            <TableRow key={i} sx={isMistake ? { bgcolor: 'action.hover' } : undefined}>
              <TableCell>
                <Chip label={a.slot} size="small" sx={{ bgcolor: getPositionColor(a.position), color: '#fff', fontWeight: 700, minWidth: 50 }} />
              </TableCell>
              <TableCell sx={isMistake ? { color: 'error.main' } : undefined}>{a.playerName}</TableCell>
              <TableCell align="right">{formatPts(a.projectedPoints)}</TableCell>
              <TableCell align="right">{formatPts(a.actualPoints)}</TableCell>
              <TableCell sx={isMistake ? { color: 'success.main' } : undefined}>{o?.playerName || '—'}</TableCell>
              <TableCell align="right">{formatPts(o?.projectedPoints)}</TableCell>
              <TableCell align="right">{formatPts(o?.actualPoints)}</TableCell>
              <TableCell align="right" sx={{ color: diffColor(actualDiff), fontWeight: 600 }}>
                {actualDiff != null ? (actualDiff >= 0 ? '+' : '') + actualDiff.toFixed(1) : '—'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Expandable league row within a week */
function LeagueRow({ detail, expanded, onToggle }: {
  detail: LeagueWeekDetail; expanded: boolean; onToggle: () => void;
}) {
  const { decision } = detail;
  return (
    <>
      <TableRow hover sx={{ cursor: 'pointer', '& > *': { borderBottom: expanded ? 'unset' : undefined } }} onClick={onToggle}>
        <TableCell sx={{ pl: 4 }}>
          <IconButton size="small">{expanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}</IconButton>
        </TableCell>
        <TableCell>{detail.leagueName}</TableCell>
        <TableCell align="right">{detail.projected.toFixed(1)}</TableCell>
        <TableCell align="right">{detail.optimal.toFixed(1)}</TableCell>
        <TableCell align="right" sx={{ color: detail.pointsLeft > 0 ? 'error.main' : 'success.main', fontWeight: 600 }}>
          {detail.pointsLeft > 0 ? `−${detail.pointsLeft.toFixed(1)}` : '0.0'}
        </TableCell>
        <TableCell align="right">
          {detail.mistakeCount === 0
            ? <Chip label="✓ Optimal" size="small" color="success" variant="outlined" />
            : <Chip label={String(detail.mistakeCount)} size="small" color="error" variant="outlined" />}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell sx={{ py: 0, border: 0 }} colSpan={6}>
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box sx={{ py: 2 }}>
              {detail.mistakeCount === 0
                ? <Typography variant="body2" color="success.main">✓ Optimal lineup set.</Typography>
                : <LineupComparison
                    actual={decision.optimal.actualLineup}
                    optimal={decision.optimal.optimalLineup}
                    mistakes={decision.optimal.mistakes}
                  />
              }
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

/** Sortable weekly breakdown with Week → League → Lineup drill-down */
export function WeeklyBreakdown({ rows, sortField, sortDir, onSort }: {
  rows: AggWeek[]; sortField: SortField; sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const [expandedWeek, setExpandedWeek] = React.useState<number | null>(null);
  const [expandedLeague, setExpandedLeague] = React.useState<string | null>(null);

  return (
    <Paper sx={{ mb: 3 }}>
      <Typography variant="h6" sx={{ p: 2, pb: 1 }}>Weekly Breakdown</Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={40} />
              {COLUMNS.map(c => (
                <TableCell key={c.field} align={c.field === 'week' ? 'left' : 'right'} sortDirection={sortField === c.field ? sortDir : false}>
                  <TableSortLabel active={sortField === c.field} direction={sortField === c.field ? sortDir : 'asc'} onClick={() => onSort(c.field)}>
                    {c.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(row => {
              const weekOpen = expandedWeek === row.week;
              return (
                <React.Fragment key={row.week}>
                  <TableRow
                    hover
                    sx={{ cursor: 'pointer', '& > *': { borderBottom: weekOpen ? 'unset' : undefined } }}
                    onClick={() => { setExpandedWeek(weekOpen ? null : row.week); setExpandedLeague(null); }}
                  >
                    <TableCell><IconButton size="small">{weekOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}</IconButton></TableCell>
                    <TableCell>Week {row.week}</TableCell>
                    <TableCell align="right" sx={{ color: row.pointsLeft > 0 ? 'error.main' : 'success.main', fontWeight: 600 }}>
                      {row.pointsLeft > 0 ? `−${row.pointsLeft.toFixed(1)}` : '0.0'}
                    </TableCell>
                    <TableCell align="right">{row.leagues.length}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ py: 0, border: 0 }} colSpan={4}>
                      <Collapse in={weekOpen} timeout="auto" unmountOnExit>
                        <Box sx={{ py: 1 }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell width={40} />
                                <TableCell>League</TableCell>
                                <TableCell align="right">Your Proj</TableCell>
                                <TableCell align="right">Optimal Proj</TableCell>
                                <TableCell align="right">Pts Left</TableCell>
                                <TableCell align="right">Mistakes</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {row.leagues.map(lg => {
                                const lgKey = `${row.week}-${lg.leagueId}`;
                                return (
                                  <LeagueRow
                                    key={lgKey}
                                    detail={lg}
                                    expanded={expandedLeague === lgKey}
                                    onToggle={() => setExpandedLeague(expandedLeague === lgKey ? null : lgKey)}
                                  />
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

/** Bar chart showing decision accuracy by position slot */
export function PositionAccuracyChart({ data }: { data: PositionAccuracy[] }) {
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
              formatter={(value: number | undefined) => [`${(value ?? 0).toFixed(1)}%`, 'Accuracy']}
            />
            <Bar dataKey="accuracy" name="Accuracy">
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.accuracy >= HIGH_ACCURACY ? '#66bb6a' : entry.accuracy >= MID_ACCURACY ? '#ffa726' : '#ef5350'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
}

/** Top 5 worst single-slot mistakes across the season */
export function WorstMistakesList({ mistakes }: { mistakes: LineupMistake[] }) {
  if (mistakes.length === 0) return null;
  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>Top 5 Worst Mistakes</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Slot</TableCell>
            <TableCell>Started</TableCell>
            <TableCell>Should Have Started</TableCell>
            <TableCell align="right">Proj Diff</TableCell>
            <TableCell align="right">Actual +/−</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {mistakes.map((m, i) => (
            <TableRow key={i}>
              <TableCell><Chip label={m.slot} size="small" sx={{ bgcolor: getPositionColor(m.slot), color: '#fff', fontWeight: 700 }} /></TableCell>
              <TableCell sx={{ color: 'error.main' }}>{m.started.playerName} ({formatPts(m.started.projectedPoints)})</TableCell>
              <TableCell sx={{ color: 'success.main' }}>{m.shouldHaveStarted.playerName} ({formatPts(m.shouldHaveStarted.projectedPoints)})</TableCell>
              <TableCell align="right" sx={{ color: 'error.main', fontWeight: 700 }}>−{m.pointsDiff.toFixed(1)}</TableCell>
              <TableCell align="right" sx={{ color: diffColor(m.actualDiff), fontWeight: 600 }}>
                {m.actualDiff != null ? (m.actualDiff >= 0 ? '+' : '') + m.actualDiff.toFixed(1) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
