import { SleeperLeague, SleeperService } from '@/services/sleeper/sleeperService';
import {
  MarketSide,
  buildMatchupMarkets,
  playerName,
} from '@/services/betting/matchupMarkets';
import {
  REGULATION_MINUTES,
  SideDistribution,
  StarterInput,
  sideDistribution,
} from '@/services/betting/liveOdds';
import { defenceCorrection } from '@/services/betting/defenseBrackets';
import {
  CHOPPED_LEAGUE_TYPE,
  LeagueFormat,
  hasNoHeadToHead,
  leagueFormat,
} from '@/services/week/leagueFormat';
import { RosterScore, eliminationProbabilities } from '@/services/week/choppedRisk';
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

/**
 * Where a matchup stands.
 *
 * `live` means a starter is ON THE FIELD right now, not merely that the week is unfinished.
 * The distinction needs its own value for the gap between slates — after Thursday night, or
 * between the Sunday and Monday games, points are banked and minutes remain but nobody is
 * playing. Calling that `live` was wrong, and calling it `not_started` would be worse.
 */
export type MatchupStatus = 'not_started' | 'live' | 'between' | 'final';

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

/** What is at stake in a league that eliminates its lowest scorer. */
export type EliminationRisk = {
  leagueId: string;
  leagueName: string;
  format: LeagueFormat;
  /** My chance of posting the lowest score and going out this week. Zero once eliminated. */
  probability: number;
  /** Rosters still alive, me included. */
  activeRosters: number;
  /** True when I am already out of this league. */
  eliminated: boolean;
};

