import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { fetchImages } from '@/lib/betting/imageAssets';
import { loadMatchup } from '@/lib/betting/matchupData';
import { matchupAssetUrls, renderMatchupPng, type ImageMatchup } from '@/lib/betting/matchupImage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /matchup as a PNG: the compact summary card (`view=sum`, the command's default) or the per-slot
 * breakdown (`sort=slot|edge`). Same parameters as /api/bot/matchup otherwise. Errors come back as
 * JSON so the bot can say what went wrong and fall back to text.
 *
 * Avatars and headshots come through imageAssets: capped concurrency, a short timeout, a bounded
 * cache, and initials for anything that does not arrive — so a slow CDN costs a picture, not the
 * card.
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
  const m = body as unknown as ImageMatchup;
  // `view=sum` is the compact default card; otherwise the breakdown, by `sort` (slot unless edge).
  const view = params.get('view') === 'sum' ? 'sum' : params.get('sort') === 'edge' ? 'edge' : 'slot';
  const assets = await fetchImages(matchupAssetUrls(m, view));
  // Rendered to bytes (with an initials-only retry) rather than streamed — see renderMatchupPng.
  return new Response(await renderMatchupPng(m, view, assets), {
    headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
  });
}
