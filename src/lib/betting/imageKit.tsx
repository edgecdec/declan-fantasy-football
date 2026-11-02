import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { ImageResponse } from 'next/og';
import { MARKET_SIDE_COLORS } from '@/constants/colors';

/**
 * The visual system shared by every picture the Discord bot posts — /matchup, /markets, /luck.
 *
 * One module so the three cannot drift: the same canvas width, palette, type scale, header strip,
 * footer, manager-name treatment and win-probability bar. A reader who has seen one card should
 * recognise the others at a glance.
 *
 * Sized for a phone. Discord shrinks an image to the width of the chat, so a 760px card shows at
 * roughly half size on a phone: nothing a reader needs is set below 14px, and anything they should
 * read first is 22px or more.
 *
 * Rendered with next/og (satori + resvg, both already inside Next), so there is no native dependency
 * to install on the box. Satori does not do block layout: every element with more than one child
 * must be display:flex, and flex children need explicit widths or they shrink to nothing.
 */

export const CARD_W = 760;
export const PAD_X = 24;
export const INNER_W = CARD_W - PAD_X * 2;

export const C = {
  bg: '#0f1626',
  headerTop: '#16203a',
  row: '#18213a',
  rowAlt: '#151d33',
  divider: '#243050',
  text: '#f2f5fa',
  muted: '#8792ab',
  dim: '#55607c',
  /** Game state: live and still-to-play stand out against finished. */
  live: '#3be37e',
  upcoming: '#8aa4ff',
  final: '#f2f5fa',
  /** Better or worse than expected — luck, and nothing that has sides. */
  good: '#3be37e',
  bad: '#ff5c72',
  sideA: MARKET_SIDE_COLORS.a,
  sideB: MARKET_SIDE_COLORS.b,
} as const;

/** The type scale. Every size used in a card comes from here. */
export const T = {
  /** The score duel at the top of /matchup. */
  hero: 56,
  display: 48,
  score: 30,
  title: 26,
  name: 22,
  /** A player in a lineup row: under a manager's name in the hierarchy, and rows are tight. */
  player: 20,
  body: 17,
  small: 15,
  micro: 14,
} as const;

export const HEADER_STRIP_H = 46;
export const FOOTER_H = 56;

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

export const pts = (n: number) => n.toFixed(1);

/** A chance that has not hit certainty never reads as 0% or 100% — the game is not over. */
export function chanceText(p: number): string {
  if (p < 0.005) return '<1%';
  if (p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}

export function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

export type StatusTone = 'live' | 'upcoming' | 'final' | 'neutral';

const TONE: Record<StatusTone, string> = {
  live: C.live,
  upcoming: C.upcoming,
  final: C.muted,
  neutral: C.muted,
};

/** A rounded label with a state dot — LIVE, NOT STARTED, FINAL, THROUGH WEEK 8. */
export function StatusPill({ text, tone }: { text: string; tone: StatusTone }) {
  const colour = TONE[tone];
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 26, padding: '0 12px', borderRadius: 13, border: `1px solid ${tone === 'live' ? colour : C.divider}`, color: tone === 'live' ? colour : C.muted, fontSize: T.micro, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colour, marginRight: 8 }} />
      {text}
    </div>
  );
}

/** The strip at the top of every card: which league on the left, which week and state on the right. */
export function HeaderStrip({ league, status, tone }: { league: string; status: string; tone: StatusTone }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: HEADER_STRIP_H, flexShrink: 0 }}>
      <div style={{ fontSize: T.small, color: C.muted, fontWeight: 700, whiteSpace: 'nowrap' }}>{clip(league, 44)}</div>
      <StatusPill text={status} tone={tone} />
    </div>
  );
}

/**
 * A manager's name as every card shows it: a dot in their side's colour, the name in bold, and the
 * team name muted beneath. Colour is identity, never rank — side A is always the same blue whoever
 * is favoured, so a line moving never repaints the sides.
 */
