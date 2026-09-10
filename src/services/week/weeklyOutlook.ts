import { SleeperLeague, SleeperService } from '@/services/sleeper/sleeperService';
import {
  MarketSide,
  buildMatchupMarkets,
  playerName,
} from '@/services/betting/matchupMarkets';
import { REGULATION_MINUTES, SideDistribution } from '@/services/betting/liveOdds';
import { calculateProjectedPoints } from '@/services/stats/lineupOptimizer';
import type { NflGamesResponse } from '@/app/api/betting/nfl-games/route';
import playerData from '../../../data/sleeper_players.json';

/**
 * One week, every league, from the point of view of a single manager.
 *
 * Two questions, one set of data. "How am I doing?" is the matchup view. "Who do I want
 * to do well?" is the rooting view, and it is derived from the same lineups rather than
 * fetched separately — the answer is entirely determined by who is starting for me and
 * who is starting against me.
 *
 * No league include/exclude here, unlike the season-long pages. Those exclude leagues so
 * a guillotine or best-ball format does not corrupt a season aggregate; at the weekly
 * level there is nothing to corrupt — a league either has a head-to-head matchup this
 * week or it does not, and the ones that do not simply drop out on their own.
 */

export type MatchupStatus = 'not_started' | 'live' | 'final';

export type LeagueWeekOutlook = {
  leagueId: string;
  leagueName: string;
  league: SleeperLeague;
  week: number;
  me: MarketSide;
  /** Null when this league gives no head-to-head opponent this week (bye, odd format). */
  opponent: MarketSide | null;
  /** Probability I win this matchup, from the same model the betting markets use. */
  winProbability: number;
  remainingMinutes: number;
  status: MatchupStatus;
};

/** A league a player is starting in, and whether that league has a real opponent. */
export type RootingLeagueRef = {
  leagueId: string;
  leagueName: string;
  /**
   * False for formats with no head-to-head opponent — guillotine, chopped, survivor. In
   * those every roster gets its own matchup_id, so there is nobody to beat, only a score
   * to post.
   */
  headToHead: boolean;
};

/** My actual starters in a league that has no head-to-head opponent this week. */
export type LineupOnlyLeague = {
  leagueId: string;
  leagueName: string;
  starters: { playerId: string; position: string | null; projectedPoints: number; gameState: string; remainingMinutes: number }[];
};

export type RootingRow = {
  playerId: string;
  name: string;
  position: string | null;
  /** ESPN game id, so rows can be grouped by NFL game. */
  gameId?: string;
  /** Sleeper's NFL team code, for filtering the list down to a game you are watching. */
  team: string | null;
  /**
   * Where this player's NFL game stands.
   *
   * One value per row even though a row spans leagues, because a player has exactly one game.
   * Read off the same team-to-game map as `gameId` rather than from any league's starter entry,
   * so it cannot disagree with itself when a player starts in eight leagues.
   */
  gameState: 'pre' | 'in' | 'post' | 'unknown';
  /** Projected points still to come where this player starts FOR me. */
  forPoints: number;
  /** ...and where he starts AGAINST me. */
  againstPoints: number;
  /**
   * Expected WINS riding on this player, netted across HEAD-TO-HEAD leagues only.
   * Positive means root for him.
   *
   * Restricted to head-to-head because that is the only format where it is defined. A
   * guillotine or chopped league has no opponent and therefore no win probability to take a
   * derivative of — you are trying not to post the lowest score in the league, which is a
   * different and much less tractable quantity. Rather than invent a number for those, they
   * contribute to the league count and to points, and `swingLeagues` records how many
   * leagues the weighted figure actually covers so the UI can say so.
   *
   * Units matter here and are easy to get wrong. Per league the term is
   * (points still to come) x (win probability per point), which is a probability. Summed
   * over several leagues it is a count of expected wins, so it can legitimately exceed
   * 1.0 — a defence started in eight leagues came out at +1.33. Rendering it as a
   * percentage produces "+133%", which is meaningless.
   *
   * It is not the same ordering as points. Twenty points in a matchup already 97% won is
   * worth almost nothing; six in a coin flip can be worth a tenth of a win. See
   * `winSensitivity`.
   */
  netSwing: number;
  /** Leagues where he helps me, and where he hurts me. */
  forLeagues: RootingLeagueRef[];
  againstLeagues: RootingLeagueRef[];
  /** How many of those leagues are head-to-head, i.e. contributed to `netSwing`. */
  swingLeagues: number;
  /**
   * The headline number: leagues starting him FOR me minus leagues starting him AGAINST
   * me. +3 means three more of my matchups want him to go off than want him to disappear.
   *
   * Deliberately kept alongside `netSwing` rather than instead of it, because they
   * genuinely disagree and both readings are useful. League count is the intuitive one and
   * treats every matchup as equally important; netSwing weights each by how close that
   * matchup actually is, so a single player in one nail-biter can outrank a player who is
   * +2 across three blowouts. When the two point opposite ways, that is worth seeing.
   */
  netLeagues: number;
};

