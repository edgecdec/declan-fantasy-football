'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  Container, Box, Paper, Typography, Chip, LinearProgress, Alert, Divider,
  Tooltip, Button, Stack,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import PageHeader from '@/components/common/PageHeader';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { getNflStateOrFallback } from '@/services/common/seasonService';
import { buildMatchupMarkets, MarketsResult, MatchupMarket, MarketSide } from '@/services/betting/matchupMarkets';
import { MARKET_CLOSE_MINUTES, HOUSE_VIG } from '@/services/betting/liveOdds';
import { useBettingAuth } from '@/context/BettingAuthContext';

/** Live scores move every few minutes; matches the matchup cache TTL. */
const POLL_INTERVAL_MS = 20_000;

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

function SideRow({ side, prob, odds, favourite }: {
  side: MarketSide; prob: number; odds: number; favourite: boolean;
}) {
  const d = side.distribution;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1 }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body1" fontWeight={favourite ? 'bold' : 'regular'} noWrap>
          {side.displayName}
          {side.teamName && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {side.teamName}
            </Typography>
          )}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {d.banked.toFixed(1)} pts
          {d.remaining > 0 && ` · ${d.remaining.toFixed(1)} projected to come · ${side.playersRemaining} yet to finish`}
        </Typography>
        {side.assumedPromotions.length > 0 && (
          <Tooltip
            title="Anyone whose game hasn't kicked off can still be swapped in, so we price the best lineup they could field rather than the one currently set."
          >
            <Typography variant="caption" color="warning.main" component="div">
              assumes they start{' '}
              {side.assumedPromotions
                .map(p => `${p.name} (${p.projectedPoints.toFixed(1)})`)
                .join(', ')}
            </Typography>
          </Tooltip>
        )}
      </Box>
      <Box sx={{ textAlign: 'right', minWidth: 110 }}>
        <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
          {(prob * 100).toFixed(1)}%
        </Typography>
        <Tooltip title={`American odds, includes the ${(HOUSE_VIG * 100).toFixed(2)}% house edge`}>
          <Chip label={formatOdds(odds)} size="small" variant="outlined" />
        </Tooltip>
      </Box>
    </Box>
  );
}

function MarketCard({ market }: { market: MatchupMarket }) {
  const { a, b, pricing, remainingMinutes, open } = market;
  const aFav = pricing.probA >= pricing.probB;
  const settled = remainingMinutes === 0;

  return (
    <Paper sx={{ p: 2.5, mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Matchup {market.matchupId}
        </Typography>
        {settled ? (
          <Chip label="Final" size="small" />
        ) : open ? (
          <Chip
            label={`Open · ${Math.round(remainingMinutes)} min of game time left`}
            size="small"
            color="success"
            variant="outlined"
          />
        ) : (
          <Tooltip title={`Markets close under ${MARKET_CLOSE_MINUTES} minutes of remaining game action — odds get unreliable in the last stretch.`}>
            <Chip
              label={`Closed · ${Math.round(remainingMinutes)} min left`}
              size="small"
              color="warning"
              variant="outlined"
            />
          </Tooltip>
        )}
      </Box>
      <SideRow side={a} prob={pricing.probA} odds={pricing.oddsA} favourite={aFav} />
      <Divider />
      <SideRow side={b} prob={pricing.probB} odds={pricing.oddsB} favourite={!aFav} />
    </Paper>
  );
}

function MarketsContent({ leagueId }: { leagueId: string }) {
  const { user } = useBettingAuth();
  const [result, setResult] = React.useState<MarketsResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<Date | null>(null);
  const [leagueName, setLeagueName] = React.useState('');

  const load = React.useCallback(async () => {
    try {
      const state = await getNflStateOrFallback();
      // The week being played, NOT completedWeekCount() — that deliberately
      // excludes the in-progress week, which is exactly the one we price.
      const week = Math.max(1, state.week);
      const res = await buildMatchupMarkets(leagueId, week);
      if (!res) {
        setError('Could not load markets for this league.');
        return;
      }
      setResult(res);
      setLeagueName(res.league.name);
      setUpdatedAt(new Date());
      setError(null);
    } catch (e) {
      console.error('Market load failed', e);
      setError('Could not load markets.');
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  React.useEffect(() => { load(); }, [load]);

  // Poll while the tab is visible. A background tab polling live scores every
  // 20s is pure waste, so pause and refresh once on return.
  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer === null) timer = setInterval(load, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== null) { clearInterval(timer); timer = null; }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { load(); start(); } else stop();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [load]);

  React.useEffect(() => {
    SleeperService.getLeague(leagueId).then(l => l && setLeagueName(l.name));
  }, [leagueId]);

  if (loading) return <LinearProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!result) return null;

  return (
    <Box>
      <PageHeader
        title={leagueName || 'League Markets'}
        subtitle={`Week ${result.week} matchup odds, priced from our simulation.`}
      />

      {!user && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You&apos;re viewing odds as a guest. Sign in on the{' '}
          <strong>Declan Dollars</strong> page to place wagers once they open.
        </Alert>
      )}

      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {updatedAt ? `Updated ${updatedAt.toLocaleTimeString()} · refreshes every ${POLL_INTERVAL_MS / 1000}s` : ''}
        </Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
      </Stack>

      {result.markets.length === 0 ? (
        <Alert severity="info">No head-to-head matchups found for week {result.week}.</Alert>
      ) : (
        result.markets.map(m => <MarketCard key={m.matchupId} market={m} />)
      )}

      <Alert severity="warning" sx={{ mt: 2 }}>
        Wagering isn&apos;t live yet — these are read-only odds. Probabilities come from a
        normal approximation to each side&apos;s remaining scoring, with per-position variance
        and bias fitted from 68,011 player-weeks (2019&ndash;2025) scored under this
        league&apos;s own settings. Players whose game hasn&apos;t kicked off are assumed to be
        started optimally, since a manager can still swap them. Prices include a{' '}
        {(HOUSE_VIG * 100).toFixed(2)}% house edge.
      </Alert>
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
