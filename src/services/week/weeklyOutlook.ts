import { SleeperLeague, SleeperService } from '@/services/sleeper/sleeperService';
import {
  MarketSide,
  buildMatchupMarkets,
  playerName,
} from '@/services/betting/matchupMarkets';
import { REGULATION_MINUTES, SideDistribution } from '@/services/betting/liveOdds';
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

export type RootingRow = {
  playerId: string;
  name: string;
  position: string | null;
  /** ESPN game id, so rows can be grouped by NFL game. */
  gameId?: string;
  /** Projected points still to come where this player starts FOR me. */
  forPoints: number;
  /** ...and where he starts AGAINST me. */
  againstPoints: number;
  /**
   * Expected WINS riding on this player, netted across leagues. Positive means root for him.
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
  forLeagues: string[];
  againstLeagues: string[];
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
  rooting: RootingRow[];
  /** Leagues that returned nothing usable, so the UI can say so rather than hide them. */
  skipped: { leagueId: string; leagueName: string; reason: string }[];
};

const PLAYERS = (playerData as unknown as {
  players: Record<string, { team?: string | null }>;
}).players;

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

  for (const { league, priced } of results) {
    if (!priced || priced.markets.length === 0) {
      skipped.push({
        leagueId: league.league_id,
        leagueName: league.name,
        // Most often a format with no head-to-head matchup, or a week not yet posted.
        reason: 'no head-to-head matchup this week',
      });
      continue;
    }

    const mine = priced.markets.find(
      m => m.a.ownerId === userId || m.b.ownerId === userId,
    );
    if (!mine) {
      skipped.push({
        leagueId: league.league_id,
        leagueName: league.name,
        reason: 'you are not in a matchup this week',
      });
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

  return {
    week,
    season,
    matchups,
    rooting: buildRootingRows(matchups, games),
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
      forPoints: 0,
      againstPoints: 0,
      netSwing: 0,
      forLeagues: [],
      againstLeagues: [],
      netLeagues: 0,
    };
    byPlayer.set(playerId, created);
    return created;
  };

  for (const m of matchups) {
    if (!m.opponent) continue;
    if (m.status === 'final') continue; // nothing left to root for

    const sensitivity = winSensitivity(m.me.distribution, m.opponent.distribution);

    for (const s of m.me.starters) {
      const pts = remainingProjection(s);
      if (pts <= 0) continue;
      const r = row(s.playerId, s.position ?? null);
      r.forPoints += pts;
      r.netSwing += pts * sensitivity;
      if (!r.forLeagues.includes(m.leagueName)) r.forLeagues.push(m.leagueName);
    }

    for (const s of m.opponent.starters) {
      const pts = remainingProjection(s);
      if (pts <= 0) continue;
      const r = row(s.playerId, s.position ?? null);
      r.againstPoints += pts;
      r.netSwing -= pts * sensitivity;
      if (!r.againstLeagues.includes(m.leagueName)) r.againstLeagues.push(m.leagueName);
    }
  }

  if (games) {
    // Attach the NFL game so the UI can group by kickoff, using the same team->game map
    // the pricing uses.
    for (const r of byPlayer.values()) {
      const team = espnTeamOf(r.playerId);
      r.gameId = team ? games.teamToGame[team] : undefined;
    }
  }

  const rows = [...byPlayer.values()];
  for (const r of rows) r.netLeagues = r.forLeagues.length - r.againstLeagues.length;

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

/** Re-exported so the page can render names without importing the betting module. */
export { playerName };
