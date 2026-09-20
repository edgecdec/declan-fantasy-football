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

/**
 * Types worth pinging a role for, if someone asks for "all".
 *
 * DELIBERATELY NOT every type. Measured across 810 real transactions: free_agent is 419 of them and
 * waiver 362, around 34 per league-week — a role pinged that often is indistinguishable from spam,
 * and the first thing anyone does is mute the channel, which loses the notifications altogether.
 * Trades (~0.7 per league-week) and eliminations (~1) are what people actually want interrupting.
 */
export const SUGGESTED_PING_TYPES: TransactionType[] = ['trade', 'chopped'];

export type Subscription = {
  guildId: string;
  channelId: string;
  leagueId: string;
  leagueName: string | null;
  eventTypes: TransactionType[];
  includeFailed: boolean;
  minFaab: number;
  /**
   * Which role to mention, per transaction type. A type absent from the map never pings.
   *
   * One role per (league, type) so trades can wake the league while waiver churn stays silent — and
   * so two different roles can care about two different things in the same league.
   */
  pingRoles: Partial<Record<TransactionType, string>>;
};

type Row = {
  guild_id: string;
  channel_id: string;
  league_id: string;
  league_name: string | null;
  event_types: string;
  include_failed: number;
  min_faab: number;
  ping_roles: string | null;
};

/** Parses a stored JSON type array, keeping only types this build understands. */
function parseStoredTypes(raw: string | null, fallback: TransactionType[]): TransactionType[] {
  if (raw == null) return [...fallback];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...fallback];
    // Filtered rather than trusted: a type this build does not understand would otherwise sit in the
    // set forever, silently matching nothing.
    return parsed.filter((t): t is TransactionType =>
      (TRANSACTION_TYPES as readonly string[]).includes(t as string),
    );
  } catch {
    // A malformed row falls back rather than dropping the subscription. Losing a binding is worse
    // than posting slightly more than asked.
    return [...fallback];
  }
}

/**
 * Parses the stored type -> role map.
 *
 * Unknown types are dropped for the same reason event types are: a key this build does not
 * understand would sit there forever matching nothing. A non-string value is dropped rather than
 * coerced, since a role id is always a snowflake string.
 */
function parsePingRoles(raw: string | null): Partial<Record<TransactionType, string>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Partial<Record<TransactionType, string>> = {};
    for (const [type, roleId] of Object.entries(parsed as Record<string, unknown>)) {
      if (!(TRANSACTION_TYPES as readonly string[]).includes(type)) continue;
      if (typeof roleId === 'string' && roleId) out[type as TransactionType] = roleId;
    }
    return out;
  } catch {
    return {};
  }
}

function hydrate(row: Row): Subscription {
  const eventTypes = parseStoredTypes(row.event_types, DEFAULT_EVENT_TYPES);
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    leagueId: row.league_id,
    leagueName: row.league_name,
    eventTypes,
    includeFailed: row.include_failed === 1,
    minFaab: row.min_faab,
    pingRoles: parsePingRoles(row.ping_roles),
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

/**
 * Sets, or with a null role clears, the ping for ONE transaction type.
 *
 * Read-modify-write of the whole map. Safe because better-sqlite3 is synchronous and the bot is a
 * single process, so there is no interleaving to lose an update to — and it keeps the map's shape in
 * one place rather than spread across SQL JSON functions.
 */
export function setPingRole(
  guildId: string,
  leagueId: string,
  type: TransactionType,
  roleId: string | null,
): boolean {
  const existing = subscription(guildId, leagueId);
  if (!existing) return false;

  const next = { ...existing.pingRoles };
  if (roleId) next[type] = roleId;
  else delete next[type];

  getBotDb()
    .prepare('UPDATE guild_subscriptions SET ping_roles = ? WHERE guild_id = ? AND league_id = ?')
    .run(JSON.stringify(next), guildId, leagueId);
  return true;
}

/** Clears every ping for a league in one go. */
export function clearPingRoles(guildId: string, leagueId: string): boolean {
  const info = getBotDb()
    .prepare(`UPDATE guild_subscriptions SET ping_roles = '{}' WHERE guild_id = ? AND league_id = ?`)
    .run(guildId, leagueId);
  return info.changes > 0;
}

export function setMinFaab(guildId: string, leagueId: string, minFaab: number): boolean {
  const info = getBotDb()
    .prepare('UPDATE guild_subscriptions SET min_faab = ? WHERE guild_id = ? AND league_id = ?')
    .run(Math.max(0, Math.floor(minFaab)), guildId, leagueId);
  return info.changes > 0;
}
