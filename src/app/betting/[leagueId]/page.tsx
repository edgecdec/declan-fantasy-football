'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  Container, Box, Paper, Typography, Chip, LinearProgress, Alert,
  Tooltip, Button, Stack, TextField, Dialog, DialogTitle, DialogContent,
  DialogActions, Table, TableBody, TableCell, TableHead, TableRow, TableContainer,
  Tabs, Tab,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import PageHeader from '@/components/common/PageHeader';
import MatchupMeter, { SideSwatch } from '@/components/betting/MatchupMeter';
import LeagueStandings from '@/components/betting/LeagueStandings';
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

/** One line of supporting detail, only when there is something to say. */
function SideNotes({ detail }: { detail: SideDetail }) {
  const bits: React.ReactNode[] = [];
  for (const s of detail.streams) {
    bits.push(
      <Tooltip
        key={`s-${s.slot}`}
        title="No rostered player for this slot, so we assume they pick one up before kickoff — averaged across the best available options rather than naming one."
      >
        <Chip
          size="small"
          variant="outlined"
          color="info"
          label={`streamed ${s.slot} ${s.projectedPoints.toFixed(1)}`}
          sx={{ height: 18, fontSize: 10 }}
        />
      </Tooltip>,
    );
  }
  if (detail.unfilledSlots.length > 0) {
    bits.push(
      <Tooltip key="unf" title="Nobody could fill this slot, so it scores nothing.">
        <Chip
          size="small"
          variant="outlined"
          color="error"
          label={`${detail.unfilledSlots.join('/')} empty`}
          sx={{ height: 18, fontSize: 10 }}
        />
      </Tooltip>,
    );
  }
  if (detail.promotions.length > 0) {
    bits.push(
      <Tooltip
        key="promo"
        title="Anyone whose game hasn't kicked off can still be swapped in, so we price the best lineup they could field."
      >
        <Chip
          size="small"
          variant="outlined"
          color="warning"
          label={`optimal lineup (${detail.promotions.length})`}
          sx={{ height: 18, fontSize: 10 }}
        />
      </Tooltip>,
    );
  }
  if (bits.length === 0) return null;
  return <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{bits}</Stack>;
}

/** Name + swatch + score, with the odds button as the call to action. */
function SideHeader({ side, name, points, projected, odds, canBet, onBet, align }: {
  side: 'a' | 'b'; name: string; points: number; projected: number;
  odds: number; canBet: boolean; onBet: () => void; align: 'left' | 'right';
}) {
  const remaining = projected - points;
  const right = align === 'right';
  return (
    <Box sx={{ minWidth: 0, flex: 1, textAlign: align }}>
      <Stack
        direction={right ? 'row-reverse' : 'row'}
        spacing={0.75}
        alignItems="center"
        sx={{ minWidth: 0 }}
      >
        <SideSwatch side={side} />
        <Typography variant="body2" fontWeight={600} noWrap>{name}</Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" component="div">
        {points.toFixed(1)}
        {remaining > 0.05 && ` → ${projected.toFixed(1)}`}
      </Typography>
      {canBet ? (
        <Tooltip title={`Back ${name} at ${formatOdds(odds)} — includes the ${(HOUSE_VIG * 100).toFixed(2)}% house edge`}>
          <Button size="small" variant="outlined" onClick={onBet} sx={{ mt: 0.5, minWidth: 62, py: 0 }}>
            {formatOdds(odds)}
          </Button>
        </Tooltip>
      ) : (
        <Chip label={formatOdds(odds)} size="small" variant="outlined" sx={{ mt: 0.5, height: 22 }} />
      )}
    </Box>
  );
}

