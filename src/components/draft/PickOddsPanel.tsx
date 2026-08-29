"use client";
/**
 * Bridges the live Sleeper draft onto the simulator, then renders PickOdds.
 *
 * Responsibilities that live here rather than in the engine:
 *  * load the season artifact once and map Sleeper string player_ids -> dense indices;
 *  * work out WHICH SEAT is mine from the picks that have actually happened. Do NOT trust
 *    `draft.draft_order`: in a live 16-team draft it reported the user at slot 1 while his
 *    real picks were #6/#27/#43, i.e. slot 6. Observed picks are authoritative;
 *  * choose the candidate set -- the best available overall plus the best at each position,
 *    which is the coverage that matters at a real pick;
 *  * derive a stable seed from the draft state so a poll that changed nothing returns the
 *    same numbers instead of reshuffling.
 */
import * as React from "react";
import { Alert, Paper, Skeleton, Typography } from "@mui/material";
import { SleeperDraft, SleeperDraftPick } from "@/services/sleeper/sleeperService";
import { Artifact } from "@/services/sim/engine";
import { useDraftOdds } from "@/hooks/useDraftOdds";
import PickOdds from "./PickOdds";

const TOP_OVERALL = 6;
const POSITIONS = ["QB", "RB", "WR", "TE"];

export type PickOddsPanelProps = {
  draft: SleeperDraft | null;
  picks: SleeperDraftPick[];
  currentUserId?: string;
  season?: string;
};

export default function PickOddsPanel({ draft, picks, currentUserId,
                                       season = "2026" }: PickOddsPanelProps) {
  const [artifact, setArtifact] = React.useState<Artifact | null>(null);
  const [loadErr, setLoadErr] = React.useState<string | null>(null);
  const odds = useDraftOdds(artifact);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/sim/season-${season}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((a: Artifact) => { if (!cancelled) setArtifact(a); })
      .catch((e: Error) => { if (!cancelled) setLoadErr(e.message); });
    return () => { cancelled = true; };
  }, [season]);

  // Sleeper id -> dense index
  const idx = React.useMemo(() => {
    if (!artifact) return null;
    const m = new Map<string, number>();
    artifact.players.sleeperId.forEach((sid, i) => m.set(sid, i));
    return m;
  }, [artifact]);

  const plan = React.useMemo(() => {
    if (!artifact || !idx || !draft || !currentUserId) return null;
    const teams = artifact.meta.teams;
    if (draft.settings?.teams && draft.settings.teams !== teams) {
      return { skip: `artifact is ${teams}-team but this draft has ${draft.settings.teams}` };
    }
    // my seat, from picks that really happened
    const mine = picks.filter((p) => p.picked_by === currentUserId);
    let myTeam = -1;
    if (mine.length) {
      const p = mine[0];
      myTeam = ((p.pick_no - 1) % teams);
      // even rounds run right-to-left in a snake
      if (p.round % 2 === 0) myTeam = teams - 1 - myTeam;
      if (draft.settings?.reversal_round && p.round >= draft.settings.reversal_round) {
        myTeam = teams - 1 - myTeam;
      }
    } else if (draft.draft_order && currentUserId in draft.draft_order) {
      // no picks yet, so fall back to draft_order -- but only then, and it is unreliable
      myTeam = (draft.draft_order[currentUserId] as number) - 1;
    }
    if (myTeam < 0 || myTeam >= teams) return { skip: "cannot determine your draft slot" };

    const taken: [number, number][] = [];
    const gone = new Set<number>();
    for (const p of picks) {
      const i = idx.get(p.player_id);
      if (i === undefined) continue;   // outside the artifact's pool; harmless
      taken.push([p.pick_no, i]);
      gone.add(i);
    }
    // candidates: best available overall, plus the best still available at each position
    const byAdp = artifact.players.adpRank
      .map((_r, i) => i)
      .filter((i) => !gone.has(i))
      .sort((a, b) => artifact.players.adpRank[a] - artifact.players.adpRank[b]);
    const cands: number[] = [];
    for (const i of byAdp.slice(0, TOP_OVERALL)) cands.push(i);
    for (const pos of POSITIONS) {
      const first = byAdp.find((i) => artifact.players.pos[i] === pos && !cands.includes(i));
      if (first !== undefined) cands.push(first);
    }
    // stable seed: same draft state -> same odds, so a 15s poll does not reshuffle
    const seedBase = `${draft.draft_id}|${picks.length}|${myTeam}`;
    return { myTeam, taken, candidates: cands, seedBase,
             reversalRound: draft.settings?.reversal_round ?? 0 };
  }, [artifact, idx, draft, picks, currentUserId]);

  React.useEffect(() => {
    if (!plan || "skip" in plan) return;
    void odds.run({
      myTeam: plan.myTeam, taken: plan.taken, candidates: plan.candidates,
      seedBase: plan.seedBase, reversalRound: plan.reversalRound,
    });
    // re-run only when the draft state actually changes
  }, [plan?.seedBase]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (loadErr) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        Pick odds unavailable: no simulation artifact for {season} ({loadErr}). Generate one
        with <code>scripts/build_web_artifact.py --year {season}</code>.
      </Alert>
    );
  }
  if (!artifact) {
    return <Paper sx={{ p: 2, mt: 2 }}><Skeleton height={28} width={220} />
      <Skeleton height={120} /></Paper>;
  }
  if (plan && "skip" in plan) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        Pick odds unavailable: {plan.skip}.
      </Alert>
    );
  }
  return (
    <div style={{ marginTop: 16 }}>
      <PickOdds artifact={artifact} {...odds} />
      <Typography variant="caption" color="text.secondary"
                  sx={{ display: "block", mt: 1 }}>
        Simulated in your browser from {artifact.meta.season} data — nothing is sent to a
        server. Outcomes are sampled from comparable historical player-seasons, so these are
        probabilities, not predictions.
      </Typography>
    </div>
  );
}
