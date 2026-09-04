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
  /** Players promoted off the bench, for explaining the number to a bettor. */
  promoted: LineupCandidate[];
  /** Currently-slotted players the model expects to be benched. */
  demoted: LineupCandidate[];
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
 * is how Sleeper reports a matchup.
 */
export function bestAvailableLineup(
  rosterPositions: string[],
  currentStarters: (LineupCandidate | null)[],
  bench: LineupCandidate[],
): BestLineupResult {
  const startingSlots = rosterPositions.filter(s => !BENCH_SLOTS.has(s));

  const locked: { slot: string; player: LineupCandidate }[] = [];
  const openSlots: string[] = [];
  const pool: LineupCandidate[] = [];

  startingSlots.forEach((slot, index) => {
    const current = currentStarters[index] ?? null;
    if (current && current.gameState !== 'pre') {
      // Already playing or done — frozen in place.
      locked.push({ slot, player: current });
      return;
    }
    openSlots.push(slot);
    if (current) pool.push(current);
  });

  // Only not-yet-started bench players can be promoted.
  for (const b of bench) {
    if (b.gameState === 'pre') pool.push(b);
  }

  // Best projected first, then fill the most restrictive slots first so an elite
  // flex-eligible player isn't burned on a FLEX while a WR slot goes to scraps.
  const available = [...pool].sort((a, b) => b.projectedPoints - a.projectedPoints);
  const orderedOpen = [...openSlots].sort(
    (a, b) => SLOT_PRIORITY.indexOf(a) - SLOT_PRIORITY.indexOf(b),
  );

  const chosen: LineupCandidate[] = [];
  const used = new Set<string>();

  for (const slot of orderedOpen) {
    const pick = available.find(p => !used.has(p.playerId) && eligible(slot, p.position));
    if (!pick) continue; // nobody eligible: the slot stays empty and scores nothing
    used.add(pick.playerId);
    chosen.push(pick);
  }

  const benchIds = new Set(bench.map(b => b.playerId));
  const promoted = chosen.filter(p => benchIds.has(p.playerId));
  const demoted = pool.filter(p => !used.has(p.playerId) && !benchIds.has(p.playerId));

  return {
    starters: [...locked.map(l => l.player), ...chosen],
    promoted,
    demoted,
  };
}
