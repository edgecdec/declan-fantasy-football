"use client";
/**
 * "If I take this player, what happens to my odds?" -- a ranked list of candidates.
 *
 * Presentation rules that follow from what the simulation can actually resolve:
 *  * Ranked individually. An earlier version bucketed candidates into tiers; at realistic
 *    sim counts every candidate fell into one tier, which is the same as refusing to
 *    answer.
 *  * Every row shows +/- its paired standard error, and rows whose gap to the leader is
 *    inside 2 SE are MUTED. That is the honest way to show "these two are the same" while
 *    still giving an ordering.
 *  * The provisional (fast) pass is labelled as such. At 400 sims the ordering does not
 *    reproduce across seeds, so presenting it as settled would be wrong.
 */
import * as React from "react";
import {
  Box, Chip, LinearProgress, Paper, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, Tooltip, Typography,
} from "@mui/material";
import { Artifact } from "@/services/sim/engine";
import { CandidateResult } from "@/services/sim/candidateOdds";

const POS_COLOR: Record<string, string> = {
  QB: "#d95926", RB: "#199e70", WR: "#3987e5", TE: "#c98500",
  K: "#9085e9", DEF: "#8a8981",
};

export type PickOddsProps = {
  artifact: Artifact | null;
  results: CandidateResult[];
  nextPick: number;
  noiseFloor: number;
  sims: number;
  provisional: boolean;
  running: boolean;
  error: string | null;
};

export default function PickOdds({
  artifact, results, nextPick, noiseFloor, sims, provisional, running, error,
}: PickOddsProps) {
  if (!artifact) return null;
  const P = artifact.players;
  const leader = results[0];

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 600 }}>
          Odds by pick
        </Typography>
        {nextPick > 0 && (
          <Chip size="small" label={`your pick #${nextPick}`} variant="outlined" />
        )}
        {sims > 0 && (
          <Chip
            size="small"
            variant="outlined"
            color={provisional ? "warning" : "default"}
            label={provisional ? `${sims} sims — provisional` : `${sims} sims`}
          />
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Each row simulates the rest of the draft, the season and the playoffs with that
        player on your roster. Every candidate faces an identical simulated world, so the
        gaps between them are far more reliable than the absolute numbers.
      </Typography>

      {running && <LinearProgress sx={{ mb: 1.5 }} />}
      {error && (
        <Typography variant="body2" color="error" sx={{ mb: 1 }}>{error}</Typography>
      )}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Player</TableCell>
            <TableCell align="right">ADP</TableCell>
            <TableCell align="right">Playoff&nbsp;%</TableCell>
            <TableCell align="right">Title&nbsp;%</TableCell>
            <TableCell align="right">
              <Tooltip title="Difference from the top option, with its paired standard error. Inside 2 SE means the two are not distinguishable.">
                <span>vs best</span>
              </Tooltip>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {results.map((r) => {
            const isLeader = leader && r.pid === leader.pid;
            const muted = !isLeader && !r.distinguishable;
            return (
              <TableRow key={r.pid} hover>
                <TableCell sx={{ opacity: muted ? 0.55 : 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box sx={{
                      width: 6, height: 18, borderRadius: 0.5,
                      bgcolor: POS_COLOR[P.pos[r.pid]] ?? "#666",
                    }} />
                    <span>{P.name[r.pid]}</span>
                    <Typography component="span" variant="caption" color="text.secondary">
                      {P.pos[r.pid]}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell align="right" sx={{ opacity: muted ? 0.55 : 1 }}>
                  {P.adpRank[r.pid] >= 9999 ? "—" : P.adpRank[r.pid]}
                </TableCell>
                <TableCell align="right" sx={{ opacity: muted ? 0.55 : 1,
                                               fontVariantNumeric: "tabular-nums" }}>
                  {r.playoff.toFixed(1)}
                </TableCell>
                <TableCell align="right" sx={{ opacity: muted ? 0.55 : 1,
                                               fontVariantNumeric: "tabular-nums" }}>
                  {r.title.toFixed(1)}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums",
                                               opacity: muted ? 0.5 : 1 }}>
                  {isLeader ? (
                    <Chip size="small" label="best" color="primary" variant="outlined" />
                  ) : (
                    <Tooltip title={muted ? "inside the noise — same as the top option"
                                          : "gap is larger than the noise"}>
                      <span>
                        {r.vsBest.toFixed(1)}
                        <Typography component="span" variant="caption"
                                    color="text.secondary">
                          {" ±"}{r.vsBestSe.toFixed(1)}
                        </Typography>
                      </span>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {results.length > 0 && (
        <Typography variant="caption" color="text.secondary"
                    sx={{ display: "block", mt: 1.5 }}>
          Greyed rows are within {noiseFloor.toFixed(1)}pp of the top option, which is this
          run&apos;s noise floor — treat them as equally good. Ex-ante, several players
          going at a similar ADP genuinely are interchangeable.
        </Typography>
      )}
    </Paper>
  );
}
