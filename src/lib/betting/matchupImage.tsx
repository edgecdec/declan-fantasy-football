import fs from 'node:fs';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { MARKET_SIDE_COLORS } from '@/constants/colors';

/**
 * The matchup as a picture, laid out like Sleeper's mobile matchup screen.
 *
 * An image rather than Discord text because the layout IS the point and text cannot hold it: a
 * two-sided row needs colour on each side independently, and Discord's only colour tools are an
 * ANSI block (not rendered on mobile at all) and a diff block (one colour per whole line). So the
 * breakdown is drawn — players left and right, points against the centre, a position pill between
 * them — and Discord shows it the same on every client.
 *
 * Rendered with next/og (satori + resvg, both already inside Next), so there is no native
 * dependency to install on the box. Every element with more than one child must be display:flex;
 * satori does not do block layout.
 */

const W = 760;
const ROW_H = 68;
const HEADER_H = 206;
const FOOTER_H = 52;
/** Satori shrinks flex children to nothing unless told otherwise, so every column has a width. */
const PILL_W = 72;
const CELL_W = (W - PILL_W) / 2;
const SCORE_W = 76;
const STRIPE_W = 4;
const CELL_PAD = 8;
const NAME_W = CELL_W - SCORE_W - STRIPE_W - CELL_PAD * 2;

const C = {
  bg: '#0f1626',
  row: '#18213a',
  rowAlt: '#151d33',
  divider: '#243050',
  text: '#f2f5fa',
  muted: '#8792ab',
  dim: '#55607c',
  /** Points colour per game state: live and still-to-play stand out against finished. */
  live: '#3be37e',
  upcoming: '#8aa4ff',
  final: '#f2f5fa',
} as const;

/** Sleeper's position colours, as its pills use them. Text on them is dark. */
const SLOT: Record<string, { label: string; color: string }> = {
  QB: { label: 'QB', color: '#fc2b6d' },
  RB: { label: 'RB', color: '#20ceb8' },
  WR: { label: 'WR', color: '#56c9f8' },
  TE: { label: 'TE', color: '#feae58' },
  K: { label: 'K', color: '#bd66ff' },
  DEF: { label: 'DEF', color: '#bf755d' },
  FLEX: { label: 'FLEX', color: '#a3b0c8' },
  SUPER_FLEX: { label: 'SF', color: '#8b7bff' },
  REC_FLEX: { label: 'W/T', color: '#a3b0c8' },
  WRRB_FLEX: { label: 'W/R', color: '#a3b0c8' },
  DL: { label: 'DL', color: '#ff795a' },
  LB: { label: 'LB', color: '#ae9eff' },
  DB: { label: 'DB', color: '#ff7cb6' },
  IDP_FLEX: { label: 'IDP', color: '#a3b0c8' },
};

export type ImageSlot = {
  slot: string;
  name: string | null;
  position: string | null;
  team: string | null;
  points: number;
  projectedPoints: number;
  expectedPoints: number;
  gameState: 'pre' | 'in' | 'post' | 'unknown';
  gameDetail?: string | null;
};

export type ImageSide = {
  displayName: string;
  teamName: string | null;
  banked: number;
  projected: number;
  playersRemaining: number;
  lineup: ImageSlot[];
};

export type ImageMatchup = {
  league: { name: string };
  week: number;
  status: 'not_started' | 'live' | 'between' | 'final';
  winProbability: number;
  me: ImageSide;
  opponent: ImageSide;
};

let fonts: { name: string; data: Buffer; weight: 400 | 700; style: 'normal' }[] | null = null;
function loadFonts() {
  if (!fonts) {
    const dir = path.join(process.cwd(), 'assets', 'fonts');
    fonts = [
      { name: 'Geist', data: fs.readFileSync(path.join(dir, 'Geist-Regular.ttf')), weight: 400, style: 'normal' },
      { name: 'Geist', data: fs.readFileSync(path.join(dir, 'Geist-Bold.ttf')), weight: 700, style: 'normal' },
    ];
  }
  return fonts;
}

const pts = (n: number) => n.toFixed(1);

/** A chance that has not hit certainty never reads as 0% or 100% — the game is not over. */
function chanceText(p: number): string {
  if (p < 0.005) return '<1%';
  if (p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function stateColour(s: ImageSlot | undefined): string {
  if (!s?.name) return C.dim;
  if (s.gameState === 'in') return C.live;
  if (s.gameState === 'pre') return C.upcoming;
  return C.final;
}

/** One manager's half of a row. Mirrored for the right side so points sit against the centre. */
function PlayerCell({ s, side }: { s: ImageSlot | undefined; side: 'left' | 'right' }) {
  const colour = stateColour(s);
  const right = side === 'right';
  const empty = !s?.name;
  const sub = empty
    ? 'empty slot'
    : [s.position && s.position !== s.slot ? s.position : null, s.team, s.gameDetail]
        .filter(Boolean)
        .join(' · ');

  const stripe = (
    // The outer-edge stripe: live and yet-to-play players are findable at a glance down a column.
    <div style={{ width: STRIPE_W, height: 44, borderRadius: 2, flexShrink: 0, backgroundColor: s?.gameState === 'in' || s?.gameState === 'pre' ? colour : 'transparent' }} />
  );
  const names = (
    <div style={{ display: 'flex', flexDirection: 'column', width: NAME_W, flexShrink: 0, alignItems: right ? 'flex-end' : 'flex-start', padding: '0 10px' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: empty ? C.dim : C.text, whiteSpace: 'nowrap' }}>
        {empty ? '—' : clip(s.name!, 19)}
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 3, whiteSpace: 'nowrap' }}>{clip(sub, 30)}</div>
    </div>
  );
  const score = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-start' : 'flex-end', width: SCORE_W, flexShrink: 0 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: colour, whiteSpace: 'nowrap' }}>{empty ? '0.0' : pts(s.points)}</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 1, whiteSpace: 'nowrap' }}>
        {empty || s.gameState === 'post' ? '' : `proj ${pts(s.projectedPoints)}`}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', width: CELL_W, flexShrink: 0, alignItems: 'center', padding: `0 ${CELL_PAD}px` }}>
      {right ? <>{score}{names}{stripe}</> : <>{stripe}{names}{score}</>}
    </div>
  );
}

