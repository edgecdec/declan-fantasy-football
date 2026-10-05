import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { loadMatchup } from '@/lib/betting/matchupData';

export const dynamic = 'force-dynamic';

/** One manager's matchup as JSON. See loadMatchup for who-is-it resolution and the model used. */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;
  const { status, body } = await loadMatchup(new URL(request.url).searchParams);
  return NextResponse.json(body, { status });
}