export type WeeklyOutlook = {
  week: number;
  season: string;
  matchups: LeagueWeekOutlook[];
  /**
   * Leagues where I have a lineup but no opponent (guillotine, chopped). They produce no
   * matchup row, but the players in them are absolutely still worth rooting for — which is
   * the whole reason they are collected separately rather than dropped.
   */
  lineupOnly: LineupOnlyLeague[];
  rooting: RootingRow[];
  /** Leagues that returned nothing usable, so the UI can say so rather than hide them. */
  skipped: { leagueId: string; leagueName: string; reason: string }[];
};

const PLAYERS = (playerData as unknown as {
  players: Record<string, { team?: string | null; position?: string | null }>;
}).players;

/** Same table, named for the lookup it serves in the lineup-only path. */
const POSITIONS = PLAYERS;

/** Sleeper team codes that differ from ESPN's. Same two aliases as the pricing path. */
const TEAM_ALIASES: Record<string, string> = { WAS: 'WSH', OAK: 'LV' };

function espnTeamOf(playerId: string): string | undefined {
  const team = PLAYERS[playerId]?.team;
  if (!team) return undefined;
  return TEAM_ALIASES[team] ?? team;
}

/** Standard normal density. */
function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * How much one extra point for me is worth, in win probability, in this matchup.
 *
 * d/dx of the normal CDF at the current margin: phi(z)/sd. It peaks when the matchup is
 * level and collapses once it is decided, which is exactly the weighting a rooting
 * interest wants — it is why a blowout stops mattering and a close game dominates.
 */
export function winSensitivity(mine: SideDistribution, theirs: SideDistribution): number {
  const sd = Math.sqrt(mine.variance + theirs.variance);
  if (!(sd > 0)) return 0;
  const z = (mine.mean - theirs.mean) / sd;
  return normalPdf(z) / sd;
}

/** Points a starter can still add: all of them before kickoff, none once final. */
export function remainingProjection(starter: {
  projectedPoints: number;
  gameState: string;
  remainingMinutes: number;
}): number {
  if (starter.gameState === 'post' || starter.gameState === 'unknown') return 0;
  const fraction =
    starter.gameState === 'pre'
      ? 1
      : Math.min(1, Math.max(0, starter.remainingMinutes / REGULATION_MINUTES));
  return Math.max(0, starter.projectedPoints) * fraction;
}

function statusFor(remainingMinutes: number, anyPointsScored: boolean): MatchupStatus {
  if (remainingMinutes <= 0) return 'final';
  return anyPointsScored ? 'live' : 'not_started';
}

/**
 * Builds the whole week for one manager.
 *
 * `week` is the week being PLAYED, so callers pass Sleeper's `state.week` rather than
 * completedWeekCount(), which deliberately excludes the in-progress week.
 */
