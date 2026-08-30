"use client";
/**
 * Live championship odds for every manager, recomputed as picks land.
 *
 * Keeps the PREVIOUS pick's odds so the UI can show how each manager's chances moved on
 * the last pick -- which is the thing that makes this interesting to watch during a draft.
 *
 * Sims are split across a Web Worker pool by sim RANGE. The seed is derived from the draft
 * state, so a poll that changed nothing returns identical numbers rather than jittering.
 */
import * as React from "react";
import { Artifact } from "@/services/sim/engine";
import {
  LeagueOddsRequest, LeagueSlice, TeamOdds, aggregateLeague,
} from "@/services/sim/leagueOdds";

export const LEAGUE_QUICK_SIMS = 300;
export const LEAGUE_FULL_SIMS = 2000;

export type LeagueOddsState = {
  odds: TeamOdds[];
  /** odds as of the previous pick, for deltas; empty until a pick has landed */
  prev: TeamOdds[];
  sims: number;
  provisional: boolean;
  running: boolean;
  error: string | null;
};

const EMPTY: LeagueOddsState = {
  odds: [], prev: [], sims: 0, provisional: false, running: false, error: null,
};

export function useLeagueOdds(artifact: Artifact | null) {
  const [state, setState] = React.useState<LeagueOddsState>(EMPTY);
  const pool = React.useRef<Worker[]>([]);
  const jobRef = React.useRef(0);
  // last SETTLED (non-provisional) odds and the pick count they were computed at
  const settled = React.useRef<{ picks: number; odds: TeamOdds[] } | null>(null);

  React.useEffect(() => {
    if (!artifact || typeof window === "undefined") return;
    const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    const ws: Worker[] = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("../services/sim/simWorker.ts", import.meta.url),
                           { type: "module" });
      w.postMessage({ kind: "artifact", artifact });
      ws.push(w);
    }
    pool.current = ws;
    return () => { ws.forEach((w) => w.terminate()); pool.current = []; };
  }, [artifact]);

  const run = React.useCallback(async (
    req: Omit<LeagueOddsRequest, "sims">, pickCount: number,
  ) => {
    if (!artifact || !pool.current.length) return;
    const myJob = ++jobRef.current;
    setState((s) => ({ ...s, running: true, error: null }));

    const pass = async (sims: number, provisional: boolean) => {
      const ws = pool.current;
      const per = Math.ceil(sims / ws.length);
      const jobs = ws.map((w, i) => {
        const offset = i * per;
        const count = Math.min(per, sims - offset);
        if (count <= 0) return Promise.resolve(null);
        return new Promise<LeagueSlice | null>((resolve) => {
          const onMsg = (e: MessageEvent) => {
            const m = e.data;
            if (m.jobId !== myJob) return;
            w.removeEventListener("message", onMsg);
            resolve(m.kind === "leagueSlice" ? (m.slice as LeagueSlice) : null);
          };
          w.addEventListener("message", onMsg);
          w.postMessage({
            kind: "leagueJob", jobId: myJob, simOffset: offset,
            req: {
              ...req, sims: count,
              // typed arrays do not survive structured clone into a plain field here
              rankOverride: req.rankOverride ? Array.from(req.rankOverride) : null,
            },
          });
        });
      });
      const slices = (await Promise.all(jobs))
        .filter((s): s is LeagueSlice => s !== null);
      if (jobRef.current !== myJob) return;
      if (!slices.length) {
        setState((s) => ({ ...s, running: false, error: "all workers failed" }));
        return;
      }
      const odds = aggregateLeague(artifact.meta.teams, slices);
      const prev = settled.current && settled.current.picks !== pickCount
        ? settled.current.odds : [];
      setState({ odds, prev, sims: odds[0]?.n ?? 0, provisional,
                 running: provisional, error: null });
      if (!provisional) settled.current = { picks: pickCount, odds };
    };

    await pass(LEAGUE_QUICK_SIMS, true);
    if (jobRef.current === myJob) await pass(LEAGUE_FULL_SIMS, false);
  }, [artifact]);

  return { ...state, run };
}
