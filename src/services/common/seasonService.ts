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

/** True once the season in `state` has produced completed games. */
export function seasonHasPlayedGames(state: SleeperNflState): boolean {
  if (!PLAYED_SEASON_TYPES.includes(state.season_type)) return false;
  // Week 1 is in progress at week === 1; a result only exists once it's banked.
  return state.week >= 1;
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
