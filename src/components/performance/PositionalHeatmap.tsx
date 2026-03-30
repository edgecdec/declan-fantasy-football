'use client';

import * as React from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  useTheme
} from '@mui/material';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

type HeatmapProps = {
  chartData: Array<{ year: string; [key: string]: string | number }>;
  metric: 'total' | 'efficiency';
  onMetricChange: (m: 'total' | 'efficiency') => void;
};

function getCellColor(diff: number, maxAbs: number): string {
  if (maxAbs === 0) return 'transparent';
  const intensity = Math.min(Math.abs(diff) / maxAbs, 1);
  const alpha = 0.15 + intensity * 0.55;
  return diff > 0
    ? `rgba(102, 187, 106, ${alpha})`
    : diff < 0
      ? `rgba(239, 83, 80, ${alpha})`
      : 'transparent';
}

export default function PositionalHeatmap({ chartData, metric, onMetricChange }: HeatmapProps) {
  const theme = useTheme();

  const { rows, maxAbs } = React.useMemo(() => {
    let max = 0;
    const r = chartData.map(d => {
      const diffs: Record<string, number> = {};
      POSITIONS.forEach(p => {
        const userVal = (d[`${p}_User_${metric}`] as number) || 0;
        const avgVal = (d[`${p}_Avg_${metric}`] as number) || 0;
        const diff = userVal - avgVal;
        diffs[p] = diff;
        if (Math.abs(diff) > max) max = Math.abs(diff);
      });
      return { year: d.year as string, diffs };
    });
    return { rows: r, maxAbs: max };
  }, [chartData, metric]);

  if (chartData.length === 0) return null;

  const unit = metric === 'total' ? 'pts/wk' : 'pts/start';

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Positional Edge vs League Average</Typography>
        <ToggleButtonGroup value={metric} exclusive onChange={(_, v) => v && onMetricChange(v)} size="small">
          <ToggleButton value="total">Output</ToggleButton>
          <ToggleButton value="efficiency">Efficiency</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Difference between your average and league average ({unit}). Green = above average, red = below.
      </Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold' }}>Year</TableCell>
              {POSITIONS.map(p => (
                <TableCell key={p} align="center" sx={{ fontWeight: 'bold' }}>{p}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(row => (
              <TableRow key={row.year}>
                <TableCell sx={{ fontWeight: 'bold' }}>{row.year}</TableCell>
                {POSITIONS.map(p => {
                  const diff = row.diffs[p];
                  return (
                    <TableCell
                      key={p}
                      align="center"
                      sx={{
                        bgcolor: getCellColor(diff, maxAbs),
                        fontWeight: 'bold',
                        color: diff > 0 ? 'success.main' : diff < 0 ? 'error.main' : 'text.secondary',
                        transition: 'background-color 0.3s'
                      }}
                    >
                      {diff !== 0 ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}` : '—'}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
