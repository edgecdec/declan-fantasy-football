import { SleeperNflState, SleeperService } from '@/services/sleeper/sleeperService';

/**
 * Earliest season Sleeper has league data for. Their `/stats/nfl/regular/<year>`
 * endpoint answers as far back as 2015, but `/user/<id>/leagues/nfl/<year>`
 * returns an empty list before 2017 (the platform's first NFL season), and
 * leagues are what every page here is actually built on. Verified against the
 * live API rather than assumed.
 */
export const FIRST_SLEEPER_SEASON = 2017;

/**
 * How a page wants its default season chosen.
 *
 * - `draft`   Flips the moment Sleeper opens the new league year (March-ish).
 *             Draft tools and the player database are forward-looking: during
 *             August drafts you want the upcoming season, not the last one.
 * - `roster`  Flips as soon as the new season's leagues exist for this user,
 *             since rosters are populated at league creation.
 * - `results` Holds on the last season that actually produced scores. Expected
 *             wins, performance review and league history all divide by games
 *             played, so flipping in March would show empty tables for six
 *             months.
 */
export type SeasonDefaultMode = 'draft' | 'roster' | 'results';

/**
 * Season types where the current season has produced real, completed games.
 * `pre` covers the whole March-to-August window, so it deliberately does not
 * qualify — see `results` in SeasonDefaultMode.
 */
const PLAYED_SEASON_TYPES: ReadonlyArray<SleeperNflState['season_type']> = ['regular', 'post', 'off'];

/**
 * Month (0-indexed) that Sleeper's new league year has reliably opened by.
 * Only consulted when `/state/nfl` is unreachable.
 */
const LEAGUE_YEAR_START_MONTH = 2; // March

/** The current season according to the client clock. Fallback only. */
function fallbackState(): SleeperNflState {
  const now = new Date();
  const calendarYear = now.getFullYear();
  // Before March the new league year hasn't opened, so the "current" Sleeper
  // season is still the prior calendar year.
  const season = now.getMonth() < LEAGUE_YEAR_START_MONTH ? calendarYear - 1 : calendarYear;
  return {
    season: String(season),
    previous_season: String(season - 1),
    league_season: String(season),
    league_create_season: String(season),
    // Assume no games yet: the conservative choice, since it keeps the
    // results-oriented pages on a season known to have data.
    season_type: 'pre',
    week: 0,
    display_week: 0,
    leg: 0,
    season_has_scores: false,
    season_start_date: '',
  };
}

/** Longest a fantasy regular season + playoffs can run. */
const MAX_SEASON_WEEKS = 18;

/**
 * How many weeks of `season` have actually been scored.
 *
 * This is the guard against phantom data. Sleeper's
 * `/league/<id>/matchups/<week>` answers for *every* week of the season, not
 * just played ones — ask it about week 17 in September and it echoes the
 * current roster back with 0 points. Any loop bounded by league settings
 * (`last_scored_leg`, `playoff_week_start`) therefore credits every rostered
 * player with a start in weeks that haven't happened. `last_scored_leg` is
 * absent entirely on a season that hasn't scored yet, so `|| 18` fallbacks turn
 * into 18 invented weeks.
 *
 * Callers should clamp their week range to this before counting anything.
 */
export function completedWeekCount(
  state: SleeperNflState,
  season: string,
  lastScoredLeg?: number,
): number {
  const target = Number(season);
  const current = Number(state.season);
  if (!Number.isFinite(target) || !Number.isFinite(current)) return 0;

  // A finished season is authoritative via its own last_scored_leg.
  if (target < current) return lastScoredLeg ?? MAX_SEASON_WEEKS;
  if (target > current) return 0;

  switch (state.season_type) {
    case 'pre':
      return 0;
    // The week Sleeper reports is the one in progress, so it isn't banked yet.
    case 'regular':
      return Math.max(0, state.week - 1);
    case 'post':
    case 'off':
      return lastScoredLeg ?? state.week;
    default:
      return 0;
  }
}

/**
 * True once the season in `state` has produced completed games.
 *
 * Deliberately conservative: during regular-season week 1 nothing has been
 * banked yet, so this stays false and the results-oriented pages hold on the
 * previous season rather than showing tables that divide by zero games.
 */
export function seasonHasPlayedGames(state: SleeperNflState): boolean {
  if (!PLAYED_SEASON_TYPES.includes(state.season_type)) return false;
  return completedWeekCount(state, state.season) >= 1;
}

/**
 * The season a page should default to, given Sleeper's calendar state.
 *
 * `roster` and `draft` differ only in intent, not in arithmetic — both track the
 * new league year as soon as it opens. They're kept distinct so a future change
 * to one doesn't silently move the other.
 */
export function resolveDefaultSeason(state: SleeperNflState, mode: SeasonDefaultMode): string {
  if (mode === 'results' && !seasonHasPlayedGames(state)) {
    return state.previous_season;
  }
  return state.season;
}

/**
 * Every season worth offering in a year picker, newest first. Spans
 * FIRST_SLEEPER_SEASON through the current league year, so a new season appears
 * on its own each year with no code change.
 */
export function buildSeasonRange(currentSeason: string): string[] {
  const latest = Number(currentSeason);
  if (!Number.isFinite(latest) || latest < FIRST_SLEEPER_SEASON) return [currentSeason];
  const count = latest - FIRST_SLEEPER_SEASON + 1;
  return Array.from({ length: count }, (_, i) => String(latest - i));
}

/**
 * Fetches Sleeper's calendar state, falling back to a clock-derived guess if the
 * API is unreachable so a network blip can't leave a page with no season at all.
 */
export async function getNflStateOrFallback(): Promise<SleeperNflState> {
  const state = await SleeperService.getNflState();
  return state ?? fallbackState();
}

/** Convenience: the default season for `mode`, resolved against live state. */
export async function getDefaultSeason(mode: SeasonDefaultMode): Promise<string> {
  const state = await getNflStateOrFallback();
  return resolveDefaultSeason(state, mode);
}
