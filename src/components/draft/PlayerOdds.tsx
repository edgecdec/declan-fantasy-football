"use client";
/**
 * "If you take this player, what happens to your odds?" -- the full-width panel below the
 * draft board.
 *
 * TWO NUMBERS, AND THE SECOND ONE MATTERS
 *  * Odds are CONDITIONAL on getting the player: the simulation reserves him at your pick,
 *    so the question asked is always "given he is there, is he the right call".
 *  * Availability is the other half. Measured on the UNFORCED draft, it is the chance he
 *    actually reaches you. On an empty 10-team board from seat 5 the #1 and #2 overall come
 *    back at 0% -- a big edge you never get to use is not a plan, so those are not
 *    simulated at all.
 *
 * Candidates: the top 20 overall plus the top 3 at each position, per Declan.
 */
import * as React from "react";
import {
  Alert, Box, Button, Chip, LinearProgress, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TableSortLabel, ToggleButton, ToggleButtonGroup,
  Tooltip, Typography,
} from "@mui/material";
import { SleeperDraft, SleeperDraftPick } from "@/services/sleeper/sleeperService";
import { Player } from "@/services/draft/vbdService";
import { getPositionColor } from "@/constants/colors";
import { useSimArtifact, inferSeat } from "@/hooks/useSimArtifact";
import { useMyBoard } from "@/hooks/useMyBoard";
import { useDraftOdds, PLAYER_MAX_SIMS } from "@/hooks/useDraftOdds";
import useTableSort from "@/hooks/useTableSort";

const TOP_OVERALL = 20;
const TOP_PER_POS = 3;
// K and DEF included deliberately. Taking one early is a bad idea and the simulation says
// so numerically, which is more useful than hiding the option -- and late in a draft they
// are exactly the decision left.
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

type Props = {
  draft: SleeperDraft | null;
  picks: SleeperDraftPick[];
  valuedPlayers: Player[];
  currentUserId?: string;
  /** "adp" ignores the selected ranking set and drafts consensus ADP from your
   *  seat too, so the two boards can be compared side by side. */
  boardSource?: "rankings" | "adp";
};

