import {
  SleeperGraphqlError,
  fetchGamePlays,
  fetchScores,
  fetchWeekPlays,
  isGameLive,
} from '@/lib/plays/sleeperPlays';
import { insertNewPlays, playCount } from '@/lib/plays/playStore';
import { metaAgeSeconds, readMeta, writeMeta } from '@/lib/meta';

/**
 * The live play capture loop.
 *
 * Two paths, deliberately, because they fail in opposite directions:
 *
 *   FAST      per live game, the 20 most recent plays, every poll. Low latency, tiny
 *             payload — but a fixed 20-play window can only see what happened recently,
 *             so anything that goes wrong for longer than that is lost.
 *   RECONCILE the whole week in one query, occasionally. Heavy (~3 MB) and slow, but it
 *             cannot have a gap, so it repairs whatever the fast path missed — including
 *             the plays of a game that was already in progress when polling started.
 *
 * The fast path alone would silently lose history on any outage longer than ~10 minutes of
 * game time; the slow path alone would be both laggy and wasteful. Together the feed is
 * near-real-time and eventually complete, which is the property that matters when the data
 * cannot be re-fetched later.
 *
 * COST. Sleeper documents 1000 calls/minute before IP-blocking. A poll is 1 scores call plus
 * one per live game: 2/min on a Thursday, ~10/min in the Sunday afternoon window, plus 4
 * reconciles an hour. That is ~1% of the budget, and it does not grow with the number of
 * leagues or users because plays are global NFL events — a point worth restating because the
 * obvious implementation (poll each league's matchups) is 234 calls a minute for ONE user
 * and gets the server blocked.
 */

const POLL_META = 'plays_last_poll';
const BACKFILL_META = 'plays_last_backfill';
const COOLDOWN_META = 'plays_rate_limit_until';

/** Fast-path cadence. Shorter buys little: Sleeper's own feed lags the broadcast. */
export const POLL_INTERVAL_SECONDS = 60;
/** Reconcile cadence while anything is live. */
const BACKFILL_INTERVAL_SECONDS = 900;
/** Politeness gap between per-game calls inside one sweep. */
const INTER_CALL_DELAY_MS = 150;
/**
 * How long to stand down after a 429.
 *
 * Long on purpose. Being rate-limited is the one failure that gets worse if you retry, and
 * missing five minutes of plays is recoverable by the reconcile path — an IP block is not.
 */
const RATE_LIMIT_COOLDOWN_SECONDS = 300;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export type PollResult = {
  ran: boolean;
  /** Why the sweep did not run, when it did not. */
  reason?: 'debounced' | 'cooling_down' | 'no_live_games' | 'state_unavailable' | 'rate_limited';
  season?: string;
  week?: number;
  liveGames: string[];
  newPlays: number;
  /** True when this sweep included a full-week reconcile. */
  reconciled: boolean;
  errors: string[];
};

const EMPTY: PollResult = { ran: false, liveGames: [], newPlays: 0, reconciled: false, errors: [] };

type NflState = { season: string; week: number; season_type: string };

/**
 * Current season and week, straight from Sleeper.
 *
 * Deliberately not going through SleeperService: that caches into localStorage, which does
 * not exist in the server process.
 */
async function fetchNflState(): Promise<NflState | null> {
  try {
    const res = await fetch('https://api.sleeper.app/v1/state/nfl', { cache: 'no-store' });
    if (!res.ok) return null;
    const s = await res.json();
    if (!s?.season || !s?.week) return null;
    return { season: String(s.season), week: Number(s.week), season_type: s.season_type ?? 'regular' };
  } catch {
    return null;
  }
}

function enterCooldown(): void {
  writeMeta(COOLDOWN_META, new Date(Date.now() + RATE_LIMIT_COOLDOWN_SECONDS * 1000).toISOString());
}

function coolingDown(): boolean {
  const until = readMeta(COOLDOWN_META);
  if (!until) return false;
  const ms = Date.parse(until);
  return Number.isFinite(ms) && ms > Date.now();
}

/**
 * Fetches an entire week and banks whatever is new.
 *
 * The gap-proof path. Expensive (~3 MB, ~3s) because it returns every play of every game,
 * so it is never in the per-minute loop — but it is the only query that can repair a gap,
 * since the per-game query only ever returns the last 20 plays. Also the backfill for a
 * completed week.
 */
