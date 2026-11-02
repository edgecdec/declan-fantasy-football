import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { loadLuck } from '@/lib/betting/luckData';
import { renderLuckImage } from '@/lib/betting/luckImage';
import { parseLuckSort } from '@/lib/betting/luckSort';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /luck as a PNG. Same parameter and auth as /api/bot/luck (any Sleeper league id; see there for why
 * it is not limited to betting leagues), plus `sort=xw|luck` — expected wins unless told otherwise.
 * Errors come back as JSON so the bot can fall back to text.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const { status, body } = await loadLuck(params.get('leagueId')?.trim());
  if (status !== 200) return NextResponse.json(body, { status });
  if (body.teams.length === 0 || body.weeksCounted === 0) {
    return NextResponse.json({ ok: false, error: 'No completed weeks to analyse yet.' }, { status: 404 });
  }
  return renderLuckImage(body, parseLuckSort(params.get('sort')));
}
