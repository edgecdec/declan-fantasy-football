'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  Container,
  Box,
  Paper,
  Typography,
  LinearProgress,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Button,
  Tooltip,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TradedPlayersSummary from '@/components/analytics/TradedPlayersSummary';
import SortIcon from '@mui/icons-material/Sort';
import Link from 'next/link';
import PageHeader from '@/components/common/PageHeader';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { evaluateTradeEfficiency } from '@/services/stats/tradeEfficiency';
import { TradeEfficiencyResult, TradeEfficiencySide } from '@/types/trade';
import { getPositionColor } from '@/constants/colors';
import useTableSort from '@/hooks/useTableSort';

function EfficiencyValue({ value }: { value: number }) {
  const color = value > 0 ? 'success.main' : value < 0 ? 'error.main' : 'text.secondary';
  return (
    <Typography component="span" sx={{ color, fontWeight: 'bold' }}>
      {value > 0 ? '+' : ''}{value.toFixed(1)}
    </Typography>
  );
}

function TradeSideTable({ side }: { side: TradeEfficiencySide }) {
  const { sorted, order, orderBy, handleSort } = useTableSort(side.players, 'totalSeasonEfficiency');
  const hasAssets = side.players.length > 0 || (side.draftPicks ?? []).length > 0 || (side.faabItems ?? []).length > 0;
  return (
    <Box sx={{ flex: 1, minWidth: 250 }}>
      <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
        {side.username} received:
      </Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>
                <TableSortLabel active={orderBy === 'name'} direction={orderBy === 'name' ? order : 'asc'} onClick={() => handleSort('name')}>Player</TableSortLabel>
              </TableCell>
              <TableCell align="center">Pos</TableCell>
              <TableCell align="right">
                <TableSortLabel active={orderBy === 'weeksStarted'} direction={orderBy === 'weeksStarted' ? order : 'asc'} onClick={() => handleSort('weeksStarted')}>Wks</TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <Tooltip title="Efficiency only on the receiving team" arrow>
                  <TableSortLabel active={orderBy === 'totalEfficiency'} direction={orderBy === 'totalEfficiency' ? order : 'asc'} onClick={() => handleSort('totalEfficiency')}>Team Eff</TableSortLabel>
                </Tooltip>
              </TableCell>
              <TableCell align="right">
                <Tooltip title="Efficiency across all teams post-trade" arrow>
                  <TableSortLabel active={orderBy === 'totalSeasonEfficiency'} direction={orderBy === 'totalSeasonEfficiency' ? order : 'asc'} onClick={() => handleSort('totalSeasonEfficiency')}>Total Eff</TableSortLabel>
                </Tooltip>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel active={orderBy === 'avgEfficiency'} direction={orderBy === 'avgEfficiency' ? order : 'asc'} onClick={() => handleSort('avgEfficiency')}>Avg/Wk</TableSortLabel>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((p) => (
              <TableRow key={p.playerId}>
                <TableCell>
                  {p.name}
                  {p.departureWeek != null && (
                    <Tooltip title={`Left roster in Week ${p.departureWeek}`} arrow>
                      <Typography component="span" sx={{ color: 'warning.main', cursor: 'help', ml: 0.5 }}>*</Typography>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell align="center">
                  <Chip label={p.position} size="small" sx={{ bgcolor: getPositionColor(p.position), color: '#fff', fontWeight: 'bold', height: 20, fontSize: '0.7rem' }} />
                </TableCell>
                <TableCell align="right">{p.weeksStarted}</TableCell>
                <TableCell align="right"><EfficiencyValue value={p.totalEfficiency} /></TableCell>
                <TableCell align="right"><EfficiencyValue value={p.totalSeasonEfficiency} /></TableCell>
                <TableCell align="right"><EfficiencyValue value={p.avgEfficiency} /></TableCell>
              </TableRow>
            ))}
            {(side.draftPicks ?? []).map((dp, i) => {
              const eff = dp.efficiency;
              return (
              <TableRow key={`pick-${i}`}>
                <TableCell>
                  {dp.season} Rd {dp.round}
                  {dp.resolvedPick && (
                    <Typography component="span" variant="body2" color="text.secondary"> → {dp.resolvedPlayer}</Typography>
                  )}
                  {eff?.departureWeek != null && (
                    <Tooltip title={`Left roster in Week ${eff.departureWeek}`} arrow>
                      <Typography component="span" sx={{ color: 'warning.main', cursor: 'help', ml: 0.5 }}>*</Typography>
                    </Tooltip>
                  )}
                  {dp.retradedWeek != null && (
                    <Tooltip title={`Pick traded again in Week ${dp.retradedWeek}`} arrow>
                      <Typography component="span" variant="caption" sx={{ color: 'info.main', cursor: 'help', ml: 0.5 }}>(traded again)</Typography>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell align="center">
                  <Chip label={eff?.position || 'PICK'} size="small" sx={{ bgcolor: eff ? getPositionColor(eff.position) : 'action.selected', color: eff ? '#fff' : undefined, fontWeight: 'bold', height: 20, fontSize: '0.7rem' }} />
                </TableCell>
                {eff ? (
                  <>
                    <TableCell align="right">{eff.weeksStarted}</TableCell>
                    <TableCell align="right"><EfficiencyValue value={eff.totalEfficiency} /></TableCell>
                    <TableCell align="right"><EfficiencyValue value={eff.totalSeasonEfficiency} /></TableCell>
                    <TableCell align="right"><EfficiencyValue value={eff.avgEfficiency} /></TableCell>
                  </>
                ) : (
                  <>
                    <TableCell align="right"><Typography variant="body2" color="text.secondary">N/A</Typography></TableCell>
                    <TableCell align="right"><Typography variant="body2" color="text.secondary">N/A</Typography></TableCell>
                    <TableCell align="right"><Typography variant="body2" color="text.secondary">N/A</Typography></TableCell>
                    <TableCell align="right"><Typography variant="body2" color="text.secondary">N/A</Typography></TableCell>
                  </>
                )}
              </TableRow>
              );
            })}
            {(side.faabItems ?? []).map((fb, i) => (
              <TableRow key={`faab-${i}`}>
                <TableCell>${fb.amount} FAAB</TableCell>
                <TableCell align="center">
                  <Chip label="FAAB" size="small" sx={{ bgcolor: 'action.selected', fontWeight: 'bold', height: 20, fontSize: '0.7rem' }} />
                </TableCell>
                <TableCell align="right"><Typography variant="body2" color="text.secondary">N/A</Typography></TableCell>
                <TableCell align="right"><Typography variant="body2" color="text.secondary">N/A</Typography></TableCell>
                <TableCell align="right"><Typography variant="body2" color="text.secondary">N/A</Typography></TableCell>
                <TableCell align="right"><Typography variant="body2" color="text.secondary">N/A</Typography></TableCell>
              </TableRow>
            ))}
            {!hasAssets && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ color: 'text.secondary' }}>No trade assets</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Box sx={{ mt: 1, textAlign: 'right' }}>
        <Typography variant="body2">
          Side Total: <EfficiencyValue value={side.totalEfficiency} />
        </Typography>
      </Box>
    </Box>
  );
}

function TradeVerdict({ trade }: { trade: TradeEfficiencyResult }) {
  const [a, b] = trade.sides;
  const diff = a.totalEfficiency - b.totalEfficiency;
  const winner = Math.abs(diff) < 1 ? null : diff > 0 ? a.username : b.username;

  return (
    <Box sx={{ textAlign: 'center', mt: 1 }}>
      {winner ? (
        <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 'bold' }}>
          🏆 {winner} won this trade by <EfficiencyValue value={Math.abs(diff)} /> pts
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary">Even trade</Typography>
      )}
    </Box>
  );
}

