'use client';

import * as React from 'react';
import { Box, Tooltip } from '@mui/material';
import { MARKET_SIDE_COLORS } from '@/constants/colors';

/**
 * Net rooting interest, diverging from a centred zero.
 *
 * Polarity data — "do I want him to do well, and how strongly" — so it needs a fixed zero in
 * the middle and growth in both directions. Reading the sign has to work at a glance down a
 * long list, which a bar that always grows rightward cannot do.
 *
 * Built as two equal halves rather than one absolutely-positioned bar, so zero is centred by
 * construction and no arithmetic can move it. The previous version positioned a single bar at
 * `left: 50%` with a `width: 1` hairline behind it for the zero mark, and that hairline was the
 * bug: MUI's `sx` treats a width of 1 as 100%, not 1px, so the "hairline" rendered as a
 * full-width block behind every row. It read as an outlined track that the bars then failed to
 * line up inside.
 *
 * No track or background at all now. With the value printed beside every bar, an empty half is
 * unambiguous, and a track would only invite the same misreading.
 */

const BAR_HEIGHT_PX = 10;
const ROUNDED_END_PX = 4;
/** A net of ±1 must stay visible next to a ±8. */
const MIN_SHARE = 0.1;

type Props = {
  /** Leagues starting him for me, minus leagues starting him against me. */
  net: number;
  /** Largest magnitude in the list, so every bar shares one scale. */
  max: number;
  label: string;
};

export default function NetLeaguesBar({ net, max, label }: Props) {
  const share = max > 0 && net !== 0
    ? Math.max(MIN_SHARE, Math.min(1, Math.abs(net) / max))
    : 0;

  return (
    <Tooltip title={label} arrow>
      <Box sx={{ display: 'flex', width: '100%', minWidth: 80, height: BAR_HEIGHT_PX }}>
        {/* Left half: against me, growing leftward from the centre. */}
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          {net < 0 && (
            <Box
              sx={{
                width: `${share * 100}%`,
                bgcolor: MARKET_SIDE_COLORS.b,
                borderRadius: `${ROUNDED_END_PX}px 0 0 ${ROUNDED_END_PX}px`,
              }}
            />
          )}
        </Box>
        {/* Right half: for me, growing rightward from the centre. */}
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-start' }}>
          {net > 0 && (
            <Box
              sx={{
                width: `${share * 100}%`,
                bgcolor: MARKET_SIDE_COLORS.a,
                borderRadius: `0 ${ROUNDED_END_PX}px ${ROUNDED_END_PX}px 0`,
              }}
            />
          )}
        </Box>
      </Box>
    </Tooltip>
  );
}
