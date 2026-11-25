import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { loadPlayoffs } from '@/lib/betting/playoffsData';
import { renderBracketImage } from '@/lib/betting/bracketImage';
import { renderPlayoffsImage } from '@/lib/betting/playoffsImage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /playoffs as a PNG. Same parameter and auth as /api/bot/playoffs, and the same (briefly cached)
 * simulation, so the picture and the text fallback cannot disagree. Errors come back as JSON so the
 * bot can fall back to text.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;
  const { status, body } = await loadPlayoffs(new URL(request.url).searchParams.get('leagueId')?.trim());
  if (status !== 200) return NextResponse.json(body, { status });
  // Before the playoffs, odds of getting in; once they start, the live bracket.
  return body.phase === 'bracket' ? renderBracketImage(body) : renderPlayoffsImage(body);
}
