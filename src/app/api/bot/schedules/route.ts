import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { loadScheduleSwap } from '@/lib/betting/scheduleData';

export const dynamic = 'force-dynamic';

/**
 * The schedule-swap matrix — every manager's scores on every manager's schedule. `leagueId` is any
 * Sleeper league (public data, as /api/bot/luck), `season` optional. See scheduleSwap.ts.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const { status, body } = await loadScheduleSwap(params.get('leagueId')?.trim(), params.get('season')?.trim());
  if (status !== 200) return NextResponse.json(body, { status });
  return NextResponse.json({ ok: true, ...body });
}
