'use client';

import * as React from 'react';
import { Box, Tooltip } from '@mui/material';
import { MARKET_SIDE_COLORS, MARKET_EVEN_REFERENCE } from '@/constants/colors';

/**
 * Net rooting interest, drawn from a centre baseline.
 *
 * This is polarity data — "do I want him to do well, and how strongly" — so it gets a
 * diverging form with a fixed zero in the middle rather than a magnitude bar. Reading the
 * sign has to be possible at a glance across a long list, and a bar that always grows
 * rightward cannot do that.
 *
 * The two hues are the same identity pair the win-probability meter uses, so "my side" and
 * "their side" mean the same thing everywhere on the page. The value is always printed
 * next to the bar, so nothing depends on distinguishing the colours.
 */

const BAR_HEIGHT_PX = 10;
const ROUNDED_END_PX = 4;

type Props = {
  /** Leagues starting him for me, minus leagues starting him against me. */
  net: number;
  /** Largest magnitude in the list, so bars share one scale. */
  max: number;
  label: string;
};

export default function NetLeaguesBar({ net, max, label }: Props) {
  // Half the width is available to each direction, so a full-scale value fills its side.
  const share = max > 0 ? Math.min(1, Math.abs(net) / max) : 0;
  const positive = net > 0;

  return (
    <Tooltip title={label} arrow>
      <Box sx={{ position: 'relative', height: BAR_HEIGHT_PX, width: '100%', minWidth: 80 }}>
        {/* Zero reference, recessive so it orients without competing with the data. */}
        <Box
          sx={{
            position: 'absolute', left: '50%', top: -1, bottom: -1,
            width: 1, bgcolor: MARKET_EVEN_REFERENCE,
          }}
        />
        {net !== 0 && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              height: BAR_HEIGHT_PX,
              // Grows away from the centre in the direction of the sign.
              left: positive ? '50%' : `calc(50% - ${share * 50}%)`,
              width: `${share * 50}%`,
              bgcolor: positive ? MARKET_SIDE_COLORS.a : MARKET_SIDE_COLORS.b,
              borderRadius: positive
                ? `0 ${ROUNDED_END_PX}px ${ROUNDED_END_PX}px 0`
                : `${ROUNDED_END_PX}px 0 0 ${ROUNDED_END_PX}px`,
            }}
          />
        )}
      </Box>
    </Tooltip>
  );
}
