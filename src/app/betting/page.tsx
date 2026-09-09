'use client';

import * as React from 'react';
import {
  Container, Box, Paper, Typography, TextField, Button, Alert,
  LinearProgress, Table, TableBody, TableCell, TableHead, TableRow,
  TableContainer, Divider, Chip, Tooltip, Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import Link from 'next/link';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PageHeader from '@/components/common/PageHeader';
import DataTable, { Column } from '@/components/common/DataTable';
import { useBettingAuth, BetRow, OpenPositionRow } from '@/context/BettingAuthContext';
import { formatCents, LEDGER_REASON_LABELS } from '@/lib/betting/constants';

/**
 * Why an open bet's P&L is shown at all, and why it can start negative.
 *
 * An unsettled bet has no result, but it does have a value: the expected payout at the current
 * line. Reporting nothing until settlement is what made the balance read as though staked money
 * had evaporated. Reporting the stake as a loss would be worse.
 *
 * The consequence that looks wrong and is not: because the price paid carried the house edge, a
 * bet is worth slightly less than its stake the moment it is struck. That gap is the vig, and
 * this copy exists so nobody has to guess at it.
 */
/** How often the dashboard re-reads its own valuation while bets are open. */
const LIVE_REFRESH_MS = 30_000;

const LIVE_VALUE_HINT =
  'Expected value at the current odds, not a cash-out — there is nobody to sell to. '
  + 'A new bet is worth slightly less than its stake because the price included the house edge.';

function SignInPanel() {
  const { login, error } = useBettingAuth();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch {
      // error is surfaced via context
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper sx={{ p: 3, maxWidth: 460 }}>
      <Typography variant="h6" gutterBottom>Sign in to bet</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Your username is your Sleeper display name (capitalisation doesn&apos;t matter).
        Accounts are created for league members only — if you haven&apos;t set a password
        yet, use the setup link you were sent.
      </Typography>
      <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
          size="small"
          fullWidth
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          size="small"
          fullWidth
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Button
          type="submit"
          variant="contained"
          disabled={busy || !username || !password}
        >
          {busy ? 'Signing in…' : 'Sign In'}
        </Button>
      </Box>
    </Paper>
  );
}

/** One label + value, inline. A stat this small does not need a card around it. */
function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ minWidth: 96 }}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.3 }}>
        {label}
      </Typography>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, color: color ?? 'text.primary', lineHeight: 1.3 }}>
        {value}
      </Typography>
    </Box>
  );
}

const RESULT_CHIP: Record<string, { label: string; color: 'success' | 'error' | 'default' | 'warning' }> = {
  won: { label: 'Won', color: 'success' },
  lost: { label: 'Lost', color: 'error' },
  void: { label: 'Push', color: 'warning' },
  open: { label: 'Live', color: 'default' },
};

/** Signed money for one bet: profit if won, the stake back if pushed, else the loss. */
function betPnlCents(b: BetRow): number | null {
  if (b.status === 'won') return b.to_win_cents;
  if (b.status === 'lost') return -b.stake_cents;
  if (b.status === 'void') return 0;
  return null;
}

type HistoryRow = BetRow & {
  /** Present only while the bet is unsettled. */
  position?: OpenPositionRow;
  pick: string;
  against: string;
  /** Signed money, realised for a settled bet and expected for an open one. */
  pnlCents: number | null;
  /** Score line, or null before the week finishes. */
  scoreLabel: string | null;
};

function buildHistoryRows(bets: BetRow[], positions: OpenPositionRow[]): HistoryRow[] {
  const byWager = new Map(positions.map(p => [p.wagerId, p]));
  return bets.map(b => {
    const pickedA = b.side === 'a';
    const position = byWager.get(b.id);
    const myScore = pickedA ? b.final_a : b.final_b;
    const theirScore = pickedA ? b.final_b : b.final_a;
    return {
      ...b,
      position,
      pick: (pickedA ? b.name_a : b.name_b) ?? `Roster ${pickedA ? b.roster_a : b.roster_b}`,
      against: (pickedA ? b.name_b : b.name_a) ?? `Roster ${pickedA ? b.roster_b : b.roster_a}`,
      // An open bet's number is its unrealised move; a settled one's is what actually happened.
      pnlCents: position ? position.unrealisedCents : betPnlCents(b),
      scoreLabel:
        myScore != null && theirScore != null
          ? `${myScore.toFixed(1)}\u2013${theirScore.toFixed(1)}`
          : null,
    };
  });
}

