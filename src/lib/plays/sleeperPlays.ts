/**
 * Sleeper's undocumented GraphQL play feed.
 *
 * This is what Sleeper's own app uses. It is undocumented, so every call here assumes it can fail
 * or change shape, and the caller must be able to carry on without it.
 *
 * Two query shapes, and the difference decides the whole polling design:
 *
 *   game_id  the 20 MOST RECENT plays, ~0.02 MB, ~0.2s  <- what live polling uses
 *   week     ALL plays for the week, ~3 MB, ~2.8s       <- backfill and reconciliation only
 *
 * Poll per GAME, never per league: plays are global NFL events with no league context, so one
 * fetch serves every league and every user. Per-game is ~13 calls a minute against a documented
 * 1000/minute limit; per-league-per-game would be 234 a minute for a single user and gets the
 * server IP-blocked at three.
 */
const ENDPOINT = 'https://api.sleeper.app/graphql';

/** Sleeper documents 1000 calls/minute before IP-blocking. Stay far under it. */
export const SAFE_CALLS_PER_MINUTE = 60;

export type SleeperPlay = {
  play_id: string;
  game_id?: string | null;
  sequence?: number | null;
  time?: number | null;
  metadata?: Record<string, unknown> | null;
  play_stats?: { player_id: string; stats: Record<string, number> | null }[] | null;
};

export type SleeperScore = {
  game_id: string;
  status: string;
  start_time?: number | null;
  metadata?: Record<string, unknown> | null;
};

export class SleeperGraphqlError extends Error {
  constructor(message: string, readonly status?: number, readonly rateLimited = false) {
    super(message);
    this.name = 'SleeperGraphqlError';
  }
}

async function query<T>(gql: string): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql }),
    cache: 'no-store',
  });
  if (res.status === 429) {
    throw new SleeperGraphqlError('rate limited by Sleeper', 429, true);
  }
  if (!res.ok) throw new SleeperGraphqlError(`Sleeper returned ${res.status}`, res.status);
  const body = await res.json();
  if (body.errors) {
    throw new SleeperGraphqlError(`GraphQL error: ${JSON.stringify(body.errors).slice(0, 200)}`);
  }
  return body.data as T;
}

/** Every game in a week, with its live status. One call, whatever the league count. */
export async function fetchScores(
  season: string,
  week: number,
  seasonType = 'regular',
): Promise<SleeperScore[]> {
  const data = await query<{ scores: SleeperScore[] }>(
    `{scores(sport:"nfl",season:"${season}",season_type:"${seasonType}",week:${week}){
       game_id status start_time metadata }}`,
  );
  return data.scores ?? [];
}

/** The 20 most recent plays of one game — the live polling window. */
export async function fetchGamePlays(
  season: string,
  week: number,
  gameId: string,
  seasonType = 'regular',
): Promise<SleeperPlay[]> {
  const data = await query<{ plays: SleeperPlay[] }>(
    `{plays(sport:"nfl",season:"${season}",season_type:"${seasonType}",game_id:"${gameId}"){
       play_id game_id sequence time metadata play_stats{player_id stats} }}`,
  );
  return data.plays ?? [];
}

/** Every play of a week. Heavy (~3 MB) — backfill only, never in a poll loop. */
export async function fetchWeekPlays(
  season: string,
  week: number,
  seasonType = 'regular',
): Promise<SleeperPlay[]> {
  const data = await query<{ plays: SleeperPlay[] }>(
    `{plays(sport:"nfl",season:"${season}",season_type:"${seasonType}",week:${week}){
       play_id game_id sequence time metadata play_stats{player_id stats} }}`,
  );
  return data.plays ?? [];
}

/**
 * Statuses that mean a game is under way.
 *
 * Matched loosely on purpose: the exact vocabulary is undocumented (`pre_game` and `complete` are
 * confirmed by observation, `in_game` is inferred), so anything that is clearly neither pending
 * nor finished is treated as live. Polling a game that turns out to be over costs one cheap call;
 * missing one that is actually live loses plays we cannot get back.
 */
export function isGameLive(status: string): boolean {
  const s = (status ?? '').toLowerCase();
  if (!s) return false;
  if (s.includes('pre') || s.includes('sched')) return false;
  if (s.includes('complete') || s.includes('final') || s.includes('post')) return false;
  if (s.includes('cancel') || s.includes('postpone')) return false;
  return true;
}

/** Games run long. Past this much after kickoff, treat a game as over whatever the clock says. */
const MAX_GAME_MINUTES = 260;

/**
 * A second, independent reason to believe a game is on: the clock, not the label.
 *
 * `isGameLive` reads Sleeper's status string, and that string is undocumented — only `pre_game`
 * and `complete` have actually been observed. If a live game reported something this classifier
 * happened to read as pending, capture would report "no live games" and quietly bank nothing for
 * the whole slate, which is the one failure that cannot be repaired afterwards.
 *
 * So kickoff time is a fallback: past kickoff, not yet flagged complete, and inside a plausible
 * game length. Deliberately redundant with the status check rather than a replacement for it —
 * either one being right is enough.
 */
export function looksUnderway(game: SleeperScore, now = Date.now()): boolean {
  const status = (game.status ?? '').toLowerCase();
  if (status.includes('complete') || status.includes('final')) return false;
  if (status.includes('cancel') || status.includes('postpone')) return false;
  const start = game.start_time;
  if (typeof start !== 'number' || !Number.isFinite(start)) return false;
  const minutesSinceKickoff = (now - start) / 60_000;
  return minutesSinceKickoff >= 0 && minutesSinceKickoff <= MAX_GAME_MINUTES;
}
