/**
 * Server-side league context for the play feed: scoring settings, rosters and this week's
 * lineups, for every league a user is in.
 *
 * Not reusing SleeperService for this, deliberately: that layer caches into localStorage,
 * which does not exist in the Node process. So these are plain fetches with a small
 * in-process cache.
 *
 * The cache matters more than it looks. Building the feed needs four calls per league
 * (league, rosters, users, matchups) and a user can be in eighteen of them — 72 calls to
 * render one page. Cached, a room full of people watching the same slate costs 72 calls
 * every few minutes instead of 72 per pageview.
 */
import type { FeedLeague, RosterSpot } from '@/services/plays/playFeed';

const BASE = 'https://api.sleeper.app/v1';

/**
 * Rosters and settings change on waiver runs, not during a game. Lineups lock at kickoff.
 * Two minutes is short enough to pick up a Sunday-morning start/sit and long enough to
 * absorb a refresh-happy audience.
 */
const CACHE_TTL_MS = 120_000;

type Entry = { value: unknown; at: number };
const cache = new Map<string, Entry>();

async function cachedJson<T>(url: string): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const value = (await res.json()) as T;
    cache.set(url, { value, at: Date.now() });
    return value;
  } catch {
    return null;
  }
}

type League = {
  league_id: string;
  name: string;
  scoring_settings: Record<string, number>;
  settings: { type?: number; best_ball?: number };
};
type Roster = {
  roster_id: number;
  owner_id: string | null;
  co_owners?: string[] | null;
  players: string[] | null;
};
type LeagueUser = { user_id: string; display_name: string };
type Matchup = { roster_id: number; matchup_id: number | null; starters: string[] | null };

export type LeagueContextResult = {
  leagues: FeedLeague[];
  /** Leagues that could not be loaded, so the caller can say so rather than silently drop them. */
  failed: string[];
};

export async function resolveUserId(username: string): Promise<string | null> {
  const user = await cachedJson<{ user_id?: string }>(`${BASE}/user/${encodeURIComponent(username)}`);
  return user?.user_id ?? null;
}

export async function listLeagues(userId: string, season: string): Promise<League[]> {
  return (await cachedJson<League[]>(`${BASE}/user/${userId}/leagues/nfl/${season}`)) ?? [];
}

/**
 * Builds the per-league roster maps the feed scores against.
 *
 * Every league is included, including the formats the analytics pages skip. A guillotine or
 * best-ball league has no head-to-head opponent, but the user still has players in it and
 * still wants to know when they score — dropping it would silently hide real points. Those
 * leagues simply have no `against` side.
 */
export async function buildLeagueContexts(
  userId: string,
  season: string,
  week: number,
): Promise<LeagueContextResult> {
  const leagues = await listLeagues(userId, season);
  const failed: string[] = [];

  const built = await Promise.all(
    leagues.map(async (league): Promise<FeedLeague | null> => {
      const [rosters, users, matchups] = await Promise.all([
        cachedJson<Roster[]>(`${BASE}/league/${league.league_id}/rosters`),
        cachedJson<LeagueUser[]>(`${BASE}/league/${league.league_id}/users`),
        cachedJson<Matchup[]>(`${BASE}/league/${league.league_id}/matchups/${week}`),
      ]);
      if (!rosters) {
        failed.push(league.name);
        return null;
      }

      const nameByUser = new Map((users ?? []).map(u => [u.user_id, u.display_name]));
      const mine = rosters.find(
        r => r.owner_id === userId || (r.co_owners ?? []).includes(userId),
      );

      // Opponent via this week's matchup_id pairing. Absent in formats with no head-to-head,
      // which is expected rather than an error.
      const myMatchup = matchups?.find(m => m.roster_id === mine?.roster_id);
      const opponentRosterId =
        myMatchup?.matchup_id != null
          ? matchups?.find(
              m => m.matchup_id === myMatchup.matchup_id && m.roster_id !== mine?.roster_id,
            )?.roster_id ?? null
          : null;

      const roster = new Map<string, RosterSpot>();
      for (const r of rosters) {
        const side: RosterSpot['side'] =
          r.roster_id === mine?.roster_id ? 'for'
          : r.roster_id === opponentRosterId ? 'against'
          : 'other';
        // Only the two sides that matter to the viewer are mapped. Including every other
        // team would score every play against every roster in every league for no gain.
        if (side === 'other') continue;

        // This week's SUBMITTED lineup, which is what actually scores. Falling back to the
        // roster's current `starters` would misreport anyone swapped after kickoff.
        const starters = new Set(
          matchups?.find(m => m.roster_id === r.roster_id)?.starters ?? [],
        );
        // Bench players are included, flagged as non-starters. Their points do not count,
        // but "the guy you benched just scored" is information, and the caller can filter.
        for (const playerId of new Set([...starters, ...(r.players ?? [])])) {
          if (!playerId) continue;
          roster.set(playerId, {
            rosterId: r.roster_id,
            ownerName: r.owner_id ? nameByUser.get(r.owner_id) ?? null : null,
            isStarter: starters.has(playerId),
            side,
          });
        }
      }

      return {
        leagueId: league.league_id,
        leagueName: league.name,
        scoring: league.scoring_settings ?? {},
        roster,
      };
    }),
  );

  return { leagues: built.filter((l): l is FeedLeague => l !== null), failed };
}
