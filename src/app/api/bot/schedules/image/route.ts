import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { loadScheduleSwap } from '@/lib/betting/scheduleData';
import { renderScheduleImage } from '@/lib/betting/scheduleImage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The schedule-swap matrix as a PNG, for /schedules. Same parameters and auth as /api/bot/schedules.
 * Errors come back as JSON so the bot can fall back to its text summary.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const { status, body } = await loadScheduleSwap(params.get('leagueId')?.trim(), params.get('season')?.trim());
  if (status !== 200) return NextResponse.json(body, { status });
  return renderScheduleImage(body);
}