function pnlColor(pnl: number | null): string {
  if (pnl == null || pnl === 0) return 'text.secondary';
  return pnl > 0 ? 'success.main' : 'error.main';
}

function signedCents(cents: number): string {
  return `${cents > 0 ? '+' : ''}${formatCents(cents)}`;
}

function BetHistory({ bets, positions }: { bets: BetRow[]; positions: OpenPositionRow[] }) {
  const rows = React.useMemo(() => buildHistoryRows(bets, positions), [bets, positions]);

  const columns: Column<HistoryRow>[] = [
    { id: 'week', label: 'Wk', numeric: true },
    {
      id: 'pick', label: 'Your pick',
      render: r => <Box component="span" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.pick}</Box>,
    },
    {
      id: 'against', label: 'Against',
      render: r => <Box component="span" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{r.against}</Box>,
    },
    {
      id: 'price', label: 'Odds', numeric: true, align: 'right',
      render: r => (r.price > 0 ? `+${r.price}` : String(r.price)),
    },
    {
      id: 'stake_cents', label: 'Stake', numeric: true, align: 'right',
      render: r => formatCents(r.stake_cents),
    },
    {
      id: 'winNow', label: 'Win now', numeric: true, align: 'right',
      tooltip: 'Our current probability that this side wins. Blank once the bet has settled.',
      // A render-only column needs sortValue or the comparator reads undefined for every row
      // and the sort silently does nothing.
      sortValue: r => r.position?.winProbability ?? -1,
      render: r =>
        r.position ? `${(r.position.winProbability * 100).toFixed(0)}%` : '\u2014',
    },
    {
      id: 'scoreLabel', label: 'Score', align: 'right',
      sortValue: r => r.scoreLabel ?? '',
      render: r => (
        <Box component="span" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
          {r.scoreLabel ?? '\u2014'}
        </Box>
      ),
    },
    {
      id: 'status', label: 'Result',
      render: r => {
        const chip = RESULT_CHIP[r.status] ?? { label: r.status, color: 'default' as const };
        return <Chip label={chip.label} color={chip.color} size="small" variant="outlined" />;
      },
    },
    {
      id: 'pnlCents', label: 'P&L', numeric: true, align: 'right',
      tooltip: `Realised once settled. While a bet is live this is its unrealised move. ${LIVE_VALUE_HINT}`,
      render: r => (
        <Box component="span" sx={{ fontWeight: 600, color: pnlColor(r.pnlCents) }}>
          {r.pnlCents == null ? '\u2014' : signedCents(r.pnlCents)}
          {r.position && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.1 }}>
              worth {formatCents(r.position.valueCents)}
            </Typography>
          )}
        </Box>
      ),
    },
  ];

  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No bets yet. Open a league above to see this week&apos;s lines.
      </Typography>
    );
  }

  return (
    <DataTable
      data={rows}
      columns={columns}
      keyField="id"
      defaultSortBy="placed_at"
      defaultSortOrder="desc"
      rowsPerPageOptions={[10, 25, 50]}
      defaultRowsPerPage={10}
    />
  );
}