export type WeeklyOutlook = {
  week: number;
  season: string;
  matchups: LeagueWeekOutlook[];
  /**
   * Per-league elimination risk, for the formats that have it.
   *
   * Summed, this is the EXPECTED ELIMINATIONS for the week: 1.0 means going out of one league on
   * average. It reads low by nature — two chopped leagues of 17 and 15 live rosters put the
   * floor around 0.12 — and that is the point. It is a count of leagues, not a percentage, so it
   * is directly comparable to the expected-wins figure beside it.
   */
  eliminations: EliminationRisk[];
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

function statusFor(
  remainingMinutes: number,
  anyPointsScored: boolean,
  anyPlaying: boolean,
): MatchupStatus {
  if (remainingMinutes <= 0) return 'final';
  // Banked points used to be enough to call it live, which meant a matchup stayed "live" all
  // week once Thursday night had happened. Only a game actually in progress counts.
  if (anyPlaying) return 'live';
  return anyPointsScored ? 'between' : 'not_started';
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
  /*
   * The scoreboard for the week BEING VIEWED, not the current one.
   *
   * Asking without the week returns whatever week the NFL is on now, so loading a finished week
   * priced its starters against this week's games: every one of them mapped to a fixture that
   * had not kicked off, so 60 minutes were "remaining" and week 1 sat there reading live with
   * live win probabilities all through week 2. Same failure as the ESPN calendar lag fixed in
   * the betting pricing path — this call site was simply missed.
   */
  const games = await fetch(`/api/betting/nfl-games?season=${season}&week=${week}`)
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
  const noOpponent: { leagueId: string; leagueName: string; league: SleeperLeague }[] = [];

  for (const { league, priced } of results) {
    /*
     * A league that has not drafted has no lineup to price and never will for this week. Saying
     * so beats letting it fall through to the generic "no lineup set" — that reason is true of a
     * pre-draft league but tells the reader nothing about what to do, and these two sit at the
     * bottom of the page every single week.
     */
    if (league.status === 'pre_draft' || league.status === 'drafting') {
      skipped.push({
        leagueId: league.league_id,
        leagueName: league.name,
        reason: league.status === 'drafting' ? 'draft in progress' : "hasn't drafted yet",
      });
      continue;
    }

    const mine = priced?.markets.find(
      m => m.a.ownerId === userId || m.b.ownerId === userId,
    );

    if (!mine) {
      // Guillotine, chopped and survivor formats give every roster its own matchup_id, so
      // there is no pair to price — but the starters are still playing, so collect them
      // rather than discarding the league.
      noOpponent.push({ leagueId: league.league_id, leagueName: league.name, league });
      continue;
    }

    const iAmA = mine.a.ownerId === userId;
    const me = iAmA ? mine.a : mine.b;
    const opponent = iAmA ? mine.b : mine.a;
    /*
     * The model's probability, not the priced one.
     *
     * `pricing` is struck from a copy clamped to the betting band, so reading it here capped every
     * matchup on this page at 95% — a decided game showed as a coin-flip-adjacent 95% rather than
     * the certainty it was.
     */
    const winProbability = iAmA ? mine.probA : 1 - mine.probA;
    const scored = me.distribution.banked > 0 || opponent.distribution.banked > 0;
    const anyPlaying = [...me.starters, ...opponent.starters].some(s => s.gameState === 'in');

    matchups.push({
      leagueId: league.league_id,
      leagueName: league.name,
      league,
      week,
      me,
      opponent,
      winProbability,
      remainingMinutes: mine.remainingMinutes,
      status: statusFor(mine.remainingMinutes, scored, anyPlaying),
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
        return await buildNoOpponentLeague(lg.leagueId, lg.leagueName, season, week, userId, games);
      } catch {
        return null;
      }
    }),
  );

  const lineupOnly: LineupOnlyLeague[] = [];
  const eliminations: EliminationRisk[] = [];
  noOpponent.forEach((lg, i) => {
    const result = lineupOnlyResults[i];
    if (result?.elimination) eliminations.push(result.elimination);
    const built = result?.lineup ?? null;
    if (built) lineupOnly.push(built);
    else {
      /*
       * Listed rather than silently dropped. A pre-draft league has already been filtered out
       * above, so reaching here means the league is under way but produced no lineup — an
       * eliminated guillotine roster is the common case, and it is worth naming, since "no
       * lineup" on a league you have been knocked out of reads like a fault otherwise.
       */
      const eliminated = lg.league.settings?.type === CHOPPED_LEAGUE_TYPE;
      skipped.push({
        leagueId: lg.leagueId,
        leagueName: lg.leagueName,
        reason: eliminated ? 'eliminated — no roster left' : 'no lineup set for this week yet',
      });
    }
  });

  return {
    week,
    season,
    matchups,
    lineupOnly,
    rooting: buildRootingRows(matchups, games, lineupOnly),
    eliminations,
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
/**
 * A league with no head-to-head opponent: my lineup, and what is at stake in it.
 *
 * Both come from one set of fetches because they need exactly the same data — the league's
 * scoring, this week's matchup entries and the week's projections. Splitting them into two
 * functions meant fetching all of it twice for the same league.
 */
async function buildNoOpponentLeague(
  leagueId: string,
  leagueName: string,
  season: string,
  week: number,
  userId: string,
  games: NflGamesResponse | null,
): Promise<{ lineup: LineupOnlyLeague | null; elimination: EliminationRisk | null }> {
  const nothing = { lineup: null, elimination: null };
  const [league, rosters, matchups] = await Promise.all([
    SleeperService.getLeague(leagueId),
    SleeperService.getRosters(leagueId),
    SleeperService.getMatchups(leagueId, week, { skipCache: true }),
  ]);
  const scoring = league?.scoring_settings;
  if (!scoring || !league) return nothing;

  const myRoster = rosters.find(r => r.owner_id === userId);
  if (!myRoster) return nothing;

  const projections = await SleeperService.getWeeklyProjections(season, week);

  /** One roster's starters, as the odds model wants them. */
  const startersOf = (m: (typeof matchups)[number]): StarterInput[] => {
    const ids = m.starters ?? [];
    const points = m.starters_points ?? [];
    return ids
      .map((pid, i) => ({ pid, actual: points[i] ?? 0 }))
      .filter(({ pid }) => pid && pid !== '0')
      .map(({ pid, actual }) => {
        const team = espnTeamOf(pid);
        const gameId = team && games ? games.teamToGame[team] : undefined;
        const game = gameId && games ? games.games.find(g => g.id === gameId) : undefined;
        const raw = projections[pid];
        const base: StarterInput = {
          playerId: pid,
          position: POSITIONS[pid]?.position ?? null,
          actualPoints: actual,
          projectedPoints: calculateProjectedPoints(raw, scoring),
          gameState: game ? game.state : 'unknown',
          remainingMinutes: game ? game.remainingMinutes : 0,
        };
        /*
         * Same defence correction the head-to-head path applies. Without it a live defence
         * carries a points-allowed bracket it has not earned, and here that feeds straight into
         * an elimination probability rather than just a projection.
         */
        const fix = defenceCorrection(
          { ...base, position: base.position ?? null },
          scoring,
          undefined,
          raw,
        );
        if (!fix) return base;
        return {
          ...base,
          projectedPoints: base.projectedPoints - fix.projectedBracket,
          meanAdjustment: (base.meanAdjustment ?? 0) + fix.meanAdjustment,
          extraVariance: (base.extraVariance ?? 0) + fix.variance,
        };
      });
  };

  const mine = matchups.find(m => m.roster_id === myRoster.roster_id);
  const myStarters = mine ? startersOf(mine) : [];

  const lineup: LineupOnlyLeague | null = myStarters.length
    ? {
        leagueId,
        leagueName,
        starters: myStarters.map(s => ({
          playerId: s.playerId,
          position: s.position ?? null,
          projectedPoints: s.projectedPoints,
          gameState: s.gameState,
          remainingMinutes: s.remainingMinutes,
        })),
      }
    : null;

  const elimination = buildEliminationRisk({
    league,
    leagueId,
    leagueName,
    matchups,
    myRosterId: myRoster.roster_id,
    startersOf,
    eliminatedHere: myStarters.length === 0,
  });

  return { lineup, elimination };
}

/**
 * My chance of being chopped this week, or null when the format cannot eliminate anyone.
 *
 * Gated on the BEHAVIOUR — every roster holding its own `matchup_id` — rather than on
 * `settings.type`, which is undocumented for these formats. A league that turns elimination off
 * (`disable_elimination`) has lineups and no stakes, so it gets no number rather than a wrong one.
 */
function buildEliminationRisk(args: {
  league: SleeperLeague;
  leagueId: string;
  leagueName: string;
  matchups: { roster_id: number; matchup_id: number | null; starters: string[] | null }[];
  myRosterId: number;
  startersOf: (m: never) => StarterInput[];
  eliminatedHere: boolean;
}): EliminationRisk | null {
  const { league, leagueId, leagueName, matchups, myRosterId, eliminatedHere } = args;
  if (!hasNoHeadToHead(matchups.map(m => m.matchup_id))) return null;
  if (league.settings?.disable_elimination) return null;

  const base = {
    leagueId,
    leagueName,
    format: leagueFormat(league),
    eliminated: eliminatedHere,
  };

  // An eliminated roster cannot be eliminated again, and must be kept out of the field below —
  // it has no lineup, so it would otherwise be a certain minimum.
  const alive = matchups.filter(m => (m.starters ?? []).some(p => p && p !== '0'));
  if (eliminatedHere) return { ...base, probability: 0, activeRosters: alive.length };

  const field: RosterScore[] = alive.map(m => {
    const dist = sideDistribution(args.startersOf(m as never));
    return {
      rosterId: m.roster_id,
      banked: dist.banked,
      mean: dist.mean,
      sd: Math.sqrt(dist.variance),
    };
  });

  const probabilities = eliminationProbabilities(field);
  return {
    ...base,
    probability: probabilities.get(myRosterId) ?? 0,
    activeRosters: field.length,
  };
}

/** Re-exported so the page can render names without importing the betting module. */
export { playerName };
