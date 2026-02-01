import { Player } from '@/types/player';

const BASE_URL = 'https://api.sleeper.app/v1';

export type SleeperUser = {
  username: string;
  user_id: string;
  display_name: string;
  avatar: string;
};

export type SleeperLeague = {
  league_id: string;
  name: string;
  total_rosters: number;
  status: string;
  sport: string;
  season: string;
  avatar?: string;
  settings: {
    playoff_week_start?: number;
    [key: string]: any;
  };
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string;
  league_id: string;
  players: string[] | null; // Array of player IDs
  starters: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
  };
};

export type SleeperMatchup = {
  starters: string[];
  roster_id: number;
  players: string[];
  matchup_id: number;
  points: number;
  custom_points: number | null;
};

// Cache keys
const CACHE_PREFIX = 'sleeper_cache_';
const CACHE_DURATION_MS = 1000 * 60 * 15; // 15 minutes

// Helper to handle caching
function getCached<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const item = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!item) return null;
    const parsed = JSON.parse(item);
    if (Date.now() - parsed.timestamp > CACHE_DURATION_MS) {
      sessionStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function setCached(key: string, data: any) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      timestamp: Date.now(),
      data
    }));
  } catch (e) {
    console.warn('Session storage full or disabled', e);
  }
}

export const SleeperService = {
  async getUser(username: string): Promise<SleeperUser | null> {
    const cacheKey = `user_${username.toLowerCase()}`;
    const cached = getCached<SleeperUser>(cacheKey);
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/user/${username}`);
      if (!res.ok) return null;
      const data = await res.json();
      setCached(cacheKey, data);
      return data;
    } catch (e) {
      console.error('Error fetching user', e);
      return null;
    }
  },

  async getLeagues(userId: string, year: string): Promise<SleeperLeague[]> {
    const cacheKey = `leagues_${userId}_${year}`;
    const cached = getCached<SleeperLeague[]>(cacheKey);
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/user/${userId}/leagues/nfl/${year}`);
      if (!res.ok) return [];
      const data = await res.json();
      setCached(cacheKey, data);
      return data;
    } catch (e) {
      console.error('Error fetching leagues', e);
      return [];
    }
  },

  async getMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
    const cacheKey = `matchups_${leagueId}_${week}`;
    const cached = getCached<SleeperMatchup[]>(cacheKey);
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/league/${leagueId}/matchups/${week}`);
      if (!res.ok) return [];
      const data = await res.json();
      setCached(cacheKey, data);
      return data;
    } catch (e) {
      console.error(`Error fetching matchups for league ${leagueId} week ${week}`, e);
      return [];
    }
  },

  shouldIgnoreLeague(league: SleeperLeague): boolean {
    const name = league.name.toLowerCase();
    // Keywords to exclude
    if (name.includes('guillotine') || 
        name.includes('chopped') || 
        name.includes('test') || 
        name.includes('mock') ||
        name.includes('best ball') ||
        name.includes('bestball')) {
      return true;
    }
    // Check settings if available (settings.type might be 0, 1, 2 etc. but documentation is sparse)
    // Guillotine usually has specific roster settings, but name is most reliable for now.
    return false;
  },

  // Batch fetch rosters with concurrency limit
  async fetchAllRosters(
    leagues: SleeperLeague[], 
    userId: string,
    onProgress: (completed: number, total: number) => void
  ): Promise<Map<string, SleeperRoster>> {
    const results = new Map<string, SleeperRoster>(); // league_id -> roster
    const total = leagues.length;
    let completed = 0;

    // Filter out leagues we already have in cache
    const leaguesToFetch = [];
    for (const league of leagues) {
      const cacheKey = `rosters_${league.league_id}`;
      const cachedRosters = getCached<SleeperRoster[]>(cacheKey);
      
      if (cachedRosters) {
        // Find user's roster in cached data
        const userRoster = cachedRosters.find(r => r.owner_id === userId);
        if (userRoster) {
          userRoster.league_id = league.league_id; // Ensure ID is attached
          results.set(league.league_id, userRoster);
        }
        completed++;
        onProgress(completed, total);
      } else {
        leaguesToFetch.push(league);
      }
    }

    if (leaguesToFetch.length === 0) return results;

    // Concurrency Helper
    const CONCURRENCY_LIMIT = 5;
    const chunks = [];
    for (let i = 0; i < leaguesToFetch.length; i += CONCURRENCY_LIMIT) {
      chunks.push(leaguesToFetch.slice(i, i + CONCURRENCY_LIMIT));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (league) => {
        try {
          const res = await fetch(`${BASE_URL}/league/${league.league_id}/rosters`);
          if (res.ok) {
            const rosters: SleeperRoster[] = await res.json();
            // Cache ALL rosters for this league (valuable for other features later)
            setCached(`rosters_${league.league_id}`, rosters);
            
            const userRoster = rosters.find(r => r.owner_id === userId);
            if (userRoster) {
              userRoster.league_id = league.league_id;
              results.set(league.league_id, userRoster);
            }
          }
        } catch (e) {
          console.error(`Failed to fetch rosters for league ${league.league_id}`, e);
        } finally {
          completed++;
          onProgress(completed, total);
        }
      }));
      
      // Small delay to be nice to API
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }
};
