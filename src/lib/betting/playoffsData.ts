import { GET as nflGames, type NflGamesResponse } from '@/app/api/betting/nfl-games/route';
import { playoffStatus, type PlayoffsResponse } from '@/lib/betting/playoffOdds';
import { bracketByes, bracketRounds, simulateSeason } from '@/lib/betting/seasonSim';
import { loadSeasonState, type LiveWeek } from '@/lib/betting/seasonState';
import { buildMatchupMarkets } from '@/services/betting/matchupMarkets';

/**
 * Playoff odds for ANY Sleeper league, for the bot's /playoffs.
 *
 * The same simulation as the site's season-odds (simulateSeason over loadSeasonState), with two
 * differences, both deliberate:
 *
 *  - the live week comes from buildMatchupMarkets — the This Week page's read-only model — not
 *    from priceLeagueWeek, which writes market rows. A bot command must never move a line, and
 *    most leagues asked about have no markets at all;
 *  - the bracket is Sleeper's standard one with per-round reach counts (`bracket: 'standard'`),
 *    plus the median game and division seeding when the league has them. For a six-team field the
 *    standard bracket plays the same games as the market's, so Graham's numbers agree with
 *    season-odds to within simulation noise.
 *
 * Clinched / eliminated marks come only from win bounds (playoffOdds.playoffStatus), never from a
 * simulated 0% or 100%.
 */

export const PLAYOFF_SIMS = 20_000;
/** The season-odds seed, so the two are as comparable as two different live-week models can be. */
const SEED = 20260904;

export type PlayoffsLoad =
  | { status: 200; body: PlayoffsResponse }
  | { status: 400 | 404 | 409 | 422 | 502; body: { ok: false; error: string } };

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

/**
 * A minute of reuse per league. The bot asks for the JSON and then the picture, and each would
 * otherwise run 20,000 seasons and a dozen Sleeper calls on a two-CPU box; a minute is far shorter
 * than anything on the card can change by.
 */
const CACHE_MS = 60_000;
const CACHE_MAX = 20;
const cache = new Map<string, { at: number; load: Promise<PlayoffsLoad> }>();

