import type { SleeperTransaction } from '@/services/sleeper/sleeperService';

/**
 * Turning a Sleeper transaction into something worth reading in a Discord channel.
 *
 * Returns a plain object rather than a discord.js embed so it can be tested without a gateway
 * connection, and so the wire format is one import away from changing.
 *
 * The formatting problem is that `adds` and `drops` are both `player_id -> roster_id` maps whose
 * MEANING depends on the transaction type. In a free-agent move the roster id says who did it; in a
 * trade the same shape says who RECEIVES, and `drops` says who gave it up. Reading a trade with
 * free-agent logic produces a message that names the wrong manager as the one acquiring a player,
 * which is worse than no message.
 */

export type PlayerLookup = Record<string, { n?: string; p?: string | null; t?: string | null }>;

export type TransactionMessage = {
  title: string;
  lines: string[];
  /** Discord embed colour. */
  colour: number;
  /** Side-by-side columns, one per manager. Only trades use them. */
  fields?: { name: string; value: string; inline: boolean }[];
  /** When it happened, in ms — rendered by Discord in the reader's own timezone. */
  timestamp?: number;
};

const COLOUR = {
  trade: 0x5865f2,
  waiver: 0x57f287,
  failed: 0xed4245,
  free_agent: 0x3498db,
  commissioner: 0xfee75c,
  chopped: 0xe67e22,
  other: 0x99aab5,
} as const;

/**
 * A wall of text is worse than a summary. A chopped roster drops seventeen players at once, and no
 * channel wants that enumerated.
 */
const MAX_PLAYERS_LISTED = 6;

function playerName(playerId: string, players: PlayerLookup): string {
  const row = players[playerId];
  if (!row?.n) return `player ${playerId}`;
  return row.p ? `${row.n} (${row.p})` : row.n;
}

function nameList(ids: string[], players: PlayerLookup): string {
  if (ids.length === 0) return 'nobody';
  if (ids.length <= MAX_PLAYERS_LISTED) {
    return ids.map(id => playerName(id, players)).join(', ');
  }
  const shown = ids.slice(0, MAX_PLAYERS_LISTED).map(id => playerName(id, players));
  return `${shown.join(', ')} and ${ids.length - MAX_PLAYERS_LISTED} more`;
}

/** Player ids in a map that belong to one roster. */
function idsFor(map: Record<string, number> | null | undefined, rosterId: number): string[] {
  if (!map) return [];
  return Object.entries(map)
    .filter(([, r]) => r === rosterId)
    .map(([id]) => id);
}

export type ManagerNames = Map<number, string>;

function manager(rosterId: number, names: ManagerNames): string {
  return names.get(rosterId) ?? `Roster ${rosterId}`;
}

export function formatTransaction(
  tx: SleeperTransaction,
  names: ManagerNames,
  players: PlayerLookup,
  leagueName?: string | null,
): TransactionMessage {
  const where = leagueName ? ` · ${leagueName}` : '';
  const failed = tx.status !== 'complete';

  if (tx.type === 'trade') {
    return formatTrade(tx, names, players, where);
  }

  if (tx.type === 'chopped') {
    // The guillotine. The roster is gone, so the player list is noise — the count is the story.
    const rosterId = tx.roster_ids[0];
    const dropped = idsFor(tx.drops, rosterId).length;
    return {
      title: `🪓 Chopped${where}`,
      lines: [
        `**${manager(rosterId, names)}** has been eliminated.`,
        `${dropped} player${dropped === 1 ? '' : 's'} released to waivers.`,
      ],
      colour: COLOUR.chopped,
    };
  }

  const rosterId = tx.roster_ids[0];
  const added = idsFor(tx.adds, rosterId);
  const dropped = idsFor(tx.drops, rosterId);

  if (tx.type === 'waiver') {
    const bid = tx.settings?.waiver_bid;
    const cost = typeof bid === 'number' ? ` for $${bid}` : '';
    if (failed) {
      return {
        title: `❌ Waiver claim failed${where}`,
        lines: [`**${manager(rosterId, names)}** missed ${nameList(added, players)}${cost}.`],
        colour: COLOUR.failed,
      };
    }
    const lines = [`**${manager(rosterId, names)}** claimed ${nameList(added, players)}${cost}.`];
    if (dropped.length) lines.push(`Dropped ${nameList(dropped, players)}.`);
    return { title: `📝 Waiver${where}`, lines, colour: COLOUR.waiver };
  }

  if (tx.type === 'free_agent') {
    /*
     * An add, a drop, or both in one move — all three shapes occur, and `adds` or `drops` being
     * null is normal rather than a data problem.
     */
    const parts: string[] = [];
    if (added.length) parts.push(`added ${nameList(added, players)}`);
    if (dropped.length) parts.push(`dropped ${nameList(dropped, players)}`);
    return {
      title: failed ? `❌ Move failed${where}` : `🔁 Roster move${where}`,
      lines: [`**${manager(rosterId, names)}** ${parts.join(' · ') || 'made a move'}.`],
      colour: failed ? COLOUR.failed : COLOUR.free_agent,
    };
  }

  // commissioner, and anything Sleeper adds later. Named rather than swallowed: an unknown type
  // posting a generic line is far better than silently dropping real league activity.
  const parts: string[] = [];
  if (added.length) parts.push(`added ${nameList(added, players)}`);
  if (dropped.length) parts.push(`dropped ${nameList(dropped, players)}`);
  return {
    title: `🛠 ${tx.type === 'commissioner' ? 'Commissioner move' : tx.type}${where}`,
    lines: [`**${manager(rosterId, names)}** ${parts.join(' · ') || 'made a change'}.`],
    colour: tx.type === 'commissioner' ? COLOUR.commissioner : COLOUR.other,
  };
}

