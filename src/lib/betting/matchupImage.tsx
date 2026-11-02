import type { ImageResponse } from 'next/og';
import {
  Avatar, C, CARD_W, FOOTER_H, Footer, HeaderStrip, LegendDot, PAD_X, T, WinBar,
  clip, pts, renderCard, type StatusTone,
} from '@/lib/betting/imageKit';
import { avatarUrl, headshotUrl, teamLogoUrl } from '@/lib/betting/imageAssets';

/**
 * The matchup as a picture, laid out like Sleeper's mobile matchup screen.
 *
 * An image rather than Discord text because the layout IS the point and text cannot hold it: a
 * two-sided row needs colour on each side independently, and Discord's only colour tools are an
 * ANSI block (not rendered on mobile at all) and a diff block (one colour per whole line). So the
 * breakdown is drawn — players left and right, points against the centre, a position pill between
 * them — and Discord shows it the same on every client.
 *
 * What each part says, top to bottom:
 *  - the duel: each manager's avatar, name and team, the score at hero size, the projected final,
 *    and the win bar with each side's chance at its end (gone once final: it would only restate
 *    the score);
 *  - a row per slot: headshot (team logo for a defence), the player's game — a live clock badge
 *    with a dot for the team with the ball, the kickoff, or the result — and points. A DECIDED slot
 *    (both games over) shows its winner bright and the loser dimmed; an undecided one colours
 *    points by game state instead, because there is no winner yet. The chip under the position
 *    pill is the projected slot edge in the colour of the side that has it;
 *  - each side's best bench player, one row;
 *  - the biggest swing — the slot doing the most to decide it.
 *
 * Pictures are fetched by the route (imageAssets.ts) and passed in as data URIs; any that are
 * missing draw initials, so the card renders the same with no network at all. Palette, type scale,
 * header and footer come from imageKit, shared with /markets, /luck and /schedules.
 */

const W = CARD_W;
const ROW_H = 72;
const BENCH_H = 64;
const SWING_H = 50;
const HEADER_H = 274;
/** The win bar's band, dropped once the matchup is final. */
const BAR_BAND_H = 38;
/** Satori shrinks flex children to nothing unless told otherwise, so every column has a width. */
const PILL_W = 72;
const CELL_W = (W - PILL_W) / 2;
const SCORE_W = 78;
const STRIPE_W = 4;
const PHOTO = 38;
const CELL_PAD = 8;
const NAME_W = CELL_W - SCORE_W - STRIPE_W - PHOTO - CELL_PAD * 2 - 14;
const AVATAR = 48;

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
  BN: { label: 'BN', color: '#55607c' },
};

/** The football's colour, for the "has the ball" dot. */
const BALL = '#c8823c';

export type ImageSlot = {
  slot: string;
  playerId?: string | null;
  name: string | null;
  position: string | null;
  team: string | null;
  points: number;
  projectedPoints: number;
  expectedPoints: number;
  gameState: 'pre' | 'in' | 'post' | 'unknown';
  gameDetail?: string | null;
  /** "vs PHI" / "@ SEA". */
  opponent?: string | null;
  /** Present only while the player's game is on. */
  live?: { clock: string; hasBall: boolean; redZone: boolean; where?: string } | null;
};

export type ImageSide = {
  displayName: string;
  teamName: string | null;
  avatar?: string | null;
  banked: number;
  projected: number;
  playersRemaining: number;
  lineup: ImageSlot[];
  bestBench?: ImageSlot | null;
};

export type ImageMatchup = {
  league: { name: string };
  week: number;
  status: 'not_started' | 'live' | 'between' | 'final';
  winProbability: number;
  me: ImageSide;
  opponent: ImageSide;
};

/** Pictures by key (see matchupAssetUrls), as data URIs. A missing key draws the fallback. */
export type ImageAssets = Record<string, string | null>;

const playerKey = (s: ImageSlot) =>
  s.position === 'DEF' ? `team:${s.team ?? s.playerId}` : `player:${s.playerId}`;

/**
 * Every picture the card can use, keyed, for the route to fetch through imageAssets. The summary
 * card draws only the avatars and each side's top performers, so it asks for only those — six
 * headshots rather than twenty-odd.
 */
