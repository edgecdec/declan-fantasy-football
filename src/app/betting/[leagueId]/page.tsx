'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  Container, Box, Paper, Typography, Chip, LinearProgress, Alert, Divider,
  Tooltip, Button, Stack, TextField, Dialog, DialogTitle, DialogContent,
  DialogActions, Table, TableBody, TableCell, TableHead, TableRow, TableContainer,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import PageHeader from '@/components/common/PageHeader';
import { MARKET_CLOSE_MINUTES, HOUSE_VIG, profitForStake } from '@/services/betting/liveOdds';
import { formatCents, CENTS_PER_DOLLAR } from '@/lib/betting/constants';
import { useBettingAuth } from '@/context/BettingAuthContext';

/** Live scores move every few minutes; matches the matchup cache TTL. */
const POLL_INTERVAL_MS = 20_000;

type SideDetail = {
  promotions: { name: string; projectedPoints: number }[];
  streams: { slot: string; projectedPoints: number }[];
  unfilledSlots: string[];
  playersRemaining: number;
};

type Market = {
  id: string;
  matchupId: number;
  ownerA: string | null;
  ownerB: string | null;
  probA: number;
  priceA: number;
  priceB: number;
  remainingMinutes: number;
  open: boolean;
  pointsA: number;
  pointsB: number;
  projectedA: number;
  projectedB: number;
  nameA: string;
  nameB: string;
  detailA: SideDetail;
  detailB: SideDetail;
};

type MyWager = {
  id: string;
  market_id: string;
  side: string;
  stake_cents: number;
  price: number;
  to_win_cents: number;
  status: string;
  matchup_id: number;
};

type MarketsPayload = {
  ok: boolean;
  week: number;
  league: { label: string; season: string };
  mySleeperUserId: string;
  balanceCents: number;
  openExposureCents: number;
  negativeExposureCapCents: number;
  markets: Market[];
  myWagers: MyWager[];
};

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

type BetTarget = { market: Market; side: 'a' | 'b' };

function BetDialog({ target, balanceCents, onClose, onPlaced }: {
  target: BetTarget | null;
  balanceCents: number;
  onClose: () => void;
  onPlaced: () => void;
}) {
  const [dollars, setDollars] = React.useState('10');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { setDollars('10'); setError(null); }, [target]);

  if (!target) return null;
  const { market, side } = target;
  const name = side === 'a' ? market.nameA : market.nameB;
  const price = side === 'a' ? market.priceA : market.priceB;
  const stakeCents = Math.round((Number(dollars) || 0) * CENTS_PER_DOLLAR);
  const toWin = stakeCents > 0 ? profitForStake(stakeCents, price) : 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/betting/wager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ marketId: market.id, side, stakeCents }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? 'Could not place that wager.'); return; }
      onPlaced();
      onClose();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Back {name}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Matchup {market.matchupId} at <strong>{formatOdds(price)}</strong>. The price is
          locked in when you place the bet, even if the line moves after.
        </Typography>
        <TextField
          label="Stake (Declan Dollars)"
          value={dollars}
          onChange={e => setDollars(e.target.value.replace(/[^0-9.]/g, ''))}
          size="small"
          fullWidth
          autoFocus
        />
        <Typography variant="body2" sx={{ mt: 2 }}>
          Risking <strong>{formatCents(stakeCents)}</strong> to win{' '}
          <strong>{formatCents(toWin)}</strong>
          {stakeCents > 0 && ` (returns ${formatCents(stakeCents + toWin)})`}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Balance {formatCents(balanceCents)}
        </Typography>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy || stakeCents <= 0}>
          {busy ? 'Placing…' : 'Place Bet'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function SideRow({ name, points, projected, detail, prob, odds, favourite, canBet, onBet }: {
  name: string; points: number; projected: number; detail: SideDetail;
  prob: number; odds: number; favourite: boolean; canBet: boolean; onBet: () => void;
}) {
  const remaining = projected - points;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1 }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body1" fontWeight={favourite ? 'bold' : 'regular'} noWrap>{name}</Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {points.toFixed(1)} pts
          {remaining > 0.05 && ` · ${remaining.toFixed(1)} projected to come · ${detail.playersRemaining} yet to finish`}
        </Typography>
        {detail.streams.map(s => (
          <Tooltip
            key={s.slot}
            title="No rostered player for this slot, so we assume they pick one up before kickoff — averaged across the best available options rather than naming one."
          >
            <Typography variant="caption" color="info.main" component="div">
              assumes a streamed {s.slot} — {s.projectedPoints.toFixed(1)} pts
            </Typography>
          </Tooltip>
        ))}
        {detail.unfilledSlots.length > 0 && (
          <Typography variant="caption" color="error.main" component="div">
            {detail.unfilledSlots.join(', ')} unfilled — scores nothing
          </Typography>
        )}
        {detail.promotions.length > 0 && (
          <Tooltip title="Anyone whose game hasn't kicked off can still be swapped in, so we price the best lineup they could field.">
            <Typography variant="caption" color="warning.main" component="div">
              assumes an optimal lineup ({detail.promotions.length} bench swap
              {detail.promotions.length > 1 ? 's' : ''})
            </Typography>
          </Tooltip>
        )}
      </Box>
      <Box sx={{ textAlign: 'right', minWidth: 130 }}>
        <Typography variant="h6" sx={{ lineHeight: 1.2 }}>{(prob * 100).toFixed(1)}%</Typography>
        {canBet ? (
          <Tooltip title={`Includes the ${(HOUSE_VIG * 100).toFixed(2)}% house edge`}>
            <Button size="small" variant="outlined" onClick={onBet}>{formatOdds(odds)}</Button>
          </Tooltip>
        ) : (
          <Chip label={formatOdds(odds)} size="small" variant="outlined" />
        )}
      </Box>
    </Box>
  );
}

