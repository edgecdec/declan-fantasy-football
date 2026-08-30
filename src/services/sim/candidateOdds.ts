/**
 * Per-candidate draft odds: a RANKED LIST of individual players, with the uncertainty
 * shown rather than hidden.
 *
 * HOW MANY SIMS THIS NEEDS -- measured, not guessed. Running the same draft state under
 * two independent seeds and comparing the two orderings:
 *
 *     sims   max paired SE   Spearman between seeds   top pick agrees
 *      200       3.78pp            -0.12                    no
 *      600       2.11pp            +0.25                    no
 *     1500       1.31pp            +0.60                    no
 *     3000       0.93pp            +0.95                    yes
 *
 * At 200 sims the ranking is anti-correlated with itself -- i.e. it is noise, and showing
 * it would be worse than showing nothing. From ~3000 sims the ordering is stable and the
 * leader reproduces. So DEFAULT_SIMS is 3000, results stream in progressively, and each
 * row carries its paired SE so a reader can see which gaps are real and which are not.
 *
 * An earlier version bucketed candidates into "tiers" instead. That was wrong for the
 * job: at realistic sim counts every candidate fell into one tier, which is the same as
 * refusing to answer. The uncertainty belongs on the rows, not in the grouping.
 */
import {
  Artifact, BotWeights, SimData, buildSheets, hashSeed, pickOrder, playSeason,
  runDraft, runH2H, sampleOutcomes, schedule, rng,
} from "./engine";

/** In-season weights from the trait study; the tuned manager. */
export const TUNED: Omit<BotWeights, "posMult"> = {
  sheetSd: 0.10, viewSd: 0.04, lineupHot: 0.10,
  waiverMarg: 1.40, faabAggr: 0.30, weekW: 0.40,
};

/** Archetype opponents. Nine of them -- exactly the opponents a 10-team league needs.
 *  BooneFollower is deliberately absent: his rankings for the season being drafted are
 *  published week-by-week during it, so for a live draft they do not exist. */
export const FIELD: BotWeights[] = [
  { posMult: { QB: 1.28 }, sheetSd: 0.27, viewSd: 0.04, lineupHot: 0.25, waiverMarg: 0.074, faabAggr: 0.20, weekW: 0.35 },
  { posMult: {}, sheetSd: 0.14, viewSd: 0.04, lineupHot: 0.25, waiverMarg: 0.203, faabAggr: 0.28, weekW: 0.25 },
  { posMult: { RB: 1.25, WR: 0.92 }, sheetSd: 0.25, viewSd: 0.04, lineupHot: 0.25, waiverMarg: 0.108, faabAggr: 0.15, weekW: 0.45 },
  { posMult: { TE: 1.30 }, sheetSd: 0.27, viewSd: 0.04, lineupHot: 0.25, waiverMarg: 0.135, faabAggr: 0.35, weekW: 0.40 },
  { posMult: {}, sheetSd: 0.30, viewSd: 0.04, lineupHot: 0.25, waiverMarg: 0.108, faabAggr: 0.30, weekW: 0.70 },
  { posMult: {}, sheetSd: 0.09, viewSd: 0.04, lineupHot: 0.25, waiverMarg: 0.540, faabAggr: 0.18, weekW: 0.30 },
  { posMult: {}, sheetSd: 0.25, viewSd: 0.04, lineupHot: 0.10, waiverMarg: 1.620, faabAggr: 0.08, weekW: 0.20 },
  { posMult: { RB: 0.62, WR: 1.18 }, sheetSd: 0.27, viewSd: 0.04, lineupHot: 0.25, waiverMarg: 0.162, faabAggr: 0.25, weekW: 0.55 },
  { posMult: { QB: 0.78 }, sheetSd: 0.30, viewSd: 0.04, lineupHot: 0.25, waiverMarg: 0.135, faabAggr: 0.32, weekW: 0.75 },
];

/** Below this the ordering is not reproducible across seeds -- see the header table. */
export const DEFAULT_SIMS = 3000;
/** First-paint pass: fast, and honest that it is provisional. */
export const QUICK_SIMS = 400;

