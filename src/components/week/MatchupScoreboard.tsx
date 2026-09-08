'use client';

import * as React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import MatchupMeter from '@/components/betting/MatchupMeter';
import { MARKET_SIDE_COLORS } from '@/constants/colors';

/**
 * A head-to-head scoreboard: names flanking centred scores, mirrored inward.
 *
 * The previous layout put "You" and "Opponent" in separate table columns, which made the
 * reader join two numbers separated by other content to answer the only question they had.
 * Here the two scores sit against each other in the middle with the names turned inward, so
 * the comparison is a single glance and the gap between the numbers IS the margin.
 *
 * The probability bar sits directly beneath and spans the same width, so its split lines up
 * with the names above it — left segment under the left name. That is also why the bar draws
 * without its own inline labels: the names are already there, and the meter only shows an
 * inline label above a width threshold, so on a lopsided line one name would appear and the
 * other would not.
 */

type Props = {
  leftName: string;
  rightName: string;
  leftScore: number;
  rightScore: number;
  leftProjected: number;
  rightProjected: number;
  /** Probability the LEFT side wins. */
  leftWinProbability: number;
  /** Starters who can still score, per side. */
  leftToPlay?: number;
  rightToPlay?: number;
  /** Dims everything once the matchup is decided. */
  final?: boolean;
  /** Marks which side is the viewer, so a long list is scannable. */
  leftIsYou?: boolean;
};

function SideName({
  name, align, isYou, leading, color,
}: {
  name: string; align: 'right' | 'left'; isYou?: boolean; leading: boolean; color: string;
}) {
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        flexDirection: align === 'right' ? 'row' : 'row-reverse',
      }}
    >
      <Typography
        variant="body2"
        noWrap
        title={name}
        sx={{
          fontWeight: leading ? 700 : 400,
          color: leading ? 'text.primary' : 'text.secondary',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {isYou ? 'You' : name}
      </Typography>
      {/* Swatch ties the name to its segment of the bar below, so identity never rests on
          position alone. */}
      <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: color, flexShrink: 0 }} />
    </Box>
  );
}

export default function MatchupScoreboard({
  leftName, rightName, leftScore, rightScore, leftProjected, rightProjected,
  leftWinProbability, leftToPlay, rightToPlay, final = false, leftIsYou = false,
}: Props) {
  const margin = leftScore - rightScore;
  const leftLeading = margin > 0;
  const rightLeading = margin < 0;

  return (
    <Box sx={{ opacity: final ? 0.7 : 1, minWidth: 320 }}>
      <Box
        sx={{
          display: 'grid',
          // Names take the slack; the score block stays a fixed centred width so scores
          // line up vertically down the whole table rather than drifting with name length.
          gridTemplateColumns: '1fr 108px 1fr',
          alignItems: 'center',
          columnGap: 1,
        }}
      >
        <SideName
          name={leftName} align="right" isYou={leftIsYou}
          leading={leftLeading} color={MARKET_SIDE_COLORS.a}
        />

        <Box sx={{ textAlign: 'center', lineHeight: 1.15 }}>
          <Typography component="div" variant="body1" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            <Box component="span" sx={{ fontWeight: leftLeading ? 700 : 500 }}>
              {leftScore.toFixed(1)}
            </Box>
            <Box component="span" sx={{ color: 'text.disabled', mx: 0.6 }}>–</Box>
            <Box component="span" sx={{ fontWeight: rightLeading ? 700 : 500 }}>
              {rightScore.toFixed(1)}
            </Box>
          </Typography>
          <Tooltip title="Projected final score for each side">
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {leftProjected.toFixed(0)} – {rightProjected.toFixed(0)} proj
            </Typography>
          </Tooltip>
        </Box>

        <SideName
          name={rightName} align="left"
          leading={rightLeading} color={MARKET_SIDE_COLORS.b}
        />
      </Box>

      <Box sx={{ mt: 0.6 }}>
        <MatchupMeter
          probA={leftWinProbability}
          nameA={leftIsYou ? 'You' : leftName}
          nameB={rightName}
          muted={final}
          showLabels={false}
        />
      </Box>

      <Box
        sx={{
          display: 'grid', gridTemplateColumns: '1fr auto 1fr',
          columnGap: 1, mt: 0.3,
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
          {(leftWinProbability * 100).toFixed(0)}%
        </Typography>
        {/* Yet-to-play is the context that decides how to read a lead at all: 40 points up
            with nobody left is over, 40 up with eight to play is not. */}
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {final
            ? 'final'
            : leftToPlay != null && rightToPlay != null
              ? `${leftToPlay} v ${rightToPlay} left to play`
              : ''}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {((1 - leftWinProbability) * 100).toFixed(0)}%
        </Typography>
      </Box>
    </Box>
  );
}
