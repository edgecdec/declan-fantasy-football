import { findAccountByDiscordId } from '@/lib/betting/accounts';
import { buildMatchupMarkets, type MarketSide } from '@/services/betting/matchupMarkets';
import { statusFor } from '@/services/week/weeklyOutlook';
import { SleeperService } from '@/services/sleeper/sleeperService';
import {
  GET as nflGames,
  espnTeamCode,
  type NflGamesResponse,
} from '@/app/api/betting/nfl-games/route';

/**
 * One manager's matchup for a week, as the This Week page models it.
 *
 * Runs the SAME `buildMatchupMarkets` the page runs in the browser, so the bot's win probability,
 * projections and slot comparison cannot drift from what the site shows. Shared by the JSON route
 * and the image route, so the picture and the numbers beside it are one computation.
 *
 * Who to show is one of, in order of precedence:
 *   rosterId       — exact, used by the buttons once the matchup is already resolved
 *   discordUserId  — a linked Discord user, via their Declan Dollars account
 *   player         — a Sleeper display name, username or team name
 *
 * A player who is not in the league is a 404 with error `not_in_league`, which the bot reads as
 * "try the next league in this channel" rather than as a failure.
 */
export type MatchupLoad = { status: number; body: Record<string, unknown> };

export async function loadMatchup(params: URLSearchParams): Promise<MatchupLoad> {
  const leagueId = params.get('leagueId');
  if (!leagueId) return { status: 400, body: { ok: false, error: 'leagueId is required.' } };

  const league = await SleeperService.getLeague(leagueId);
  if (!league) return { status: 404, body: { ok: false, error: 'League not found.' } };

  let week = Number(params.get('week'));
  if (!Number.isInteger(week) || week <= 0) {
    const state = await SleeperService.getNflState();
    week = Number(state?.week) || 1;
  }

  const [rosters, users] = await Promise.all([
    SleeperService.getRosters(leagueId),
    SleeperService.getLeagueUsers(leagueId),
  ]);

  const rosterId = await resolveRoster(params, rosters, users);
  if (rosterId === null) {
    return {
      status: 404,
      body: { ok: false, error: 'not_in_league', league: { leagueId, name: league.name } },
    };
  }

  // The scoreboard for THIS week, through the same proxy the page uses. Calling the handler
  // directly rather than over HTTP, since the browser path's relative URL means nothing here.
  const games = (await nflGames(
    new Request(`http://local/api/betting/nfl-games?season=${league.season}&week=${week}`),
  )
    .then(r => r.json())
    .catch(() => null)) as NflGamesResponse | null;
  if (!games?.ok) return { status: 502, body: { ok: false, error: 'NFL scoreboard unavailable.' } };

  const priced = await buildMatchupMarkets(leagueId, week, games);
  const market = priced?.markets.find(m => m.a.rosterId === rosterId || m.b.rosterId === rosterId);

  const base = { ok: true, league: { leagueId, name: league.name, season: league.season }, week, rosterId };

  if (!market) {
    /*
     * Guillotine, chopped and survivor give every roster its own matchup, so there is no opponent.
     * Said plainly rather than 404'd: the player IS in the league, and "not found" would be a lie.
     */
    const owner = rosters.find(r => r.roster_id === rosterId)?.owner_id;
    return {
      status: 200,
      body: {
        ...base,
        displayName: users.find(u => u.user_id === owner)?.display_name ?? `Roster ${rosterId}`,
        headToHead: false,
      },
    };
  }

  const iAmA = market.a.rosterId === rosterId;
  const me = iAmA ? market.a : market.b;
  const them = iAmA ? market.b : market.a;
  const scored = me.distribution.banked > 0 || them.distribution.banked > 0;
  const anyPlaying = [...me.starters, ...them.starters].some(s => s.gameState === 'in');

  return {
    status: 200,
    body: {
      ...base,
      displayName: me.displayName,
      headToHead: true,
      // The model's probability, unclamped — the same one the page shows, not the betting price.
      winProbability: iAmA ? market.probA : 1 - market.probA,
      remainingMinutes: market.remainingMinutes,
      status: statusFor(market.remainingMinutes, scored, anyPlaying),
      me: side(me, games),
      opponent: side(them, games),
    },
  };
}