function TradeCard({ trade }: { trade: TradeEfficiencyResult }) {
  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" fontWeight="bold">Week {trade.week}</Typography>
        <Typography variant="caption" color="text.secondary">
          {new Date(trade.timestamp).toLocaleDateString()}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <TradeSideTable side={trade.sides[0]} />
        <TradeSideTable side={trade.sides[1]} />
      </Box>
      <TradeVerdict trade={trade} />
    </Paper>
  );
}

export default function TradeEvaluatorPage() {
  const params = useParams();
  const leagueId = params.leagueId as string;

  const [loading, setLoading] = React.useState(true);
  const [leagueName, setLeagueName] = React.useState('');
  const [season, setSeason] = React.useState('');
  const [trades, setTrades] = React.useState<TradeEfficiencyResult[]>([]);
  const [error, setError] = React.useState('');
  const [sortMode, setSortMode] = React.useState<'impact' | 'chronological'>('impact');

  const sortedTrades = React.useMemo(() => {
    const copy = [...trades];
    if (sortMode === 'impact') {
      copy.sort((a, b) => {
        const impactA = Math.abs(a.sides[0].totalEfficiency - a.sides[1].totalEfficiency);
        const impactB = Math.abs(b.sides[0].totalEfficiency - b.sides[1].totalEfficiency);
        return impactB - impactA;
      });
    } else {
      copy.sort((a, b) => b.week - a.week);
    }
    return copy;
  }, [trades, sortMode]);

  React.useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;

    (async () => {
      try {
        const league = await SleeperService.getLeague(leagueId);
        const leagueSeason = league?.season || '';
        const result = await evaluateTradeEfficiency(leagueId, leagueSeason);
        if (cancelled) return;
        setLeagueName(result.leagueName);
        setSeason(result.season);
        setTrades(result.trades);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [leagueId]);

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <PageHeader
        title="Trade Evaluator"
        subtitle={leagueName ? `${leagueName} — ${season}` : 'Loading...'}
        action={
          <Button component={Link} href="/league-history" startIcon={<ArrowBackIcon />} variant="outlined">
            Back to League History
          </Button>
        }
      />

      {loading && (
        <Paper sx={{ p: 3, mb: 2 }}>
          <Typography align="center" gutterBottom>Evaluating trades...</Typography>
          <LinearProgress />
        </Paper>
      )}

      {error && (
        <Paper sx={{ p: 3, mb: 2 }}>
          <Typography color="error">{error}</Typography>
        </Paper>
      )}

      {!loading && trades.length === 0 && !error && (
        <Paper sx={{ p: 3 }}>
          <Typography align="center" color="text.secondary">No trades found in this league.</Typography>
        </Paper>
      )}

      {!loading && trades.length > 0 && (
        <>
          <TradedPlayersSummary trades={trades} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <ToggleButtonGroup
              value={sortMode}
              exclusive
              onChange={(_, v) => { if (v) setSortMode(v); }}
              size="small"
            >
              <ToggleButton value="impact">
                <TrendingUpIcon sx={{ mr: 0.5, fontSize: 18 }} /> Most Impactful
              </ToggleButton>
              <ToggleButton value="chronological">
                <SortIcon sx={{ mr: 0.5, fontSize: 18 }} /> Chronological
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </>
      )}

      {sortedTrades.map((trade) => (
        <TradeCard key={trade.transactionId} trade={trade} />
      ))}
    </Container>
  );
}
