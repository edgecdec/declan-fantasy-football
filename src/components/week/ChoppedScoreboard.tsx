'use client';

import * as React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { MARKET_SIDE_COLORS } from '@/constants/colors';
import { formatProjection, formatScore, formatWinProbability } from '@/services/common/formatPoints';

/**
 * A chopped/guillotine league: one score, and how safe it is.
 *
 * There is no opponent in this format — the lowest score of the whole league goes out — so this
 * deliberately does NOT borrow the head-to-head layout. An earlier version did: it nominated the
 * roster nearest the chop and drew it as the other side, which read as a matchup that does not
 * exist and invited the wrong conclusion, that beating that one roster is the thing to do. It
 * isn't; you have to beat all sixteen of them.
 *
 * So the bar is a single fill to your SAFETY, not a split between two sides, and the field lives
 * in the expanded row where it can be shown properly. The anatomy still lines up with a matchup
 * row — score above, bar across the same width, percentages beneath — so the table stays scannable
 * without claiming an opponent.
 */

const BAR_HEIGHT_PX = 10;
const ROUNDED_PX = 4;
/** A near-certain elimination must still show a sliver of safety, and vice versa. */
const MIN_VISIBLE_PCT = 1.5;

type Props = {
  banked: number;
  projected: number;
  /** Probability I do NOT post the lowest score. */
  safeProbability: number;
  /** Live rosters including me. */
  activeRosters: number;
  playersRemaining: number;
  final?: boolean;
};

export default function ChoppedScoreboard({
  banked, projected, safeProbability, activeRosters, playersRemaining, final = false,
}: Props) {
  const safePct = Math.max(MIN_VISIBLE_PCT, Math.min(100 - MIN_VISIBLE_PCT, safeProbability * 100));

  return (
    <Box sx={{ opacity: final ? 0.7 : 1, minWidth: 300, maxWidth: 400, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', lineHeight: 1.15 }}>
        <Typography component="div" variant="body1" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatScore(banked)}
        </Typography>
        <Tooltip title="Your projected final score. There is no opponent — the lowest score in the league is eliminated.">
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {formatProjection(projected)} proj · lowest of {activeRosters} is out
          </Typography>
        </Tooltip>
      </Box>

      <Tooltip
        arrow
        title={`${formatWinProbability(safeProbability, final)} safe, ${formatWinProbability(1 - safeProbability, final)} chopped. Open the row to see the whole field.`}
      >
        <Box sx={{ display: 'flex', width: '100%', height: BAR_HEIGHT_PX, mt: 0.6 }}>
          <Box
            sx={{
              width: `${safePct}%`,
              bgcolor: MARKET_SIDE_COLORS.a,
              opacity: final ? 0.55 : 1,
              borderRadius: `${ROUNDED_PX}px 0 0 ${ROUNDED_PX}px`,
            }}
          />
          <Box
            sx={{
              width: `${100 - safePct}%`,
              bgcolor: MARKET_SIDE_COLORS.b,
              opacity: final ? 0.55 : 1,
              borderRadius: `0 ${ROUNDED_PX}px ${ROUNDED_PX}px 0`,
            }}
          />
        </Box>
      </Tooltip>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', columnGap: 1, mt: 0.3 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
          {formatWinProbability(safeProbability, final)} safe
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {final ? 'final' : `${playersRemaining} left to play`}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {formatWinProbability(1 - safeProbability, final)} out
        </Typography>
      </Box>
    </Box>
  );
}
