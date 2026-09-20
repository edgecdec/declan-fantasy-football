import type { APIEmbed } from 'discord.js';
import { americanOdds, money } from './format';
import type { BetEvent } from './siteApi';

/**
 * Turning bet outbox events into channel messages.
 *
 * Pure: takes an event, returns an embed or null. Kept apart from the polling loop so the wording
 * and the routing can be tested without a gateway connection, and so "which events are worth
 * posting" is one readable list rather than a switch buried in an async function.
 *
 * Returning null is meaningful and common. `market_settled` fires once per market and carries no
 * bettor, so announcing it would be noise on top of the per-wager results that follow it — the
 * interesting thing is who won or lost, not that a matchup finished.
 */

const COLOUR = {
  placed: 0x5865f2,
  won: 0x57f287,
  lost: 0xed4245,
  void: 0x99aab5,
} as const;

/** Reads a number off an untyped payload without turning undefined into 0. */
function num(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value ? value : null;
}

type Leg = {
  nameA?: unknown;
  nameB?: unknown;
  side?: unknown;
  price?: unknown;
  probability?: unknown;
};

/**
 * The side a wager backed, by name.
 *
 * The payload carries both manager names and which side was taken, because a market's `name_a` is
 * frozen at pricing time — resolving it later against Sleeper would rename anybody who has since
 * changed their display name, and a settled bet should read as it did when it was struck.
 */
function pickName(payload: Record<string, unknown>): string | null {
  const legs = payload.legs;
  if (!Array.isArray(legs) || legs.length === 0) return null;
  const leg = legs[0] as Leg;
  const side = leg.side === 'a' || leg.side === 'b' ? leg.side : null;
  if (!side) return null;
  const name = side === 'a' ? leg.nameA : leg.nameB;
  return typeof name === 'string' && name ? name : null;
}

function legPrice(payload: Record<string, unknown>): number | null {
  const legs = payload.legs;
  if (!Array.isArray(legs) || legs.length === 0) return null;
  const price = (legs[0] as Leg).price;
  return typeof price === 'number' ? price : null;
}

/**
 * The model's chance for the side backed, when the payload records it.
 *
 * Absent on events written before this was stored, and absent is rendered as nothing rather than as
 * a number derived from the price — the price includes the vig, so a percentage from it would
 * overstate the chance by about half the vig.
 */
function legProbability(payload: Record<string, unknown>): number | null {
  const legs = payload.legs;
  if (!Array.isArray(legs) || legs.length === 0) return null;
  const p = (legs[0] as Leg).probability;
  return typeof p === 'number' && p > 0 && p < 1 ? p : null;
}

/**
 * How to announce one event, or null to stay quiet.
 *
 * `bettor` is resolved by the caller from the account id, because the payload deliberately stores
 * ids rather than names — see pickName for why names in payloads are only trusted when they were
 * frozen at the time.
 */
export function formatBetEvent(event: BetEvent, bettor: string | null): APIEmbed | null {
  const who = bettor ?? 'Someone';
  const p = event.payload;

  if (event.type === 'wager_placed') {
    const stake = num(p, 'stakeCents');
    const toWin = num(p, 'toWinCents');
    if (stake == null || toWin == null) return null;
    const pick = pickName(p);
    const price = legPrice(p);
    const chance = legProbability(p);
    return {
      title: '🎲 Bet placed',
      description:
        `**${who}** put **${money(stake)}** on ${pick ?? 'a matchup'}`
        + (chance != null ? ` (${(chance * 100).toFixed(1)}%)` : '')
        + (price != null ? ` at ${americanOdds(price)}` : '')
        + `\nto win **${money(toWin)}**`,
      color: COLOUR.placed,
      footer: { text: `week ${event.week}` },
    };
  }

  if (event.type === 'wager_won') {
    const payout = num(p, 'payoutCents');
    const profit = num(p, 'profitCents');
    if (payout == null) return null;
    return {
      title: '💰 Bet won',
      description:
        `**${who}** collected **${money(payout)}**`
        + (profit != null ? ` — ${money(profit)} profit` : ''),
      color: COLOUR.won,
      footer: { text: `week ${event.week}` },
    };
  }

  if (event.type === 'wager_lost') {
    const stake = num(p, 'stakeCents');
    return {
      title: '💸 Bet lost',
      description: `**${who}** dropped **${money(stake ?? 0)}**`,
      color: COLOUR.lost,
      footer: { text: `week ${event.week}` },
    };
  }

  if (event.type === 'wager_void') {
    const refund = num(p, 'refundedCents') ?? num(p, 'stakeCents');
    return {
      title: '↩️ Bet voided',
      description:
        `**${who}** got **${money(refund ?? 0)}** back`
        + (str(p, 'reason') === 'tie' ? ' — the matchup tied' : ''),
      color: COLOUR.void,
      footer: { text: `week ${event.week}` },
    };
  }

  /*
   * market_settled and line_moved are intentionally silent.
   *
   * market_settled fires once per market with no bettor, so it adds nothing to the per-wager results
   * that accompany it. line_moved is the highest-volume event in the system, riding the 60-second
   * tick, and needs coalescing and a movement threshold before it is fit to post at all.
   */
  return null;
}
