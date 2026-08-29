import { Player } from '@/types/player';
import { CacheService } from '@/services/common/cacheService';

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
    type?: number; // 0=redraft, 2=dynasty
    [key: string]: any;
  };
  roster_positions?: string[];
  scoring_settings?: Record<string, number>;
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
  starters_points?: number[];
  players_points?: Record<string, number>;
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
  slot_to_roster_id?: Record<string, number> | null;
  /** user_id -> draft slot (1-indexed). UNRELIABLE as a source of truth for "which seat
   *  am I": in a live 16-team draft this reported slot 1 for a user whose actual picks
   *  were #6/#27/#43, i.e. slot 6. Derive the seat from picks that have happened, and only
   *  fall back to this before any pick exists. */
  draft_order?: Record<string, number> | null;
  settings: {
    rounds: number;
    /** Round at which a snake reverses again (3rd-round reversal). 0/absent = plain snake. */
    reversal_round?: number;
    slots_bn: number;
    // Sleeper renames the generic flex slot to slots_rec_flex once a league also
    // has a slots_super_flex slot -- both need to be checked.
    slots_flex?: number;
    slots_rec_flex?: number;
    slots_super_flex?: number;
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

export type SleeperTradedPick = {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
};

export type SleeperLeagueUser = {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
};

export type SleeperWaiverBudget = {
  sender: number;   // roster_id sending FAAB
  receiver: number; // roster_id receiving FAAB
  amount: number;
};

/** Raw stat projections keyed by stat name (e.g. pass_yd, rush_td, rec) */
export type SleeperProjection = Record<string, number>;

/** Map of player_id -> projection stats for a single week */
export type SleeperWeeklyProjections = Record<string, SleeperProjection>;

/**
 * Sleeper's authoritative view of where the NFL calendar currently sits.
 * Preferred over deriving the season from the client clock: `season_type` and
 * `week` tell us whether real games have been played, which is what decides
 * when the analytics pages may flip to a new season.
 */
export type SleeperNflState = {
  season: string;
  previous_season: string;
  league_season: string;
  league_create_season: string;
  season_type: 'pre' | 'regular' | 'post' | 'off';
  week: number;
  display_week: number;
  leg: number;
  season_has_scores: boolean;
  season_start_date: string;
};

export type SleeperTransaction = {
  transaction_id: string;
  type: string; // 'trade', 'free_agent', 'waiver'
  status: string;
  roster_ids: number[];
  adds: Record<string, number> | null; // player_id -> roster_id
  drops: Record<string, number> | null;
  draft_picks?: SleeperTradedPick[];
  waiver_budget?: SleeperWaiverBudget[];
  creator: string;
  created: number;
  leg: number; // week number
};

export const SleeperService = {
  async getNflState(): Promise<SleeperNflState | null> {
    const cacheKey = 'nfl_state';
    const cached = CacheService.get<SleeperNflState>(cacheKey, 'local');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/state/nfl`);
      if (!res.ok) return null;
      const data = await res.json();
      // 1h TTL: week/season_type advance on Sleeper's schedule, not ours, and a
      // stale value here would pin every page's default season.
      CacheService.set(cacheKey, data, { storage: 'local', ttl: 1000 * 60 * 60 });
      return data;
    } catch (e) {
      console.error('Error fetching NFL state', e);
      return null;
    }
  },

  async getUser(username: string): Promise<SleeperUser | null> {
    const cacheKey = `user_${username.toLowerCase()}`;
    const cached = CacheService.get<SleeperUser>(cacheKey, 'local');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/user/${username}`);
      if (!res.ok) return null;
      const data = await res.json();
      CacheService.set(cacheKey, data, { storage: 'local', ttl: 1000 * 60 * 60 * 24 }); // 24h
      return data;
    } catch (e) {
      console.error('Error fetching user', e);
      return null;
    }
  },

  async getLeagues(userId: string, year: string): Promise<SleeperLeague[]> {
    const cacheKey = `leagues_${userId}_${year}`;
    const cached = CacheService.get<SleeperLeague[]>(cacheKey, 'local');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/user/${userId}/leagues/nfl/${year}`);
      if (!res.ok) return [];
      const data = await res.json();
      CacheService.set(cacheKey, data, { storage: 'local', ttl: 1000 * 60 * 60 * 12 }); // 12h
      return data;
    } catch (e) {
      console.error('Error fetching leagues', e);
      return [];
    }
  },

  async getMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
    const cacheKey = `matchups_${leagueId}_${week}`;
    const cached = CacheService.get<SleeperMatchup[]>(cacheKey, 'session');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/league/${leagueId}/matchups/${week}`);
      if (!res.ok) return [];
      const data = await res.json();
      CacheService.set(cacheKey, data, { storage: 'session' });
      return data;
    } catch (e) {
      console.error(`Error fetching matchups for league ${leagueId} week ${week}`, e);
      return [];
    }
  },

  async getTransactions(leagueId: string, week: number): Promise<SleeperTransaction[]> {
    const cacheKey = `transactions_${leagueId}_${week}`;
    const cached = CacheService.get<SleeperTransaction[]>(cacheKey, 'session');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/league/${leagueId}/transactions/${week}`);
      if (!res.ok) return [];
      const data = await res.json();
      CacheService.set(cacheKey, data, { storage: 'session' });
      return data;
    } catch (e) {
      console.error(`Error fetching transactions for league ${leagueId} week ${week}`, e);
      return [];
    }
  },

  /**
   * Returns true for a roster that was never really used — an abandoned team or a
   * dead test league — so callers can leave it out of analytics.
   *
   * Zero points alone is NOT sufficient evidence. Before Week 1 every roster in
   * every league has fpts === 0, including fully drafted dynasty teams, so a
   * points-only check hides the user's entire portfolio during the preseason.
   * A roster that holds players is a real roster whether or not it has scored,
   * so only treat it as empty when it has no players at all.
   */
  isZeroPointRoster(roster: SleeperRoster): boolean {
    const rosteredPlayers = roster.players?.length ?? 0;
    if (rosteredPlayers > 0) return false;
    const totalPoints = roster.settings.fpts + (roster.settings.fpts_decimal || 0) / 100;
    return totalPoints === 0;
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

  async getActiveSeasons(userId: string, requirePlayedGames: boolean = false): Promise<string[]> {
    const cacheKey = `active_seasons_${userId}_${requirePlayedGames}`;
    const cached = CacheService.get<string[]>(cacheKey, 'local');
    if (cached) return cached;

    const startYear = 2017;
    // Always check up to current year (and maybe next year if late in season, but current is fine for now)
    const currentYear = new Date().getFullYear();
    const yearsToCheck = Array.from({ length: currentYear - startYear + 1 }, (_, i) => (currentYear - i).toString());

    // Check all years in parallel
    const results = await Promise.all(yearsToCheck.map(async (year) => {
      try {
        const leagues = await this.getLeagues(userId, year);
        if (leagues.length === 0) return null;

        if (requirePlayedGames) {
           // Only include year if at least one league has started playing or is complete
           const hasGames = leagues.some(l => ['in_season', 'complete', 'playoffs'].includes(l.status));
           return hasGames ? year : null;
        }
        
        return year;
      } catch {
        return null;
      }
    }));

    const activeSeasons = results.filter((y): y is string => y !== null);
    
    // If no seasons found (e.g. API error or new user), return at least current year
    if (activeSeasons.length === 0 && !requirePlayedGames) activeSeasons.push(currentYear.toString());

    CacheService.set(cacheKey, activeSeasons, { storage: 'local', ttl: 1000 * 60 * 60 * 6 }); // 6h
    return activeSeasons;
  },

  async getWinnersBracket(leagueId: string): Promise<SleeperBracketMatch[]> {
    const cacheKey = `bracket_winners_${leagueId}`;
    const cached = CacheService.get<SleeperBracketMatch[]>(cacheKey, 'session');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/league/${leagueId}/winners_bracket`);
      if (!res.ok) return [];
      const data = await res.json();
      CacheService.set(cacheKey, data, { storage: 'session' });
      return data;
    } catch (e) {
      console.error(`Error fetching winners bracket for league ${leagueId}`, e);
      return [];
    }
  },

  async getLosersBracket(leagueId: string): Promise<SleeperBracketMatch[]> {
    const cacheKey = `bracket_losers_${leagueId}`;
    const cached = CacheService.get<SleeperBracketMatch[]>(cacheKey, 'session');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/league/${leagueId}/losers_bracket`);
      if (!res.ok) return [];
      const data = await res.json();
      CacheService.set(cacheKey, data, { storage: 'session' });
      return data;
    } catch (e) {
      console.error(`Error fetching losers bracket for league ${leagueId}`, e);
      return [];
    }
  },

  async getDrafts(userId: string, year: string): Promise<SleeperDraft[]> {
    const cacheKey = `drafts_${userId}_${year}`;
    const cached = CacheService.get<SleeperDraft[]>(cacheKey, 'session');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/user/${userId}/drafts/nfl/${year}`);
      if (!res.ok) return [];
      const data = await res.json();
      CacheService.set(cacheKey, data, { storage: 'session' });
      return data;
    } catch (e) {
      console.error('Error fetching drafts', e);
      return [];
    }
  },

  async getDraft(draftId: string, options: { skipCache?: boolean } = {}): Promise<SleeperDraft | null> {
    const cacheKey = `draft_${draftId}`;
    if (!options.skipCache) {
      const cached = CacheService.get<SleeperDraft>(cacheKey, 'session');
      if (cached) return cached;
    }

    try {
      const res = await fetch(`${BASE_URL}/draft/${draftId}`);
      if (!res.ok) return null;
      const data = await res.json();
      CacheService.set(cacheKey, data, { storage: 'session' });
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

  async getDraftTradedPicks(draftId: string): Promise<SleeperTradedPick[]> {
    const cacheKey = `draft_traded_picks_${draftId}`;
    const cached = CacheService.get<SleeperTradedPick[]>(cacheKey, 'session');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/draft/${draftId}/traded_picks`);
      if (!res.ok) return [];
      const data = await res.json();
      CacheService.set(cacheKey, data, { storage: 'session' });
      return data;
    } catch (e) {
      console.error(`Error fetching traded picks for draft ${draftId}`, e);
      return [];
    }
  },

  async getLeagueDrafts(leagueId: string): Promise<SleeperDraft[]> {
    const cacheKey = `league_drafts_${leagueId}`;
    const cached = CacheService.get<SleeperDraft[]>(cacheKey, 'session');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/league/${leagueId}/drafts`);
      if (!res.ok) return [];
      const data = await res.json();
      CacheService.set(cacheKey, data, { storage: 'session' });
      return data;
    } catch (e) {
      console.error(`Error fetching drafts for league ${leagueId}`, e);
      return [];
    }
  },

  async getLeagueUsers(leagueId: string): Promise<SleeperLeagueUser[]> {
    const cacheKey = `league_users_${leagueId}`;
    const cached = CacheService.get<SleeperLeagueUser[]>(cacheKey, 'session');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/league/${leagueId}/users`);
      if (!res.ok) return [];
      const data = await res.json();
      CacheService.set(cacheKey, data, { storage: 'session' });
      return data;
    } catch (e) {
      console.error(`Error fetching users for league ${leagueId}`, e);
      return [];
    }
  },

  async getLeague(leagueId: string): Promise<SleeperLeague | null> {
    const cacheKey = `league_${leagueId}`;
    const cached = CacheService.get<SleeperLeague>(cacheKey, 'local');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/league/${leagueId}`);
      if (!res.ok) return null;
      const data = await res.json();
      const ttl = data.status === 'complete' ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60;
      CacheService.set(cacheKey, data, { storage: 'local', ttl });
      return data;
    } catch (e) {
      console.error(`Error fetching league ${leagueId}`, e);
      return null;
    }
  },

  async getRosters(leagueId: string): Promise<SleeperRoster[]> {
    const cacheKey = `rosters_${leagueId}`;
    const cached = CacheService.get<SleeperRoster[]>(cacheKey, 'session');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/league/${leagueId}/rosters`);
      if (!res.ok) return [];
      const data: SleeperRoster[] = await res.json();
      CacheService.set(cacheKey, data, { storage: 'session', ttl: 1000 * 60 * 15 });
      return data;
    } catch (e) {
      console.error(`Error fetching rosters for league ${leagueId}`, e);
      return [];
    }
  },

  async getLeagueHistory(currentLeagueId: string): Promise<SleeperLeague[]> {
    const history: SleeperLeague[] = [];
    let currentId = currentLeagueId;

    while (currentId) {
      const cacheKey = `league_${currentId}`;
      let league = CacheService.get<SleeperLeague>(cacheKey, 'local');

      if (!league) {
        try {
          const res = await fetch(`${BASE_URL}/league/${currentId}`);
          if (!res.ok) break;
          league = await res.json();
          // League details never change once season is over
          const ttl = league!.status === 'complete' ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60;
          CacheService.set(cacheKey, league, { storage: 'local', ttl });
        } catch (e) {
          console.error(`Error fetching league ${currentId}`, e);
          break;
        }
      }

      if (league) {
        history.push(league);
        currentId = (league as any).previous_league_id;
      } else {
        break;
      }
      
      if (history.length > 20) break; 
    }

    return history;
  },

  async fetchAllRosters(
    leagues: SleeperLeague[], 
    userId: string,
    onProgress: (completed: number, total: number) => void
  ): Promise<Map<string, SleeperRoster>> {
    const results = new Map<string, SleeperRoster>();
    const total = leagues.length;
    let completed = 0;

    const leaguesToFetch = [];
    for (const league of leagues) {
      const cacheKey = `rosters_${league.league_id}`;
      const cachedRosters = CacheService.get<SleeperRoster[]>(cacheKey, 'session');
      
      if (cachedRosters) {
        const userRoster = cachedRosters.find(r => r.owner_id === userId);
        if (userRoster) {
          userRoster.league_id = league.league_id;
          results.set(league.league_id, userRoster);
        }
        completed++;
        onProgress(completed, total);
      } else {
        leaguesToFetch.push(league);
      }
    }

    if (leaguesToFetch.length === 0) return results;

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
            const ttl = league.status === 'complete' ? 1000 * 60 * 60 * 24 : 1000 * 60 * 15;
            CacheService.set(`rosters_${league.league_id}`, rosters, { storage: 'session', ttl });
            
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
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  },

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
          const cacheKey = `matchups_${league.league_id}_${week}`;
          const cached = CacheService.get<SleeperMatchup[]>(cacheKey, 'session');
          
          if (cached) {
            results.set(league.league_id, cached);
          } else {
            const res = await fetch(`${BASE_URL}/league/${league.league_id}/matchups/${week}`);
            if (res.ok) {
              const data = await res.json();
              const ttl = league.status === 'complete' ? 1000 * 60 * 60 * 24 : 1000 * 60 * 15;
              CacheService.set(cacheKey, data, { storage: 'session', ttl });
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
  },

  async getWeeklyProjections(season: string, week: number): Promise<SleeperWeeklyProjections> {
    const cacheKey = `projections_${season}_${week}`;
    const cached = CacheService.get<SleeperWeeklyProjections>(cacheKey, 'session');
    if (cached) return cached;

    try {
      const res = await fetch(`${BASE_URL}/projections/nfl/regular/${season}/${week}`);
      if (!res.ok) return {};
      const data: Record<string, SleeperProjection> = await res.json();
      // API returns { player_id: { stat: value, ... } } directly
      CacheService.set(cacheKey, data, { storage: 'session', ttl: 1000 * 60 * 60 });
      return data;
    } catch (e) {
      console.error(`Error fetching projections for ${season} week ${week}`, e);
      return {};
    }
  }
};