export function ManagerName({
  name, team, colour, align, size = T.name, width, max = 18, faded = false, badge,
}: {
  name: string;
  team?: string | null;
  colour: string | null;
  align: 'left' | 'right';
  size?: number;
  /** Omit to size to the name, so something can sit right beside it. */
  width?: number;
  max?: number;
  faded?: boolean;
  badge?: string;
}) {
  const right = align === 'right';
  const dot = colour ? (
    <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour, flexShrink: 0, margin: right ? '0 0 0 9px' : '0 9px 0 0' }} />
  ) : null;
  const tag = badge ? (
    <div style={{ display: 'flex', alignItems: 'center', height: 20, padding: '0 7px', borderRadius: 5, backgroundColor: C.good, color: C.bg, fontSize: 12, fontWeight: 700, margin: right ? '0 8px 0 0' : '0 0 0 8px' }}>
      {badge}
    </div>
  ) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...(width ? { width } : {}), flexShrink: 0, alignItems: right ? 'flex-end' : 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', flexDirection: right ? 'row-reverse' : 'row' }}>
        {dot}
        <div style={{ fontSize: size, fontWeight: 700, color: faded ? C.muted : C.text, whiteSpace: 'nowrap' }}>{clip(name, max)}</div>
        {tag}
      </div>
      {team ? (
        // Indented to sit under the name, not the dot — and only when there is a dot.
        <div style={{ fontSize: T.micro, color: C.muted, marginTop: 3, whiteSpace: 'nowrap', padding: !colour ? 0 : right ? '0 19px 0 0' : '0 0 0 19px' }}>
          {clip(team, 30)}
        </div>
      ) : null}
    </div>
  );
}

/** Up to two initials: "Josh Allen" → "JA", "edgecdec" → "ED", "Los Angeles Rams" → "LR". */
export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * A round picture — manager avatar, player headshot, team logo — or, when there is none, the
 * initials on a disc. `src` is a data URI the route fetched (imageAssets.ts); a missing or failed
 * picture is simply null here, so the card always renders.
 */
export function Avatar({ src, label, size, ring }: { src: string | null | undefined; label: string; size: number; ring?: string }) {
  const border = ring ? `2px solid ${ring}` : `1px solid ${C.divider}`;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- satori renders <img>, not next/image
      <img src={src} alt={label} width={size} height={size} style={{ width: size, height: size, borderRadius: size / 2, objectFit: 'cover', backgroundColor: C.divider, border, flexShrink: 0 }} />
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: size / 2, backgroundColor: C.divider, border, color: C.muted, fontSize: Math.max(T.micro, Math.round(size * 0.36)), fontWeight: 700, flexShrink: 0 }}>
      {initials(label)}
    </div>
  );
}

/**
 * The site's matchup meter: left share is the left side's chance, with each side's chance printed at
 * its own end so the bar never has to be measured by eye.
 */
export function WinBar({ p, width, height = 10, labels = true }: { p: number; width: number; height?: number; labels?: boolean }) {
  const share = Math.max(1, Math.min(99, p * 100));
  const bar = (
    <div style={{ display: 'flex', width: labels ? width - 112 : width, height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: C.divider }}>
      <div style={{ width: `${share}%`, backgroundColor: C.sideA }} />
      <div style={{ width: 3, backgroundColor: C.bg }} />
      <div style={{ flex: 1, backgroundColor: C.sideB }} />
    </div>
  );
  if (!labels) return bar;
  const label = (text: string, colour: string, right: boolean) => (
    <div style={{ display: 'flex', width: 56, justifyContent: right ? 'flex-end' : 'flex-start', fontSize: T.body, fontWeight: 700, color: colour }}>{text}</div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', width, flexShrink: 0 }}>
      {label(chanceText(p), C.sideA, false)}
      {bar}
      {label(chanceText(1 - p), C.sideB, true)}
    </div>
  );
}

export function LegendDot({ colour, label }: { colour: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginRight: 16 }}>
      <div style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colour, marginRight: 6 }} />
      <div>{label}</div>
    </div>
  );
}

/** The strip at the bottom of every card: what the colours mean, and where it came from. */
export function Footer({ left, note }: { left?: ReactNode; note?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: FOOTER_H, flexShrink: 0, padding: `0 ${PAD_X}px`, fontSize: T.micro, color: C.muted, borderTop: `1px solid ${C.divider}` }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>{left ?? (note ? <div>{note}</div> : null)}</div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {left && note ? <div style={{ marginRight: 14 }}>{note}</div> : null}
        <div style={{ color: C.dim, fontWeight: 700 }}>DECLANALYTICS</div>
      </div>
    </div>
  );
}

/**
 * The card itself. A soft gradient behind the header so the top of every card reads as a header
 * without a hard rule, then the body on the flat background.
 */
export function renderCard(children: ReactNode, height: number): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: CARD_W, height, backgroundColor: C.bg, backgroundImage: `linear-gradient(180deg, ${C.headerTop} 0px, ${C.bg} 220px)`, fontFamily: 'Geist' }}>
        {children}
      </div>
    ),
    { width: CARD_W, height, fonts: loadFonts() },
  );
}
