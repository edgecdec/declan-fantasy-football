import type { APIEmbed } from 'discord.js';
import { formatRecord, type ScheduleSwapResponse } from '@/lib/betting/scheduleSwap';
import { pad, padLeft } from './format';

/**
 * /schedules as Discord messages: the frame for the matrix picture (scheduleImage.tsx on the site),
 * and the text that stands in when the picture cannot be drawn.
 *
 * A 10×10 matrix does not survive as text on a phone, so the fallback says the two things the
 * matrix is for instead: how kind each schedule was, and each manager's best and worst schedule.
 * Pure, so the layout is testable without a gateway.
 */

const MAX_BODY = 1900;

/** Signed, halves kept, ASCII minus: this lands in a monospace block where alignment is everything. */
const signed = (d: number, digits = 0) => {
  if (Math.abs(d) < 0.05) return digits ? (0).toFixed(digits) : '0';
  const abs = Math.abs(d);
  const body = digits ? abs.toFixed(digits) : Math.abs(abs - Math.round(abs)) < 1e-9 ? String(Math.round(abs)) : abs.toFixed(1);
  return `${d > 0 ? '+' : '-'}${body}`;
};

export function scheduleTitle(data: ScheduleSwapResponse): string {
  const w = data.weeksCounted;
  return `${data.league.name} — schedule swap, ${data.league.season} (${w} week${w === 1 ? '' : 's'})`;
}

export function scheduleImageEmbed(data: ScheduleSwapResponse, fileName: string): APIEmbed {
  return { title: scheduleTitle(data), color: 0x5865f2, image: { url: `attachment://${fileName}` } };
}

/** The kindest schedule first. */
export function kindnessRanking(data: ScheduleSwapResponse): { name: string; kindness: number }[] {
  return data.managers
    .map((m, i) => ({ name: m.name, kindness: data.kindness[i] }))
    .sort((a, b) => b.kindness - a.kindness || a.name.localeCompare(b.name));
}

export function renderScheduleText(data: ScheduleSwapResponse): APIEmbed {
  const lines = ['kindest schedules (avg wins for others)'];
  kindnessRanking(data).forEach((k, i) => {
    lines.push(`${padLeft(String(i + 1), 2)} ${pad(k.name, 16)}${padLeft(signed(k.kindness, 1), 6)}`);
  });
  lines.push('', `${pad('manager', 13)}${pad('actual', 7)}${pad('best', 10)}worst`);
  data.managers.forEach((m, r) => {
    const own = data.cells[r][r];
    const bw = (c: number) => (c < 0 ? '-' : `${signed(data.cells[r][c].delta!)} ${data.managers[c].short}`);
    lines.push(pad(m.name, 13) + pad(formatRecord(own), 7) + pad(bw(data.best[r]), 10) + bw(data.worst[r]));
  });
  return {
    title: scheduleTitle(data),
    description: ['```', ...lines, '```'].join('\n').slice(0, MAX_BODY),
    color: 0x5865f2,
    footer: {
      text:
        'your scores, someone else’s schedule: each week you face the opponent they faced'
        + ' (them, if that was you) · best/worst = wins vs your actual record · head-to-head only',
    },
  };
}

const count = (n: number) => Math.round(n).toLocaleString('en-US');
const share = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;

/**
 * The schedule percentile with its full three-way split, as a second embed: kindest schedule
 * first, two lines a manager — the shares, then the exact counts beneath — so it stays inside a
 * phone's width.
 */
export function renderSchedulePercentileText(data: ScheduleSwapResponse): APIEmbed {
  const totals = new Set(data.percentile.map(p => p.counts.total));
  const lines = [
    totals.size === 1 ? `of ${count([...totals][0])} round-robin schedules` : 'over every round-robin schedule',
    `${pad('manager', 12)}${padLeft('%ile', 5)}${padLeft('worse', 9)}${padLeft('same', 8)}${padLeft('better', 8)}`,
  ];
  data.managers
    .map((m, i) => ({ name: m.name, p: data.percentile[i] }))
    .sort((a, b) => b.p.percentile - a.p.percentile || a.name.localeCompare(b.name))
    .forEach(({ name, p }) => {
      lines.push(
        pad(name, 12)
        + padLeft((Math.round(p.percentile * 1000) / 10).toFixed(1), 5)
        + padLeft(share(p.worse), 9) + padLeft(share(p.same), 8) + padLeft(share(p.better), 8),
      );
      lines.push(
        pad('', 17)
        + padLeft(count(p.counts.worse), 9) + padLeft(count(p.counts.same), 8) + padLeft(count(p.counts.better), 8),
      );
    });
  return {
    title: `Schedule percentile — ${data.league.season}`,
    description: ['```', ...lines, '```'].join('\n').slice(0, MAX_BODY),
    color: 0x5865f2,
    footer: {
      text:
        'every opponent ordering where you play everyone once before anyone twice, all equally likely'
        + ' · worse/same/better = fewer / as many / more wins than your real schedule gave (a tie is half a win)'
        + ' · %ile = worse + half of same',
    },
  };
}
