/**
 * /playoffs — the response shape, and the parts of it that are pure arithmetic: which teams have
 * PROVABLY clinched or been eliminated, and what each playoff round is called.
 *
 * Imports nothing, because the bot loads these at runtime for its text fallback.
 */

export type PlayoffTeam = {
  rosterId: number;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** Mean final regular-season wins across sims (ties as half). */
  projectedWins: number;
  /** Regular-season games still to play, counting the live week and any median games. */
  gamesLeft: number;
  playoffProb: number;
  byeProb: number;
  /** P(alive in the semifinal / the final), and P(champion). */
  semisProb: number;
  finalProb: number;
  titleProb: number;
  /** P(seed k + 1), k = 0 … playoffTeams − 1. */
  seedProbs: number[];
  /** Only ever set from win bounds — never from a simulated 0% or 100%. */
  status: PlayoffStatus | null;
};

/** `bye` implies a playoff place; `in` is a place without a provable bye. */
export type PlayoffStatus = 'bye' | 'in' | 'out';

export type PlayoffsResponse = {
  /** Before the playoffs: odds of getting in. (Once they start, see BracketResponse.) */
  phase: 'regular';
  league: { leagueId: string; name: string; season: string };
  currentWeek: number;
  lastRegularWeek: number;
  playoffWeekStart: number;
  /** Regular-season weeks still to play, counting the live week. */
  weeksRemaining: number;
  playoffTeams: number;
  byes: number;
  sims: number;
  medianGame: boolean;
  divisions: boolean;
  /** Clinch and elimination marks are withheld when divisions make simple bounds unsound. */
  boundsApply: boolean;
  /** Teams, best playoff chance first. */
  teams: PlayoffTeam[];
};

type BoundsTeam = { rosterId: number; wins: number; ties: number; gamesLeft: number };

/**
 * Clinched and eliminated, from win bounds alone, so a mark is a proof rather than a simulation's
 * guess.
 *
 * With W = wins so far (a tie half) and r games left, a team finishes somewhere in [W, W + r].
 *
 *  - OUT: at least `playoffTeams` others already have MORE wins than this team can reach, so they
 *    finish ahead whatever happens — no tiebreak can rescue it.
 *  - IN:  fewer than `playoffTeams` others can even REACH this team's current total. A team that
 *    could tie it counts against it, since a tie goes to points for, which is not yet settled.
 *  - BYE: the same test against the number of byes.
 *
 * Head-to-head games still to come between two rivals cap them jointly (both cannot win the same
 * game), and that is ignored — so this can miss a clinch a full tiebreaker analysis would find, but
 * never claims one that is not real. Divisions break these bounds (a division winner can be seeded
 * past a better record), so the caller withholds the marks for a league with divisions.
 */
export function playoffStatus(teams: BoundsTeam[], playoffTeams: number, byes: number): Map<number, PlayoffStatus | null> {
  const lo = (t: BoundsTeam) => t.wins + t.ties / 2;
  const hi = (t: BoundsTeam) => lo(t) + t.gamesLeft;
  const out = new Map<number, PlayoffStatus | null>();
  for (const t of teams) {
    const others = teams.filter(o => o.rosterId !== t.rosterId);
    const surelyAhead = others.filter(o => lo(o) > hi(t)).length;
    const couldCatch = others.filter(o => hi(o) >= lo(t)).length;
    if (surelyAhead >= playoffTeams) out.set(t.rosterId, 'out');
    else if (byes > 0 && couldCatch < byes) out.set(t.rosterId, 'bye');
    else if (couldCatch < playoffTeams) out.set(t.rosterId, 'in');
    else out.set(t.rosterId, null);
  }
  return out;
}

/**
 * What the card calls each column, from the bracket size: the semifinal and final are always the
 * last two rounds; a bye only exists when the field is not a power of two.
 */
export function roundNames(playoffTeams: number): { bye: string | null; semis: string | null; final: string } {
  let size = 1;
  while (size < playoffTeams) size *= 2;
  return {
    bye: size > playoffTeams ? 'BYE' : null,
    semis: size >= 4 ? 'SEMIS' : null,
    final: 'FINAL',
  };
}

/**
 * A probability as the card prints it, in whole percent. A simulated certainty is never printed as
 * one — "<1" and ">99" — unless the bounds prove it, which the caller says with `proven`.
 */
export function pctText(p: number, proven: 'yes' | 'no' | null = null): string {
  if (proven === 'yes') return '100';
  if (proven === 'no') return '0';
  if (p <= 0) return '<1';
  if (p >= 1) return '>99';
  const v = Math.round(p * 100);
  if (v === 0) return '<1';
  if (v === 100) return '>99';
  return String(v);
}

export function recordText(t: Pick<PlayoffTeam, 'wins' | 'losses' | 'ties'>): string {
  return t.ties ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`;
}

/** One team in a live bracket. */
export type BracketTeam = {
  rosterId: number;
  name: string;
  seed: number;
  wins: number;
  losses: number;
  ties: number;
  /** This round: the opponent's name, 'TBD' while a re-seed is undecided, or null on a bye. */
  opponent: string | null;
  /** This round's points so far (banked weeks plus the live week), when it has started. */
  roundPoints: number | null;
  opponentPoints: number | null;
  /** P(alive in each later round), in `columns` order, then the title. */
  reach: number[];
  title: number;
};

/** Once the playoffs start: odds for each remaining round of the real winners bracket. */
export type BracketResponse = {
  phase: 'bracket';
  league: { leagueId: string; name: string; season: string };
  currentWeek: number;
  playoffWeekStart: number;
  rounds: number;
  currentRound: number;
  /** "two-week rounds" etc. */
  roundLength: string;
  reseed: boolean;
  sims: number;
  /** Later rounds shown as columns, e.g. SEMIS, FINAL; TITLE always follows. */
  columns: { round: number; label: string }[];
  /** Teams still alive, best title chance first. */
  teams: BracketTeam[];
  /** Decided winners-bracket matches, earliest first. */
  results: { round: number; label: string; winner: string; loser: string; winnerPoints: number | null; loserPoints: number | null }[];
};

export type PlayoffsBody = PlayoffsResponse | BracketResponse;
