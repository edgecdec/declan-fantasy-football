import type { APIEmbed } from 'discord.js';
import { americanOdds, money, pad, padLeft } from './format';
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

  /*
   * EVERY OTHER EVENT IS SILENT, and the settlement ones are the point.
   *
   * wager_won / wager_lost / wager_void used to post individually, which turned one week into twenty
   * messages reading "collected $56.50" with no indication of which matchup. They are still written
   * to the outbox — they are the audit trail — but the readable version of a week is the single
   * week_settled digest below, which is the only thing that knows it is summarising twenty bets.
   *
   * market_settled fires once per market with no bettor, adding nothing the digest does not say.
   * line_moved rides the 60-second tick and needs coalescing and a movement threshold first.
   */
  return null;
}

type DigestBet = {
  bettor: string;
  pick: string;
  against: string | null;
  stakeCents: number;
  netCents: number;
  status: string;
  /** Oriented to the PICK, so the first number is always the side that was backed. */
  pickScore: number | null;
  againstScore: number | null;
};

type DigestStanding = {
  bettor: string;
  stakeCents: number;
  netCents: number;
  won: number;
  lost: number;
  voided: number;
};

/**
 * The week's betting, as two messages: who won and lost overall, then every bet.
 *
 * Two rather than one because they answer different questions and one would be too long for an embed
 * anyway — a ten-person league settles thirty-odd bets, which overruns the 4096-character description
 * limit once each line names its matchup.
 *
 * `leagueName` comes from the subscription rather than the payload: the bot knows which league it is
 * posting for, and the event does not carry a display name.
 */
export function formatWeekSettled(event: BetEvent, leagueName: string | null): APIEmbed[] {
  const p = event.payload;
  const bets = (Array.isArray(p.bets) ? p.bets : []) as DigestBet[];
  const standings = (Array.isArray(p.standings) ? p.standings : []) as DigestStanding[];
  if (bets.length === 0) return [];

  const champion = (p.champion ?? null) as DigestStanding | null;
  const loser = (p.loser ?? null) as DigestStanding | null;
  const staked = num(p, 'totalStakedCents') ?? 0;
  const net = num(p, 'totalNetCents') ?? 0;
  const where = leagueName ?? 'League';
  const bare = (cents: number) => (cents / 100).toFixed(2);
  const signed = (cents: number) => (cents > 0 ? '+' : '') + bare(cents);

  const summaryLines = [
    `${pad('bettor', 12)}${padLeft('staked', 9)}${padLeft('net', 9)}  W-L`,
  ];
  for (const s of standings) {
    summaryLines.push(
      pad(s.bettor, 12)
      + padLeft(bare(s.stakeCents), 9)
      + padLeft(signed(s.netCents), 9)
      + '  ' + `${s.won}-${s.lost}`
      + (s.voided ? ` (${s.voided} push)` : ''),
    );
  }

  const headline: string[] = [];
  if (champion) {
    headline.push(`👑 **${champion.bettor}** took the week, up **${money(champion.netCents)}**`);
  } else {
    // Every bet losing is a real outcome, and calling the least-bad result a champion would be worse
    // than saying plainly that the house won.
    headline.push('👑 Nobody finished the week up.');
  }
  if (loser) {
    headline.push(`💀 **${loser.bettor}** gave back **${money(Math.abs(loser.netCents))}**`);
  }

  const summary: APIEmbed = {
    title: `🏁 ${where} — week ${event.week} betting`,
    description: headline.join('\n') + '\n' + ['```', ...summaryLines, '```'].join('\n'),
    color: COLOUR.won,
    footer: {
      text:
        `${bets.length} bets · ${money(staked)} staked · bettors net ${money(net)}`
        + ` · house ${money(-net)} · Declan Dollars`,
    },
  };

  /*
   * Every bet, each NAMING ITS MATCHUP. That absence was the other half of the complaint: a payout
   * with no game attached is unverifiable, so the pick is shown against who it beat or lost to, with
   * the final score.
   */
  const detailLines: string[] = [];
  for (const b of bets) {
    const mark = b.status === 'won' ? '✅' : b.status === 'lost' ? '❌' : '➖';
    const score =
      b.pickScore != null && b.againstScore != null
        ? ` (${b.pickScore.toFixed(1)}-${b.againstScore.toFixed(1)})`
        : '';
    detailLines.push(
      `${mark} **${b.bettor}** ${money(b.stakeCents)} on ${b.pick}`
      + (b.against ? ` vs ${b.against}` : '')
      + score
      + ` → **${signed(b.netCents)}**`,
    );
  }

  const detail: APIEmbed = {
    title: `${where} — week ${event.week}, every bet`,
    // Truncated rather than split across messages: the summary carries the totals, so a very long
    // week loses detail rather than losing the point.
    description: detailLines.join('\n').slice(0, 4000),
    color: COLOUR.void,
  };

  return [summary, detail];
}
