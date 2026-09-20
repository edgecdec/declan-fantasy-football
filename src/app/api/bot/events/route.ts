import { NextResponse } from 'next/server';
import { betEventsAfter, latestBetEventId } from '@/lib/betting/events';
import { requireBot } from '@/lib/betting/botApi';

export const dynamic = 'force-dynamic';

/**
 * The bot's cursor read over the bet event outbox.
 *
 * `after` is the last id the caller handled, so a poll returns only what it has not seen. A fresh
 * bot should start from `latest` (below) rather than 0, or its first poll replays every bet ever
 * placed into the channel.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const after = Number(params.get('after'));
  const limit = Number(params.get('limit'));

  /*
   * No `after` means "where should I start", not "give me everything". Replaying history into a
   * Discord channel is the single most embarrassing failure available here, so the default is the
   * safe one and a caller has to ask for history explicitly with after=0.
   */
  if (!Number.isFinite(after)) {
    return NextResponse.json({ ok: true, events: [], latest: latestBetEventId() });
  }

  const events = betEventsAfter(after, Number.isFinite(limit) ? limit : 200);
  return NextResponse.json({
    ok: true,
    events,
    // So a caller that got a full page knows whether to poll again immediately.
    latest: latestBetEventId(),
  });
}
