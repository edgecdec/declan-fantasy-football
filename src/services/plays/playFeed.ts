import {
  StatLine,
  addStats,
  isNonPlayStat,
  normalisePlayStats,
  scorePlayForPlayer,
} from '@/services/plays/playScoring';
import type { StoredPlay } from '@/lib/plays/playStore';

/**
 * The live play-by-play feed: what just happened, and what it was worth to you.
 *
 * Sleeper's own version of this ("Sleeper Zone") is mobile-only, so the point here is not
 * to mirror their UI but to answer the question their UI answers — a play just happened,
 * whose fantasy team did it help, and by how much. The awkward part is that the answer is
 * DIFFERENT IN EVERY LEAGUE: the same 27-yard catch is 2.7 points in one league, 3.7 in a
 * PPR one, and 4.2 where receptions and first downs both carry a bonus.
 *
 * So a play is scored once per league rather than once. That is why plays are stored raw
 * and never pre-scored, and it is why this is a fan-out over leagues rather than a single
 * number attached to a play.
 *
 * Two properties this has to preserve, both learned the hard way while reconciling 53,200
 * player-scores against Sleeper's official stats:
 *
 *  - REPLAY IN ORDER, from the start of the week. Milestone bonuses (100 rushing yards)
 *    depend on the player's running total BEFORE the play, so a feed cannot score the last
 *    20 plays in isolation and get the bonuses right.
 *  - ACCUMULATE UNROUNDED. Rounding each play to two decimals drifts against Sleeper's
 *    totals in any league that prices yards at 0.125.
 */

/** One league's view of a player's contribution to one play. */
export type LeagueImpact = {
  leagueId: string;
  leagueName: string;
  /** Unrounded points this play was worth in this league. */
  points: number;
  /**
   * The player's total for the week in this league, THROUGH this play.
   *
   * As of the play rather than as of now, which is what a feed wants: the newest entry shows the
   * current total, and an older one reads "he was on 14.30 after that catch" instead of silently
   * restating a number from later in the game.
   *
   * Accumulated by summing the per-play scores, which is legitimate here rather than an
   * approximation: reconciling 53,200 player-scores against Sleeper's official totals is exactly
   * what established that the sum matches to the cent, provided nothing is rounded on the way.
   * It therefore excludes what the play feed cannot be trusted for — team defence and IDP.
   */
  totalPoints: number;
  /** Whose fantasy team the player is on, from the viewer's perspective. */
  side: 'for' | 'against' | 'other';
  rosterId: number;
  ownerName: string | null;
  /** False for a bench player, whose points do not count this week. */
  isStarter: boolean;
};

export type FeedPlayer = {
  playerId: string;
  name: string;
  position: string | null;
  team: string | null;
  /** The stat delta as the feed reported it, for captioning what happened. */
  stats: StatLine;
  /** Bonus stats this play triggered, keyed per league since scoring differs. */
  impacts: LeagueImpact[];
  /** Largest absolute points across the leagues, for ordering players within a play. */
  peakPoints: number;
};

export type FeedEntry = {
  playId: string;
  gameId: string;
  sequence: number | null;
  playTime: number | null;
  /** Sleeper's quarter_name — "1".."4", "OT". */
  quarter: string | null;
  /** mm:ss remaining in the quarter. */
  clock: string | null;
  description: string;
  playType: string | null;
  isScoringPlay: boolean;
  players: FeedPlayer[];
  /**
   * Whether one of YOUR starters is involved, and whether one of your opponents' is.
   *
   * Both, rather than a single "does this concern me" flag: every play in this feed already
   * concerns the viewer — the roster maps only ever contain their players and their opponents' —
   * so a combined flag was true for every entry and could not discriminate anything. Which SIDE
   * a play helped is the distinction worth drawing.
   *
   * Both can be true at once: a quarterback of yours throwing to your opponent's receiver is one
   * play that cuts both ways, and that is exactly the case worth seeing.
   */
  yourStarter: boolean;
  theirStarter: boolean;
};

/** Where a player sits in one league. */
export type RosterSpot = {
  rosterId: number;
  ownerName: string | null;
  isStarter: boolean;
  side: 'for' | 'against' | 'other';
};

export type FeedLeague = {
  leagueId: string;
  leagueName: string;
  scoring: Record<string, number>;
  /** Player id -> where they sit. Missing means a free agent in this league. */
  roster: Map<string, RosterSpot>;
};

export type PlayerMeta = { n?: string | null; p?: string | null; t?: string | null };

/** Points below this are treated as no gain, so a 0.00 row never appears. */
const POINTS_EPSILON = 0.005;

export type FeedOptions = {
  /** How many entries to return, applied AFTER scoring and filtering. */
  limit?: number;
  /** Drop bench impacts, whose points do not count this week. */
  startersOnly?: boolean;
  /**
   * Only plays where some player gained at least this much, in some league.
   *
   * Measured on the LARGEST ABSOLUTE gain across leagues, so a lost fumble or an interception
   * counts as a big play. Those are the ones you most want to see, and treating them as small
   * because the number is negative would hide exactly the wrong half.
   */
  minPeakPoints?: number;
};

