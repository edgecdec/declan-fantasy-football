import type { StatLine } from '@/services/plays/playScoring';

/**
 * Team-defence stats derived from a single play.
 *
 * CORRECTING AN EARLIER CONCLUSION. This file exists because a previous measurement said team
 * defence "is not derivable from plays at all" — one week appeared to carry 1 sack and 0
 * interceptions league-wide. That was wrong, and wrong in two compounding ways: the count was taken
 * from the TEAM entry (`player_id: "SEA"`), which really does carry only series-level stats like
 * `def_3_and_out`, and `isNonPlayStat` was then discarding every `idp_*` and `def_*` key before
 * anything could read them. The defensive signal was in the feed the whole time.
 *
 * WHERE THE NUMBERS COME FROM, and why it is not the obvious place. Sacks and interceptions are
 * taken from the OFFENCE's own line — `pass_sack` and `pass_int` on the quarterback — rather than
 * from `idp_sack`/`idp_int` on the defender. Two reasons:
 *
 *  - the offence's primitives are the ones already reconciled to the cent across 53,200
 *    player-scores, so they are the trustworthy half of the feed
 *  - `idp_*` attribution demonstrably is not: on one sack-fumble the FUMBLING quarterback carries
 *    `idp_ff: 1`, and an IDP league priced a quarterback for two forced fumbles he did not force
 *
 * `metadata.possession` and `metadata.opponent` name the two teams, so the defending side is simply
 * the one without the ball.
 *
 * MEASURED, per stat, by rebuilding every team's line for a full week and diffing against Sleeper's
 * official team entries (2025 weeks 5, 9, 12, 14 and 17):
 *
 *   sack, int, safe          exact, every team, every week
 *   def_td                   exact once return scores are separated out (see below)
 *   def_st_td                exact
 *   fum_rec                  95-98% — the residual is documented on `fumbleRecoveries`
 *
 * THE TRAP THAT COST THE MOST. On a kickoff or punt, `possession` is the KICKING team, so the
 * returner always looks like "the defence" — which credited every return touchdown as a defensive
 * one, and every team recovering its own muffed kick as a defensive fumble recovery. Return scores
 * are therefore split out explicitly, which is also how a kick-return touchdown gets to the right
 * unit rather than being silently miscounted as a pick-six.
 */

/** Play types where possession is about to change hands by design. */
const RETURN_PLAY = /kickoff|punt/i;
/** Play types where a score by the team without the ball is a genuine defensive touchdown. */
const TURNOVER_PLAY = /interception|fumble/i;

export type DefenseContext = {
  /** Sleeper's play_type. */
  playType?: string | null;
  /** Sleeper's play description — the only place the recovering team is named. */
  description?: string | null;
  /** Team with the ball. */
  possession?: string | null;
  /** Team without it, i.e. the defence. */
  opponent?: string | null;
  isScoringPlay?: boolean;
  scoringTeam?: string | null;
};

/**
 * Which team ends up with a fumble, from the description.
 *
 * The LAST recovery named on the play, because a ball can change hands more than once: an
 * interception that is then fumbled back returns to the team that originally had it, and crediting
 * "the defence" there is simply false. `fum_lost` says the ball changed hands at all; only the
 * description says who has it now, and neither alone is enough.
 */
export function fumbleRecoveries(description: string): string | null {
  const matches = [...description.matchAll(/RECOVERED by ([A-Z]{2,3})[-\s]/gi)];
  return matches.length > 0 ? matches[matches.length - 1][1].toUpperCase() : null;
}

/**
 * Team-defence stat deltas for one play, keyed by team code.
 *
 * A map rather than a single line because one play can credit two different teams — a fumble
 * recovered by the side that had just thrown an interception being the awkward case.
 */
export function defenseStatsForPlay(
  rawStats: { player_id: string; stats: StatLine }[],
  context: DefenseContext,
): Map<string, StatLine> {
  const out = new Map<string, StatLine>();
  const offence = context.possession ?? null;
  const defence = context.opponent ?? null;
  if (!offence || !defence) return out;

  const add = (team: string, key: string, amount: number) => {
    if (!amount) return;
    const line = out.get(team) ?? {};
    line[key] = (line[key] ?? 0) + amount;
    out.set(team, line);
  };

  // Everything the play credited, summed across players, so a stat is read once regardless of whom
  // Sleeper attached it to.
  const totals: StatLine = {};
  for (const s of rawStats) {
    for (const [k, v] of Object.entries(s.stats ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) totals[k] = (totals[k] ?? 0) + v;
    }
  }

  const description = context.description ?? '';
  const playType = String(context.playType ?? '');

  add(defence, 'sack', totals.pass_sack ?? 0);
  add(defence, 'int', totals.pass_int ?? 0);
  add(defence, 'safe', totals.idp_safe ?? 0);
  add(defence, 'blk_kick', totals.blk_kick ?? 0);

  // Only a fumble that actually changed hands, credited to whoever the description says has it.
  if (totals.fum_lost) {
    const recoveredBy = fumbleRecoveries(description) ?? defence;
    add(recoveredBy, 'fum_rec', 1);
  }

  if (context.isScoringPlay && context.scoringTeam && /touchdown/i.test(description)) {
    const scorer = context.scoringTeam;
    if (scorer !== offence) {
      if (RETURN_PLAY.test(playType)) {
        // Special teams, not defence. Scored to the unit whose return it was.
        add(scorer, 'def_st_td', 1);
      } else if (TURNOVER_PLAY.test(playType) && scorer === defence) {
        add(defence, 'def_td', 1);
      }
    }
  }

  return out;
}

/*
 * WHAT IS DELIBERATELY NOT HERE: points and yards allowed.
 *
 * Both were attempted and both fell short of the standard the rest of this file meets:
 *
 *  - summing `scoring_points` across scoring plays: 19-26 of 28 teams exact, gaps up to 6. The
 *    field is not a complete record of scoring.
 *  - the running `home_points`/`away_points` on each play, with the home/away mapping inferred from
 *    which side of the scoreboard gained points on a known scoring play: better, 107 of 116 team
 *    figures exact across four weeks, but always with some game out by exactly 6.
 *  - subtracting touchdowns scored BY a defence, on the theory that a fantasy defence is not charged
 *    for them: no net improvement at all — still 107 of 116, with different games wrong. So the
 *    hypothesis is not the explanation, and shipping the subtraction would have been a fudge that
 *    looked principled.
 *
 * `pts_allow` and `yds_allow` are exact in the periodic stats feed, and they are bracket inputs that
 * only matter as a running total rather than per play. That is where they should come from.
 */
