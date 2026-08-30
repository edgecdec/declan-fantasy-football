/**
 * Draft + season + playoff simulator, ported from scripts/bot_league.py.
 *
 * Runs client-side so heavy traffic uses each visitor's own CPU. A shape-matched
 * benchmark put node at ~37x python on this workload, which is why no vectorisation is
 * needed here -- plain scalar loops over typed arrays are enough.
 *
 * Player ids are DENSE INTEGERS (indices into the artifact's parallel arrays), never
 * Sleeper's strings. Keeping string keys in JS objects would give up most of that 37x.
 *
 * WHAT THIS IS FOR: comparing candidate picks. Within one simulation index every candidate
 * faces an identical world -- same opponent boards, same sampled player outcomes, same
 * schedule -- so the common variance cancels in the DIFFERENCE between candidates, which
 * is the only quantity precise enough to act on. Absolute odds are much noisier.
 *
 * KNOWN DIVERGENCE FROM THE PYTHON REFERENCE: the in-season waiver/FAAB model here is
 * simplified (single best upgrade per team per week, budget-weighted bid, no
 * league-winner convexity, no IR stash). That is a deliberate trade: in-season behaviour
 * is common to every candidate, so it moves the absolute odds but largely cancels in the
 * ranking. Anything that changes the RANKING -- boards, the draft rule, lineup filling,
 * the bracket -- is ported faithfully.
 */

export type Artifact = {
  meta: {
    season: string; league: string; teams: number;
    rosterPositions: string[]; slots: string[]; rounds: number;
    regWeeks: number; playoffWeeks: number[]; playoffTeams: number;
    req: Record<string, number>; startDemand: Record<string, number>;
    posCap: Record<string, number>; stop: Record<string, number>;
    draftPoolSize: number; allPos: string[];
  };
  players: {
    sleeperId: string[]; name: string[]; pos: string[];
    adpRank: number[]; posAdpRank: number[]; board: number[];
  };
  repl: Record<string, number>;
  donors: Record<string, { r: number; p: number[]; a: number[] }[]>;
};

export type BotWeights = {
  posMult: Record<string, number>;
  sheetSd: number; viewSd: number; lineupHot: number;
  waiverMarg: number; faabAggr: number; weekW: number;
};

/** Calibration constants, all from bot_league.py. Do not tune here -- tune there. */
const VORP_TILT = 0.30;
const NEED_RAMP = 9.0;
const APPETITE_DECAY = 0.40;
const KDEF_DRAFT_VALUE = 0.06;
const FA_MIN_PROJ = 3.0;
const MAX_WK = 17;
const leanW = (r: number) => Math.min(1, Math.pow(Math.max(r, 1) / 45, 1.2));
const sdByRank = (r: number) => Math.min(0.15 + 0.9 * Math.pow(Math.max(r, 1) / 90, 1.5), 3);

/** mulberry32 -- small, fast, and seedable so the same draft state gives the same odds.
 *  Without a deterministic seed the panel would jitter on every 15s poll. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Box-Muller, cached second draw. */
