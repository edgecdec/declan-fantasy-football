'use client';

import * as React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { MARKET_SIDE_COLORS, MARKET_EVEN_REFERENCE } from '@/constants/colors';
import { RATING_SCALE, WinRating, rateWinProbability } from '@/services/week/winRating';

/**
 * A forecast-style rating scale: Solid You ... Toss-up ... Solid Them, with the current
 * matchup marked.
 *
 * Why a scale rather than a coloured chip. The chip tells you the bucket; the scale also tells
 * you where in it you sit and how far you are from tipping into the next one, which is the
 * thing you actually want to know mid-slate. It reads like the win-probability bar it sits
 * with — same two identity hues, same left-is-you convention.
 *
 * On colour, deliberately: the seven segments are NOT seven distinct hues. Three intensities
 * of the validated blue, a neutral midpoint, three of the validated pink. Seven bespoke steps
 * were tried and the inner pairs came out at ΔE 2.6-5.9 — indistinguishable even with full
 * colour vision, so "Likely them" and "Solid them" would have been the same colour with extra
 * steps. Built from intensity instead, the two poles are the identity pair that passes every
 * check (ΔE 20.1 protan, 32.4 normal), so the only thing colour has to carry is DIRECTION.
 * Identity comes from the label, which is always rendered.
 */

const SEGMENT_HEIGHT_PX = 10;
const SEGMENT_GAP_PX = 2;
const ROUNDED_END_PX = 4;

/** Intensity per step out from the toss-up. Certainty reads as saturation. */
const STEP_OPACITY: Record<number, number> = { 0: 1, 1: 0.4, 2: 0.68, 3: 1 };

function segmentColor(rating: WinRating): string {
  if (rating.favours === null) return MARKET_EVEN_REFERENCE;
  return rating.favours === 'you' ? MARKET_SIDE_COLORS.a : MARKET_SIDE_COLORS.b;
}

type Props = {
  /** Probability YOU win. */
  probability: number;
  /** Dim the whole thing once the matchup is decided. */
  muted?: boolean;
  /** Hide the text label, for callers that render it themselves. */
  showLabel?: boolean;
};

export default function WinRatingScale({ probability, muted = false, showLabel = true }: Props) {
  const current = rateWinProbability(probability);

  return (
    <Box sx={{ opacity: muted ? 0.55 : 1, minWidth: 150 }}>
      <Box sx={{ display: 'flex', gap: `${SEGMENT_GAP_PX}px`, height: SEGMENT_HEIGHT_PX }}>
        {RATING_SCALE.map((rating, i) => {
          const active = rating.key === current.key;
          return (
            <Tooltip
              key={rating.key}
              title={`${rating.label}${active ? ` — this matchup (${(probability * 100).toFixed(0)}%)` : ''}`}
              arrow
            >
              <Box
                sx={{
                  flex: 1,
                  bgcolor: segmentColor(rating),
                  // Inactive segments recede to context; the active one is at full strength
                  // and outlined, so the reader's eye lands on the rating, not the scale.
                  opacity: active ? STEP_OPACITY[rating.step] : 0.16,
                  outline: active ? '2px solid' : 'none',
                  outlineColor: 'text.primary',
                  outlineOffset: '1px',
                  borderRadius:
                    i === 0
                      ? `${ROUNDED_END_PX}px 0 0 ${ROUNDED_END_PX}px`
                      : i === RATING_SCALE.length - 1
                        ? `0 ${ROUNDED_END_PX}px ${ROUNDED_END_PX}px 0`
                        : 0,
                }}
              />
            </Tooltip>
          );
        })}
      </Box>

      {showLabel && (
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            mt: 0.4,
            fontWeight: 700,
            // Text ink, not the series colour: a coloured label beside a coloured bar makes
            // both harder to read, and the bar already carries the direction.
            color: current.favours === null ? 'text.secondary' : 'text.primary',
            // Nudge the label toward the side it favours, so it reads with the scale.
            textAlign: current.favours === 'you' ? 'left' : current.favours === 'them' ? 'right' : 'center',
          }}
        >
          {current.label}
        </Typography>
      )}
    </Box>
  );
}
