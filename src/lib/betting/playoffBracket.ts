import { TEAM_WEEK_SD, makeRng } from '@/lib/betting/seasonSim';

/**
 * Live playoff odds: the rest of a league's real winners bracket, played out from where it stands.
 *
 * Sleeper's rules, as measured on completed brackets (work/ff-markets-scores/playoffs-live/*.py,
 * every one of 20 decided matches across four leagues reproduced):
 *
 *  - `playoff_round_type` is how long a round lasts: 0 one week, 1 one week but a two-week final,
 *    2 two weeks every round. A round's score is the sum of its weeks.
 *  - `playoff_seed_type` is whether the bracket re-seeds: 0 a fixed bracket (seed 1 meets the winner
 *    of 4v5, seed 2 the winner of 3v6, confirmed by 13 brackets with a seed-6 upset); 1 re-seeds
 *    after each round, the best remaining seed meeting the worst (Forever League 2024: seeds 4 and 6
 *    won round one, and seed 1 drew 6). A re-seeding bracket leaves the bye teams' round-two slot
 *    empty, with no `t2_from`, until round one is decided — which is how the opponent is inferred.
 *
 * Only the winners path counts (matches with no `p`, or `p` = 1); consolation and third-place games
 * are ignored. Team strength is the season model's own per-week mean (effectiveWeekMean) and weekly
 * spread, so a team is exactly as good here as it was in the regular-season odds.
 */

export type BracketFrom = { w?: number; l?: number };

export type BracketMatch = {
  r: number;
  m: number;
  t1: number | null;
  t2: number | null;
  w: number | null;
  l: number | null;
  t1_from?: BracketFrom | null;
  t2_from?: BracketFrom | null;
  p?: number | null;
};

/** The championship path: the winners bracket without its placement games. */
export function winnersPath(bracket: BracketMatch[]): BracketMatch[] {
  return bracket.filter(m => m.p === undefined || m.p === null || m.p === 1);
}

/** Weeks of each round, from the first playoff week and `playoff_round_type`. */
export function roundWeeks(start: number, roundType: number, rounds: number): number[][] {
  const out: number[][] = [];
  let week = start;
  for (let r = 1; r <= rounds; r++) {
    const len = roundType === 2 || (roundType === 1 && r === rounds) ? 2 : 1;
    out.push(Array.from({ length: len }, (_, i) => week + i));
    week += len;
  }
  return out;
}

/** "two-week rounds" / "one-week rounds, two-week final" / "one-week rounds". */
export function roundLengthText(roundType: number): string {
  if (roundType === 2) return 'two-week rounds';
  if (roundType === 1) return 'one-week rounds, two-week final';
  return 'one-week rounds';
}

/** A round's name from the end: Final, Semis, Quarters, then plain numbers. */
export function roundName(r: number, rounds: number): string {
  const fromEnd = rounds - r;
  if (fromEnd === 0) return 'FINAL';
  if (fromEnd === 1) return 'SEMIS';
  if (fromEnd === 2) return 'QUARTERS';
  return `ROUND ${r}`;
}

export type LiveWeekScore = { banked: number; remainingMean: number; remainingSd: number };

export type BracketSimInput = {
  bracket: BracketMatch[];
  /** Seed by roster: 1 is the best. */
  seeds: Map<number, number>;
  reseed: boolean;
  /** roundWeeks(...) for this league. */
  weeks: number[][];
  currentWeek: number;
  /** Points by `${week}:${rosterId}` for weeks that are over. */
  actual: Map<string, number>;
  /** The week in progress, from the read-only matchup model. */
  live: Map<number, LiveWeekScore>;
  /** Per-week mean for each team, from the season model. */
  means: Map<number, number>;
  sims: number;
  seed?: number;
};

export type BracketTeamOdds = {
  rosterId: number;
  /** reach[r - 1] = P(alive in round r). */
  reach: number[];
  title: number;
};

export type BracketSimResult = {
  rounds: number;
  /** The first round with an undecided match; rounds + 1 once there is a champion. */
  currentRound: number;
  champion: number | null;
  teams: BracketTeamOdds[];
};

/** Bracket order for `b` slots by seed (8 → 1,8,4,5,2,7,3,6), for fixed-bracket inference. */
function bracketOrder(b: number): number[] {
  let order = [1];
  while (order.length < b) {
    const size = order.length * 2;
    order = order.flatMap(s => [s, size + 1 - s]);
  }
  return order;
}

/** The round in play, and the champion if the final is decided. */
export function bracketState(bracket: BracketMatch[]): { rounds: number; currentRound: number; champion: number | null } {
  const path = winnersPath(bracket);
  const rounds = Math.max(0, ...path.map(m => m.r));
  const open = path.filter(m => m.w === null || m.w === undefined);
  const final = path.filter(m => m.r === rounds);
  const champion = open.length === 0 && final.length === 1 ? final[0].w : null;
  return { rounds, currentRound: open.length ? Math.min(...open.map(m => m.r)) : rounds + 1, champion };
}