function MarketCard({ market, isMine, myWagers, onBet }: {
  market: Market; isMine: boolean; myWagers: MyWager[]; onBet: (t: BetTarget) => void;
}) {
  const aFav = market.probA >= 1 - market.probA;
  const settled = market.remainingMinutes === 0;
  const canBet = market.open && !isMine;
  const mine = myWagers.filter(w => w.market_id === market.id);

  return (
    <Paper sx={{ p: 2.5, mb: 2, ...(isMine ? { borderLeft: 3, borderColor: 'text.disabled' } : {}) }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" color="text.secondary">Matchup {market.matchupId}</Typography>
        <Stack direction="row" spacing={1}>
          {isMine && (
            <Tooltip title="You're playing in this matchup. Betting on it is blocked — otherwise you could back your opponent and bench your own starters.">
              <Chip label="Your matchup — no betting" size="small" />
            </Tooltip>
          )}
          {settled ? <Chip label="Final" size="small" />
            : market.open
              ? <Chip label={`Open · ${Math.round(market.remainingMinutes)} min left`} size="small" color="success" variant="outlined" />
              : (
                <Tooltip title={`Markets close under ${MARKET_CLOSE_MINUTES} minutes of remaining game action — odds get unreliable in the last stretch.`}>
                  <Chip label={`Closed · ${Math.round(market.remainingMinutes)} min left`} size="small" color="warning" variant="outlined" />
                </Tooltip>
              )}
        </Stack>
      </Box>
      <SideRow
        name={market.nameA} points={market.pointsA} projected={market.projectedA}
        detail={market.detailA} prob={market.probA} odds={market.priceA}
        favourite={aFav} canBet={canBet} onBet={() => onBet({ market, side: 'a' })}
      />
      <Divider />
      <SideRow
        name={market.nameB} points={market.pointsB} projected={market.projectedB}
        detail={market.detailB} prob={1 - market.probA} odds={market.priceB}
        favourite={!aFav} canBet={canBet} onBet={() => onBet({ market, side: 'b' })}
      />
      {mine.length > 0 && (
        <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
          {mine.map(w => (
            <Typography key={w.id} variant="caption" color="text.secondary" component="div">
              your bet: {formatCents(w.stake_cents)} on{' '}
              {w.side === 'a' ? market.nameA : market.nameB} at {formatOdds(w.price)} · to win{' '}
              {formatCents(w.to_win_cents)} · <strong>{w.status}</strong>
            </Typography>
          ))}
        </Box>
      )}
    </Paper>
  );
}

function MarketsContent({ leagueId }: { leagueId: string }) {
  const { user, refresh: refreshAuth } = useBettingAuth();
  const [data, setData] = React.useState<MarketsPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<Date | null>(null);
  const [betTarget, setBetTarget] = React.useState<BetTarget | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/betting/markets?leagueId=${encodeURIComponent(leagueId)}`, {
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'Could not load markets.'); return; }
      setData(body);
      setUpdatedAt(new Date());
      setError(null);
    } catch {
      setError('Could not load markets.');
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  React.useEffect(() => { load(); }, [load]);

  // Poll only while visible — a background tab polling live scores is pure waste.
  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (timer === null) timer = setInterval(load, POLL_INTERVAL_MS); };
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const onVis = () => {
      if (document.visibilityState === 'visible') { load(); start(); } else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  if (loading) return <LinearProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return null;

  const negative = data.balanceCents < 0;

  return (
    <Box>
      <PageHeader
        title={data.league.label}
        subtitle={`Week ${data.week} matchup odds, priced from our simulation.`}
      />

      {!user && (
        <Alert severity="info" sx={{ mb: 2 }}>Sign in on the Declan Dollars page to place wagers.</Alert>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={3} flexWrap="wrap" alignItems="center">
          <Box>
            <Typography variant="caption" color="text.secondary" component="div">Balance</Typography>
            <Typography variant="h6" color={negative ? 'error.main' : 'success.main'}>
              {formatCents(data.balanceCents)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" component="div">At risk</Typography>
            <Typography variant="h6">{formatCents(data.openExposureCents)}</Typography>
          </Box>
          {negative && (
            <Alert severity="warning" sx={{ py: 0 }}>
              Balance is negative, so open wagers are capped at{' '}
              {formatCents(data.negativeExposureCapCents)} in total.
            </Alert>
          )}
        </Stack>
      </Paper>

      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {updatedAt && `Updated ${updatedAt.toLocaleTimeString()} · refreshes every ${POLL_INTERVAL_MS / 1000}s`}
        </Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
      </Stack>

      {data.markets.length === 0 ? (
        <Alert severity="info">No head-to-head matchups found for week {data.week}.</Alert>
      ) : (
        data.markets.map(m => (
          <MarketCard
            key={m.id}
            market={m}
            isMine={m.ownerA === data.mySleeperUserId || m.ownerB === data.mySleeperUserId}
            myWagers={data.myWagers}
            onBet={setBetTarget}
          />
        ))
      )}

      {data.myWagers.length > 0 && (
        <Paper sx={{ p: 3, mt: 3 }}>
          <Typography variant="h6" gutterBottom>Your week {data.week} bets</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Matchup</TableCell><TableCell>Side</TableCell>
                  <TableCell align="right">Stake</TableCell><TableCell align="right">Price</TableCell>
                  <TableCell align="right">To win</TableCell><TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.myWagers.map(w => {
                  const m = data.markets.find(x => x.id === w.market_id);
                  return (
                    <TableRow key={w.id}>
                      <TableCell>{w.matchup_id}</TableCell>
                      <TableCell>{m ? (w.side === 'a' ? m.nameA : m.nameB) : w.side}</TableCell>
                      <TableCell align="right">{formatCents(w.stake_cents)}</TableCell>
                      <TableCell align="right">{formatOdds(w.price)}</TableCell>
                      <TableCell align="right">{formatCents(w.to_win_cents)}</TableCell>
                      <TableCell>{w.status}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <Alert severity="info" sx={{ mt: 2 }}>
        Probabilities come from a normal approximation to each side&apos;s remaining scoring,
        with per-position variance and bias fitted from 68,011 player-weeks
        (2019&ndash;2025) scored under this league&apos;s own settings. Players whose game
        hasn&apos;t kicked off are assumed to be started optimally. Prices include a{' '}
        {(HOUSE_VIG * 100).toFixed(2)}% house edge.
      </Alert>

      <BetDialog
        target={betTarget}
        balanceCents={data.balanceCents}
        onClose={() => setBetTarget(null)}
        onPlaced={() => { load(); refreshAuth(); }}
      />
    </Box>
  );
}

export default function LeagueMarketsPage() {
  const params = useParams();
  const leagueId = params.leagueId as string;
  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <MarketsContent leagueId={leagueId} />
    </Container>
  );
}
