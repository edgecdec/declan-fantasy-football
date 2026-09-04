'use client';

import * as React from 'react';
import {
  Container, Box, Paper, Typography, TextField, Button, Alert,
  LinearProgress, Table, TableBody, TableCell, TableHead, TableRow,
  TableContainer, Divider, Chip, Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import Link from 'next/link';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PageHeader from '@/components/common/PageHeader';
import { useBettingAuth, BetRow } from '@/context/BettingAuthContext';
import { formatCents, LEDGER_REASON_LABELS } from '@/lib/betting/constants';

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

function BetHistory({ bets }: { bets: BetRow[] }) {
  if (bets.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No bets yet. Open a league above to see this week&apos;s lines.
      </Typography>
    );
  }
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Wk</TableCell>
            <TableCell>Your pick</TableCell>
            <TableCell>Against</TableCell>
            <TableCell align="right">Odds</TableCell>
            <TableCell align="right">Stake</TableCell>
            <TableCell align="right">Score</TableCell>
            <TableCell>Result</TableCell>
            <TableCell align="right">P&amp;L</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {bets.map(b => {
            const pickedA = b.side === 'a';
            const pick = (pickedA ? b.name_a : b.name_b) ?? `Roster ${pickedA ? b.roster_a : b.roster_b}`;
            const against = (pickedA ? b.name_b : b.name_a) ?? `Roster ${pickedA ? b.roster_b : b.roster_a}`;
            const pnl = betPnlCents(b);
            const chip = RESULT_CHIP[b.status] ?? { label: b.status, color: 'default' as const };
            const myScore = pickedA ? b.final_a : b.final_b;
            const theirScore = pickedA ? b.final_b : b.final_a;
            return (
              <TableRow key={b.id}>
                <TableCell>{b.week}</TableCell>
                <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{pick}</TableCell>
                <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{against}</TableCell>
                <TableCell align="right">{b.price > 0 ? `+${b.price}` : b.price}</TableCell>
                <TableCell align="right">{formatCents(b.stake_cents)}</TableCell>
                <TableCell align="right" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                  {myScore != null && theirScore != null
                    ? `${myScore.toFixed(1)}–${theirScore.toFixed(1)}`
                    : '—'}
                </TableCell>
                <TableCell>
                  <Chip label={chip.label} color={chip.color} size="small" variant="outlined" />
                </TableCell>
                <TableCell
                  align="right"
                  sx={{
                    fontWeight: 600,
                    color: pnl == null ? 'text.secondary' : pnl > 0 ? 'success.main' : pnl < 0 ? 'error.main' : 'text.secondary',
                  }}
                >
                  {pnl == null
                    ? `to win ${formatCents(b.to_win_cents)}`
                    : `${pnl > 0 ? '+' : ''}${formatCents(pnl)}`}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function Dashboard() {
  const { user, balanceCents, leagues, ledger, bets, summary, logout } = useBettingAuth();
  const negative = balanceCents < 0;

  const settled = bets.filter(b => b.status === 'won' || b.status === 'lost');
  const won = settled.filter(b => b.status === 'won').length;
  const hitRate = settled.length > 0 ? (won / settled.length) * 100 : null;
  const pnl = summary.realisedPnlCents;

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
              {formatCents(balanceCents)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Declan Dollars {negative && '— you are in the hole'}
            </Typography>
          </Box>
          <Button variant="outlined" size="small" onClick={logout}>Sign Out</Button>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Stat
            label="Realised P&L"
            value={`${pnl > 0 ? '+' : ''}${formatCents(pnl)}`}
            color={pnl > 0 ? 'success.main' : pnl < 0 ? 'error.main' : undefined}
          />
          <Stat label="At risk now" value={formatCents(summary.openStakeCents)} />
          <Stat label="Record" value={settled.length > 0 ? `${won}–${settled.length - won}` : '—'} />
          <Stat label="Hit rate" value={hitRate == null ? '—' : `${hitRate.toFixed(0)}%`} />
        </Box>

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
          Bets settle automatically once every NFL game in the week is final.
        </Typography>
        <BetHistory bets={bets} />
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