export default function PlayerOdds({ draft, picks, valuedPlayers, currentUserId,
                                    boardSource }: Props) {
  const [posFilter, setPosFilter] = React.useState("ALL");
  const season = draft?.season ?? "2026";
  const { artifact, idx, error: artErr } = useSimArtifact(season);
  const odds = useDraftOdds(artifact);
  const [started, setStarted] = React.useState(false);
  React.useEffect(() => { if (draft?.status === "drafting") setStarted(true); },
                  [draft?.status]);

  const teams = artifact?.meta.teams ?? draft?.settings?.teams ?? 0;
  const mismatch = artifact && draft?.settings?.teams &&
    draft.settings.teams !== artifact.meta.teams
    ? `simulation data is for a ${artifact.meta.teams}-team league but this draft has ${draft.settings.teams}`
    : null;

  /** MY seat's board: the selected set re-ranked by value over positional replacement.
   *  The other managers keep drafting consensus ADP. */
  const { rankOverride, fingerprint } =
    useMyBoard(valuedPlayers, artifact, idx, boardSource !== "adp");

  const plan = React.useMemo(() => {
    if (!artifact || !idx || !draft || mismatch) return null;
    const seat = inferSeat(teams, picks, currentUserId, draft.draft_order,
                           draft.settings?.reversal_round ?? 0);
    if (seat < 0) return null;
    const taken: [number, number][] = [];
    const gone = new Set<number>();
    for (const p of picks) {
      const i = idx.get(p.player_id);
      if (i === undefined) continue;
      taken.push([p.pick_no, i]);
      gone.add(i);
    }
    // Candidate order comes from the ranking set selected in the side panel, so this
    // answers "of the players my board likes, which is the right pick".
    const ranked: number[] = [];
    for (const p of valuedPlayers) {
      const i = idx.get(p.player_id);
      if (i !== undefined && !gone.has(i)) ranked.push(i);
    }
    const pool = ranked.length > 30 ? ranked
      : artifact.players.adpRank.map((_r, i) => i).filter((i) => !gone.has(i))
          .sort((a, b) => artifact.players.adpRank[a] - artifact.players.adpRank[b]);
    const cands: number[] = [];
    const seen = new Set<number>();
    for (const i of pool.slice(0, TOP_OVERALL)) { cands.push(i); seen.add(i); }
    for (const pos of POSITIONS) {
      let n = 0;
      for (const i of pool) {
        if (n >= TOP_PER_POS) break;
        if (artifact.players.pos[i] === pos && !seen.has(i)) {
          cands.push(i); seen.add(i); n++;
        }
      }
    }
    return {
      myTeam: seat, taken, candidates: cands, rankOverride,
      reversalRound: draft.settings?.reversal_round ?? 0,
      seedBase: `${draft.draft_id}|${picks.length}|${fingerprint}`,
    };
  }, [artifact, idx, draft, picks, teams, currentUserId, mismatch, valuedPlayers,
      rankOverride, fingerprint]);

  React.useEffect(() => {
    if (!started || !plan) return;
    void odds.run(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.seedBase, started]);

  // The sort hook compares plain properties, so flatten name/pos/rank onto each row rather
  // than looking them up during render.
  // MUST run before any early return: hooks have to be called unconditionally and in the
  // same order every render, and this component returns early while loading / before the
  // user starts. Calling useTableSort below those returns changed the hook count between
  // renders, which React aborts with "rendered fewer hooks than expected".
  const rows = artifact ? odds.results.map((r) => ({
    ...r,
    name: artifact.players.name[r.pid],
    pos: artifact.players.pos[r.pid],
    rank: (rankOverride?.[r.pid] || artifact.players.adpRank[r.pid]) || 9999,
  })) : [];
  const filtered = posFilter === "ALL" ? rows : rows.filter((r) => r.pos === posFilter);
  // Default: strongest playoff odds first, which is the question the panel answers.
  const { sorted, order, orderBy, handleSort } = useTableSort(filtered, "playoff", "desc");


  if (!draft || artErr || mismatch) return null;   // the tab already explains why
  if (!artifact) return null;
  const P = artifact.players;

  if (!started) {
    return (
      <Paper sx={{ p: 2, mt: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <Button variant="contained" onClick={() => setStarted(true)}>
            Estimate odds per player
          </Button>
          <Typography variant="body2" color="text.secondary">
            For the top {TOP_OVERALL} available plus the top {TOP_PER_POS} at each of
            {POSITIONS.join(", ")}:
            your championship odds if you take that player, and how often he actually
            reaches your pick. Runs in your browser.
          </Typography>
        </Stack>
      </Paper>
    );
  }

  const leader = odds.results[0];
  const COLS: { id: string; label: string; num: boolean; tip?: string }[] = [
    { id: "name", label: "Player", num: false },
    { id: "rank", label: rankOverride ? "Your rank" : "ADP", num: true,
      tip: rankOverride
        ? "Rank on your board — the order YOU draft. Other managers still draft consensus ADP."
        : "Market ADP rank" },
    { id: "title", label: "Title %", num: true,
      tip: "Chance you win the championship, with its own standard error. Winning a title is a "
        + "much rarer event than making the playoffs, so this column is far noisier in relative "
        + "terms — gaps smaller than roughly twice the ± are not a ranking." },
    { id: "playoff", label: "Playoff %", num: true },
    { id: "vsBest", label: "vs best", num: true,
      tip: "Difference from the top option, with its paired standard error" },
    { id: "availability", label: "Available", num: true,
      tip: "Chance he is still on the board at your pick" },
  ];
  return (
    <Paper sx={{ p: 2, mt: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 600 }}>
          Odds if you take…
        </Typography>
        {odds.nextPick > 0 &&
          <Chip size="small" variant="outlined" label={`your pick #${odds.nextPick}`} />}
        {odds.sims > 0 && (
          <Chip size="small" variant="outlined"
                color={!odds.settled ? "error" : odds.provisional ? "warning" : "default"}
                label={!odds.settled
                  ? `${odds.sims.toLocaleString()} sims — too few to rank`
                  : odds.provisional
                    ? `${odds.sims.toLocaleString()} sims, refining…`
                    : `${odds.sims.toLocaleString()} sims`} />
        )}
        {odds.unreachable.length > 0 && (
          <Tooltip title={`Not simulated -- they reach pick #${odds.nextPick} less than 2% of the time: `
            + odds.unreachable.map((u) => P.name[u.pid]).join(", ")}>
            <Chip size="small" variant="outlined"
                  label={`${odds.unreachable.length} out of reach`} />
          </Tooltip>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Odds assume you get the player. <b>Available</b> is how often he actually lasts to
        your pick — a big edge you rarely get to use is not a plan.
        {rankOverride
          ? " Your seat drafts the board selected above; the other managers draft consensus ADP, which is what availability reflects."
          : " Select or upload a ranking set to have your seat draft it instead of market ADP."}
      </Typography>
      <ToggleButtonGroup value={posFilter} exclusive size="small" sx={{ mb: 1.5 }}
        onChange={(_e, v: string | null) => v && setPosFilter(v)}>
        {["ALL", ...POSITIONS].map((pp) => (
          <ToggleButton key={pp} value={pp} sx={{ py: 0.25, px: 1, fontSize: "0.72rem",
            color: pp === "ALL" ? undefined : getPositionColor(pp) }}>{pp}</ToggleButton>
        ))}
      </ToggleButtonGroup>
      {odds.running && <LinearProgress sx={{ mb: 1.5 }} />}
      {odds.sims > 0 && !odds.settled && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          First pass at {odds.sims.toLocaleString()} sims — the <b>order is not reliable yet</b>
          {" "}and will change. Still simulating up to {PLAYER_MAX_SIMS.toLocaleString()}.
        </Alert>
      )}
      {odds.error && <Alert severity="warning" sx={{ mb: 1 }}>{odds.error}</Alert>}

      <TableContainer sx={{ maxHeight: 460 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {COLS.map((c) => (
                <TableCell key={c.id} align={c.num ? "right" : "left"}
                           sortDirection={orderBy === c.id ? order : false}>
                  <Tooltip title={c.tip ?? ""} disableHoverListener={!c.tip}>
                    <TableSortLabel active={orderBy === c.id}
                                    direction={orderBy === c.id ? order : "desc"}
                                    onClick={() => handleSort(c.id)}>
                      {c.label}
                    </TableSortLabel>
                  </Tooltip>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((r) => {
              const isLeader = leader && r.pid === leader.pid;
              const muted = !isLeader && !r.distinguishable;
              return (
                <TableRow key={r.pid} hover>
                  <TableCell sx={{ opacity: muted ? 0.6 : 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box sx={{ width: 5, height: 18, borderRadius: 0.5,
                                 bgcolor: getPositionColor(r.pos) }} />
                      <span>{r.name}</span>
                      <Typography component="span" variant="caption"
                                  color="text.secondary">{r.pos}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={{ opacity: muted ? 0.6 : 1 }}>
                    {r.rank >= 9999 ? "—" : r.rank}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums",
                                                 opacity: muted ? 0.6 : 1 }}>
                    {r.title.toFixed(1)}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {" ±"}{r.titleSe.toFixed(1)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums",
                                                 opacity: muted ? 0.6 : 1 }}>
                    {r.playoff.toFixed(1)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums",
                                                 opacity: muted ? 0.5 : 1 }}>
                    {isLeader ? <Chip size="small" label="best" color="primary"
                                      variant="outlined" />
                      : <>{r.vsBest.toFixed(1)}
                          <Typography component="span" variant="caption"
                                      color="text.secondary">
                            {" ±"}{r.vsBestSe.toFixed(1)}
                          </Typography></>}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums",
                    color: r.availability < 25 ? "warning.main" : undefined,
                    fontWeight: r.availability < 25 ? 600 : 400 }}>
                    {r.availability.toFixed(0)}%
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {odds.results.length > 0 && (
        <Typography variant="caption" color="text.secondary"
                    sx={{ display: "block", mt: 1.5 }}>
          Faint rows are within {odds.noiseFloor.toFixed(1)}pp of the best option — this
          run&apos;s noise floor — so treat them as equally good. Amber availability means
          he often will not be there; plan a fallback.
        </Typography>
      )}
    </Paper>
  );
}
