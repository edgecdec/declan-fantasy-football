import type { ImageResponse } from 'next/og';
import { marketPhase, type BotMarket, type BotMarketsResponse, type MarketPhase } from '@/lib/betting/botMarkets';
import {
  C, CARD_W, FOOTER_H, Footer, HEADER_STRIP_H, HeaderStrip, ManagerName, PAD_X, T, WinBar,
  pts, renderCard, type StatusTone,
} from '@/lib/betting/imageKit';

/**
 * /markets as a picture: one card per league week, a row per matchup, closest first.
 *
 * Each row is the /matchup header in miniature — the two managers left and right in their side
 * colours, each one's number under their name, the win bar beneath — so the board and the matchup
 * card read as the same object at two zoom levels.
 *
 * The big number is the PROJECTED FINAL before and during games (banked plus expected remaining,
 * the figure the odds were struck from), with the current score beside it once anyone has scored.
 * Once it is over the big number is the graded score and the winner is marked; the bar and odds go,
 * because a decided bar and a -19900 line only restate the result.
 *
 * Every number comes from the stored `markets` row (see botMarkets.ts); nothing here prices.
 */

const W = CARD_W;
const HALF = (W - PAD_X * 2) / 2;
const TITLE_H = 54;
const ROW_PAD = 14;
const NAME_LINE_H = 30;
const SCORE_LINE_H = 42;
const BAR_LINE_H = 34;
/** Rows are uniform within a phase so a board scans as a grid; a finished row drops the bar band. */
const rowHeight = (phase: MarketPhase) =>
  ROW_PAD * 2 + NAME_LINE_H + SCORE_LINE_H + (phase === 'final' || phase === 'void' ? 0 : BAR_LINE_H);

const americanOdds = (price: number) => (price > 0 ? `+${price}` : String(price));

/** The whole board's state, for the header pill: any game on makes the board live. */
export function boardPhase(markets: BotMarket[]): { text: string; tone: StatusTone } {
  const phases = markets.map(marketPhase);
  if (phases.some(p => p === 'live')) return { text: 'LIVE', tone: 'live' };
  if (phases.length > 0 && phases.every(p => p === 'final' || p === 'void')) return { text: 'FINAL', tone: 'final' };
  return { text: 'NOT STARTED', tone: 'upcoming' };
}

function OddsChip({ price, colour, muted }: { price: number; colour: string; muted: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 24, padding: '0 8px', borderRadius: 6, border: `1px solid ${muted ? C.divider : colour}`, color: muted ? C.dim : C.text, fontSize: T.micro, fontWeight: 700, margin: '0 10px' }}>
      {americanOdds(price)}
    </div>
  );
}

