"use client";
/**
 * "Winning Odds" tab: every manager's live championship odds, and how the last pick moved
 * them.
 *
 * The remaining draft is simulated down the RANKING SET the user has selected in this
 * panel, so switching rankings changes who the bots take and therefore the odds. Outcomes
 * are sampled from comparable historical player-seasons, so these are probabilities rather
 * than predictions.
 */
import * as React from "react";
import {
  Alert, Box, Button, Chip, LinearProgress, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography,
} from "@mui/material";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { SleeperDraft, SleeperDraftPick } from "@/services/sleeper/sleeperService";
import { Player } from "@/services/draft/vbdService";
import { useSimArtifact, inferSeat, buildRankOverride } from "@/hooks/useSimArtifact";
import { useLeagueOdds, LEAGUE_REFINE_SIMS } from "@/hooks/useLeagueOdds";

type Props = {
  draft: SleeperDraft;
  picks: SleeperDraftPick[];
  valuedPlayers: Player[];
  rosterOwnerMap: Map<number, string>;
  rosterIdToOwnerIdMap: Map<number, string>;
  currentUserId?: string;
};

export default function WinningOdds({
  draft, picks, valuedPlayers, rosterOwnerMap, rosterIdToOwnerIdMap, currentUserId,
}: Props) {
  const season = draft.season ?? "2026";
  const { artifact, idx, error: artErr, loading } = useSimArtifact(season);
  const { odds, prev, sims, provisional, running, error, run } = useLeagueOdds(artifact);
  const [started, setStarted] = React.useState(false);
  React.useEffect(() => { if (draft.status === "drafting") setStarted(true); },
                  [draft.status]);

  const teams = artifact?.meta.teams ?? draft.settings?.teams ?? 0;
  const mismatch = artifact && draft.settings?.teams &&
    draft.settings.teams !== artifact.meta.teams
    ? `simulation data is for a ${artifact.meta.teams}-team league but this draft has ${draft.settings.teams}`
    : null;

  /** Draft order taken from the selected ranking set, so the bots draft that board.
   *  Shared with PlayerOdds so the two views cannot disagree about the board. */
  const rankOverride = React.useMemo(
    () => buildRankOverride(valuedPlayers, idx, artifact?.players.sleeperId.length ?? 0),
    [valuedPlayers, idx, artifact]);

  const plan = React.useMemo(() => {
    if (!artifact || !idx || mismatch) return null;
    const taken: [number, number][] = [];
    for (const p of picks) {
      const i = idx.get(p.player_id);
      if (i !== undefined) taken.push([p.pick_no, i]);
    }
    const seat = inferSeat(teams, picks, currentUserId, draft.draft_order,
                           draft.settings?.reversal_round ?? 0);
    return {
      taken, myTeam: seat >= 0 ? seat : undefined,
      reversalRound: draft.settings?.reversal_round ?? 0,
      seedBase: `${draft.draft_id}|${picks.length}|${rankOverride ? "ranked" : "adp"}`,
    };
  }, [artifact, idx, picks, teams, currentUserId, draft, mismatch, rankOverride]);

  React.useEffect(() => {
    if (!started || !plan) return;
    void run({ ...plan, rankOverride }, picks.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.seedBase, started]);

  const refine = React.useCallback(() => {
    if (plan) void run({ ...plan, rankOverride }, picks.length, LEAGUE_REFINE_SIMS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, rankOverride, picks.length]);

  const nameFor = (t: number) => {
    // seat -> roster_id -> owner. slot_to_roster_id is keyed by 1-indexed slot.
    const rosterId = draft.slot_to_roster_id?.[String(t + 1)];
    if (rosterId === undefined) return `Seat ${t + 1}`;
    return rosterOwnerMap.get(rosterId)
      ?? (rosterIdToOwnerIdMap.get(rosterId) === currentUserId ? "You" : `Team ${rosterId}`);
  };
  const isMe = (t: number) => {
    const rosterId = draft.slot_to_roster_id?.[String(t + 1)];
    return rosterId !== undefined &&
      rosterIdToOwnerIdMap.get(rosterId) === currentUserId;
  };

  if (loading) return <LinearProgress />;
  if (artErr) {
    return (
      <Alert severity="info" sx={{ fontSize: "0.8rem" }}>
        No simulation data for {season} yet. Build it with{" "}
        <code>build_web_artifact.py --year {season}</code>.
      </Alert>
    );
  }
  if (mismatch) {
    return <Alert severity="info" sx={{ fontSize: "0.8rem" }}>{mismatch}.</Alert>;
  }
  if (!started) {
    return (
      <Stack spacing={1.5} sx={{ pt: 1 }}>
        <Button variant="contained" size="small" onClick={() => setStarted(true)}>
          Show winning odds
        </Button>
        <Typography variant="caption" color="text.secondary">
          Simulates the rest of the draft, the season and the playoffs to estimate every
          manager&apos;s championship chance. Runs in your browser, so it only starts when
          you ask (or automatically once a draft is live).
        </Typography>
      </Stack>
    );
  }

  const prevBy = new Map(prev.map((o) => [o.team, o]));
  const sorted = [...odds].sort((a, b) => b.title - a.title);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column",
               overflow: "hidden" }}>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
        <Chip size="small" variant="outlined"
              label={`${picks.length} pick${picks.length === 1 ? "" : "s"} in`} />
        {sims > 0 && (
          <Chip size="small" variant="outlined"
                color={provisional ? "warning" : "default"}
                label={provisional ? `${sims} sims…` : `${sims} sims`} />
        )}
        {sims > 0 && !running && sims < LEAGUE_REFINE_SIMS && (
          <Tooltip title={`Re-run with ${LEAGUE_REFINE_SIMS.toLocaleString()} simulations. Roughly halves the error bars; takes several seconds.`}>
            <Button size="small" onClick={refine} sx={{ minWidth: 0, px: 1,
                    fontSize: "0.7rem" }}>
              more sims
            </Button>
          </Tooltip>
        )}
      </Stack>
      {running && <LinearProgress sx={{ mb: 0.5 }} />}
      {error && <Typography variant="caption" color="error">{error}</Typography>}

      <TableContainer sx={{ flexGrow: 1 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontSize: "0.7rem" }}>Manager</TableCell>
              <TableCell align="right" sx={{ fontSize: "0.7rem" }}>
                <Tooltip title="Chance of winning the championship"><span>Title</span></Tooltip>
              </TableCell>
              <TableCell align="right" sx={{ fontSize: "0.7rem" }}>Playoff</TableCell>
              <TableCell align="right" sx={{ fontSize: "0.7rem" }}>
                <Tooltip title="Change since the previous pick"><span>Δ</span></Tooltip>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((o) => {
              const before = prevBy.get(o.team);
              const d = before ? o.title - before.title : null;
              const real = d !== null && Math.abs(d) > 2 * o.titleSe;
              return (
                <TableRow key={o.team} hover
                          sx={{ bgcolor: isMe(o.team) ? "action.selected" : undefined }}>
                  <TableCell sx={{ fontSize: "0.75rem",
                                   fontWeight: isMe(o.team) ? 600 : 400 }}>
                    {nameFor(o.team)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontSize: "0.75rem",
                                                 fontVariantNumeric: "tabular-nums" }}>
                    {o.title.toFixed(1)}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {" ±"}{o.titleSe.toFixed(1)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ fontSize: "0.75rem",
                                                 fontVariantNumeric: "tabular-nums" }}>
                    {o.playoff.toFixed(0)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontSize: "0.75rem",
                                                 fontVariantNumeric: "tabular-nums",
                                                 opacity: real ? 1 : 0.45 }}>
                    {d === null ? "—" : (
                      <Stack direction="row" spacing={0} alignItems="center"
                             justifyContent="flex-end">
                        {d > 0 ? <ArrowDropUpIcon fontSize="small" color="success" />
                               : d < 0 ? <ArrowDropDownIcon fontSize="small" color="error" />
                               : null}
                        {Math.abs(d).toFixed(1)}
                      </Stack>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
        Simulated in your browser down the ranking set selected above. Faint Δ values are
        smaller than the simulation&apos;s own error, so treat them as unchanged. Before any
        picks every manager sits near {(100 / Math.max(teams, 1)).toFixed(0)}% by
        construction — differences appear as the rosters actually diverge.
      </Typography>
    </Box>
  );
}
