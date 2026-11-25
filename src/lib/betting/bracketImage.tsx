import type { ImageResponse } from 'next/og';
import { pctText, recordText, type BracketResponse, type BracketTeam } from '@/lib/betting/playoffOdds';
import {
  C, CARD_W, FOOTER_H, Footer, HEADER_STRIP_H, HeaderStrip, INNER_W, PAD_X, T, clip, pts, renderCard,
} from '@/lib/betting/imageKit';

/**
 * /playoffs once the playoffs have started: the teams still alive, each one's chance of reaching
 * every later round and the title, and the results so far — the same card system and column
 * treatment as the regular-season card (playoffsImage.tsx), so the two read as one feature.
 *
 * A team on a bye this round is already through to the next: that column is printed as a proven
 * 100 with a BYE mark rather than a simulated ">99".
 */

const W = CARD_W;
const TITLE_H = 54;
const COLS_H = 34;
const ROW_H = 62;
const RESULTS_HEAD_H = 34;
const RESULT_H = 28;
const NAME_W = 300;
const REC_W = 64;

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`;
};
const NEGLIGIBLE = 0.005;
const cellTint = (p: number) => (p < NEGLIGIBLE ? 'transparent' : rgba(C.good, 0.08 + 0.55 * Math.min(1, p)));

/** The line under a team's name: its matchup this round, and the round's points once it has started. */
export function matchupLine(t: BracketTeam, roundLabel: string): string {
  if (t.opponent === null) return `${roundLabel.toLowerCase()} bye`;
  // A score only once someone has one: before kickoff "0.0–0.0" says nothing.
  const started = t.roundPoints !== null && t.opponentPoints !== null && t.roundPoints + t.opponentPoints > 0;
  const score = started ? ` · ${pts(t.roundPoints!)}–${pts(t.opponentPoints!)}` : '';
  return `${roundLabel.toLowerCase()} vs ${t.opponent}${score}`;
}

/** Column values, with a bye's place in the next round proven rather than simulated. */
export function bracketCells(t: BracketTeam): { text: string; p: number; proven: boolean }[] {
  const values = [...t.reach, t.title];
  return values.map((p, i) => {
    const proven = i === 0 && t.opponent === null && t.reach.length > 0;
    return { text: pctText(p, proven ? 'yes' : null), p: proven ? 1 : p, proven };
  });
}

export function bracketImageHeight(data: Pick<BracketResponse, 'teams' | 'results'>): number {
  const results = data.results.length ? RESULTS_HEAD_H + data.results.length * RESULT_H + 8 : 0;
  return 4 + HEADER_STRIP_H + TITLE_H + COLS_H + data.teams.length * ROW_H + results + FOOTER_H;
}

export function currentRoundLabel(data: Pick<BracketResponse, 'rounds' | 'currentRound'>): string {
  const fromEnd = data.rounds - data.currentRound;
  return fromEnd === 0 ? 'Final' : fromEnd === 1 ? 'Semis' : fromEnd === 2 ? 'Quarters' : `Round ${data.currentRound}`;
}

export function renderBracketImage(data: BracketResponse): ImageResponse {
  const labels = [...data.columns.map(c => c.label), 'TITLE'];
  const cw = Math.floor((INNER_W - NAME_W - REC_W) / labels.length);
  const round = currentRoundLabel(data);

  // A real element, not a fragment: satori renders only the first child of a fragment root.
  return renderCard(
    <div style={{ display: 'flex', flexDirection: 'column', width: W }}>
      <div style={{ display: 'flex', flexDirection: 'column', padding: `4px ${PAD_X}px 0` }}>
        <HeaderStrip league={data.league.name} status={`WEEK ${data.currentWeek} · PLAYOFFS`} tone="live" />
        <div style={{ display: 'flex', alignItems: 'center', height: TITLE_H }}>
          <div style={{ fontSize: T.title, fontWeight: 700, color: C.text }}>{`Playoffs — round ${data.currentRound} of ${data.rounds}`}</div>
          <div style={{ fontSize: T.small, color: C.muted, marginLeft: 12 }}>
            {`${data.roundLength}${data.reseed ? ' · re-seeded each round' : ''}`}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', height: COLS_H, padding: `0 ${PAD_X}px`, fontSize: T.micro, fontWeight: 700, color: C.dim, borderTop: `1px solid ${C.divider}` }}>
        <div style={{ display: 'flex', width: NAME_W, flexShrink: 0, paddingLeft: 30 }}>{`STILL ALIVE · ${round.toUpperCase()}`}</div>
        <div style={{ display: 'flex', width: REC_W, flexShrink: 0, justifyContent: 'center' }}>REC</div>
        {labels.map(l => <div key={l} style={{ display: 'flex', width: cw, flexShrink: 0, justifyContent: 'center' }}>{l}</div>)}
      </div>
      {data.teams.map((t, i) => (
        <div key={t.rosterId} style={{ display: 'flex', alignItems: 'center', height: ROW_H, flexShrink: 0, padding: `0 ${PAD_X}px`, backgroundColor: i % 2 ? C.rowAlt : C.row, borderBottom: `1px solid ${C.divider}` }}>
          <div style={{ display: 'flex', alignItems: 'center', width: NAME_W, flexShrink: 0 }}>
            <div style={{ display: 'flex', width: 30, fontSize: T.micro, fontWeight: 700, color: C.dim }}>{`#${t.seed}`}</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ fontSize: T.body + 1, fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>{clip(t.name, 18)}</div>
                {t.opponent === null ? (
                  <div style={{ display: 'flex', alignItems: 'center', height: 20, padding: '0 6px', marginLeft: 8, borderRadius: 5, backgroundColor: C.good, color: C.bg, fontSize: 12, fontWeight: 700 }}>BYE</div>
                ) : null}
              </div>
              <div style={{ fontSize: T.micro, color: C.muted, marginTop: 2, whiteSpace: 'nowrap' }}>{clip(matchupLine(t, round), 34)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', width: REC_W, flexShrink: 0, justifyContent: 'center', fontSize: T.body, fontWeight: 700, color: C.text }}>{recordText(t)}</div>
          {bracketCells(t).map((c, k) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: cw - 6, height: ROW_H - 16, margin: '0 3px', flexShrink: 0, borderRadius: 6, backgroundColor: cellTint(c.p), fontSize: T.body + 1, fontWeight: 700, color: !c.proven && c.p < NEGLIGIBLE ? C.dim : C.text }}>
              {c.text}
            </div>
          ))}
        </div>
      ))}
      {data.results.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', padding: `0 ${PAD_X}px 8px` }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', height: RESULTS_HEAD_H, paddingBottom: 6, fontSize: T.micro, fontWeight: 700, color: C.dim }}>RESULTS</div>
          {data.results.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', height: RESULT_H, fontSize: T.small, color: C.muted, whiteSpace: 'nowrap' }}>
              <div style={{ display: 'flex', width: 96, fontWeight: 700, color: C.dim }}>{r.label}</div>
              <div style={{ fontWeight: 700, color: C.text }}>{clip(r.winner, 18)}</div>
              <div style={{ margin: '0 6px' }}>beat</div>
              <div>{clip(r.loser, 18)}</div>
              {r.winnerPoints !== null && r.loserPoints !== null
                ? <div style={{ marginLeft: 8, color: C.text }}>{`${pts(r.winnerPoints)}–${pts(r.loserPoints)}`}</div>
                : null}
            </div>
          ))}
        </div>
      ) : null}
      <Footer
        left={<div>{`${data.sims.toLocaleString('en-US')} sims · banked weeks + live week + season model`}</div>}
        note="eliminated teams not shown"
      />
    </div>,
    bracketImageHeight(data),
  );
}
