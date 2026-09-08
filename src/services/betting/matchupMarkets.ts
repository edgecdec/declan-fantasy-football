import { SleeperService, SleeperLeague, SleeperMatchup } from '@/services/sleeper/sleeperService';
import { calculateProjectedPoints } from '@/services/stats/lineupOptimizer';
import { bestAvailableLineup, LineupCandidate, StreamedSlot } from '@/services/betting/bestLineup';
import { BENCH_SLOTS } from '@/services/stats/lineupSlots';
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

/**
 * One starting slot as the manager ACTUALLY set it, in roster order.
 *
 * Kept separate from `starters` (the priced lineup) because the two answer different
 * questions. `starters` is what the model assumes will play, with bench promotions and
 * waiver streams substituted in to price the matchup fairly. This is what is really in the
 * lineup right now — which is what you want when you open a matchup to look at the players.
 */
export type LineupSlot = {
  slot: string;
  playerId: string | null;
  name: string | null;
  position: string | null;
  /** Points scored so far. */
  points: number;
  projectedPoints: number;
  gameState: 'pre' | 'in' | 'post' | 'unknown';
};

export type MarketSide = {
  rosterId: number;
  ownerId: string | null;
  displayName: string;
  teamName?: string;
  avatar?: string;
  distribution: SideDistribution;
  /**
   * The lineup actually priced, including assumed promotions and streams. Exposed so
   * callers can attribute a side's projection back to individual players — which is what
   * a rooting-interest view needs.
   */
  starters: StarterInput[];
  /** The lineup as actually set, in roster-slot order. */
  lineup: LineupSlot[];
  /** Starters still capable of scoring. */
  playersRemaining: number;
  /** Bench players the model assumes will be started before kickoff. */
  assumedPromotions: { playerId: string; name: string; projectedPoints: number }[];
  /** Slots filled from waivers, priced as an averaged tier rather than a name. */
  assumedStreams: {
    slot: string;
    projectedPoints: number;
    spread: number;
    optionNames: string[];
  }[];
  /** Slots nobody could fill, which genuinely score nothing. */
  unfilledSlots: string[];
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

/** One player's projection, points so far, and where his NFL game stands. */
function buildCandidate(
  playerId: string,
  actualPoints: number,
  projections: Record<string, Record<string, number>>,
  scoringSettings: Record<string, number>,
  games: NflGamesResponse,
): LineupCandidate {
  const team = playerTeam(playerId);
  const gameId = team ? games.teamToGame[team] : undefined;
  const game = gameId ? games.games.find(g => g.id === gameId) : undefined;
  return {
    playerId,
    position: PLAYERS[playerId]?.position ?? null,
    actualPoints,
    projectedPoints: calculateProjectedPoints(projections[playerId], scoringSettings),
    // No game found (bye, free agent, unmapped code) means no upside left, and
    // the player must not be treated as swappable into an open slot.
    gameState: game ? game.state : 'unknown',
    remainingMinutes: game ? game.remainingMinutes : 0,
  };
}

/**
 * The lineup we actually price for one side: locked players stay put, and every
 * still-open slot is filled with the best available not-yet-started player,
 * bench included. See bestAvailableLineup for why.
 */
function buildStarters(
  matchup: SleeperMatchup,
  rosterPositions: string[],
  projections: Record<string, Record<string, number>>,
  scoringSettings: Record<string, number>,
  games: NflGamesResponse,
  freeAgents: LineupCandidate[],
  streamsByPosition: Map<string, number>,
): {
  starters: StarterInput[];
  promoted: LineupCandidate[];
  streamed: StreamedSlot[];
  unfilledSlots: string[];
} {
  const starterIds = matchup.starters ?? [];
  const starterPoints = matchup.starters_points ?? [];
  const playersPoints = matchup.players_points ?? {};

  const current = starterIds.map((pid, i) =>
    !pid || pid === '0'
      ? null
      : buildCandidate(pid, starterPoints[i] ?? 0, projections, scoringSettings, games),
  );

  const startingSet = new Set(starterIds.filter(p => p && p !== '0'));
  const bench = (matchup.players ?? [])
    .filter(pid => pid && pid !== '0' && !startingSet.has(pid))
    .map(pid => buildCandidate(pid, playersPoints[pid] ?? 0, projections, scoringSettings, games));

  const best = bestAvailableLineup(rosterPositions, current, bench, freeAgents, streamsByPosition);

  return {
    starters: best.starters.map(c => ({
      playerId: c.playerId,
      position: c.position,
      actualPoints: c.actualPoints,
      projectedPoints: c.projectedPoints,
      gameState: c.gameState,
      remainingMinutes: c.remainingMinutes,
      extraSd: c.extraSd,
    })),
    promoted: best.promoted,
    streamed: best.streamed,
    unfilledSlots: best.unfilledSlots,
  };
}

/**
 * The lineup exactly as Sleeper reports it, aligned to the league's starting slots.
 *
 * `starters` and `starters_points` are positionally aligned to the non-bench entries of
 * `roster_positions`, which is what makes the slot labels trustworthy here — the priced
 * lineup cannot be used for this, because it returns locked players first and then fills
 * open slots, so its order carries no slot meaning.
 */
function buildLineup(
  matchup: SleeperMatchup,
  rosterPositions: string[],
  projections: Record<string, Record<string, number>>,
  scoringSettings: Record<string, number>,
  games: NflGamesResponse,
): LineupSlot[] {
  const startingSlots = rosterPositions.filter(s => !BENCH_SLOTS.has(s));
  const ids = matchup.starters ?? [];
  const pts = matchup.starters_points ?? [];

  return startingSlots.map((slot, i) => {
    const pid = ids[i];
    if (!pid || pid === '0') {
      return { slot, playerId: null, name: null, position: null, points: 0, projectedPoints: 0, gameState: 'unknown' as const };
    }
    const team = playerTeam(pid);
    const gameId = team ? games.teamToGame[team] : undefined;
    const game = gameId ? games.games.find(g => g.id === gameId) : undefined;
    return {
      slot,
      playerId: pid,
      name: playerName(pid),
      position: PLAYERS[pid]?.position ?? null,
      points: pts[i] ?? 0,
      projectedPoints: calculateProjectedPoints(projections[pid], scoringSettings),
      gameState: game ? game.state : ('unknown' as const),
    };
  });
}

/**
 * Everyone at a streamable position who is not on any roster in the league.
 *
 * A manager who carries no kicker or defence all week and grabs one right before
 * kickoff would otherwise be priced as scoring zero in that slot. Restricted to
 * K and DEF, and to active players with a real projection, so this stays a
 * plausible waiver pool rather than the whole player database.
 */
function buildFreeAgentPool(
  rosters: { players: string[] | null }[],
  projections: Record<string, Record<string, number>>,
  scoringSettings: Record<string, number>,
  games: NflGamesResponse,
): LineupCandidate[] {
  const rostered = new Set<string>();
  for (const r of rosters) {
    for (const pid of r.players ?? []) rostered.add(pid);
  }

  const pool: LineupCandidate[] = [];
  for (const [playerId, row] of Object.entries(PLAYERS)) {
    if (rostered.has(playerId)) continue;
    const pos = row.position;
    if (pos !== 'K' && pos !== 'DEF') continue;
    if (!projections[playerId]) continue;
    const c = buildCandidate(playerId, 0, projections, scoringSettings, games);
    if (c.projectedPoints > 0) pool.push(c);
  }
  return pool;
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
  /**
   * Pre-fetched NFL game state. Supply it when pricing several leagues at once: the
   * scoreboard is identical for all of them, so fetching it per league is N round trips
   * for one answer.
   */
  sharedGames?: NflGamesResponse,
): Promise<MarketsResult | null> {
  const league = await SleeperService.getLeague(leagueId);
  if (!league) return null;

  const scoringSettings = league.scoring_settings;
  const rosterPositions = league.roster_positions;
  if (!scoringSettings || !rosterPositions) return null;

  const [matchups, projections, rosters, users, gamesRes] = await Promise.all([
    SleeperService.getMatchups(leagueId, week, { skipCache: true }),
    SleeperService.getWeeklyProjections(league.season, week),
    SleeperService.getRosters(leagueId),
    SleeperService.getLeagueUsers(leagueId),
    sharedGames
      ? Promise.resolve(sharedGames)
      : fetch('/api/betting/nfl-games').then(r => r.json() as Promise<NflGamesResponse>),
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

  const freeAgents = buildFreeAgentPool(rosters, projections, scoringSettings, gamesRes);
  // Shared across every side in the league: each successive team needing the same
  // position averages a tier one place further down the waiver board.
  const streamsByPosition = new Map<string, number>();

  const buildSide = (
    m: SleeperMatchup,
    starters: StarterInput[],
    promoted: LineupCandidate[],
    streamed: StreamedSlot[],
    unfilledSlots: string[],
  ): MarketSide => {
    const ownerId = ownerByRoster.get(m.roster_id) ?? null;
    const user = ownerId ? userById.get(ownerId) : undefined;
    return {
      rosterId: m.roster_id,
      ownerId,
      displayName: user?.display_name ?? `Roster ${m.roster_id}`,
      teamName: user?.metadata?.team_name,
      avatar: user?.avatar ?? undefined,
      distribution: sideDistribution(starters),
      starters,
      lineup: buildLineup(m, rosterPositions, projections, scoringSettings, gamesRes),
      playersRemaining: starters.filter(s => s.gameState === 'pre' || s.gameState === 'in').length,
      assumedPromotions: promoted.map(c => ({
        playerId: c.playerId,
        name: playerName(c.playerId),
        projectedPoints: c.projectedPoints,
      })),
      assumedStreams: streamed.map(s => ({
        slot: s.slot,
        projectedPoints: s.projectedPoints,
        spread: s.spread,
        optionNames: s.options.map(o => playerName(o.playerId)),
      })),
      unfilledSlots,
    };
  };

  const markets: MatchupMarket[] = [];

  for (const [matchupId, sides] of pairs) {
    if (sides.length !== 2) continue; // byes and odd league shapes have no market

    const lineupA = buildStarters(sides[0], rosterPositions, projections, scoringSettings, gamesRes, freeAgents, streamsByPosition);
    const lineupB = buildStarters(sides[1], rosterPositions, projections, scoringSettings, gamesRes, freeAgents, streamsByPosition);
    const startersA = lineupA.starters;
    const startersB = lineupB.starters;

    const a = buildSide(sides[0], startersA, lineupA.promoted, lineupA.streamed, lineupA.unfilledSlots);
    const b = buildSide(sides[1], startersB, lineupB.promoted, lineupB.streamed, lineupB.unfilledSlots);

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
