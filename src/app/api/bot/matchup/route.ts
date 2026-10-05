import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { findAccountByDiscordId } from '@/lib/betting/accounts';
import { buildMatchupMarkets, type MarketSide } from '@/services/betting/matchupMarkets';
import { statusFor } from '@/services/week/weeklyOutlook';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { GET as nflGames, type NflGamesResponse } from '@/app/api/betting/nfl-games/route';

export const dynamic = 'force-dynamic';

/**
 * One manager's matchup for a week, as the This Week page models it.
 *
 * Runs the SAME `buildMatchupMarkets` the page runs in the browser, so the bot's win probability,
 * projections and slot comparison cannot drift from what the site shows. Any league, not just the
 * betting ones: this is a read of Sleeper data, not of money.
 *
 * Who to show is one of, in order of precedence:
 *   rosterId       — exact, used by the Details button once the matchup is already resolved
 *   discordUserId  — a linked Discord user, via their Declan Dollars account
 *   player         — a Sleeper display name, username or team name
 *
 * A player who is not in the league is a 404 with error `not_in_league`, which the bot reads as
 * "try the next league in this channel" rather than as a failure.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const leagueId = params.get('leagueId');
  if (!leagueId) {
    return NextResponse.json({ ok: false, error: 'leagueId is required.' }, { status: 400 });
  }

  const league = await SleeperService.getLeague(leagueId);
  if (!league) {
    return NextResponse.json({ ok: false, error: 'League not found.' }, { status: 404 });
  }

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
    return NextResponse.json(
      { ok: false, error: 'not_in_league', league: { leagueId, name: league.name } },
      { status: 404 },
    );
  }

  // The scoreboard for THIS week, through the same proxy the page uses. Calling the handler
  // directly rather than over HTTP, since the browser path's relative URL means nothing here.
  const games = (await nflGames(
    new Request(`http://local/api/betting/nfl-games?season=${league.season}&week=${week}`),
  )
    .then(r => r.json())
    .catch(() => null)) as NflGamesResponse | null;
  if (!games?.ok) {
    return NextResponse.json({ ok: false, error: 'NFL scoreboard unavailable.' }, { status: 502 });
  }

  const priced = await buildMatchupMarkets(leagueId, week, games);
  const market = priced?.markets.find(m => m.a.rosterId === rosterId || m.b.rosterId === rosterId);

  const ownerName = (() => {
    const owner = rosters.find(r => r.roster_id === rosterId)?.owner_id;
    return users.find(u => u.user_id === owner)?.display_name ?? `Roster ${rosterId}`;
  })();

  if (!market) {
    /*
     * Guillotine, chopped and survivor give every roster its own matchup, so there is no opponent.
     * Said plainly rather than 404'd: the player IS in the league, and "not found" would be a lie.
     */
    return NextResponse.json({
      ok: true,
      league: { leagueId, name: league.name, season: league.season },
      week,
      rosterId,
      displayName: ownerName,
      headToHead: false,
    });
  }

  const iAmA = market.a.rosterId === rosterId;
  const me = iAmA ? market.a : market.b;
  const them = iAmA ? market.b : market.a;
  const scored = me.distribution.banked > 0 || them.distribution.banked > 0;
  const anyPlaying = [...me.starters, ...them.starters].some(s => s.gameState === 'in');

  return NextResponse.json({
    ok: true,
    league: { leagueId, name: league.name, season: league.season },
    week,
    rosterId,
    displayName: me.displayName,
    headToHead: true,
    // The model's probability, unclamped — the same one the page shows, not the betting price.
    winProbability: iAmA ? market.probA : 1 - market.probA,
    remainingMinutes: market.remainingMinutes,
    status: statusFor(market.remainingMinutes, scored, anyPlaying),
    me: side(me),
    opponent: side(them),
  });
}

function side(s: MarketSide) {
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
