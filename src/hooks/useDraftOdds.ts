"use client";
/**
 * Runs draft-odds simulations in a pool of Web Workers and streams results back.
 *
 * PROGRESSIVE, IN TWO SENSES
 *  1. Results accumulate through the schedule below and repaint at every step, so the panel
 *     is useful immediately and keeps sharpening while the user reads it.
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
  CandidateResult, OddsRequest, Slice, aggregate, probeAvailability,
} from "@/services/sim/candidateOdds";

/**
 * Sims ACCUMULATE in chunks rather than being re-run at a bigger count, so every candidate
 * always shares the same set of sim indices and the paired differences stay valid. Each chunk
 * uses a fresh range of sim offsets, so 10 chunks of 1000 really is 10,000 distinct sims.
 *
 * MEASURED COST, which drives the schedule: 3.14 ms per candidate-sim warm (38 candidates =
 * top 20 overall + top 3 at each of 6 positions). On 8 workers that is ~6s for 400 sims, ~30s
 * for 2000, and ~149s to reach 10,000 -- so during a live draft, where a pick lands every
 * 30-90s and every pick restarts the accumulation, the higher counts are reached between picks
 * or not at all. Sitting on a blank panel for 30s after every pick is worse than seeing a
 * flagged number, so there is a fast PROVISIONAL paint at 400 sims which is explicitly marked
 * unreliable, and FIRST_SHOW is the point at which the table stops being flagged.
 *
 * Why 2000 is that point: below it the ordering is not reproducible between seeds (measured
 * Spearman between two seeds: -0.12 at 200 sims, +0.25 at 600, +0.95 at 3000), so an early
 * table shows a confident-looking ranking that a re-run contradicts.
 *
 * What more sims buy, and what they do not: at 2000 sims a ~63% playoff rate has SE ~1.1pp and
 * a ~11% title rate ~0.70pp; at 10,000 those fall to ~0.48pp and ~0.31pp. But the fold SE
 * (season-to-season heterogeneity) is 1.6-2.9x the binomial SE and does NOT shrink with sims --
 * only with more seasons, of which six are usable. So 10,000 is where extra sims stop being
 * the binding constraint, not where the answer becomes exact.
 */
export const PLAYER_PROVISIONAL_SIMS = 400;
export const PLAYER_CHUNK_SIMS = 1000;
export const PLAYER_FIRST_SHOW = 2000;
export const PLAYER_MAX_SIMS = 10000;

/** Chunk sizes in order: a fast flagged paint, up to FIRST_SHOW, then steady increments. */
function simSchedule(): number[] {
  const out = [PLAYER_PROVISIONAL_SIMS, PLAYER_FIRST_SHOW - PLAYER_PROVISIONAL_SIMS];
  for (let t = PLAYER_FIRST_SHOW; t < PLAYER_MAX_SIMS; t += PLAYER_CHUNK_SIMS) {
    out.push(Math.min(PLAYER_CHUNK_SIMS, PLAYER_MAX_SIMS - t));
  }
  return out;
}
/** Candidates below this chance of reaching your pick are not simulated at all. */
export const MIN_AVAILABILITY = 2;

export type OddsState = {
  results: CandidateResult[];
  /** candidates that were skipped because they will not reach your pick */
  unreachable: { pid: number; availability: number }[];
  nextPick: number;
  noiseFloor: number;
  sims: number;
  /** more sims are still coming */
  provisional: boolean;
  /** enough sims that the ORDER is reproducible; below this the table is flagged */
  settled: boolean;
  running: boolean;
  error: string | null;
};

const EMPTY: OddsState = {
  results: [], unreachable: [], nextPick: -1, noiseFloor: 0, sims: 0,
  provisional: false, settled: false, running: false, error: null,
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

    // Cheap draft-only probe first: drop anyone who will not reach the pick, so no
    // compute is spent answering a question that cannot arise.
    let cands = req.candidates;
    let unreachable: { pid: number; availability: number }[] = [];
    try {
      const av = probeAvailability(artifact, req, 300);
      unreachable = av.filter((a) => a.availability < MIN_AVAILABILITY);
      const drop = new Set(unreachable.map((a) => a.pid));
      const kept = cands.filter((p) => !drop.has(p));
      if (kept.length) cands = kept;
    } catch { /* probe is an optimisation; fall through with the full list */ }
    if (jobRef.current !== myJob) return;

    /** Run `sims` more simulations starting at sim index `base`, split across the pool. */
    const chunk = async (base: number, sims: number) => {
      const workers = pool.current;
      const per = Math.ceil(sims / workers.length);
      const jobs = workers.map((w, i) => {
        const offset = base + i * per;
        const count = Math.min(per, base + sims - offset);
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
          w.postMessage({ kind: "job", jobId: myJob, simOffset: offset,
            req: { ...req, candidates: cands, sims: count,
                   // typed arrays do not survive as a plain field here
                   rankOverride: req.rankOverride
                     ? Array.from(req.rankOverride) : null } });
        });
      });
      return (await Promise.all(jobs)).filter((s): s is Slice => s !== null);
    };

    // Accumulated slices across every chunk so far. aggregate() concatenates them, so the
    // reported n grows with each round and the paired SE shrinks accordingly.
    const acc: Slice[] = [];
    let done = 0;
    for (const want of simSchedule()) {
      const slices = await chunk(done, want);
      if (jobRef.current !== myJob) return;             // a newer request superseded us
      if (!slices.length) {
        setState((s) => ({ ...s, running: false,
          error: acc.length ? "workers stopped early; showing partial results"
                            : "all workers failed" }));
        return;
      }
      acc.push(...slices);
      done += want;
      const agg = aggregate(cands, acc);
      const more = done < PLAYER_MAX_SIMS;
      setState({ ...agg, unreachable, sims: agg.results[0]?.n ?? 0,
                 provisional: more, settled: done >= PLAYER_FIRST_SHOW,
                 running: more, error: null });
    }
  }, [artifact]);

  return { ...state, run };
}
