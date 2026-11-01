import { CacheService } from '@/services/common/cacheService';
import {
  buildDefenceModel,
  type DefenceHistory,
  type DefenceModel,
  type DefenceStatLine,
} from '@/services/betting/defenceModel';

/**
 * Loads the actual DEF stat lines the league-relative DEF model trails over, and builds the model.
 *
 * Source: Sleeper's position-filtered stats endpoint, about 30 rows (~40 KB) a week — not the v1
 * all-players feed, which is a megabyte or two a week and would need 35 of them by December. CORS
 * is open (`access-control-allow-origin: *`), so the browser-side matchup markets and the
 * server-side betting pricing use the same loader.
 *
 * A finished week's stats barely change (stat corrections land within a few days), so each week
 * is fetched once and memoised for the life of the process / page, and in sessionStorage in the
 * browser. The prior season is effectively immutable. The pricing tick runs every minute in a
 * slate; it must not turn into 35 requests a minute.
 */

const DEF_STATS_URL = (season: string, week: number) =>
  `https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular&position%5B%5D=DEF`;

/** Regular-season weeks. 18 since 2021; asking for a week that does not exist returns []. */
export const REGULAR_SEASON_WEEKS = 18;

const HOUR = 1000 * 60 * 60;
/** The most recent finished week may still take stat corrections. */
const RECENT_WEEK_TTL = HOUR;
const COMPLETED_WEEK_TTL = 12 * HOUR;
const PRIOR_SEASON_TTL = 7 * 24 * HOUR;

/** Sleeper's precomputed totals and ranks: never scored by a league, and most of the payload. */
const DROP_PREFIXES = ['pos_rank', 'fan_pts', 'pts_std', 'pts_ppr', 'pts_half_ppr'];

type Fetcher = (url: string) => Promise<unknown>;

const defaultFetcher: Fetcher = async url => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

/** One week's played team-games, stripped to numeric stats. Rows with no game played are dropped. */
export function parseDefenceWeek(payload: unknown): DefenceStatLine[] {
  if (!Array.isArray(payload)) return [];
  const out: DefenceStatLine[] = [];
  for (const row of payload as { stats?: Record<string, unknown> }[]) {
    const stats = row?.stats;
    if (!stats || !(Number(stats.gp) > 0)) continue;
    const line: DefenceStatLine = {};
    for (const [k, v] of Object.entries(stats)) {
      if (typeof v !== 'number' || DROP_PREFIXES.some(p => k.startsWith(p))) continue;
      line[k] = v;
    }
    out.push(line);
  }
  return out;
}

const memo = new Map<string, { expires: number; promise: Promise<DefenceStatLine[] | null> }>();

/** One week's lines, or null when the fetch failed (and is not remembered, so it is retried). */
function weekLines(
  season: string,
  week: number,
  ttl: number,
  fetcher: Fetcher,
): Promise<DefenceStatLine[] | null> {
  const key = `defstats_${season}_${week}`;
  const hit = memo.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;

  const promise = (async () => {
    const cached = CacheService.get<DefenceStatLine[]>(key, 'session');
    if (cached) return cached;
    try {
      const lines = parseDefenceWeek(await fetcher(DEF_STATS_URL(season, week)));
      CacheService.set(key, lines, { storage: 'session', ttl });
      return lines;
    } catch (e) {
      // Not memoised: a failed week must be retried next time, not remembered as empty.
      memo.delete(key);
      console.warn(`DEF history: ${season} week ${week} unavailable`, e);
      return null;
    }
  })();
  memo.set(key, { expires: Date.now() + ttl, promise });
  return promise;
}

/**
 * At most this many history requests in flight. A cold load is up to 35 small requests; firing them
 * all at once tripped getaddrinfo failures from Node on a laptop in the dry run, and there is no
 * reason to burst Sleeper either.
 */
const MAX_IN_FLIGHT = 6;

async function inPool<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  }));
  return out;
}

/** Whole-history loads in flight or recently finished, so twenty leagues priced at once share one. */
const historyMemo = new Map<string, { expires: number; promise: Promise<DefenceHistory> }>();

/**
 * The prior season in full plus this season's weeks before `week`.
 *
 * Previewing next week while this one is in progress would include a half-played week; the
 * effect is a fraction of a point on the trailing mean, and it is gone once the week finishes.
 */
export function loadDefenceHistory(
  season: string,
  week: number,
  fetcher: Fetcher = defaultFetcher,
): Promise<DefenceHistory> {
  const key = `${season}:${week}`;
  const hit = historyMemo.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;

  const priorSeason = String(Number(season) - 1);
  const tasks: { current: boolean; run: () => Promise<DefenceStatLine[] | null> }[] = [];
  for (let w = 1; w <= REGULAR_SEASON_WEEKS; w++) {
    tasks.push({ current: false, run: () => weekLines(priorSeason, w, PRIOR_SEASON_TTL, fetcher) });
  }
  for (let w = 1; w < Math.min(week, REGULAR_SEASON_WEEKS + 1); w++) {
    const ttl = w === week - 1 ? RECENT_WEEK_TTL : COMPLETED_WEEK_TTL;
    tasks.push({ current: true, run: () => weekLines(season, w, ttl, fetcher) });
  }

  const promise = inPool(tasks.map(t => t.run), MAX_IN_FLIGHT).then(results => {
    // A partial history is still usable, but must not be remembered: the next call retries.
    if (results.some(r => r === null)) historyMemo.delete(key);
    const pick = (current: boolean) =>
      results.flatMap((r, i) => (tasks[i].current === current && r ? r : []));
    return { prior: pick(false), current: pick(true) };
  });
  historyMemo.set(key, { expires: Date.now() + RECENT_WEEK_TTL, promise });
  return promise;
}

/** Guard messages already logged, so a per-minute pricing tick logs each league-week once. */
const reported = new Set<string>();

/**
 * The DEF model for one league-week, or null when the history is unavailable — in which case the
 * caller's repaired projection is priced on the position shape. Never throws.
 *
 * Logs the level guard once per league-week when it fires, and when Sleeper's `def_pr_yd`
 * identity stops holding (a sign the feed changed).
 */
export async function loadDefenceModel(args: {
  season: string;
  week: number;
  scoring: Record<string, number>;
  projections: Record<string, Record<string, number>>;
  /** For log lines: which league this is. */
  label: string;
  fetcher?: Fetcher;
}): Promise<DefenceModel | null> {
  try {
    const history = await loadDefenceHistory(args.season, args.week, args.fetcher);
    const model = buildDefenceModel({ scoring: args.scoring, projections: args.projections, history });
    const key = `${args.label}:${args.season}:${args.week}`;
    if (!model) {
      if (!reported.has(key)) {
        reported.add(key);
        console.warn(`DEF model unavailable for ${key}: pricing DEFs on the position shape`);
      }
      return null;
    }
    const g = model.guard;
    if ((g.fired || g.identityRows < g.slateRows) && !reported.has(key)) {
      reported.add(key);
      console.warn(
        `DEF level guard ${key}: repaired slate mean ${model.slateMean.toFixed(2)} vs trailing actual `
        + `${model.actualMean.toFixed(2)} (${g.level >= 0 ? '+' : ''}${g.level.toFixed(2)}; Sleeper raw `
        + `${g.rawLevel >= 0 ? '+' : ''}${g.rawLevel.toFixed(2)}); def_pr_yd identity on `
        + `${g.identityRows}/${g.slateRows} rows`,
      );
    }
    return model;
  } catch (e) {
    console.warn(`DEF model failed for ${args.label}`, e);
    return null;
  }
}