export function matchupAssetUrls(m: ImageMatchup, view: 'sum' | 'slot' | 'edge' = 'slot'): Record<string, string | null> {
  const urls: Record<string, string | null> = {
    'avatar:me': avatarUrl(m.me.avatar),
    'avatar:opponent': avatarUrl(m.opponent.avatar),
  };
  const players = view === 'sum'
    ? [...topPerformers(m.me, m.status), ...topPerformers(m.opponent, m.status)]
    : [...m.me.lineup, ...m.opponent.lineup, m.me.bestBench, m.opponent.bestBench];
  for (const s of players) {
    if (!s?.name || !s.playerId) continue;
    urls[playerKey(s)] = s.position === 'DEF' ? teamLogoUrl(s.team ?? s.playerId) : headshotUrl(s.playerId);
  }
  return urls;
}

/**
 * A name that fits: "Rhamondre Stevenson" → "R. Stevenson", never cut mid-word where it can be
 * helped. A defence keeps its nickname instead — "Kansas City Chiefs" → "KC Chiefs" — since
 * "K. City Chiefs" reads as a typo.
 */
export function playerLabel(name: string, max: number, team?: string | null, position?: string | null): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const words = clean.split(' ');
  if (position === 'DEF' && team) return clip(`${team} ${words[words.length - 1]}`, max);
  const short = words.length > 1 ? `${words[0][0]}. ${words.slice(1).join(' ')}` : clean;
  return clip(short, max);
}

type Row = { index: number; slot: string; mine?: ImageSlot; theirs?: ImageSlot; edge: number };

/** Both games over (or nobody in the slot): the slot has a winner, by points. */
function decided(r: Pick<Row, 'mine' | 'theirs'>): boolean {
  const done = (s?: ImageSlot) => !s?.name || s.gameState === 'post' || s.gameState === 'unknown';
  return done(r.mine) && done(r.theirs);
}

function stateColour(s: ImageSlot | undefined): string {
  if (!s?.name) return C.dim;
  if (s.gameState === 'in') return C.live;
  if (s.gameState === 'pre') return C.upcoming;
  return C.final;
}

/** The line under a player's name, and the live badge that leads it while the game is on. */
function GameLine({ s, right }: { s: ImageSlot; right: boolean }) {
  const pos = s.position && s.position !== s.slot && s.slot !== 'BN' ? s.position : null;
  if (s.live) {
    // The badge takes the room the team code would: the opponent is enough while it is on.
    const text = [pos, s.live.where].filter(Boolean).join(' · ');
    return (
      <div style={{ display: 'flex', alignItems: 'center', flexDirection: right ? 'row-reverse' : 'row', marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 20, padding: '0 6px', borderRadius: 5, backgroundColor: 'rgba(59, 227, 126, 0.16)', color: C.live, fontSize: T.micro, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {s.live.clock}
        </div>
        {s.live.hasBall ? (
          <div style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: BALL, margin: '0 6px' }} />
        ) : <div style={{ width: 6 }} />}
        {s.live.redZone ? (
          <div style={{ display: 'flex', alignItems: 'center', height: 20, padding: '0 5px', borderRadius: 5, backgroundColor: C.bad, color: C.bg, fontSize: 12, fontWeight: 700, margin: right ? '0 0 0 6px' : '0 6px 0 0' }}>RZ</div>
        ) : null}
        <div style={{ fontSize: T.micro, color: C.muted, whiteSpace: 'nowrap' }}>{clip(text, 16)}</div>
      </div>
    );
  }
  const text = [pos, s.team, s.gameDetail].filter(Boolean).join(' · ');
  return <div style={{ fontSize: T.micro, color: C.muted, marginTop: 4, whiteSpace: 'nowrap' }}>{clip(text, 27)}</div>;
}

/**
 * One manager's half of a row, mirrored for the right side so points sit against the centre.
 * `outcome` is set only when the slot is decided: the winner's points bright, the loser's dimmed.
 */