function formatClock(metadata: Record<string, unknown>): string | null {
  const m = metadata.time_remaining_minutes;
  const s = metadata.time_remaining_seconds;
  if (typeof m !== 'number' || typeof s !== 'number') return null;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * Replays a week's plays and returns the most recent ones that mattered to somebody.
 *
 * `plays` must be every play of the week in sequence order — see the note above about
 * milestone bonuses needing running totals. `limit` applies to the OUTPUT, after scoring,
 * so trimming the feed never changes the points on the plays that survive.
 */
export function buildPlayFeed(
  plays: StoredPlay[],
  leagues: FeedLeague[],
  players: Record<string, PlayerMeta>,
  options: FeedOptions = {},
): FeedEntry[] {
  const { limit = 50, startersOnly = false, minPeakPoints = 0 } = options;
  // Running stat totals per player, needed for the milestone bonuses. Kept per league because a
  // league's scoring settings decide nothing about the totals, but its roster decides
  // whether we bother — and it is simpler to be correct than to share and special-case.
  const totals = new Map<string, StatLine>();
  // Running POINTS per player per league, since the same yards are worth different amounts in
  // each one. Keyed on both, because a single per-player figure would be wrong in most leagues.
  const runningPoints = new Map<string, number>();
  const entries: FeedEntry[] = [];

  const ordered = [...plays].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  for (const play of ordered) {
    const metadata = play.metadata ?? {};
    const context = {
      playType: str(metadata.play_type),
      isScoringPlay: metadata.is_scoring_play === true,
      description: str(metadata.description),
    };

    const feedPlayers: FeedPlayer[] = [];

    for (const { player_id: playerId, stats: rawStats } of play.playStats) {
      const before = totals.get(playerId) ?? {};
      const delta = normalisePlayStats(rawStats ?? {}, context);
      // Advance the running total for EVERY player, whether or not they are rostered
      // anywhere: a milestone depends on the whole game, and skipping the unrostered
      // would break the bonus the moment someone picks them up mid-week.
      totals.set(playerId, addStats(before, delta));

      const meta = players[playerId] ?? {};
      const position = meta.p ?? null;

      const impacts: LeagueImpact[] = [];
      let peak = 0;
      for (const league of leagues) {
        const spot = league.roster.get(playerId);
        if (!spot) continue;
        // Bench impacts are dropped HERE rather than after the fact, so the big-play threshold
        // is measured against what the reader will actually see. Filtering afterwards let a
        // bench-only play clear the threshold and then arrive with nothing in it.
        if (startersOnly && !spot.isStarter) continue;
        const scored = scorePlayForPlayer(rawStats ?? {}, before, position, league.scoring, context);
        // Accumulated for EVERY play, including the scoreless ones skipped below: a running total
        // that only counted the plays worth showing would drift from the real one.
        const key = `${playerId}|${league.leagueId}`;
        const runningTotal = (runningPoints.get(key) ?? 0) + scored.total;
        runningPoints.set(key, runningTotal);
        if (Math.abs(scored.total) < POINTS_EPSILON) continue;
        impacts.push({
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          points: scored.total,
          totalPoints: runningTotal,
          side: spot.side,
          rosterId: spot.rosterId,
          ownerName: spot.ownerName,
          isStarter: spot.isStarter,
        });
        peak = Math.max(peak, Math.abs(scored.total));
      }

      if (impacts.length === 0) continue;
      if (peak < minPeakPoints) continue;
      feedPlayers.push({
        playerId,
        name: meta.n ?? `Player ${playerId}`,
        position,
        team: meta.t ?? null,
        // Only the stats a play can actually be trusted for. The feed over-attributes
        // defensive and IDP keys to offensive players, so showing them would caption a
        // quarterback with tackles he did not make.
        stats: Object.fromEntries(Object.entries(delta).filter(([k]) => !isNonPlayStat(k))),
        impacts,
        peakPoints: peak,
      });
    }

    if (feedPlayers.length === 0) continue;
    feedPlayers.sort((a, b) => b.peakPoints - a.peakPoints);

    entries.push({
      playId: play.playId,
      gameId: play.gameId,
      sequence: play.sequence,
      playTime: play.playTime,
      quarter: str(metadata.quarter_name),
      clock: formatClock(metadata),
      description: context.description ?? '',
      playType: context.playType,
      isScoringPlay: context.isScoringPlay,
      players: feedPlayers,
      yourStarter: feedPlayers.some(p => p.impacts.some(i => i.isStarter && i.side === 'for')),
      theirStarter: feedPlayers.some(p => p.impacts.some(i => i.isStarter && i.side === 'against')),
    });
  }

  // Newest first, and only after every play has been scored in order.
  return entries.reverse().slice(0, limit);
}

/**
 * A one-line caption for what a player did, from the stat delta.
 *
 * Sleeper's own play description is the narration ("K.Murray pass short right to
 * M.Harrison for 12 yards"); this is the fantasy-relevant summary of one player's part in
 * it, which is what a points figure needs to sit beside.
 */
export function describeStats(stats: StatLine): string {
  const bits: string[] = [];
  const n = (k: string) => stats[k] ?? 0;

  if (n('pass_cmp')) bits.push(`${n('pass_yd')} pass yd`);
  else if (n('pass_att')) bits.push('incomplete');
  if (n('pass_td')) bits.push(`${n('pass_td')} pass TD`);
  if (n('pass_int')) bits.push('INT');

  if (n('rec')) bits.push(`${n('rec')} rec, ${n('rec_yd')} yd`);
  else if (n('rec_tgt')) bits.push('target');
  if (n('rec_td')) bits.push('rec TD');

  if (n('rush_att')) bits.push(`${n('rush_att')} rush, ${n('rush_yd')} yd`);
  if (n('rush_td')) bits.push('rush TD');

  if (n('st_td')) bits.push('return TD');
  if (n('fum_lost')) bits.push('fumble lost');
  if (n('fgm')) bits.push('FG');
  if (n('fgmiss')) bits.push('FG miss');
  if (n('xpm')) bits.push('XP');
  if (n('xpmiss')) bits.push('XP miss');
  for (const k of ['pass_2pt', 'rec_2pt', 'rush_2pt']) if (n(k)) bits.push('2pt');

  const firstDowns = n('pass_fd') + n('rush_fd') + n('rec_fd');
  if (firstDowns) bits.push('1st down');

  return bits.join(' · ');
}
