import { NextResponse } from 'next/server';
import { betEventsAfter, latestBetEventId } from '@/lib/betting/events';
import { requireBot } from '@/lib/betting/botApi';
import { getDb } from '@/lib/db';

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

  /*
   * The bettor's display name, resolved HERE rather than in the bot.
   *
   * Payloads deliberately store an account id, not a name — a name in a payload would be a
   * point-in-time copy that goes stale when somebody renames themselves. But the bot has no access
   * to the accounts table (by design: it never opens betting.db), so it cannot resolve one itself,
   * and "Someone placed a bet" is a poor message.
   *
   * One query for the whole page rather than one per event.
   */
  const accountIds = [
    ...new Set(
      events
        .map(e => e.payload.accountId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  const names = new Map<string, string>();
  if (accountIds.length > 0) {
    const rows = getDb()
      .prepare(
        `SELECT id, display_name FROM accounts
         WHERE id IN (${accountIds.map(() => '?').join(',')})`,
      )
      .all(...accountIds) as { id: string; display_name: string }[];
    for (const row of rows) names.set(row.id, row.display_name);
  }

  return NextResponse.json({
    ok: true,
    events: events.map(e => ({
      ...e,
      bettorName:
        typeof e.payload.accountId === 'string' ? (names.get(e.payload.accountId) ?? null) : null,
    })),
    // So a caller that got a full page knows whether to poll again immediately.
    latest: latestBetEventId(),
  });
}
