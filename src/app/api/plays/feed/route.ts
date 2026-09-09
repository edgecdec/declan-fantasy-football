import { NextResponse } from 'next/server';
import playerIndex from '../../../../../data/player_index.json';
import { playsForWeek, observedLatencySeconds, playCount } from '@/lib/plays/playStore';
import { buildLeagueContexts, resolveUserId } from '@/lib/plays/leagueContext';
import { buildPlayFeed, type PlayerMeta } from '@/services/plays/playFeed';
import { pollQuietly } from '@/services/plays/playPoller';

export const dynamic = 'force-dynamic';

/**
 * The live feed, for one user across every league they are in.
 *
 * Reads from what capture already banked rather than fetching plays itself, so the cost of
 * a pageview is independent of the number of viewers — the point of storing plays at all.
 *
 * It does nudge the poller (fire-and-forget, debounced to one sweep a minute) so the feed
 * stays warm if the cron is not running. That is a backstop, not the mechanism: a feed that
 * only captured while someone was watching would have holes exactly where the interesting
 * plays are.
 */

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 300;

/**
 * How long a built feed is reused.
 *
 * Building one replays every play of the week and scores each one in up to twenty leagues —
 * on the order of 100k scoring operations. Plays arrive about once a minute, so serving a
 * few-second-old feed costs nothing in freshness, while an uncached endpoint would repeat
 * that work for every viewer's 30-second refresh on a 1.9 GB box.
 */
const FEED_CACHE_MS = 15_000;

type CachedFeed = { at: number; playCount: number; body: unknown };
const feedCache = new Map<string, CachedFeed>();

/**
 * The slim index, 200 KB, rather than the 22 MB player file. Parsing the big one in the
 * server process on a 1.9 GB box is what the slim index exists to avoid.
 */
const PLAYERS = playerIndex as Record<string, PlayerMeta>;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const username = params.get('username')?.trim();
  const season = params.get('season');
  const week = Number(params.get('week'));
  const limit = Math.min(MAX_LIMIT, Number(params.get('limit')) || DEFAULT_LIMIT);
  const startersOnly = params.get('startersOnly') === '1';

  if (!username || !season || !Number.isFinite(week) || week <= 0) {
    return NextResponse.json(
      { ok: false, error: 'username, season and week are required.' },
      { status: 400 },
    );
  }

  // Not awaited: the feed must render from stored plays whether or not this sweep succeeds.
  void pollQuietly();

  const cacheKey = `${username}|${season}|${week}|${limit}|${startersOnly}`;
  const stored = playCount(season, week);
  const cached = feedCache.get(cacheKey);
  // Invalidated by a new play as well as by age, so a touchdown is never held back by the
  // cache even if it lands a second after one was built.
  if (cached && Date.now() - cached.at < FEED_CACHE_MS && cached.playCount === stored) {
    return NextResponse.json(cached.body);
  }

  const userId = await resolveUserId(username);
  if (!userId) {
    return NextResponse.json({ ok: false, error: `No Sleeper user "${username}".` }, { status: 404 });
  }

  const { leagues, failed } = await buildLeagueContexts(userId, season, week);
  const plays = playsForWeek(season, week);
  let entries = buildPlayFeed(plays, leagues, PLAYERS, limit);

  if (startersOnly) {
    entries = entries
      .map(e => ({
        ...e,
        players: e.players
          .map(p => ({ ...p, impacts: p.impacts.filter(i => i.isStarter) }))
          .filter(p => p.impacts.length > 0),
      }))
      .filter(e => e.players.length > 0);
  }

  const body = {
    ok: true,
    season,
    week,
    leagues: leagues.map(l => ({ leagueId: l.leagueId, leagueName: l.leagueName })),
    failedLeagues: failed,
    playsStored: stored,
    latencySeconds: observedLatencySeconds(season, week),
    entries,
    fetchedAt: new Date().toISOString(),
  };
  feedCache.set(cacheKey, { at: Date.now(), playCount: stored, body });
  return NextResponse.json(body);
}
