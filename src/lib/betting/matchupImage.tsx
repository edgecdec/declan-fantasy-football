import type { ImageResponse } from 'next/og';
import {
  C, CARD_W, FOOTER_H, Footer, HeaderStrip, LegendDot, ManagerName, PAD_X, T, WinBar,
  clip, pts, renderCard, type StatusTone,
} from '@/lib/betting/imageKit';

/**
 * The matchup as a picture, laid out like Sleeper's mobile matchup screen.
 *
 * An image rather than Discord text because the layout IS the point and text cannot hold it: a
 * two-sided row needs colour on each side independently, and Discord's only colour tools are an
 * ANSI block (not rendered on mobile at all) and a diff block (one colour per whole line). So the
 * breakdown is drawn — players left and right, points against the centre, a position pill between
 * them — and Discord shows it the same on every client.
 *
 * Palette, type scale, header, footer, names and the win bar come from imageKit, shared with the
 * /markets and /luck cards so all three read as one set.
 */

const W = CARD_W;
const ROW_H = 70;
const HEADER_H = 250;
/** The win bar's band, dropped once the matchup is final. */
const BAR_BAND_H = 38;
/** Satori shrinks flex children to nothing unless told otherwise, so every column has a width. */
const PILL_W = 72;
const CELL_W = (W - PILL_W) / 2;
const SCORE_W = 84;
const STRIPE_W = 4;
const CELL_PAD = 8;
const NAME_W = CELL_W - SCORE_W - STRIPE_W - CELL_PAD * 2;

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
      <div style={{ fontSize: T.player, fontWeight: 700, color: empty ? C.dim : C.text, whiteSpace: 'nowrap' }}>
        {empty ? '—' : clip(s.name!, 19)}
      </div>
      <div style={{ fontSize: T.micro, color: C.muted, marginTop: 3, whiteSpace: 'nowrap' }}>{clip(sub, 28)}</div>
    </div>
  );
  const score = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-start' : 'flex-end', width: SCORE_W, flexShrink: 0 }}>
      <div style={{ fontSize: T.score, fontWeight: 700, color: colour, whiteSpace: 'nowrap' }}>{empty ? '0.0' : pts(s.points)}</div>
      <div style={{ fontSize: T.micro, color: C.muted, marginTop: 1, whiteSpace: 'nowrap' }}>
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
  const lead = edge >= 0.05 ? C.sideA : edge <= -0.05 ? C.sideB : C.dim;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: PILL_W, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 54, height: 28, borderRadius: 14, backgroundColor: s.color, color: C.bg, fontSize: T.micro, fontWeight: 700 }}>
        {s.label}
      </div>
      <div style={{ fontSize: T.micro, color: lead, marginTop: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>
        {Math.abs(edge) < 0.05 ? 'even' : `${edge > 0 ? '◀' : ''} ${Math.abs(edge).toFixed(1)} ${edge < 0 ? '▶' : ''}`.trim()}
      </div>
    </div>
  );
}

const STATUS: Record<ImageMatchup['status'], { text: string; tone: StatusTone }> = {
  live: { text: 'LIVE', tone: 'live' },
  between: { text: 'BETWEEN GAMES', tone: 'upcoming' },
  not_started: { text: 'NOT STARTED', tone: 'upcoming' },
  final: { text: 'FINAL', tone: 'final' },
};

function Header({ m }: { m: ImageMatchup }) {
  const final = m.status === 'final';
  const half = (W - PAD_X * 2) / 2;
  const won = (s: ImageSide, o: ImageSide) => final && s.banked > o.banked;
  const sideBlock = (s: ImageSide, o: ImageSide, right: boolean, colour: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', width: half, flexShrink: 0 }}>
      <ManagerName
        name={s.displayName} team={s.teamName} colour={colour} align={right ? 'right' : 'left'}
        width={half} badge={won(s, o) ? 'WIN' : undefined}
      />
      <div style={{ fontSize: T.display, fontWeight: 700, color: final && !won(s, o) ? C.muted : C.text, marginTop: 6 }}>{pts(s.banked)}</div>
      <div style={{ fontSize: T.body, color: C.muted, whiteSpace: 'nowrap' }}>
        {final ? 'final' : `proj ${pts(s.projected)} · ${s.playersRemaining} to play`}
      </div>
    </div>
  );
  const status = STATUS[m.status];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: headerHeight(final), flexShrink: 0, padding: `4px ${PAD_X}px 0`, borderBottom: `1px solid ${C.divider}` }}>
      <HeaderStrip league={m.league.name} status={`WEEK ${m.week} · ${status.text}`} tone={status.tone} />
      <div style={{ display: 'flex', marginTop: 8 }}>
        {sideBlock(m.me, m.opponent, false, C.sideA)}
        {sideBlock(m.opponent, m.me, true, C.sideB)}
      </div>
      {/* No meter once it is over: a decided bar restates the score above it. */}
      {final ? null : (
        <div style={{ display: 'flex', marginTop: 14 }}>
          <WinBar p={m.winProbability} width={W - PAD_X * 2} />
        </div>
      )}
    </div>
  );
}

function Legend({ sort }: { sort: 'slot' | 'edge' }) {
  return (
    <Footer
      left={
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <LegendDot colour={C.live} label="Playing" />
          <LegendDot colour={C.upcoming} label="Yet to play" />
          <LegendDot colour={C.final} label="Final" />
        </div>
      }
      note={sort === 'edge' ? 'sorted by projected edge' : 'centre: projected slot edge'}
    />
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

  const height = matchupImageHeight(rows.length, m.status === 'final');
  // A real element, not a fragment: satori renders only the first child of a fragment root.
  return renderCard(
    <div style={{ display: 'flex', flexDirection: 'column', width: W }}>
      <Header m={m} />
      {rows.map((r, i) => (
        <div key={r.index} style={{ display: 'flex', alignItems: 'center', height: ROW_H, flexShrink: 0, backgroundColor: i % 2 ? C.rowAlt : C.row, borderBottom: `1px solid ${C.divider}` }}>
          <PlayerCell s={r.mine} side="left" />
          <SlotPill slot={r.slot} edge={r.edge} />
          <PlayerCell s={r.theirs} side="right" />
        </div>
      ))}
      <Legend sort={sort} />
    </div>,
    height,
  );
}

function headerHeight(final: boolean): number {
  return final ? HEADER_H - BAR_BAND_H : HEADER_H;
}

export function matchupImageHeight(rows: number, final: boolean): number {
  return headerHeight(final) + rows * ROW_H + FOOTER_H;
}
