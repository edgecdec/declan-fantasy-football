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
  previous_league_id?: string;
  avatar?: string;
  settings: {
    playoff_week_start?: number;
    playoff_type?: number; // 0=Consolation, 1=Toilet Bowl
    playoff_teams?: number;
    league_average_match?: number;
    [key: string]: any;
  };
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string;
  league_id: string;
  players: string[] | null; 
  starters: string[] | null;
  reserve?: string[] | null; // IR
  taxi?: string[] | null; // Taxi Squad
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
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

export type SleeperBracketMatch = {
  r: number; // round
  m: number; // match id
  t1: number | null; // roster id 1
  t2: number | null; // roster id 2
  w: number | null; // winner roster id
  l: number | null; // loser roster id
  p?: number; // place
  t1_from?: { w?: number; l?: number } | null;
  t2_from?: { w?: number; l?: number } | null;
};

export type SleeperDraft = {
  draft_id: string;
  league_id: string;
  season: string;
  status: string; // "pre_draft", "drafting", "complete"
  type: string; // "snake", "linear"
  settings: {
    rounds: number;
    slots_bn: number;
    slots_flex: number;
    slots_rb: number;
    slots_wr: number;
    slots_te: number;
    slots_qb: number;
    slots_k: number;
    slots_def: number;
    teams: number;
    pick_time: number;
  };
  metadata: {
    name: string;
    description: string;
  };
};

export type SleeperDraftPick = {
  pick_no: number;
  round: number;
  draft_slot: number;
  player_id: string;
  picked_by: string;
  roster_id: number;
  is_keeper: boolean | null;
  metadata: {
    first_name: string;
    last_name: string;
    position: string;
    team: string;
  };
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
    // 1. Settings-based Exclusion
    if (league.settings.type === 3) return true; // Guillotine / Elimination
    if (league.settings.best_ball === 1) return true; // Best Ball (No H2H usually)

    // 2. Name-based Exclusion
    const name = league.name.toLowerCase();
    if (name.includes('test') || 
        name.includes('mock') ||
        name.includes('guillotine') || // Fallback if type is not 3
        name.includes('chopped') ||
        name.includes('eliminator')) {
      return true;
    }
    
    return false;
  },

  async getActiveSeasons(userId: string): Promise<string[]> {
    const cacheKey = `active_seasons_${userId}`;
    const cached = getCached<string[]>(cacheKey);
    if (cached) return cached;

    const startYear = 2017;
    // Always check up to current year (and maybe next year if late in season, but current is fine for now)
    const currentYear = new Date().getFullYear();
    const yearsToCheck = Array.from({ length: currentYear - startYear + 1 }, (_, i) => (currentYear - i).toString());

    // Check all years in parallel
    const results = await Promise.all(yearsToCheck.map(async (year) => {
      try {
        const leagues = await this.getLeagues(userId, year);
        return leagues.length > 0 ? year : null;
      } catch {
        return null;
      }
    }));

    const activeSeasons = results.filter((y): y is string => y !== null);
    
    // If no seasons found (e.g. API error or new user), return at least current year
    if (activeSeasons.length === 0) activeSeasons.push(currentYear.toString());

    setCached(cacheKey, activeSeasons);
    return activeSeasons;
  },

  async getWinnersBracket(leagueId: string): Promise<SleeperBracketMatch[]> {
    const cacheKey = `bracket_winners_${leagueId}`;
    const cached = getCached<SleeperBracketMatch[]>(cacheKey);
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/league/${leagueId}/winners_bracket`);
      if (!res.ok) return [];
      const data = await res.json();
      setCached(cacheKey, data);
      return data;
    } catch (e) {
      console.error(`Error fetching winners bracket for league ${leagueId}`, e);
      return [];
    }
  },

  async getLosersBracket(leagueId: string): Promise<SleeperBracketMatch[]> {
    const cacheKey = `bracket_losers_${leagueId}`;
    const cached = getCached<SleeperBracketMatch[]>(cacheKey);
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/league/${leagueId}/losers_bracket`);
      if (!res.ok) return [];
      const data = await res.json();
      setCached(cacheKey, data);
      return data;
    } catch (e) {
      console.error(`Error fetching losers bracket for league ${leagueId}`, e);
      return [];
    }
  },

  async getDrafts(userId: string, year: string): Promise<SleeperDraft[]> {
    const cacheKey = `drafts_${userId}_${year}`;
    const cached = getCached<SleeperDraft[]>(cacheKey);
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/user/${userId}/drafts/nfl/${year}`);
      if (!res.ok) return [];
      const data = await res.json();
      setCached(cacheKey, data);
      return data;
    } catch (e) {
      console.error('Error fetching drafts', e);
      return [];
    }
  },

  async getDraft(draftId: string): Promise<SleeperDraft | null> {
    const cacheKey = `draft_${draftId}`;
    const cached = getCached<SleeperDraft>(cacheKey);
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/draft/${draftId}`);
      if (!res.ok) return null;
      const data = await res.json();
      setCached(cacheKey, data);
      return data;
    } catch (e) {
      console.error(`Error fetching draft ${draftId}`, e);
      return null;
    }
  },

  async getDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
    // Live data - no cache for picks
    try {
      const res = await fetch(`${BASE_URL}/draft/${draftId}/picks`);
      if (!res.ok) return [];
      const data = await res.json();
      return data;
    } catch (e) {
      console.error(`Error fetching draft picks ${draftId}`, e);
      return [];
    }
  },

  async getLeagueHistory(currentLeagueId: string): Promise<SleeperLeague[]> {
    const history: SleeperLeague[] = [];
    let currentId = currentLeagueId;

    while (currentId) {
      const cacheKey = `league_${currentId}`;
      let league = getCached<SleeperLeague>(cacheKey);

      if (!league) {
        try {
          const res = await fetch(`${BASE_URL}/league/${currentId}`);
          if (!res.ok) break;
          league = await res.json();
          setCached(cacheKey, league);
        } catch (e) {
          console.error(`Error fetching league ${currentId}`, e);
          break;
        }
      }

      if (league) {
        history.push(league);
        currentId = (league as any).previous_league_id; // Cast to access unchecked prop
      } else {
        break;
      }
      
      // Safety break for loops
      if (history.length > 20) break; 
    }

    return history;
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
  },

  // Batch fetch matchups for a specific week
  async fetchAllMatchups(
    leagues: SleeperLeague[],
    week: number,
    onProgress: (completed: number, total: number) => void
  ): Promise<Map<string, SleeperMatchup[]>> {
    const results = new Map<string, SleeperMatchup[]>();
    const total = leagues.length;
    let completed = 0;

    const CONCURRENCY_LIMIT = 5;
    const chunks = [];
    for (let i = 0; i < leagues.length; i += CONCURRENCY_LIMIT) {
      chunks.push(leagues.slice(i, i + CONCURRENCY_LIMIT));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (league) => {
        try {
          // Check cache inside the loop to allow partial caching if needed
          const cacheKey = `matchups_${league.league_id}_${week}`;
          const cached = getCached<SleeperMatchup[]>(cacheKey);
          
          if (cached) {
            results.set(league.league_id, cached);
          } else {
            const res = await fetch(`${BASE_URL}/league/${league.league_id}/matchups/${week}`);
            if (res.ok) {
              const data = await res.json();
              setCached(cacheKey, data);
              results.set(league.league_id, data);
            }
          }
        } catch (e) {
          console.error(`Failed to fetch matchups for league ${league.league_id}`, e);
        } finally {
          completed++;
          onProgress(completed, total);
        }
      }));
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }
};