export async function buildWeeklyOutlook(
  userId: string,
  season: string,
  week: number,
): Promise<WeeklyOutlook> {
  const leagues = await SleeperService.getLeagues(userId, season);

  // One scoreboard for every league. Fetched here and passed down, because it is the same
  // answer for all of them and buildMatchupMarkets would otherwise request it per league.
  const games = await fetch('/api/betting/nfl-games')
    .then(r => r.json() as Promise<NflGamesResponse>)
    .catch(() => null);

  const matchups: LeagueWeekOutlook[] = [];
  const skipped: WeeklyOutlook['skipped'] = [];

  const results = await Promise.all(
    leagues.map(async league => {
      try {
        const priced = await buildMatchupMarkets(league.league_id, week, games ?? undefined);
        return { league, priced };
      } catch {
        return { league, priced: null };
      }
    }),
  );

  // Leagues with no head-to-head pairing, which still have a lineup worth rooting for.
  const noOpponent: { leagueId: string; leagueName: string }[] = [];

  for (const { league, priced } of results) {
    const mine = priced?.markets.find(
      m => m.a.ownerId === userId || m.b.ownerId === userId,
    );

    if (!mine) {
      // Guillotine, chopped and survivor formats give every roster its own matchup_id, so
      // there is no pair to price — but the starters are still playing, so collect them
      // rather than discarding the league.
      noOpponent.push({ leagueId: league.league_id, leagueName: league.name });
      continue;
    }

    const iAmA = mine.a.ownerId === userId;
    const me = iAmA ? mine.a : mine.b;
    const opponent = iAmA ? mine.b : mine.a;
    const winProbability = iAmA ? mine.pricing.probA : mine.pricing.probB;
    const scored = me.distribution.banked > 0 || opponent.distribution.banked > 0;

    matchups.push({
      leagueId: league.league_id,
      leagueName: league.name,
      league,
      week,
      me,
      opponent,
      winProbability,
      remainingMinutes: mine.remainingMinutes,
      status: statusFor(mine.remainingMinutes, scored),
    });
  }

  // Closest matchups first: those are the ones worth watching, and they are also the ones
  // driving the rooting numbers.
  matchups.sort(
    (x, y) => Math.abs(x.winProbability - 0.5) - Math.abs(y.winProbability - 0.5),
  );

  const lineupOnlyResults = await Promise.all(
    noOpponent.map(async lg => {
      try {
        return await buildLineupOnly(lg.leagueId, lg.leagueName, season, week, userId, games);
      } catch {
        return null;
      }
    }),
  );

  const lineupOnly: LineupOnlyLeague[] = [];
  noOpponent.forEach((lg, i) => {
    const built = lineupOnlyResults[i];
    if (built) lineupOnly.push(built);
    else {
      // Listed rather than silently dropped: usually a league that has not drafted yet.
      skipped.push({
        leagueId: lg.leagueId,
        leagueName: lg.leagueName,
        reason: 'no lineup set for this week yet',
      });
    }
  });

  return {
    week,
    season,
    matchups,
    lineupOnly,
    rooting: buildRootingRows(matchups, games, lineupOnly),
    skipped,
  };
}

/**
 * Nets every league's lineups into one per-player rooting interest.
 *
 * A player can be on my team in one league and my opponent's in another, which is the
 * whole reason this needs to net rather than list. When that happens the two cancel to
 * the extent the matchups are equally tight, and the sign tells you which side wins out.
 */