function Dashboard() {
  const { user, balanceCents, leagues, ledger, bets, openPositions, summary, logout, refresh } =
    useBettingAuth();

  const settled = bets.filter(b => b.status === 'won' || b.status === 'lost');
  const won = settled.filter(b => b.status === 'won').length;
  const hitRate = settled.length > 0 ? (won / settled.length) * 100 : null;
  const pnl = summary.realisedPnlCents;

  /*
   * With money on the table, the headline is what the account is WORTH, not what has settled.
   *
   * A balance alone is misleading mid-slate: the stake left it at placement, so betting $500 of
   * $1,000 on a side that is now 90% to win reads as $500. With nothing open the two figures are
   * identical, so the balance is the headline and there is no second number to explain.
   */
  const hasOpen = openPositions.length > 0;
  const headlineCents = hasOpen ? summary.equityCents : balanceCents;
  const negative = headlineCents < 0;
  const unrealised = summary.unrealisedPnlCents;

  // Keep the live figures moving while a slate is on. The valuation is only as fresh as the
  // last time the lines behind it were priced, and /api/betting/me re-prices a stale week.
  React.useEffect(() => {
    if (!hasOpen) return;
    const id = setInterval(() => { void refresh(); }, LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [hasOpen, refresh]);

  return (
    <Box>
      <Paper sx={{ p: 2.5, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            {/* Always name the betting account explicitly — the header may show a
                different Sleeper username, since those are separate identities. */}
            <Typography variant="body2" color="text.secondary">
              Betting as <strong>{user?.displayName}</strong>
            </Typography>
            <Typography variant="h3" sx={{ mt: 0.5, color: negative ? 'error.main' : 'success.main' }}>
              {formatCents(headlineCents)}
            </Typography>
            {hasOpen ? (
              <Typography variant="caption" color="text.secondary">
                Live worth — {formatCents(balanceCents)} settled plus{' '}
                {formatCents(summary.liveValueCents)} riding on {openPositions.length} open bet
                {openPositions.length === 1 ? '' : 's'}
                {negative && ' — you are in the hole'}
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary">
                Declan Dollars {negative && '— you are in the hole'}
              </Typography>
            )}
          </Box>
          <Button variant="outlined" size="small" onClick={logout}>Sign Out</Button>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Stat label="Settled balance" value={formatCents(balanceCents)} />
          <Tooltip title={LIVE_VALUE_HINT} arrow>
            <Box sx={{ display: 'flex', gap: 4 }}>
              <Stat label="At risk now" value={formatCents(summary.openStakeCents)} />
              <Stat
                label="Worth now"
                value={hasOpen ? formatCents(summary.liveValueCents) : '—'}
                color={hasOpen ? pnlColor(unrealised) : undefined}
              />
              <Stat
                label="Unrealised"
                value={hasOpen ? signedCents(unrealised) : '—'}
                color={hasOpen ? pnlColor(unrealised) : undefined}
              />
            </Box>
          </Tooltip>
          <Stat
            label="Realised P&L"
            value={signedCents(pnl)}
            color={pnl > 0 ? 'success.main' : pnl < 0 ? 'error.main' : undefined}
          />
          <Stat label="Record" value={settled.length > 0 ? `${won}–${settled.length - won}` : '—'} />
          <Stat label="Hit rate" value={hitRate == null ? '—' : `${hitRate.toFixed(0)}%`} />
        </Box>

        {hasOpen && summary.pricedAt && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {/* The oldest line, not the newest: the total is only as fresh as its stalest input. */}
            Odds last priced {new Date(`${summary.pricedAt.replace(' ', 'T')}Z`).toLocaleTimeString()}
            {' · refreshing every '}{LIVE_REFRESH_MS / 1000}s
          </Typography>
        )}

        {leagues.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {leagues.map(l => (
                <Button
                  key={l.leagueId}
                  component={Link}
                  href={`/betting/${l.leagueId}`}
                  variant="contained"
                  size="small"
                  endIcon={<ArrowForwardIcon />}
                >
                  {l.label} ({l.season})
                </Button>
              ))}
            </Box>
          </>
        )}
      </Paper>

      <Paper sx={{ p: 2.5, mb: 2 }}>
        <Typography variant="h6" gutterBottom>Your bets</Typography>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
          Bets settle automatically once every NFL game in the week is final. A live bet shows
          what it is worth at the current odds, not a result.
        </Typography>
        <BetHistory bets={bets} positions={openPositions} />
      </Paper>

      {/* Secondary, and collapsed: the ledger is the audit trail, not the thing you
          came to look at. Every balance change is an immutable row here, so a
          mis-settled bet can be traced and corrected rather than edited away. */}
      <Accordion variant="outlined" disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">Full transaction ledger ({ledger.length})</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {ledger.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No activity yet.</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>When</TableCell>
                    <TableCell>Activity</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ledger.map(row => (
                    <TableRow key={row.id}>
                      <TableCell>{row.createdAt}</TableCell>
                      <TableCell>{LEDGER_REASON_LABELS[row.reason] ?? row.reason}</TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: row.amountCents < 0 ? 'error.main' : 'success.main', fontWeight: 'bold' }}
                      >
                        {row.amountCents > 0 ? '+' : ''}{formatCents(row.amountCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}

export default function BettingPage() {
  const { user, loading } = useBettingAuth();

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <PageHeader
        title="Declan Dollars"
        subtitle="Fake money, real bragging rights. Wager on league matchups."
      />
      {loading ? <LinearProgress /> : user ? <Dashboard /> : <SignInPanel />}
    </Container>
  );
}
