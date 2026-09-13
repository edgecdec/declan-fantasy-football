import { NextResponse } from 'next/server';
import playerIndex from '../../../../../data/player_index.json';
import { playsForWeek, observedLatencySeconds, playCount } from '@/lib/plays/playStore';
import { buildLeagueContexts, resolveUserId } from '@/lib/plays/leagueContext';
import { BIG_PLAY_POINTS, buildPlayFeedPage, type PlayerMeta } from '@/services/plays/playFeed';
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

/**
 * A page, not a week.
 *
 * Measured before choosing: a full week is 145 KB, and the page refreshes every 30 seconds, so ten
 * viewers is 146 MB an hour of egress re-sending what they already have. CPU was never the problem
 * (0.18s warm to replay 2,630 plays across 18 leagues) — the payload was. So the client keeps what
 * it holds and asks only for what is new, or for one page further back.
 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;


/**
 * How long a built feed is reused.
 *
 * Building one replays every play of the week and scores each one in up to twenty leagues —
 * measured at 98,172 player-play pairs and about 0.18s warm. Plays arrive about once a minute and
 * the page refreshes every 30 seconds, so a 25-second window means a viewer sitting there costs one
 * build per refresh at most, and two viewers on the same leagues usually cost one between them.
 *
 * This is the ceiling that matters at scale, not bandwidth: polls are 1.4 KB, but the replay is
 * per-user because the key includes the username. Roughly 0.18s per build per user per 25s is about
 * 0.7 of a core at a hundred concurrent viewers. Past that the fix is to cache the SCORED result per
 * (league, week) and assemble a user's feed from those, since users overlap on leagues even though
 * their league sets differ.
 */
const FEED_CACHE_MS = 25_000;

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
  const bigPlaysOnly = params.get('bigPlaysOnly') === '1';
  const includeAllPlays = params.get('allPlays') === '1';
  const numeric = (name: string): number | undefined => {
    const raw = Number(params.get(name));
    return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  };
  // `after` polls forward for new plays; `before` pages backward for older ones.
  const after = numeric('after');
  const before = numeric('before');

  if (!username || !season || !Number.isFinite(week) || week <= 0) {
    return NextResponse.json(
      { ok: false, error: 'username, season and week are required.' },
      { status: 400 },
    );
  }

  // Not awaited: the feed must render from stored plays whether or not this sweep succeeds.
  void pollQuietly();

  const cacheKey =
    `${username}|${season}|${week}|${limit}|${startersOnly}|${bigPlaysOnly}|${includeAllPlays}`
    + `|${after ?? ''}|${before ?? ''}`;
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
  // Filtering happens inside buildPlayFeed, not here: `limit` has to apply to what survives, or
  // asking for big plays only would return the big plays within the last 100 rather than the
  // last 100 big plays.
  const page = buildPlayFeedPage(plays, leagues, PLAYERS, {
    limit,
    startersOnly,
    minPeakPoints: bigPlaysOnly ? BIG_PLAY_POINTS : 0,
    includeAllPlays,
    after,
    before,
  });

  const body = {
    ok: true,
    season,
    week,
    leagues: leagues.map(l => ({ leagueId: l.leagueId, leagueName: l.leagueName })),
    failedLeagues: failed,
    playsStored: stored,
    latencySeconds: observedLatencySeconds(season, week),
    entries: page.entries,
    // Cursors, so the client can poll forward and page backward instead of refetching the week.
    newestSequence: page.newestSequence,
    oldestSequence: page.oldestSequence,
    hasMore: page.hasMore,
    fetchedAt: new Date().toISOString(),
  };
  feedCache.set(cacheKey, { at: Date.now(), playCount: stored, body });
  return NextResponse.json(body);
}
