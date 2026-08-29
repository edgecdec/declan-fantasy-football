"use client";
/**
 * Runs draft-odds simulations in a pool of Web Workers and streams results back.
 *
 * PROGRESSIVE, IN TWO SENSES
 *  1. A quick pass (QUICK_SIMS) lands fast so something is on screen, then the full pass
 *     (DEFAULT_SIMS) replaces it. The quick pass is flagged `provisional` -- at 400 sims
 *     the ordering is genuinely not reproducible (measured Spearman between two seeds:
 *     -0.12 at 200 sims, +0.25 at 600, +0.95 at 3000), so the UI must not present it as
 *     settled.
 *  2. Sims are split across workers by RANGE, so every candidate always has the same sim
 *     count. Splitting by candidate instead would let a 3000-sim candidate be compared
 *     against a 400-sim one, which is invalid.
 *
 * The seed is derived from the draft state, so re-running after a 15s poll that changed
 * nothing returns identical numbers instead of jittering.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Artifact } from "@/services/sim/engine";
import {
  CandidateResult, DEFAULT_SIMS, QUICK_SIMS, OddsRequest, Slice, aggregate,
} from "@/services/sim/candidateOdds";

export type OddsState = {
  results: CandidateResult[];
  nextPick: number;
  noiseFloor: number;
  sims: number;
  provisional: boolean;
  running: boolean;
  error: string | null;
};

const EMPTY: OddsState = {
  results: [], nextPick: -1, noiseFloor: 0, sims: 0,
  provisional: false, running: false, error: null,
};

export function useDraftOdds(artifact: Artifact | null) {
  const [state, setState] = useState<OddsState>(EMPTY);
  const pool = useRef<Worker[]>([]);
  const jobRef = useRef(0);

  useEffect(() => {
    if (!artifact || typeof window === "undefined") return;
    const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    const workers: Worker[] = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("../services/sim/simWorker.ts", import.meta.url),
                           { type: "module" });
      w.postMessage({ kind: "artifact", artifact });
      workers.push(w);
    }
    pool.current = workers;
    return () => { workers.forEach((w) => w.terminate()); pool.current = []; };
  }, [artifact]);

  const run = useCallback(async (req: Omit<OddsRequest, "sims">) => {
    if (!artifact || !pool.current.length) return;
    const myJob = ++jobRef.current;
    setState((s) => ({ ...s, running: true, error: null }));

    const pass = async (sims: number, provisional: boolean) => {
      const workers = pool.current;
      const per = Math.ceil(sims / workers.length);
      const jobs = workers.map((w, i) => {
        const offset = i * per;
        const count = Math.min(per, sims - offset);
        if (count <= 0) return Promise.resolve(null);
        return new Promise<Slice | null>((resolve) => {
          const onMsg = (e: MessageEvent) => {
            const m = e.data;
            if (m.jobId !== myJob) return;
            w.removeEventListener("message", onMsg);
            if (m.kind === "slice") resolve(m.slice as Slice);
            else { resolve(null); }
          };
          w.addEventListener("message", onMsg);
          w.postMessage({ kind: "job", jobId: myJob,
                          req: { ...req, sims: count }, simOffset: offset });
        });
      });
      const slices = (await Promise.all(jobs)).filter((s): s is Slice => s !== null);
      if (jobRef.current !== myJob) return;               // a newer request superseded us
      if (!slices.length) {
        setState((s) => ({ ...s, running: false, error: "all workers failed" }));
        return;
      }
      const agg = aggregate(req.candidates, slices);
      setState({ ...agg, sims: agg.results[0]?.n ?? 0, provisional,
                 running: provisional, error: null });
    };

    await pass(QUICK_SIMS, true);
    if (jobRef.current === myJob) await pass(DEFAULT_SIMS, false);
  }, [artifact]);

  return { ...state, run };
}
