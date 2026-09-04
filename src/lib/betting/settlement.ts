import { getDb } from '@/lib/db';
import { settleFinishedMarkets, MarketRow } from '@/lib/betting/wagers';

/**
 * Drives settlement.
 *
 * `settleFinishedMarkets` knows how to pay out a week, but something has to decide
 * *when* a week is finished and hand it the final scores. That is this file, and it
 * is called lazily from the betting read routes rather than from a cron: a cron on
 * the VPS is one more thing that can silently stop, whereas a lazy sweep runs
 * whenever anyone actually looks at their balance — which is exactly when a payout
 * needs to have happened. The DB-backed debounce keeps the upstream cost flat no
 * matter how many people refresh.
 *
 * The whole thing is deliberately conservative. Every path that isn't certain the
 * week is over does nothing, because leaving a market open for another few minutes
 * is free, while settling on bad data moves real balances.
 */

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const ESPN_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/** How often the sweep is allowed to hit ESPN/Sleeper, regardless of traffic. */
const SWEEP_DEBOUNCE_SECONDS = 60;

/** ESPN's seasontype for the regular season. Fantasy weeks 1-18 all live here. */
const ESPN_REGULAR_SEASON = 2;

/**
 * Fewest games an NFL week can legitimately have. A real week has 13-16; a bye-heavy
 * week never drops near this. The point of the floor is to reject a *degraded* ESPN
 * response — an outage or a bad query returning `{events: []}` would otherwise read
 * as "no unfinished games", i.e. "the week is over", and settle every open market on
 * whatever Sleeper happened to say. That is the one failure here that costs money, so
 * it gets an explicit guard rather than relying on the all-post check.
 */
const MIN_PLAUSIBLE_GAMES_IN_WEEK = 12;

const META_KEY = 'settlement_last_sweep';

export type SweepResult = {
  ran: boolean;
  weeksChecked: number;
  settled: number;
  paidCents: number;
  skipped: string[];
};

function readMeta(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function writeMeta(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(key, value);
}

/**
 * True when every NFL game in that week is final.
 *
 * Returns null rather than false when ESPN can't be trusted for this week, so the
 * caller can tell "not finished yet" apart from "we don't know" and skip instead of
 * treating a fetch failure as a verdict.
 */
export async function nflWeekIsComplete(
  season: string,
  week: number,
): Promise<boolean | null> {
  const url = `${ESPN_SCOREBOARD_URL}?dates=${season}&seasontype=${ESPN_REGULAR_SEASON}&week=${week}`;
  let data: { events?: { competitions?: { status?: { type?: { state?: string } } }[] }[] };
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  const events = data.events ?? [];
  if (events.length < MIN_PLAUSIBLE_GAMES_IN_WEEK) return null;

  for (const event of events) {
    const state = event.competitions?.[0]?.status?.type?.state;
    // An unrecognised state is treated as unfinished — the conservative direction.
    if (state !== 'post') return false;
  }
  return true;
}

type MatchupLite = { roster_id: number; matchup_id: number | null; points: number | null };

/**
 * Runs one settlement sweep across every league week that still has live markets.
 *
 * `force` skips the debounce, for the admin/CLI path.
 */
export async function runDueSettlements(force = false): Promise<SweepResult> {
  const db = getDb();
  const empty: SweepResult = { ran: false, weeksChecked: 0, settled: 0, paidCents: 0, skipped: [] };

  if (!force) {
    const last = readMeta(META_KEY);
    if (last) {
      const ageSeconds = (Date.now() - Date.parse(last)) / 1000;
      if (Number.isFinite(ageSeconds) && ageSeconds < SWEEP_DEBOUNCE_SECONDS) return empty;
    }
  }
  writeMeta(META_KEY, new Date().toISOString());

  const pending = db
    .prepare(
      `SELECT DISTINCT league_id, season, week FROM markets
       WHERE status IN ('open','closed')
       ORDER BY season, week`,
    )
    .all() as { league_id: string; season: string; week: number }[];

  const result: SweepResult = { ran: true, weeksChecked: 0, settled: 0, paidCents: 0, skipped: [] };

  for (const { league_id: leagueId, season, week } of pending) {
    result.weeksChecked++;
    const label = `${season} wk${week}`;

    const complete = await nflWeekIsComplete(season, week);
    if (complete === null) {
      result.skipped.push(`${label}: could not confirm the NFL week from ESPN`);
      continue;
    }
    if (!complete) {
      result.skipped.push(`${label}: games still to finish`);
      continue;
    }

    const rows = await fetch(`${SLEEPER_BASE}/league/${leagueId}/matchups/${week}`, {
      cache: 'no-store',
    })
      .then(r => (r.ok ? (r.json() as Promise<MatchupLite[]>) : null))
      .catch(() => null);
    if (!rows || rows.length === 0) {
      result.skipped.push(`${label}: Sleeper returned no matchups`);
      continue;
    }

    const pointsByRoster = new Map<number, number>();
    for (const r of rows) {
      if (r.points == null) continue;
      pointsByRoster.set(r.roster_id, r.points);
    }

    // Sleeper's rows arrive in roster order, not in the market's a/b order, so
    // resolve each side from the stored roster ids rather than from array position.
    const markets = db
      .prepare(
        `SELECT * FROM markets
         WHERE league_id = ? AND season = ? AND week = ? AND status IN ('open','closed')`,
      )
      .all(leagueId, season, week) as MarketRow[];

    const finalScores = new Map<number, { a: number; b: number }>();
    for (const m of markets) {
      const a = pointsByRoster.get(m.roster_a);
      const b = pointsByRoster.get(m.roster_b);
      if (a == null || b == null) {
        result.skipped.push(`${label} matchup ${m.matchup_id}: a roster had no score`);
        continue;
      }
      // Every game is final, so a 0-0 matchup means Sleeper hasn't posted this week
      // rather than two teams genuinely scoring nothing. Refuse it.
      if (a === 0 && b === 0) {
        result.skipped.push(`${label} matchup ${m.matchup_id}: both sides 0, scores not posted`);
        continue;
      }
      finalScores.set(m.matchup_id, { a, b });
    }

    if (finalScores.size === 0) continue;

    const { settled, paid } = settleFinishedMarkets(leagueId, season, week, finalScores);
    result.settled += settled;
    result.paidCents += paid;
  }

  return result;
}

/**
 * Fire-and-forget wrapper for the read routes.
 *
 * A settlement failure must never turn a page load into a 500 — the balance shown
 * would just be one sweep stale — so this swallows errors after logging them.
 */
export async function settleQuietly(): Promise<void> {
  try {
    const r = await runDueSettlements();
    if (r.settled > 0) {
      console.log(`[betting] settled ${r.settled} market(s), paid ${r.paidCents} cents`);
    }
  } catch (e) {
    console.error('[betting] settlement sweep failed', e);
  }
}
