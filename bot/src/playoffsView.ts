import type { APIEmbed } from 'discord.js';
import {
  pctText, recordText, roundNames, type BracketResponse, type PlayoffTeam, type PlayoffsBody, type PlayoffsResponse,
} from '@/lib/betting/playoffOdds';
import { pad, padLeft } from './format';

/**
 * /playoffs as Discord messages: the frame for the card (playoffsImage.tsx on the site), and the
 * text table that stands in when the card cannot be drawn. Pure, so it is testable without a
 * gateway. Same numbers, same proven-only marks, same column set as the card.
 */

const MAX_BODY = 1900;

/** Marks after a name in the text table, only when proven by win bounds. */
const MARK: Record<NonNullable<PlayoffTeam['status']>, string> = { in: '+', bye: '^', out: 'x' };

export function playoffsTitle(data: PlayoffsBody): string {
  return data.phase === 'bracket'
    ? `${data.league.name} — playoffs, round ${data.currentRound} of ${data.rounds}`
    : `${data.league.name} — playoff odds, week ${data.currentWeek}`;
}

export function playoffsImageEmbed(data: PlayoffsBody, fileName: string): APIEmbed {
  return { title: playoffsTitle(data), color: 0x5865f2, image: { url: `attachment://${fileName}` } };
}

/** Whole percent, with a proven certainty printed as one and nothing else. */
function cell(t: PlayoffTeam, p: number, provenYes: boolean): string {
  return pctText(p, t.status === 'out' ? 'no' : provenYes ? 'yes' : null);
}

/** The text fallback for either phase. */
export function renderPlayoffsText(data: PlayoffsBody): APIEmbed {
  return data.phase === 'bracket' ? renderBracketText(data) : renderRegularText(data);
}

const ROUND_SHORT: Record<string, string> = { QUARTERS: 'qf', SEMIS: 'semi', FINAL: 'fin' };

/** The live bracket as text: teams still alive, each later round, then the results so far. */
export function renderBracketText(data: BracketResponse): APIEmbed {
  const cols = [...data.columns.map(c => ROUND_SHORT[c.label] ?? `r${c.round}`), 'ttl'];
  const lines = [`${pad('alive', 13)}${pad('rec', 6)}${cols.map(c => padLeft(c, 5)).join('')}`];
  for (const t of data.teams) {
    const cells = [...t.reach, t.title].map((p, i) => pctText(p, i === 0 && t.opponent === null && t.reach.length > 0 ? 'yes' : null));
    lines.push(pad(`${t.seed} ${t.name.slice(0, 9)}${t.opponent === null ? '^' : ''}`, 13) + pad(recordText(t), 6) + cells.map(c => padLeft(c, 5)).join(''));
  }
  if (data.results.length) {
    lines.push('', 'results');
    for (const r of data.results) {
      const score = r.winnerPoints !== null && r.loserPoints !== null ? ` ${r.winnerPoints.toFixed(1)}-${r.loserPoints.toFixed(1)}` : '';
      lines.push(`${(ROUND_SHORT[r.label] ?? `r${r.round}`).padEnd(5)}${r.winner.slice(0, 11)} beat ${r.loser.slice(0, 11)}${score}`.slice(0, 44));
    }
  }
  return {
    title: playoffsTitle(data),
    description: ['```', ...lines, '```'].join('\n').slice(0, MAX_BODY),
    color: 0x5865f2,
    footer: {
      text:
        `${data.roundLength}${data.reseed ? ', re-seeded each round' : ''} · ^ bye this round`
        + ` · ${data.sims.toLocaleString('en-US')} sims of the rest of the bracket from banked weeks, the live week and the season model`,
    },
  };
}

function renderRegularText(data: PlayoffsResponse): APIEmbed {
  const names = roundNames(data.playoffTeams);
  const head = `${pad('team', 12)}${pad('rec', 6)}${padLeft('PO', 4)}`
    + (names.bye ? padLeft('bye', 5) : '')
    + (names.semis ? padLeft('semi', 5) : '')
    + `${padLeft('fin', 5)}${padLeft('ttl', 5)}`;
  const lines = [head];
  data.teams.forEach((t, i) => {
    const name = `${t.name.slice(0, 10)}${t.status ? MARK[t.status] : ''}`;
    lines.push(
      pad(name, 12) + pad(recordText(t), 6)
      + padLeft(cell(t, t.playoffProb, t.status === 'in' || t.status === 'bye'), 4)
      + (names.bye ? padLeft(cell(t, t.byeProb, t.status === 'bye'), 5) : '')
      + (names.semis ? padLeft(cell(t, t.semisProb, false), 5) : '')
      + padLeft(cell(t, t.finalProb, false), 5)
      + padLeft(cell(t, t.titleProb, false), 5),
    );
    if (i === data.playoffTeams - 1 && data.playoffTeams < data.teams.length) lines.push('- - - - - playoff line - - - - -');
  });
  const w = data.weeksRemaining;
  return {
    title: playoffsTitle(data),
    description: ['```', ...lines, '```'].join('\n').slice(0, MAX_BODY),
    color: 0x5865f2,
    footer: {
      text:
        `top ${data.playoffTeams} make it${data.byes ? `, top ${data.byes} bye` : ''}, playoffs from week ${data.playoffWeekStart}`
        + ` · ${data.sims.toLocaleString('en-US')} sims · ${w} week${w === 1 ? '' : 's'} left incl. this one`
        + (data.medianGame ? ' · median game modelled' : '')
        + (data.boundsApply
          ? ' · + clinched, ^ clinched bye, x eliminated — only when provable from wins'
          : ' · division winners seeded first; no clinch marks'),
    },
  };
}
