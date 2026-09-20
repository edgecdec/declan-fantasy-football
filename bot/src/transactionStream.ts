import type { SleeperTransaction } from '@/services/sleeper/sleeperService';
import type { Subscription, TransactionType } from './subscriptions';

/**
 * League activity as a STREAM: post what happens from now on, forget everything else.
 *
 * No persistence, by explicit requirement. The seen-ids live in a `Set` in memory and die with the
 * process; anything that happened while the bot was down is dropped rather than caught up.
 *
 * ## The restart problem, and the one mechanism that solves it
 *
 * A naive "post anything not in the Set" floods the channel on every restart, because the Set starts
 * empty while Sleeper still returns the whole week — thirty-odd transactions, all of them already
 * old news, several of them days old.
 *
 * So the first sweep of a (league, week) SEEDS the Set and posts nothing. That is the entire trick,
 * and it is why `seed` is a distinct operation rather than a flag: a bug that let the first sweep
 * post would not fail any obvious test, it would just embarrass us once per deploy.
 *
 * The cost is honest and accepted: a transaction that lands in the seconds between process start and
 * the first sweep is never announced. At a 60-second cadence, on a stream where missed events are
 * explicitly droppable, that is the right trade against reposting a week's history.
 *
 * ## Why not `created > startedAt`
 *
 * A timestamp watermark looks simpler and is wrong in a way that matters here. Waiver claims all
 * process in one batch and Sleeper can return them out of order relative to their `created` values,
 * so a watermark either drops claims or reposts them depending on which side of the boundary it
 * rounds. A Set of ids cannot make that mistake.
 */

/** A week's worth of ids is ~34 per league, so the Set never needs bounding within a week. */
export type SeenIds = Set<string>;

export type StreamState = {
  /** Keyed `leagueId:week`, so a week rollover starts clean instead of accumulating forever. */
  seen: Map<string, SeenIds>;
};

export function createStreamState(): StreamState {
  return { seen: new Map() };
}

function key(leagueId: string, week: number): string {
  return `${leagueId}:${week}`;
}

/**
 * Whether this (league, week) has ever been swept.
 *
 * The distinction between "no ids seen" and "never looked" is the whole restart defence, and an
 * empty Set cannot express it — a genuinely quiet week and a fresh process look identical. So the
 * Map having a key at all is the signal.
 */
export function hasSeeded(state: StreamState, leagueId: string, week: number): boolean {
  return state.seen.has(key(leagueId, week));
}

/** Records every id without returning any, so a restart announces nothing that already happened. */
export function seed(
  state: StreamState,
  leagueId: string,
  week: number,
  transactions: SleeperTransaction[],
): void {
  state.seen.set(key(leagueId, week), new Set(transactions.map(t => t.transaction_id)));
}

/**
 * Transactions not yet seen for this (league, week), marking them seen as it goes.
 *
 * Returns them in the order they happened rather than the order Sleeper listed them, because a trade
 * and the drops that follow it read as nonsense out of order.
 *
 * NOT filtered by subscription here: one league may be watched by several guilds with different
 * filters, so "new" is a property of the league and "worth posting" is a property of the
 * subscription. Conflating them would mean the first guild's filter suppressed an event for
 * everyone.
 */
export function takeNew(
  state: StreamState,
  leagueId: string,
  week: number,
  transactions: SleeperTransaction[],
): SleeperTransaction[] {
  const k = key(leagueId, week);
  let seen = state.seen.get(k);
  if (!seen) {
    // Never swept: treat as a seed and return nothing. Belt and braces with hasSeeded, so a caller
    // that forgets to seed still cannot flood a channel.
    seed(state, leagueId, week, transactions);
    return [];
  }

  const fresh = transactions.filter(t => !seen!.has(t.transaction_id));
  for (const t of fresh) seen.add(t.transaction_id);
  return fresh.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
}

/**
 * Forgets weeks other than the current one.
 *
 * Called on rollover so the Map cannot grow across a season. Keeping only the live week is safe
 * because a finished week produces no new transactions, so there is nothing left to deduplicate.
 */
export function pruneToWeek(state: StreamState, week: number): void {
  for (const k of [...state.seen.keys()]) {
    if (!k.endsWith(`:${week}`)) state.seen.delete(k);
  }
}

/**
 * Does this subscription want to hear about this transaction?
 *
 * Three gates, in the order that discards the most first.
 */
export function wantsTransaction(sub: Subscription, tx: SleeperTransaction): boolean {
  if (!sub.eventTypes.includes(tx.type as TransactionType)) return false;

  /*
   * Failed claims are a THIRD of all transactions (267 of 810 measured). They are also the least
   * interesting: "someone did not get a player" is not news unless you are the someone. Opt-in.
   */
  if (tx.status !== 'complete' && !sub.includeFailed) return false;

  /*
   * FAAB floor, for leagues where $1 speculative claims are constant. Only applied to waivers that
   * actually carry a bid — a free agent pickup has no bid, and filtering it on a threshold it can
   * never meet would silently disable the type.
   */
  if (sub.minFaab > 0 && tx.type === 'waiver') {
    const bid = tx.settings?.waiver_bid;
    if (typeof bid === 'number' && bid < sub.minFaab) return false;
  }

  return true;
}

/** Fetches a league week's transactions straight from Sleeper. */
export async function fetchTransactions(
  leagueId: string,
  week: number,
): Promise<SleeperTransaction[]> {
  /*
   * Deliberately not SleeperService.getTransactions. That helper caches through CacheService, which
   * guards on `typeof window === 'undefined'` and no-ops in Node — so it would work by accident
   * here, and start silently serving stale data the moment anyone gave it a server-side cache. A
   * poller must never read a cache; a cached response means missing a trade for the TTL.
   */
  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${week}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as SleeperTransaction[]) : [];
}
