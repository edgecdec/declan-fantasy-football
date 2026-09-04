import { BENCH_SLOTS, SLOT_ELIGIBILITY, SLOT_PRIORITY } from '@/services/stats/lineupOptimizer';

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
 * Positions we will fill from waivers when a roster cannot cover the slot at all.
 *
 * Limited to K and DEF because that is the real behaviour: managers carry an extra
 * flex body all week and grab a kicker or defence right before kickoff. Leaving
 * that slot empty scores it zero and badly understates the team. Extending this to
 * WR or RB would be wrong — nobody churns their receiving corps off waivers every
 * week, so assuming it would inflate every projection.
 *
 * Note this fires ONLY for a slot with no eligible rostered player. We do not
 * assume a manager upgrades a kicker or defence they already hold, even when a
 * better one is unrostered, because the waiver pool is a shared resource: in
 * Graham's league nine of ten teams would otherwise all "stream" the same
 * top-projected defence, which is impossible and inflated every side by about
 * five points. If someone does make that upgrade, the odds move then.
 */
const STREAMABLE_POSITIONS = new Set(['K', 'DEF']);

export type LineupCandidate = {
  playerId: string;
  position: string | null;
  projectedPoints: number;
  actualPoints: number;
  /** 'pre' is swappable; 'in' and 'post' are locked; 'unknown' is treated as locked. */
  gameState: 'pre' | 'in' | 'post' | 'unknown';
  remainingMinutes: number;
};

export type BestLineupResult = {
  /** The lineup to price: locked starters plus the optimal fill of open slots. */
  starters: LineupCandidate[];
  /** Rostered bench players the model assumes get started. */
  promoted: LineupCandidate[];
  /** Free agents the model assumes get streamed in. */
  streamed: LineupCandidate[];
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

/** True when this slot only accepts positions we are willing to stream. */
function slotIsStreamable(slot: string): boolean {
  const allowed = SLOT_ELIGIBILITY[slot];
  if (!allowed || allowed.length === 0) return false;
  return allowed.every(p => STREAMABLE_POSITIONS.has(p));
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
   * Free agents already assigned to another team this week. Mutated as we claim.
   * Two teams cannot stream the same player, so callers building every matchup in
   * a league should pass one shared set.
   */
  claimedFreeAgents: Set<string> = new Set(),
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
    .filter(
      f =>
        f.gameState === 'pre' &&
        f.projectedPoints > 0 &&
        !claimedFreeAgents.has(f.playerId),
    )
    .sort((a, b) => b.projectedPoints - a.projectedPoints);

  // Most restrictive slots first, so an elite flex-eligible player isn't burned
  // on a FLEX while a WR slot takes scraps.
  const orderedOpen = [...openSlots].sort(
    (a, b) => SLOT_PRIORITY.indexOf(a) - SLOT_PRIORITY.indexOf(b),
  );

  const agentIds = new Set(agentPool.map(a => a.playerId));
  const chosen: LineupCandidate[] = [];
  const used = new Set<string>();
  const streamedIds = new Set<string>();
  const unfilledSlots: string[] = [];

  for (const slot of orderedOpen) {
    const fromRoster = rosteredPool.find(p => !used.has(p.playerId) && eligible(slot, p.position));
    const fromWaivers = agentPool.find(p => !used.has(p.playerId) && eligible(slot, p.position));

    // The roster always wins when it can cover the slot. Waivers are a fallback
    // for a slot nobody on the roster can fill, and only at a streamable
    // position — see STREAMABLE_POSITIONS for why we don't assume upgrades.
    const pick: LineupCandidate | undefined =
      fromRoster ?? (slotIsStreamable(slot) ? fromWaivers : undefined);

    if (!pick) {
      unfilledSlots.push(slot);
      continue;
    }
    used.add(pick.playerId);
    if (agentIds.has(pick.playerId)) {
      streamedIds.add(pick.playerId);
      // Claim it so no other team in the league streams the same player.
      claimedFreeAgents.add(pick.playerId);
    }
    chosen.push(pick);
  }

  const benchIds = new Set(bench.map(b => b.playerId));
  const promoted = chosen.filter(p => benchIds.has(p.playerId));
  const streamed = chosen.filter(p => streamedIds.has(p.playerId));
  const demoted = pool.filter(p => !used.has(p.playerId) && !benchIds.has(p.playerId));

  return {
    starters: [...locked, ...chosen],
    promoted,
    streamed,
    demoted,
    unfilledSlots,
  };
}