function Side({ m, side, phase }: { m: BotMarket; side: 'a' | 'b'; phase: MarketPhase }) {
  const right = side === 'b';
  const name = (right ? m.nameB : m.nameA) ?? (right ? 'B' : 'A');
  const colour = right ? C.sideB : C.sideA;
  const final = phase === 'final';
  const won = final && m.winner === side;
  const lost = final && (m.winner === (right ? 'a' : 'b'));
  const big = final
    ? (right ? m.finalB ?? m.pointsB : m.finalA ?? m.pointsA)
    : (right ? m.projectedB : m.projectedA);
  const now = right ? m.pointsB : m.pointsA;
  // Odds belong to a side, so they sit beside its name; muted once the market has stopped taking action.
  const chip = final || phase === 'void'
    ? null
    : <OddsChip price={right ? m.priceB : m.priceA} colour={colour} muted={m.status !== 'open'} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: HALF, flexShrink: 0, alignItems: right ? 'flex-end' : 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', height: NAME_LINE_H, flexDirection: right ? 'row-reverse' : 'row' }}>
        <ManagerName name={name} colour={colour} align={right ? 'right' : 'left'} max={16} badge={won ? 'WIN' : undefined} faded={lost} />
        {chip}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', height: SCORE_LINE_H, flexDirection: right ? 'row-reverse' : 'row' }}>
        <div style={{ fontSize: T.score + 4, fontWeight: 700, color: lost ? C.muted : C.text, lineHeight: 1 }}>
          {big == null ? '—' : pts(big)}
        </div>
        {phase === 'live' && now != null ? (
          <div style={{ fontSize: T.small, color: C.muted, margin: right ? '0 12px 3px 0' : '0 0 3px 12px', whiteSpace: 'nowrap' }}>
            {`now ${pts(now)}`}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const CENTRE_LABEL: Record<MarketPhase, string> = {
  pre: 'PROJ',
  live: 'PROJ',
  final: 'FINAL',
  void: 'VOID',
};

/**
 * The line under the centre label. Live and pre-game: why the odds are greyed, if they are. Final:
 * the margin once graded, and "grading" before then — every game is over but settlement has not
 * run, so naming a winner would be ahead of the ledger.
 */
function centreNote(m: BotMarket, phase: MarketPhase): string | null {
  if (phase === 'final') {
    if (m.status !== 'settled') return 'grading';
    if (m.finalA == null || m.finalB == null) return null;
    const margin = Math.abs(m.finalA - m.finalB);
    return margin < 0.05 ? 'tie' : `by ${pts(margin)}`;
  }
  if (phase === 'void') return null;
  return m.status === 'open' ? null : m.status;
}

function Row({ m, index }: { m: BotMarket; index: number }) {
  const phase = marketPhase(m);
  const showBar = phase === 'pre' || phase === 'live';
  const note = centreNote(m, phase);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: rowHeight(phase), flexShrink: 0, padding: `${ROW_PAD}px ${PAD_X}px`, backgroundColor: index % 2 ? C.rowAlt : C.row, borderBottom: `1px solid ${C.divider}` }}>
      <div style={{ display: 'flex', position: 'relative' }}>
        <Side m={m} side="a" phase={phase} />
        <Side m={m} side="b" phase={phase} />
        {/* What the big numbers are, between them — and why the odds are greyed when they are. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'absolute', left: HALF - 60, top: NAME_LINE_H + 8, width: 120 }}>
          <div style={{ fontSize: T.micro, fontWeight: 700, color: phase === 'live' ? C.live : C.dim }}>{CENTRE_LABEL[phase]}</div>
          {note ? <div style={{ fontSize: T.micro, color: C.dim, marginTop: 2 }}>{note}</div> : null}
        </div>
      </div>
      {showBar ? (
        <div style={{ display: 'flex', height: BAR_LINE_H, alignItems: 'flex-end' }}>
          <WinBar p={m.probA} width={W - PAD_X * 2} />
        </div>
      ) : null}
    </div>
  );
}

export function marketsImageHeight(markets: BotMarket[]): number {
  return HEADER_STRIP_H + 4 + TITLE_H
    + markets.reduce((h, m) => h + rowHeight(marketPhase(m)), 0)
    + FOOTER_H;
}

export function renderMarketsImage(data: BotMarketsResponse): ImageResponse {
  const status = boardPhase(data.markets);
  const anyPriced = data.markets.some(m => {
    const p = marketPhase(m);
    return p === 'pre' || p === 'live';
  });
  const n = data.markets.length;
  const allFinal = status.text === 'FINAL';
  // A real element, not a fragment: satori renders only the first child of a fragment root.
  return renderCard(
    <div style={{ display: 'flex', flexDirection: 'column', width: W }}>
      <div style={{ display: 'flex', flexDirection: 'column', padding: `4px ${PAD_X}px 0` }}>
        <HeaderStrip league={data.league.label} status={`WEEK ${data.week} · ${status.text}`} tone={status.tone} />
        <div style={{ display: 'flex', alignItems: 'center', height: TITLE_H }}>
          <div style={{ fontSize: T.title, fontWeight: 700, color: C.text }}>{allFinal ? 'Results' : 'Markets'}</div>
          <div style={{ fontSize: T.small, color: C.muted, marginLeft: 12 }}>
            {`${n} matchup${n === 1 ? '' : 's'}${anyPriced ? ' · closest first' : ''}`}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${C.divider}` }}>
        {data.markets.map((m, i) => <Row key={m.marketId} m={m} index={i} />)}
      </div>
      <Footer
        left={anyPriced ? <div>bar = win chance · odds include the vig</div> : undefined}
        note={anyPriced ? 'PROJ = banked + expected remaining' : 'graded final scores'}
      />
    </div>,
    marketsImageHeight(data.markets),
  );
}