export async function reconcileWeek(
  season: string,
  week: number,
  seasonType = 'regular',
): Promise<{ newPlays: number; error?: string }> {
  let all;
  try {
    all = await fetchWeekPlays(season, week, seasonType);
  } catch (e) {
    if (e instanceof SleeperGraphqlError && e.rateLimited) enterCooldown();
    return { newPlays: 0, error: String(e) };
  }

  // Grouped by game so each play is stored against the game it belongs to even though one
  // query returned the lot.
  const byGame = new Map<string, typeof all>();
  for (const p of all) {
    const id = p.game_id ?? 'unknown';
    const bucket = byGame.get(id);
    if (bucket) bucket.push(p);
    else byGame.set(id, [p]);
  }

  let newPlays = 0;
  for (const [gameId, plays] of byGame) {
    newPlays += insertNewPlays(season, week, gameId, plays).length;
  }
  return { newPlays };
}

/**
 * Runs one capture sweep.
 *
 * `force` skips the debounce, for the CLI and admin paths. Never skips the rate-limit
 * cooldown — that guard exists to protect the server's IP and is not the caller's to waive.
 */
export async function pollLivePlays(force = false): Promise<PollResult> {
  if (coolingDown()) return { ...EMPTY, reason: 'cooling_down' };

  if (!force) {
    const age = metaAgeSeconds(POLL_META);
    if (age !== null && age < POLL_INTERVAL_SECONDS) return { ...EMPTY, reason: 'debounced' };
  }
  writeMeta(POLL_META, new Date().toISOString());

  const state = await fetchNflState();
  if (!state) return { ...EMPTY, reason: 'state_unavailable' };
  const { season, week, season_type: seasonType } = state;

  const errors: string[] = [];
  let scores;
  try {
    scores = await fetchScores(season, week, seasonType);
  } catch (e) {
    if (e instanceof SleeperGraphqlError && e.rateLimited) {
      enterCooldown();
      return { ...EMPTY, reason: 'rate_limited', season, week };
    }
    return { ...EMPTY, season, week, errors: [String(e)] };
  }

  const live = scores.filter(g => isGameLive(g.status));
  if (live.length === 0) {
    return { ...EMPTY, reason: 'no_live_games', season, week };
  }

  let newPlays = 0;
  for (const game of live) {
    try {
      const plays = await fetchGamePlays(season, week, game.game_id, seasonType);
      newPlays += insertNewPlays(season, week, game.game_id, plays).length;
    } catch (e) {
      if (e instanceof SleeperGraphqlError && e.rateLimited) {
        // Stop the sweep entirely rather than working through the remaining games: the
        // limit is per-IP, so the next call would be refused too and would only deepen it.
        enterCooldown();
        return {
          ran: true, reason: 'rate_limited', season, week,
          liveGames: live.map(g => g.game_id), newPlays, reconciled: false,
          errors: [...errors, 'rate limited mid-sweep'],
        };
      }
      errors.push(`${game.game_id}: ${String(e)}`);
    }
    await sleep(INTER_CALL_DELAY_MS);
  }

  // The reconcile. Also runs on the very first sweep of a week, which is what backfills a
  // game that kicked off before the poller was watching.
  let reconciled = false;
  const backfillAge = metaAgeSeconds(BACKFILL_META);
  const neverBackfilled = backfillAge === null || playCount(season, week) === 0;
  if (neverBackfilled || backfillAge >= BACKFILL_INTERVAL_SECONDS) {
    const outcome = await reconcileWeek(season, week, seasonType);
    newPlays += outcome.newPlays;
    if (outcome.error) errors.push(`backfill: ${outcome.error}`);
    else {
      writeMeta(BACKFILL_META, new Date().toISOString());
      reconciled = true;
    }
  }

  return {
    ran: true, season, week,
    liveGames: live.map(g => g.game_id),
    newPlays, reconciled, errors,
  };
}

/**
 * Polls only if it is due, swallowing every failure.
 *
 * For read paths that want to keep capture warm without being able to break because of it.
 * The cron is the real driver; this is the backstop for when the cron is not running.
 */
export async function pollQuietly(): Promise<void> {
  try {
    await pollLivePlays();
  } catch (e) {
    console.error('play poll failed', e);
  }
}
