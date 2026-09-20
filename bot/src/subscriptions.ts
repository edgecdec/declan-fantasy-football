import { getBotDb } from './botDb';

/**
 * Channel bindings: which league's activity posts where, and what counts as worth posting.
 *
 * The only persisted state the bot has.
 */

/**
 * Sleeper's transaction types, as measured across 810 real transactions in 8 leagues.
 *
 * `chopped` is undocumented and worth keeping: it is a guillotine elimination, and it arrives as a
 * transaction that drops the roster's entire player list at once.
 */
export const TRANSACTION_TYPES = [
  'trade',
  'waiver',
  'free_agent',
  'commissioner',
  'chopped',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/**
 * What a new subscription watches unless told otherwise.
 *
 * `free_agent` is included despite being the highest-volume type (419 of 810) because an add/drop is
 * the thing people most want to see. `commissioner` is in because a silent commissioner move is
 * exactly the kind of thing a league wants visible.
 */
export const DEFAULT_EVENT_TYPES: TransactionType[] = [
  'trade',
  'waiver',
  'free_agent',
  'commissioner',
  'chopped',
];

export type Subscription = {
  guildId: string;
  channelId: string;
  leagueId: string;
  leagueName: string | null;
  eventTypes: TransactionType[];
  includeFailed: boolean;
  minFaab: number;
};

type Row = {
  guild_id: string;
  channel_id: string;
  league_id: string;
  league_name: string | null;
  event_types: string;
  include_failed: number;
  min_faab: number;
};

function hydrate(row: Row): Subscription {
  let eventTypes: TransactionType[] = [...DEFAULT_EVENT_TYPES];
  try {
    const parsed = JSON.parse(row.event_types) as unknown;
    if (Array.isArray(parsed)) {
      // Filtered against the known list rather than trusted: a type this build does not understand
      // would otherwise sit in the set forever, silently matching nothing.
      eventTypes = parsed.filter((t): t is TransactionType =>
        (TRANSACTION_TYPES as readonly string[]).includes(t as string),
      );
    }
  } catch {
    // A malformed row falls back to the defaults rather than dropping the subscription. Losing a
    // binding is worse than posting slightly more than asked.
  }
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    leagueId: row.league_id,
    leagueName: row.league_name,
    eventTypes,
    includeFailed: row.include_failed === 1,
    minFaab: row.min_faab,
  };
}

/**
 * Binds a league to a channel, or moves an existing binding to a new channel.
 *
 * Upsert rather than insert: re-running `/admin watch` with a different channel must MOVE the
 * subscription. Inserting a second row would double-post every transaction, and the primary key
 * would reject it anyway — so the only two options were upsert or a confusing error.
 *
 * Deliberately preserves `event_types`, `include_failed` and `min_faab` on a move. Someone who has
 * tuned a league's filters and then moves the channel has not asked to reset them.
 */
export function watchLeague(args: {
  guildId: string;
  channelId: string;
  leagueId: string;
  leagueName?: string | null;
  eventTypes?: TransactionType[];
}): Subscription {
  const db = getBotDb();
  db.prepare(
    `INSERT INTO guild_subscriptions (guild_id, channel_id, league_id, league_name, event_types)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, league_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       league_name = COALESCE(excluded.league_name, guild_subscriptions.league_name)`,
  ).run(
    args.guildId,
    args.channelId,
    args.leagueId,
    args.leagueName ?? null,
    JSON.stringify(args.eventTypes ?? DEFAULT_EVENT_TYPES),
  );
  return subscription(args.guildId, args.leagueId)!;
}

export function unwatchLeague(guildId: string, leagueId: string): boolean {
  const info = getBotDb()
    .prepare('DELETE FROM guild_subscriptions WHERE guild_id = ? AND league_id = ?')
    .run(guildId, leagueId);
  return info.changes > 0;
}

export function subscription(guildId: string, leagueId: string): Subscription | undefined {
  const row = getBotDb()
    .prepare('SELECT * FROM guild_subscriptions WHERE guild_id = ? AND league_id = ?')
    .get(guildId, leagueId) as Row | undefined;
  return row ? hydrate(row) : undefined;
}

/** One guild's bindings. What `/admin watching` lists, and the privacy boundary for read commands. */
export function subscriptionsForGuild(guildId: string): Subscription[] {
  const rows = getBotDb()
    .prepare('SELECT * FROM guild_subscriptions WHERE guild_id = ? ORDER BY league_name, league_id')
    .all(guildId) as Row[];
  return rows.map(hydrate);
}

/**
 * Every binding across every guild — what the poller iterates.
 *
 * Note this is the ONLY place that crosses guild boundaries, and it exists because polling is
 * global while posting is per-subscription. Nothing built on it may leak one guild's league into
 * another's channel: each subscription carries its own channel, so the fan-out is per row.
 */
export function allSubscriptions(): Subscription[] {
  const rows = getBotDb()
    .prepare('SELECT * FROM guild_subscriptions ORDER BY league_id')
    .all() as Row[];
  return rows.map(hydrate);
}

/** Distinct leagues to poll, so two guilds watching one league cause one fetch rather than two. */
export function leaguesToPoll(): string[] {
  const rows = getBotDb()
    .prepare('SELECT DISTINCT league_id FROM guild_subscriptions')
    .all() as { league_id: string }[];
  return rows.map(r => r.league_id);
}

export function setEventTypes(
  guildId: string,
  leagueId: string,
  types: TransactionType[],
): boolean {
  const info = getBotDb()
    .prepare('UPDATE guild_subscriptions SET event_types = ? WHERE guild_id = ? AND league_id = ?')
    .run(JSON.stringify(types), guildId, leagueId);
  return info.changes > 0;
}

export function setIncludeFailed(guildId: string, leagueId: string, include: boolean): boolean {
  const info = getBotDb()
    .prepare('UPDATE guild_subscriptions SET include_failed = ? WHERE guild_id = ? AND league_id = ?')
    .run(include ? 1 : 0, guildId, leagueId);
  return info.changes > 0;
}

export function setMinFaab(guildId: string, leagueId: string, minFaab: number): boolean {
  const info = getBotDb()
    .prepare('UPDATE guild_subscriptions SET min_faab = ? WHERE guild_id = ? AND league_id = ?')
    .run(Math.max(0, Math.floor(minFaab)), guildId, leagueId);
  return info.changes > 0;
}