function SlotPill({ slot, edge }: { slot: string; edge: number }) {
  const s = SLOT[slot] ?? { label: slot.slice(0, 4), color: '#a3b0c8' };
  // The edge sits under the pill in the colour of whichever side is ahead in the slot.
  const lead = edge >= 0.05 ? MARKET_SIDE_COLORS.a : edge <= -0.05 ? MARKET_SIDE_COLORS.b : C.dim;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: PILL_W, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 26, borderRadius: 13, backgroundColor: s.color, color: C.bg, fontSize: 13, fontWeight: 700 }}>
        {s.label}
      </div>
      <div style={{ fontSize: 12, color: lead, marginTop: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>
        {Math.abs(edge) < 0.05 ? 'even' : `${edge > 0 ? '◀' : ''} ${Math.abs(edge).toFixed(1)} ${edge < 0 ? '▶' : ''}`.trim()}
      </div>
    </div>
  );
}

const STATUS_TEXT: Record<ImageMatchup['status'], string> = {
  live: 'LIVE',
  between: 'BETWEEN GAMES',
  not_started: 'NOT STARTED',
  final: 'FINAL',
};

function Header({ m }: { m: ImageMatchup }) {
  const p = m.winProbability;
  const final = m.status === 'final';
  const sideBlock = (s: ImageSide, right: boolean, colour: string, chance: number) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', width: (W - 48) / 2, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexDirection: right ? 'row-reverse' : 'row' }}>
        <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour, margin: right ? '0 0 0 8px' : '0 8px 0 0' }} />
        <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{clip(s.displayName, 18)}</div>
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{s.teamName ? clip(s.teamName, 28) : ' '}</div>
      <div style={{ fontSize: 48, fontWeight: 700, color: C.text, marginTop: 4 }}>{pts(s.banked)}</div>
      <div style={{ fontSize: 14, color: C.muted, whiteSpace: 'nowrap' }}>
        {final ? 'final' : `proj ${pts(s.projected)} · ${s.playersRemaining} to play · ${chanceText(chance)}`}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: HEADER_H, flexShrink: 0, padding: '18px 24px 14px', borderBottom: `1px solid ${C.divider}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.muted }}>
        <div>{clip(m.league.name, 40)}</div>
        <div style={{ color: m.status === 'live' ? C.live : C.muted, fontWeight: 700 }}>
          {`WEEK ${m.week} · ${STATUS_TEXT[m.status]}`}
        </div>
      </div>
      <div style={{ display: 'flex', marginTop: 10 }}>
        {sideBlock(m.me, false, MARKET_SIDE_COLORS.a, p)}
        {sideBlock(m.opponent, true, MARKET_SIDE_COLORS.b, 1 - p)}
      </div>
      {/* The site's matchup meter: left share is the left manager's chance. */}
      <div style={{ display: 'flex', marginTop: 12, height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: C.divider }}>
        <div style={{ width: `${Math.max(1, Math.min(99, p * 100))}%`, backgroundColor: MARKET_SIDE_COLORS.a }} />
        <div style={{ width: 2, backgroundColor: C.bg }} />
        <div style={{ flex: 1, backgroundColor: MARKET_SIDE_COLORS.b }} />
      </div>
    </div>
  );
}

function Legend({ sort }: { sort: 'slot' | 'edge' }) {
  const dot = (colour: string, label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', marginRight: 16 }}>
      <div style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colour, marginRight: 6 }} />
      <div>{label}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: FOOTER_H, flexShrink: 0, padding: '0 24px', fontSize: 13, color: C.muted, borderTop: `1px solid ${C.divider}` }}>
      <div style={{ display: 'flex' }}>
        {dot(C.live, 'Playing')}
        {dot(C.upcoming, 'Yet to play')}
        {dot(C.final, 'Final')}
      </div>
      <div>{sort === 'edge' ? 'sorted by projected edge' : 'centre: projected edge in the slot'}</div>
    </div>
  );
}

export function renderMatchupImage(m: ImageMatchup, sort: 'slot' | 'edge'): ImageResponse {
  const n = Math.max(m.me.lineup.length, m.opponent.lineup.length);
  const rows = Array.from({ length: n }, (_, index) => {
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
  if (sort === 'edge') rows.sort((x, y) => y.edge - x.edge || x.index - y.index);

  const height = HEADER_H + rows.length * ROW_H + FOOTER_H;
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: W, height, backgroundColor: C.bg, fontFamily: 'Geist' }}>
        <Header m={m} />
        {rows.map((r, i) => (
          <div key={r.index} style={{ display: 'flex', alignItems: 'center', height: ROW_H, flexShrink: 0, backgroundColor: i % 2 ? C.rowAlt : C.row, borderBottom: `1px solid ${C.divider}` }}>
            <PlayerCell s={r.mine} side="left" />
            <SlotPill slot={r.slot} edge={r.edge} />
            <PlayerCell s={r.theirs} side="right" />
          </div>
        ))}
        <Legend sort={sort} />
      </div>
    ),
    { width: W, height, fonts: loadFonts() },
  );
}