/** "Puka Nacua WR - LAR", Sleeper's own subtitle order. Team is often unknown for free agents. */
function tradeRow(playerId: string, players: PlayerLookup): string {
  const row = players[playerId];
  if (!row?.n) return `player ${playerId}`;
  const meta = [row.p, row.t].filter(Boolean).join(' - ');
  return meta ? `${row.n} ${meta}` : row.n;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * A trade laid out the way Sleeper's own trade card is: one column per manager, listing what that
 * manager RECEIVES, green, with anything they released to make room in red underneath.
 *
 * What each side gives up is deliberately not repeated — it is the other column, exactly as in the
 * app, and listing it twice was the wall-of-text the earlier one-line format turned into.
 *
 * The columns are inline embed fields, so Discord puts them side by side on desktop and stacks them
 * on mobile. The colour comes from a `diff` code block: Discord paints `+` lines green and `-` lines
 * red, which is as close to Sleeper's green and red as an embed gets.
 */
function formatTrade(
  tx: SleeperTransaction,
  names: ManagerNames,
  players: PlayerLookup,
  where: string,
): TransactionMessage {
  const received = new Set(Object.keys(tx.adds ?? {}));

  const fields = tx.roster_ids.map(rosterId => {
    const rows: string[] = [];
    const gets = idsFor(tx.adds, rosterId);
    for (const id of gets.slice(0, MAX_PLAYERS_LISTED)) rows.push(`+ ${tradeRow(id, players)}`);
    if (gets.length > MAX_PLAYERS_LISTED) rows.push(`+ and ${gets.length - MAX_PLAYERS_LISTED} more`);

    for (const pick of tx.draft_picks ?? []) {
      if (pick.owner_id !== rosterId) continue;
      // Whose pick it originally was matters once it has moved more than once — Sleeper shows it too.
      const via = pick.roster_id !== pick.previous_owner_id ? ` (${manager(pick.roster_id, names)})` : '';
      rows.push(`+ ${pick.season} ${ordinal(pick.round)} round pick${via}`);
    }
    for (const budget of tx.waiver_budget ?? []) {
      if (budget.receiver === rosterId) rows.push(`+ $${budget.amount} FAAB`);
    }

    // A drop that nobody received is a release to make roster room, not part of the swap.
    const released = idsFor(tx.drops, rosterId).filter(id => !received.has(id));
    for (const id of released) rows.push(`- ${tradeRow(id, players)}`);

    if (rows.length === 0) rows.push('  nothing');
    return {
      name: manager(rosterId, names),
      value: ['```diff', ...rows, '```'].join('\n').slice(0, 1024),
      inline: true,
    };
  });

  const sides = tx.roster_ids.map(r => `**${manager(r, names)}**`);
  return {
    title: `🔄 Trade${tx.status === 'complete' ? ' completed' : ` ${tx.status}`}${where}`,
    lines: [sides.join(' ⇄ ')],
    fields,
    colour: COLOUR.trade,
    timestamp: tx.status_updated ?? tx.created,
  };
}
