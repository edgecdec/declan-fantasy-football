import { BENCH_SLOTS, SLOT_ELIGIBILITY, SLOT_PRIORITY } from '@/services/stats/lineupSlots';

/**
 * Assumes each manager will field their best available lineup in the slots that
 * are still changeable.
 *
 * Pricing whoever happens to be slotted right now understates a team, because a
 * manager can still swap anyone whose game has not kicked off. If a projected-18
 * receiver is on the bench and a projected-4 one is starting, the honest
 * expectation is that the good one gets started — so the odds should already
 * reflect it rather than lurching when the swap happens.
 *
 * Two hard rules, matching how Sleeper actually locks:
 *   - A player whose game has started or finished is frozen. He keeps his slot
 *     and his points, and he cannot be moved out or benched.
 *   - Only a player whose own game has not started can be moved into an open
 *     slot. You cannot pull in someone already playing or already done.
 */

/**
 * How much better the waiver tier must be before we assume a manager takes it.
 *
 * ANY slot can be streamed, at any position — a manager who is starting a
 * projected-4 tight end while eight better ones sit unrostered will fix that, and
 * the same is true of a bye-week hole anywhere on the roster. Restricting this to
 * K and DEF (as it once was) modelled the churn habit rather than the decision, and
 * left real, obvious upgrades invisible.
 *
 * But "would take any improvement" is not the behaviour either, so an edge below
 * this is ignored. Measured projection residuals on this data have a standard
 * deviation of 4.25 (low projections) to 5.64 (overall), so a sub-2-point projected
 * edge is well inside the noise: nobody can tell a true 7.8 from a true 6.5 in
 * advance, and assuming they churn for it would add fictional points to every team.
 *
 * The threshold is what keeps this from being inflationary. Measured across Graham's
 * ten teams in week 2: at any-improvement, 13 upgrades and +2.00 points per team; at
 * this threshold, 4 upgrades and +1.53, with eight of the ten teams unchanged at
 * exactly zero. The waiver pool is thin enough that only a neglected roster gains.
 *
 * Contention is handled separately — see `streamsByPosition`. Without it, nine of
 * ten teams would each "stream" the same top defence.
 */
const STREAM_UPGRADE_EDGE = 2;

/**
 * How many of the best remaining waiver options to average when filling a slot
 * from free agency.
 *
 * Naming a single player assumes the manager shares our projection ranking, which
 * they very likely do not — they will pick on matchup, name recognition, or
 * whatever their own app shows. Averaging the top few is the honest expectation:
 * we know roughly what tier they will land in, not which name.
 *
 * It also sidesteps an impossibility the single-pick version had. Nine of Graham's
 * ten teams would each "stream" the same top-projected defence, so the naive fix
 * was to claim players exclusively. Averaging a tier means several teams can share
 * the same expected value without any of them pretending to roster the same guy;
 * depletion is handled by sliding the window down one place per streamer at that
 * position.
 */
const STREAM_POOL_SIZE = 5;

export type LineupCandidate = {
  playerId: string;
  position: string | null;
  projectedPoints: number;
  actualPoints: number;
  /** 'pre' is swappable; 'in' and 'post' are locked; 'unknown' is treated as locked. */
  gameState: 'pre' | 'in' | 'post' | 'unknown';
  remainingMinutes: number;
  /**
   * Extra standard deviation beyond the position model. Set for a streamed slot,
   * where we know the tier but not which player, so the spread across the tier is
   * genuine additional uncertainty.
   */
  extraSd?: number;
  /**
   * Variance added without being scaled by the time left, because it is already conditioned on
   * it. Set for a defence, whose points-allowed bracket is re-projected from the live score.
   */
  extraVariance?: number;
  /**
   * Signed points against the expected REMAINING total, leaving the banked score untouched. Set
   * for a defence whose credited points-allowed bracket is unlikely to survive to the whistle.
   */
  meanAdjustment?: number;
};

/** A slot filled from waivers, as a tier average rather than a named player. */
export type StreamedSlot = {
  slot: string;
  /** Mean projection of the options considered. */
  projectedPoints: number;
  /** Spread across those options — extra uncertainty about which they take. */
  spread: number;
  /** The options averaged, best first, for showing the reasoning. */
  options: { playerId: string; projectedPoints: number }[];
};

export type BestLineupResult = {
  /** The lineup to price: locked starters plus the optimal fill of open slots. */
  starters: LineupCandidate[];
  /** Rostered bench players the model assumes get started. */
  promoted: LineupCandidate[];
  /** Slots filled from waivers, as averaged tiers. */
  streamed: StreamedSlot[];
  /** Currently-slotted players the model expects to be benched. */
  demoted: LineupCandidate[];
  /** Slots nobody at all could fill — these genuinely score nothing. */
  unfilledSlots: string[];
};

function eligible(slot: string, position: string | null): boolean {
  const allowed = SLOT_ELIGIBILITY[slot];
  if (!allowed) return false;
  return position !== null && allowed.includes(position);
}

/**
 * Builds the lineup to price for one side.
 *
 * `rosterPositions` is the league's slot list in order (including bench slots),
 * and `currentStarters` is positionally aligned to its non-bench entries, which
 * is how Sleeper reports a matchup. `freeAgents` is everyone unrostered across
 * the whole league, used to fill slots the roster cannot cover.
 */
