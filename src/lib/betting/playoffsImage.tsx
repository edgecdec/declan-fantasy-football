import type { ImageResponse } from 'next/og';
import { pctText, recordText, roundNames, type PlayoffTeam, type PlayoffsResponse } from '@/lib/betting/playoffOdds';
import {
  C, CARD_W, FOOTER_H, Footer, HEADER_STRIP_H, HeaderStrip, INNER_W, PAD_X, T, clip, renderCard,
} from '@/lib/betting/imageKit';

/**
 * /playoffs as a picture: each team's chance of reaching every playoff round, best chance first,
 * in the card system /luck, /schedules and /markets share.
 *
 * One row per team: name (with a mark only when it is PROVEN — see playoffOdds.playoffStatus),
 * record, projected final wins, then playoffs / bye / semis / final / title as tinted cells. A rule
 * under the last playoff-sized row shows where the cut falls if things go as expected.
 *
 * Fixed at the card's width. Columns that the format does not have are dropped (no bye column for a
 * four- or eight-team field), never squeezed in, so nothing scrolls sideways.
 */

const W = CARD_W;
const TITLE_H = 54;
const COLS_H = 34;
const ROW_H = 54;
const CUT_H = 18;
const NAME_W = 200;
const REC_W = 58;
const PROJ_W = 58;

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`;
};

/** Below half a percent the card prints "<1": that is where a chance stops being worth colouring. */
const NEGLIGIBLE = 0.005;

/** Green deepening with the chance; nothing for a negligible one, so a long shot reads as empty, not red. */
function cellTint(p: number): string {
  if (p < NEGLIGIBLE) return 'transparent';
  return rgba(C.good, 0.08 + 0.55 * Math.min(1, p));
}

type Column = { key: 'playoff' | 'bye' | 'semis' | 'final' | 'title'; label: string };

export function playoffColumns(data: Pick<PlayoffsResponse, 'playoffTeams'>): Column[] {
  const names = roundNames(data.playoffTeams);
  const cols: Column[] = [{ key: 'playoff', label: 'PLAYOFFS' }];
  if (names.bye) cols.push({ key: 'bye', label: names.bye });
  if (names.semis) cols.push({ key: 'semis', label: names.semis });
  cols.push({ key: 'final', label: names.final }, { key: 'title', label: 'TITLE' });
  return cols;
}

/** The value in a column, and whether the bounds prove it outright. */
export function columnValue(t: PlayoffTeam, key: Column['key']): { p: number; proven: 'yes' | 'no' | null } {
  const out = t.status === 'out' ? 'no' : null;
  switch (key) {
    case 'playoff': return { p: t.playoffProb, proven: out ?? (t.status === 'in' || t.status === 'bye' ? 'yes' : null) };
    case 'bye': return { p: t.byeProb, proven: out ?? (t.status === 'bye' ? 'yes' : null) };
    case 'semis': return { p: t.semisProb, proven: out };
    case 'final': return { p: t.finalProb, proven: out };
    case 'title': return { p: t.titleProb, proven: out };
  }
}

const STATUS_PILL: Record<NonNullable<PlayoffTeam['status']>, { text: string; bg: string }> = {
  in: { text: 'IN', bg: C.good },
  bye: { text: 'BYE', bg: C.good },
  out: { text: 'OUT', bg: C.bad },
};

function Row({ t, index, cols, cw }: { t: PlayoffTeam; index: number; cols: Column[]; cw: number }) {
  const pill = t.status ? STATUS_PILL[t.status] : null;
  const out = t.status === 'out';
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: ROW_H, flexShrink: 0, padding: `0 ${PAD_X}px`, backgroundColor: index % 2 ? C.rowAlt : C.row, borderBottom: `1px solid ${C.divider}` }}>
      <div style={{ display: 'flex', alignItems: 'center', width: NAME_W, flexShrink: 0 }}>
        <div style={{ width: 24, fontSize: T.micro, fontWeight: 700, color: C.dim }}>{String(index + 1)}</div>
        <div style={{ fontSize: T.body + 1, fontWeight: 700, color: out ? C.muted : C.text, whiteSpace: 'nowrap' }}>{clip(t.name, pill ? 13 : 16)}</div>
        {pill ? (
          <div style={{ display: 'flex', alignItems: 'center', height: 20, padding: '0 6px', marginLeft: 8, borderRadius: 5, backgroundColor: pill.bg, color: C.bg, fontSize: 12, fontWeight: 700 }}>
            {pill.text}
          </div>
        ) : null}
      </div>
      <div style={{ display: 'flex', width: REC_W, flexShrink: 0, justifyContent: 'center', fontSize: T.body, fontWeight: 700, color: C.text }}>{recordText(t)}</div>
      <div style={{ display: 'flex', width: PROJ_W, flexShrink: 0, justifyContent: 'center', fontSize: T.body, color: C.muted }}>{t.projectedWins.toFixed(1)}</div>
      {cols.map(c => {
        const { p, proven } = columnValue(t, c.key);
        return (
          <div key={c.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: cw - 6, height: ROW_H - 14, margin: '0 3px', flexShrink: 0, borderRadius: 6, backgroundColor: proven === 'no' ? 'transparent' : cellTint(proven === 'yes' ? 1 : p), fontSize: T.body + 1, fontWeight: 700, color: proven === 'no' || (proven !== 'yes' && p < NEGLIGIBLE) ? C.dim : C.text }}>
            {pctText(p, proven)}
          </div>
        );
      })}
    </div>
  );
}

export function playoffsImageHeight(data: Pick<PlayoffsResponse, 'teams' | 'playoffTeams'>): number {
  const cut = data.playoffTeams > 0 && data.playoffTeams < data.teams.length ? CUT_H : 0;
  return 4 + HEADER_STRIP_H + TITLE_H + COLS_H + data.teams.length * ROW_H + cut + FOOTER_H;
}

export function renderPlayoffsImage(data: PlayoffsResponse): ImageResponse {
  const cols = playoffColumns(data);
  const cw = Math.floor((INNER_W - NAME_W - REC_W - PROJ_W) / cols.length);
  const weeks = data.weeksRemaining;
  const format = `top ${data.playoffTeams} make it${data.byes ? `, top ${data.byes} bye` : ''}`;
  const notes = [
    data.medianGame ? 'median game modelled' : null,
    data.divisions ? 'division winners seeded first · no clinch marks' : 'marks only when proven',
  ].filter(Boolean).join(' · ');

  // A real element, not a fragment: satori renders only the first child of a fragment root.
  return renderCard(
    <div style={{ display: 'flex', flexDirection: 'column', width: W }}>
      <div style={{ display: 'flex', flexDirection: 'column', padding: `4px ${PAD_X}px 0` }}>
        <HeaderStrip
          league={data.league.name}
          status={`WEEK ${data.currentWeek} · ${weeks} WEEK${weeks === 1 ? '' : 'S'} LEFT`}
          tone="neutral"
        />
        <div style={{ display: 'flex', alignItems: 'center', height: TITLE_H }}>
          <div style={{ fontSize: T.title, fontWeight: 700, color: C.text }}>Playoff odds</div>
          <div style={{ fontSize: T.small, color: C.muted, marginLeft: 12 }}>{`${format} · playoffs start week ${data.playoffWeekStart}`}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', height: COLS_H, padding: `0 ${PAD_X}px`, fontSize: T.micro, fontWeight: 700, color: C.dim, borderTop: `1px solid ${C.divider}` }}>
        <div style={{ display: 'flex', width: NAME_W, flexShrink: 0, paddingLeft: 24 }}>TEAM</div>
        <div style={{ display: 'flex', width: REC_W, flexShrink: 0, justifyContent: 'center' }}>REC</div>
        <div style={{ display: 'flex', width: PROJ_W, flexShrink: 0, justifyContent: 'center' }}>PROJ</div>
        {cols.map(c => (
          <div key={c.key} style={{ display: 'flex', width: cw, flexShrink: 0, justifyContent: 'center' }}>{c.label}</div>
        ))}
      </div>
      {data.teams.map((t, i) => (
        <div key={t.rosterId} style={{ display: 'flex', flexDirection: 'column' }}>
          <Row t={t} index={i} cols={cols} cw={cw} />
          {/* Where the field is cut, if everything goes the way the odds lean. */}
          {i === data.playoffTeams - 1 && data.playoffTeams < data.teams.length ? (
            <div style={{ display: 'flex', alignItems: 'center', height: CUT_H, padding: `0 ${PAD_X}px`, fontSize: 12, fontWeight: 700, color: C.dim }}>
              <div style={{ display: 'flex', flexGrow: 1, height: 1, borderTop: `1px dashed ${C.muted}` }} />
              <div style={{ margin: '0 10px' }}>PLAYOFF LINE</div>
              <div style={{ display: 'flex', flexGrow: 1, height: 1, borderTop: `1px dashed ${C.muted}` }} />
            </div>
          ) : null}
        </div>
      ))}
      <Footer left={<div>{`${data.sims.toLocaleString('en-US')} sims · ${weeks} week${weeks === 1 ? '' : 's'} left incl. this one`}</div>} note={notes} />
    </div>,
    playoffsImageHeight(data),
  );
}