function gaussFactory(u: () => number) {
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let x = 0, y = 0, s = 0;
    do { x = u() * 2 - 1; y = u() * 2 - 1; s = x * x + y * y; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    spare = y * m;
    return x * m;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// precomputed, immutable per artifact
// ---------------------------------------------------------------------------
export class SimData {
  n: number;
  pos: Int8Array;          // index into posNames
  posNames: string[];
  adpRank: Int32Array;
  posAdpRank: Int32Array;
  board: Float64Array;
  mkt: Float64Array;       // market value by ADP rank
  vorp: Float64Array;
  draftable: number;       // ids [0, draftable) are the draft pool
  donorsByPos: { r: number; p: Float32Array; a: Float32Array }[][];
  art: Artifact;

  constructor(art: Artifact) {
    this.art = art;
    const P = art.players;
    this.n = P.sleeperId.length;
    this.posNames = art.meta.allPos;
    this.pos = new Int8Array(this.n);
    this.adpRank = new Int32Array(this.n);
    this.posAdpRank = new Int32Array(this.n);
    this.board = new Float64Array(this.n);
    this.mkt = new Float64Array(this.n);
    this.vorp = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const pi = this.posNames.indexOf(P.pos[i]);
      this.pos[i] = pi;
      this.adpRank[i] = P.adpRank[i];
      this.posAdpRank[i] = P.posAdpRank[i];
      this.board[i] = P.board[i];
      this.mkt[i] = 100 * Math.exp(-(P.adpRank[i] - 1) / 50);
      const repl = pi >= 0 ? (art.repl[this.posNames[pi]] ?? 0) : 0;
      this.vorp[i] = Math.max(P.board[i] - repl, 0);
    }
    this.draftable = art.meta.draftPoolSize;
    this.donorsByPos = this.posNames.map((p) =>
      (art.donors[p] ?? []).map((d) => ({
        r: d.r, p: Float32Array.from(d.p), a: Float32Array.from(d.a),
      })));
  }
  posOf(i: number) { return this.pos[i] >= 0 ? this.posNames[this.pos[i]] : ""; }

  /** Market value implied by an arbitrary rank, for a manager drafting a private board. */
  mktFor(rank: number) { return 100 * Math.exp(-(rank - 1) / 50); }
}

// ---------------------------------------------------------------------------
// forward model: sample a whole donor season per player
// ---------------------------------------------------------------------------
const DONOR_WINDOW = 0.30, DONOR_MIN_WINDOW = 4;

export type Outcomes = { proj: Float32Array; act: Float32Array };  // n x MAX_WK, row-major

export function sampleOutcomes(D: SimData, u: () => number): Outcomes {
  const proj = new Float32Array(D.n * MAX_WK);
  const act = new Float32Array(D.n * MAX_WK);
  for (let i = 0; i < D.n; i++) {
    const pi = D.pos[i];
    if (pi < 0) continue;
    const pool = D.donorsByPos[pi];
    if (!pool.length) continue;
    const r = D.posAdpRank[i] || pool.length;
    const w = Math.max(DONOR_MIN_WINDOW, Math.floor(r * DONOR_WINDOW));
    // donors are rank-sorted, so the window is a contiguous slice -- binary search it
    let lo = 0, hi = pool.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (pool[m].r < r - w) lo = m + 1; else hi = m; }
    let end = lo;
    while (end < pool.length && pool[end].r <= r + w) end++;
    let pick: number;
    if (end > lo) pick = lo + Math.floor(u() * (end - lo));
    else {
      // no donor in range: take the nearest by rank rather than a random one
      let bi = 0, bd = Infinity;
      for (let k = 0; k < pool.length; k++) {
        const d = Math.abs(pool[k].r - r);
        if (d < bd) { bd = d; bi = k; }
      }
      pick = bi;
    }
    const d = pool[pick];
    const off = i * MAX_WK;
    for (let k = 0; k < MAX_WK; k++) { proj[off + k] = d.p[k]; act[off + k] = d.a[k]; }
  }
  return { proj, act };
}

// ---------------------------------------------------------------------------
// private boards
// ---------------------------------------------------------------------------
/**
 * One private valuation board per manager.
 *
 * `myRank` applies to `myTeam` ONLY, and that asymmetry is the point: your own ranking set
 * changes what YOU draft, not what the other nine managers draft. They work off consensus,
 * which is why the chance a player survives to your pick keeps following market ADP even
 * when your board disagrees with it. An earlier version applied the override to the whole
 * league, which effectively assumed everyone had read your rankings.
 */
