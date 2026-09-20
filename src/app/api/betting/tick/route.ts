import { NextResponse } from 'next/server';
import { BETTING_LEAGUES } from '@/lib/betting/constants';
import { priceLeagueWeek } from '@/lib/betting/pricing';
import { runDueSettlements } from '@/lib/betting/settlement';
import { getNflStateOrFallback } from '@/services/common/seasonService';

export const dynamic = 'force-dynamic';

/**
 * The betting system's own clock, driven by cron.
 *
 * Every mutation in the betting stack used to be a side effect of a page load: `GET
 * /api/betting/markets` calls `settleQuietly()` and then `priceLeagueWeek()`, and the second of
 * those is what CREATES and re-prices `markets` rows. So if nobody opened the site on a Sunday
 * night, nothing was priced, nothing settled, and no state changed at all.
 *
 * That is a live correctness problem, not just an architectural wrinkle:
 *
 *  - lines go stale in a way that is exploitable. Four markets once sat above 99% still quoting
 *    -19900, which is what forced the `outcomeInDoubt` guard. That guard treats the symptom; this
 *    route treats the cause.
 *  - settlement waits on a reader. A wager can stay open for hours after its games finish purely
 *    because nobody loaded a page.
 *  - anything that wants to OBSERVE the system (a Discord bot) has nothing to observe, because no
 *    events ever fire unless a human happens to be looking.
 *
 * Deliberately mirrors `/api/plays/poll`: same shared-secret header, same idempotence, same
 * cron-shaped contract. The worst a valid call can do is re-price to the same numbers.
 *
 * `settleQuietly()` stays on the read routes as a fallback. Its `meta` debounce makes it nearly
 * free, and leaving it costs nothing — belt and braces for a cron that has stopped.
 */
function authorised(request: Request): boolean {
  const expected = process.env.POLL_SECRET || process.env.WEBHOOK_SECRET;
  if (!expected) return false;
  const provided = request.headers.get('x-poll-secret')
    ?? new URL(request.url).searchParams.get('secret');
  return provided === expected;
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorised.' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  /*
   * An explicit week re-prices that week instead of the live one. Needed to repair a week whose
   * prices were written against a stale scoreboard, and the only way to exercise this path outside
   * a live slate.
   */
  const explicitWeek = Number(params.get('week'));
  const force = params.get('force') === '1';

  const state = await getNflStateOrFallback();
  const week = Number.isFinite(explicitWeek) && explicitWeek > 0 ? explicitWeek : state.week;
  const season = params.get('season') ?? state.season;

  const priced: { leagueId: string; markets: number; error?: string }[] = [];
  for (const league of BETTING_LEAGUES) {
    /*
     * One league's failure must not stop the others. A Sleeper hiccup on one league would
     * otherwise leave every later league in the list unpriced and unsettled for the whole tick.
     */
    try {
      const markets = await priceLeagueWeek(league.leagueId, week);
      priced.push({ leagueId: league.leagueId, markets: markets.length });
    } catch (err) {
      priced.push({
        leagueId: league.leagueId,
        markets: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // After pricing, not before: settlement grades against the final scores that pricing just read.
  const settled = await runDueSettlements(force);

  return NextResponse.json({
    ok: true,
    season,
    week,
    priced,
    settled,
  });
}

/** Health check: what the last tick did, without causing one. */
export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorised.' }, { status: 401 });
  }
  const state = await getNflStateOrFallback();
  return NextResponse.json({
    ok: true,
    season: state.season,
    week: state.week,
    leagues: BETTING_LEAGUES.map(l => l.leagueId),
  });
}
