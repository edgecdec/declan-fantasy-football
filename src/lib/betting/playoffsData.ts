import { GET as nflGames, type NflGamesResponse } from '@/app/api/betting/nfl-games/route';
import {
  bracketState, decidedResults, roundLengthText, roundName, roundWeeks, simulateBracketLive, winnersPath,
  type BracketMatch, type LiveWeekScore,
} from '@/lib/betting/playoffBracket';
import { playoffStatus, type BracketResponse, type PlayoffsBody } from '@/lib/betting/playoffOdds';
import { bracketByes, bracketRounds, effectiveWeekMean, simulateSeason } from '@/lib/betting/seasonSim';
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
  | { status: 200; body: PlayoffsBody }
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

  // Once the playoffs start, the regular-season question is answered: play out the real bracket.
  if (league.status === 'complete' || league.status === 'post_season' || currentWeek > lastRegularWeek) {
    return computeBracket(leagueId, st);
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
      phase: 'regular',
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

type SeasonStateOk = Extract<Awaited<ReturnType<typeof loadSeasonState>>, { ok: true }>['state'];

/**
 * The playoffs in progress: the remaining winners bracket, simulated from where it stands.
 *
 * Finished weeks of a round are banked from Sleeper's matchups, the live week comes from the same
 * read-only matchup model as the regular season (via loadSeasonState), and every later week is a
 * draw from the season model's own per-week mean and spread. See playoffBracket.ts for the bracket
 * rules and how they were confirmed.
 */
async function computeBracket(leagueId: string, st: SeasonStateOk): Promise<PlayoffsLoad> {
  const { league, currentWeek, playoffWeekStart } = st;
  const raw = await fetch(`${SLEEPER_BASE}/league/${leagueId}/winners_bracket`, { cache: 'no-store' })
    .then(r => (r.ok ? (r.json() as Promise<BracketMatch[] | null>) : null))
    .catch(() => null);
  const bracket = winnersPath(raw ?? []);
  if (bracket.length === 0) {
    return { status: 422, body: { ok: false, error: 'Sleeper has no winners bracket for this league yet.' } };
  }

  const name = new Map(st.teams.map(t => [t.rosterId, t.displayName]));
  const { rounds, currentRound, champion } = bracketState(bracket);
  if (champion !== null || league.status === 'complete') {
    const who = champion !== null ? name.get(champion) ?? `Roster ${champion}` : null;
    return { status: 409, body: { ok: false, error: postseasonOverMessage(who) } };
  }

  const roundType = league.settings.playoff_round_type ?? 0;
  const weeks = roundWeeks(playoffWeekStart, roundType, rounds);

  // Banked playoff weeks, for finished parts of a round and the results lines.
  const done = Array.from({ length: Math.max(0, currentWeek - playoffWeekStart) }, (_, i) => playoffWeekStart + i);
  const rows = await Promise.all(done.map(wk =>
    fetch(`${SLEEPER_BASE}/league/${leagueId}/matchups/${wk}`, { cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<{ roster_id: number; points: number | null }[]>) : []))
      .catch(() => [] as { roster_id: number; points: number | null }[]),
  ));
  const actual = new Map<string, number>();
  done.forEach((wk, i) => { for (const r of rows[i] ?? []) if (r.points != null) actual.set(`${wk}:${r.roster_id}`, r.points); });

  // The live week, for teams the matchup model priced this week.
  const pricedNow = new Set(st.currentWeekPairs.flat());
  const live = new Map<number, LiveWeekScore>();
  for (const t of st.teams) {
    if (pricedNow.has(t.rosterId)) {
      live.set(t.rosterId, { banked: t.currentBanked, remainingMean: t.currentRemainingMean, remainingSd: t.currentRemainingSd });
    }
  }

  // Seeds from the final regular-season standings: wins (a tie half), then points for.
  const seeds = new Map(
    [...st.teams]
      .sort((a, b) => (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || b.pointsFor - a.pointsFor)
      .map((t, i) => [t.rosterId, i + 1]),
  );
  const reseed = (league.settings.playoff_seed_type ?? 0) === 1;

  const sim = simulateBracketLive({
    bracket,
    seeds,
    reseed,
    weeks,
    currentWeek,
    actual,
    live,
    means: new Map(st.teams.map(t => [t.rosterId, effectiveWeekMean(t)])),
    sims: PLAYOFF_SIMS,
    seed: SEED,
  });

  const eliminated = new Set(bracket.filter(m => m.l !== null && m.l !== undefined).map(m => m.l as number));
  const columns = Array.from({ length: Math.max(0, rounds - currentRound) }, (_, i) => currentRound + 1 + i)
    .map(r => ({ round: r, label: roundName(r, rounds) }));

  // This round's pairing and points, for the line under each name.
  const thisRound = bracket.filter(m => m.r === currentRound);
  const roundPointsOf = (id: number): number | null => {
    const wks = weeks[currentRound - 1] ?? [];
    if (!wks.some(wk => wk <= currentWeek)) return null;
    let total = 0;
    for (const wk of wks) {
      if (wk < currentWeek) total += actual.get(`${wk}:${id}`) ?? 0;
      else if (wk === currentWeek) total += live.get(id)?.banked ?? 0;
    }
    return total;
  };

  const teamRows = sim.teams
    .filter(t => !eliminated.has(t.rosterId))
    .map(t => {
      const st2 = st.teams.find(x => x.rosterId === t.rosterId);
      const match = thisRound.find(m => m.t1 === t.rosterId || m.t2 === t.rosterId);
      const oppId = match ? (match.t1 === t.rosterId ? match.t2 : match.t1) : null;
      const opponent = match ? (oppId !== null ? name.get(oppId) ?? `Roster ${oppId}` : 'TBD') : null;
      return {
        rosterId: t.rosterId,
        name: name.get(t.rosterId) ?? `Roster ${t.rosterId}`,
        seed: seeds.get(t.rosterId) ?? 0,
        wins: st2?.wins ?? 0,
        losses: st2?.losses ?? 0,
        ties: st2?.ties ?? 0,
        opponent,
        roundPoints: match ? roundPointsOf(t.rosterId) : null,
        opponentPoints: match && oppId !== null ? roundPointsOf(oppId) : null,
        reach: columns.map(c => t.reach[c.round - 1] ?? 0),
        title: t.title,
      };
    })
    .sort((a, b) => b.title - a.title || a.seed - b.seed);

  const body: BracketResponse = {
    phase: 'bracket',
    league: { leagueId, name: league.name ?? 'League', season: league.season },
    currentWeek,
    playoffWeekStart,
    rounds,
    currentRound,
    roundLength: roundLengthText(roundType),
    reseed,
    sims: PLAYOFF_SIMS,
    columns,
    teams: teamRows,
    results: decidedResults(bracket, weeks, actual).map(r => ({
      round: r.round,
      label: roundName(r.round, rounds),
      winner: name.get(r.winner) ?? `Roster ${r.winner}`,
      loser: name.get(r.loser) ?? `Roster ${r.loser}`,
      winnerPoints: r.winnerPoints,
      loserPoints: r.loserPoints,
    })),
  };
  return { status: 200, body };
}

/** The refusal once the final is decided, naming the champion when Sleeper has one. */
export function postseasonOverMessage(champion: string | null): string {
  return champion ? `The playoffs are over — ${champion} won the title.` : 'The playoffs are over.';
}
