'use client';

import * as React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { MARKET_SIDE_COLORS, MARKET_EVEN_REFERENCE } from '@/constants/colors';

/**
 * Win-probability meter for a two-sided market.
 *
 * A single split bar rather than two numbers or two bars: the two shares sum to
 * 100%, so the reader's question is "how lopsided is this", which is a
 * part-to-whole comparison best answered by one length. The 50% tick supplies the
 * polarity read — how far from a coin flip — without implying either side is good
 * or bad.
 *
 * Colour is identity, not rank: side A keeps its hue whoever is favoured, so a
 * line moving never repaints the sides. Names carry a swatch and sit in text ink
 * rather than being coloured themselves, so identity never rests on colour alone.
 */

/** Capped rather than filling the row, so the band keeps some air. */
const METER_HEIGHT_PX = 14;
/** Surface-coloured gap that separates the two fills. */
const SEGMENT_GAP_PX = 2;
const ROUNDED_END_PX = 4;
/** Below this share a segment is too narrow to hold its own label legibly. */
const MIN_INLINE_LABEL_SHARE = 0.18;

type Props = {
  probA: number;
  nameA: string;
  nameB: string;
  /** Dims the whole meter when the market can't be bet. */
  muted?: boolean;
};

export default function MatchupMeter({ probA, nameA, nameB, muted = false }: Props) {
  const a = Math.min(1, Math.max(0, probA));
  const b = 1 - a;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <Box sx={{ opacity: muted ? 0.55 : 1 }}>
      <Box
        sx={{
          position: 'relative',
          display: 'flex',
          height: METER_HEIGHT_PX,
          gap: `${SEGMENT_GAP_PX}px`,
        }}
      >
        <Tooltip title={`${nameA} — ${pct(a)} to win`} arrow>
          <Box
            aria-label={`${nameA} ${pct(a)}`}
            sx={{
              width: `calc(${a * 100}% - ${SEGMENT_GAP_PX / 2}px)`,
              minWidth: 2,
              bgcolor: MARKET_SIDE_COLORS.a,
              borderRadius: `${ROUNDED_END_PX}px 0 0 ${ROUNDED_END_PX}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              cursor: 'default',
            }}
          >
            {a >= MIN_INLINE_LABEL_SHARE && (
              // Inside a filled segment is the one place a label may sit on the
              // data colour, so it takes a fixed light ink for contrast.
              <Typography
                variant="caption"
                sx={{ pl: 0.75, color: '#fff', fontWeight: 700, lineHeight: 1, fontSize: 11 }}
              >
                {pct(a)}
              </Typography>
            )}
          </Box>
        </Tooltip>

        <Tooltip title={`${nameB} — ${pct(b)} to win`} arrow>
          <Box
            aria-label={`${nameB} ${pct(b)}`}
            sx={{
              width: `calc(${b * 100}% - ${SEGMENT_GAP_PX / 2}px)`,
              minWidth: 2,
              bgcolor: MARKET_SIDE_COLORS.b,
              borderRadius: `0 ${ROUNDED_END_PX}px ${ROUNDED_END_PX}px 0`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              cursor: 'default',
            }}
          >
            {b >= MIN_INLINE_LABEL_SHARE && (
              <Typography
                variant="caption"
                sx={{ pr: 0.75, color: '#fff', fontWeight: 700, lineHeight: 1, fontSize: 11 }}
              >
                {pct(b)}
              </Typography>
            )}
          </Box>
        </Tooltip>

        {/* Even-market reference. Hairline and solid, sitting above the fills. */}
        <Tooltip title="An even market — 50/50" arrow>
          <Box
            sx={{
              position: 'absolute',
              left: '50%',
              top: -2,
              bottom: -2,
              width: '1px',
              bgcolor: MARKET_EVEN_REFERENCE,
              pointerEvents: 'none',
            }}
          />
        </Tooltip>
      </Box>

      {/* Values that didn't fit inline still appear, so nothing is gated on width. */}
      {(a < MIN_INLINE_LABEL_SHARE || b < MIN_INLINE_LABEL_SHARE) && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
          <Typography variant="caption" color="text.secondary">
            {a < MIN_INLINE_LABEL_SHARE ? pct(a) : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {b < MIN_INLINE_LABEL_SHARE ? pct(b) : ''}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

/** Small colour key used beside a manager's name, so identity isn't colour-alone. */
export function SideSwatch({ side }: { side: 'a' | 'b' }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '2px',
        bgcolor: MARKET_SIDE_COLORS[side],
        flexShrink: 0,
      }}
    />
  );
}
