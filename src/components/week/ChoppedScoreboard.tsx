'use client';

import * as React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import MatchupMeter from '@/components/betting/MatchupMeter';
import { MARKET_SIDE_COLORS } from '@/constants/colors';
import { formatProjection, formatScore, formatWinProbability } from '@/services/common/formatPoints';

/**
 * A chopped/guillotine league, drawn to read like a head-to-head row.
 *
 * There is no opponent in this format — the lowest score in the league goes out — so the obvious
 * rendering would be a lone number, which tells you nothing about whether it is a good one. But
 * the survival question genuinely IS two-sided: you are safe exactly as long as somebody else is
 * below you. So the roster most likely to be chopped stands in as the other side, and SAFETY plays
 * the part win probability plays in a real matchup.
 *
 * Deliberately the same anatomy as MatchupScoreboard — names flanking centred scores, meter
 * beneath spanning the same width, percentages and yet-to-play underneath — so a reader who can
 * read one row can read this one without being taught anything. The differences are only the ones
 * that carry meaning:
 *
 *  - the right-hand side is a rival you are not playing, so it is labelled with the field size
 *  - the bar is safe-versus-chopped, not win-versus-lose
 *  - beating this one rival is necessary but not sufficient, which is why the safety figure comes
 *    from the whole field rather than from the pair. The two are shown together on purpose: the
 *    gap between "ahead of them" and "safe" is the rest of the league.
 */

type Props = {
  /** Points banked and projected final, for me. */
  banked: number;
  projected: number;
  /** Probability I do NOT post the lowest score. */
  safeProbability: number;
  /** Live rosters including me. */
  activeRosters: number;
  playersRemaining: number;
  /** The roster most likely to be chopped, other than me. */
  rival: {
    name: string;
    banked: number;
    projected: number;
    playersRemaining: number;
  } | null;
  final?: boolean;
};

function SideName({
  name, side, leading, color,
}: {
  name: string; side: 'left' | 'right'; leading: boolean; color: string;
}) {
  const swatch = (
    <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: color, flexShrink: 0 }} />
  );
  const label = (
    <Typography
      variant="body2"
      noWrap
      title={name}
      sx={{
        fontWeight: leading ? 700 : 400,
        color: leading ? 'text.primary' : 'text.secondary',
        overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
      }}
    >
      {name}
    </Typography>
  );
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.6, minWidth: 0,
        justifyContent: side === 'left' ? 'flex-end' : 'flex-start',
      }}
    >
      {side === 'left' ? <>{label}{swatch}</> : <>{swatch}{label}</>}
    </Box>
  );
}

export default function ChoppedScoreboard({
  banked, projected, safeProbability, activeRosters, playersRemaining, rival, final = false,
}: Props) {
  // No rival at all means one roster left standing. Nothing to compare against, so say so rather
  // than drawing a bar against an empty side.
  if (!rival) {
    return (
      <Box sx={{ minWidth: 300, maxWidth: 400, mx: 'auto', textAlign: 'center' }}>
        <Typography variant="body1" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatScore(banked)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          last roster standing
        </Typography>
      </Box>
    );
  }

  const ahead = banked - rival.banked;

  return (
    <Box sx={{ opacity: final ? 0.7 : 1, minWidth: 300, maxWidth: 400, mx: 'auto' }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 104px minmax(0, 1fr)',
          alignItems: 'center',
          columnGap: 1,
        }}
      >
        <SideName name="You" side="left" leading={ahead > 0} color={MARKET_SIDE_COLORS.a} />

        <Box sx={{ textAlign: 'center', lineHeight: 1.15 }}>
          <Typography component="div" variant="body1" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            <Box component="span" sx={{ fontWeight: ahead > 0 ? 700 : 500 }}>
              {formatScore(banked)}
            </Box>
            <Box component="span" sx={{ color: 'text.disabled', mx: 0.6 }}>–</Box>
            <Box component="span" sx={{ fontWeight: ahead < 0 ? 700 : 500 }}>
              {formatScore(rival.banked)}
            </Box>
          </Typography>
          <Tooltip title="Projected final score for you and for the roster most likely to be chopped">
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatProjection(projected)} – {formatProjection(rival.projected)} proj
            </Typography>
          </Tooltip>
        </Box>

        <SideName
          name={rival.name}
          side="right"
          leading={ahead < 0}
          color={MARKET_SIDE_COLORS.b}
        />
      </Box>

      <Box sx={{ mt: 0.6 }}>
        <MatchupMeter
          probA={safeProbability}
          nameA="Safe"
          nameB="Chopped"
          muted={final}
          showLabels={false}
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', columnGap: 1, mt: 0.3 }}>
        <Tooltip title={`Chance you are NOT the lowest score of the ${activeRosters} still alive`}>
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
            {formatWinProbability(safeProbability, final)} safe
          </Typography>
        </Tooltip>
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {final
            ? 'final'
            : `${playersRemaining} v ${rival.playersRemaining} left · ${activeRosters} alive`}
        </Typography>
        <Tooltip title="Chance you post the lowest score and are chopped this week">
          <Typography variant="caption" color="text.secondary">
            {formatWinProbability(1 - safeProbability, final)} out
          </Typography>
        </Tooltip>
      </Box>
    </Box>
  );
}
