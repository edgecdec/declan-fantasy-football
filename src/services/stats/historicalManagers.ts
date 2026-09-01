import { SleeperService } from '@/services/sleeper/sleeperService';
import { analyzePositionalBenchmarks } from '@/services/stats/positionalBenchmarks';
import { analyzeLeagueAllManagers } from '@/services/stats/lineupOptimizer';

/** Positions the matrix can show, in display order. */
export const HISTORICAL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

/** League statuses that have produced enough games to analyse. */
const ANALYSABLE_STATUSES = ['complete', 'in_season'];

export type ManagerIdentity = {
  ownerId: string;
  displayName: string;
  teamName?: string;
  avatar?: string;
};

/** One manager's numbers for one season. Nulls mean "no data", not zero. */
export type ManagerSeasonCell = {
  season: string;
  /** Points per start minus that season's league mean, per position. */
  positionalEdge: Record<string, number | null>;
  /** started points / optimal points x 100 — already season-normalised. */
  lineupEfficiency: number | null;
  /** Share of weeks the manager fielded a non-losing lineup. */
  optimalRate: number | null;
  /** Actual points left on the bench across the season. */
  pointsLeft: number | null;
  /** Mean positional edge across the positions this manager actually started. */
  avgPositionalEdge: number | null;
};

export type LeagueManagerHistory = {
  /** Ascending, oldest first. */
  seasons: string[];
  managers: ManagerIdentity[];
  /** Only positions some manager actually started — keeps empty K/DEF columns out. */
  activePositions: string[];
  /** ownerId -> season -> cell */
  cells: Record<string, Record<string, ManagerSeasonCell>>;
  /** ownerId -> position -> mean edge across every season with data. */
  avgPositionalEdge: Record<string, Record<string, number | null>>;
  /** ownerId -> how many seasons contributed data. */
  seasonsPlayed: Record<string, number>;
};

function emptyHistory(): LeagueManagerHistory {
  return { seasons: [], managers: [], activePositions: [], cells: {}, avgPositionalEdge: {}, seasonsPlayed: {} };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Per-manager, per-season skill history for one league's full chain of seasons.
 *
 * Both underlying analyses already compute every manager in the league in a
 * single pass — analyzePositionalBenchmarks returns allRosterStats/rosterMeta,
 * and analyzeLeagueAllManagers walks the season's weeks once for everyone. So
 * this costs the same per season as looking at a single manager did, and the
 * positional half is served from the same cache key the Efficiency tab warms.
 *
 * Positional values are expressed as an edge against the mean of the managers
 * in that same season, computed here rather than taken from
 * leagueAverageStats: that keeps the matrix internally consistent (rows are
 * deviations from the average manager shown) and independent of which userId
 * happened to warm the cache. Raw points would not be comparable across
 * seasons anyway, since scoring settings and week counts drift.
 */
export async function analyzeLeagueManagerHistory(
  leagueId: string,
  userId: string,
  onProgress?: (done: number, total: number, season: string) => void,
): Promise<LeagueManagerHistory> {
  const chain = await SleeperService.getLeagueHistory(leagueId);
  const leagues = chain
    .filter(l => ANALYSABLE_STATUSES.includes(l.status))
    .sort((a, b) => a.season.localeCompare(b.season));

  if (leagues.length === 0) return emptyHistory();

  const identities = new Map<string, ManagerIdentity>();
  const cells: Record<string, Record<string, ManagerSeasonCell>> = {};
  const seasons: string[] = [];
  const positionsWithData = new Set<string>();

  for (let i = 0; i < leagues.length; i++) {
    const league = leagues[i];
    const season = league.season;
    onProgress?.(i, leagues.length, season);

    try {
      const [bench, decisions] = await Promise.all([
        analyzePositionalBenchmarks(league, userId),
        analyzeLeagueAllManagers(league.league_id, season),
      ]);

      const decisionsByOwner = new Map(decisions.map(d => [d.userId ?? '', d]));

      // Season league mean per position: unweighted across managers who
      // actually started someone there, so a manager who never started a K
      // doesn't drag the K baseline to zero.
      const seasonMean: Record<string, number | null> = {};
      if (bench) {
        for (const pos of HISTORICAL_POSITIONS) {
          const vals: number[] = [];
          for (const stats of Object.values(bench.allRosterStats)) {
            const s = stats[pos];
            if (s && s.starterCount > 0) vals.push(s.avgPointsPerStarter);
          }
          seasonMean[pos] = mean(vals);
          if (vals.length > 0) positionsWithData.add(pos);
        }

        for (const meta of Object.values(bench.rosterMeta)) {
          if (!identities.has(meta.userId)) {
            identities.set(meta.userId, {
              ownerId: meta.userId,
              displayName: meta.displayName,
              teamName: meta.teamName,
              avatar: meta.avatar,
            });
          }
        }
      }

      const ownerIds = new Set<string>([
        ...(bench ? Object.keys(bench.allRosterStats) : []),
        ...decisions.map(d => d.userId ?? '').filter(Boolean),
      ]);

      for (const ownerId of ownerIds) {
        const positionalEdge: Record<string, number | null> = {};
        const edges: number[] = [];

        const rosterStats = bench?.allRosterStats[ownerId];
        for (const pos of HISTORICAL_POSITIONS) {
          const s = rosterStats?.[pos];
          const baseline = seasonMean[pos];
          if (s && s.starterCount > 0 && baseline != null) {
            const edge = s.avgPointsPerStarter - baseline;
            positionalEdge[pos] = edge;
            edges.push(edge);
          } else {
            positionalEdge[pos] = null;
          }
        }

        const dec = decisionsByOwner.get(ownerId);
        cells[ownerId] = cells[ownerId] ?? {};
        cells[ownerId][season] = {
          season,
          positionalEdge,
          lineupEfficiency: dec ? dec.skillEfficiency : null,
          optimalRate: dec ? dec.decisionAccuracy : null,
          pointsLeft: dec ? dec.totalActualPointsLeftOnBench : null,
          avgPositionalEdge: mean(edges),
        };
      }

      seasons.push(season);
    } catch (e) {
      console.warn(`Manager history failed for season ${season}`, e);
    }

    onProgress?.(i + 1, leagues.length, season);
  }

  // Multi-season average per position, ignoring seasons with no data there.
  const avgPositionalEdge: Record<string, Record<string, number | null>> = {};
  const seasonsPlayed: Record<string, number> = {};

  for (const ownerId of Object.keys(cells)) {
    const perPos: Record<string, number | null> = {};
    for (const pos of HISTORICAL_POSITIONS) {
      const vals: number[] = [];
      for (const season of seasons) {
        const edge = cells[ownerId][season]?.positionalEdge[pos];
        if (edge != null) vals.push(edge);
      }
      perPos[pos] = mean(vals);
    }
    avgPositionalEdge[ownerId] = perPos;
    seasonsPlayed[ownerId] = seasons.filter(s => cells[ownerId][s]).length;
  }

  const managers = Array.from(identities.values())
    .filter(m => cells[m.ownerId])
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    seasons,
    managers,
    activePositions: HISTORICAL_POSITIONS.filter(p => positionsWithData.has(p)),
    cells,
    avgPositionalEdge,
    seasonsPlayed,
  };
}