export function buildRootingRows(
  matchups: LeagueWeekOutlook[],
  games: NflGamesResponse | null,
  /**
   * Leagues where I have a lineup but no opponent. Their starters are rooted FOR, and they
   * contribute nothing to `netSwing` because there is no win probability to move.
   */
  lineupOnly: LineupOnlyLeague[] = [],
): RootingRow[] {
  const byPlayer = new Map<string, RootingRow>();

  const row = (playerId: string, position: string | null): RootingRow => {
    const existing = byPlayer.get(playerId);
    if (existing) return existing;
    const created: RootingRow = {
      playerId,
      name: playerName(playerId),
      position,
      gameId: undefined,
      // From the player database, so it is present whether or not the scoreboard loaded.
      team: PLAYERS[playerId]?.team ?? null,
      gameState: 'unknown',
      forPoints: 0,
      againstPoints: 0,
      netSwing: 0,
      forLeagues: [],
      againstLeagues: [],
      netLeagues: 0,
      swingLeagues: 0,
    };
    byPlayer.set(playerId, created);
    return created;
  };

  const addRef = (list: RootingLeagueRef[], ref: RootingLeagueRef) => {
    if (!list.some(x => x.leagueId === ref.leagueId)) list.push(ref);
  };

  for (const m of matchups) {
    if (!m.opponent) continue;
    if (m.status === 'final') continue; // nothing left to root for

    const sensitivity = winSensitivity(m.me.distribution, m.opponent.distribution);
    const ref: RootingLeagueRef = {
      leagueId: m.leagueId,
      leagueName: m.leagueName,
      headToHead: true,
    };

    for (const s of m.me.starters) {
      const pts = remainingProjection(s);
      if (pts <= 0) continue;
      const r = row(s.playerId, s.position ?? null);
      r.forPoints += pts;
      r.netSwing += pts * sensitivity;
      addRef(r.forLeagues, ref);
    }

    for (const s of m.opponent.starters) {
      const pts = remainingProjection(s);
      if (pts <= 0) continue;
      const r = row(s.playerId, s.position ?? null);
      r.againstPoints += pts;
      r.netSwing -= pts * sensitivity;
      addRef(r.againstLeagues, ref);
    }
  }

  // Formats with no opponent: guillotine, chopped, survivor. You still want every one of
  // these players to score as much as possible, so they count for — just without a weight,
  // because "avoid being lowest in the league" has no clean derivative to take.
  for (const lg of lineupOnly) {
    const ref: RootingLeagueRef = {
      leagueId: lg.leagueId,
      leagueName: lg.leagueName,
      headToHead: false,
    };
    for (const s of lg.starters) {
      const pts = remainingProjection(s);
      if (pts <= 0) continue;
      const r = row(s.playerId, s.position ?? null);
      r.forPoints += pts;
      addRef(r.forLeagues, ref);
    }
  }

  if (games) {
    // Attach the NFL game so the UI can group by kickoff, using the same team->game map
    // the pricing uses.
    for (const r of byPlayer.values()) {
      const team = espnTeamOf(r.playerId);
      r.gameId = team ? games.teamToGame[team] : undefined;
      const game = r.gameId ? games.games.find(g => g.id === r.gameId) : undefined;
      r.gameState = game ? game.state : 'unknown';
    }
  }

  const rows = [...byPlayer.values()];
  for (const r of rows) {
    r.netLeagues = r.forLeagues.length - r.againstLeagues.length;
    r.swingLeagues =
      r.forLeagues.filter(l => l.headToHead).length
      + r.againstLeagues.filter(l => l.headToHead).length;
  }

  // Strongest feelings first, in either direction. Ordered by swing rather than league
  // count because swing accounts for how much each matchup is actually in the balance;
  // ties break on league count so the ordering stays stable and readable.
  return rows.sort(
    (a, b) =>
      Math.abs(b.netSwing) - Math.abs(a.netSwing)
      || Math.abs(b.netLeagues) - Math.abs(a.netLeagues)
      || a.name.localeCompare(b.name),
  );
}

/**
 * My actual starters in a league that produced no head-to-head matchup.
 *
 * Uses the starters as literally set, with no best-lineup substitution. That machinery
 * exists to price a matchup fairly; here it would be inventing players to root for.
 */
async function buildLineupOnly(
  leagueId: string,
  leagueName: string,
  season: string,
  week: number,
  userId: string,
  games: NflGamesResponse | null,
): Promise<LineupOnlyLeague | null> {
  const [league, rosters, matchups] = await Promise.all([
    SleeperService.getLeague(leagueId),
    SleeperService.getRosters(leagueId),
    SleeperService.getMatchups(leagueId, week, { skipCache: true }),
  ]);
  const scoring = league?.scoring_settings;
  if (!scoring) return null;

  const myRoster = rosters.find(r => r.owner_id === userId);
  if (!myRoster) return null;
  const mine = matchups.find(m => m.roster_id === myRoster.roster_id);
  const starterIds = (mine?.starters ?? []).filter(p => p && p !== '0');
  if (starterIds.length === 0) return null;

  const projections = await SleeperService.getWeeklyProjections(season, week);

  return {
    leagueId,
    leagueName,
    starters: starterIds.map(pid => {
      const team = espnTeamOf(pid);
      const gameId = team && games ? games.teamToGame[team] : undefined;
      const game = gameId && games ? games.games.find(g => g.id === gameId) : undefined;
      return {
        playerId: pid,
        position: POSITIONS[pid]?.position ?? null,
        projectedPoints: calculateProjectedPoints(projections[pid], scoring),
        gameState: game ? game.state : 'unknown',
        remainingMinutes: game ? game.remainingMinutes : 0,
      };
    }),
  };
}

/** Re-exported so the page can render names without importing the betting module. */
export { playerName };
