/**
 * Schedule swap — your scores, someone else's schedule.
 *
 * For week w, schedule owner S really played opponent O. Manager X, borrowing S's schedule, faces O
 * with X's OWN score that week; if O is X, X faces S instead (the usual convention — you cannot play
 * yourself, so you take the seat S vacated). X on X's own schedule is X's actual record.
 *
 * Read along a ROW for how one manager's scores would have fared on every schedule; read down a
 * COLUMN for how kind one schedule was to everybody. The column average over the other managers is
 * the schedule's kindness: wins gained (or lost) by playing it instead of your own.
 *
 * Ported from the all-play reference (grahams_all_play/template.html, computeSwap). It handled
 * several seasons and only counted weeks two managers shared; one league season has every manager
 * in every week, so "the same weeks" is simply every counted week.
 *
 * Head-to-head games only. A league that also plays the median awards that extra game the same way
 * on every schedule, so it cannot change who a schedule helps; it is left out rather than added to
 * every cell alike.
 *
 * Imports nothing, because the bot loads these types and the site's renderer shares them.
 */

export type SwapWeek = {
  week: number;
  /** Starter points by roster id. */
  points: Record<number, number>;
  /** Each roster's real opponent that week, both directions. Rosters without one are absent. */
  opponent: Record<number, number>;
};

export type SwapRecord = { w: number; l: number; t: number };

export type SwapManager = {
  rosterId: number;
  name: string;
  teamName: string | null;
  /** A short, league-unique label for the matrix's column heads. */
  short: string;
};

export type SwapCell = SwapRecord & {
  /** Wins (ties as half) against X's actual record. Null on the diagonal, which IS the actual. */
  delta: number | null;
};

export type ScheduleSwapResponse = {
  league: { leagueId: string; name: string; season: string };
  weeksCounted: number;
  /** Managers in matrix order: by all-play win rate, best first, as /luck ranks by expected wins. */
  managers: SwapManager[];
  /** cells[row][col]: the row manager's scores on the column manager's schedule. */
  cells: SwapCell[][];
  /** Per column: mean delta for every OTHER manager playing that schedule. */
  kindness: number[];
  /** Per row: the schedule that would have helped / hurt this manager most (column index). */
  best: number[];
  worst: number[];
  /** Per row: how this manager's actual schedule ranks among random ones (see schedulePercentile). */
  percentile: SchedulePercentile[];
};

