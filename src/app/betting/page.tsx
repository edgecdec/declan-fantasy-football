'use client';

import * as React from 'react';
import {
  Container, Box, Paper, Typography, TextField, Button, Chip, Alert,
  LinearProgress, Table, TableBody, TableCell, TableHead, TableRow,
  TableContainer, Divider,
} from '@mui/material';
import PageHeader from '@/components/common/PageHeader';
import { useBettingAuth } from '@/context/BettingAuthContext';
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
        Accounts are created for league members only. If you haven&apos;t set a password yet,
        use the setup link you were sent.
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

function Dashboard() {
  const { user, balanceCents, leagues, ledger, logout } = useBettingAuth();
  const negative = balanceCents < 0;

  return (
    <Box>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            {/* Always name the betting account explicitly — the header may show a
                different Sleeper username, since those are separate identities. */}
            <Typography variant="body2" color="text.secondary">
              Betting as <strong>{user?.displayName}</strong>
            </Typography>
            <Typography variant="h3" sx={{ mt: 1, color: negative ? 'error.main' : 'success.main' }}>
              {formatCents(balanceCents)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Declan Dollars {negative && '— you are in the hole'}
            </Typography>
          </Box>
          <Button variant="outlined" size="small" onClick={logout}>Sign Out</Button>
        </Box>

        {leagues.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Eligible leagues
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {leagues.map(l => (
                <Chip key={l.leagueId} label={`${l.label} (${l.season})`} size="small" />
              ))}
            </Box>
          </>
        )}
      </Paper>

      <Alert severity="info" sx={{ mb: 3 }}>
        Markets aren&apos;t open yet. Matchup odds and wagering are the next step — this page
        currently just holds your account and balance.
      </Alert>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>History</Typography>
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
      </Paper>
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
