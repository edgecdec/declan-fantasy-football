'use client';

import * as React from 'react';
import { Box, Paper, Typography, Chip, Tooltip, Stack, LinearProgress, Alert } from '@mui/material';
import DataTable, { Column } from '@/components/common/DataTable';
import { formatCents } from '@/lib/betting/constants';

/**
 * League-wide standings: who is up, who is down, and what is still live.
 *
 * The job is magnitude ranked by identity across ten rows, which is a table's work rather than a
 * chart's — the reader wants exact figures and to find their own name. The only mark is a
 * one-hue bar behind the profit column, sized relative to the biggest swing, so the shape of the
 * league reads at a glance without a second axis.
 *
 * RANKED ON LIVE WORTH, NOT BALANCE. A balance ranks whoever has bet least highest mid-slate,
 * because a stake leaves the balance the moment it is placed and does not come back until the
 * week settles. Someone with $500 left and $500 riding on a 90% favourite is not behind someone
 * who is sitting on $900 and has bet nothing. Live worth is the settled balance plus the
 * expected return of every open bet at the current line — see src/lib/betting/valuation.ts,
 * including why it uses the fair probability rather than the priced one.
 */

type Standing = {
  accountId: string;
  displayName: string;
  isMe: boolean;
  claimed: boolean;
  balanceCents: number;
  liveValueCents: number;
  equityCents: number;
  unrealisedPnlCents: number;
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
  pick: string;
  stakeCents: number;
  price: number;
  toWinCents: number;
  matchupId: number;
  week: number;
  winProbability: number | null;
  valueCents: number | null;
  unrealisedCents: number | null;
};

type Payload = {
  ok: boolean;
  league: { label: string; season: string };
  startBalanceCents: number;
  standings: Standing[];
  openPositions: OpenPosition[];
};

/** Standings re-price stale lines, so refreshing has a cost — match the other live surfaces. */
const REFRESH_MS = 30_000;

const LIVE_VALUE_HINT =
  'Settled balance plus what every open bet is worth at the current odds. An expectation, not a '
  + 'cash-out — and a new bet is worth slightly less than its stake because the price included '
  + 'the house edge.';

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

function signedCents(cents: number): string {
  return `${cents > 0 ? '+' : ''}${formatCents(cents)}`;
}

function moneyColor(cents: number): string {
  if (cents === 0) return 'text.secondary';
  return cents > 0 ? 'success.main' : 'error.main';
}