export function bestAvailableLineup(
  rosterPositions: string[],
  currentStarters: (LineupCandidate | null)[],
  bench: LineupCandidate[],
  freeAgents: LineupCandidate[] = [],
  /**
   * How many teams in the league have already streamed each POSITION this week.
   * Mutated as we go, so a second team needing a defence averages a tier one place
   * further down the board. Callers building every matchup in a league should pass
   * one shared map.
   *
   * Keyed by position rather than by slot, and a streamed multi-position slot
   * advances every position it could have drawn from. A FLEX stream therefore also
   * depletes RB, WR and TE, so a later WR slot cannot re-award the same receiver.
   * That over-counts slightly when the FLEX was in fact filled by a running back,
   * which is the safe direction: it can only make a team look worse, never better.
   */
  streamsByPosition: Map<string, number> = new Map(),
): BestLineupResult {
  const startingSlots = rosterPositions.filter(s => !BENCH_SLOTS.has(s));

  const locked: LineupCandidate[] = [];
  const openSlots: string[] = [];
  const pool: LineupCandidate[] = [];

  startingSlots.forEach((slot, index) => {
    const current = currentStarters[index] ?? null;
    if (current && current.gameState !== 'pre') {
      locked.push(current);
      return;
    }
    openSlots.push(slot);
    if (current) pool.push(current);
  });

  for (const b of bench) {
    if (b.gameState === 'pre') pool.push(b);
  }

  const rosteredPool = [...pool].sort((a, b) => b.projectedPoints - a.projectedPoints);
  const agentPool = freeAgents
    .filter(f => f.gameState === 'pre' && f.projectedPoints > 0)
    .sort((a, b) => b.projectedPoints - a.projectedPoints);

  // Most restrictive slots first, so an elite flex-eligible player isn't burned
  // on a FLEX while a WR slot takes scraps.
  const orderedOpen = [...openSlots].sort(
    (a, b) => SLOT_PRIORITY.indexOf(a) - SLOT_PRIORITY.indexOf(b),
  );

  const chosen: LineupCandidate[] = [];
  const used = new Set<string>();
  const streamed: StreamedSlot[] = [];
  const unfilledSlots: string[] = [];

  for (const slot of orderedOpen) {
    const fromRoster = rosteredPool.find(p => !used.has(p.playerId) && eligible(slot, p.position));

    const slotPositions = SLOT_ELIGIBILITY[slot] ?? [];
    const eligibleAgents = agentPool.filter(p => eligible(slot, p.position));
    // Skip past the tiers earlier streamers are assumed to have taken.
    const alreadyStreamed = Math.max(
      0,
      ...slotPositions.map(p => streamsByPosition.get(p) ?? 0),
    );
    const window = eligibleAgents.slice(alreadyStreamed, alreadyStreamed + STREAM_POOL_SIZE);
    const mean = window.length
      ? window.reduce((s, p) => s + p.projectedPoints, 0) / window.length
      : 0;

    /*
     * Waivers win only by a clear margin. An empty slot is streamed whenever anything
     * is available (scoring it zero would badly understate the team); an occupied one
     * needs the tier to beat the player held by more than the noise floor.
     */
    const useWaivers =
      window.length > 0 && (!fromRoster || mean - fromRoster.projectedPoints > STREAM_UPGRADE_EDGE);

    if (!useWaivers) {
      if (fromRoster) {
        used.add(fromRoster.playerId);
        chosen.push(fromRoster);
      } else {
        unfilledSlots.push(slot);
      }
      continue;
    }

    // Deliberately NOT marking fromRoster used: displaced by a streamer here, he is
    // still available to fill a later slot he is eligible for, and only shows up as
    // demoted if nothing else wants him.
    for (const p of slotPositions) {
      streamsByPosition.set(p, (streamsByPosition.get(p) ?? 0) + 1);
    }

    const variance =
      window.reduce((s, p) => s + (p.projectedPoints - mean) ** 2, 0) / window.length;
    const spread = Math.sqrt(variance);

    streamed.push({
      slot,
      projectedPoints: mean,
      spread,
      options: window.map(p => ({ playerId: p.playerId, projectedPoints: p.projectedPoints })),
    });

    // Priced as a synthetic player carrying the tier's mean. `spread` is reported
    // separately so the caller can fold it into variance — we know the tier, not
    // the name, and that extra uncertainty is real.
    chosen.push({
      playerId: `stream:${slot}:${alreadyStreamed}`,
      position: window[0].position,
      projectedPoints: mean,
      actualPoints: 0,
      gameState: 'pre',
      remainingMinutes: window[0].remainingMinutes,
      extraSd: spread,
    });
  }

  const benchIds = new Set(bench.map(b => b.playerId));
  const promoted = chosen.filter(p => benchIds.has(p.playerId));
  const demoted = pool.filter(p => !used.has(p.playerId) && !benchIds.has(p.playerId));

  return {
    starters: [...locked, ...chosen],
    promoted,
    streamed,
    demoted,
    unfilledSlots,
  };
}