export function buildSheets(D: SimData, bots: BotWeights[], seed: number,
                            myTeam?: number, myRank?: Int32Array | null): Float64Array {
  const T = bots.length;
  const out = new Float64Array(T * D.n);
  const u = rng(seed), g = gaussFactory(u);
  for (let t = 0; t < T; t++) {
    const b = bots[t];
    const mine = myRank && t === myTeam ? myRank : null;
    for (let i = 0; i < D.draftable; i++) {
      // my seat prices off my own board; everyone else off the market
      const r = mine && mine[i] > 0 ? mine[i] : D.adpRank[i];
      const base = (mine && mine[i] > 0 ? D.mktFor(mine[i]) : D.mkt[i])
        * (1 + VORP_TILT * D.vorp[i] / 120);
      const sd = b.sheetSd * sdByRank(r);
      const pm = b.posMult[D.posOf(i)] ?? 1;
      const lean = 1 + (pm - 1) * leanW(r);
      out[t * D.n + i] = base * lean * Math.exp(g() * sd);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// draft
// ---------------------------------------------------------------------------
/**
 * The pick order. `swaps` maps an overall pick number to the seat that actually owns it after
 * draft-pick trades; anything absent follows the plain snake. Applied to both the replay of
 * completed picks and the simulation of the rest, since a traded pick changes who a past pick
 * is credited to as well as who makes a future one.
 */
export function pickOrder(teams: number, rounds: number, reversalRound = 0,
                          swaps?: Map<number, number> | null) {
  const out: { ov: number; rnd: number; t: number }[] = [];
  let ov = 0;
  for (let rnd = 1; rnd <= rounds; rnd++) {
    let fwd = rnd % 2 === 1;
    if (reversalRound && rnd >= reversalRound) fwd = !fwd;
    for (let k = 0; k < teams; k++) {
      const t = fwd ? k : teams - 1 - k;
      ov++;
      const owner = swaps?.get(ov);
      out.push({ ov, rnd, t: owner === undefined ? t : owner });
    }
  }
  return out;
}

export function runDraft(
  D: SimData, bots: BotWeights[], sheets: Float64Array,
  order: { ov: number; rnd: number; t: number }[],
  taken: Map<number, number>,
  /** If set, capture who was still on the board immediately BEFORE this overall pick.
   *  Used to estimate "what is the chance this player even reaches my pick", which has to
   *  be measured on an UNFORCED draft -- forcing a player in guarantees his availability
   *  and would make the answer trivially 100%. */
  snapshotAt?: number,
  snapshotOut?: Uint8Array,
): Int32Array[] {
  const M = D.art.meta, T = bots.length;
  const avail = new Uint8Array(D.n).fill(0);
  for (let i = 0; i < D.draftable; i++) avail[i] = 1;
  // RESERVE every forced pick. Without this, a forced pick whose player an earlier
  // SIMULATED pick had already taken silently became a no-op, so the seat drafted one
  // fewer player. That produced odds almost perfectly anti-correlated with ADP -- asking
  // "what if I take the #1 overall at pick 5" meant an opponent took him at pick 1 in
  // nearly every sim and the seat got nobody. Reserving makes the counterfactual
  // coherent: "conditional on this player being on the board at my pick".
  for (const pid of taken.values()) if (pid >= 0 && pid < D.n) avail[pid] = 0;
  const rosters: number[][] = Array.from({ length: T }, () => []);
  const cnt: Record<string, number>[] = Array.from({ length: T }, () => ({}));
  const remaining = new Int32Array(T);
  for (const o of order) remaining[o.t]++;

  for (const { ov, rnd, t } of order) {
    if (snapshotAt !== undefined && snapshotOut && ov === snapshotAt) {
      snapshotOut.set(avail);
    }
    const left = remaining[t]--;
    const forced = taken.get(ov);
    if (forced !== undefined) {
      // Replay verbatim. The player was reserved above so he is guaranteed to be here,
      // and positional caps deliberately do not veto him -- a real manager may well have
      // drafted a third TE.
      rosters[t].push(forced);
      const p = D.posOf(forced);
      cnt[t][p] = (cnt[t][p] ?? 0) + 1;
      continue;
    }
    let missing = 0;
    for (const p of D.posNames) missing += Math.max((M.req[p] ?? 0) - (cnt[t][p] ?? 0), 0);
    const ramp = NEED_RAMP * Math.pow(rnd / M.rounds, 1.6);
    const sh = t * D.n;
    let best = -1, bv = -Infinity;
    for (let i = 0; i < D.draftable; i++) {
      if (!avail[i]) continue;
      const p = D.posOf(i);
      const have = cnt[t][p] ?? 0;
      if (have >= (M.posCap[p] ?? 0)) continue;
      if (left <= missing && have >= (M.req[p] ?? 0)) continue;  // must fill empty slots
      const deficit = Math.max(0, (M.req[p] ?? 0) - have);
      let damp = Math.pow(APPETITE_DECAY, Math.max(0, have + 1 - (M.stop[p] ?? 5)));
      if ((p === "K" || p === "DEF") && have < 1) damp *= KDEF_DRAFT_VALUE;
      const v = sheets[sh + i] * (1 + ramp * deficit) * damp;
      if (v > bv) { bv = v; best = i; }
    }
    if (best < 0) continue;
    avail[best] = 0;
    rosters[t].push(best);
    const p = D.posOf(best);
    cnt[t][p] = (cnt[t][p] ?? 0) + 1;
  }
  return rosters.map((r) => Int32Array.from(r));
}

// ---------------------------------------------------------------------------
// lineups: dedicated slots first, then flex, highest key first
// ---------------------------------------------------------------------------
const FLEX_ELIGIBLE: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"], WRRBTE_FLEX: ["RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"], WRRB_FLEX: ["RB", "WR"], SUPER_FLEX: ["QB"],
};

export function fillLineup(slots: string[], roster: Int32Array, D: SimData,
                           key: Float64Array): number[] {
  const used = new Set<number>();
  const out: number[] = [];
  const byKey = Array.from(roster).sort((a, b) => key[b] - key[a]);
  for (const slot of slots) {
    const elig = FLEX_ELIGIBLE[slot] ?? [slot];
    let chosen = -1;
    for (const pid of byKey) {
      if (used.has(pid)) continue;
      if (elig.includes(D.posOf(pid))) { chosen = pid; break; }
    }
    if (chosen >= 0) { used.add(chosen); out.push(chosen); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// season + playoffs
// ---------------------------------------------------------------------------
export function playSeason(D: SimData, bots: BotWeights[], rosters: Int32Array[],
                           out: Outcomes, seed: number): Float64Array {
  const M = D.art.meta, T = bots.length;
  const lastWk = Math.max(...M.playoffWeeks);
  const weekly = new Float64Array((lastWk + 1) * T);
  const u = rng(seed), g = gaussFactory(u);
  const ros: number[][] = rosters.map((r) => Array.from(r));
  const owned = new Set<number>();
  for (const r of ros) for (const p of r) owned.add(p);
  const budget = new Float64Array(T).fill(100);
  const key = new Float64Array(D.n);

  for (let wk = 1; wk <= lastWk; wk++) {
    const wo = (i: number) => out.proj[i * MAX_WK + (wk - 1)];
    const wa = (i: number) => out.act[i * MAX_WK + (wk - 1)];

    // ---- waivers: one best upgrade per team, blind bid, highest wins ----
    const fa: number[] = [];
    for (let i = 0; i < D.n; i++) if (!owned.has(i) && wo(i) >= FA_MIN_PROJ) fa.push(i);
    fa.sort((a, b) => wo(b) - wo(a));
    const shortlist = fa.slice(0, 60);
    const bids: { amt: number; t: number; pid: number; tie: number }[] = [];
    for (let t = 0; t < T; t++) {
      if (budget[t] <= 0) continue;
      const b = bots[t];
      const cur: Record<string, number> = {};
      for (const pid of ros[t]) {
        const p = D.posOf(pid);
        cur[p] = Math.max(cur[p] ?? 0, wo(pid));
      }
      let bp = -1, bg = 0;
      for (const pid of shortlist) {
        const gain = wo(pid) - (cur[D.posOf(pid)] ?? 0);
        if (gain > bg) { bg = gain; bp = pid; }
      }
      if (bp >= 0 && bg > b.waiverMarg) {
        const amt = Math.min(budget[t], Math.max(1, budget[t] * b.faabAggr *
          Math.min(bg / 10, 1) * (0.6 + 0.8 * u())));
        bids.push({ amt, t, pid: bp, tie: u() });
      }
    }
    bids.sort((x, y) => (y.amt - x.amt) || (y.tie - x.tie));
    const won = new Set<number>();
    for (const bid of bids) {
      if (won.has(bid.pid) || bid.amt > budget[bid.t]) continue;
      const r = ros[bid.t];
      if (r.length >= M.rounds) {
        // drop the worst body that is not the last of its required position
        let worst = -1, wv = Infinity;
        const c: Record<string, number> = {};
        for (const pid of r) { const p = D.posOf(pid); c[p] = (c[p] ?? 0) + 1; }
        for (const pid of r) {
          const p = D.posOf(pid);
          if (c[p] <= (M.req[p] ?? 0) && p !== D.posOf(bid.pid)) continue;
          if (wo(pid) < wv) { wv = wo(pid); worst = pid; }
        }
        if (worst < 0 || wv >= wo(bid.pid)) continue;
        r.splice(r.indexOf(worst), 1);
        owned.delete(worst);
      }
      r.push(bid.pid);
      owned.add(bid.pid);
      won.add(bid.pid);
      budget[bid.t] -= bid.amt;
    }

    // ---- lineups from this week's projections (never from actuals) ----
    for (let t = 0; t < T; t++) {
      const b = bots[t];
      for (const pid of ros[t]) {
        // each manager reads the week slightly differently
        key[pid] = wo(pid) * Math.exp(g() * b.viewSd);
      }
      const lu = fillLineup(M.slots, Int32Array.from(ros[t]), D, key);
      let tot = 0;
      for (const pid of lu) tot += wa(pid);
      weekly[wk * T + t] = tot;
    }
  }
  return weekly;
}

function bracketOrder(n: number): number[] {
  let order = [1], size = 1;
  while (size < n) {
    size *= 2;
    const mirrored = order.map((y) => size + 1 - y);
    const next: number[] = [];
    for (let i = 0; i < order.length; i++) { next.push(order[i], mirrored[i]); }
    order = next;
  }
  return order;
}

/** Round-robin schedule; requires an even team count (odd counts drop a manager). */
export function schedule(teams: number, weeks: number, u: () => number) {
  const ids = Array.from({ length: teams }, (_, i) => i);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(u() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const rounds: [number, number][][] = [];
  let cur = ids.slice();
  for (let r = 0; r < teams - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < teams / 2; i++) pairs.push([cur[i], cur[teams - 1 - i]]);
    rounds.push(pairs);
    cur = [cur[0], cur[cur.length - 1], ...cur.slice(1, cur.length - 1)];
  }
  return Array.from({ length: weeks }, (_, w) => rounds[w % rounds.length]);
}

export function runH2H(D: SimData, weekly: Float64Array, teams: number,
                       sched: [number, number][][]) {
  const M = D.art.meta;
  const wins = new Float64Array(teams), pf = new Float64Array(teams);
  for (let wi = 0; wi < sched.length; wi++) {
    for (const [a, b] of sched[wi]) {
      const pa = weekly[(wi + 1) * teams + a], pb = weekly[(wi + 1) * teams + b];
      pf[a] += pa; pf[b] += pb;
      wins[a] += pa > pb ? 1 : pa === pb ? 0.5 : 0;
      wins[b] += pb > pa ? 1 : pa === pb ? 0.5 : 0;
    }
  }
  const seeds = Array.from({ length: teams }, (_, t) => t)
    .sort((a, b) => (wins[b] - wins[a]) || (pf[b] - pf[a]))
    .slice(0, M.playoffTeams);
  // FIXED bracket (not re-seeded) -- matches Sleeper and the python reference
  const slots = bracketOrder(seeds.length);
  let alive: (number | null)[] = slots.map((i) => (i <= seeds.length ? seeds[i - 1] : null));
  for (const wk of M.playoffWeeks) {
    if (alive.filter((a) => a !== null).length <= 1) break;
    const next: (number | null)[] = [];
    for (let i = 0; i < alive.length; i += 2) {
      const a = alive[i], b = alive[i + 1];
      if (a === null) next.push(b);
      else if (b === null) next.push(a);
      else next.push(weekly[wk * teams + a] >= weekly[wk * teams + b] ? a : b);
    }
    alive = next;
  }
  const live = alive.filter((a): a is number => a !== null);
  return { seeds, champ: live.length ? live[0] : -1, pf: Array.from(pf),
           wins: Array.from(wins) };
}
