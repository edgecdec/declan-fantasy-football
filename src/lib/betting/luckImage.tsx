import type { ImageResponse } from 'next/og';
import type { LuckResponse, LuckTeam } from '@/lib/betting/luckData';
import {
  C, CARD_W, FOOTER_H, Footer, HEADER_STRIP_H, HeaderStrip, ManagerName, PAD_X, T, clip, renderCard,
} from '@/lib/betting/imageKit';

/**
 * /luck as a picture: actual wins, expected wins, and the gap between them, luckiest first.
 *
 * Sorted by LUCK here, unlike the JSON and the text table, which rank by expected wins (see
 * luckData.ts for why). The picture's subject is the gap itself, drawn as a diverging bar from zero,
 * and sorted by that gap the bars form one readable slope from the luckiest to the unluckiest —
 * sorted any other way they zig-zag and the chart stops saying anything at a glance. Expected wins
 * stays on every row, so the power ranking is still there to read.
 *
 * Green is better than the scores deserved and red is worse. Those two colours mean nothing else on
 * this card; the side blue and pink are not used, because luck has no sides.
 */

const W = CARD_W;
const TITLE_H = 54;
const COLS_H = 34;
const ROW_H = 62;

/** Column widths, left to right. They sum to the inner width. */
const COL = { rank: 40, name: 260, w: 64, xw: 82, bar: 180, luck: 86 } as const;

/** The luckiest first; equal luck breaks on expected wins, the better team first. */
export function sortByLuck(teams: LuckTeam[]): LuckTeam[] {
  return [...teams].sort((a, b) => b.luck - a.luck || b.expectedWins - a.expectedWins);
}

/**
 * The bar scale: the biggest gap in the league fills its half, but never less than one win, so a
 * league where everyone is within a tenth of a win does not draw those tenths as full-length bars.
 */
export function luckScale(teams: LuckTeam[]): number {
  return Math.max(1, ...teams.map(t => Math.abs(t.luck)));
}

/** True minus sign, so a negative reads as one rather than as a hyphen. */
export function signedLuck(n: number): string {
  if (Math.abs(n) < 0.005) return '0.00';
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`;
}

const wins = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function LuckBar({ luck, scale }: { luck: number; scale: number }) {
  const half = COL.bar / 2;
  const len = Math.max(2, Math.round((Math.min(Math.abs(luck), scale) / scale) * (half - 14)));
  const colour = luck >= 0 ? C.good : C.bad;
  // No bar at all for a dead-even team: a sliver of green would claim luck that is not there.
  const even = Math.abs(luck) < 0.005;
  return (
    <div style={{ display: 'flex', alignItems: 'center', width: COL.bar, height: 22, flexShrink: 0, position: 'relative' }}>
      {/* The zero line, so a bar's direction is never in doubt. */}
      <div style={{ position: 'absolute', left: half - 1, top: 0, width: 2, height: 22, backgroundColor: C.divider }} />
      {even ? null : (
        <div style={{ position: 'absolute', top: 5, height: 12, borderRadius: 3, backgroundColor: colour, width: len, left: luck >= 0 ? half + 1 : half - 1 - len }} />
      )}
    </div>
  );
}

function ColumnHeads() {
  const head = (label: string, width: number, align: 'left' | 'right' | 'center' = 'right') => (
    <div style={{ display: 'flex', width, flexShrink: 0, justifyContent: align === 'left' ? 'flex-start' : align === 'center' ? 'center' : 'flex-end' }}>{label}</div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: COLS_H, padding: `0 ${PAD_X}px`, fontSize: T.micro, fontWeight: 700, color: C.dim, borderTop: `1px solid ${C.divider}` }}>
      {head('#', COL.rank, 'left')}
      {head('MANAGER', COL.name, 'left')}
      {head('W', COL.w)}
      {head('xW', COL.xw)}
      {head('', COL.bar, 'center')}
      {head('LUCK', COL.luck)}
    </div>
  );
}

function Row({ t, index, scale }: { t: LuckTeam; index: number; scale: number }) {
  const num = (text: string, width: number, colour: string = C.text, size: number = T.name) => (
    <div style={{ display: 'flex', width, flexShrink: 0, justifyContent: 'flex-end', fontSize: size, fontWeight: 700, color: colour }}>{text}</div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: ROW_H, flexShrink: 0, padding: `0 ${PAD_X}px`, backgroundColor: index % 2 ? C.rowAlt : C.row, borderBottom: `1px solid ${C.divider}` }}>
      <div style={{ display: 'flex', width: COL.rank, flexShrink: 0, fontSize: T.small, fontWeight: 700, color: C.dim }}>{String(index + 1)}</div>
      <ManagerName name={clip(t.name, 18)} team={t.teamName} colour={null} align="left" width={COL.name} max={18} />
      {num(wins(t.actualWins), COL.w)}
      {num(t.expectedWins.toFixed(2), COL.xw, C.muted, T.body)}
      <LuckBar luck={t.luck} scale={scale} />
      {num(signedLuck(t.luck), COL.luck, Math.abs(t.luck) < 0.005 ? C.muted : t.luck > 0 ? C.good : C.bad)}
    </div>
  );
}

export function luckImageHeight(teams: number): number {
  return 4 + HEADER_STRIP_H + TITLE_H + COLS_H + teams * ROW_H + FOOTER_H;
}

export function renderLuckImage(data: LuckResponse): ImageResponse {
  const teams = sortByLuck(data.teams);
  const scale = luckScale(teams);
  const weeks = data.weeksCounted;
  // Said plainly, because the number invites over-reading: half a win of luck after two weeks is
  // noise, the same figure after twelve is a real story.
  const noise = weeks < 4;
  // A real element, not a fragment: satori renders only the first child of a fragment root.
  return renderCard(
    <div style={{ display: 'flex', flexDirection: 'column', width: W }}>
      <div style={{ display: 'flex', flexDirection: 'column', padding: `4px ${PAD_X}px 0` }}>
        <HeaderStrip league={data.league.name} status={`${weeks} WEEK${weeks === 1 ? '' : 'S'} PLAYED`} tone="neutral" />
        <div style={{ display: 'flex', alignItems: 'center', height: TITLE_H }}>
          <div style={{ fontSize: T.title, fontWeight: 700, color: C.text }}>Luck</div>
          <div style={{ fontSize: T.small, color: noise ? C.upcoming : C.muted, marginLeft: 12 }}>
            {noise ? 'luckiest first · few weeks in, mostly noise' : 'actual wins vs expected · luckiest first'}
          </div>
        </div>
      </div>
      <ColumnHeads />
      {teams.map((t, i) => <Row key={`${t.name}-${i}`} t={t} index={i} scale={scale} />)}
      <Footer left={<div>xW = expected wins vs a random opponent each week · luck = W − xW</div>} />
    </div>,
    luckImageHeight(teams.length),
  );
}
