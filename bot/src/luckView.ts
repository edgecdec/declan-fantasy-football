import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type APIEmbed } from 'discord.js';
import { sortLuckTeams, type LuckSort } from '@/lib/betting/luckSort';
import { pad, padLeft } from './format';
import type { LuckResponse } from './siteApi';

/**
 * /luck as Discord messages: the chart's frame, the text table that stands in when the chart cannot
 * be drawn, and the sort buttons.
 *
 * Pure, so the layout is testable without a gateway. Both renderings order rows with the same
 * `sortLuckTeams` the site's picture uses, so a sort button reorders the fallback exactly as it
 * reorders the chart.
 */

/** A Discord message body tops out at 2000; leave room for the code fence. */
const MAX_BODY = 1900;

const ORDER_TEXT: Record<LuckSort, string> = {
  xw: 'ranked by expected wins',
  luck: 'luckiest first',
};

export function luckTitle(data: LuckResponse): string {
  const w = data.weeksCounted;
  return `${data.league.name} — luck through ${w} week${w === 1 ? '' : 's'}`;
}

/** The frame for the chart (luckImage.tsx on the site), which carries its own header and legend. */
export function luckImageEmbed(data: LuckResponse, fileName: string): APIEmbed {
  return { title: luckTitle(data), color: 0x5865f2, image: { url: `attachment://${fileName}` } };
}

/** The text table, in the same order as the chart would have been. */
export function renderLuckText(data: LuckResponse, sort: LuckSort): APIEmbed {
  const signed = (n: number) => (n > 0 ? '+' : '') + n.toFixed(2);
  const lines = [`${pad('manager', 13)}${padLeft('W', 4)}${padLeft('exp', 7)}${padLeft('luck', 8)}`];
  for (const t of sortLuckTeams(data.teams, sort)) {
    lines.push(
      pad(t.name, 13)
      + padLeft(String(t.actualWins), 4)
      + padLeft(t.expectedWins.toFixed(2), 7)
      + padLeft(signed(t.luck), 8),
    );
  }
  return {
    title: luckTitle(data),
    description: ['```', ...lines, '```'].join('\n').slice(0, MAX_BODY),
    color: 0x5865f2,
    footer: {
      text:
        `${ORDER_TEXT[sort]} · `
        + 'exp = wins you would expect from your scores against a random opponent each week'
        + ' · luck = actual minus expected'
        /*
         * Said plainly, because the number invites over-reading. Half a win of "luck" after two
         * weeks is noise; the same figure after twelve is a real story, and nothing else on the
         * line tells you which you are looking at.
         */
        + (data.weeksCounted < 4 ? ' · few weeks so far, treat as noise' : ''),
    },
  };
}

/**
 * Button ids. All state lives in the id, as with the matchup and paging buttons, so a click works on
 * a message the current process never posted. `lk:<league>:<sort>` is under 30 characters against
 * Discord's 100 — and `league` may be any Sleeper league id, since /luck accepts any.
 */
export function luckButtonId(leagueId: string, sort: LuckSort): string {
  return ['lk', leagueId, sort].join(':');
}

export function parseLuckButtonId(id: string): { leagueId: string; sort: LuckSort } | null {
  const [kind, leagueId, sort] = id.split(':');
  if (kind !== 'lk' || !leagueId) return null;
  if (sort !== 'xw' && sort !== 'luck') return null;
  return { leagueId, sort };
}

/**
 * The two orders as a pair of buttons, the active one disabled — the same convention as /matchup's
 * By slot / By edge, so the buttons double as a label for the order on screen.
 */
export function luckButtons(leagueId: string, sort: LuckSort): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(luckButtonId(leagueId, 'xw'))
      .setLabel('By expected wins')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(sort === 'xw'),
    new ButtonBuilder()
      .setCustomId(luckButtonId(leagueId, 'luck'))
      .setLabel('By luck')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(sort === 'luck'),
  );
}
