import { NextResponse } from 'next/server';
import { REGULATION_MINUTES } from '@/services/betting/liveOdds';

/**
 * NFL game state, proxied from ESPN.
 *
 * Sleeper exposes live points but no kickoff time and no game clock, so there is
 * no way from Sleeper alone to tell a player who is yet to play from one who
 * played and scored nothing. ESPN's public scoreboard carries state, quarter and
 * clock for every game.
 *
 * Proxied rather than called from the browser for two reasons: it avoids
 * depending on ESPN's CORS headers, and the 30s revalidate means a room full of
 * people refreshing during a slate still only hits ESPN twice a minute.
 */
const ESPN_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

const REVALIDATE_SECONDS = 30;
/** ESPN's seasontype for the regular season. */
const ESPN_REGULAR_SEASON = 2;
const QUARTERS = 4;
const MINUTES_PER_QUARTER = 15;

/**
 * Sleeper team codes that differ from ESPN's. Verified against the full player
 * database: 31 of 33 codes match exactly, and only these two don't. `OAK` is
 * legacy — Sleeper still carries it on retired Raiders.
 */
const TEAM_ALIASES: Record<string, string> = { WAS: 'WSH', OAK: 'LV' };

export function espnTeamCode(sleeperTeam: string): string {
  return TEAM_ALIASES[sleeperTeam] ?? sleeperTeam;
}

export type NflGame = {
  id: string;
  name: string;
  state: 'pre' | 'in' | 'post';
  detail: string;
  period: number;
  clock: string;
  remainingMinutes: number;
  teams: string[];
};

export type NflGamesResponse = {
  ok: boolean;
  week: number | null;
  games: NflGame[];
  /** ESPN team abbreviation -> game id. */
  teamToGame: Record<string, string>;
  fetchedAt: string;
};

/** Regulation minutes left: 60 before kickoff, 0 once final. */
function remainingMinutes(state: string, period: number, clock: string): number {
  if (state === 'pre') return REGULATION_MINUTES;
  if (state === 'post') return 0;
  const [mm, ss] = clock.split(':');
  const inQuarter = (Number(mm) || 0) + (Number(ss) || 0) / 60;
  const fullQuartersLeft = Math.max(0, QUARTERS - period);
  return inQuarter + fullQuartersLeft * MINUTES_PER_QUARTER;
}

/**
 * The week to ask ESPN about — Sleeper's, never ESPN's default.
 *
 * This is the bug that made every week-2 matchup read 50/50. On the Tuesday after week 1, Sleeper's
 * NFL state had advanced to week 2 while ESPN's bare scoreboard still returned week 1 — all sixteen
 * games `post`. So every week-2 starter mapped to a FINISHED game, `sideDistribution` skipped the
 * lot, and both sides came out with a mean and variance of zero. `winProbability` returns exactly
 * 0.5 for that, so the whole page showed coin flips.
 *
 * Asking for an explicit week makes the two calendars agree. Sleeper is the authority because it is
 * the one deciding which week's lineups we are pricing.
 */
async function resolveWeek(
  params: URLSearchParams,
): Promise<{ season: string; week: number } | null> {
  const season = params.get('season');
  const week = Number(params.get('week'));
  if (season && Number.isInteger(week) && week > 0) return { season, week };

  try {
    const res = await fetch('https://api.sleeper.app/v1/state/nfl', { cache: 'no-store' });
    if (!res.ok) return null;
    const state = await res.json();
    if (!state?.season || !state?.week) return null;
    return { season: String(state.season), week: Number(state.week) };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const target = await resolveWeek(new URL(request.url).searchParams);
    // Falling back to the bare URL rather than failing: ESPN's default is wrong between weeks, but
    // it is better than no scoreboard at all, and every consumer degrades gracefully without one.
    const url = target
      ? `${ESPN_SCOREBOARD_URL}?dates=${target.season}&seasontype=${ESPN_REGULAR_SEASON}&week=${target.week}`
      : ESPN_SCOREBOARD_URL;

    const res = await fetch(url, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `ESPN returned ${res.status}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const games: NflGame[] = [];
    const teamToGame: Record<string, string> = {};

    for (const event of data.events ?? []) {
      const competition = event.competitions?.[0];
      if (!competition) continue;
      const status = competition.status ?? {};
      const state = (status.type?.state ?? 'pre') as NflGame['state'];
      const period = status.period ?? 0;
      const clock = status.displayClock ?? '0:00';

      const teams: string[] = (competition.competitors ?? [])
        .map((c: { team?: { abbreviation?: string } }) => c.team?.abbreviation)
        .filter((t: string | undefined): t is string => Boolean(t));

      for (const t of teams) teamToGame[t] = event.id;

      games.push({
        id: event.id,
        name: event.shortName ?? '',
        state,
        detail: status.type?.detail ?? '',
        period,
        clock,
        remainingMinutes: remainingMinutes(state, period, clock),
        teams,
      });
    }

    const payload: NflGamesResponse = {
      ok: true,
      // The week actually fetched, so a consumer can tell it got what it asked for.
      week: target?.week ?? data.week?.number ?? null,
      games,
      teamToGame,
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(payload);
  } catch (e) {
    console.error('ESPN scoreboard fetch failed', e);
    return NextResponse.json(
      { ok: false, error: 'Could not reach the NFL scoreboard.' },
      { status: 502 },
    );
  }
}
