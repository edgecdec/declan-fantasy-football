import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { loadMatchup } from '@/lib/betting/matchupData';
import { renderMatchupImage, type ImageMatchup } from '@/lib/betting/matchupImage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The matchup breakdown as a PNG, for /matchup's Details view. Same parameters as /api/bot/matchup,
 * plus `sort=slot|edge`. Errors come back as JSON so the bot can say what went wrong.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const { status, body } = await loadMatchup(params);
  if (status !== 200 || !body.headToHead) {
    return NextResponse.json(
      body.headToHead === false ? { ok: false, error: 'No head-to-head opponent this week.' } : body,
      { status: status === 200 ? 404 : status },
    );
  }
  return renderMatchupImage(body as unknown as ImageMatchup, params.get('sort') === 'edge' ? 'edge' : 'slot');
}
