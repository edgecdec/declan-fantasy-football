import { SleeperService, SleeperLeague, SleeperMatchup } from '@/services/sleeper/sleeperService';
import { calculateProjectedPoints } from '@/services/stats/lineupOptimizer';
import playerData from '../../../data/sleeper_players.json';
import {
  StarterInput,
  PricedSides,
  isMarketOpen,
  matchupRemainingMinutes,
  priceSides,
  sideDistribution,
  winProbability,
  SideDistribution,
} from '@/services/betting/liveOdds';
import type { NflGamesResponse } from '@/app/api/betting/nfl-games/route';

/**
 * Builds priced head-to-head markets for a league week.
 *
 * Runs client-side deliberately: the projection-to-points conversion needs each
 * player's position and NFL team from data/sleeper_players.json, which is 22 MB
 * and already in the client bundle for the other pages. Parsing it in the Next
 * server process on a 1.9 GB box is not worth it. When wagers arrive, the server
 * will need to price authoritatively — that wants a slim player -> team/position
 * map generated at build time, not this whole file.
 */

type PlayerRow = {
  team?: string | null;
  position?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

const PLAYERS = (playerData as unknown as { players: Record<string, PlayerRow> }).players;

/** Sleeper team codes that differ from ESPN's. */
const TEAM_ALIASES: Record<string, string> = { WAS: 'WSH', OAK: 'LV' };

export type MarketSide = {
  rosterId: number;
  ownerId: string | null;
  displayName: string;
  teamName?: string;
  avatar?: string;
  distribution: SideDistribution;
  /** Starters still capable of scoring. */
  playersRemaining: number;
};

export type MatchupMarket = {
  matchupId: number;
  a: MarketSide;
  b: MarketSide;
  pricing: PricedSides;
  /** Summed regulation minutes across distinct unfinished games. */
  remainingMinutes: number;
  open: boolean;
};

export type MarketsResult = {
  league: SleeperLeague;
  week: number;
  markets: MatchupMarket[];
  /** True when the whole slate is done — every market settled. */
  allFinal: boolean;
};

function playerTeam(playerId: string): string | undefined {
  const team = PLAYERS[playerId]?.team;
  if (!team) return undefined;
  return TEAM_ALIASES[team] ?? team;
}

export function playerName(playerId: string): string {
  const p = PLAYERS[playerId];
  if (!p) return playerId;
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || playerId;
}

/** Turns one roster's matchup row into per-starter inputs for the odds model. */
function buildStarters(
  matchup: SleeperMatchup,
  projections: Record<string, Record<string, number>>,
  scoringSettings: Record<string, number>,
  games: NflGamesResponse,
): StarterInput[] {
  const starters = matchup.starters ?? [];
  const starterPoints = matchup.starters_points ?? [];

  return starters
    .map((playerId, index): StarterInput | null => {
      if (!playerId || playerId === '0') return null;

      const team = playerTeam(playerId);
      const gameId = team ? games.teamToGame[team] : undefined;
      const game = gameId ? games.games.find(g => g.id === gameId) : undefined;

      return {
        playerId,
        position: PLAYERS[playerId]?.position ?? null,
        actualPoints: starterPoints[index] ?? 0,
        projectedPoints: calculateProjectedPoints(projections[playerId], scoringSettings),
        // No game found (bye, free agent, unmapped code) means no upside left.
        gameState: game ? game.state : 'unknown',
        remainingMinutes: game ? game.remainingMinutes : 0,
      };
    })
    .filter((s): s is StarterInput => s !== null);
}

/**
 * Fetches everything a league week's markets need and prices them.
 *
 * `week` should be the week currently being played, so callers pass
 * `nflState.week` directly rather than using completedWeekCount(), which
 * deliberately excludes the in-progress week.
 */
export async function buildMatchupMarkets(
  leagueId: string,
  week: number,
): Promise<MarketsResult | null> {
  const league = await SleeperService.getLeague(leagueId);
  if (!league) return null;

  const scoringSettings = league.scoring_settings;
  if (!scoringSettings) return null;

  const [matchups, projections, rosters, users, gamesRes] = await Promise.all([
    SleeperService.getMatchups(leagueId, week, { skipCache: true }),
    SleeperService.getWeeklyProjections(league.season, week),
    SleeperService.getRosters(leagueId),
    SleeperService.getLeagueUsers(leagueId),
    fetch('/api/betting/nfl-games').then(r => r.json() as Promise<NflGamesResponse>),
  ]);

  if (!gamesRes?.ok) return null;

  const ownerByRoster = new Map(rosters.map(r => [r.roster_id, r.owner_id ?? null]));
  const userById = new Map(users.map(u => [u.user_id, u]));

  const pairs = new Map<number, SleeperMatchup[]>();
  for (const m of matchups) {
    if (m.matchup_id == null) continue;
    const list = pairs.get(m.matchup_id) ?? [];
    list.push(m);
    pairs.set(m.matchup_id, list);
  }

  const buildSide = (m: SleeperMatchup, starters: StarterInput[]): MarketSide => {
    const ownerId = ownerByRoster.get(m.roster_id) ?? null;
    const user = ownerId ? userById.get(ownerId) : undefined;
    return {
      rosterId: m.roster_id,
      ownerId,
      displayName: user?.display_name ?? `Roster ${m.roster_id}`,
      teamName: user?.metadata?.team_name,
      avatar: user?.avatar ?? undefined,
      distribution: sideDistribution(starters),
      playersRemaining: starters.filter(s => s.gameState === 'pre' || s.gameState === 'in').length,
    };
  };

  const markets: MatchupMarket[] = [];

  for (const [matchupId, sides] of pairs) {
    if (sides.length !== 2) continue; // byes and odd league shapes have no market

    const startersA = buildStarters(sides[0], projections, scoringSettings, gamesRes);
    const startersB = buildStarters(sides[1], projections, scoringSettings, gamesRes);

    const a = buildSide(sides[0], startersA);
    const b = buildSide(sides[1], startersB);

    const probA = winProbability(a.distribution, b.distribution);
    const remaining = matchupRemainingMinutes(
      [...startersA, ...startersB],
      pid => {
        const team = playerTeam(pid);
        return team ? gamesRes.teamToGame[team] : undefined;
      },
    );

    markets.push({
      matchupId,
      a,
      b,
      pricing: priceSides(probA),
      remainingMinutes: remaining,
      open: isMarketOpen(remaining),
    });
  }

  markets.sort((x, y) => x.matchupId - y.matchupId);

  return {
    league,
    week,
    markets,
    allFinal: markets.length > 0 && markets.every(m => m.remainingMinutes === 0),
  };
}
