'use client';

import * as React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { RATING_RAMP } from '@/constants/colors';
import { RATING_SCALE, rateWinProbability } from '@/services/week/winRating';

/**
 * The whole week's ratings in one strip, in the shape of an election-night seat bar.
 *
 * Three readings, each answering a different question:
 *
 *  - the totals on either side: how many matchups are called your way at all
 *  - the proportional bar: the SHAPE of the week, so a slate that is mostly toss-ups is one
 *    wide tan block and a good week is visibly weighted left
 *  - the row of counts beneath: exact figures, with every bucket present even at zero, so it
 *    always reads as a full seven-figure breakdown (0-1-1-6-2-1-1) rather than only the
 *    buckets that happen to be occupied
 *
 * Side totals deliberately EXCLUDE toss-ups, matching how a seat bar is read: a toss-up is not
 * yet anybody's, and folding it into one side would overstate the call.
 */

const BAR_HEIGHT_PX = 26;
const SEGMENT_GAP_PX = 2;
const ROUNDED_END_PX = 4;
/** A single matchup must stay visible however many others there are. */
const MIN_SEGMENT_PCT = 3.5;
/** Below this width a segment cannot hold its own number legibly. */
const MIN_INLINE_LABEL_PCT = 7;

/** Two lines, so "Solid you" does not force the column absurdly wide. */
function splitLabel(label: string): [string, string] {
  const [first, ...rest] = label.split(' ');
  return [first, rest.join(' ')];
}

export default function RatingBreakdown({ probabilities }: { probabilities: number[] }) {
  const counts = React.useMemo(() => {
    const byKey = new Map(RATING_SCALE.map(r => [r.key, 0]));
    for (const p of probabilities) {
      const k = rateWinProbability(p).key;
      byKey.set(k, (byKey.get(k) ?? 0) + 1);
    }
    return RATING_SCALE.map(r => ({ rating: r, count: byKey.get(r.key) ?? 0 }));
  }, [probabilities]);

  const total = probabilities.length;
  if (total === 0) return null;

  const yourSide = counts.filter(c => c.rating.favours === 'you').reduce((s, c) => s + c.count, 0);
  const theirSide = counts.filter(c => c.rating.favours === 'them').reduce((s, c) => s + c.count, 0);
  const tossups = counts.find(c => c.rating.key === 'tossup')?.count ?? 0;

  const occupied = counts.filter(c => c.count > 0);
  // Reserve a visible minimum per occupied bucket, then share the rest by count, so one
  // matchup never collapses to an invisible sliver.
  const flexible = Math.max(0, 100 - occupied.length * MIN_SEGMENT_PCT);
  const widthFor = (count: number) => MIN_SEGMENT_PCT + (count / total) * flexible;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', mb: 0.75, gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, color: RATING_RAMP.solid_you }}>
          You {yourSide}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, textAlign: 'center' }}>
          {tossups} toss-up{tossups === 1 ? '' : 's'} of {total}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, color: RATING_RAMP.solid_them }}>
          {theirSide} Them
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: `${SEGMENT_GAP_PX}px`, height: BAR_HEIGHT_PX }}>
        {occupied.map(({ rating, count }, i) => {
          const width = widthFor(count);
          const first = i === 0;
          const last = i === occupied.length - 1;
          return (
            <Tooltip key={rating.key} title={`${rating.label}: ${count} of ${total}`} arrow>
              <Box
                sx={{
                  width: `${width}%`,
                  bgcolor: RATING_RAMP[rating.key],
                  borderRadius: `${first ? ROUNDED_END_PX : 0}px ${last ? ROUNDED_END_PX : 0}px ${last ? ROUNDED_END_PX : 0}px ${first ? ROUNDED_END_PX : 0}px`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {width >= MIN_INLINE_LABEL_PCT && (
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 700, lineHeight: 1,
                      // Dark ink on the pale steps, light on the deep ones, so the number is
                      // readable on every segment of the ramp.
                      color: rating.step >= 2 ? 'common.white' : 'rgba(0,0,0,0.82)',
                    }}
                  >
                    {count}
                  </Typography>
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${RATING_SCALE.length}, 1fr)`,
          mt: 0.75,
          columnGap: 0.5,
        }}
      >
        {counts.map(({ rating, count }) => {
          const [line1, line2] = splitLabel(rating.label);
          const empty = count === 0;
          return (
            <Box key={rating.key} sx={{ textAlign: 'center', opacity: empty ? 0.4 : 1 }}>
              {/* A swatch per column rather than colouring the number, so the counts stay in
                  text ink and remain legible at any size. */}
              <Box
                sx={{
                  height: 4, borderRadius: 1, mb: 0.4,
                  bgcolor: RATING_RAMP[rating.key],
                }}
              />
              <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.1 }}>{count}</Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', lineHeight: 1.15, fontSize: '0.66rem' }}
              >
                {line1}
                {line2 && <><br />{line2}</>}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
