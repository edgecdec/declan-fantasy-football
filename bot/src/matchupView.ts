import type { APIEmbed } from 'discord.js';
import { meter, pad, padLeft, percent } from './format';
import type { MatchupResponse, MatchupSlot } from './siteApi';

/**
 * /matchup as Discord messages: a scoreboard, and on demand the slot-by-slot comparison the This
 * Week page shows when a matchup row is expanded.
 *
 * Pure, so the layout is testable without a gateway. The data is the site's own matchup model
 * (`/api/bot/matchup` runs buildMatchupMarkets), so nothing here computes a probability — it only
 * lays one out.
 */

export type MatchupView = 'sum' | 'slot' | 'edge';

type HeadToHead = Extract<MatchupResponse, { headToHead: true }>;

const STATUS_LABEL: Record<HeadToHead['status'], string> = {
  live: '🟢 Live',
  between: '⏸ Between games',
  not_started: 'Not started',
  final: 'Final',
};

const COLOUR = { winning: 0x57f287, losing: 0xed4245, even: 0x5865f2 } as const;

const pts = (n: number) => n.toFixed(1);
const signed = (n: number) => (n > 0 ? '+' : '') + n.toFixed(1);

/** The scoreboard: names, score, projection, the win meter, and who has players left. */
export function renderMatchupSummary(m: HeadToHead): APIEmbed {
  const { me, opponent: them } = m;
  const final = m.status === 'final';
  const p = m.winProbability;

  const outcome = final
    ? me.banked > them.banked
      ? `**${me.displayName}** won`
      : me.banked < them.banked
        ? `**${them.displayName}** won`
        : 'Tied'
    : `${percent(p, 1)} – ${percent(1 - p, 1)}`;

  const lines = [
    `**${me.displayName}** vs **${them.displayName}**`,
    `# ${pts(me.banked)} – ${pts(them.banked)}`,
    final ? null : `proj **${pts(me.projected)}** – **${pts(them.projected)}**`,
    // The meter is the site's matchup bar: left share is the first-named side's chance.
    final ? outcome : `\`${meter(p)}\` ${outcome}`,
    final
      ? null
      : `${me.playersRemaining} v ${them.playersRemaining} left to play · ${STATUS_LABEL[m.status]}`,
  ].filter((l): l is string => l !== null);

  return {
    title: `${m.league.name} — week ${m.week}`,
    description: lines.join('\n'),
    color: final
      ? me.banked >= them.banked ? COLOUR.winning : COLOUR.losing
      : p > 0.55 ? COLOUR.winning : p < 0.45 ? COLOUR.losing : COLOUR.even,
  };
}

type Paired = { index: number; slot: string; mine?: MatchupSlot; theirs?: MatchupSlot; edge: number };

/**
 * Pairs the two lineups slot by slot.
 *
 * Meaningful because both sides share the league's roster_positions, so row 3 really is my RB2
 * against their RB2 — the same pairing the site's expanded row makes.
 *
 * The edge is on EXPECTED points (projection before kickoff, banked plus the unplayed share of the
 * projection during, points once final), not on points so far. On points alone every slot reads
 * 0.0 until kickoff and sorting by edge would do nothing; on expected points the same sort says
 * where the matchup is being won before a snap, and it lands on the actual result at the whistle.
 */
export function pairSlots(m: HeadToHead): Paired[] {
  const n = Math.max(m.me.lineup.length, m.opponent.lineup.length);
  return Array.from({ length: n }, (_, index) => {
    const mine = m.me.lineup[index];
    const theirs = m.opponent.lineup[index];
    return {
      index,
      slot: mine?.slot ?? theirs?.slot ?? '—',
      mine,
      theirs,
      edge: (mine?.expectedPoints ?? 0) - (theirs?.expectedPoints ?? 0),
    };
  });
}

const STATE_MARK: Record<MatchupSlot['gameState'], string> = { pre: '', in: ' ●', post: ' ✓', unknown: '' };

function playerLine(s: MatchupSlot | undefined): string {
  if (!s?.name) return '  — empty —';
  const label = s.position && s.position !== s.slot ? `${s.name} ${s.position}` : s.name;
  return (
    '  '
    + pad(label, 20)
    + padLeft(pts(s.points), 5)
    + ' / '
    + padLeft(pts(s.projectedPoints), 4)
    + STATE_MARK[s.gameState]
  );
}

/**
 * The side-by-side breakdown.
 *
 * A `diff` block, because Discord colours a `+` line green and a `-` line red: each slot's header
 * line is marked by who is winning it, so the colour alone shows where the matchup is being won and
 * lost — the job the site's "Slot edge" column does. Three short lines per slot rather than one wide
 * row, which fits a phone without wrapping.
 *
 * `edge` sorts biggest advantage first and biggest deficit last, the site's sort on that column.
 */
export function renderMatchupDetail(m: HeadToHead, view: 'slot' | 'edge'): APIEmbed {
  const paired = pairSlots(m);
  if (view === 'edge') paired.sort((x, y) => y.edge - x.edge || x.index - y.index);

  const rows: string[] = [];
  for (const p of paired) {
    const mark = p.edge >= 0.05 ? '+' : p.edge <= -0.05 ? '-' : ' ';
    rows.push(`${mark} ${pad(p.slot, 6)}${padLeft(signed(p.edge), 6)}`);
    rows.push(playerLine(p.mine));
    rows.push(playerLine(p.theirs));
  }

  const notes = matchupNotes(m);

  return {
    title: `${m.me.displayName} vs ${m.opponent.displayName} — by ${view === 'edge' ? 'edge' : 'slot'}`,
    description: [
      `Each slot: **${m.me.displayName}** first, **${m.opponent.displayName}** second.`,
      '```diff',
      ...rows,
      '```',
      ...notes.map(n => `-# ${n}`),
    ]
      .join('\n')
      .slice(0, 4000),
    color: COLOUR.even,
    footer: {
      text: 'edge = projected final difference in the slot · pts / proj · ● playing  ✓ final',
    },
  };
}

/** What the projection assumes beyond the lineup as set, so a number that disagrees with Sleeper's can be explained. */
export function matchupNotes(m: HeadToHead): string[] {
  const notes: string[] = [];
  for (const side of [m.me, m.opponent]) {
    const assumed = [
      ...side.assumedPromotions.map(n => `${n} starting`),
      ...side.assumedStreams.map(slot => `a ${slot} off waivers`),
    ];
    if (assumed.length) notes.push(`${side.displayName}: projection assumes ${assumed.join(', ')}`);
  }
  return notes;
}

/**
 * Button ids. All state lives in the id, as with the paging buttons, so a click works on a message
 * the current process never posted. `mu:<19-digit league>:<roster>:<week>:<view>` is about 35
 * characters, well under Discord's 100.
 */
export function matchupButtonId(leagueId: string, rosterId: number, week: number, view: MatchupView): string {
  return ['mu', leagueId, String(rosterId), String(week), view].join(':');
}

export function parseMatchupButtonId(
  id: string,
): { leagueId: string; rosterId: number; week: number; view: MatchupView } | null {
  const [kind, leagueId, roster, week, view] = id.split(':');
  if (kind !== 'mu' || !leagueId) return null;
  if (view !== 'sum' && view !== 'slot' && view !== 'edge') return null;
  const rosterId = Number(roster);
  const w = Number(week);
  if (!Number.isInteger(rosterId) || !Number.isInteger(w)) return null;
  return { leagueId, rosterId, week: w, view };
}
