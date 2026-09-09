import { NextResponse } from 'next/server';
import { POLL_INTERVAL_SECONDS, pollLivePlays, reconcileWeek } from '@/services/plays/playPoller';
import { observedLatencySeconds, playCount, recentPlays } from '@/lib/plays/playStore';
import { readMeta } from '@/lib/meta';

export const dynamic = 'force-dynamic';

/**
 * The capture endpoint, driven by cron on the VPS.
 *
 * Separate from the feed on purpose: capture must keep running whether or not anyone is
 * looking, because a play not stored while the game is on cannot be recovered afterwards.
 * The feed is a read over what capture already banked.
 *
 * Shared-secret auth rather than a session. The caller is a cron job with no cookie jar,
 * and the action is idempotent — the worst a valid call can do is bank plays we already
 * have. Unauthenticated it would still be a way for anyone to make this server hammer
 * Sleeper, which is exactly the outcome the whole design is built to avoid.
 */
function authorised(request: Request): boolean {
  const expected = process.env.POLL_SECRET || process.env.WEBHOOK_SECRET;
  if (!expected) return false;
  const provided = request.headers.get('x-poll-secret')
    ?? new URL(request.url).searchParams.get('secret');
  return provided === expected;
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorised.' }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;

  // An explicit season+week is a one-off backfill of that week rather than a live sweep:
  // useful for a week whose games finished before capture existed, and the only way to
  // exercise the capture path outside a live game.
  const season = params.get('season');
  const week = Number(params.get('week'));
  if (season && Number.isFinite(week) && week > 0) {
    const outcome = await reconcileWeek(season, week, params.get('seasonType') ?? 'regular');
    return NextResponse.json({ ok: !outcome.error, backfill: true, season, week, ...outcome });
  }

  // `force` is honoured for the debounce but never for the rate-limit cooldown.
  const result = await pollLivePlays(params.get('force') === '1');
  // Latency comes back on the POST too, so the cron's log line says whether capture is
  // keeping up rather than only that it ran. Without it the log shows a healthy-looking
  // play count whether the plays arrived seconds or an hour after the snap.
  const latencySeconds = result.season && result.week
    ? observedLatencySeconds(result.season, result.week)
    : null;
  return NextResponse.json({ ok: true, latencySeconds, ...result });
}

/**
 * GET — capture health, without triggering anything.
 *
 * Reports the observed feed latency, which is the one number that tells you whether live
 * capture is actually working: play count alone looks identical whether the plays arrived
 * seconds or hours after the snap.
 */
export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorised.' }, { status: 401 });
  }
  const url = new URL(request.url);
  const season = url.searchParams.get('season');
  const week = Number(url.searchParams.get('week'));
  if (!season || !Number.isFinite(week)) {
    return NextResponse.json({ ok: false, error: 'season and week required.' }, { status: 400 });
  }
  const latest = recentPlays(season, week, 1)[0];
  return NextResponse.json({
    ok: true,
    season,
    week,
    plays: playCount(season, week),
    latencySeconds: observedLatencySeconds(season, week),
    lastPollAt: readMeta('plays_last_poll') ?? null,
    lastBackfillAt: readMeta('plays_last_backfill') ?? null,
    rateLimitedUntil: readMeta('plays_rate_limit_until') ?? null,
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    latestPlay: latest
      ? { playId: latest.playId, gameId: latest.gameId, firstSeenAt: latest.firstSeenAt }
      : null,
  });
}