export function simulateBracketLive(input: BracketSimInput): BracketSimResult {
  const path = winnersPath(input.bracket).sort((a, b) => a.r - b.r || a.m - b.m);
  const { rounds, currentRound, champion } = bracketState(path);
  const rng = makeRng(input.seed ?? 1);
  const normal = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const seedOf = (id: number) => input.seeds.get(id) ?? 99;

  const teams = new Set<number>();
  for (const m of path) for (const t of [m.t1, m.t2, m.w, m.l]) if (t !== null && t !== undefined) teams.add(t);
  // The field is the teams the bracket names, not the league: 6 of 12 make a bracket of 8 slots.
  const size = (() => { let b = 1; while (b < teams.size) b *= 2; return b; })();
  const order = bracketOrder(size);
  const reach = new Map<number, number[]>([...teams].map(t => [t, new Array<number>(rounds).fill(0)]));
  const titles = new Map<number, number>([...teams].map(t => [t, 0]));

  /** One team's score for a whole round: banked weeks, the live week, and draws for the rest. */
  const roundScore = (id: number, r: number): number => {
    let total = 0;
    for (const wk of input.weeks[r - 1] ?? []) {
      const done = input.actual.get(`${wk}:${id}`);
      if (wk < input.currentWeek && done !== undefined) total += done;
      else if (wk === input.currentWeek && input.live.has(id)) {
        const l = input.live.get(id)!;
        total += l.banked + l.remainingMean + normal() * l.remainingSd;
      } else {
        total += (input.means.get(id) ?? 0) + normal() * TEAM_WEEK_SD;
      }
    }
    return total;
  };

  for (let s = 0; s < input.sims; s++) {
    const won = new Map<number, number>();
    const lost = new Map<number, number>();
    const fromSlot = (f: BracketFrom | null | undefined) =>
      f?.w !== undefined ? won.get(f.w) ?? null : f?.l !== undefined ? lost.get(f.l) ?? null : null;

    for (let r = 1; r <= rounds; r++) {
      const inRound = path.filter(m => m.r === r);
      const slots = inRound.map(m => [m.t1 ?? fromSlot(m.t1_from), m.t2 ?? fromSlot(m.t2_from)] as (number | null)[]);

      // Empty slots with no `from`: the bye teams' opponents, from last round's winners.
      const placed = new Set(slots.flat().filter((t): t is number => t !== null));
      const pool = path.filter(m => m.r === r - 1).map(m => won.get(m.m)).filter((t): t is number => t !== undefined && !placed.has(t));
      if (input.reseed) {
        // Best remaining seed meets the worst: open matches by their known team's seed, best first.
        const open = inRound.map((_, i) => i).filter(i => slots[i].some(t => t === null))
          .sort((a, b) => seedOf(slots[a].find(t => t !== null) ?? 0) - seedOf(slots[b].find(t => t !== null) ?? 0));
        const worstFirst = [...pool].sort((a, b) => seedOf(b) - seedOf(a));
        for (const i of open) {
          const k = slots[i].indexOf(null);
          if (k >= 0 && worstFirst.length) slots[i][k] = worstFirst.shift()!;
        }
      } else {
        // Fixed bracket: the winner of the round-one pair beside this seed's own pair.
        for (const sl of slots) {
          const k = sl.indexOf(null);
          const known = sl.find(t => t !== null);
          if (k < 0 || known === undefined || known === null) continue;
          const pos = order.indexOf(seedOf(known));
          const partner = pos >= 0 ? (Math.floor(pos / 2) ^ 1) : -1;
          const want = partner >= 0 ? new Set([order[partner * 2], order[partner * 2 + 1]]) : new Set<number>();
          const hit = pool.find(t => want.has(seedOf(t))) ?? pool[0];
          if (hit !== undefined) { sl[k] = hit; pool.splice(pool.indexOf(hit), 1); }
        }
      }

      inRound.forEach((m, i) => {
        const [a, b] = slots[i];
        for (const t of [a, b]) if (t !== null && reach.has(t)) reach.get(t)![r - 1]++;
        let w: number | null;
        let l: number | null;
        if (m.w !== null && m.w !== undefined) {
          w = m.w;
          l = m.l ?? (w === a ? b : a);
        } else if (a !== null && b !== null) {
          // A tie on points goes to the better seed.
          const sa = roundScore(a, r);
          const sb = roundScore(b, r);
          [w, l] = sa > sb || (sa === sb && seedOf(a) < seedOf(b)) ? [a, b] : [b, a];
        } else {
          w = a ?? b;
          l = null;
        }
        if (w !== null) won.set(m.m, w);
        if (l !== null) lost.set(m.m, l);
        if (r === rounds && w !== null) titles.set(w, (titles.get(w) ?? 0) + 1);
      });
    }
  }

  return {
    rounds,
    currentRound,
    champion,
    teams: [...teams].map(id => ({
      rosterId: id,
      reach: reach.get(id)!.map(c => c / input.sims),
      title: (titles.get(id) ?? 0) / input.sims,
    })),
  };
}

/** Each decided match on the winners path, with the round's summed points, in bracket order. */
export function decidedResults(
  bracket: BracketMatch[],
  weeks: number[][],
  actual: Map<string, number>,
): { round: number; winner: number; loser: number; winnerPoints: number | null; loserPoints: number | null }[] {
  const sum = (id: number, r: number) => {
    const pts = (weeks[r - 1] ?? []).map(wk => actual.get(`${wk}:${id}`));
    return pts.every(p => p !== undefined) ? pts.reduce((a, b) => a! + b!, 0)! : null;
  };
  return winnersPath(bracket)
    .filter(m => m.w !== null && m.w !== undefined && m.l !== null && m.l !== undefined)
    .sort((a, b) => a.r - b.r || a.m - b.m)
    .map(m => ({ round: m.r, winner: m.w!, loser: m.l!, winnerPoints: sum(m.w!, m.r), loserPoints: sum(m.l!, m.r) }));
}
