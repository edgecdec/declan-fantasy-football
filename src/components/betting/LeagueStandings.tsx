'use client';

import * as React from 'react';
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  TableContainer, Chip, Tooltip, Stack, LinearProgress, Alert,
} from '@mui/material';
import { formatCents } from '@/lib/betting/constants';

/**
 * League-wide standings: who is up, who is down, and what is still live.
 *
 * The job here is magnitude ranked by identity across ten rows, which is a table's
 * work, not a chart's — the reader wants exact figures and to find their own name.
 * The only mark is a one-hue bar behind the profit column, sized by magnitude
 * relative to the biggest swing, so the shape of the league reads at a glance
 * without a second axis or a second chart.
 */

type Standing = {
  accountId: string;
  displayName: string;
  isMe: boolean;
  claimed: boolean;
  balanceCents: number;
  openStakeCents: number;
  openCount: number;
  settledCount: number;
  won: number;
  lost: number;
  voided: number;
  totalStakedCents: number;
  settledStakedCents: number;
  bettingNetCents: number;
  roi: number | null;
};

type OpenPosition = {
  bettor: string;
  side: string;
  stake_cents: number;
  price: number;
  to_win_cents: number;
  matchup_id: number;
  week: number;
};

type Payload = {
  ok: boolean;
  league: { label: string; season: string };
  startBalanceCents: number;
  standings: Standing[];
  openPositions: OpenPosition[];
};

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

function signedCents(cents: number): string {
  return `${cents > 0 ? '+' : ''}${formatCents(cents)}`;
}

/**
 * Profit magnitude as a bar growing from a centre baseline: right for a gain, left
 * for a loss. Status hues (good/critical) rather than categorical, because the
 * encoded thing is polarity, and both always ship with the signed number beside
 * them so nothing rests on colour.
 */
function ProfitBar({ cents, maxAbs }: { cents: number; maxAbs: number }) {
  const share = maxAbs > 0 ? Math.min(1, Math.abs(cents) / maxAbs) : 0;
  const up = cents > 0;
  return (
    <Box sx={{ position: 'relative', height: 8, minWidth: 60 }}>
      <Box sx={{ position: 'absolute', left: '50%', top: -1, bottom: -1, width: '1px', bgcolor: 'divider' }} />
      {cents !== 0 && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            height: 8,
            width: `${(share * 100) / 2}%`,
            ...(up
              ? { left: '50%', bgcolor: 'success.main', borderRadius: '0 4px 4px 0' }
              : { right: '50%', bgcolor: 'error.main', borderRadius: '4px 0 0 4px' }),
          }}
        />
      )}
    </Box>
  );
}

export default function LeagueStandings({ leagueId }: { leagueId: string }) {
  const [data, setData] = React.useState<Payload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/betting/leaderboard?leagueId=${encodeURIComponent(leagueId)}`, {
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'Could not load standings.'); return; }
      setData(body);
      setError(null);
    } catch {
      setError('Could not load standings.');
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  React.useEffect(() => { load(); }, [load]);

  if (loading) return <LinearProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return null;

  const maxAbs = Math.max(1, ...data.standings.map(s => Math.abs(s.bettingNetCents)));
  const anyBets = data.standings.some(s => s.totalStakedCents > 0);

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2, mb: 1.5 }}>
        <Typography variant="h6" gutterBottom>League standings</Typography>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
          Everyone started at {formatCents(data.startBalanceCents)}. Profit counts
          settled wagers only — an open stake shows under &quot;at risk&quot;, not as a
          loss — and excludes any manual adjustment, so it can&apos;t look like skill.
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Manager</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell align="right">Profit</TableCell>
                <TableCell sx={{ width: 90 }} />
                <TableCell align="right">
                  <Tooltip title="Return on stake that has settled"><span>ROI</span></Tooltip>
                </TableCell>
                <TableCell align="center">W-L-V</TableCell>
                <TableCell align="right">
                  <Tooltip title="Stake on wagers that haven't settled"><span>At risk</span></Tooltip>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.standings.map(s => (
                <TableRow key={s.accountId} sx={s.isMe ? { bgcolor: 'action.hover' } : undefined}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography variant="body2" fontWeight={s.isMe ? 700 : 400}>
                        {s.displayName}
                      </Typography>
                      {s.isMe && <Chip label="you" size="small" color="primary" sx={{ height: 16, fontSize: 10 }} />}
                      {!s.claimed && (
                        <Tooltip title="Hasn't used their setup link yet">
                          <Chip label="not set up" size="small" variant="outlined" sx={{ height: 16, fontSize: 10 }} />
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, color: s.balanceCents < 0 ? 'error.main' : 'text.primary' }}>
                    {formatCents(s.balanceCents)}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      color: s.bettingNetCents > 0 ? 'success.main'
                        : s.bettingNetCents < 0 ? 'error.main' : 'text.secondary',
                      fontWeight: 600,
                    }}
                  >
                    {s.settledStakedCents > 0 ? signedCents(s.bettingNetCents) : '—'}
                  </TableCell>
                  <TableCell sx={{ py: 0 }}>
                    {s.settledStakedCents > 0 && <ProfitBar cents={s.bettingNetCents} maxAbs={maxAbs} />}
                  </TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>
                    {s.roi === null ? '—' : `${(s.roi * 100).toFixed(0)}%`}
                  </TableCell>
                  <TableCell align="center" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {s.settledCount === 0 ? '—' : `${s.won}-${s.lost}${s.voided ? `-${s.voided}` : ''}`}
                  </TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>
                    {s.openStakeCents > 0 ? `${formatCents(s.openStakeCents)} (${s.openCount})` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {!anyBets && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Nobody has placed a bet yet.
          </Typography>
        )}
      </Paper>

      {data.openPositions.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Live around the league</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Bettor</TableCell>
                  <TableCell align="center">Wk</TableCell>
                  <TableCell align="center">Matchup</TableCell>
                  <TableCell align="right">Stake</TableCell>
                  <TableCell align="right">Price</TableCell>
                  <TableCell align="right">To win</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.openPositions.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell>{p.bettor}</TableCell>
                    <TableCell align="center" sx={{ color: 'text.secondary' }}>{p.week}</TableCell>
                    <TableCell align="center" sx={{ color: 'text.secondary' }}>
                      {p.matchup_id} · {p.side.toUpperCase()}
                    </TableCell>
                    <TableCell align="right">{formatCents(p.stake_cents)}</TableCell>
                    <TableCell align="right" sx={{ color: 'text.secondary' }}>{formatOdds(p.price)}</TableCell>
                    <TableCell align="right" sx={{ color: 'success.main' }}>{formatCents(p.to_win_cents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
