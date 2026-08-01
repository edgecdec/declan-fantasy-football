import { SleeperLeague } from '@/services/sleeper/sleeperService';

export type NumQbsSlug = '1qb' | '2qb';
export type PprSlug = 'ppr0' | 'ppr0_5' | 'ppr1';
export type TepSlug = 'te_none' | 'te_plus' | 'te_plus_plus';

const PPR_VALUES: Record<PprSlug, number> = { ppr0: 0, ppr0_5: 0.5, ppr1: 1 };

const TEP_LABELS: Record<TepSlug, string> = {
  te_none: 'No TE Premium',
  te_plus: 'TE Premium',
  te_plus_plus: 'TE Premium++',
};

/** Superflex/2QB if there are 2+ dedicated QB slots or a SUPER_FLEX slot -- matches
 *  FantasyCalc's own "numQbs" semantics (their enum literally calls value 2 "SUPERFLEX"). */
export function detectNumQbs(league: SleeperLeague): NumQbsSlug {
  const positions = league.roster_positions || [];
  const qbSlots = positions.filter(p => p === 'QB').length;
  const hasSuperFlex = positions.includes('SUPER_FLEX');
  return (qbSlots >= 2 || hasSuperFlex) ? '2qb' : '1qb';
}

/** Snaps the league's real PPR value to FantasyCalc's 3 supported buckets. */
export function detectPpr(league: SleeperLeague): PprSlug {
  const rec = league.scoring_settings?.rec ?? 0;
  if (rec >= 0.75) return 'ppr1';
  if (rec >= 0.25) return 'ppr0_5';
  return 'ppr0';
}

/**
 * Reproduces FantasyCalc's own tier formula (found in their client bundle):
 *   e = starting TE slots (default 1), r = tePremium bonus per catch
 *   e>=2 || r>1 -> TE++,  r>=0.5 -> TE+,  else off
 */
export function detectTep(league: SleeperLeague): TepSlug {
  const positions = league.roster_positions || [];
  const teStarters = positions.filter(p => p === 'TE').length || 1;
  const tePremium = league.scoring_settings?.bonus_rec_te ?? 0;
  if (teStarters >= 2 || tePremium > 1) return 'te_plus_plus';
  if (tePremium >= 0.5) return 'te_plus';
  return 'te_none';
}

// Individual slugs (e.g. "ppr0_5", "te_plus_plus") contain underscores themselves,
// so joining/splitting on "_" alone is ambiguous -- "|" can't appear in a slug.
export function dynastyVariantKey(numQbs: NumQbsSlug, ppr: PprSlug, tep: TepSlug): string {
  return `${numQbs}|${ppr}|${tep}`;
}

/** Picks the dynasty rankings variant that matches a league's real settings. */
export function recommendedDynastyVariant(league: SleeperLeague): string {
  return dynastyVariantKey(detectNumQbs(league), detectPpr(league), detectTep(league));
}

export function describeDynastyVariant(key: string): string {
  const [numQbs, ppr, tep] = key.split('|') as [NumQbsSlug, PprSlug, TepSlug];
  const parts = [
    numQbs === '2qb' ? 'Superflex' : '1QB',
    `${PPR_VALUES[ppr]} PPR`,
  ];
  if (tep !== 'te_none') parts.push(TEP_LABELS[tep]);
  return parts.join(' · ');
}

// Redraft doesn't need a numQbs axis -- unlike dynasty trade value (a holistic
// number FantasyCalc hands us), redraft "value" is computed by our own VBD math
// at runtime from the draft's real roster settings, which already raises QB
// replacement demand for a superflex draft. See useValuedPlayers.
export function redraftVariantKey(ppr: PprSlug, tep: TepSlug): string {
  return `${ppr}|${tep}`;
}

/** Picks the redraft rankings variant that matches a league's real settings. */
export function recommendedRedraftVariant(league: SleeperLeague): string {
  return redraftVariantKey(detectPpr(league), detectTep(league));
}

export function describeRedraftVariant(key: string): string {
  const [ppr, tep] = key.split('|') as [PprSlug, TepSlug];
  const parts = [`${PPR_VALUES[ppr]} PPR`];
  if (tep !== 'te_none') parts.push(TEP_LABELS[tep]);
  return parts.join(' · ');
}
