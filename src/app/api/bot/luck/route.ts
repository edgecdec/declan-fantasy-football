import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { loadLuck } from '@/lib/betting/luckData';

export const dynamic = 'force-dynamic';

/**
 * Expected wins against actual wins — how lucky a league has been.
 *
 * Deliberately NOT restricted to betting leagues, unlike every other /api/bot route. This is public
 * Sleeper data with no money anywhere near it: the schedule, the scores, and the arithmetic of "how
 * often would this team's weekly total have beaten a random opponent". Any league id is fair game,
 * which is what makes the command useful for a league that has no Declan Dollars at all.
 *
 * The computation lives in `@/lib/betting/luckData`, shared with the picture route.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;
  const { status, body } = await loadLuck(new URL(request.url).searchParams.get('leagueId')?.trim());
  if (status !== 200) return NextResponse.json(body, { status });
  return NextResponse.json({ ok: true, ...body });
}
