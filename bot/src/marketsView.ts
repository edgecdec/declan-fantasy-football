import type { APIEmbed, APIEmbedField } from 'discord.js';
import { americanOdds, meter } from './format';
import type { MarketRow, MarketsResponse } from './siteApi';

/**
 * /markets as a Discord embed: one field per matchup, closest first.
 *
 * Pure, so the layout is testable without a gateway. Nothing here computes a score or a price — the
 * scoreline is what the tick's pricing pass stored beside the odds, so the projection on the board
 * is the one the line was struck from, and the one the website's markets page shows.
 *
 * Embed FIELDS rather than an aligned monospace table: Discord lays fields out itself, so a long
 * manager name cannot wrap and break the rows beneath it — which is exactly what happened to the
 * first version of this, where `KarrasKarras` and `Coldst2EvaDoIt` overflowed the block. Each line of
 * a field value is kept short for the same reason; the meter and the odds stay on separate lines
 * because together they were what pushed the first board past a phone's width.
 */

/** Discord's hard limit on fields per embed. Leagues top out well below it. */
const MAX_FIELDS = 25;

const pts = (n: number) => n.toFixed(1);
const score = (a: number, b: number) => `${pts(a)} – ${pts(b)}`;

/** Every game in the matchup is over: graded, or awaiting settlement with nothing left to play. */
function isFinal(m: MarketRow): boolean {
  return m.status === 'settled' || (m.status !== 'void' && m.remainingMinutes <= 0);
}

function winnerText(m: MarketRow): string | null {
  if (m.winner === 'a') return `${m.nameA ?? 'A'} won`;
  if (m.winner === 'b') return `${m.nameB ?? 'B'} won`;
  if (m.winner === 'push') return 'push';
  return null;
}

/**
 * The scoreline, in the same left–right order as the field name.
 *
 *  - before kickoff: `proj **128.4 – 121.7**`
 *  - once anyone has scored: `proj **128.4 – 121.7** · now 84.2 – 71.0` — the projected FINAL
 *    (banked plus expected remaining) leads, because that is the number the odds come from; the
 *    current score follows so a live board still says where things stand.
 *  - final: `final **131.2 – 119.8** · edgecdec won`, graded scores once settled.
 *
 * "Live" is anyone having banked points rather than a clock reading: between Thursday and Sunday a
 * matchup with a TNF starter has a real current score and no game on, and that is still worth
 * showing. Null when the row predates stored scorelines, so an old board renders as it always did
 * instead of printing zeros.
 */
export function scoreLine(m: MarketRow): string | null {
  if (m.status === 'void') return null;

  if (isFinal(m)) {
    const a = m.finalA ?? m.pointsA;
    const b = m.finalB ?? m.pointsB;
    if (a == null || b == null) return null;
    const won = m.status === 'settled' ? winnerText(m) : null;
    return `final **${score(a, b)}**` + (won ? ` · ${won}` : '');
  }

  if (m.projectedA == null || m.projectedB == null) return null;
  const line = `proj **${score(m.projectedA, m.projectedB)}**`;
  const a = m.pointsA ?? 0;
  const b = m.pointsB ?? 0;
  return a !== 0 || b !== 0 ? `${line} · now ${score(a, b)}` : line;
}

/**
 * Whether the meter and the odds are worth showing. A finished matchup drops them: by then the last
 * re-price has the winner at ~100% and a price like -19900, which is noise next to the result it is
 * restating. Kept when there is no score to show instead, so the field is never empty.
 */
function showsPrice(m: MarketRow): boolean {
  return !(isFinal(m) && scoreLine(m) !== null);
}

export function marketField(m: MarketRow): APIEmbedField {
  const scores = scoreLine(m);
  const lines = !showsPrice(m)
    ? [scores]
    : [
      scores,
      `\`${meter(m.probA)}\`  **${Math.round(m.probA * 100)}%**`,
      `${americanOdds(m.priceA)} / ${americanOdds(m.priceB)}`
        + (m.status === 'open' ? '' : `  ·  _${m.status}_`),
    ];
  return {
    name: `${m.nameA ?? 'A'}  vs  ${m.nameB ?? 'B'}`,
    value: lines.filter((l): l is string => l !== null).join('\n'),
    inline: false,
  };
}

export function renderMarketsEmbed(data: MarketsResponse): APIEmbed {
  // Closest matchups first, as the API returns them.
  const shown = data.markets.slice(0, MAX_FIELDS);
  return {
    title: `${data.league.label} — week ${data.week}`,
    fields: shown.map(marketField),
    color: 0x5865f2,
    footer: {
      // Explain only what is on the board: a finished week has no bar or odds to explain.
      text: shown.some(showsPrice)
        ? 'proj = projected final · bar = chance the left side wins · odds include the house vig'
        : 'all games final',
    },
  };
}