/**
 * Profit magnitude as a bar growing from a centre baseline: right for a gain, left for a loss.
 *
 * Status hues (good/critical) rather than categorical, because the encoded thing is polarity,
 * and both always ship with the signed number beside them so nothing rests on colour.
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

  // Only poll while something is actually live. A settled league cannot change, and re-pricing
  // costs an ESPN call plus three Sleeper calls per week.
  const anyOpen = data?.standings.some(s => s.openCount > 0) ?? false;
  React.useEffect(() => {
    if (!anyOpen) return;
    const id = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [anyOpen, load]);

  if (loading) return <LinearProgress />;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return null;

  const maxAbs = Math.max(1, ...data.standings.map(s => Math.abs(s.bettingNetCents)));
  const anyBets = data.standings.some(s => s.totalStakedCents > 0);

  const columns: Column<Standing>[] = [
    {
      id: 'displayName',
      label: 'Manager',
      render: s => (
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ whiteSpace: 'nowrap' }}>
          <Typography variant="body2" fontWeight={s.isMe ? 700 : 400}>{s.displayName}</Typography>
          {s.isMe && <Chip label="you" size="small" color="primary" sx={{ height: 16, fontSize: 10 }} />}
          {!s.claimed && (
            <Tooltip title="Hasn't used their setup link yet">
              <Chip label="not set up" size="small" variant="outlined" sx={{ height: 16, fontSize: 10 }} />
            </Tooltip>
          )}
        </Stack>
      ),
    },
    {
      id: 'equityCents',
      label: 'Live worth',
      numeric: true,
      align: 'right',
      tooltip: LIVE_VALUE_HINT,
      render: s => (
        <Box>
          <Typography
            variant="body2"
            sx={{ fontWeight: 700, color: s.equityCents < 0 ? 'error.main' : 'text.primary' }}
          >
            {formatCents(s.equityCents)}
          </Typography>
          {/* Only shown when it differs from the balance, so a row with nothing open stays
              clean rather than carrying a redundant second figure. */}
          {s.openCount > 0 && (
            <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.1, color: moneyColor(s.unrealisedPnlCents) }}>
              {signedCents(s.unrealisedPnlCents)} live
            </Typography>
          )}
        </Box>
      ),
    },
    {
      id: 'balanceCents',
      label: 'Settled',
      numeric: true,
      align: 'right',
      tooltip: 'Cash balance. Excludes anything riding on an unsettled bet.',
      render: s => (
        <Box component="span" sx={{ color: s.balanceCents < 0 ? 'error.main' : 'text.secondary' }}>
          {formatCents(s.balanceCents)}
        </Box>
      ),
    },
    {
      id: 'bettingNetCents',
      label: 'Profit',
      numeric: true,
      align: 'right',
      width: 110,
      tooltip: 'Settled wagers only, excluding manual adjustments.',
      // The bar sits INSIDE this cell rather than in a column of its own. As a separate column
      // its only visible output on a row with nothing settled was the row's own border, which
      // read as a stray rule across the table.
      render: s => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, color: moneyColor(s.bettingNetCents) }}>
            {s.settledStakedCents > 0 ? signedCents(s.bettingNetCents) : '—'}
          </Typography>
          {s.settledStakedCents > 0 && <ProfitBar cents={s.bettingNetCents} maxAbs={maxAbs} />}
        </Box>
      ),
    },
    {
      id: 'roi',
      label: 'ROI',
      numeric: true,
      align: 'right',
      tooltip: 'Return on stake that has settled.',
      // Unsettled sorts below every real figure rather than reading as 0%.
      sortValue: s => s.roi ?? Number.NEGATIVE_INFINITY,
      render: s => (
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {s.roi === null ? '—' : `${(s.roi * 100).toFixed(0)}%`}
        </Box>
      ),
    },
    {
      id: 'record',
      label: 'W-L-V',
      align: 'center',
      // Sorted by wins, since that is what a reader is comparing in this column.
      sortValue: s => s.won,
      render: s => (
        <Box component="span" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
          {s.settledCount === 0 ? '—' : `${s.won}-${s.lost}${s.voided ? `-${s.voided}` : ''}`}
        </Box>
      ),
    },
    {
      id: 'openStakeCents',
      label: 'At risk',
      numeric: true,
      align: 'right',
      tooltip: "Stake on wagers that haven't settled.",
      render: s => (
        <Box component="span" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
          {s.openStakeCents > 0 ? `${formatCents(s.openStakeCents)} (${s.openCount})` : '—'}
        </Box>
      ),
    },
  ];

  const liveColumns: Column<OpenPosition>[] = [
    { id: 'bettor', label: 'Bettor' },
    { id: 'week', label: 'Wk', numeric: true, align: 'center' },
    {
      id: 'pick', label: 'Backing',
      render: p => <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{p.pick}</Box>,
    },
    {
      id: 'stakeCents', label: 'Stake', numeric: true, align: 'right',
      render: p => formatCents(p.stakeCents),
    },
    {
      id: 'price', label: 'Price', numeric: true, align: 'right',
      render: p => <Box component="span" sx={{ color: 'text.secondary' }}>{formatOdds(p.price)}</Box>,
    },
    {
      id: 'toWinCents', label: 'To win', numeric: true, align: 'right',
      render: p => <Box component="span" sx={{ color: 'success.main' }}>{formatCents(p.toWinCents)}</Box>,
    },
    {
      id: 'winProbability', label: 'Win now', numeric: true, align: 'right',
      tooltip: 'Our current probability that this side wins.',
      sortValue: p => p.winProbability ?? -1,
      render: p => (p.winProbability == null ? '—' : `${(p.winProbability * 100).toFixed(0)}%`),
    },
    {
      id: 'valueCents', label: 'Worth now', numeric: true, align: 'right',
      tooltip: LIVE_VALUE_HINT,
      sortValue: p => p.unrealisedCents ?? Number.NEGATIVE_INFINITY,
      render: p => (
        p.valueCents == null ? '—' : (
          <Box component="span" sx={{ fontWeight: 600, color: moneyColor(p.unrealisedCents ?? 0) }}>
            {formatCents(p.valueCents)}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.1 }}>
              {signedCents(p.unrealisedCents ?? 0)}
            </Typography>
          </Box>
        )
      ),
    },
  ];

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2, mb: 1.5 }}>
        <Typography variant="h6" gutterBottom>League standings</Typography>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
          Everyone started at {formatCents(data.startBalanceCents)}. Ranked on <strong>live
          worth</strong> — settled balance plus what every open bet is worth at the current
          odds — because a stake leaves the balance the moment it is placed, so ranking on
          balance alone would put whoever has bet least on top mid-slate. Profit counts settled
          wagers only and excludes manual adjustments, so it can&apos;t look like skill.
        </Typography>
        <DataTable
          data={data.standings}
          columns={columns}
          keyField="accountId"
          defaultSortBy="equityCents"
          defaultSortOrder="desc"
          rowsPerPageOptions={[10, 25]}
          defaultRowsPerPage={25}
          noDataMessage="Nobody in this league yet."
        />
        {!anyBets && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Nobody has placed a bet yet.
          </Typography>
        )}
      </Paper>

      {data.openPositions.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Live around the league</Typography>
          <DataTable
            data={data.openPositions}
            columns={liveColumns}
            keyField={p => `${p.bettor}-${p.week}-${p.matchupId}-${p.side}-${p.stakeCents}`}
            defaultSortBy="stakeCents"
            defaultSortOrder="desc"
            rowsPerPageOptions={[10, 25, 50]}
            defaultRowsPerPage={25}
          />
        </Paper>
      )}
    </Box>
  );
}