/**
 * A player's game in a few characters, the line Sleeper prints under each name: the opponent, then
 * the clock or the kickoff or the final.
 */
export function gameLine(
  team: string | null,
  games: NflGamesResponse,
): { opponent: string | null; gameDetail: string | null } {
  if (!team) return { opponent: null, gameDetail: null };
  const espn = espnTeamCode(team);
  const game = games.games.find(g => g.id === games.teamToGame[espn]);
  if (!game) return { opponent: null, gameDetail: 'BYE' };
  const opponent = game.teams.find(t => t !== espn) ?? null;
  const where = opponent ? `${game.home === espn ? 'vs' : '@'} ${opponent}` : '';

  let when: string;
  if (game.state === 'post') {
    const us = game.scores?.[espn] ?? 0;
    const them = opponent ? game.scores?.[opponent] ?? 0 : 0;
    when = `${us > them ? 'W' : us < them ? 'L' : 'T'} ${us}-${them}`;
  } else if (game.state === 'in') {
    when = game.shortDetail ?? game.detail;
  } else {
    // Kickoff in Eastern time, the zone the NFL schedules in: "Mon 8:15 PM".
    when = game.startsAt
      ? new Date(game.startsAt).toLocaleString('en-US', {
          timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
        }).replace(',', '')
      : game.detail;
  }
  return { opponent, gameDetail: [when, where].filter(Boolean).join(' ') };
}

function side(s: MarketSide, games: NflGamesResponse) {
  return {
    rosterId: s.rosterId,
    displayName: s.displayName,
    teamName: s.teamName ?? null,
    banked: s.distribution.banked,
    projected: s.distribution.mean,
    playersRemaining: s.playersRemaining,
    lineup: s.lineup.map(l => ({
      slot: l.slot,
      name: l.name,
      position: l.position,
      team: l.team,
      points: l.points,
      projectedPoints: l.projectedPoints,
      expectedPoints: l.expectedPoints,
      gameState: l.gameState,
      ...gameLine(l.team, games),
    })),
    // What the model assumes beyond the lineup as set, so a projection that disagrees with
    // Sleeper's can be explained rather than just doubted.
    assumedPromotions: s.assumedPromotions.map(p => p.name),
    assumedStreams: s.assumedStreams.map(x => x.slot),
  };
}

type Roster = { roster_id: number; owner_id: string | null; co_owners?: string[] | null };
type User = { user_id: string; display_name: string; username?: string; metadata?: { team_name?: string } };

async function resolveRoster(
  params: URLSearchParams,
  rosters: Roster[],
  users: User[],
): Promise<number | null> {
  const byOwner = (userId: string) =>
    rosters.find(r => r.owner_id === userId || r.co_owners?.includes(userId))?.roster_id ?? null;

  const rosterParam = Number(params.get('rosterId'));
  if (Number.isInteger(rosterParam) && rosterParam > 0) {
    return rosters.some(r => r.roster_id === rosterParam) ? rosterParam : null;
  }

  const discordUserId = params.get('discordUserId');
  if (discordUserId) {
    const account = findAccountByDiscordId(discordUserId);
    return account ? byOwner(account.sleeper_user_id) : null;
  }

  const player = params.get('player')?.trim().toLowerCase();
  if (!player) return null;

  // League-local names first: display name and team name are what people actually call each other.
  const local = users.find(
    u =>
      u.display_name?.toLowerCase() === player
      || u.username?.toLowerCase() === player
      || u.metadata?.team_name?.toLowerCase() === player,
  );
  if (local) return byOwner(local.user_id);

  // Then a Sleeper USERNAME, which can differ from the display name a league shows.
  const user = await SleeperService.getUser(player).catch(() => null);
  return user?.user_id ? byOwner(user.user_id) : null;
}