export type SchedulePercentile = {
  /** worse + ½·same, 0…1. High = a kinder schedule than most. */
  percentile: number;
  /** Shares of every valid round-robin opponent ordering, 0…1. */
  worse: number;
  same: number;
  better: number;
  /** The exact counts behind those shares, and how many orderings there are in all. */
  counts: { worse: number; same: number; better: number; total: number };
};
const blank = (): SwapRecord => ({ w: 0, l: 0, t: 0 });
export const swapWins = (r: SwapRecord) => r.w + 0.5 * r.t;
export const formatRecord = (r: SwapRecord) => (r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`);

/** rec[X][S]: X's record on S's schedule. Only weeks X really played count, for every S alike. */
export function computeSwapRecords(weeks: SwapWeek[]): Map<number, Map<number, SwapRecord>> {
  const rec = new Map<number, Map<number, SwapRecord>>();
  for (const wk of weeks) {
    const owners = Object.keys(wk.opponent).map(Number);
    for (const X of owners) {
      if (!(X in wk.points)) continue;
      const row = rec.get(X) ?? new Map<number, SwapRecord>();
      rec.set(X, row);
      for (const S of owners) {
        let o = wk.opponent[S];
        if (S === X) o = wk.opponent[X];
        else if (o === X) o = S;
        if (!(o in wk.points)) continue;
        const r = row.get(S) ?? blank();
        row.set(S, r);
        const d = wk.points[X] - wk.points[o];
        if (Math.abs(d) < 1e-9) r.t++;
        else if (d > 0) r.w++;
        else r.l++;
      }
    }
  }
  return rec;
}

/** All-play win rate: the share of every other team's score each week that X beat. */
export function allPlayRate(weeks: SwapWeek[], rosterId: number): number {
  let won = 0;
  let games = 0;
  for (const wk of weeks) {
    const mine = wk.points[rosterId];
    if (mine === undefined) continue;
    for (const [other, pts] of Object.entries(wk.points)) {
      if (Number(other) === rosterId) continue;
      games++;
      if (Math.abs(mine - pts) < 1e-9) won += 0.5;
      else if (mine > pts) won++;
    }
  }
  return games ? won / games : 0;
}

/**
 * Short labels for column heads: the first letters of each name, lengthened until every label in
 * the league is distinct, so two managers called "Jake…" never share a column head.
 */
export function shortNames(names: string[], min = 4, max = 7): string[] {
  const clean = names.map(n => n.replace(/\s+/g, ''));
  for (let len = min; len <= max; len++) {
    const out = clean.map(n => n.slice(0, len));
    if (new Set(out.map(s => s.toLowerCase())).size === out.length) return out;
  }
  // Still colliding at the longest length: number the duplicates.
  const seen = new Map<string, number>();
  return clean.map(n => {
    const base = n.slice(0, max - 1);
    const k = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), k);
    return k === 1 ? base : `${base}${k}`;
  });
}

/**
 * How lucky the real schedule was, counted exactly over every schedule the league could have
 * drawn under the ROUND-ROBIN rule: a manager plays everyone once before anyone twice. So within
 * each cycle of (n − 1) weeks his opponents are distinct, and every valid ordering of opponents is
 * equally likely — by symmetry, relabelling the other teams maps any one onto any other.
 *
 * Within a cycle the orderings are counted by dynamic programming over weeks × the set of
 * opponents already used (a bitmask), tracking wins in half-units so a tie is half a win; cycles
 * are independent, so their win distributions are convolved. The real schedule's win total is then
 * placed in that distribution: `worse` orderings give fewer wins, `same` the same, `better` more,
 * and the percentile is worse + ½·same.
 *
 * Only weeks the manager really played count, as in the swap matrix, and only head-to-head games.
 * An opponent with no score in a week cannot be drawn that week. Matches Declan's definition and his
 * Graham's 2026 weeks 1–8 counts exactly (tests/scheduleSwap.test.ts).
 *
 * Cost is about 2^(n−1) × weeks × n per manager — trivial at 10 teams, a few million steps at 14.
 * Counts stay exact as doubles up to 2^53, far beyond any real league's ordering count.
 */
export function schedulePercentile(weeks: SwapWeek[], rosterId: number, actualWins: number): SchedulePercentile {
  const played = weeks.filter(wk => rosterId in wk.opponent && rosterId in wk.points);
  const others = [...new Set(played.flatMap(wk => Object.keys(wk.points).map(Number)))]
    .filter(o => o !== rosterId)
    .sort((a, b) => a - b);
  const m = others.length;

  // Win-count distribution in half-units, as exact counts: dist[h] = orderings giving h/2 wins.
  let dist: number[] = [1];
  for (let start = 0; start < played.length; start += Math.max(1, m)) {
    const cycle = played.slice(start, start + Math.max(1, m));
    dist = convolve(dist, cycleDistribution(cycle, rosterId, others));
  }

  const total = dist.reduce((a, b) => a + b, 0);
  const actual = Math.round(actualWins * 2);
  let worse = 0;
  let same = 0;
  let better = 0;
  dist.forEach((count, h) => {
    if (h < actual) worse += count;
    else if (h === actual) same += count;
    else better += count;
  });
  const share = (c: number) => (total ? c / total : 0);
  return {
    percentile: share(worse) + share(same) / 2,
    worse: share(worse),
    same: share(same),
    better: share(better),
    counts: { worse, same, better, total },
  };
}

/** One cycle: count every ordering of distinct opponents, by half-wins. */
function cycleDistribution(cycle: SwapWeek[], rosterId: number, others: number[]): number[] {
  const m = others.length;
  const width = 2 * cycle.length + 1;
  // dp[mask * width + h]: orderings of the cycle's first popcount(mask) weeks using exactly `mask`.
  let dp = new Map<number, Float64Array>([[0, (() => { const a = new Float64Array(width); a[0] = 1; return a; })()]]);
  for (const wk of cycle) {
    const mine = wk.points[rosterId];
    const next = new Map<number, Float64Array>();
    for (const [mask, counts] of dp) {
      for (let i = 0; i < m; i++) {
        const bit = 1 << i;
        if (mask & bit) continue;
        const theirs = wk.points[others[i]];
        if (theirs === undefined) continue;
        const d = mine - theirs;
        const gain = Math.abs(d) < 1e-9 ? 1 : d > 0 ? 2 : 0;
        const key = mask | bit;
        let row = next.get(key);
        if (!row) { row = new Float64Array(width); next.set(key, row); }
        for (let h = 0; h + gain < width; h++) if (counts[h]) row[h + gain] += counts[h];
      }
    }
    dp = next;
  }
  const out = new Array<number>(width).fill(0);
  for (const counts of dp.values()) counts.forEach((c, h) => { out[h] += c; });
  return out;
}

function convolve(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => { if (x) b.forEach((y, j) => { out[i + j] += x * y; }); });
  return out;
}

/** The whole matrix, in all-play order, with kindness and each row's best and worst schedule. */
export function buildScheduleSwap(
  league: ScheduleSwapResponse['league'],
  managers: Omit<SwapManager, 'short'>[],
  weeks: SwapWeek[],
): ScheduleSwapResponse {
  const rec = computeSwapRecords(weeks);
  const played = managers.filter(m => rec.has(m.rosterId));
  const rate = new Map(played.map(m => [m.rosterId, allPlayRate(weeks, m.rosterId)]));
  const ordered = [...played].sort((a, b) => rate.get(b.rosterId)! - rate.get(a.rosterId)! || a.name.localeCompare(b.name));
  const shorts = shortNames(ordered.map(m => m.name));

  const cells = ordered.map(x => {
    const row = rec.get(x.rosterId)!;
    const own = row.get(x.rosterId) ?? blank();
    return ordered.map(s => {
      const r = row.get(s.rosterId) ?? blank();
      return { ...r, delta: s.rosterId === x.rosterId ? null : swapWins(r) - swapWins(own) };
    });
  });

  const kindness = ordered.map((_, c) => {
    const others = cells.filter((_, r) => r !== c).map(row => row[c].delta!);
    return others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0;
  });

  const extreme = (row: SwapCell[], r: number, pick: (a: number, b: number) => boolean) => {
    let at = -1;
    row.forEach((cell, c) => {
      if (c === r || cell.delta === null) return;
      if (at < 0 || pick(cell.delta, row[at].delta!)) at = c;
    });
    return at;
  };

  return {
    league,
    weeksCounted: weeks.length,
    managers: ordered.map((m, i) => ({ ...m, short: shorts[i] })),
    cells,
    kindness,
    best: cells.map((row, r) => extreme(row, r, (a, b) => a > b)),
    worst: cells.map((row, r) => extreme(row, r, (a, b) => a < b)),
    percentile: ordered.map((x, r) => schedulePercentile(weeks, x.rosterId, swapWins(cells[r][r]))),
  };
}

/**
 * One week of Sleeper matchups as a SwapWeek, or null when it does not count.
 *
 * Opponents come from matchup_id pairs. A matchup_id held by one roster alone — guillotine, chopped
 * and survivor leagues give every roster its own — has no opponent, so that roster is absent from
 * `opponent` that week; a week with no pairs at all is null. So is an unplayed week: Sleeper lists
 * the whole season from day one with `points: 0`, and the week's total is what tells them apart.
 */
export function toSwapWeek(
  week: number,
  matchups: { roster_id: number; matchup_id: number | null; points: number | null }[],
): SwapWeek | null {
  const scored = matchups.filter(m => m.points !== null && m.points !== undefined);
  if (scored.reduce((sum, m) => sum + (m.points ?? 0), 0) <= 0) return null;

  const points: Record<number, number> = {};
  const byMatchup = new Map<number, number[]>();
  for (const m of scored) {
    points[m.roster_id] = m.points!;
    if (m.matchup_id == null) continue;
    byMatchup.set(m.matchup_id, [...(byMatchup.get(m.matchup_id) ?? []), m.roster_id]);
  }
  const opponent: Record<number, number> = {};
  for (const ids of byMatchup.values()) {
    if (ids.length !== 2) continue;
    opponent[ids[0]] = ids[1];
    opponent[ids[1]] = ids[0];
  }
  return Object.keys(opponent).length ? { week, points, opponent } : null;
}
