'use client';

import * as React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { RATING_RAMP } from '@/constants/colors';
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
 * Colour comes from RATING_RAMP, the shared election-style diverging scale: darker is a
 * stronger call on each side, with a tan toss-up in the middle. See that constant for the
 * measurements behind it. The label is always rendered, so colour never carries identity
 * alone.
 */

const SEGMENT_HEIGHT_PX = 10;
const SEGMENT_GAP_PX = 2;
const ROUNDED_END_PX = 4;

function segmentColor(rating: WinRating): string {
  return RATING_RAMP[rating.key];
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
                  opacity: active ? 1 : 0.2,
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
