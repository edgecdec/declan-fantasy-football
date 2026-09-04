'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Container, Paper, Box, Typography, TextField, Button, Alert, LinearProgress,
} from '@mui/material';
import PageHeader from '@/components/common/PageHeader';
import { formatCents, START_BALANCE_CENTS } from '@/lib/betting/constants';

const MIN_PASSWORD_LENGTH = 8;

function SetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [checking, setChecking] = React.useState(true);
  const [displayName, setDisplayName] = React.useState('');
  const [tokenError, setTokenError] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!token) {
      setTokenError('No setup token in this link.');
      setChecking(false);
      return;
    }
    let mounted = true;
    fetch(`/api/betting/setup?token=${encodeURIComponent(token)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!mounted) return;
        if (!res.ok) setTokenError(data.error ?? 'This setup link is not valid.');
        else setDisplayName(data.displayName ?? data.username ?? '');
      })
      .catch(() => mounted && setTokenError('Could not check this setup link.'))
      .finally(() => mounted && setChecking(false));
    return () => { mounted = false; };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (password !== confirm) {
      setSubmitError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/betting/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(data.error ?? 'Could not complete setup.');
        return;
      }
      // Setup signs you in, so go straight to the dashboard.
      router.push('/betting');
    } catch {
      setSubmitError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  if (checking) return <LinearProgress />;

  if (tokenError) {
    return (
      <Alert severity="error">
        {tokenError} Ask Declan for a fresh setup link.
      </Alert>
    );
  }

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  return (
    <Paper sx={{ p: 3, maxWidth: 460 }}>
      <Typography variant="h6" gutterBottom>
        Welcome, {displayName}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Set a password to claim your account. You&apos;ll start with{' '}
        <strong>{formatCents(START_BALANCE_CENTS)}</strong> in Declan Dollars. This link only
        works once.
      </Typography>
      <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          helperText={tooShort ? `At least ${MIN_PASSWORD_LENGTH} characters` : ' '}
          error={tooShort}
          size="small"
          fullWidth
        />
        <TextField
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          autoComplete="new-password"
          size="small"
          fullWidth
        />
        {submitError && <Alert severity="error">{submitError}</Alert>}
        <Button
          type="submit"
          variant="contained"
          disabled={busy || password.length < MIN_PASSWORD_LENGTH || !confirm}
        >
          {busy ? 'Setting up…' : 'Claim Account'}
        </Button>
      </Box>
    </Paper>
  );
}

export default function BettingSetupPage() {
  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <PageHeader title="Set Up Your Betting Account" subtitle="One-time account setup." />
      <Suspense fallback={<LinearProgress />}>
        <SetupContent />
      </Suspense>
    </Container>
  );
}