export type OddsRequest = {
  myTeam: number;                       // 0-indexed seat
  taken: [number, number][];            // [overallPick, playerIndex]
  candidates: number[];                 // player indices
  sims: number;
  seedBase: string;                     // derive from draft state so results are stable
  myPosMult?: Record<string, number>;
  reversalRound?: number;
  /** denseIndex -> draft-order rank from the user's selected ranking set. Changes what YOU
   *  take, not what the other managers take. Must be applied in the
   *  Applies to YOUR seat only -- the other managers draft consensus, so availability
   *  keeps tracking market ADP even when your board disagrees with it. */
  rankOverride?: Int32Array | null;
};

export type CandidateResult = {
  pid: number; playoff: number; title: number; pf: number; n: number;
  /** Chance this player is still on the board when your pick arrives, measured on the
   *  UNFORCED draft. The odds columns are all conditional on getting him, so this is the
   *  other half of the decision: a big edge you only see 10% of the time is not a plan. */
  availability: number;
  /** paired difference vs the leader, and its paired SE. |vsBest| < 2*se means the gap
   *  is not distinguishable from zero -- render it muted rather than as a real ordering. */
  vsBest: number; vsBestSe: number;
  distinguishable: boolean;
};

/** Raw per-sim records for a SLICE of the simulation range.
 *
 *  Work is split by sim range, never by candidate. Two reasons, the second decisive:
 *   1. the paired SE needs every candidate's outcome for the SAME sim index, so a worker
 *      must run all candidates over its slice;
 *   2. if candidates finished at different sim counts they would be compared against each
 *      other at different precisions, which is simply invalid.
 *  So each worker runs all candidates over `[simOffset, simOffset+sims)` and the main
 *  thread concatenates. Every candidate therefore always has an identical sim count. */
export type Slice = { po: Uint8Array[]; ti: Uint8Array[]; pf: Float32Array[];
                      avail: Uint8Array[]; nextPick: number };

export function simulateSlice(art: Artifact, req: OddsRequest,
                              simOffset = 0): Slice {
  const D = new SimData(art);
  const M = art.meta;
  const teams = M.teams;
  const me: BotWeights = { posMult: req.myPosMult ?? { QB: 1.30, K: 1.30 }, ...TUNED };
  const bots: BotWeights[] = [];
  for (let t = 0; t < teams; t++) {
    bots.push(t === req.myTeam ? me : FIELD[(t < req.myTeam ? t : t - 1) % FIELD.length]);
  }
  const order = pickOrder(teams, M.rounds, req.reversalRound ?? 0);
  const takenMap = new Map<number, number>(req.taken);
  const nextPick = order.find((o) => o.t === req.myTeam && !takenMap.has(o.ov))?.ov ?? -1;
  if (nextPick < 0) throw new Error("no picks remaining for this seat");
  const cands = req.candidates;
  const po = cands.map(() => new Uint8Array(req.sims));
  const ti = cands.map(() => new Uint8Array(req.sims));
  const pf = cands.map(() => new Float32Array(req.sims));
  const avail = cands.map(() => new Uint8Array(req.sims));
  const snap = new Uint8Array(D.n);

  for (let i = 0; i < req.sims; i++) {
    // Seeded from the ABSOLUTE sim index, so a slice computed in any worker reproduces
    // exactly the world that index would have had in a single-threaded run.
    const seed = hashSeed(`${req.seedBase}|${simOffset + i}`);
    const outcomes = sampleOutcomes(D, rng(seed ^ 0x9e3779b9));
    const sheets = buildSheets(D, bots, seed ^ 0x85ebca6b, req.myTeam,
                               req.rankOverride);
    const sched = schedule(teams, M.regWeeks, rng(seed ^ 0xc2b2ae35));
    // One UNFORCED draft first, purely to see who actually survives to my pick.
    runDraft(D, bots, sheets, order, takenMap, nextPick, snap);
    for (let c = 0; c < cands.length; c++) avail[c][i] = snap[cands[c]];
    for (let c = 0; c < cands.length; c++) {
      const t2 = new Map(takenMap);
      t2.set(nextPick, cands[c]);
      const rosters = runDraft(D, bots, sheets, order, t2);
      const weekly = playSeason(D, bots, rosters, outcomes, seed ^ 0x27d4eb2f);
      const { seeds, champ, pf: teamPf } = runH2H(D, weekly, teams, sched);
      po[c][i] = seeds.includes(req.myTeam) ? 1 : 0;
      ti[c][i] = champ === req.myTeam ? 1 : 0;
      pf[c][i] = teamPf[req.myTeam];
    }
  }
  return { po, ti, pf, avail, nextPick };
}