function MarketCard({ market, isMine, myWagers, onBet }: {
  market: Market; isMine: boolean; myWagers: MyWager[]; onBet: (t: BetTarget) => void;
}) {
  const settled = market.remainingMinutes === 0;
  const canBet = market.open && !isMine;
  const mine = myWagers.filter(w => w.market_id === market.id);

  // Status is a reserved colour, so it always ships with a label rather than
  // relying on the colour alone.
  const status = isMine
    ? { label: 'Your matchup', color: undefined as 'success' | 'warning' | undefined,
        title: "You're playing in this matchup. Betting on it is blocked — otherwise you could back your opponent and bench your own starters." }
    : settled
      ? { label: 'Final', color: undefined, title: 'All games finished.' }
      : market.open
        ? { label: `${Math.round(market.remainingMinutes)}m left`, color: 'success' as const,
            title: 'Open for betting.' }
        : { label: `Closed · ${Math.round(market.remainingMinutes)}m`, color: 'warning' as const,
            title: `Markets close under ${MARKET_CLOSE_MINUTES} minutes of remaining game action — odds get unreliable in the last stretch.` };

  return (
    <Paper variant="outlined" sx={{ px: 1.5, py: 1.25, mb: 1 }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <SideHeader
          side="a" name={market.nameA} points={market.pointsA} projected={market.projectedA}
          odds={market.priceA} canBet={canBet} align="left"
          onBet={() => onBet({ market, side: 'a' })}
        />
        <Box sx={{ flex: '1 1 42%', minWidth: 130, pt: 0.5 }}>
          <MatchupMeter
            probA={market.probA} nameA={market.nameA} nameB={market.nameB} muted={!canBet}
          />
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 0.75 }}>
            <Tooltip title={status.title}>
              <Chip
                label={status.label}
                size="small"
                color={status.color}
                variant="outlined"
                sx={{ height: 18, fontSize: 10 }}
              />
            </Tooltip>
          </Box>
        </Box>
        <SideHeader
          side="b" name={market.nameB} points={market.pointsB} projected={market.projectedB}
          odds={market.priceB} canBet={canBet} align="right"
          onBet={() => onBet({ market, side: 'b' })}
        />
      </Stack>

      {(market.detailA.streams.length > 0 || market.detailA.unfilledSlots.length > 0 ||
        market.detailA.promotions.length > 0 || market.detailB.streams.length > 0 ||
        market.detailB.unfilledSlots.length > 0 || market.detailB.promotions.length > 0) && (
        <Stack direction="row" spacing={1} sx={{ mt: 0.75 }} justifyContent="space-between">
          <SideNotes detail={market.detailA} />
          <SideNotes detail={market.detailB} />
        </Stack>
      )}

      {mine.length > 0 && (
        <Box sx={{ mt: 0.75, pt: 0.75, borderTop: 1, borderColor: 'divider' }}>
          {mine.map(w => (
            <Typography key={w.id} variant="caption" color="text.secondary" component="div">
              you: {formatCents(w.stake_cents)} on {w.side === 'a' ? market.nameA : market.nameB}
              {' '}at {formatOdds(w.price)} → {formatCents(w.to_win_cents)} · <strong>{w.status}</strong>
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
  // A tab rather than another section, so the standings don't add scroll to the
  // markets view the compaction work just tightened up.
  const [tab, setTab] = React.useState<'markets' | 'standings'>('markets');

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

      {/* Single headline numbers, so stat tiles rather than a chart. */}
      <Paper variant="outlined" sx={{ px: 1.5, py: 1, mb: 1.5 }}>
        <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap" useFlexGap>
          <Box>
            <Typography variant="caption" color="text.secondary" component="div">Balance</Typography>
            <Typography variant="h6" color={negative ? 'error.main' : 'success.main'} sx={{ lineHeight: 1.2 }}>
              {formatCents(data.balanceCents)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" component="div">At risk</Typography>
            <Typography variant="h6" sx={{ lineHeight: 1.2 }}>{formatCents(data.openExposureCents)}</Typography>
          </Box>
          {negative && (
            <Tooltip title={`Your balance is below zero, so total unsettled stake is capped at ${formatCents(data.negativeExposureCapCents)}.`}>
              <Chip size="small" color="warning" variant="outlined"
                label={`capped at ${formatCents(data.negativeExposureCapCents)}`} />
            </Tooltip>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" color="text.secondary">
              {updatedAt && `${updatedAt.toLocaleTimeString()} · ${POLL_INTERVAL_MS / 1000}s`}
            </Typography>
            <Button size="small" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
          </Stack>
        </Stack>
      </Paper>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 1.5 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab value="markets" label={`Week ${data.week} markets`} />
          <Tab value="standings" label="League standings" />
        </Tabs>
      </Box>

      {tab === 'standings' ? (
        <LeagueStandings leagueId={leagueId} />
      ) : data.markets.length === 0 ? (
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

      {tab === 'markets' && data.myWagers.length > 0 && (
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

      {tab === 'markets' && (
      <Alert severity="info" sx={{ mt: 2 }}>
        Probabilities come from a normal approximation to each side&apos;s remaining scoring,
        with per-position variance and bias fitted from 68,011 player-weeks
        (2019&ndash;2025) scored under this league&apos;s own settings. Players whose game
        hasn&apos;t kicked off are assumed to be started optimally. Prices include a{' '}
        {(HOUSE_VIG * 100).toFixed(2)}% house edge.
      </Alert>
      )}

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
