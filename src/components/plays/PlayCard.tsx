'use client';

import * as React from 'react';
import { Box, Chip, Divider, Paper, Tooltip, Typography } from '@mui/material';
import MuiLink from '@mui/material/Link';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { getPositionColor } from '@/constants/colors';
import { MARKET_SIDE_COLORS } from '@/constants/colors';
import { leagueUrl } from '@/services/common/leagueLinks';
import { describeStats, type FeedEntry, type FeedPlayer, type LeagueImpact } from '@/services/plays/playFeed';

/**
 * One play, and what it was worth in each of your leagues.
 *
 * A chronological feed rather than a table, and that is the one deliberate exception to the
 * project's use-the-shared-table rule: a play-by-play sorted by anything other than time
 * stops being a play-by-play. The ordering IS the content. (Aggregations over these plays —
 * biggest gainers, per-player totals — are records, and those do belong in a DataTable.)
 *
 * The information hierarchy, from what you look at first:
 *
 *   1. the points, per league, coloured for/against — the answer to "was that good for me"
 *   2. who did it, with the position colour the rest of the site uses
 *   3. what happened, in Sleeper's own narration
 *
 * For/against uses the same two hues as every other betting surface here, so blue-is-yours
 * is one convention across the site rather than a per-page decision. Every impact also
 * carries a league name and a sign, so the colour is never the only thing saying which way
 * a play went.
 */

/** Below this the row is a rounding artefact, not a play worth colouring. */
const POINTS_EPSILON = 0.005;

function pointsColor(impact: LeagueImpact): string {
  if (!impact.isStarter) return 'text.disabled';
  if (impact.side === 'against') return MARKET_SIDE_COLORS.b;
  if (impact.side === 'for') return MARKET_SIDE_COLORS.a;
  return 'text.secondary';
}

/** Signed to two decimals — a lost fumble or an interception is a real negative. */
function signedPoints(points: number): string {
  const rounded = Math.abs(points) < POINTS_EPSILON ? 0 : points;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}`;
}

/**
 * The period, as a reader says it: "Q3", but "OT" rather than "QOT".
 *
 * Sleeper's `quarter_name` is not always a number — overtime comes through as "OT", which a
 * blind `Q${...}` renders as "QOT". Anything non-numeric is used verbatim.
 */
function periodLabel(quarter: string, clock: string | null): string {
  const period = /^\d+$/.test(quarter) ? `Q${quarter}` : quarter;
  return clock ? `${period} ${clock}` : period;
}

function ImpactChip({ impact }: { impact: LeagueImpact }) {
  const color = pointsColor(impact);
  return (
    <Tooltip
      arrow
      title={
        `${impact.leagueName} — ${
          impact.side === 'for' ? 'your team' : impact.side === 'against' ? 'your opponent' : 'another team'
        }${impact.isStarter ? '' : ', on the bench (does not count)'}`
        + `. ${signedPoints(impact.points)} on this play, ${impact.totalPoints.toFixed(2)} for the week`
        + ' in this league after it.'
      }
    >
      <Box
        sx={{
          display: 'inline-flex', alignItems: 'baseline', gap: 0.5,
          px: 0.75, py: 0.25, borderRadius: 1,
          border: '1px solid', borderColor: 'divider',
          opacity: impact.isStarter ? 1 : 0.55,
          maxWidth: 260,
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
          {signedPoints(impact.points)}
        </Typography>
        {/*
          * The running total for the week, in THIS league.
          *
          * Per league rather than one figure per player, because the same yards are worth
          * different amounts in each one — a single number would be wrong almost everywhere.
          *
          * The visual hierarchy here needed a second attempt. First version set the total in
          * secondary ink with a middot before it, which put it at exactly the same size, weight
          * and colour as the league name immediately after — so "17.38 Amazon Superflex Redraft"
          * read as one label and the total was invisible in practice. An arrow now says "and now
          * he is on", and the number takes primary ink so the chip reads bright-dim-bright: play
          * points, arrow, total, then the dimmer league.
          */}
        <Box
          component="span"
          sx={{ color: 'text.disabled', fontSize: '0.68rem', lineHeight: 1, px: 0.1 }}
        >
          &rarr;
        </Box>
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}
        >
          {impact.totalPoints.toFixed(2)}
        </Typography>
        {/* Rule: every league mention links to the league. */}
        <MuiLink
          href={leagueUrl(impact.leagueId)}
          target="_blank"
          rel="noopener noreferrer"
          underline="hover"
          color="text.secondary"
          variant="caption"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, overflow: 'hidden' }}
        >
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {impact.leagueName}
          </Box>
          <OpenInNewIcon sx={{ fontSize: 10, opacity: 0.5, flexShrink: 0 }} />
        </MuiLink>
      </Box>
    </Tooltip>
  );
}

function PlayerRow({ player }: { player: FeedPlayer }) {
  const caption = describeStats(player.stats);
  // Your side first, so the leagues you care about most read before the rest.
  const impacts = [...player.impacts].sort((a, b) => {
    const rank = (i: LeagueImpact) => (i.isStarter ? 0 : 1) * 2 + (i.side === 'other' ? 1 : 0);
    return rank(a) - rank(b) || Math.abs(b.points) - Math.abs(a.points);
  });

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 190 }}>
        <Box
          sx={{
            width: 3, height: 20, borderRadius: 2, flexShrink: 0,
            bgcolor: getPositionColor(player.position ?? ''),
          }}
        />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
            {player.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
            {[player.position, player.team].filter(Boolean).join(' · ')}
            {caption && ` — ${caption}`}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', flex: 1 }}>
        {impacts.map(i => <ImpactChip key={`${i.leagueId}-${i.rosterId}`} impact={i} />)}
      </Box>
    </Box>
  );
}

export default function PlayCard({ entry }: { entry: FeedEntry }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        /*
         * Accented when one of YOUR starters is involved, not merely when the play concerns you.
         *
         * Every play in this feed concerns you — it only ever contains your players and your
         * opponents' — so accenting on that accented everything and said nothing. Marking your
         * own side gives the for/against read at a glance down a long list, which is the thing
         * a scan is actually for. A left border rather than a fill, so the page does not stripe.
         */
        borderLeft: '3px solid',
        borderLeftColor: entry.yourStarter ? MARKET_SIDE_COLORS.a : 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, flexWrap: 'wrap' }}>
        {entry.quarter && (
          <Chip
            size="small"
            label={periodLabel(entry.quarter, entry.clock)}
            sx={{ height: 18, fontSize: '0.68rem' }}
          />
        )}
        {entry.isScoringPlay && (
          <Chip size="small" color="success" label="SCORE" sx={{ height: 18, fontSize: '0.68rem' }} />
        )}
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 200 }}>
          {entry.description || entry.playType || 'play'}
        </Typography>
      </Box>
      <Divider sx={{ mb: 0.75 }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {entry.players.map(p => <PlayerRow key={p.playerId} player={p} />)}
      </Box>
    </Paper>
  );
}