/** Cheap availability probe: run UNFORCED drafts only, no season, and report how often
 *  each candidate is still on the board at my pick.
 *
 *  Worth its own pass because simulating a player who is never there is pure waste --
 *  asking "what if you take the #1 overall at pick 5" burns the same compute as a real
 *  candidate to answer a question that cannot arise. A draft is ~1/6th of a full
 *  simulation and this skips the season entirely, so a few hundred probes cost almost
 *  nothing and can cut the candidate list substantially. */
export function probeAvailability(art: Artifact, req: Omit<OddsRequest, "sims">,
                                  probes = 250): { pid: number; availability: number }[] {
  const D = new SimData(art);
  const M = art.meta, teams = M.teams;
  const bots: BotWeights[] = [];
  const me: BotWeights = { posMult: req.myPosMult ?? { QB: 1.30, K: 1.30 }, ...TUNED };
  for (let t = 0; t < teams; t++) {
    bots.push(t === req.myTeam ? me : FIELD[(t < req.myTeam ? t : t - 1) % FIELD.length]);
  }
  const order = pickOrder(teams, M.rounds, req.reversalRound ?? 0);
  const takenMap = new Map<number, number>(req.taken);
  const nextPick = order.find((o) => o.t === req.myTeam && !takenMap.has(o.ov))?.ov ?? -1;
  if (nextPick < 0) throw new Error("no picks remaining for this seat");
  const hits = new Int32Array(req.candidates.length);
  const snap = new Uint8Array(D.n);
  for (let i = 0; i < probes; i++) {
    const seed = hashSeed(`${req.seedBase}|${i}`);
    const sheets = buildSheets(D, bots, seed ^ 0x85ebca6b, req.myTeam,
                               req.rankOverride);
    runDraft(D, bots, sheets, order, takenMap, nextPick, snap);
    for (let c = 0; c < req.candidates.length; c++) if (snap[req.candidates[c]]) hits[c]++;
  }
  return req.candidates.map((pid, c) => ({ pid, availability: 100 * hits[c] / probes }));
}

/** Aggregate one or more slices into the ranked, uncertainty-annotated result. */
export function aggregate(candidates: number[], slices: Slice[]): {
  results: CandidateResult[]; nextPick: number; noiseFloor: number;
} {
  const cat = (get: (s: Slice) => (Uint8Array | Float32Array)[], c: number) => {
    const out: number[] = [];
    for (const s of slices) out.push(...Array.from(get(s)[c]));
    return out;
  };
  const rec = candidates.map((_p, c) => ({
    po: cat((s) => s.po, c), ti: cat((s) => s.ti, c), pf: cat((s) => s.pf, c),
    av: cat((s) => s.avail, c),
  }));
  const n = rec[0].po.length;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const results: CandidateResult[] = candidates.map((pid, c) => ({
    pid, playoff: 100 * mean(rec[c].po), title: 100 * mean(rec[c].ti),
    pf: mean(rec[c].pf), n, availability: 100 * mean(rec[c].av),
    vsBest: 0, vsBestSe: 0, distinguishable: false,
  }));
  const bi = results.reduce((a, b, i) => (b.playoff > results[a].playoff ? i : a), 0);
  let maxSe = 0;
  for (let c = 0; c < candidates.length; c++) {
    if (c === bi) continue;
    const d = rec[bi].po.map((v, i) => 100 * (v - rec[c].po[i]));
    const m = mean(d);
    const varr = d.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(d.length - 1, 1);
    const se = Math.sqrt(varr / d.length);
    results[c].vsBest = -m;
    results[c].vsBestSe = se;
    results[c].distinguishable = Math.abs(m) > 2 * se;
    maxSe = Math.max(maxSe, se);
  }
  return { results: [...results].sort((a, b) => b.playoff - a.playoff),
           nextPick: slices[0].nextPick, noiseFloor: 2 * maxSe };
}

export function candidateOdds(art: Artifact, req: OddsRequest): {
  results: CandidateResult[]; nextPick: number; noiseFloor: number;
} {
  return aggregate(req.candidates, [simulateSlice(art, req, 0)]);
}
