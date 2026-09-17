import type { SleeperLeague } from '@/services/sleeper/sleeperService';

/**
 * What kind of league this is, for filtering a week down to the ones you care about.
 *
 * `settings.type` carries it. Sleeper documents 0, 1 and 2; **3 is undocumented and means an
 * elimination format** — measured across a 20-league account, type 3 selected exactly the two
 * leagues that give every roster its own `matchup_id` (an 18-team chopped league and a 16-team
 * guillotine) and nothing else. Both also carry `last_chopped_leg`, which no other league has.
 *
 * Because 3 is undocumented, nothing that MATTERS keys off it alone: elimination risk is
 * computed from the actual matchup structure and roster state, and this is only used to label
 * and group. If Sleeper reassigns the number, a filter chip is wrong rather than a projection.
 */
export const CHOPPED_LEAGUE_TYPE = 3;

export type LeagueFormat = 'redraft' | 'keeper' | 'dynasty' | 'chopped';

export const LEAGUE_FORMAT_LABEL: Record<LeagueFormat, string> = {
  redraft: 'Redraft',
  keeper: 'Keeper',
  dynasty: 'Dynasty',
  chopped: 'Chopped',
};

/** Order to show filters in: the two big buckets first, then the rarer ones. */
export const LEAGUE_FORMATS: LeagueFormat[] = ['redraft', 'dynasty', 'keeper', 'chopped'];

export function leagueFormat(league: Pick<SleeperLeague, 'settings'>): LeagueFormat {
  switch (league.settings?.type) {
    case CHOPPED_LEAGUE_TYPE:
      return 'chopped';
    case 2:
      return 'dynasty';
    case 1:
      return 'keeper';
    default:
      return 'redraft';
  }
}

/**
 * True when every roster has its own `matchup_id`, i.e. there is no opponent to beat.
 *
 * This is the BEHAVIOURAL test, and the one to trust over `settings.type`. A pair of rosters
 * sharing a `matchup_id` is what makes a head-to-head matchup; an elimination format gives each
 * roster a distinct one, so the count of distinct ids equals the count of entries.
 */
export function hasNoHeadToHead(matchupIds: (number | null)[]): boolean {
  const present = matchupIds.filter((id): id is number => id != null);
  if (present.length === 0) return false;
  return new Set(present).size === present.length;
}
