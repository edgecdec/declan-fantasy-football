import type { ImageResponse } from 'next/og';
import { formatRecord, type ScheduleSwapResponse, type SwapCell } from '@/lib/betting/scheduleSwap';
import {
  C, CARD_W, FOOTER_H, Footer, HEADER_STRIP_H, HeaderStrip, INNER_W, PAD_X, T, clip, renderCard,
} from '@/lib/betting/imageKit';

/**
 * /schedules as a picture: the schedule-swap matrix — every manager's scores on every manager's
 * schedule — in the shared card system.
 *
 * Built to be read on a phone, where Discord shows the card at about half size. So each cell leads
 * with the one number worth reading, the wins gained or lost against the actual record, and colours
 * the whole cell by it; the swapped record sits small beneath. Column heads are short, league-unique
 * labels (scheduleSwap.shortNames) in the same order as the rows, so column n is row n.
 *
 * Green is more wins than the manager really got and red is fewer, matching /luck, where green is
 * better than the scores deserved. Colour saturates at ±4 wins per 13 games, as in the reference, and
 * is never scaled UP for a short season: four weeks in, a one-win swing should not look certain.
 */

const W = CARD_W;
const TITLE_H = 50;
const EXPLAIN_H = 26;
const COLS_H = 40;
const ROW_H = 54;
const KIND_H = 58;
const ROWHEAD_W = 136;

/** The cell grid shares what is left after the row heads, evenly. */
const cellWidth = (n: number) => Math.floor((INNER_W - ROWHEAD_W) / Math.max(1, n));

/** A cell's wins delta, halves kept: `+2`, `−1.5`, `0`. True minus sign. */
export function signedWins(d: number): string {
  if (Math.abs(d) < 0.05) return '0';
  const abs = Math.abs(d);
  const body = Math.abs(abs - Math.round(abs)) < 1e-9 ? String(Math.round(abs)) : abs.toFixed(1);
  return `${d > 0 ? '+' : '−'}${body}`;
}

/** A schedule's kindness, an average, to one decimal: `+1.3`, `−0.4`, `0.0`. */
export function signedAverage(d: number): string {
  if (Math.abs(d) < 0.05) return '0.0';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
}

/**
 * How strongly to colour a delta, −1 … 1. Per 13 games so a long season does not saturate, never
 * scaled up for a short one (the reference's rule).
 */
export function deltaIntensity(delta: number, games: number): number {
  const scaled = (delta * 13) / Math.max(games, 13);
  return Math.max(-1, Math.min(1, scaled / 4));
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`;
};

function tint(intensity: number): string {
  if (Math.abs(intensity) < 0.02) return C.row;
  return rgba(intensity > 0 ? C.good : C.bad, 0.12 + 0.5 * Math.abs(intensity));
}

function Cell({ cell, width, games }: { cell: SwapCell; width: number; games: number }) {
  const diag = cell.delta === null;
  const top = diag ? formatRecord(cell) : signedWins(cell.delta!);
  const sub = diag ? 'actual' : formatRecord(cell);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width, height: ROW_H, flexShrink: 0, backgroundColor: diag ? C.divider : tint(deltaIntensity(cell.delta!, games)), borderRight: `1px solid ${C.bg}` }}>
      <div style={{ fontSize: T.body, fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>{top}</div>
      <div style={{ fontSize: 12, color: diag ? C.muted : 'rgba(242, 245, 250, 0.72)', marginTop: 1, whiteSpace: 'nowrap' }}>{sub}</div>
    </div>
  );
}

export function scheduleImageHeight(managers: number): number {
  return 4 + HEADER_STRIP_H + TITLE_H + EXPLAIN_H + COLS_H + managers * ROW_H + KIND_H + FOOTER_H;
}

export function renderScheduleImage(data: ScheduleSwapResponse): ImageResponse {
  const n = data.managers.length;
  const cw = cellWidth(n);
  const games = data.weeksCounted;
  const weeks = `${games} WEEK${games === 1 ? '' : 'S'}`;

  // A real element, not a fragment: satori renders only the first child of a fragment root.
  return renderCard(
    <div style={{ display: 'flex', flexDirection: 'column', width: W }}>
      <div style={{ display: 'flex', flexDirection: 'column', padding: `4px ${PAD_X}px 0` }}>
        <HeaderStrip league={data.league.name} status={`${data.league.season} · ${weeks}`} tone="neutral" />
        <div style={{ display: 'flex', alignItems: 'center', height: TITLE_H }}>
          <div style={{ fontSize: T.title, fontWeight: 700, color: C.text }}>Schedule swap</div>
          <div style={{ fontSize: T.small, color: C.muted, marginLeft: 12 }}>your scores, their schedule</div>
        </div>
        <div style={{ display: 'flex', height: EXPLAIN_H, fontSize: T.micro, color: C.muted }}>
          row = whose scores · column = whose schedule · number = wins vs actual record
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', padding: `0 ${PAD_X}px` }}>
        {/* Column heads: the short labels, in row order. */}
        <div style={{ display: 'flex', alignItems: 'flex-end', height: COLS_H, paddingBottom: 6 }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: ROWHEAD_W, flexShrink: 0, fontSize: 12, color: C.dim, fontWeight: 700, paddingLeft: 8 }}>
            <div>SCHEDULE →</div>
            <div>SCORES ↓</div>
          </div>
          {data.managers.map(m => (
            <div key={m.rosterId} style={{ display: 'flex', justifyContent: 'center', width: cw, flexShrink: 0, fontSize: T.micro, fontWeight: 700, color: C.muted, whiteSpace: 'nowrap' }}>
              {m.short}
            </div>
          ))}
        </div>

        {data.managers.map((m, r) => (
          <div key={m.rosterId} style={{ display: 'flex', alignItems: 'center', height: ROW_H, borderTop: `1px solid ${C.bg}` }}>
            <div style={{ display: 'flex', alignItems: 'center', width: ROWHEAD_W, flexShrink: 0, height: ROW_H, backgroundColor: r % 2 ? C.rowAlt : C.row, paddingLeft: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.dim, width: 20 }}>{String(r + 1)}</div>
              <div style={{ fontSize: T.small, fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>{clip(m.name, 12)}</div>
            </div>
            {data.cells[r].map((cell, c) => <Cell key={c} cell={cell} width={cw} games={games} />)}
          </div>
        ))}

        {/* How kind each schedule was: the column's mean delta over everyone else. */}
        <div style={{ display: 'flex', alignItems: 'center', height: KIND_H, borderTop: `2px solid ${C.divider}`, marginTop: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: ROWHEAD_W, flexShrink: 0, paddingLeft: 8 }}>
            <div style={{ fontSize: T.small, fontWeight: 700, color: C.text }}>Kindness</div>
            <div style={{ fontSize: 12, color: C.muted }}>avg for others</div>
          </div>
          {data.kindness.map((k, c) => (
            <div key={c} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: cw, height: KIND_H - 10, flexShrink: 0, backgroundColor: tint(deltaIntensity(k, games)), borderRight: `1px solid ${C.bg}`, fontSize: T.body, fontWeight: 700, color: C.text }}>
              {signedAverage(k)}
            </div>
          ))}
        </div>
      </div>

      <Footer
        left={<div>green = more wins than actual · red = fewer · diagonal = actual</div>}
        note="head-to-head only"
      />
    </div>,
    scheduleImageHeight(n),
  );
}
