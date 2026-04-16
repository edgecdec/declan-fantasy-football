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
import { LineupMistake, PositionAccuracy } from '@/types/lineup';
import { getPositionColor } from '@/constants/colors';
import { AggWeek, SortField, SortDir } from '@/types/startSit';

const HIGH_ACCURACY = 90;
const MID_ACCURACY = 70;

const COLUMNS: { field: SortField; label: string }[] = [
  { field: 'week', label: 'Week' },
  { field: 'projected', label: 'Your Proj' },
  { field: 'optimal', label: 'Optimal Proj' },
  { field: 'pointsLeft', label: 'Pts Left on Bench' },
  { field: 'mistakes', label: 'Mistakes' },
];

function MistakeRow({ m }: { m: LineupMistake }) {
  return (
    <TableRow>
      <TableCell><Chip label={m.slot} size="small" sx={{ bgcolor: getPositionColor(m.slot), color: '#fff', fontWeight: 700 }} /></TableCell>
      <TableCell sx={{ color: 'error.main' }}>{m.started.playerName} ({m.started.projectedPoints.toFixed(1)})</TableCell>
      <TableCell sx={{ color: 'success.main' }}>{m.shouldHaveStarted.playerName} ({m.shouldHaveStarted.projectedPoints.toFixed(1)})</TableCell>
      <TableCell align="right" sx={{ color: 'error.main', fontWeight: 700 }}>−{m.pointsDiff.toFixed(1)}</TableCell>
    </TableRow>
  );
}

/** Expanded detail for a single week showing all lineup mistakes */
export function WeekDetailRow({ row }: { row: AggWeek }) {
  const mistakes = row.decisions.flatMap(d => d.optimal.mistakes).sort((a, b) => b.pointsDiff - a.pointsDiff);
  if (mistakes.length === 0) {
    return <Typography variant="body2" color="success.main" sx={{ py: 1 }}>✓ Optimal lineup set for all leagues this week.</Typography>;
  }
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Slot</TableCell>
          <TableCell>You Started</TableCell>
          <TableCell>Should Have Started</TableCell>
          <TableCell align="right">Proj Diff</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>{mistakes.map((m, i) => <MistakeRow key={i} m={m} />)}</TableBody>
    </Table>
  );
}

/** Sortable weekly breakdown table with collapsible detail rows */
export function WeeklyBreakdown({ rows, sortField, sortDir, expandedWeek, onSort, onToggle }: {
  rows: AggWeek[]; sortField: SortField; sortDir: SortDir; expandedWeek: number | null;
  onSort: (f: SortField) => void; onToggle: (w: number) => void;
}) {
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
                  <TableSortLabel active={sortField === c.field} direction={sortField === c.field ? sortDir : 'asc'} onClick={() => onSort(c.field)}>{c.label}</TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(row => {
              const open = expandedWeek === row.week;
              return (
                <React.Fragment key={row.week}>
                  <TableRow hover sx={{ cursor: 'pointer', '& > *': { borderBottom: open ? 'unset' : undefined } }} onClick={() => onToggle(row.week)}>
                    <TableCell><IconButton size="small">{open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}</IconButton></TableCell>
                    <TableCell>Week {row.week}</TableCell>
                    <TableCell align="right">{row.projected.toFixed(1)}</TableCell>
                    <TableCell align="right">{row.optimal.toFixed(1)}</TableCell>
                    <TableCell align="right" sx={{ color: row.pointsLeft > 0 ? 'error.main' : 'success.main', fontWeight: 600 }}>
                      {row.pointsLeft > 0 ? `−${row.pointsLeft.toFixed(1)}` : '0.0'}
                    </TableCell>
                    <TableCell align="right">
                      {row.mistakeCount === 0 ? <Chip label="✓ Optimal" size="small" color="success" variant="outlined" /> : <Chip label={String(row.mistakeCount)} size="small" color="error" variant="outlined" />}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ py: 0, border: 0 }} colSpan={6}>
                      <Collapse in={open} timeout="auto" unmountOnExit>
                        <Box sx={{ py: 2 }}><WeekDetailRow row={row} /></Box>
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
          </TableRow>
        </TableHead>
        <TableBody>{mistakes.map((m, i) => <MistakeRow key={i} m={m} />)}</TableBody>
      </Table>
    </Paper>
  );
}