function PlayerCell({ s, side, outcome, assets, dim = false }: {
  s: ImageSlot | undefined; side: 'left' | 'right'; outcome: 'won' | 'lost' | null; assets: ImageAssets; dim?: boolean;
}) {
  const right = side === 'right';
  const empty = !s?.name;
  const pre = !empty && s!.gameState === 'pre';
  const colour = outcome === 'lost' ? C.muted : outcome === 'won' ? C.text : stateColour(s);

  const stripe = (
    // The outer-edge stripe: live and yet-to-play players are findable at a glance down a column.
    <div style={{ width: STRIPE_W, height: 44, borderRadius: 2, flexShrink: 0, backgroundColor: s?.gameState === 'in' || s?.gameState === 'pre' ? stateColour(s) : 'transparent' }} />
  );
  const photo = (
    <div style={{ display: 'flex', margin: right ? '0 6px 0 8px' : '0 8px 0 6px', opacity: dim ? 0.7 : 1 }}>
      {empty
        ? <div style={{ width: PHOTO, height: PHOTO, borderRadius: PHOTO / 2, border: `1px dashed ${C.divider}` }} />
        : <Avatar src={assets[playerKey(s!)]} label={s!.name!} size={PHOTO} />}
    </div>
  );
  const names = (
    <div style={{ display: 'flex', flexDirection: 'column', width: NAME_W, flexShrink: 0, alignItems: right ? 'flex-end' : 'flex-start' }}>
      <div style={{ fontSize: T.player, fontWeight: 700, color: empty ? C.dim : dim ? C.muted : C.text, whiteSpace: 'nowrap' }}>
        {empty ? 'empty slot' : playerLabel(s!.name!, 17, s!.team, s!.position)}
      </div>
      {empty ? null : <GameLine s={s!} right={right} />}
    </div>
  );
  const score = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-start' : 'flex-end', width: SCORE_W, flexShrink: 0 }}>
      {/* Before kickoff the projection is the number worth reading — a column of 0.0s says nothing —
          so it takes the big slot in the yet-to-play blue, labelled. */}
      <div style={{ fontSize: outcome === 'lost' || dim || pre ? T.score - 4 : T.score, fontWeight: 700, color: dim ? C.muted : colour, whiteSpace: 'nowrap' }}>
        {empty ? '0.0' : pts(pre ? s!.projectedPoints : s!.points)}
      </div>
      <div style={{ fontSize: T.micro, color: C.muted, marginTop: 1, whiteSpace: 'nowrap' }}>
        {empty || s!.gameState === 'post' ? '' : pre ? 'proj' : `proj ${pts(s!.projectedPoints)}`}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', width: CELL_W, flexShrink: 0, alignItems: 'center', padding: `0 ${CELL_PAD}px` }}>
      {right ? <>{score}{names}{photo}{stripe}</> : <>{stripe}{photo}{names}{score}</>}
    </div>
  );
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** The position pill, and under it the slot edge as a chip in the colour of the side that has it. */
function SlotPill({ slot, edge, swing, sub }: { slot: string; edge: number | null; swing: boolean; sub?: string }) {
  const s = SLOT[slot] ?? { label: slot.slice(0, 4), color: '#a3b0c8' };
  const lead = edge === null ? null : edge >= 0.05 ? C.sideA : edge <= -0.05 ? C.sideB : null;
  const label = edge === null
    ? sub ?? ''
    : Math.abs(edge) < 0.05 ? 'even' : `${edge > 0 ? '◀ ' : ''}${Math.abs(edge).toFixed(1)}${edge < 0 ? ' ▶' : ''}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: PILL_W, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 54, height: 26, borderRadius: 13, backgroundColor: s.color, color: C.bg, fontSize: T.micro, fontWeight: 700 }}>
        {s.label}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', height: 20, marginTop: 4, padding: '0 6px', borderRadius: 5, whiteSpace: 'nowrap',
        fontSize: T.micro, fontWeight: 700,
        // The biggest swing is filled solid, so the row that matters most is findable at a glance.
        backgroundColor: lead ? (swing ? lead : rgba(lead, 0.2)) : 'transparent',
        color: lead ? (swing ? C.bg : lead) : C.dim,
      }}>
        {label}
      </div>
    </div>
  );
}

/** "proj 145.0 · 1 to play (+8.2)" — the projected final, who is left, and what they are expected to add. */
export function liveSubLine(s: Pick<ImageSide, 'projected' | 'banked' | 'playersRemaining'>): string {
  if (s.playersRemaining === 0) return `proj ${pts(s.projected)} · all played`;
  const toCome = Math.max(0, s.projected - s.banked);
  return `proj ${pts(s.projected)} · ${s.playersRemaining} to play (+${pts(toCome)})`;
}

const STATUS: Record<ImageMatchup['status'], { text: string; tone: StatusTone }> = {
  live: { text: 'LIVE', tone: 'live' },
  between: { text: 'BETWEEN GAMES', tone: 'upcoming' },
  not_started: { text: 'NOT STARTED', tone: 'upcoming' },
  final: { text: 'FINAL', tone: 'final' },
};

function Header({ m, assets }: { m: ImageMatchup; assets: ImageAssets }) {
  const final = m.status === 'final';
  const notStarted = m.status === 'not_started';
  const half = (W - PAD_X * 2) / 2;
  const won = (s: ImageSide, o: ImageSide) => final && s.banked > o.banked;
  const sideBlock = (s: ImageSide, o: ImageSide, right: boolean, colour: string, key: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', width: half, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexDirection: right ? 'row-reverse' : 'row' }}>
        <Avatar src={assets[key]} label={s.displayName} size={AVATAR} ring={colour} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', margin: right ? '0 12px 0 0' : '0 0 0 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', flexDirection: right ? 'row-reverse' : 'row' }}>
            <div style={{ fontSize: T.name, fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>{clip(s.displayName, 16)}</div>
            {won(s, o) ? (
              <div style={{ display: 'flex', alignItems: 'center', height: 20, padding: '0 7px', borderRadius: 5, backgroundColor: C.good, color: C.bg, fontSize: 12, fontWeight: 700, margin: right ? '0 8px 0 0' : '0 0 0 8px' }}>WIN</div>
            ) : null}
          </div>
          <div style={{ fontSize: T.micro, color: C.muted, marginTop: 2, whiteSpace: 'nowrap' }}>{s.teamName ? clip(s.teamName, 24) : ' '}</div>
        </div>
      </div>
      {/* Before kickoff the duel is projection against projection; 0.0 – 0.0 would say nothing. */}
      <div style={{ fontSize: T.hero, fontWeight: 700, color: final && !won(s, o) ? C.muted : notStarted ? C.upcoming : C.text, marginTop: 10, lineHeight: 1 }}>
        {pts(notStarted ? s.projected : s.banked)}
      </div>
      <div style={{ fontSize: T.body, color: C.muted, marginTop: 6, whiteSpace: 'nowrap' }}>
        {final ? 'final' : notStarted ? `projected · ${s.playersRemaining} to play` : liveSubLine(s)}
      </div>
    </div>
  );
  const status = STATUS[m.status];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: headerHeight(final), flexShrink: 0, padding: `4px ${PAD_X}px 0`, borderBottom: `1px solid ${C.divider}` }}>
      <HeaderStrip league={m.league.name} status={`WEEK ${m.week} · ${status.text}`} tone={status.tone} />
      <div style={{ display: 'flex', marginTop: 10 }}>
        {sideBlock(m.me, m.opponent, false, C.sideA, 'avatar:me')}
        {sideBlock(m.opponent, m.me, true, C.sideB, 'avatar:opponent')}
      </div>
      {/* No meter once it is over: a decided bar restates the score above it. */}
      {final ? null : (
        <div style={{ display: 'flex', marginTop: 16 }}>
          <WinBar p={m.winProbability} width={W - PAD_X * 2} />
        </div>
      )}
    </div>
  );
}

/**
 * The slot doing the most to decide the matchup: the largest edge. Before kickoff that is a
 * projection, so it is called the biggest edge rather than a swing that has not happened.
 */
export function biggestSwing(rows: Row[], status: ImageMatchup['status']): { row: Row; label: string } | null {
  const best = rows.reduce<Row | null>((b, r) => (!b || Math.abs(r.edge) > Math.abs(b.edge) ? r : b), null);
  if (!best || Math.abs(best.edge) < 0.05) return null;
  return { row: best, label: status === 'not_started' ? 'Biggest projected edge' : 'Biggest swing' };
}

function SwingBand({ swing, m }: { swing: { row: Row; label: string }; m: ImageMatchup }) {
  const { row, label } = swing;
  const forMe = row.edge > 0;
  const who = forMe ? m.me.displayName : m.opponent.displayName;
  const colour = forMe ? C.sideA : C.sideB;
  const name = (s?: ImageSlot) => (s?.name ? playerLabel(s.name, 18, s.team, s.position) : 'empty');
  const val = (s?: ImageSlot) => pts(s?.name ? (decided(row) ? s.points : s.expectedPoints) : 0);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: SWING_H, flexShrink: 0, padding: `0 ${PAD_X}px`, borderBottom: `1px solid ${C.divider}`, fontSize: T.small, color: C.muted, whiteSpace: 'nowrap' }}>
      <div style={{ fontWeight: 700, color: C.text }}>{`${label} · ${SLOT[row.slot]?.label ?? row.slot}`}</div>
      <div style={{ margin: '0 10px' }}>{`${name(row.mine)} ${val(row.mine)} v ${val(row.theirs)} ${name(row.theirs)}`}</div>
      <div style={{ fontWeight: 700, color: colour }}>{`+${Math.abs(row.edge).toFixed(1)} ${clip(who, 14)}`}</div>
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
          <LegendDot colour={BALL} label="Has the ball" />
        </div>
      }
      note={sort === 'edge' ? 'sorted by projected edge' : 'chip: projected slot edge'}
    />
  );
}

function buildRows(m: ImageMatchup, sort: 'slot' | 'edge'): Row[] {
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
  return rows;
}

function outcomes(r: Row): ['won' | 'lost' | null, 'won' | 'lost' | null] {
  if (!decided(r)) return [null, null];
  const a = r.mine?.name ? r.mine.points : 0;
  const b = r.theirs?.name ? r.theirs.points : 0;
  if (Math.abs(a - b) < 0.05) return [null, null];
  return a > b ? ['won', 'lost'] : ['lost', 'won'];
}

export function renderMatchupImage(m: ImageMatchup, sort: 'slot' | 'edge', assets: ImageAssets = {}): ImageResponse {
  const rows = buildRows(m, sort);
  const swing = biggestSwing(rows, m.status);
  const bench = m.me.bestBench || m.opponent.bestBench;

  // A real element, not a fragment: satori renders only the first child of a fragment root.
  return renderCard(
    <div style={{ display: 'flex', flexDirection: 'column', width: W }}>
      <Header m={m} assets={assets} />
      {rows.map((r, i) => {
        const [mine, theirs] = outcomes(r);
        return (
          <div key={r.index} style={{ display: 'flex', alignItems: 'center', height: ROW_H, flexShrink: 0, backgroundColor: i % 2 ? C.rowAlt : C.row, borderBottom: `1px solid ${C.divider}` }}>
            <PlayerCell s={r.mine} side="left" outcome={mine} assets={assets} />
            <SlotPill slot={r.slot} edge={r.edge} swing={swing?.row === r} />
            <PlayerCell s={r.theirs} side="right" outcome={theirs} assets={assets} />
          </div>
        );
      })}
      {bench ? (
        <div style={{ display: 'flex', alignItems: 'center', height: BENCH_H, flexShrink: 0, backgroundColor: C.bg, borderBottom: `1px solid ${C.divider}` }}>
          <PlayerCell s={m.me.bestBench ?? undefined} side="left" outcome={null} assets={assets} dim />
          <SlotPill slot="BN" edge={null} swing={false} sub="best bench" />
          <PlayerCell s={m.opponent.bestBench ?? undefined} side="right" outcome={null} assets={assets} dim />
        </div>
      ) : null}
      {swing ? <SwingBand swing={swing} m={m} /> : null}
      <Legend sort={sort} />
    </div>,
    matchupImageHeight(m, sort),
  );
}

/**
 * The card as PNG bytes, rendered now rather than streamed. Satori decodes the pictures while the
 * response streams, so a picture it cannot decode would otherwise fail mid-stream and leave Discord
 * a broken file. If drawing with pictures fails for any reason, the card is drawn again with
 * initials — the pictures are decoration, the card is not.
 */
export async function renderMatchupPng(
  m: ImageMatchup,
  view: 'sum' | 'slot' | 'edge',
  assets: ImageAssets,
): Promise<ArrayBuffer> {
  const draw = (a: ImageAssets) =>
    (view === 'sum' ? renderMatchupSummaryImage(m, a) : renderMatchupImage(m, view, a)).arrayBuffer();
  try {
    return await draw(assets);
  } catch (err) {
    console.error('[matchup image] render with pictures failed, retrying without:', err);
    return draw({});
  }
}

function headerHeight(final: boolean): number {
  return final ? HEADER_H - BAR_BAND_H : HEADER_H;
}

/** The card's height for this matchup: header, a row per slot, the bench and swing bands if any. */
export function matchupImageHeight(m: ImageMatchup, sort: 'slot' | 'edge' = 'slot'): number {
  const rows = buildRows(m, sort);
  return headerHeight(m.status === 'final')
    + rows.length * ROW_H
    + (m.me.bestBench || m.opponent.bestBench ? BENCH_H : 0)
    + (biggestSwing(rows, m.status) ? SWING_H : 0)
    + FOOTER_H;
}

/* ------------------------------------------------------------------------------------------------
 * The summary card — /matchup's default view.
 *
 * The same header as the detailed card (avatars, the score duel or projected finals, the win bar,
 * the state pill), then only what a glance needs: one line saying where it stands, each side's top
 * performers, the biggest swing and the best bench. About half the detailed card's height, so it
 * sits in a channel without taking the screen; "By slot" / "By edge" open the full breakdown.
 * ---------------------------------------------------------------------------------------------- */

const STATUS_LINE_H = 50;
const TOP_N = 3;
const TOP_ROW_H = 52;
const BENCH_LINE_H = 42;
const TOP_PHOTO = 34;

/**
 * Where it stands, in one line, and in whose colour.
 *
 *  - not started: who is projected to win, and by how much;
 *  - live / between: who leads on points banked, and how many players are still to play;
 *  - final: who won, by how much.
 */
export function summaryStatus(m: ImageMatchup): { text: string; side: 'me' | 'opponent' | null } {
  const me = m.me.displayName;
  const them = m.opponent.displayName;
  if (m.status === 'not_started') {
    const d = m.me.projected - m.opponent.projected;
    if (Math.abs(d) < 0.05) return { text: 'Projected dead even', side: null };
    return { text: `${d > 0 ? me : them} projected to win by ${pts(Math.abs(d))}`, side: d > 0 ? 'me' : 'opponent' };
  }
  const d = m.me.banked - m.opponent.banked;
  if (m.status === 'final') {
    if (Math.abs(d) < 0.005) return { text: `Tied at ${pts(m.me.banked)}`, side: null };
    return { text: `${d > 0 ? me : them} won by ${pts(Math.abs(d))}`, side: d > 0 ? 'me' : 'opponent' };
  }
  const left = m.me.playersRemaining + m.opponent.playersRemaining;
  const tail = left === 0 ? 'with everyone played' : `with ${left} to play`;
  if (Math.abs(d) < 0.05) return { text: `Tied at ${pts(m.me.banked)} ${tail}`, side: null };
  return { text: `${d > 0 ? me : them} leads by ${pts(Math.abs(d))} ${tail}`, side: d > 0 ? 'me' : 'opponent' };
}

/**
 * A side's best few: by points once anyone has played, by projection before kickoff — the number
 * the card shows for each, so the order and the figures agree.
 */
export function topPerformers(side: ImageSide, status: ImageMatchup['status'], n = TOP_N): ImageSlot[] {
  const value = (s: ImageSlot) => (status === 'not_started' ? s.projectedPoints : s.points);
  return side.lineup
    .filter(s => s.name)
    .sort((a, b) => value(b) - value(a))
    .slice(0, n);
}

function TopPerformer({ s, right, status, assets }: { s: ImageSlot; right: boolean; status: ImageMatchup['status']; assets: ImageAssets }) {
  const pre = status === 'not_started' || s.gameState === 'pre';
  const value = status === 'not_started' ? s.projectedPoints : s.points;
  const half = (W - PAD_X * 2) / 2 - 12;
  const sub = s.live
    ? `${s.live.clock}${s.live.where ? ` ${s.live.where}` : ''}`
    : [s.slot !== s.position ? `${s.slot} · ${s.position}` : s.position, s.team].filter(Boolean).join(' · ');
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: TOP_ROW_H, width: half, flexShrink: 0, flexDirection: right ? 'row-reverse' : 'row' }}>
      <Avatar src={assets[playerKey(s)]} label={s.name!} size={TOP_PHOTO} />
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, alignItems: right ? 'flex-end' : 'flex-start', margin: '0 10px' }}>
        <div style={{ fontSize: T.small, fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>{playerLabel(s.name!, 18, s.team, s.position)}</div>
        <div style={{ fontSize: T.micro, color: s.live ? C.live : C.muted, whiteSpace: 'nowrap' }}>{clip(sub, 22)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-start' : 'flex-end' }}>
        <div style={{ fontSize: T.name, fontWeight: 700, color: pre ? C.upcoming : s.live ? C.live : C.text, whiteSpace: 'nowrap' }}>{pts(value)}</div>
        {pre ? <div style={{ fontSize: 12, color: C.muted }}>proj</div> : null}
      </div>
    </div>
  );
}

function BenchLine({ m }: { m: ImageMatchup }) {
  const one = (s: ImageSlot | null | undefined, right: boolean) => {
    if (!s?.name) return <div style={{ display: 'flex', width: (W - PAD_X * 2) / 2 - 40, justifyContent: right ? 'flex-end' : 'flex-start', color: C.dim }}>—</div>;
    const pre = s.gameState === 'pre';
    const text = `${playerLabel(s.name, 18, s.team, s.position)} ${pts(pre ? s.projectedPoints : s.points)}${pre ? ' proj' : ''}`;
    return <div style={{ display: 'flex', width: (W - PAD_X * 2) / 2 - 40, justifyContent: right ? 'flex-end' : 'flex-start', whiteSpace: 'nowrap' }}>{text}</div>;
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: BENCH_LINE_H, flexShrink: 0, padding: `0 ${PAD_X}px`, fontSize: T.small, color: C.muted, borderBottom: `1px solid ${C.divider}` }}>
      {one(m.me.bestBench, false)}
      <div style={{ display: 'flex', justifyContent: 'center', width: 80, fontSize: T.micro, fontWeight: 700, color: C.dim }}>BEST BN</div>
      {one(m.opponent.bestBench, true)}
    </div>
  );
}

export function renderMatchupSummaryImage(m: ImageMatchup, assets: ImageAssets = {}): ImageResponse {
  const rows = buildRows(m, 'slot');
  const swing = biggestSwing(rows, m.status);
  const status = summaryStatus(m);
  const mine = topPerformers(m.me, m.status);
  const theirs = topPerformers(m.opponent, m.status);
  const n = Math.max(mine.length, theirs.length);
  const colour = status.side === 'me' ? C.sideA : status.side === 'opponent' ? C.sideB : C.text;

  // A real element, not a fragment: satori renders only the first child of a fragment root.
  return renderCard(
    <div style={{ display: 'flex', flexDirection: 'column', width: W }}>
      <Header m={m} assets={assets} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: STATUS_LINE_H, flexShrink: 0, borderBottom: `1px solid ${C.divider}`, fontSize: T.body + 1, fontWeight: 700, color: colour, whiteSpace: 'nowrap' }}>
        {status.text}
      </div>
      {n > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', padding: `6px ${PAD_X}px`, borderBottom: `1px solid ${C.divider}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: C.dim }}>
            <div>{m.status === 'not_started' ? 'TOP PROJECTED' : 'TOP PERFORMERS'}</div>
            <div>{m.status === 'not_started' ? 'TOP PROJECTED' : 'TOP PERFORMERS'}</div>
          </div>
          {/* Two lists, not pairs: a rule down the middle so 21.7 and 30.4 do not read as a duel. */}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            {[mine, theirs].map((list, side) => (
              <div key={side} style={{ display: 'flex', flexDirection: 'column', ...(side === 0 ? { borderRight: `1px solid ${C.divider}`, paddingRight: 11 } : { paddingLeft: 11 }) }}>
                {list.map(p => <TopPerformer key={p.playerId ?? p.name} s={p} right={side === 1} status={m.status} assets={assets} />)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {swing ? <SwingBand swing={swing} m={m} /> : null}
      {m.me.bestBench || m.opponent.bestBench ? <BenchLine m={m} /> : null}
      <Footer note="By slot / By edge for every player" />
    </div>,
    matchupSummaryHeight(m),
  );
}

/** The summary card's height: header, status line, top performers, and the swing and bench lines if any. */
export function matchupSummaryHeight(m: ImageMatchup): number {
  const n = Math.max(topPerformers(m.me, m.status).length, topPerformers(m.opponent, m.status).length);
  return headerHeight(m.status === 'final')
    + STATUS_LINE_H
    + (n > 0 ? 12 + 16 + n * TOP_ROW_H + 1 : 0)
    + (biggestSwing(buildRows(m, 'slot'), m.status) ? SWING_H : 0)
    + (m.me.bestBench || m.opponent.bestBench ? BENCH_LINE_H : 0)
    + FOOTER_H;
}