export function loadPlayoffs(leagueId: string | null | undefined): Promise<PlayoffsLoad> {
  if (!leagueId) return Promise.resolve({ status: 400, body: { ok: false, error: 'leagueId is required.' } });
  const hit = cache.get(leagueId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.load;
  const load = computePlayoffs(leagueId);
  cache.set(leagueId, { at: Date.now(), load });
  // A failure is not worth remembering: the next ask should try again.
  load.then(r => { if (r.status !== 200) cache.delete(leagueId); }, () => cache.delete(leagueId));
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return load;
}

async function computePlayoffs(leagueId: string): Promise<PlayoffsLoad> {
  let games: NflGamesResponse | null = null;
  const loaded = await loadSeasonState(leagueId, async (week): Promise<LiveWeek> => {
    const league = await fetch(`${SLEEPER_BASE}/league/${leagueId}`, { cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<{ season?: string }>) : null))
      .catch(() => null);
    // The scoreboard through the same proxy the site uses, called directly rather than over HTTP.
    games = (await nflGames(new Request(`http://local/api/betting/nfl-games?season=${league?.season ?? ''}&week=${week}`))
      .then(r => r.json())
      .catch(() => null)) as NflGamesResponse | null;
    const priced = games?.ok ? await buildMatchupMarkets(leagueId, week, games).catch(() => null) : null;
    const markets = priced?.markets ?? [];
    return {
      sides: markets.flatMap(m => [m.a, m.b].map(side => ({
        rosterId: side.rosterId,
        banked: side.distribution.banked,
        projected: side.distribution.mean,
        sd: Math.sqrt(side.distribution.variance),
      }))),
      pairs: markets.map(m => [m.a.rosterId, m.b.rosterId] as [number, number]),
    };
  });
  if (!loaded.ok) {
    return { status: loaded.status === 502 ? 502 : 404, body: { ok: false, error: loaded.error } };
  }
  const st = loaded.state;
  const { league, currentWeek, lastRegularWeek, playoffTeams } = st;

  if (league.status === 'complete' || league.status === 'post_season' || currentWeek > lastRegularWeek) {
    return { status: 409, body: { ok: false, error: 'The regular season is over — the playoff field is set.' } };
  }

  /*
   * No live week from the matchup model (its scoreboard was unavailable, or the week has no pairs
   * it can price) but the league does play this week: simulate the week from scratch rather than
   * silently skipping it, which would hand everybody one game fewer than they have.
   */
  let remainingSchedule = st.remainingSchedule;
  let currentWeekPairs = st.currentWeekPairs;
  if (currentWeekPairs.length === 0) {
    const rows = await fetch(`${SLEEPER_BASE}/league/${leagueId}/matchups/${currentWeek}`, { cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<{ roster_id: number; matchup_id: number | null }[]>) : []))
      .catch(() => []);
    const byMatchup = new Map<number, number[]>();
    for (const r of rows) if (r.matchup_id != null) byMatchup.set(r.matchup_id, [...(byMatchup.get(r.matchup_id) ?? []), r.roster_id]);
    const pairs = [...byMatchup.values()].filter(v => v.length === 2).map(v => [v[0], v[1]] as [number, number]);
    if (pairs.length > 0) remainingSchedule = [{ week: currentWeek, pairs }, ...remainingSchedule];
    currentWeekPairs = [];
  }

  // Guillotine, chopped and survivor give every roster its own matchup: nobody has an opponent.
  if (currentWeekPairs.length === 0 && remainingSchedule.length === 0) {
    return {
      status: 422,
      body: { ok: false, error: 'This league has no head-to-head schedule left to simulate (guillotine, chopped or best ball?).' },
    };
  }

  const results = simulateSeason({
    teams: st.teams,
    remainingSchedule,
    currentWeekLive: currentWeekPairs.length > 0,
    currentWeekPairs,
    playoffTeams,
    sims: PLAYOFF_SIMS,
    seed: SEED,
    bracket: 'standard',
    medianGame: st.medianGame,
    ...(st.divisions ? { divisions: st.divisions } : {}),
  });

  // Games left per team: the live week and every remaining scheduled one, doubled for the median.
  const gamesLeft = new Map<number, number>(st.teams.map(t => [t.rosterId, 0]));
  for (const [x, y] of [...currentWeekPairs, ...remainingSchedule.flatMap(w => w.pairs)]) {
    gamesLeft.set(x, (gamesLeft.get(x) ?? 0) + (st.medianGame ? 2 : 1));
    gamesLeft.set(y, (gamesLeft.get(y) ?? 0) + (st.medianGame ? 2 : 1));
  }

  const field = Math.min(playoffTeams, st.teams.length);
  const byes = bracketByes(field);
  const rounds = bracketRounds(field);
  const boundsApply = !st.divisions;
  const status = boundsApply
    ? playoffStatus(st.teams.map(t => ({ rosterId: t.rosterId, wins: t.wins, ties: t.ties, gamesLeft: gamesLeft.get(t.rosterId) ?? 0 })), field, byes)
    : new Map();

  const teams = st.teams.map(t => {
    const r = results.find(x => x.rosterId === t.rosterId)!;
    const reach = r.roundProbs ?? [];
    return {
      rosterId: t.rosterId,
      name: t.displayName,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: t.pointsFor,
      projectedWins: r.expectedWins,
      gamesLeft: gamesLeft.get(t.rosterId) ?? 0,
      playoffProb: r.playoffProb,
      byeProb: r.byeProb ?? 0,
      semisProb: rounds >= 2 ? reach[rounds - 2] ?? 0 : 0,
      finalProb: rounds >= 1 ? reach[rounds - 1] ?? 0 : 0,
      titleProb: r.titleProb,
      seedProbs: r.seedProbs ?? [],
      status: status.get(t.rosterId) ?? null,
    };
  }).sort((a, b) => b.playoffProb - a.playoffProb || b.titleProb - a.titleProb || b.projectedWins - a.projectedWins);

  return {
    status: 200,
    body: {
      league: { leagueId, name: league.name ?? 'League', season: league.season },
      currentWeek,
      lastRegularWeek,
      playoffWeekStart: st.playoffWeekStart,
      weeksRemaining: remainingSchedule.length + (currentWeekPairs.length > 0 ? 1 : 0),
      playoffTeams: field,
      byes,
      sims: PLAYOFF_SIMS,
      medianGame: st.medianGame,
      divisions: Boolean(st.divisions),
      boundsApply,
      teams,
    },
  };
}
