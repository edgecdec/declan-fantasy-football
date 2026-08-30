"use client";
/**
 * The board your own seat drafts from, plus an identity for it so changing sets re-simulates.
 *
 * Shared by the per-manager and per-player views: if they derived it independently they could
 * disagree about which board was in play, and then the availability numbers would describe a
 * different draft from the odds sitting beside them.
 *
 * See services/sim/myBoard.ts for why the set contributes ORDER only, and why positional
 * scarcity is left to the engine's VORP tilt rather than recomputed here.
 */
import * as React from "react";
import { Artifact } from "@/services/sim/engine";
import { buildMyBoard } from "@/services/sim/myBoard";

export function useMyBoard(
  players: { player_id: string }[],
  artifact: Artifact | null,
  idx: Map<string, number> | null,
  /** false = draft consensus ADP even though a ranking set is selected. Lets a caller show
   *  the same league both ways, which is the only way to see what a board is actually worth. */
  enabled = true,
) {
  return React.useMemo(() => {
    const board = enabled && artifact && idx
      ? buildMyBoard(players, idx, artifact.players.sleeperId.length)
      : null;
    return {
      rankOverride: board?.rank ?? null,
      fingerprint: board?.fingerprint ?? "adp",
      matched: board?.matched ?? 0,
    };
  }, [players, artifact, idx, enabled]);
}
