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
    /*
     * Per roster: what it RECEIVES (its id in `adds`) and what it GIVES UP (its id in `drops`).
     * Deriving it this way rather than pairing the two maps means a three-team trade, or one with
     * uneven counts, reads correctly without special-casing.
     */
    const lines = tx.roster_ids.map(rosterId => {
      const gets = idsFor(tx.adds, rosterId);
      const gives = idsFor(tx.drops, rosterId);
      const parts: string[] = [];
      if (gets.length) parts.push(`gets ${nameList(gets, players)}`);
      if (gives.length) parts.push(`gives ${nameList(gives, players)}`);
      return `**${manager(rosterId, names)}** ${parts.join(' · ') || 'no players'}`;
    });
    const picks = tx.draft_picks?.length ?? 0;
    if (picks > 0) lines.push(`_plus ${picks} draft pick${picks === 1 ? '' : 's'}_`);
    return {
      title: `🔄 Trade${where}`,
      lines,
      colour: COLOUR.trade,
    };
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
