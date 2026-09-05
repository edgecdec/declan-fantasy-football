'use client';
/**
 * /draft-assistant/<leagueId>/predictions -- the odds, full width, with room to read them.
 *
 * The draft board page shows odds in a side tab where vertical space is scarce. This route is
 * the same simulation given the whole viewport, plus one thing the board page cannot offer: a
 * BOARD toggle. Every manager always drafts consensus Sleeper ADP; the toggle controls only
 * what YOUR seat drafts -- ADP like everyone else, or the ranking set selected here. Flipping
 * it re-runs the simulation, so the difference between the two numbers is what following your
 * own board is actually worth in this league, measured rather than assumed.
 *
 * Availability never changes with the toggle: the other nine seats are on ADP either way, so
 * how often a player reaches your pick is a property of the market, not of your board.
 */

import * as React from 'react';
import { useParams } from 'next/navigation';
import {
  Alert, Box, Chip, Container, LinearProgress, Paper, Stack, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import Link from 'next/link';
import PageHeader from '@/components/common/PageHeader';
import RankingsSelector from '@/components/draft/RankingsSelector';
import WinningOdds from '@/components/draft/WinningOdds';
import PlayerOdds from '@/components/draft/PlayerOdds';
import useValuedPlayers from '@/hooks/useValuedPlayers';
import { useCustomRankings } from '@/context/CustomRankingsContext';
import { useUser } from '@/context/UserContext';
import {
  SleeperService, SleeperDraft, SleeperDraftPick, SleeperTradedPick,
} from '@/services/sleeper/sleeperService';
import { compareDraftsBySchedule } from '@/services/draft/draftSchedule';

/** Fallback settings for useValuedPlayers before the draft object arrives. Mirrors the
 *  board page so the two routes value players identically while loading. */
const PLACEHOLDER = {
  settings: {
    slots_qb: 1, slots_rb: 2, slots_wr: 2, slots_te: 1, slots_k: 1, slots_def: 1,
    slots_bn: 6, slots_flex: 2, rounds: 16, teams: 10, pick_time: 0,
  },
} as unknown as SleeperDraft;

export default function PredictionsPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { user } = useUser();
  const { activePlayers, activeName } = useCustomRankings();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<SleeperDraft | null>(null);
  const [picks, setPicks] = React.useState<SleeperDraftPick[]>([]);
  const [rosterOwnerMap, setRosterOwnerMap] = React.useState<Map<number, string>>(new Map());
  const [rosterIdToOwnerIdMap, setRosterIdToOwnerIdMap] =
    React.useState<Map<number, string>>(new Map());
  const [tradedPicks, setTradedPicks] = React.useState<SleeperTradedPick[]>([]);
  const [boardSource, setBoardSource] = React.useState<'rankings' | 'adp'>('rankings');

  const valuedPlayers = useValuedPlayers(activePlayers, draft ?? PLACEHOLDER);

  // NOTE: this loader duplicates the board page's. Left duplicated deliberately rather than
  // extracted mid-draft-season -- that page is in live use and a shared-hook refactor there is
  // a change worth making on its own, not as a side effect of adding a route.
  React.useEffect(() => {
    if (!leagueId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [drafts, rosters, leagueUsers] = await Promise.all([
          SleeperService.getLeagueDrafts(leagueId),
          SleeperService.getRosters(leagueId),
          SleeperService.getLeagueUsers(leagueId),
        ]);
        if (cancelled) return;
        const best = [...drafts].sort((a, b) =>
          compareDraftsBySchedule(a, b))[0];
        if (!best) { setError('No drafts found for this league.'); setLoading(false); return; }

        const [full, fetchedPicks, traded] = await Promise.all([
          SleeperService.getDraft(best.draft_id),
          SleeperService.getDraftPicks(best.draft_id),
          SleeperService.getDraftTradedPicks(best.draft_id),
        ]);
        if (cancelled) return;
        setDraft(full || best);
        setPicks(fetchedPicks);
        setTradedPicks(traded);

        const names = new Map<string, string>();
        for (const u of leagueUsers) names.set(u.user_id, u.display_name || u.username);
        const owners = new Map<number, string>();
        const ownerIds = new Map<number, string>();
        for (const r of rosters) {
          owners.set(r.roster_id, names.get(r.owner_id) || `Team ${r.roster_id}`);
          if (r.owner_id) ownerIds.set(r.roster_id, r.owner_id);
        }
        setRosterOwnerMap(owners);
        setRosterIdToOwnerIdMap(ownerIds);
      } catch (e) {
        if (!cancelled) setError('Failed to load draft data.');
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId]);

  // Same 15s cadence as the board page, and the same reason for depending on id+status rather
  // than the object: setDraft hands back a new reference every poll.
  React.useEffect(() => {
    if (!draft || draft.status === 'complete') return;
    let cancelled = false;
    const t = setInterval(async () => {
      try {
        const [d, p, tp] = await Promise.all([
          SleeperService.getDraft(draft.draft_id, { skipCache: true }),
          SleeperService.getDraftPicks(draft.draft_id),
          SleeperService.getDraftTradedPicks(draft.draft_id, { skipCache: true }),
        ]);
        if (cancelled) return;
        if (d) setDraft(d);
        setPicks(p);
        setTradedPicks(tp);
      } catch (e) { console.error(e); }
    }, 15000);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.draft_id, draft?.status]);

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <PageHeader title="Predictions" subtitle="Loading draft…" />
        <LinearProgress />
      </Container>
    );
  }
  if (error || !draft) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <PageHeader title="Predictions" subtitle="Live win probabilities" />
        <Alert severity="error" sx={{ mt: 2 }}>{error ?? 'Draft not found.'}</Alert>
        <Box sx={{ mt: 2 }}>
          <Link href={`/draft-assistant/${leagueId}`}>← Back to the draft board</Link>
        </Box>
      </Container>
    );
  }

  const usingAdp = boardSource === 'adp';
  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 6 }}>
      <PageHeader title="Predictions"
                  subtitle={`Live win probabilities — ${picks.length} picks in`} />

      <Paper sx={{ p: 2, mt: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap"
               useFlexGap sx={{ rowGap: 1.5 }}>
          <Box>
            <Typography variant="caption" color="text.secondary"
                        sx={{ display: 'block', mb: 0.5 }}>
              Rankings
            </Typography>
            <RankingsSelector />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary"
                        sx={{ display: 'block', mb: 0.5 }}>
              Your seat drafts
            </Typography>
            <ToggleButtonGroup size="small" exclusive value={boardSource}
              onChange={(_e, v: 'rankings' | 'adp' | null) => v && setBoardSource(v)}>
              <Tooltip title="Your seat follows the ranking set selected here. The other managers still draft consensus ADP.">
                <ToggleButton value="rankings" sx={{ py: 0.4, px: 1.2, fontSize: '0.75rem' }}>
                  {activeName || 'Selected rankings'}
                </ToggleButton>
              </Tooltip>
              <Tooltip title="Every seat including yours drafts consensus Sleeper ADP — the baseline your board has to beat.">
                <ToggleButton value="adp" sx={{ py: 0.4, px: 1.2, fontSize: '0.75rem' }}>
                  Sleeper ADP
                </ToggleButton>
              </Tooltip>
            </ToggleButtonGroup>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip size="small" variant="outlined" label={draft.status.replace('_', ' ')} />
            <Chip size="small" variant="outlined"
                  label={`${draft.settings?.teams ?? '?'} teams`} />
            <Link href={`/draft-assistant/${leagueId}`}>← Draft board</Link>
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {usingAdp
            ? 'Every seat is drafting consensus Sleeper ADP, including yours. This is the baseline — switch back to compare what your board is worth.'
            : 'Your seat drafts the selected rankings; the other managers draft consensus Sleeper ADP. Positional scarcity is applied from this league’s own replacement levels.'}
          {' '}Everything runs in your browser, and re-runs when picks land or the board changes.
        </Typography>
      </Paper>

      <Box sx={{ mt: 2 }}>
        <WinningOdds draft={draft} picks={picks} valuedPlayers={valuedPlayers}
                     rosterOwnerMap={rosterOwnerMap}
                     rosterIdToOwnerIdMap={rosterIdToOwnerIdMap}
                     currentUserId={user?.user_id} boardSource={boardSource}
                     tradedPicks={tradedPicks} />
      </Box>
      <PlayerOdds draft={draft} picks={picks} valuedPlayers={valuedPlayers}
                  currentUserId={user?.user_id} boardSource={boardSource}
                  tradedPicks={tradedPicks} />
    </Container>
  );
}
